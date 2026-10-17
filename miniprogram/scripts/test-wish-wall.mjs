/**
 * 需求 28「马上有 · 弹幕祈福墙」行为断言
 *
 * 业务口径：弹幕**不接 UGC 审核**，治理由「超管工作台-内容模块」承载。
 * 正因没有审核兜底，下面这些点一旦写错就没有第二道防线：
 *   1. 客户端直写集合 → 绕过长度/频控/状态，且能自己把自己置顶（集合规则必须 write:false）；
 *   2. 展示名信客户端 → 任何人可冒充他人发弹幕（必须服务端读 users）；
 *   3. 关闭开关后仍发请求 → 等于没关（开关必须同时关掉展示与写入）；
 *   4. 弹幕布局用随机数 → 每次 setData 跳位置，长文案跑得比短文案快（必须确定性 + 匀速）；
 *   5. 管理端看不到 hidden → 「无审核」的最后一道人工兜底失效。
 *
 * 用法：
 *   node miniprogram/scripts/test-wish-wall.mjs
 *   node miniprogram/scripts/test-wish-wall.mjs --selftest
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join as join2, relative as relative2, resolve } from 'node:path'
import { createRequire, isBuiltin } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const nodeRequire = createRequire(import.meta.url)

let passed = 0
let failed = 0
const failures = []
function check(name, cond, extra) {
  if (cond) passed += 1
  else {
    failed += 1
    failures.push(`${name}${extra ? ' — ' + extra : ''}`)
  }
}
function eq(name, got, want) {
  check(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}

const INJECTIONS = {
  // 2026-10-17 旧墙退场：今日一签「写成心愿」改回心愿签 —— 心愿签不取交接 = 那一句白写
  'labels-handoff-not-consumed': {
    file: 'miniprogram/subpackages/feature/wish-labels/index.js',
    from: '  onShow() {\n    if (this.data.allowed) this.applyPlayHandoff()\n  },',
    to: '  onShow() {\n  },'
  },
  'labels-handoff-skipped-on-gate': {
    file: 'miniprogram/subpackages/feature/wish-labels/index.js',
    from: '    void this.resolveExhibit()\n    this.applyPlayHandoff()\n',
    to: '    void this.resolveExhibit()\n'
  },
  // 返回判定仍认旧墙路由 → 从心愿签进来也匹配不上，退化成 reLaunch（页面栈被清空）
  'qian-back-matches-old-wall': {
    file: 'miniprogram/subpackages/plays/utils/ritualPlayPage.js',
    from: "indexOf('wish-labels/index') !== -1",
    to: "indexOf('wish-wall/index') !== -1"
  },
  // 首页入口槽位被摘掉 → 产品口径「入口放在首页 banner 下方」落空
  'home-entry-slot-dropped': {
    file: 'miniprogram/pages/index/index.wxml',
    from: '    <view class="wish-wall-slot-home" wx:if="{{showMaShangYou}}">\n',
    to: ''
  },
  /* —— 首页跑马灯健壮性（2026-09-20 施工代理补强）：每一条都对应"看起来能跑、其实半成品"——
     注入块只动首页/入口相关文件（index.js / WishWallEntry / index.wxss）。 */
  // 首页文案退回自己那套 .trim()（不再走共享 normalizeWishText）→ 换行/零宽字符进跑马灯
  'home-marquee-no-normalize': {
    file: 'miniprogram/pages/index/index.js',
    from: '          text: normalizeWishText(r && r.text),',
    to: "          text: String((r && r.text) || '').trim(),"
  },
  // 组件只信宿主、自己不再归一化 → 一条纯零宽字符的"愿"占一个看不见字的空位
  'home-marquee-raw-text': {
    file: 'miniprogram/components/WishWallEntry/index.js',
    from: "            return { t: normalizeWishText(it.text), e: String(it.emoji || '') }",
    to: "            return { t: String(it.text == null ? '' : it.text).trim(), e: String(it.emoji || '') }"
  },
  // 单条不再封顶 → 存量脏数据里的超长单条把"按长度换算时长"的匀速跑马灯拖乱
  'home-marquee-item-uncapped': {
    file: 'miniprogram/components/WishWallEntry/index.js',
    from: '        .map((r) => ({ t: r.t.slice(0, TEXT_MAX), e: r.e }))',
    to: '        .map((r) => ({ t: r.t, e: r.e }))'
  },
  // 1 条也开跑马灯 → 无缝循环里露空档（PRD 明确 ≥2 条才开）
  'home-marquee-one-item': {
    file: 'miniprogram/components/WishWallEntry/index.js',
    from: '      const items = rows.length >= MQ_MIN',
    to: '      const items = rows.length >= 1'
  },
  // 时长写死 → 短文案一闪而过、长文案挤成一团（"长文案跑得久"失效）
  'home-marquee-flat-duration': {
    file: 'miniprogram/components/WishWallEntry/index.js',
    from: '      const duration = Math.max(14000, Math.min(46000, 10000 + chars * 260))',
    to: '      const duration = 26000'
  },
  // 去重退回"只看条数" → 刷新后条数一样就永远停在旧文案上
  'home-marquee-length-dedup': {
    file: 'miniprogram/components/WishWallEntry/index.js',
    from: '      if (signature !== this._mqSignature) {',
    to: '      if (items.length !== this.data.mqItems.length) {'
  },
  // 失败后不清"已拉过"标记 → 一次网络抖动 = 本次会话永远没有跑马灯
  'home-marquee-sticky-failure': {
    file: 'miniprogram/pages/index/index.js',
    from: '      this._wishWallMarqueeLoaded = false;\n      this.setData({ wishWallWishes: [] });',
    to: '      this.setData({ wishWallWishes: [] });'
  },
  // 刷新不重置标记 → 会话内永远停在旧心愿（下拉刷新对它无效）
  'home-marquee-refresh-not-reset': {
    file: 'miniprogram/pages/index/index.js',
    from: '  resetWishWallMarquee() {\n    this._wishWallMarqueeLoaded = false;\n  },',
    to: '  resetWishWallMarquee() {\n    void 0;\n  },'
  },
  // 无缝循环的几何被 gap 破坏 → 每次回绕错半个 gap（12rpx 顿挫）
  'home-marquee-gap-seam': {
    file: 'miniprogram/components/WishWallEntry/index.wxss',
    from: '  display: inline-flex;\n  align-items: center;\n',
    to: '  display: inline-flex;\n  align-items: center;\n  gap: 24rpx;\n'
  },
  // 组件不再看 enabled（只按 defaultWall/藏品判定）→ 开关关了组件自己还亮
  'home-entry-enabled-ignored': {
    file: 'miniprogram/components/WishWallEntry/index.js',
    from: '      const visible = enabled === true && (defaultWall === true || isWishWallProduct(product))',
    to: '      const visible = defaultWall === true || isWishWallProduct(product)'
  },
  // 展示名改用客户端入参 → 可冒充他人
  'trust-client-nickname': {
    file: 'miniprogram/cloudfunctions/manageWishWall/index.js',
    from: 'nickname: profile.nickname,',
    to: 'nickname: (event && event.nickname) || profile.nickname,'
  },
  // 列表不再过滤 status → 被隐藏的弹幕会重新出现在公开墙面
  'list-ignores-status': {
    file: 'miniprogram/cloudfunctions/manageWishWall/index.js',
    from: '.where({ productKey, status: STATUS_VISIBLE, source: _.nin(SEED_SOURCES) })',
    to: '.where({ productKey, source: _.nin(SEED_SOURCES) })'
  },
  // ===== 公开列表混排（2026-09-30）=====
  // 预埋池不过滤 status → 被隐藏的预埋重新上墙
  'seed-pool-ignores-status': {
    file: 'miniprogram/cloudfunctions/manageWishWall/index.js',
    from: '.where({ productKey, status: STATUS_VISIBLE, source: _.in(SEED_SOURCES) })',
    to: '.where({ productKey, source: _.in(SEED_SOURCES) })'
  },
  // 预埋抢在真实心愿前面占位 → 真实心愿被挤出墙面
  'mix-seeds-first': {
    file: 'miniprogram/cloudfunctions/manageWishWall/index.js',
    from: '  const realTake = Math.min(realRest.length, slots - reserve)',
    to: '  const realTake = Math.min(realRest.length, slots - ring.length)'
  },
  // 不给预埋留位 → 真实心愿多时预埋永远上不了墙
  'mix-no-reserve': {
    file: 'miniprogram/cloudfunctions/manageWishWall/index.js',
    from: 'Math.floor(slots * SEED_RESERVE_RATIO)',
    to: '0'
  },
  // 不轮换 → 永远是同一批预埋
  'mix-no-rotation': {
    file: 'miniprogram/cloudfunctions/manageWishWall/index.js',
    from: '    const start = (Math.floor(nowMs / SEED_ROTATE_MS) * seedTake) % ring.length',
    to: '    const start = 0'
  },
  // 置顶不再最前
  'mix-pinned-dropped': {
    file: 'miniprogram/cloudfunctions/manageWishWall/index.js',
    from: '  return pinned.concat(mixed)',
    to: '  return mixed.concat(pinned)'
  },
  // 第二道闸失效：hidden 混进结果
  'mix-hidden-kept': {
    file: 'miniprogram/cloudfunctions/manageWishWall/index.js',
    from: '  const visible = (d) => d && d.status !== STATUS_HIDDEN',
    to: '  const visible = (d) => !!d'
  },
  // 不穿插 → 预埋堆在末尾成一长串
  'mix-no-interleave': {
    file: 'miniprogram/cloudfunctions/manageWishWall/index.js',
    from: '    const seedHere = Math.floor(((i + 1) * seeds.length) / total) > Math.floor((i * seeds.length) / total)',
    to: '    const seedHere = i >= reals.length'
  },
  // 丢掉频控 → 可无限刷屏
  'drop-rate-limit': {
    file: 'miniprogram/cloudfunctions/manageWishWall/index.js',
    from: '  const { start, end } = todayRangeShanghai()',
    to: '  const { start, end } = { start: new Date(0), end: new Date(0) }\n  const __skipRate = true'
  },
  // 弹幕时长固定 → 长文案跑得比短文案快（观感不匀速）
  'flat-duration': {
    file: 'miniprogram/utils/wishWall.js',
    // 2026-09-28 锚点跟随源码：文案宽抽成 textWidthRpx() → `w`。语义不变：宽度不再含文案宽 → 时长与长度无关。
    from: '  const width = SCREEN_RPX + w\n',
    to: '  const width = SCREEN_RPX\n'
  },
  // 管理端只看 visible → 「无审核」的最后一道人工兜底失效
  'staff-hides-hidden': {
    file: 'miniprogram/cloudfunctions/manageWishWall/index.js',
    from: "  if (status === STATUS_VISIBLE || status === STATUS_HIDDEN) where.status = status",
    to: '  where.status = STATUS_VISIBLE'
  },
  // 播种不与墙上已有内容去重 → 同一批内容反复上墙，等于刷屏且绕过人工隐藏
  'seed-ignores-existing': {
    file: 'miniprogram/cloudfunctions/manageWishWall/wishSeeds.js',
    from: '    if (taken[text]) continue',
    to: '    if (false) continue'
  },
  // 丢掉「马上有XX」句式闸 → AI 写「祝你暴富」也上墙，整面墙不成句式
  'seed-allows-off-pattern': {
    file: 'miniprogram/cloudfunctions/manageWishWall/wishSeeds.js',
    from: '    if (requirePrefix && (text.indexOf(SEED_PREFIX) !== 0 || text.length <= SEED_PREFIX.length)) continue',
    to: '    if (false) continue'
  },
  // 播种不校验身份 → 任何人可让 AI 往公开墙面批量写入
  'seed-skips-staff-guard': {
    file: 'miniprogram/cloudfunctions/manageWishWall/index.js',
    from:
      "async function staffSeedAi(event, openid) {\n  const guard = await requireManager(event, openid)\n  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg || '无权限' }",
    to: 'async function staffSeedAi(event, openid) {\n  if (false) return { success: false, code: \'FORBIDDEN\', msg: \'无权限\' }'
  },
  // 自动彩蛋不再"只弹一次" → 每次进页面都弹窗，惊喜变骚扰
  'egg-pageenter-repeats': {
    file: 'miniprogram/utils/easterEgg.js',
    from: '  if (!firstTime && extras.skipIfDiscovered) return null',
    to: '  if (false) return null'
  },
  // 作用域写死 → 第二面祈福墙的内容会全部落进「马上有」，全站拓展失效
  'entry-key-hardcoded': {
    file: 'miniprogram/utils/wishWall.js',
    from: '  if (p.wishWallKey) return normalizeProductKey(p.wishWallKey)',
    to: '  if (false) return PRODUCT_KEY'
  },
  // 「内容管理」(tab 9) 的直达入口被摘掉 → 按「内容模块」直觉找的人又会找不到（实测反馈的那次）
  // 注意 to 里**不能**再出现 goWishWallManage 子串，否则断言仍会命中（注入即失效）
  'tab9-entry-removed': {
    file: 'miniprogram/subpackages/manager/manager/workspace/_subviews.wxml',
    from: 'bindtap="goWishWallManage"',
    to: 'bindtap="noopTab9"'
  },
  // 小程序端漏带云函数 save 读取的字段 → 保存时该字段被重置为默认，抹掉另一端的设置
  'flags-field-dropped': {
    file: 'miniprogram/subpackages/manager/manager/managerPageConfig.js',
    from: '          imageThumbEnabled: flags.imageThumbEnabled !== false,\n',
    to: ''
  },
  // 弹窗按钮文案超过微信 4 字硬限制 → showModal 静默失败，表现为「点了没反应」
  'modal-text-too-long': {
    file: 'miniprogram/subpackages/manager/wish-wall/index.js',
    from: "      confirmText: '生成',",
    to: "      confirmText: '生成并上墙',"
  },
  // 详情页只读一次缓存值、不接 SWR 后台刷新 → 开关打开后最长 ~24h 看不到入口
  'detail-flags-no-onupdate': {
    file: 'miniprogram/subpackages/feature/detail/index.js',
    from: '      const { flags } = await fetchContentDisplayFlags({\n        onUpdate: (payload) => {',
    to: '      const { flags } = await fetchContentDisplayFlags({\n        __onUpdateRemoved: (payload) => {'
  },

  // 保存开关后不失效本机缓存 → 本机 C 端最长 24h 看不到变化
  'save-skips-cache-invalidate': {
    file: 'miniprogram/subpackages/manager/manager/managerPageConfig.js',
    from: "        require('../../../utils/contentDisplayFlags').invalidateContentDisplayFlags()",
    to: '        void 0'
  },
  // 摘掉「未保存」提示 → 超管拨完开关会以为已经生效
  'dirty-hint-dropped': {
    file: 'miniprogram/subpackages/manager/manager/workspace/_subviews.wxml',
    from: '        <view class="cfg-dirty" wx:if="{{contentFlagsDirty}}">',
    to: '        <view class="cfg-not-dirty" wx:if="{{contentFlagsDirty}}">'
  },
  // 云函数版本漂移不再给出可执行提示 → 运营只看到「未知 action: xxx」不知怎么办
  'stale-fn-error-raw': {
    file: 'miniprogram/subpackages/manager/utils/memberScan.js',
    from: "/未知 action/.test(String(e.msg || ''))",
    to: "/__never__/.test(String(e.msg || ''))"
  },
  // 复比退回全量 → 单函数部署会被下载全部函数拖到超时（实测）
  'deploy-all-recompare': {
    file: 'miniprogram/scripts/deploy-drifted.sh',
    from: 'node "$CHECKER" $DRIFT --json > "$AFTER_JSON"',
    to: 'node "$CHECKER" --json > "$AFTER_JSON"'
  },
  // 磁贴名被改回全称（产品已定为短名「开关」）→ 名字漂移必须被拦下
  'tile-label-drift': {
    file: 'miniprogram/subpackages/manager/manager/index.wxml',
    from: '<text class="hub-cell-name">开关</text>',
    to: '<text class="hub-cell-name">内容开关</text>'
  },
  // 轨道占用退回「固定间隔」→ 同轨叠成一片（这就是业务方说的灾难现场）
  'lane-overlap': {
    file: 'miniprogram/utils/wishWall.js',
    from: '    laneNextAt[lane] = delayMs + clearMs + gapMs',
    to: '    laneNextAt[lane] = delayMs + gapMs'
  },

  // 首屏预填被关掉 → 墙面在加载后 2–3 秒内是空的（只有刻度线），产品真机截图里的"空框"
  'danmaku-no-prefill': {
    file: 'miniprogram/utils/wishWall.js',
    from: '    const prefill = i < lanes',
    to: '    const prefill = false'
  },
  // 预填又退回贴左缘（0.85）→ t=2s 出图假稀疏（2026-09-24）
  'danmaku-prefill-edge': {
    file: 'miniprogram/utils/wishWall.js',
    // 2026-09-28 锚点跟随源码：三元改成 if/else（加了 boost 分支）。语义不变：预填系数退回 0.85→0.14。
    from: '      delayMs = -Math.round(durationMs * (0.62 - 0.08 * i))',
    to: '      delayMs = -Math.round(durationMs * (0.85 - 0.14 * i))'
  },







  // 入口又被埋回参数区（回到"没人看得到"的位置）
  'entry-buried-again': {
    file: 'miniprogram/subpackages/feature/detail/index.wxml',
    from: '    <view class="wish-wall-slot">',
    to: '    <!-- buried -->\n    <view class="wish-wall-slot-x" style="display:none">'
  },
  // 宿主不再给间距（只剩组件零边距）→ 入口与主图/价格卡贴死
  'slot-margin-dropped': {
    file: 'miniprogram/subpackages/feature/detail/index.wxss',
    from: '  margin: 24rpx 0;',
    to: '  margin: 0;'
  },
  // 首屏位改用三行完整版 → 价格卡被推出首屏
  'compact-dropped': {
    file: 'miniprogram/subpackages/feature/detail/index.wxml',
    from: '        compact="{{true}}"',
    to: '        compact="{{false}}"'
  },
  // 开关翻转后不重测锚点 → 三个页签整体错位
  'flags-no-remeasure': {
    file: 'miniprogram/subpackages/feature/detail/index.js',
    from: '    setTimeout(() => this.computeSectionTops(), 120);',
    to: '    void 0;'
  },
  // 灯的样式退回单类选择器 → 被全局 .signal-light.lamp-brass 按特异性压过
  'lamp-specificity-dropped': {
    file: 'miniprogram/components/WishWallEntry/index.wxss',
    from: '.wish-wall-entry .wish-wall-entry-row .wish-wall-entry-lamp {',
    to: '.wish-wall-entry-lamp {'
  },
  // 额度上限与云函数漂移（"说我还能写、写完却被拒"）
  'quota-limit-drift': {
    file: 'miniprogram/utils/wishWall.js',
    from: 'const DAILY_LIMIT = 5',
    to: 'const DAILY_LIMIT = 9'
  },
  // 时间解析退回裸 new Date（{$date} → 时间空 + 额度数成 0）
  'quota-naive-time': {
    file: 'miniprogram/utils/wishWall.js',
    from: '    if (value.$date != null) return wishTimeMs(value.$date)\n',
    to: ''
  },









  // 结果纸面丢掉对话框语义（读屏不知道这是一个结果层）
  // ⚠️ 2026-09-21（§11.4 玩法各开一页）锚点跟随源码：结果层从"祈福墙页的纸签弹层"
  // 搬到**玩法页的结果纸面**（`.rp-paper`）。注入语义不变：摘掉 aria-role="dialog"。
  'card-not-dialog': {
    file: 'miniprogram/subpackages/plays/play-qian/index.wxml',
    from: 'aria-role="dialog" aria-label="{{result.name}}结果"',
    to: 'aria-label="{{result.name}}结果"'
  },

  // 客户端请求上限与云函数漂移
  'list-limit-drift': {
    file: 'miniprogram/utils/wishWall.js',
    from: 'const LIST_LIMIT = 30',
    to: 'const LIST_LIMIT = 20'
  },
  // 分列退化成单列（第二列永远为空）
  'tags-single-column': {
    file: 'miniprogram/utils/wishWall.js',
    from: '  ;(Array.isArray(items) ? items : []).forEach((it, i) => { out[i % n].push(it) })',
    to: '  ;(Array.isArray(items) ? items : []).forEach((it) => { out[0].push(it) })'
  },

  // 打到上限也装作全量
  'cap-lies': {
    file: 'miniprogram/utils/wishWall.js',
    from: '  return n >= (Number(limit) || LIST_LIMIT)',
    to: '  return false'
  },

  // ===== 升级第一期（仪式/祈福/彩蛋）=====
  // 灯位不再分层 → 连续 7 天和第一天得到同一档反馈，坚持失去累积感
  'lamp-tier-flat': {
    file: 'miniprogram/utils/wishWall.js',
    from: '  const hit = LAMP_TIERS.find((t) => n >= t.min)',
    to: '  const hit = LAMP_TIERS[LAMP_TIERS.length - 1]'
  },
  // 节气判定永远不命中 → 节气灯语与节气名成了死代码
  'solar-term-off': {
    file: 'miniprogram/utils/wishWall.js',
    from: '  const i = SOLAR_TERMS.findIndex((t) => t.month === month && t.day === day)',
    to: '  const i = -1'
  },
  // 门槛型彩蛋不看门槛 → 刚点第一次灯就弹出「连续三天」的彩蛋
  'egg-streak-ignores-threshold': {
    file: 'miniprogram/utils/easterEgg.js',
    from: '    if (!(Number(c.streak) >= need)) return false',
    to: '    if (false) return false'
  },

  // 博物笔记入口丢掉定位参数 → 从祈福墙点进去落在成就页顶部，找不到那一片
  'relics-focus-dropped': {
    file: 'miniprogram/subpackages/extra/user/achievements/index.js',
    from: ".trim() === 'relics'",
    to: ".trim() === '__never__'"
  },
  // ===== 多面墙可运营 =====
  // 商品字段没进 manageProducts 白名单 → 保存时被静默丢弃，界面还提示"已保存"
  'product-field-not-allowlisted': {
    file: 'miniprogram/cloudfunctions/manageProducts/index.js',
    from: "  'wishWallEnabled', 'wishWallKey'\n",
    to: ''
  },
  // 载入时不按"实际是否挂墙"回填 → 打开任意藏品保存一次就把墙摘了
  'wishwall-preset-off': {
    file: 'miniprogram/subpackages/manager/manager/managerPageConfig.js',
    from: '          wishWallEnabled: isWishWallProduct(item),',
    to: '          wishWallEnabled: false,'
  },

  // ===== 多面墙治理 =====
  // 管理页退回写死默认墙 → 第二面墙的弹幕又变成无人可治
  // ⚠️ 2026-10-13 锚点跟随源码：心愿签语音上线时这行多了「待试听页签时 status 传空」的分支
  //   （`status: voiceTab ? '' : this.data.activeStatus`），旧锚点整行匹配失效 → 注入变成假绿。
  //   注入语义不变（把 productKey 换成写死的默认墙）。
  'manager-wall-hardcoded': {
    file: 'miniprogram/subpackages/manager/wish-wall/index.js',
    from: "productKey: this.data.productKey, status: voiceTab ? '' : this.data.activeStatus }",
    to: "productKey: DEFAULT_PRODUCT_KEY, status: voiceTab ? '' : this.data.activeStatus }"
  },
  // 列墙不鉴权 → 任何人都能枚举出全部墙
  'staffwalls-unprotected': {
    file: 'miniprogram/cloudfunctions/manageWishWall/index.js',
    from:
      "async function staffWalls(event, openid) {\n  const guard = await requireManager(event, openid)\n  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg || '无权限' }",
    to: "async function staffWalls(event, openid) {\n  if (false) return { success: false, code: 'FORBIDDEN', msg: '无权限' }"
  },
  // 切墙不落本地 → 每次进来都回到默认墙，多面墙等于不好用
  'wall-switch-not-persisted': {
    file: 'miniprogram/subpackages/manager/wish-wall/index.js',
    from: '    writeCachedScope(next)\n',
    to: ''
  },
  // ===== 展品主角区（2026-09-27 马上有 = 门店核心 IP）=====
  // 展品文案写进「摸一下」→ 违反 PRD §2.2（标本不允许触摸）
  'exhibit-touch-copy': {
    file: 'miniprogram/config/wallExhibit.js',
    from: "    line: '对着黑马「马上有」，说一句想要的'",
    to: "    line: '摸一下它的鼻子，你马上就有'"
  },
  // 挑商品不看下架 → 门店码进墙会把人带到一件已下架的商品页
  'exhibit-offshelf-kept': {
    file: 'miniprogram/subpackages/feature/utils/wallExhibitProduct.js',
    from: '    p.isOffShelf !== true &&\n',
    to: ''
  },
  // 挑商品不看作用域 → 别的墙的商品冒充马上有
  'exhibit-wrong-wall': {
    file: 'miniprogram/subpackages/feature/utils/wallExhibitProduct.js',
    from: '    isWishWallProduct(p) &&\n    resolveWishWallKey(p) === key)',
    to: '    isWishWallProduct(p))'
  },
  // 入口文案写死「马上有」→ 第二面墙的入口写着别人的商品名
  'entry-copy-hardcoded': {
    file: 'miniprogram/components/WishWallEntry/index.js',
    from: "        ? '把心愿挂上墙，让「马上有」替你记着'\n        : '把心愿挂上墙，替自己记着'",
    to: "        ? '把心愿挂上墙，让「马上有」替你记着'\n        : '把心愿挂上墙，让「马上有」替你记着'"
  },
  // ===== 多面墙内容正确性（句式前缀）=====
  // 句式闸忽略传入前缀、仍按写死的「马上有」筛 → 第二面墙会长满别的墙的话
  'seed-prefix-ignored': {
    file: 'miniprogram/cloudfunctions/manageWishWall/wishSeeds.js',
    from: '    if (requirePrefix && (text.indexOf(prefix) !== 0 || text.length <= prefix.length)) continue',
    to: '    if (requirePrefix && (text.indexOf(SEED_PREFIX) !== 0 || text.length <= SEED_PREFIX.length)) continue'
  },
  // 自定义前缀也拿「马上有XX」基线兜底 → 铺错内容（比不铺更糟）
  'seed-baseline-for-custom-prefix': {
    file: 'miniprogram/cloudfunctions/manageWishWall/index.js',
    from: '  const baseTexts = isDefaultPrefix\n    ? selectNewSeeds({',
    to: '  const baseTexts = true\n    ? selectNewSeeds({'
  },
  // 页面不把前缀发给云端 → 云端永远按默认前缀生成
  'seed-prefix-not-sent': {
    file: 'miniprogram/subpackages/manager/wish-wall/index.js',
    from: "        prefix: this.effectiveSeedPrefix(),\n",
    to: ''
  },















  // 端上预校验退回 UTF-16 → 30 个 emoji 会被**误拒**（服务端本来接受），
  // 即"端上拒绝、服务端允许"的口径分叉。2026-09-21 夜班修的就是这一处。
  'client-validate-by-utf16': {
    file: 'miniprogram/utils/wishWall.js',
    from: '  const count = wishTextCount(text)',
    to: '  const count = text.length'
  },













  // 玩法文案里混进命理/占卜表述 → 审核风险
  'play-content-forbidden-word': {
    file: 'miniprogram/subpackages/plays/config/ritualPlayContent.js',
    from: "  { yi: '开口', ji: '憋着', line: '想要什么就说出来，说出口才有回音。', wish: '回音' },",
    to: "  { yi: '开口', ji: '憋着', line: '今天适合找人给你算一卦，看看吉凶。', wish: '回音' },"
  },
  // 玩法结果用随机数 → 刷新就换一个，"今日一签"名存实亡
  'play-nondeterministic': {
    file: 'miniprogram/subpackages/plays/utils/ritualPlay.js',
    from: '  return `${String(playId)}|${String(dayKey)}`',
    to: '  return `${String(playId)}|${String(dayKey)}|${Math.random()}`'
  },
  // 资料门禁被拆掉 → 没有星座也照样"给一个结果"（编出来的）
  'play-profile-gate-dropped': {
    file: 'miniprogram/subpackages/plays/utils/ritualPlay.js',
    // 2026-09-21（§11.2-4）：多了 `variant ||` 这一档（同一天换一个维度），锚点跟随源码。
    // 注入语义不变：把空值兜成 'fallback' → 缺资料不再返回 need_profile。
    from: "    fieldValue = variant || String(profile[need] || '')",
    to: "    fieldValue = variant || String(profile[need] || 'fallback')"
  },

  // 心愿词规范化被拆掉 → 脏值（「回音」「马上有超长…」）会直接预填进写愿签
  'play-wish-not-prefixed': {
    file: 'miniprogram/subpackages/plays/utils/ritualPlay.js',
    from: "  return /^马上有[\\u4e00-\\u9fa5]{1,3}$/.test(wish) && wish.length <= TEXT_MAX ? wish : ''",
    to: '  return wish'
  },
  // 祈运标签不再参与排序 → 商品标签白打了（页面永远按注册表原顺序）
  'bless-order-dropped': {
    file: 'miniprogram/config/blessTags.js',
    from: "  const out = []\n  sanitizeBlessTags(keys).forEach((key) => {",
    to: "  const out = []\n  ;[].forEach((key) => {"
  },
  // 入口 URL 不再带祈运标签 → 墙面永远拿不到"这面墙求什么"
  'bless-url-dropped': {
    file: 'miniprogram/utils/wishWall.js',
    from: "  if (bless) params.push(`bless=${encodeURIComponent(bless)}`)",
    to: "  if (false) params.push(`bless=${encodeURIComponent(bless)}`)"
  },

  // 选品不再按标签/场景过滤 → 等于拿全站在架兜底（"求学"会被推成任意商品 = 乱推）
  'reco-filter-dropped': {
    file: 'miniprogram/cloudfunctions/getBlessProducts/index.js',
    from: "  const where = _.and([{ isOffShelf: _.neq(true) }, orConds.length > 1 ? _.or(orConds) : orConds[0]])",
    to: "  const where = _.and([{ isOffShelf: _.neq(true) }])"
  },
  // 场景兜底那一支被丢掉 → 只填了礼赠场景的存量商品永远推荐不出来（功能空转）
  'reco-scene-branch-dropped': {
    file: 'miniprogram/cloudfunctions/getBlessProducts/index.js',
    from: "  if (scenes.length) orConds.push({ giftScenes: _.in(scenes) })",
    to: "  if (false && scenes.length) orConds.push({ giftScenes: _.in(scenes) })"
  },
  // C 端入口不再做场景兜底 → 存量商品连祈运提示都拿不到
  'bless-scene-fallback-dropped': {
    file: 'miniprogram/config/blessTags.js',
    from: "  return blessTagsFromScenes(product && product.giftScenes)",
    to: "  return []"
  },
  // 排除项失效 → 给自己推荐自己（当前这面墙的商品又出现一次）
  'reco-exclude-dropped': {
    file: 'miniprogram/cloudfunctions/getBlessProducts/index.js',
    // 2026-09-20：锚点跟随源码更新（推荐修复把「过滤 → 排序」拆成了 ranked / rotate / ordered 三步，
    // 原锚点 `const list = sortPool(rows.filter(...))` 那一行已不存在）。
    // 语义不变：去掉 exclude 过滤 → 守卫必须检出"给自己推荐自己"。
    from: '    rows.filter((r) => isOnShelf(r) && !exclude.has(String(r._id))),',
    to: '    rows.filter((r) => isOnShelf(r)),'
  },

  // 缓存键丢掉日期 → 跨天还拿昨天的推荐（"一天一件"悄悄变成"永远同一件"）
  'reco-cache-crosses-day': {
    file: 'miniprogram/subpackages/plays/utils/blessProducts.js',
    from: '  return `${t}|${String(dayKey)}`',
    to: '  return `${t}`'
  },


  // 页面不再解析 scene → 门店码扫码进来落错墙、来源也丢了
  'store-scene-parsing-dropped': {
    file: 'miniprogram/utils/wishWall.js',
    from: "  const rawKey = grab('k') || grab('productKey')\n  if (/^[a-zA-Z0-9_-]{1,40}$/.test(rawKey)) out.productKey = normalizeProductKey(rawKey)",
    to: "  const rawKey = ''\n  if (false) out.productKey = normalizeProductKey(rawKey)"
  },

  // matchSource 又变回常量 → 场景兜底的商品被说成"同好也在看"（编造社会证明）
  'reco-match-source-constant': {
    file: 'miniprogram/cloudfunctions/getBlessProducts/index.js',
    from: "    .map((r) => leanProduct(r, explicitIds.has(String(r._id)) ? 'tag' : 'scene'))",
    to: "    .map((r) => leanProduct(r, 'tag'))"
  },
  // 文案不再随依据走 → 页面永远显示"同好也在看"
  'reco-label-hardcoded': {
    file: 'miniprogram/subpackages/plays/utils/blessProducts.js',
    from: "  if (s === 'scene') return '这类心愿常配这件'",
    to: "  if (s === 'scene') return '同好也在看'"
  },







  // 社会证明复活（把推荐标题写死成"同好也在看"）
  'social-proof-resurrected': {
    file: 'miniprogram/subpackages/plays/utils/blessProducts.js',
    from: "  return label ? `偏「${label}」· 为你配一件` : '为你配一件'",
    to: "  return '同好也在看'"
  },




  // 分享文案把"依据"带出去 → 等于公开了用户的星座/型别
  'play-share-leaks-basis': {
    file: 'miniprogram/subpackages/plays/utils/ritualPlay.js',
    from: "    share: `${play.name}：${(play.needs || []).length ? '' : (body.overline ? String(body.overline) + ' · ' : '')}${String(body.title || '')}",
    to: "    share: `${play.name}：${body.overline ? String(body.overline) + ' · ' : ''}${String(body.title || '')}"
  },
  // ── 手写体接线（W6 交接不变量 5）────────────────────────────────────────
  // 这页的字全靠 app.js → utils/handFont.js 的网络字体；下面四条任一断掉，iOS 真机上整页
  // 静默落回系统字体（页面照样渲染、不报错）。2026-09-19 接手盘点实测：加这四条注入时
  // 654 条断言**全部照绿** —— 说明当时这条不变量没有任何判据（详见交付记录 §41）。
  'handfont-not-loaded': {
    file: 'miniprogram/app.js',
    from: '      this.ensureHandFontWithRetry()',
    to: '      // 手写体加载被关掉（自检注入）'
  },
  'handfont-not-global': {
    file: 'miniprogram/utils/handFont.js',
    from: '      global: true,',
    to: '      global: false,'
  },
  'handfont-scopes-dropped': {
    file: 'miniprogram/utils/handFont.js',
    from: "      scopes: ['webview', 'native'],",
    to: "      scopes: ['webview'],"
  },
  'handfont-family-mismatch': {
    file: 'miniprogram/utils/handFont.js',
    from: "const FONT_FAMILY = 'ShanhaiHand'",
    to: "const FONT_FAMILY = 'ShanhaiHandX'"
  },
  // ── 「写成心愿」不收结果层 / 不带回文案（2026-09-19 真机反馈的缺陷本体）───────────
  // ⚠️ 2026-09-21（§11.4 玩法各开一页）锚点跟随源码：玩法结果搬到玩法页后，
  // 那条"弹层盖住发送条"的失败模式**结构上不存在了**（两个东西不在同一页）。
  // 保留的是它另一半语义 —— **写完必须把心愿词带回祈福墙页**：
  // 注入把 `handoff.stash(...)` 摘掉，新判据（writeWish 必须落一份一次性交接）必须变红。
  'play-wish-keeps-sheet': {
    file: 'miniprogram/subpackages/plays/utils/ritualPlayPage.js',
    from: '      handoff.stash({ draft, echo: String((play && play.echo) || r.echo || \'\') })',
    to: '      // 注入：不写交接（回归注入 —— 返回后文案就丢了）'
  },


  'ritual-save-drops-field': {
    file: 'miniprogram/cloudfunctions/getContentDisplayFlags/index.js',
    from: '    // ⚠️ 漏这一行 = 超管在后台保存成功、但 showRitualProfile 被静默重置为默认（关）\n    showRitualProfile: incoming.showRitualProfile\n',
    to: ''
  },
  // 2026-10-13（产品负责人点名）：祈福墙已全面升级为「马上有 · 心愿签」，
  // 这两个历史注册钩子开关从超管「内容开关」面板移除（云端字段与旧页接线保留 = 不改契约）。
  // 断言随之改成「不得复活」—— 下面两条注入就是它的可证伪性证明：把开关行加回去必须变红。
  'ritual-switch-row-revived': {
    file: 'miniprogram/subpackages/manager/manager/workspace/_subviews.wxml',
    from: '          <!-- 心愿签治理入口。签条（含语音）不接自动审核',
    to: '          <switch class="cfg-switch" checked="{{contentFlags.showRitualProfile}}" data-field="showRitualProfile" color="#C4A76C" bindchange="onContentFlagToggle"/>\n          <!-- 心愿签治理入口。签条（含语音）不接自动审核'
  },
  'muyu-cert-switch-row-revived': {
    file: 'miniprogram/subpackages/manager/manager/workspace/_subviews.wxml',
    from: '          <!-- 心愿签治理入口。签条（含语音）不接自动审核',
    to: '          <switch class="cfg-switch" checked="{{contentFlags.showMuyuCertificate}}" data-field="showMuyuCertificate" color="#C4A76C" bindchange="onContentFlagToggle"/>\n          <!-- 心愿签治理入口。签条（含语音）不接自动审核'
  },


  // ⚠️ 2026-09-21（§11.4 玩法各开一页）锚点跟随源码：这条从"瓦片呼吸边框"改成
  // **玩法页的进行态动效**。语义完全不变：等待中的动效只许动几何/描边，**不许压暗文字**。
  // 注入把 `.rp-hint`（进行态里就在屏幕上的那句话）挂上透明度动画，判据必须检出。
  'pending-dims-text-back': {
    file: 'miniprogram/subpackages/plays/play-qian/index.wxss',
    from: '@keyframes rp-tube-shake {',
    to: '.rp-hint { animation: rp-dim-text 800ms ease-in-out infinite; }\n@keyframes rp-dim-text { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }\n@keyframes rp-tube-shake {'
  },




  // ⚠️ 2026-09-21（§11.4）锚点跟随源码：玩法失败的"必须说出来"搬进了玩法页工厂
  // （`subpackages/plays/utils/ritualPlayPage.js` 的 settle）。注入语义不变：把提示改成静默 return。
  'play-fail-silent-again': {
    file: 'miniprogram/subpackages/plays/utils/ritualPlayPage.js',
    from: "          this.setData({ stage: 'idle', result: null, need: null })\n          this.showAppToast({",
    to: "          this.setData({ stage: 'idle', result: null, need: null })  // 注入：静默 return（回到旧行为）\n          void 0 && this.showAppToast({"
  },









  // aria-hidden 反而盖到文案上（把推荐出口「去看 ›」隐藏 —— 读屏用户丢掉主路出口）
  // ⚠️ 2026-09-21（§11.4）锚点跟随源码：这一行搬到玩法页（`.rp-reco-go`）。
  'aria-hidden-over-text': {
    file: 'miniprogram/subpackages/plays/play-qian/index.wxml',
    from: '<text class="rp-reco-go">去看 ›</text>',
    to: '<text class="rp-reco-go" aria-hidden="true">去看 ›</text>'
  },








  // 新开关缺字段默认**开**（身份相关新能力默认关是本仓先例）
  'cert-flag-default-on': {
    file: 'miniprogram/utils/contentDisplayFlags.js',
    from: '    showMuyuCertificate: src.showMuyuCertificate === true',
    to: '    showMuyuCertificate: src.showMuyuCertificate !== false'
  },
  // 云函数 saveFlags 漏透传新开关（后台保存成功、字段却被静默重置为默认）
  'cert-save-drops-field': {
    file: 'miniprogram/cloudfunctions/getContentDisplayFlags/index.js',
    from: '    showMuyuCertificate: incoming.showMuyuCertificate,',
    to: '    showMuyuCertificate: false,'
  },

  // ── P0 字数口径：emoji / ZWJ 序列按「字」算（2026-09-20）─────────────────────
  // 这四条分别对应"看起来修了、其实没修"的四类退化：
  //   ① 退回 `String.length`（UTF-16 码元）→ 家庭 emoji 又算 8；
  //   ② 用 `.slice` 截断 → 又截出半个代理对；
  //   ③ 只改客户端、服务端内嵌副本漂了 → 端上允许、服务端拒绝；
  //   ④ 页面某条改 draft 的路漏掉新模块（字数展示与输入框不符）。
  // 真值源：docs/祈福墙_全面改造_交付记录_2026-09-20.md §7 第 4 条。
  'count-by-utf16-units': {
    file: 'miniprogram/utils/wishTextCount.js',
    from: '  return wishTextGraphemes(raw).length',
    to: '  return String(raw).length'
  },
  'truncate-by-slice': {
    file: 'miniprogram/utils/wishTextCount.js',
    from: "  return wishTextGraphemes(text).slice(0, Math.floor(n)).join('')",
    to: '  return text.slice(0, Math.floor(n))'
  },
  'server-copy-drift': {
    file: 'miniprogram/cloudfunctions/manageWishWall/index.js',
    from: '  return wishTextGraphemes(raw).length',
    to: '  return String(raw).length'
  },


  // ── W1 玩法结果分享（2026-09-20；2026-09-21 玩法各开一页后锚点跟随到玩法页/工厂）──
  // ① 分享按钮被摘掉 `open-type="share"`（小程序里点了不会转发）；
  // ② 分享退化成读别的字段（不读 `result.share`）；
  // ③ 来源标记不复位（第二次点分享被上一次污染）。
  'sheet-share-button-dropped': {
    file: 'miniprogram/subpackages/plays/play-qian/index.wxml',
    from: '        open-type="share"\n        bindtap="onShareTap"',
    to: '        bindtap="onShareTap"'
  },
  // ⚠️ 玩法页**结构上根本没有** `card`（愿签卡只在祈福墙页），所以这条的旧形态
  // （"玩法分享读到 card.text"）已不可能发生 —— 判据改成更强的形态：
  // **分享必须只读 `result.share`**。注入把 title 换成 result.title，判据必须变红。
  'sheet-share-reads-card-text': {
    file: 'miniprogram/subpackages/plays/utils/ritualPlayPage.js',
    from: "      if (r && r.share && fromPlay) return { title: r.share, path }",
    to: "      if (r && fromPlay) return { title: r.title, path }"
  },
  'share-from-never-reset': {
    file: 'miniprogram/subpackages/plays/utils/ritualPlayPage.js',
    from: "      if (this.data.shareFrom) this.setData({ shareFrom: '' })",
    to: '      // 注入：不复位来源标记'
  },













  // ④ 玩法结果不留档（"可回看"落空、"今天玩过没有"永远为假）。
  'play-archive-not-saved': {
    file: 'miniprogram/subpackages/plays/utils/ritualPlayPage.js',
    from: '      archive.saveResult(id, this._dayKey, result)',
    to: '      void result'
  },
  /* ══════════════════════════════════════════════════════════════════
   * 2026-09-21「状态诚实」批次（P1-1 / P1-2 / P1-3 / P1-4 / P1-5 /
   * P2-7 / P2-8 / P2-9 / P2-11 / P2-12）—— 每条新判据都配一条注入。
   *
   * 为什么这一批必须逐条证明"会红"：审计报告的核心事实就是
   * **这些缺口都发生在守卫全绿的情况下**（判据没覆盖到那一层）。
   * 没有注入的判据 = 没人知道它会不会失败 = 等于没有。
   * ══════════════════════════════════════════════════════════════════ */










  // P1-3 顺手体检：wish_wall_play 的 targetType 又漂出 schema 声明
  'play-targettype-drift': {
    // 2026-09-21（§11.4）：失败分支的 trackBehavior 搬进玩法页工厂，锚点跟随。
    file: 'miniprogram/subpackages/plays/utils/ritualPlayPage.js',
    from: "          trackBehavior('wish_wall_play', 'play', id, { step: 'fail' })",
    to: "          trackBehavior('wish_wall_play', 'fail', id)"
  },

  // P1-4：玩法资料缓存又永久驻留（补完资料回来仍被挡）
  'play-profile-cache-sticky': {
    // 2026-09-21（§11.4）：资料缓存随玩法搬到玩法页工厂，锚点跟随。
    file: 'miniprogram/subpackages/plays/utils/ritualPlayPage.js',
    // 注入形态：拆掉**进资料页**那一处失效 —— 判据要求两处都在（`_profile = null` ≥ 2 次），
    // 少一处就必须红。`to` 特意选一个源码里**不存在**的注释（否则注入会被判成"残留"）。
    from: '      // 离开去补资料前先作废缓存：回来那次一定重新读（P1-4）\n      this._profile = null',
    to: '      // 注入：故意不作废缓存'
  },

  // P2-12：推荐失败又整行消失（弹层收掉一块）
  'reco-failure-row-dropped': {
    // 2026-09-21（§11.4）：推荐行搬到玩法页（`.rp-reco`），锚点跟随。
    file: 'miniprogram/subpackages/plays/play-qian/index.wxml',
    from: 'wx:if="{{reco || productId || recoLoading || recoFailed}}"',
    to: 'wx:if="{{reco || productId || recoLoading}}"'
  },
  // P2-12：失败不进 recoFailed（这一行留不住 + 骨架被顶掉）
  'reco-failure-not-flagged': {
    file: 'miniprogram/subpackages/plays/utils/ritualPlayPage.js',
    from: '        this.setData({ reco: null, recoLoading: false, recoFailed: true })',
    to: '        this.setData({ reco: null, recoLoading: false })'
  }
}

const INJECT = String(process.env.WISH_WALL_INJECT || '').trim()

/**
 * 若该文件是「共享模块再导出」shim，则返回其真实实现所在路径。
 *
 * 2026-09-17 全面审计 E2：分包内的重复工具已下沉到主包 `utils/`，分包里只留一句
 * `module.exports = require('…')`。断言必须读**实现**，否则会因「源码里没有那段代码」而假失败。
 */
function resolveReexport(absPath) {
  let cur = absPath
  for (let i = 0; i < 5; i += 1) {
    let src
    try { src = readFileSync(cur, 'utf8') } catch { return cur }
    const m = src.match(/^\s*module\.exports\s*=\s*require\((['"])(.+?)\1\)\s*;?\s*$/m)
    if (!m) return cur
    const next = resolve(dirname(cur), m[2])
    if (existsSync(next)) { cur = next; continue }
    if (existsSync(`${next}.js`)) { cur = `${next}.js`; continue }
    return cur
  }
  return cur
}

/**
 * 读「实现源码」：若目标是再导出 shim 则跟随到主包实现（用在**只做正则断言**的地方）。
 * 注入同样要生效，否则 `--selftest` 会出现「断言无法失败 = 守卫无效」的假绿。
 */
function readImplSource(file) {
  const requested = resolve(ROOT, file)
  const resolved = resolveReexport(requested)
  const raw = readFileSync(resolved, 'utf8')
  if (!INJECT) return raw
  const inj = INJECTIONS[INJECT]
  if (!inj) throw new Error('unknown injection ' + INJECT)
  const injAbs = resolve(ROOT, inj.file)
  // 注入声明的可能是「分包 shim 路径」或「主包实现路径」，两者都接受
  if (injAbs !== requested && injAbs !== resolved) return raw
  if (raw.indexOf(inj.from) === -1) throw new Error('injection anchor missing: ' + INJECT)
  return raw.replace(inj.from, inj.to)
}

function readSrc(file) {
  const raw = readFileSync(resolve(ROOT, file), 'utf8')
  if (!INJECT) return raw
  const inj = INJECTIONS[INJECT]
  if (!inj) throw new Error('unknown injection ' + INJECT)
  if (inj.file !== file) return raw
  if (raw.indexOf(inj.from) === -1) throw new Error('injection anchor missing: ' + INJECT)
  return raw.replace(inj.from, inj.to)
}

/**
 * 云函数目录内的**兄弟模块**（./x）按真实文件加载。
 *
 * 为什么不能只留一个「未知 require 就抛错」的桩：本函数在并行开发中会被继续扩展
 * （实测被加了 `wishSeeds.js` / `qwenText.js` 做 AI 播种）。测试若对新增兄弟模块一律抛错，
 * 就会把**别人合理的改动**误报成我的功能坏了 —— 变成假阳性守卫。
 * 现在：相对路径按真实文件递归加载；只有**非相对**（第三方包）才走调用方给的桩。
 */
function loadSibling(baseFile, id, cache) {
  const dir = baseFile.slice(0, baseFile.lastIndexOf('/'))
  const parts = `${dir}/${id}`.split('/')
  const stack = []
  for (const part of parts) {
    if (part === '.' || part === '') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  let relPath = stack.join('/')
  if (!relPath.endsWith('.js')) relPath += '.js'
  // ⚠️ 必须把「标记式 require」继续传下去：否则被加载的兄弟模块自己再 require 时会撞上
  // 默认 fallback 的 'require not stubbed'，整条加载链断在第二层（载入页面 JS 时必踩）。
  return loadCjs(relPath, {
    require: (name) => { throw new Error('unexpected require ' + name) },
    _cache: cache
  })
}

/**
 * 带相对 require 的模块必须用这个桩：harness 的默认 fallback 抛的是另一句话，
 * 会被当成真实错误直接抛出（见 loadCjs 的 catch 分支）。
 * ⚠️ wishWall.js 从 2026-09-18 起 require 了 ../config/blessTags（祈运标签解析），
 * 漏了它就会在载入期炸「require not stubbed」。
 */
const markerRequire = (id) => { throw new Error('unexpected require ' + id) }

function loadCjs(file, { require: req, _cache } = {}) {
  const cache = _cache || new Map()
  if (cache.has(file)) return cache.get(file)
  const module = { exports: {} }
  cache.set(file, module.exports)
  const fallback = req || (() => { throw new Error('require not stubbed') })
  const localRequire = (id) => {
    const name = String(id)
    // 顺序很重要：**调用方显式给的桩优先**。
    // 反过来的话，本文件的 staffGuard / qwenText 桩会被真实文件绕过，
    // 鉴权路径就会去打真实集合（我的第一版改动正是这样把测试弄红的）。
    try {
      return fallback(name)
    } catch (e) {
      const marker = `unexpected require ${name}`
      if (!e || e.message !== marker) throw e
      // 桩没覆盖到：优先按真实兄弟模块加载（兼容并行流程新增的模块），
      // 其次才是 Node 内置模块（如 qwenText.js 用到的 `https`）
      if (name.startsWith('./') || name.startsWith('../')) return loadSibling(file, name, cache)
      if (isBuiltin(name)) return nodeRequire(name)
      throw e
    }
  }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', readSrc(file))(module, module.exports, localRequire)
  cache.set(file, module.exports)
  return module.exports
}

/* ------------------------------------------------------------------ *
 * 1) 集合规则：UGC 必须只读 + 云函数写
 * ------------------------------------------------------------------ */

const ruleRaw = readFileSync(resolve(ROOT, 'cloudbase/rules/wish_wall_messages.json'), 'utf8')
const rule = JSON.parse(ruleRaw)
eq('集合规则 write 必须为 false（禁止客户端直写）', rule.write, false)
eq('集合规则 read 允许公开读（弹幕墙）', rule.read, true)
check(
  'schema 文档说明了 write:false 的原因（防绕过校验）',
  /write: false/.test(readFileSync(resolve(ROOT, 'cloudbase/schema/wish_wall_messages.md'), 'utf8'))
)

/* ------------------------------------------------------------------ *
 * 2) 客户端纯函数：文案校验 / 命中判定 / 弹幕布局
 * ------------------------------------------------------------------ */

const wish = loadCjs('miniprogram/utils/wishWall.js', { require: markerRequire })

/**
 * 载入页面 JS 并抓住 `Page({...})` 传入的对象，用于**驱动真实页面方法**做行为级断言。
 *
 * 为什么值得单独写：本轮新增的「落愿闭环 / 额度拦截 / 高亮续标」都是**行为**，
 * 只断言源码里有那行字符串证明不了它真的会跑（本项目吃过"改了但没生效"的亏）。
 * 网络、埋点、彩蛋、震动全部打桩；`wx` 要一直挂着 —— 页面方法在**调用时**读 wx，
 * 只在载入期挂会漏。
 */
function installWxStub() {
  const prev = globalThis.wx
  const toasts = []
  const noop = () => {}
  const base = {
    showToast: (o) => toasts.push((o && o.title) || ''),
    hideToast: noop,
    vibrateShort: noop,
    getStorageSync: () => '',
    setStorageSync: noop,
    removeStorageSync: noop,
    nextTick: (fn) => { if (typeof fn === 'function') fn() },
    navigateTo: noop,
    navigateBack: noop,
    pageScrollTo: noop,
    setNavigationBarTitle: noop,
    showShareMenu: noop,
    getSystemInfoSync: () => ({ statusBarHeight: 20, windowWidth: 375, platform: 'devtools' }),
    createSelectorQuery: () => ({ in: () => ({ select: () => ({ boundingClientRect: noop }), exec: noop }) }),
    cloud: { callFunction: () => Promise.resolve({ result: {} }) }
  }
  globalThis.wx = new Proxy(base, { get: (t, k) => (k in t ? t[k] : noop) })
  return { toasts, restore: () => { globalThis.wx = prev } }
}

function loadPageConfig(file) {
  const prev = {
    Page: globalThis.Page,
    Component: globalThis.Component,
    Behavior: globalThis.Behavior,
    getApp: globalThis.getApp
  }
  let captured = null
  globalThis.Page = (cfg) => { captured = cfg }
  globalThis.Component = (cfg) => { captured = cfg }
  // 页面 require 链里有 behavior 模块（`module.exports = Behavior({...})`）：
  // 不补这个全局会炸在**第二层**，现象看起来像"页面根本加载不了"
  globalThis.Behavior = (cfg) => cfg
  globalThis.getApp = () => ({ globalData: {} })
  try {
    // fallback 的约定：抛 `unexpected require <name>` 才会回落到真实兄弟模块
    loadCjs(file, {
      require: (name) => { throw new Error('unexpected require ' + name) },
      _cache: new Map()
    })
  } finally {
    globalThis.Page = prev.Page
    globalThis.Component = prev.Component
    globalThis.Behavior = prev.Behavior
    globalThis.getApp = prev.getApp
  }
  if (!captured) throw new Error('未捕获到 Page 配置: ' + file)
  return captured
}

eq('空文案被拒', wish.validateWishText('   ').ok, false)
eq('单字被拒（下限 2）', wish.validateWishText('好').ok, false)
eq('正常文案通过并归一化', wish.validateWishText('  马上  有钱 \n').text, '马上 有钱')
eq('超长文案被拒', wish.validateWishText('愿'.repeat(wish.TEXT_MAX + 1)).ok, false)
// ★ 端上预校验必须按「字」算（与服务端同一口径）。
//   30 个 emoji：按「字」= 30 → 通过；退回 `text.length`（UTF-16）= 60 → 被**误拒**。
//   2026-09-21 夜班修：服务端早已按字，端上 `utils/wishWall.js` 漏改（不在当时子代理的白名单内）。
//   注入 `client-validate-by-utf16` 会把实现退回 `text.length`，本断言必须变红。
eq('★ 端上预校验按「字」算（30 个 emoji = 30 字，不被 UTF-16 误拒）',
  wish.validateWishText('🙂'.repeat(wish.TEXT_MAX)).ok, true)
eq('★ emoji 超一个字就拒（TEXT_MAX+1 个 → 拒）',
  wish.validateWishText('🙂'.repeat(wish.TEXT_MAX + 1)).ok, false)
eq('零宽字符被剔除', wish.normalizeWishText('马\u200B上\uFEFF有'), '马上有')

check('标题命中「马上有」', wish.isWishWallProduct({ title: '黑马标本·马上有' }) === true)
check('普通藏品不命中', wish.isWishWallProduct({ title: '蓝闪蝶标本' }) === false)
check('显式 wishWallEnabled=true 命中', wish.isWishWallProduct({ title: '任意', wishWallEnabled: true }) === true)
check(
  '★ 显式 false 必须压过标题命中（改名/共用词不会误挂祈福墙）',
  wish.isWishWallProduct({ title: '马上有', wishWallEnabled: false }) === false
)

const rows = wish.buildDanmakuRows([
  { _id: 'a', text: '马上有钱' },
  { _id: 'b', text: '一夜暴富' },
  { _id: 'c', text: '' },
  { _id: 'd', text: '愿' + 'x'.repeat(wish.TEXT_MAX - 1) }
])
eq('空文案不占轨道', rows.length, 3)
check('轨道号在 [0, LANES) 内', rows.every((r) => r.lane >= 0 && r.lane < wish.LANES))
check('同轨道不重叠（延迟递增）', rows[0].delayMs < rows[2].delayMs || rows[0].lane !== rows[2].lane)

/**
 * ★ 真·同轨不重叠（上面那条对 ≤4 条恒真，正是它放行了线上事故）：
 * 把每条轨道都压满 `PER_LANE` 条，逐对断言
 *   「下一条进场时刻 ≥ 上一条进场时刻 + 上一条尾部离开右边缘所需时间」。
 * ⚠️ 规模按 `wish.LANES` **实算**（原来写死 16 条 / 每轨 4 条）：轨道数一改（4 → 6），
 * 写死的期望值就会假红——判据要表达"每条轨道被压满后的不重叠"，不是"轨道数永远是 4"。
 */
const PER_LANE = 4
const LANE_STRESS_N = wish.LANES * PER_LANE
const laneStress = wish.buildDanmakuRows(
  Array.from({ length: LANE_STRESS_N }, (_, i) => ({ _id: 's' + i, text: '马上有' + '愿'.repeat(i % 7) }))
)
eq(`压满 ${wish.LANES} 条轨道 × ${PER_LANE} 条`, laneStress.length, LANE_STRESS_N)
const overlaps = []
for (let lane = 0; lane < wish.LANES; lane += 1) {
  const inLane = laneStress.filter((r) => r.lane === lane)
  eq(`轨道 ${lane} 分到 ${PER_LANE} 条`, inLane.length, PER_LANE)
  for (let i = 1; i < inLane.length; i += 1) {
    const prev = inLane[i - 1]
    const cur = inLane[i]
    if (cur.delayMs < prev.delayMs + prev.clearMs) {
      overlaps.push(`${lane}:${prev.text}→${cur.text}(${cur.delayMs}<${prev.delayMs + prev.clearMs})`)
    }
  }
}
eq(`★ 同轨相邻两条不重叠（${LANE_STRESS_N} 条压满轨道）`, overlaps.join(' | '), '')
check(
  '★ 尾部离开右边缘的时间是「按字数算」的，不是固定间隔',
  wish.danmakuClearMs('愿'.repeat(30)) > wish.danmakuClearMs('马上有钱') * 2
)
check('每条都带上 clearMs / endAt（排期与轮播都依赖）', laneStress.every((r) => r.clearMs > 0 && r.endAt === r.delayMs + r.durationMs))
eq('一轮里只有一条 isCycleEnd', laneStress.filter((r) => r.isCycleEnd).length, 1)
eq(
  '轮末时刻 = 最后一条的结束时刻',
  wish.danmakuCycleEndMs(laneStress),
  Math.max(...laneStress.map((r) => r.endAt))
)
eq('空轮轮末为 0', wish.danmakuCycleEndMs([]), 0)
eq('不传 opts 也不崩', wish.buildDanmakuRows(null).length, 0)

/**
 * ★ 首屏预填（2026-09-19 产品真机反馈「墙面像个空框」的根因判据）
 *
 * 根因：弹幕是 `left:100%` + 全屏横穿 + **正 delay**（原为 `i*260ms`），
 * 所以 t=0 时墙面**必然是空的**，之后逐条从右侧入场 —— 首屏前 2–3 秒只有 6 条刻度线。
 * 修法：前 `LANES` 条（每条轨道恰好一条）用**负 delay** 预填，加载瞬间屏内已有内容。
 *
 * 判据钉两件事：① 恰有 LANES 条负 delay；② 它们落在**不同轨道**（否则叠成一行更难看）。
 * 注入 `danmaku-no-prefill` 会把 prefill 关掉 —— 本条必须变红（自检里跑）。
 */
const prefillRows = wish.buildDanmakuRows(
  Array.from({ length: wish.LANES * 2 }, (_, i) => ({ _id: 'p' + i, text: '马上有预填' + i }))
)
const prefilled = prefillRows.filter((r) => r.delayMs < 0)
eq('★ 首屏预填：恰有 LANES 条负 delay（加载瞬间屏内已有内容，不再是空墙）', prefilled.length, wish.LANES)
eq('★ 首屏预填：每条落在不同轨道（否则叠成一行）', new Set(prefilled.map((r) => r.lane)).size, wish.LANES)
// 2026-09-24：预填进度必须落在屏中带 —— 太靠左（旧 0.85）t=2s 就空了；太靠右又不像"已在流动"
{
  const progresses = prefilled.map((r) => {
    const d = Number(r.durationMs) || 1
    return Math.min(1, Math.max(0, -Number(r.delayMs) / d))
  })
  const lo = Math.min(...progresses)
  const hi = Math.max(...progresses)
  check(
    '★ 首屏预填进度落在 0.18–0.70（屏中错峰；>0.75 会在 2s 出图里假稀疏）',
    lo >= 0.18 && hi <= 0.70 && (hi - lo) >= 0.25,
    `progress=${progresses.map((p) => p.toFixed(2)).join('/')}`
  )
}
check(
  '★ 首屏预填不破坏「同轨不重叠」（预填只取每轨第一条）',
  prefillRows.every((r, i) => {
    const prev = prefillRows.slice(0, i).filter((p) => p.lane === r.lane).pop()
    return !prev || r.delayMs >= prev.delayMs + prev.clearMs
  })
)

// 轮次进 key：否则整批重排时同 key 不重播动画
const cyc0 = wish.buildDanmakuRows([{ _id: 'a', text: '马上有钱' }], { cycle: 0 })
const cyc1 = wish.buildDanmakuRows([{ _id: 'a', text: '马上有钱' }], { cycle: 1 })
check('★ 轮次进 key（重排才能重播动画）', cyc0[0].key !== cyc1[0].key && /#1$/.test(cyc1[0].key))
const again = wish.buildDanmakuRows([
  { _id: 'a', text: '马上有钱' },
  { _id: 'b', text: '一夜暴富' },
  { _id: 'c', text: '' },
  { _id: 'd', text: '愿' + 'x'.repeat(wish.TEXT_MAX - 1) }
])
eq('布局确定性：两次渲染完全一致', JSON.stringify(again), JSON.stringify(rows))
check(
  '匀速：长文案时长 > 短文案时长',
  wish.danmakuDurationMs('愿' + 'x'.repeat(29)) > wish.danmakuDurationMs('马上有钱')
)
check('时长有上下限兜底', wish.danmakuDurationMs('短') >= 6000 && wish.danmakuDurationMs('x'.repeat(30)) <= 26000)
eq('相对时间：刚刚', wish.formatWishTime(new Date(1000000).toISOString(), 1000000 + 30000), '刚刚')

/* ------------------------------------------------------------------ *
 * 2b) 基础内容（AI 创作）：句式闸 / 去重 / 词表轮换 / 每日一句
 *
 * 「第一批基础内容」是祈福墙不变成空墙的唯一保障。这里的每一条断言都对应
 * 一种会让墙上出现垃圾内容的缺陷：不合句式、重复、不轮换、随机。
 * ------------------------------------------------------------------ */

const seeds = loadCjs('miniprogram/cloudfunctions/manageWishWall/wishSeeds.js')

check('基线文案数量足够铺满首屏', seeds.baselineTexts().length >= 12)
check(
  '★ 基线每一条都合句式（2–30 字且以「马上有」起）',
  seeds.SEED_WISHES.every((s) => seeds.isSeedPhrase(s.text)),
  JSON.stringify(seeds.SEED_WISHES.filter((s) => !seeds.isSeedPhrase(s.text)).map((s) => s.text))
)
check('基线本身无重复', new Set(seeds.baselineTexts()).size === seeds.SEED_WISHES.length)
check('「马上有」单前缀不合格（要有具体内容）', seeds.isSeedPhrase('马上有') === false)
check('非「马上有」句式不合格', seeds.isSeedPhrase('祝你暴富') === false)

// AI 不一定吐纯 JSON：四种真实形态都要能解析出来
eq(
  '解析裸 JSON 数组',
  seeds.parseSeedTexts('["马上有星光","马上有远路"]').join(','),
  '马上有星光,马上有远路'
)
eq(
  '解析 {"list":[...]} 包装',
  seeds.parseSeedTexts('{"list":[{"text":"马上有星光"},{"wish":"马上有远路"}]}').join(','),
  '马上有星光,马上有远路'
)
eq(
  '解析围栏代码块',
  seeds.parseSeedTexts('```json\n["马上有星光"]\n```').join(','),
  '马上有星光'
)
eq(
  '解析逐行输出（含 markdown 列表符）',
  seeds.parseSeedTexts('1. 马上有星光\n- 马上有远路\n').join(','),
  '马上有星光,马上有远路'
)

// selectNewSeeds：四道闸
const picked = seeds.selectNewSeeds({
  candidates: ['祝你暴富', '马上有', '马上有星光', '马上有星光', '  马上有远路  ', 'x'.repeat(40)],
  existing: ['马上有热汤'],
  limit: 10
})
eq('★ 非句式 / 过短 / 批内重复 / 超长都被剔除', picked.join(','), '马上有星光,马上有远路')
eq('已存在的内容不再重复选中', seeds.selectNewSeeds({ candidates: ['马上有热汤'], existing: ['马上有热汤'], limit: 5 }).length, 0)
eq('limit 生效', seeds.selectNewSeeds({ candidates: ['马上有A1', '马上有B2', '马上有C3'], existing: [], limit: 2 }).length, 2)

// 灵感轮换：确定性 + 跨天变化
const inspoA = seeds.pickInspiration(seeds.baselineTexts(), { dayKey: '2026-09-16', count: 4 })
const inspoB = seeds.pickInspiration(seeds.baselineTexts(), { dayKey: '2026-09-16', count: 4 })
eq('同一天灵感完全一致（确定性，不用随机数）', inspoA.join(','), inspoB.join(','))
eq('灵感条数正确', inspoA.length, 4)
check('灵感都取自基线池', inspoA.every((t) => seeds.baselineTexts().indexOf(t) !== -1))
check(
  '跨天灵感会换一组（30 天里至少出现 2 种起点）',
  new Set(
    Array.from({ length: 30 }, (_, i) =>
      seeds.pickInspiration(seeds.baselineTexts(), { dayKey: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, count: 4 }).join(',')
    )
  ).size >= 2
)

const promptForSeed = seeds.buildSeedPrompt({ count: 6, avoid: ['马上有热汤'] })
check('提示词带上风格样本', promptForSeed.indexOf('马上有闲') !== -1)
check('提示词带上已存在清单（防重复生成）', promptForSeed.indexOf('马上有热汤') !== -1)
check('提示词声明生成条数', /生成 6 条/.test(promptForSeed))

/* ------------------------------------------------------------------ *
 * 3) 云函数：真源码加载 + stub db，跑真实分支
 * ------------------------------------------------------------------ */

const docs = []
const usersByOpenid = {
  'openid-a': { nickName: '林藏家', avatarUrl: 'cloud://a.png' }
}
let currentOpenid = 'openid-a'

function makeDb() {
  const cmd = {
    gte: (v) => ({ $gte: v, and: (other) => ({ $gte: v, $lt: other.$lt }) }),
    lt: (v) => ({ $lt: v }),
    in: (arr) => ({ $in: arr }),
    nin: (arr) => ({ $nin: arr })
  }
  const matches = (doc, where) =>
    Object.keys(where || {}).every((k) => {
      const cond = where[k]
      if (cond && Array.isArray(cond.$in)) return cond.$in.includes(doc[k])
      if (cond && Array.isArray(cond.$nin)) return !cond.$nin.includes(doc[k])
      if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
        const t = doc[k] ? new Date(doc[k]).getTime() : 0
        if (cond.$gte != null && t < new Date(cond.$gte).getTime()) return false
        if (cond.$lt != null && t >= new Date(cond.$lt).getTime()) return false
        return true
      }
      return doc[k] === cond
    })
  return {
    command: cmd,
    serverDate: () => new Date().toISOString(),
    collection(name) {
      if (name === 'users') {
        return {
          where(w) { this._w = w; return this },
          limit() { return this },
          async get() {
            const openid = this._w && this._w._openid
            const row = usersByOpenid[openid]
            return { data: row ? [{ _openid: openid, ...row }] : [] }
          }
        }
      }
      if (name !== 'wish_wall_messages') throw new Error('unexpected collection ' + name)
      const state = { where: null, limit: 50, orderBy: [] }
      return {
        where(w) { state.where = w; return this },
        orderBy() { return this },
        limit(n) { state.limit = n; return this },
        async get() {
          let out = docs.filter((d) => matches(d, state.where))
          out = out.slice(0, state.limit)
          return { data: out.map((d) => ({ ...d })) }
        },
        async count() {
          return { total: docs.filter((d) => matches(d, state.where)).length }
        },
        doc(id) {
          return {
            async update({ data }) {
              const hit = docs.find((d) => d._id === id)
              if (!hit) throw new Error('not exist')
              Object.assign(hit, data)
              return { stats: { updated: 1 } }
            },
            async remove() {
              const i = docs.findIndex((d) => d._id === id)
              if (i < 0) throw new Error('not exist')
              docs.splice(i, 1)
              return { stats: { removed: 1 } }
            }
          }
        },
        async add({ data }) {
          const _id = 'w' + (docs.length + 1)
          docs.push({ _id, ...data })
          return { _id }
        }
      }
    }
  }
}

const db = makeDb()
const cloudStub = {
  init() {},
  DYNAMIC_CURRENT_ENV: 'env',
  database: () => db,
  getWXContext: () => ({ OPENID: currentOpenid }),
  openapi: {
    security: {
      async msgSecCheck() {
        return { result: { suggest: 'pass' } }
      }
    }
  }
}

/**
 * AI 调用的桩：可切三种行为（正常返回 / 抛错 / 返回跑偏内容）。
 * 真发网络请求会让守卫变成"看 DashScope 脸色"，与「守卫必须确定性」冲突。
 */
const qwenStub = {
  raw: '["马上有星光","马上有远路"]',
  mode: 'ok',
  async callQwenText() {
    if (qwenStub.mode === 'throw') throw new Error('AI 调用失败（桩）')
    return qwenStub.raw
  }
}

/** 云函数内部相对 require：staffGuard / AI 调用 / 内容安全 用桩替掉 */
const fn = loadCjs('miniprogram/cloudfunctions/manageWishWall/index.js', {
  require: (id) => {
    if (id === 'wx-server-sdk') return cloudStub
    if (id === './wishSeeds') return seeds
    if (id === './qwenText') return qwenStub
    if (id === './staffGuard') {
      return {
        ROLE_MANAGER: 'manager',
        assertStaff: async (database, openid, opts) => {
          const staff = process.env.WISH_WALL_STAFF === '1'
          if (!staff) return { ok: false, code: 'FORBIDDEN', msg: '无权限' }
          return { ok: true, actor: { openid, name: '店长' } }
        }
      }
    }
    throw new Error('unexpected require ' + id)
  }
})

// 3a. 发布：服务端取昵称、状态与归属
//     刻意带上伪造的 nickname/avatar —— 必须被服务端丢弃（否则可冒充他人发弹幕）
const postRes = await fn.main({ action: 'post', text: '  马上有闲  ', nickname: '冒充者', avatar: 'cloud://evil.png' })
eq('发布成功', postRes.success, true)
const created = docs[0]
eq('落库文案已归一化', created.text, '马上有闲')
eq('落库状态为 visible', created.status, 'visible')
eq('落库归属 openid', created._openid, 'openid-a')
eq('落库昵称来自 users（客户端伪造值被丢弃）', created.nickname, '林藏家')
eq('落库头像来自 users（客户端伪造值被丢弃）', created.avatar, 'cloud://a.png')
check('落库不与置顶混淆', created.pinned === false)
eq('落库作用域', created.productKey, 'mashangyou')

// 3b. 长度与登录
eq('过短文案被拒', (await fn.main({ action: 'post', text: '好' })).success, false)
const noLogin = { ...cloudStub, getWXContext: () => ({ OPENID: '' }) }
// 用 Source 级替换验证「未登录」分支：直接检查源码里的守卫存在
check(
  '未登录分支存在（post 前置 openid 判定）',
  /if \(!openid\) return \{ success: false, msg: '请先登录' \}/.test(readSrc('miniprogram/cloudfunctions/manageWishWall/index.js'))
)

// 3c. 频控：10 秒内第二条必须被拦（TOO_FAST）
const second = await fn.main({ action: 'post', text: '再来一条心愿' })
eq('间隔内第二条被频控拦下', second.success, false)
eq('频控返回可辨识 code', second.code, 'TOO_FAST')

// 3d. 公开列表只回 visible，且不泄露 openid
docs.push({ _id: 'wh', _openid: 'openid-b', productKey: 'mashangyou', text: '被隐藏的', status: 'hidden', createTime: new Date().toISOString() })
const listRes = await fn.main({ action: 'list' })
eq('公开列表成功', listRes.success, true)
eq('公开列表只含 visible（1 条）', listRes.list.length, 1)
check('公开列表不含 hidden 文案', !listRes.list.some((r) => r.text === '被隐藏的'))
check('公开列表不暴露 openid', !('openid' in listRes.list[0]), JSON.stringify(listRes.list[0]))
check('公开列表不暴露 status 字段', !('status' in listRes.list[0]))

// 3e. 管理端：默认无权限
process.env.WISH_WALL_STAFF = '0'
const denied = await fn.main({ action: 'staffList' })
eq('非店长读取管理列表被拒', denied.success, false)

// 3f. 管理端：全部状态可见（含 hidden），可隐藏/恢复/置顶/删除
process.env.WISH_WALL_STAFF = '1'
const staffRes = await fn.main({ action: 'staffList' })
eq('管理列表成功', staffRes.success, true)
eq('管理列表含全部 2 条（含 hidden）', staffRes.list.length, 2)
check('管理列表带 status 字段', staffRes.list.every((r) => r.status === 'visible' || r.status === 'hidden'))
const hiddenOnly = await fn.main({ action: 'staffList', status: 'hidden' })
eq('可按 hidden 过滤', hiddenOnly.list.length, 1)

const hideRes = await fn.main({ action: 'staffSetStatus', id: 'w1', status: 'hidden' })
eq('隐藏成功', hideRes.success, true)
eq('状态已落库', docs.find((d) => d._id === 'w1').status, 'hidden')
const afterHide = await fn.main({ action: 'list' })
eq('隐藏后公开列表为空', afterHide.list.length, 0)

eq('非法状态被拒', (await fn.main({ action: 'staffSetStatus', id: 'w1', status: 'deleted' })).success, false)
const pinRes = await fn.main({ action: 'staffSetStatus', id: 'w1', status: 'visible', pinned: true })
eq('置顶成功', pinRes.success, true)
eq('置顶已落库', docs.find((d) => d._id === 'w1').pinned, true)

const statsRes = await fn.main({ action: 'staffStats' })
eq('统计 visible', statsRes.counts.visible, 1)
eq('统计 hidden', statsRes.counts.hidden, 1)

const rmRes = await fn.main({ action: 'staffRemove', id: 'wh' })
eq('删除成功', rmRes.success, true)
eq('删除后剩余 1 条', docs.length, 1)

/* ------------------------------------------------------------------ *
 * 3g) 基础内容播种：AI 优先、基线兜底、永不重复、必须超管
 * ------------------------------------------------------------------ */

// 归一化必须与入口同口径 —— 两份实现漂了，"去重"就会漏
const trickyTexts = ['  马上  有 光 ', '马\u200B上\uFEFF有', '马上有\n热汤', '马上有\t暖', '，马上有缘。']
check(
  '★ 基础内容模块与云函数入口归一化同口径',
  trickyTexts.every((t) => seeds.normalizeSeedText(t) === fn.normalizeWishText(t)),
  trickyTexts.map((t) => `${JSON.stringify(t)} → ${JSON.stringify(seeds.normalizeSeedText(t))}`).join(' | ')
)

const seedCount = () => docs.filter((d) => d.source === 'ai' || d.source === 'seed').length

// 非超管不得播种（AI 批量写入公开墙面）
process.env.WISH_WALL_STAFF = '0'
const seedDenied = await fn.main({ action: 'staffSeedAi', count: 4 })
eq('★ 非店长播种被拒', seedDenied.success, false)
eq('被拒时未写入任何内容', seedCount(), 0)

process.env.WISH_WALL_STAFF = '1'

// AI 挂掉 → 仍要拿得出第一批内容（基线兜底）
process.env.DASHSCOPE_API_KEY = 'test-key'
qwenStub.mode = 'throw'
const seedFallback = await fn.main({ action: 'staffSeedAi', count: 4 })
eq('AI 抛错时播种仍成功', seedFallback.success, true)
eq('★ AI 挂掉时全部由人工基线兜底', seedFallback.counts.ai, 0)
eq('兜底条数正确', seedFallback.counts.baseline, 4)
check('AI 错误被如实回报（运营要知道 AI 没生效）', String(seedFallback.aiError).length > 0)
check('兜底内容标注为基线来源', docs.filter((d) => d.source === 'seed').every((d) => d.aiGenerated === false))
check('兜底内容署名馆方，不属于任何用户', docs.filter((d) => d.source === 'seed').every((d) => d._openid === '' && d.nickname === '山海造物'))
check('兜底内容都是合法句式', docs.filter((d) => d.source === 'seed').every((d) => seeds.isSeedPhrase(d.text)))

// AI 正常 → 跑偏的丢掉，不足的用基线补齐
qwenStub.mode = 'ok'
qwenStub.raw = JSON.stringify(['马上有星光', '祝你暴富', '马上有星光', '马上有远路'])
const seedAi = await fn.main({ action: 'staffSeedAi', count: 4 })
eq('AI 播种成功', seedAi.success, true)
eq('★ 跑偏 + 批内重复被剔除，只留 2 条', seedAi.counts.ai, 2)
eq('不足部分由基线补齐', seedAi.counts.baseline, 2)
eq('AI 条目来源标注正确', docs.filter((d) => d.source === 'ai').length, 2)
check('AI 条目标记 aiGenerated', docs.filter((d) => d.source === 'ai').every((d) => d.aiGenerated === true))
eq('AI 条目批次号已写', docs.filter((d) => d.source === 'ai').every((d) => d.seedBatch === seeds.SEED_BATCH), true)
eq('跑偏内容没有落库', docs.some((d) => d.text === '祝你暴富'), false)
eq('批内重复只落一条', docs.filter((d) => d.text === '马上有星光').length, 1)

// 幂等：同一批 AI 内容再次生成，不得重复上墙
const seedAgain = await fn.main({ action: 'staffSeedAi', count: 4 })
eq('★ 重复内容不再上墙（第二次 AI 产出全被去重）', seedAgain.counts.ai, 0)
eq('第二次仍由基线补齐', seedAgain.success, true)
eq('「马上有星光」始终只有一条', docs.filter((d) => d.text === '马上有星光').length, 1)

// 基线也被耗尽且不用 AI → 明确拒绝，而不是重复铺一遍
process.env.DASHSCOPE_API_KEY = ''
let exhausted = null
for (let i = 0; i < 5; i += 1) {
  exhausted = await fn.main({ action: 'staffSeedAi', count: 12 })
  if (!exhausted.success) break
}
eq('★ 无新内容时明确拒绝（不重复铺墙）', exhausted.success, false)
eq('拒绝码可辨识', exhausted.code, 'NO_NEW_SEED')

// 播种后公开列表：基础内容带 source，且不泄露 openid
const listAfterSeed = await fn.main({ action: 'list', limit: 30 })
eq('公开列表返回灵感文案', Array.isArray(listAfterSeed.inspiration) && listAfterSeed.inspiration.length > 0, true)
check('灵感文案都是合法句式', listAfterSeed.inspiration.every((t) => seeds.isSeedPhrase(t)))
check(
  '★ 公开列表仍不暴露 openid / status（新增字段不得破最小暴露）',
  listAfterSeed.list.every((r) => !('openid' in r) && !('status' in r))
)
check(
  // 字段仍要下发（用于统计与将来"真人馆方回复"的区分），但渲染层**不再**用它盖章
  '公开列表带 source（数据侧保留来源，渲染层已不标「馆方」）',
  listAfterSeed.list.some((r) => r.source === 'ai' || r.source === 'seed')
)

/* ------------------------------------------------------------------ *
 * 3h) 公开列表混排（2026-09-30 产品负责人点名）：置顶最前 → 真实心愿优先 →
 *     预埋按 15 分钟时段轮流补位并穿插；隐藏不上墙；全部预埋一天内轮遍
 * ------------------------------------------------------------------ */
{
  const compose = fn.composeWallList
  check('云函数导出 composeWallList（混排规则可断言）', typeof compose === 'function')
  const T0 = Date.UTC(2026, 8, 30, 2, 0, 0)
  const at = (ms) => new Date(ms).toISOString()
  const mkReal = (n) => Array.from({ length: n }, (_, i) => ({ _id: `r${i}`, text: `真实${i}`, status: 'visible', source: 'user', pinned: false, createTime: at(T0 - i * 60000) }))
  const seedPool = Array.from({ length: 84 }, (_, i) => ({ _id: `s${i}`, text: `预埋${i}`, status: 'visible', source: i % 7 ? 'seed' : 'ai', pinned: false, createTime: at(T0 - 86400000 * 3) }))
  const pinnedReal = { _id: 'rp', text: '置顶真实', status: 'visible', source: 'user', pinned: true, createTime: at(T0 - 86400000 * 10) }
  const hiddenReal = { _id: 'rh', text: '隐藏真实', status: 'hidden', source: 'user', pinned: false, createTime: at(T0 + 1000) }
  const hiddenSeed = { _id: 'sh', text: '隐藏预埋', status: 'hidden', source: 'seed', pinned: false, createTime: at(T0) }
  const isSeed = (d) => d.source === 'seed' || d.source === 'ai'
  const run = (real, seedsIn, limit, nowMs) => compose(real, seedsIn, { limit, nowMs })

  // A. 真实心愿充足（40 条 + 1 置顶）：墙 30 = 置顶 1 + 预埋 floor(29/4)=7 + 真实最新 22
  const realMany = mkReal(40).concat([pinnedReal, hiddenReal])
  const wallA = run(realMany, seedPool.concat([hiddenSeed]), 30, T0)
  eq('★ 混排：墙面条数 = limit', wallA.length, 30)
  eq('★ 混排：置顶仍在最前', wallA[0] && wallA[0]._id, 'rp')
  const realA = wallA.slice(1).filter((d) => !isSeed(d))
  eq('★ 混排：真实心愿充足时预埋只留 1/4 位（7 格）', wallA.filter(isSeed).length, 7)
  eq('★ 混排：真实心愿取最新 22 条且按时间倒序', realA.map((d) => d._id).join(','), mkReal(22).map((d) => d._id).join(','))
  check('★ 混排：隐藏的真实/预埋都不上墙（即使查询条件漏了 status）', !wallA.some((d) => d.status === 'hidden'))
  eq('混排：无重复条目', new Set(wallA.map((d) => d._id)).size, wallA.length)
  check('★ 混排：预埋穿插（首条非置顶是真实心愿，且没有两条预埋相邻）',
    !isSeed(wallA[1]) && wallA.every((d, i) => !(i > 0 && isSeed(d) && isSeed(wallA[i - 1]))))

  // B. 真实心愿不足：空位全部由预埋补齐，真实心愿一条不少
  const wallB = run(mkReal(3), seedPool, 30, T0)
  eq('★ 混排：真实不足时预埋补齐到 limit', wallB.length, 30)
  eq('★ 混排：真实不足时真实心愿全部上墙', wallB.filter((d) => !isSeed(d)).length, 3)
  check('混排：真实不足时首条仍是真实心愿', wallB[0] && !isSeed(wallB[0]))

  // C. 首页 12 条：前 8 条（跑马灯可见段）真实与预埋都有
  const home = run(realMany, seedPool, 12, T0)
  eq('混排：首页 12 条中预埋 2 格', home.filter(isSeed).length, 2)
  const head8 = home.slice(0, 8)
  check('★ 混排：首页跑马灯前 8 条真实与预埋穿插', head8.some(isSeed) && head8.filter((d) => !isSeed(d)).length >= 5)

  // D. 轮换：一天 96 个时段内，墙面与首页都能轮遍全部 84 条预埋；同时段确定、跨时段变化
  const ROT = fn.SEED_ROTATE_MS
  for (const [label, limit] of [['墙面', 30], ['首页', 12]]) {
    const seen = new Set()
    for (let k = 0; k < 96; k += 1) run(realMany, seedPool, limit, T0 + k * ROT).filter(isSeed).forEach((d) => seen.add(d._id))
    eq(`★ 混排：${label}一天内轮遍全部预埋`, seen.size, 84)
  }
  const slotStart = Math.floor(T0 / ROT) * ROT
  eq('★ 混排：同一时段内结果一致（确定性，所有人看到同一面墙）',
    run(realMany, seedPool, 30, slotStart + 1).map((d) => d._id).join(','),
    run(realMany, seedPool, 30, slotStart + ROT - 1).map((d) => d._id).join(','))
  const seedIdsAt = (ms) => run(realMany, seedPool, 30, ms).filter(isSeed).map((d) => d._id).join(',')
  check('混排：相邻时段预埋窗口不同', seedIdsAt(slotStart) !== '' && seedIdsAt(slotStart) !== seedIdsAt(slotStart + ROT))
  eq('混排：输入顺序不影响结果', run(realMany.slice().reverse(), seedPool.slice().reverse(), 30, T0).map((d) => d._id).join(','), wallA.map((d) => d._id).join(','))

  // E. 置顶的预埋同样最前；两边都不足时照单全收
  const pinnedSeed = { ...seedPool[5], _id: 'sp', pinned: true, createTime: at(T0 - 5) }
  const wallE = run(mkReal(2), seedPool.slice(0, 3).concat([pinnedSeed]), 30, T0)
  eq('混排：置顶预埋也在最前', wallE[0] && wallE[0]._id, 'sp')
  eq('混排：两边都不足时全部上墙', wallE.length, 6)

  // F. 查询层：两次查询都必须带 status 过滤（第一道闸；composeWallList 的过滤是第二道）
  const listSrc = readSrc('miniprogram/cloudfunctions/manageWishWall/index.js')
  check('★ 混排：真实心愿查询带 status=visible 且排除预埋来源',
    listSrc.includes('.where({ productKey, status: STATUS_VISIBLE, source: _.nin(SEED_SOURCES) })'))
  check('★ 混排：预埋池查询带 status=visible 且只取预埋来源',
    listSrc.includes('.where({ productKey, status: STATUS_VISIBLE, source: _.in(SEED_SOURCES) })'))

  // G. 端到端（内存库）：隐藏预埋不上墙、真实心愿在前
  docs.push({ _id: 'mixu1', _openid: 'openid-m', productKey: 'mashangyou', text: '混排真实一', status: 'visible', source: 'user', pinned: false, createTime: new Date().toISOString() })
  docs.push({ _id: 'mixs1', _openid: '', productKey: 'mashangyou', text: '混排隐藏预埋', status: 'hidden', source: 'seed', pinned: false, createTime: new Date().toISOString() })
  const e2e = await fn.main({ action: 'list', limit: 30 })
  eq('混排端到端：成功', e2e.success, true)
  check('★ 混排端到端：隐藏预埋不上墙', !e2e.list.some((r) => r.text === '混排隐藏预埋'))
  check('混排端到端：真实心愿在墙上且有预埋补位', e2e.list.some((r) => r.text === '混排真实一') && e2e.list.some((r) => r.source === 'seed' || r.source === 'ai'))
  const idxOf = docs.findIndex((d) => d._id === 'mixs1'); if (idxOf >= 0) docs.splice(idxOf, 1)
  const idxU = docs.findIndex((d) => d._id === 'mixu1'); if (idxU >= 0) docs.splice(idxU, 1)
}

/* ------------------------------------------------------------------ *
 * 4) 开关：关闭时 C 端不得发请求 / 云函数默认关
 * ------------------------------------------------------------------ */

const flagSrc = readSrc('miniprogram/cloudfunctions/getContentDisplayFlags/index.js')
check('云函数默认值含 showMaShangYou', /showMaShangYou: false/.test(flagSrc))
check('云函数 normalize 用 === true（缺配置即关）', /showMaShangYou: src\.showMaShangYou === true/.test(flagSrc))
check('saveFlags 显式透传该字段（漏了保存就丢）', /showMaShangYou: incoming\.showMaShangYou/.test(flagSrc))

const clientFlagSrc = readSrc('miniprogram/utils/contentDisplayFlags.js')
check('客户端 normalize 同口径', /showMaShangYou: src\.showMaShangYou === true/.test(clientFlagSrc))
check('客户端导出关闭提示', /toastWishWallClosed/.test(clientFlagSrc))


// ⚠️ 2026-09-21（P2-10）判据目标已改：原来是"`if (!allowed) return` 必须**紧邻** `await this.refresh()`"，
// 而本批在两者之间插入了「取云端档案」（只在门禁确认为开后执行）。
// 现在钉的是**顺序语义**：提前返回 → 取档案 → 刷新；即"关闭时什么都不发"这件的**结构**保证。
// 真正的行为保证另有两条（见"关闭态零网络请求"那组，直接驱动 applyGate 数调用次数）。


/* ------------------------------------------------------------------ *
 * 5) 超管工作台-内容模块：**心愿签**入口行 + 治理入口都在
 *    2026-10-13（产品负责人点名）：祈福墙已全面升级为「马上有 · 心愿签」，
 *    面板里不得再出现两个历史注册钩子开关（连灯记录云存 / 功德证）—— 见 §14 / §15 的「不得复活」断言。
 * ------------------------------------------------------------------ */

const subviews = readSrc('miniprogram/subpackages/manager/manager/workspace/_subviews.wxml')
check('内容开关面板出现「马上有 · 心愿签」行', /data-field="showMaShangYou"/.test(subviews))
check('面板内含心愿签内容管理入口', /goWishWallManage/.test(subviews))
const managerSrc = readSrc('miniprogram/subpackages/manager/manager/managerPageConfig.js')
check('管理页跳转已实现', /goWishWallManage\(\) \{/.test(managerSrc))
check('管理页加载归一化含该字段', /showMaShangYou: flags\.showMaShangYou === true/.test(managerSrc))
const managePage = readSrc('miniprogram/subpackages/manager/wish-wall/index.js')
check('管理页要求超管', /guardStaffPage\('super_admin'\)/.test(managePage))
check('管理页默认「全部」状态（看得到 hidden）', /id: '', label: '全部'/.test(managePage))

/* ------------------------------------------------------------------ *
 * 5b) 内容开关面板：入口可达性 + 字段齐备
 *
 * 起因是一次真实反馈：「超管工作台 → 内容模块」找不到「祈福墙内容管理」。
 * 实测入口只在 tab 16「内容开关」内，而原记录口径写的是「内容模块」(tab 9)。
 * 这一节钉死两件事：
 *   ① 治理行必须在「内容开关」面板内，且「内容管理」也要有直达入口；
 *   ② 小程序端必须携带云函数 save 读取的**全部**字段 —— 缺一个，保存时它就被重置为默认值
 *      （排查入口时顺带查出的真缺陷，见交付记录 §11.2）。
 * ------------------------------------------------------------------ */

// ① 可达性
// 断言必须匹配**真实的绑定**（`bindtap="..."`），不能只匹配裸词 ——
// 注释里也写着这个函数名，只搜裸词的话"入口被摘掉"照样通过（本轮就被自己抓到一次）。
const ENTRY_BIND = 'bindtap="goWishWallManage"'
const tab16At = subviews.indexOf('curTab===16')
const entryInTab16At = tab16At === -1 ? -1 : subviews.indexOf(ENTRY_BIND, tab16At)
check('内容开关面板 (tab 16) 存在', tab16At !== -1)
check(
  '★ 祈福墙治理行确实在「内容开关」面板内（不是漂在别处）',
  entryInTab16At !== -1 && subviews.slice(tab16At, entryInTab16At).indexOf('{{curTab===') === -1
)
const tab9Area = subviews.slice(subviews.indexOf('curTab===9'), subviews.indexOf('curTab===10'))
check('★「内容管理」(tab 9) 也有祈福墙直达入口（反馈的落点）', tab9Area.indexOf(ENTRY_BIND) !== -1)

const hubWxml = readSrc('miniprogram/subpackages/manager/manager/index.wxml')
// 磁贴名由产品定：**短名「开关」**（曾按"可发现性"改成全称「内容开关」，产品要求改回）。
// 所以这里锁两件事：① 名字就是产品口径的「开关」，别再反复来回改；
// ② 门禁仍是 menu.contentFlags。可发现性不靠磁贴名，靠 tab 9 的直达条（见上一节断言）。
check('工作台有 tab 16「开关」磁贴（产品口径短名）', /data-idx="16"[\s\S]{0,400}<text(?: class="hub-cell-name")?>开关<\/text>/.test(hubWxml))
check(
  'tab 16 磁贴仍受 menu.contentFlags 门禁（不能顺手把门禁删了）',
  /wx:if="\{\{menu\.contentFlags\}\}"[\s\S]{0,120}data-idx="16"/.test(hubWxml)
)

// ② 字段齐备（结构一致性：云函数 save 读什么，小程序端就必须带什么）
const flagFnSrc = readSrc('miniprogram/cloudfunctions/getContentDisplayFlags/index.js')
const saveBlock = /const flags = normalizeFlags\(\{([\s\S]*?)\}\)/.exec(flagFnSrc)
const saveFields = saveBlock
  ? Array.from(saveBlock[1].matchAll(/\b(\w+):\s*incoming\.\1/g)).map((m) => m[1])
  : []
const namesIn = (block) => Array.from(String(block || '').matchAll(/^\s*([A-Za-z_]\w*):/gm)).map((m) => m[1])

const mgrLoadBlock = /contentFlagsFromDefault: !!result\.default,\s*contentFlags: \{([\s\S]*?)\n\s{8}\}/.exec(managerSrc)
const mgrLoadFields = namesIn(mgrLoadBlock && mgrLoadBlock[1])
const mgrDefaultsBlock = /contentFlags: \{\n([\s\S]*?)\n {4}\},/.exec(managerSrc)
const mgrDefaultFields = namesIn(mgrDefaultsBlock && mgrDefaultsBlock[1])

check('能解析出云函数 saveFlags 的字段表（≥16）', saveFields.length >= 16, `got ${saveFields.length}`)
check('能解析出小程序端 load 归一化字段（≥16）', mgrLoadFields.length >= 16, `got ${mgrLoadFields.length}`)
check('能解析出小程序端 data 默认字段（≥16）', mgrDefaultFields.length >= 16, `got ${mgrDefaultFields.length}`)
const missingOnLoad = saveFields.filter((f) => mgrLoadFields.indexOf(f) === -1)
const missingOnDefault = saveFields.filter((f) => mgrDefaultFields.indexOf(f) === -1)
check(
  '★ 小程序端 load 归一化必须覆盖云函数 save 的全部字段（缺一个 = 保存时被重置为默认）',
  missingOnLoad.length === 0,
  missingOnLoad.join(',')
)
check(
  '★ 小程序端 data 默认值同样必须齐（读开关失败时保存也不得抹字段）',
  missingOnDefault.length === 0,
  missingOnDefault.join(',')
)

/* ------------------------------------------------------------------ *
 * 5c) 开关生效链路：弹窗文案限长 + SWR 新鲜值必须被接住
 *
 * 起因是第二次实测反馈：① 点「AI 生成一批心愿」没反应；② 开关开了但详情页没有入口。
 * 两者都是**静默失败**（不报错、不失败），只能靠断言钉住：
 *   ① 微信 `showModal` 的 confirmText/cancelText **最多 4 个字符**，超了弹窗直接失败；
 *      不传 fail 回调时既无弹窗也无报错 → 用户看到的就是「点了没反应」。
 *   ② `fetchContentDisplayFlags` 走 SWR：缓存命中时**立刻返回缓存值**，新鲜值只在后台回填
 *      （TTL 10 分钟 / 陈旧窗口 24 小时）。只读一次返回值 = 把新值丢掉。
 * ------------------------------------------------------------------ */

// ① 弹窗文案限长 + 失败可见
const seedModalBlock = managePage.slice(managePage.indexOf('seedAi() {'), managePage.indexOf('async doSeedAi'))
const modalTexts = Array.from(seedModalBlock.matchAll(/(?:confirmText|cancelText)\s*:\s*'([^']*)'/g)).map((m) => m[1])
check('能取到 seed 弹窗的按钮文案', modalTexts.length > 0, JSON.stringify(modalTexts))
check(
  '★ seed 弹窗按钮文案 ≤4 字（微信硬限制；超了 showModal 静默失败 = 点了没反应）',
  modalTexts.every((t) => t.length <= 4),
  modalTexts.map((t) => `${t}(${t.length})`).join(' ')
)
check('★ seed 弹窗补了 fail 回调（弹窗失败必须可见，不得静默）', /fail\s*:/.test(seedModalBlock))

// ② SWR 新鲜值必须被接住
const detailPageSrc = readSrc('miniprogram/subpackages/feature/detail/index.js')
check(
  '★ 详情页接住开关的 SWR 后台刷新（否则开关打开后最长 ~24h 看不到入口）',
  // 用 `\bonUpdate\s*:` 而不是裸词：`__onUpdateRemoved` 里也含 "onUpdate"，
  // 只搜裸词的话"改名绕开"照样通过（本轮又被自己抓到一次）。
  /fetchContentDisplayFlags\(\{[\s\S]{0,120}?\bonUpdate\s*:/.test(detailPageSrc)
)
check('详情页开关应用收成单一入口 applyDisplayFlags', /applyDisplayFlags\(flags\)/.test(detailPageSrc))


check('★ 保存开关后本机 C 端缓存立刻失效', /invalidateContentDisplayFlags\(\)/.test(managerSrc))

// ③ 「先改本地、点保存才写云端」必须显式提示，否则拨完开关会以为已经生效
check('开关面板显示「未保存的改动」提示', /class="cfg-dirty"[\s\S]{0,160}contentFlagsDirty/.test(subviews))
check('拨动开关即标脏', /onContentFlagToggle[\s\S]{0,400}contentFlagsDirty: true/.test(managerSrc))
check(
  '读开关与保存成功后都清零脏标记（≥2 处 contentFlagsDirty: false）',
  (managerSrc.match(/contentFlagsDirty: false/g) || []).length >= 2
)

/* ------------------------------------------------------------------ *
 * 5d) 云函数版本漂移：报错要让运营知道"该部署"，而不是把原始文案丢出去
 *
 * 实测第三次反馈：点「AI 生成一批心愿」弹「未知 action: staffSeedAi」——
 * 客户端是新的、云函数是旧的（本机源码有该 action，线上没有）。
 * 这类漂移在本仓是**复发型事故**（历史上有过"129 个函数里 30 个跑旧代码"）。
 * 断言按**代码里的正则字面量**匹配：注释里也写着 "未知 action"，只搜裸词会假通过。
 * ------------------------------------------------------------------ */

// 2026-09-17 E2：该模块已下沉主包，分包只留再导出 shim → 断言要读实现
const memberScanSrc = readImplSource('miniprogram/subpackages/manager/utils/memberScan.js')
check(
  '★「未知 action」映射为「云函数版本过旧」（不把原始文案丢给运营）',
  /\/未知 action\/\.test\([\s\S]{0,120}云函数版本过旧/.test(memberScanSrc)
)
const deployScriptSrc = readSrc('miniprogram/scripts/deploy-drifted.sh')
check(
  '★ 漂移部署脚本的复比只针对本次目标（否则单函数部署要下载全部 ~130 个函数，实测被拖超时）',
  /node "\$CHECKER" \$DRIFT --json > "\$AFTER_JSON"/.test(deployScriptSrc)
)


/* ------------------------------------------------------------------ *
 * 6) 仪式与彩蛋：进页彩蛋只弹一次 / 每日一句确定性 / 全站拓展预留
 *
 * 这一节守的是「惊喜不能变成骚扰、仪式不能变成随机」这两件事 ——
 * 它们平时不会报错，只会让体验悄悄变差，所以必须由断言钉住。
 * ------------------------------------------------------------------ */

// 小程序全局对象桩：彩蛋与仪式只碰本地存储与 toast
const memStore = {}
globalThis.wx = {
  getStorageSync: (k) => memStore[k],
  setStorageSync: (k, v) => { memStore[k] = v },
  removeStorageSync: (k) => { delete memStore[k] },
  showToast: () => {},
  vibrateShort: () => {}
}


// 路由桩：只用来驱动 utils/easterEgg 的进页触发判定（工具本身仍在全站使用）。
//   ⚠️ 注册表 config/easterEggs.js 里吉量 / 驳 / 騊駼 / 鹿蜀 仍挂在旧墙路由与旧墙事件上 —— 旧墙退场后它们在产品里已无法触发，
//   去留属产品决定（博物笔记收录总数会变），见 docs 页面重置评估 A3。
globalThis.getCurrentPages = () => [{ route: 'subpackages/feature/wish-wall/index' }]
const eggConfig = loadCjs('miniprogram/config/easterEggs.js')
const egg = loadCjs('miniprogram/utils/easterEgg.js', {
  require: (id) => {
    if (id === '../config/easterEggs') return eggConfig
    throw new Error('unexpected require ' + id)
  }
})


// —— 注册表 ——
const jiliang = eggConfig.EGGS.find((e) => e.id === 'jiliang')
const bo = eggConfig.EGGS.find((e) => e.id === 'bo')

check('注册了「吉量」进页彩蛋', !!jiliang && jiliang.triggers[0].type === 'pageEnter')

check('注册了「驳」落愿彩蛋', !!bo && bo.triggers[0].type === 'wishPosted')
check('彩蛋 id 不重复', new Set(eggConfig.EGGS.map((e) => e.id)).size === eggConfig.EGGS.length)
check(
  '新彩蛋没有挂到支付/下单/退款路径（注册表约定）',
  ['jiliang', 'bo'].every((id) => {
    const e = eggConfig.EGGS.find((x) => x.id === id)
    return (e.triggers || []).every((t) => (t.pages || []).every((p) => !/pay|order|checkout|refund/.test(p)))
  })
)

// —— 触发匹配 ——
check(
  'triggerMatches：类型 + 路由都对才命中',
  egg.triggerMatches({ type: 'pageEnter', pages: ['a'] }, { type: 'pageEnter', route: 'a' }) === true
)
check(
  'triggerMatches：路由不符不命中',
  egg.triggerMatches({ type: 'pageEnter', pages: ['a'] }, { type: 'pageEnter', route: 'b' }) === false
)
check(
  'triggerMatches：类型不符不命中',
  egg.triggerMatches({ type: 'wishPosted', pages: ['a'] }, { type: 'pageEnter', route: 'a' }) === false
)
eq(
  'pageEnter / wishPosted / lampStreak / wishCount 属于「自动触发」',
  egg.AUTO_TRIGGER_TYPES.join(','),
  'pageEnter,wishPosted,lampStreak,wishCount'
)

// —— 进页彩蛋：首次弹，第二次不弹 ——
const firstEnter = egg.tryPageEnter({})
eq('★ 首次进入祈福墙触发「吉量」', firstEnter && firstEnter.egg.id, 'jiliang')
eq('首次触发标记 firstTime', firstEnter && firstEnter.firstTime, true)
eq('★ 第二次进入不再重复弹出（自动彩蛋只弹一次）', egg.tryPageEnter({}), null)
eq('已拾得状态已持久化', egg.isDiscovered('jiliang'), true)
check('主动重看仍可用（用户主动触发的语义不变）', !!egg.tryTrigger('jiliang', { source: 'longPress' }))
eq('博物笔记收录了新增两条', egg.listCatalog().filter((e) => e.id === 'jiliang' || e.id === 'bo').length, 2)

// —— 落愿彩蛋 ——
const firstPost = egg.tryWishPosted({})
eq('★ 首次许愿成功触发「驳」', firstPost && firstPost.egg.id, 'bo')
eq('第二次许愿不再重复弹出', egg.tryWishPosted({}), null)

// —— 每日一句 / 连续天数 ——


eq('日期键跨 UTC 边界按上海时区进位', wish.shanghaiDayKey(Date.UTC(2026, 8, 16, 16, 30)), '2026-09-17')
eq('日期键未越界不误进位', wish.shanghaiDayKey(Date.UTC(2026, 8, 16, 15, 30)), '2026-09-16')
eq('previousDayKey 跨月正确（2026 非闰年）', wish.previousDayKey('2026-03-01'), '2026-02-28')
eq('连续 3 天', wish.lampStreak(['2026-09-14', '2026-09-15', '2026-09-16'], '2026-09-16'), 3)
eq('断一天即中断', wish.lampStreak(['2026-09-14', '2026-09-16'], '2026-09-16'), 1)
eq('今日未点灯不算连续', wish.lampStreak(['2026-09-15'], '2026-09-16'), 0)

// —— 全站拓展预留 ——
eq('默认作用域回落 mashangyou', wish.resolveWishWallKey({ title: '黑马标本·马上有' }), 'mashangyou')
eq('★ 显式 wishWallKey 生效（第二面墙零代码改动）', wish.resolveWishWallKey({ wishWallKey: 'second-wall' }), 'second-wall')
eq('作用域只保留 [a-z0-9_-]（防注入）', wish.resolveWishWallKey({ wishWallKey: 'Ma Shang You!!' }), 'mashangyou')
eq('空字符串回落到默认墙', wish.normalizeProductKey(''), 'mashangyou')
const entryUrl = wish.buildWishWallUrl(
  { _id: 'p1', title: '黑马标本·马上有', wishWallKey: 'second-wall' },
  { from: 'detail' }
)
check('入口 URL 带作用域（全站拓展的关键参数）', entryUrl.indexOf('productKey=second-wall') !== -1, entryUrl)
check('入口 URL 带 from（埋点可区分入口）', entryUrl.indexOf('from=detail') !== -1, entryUrl)
check(
  '入口 URL 带商品 id 与编码后的标题',
  entryUrl.indexOf('productId=p1') !== -1 && entryUrl.indexOf(encodeURIComponent('黑马标本·马上有')) !== -1,
  entryUrl
)

/* ------------------------------------------------------------------ *
 * 4c) 全仓守卫：不得「拿全局有尺寸的类当容器用」（.lamp 事故的一般化）
 *
 * app.wxss 本来就是共享层，页面**有意**复用/覆盖 .btn-primary、.signal-light、
 * .empty-state 等工具类是正常设计 —— 所以「同名」不能当判据（全仓 70+ 处都是有意复用）。
 *
 * 真正会炸的只有一种组合：某个类在 app.wxss 里是**裸选择器且带死尺寸**（如
 * .lamp { width:12rpx; height:12rpx }），而页面又用**同一个裸类名**去搭容器
 * （写了 display:flex / padding，却没写 width/height）——
 * 于是页面容器继承了 12rpx 的尺寸。本页点灯卡片就是这么变成 6px 竖条的。
 * ------------------------------------------------------------------ */

const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** 去掉块级 at-rule（@keyframes/@media，含嵌套花括号）与 @import 行，只留扁平规则 */
function stripAtRules(css) {
  let out = ''
  let i = 0
  while (i < css.length) {
    const at = css.indexOf('@', i)
    if (at === -1) { out += css.slice(i); break }
    const brace = css.indexOf('{', at)
    const semi = css.indexOf(';', at)
    if (semi !== -1 && (brace === -1 || semi < brace)) {
      out += css.slice(i, at)
      i = semi + 1
      continue
    }
    let depth = 0
    let j = brace
    for (; j < css.length; j += 1) {
      if (css[j] === '{') depth += 1
      else if (css[j] === '}') { depth -= 1; if (depth === 0) { j += 1; break } }
    }
    out += css.slice(i, at)
    i = j
  }
  return out
}

/**
 * 逐条切出 { 选择器, 声明 }。
 * ⚠️ 不要用 /(^|})\s*([^{}@]+)\{/g 那种写法：匹配完一条会把扫描位推到该条的 `}` 之后，
 * 下一条必须靠"又一个 }"才能起头 —— 结果**每隔一条规则才被检查**（守卫只覆盖一半规则）。
 */
function parseRules(css) {
  const out = []
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open === -1) break
    const close = css.indexOf('}', open)
    if (close === -1) break
    out.push({ selector: css.slice(i, open).trim(), body: css.slice(open + 1, close) })
    i = close + 1
  }
  return out
}

/** 一组裸类名选择器 → 类名数组；不是裸类名块则返回 [] */
function bareClassNames(selector) {
  const names = selector.split(',').map((x) => x.trim())
  if (!names.length) return []
  if (!names.every((n) => /^\.[a-zA-Z][\w-]*$/.test(n))) return []
  return names.map((n) => n.slice(1))
}

{
  // 全局层 = app.wxss **及其 @import 的文件**（styles/badges.wxss 只被 import，
  // 类名不在 app.wxss 正文里 —— 只扫 app.wxss 会漏掉整个 badge 家族）
  const appCssRaw = readFileSync(resolve(ROOT, 'miniprogram/app.wxss'), 'utf8')
  const imported = [...appCssRaw.matchAll(/@import\s+"([^"]+)"/g)]
    .map((m) => resolve(ROOT, 'miniprogram', m[1].replace(/^\.\//, '')))
  const globalSources = [resolve(ROOT, 'miniprogram/app.wxss'), ...imported]
  check('全局层含 @import 的样式文件（badges 等）', imported.length >= 1, imported.map((f) => relative2(resolve(ROOT, 'miniprogram'), f)).join(','))

  /** 全局层里「裸 .name 选择器 + 带死尺寸」的声明块 */
  const sizedGlobals = new Set()
  for (const file of globalSources) {
    const css = stripAtRules(stripCssComments(readFileSync(file, 'utf8')))
    for (const rule of parseRules(css)) {
      const names = bareClassNames(rule.selector)
      if (!names.length) continue
      const hasSize = /(?:(?:^|;)\s*(?:min-|max-)?width\s*:)/.test(rule.body) &&
        /(?:(?:^|;)\s*(?:min-|max-)?height\s*:)/.test(rule.body)
      if (!hasSize) continue
      // 只要有一条裸规则带尺寸就算：后面"只改颜色"的同名块不得把它覆盖掉
      names.forEach((n) => sizedGlobals.add(n))
    }
  }
  check('解析到全局层的带尺寸类（守卫不是空转）', sizedGlobals.size >= 5, `${sizedGlobals.size} 个`)

  const walk = (dir, out = []) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules') continue
      const full = join2(dir, name)
      if (statSync(full).isDirectory()) walk(full, out)
      else if (name.endsWith('.wxss')) out.push(full)
    }
    return out
  }
  const files = walk(resolve(ROOT, 'miniprogram')).filter((f) => !f.endsWith('app.wxss'))
  check('扫到仓内 WXSS（守卫不是空转）', files.length > 50, `${files.length} 个文件`)

  const leaks = []
  for (const file of files) {
    // ⚠️ 必须走 readSrc（而不是直接 readFileSync）：否则注入的回归到不了这个全仓守卫，
    // selftest 就永远"证明"不了它会失败。
    const css = stripAtRules(stripCssComments(readSrc(relative2(ROOT, file).split('\\').join('/'))))
    for (const rule of parseRules(css)) {
      const names = bareClassNames(rule.selector)
      if (!names.length) continue
      const containerish = /(?:(?:^|;)\s*display\s*:\s*flex)|(?:(?:^|;)\s*padding\s*:)/.test(rule.body)
      // 与全局侧对称：min-/max- 也算「自己定了尺寸」。像 NavBack 复用全局返回按钮的
      // 72rpx 点击区（写的是 min-width/min-height），属有意共享，不是撞名泄漏。
      const setsSize = /(?:^|;)\s*(?:min-|max-)?(?:width|height)\s*:/.test(rule.body)
      if (!containerish || setsSize) continue
      names.forEach((name) => {
        if (sizedGlobals.has(name)) leaks.push(`${relative2(resolve(ROOT, 'miniprogram'), file)} → .${name}`)
      })
    }
  }
  eq('★ 不得用「全局带死尺寸的类」当容器（.lamp 事故：卡片被压成 12rpx 竖条）', leaks.join(' | '), '')
}

// —— 入口组件化：判定与跳转只有一份 ——
const entrySrc = readSrc('miniprogram/components/WishWallEntry/index.js')
check('入口组件用 isWishWallProduct 判定命中', /isWishWallProduct\(product\)/.test(entrySrc))
check('入口组件用 buildWishWallUrl 跳转', /buildWishWallUrl\(/.test(entrySrc))
const entryWxml = readSrc('miniprogram/components/WishWallEntry/index.wxml')
check('入口组件带「马上有」品牌署名（即需求所指的互动组件）', /wish-wall-entry-brand/.test(entryWxml))
const detWxml = readSrc('miniprogram/subpackages/feature/detail/index.wxml')
check('详情页改用 <wish-wall-entry> 组件', /<wish-wall-entry\b/.test(detWxml))
check('详情页不再自持入口实现', !/goWishWall\b/.test(detWxml))

/* —— 首页入口 · 弹幕跑马灯（2026-09-20）────────────────────────────────────────
   产品负责人口径：把祈福墙入口放到**首页 banner 下方**，以弹幕墙跑马灯形式展示。
   四条钉住（每一条都对应一种"看起来做了、其实没做"）：
     ① 真的在 banner **之后**（顺序断言，不是"某处有个标签"）；
     ② 入口用 defaultWall（首页没有商品上下文）+ 开关默认关时**连槽位一起不渲染**（否则留一段空槽）；
     ③ 跑马灯文案来自**真实心愿**（manageWishWall 默认墙的 list），取不到就置空 —— **不许编造**；
     ④ 跑马灯至少 2 条才开（1 条在无缝循环里会露空档）、时长按内容长度算。 */
const homeWxml = readSrc('miniprogram/pages/index/index.wxml')
const homeJs = readSrc('miniprogram/pages/index/index.js')
const entryWxss = readSrc('miniprogram/components/WishWallEntry/index.wxss')
{
  const bannerAt = homeWxml.indexOf('hero-swiper')
  const entryAt = homeWxml.indexOf('<wish-wall-entry')
  check('★ 首页接入祈福墙入口，且**在 banner 之后**（产品口径：主页 banner 下方）',
    entryAt !== -1 && bannerAt !== -1 && entryAt > bannerAt,
    `banner@${bannerAt} entry@${entryAt}`)
  check('★ 首页入口用 defaultWall + 开关默认关时连槽位不渲染（不留空槽）',
    /defaultWall="\{\{true\}\}"/.test(homeWxml) &&
    /<view class="wish-wall-slot-home" wx:if="\{\{showMaShangYou\}\}"/.test(homeWxml))
  check('★ 跑马灯文案来自**真实心愿**（manageWishWall 默认墙），取不到就置空 —— 不许编造',
    /name: 'manageWishWall'/.test(homeJs) && /action: 'list'/.test(homeJs) &&
    /wishWallWishes: wishes/.test(homeJs) && /wishWallWishes: \[\]/.test(homeJs))
  check('★ 跑马灯 ≥2 条才开（1 条会露空档）+ 时长按内容长度算（长文案跑得久）',
    /const MQ_MIN = 2/.test(entrySrc) && /mqItems/.test(entryWxml) && /mqDurationMs/.test(entryWxml))
  // 2026-09-20 产品负责人两轮口径：
  //  ① 浅纸卡在博物黑页面上"比较突兀，需要适配"（不是纸不好）→ 出**羊皮纸**变体；
  //  ② 跑马灯文字要**手写体 + emoji**（与祈福墙弹幕同一套观感）。
  // 组件 json 没有 styleIsolation → 页面样式进不去组件内部，**只能**由宿主选皮肤，故钉 tone。
  check('★ 首页入口用「墨底纸韵」皮肤（tone=ink：暖调墨黑 + 纤维 soft-light + 内嵌铜金细框）',
    /tone="ink"/.test(homeWxml) &&
    /\.wish-wall-entry\.is-ink\s*\{[^}]*linear-gradient\(165deg, #2C2822/.test(entryWxss) &&
    /\.wish-wall-entry\.is-ink::before\s*\{[^}]*mix-blend-mode:\s*soft-light/.test(entryWxss) &&
    /\.wish-wall-entry\.is-ink::after\s*\{[^}]*border:\s*1rpx solid rgba\(196, 167, 108, 0\.3\)/.test(entryWxss),
    '三版试出的结论：亮纸与羊皮纸都被否（亮度问题）→ 纸感只能靠线索表达，且深底纤维必须 soft-light')
  check('★ 跑马灯文字用手写体（与祈福墙愿签/弹幕同一字栈；字体由 handFont 全局加载，组件不重复加载）',
    /\.wish-wall-entry-mq-item\s*\{[^}]*font-family:\s*'ShanhaiHand'/.test(entryWxss) &&
    /kai|KaiTi|楷体/.test(entryWxss) &&
    !/loadFontFace/.test(entrySrc),
    '组件里重复 loadFontFace = 每次进首页多下一份字体')
  check('★ 跑马灯带 emoji，且 emoji 来自**共享规则**（utils/wishWall.danmakuEmoji，按 _id 确定性取）',
    /\{\{item\.e\}\}/.test(entryWxml) && /wish-wall-entry-mq-emoji/.test(entryWxss) &&
    /danmakuEmoji\(/.test(homeJs) && /emoji: danmakuEmoji\(/.test(homeJs),
    '首页自造一套 emoji = 两处规则早晚对不上')
  check('★ 深色皮肤仍从属于「组件内变体」而非宿主覆盖（styleIsolation 是默认的 isolated）',
    !/styleIsolation/.test(readSrc('miniprogram/components/WishWallEntry/index.json')),
    '若哪天给组件开了 apply-shared，这条与上面的 tone 判据要一起复核')
}

// —— C 端页面的仪式/彩蛋接线 ——


/* ── 愿签内容流组件 `<wall-feed>` 的真源（PRD v1.4 §11.1 R2，2026-09-22 接线）──────────
   改造后「愿签段」的**渲染结构**整体搬进 `subpackages/feature/components/WallFeed/`（页面只传属性、接事件）。
   因此本文件里所有原先读**页面** WXML/WXSS 的愿签段判据都必须改读这里 ——
   继续读页面残留的死 CSS / 已删的 WXML 会变成**假绿**（错题本 E3/E7：读的是镜像、不是真源）。
   注入也按同一口径跟随（见 INJECTIONS 里那些 file 指向组件的条目）。 */


// 口径：作用域只能来自**入口**（路由参数），或门店码的 scene —— 绝不是写死的常量。
// 2026-09-18 门店码接入后，来源从 1 个变 2 个，判据跟着口径走（不是放宽：仍然禁止写死）


/* ── R2 接线：愿签内容流换成 `<wall-feed>`（PRD v1.4 §11.1，2026-09-22）──────────
   组件自身的自包含性由组件侧判据（feedWxml 段）钉住；这一组钉**页面侧**，三条：
   ① 真的登记并使用组件（文件存在不算数 —— 那正是 E7 的空判据）；
   ② 传进去的是**稳定字段**（`wallItems`，不是会被 applyView 换成当前视图的 `items`）；
   ③ 组件 triggerEvent 的每个事件都有落点，且落点调回页面**既有的**方法
      （不在页面/组件里长出第二套取数逻辑 —— 云调用只在本页）。 */


/* ------------------------------------------------------------------ *
 * 4b) 重设计防线（2026-09-16：业务方判定原样式「灾难现场」）
 *
 * 原样的三类问题都是「不报错但用户看得见」，所以每条都要有守卫：
 *   ① .lamp 撞全局信号灯基类 → 点灯卡片被压成 12rpx 竖条、文案一字一行；
 *   ② 弹幕同轨固定 900ms 间隔 → 4 轨各叠 4 条；
 *   ③ 标题 {{productTitle}} · 祈福墙 与产品名里的「马上有」重复两遍。
 * ------------------------------------------------------------------ */


// 取 applyItems 的函数体：用**结构**定位，不用"多少字符以内"。
// 原写法是 `/applyItems[\s\S]{0,1200}?scheduleDanmakuCycle\(this\.data\.rows\)/` ——
// 窗口是魔数，函数里多写一行（2026-09-17 并行流程加"刚落愿高亮"）就会误报，
// 而它想证明的只是"applyItems 的数据路径确实调了排期"。结构定位既保意图又不脆。


check('入口箭头改为 CSS 折角（不再用字符 ›）', !/›/.test(entryWxml) && /\.wish-wall-entry-chevron\s*\{[^}]*border-right/.test(readSrc('miniprogram/components/WishWallEntry/index.wxss')))
// 2026-09-20：页头并入墙卡（产品要求「hero banner 应该与弹幕墙合并」）后，卡的总高改为**内容高度**
// （页头自适应），于是「固定高度」这条要求**下移到弹幕舞台本身**。
// ⚠️ 要求本身没有放宽：抖动风险来自弹幕行数/动画，而舞台高度仍是死的。
// 现在**同时钉两条**（舞台 336rpx = 原 380 − 页脚带 44，以及页脚带 44rpx）——比原来钉得更细。


/* ------------------------------------------------------------------ *
 * 4d) 对标全站（2026-09-16）：逐项对齐站点基线与同族页
 * ------------------------------------------------------------------ */


/* ── 长度/数值解析：字面量 `30rpx` / `1.6` 或令牌 `var(--fs-30)` / `var(--space-3)` ──
   为什么必须这样读（2026-09-19）：本页把 `font-size` / 间距换成设计令牌后，原先直接抓
   `(\d+)rpx` 的判据会读到 NaN —— 而 NaN 参与 `<` / `>` 比较**恒为 false**，
   于是「字号层级不倒挂」「灯卡纵向节奏」这两条会**假红**（NaN > NaN 为假）；
   若判据写成 `!(a < b)` 就会反过来**假绿**。两种都是"改了源码、守卫静默失效"的形态。
   所以判据跟着令牌走：`--fs-*` / `--space-*` 一律从 app.wxss 的定义实读，不写死第二份数字。 */
const RPX_TOKENS = (() => {
  const map = {}
  const src = readFileSync(resolve(ROOT, 'miniprogram/app.wxss'), 'utf8')
  for (const m of src.matchAll(/--([a-z0-9-]+):\s*(-?\d+(?:\.\d+)?)rpx/g)) map[m[1]] = Number(m[2])
  return map
})()
const numOf = (expr) => {
  const s = String(expr == null ? '' : expr).trim()
  const lit = /^(-?\d+(?:\.\d+)?)(?:rpx)?$/.exec(s)
  if (lit) return Number(lit[1])
  const varRef = /^var\(\s*--([a-z0-9-]+)\s*(?:,[^)]*)?\)$/.exec(s)
  if (varRef && RPX_TOKENS[varRef[1]] !== undefined) return RPX_TOKENS[varRef[1]]
  return NaN
}


// —— 管理端 AI 播种 ——
const managePageSrc = readSrc('miniprogram/subpackages/manager/wish-wall/index.js')
check('管理端接线了 AI 播种 action', /action: 'staffSeedAi'/.test(managePageSrc))
check('管理端播种前有二次确认（不可逆对外动作）', /seedAi\(\) \{[\s\S]{0,220}showModal/.test(managePageSrc))

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * 4e) 纯函数：手写体 token / 上限同源 / 两列瀑布 / 收尾条（2026-09-16 第二轮）
 * ------------------------------------------------------------------ */

// —— 两列瀑布：确定性 + 不丢项 + 保序 ——
{
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ _id: 't' + i, text: '马上有' + i }))
  const c5 = wish.splitTagColumns(mk(5))
  eq('两列：5 条 → 3 + 2', c5.map((c) => c.length).join('+'), '3+2')
  eq('列数固定 2', c5.length, 2)
  eq('★ 并回后与输入等长（不丢项）', c5[0].length + c5[1].length, 5)
  eq('★ 按下标奇偶（首条在第一列）', c5[0][0]._id, 't0')
  eq('第二条在第二列', c5[1][0]._id, 't1')
  eq('第三条回到第一列', c5[0][1]._id, 't2')
  eq('确定性：两次调用完全一致', JSON.stringify(wish.splitTagColumns(mk(7))), JSON.stringify(wish.splitTagColumns(mk(7))))
  eq('空列表 → 两个空列（不炸）', wish.splitTagColumns([]).map((c) => c.length).join('+'), '0+0')
  eq('null 输入安全', wish.splitTagColumns(null).length, 2)
  eq('列数可覆写', wish.splitTagColumns(mk(6), 3).map((c) => c.length).join('+'), '2+2+2')
}

// —— 上限判定：只有到 LIST_LIMIT 才说"仅展示最近 N 条" ——
eq('29 条（< 上限）不算到顶', wish.isTagListCapped(29), false)
eq('★ 30 条（= 服务端上限）算到顶', wish.isTagListCapped(30), true)
eq('31 条也算到顶', wish.isTagListCapped(31), true)
eq('0 条不算到顶', wish.isTagListCapped(0), false)
eq('脏值安全', wish.isTagListCapped(null), false)

// —— 上限与云函数同源（防漂移） ——
{
  const cloudSrc = readSrc('miniprogram/cloudfunctions/manageWishWall/index.js')
  const m = /const LIST_MAX = (\d+)/.exec(cloudSrc)
  check('云函数 LIST_MAX 可解析', !!m, m ? m[1] : 'parse failed')
  eq('★ 客户端 LIST_LIMIT 与云函数 LIST_MAX 相等（防上限漂移）', wish.LIST_LIMIT, Number(m && m[1]))
}

eq('愿签墙固定两列', wish.TAG_COLUMNS, 2)

// —— 手写体 ——
const appWxss = readFileSync(resolve(ROOT, 'miniprogram/app.wxss'), 'utf8')
check(
  '★ 设计系统新增手写体 token --font-hand（走系统字体栈，不下载 webfont）',
  /--font-hand:/.test(appWxss) && /HanziPen SC/.test(appWxss) && /Kaiti/.test(appWxss)
)
/**
 * 手写体的**接线**（施工总纲 W6 交接不变量 5）—— 2026-09-19 接手盘点补上。
 *
 * 洞是怎么发现的：本页 WXSS 写的是 `font-family: 'ShanhaiHand', <系统兜底>`，而**真正把字体
 * 加载起来的是** `app.js onLaunch → utils/handFont.js` 的 `wx.loadFontFace`。上面那条断言只看着
 * app.wxss 的 token，一条断言都没读这两个文件（实测：把 `scopes` 的 'native' 删掉、把 `global`
 * 关掉、把 `FONT_FAMILY` 改名、甚至**根本不调用加载器**，654 条断言全部照绿，exit=0）。
 * 这四种断法在真机上的表现都一样：**不报错、不告警，整页静默落回系统字体** —— 正是
 * 「守卫全绿但真机是错的」（错题本 E8）里最难被发现的一类，所以必须钉住。
 *
 * 契约：`loadFontFace` + `global: true`（页面无需各自注册）+ `scopes: ['webview','native']`
 *      （少了 native，iOS 的 <text> 原生层看不到效果）+ **页面用的族名 = 加载的族名**。
 * ⚠️ 断言前必须剥注释：handFont.js 的文档注释里就写着 `global: true` 与 `scopes: [...]`，
 *    不剥就会把「注释里提到过」判成「代码里生效了」（错题本 E7 的假通过）。
 */

// 2026-09-19 弹幕丰富样式：配色/emoji 必须**确定性**（按 id 用已有 FNV-1a 哈希取），
// 禁用随机 —— 否则每次 setData 跳色，且与「确定性布局」铁律冲突 ✗。
const wallJsSrc = readFileSync(resolve(ROOT, 'miniprogram/utils/wishWall.js'), 'utf8')
check('★★ 弹幕配色与 emoji 走稳定哈希（rotateIndex），且**不得**出现 Math.random',
  /tone: rotateIndex\(seedId, DANMAKU_TONES\)/.test(wallJsSrc)
  // 2026-09-20：emoji 的取法抽成了 `danmakuEmoji(seedId)`（首页入口的跑马灯要复用**同一条**规则，
  // 否则两处 emoji 早晚对不上）→ 判据跟着代码走，但**确定性没有放宽**：
  // 断言调用点仍传 seedId、且那个函数内部仍是 rotateIndex + 盐 'e:' + 同一 emoji 池。
  && /emoji: danmakuEmoji\(seedId\)/.test(wallJsSrc)
  && /function danmakuEmoji\(seedId\)[\s\S]{0,400}?rotateIndex\('e:' \+ id, DANMAKU_EMOJIS\.length\)/.test(wallJsSrc)
  && !/Math\.random/.test(wallJsSrc),
  '随机取色会让每次 setData 跳到不同颜色（守卫明令确定性）')


// 2026-09-19 点灯/木鱼图标替换（产品负责人提供 SVG）：微信 <image> 不渲染 SVG ✗
// → 走 base64 data-URI + background-image（矢量、随包、**无外链** → 不需要任何域名白名单 ✓）


// 字号与 CHAR_RPX 是**一对**：CHAR_RPX 是同轨不重叠的宽度估算依据，
// 只改字号不改它 → 后一条会在前一条尾部还在屏内时进场（叠字）。判据按"字号 ×1.03 ≈ CHAR_RPX"实算，
// 既保住原来的下限（≥28rpx：手写体笔画细，移动中要认得出），又让两个数不再各自漂移。

const charRpxConst = Number((/const CHAR_RPX = (\d+)/.exec(readSrc('miniprogram/utils/wishWall.js')) || [])[1])


// —— 结构（2026-09-22 接线后：愿签段的结构判据读组件真源，页面侧只钉"把纯函数结果传进去"）——


/* ------------------------------------------------------------------ *
 * 4f) 详情页入口位置：主图正下方（2026-09-16 第三轮）
 *
 * 原来埋在「藏品参数之后 / 图文详情之前」，等于没人看得到。
 * 搬到主图正下方后有三处连带风险，逐条钉住：
 *   ① 位置本身（必须在 .content-body 首个子节点、价格卡之前）；
 *   ② 间距归属（组件与宿主同元素抢 margin 时优先级不保证 → 必须由宿主包裹层给）；
 *   ③ 三个页签锚点会整体位移一个入口的高度 → 开关翻转后必须重测。
 * ------------------------------------------------------------------ */

const detWxss = readSrc('miniprogram/subpackages/feature/detail/index.wxss')
const detJs = readSrc('miniprogram/subpackages/feature/detail/index.js')
const entryWxss2 = readSrc('miniprogram/components/WishWallEntry/index.wxss')

check('详情页仍以组件形式接入祈福墙入口', /<wish-wall-entry\b/.test(detWxml))
eq('★ 入口数量唯一（不会既在头部又在参数区）', (detWxml.match(/<wish-wall-entry\b/g) || []).length, 1)

{
  const bodyAt = detWxml.indexOf('<view class="content-body">')
  const slotAt = detWxml.indexOf('class="wish-wall-slot"')
  const entryAt = detWxml.indexOf('<wish-wall-entry')
  const cardAt = detWxml.indexOf('id="section-detail"')
  check(
    '★ 入口在 .content-body 首个子节点、价格卡之前（即头部主图正下方）',
    bodyAt > -1 && slotAt > bodyAt && entryAt > slotAt && cardAt > entryAt,
    `body=${bodyAt} slot=${slotAt} entry=${entryAt} card=${cardAt}`
  )
  const paramsAt = detWxml.indexOf('PARAMETERS')
  const detailsAt = detWxml.indexOf('<text class="st-en">DETAILS</text>')
  check(
    '★ 旧位置（藏品参数与图文详情之间）已无入口',
    paramsAt > -1 && detailsAt > paramsAt && !detWxml.slice(paramsAt, detailsAt).includes('wish-wall-entry')
  )
}

check(
  '★ 间距由宿主包裹层给（组件与宿主不同元素抢 margin）',
  /\.wish-wall-slot\s*\{[^}]*margin:\s*24rpx 0/.test(detWxss)
)
eq(
  '★ 组件根节点零外边距（外间距全归宿主）',
  (readSrc('miniprogram/components/WishWallEntry/index.wxss').match(/\.wish-wall-entry\s*\{[^}]*margin:\s*0;/g) || []).length,
  1
)
check(
  '组件保留了 ext-class 口子（改皮肤用，站点惯例同 NavBack）',
  /externalClasses:\s*\['ext-class'\]/.test(readSrc('miniprogram/components/WishWallEntry/index.js')) &&
    /class="wish-wall-entry ext-class/.test(readSrc('miniprogram/components/WishWallEntry/index.wxml'))
)
check(
  '★ 首屏位用 compact 一行版（三行卡会把价格挤出首屏）',
  /compact="\{\{true\}\}"/.test(detWxml) &&
    /compact:\s*\{\s*type:\s*Boolean/.test(readSrc('miniprogram/components/WishWallEntry/index.js')) &&
    /wx:if="\{\{!compact\}\}"/.test(readSrc('miniprogram/components/WishWallEntry/index.wxml'))
)
check(
  '★ 浅纸上的灯用三层选择器压过全局 .signal-light.lamp-brass（单类会被按特异性压回空心圈）',
  /\.wish-wall-entry \.wish-wall-entry-row \.wish-wall-entry-lamp\s*\{/.test(entryWxss2)
)
check(
  '★ 开关翻转后重测三个页签锚点（否则整体错位一个入口高度）',
  /applyDisplayFlags\(flags\)[\s\S]{0,2000}?computeSectionTops/.test(detJs)
)
;['section-detail', 'section-archive', 'section-review'].forEach((id) => {
  check(`页签锚点 ${id} 仍在`, detWxml.includes(`id="${id}"`))
})

/* ================================================================== *
 * 7) 升级第一期：仪式（灯位/节气）· 祈福（心愿笺/我的心愿）· 彩蛋（门槛型）
 *
 * 这一期加的都是"没有也能用"的东西，所以最容易悄悄失效：
 * 灯位不分层、节气永远不命中、门槛型彩蛋不看门槛、我的心愿不标记 —— 全都不报错。
 * 每条断言都配了一个注入（见 INJECTIONS 末尾 5 条）。
 * ================================================================== */

// —— 灯位层级：把"连着来"变成看得见的东西 ——

eq('0 天未点亮', wish.lampTier(0).tier, 0)
eq('1 天 → 1 盏 · 初见', `${wish.lampTier(1).tier}/${wish.lampTier(1).lamps}/${wish.lampTier(1).label}`, '1/1/初见')
eq('3 天 → 3 盏 · 守夜', `${wish.lampTier(3).tier}/${wish.lampTier(3).lamps}/${wish.lampTier(3).label}`, '2/3/守夜')
eq('7 天 → 5 盏 · 长明', `${wish.lampTier(7).tier}/${wish.lampTier(7).lamps}/${wish.lampTier(7).label}`, '3/5/长明')
eq('到顶后不再升级', wish.lampTier(99).tier, 3)
eq('未到下一层时给出还差几天', wish.lampTier(2).daysToNext, 1)
eq('到顶后 daysToNext 归零', wish.lampTier(7).daysToNext, 0)
check(
  '★ 灯位单调不减（天数多了等级不能倒挂）',
  [0, 1, 2, 3, 6, 7, 30].every((n, i, arr) => i === 0 || wish.lampTier(n).tier >= wish.lampTier(arr[i - 1]).tier)
)


// —— 二十四节气：确定性 + 边界 ——
eq('节气表 24 条', wish.SOLAR_TERMS.length, 24)
eq('立春当天命中', wish.solarTermOn('2026-02-04').name, '立春')
eq('★ 非节气日不命中（不能天天说今天是节气）', wish.solarTermOn('2026-02-05'), null)
eq('节气带季节归属', wish.solarTermOn('2026-12-22').season, 'winter')
eq('非法日期不命中', wish.solarTermOn('bad'), null)
eq('每条节气都能被自己的日期命中', wish.SOLAR_TERMS.filter((t) => wish.solarTermIndex(`2026-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`) === 0).length, 0)
const solarGap = wish.solarTermGap('2026-02-02')
eq('下一个节气是立春', solarGap.name, '立春')
eq('距下一个节气 2 天', solarGap.inDays, 2)
eq('节气当天 inDays 归零且标记 on', wish.solarTermGap('2026-02-04').on, true)

// —— 我的心愿：不靠 openid，靠 mine 的 _id 标记 ——
const markSrc = [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }]
const markedNow = wish.markMine(markSrc, [{ _id: 'b' }])
eq('★ 用 mine 的 _id 标记「我的」', markedNow.filter((r) => r.isMine).map((r) => r._id).join(','), 'b')
check('标记不改原对象（否则会污染墙面缓存）', markSrc.every((it) => !('isMine' in it)))
check('markMine 接受 Set 形式', wish.markMine([{ _id: 'a' }], new Set(['a']))[0].isMine === true)
const mineRow = wish.decorateMineRows(
  [{ _id: 'x', text: '  马上有 光 ', status: 'hidden', createTime: new Date(1000000).toISOString() }],
  1000000 + 1000
)[0]
eq('我的心愿行标 isMine', mineRow.isMine, true)
eq('我的心愿行标 hidden（被馆方收起的要能看见）', mineRow.hidden, true)
eq('我的心愿文案已归一化', mineRow.text, '马上有 光')
eq('我的心愿时间形态', mineRow.timeText, '刚刚')
eq(
  '我的心愿计数（共/上墙/收起）',
  JSON.stringify(wish.mineSummary([{ status: 'hidden' }, { status: 'visible' }, { status: 'visible' }])),
  JSON.stringify({ total: 3, visible: 2, hidden: 1 })
)

// —— 门槛型彩蛋：门槛在注册表里，页面只报事实 ——
check('门槛：连续天数不够不命中', egg.triggerMatches({ type: 'lampStreak', minStreak: 3 }, { type: 'lampStreak', streak: 2 }) === false)
check('★ 门槛：连续天数够才命中', egg.triggerMatches({ type: 'lampStreak', minStreak: 3 }, { type: 'lampStreak', streak: 3 }) === true)
check('门槛：心愿数不够不命中', egg.triggerMatches({ type: 'wishCount', minCount: 3 }, { type: 'wishCount', wishCount: 2 }) === false)
check('★ 门槛：心愿数够才命中', egg.triggerMatches({ type: 'wishCount', minCount: 3 }, { type: 'wishCount', wishCount: 5 }) === true)
check('门槛条件不会串台（类型不符直接不命中）', egg.triggerMatches({ type: 'lampStreak', minStreak: 1 }, { type: 'pageEnter', streak: 9 }) === false)
eq('门槛未到时「騊駼」不给（连续 2 天）', egg.tryLampStreak({ streak: 2 }), null)
const gotTaotu = egg.tryLampStreak({ streak: 3 })
eq('★ 连续 3 天触发「騊駼」', gotTaotu && gotTaotu.egg.id, 'taotu')
eq('门槛型彩蛋同样只弹一次', egg.tryLampStreak({ streak: 5 }), null)
eq('门槛未到时「鹿蜀」不给（2 条心愿）', egg.tryWishCount({ wishCount: 2 }), null)
const gotLushu = egg.tryWishCount({ wishCount: 3 })
eq('★ 心愿满 3 条触发「鹿蜀」', gotLushu && gotLushu.egg.id, 'lushu')
const taotuEgg = eggConfig.EGGS.find((e) => e.id === 'taotu')
const lushuEgg = eggConfig.EGGS.find((e) => e.id === 'lushu')


check(
  '新彩蛋同样不挂支付/下单/退款路径',
  ['taotu', 'lushu'].every((id) => {
    const e = eggConfig.EGGS.find((x) => x.id === id)
    return (e.triggers || []).every((t) => (t.pages || []).every((p) => !/pay|order|checkout|refund/.test(p)))
  })
)
eq('图鉴收录 12 页（10 + 本期 2）', egg.listCatalog().length, 12)

// —— 页面接线：机制要在页面上真的被调用，否则等于没做 ——


// ⚠️ 2026-09-20 收紧：`onShareAppMessage` 从「只有一条愿签链路」变成**两条**（玩法结果 W1）。
// 原来的正则 `onShareAppMessage\(\)[\s\S]{0,320}?title: text` 之所以还过，是碰巧第一分支
// 先写了 shareFrom 分流、`title: text` 仍在 320 字内 —— 这种"位置窗口"判据恰好是错题本 E7。
// 现在改成**按语法边界取整个方法体**再判：末端必须有愿签分支（card.text），
// 且分流的依据必须是显式标记（否则两条链路会串，见"分享来源"那组行为判据）。


const achSrc = readSrc('miniprogram/subpackages/extra/user/achievements/index.js')
check('★ 博物笔记支持 focus 定位', /\.trim\(\) === 'relics'/.test(achSrc))
check('定位用容器选择器（不是写死 scrollTop）', /selector: '\.relics-card'/.test(achSrc))
check('定位只做一次（不在 onShow 反复滚）', /if \(this\._focusRelics\)/.test(achSrc))

/* ================================================================== *
 * 8) 多面墙可运营：商品级开关必须**端到端**通
 *
 * 「全站拓展」此前只差一步：藏品档案里没有 wishWallEnabled / wishWallKey。
 * 补这一步时最容易漏的是 **manageProducts 的字段白名单** —— 它是静默的：
 * 没登记 = 保存时字段被丢掉，界面照样提示"已保存"（与 flags-field-dropped 同一类）。
 * ================================================================== */

const mpSrc = readSrc('miniprogram/cloudfunctions/manageProducts/index.js')
check('★ 白名单放行 wishWallEnabled', /'wishWallEnabled'/.test(mpSrc))
check('★ 白名单放行 wishWallKey', /'wishWallKey'/.test(mpSrc))
check(
  '★ 表单载入按「实际是否挂墙」回填（否则打开任意藏品保存一次就把墙摘了）',
  /wishWallEnabled: isWishWallProduct\(item\)/.test(managerSrc)
)
check(
  '★ 保存时落成显式布尔并净化作用域',
  /wishWallEnabled: !!p\.wishWallEnabled/.test(managerSrc) && /wishWallKey: p\.wishWallEnabled \? normalizeProductKey/.test(managerSrc)
)
check('新建藏品默认不挂墙', /wishWallEnabled: false,/.test(managerSrc))
check('关掉开关时清空作用域（不留幽灵值，免得下次开启挂到别的墙上）', /bindPWishWall\(e\)[\s\S]{0,360}?wishWallKey': ''/.test(managerSrc))
check('作用域边输边净化（与云函数同口径）', /bindPWishWallKey\(e\)[\s\S]{0,220}?normalizeProductKey\(raw, ''\)/.test(managerSrc))
check('标识页有这两个控件', /bindchange="bindPWishWall"/.test(subviews) && /bindinput="bindPWishWallKey"/.test(subviews))
check('表单写明口径（同一个 key 共用一面墙）', /同一个 key 的藏品共用一面墙/.test(subviews))
const detFetchSrc = readSrc('miniprogram/subpackages/feature/detail/index.js')
check('★ C 端直读 products 文档（新增字段无需再登记读取侧白名单）', /db\.collection\('products'\)\.doc\(id\)\.get\(\)/.test(detFetchSrc))
check('入口组件把作用域带进墙页', /resolveWishWallKey/.test(readSrc('miniprogram/components/WishWallEntry/index.js')))

/* ================================================================== *
 * 9) 多面墙治理：第二面墙的弹幕也必须**能被治**
 *
 * 只做到"C 端能开第二面墙"是不够的：治理页若只认默认墙，第二面墙的弹幕就**无人可治** ——
 * 而「不接 UGC 审核 + 治理收敛在超管内容模块」正是这个功能的安全底座。
 * 治理面覆盖不到的作用域 = 一个没有兜底的 UGC 面。
 * ================================================================== */

const wishWallFnSrc = readSrc('miniprogram/cloudfunctions/manageWishWall/index.js')
const manageWxml = readSrc('miniprogram/subpackages/manager/wish-wall/index.wxml')
check(
  '★ 云函数有「列出所有墙」的 action',
  /async function staffWalls\(/.test(wishWallFnSrc) && /case 'staffWalls'/.test(wishWallFnSrc)
)
check('★ 列墙同样走 staff 鉴权（不能变成公开枚举接口）', /async function staffWalls\([\s\S]{0,200}?requireManager\(/.test(wishWallFnSrc))
check(
  '列墙有兜底（聚合不可用时逐条扫，宁可慢也要列得出来）',
  /staffWalls aggregate failed[\s\S]{0,700}?db\.collection\(COLLECTION\)\.limit\(200\)/.test(wishWallFnSrc)
)
check('默认墙永远在列表里（0 条也要看得见"这面墙还没内容"）', /counts\[DEFAULT_PRODUCT_KEY\] == null/.test(wishWallFnSrc))
check('墙名用藏品标题反查（key 是给机器看的，运营认的是藏品名）', /async function wallLabel/.test(wishWallFnSrc) && /where\(\{ wishWallKey: productKey \}\)/.test(wishWallFnSrc))
check('列墙数量有上限（不做出无穷列表）', /WALL_LIST_MAX = 20/.test(wishWallFnSrc) && /slice\(0, WALL_LIST_MAX\)/.test(wishWallFnSrc))

// ⚠️ 必须容忍换行：这页的调用对象会被后续改动补字段（如 staffSeedAi 加 prefix）而拆成多行，
// 用"同一行"的正则会把**合法改动**判成回归（本守卫曾因此误报一次）。
const usesScope = (action) =>
  new RegExp(`action: '${action}',\\s*productKey: this\\.data\\.productKey`).test(managePage)
check(
  '★ 管理页三条调用都用**当前作用域**（不再写死默认墙）',
  usesScope('staffList') && usesScope('staffStats') && usesScope('staffSeedAi')
)
check('★ 管理页有墙选择器且可切', /switchWall\(e\)/.test(managePage) && /data-key="\{\{item\.productKey\}\}"/.test(manageWxml))
check('切墙落本地（下次进来还在那面墙）', /writeCachedScope\(next\)/.test(managePage) && /readCachedScope\(\)/.test(managePage))
check('切墙清关键词（上一个墙的搜索词在新墙上基本搜不到）', /switchWall\(e\)[\s\S]{0,420}?keyword: ''/.test(managePage))
check('当前墙不在列表里也要留在选择器中（否则运营以为自己看错了墙）', /walls\.some\(\(w\) => w\.productKey === current\)/.test(managePage))
check('只有一面墙时给出"怎么开新墙"的指引', /当前只有一面墙/.test(manageWxml))
check(
  '列墙失败不阻断治理主流程（退回当前这面墙）',
  /wish wall staffWalls', e\)[\s\S]{0,420}?walls: \[\{ productKey: this\.data\.productKey/.test(managePage)
)
check('管理页从路由/缓存取初始作用域', /normalizeProductKey\(opts\.productKey \|\| readCachedScope\(\)\)/.test(managePage))

// —— 入口文案：多面墙之后「马上有」不再是唯一的墙 ——
// 组件里 `Component()` 在测试台不存在，故注入一个桩，顺便把组件配置抓下来断言。
let entryComponentOptions = null
const prevComponent = globalThis.Component
globalThis.Component = (opts) => { entryComponentOptions = opts }
const entryMod = loadCjs('miniprogram/components/WishWallEntry/index.js', {
  require: (id) => {
    if (id === '../../utils/wishWall') return wish
    if (id === '../../config/wallExhibit') return loadCjs('miniprogram/config/wallExhibit.js', { require: markerRequire })
    throw new Error('unexpected require ' + id)
  }
})
globalThis.Component = prevComponent

check('能加载组件并抓到配置（Component 桩生效）', !!entryComponentOptions)
eq('默认墙才配「马上有」署名', entryMod.resolveCopy('mashangyou', '', '').brandText, '马上有')
eq('★ 非默认墙不挂别人的品牌名', entryMod.resolveCopy('moonrabbit', '', '').brandText, '')
check(
  '★ 非默认墙的说明文案不点名「马上有」',
  entryMod.resolveCopy('moonrabbit', '', '').descText.indexOf('马上有') === -1
)
eq('显式传入优先（宿主仍可覆盖）', entryMod.resolveCopy('moonrabbit', '某某墙', '自定义文案').brandText, '某某墙')
eq('key 为空按默认墙处理（宁可按需求 28 的原样）', entryMod.resolveCopy('', '', '').brandText, '马上有')
// 2026-09-27：登记了展品的墙（马上有）入口说展品那一句 —— 与墙头展签 / 墙的分享卡同源
eq(
  '★ 马上有入口（详情，有商品）说展品那一句（config/wallExhibit.line）',
  entryMod.resolveCopy('mashangyou', '', '', true).descText,
  '对着黑马「马上有」，说一句想要的'
)
eq(
  '…首页默认墙（无商品）也是同一句（首页 / 详情 / 墙内三处不各说各话）',
  entryMod.resolveCopy('mashangyou', '', '', false).descText,
  '对着黑马「马上有」，说一句想要的'
)
eq(
  '…未登记展品的墙 + 有商品 → 仍走「再回来看这件」通用说明',
  entryMod.resolveCopy('moonrabbit', '', '', true).descText,
  '写一句心愿，再回来看这件藏品'
)
check(
  // 2026-09-20：键名不再写死 —— 首页入口需要额外观察 defaultWall，键变成了
  // 'enabled, defaultWall, product, brand, desc'。判据改为钉**意图**：必须同时观察
  // product / brand / desc（漏任一个宿主覆盖就不生效），允许继续加名字。
  '组件观察 product/brand/desc（否则宿主覆盖不生效；键名可变，但三个名字必须在）',
  !!(entryComponentOptions && entryComponentOptions.observers &&
    Object.keys(entryComponentOptions.observers).some(
      (k) => /\bproduct\b/.test(k) && /\bbrand\b/.test(k) && /\bdesc\b/.test(k)
    ))
)
check('组件属性默认留空 = 按墙自动', /brand: \{ type: String, value: '' \}/.test(entrySrc))
check('wxml 用解析后的文案（不再直接用 props）', /\{\{brandText\}\}/.test(entryWxml) && /\{\{descText\}\}/.test(entryWxml))

/* ================================================================== *
 * 3b) 首页入口 · 跑马灯健壮性（PRD §4.1 的补强断言，2026-09-20）
 *
 * 上一版这一段只钉了「MQ_MIN 这个标识符存在」「wxml 里有 mqItems/mqDurationMs」——
 * 把时长公式写死、把去重键换回"只看条数"、把 1 条也放行，它全都发现不了。
 * 这里改成**驱动真实组件 observer / 真实页面方法**，逐条覆盖入口最容易"半成品"的分支：
 *   开关关闭｜开启、加载中、取不到心愿、网络失败、单条超长、只有 1 条。
 * ================================================================== */
{
  // —— 文案必须走共享归一化（首页不与墙页各造一套）——
  check(
    '★ 首页跑马灯文案走共享 normalizeWishText（.trim() 挡不住换行/零宽字符）',
    /normalizeWishText\(/.test(homeJs) && /text:\s*normalizeWishText\(/.test(homeJs),
    '一条纯零宽字符的愿在 .trim() 之后仍"非空"，会凑满条数并在跑马灯里留一个看不见字的空位'
  )
  check('★ 组件侧同样走共享归一化（它是全站唯一渲染边界，不能只信宿主）', /\bnormalizeWishText\(/.test(entrySrc))

  // —— 组件行为：条数门槛 / 时长 / 单条封顶 / 内容去重 ——
  const wishesObs = entryComponentOptions && entryComponentOptions.observers && entryComponentOptions.observers.wishes
  check('能拿到跑马灯 observer（判据的输入必须真实存在）', typeof wishesObs === 'function')
  const newMqInstance = (base) => ({
    data: Object.assign({ mqItems: [], mqDurationMs: 26000 }, base || {}),
    setData(patch) { Object.assign(this.data, patch) }
  })
  const runWishes = (list, base) => {
    const inst = newMqInstance(base)
    if (typeof wishesObs === 'function') wishesObs.call(inst, list)
    return inst.data
  }
  const w = (text, emoji) => ({ text, emoji: emoji || '' })
  eq('★ 只有 1 条不开跑马灯（1 条在无缝循环里会露空档）', runWishes([w('独愿')]).mqItems.length, 0)
  eq('★ 0 条不开跑马灯（取不到心愿只留入口）', runWishes([]).mqItems.length, 0)
  eq('★ 2 条才开，且内容是两份（translateX(-50%) 无缝循环）', runWishes([w('甲愿'), w('乙愿')]).mqItems.length, 4)
  eq(
    '★ ≥2 条但全是空/零宽文案 = 0 条（不摆"看不见的愿"凑数）',
    runWishes([w('\u200b\u200b'), w('   '), w('\n')]).mqItems.length,
    0
  )
  eq(
    '★ 零宽文案不占条数也不进轨道（4 条里混 2 条零宽/空白 → 只按 2 条真实心愿开，得 4 项）',
    runWishes([w('\u200b\u200b'), w('甲愿'), w('   '), w('乙愿')]).mqItems.length,
    4
  )
  check(
    '★ 时长按内容长度换算（短的两条 < 长的两条；写死时长会让短的一闪而过、长的挤成一团）',
    runWishes([w('短'), w('短')]).mqDurationMs < runWishes([w('愿'.repeat(30)), w('愿'.repeat(30))]).mqDurationMs
  )
  check(
    '★ 单条封顶 = 系统上限 TEXT_MAX（存量脏数据的超长单条不会拖乱匀速跑马灯）',
    runWishes([w('愿'.repeat(300)), w('丙愿')]).mqItems.every((it) => it.t.length <= wish.TEXT_MAX)
  )
  {
    const inst = newMqInstance()
    if (typeof wishesObs === 'function') wishesObs.call(inst, [w('甲愿'), w('乙愿')])
    const before = inst.data.mqItems.map((it) => it.t).join(',')
    if (typeof wishesObs === 'function') wishesObs.call(inst, [w('丙愿'), w('丁愿')])
    const after = inst.data.mqItems.map((it) => it.t).join(',')
    check(
      '★ 条数相同但文案变了也要更新（下拉刷新后停在旧文案 = 过期社会证明）',
      before === '甲愿,乙愿,甲愿,乙愿' && after === '丙愿,丁愿,丙愿,丁愿',
      `${before} → ${after}`
    )
  }

  // —— 可见性判定：开关 + 墙作用域（组件自身也要守，"宁可漏亮，不可错亮"）——
  const visObsEntry = entryComponentOptions && entryComponentOptions.observers &&
    Object.entries(entryComponentOptions.observers).find(
      ([k]) => /\benabled\b/.test(k) && /\bdefaultWall\b/.test(k)
    )
  check('能拿到可见性 observer（判据的输入必须真实存在）', !!visObsEntry)
  const runVisible = (enabled, defaultWall, product) => {
    const inst = newMqInstance()
    if (visObsEntry) visObsEntry[1].call(inst, enabled, defaultWall, product, '', '')
    return inst.data.visible
  }
  eq(
    '★ 开关关 → 组件自身也不渲染（不能只靠宿主槽位：详情页走的是同一条判定）',
    runVisible(false, true, null),
    false
  )
  eq('★ 开关开 + defaultWall 显式声明 → 首页入口亮', runVisible(true, true, null), true)
  eq(
    '★ 开关开但既没 defaultWall、也没命中藏品 → 不亮（宁可漏亮，不可错亮）',
    runVisible(true, false, null),
    false
  )
  eq(
    '★ 开关开 + 藏品显式命中 → 亮（详情页路径不受 defaultWall 影响）',
    runVisible(true, false, { wishWallEnabled: true }),
    true
  )

  // —— 无缝循环的几何：-50% 必须正好等于一份内容宽 ——
  const mqCss = stripCssComments(entryWxss)
  const mqTrackBody = (/\.wish-wall-entry-mq-track\s*\{([^}]*)\}/.exec(mqCss) || [, ''])[1]
  const mqItemBody = (/\.wish-wall-entry-mq-item\s*\{([^}]*)\}/.exec(mqCss) || [, ''])[1]
  check('能解析到跑马灯轨道/条目规则（判据不是空转）', !!mqTrackBody && !!mqItemBody)
  check(
    '★ 无缝循环的几何：轨道不能用 gap 造间距（有 gap 时 -50% 每次回绕错半个 gap）',
    !/(?:^|;)\s*gap\s*:/.test(mqTrackBody) && /margin-right\s*:/.test(mqItemBody),
    '总宽 = 2×内容 + (2n-1)×gap，而 -50% 只走 2×内容的一半 → 回绕处 12rpx 顿挫'
  )

  // —— 页面行为：真实心愿 / 失败可重试 / 刷新可更新 / 开关初值 ——
  const homeWxPrev = globalThis.wx
  let mqCalls = 0
  let mqReply = { result: { list: [] } }
  try {
    installWxStub() // index.js 的 require 链在载入期就会读 wx.cloud
    // installWxStub 的 cloud 桩只有 callFunction；首页 require 链里有一个模块在载入期
    // 就 `wx.cloud.database()`（缺失会炸在第二层，现象像"页面根本加载不了"）
    globalThis.wx.cloud.database = () => ({ collection: () => ({}) })
    globalThis.wx.cloud.callFunction = () => {
      mqCalls += 1
      return mqReply.__fail ? Promise.reject(new Error('network down')) : Promise.resolve(mqReply)
    }
    const homePageCfg = loadPageConfig('miniprogram/pages/index/index.js')
    const mqPage = () => ({ data: { wishWallWishes: [] }, setData(patch) { Object.assign(this.data, patch) } })

    eq('★ 首页开关初始为关（缺字段默认关：不开就没有跑马灯、也没有槽位）', homePageCfg.data.showMaShangYou, false)

    // 取不到心愿（网络失败）：不编造，只留入口
    const mqPageInst = mqPage()
    mqReply = { __fail: true, result: { list: [] } }
    await homePageCfg.loadWishWallMarquee.call(mqPageInst)
    const afterFail = mqCalls
    check('★ 取不到心愿 = 空文案（不编造社会证明），入口本身不受影响', mqPageInst.data.wishWallWishes.length === 0)

    // 失败必须可重试：一次网络抖动不能把跑马灯钉死在"没有"状态
    mqReply = { result: { list: [{ _id: 'a', text: '甲愿' }, { _id: 'b', text: '乙愿' }] } }
    await homePageCfg.loadWishWallMarquee.call(mqPageInst)
    check(
      '★ 失败后可重试（清掉"已拉过"标记；否则本次会话永远没有跑马灯）',
      afterFail === 1 && mqCalls === 2 && mqPageInst.data.wishWallWishes.length === 2,
      `calls ${afterFail}→${mqCalls}，wishes ${mqPageInst.data.wishWallWishes.length}`
    )

    // 成功后同一会话不重复打云函数（水合缓存 + SWR 两条路径共用一次结果）
    const settledCalls = mqCalls
    await homePageCfg.loadWishWallMarquee.call(mqPageInst)
    check('★ 同一会话只拉一次（缓存与 SWR 两条路径不会各打一次云函数）', mqCalls === settledCalls)

    // 刷新：重置标记后必须重新拉（首页是 tab 页，会话可以很长）
    homePageCfg.resetWishWallMarquee.call(mqPageInst)
    mqReply = { result: { list: [{ _id: 'c', text: '丙愿' }, { _id: 'd', text: '丁愿' }] } }
    await homePageCfg.loadWishWallMarquee.call(mqPageInst)
    check(
      '★ 下拉刷新/错误重试后重新拉一次（否则会话内永远停在旧心愿）',
      mqCalls === settledCalls + 1 && mqPageInst.data.wishWallWishes[0].text === '丙愿'
    )

    // 文案归一化（页面侧）：换行折叠 + 纯零宽条目剔除
    mqReply = { result: { list: [{ _id: 'e', text: '  甲\n乙  ' }, { _id: 'f', text: '\u200b\u200b' }, { _id: 'g', text: '丙愿' }] } }
    homePageCfg.resetWishWallMarquee.call(mqPageInst)
    await homePageCfg.loadWishWallMarquee.call(mqPageInst)
    check(
      '★ 页面把换行折叠、把纯零宽条目剔除（否则跑马灯多一个看不见字的空位）',
      mqPageInst.data.wishWallWishes.length === 2 && mqPageInst.data.wishWallWishes[0].text === '甲 乙',
      JSON.stringify(mqPageInst.data.wishWallWishes)
    )

    // 两个刷新入口都要重置（少一个就有一条"永远不更新"的死路）
    const handlerBody = (name) => {
      const start = homeJs.indexOf(`\n  ${name}(`)
      if (start === -1) return ''
      const end = homeJs.indexOf('\n  },', start)
      return end === -1 ? homeJs.slice(start) : homeJs.slice(start, end)
    }
    check(
      '★ 下拉刷新与错误重试**两个**入口都重置跑马灯',
      /resetWishWallMarquee\(\)/.test(handlerBody('onPullDownRefresh')) &&
        /resetWishWallMarquee\(\)/.test(handlerBody('onRetryLoad'))
    )
  } finally {
    globalThis.wx = homeWxPrev
  }
}


/* ------------------------------------------------------------------ *
 * 4g) 第五轮：落愿闭环 / 墙面可点 / 今日额度 / 分段控件
 *
 * 这轮补的四件事都围绕一个判断：**墙是这个页面的主角，但它此前只读**；
 * 而"挂上墙"只有一个 toast，心愿落在墙上的过程看不见。
 * ------------------------------------------------------------------ */

// ---- 额度口径必须与云函数同源 ----
{
  const fnLimit = /const DAILY_LIMIT = (\d+)/.exec(readSrc('miniprogram/cloudfunctions/manageWishWall/index.js'))
  check('云函数仍导出 DAILY_LIMIT（口径可被比对）', /module\.exports\.DAILY_LIMIT = DAILY_LIMIT/.test(readSrc('miniprogram/cloudfunctions/manageWishWall/index.js')))
  check(
    '★ 客户端额度上限 === 云函数 DAILY_LIMIT（漂移即"说我还能写、写完却被拒"）',
    !!fnLimit && wish.DAILY_LIMIT === Number(fnLimit[1]),
    `客户端 ${wish.DAILY_LIMIT} vs 云函数 ${fnLimit && fnLimit[1]}`
  )
}

// ---- 时间解析：云函数回包可能是 { $date } ----
{
  const t = 1758000000000
  eq('wishTimeMs 认数字', wish.wishTimeMs(t), t)
  eq('wishTimeMs 认 Date', wish.wishTimeMs(new Date(t)), t)
  eq('wishTimeMs 认 ISO 串', wish.wishTimeMs('2026-09-16T00:00:00.000Z'), Date.parse('2026-09-16T00:00:00.000Z'))
  eq('★ wishTimeMs 认云日期 {$date}（本仓已有 4 处按此兼容）', wish.wishTimeMs({ $date: t }), t)
  eq('wishTimeMs 认 {$date} 里再套一层', wish.wishTimeMs({ $date: { $date: t } }), t)
  eq('wishTimeMs 脏数据不崩', wish.wishTimeMs({ nope: 1 }), 0)
  eq('wishTimeMs 空值', wish.wishTimeMs(null) + wish.wishTimeMs('') + wish.wishTimeMs(undefined), 0)
  eq('wishTimeMs NaN 不崩', wish.wishTimeMs(NaN), 0)
  check(
    '★ formatWishTime 走稳健解析（原实现裸 new Date：{$date} 会让愿签时间静默变空）',
    wish.formatWishTime({ $date: Date.now() - 3600000 }, Date.now()) !== ''
  )
}

// ---- 今日额度 ----
{
  const now = Date.now()
  const todayIso = new Date(now).toISOString()
  const yestIso = new Date(now - 86400000 * 2).toISOString()
  const mk = (n, v) => Array(n).fill(0).map(() => ({ createTime: v }))
  eq('额度：没写过 → 满额', wish.dailyQuota([], now).left, wish.DAILY_LIMIT)
  eq('额度：今天 4 条 → 还剩 1', wish.dailyQuota(mk(4, todayIso), now).left, 1)
  eq('额度：今天 5 条 → 用完', wish.dailyQuota(mk(5, todayIso), now).exhausted, true)
  eq('额度：今天 6 条（异常）→ 不为负', wish.dailyQuota(mk(6, todayIso), now).left, 0)
  eq('★ 额度只算今天（前天的 3 条不算用量）', wish.dailyQuota(mk(3, yestIso), now).used, 0)
  eq('★ 额度认 {$date}（否则明明写满还提示"还可写 5 条"）', wish.dailyQuota([{ createTime: { $date: now } }], now).used, 1)
  eq('额度：脏数据不计数', wish.dailyQuota([null, { createTime: 'bad' }, {}], now).used, 0)
  eq('额度：上限可覆写', wish.dailyQuota(mk(2, todayIso), now, 2).exhausted, true)
  eq('额度：上限 0 也不会出现负数', wish.dailyQuota(mk(1, todayIso), now, 0).left, 0)
}

// ---- 弹幕行携带身份：墙面才能标注记、点开愿签 ----
{
  const rows = wish.buildDanmakuRows([
    { _id: 'a1', text: '马上有钱', pinned: true },
    { _id: 'a2', text: '马上有闲', source: 'ai' },
    { _id: 'a3', text: '马上有光', isMine: true }
  ])
  eq('弹幕行带 _id（点开愿签靠它）', rows.map((r) => r.id).join(','), 'a1,a2,a3')
  eq('弹幕行带置顶标记', rows[0].pinned, true)
  check('弹幕行可标馆方（official 由页面算好传入）', rows[1].official === false || rows[1].official === true)
  eq('弹幕行默认不带 official（页面负责算）', rows[0].official, false)
  eq('弹幕行带「我的」标记', rows[2].isMine, true)
  check('弹幕行仍带轨道与排期（未被身份字段破坏）', typeof rows[0].lane === 'number' && rows[0].durationMs > 0)
}

// ---- 页面：落愿闭环 / 额度 / 可点 ----


// ---- 行为级：驱动真实页面 JS（乐观落地 + 额度拦截 + 高亮续标） ----


// ---- 行为级：注册转化（未注册 → 落愿时弹注册 → 注册成功自动续发）----
// 产品口径：浏览与仪式免费，**落愿才要身份**。这一条链路断在哪一环，转化就断在哪一环。


/* ================================================================== *
 * 10) 多面墙内容正确性：**句式前缀必须跟着墙走**
 *
 * AI 播种原来把句式写死成「马上有XX」。多面墙之后这不是"不够灵活"，而是**生成错内容**：
 * 给第二面墙铺满「马上有XX」，那是别的墙的话。人工基线同理（24 条全是马上有写的）。
 * ================================================================== */

eq('前缀归一化：留空回落「马上有」', seeds.normalizePrefix(''), '马上有')
eq('前缀归一化：去空白（句式里不能有空格）', seeds.normalizePrefix('  月 兔 '), '月兔')
eq('前缀归一化：截到 6 字', seeds.normalizePrefix('一二三四五六七八').length, seeds.PREFIX_MAX)
check('默认前缀下「马上有光」合格', seeds.isSeedPhrase('马上有光', '马上有') === true)
check('★ 自定义前缀下「马上有光」**不合格**（第二面墙不该长马上有的话）', seeds.isSeedPhrase('马上有光', '月兔') === false)
check('★ 自定义前缀下「月兔捣药」合格', seeds.isSeedPhrase('月兔捣药', '月兔') === true)
check('不传前缀时按默认（向后兼容旧调用）', seeds.isSeedPhrase('马上有光') === true)
eq(
  '★ selectNewSeeds 按传入前缀筛（不是按写死的前缀）',
  seeds.selectNewSeeds({ candidates: ['马上有光', '月兔捣药'], existing: [], limit: 9, prefix: '月兔' }).join(','),
  '月兔捣药'
)
const promptDefault = seeds.buildSeedPrompt({ count: 4, avoid: [], prefix: '马上有' })
const promptCustom = seeds.buildSeedPrompt({ count: 4, avoid: [], prefix: '月兔' })
check('默认前缀的提示词给风格样本', promptDefault.indexOf('马上有闲') !== -1)
check('★ 自定义前缀的提示词**不给**「马上有」样本（会把句式带偏）', promptCustom.indexOf('马上有闲') === -1)
check(
  '★ 自定义前缀写进句式要求与输出示例',
  promptCustom.indexOf('「月兔 + 2–6 个字') !== -1 && promptCustom.indexOf('["月兔X","月兔Y"]') !== -1
)

check(
  '★ 播种把句式前缀带给云端',
  /action: 'staffSeedAi',[\s\S]{0,220}?prefix: this\.effectiveSeedPrefix\(\)/.test(managePage)
)
check('管理页有句式前缀输入', /bindinput="onSeedPrefixInput"/.test(manageWxml) && /seedPrefix/.test(managePage))
check(
  '前缀与云端同口径（去空白 + 截 6 字）',
  /effectiveSeedPrefix\(\)\s*\{[\s\S]{0,220}?replace\(\/\\s\+\/g, ''\)\.slice\(0, 6\)/.test(managePage)
)
check('切墙同时清掉句式前缀（上一个墙的句式不适用）', /switchWall\(e\)[\s\S]{0,520}?seedPrefix: ''/.test(managePage))
check('结果里回报用的是哪个前缀', /\{\{seedResult\.prefix\}\}/.test(manageWxml))
check('UI 说明非默认墙必须改前缀', /给别的墙面生成内容时要改这里/.test(manageWxml))

check(
  '★ 人工基线只在默认前缀下兜底（24 条都是「马上有XX」写的）',
  /const baseTexts = isDefaultPrefix[\s\S]{0,80}?\? selectNewSeeds\(\{[\s\S]{0,220}?: \[\]/.test(wishWallFnSrc)
)
check(
  '自定义前缀没内容时给出可辨识的拒绝码与说明',
  /code: 'NO_NEW_SEED'[\s\S]{0,420}?自定义前缀没有人工基线兜底/.test(wishWallFnSrc)
)
check('播种响应回报 prefix（运维要知道这批是什么句式）', /prefix,\s*\n\s*aiUsed/.test(wishWallFnSrc))

/* ================================================================== *
 * 11) 注册转化：祈福墙是**注册转化路径**（2026-09-18 产品口径，对齐 AI 识别）
 *
 * 口径：**浏览与仪式免费（价值先行），落愿这一步才要身份** ——
 * 心愿挂在谁名下、以后回看谁的心愿，都要账号。所以门禁挂在 submitWish，不在进页。
 * 三条硬要求：① 未注册才弹；② 注册成功后**自动续发**那条心愿（意图不丢）；
 * ③ 会话读失败 **fail-open**（注册引导是转化动作，不能把核心功能挡下来）。
 * ================================================================== */


check(
  '★ 漏斗在 ERP 报表侧有登记（否则"埋了但报表看不到"）',
  /wish_wall_register_gate/.test(readSrc('admin/src/utils/analyticsSchema.js')) &&
    /wish_wall_register_gate:dismiss/.test(readSrc('admin/src/utils/analyticsSchema.js')) &&
    /wish_wall_register_gate:resume_success/.test(readSrc('admin/src/utils/analyticsSchema.js'))
)

/* ------------------------------------------------------------------ *
 * 2026-09-21（P1-3）**端到端一致性**：客户端实发的 targetType/targetId
 * 必须与「报表侧读的维度」同一口径 —— 单看任何一边都发现不了。
 *
 * 为什么必须在这里立判据（审计原话）：`check:wall-monitor` 用**合成行**
 * （`targetId:'ok'`）自测，**从不核对客户端实发值**，所以它 27/27 全绿也盖不住
 * 「落愿行恒 0」这个真缺陷。判据必须**同时**读三处：客户端实发、事件 schema 声明、
 * 报表行的过滤口径。这就是"守卫判据没覆盖到那一层"的补口。
 * ------------------------------------------------------------------ */


/* ================================================================== *
 * 12) 视觉与排版：弹幕配色必须对**当前墙面**达标；仪式两卡必须等宽等高
 *
 * 这一节的判据是**算出来的**，不是"看代码像对的"：
 *   · 弹幕 6 档配色曾经是按**深色墙**配的，墙面改成浅纸后只剩 1.0–1.8:1（AA 需 4.5:1）——
 *     最浅的「素笺」几乎隐形。所以这里直接算 WCAG 对比度：色值从 WXSS 读，底色从墙面渐变读。
 *   · 仪式两卡此前**不等宽**（左卡没有 flex/grid 份额）也**不等高**（左卡留着竖排时代的
 *     margin-bottom）。这类问题不报错、不失败，只能靠断言钉住。
 * ================================================================== */

// —— WCAG 相对亮度 / 对比度（纯函数，测试内自算，不依赖任何库）——
const _lin = (c) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}
const _lum = (hex) => {
  const n = parseInt(String(hex).replace('#', ''), 16)
  return 0.2126 * _lin((n >> 16) & 255) + 0.7152 * _lin((n >> 8) & 255) + 0.0722 * _lin(n & 255)
}
const contrast = (a, b) => {
  const l1 = _lum(a)
  const l2 = _lum(b)
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

const AA_TEXT = 4.5


// —— 仪式两卡：严格等宽 + 等高 + 顶对齐 ——


// ⚠️ 判据修正（2026-09-18 真图复核）：上一版断言"两卡都 flex-start、基线同高"是**我的推断**，
// 真机截图否掉了它 —— 木鱼卡只有两行，等高之后顶对齐会在底部留一大片空白。
// 正确口径：两卡**内边距一致**（这是"像一对"的来源）；灯卡顶对齐（内容三行、填满），
// 木鱼卡垂直居中（内容短，顶对齐就空）。断言按这个口径写，不是放宽而是改对。
// 判据改成**从 WXSS 里读出来比**，而不是钉死 "22rpx 20rpx"：钉死字面量时，
// 同一轮改两处（灯卡 + 木鱼卡）只要漏一处就红，改对了也要改断言 —— 判据应该只表达"两者相同"。


// —— 灯语文案：整行排版 + 纵向节奏 + 文案池长度上限 ——
// 起因（2026-09-18 真机截图，产品反馈「文案过于拥挤」）：灯语原来留在 ~220rpx 的文案列里，
// 「灯亮着，就还有没说完的心愿。」第二行只剩 3 个字（"的心愿。"孤字），徽章/正文/说明三行小字挤在一起。


// 判据是"关系"而不是字面值：字号层级（标题 > 灯语 > 灯位说明）+ 段间距/行距下限


// 文案池长度上限**实算**：整行可用宽 = 750 − 2×页面左右 padding − 2×卡片左右 padding，
// 除以灯语字号得到"一行几字"，再留 1 字余量。改字号/内边距时判据跟着走，不用手改数字。
const pagePadX = Number((/--space-4:\s*(\d+)rpx/.exec(readSrc('miniprogram/app.wxss')) || [])[1])

const cardW = (750 - 2 * pagePadX - 16) / 2


/* ================================================================== *
 * 设计令牌落地 / 按压反馈一致性 / 无障碍可达性（2026-09-19 质感批次）
 *
 * 为什么这几条必须单独守：
 *   ① 字阶令牌（契约 C7 的 14 档）在本页此前**一次都没被引用**（全仓引用率 7/4403 ≈ 0.16%）。
 *      本批把本页 71 处 `font-size: Nrpx` 换成 `var(--fs-N)`；判据必须钉住"不许再写回裸值"，
 *      否则下一轮改版又会静默长出 22rpx / 26rpx —— 这是"令牌定义了但没人用"的复发路径。
 *   ② 同值间距：`--space-*` 只有 7 档，本页原来把 24rpx / 32rpx 这类**正好等于令牌**的值写成裸数字。
 *      判据不是"间距必须等于令牌"（本页大量 20/22rpx 是版式需要），而是"与令牌同值的必须写令牌"。
 *   ③ `hover-class` 是"点了有没有反馈"的唯一证据：类名写错 = 无反馈，且 WXSS 不会报错。
 *      既要"每个 hover-class 都有同名规则"，也要"同族控件同值"。
 *   ④ `aria-role` 是读屏能不能把 <view> 当按钮读出来的唯一开关；装饰圆点必须 aria-hidden。
 * ------------------------------------------------------------------ */

// —— ① 字号：只允许 var(--fs-*) ，或登记在册的非令牌值 ——
// 非令牌白名单（每条给理由，禁止"因为红了就加"；依据 docs/字阶令牌冻结提案_2026-09-19.md §5.2）：
//   19rpx×4 / 21rpx×2 —— **缺档值**（在 18/20 与 20/22 正中间）。补这两档要把契约 C7 的"14 档"
//                        改成 16 档（属产品/契约决定）；改值 1rpx 等于在两档正中间替产品选边。
//   25rpx×1（.ww-sheet-line）—— 距 --fs-24 仅 1rpx；
//   42rpx×1（.ww-card-text） —— 距 --fs-40 2rpx。
//   后两条**改值会真的改观感**（字号是硬几何），静态判据证不了"同值可替代"，故本批不动、只登记；
//   真机确认过再动，届时同步下调本表（本判据会强制这一步）。


// ①-a 写法退化：**在册值**（= --fs-* 的 14 个值）一律不许再写裸字面量 —— 本页已全部令牌化


// —— ③ 按压反馈一致性 ——


// 2026-09-21（§11.4）："去补资料行"随玩法搬到玩法页，按压反馈在**共享玩法样式**里（`.rp-press`）。
// 语义不变：入口与玩法页同族可点面保持同一套手感（跨页也不许分叉）。


// 2026-09-22 接线：愿签段（卡片 / 分段 / 筛选 / 加载更多 / 详情）搬进 <wall-feed>，
// 这三条通用可点性判据的**扫描面必须一起搬**，否则组件里的 hover-class / aria-role 回归
// 没有任何判据接得住（注入打到组件就成了没人接的空枪）。


// —— ④ 无障碍：可点元素必须有 role；装饰圆点必须 aria-hidden ——


// 反向：aria-hidden **不许盖住文案**。
// 起因（本批自查发现）：给推荐 CTA（现文案「去看 ›」）顺手加了 aria-hidden —— 它是 CTA 文案，
// 一隐藏就等于对读屏用户砍掉了"抽一句 → 看藏品"这条主路的出口。装饰与文案的边界必须由判据兜住。
// ⚠️ 2026-09-21（§11.4）：这条 CTA 随玩法结果搬到**四个玩法页**（`.rp-reco-go`）——
// 扫描面必须一起搬，否则注入打到玩法页就没人接（切片自检当场抓到）。
// 2026-09-22 接线：愿签流组件也在本页渲染，扫描面含组件 WXML


// —— ⑤ 死选择器 / 重复声明 ——


// —— ⑥ 愿签卡 / 骨架的底面一致（换卡那一帧不许跳色）——
// 2026-09-22 接线：愿签卡与骨架都搬进组件，判据读组件真源（页面残留的 .ww-tag 规则已废）


// —— 灯芯图标（2026-09-18 产品指定：用附件里的灯泡 SVG）——
// data URI 的两种 encoding 都算数（percent-encoded / ;base64），只要它是**内联矢量图**：
// 微信 <image> 不渲染 svg 文件、本仓也零先例，所以「是 data URI」才是关键判据。


/* ================================================================== *
 * 即时反馈层（需求 28 · 玩法动作 → 音效 + 墙上回声）
 *
 * 这一层最容易"看起来做了、其实不响"：素材路径写错、开关没落盘、闸门写反、
 * 回声文案超长、墙上的 DOM 没接上 —— 全都不报错。所以下面每组都配了注入。
 * ================================================================== */


// ① 素材：登记了就必须能响（文件不在 = 永远静音，且没有任何提示）


// 每个登记在册的音色都要有真文件（漏一个 = 那个动作"接了音效但永远不响"）


/* （2026-09-20 曾在此加过 5 条「时刻音」判据 —— 上墙成功自动播 6 秒推广曲副歌。
   产品负责人当天裁决撤掉：「还是别放音乐了，过于突兀」→ 机制与判据一并删除。
   若日后改成**用户主动点**的形态，再按那时的设计补判据，不要恢复自动播放。） */


// ② 开关：默认开 / 可关 / 落盘 / 往返可逆（用 wx 桩驱动真实模块）


// ③ 频率闸门 + 播放器（连点不叠音是手感问题，不是性能问题）


// ④ 回声文案：长度 / 人称 / 确定性 / 未知动作


// ⑤ 页面接线（驱动真实页面方法）


// ⑥ 源码级接线（onLoad 这种没法在 harness 里整段跑的方法，按"接了什么"断言）


// ⑦ 墙上的回声：DOM / 位置 / 时长同源


// 长度可能是 `44rpx` 也可能是 `0`（无单位），两种都要读得出来 —— 否则判据会拿 NaN 比大小
const lenIn = (block, prop) => {
  const m = new RegExp(`${prop}:\\s*(-?[\\d.]+)(rpx)?`).exec(block)
  return m ? Number(m[1]) : NaN
}


/* ================================================================== *
 * 注册钩子的「去注册」环节（2026-09-18 产品反馈"数据报表里没有祈福墙数据"）
 *
 * 报表看不到祈福墙 = ①报表没算它 ②漏斗缺"去注册"这一环，两件事本轮都补了。
 * 这里钉住 C 端那一半：点了弹窗里的授权按钮，必须真的上报 step=go_register。
 * ================================================================== */


/* ================================================================== *
 * 版式与交互（需求 7 · 2026-09-18 真机截图驱动）
 *
 * 这轮改的三件事都属于"改了看不见、错了也不报错"：
 *   1) 轨道刻度百分比（与弹幕 topPercent 是两套写法 → 必须实算对账）；
 *   2) 墙页脚变成「看全部 ›」的入口（绑掉了就只是个不会动的字）；
 *   3) 已点亮的灯再点一次（原来弹 toast，现在动效 + 回声 → 别又绕回弹窗）。
 * ================================================================== */

// ① 刻度百分比 = buildDanmakuRows 的 topPercent（用真实函数输出对账，不重写公式）
const laneTops = wish
  .buildDanmakuRows(Array.from({ length: wish.LANES }, (_, i) => ({ _id: 't' + i, text: '马上有钱' })))
  .map((r) => r.topPercent)


// ② 墙页脚 = 「墙面 → 愿签列表」入口


// ③ 已点亮的灯再点一次：动效 + 回声，**不许弹 toast**（灯语已经写在卡上了）


/* ================================================================== *
 * 玩法第一批（需求 5 · 今日一签 / 拆签饼 / 星座签 / MBTI 贴士）
 *
 * 这一批最容易出的三类问题：
 *   1) **合规**：文案里冒出算命/改运/预测吉凶这类表述（微信对占卜类内容从严）；
 *   2) **确定性**：结果用了随机数 → 刷新就换一个，"今日一签"就不成立了；
 *   3) **假结果**：需要星座/MBTI 而资料里没有，却还是编一个给用户。
 * 三条都配了注入。
 * ================================================================== */

const plays = loadCjs('miniprogram/subpackages/plays/config/ritualPlays.js', { require: markerRequire })
const playContent = loadCjs('miniprogram/subpackages/plays/config/ritualPlayContent.js', { require: markerRequire })
const profileConstants = loadCjs('miniprogram/utils/profileConstants.js', { require: markerRequire })
const playWishWall = loadCjs('miniprogram/utils/wishWall.js', { require: markerRequire })
// 带 require 的模块必须给「标记式」桩：harness 的默认 fallback 抛的是另一句话，
// 会被当成真实错误直接抛出（easterEgg 那处也是这么接的）
const ritualPlay = loadCjs('miniprogram/subpackages/plays/utils/ritualPlay.js', {
  require: (id) => {
    if (id === '../config/ritualPlays') return plays
    if (id === '../config/ritualPlayContent') return playContent
    if (id === './profileConstants') return profileConstants
    if (id === './wishWall') return playWishWall
    throw new Error('unexpected require ' + id)
  }
})

/** 去掉 JS / WXML 注释：禁词扫描只针对**真正会给用户看的字符串**，注释里写"不出现算命"不算违规 */
function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

// ① 注册表：字段齐、id 唯一、needs 受控、回声是第一人称短句
const playList = plays.RITUAL_PLAYS
check('玩法注册表至少 4 个玩法（第一批：签 / 饼 / 星座 / MBTI）', playList.length >= 4, `count=${playList.length}`)
check(
  '每个玩法字段齐（id/mark/name/hint/cta/pool/echo）',
  playList.every(
    (p) => p.id && p.mark && p.name && p.hint && p.cta && p.pool && p.echo && p.daily === true
  )
)
// 2026-09-21（PRD v1.4 §11.4「玩法各开一页」）：注册表还要声明**页面与形态** ——
// 入口区靠它跳转、玩法页靠它选纸面语言，所以字段缺失就是"点了没反应/长得一样"。
check(
  '★ 每个玩法都登记独立页路径 / 结果纸面语言 / 入口形态 / 进行态参数（缺一个就不是"独立闭环"）',
  playList.every((p) => /^\/subpackages\/plays\/play-[a-z]+\/index$/.test(String(p.page || '')) &&
    p.kind && p.form && Number(p.spinMs) > 0 && p.spinText && p.entryNote && p.doneNote),
  playList.map((p) => `${p.id}:${p.page}`).join(' / ')
)
// 2026-09-27：入口 2×3 格状态句硬性字数预算 —— 长尾「再进去看这×」会折行，六格行高参差
// 上限 9：允许「今天已摇 · 再看」这种带中点号两侧空格的短句（9 码点）
check(
  '★ 入口状态句字数预算（entryNote≤6 / doneNote≤9，按码点计；中点号后不许长尾巴）',
  playList.every((p) => [...String(p.entryNote)].length <= 6 && [...String(p.doneNote)].length <= 9),
  playList.map((p) => `${p.id}:entry ${[...String(p.entryNote)].length}/done ${[...String(p.doneNote)].length}`).join(' · ')
)


check(
  '★ 玩法页路径各不相同（四个玩法**各开一页**，不是一个页面挂四个参数）',
  new Set(playList.map((p) => p.page)).size === playList.length
)
check(
  '★ 入口形态至少三种且不重复（不再是"四枚同质瓦片"）',
  new Set(playList.map((p) => p.form)).size >= 3,
  playList.map((p) => `${p.id}=${p.form}`).join(' / ')
)
check(
  '玩法页路径都在 app.json 注册过（否则 check:page-paths 之外没人拦得住"点了白屏"）',
  (() => {
    const appJson = JSON.parse(readFileSync(resolve(ROOT, 'miniprogram/app.json'), 'utf8'))
    const reg = new Set()
    for (const sp of appJson.subpackages || []) {
      for (const pg of sp.pages || []) reg.add(`/${String(sp.root).replace(/\/$/, '')}/${pg}`)
    }
    // 2026-10-17：五个玩法下线，注册表数据保留（祈运标签四处副本引用其 id）——
    //   判据改为：**有页面的玩法必须注册**；**没页面的必须恰好是登记过的退场玩法**（新增玩法忘了建页照样红）
    const RETIRED = ['cookie', 'zodiac', 'mbti', 'solar', 'coin']
    const live = playList.filter((p) => reg.has(p.page))
    const missing = playList.filter((p) => !reg.has(p.page)).map((p) => p.id).sort()
    return live.length >= 1 && JSON.stringify(missing) === JSON.stringify([...RETIRED].sort())
  })()
)
check('玩法 id 唯一（埋点与内容 seed 都用它）', new Set(playList.map((p) => p.id)).size === playList.length)
check(
  '玩法字标是单字（瓦片上的铜圈只放得下一个字）',
  playList.every((p) => [...String(p.mark)].length === 1)
)
check(
  'needs 只用受控字段（zodiac / mbti）',
  playList.every((p) => (p.needs || []).every((f) => ['zodiac', 'mbti'].includes(f)) && (p.needs || []).length <= 1)
)
check('需要资料字段的玩法都有引导元数据（标签 + 落点 + 奖励）',
  playList.filter((p) => (p.needs || []).length).every((p) => {
    const meta = plays.NEED_PROFILE_FIELDS[p.needs[0]]
    return meta && meta.label && meta.anchor && meta.gain
  })
)


// ② 内容池：池子存在且非空、键与资料选项一一对应
check(
  '玩法引用的内容池都存在且非空',
  playList.every((p) => {
    const get = ritualPlay.POOLS[p.pool]
    if (!get) return false
    const pool = get()
    if (Array.isArray(pool)) return pool.length > 0
    return !!(pool && typeof pool === 'object' && Object.keys(pool).length > 0)
  })
)
check(
  '★ 节气签内容池覆盖二十四节气（与 wishWall.SOLAR_TERMS 一一对应）',
  playWishWall.SOLAR_TERMS.every((t) => {
    const row = playContent.SOLAR_LINES[t.name]
    return row && row.line && row.advice && row.wish
  }),
  `keys=${Object.keys(playContent.SOLAR_LINES || {}).length}`
)
check(
  '★ 铜钱签每条都有面文一字 + 一句 + 建议 + 心愿词',
  Array.isArray(playContent.COIN) &&
    playContent.COIN.length >= 8 &&
    playContent.COIN.every((r) => r.face && [...String(r.face)].length === 1 && r.line && r.advice && r.wish)
)
check(
  '星座底色的键与资料页 ZODIAC_OPTIONS 完全对齐（少一个星座就没结果）',
  profileConstants.ZODIAC_OPTIONS.every((z) => !!playContent.ZODIAC_HOOKS[z.key]) &&
    Object.keys(playContent.ZODIAC_HOOKS).length === profileConstants.ZODIAC_OPTIONS.length
)
check(
  'MBTI 底色的键与资料页 MBTI_OPTIONS 完全对齐（16 型一个不少）',
  profileConstants.MBTI_OPTIONS.every((t) => !!playContent.MBTI_HOOKS[t]) &&
    Object.keys(playContent.MBTI_HOOKS).length === profileConstants.MBTI_OPTIONS.length
)
check(
  '今日一签每条都有 宜/忌/一句/心愿词',
  playContent.QIAN.every((r) => r.yi && r.ji && r.line && r.wish)
)
check('签饼每条都有 签条 + 建议', playContent.COOKIE.every((r) => r.line && r.advice))

// ③ 合规术语守卫（PRD §7 + §11.3）：这些词出现在给用户看的文案里就是审核风险。
// 2026-09-21 追加 §11.3 的三个词：应验 / 消灾 / 因果报应（官方类目指引没有占卜/命理类目）。
const FORBIDDEN_TERMS = [
  '算命', '占卜', '卜卦', '算卦', '卦象', '改运', '转运', '开运', '风水', '看相',
  '八字', '紫微', '塔罗', '吉凶', '预测', '大师', '命理', '招财', '辟邪',
  '应验', '消灾', '因果报应'
]
// ⚠️ 扫描面必须**覆盖玩法页**（§11.4 之后文案大多写在那里）——
// 上一版只扫祈福墙页，等于玩法页的文案没有任何合规守卫。
// 2026-10-17：五个玩法页下线，扫描面 = 仍在线的今日一签 + 现役的「马上有 · 心愿签」（旧墙页已是转跳薄壳）
const PLAY_PAGE_FILES = ['play-qian'].map((n) => `miniprogram/subpackages/plays/${n}/index.wxml`)
const playTextSources = {
  '注册表': stripComments(readSrc('miniprogram/subpackages/plays/config/ritualPlays.js')),
  '内容池': stripComments(readSrc('miniprogram/subpackages/plays/config/ritualPlayContent.js')),
  '玩法逻辑': stripComments(readSrc('miniprogram/subpackages/plays/utils/ritualPlay.js')),
  '玩法页工厂': stripComments(readSrc('miniprogram/subpackages/plays/utils/ritualPlayPage.js')),
  '心愿签 JS': stripComments(readSrc('miniprogram/subpackages/feature/wish-labels/index.js')),
  '心愿签 WXML': stripComments(readSrc('miniprogram/subpackages/feature/wish-labels/index.wxml')),
  '心愿签文案': stripComments(readSrc('miniprogram/subpackages/feature/wish-labels/labels.js'))
}
PLAY_PAGE_FILES.forEach((f) => { playTextSources[`玩法页 ${f.split('/').pop()}`] = stripComments(readSrc(f)) })
const foundForbidden = []
Object.entries(playTextSources).forEach(([name, src]) => {
  FORBIDDEN_TERMS.forEach((term) => {
    if (src.includes(term)) foundForbidden.push(`${name}:${term}`)
  })
})
check('合规扫描面非空（今日一签 + 心愿签 + 玩法配置，防「什么都没扫也全绿」）', Object.keys(playTextSources).length >= 8, Object.keys(playTextSources).join(','))

check(
  '★ 玩法文案里不含命理/占卜类表述（文化娱乐向，微信对这类内容从严）',
  foundForbidden.length === 0,
  foundForbidden.join(' / ')
)

// ④ 逻辑：确定性 / 资料门禁 / 心愿词形态 / 分享不带依据
const DAY_A = '2026-09-18'
const DAY_B = '2026-09-19'
const FULL_PROFILE = { zodiac: 'aries', mbti: 'INFP' }
const DETERMINISM_DAYS = ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22']
check(
  '★ seed 只由「玩法 + 日期」决定（不含时间戳/随机数 —— 判据直接看 seed 的形状）',
  ritualPlay.playSeed('qian', DAY_A) === ritualPlay.playSeed('qian', DAY_A) &&
    /^qian\|\d{4}-\d{2}-\d{2}$/.test(ritualPlay.playSeed('qian', DAY_A)),
  ritualPlay.playSeed('qian', DAY_A)
)
check(
  '★ 同一天同一玩法结果完全一致（连测 5 天，随机数不可能 5 天全中）',
  DETERMINISM_DAYS.map((d) => JSON.stringify(ritualPlay.resolvePlay('qian', { dayKey: d }))).join('|') ===
    DETERMINISM_DAYS.map((d) => JSON.stringify(ritualPlay.resolvePlay('qian', { dayKey: d }))).join('|')
)
const dayResults = DETERMINISM_DAYS.map(
  (d) => ritualPlay.resolvePlay('qian', { dayKey: d }).title
)
check('★ 换一天会换一支签（不是永远同一句）', new Set(dayResults).size > 1, dayResults.join(' / '))
check(
  '★ 缺资料时返回 need_profile（不给假结果），并带上引导信息',
  (() => {
    const r = ritualPlay.resolvePlay('zodiac', { dayKey: DAY_A, profile: {} })
    return r.ok === false && r.reason === 'need_profile' && r.field === 'zodiac' && !!r.anchor && !!r.profilePage
  })()
)
check(
  '资料齐了就能出结果（星座 / MBTI 各自都有）',
  ritualPlay.resolvePlay('zodiac', { dayKey: DAY_A, profile: FULL_PROFILE }).ok === true &&
    ritualPlay.resolvePlay('mbti', { dayKey: DAY_A, profile: FULL_PROFILE }).ok === true
)
check('未知玩法不 produce 结果（页面据此不回显）', ritualPlay.resolvePlay('nope', { dayKey: DAY_A }).ok === false)
const allResults = playList.map((p) =>
  ritualPlay.resolvePlay(p.id, { dayKey: DAY_A, profile: FULL_PROFILE })
)
check(
  '每个玩法都出「标题 + 至少一句正文」',
  allResults.every((r) => r.ok && r.title && (r.lines || []).length > 0)
)
check(
  '★ 心愿词规范化：非「马上有X」一律回落为空（这是预填进写愿签的最后一道锁）',
  ritualPlay.normalizeWish('马上有回音') === '马上有回音' &&
    ritualPlay.normalizeWish('回音') === '' &&
    ritualPlay.normalizeWish(`马上有${'回'.repeat(5)}`) === '' &&
    ritualPlay.normalizeWish('') === '' &&
    ritualPlay.normalizeWish(null) === '',
  ['马上有回音', '回音', '超长', '空', 'null'].join(' / ')
)
check(
  '心愿词要么为空、要么是合法的「马上有X」（1–3 字，且不超弹幕上限）',
  allResults.every((r) => r.wish === '' || (/^马上有[\u4e00-\u9fa5]{1,3}$/.test(r.wish) && r.wish.length <= playWishWall.TEXT_MAX)),
  allResults.map((r) => r.wish || '(空)').join(' / ')
)
check(
  '★ 分享文案不带"依据"（不出现星座名 / MBTI 型别 —— 只公开结果与建议）',
  allResults.every((r) => !r.share.includes('白羊座') && !r.share.includes('INFP')) &&
    ritualPlay.resolvePlay('zodiac', { dayKey: DAY_A, profile: FULL_PROFILE }).share.includes('星座签'),
  ritualPlay.resolvePlay('zodiac', { dayKey: DAY_A, profile: FULL_PROFILE }).share
)

// ⑤ 页面接线（2026-09-21 · PRD v1.4 §11.4「玩法各开一页」后的新形态）：
//   · 祈福墙页 = **入口区**：注册表派生 + 按 `form` 分支 + "今天玩过没有" + 跳注册表里的页路径；
//   · 玩法页 = 完整闭环（进行态 → 结果 → 留档 → 下一步）；行为在工厂里、四页共用。
const playPageDir = (p) => `miniprogram${p.page}`
const playPageWxml = (p) => `${playPageDir(p)}.wxml`
const playPageWxss = (p) => `${playPageDir(p)}.wxss`
const playById = (id) => playList.find((p) => p.id === id)
// 2026-10-17 旧祈福墙退场：玩法页只剩今日一签（其余五个下线；注册表数据仍在，被祈运标签四处副本引用）。
//   读**页面文件**的判据只对仍有页面的玩法跑，且必须包含今日一签（防「一个都不剩也全绿」）。
const livePlays = playList.filter((p) => existsSync(resolve(ROOT, `miniprogram${p.page}.js`)))
check('★ 仍有页面的玩法 = 今日一签（其余已下线；页面判据只对它跑，不是空转）',
  livePlays.length === 1 && livePlays[0].id === 'qian', livePlays.map((p) => p.id).join(','))


// 2026-09-27 产品口径：六个玩法都在祈福墙页完成 —— 入口开**本页弹层**，不再 navigateTo 玩法页。

check(
  '★ 四个玩法页都是"薄壳 + 主包工厂"（行为只有一份，四页共用；加玩法只改注册表 + 一页皮）',
  livePlays.every((p) => /Page\(createRitualPlayPage\('([a-z]+)'\)\)/.test(readSrc(`${playPageDir(p)}.js`))) &&
    /module\.exports = \{\s*createRitualPlayPage/.test(readSrc('miniprogram/subpackages/plays/utils/ritualPlayPage.js'))
)
check(
  '★ 玩法页结果纸面：对话框语义 + 可下拉收起的把手 + 各自一份纸面（四种纸面语言不同）',
  livePlays.every((p) => {
    const wxml = readSrc(playPageWxml(p))
    return /class="rp-paper"/.test(wxml) && /aria-role="dialog"/.test(wxml) &&
      /class="rp-paper-grip"/.test(wxml) && /bindtouchstart="onSheetGripStart"/.test(wxml)
  }) &&
    new Set(livePlays.map((p) => ((/\.rp-paper\s*\{([^}]*)\}/.exec(readSrc(playPageWxss(p))) || [])[1] || '').trim())).size === livePlays.length
)
check(
  '★ 每个玩法页都有自己的进行态（CSS 动效，不用 canvas）',
  livePlays.every((p) => /\.rp-stage\.is-pending\s+\.rp-[\w-]+\s*\{[^}]*animation:/.test(readSrc(playPageWxss(p))))
)
check(
  '★ 结果页「写成心愿」是主 CTA，且排在推荐行**之前**（推荐不许抢注意力）',
  livePlays.every((p) => {
    const wxml = readSrc(playPageWxml(p))
    const cta = wxml.indexOf('bindtap="writeWish"')
    const reco = wxml.indexOf('class="rp-reco"')
    return cta >= 0 && reco > cta
  })
)
check(
  '★ 推荐行：取件中也占位、失败也留位（同高，不整行消失），且只有一条主路',
  livePlays.every((p) => {
    const wxml = readSrc(playPageWxml(p))
    return /wx:if="\{\{reco \|\| productId \|\| recoLoading \|\| recoFailed\}\}"/.test(wxml) &&
      /wx:elif="\{\{recoLoading && !recoFailed\}\}"/.test(wxml) &&
      /wx:elif="\{\{recoFailed\}\}">这次没配到</.test(wxml) &&
      (wxml.match(/class="rp-reco[\s"]/g) || []).length === 1
  })
)
check(
  '★ 结果页分享必须是 <button open-type="share">（view 点了不会转发），且只读 result.share（工厂里没有 card 这个输入）',
  livePlays.every((p) => /<button[\s\S]{0,240}?open-type="share"[\s\S]{0,240}?bindtap="onShareTap"/.test(readSrc(playPageWxml(p)))) &&
    /if \(r && r\.share && fromPlay\) return \{ title: r\.share, path \}/.test(readSrc('miniprogram/subpackages/plays/utils/ritualPlayPage.js')) &&
    // 去注释再判：文件头那句「**没有** `card` 这个输入」是说明文字，不是代码（本仓 E7 老坑）
    !/\bcard\b/.test(stripComments(readSrc('miniprogram/subpackages/plays/utils/ritualPlayPage.js')))
)
check(
  '补资料引导有独立分支（不给假结果的那条路是画出来的，不是只写在注释里）',
  livePlays.every((p) => /wx:if="\{\{stage === 'need'\}\}"/.test(readSrc(playPageWxml(p))) && /bindtap="goProfileField"/.test(readSrc(playPageWxml(p))))
)
check(
  '★ 结果里带"文化一层"（§11.3：只讲来历习俗，不做个人吉凶判断）',
  livePlays.every((p) => /class="rp-note"[^>]*>\{\{result.note\}\}/.test(readSrc(playPageWxml(p)))) &&
    livePlays.every((p) => !!playContent.KIND_NOTES[p.kind])
)
check(
  '★ 今日一签一天一条（页面没有「换一个」，逻辑层也不给变体）',
  !/switchVariant/.test(readSrc(playPageWxml(playById('qian')))) &&
    ritualPlay.variantOptions('qian').length === 0
)


/* ================================================================== *
 * 商品祈运标签 → 祈福墙（需求 6）：标签决定"先看到哪个玩法"与一句墙面提示
 *
 * 跨端一致性（四处副本逐例比对）由 `check:bless-tags-sync` 守卫负责；
 * 这里只管 **C 端行为**：URL 带没带、页面排没排、提示画没画。
 * ================================================================== */

const bless = loadCjs('miniprogram/config/blessTags.js', { require: markerRequire })

check('祈运标签是受控枚举（英文 key + 中文 label，key/label 都唯一）',
  bless.BLESS_TAGS.length >= 4 &&
    new Set(bless.BLESS_TAG_KEYS).size === bless.BLESS_TAGS.length &&
    new Set(bless.BLESS_TAGS.map((t) => t.label)).size === bless.BLESS_TAGS.length
)
check('★ 归一化按 SSOT 顺序输出（同一件商品在任何端保存后顺序都一致，可比 diff）',
  JSON.stringify(bless.sanitizeBlessTags(['success', 'fortune'])) === JSON.stringify(['fortune', 'success']) &&
    JSON.stringify(bless.sanitizeBlessTags('journey, bond')) === JSON.stringify(['bond', 'journey'])
)
check('非法 key / 空段被丢弃，逗号串也认（URL 参数形态）',
  JSON.stringify(bless.sanitizeBlessTags('peace, ,nope')) === JSON.stringify(['peace']) &&
    JSON.stringify(bless.sanitizeBlessTags(null)) === '[]'
)
check(`最多 ${bless.MAX_BLESS_TAGS} 个（标签一多就等于没标签）`,
  bless.sanitizeBlessTags(['fortune', 'peace', 'study', 'bond']).length === bless.MAX_BLESS_TAGS
)
check('玩法推荐顺序：点名玩法在前、其余保持注册表顺序（只重排不隐藏）',
  JSON.stringify(bless.blessPlayIds(['success'])) === JSON.stringify(['qian', 'mbti']) &&
    bless.blessPlayIds([]).length === 0
)
check('每个标签都有对应的墙面提示句', bless.BLESS_TAGS.every((t) => bless.blessGuide([t.key]).length > 0))

const urlWithBless = wish.buildWishWallUrl({ _id: 'p1', title: '孔雀标本', blessTags: ['success', 'peace'] }, { from: 'detail' })
// ⚠️ 期望值按 **SSOT 顺序**（peace 在 success 之前）而不是录入顺序：
// resolveBlessTags 会归一化成受控顺序，这样同一件商品在任何端拼出的 URL/存库值都一致（可比 diff）
check('★ 入口 URL 带上祈运标签、且按受控顺序归一化（详情页手上就有商品对象，不必多发请求）',
  /bless=peace%2Csuccess/.test(urlWithBless), urlWithBless)
check('没有标签的商品 URL 不出现 bless 参数（不留空参数）',
  !/bless=/.test(wish.buildWishWallUrl({ _id: 'p1', title: 'x' }, {})),
  wish.buildWishWallUrl({ _id: 'p1', title: 'x' }, {}))


/* ================================================================== *
 * 祈运选品云函数（需求 6 的弱推链路）：**实跑**真源码，替身只做 db
 *
 * 为什么要实跑而不是看源码里有那行字：这个函数的三条口径都是"行为"——
 *   ① 只按标签取（不兜底热门，否则"求安"会被推成任意热卖）
 *   ② 排除当前这面墙的商品（不给自己推荐自己）
 *   ③ 确定性排序（同一天同一标签，刷两次结果一样）
 * ================================================================== */

const recoBless = loadCjs('miniprogram/cloudfunctions/getBlessProducts/blessTags.js', { require: markerRequire })
/**
 * 极简 db 替身：只支持 products.where().limit().get()。
 * ⚠️ 必须模拟 CloudBase（Mongo）对**数组字段**的语义：`{blessTags: 'peace'}` 是"数组包含"，
 * 不是"数组相等" —— 第一版替身写成了相等，于是真源码全被滤空，看着像功能坏了（假红）。
 */
function makeRecoDb(rows) {
  const matchOne = (row, k, v) => {
    if (v && typeof v === 'object' && v.$neq !== undefined) return row[k] !== v.$neq
    if (v && typeof v === 'object' && v.$in !== undefined) {
      const arr = Array.isArray(row[k]) ? row[k] : [row[k]]
      return v.$in.some((x) => arr.includes(x))
    }
    if (Array.isArray(row[k])) return row[k].includes(v)
    return row[k] === v
  }
  const matcher = (where) => (row) => {
    if (where && where.$and) return where.$and.every((c) => matcher(c)(row))
    if (where && where.$or) return where.$or.some((c) => matcher(c)(row))
    return Object.entries(where).every(([k, v]) => matchOne(row, k, v))
  }
  return {
    command: {
      neq: (v) => ({ $neq: v }),
      in: (v) => ({ $in: v }),
      and: (list) => ({ $and: list }),
      or: (list) => ({ $or: list })
    },
    collection: () => ({
      where: (where) => ({
        limit: (n) => ({
          get: async () => ({ data: (rows || []).filter(matcher(where)).slice(0, n) })
        })
      })
    })
  }
}
function loadRecoFn(rows) {
  const cloudStub = {
    DYNAMIC_CURRENT_ENV: 'env',
    init() {},
    database: () => makeRecoDb(rows)
  }
  return loadCjs('miniprogram/cloudfunctions/getBlessProducts/index.js', {
    require: (id) => {
      if (id === 'wx-server-sdk') return cloudStub
      if (id === './blessTags') return recoBless
      throw new Error('unexpected require ' + id)
    }
  })
}

const RECO_ROWS = [
  { _id: 'a', title: '甲', price: 100, sales: 5, isOffShelf: false, blessTags: ['peace'], category: '昆虫馆' },
  { _id: 'b', title: '乙', price: 200, sales: 9, isOffShelf: false, blessTags: ['peace', 'bond'], category: '矿石馆' },
  { _id: 'c', title: '丙', price: 300, sales: 1, isOffShelf: true, blessTags: ['peace'] },        // 已下架 → 不得出现
  { _id: 'd', title: '丁', price: 400, sales: 99, isOffShelf: false, blessTags: ['fortune'] },     // 别的标签 → 不得出现
  { _id: 'e', title: '戊', price: 500, sales: 2, isOffShelf: false },                             // 没标签没场景 → 不得出现
  { _id: 'f', title: '己', price: 600, sales: 7, isOffShelf: false, giftScenes: ['enrollment'] }   // ★ 只有场景 → 必须被"求学"兜底捞出来
]
const recoFn = loadRecoFn(RECO_ROWS)
{
  // ⚠️ 2026-09-20：选品现在**按天轮换**（"一天一件"不该等于"永远同一件"），
  // 所以下面每一条都必须传**固定 dayKey** —— 否则测试会随"今天是几号"时绿时红
  // （本仓已在 points-ledger 的时区依赖上栽过一次同类坑，见 docs/AI施工错题本）。
  const DAY_A = '2026-09-20'
  const DAY_B = '2026-09-21'
  const res = await recoFn.main({ tag: 'peace', limit: 3, dayKey: DAY_A })
  const ids = res.list.map((x) => x._id)
  check('★ 只返回命中标签且未下架的商品（下架 / 别的标签 / 无标签都不混进来）',
    res.success === true && ids.length === 2 && new Set(ids).size === 2 &&
      ['a', 'b'].every((id) => ids.includes(id)),
    JSON.stringify(ids))
  check('★ 基础排名仍是「销量高的在前」：返回列表必是排名 [b,a] 的**轮换**（b 销量 9 > a 的 5）',
    ['b,a', 'a,b'].includes(ids.join(',')), ids.join(','))
  const res2 = await recoFn.main({ tag: 'peace', limit: 3, dayKey: DAY_A })
  check('★ 同一天同一标签两次结果完全一致（推荐不能刷一次变一个）',
    JSON.stringify(res2) === JSON.stringify(res))
  const resB = await recoFn.main({ tag: 'peace', limit: 3, dayKey: DAY_B })
  check('★ 候选 ≥2 时**跨天会换首件**（"一天一件"不等于"永远同一件"，2026-09-20 修）',
    resB.list[0]._id !== res.list[0]._id,
    `${DAY_A}→${res.list[0]._id}；${DAY_B}→${resB.list[0]._id}`)
  const excluded = await recoFn.main({ tag: 'peace', excludeIds: ['b'], limit: 3, dayKey: DAY_A })
  check('★ 排除当前这面墙的商品（不给自己推荐自己）',
    excluded.list.every((x) => x._id !== 'b') && excluded.list.length === 1,
    JSON.stringify(excluded.list.map((x) => x._id)))
  // ★ 直接单元断言**基础排名**（不经过轮换 → 与日期无关）：
  // 「显式命中优先于场景兜底」——就算兜底那件销量高出三个数量级。
  // 2026-09-20 修：matchSource 此前是**排完序之后**才算的，兜底商品可以压过显式命中，
  // 真机反馈「求缘位推的是前程类商品」即由此而来。
  check('★ 显式命中优先于场景兜底（兜底件销量高 999 倍也排在后面）',
    recoFn.__forTest
      .sortPool(
        [
          { _id: 'sceneHot', price: 200, sales: 999, category: 'X' },
          { _id: 'tagLow', price: 200, sales: 1, category: 'X' }
        ],
        '',
        new Set(['tagLow'])
      )
      .map((x) => x._id)
      .join(',') === 'tagLow,sceneHot')
  // ★ matchSource 逐行判定：'f' 只有场景（→scene），'a'/'b' 显式打了 peace（→tag）
  const peaceRes = await recoFn.main({ tag: 'peace', limit: 5, dayKey: DAY_A })
  const srcOf = (res, id) => (res.list.find((x) => x._id === id) || {}).matchSource
  check(
    '★ 依据逐行标注（显式标签 = tag；场景兜底 = scene）—— 不许一律标成 tag',
    srcOf(peaceRes, 'b') === 'tag' && srcOf(peaceRes, 'a') === 'tag'
  )
  const byScene = await recoFn.main({ tag: 'study', limit: 3, dayKey: DAY_A })
  check('★ 只填了礼赠场景的商品也能被推荐出来（场景兜底查询真的生效）',
    byScene.list.map((x) => x._id).join(',') === 'f', JSON.stringify(byScene.list.map((x) => x._id)))
  // 取不到时**判失败**而不是抛异常 —— 抛异常会让整条守卫中断，看不到后面 700 条断言的结果
  check('★ 靠场景兜底命中的行标成 scene（客户端据此换一句不编社会证明的文案）',
    (byScene.list[0] || {}).matchSource === 'scene', String(byScene.list[0] && byScene.list[0].matchSource))
  check('返回里带上"这次用了哪几支场景兜底"（排查用）',
    JSON.stringify(byScene.scenes) === JSON.stringify(['enrollment']))
  const none = await recoFn.main({ tag: 'journey', limit: 3 })
  check('★ 没有命中的商品就返回空列表（不拿热门兜底 —— 猜出来的推荐 = 乱推）',
    none.success === true && none.list.length === 0, JSON.stringify(none))
  const bad = await recoFn.main({ tag: 'nope' })
  check('未受控的标签直接被拒（不拿脏 key 去查库）',
    bad.success === false && bad.code === 'BAD_TAG' && bad.list.length === 0)
  const capped = await recoFn.main({ tag: 'peace', limit: 99 })
  check('条数上限被钳住（limit 99 → 不超过 6）', capped.list.length <= 6)
}

/* —— C 端弱推：纯函数先行（缓存键 / 取条 / 价格文案），再验接线 —— */
const blessProducts = loadCjs('miniprogram/subpackages/plays/utils/blessProducts.js')
check('★ 推荐缓存键带日期（不带日期 = 跨天还拿昨天的推荐）',
  blessProducts.recoCacheKey('peace', '2026-09-18') !== blessProducts.recoCacheKey('peace', '2026-09-19') &&
    blessProducts.recoCacheKey('peace', '2026-09-18') === 'peace|2026-09-18' &&
    blessProducts.recoCacheKey('', '2026-09-18') === '')
// 只查**用户可见文案**：注释里写"历史上曾用过「同好也在看」"不属于违规
const stripForCopy = (src) => String(src)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

check(
  'pickReco 把依据与文案一起带出（页面不自己拼词）',
  (() => {
    const r = blessProducts.pickReco({ list: [{ _id: 'x', title: 't', matchSource: 'scene' }] }, 'study', '求学') || {}
    return r.matchSource === 'scene' && r.label === '偏「求学」· 为你配一件'
  })()
)
check('价格文案：没有价就不显示（不写 ¥0 / ¥undefined）',
  blessProducts.formatPriceText(1280) === '¥1280' &&
    blessProducts.formatPriceText('') === '' &&
    blessProducts.formatPriceText(null) === '' &&
    blessProducts.formatPriceText('abc') === '')
check('取条：主视觉用主题名，没有才回落标准名；无有效行返回 null',
  (blessProducts.pickReco({ list: [{ _id: 'x', themeName: '月下客', title: '标准名', price: 1 }] }, 'peace') || {}).title === '月下客' &&
    (blessProducts.pickReco({ list: [{ _id: 'x', title: '标准名' }] }, 'peace') || {}).title === '标准名' &&
    blessProducts.pickReco({ list: [] }, 'peace') === null &&
    blessProducts.pickReco(null, 'peace') === null)

/* —— C 端弱推接线：拉取 / 缓存 / 失败降级 / 跳转（2026-09-21：接线在**玩法页工厂**里）—— */
{
  const stub = installWxStub()
  const proto = loadPageConfig('miniprogram/subpackages/plays/play-qian/index.js')
  const calls = []
  const navigated = []
  let mode = 'ok'
  globalThis.wx.cloud = {
    callFunction: (o) => {
      calls.push(o)
      if (mode === 'throw') return Promise.reject(new Error('boom'))
      if (mode === 'empty') return Promise.resolve({ result: { success: true, list: [] } })
      return Promise.resolve({
        result: {
          success: true,
          list: [{ _id: 'rec1', title: '标准名', themeName: '月下客', latinName: 'Heterometrus', price: 1280 }]
        }
      })
    }
  }
  globalThis.wx.navigateTo = (o) => navigated.push(o && o.url)
  const mkRecoPage = (blessTags, productId) => {
    const page = Object.assign(Object.create(null), proto)
    page.data = Object.assign({}, proto.data, { blessTags: blessTags || [], productId: productId || '' })
    page.setData = function (patch) { Object.assign(this.data, patch) }
    return page
  }

  const p1 = mkRecoPage(['peace'], 'wall1')
  await p1.loadBlessReco()
  check('★ 弱推按"这面墙的祈运标签"取一件藏品（用墙的标签，不读用户资料）',
    calls.length === 1 && calls[0].name === 'getBlessProducts' && calls[0].data.tag === 'peace')
  check('★ 排除当前这面墙的商品（不给自己推荐自己）',
    JSON.stringify(calls[0].data.excludeIds) === JSON.stringify(['wall1']))
  check('★ 推荐卡片用主题名做主视觉（没有主题名才回落标准名）+ 价格文案',
    (p1.data.reco || {}).title === '月下客' && (p1.data.reco || {}).priceText === '¥1280')
  await p1.loadBlessReco()
  check('同一天再抽一次不再打云函数（按 标签+当日 缓存）', calls.length === 1, `calls=${calls.length}`)
  const p1b = mkRecoPage(['peace'], 'wall1')
  p1b._recoCache = p1._recoCache
  await p1b.loadBlessReco()
  check('缓存命中时直接出推荐（换页面实例也认这份缓存）', (p1b.data.reco || {})._id === 'rec1')

  const p2 = mkRecoPage([], '')
  await p2.loadBlessReco()
  check('这面墙没有祈运标签 → 一次云函数都不打（没有依据就不推）', calls.length === 1, `calls=${calls.length}`)

  mode = 'throw'
  const p3 = mkRecoPage(['bond'], 'wall1')
  await p3.loadBlessReco()
  check('★ 推荐失败只是"没有推荐"（不抛、不弹错、不影响玩法），且 recoFailed 立住（那一行留在原位、不被骨架顶掉）',
    p3.data.reco === null && p3.data.recoFailed === true)

  mode = 'empty'
  const p4 = mkRecoPage(['journey'], 'wall1')
  await p4.loadBlessReco()
  check('云函数回空列表 → reco 仍为 null（不拿别的商品凑数），且 recoFailed 立住以便回看墙上这件',
    p4.data.reco === null && p4.data.recoFailed === true)

  const p5 = mkRecoPage(['peace'], 'wall1')
  p5.data.reco = { _id: 'rec1', tag: 'peace' }
  p5.goRecoProduct()
  check('★ 点推荐卡跳详情页',
    navigated.length === 1 && navigated[0] === '/subpackages/feature/detail/index?id=rec1&from=wish_wall_reco', navigated.join(','))
  const p6 = mkRecoPage(['peace'], 'wall1')
  p6.goRecoProduct()
  check('没有推荐时不跳（不拼空链接）', navigated.length === 1)
  stub.restore()
}

check('玩法事件之外，弱推点击有自己的埋点（双端登记）',
  // 2026-09-21（§11.4）：弱推点击从祈福墙页搬到玩法页工厂。
  /wish_wall_reco/.test(readSrc('miniprogram/subpackages/plays/utils/ritualPlayPage.js')) &&
    /wish_wall_reco:/.test(readSrc('miniprogram/utils/analytics/eventSchema.js')) &&
    /wish_wall_reco:/.test(readSrc('admin/src/utils/analyticsSchema.js')))

/* ================================================================== *
 * 真机截图（2026-09-18 第三组）修的两处版式缺陷
 *
 *   ① 回声条半透明 → 与墙页脚的文字叠在一起（"两行字"看着像渲染错乱）；
 *   ② 未点灯的灯卡顶对齐 → 底部空一截，与右边居中的木鱼卡不对称。
 * 两条都不是"样式写错了"，而是**画出来才知道**——所以判据直接钉住"不许再犯"的形态。
 * ================================================================== */


/* ================================================================== *
 * 场景兜底：存量商品没有 blessTags 时，用**人工策展过的** giftScenes 推导
 * （这正是"功能不空转"的关键 —— 真机截图里祈运提示与推荐都是空的，原因是没人回填标签）
 * ================================================================== */
check(
  '★ 显式 blessTags 优先于场景推导（人工判断压过兜底映射）',
  JSON.stringify(bless.resolveBlessTags({ blessTags: ['fortune'], giftScenes: ['wedding'] })) === JSON.stringify(['fortune']) &&
    JSON.stringify(bless.resolveBlessTags({ blessTags: [], giftScenes: ['wedding'] })) === JSON.stringify(['bond'])
)
check(
  '★ 8 个礼赠场景全部有兜底映射，且都落在受控枚举内（漏一个 = 那类商品推荐不出来）',
  Object.keys(bless.SCENE_BLESS).length === 8 &&
    Object.values(bless.SCENE_BLESS).every((k) => bless.BLESS_TAG_KEYS.includes(k)) &&
    bless.scenesForBless('study').join(',') === 'enrollment' &&
    bless.scenesForBless('peace').length === 3
)
check('场景推导是确定的、去重、按 SSOT 顺序输出',
  JSON.stringify(bless.blessTagsFromScenes(['wedding', 'enrollment', 'wedding'])) === JSON.stringify(['study', 'bond']) &&
    JSON.stringify(bless.blessTagsFromScenes(['nope'])) === '[]' &&
    JSON.stringify(bless.blessTagsFromScenes(null)) === '[]'
)
check('没有显式标签、也没有场景 → 空（不猜）',
  JSON.stringify(bless.resolveBlessTags({})) === '[]' &&
    JSON.stringify(bless.resolveBlessTags(null)) === '[]'
)
const urlFromScenesOnly = wish.buildWishWallUrl({ _id: 'p2', title: '孔雀标本', giftScenes: ['enrollment'] }, {})
check(
  '★ 只填了礼赠场景的商品，入口 URL 也带上祈运标签（存量商品**不必先做数据回填**）',
  /bless=study/.test(urlFromScenesOnly), urlFromScenesOnly
)

/* ================================================================== *
 * 门店物料小程序码（需求 28 · 门店现场转化）：scene 解析 + 页面接线
 * 码是印刷品 —— 解析错了不会报错，只会"扫码进错墙、来源丢失"，所以判据钉在解析器与接线两处。
 * ================================================================== */
check(
  '★ scene 解析：`from=store_qr&k=<墙key>`（含 URL 编码形态）都能解出目标墙与来源',
  (() => {
    const a = wish.parseWishWallScene('from=store_qr&k=mashangyou')
    const b = wish.parseWishWallScene('from%3Dstore_qr%26k%3Dmashangyou')
    const c = wish.parseWishWallScene('k=ma-shang-you&from=counter')
    return a.from === 'store_qr' && a.productKey === 'mashangyou' &&
      b.from === 'store_qr' && b.productKey === 'mashangyou' &&
      c.from === 'counter' && c.productKey === 'ma-shang-you'
  })()
)
check(
  '★ scene 严进：脏值/超长一律回落为空（宁可进默认墙，也不拿垃圾 key 去查不存在的墙）',
  wish.parseWishWallScene('k='.repeat(40)).productKey === '' &&
    wish.parseWishWallScene('from=store qr').from === '' &&
    wish.parseWishWallScene(null).from === '' &&
    wish.parseWishWallScene('nope=1').productKey === ''
)


/* ================================================================== *
 * 版式（2026-09-18 产品确认）：①祈运标签挪进页头填右侧空白 ②发送条吸底
 * ================================================================== */


// 发送条位置：**按设计模式分支**（2026-09-19 产品口径变更：吸底 → 顺流，弹幕墙下方）。
//
// 为什么要分支而不是直接删掉旧判据：旧判据保护的是「吸底条被别的块盖住 / 盖住最后一张愿签」
// 这个失败模式。**顺流后它不再盖任何东西，该模式不存在**；但若日后有人改回 fixed，
// 旧判据必须自动复活 —— 写成裸删除就会留下假绿（本仓错题本 E7 那类）。
// 设计意图（原话见 index.wxss 的 .ww-composer 注释）：顺流时它落在 .ww-write 内部。


// 顺流时**位置本身**也是设计要求（产品原话：「放在更醒目位置如弹幕墙下方」）——
// 必须被钉住，否则下次有人把它挪到页尾/页首，判据只会说「它是 static」而放过去。


// 吸底专属不变量：只在**仍是 fixed** 时要求「底部预留 ≥ 条高」（顺流不需要，别硬留 180rpx）

// ⚠️ 真机反馈「向下滑到愿签时与发送条互相遮挡」的根因：条子在 .ww-write（position:relative; z-index:1）
// 这个层叠上下文里，自己的 z-index 只在该上下文内有效 → 页面其余 z-index≥1 的块画到它上面。
// 判据：①条子必须是 .ww-page 的直接子节点（不被任何层叠上下文罩住）②背景不透明 ③z-index 足够高
/**
 * 目标元素在 WXML 里的**祖先链**（用 <view …> 开合配平实算）。
 * ⚠️ 第一版写成"数 <view 与 </view> 的个数是否相等"，但目标锚点落在**标签内部**（class 那一行），
 * 于是把目标自己的 `<view` 也算进了开标签 → 恒定差一个 → 假红。改为维护祖先栈，只看真正的外层。
 */
const viewAncestorsAt = (wxml, marker) => {
  const target = wxml.indexOf(marker)
  if (target < 0) return null
  const re = /<view\b[^>]*>|<\/view>/g
  const stack = []
  let m
  while ((m = re.exec(wxml)) !== null) {
    if (m.index >= target) break
    if (m[0].startsWith('</')) stack.pop()
    else stack.push(m[0].replace(/\s+/g, ' ').slice(0, 70))
  }
  return stack
}
// 锚点统一取**元素内部**的类名（不能取元素自己的开标签：那样它会被当成自己的祖先，数目差一）
// → 覆盖层内部标记的祖先链 = [.ww-page, 覆盖层自己]，长度必须恰好 2
/**
 * 覆盖层是不是 .ww-page 的直接子节点：看目标**内部**标记的祖先链 ——
 * 祖先链头必须是 .ww-page，第二个必须是这个覆盖层自己（中间不许再夹别的块）。
 * 锚点要取"覆盖层的子元素"（取覆盖层自己的类名会把它算成自己的祖先）。
 */

// 顺流后发送条不再是覆盖层 —— 只有**仍是 fixed** 时才要求它是 .ww-page 直接子节点。
// 纸签弹层始终是 fixed 覆盖层，这一条对它**始终**成立（与设计变更无关）。

// 层级可比性只在**两者都是覆盖层**（发送条吸底）时才要求；顺流时二者不重叠。


// 顺流时不铺底（不该出现一条通栏色带）；仍吸底时必须不透明（否则愿签透上来）。


/* ================================================================== *
 * 14)「连续记录云保存」注册钩子（2026-09-20）
 *
 * 产品逻辑：连灯天数与木鱼功德只存本地，换手机/清缓存即丢。
 * 钩子话术 = 「注册后连续记录存云端，不会丢，且断签前会提醒你」。
 *
 * 这一节钉四件事（每一条都对应一种"看起来做了、其实没做"的缺陷）：
 *   ① 门槛与判定是**纯函数**：连灯 ≥2 天 / 木鱼 ≥21 下才谈，否则就是骚扰；
 *   ② 开关 `showRitualProfile` 缺字段默认关，且云端与旧页链路齐全 ——
 *      漏一处就是"超管在后台保存成功、但字段被静默重置"（本仓已发生过）；
 *      ⚠️ 2026-10-13：该开关的**超管面板行**已按产品负责人点名移除（断言改为"不得复活"），
 *      但云端默认/归一/透传与旧页判定**必须保留**（稳定期不改契约）。
 *   ③ 注册成功后**真的调 `syncToCloud()`** 并把结果如实告诉用户
 *      （只弹"成功"却什么都没存 = 空承诺，所以漏斗终点只在同步成功后上报）；
 *   ④ 三条降级（开关读失败 / 云存模块缺失 / 用户拒绝授权）都不得影响点灯与木鱼。
 * ================================================================== */


/* ================================================================== *
 * 15) 创新钩子 H2「功德证」（2026-09-20）
 *
 * 产品口径（方案 `docs/创新钩子方案_2026-09-19.md` §H2）：木鱼功德攒到**里程点**时，
 * 在木鱼按钮附近出现一个「领证」次级入口；领证要身份（复用 RegisterAuthDialog），
 * 领到的证**可保管（本地存档）、可回看**，并与「连续记录云保存」共用同一份云端持久化。
 *
 * 这一节钉五件事（每一条都对应一种"看起来做了、其实没做"的缺陷）：
 *   ① 里程点判定是**纯函数**、阈值只有一处常量，且**写明"口径待产品确认"**（不许猜成定稿）；
 *   ② 开关 `showMuyuCertificate` 缺字段默认关，且云端与旧页链路齐全（漏一处就被静默重置）；
 *      ⚠️ 2026-10-13：该开关的**超管面板行**已按产品负责人点名移除（断言改为"不得复活"），
 *      云端默认/归一/透传与旧页判定**必须保留**（稳定期不改契约；功德证本身自 2026-09-20 已停）。
 *   ③ **写放大防护**：木鱼可连点，`onMuyuTap` 一次云端写都不许有；只在离开页面/退出时上报；
 *   ④ 注册成功后**真的调 `syncToCloud()`**，且只有成功才说「已存到云端」（失败说真话）；
 *   ⑤ 证书文字**只有计数与日期**（合规：不涉命理改运），且埋点双端登记 + 数据报表有分桶。
 * ================================================================== */


/* ================================================================== *
 * ★ P0 字数口径：emoji / ZWJ 序列按「字」算（两端同源）
 *
 * 出处：docs/祈福墙_全面改造_交付记录_2026-09-20.md §7 第 4 条。
 * 旧口径的两个错：① `draft.length` 是 UTF-16 码元数（emoji 算 2、ZWJ 家庭 emoji 算 8）；
 * ② `.slice(0, 30)` 会截出半个代理对。
 * ------------------------------------------------------------------ */


/* ================================================================== *
 * ★ W1 玩法结果分享（会话卡片形态）
 *
 * 产品口径：给一个 `<button open-type="share">`，分享的是**玩法结果**，不是愿签正文，
 * 更不许把星座/MBTI 等"依据"写进转发文案。
 * 2026-09-21（PRD v1.4 §11.4）：玩法结果分享搬到**玩法页**；祈福墙页只剩愿签分享 ——
 * 两条链路从此在**两个页面**上，结构上不可能串（比"落标记分流"更强）。
 * ------------------------------------------------------------------ */


/* ─────────── 结果页动作行排版确定性 + 工具自检（2026-09-21）───────────
 * 起因：给结果层做视觉优化时，**预览出图与真机截图给出相反结果** —— 两个动作按钮的
 * 间距与宽度全看平台 button 默认样式（预览里铜底比文字窄；真机里是窄按钮 + 间距）。
 * 同一份样式两处渲染不一致 = 排版没写死。这三条把它钉成确定形态。
 * 2026-09-21（§11.4）：这三条随结果层搬到玩法页的共享样式（`.rp-acts` / `.rp-act`）。
 * 另：render-*.mjs 是"模板字符串里拼 CSS"的工具，**模板串里写反引号会截断模板**
 * （本会话第 5 次犯，前 4 次都靠 node --check 抓到）→ 这里补一条"工具必须可解析"的判据。 */


/* ================================================================== *
 * ★ 现役共享件（2026-10-17 旧祈福墙退场后重新钉住）
 *
 * 起因：删旧页时，这一组判据和旧页的断言写在同一段里，被一并剪掉 ——
 * 自检当场报出 26 条注入「未被检出」，注入目标全是**仍在用**的文件：
 * 手写体加载（app.js / utils/handFont.js）、展品挑选（wallExhibitProduct，心愿签在用）、
 * 玩法页工厂（今日一签在用）、字数口径（两端同源）、内容开关的保存链（云函数 + 店长端）。
 * 判据只换「读谁」，不换口径：旧页那一端改读心愿签 / 今日一签。
 * ------------------------------------------------------------------ */

/* —— 手写体的接线（错题本 E8：断了也不报错，整页静默落回系统字体）—— */
{
  const handFontCode = stripComments(readSrc('miniprogram/utils/handFont.js'))
  const appCode = stripComments(readSrc('miniprogram/app.js'))
  check(
    '★ 手写体走网络字体：wx.loadFontFace + global:true（否则每个页面都得自己注册）',
    /wx\.loadFontFace\(\{/.test(handFontCode) && /global:\s*true/.test(handFontCode)
  )
  check(
    "★★ loadFontFace 的 scopes 必须同时含 webview 与 native（少了 native，iOS 的 <text> 原生层看不到效果）",
    /scopes:\s*\[\s*'webview'\s*,\s*'native'\s*\]/.test(handFontCode)
  )
  check(
    '★ app.js 启动时真的调了加载器（否则页面写着 ShanhaiHand 也没人加载）',
    /this\.ensureHandFontWithRetry\(\)/.test(appCode) && /require\(['"]\.\/utils\/handFont['"]\)/.test(appCode),
    'onLaunch → ensureHandFontWithRetry → ensureHandFont'
  )
  const handFamily = (/const FONT_FAMILY = '([^']+)'/.exec(handFontCode) || [])[1]
  const familyRe = handFamily ? new RegExp(`font-family:\\s*'${handFamily}'\\s*,`) : null
  const handPages = {
    心愿签: readSrc('miniprogram/subpackages/feature/wish-labels/index.wxss'),
    今日一签: readSrc('miniprogram/subpackages/plays/play-qian/index.wxss')
  }
  const familyMiss = Object.entries(handPages).filter(([, css]) => !familyRe || !familyRe.test(css)).map(([k]) => k)
  check(
    '★★ 页面手写体族名与加载器加载的族名逐字相同（心愿签 + 今日一签；不同 = 加载了也用不上，真机静默回落）',
    !!handFamily && familyMiss.length === 0,
    `FONT_FAMILY=${handFamily || '(缺)'} 缺: ${familyMiss.join(',') || '无'}`
  )
}

/* —— 展品挑选（心愿签首屏的那件商品；门店码 scene 不带 productId）—— */
{
  const exMod = loadCjs('miniprogram/subpackages/feature/utils/wallExhibitProduct.js', { require: markerRequire })
  const rows = [
    { _id: 'z-off', title: '马上有 · 下架款', isOffShelf: true },
    { _id: 'b-hit', title: '马上有 · 黑马' },
    { _id: 'c-other', title: '马上有 · 月兔', wishWallKey: 'moonrabbit' },
    { _id: 'd-off2', title: '马上有 · 关墙', wishWallEnabled: false },
    { _id: 'e-explicit', title: '黑马守夜', wishWallEnabled: true }
  ]
  eq('★ 挑商品：显式开墙优先，排除下架 / 关墙 / 别的墙', (exMod.pickWallProduct(rows, 'mashangyou') || {})._id, 'e-explicit')
  eq('…没有显式开墙时按标题兜底命中', (exMod.pickWallProduct(rows.slice(0, 4), 'mashangyou') || {})._id, 'b-hit')
  eq('…别的墙只认自己作用域的那件', (exMod.pickWallProduct(rows, 'moonrabbit') || {})._id, 'c-other')
  eq('…只剩下架款 → null（绝不带人去下架商品页）', exMod.pickWallProduct([rows[0]], 'mashangyou'), null)
  const v0 = exMod.buildExhibitView('mashangyou', null, '')
  check('展签数据：没商品时商品字段一律留空（不拿占位冒充事实）',
    !!v0 && v0.productId === '' && v0.cover === '' && v0.latinName === '' && v0.name === '马上有')
}

/* —— 今日一签（玩法页工厂）：失败要说出来 / 留档 / 埋点口径 / 分享标记一次性 / 资料缓存 / 写成心愿回心愿签 —— */
{
  const stub = installWxStub()
  const store = new Map()
  globalThis.wx.getStorageSync = (k) => (store.has(k) ? store.get(k) : '')
  globalThis.wx.setStorageSync = (k, v) => { store.set(k, v) }
  globalThis.wx.removeStorageSync = (k) => { store.delete(k) }
  const backs = []
  const relaunches = []
  globalThis.wx.navigateBack = (o) => backs.push(o)
  globalThis.wx.reLaunch = (o) => relaunches.push(o && o.url)
  const archiveMod = loadCjs('miniprogram/subpackages/plays/utils/ritualPlayArchive.js', { require: markerRequire })
  const handoffMod = loadCjs('miniprogram/subpackages/plays/utils/wishHandoff.js', { require: markerRequire })
  const proto = loadPageConfig('miniprogram/subpackages/plays/play-qian/index.js')
  const mkQian = async (over) => {
    const page = Object.assign(Object.create(null), proto)
    page.setData = function (patch) { Object.assign(this.data, patch) }
    await page.onLoad(Object.assign({ productKey: 'mashangyou', productId: 'p1', title: '孔雀标本' }, over || {}))
    return page
  }

  store.clear()
  const q = await mkQian()
  q.startPlay()
  check('★ 进行态：startPlay 落 pending 且定时器有句柄（漏清就会永久卡在进行态）',
    q.data.stage === 'pending' && !!q._spinTimer && q.data.result === null, `stage=${q.data.stage}`)
  clearTimeout(q._spinTimer)
  q.settle()
  check('★ 落结果：stage=result + 写进本地留档（「可回看」与「今天玩过没有」都靠它）',
    q.data.stage === 'result' && !!q.data.result && !!archiveMod.todayEntry('qian', q._dayKey, ''), `stage=${q.data.stage}`)

  globalThis.getCurrentPages = () => [{ route: 'subpackages/feature/wish-labels/index' }, { route: 'subpackages/plays/play-qian/index' }]
  q.writeWish()
  const stashed = store.get(handoffMod.STORAGE_KEY)
  check('★ 「写成心愿」把心愿词写进一次性交接 + 回声是第一人称句',
    !!stashed && /^马上有/.test(String(stashed.draft)) && stashed.echo === '我摇了今日一签', JSON.stringify(stashed || null))
  check('★ 上一页就是心愿签 → navigateBack（不重新压栈）', backs.length === 1 && relaunches.length === 0,
    `backs=${backs.length} relaunch=${relaunches.join('|')}`)
  globalThis.getCurrentPages = () => [{}]
  q.writeWish()
  check('★ 降级：页面栈里没有心愿签 → reLaunch 直接回心愿签（不再绕旧墙薄壳）并带回本品上下文',
    relaunches.length === 1 && String(relaunches[0]).indexOf('/subpackages/feature/wish-labels/index?') === 0 &&
      /productId=p1/.test(relaunches[0]) && /from=play_wish/.test(relaunches[0]), String(relaunches[0] || ''))
  delete globalThis.getCurrentPages

  // 失败分支：必须说出来 + 埋点 action 固定为 play（step 区分）
  const factorySrc = stripComments(readSrc('miniprogram/subpackages/plays/utils/ritualPlayPage.js'))
  const settleBody = (() => {
    const i = factorySrc.indexOf('settle() {')
    return i === -1 ? '' : factorySrc.slice(i, factorySrc.indexOf('\n    },', i))
  })()
  check('★ 玩法失败必须说出来（settle 的失败分支里有 showAppToast；原来是静默 return，点上去毫无反应）',
    /stage: 'idle', result: null, need: null \}\)\s*this\.showAppToast\(\{/.test(settleBody))
  check("★ 失败埋点口径：trackBehavior('wish_wall_play', 'play', id, { step: 'fail' })（ERP 漏斗按 action=play 分步）",
    /trackBehavior\('wish_wall_play', 'play', id, \{ step: 'fail' \}\)/.test(settleBody))
  check('★ 落结果写本地留档（archive.saveResult）', /archive\.saveResult\(id, this\._dayKey, result\)/.test(settleBody))
  check('★ 资料缓存两处作废（进资料页前 + 回来 onShow）—— 少一处，补完资料回来仍看到「缺资料」',
    /goProfileField\(\)\s*\{[\s\S]{0,500}?this\._profile = null/.test(factorySrc) &&
      /onShow\(\)\s*\{[\s\S]{0,500}?this\._profile = null/.test(factorySrc) &&
      (factorySrc.match(/this\._profile = null/g) || []).length >= 2)
  check('★ 弹层形态已随旧墙退场（工厂不再导出 createRitualPlayBody、不再抛 wish/post/share 事件）',
    !/createRitualPlayBody|triggerEvent\(|_embedded/.test(factorySrc))

  // 分享：来源标记一次性
  const ps = Object.assign(Object.create(null), proto)
  ps.data = Object.assign({}, proto.data, { result: { id: 'qian', share: '今日一签：宜 开口' }, shareFrom: '', productKey: 'mashangyou' })
  ps.setData = function (patch) { Object.assign(this.data, patch) }
  ps.onShareTap()
  eq('★ 点分享按钮 → 落来源标记 play', ps.data.shareFrom, 'play')
  const shared = ps.onShareAppMessage()
  eq('★ 分享标题 = 玩法结果的 share 字段', shared.title, '今日一签：宜 开口')
  eq('★ 分享后来源标记必须复位（同一次点击只生效一次）', ps.data.shareFrom, '')
  check('分享落地页 = 心愿签（不再经过旧墙薄壳）', /^\/subpackages\/feature\/wish-labels\/index\?productKey=mashangyou/.test(shared.path), shared.path)
  stub.restore()
}

/* —— 心愿签接住今日一签带回的那一句（交接一次性：预填 + 打开写签层）—— */
{
  const stub = installWxStub()
  const store = new Map()
  globalThis.wx.getStorageSync = (k) => (store.has(k) ? store.get(k) : '')
  globalThis.wx.setStorageSync = (k, v) => { store.set(k, v) }
  globalThis.wx.removeStorageSync = (k) => { store.delete(k) }
  const handoffMod = loadCjs('miniprogram/subpackages/feature/utils/wishHandoff.js', { require: markerRequire })
  const proto = loadPageConfig('miniprogram/subpackages/feature/wish-labels/index.js')
  const mk = (over) => {
    const page = Object.assign(Object.create(null), proto)
    page.data = Object.assign(JSON.parse(JSON.stringify(proto.data)), over || {})
    page.setData = function (patch) { Object.assign(this.data, patch) }
    page.loadWriter = () => {}
    return page
  }
  handoffMod.stash({ draft: '马上有回应', echo: '我摇了今日一签' })
  const closed = mk({ allowed: false })
  closed.onShow()
  check('闸门未放行时 onShow 不取交接（留给放行那一刻）', !!store.get(handoffMod.STORAGE_KEY) && closed.data.draft === '')
  const w = mk({ allowed: true, quota: { used: 0, left: 5, cap: 5, exhausted: false } })
  w.onShow()
  check('★ 回到心愿签：交接被取走 → 草稿预填、字数同步、写签层打开',
    w.data.draft === '马上有回应' && w.data.draftCount === 5 && w.data.composeOpen === true && !store.get(handoffMod.STORAGE_KEY),
    `draft=${w.data.draft} open=${w.data.composeOpen}`)
  const again = mk({ allowed: true, quota: { used: 0, left: 5, cap: 5, exhausted: false } })
  again.onShow()
  check('★ 交接只消费一次（再进不再预填）', again.data.draft === '' && again.data.composeOpen !== true)
  check('★ 闸门放行时也取一次（reLaunch 重进这条路）',
    /if \(!allowed\) return\s*void this\.resolveExhibit\(\)\s*this\.applyPlayHandoff\(\)/.test(readSrc('miniprogram/subpackages/feature/wish-labels/index.js')))
  stub.restore()
}

/* —— 内容开关的保存链：两个历史注册钩子开关（页面已退场，开关字段仍在云端 / 店长端）——
 * 页面退场后这两个开关没有 C 端读者，但字段仍在 content_display_flags 里随店长端保存往返：
 * 保存链漏透传一个字段 = 超管后台存好的值被静默重置。判据只守保存链，不再守页面。 */
{
  const flagFn = readSrc('miniprogram/cloudfunctions/getContentDisplayFlags/index.js')
  const flagClient = readSrc('miniprogram/utils/contentDisplayFlags.js')
  const subv = readSrc('miniprogram/subpackages/manager/manager/workspace/_subviews.wxml')
  const mgrCfg = readSrc('miniprogram/subpackages/manager/manager/managerPageConfig.js')
  for (const f of ['showRitualProfile', 'showMuyuCertificate']) {
    check(`${f} ① 客户端 normalize 缺字段默认关（=== true）`, new RegExp(`${f}: src\\.${f} === true`).test(flagClient))
    check(`${f} ② 云函数 getDefaultFlags 缺省 false`, new RegExp(`${f}: false`).test(flagFn))
    check(`${f} ③ 云函数 normalizeFlags 同口径（=== true）`, new RegExp(`${f}: src\\.${f} === true`).test(flagFn))
    check(`${f} ④ ★ 云函数 saveFlags 显式透传（漏了 = 后台保存成功但字段被静默丢）`, new RegExp(`${f}: incoming\\.${f}`).test(flagFn))
    check(
      `${f} ⑤ ★ 店长端：开关行已于 2026-10-13 按产品负责人点名移除（不得复活）+ load 归一 + data 默认`,
      !new RegExp(`data-field="${f}"`).test(subv) &&
        new RegExp(`${f}: flags\\.${f} === true`).test(mgrCfg) &&
        new RegExp(`${f}: false,`).test(mgrCfg)
    )
  }
}

/* —— 今日一签结果纸面的两条静态口径 —— */
{
  const qWxss = stripAtRules(readSrc('miniprogram/subpackages/plays/play-qian/index.wxss'))
  const qWxssRaw = readSrc('miniprogram/subpackages/plays/play-qian/index.wxss')
  const animatedText = [...qWxss.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((m) => /animation(-name)?\s*:/.test(m[2]))
    .map((m) => m[1].trim())
    .filter((sel) => /rp-(hint|line|note|paper-title|paper-sub|act)\b/.test(sel))
  check('★ 进行态的明暗呼吸只许在签筒上，不许落到文案上（文字忽明忽暗读不清）',
    animatedText.length === 0 && !/@keyframes rp-dim-text/.test(qWxssRaw), `带动画的文案选择器: ${animatedText.join(' | ') || '无'}`)
  const qWxml = readSrc('miniprogram/subpackages/plays/play-qian/index.wxml')
  const hiddenCjk = [...qWxml.matchAll(/aria-hidden="true"[^>]*>([^<]+)</g)]
    .map((m) => m[1].trim()).filter((t) => /[一-龥]/.test(t))
  check('★ aria-hidden 不许盖住中文文案（装饰才可隐藏；「去看 ›」这类 CTA 不是装饰）',
    hiddenCjk.length === 0, `被隐藏的带字元素: ${JSON.stringify(hiddenCjk)}`)
}


/* ================================================================== *
 * ★ P0 字数口径：emoji / ZWJ 序列按「字」算（两端同源）
 *
 * 出处：docs/祈福墙_全面改造_交付记录_2026-09-20.md §7 第 4 条。
 * 旧口径的两个错：① `draft.length` 是 UTF-16 码元数（emoji 算 2、ZWJ 家庭 emoji 算 8）；
 * ② `.slice(0, 30)` 会截出半个代理对。
 * ------------------------------------------------------------------ */
{
  const wc = loadCjs('miniprogram/utils/wishTextCount.js', { require: markerRequire })

  // 「孤立代理对」是数据属性，不该用正则去猜（正则本身容易写错 = 错题本 E7）。
  // 用码点扫描：高代理后必须跟低代理，低代理前必须是高代理，否则就是被切开的半个字符。
  const hasLoneSurrogate = (s) => {
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i)
      if (c >= 0xd800 && c <= 0xdbff) {
        const n = s.charCodeAt(i + 1)
        if (!(n >= 0xdc00 && n <= 0xdfff)) return true
        i += 1
      } else if (c >= 0xdc00 && c <= 0xdfff) {
        return true
      }
    }
    return false
  }

  // 同一组用例：客户端实现 / 服务端副本（fn.wishTextCount 从云函数导出）/ 期望值
  const textCountCases = [
    ['👨‍👩‍👧', 1],             // ZWJ 家庭：旧 `length` = 8
    ['👨‍👩‍👧‍👦', 1],           // 四个人的 ZWJ 家庭：旧 `length` = 11
    ['abc', 3],
    ['马上有', 3],
    ['🙂🙂', 2],               // 相邻 emoji 之间**不许**互相吸收
    ['👍🏽', 1],               // 肤色修饰符
    ['❤️', 1],                // 变体选择符 VS16
    ['🇨🇳', 1],                // 区域指示符成对 = 一面国旗
    ['🇨🇳🇯🇵', 2],              // 两面旗不许粘成一个字
    ['e\u0301', 1],            // 组合用记号
    ['', 0]
  ]
  check(
    '★ 新模块按「字」计数：ZWJ 家庭 emoji = 1、abc = 3、相邻 emoji 不互相吸收',
    textCountCases.every(([s, want]) => wc.wishTextCount(s) === want),
    textCountCases.map(([s, want]) => `${JSON.stringify(s)} → ${wc.wishTextCount(s)}（期望 ${want}）`).join(' | ')
  )
  check(
    '★ 服务端副本（云函数导出的 wishTextCount）与客户端**逐用例同结果**',
    typeof fn.wishTextCount === 'function' &&
      textCountCases.every(([s, want]) => fn.wishTextCount(s) === want && fn.wishTextCount(s) === wc.wishTextCount(s)),
    textCountCases.map(([s]) => `${JSON.stringify(s)}: client=${wc.wishTextCount(s)} server=${typeof fn.wishTextCount === 'function' ? fn.wishTextCount(s) : '(缺失)'}`).join(' | ')
  )

  // 截断：按字截、绝不切出半个代理对（用 JSON.stringify + 码点扫描双向证明）
  const cut2 = wc.wishTextTruncate('👨‍👩‍👧abc', 2)
  check(
    '★ 按「字」安全截断：家庭 emoji + abc 截 2 → 整字保留，且不产生孤立代理对',
    wc.wishTextCount(cut2) === 2 &&
      cut2.startsWith('👨‍👩‍👧') &&
      !hasLoneSurrogate(cut2) &&
      JSON.stringify(cut2).indexOf('\\ud') === -1,
    `truncate=${JSON.stringify(cut2)} count=${wc.wishTextCount(cut2)} lone=${hasLoneSurrogate(cut2)}`
  )
  const cutEmoji = wc.wishTextTruncate('🙂🙂🙂', 2)
  check(
    '★ 纯 emoji 截断：3 个 🙂 截 2 → 恰好 2 个完整 emoji（旧 `.slice(0,2)` 会切出半个代理对）',
    cutEmoji === '🙂🙂' && !hasLoneSurrogate(cutEmoji),
    `truncate=${JSON.stringify(cutEmoji)} len=${cutEmoji.length}`
  )
  // 直接复现旧写法，证明"这是真 bug、不是纸面担忧"：
  // `'👨‍👩‍👧'.slice(0, 4)` 的落点正好在 `👩` 的高代理之后 → 尾巴是一个孤立高代理 `\uD83D`。
  const legacyCut = '👨‍👩‍👧'.slice(0, 4)
  const newCut = wc.wishTextTruncate('👨‍👩‍👧', 1)
  check(
    '★ 反证：旧写法 `.slice(0, 4)` 确实会切出孤立代理对（新实现截 1 个字必须整字保留）',
    hasLoneSurrogate(legacyCut) && !hasLoneSurrogate(newCut) && newCut === '👨‍👩‍👧',
    `legacy=${JSON.stringify(legacyCut)}（len ${legacyCut.length}, lone=${hasLoneSurrogate(legacyCut)}） | new=${JSON.stringify(newCut)} lone=${hasLoneSurrogate(newCut)}`
  )
  check(
    '★ 截断与服务端同口径（同组用例两端结果一致）',
    typeof fn.wishTextTruncate === 'function' &&
      ['👨‍👩‍👧abc', '🙂🙂🙂', '马上有光', '👍🏽👍🏽👍🏽'].every(
        (s) => fn.wishTextTruncate(s, 2) === wc.wishTextTruncate(s, 2)
      )
  )
  check(
    '边界：截 0 字 = 空串、max 非数字 = 原文（不丢用户内容）',
    wc.wishTextTruncate('马上有', 0) === '' && wc.wishTextTruncate('马上有', NaN) === '马上有'
  )

  // ── 两端**同源**：内嵌副本必须逐字节相同 ────────────────────────────────
  const regionOf = (text) => {
    const b = '// WISH_TEXT_COUNT_BEGIN'
    const e = '// WISH_TEXT_COUNT_END'
    const i = text.indexOf(b)
    const j = text.indexOf(e)
    if (i === -1 || j === -1 || j < i) return null
    return text.slice(i, j + e.length + 1)
  }
  const clientRegion = regionOf(readSrc('miniprogram/utils/wishTextCount.js'))
  const serverRegion = regionOf(readSrc('miniprogram/cloudfunctions/manageWishWall/index.js'))
  check(
    '★ 客户端实现与服务端内嵌副本**逐字节相同**（云函数不能 require 小程序目录，按 ritualProfileCore 双份惯例）',
    clientRegion !== null && serverRegion !== null && clientRegion === serverRegion,
    `client=${clientRegion === null ? '(缺 BEGIN/END 标记)' : clientRegion.length + ' chars'} server=${serverRegion === null ? '(缺标记)' : serverRegion.length + ' chars'}`
  )
  check(
    '★ 服务端校验真的用了同口径计数（不是留着旧的 `text.length`）',
    /const count = wishTextCount\(text\)/.test(readSrc('miniprogram/cloudfunctions/manageWishWall/index.js')) &&
      fn.validateWishText('👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧').ok === true &&
      fn.validateWishText('🙂'.repeat(fn.TEXT_MAX + 1)).ok === false &&
      fn.validateWishText('🙂'.repeat(fn.TEXT_MAX)).ok === true,
    `家庭 emoji×4 → ${JSON.stringify(fn.validateWishText('👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧').ok)}；31 个 emoji → ${JSON.stringify(fn.validateWishText('🙂'.repeat(fn.TEXT_MAX + 1)).ok)}`
  )

  // ── 页面接线（2026-10-17 改读心愿签）：每一处改 draft 的路都走按字截断 + 同步 draftCount ──
  const wlSrc = stripComments(readSrc('miniprogram/subpackages/feature/wish-labels/index.js'))
  const truncN = (wlSrc.match(/wishTextTruncate\(/g) || []).length
  const pairN = (wlSrc.match(/draft: text, draftCount: wishTextCount\(text\)/g) || []).length
  check(
    '★ 心愿签每一处按字截断都配一处按字计数（截断与计数成对；不留 `draft.length` / `.slice(0, TEXT_MAX)`）',
    truncN >= 3 && pairN >= truncN && !/draft\.length/.test(wlSrc) && !/\.slice\(0,\s*TEXT_MAX\)/.test(wlSrc),
    `wishTextTruncate=${truncN} 成对计数=${pairN}`
  )
}


if (process.argv.includes('--selftest') && !INJECT) {
  const { spawnSync } = await import('node:child_process')
  /* ⚠️ 先验「注入锚点还在不在」（2026-09-19 补，起因见 docs/AI施工错题本.md 的「守卫判据自身错误」）：
     注入的 `from` 在源码里找不到时，子进程会**抛错退出**（status ≠ 0），
     而下面的判据只看 status ≠ 0 → 会把「锚点失效」误报成「注入被检出」= **假绿**。
     2026-09-19 实测：132 个注入里有 **11 个**锚点已随历史改动消失 —— 也就是说这 11 条
     在历次自检里都显示「✓ 被检出」，实际**一次都没有验证过**。
     处理：把「已确认失效」的锚点显式登记（债务留痕，不许装作没有），并要求名单**只许变小** ——
     哪条锚点哪天恢复了却还留在名单里，直接失败，逼人删登记、让它回到真防线里。 */
  const KNOWN_DEAD_ANCHORS = new Set([
    'seed-allows-off-pattern',      // wishSeeds.js：句式闸写法已变
    'product-field-not-allowlisted',// manageProducts：白名单数组已重构
    'reco-label-hardcoded'          // blessProducts.js：文案已改
    // 2026-10-17：旧祈福墙退场，指向旧页 / 已删文件的注入整条移除，名单里对应 7 条一并删去
  ])
  const anchorAlive = (inj) => {
    const abs = resolve(ROOT, inj.file)
    const resolved = resolveReexport(abs)
    const raw = existsSync(resolved) ? readFileSync(resolved, 'utf8') : ''
    if (raw.indexOf(inj.from) !== -1) return true
    if (resolved !== abs && existsSync(abs) && readFileSync(abs, 'utf8').indexOf(inj.from) !== -1) return true
    return false
  }
  const deadNow = Object.entries(INJECTIONS).filter(([, inj]) => !anchorAlive(inj)).map(([n]) => n)
  const deadSet = new Set(deadNow)
  const newlyDead = deadNow.filter((n) => !KNOWN_DEAD_ANCHORS.has(n))
  const revived = [...KNOWN_DEAD_ANCHORS].filter((n) => !deadSet.has(n))
  if (newlyDead.length) {
    console.error(`  ✗ 有 ${newlyDead.length} 个注入锚点在源码里已失效（锚点失效会让「被检出」变成假绿，必须修锚点或登记）：`)
    newlyDead.forEach((n) => console.error(`      - ${n}（${INJECTIONS[n].file}）`))
  }
  if (revived.length) {
    console.error(`  ✗ 有 ${revived.length} 个锚点已恢复，但仍留在 KNOWN_DEAD_ANCHORS 里 —— 请从名单删掉，让它回到真防线：`)
    revived.forEach((n) => console.error(`      - ${n}`))
  }
  if (newlyDead.length || revived.length) {
    console.error('\n✗ selftest 失败：注入锚点清单与实际源码不一致')
    process.exit(1)
  }
  console.log(`  ✓ 注入锚点：有效 ${Object.keys(INJECTIONS).length - deadSet.size} 条；已登记失效并跳过 ${deadSet.size} 条`)

  let bad = 0
  let ran = 0
  /* ⚠️ 2026-09-22 机器约束（本机 2 vCPU / 4 GB，且与 Web 服务共用 2.22 GB cgroup）：
     全量 selftest 要跑 ~193 次子进程（每次都要跑完整个 test:wish-wall），一次跑不完。
     支持按序号切片（`WISH_WALL_SELFTEST_FROM` / `_TO`，左闭右开）把覆盖分几次做完。
     **默认不切片 = 全量**；切片只决定"这一次跑哪些子进程"，不改任何判据、
     也不跳过锚点核对（上面那段始终全量跑）。报告里必须写明哪些序号实际跑过。 */
  const allNames = Object.keys(INJECTIONS)
  const sliceFrom = Math.max(0, Number(process.env.WISH_WALL_SELFTEST_FROM) || 0)
  const sliceTo = Math.min(allNames.length, Number(process.env.WISH_WALL_SELFTEST_TO) || allNames.length)
  const sliceNames = allNames.slice(sliceFrom, sliceTo)
  if (sliceFrom > 0 || sliceTo < allNames.length) {
    console.log(`  · 本次只跑注入 #${sliceFrom}–#${sliceTo - 1}（共 ${allNames.length} 条；机器内存约束下的分片）`)
  }
  for (const name of sliceNames) {
    if (deadSet.has(name)) continue // 锚点失效的注入证明不了任何事，跳过（上面已登记留痕）
    ran += 1
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, WISH_WALL_INJECT: name },
      encoding: 'utf8'
    })
    if (run.status !== 0) {
      console.log(`  ✓ 注入 ${name} 被检出`)
    } else {
      bad += 1
      console.error(`  ✗ 注入 ${name} 未被检出（断言不会失败 = 守卫无效）`)
    }
  }
  const clean = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
  if (clean.status !== 0) {
    bad += 1
    console.error('  ✗ 未注入时本应通过，实际失败：')
    // stdout 与 stderr 都要看：失败明细走 stderr、汇总走 stdout，
    // 用 `stdout || stderr` 会把唯一的线索（那条 ✗）丢掉，报错变成空行。
    const failLines = `${clean.stdout || ''}\n${clean.stderr || ''}`
      .split('\n')
      .filter((l) => l.includes('✗'))
      .slice(0, 6)
    console.error(failLines.length ? failLines.map((l) => '    ' + l.trim()).join('\n') : (clean.stdout || clean.stderr))
  } else {
    console.log('  ✓ 未注入时通过（无假阳性）')
  }
  if (bad) {
    console.error(`\n✗ selftest 失败 ${bad} 项`)
    process.exit(1)
  }
  console.log(`\n✓ selftest 通过：${ran} 个有效回归注入全部被检出（另 ${deadSet.size} 条锚点失效已登记跳过），且无假阳性`)
  process.exit(0)
}

/* ================================================================== *
 * 第二批改造的**状态位**（2026-09-20）：每一条都配了注入（见 INJECTIONS 末尾六条）
 *
 * 为什么这六处必须单独立判据：它们全是"新加的状态位"，而**状态位的失效方式是静默的** ——
 * 少清一个标志、少写一个字段，页面照样渲染、单测照样绿，
 * 只有在真机上表现为"永久显示网络异常""点了没反应""条数写着 0 而墙上明明有一条"。
 * ------------------------------------------------------------------ */


/* ================================================================== *
 * 动效专项（2026-09-20 第三批）
 *
 * 为什么单独立判据：动效的失效方式**全是静默的** —— 颜色跑出令牌、等待态把文字一起压暗、
 * 五颗粒子同时起跳，页面照样渲染、单测照样绿，只有在真机上"看着不对"。
 * ------------------------------------------------------------------ */


/* ================================================================== *
 * 展品主角区（2026-09-27「马上有 = 门店核心 IP」）
 *
 * 门店码 scene 只有 `k=mashangyou`、不带 productId —— 现场扫码进来的人此前到不了马上有的商品页。
 * 现在：墙头展签 + 展品卡（文案逐条有出处，见 config/wallExhibit.js）+ 只读解析那件商品。
 * ================================================================== */


console.log(`\n需求 28 行为断言：通过 ${passed} / ${passed + failed}`)
if (failed) {
  failures.forEach((f) => console.error('  ✗ ' + f))
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ 需求 28 全链路断言通过（集合只读 / 服务端昵称 / 频控与长度 / 状态可见性 / 开关闸门 / 弹幕布局 / AI 基础内容 / 进页彩蛋 / 点灯仪式 / 全站拓展预留）')
// 被测页面代码留下的定时器会让进程白挂约 8.6s；判定已全部完成，冲刷输出后退出（保留 exitCode）
process.stdout.write('', () => process.exit())
