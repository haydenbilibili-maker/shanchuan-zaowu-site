// pages/about/index.js
const { fetchStoreCatalog, findCatalogStore } = require('../../../utils/storeCatalog')
const { displayStoreName } = require('../../../utils/storeName')
const { DEFAULT_STORE_ID } = require('../../../utils/storeDefaults')
const { getDefaultStore } = require('../../../utils/storeHelper')
const { BRAND_WEBSITE } = require('../../../config/brand')
const { cdnPath } = require('../../../config/cloudEnv')
const easterEggHost = require('../../../utils/easterEggHost')
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

const SHARE_CONFIG = {
  title: '山海造物 · 把山海带回家',
  path: '/subpackages/business/about/index',
  imageUrl: HERO_IMAGE
};

Page({
  behaviors: [easterEggHost],
  data: {
    statusBarHeight: 20,
    heroImage: HERO_IMAGE,
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
    return SHARE_CONFIG;
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