// 代填收货地址（2026-10-12）：店员在订单管理 / 下单人在送礼成功页，为「邀请 TA 填地址」且未留址的礼赠填写地址。
// 走 manageGift.proxySubmitAddress（旁路），受礼人自己的填址页不变。错误就地显示，不弹原生提示。
Component({
  options: { addGlobalClass: true },

  properties: {
    show: { type: Boolean, value: false },
    orderId: { type: String, value: '' },
    orderNo: { type: String, value: '' },
    /** staff = 店员代填（可写原因）；giver = 下单人本人填写（可从微信地址导入） */
    by: { type: String, value: 'giver' },
    selfTreat: { type: Boolean, value: false }
  },

  data: {
    name: '',
    phone: '',
    region: [],
    regionText: '',
    detail: '',
    reason: '',
    busy: false,
    error: ''
  },

  observers: {
    show(v) {
      if (v) this.setData({ name: '', phone: '', region: [], regionText: '', detail: '', reason: '', busy: false, error: '' })
    }
  },

  methods: {
    onName(e) { this.setData({ name: (e.detail && e.detail.value) || '', error: '' }) },
    onPhone(e) { this.setData({ phone: (e.detail && e.detail.value) || '', error: '' }) },
    onDetail(e) { this.setData({ detail: (e.detail && e.detail.value) || '', error: '' }) },
    onReason(e) { this.setData({ reason: (e.detail && e.detail.value) || '' }) },
    onRegion(e) {
      const v = (e.detail && e.detail.value) || []
      const region = Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : []
      this.setData({ region, regionText: region.join(' '), error: '' })
    },

    importWx() {
      wx.chooseAddress({
        success: (a) => {
          const region = [a.provinceName, a.cityName, a.countyName].filter(Boolean)
          this.setData({
            name: a.userName || this.data.name,
            phone: a.telNumber || this.data.phone,
            region,
            regionText: region.join(' '),
            detail: a.detailInfo || this.data.detail,
            error: ''
          })
        },
        fail: (err) => {
          const msg = String((err && (err.errMsg || err.message)) || '')
          if (!/cancel|取消/i.test(msg)) this.setData({ error: '未能导入微信地址，请手动填写' })
        }
      })
    },

    async submit() {
      if (this.data.busy) return
      const { name, region, detail, reason } = this.data
      const phone = String(this.data.phone || '').replace(/\s+/g, '')
      if (!String(name).trim() || !String(detail).trim() || region.length < 2) {
        this.setData({ error: '请把收件人、地区和详细地址填完整' })
        return
      }
      if (!/^1\d{10}$/.test(phone)) {
        this.setData({ error: '请填写 11 位收件手机号' })
        return
      }
      this.setData({ busy: true, error: '' })
      try {
        const res = await wx.cloud.callFunction({
          name: 'manageGift',
          data: {
            action: 'proxySubmitAddress',
            by: this.data.by === 'staff' ? 'staff' : 'giver',
            orderId: this.data.orderId,
            reason: this.data.by === 'staff' ? String(reason || '').trim() : '',
            address: { name: String(name).trim(), phone, region, detail: String(detail).trim() }
          }
        })
        const r = (res && res.result) || {}
        if (!r.success) {
          this.setData({ busy: false, error: r.msg || '此刻未能记下地址，请稍后再试' })
          return
        }
        this.setData({ busy: false })
        this.triggerEvent('done', { orderId: this.data.orderId, already: !!r.already, msg: r.msg || '' })
      } catch (e) {
        this.setData({ busy: false, error: '网络未通，请稍后再试' })
      }
    },

    onClose() { if (!this.data.busy) this.triggerEvent('close') },
    noop() {}
  }
})
