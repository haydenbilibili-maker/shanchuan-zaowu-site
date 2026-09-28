/**
 * 供应商管理中心 · 订单详情（只读）
 * 时间线：下单 → 付款 / 对公 → 确认 → 发货 → 签收 → 结算（退款 / 取消为终态）
 * 物流只展示运单号 + 复制：B2B 单没有微信物流插件所需的 waybillToken（蓝图 §6.3）。
 */
const { callDesk, copyText } = require('../utils/deskApi')

const PAY_STATUS_LABEL = {
  unpaid: '待付款',
  pending: '支付中',
  awaiting_config: '待付款（商户号未配置）',
  paid: '已付款',
  offline_pending: '对公待确认',
  marked_paid: '验收标记已付',
  pay_review: '金额待核对',
  refunded: '已退款'
}
const CHANNEL_LABEL = { wechat_jsapi: '微信支付', offline: '对公转账', preview_mark: '验收标记' }
const REFUND_LABEL = { refunding: '退款中', refunded: '已退款', failed: '退款失败（待总部重试）' }

function paymentRows(p, aging) {
  const rows = []
  if (!p) return rows
  if (p.status) rows.push({ k: '货款状态', v: PAY_STATUS_LABEL[p.status] || p.status })
  if (p.channel) rows.push({ k: '支付方式', v: CHANNEL_LABEL[p.channel] || p.channel })
  if (p.pricingMode === 'quote_required') rows.push({ k: '计价', v: '含区间价 / 议价，需总部报价' })
  if (p.payFenText) rows.push({ k: '应付（服务端重算）', v: p.payFenText })
  if (p.paidFenText) rows.push({ k: '微信实收', v: p.paidFenText })
  if (p.attempts) rows.push({ k: '支付发起次数', v: String(p.attempts) })
  if (p.outTradeTails && p.outTradeTails.length) rows.push({ k: '商户单号尾号', v: p.outTradeTails.join('、') })
  if (p.transactionTail) rows.push({ k: '微信支付单号尾号', v: p.transactionTail })
  if (p.refundStatus) rows.push({ k: '退款', v: REFUND_LABEL[p.refundStatus] || p.refundStatus })
  if (p.anomaly) rows.push({ k: '支付异常', v: p.anomaly === 'AMOUNT_MISMATCH' ? '实收与应收不一致，待总部核对' : p.anomaly })
  if (aging && aging.open) rows.push({ k: '账龄', v: `${aging.days} 天${aging.overdue ? '（已超期）' : ''}` })
  return rows
}

Page({
  data: {
    loading: true,
    error: '',
    order: null,
    items: [],
    contactRows: [],
    payRows: [],
    timeline: [],
    logistics: [],
    flash: ''
  },

  onLoad(query) {
    this._id = decodeURIComponent((query && query.id) || '')
    this.load()
  },

  onUnload() {
    clearTimeout(this._flashTimer)
  },

  load() {
    if (!this._id) {
      this.setData({ loading: false, error: '缺少订单 ID' })
      return
    }
    this.setData({ loading: true, error: '' })
    callDesk('adminGetOrder', { id: this._id }).then((res) => {
      if (!res.success) {
        this.setData({ loading: false, error: res.msg || '加载失败' })
        return
      }
      const c = res.contact || {}
      const contactRows = [
        { k: '公司', v: c.company },
        { k: '门店', v: c.storeName },
        { k: '联系人', v: c.contactName },
        { k: '电话', v: c.contactPhone },
        { k: '收货地址', v: c.shipToAddress },
        { k: '备注', v: c.note }
      ].filter((r) => r.v)
      this.setData({
        loading: false,
        order: res.order || null,
        items: res.items || [],
        contactRows,
        payRows: paymentRows(res.payment, res.aging),
        timeline: (res.timeline || []).filter((n) => n.state !== 'na' || n.note),
        logistics: res.logistics || []
      })
    })
  },

  copyTracking(e) {
    const no = e.currentTarget.dataset.no
    copyText(no, (ok) => this.flash(ok ? `已复制运单号 ${no}，可到快递公司小程序查询轨迹` : '复制失败，请长按运单号手动复制'))
  },

  copyOrderNo() {
    const o = this.data.order
    if (o) copyText(o.orderNo || o._id, (ok) => this.flash(ok ? '已复制单号' : '复制失败'))
  },

  flash(msg) {
    this.setData({ flash: msg })
    clearTimeout(this._flashTimer)
    this._flashTimer = setTimeout(() => this.setData({ flash: '' }), 3200)
  }
})
