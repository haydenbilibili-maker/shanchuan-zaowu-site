/**
 * 超管物业成本 — 水电 / 房租（managePropertyCost → property_costs）
 */
const { guardStaffPage } = require('../utils/staffAuth')
const { formatCloudFnError } = require('../utils/memberScan')

const FN = 'managePropertyCost'
const MAX_RECEIPTS_FALLBACK = 6

const TYPE_TONE = {
  utilities: 'brass',
  rent: 'warn',
  other: 'muted'
}

Page({
  data: {
    ready: false,
    loading: false,
    saving: false,
    uploading: false,
    maxReceipts: MAX_RECEIPTS_FALLBACK,
    entities: [],
    costTypes: [
      { value: 'utilities', label: '水电费' },
      { value: 'rent', label: '房租' },
      { value: 'other', label: '其他' }
    ],
    entityFilterIndex: 0,
    entityFilterNames: ['全部主体'],
    entityFilterIds: [''],
    typeFilterIndex: 0,
    typeFilterNames: ['全部类型', '水电费', '房租', '其他'],
    typeFilterValues: ['all', 'utilities', 'rent', 'other'],
    monthFilter: '',
    list: [],
    summary: {
      totalAmount: 0,
      totalAmountText: '0',
      count: 0,
      byEntity: [],
      byType: []
    },
    showForm: false,
    editingId: '',
    formEntityIndex: 0,
    formEntityNames: [],
    formTypeIndex: 0,
    formTypeNames: ['水电费', '房租', '其他'],
    receiptPreviews: [],
    form: {
      entityId: '',
      costType: 'utilities',
      amount: '',
      periodMonth: '',
      periodStart: '',
      periodEnd: '',
      paidAt: '',
      receiptFileIds: [],
      note: ''
    }
  },

  async onLoad() {
    const role = await guardStaffPage('super_admin')
    if (!role) return
    this.setData({ ready: true })
    await this.loadMeta()
    await this.loadList()
  },

  onPullDownRefresh() {
    this.loadList().finally(() => wx.stopPullDownRefresh())
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

  async loadMeta() {
    try {
      const result = await this.callFn({ action: 'meta' })
      const entities = result.entities || []
      const costTypes = result.costTypes && result.costTypes.length
        ? result.costTypes
        : this.data.costTypes
      this.setData({
        entities,
        costTypes,
        maxReceipts: Number(result.maxReceipts) || MAX_RECEIPTS_FALLBACK,
        entityFilterNames: ['全部主体'].concat(entities.map((e) => e.name)),
        entityFilterIds: [''].concat(entities.map((e) => e.id)),
        formEntityNames: entities.map((e) => e.name),
        formTypeNames: costTypes.map((t) => t.label),
        typeFilterNames: ['全部类型'].concat(costTypes.map((t) => t.label)),
        typeFilterValues: ['all'].concat(costTypes.map((t) => t.value))
      })
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e, '元数据未能取回'), icon: 'none' })
    }
  },

  money(n) {
    const v = Number(n)
    if (!Number.isFinite(v)) return '0'
    return v.toFixed(2).replace(/\.00$/, '')
  },

  formatTime(ts) {
    const n = Number(ts)
    if (!Number.isFinite(n) || n <= 0) return '—'
    const d = new Date(n)
    const pad = (x) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  },

  async resolvePreviews(fileIds) {
    const ids = (fileIds || []).map((x) => String(x || '').trim()).filter(Boolean)
    if (!ids.length) return []
    const cloudIds = ids.filter((id) => id.startsWith('cloud://'))
    const urlMap = {}
    if (cloudIds.length) {
      try {
        const res = await wx.cloud.getTempFileURL({ fileList: cloudIds })
        ;(res.fileList || []).forEach((f) => {
          if (f.fileID) urlMap[f.fileID] = f.tempFileURL || f.fileID
        })
      } catch (e) {
        /* keep fileId as fallback */
      }
    }
    return ids.map((id) => ({
      fileId: id,
      url: urlMap[id] || id
    }))
  },

  async loadList() {
    this.setData({ loading: true })
    try {
      const entityId = this.data.entityFilterIds[this.data.entityFilterIndex] || ''
      const costType = this.data.typeFilterValues[this.data.typeFilterIndex] || 'all'
      const result = await this.callFn({
        action: 'list',
        entityId: entityId || undefined,
        costType,
        periodMonth: this.data.monthFilter || undefined,
        limit: 80
      })
      const list = []
      for (const row of result.list || []) {
        const ids = Array.isArray(row.receiptFileIds) && row.receiptFileIds.length
          ? row.receiptFileIds
          : (row.receiptFileId ? [row.receiptFileId] : [])
        const receiptPreviews = await this.resolvePreviews(ids)
        list.push({
          ...row,
          typeTone: TYPE_TONE[row.costType] || 'muted',
          amountText: this.money(row.amount),
          periodText: row.periodMonth
            || ((row.periodStart || row.periodEnd)
              ? `${row.periodStart || '?'} ~ ${row.periodEnd || '?'}`
              : '—'),
          periodRangeText: (row.periodStart || row.periodEnd)
            ? `${row.periodStart || '?'} ~ ${row.periodEnd || '?'}`
            : '',
          updatedAtText: this.formatTime(row.updatedAt),
          receiptPreviews,
          receiptCount: receiptPreviews.length
        })
      }
      const summaryRaw = result.summary || { totalAmount: 0, count: 0, byEntity: [], byType: [] }
      this.setData({
        list,
        summary: {
          totalAmount: summaryRaw.totalAmount || 0,
          totalAmountText: this.money(summaryRaw.totalAmount),
          count: summaryRaw.count || 0,
          byEntity: (summaryRaw.byEntity || []).map((e) => ({
            ...e,
            amountText: this.money(e.amount)
          })),
          byType: (summaryRaw.byType || []).map((t) => ({
            ...t,
            amountText: this.money(t.amount)
          }))
        }
      })
    } catch (e) {
      this.setData({
        list: [],
        summary: { totalAmount: 0, totalAmountText: '0', count: 0, byEntity: [], byType: [] }
      })
      wx.showToast({ title: formatCloudFnError(e, '清单未能展开'), icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onEntityFilter(e) {
    this.setData({ entityFilterIndex: parseInt(e.detail.value, 10) || 0 })
    this.loadList()
  },

  onTypeFilter(e) {
    this.setData({ typeFilterIndex: parseInt(e.detail.value, 10) || 0 })
    this.loadList()
  },

  onMonthFilter(e) {
    this.setData({ monthFilter: e.detail.value || '' })
    this.loadList()
  },

  clearMonth() {
    this.setData({ monthFilter: '' })
    this.loadList()
  },

  openCreate() {
    const first = (this.data.entities || [])[0]
    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const day = now.toISOString().slice(0, 10)
    this.setData({
      showForm: true,
      editingId: '',
      formEntityIndex: 0,
      formTypeIndex: 0,
      receiptPreviews: [],
      form: {
        entityId: first ? first.id : '',
        costType: 'utilities',
        amount: '',
        periodMonth: month,
        periodStart: '',
        periodEnd: '',
        paidAt: day,
        receiptFileIds: [],
        note: ''
      }
    })
  },

  async openEdit(e) {
    const id = e.currentTarget.dataset.id
    const row = (this.data.list || []).find((x) => x._id === id)
    if (!row) return
    const formEntityIndex = Math.max(0, (this.data.entities || []).findIndex((x) => x.id === row.entityId))
    const formTypeIndex = Math.max(0, (this.data.costTypes || []).findIndex((t) => t.value === row.costType))
    const ids = Array.isArray(row.receiptFileIds) && row.receiptFileIds.length
      ? row.receiptFileIds.slice()
      : (row.receiptFileId ? [row.receiptFileId] : [])
    const receiptPreviews = row.receiptPreviews && row.receiptPreviews.length
      ? row.receiptPreviews
      : await this.resolvePreviews(ids)
    this.setData({
      showForm: true,
      editingId: id,
      formEntityIndex,
      formTypeIndex,
      receiptPreviews,
      form: {
        entityId: row.entityId,
        costType: row.costType || 'other',
        amount: String(row.amount != null ? row.amount : ''),
        periodMonth: row.periodMonth || '',
        periodStart: row.periodStart || '',
        periodEnd: row.periodEnd || '',
        paidAt: row.paidAt || '',
        receiptFileIds: ids,
        note: row.note || ''
      }
    })
  },

  closeForm() {
    this.setData({ showForm: false })
  },

  onFormInput(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    this.setData({ [`form.${field}`]: e.detail.value })
  },

  onFormEntity(e) {
    const idx = parseInt(e.detail.value, 10) || 0
    const ent = (this.data.entities || [])[idx]
    this.setData({
      formEntityIndex: idx,
      'form.entityId': ent ? ent.id : ''
    })
  },

  onFormType(e) {
    const idx = parseInt(e.detail.value, 10) || 0
    const t = (this.data.costTypes || [])[idx]
    this.setData({
      formTypeIndex: idx,
      'form.costType': t ? t.value : 'other'
    })
  },

  onFormMonth(e) {
    const month = e.detail.value || ''
    const patch = { 'form.periodMonth': month }
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split('-').map(Number)
      const last = new Date(y, m, 0).getDate()
      if (!this.data.form.periodStart) patch['form.periodStart'] = `${month}-01`
      if (!this.data.form.periodEnd) {
        patch['form.periodEnd'] = `${month}-${String(last).padStart(2, '0')}`
      }
    }
    this.setData(patch)
  },

  onFormPaidAt(e) {
    this.setData({ 'form.paidAt': e.detail.value })
  },

  onFormPeriodStart(e) {
    this.setData({ 'form.periodStart': e.detail.value })
  },

  onFormPeriodEnd(e) {
    this.setData({ 'form.periodEnd': e.detail.value })
  },

  chooseReceipt() {
    if (this.data.uploading) return
    const current = (this.data.form && this.data.form.receiptFileIds) || []
    const remain = (this.data.maxReceipts || MAX_RECEIPTS_FALLBACK) - current.length
    if (remain <= 0) {
      wx.showToast({ title: `最多 ${this.data.maxReceipts} 张票据`, icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      success: async (res) => {
        const files = res.tempFiles || []
        if (!files.length) return
        this.setData({ uploading: true })
        wx.showLoading({ title: '上传中…', mask: true })
        try {
          const nextIds = current.slice()
          const nextPreviews = (this.data.receiptPreviews || []).slice()
          for (const file of files) {
            const path = file.tempFilePath
            if (!path) continue
            const ext = (path.split('.').pop() || 'jpg').toLowerCase()
            const up = await wx.cloud.uploadFile({
              cloudPath: `property-receipts/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`,
              filePath: path
            })
            const fileID = up.fileID
            if (!fileID) continue
            nextIds.push(fileID)
            const resolved = await this.resolvePreviews([fileID])
            nextPreviews.push(resolved[0] || { fileId: fileID, url: path })
          }
          this.setData({
            'form.receiptFileIds': nextIds.slice(0, this.data.maxReceipts),
            receiptPreviews: nextPreviews.slice(0, this.data.maxReceipts)
          })
          wx.showToast({ title: '票据已收入', icon: 'success' })
        } catch (err) {
          wx.showToast({ title: formatCloudFnError(err, '上传未成'), icon: 'none' })
        } finally {
          wx.hideLoading()
          this.setData({ uploading: false })
        }
      }
    })
  },

  removeReceipt(e) {
    const idx = parseInt(e.currentTarget.dataset.index, 10)
    if (!Number.isFinite(idx) || idx < 0) return
    const ids = ((this.data.form && this.data.form.receiptFileIds) || []).slice()
    const previews = (this.data.receiptPreviews || []).slice()
    ids.splice(idx, 1)
    previews.splice(idx, 1)
    this.setData({
      'form.receiptFileIds': ids,
      receiptPreviews: previews
    })
  },

  previewReceipt(e) {
    const url = e.currentTarget.dataset.url
    const urls = e.currentTarget.dataset.urls
    let list = []
    if (typeof urls === 'string' && urls) {
      try {
        list = JSON.parse(urls)
      } catch (err) {
        list = []
      }
    }
    if (!list.length && Array.isArray(this.data.receiptPreviews)) {
      list = this.data.receiptPreviews.map((p) => p.url).filter(Boolean)
    }
    if (!list.length && url) list = [url]
    if (!list.length) return
    wx.previewImage({ urls: list, current: url || list[0] })
  },

  previewListReceipt(e) {
    const id = e.currentTarget.dataset.id
    const url = e.currentTarget.dataset.url
    const row = (this.data.list || []).find((x) => x._id === id)
    const list = ((row && row.receiptPreviews) || []).map((p) => p.url).filter(Boolean)
    if (!list.length) return
    wx.previewImage({ urls: list, current: url || list[0] })
  },

  async saveForm() {
    if (this.data.saving) return
    const form = this.data.form || {}
    if (!form.entityId) {
      wx.showToast({ title: '请选择归属主体', icon: 'none' })
      return
    }
    const amount = Number(form.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      wx.showToast({ title: '请填写金额', icon: 'none' })
      return
    }
    if (!form.periodMonth && !form.periodStart) {
      wx.showToast({ title: '请填写所属月或周期', icon: 'none' })
      return
    }
    if (form.periodStart && form.periodEnd && form.periodStart > form.periodEnd) {
      wx.showToast({ title: '周期起止日期顺序有误', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      const receiptFileIds = form.receiptFileIds || []
      await this.callFn({
        action: this.data.editingId ? 'update' : 'create',
        id: this.data.editingId || undefined,
        item: {
          entityId: form.entityId,
          costType: form.costType || 'other',
          amount,
          periodMonth: form.periodMonth || '',
          periodStart: form.periodStart || '',
          periodEnd: form.periodEnd || '',
          paidAt: form.paidAt || '',
          receiptFileIds,
          receiptFileId: receiptFileIds[0] || '',
          note: String(form.note || '').trim()
        }
      })
      wx.showToast({ title: '已收入柜中', icon: 'success' })
      this.setData({ showForm: false })
      await this.loadList()
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e, '未能保存'), icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  onRemove(e) {
    const id = e.currentTarget.dataset.id
    const row = (this.data.list || []).find((x) => x._id === id)
    if (!row) return
    wx.showModal({
      title: '移出物业账目',
      content: `确认删除「${row.entityName} · ${row.costTypeLabel} · ¥${row.amountText}」？`,
      confirmText: '删除',
      confirmColor: '#D64045',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await this.callFn({ action: 'remove', id })
          wx.showToast({ title: '已移出', icon: 'success' })
          this.loadList()
        } catch (err) {
          wx.showToast({ title: formatCloudFnError(err, '删除未成'), icon: 'none' })
        }
      }
    })
  }
})
