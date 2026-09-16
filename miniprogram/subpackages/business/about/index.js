// pages/about/index.js
const { fetchStoreCatalog, findCatalogStore } = require('../../../utils/storeCatalog')
const { displayStoreName } = require('../../../utils/storeName')
const { DEFAULT_STORE_ID } = require('../../../utils/storeDefaults')
const { getDefaultStore } = require('../../../utils/storeHelper')
const { BRAND_WEBSITE } = require('../utils/brand')
const { cdnPath } = require('../../../config/cloudEnv')
const easterEggHost = require('../../../utils/easterEggHost')
const { resolveShareImage } = require('../../../utils/util')
const {
  ONE_PERCENT_PLEDGE_LABEL,
  ONE_PERCENT_PLEDGE_SUMMARY,
  ONE_PERCENT_PLEDGE_NOTE
} = require('../utils/onePercentPledge')

const DEFAULT_STORE = getDefaultStore()
const STORE_INFO = {
  latitude: DEFAULT_STORE.latitude,
  longitude: DEFAULT_STORE.longitude,
  name: DEFAULT_STORE.name,
  address: DEFAULT_STORE.address,
  phone: DEFAULT_STORE.phone,
  scale: 18
};

const ANIMATION_DELAY = 300;
const HERO_IMAGE = cdnPath('banners/DSC00115.JPG')

/**
 * 分享卡片封面。
 *
 * ⚠ `HERO_IMAGE` 是 `cloud://` fileID，而微信分享卡片的 `imageUrl` **不支持 fileID** ——
 * 直接传会渲染成**黑块**（用户反馈「分享到小程序，页面黑色无图片」就是这个原因）。
 * 因此 onLoad 时先解析成 https 存进 data，分享时**同步**取用；解析失败则留空，
 * 让微信退回「页面截图」而不是黑块。
 */
const SHARE_CONFIG = {
  title: '山海造物 · 把山海带回家',
  path: '/subpackages/business/about/index'
};

Page({
  behaviors: [easterEggHost],
  data: {
    statusBarHeight: 20,
    heroImage: HERO_IMAGE,
    /** 解析成 https 后的分享封面；为空时微信会自动截图，不要塞 cloud:// */
    shareImageUrl: '',
    isLoaded: false, // 控制入场动画
    onePercentPledgeLabel: ONE_PERCENT_PLEDGE_LABEL,
    onePercentPledgeSummary: ONE_PERCENT_PLEDGE_SUMMARY,
    onePercentPledgeNote: ONE_PERCENT_PLEDGE_NOTE,
    pledgeExpanded: false,
    showStore: true,
    markers: [{
      id: 1,
      latitude: STORE_INFO.latitude,
      longitude: STORE_INFO.longitude,
      title: displayStoreName(DEFAULT_STORE),
      iconPath: '/subpackages/business/assets/icons/location.png',
      width: 24,
      height: 24
    }]
  },

  /** 把 cloud:// 封面解析成 https；失败留空（微信会截图，好过黑块） */
  async hydrateShareImage() {
    const url = await resolveShareImage(HERO_IMAGE)
    if (url) this.setData({ shareImageUrl: url })
  },

  onLoad() {
    const { statusBarHeight } = wx.getSystemInfoSync();
    this.setData({
      statusBarHeight,
      phone: STORE_INFO.phone,
      address: STORE_INFO.address,
      brandWebsite: BRAND_WEBSITE.display,
      brandWebsiteUrl: BRAND_WEBSITE.url
    });
    this.loadVisitStore();
    this.loadDisplayFlags();
    this.hydrateShareImage();
    
    // 启动入场动画
    setTimeout(() => {
      this.setData({ isLoaded: true });
    }, ANIMATION_DELAY);
  },

  async loadDisplayFlags() {
    try {
      const { fetchContentDisplayFlags } = require('../../../utils/contentDisplayFlags')
      const { flags } = await fetchContentDisplayFlags()
      this.setData({ showStore: flags.showStore !== false })
    } catch (e) {
      this.setData({ showStore: true })
    }
  },

  async loadVisitStore() {
    try {
      const stores = await fetchStoreCatalog()
      const store = findCatalogStore(DEFAULT_STORE_ID, stores) || getDefaultStore()
      STORE_INFO.name = displayStoreName(store)
      STORE_INFO.address = store.address || STORE_INFO.address
      STORE_INFO.phone = store.phone || STORE_INFO.phone
      STORE_INFO.latitude = store.latitude || STORE_INFO.latitude
      STORE_INFO.longitude = store.longitude || STORE_INFO.longitude
      const markers = (this.data.markers || []).map((m) => ({
        ...m,
        latitude: STORE_INFO.latitude,
        longitude: STORE_INFO.longitude,
        title: STORE_INFO.name
      }))
      this.setData({
        phone: STORE_INFO.phone,
        address: STORE_INFO.address,
        markers
      })
    } catch (e) {
      console.warn('loadVisitStore', e)
    }
  },

  onShareAppMessage() {
    // 只带上「已解析成 https」的封面；没有就省略，让微信截图（黑块比不显示更糟）
    const payload = { ...SHARE_CONFIG }
    if (this.data.shareImageUrl) payload.imageUrl = this.data.shareImageUrl
    return payload
  },

  onShareTimeline() {
    const payload = { title: SHARE_CONFIG.title }
    if (this.data.shareImageUrl) payload.imageUrl = this.data.shareImageUrl
    return payload
  },

  togglePledgeNote() {
    this.setData({ pledgeExpanded: !this.data.pledgeExpanded })
  },

  openMap() {
    if (!STORE_INFO.latitude || !STORE_INFO.longitude) {
      wx.showToast({ title: '暂未配置门店位置', icon: 'none' });
      return;
    }
    wx.openLocation({
      latitude: STORE_INFO.latitude,
      longitude: STORE_INFO.longitude,
      name: STORE_INFO.name,
      address: STORE_INFO.address,
      scale: STORE_INFO.scale,
      fail: () => wx.showToast({ title: '无法打开地图', icon: 'none' })
    });
  },

  callPhone() {
    if (!STORE_INFO.phone) {
      wx.showToast({ title: '暂未配置服务电话', icon: 'none' });
      return;
    }
    wx.makePhoneCall({
      phoneNumber: STORE_INFO.phone,
      fail: () => wx.showToast({ title: '无法拨打电话', icon: 'none' })
    });
  },
  
  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/user/index' })
    });
  },

  goToStoreTab() {
    if (!this.data.showStore) {
      const { toastStoreClosed } = require('../../../utils/contentDisplayFlags')
      toastStoreClosed()
      return
    }
    wx.navigateTo({
      url: '/subpackages/business/store/index?from=about',
      fail: () => wx.showToast({ title: '无法打开这有店', icon: 'none' })
    });
  },

  goToFramerRecruit() {
    wx.navigateTo({
      url: '/subpackages/business/framer-recruit/index?from=about',
      fail: () => wx.showToast({ title: '无法打开招募说明', icon: 'none' })
    });
  },

  copyWebsite() {
    if (!this.data.brandWebsiteUrl) {
      wx.showToast({ title: '官网地址暂未配置', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: this.data.brandWebsiteUrl,
      success: () => wx.showToast({ title: '官网链接已复制', icon: 'none' }),
      fail: () => wx.showToast({ title: '复制失败', icon: 'none' })
    })
  }
});