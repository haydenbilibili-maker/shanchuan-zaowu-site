// subpackages/business/store/index.js
const {
  getPreferredStoreId,
  setPreferredStoreId,
  findStore,
  enrichStore,
  enrichZone,
  getOpenStatus,
  mergeWalkingGuide,
  getTodayDateStr,
  closedReasonLabel
} = require('../../../utils/storeHelper')
const { DEFAULT_STORES, DEFAULT_STORE_ID } = require('../../../utils/storeDefaults')
const { trackBehavior } = require('../../../utils/trackBehavior')
const { navigateToProductDetail } = require('../../../utils/productDetailNav')
const { STORE_COVER } = require('../../../config/storeMediaCdn')
const { normalizeStoreImageUrl, normalizeStoreImageList, hydrateStoresMedia, hydrateStoreMedia } = require('../../../utils/storeMedia')
const { BRAND_WEBSITE } = require('../utils/brand')
const { findNearestStore, formatDistance } = require('../../../utils/storeGeo')
const { getFirstImage, formatPrice } = require('../../../utils/util')
const { getAuthorizedLocation } = require('../../../utils/locationAuth')

const db = wx.cloud.database()
const LBS_SWITCH_KM = 1

Page({
  data: {
    statusBarHeight: 0,
    scrollTop: 112,
    loading: true,
    stores: [],
    store: null,
    storePickerOpen: false,
    showCoverPlaceholder: true,
    storeActivities: [],
    hasActivities: false,
    introExpanded: false,
    tipsExpanded: false,
    walkingGuideOpen: false,
    brandWebsite: BRAND_WEBSITE.display,
    brandWebsiteUrl: BRAND_WEBSITE.url,
    lbsSheetOpen: false,
    lbsSuggestStore: null,
    checkInLoading: false,
    checkedInToday: false,
    checkInDockVisible: true,
    bookingClosedToday: false,
    closedReasonLabel: '',
    experienceProducts: [],
    hasExperienceProducts: false,
    experienceLoading: false,
    enterReady: false,
    featuresLine: '',
    entryBlocked: false
  },

  onLoad(options) {
    this.initNav()
    if (options && options.storeId) {
      setPreferredStoreId(options.storeId)
      this._pendingStoreId = options.storeId
    }
    if (options && options.from === 'scan') {
      this._scanCheckIn = true
    }
    this.guardEntry().then((ok) => {
      if (ok) this.loadStores()
    })
  },

  async guardEntry() {
    try {
      const { fetchContentDisplayFlags, getCachedContentDisplayFlags, toastStoreClosed } = require('../../../utils/contentDisplayFlags')
      const cached = getCachedContentDisplayFlags()
      if (cached && cached.flags && cached.flags.showStore === false) {
        this.setData({ entryBlocked: true, loading: false })
        toastStoreClosed()
        setTimeout(() => {
          wx.navigateBack({
            fail: () => wx.switchTab({ url: '/pages/user/index' })
          })
        }, 400)
        return false
      }
      const { flags } = await fetchContentDisplayFlags()
      if (!flags.showStore) {
        this.setData({ entryBlocked: true, loading: false })
        toastStoreClosed()
        setTimeout(() => {
          wx.navigateBack({
            fail: () => wx.switchTab({ url: '/pages/user/index' })
          })
        }, 400)
        return false
      }
    } catch (e) {
      console.warn('store guardEntry', e)
    }
    return true
  },

  onShow() {
    if (this.data.entryBlocked) return
    const preferred = getPreferredStoreId()
    if (this.data.store && this.data.store.storeId !== preferred && this.data.stores.length) {
      this.applyStore(preferred)
    }
    trackBehavior('store_tab_enter', 'store_tab', preferred || DEFAULT_STORE_ID)
    if (this.data.stores.length) {
      this.tryLbsSuggest()
    }
    if (this.data.store) {
      this.refreshCheckInStatus(this.data.store.storeId)
      this.setupZoneObserver()
      this.setupCheckInObserver()
    }
  },

  onHide() {
    this.teardownObservers()
  },

  onReady() {
    this.measureSticky()
    if (this.data.store) {
      this.setupZoneObserver()
      this.setupCheckInObserver()
    }
  },

  onUnload() {
    this.teardownObservers()
  },

  teardownObservers() {
    if (this._zoneObserver) {
      this._zoneObserver.disconnect()
      this._zoneObserver = null
    }
    if (this._checkInObserver) {
      this._checkInObserver.disconnect()
      this._checkInObserver = null
    }
  },

  onPullDownRefresh() {
    if (this.data.entryBlocked) {
      wx.stopPullDownRefresh()
      return
    }
    this.loadStores().finally(() => wx.stopPullDownRefresh())
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/user/index' })
    })
  },

  initNav() {
    // 系统默认导航栏；顶栏 switcher 在页面内容区内，不按 custom nav 加 statusBar
    this.measureSticky()
  },

  measureSticky() {
    wx.nextTick(() => {
      const q = wx.createSelectorQuery()
      q.select('.sticky-top').boundingClientRect()
      q.exec((res) => {
        const rect = res && res[0]
        if (rect && rect.height) {
          this.setData({ scrollTop: Math.ceil(rect.height) })
        } else {
          const multi = this.data.stores && this.data.stores.length > 1
          this.setData({ scrollTop: multi ? 112 : 72 })
        }
      })
    })
  },

  buildStoresFromConfig(storesRaw, zonesRaw) {
    const zones = zonesRaw || []
    return (storesRaw || []).map((s) => {
      const seed = DEFAULT_STORES.find((d) => d.storeId === s.storeId)
      const { DEFAULT_ZONES } = require('../../../utils/storeDefaults')
      const openStatus = getOpenStatus(s.hours || (seed && seed.hours))
      const visitTips = (s.visitTips && s.visitTips.length)
        ? s.visitTips
        : ((seed && seed.visitTips) || [])
      return {
        ...s,
        coverImage: s.storeId === DEFAULT_STORE_ID
          ? STORE_COVER.store_shanhaizaowu
          : (normalizeStoreImageUrl(s.coverImage) || (seed && seed.coverImage) || ''),
        hoursText: require('../../../utils/storeHelper').formatHours(s.hours),
        openStatus,
        visitTips,
        walkingGuide: mergeWalkingGuide(s, storesRaw),
        mapMarkers: [{
          id: 1,
          latitude: s.latitude || (seed && seed.latitude),
          longitude: s.longitude || (seed && seed.longitude),
          title: s.name || '门店',
          width: 24,
          height: 24
        }],
        zones: zones
          .filter((z) => z.storeId === s.storeId)
          .map((z) => {
            const zseed = DEFAULT_ZONES.find((d) => d.zoneId === z.zoneId)
            return enrichZone({
              ...z,
              coverImage: normalizeStoreImageUrl(z.coverImage) || (zseed && zseed.coverImage) || '',
              images: normalizeStoreImageList(z.images).length
                ? normalizeStoreImageList(z.images)
                : normalizeStoreImageList((zseed && zseed.images) || [])
            })
          }),
        services: require('../../../utils/storeHelper').getServicesForStore(s)
      }
    })
  },

  async paintStores(stores, opts) {
    const options = opts || {}
    let next = stores
    try {
      next = await hydrateStoresMedia(stores)
    } catch (e) {
      console.warn('hydrateStoresMedia', e)
    }
    this.setData({ stores: next, loading: false })
    this.measureSticky()
    const targetId = this._pendingStoreId || getPreferredStoreId()
    this.applyStore(targetId, next)
    if (!options.skipLbs && !this._lbsChecked) this.tryLbsSuggest()
  },

  async loadStores() {
    const { getCachedStoreConfig, fetchStoreCatalog } = require('../../../utils/storeCatalog')
    const cached = getCachedStoreConfig()
    const hasCache = !!(cached && cached.stores && cached.stores.length)

    if (hasCache) {
      await this.paintStores(this.buildStoresFromConfig(cached.stores, cached.zones))
    } else {
      this.setData({ loading: true })
      await this.paintStores(DEFAULT_STORES.map(enrichStore), { skipLbs: true })
    }

    try {
      // force：等待网络（可与冷启动 inflight 合并），保证静默更新到最新
      await fetchStoreCatalog({ force: true })
      const fresh = getCachedStoreConfig()
      if (fresh && fresh.stores && fresh.stores.length) {
        await this.paintStores(this.buildStoresFromConfig(fresh.stores, fresh.zones))
      }
    } catch (e) {
      console.warn('loadStores fallback', e)
      if (!this.data.stores || !this.data.stores.length) {
        await this.paintStores(DEFAULT_STORES.map(enrichStore))
      } else {
        this.setData({ loading: false })
      }
    }
  },

  async applyStore(storeId, storesList) {
    const list = storesList || this.data.stores
    const raw = findStore(storeId)
    let fromList = list.find((s) => s.storeId === storeId)
    let store = fromList || enrichStore(raw)
    if (!fromList) {
      try {
        store = await hydrateStoreMedia(store)
      } catch (e) {
        console.warn('hydrateStoreMedia', e)
      }
    }
    setPreferredStoreId(store.storeId)
    try {
      wx.setStorageSync('lastStoreVisitAt', new Date().toISOString())
    } catch (e) {}
    const features = (store.features || []).filter(Boolean).slice(0, 3)
    this.setData({
      store,
      featuresLine: features.join(' · '),
      showCoverPlaceholder: !store.coverImage,
      storePickerOpen: false,
      introExpanded: false,
      tipsExpanded: false,
      walkingGuideOpen: false,
      enterReady: false,
      checkedInToday: false,
      checkInDockVisible: true
    })
    wx.nextTick(() => {
      this.setData({ enterReady: true })
      this.measureSticky()
      this.setupZoneObserver()
      this.setupCheckInObserver()
    })
    this.loadStoreActivities(store.storeId)
    this.loadBookingClosedToday(store.storeId)
    this.loadExperienceProducts(store.storeId)
    this.refreshCheckInStatus(store.storeId)
    if (this._scanCheckIn) {
      this._scanCheckIn = false
      wx.nextTick(() => this.onCheckIn('scan'))
    }
  },

  async loadBookingClosedToday(storeId) {
    const date = getTodayDateStr()
    try {
      const res = await wx.cloud.callFunction({
        name: 'getBookingAvailability',
        data: { storeId, date }
      })
      const data = res.result && res.result.data
      const closed = !!(data && data.closed)
      this.setData({
        bookingClosedToday: closed,
        closedReasonLabel: closed ? closedReasonLabel(data.closedReason) : ''
      })
    } catch (e) {
      console.warn('loadBookingClosedToday', e)
      this.setData({ bookingClosedToday: false, closedReasonLabel: '' })
    }
  },

  async loadExperienceProducts(storeId) {
    this.setData({ experienceLoading: true, experienceProducts: [], hasExperienceProducts: false })
    try {
      const res = await db.collection('products')
        .where({ isOffShelf: false, experienceStores: storeId })
        .orderBy('createTime', 'desc')
        .limit(6)
        .get()
      const experienceProducts = (res.data || []).map((p) => ({
        _id: p._id,
        title: p.title,
        latinName: p.latinName || '',
        priceText: formatPrice(p.price),
        image: getFirstImage(p.images)
      }))
      this.setData({
        experienceProducts,
        hasExperienceProducts: experienceProducts.length > 0,
        experienceLoading: false
      })
    } catch (e) {
      console.warn('loadExperienceProducts', e)
      this.setData({ experienceLoading: false })
    }
  },

  async refreshCheckInStatus(storeId) {
    if (!storeId) return
    try {
      const res = await wx.cloud.callFunction({
        name: 'storeCheckIn',
        data: { action: 'getTodayStatus', storeId }
      })
      const r = res.result
      if (r && r.success) {
        this.setData({ checkedInToday: !!r.checkedIn })
      }
    } catch (e) {
      console.warn('refreshCheckInStatus', e)
    }
  },

  tryLbsSuggest() {
    const stores = this.data.stores
    if (!stores || !stores.length) return
    getAuthorizedLocation({ type: 'gcj02' }).then((res) => {
      if (res) this.applyLbsFromCoords(res)
    })
  },

  applyLbsFromCoords(res) {
    if (this._lbsSheetDone || !res) return
    const stores = this.data.stores
    if (!stores || !stores.length) return
    const nearest = findNearestStore(res.latitude, res.longitude, stores)
    if (!nearest || nearest.distanceKm >= LBS_SWITCH_KM) return
    const currentId = this.data.store && this.data.store.storeId
    if (nearest.store.storeId === currentId) return
    this._lbsSheetDone = true
    this.setData({
      lbsSheetOpen: false,
      lbsSuggestStore: {
        storeId: nearest.store.storeId,
        name: nearest.store.name,
        locationLabel: nearest.store.locationLabel,
        distanceText: formatDistance(nearest.distanceKm)
      }
    })
    wx.nextTick(() => {
      this.setData({ lbsSheetOpen: true })
    })
  },

  confirmLbsSwitch() {
    const s = this.data.lbsSuggestStore
    if (!s || !s.storeId) {
      this.setData({ lbsSheetOpen: false })
      return
    }
    trackBehavior('store_lbs_switch', 'store', s.storeId)
    this.setData({ lbsSheetOpen: false, lbsSuggestStore: null })
    this.applyStore(s.storeId)
  },

  dismissLbsSheet() {
    this.setData({ lbsSheetOpen: false })
  },

  setupZoneObserver() {
    if (this._zoneObserver) this._zoneObserver.disconnect()
    this._zoneObserved = this._zoneObserved || new Set()
    if (!this.data.store || !this.data.store.zones || !this.data.store.zones.length) return
    this._zoneObserver = this.createIntersectionObserver({ thresholds: [0.5], observeAll: true })
    this._zoneObserver.relativeTo('.main-scroll', { bottom: 0 }).observe('.zone-card', (res) => {
      const zoneId = res.dataset && res.dataset.id
      if (!zoneId || this._zoneObserved.has(zoneId)) return
      if (res.intersectionRatio >= 0.5) {
        this._zoneObserved.add(zoneId)
        const storeId = this.data.store && this.data.store.storeId
        trackBehavior('store_zone_view', 'zone', zoneId, { storeId })
      }
    })
  },

  setupCheckInObserver() {
    if (this._checkInObserver) {
      this._checkInObserver.disconnect()
      this._checkInObserver = null
    }
    if (!this.data.store) return
    this.setData({ checkInDockVisible: true })
    wx.nextTick(() => {
      this._checkInObserver = this.createIntersectionObserver({ thresholds: [0, 0.15, 1] })
      this._checkInObserver.relativeToViewport({ bottom: 24 }).observe('.checkin-inline', (res) => {
        const visible = res.intersectionRatio > 0.12
        if (this.data.checkInDockVisible === !visible) return
        this.setData({ checkInDockVisible: !visible })
      })
    })
  },

  async onCheckIn(e) {
    const source = typeof e === 'string' ? e : 'manual'
    const s = this.data.store
    if (!s || this.data.checkInLoading) return
    if (this.data.checkedInToday) {
      wx.showToast({ title: '今日已到店', icon: 'none' })
      return
    }
    // 多店时确认当前选中店，避免签错门店
    if (this.data.stores.length > 1 && source !== 'scan') {
      const ok = await new Promise((resolve) => {
        wx.showModal({
          title: '确认到店',
          content: `将为「${s.name}」签到，请确认您已到达该店。`,
          confirmText: '确认到店',
          confirmColor: '#C4A76C',
          success: (r) => resolve(!!r.confirm),
          fail: () => resolve(false)
        })
      })
      if (!ok) return
    }
    const checkSource = source === 'scan' ? 'scan' : 'manual'
    this.setData({ checkInLoading: true })
    wx.showLoading({ title: '签到中…', mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'storeCheckIn',
        data: { storeId: s.storeId, storeName: s.name, source: checkSource }
      })
      wx.hideLoading()
      const r = res.result
      if (r && r.success) {
        trackBehavior('store_checkin', 'store', s.storeId, { already: !!r.already, source: checkSource })
        this.setData({ checkedInToday: true })
        const atlasMsg = r.atlas && r.atlas.first && r.atlas.msg
        wx.showToast({
          title: atlasMsg || (r.already ? '今日已到店' : '签到成功'),
          icon: atlasMsg ? 'none' : 'success',
          duration: atlasMsg ? 2600 : 1500
        })
      } else {
        wx.showToast({ title: (r && r.msg) || '签到失败', icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '签到失败', icon: 'none' })
    } finally {
      this.setData({ checkInLoading: false })
    }
  },

  async loadStoreActivities(storeId) {
    try {
      let all = []
      try {
        const res = await db
          .collection('activities')
          .where({ status: 'open', storeId })
          .orderBy('date', 'asc')
          .limit(10)
          .get()
        all = res.data || []
      } catch (e) {
        const res = await db.collection('activities').where({ status: 'open' }).orderBy('date', 'asc').limit(30).get()
        all = (res.data || []).filter((item) => !item.storeId || item.storeId === storeId)
      }
      const storeActivities = all.slice(0, 4)
      this.setData({
        storeActivities,
        hasActivities: storeActivities.length > 0
      })
    } catch (e) {
      console.warn('loadStoreActivities', e)
      this.setData({ storeActivities: [], hasActivities: false })
    }
  },

  toggleStorePicker() {
    const opening = !this.data.storePickerOpen
    this.setData({ storePickerOpen: opening })
    if (opening && !this._lbsPrompted) {
      this._lbsPrompted = true
      wx.getLocation({
        type: 'gcj02',
        success: (res) => this.applyLbsFromCoords(res),
        fail: () => {}
      })
    }
  },

  closeStorePicker() {
    this.setData({ storePickerOpen: false })
  },

  selectStore(e) {
    const storeId = e.currentTarget.dataset.id
    if (!storeId || storeId === this.data.store.storeId) {
      this.closeStorePicker()
      return
    }
    wx.vibrateShort({ type: 'light' })
    trackBehavior('store_switch', 'store', storeId, { from: this.data.store.storeId })
    this.applyStore(storeId)
  },

  quickSelectStore(e) {
    const storeId = e.currentTarget.dataset.id
    if (!storeId || storeId === this.data.store.storeId) return
    wx.vibrateShort({ type: 'light' })
    trackBehavior('store_switch', 'store', storeId, { from: this.data.store.storeId, via: 'pill' })
    this.applyStore(storeId)
  },

  openMap() {
    const s = this.data.store
    if (!s) return
    trackBehavior('store_navigate_map', 'store', s.storeId)
    wx.openLocation({
      latitude: s.latitude,
      longitude: s.longitude,
      name: s.name,
      address: s.address,
      scale: 18
    })
  },

  callStore() {
    const s = this.data.store
    if (!s || !s.phone) return
    trackBehavior('store_call', 'store', s.storeId)
    wx.makePhoneCall({ phoneNumber: s.phone })
  },

  copyAddress() {
    const s = this.data.store
    if (!s || !s.address) return
    wx.vibrateShort({ type: 'light' })
    wx.setClipboardData({
      data: `${s.name}\n${s.address}\n${s.phone || ''}`,
      success: () => wx.showToast({ title: '地址已复制', icon: 'none' })
    })
  },

  copyPhone() {
    const s = this.data.store
    if (!s || !s.phone) return
    wx.setClipboardData({
      data: s.phone,
      success: () => wx.showToast({ title: '电话已复制', icon: 'none' })
    })
  },

  copyWebsite() {
    wx.setClipboardData({
      data: this.data.brandWebsiteUrl,
      success: () => wx.showToast({ title: '官网链接已复制', icon: 'none' })
    })
  },

  toggleIntro() {
    this.setData({ introExpanded: !this.data.introExpanded })
  },

  toggleTips() {
    this.setData({ tipsExpanded: !this.data.tipsExpanded })
  },

  toggleWalkingGuide() {
    const open = !this.data.walkingGuideOpen
    if (open && this.data.store && this.data.store.walkingGuide) {
      trackBehavior('store_walking_guide_view', 'store', this.data.store.storeId)
    }
    this.setData({ walkingGuideOpen: open })
  },

  goPeerStore() {
    const guide = this.data.store && this.data.store.walkingGuide
    if (!guide || !guide.peerStoreId) return
    this.applyStore(guide.peerStoreId)
  },

  previewHero() {
    const url = this.data.store && this.data.store.coverImage
    if (!url) return
    wx.previewImage({ urls: [url], current: url })
  },

  goBooking(e) {
    if (this.data.bookingClosedToday) {
      wx.showToast({ title: this.data.closedReasonLabel || '今日不可预约', icon: 'none' })
      return
    }
    const tab = e.currentTarget.dataset.tab
    const storeId = this.data.store ? this.data.store.storeId : DEFAULT_STORE_ID
    if (!storeId) {
      wx.showToast({ title: '门店信息缺失', icon: 'none' })
      return
    }
    trackBehavior('store_booking_click', 'store', storeId, { tab: tab || 0 })
    wx.navigateTo({
      url: `/subpackages/business/booking/index?storeId=${storeId}&tab=${tab || 0}&from=store`,
      fail: () => wx.showToast({ title: '无法打开预约', icon: 'none' })
    })
  },

  goActivity(e) {
    if (this.data.bookingClosedToday) {
      wx.showToast({ title: this.data.closedReasonLabel || '今日不可预约', icon: 'none' })
      return
    }
    const tab = e.currentTarget.dataset.tab
    const type = e.currentTarget.dataset.type
    const storeId = this.data.store ? this.data.store.storeId : DEFAULT_STORE_ID
    if (!storeId) {
      wx.showToast({ title: '门店信息缺失', icon: 'none' })
      return
    }
    const tabIndex = type === 'course' ? 1 : 2
    wx.navigateTo({
      url: `/subpackages/business/booking/index?storeId=${storeId}&tab=${tab != null ? tab : tabIndex}&from=store`,
      fail: () => wx.showToast({ title: '无法打开预约', icon: 'none' })
    })
  },

  goService(e) {
    const { path, tab } = e.currentTarget.dataset
    const storeId = this.data.store ? this.data.store.storeId : DEFAULT_STORE_ID
    if (path && path.startsWith('/')) {
      if (path.indexOf('/subpackages/extra/user/support/index') === 0) {
        wx.navigateTo({
          url: `${path}?topic=booking&storeId=${storeId}`,
          fail: () => wx.showToast({ title: '无法打开页面', icon: 'none' })
        })
        return
      }
      const tabPaths = {
        '/pages/index/index': true,
        '/pages/category/index': true,
        '/pages/atelier/index': true,
        '/pages/cart/index': true,
        '/pages/user/index': true
      }
      const bare = String(path).split('?')[0]
      if (tabPaths[bare]) {
        wx.switchTab({
          url: bare,
          fail: () => wx.showToast({ title: '无法打开页面', icon: 'none' })
        })
        return
      }
      wx.navigateTo({
        url: path,
        fail: () => wx.showToast({ title: '无法打开页面', icon: 'none' })
      })
      return
    }
    if (path === 'custom') {
      wx.switchTab({
        url: '/pages/atelier/index',
        fail: () => wx.showToast({ title: '无法打开工坊', icon: 'none' })
      })
      return
    }
    if (this.data.bookingClosedToday) {
      wx.showToast({ title: this.data.closedReasonLabel || '今日不可预约', icon: 'none' })
      return
    }
    if (!storeId) {
      wx.showToast({ title: '门店信息缺失', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/subpackages/business/booking/index?storeId=${storeId}&tab=${tab != null ? tab : 0}&from=store`,
      fail: () => wx.showToast({ title: '无法打开预约', icon: 'none' })
    })
  },

  goZone(e) {
    const zoneId = e.currentTarget.dataset.id
    const storeId = this.data.store && this.data.store.storeId
    if (!zoneId || !storeId) {
      wx.showToast({ title: '展陈信息缺失', icon: 'none' })
      return
    }
    trackBehavior('store_zone_detail', 'zone', zoneId, { storeId })
    wx.navigateTo({
      url: `/subpackages/business/store-zone/index?storeId=${storeId}&zoneId=${zoneId}`,
      fail: () => wx.showToast({ title: '无法打开展陈', icon: 'none' })
    })
  },

  goExperienceProduct(e) {
    const id = e.currentTarget.dataset.id
    const storeId = this.data.store ? this.data.store.storeId : DEFAULT_STORE_ID
    if (!id) {
      wx.showToast({ title: '藏品不存在', icon: 'none' })
      return
    }
    trackBehavior('product_experience_store_click', 'product', id, { storeId, from: 'store_tab' })
    const seed = (this.data.experienceProducts || this.data.products || []).find((p) => p && p._id === id)
    navigateToProductDetail(id, {
      seed: seed || { _id: id },
      query: { from: 'store', storeId },
      failToast: '无法打开藏品'
    })
  }
})
