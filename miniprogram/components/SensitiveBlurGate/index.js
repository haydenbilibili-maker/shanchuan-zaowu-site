const {
  COPY,
  shouldVeilById,
  markSensitiveRevealed,
  clearSensitiveRevealed,
  hasSensitiveBlurPref,
  getSensitiveBlurPref,
  persistSensitiveBlurPref,
  subscribeSensitiveBlurPref,
  PREF_VEIL,
  PREF_CLEAR
} = require('../../utils/sensitiveBlur')
const { getWindowInfo } = require('../../utils/systemInfo')

function badgeForPref() {
  return getSensitiveBlurPref() === PREF_CLEAR ? '掩上' : COPY.badge
}

/** 详情 hero：徽章避让胶囊；放在胶囊行下方，避免与导航分享/购物车叠层 */
function getHeroBadgeStyle() {
  const win = getWindowInfo()
  const windowWidth = win.windowWidth || 375
  let menu = null
  try {
    menu = wx.getMenuButtonBoundingClientRect()
  } catch (e) { /* ignore */ }
  if (!menu || !menu.width) {
    const status = win.statusBarHeight || 44
    menu = {
      left: windowWidth - 96,
      top: status + 6,
      height: 32,
      bottom: status + 38
    }
  }
  const gap = 8
  const right = Math.max(12, Math.round(windowWidth - menu.left + gap))
  const top = Math.max(12, Math.round((menu.bottom || (menu.top + menu.height)) + gap))
  return `right:${right}px;top:${top}px;bottom:auto;`
}

Component({
  options: {
    multipleSlots: false
  },
  properties: {
    /** 是否启用敏感模糊 */
    enabled: {
      type: Boolean,
      value: false
    },
    productId: {
      type: String,
      value: ''
    },
    /** card | hero | thumb */
    size: {
      type: String,
      value: 'card'
    },
    /** 为 false 时不渲染角标（详情页改由导航栏承载） */
    showBadge: {
      type: Boolean,
      value: true
    }
  },
  data: {
    veiled: false,
    showPrefModal: false,
    prefSaving: false,
    title: COPY.title,
    sub: COPY.sub,
    badge: COPY.badge,
    badgeStyle: '',
    prefTitle: COPY.prefTitle,
    prefBody: COPY.prefBody,
    prefKeep: COPY.prefKeep,
    prefClear: COPY.prefClear
  },
  lifetimes: {
    attached() {
      this._unsubPref = subscribeSensitiveBlurPref(() => {
        this.syncVeil()
      })
      this.applySizeCopy(this.properties.size)
      this.syncBadgeStyle()
      this.syncVeil()
    },
    detached() {
      if (typeof this._unsubPref === 'function') {
        this._unsubPref()
        this._unsubPref = null
      }
    }
  },
  pageLifetimes: {
    show() {
      this.syncBadgeStyle()
      this.syncVeil()
    }
  },
  observers: {
    'enabled, productId'() {
      this.syncVeil()
    },
    size(size) {
      this.applySizeCopy(size)
      this.syncBadgeStyle()
    }
  },
  methods: {
    applySizeCopy(size) {
      if (size === 'thumb') {
        this.setData({ title: '点按启视', sub: '' })
      } else {
        this.setData({ title: COPY.title, sub: COPY.sub })
      }
    },
    syncBadgeStyle() {
      const style = this.properties.size === 'hero' ? getHeroBadgeStyle() : ''
      if (style !== this.data.badgeStyle) {
        this.setData({ badgeStyle: style })
      }
    },
    syncVeil() {
      const on = !!this.properties.enabled
      const veiled = on && shouldVeilById(this.properties.productId)
      const badge = badgeForPref()
      this.setData({
        veiled,
        badge
      })
      this.triggerEvent('change', { veiled, enabled: on, badge })
    },
    onReveal() {
      if (!this.properties.enabled || !this.data.veiled) return
      markSensitiveRevealed(this.properties.productId)
      const badge = badgeForPref()
      this.setData({
        veiled: false,
        badge
      })
      this.triggerEvent('change', { veiled: false, enabled: true, badge })
      if (!hasSensitiveBlurPref()) {
        this.setData({ showPrefModal: true })
      }
    },
    onVeil() {
      if (!this.properties.enabled || this.data.veiled) return
      clearSensitiveRevealed(this.properties.productId)
      const badge = badgeForPref()
      this.setData({ veiled: true, badge })
      this.triggerEvent('change', { veiled: true, enabled: true, badge })
    },
    noop() {},
    async onPrefKeep() {
      if (this.data.prefSaving) return
      this.setData({ prefSaving: true })
      try {
        await persistSensitiveBlurPref(PREF_VEIL)
        const badge = badgeForPref()
        this.setData({ showPrefModal: false, badge })
        this.triggerEvent('change', { veiled: this.data.veiled, enabled: true, badge })
      } finally {
        this.setData({ prefSaving: false })
      }
    },
    async onPrefClear() {
      if (this.data.prefSaving) return
      this.setData({ prefSaving: true })
      try {
        await persistSensitiveBlurPref(PREF_CLEAR)
        this.setData({ showPrefModal: false })
        this.syncVeil()
      } finally {
        this.setData({ prefSaving: false })
      }
    }
  }
})
