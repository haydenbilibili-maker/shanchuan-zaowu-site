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
import { readFileSync, readdirSync, statSync } from 'node:fs'
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
  // 墙面丢掉信任信号
  'dm-mark-dropped': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: 'class="ww-dm-mark {{item.pinned ? \'is-pinned\' : (item.official ? \'is-official\' : \'\')}}"',
    to: 'class="ww-dm-plain"'
  },
  // 刚落愿不再高亮
  'no-fresh-highlight': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: "class=\"ww-tag {{item.isFresh ? 'is-fresh' : ''}}\"",
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
  // 笺丢掉对话框语义
  'card-not-dialog': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxml',
    from: '      aria-role="dialog"\n',
    to: ''
  },
  // 弹幕不再用手写体
  'handwriting-dropped': {
    file: 'miniprogram/subpackages/feature/wish-wall/index.wxss',
    from: '  font-family: var(--font-hand);\n  font-size: 28rpx;',
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
  }
}

const INJECT = String(process.env.WISH_WALL_INJECT || '').trim()
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

const wish = loadCjs('miniprogram/utils/wishWall.js')

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
 * 造 16 条（4 轨 × 4 条）压满每条轨道，逐对断言
 *   「下一条进场时刻 ≥ 上一条进场时刻 + 上一条尾部离开右边缘所需时间」。
 */
const laneStress = wish.buildDanmakuRows(
  Array.from({ length: 16 }, (_, i) => ({ _id: 's' + i, text: '马上有' + '愿'.repeat(i % 7) }))
)
eq('压满 4 条轨道 × 4 条', laneStress.length, 16)
const overlaps = []
for (let lane = 0; lane < wish.LANES; lane += 1) {
  const inLane = laneStress.filter((r) => r.lane === lane)
  eq(`轨道 ${lane} 分到 4 条`, inLane.length, 4)
  for (let i = 1; i < inLane.length; i += 1) {
    const prev = inLane[i - 1]
    const cur = inLane[i]
    if (cur.delayMs < prev.delayMs + prev.clearMs) {
      overlaps.push(`${lane}:${prev.text}→${cur.text}(${cur.delayMs}<${prev.delayMs + prev.clearMs})`)
    }
  }
}
eq('★ 同轨相邻两条不重叠（16 条压满轨道）', overlaps.join(' | '), '')
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
  '公开列表带 source（C 端据此标「馆方」）',
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
check('读开关失败时保守关闭', /catch \(e\) \{[\s\S]{0,200}allowed: false, flagChecked: true, loading: false/.test(wallPageSrc))

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

const memberScanSrc = readSrc('miniprogram/subpackages/manager/utils/memberScan.js')
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
const ritual = loadCjs('miniprogram/utils/wishRitual.js')

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
check('作用域取自路由参数（不是写死 mashangyou）', /normalizeProductKey\(opts\.productKey\)/.test(wallPageSrc))
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
check('轨道刻度与 topPercent 对齐（四条写死）', (wallWxss.match(/\.ww-wall-rail\.rail-\d/g) || []).length === wish.LANES)
check('★ 轨道刻度是左侧短刻度，不是整条横线（整条像表格线且压文字）', /\.ww-wall-rail\s*\{[^}]*width:\s*26rpx/.test(wallWxss) && !/\.ww-wall-rail\s*\{[^}]*right:\s*20rpx/.test(wallWxss))
check('入口箭头改为 CSS 折角（不再用字符 ›）', !/›/.test(entryWxml) && /\.wish-wall-entry-chevron\s*\{[^}]*border-right/.test(readSrc('miniprogram/components/WishWallEntry/index.wxss')))
check('弹幕舞台高度固定（布局不随内容抖动）', /\.ww-wall\s*\{[^}]*height:\s*380rpx/.test(wallWxss))

/* ------------------------------------------------------------------ *
 * 4d) 对标全站（2026-09-16）：逐项对齐站点基线与同族页
 * ------------------------------------------------------------------ */

const wallWxssCode = stripCssComments(wallWxss)
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
check('★ 弹幕用手写体（心愿是"写"上去的）', /\.ww-danmaku\s*\{[^}]*font-family:\s*var\(--font-hand\)/.test(wallWxssCode))
check('★ 愿签正文也用手写体', /\.ww-tag-text\s*\{[^}]*font-family:\s*var\(--font-hand\)/.test(wallWxssCode))
check('★ 弹幕字号提到 28rpx（手写体笔画细，移动中要认得出）', /\.ww-danmaku\s*\{[^}]*font-size:\s*28rpx/.test(wallWxssCode))

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
  '组件观察 brand/desc（否则宿主覆盖不生效）',
  !!(entryComponentOptions && entryComponentOptions.observers && entryComponentOptions.observers['enabled, product, brand, desc'])
)
check('组件属性默认留空 = 按墙自动', /brand: \{ type: String, value: '' \}/.test(entrySrc))
check('wxml 用解析后的文案（不再直接用 props）', /\{\{brandText\}\}/.test(entryWxml) && /\{\{descText\}\}/.test(entryWxml))


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
    '★ 墙上有置顶/馆方标记（信任信号进入墙面）',
    /class="ww-dm-mark \{\{item\.pinned/.test(wxml) && /\.ww-dm-mark\.is-pinned/.test(wxss)
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
      /class="ww-tag \{\{item\.isFresh \? 'is-fresh' : ''\}\}"/.test(wxml)
  )
  check('选中态的分段控件仍走黄铜 token', /var\(--brass-300\) 0%, var\(--brass-400\) 48%, var\(--brass-500\) 100%/.test(wxss))
  check(
    '笺纸材料层不盖内容（绝对定位的材料必须让内容显式抬层）',
    /\.ww-card-over,[\s\S]{0,80}?\.ww-card-acts \{[\s\S]{0,80}?z-index: 1/.test(wxss) && /\.ww-card-fiber/.test(wxss)
  )
  check('心愿笺有对话框语义', /aria-role="dialog"/.test(wxml))
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

if (process.argv.includes('--selftest') && !INJECT) {
  const { spawnSync } = await import('node:child_process')
  let bad = 0
  for (const name of Object.keys(INJECTIONS)) {
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
  console.log(`\n✓ selftest 通过：${Object.keys(INJECTIONS).length} 个回归注入全部被检出，且无假阳性`)
  process.exit(0)
}

console.log(`\n需求 28 行为断言：通过 ${passed} / ${passed + failed}`)
if (failed) {
  failures.forEach((f) => console.error('  ✗ ' + f))
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ 需求 28 全链路断言通过（集合只读 / 服务端昵称 / 频控与长度 / 状态可见性 / 开关闸门 / 弹幕布局 / AI 基础内容 / 进页彩蛋 / 点灯仪式 / 全站拓展预留）')
