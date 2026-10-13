#!/usr/bin/env node
/**
 * 弹层视觉规范守卫（docs/弹层视觉规范_2026-10-13.md，产品负责人 2026-10-13 点名）
 *
 * 钉三件事：
 *   ① 全局零件在场：app.wxss 定义 --pop-* 令牌与 ui-pop-* 零件，零件不用回弹缓动（C7 §5.2）、有 reduced-motion 分支；
 *   ② 已迁移弹层不回退：MIGRATED 里每个「wx:if 开关」所在的遮罩挂 ui-pop-mask，其牌面挂 ui-pop-sheet / ui-pop-dialog；
 *   ③' openAppModal（utils/appModal.js，与 wx.showModal 同入参）沙箱实跑：组件宿主 / 当前页宿主 / 无宿主兜底 / 红色确认 → danger / 回调同形；
 *   ③'' openAppModal 回调里不得调用要求「用户点击手势」的接口（openSetting / requestSubscribeMessage / 订阅授权 …）：
 *       AppModal 的回调由 Promise 异步触发，不算手势 → 这类弹窗必须保留 wx.showModal（起因：giftVoice「去设置」）；
 *   ③ 自写遮罩棘轮：C 端 wxss 里「全屏 fixed + 自带底色」的规则按文件计数，只许减少（新文件必须 0）——
 *      新弹层一律用 ui-pop-mask，不再各写一个遮罩色。
 *
 * 用法：node miniprogram/scripts/check-pop-spec.mjs [--selftest] [--print-baseline] [--tighten]
 *   --tighten：把 MASK_BASELINE 收紧到实测值（只降不升、清掉归零项），迁移一处后跑一次
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')

/** 已迁移的弹层：[wxml, wx:if 开关变量, 'mask' = 只验遮罩（海报 / 360° 这类仪式卡没有牌面，直接是图）] */
export const MIGRATED = [
  ['pages/cart/index.wxml', 'showCouponModal'],
  ['pages/user/index.wxml', 'showQrModal'],
  ['pages/user/index.wxml', 'showGroupModal'],
  ['pages/user/index.wxml', 'showStatisticsModal'],
  ['pages/user/index.wxml', 'showLevelUp'],
  ['pages/user/index.wxml', 'showBirthdayCard'],
  ['subpackages/business/confirm-order/index.wxml', 'showCouponModal'],
  ['subpackages/business/confirm-order/index.wxml', 'showCareNotice'],
  ['subpackages/business/confirm-order/index.wxml', 'showSpecimenNotice'],
  ['subpackages/business/address/index.wxml', 'showManualForm'],
  ['subpackages/feature/detail/index.wxml', 'showSkuSheet'],
  ['subpackages/feature/detail/index.wxml', 'showCouponSheet'],
  ['subpackages/feature/detail/index.wxml', 'showRefundSheet'],
  ['subpackages/feature/detail/index.wxml', 'showPosterModal', 'mask'],
  ['subpackages/feature/detail/index.wxml', 'show360Modal', 'mask'],
  ['subpackages/feature/identify/index.wxml', 'busy', 'mask'],
  ['subpackages/feature/identify/result/index.wxml', 'showFeedback'],
  ['subpackages/feature/identify/result/index.wxml', 'unlockSheet.show'],
  ['subpackages/feature/collection/index.wxml', 'unlockSheet.show'],
  ['subpackages/feature/collection/detail/index.wxml', 'justUnlocked'],
  ['components/MemberLevelModal/index.wxml', 'visible'],
  ['subpackages/feature/components/RegisterAuthDialog/index.wxml', 'show'],
  ['subpackages/business/components/WalletPanelCoupons/index.wxml', 'showUseSheet'],
  ['subpackages/business/components/WalletPanelCoupons/index.wxml', 'showPassModal'],
  ['subpackages/business/components/WalletPanelPoints/index.wxml', 'showQrModal'],
  ['subpackages/business/components/WalletPanelPoints/index.wxml', 'showExchangeConfirm'],
  ['subpackages/feature/gift/claim-sheet/index.wxml', 'show'],
  ['subpackages/feature/gift/phone-sheet/index.wxml', 'show'],
  ['subpackages/feature/gift/proxy-address-sheet/index.wxml', 'show'],
  ['subpackages/content/live/watch/index.wxml', 'showShelf'],
  ['subpackages/content/live/watch/index.wxml', 'showSkuSheet'],
  // —— 第 3 批 b（2026-10-13）：员工 / 管理端开始迁移；员工端自此纳入 MASK_BASELINE 棘轮 ——
  ['subpackages/extra/approvals/index.wxml', 'showRevokeModal'],
  ['subpackages/extra/inventory-ops/index.wxml', 'showPaste'],
  ['subpackages/extra/inventory-ops/index.wxml', 'showRawForm'],
  ['subpackages/extra/purchase-ops/index.wxml', 'showSyncPanel'],
  ['subpackages/extra/purchase-ops/index.wxml', 'showForm'],
  ['subpackages/extra/shipment-ops/index.wxml', 'showDetail'],
  // —— 第 3 批 c（2026-10-13）：`.ss-*` 组的 6 个抽屉（定义在 sku.wxss，出货页用）——
  ['subpackages/extra/shipment-ops/index.wxml', 'memoBox.show'],
  ['subpackages/extra/shipment-ops/index.wxml', 'memoDetail.show'],
  ['subpackages/extra/shipment-ops/index.wxml', 'skuPicker.show'],
  ['subpackages/extra/shipment-ops/index.wxml', 'skuEdit.show'],
  ['subpackages/extra/shipment-ops/index.wxml', 'picker.show'],
  ['subpackages/extra/shipment-ops/index.wxml', 'libForm.show'],
  // —— 第 3 批 d（2026-10-13）：员工端现场核销 / 查证的 5 个结果弹层 ——
  ['subpackages/extra/staff/field/index.wxml', 'showMemberPassResult'],
  ['subpackages/extra/staff/field/index.wxml', 'showCouponRedeemResult'],
  ['subpackages/extra/staff/field/index.wxml', 'showBookingVerifyResult'],
  ['subpackages/extra/staff/field/index.wxml', 'showPickupConfirm'],
  ['subpackages/extra/staff/field/index.wxml', 'showPickupVerifyResult']
  ,
  // —— 第 3 批 e（2026-10-13）：会员 CRM 的详情抽屉 + 3 个确认框 ——
  ['subpackages/extra/member-crm/index.wxml', 'showDetail'],
  ['subpackages/extra/member-crm/index.wxml', 'showYouxin'],
  ['subpackages/extra/member-crm/index.wxml', 'showCancelMember'],
  ['subpackages/extra/member-crm/index.wxml', 'showAdjust'],
  // —— 第 3 批 f（2026-10-13）：与审批同型的 .mask/.modal 页 ——
  ['subpackages/extra/staff-permissions/index.wxml', 'showStaffModal'],
  ['subpackages/manager/payslip/index.wxml', 'showDetail'],
  ['subpackages/manager/payslip/admin/index.wxml', 'showEditor'],
  ['subpackages/manager/invoice-requests/index.wxml', 'showIssueModal'],
  ['subpackages/manager/invoice-requests/index.wxml', 'showRejectModal'],
  ['subpackages/extra/honorary-curators/index.wxml', 'showAddModal'],
  ['subpackages/extra/honorary-curators/index.wxml', 'showRemoveModal'],
  ['subpackages/extra/member-level-adjust/index.wxml', 'showAdjustModal'],
  ['subpackages/extra/member-level-adjust/index.wxml', 'showClearModal'],
  // —— 第 3 批 g（2026-10-13）：工作台 _subviews 的 18 个底部抽屉（共用一条 .modal-mask）——
  ['subpackages/manager/manager/workspace/_subviews.wxml', 'showMemberPassResult'],
  ['subpackages/manager/manager/workspace/_subviews.wxml', 'showPetQuoteModal'],
  ['subpackages/manager/manager/workspace/_subviews.wxml', 'showRevenueModal'],
  ['subpackages/manager/manager/workspace/_subviews.wxml', 'showBannerModal'],
  ['subpackages/manager/manager/workspace/_subviews.wxml', 'showProductModal'],
  ['subpackages/manager/manager/workspace/_subviews.wxml', 'showFramerModal'],
  ['subpackages/manager/manager/workspace/_subviews.wxml', 'showFramerBindSheet'],
  ['subpackages/manager/manager/workspace/_subviews.wxml', 'showCustomConfigModal'],
  ['subpackages/manager/manager/workspace/_subviews.wxml', 'showActivityModal'],
  ['subpackages/manager/manager/workspace/_subviews.wxml', 'showCatLinkModal'],
  ['subpackages/manager/manager/workspace/_subviews.wxml', 'showRewardModal'],
  ['subpackages/manager/manager/workspace/_subviews.wxml', 'showVipModal'],
  ['subpackages/manager/manager/workspace/_subviews.wxml', 'showShipModal'],
  ['subpackages/manager/manager/workspace/_subviews.wxml', 'showContentModal'],
  ['subpackages/manager/manager/workspace/_subviews.wxml', 'showCareGuideModal'],
  ['subpackages/manager/manager/workspace/_subviews.wxml', 'showPushConfirm'],
  ['subpackages/manager/manager/workspace/_subviews.wxml', 'showStoreEditModal'],
  ['subpackages/manager/manager/workspace/_subviews.wxml', 'showTicketReplyModal'],
  ['subpackages/manager/manager/workspace/petMemorialSheet.wxml', 'petSheet.show'],
  // —— 第 3 批 g-2a（2026-10-13）：7 组平级遮罩+抽屉 ——
  ['subpackages/extra/artisan-commission/index.wxml', 'showArtisanSheet'],
  ['subpackages/extra/live/broadcast/index.wxml', 'showShelfPicker'],
  ['subpackages/extra/property-cost/index.wxml', 'showForm'],
  ['subpackages/extra/shareholder-config/index.wxml', 'showForm'],
  ['subpackages/extra/shipment-edit/index.wxml', 'picker.show'],
  ['subpackages/manager/studio-bills/index.wxml', 'creating'],
  ['subpackages/manager/studio-bills/index.wxml', 'showDetail'],
  ['subpackages/manager/identify-monitor/index.wxml', 'detail']
]

/** 自写遮罩棘轮基线（按文件，只许减少；迁移一处就把数字改小）—— 用 `--tighten` 收紧 */
export const MASK_BASELINE = {
  'subpackages/b2bdesk/desk-common.wxss': 1,
  'subpackages/extra/artisan/works/index.wxss': 1,
  'subpackages/extra/user/achievements/index.wxss': 2,
  'subpackages/extra/user/invoice-request/index.wxss': 1,
  'subpackages/extra/user/support/index.wxss': 1,
  'subpackages/manager/gift-ops/index.wxss': 1,
  'subpackages/manager/manager/hubNav.wxss': 1,
  'subpackages/manager/store-points/index.wxss': 1
}

/**
 * **真·非弹层**的例外（逐条带理由）：固定定位但没有牌面 / 不是弹层的整页态。
 * 与 MASK_BASELINE 同一纪律：条目必须一直有对应的自写遮罩，否则 `--tighten` 清掉它。
 */
export const NON_POPUP = {
  'subpackages/extra/user/messages/index.wxss': {
    '.letter-page': '整页信纸视图（固定定位的**页面态**，不是弹层，没有牌面与遮罩语义）',
  },
  'subpackages/manager/manager/index.wxss': {
    '.verify-success-modal': '核销成功全屏**过场动画舞台**（按类切换的时序动画，无交互、无牌面；是否并进仪式卡另议）',
  },
}

/** 不计入：祈福墙 / 心愿签（另一流的纸感语言，自带设计语言） */
const OUT_OF_SCOPE = /^(subpackages\/feature\/wish-wall\/|subpackages\/feature\/components\/WallFeed\/|subpackages\/feature\/wish-labels\/)/
const SKIP_DIRS = new Set(['node_modules', 'cloudfunctions', 'scripts', 'docs', 'minitest'])

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (SKIP_DIRS.has(n)) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.wxss')) out.push(relative(MP, p))
  }
  return out
}

/** 全屏 fixed + 带底色的规则（吸底栏这类非全屏不算；--pop-* 令牌底色不算） */
export function ownMasks(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const hits = []
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim()
    const body = m[2]
    if (!/position\s*:\s*fixed/.test(body)) continue
    const full = /inset\s*:\s*0/.test(body) ||
      (/\btop\s*:\s*0/.test(body) && /\bbottom\s*:\s*0/.test(body)) ||
      (/\btop\s*:\s*0/.test(body) && /height\s*:\s*100(%|vh)/.test(body))
    const bg = (body.match(/background(?:-color)?\s*:\s*([^;]+)/) || [])[1] || ''
    if (!full || !/rgba?\(|#[0-9a-fA-F]{3}/.test(bg) || /var\(--pop-/.test(bg)) continue
    hits.push(sel)
  }
  return hits
}

const openTag = (src, i) => {
  let j = i
  let q = null
  while (j < src.length) {
    const c = src[j]
    if (q) { if (c === q) q = null } else if (c === '"' || c === "'") q = c
    else if (c === '>') break
    j += 1
  }
  return src.slice(i, j + 1)
}

function walkJs(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (SKIP_DIRS.has(n)) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walkJs(p, out)
    else if (p.endsWith('.js')) out.push(relative(MP, p))
  }
  return out
}

/** 从 openAppModal 后的 "(" 起取到配对的 ")"（跳过字符串与行注释） */
function callBody(src, open) {
  let d = 0
  let q = null
  for (let k = open; k < src.length; k += 1) {
    const c = src[k]
    if (q) { if (c === '\\') k += 1; else if (c === q) q = null; continue }
    if (c === '"' || c === "'" || c === '`') q = c
    else if (c === '/' && src[k + 1] === '/') { const e = src.indexOf('\n', k); k = e < 0 ? src.length : e }
    else if (c === '(' || c === '{' || c === '[') d += 1
    else if (c === ')' || c === '}' || c === ']') { d -= 1; if (d === 0) return src.slice(open, k + 1) }
  }
  return src.slice(open)
}

export function run(read = (f) => readFileSync(join(MP, f), 'utf8'), files = null, jsFiles = null) {
  const fails = []
  const app = read('app.wxss')
  for (const t of ['--pop-mask:', '--pop-mask-deep:', '--pop-surface:', '--pop-hairline:', '--pop-radius-dialog:', '--pop-radius-sheet:', '--dur-base:', '--ease-out-soft:']) {
    if (!app.includes(t)) fails.push(`app.wxss 缺弹层令牌 ${t.slice(0, -1)}`)
  }
  for (const c of ['ui-pop-mask', 'ui-pop-dialog', 'ui-pop-sheet', 'ui-pop-grip', 'ui-pop-head', 'ui-pop-kicker', 'ui-pop-title', 'ui-pop-close', 'ui-pop-foot', 'ui-pop-btn', 'ui-pop-row', 'ui-pop-radio']) {
    if (!new RegExp(`\\n\\.${c}\\s*\\{`).test(app)) fails.push(`app.wxss 缺零件 .${c}`)
  }
  const block = (app.match(/\/\* =+ 弹层[\s\S]*?@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\}\s*\}/) || [''])[0]
  if (!block) fails.push('app.wxss 弹层段缺 prefers-reduced-motion 分支')
  if (/cubic-bezier\(0\.175, 0\.885/.test(block)) fails.push('弹层零件用了回弹缓动（C7 §5.2 禁止）')
  if (!/\.ui-pop-mask\s*\{[^}]*background:\s*var\(--pop-mask\)/.test(block)) fails.push('.ui-pop-mask 底色不是 var(--pop-mask)')

  for (const [wxml, flag, only] of MIGRATED) {
    const src = read(wxml)
    const at = src.search(new RegExp(`<view\\b[^>]*wx:if="\\{\\{${flag}\\}\\}"`))
    if (at < 0) { fails.push(`${wxml}：找不到 wx:if="{{${flag}}}" 的弹层`); continue }
    const mask = openTag(src, at)
    if (!/class="[^"]*\bui-pop-mask\b/.test(mask)) fails.push(`${wxml}（${flag}）：遮罩没挂 ui-pop-mask`)
    if (only === 'mask') continue
    // 牌面在遮罩后的前 3 个 view 里（会员码弹层第一个子 view 是拦截点击的透明挡板）
    let pos = at + mask.length
    let found = false
    for (let k = 0; k < 3 && !found; k += 1) {
      const next = src.indexOf('<view', pos)
      if (next < 0) break
      const tag = openTag(src, next)
      found = /class="[^"]*\bui-pop-(sheet|dialog)\b/.test(tag)
      pos = next + tag.length
    }
    if (!found) fails.push(`${wxml}（${flag}）：牌面没挂 ui-pop-sheet / ui-pop-dialog`)
  }

  // ③' openAppModal 行为：沙箱执行真源码（CommonJS），thenable 同步回调
  try {
    const calls = []
    const hostOf = (tag) => ({ open: (o) => { calls.push([tag, o]); return { then: (cb) => cb({ confirm: true, cancel: false }) } } })
    let pageHost = null
    const mod = { exports: {} }
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'wx', 'getCurrentPages', read('utils/appModal.js'))(
      mod, mod.exports, { showModal: (o) => calls.push(['native', o]) }, () => [{ selectComponent: () => pageHost }])
    const { openAppModal } = mod.exports
    if (typeof openAppModal !== 'function') fails.push('utils/appModal.js 未导出 openAppModal')
    else {
      const comp = { selectComponent: (id) => (id === '#appModal' ? hostOf('comp') : null) }
      let got = null
      let done = 0
      openAppModal({ title: 'a', confirmColor: '#D64045', success: (r) => { got = r }, complete: () => { done += 1 } }, comp)
      const c1 = calls.pop() || []
      if (c1[0] !== 'comp') fails.push('openAppModal 没用组件自己的 #appModal 宿主')
      if (!(c1[1] && c1[1].danger === true)) fails.push('openAppModal 红色 confirmColor 未映射为 danger')
      if (!(got && got.confirm === true && got.cancel === false) || done !== 1) fails.push('openAppModal 的 success / complete 回调不同形')
      pageHost = hostOf('page')
      openAppModal({ title: 'b', confirmColor: '#C4A76C' })
      const c2 = calls.pop() || []
      if (c2[0] !== 'page') fails.push('openAppModal 没找当前页的 #appModal 宿主')
      if (c2[1] && c2[1].danger) fails.push('openAppModal 把金色确认误判为 danger')
      pageHost = null
      openAppModal({ title: 'c' }, {})
      if ((calls.pop() || [])[0] !== 'native') fails.push('openAppModal 无宿主时未退回系统弹窗（会点了没反应）')
    }
  } catch (e) {
    fails.push(`openAppModal 沙箱执行失败：${e.message}`)
  }

  // ③'' 手势接口：扫所有 JS 的 openAppModal(...) 调用体
  const GESTURE = /\b(openSetting|requestSubscribeMessage|requestSubscribeDeviceMessage|requestGiftSubscribe|promptStaffOrderSubscribe\w*|navigateToMiniProgram|getUserProfile|chooseAddress)\s*\(/
  for (const f of (jsFiles || walkJs(MP))) {
    if (f === 'utils/appModal.js') continue
    const src = read(f)
    let i = src.indexOf('openAppModal(')
    while (i >= 0) {
      const body = callBody(src, i + 'openAppModal'.length)
      const g = GESTURE.exec(body)
      if (g) fails.push(`${f}:${src.slice(0, i).split('\n').length} openAppModal 回调里调用了 ${g[1]}()（需要点击手势，AppModal 回调为异步不算手势 → 保留 wx.showModal）`)
      i = src.indexOf('openAppModal(', i + 1)
    }
  }

  const list = files || walk(MP)
  for (const f of list) {
    if (OUT_OF_SCOPE.test(f) || f === 'app.wxss') continue
    const exempt = NON_POPUP[f] || {}
    const n = ownMasks(read(f)).filter((sel) => !exempt[sel]).length
    const base = MASK_BASELINE[f] || 0
    if (n > base) fails.push(`${f}：自写遮罩 ${n} 处 > 基线 ${base}（新弹层用 ui-pop-mask，见 docs/弹层视觉规范_2026-10-13.md）`)
  }
  return fails
}

function selftest() {
  const real = (f) => readFileSync(join(MP, f), 'utf8')
  const cases = [
    ['已迁移弹层回退为自写遮罩', (f) => f === 'pages/cart/index.wxml' ? real(f).replace('class="ui-pop-mask" wx:if="{{showCouponModal}}"', 'class="modal-mask" wx:if="{{showCouponModal}}"') : real(f), 'ui-pop-mask'],
    ['牌面脱离 ui-pop-sheet', (f) => f === 'subpackages/feature/detail/index.wxml' ? real(f).replace('class="ui-pop-sheet sku-panel"', 'class="sku-panel"') : real(f), 'ui-pop-sheet'],
    ['页面新增一个自写遮罩', (f) => f === 'pages/cart/index.wxss' ? `${real(f)}\n.new-mask { position: fixed; inset: 0; background: rgba(0,0,0,.6); }\n` : real(f), '自写遮罩'],
    ['零件改用回弹缓动', (f) => f === 'app.wxss' ? real(f).replace('animation: ui-pop-rise var(--dur-base) var(--ease-out-soft) both;', 'animation: ui-pop-rise 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) both;') : real(f), '回弹'],
    ['遮罩底色脱离令牌', (f) => f === 'app.wxss' ? real(f).replace('  background: var(--pop-mask);\n  animation: ui-pop-fade', '  background: rgba(0,0,0,.6);\n  animation: ui-pop-fade') : real(f), 'var(--pop-mask)'],
    ['丢掉一个令牌', (f) => f === 'app.wxss' ? real(f).replace('  --pop-hairline:', '  --pop-hairline-x:') : real(f), '--pop-hairline'],
    ['openAppModal 丢掉红色 → danger 映射', (f) => f === 'utils/appModal.js' ? real(f).replace("danger: !!o.danger || DANGER_COLOR.test(String(o.confirmColor || ''))", 'danger: !!o.danger') : real(f), 'danger'],
    ['openAppModal 回调里调用需要手势的 openSetting', (f) => f === 'subpackages/feature/custom/inquiry/index.js' ? real(f).replace('openAppModal({', "openAppModal({ success: () => wx.openSetting({}), ") : real(f), '手势'],
    ['openAppModal 丢掉无宿主兜底', (f) => f === 'utils/appModal.js' ? real(f).replace('  if (!host) return nativeModal(o)', '  if (!host) return undefined') : real(f), '系统弹窗']
  ]
  let bad = 0
  const base = run()
  if (base.length) { console.log(`✗ 基线不干净：\n  ${base.join('\n  ')}`); bad += 1 }
  for (const [name, reader, needle] of cases) {
    const r = run(reader)
    const ok = r.some((x) => x.includes(needle))
    console.log(`${ok ? '  ✓ 已检出' : '✗ 未检出'}：${name}`)
    if (!ok) bad += 1
  }
  const fp = ownMasks('.bar { position: fixed; left: 0; right: 0; bottom: 0; height: 120rpx; background: #1A1814; }\n.m { position: fixed; inset: 0; background: var(--pop-mask); }')
  console.log(`${fp.length === 0 ? '  ✓ 不误报' : '✗ 误报'}：吸底栏 / 令牌底色`)
  if (fp.length) bad += 1
  if (bad) { console.log(`✗ 自检失败 ${bad} 项`); process.exit(1) }
  console.log(`✓ 自检通过（${cases.length} 注入 + 1 不误报，内存副本不写盘）`)
}

/** 把基线写回本文件（`--seed` / `--tighten` 共用） */
function writeBaseline(next) {
  const self = fileURLToPath(import.meta.url)
  const body = Object.entries(next).map(([k, v]) => `  '${k}': ${v}`).join(',\n')
  const src = readFileSync(self, 'utf8').replace(/export const MASK_BASELINE = \{[\s\S]*?\n\}/, `export const MASK_BASELINE = {\n${body}\n}`)
  writeFileSync(self, src)
}

if (process.argv.includes('--selftest')) selftest()
else if (process.argv.includes('--print-baseline')) {
  const out = {}
  for (const f of walk(MP)) {
    if (OUT_OF_SCOPE.test(f) || f === 'app.wxss') continue
    const exempt = NON_POPUP[f] || {}
    const n = ownMasks(readFileSync(join(MP, f), 'utf8')).filter((s) => !exempt[s]).length
    if (n) out[f] = n
  }
  console.log(JSON.stringify(out, null, 2))
} else if (process.argv.includes('--seed')) {
  /* 首次把某个分包纳入判据时**只登记尚无基线**的文件（已有条目一律不动）。
     之后只走 `--tighten`（只许降）。这条区分很重要：`--seed` 若能改写已有条目，
     它就成了"抬高基线"的后门，棘轮立刻失效。 */
  const next = { ...MASK_BASELINE }
  let added = 0
  for (const f of walk(MP)) {
    if (OUT_OF_SCOPE.test(f) || f === 'app.wxss' || next[f] !== undefined) continue
    const exempt = NON_POPUP[f] || {}
    const n = ownMasks(readFileSync(join(MP, f), 'utf8')).filter((s) => !exempt[s]).length
    if (n) { next[f] = n; added += 1 }
  }
  writeBaseline(next)
  console.log(`✓ 首次登记：+${added} 个文件（已有条目未动，共 ${Object.keys(next).length} 个）`)
} else if (process.argv.includes('--tighten')) {
  const next = {}
  for (const [f, base] of Object.entries(MASK_BASELINE)) {
    let n = 0
    try {
      const exempt = NON_POPUP[f] || {}
      n = ownMasks(readFileSync(join(MP, f), 'utf8')).filter((s) => !exempt[s]).length
    } catch { n = 0 }
    if (Math.min(n, base) > 0) next[f] = Math.min(n, base)
  }
  writeBaseline(next)
  console.log(`✓ 基线收紧：${Object.keys(MASK_BASELINE).length} → ${Object.keys(next).length} 个文件`)
} else {
  const fails = run()
  if (fails.length) {
    console.error(`✗ 弹层规范检查失败（${fails.length}）：`)
    for (const f of fails) console.error(`  - ${f}`)
    process.exit(1)
  }
  console.log(`✓ 弹层规范：零件 / 令牌在场，${MIGRATED.length} 个已迁移弹层未回退，自写遮罩未增长`)
}
