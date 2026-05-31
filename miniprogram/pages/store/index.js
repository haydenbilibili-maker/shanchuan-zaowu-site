// pages/store/index.js
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
} = require('../../utils/storeHelper')
const { DEFAULT_STORES, DEFAULT_STORE_ID } = require('../../utils/storeDefaults')
const { trackBehavior } = require('../../utils/trackBehavior')
const { normalizeStoreImageUrl, normalizeStoreImageList, hydrateStoresMedia, hydrateStoreMedia } = require('../../utils/storeMedia')
const { BRAND_WEBSITE } = require('../../config/brand')
const { findNearestStore, formatDistance } = require('../../utils/storeGeo')
const { getFirstImage, formatPrice } = require('../../utils/util')

const db = wx.cloud.database()
const LBS_SWITCH_KM = 1

Page({
  data: {
    statusBarHeight: 0,
    navPaddingRight: 32,
    scrollTop: 120,
    loading: true,
    stores: [],
    store: null,
    storePickerOpen: false,
    showCoverPlaceholder: true,
    storeActivities: [],
    hasActivities: false,
    introExpanded: false,
    tipsExpanded: true,
    walkingGuideOpen: false,
    brandWebsite: BRAND_WEBSITE.display,
    brandWebsiteUrl: BRAND_WEBSITE.url,
    lbsSheetOpen: false,
    lbsSuggestStore: null,
    checkInLoading: false,
    checkedInToday: false,
    bookingClosedToday: false,
    closedReasonLabel: '',
    experienceProducts: [],
    hasExperienceProducts: false,
    experienceLoading: false
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
    this.loadStores()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
    const preferred = getPreferredStoreId()
    if (this.data.store && this.data.store.storeId !== preferred && this.data.stores.length) {
      this.applyStore(preferred)
    }
    trackBehavior('store_tab_enter', 'store_tab', preferred || DEFAULT_STORE_ID)
    if (this.data.stores.length && !this._lbsChecked) {
      this.tryLbsSuggest()
    }
    if (this.data.store) {
      this.refreshCheckInStatus(this.data.store.storeId)
    }
  },

  onReady() {
    if (this.data.store) this.setupZoneObserver()
  },

  onUnload() {
    if (this._zoneObserver) this._zoneObserver.disconnect()
  },

  onPullDownRefresh() {
    this.loadStores().finally(() => wx.stopPullDownRefresh())
  },

  initNav() {
    const { getCustomNavLayout } = require('../../utils/customNav')
    const nav = getCustomNavLayout()
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navPaddingRight: nav.navPaddingRight,
      scrollTop: nav.statusBarHeight + 56 + 44
    })
  },

  async loadStores() {
    this.setData({ loading: true })
    let stores = DEFAULT_STORES.map(enrichStore)
    try {
      const res = await wx.cloud.callFunction({ name: 'getStoreConfig' })
      if (res.result && res.result.stores && res.result.stores.length) {
        const zones = res.result.zones || []
        stores = res.result.stores.map((s) => {
          const seed = DEFAULT_STORES.find((d) => d.storeId === s.storeId)
          const { DEFAULT_ZONES } = require('../../utils/storeDefaults')
          const openStatus = getOpenStatus(s.hours || (seed && seed.hours))
          const visitTips = (s.visitTips && s.visitTips.length)
            ? s.visitTips
            : ((seed && seed.visitTips) || [])
          const withZones = {
            ...s,
            coverImage: normalizeStoreImageUrl(s.coverImage) || (seed && seed.coverImage) || '',
            hoursText: require('../../utils/storeHelper').formatHours(s.hours),
            openStatus,
            visitTips,
            walkingGuide: mergeWalkingGuide(s),
            mapMarkers: [{
              id: 1,
              latitude: s.latitude || (seed && seed.latitude),
              longitude: s.longitude || (seed && seed.longitude),
              title: s.name,
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
            services: require('../../utils/storeHelper').getServicesForStore(s)
          }
          return withZones
        })
      }
    } catch (e) {
      console.warn('loadStores fallback', e)
    }
    try {
      stores = await hydrateStoresMedia(stores)
    } catch (e) {
      console.warn('hydrateStoresMedia', e)
    }
    this.setData({ stores, loading: false })
    const targetId = this._pendingStoreId || getPreferredStoreId()
    this.applyStore(targetId, stores)
    if (!this._lbsChecked) this.tryLbsSuggest()
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
    this.setData({
      store,
      showCoverPlaceholder: !store.coverImage,
      storePickerOpen: false,
      introExpanded: false,
      walkingGuideOpen: false
    })
    this.loadStoreActivities(store.storeId)
    this.loadBookingClosedToday(store.storeId)
    this.loadExperienceProducts(store.storeId)
    this.refreshCheckInStatus(store.storeId)
    wx.nextTick(() => this.setupZoneObserver())
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
    if (this._lbsChecked) return
    const stores = this.data.stores
    if (!stores || !stores.length) return
    this._lbsChecked = true
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        const nearest = findNearestStore(res.latitude, res.longitude, stores)
        if (!nearest || nearest.distanceKm >= LBS_SWITCH_KM) return
        const currentId = this.data.store && this.data.store.storeId
        if (nearest.store.storeId === currentId) return
        this.setData({
          lbsSheetOpen: true,
          lbsSuggestStore: {
            storeId: nearest.store.storeId,
            name: nearest.store.name,
            locationLabel: nearest.store.locationLabel,
            distanceText: formatDistance(nearest.distanceKm)
          }
        })
      },
      fail: () => {}
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

  async onCheckIn(e) {
    const source = typeof e === 'string' ? e : 'manual'
    const s = this.data.store
    if (!s || this.data.checkInLoading) return
    if (this.data.checkedInToday) {
      wx.showToast({ title: '今日已签到', icon: 'none' })
      return
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
        wx.showToast({ title: r.already ? '今日已签到' : '签到成功', icon: 'success' })
      } else {
        wx.showToast({ title: (r && r.msg) || '签到失败', icon: 'none' })
      }
    } catch (e) {
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
    this.setData({ storePickerOpen: !this.data.storePickerOpen })
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
    trackBehavior('store_booking_click', 'store', storeId, { tab: tab || 0 })
    wx.navigateTo({
      url: `/subpackages/business/booking/index?storeId=${storeId}&tab=${tab || 0}&from=store`
    })
  },

  goActivity(e) {
    const tab = e.currentTarget.dataset.tab
    const type = e.currentTarget.dataset.type
    const storeId = this.data.store ? this.data.store.storeId : DEFAULT_STORE_ID
    const tabIndex = type === 'course' ? 1 : 2
    wx.navigateTo({
      url: `/subpackages/business/booking/index?storeId=${storeId}&tab=${tab != null ? tab : tabIndex}&from=store`
    })
  },

  goService(e) {
    const { path, tab } = e.currentTarget.dataset
    const storeId = this.data.store ? this.data.store.storeId : DEFAULT_STORE_ID
    if (path && path.startsWith('/')) {
      if (path.indexOf('/pages/user/support/index') === 0) {
        wx.navigateTo({ url: `${path}?topic=booking&storeId=${storeId}` })
        return
      }
      wx.navigateTo({ url: path })
      return
    }
    if (path === 'custom') {
      wx.navigateTo({ url: '/pages/custom/hub/index' })
      return
    }
    wx.navigateTo({
      url: `/subpackages/business/booking/index?storeId=${storeId}&tab=${tab != null ? tab : 0}&from=store`
    })
  },

  goZone(e) {
    const zoneId = e.currentTarget.dataset.id
    const storeId = this.data.store.storeId
    trackBehavior('store_zone_detail', 'zone', zoneId, { storeId })
    wx.navigateTo({
      url: `/subpackages/business/store-zone/index?storeId=${storeId}&zoneId=${zoneId}`
    })
  },

  goExperienceProduct(e) {
    const id = e.currentTarget.dataset.id
    const storeId = this.data.store ? this.data.store.storeId : DEFAULT_STORE_ID
    if (!id) return
    trackBehavior('product_experience_store_click', 'product', id, { storeId, from: 'store_tab' })
    wx.navigateTo({ url: `/pages/detail/index?id=${id}&from=store&storeId=${storeId}` })
  }
})
