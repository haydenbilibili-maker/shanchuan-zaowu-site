// 代填收货地址（2026-10-12）：店员在订单管理 / 下单人在送礼成功页，为「邀请 TA 填地址」且未留址的礼赠填写地址。
// 走 manageGift.proxySubmitAddress（旁路），受礼人自己的填址页不变。错误就地显示，不弹原生提示。
const { parseAddressText } = require('../../utils/addressParse')

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
    error: '',
    pasteText: '',
    pasteTip: '',
    pasteMissing: false
  },

  observers: {
    show(v) {
      if (v) this.setData({ name: '', phone: '', region: [], regionText: '', detail: '', reason: '', busy: false, error: '', pasteText: '', pasteTip: '', pasteMissing: false })
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

    onPasteInput(e) { this.setData({ pasteText: (e.detail && e.detail.value) || '' }) },

    pasteClipboard() {
      wx.getClipboardData({
        success: (res) => {
          const text = String((res && res.data) || '').trim()
          if (!text) {
            this.setData({ pasteTip: '剪贴板里没有文字，请先复制地址', pasteMissing: true })
            return
          }
          this.setData({ pasteText: text.slice(0, 300) })
          this.applyParsed(text)
        },
        fail: () => this.setData({ pasteTip: '没能读取剪贴板，请长按输入框粘贴', pasteMissing: true })
      })
    },

    parsePaste() {
      const text = String(this.data.pasteText || '').trim()
      if (!text) {
        this.setData({ pasteTip: '先把整段地址粘贴到上面', pasteMissing: true })
        return
      }
      this.applyParsed(text)
    },

    /** 识别结果只做预填：认出的字段覆盖，认不出的保持原样让人补；提交仍走 submit 的原校验 */
    applyParsed(text) {
      const r = parseAddressText(text)
      const patch = { error: '' }
      if (r.name) patch.name = r.name
      if (r.phone) patch.phone = r.phone
      if (r.region.length >= 2) { patch.region = r.region; patch.regionText = r.region.join(' ') }
      if (r.detail) patch.detail = r.detail
      const found = r.found.slice()
      let missing = r.missing.slice()
      if (r.region.length === 2) {
        found.push('省市')
        missing = missing.map((k) => (k === '省市区' ? '区县' : k))
      }
      let tip
      if (!found.length) tip = '没认出地址信息，请手动填写下方各项'
      else if (!missing.length) tip = `已识别：${found.join('、')}，请核对后确认`
      else tip = `已识别：${found.join('、')}；${missing.join('、')}没认出，请在下方补填`
      this.setData({ ...patch, pasteTip: tip, pasteMissing: missing.length > 0 })
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
