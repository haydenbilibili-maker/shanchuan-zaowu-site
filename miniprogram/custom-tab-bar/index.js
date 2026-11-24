// custom-tab-bar/index.js
const { trackTabSwitch } = require('../utils/analytics');

Component({
  data: {
    selected: 0,
    hidden: false,
    color: "#A09A90",
    selectedColor: "#C4A76C",
    cartBadge: '',
    cartBadgeWide: false,
    showCartBadge: false,
    list: [
      {
        pagePath: "/pages/index/index",
        text: "探索",
        iconPath: "/assets/icons/tab-explore.png",
        selectedIconPath: "/assets/icons/tab-explore-on.png"
      },
      {
        pagePath: "/pages/category/index",
        text: "馆藏",
        iconPath: "/assets/icons/tab-collection.png",
        selectedIconPath: "/assets/icons/tab-collection-on.png"
      },
      {
        pagePath: "/pages/atelier/index",
        text: "标本工坊",
        iconPath: "/assets/icons/tab-atelier.png",
        selectedIconPath: "/assets/icons/tab-atelier-on.png",
        center: true
      },
      {
        pagePath: "/pages/cart/index",
        text: "购物车",
        iconPath: "/assets/icons/tab-cart.png",
        selectedIconPath: "/assets/icons/tab-cart-on.png"
      },
      {
        pagePath: "/pages/user/index",
        text: "我的",
        iconPath: "/assets/icons/tab-user.png",
        selectedIconPath: "/assets/icons/tab-user-on.png"
      }
    ]
  },
  lifetimes: {
    attached() {
      this.syncSelectedFromRoute();
      this.syncCartBadgeFromGlobal();
    }
  },
  pageLifetimes: {
    show() {
      this.syncSelectedFromRoute();
      this.syncCartBadgeFromGlobal();
    }
  },
  methods: {
    syncSelectedFromRoute() {
      try {
        const pages = getCurrentPages();
        const cur = pages && pages.length ? pages[pages.length - 1] : null;
        const route = cur && (cur.route || (cur.$page && cur.$page.fullPath) || '');
        if (!route) return;
        const path = route.charAt(0) === '/' ? route : `/${route}`;
        const idx = this.data.list.findIndex((item) => item.pagePath === path);
        if (idx >= 0 && idx !== this.data.selected) {
          this.setData({ selected: idx });
        }
      } catch (e) { /* ignore */ }
    },
    syncCartBadgeFromGlobal() {
      try {
        const app = getApp();
        let count = (app.globalData && app.globalData.cartBadgeCount) || 0;
        // 2026-11-25：各 tab 是不同的 tab-bar 实例，切页只能读 globalData；一次失败刷新把 globalData 写成 0，
        // 角标就会在「我的」这类新实例上消失。globalData 为 0 时用本地最后一次确认值兜底（本机退出态除外）。
        if (!count) {
          const { readSavedBadge } = require('../utils/cartHelper');
          let loggedOut = false;
          try { loggedOut = require('../utils/userSession').isLocalLoggedOut(); } catch (err) { /* ignore */ }
          if (!loggedOut) count = readSavedBadge();
        }
        this.setCartBadge(count);
      } catch (e) { /* ignore */ }
    },
    setCartBadge(count) {
      const n = Math.max(0, parseInt(count, 10) || 0);
      try {
        const app = getApp();
        if (app.globalData) app.globalData.cartBadgeCount = n;
      } catch (e) { /* ignore */ }
      if (n > 0) {
        try { require('../utils/cartHelper').saveBadge(n); } catch (e) { /* ignore */ }
      }
      const cartBadge = n > 99 ? '99+' : String(n);
      this.setData({
        cartBadge,
        cartBadgeWide: cartBadge === '99+',
        showCartBadge: n > 0
      });
    },
    switchTab(e) {
      const data = e.currentTarget.dataset;
      const url = data.path;
      const index = Number(data.index);
      if (!url || Number.isNaN(index)) return;

      // 如果点击的是当前已选中的 tab，则不处理
      if (this.data.selected === index) {
        return;
      }

      const prev = this.data.selected;
      // 立即更新选中状态，提供即时反馈
      this.setData({ selected: index });

      const tabKeys = ['explore', 'encyclopedia', 'atelier', 'cart', 'user'];
      const tabKey = tabKeys[index] || String(index);
      trackTabSwitch(tabKey, { path: url });

      try {
        const { prefetchTab } = require('../utils/appPrefetch');
        const prefetchMap = {
          explore: 'explore',
          encyclopedia: 'category',
          atelier: 'atelier',
          cart: 'cart',
          user: 'user'
        };
        prefetchTab(prefetchMap[tabKey] || tabKey);
      } catch (err) { /* ignore */ }

      wx.switchTab({
        url,
        fail: () => {
          this.setData({ selected: prev });
          wx.showToast({ title: '无法切换页面', icon: 'none' });
        }
      });
    }
  }
})
