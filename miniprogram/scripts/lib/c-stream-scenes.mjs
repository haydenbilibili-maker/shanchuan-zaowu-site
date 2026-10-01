/**
 * render-c-stream-preview.mjs 的场景表：结构一律从真 wxml 现读，样例数据只填版式需要的字段。
 * 每轮在这里追加 / 替换本轮要交付的场景。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MP = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel) => readFileSync(join(MP, rel), 'utf8')

const HUB = 'subpackages/manager/manager/index.wxml'
const WS = 'subpackages/manager/manager/workspace/index.wxml'
const SUB = 'subpackages/manager/manager/workspace/_subviews.wxml'
const AP = 'subpackages/extra/approvals/index.wxml'
const MGR_CSS = ['subpackages/manager/manager/workspace/index.wxss']
const AP_CSS = ['subpackages/extra/approvals/index.wxss']
const FIELD = 'subpackages/extra/staff/field/index.wxml'
const FIELD_CSS = ['subpackages/extra/staff/field/index.wxss']
const fieldBase = {
  ready: true, storeName: '山海造物', member: null, candidates: [], showMemberPassResult: false, pickupCodeInput: '',
  mineSummary: { count: 0, points: 0, amount: '0.00' }, canRevoke: false
}
const PAYSLIP = 'subpackages/manager/payslip/index.wxml'
const payslipData = {
  ready: true, roleHint: '店员', list: [{ _id: 'p1', month: '2026-09', net: '6,420.00' }, { _id: 'p2', month: '2026-08', net: '6,180.00' }],
  showSalesShare: true,
  salesShare: {
    storeScopeLabel: '山海造物 + 星宸', yearMonth: '2026-09', revenueScopeLabel: '本月营业额', monthRevenueFmt: '238,400.00', mallFeeFmt: '6,840.00',
    mallByStore: [{ storeId: 'a', name: '山海造物', detailText: '营业额 196,400 · 超 17 万部分 × 26%', mallFeeFmt: '6,864.00' }, { storeId: 'b', name: '星宸', detailText: '营业额 42,000 · 未达 17 万', mallFeeFmt: '0.00' }],
    shareBaseFmt: '231,560.00', rateLabel: '1.5%', shareAmountFmt: '3,473.40', formulaNote: '分成 = （营业额 − 商场抽成）× 比例'
  },
  showDetail: true,
  detail: { month: '2026-09', hasItems: true, items: [{ name: '基本工资', amount: '5,000.00', kind: 'add' }, { name: '销售分成', amount: '1,620.00', kind: 'add' }, { name: '社保个人', amount: '200.00', kind: 'deduct' }], grossDisplay: '6,620.00', deductDisplay: '200.00', net: '6,420.00' }
}
// 工资条样式已内联（第 3 轮）：改前对照图用 HEAD~ 的 @import 链临时出，逐像素一致
const PAYSLIP_AFTER_CSS = ['subpackages/manager/payslip/index.wxss']

// 页头（门店 / 今日汇总 / 灯语图例）本轮没动，截图隐藏以聚焦 Tab 内容
const FIELD_FOCUS_CSS = '.header { display: none; }'

function cutBetween(src, start, end) {
  const s = src.indexOf(start)
  if (s < 0) throw new Error(`锚点缺失：${start}`)
  const e = end ? src.indexOf(end, s + start.length) : -1
  return src.slice(s, e < 0 ? undefined : e)
}

function tabBlock(n) {
  const src = read(SUB)
  const start = `<block wx:if="{{curTab===${n}}}">`
  const s = src.indexOf(start)
  if (s < 0) throw new Error(`找不到 curTab===${n}`)
  const e = src.indexOf('<block wx:if="{{curTab===', s + start.length)
  return `<view class="container workspace-leaf"><view class="content-area sub-view">${src.slice(s, e)}</view></view>`
}

const ledgerRow = (day, date, net) => ({
  _id: date, day, date, totalFmt: net, posFmt: '3,120.00', cashBalanceFmt: '860.00', onlineFmt: '0.00',
  refundFmt: '0.00', mpOnlineFmt: '1,288.00', mpRefundFmt: '0.00', pledgeDueFmt: '12.88', mpNetFmt: '1,288.00'
})
const ledgerBase = {
  curTab: 8, isSuperAdmin: true, ledgerMonth: '2026-10', ledgerMonthLabel: '2026年10月',
  ledgerStoreId: 'a', ledgerStoreOptions: [{ storeId: 'a', name: '山海造物' }, { storeId: 'b', name: '星宸标本工作室' }],
  ledgerOverview: { empty: true }, ledgerSyncLampClass: 'lamp-muted'
}

const apItem = (id, title, extra = {}) => ({
  _id: id, title, status: 'pending', statusText: '待审核', actionLabel: '报销', summary: '门店耗材 · ¥128.00',
  metaLine: '店员 小林 · 今天 14:20', canDecide: true, canIgnore: false, detailLines: [], showAttachmentBlock: false, ...extra
})

export const SCENES = [
  {
    name: 'r1-hub-boot',
    h: 900,
    wxml: () => `<view class="container">${cutBetween(read(HUB), '<view class="workbench-boot', '<!-- ==================== 2.')}</view>`,
    wxss: MGR_CSS,
    data: { workspaceReady: false }
  },
  {
    name: 'r1-workspace-boot',
    h: 900,
    wxml: () => `<view class="container workspace-leaf">${cutBetween(read(WS), '<view class="workbench-boot', '<block wx:elif')}</view>`,
    wxss: MGR_CSS,
    data: { workspaceReady: false }
  },
  {
    name: 'r1-ledger-loading',
    h: 1334,
    wxml: () => tabBlock(8),
    wxss: MGR_CSS,
    data: { ...ledgerBase, ledgerOverviewReady: false, revenues: [ledgerRow('30', '2026-09-30', '4,980.00'), ledgerRow('29', '2026-09-29', '3,406.00')] }
  },
  {
    name: 'r1-ledger-empty',
    h: 1100,
    wxml: () => tabBlock(8),
    wxss: MGR_CSS,
    data: { ...ledgerBase, ledgerOverviewReady: true, revenues: [] }
  },
  {
    name: 'r1-orders-empty',
    h: 1000,
    wxml: () => tabBlock(2),
    wxss: MGR_CSS,
    data: {
      curTab: 2, subTab: 0, omQuery: '13800', omDays: 0, omSearchHint: '', omPendingCopyCount: 0,
      orders: [], shippedOrders: [], completedOrders: [], refunds: [], pendingPayOrders: [],
      ordersView: [], ordersLoading: false, menu: {}
    }
  },
  {
    name: 'r1-approvals-boot',
    h: 1000,
    wxml: () => read(AP),
    wxss: AP_CSS,
    data: { ready: false }
  },
  {
    name: 'r1-approvals-busy',
    h: 1334,
    wxml: () => read(AP),
    wxss: AP_CSS,
    data: {
      ready: true, canDecideTabs: true, viewMode: 'inbox', hubFlow: false, hubMode: '', overdueCount: 1, slaHours: 24,
      overviewExpanded: false, overviewReady: true, overviewSummary: '待我审 2 · 超时 1',
      auditHub: [{ key: 'points', label: '积分流水' }, { key: 'receipt', label: '小票认领' }],
      statusOptions: ['待审核'], statusIndex: 0, typeOptions: ['全部类型'], typeIndex: 0, total: 2, pendingBadge: 2,
      list: [apItem('a1', '报销 · 门店耗材'), apItem('a2', '请假 · 10 月 3 日', { actionLabel: '请假', summary: '事假 1 天' })],
      deciding: true, approvePendingId: 'a2', ignorePendingId: '', expandedId: '', loading: false, listError: false
    }
  },
  {
    name: 'r2-field-verify-loading',
    h: 1100,
    wxml: () => read(FIELD),
    wxss: FIELD_CSS,
    extraCss: FIELD_FOCUS_CSS,
    data: { ...fieldBase, curTab: 1, canVerifyPickup: true, pickupsLoading: true, bookingsLoading: true, pendingPickups: [], bookings: [] }
  },
  {
    name: 'r2-field-records-empty',
    h: 1000,
    wxml: () => read(FIELD),
    wxss: FIELD_CSS,
    extraCss: FIELD_FOCUS_CSS,
    data: { ...fieldBase, curTab: 2, records: [], recordsLoading: false, recordsError: '' }
  },
  {
    name: 'r3-invoice-loading',
    h: 1200,
    wxml: () => read('subpackages/manager/invoice-requests/index.wxml'),
    wxss: ['subpackages/manager/invoice-requests/index.wxss'],
    data: { ready: true, overviewReady: false, overviewLoading: true, statusOptions: ['全部', '待开具', '已开具', '已驳回'], statusIndex: 0, list: [], loading: true, listError: false, hasMore: false }
  },
  {
    name: 'r3-invoice-empty-filtered',
    h: 1200,
    wxml: () => read('subpackages/manager/invoice-requests/index.wxml'),
    wxss: ['subpackages/manager/invoice-requests/index.wxss'],
    data: { ready: true, overviewReady: false, overviewLoading: false, statusOptions: ['全部', '待开具', '已开具', '已驳回'], statusIndex: 2, list: [], loading: false, listError: false, hasMore: false }
  },
  { name: 'r3-payslip-after', h: 1600, wxml: () => read(PAYSLIP), wxss: PAYSLIP_AFTER_CSS, data: payslipData },
  { name: 'r3-payslip-after-list', h: 1600, wxml: () => read(PAYSLIP), wxss: PAYSLIP_AFTER_CSS, data: { ...payslipData, showDetail: false } }
]
