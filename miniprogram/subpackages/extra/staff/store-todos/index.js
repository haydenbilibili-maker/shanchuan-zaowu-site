const { formatCloudFnError } = require('../../utils/storePoints')
const { initStaffStores, applyStoreChange, formatTime, resolveStoreFromQuery } = require('../utils/pageSetup')

Page({
  data: {
    ready: false,
    storeOptions: [],
    storeNames: [],
    storeIndex: 0,
    storeId: '',
    storeName: '',
    shift: 'morning',
    items: [],
    progress: { done: 0, total: 0 },
    saving: false,
    dateKey: '',
    lastSave: '',
    shiftStatus: 'none',
    shiftStatusLabel: '尚未勾选'
  },

  async onLoad(options) {
    try {
      const setup = await initStaffStores('staff')
      if (!setup) return
      const store = resolveStoreFromQuery(options, setup)
      this.setData({
        ready: true,
        storeOptions: setup.storeOptions,
        storeNames: setup.storeNames,
        storeIndex: store.storeIndex,
        storeId: store.storeId,
        storeName: store.storeName
      })
      this.loadTodo()
    } catch (e) {
      console.warn('store-todos onLoad', e)
      wx.showToast({ title: '清单加载失败', icon: 'none' })
    }
  },

  onPullDownRefresh() {
    this.loadTodo().then(() => wx.stopPullDownRefresh())
  },

  onStoreChange(e) {
    applyStoreChange(this, parseInt(e.detail.value, 10) || 0)
    this.loadTodo()
  },

  setShift(e) {
    const shift = e.currentTarget.dataset.shift === 'evening' ? 'evening' : 'morning'
    this.setData({ shift })
    this.loadTodo()
  },

  async loadTodo() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageStaffWorkspace',
        data: {
          action: 'todoGet',
          storeId: this.data.storeId,
          shift: this.data.shift
        }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        wx.showToast({ title: formatCloudFnError(result, result.msg || '加载失败'), icon: 'none' })
        return
      }
      const items = (result.items || []).map((item) => ({
        ...item,
        checkedAtText: item.checkedAt ? formatTime(item.checkedAt) : ''
      }))
      const progress = result.progress || { done: 0, total: items.length }
      const total = progress.total || items.length
      const done = progress.done || 0
      let shiftStatus = 'none'
      let shiftStatusLabel = '尚未勾选'
      if (!items.length) {
        shiftStatus = 'empty'
        shiftStatusLabel = '本班次暂无清单'
      } else if (total > 0 && done >= total) {
        shiftStatus = 'done'
        shiftStatusLabel = '本班次已全部完成'
      } else if (done > 0) {
        shiftStatus = 'in'
        shiftStatusLabel = `进行中 ${done} / ${total}`
      } else {
        shiftStatusLabel = `待开始 0 / ${total}`
      }
      this.setData({
        items,
        progress,
        dateKey: result.dateKey || '',
        shiftStatus,
        shiftStatusLabel
      })
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e, '加载失败'), icon: 'none' })
    }
  },

  toggleItem(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    const items = (this.data.items || []).map((item) => {
      if (item.id !== id) return item
      const checked = !item.checked
      return {
        ...item,
        checked,
        checkedAtText: checked ? formatTime(new Date()) : ''
      }
    })
    const done = items.filter((i) => i.checked).length
    const total = items.length
    let shiftStatus = 'none'
    let shiftStatusLabel = `待开始 0 / ${total}`
    if (total > 0 && done >= total) {
      shiftStatus = 'done'
      shiftStatusLabel = '本班次已全部完成'
    } else if (done > 0) {
      shiftStatus = 'in'
      shiftStatusLabel = `进行中 ${done} / ${total}`
    }
    this.setData({ items, progress: { done, total }, shiftStatus, shiftStatusLabel, lastSave: '' })
  },

  saveTodo() {
    if (this.data.saving) return
    this.setData({ saving: true })
    wx.showLoading({ title: '保存中…', mask: true })
    wx.cloud.callFunction({
      name: 'manageStaffWorkspace',
      data: {
        action: 'todoSave',
        storeId: this.data.storeId,
        storeName: this.data.storeName,
        shift: this.data.shift,
        dateKey: this.data.dateKey,
        items: this.data.items
      }
    }).then((res) => {
      wx.hideLoading()
      this.setData({ saving: false })
      const result = (res && res.result) || {}
      if (!result.success) {
        wx.showToast({ title: formatCloudFnError(result, result.msg || '保存失败'), icon: 'none' })
        return
      }
      wx.showToast({ title: '清单已保存', icon: 'success' })
      const progress = result.progress || this.data.progress
      const done = (progress && progress.done) || 0
      const total = (progress && progress.total) || 0
      this.setData({
        progress,
        lastSave: `已保存 ${formatTime(new Date())} · ${done}/${total}`,
        shiftStatus: total > 0 && done >= total ? 'done' : (done > 0 ? 'in' : 'none'),
        shiftStatusLabel: total > 0 && done >= total ? '本班次已全部完成' : (done > 0 ? `进行中 ${done} / ${total}` : `待开始 0 / ${total}`)
      })
    }).catch((e) => {
      wx.hideLoading()
      this.setData({ saving: false })
      wx.showToast({ title: formatCloudFnError(e, '保存失败'), icon: 'none' })
    })
  }
})
