/**
 * 采购商 · 我的采购单（source=buyer_workbench）
 * 支付旁路：payB2bPurchase；禁止跳转工作室页。
 */
const { guardManagerPage } = require('../../../../utils/managerAuth')
const { guardSupplierWorkspace } = require('../utils/supplierGate')
const { cartCount, readCart } = require('../utils/buyerCart')
const {
  listMyBuyerOrders,
  payBuyerOrder,
  requestB2bPay,
  paymentLabel,
  fulfillLabel,
  resultBannerFromQuery,
  isPayableStatus,
  nextStepForPayment,
  friendlyPayError
} = require('../utils/buyerPurchaseOrder')

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'unpaid', label: '待支付' },
  { key: 'paid', label: '已付/标记' },
  { key: 'offline', label: '待对公' }
]

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(typeof ts === 'object' && ts.toDate ? ts.toDate() : ts)
  if (Number.isNaN(d.getTime())) return ''
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${m}-${day} ${h}:${min}`
}

function normalizeRow(row, highlightId) {
  const pay = String(row.paymentStatus || 'unpaid')
  const status = String(row.status || '')
  const items = row.items || []
  const skuBrief = items
    .slice(0, 2)
    .map((it) => `${it.name}×${it.quantity || 1}`)
    .join(' · ')
  const more = items.length > 2 ? ` 等${items.length}项` : ''
  const paidLike = pay === 'paid' || pay === 'marked_paid'
  let payTone = 'neutral'
  if (isPayableStatus(pay)) payTone = 'warn'
  if (paidLike) payTone = 'ok'
  if (pay === 'offline_pending') payTone = 'info'
  if (pay === 'pay_review') payTone = 'warn'
  return {
    id: row._id,
    orderNo: row.orderNo || '—',
    status,
    fulfillText: fulfillLabel(status),
    paymentStatus: pay,
    paymentText: paymentLabel(pay),
    payTone,
    amountText: row.totalAmount != null ? `¥${row.totalAmount}` : '—',
    timeText: fmtTime(row.submittedAt || row.createdAt),
    itemsBrief: skuBrief + more || '无明细',
    canAct: isPayableStatus(pay) && status !== 'cancelled' && status !== 'closed',
    canPay:
      isPayableStatus(pay) &&
      status !== 'cancelled' &&
      status !== 'closed' &&
      row.pricingMode !== 'quote_required',
    paidLike,
    nextStep:
      row.pricingMode === 'quote_required' && isPayableStatus(pay)
        ? '含区间价/议价商品，需总部确认单价后付款；可先点「待对公」登记。'
        : nextStepForPayment(pay),
    highlight: highlightId && row._id === highlightId,
    paying: false
  }
}

function buildFilters(allRows) {
  const rows = allRows || []
  const unpaid = rows.filter((r) => isPayableStatus(r.paymentStatus)).length
  const paid = rows.filter(
    (r) => r.paymentStatus === 'paid' || r.paymentStatus === 'marked_paid'
  ).length
  const offline = rows.filter((r) => r.paymentStatus === 'offline_pending').length
  return [
    { key: 'all', label: rows.length ? `全部 ${rows.length}` : '全部' },
    { key: 'unpaid', label: unpaid ? `待支付 ${unpaid}` : '待支付' },
    { key: 'paid', label: paid ? `已付 ${paid}` : '已付/标记' },
    { key: 'offline', label: offline ? `待对公 ${offline}` : '待对公' }
  ]
}

function matchFilter(row, filter) {
  if (filter === 'all') return true
  if (filter === 'unpaid') {
    return isPayableStatus(row.paymentStatus)
  }
  if (filter === 'paid') {
    return row.paymentStatus === 'paid' || row.paymentStatus === 'marked_paid'
  }
  if (filter === 'offline') {
    return row.paymentStatus === 'offline_pending'
  }
  return true
}

Page({
  data: {
    ready: false,
    isPreview: false,
    loading: false,
    loadError: false,
    filter: 'all',
    filters: FILTERS,
    allRows: [],
    list: [],
    banner: '',
    bannerKind: '',
    highlightId: '',
    cartCount: 0,
    unpaidCount: 0,
    emptyTitle: '暂无采购单',
    emptyBody: '从「供货价目选购」加入商品并提交后，会出现在这里。'
  },

  onLoad(query) {
    this._highlightId = String((query && query.highlight) || '').trim()
    this._result = String((query && query.result) || '').trim()
    this.bootstrap()
  },

  onShow() {
    if (!this.data.ready) return
    this.setData({ cartCount: cartCount(readCart()) })
    this.loadList()
  },

  onPullDownRefresh() {
    Promise.resolve(this.loadList()).finally(() => wx.stopPullDownRefresh())
  },

  async bootstrap() {
    try {
      if (!guardManagerPage()) return
      const role = await guardSupplierWorkspace()
      if (!role) return
      const banner = resultBannerFromQuery(this._result)
      this.setData({
        ready: true,
        isPreview: role.supplierMode === 'preview',
        highlightId: this._highlightId || '',
        cartCount: cartCount(readCart()),
        banner: banner ? banner.text : '',
        bannerKind: banner ? banner.kind : ''
      })
      await this.loadList()
    } catch (e) {
      console.warn('buyer-orders bootstrap', e)
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
    }
  },

  setBanner(kind, text) {
    this.setData({ bannerKind: kind || '', banner: text || '' })
  },

  dismissBanner() {
    this.setData({ banner: '', bannerKind: '' })
  },

  setFilter(e) {
    const key = String((e.currentTarget.dataset || {}).key || '').trim()
    if (!key) return
    this.setData({ filter: key })
    this.applyFilter()
  },

  applyFilter() {
    const filter = this.data.filter
    const allRows = this.data.allRows || []
    const list = allRows.filter((r) => matchFilter(r, filter))
    const emptyBodies = {
      all: '从「供货价目选购」加入商品并提交后，会出现在这里。',
      unpaid: '没有待支付单据。可去价目选购下单，或切换「全部」查看。',
      paid: '还没有已支付 / 验收标记的单据。',
      offline: '没有待对公确认的单据。'
    }
    this.setData({
      list,
      emptyTitle:
        filter === 'all'
          ? '暂无采购单'
          : filter === 'unpaid'
            ? '暂无待支付'
            : filter === 'paid'
              ? '暂无已付单'
              : '暂无待对公',
      emptyBody: emptyBodies[filter] || emptyBodies.all
    })
  },

  async loadList() {
    this.setData({ loading: true, loadError: false })
    try {
      const rows = await listMyBuyerOrders(40)
      const allRows = rows.map((r) => normalizeRow(r, this._highlightId))
      const unpaidCount = allRows.filter((r) => isPayableStatus(r.paymentStatus)).length
      this.setData({
        allRows,
        unpaidCount,
        filters: buildFilters(allRows),
        loading: false,
        loadError: false,
        cartCount: cartCount(readCart())
      })
      this.applyFilter()
    } catch (e) {
      console.warn('listMyBuyerOrders', e)
      this.setData({ allRows: [], list: [], loading: false, loadError: true, unpaidCount: 0 })
    }
  },

  onRetry() {
    this.loadList()
  },

  patchRow(id, patch) {
    const allRows = (this.data.allRows || []).map((row) =>
      row.id === id ? { ...row, ...patch } : row
    )
    this.setData({ allRows })
    this.applyFilter()
  },

  async onPay(e) {
    const id = String((e.currentTarget.dataset || {}).id || '')
    if (!id) return
    this.patchRow(id, { paying: true })
    this.setBanner('', '')
    wx.showLoading({ title: '唤起支付…', mask: true })
    let result
    try {
      result = await payBuyerOrder(id, { action: 'pay' })
    } catch (err) {
      result = {
        success: false,
        code: 'CALL_FAIL',
        msg: (err && err.message) || '支付服务暂不可用'
      }
    }
    wx.hideLoading()
    this.patchRow(id, { paying: false })

    if (result && result.code === 'CANCELLED') {
      this.setBanner('warn', '已取消支付。可稍后重试或登记待对公。')
      return
    }

    if (result && result.code === 'B2B_PAY_NOT_CONFIGURED') {
      this.setBanner(
        'warn',
        result.msg ||
          '微信商户未配置。可点「待对公」，或部署 payB2bPurchase 后由超管验收标记。'
      )
      return
    }

    if (result && (result.code === 'PRICE_CHANGED' || result.code === 'QUOTE_REQUIRED')) {
      this.setBanner('warn', result.msg)
      await this.loadList()
      return
    }

    if (result && (result.code === 'FN_NOT_DEPLOYED' || result.code === 'CALL_FAIL')) {
      const f = friendlyPayError(result)
      this.setBanner('warn', f.msg)
      return
    }

    if (result && result.success && (result.paid || result.alreadyPaid)) {
      this.setBanner('ok', result.msg || '支付成功')
      await this.loadList()
      return
    }

    if (result && result.success && result.payment) {
      this.setBanner('ok', result.msg || '支付已提交')
      await this.loadList()
      return
    }

    this.setBanner('err', (result && result.msg) || '支付未完成')
    if (result && result.paymentStatus) {
      this.patchRow(id, {
        paymentStatus: result.paymentStatus,
        paymentText: paymentLabel(result.paymentStatus),
        canAct: isPayableStatus(result.paymentStatus)
      })
    }
  },

  async onOffline(e) {
    const id = String((e.currentTarget.dataset || {}).id || '')
    if (!id) return
    this.patchRow(id, { paying: true })
    wx.showLoading({ title: '登记中…', mask: true })
    let result
    try {
      result = await requestB2bPay(id, { action: 'markOfflinePending' })
    } catch (err) {
      result = { success: false, msg: (err && err.message) || '登记失败' }
    }
    wx.hideLoading()
    this.patchRow(id, { paying: false })
    if (result && result.success) {
      this.setBanner('ok', result.msg || '已登记待对公')
      await this.loadList()
    } else {
      this.setBanner('err', (result && result.msg) || '登记失败（请确认已部署 payB2bPurchase）')
    }
  },

  async onPreviewMark(e) {
    if (!this.data.isPreview) return
    const id = String((e.currentTarget.dataset || {}).id || '')
    if (!id) return
    this.patchRow(id, { paying: true })
    wx.showLoading({ title: '验收标记…', mask: true })
    let result
    try {
      result = await requestB2bPay(id, { action: 'markPaidPreview' })
    } catch (err) {
      result = { success: false, msg: (err && err.message) || '标记失败' }
    }
    wx.hideLoading()
    this.patchRow(id, { paying: false })
    if (result && result.success) {
      this.setBanner('ok', result.msg || '已标记已付（验收）')
      await this.loadList()
    } else {
      this.setBanner(
        'warn',
        (result && result.msg) ||
          '验收标记未开通：部署 payB2bPurchase 并设 B2B_ALLOW_PREVIEW_MARK=1'
      )
    }
  },

  goCatalog() {
    wx.navigateTo({ url: '/subpackages/extra/supplier/catalog/index' })
  },

  goCart() {
    wx.navigateTo({ url: '/subpackages/extra/supplier/buyer-cart/index' })
  }
})
