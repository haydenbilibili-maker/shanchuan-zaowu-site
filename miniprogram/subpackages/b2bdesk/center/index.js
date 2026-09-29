/**
 * 供应商管理中心（超管）：大盘 / 订单（只读）/ 价目 / 伙伴
 * 蓝图：admin/docs/供应商管理中心_Phase2_技术蓝图_2026-09-28.md
 * 全部数据经 manageSupplierDesk；服务端逐 action 校验超管。本页不直连集合、不调支付函数。
 */
const { callDesk, yuan } = require('../utils/deskApi')

const TABS = [
  { key: 'dash', label: '大盘' },
  { key: 'orders', label: '订单' },
  { key: 'price', label: '价目' },
  { key: 'partners', label: '伙伴' }
]

const RANGES = [
  { key: 'today', label: '今日' },
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
  { key: 'month', label: '本月' },
  { key: 'all', label: '全部' }
]

const DIRECTIONS = [
  { key: '', label: '全部方向' },
  { key: 'buyer', label: '采购商→总部' },
  { key: 'supplier', label: '总部→供货方' }
]

const STAGES = [
  { key: '', label: '全部进度' },
  { key: 'pendingConfirm', label: '待确认' },
  { key: 'toShip', label: '待发货' },
  { key: 'transit', label: '在途' },
  { key: 'received', label: '已签收' },
  { key: 'cancelled', label: '已取消' }
]

const PAYS = [
  { key: '', label: '全部货款' },
  { key: 'due', label: '待收款' },
  { key: 'offline', label: '对公待确认' },
  { key: 'review', label: '金额待核对' },
  { key: 'overdue', label: '已超期' },
  { key: 'received', label: '已收款' },
  { key: 'refunded', label: '已退款' }
]

const PRICE_STATUS = [
  { key: '', label: '全部' },
  { key: 'active', label: '上架中' },
  { key: 'inactive', label: '已下架' }
]

const PAY_TONE = { received: 'ok', refunded: 'danger', review: 'danger', offline: 'warn', due: 'warn', marked: 'warn', na: '' }
const STAGE_TONE = { received: 'ok', transit: 'brass', toShip: 'warn', pendingConfirm: 'warn', cancelled: 'danger', draft: '' }

function decorateOrder(o) {
  return { ...o, payTone: PAY_TONE[o.payBucket] || '', stageTone: STAGE_TONE[o.stage] || '' }
}

function dashView(res) {
  const d = res.dashboard || {}
  const o = d.orders || {}
  const m = d.money || {}
  const c = d.counts || {}
  const ag = d.aging || {}
  const openTotal = (ag['0-7'] || 0) + (ag['8-30'] || 0) + (ag['30+'] || 0)
  const pct = (n) => (openTotal ? Math.max(4, Math.round((n / openTotal) * 100)) : 0)
  return {
    rangeLabel: (d.range && d.range.label) || '',
    summary: {
      count: String(o.count || 0),
      amountText: yuan(o.amountFen),
      receivedText: yuan(m.receivedFen),
      receivedSub: `${c.received || 0} 单 · 微信实收`,
      dueText: yuan(m.dueFen),
      dueSub: `${c.due || 0} 单未付`,
      hasDue: !!m.dueFen
    },
    // 履约类：有数 = 常规高亮；异常类：有数 = 醒目（alert），为 0 = 弱化（mute）
    kpis: [
      { key: 'pendingConfirm', label: '待确认', value: String(o.pendingConfirm || 0), sub: '总部 / 供货方未确认', tone: o.pendingConfirm ? 'hot' : 'mute', dot: false },
      { key: 'toShip', label: '待发货', value: String(o.toShip || 0), sub: '已确认未发', tone: o.toShip ? 'hot' : 'mute', dot: false },
      { key: 'transit', label: '在途', value: String(o.transit || 0), sub: `已签收 ${o.received || 0} 单`, tone: o.transit ? '' : 'mute', dot: false },
      { key: 'offline', label: '对公待确认', value: yuan(m.offlineFen), sub: `${c.offline || 0} 单待财务确认`, tone: m.offlineFen ? 'alert' : 'mute', dot: !!m.offlineFen },
      { key: 'review', label: '金额待核对', value: yuan(m.reviewFen), sub: `${c.review || 0} 单实收≠应收`, tone: m.reviewFen ? 'alert' : 'mute', dot: !!m.reviewFen },
      { key: 'overdue', label: `超期（>${d.payTermDays || 7} 天）`, value: String(m.overdueCount || 0), sub: m.overdueCount ? `未结 ${yuan(m.overdueFen)}` : '无超期', tone: m.overdueCount ? 'alert' : 'mute', dot: !!m.overdueCount }
    ],
    extras: [
      m.refundedFen ? `已退款 ${yuan(m.refundedFen)}（${c.refunded || 0} 单）` : '',
      m.markedFen ? `验收标记 ${yuan(m.markedFen)}（${c.marked || 0} 单，非真实收款）` : '',
      o.cancelled ? `已取消 ${o.cancelled} 单（不计入金额）` : ''
    ].filter(Boolean),
    aging: [
      { key: '0-7', label: '0–7 天', count: ag['0-7'] || 0, pct: pct(ag['0-7'] || 0), warn: false },
      { key: '8-30', label: '8–30 天', count: ag['8-30'] || 0, pct: pct(ag['8-30'] || 0), warn: true },
      { key: '30+', label: '30 天以上', count: ag['30+'] || 0, pct: pct(ag['30+'] || 0), warn: true }
    ],
    agingTotal: openTotal,
    payable: {
      count: (d.payable && d.payable.count) || 0,
      amountText: yuan(d.payable && d.payable.amountFen),
      note: (d.payable && d.payable.note) || ''
    },
    byPartner: (d.byPartner || []).map((p, i) => ({
      rank: i + 1,
      key: p.key,
      name: p.name,
      kindLabel: p.kind === 'supplier' ? '供货方' : p.kind === 'buyer' ? '采购商' : '门店',
      count: p.count,
      amountText: yuan(p.amountFen),
      dueText: p.dueFen ? `待收 ${yuan(p.dueFen)}` : ''
    })),
    partnerStats: res.partnerStats || { buyers: 0, suppliers: 0, disabled: 0 },
    priceStats: res.priceStats || { active: 0, inactive: 0 },
    truncated: !!res.truncated
  }
}

/** 「关闭 N 项」只数本侧适用、且默认开的功能项（默认关的占位项不算） */
function partnerView(p, catalog) {
  const sideLabels = []
  if (p.sides && p.sides.buyer) sideLabels.push('采购商')
  if (p.sides && p.sides.supplier) sideLabels.push('供货方')
  return {
    ...p,
    sideText: sideLabels.join(' / ') || '—',
    offCount: (catalog || []).filter((f) => f.def && (f.side === 'both' || (p.sides && p.sides[f.side])) && p.features && p.features[f.key] === false).length
  }
}

Page({
  data: {
    tabs: TABS,
    tab: 'dash',
    ranges: RANGES,
    directions: DIRECTIONS,
    stages: STAGES,
    pays: PAYS,
    priceStatuses: PRICE_STATUS,
    flash: '',
    flashErr: false,

    dash: { loading: true, error: '', view: null, range: '30d' },
    orders: { loading: false, loaded: false, error: '', list: [], total: 0, page: 1, hasMore: false, loadingMore: false,
      range: '30d', direction: '', stage: '', pay: '', keyword: '', partner: '', partnerName: '' },
    price: { loading: false, loaded: false, error: '', list: [], total: 0, page: 1, hasMore: false, loadingMore: false,
      status: '', keyword: '', canMove: false, counts: { all: 0, active: 0 }, busyId: '', armedId: '' },
    partners: { loading: false, loaded: false, error: '', list: [], status: '' }
  },

  onLoad(query) {
    const tab = TABS.some((t) => t.key === (query && query.tab)) ? query.tab : 'dash'
    this.setData({ tab })
    this.loadTab(tab)
  },

  onShow() {
    if (this._needRefresh) {
      const tab = this._needRefresh
      this._needRefresh = ''
      this.loadTab(tab, true)
    }
  },

  onPullDownRefresh() {
    this.loadTab(this.data.tab, true).then(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.tab === 'orders') this.loadOrders(true)
    else if (this.data.tab === 'price') this.loadPrice(true)
  },

  showFlash(msg, err) {
    this.setData({ flash: msg || '', flashErr: !!err })
    clearTimeout(this._flashTimer)
    if (msg) this._flashTimer = setTimeout(() => this.setData({ flash: '' }), 3200)
  },

  onUnload() {
    clearTimeout(this._flashTimer)
  },

  onTab(e) {
    const tab = e.currentTarget.dataset.key
    if (!tab || tab === this.data.tab) return
    this.setData({ tab, flash: '' })
    const loaded = tab === 'dash' ? !!this.data.dash.view : !!(this.data[tab] && this.data[tab].loaded)
    if (!loaded) this.loadTab(tab)
  },

  loadTab(tab, force) {
    if (tab === 'orders') return this.loadOrders(false, force)
    if (tab === 'price') return this.loadPrice(false, force)
    if (tab === 'partners') return this.loadPartners()
    return this.loadDash()
  },

  // ─── 大盘 ───
  loadDash() {
    this.setData({ 'dash.loading': true, 'dash.error': '' })
    return callDesk('adminDashboard', { range: this.data.dash.range }).then((res) => {
      if (!res.success) {
        this.setData({ 'dash.loading': false, 'dash.error': res.msg || '加载失败' })
        return
      }
      this.setData({ 'dash.loading': false, 'dash.view': dashView(res) })
    })
  },

  onDashRange(e) {
    const range = e.currentTarget.dataset.key
    if (range === this.data.dash.range) return
    this.setData({ 'dash.range': range })
    this.loadDash()
  },

  onDashPartner(e) {
    const { key, name } = e.currentTarget.dataset
    this.setData({
      tab: 'orders',
      'orders.partner': key || '',
      'orders.partnerName': name || '',
      'orders.range': this.data.dash.range
    })
    this.loadOrders(false, true)
  },

  onDashKpi(e) {
    const key = e.currentTarget.dataset.key
    const patch = { stage: '', pay: '' }
    if (key === 'toShip' || key === 'transit' || key === 'pendingConfirm') patch.stage = key
    else if (['due', 'offline', 'review', 'overdue', 'received'].indexOf(key) !== -1) patch.pay = key
    this.setData({
      tab: 'orders',
      'orders.stage': patch.stage,
      'orders.pay': patch.pay,
      'orders.partner': '',
      'orders.partnerName': '',
      'orders.range': key === 'overdue' ? 'all' : this.data.dash.range
    })
    this.loadOrders(false, true)
  },

  // ─── 订单（只读）───
  loadOrders(more, force) {
    const o = this.data.orders
    if (more && (!o.hasMore || o.loadingMore)) return Promise.resolve()
    if (!more && o.loading && !force) return Promise.resolve()
    const page = more ? o.page + 1 : 1
    this.setData(more ? { 'orders.loadingMore': true } : { 'orders.loading': true, 'orders.error': '' })
    return callDesk('adminListOrders', {
      page,
      range: o.range,
      direction: o.direction,
      stage: o.stage,
      pay: o.pay,
      keyword: o.keyword,
      partner: o.partner
    }).then((res) => {
      if (!res.success) {
        this.setData({ 'orders.loading': false, 'orders.loadingMore': false, 'orders.error': res.msg || '加载失败' })
        return
      }
      const rows = (res.list || []).map(decorateOrder)
      this.setData({
        'orders.loading': false,
        'orders.loadingMore': false,
        'orders.loaded': true,
        'orders.list': more ? o.list.concat(rows) : rows,
        'orders.total': res.total || 0,
        'orders.page': page,
        'orders.hasMore': !!res.hasMore,
        'orders.truncated': !!res.truncated
      })
    })
  },

  onOrderFilter(e) {
    const { field, key } = e.currentTarget.dataset
    if (!field || this.data.orders[field] === key) return
    this.setData({ [`orders.${field}`]: key })
    this.loadOrders(false, true)
  },

  onOrderKeyword(e) {
    this.setData({ 'orders.keyword': String(e.detail.value || '').trim() })
  },

  onOrderSearch() {
    this.loadOrders(false, true)
  },

  onClearPartner() {
    this.setData({ 'orders.partner': '', 'orders.partnerName': '' })
    this.loadOrders(false, true)
  },

  openOrder(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/subpackages/b2bdesk/order/index?id=${encodeURIComponent(id)}` })
  },

  // ─── 价目 ───
  loadPrice(more, force) {
    const p = this.data.price
    if (more && (!p.hasMore || p.loadingMore)) return Promise.resolve()
    if (!more && p.loading && !force) return Promise.resolve()
    const page = more ? p.page + 1 : 1
    this.setData(more ? { 'price.loadingMore': true } : { 'price.loading': true, 'price.error': '', 'price.armedId': '' })
    return callDesk('adminListPriceItems', { page, status: p.status, keyword: p.keyword }).then((res) => {
      if (!res.success) {
        this.setData({ 'price.loading': false, 'price.loadingMore': false, 'price.error': res.msg || '加载失败' })
        return
      }
      const rows = res.list || []
      this.setData({
        'price.loading': false,
        'price.loadingMore': false,
        'price.loaded': true,
        'price.list': more ? p.list.concat(rows) : rows,
        'price.total': res.total || 0,
        'price.page': page,
        'price.hasMore': !!res.hasMore,
        'price.canMove': !!res.canMove,
        'price.counts': res.counts || { all: 0, active: 0 }
      })
    })
  },

  onPriceStatus(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.price.status) return
    this.setData({ 'price.status': key })
    this.loadPrice(false, true)
  },

  onPriceKeyword(e) {
    this.setData({ 'price.keyword': String(e.detail.value || '').trim() })
  },

  onPriceSearch() {
    this.loadPrice(false, true)
  },

  newPrice() {
    this._needRefresh = 'price'
    wx.navigateTo({ url: '/subpackages/b2bdesk/price-edit/index' })
  },

  editPrice(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    this._needRefresh = 'price'
    wx.navigateTo({ url: `/subpackages/b2bdesk/price-edit/index?id=${encodeURIComponent(id)}` })
  },

  togglePrice(e) {
    const { id, status } = e.currentTarget.dataset
    if (!id || this.data.price.busyId) return
    const next = status === 'active' ? 'inactive' : 'active'
    this.setData({ 'price.busyId': id })
    callDesk('adminSetPriceStatus', { id, status: next }).then((res) => {
      this.setData({ 'price.busyId': '' })
      if (!res.success) return this.showFlash(res.msg, true)
      const list = this.data.price.list.map((r) => (r._id === id ? { ...r, status: next, retired: next === 'active' ? false : r.retired } : r))
      this.setData({ 'price.list': list })
      this.showFlash(res.msg)
    })
  },

  movePrice(e) {
    const { id, dir } = e.currentTarget.dataset
    if (!id || this.data.price.busyId) return
    this.setData({ 'price.busyId': id })
    callDesk('adminMovePriceItem', { id, direction: dir }).then((res) => {
      this.setData({ 'price.busyId': '' })
      if (!res.success) return this.showFlash(res.msg, true)
      if (!res.moved) return this.showFlash(res.msg)
      this.loadPrice(false, true)
    })
  },

  // ─── 伙伴 ───
  loadPartners() {
    this.setData({ 'partners.loading': true, 'partners.error': '' })
    return callDesk('adminListPartners', { status: this.data.partners.status }).then((res) => {
      if (!res.success) {
        this.setData({ 'partners.loading': false, 'partners.error': res.msg || '加载失败' })
        return
      }
      this.setData({
        'partners.loading': false,
        'partners.loaded': true,
        'partners.list': (res.list || []).map((p) => partnerView(p, res.catalog))
      })
    })
  },

  onPartnerStatus(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.partners.status) return
    this.setData({ 'partners.status': key })
    this.loadPartners()
  },

  openPartner(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    this._needRefresh = 'partners'
    wx.navigateTo({ url: `/subpackages/b2bdesk/partner/index?id=${encodeURIComponent(id)}` })
  },

  goStaffDirectory() {
    wx.navigateTo({ url: '/subpackages/manager/staff-directory/index' })
  },

  goPreview() {
    wx.navigateTo({ url: '/subpackages/extra/supplier/index' })
  },

  retry() {
    this.loadTab(this.data.tab, true)
  }
})
