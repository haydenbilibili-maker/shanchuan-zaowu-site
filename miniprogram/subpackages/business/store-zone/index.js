// subpackages/business/store-zone/index.js
const { findStore, enrichZone, enrichStore, getZonesForStore } = require('../../../utils/storeHelper')
const { hydrateZoneMedia } = require('../../../utils/storeMedia')
const { trackBehavior } = require('../../../utils/trackBehavior')
const { getFirstImage } = require('../../../utils/util')
const { navigateToProductDetail } = require('../../../utils/productDetailNav')
const { withAppModal } = require('../../../utils/appModal')

const db = wx.cloud.database()
const _ = db.command

const CATEGORY_KEYWORDS = {
  INSECTA: '昆虫',
  MINERALS: '矿石',
  PLANTAE: '植物',
  MARINE: '海洋'
}

Page(withAppModal({
  data: {
    statusBarHeight: 0,
    zone: null,
    store: null,
    zoneId: '',
    storeId: '',
    swiperImages: [],
    swiperCurrent: 0,
    loading: true,
    longDescExpanded: false,
    relatedProducts: [],
    relatedWikis: [],
    loadingRelated: true
  },

  async onLoad(options) {
    // 固定入口参数，供失败重试时复用（onLoad 的 options 只在这一帧有效）
    this._zoneOptions = options || {}
    const systemInfo = wx.getSystemInfoSync()
    const zoneId = options.zoneId || ''
    const storeId = options.storeId || ''
    this.setData({
      statusBarHeight: systemInfo.statusBarHeight || 0,
      zoneId,
      storeId
    })

    if (!zoneId || !storeId) {
      wx.showToast({ title: '展陈信息不完整', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }

    let store = findStore(options.storeId)
    let zones = getZonesForStore(store.storeId)
    let rawZone = zones.find((z) => z.zoneId === options.zoneId)

    try {
      const res = await wx.cloud.callFunction({ name: 'getStoreConfig' })
      if (res.result && res.result.stores) {
        const cloudStore = res.result.stores.find((s) => s.storeId === options.storeId)
        if (cloudStore) store = { ...store, ...cloudStore }
        const cloudZones = (res.result.zones || []).filter((z) => z.storeId === options.storeId)
        if (cloudZones.length) {
          const hit = cloudZones.find((z) => z.zoneId === options.zoneId)
          if (hit) rawZone = hit
        }
      }
    } catch (e) {
      // 网络/云函数失败不等于内容下架：以前一律提示「展陈不存在或已下架」并自动返回，
      // 会把偶发故障说成内容没了，用户也无法重试
      console.warn('store-zone getStoreConfig', e)
      this.setData({ loading: false, loadError: true, zone: null })
      this.modal({
        title: '展陈加载失败',
        overline: 'LOAD FAILED',
        content: '网络或服务暂时不可用，请稍后重试。',
        confirmText: '重试',
        cancelText: '返回'
      }).then((r) => {
        if (r.confirm) {
          this.setData({ loadError: false, loading: true })
          this.onLoad(this._zoneOptions || {})
        } else {
          wx.navigateBack({ fail: () => wx.navigateTo({ url: '/subpackages/business/store/index' }) })
        }
      })
      return
    }

    let zone = enrichZone(rawZone)
    if (!zone) {
      this.setData({ loading: false, zone: null })
      wx.showToast({ title: '展陈不存在或已下架', icon: 'none' })
      setTimeout(() => wx.navigateBack({ fail: () => wx.navigateTo({ url: '/subpackages/business/store/index' }) }), 1500)
      return
    }
    try {
      zone = await hydrateZoneMedia(zone)
    } catch (e) {
      console.warn('hydrateZoneMedia', e)
    }

    const swiperImages = []
    if (zone && zone.coverImage) swiperImages.push(zone.coverImage)
    if (zone && zone.images) {
      zone.images.forEach((img) => {
        if (img && swiperImages.indexOf(img) === -1) swiperImages.push(img)
      })
    }

    this.setData({
      store: enrichStore(store),
      zone,
      swiperImages,
      loading: false
    })

    if (options.zoneId && options.storeId) {
      trackBehavior('store_zone_detail', 'zone', options.zoneId, { storeId: options.storeId })
    }

    this.loadRelatedContent(zone)
  },

  async loadRelatedContent(zone) {
    if (!zone) {
      this.setData({ loadingRelated: false })
      return
    }
    this.setData({ loadingRelated: true })
    try {
      const [products, wikis] = await Promise.all([
        this.fetchRelatedProducts(zone),
        this.fetchRelatedWikis(zone)
      ])
      this.setData({ relatedProducts: products, relatedWikis: wikis, loadingRelated: false })
    } catch (e) {
      console.warn('loadRelatedContent', e)
      this.setData({ loadingRelated: false })
    }
  },

  async fetchRelatedProducts(zone) {
    const ids = zone.relatedProductIds || []
    if (ids.length) {
      const rows = []
      for (const id of ids.slice(0, 6)) {
        try {
          const doc = await db.collection('products').doc(id).get()
          if (doc.data && doc.data.isOffShelf !== true) {
            rows.push(this.normalizeProduct(doc.data))
          }
        } catch (e) {}
      }
      if (rows.length) return rows
    }
    const keyword = CATEGORY_KEYWORDS[zone.categoryTag]
    if (!keyword) return []
    try {
      const res = await db
        .collection('products')
        .where(_.and([
          { isOffShelf: _.neq(true) },
          _.or([
            { category: db.RegExp({ regexp: keyword, options: 'i' }) },
            { title: db.RegExp({ regexp: keyword, options: 'i' }) }
          ])
        ]))
        .limit(6)
        .get()
      return (res.data || []).map((p) => this.normalizeProduct(p))
    } catch (e) {
      return []
    }
  },

  normalizeProduct(p) {
    const imgs = p.images || []
    // 需求 11：本函数是白名单映射，必须显式带上敏感形态字段，否则 gate 永远收到 false。
    // 传**原始商品对象**给判定函数（它兼容 sensitiveBlur / contentWarning 两种字段名）。
    const { sensitiveEnabledOf } = require('../../../utils/sensitiveBlurCard')
    return {
      _id: p._id,
      title: p.title || '',
      latinName: p.latinName || '',
      price: p.price || 0,
      image: getFirstImage(imgs) || p.cover || '',
      sensitiveEnabled: sensitiveEnabledOf(p)
    }
  },

  async fetchRelatedWikis(zone) {
    const ids = zone.relatedWikiIds || []
    if (ids.length) {
      const rows = []
      for (const id of ids.slice(0, 3)) {
        try {
          const doc = await db.collection('cms_wikis').doc(id).get()
          if (doc.data) rows.push(this.normalizeWiki(doc.data))
        } catch (e) {}
      }
      if (rows.length) return rows
    }
    const keyword = CATEGORY_KEYWORDS[zone.categoryTag]
    if (!keyword) return []
    try {
      const res = await db
        .collection('cms_wikis')
        .where(_.and([
          { status: _.neq('draft') },
          _.or([
            { title: db.RegExp({ regexp: keyword, options: 'i' }) },
            { category: db.RegExp({ regexp: keyword, options: 'i' }) }
          ])
        ]))
        .limit(3)
        .get()
      return (res.data || []).map((w) => this.normalizeWiki(w))
    } catch (e) {
      return []
    }
  },

  normalizeWiki(w) {
    return {
      _id: w._id,
      title: w.title || '',
      latinName: w.latinName || '',
      coverImage: w.coverImage || w.cover || '',
      brief: w.brief || ''
    }
  },

  toggleLongDesc() {
    this.setData({ longDescExpanded: !this.data.longDescExpanded })
  },

  onSwiperChange(e) {
    this.setData({ swiperCurrent: e.detail.current })
  },

  goBooking() {
    const { store, zoneId } = this.data
    const storeId = store && store.storeId
    if (!storeId) {
      wx.showToast({ title: '门店信息缺失', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/subpackages/business/booking/index?storeId=${storeId}&tab=0&from=store&zoneId=${zoneId || ''}`,
      fail: () => wx.showToast({ title: '无法打开预约', icon: 'none' })
    })
  },

  goProduct(e) {
    const id = e.currentTarget.dataset.id
    if (!id) {
      wx.showToast({ title: '藏品不存在', icon: 'none' })
      return
    }
    trackBehavior('store_zone_to_product', 'product', id, {
      zoneId: this.data.zoneId,
      storeId: this.data.storeId
    })
    const seed = (this.data.products || this.data.list || []).find((p) => p && p._id === id)
    navigateToProductDetail(id, {
      seed: seed || { _id: id },
      query: { from: 'store_zone', zoneId: this.data.zoneId },
      failToast: '无法打开藏品'
    })
  },

  goWiki(e) {
    const id = e.currentTarget.dataset.id
    if (!id) {
      wx.showToast({ title: '档案不存在', icon: 'none' })
      return
    }
    trackBehavior('store_zone_to_wiki', 'wiki', id, {
      zoneId: this.data.zoneId,
      storeId: this.data.storeId
    })
    wx.navigateTo({
      url: `/subpackages/feature/detail/wiki-detail/index?id=${id}&from=store_zone`,
      fail: () => wx.showToast({ title: '无法打开档案', icon: 'none' })
    })
  },

  goBack() {
    wx.navigateBack()
  },

  previewImage(e) {
    const src = e.currentTarget.dataset.src
    const urls = this.data.swiperImages || []
    if (!src || !urls.length) return
    wx.previewImage({ current: src, urls })
  }
}))
