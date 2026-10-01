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
  }
]
