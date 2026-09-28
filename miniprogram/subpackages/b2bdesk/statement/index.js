/**
 * 伙伴对账与物流（采购商 / 供货方本人；超管带 partnerStaffId 预览）
 * 只读：只调 manageSupplierDesk.myStatement，服务端按账号状态 + 功能项 statement 放行。
 */
const { callDesk, yuan, copyText } = require('../utils/deskApi')

const RANGES = [
  { key: '30d', label: '近 30 天' },
  { key: 'month', label: '本月' },
  { key: 'all', label: '全部' }
]

const PAY_TONE = { received: 'ok', refunded: 'danger', review: 'danger', offline: 'warn', due: 'warn', marked: 'warn', na: '' }

Page({
  data: {
    ranges: RANGES,
    range: 'all',
    loading: true,
    error: '',
    preview: false,
    needPartner: false,
    partnerName: '',
    sides: {},
    kpis: [],
    list: [],
    openId: '',
    flash: ''
  },

  onLoad(query) {
    this._partnerStaffId = decodeURIComponent((query && query.partnerStaffId) || '')
    this.load()
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh())
  },

  onUnload() {
    clearTimeout(this._flashTimer)
  },

  load() {
    this.setData({ loading: true, error: '' })
    const data = { range: this.data.range }
    if (this._partnerStaffId) data.partnerStaffId = this._partnerStaffId
    return callDesk('myStatement', data).then((res) => {
      if (!res.success) return this.setData({ loading: false, error: res.msg || '加载失败' })
      const s = res.summary || {}
      const m = s.money || {}
      const o = s.orders || {}
      const sides = res.sides || {}
      const kpis = [{ key: 'count', label: '单据', value: String(o.count || 0), sub: `金额 ${yuan(o.amountFen)}` }]
      if (sides.buyer) {
        kpis.push(
          { key: 'due', label: '待付款', value: yuan(m.dueFen + m.offlineFen + m.reviewFen), sub: m.overdueCount ? `${m.overdueCount} 单已超 ${s.payTermDays || 7} 天` : '无超期' },
          { key: 'paid', label: '已付款', value: yuan(m.receivedFen), sub: m.refundedFen ? `已退 ${yuan(m.refundedFen)}` : '以微信实收为准' }
        )
      }
      if (sides.supplier) {
        kpis.push({ key: 'payable', label: '已发货待结算', value: yuan(s.payable && s.payable.amountFen), sub: '付款字段待总部建模' })
      }
      kpis.push({ key: 'transit', label: '在途', value: String(o.transit || 0), sub: `待发货 ${o.toShip || 0} 单` })
      this.setData({
        loading: false,
        preview: !!res.preview,
        needPartner: !!res.needPartner,
        partnerName: res.partnerName || '',
        sides,
        kpis,
        list: (res.list || []).map((r) => ({ ...r, payTone: PAY_TONE[r.payBucket] || '' }))
      })
    })
  },

  onRange(e) {
    const range = e.currentTarget.dataset.key
    if (range === this.data.range) return
    this.setData({ range })
    this.load()
  },

  toggleOpen(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ openId: this.data.openId === id ? '' : id })
  },

  copyTracking(e) {
    const no = e.currentTarget.dataset.no
    copyText(no, (ok) => {
      this.setData({ flash: ok ? `已复制运单号 ${no}，可到快递公司小程序查询轨迹` : '复制失败，请长按运单号手动复制' })
      clearTimeout(this._flashTimer)
      this._flashTimer = setTimeout(() => this.setData({ flash: '' }), 3200)
    })
  }
})
