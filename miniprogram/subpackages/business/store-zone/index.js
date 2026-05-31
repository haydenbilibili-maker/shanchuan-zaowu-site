// subpackages/business/store-zone/index.js
const { findStore, enrichZone, enrichStore, getZonesForStore } = require('../../../utils/storeHelper')
const { hydrateZoneMedia } = require('../../../utils/storeMedia')
const { trackBehavior } = require('../../../utils/trackBehavior')
const { getFirstImage } = require('../../../utils/util')

const db = wx.cloud.database()
const _ = db.command

const CATEGORY_KEYWORDS = {
  INSECTA: '昆虫',
  MINERALS: '矿石',
  PLANTAE: '植物',
  MARINE: '海洋'
}

Page({
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
    const systemInfo = wx.getSystemInfoSync()
    this.setData({
      statusBarHeight: systemInfo.statusBarHeight || 0,
      zoneId: options.zoneId || '',
      storeId: options.storeId || ''
    })

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
      console.warn('store-zone getStoreConfig', e)
    }

    let zone = enrichZone(rawZone)
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
    return {
      _id: p._id,
      title: p.title || '',
      latinName: p.latinName || '',
      price: p.price || 0,
      image: getFirstImage(imgs) || p.cover || ''
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
    wx.navigateTo({
      url: `/subpackages/business/booking/index?storeId=${store.storeId}&tab=0&from=store&zoneId=${zoneId}`
    })
  },

  goProduct(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    trackBehavior('store_zone_to_product', 'product', id, {
      zoneId: this.data.zoneId,
      storeId: this.data.storeId
    })
    wx.navigateTo({ url: `/pages/detail/index?id=${id}&from=store_zone&zoneId=${this.data.zoneId}` })
  },

  goWiki(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    trackBehavior('store_zone_to_wiki', 'wiki', id, {
      zoneId: this.data.zoneId,
      storeId: this.data.storeId
    })
    wx.navigateTo({ url: `/pages/detail/wiki-detail?id=${id}&from=store_zone` })
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
})
