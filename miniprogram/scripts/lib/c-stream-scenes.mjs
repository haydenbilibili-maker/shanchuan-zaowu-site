/**
 * render-c-stream-preview.mjs 的场景表：结构一律从真 wxml 现读，样例数据只填版式需要的字段。
 * 每轮在这里追加 / 替换本轮要交付的场景。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MP = process.env.C_STREAM_MP || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
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
  /* ── 2026-10-13 藏品库（提审前点名）：高风险一键上下线 / 水印可辨 / 分类展示层 ── */
  (() => {
    const pic = `file://${resolve(MP, '..', 'public/images/price-list/blue-morpho-dome-single.jpg')}`
    const libRow = (id, title, price, o) => ({
      _id: id, title, price, costPrice: '50', profitRate: o.rate, soldCountDisplay: '0', images: [pic],
      inArchive: true, isOneOfAKind: !!o.one, isHighRisk: !!o.risk, riskLabel: o.riskLabel || '',
      isOffShelf: !!o.off, shelfApprovalStatus: o.st || '', shelfWm: o.wm || '', shelfWmClass: o.wmClass || '',
      craftProcessLabel: '干制标本', craftTypeLabel: '相框', framerName: '阿棋', hasSku: false,
      seckill: { enabled: false }, groupBuying: { enabled: false }
    })
    return {
      name: 'r10-lib-risk', h: 1700, wxml: () => tabBlock(1), wxss: MGR_CSS,
      data: {
        curTab: 1, productLibTab: 'list', artisanEmbed: false,
        highRiskCount: 3, mediumRiskCount: 12, expiredSeckillCount: 1,
        productShelfCounts: { all: 5, on: 2, pending: 1, rejected: 1, off: 1 },
        productArchiveFilter: 'all', productPromoFilter: 'all', productRiskFilter: 'all', productShelfFilter: 'all',
        searchVal: '', productSort: 'new', productPriceSortLabel: '价格',
        productSortOptions: [{ key: 'new', label: '最新' }, { key: 'sales', label: '销量' }, { key: 'price', label: '价格', isPrice: true }],
        products: [
          libRow('p1', '药食同源手绘中药标本框', '499', { rate: '90.0', risk: true, riskLabel: '三有', wm: '已上架', wmClass: 'approved' }),
          libRow('p2', '伤寒论中药标本框', '299', { rate: '83.3', risk: true, riskLabel: '保护植物', st: 'pending', wm: '审核中', wmClass: 'pending' }),
          libRow('p3', '大蓝闪蝶 · 原木框', '399', { rate: '87.5', risk: true, riskLabel: '保护动物' }),
          libRow('p4', '绿尾大蚕蛾标本框', '299', { rate: '83.3', off: true, wm: '已下架', wmClass: 'offshelf' }),
          libRow('p5', '金裳凤蝶标本框', '899', { rate: '92.0', one: true, st: 'rejected', wm: '已驳回', wmClass: 'rejected' })
        ],
        productTotal: 5, productHasMore: false, productListLoading: false, productListError: false, bulkRiskRunning: false
      }
    }
  })(),
  (() => {
    const catTreeView = [
      { _id: 'c1', name: '昆虫馆', enName: 'INSECTA', totalCount: 128, hiddenCount: 0, children: [
        { _id: 'c1a', name: '蝴蝶', productCount: 128, isEmpty: false, latinName: 'Lepidoptera' },
        { _id: 'c1b', name: '甲虫', productCount: 32, isEmpty: false, latinName: 'Coleoptera' }
      ] },
      { _id: 'c2', name: '植物馆', enName: 'PLANTAE', totalCount: 0, hiddenCount: 0, children: [
        { _id: 'c2a', name: '苔藓', productCount: 0, isEmpty: true, latinName: 'Bryophyta' }
      ] }
    ]
    return {
      name: 'r10-lib-category-default', h: 1500, wxml: () => tabBlock(1), wxss: MGR_CSS,
      data: {
        curTab: 1, productLibTab: 'category', catZone: 'category', canProductFields: false, artisanEmbed: false,
        catKeyword: '', catSortMode: 'default', catOnlyEmpty: false, catEmptyCount: 1,
        catMatchSummary: '', catTreeView,
        categoryManageTree: catTreeView, catManageRootNames: ['昆虫馆', '植物馆'],
        newCatLevel: 1, newCatName: '', newCatEn: '', newCatParentIndex: 0
      }
    }
  })(),
  (() => {
    const catTreeView = [
      { _id: 'c1', name: '昆虫馆', enName: 'INSECTA', totalCount: 128, hiddenCount: 1, children: [
        { _id: 'c1a', name: '蝴蝶', productCount: 128, isEmpty: false, latinName: 'Lepidoptera' }
      ] },
      { _id: 'c2', name: '植物馆', enName: 'PLANTAE', totalCount: 0, hiddenCount: 0, children: [
        { _id: 'c2a', name: '苔藓', productCount: 0, isEmpty: true, latinName: 'Bryophyta' }
      ] }
    ]
    return {
      name: 'r10-lib-category', h: 1500, wxml: () => tabBlock(1), wxss: MGR_CSS,
      data: {
        curTab: 1, productLibTab: 'category', catZone: 'category', canProductFields: false, artisanEmbed: false,
        catKeyword: '馆', catSortMode: 'count', catOnlyEmpty: false, catEmptyCount: 2,
        catMatchSummary: '匹配 2 个一级 · 1 个二级', catTreeView,
        categoryManageTree: catTreeView, catManageRootNames: ['昆虫馆', '植物馆'],
        newCatLevel: 1, newCatName: '', newCatEn: '', newCatParentIndex: 0
      }
    }
  })(),
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
  { name: 'r3-payslip-after-list', h: 1600, wxml: () => read(PAYSLIP), wxss: PAYSLIP_AFTER_CSS, data: { ...payslipData, showDetail: false } },
  {
    name: 'r5-hub-dashboard',
    h: 1900,
    wxml: () => `<view class="container">${cutBetween(read(HUB), '<!-- 核心指标卡片', '<!-- 经营信号')}<view class="dashboard-grid">${cutBetween(read(HUB), '<!-- 数据图表', '<!-- 常用编辑面板')}`,
    wxss: MGR_CSS,
    data: {
      menu: { dashboardKpi: true, products: true }, chartLayout: {}, opsSignals: { mom: 'lamp-green', stock: 'lamp-amber' },
      stats: {
        displayGrand: '238,400', onlineTotal: '42,000', offlineTotal: '196,400', offlineSplitText: '山海 152,400 · 星宸 44,000',
        ratioEmpty: false, donutStyle: 'background: conic-gradient(#C4A76C 0 18%, #2E4A3A 18% 100%);', onlineRatio: 18, offlineRatio: 82,
        orderCountFmt: '126', avgOrderFmt: '¥333', visitCountFmt: '48', dailyAvgFmt: '7,946', momClass: 'up', momLabel: '+12%'
      },
      trendMeta: { empty: false, weekTotalFmt: '55,620', weekOnlineFmt: '9,820', weekOfflineFmt: '45,800', weekOnlineBar: 'width:18%', weekOfflineBar: 'width:82%' },
      trendData: ['25', '26', '27', '28', '29', '30', '01'].map((day, i) => ({
        dateKey: day, day, showVal: true, valShort: `${6 + i}k`, styleOnline: `height:${12 + i * 2}%`, styleOffline: `height:${40 + i * 4}%`
      })),
      dashStock: { ready: true, empty: false, onShelf: 312, offShelf: 46, stockTotal: 1288, topCats: [{ key: 'a', name: '蝴蝶', count: 128, barStyle: 'width:80%' }, { key: 'b', name: '甲虫', count: 96, barStyle: 'width:60%' }] }
    }
  },
  {
    name: 'r5-ledger-overview',
    h: 1700,
    wxml: () => tabBlock(8),
    wxss: MGR_CSS,
    data: {
      ...ledgerBase, ledgerOverviewReady: true, revenues: [],
      ledgerOverview: {
        empty: false, netFmt: '196,400.00', daysWithData: 30, posFmt: '152,300.00', cashBalanceFmt: '2,860.00', mpOnlineFmt: '42,000.00',
        mpRefundFmt: '0.00', pledgeDueFmt: '420.00', refundFmt: '320.00', dailyRevFmt: '6,546', dailyOrdersFmt: '4.2',
        totalOrderCountFmt: '126', avgOrderPriceFmt: '333', hasOrderData: true, orderHint: '',
        mall: { thresholdFmt: '170,000', reachedFmt: '196,400', excessFmt: '26,400', feeFmt: '6,864', formulaNote: '超 17 万部分 × 26%' },
        trend: ['25', '26', '27', '28', '29', '30'].map((label, i) => ({ label, barStyle: `height:${40 + i * 8}%` })),
        donutStyle: 'background: conic-gradient(#C4A76C 0 22%, #2E4A3A 22% 100%);',
        channels: [{ name: '刷卡', pct: 78, valueFmt: '152,300', color: '#2E4A3A' }, { name: '小程序', pct: 22, valueFmt: '42,000', color: '#C4A76C' }]
      }
    }
  },
  { name: 'r7-tickets', h: 1500, wxml: () => tabBlock(11), wxss: MGR_CSS, data: { curTab: 11, subTabMessage: 2, supportTickets: ticketRows() } },
  {
    name: 'r7-ticket-reply',
    h: 1334,
    wxml: () => `<view class="container workspace-leaf">${cutBetween(read(SUB), '<!-- 山海有信：留言回复 -->', '\n  <!--')}</view>`,
    wxss: MGR_CSS,
    extraCss: '.modal-mask, .modal-panel { animation: none !important; opacity: 1 !important; transform: none !important; }',
    data: { showTicketReplyModal: true, tempTicketReply: { ...ticketRows()[1], content: '' } }
  },
  {
    name: 'r8-support-images',
    h: 1400,
    wxml: () => `<view class="container">${cutBetween(read('subpackages/extra/user/support/index.wxml'), '<!-- 留言表单 -->', '<!-- 常见问题')}</view>`,
    wxss: ['subpackages/extra/user/support/index.wxss'],
    data: { messageText: '关于藏品「大蓝闪蝶 · 原木框」：\n框角这里有一道裂痕，附了照片', contactPhone: '', submitting: false, ...ticketImageData() }
  },
  {
    name: 'r8-feedback-images',
    h: 1700,
    wxml: () => read('subpackages/extra/user/feedback/index.wxml'),
    wxss: ['subpackages/extra/user/feedback/index.wxss'],
    data: { navPaddingRight: 16, headerBlockPx: 88, scrollHeightPx: 1450, categories: [{ id: 'feature', label: '功能建议' }, { id: 'experience', label: '体验问题' }, { id: 'content', label: '内容纠错' }, { id: 'other', label: '其他' }], activeCategory: 'experience', messageText: '订单页的物流信息刷新很慢，截了两张图', contactPhone: '', submitting: false, ...ticketImageData(true) }
  }
]

/** 附图三态样例：已上传 / 上传中 / 失败（done=true 时全部传完，按钮可点） */
function ticketImageData(done) {
  const pic = `file://${resolve(MP, '..', 'public/images/price-list/blue-morpho-dome-single.jpg')}`
  const list = done
    ? [{ key: 'a', local: pic, fileID: 'cloud://x/support-tickets/a.jpg', status: 'done' }, { key: 'b', local: pic, fileID: 'cloud://x/support-tickets/b.jpg', status: 'done' }]
    : [{ key: 'a', local: pic, fileID: 'cloud://x/support-tickets/a.jpg', status: 'done' }, { key: 'b', local: pic, fileID: '', status: 'uploading' }, { key: 'c', local: pic, fileID: '', status: 'failed' }]
  const failed = list.filter((x) => x.status === 'failed').length
  return { ticketImages: list, maxTicketImages: 3, ticketImgFailed: failed, ticketImgBusy: failed > 0 || list.some((x) => x.status === 'uploading') }
}

/** 第 1 条 = 2026-10-01 20:06:11 真实工单原样（message 只有预填前缀）；其余为写了正文 / 附图的样例 */
function ticketRows() {
  const mod = { exports: {} }
  new Function('module', 'exports', read('subpackages/manager/utils/supportTicketView.js'))(mod, mod.exports)
  const { buildTicketView } = mod.exports
  const fmt = (t) => t
  const pic = `file://${resolve(MP, '..', 'public/images/price-list/blue-morpho-dome-single.jpg')}`
  return [
    { _id: 't1', _openid: 'oa22s5xxxxxxxxxxxxxx3005E033', topicLabel: '藏品鉴赏', message: '关于藏品「忘忧尾蛱蝶植物标本框」：', productName: '忘忧尾蛱蝶植物标本框', createTime: '2026/10/1 20:06:11' },
    { _id: 't2', _openid: 'oXyz000000000000000000AB12CD34', memberNickName: '林小满', memberNo: 'MT-AB12-CD34', topicLabel: '藏品鉴赏', contactPhone: '13800001234', createTime: '2026/10/1 21:12:40',
      message: '关于藏品「大蓝闪蝶 · 原木框」：\n想送给父亲做生日礼物，框子能换成胡桃木的吗？\n另外礼盒能不能加一张手写卡，周六前能寄到上海吗？如果来不及我也可以到店自提，麻烦告诉我门店地址和营业时间，谢谢。' },
    { _id: 't3', _openid: 'oQwe000000000000000000EF56GH78', memberNickName: '', memberNo: '', topicLabel: '标本养护', createTime: '2026/10/1 21:30:02', message: '标本框玻璃里面起雾了，附了照片，请帮忙看看要怎么处理', images: [pic, pic] }
  ].map((r) => buildTicketView(r, fmt))
}
