#!/usr/bin/env node
/**
 * 员工与管理端「细节雕刻」守卫（manager 域，C 流 2026-10）
 *
 * 只守展示层与体验层：骨架、空态下一步、按压态、防重复提交的可见反馈、界面不出现技术词。
 * 不碰契约 / 流程 / 权限 / 金额 —— 断言只读 wxml / wxss 与少量提示文案。
 * 文档：miniprogram/docs/细节雕刻_C流_2026-10.md
 *
 * 断言（每轮追加，条数随轮次增长；守卫条目只有这一条）：
 *   R1-1 工作台首页 / 功能模块页首屏是骨架（wb-sk），不再是一行「加载中…」
 *   R1-2 账本：加载中给骨架、旧流水压暗；空态只在数据就绪后出现且带「记一笔」；云端失败提示不透原文
 *   R1-3 订单：5 档空态都有下一步（清除搜索 / 看全部日期）
 *   R1-4 审批：首屏与列表骨架；提交中整排按钮压暗不可点；决策按钮有按压态
 *   R1-5 文案：员工端界面不出现 mp / SLA / 「暂无更多字段」等技术词与错字
 *   R2-1 核销验票：列表「交付 / 核销」与重试按钮有按压态；待自取 / 待核销列表加载是骨架；赠分提交中有文字反馈；
 *        流水空态带「去消费赠分」；field 样式与 manager 镜像逐字一致（subpackage-mirrors.json identical）
 *   R2-2 manager/index.wxss 清掉的死样式不得复活（棘轮）
 *   R2-3 店员子页（打卡 / 请假 / 报销 / 清单 / 两个审批）提交按钮有按压态与「…中」文字反馈
 *   R2-4 日报详情「复制摘要」只留底部一处
 *   R2-5 低频配置页不出现「云函数 / status=active / openid」等技术词
 *   R3-1 中低频功能页（R3_PAGES）可点元素都有 hover-class，用 wb-press 的页面经 @import 链能找到定义；订单卡操作按钮有按压态
 *   R3-2 发票列表首次加载是骨架、按状态筛空有「切回全部」提示；门店积分规则说明无云函数 / 集合名
 *   R3-3 工资条明细不再 @import staff/scene.wxss（连带 ~41 KiB 核销页样式）；内联后仍有本页依赖的基础类
 *
 * 用法：node miniprogram/scripts/check-c-stream-polish.mjs [--selftest]
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const TAG = '[check:c-stream-polish]'

const MGR = 'miniprogram/subpackages/manager'
const EXTRA = 'miniprogram/subpackages/extra'
const FILES = {
  hubWxml: `${MGR}/manager/index.wxml`,
  hubWxss: `${MGR}/manager/index.wxss`,
  hubNavWxss: `${MGR}/manager/hubNav.wxss`,
  wsWxml: `${MGR}/manager/workspace/index.wxml`,
  subviews: `${MGR}/manager/workspace/_subviews.wxml`,
  pageCfg: `${MGR}/manager/managerPageConfig.js`,
  apWxml: `${EXTRA}/approvals/index.wxml`,
  apWxss: `${EXTRA}/approvals/index.wxss`,
  staffWxml: `${EXTRA}/staff/index.wxml`,
  fieldWxml: `${EXTRA}/staff/field/index.wxml`,
  fieldWxss: `${EXTRA}/staff/field/index.wxss`,
  fieldWxssMirror: `${MGR}/staff/field/index.wxss`,
  attendanceWxml: `${EXTRA}/staff/attendance/index.wxml`,
  leaveWxml: `${EXTRA}/staff/leave/index.wxml`,
  reimburseWxml: `${EXTRA}/staff/reimbursements/index.wxml`,
  todosWxml: `${EXTRA}/staff/store-todos/index.wxml`,
  leaveReviewWxml: `${EXTRA}/staff/leave-review/index.wxml`,
  reimburseReviewWxml: `${EXTRA}/staff/reimburse-review/index.wxml`,
  digestWxml: `${EXTRA}/user/messages/detail/index.wxml`,
  supportCfgWxml: `${MGR}/support-config/index.wxml`,
  feishuWxml: `${MGR}/feishu-sync/index.wxml`,
  payslipAdminWxml: `${MGR}/payslip/admin/index.wxml`,
  invoiceWxml: `${MGR}/invoice-requests/index.wxml`,
  storePointsWxml: `${MGR}/store-points/index.wxml`,
  payslipWxss: `${MGR}/payslip/index.wxss`
}

/** R3：中低频功能页 —— 可点的按钮 / 标签 / 卡片都要有 hover-class，且 .wb-press 经本页 wxss 的 @import 链可达 */
const B2B = 'miniprogram/subpackages/b2bdesk'
const R3_PAGES = [
  `${MGR}/gift-ops`, `${MGR}/deposit-ops`, `${MGR}/store-points`, `${MGR}/invoice-requests`, `${MGR}/studio-bills`,
  `${MGR}/welcome-gift`, `${MGR}/birthday-gift`, `${MGR}/booking-rules`, `${MGR}/wallet-config`, `${MGR}/wish-wall`,
  `${MGR}/staff-directory`, `${MGR}/support-config`, `${MGR}/gift-manage`, `${MGR}/payslip`, `${MGR}/payslip/admin`,
  `${EXTRA}/member-crm`, `${EXTRA}/artisan-commission`, `${EXTRA}/live/studio`, `${EXTRA}/live/broadcast`,
  `${EXTRA}/supplier/buyer-orders`, `${EXTRA}/supplier/orders`, `${EXTRA}/supplier/ship`, `${EXTRA}/supplier/catalog`,
  `${B2B}/center`, `${B2B}/price-edit`, `${B2B}/partner`, `${B2B}/statement`
]
const NON_BUTTON = ['mask', 'overlay', 'backdrop', 'modal', 'sheet', 'popup', 'panel', 'drawer']

function readRel(rel) {
  const p = resolve(ROOT, rel)
  if (!existsSync(p)) {
    console.error(TAG, '缺少', rel)
    process.exit(1)
  }
  return readFileSync(p, 'utf8')
}

/** 把页面 wxss 及其 @import 链读进 css 表（键 = 仓库相对路径） */
function loadCssChain(rel, css) {
  if (css[rel] !== undefined) return
  css[rel] = readRel(rel)
  for (const m of css[rel].matchAll(/@import\s+['"]([^'"]+)['"]/g)) loadCssChain(posix.join(posix.dirname(rel), m[1]), css)
}

function load() {
  const src = {}
  for (const [k, rel] of Object.entries(FILES)) src[k] = readRel(rel)
  const pages = {}
  const css = {}
  for (const dir of R3_PAGES) {
    pages[dir] = readRel(`${dir}/index.wxml`)
    loadCssChain(`${dir}/index.wxss`, css)
  }
  src.__pages = pages
  src.__css = css
  return src
}

/** 在 css 表里沿 @import 链找某个选择器是否有定义 */
function cssReach(css, rel, sel, seen = new Set()) {
  if (seen.has(rel) || css[rel] === undefined) return false
  seen.add(rel)
  if (new RegExp(`(^|[\\n}])\\s*\\${sel}\\s*\\{`).test(css[rel].replace(/\/\*[\s\S]*?\*\//g, ''))) return true
  return [...css[rel].matchAll(/@import\s+['"]([^'"]+)['"]/g)].some((m) => cssReach(css, posix.join(posix.dirname(rel), m[1]), sel, seen))
}

/** 截出 wxml 里从 startMark 起、到下一个同级 `<block wx:if="{{curTab===` 为止的片段 */
function tabBlock(subviews, n) {
  const start = subviews.indexOf(`<block wx:if="{{curTab===${n}}}">`)
  if (start < 0) return ''
  const next = subviews.indexOf('<block wx:if="{{curTab===', start + 10)
  return subviews.slice(start, next < 0 ? undefined : next)
}

function bootBlock(wxml) {
  const m = wxml.match(/<view class="workbench-boot[^"]*"[^>]*>([\s\S]*?)\n\s*<\/view>\n(?=\s*\n|\s*<)/)
  return m ? m[0] : ''
}

/** 去掉 wxml 注释，避免注释里的说明文字触发文案判据 */
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '')

function check(src) {
  const fails = []
  const ok = (cond, msg) => { if (!cond) fails.push(msg) }

  // R1-1 首屏骨架
  for (const [k, name] of [['hubWxml', '工作台首页'], ['wsWxml', '功能模块页']]) {
    const boot = bootBlock(src[k])
    ok(/wb-sk/.test(boot) && /wb-sk-card/.test(boot), `R1-1 ${name}首屏不是骨架（缺 wb-sk / wb-sk-card）`)
    ok(!/加载中…<\/text>/.test(boot), `R1-1 ${name}首屏又退回一行「加载中…」文字`)
  }
  ok(/\.wb-sk-line[\s\S]*?animation:\s*wb-sk-pulse/.test(src.hubWxss) && /@keyframes wb-sk-pulse/.test(src.hubWxss),
    'R1-1 骨架样式 / 呼吸动画缺失（manager/index.wxss）')

  // R1-2 账本
  const ledger = tabBlock(src.subviews, 8)
  ok(!!ledger, 'R1-2 找不到账本模块（curTab===8）')
  ok(/class="ledger-overview lo-skeleton" wx:else/.test(ledger), 'R1-2 账本加载中没有骨架（lo-skeleton）')
  ok(/class="revenue-list \{\{ledgerOverviewReady \? '' : 'is-stale'\}\}"/.test(ledger), 'R1-2 切月份 / 门店时旧流水未压暗（is-stale）')
  const emptyLedger = (ledger.match(/<view class="empty-ledger"[\s\S]*?<\/view>\s*<\/view>/) || [''])[0]
  ok(/wx:if="\{\{ledgerOverviewReady && revenues\.length===0\}\}"/.test(emptyLedger), 'R1-2 账本空态在加载中就出现（须等 ledgerOverviewReady）')
  ok(/bindtap="openRevenueModal"/.test(emptyLedger), 'R1-2 账本空态没有「记一笔」下一步')
  ok(/class="add-btn-gold"[^>]*hover-class=/.test(ledger), 'R1-2 「记一笔」按钮缺按压态')
  ok(!/退款｜REFUND/.test(ledger), 'R1-2 账本明细仍是「退款｜REFUND」（与总览「退款｜门店」不一致）')
  const loadRev = (src.pageCfg.match(/\n  async loadRevenues\(\) \{[\s\S]*?\n  \},\n/) || [''])[0]
  ok(!!loadRev, 'R1-2 找不到 loadRevenues')
  ok(!/showHubTip\(\s*String\(e\.message\)/.test(loadRev), 'R1-2 账本云端失败把原始报错直接给员工看')

  // R1-3 订单空态下一步
  const orders = tabBlock(src.subviews, 2)
  const empties = orders.match(/<view class="om-empty" [\s\S]*?\n      <\/view>/g) || []
  ok(empties.length === 5, `R1-3 订单空态应为 5 档，实为 ${empties.length}`)
  empties.forEach((e, i) => {
    ok(/bindtap="clearOmQuery"/.test(e), `R1-3 订单第 ${i + 1} 档空态缺「清除搜索」`)
    ok(/bindtap="setOmDays" data-days="0"/.test(e), `R1-3 订单第 ${i + 1} 档空态缺「看全部日期」`)
  })

  // R1-4 审批
  ok(/<view class="container ap-boot" wx:if="\{\{!ready\}\}"/.test(src.apWxml), 'R1-4 审批首屏没有骨架（!ready 时留白）')
  ok(/<view class="ap-skeleton" wx:elif="\{\{loading\}\}">/.test(src.apWxml), 'R1-4 审批列表首次加载没有骨架')
  ok(/class="card-actions decide \{\{deciding \? 'is-busy' : ''\}\}"/.test(src.apWxml), 'R1-4 审批提交中按钮没有压暗（deciding → is-busy）')
  ok(/\.card-actions\.is-busy[\s\S]*?pointer-events:\s*none/.test(src.apWxss), 'R1-4 is-busy 未禁止再次点击')
  for (const fn of ['rejectItem', 'approveItem', 'ignoreItem']) {
    const re = new RegExp(`catchtap="${fn}"[^>]*hover-class="ap-btn-press"|catchtap="${fn}"[\\s\\S]{0,120}?hover-class="ap-btn-press"`)
    ok(re.test(src.apWxml), `R1-4 审批「${fn}」按钮缺按压态`)
  }

  // R1-5 文案
  const visible = [
    ['工作台首页', stripComments(src.hubWxml)],
    ['功能模块', stripComments(src.subviews)],
    ['审批中心', stripComments(src.apWxml)],
    ['店员工作台', stripComments(src.staffWxml)]
  ]
  const BANNED = [
    [/（不含mp）/, '「（不含mp）」'],
    [/SLA/, '「SLA」'],
    [/暂无更多字段/, '「暂无更多字段」'],
    [/暂无可用来/, '错字「暂无可用来现场场景」'],
    [/支付回调异常/, '「支付回调异常」']
  ]
  for (const [name, text] of visible) {
    for (const [re, label] of BANNED) ok(!re.test(text), `R1-5 ${name}界面出现技术词 / 错字：${label}`)
  }

  // R2-1 核销验票
  const H = 'hover-class="btn-outline-press"'
  for (const fn of ['verifyPickupFromList', 'verifyBooking', 'retryLastVerify', 'loadPendingPickups', 'loadBookings', 'retryScan']) {
    const tags = src.fieldWxml.match(new RegExp(`<view class="btn-outline"[^>]*(bind|catch)tap="${fn}"[^>]*>`, 'g')) || []
    ok(tags.length > 0 && tags.every((t) => t.includes(H)), `R2-1 核销页「${fn}」按钮缺按压态`)
  }
  ok(!/wx:if="\{\{(pickupsLoading|bookingsLoading)\}\}">加载中…</.test(src.fieldWxml), 'R2-1 待自取 / 待核销列表加载又退回一行「加载中…」')
  ok(/class="field-sk" wx:if="\{\{pickupsLoading\}\}"/.test(src.fieldWxml) && /class="field-sk" wx:if="\{\{bookingsLoading\}\}"/.test(src.fieldWxml), 'R2-1 待自取 / 待核销列表缺加载骨架')
  ok(/\{\{granting \? '提交中…'/.test(src.fieldWxml), 'R2-1 赠分提交中没有文字反馈')
  ok(/records\.length === 0 && !recordsLoading\}\}">[\s\S]{0,200}?bindtap="switchTab" data-idx="0"/.test(src.fieldWxml), 'R2-1 流水空态缺「去消费赠分」')
  ok(src.fieldWxss === src.fieldWxssMirror, 'R2-1 field/index.wxss 与 manager 镜像不一致（subpackage-mirrors.json 要求 identical）')

  // R2-2 死样式棘轮
  for (const sel of ['.menu-grid', '.icon-btn-scan', '.cfg-picker', '.cfg-check', '.om-track', '.modal-foot-row', '.nav-back-press', '.cat-dup-group']) {
    ok(!new RegExp(`(^|\\n)\\${sel}[\\s{.:,>]`).test(src.hubWxss), `R2-2 manager/index.wxss 死样式复活：${sel}`)
  }

  // R2-3 店员子页提交反馈
  const busy = [
    ['attendanceWxml', 'clock', 'clocking'], ['leaveWxml', 'submit', 'submitting'], ['reimburseWxml', 'submit', 'submitting'],
    ['todosWxml', 'saveTodo', 'saving'], ['leaveReviewWxml', 'review', 'reviewingId'], ['reimburseReviewWxml', 'review', 'reviewingId']
  ]
  for (const [k, fn, flag] of busy) {
    const tags = src[k].match(new RegExp(`<view class="btn[^"]*"[^>]*bindtap="${fn}"[^>]*>[^<]*</view>`, 'g')) || []
    ok(tags.length > 0 && tags.every((t) => /hover-class="/.test(t)), `R2-3 ${FILES[k]} 「${fn}」按钮缺按压态`)
    ok(tags.some((t) => new RegExp(`\\{\\{${flag}( === item\\._id)? \\? '[^']*中…'`).test(t)), `R2-3 ${FILES[k]} 「${fn}」提交中没有「…中」文字反馈`)
  }

  // R2-4 日报详情
  const digestCopy = (stripComments(src.digestWxml).match(/bindtap="shareDigestSheet"/g) || []).length
  ok(digestCopy === 1, `R2-4 日报详情「复制摘要」应只有底部一处，实为 ${digestCopy}`)

  // R2-5 低频配置页技术词
  for (const k of ['supportCfgWxml', 'feishuWxml', 'payslipAdminWxml']) {
    const text = stripComments(src[k]).replace(/\{\{[\s\S]*?\}\}/g, '').replace(/<[^>]+>/g, ' ')
    for (const [re, label] of [[/云函数/, '云函数'], [/status=active/, 'status=active'], [/priority/, 'priority'], [/openid/i, 'openid']]) {
      ok(!re.test(text), `R2-5 ${FILES[k]} 界面出现技术词「${label}」`)
    }
  }

  // R3-1 中低频页按压态
  for (const [dir, wxml] of Object.entries(src.__pages)) {
    const bare = (wxml.match(/<view\b[^>]*?>/gs) || []).filter((tag) => {
      if (!/\b(bindtap|catchtap)="/.test(tag) || /hover-class=/.test(tag)) return false
      if (/\b(?:bindtap|catchtap)="(noop|stop|preventTap|catchNoop)"/.test(tag)) return false
      const cls = (tag.match(/\bclass="([^"]*)"/) || [])[1] || ''
      return !NON_BUTTON.some((k) => cls.includes(k))
    })
    ok(bare.length === 0, `R3-1 ${dir} 有 ${bare.length} 处可点元素缺按压态：${bare.map((t) => (t.match(/class="([^"]*)"/) || [])[1]).slice(0, 3).join(' / ')}`)
    if (/hover-class="wb-press"/.test(wxml)) ok(cssReach(src.__css, `${dir}/index.wxss`, '.wb-press'), `R3-1 ${dir} 用了 wb-press 但 @import 链里没有 .wb-press 定义`)
  }
  ok(/\.wb-press\s*\{/.test(src.hubNavWxss), 'R3-1 hubNav.wxss 缺 .wb-press（功能模块页订单 / 工单按钮用它）')
  const omBtns = (tabBlock(src.subviews, 2).match(/<view\b[^>]*class="om-btn[^"]*"[^>]*>/g) || []).filter((t) => /\b(bindtap|catchtap)="/.test(t))
  ok(omBtns.length > 0 && omBtns.every((t) => /hover-class=/.test(t)), 'R3-1 订单卡「发货 / 退款 / 复制面单」按钮缺按压态')

  // R3-2 发票 / 积分
  ok(/class="ir-skeleton" wx:if="\{\{loading && !list\.length\}\}"/.test(src.invoiceWxml), 'R3-2 发票列表首次加载没有骨架')
  ok(/statusIndex > 0 \?/.test(src.invoiceWxml), 'R3-2 发票按状态筛空时没有「切回全部」提示')
  ok(!/云函数|store_point_rules|云端配置/.test(stripComments(src.storePointsWxml)), 'R3-2 门店积分规则说明出现技术词（云函数 / 集合名）')

  // R3-3 工资条样式内联（项目开了 ignoreUploadUnusedFiles：manager/staff 两份镜像无人引用即不随包上传）
  ok(!/@import\s+['"][^'"]*staff\/scene\.wxss['"]/.test(src.payslipWxss), 'R3-3 工资条又 @import staff/scene.wxss（manager 包多带 ~41 KiB）')
  for (const sel of ['.page-boot', '.section', '.row', '.row-main', '.row-sub', '.amount-row', '.scene-card', '.mask', '.modal', '.btn-primary']) {
    ok(new RegExp(`(^|[\\n,])\\${sel}\\s*[,{]`).test(src.payslipWxss), `R3-3 工资条内联样式缺 ${sel}`)
  }

  return fails
}

function run() {
  const fails = check(load())
  if (fails.length) {
    console.error(`${TAG} ✗ ${fails.length} 处不符合：`)
    fails.forEach((f) => console.error('  -', f))
    process.exit(1)
  }
  console.log(`${TAG} ✓ 员工端细节雕刻：骨架 / 空态下一步 / 按压态 / 提交中反馈 / 文案均在`)
}

function selftest() {
  const base = load()
  const baseFails = check(base)
  if (baseFails.length) {
    console.error(`${TAG} 自检前提不成立：真源本身不通过`, baseFails)
    process.exit(1)
  }
  const cases = [
    ['工作台首屏退回「加载中…」', (s) => ({ ...s, hubWxml: s.hubWxml.replace(/<view class="workbench-boot wb-sk"[\s\S]*?\n<\/view>\n/, '<view class="workbench-boot" wx:if="{{!workspaceReady}}">\n  <text class="workbench-boot-cn">工作台加载中…</text>\n</view>\n') }), /R1-1 工作台首页/],
    ['功能模块页首屏退回「加载中…」', (s) => ({ ...s, wsWxml: s.wsWxml.replace(/<view class="workbench-boot wb-sk"[\s\S]*?\n  <\/view>\n/, '<view class="workbench-boot" wx:if="{{!workspaceReady}}">\n    <text class="workbench-boot-cn">加载中…</text>\n  </view>\n') }), /R1-1 功能模块页/],
    ['账本空态在加载中出现', (s) => ({ ...s, subviews: s.subviews.replace('wx:if="{{ledgerOverviewReady && revenues.length===0}}"', 'wx:if="{{revenues.length===0}}"') }), /R1-2 账本空态在加载中/],
    ['账本空态去掉「记一笔」', (s) => ({ ...s, subviews: s.subviews.replace(/\n\s*<view class="empty-ledger-cta"[^\n]*/, '') }), /R1-2 账本空态没有「记一笔」/],
    ['账本失败透原文', (s) => ({ ...s, pageCfg: s.pageCfg.replace("this.showHubTip('账本暂时没取到，请检查网络后下拉刷新', 'warn');", "this.showHubTip(String(e.message).slice(0, 40), 'warn');") }), /R1-2 账本云端失败/],
    ['订单空态少一档「清除搜索」', (s) => ({ ...s, subviews: s.subviews.replace(/\n\s*<view class="om-empty-act" wx:if="\{\{omQuery\}\}"[^\n]*/, '') }), /R1-3 订单第 1 档空态缺「清除搜索」/],
    ['审批去掉提交中压暗', (s) => ({ ...s, apWxml: s.apWxml.replace("card-actions decide {{deciding ? 'is-busy' : ''}}", 'card-actions decide') }), /R1-4 审批提交中/],
    ['审批 is-busy 仍可点', (s) => ({ ...s, apWxss: s.apWxss.replace(/(\.card-actions\.is-busy,\n\.btn-nudge\.is-busy \{[^}]*?)pointer-events:\s*none;/, '$1') }), /R1-4 is-busy 未禁止/],
    ['审批首屏留白', (s) => ({ ...s, apWxml: s.apWxml.replace('<view class="container ap-boot" wx:if="{{!ready}}"', '<view class="container ap-boot" wx:if="{{false}}"') }), /R1-4 审批首屏/],
    ['「通过」去掉按压态', (s) => ({ ...s, apWxml: s.apWxml.replace(/(catchtap="approveItem" data-id="\{\{item\._id\}\}") hover-class="ap-btn-press" hover-stay-time="80"/, '$1') }), /approveItem」按钮缺按压态/],
    ['界面回到「不含mp」', (s) => ({ ...s, hubWxml: s.hubWxml.replace('（不含小程序订单）', '（不含mp）') }), /不含mp/],
    ['审批回到「SLA」', (s) => ({ ...s, apWxml: s.apWxml.replace('<text class="ov-lbl">时限内</text>', '<text class="ov-lbl">SLA 内</text>') }), /SLA/],
    ['店员工作台错字复活', (s) => ({ ...s, staffWxml: s.staffWxml.replace('暂时没有可用的现场功能', '暂无可用来现场场景') }), /暂无可用来/],
    ['核销「交付」去掉按压态', (s) => ({ ...s, fieldWxml: s.fieldWxml.replace('<view class="btn-outline" hover-class="btn-outline-press" hover-stay-time="100" catchtap="verifyPickupFromList"', '<view class="btn-outline" catchtap="verifyPickupFromList"') }), /verifyPickupFromList」按钮缺按压态/],
    ['待核销预约退回「加载中…」', (s) => ({ ...s, fieldWxml: s.fieldWxml.replace(/<view class="field-sk" wx:if="\{\{bookingsLoading\}\}"[^\n]*/, '<view class="empty empty-compact" wx:if="{{bookingsLoading}}">加载中…</view>') }), /R2-1 待自取 \/ 待核销列表加载又退回/],
    ['field 镜像漂移', (s) => ({ ...s, fieldWxssMirror: s.fieldWxssMirror + '\n.x {}\n' }), /镜像不一致/],
    ['死样式 .cfg-picker 复活', (s) => ({ ...s, hubWxss: s.hubWxss + '\n.cfg-picker { display: flex; }\n' }), /死样式复活：\.cfg-picker/],
    ['请假提交去掉「提交中…」', (s) => ({ ...s, leaveWxml: s.leaveWxml.replace("{{submitting ? '提交中…' : '提交请假'}}", '提交请假') }), /leave\/index\.wxml 「submit」提交中没有/],
    ['审批通过去掉按压态', (s) => ({ ...s, leaveReviewWxml: s.leaveReviewWxml.replace(/(<view class="btn approve[^"]*") hover-class="btn-primary-press" hover-stay-time="100"/, '$1') }), /leave-review\/index\.wxml 「review」按钮缺按压态/],
    ['日报复制按钮又重复', (s) => ({ ...s, digestWxml: s.digestWxml.replace('<view class="dg-foot">', '<view class="dg-tools"><view class="dg-tool" bindtap="shareDigestSheet"><text>复制 / 分享摘要</text></view></view>\n              <view class="dg-foot">') }), /复制摘要」应只有底部一处/],
    ['飞书页回到「云函数」', (s) => ({ ...s, feishuWxml: s.feishuWxml.replace('飞书凭据还没配置', '飞书凭据还没配到云函数') }), /feishu-sync\/index\.wxml 界面出现技术词「云函数」/],
    ['礼赠履约「去发货」去掉按压态', (s) => ({ ...s, __pages: { ...s.__pages, [`${MGR}/gift-ops`]: s.__pages[`${MGR}/gift-ops`].replace(/<view hover-class="wb-press" hover-stay-time="80" (class="mini-btn primary"[^>]*catchtap="goOrderManage")/, '<view $1') } }), /R3-1 .*gift-ops 有 1 处可点元素缺按压态/],
    ['workbench-nav 丢了 .wb-press', (s) => ({ ...s, __css: { ...s.__css, [`${MGR}/utils/workbench-nav.wxss`]: s.__css[`${MGR}/utils/workbench-nav.wxss`].replace(/\.wb-press\s*\{[^}]*\}/, '') } }), /R3-1 .*welcome-gift 用了 wb-press 但 @import 链里没有/],
    ['订单卡「发货」去掉按压态', (s) => ({ ...s, subviews: s.subviews.replace(/<view hover-class="wb-press" hover-stay-time="80" (class="om-btn ship")/, '<view $1') }), /R3-1 订单卡/],
    ['发票列表退回「加载中…」', (s) => ({ ...s, invoiceWxml: s.invoiceWxml.replace('class="ir-skeleton" wx:if="{{loading && !list.length}}"', 'class="loading-hint" wx:if="{{loading}}"') }), /R3-2 发票列表首次加载/],
    ['工资条回到 @import scene.wxss', (s) => ({ ...s, payslipWxss: '@import "../staff/scene.wxss";\n' + s.payslipWxss }), /R3-3 工资条又 @import/],
    ['工资条内联漏了 .amount-row', (s) => ({ ...s, payslipWxss: s.payslipWxss.replace(/\n\.amount-row \{[^}]*\}/, '') }), /R3-3 工资条内联样式缺 \.amount-row/],
    ['积分规则说明回到集合名', (s) => ({ ...s, storePointsWxml: s.storePointsWxml.replace('保存后改按这里的设置执行。', '保存后即写入 store_point_rules。') }), /R3-2 门店积分/]
  ]
  const notes = []
  let bad = 0
  for (const [name, mut, expect] of cases) {
    const mutated = mut(base)
    const changed = Object.keys(base).some((k) => base[k] !== mutated[k])
    if (!changed) { bad += 1; notes.push(`✗ 锚点失效（注入没有改动任何文件）：${name}`); continue }
    const fails = check(mutated)
    if (fails.some((f) => expect.test(f))) notes.push(`✓ ★ 被检出：${name}`)
    else { bad += 1; notes.push(`✗ 未检出：${name}（实得：${fails.join(' | ') || '无'}）`) }
  }
  notes.forEach((n) => console.log('  ' + n))
  if (bad) {
    console.error(`${TAG} 自检失败 ${bad}/${cases.length}`)
    process.exit(1)
  }
  console.log(`${TAG} 自检通过：${cases.length} 个内存注入全部检出（不写盘）`)
}

if (process.argv.includes('--selftest')) selftest()
else run()
