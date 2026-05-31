// custom-tab-bar/index.js
const { trackTabSwitch } = require('../utils/analytics');

Component({
  data: {
    selected: 0,
    color: "#6B6560",
    selectedColor: "#C4A76C",
    cartBadge: '',
    showCartBadge: false,
    list: [
      {
        pagePath: "/pages/index/index",
        text: "探索",
        iconPath: "/assets/icons/home.png",
        selectedIconPath: "/assets/icons/home-active.png"
      },
      {
        pagePath: "/pages/category/index",
        text: "馆藏",
        iconPath: "/assets/icons/knowledge.png",
        selectedIconPath: "/assets/icons/knowledge-active.png"
      },
      {
        pagePath: "/pages/store/index",
        text: "这有店",
        iconPath: "/assets/icons/store-tab.png",
        selectedIconPath: "/assets/icons/store-tab-active.png"
      },
      {
        pagePath: "/pages/cart/index",
        text: "购物车",
        iconPath: "/assets/icons/cart.png",
        selectedIconPath: "/assets/icons/cart-active.png"
      },
      {
        pagePath: "/pages/user/index",
        text: "我的",
        iconPath: "/assets/icons/user.png",
        selectedIconPath: "/assets/icons/user-active.png"
      }
    ]
  },
  lifetimes: {
    attached() {
      this.syncCartBadgeFromGlobal();
    }
  },
  pageLifetimes: {
    show() {
      this.syncCartBadgeFromGlobal();
    }
  },
  methods: {
    syncCartBadgeFromGlobal() {
      try {
        const app = getApp();
        const count = (app.globalData && app.globalData.cartBadgeCount) || 0;
        this.setCartBadge(count);
      } catch (e) { /* ignore */ }
    },
    setCartBadge(count) {
      const n = Math.max(0, parseInt(count, 10) || 0);
      try {
        const app = getApp();
        if (app.globalData) app.globalData.cartBadgeCount = n;
      } catch (e) { /* ignore */ }
      this.setData({
        cartBadge: n > 99 ? '99+' : String(n),
        showCartBadge: n > 0
      });
    },
    switchTab(e) {
      const data = e.currentTarget.dataset;
      const url = data.path;
      const index = data.index;
      
      // 如果点击的是当前已选中的 tab，则不处理
      if (this.data.selected === index) {
        return;
      }
      
      // 立即更新选中状态，提供即时反馈
      this.setData({ selected: index });

      const tabKeys = ['explore', 'encyclopedia', 'store', 'cart', 'user'];
      trackTabSwitch(tabKeys[index] || String(index), { path: url });
      
      // 执行页面跳转
      wx.switchTab({ 
        url: url
      });
    }
  }
})