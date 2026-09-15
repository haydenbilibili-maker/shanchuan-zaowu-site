/**
 * 客服入口配置（仅超管）— getSupportConfig list/getAdmin/save · support_configs
 */
const { guardStaffPage } = require('../utils/staffAuth')
const { formatCloudFnError } = require('../utils/memberScan')

const FN = 'getSupportConfig'

Page({
  data: {
    ready: false,
    loading: false,
    saving: false,
    mode: 'list',
    list: [],
    fromDefault: false,
    docId: '',
    form: {
      name: '主店客服入口',
      priority: 10,
      statusActive: true,
      phone: '',
      hours: '',
      responseHint: '',
      address: '',
      latitude: '',
      longitude: '',
      communityQr: '',
      topics: [],
      faqs: []
    }
  },

  async onLoad() {
    const role = await guardStaffPage('super_admin')
    if (!role) return
    this.setData({ ready: true })
    this.loadList()
  },

  onPullDownRefresh() {
    const task = this.data.mode === 'edit' ? this.loadEdit(this.data.docId) : this.loadList()
    Promise.resolve(task).finally(() => wx.stopPullDownRefresh())
  },

  async callFn(data) {
    const res = await wx.cloud.callFunction({ name: FN, data: data || {} })
    const result = (res && res.result) || {}
    if (!result.success) {
      const err = new Error(result.msg || '操作失败')
      err.code = result.code
      throw err
    }
    return result
  },

  async loadList() {
    if (this.data.loading) return
    this.setData({ loading: true, mode: 'list' })
    try {
      const result = await this.callFn({ action: 'list' })
      this.setData({
        loading: false,
        list: result.list || []
      })
    } catch (e) {
      this.setData({ loading: false, list: [] })
      wx.showToast({ title: formatCloudFnError(e, '加载失败'), icon: 'none' })
    }
  },

  openEdit(e) {
    const id = (e.currentTarget.dataset && e.currentTarget.dataset.id) || ''
    this.loadEdit(id)
  },

  openCreate() {
    this.loadEdit('')
  },

  async loadEdit(docId) {
    this.setData({ loading: true, mode: 'edit', docId: docId || '' })
    try {
      const result = await this.callFn({ action: 'getAdmin', docId: docId || '' })
      const doc = result.doc || {}
      const cfg = doc.config || {}
      this.setData({
        loading: false,
        fromDefault: !!result.fromDefault,
        docId: doc._id || '',
        form: {
          name: doc.name || '客服入口',
          priority: Number(doc.priority) || 10,
          statusActive: doc.status !== 'inactive',
          phone: cfg.phone || '',
          hours: cfg.hours || '',
          responseHint: cfg.responseHint || '',
          address: cfg.address || '',
          latitude: cfg.latitude != null ? String(cfg.latitude) : '',
          longitude: cfg.longitude != null ? String(cfg.longitude) : '',
          communityQr: cfg.communityQr || '',
          topics: (cfg.topics || []).map((t) => ({ ...t })),
          faqs: (cfg.faqs || []).map((f) => ({ ...f }))
        }
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: formatCloudFnError(e, '加载失败'), icon: 'none' })
    }
  },

  backList() {
    this.loadList()
  },

  /** 编辑态：安卓物理返回先回列表（与页内「返回列表」一致）；列表态再出栈 */
  onBackPress() {
    if (this.data.mode === 'edit') {
      this.backList()
      return true
    }
    return false
  },

  onText(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: String((e.detail && e.detail.value) || '') })
  },

  onNumber(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: Number(e.detail.value) || 0 })
  },

  onSwitch(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: !!(e.detail && e.detail.value) })
  },

  onTopicField(e) {
    const { index, field } = e.currentTarget.dataset
    this.setData({ [`form.topics[${index}].${field}`]: String((e.detail && e.detail.value) || '') })
  },

  onFaqField(e) {
    const { index, field } = e.currentTarget.dataset
    this.setData({ [`form.faqs[${index}].${field}`]: String((e.detail && e.detail.value) || '') })
  },

  addTopic() {
    this.setData({
      'form.topics': this.data.form.topics.concat([
        { id: '', label: '', desc: '', icon: '/assets/icons/message.png' }
      ])
    })
  },

  removeTopic(e) {
    const index = Number(e.currentTarget.dataset.index)
    const topics = this.data.form.topics.slice()
    topics.splice(index, 1)
    this.setData({ 'form.topics': topics })
  },

  addFaq() {
    this.setData({
      'form.faqs': this.data.form.faqs.concat([{ q: '', a: '' }])
    })
  },

  removeFaq(e) {
    const index = Number(e.currentTarget.dataset.index)
    const faqs = this.data.form.faqs.slice()
    faqs.splice(index, 1)
    this.setData({ 'form.faqs': faqs })
  },

  async toggleRow(e) {
    const { id, status } = e.currentTarget.dataset
    const next = status === 'active' ? 'inactive' : 'active'
    try {
      await this.callFn({ action: 'toggle', docId: id, status: next })
      wx.showToast({ title: next === 'active' ? '已启用' : '已停用', icon: 'success' })
      this.loadList()
    } catch (err) {
      wx.showToast({ title: formatCloudFnError(err, '更新失败'), icon: 'none' })
    }
  },

  async seedDefault() {
    try {
      await this.callFn({ action: 'seed' })
      wx.showToast({ title: '已写入默认', icon: 'success' })
      this.loadList()
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e, '写入失败'), icon: 'none' })
    }
  },

  async saveConfig() {
    if (this.data.saving) return
    const f = this.data.form
    if (!String(f.phone || '').trim()) {
      wx.showToast({ title: '客服电话必填', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      const result = await this.callFn({
        action: 'save',
        docId: this.data.docId,
        name: f.name,
        priority: f.priority,
        status: f.statusActive ? 'active' : 'inactive',
        config: {
          phone: f.phone,
          hours: f.hours,
          responseHint: f.responseHint,
          address: f.address,
          latitude: f.latitude === '' ? null : Number(f.latitude),
          longitude: f.longitude === '' ? null : Number(f.longitude),
          communityQr: f.communityQr,
          topics: f.topics,
          faqs: f.faqs
        }
      })
      this.setData({ docId: result.docId || this.data.docId })
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => this.loadList(), 400)
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e, '保存失败'), icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  }
})
