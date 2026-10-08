#!/usr/bin/env node
/**
 * 员工与管理端「细节雕刻」守卫（manager 域，C 流 2026-10）
 *
 * 只守展示层与体验层：骨架、空态下一步、按压态、防重复提交的可见反馈、界面不出现技术词。
 * 不碰契约 / 流程 / 权限 / 金额 —— 断言只读 wxml / wxss 与少量提示文案。
 * 文档：miniprogram/docs/细节雕刻_C流_2026-10.md
 *
 * 断言（每轮追加，条数随轮次增长；守卫条目只有这一条）：
 *   R1-1 工作台首页 / 功能模块页首屏是骨架（wb-sk 容器 + app.wxss 的 ui-sk-*），不再是一行「加载中…」
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
 *   R3-1 中低频功能页（R3_PAGES）可点元素都有 hover-class，app.wxss 有全局 .wb-press；订单卡操作按钮有按压态
 *   R3-2 发票列表首次加载是骨架、按状态筛空有「切回全部」提示；门店积分规则说明无云函数 / 集合名
 *   R3-3 工资条明细不再 @import staff/scene.wxss（连带 ~41 KiB 核销页样式）；内联后仍有本页依赖的基础类
 *   —— R4 为产品负责人 2026-10-01 点名范围 ——
 *   R4-1 定金意向卡显示「会员昵称 · 会员号」；manageDeposit 只新增 memberNickName / memberNo 出参（展开原行、不读手机号）
 *   R4-2 审批中心只有被点的那张卡显示「处理中… / 催办中…」；全局 deciding 仍压暗整排防并发
 *   R4-3 报表行为诊断卡：可见文案无「钩子 / fail_sync / 上云 / 指纹」等技术词，排障项收进「更多」；数据绑定不变
 *   R4-4 按会员号查人：manageStaff 只新增可选 memberNo（带手机号的旧调用不变、候选只回脱敏手机号）、
 *        manageMemberCrm 关键词追加会员号整号匹配（原匹配不变）；两份 normalizeMemberNo 逐字一致且行为正确
 *   R4-6 manager/staff 两份无引用镜像样式已删除，且不得在 subpackage-mirrors.json 复活登记
 *   R5   中英标签（A 流口径「英文大写小标题 + 中文主标分两行，同一行不中英并列」，2026-10-01）：
 *        员工 / 管理端 wxml（manager、b2bdesk、extra 除 user/）同一文字节点里不得「中文 / ENGLISH」「中文｜ENGLISH」并列，
 *        混排的英文词只许业务通用缩写（TERMS）；工作台面板标题 / 金卡 / 页脚 / 账本小标题为两行结构
 *   —— R6 接 A 流第 4 轮共享层（ae7e83c：app.wxss 的 tap-press / wb-press 别名与 ui-sk-*）——
 *   R6-1 8 份 .wb-press 同值副本已删，按压态只来自 app.wxss（页面 wxss 不得再定义 .wb-press）
 *   R6-2 审批 / 发票 / 运营（两份）/ 工作台 / b2bdesk / 股东配置骨架用 ui-sk-card / ui-sk-line：
 *        wxml 不再出现旧行类，wxss 不再自带骨架底色与呼吸动画（只留尺寸差异）
 *   R6-3 员工 / 管理端 wxss 里 muted 作文字色清零（深色面改 secondary；占位 / 分隔符 / 刻意弱化的「无值」态除外，见 R6_CAPTION_KEEP）
 *   —— R9 产品负责人 2026-10-08 真机：出货中心「选择包装方式 / 原材料」弹层滑不动 ——
 *   R9   出货中心 / 核对出货单底部弹层：scroll-view 内联 sheetBodyPx 高度且 flex: 0 1 auto + min-height: 0（不许回到 flex: 1 /
 *        max-height）；弹层 ≤ 80vh + overflow: hidden + 底部安全区；标题 / 搜索 / 底部按钮 flex-shrink: 0 且 catchtouchmove，
 *        遮罩 catchtouchmove，弹层容器与 scroll-view 不许 catchtouchmove；page-meta 在任一弹层打开时锁背后页面；
 *        sheetBodyPx 在假 wx 里实跑：整层 ≤ 80% 窗高并扣真实底部安全区（safeArea，不是不存在的 safeAreaInsets）
 *
 * 用法：node miniprogram/scripts/check-c-stream-polish.mjs [--selftest]
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const TAG = '[check:c-stream-polish]'

const MGR = 'miniprogram/subpackages/manager'
const EXTRA = 'miniprogram/subpackages/extra'
const FILES = {
  hubWxml: `${MGR}/manager/index.wxml`,
  hubWxss: `${MGR}/manager/index.wxss`,
  wsWxml: `${MGR}/manager/workspace/index.wxml`,
  subviews: `${MGR}/manager/workspace/_subviews.wxml`,
  pageCfg: `${MGR}/manager/managerPageConfig.js`,
  apWxml: `${EXTRA}/approvals/index.wxml`,
  apWxss: `${EXTRA}/approvals/index.wxss`,
  staffWxml: `${EXTRA}/staff/index.wxml`,
  fieldWxml: `${EXTRA}/staff/field/index.wxml`,
  fieldWxss: `${EXTRA}/staff/field/index.wxss`,
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
  payslipWxss: `${MGR}/payslip/index.wxss`,
  apJs: `${EXTRA}/approvals/index.js`,
  depositWxml: `${MGR}/deposit-ops/index.wxml`,
  depositJs: `${MGR}/deposit-ops/index.js`,
  depositFn: 'miniprogram/cloudfunctions/manageDeposit/index.js',
  staffFn: 'miniprogram/cloudfunctions/manageStaff/index.js',
  crmFn: 'miniprogram/cloudfunctions/manageMemberCrm/index.js',
  crmWxml: `${EXTRA}/member-crm/index.wxml`,
  permWxml: `${EXTRA}/staff-permissions/index.wxml`,
  permJs: `${EXTRA}/staff-permissions/index.js`,
  mirrors: 'miniprogram/scripts/subpackage-mirrors.json',
  appWxss: 'miniprogram/app.wxss',
  ticketView: `${MGR}/utils/supportTicketView.js`,
  msgAdminFn: 'miniprogram/cloudfunctions/messageAdmin/index.js',
  supportJs: `${EXTRA}/user/support/index.js`,
  supportWxml: `${EXTRA}/user/support/index.wxml`,
  feedbackJs: `${EXTRA}/user/feedback/index.js`,
  feedbackWxml: `${EXTRA}/user/feedback/index.wxml`,
  ticketImagesJs: `${EXTRA}/utils/ticketImages.js`,
  ticketFn: 'miniprogram/cloudfunctions/submitSupportTicket/index.js',
  ticketsVue: 'admin/src/components/SupportTickets.vue',
  shipOpsWxml: `${EXTRA}/shipment-ops/index.wxml`,
  shipOpsWxss: `${EXTRA}/shipment-ops/index.wxss`,
  shipSkuWxss: `${EXTRA}/shipment-ops/sku.wxss`,
  shipOpsJs: `${EXTRA}/shipment-ops/index.js`,
  shipShared: `${EXTRA}/shipment-ops/parts/shared.js`,
  opsMuseumWxss: `${EXTRA}/utils/ops-museum.wxss`,
  shipEditWxml: `${EXTRA}/shipment-edit/index.wxml`,
  shipEditWxss: `${EXTRA}/shipment-edit/index.wxss`,
  shipEditJs: `${EXTRA}/shipment-edit/index.js`
}

/** R9：按层叠顺序合并若干 [css, 选择器] 的声明（只认独立规则里逐个列出的选择器） */
function cssDecls(pairs) {
  const out = {}
  for (const [css, sel] of pairs) {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;/g, '')
    for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!m[1].split(',').map((x) => x.trim()).includes(sel)) continue
      for (const d of m[2].split(';')) {
        const i = d.indexOf(':')
        if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim()
      }
    }
  }
  return out
}

const R9_TAG = /<(view|scroll-view)\b(?:[^>"]|"[^"]*")*>/g
const r9Classes = (tag) => ((tag.match(/\sclass="([^"]*)"/) || [])[1] || '').split(/\s+/)

/** R9：在内存里跑 sheetBodyPx 源码（假 wx） */
function runSheetBodyPx(code, fakeWx) {
  const fn = (code.match(/function sheetBodyPx\(\) \{[\s\S]*?\n\}/) || [''])[0]
  if (!fn) return NaN
  try { return new Function('wx', `${fn}\nreturn sheetBodyPx()`)(fakeWx) } catch (e) { return NaN }
}

/** R7：在内存里执行 supportTicketView 源码（自检注入改的是这份字符串） */
function loadTicketView(code) {
  const mod = { exports: {} }
  try { new Function('module', 'exports', 'require', code)(mod, mod.exports, () => ({})) } catch (e) { return null }
  return mod.exports
}

/**
 * R8：用假 wx-server-sdk 执行 submitSupportTicket 源码。main() 在第一个 await 前同步调用 add()，
 * 所以同步就能拿到「写进库的 data」；校验失败时 add 根本不会被调用。
 */
const R8_IMG = (n) => `cloud://cloud1-8gnkty5bfff9f0bf.636c-cloud1-8gnkty5bfff9f0bf-1300/support-tickets/202610/1759_${n}.jpg`
function runTicketFn(code, event) {
  const calls = []
  const db = {
    serverDate: () => 'SERVER_DATE',
    collection: () => ({ add: ({ data }) => { calls.push(data); return Promise.resolve({ _id: 'T1' }) } })
  }
  const sdk = { init: () => {}, DYNAMIC_CURRENT_ENV: 'env', database: () => db, getWXContext: () => ({ OPENID: 'o_test' }) }
  const req = (name) => (name === 'wx-server-sdk' ? sdk : { dispatchInAppMessage: () => Promise.resolve() })
  const mod = { exports: {} }
  try {
    new Function('module', 'exports', 'require', 'console', code)(mod, mod.exports, req, { error() {}, warn() {}, log() {} })
    const p = mod.exports.main(event)
    if (p && p.catch) p.catch(() => {})
  } catch (e) { return { error: e.message, calls } }
  return { calls }
}

/** R6-1：删掉 .wb-press 同值副本的 8 个文件 */
const R6_PRESS_FILES = [
  `${MGR}/studio-bills/index.wxss`, `${MGR}/payslip/index.wxss`, `${MGR}/manager/hubNav.wxss`, `${MGR}/invoice-requests/index.wxss`,
  `${MGR}/utils/workbench-nav.wxss`, `${EXTRA}/utils/workbench-nav.wxss`, `${EXTRA}/member-crm/index.wxss`, 'miniprogram/subpackages/b2bdesk/desk-common.wxss'
]
/** R6-2：迁到 ui-sk-* 的骨架（wxml 不得再用旧行类；wxss 不得再自带骨架底色 / 呼吸动画） */
const R6_SK_WXML = [
  `${EXTRA}/approvals/index.wxml`, `${MGR}/invoice-requests/index.wxml`,
  `${MGR}/feishu-sync/index.wxml`, `${MGR}/identify-monitor/index.wxml`, `${MGR}/studio-dashboard/index.wxml`,
  `${EXTRA}/inventory-ops/index.wxml`, `${EXTRA}/purchase-ops/index.wxml`, `${EXTRA}/shipment-ops/index.wxml`,
  `${MGR}/manager/index.wxml`, `${MGR}/manager/workspace/index.wxml`, `${MGR}/manager/workspace/_subviews.wxml`,
  'miniprogram/subpackages/b2bdesk/center/index.wxml', 'miniprogram/subpackages/b2bdesk/partner/index.wxml', 'miniprogram/subpackages/b2bdesk/price-edit/index.wxml',
  `${EXTRA}/shareholder-config/index.wxml`
]
const R6_SK_WXSS = [
  `${EXTRA}/approvals/index.wxss`, `${MGR}/invoice-requests/index.wxss`, `${MGR}/utils/ops-museum.wxss`, `${EXTRA}/utils/ops-museum.wxss`,
  `${MGR}/manager/index.wxss`, 'miniprogram/subpackages/b2bdesk/desk-common.wxss', `${EXTRA}/shareholder-config/index.wxss`
]
const R6_OLD_SK_CLASS = /(?<![\w-])(?:ap-sk-(?:line|card|title|bar|wide)|ir-sk-line|ops-sk-(?:card|line)|wb-sk-(?:line|card|block|title|wide|bar)|skeleton-card|sk-line)(?![\w-])/
const R6_OLD_SK_CSS = /(?:^|[\n},])\s*\.(?:ap-sk-(?:line|card)|ir-sk-line|ops-sk-(?:card|line)|wb-sk-(?:line|card|block)|skeleton-card|sk-line)\b|@keyframes\s+(?:ap-sk|ir-sk|ops-sk|wb-sk|skel-|sk-)[\w-]*/
/** R6-3：保留 muted 的选择器 —— 占位提示（-ph）、分隔符 / 圆点、刻意弱化的「无值」态、保存中 / 已用状态 */
const R6_CAPTION_KEEP = /-ph\b|(?:^|\s)\.ph\b|-sep\b|picker-sep|-dot\b|--muted\b|pf-empty|is-saving|cat-opt-used|is-used/
/** A 流的四份字节一致镜像（check:care-common-mirrors），不归本流改 */
const R6_CAPTION_SKIP = [`${EXTRA}/care/care-common.wxss`]
const CAPTION_EXEMPT = /disabled|placeholder|inactive|soldout|sold-out|claimed|expired|strike|is-off|\.muted\b|\.off\b/i
const MUTED_TEXT = /(?<![-\w])color:\s*(?:var\(--color-text-muted\b[^;}]*\)|#6b6560\b)/i

/** R4-6：已删除的无引用镜像（产品负责人 2026-10-01 点名删除） */
const REMOVED_MIRRORS = [`${MGR}/staff/scene.wxss`, `${MGR}/staff/field/index.wxss`]

/** R3：中低频功能页 —— 可点的按钮 / 标签 / 卡片都要有 hover-class（.wb-press 由 app.wxss 全局提供） */
const B2B = 'miniprogram/subpackages/b2bdesk'
const R3_PAGES = [
  `${MGR}/gift-ops`, `${MGR}/deposit-ops`, `${MGR}/store-points`, `${MGR}/invoice-requests`, `${MGR}/studio-bills`,
  `${MGR}/welcome-gift`, `${MGR}/birthday-gift`, `${MGR}/booking-rules`, `${MGR}/wallet-config`, `${MGR}/wish-wall`,
  `${MGR}/staff-directory`, `${MGR}/support-config`, `${MGR}/gift-manage`, `${MGR}/payslip`, `${MGR}/payslip/admin`,
  `${EXTRA}/member-crm`, `${EXTRA}/artisan-commission`, `${EXTRA}/live/studio`, `${EXTRA}/live/broadcast`,
  `${EXTRA}/supplier/buyer-orders`, `${EXTRA}/supplier/orders`, `${EXTRA}/supplier/ship`, `${EXTRA}/supplier/catalog`,
  `${B2B}/center`, `${B2B}/price-edit`, `${B2B}/partner`, `${B2B}/statement`
]
/** R5：员工 / 管理端 wxml 扫描范围（B 流的 extra/user 不在内） */
const R5_ROOTS = [MGR, B2B, EXTRA]
const R5_SKIP = [`${EXTRA}/user/`, `${MGR}/wish-wall/`]
/** 可与中文同行出现的业务通用缩写（是术语，不是旁边中文的英译；RATIO / STORE / KPI / TREND 这类英译不在内） */
const R5_TERMS = new Set(['GMV', 'POS', 'SKU', 'RFM', 'DAU', 'CRM', 'HTML', 'JSON', 'CMS', 'FAQ', 'ERP', 'AI', 'YYYY', 'MM', 'URL', 'PDF', 'VIP'])
const NON_BUTTON = ['mask', 'overlay', 'backdrop', 'modal', 'sheet', 'popup', 'panel', 'drawer']

function readRel(rel) {
  const p = resolve(ROOT, rel)
  if (!existsSync(p)) {
    console.error(TAG, '缺少', rel)
    process.exit(1)
  }
  return readFileSync(p, 'utf8')
}

function load() {
  const src = {}
  for (const [k, rel] of Object.entries(FILES)) src[k] = readRel(rel)
  const pages = {}
  for (const dir of R3_PAGES) pages[dir] = readRel(`${dir}/index.wxml`)
  src.__pages = pages
  src.__existing = REMOVED_MIRRORS.filter((rel) => existsSync(resolve(ROOT, rel)))
  const r5 = {}
  const r6css = {}
  const walk = (rel) => {
    for (const name of readdirSync(resolve(ROOT, rel))) {
      const child = `${rel}/${name}`
      if (R5_SKIP.some((p) => `${child}/`.startsWith(p))) continue
      if (statSync(resolve(ROOT, child)).isDirectory()) walk(child)
      else if (name.endsWith('.wxml')) r5[child] = readRel(child)
      else if (name.endsWith('.wxss')) r6css[child] = readRel(child)
    }
  }
  R5_ROOTS.forEach(walk)
  src.__r5 = r5
  src.__r6css = r6css
  return src
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
    ok(/wb-sk/.test(boot) && /ui-sk-card/.test(boot) && /ui-sk-line/.test(boot), `R1-1 ${name}首屏不是骨架（缺 wb-sk / ui-sk-card / ui-sk-line）`)
    ok(!/加载中…<\/text>/.test(boot), `R1-1 ${name}首屏又退回一行「加载中…」文字`)
  }
  ok(/\.ui-sk-line\s*\{[^}]*animation:\s*ui-sk-pulse/.test(src.appWxss) && /@keyframes ui-sk-pulse/.test(src.appWxss),
    'R1-1 骨架样式 / 呼吸动画缺失（app.wxss 的 ui-sk-line）')

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
  ok(/class="card-actions decide \{\{deciding \? 'is-busy' : ''\}\}[^"]*"/.test(src.apWxml), 'R1-4 审批提交中按钮没有压暗（deciding → is-busy）')
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
  }
  ok(/(^|\n)\.tap-press, \.wb-press \{[^}]*opacity:/.test(src.appWxss), 'R3-1 app.wxss 缺全局 .wb-press（功能模块页与中低频页的按压态都靠它）')
  const omBtns = (tabBlock(src.subviews, 2).match(/<view\b[^>]*class="om-btn[^"]*"[^>]*>/g) || []).filter((t) => /\b(bindtap|catchtap)="/.test(t))
  ok(omBtns.length > 0 && omBtns.every((t) => /hover-class=/.test(t)), 'R3-1 订单卡「发货 / 退款 / 复制面单」按钮缺按压态')

  // R3-2 发票 / 积分
  ok(/class="ir-skeleton" wx:if="\{\{loading && !list\.length\}\}"/.test(src.invoiceWxml), 'R3-2 发票列表首次加载没有骨架')
  ok(/statusIndex > 0 \?/.test(src.invoiceWxml), 'R3-2 发票按状态筛空时没有「切回全部」提示')
  ok(!/云函数|store_point_rules|云端配置/.test(stripComments(src.storePointsWxml)), 'R3-2 门店积分规则说明出现技术词（云函数 / 集合名）')

  // R3-3 工资条样式内联（manager/staff 两份镜像随后已删，见 R4-6）
  ok(!/@import\s+['"][^'"]*staff\/scene\.wxss['"]/.test(src.payslipWxss), 'R3-3 工资条又 @import staff/scene.wxss（manager 包多带 ~41 KiB）')
  for (const sel of ['.page-boot', '.section', '.row', '.row-main', '.row-sub', '.amount-row', '.scene-card', '.mask', '.modal', '.btn-primary']) {
    ok(new RegExp(`(^|[\\n,])\\${sel}\\s*[,{]`).test(src.payslipWxss), `R3-3 工资条内联样式缺 ${sel}`)
  }

  // R4-1 定金意向卡会员标识
  ok(/<text class="intent-meta">会员 \{\{item\.memberLabel\}\}<\/text>/.test(src.depositWxml), 'R4-1 定金意向卡没有显示会员昵称 / 会员号（memberLabel）')
  ok(!/会员 \{\{item\.openidShort\}\}/.test(src.depositWxml), 'R4-1 定金意向卡又回到显示 openid 片段')
  ok(/memberLabel: \[row\.memberNickName, row\.memberNo\]/.test(src.depositJs), 'R4-1 deposit-ops 的 memberLabel 不是由 memberNickName / memberNo 拼出')
  const attach = (src.depositFn.match(/\nasync function attachMemberLabels\(list\) \{[\s\S]*?\n\}\n/) || [''])[0]
  ok(!!attach, 'R4-1 manageDeposit 缺 attachMemberLabels')
  ok(/\{\s*\.\.\.r,\s*memberNickName:[^\n]*\n\s*memberNo:[^\n]*\n\s*\}/.test(attach), 'R4-1 attachMemberLabels 不是在原行上只新增字段（须 ...r 展开）')
  ok(/\.field\(\{ _openid: true, nickName: true, memberNo: true \}\)/.test(attach) && !/phone/.test(attach), 'R4-1 attachMemberLabels 读 users 的字段超出昵称 / 会员号（不得带手机号）')
  ok(/attachMemberLabels\(await attachOrderStatus\(list\)\)/.test(src.depositFn), 'R4-1 listIntents 没有挂上会员标识')

  // R4-2 审批只点亮被点的卡
  for (const [fn, label] of [['rejectItem', 'reject'], ['ignoreItem', 'ignore'], ['approveItem', 'approve']]) {
    ok(new RegExp(`decidingId === item\\._id && decidingAction === '${label}' \\? '处理中…'`).test(src.apWxml), `R4-2 审批「${fn}」的「处理中…」不是只在被点的卡上显示`)
  }
  ok(/decidingId === item\._id && decidingAction === 'nudge' \? '催办中…'/.test(src.apWxml), 'R4-2 催办的「催办中…」不是只在被点的卡上显示')
  ok(!/\{\{deciding \? '处理中…'/.test(src.apWxml), 'R4-2 审批又用全局 deciding 让所有卡一起显示「处理中…」')
  const onCount = (src.apJs.match(/deciding: true/g) || []).length
  const onWithId = (src.apJs.match(/deciding: true, decidingId: id, decidingAction: '(approve|reject|ignore|nudge)'/g) || []).length
  const offCount = (src.apJs.match(/setData\(\{ deciding: false/g) || []).length
  const offWithId = (src.apJs.match(/setData\(\{ deciding: false, decidingId: '', decidingAction: ''/g) || []).length
  ok(onCount > 0 && onCount === onWithId, `R4-2 审批 js 有 ${onCount - onWithId} 处置 deciding 时没记下被点的卡`)
  ok(offCount === offWithId, `R4-2 审批 js 有 ${offCount - offWithId} 处复位 deciding 时没清掉 decidingId`)
  const curRule = (src.apWxss.match(/\.card-actions\.is-busy\.is-current,\n\.btn-nudge\.is-busy\.is-current \{[^}]*\}/) || [''])[0]
  ok(/opacity:\s*1/.test(curRule) && !/pointer-events/.test(curRule), 'R4-2 被点的卡须不压暗、且不得放开 pointer-events（防重复提交）')

  // R4-3 报表行为诊断改业务语言
  const bStart = src.subviews.indexOf('顾客行为漏斗（抽样统计）')
  const bEnd = src.subviews.indexOf('最常发生的动作（原始事件名，排障用）')
  ok(bStart > 0 && bEnd > bStart, 'R4-3 找不到行为漏斗区块（标题被改回技术口径？）')
  const behavior = bStart > 0 && bEnd > bStart
    ? stripComments(src.subviews.slice(bStart, bEnd)).replace(/<block wx:if="\{\{reportDiagOpen\}\}">[\s\S]*?<\/block>/g, '')
    : ''
  const bText = behavior.replace(/\{\{[\s\S]*?\}\}/g, '').replace(/<[^>]+>/g, ' ')
  for (const w of ['钩子', 'fail_sync', '上云', '指纹', '查询模式', 'analytics_daily', 'step', 'Top 事件']) {
    ok(!bText.includes(w), `R4-3 行为漏斗可见文案出现技术词「${w}」（应收进「更多」）`)
  }
  ok(/wx:if="\{\{reportDiagOpen && analyticsReport\.behavior\.topEvents\.length\}\}"/.test(src.subviews), 'R4-3 原始事件名卡没有收进「更多」')
  ok(/bindtap="toggleReportDiag"[^>]*>\{\{reportDiagOpen \?/.test(src.subviews) && /\n  toggleReportDiag\(\) \{/.test(src.pageCfg) && /reportDiagOpen: false,/.test(src.pageCfg), 'R4-3 「更多（排障信息）」开关缺失或默认展开')
  for (const b of ['diag.behaviorsCount', 'funnel.wishWall.gate.show', 'funnel.wishWall.ritualGate.resumeSuccess',
    'funnel.wishWall.ritualGate.completeRate', 'funnel.wishWall.certGate.resumeSuccess']) {
    ok(behavior.includes(`analyticsReport.behavior.${b}`), `R4-3 行为漏斗的数据绑定 ${b} 不见了（只许改文案不许改口径）`)
  }

  // R4-4 会员号查人
  const norm = (s) => (s.match(/\nfunction normalizeMemberNo\(value\) \{[\s\S]*?\n\}\n/) || [''])[0]
  const build = (s) => (s.match(/\nfunction buildMemberNo\(openid\) \{[\s\S]*?\n\}\n/) || [''])[0]
  ok(!!norm(src.staffFn) && norm(src.staffFn) === norm(src.crmFn), 'R4-4 manageStaff 与 manageMemberCrm 的 normalizeMemberNo 不一致')
  ok(!!build(src.staffFn) && build(src.staffFn) === build(src.crmFn) && build(src.staffFn) === build(src.depositFn), 'R4-4 三个云函数的 buildMemberNo 不一致（会员号须同算法）')
  if (norm(src.staffFn) && build(src.staffFn)) {
    try {
      const { normalizeMemberNo, buildMemberNo } = new Function(`${build(src.staffFn)}${norm(src.staffFn)}return { normalizeMemberNo, buildMemberNo }`)()
      const oid = 'oAbcdefgh-_xy12zz'
      const okCases = [['MT-AB12-CD34', 'MT-AB12-CD34'], ['mtab12cd34', 'MT-AB12-CD34'], ['ab12-cd34', 'MT-AB12-CD34'],
        [buildMemberNo(oid), buildMemberNo(oid)], ['13800001111', ''], ['', ''], ['MT-AB12', '']]
      for (const [inp, want] of okCases) ok(normalizeMemberNo(inp) === want, `R4-4 normalizeMemberNo(${JSON.stringify(inp)}) 应为 ${JSON.stringify(want)}，实为 ${JSON.stringify(normalizeMemberNo(inp))}`)
    } catch (e) {
      ok(false, `R4-4 normalizeMemberNo 无法执行：${e.message}`)
    }
  }
  const lookup = (src.staffFn.match(/\nasync function lookupByPhone\(event, openid, adminOpsKey\) \{[\s\S]*?\n\}\n/) || [''])[0]
  ok(/const memberNo = !phone \? normalizeMemberNo\(event && event\.memberNo\) : ''\n\s*if \(memberNo\) return lookupByMemberNo\(memberNo\)\n\s*if \(!PHONE_RE\.test\(phone\)\)/.test(lookup), 'R4-4 lookupByPhone 的 memberNo 不是「只在没带手机号时生效」的可选参数')
  ok(lookup.indexOf('assertStaff') >= 0 && lookup.indexOf('assertStaff') < lookup.indexOf('lookupByMemberNo'), 'R4-4 会员号分支绕过了 lookupByPhone 原有的权限校验')
  const byNo = (src.staffFn.match(/\nasync function lookupByMemberNo\(memberNo\) \{[\s\S]*?\n\}\n/) || [''])[0]
  ok(/phoneMasked: maskPhone\(user\.phone\)/.test(byNo) && !/\bphone: /.test(byNo), 'R4-4 会员号查人的候选带出了未脱敏手机号')
  const mk = (src.crmFn.match(/\nfunction matchKeyword\(profile, keyword\) \{[\s\S]*?\n\}\n/) || [''])[0]
  ok(/if \(nick\.includes\(k\) \|\| oid\.includes\(k\) \|\| id\.includes\(k\) \|\| phone\.includes\(k\.replace\(\/\\D\/g, ''\) \|\| k\)\) return true/.test(mk), 'R4-4 CRM 关键词原有的昵称 / openid / 手机号匹配被改动')
  ok(/profileMemberNo\(profile\) === memberNo/.test(mk), 'R4-4 CRM 关键词没有追加会员号匹配')
  ok(/memberNo: profileMemberNo\(p\),/.test(src.crmFn), 'R4-4 CRM 列表出参缺 memberNo')
  ok(/placeholder="[^"]*会员号[^"]*"/.test(src.crmWxml) && /\{\{item\.memberNo\}\}/.test(src.crmWxml), 'R4-4 会员 CRM 搜索框未提示会员号 / 列表未显示会员号')
  ok(/bindtap="lookupStaffByMemberNo"/.test(src.permWxml) && /\{ action: 'lookupByPhone', memberNo \}/.test(src.permJs), 'R4-4 员工权限页缺会员号查找')
  ok(/\{ action: 'lookupByPhone', phone \}/.test(src.permJs), 'R4-4 员工权限页手机号查找的旧入参被改动')

  // R5 中英标签：同一文字节点不中英并列
  const HAN = /\p{Script=Han}/u
  const EN_WORD = /\b[A-Z][A-Z'&]{2,}\b/g
  const PAIR_AFTER = /[\p{Script=Han}）)]\s*(?:\/|｜|·)\s*([A-Z][A-Z'& ]*[A-Z])\b/gu
  const PAIR_BEFORE = /\b([A-Z][A-Z'& ]*[A-Z])\s*(?:\/|｜|·)\s*\p{Script=Han}/gu
  const r5Bad = []
  for (const [rel, wxml] of Object.entries(src.__r5)) {
    const nodes = stripComments(wxml).match(/>[^<>]+</g) || []
    for (const raw of nodes) {
      // 「ATLAS:s1」这类码值示例不算标签
      const text = raw.slice(1, -1).replace(/\{\{|\}\}/g, ' ').replace(/\b[A-Z]+:[a-z0-9]\w*/g, ' ')
      if (!HAN.test(text)) continue
      const pairs = [...text.matchAll(PAIR_AFTER), ...text.matchAll(PAIR_BEFORE)].map((m) => m[1].trim()).filter((w) => !R5_TERMS.has(w))
      const words = (text.match(EN_WORD) || []).filter((w) => !R5_TERMS.has(w))
      if (pairs.length || words.length) r5Bad.push(`${rel.replace('miniprogram/subpackages/', '')}「${text.trim().slice(0, 30)}」`)
    }
  }
  ok(r5Bad.length === 0, `R5 同一行中英并列 ${r5Bad.length} 处（应改为英文小标题 + 中文主标两行，或只留中文）：${r5Bad.slice(0, 4).join(' / ')}`)
  const panelTitles = src.hubWxml.match(/<view class="panel-title[^"]*">[\s\S]*?<\/view>/g) || []
  ok(panelTitles.length === 5 && panelTitles.every((t) => /<text class="panel-en">[A-Z ]+<\/text><text class="panel-cn">[^<A-Za-z]+<\/text>/.test(t)), 'R5 工作台面板标题不是「英文小标题 + 中文主标」两行结构')
  ok(/<text class="card-eyebrow">[A-Z ·]+<\/text>\s*<text class="card-label">[^<A-Za-z]+<\/text>/.test(src.hubWxml), 'R5 工作台金卡标题不是两行结构')
  ok(/<text class="footer-en">[^<]+<\/text>\s*<text class="footer-cn">[^<]+<\/text>/.test(src.hubWxml), 'R5 工作台页脚不是两行结构')
  ok(/\.panel-title \.panel-en \{[^}]*display: block/.test(src.hubWxss) && /\.lo-ptitle \{[^}]*flex-direction: column/.test(src.hubWxss) && /\.lo-kpi-title \{[^}]*flex-direction: column/.test(src.hubWxss), 'R5 两行标题的样式被改回同行（display: block / flex-direction: column）')
  const loTitles = src.subviews.match(/<view class="lo-(?:kpi-title|ptitle)">[\s\S]*?<\/view>/g) || []
  ok(loTitles.length === 4 && loTitles.every((t) => /^<view class="[^"]+"><text class="lo-pt-en">[A-Z ]+<\/text><text class="lo-pt-cn">/.test(t)), 'R5 账本小标题不是「英文在上、中文在下」')

  // R4-6 无引用镜像已删
  ok(src.__existing.length === 0, `R4-6 已删除的无引用镜像又出现：${src.__existing.join(' / ')}`)
  for (const rel of REMOVED_MIRRORS) {
    ok(!src.mirrors.includes(`"${rel.replace('miniprogram/', '')}"`), `R4-6 subpackage-mirrors.json 又登记了已删镜像 ${rel}`)
  }

  // R6-1 .wb-press 只来自 app.wxss
  const pressCopies = Object.entries(src.__r6css)
    .filter(([, css]) => /(^|[\n},])\s*\.wb-press\s*[,{]/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')))
    .map(([rel]) => rel.replace('miniprogram/subpackages/', ''))
  ok(pressCopies.length === 0, `R6-1 页面 wxss 又自带 .wb-press（app.wxss 已有全局同值类）：${pressCopies.join(' / ')}`)
  for (const rel of R6_PRESS_FILES) ok(src.__r6css[rel] !== undefined, `R6-1 找不到 ${rel}`)

  // R6-2 骨架迁到 ui-sk-*
  for (const rel of R6_SK_WXML) {
    const wxml = src.__r5[rel]
    if (wxml === undefined) { ok(false, `R6-2 找不到 ${rel}`); continue }
    const classes = [...stripComments(wxml).matchAll(/\bclass="([^"]*)"/g)].map((m) => m[1])
    const old = classes.filter((c) => R6_OLD_SK_CLASS.test(c))
    ok(old.length === 0, `R6-2 ${rel.replace('miniprogram/subpackages/', '')} 骨架还在用旧行类：${old.slice(0, 2).join(' / ')}`)
    const skel = classes.filter((c) => /\bskel-(?:block|card|line|thumb|avatar)\b/.test(c) && !/\bui-sk-(?:line|card)\b/.test(c))
    ok(skel.length === 0, `R6-2 ${rel.replace('miniprogram/subpackages/', '')} 的 skel-* 没挂 ui-sk-*：${skel.slice(0, 2).join(' / ')}`)
    ok(classes.some((c) => /\bui-sk-line\b/.test(c)), `R6-2 ${rel.replace('miniprogram/subpackages/', '')} 没有 ui-sk-line 骨架行`)
  }
  for (const rel of R6_SK_WXSS) {
    const css = (src.__r6css[rel] || '').replace(/\/\*[\s\S]*?\*\//g, '')
    const m = css.match(R6_OLD_SK_CSS)
    ok(!m, `R6-2 ${rel.replace('miniprogram/subpackages/', '')} 又自带骨架行 / 呼吸动画：${m ? m[0].trim() : ''}`)
    const own = [...css.matchAll(/([^{}]*\b(?:ui-sk-[\w-]+|skel-[\w-]+)\b[^{}]*)\{([^{}]*)\}/g)].filter((r) => /background|animation/.test(r[2]))
    ok(own.length === 0, `R6-2 ${rel.replace('miniprogram/subpackages/', '')} 的骨架规则又写了底色 / 动画（应只留尺寸）：${own.map((r) => r[1].trim()).slice(0, 2).join(' / ')}`)
  }

  // R6-3 muted 说明字清零
  const mutedLeft = []
  for (const [rel, raw] of Object.entries(src.__r6css)) {
    if (R6_CAPTION_SKIP.includes(rel)) continue
    const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const r of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/@keyframes|^\s*(from|to|\d+%)/.test(r[1]) || !MUTED_TEXT.test(r[2])) continue
      const sels = r[1].split(',').map((s) => s.trim()).filter(Boolean)
      if (sels.every((s) => CAPTION_EXEMPT.test(s) || R6_CAPTION_KEEP.test(s))) continue
      mutedLeft.push(`${rel.replace('miniprogram/subpackages/', '')} ${sels.join(', ').replace(/\s+/g, ' ')}`)
    }
  }
  ok(mutedLeft.length === 0, `R6-3 员工 / 管理端说明字又用 muted（深色面 2.7–3.1:1，应改 secondary）${mutedLeft.length} 处：${mutedLeft.slice(0, 3).join(' / ')}`)

  // R7 山海有信 · 留言回复
  const ticketTab = (src.subviews.match(/<block wx:if="\{\{subTabMessage===2\}\}">[\s\S]*?暂无待回复留言/) || [''])[0]
  ok(!!ticketTab, 'R7-1 找不到「留言回复」tab')
  ok(!/class="p-name"/.test(ticketTab), 'R7-1 留言正文又用 .p-name（单行省略，预填前缀后的正文会被整段藏掉）')
  ok(/class="ticket-msg \{\{item\.canExpand && !item\.expanded \? 'is-clamp' : ''\}\}"[^>]*>\{\{item\.body\}\}/.test(ticketTab) && /bindtap="toggleTicketExpand"/.test(ticketTab), 'R7-1 留言卡没有完整正文 + 展开全文')
  ok(/\.ticket-msg \{[^}]*white-space: pre-wrap/.test(src.hubWxss), 'R7-1 .ticket-msg 不是 pre-wrap（换行后的正文看不到）')
  ok(/bindtap="previewTicketImage"/.test(ticketTab), 'R7-1 留言卡附图不能点开看大图')
  ok(!/openidMask|_openid/.test(ticketTab) && /\{\{item\.who\}\}/.test(ticketTab), 'R7-4 留言卡右上角又显示 openid 片段（应为昵称 / 会员号）')
  const replyModal = (src.subviews.match(/<view class="modal-mask" wx:if="\{\{showTicketReplyModal\}\}"[\s\S]*?发送回复/) || [''])[0]
  ok(/顾客原留言/.test(replyModal) && /\{\{tempTicketReply\.body\}\}/.test(replyModal), 'R7-3 回复弹层看不到顾客原留言')
  const tv = loadTicketView(src.ticketView)
  if (!tv || typeof tv.buildTicketView !== 'function') ok(false, 'R7-2 supportTicketView.js 无法执行')
  else {
    const real = tv.buildTicketView({ _openid: 'oa22s5xxxxxxxxxxxxxxABCD1234', message: '关于藏品「忘忧尾蛱蝶植物标本框」：', productName: '忘忧尾蛱蝶植物标本框' })
    ok(real.bodyEmpty === true && real.contextLine === '藏品「忘忧尾蛱蝶植物标本框」', `R7-2 只带前缀的真实工单没识别成「顾客没写正文」（bodyEmpty=${real.bodyEmpty}，contextLine=${real.contextLine}）`)
    ok(real.who === 'MT-ABCD-1234', `R7-4 无昵称时右上角不是会员号 MT-XXXX-XXXX（实得 ${real.who}）`)
    const typed = tv.buildTicketView({ _openid: 'o', memberNickName: '小林', memberNo: 'MT-AAAA-BBBB', message: '关于藏品「X」：\n第一行\n第二行', images: ['cloud://a.png'] })
    ok(typed.body === '第一行\n第二行' && typed.who === '小林 · MT-AAAA-BBBB' && typed.images.length === 1, `R7-2 正文 / 昵称 / 附图拆分不对（body=${JSON.stringify(typed.body)}，who=${typed.who}）`)
    const long = tv.buildTicketView({ message: '很'.repeat(200) })
    ok(long.body.length === 200 && long.canExpand === true, 'R7-2 长留言被截断或不能展开')
  }
  const listFn = (src.msgAdminFn.match(/async function listSupportTickets[\s\S]*?\n\}/) || [''])[0]
  ok(/list: await attachMemberLabels\(res\.data \|\| \[\]\)/.test(listFn) && /return \{ success: true, list:/.test(listFn), 'R7-4 listSupportTickets 没补会员标识，或出参结构变了')
  const ticketAttach = (src.msgAdminFn.match(/async function attachMemberLabels[\s\S]*?\n\}/) || [''])[0]
  ok(/\.field\(\{ _openid: true, nickName: true, memberNo: true \}\)/.test(ticketAttach) && /\.\.\.r,\n\s*memberNickName:/.test(ticketAttach), 'R7-4 attachMemberLabels 读 users 字段超出昵称 / 会员号，或不是在原行上只新增字段')
  const submit = (src.supportJs.match(/async submitTicket\(\) \{[\s\S]*?\n  \},/) || [''])[0]
  const guardAt = submit.indexOf('if (message.length < 5 || body.length < 2)')
  ok(guardAt > 0 && guardAt < submit.indexOf("name: 'submitSupportTicket'"), 'R7-5 顾客端只提交预填前缀（没写正文）仍能提交')
  ok(/data: \{\n\s*topic: this\.data\.activeTopic,\n\s*message,\n\s*orderId: this\.data\.orderId,\n\s*orderNo: this\.data\.orderNo,\n\s*productId: this\.data\.productId,\n\s*productName: this\.data\.productName,\n\s*contactPhone: phone,\n\s*\.\.\.\(imageIDs\.length \? \{ images: imageIDs \} : \{\}\)\n\s*\}/.test(submit), 'R7-5 submitSupportTicket 入参被改（原有键须逐字不变，只许追加可选 images）')

  // R8：留言附图（产品负责人 2026-10-01 点名，顾客端新增旁路）
  const base8 = { message: '想问问这只蝴蝶的产地' }
  const noImg = runTicketFn(src.ticketFn, base8)
  ok(noImg.calls.length === 1 && !Object.prototype.hasOwnProperty.call(noImg.calls[0], 'images'), `R8-2 不传 images 时也写了 images 字段（或没写库：${noImg.error || noImg.calls.length}）`)
  const three = runTicketFn(src.ticketFn, { ...base8, images: [R8_IMG(1), R8_IMG(2), R8_IMG(3)] })
  ok(three.calls.length === 1 && JSON.stringify(three.calls[0].images) === JSON.stringify([R8_IMG(1), R8_IMG(2), R8_IMG(3)]), 'R8-1 合法的 3 张图没有原样写进 images')
  const reject8 = [
    ['4 张', [R8_IMG(1), R8_IMG(2), R8_IMG(3), R8_IMG(4)]],
    ['https 链接', ['https://example.com/support-tickets/a.jpg']],
    ['不是 cloud://', ['support-tickets/202610/a.jpg']],
    ['别的目录', ['cloud://x.y/identify/a.jpg']],
    ['路径穿越', ['cloud://x.y/support-tickets/../identify/a.jpg']],
    ['不是数组', R8_IMG(1)]
  ]
  for (const [label, images] of reject8) {
    const r = runTicketFn(src.ticketFn, { ...base8, images })
    ok(r.calls.length === 0, `R8-1 服务端放行了非法 images（${label}）`)
  }
  const plain = runTicketFn(src.ticketFn, { message: '短' })
  ok(plain.calls.length === 0, 'R8-1 原有「至少 5 个字」校验被破坏')
  const fbSubmit = (src.feedbackJs.match(/async submitFeedback\(\) \{[\s\S]*?\n  \},/) || [''])[0]
  ok(/data: \{\n\s*topic: 'feedback',\n\s*message: payload,\n\s*contactPhone: phone,\n\s*\.\.\.\(imageIDs\.length \? \{ images: imageIDs \} : \{\}\)\n\s*\}/.test(fbSubmit), 'R8-3 意见反馈入参被改，或没带上 images')
  ok(/if \(this\.data\.submitting \|\| this\.data\.ticketImgBusy\) return/.test(fbSubmit) && /if \(this\.data\.submitting \|\| this\.data\.ticketImgBusy\) return;/.test(submit), 'R8-3 图片没传完也能提交')
  ok(/disabled="\{\{submitting \|\| ticketImgBusy\}\}"/.test(src.supportWxml) && /account-btn-primary \{\{submitting \|\| ticketImgBusy \? 'disabled' : ''\}\}/.test(src.feedbackWxml), 'R8-3 提交按钮在图片上传完之前仍可点')
  for (const [name, wx] of [['support', src.supportWxml], ['feedback', src.feedbackWxml]]) {
    ok(/catchtap="retryTicketImage"/.test(wx) && /catchtap="removeTicketImage"/.test(wx) && /上传中…/.test(wx) && /bindtap="chooseTicketImages"/.test(wx) && /ticketImages\.length < maxTicketImages/.test(wx), `R8-3 ${name} 附图缺缩略图 / 删除 / 上传中 / 失败重试之一`)
  }
  const ti = src.ticketImagesJs
  ok(/const MAX_TICKET_IMAGES = 3\b/.test(ti) && /const IMAGE_EDGE = 1280\b/.test(ti) && /width > IMAGE_EDGE[^\n]*compressedWidth = IMAGE_EDGE/.test(ti) && /wx\.chooseMedia\(/.test(ti) && /wx\.cloud\.uploadFile\(/.test(ti) && /const DIR = 'support-tickets'/.test(ti) && /fileID\.indexOf\('cloud:\/\/'\) !== 0/.test(ti), 'R8-4 上传做法偏离（最多 3 张 / 宽 > 1280 压缩 / chooseMedia / uploadFile / support-tickets 目录 / 只收 cloud://）')
  ok(/loadTicketImages\(t\)/.test(src.ticketsVue) && /getTempFileUrls\(ids\)/.test(src.ticketsVue) && /t\?\.images/.test(src.ticketsVue) && /:preview-src-list="ticketImageUrls"/.test(src.ticketsVue), 'R8-5 ERP 留言工单看不到顾客附图（images）')

  // R9 出货中心 / 核对出货单底部弹层可滚动（产品负责人 2026-10-08 真机：选择包装方式 / 原材料滑不动）
  const r9Pages = [
    ['shipment-ops', src.shipOpsWxml, src.shipOpsJs],
    ['shipment-edit', src.shipEditWxml, src.shipEditJs]
  ]
  for (const [name, wxml, js] of r9Pages) {
    const body = stripComments(wxml)
    const tags = body.match(R9_TAG) || []
    const scrolls = tags.filter((t) => t.startsWith('<scroll-view') && /\sscroll-y\b/.test(t))
    ok(scrolls.length > 0, `R9-1 ${name} 找不到弹层 scroll-view`)
    scrolls.forEach((t) => {
      ok(/style="[^"]*height:\s*\{\{\s*sheetBodyPx\s*\}\}px/.test(t), `R9-1 ${name} 的 scroll-view 没有内联 height:{{sheetBodyPx}}px：${t.slice(0, 70)}`)
      ok(!/catchtouchmove/.test(t), `R9-5 ${name} 的 scroll-view 上挂了 catchtouchmove（列表会滑不动）`)
    })
    ok(/sheetBodyPx:\s*sheetBodyPx\(\)/.test(js), `R9-1 ${name} 的 onLoad 没写入 sheetBodyPx`)
    const sheets = tags.filter((t) => r9Classes(t).some((c) => /^(ss|ops|se)-sheet$/.test(c)))
    ok(sheets.length > 0, `R9-5 ${name} 找不到底部弹层`)
    sheets.forEach((t) => ok(!/catchtouchmove/.test(t), `R9-5 ${name} 弹层容器挂了 catchtouchmove（会吞掉内部列表滚动）：${t.slice(0, 70)}`))
    tags.filter((t) => r9Classes(t).some((c) => /^(ss|ops|se)-mask$/.test(c))).forEach((t) => {
      ok(/catchtouchmove="noop"/.test(t), `R9-5 ${name} 遮罩缺 catchtouchmove（背后页面会跟着滚）：${t.slice(0, 70)}`)
    })
    tags.filter((t) => r9Classes(t).some((c) => /^(ss|ops|se)-sheet-head$|^(ss|se)-search$/.test(c)) || /class="ss-actions is-in-sheet"/.test(t)).forEach((t) => {
      ok(/catchtouchmove="noop"/.test(t), `R9-5 ${name} 弹层固定区（标题 / 搜索 / 底部按钮）缺 catchtouchmove：${t.slice(0, 70)}`)
    })
    const meta = body.trimStart().match(/^<page-meta\s+page-style="([^"]*)"/)
    ok(!!meta && /overflow:\s*hidden/.test(meta[1]), `R9-6 ${name} 第一个节点不是 page-meta 锁背后页面滚动`)
    sheets.forEach((t) => {
      const cond = ((t.match(/wx:if="\{\{([^}]*)\}\}"/) || [])[1] || '').split('&&')[0].trim()
      ok(!!cond && !!meta && meta[1].includes(cond), `R9-6 ${name} 弹层「${cond || '?'}」打开时 page-meta 没锁背后页面`)
    })
  }
  const opsCss = [src.opsMuseumWxss, src.shipSkuWxss, src.shipOpsWxss]
  const r9Bodies = [
    ['.ss-sheet-body', opsCss.map((c) => [c, '.ss-sheet-body'])],
    ['.sc-detail-body', [[src.opsMuseumWxss, '.ops-sheet-body'], [src.shipOpsWxss, '.sc-detail-body']]],
    ['.se-sheet-body', [[src.shipEditWxss, '.se-sheet-body']]]
  ]
  for (const [label, pairs] of r9Bodies) {
    const d = cssDecls(pairs)
    ok(/^(0 1 auto|0 0 auto|none)$/.test(d.flex || '') && !d['flex-basis'] && !d['flex-grow'], `R9-2 ${label} 的 flex 不是 0 1 auto（flex: 1 会无视内联高度、按内容撑开而滑不动；实得 ${d.flex || '无'}）`)
    ok(d['min-height'] === '0', `R9-2 ${label} 缺 min-height: 0`)
    ok(!d['max-height'] || d['max-height'] === 'none', `R9-2 ${label} 又写了 max-height（${d['max-height']}），高度只认内联 sheetBodyPx`)
  }
  const r9Sheets = [
    ['.ss-sheet', opsCss.map((c) => [c, '.ss-sheet'])],
    ['.sc-detail-sheet', [[src.opsMuseumWxss, '.ops-sheet'], [src.shipOpsWxss, '.sc-detail-sheet']]],
    ['.se-sheet', [[src.shipEditWxss, '.se-sheet']]]
  ]
  for (const [label, pairs] of r9Sheets) {
    const d = cssDecls(pairs)
    const vh = Number(((d['max-height'] || '').match(/^(\d+(?:\.\d+)?)vh$/) || [])[1])
    ok(vh > 0 && vh <= 80, `R9-3 ${label} 高度上限不是 ≤ 80vh（实得 ${d['max-height'] || '无'}）`)
    ok(d.overflow === 'hidden', `R9-3 ${label} 缺 overflow: hidden`)
    ok(/env\(safe-area-inset-bottom\)/.test(d['padding-bottom'] || ''), `R9-3 ${label} 底部没留安全区`)
  }
  for (const [label, pairs] of [
    ['.ss-sheet-head', [[src.shipSkuWxss, '.ss-sheet-head']]],
    ['.ss-search', [[src.shipSkuWxss, '.ss-search']]],
    ['.ss-actions.is-in-sheet', [[src.shipSkuWxss, '.ss-actions.is-in-sheet']]],
    ['.se-sheet-head', [[src.shipEditWxss, '.se-sheet-head']]],
    ['.se-search', [[src.shipEditWxss, '.se-search']]]
  ]) {
    ok(cssDecls(pairs)['flex-shrink'] === '0', `R9-4 ${label} 缺 flex-shrink: 0（标题 / 搜索 / 按钮会被列表挤扁）`)
  }
  const r9Devices = [
    ['iPhone 13（有底部安全区）', { windowHeight: 750, screenHeight: 844, safeArea: { bottom: 810 } }, 34],
    ['iPhone SE（无安全区）', { windowHeight: 603, screenHeight: 667, safeArea: { bottom: 667 } }, 0]
  ]
  for (const [label, info, safe] of r9Devices) {
    for (const [api, fakeWx] of [['getWindowInfo', { getWindowInfo: () => info }], ['getSystemInfoSync', { getSystemInfoSync: () => info }]]) {
      const px = runSheetBodyPx(src.shipShared, fakeWx)
      const cap = Math.floor(info.windowHeight * 0.8)
      ok(Number.isFinite(px) && px + 120 + safe <= cap && px + 120 + safe >= cap - 40, `R9-7 ${label}（${api}）弹层列表高 ${px}px：整层须 ≤ 80% 窗高且扣掉底部安全区`)
    }
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
    ['死样式 .cfg-picker 复活', (s) => ({ ...s, hubWxss: s.hubWxss + '\n.cfg-picker { display: flex; }\n' }), /死样式复活：\.cfg-picker/],
    ['请假提交去掉「提交中…」', (s) => ({ ...s, leaveWxml: s.leaveWxml.replace("{{submitting ? '提交中…' : '提交请假'}}", '提交请假') }), /leave\/index\.wxml 「submit」提交中没有/],
    ['审批通过去掉按压态', (s) => ({ ...s, leaveReviewWxml: s.leaveReviewWxml.replace(/(<view class="btn approve[^"]*") hover-class="btn-primary-press" hover-stay-time="100"/, '$1') }), /leave-review\/index\.wxml 「review」按钮缺按压态/],
    ['日报复制按钮又重复', (s) => ({ ...s, digestWxml: s.digestWxml.replace('<view class="dg-foot">', '<view class="dg-tools"><view class="dg-tool" bindtap="shareDigestSheet"><text>复制 / 分享摘要</text></view></view>\n              <view class="dg-foot">') }), /复制摘要」应只有底部一处/],
    ['飞书页回到「云函数」', (s) => ({ ...s, feishuWxml: s.feishuWxml.replace('飞书凭据还没配置', '飞书凭据还没配到云函数') }), /feishu-sync\/index\.wxml 界面出现技术词「云函数」/],
    ['礼赠履约「去发货」去掉按压态', (s) => ({ ...s, __pages: { ...s.__pages, [`${MGR}/gift-ops`]: s.__pages[`${MGR}/gift-ops`].replace(/<view hover-class="wb-press" hover-stay-time="80" (class="mini-btn primary"[^>]*catchtap="goOrderManage")/, '<view $1') } }), /R3-1 .*gift-ops 有 1 处可点元素缺按压态/],
    ['app.wxss 丢了全局 .wb-press', (s) => ({ ...s, appWxss: s.appWxss.replace('.tap-press, .wb-press {', '.tap-press {') }), /R3-1 app\.wxss 缺全局 \.wb-press/],
    ['订单卡「发货」去掉按压态', (s) => ({ ...s, subviews: s.subviews.replace(/<view hover-class="wb-press" hover-stay-time="80" (class="om-btn ship")/, '<view $1') }), /R3-1 订单卡/],
    ['发票列表退回「加载中…」', (s) => ({ ...s, invoiceWxml: s.invoiceWxml.replace('class="ir-skeleton" wx:if="{{loading && !list.length}}"', 'class="loading-hint" wx:if="{{loading}}"') }), /R3-2 发票列表首次加载/],
    ['工资条回到 @import scene.wxss', (s) => ({ ...s, payslipWxss: '@import "../staff/scene.wxss";\n' + s.payslipWxss }), /R3-3 工资条又 @import/],
    ['工资条内联漏了 .amount-row', (s) => ({ ...s, payslipWxss: s.payslipWxss.replace(/\n\.amount-row \{[^}]*\}/, '') }), /R3-3 工资条内联样式缺 \.amount-row/],
    ['积分规则说明回到集合名', (s) => ({ ...s, storePointsWxml: s.storePointsWxml.replace('保存后改按这里的设置执行。', '保存后即写入 store_point_rules。') }), /R3-2 门店积分/],
    ['定金卡回到 openid 片段', (s) => ({ ...s, depositWxml: s.depositWxml.replace('会员 {{item.memberLabel}}', '会员 {{item.openidShort}}') }), /R4-1 定金意向卡没有显示/],
    ['定金会员标识顺手读手机号', (s) => ({ ...s, depositFn: s.depositFn.replace('.field({ _openid: true, nickName: true, memberNo: true })', '.field({ _openid: true, nickName: true, memberNo: true, phone: true })') }), /R4-1 attachMemberLabels 读 users 的字段超出/],
    ['定金会员标识不再展开原行', (s) => ({ ...s, depositFn: s.depositFn.replace(/\n      \.\.\.r,\n      memberNickName:/, '\n      openid: r.openid,\n      memberNickName:') }), /R4-1 attachMemberLabels 不是在原行上只新增字段/],
    ['审批回到全局「处理中…」', (s) => ({ ...s, apWxml: s.apWxml.replace("decidingId === item._id && decidingAction === 'approve' ? '处理中…'", "deciding ? '处理中…'") }), /R4-2 审批「approveItem」的「处理中…」不是只在被点的卡上/],
    ['审批复位漏清 decidingId', (s) => ({ ...s, apJs: s.apJs.replace("this.setData({ deciding: false, decidingId: '', decidingAction: '' });", 'this.setData({ deciding: false });') }), /R4-2 审批 js 有 1 处复位/],
    ['被点的卡放开点击', (s) => ({ ...s, apWxss: s.apWxss.replace(/(\.btn-nudge\.is-busy\.is-current \{[^}]*?)opacity: 1;/, '$1opacity: 1; pointer-events: auto;') }), /R4-2 被点的卡须不压暗/],
    ['行为漏斗回到「注册钩子」', (s) => ({ ...s, subviews: s.subviews.replace('AI 识别 · 保存图鉴时引导注册', 'AI 识别 · 注册钩子') }), /R4-3 行为漏斗可见文案出现技术词「钩子」/],
    ['构建指纹搬出「更多」', (s) => ({ ...s, subviews: s.subviews.replace('<block wx:if="{{reportDiagOpen}}">', '<view class="visit-stats-row"><text class="visit-stats-name">构建指纹</text></view>\n          <block wx:if="{{reportDiagOpen}}">') }), /R4-3 行为漏斗可见文案出现技术词「指纹」/],
    ['行为漏斗改了数据绑定', (s) => ({ ...s, subviews: s.subviews.replace('analyticsReport.behavior.funnel.wishWall.ritualGate.resumeSuccess || 0', 'analyticsReport.behavior.funnel.wishWall.ritualGate.resumeTotal || 0') }), /R4-3 行为漏斗的数据绑定 funnel\.wishWall\.ritualGate\.resumeSuccess/],
    ['会员号覆盖了带手机号的旧调用', (s) => ({ ...s, staffFn: s.staffFn.replace("const memberNo = !phone ? normalizeMemberNo(event && event.memberNo) : ''", 'const memberNo = normalizeMemberNo(event && event.memberNo)') }), /R4-4 lookupByPhone 的 memberNo 不是/],
    ['会员号候选带出原手机号', (s) => ({ ...s, staffFn: s.staffFn.replace('        phoneMasked: maskPhone(user.phone),\n        name: user.name', '        phoneMasked: maskPhone(user.phone),\n        phone: user.phone,\n        name: user.name') }), /R4-4 会员号查人的候选带出了未脱敏手机号/],
    ['会员号规范化漏了 - / _', (s) => ({ ...s, staffFn: s.staffFn.replace('([A-Z0-9_-]{4})-([A-Z0-9_-]{4})$/) ||', '([A-Z0-9]{4})-([A-Z0-9]{4})$/) ||'), crmFn: s.crmFn.replace('([A-Z0-9_-]{4})-([A-Z0-9_-]{4})$/) ||', '([A-Z0-9]{4})-([A-Z0-9]{4})$/) ||') }), /R4-4 normalizeMemberNo\("MT--_XY-12ZZ"\)/],
    ['CRM 原匹配被改', (s) => ({ ...s, crmFn: s.crmFn.replace('if (nick.includes(k) || oid.includes(k) || id.includes(k) ||', 'if (nick.includes(k) || id.includes(k) ||') }), /R4-4 CRM 关键词原有的/],
    ['员工权限页缺会员号查找', (s) => ({ ...s, permWxml: s.permWxml.replace('bindtap="lookupStaffByMemberNo"', 'bindtap="noop"') }), /R4-4 员工权限页缺会员号查找/],
    ['已删镜像重新登记', (s) => ({ ...s, mirrors: s.mirrors.replace('[', '[\n  { "source": "subpackages/extra/staff/scene.wxss", "mirror": "subpackages/manager/staff/scene.wxss", "identical": true },') }), /R4-6 subpackage-mirrors\.json 又登记了已删镜像/],
    ['已删镜像文件复活', (s) => ({ ...s, __existing: [`${MGR}/staff/scene.wxss`] }), /R4-6 已删除的无引用镜像又出现/],
    ['工作台面板标题回到「渠道 / RATIO」', (s) => ({ ...s, hubWxml: s.hubWxml.replace('<view class="panel-title"><text class="panel-en">RATIO</text><text class="panel-cn">渠道占比</text></view>', '<view class="panel-title">渠道 / RATIO</view>') }), /R5 工作台面板标题不是/],
    ['金卡回到「GMV 本月营收」', (s) => ({ ...s, hubWxml: s.hubWxml.replace(/<view class="card-titles">[\s\S]*?<\/view>/, '<text class="card-label">GMV 本月营收</text>') }), /R5 工作台金卡标题不是两行/],
    ['页脚回到「- NATURE\'S ADMIN -」', (s) => ({ ...s, hubWxml: s.hubWxml.replace(/<view class="footer-logo">[\s\S]*?<\/view>/, '<view class="footer-logo">- NATURE\'S ADMIN -</view>') }), /R5 工作台页脚不是两行/],
    ['面板小标题样式改回同行', (s) => ({ ...s, hubWxss: s.hubWxss.replace('.panel-title .panel-en { display: block;', '.panel-title .panel-en { display: inline;') }), /R5 两行标题的样式被改回同行/],
    ['账本小标题回到「商场抽成｜MALL FEE」', (s) => ({ ...s, subviews: s.subviews.replace('<text class="lo-pt-en">MALL FEE</text><text class="lo-pt-cn">商场抽成</text>', '<text class="lo-pt-cn">商场抽成</text><text class="lo-pt-en">｜MALL FEE</text>') }), /R5 账本小标题不是/],
    ['账本表单回到「退款｜REFUND」', (s) => ({ ...s, __r5: { ...s.__r5, [FILES.subviews]: s.__r5[FILES.subviews].replace('<text>退款｜门店</text><input type="digit" value="{{tempRevenue.refund}}"', '<text>退款｜REFUND</text><input type="digit" value="{{tempRevenue.refund}}"') } }), /R5 同一行中英并列 1 处.*退款｜REFUND/],
    ['观测台回到「核心指标 / KPI」', (s) => ({ ...s, __r5: { ...s.__r5, [`${EXTRA}/inventory-ops/index.wxml`]: s.__r5[`${EXTRA}/inventory-ops/index.wxml`].replace('<text class="ops-section-label">核心指标</text>', '<text class="ops-section-label">核心指标 / KPI</text>') } }), /R5 同一行中英并列 1 处.*核心指标 \/ KPI/],
    ['表达式里混入「TOP 明细」', (s) => ({ ...s, __r5: { ...s.__r5, [`${EXTRA}/purchase-ops/index.wxml`]: s.__r5[`${EXTRA}/purchase-ops/index.wxml`].replace("'展开主体 · 状态 · 排行明细'", "'展开主体 · 状态 · TOP 明细'") } }), /R5 同一行中英并列 1 处/],
    ['骨架呼吸动画被删', (s) => ({ ...s, appWxss: s.appWxss.replace('animation: ui-sk-pulse 1.2s', 'animation: none; --x: 1.2s') }), /R1-1 骨架样式 \/ 呼吸动画缺失/],
    ['hubNav 复活 .wb-press 副本', (s) => ({ ...s, __r6css: { ...s.__r6css, [`${MGR}/manager/hubNav.wxss`]: s.__r6css[`${MGR}/manager/hubNav.wxss`] + '\n.wb-press { opacity: 0.72; }\n' } }), /R6-1 页面 wxss 又自带 \.wb-press.*manager\/manager\/hubNav\.wxss/],
    ['审批骨架回到 ap-sk-line', (s) => ({ ...s, __r5: { ...s.__r5, [`${EXTRA}/approvals/index.wxml`]: s.__r5[`${EXTRA}/approvals/index.wxml`].replace('class="ui-sk-line title"', 'class="ap-sk-line ap-sk-title"') } }), /R6-2 extra\/approvals\/index\.wxml 骨架还在用旧行类/],
    ['b2bdesk skel-line 没挂 ui-sk-line', (s) => ({ ...s, __r5: { ...s.__r5, ['miniprogram/subpackages/b2bdesk/center/index.wxml']: s.__r5['miniprogram/subpackages/b2bdesk/center/index.wxml'].replace('ui-sk-line skel-line', 'skel-line') } }), /R6-2 b2bdesk\/center\/index\.wxml 的 skel-\* 没挂 ui-sk-\*/],
    ['运营骨架复活自带呼吸动画', (s) => ({ ...s, __r6css: { ...s.__r6css, [`${EXTRA}/utils/ops-museum.wxss`]: s.__r6css[`${EXTRA}/utils/ops-museum.wxss`] + '\n@keyframes ops-sk-pulse { 50% { opacity: 0.5; } }\n' } }), /R6-2 extra\/utils\/ops-museum\.wxss 又自带骨架行/],
    ['b2bdesk 骨架又写底色', (s) => ({ ...s, __r6css: { ...s.__r6css, ['miniprogram/subpackages/b2bdesk/desk-common.wxss']: s.__r6css['miniprogram/subpackages/b2bdesk/desk-common.wxss'].replace('.skel-line {', '.skel-line { background: #262320;') } }), /R6-2 b2bdesk\/desk-common\.wxss 的骨架规则又写了底色/],
    ['留言正文退回 .p-name', (s) => ({ ...s, subviews: s.subviews.replace(/<text class="ticket-msg \{\{item\.canExpand[^\n]*/, '<text class="p-name">{{item.message}}</text>') }), /R7-1 留言正文又用 \.p-name/],
    ['.ticket-msg 去掉 pre-wrap', (s) => ({ ...s, hubWxss: s.hubWxss.replace('white-space: pre-wrap; word-break', 'white-space: nowrap; word-break') }), /R7-1 \.ticket-msg 不是 pre-wrap/],
    ['右上角回到 openid 片段', (s) => ({ ...s, subviews: s.subviews.replace('{{item.who}}</text>', '{{item.openidMask}}</text>') }), /R7-4 留言卡右上角又显示 openid/],
    ['回复弹层去掉原留言', (s) => ({ ...s, subviews: s.subviews.replace('<text class="ticket-msg" user-select wx:if="{{!tempTicketReply.bodyEmpty}}">{{tempTicketReply.body}}</text>', '') }), /R7-3 回复弹层看不到顾客原留言/],
    ['前缀拆分把正文吞掉', (s) => ({ ...s, ticketView: s.ticketView.replace('body: raw.slice(m[0].length).trim()', "body: ''") }), /R7-2 正文 \/ 昵称 \/ 附图拆分不对/],
    ['长留言被截断', (s) => ({ ...s, ticketView: s.ticketView.replace('const { contextLine, body } = splitTicketMessage(row.message)', 'const { contextLine, body: full } = splitTicketMessage(row.message); const body = full.slice(0, 66)') }), /R7-2 长留言被截断/],
    ['会员号回退丢失', (s) => ({ ...s, ticketView: s.ticketView.replace('const memberNo = row.memberNo || buildMemberNo(row._openid)', 'const memberNo = row.memberNo') }), /R7-4 无昵称时右上角不是会员号/],
    ['会员标识顺手读手机号', (s) => ({ ...s, msgAdminFn: s.msgAdminFn.replace('.field({ _openid: true, nickName: true, memberNo: true })', '.field({ _openid: true, nickName: true, memberNo: true, phone: true })') }), /R7-4 attachMemberLabels 读 users 字段超出/],
    ['顾客端放行只有前缀的留言', (s) => ({ ...s, supportJs: s.supportJs.replace('if (message.length < 5 || body.length < 2) {', 'if (message.length < 5) {') }), /R7-5 顾客端只提交预填前缀/],
    ['服务端放行 4 张图', (s) => ({ ...s, ticketFn: s.ticketFn.replace('raw.length > MAX_TICKET_IMAGES', 'raw.length > 9') }), /R8-1 服务端放行了非法 images（4 张）/],
    ['服务端不校验 cloud://', (s) => ({ ...s, ticketFn: s.ticketFn.replace("!id || id.indexOf('cloud://') !== 0 || id.indexOf('..') !== -1 || !TICKET_IMAGE_RE.test(id)", '!id') }), /R8-1 服务端放行了非法 images（https 链接）/],
    ['服务端放行路径穿越', (s) => ({ ...s, ticketFn: s.ticketFn.replace(" || id.indexOf('..') !== -1", '') }), /R8-1 服务端放行了非法 images（路径穿越）/],
    ['不传 images 也写字段', (s) => ({ ...s, ticketFn: s.ticketFn.replace('...(hasImages ? { images } : {}),', 'images: images || [],') }), /R8-2 不传 images 时也写了/],
    ['联系专员不带 images', (s) => ({ ...s, supportJs: s.supportJs.replace('contactPhone: phone,\n          ...(imageIDs.length ? { images: imageIDs } : {})', 'contactPhone: phone') }), /R7-5 submitSupportTicket 入参被改/],
    ['图片上传中按钮可点', (s) => ({ ...s, supportWxml: s.supportWxml.replace('disabled="{{submitting || ticketImgBusy}}"', 'disabled="{{submitting}}"') }), /R8-3 提交按钮在图片上传完之前仍可点/],
    ['反馈页上传中可提交', (s) => ({ ...s, feedbackJs: s.feedbackJs.replace('if (this.data.submitting || this.data.ticketImgBusy) return', 'if (this.data.submitting) return') }), /R8-3 图片没传完也能提交/],
    ['反馈页失败不能重试', (s) => ({ ...s, feedbackWxml: s.feedbackWxml.replace(' catchtap="retryTicketImage"', '') }), /R8-3 feedback 附图缺/],
    ['大图不压缩', (s) => ({ ...s, ticketImagesJs: s.ticketImagesJs.replace('const IMAGE_EDGE = 1280', 'const IMAGE_EDGE = 4096') }), /R8-4 上传做法偏离/],
    ['ERP 不加载附图', (s) => ({ ...s, ticketsVue: s.ticketsVue.replace('  loadTicketImages(t)\n', '') }), /R8-5 ERP 留言工单看不到/],
    ['工作台说明字退回 muted', (s) => ({ ...s, __r6css: { ...s.__r6css, [FILES.hubWxss]: s.__r6css[FILES.hubWxss].replace(/(\.lo-kpi-hint \{[^}]*?)color: var\(--color-text-secondary, #A09A90\)/, '$1color: var(--color-text-muted)') } }), /R6-3 .*manager\/manager\/index\.wxss \.lo-kpi-hint/],
    ['选择器列表去掉内联高度', (s) => ({ ...s, shipOpsWxml: s.shipOpsWxml.replace(/(<!-- 原材料 \/ 包装方式选择器 -->[\s\S]*?<scroll-view class="ss-sheet-body" scroll-y) style="height: \{\{sheetBodyPx\}\}px;"/, '$1') }), /R9-1 shipment-ops 的 scroll-view 没有内联/],
    ['核对页列表去掉内联高度', (s) => ({ ...s, shipEditWxml: s.shipEditWxml.replace('scroll-y style="height: {{sheetBodyPx}}px;"', 'scroll-y') }), /R9-1 shipment-edit 的 scroll-view 没有内联/],
    ['核对页 onLoad 不写高度', (s) => ({ ...s, shipEditJs: s.shipEditJs.replace('this.setData({ sheetBodyPx: sheetBodyPx() })', '') }), /R9-1 shipment-edit 的 onLoad 没写入/],
    ['.ss-sheet-body 回到 flex: 1', (s) => ({ ...s, shipSkuWxss: s.shipSkuWxss.replace('.ss-sheet-body { flex: 0 1 auto;', '.ss-sheet-body { flex: 1;') }), /R9-2 \.ss-sheet-body 的 flex 不是/],
    ['.ss-sheet-body 去掉 min-height: 0', (s) => ({ ...s, shipSkuWxss: s.shipSkuWxss.replace('.ss-sheet-body { flex: 0 1 auto; min-height: 0;', '.ss-sheet-body { flex: 0 1 auto;') }), /R9-2 \.ss-sheet-body 缺 min-height/],
    ['index.wxss 后写覆盖成 flex: 1', (s) => ({ ...s, shipOpsWxss: s.shipOpsWxss + '\n.ss-sheet-body { flex: 1; }\n' }), /R9-2 \.ss-sheet-body 的 flex 不是/],
    ['详情列表回到 ops-sheet-body 的 flex: 1', (s) => ({ ...s, shipOpsWxss: s.shipOpsWxss.replace('.sc-detail-body { flex: 0 1 auto; min-height: 0; max-height: none; }', '.sc-detail-body { max-height: none; }') }), /R9-2 \.sc-detail-body 的 flex 不是/],
    ['.se-sheet-body 回到 max-height 58vh', (s) => ({ ...s, shipEditWxss: s.shipEditWxss.replace('  min-height: 0;\n  padding: 0 20rpx 28rpx;', '  min-height: 0;\n  max-height: 58vh;\n  padding: 0 20rpx 28rpx;') }), /R9-2 \.se-sheet-body 又写了 max-height/],
    ['弹层上限回到 86vh', (s) => ({ ...s, shipSkuWxss: s.shipSkuWxss.replace('max-height: 80vh; overflow: hidden;', 'max-height: 86vh; overflow: hidden;') }), /R9-3 \.ss-sheet 高度上限/],
    ['弹层去掉底部安全区', (s) => ({ ...s, shipEditWxss: s.shipEditWxss.replace('  padding-bottom: env(safe-area-inset-bottom);\n', '') }), /R9-3 \.se-sheet 底部没留安全区/],
    ['搜索框可被挤扁', (s) => ({ ...s, shipSkuWxss: s.shipSkuWxss.replace('.ss-search { flex-shrink: 0;', '.ss-search {') }), /R9-4 \.ss-search 缺 flex-shrink/],
    ['弹层容器挂 catchtouchmove', (s) => ({ ...s, shipOpsWxml: s.shipOpsWxml.replace('<view class="ss-sheet is-top" wx:if="{{picker.show}}">', '<view class="ss-sheet is-top" wx:if="{{picker.show}}" catchtouchmove="noop">') }), /R9-5 shipment-ops 弹层容器挂了 catchtouchmove/],
    ['列表挂 catchtouchmove', (s) => ({ ...s, shipEditWxml: s.shipEditWxml.replace('<scroll-view class="se-sheet-body" scroll-y', '<scroll-view class="se-sheet-body" catchtouchmove="noop" scroll-y') }), /R9-5 shipment-edit 的 scroll-view 上挂了/],
    ['核对页遮罩不挡穿透', (s) => ({ ...s, shipEditWxml: s.shipEditWxml.replace('bindtap="closePicker" catchtouchmove="noop"></view>', 'bindtap="closePicker"></view>') }), /R9-5 shipment-edit 遮罩缺/],
    ['搜索行不挡背后滚动', (s) => ({ ...s, shipOpsWxml: s.shipOpsWxml.replace('<view class="ss-search" catchtouchmove="noop">', '<view class="ss-search">') }), /R9-5 shipment-ops 弹层固定区/],
    ['page-meta 漏了选择器', (s) => ({ ...s, shipOpsWxml: s.shipOpsWxml.replace('skuForm.show || picker.show || libForm.show', 'skuForm.show || libForm.show') }), /R9-6 shipment-ops 弹层「picker\.show」/],
    ['page-meta 被删', (s) => ({ ...s, shipEditWxml: s.shipEditWxml.replace(/^<page-meta[^\n]*\n/, '') }), /R9-6 shipment-edit 第一个节点不是 page-meta/],
    ['弹层上限回到 86%', (s) => ({ ...s, shipShared: s.shipShared.replace('Math.floor(winH * 0.8) - 120', 'Math.floor(winH * 0.86) - 120') }), /R9-7 iPhone 13/],
    ['安全区退回不存在的 safeAreaInsets', (s) => ({ ...s, shipShared: s.shipShared.replace(/const safeBottom = [^\n]*/, 'const safeBottom = Number((sys.safeAreaInsets && sys.safeAreaInsets.bottom) || 0)') }), /R9-7 iPhone 13（有底部安全区）（getWindowInfo）/]
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
