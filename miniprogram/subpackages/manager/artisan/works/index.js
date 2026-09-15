const { guardManagerPage } = require('../../../../utils/managerAuth')
const {
  guardArtisanWorkspace,
  hasPermission,
  roleHasStored,
  goArtisanProductCreate
} = require('../../utils/staffAuth')
const { formatCloudFnError } = require('../../utils/memberScan')
const { batchTempFileURLs } = require('../../../../utils/util')

const FALLBACK_COVER = '/assets/icons/tab-collection.png'
const SHELF_FILTER_KEY = 'artisan_works_shelf_filter'
const JOB_FILTER_KEY = 'artisan_jobs_filter'
const BATCH_LIMIT = 20

function shelfKey(item) {
  if (!item) return 'off'
  if (item.isOffShelf === false) return 'on'
  if (item.shelfApprovalStatus === 'pending') return 'pending'
  if (item.shelfApprovalStatus === 'rejected') return 'rejected'
  return 'off'
}

function shelfLabel(item) {
  const key = shelfKey(item)
  if (key === 'on') return '已上架'
  if (key === 'pending') return '待确认'
  if (key === 'rejected') return '已驳回'
  return '未上架'
}

function priceDisplay(item) {
  const n = Number(item && item.price)
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
}

function sizeText(item) {
  if (!item) return ''
  if (item.size) return String(item.size).trim()
  const parts = [item.sizeL, item.sizeW, item.sizeH].map((v) => String(v || '').trim()).filter(Boolean)
  return parts.join(' × ')
}

function categoryText(item) {
  if (!item) return ''
  return [item.rootCategoryName, item.category].map((v) => String(v || '').trim()).filter(Boolean).join(' / ')
}

function detailLines(item) {
  if (!item) return []
  const lines = []
  const latin = String(item.latinName || '').trim()
  if (latin) lines.push({ k: '学名', v: latin })
  const cat = categoryText(item)
  if (cat) lines.push({ k: '类目', v: cat })
  const origin = String(item.origin || '').trim()
  if (origin) lines.push({ k: '产地', v: origin })
  const size = sizeText(item)
  if (size) lines.push({ k: '尺寸', v: size })
  if (item.stock != null && item.stock !== '') lines.push({ k: '库存', v: String(item.stock) })
  const collected = String(item.collectDate || '').trim()
  if (collected) lines.push({ k: '收藏日期', v: collected })
  const reason = String(item.shelfRejectReason || '').trim()
  if (item.shelfKey === 'rejected' && reason) lines.push({ k: '驳回原因', v: reason })
  return lines
}

function filterListByShelf(rows, shelfFilter) {
  const all = Array.isArray(rows) ? rows : []
  if (shelfFilter === 'on' || shelfFilter === 'pending' || shelfFilter === 'rejected' || shelfFilter === 'off') {
    return all.filter((item) => shelfKey(item) === shelfFilter)
  }
  return all
}

function filterJobs(rows, jobFilter) {
  const all = Array.isArray(rows) ? rows : []
  if (jobFilter === 'pending_make' || jobFilter === 'framing' || jobFilter === 'packing' || jobFilter === 'shipped') {
    return all.filter((item) => item && item.productionStatus === jobFilter)
  }
  if (jobFilter === 'active') {
    return all.filter((item) => item && item.productionStatus !== 'shipped')
  }
  return all
}

function withSelection(rows, selectedIds) {
  const map = selectedIds || {}
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    selected: !!(row && row._id && map[row._id])
  }))
}

function readStoredFilter(key, fallback) {
  try {
    const v = String(wx.getStorageSync(key) || '').trim()
    return v || fallback
  } catch (e) {
    return fallback
  }
}

function writeStoredFilter(key, value) {
  try {
    wx.setStorageSync(key, String(value || ''))
  } catch (e) {
    /* ignore */
  }
}

Page({
  data: {
    ready: false,
    loading: false,
    loadError: false,
    shelfBusyId: '',
    jobBusyId: '',
    batchBusy: false,
    pageMode: 'works',
    pageTitle: '作品库',
    pageSub: '封面、状态与上下架，同步至对外代表作',
    framerId: '',
    hasProfile: false,
    canProfile: false,
    shelfFilter: 'all',
    jobFilter: 'active',
    listAll: [],
    list: [],
    jobsAll: [],
    jobs: [],
    filterCounts: { all: 0, on: 0, pending: 0, rejected: 0, off: 0 },
    jobCounts: { all: 0, active: 0, pending_make: 0, framing: 0, packing: 0, shipped: 0 },
    detailOpen: false,
    detailItem: null,
    selectMode: false,
    selectedIds: {},
    selectedCount: 0,
    matchHint: ''
  },

  async onLoad(options) {
    const mode = String((options && options.mode) || '').trim() === 'jobs' ? 'jobs' : 'works'
    const rawFilter = String((options && options.filter) || '').trim()
    const pageTitle = mode === 'jobs' ? '制作工单' : '作品库'
    const pageSub = mode === 'jobs'
      ? '待制作、装裱与待发货，按状态推进。历史单会按指定本人、姓名或本人藏品匹配。'
      : '封面、状态与上下架，同步至对外代表作'
    const patch = { pageMode: mode, pageTitle, pageSub }
    if (mode === 'jobs') {
      const allowed = { all: 1, active: 1, pending_make: 1, framing: 1, packing: 1, shipped: 1 }
      patch.jobFilter = allowed[rawFilter] ? rawFilter : readStoredFilter(JOB_FILTER_KEY, 'active')
    } else {
      const allowed = { all: 1, on: 1, pending: 1, rejected: 1, off: 1 }
      patch.shelfFilter = allowed[rawFilter] ? rawFilter : readStoredFilter(SHELF_FILTER_KEY, 'all')
    }
    this.setData(patch)
    wx.setNavigationBarTitle({ title: pageTitle })
    if (!guardManagerPage()) return

    const role = await guardArtisanWorkspace()
    if (!role) return
    const artisanRole = roleHasStored(role, 'specimen_artisan') || roleHasStored(role, 'super_admin')
    const canWorks =
      hasPermission(role, 'manageArtisanWorks') ||
      hasPermission(role, 'manageProducts') ||
      artisanRole
    if (!canWorks) {
      wx.showToast({ title: '无作品维护权限', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    this.setData({
      ready: true,
      canProfile: hasPermission(role, 'manageArtisanProfile') || artisanRole
    })
    await this.loadFramerId()
    await this.reload()
    this._readyForShowReload = true
  },

  onShow() {
    if (!this._readyForShowReload || this.data.loading) return
    this.reload()
  },

  onPullDownRefresh() {
    this.reload().finally(() => wx.stopPullDownRefresh())
  },

  async loadFramerId() {
    try {
      const res = await wx.cloud.callFunction({ name: 'manageStaff', data: { action: 'getArtisanProfile' } })
      const profile = (res.result && res.result.profile) || {}
      const framerId = profile.framerId || ''
      this.setData({ framerId, hasProfile: !!framerId })
    } catch (e) {
      console.warn('loadFramerId', e)
    }
  },

  applyShelfFilter(filter) {
    const allowed = { all: 1, on: 1, pending: 1, rejected: 1, off: 1 }
    const shelfFilter = allowed[filter] ? filter : 'all'
    writeStoredFilter(SHELF_FILTER_KEY, shelfFilter)
    const listAll = this.data.listAll || []
    this.setData({
      shelfFilter,
      list: withSelection(filterListByShelf(listAll, shelfFilter), this.data.selectedIds)
    })
  },

  applyJobFilter(filter) {
    const allowed = { all: 1, active: 1, pending_make: 1, framing: 1, packing: 1, shipped: 1 }
    const jobFilter = allowed[filter] ? filter : 'active'
    writeStoredFilter(JOB_FILTER_KEY, jobFilter)
    const jobsAll = this.data.jobsAll || []
    this.setData({ jobFilter, jobs: filterJobs(jobsAll, jobFilter) })
  },

  setShelfFilter(e) {
    const val = String((e.currentTarget.dataset && e.currentTarget.dataset.val) || 'all')
    this.applyShelfFilter(val)
  },

  setJobFilter(e) {
    const val = String((e.currentTarget.dataset && e.currentTarget.dataset.val) || 'active')
    this.applyJobFilter(val)
  },

  async reload() {
    if (this.data.loading) return
    this.setData({ loading: true, loadError: false })
    try {
      if (this.data.pageMode === 'jobs') {
        await this.reloadJobs()
      } else {
        await this.reloadWorks()
      }
    } catch (e) {
      console.error('reload artisan works', e)
      wx.showToast({ title: formatCloudFnError(e, '加载失败'), icon: 'none' })
      this.setData({ loading: false, loadError: true })
    }
  },

  async fetchMineProductPage(page, pageSize, linkBackfill) {
    const res = await wx.cloud.callFunction({
      name: 'manageProducts',
      data: {
        action: 'list',
        mineOnly: true,
        framerId: this.data.framerId || '',
        linkBackfill: !!linkBackfill,
        page,
        pageSize,
        sortBy: 'new'
      }
    })
    return (res && res.result) || {}
  },

  async reloadWorks() {
    const pageSize = 100
    let page = 1
    let rows = []
    let total = Infinity
    let shelfCounts = null
    while (rows.length < total && page <= 8) {
      const result = await this.fetchMineProductPage(page, pageSize, page === 1)
      if (!result.success) {
        wx.showToast({ title: formatCloudFnError(result, result.msg || '加载失败'), icon: 'none' })
        this.setData({ listAll: [], list: [], loading: false, loadError: true })
        return
      }
      total = Number(result.total)
      if (!Number.isFinite(total)) total = (result.list || []).length
      if (result.shelfCounts) shelfCounts = result.shelfCounts
      rows = rows.concat(Array.isArray(result.list) ? result.list : [])
      if (!result.list || result.list.length < pageSize) break
      page += 1
    }
    const cloudIds = rows
      .map((r) => (Array.isArray(r.images) && r.images[0]) || r.coverImage || '')
      .filter((u) => u && u.indexOf('cloud://') === 0)
    const urlMap = cloudIds.length ? await batchTempFileURLs(cloudIds) : {}
    const listAll = rows.map((item) => {
      const raw = (Array.isArray(item.images) && item.images[0]) || item.coverImage || ''
      const coverImage = urlMap[raw] || raw || FALLBACK_COVER
      const key = shelfKey(item)
      const mapped = {
        ...item,
        coverImage,
        shelfKey: key,
        shelfLabel: shelfLabel(item),
        priceDisplay: priceDisplay(item),
        latinName: item.latinName || '',
        origin: item.origin || '',
        collectDate: item.collectDate || '',
        shelfRejectReason: item.shelfRejectReason || ''
      }
      mapped.detailLines = detailLines(mapped)
      return mapped
    })
    const filterCounts = shelfCounts && Number(shelfCounts.all) === listAll.length
      ? {
          all: Number(shelfCounts.all) || listAll.length,
          on: Number(shelfCounts.on) || 0,
          pending: Number(shelfCounts.pending) || 0,
          rejected: Number(shelfCounts.rejected) || 0,
          off: Number(shelfCounts.off) || 0
        }
      : { all: listAll.length, on: 0, pending: 0, rejected: 0, off: 0 }
    if (!shelfCounts || Number(shelfCounts.all) !== listAll.length) {
      listAll.forEach((item) => {
        if (filterCounts[item.shelfKey] != null) filterCounts[item.shelfKey] += 1
      })
    }
    this.setData({ listAll, filterCounts, loading: false })
    this.applyShelfFilter(this.data.shelfFilter)
  },

  async reloadJobs() {
    const res = await wx.cloud.callFunction({
      name: 'managerShipOrder',
      data: { action: 'listArtisanWorkOrders' }
    })
    const result = (res && res.result) || {}
    if (!result.success) {
      wx.showToast({ title: formatCloudFnError(result, result.msg || '加载失败'), icon: 'none' })
      this.setData({ jobsAll: [], jobs: [], loading: false, loadError: true })
      return
    }
    const jobsAll = Array.isArray(result.list) ? result.list : []
    const jobCounts = { all: jobsAll.length, active: 0, pending_make: 0, framing: 0, packing: 0, shipped: 0 }
    jobsAll.forEach((item) => {
      if (item.productionStatus !== 'shipped') jobCounts.active += 1
      if (jobCounts[item.productionStatus] != null) jobCounts[item.productionStatus] += 1
    })
    this.setData({ jobsAll, jobCounts, loading: false, matchHint: result.matchHint || '' })
    this.applyJobFilter(this.data.jobFilter)
  },

  goNewProduct() {
    wx.vibrateShort({ type: 'light' })
    goArtisanProductCreate()
  },

  goProfile() {
    if (!this.data.canProfile) {
      wx.showToast({ title: '无个人主页权限', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: '/subpackages/manager/artisan/profile/index',
      fail: () => wx.showToast({ title: '无法打开档案页，请稍后重试', icon: 'none' })
    })
  },

  toggleSelectMode() {
    const next = !this.data.selectMode
    this.setData({
      selectMode: next,
      selectedIds: {},
      selectedCount: 0,
      detailOpen: false,
      detailItem: null
    })
    this.applyShelfFilter(this.data.shelfFilter)
  },

  toggleSelect(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim()
    if (!id) return
    const selectedIds = { ...(this.data.selectedIds || {}) }
    if (selectedIds[id]) {
      delete selectedIds[id]
    } else {
      const count = Object.keys(selectedIds).length
      if (count >= BATCH_LIMIT) {
        wx.showToast({ title: `一次最多选 ${BATCH_LIMIT} 件`, icon: 'none' })
        return
      }
      selectedIds[id] = true
    }
    this.setData({
      selectedIds,
      selectedCount: Object.keys(selectedIds).length
    })
    this.applyShelfFilter(this.data.shelfFilter)
  },

  onCardTap(e) {
    if (this.data.selectMode) {
      this.toggleSelect(e)
      return
    }
    this.openDetail(e)
  },

  openDetail(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim()
    const item = (this.data.listAll || []).find((row) => row && row._id === id)
    if (!item) return
    this.setData({ detailOpen: true, detailItem: item })
  },

  closeDetail() {
    this.setData({ detailOpen: false, detailItem: null })
  },

  noop() {},

  previewPublic() {
    const id = this.data.detailItem && this.data.detailItem._id
    if (!id) return
    wx.navigateTo({
      url: `/subpackages/feature/detail/index?id=${id}`,
      fail: () => wx.showToast({ title: '预览暂不可用', icon: 'none' })
    })
  },

  async submitShelf(id, onShelf) {
    const res = await wx.cloud.callFunction({
      name: 'manageApprovals',
      data: { action: 'submitProductShelf', productId: id, onShelf }
    })
    return (res && res.result) || {}
  },

  async toggleShelf(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim()
    const onShelf = !!(e.currentTarget.dataset && e.currentTarget.dataset.on)
    if (!id || this.data.shelfBusyId || this.data.batchBusy) return
    this.setData({ shelfBusyId: id })
    wx.showLoading({ title: '提交中', mask: true })
    try {
      const result = await this.submitShelf(id, onShelf)
      wx.hideLoading()
      if (!result.success) {
        wx.showToast({ title: formatCloudFnError(result, result.msg || '操作失败'), icon: 'none' })
        return
      }
      wx.showToast({ title: result.msg || (onShelf ? '已提交上架' : '已下架'), icon: 'none' })
      this.setData({ detailOpen: false, detailItem: null })
      this.reload()
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: formatCloudFnError(err, '操作失败，请检查网络后重试'), icon: 'none' })
    } finally {
      this.setData({ shelfBusyId: '' })
    }
  },

  async batchToggleShelf(e) {
    const onShelf = !!(e.currentTarget.dataset && e.currentTarget.dataset.on)
    const ids = Object.keys(this.data.selectedIds || {}).filter(Boolean)
    if (!ids.length) {
      wx.showToast({ title: '请先勾选作品', icon: 'none' })
      return
    }
    if (this.data.batchBusy || this.data.shelfBusyId) return
    this.setData({ batchBusy: true })
    wx.showLoading({ title: onShelf ? '批量上架中' : '批量下架中', mask: true })
    let ok = 0
    let fail = 0
    const reasons = []
    try {
      for (let i = 0; i < ids.length; i += 1) {
        try {
          const result = await this.submitShelf(ids[i], onShelf)
          if (result.success) ok += 1
          else {
            fail += 1
            if (result.msg && reasons.length < 2) reasons.push(result.msg)
          }
        } catch (err) {
          fail += 1
        }
      }
    } finally {
      wx.hideLoading()
      this.setData({ batchBusy: false, selectMode: false, selectedIds: {}, selectedCount: 0 })
    }
    const extra = reasons.length ? `：${reasons[0]}` : ''
    wx.showToast({
      title: fail ? `完成 ${ok} 件，失败 ${fail} 件${extra}` : `已处理 ${ok} 件`,
      icon: 'none',
      duration: 2200
    })
    this.reload()
  },

  editProduct(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || (this.data.detailItem && this.data.detailItem._id) || '').trim()
    if (!id) return
    this.setData({ detailOpen: false })
    wx.navigateTo({
      url: `/subpackages/manager/manager/workspace/index?tab=1&productTab=list&productId=${id}&from=artisan`,
      fail: () => wx.showToast({ title: '无法打开编辑页，请稍后重试', icon: 'none' })
    })
  },

  async advanceJob(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim()
    const next = String((e.currentTarget.dataset && e.currentTarget.dataset.next) || '').trim()
    if (!id || !next || this.data.jobBusyId) return
    this.setData({ jobBusyId: id })
    wx.showLoading({ title: '更新中', mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'managerShipOrder',
        data: { action: 'advanceProduction', orderId: id, productionStatus: next }
      })
      const result = (res && res.result) || {}
      wx.hideLoading()
      if (!result.success) {
        wx.showToast({ title: formatCloudFnError(result, result.msg || '更新失败'), icon: 'none' })
        return
      }
      wx.showToast({ title: result.msg || '已更新', icon: 'none' })
      this.reload()
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: formatCloudFnError(err, '更新失败，请检查网络后重试'), icon: 'none' })
    } finally {
      this.setData({ jobBusyId: '' })
    }
  }
})
