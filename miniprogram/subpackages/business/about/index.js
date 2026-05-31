// pages/about/index.js
const { getDefaultStore } = require('../../../utils/storeHelper')
const { BRAND_WEBSITE } = require('../../../config/brand')

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
const SHARE_CONFIG = {
  title: '山海造物 · 把山海带回家',
  path: '/pages/about/index',
  imageUrl: 'https://images.unsplash.com/photo-1470115636492-6d2b56f9146d?q=80&w=800&auto=format&fit=crop'
};

Page({
  data: {
    statusBarHeight: 20,
    isLoaded: false, // 控制入场动画
    markers: [{
      id: 1,
      latitude: STORE_INFO.latitude,
      longitude: STORE_INFO.longitude,
      title: '山海造物',
      iconPath: '/assets/icons/location.png',
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
    
    // 启动入场动画
    setTimeout(() => {
      this.setData({ isLoaded: true });
    }, ANIMATION_DELAY);
  },

  onShareAppMessage() {
    return SHARE_CONFIG;
  },

  openMap() {
    wx.openLocation({
      latitude: STORE_INFO.latitude,
      longitude: STORE_INFO.longitude,
      name: STORE_INFO.name,
      address: STORE_INFO.address,
      scale: STORE_INFO.scale
    });
  },

  callPhone() {
    wx.makePhoneCall({ phoneNumber: STORE_INFO.phone });
  },
  
  goBack() {
    wx.navigateBack();
  },

  goToStoreTab() {
    wx.switchTab({ url: '/pages/store/index' });
  },

  copyWebsite() {
    wx.setClipboardData({
      data: this.data.brandWebsiteUrl,
      success: () => wx.showToast({ title: '官网链接已复制', icon: 'none' })
    })
  }
});