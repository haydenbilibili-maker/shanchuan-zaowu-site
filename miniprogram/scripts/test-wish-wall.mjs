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
    from: ".where({ productKey, status: STATUS_VISIBLE })",
    to: '.where({ productKey })'
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
    from: '  const width = SCREEN_RPX + len * CHAR_RPX',
    to: '  const width = SCREEN_RPX'
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
  // 每日一句不再按天轮换 → 同一天进来两次看到不同的话，仪式变成抽奖
  'lamp-fixed-line': {
    file: 'miniprogram/utils/wishWall.js',
    from: '  return all[rotateIndex(dayKey, all.length)]',
    to: '  return all[0]'
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
  // 祈福墙页同样丢掉新鲜值 → 开关打开后仍显示「暂未开放」
  'gate-flags-no-onupdate': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: '        onUpdate: (payload) => this.applyGate(payload && payload.flags)\n',
    to: ''
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
    from: 'check-cloud-functions-sync.cjs" $TARGETS --json',
    to: 'check-cloud-functions-sync.cjs" --json'
  },
  // 磁贴名被改回全称（产品已定为短名「开关」）→ 名字漂移必须被拦下
  'tile-label-drift': {
    file: 'miniprogram/subpackages/manager/manager/index.wxml',
    from: '<text>开关</text>',
    to: '<text>内容开关</text>'
  },
  // 轨道占用退回「固定间隔」→ 同轨叠成一片（这就是业务方说的灾难现场）
  'lane-overlap': {
    file: 'miniprogram/utils/wishWall.js',
    from: '    laneNextAt[lane] = delayMs + clearMs + gapMs',
    to: '    laneNextAt[lane] = delayMs + gapMs'
  },
  // 弹幕改回 CSS 无限循环 → 第二轮起各自错位，同轨又叠
  'danmaku-infinite-loop': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '  animation-iteration-count: 1;',
    to: '  animation-iteration-count: infinite;'
  },
  // 首屏预填被关掉 → 墙面在加载后 2–3 秒内是空的（只有刻度线），产品真机截图里的"空框"
  'danmaku-no-prefill': {
    file: 'miniprogram/utils/wishWall.js',
    from: '    const prefill = i < lanes',
    to: '    const prefill = false'
  },
  // 点灯卡片重新撞上全局信号灯基类 → 卡片被压成 12rpx 竖条
  'lamp-class-collision': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '.ww-lantern-box {',
    to: '.lamp {\n  position: relative;\n}\n\n.ww-lantern-box {'
  },
  // 标题退回「{产品名} · 祈福墙」→ 与产品名里的「马上有」重复两遍
  'title-duplication': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '      <text class="ww-title">祈福墙</text>',
    to: '      <text class="ww-title">{{productTitle}} · 祈福墙</text>'
  },
  // 底色退回全仓唯一的 #14120F（脱离设计 token）
  'page-bg-divergence': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '  background: var(--color-bg);',
    to: '  background: #14120F;'
  },
  // 加载失败又谎报成空墙
  'error-shown-as-empty': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: "{{loadError ? '墙面未展开' : '墙面还是空的'}}",
    to: "'墙面还是空的'"
  },
  // 失败没有重试入口
  'no-retry-entry': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: 'bindtap="refresh" hover-class="ww-error-retry-press"',
    to: 'hover-class="ww-error-retry-press"'
  },
  // 骨架不再渲染（退回"一行字"）
  'skeleton-removed': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '        <block wx:if="{{loading}}">',
    to: '        <block wx:if="{{false}}">'
  },
  // 撞车守卫必须能看见 @import 进来的全局层（badges 家族）
  'global-layer-collision': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '.ww-error {',
    to: '.badge-outline-brass {\n  display: flex;\n  padding: 20rpx;\n}\n\n.ww-error {'
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
  // 墙面退回只读装饰（弹幕点不开）
  'wall-not-tappable': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '          data-id="{{item.id}}"\n',
    to: ''
  },
  // 墙面丢掉置顶标记
  'dm-mark-dropped': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: 'class="ww-dm-mark {{item.pinned ? \'is-pinned\' : \'\'}}"',
    to: 'class="ww-dm-plain"'
  },
  // 「馆方」徽章复活（2026-09-18 产品已决定去掉：基线内容全盖章 = 不传递信息）
  // 2026-09-20：锚点跟随源码更新 —— 「我的」章已整条下线，改锚在它下面那行「置顶」章上；
  // 语义完全不变：往印记链里塞回一个「馆方」章，守卫必须检出。
  'official-badge-resurrected': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '            <text class="ww-tag-seal" wx:elif="{{item.pinned}}">置顶</text>',
    to: '            <text class="ww-tag-seal is-official" wx:elif="{{item.official}}">馆方</text>\n            <text class="ww-tag-seal" wx:elif="{{item.pinned}}">置顶</text>'
  },
  // 置顶印章被顺手删掉（去徽章时最容易误伤的就是它）
  'pinned-seal-dropped': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '            <text class="ww-tag-seal" wx:elif="{{item.pinned}}">置顶</text>',
    to: ''
  },
  // 刚落愿不再高亮
  'no-fresh-highlight': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    // 2026-09-20：锚点跟随源码更新（class 上多了 is-mine 一档，见「我的」章下线）
    from: "class=\"ww-tag {{item.isFresh ? 'is-fresh' : ''}} {{item.isMine ? 'is-mine' : ''}}\"",
    to: 'class="ww-tag"'
  },
  // 分段控件退回标题（切换意图又看不出来）
  'seg-reverted': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '<view class="ww-seg" aria-role="tablist">',
    to: '<view class="ww-seg-x" aria-role="tablist">'
  },
  // 额度不再预告（让用户写完才被拒）
  'quota-line-dropped': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: "'今日还可写 ' + quota.left + ' 条'}}",
    to: "'(略)'}}"
  },
  // 落愿退回"只有一个 toast"（不本地落地）
  'no-optimistic-insert': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: '      this._wallItems = [fresh].concat(this._wallItems || [])',
    to: '      // injected: 不本地落地'
  },
  // 高亮定时器不清（页面卸载后仍可能 setData）
  'fresh-timer-leak': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: '  onUnload() {\n    this.clearDanmakuCycle()\n    this.clearFreshTimer()\n  },',
    to: '  onUnload() {\n    this.clearDanmakuCycle()\n  },'
  },
  // 弹层丢掉对话框语义（读屏不知道这是一个弹层）
  // ⚠️ 2026-09-18 锚点更新：结果层从"愿签弹层"扩到"纸签弹层"后，`aria-role="dialog"` 不再是唯一一处，
  // 这里显式锚到纸签弹层那一处（否则注入会打错目标 → 自检失效）
  'card-not-dialog': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '        class="ww-sheet"\n        wx:if="{{playResult}}"\n        style="transform: translateY({{sheetDragY}}px);"\n        aria-role="dialog"\n',
    to: '        class="ww-sheet"\n        wx:if="{{playResult}}"\n        style="transform: translateY({{sheetDragY}}px);"\n'
  },
  // 弹幕不再用手写体
  'handwriting-dropped': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '  font-family: "HanziPen SC", "Hannotate SC", "STKaiti", "Kaiti SC", KaiTi, 楷体, "Songti SC", serif;\n  font-size: 28rpx;',
    to: '  font-size: 28rpx;'
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
  // 去掉收尾条 → 30 条又变成看不到头的滚动
  'no-end-marker': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '      <view class="ww-end" wx:if="{{items.length}}">',
    to: '      <view class="ww-end-x" wx:if="{{false}}">'
  },
  // 打到上限也装作全量
  'cap-lies': {
    file: 'miniprogram/utils/wishWall.js',
    from: '  return n >= (Number(limit) || LIST_LIMIT)',
    to: '  return false'
  },
  // 弹幕轮播断线（排期函数被改名/删掉）→ 一轮播完墙面就死了
  'no-danmaku-cycle': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: '  scheduleDanmakuCycle(rows) {',
    to: '  scheduleDanmakuCycleRemoved(rows) {'
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
  // 不标记「我的」→ 「我的心愿」视图与愿签上的印记全失效（而且看不出错）
  'mine-not-marked': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: '      this._wallItems = markMine(this._wallItems || [], list)',
    to: '      this._wallItems = this._wallItems || []'
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
  // 「距下一个节气」不接线 → solarTermGap 变成只在测试里存在的死代码
  'solar-gap-dropped': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: '    const gap = solar ? null : solarTermGap(dayKey)',
    to: '    const gap = null'
  },
  // ===== 多面墙治理 =====
  // 管理页退回写死默认墙 → 第二面墙的弹幕又变成无人可治
  'manager-wall-hardcoded': {
    file: 'miniprogram/subpackages/manager/wish-wall/index.js',
    from: "const payload = { action: 'staffList', productKey: this.data.productKey, status: this.data.activeStatus }",
    to: "const payload = { action: 'staffList', productKey: DEFAULT_PRODUCT_KEY, status: this.data.activeStatus }"
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
  // 入口文案写死「马上有」→ 第二面墙的入口写着别人的商品名
  'entry-copy-hardcoded': {
    file: 'miniprogram/components/WishWallEntry/index.js',
    from: "    (isDefault ? '把心愿挂上墙，让「马上有」替你记着' : '把心愿挂上墙，替自己记着')",
    to: "    '把心愿挂上墙，让「马上有」替你记着'"
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
  // ===== 注册转化（祈福墙 = 注册转化路径）=====
  // 未注册判定写死 false → 落愿时永不弹注册，转化路径等于没接
  'register-gate-never-fires': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: '      return state === \'guest\'',
    to: '      return false'
  },
  // 注册成功不续发 → 用户注册完那条心愿凭空消失（最伤的转化体验）
  'register-resume-dropped': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: '    this.setData({ draft: text })\n    this.submitWish()\n  },',
    to: '    this.setData({ draft: text })\n  },'
  },
  // 会话读失败按未注册处理（fail-closed）→ 会话抖动会把「挂上墙」整个挡下来
  'register-gate-fail-closed': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: "      console.warn('wish wall session check failed', e)\n      return false",
    to: "      console.warn('wish wall session check failed', e)\n      return true"
  },
  // ===== 视觉与排版（2026-09-18）=====
  // 弹幕配色退回「深色墙」那套 → 浅纸上只剩 1.1:1，字几乎隐形
  'danmaku-tone-low-contrast': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '.ww-tone-0 { color: #4A4234; }',
    to: '.ww-tone-0 { color: #EFE6D2; }'
  },
  // 仪式两卡退回 flex → 左卡按内容撑宽，两卡不等宽
  'ritual-row-flex-again': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '  display: grid;\n  grid-template-columns: 1fr 1fr;\n  align-items: stretch;',
    to: '  display: flex;\n  align-items: stretch;'
  },
  // 灯卡把竖排时代的 margin-bottom 加回来 → 两卡不等高
  'lantern-margin-back': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    // 2026-09-20：锚点跟随源码更新（灯卡底色从裸 #1F1D1A 换成 var(--color-bg-card)，同值）。
    // 语义不变：把已删掉的 margin-bottom 塞回去，守卫必须检出"灯卡与木鱼卡不再等高"。
    from: '  padding: 26rpx 20rpx;\n  background: linear-gradient(180deg, var(--color-bg-card) 0%, #1B1917 100%);',
    to: '  margin-bottom: var(--space-3);\n  padding: 26rpx 20rpx;\n  background: linear-gradient(180deg, var(--color-bg-card) 0%, #1B1917 100%);'
  },
  // 木鱼卡跟着灯卡改成顶对齐 → 等高之后底部留一大片空白（真图上很明显）
  'muyu-align-top-again': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '  align-items: center;\n  gap: var(--space-2);\n  min-width: 0;',
    to: '  align-items: flex-start;\n  gap: var(--space-2);\n  min-width: 0;'
  },
  // 条数又飘出段外 → 读起来像"我的心愿 26 条"
  'seg-count-orphan-again': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '      </view>\n    </view>\n    <view class="ww-tags">',
    to: '      </view>\n      <text class="ww-head-n">{{items.length}} 条</text>\n    </view>\n    <view class="ww-tags">'
  },
  // 灯芯又变回实心圆 → 灯泡图标背后多一个圆底
  'lamp-icon-back-to-circle': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '  background-size: contain;\n  opacity: 0.38;',
    to: '  border-radius: 50%;\n  background: #2A2723;\n  background-size: contain;\n  opacity: 0.38;'
  },
  // 同一选择器又冒出第二份图 → 后一份静默吃掉前一份（改哪份都不生效）
  'lamp-icon-image-duplicated': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '  opacity: 0.38;\n  transition: opacity 0.4s ease, transform 0.4s ease;\n}',
    to: '  opacity: 0.38;\n  transition: opacity 0.4s ease, transform 0.4s ease;\n}\n.ww-lantern-core {\n  background-image: url("data:image/svg+xml,%3Csvg/%3E");\n}'
  },
  // 灯语又缩回标题旁边那 ~220rpx 的窄列 → 孤字回来（产品反馈过的"文案拥挤"）
  'lamp-tail-inline-again': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '  flex: 0 0 100%;\n  min-width: 0;\n}',
    to: '  flex: 1;\n  min-width: 0;\n}'
  },
  // 文案超长 → 整行也装不下，折行 + 孤字
  'lamp-copy-too-long': {
    file: 'miniprogram/utils/wishRitual.js',
    from: "  '一灯不灭，一事可期。'",
    to: "  '一灯不灭，一事可期，慢慢来总会抵达的。'"
  },
  // 间距/层级又压紧 → 回到真图上那个"三行小字贴着"的状态
  // ⚠️ 锚点必须**含中间那行注释**：2026-09-21 夜班给 8 处离群字号加口径注释时，
  //    注释被插进 `margin-top` 与 `font-size` 之间 → 原「三行连续」锚点失配；
  //    自检的「死锚点检测」把它报了出来（机制按设计工作）。
  //    这里**把注释纳入锚点**、而不是缩短锚点 —— 缩短会丢掉 `margin-top` 那半，
  //    本注入就不再覆盖「灯位说明距灯语 ≥8rpx」那条断言（等于悄悄弱化判据）。
  'lamp-spacing-tight-again': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '  margin-top: var(--space-1);\n  /* 字号口径：文本带；19rpx 不在字阶 14 档内（18 与 20 的正中间）→ 不动值（见文件头） */\n  font-size: 19rpx;\n  line-height: 1.5;',
    to: '  margin-top: 2rpx;\n  /* 字号口径：文本带；19rpx 不在字阶 14 档内（18 与 20 的正中间）→ 不动值（见文件头） */\n  font-size: 21rpx;\n  line-height: 1.2;'
  },
  // 音效默认关 → 用户永远听不到（产品口径是"默认开但可关"）
  'sound-default-off': {
    file: 'miniprogram/utils/ritualFeedback.js',
    from: '  const v = readStore(SOUND_KEY, true)',
    to: '  const v = readStore(SOUND_KEY, false)'
  },
  // 频率闸门拿时间戳 0 当"没响过"的哨兵 → 闸门在 t=0 之后失效
  'sound-gate-zero-sentinel': {
    file: 'miniprogram/utils/ritualFeedback.js',
    from: "  if (lastAtMs === null || lastAtMs === undefined || lastAtMs === '') return true",
    to: '  if (!Number(lastAtMs)) return true'
  },
  // 回声文案超长 → 墙上页脚那一行装不下（注入用的字符串必须**真的**超过上限）
  'echo-over-long': {
    file: 'miniprogram/utils/ritualFeedback.js',
    from: "  muyu: ['我敲了一下木鱼',",
    to: "  muyu: ['我刚刚轻轻地敲了一下这只木鱼呀',"
  },
  // 回声改成第三人称 → 会被读成"别人许的愿"
  'echo-third-person': {
    file: 'miniprogram/utils/ritualFeedback.js',
    from: "  muyu: ['我敲了一下木鱼', '我敲一声，静一分',",
    to: "  muyu: ['我敲了一下木鱼', '有人敲了木鱼',"
  },
  // 墙上回声的 DOM 掉了（样式还在、类名改了）→ 即时反馈其实不显示
  'echo-dom-dropped': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '      <view\n        class="ww-echo"\n',
    to: '      <view\n        class="ww-echo-legacy"\n'
  },
  // 回声动画时长与 ECHO_HOLD_MS 分叉 → 计时器移除时动画还在播（或反之）
  'echo-duration-mismatch': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '  animation: ww-echo-life 1800ms ease-out forwards;',
    to: '  animation: ww-echo-life 900ms ease-out forwards;'
  },
  // 木鱼计数又变成"只写不读" → 功德每次进页归零
  'muyu-count-write-only-again': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: "    this.setData({ soundOn: ritualFeedback.isSoundEnabled(), muyuCount: wishRitual.readMuyuCount() })",
    to: '    this.setData({ soundOn: ritualFeedback.isSoundEnabled() })'
  },
  // 音效开关的绑定掉了 → 开关看得见点不动
  'sound-toggle-ui-dropped': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '        bindtap="onToggleSound"',
    to: '        bindtap="noopToggle"'
  },
  // 轨道刻度的百分比漂了 → 刻度压着弹幕文字（两套写法对不上）
  'rail-percent-drift': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '.ww-wall-rail.rail-6 { top: 84%; }',
    to: '.ww-wall-rail.rail-6 { top: 76%; }'
  },
  // 墙页脚的跳转绑定掉了 → 「看全部 ›」变成一句不会动的字
  'wall-foot-jump-dropped': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '        bindtap="goWishList"',
    to: '        bindtap="noopWishList"'
  },
  // 列表落点的 id 被改名 → 跳转目标不存在（selector 打空）
  'wishlist-anchor-renamed': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '<view class="ww-head" id="wishList">',
    to: '<view class="ww-head" id="wishListOld">'
  },
  // 重看灯又绕回弹 toast（灯语就在卡上，弹框是多余的一层，也让原生弹窗棘轮多一处）
  'lamp-relight-toast-back': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: "      this.pushEcho('lampAgain')",
    to: "      wx.showToast({ title: lamp.line || '今日灯已点', icon: 'none' })"
  },
  // 玩法文案里混进命理/占卜表述 → 审核风险
  'play-content-forbidden-word': {
    file: 'miniprogram/config/ritualPlayContent.js',
    from: "  { yi: '开口', ji: '憋着', line: '想要什么就说出来，说出口才有回音。', wish: '回音' },",
    to: "  { yi: '开口', ji: '憋着', line: '今天适合找人给你算一卦，看看吉凶。', wish: '回音' },"
  },
  // 玩法结果用随机数 → 刷新就换一个，"今日一签"名存实亡
  'play-nondeterministic': {
    file: 'miniprogram/utils/ritualPlay.js',
    from: '  return `${String(playId)}|${String(dayKey)}`',
    to: '  return `${String(playId)}|${String(dayKey)}|${Math.random()}`'
  },
  // 资料门禁被拆掉 → 没有星座也照样"给一个结果"（编出来的）
  'play-profile-gate-dropped': {
    file: 'miniprogram/utils/ritualPlay.js',
    from: "    const value = String(profile[need] || '')",
    to: "    const value = String(profile[need] || 'fallback')"
  },
  // 瓦片不再由注册表派生 → 加玩法必然漏接线
  'play-tile-hardcoded': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '          wx:for="{{plays}}"',
    to: '          wx:for="{{[]}}"'
  },
  // 心愿词规范化被拆掉 → 脏值（「回音」「马上有超长…」）会直接预填进写愿签
  'play-wish-not-prefixed': {
    file: 'miniprogram/utils/ritualPlay.js',
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
  // 祈运提示的 DOM 掉了 → 标签带了也看不见
  'bless-guide-dom-dropped': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '      <view class="ww-plays-guide" wx:if="{{blessGuide}}">',
    to: '      <view class="ww-plays-guide-off" wx:if="{{blessGuide}}">'
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
  // 推荐卡 DOM 掉了 → 推荐取了也看不见
  'reco-dom-dropped': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '<view class="ww-play-reco" wx:if="{{reco}}"',
    to: '<view class="ww-play-reco-off" wx:if="{{reco}}"'
  },
  // 缓存键丢掉日期 → 跨天还拿昨天的推荐（"一天一件"悄悄变成"永远同一件"）
  'reco-cache-crosses-day': {
    file: 'miniprogram/utils/blessProducts.js',
    from: '  return `${t}|${String(dayKey)}`',
    to: '  return `${t}`'
  },
  // 回声条又变回半透明 → 页脚文字透上来，两行字叠一起（真机截图抓到的缺陷）
  'echo-strip-translucent-again': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '  background: linear-gradient(90deg, #E6D6AE 0%, #EFE8DA 62%, #E7DFCF 100%);',
    to: '  background: linear-gradient(90deg, rgba(233, 190, 110, 0.34) 0%, rgba(231, 223, 207, 0.97) 62%);'
  },
  // 未点灯的灯卡又顶对齐 → 底部留白（真机截图里与木鱼卡不对称）
  'idle-lamp-top-align-again': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '.ww-lantern.is-idle {\n  align-items: center;\n}',
    to: '.ww-lantern.is-idle {\n  align-items: flex-start;\n}'
  },
  // 页面不再解析 scene → 门店码扫码进来落错墙、来源也丢了
  'store-scene-parsing-dropped': {
    file: 'miniprogram/utils/wishWall.js',
    from: "  const rawKey = grab('k') || grab('productKey')\n  if (/^[a-zA-Z0-9_-]{1,40}$/.test(rawKey)) out.productKey = normalizeProductKey(rawKey)",
    to: "  const rawKey = ''\n  if (false) out.productKey = normalizeProductKey(rawKey)"
  },
  // 显式参数不再优先 → 门店码会覆盖正常入口的墙
  'store-scene-overrides-url': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: "      productKey: normalizeProductKey(opts.productKey || fromScene.productKey),",
    to: "      productKey: normalizeProductKey(fromScene.productKey || opts.productKey),"
  },
  // matchSource 又变回常量 → 场景兜底的商品被说成"同好也在看"（编造社会证明）
  'reco-match-source-constant': {
    file: 'miniprogram/cloudfunctions/getBlessProducts/index.js',
    from: "    .map((r) => leanProduct(r, explicitIds.has(String(r._id)) ? 'tag' : 'scene'))",
    to: "    .map((r) => leanProduct(r, 'tag'))"
  },
  // 文案不再随依据走 → 页面永远显示"同好也在看"
  'reco-label-hardcoded': {
    file: 'miniprogram/utils/blessProducts.js',
    from: "  if (s === 'scene') return '这类心愿常配这件'",
    to: "  if (s === 'scene') return '同好也在看'"
  },
  // 页头那颗 chip 写死一个词 → 与这面墙的真实祈运标签脱钩
  'hero-bless-hardcoded': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '        <text class="ww-bless" wx:if="{{blessLabelText}}">偏「{{blessLabelText}}」</text>',
    to: '        <text class="ww-bless">偏「求成」</text>'
  },
  // 玩法区里那条提示又回来了 → 提示两处、且多占 60rpx
  'plays-guide-resurrected': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '      <view class="ww-play-grid">',
    to: '      <view class="ww-plays-guide"><text class="ww-plays-guide-text">这面墙偏「求成」：摇一签。</text></view>\n      <view class="ww-play-grid">'
  },
  // ── 发送条：**顺流**设计（2026-09-19 产品口径变更，原为吸底）────────────────
  // 旧吸底版的三条判据与四条注入随设计一并退役（详见下方断言处的说明）。
  // 新注入测的是顺流设计的三条边界：又变回 fixed / 丢了输入框 id / 被挪到墙之外。
  'composer-fixed-again': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '.ww-composer {\n  display: flex;\n  align-items: center;\n  gap: 14rpx;\n  margin: 20rpx 0 4rpx;',
    to: '.ww-composer {\n  position: fixed;\n  left: 0;\n  right: 0;\n  bottom: 0;\n  z-index: 30;\n  display: flex;\n  align-items: center;\n  gap: 14rpx;\n  margin: 20rpx 0 4rpx;'
  },
  'composer-input-id-dropped': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '        id="wishInput"',
    to: '        id="wishInputMoved"'
  },
  'composer-duplicated': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '    <view class="ww-composer">',
    to: '    <view class="ww-composer"></view>\n    <view class="ww-composer">'
  },
  // 弹层退回"内联亮色卡"（遮罩/把手都没了）→ 又变回产品说的"与页面割裂"
  'sheet-identity-dropped': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '        class="ww-sheet-mask"\n        wx:if="{{playResult}}"',
    to: '        class="ww-sheet-mask-off"\n        wx:if="{{playResult}}"'
  },
  // 产品链路又拆成两行（推荐 + 这面墙的藏品并列）→ 主次不分
  'product-path-split-again': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '          wx:if="{{reco || productId}}"',
    to: '          wx:if="{{reco}}"\n        ></view>\n        <view\n          class="ww-sheet-product"\n          wx:if="{{productId}}"'
  },
  // 社会证明复活（把推荐标题写死成"同好也在看"）
  'social-proof-resurrected': {
    file: 'miniprogram/utils/blessProducts.js',
    from: "  return label ? `偏「${label}」· 为你配一件` : '为你配一件'",
    to: "  return '同好也在看'"
  },
  // 弹层又被塞回 .ww-plays 的层叠上下文 → 发送条会画到它上面
  'sheet-back-inside-plays': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '      <!-- 需要星座/MBTI 但资料里没有',
    to: '      <view class="ww-plays"><view class="ww-sheet"></view>\n      <!-- 需要星座/MBTI 但资料里没有'
  },
  // 遮罩浓度被调回"看不出被压暗"
  'sheet-mask-too-light': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '  background: rgba(10, 9, 7, 0.78);',
    to: '  background: rgba(12, 11, 9, 0.62);'
  },
  // 点灯的音效又被摘掉（只留木鱼）→ "玩法动作的音效"只剩一半
  'lamp-sound-dropped': {
    file: 'miniprogram/utils/ritualFeedback.js',
    from: "  lamp: '/subpackages/feature/wish-wall/assets/lamp.mp3'",
    to: "  lampOff: '/subpackages/feature/wish-wall/assets/lamp.mp3'"
  },
  // 两个动作共用同一个文件（复制粘贴）→ 点灯响的是木鱼的"笃"
  'sounds-share-one-file': {
    file: 'miniprogram/utils/ritualFeedback.js',
    from: "  lamp: '/subpackages/feature/wish-wall/assets/lamp.mp3'",
    to: "  lamp: '/subpackages/feature/wish-wall/assets/muyu.mp3'"
  },
  // 分享文案把"依据"带出去 → 等于公开了用户的星座/型别
  'play-share-leaks-basis': {
    file: 'miniprogram/utils/ritualPlay.js',
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
  // ── 「写成心愿」不收弹层（2026-09-19 真机反馈的缺陷本体）───────────────────
  // 纸签弹层 `.ww-sheet` 与吸底发送条 `.ww-composer` 都是 fixed bottom:0，
  // 而弹层 z-index 41 > 发送条 z-index 30 —— 不收弹层就会永久盖住发送条。
  // 真机现象：「页面滚下去了，但看不到输入框」。本条注入把修复撤掉，新判据必须变红。
  'play-wish-keeps-sheet': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    // 2026-09-20：锚点跟随源码更新（原来锚的是「先收弹层，露出吸底发送条…」那句注释，
    // 拆签动线重写时该注释被替换 → 锚点失效会让这条注入变成假绿，自检已拦下）。
    // 语义不变：去掉 closePlayResult()，守卫必须检出"弹层没被收掉"。
    from: '    // ① 先收弹层：`.ww-sheet` 的 z-index 高于发送条，不收就会一直盖住它\n    this.closePlayResult()',
    to: '    // 注入：不收弹层（回归注入）'
  },
  // ── 「连续记录云保存」注册钩子（2026-09-20）────────────────────────────────
  // 三条注入分别对应三类"看起来做了、其实没做"的缺陷：
  //   ① 不看开关 → 超管关不掉，未注册用户照样被弹注册；
  //   ② 不同步就报成功 → 空承诺（钩子成立与否的关键就在这一步）；
  //   ③ 云函数 saveFlags 漏字段 → 后台保存成功但设置被静默重置为默认关。
  'ritual-gate-ignores-flag': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: '      flagOn: this.data.showRitualProfile === true,',
    to: '      flagOn: true,'
  },
  'ritual-gate-skips-sync': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: '    const ok = await this.syncRitualToCloud()',
    to: '    const ok = true'
  },
  'ritual-save-drops-field': {
    file: 'miniprogram/cloudfunctions/getContentDisplayFlags/index.js',
    from: '    // ⚠️ 漏这一行 = 超管在后台保存成功、但 showRitualProfile 被静默重置为默认（关）\n    showRitualProfile: incoming.showRitualProfile\n',
    to: ''
  },
  // 「取」这一半被摘掉（只存不取）→ 换机/清缓存后本地仍是 0，而文案仍承诺「记录不丢」
  'ritual-recover-unwired': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: '    this.restoreRitualFromCloud()',
    to: ''
  },
  // ── 动效专项（2026-09-20 第三批）：余烬配色统一 / 等待态不压文字 / 缓动一致 ──
  'ember-off-palette-back': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '.ww-heart.h3 { left: -4rpx; color: var(--brass-400);',
    to: '.ww-heart.h3 { left: -4rpx; color: #C7B4DE;'
  },
  'pending-dims-text-back': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '  0%, 100% { border-color: rgba(196, 167, 108, 0.42); }\n  50% { border-color: rgba(196, 167, 108, 0.95); }',
    to: '  0%, 100% { opacity: 1; }\n  50% { opacity: 0.55; }'
  },
  // ── 第二批改造（2026-09-20）：门禁错误态 / 聚焦定时器 / 跨天 / 额度未知 / 玩法失败 / 条数同步 ──
  // 为什么每条都配注入：这六处全是"新加的状态位"，而**状态位的失效方式是静默的** ——
  // 少清一个标志、少写一个字段，页面照样渲染，只有真机上表现为"永久显示网络异常""点了没反应"。
  'gate-error-never-cleared': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: '      if (this.data.gateError || this.data.loading) this.setData({ gateError: false, loading: false })',
    to: '      // 注入：读成功也不清错误态'
  },
  'focus-timer-anonymous': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: '    this._focusTimer = setTimeout(() => {',
    to: '    setTimeout(() => {'
  },
  'onshow-daykey-drop': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: '    if (lampDay && lampDay !== today) this.initRitual()',
    to: '    if (false) this.initRitual()'
  },
  'quota-unknown-dropped': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: "      this.setData({ myHidden: 0, quota: Object.assign({}, this.data.quota, { unknown: true }) })",
    to: '      this.setData({ myHidden: 0 })'
  },
  'play-fail-silent-again': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: "        this.setData({ playNeed: null })\n        this.showAppToast({",
    to: "        this.setData({ playNeed: null })  // 注入：静默 return（回到旧行为）\n        void 0 && this.showAppToast({"
  },
  'wallcount-desync-on-insert': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: '        wallCount: this._wallItems.length,',
    to: '        // 注入：乐观插入不同步条数'
  },
  // ── 质感批次（2026-09-19）：令牌化 / 按压反馈 / 无障碍 ──────────────────────
  // 字号令牌写回裸值（30rpx 是 --fs-30 在册值；写回后"本页字号一律走 --fs-*"必须变红）
  'wishwall-fontsize-literal-back': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '.ww-lantern-title {\n  display: block;\n  font-size: var(--fs-30);',
    to: '.ww-lantern-title {\n  display: block;\n  font-size: 30rpx;'
  },
  // 新增一处**非登记**的非令牌字号（25rpx 在册；注入 23rpx → 白名单比对必须变红）
  'wishwall-fontsize-unregistered': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '.ww-streak-l {\n  margin-top: 2rpx;\n  font-size: var(--fs-18);',
    to: '.ww-streak-l {\n  margin-top: 2rpx;\n  font-size: 23rpx;'
  },
  // 与 --space-* 同值的间距写回裸数字（.ww-head 的下间距 16rpx == --space-2）
  'wishwall-space-literal-back': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '  gap: 12rpx;\n  margin: var(--space-4) 0 var(--space-2);',
    to: '  gap: 12rpx;\n  margin: var(--space-4) 0 16rpx;'
  },
  // 灯卡按压反馈与木鱼卡分叉（0.86 → 0.9，回到本批修掉的那个离群值）
  'press-opacity-diverge': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '.ww-lantern-press {\n  opacity: 0.86;\n}',
    to: '.ww-lantern-press {\n  opacity: 0.9;\n}'
  },
  // hover-class 指到一个不存在的类 → 点了没反馈（WXSS 不报错，只有这条判据能发现）
  'hover-class-orphan': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: 'hover-class="ww-tag-press"',
    to: 'hover-class="ww-tag-press-typo"'
  },
  // hover-stay-time 又分叉（木鱼卡回到 60）
  'hover-stay-diverge': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: 'bindtap="onMuyuTap" hover-class="ww-muyu-press" hover-stay-time="70"',
    to: 'bindtap="onMuyuTap" hover-class="ww-muyu-press" hover-stay-time="60"'
  },
  // 可点元素丢掉 aria-role（博物笔记入口）
  'aria-role-dropped': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '      hover-class="ww-relics-press"\n      hover-stay-time="70"\n      aria-role="button"\n    >',
    to: '      hover-class="ww-relics-press"\n      hover-stay-time="70"\n    >'
  },
  // 装饰圆点不再 aria-hidden（读屏会把纯色圆点当内容念）
  'decorative-not-hidden': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: 'class="signal-light {{lamp.lit ? \'lamp-brass on\' : \'lamp-muted hollow\'}}" aria-hidden="true"',
    to: 'class="signal-light {{lamp.lit ? \'lamp-brass on\' : \'lamp-muted hollow\'}}"'
  },
  // aria-hidden 反而盖到文案上（把 CTA「看看这件 ›」隐藏 —— 读屏用户丢掉主路出口）
  'aria-hidden-over-text': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '<text class="ww-sheet-product-go">看看这件 ›</text>',
    to: '<text class="ww-sheet-product-go" aria-hidden="true">看看这件 ›</text>'
  },
  // .ww-wall 又被拆成两块（后一块静默吃掉前一块的 border/box-shadow）
  'wall-rule-resplit': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '/* ── 点灯 / 木鱼 图标替换（2026-09-19，产品负责人提供 SVG）',
    to: '.ww-wall {\n  border: 1rpx solid rgba(196, 167, 108, 0.9);\n}\n\n/* ── 点灯 / 木鱼 图标替换（2026-09-19，产品负责人提供 SVG）'
  },
  // 死选择器 .ww-wall-loading 复活（wxss 有定义、wxml/js 零引用）
  'dead-selector-back': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '.ww-wall-empty {\n  position: absolute;',
    to: '.ww-wall-empty,\n.ww-wall-loading {\n  position: absolute;'
  },
  // 愿签骨架的底面漂回浅一档（骨架→真卡替换那一帧会跳色）
  'tag-skel-color-drift': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    // 2026-09-20：锚点跟随源码更新 —— 骨架 padding 已从 `20rpx 22rpx 20rpx 26rpx`
    // 改为与真卡**逐字同口径**的 `var(--space-6) var(--space-2) var(--space-2) 22rpx`
    //（修「加载时整列跳高 40%」；也必须用令牌，裸 48/16rpx 会被间距令牌判据拦下）。
    from: '  padding: var(--space-6) var(--space-2) var(--space-2) 22rpx;\n  margin-bottom: 14rpx;\n  /* 与真卡 .ww-tag 同底同渐变：骨架被真卡替换时不许跳色（原写 #1F1D1A，比真卡顶色浅一档）。 */\n  background: linear-gradient(180deg, #221F1A 0%, #1B1917 100%);',
    to: '  padding: var(--space-6) var(--space-2) var(--space-2) 22rpx;\n  margin-bottom: 14rpx;\n  /* 与真卡 .ww-tag 同底同渐变：骨架被真卡替换时不许跳色（原写 #1F1D1A，比真卡顶色浅一档）。 */\n  background: linear-gradient(180deg, #1F1D1A 0%, #1B1917 100%);'
  },
  // ── 创新钩子 H2「功德证」（2026-09-20）────────────────────────────────────
  // 木鱼可连点 → 每敲一下就写一次云端（方案点名的头号风险：写放大）
  'cert-writes-per-tap': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: '    this.maybeOfferRitualGate()\n    // 「功德证」次级入口：只做**纯函数判定 + setData**，一次云端写都没有',
    to: '    void this.syncRitualToCloud()\n    this.maybeOfferRitualGate()\n    // 「功德证」次级入口：只做**纯函数判定 + setData**，一次云端写都没有'
  },
  // 里程点常量被随手改（口径未确认就悄悄漂移）
  'cert-milestones-drift': {
    file: 'miniprogram/utils/muyuCertificate.js',
    from: 'const CERT_MILESTONES = [100, 500, 1000]',
    to: 'const CERT_MILESTONES = [100, 500, 10000]'
  },
  // 同步失败也报"完成"（漏斗数字变假、用户被告知"已存到云端"）
  'cert-sync-lies': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: "    if (ok) {\n      this._certSyncedCount = this.data.muyuCount\n      this.trackCertGate('resume_success', { milestone: m })",
    to: "    if (true) {\n      this._certSyncedCount = this.data.muyuCount\n      this.trackCertGate('resume_success', { milestone: m })"
  },
  // 同步结果的判据退回"判一个对象"（P0：2026-09-20 修，此前 851 条断言全部漏掉）
  'ritual-sync-object-vs-true': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: "      if (res && typeof res === 'object') return res.ok === true\n      return res === true",
    to: '      return res === true'
  },
  // 领证只改内存不落本地存档 → 关掉小程序证就没了（"可保管"是空话）
  'cert-local-record-dropped': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.js',
    from: '    muyuCert.writeRecord(this._certRecord)',
    to: '    void 0'
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
    lt: (v) => ({ $lt: v })
  }
  const matches = (doc, where) =>
    Object.keys(where || {}).every((k) => {
      const cond = where[k]
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
 * 4) 开关：关闭时 C 端不得发请求 / 云函数默认关
 * ------------------------------------------------------------------ */

const flagSrc = readSrc('miniprogram/cloudfunctions/getContentDisplayFlags/index.js')
check('云函数默认值含 showMaShangYou', /showMaShangYou: false/.test(flagSrc))
check('云函数 normalize 用 === true（缺配置即关）', /showMaShangYou: src\.showMaShangYou === true/.test(flagSrc))
check('saveFlags 显式透传该字段（漏了保存就丢）', /showMaShangYou: incoming\.showMaShangYou/.test(flagSrc))

const clientFlagSrc = readSrc('miniprogram/utils/contentDisplayFlags.js')
check('客户端 normalize 同口径', /showMaShangYou: src\.showMaShangYou === true/.test(clientFlagSrc))
check('客户端导出关闭提示', /toastWishWallClosed/.test(clientFlagSrc))

const wallPageSrc = readSrc('miniprogram/subpackages/feature/wish-wall/index.js')
check('关闭时提前返回不发请求', /if \(!allowed\) return\s*\n\s*await this\.refresh\(\)/.test(wallPageSrc))
check('闸门来自 showMaShangYou', /flags\.showMaShangYou === true/.test(wallPageSrc))
check(
  '读开关失败时保守关闭，且**不冒充「馆方没开放」**（假事实 + 没有出路，2026-09-20 修）',
  // 2026-09-20：窗口从 200 放到 600（catch 里补了 5 行说明），并新增后半段断言 ——
  // 「保守关闭」只说了权限，没说"用户看到的是不是真话"：网络故障与"馆方关了"必须区分，
  // 且读失败要留一条重试的路（onGateRetry → bootstrap({force:true})）。
  // ⚠️ 这里不能用 wallWxml2：它在文件下方才初始化（本行执行时还在 TDZ）。
  /catch \(e\) \{[\s\S]{0,600}allowed: false, flagChecked: true, loading: false, gateError: true/.test(wallPageSrc) &&
    /gateError \? '墙面没能打开' : '祈福墙暂未开放'/.test(readSrc('miniprogram/subpackages/feature/wish-wall/index.wxml')) &&
    /bindtap="onGateRetry"/.test(readSrc('miniprogram/subpackages/feature/wish-wall/index.wxml')) &&
    /onGateRetry\(\) \{[\s\S]{0,400}?bootstrap\(\{ force: true \}\)/.test(wallPageSrc)
)

/* ------------------------------------------------------------------ *
 * 5) 超管工作台-内容模块：开关行 + 治理入口都在
 * ------------------------------------------------------------------ */

const subviews = readSrc('miniprogram/subpackages/manager/manager/workspace/_subviews.wxml')
check('内容开关面板出现「马上有祈福」行', /data-field="showMaShangYou"/.test(subviews))
check('面板内含祈福墙内容管理入口', /goWishWallManage/.test(subviews))
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
check('工作台有 tab 16「开关」磁贴（产品口径短名）', /data-idx="16"[\s\S]{0,400}<text>开关<\/text>/.test(hubWxml))
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
check(
  '★ 祈福墙页接住开关的 SWR 后台刷新',
  /fetchContentDisplayFlags\(\{[\s\S]{0,120}?\bonUpdate\s*:/.test(wallPageSrc)
)
check('祈福墙页门禁收敛收成 applyGate', /applyGate\(/.test(wallPageSrc))
check('祈福墙页下拉可强制重读开关（用户自救动作）', /bootstrap\(\{ force: true \}\)/.test(wallPageSrc))
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
  /check-cloud-functions-sync\.cjs" \$TARGETS --json/.test(deployScriptSrc)
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
globalThis.getCurrentPages = () => [{ route: 'subpackages/feature/wish-wall/index' }]

const eggConfig = loadCjs('miniprogram/config/easterEggs.js')
const egg = loadCjs('miniprogram/utils/easterEgg.js', {
  require: (id) => {
    if (id === '../config/easterEggs') return eggConfig
    throw new Error('unexpected require ' + id)
  }
})
const ritual = loadCjs('miniprogram/utils/wishRitual.js', { require: markerRequire })

// —— 注册表 ——
const jiliang = eggConfig.EGGS.find((e) => e.id === 'jiliang')
const bo = eggConfig.EGGS.find((e) => e.id === 'bo')
const WALL_ROUTE = 'subpackages/feature/wish-wall/index'
check('注册了「吉量」进页彩蛋', !!jiliang && jiliang.triggers[0].type === 'pageEnter')
check('吉量挂在祈福墙页面', !!jiliang && jiliang.triggers[0].pages.indexOf(WALL_ROUTE) !== -1)
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
const line = wish.pickDailyLine(ritual.LAMP_LINES, '2026-09-16')
eq('每日一句确定性（同一天两次一致）', wish.pickDailyLine(ritual.LAMP_LINES, '2026-09-16'), line)
check('每日一句取自灯语池', ritual.LAMP_LINES.indexOf(line) !== -1)
check(
  '★ 每日一句按天轮换（不是固定第一句）',
  new Set(
    Array.from({ length: 24 }, (_, i) => wish.pickDailyLine(ritual.LAMP_LINES, `2026-11-${String(i + 1).padStart(2, '0')}`))
  ).size >= 2
)
eq('日期键跨 UTC 边界按上海时区进位', wish.shanghaiDayKey(Date.UTC(2026, 8, 16, 16, 30)), '2026-09-17')
eq('日期键未越界不误进位', wish.shanghaiDayKey(Date.UTC(2026, 8, 16, 15, 30)), '2026-09-16')
eq('previousDayKey 跨月正确（2026 非闰年）', wish.previousDayKey('2026-03-01'), '2026-02-28')
eq('连续 3 天', wish.lampStreak(['2026-09-14', '2026-09-15', '2026-09-16'], '2026-09-16'), 3)
eq('断一天即中断', wish.lampStreak(['2026-09-14', '2026-09-16'], '2026-09-16'), 1)
eq('今日未点灯不算连续', wish.lampStreak(['2026-09-15'], '2026-09-16'), 0)

// —— 点灯本地状态 ——
const lit = ritual.lightLamp('2026-09-16')
eq('点灯成功', lit.lit, true)
eq('点灯幂等（重复点不覆盖首次时间）', ritual.lightLamp('2026-09-16').litAt, lit.litAt)
eq('点灯状态可读回', ritual.getLamp('2026-09-16').lit, true)
const manyDays = {}
for (let i = 0; i < 60; i += 1) {
  const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000)
  const pad = (n) => String(n).padStart(2, '0')
  manyDays[`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`] = { litAt: i }
}
const pruned = ritual.pruneDays(manyDays)
eq('点灯记录按 KEEP_DAYS 收敛（存储不是账本）', Object.keys(pruned).length, ritual.KEEP_DAYS)
check('收敛时保留最近的天（不是最早的）', !!pruned['2026-03-01'] && !pruned['2026-01-01'])

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
const wallJson = readSrc('miniprogram/subpackages/feature/wish-wall/index.json')
check('祈福墙页注册了彩蛋浮层组件', /easter-egg-note/.test(wallJson))
const wallWxml = readSrc('miniprogram/subpackages/feature/wish-wall/index.wxml')
check('祈福墙页放了彩蛋挂点', /id="easterEggNote"/.test(wallWxml))
check('祈福墙页有点灯仪式 UI', /bindtap="onLampTap"/.test(wallWxml))
check('祈福墙页有灵感入口', /bindtap="useInspiration"/.test(wallWxml))
check('祈福墙页挂了彩蛋 behavior', /behaviors: \[easterEggHost\]/.test(wallPageSrc))
check('进页彩蛋已接线', /easterEgg\.tryPageEnter\(/.test(wallPageSrc))
check('落愿彩蛋已接线', /easterEgg\.tryWishPosted\(/.test(wallPageSrc))
// 口径：作用域只能来自**入口**（路由参数），或门店码的 scene —— 绝不是写死的常量。
// 2026-09-18 门店码接入后，来源从 1 个变 2 个，判据跟着口径走（不是放宽：仍然禁止写死）
check(
  '作用域取自入口参数或门店码 scene（不是写死 mashangyou）',
  /normalizeProductKey\(opts\.productKey \|\| fromScene\.productKey\)/.test(wallPageSrc) &&
    /parseWishWallScene\(opts\.scene\)/.test(wallPageSrc)
)
check('点灯仪式已接线', /wishRitual\.lightLamp\(/.test(wallPageSrc))
check('页内所有请求都用 this.data.productKey', /action: 'list', productKey: this\.data\.productKey/.test(wallPageSrc))

/* ------------------------------------------------------------------ *
 * 4b) 重设计防线（2026-09-16：业务方判定原样式「灾难现场」）
 *
 * 原样的三类问题都是「不报错但用户看得见」，所以每条都要有守卫：
 *   ① .lamp 撞全局信号灯基类 → 点灯卡片被压成 12rpx 竖条、文案一字一行；
 *   ② 弹幕同轨固定 900ms 间隔 → 4 轨各叠 4 条；
 *   ③ 标题 {{productTitle}} · 祈福墙 与产品名里的「马上有」重复两遍。
 * ------------------------------------------------------------------ */

const wallWxss = readSrc('miniprogram/subpackages/feature/wish-wall/index.wxss')
eq(
  '★ 本页不得再定义 .lamp（撞 app.wxss 全局信号灯基类；注释里的说明不算）',
  (wallWxss.replace(/\/\*[\s\S]*?\*\//g, '').match(/^\.lamp[\s,{]/gm) || []).length,
  0
)
check('本页类名统一 ww- 前缀', /\.ww-page\b/.test(wallWxss) && /\.ww-wall\b/.test(wallWxss) && /\.ww-lantern\b/.test(wallWxss))
check('★ 点灯：光晕是灯座盒子的子元素（行内不再放绝对定位元素）', /<view class="ww-lantern-box"[^>]*>[\s\S]{0,220}ww-lantern-halo[\s\S]{0,220}ww-lantern-core/.test(wallWxml))
check('★ 灯座盒固定尺寸（撑不住就会把文案列挤成一字一行）', /\.ww-lantern-box\s*\{[^}]*width:\s*56rpx[^}]*height:\s*56rpx/.test(wallWxss))
check('★ 灯座盒 flex-shrink: 0', /\.ww-lantern-box\s*\{[^}]*flex-shrink:\s*0/.test(wallWxss))
check('★ 文案列 flex:1 + min-width:0', /\.ww-lantern-copy\s*\{[^}]*flex:\s*1[^}]*min-width:\s*0/.test(wallWxss))
check('★ 标题固定「祈福墙」，不与产品名重复', /<text class="ww-title">祈福墙<\/text>/.test(wallWxml))
const wallWxmlCode = wallWxml.replace(/<!--[\s\S]*?-->/g, '')
eq(
  '页面不再拼「· 祈福墙」（产品名自带「马上有」会重复；注释里的反例不算）',
  (wallWxmlCode.match(/\{\{productTitle\}\} · 祈福墙/g) || []).length,
  0
)
check('★ 弹幕只播一轮 + forwards（无限循环会让第二轮同轨再叠）', /animation-iteration-count:\s*1;/.test(wallWxss) && /animation-fill-mode:\s*forwards;/.test(wallWxss))
check('★ 墙面是浅底深字（弹幕可读）', /\.ww-danmaku\s*\{[^}]*color:\s*#4A4234/.test(wallWxss))
// 取 applyItems 的函数体：用**结构**定位，不用"多少字符以内"。
// 原写法是 `/applyItems[\s\S]{0,1200}?scheduleDanmakuCycle\(this\.data\.rows\)/` ——
// 窗口是魔数，函数里多写一行（2026-09-17 并行流程加"刚落愿高亮"）就会误报，
// 而它想证明的只是"applyItems 的数据路径确实调了排期"。结构定位既保意图又不脆。
const applyItemsBody = (() => {
  const start = wallPageSrc.indexOf('applyItems(list, inspiration) {')
  if (start === -1) return ''
  const end = wallPageSrc.indexOf('\n  },', start)
  return end === -1 ? wallPageSrc.slice(start) : wallPageSrc.slice(start, end)
})()
check(
  '★ 弹幕轮播已接线（排期函数存在 + applyItems 数据路径调用 + 轮次进 key）',
  /scheduleDanmakuCycle\(rows\)\s*\{/.test(wallPageSrc) &&
    /scheduleDanmakuCycle\(this\.data\.rows\)/.test(applyItemsBody) &&
    /danmakuCycle/.test(wallPageSrc)
)
check('轮次进 rows 的 key（同 key 不会重播动画）', /buildDanmakuRows\(items, \{ cycle: this\.data\.danmakuCycle \|\| 0 \}\)/.test(wallPageSrc))
check('切后台/卸载清掉轮播定时器', /onHide\(\)[\s\S]{0,120}clearDanmakuCycle/.test(wallPageSrc) && /onUnload\(\)[\s\S]{0,120}clearDanmakuCycle/.test(wallPageSrc))
check('轨道刻度与 topPercent 对齐（条数按 LANES 实算，不写死四条）', (wallWxss.match(/\.ww-wall-rail\.rail-\d/g) || []).length === wish.LANES)
check('★ 轨道刻度是左侧短刻度，不是整条横线（整条像表格线且压文字）', /\.ww-wall-rail\s*\{[^}]*width:\s*26rpx/.test(wallWxss) && !/\.ww-wall-rail\s*\{[^}]*right:\s*20rpx/.test(wallWxss))
check('入口箭头改为 CSS 折角（不再用字符 ›）', !/›/.test(entryWxml) && /\.wish-wall-entry-chevron\s*\{[^}]*border-right/.test(readSrc('miniprogram/components/WishWallEntry/index.wxss')))
// 2026-09-20：页头并入墙卡（产品要求「hero banner 应该与弹幕墙合并」）后，卡的总高改为**内容高度**
// （页头自适应），于是「固定高度」这条要求**下移到弹幕舞台本身**。
// ⚠️ 要求本身没有放宽：抖动风险来自弹幕行数/动画，而舞台高度仍是死的。
// 现在**同时钉两条**（舞台 336rpx = 原 380 − 页脚带 44，以及页脚带 44rpx）——比原来钉得更细。
check('弹幕舞台高度固定（布局不随弹幕内容抖动）：舞台 336rpx + 页脚带 44rpx',
  /\.ww-wall-inner\s*\{[^}]*height:\s*336rpx/.test(wallWxss) &&
  /\.ww-wall\s*\{[^}]*padding-bottom:\s*44rpx/.test(wallWxss),
  `舞台=${(/\.ww-wall-inner\s*\{[^}]*height:\s*(\d+rpx)/.exec(wallWxss) || [, '未声明'])[1]}`
  + ` / 页脚带=${(/\.ww-wall\s*\{[^}]*padding-bottom:\s*(\d+rpx)/.exec(wallWxss) || [, '未声明'])[1]}`)

/* ------------------------------------------------------------------ *
 * 4d) 对标全站（2026-09-16）：逐项对齐站点基线与同族页
 * ------------------------------------------------------------------ */

const wallWxssCode = stripCssComments(wallWxss)

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
check(
  '★ 页面底色用设计 token（本页曾是全仓唯一写 #14120F 的页面，json 却写 #1A1814）',
  /background:\s*var\(--color-bg\)/.test(wallWxssCode) && !/#14120F/.test(wallWxssCode)
)
check(
  '★ 开了下拉刷新就必须给 backgroundTextStyle: light（同族礼赠/钱包/礼券夹三页都有）',
  /"enablePullDownRefresh"\s*:\s*true/.test(wallJson) && /"backgroundTextStyle"\s*:\s*"light"/.test(wallJson)
)
check(
  '★ 加载中出骨架（全站约定是骨架而不是一行字；用全局 skeleton-shimmer）',
  /<block wx:if="\{\{loading\}\}">[\s\S]{0,400}?ww-wall-skel skel-1[\s\S]{0,400}?ww-wall-skel skel-4/.test(wallWxml) &&
    /class="ww-tag-skel"/.test(wallWxml) &&
    /animation:\s*skeleton-shimmer/.test(wallWxssCode)
)
check(
  '★ 黄铜色阶走 token（app.wxss 的 --brass-50..900，本页原来硬编码 7 个色值）',
  !/#(FAF6ED|E0CFA3|D4BC85|C4A76C|A8903C|8A7530|6B5A24)/.test(wallWxssCode) &&
    (wallWxssCode.match(/var\(--brass-\d+/g) || []).length >= 15
)
check(
  '★ 主按钮对齐全站黄铜配方（160deg / 48% / 描边 + 顶部内高光）',
  /linear-gradient\(160deg, var\(--brass-300\) 0%, var\(--brass-400\) 48%, var\(--brass-500\) 100%\)/.test(wallWxssCode) &&
    /inset 0 1rpx 0 rgba\(250, 246, 237, 0\.35\)/.test(wallWxssCode)
)
check(
  '★ 加载失败给「再试一次」（同族五页都有重试入口，本页原来只能碰运气下拉）',
  /bindtap="refresh"/.test(wallWxml) && /再试一次/.test(wallWxml)
)
{
  const skelAt = wallWxml.indexOf('class="ww-tag-skel"')
  const errAt = wallWxml.indexOf('class="ww-error" wx:elif="{{loadError}}"')
  const elseAt = errAt > -1 ? wallWxml.indexOf('<block wx:else>', errAt) : -1
  const emptyAt = wallWxml.indexOf('ww-tags-empty')
  check(
    '★ 失败时出错误块 + 重试，且不与「还没有人许愿」同屏（骨架 → 错误 → 列表/空态 三段互斥）',
    skelAt > -1 && errAt > skelAt && elseAt > errAt && emptyAt > elseAt,
    `skel=${skelAt} err=${errAt} else=${elseAt} empty=${emptyAt}`
  )
}
check(
  '★ 墙面在失败时改口径：不把「加载失败」谎报成「墙面还是空的」',
  /loadError \? '墙面未展开' : '墙面还是空的'/.test(wallWxml) &&
    /loadError \? '网络或权限异常，可在下方重试' : '做第一个许愿的人'/.test(wallWxml)
)

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
check(
  '★ 请求上限用同一常量（不再硬编码 30）',
  /limit:\s*LIST_LIMIT/.test(wallPageSrc) && !/limit:\s*30\b/.test(wallPageSrc)
)
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
  check(
    '★★ 页面手写体族名与加载器加载的族名逐字相同（不同 = 加载了也用不上，真机静默回落）',
    !!handFamily &&
      new RegExp(`\\.ww-danmaku\\s*\\{[^}]*font-family:\\s*'${handFamily}'`).test(wallWxssCode) &&
      new RegExp(`\\.ww-tag-text\\s*\\{[^}]*font-family:\\s*'${handFamily}'`).test(wallWxssCode),
    `FONT_FAMILY=${handFamily}`
  )
}
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
check('★ 弹幕挂色调类 + emoji 为**独立元素**（不改 text 长度 → 不影响匀速时长）',
  /ww-danmaku ww-tone-\{\{item\.tone\}\}/.test(wallWxmlCode)
  && /class="ww-emoji" wx:if="\{\{item\.emoji\}\}"/.test(wallWxmlCode))
check('★ 点灯爱心动效：一次性（heartBurst 为真才挂载 + js 定时收起）',
  /ww-hearts" wx:if="\{\{heartBurst\}\}"/.test(wallWxmlCode)
  && /setTimeout\(\(\) => this\.setData\(\{ heartBurst: false \}\)/.test(readFileSync(resolve(ROOT, 'miniprogram/subpackages/feature/wish-wall/index.js'), 'utf8'))
  && /@keyframes ww-heart-float/.test(wallWxssCode))
// 2026-09-19 点灯/木鱼图标替换（产品负责人提供 SVG）：微信 <image> 不渲染 SVG ✗
// → 走 base64 data-URI + background-image（矢量、随包、**无外链** → 不需要任何域名白名单 ✓）
{
  const uris = [...wallWxssCode.matchAll(/url\("(data:image\/svg\+xml;base64,[^"]+)"\)/g)].map((m) => m[1])
  check('★ 点灯与木鱼图标均已内联为 SVG data-URI', uris.length >= 2)
  check('★ 图标**不得**走外链（外链就要域名白名单，且 iOS 上有过坑）',
    !/url\("https?:/.test(wallWxssCode) || uris.length >= 2)
  // 图标原文件无 fill（默认黑）→ 深色页面上会看不见；守卫**解码**校验已注入品牌色
  const decoded = uris.map((u) => Buffer.from(u.split(',')[1], 'base64').toString('utf8'))
  check('★★ 内联 SVG 必须带 fill（否则深色墙面上是黑的，等于没显示）',
    decoded.every((d) => /fill="#[0-9A-Fa-f]{3,8}"/.test(d) || /fill="var\(/.test(d)),
    '原图标无 fill，必须注入品牌色')
  check('★ 替换后保留动效：木鱼敲击缩放 + 灯晕', /\.ww-muyu\.is-beat \{ transform: scale/.test(wallWxssCode) && /\.ww-lantern-halo/.test(wallWxssCode))
}
check('★ 弹幕用手写体（心愿是"写"上去的）',
  /\.ww-danmaku\s*\{[^}]*font-family:\s*('ShanhaiHand'|var\(--font-hand\)|"HanziPen SC")/.test(wallWxssCode))
check('★ 愿签正文也用手写体',
  /\.ww-tag-text\s*\{[^}]*font-family:\s*('ShanhaiHand'|var\(--font-hand\)|"HanziPen SC")/.test(wallWxssCode))
// 字号与 CHAR_RPX 是**一对**：CHAR_RPX 是同轨不重叠的宽度估算依据，
// 只改字号不改它 → 后一条会在前一条尾部还在屏内时进场（叠字）。判据按"字号 ×1.03 ≈ CHAR_RPX"实算，
// 既保住原来的下限（≥28rpx：手写体笔画细，移动中要认得出），又让两个数不再各自漂移。
const danmakuFontRpx = numOf((/\.ww-danmaku\s*\{[^}]*font-size:\s*([^;}]+)/.exec(wallWxssCode) || [])[1])
const charRpxConst = Number((/const CHAR_RPX = (\d+)/.exec(readSrc('miniprogram/utils/wishWall.js')) || [])[1])
check(
  '★ 弹幕字号 ≥ 28rpx（手写体笔画细，移动中要认得出）',
  danmakuFontRpx >= 28,
  `font-size=${danmakuFontRpx}rpx`
)
check(
  '★ 字号与 CHAR_RPX 同源（CHAR_RPX ≈ 字号 ×1.03，字距 0.02em）—— 只改一个就叠字',
  Math.abs(charRpxConst - Math.round(danmakuFontRpx * 1.03)) <= 1,
  `font=${danmakuFontRpx} CHAR_RPX=${charRpxConst} 期望≈${Math.round(danmakuFontRpx * 1.03)}`
)

// —— 结构 ——
check(
  '★ WXML 渲染 tagColumns（嵌套 wx:for，内层 wx:for-item="item" 防遮蔽）',
  /wx:for="\{\{tagColumns\}\}"[\s\S]{0,260}?wx:for="\{\{col\}\}"[\s\S]{0,140}?wx:for-item="item"/.test(wallWxml)
)
check('★ 页面把分列/上限交给纯函数（不埋在页面里）', /splitTagColumns\(items\)/.test(wallPageSrc) && /isTagListCapped\(items\.length\)/.test(wallPageSrc))
eq('★ 旧单列标记已清除（.ww-tag-main）', (wallWxssCode.match(/ww-tag-main/g) || []).length, 0)
check('★ 列表有明确收尾（原来 30 条一路滚下去没有终点）', /class="ww-end"/.test(wallWxml) && /已到墙底/.test(wallWxml))
check(
  '★ 打到上限时如实说「仅展示最近 N 条」，不装作全量',
  /tagCapped \? '已到墙底 · 仅展示最近 '/.test(wallWxml) && /'已到墙底 · 共 '/.test(wallWxml)
)
check('两列瀑布用 flex 列（不是 flex-wrap 行对齐）', /\.ww-tag-cols\s*\{[^}]*align-items:\s*flex-start/.test(wallWxssCode) && /\.ww-tag-col\s*\{[^}]*flex-direction:\s*column/.test(wallWxssCode))

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
  const detailsAt = detWxml.indexOf('DETAILS / 图文详情')
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
const wallWxml2 = readSrc('miniprogram/subpackages/feature/wish-wall/index.wxml')
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
check('三个灯位都有反馈句（否则升了级却无话可说）', [1, 2, 3].every((t) => !!ritual.LAMP_TIER_NOTES[t]))
check('四季都有节气灯语', ['spring', 'summer', 'autumn', 'winter'].every((s) => !!ritual.SOLAR_LINES[s]))

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
check('騊駼挂在祈福墙且门槛为 3 天', !!taotuEgg && taotuEgg.triggers[0].pages.indexOf(WALL_ROUTE) !== -1 && taotuEgg.triggers[0].minStreak === 3)
check('鹿蜀挂在祈福墙且门槛为 3 条', !!lushuEgg && lushuEgg.triggers[0].pages.indexOf(WALL_ROUTE) !== -1 && lushuEgg.triggers[0].minCount === 3)
check(
  '新彩蛋同样不挂支付/下单/退款路径',
  ['taotu', 'lushu'].every((id) => {
    const e = eggConfig.EGGS.find((x) => x.id === id)
    return (e.triggers || []).every((t) => (t.pages || []).every((p) => !/pay|order|checkout|refund/.test(p)))
  })
)
eq('图鉴收录 12 页（10 + 本期 2）', egg.listCatalog().length, 12)

// —— 页面接线：机制要在页面上真的被调用，否则等于没做 ——
check('灯位/节气收在 buildLampState 一处', /buildLampState\(/.test(wallPageSrc))
check('★ 节气灯语优先于通用灯语', /SOLAR_LINES\[solar\.season\]/.test(wallPageSrc))
check(
  '★ 距下一个节气已接线（否则 solarTermGap 只是测试里的死代码）',
  /solarTermGap\(dayKey\)/.test(wallPageSrc) && /ww-lantern-next/.test(wallWxml2)
)
check('★ 连续点灯彩蛋已接线', /tryLampStreak\(/.test(wallPageSrc))
check('★ 心愿数彩蛋已接线', /tryWishCount\(/.test(wallPageSrc))
check('我的心愿用 markMine 标记（而不是让公开列表回 openid）', /markMine\(this\._wallItems/.test(wallPageSrc))
check('两个视图共用 applyView（不各写一份渲染）', /applyView\(\)/.test(wallPageSrc))
check('我的心愿视图可切换且条目可点开', /switchView\(/.test(wallPageSrc) && /data-mode="mine"/.test(wallWxml2) && /bindtap="openWishCard"/.test(wallWxml2))
check(
  '心愿笺四件事齐备（开 / 关 / 抄一句 / 复制）',
  ['openWishCard', 'closeWishCard', 'borrowWishText', 'copyWishText'].every((m) => wallPageSrc.indexOf(m) !== -1)
)
check('分享标题取自心愿笺', /onShareAppMessage\(\)[\s\S]{0,320}?title: text/.test(wallPageSrc))
check('浮层防穿透的空处理器存在（catchtap 指向它）', /noop\(\)\s*\{\s*\}/.test(wallPageSrc))
check('★ 博物笔记入口把彩蛋进度显示出来', /goRelics\(\)/.test(wallPageSrc) && /getProgress\(\)/.test(wallPageSrc))

check('灯位/节气 UI 已上墙', /ww-lantern-tier/.test(wallWxml2) && /ww-lantern-solar/.test(wallWxml2))
check('灯位盏数按数组渲染（wx:for 传数字语义不一致）', /lampDots/.test(wallWxml2) && /lampDots/.test(wallPageSrc))
check('心愿笺浮层已上墙', /ww-card-mask/.test(wallWxml2) && /bindtap="borrowWishText"/.test(wallWxml2))
check('我的心愿 tab 已上墙', /data-mode="mine"/.test(wallWxml2))
check('博物笔记入口已上墙', /bindtap="goRelics"/.test(wallWxml2))
check('愿签可点开（bindtap + data-id）', /bindtap="openWishCard"/.test(wallWxml2) && /data-id="\{\{item\._id\}\}"/.test(wallWxml2))

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
{
  const wxss = readSrc('miniprogram/subpackages/feature/wish-wall/index.wxss')
  const wxml = readSrc('miniprogram/subpackages/feature/wish-wall/index.wxml')
  const js = wallPageSrc

  check(
    '★ 墙面可点：弹幕绑 openWishCard 且带 data-id（墙从"只读装饰"变成入口）',
    /<view[\s\S]{0,400}?class="ww-danmaku[\s\S]{0,400}?bindtap="openWishCard"[\s\S]{0,200}?data-id="\{\{item\.id\}\}"/.test(wxml)
  )
  check(
    '★ 墙上保留置顶标记（信任信号仍进墙面）',
    /class="ww-dm-mark \{\{item\.pinned/.test(wxml) && /\.ww-dm-mark\.is-pinned/.test(wxss)
  )
  check(
    '★ 「馆方」徽章已下线：卡片/弹层/墙面三处都不再渲染它（数据字段保留）',
    !/ww-tag-seal is-official/.test(wxml) &&
      !/class="ww-card-tag" wx:if="\{\{card\.official\}\}"/.test(wxml) &&
      !/is-official/.test(wxml) &&
      !/\.ww-tag-seal\.is-official\s*\{/.test(wxss) &&
      !/\.ww-dm-mark\.is-official\s*\{/.test(wxss) &&
      /official: !!raw\.official/.test(readSrc('miniprogram/utils/wishWall.js'))
  )
  check(
    '★ 去徽章没有误伤其它印记（已收起 / 置顶 仍在，且「我的」的信号以左边线形式保住）',
    // 2026-09-20 改造：「我的」章整条下线（真机 6 张里 5 张盖着它 = 噪音）。
    // 本条的**意图不变**：去任何一次徽章都不许把"哪条是我的"这个信息弄丢 ——
    // 只是它现在挂在卡片已有的左侧铜绳上（.ww-tag.is-mine::before），不再是一枚金色印章。
    /ww-tag-seal is-hidden"[^>]*>已收起/.test(wxml) &&
      /ww-tag-seal"[^>]*>置顶/.test(wxml) &&
      /ww-tag \{\{item\.isFresh \? 'is-fresh' : ''\}\} \{\{item\.isMine \? 'is-mine' : ''\}\}/.test(wxml) &&
      /\.ww-tag\.is-mine::before\s*\{[\s\S]{0,240}?var\(--brass-300\)/.test(wxss) &&
      !/ww-tag-seal is-mine/.test(wxml) &&
      !/\.ww-tag-seal\.is-mine\s*\{/.test(wxss) &&
      /ww-card-tag is-warn"[^>]*>已被馆方收起/.test(wxml)
  )
  check('墙面给了无障碍描述（读屏能说清这面墙是什么）', /aria-label="\{\{rows\.length \? rows\.length/.test(wxml))

  check(
    '★ 落愿闭环：提交成功后本地先落地（乐观插入 + 立刻重排弹幕 + 高亮）',
    /_wallItems = \[fresh\]\.concat/.test(js) &&
      /freshId: fresh\._id/.test(js) &&
      /buildDanmakuRows\(this\._wallItems/.test(js) &&
      /scheduleFreshClear\(\)/.test(js)
  )
  check('★ 高亮会自然消退（不是一直亮着）', /FRESH_HOLD_MS = \d+/.test(js) && /scheduleFreshClear\(\) \{[\s\S]{0,400}?setTimeout/.test(js))
  check('★ 高亮跨刷新续标（按 _id，回包不闪掉）', /isFresh: !!this\.data\.freshId && String\(row\._id/.test(js))
  check('切后台/卸载会清高亮定时器（不留悬挂定时器）', /onUnload\(\) \{[\s\S]{0,120}?clearFreshTimer/.test(js))

  check('★ 额度如实预告（今日还可写 N 条）', /ww-quota/.test(wxml) && /今日还可写/.test(wxml))
  check('★ 额度用完给明确出路（按钮转「明天再来」+ 拦截 + 服务端同句口径）', /明天再来/.test(wxml) && /quota\.exhausted/.test(js))
  check('额度预检用的是服务端文案形状（不是自造一句）', /今天已许愿 \$\{this\.data\.quota\.cap\} 次，明天再来/.test(js))

  check(
    '★ 两个视图改成分段控件（此前像两个标题，切换意图不明显）',
    /class="ww-seg"/.test(wxml) && (wxml.match(/ww-seg-item/g) || []).length >= 2 && /\.ww-seg-item\.is-on/.test(wxss)
  )
  check('分段控件有选中态语义', /aria-role="tab"/.test(wxml) && /aria-selected=/.test(wxml))
  check('旧的标题式 tab 样式已清干净（不留死样式）', !/\.ww-head-label/.test(wxss))

  // 只验 WXSS 有样式是不够的：样式必须在愿签上真的被挂出来（首轮注入没检出正是这个空洞）
  check(
    '★ 愿签高亮有动效且真挂在愿签上（落愿看得见）',
    /\.ww-tag\.is-fresh/.test(wxss) &&
      /@keyframes ww-fresh-in/.test(wxss) &&
      /class="ww-tag \{\{item\.isFresh \? 'is-fresh' : ''\}\} \{\{item\.isMine \? 'is-mine' : ''\}\}"/.test(wxml)
  )
  check('选中态的分段控件仍走黄铜 token', /var\(--brass-300\) 0%, var\(--brass-400\) 48%, var\(--brass-500\) 100%/.test(wxss))
  check(
    '笺纸材料层不盖内容（绝对定位的材料必须让内容显式抬层）',
    /\.ww-card-over,[\s\S]{0,80}?\.ww-card-acts \{[\s\S]{0,80}?z-index: 1/.test(wxss) && /\.ww-card-fiber/.test(wxss)
  )
  // 口径升级：**两个弹层各自**都要有对话框语义（原来只要求"页面里出现过一次"，
  // 于是删掉其中一个也测不出来 —— 自检抓到的空判据）
  check(
    '心愿笺与纸签弹层各自都有对话框语义（读屏要知道这是弹层）',
    /class="ww-card[\s\S]{0,300}?aria-role="dialog"/.test(wxml) &&
      /class="ww-sheet"[\s\S]{0,400}?aria-role="dialog"/.test(wxml)
  )
}

// ---- 行为级：驱动真实页面 JS（乐观落地 + 额度拦截 + 高亮续标） ----
{
  const wxStub = installWxStub()
  const pageProto = loadPageConfig('miniprogram/subpackages/feature/wish-wall/index.js')
  const makePage = (over) => {
    const data = Object.assign({
      allowed: true, posting: false, draft: '马上有光', textMax: 30, productKey: 'k', productId: 'p',
      viewMode: 'wall', danmakuCycle: 0, quota: { used: 0, left: 5, cap: 5, exhausted: false },
      freshId: '', mine: { total: 0, visible: 0, hidden: 0 }, mineRows: [], loadError: ''
    }, over || {})
    const calls = []
    const page = Object.assign(Object.create(null), pageProto)
    page.data = data
    page.setData = function (patch) { Object.assign(this.data, patch) }
    page.callFn = (payload) => { calls.push(payload); return Promise.resolve({ success: true, _id: 'new1', nickname: '我', msg: '心愿已挂上墙' }) }
    page.refresh = () => Promise.resolve()
    page.fireWishEgg = () => {}
    page.recordRelics = () => {}
    page.scheduleDanmakuCycle = () => {}
    page.clearDanmakuCycle = () => {}
    page.clearFreshTimer = () => {}
    // 注册门禁：harness 里真实 userSession 的 ensureSession 不会 settle，
    // 必须像 refresh/fireWishEgg 一样桩掉（否则 submitWish 永远不返回 → unsettled await）
    page.isGuestUser = () => Promise.resolve(false)
    page._wallItems = []
    page.calls = calls
    return page
  }
  const posted = makePage()
  await posted.submitWish()
  eq('★ 点「挂上墙」后新愿签立刻在列表首位（不必等刷新）', (posted._wallItems[0] || {})._id, 'new1')
  eq('★ 新高亮 id 已记下', posted.data.freshId, 'new1')
  eq('落愿后弹幕立刻接住这条', posted.data.rows.some((r) => r.id === 'new1'), true)
  eq('落愿后额度即时递减', posted.data.quota.left, 4)
  eq('落愿后输入框清空', posted.data.draft, '')

  const blocked = makePage({ quota: { used: 5, left: 0, cap: 5, exhausted: true } })
  const toastBefore = wxStub.toasts.length
  await blocked.submitWish()
  eq('★ 额度用完不再打云函数（不让人白写）', blocked.calls.length, 0)
  eq('额度用完不清空草稿（用户写的内容不能丢）', blocked.data.draft, '马上有光')
  check(
    '★ 额度拦截用的是服务端同一句口径（说清几条 / 何时能再来）',
    wxStub.toasts.slice(toastBefore).some((t) => t === '今天已许愿 5 次，明天再来'),
    JSON.stringify(wxStub.toasts.slice(toastBefore))
  )

  const rich = makePage({ viewMode: 'mine', freshId: 'new1' })
  rich._mineRows = [{ _id: 'new1', text: 'x' }, { _id: 'old', text: 'y' }]
  rich.applyView()
  eq('★ 切到「我的心愿」时高亮仍按 _id 续上', rich.data.items[0].isFresh, true)
  eq('其它愿签不受高亮影响', rich.data.items[1].isFresh, false)

  // 高亮到点会自己褪掉（用不到 4s 的等待：直接把常量换成本地计时器验证行为）
  const fading = makePage({ freshId: 'new1' })
  fading._wallItems = [{ _id: 'new1', text: 'x', isFresh: true }]
  eq('褪色前列表里是高亮的', (fading.applyView(), fading.data.items[0].isFresh), true)
  wxStub.restore()
}

// ---- 行为级：注册转化（未注册 → 落愿时弹注册 → 注册成功自动续发）----
// 产品口径：浏览与仪式免费，**落愿才要身份**。这一条链路断在哪一环，转化就断在哪一环。
{
  const wxStub = installWxStub()
  const proto = loadPageConfig('miniprogram/subpackages/feature/wish-wall/index.js')
  const mkPage = (opts) => {
    const o = opts || {}
    const data = Object.assign({
      allowed: true, posting: false, draft: '马上有光', textMax: 30, productKey: 'k', productId: 'p',
      viewMode: 'wall', danmakuCycle: 0, quota: { used: 0, left: 5, cap: 5, exhausted: false },
      freshId: '', mine: { total: 0, visible: 0, hidden: 0 }, mineRows: [], loadError: '',
      showRegisterDialog: false
    }, o.data || {})
    const calls = []
    const page = Object.assign(Object.create(null), proto)
    page.data = data
    page.setData = function (patch) { Object.assign(this.data, patch) }
    page.callFn = (payload) => { calls.push(payload); return Promise.resolve({ success: true, _id: 'new1', nickname: '我', msg: '心愿已挂上墙' }) }
    page.refresh = () => Promise.resolve()
    page.fireWishEgg = () => {}
    page.recordRelics = () => {}
    page.scheduleDanmakuCycle = () => {}
    page.clearDanmakuCycle = () => {}
    page.clearFreshTimer = () => {}
    page.isGuestUser = () => Promise.resolve(o.guest !== false)
    page._wallItems = []
    page.calls = calls
    return page
  }

  const guest = mkPage()
  await guest.submitWish()
  eq('★ 未注册：落愿**不发请求**，改为就地弹注册', guest.calls.length, 0)
  eq('未注册：弹窗被打开', guest.data.showRegisterDialog, true)
  eq('未注册：待发的心愿被记住（注册成功后要续发）', guest._pendingWish, '马上有光')
  eq('未注册：草稿仍在输入框（不制造白写）', guest.data.draft, '马上有光')

  await guest.onRegisterSuccess()
  eq('★ 注册成功自动续发（用户的心愿没丢）', guest.calls.length, 1)
  eq('续发的正是那条心愿', guest.calls[0] && guest.calls[0].text, '马上有光')
  eq('续发后弹窗已关闭', guest.data.showRegisterDialog, false)
  eq('★ 续发不再二次弹窗（会话未刷新也不会死循环）', guest.data.showRegisterDialog, false)

  const dismissed = mkPage()
  await dismissed.submitWish()
  dismissed.onRegisterDialogClose()
  eq('「先不挂」：弹窗关闭', dismissed.data.showRegisterDialog, false)
  eq('★「先不挂」：草稿保留（回来还能接着挂）', dismissed.data.draft, '马上有光')
  eq('「先不挂」不再发请求', dismissed.calls.length, 0)

  const registered = mkPage({ guest: false })
  await registered.submitWish()
  eq('已注册用户直接落愿（不打扰）', registered.calls.length, 1)
  eq('已注册用户不弹注册', registered.data.showRegisterDialog, false)
  wxStub.restore()
}

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
  '★ 落愿时对未注册用户弹注册（门禁在提交，不在进页）',
  /submitWish\(\)[\s\S]{0,1600}?isGuestUser\(\)/.test(wallPageSrc) && /showRegisterDialog: true/.test(wallPageSrc)
)
check('★ 未注册判定按会话态（不是写死）', /return state === 'guest'/.test(wallPageSrc))
check(
  '★ 注册成功后自动续发那条心愿（意图不丢）',
  /onRegisterSuccess\(\)[\s\S]{0,800}?this\.submitWish\(\)/.test(wallPageSrc)
)
check(
  '★ 会话读失败 fail-open（宁少一次曝光，不废核心动作）',
  /isGuestUser\(\)\s*\{[\s\S]{0,700}?catch \(e\) \{[\s\S]{0,320}?return false/.test(wallPageSrc)
)
check(
  '关掉弹窗只丢待发、草稿保留（不制造白写的挫败）',
  /onRegisterDialogClose\(\)[\s\S]{0,340}?_pendingWish = ''/.test(wallPageSrc) &&
    !/onRegisterDialogClose\(\)[\s\S]{0,340}?draft: ''/.test(wallPageSrc)
)
check('弹窗可关（不把用户困在弹窗里）', /closable="\{\{true\}\}"/.test(wallWxml2))
check(
  '弹窗复用既有 RegisterAuthDialog（不另造一套注册流程）',
  /register-auth-dialog/.test(wallWxml2) &&
    /register-auth-dialog/.test(readSrc('miniprogram/subpackages/feature/wish-wall/index.json'))
)
check(
  '转化漏斗三步都埋了（曝光 / 先不挂 / 注册完成并续发）',
  ["step: 'show'", "step: 'dismiss'", "step: 'resume_success'"].every((s) => wallPageSrc.indexOf(s) !== -1)
)
check(
  '★ 漏斗在 ERP 报表侧有登记（否则"埋了但报表看不到"）',
  /wish_wall_register_gate/.test(readSrc('admin/src/utils/analyticsSchema.js')) &&
    /wish_wall_register_gate:dismiss/.test(readSrc('admin/src/utils/analyticsSchema.js')) &&
    /wish_wall_register_gate:resume_success/.test(readSrc('admin/src/utils/analyticsSchema.js'))
)

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
const wallGradient = (/\.ww-wall\s*\{[^}]*linear-gradient\([^)]*?((?:#[0-9A-Fa-f]{6}[^)]*)+)\)/.exec(wallWxssCode) || [])[1] || ''
const wallBg = Array.from(wallGradient.matchAll(/#[0-9A-Fa-f]{6}/g)).map((m) => m[0])
check('能读到墙面的渐变底色（判据的输入必须真实存在）', wallBg.length >= 2, wallBg.join(','))

const toneColors = []
for (let i = 0; i < 6; i += 1) {
  const m = new RegExp(`\\.ww-tone-${i}\\s*\\{\\s*color:\\s*(#[0-9A-Fa-f]{6})`).exec(wallWxssCode)
  if (m) toneColors.push(m[1])
}
eq('弹幕 6 档配色都在（档数与 utils 一致）', toneColors.length, 6)
check('弹幕档数与 DANMAKU_TONES 同源', new RegExp(`DANMAKU_TONES = ${toneColors.length}`).test(readSrc('miniprogram/utils/wishWall.js')))

const worstTone = toneColors.reduce((acc, tone) => {
  const min = wallBg.reduce((a, bg) => Math.min(a, contrast(tone, bg)), Infinity)
  return min < acc.min ? { tone, min } : acc
}, { tone: '', min: Infinity })
check(
  `★ 弹幕每一档都对墙面达 AA（最差 ${worstTone.tone} = ${worstTone.min.toFixed(2)}:1，需 ≥ ${AA_TEXT}）`,
  worstTone.min >= AA_TEXT,
  toneColors.map((t) => `${t}=${Math.min(...wallBg.map((b) => contrast(t, b))).toFixed(2)}`).join(' ')
)

// —— 仪式两卡：严格等宽 + 等高 + 顶对齐 ——
check(
  '★ 仪式两卡严格等宽（grid 1fr 1fr，而不是按内容分配的 flex）',
  /\.ww-ritual-row\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*1fr\s+1fr/.test(wallWxssCode)
)
check(
  '★ 灯卡没有 margin-bottom（留着它两卡永远不等高）',
  /\.ww-lantern\s*\{[^}]*\}/.test(wallWxssCode) &&
    !/\.ww-lantern\s*\{[^}]*margin-bottom/.test(wallWxssCode)
)
// ⚠️ 判据修正（2026-09-18 真图复核）：上一版断言"两卡都 flex-start、基线同高"是**我的推断**，
// 真机截图否掉了它 —— 木鱼卡只有两行，等高之后顶对齐会在底部留一大片空白。
// 正确口径：两卡**内边距一致**（这是"像一对"的来源）；灯卡顶对齐（内容三行、填满），
// 木鱼卡垂直居中（内容短，顶对齐就空）。断言按这个口径写，不是放宽而是改对。
// 判据改成**从 WXSS 里读出来比**，而不是钉死 "22rpx 20rpx"：钉死字面量时，
// 同一轮改两处（灯卡 + 木鱼卡）只要漏一处就红，改对了也要改断言 —— 判据应该只表达"两者相同"。
const cardPad = (selector) => {
  const m = new RegExp(`\\${selector}\\s*\\{[^}]*padding:\\s*([^;]+);`).exec(wallWxssCode)
  return m ? m[1].replace(/\s+/g, ' ').trim() : ''
}
const lanternPad = cardPad('.ww-lantern')
const muyuPad = cardPad('.ww-ritual-card')
check(
  '两卡内边距一致（这是"像一对"的真正来源）',
  /^\d+rpx \d+rpx$/.test(lanternPad) && lanternPad === muyuPad,
  `灯卡=${lanternPad || '(读不到)'} 木鱼卡=${muyuPad || '(读不到)'}`
)
check(
  '★ 灯卡顶对齐（内容三行，填满卡片）',
  /\.ww-lantern\s*\{[^}]*align-items:\s*flex-start/.test(wallWxssCode)
)
check(
  '★ 木鱼卡垂直居中（只有两行，顶对齐会在底部留大片空白 —— 真图证据）',
  /\.ww-ritual-card\s*\{[^}]*align-items:\s*center/.test(wallWxssCode)
)
// —— 灯语文案：整行排版 + 纵向节奏 + 文案池长度上限 ——
// 起因（2026-09-18 真机截图，产品反馈「文案过于拥挤」）：灯语原来留在 ~220rpx 的文案列里，
// 「灯亮着，就还有没说完的心愿。」第二行只剩 3 个字（"的心愿。"孤字），徽章/正文/说明三行小字挤在一起。
const idxCopy = wallWxml2.indexOf('class="ww-lantern-copy"')
const idxStreak = wallWxml2.indexOf('class="ww-streak"')
const idxTail = wallWxml2.indexOf('class="ww-lantern-tail"')
const idxTailLine = wallWxml2.indexOf('class="ww-lantern-line"', idxTail)
check(
  '★ 灯语/灯位说明**整行**落在标题块下面（不再跟标题抢窄列，孤字消失）',
  idxCopy > -1 && idxStreak > idxCopy && idxTail > idxStreak && idxTailLine > idxTail &&
    /\.ww-lantern-tail\s*\{[^}]*flex:\s*0\s+0\s+100%/.test(wallWxssCode) &&
    /\.ww-lantern\s*\{[^}]*flex-wrap:\s*wrap/.test(wallWxssCode)
)

// 判据是"关系"而不是字面值：字号层级（标题 > 灯语 > 灯位说明）+ 段间距/行距下限
const numIn = (sel, prop) => {
  const m = new RegExp(`\\${sel}\\s*\\{[^}]*${prop}:\\s*([^;}]+)`).exec(wallWxssCode)
  return numOf(m && m[1])
}
const metaGap = numIn('.ww-lantern-meta', 'margin-top')
const noteGap = numIn('.ww-lantern-note', 'margin-top')
const lineLH = numIn('.ww-lantern-line', 'line-height')
const lineFS = numIn('.ww-lantern-line', 'font-size')
const noteFS = numIn('.ww-lantern-note', 'font-size')
const titleFS = numIn('.ww-lantern-title', 'font-size')
check(
  '★ 灯卡纵向节奏：徽章距标题 ≥12rpx、灯语行距 ≥1.6、灯位说明距灯语 ≥8rpx',
  metaGap >= 12 && lineLH >= 1.6 && noteGap >= 8
)
check(
  '★ 三级字号层级不倒挂（标题 > 灯语 > 灯位说明）',
  titleFS > lineFS && lineFS > noteFS
)

// 文案池长度上限**实算**：整行可用宽 = 750 − 2×页面左右 padding − 2×卡片左右 padding，
// 除以灯语字号得到"一行几字"，再留 1 字余量。改字号/内边距时判据跟着走，不用手改数字。
const pagePadX = Number((/--space-4:\s*(\d+)rpx/.exec(readSrc('miniprogram/app.wxss')) || [])[1])
const cardPadX = Number((lanternPad.split(' ')[1] || '').replace('rpx', ''))
const cardW = (750 - 2 * pagePadX - 16) / 2
const rowW = cardW - 2 * cardPadX
const maxChars = Math.floor(rowW / lineFS) - 1
const idleText = (/<text class="ww-lantern-line is-idle"[^>]*>([^<]+)<\/text>/.exec(wallWxml2) || [])[1] || ''
check(
  '能算出一行几字（判据的输入必须真实存在）',
  pagePadX > 0 && cardPadX > 0 && lineFS > 0 && maxChars >= 8 && idleText.length > 0,
  `pagePadX=${pagePadX} cardPadX=${cardPadX} lineFS=${lineFS} rowW=${rowW} maxChars=${maxChars} idle="${idleText}"`
)
const longLines = [
  ...ritual.LAMP_LINES,
  ...Object.values(ritual.SOLAR_LINES),
  ...Object.values(ritual.LAMP_TIER_NOTES),
  idleText
].filter((s) => [...s].length > maxChars)
check(
  `★ 灯语池每条都装得进一行（上限 ${maxChars} 字，含标点）`,
  longLines.length === 0,
  longLines.map((s) => `${s}(${[...s].length})`).join(' / ')
)

check(
  '★ 徽章独立成行且允许折行（不再把「今日灯已点」挤成两行）',
  /\.ww-lantern-meta\s*\{[^}]*flex-wrap:\s*wrap/.test(wallWxssCode) &&
    /class="ww-lantern-meta"/.test(wallWxml2)
)
check(
  '灯位/节气徽章挂在 meta 行里（不是挂在标题那一行）',
  /ww-lantern-meta[\s\S]{0,400}?ww-lantern-tier[\s\S]{0,300}?ww-lantern-(solar|next)/.test(wallWxml2)
)
check(
  '灯卡不再用旧的单行 head（避免死结构复活）',
  !/class="ww-lantern-head"/.test(wallWxml2)
)
check(
  '连续天数盒子收窄（半宽卡里它是固定宽度的一份子）',
  /\.ww-streak\s*\{[^}]*min-width:\s*48rpx/.test(wallWxssCode)
)
check(
  '★ 条数挂在**所属段**内，且「墙上的愿签」条数与当前视图无关（2026-09-20 修串台）',
  // 原来的判据只要求"条数挂在 wall 段里"，用的却是 `items.length` —— 而 `items` 会被
  // applyView 换成当前视图的数据源，于是切到「我的心愿」后**两段显示同一个数**。
  // 根因是共用一个字段，不是挂错了位置。现在用 `wallCount`，并额外钉住"只有 applyItems 写它"。
  /data-mode="wall"[\s\S]{0,700}?ww-seg-n[\s\S]{0,200}?wallCount/.test(wallWxml2) &&
    !/ww-head-n/.test(wallWxml2) &&
    // 初值 + applyItems + 落愿乐观插入 = 恰好三处；applyView **不许**碰它（碰了就又是串台）
    (wallPageSrc.match(/wallCount:/g) || []).length === 3 &&
    /wallCount: items\.length/.test(wallPageSrc) &&
    /wallCount: this\._wallItems\.length/.test(wallPageSrc) &&
    !/applyView\(\) \{[\s\S]{0,600}?wallCount:/.test(wallPageSrc)
)
check(
  '段外游离条数移除后不留死样式（.ww-head-n / .ww-head-rule）',
  !/\.ww-head-n\s*\{/.test(wallWxssCode) && !/\.ww-head-rule\s*\{/.test(wallWxssCode)
)

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
const FS_NON_TOKEN_OK = { 19: 4, 21: 2, 25: 1, 42: 1 }
const fsDecls = [...wallWxssCode.matchAll(/font-size:\s*([^;}]+)/g)].map((m) => m[1].trim())
const fsTokens = fsDecls.filter((v) => /^var\(--fs-\d+\)$/.test(v))
const fsLiterals = fsDecls.filter((v) => /^[\d.]+rpx$/.test(v)).map((v) => Number.parseFloat(v))
const fsOther = fsDecls.filter((v) => !/^var\(--fs-\d+\)$/.test(v) && !/^[\d.]+rpx$/.test(v))
// ①-a 写法退化：**在册值**（= --fs-* 的 14 个值）一律不许再写裸字面量 —— 本页已全部令牌化
const fsOnScaleLiteral = fsLiterals.filter((v) => RPX_TOKENS[`fs-${v}`] !== undefined)
check(
  '★ 本页在册字号一律走 --fs-* 令牌（30rpx 这类在册值不得再写回裸字面量）',
  fsOnScaleLiteral.length === 0 && fsOther.length === 0 && fsTokens.length >= 60,
  `令牌 ${fsTokens.length} 处 / 写回裸值的在册值 ${JSON.stringify(fsOnScaleLiteral)} / 其它写法 ${JSON.stringify(fsOther.slice(0, 3))}`
)
// ①-b 非令牌值：按**白名单 + 处数**判（提案 D1/D2 —— 不按出现次数判，否则 3~9 次的噪声会静默逃逸）
const fsOffScale = fsLiterals.filter((v) => RPX_TOKENS[`fs-${v}`] === undefined)
const fsTally = {}
fsOffScale.forEach((v) => { fsTally[v] = (fsTally[v] || 0) + 1 })
check(
  '★ 非令牌字号逐值登记且处数只许减（19×4 / 21×2 / 25×1 / 42×1）',
  JSON.stringify(fsTally) === JSON.stringify(FS_NON_TOKEN_OK),
  `非令牌实测 ${JSON.stringify(fsTally)} / 登记 ${JSON.stringify(FS_NON_TOKEN_OK)}`
)

// —— ② 间距：与 --space-* 同值的分量必须写令牌（同值判据，不改版式）——
const SPACE_TOKEN_RPX = new Set([8, 16, 24, 32, 40, 48, 64])
const spaceDeclRe = /(?:^|[;{\s])((?:padding|margin)(?:-(?:top|right|bottom|left))?|gap|row-gap|column-gap):\s*([^;}]+)/g
const spaceNoise = []
for (const m of wallWxssCode.matchAll(spaceDeclRe)) {
  if (/calc\(/.test(m[2])) continue // calc 里的分量不是间距节奏，跳过（本页 .ww-page 的 72rpx 就在这里）
  for (const part of m[2].trim().split(/\s+/)) {
    const lit = /^-?(\d+)rpx$/.exec(part)
    if (lit && SPACE_TOKEN_RPX.has(Number(lit[1]))) spaceNoise.push(`${m[1]}: ${m[2].trim()}`)
  }
}
check(
  '★ 与 --space-* 同值的间距一律写成令牌（同值替换，不改版式；防"随手 24rpx"长回来）',
  spaceNoise.length === 0,
  spaceNoise.slice(0, 4).join(' / ')
)

// —— ③ 按压反馈一致性 ——
const pressOpacity = (sel) => {
  const m = new RegExp(`\\${sel}\\s*\\{[^}]*opacity:\\s*([\\d.]+)`).exec(wallWxssCode)
  return m ? Number(m[1]) : NaN
}
const lanternPress = pressOpacity('.ww-lantern-press')
const muyuPress = pressOpacity('.ww-muyu-press')
check(
  '★ 灯卡与木鱼卡按压反馈同值（两卡是显式定义的"一对"，内边距已被上一条守卫钉住）',
  Number.isFinite(lanternPress) && lanternPress === muyuPress,
  `灯卡=${lanternPress} 木鱼卡=${muyuPress}`
)
const playPress = pressOpacity('.ww-play-press')
const playNeedPress = pressOpacity('.ww-play-need-press')
check(
  '★ 玩法瓦片与"去补资料"行按压反馈同值（同在玩法区、同族可点面）',
  Number.isFinite(playPress) && playPress === playNeedPress,
  `玩法瓦片=${playPress} 补资料行=${playNeedPress}`
)
const hoverClasses = [...new Set([...wallWxml2.matchAll(/hover-class="([^"{}]+)"/g)].map((m) => m[1]))]
const hoverMissing = hoverClasses.filter((c) => !new RegExp(`\\.${c}\\s*[,{]`).test(wallWxssCode))
check(
  '★ 每个 hover-class 都有同名规则（类名写错 = 点了没反馈，且 WXSS 不报错）',
  hoverClasses.length >= 15 && hoverMissing.length === 0,
  `引用 ${hoverClasses.length} 个 / 无规则: ${hoverMissing.join(',') || '无'}`
)
const stayTimes = [...wallWxml2.matchAll(/hover-stay-time="(\d+)"/g)].map((m) => Number(m[1]))
check(
  '★ 页面内 hover-stay-time 统一为 70ms（原 70/80/60 三种混用）',
  stayTimes.length >= 15 && new Set(stayTimes).size === 1 && stayTimes[0] === 70,
  `取值=${JSON.stringify([...new Set(stayTimes)])} / 处数=${stayTimes.length}`
)

// —— ④ 无障碍：可点元素必须有 role；装饰圆点必须 aria-hidden ——
const wxmlTagsAll = wallWxml2.match(/<[a-zA-Z-]+[^>]*>/g) || []
const tapTags = wxmlTagsAll.filter((t) => /bindtap\s*=/.test(t))
const tapNoRole = tapTags.filter((t) => !/aria-role\s*=/.test(t))
check(
  '★ 每个可点元素（bindtap）都有 aria-role（否则读屏只念文字、不说"这是按钮"）',
  tapTags.length >= 15 && tapNoRole.length === 0,
  `可点 ${tapTags.length} 个 / 缺 role: ${tapNoRole.map((t) => t.replace(/\s+/g, ' ').slice(0, 60)).join(' | ') || '无'}`
)
const lightTags = wxmlTagsAll.filter((t) => /class="signal-light/.test(t))
const lightNoHidden = lightTags.filter((t) => !/aria-hidden="true"/.test(t))
check(
  '★ 装饰性信号灯一律 aria-hidden（纯色圆点、零文本，读屏不该念它）',
  lightTags.length >= 5 && lightNoHidden.length === 0,
  `信号灯 ${lightTags.length} 个 / 未隐藏: ${lightNoHidden.length} 个`
)
// 反向：aria-hidden **不许盖住文案**。
// 起因（本批自查发现）：给 `.ww-sheet-product-go`（"看看这件 ›"）顺手加了 aria-hidden —— 它是 CTA 文案，
// 一隐藏就等于对读屏用户砍掉了"抽一句 → 看藏品"这条主路的出口。装饰与文案的边界必须由判据兜住。
const hiddenInlineText = [...wallWxml2.matchAll(/aria-hidden="true"[^>]*>([^<]+)</g)]
  .map((m) => m[1].trim())
  .filter(Boolean)
const hiddenCjk = hiddenInlineText.filter((t) => /[\u4e00-\u9fa5]/.test(t))
check(
  '★ aria-hidden 不许盖住中文文案（装饰才可隐藏；"看看这件"这类 CTA 不是装饰）',
  hiddenCjk.length === 0,
  `被隐藏的带字元素: ${JSON.stringify(hiddenCjk)}`
)

// —— ⑤ 死选择器 / 重复声明 ——
check(
  '★ 本页不留死选择器 .ww-wall-loading（wxss 有定义、wxml/js 零引用）',
  !/\.ww-wall-loading\b/.test(wallWxssCode) && !/ww-wall-loading/.test(wallWxml2)
)
check(
  '★ .ww-wall 的描边/阴影只声明一处（同选择器后者静默吃掉前者 —— 合并前 base 的 border/box-shadow 是死声明）',
  (wallWxssCode.match(/\.ww-wall\s*\{/g) || []).length === 1,
  `\.ww-wall{ 块数=${(wallWxssCode.match(/\.ww-wall\s*\{/g) || []).length}`
)

// —— ⑥ 愿签卡 / 骨架的底面一致（换卡那一帧不许跳色）——
const surfaceGradient = (sel) => {
  const m = new RegExp(`\\${sel}\\s*\\{[^}]*background:\\s*(linear-gradient\\([^;]+);`).exec(wallWxssCode)
  return m ? m[1].replace(/\s+/g, '') : ''
}
const tagSurface = surfaceGradient('.ww-tag')
const tagSkelSurface = surfaceGradient('.ww-tag-skel')
check(
  '★ 愿签骨架与愿签卡同底同渐变（骨架被真卡替换时不许跳色）',
  tagSurface.length > 0 && tagSurface === tagSkelSurface,
  `真卡=${tagSurface} 骨架=${tagSkelSurface}`
)
// —— 灯芯图标（2026-09-18 产品指定：用附件里的灯泡 SVG）——
// data URI 的两种 encoding 都算数（percent-encoded / ;base64），只要它是**内联矢量图**：
// 微信 <image> 不渲染 svg 文件、本仓也零先例，所以「是 data URI」才是关键判据。
const lampCoreRuleBlocks = (wallWxssCode.match(/\.ww-lantern-core\s*\{[^}]*\}/g) || [])
const lampCoreWithImage = lampCoreRuleBlocks.filter((b) => /background-image:\s*url\("data:image\/svg\+xml[,;]/.test(b))
check(
  '★ 灯芯是灯泡 SVG（WXSS data URI，与本仓既有惯例一致）',
  lampCoreWithImage.length >= 1
)
check(
  '★ 灯芯图的声明只有一处（同一选择器两份 background-image → 后一份静默吃掉前一份）',
  lampCoreWithImage.length === 1
)
check(
  '★ 不新增 svg 资源文件、也不用 <image src="*.svg">（本仓零先例）',
  !/<image[^>]+src="[^"]*\.svg"/.test(wallWxml2) && !/\.svg"/.test(wallWxssCode)
)
check(
  '灯芯不再是实心圆（换了图标就别留着圆底，否则灯泡背后有个圆）',
  !/\.ww-lantern-core\s*\{[^}]*border-radius:\s*50%/.test(wallWxssCode) &&
    !/\.ww-lantern-core\s*\{[^}]*background:\s*#2A2723/.test(wallWxssCode)
)
check(
  '★ 两态共用一张图：未点亮靠 opacity 调暗，点亮回全亮（不搞两张图）',
  /\.ww-lantern-core\s*\{[^}]*opacity:\s*0\.38/.test(wallWxssCode) &&
    /\.ww-lantern\.is-lit\s+\.ww-lantern-core\s*\{[^}]*opacity:\s*1/.test(wallWxssCode)
)
check(
  '点亮态不再用 box-shadow（方盒阴影会在灯泡背后露方角）',
  !/\.ww-lantern\.is-lit\s+\.ww-lantern-core\s*\{[^}]*box-shadow/.test(wallWxssCode)
)

/* ================================================================== *
 * 即时反馈层（需求 28 · 玩法动作 → 音效 + 墙上回声）
 *
 * 这一层最容易"看起来做了、其实不响"：素材路径写错、开关没落盘、闸门写反、
 * 回声文案超长、墙上的 DOM 没接上 —— 全都不报错。所以下面每组都配了注入。
 * ================================================================== */

const ritualFb = loadCjs('miniprogram/utils/ritualFeedback.js', { require: markerRequire })

// ① 素材：登记了就必须能响（文件不在 = 永远静音，且没有任何提示）
const fbRel = String(ritualFb.SOUND_SOURCES.muyu || '')
const fbAbs = join2(ROOT, 'miniprogram' + fbRel)
check('★ 木鱼音效素材真实存在（登记了就必须能响）', !!fbRel && existsSync(fbAbs), fbAbs)
check(
  '★ 音效体积受控（< 32KB：它挂在每次敲击上，不能是大文件）',
  existsSync(fbAbs) && statSync(fbAbs).size < 32 * 1024,
  existsSync(fbAbs) ? `${statSync(fbAbs).size}B` : '文件不存在'
)
// 每个登记在册的音色都要有真文件（漏一个 = 那个动作"接了音效但永远不响"）
const srcEntries = Object.entries(ritualFb.SOUND_SOURCES)
check('素材表里每个动作都有真实文件', srcEntries.length >= 2 && srcEntries.every(([, rel]) => {
  const abs = join2(ROOT, 'miniprogram' + rel)
  return existsSync(abs) && statSync(abs).size > 1024 && statSync(abs).size < 32 * 1024
}), srcEntries.map(([k, v]) => `${k}=${v}`).join(' '))
/* （2026-09-20 曾在此加过 5 条「时刻音」判据 —— 上墙成功自动播 6 秒推广曲副歌。
   产品负责人当天裁决撤掉：「还是别放音乐了，过于突兀」→ 机制与判据一并删除。
   若日后改成**用户主动点**的形态，再按那时的设计补判据，不要恢复自动播放。） */
check(
  '★ 点灯有独立的铜磬（不是把木鱼复制一份：两个动作要有各自的性格）',
  (() => {
    const a = join2(ROOT, 'miniprogram' + ritualFb.SOUND_SOURCES.muyu)
    const b = join2(ROOT, 'miniprogram' + ritualFb.SOUND_SOURCES.lamp)
    if (!existsSync(a) || !existsSync(b)) return false
    return a !== b && readFileSync(a).length !== readFileSync(b).length
  })()
)
check(
  '生成脚本支持两种音色（--kind），且两套模态参数确实不同（同一套 = 两个动作一个声音）',
  (() => {
    const gen = readSrc('miniprogram/scripts/make-ritual-audio.mjs')
    const kinds = /const KINDS = \{([\s\S]*?)\n\}/.exec(gen)
    if (!/--kind/.test(gen) || !kinds) return false
    const body = kinds[1]
    const muyu = /muyu: \{([\s\S]*?)\n  \}/.exec(body)
    const lamp = /lamp: \{([\s\S]*?)\n  \}/.exec(body)
    if (!muyu || !lamp) return false
    return muyu[1] !== lamp[1] && /2\.76|5\.4|8\.93/.test(lamp[1]) && /770/.test(muyu[1])
  })()
)
check(
  '★ 素材可复现：生成脚本在仓里（不是"某台机器上生成过一次"）',
  existsSync(join2(ROOT, 'miniprogram/scripts/make-ritual-audio.mjs'))
)

// ② 开关：默认开 / 可关 / 落盘 / 往返可逆（用 wx 桩驱动真实模块）
{
  const stub = installWxStub()
  const store = new Map()
  globalThis.wx.getStorageSync = (k) => (store.has(k) ? store.get(k) : '')
  globalThis.wx.setStorageSync = (k, v) => { store.set(k, v) }
  check('★ 音效默认开（产品口径：默认开但可关）', ritualFb.isSoundEnabled() === true)
  ritualFb.setSoundEnabled(false)
  check(
    '★ 关掉立刻生效并落盘（否则下次进页又"自己开了"）',
    ritualFb.isSoundEnabled() === false && store.get(ritualFb.SOUND_KEY) === false
  )
  ritualFb.toggleSound()
  check('★ 开关往返可逆', ritualFb.isSoundEnabled() === true)
  stub.restore()
}

// ③ 频率闸门 + 播放器（连点不叠音是手感问题，不是性能问题）
{
  check('频率闸门：没响过就响', ritualFb.shouldPlaySound(null, 1000) === true)
  check('★ 频率闸门：连点（<120ms）不响', ritualFb.shouldPlaySound(1000, 1050) === false)
  check('★ 频率闸门：过了间隔就响', ritualFb.shouldPlaySound(1000, 1120) === true)
  // ⚠️ 0 是合法时间戳，不能当"没响过"的哨兵 —— 自检时真抓到这个缺陷（闸门静默失效）
  check('★ 频率闸门不把时间戳 0 当哨兵（否则 t=0 响过之后闸门失效）', ritualFb.shouldPlaySound(0, 50) === false)
  let plays = 0
  let destroyed = 0
  const player = ritualFb.createPlayer({
    createContext: () => ({ play() { plays += 1 }, stop() {}, destroy() { destroyed += 1 }, onError() {} })
  })
  const p0 = player.play('muyu', 0)
  const p50 = player.play('muyu', 50)
  const p130 = player.play('muyu', 130)
  check('★ 连点只响一次、过了间隔再响', p0 === true && p50 === false && p130 === true && plays === 2, `plays=${plays}`)
  // ⚠️ 口径随素材表变：点灯现在**也有**音效（铜磬），所以这条改用真的没有素材的动作
  check('★ 没有素材的动作不响（素材表是唯一事实源）', player.play('wish', 9999) === false && player.play('nope', 9998) === false)
  player.destroy()
  check('★ destroy 释放音频实例（页面卸载不能留着后台音频）', destroyed >= 1, `destroyed=${destroyed}`)
}

// ④ 回声文案：长度 / 人称 / 确定性 / 未知动作
const echoPool = Object.entries(ritualFb.ECHO_LINES)
  .flatMap(([action, lines]) => (Array.isArray(lines) ? lines : []).map((t) => ({ action, t: String(t) })))
check(
  '回声池覆盖三个必修动作（点灯 / 木鱼 / 落愿）',
  ['muyu', 'lamp', 'wish'].every((a) => (ritualFb.ECHO_LINES[a] || []).length > 0)
)
const echoTooLong = echoPool.filter((x) => [...x.t].length > ritualFb.ECHO_MAX_CHARS)
check(
  `★ 回声每条 ≤ ${ritualFb.ECHO_MAX_CHARS} 字（墙上页脚只有 44rpx 高，一行说完）`,
  echoTooLong.length === 0,
  echoTooLong.map((x) => `${x.t}(${[...x.t].length})`).join(' / ')
)
const echoNotMine = echoPool.filter((x) => !x.t.startsWith('我'))
check(
  '★ 回声一律第一人称（墙上其余弹幕是别人的心愿，不能冒充别人的愿）',
  echoNotMine.length === 0,
  echoNotMine.map((x) => x.t).join(' / ')
)
check(
  '★ 回声轮换确定性（同 seq 同文案、不同 seq 换文案 —— 与弹幕布局同一条铁律）',
  ritualFb.echoLine('muyu', 0) === ritualFb.echoLine('muyu', 0) &&
    ritualFb.echoLine('muyu', 0) !== ritualFb.echoLine('muyu', 1)
)
check('未知动作不回显（页面据此不吐垃圾）', ritualFb.buildEcho('nope', 1) === null)
const echoSample = ritualFb.buildEcho('muyu', 3, { muyuCount: 7 })
check(
  '回声带"事实"副文案（功德 N）且 key 唯一到每次动作',
  !!echoSample && echoSample.sub === '功德 7' && echoSample.key === 'muyu#3'
)

// ⑤ 页面接线（驱动真实页面方法）
{
  const stub = installWxStub()
  const store = new Map()
  globalThis.wx.getStorageSync = (k) => (store.has(k) ? store.get(k) : '')
  globalThis.wx.setStorageSync = (k, v) => { store.set(k, v) }
  const proto = loadPageConfig('miniprogram/subpackages/feature/wish-wall/index.js')
  let played = 0
  const mkPage = () => {
    const page = Object.assign(Object.create(null), proto)
    page.data = {
      muyuCount: 0,
      soundOn: true,
      echoRows: [],
      lamp: { streak: 3 },
      quota: { left: 4 },
      viewMode: 'wall',
      items: [],
      rows: [],
      danmakuCycle: 0,
      freshId: ''
    }
    page.setData = function (patch) { Object.assign(this.data, patch) }
    page.scheduleDanmakuCycle = () => {}
    page.clearDanmakuCycle = () => {}
    page.clearFreshTimer = () => {}
    page._wallItems = []
    page._soundPlayer = { play() { played += 1; return true }, destroy() {} }
    page._echoSeq = 0
    return page
  }
  const p1 = mkPage()
  p1.onMuyuTap()
  check(
    '★ 敲木鱼 → 墙上立刻回一条即时反馈（第一人称、带功德）',
    (p1.data.echoRows[0] || {}).action === 'muyu' &&
      String((p1.data.echoRows[0] || {}).text).startsWith('我') &&
      (p1.data.echoRows[0] || {}).sub === '功德 1'
  )
  check('★ 敲木鱼同时发声', played === 1, `played=${played}`)
  check('★ 木鱼计数进存档（"只写不读"已修，这里保证写仍然发生）', Number(store.get('wish_muyu_v1')) === 1)
  p1.clearEcho()

  const p2 = mkPage()
  p2.pushEcho('lamp')
  check('★ 点灯走同一个口子（后续玩法照抄这一行即可）', (p2.data.echoRows[0] || {}).action === 'lamp')
  p2.pushEcho('wish')
  check(
    '★ 落愿回声带额度事实（"今日还可写 N 条"顺带把额度说清）',
    (p2.data.echoRows[0] || {}).sub === '今日还可写 4 条'
  )

  const p3 = mkPage()
  p3.onToggleSound()
  check('★ 音效开关：关 → 落盘 + 界面回显', p3.data.soundOn === false && store.get(ritualFb.SOUND_KEY) === false)
  const beforePlay = played
  p3.onToggleSound()
  check('★ 音效开关：再开时给一声（"开了没感觉"是最差的开关）', p3.data.soundOn === true && played > beforePlay)

  const p4 = mkPage()
  let p4Destroyed = false
  p4._soundPlayer = { play() { return true }, destroy() { p4Destroyed = true } }
  p4._echoTimer = setTimeout(() => {}, 5000)
  p4._muyuTimer = setTimeout(() => {}, 5000)
  p4.onUnload()
  check('★ 卸载时清回声计时器（页面没了还在 setData = 报错源头）', p4._echoTimer === null)
  check('★ 卸载时销毁音效实例', p4Destroyed === true)
  stub.restore()
}

// ⑥ 源码级接线（onLoad 这种没法在 harness 里整段跑的方法，按"接了什么"断言）
const fbPageSrc = readSrc('miniprogram/subpackages/feature/wish-wall/index.js')
check('★ 木鱼计数键名收在 utils（页面不得出现字面量存储键）', !/wish_muyu_v1/.test(fbPageSrc))
check(
  '★ 木鱼计数进页读回存档（曾经的缺陷：只写不读 → 每次进来都归零）',
  // ⚠️ 2026-09-20 收紧：必须钉**进页那一处**（onLoad 的 setData 同时设 soundOn 与 muyuCount）。
  // 原先用宽松的 /muyuCount:\s*readMuyuCount()/ —— 新增的「换机恢复」路径里也有一处读取，
  // 于是宽松版会被**另一条代码路径**满足，从而放行「onLoad 不读」这个真缺陷
  // （注入 `muyu-count-write-only-again` 不再被检出，本仓自检实测抓到）。
  /soundOn:[^}]*muyuCount:\s*wishRitual\.readMuyuCount\(\)/.test(fbPageSrc) && /wishRitual\.writeMuyuCount\(/.test(fbPageSrc)
)
check(
  '★ 点灯与落愿都接进反馈层（不是只有木鱼有反馈）',
  /pushEcho\('lamp'\)/.test(fbPageSrc) && /pushEcho\('wish'\)/.test(fbPageSrc)
)

// ⑦ 墙上的回声：DOM / 位置 / 时长同源
check(
  '★ 墙上回声用数组 + wx:key（连点要重播动画；同 key 不会重播）',
  /class="ww-echo"[\s\S]{0,600}?wx:for="\{\{echoRows\}\}"[\s\S]{0,200}?wx:key="key"/.test(wallWxml2) &&
    /wx:for="\{\{echoRows\}\}"/.test(wallWxml2)
)
check(
  '★ 墙元素按 echoRows 挂 is-echo（墙本身也要回一下）',
  /class="ww-wall \{\{echoRows\.length \? 'is-echo' : ''\}\}"/.test(wallWxml2) &&
    /\.ww-wall\.is-echo\s*\{/.test(wallWxssCode)
)
const blockOf = (sel) => (new RegExp(`\\${sel}\\s*\\{[^}]*\\}`).exec(wallWxssCode) || [''])[0]
// 长度可能是 `44rpx` 也可能是 `0`（无单位），两种都要读得出来 —— 否则判据会拿 NaN 比大小
const lenIn = (block, prop) => {
  const m = new RegExp(`${prop}:\\s*(-?[\\d.]+)(rpx)?`).exec(block)
  return m ? Number(m[1]) : NaN
}
const echoBlock = blockOf('.ww-echo')
const footBlock = blockOf('.ww-wall-foot')
const echoZ = Number((/z-index:\s*(\d+)/.exec(echoBlock) || [])[1])
const footZ = Number((/z-index:\s*(\d+)/.exec(footBlock) || [])[1])
check(
  '★ 回声条与墙页脚同带（等高 + 都贴底），且盖在页脚之上',
  lenIn(echoBlock, 'height') === lenIn(footBlock, 'height') &&
    lenIn(echoBlock, 'bottom') === 0 &&
    lenIn(footBlock, 'bottom') === 0 &&
    echoZ > footZ,
  `height=${lenIn(echoBlock, 'height')}/${lenIn(footBlock, 'height')} z=${echoZ}/${footZ}`
)
const echoAnimMs = Number((/animation:\s*ww-echo-life\s+(\d+)ms/.exec(echoBlock) || [])[1])
check(
  '★ 回声动画时长与 utils 的 ECHO_HOLD_MS 同源（两处同值，改一处必须改两处）',
  echoAnimMs === ritualFb.ECHO_HOLD_MS && /@keyframes ww-echo-life/.test(wallWxssCode),
  `css=${echoAnimMs} js=${ritualFb.ECHO_HOLD_MS}`
)
check(
  '★ 音效开关在玩法说明行里（on/off 两态 + 无障碍 switch 角色）',
  /bindtap="onToggleSound"/.test(wallWxml2) &&
    /aria-role="switch"/.test(wallWxml2) &&
    /\.ww-sound\.is-on\s*\{/.test(wallWxssCode) &&
    /\.ww-sound\.is-off\s*\{/.test(wallWxssCode)
)

/* ================================================================== *
 * 注册钩子的「去注册」环节（2026-09-18 产品反馈"数据报表里没有祈福墙数据"）
 *
 * 报表看不到祈福墙 = ①报表没算它 ②漏斗缺"去注册"这一环，两件事本轮都补了。
 * 这里钉住 C 端那一半：点了弹窗里的授权按钮，必须真的上报 step=go_register。
 * ================================================================== */
{
  const stub = installWxStub()
  const sent = []
  globalThis.wx.cloud = { callFunction: (o) => { sent.push(o); return Promise.resolve({ result: {} }) } }
  // 埋点队列只在**能取到 userId** 时才发送（analytics/index.js: getUserId ← getApp().globalData.openid）。
  // 不桩这一条，事件只会进队列、永远不上报，测试会"看不到任何东西"（第一版就是这样空的）。
  const prevGetApp = globalThis.getApp
  globalThis.getApp = () => ({ globalData: { openid: 'u-test' } })
  const proto = loadPageConfig('miniprogram/subpackages/feature/wish-wall/index.js')
  const page = Object.assign(Object.create(null), proto)
  page.data = { productKey: 'mashangyou', echoRows: [], soundOn: false, muyuCount: 0, lamp: {}, quota: { left: 4 } }
  page.setData = function (patch) { Object.assign(this.data, patch) }
  // 埋点是**批量 + 定时**上报的（FLUSH_INTERVAL_MS = 8000）：直接断言必然看到空数组。
  // 这里只把"那个 8 秒的定时器"改成同步触发（压缩时间，不跳过传输），断言完立刻还原。
  const realSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = (fn, ms) => {
    if (ms === 8000 && typeof fn === 'function') { fn(); return 0 }
    return realSetTimeout(fn, ms)
  }
  try {
    page.onRegisterDialogCta()
  } finally {
    globalThis.setTimeout = realSetTimeout
  }
  const evs = sent.flatMap((o) => (o && o.data && o.data.events) || [])
  const hit = evs.find((x) => String(x.action || '').includes('wish_wall_register_gate'))
  check(
    '★ 点「去注册」上报 step=go_register（否则漏斗只有曝光与完成，中间那段永远黑箱）',
    !!hit && String(hit.step || '') === 'go_register' && String(hit.action || '') === 'wish_wall_register_gate',
    JSON.stringify(evs.map((x) => `${x.action}:${x.step || ''}`))
  )
  check(
    '弹窗事件已绑定（bind:cta）',
    /bind:cta="onRegisterDialogCta"/.test(wallWxml2)
  )
  globalThis.getApp = prevGetApp
  stub.restore()
}

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
const railPercents = Array.from(wallWxssCode.matchAll(/\.ww-wall-rail\.rail-(\d+)\s*\{\s*top:\s*([\d.]+)%/g))
  .map((m) => ({ i: Number(m[1]), top: Number(m[2]) }))
  .sort((a, b) => a.i - b.i)
check(
  '★ 轨道刻度的百分比与弹幕实际落点逐条对齐（两套写法必须对账，错一条就是刻度压着文字）',
  railPercents.length === wish.LANES &&
    railPercents.every((r, i) => r.i === i + 1 && Math.abs(r.top - laneTops[i]) < 0.05),
  `刻度=${railPercents.map((r) => r.top).join('/')} 弹幕=${laneTops.join('/')}`
)
check(
  '轨道刻度条数与 WXML 里画的刻度一致（CSS 有不算有，得真画出来）',
  (wallWxml2.match(/class="ww-wall-rail rail-\d"/g) || []).length === wish.LANES
)

// ② 墙页脚 = 「墙面 → 愿签列表」入口
{
  const stub = installWxStub()
  const scrolled = []
  globalThis.wx.pageScrollTo = (o) => scrolled.push(o)
  const proto = loadPageConfig('miniprogram/subpackages/feature/wish-wall/index.js')
  const page = Object.assign(Object.create(null), proto)
  page.data = {}
  page.setData = function (patch) { Object.assign(this.data, patch) }
  page.goWishList()
  check(
    '★ 点墙页脚 → 滚到愿签列表（selector 必须是列表上真实存在的 id）',
    scrolled.length === 1 &&
      scrolled[0].selector === '#wishList' &&
      /id="wishList"/.test(wallWxml2),
    JSON.stringify(scrolled)
  )
  check(
    '墙页脚有可点的绑定与「看全部 ›」提示（看得见才点得到）',
    /class="ww-wall-foot"[\s\S]{0,500}?bindtap="goWishList"/.test(wallWxml2) &&
      /ww-wall-foot-more/.test(wallWxml2) &&
      /\.ww-wall-foot-more\s*\{/.test(wallWxssCode)
  )
  stub.restore()
}

// ③ 已点亮的灯再点一次：动效 + 回声，**不许弹 toast**（灯语已经写在卡上了）
{
  const stub = installWxStub()
  const store = new Map()
  globalThis.wx.getStorageSync = (k) => (store.has(k) ? store.get(k) : '')
  globalThis.wx.setStorageSync = (k, v) => { store.set(k, v) }
  const proto = loadPageConfig('miniprogram/subpackages/feature/wish-wall/index.js')
  let played = 0
  const page = Object.assign(Object.create(null), proto)
  page.data = { lamp: { lit: true, line: '灯亮着，心愿就还没说完。', streak: 3 }, echoRows: [], soundOn: true, muyuCount: 0, quota: { left: 4 } }
  page.setData = function (patch) { Object.assign(this.data, patch) }
  page._soundPlayer = { play() { played += 1; return true }, destroy() {} }
  page._echoSeq = 0
  page.onLampTap()
  check(
    '★ 已点的灯再点 = 「再看一眼」（爱心动效 + 回声，且**不弹 toast**：灯语就在卡上）',
    page.data.heartBurst === true &&
      (page.data.echoRows[0] || {}).action === 'lampAgain' &&
      String((page.data.echoRows[0] || {}).text).startsWith('我') &&
      stub.toasts.length === 0,
    `toasts=${JSON.stringify(stub.toasts)}`
  )
  check('再看一眼也要有声音反馈', played === 1, `played=${played}`)
  check(
    '重看灯**不得**再写点灯存档（点灯幂等：同一天只记第一次）',
    !store.has(ritual.STORAGE_KEY),
    `storage keys=${[...store.keys()].join(',') || '(空)'}`
  )
  page.clearEcho()
  stub.restore()
}

/* ================================================================== *
 * 玩法第一批（需求 5 · 今日一签 / 拆签饼 / 星座签 / MBTI 贴士）
 *
 * 这一批最容易出的三类问题：
 *   1) **合规**：文案里冒出算命/改运/预测吉凶这类表述（微信对占卜类内容从严）；
 *   2) **确定性**：结果用了随机数 → 刷新就换一个，"今日一签"就不成立了；
 *   3) **假结果**：需要星座/MBTI 而资料里没有，却还是编一个给用户。
 * 三条都配了注入。
 * ================================================================== */

const plays = loadCjs('miniprogram/config/ritualPlays.js', { require: markerRequire })
const playContent = loadCjs('miniprogram/config/ritualPlayContent.js', { require: markerRequire })
const profileConstants = loadCjs('miniprogram/utils/profileConstants.js', { require: markerRequire })
const playWishWall = loadCjs('miniprogram/utils/wishWall.js', { require: markerRequire })
// 带 require 的模块必须给「标记式」桩：harness 的默认 fallback 抛的是另一句话，
// 会被当成真实错误直接抛出（easterEgg 那处也是这么接的）
const ritualPlay = loadCjs('miniprogram/utils/ritualPlay.js', {
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
check(
  `玩法回声一律第一人称且 ≤ ${ritualFb.ECHO_MAX_CHARS} 字（这条也会上弹幕墙）`,
  playList.every((p) => String(p.echo).startsWith('我') && [...String(p.echo)].length <= ritualFb.ECHO_MAX_CHARS),
  playList.map((p) => p.echo).join(' / ')
)

// ② 内容池：池子存在且非空、键与资料选项一一对应
check(
  '玩法引用的内容池都存在且非空',
  playList.every((p) => (ritualPlay.POOLS[p.pool] ? (ritualPlay.POOLS[p.pool]() || []).length > 0 : false))
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

// ③ 合规术语守卫：这些词出现在给用户看的文案里就是审核风险
const FORBIDDEN_TERMS = [
  '算命', '占卜', '卜卦', '算卦', '卦象', '改运', '转运', '开运', '风水', '看相',
  '八字', '紫微', '塔罗', '吉凶', '预测', '大师', '命理', '招财', '辟邪'
]
const playTextSources = {
  '注册表': stripComments(readSrc('miniprogram/config/ritualPlays.js')),
  '内容池': stripComments(readSrc('miniprogram/config/ritualPlayContent.js')),
  '玩法逻辑': stripComments(readSrc('miniprogram/utils/ritualPlay.js')),
  '页面 JS': stripComments(readSrc('miniprogram/subpackages/feature/wish-wall/index.js')),
  '页面 WXML': stripComments(readSrc('miniprogram/subpackages/feature/wish-wall/index.wxml'))
}
const foundForbidden = []
Object.entries(playTextSources).forEach(([name, src]) => {
  FORBIDDEN_TERMS.forEach((term) => {
    if (src.includes(term)) foundForbidden.push(`${name}:${term}`)
  })
})
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

// ⑤ 页面接线：瓦片由注册表派生 + 抽→写→上墙这条路
check(
  '★ 瓦片由注册表 wx:for 派生（页面不写死玩法名）',
  /wx:for="\{\{plays\}\}"[\s\S]{0,400}?wx:key="id"[\s\S]{0,200}?data-id="\{\{item\.id\}\}"/.test(wallWxml2)
)
check('玩法数据来自注册表（不是页面里手抄一份）', /plays:\s*RITUAL_PLAYS/.test(readSrc('miniprogram/subpackages/feature/wish-wall/index.js')))
check(
  '纸签弹层：标题/正文/CTA 都来自结果对象（页面零判断）',
  /class="ww-sheet-title">\{\{playResult\.title\}\}/.test(wallWxml2) &&
    /wx:for="\{\{playResult\.lines\}\}"/.test(wallWxml2) &&
    /bindtap="usePlayWish"/.test(wallWxml2)
)
check(
  '★ 弹层身份明确：遮罩 + 把手 + 印章字标 + 从底部升起（不再是"既不像卡也不像弹窗"的内联块）',
  /class="ww-sheet-mask"[\s\S]{0,200}?bindtap="closePlayResult"/.test(wallWxml2) &&
    /class="ww-sheet-grip"/.test(wallWxml2) &&
    /class="ww-sheet-mark"[^>]*>\{\{playResult\.mark\}\}/.test(wallWxml2) &&
    /\.ww-sheet\s*\{[^}]*animation:\s*ww-sheet-up/.test(wallWxssCode) &&
    /\.ww-sheet-mask\s*\{[^}]*position:\s*fixed/.test(wallWxssCode) &&
    /@keyframes ww-sheet-up/.test(wallWxssCode)
)
check(
  '弹层可拖拽关闭（把手上的手势；阈值是纯函数，能被单测钉住）',
  /bindtouchstart="onSheetGripStart"/.test(wallWxml2) &&
    /bindtouchmove="onSheetGripMove"/.test(wallWxml2) &&
    /function sheetDragShouldClose\(dy\)/.test(fbPageSrc)
)
check(
  '★ 产品链路**只留一条主路**（有祈运推荐用推荐，否则用这面墙的藏品；不再两行并列抢主次）',
  // 2026-09-20：条件多了一档 `recoLoading` —— 推荐是异步取的，取件期间那一行也要在（占位），
  // 否则弹层会在用户读签文时长高一块。语义不变：**只有一个** `.ww-sheet-product`，主次不分家的两行仍不许回来。
  /class="ww-sheet-product"/.test(wallWxml2) &&
    /wx:if="\{\{reco \|\| productId \|\| recoLoading\}\}"/.test(wallWxml2) &&
    (wallWxml2.match(/class="ww-sheet-product"/g) || []).length === 1 &&
    !/class="ww-play-reco"/.test(wallWxml2) &&
    !/class="ww-play-product"/.test(wallWxml2)
)
check(
  '★ 页头产品 chip 是常驻的产品入口（第一屏就能到详情，不必先抽一签）',
  /class="ww-scope \{\{productId \? 'is-link' : ''\}\}"[\s\S]{0,200}?bindtap="goProduct"/.test(wallWxml2) &&
    /\.ww-scope\.is-link/.test(wallWxssCode)
)
check(
  '补资料引导有独立分支（不给假结果的那条路是画出来的，不是只写在注释里）',
  /wx:if="\{\{playNeed\}\}"/.test(wallWxml2) && /bindtap="goProfileField"/.test(wallWxml2)
)
{
  const stub = installWxStub()
  const store = new Map()
  globalThis.wx.getStorageSync = (k) => (store.has(k) ? store.get(k) : '')
  globalThis.wx.setStorageSync = (k, v) => { store.set(k, v) }
  const scrolled = []
  globalThis.wx.pageScrollTo = (o) => scrolled.push(o)
  const proto = loadPageConfig('miniprogram/subpackages/feature/wish-wall/index.js')
  const mkPlayPage = (over) => {
    const page = Object.assign(Object.create(null), proto)
    page.data = Object.assign({ plays: playList, playResult: null, playNeed: null, draft: '', echoRows: [], soundOn: false, muyuCount: 0, lamp: {}, quota: { left: 4 } }, over || {})
    page.setData = function (patch) { Object.assign(this.data, patch) }
    page._soundPlayer = { play() { return true }, destroy() {} }
    page._echoSeq = 0
    return page
  }
  const tapEvt = (id) => ({ currentTarget: { dataset: { id } } })
  const p1 = mkPlayPage()
  await p1.onPlayTap(tapEvt('qian'))
  check(
    '★ 抽今日一签 → 结果就地展开 + 墙上回一声（action=play，文案来自注册表）',
    (p1.data.playResult || {}).id === 'qian' &&
      (p1.data.echoRows[0] || {}).action === 'play' &&
      (p1.data.echoRows[0] || {}).text === '我摇了今日一签'
  )
  p1.clearEcho()
  await p1.onPlayTap(tapEvt('qian'))
  check('再点同一张瓦片 = 收起（不重复播回声刷墙）', p1.data.playResult === null)

  const p2 = mkPlayPage()
  // 桩要读页面自己的缓存字段，否则"补上资料后再点"这一步测不到（第一版桩成常量 null → 必假红）
  p2.loadPlayProfile = async function () { return this._playProfile || null }
  await p2.onPlayTap(tapEvt('zodiac'))
  check(
    '★ 资料里没有星座 → 出引导、不出结果（不编一个给用户）',
    p2.data.playResult === null && (p2.data.playNeed || {}).field === 'zodiac'
  )
  p2._playProfile = { zodiac: 'aries', mbti: '' }
  await p2.onPlayTap(tapEvt('zodiac'))
  check('补上星座后同一张瓦片就能出结果', (p2.data.playResult || {}).id === 'zodiac' && p2.data.playNeed === null)
  // 抽到"一签"（自带心愿词）→ 预填；其它玩法 → 预填「马上有」开头让用户自己写
  const p3 = mkPlayPage({ playResult: { id: 'qian', wish: '马上有回音' } })
  p3.usePlayWish()
  check('★ 结果卡「写成心愿」把心愿词预填进写愿签', p3.data.draft === '马上有回音')
  check(
    '★ 点「写成心愿」必须收掉纸签弹层（弹层 z-index 41 高于吸底发送条 z-index 30；不收就会永久盖住它 —— 2026-09-19 真机反馈「滚下去了但看不到输入框」的根因）',
    p3.data.playResult === null,
    `playResult=${JSON.stringify(p3.data.playResult)}`
  )
  check(
    '预填后滚到输入框（selector 必须是输入框上真实存在的 id）',
    scrolled.length >= 1 && scrolled[scrolled.length - 1].selector === '#wishInput' && /id="wishInput"/.test(wallWxml2)
  )
  const p4 = mkPlayPage({ playResult: { id: 'cookie', wish: '' }, playNeed: { field: 'mbti' } })
  p4.usePlayWish()
  check('没有可用的心愿词时，只给「马上有」开头（不硬拼一个废话）', p4.data.draft === '马上有')
  check('★ 无心愿词那条路径同样要收弹层（两条分支不能只修一条）', p4.data.playResult === null)
  const navigated = []
  globalThis.wx.navigateTo = (o) => navigated.push(o && o.url)
  p4.goProfileField()
  check(
    '补资料引导跳资料页（路径来自注册表常量）',
    navigated.length === 1 && navigated[0] === plays.PROFILE_PAGE,
    navigated.join(',')
  )
  stub.restore()
}

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
{
  const stub = installWxStub()
  const proto = loadPageConfig('miniprogram/subpackages/feature/wish-wall/index.js')
  const navigated = []
  globalThis.wx.navigateTo = (o) => navigated.push(o && o.url)
  const mkBlessPage = () => {
    const page = Object.assign(Object.create(null), proto)
    page.data = { plays: playList, productId: '', productKey: 'k', productTitle: '孔雀标本' }
    page.setData = function (patch) { Object.assign(this.data, patch) }
    return page
  }
  const p1 = mkBlessPage()
  p1.applyBlessScope('success')
  check(
    '★ 有祈运标签就重排玩法（点名的玩法排到最前，其余保持原顺序）',
    p1.data.plays.slice(0, 2).map((x) => x.id).join(',') === 'qian,mbti' &&
      p1.data.plays.length === playList.length &&
      p1.data.blessLabelText === '求成'
  )
  const p2 = mkBlessPage()
  p2.applyBlessScope('')
  check('没有标签 → 恢复注册表顺序且不显示提示（参数缺失绝不影响页面）',
    p2.data.plays.map((x) => x.id).join(',') === playList.map((x) => x.id).join(',') &&
      p2.data.blessLabelText === '')
  const p3 = mkBlessPage()
  p3.applyBlessScope('nope,,')
  check('标签非法 → 当没标签处理（不抛、页头不显示垃圾 chip）', p3.data.blessLabelText === '' && p3.data.blessTags.length === 0)
  const p4 = mkBlessPage()
  p4.data.productId = 'p9'
  p4.goProduct()
  check('★ 结果卡的商品入口跳详情页（这面墙的商品 = 最短转化路径）',
    navigated.length === 1 && navigated[0] === '/subpackages/feature/detail/index?id=p9', navigated.join(','))
  const p5 = mkBlessPage()
  p5.goProduct()
  check('没有 productId 时不跳（不拼一个空 id 的链接）', navigated.length === 1)
  stub.restore()
}
check(
  '祈运 chip 与产品入口都画在页面上（逻辑接了不代表用户看得见）',
  /class="ww-bless"/.test(wallWxml2) && /bindtap="goProduct"/.test(wallWxml2) &&
    /\.ww-bless\s*\{/.test(wallWxssCode) && /\.ww-sheet-product\s*\{/.test(wallWxssCode)
)

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
const blessProducts = loadCjs('miniprogram/utils/blessProducts.js')
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
  '★ 推荐区标题只说我们真知道的事：这面墙的祈运标签（**任何"同好也在看"式的社会证明都不许出现**）',
  blessProducts.recoLabel('求成') === '偏「求成」· 为你配一件' &&
    blessProducts.recoLabel('') === '为你配一件' &&
    !/同好/.test(stripForCopy(readSrc('miniprogram/utils/blessProducts.js'))) &&
    !/同好/.test(stripForCopy(wallWxml2))
)
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

/* —— C 端弱推接线：拉取 / 缓存 / 失败降级 / 跳转 —— */
{
  const stub = installWxStub()
  const proto = loadPageConfig('miniprogram/subpackages/feature/wish-wall/index.js')
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
    page.data = { blessTags: blessTags || [], productId: productId || '' }
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
  check('★ 推荐失败只是"没有推荐"（不抛、不弹错、不影响玩法）', p3.data.reco === null)

  mode = 'empty'
  const p4 = mkRecoPage(['journey'], 'wall1')
  await p4.loadBlessReco()
  check('云函数回空列表 → 不显示推荐卡（不拿别的商品凑数）', p4.data.reco === null)

  const p5 = mkRecoPage(['peace'], 'wall1')
  p5.data.reco = { _id: 'rec1', tag: 'peace' }
  p5.goRecoProduct()
  check('★ 点推荐卡跳详情页',
    navigated.length === 1 && navigated[0] === '/subpackages/feature/detail/index?id=rec1', navigated.join(','))
  const p6 = mkRecoPage(['peace'], 'wall1')
  p6.goRecoProduct()
  check('没有推荐时不跳（不拼空链接）', navigated.length === 1)
  stub.restore()
}
check(
  '产品行画在纸签弹层里（逻辑接了不代表用户看得见）',
  /class="ww-sheet-product"/.test(wallWxml2) && /bindtap="\{\{reco \? 'goRecoProduct' : 'goProduct'\}\}"/.test(wallWxml2) &&
    /\.ww-sheet-product\s*\{/.test(wallWxssCode)
)
check('玩法事件之外，弱推点击有自己的埋点（双端登记）',
  /wish_wall_reco/.test(readSrc('miniprogram/subpackages/feature/wish-wall/index.js')) &&
    /wish_wall_reco:/.test(readSrc('miniprogram/utils/analytics/eventSchema.js')) &&
    /wish_wall_reco:/.test(readSrc('admin/src/utils/analyticsSchema.js')))

/* ================================================================== *
 * 真机截图（2026-09-18 第三组）修的两处版式缺陷
 *
 *   ① 回声条半透明 → 与墙页脚的文字叠在一起（"两行字"看着像渲染错乱）；
 *   ② 未点灯的灯卡顶对齐 → 底部空一截，与右边居中的木鱼卡不对称。
 * 两条都不是"样式写错了"，而是**画出来才知道**——所以判据直接钉住"不许再犯"的形态。
 * ================================================================== */
const echoRuleBlock = (new RegExp('\\' + '.ww-echo' + '\\s*\\{[^}]*\\}').exec(wallWxssCode) || [''])[0]
const echoBg = (new RegExp('background:\\s*([^;]+);').exec(echoRuleBlock) || [])[1] || ''
check(
  '★ 回声条背景必须不透明（半透明会让下面的页脚文字透上来，两行字叠一起）',
  !!echoBg && !/rgba\(/.test(echoBg) && !/transparent/.test(echoBg),
  `background=${echoBg.slice(0, 60)}`
)
check(
  '★ 未点灯的灯卡垂直居中（三行内容顶对齐会在底部留白，与木鱼卡不对称）',
  /\.ww-lantern\.is-idle\s*\{[^}]*align-items:\s*center/.test(wallWxssCode) &&
    /class="ww-lantern \{\{lamp\.lit \? 'is-lit' : 'is-idle'\}\}"/.test(wallWxml2) &&
    /\.ww-lantern\s*\{[^}]*align-items:\s*flex-start/.test(wallWxssCode),
  '点亮态仍是顶对齐（那是真图确认过的），只有未点亮才居中'
)

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
{
  const stub = installWxStub()
  const proto = loadPageConfig('miniprogram/subpackages/feature/wish-wall/index.js')
  const mkOnLoadPage = () => {
    const page = Object.assign(Object.create(null), proto)
    page.data = { productId: '', productKey: '', productTitle: '', entryFrom: 'direct', echoRows: [], soundOn: false, muyuCount: 0, lamp: {}, quota: { left: 4 } }
    page.setData = function (patch) { Object.assign(this.data, patch) }
    page.initRitual = () => {}
    page.bootstrap = () => {}
    page.applyBlessScope = () => {}
    return page
  }
  const tracks = []
  const p1 = mkOnLoadPage()
  p1.onLoad({ scene: 'from=store_qr&k=mashangyou' })
  check(
    '★ 扫码进来（只有 scene）→ 落到码里的那面墙 + 来源记为 store_qr',
    p1.data.productKey === 'mashangyou' && p1.data.entryFrom === 'store_qr',
    JSON.stringify({ key: p1.data.productKey, from: p1.data.entryFrom })
  )
  const p2 = mkOnLoadPage()
  p2.onLoad({ productKey: 'k2', from: 'detail', scene: 'from=store_qr&k=other' })
  check(
    '★ 显式参数优先于 scene（普通 URL 入口不被门店码抢走）',
    p2.data.productKey === 'k2' && p2.data.entryFrom === 'detail',
    JSON.stringify({ key: p2.data.productKey, from: p2.data.entryFrom })
  )
  const p3 = mkOnLoadPage()
  p3.onLoad({})
  check('既无显式参数也无 scene → 默认墙 + direct（不抛）',
    p3.data.productKey === wish.PRODUCT_KEY && p3.data.entryFrom === 'direct')
  stub.restore()
}

/* ================================================================== *
 * 版式（2026-09-18 产品确认）：①祈运标签挪进页头填右侧空白 ②发送条吸底
 * ================================================================== */
check(
  '★ 页头的祈运 chip 走标签名（不是写死的词），且与产品名同一行',
  /class="ww-scope-row"[\s\S]{0,600}?class="ww-bless"[^>]*>偏「\{\{blessLabelText\}\}」/.test(wallWxml2) &&
    /\.ww-scope-row\s*\{[^}]*display:\s*flex/.test(wallWxssCode) &&
    /\.ww-scope-row\s*\{[^}]*justify-content:\s*space-between/.test(wallWxssCode)
)
check(
  '★ 祈运提示已从玩法区挪走（不留死结构：.ww-plays-guide 的 DOM 与样式都不许复活）',
  !/ww-plays-guide/.test(wallWxml2) && !/\.ww-plays-guide\s*\{/.test(wallWxssCode)
)
// 发送条位置：**按设计模式分支**（2026-09-19 产品口径变更：吸底 → 顺流，弹幕墙下方）。
//
// 为什么要分支而不是直接删掉旧判据：旧判据保护的是「吸底条被别的块盖住 / 盖住最后一张愿签」
// 这个失败模式。**顺流后它不再盖任何东西，该模式不存在**；但若日后有人改回 fixed，
// 旧判据必须自动复活 —— 写成裸删除就会留下假绿（本仓错题本 E7 那类）。
// 设计意图（原话见 index.wxss 的 .ww-composer 注释）：顺流时它落在 .ww-write 内部。
const composerPadY = Number((/\.ww-composer\s*\{[^}]*padding:\s*(\d+)rpx/.exec(wallWxssCode) || [])[1])
const composerInputH = Number((/\.ww-input\s*\{[^}]*height:\s*(\d+)rpx/.exec(wallWxssCode) || [])[1])
const pagePadBottom = Number((/\.ww-page\s*\{[^}]*padding:\s*0\s+[^;]*?calc\((\d+)rpx/.exec(wallWxssCode) || [])[1])
const composerInline = /\.ww-composer\s*\{[^}]*position:\s*static/.test(wallWxssCode)
const composerFixed = /\.ww-composer\s*\{[^}]*position:\s*fixed/.test(wallWxssCode)
// 顺流时**位置本身**也是设计要求（产品原话：「放在更醒目位置如弹幕墙下方」）——
// 必须被钉住，否则下次有人把它挪到页尾/页首，判据只会说「它是 static」而放过去。
check(
  '★ 顺流发送条的位置：在弹幕墙之后、玩法区之前（产品口径：弹幕墙下方），且只有一个',
  (() => {
    const wallIdx = wallWxml2.indexOf('class="ww-wall ')
    const composerIdx = wallWxml2.indexOf('class="ww-composer"')
    const playsIdx = wallWxml2.indexOf('class="ww-plays"')
    const composerCount = (wallWxml2.match(/class="ww-composer"/g) || []).length
    if (composerFixed) return true // 吸底时位置由 fixed 定位决定，本条不适用
    return wallIdx >= 0 && composerIdx > wallIdx && playsIdx > composerIdx && composerCount === 1
  })(),
  (() => {
    const w = wallWxml2.indexOf('class="ww-wall "')
    const c = wallWxml2.indexOf('class="ww-composer"')
    const p = wallWxml2.indexOf('class="ww-plays"')
    return `wall@${w} composer@${c} plays@${p}（要求 wall < composer < plays）`
  })()
)
check(
  '发送条位置与设计意图一致（顺流：static + 输入框 id 仍在 + 不再通栏铺底；若改回吸底：见下两条）',
  composerInline &&
    /id="wishInput"/.test(wallWxml2) &&
    composerInputH > 0 &&
    // ⚠️ 顺流时**不得**再要求「页面底部预留 ≥ 条高」—— 那条约束是为「fixed 条盖住内容」服务的，
    // 顺流后内容自己占位。若沿用旧约束（72 < 84）就会把正确的新设计判红（本轮实测踩过）。
    !/\.ww-composer\s*\{[^}]*position:\s*fixed/.test(wallWxssCode),
  `position=${composerInline ? 'static' : composerFixed ? 'fixed' : '未声明'} / 输入 ${composerInputH}rpx / 页面底部预留 ${pagePadBottom}rpx`
)
// 吸底专属不变量：只在**仍是 fixed** 时要求「底部预留 ≥ 条高」（顺流不需要，别硬留 180rpx）
check(
  '（吸底时）页面底部预留 ≥ 条高，否则最后一张愿签会被盖住',
  !composerFixed || (composerPadY > 0 && composerInputH > 0 && pagePadBottom >= composerInputH + composerPadY * 2),
  `position=${composerFixed ? 'fixed' : 'static（本条不适用）'} / 预留 ${pagePadBottom}rpx`
)
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
const isDirectChildOfPage = (innerMarker, ownClassPattern) => {
  const st = viewAncestorsAt(wallWxml2, innerMarker)
  return Array.isArray(st) && st.length >= 2 && /ww-page/.test(st[0]) && ownClassPattern.test(st[1])
}
// 顺流后发送条不再是覆盖层 —— 只有**仍是 fixed** 时才要求它是 .ww-page 直接子节点。
// 纸签弹层始终是 fixed 覆盖层，这一条对它**始终**成立（与设计变更无关）。
check(
  '★ fixed 覆盖层必须是 .ww-page 的直接子节点（纸签弹层；发送条仅在吸底设计下适用）—— "互相遮挡"的根因',
  isDirectChildOfPage('class="ww-sheet-overline"', /ww-sheet/) &&
    (!composerFixed || isDirectChildOfPage('class="ww-input"', /ww-composer/)),
  `composer(position=${composerFixed ? 'fixed' : 'static'}) 祖先=${JSON.stringify(viewAncestorsAt(wallWxml2, 'class="ww-input"'))} sheet 祖先=${JSON.stringify(viewAncestorsAt(wallWxml2, 'class="ww-sheet-overline"'))}`
)
// 层级可比性只在**两者都是覆盖层**（发送条吸底）时才要求；顺流时二者不重叠。
check(
  '（吸底时）纸签弹层须盖在发送条之上（弹层 41 > 发送条 30）',
  !composerFixed ||
    (() => {
      const sheetZ = Number((/\.ww-sheet\s*\{[^}]*z-index:\s*(\d+)/.exec(wallWxssCode) || [])[1])
      const barZ = Number((/\.ww-composer\s*\{[^}]*z-index:\s*(\d+)/.exec(wallWxssCode) || [])[1])
      return sheetZ > barZ && barZ > 0
    })(),
  `position=${composerFixed ? 'fixed' : 'static（本条不适用）'}`
)
check(
  '★ 遮罩在深色页面上压得动（浓度 ≥ 0.72；62% 在博物黑上实测"看不出被压暗"）',
  (() => {
    const alpha = Number((/\.ww-sheet-mask\s*\{[^}]*background:\s*rgba\([^)]*?([0-9.]+)\s*\)/.exec(wallWxssCode) || [])[1])
    return alpha >= 0.72
  })()
)
// 顺流时不铺底（不该出现一条通栏色带）；仍吸底时必须不透明（否则愿签透上来）。
check(
  '发送条底色与设计一致（顺流：透明无通栏底；吸底：不透明 var(--color-bg) + z-index 30）',
  composerFixed
    ? /\.ww-composer\s*\{[^}]*background:\s*var\(--color-bg\)/.test(wallWxssCode) &&
        !/\.ww-composer\s*\{[^}]*background:\s*rgba\(/.test(wallWxssCode) &&
        /\.ww-composer\s*\{[^}]*z-index:\s*30/.test(wallWxssCode)
    : /\.ww-composer\s*\{[^}]*background:\s*transparent/.test(wallWxssCode),
  `position=${composerFixed ? 'fixed' : 'static'}`
)
{
  const stub = installWxStub()
  const proto = loadPageConfig('miniprogram/subpackages/feature/wish-wall/index.js')
  const p = Object.assign(Object.create(null), proto)
  p.data = { plays: playList, productId: '', productKey: 'k', productTitle: '孔雀标本' }
  p.setData = function (patch) { Object.assign(this.data, patch) }
  p.applyBlessScope('success')
  check(
    '★ 祈运标签的中文名来自 SSOT（求成），页头才有的可显示',
    p.data.blessLabelText === '求成' && p.data.blessTags.join(',') === 'success',
    JSON.stringify({ label: p.data.blessLabelText, tags: p.data.blessTags })
  )
  p.applyBlessScope('')
  check('没有祈运标签时页头不显示那颗 chip（不留空标签）', p.data.blessLabelText === '')
  stub.restore()
}

/* ================================================================== *
 * 14)「连续记录云保存」注册钩子（2026-09-20）
 *
 * 产品逻辑：连灯天数与木鱼功德只存本地，换手机/清缓存即丢。
 * 钩子话术 = 「注册后连续记录存云端，不会丢，且断签前会提醒你」。
 *
 * 这一节钉四件事（每一条都对应一种"看起来做了、其实没做"的缺陷）：
 *   ① 门槛与判定是**纯函数**：连灯 ≥2 天 / 木鱼 ≥21 下才谈，否则就是骚扰；
 *   ② 开关 `showRitualProfile` 缺字段默认关，且**六处链路齐全** ——
 *      漏一处就是"超管在后台保存成功、但字段被静默重置"（本仓已发生过）；
 *   ③ 注册成功后**真的调 `syncToCloud()`** 并把结果如实告诉用户
 *      （只弹"成功"却什么都没存 = 空承诺，所以漏斗终点只在同步成功后上报）；
 *   ④ 三条降级（开关读失败 / 云存模块缺失 / 用户拒绝授权）都不得影响点灯与木鱼。
 * ================================================================== */
{
  const stub = installWxStub()
  const hookProto = loadPageConfig('miniprogram/subpackages/feature/wish-wall/index.js')
  // 钩子是 Promise 链（不阻塞主流程），测试要 await 一次宏任务才能观察结果
  const flushMacro = () => new Promise((r) => setTimeout(r, 0))

  const mkHookPage = (o) => {
    const opts = o || {}
    const page = Object.assign(Object.create(null), hookProto)
    page.data = Object.assign({
      allowed: true, flagChecked: true, productKey: 'wall1', productId: 'p1',
      showRegisterDialog: false, showRitualProfile: true,
      showRitualDialog: false, ritualGateDesc: '',
      lamp: { dayKey: '2026-09-20', lit: false, litAt: 0, line: '', streak: 0 },
      muyuCount: 0, soundOn: true, quota: { used: 0, left: 5, cap: 5, exhausted: false },
      viewMode: 'wall', danmakuCycle: 0, freshId: '', mine: { total: 0, visible: 0, hidden: 0 },
      mineRows: [], loadError: '', draft: '', posting: false
    }, opts.data || {})
    page.setData = function (patch) { Object.assign(this.data, patch) }
    page._ritualGateOffered = false
    page._soundPlayer = null
    page.pushEcho = () => null
    page.isGuestUser = () => Promise.resolve(opts.guest !== false)
    page.tracked = []
    page.trackRitualGate = function (step, extra) { this.tracked.push({ step, extra: extra || {} }) }
    return page
  }
  const stepsOf = (p) => p.tracked.map((t) => t.step).join(',')

  /* —— ① 纯函数：门槛 ——
     两个阈值都是"低于它就别谈"：1 天的灯与 3~5 下的木鱼都还没有会心疼的投入。 */
  eq('门槛：连灯 1 天不谈（还没有会心疼的记录）', hookProto.ritualGateProgress({ streak: 1, muyuCount: 0 }), '')
  eq('门槛：木鱼 20 下不谈（随手玩不算投入）', hookProto.ritualGateProgress({ streak: 0, muyuCount: 20 }), '')
  eq('门槛：连灯 2 天即谈（昨天来过 + 今天又来）', hookProto.ritualGateProgress({ streak: 2, muyuCount: 0 }), 'streak')
  eq('门槛：木鱼 21 下即谈', hookProto.ritualGateProgress({ streak: 0, muyuCount: 21 }), 'muyu')
  eq('门槛：两条都过时以连灯为准（文案更具体）', hookProto.ritualGateProgress({ streak: 3, muyuCount: 99 }), 'streak')
  eq('门槛：空状态不谈（不崩）', hookProto.ritualGateProgress(null), '')

  const okState = {
    allowed: true, flagOn: true, alreadyOffered: false,
    registerDialogOpen: false, isGuest: true, streak: 2, muyuCount: 0
  }
  check('判定：条件齐备时该谈', hookProto.shouldOfferRitualGate(okState) === true)
  check('★ 开关关着（缺省）不谈 —— 超管没显式开就不该有注册弹窗', hookProto.shouldOfferRitualGate({ ...okState, flagOn: false }) === false)
  check('墙没开放不谈', hookProto.shouldOfferRitualGate({ ...okState, allowed: false }) === false)
  check('已注册用户不谈（没有"注册后"这回事）', hookProto.shouldOfferRitualGate({ ...okState, isGuest: false }) === false)
  check('★ 一次访问只谈一次（否则连敲木鱼会弹到吐）', hookProto.shouldOfferRitualGate({ ...okState, alreadyOffered: true }) === false)
  check('★ 落愿注册门禁正开着时不抢同一个弹窗（主转化优先）', hookProto.shouldOfferRitualGate({ ...okState, registerDialogOpen: true }) === false)
  check('没有任何进展不谈', hookProto.shouldOfferRitualGate({ ...okState, streak: 1, muyuCount: 0 }) === false)
  // 预筛不变量：预筛（零成本）不得比正式判定**更宽**，否则木鱼连点会白问会话、甚至多弹
  const probeStates = [
    okState, { ...okState, streak: 1 }, { ...okState, flagOn: false }, { ...okState, allowed: false },
    { ...okState, isGuest: false }, { ...okState, registerDialogOpen: true }, { ...okState, alreadyOffered: true },
    { ...okState, streak: 0, muyuCount: 21 }
  ]
  check(
    '★ 预筛不变量：ritualGateProgress 判"没有进展"时，正式判定必须也为 false',
    probeStates.every((s) => hookProto.ritualGateProgress(s) !== '' || hookProto.shouldOfferRitualGate(s) === false)
  )
  check('文案报出真实连灯天数（不编数字）', hookProto.buildRitualGateDesc('streak', { streak: 3 }).indexOf('3 天') !== -1)
  check('文案报出真实木鱼功德', hookProto.buildRitualGateDesc('muyu', { muyuCount: 21 }).indexOf('21 下') !== -1)
  check(
    '★ 文案承诺的正是产品口径三件事（存云端 / 换手机还在 / 断签提醒），不是空话',
    ['存到云端', '换手机', '断签前'].every((k) => hookProto.buildRitualGateDesc('streak', { streak: 2 }).indexOf(k) !== -1),
    hookProto.buildRitualGateDesc('streak', { streak: 2 })
  )

  /* —— ② 行为：木鱼敲到门槛 → 弹一次；连敲不再弹 —— */
  {
    const p = mkHookPage({ data: { muyuCount: 20 } })
    p.onMuyuTap()
    await flushMacro()
    eq('★ 木鱼敲到第 21 下弹钩子', p.data.showRitualDialog, true)
    eq('★ 木鱼主功能不受影响（计数照常 +1）', p.data.muyuCount, 21)
    eq('埋点 show 只报一次，且带原因是"木鱼"', stepsOf(p) + '|' + JSON.stringify((p.tracked[0] || {}).extra), 'show|{"reason":"muyu"}')
    check('弹窗文案带真实功德数', String(p.data.ritualGateDesc).indexOf('21 下') !== -1, p.data.ritualGateDesc)
    p.setData({ showRitualDialog: false })
    p.onMuyuTap()
    await flushMacro()
    eq('★ 同一次访问里再敲不再弹（一次访问只谈一次）', p.data.showRitualDialog, false)
    eq('show 仍然只有一次', p.tracked.filter((t) => t.step === 'show').length, 1)
    eq('第二下木鱼照样计数（钩子不拦主功能）', p.data.muyuCount, 22)

    // ★ 开关真的能关：关掉后门槛满足也不弹 —— 这一条同时钉住"超管关得掉"与"降级不影响主功能"
    const offPage = mkHookPage({ data: { showRitualProfile: false, muyuCount: 21 } })
    offPage.onMuyuTap()
    await flushMacro()
    eq('★ 开关关着时不弹（超管关得掉）', offPage.data.showRitualDialog, false)
    eq('…且不报 show（报表里不该出现没曝光的曝光）', offPage.tracked.length, 0)
    eq('…但木鱼照常计数（降级不影响主功能）', offPage.data.muyuCount, 22)

    const regPage = mkHookPage({ guest: false, data: { muyuCount: 21 } })
    regPage.onMuyuTap()
    await flushMacro()
    eq('★ 已注册用户不弹（没有"注册后"这回事，不打扰老用户）', regPage.data.showRitualDialog, false)
  }

  /* —— ② 行为：点灯路径。只有"今天这一盏刚点亮"才评估；已亮的灯再点不评估 —— */
  {
    const store = new Map()
    globalThis.wx.getStorageSync = (k) => (store.has(k) ? store.get(k) : '')
    globalThis.wx.setStorageSync = (k, v) => { store.set(k, v) }
    // 昨天点过灯 → 今天再点就是连续第 2 天
    store.set('shanhai_wish_ritual_v1', { version: 1, days: { '2026-09-19': { litAt: 1 } } })
    const litPage = mkHookPage({ data: { lamp: { dayKey: '2026-09-20', lit: false, litAt: 0, line: '', streak: 0 } } })
    litPage.onLampTap()
    await flushMacro()
    eq('★ 连续第 2 天点亮 → 弹钩子（连灯进度刚变长的那一刻）', litPage.data.showRitualDialog, true)
    eq('★ 点灯主功能不受影响（当日已记点亮 + 天数算对）', `${litPage.data.lamp.lit}/${litPage.data.lamp.streak}`, 'true/2')
    const againPage = mkHookPage({ data: { lamp: { dayKey: '2026-09-20', lit: true, litAt: 1, line: 'x', streak: 3 } } })
    let assessed = 0
    againPage.maybeOfferRitualGate = () => { assessed += 1 }
    againPage.onLampTap()
    eq('★ 再点已亮的灯只是想再看一眼，不该被拦注册（不评估钩子）', assessed, 0)
  }

  /* —— ③ 行为：注册成功 → 真的同步上云 + 如实反馈 —— */
  {
    const okPage = mkHookPage({ data: { showRitualDialog: true } })
    okPage.syncRitualToCloud = () => Promise.resolve(true)
    await okPage.onRitualRegisterSuccess()
    eq('注册成功后弹窗关闭', okPage.data.showRitualDialog, false)
    eq('★ 同步成功才上报漏斗终点 resume_success', stepsOf(okPage), 'resume_success')
    eq('★ 同步成功如实告诉用户「已存到云端」', `${okPage.data.toastShow}/${okPage.data.toastTitle}`, 'true/已存到云端')
    check('…并说清存的是什么（连灯 + 功德）', /连灯/.test(okPage.data.toastDesc) && /功德/.test(okPage.data.toastDesc), okPage.data.toastDesc)

    const missPage = mkHookPage({})
    eq('★ 云存模块缺失时 syncRitualToCloud 返回 false 且不抛（降级）', await missPage.syncRitualToCloud(), false)
    await missPage.onRitualRegisterSuccess()
    eq('★ 同步失败走 fail_sync（不把"完成"记进漏斗）', stepsOf(missPage), 'fail_sync')
    eq('★ 同步失败说真话（记录仍在本机），不假装成功', missPage.data.toastTitle, '记录仍在本机')
    check('…并安抚"本地记录没有丢"', /本地记录没有丢/.test(missPage.data.toastDesc), missPage.data.toastDesc)

    const revokedPage = mkHookPage({ data: { showRitualProfile: false } })
    let synced = 0
    revokedPage.syncRitualToCloud = () => { synced += 1; return Promise.resolve(true) }
    await revokedPage.onRitualRegisterSuccess()
    eq('★ 开关在授权期间被关掉：不同步（不假装存上云）', synced, 0)
    eq('…并如实记 fail_flag_off', stepsOf(revokedPage), 'fail_flag_off')
    check('…并明确提示「暂未开放」', /暂未开放/.test(revokedPage.data.toastTitle), revokedPage.data.toastTitle)
  }

  /* —— ② 行为：CTA / dismiss / 拒绝授权 —— */
  {
    const d = mkHookPage({ data: { showRitualDialog: true, muyuCount: 7, lamp: { dayKey: '2026-09-20', lit: true, streak: 2 } } })
    d.onRitualDialogCta()
    d.onRitualDialogClose()
    eq('弹窗链路 step 齐（go_register / dismiss）', stepsOf(d), 'go_register,dismiss')
    eq('★「先存着」不动本地木鱼功德', d.data.muyuCount, 7)
    eq('★「先存着」不动本地连灯天数', d.data.lamp.streak, 2)
    eq('弹窗已关', d.data.showRitualDialog, false)
    const f = mkHookPage({})
    f.onRitualDialogFail({ detail: { reason: 'denied' } })
    eq('★ 用户拒绝授权：只记一笔，不打断主功能', stepsOf(f), 'fail_denied')
  }

  /* —— ④ 降级：钩子内部抛错，绝不影响木鱼 —— */
  {
    const boom = mkHookPage({ data: { muyuCount: 20 } })
    boom.evaluateRitualGate = () => { throw new Error('boom') }
    boom.onMuyuTap()
    await flushMacro()
    eq('★ 钩子抛错时木鱼照常计数（降级不得影响主功能）', boom.data.muyuCount, 21)
    eq('…且不弹窗', boom.data.showRitualDialog, false)
  }

  /* —— ② 降级：开关读失败 / 缺字段 → 按关处理；显式 true 才开 —— */
  {
    const noFlagPage = mkHookPage({ data: { allowed: false, showRitualProfile: false, muyuCount: 21 } })
    await noFlagPage.evaluateRitualGate()
    eq('★ 开关读取失败（allowed=false / showRitualProfile 缺省）时不弹', noFlagPage.data.showRitualDialog, false)

    const gatePage = mkHookPage({ data: { allowed: false, flagChecked: false, showRitualProfile: false } })
    gatePage.refresh = () => Promise.resolve()
    gatePage.fireEntryEgg = () => {}
    await gatePage.applyGate({ showMaShangYou: false })
    eq('★ 云函数回包缺 showRitualProfile → 按关处理', gatePage.data.showRitualProfile, false)
    await gatePage.applyGate({ showMaShangYou: false, showRitualProfile: true })
    eq('★ 显式 true 时开关才开（证明这个开关真的能开关）', gatePage.data.showRitualProfile, true)
    await gatePage.applyGate({ showMaShangYou: false, showRitualProfile: false })
    eq('★ 显式 false 时关回去（出事时一键关，无需发版）', gatePage.data.showRitualProfile, false)

    // ⚠️ 2026-09-20 补（子代理行为复核抓到）：**读成功就必须清掉"读失败"态**。
    // 原来的早退分支什么都不写，于是「首次读开关失败 → 点『再试一次』→ 这次读成功、但开关确实是关的」
    // 会命中早退直接 return：gateError 永远 true、loading 卡 true，页面继续显示
    // 「网络或权限异常，没读上馆方的开关」——**又一种把系统状态说成事实的假话**，
    // 而且正是本批改造声称要消灭的那一种。这条断言只认"读成功后的终态"，不认代码怎么写。
    const retryPage = mkHookPage({ data: { allowed: false, flagChecked: true, gateError: true, loading: true } })
    retryPage.refresh = () => { retryPage.refreshed = (retryPage.refreshed || 0) + 1; return Promise.resolve() }
    retryPage.fireEntryEgg = () => {}
    await retryPage.applyGate({ showMaShangYou: false }, { force: true })
    eq('★ 开关读成功（哪怕墙仍是关的）必须清掉「读失败」态与加载态', `${retryPage.data.gateError}/${retryPage.data.loading}`, 'false/false')
    eq('…且这一支一次内容请求都不发（关门不拉数据）', retryPage.refreshed || 0, 0)

    // 同一条的"开"分支：开关没变 + force → 必须**重拉内容**（下拉刷新的本意）
    const forcePage = mkHookPage({ data: { allowed: true, flagChecked: true, gateError: false, loading: false } })
    forcePage.refresh = () => { forcePage.refreshed = (forcePage.refreshed || 0) + 1; return Promise.resolve() }
    forcePage.fireEntryEgg = () => {}
    await forcePage.applyGate({ showMaShangYou: true }, { force: true })
    eq('★ 下拉刷新（force）在开关未变时仍必须重拉内容', forcePage.refreshed || 0, 1)
    const softPage = mkHookPage({ data: { allowed: true, flagChecked: true, gateError: false, loading: false } })
    softPage.refresh = () => { softPage.refreshed = (softPage.refreshed || 0) + 1; return Promise.resolve() }
    softPage.fireEntryEgg = () => {}
    await softPage.applyGate({ showMaShangYou: true })
    eq('…而非 force 的同值回包不重拉（保持进页控制流不变）', softPage.refreshed || 0, 0)
  }
  stub.restore()

  /* —— 静态：复用组件 / 真的调 syncToCloud / 双端登记 / 六处开关链路 —— */
  const hookPageSrc = readSrc('miniprogram/subpackages/feature/wish-wall/index.js')
  check(
    '钩子复用既有 RegisterAuthDialog（不另造弹窗），走 bind:cta → bind:success 同一条链',
    /show="\{\{showRitualDialog\}\}"/.test(wallWxml2) &&
      /bind:cta="onRitualDialogCta"/.test(wallWxml2) &&
      /bind:success="onRitualRegisterSuccess"/.test(wallWxml2) &&
      /bind:close="onRitualDialogClose"/.test(wallWxml2)
  )
  check(
    '★ 注册成功后真的调用 syncToCloud()（不是只弹个"成功"）',
    /this\.syncRitualToCloud\(\)/.test(hookPageSrc) &&
      /const ok = await this\.syncRitualToCloud\(\)/.test(hookPageSrc) &&
      /ritualProfile\.syncToCloud\(\)/.test(hookPageSrc)
  )
  check(
    '★★ 同步结果的判据按**真形态**取（utils/ritualProfile 返回的是对象，不是布尔）',
    // 2026-09-20 新增。为什么必须单独立一条：这条链路的**真值**此前从未被验过 ——
    // 所有单测都把 `page.syncRitualToCloud` 整个桩掉（返回 Promise.resolve(true)），
    // 源码级断言又只查"调用了 syncToCloud"。于是 `return ok === true` 判一个对象、
    // 恒为 false 这件事躲过了 851 条断言。真实后果三条：
    //   ① 用户即使同步成功，也被告知「记录仍在本机」（说假话）；
    //   ② `resume_success` 漏斗终点恒为 0（PRD §7 的注册转化率根本测不出来）；
    //   ③ `_certSyncedCount` 永不写入 → 每次 onHide/onUnload 重复写一次云。
    // 判据三件套：调用处按 `res.ok` 取；被调方的 JSDoc 确实声明对象；页面里不再有裸的 `=== true` 误判。
    /const res = await ritualProfile\.syncToCloud\(\)/.test(hookPageSrc) &&
      /if \(res && typeof res === 'object'\) return res\.ok === true/.test(hookPageSrc) &&
      /@returns \{Promise<\{ok:boolean, degraded:boolean/.test(readSrc('miniprogram/utils/ritualProfile.js')) &&
      !/const ok = await ritualProfile\.syncToCloud\(\)/.test(hookPageSrc)
  )
  check(
    '★ 动态 require + try/catch 降级（云存模块缺失不得让祈夆墙不可用）',
    /const ritualProfile = require\('\.\.\/\.\.\/\.\.\/utils\/ritualProfile'\)/.test(hookPageSrc) &&
      /catch \(e\) \{\s*\n\s*console\.warn\('wish wall ritual sync failed'/.test(hookPageSrc)
  )

  const flagClient = readSrc('miniprogram/utils/contentDisplayFlags.js')
  const flagFn = readSrc('miniprogram/cloudfunctions/getContentDisplayFlags/index.js')
  const mgrCfg = readSrc('miniprogram/subpackages/manager/manager/managerPageConfig.js')
  // 后台入口**只选店长端工作台**（与 showMaShangYou 同处，见交付说明）：
  // ERP 内容开关页维持原样（它用 cdnUpdate 局部更新，不携带该字段也不会抹掉它）
  const subv = readSrc('miniprogram/subpackages/manager/manager/workspace/_subviews.wxml')
  check('关闭提示函数（统一文案来源）已定义并导出', /function toastRitualProfileClosed\(/.test(flagClient) && /toastRitualProfileClosed\b/.test(flagClient.slice(flagClient.indexOf('module.exports'))))
  check(
    '★ 关闭提示函数不新增原生 wx.showToast（dialog-ratchet 只许降不许涨），把文案交给宿主展示',
    (() => {
      const i = flagClient.indexOf('function toastRitualProfileClosed')
      const body = i < 0 ? '' : flagClient.slice(i, flagClient.indexOf('\n}', i))
      return body.length > 0 && !/wx\.showToast/.test(body) && /CLOSED_RITUAL_PROFILE_TOAST/.test(body)
    })()
  )
  check(
    '★ 钩子结果反馈走 AppToast（原生 toast 棘轮下唯一合规通道）',
    /showAppToast\(\{/.test(hookPageSrc) &&
      /"app-toast": "\/components\/AppToast\/index"/.test(readSrc('miniprogram/subpackages/feature/wish-wall/index.json')) &&
      /<app-toast/.test(wallWxml2)
  )
  check('① 客户端 normalize 缺字段默认关（=== true）', /showRitualProfile: src\.showRitualProfile === true/.test(flagClient))
  check('★ 页面把开关作为判定输入（不看开关 = 超管关不掉）', /flagOn: this\.data\.showRitualProfile === true/.test(hookPageSrc))
  check('② 云函数 getDefaultFlags 缺省 false', /showRitualProfile: false/.test(flagFn))
  check('③ 云函数 normalizeFlags 同口径（=== true）', /showRitualProfile: src\.showRitualProfile === true/.test(flagFn))
  check('④ ★ 云函数 saveFlags 显式透传（漏了 = 后台保存成功但字段被静默丢）', /showRitualProfile: incoming\.showRitualProfile/.test(flagFn))
  check(
    '⑤ ★ 店长端工作台（tab16 开关面板）：有该行 + load 归一 + data 默认（缺一个就会被保存抹掉）',
    /data-field="showRitualProfile"/.test(subv) &&
      /showRitualProfile: flags\.showRitualProfile === true/.test(mgrCfg) &&
      /showRitualProfile: false,/.test(mgrCfg)
  )
  check(
    '埋点双端登记 + ERP FUNNELS 有卡（否则"埋了但报表看不到"）',
    /wish_ritual_gate:/.test(readSrc('miniprogram/utils/analytics/eventSchema.js')) &&
      /wish_ritual_gate:/.test(readSrc('admin/src/utils/analyticsSchema.js')) &&
      /key: 'wish_ritual_gate'/.test(readSrc('admin/src/utils/analyticsSchema.js')) &&
      /wish_ritual_gate:resume_success/.test(readSrc('admin/src/utils/analyticsSchema.js'))
  )
  check(
    '★ 小程序数据报表也算了这一块（云函数分桶 + 报表页卡片，否则恒 0/看不到）',
    /ritualGate: gateBlock\('wish_ritual_gate'\)/.test(readSrc('miniprogram/cloudfunctions/getAnalyticsDashboard/index.js')) &&
      /funnel\.wishWall\.ritualGate\.show/.test(subv)
  )
  check('漏斗 step 都从 trackRitualGate 一处发出（action 名只有一个事实源）', (hookPageSrc.match(/trackRitualGate\(/g) || []).length >= 6)

  /* —— ⑤ 「取」这一半：云端档案必须真的被拉回来（2026-09-20 自查发现的缺口）——
     此前只接了 `syncToCloud`（存），`loadFromCloud`（取）**只定义、只导出、没有任何页面调用**，
     于是「注册后记录不丢、换手机也在」只成立一半：云端有档案，新设备打开仍是 0。
     这一条钉住「页面确实调了它」+「降级时不动本地」。 */
  check(
    '★ 页面在 onLoad 里调 loadFromCloud（H1 钩子的「取」这一半，此前只接了「存」）',
    /loadFromCloud/.test(hookPageSrc) && /this\.restoreRitualFromCloud\(\)/.test(hookPageSrc)
  )
  check(
    '★ 恢复只在 ok===true 时刷新显示（失败/降级不得改动本地值）',
    /if \(!res \|\| res\.ok !== true\) return/.test(hookPageSrc)
  )
  // 真跑一遍：云存模块缺失 → 页面不该抛、也不该改动功德计数
  {
    const noMod = mkHookPage({ data: { muyuCount: 7 } })
    let threw = false
    try {
      await noMod.restoreRitualFromCloud()
    } catch (e) {
      threw = true
    }
    check('★ 云存模块缺失时 restoreRitualFromCloud 不抛、且功德计数不变（降级）', !threw && noMod.data.muyuCount === 7)
  }
}

/* ================================================================== *
 * 15) 创新钩子 H2「功德证」（2026-09-20）
 *
 * 产品口径（方案 `docs/创新钩子方案_2026-09-19.md` §H2）：木鱼功德攒到**里程点**时，
 * 在木鱼按钮附近出现一个「领证」次级入口；领证要身份（复用 RegisterAuthDialog），
 * 领到的证**可保管（本地存档）、可回看**，并与「连续记录云保存」共用同一份云端持久化。
 *
 * 这一节钉五件事（每一条都对应一种"看起来做了、其实没做"的缺陷）：
 *   ① 里程点判定是**纯函数**、阈值只有一处常量，且**写明"口径待产品确认"**（不许猜成定稿）；
 *   ② 开关 `showMuyuCertificate` 缺字段默认关，且**五处链路齐全**（漏一处就被静默重置）；
 *   ③ **写放大防护**：木鱼可连点，`onMuyuTap` 一次云端写都不许有；只在离开页面/退出时上报；
 *   ④ 注册成功后**真的调 `syncToCloud()`**，且只有成功才说「已存到云端」（失败说真话）；
 *   ⑤ 证书文字**只有计数与日期**（合规：不涉命理改运），且埋点双端登记 + 数据报表有分桶。
 * ================================================================== */
{
  const cert = loadCjs('miniprogram/utils/muyuCertificate.js', { require: markerRequire })
  const certSrc = readSrc('miniprogram/utils/muyuCertificate.js')
  // wx 桩要**先**挂：下面既有本地存档的 round-trip，也有页面行为断言
  const stub = installWxStub()

  /* —— ① 纯函数：里程点判定（阈值 = 一处常量，且口径待确认）—— */
  eq('里程点常量按方案建议 100/500/1000（改口径只改这一行）', cert.CERT_MILESTONES.join('/'), '100/500/1000')
  check(
    '★ 常量旁写明「口径待产品确认」并指出方案出处（不许把猜测当定稿）',
    /口径待产品确认/.test(certSrc) && /创新钩子方案_2026-09-19/.test(certSrc) && /CERT_MILESTONES/.test(certSrc)
  )
  eq('99 下没有证', cert.milestonesReached(99).length, 0)
  eq('100 下正好第一档', cert.milestonesReached(100).join('/'), '100')
  eq('1000 下三档都在（到达几档有几档，不是只有一张）', cert.milestonesReached(1000).join('/'), '100/500/1000')
  eq('下一档：99 → 100', cert.nextMilestone(99), 100)
  eq('下一档：100 → 500', cert.nextMilestone(100), 500)
  eq('★ 封顶后没有下一档（返回 null，不编一个更大的数诱导继续敲）', cert.nextMilestone(1000), null)
  eq('负数按 0（不崩、不报证）', cert.milestonesReached(-5).length, 0)
  eq('非数字按 0（不崩）', cert.nextMilestone('abc'), 100)
  eq('100 未领 → 可领 100', cert.nextUnclaimed(100, {}), 100)
  eq('100 已领 → 无可领（下一档还没到）', cert.nextUnclaimed(100, { 100: {} }), null)
  eq('600 已领 100 → 可领 500', cert.nextUnclaimed(600, { 100: {} }), 500)
  eq('600 已领 100/500 → 无可领', cert.nextUnclaimed(600, { 100: {}, 500: {} }), null)
  eq('回看档 = 已领最高档', cert.highestClaimed({ 100: {}, 500: {} }), 500)
  eq('没领过 → 回看档 null（不凭空给一张证）', cert.highestClaimed({}), null)

  /* —— ① 纯函数：持证记录（幂等 / 无副作用 / 归一脏数据）—— */
  const rec0 = cert.emptyRecord()
  const rec1 = cert.claimMilestone(rec0, 100, '2026-09-20', 137)
  eq('领证记录写入档位', rec1.claimed['100'].milestone, 100)
  eq('★ 证书只记计数与日期：领取日期落进记录', rec1.claimed['100'].dayKey, '2026-09-20')
  eq('…并记下领取那一刻的真实功德数', rec1.claimed['100'].muyuCount, 137)
  check('★ 纯函数：不改传入的记录（可断言、无副作用）', !rec0.claimed['100'])
  eq('★ 幂等：重复领同一档不会改掉首次领取日期', cert.claimMilestone(rec1, 100, '2026-09-21', 200).claimed['100'].dayKey, '2026-09-20')
  check('非法档位（42）写不进记录（造不出假证）', !cert.claimMilestone(rec1, 42, '2026-09-20', 42).claimed['42'])
  const dirty = cert.normalizeRecord({ claimed: { 100: {}, 42: {}, x: null, 500: 'nope' } })
  check(
    '★ 归一脏存档：合法档保留、非法键/坏值丢掉（手改 storage 也不崩、不造假证）',
    !!dirty.claimed['100'] && !dirty.claimed['42'] && !dirty.claimed['500']
  )
  const certView = cert.buildCertificate({ milestone: 100, muyuCount: 137, dayKey: '2026-09-20' })
  check(
    '★ 证书视图模型只有 档位/计数/日期 三个字段（不多带不该说的）',
    !!certView && Object.keys(certView).sort().join(',') === 'dayKey,milestone,muyuCount'
  )
  eq('没有档位就没有证（不拿空数据凑一张假证）', cert.buildCertificate({}), null)

  /* —— ⑤ 合规：对外文案只写计数与日期 —— */
  const outwardText = [
    cert.CERT_OVERLINE, cert.CERT_TITLE, cert.CERT_NOTE,
    cert.buildCertDesc(100, 137),
    cert.buildEntryText('claim', 100).tag, cert.buildEntryText('claim', 100).action,
    cert.buildEntryText('view', 500).tag, cert.buildEntryText('view', 500).action
  ].join('|')
  check(
    '★ 合规：对外文案不出现运势/改运/应验/发财/保佑这类承诺词（只写计数与日期）',
    !/运势|改运|改命|应验|发财|保佑|加持|灵验/.test(outwardText),
    outwardText
  )
  check('★ 门禁文案报出真实里程点与真实计数（不编数字）', /100/.test(cert.buildCertDesc(100, 137)) && /137/.test(cert.buildCertDesc(100, 137)), cert.buildCertDesc(100, 137))

  /* —— ① 本地存档：round-trip + 失败静默 —— */
  const certStore = new Map()
  const prevGet = globalThis.wx.getStorageSync
  const prevSet = globalThis.wx.setStorageSync
  globalThis.wx.getStorageSync = (k) => (certStore.has(k) ? certStore.get(k) : '')
  globalThis.wx.setStorageSync = (k, v) => { certStore.set(k, v) }
  eq('写入本地存档返回 true', cert.writeRecord(rec1), true)
  eq('★ 存档 round-trip：关掉小程序再打开，证还在（"可保管"的兑现）', cert.readRecord().claimed['100'].dayKey, '2026-09-20')
  globalThis.wx.getStorageSync = () => { throw new Error('storage down') }
  eq('★ 存储读失败 → 空记录，绝不抛（降级不得影响主功能）', cert.readRecord().claimed['100'], undefined)
  globalThis.wx.getStorageSync = prevGet
  globalThis.wx.setStorageSync = prevSet

  /* —— ③ 行为：木鱼连点 300 下，一次云端写都不许有 —— */
  const certProto = loadPageConfig('miniprogram/subpackages/feature/wish-wall/index.js')
  const flushMacro15 = () => new Promise((r) => setTimeout(r, 0))
  const stepsOfCert = (p) => p.tracked.map((t) => t.step).join(',')
  const claim100 = cert.claimMilestone(cert.emptyRecord(), 100, '2026-09-19', 100)

  const mkCertPage = (o) => {
    const opts = o || {}
    const page = Object.assign(Object.create(null), certProto)
    page.data = Object.assign({
      allowed: true, flagChecked: true, productKey: 'wall1', productId: 'p1',
      showRegisterDialog: false, showRitualProfile: false,
      showMuyuCertificate: true, showCertDialog: false, certGateDesc: '',
      certEntry: null, certCard: null, certNote: cert.CERT_NOTE,
      lamp: { dayKey: '2026-09-20', lit: false, litAt: 0, line: '', streak: 0 },
      muyuCount: 0, soundOn: true, quota: { used: 0, left: 5, cap: 5, exhausted: false },
      viewMode: 'wall', danmakuCycle: 0, freshId: '', mine: { total: 0, visible: 0, hidden: 0 },
      mineRows: [], loadError: '', draft: '', posting: false
    }, opts.data || {})
    page.setData = function (patch) { Object.assign(this.data, patch) }
    page._soundPlayer = null
    page._certRecord = opts.record || cert.emptyRecord()
    page._certBacked = opts.backed === true
    page._certSyncedCount = opts.syncedCount === undefined ? null : opts.syncedCount
    page._certShownKey = ''
    page._certReportInFlight = false
    page._pendingCertMilestone = 0
    page.pushEcho = () => null
    page.isGuestUser = () => Promise.resolve(opts.guest !== false)
    page.syncCalls = 0
    page.syncRitualToCloud = function () { this.syncCalls += 1; return Promise.resolve(opts.syncOk !== false) }
    page.tracked = []
    page.trackCertGate = function (step, extra) { this.tracked.push({ step, extra: extra || {} }) }
    return page
  }

  {
    const spam = mkCertPage({ data: { muyuCount: 0 }, syncedCount: 0 })
    for (let i = 0; i < 300; i += 1) spam.onMuyuTap()
    await flushMacro15()
    eq('★ 木鱼连点 300 下：云端写入 0 次（方案点名的头号风险 = 写放大）', spam.syncCalls, 0)
    eq('计数照常 +300（钩子不拦主功能）', spam.data.muyuCount, 300)
    eq('★ 到里程点出现「领证」次级入口（不是弹窗、不拦截）', spam.data.certEntry && spam.data.certEntry.mode, 'claim')
    eq('入口报出真实里程点', spam.data.certEntry.milestone, 100)
    eq('入口不是注册弹窗', spam.data.showCertDialog, false)
    eq('★ 入口曝光 show 只报一次（连点不会把曝光分母刷成点击数）', spam.tracked.filter((t) => t.step === 'show').length, 1)
  }

  /* —— 互斥：同一页两个注册门禁不许叠（H2 方案点名的骚扰风险）—— */
  check(
    '★ 互斥：领证门禁开着时，连灯云存钩子不抢同一个弹窗',
    certProto.shouldOfferRitualGate({
      allowed: true, flagOn: true, alreadyOffered: false, registerDialogOpen: false,
      certDialogOpen: true, isGuest: true, streak: 2
    }) === false
  )
  {
    const busyPage = mkCertPage({ guest: true, data: { muyuCount: 100, showRitualDialog: true } })
    busyPage.refreshCertEntry()
    await busyPage.onCertEntryTap()
    eq('★ 互斥：已有注册弹窗时不叠第二个领证门禁', busyPage.data.showCertDialog, false)
    eq('…也没有把"待领档"记下来（不会误发一张用户没要的证）', busyPage._pendingCertMilestone, 0)
  }

  /* —— ④ 行为：未注册 → 门禁 → 注册成功 → 真的同步上云 + 如实反馈 —— */
  const storeB = new Map()
  globalThis.wx.getStorageSync = (k) => (storeB.has(k) ? storeB.get(k) : '')
  globalThis.wx.setStorageSync = (k, v) => { storeB.set(k, v) }
  const guestPage = mkCertPage({ guest: true, data: { muyuCount: 100 }, syncedCount: 0 })
  guestPage.refreshCertEntry()
  eq('入口曝光 step=show', stepsOfCert(guestPage), 'show')
  await guestPage.onCertEntryTap()
  eq('★ 未注册用户点「领证」→ 弹注册门禁（领证要身份）', guestPage.data.showCertDialog, true)
  check('门禁文案报出真实里程点', /100/.test(guestPage.data.certGateDesc), guestPage.data.certGateDesc)
  eq('★ 未注册时一次都不写云端（守住"存云端是注册的兑现"）', guestPage.syncCalls, 0)
  guestPage.onCertDialogCta()
  eq('CTA 只记一笔 go_register', stepsOfCert(guestPage), 'show,go_register')
  await guestPage.onCertRegisterSuccess()
  eq('★ 注册成功后**真的**同步上云（调用链执行到了）', guestPage.syncCalls, 1)
  eq('★ 只有同步成功才上报漏斗终点 resume_success', stepsOfCert(guestPage), 'show,go_register,resume_success')
  eq('★ 只有成功才说「已存到云端」（不假装）', guestPage.data.toastTitle, '已存到云端')
  eq('★ 本地真的记下了这张证，日期取上海日键', guestPage._certRecord.claimed['100'].dayKey, wish.shanghaiDayKey(Date.now()))
  eq('★ 领证后就地看得到证（可回看）', guestPage.data.certCard && guestPage.data.certCard.milestone, 100)
  eq('★ 领完这一档入口变成「回看」（不再重复领）', guestPage.data.certEntry.mode, 'view')
  check(
    '★ 本地存档真的落盘（"可保管"不是空话）',
    !!storeB.get(cert.CERT_STORAGE_KEY) && !!storeB.get(cert.CERT_STORAGE_KEY).claimed['100']
  )

  {
    const failPage = mkCertPage({ guest: true, syncOk: false, data: { muyuCount: 100 }, syncedCount: 0 })
    failPage.refreshCertEntry()
    await failPage.onCertEntryTap()
    failPage.onCertDialogCta()
    await failPage.onCertRegisterSuccess()
    eq('★ 同步失败走 fail_sync（不把"完成"记进漏斗）', stepsOfCert(failPage), 'show,go_register,fail_sync')
    eq('★ 同步失败说真话「记录仍在本机」（绝不假装成功）', failPage.data.toastTitle, '记录仍在本机')
    check('…但本地证照发不丢（不假装，也不吞掉用户的证）', !!failPage._certRecord.claimed['100'])
  }

  {
    const regPage = mkCertPage({ guest: false, data: { muyuCount: 100 }, syncedCount: 0 })
    regPage.refreshCertEntry()
    eq('入口曝光 show 上报一次', stepsOfCert(regPage), 'show')
    await regPage.onCertEntryTap()
    eq('★ 已注册用户点「领证」不弹注册门禁（老用户不被重复打扰）', regPage.data.showCertDialog, false)
    eq('已注册用户领证也真的同步上云', regPage.syncCalls, 1)
    eq('★ 已注册路径也落在同一漏斗终点（领取数算得出来）', stepsOfCert(regPage), 'show,resume_success')
  }

  {
    const viewPage = mkCertPage({ data: { muyuCount: 300 }, record: claim100, backed: true, syncedCount: 300 })
    viewPage.refreshCertEntry()
    eq('领过 100、还没到 500 → 入口是「回看」', viewPage.data.certEntry.mode, 'view')
    eq('回看档案位 = 已领最高档', viewPage.data.certEntry.milestone, 100)
    await viewPage.onCertEntryTap()
    eq('★ 回看是纯本地展开（不联网、不问身份）', viewPage.syncCalls, 0)
    eq('★ 回看到的日期是领取那天的日期，不是今天', viewPage.data.certCard.dayKey, '2026-09-19')
    viewPage.closeCertCard()
    eq('收起后不再渲染那张证', viewPage.data.certCard, null)
  }

  /* —— ② 开关：缺字段按关、显式 true 才开、一键关时把入口与证一起收 —— */
  {
    const gateOn = mkCertPage({ data: { allowed: true, flagChecked: true, showMuyuCertificate: false, muyuCount: 150 } })
    gateOn.refresh = () => Promise.resolve()
    gateOn.fireEntryEgg = () => {}
    gateOn.refreshCertEntry()
    eq('★ 开关关着时入口不出现（超管没显式开就不放）', gateOn.data.certEntry, null)
    await gateOn.reportCertProgress()
    eq('…开关关着时也不上报', gateOn.syncCalls, 0)
    await gateOn.applyGate({ showMaShangYou: true })
    eq('云函数回包缺 showMuyuCertificate → 按关处理', gateOn.data.showMuyuCertificate, false)
    await gateOn.applyGate({ showMaShangYou: true, showMuyuCertificate: true })
    eq('★ 显式 true 时开关才开（证明这个开关真的能开关）', gateOn.data.showMuyuCertificate, true)
    eq('…并立刻按新开关重算入口（150 下、未领过 → 可领第一档）', gateOn.data.certEntry && gateOn.data.certEntry.mode, 'claim')
    gateOn.setData({ certCard: { milestone: 100, muyuCount: 150, dayKey: '2026-09-19' } })
    await gateOn.applyGate({ showMaShangYou: true, showMuyuCertificate: false })
    eq('★ 显式 false 时关回去（出事一键关，无需发版）', gateOn.data.showMuyuCertificate, false)
    eq('…入口收起', gateOn.data.certEntry, null)
    eq('…已展开的证也一起收（还留一张在屏幕上等于没关）', gateOn.data.certCard, null)
  }

  /* —— ③ 行为：只在离开页面/退出时上报，且有脏标记与在途闸 —— */
  {
    const exitPage = mkCertPage({ data: { muyuCount: 150 }, record: claim100, backed: true, syncedCount: null })
    exitPage.onHide()
    await flushMacro15()
    eq('★ 离开页面才上报一次（绝不逐次写）', exitPage.syncCalls, 1)
    eq('同步成功后记住已同步的计数', exitPage._certSyncedCount, 150)
    exitPage.onHide()
    await flushMacro15()
    eq('★ 计数没变就不重复写（脏标记）', exitPage.syncCalls, 1)
    exitPage.onMuyuTap()
    exitPage.onHide()
    await flushMacro15()
    eq('又敲了一下再离开 → 再写一次（只写有变化的那次）', exitPage.syncCalls, 2)

    const bothPage = mkCertPage({ data: { muyuCount: 150 }, record: claim100, backed: true, syncedCount: null })
    bothPage.onHide()
    bothPage.onUnload()
    await flushMacro15()
    eq('★ onHide + onUnload 连击只写一次（在途闸）', bothPage.syncCalls, 1)

    const guestExit = mkCertPage({ data: { muyuCount: 150 }, backed: false })
    guestExit.onHide()
    await flushMacro15()
    eq('★ 未领证（未注册）用户离开也不写云端', guestExit.syncCalls, 0)
  }
  globalThis.wx.getStorageSync = prevGet
  globalThis.wx.setStorageSync = prevSet
  stub.restore()

  /* —— 静态：复用组件 / 源码级写放大判据 / 五处开关链路 / 双端埋点 —— */
  const certPageSrc = readSrc('miniprogram/subpackages/feature/wish-wall/index.js')
  const certFlagClient = readSrc('miniprogram/utils/contentDisplayFlags.js')
  const certFlagFn = readSrc('miniprogram/cloudfunctions/getContentDisplayFlags/index.js')
  const certMgrCfg = readSrc('miniprogram/subpackages/manager/manager/managerPageConfig.js')
  const certSubv = readSrc('miniprogram/subpackages/manager/manager/workspace/_subviews.wxml')
  check(
    '★ onMuyuTap 体内不含任何云端写入/上报调用（写放大防护的源码判据）',
    (() => {
      const i = certPageSrc.indexOf('  onMuyuTap() {')
      const j = i < 0 ? -1 : certPageSrc.indexOf('\n  },', i)
      const body = i < 0 || j < 0 ? '' : certPageSrc.slice(i, j)
      return body.length > 0 && !/callFunction|syncToCloud|syncRitualToCloud|reportCertProgress/.test(body)
    })()
  )
  check(
    '★ 功德上报只在「离开页面 / 退出」两处被调（onHide / onUnload）',
    (certPageSrc.match(/reportCertProgress\(/g) || []).length === 3,
    String((certPageSrc.match(/reportCertProgress\(/g) || []).length)
  )
  check(
    '领证复用既有 RegisterAuthDialog（不另造弹窗），走 cta→success 同一条链',
    /show="\{\{showCertDialog\}\}"/.test(wallWxml2) &&
      /bind:cta="onCertDialogCta"/.test(wallWxml2) &&
      /bind:success="onCertRegisterSuccess"/.test(wallWxml2) &&
      /bind:close="onCertDialogClose"/.test(wallWxml2)
  )
  check(
    '★ 领证路径也真的调 syncRitualToCloud()（不是只弹个"成功"）',
    (certPageSrc.match(/await this\.syncRitualToCloud\(\)/g) || []).length >= 2 &&
      /ritualProfile\.syncToCloud\(\)/.test(certPageSrc)
  )
  check(
    '★ 证书文案单一来源（wxml 用模块的 {{certNote}}，不写死对外承诺文案）',
    /\{\{certNote\}\}/.test(wallWxml2) && /CERT_NOTE/.test(certSrc)
  )
  check(
    '★ 次级入口挂的是 catchtap/bindtap 的入口方法，且不在木鱼卡内部（不与主仪式并列）',
    /class="ww-cert-entry"[\s\S]{0,200}bindtap="onCertEntryTap"/.test(wallWxml2)
  )
  check('★ 页面把开关作为判定输入（不看开关 = 超管关不掉）', /flagOn: this\.data\.showMuyuCertificate === true/.test(certPageSrc))
  check('① 客户端 normalize 缺字段默认关（=== true）', /showMuyuCertificate: src\.showMuyuCertificate === true/.test(certFlagClient))
  check('② 云函数 getDefaultFlags 缺省 false', /showMuyuCertificate: false/.test(certFlagFn))
  check('③ 云函数 normalizeFlags 同口径（=== true）', /showMuyuCertificate: src\.showMuyuCertificate === true/.test(certFlagFn))
  check('④ ★ 云函数 saveFlags 显式透传（漏了 = 后台保存成功但字段被静默丢）', /showMuyuCertificate: incoming\.showMuyuCertificate/.test(certFlagFn))
  check(
    '⑤ ★ 店长端工作台（tab16 开关面板）：有该行 + load 归一 + data 默认（缺一个就会被保存抹掉）',
    /data-field="showMuyuCertificate"/.test(certSubv) &&
      /showMuyuCertificate: flags\.showMuyuCertificate === true/.test(certMgrCfg) &&
      /showMuyuCertificate: false,/.test(certMgrCfg)
  )
  check(
    '埋点双端登记 + ERP FUNNELS 有卡（否则"埋了但报表看不到"）',
    /muyu_cert_gate:/.test(readSrc('miniprogram/utils/analytics/eventSchema.js')) &&
      /muyu_cert_gate:/.test(readSrc('admin/src/utils/analyticsSchema.js')) &&
      /key: 'muyu_cert_gate'/.test(readSrc('admin/src/utils/analyticsSchema.js')) &&
      /muyu_cert_gate:resume_success/.test(readSrc('admin/src/utils/analyticsSchema.js'))
  )
  check(
    '★ 小程序数据报表也算了这一块（云函数分桶 + 报表页卡片，否则恒 0/看不到）',
    /certGate: gateBlock\('muyu_cert_gate'\)/.test(readSrc('miniprogram/cloudfunctions/getAnalyticsDashboard/index.js')) &&
      /funnel\.wishWall\.certGate\.show/.test(certSubv)
  )
  check('漏斗 step 都从 trackCertGate 一处发出（action 名只有一个事实源）', (certPageSrc.match(/trackCertGate\(/g) || []).length >= 6)
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
    'fresh-timer-leak',             // wish-wall/index.js：onUnload 结构已变
    'card-not-dialog',              // wxml：.ww-card 属性序已变
    'handwriting-dropped',          // wxss：手写体栈改为 var(--font-hand) 接线
    'product-field-not-allowlisted',// manageProducts：白名单数组已重构
    'bless-guide-dom-dropped',      // wxml：ww-plays-guide 已下线
    'reco-dom-dropped',             // wxml：ww-play-reco 已重构
    'reco-label-hardcoded',         // blessProducts.js：文案已改
    'composer-fixed-again',         // wxss：.ww-composer 注释/属性序已变（顺流改造）
    'sheet-identity-dropped',       // wxml：.ww-sheet-mask 属性序已变
    'product-path-split-again'      // wxml：产品链路已合并为一条主路
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
  for (const name of Object.keys(INJECTIONS)) {
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
{
  const stub = installWxStub()
  const wwPage = loadCjs('miniprogram/utils/wishWall.js', { require: markerRequire })
  const store = new Map()
  globalThis.wx.setStorageSync = (k, v) => { store.set(k, v) }
  globalThis.wx.pageScrollTo = () => {}
  const proto = loadPageConfig('miniprogram/subpackages/feature/wish-wall/index.js')
  const mkPage = (over) => {
    const page = Object.assign(Object.create(null), proto)
    page.data = Object.assign({
      allowed: true, flagChecked: true, productKey: 'wall1', productId: 'p1', productTitle: '孔雀标本',
      plays: playList, playResult: null, playPending: '', playNeed: null, draft: '',
      echoRows: [], soundOn: false, muyuCount: 0, lamp: { dayKey: '', lit: false, streak: 0 },
      quota: { used: 0, left: 5, cap: 5, exhausted: false, unknown: false },
      mine: { total: 0, visible: 0, hidden: 0 }, mineRows: [], rows: [],
      tagColumns: [], items: [], freshId: '', danmakuCycle: 0, loadError: ''
    }, over || {})
    page.setData = function (patch) { Object.assign(this.data, patch) }
    page._soundPlayer = { play() { return true }, destroy() {} }
    page._echoSeq = 0
    page.showAppToast = function (o) { this.data.toastTitle = (o && o.title) || '' }
    return page
  }

  /* ① 灵感词：点完必须**聚焦**（这条链路从前"点了像没反应"），定时器必须有句柄 */
  {
    const p = mkPage()
    p.useInspiration({ currentTarget: { dataset: { text: '马上有风' } } })
    check('…且聚焦定时器**有句柄**（旧实现是匿名 setTimeout，卸页后仍会 setData）', !!p._focusTimer)
    // 聚焦是**延时**落下的（60ms，与真机键盘顶起同一手法），所以要等定时器跑完再断言
    await new Promise((r) => setTimeout(r, 140))
    eq('★ 点灵感词要落到输入框焦点上（只改 draft 不聚焦 = 真机「点了像没反应」）',
      `${p.data.draft}/${p.data.inputFocus}`, '马上有风/true')
    // 再排一个"待触发"的定时器，验证 onUnload 清句柄 + 卸载后不再 setData
    p.data.inputFocus = false
    p.focusWishInput(60)
    check('（前置）确实排上了一个待触发的定时器', !!p._focusTimer)
    p.onUnload()
    eq('★ onUnload 必须清掉聚焦定时器', p._focusTimer, null)
    await new Promise((r) => setTimeout(r, 120))
    eq('…且卸载后回调不再 setData（_unloaded 闸兜底）', p.data.inputFocus, false)
  }

  /* ② 抽签等待态：await 期间落 pending，拿到结果必须清掉 */
  {
    const p = mkPage()
    let release = null
    p.loadPlayProfile = () => new Promise((res) => { release = res })
    const running = p.onPlayTap({ currentTarget: { dataset: { id: 'zodiac' } } })
    await Promise.resolve()
    eq('★ 星座签要读资料：等待期间瓦片必须落 pending 态（否则点上去零反馈）', p.data.playPending, 'zodiac')
    release({ zodiac: 'aries', mbti: '' })
    await running
    eq('…拿到结果后 pending 必须清掉（漏清 = 瓦片永久卡在「摇签中」）', p.data.playPending, '')
  }

  /* ③ 玩法失败必须**说出来**并记一笔（此前静默 return，点瓦片毫无反应） */
  check(
    '★ 玩法非 need_profile 的失败要给出反馈并留在漏斗里（原来静默 return）',
    // ⚠️ 判据必须锚**行首的调用**，不能只 grep `showAppToast(` ——
    // 第一版写成后者，注入把调用改成 `void 0 && this.showAppToast(` 之后**字符串还在**，
    // 正则照样命中，自检就报"注入未被检出"（判据自己放水）。
    /if \(result\.reason === 'need_profile'\)[\s\S]{0,700}?\n        this\.showAppToast\(\{/.test(readSrc('miniprogram/subpackages/feature/wish-wall/index.js')) &&
      /trackBehavior\('wish_wall_play', 'fail', id\)/.test(readSrc('miniprogram/subpackages/feature/wish-wall/index.js'))
  )

  /* ④ 跨天 onShow 必须重算灯态（否则新的一天点不亮） */
  {
    const p = mkPage({ lamp: { dayKey: '2000-01-01', lit: false, streak: 0 } })
    let inited = 0
    p.initRitual = () => { inited += 1 }
    p.scheduleDanmakuCycle = () => {}
    p.onShow()
    eq('★ 跨天回到页面必须重算灯态（否则今天点不亮灯）', inited, 1)
    const p2 = mkPage({ lamp: { dayKey: wwPage.shanghaiDayKey(Date.now()), lit: true, streak: 1 } })
    let inited2 = 0
    p2.initRitual = () => { inited2 += 1 }
    p2.scheduleDanmakuCycle = () => {}
    p2.onShow()
    eq('…同一天不重算（不白跑一遍）', inited2, 0)
  }

  /* ⑤ 落愿后的乐观插入必须同步墙条数（空墙第一条时否则显示「0 条心愿正在墙上流动」） */
  {
    const p = mkPage({ draft: '马上有风', _wallItems: [] })
    p.isGuestUser = async () => false
    p.callFn = async () => ({ success: true, _id: 'new1', nickname: '我' })
    p.refresh = async () => { throw new Error('列表回包失败（正是这条不变量最该成立的时候）') }
    p.applyView = () => {}
    p.scheduleDanmakuCycle = () => {}
    p.scheduleFreshClear = () => {}
    p.pushEcho = () => {}
    await p.submitWish()
    eq('★ 落愿后墙条数必须与墙上数据一致（哪怕随后的列表回包失败）',
      p.data.wallCount, (p._wallItems || []).length)
  }

  /* ⑥ 门禁读失败 → 额度未知：UI 不许沿用默认的"还可写 5 条" */
  {
    const p = mkPage({ quota: { used: 2, left: 3, cap: 5, exhausted: false } })
    p.callFn = async () => { throw new Error('mine 读取失败') }
    await p.loadMine()
    eq('★ mine 读取失败要标记额度未知（默认值"还可写 5 条"可能是假的）', p.data.quota.unknown, true)
    eq('…且不许把已读到的 left 重置成默认值', p.data.quota.left, 3)
    check('WXML 有 unknown 专述分支（不沿用事实句）', /quota\.unknown/.test(readSrc('miniprogram/subpackages/feature/wish-wall/index.wxml')))
  }

  stub.restore()
}

/* ================================================================== *
 * 动效专项（2026-09-20 第三批）
 *
 * 为什么单独立判据：动效的失效方式**全是静默的** —— 颜色跑出令牌、等待态把文字一起压暗、
 * 五颗粒子同时起跳，页面照样渲染、单测照样绿，只有在真机上"看着不对"。
 * ------------------------------------------------------------------ */
{
  // 去注释再判：说明段里**故意写着**被删掉的旧色值（#E0A9A0 / #C7B4DE），
  // 直接正则会被自己的注释判红（本仓老坑：守卫读到自己那段解释）。
  const animCss = wallWxssCode.replace(/\/\*[\s\S]*?\*\//g, '')

  check(
    '★ 点灯余烬的颜色必须全在铜色令牌内（旧版有粉 #E0A9A0 / 紫 #C7B4DE 两个离群色）',
    (() => {
      const blocks = (animCss.match(/\.ww-heart[^{]*\{[^}]*\}/g) || [])
      if (blocks.length < 6) return false // 基类 + h1..h5
      return blocks.every((b) => {
        const m = /color:\s*([^;}]+)/.exec(b)
        return !m || /var\(--brass-\d00\)/.test(m[1])
      })
    })(),
    (animCss.match(/\.ww-heart[^{]*\{[^}]*\}/g) || []).filter((b) => {
      const m = /color:\s*([^;}]+)/.exec(b)
      return m && !/var\(--brass-\d00\)/.test(m[1])
    }).join(' | ')
  )

  check(
    '★ 点灯余烬的起跳时刻必须逐个错开（5 颗同时起跳 = 一次闪现，不是"余烬"）',
    (() => {
      // ⚠️ 必须用 matchAll 取**捕获组**：`String.match` 带 /g 只回整条匹配，
      // 把整条规则里的数字全剥出来会得到一串垃圾（第一版就是这样，判据恒假）。
      const delays = [...animCss.matchAll(/\.ww-heart\.h([1-5])\b[^}]*animation-delay:\s*([0-9.]+)s/g)]
        .map((m) => Number(m[2]))
      return delays.length === 5 && delays.every((d, i) => (i === 0 ? d === 0 : d > delays[i - 1]))
    })()
  )

  check(
    '★ 摇签中只呼吸**边框**、不压暗文字（动效不该牺牲可读性）',
    /@keyframes ww-play-pending\s*\{[\s\S]{0,240}?border-color/.test(animCss) &&
      !/@keyframes ww-play-pending\s*\{[\s\S]{0,240}?opacity/.test(animCss)
  )
}

/* ================================================================== *
 * 离线版式预览工具自身的静态防线（2026-09-20 补，起因是子代理的两条发现）
 *
 * 为什么单独立这一节：本轮改造里改动最大、却**一条守卫都没有**的是
 * `miniprogram/scripts/render-wall-preview.mjs`（601 行改动）+ 新增的
 * `scripts/lib/wxml-preview.mjs`（230 行）。`grep -rn "render-wall-preview" guards/ package.json`
 * 零命中 ——「109 条全绿」对这两个文件不构成任何证据。
 * 它们需要本机 Chrome，不能进 check:admin（本仓既有口径）；但**不依赖 Chrome 的那部分**
 * 完全可以静态守住，而且正是最容易出事的那部分：
 *   ① 自检**不许写真源码**（旧实现写进真源码再 finally 还原；子代理实测抓到
 *      `index.wxss` 末尾残留 `.ww-wall { height: 900px !important; }` —— 一个 !important
 *      覆盖留在要发版的样式表里，SIGKILL/超时下 finally 根本跑不到）；
 *   ② 自检的**注入锚点**不许悄悄失效（锚点没了 = 子进程抛错 = 判据"看着通过"，本仓的老坑）；
 *   ③ 判据本身不许被无声删掉（旧预览的两条吸底判据就是这样"过期 → 报假失败 → 被整条删除"的）。
 * ------------------------------------------------------------------ */
{
  const previewSrc = readSrc('miniprogram/scripts/render-wall-preview.mjs')
  const previewWxml = readSrc('miniprogram/subpackages/feature/wish-wall/index.wxml')

  check(
    '★ 预览自检**只写 .tmp 副本**，真源码一个字节都不许被写（旧实现会残留 !important 覆盖）',
    /const REAL_WXSS = resolve\(/.test(previewSrc) &&
      /const REAL_WXML = resolve\(/.test(previewSrc) &&
      /process\.env\.WALL_PREVIEW_WXSS \|\| REAL_WXSS/.test(previewSrc) &&
      /process\.env\.WALL_PREVIEW_WXML \|\| REAL_WXML/.test(previewSrc) &&
      /WALL_PREVIEW_WXSS: wxssCopy/.test(previewSrc) &&
      /WALL_PREVIEW_WXML: wxmlCopy/.test(previewSrc) &&
      // 真源码路径只许出现"读"，不许出现在 writeFileSync 里
      !/writeFileSync\(REAL_WXSS/.test(previewSrc) &&
      !/writeFileSync\(REAL_WXML/.test(previewSrc) &&
      // 并且自检结尾要**断言**真源码未变（不是靠 finally 的自觉）
      /readFileSync\(REAL_WXSS, 'utf8'\) === baseWxss/.test(previewSrc)
  )

  check(
    '★ 预览自检的 WXML 注入锚点必须还在真源码里，且**不许有注入残留**（锚点失效/残留 = 假绿或假页面）',
    (() => {
      const block = (/const INJECTS = \[([\s\S]*?)\n  \]/.exec(previewSrc) || [])[1] || ''
      if (!block) return false
      const chunks = block.split(/\{\s*\n?\s*(?:\/\/[^\n]*\n\s*)*name:/).slice(1)
      const pairs = []
      for (const c of chunks) {
        if (!/file: 'wxml'/.test(c)) continue
        const f = /from: '((?:[^'\\]|\\.)*)'/.exec(c)
        const t = /to: '((?:[^'\\]|\\.)*)'/.exec(c)
        if (f) pairs.push([f[1].replace(/\\'/g, "'"), t ? t[1].replace(/\\'/g, "'") : ''])
      }
      // 至少 3 条 WXML 锚点（reco 占位 / 骨架撤回 / 次瓦片无字标）；
      // from 必须在、to **必须不在** —— 「to 在真源码里」意味着自检被中断后**注入残留在真源码**
      // （2026-09-20 实测发生过一次：`--selftest` 被杀，真 WXML 里留的是注入后的 `wx:if`）。
      return pairs.length >= 3 &&
        pairs.every(([f]) => previewWxml.includes(f)) &&
        pairs.every(([, t]) => !t || !previewWxml.includes(t))
    })()
  )

  // 这条判据是"同类错误第三次发生"逼出来的（本仓错题本的原话：同类错误第二次发生必须补守卫）：
  // MEASURE_JS 与 HTML 都是**巨大的模板字符串**，在里面写一个反引号就会截断它，
  // 症状只是运行时报一个离得很远的 SyntaxError。三次里有一次就发生在我自己写的修复注释里。
  const previewSyntax = await (async () => {
    const { spawnSync } = await import('node:child_process')
    const r = spawnSync(process.execPath, ['--check', resolve(ROOT, 'miniprogram/scripts/render-wall-preview.mjs')], { encoding: 'utf8' })
    return { ok: r.status === 0, err: String(r.stderr || '').split('\n').filter((l) => l.includes('SyntaxError')).join(' ') }
  })()
  check(
    '★ 预览脚本必须能通过 node --check（注释里的反引号会截断它内部的模板字符串）',
    previewSyntax.ok,
    previewSyntax.err
  )

  check(
    '★ 预览的关键判据不许被无声删除，且不许把「看门狗」降级成「报告」',
    // 四条：灵感词同屏 / 推荐取件占位 / 次瓦片无字标 / 吸底预留（按设计分支）；
    // 外加两条本轮自查发现的退化点：非 --check 时静默 exit 0、.tmp 不自建导致新 clone ENOENT。
    // ⚠️ 负向判据必须先**去注释**再测 —— 否则它会读到自己那段"原来写的是 …"的说明（本仓的老坑）。
    (() => {
      const code = previewSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
      return /灵感词与发送条不在同一屏/.test(code) &&
        /取件中：产品行已占位/.test(code) &&
        /次瓦片无字标/.test(code) &&
        /发送条改回吸底但没有底部预留/.test(code) &&
        !/process\.exit\(CHECK_ONLY \? 1 : 0\)/.test(code) &&
        /版式不变量违反[\s\S]{0,600}?process\.exit\(1\)/.test(code) &&
        /mkdirSync\(TMP_DIR, \{ recursive: true \}\)/.test(code)
    })()
  )
}

console.log(`\n需求 28 行为断言：通过 ${passed} / ${passed + failed}`)
if (failed) {
  failures.forEach((f) => console.error('  ✗ ' + f))
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ 需求 28 全链路断言通过（集合只读 / 服务端昵称 / 频控与长度 / 状态可见性 / 开关闸门 / 弹幕布局 / AI 基础内容 / 进页彩蛋 / 点灯仪式 / 全站拓展预留）')
