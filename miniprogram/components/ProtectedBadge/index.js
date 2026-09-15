const { isProtectedProduct, BADGE_TEXT } = require('../../utils/protectionBadge')

Component({
  properties: {
    /** 商品对象（优先读 protectionType） */
    product: { type: null, value: null },
    /** 也可直接传 protectionType */
    protectionType: { type: String, value: '' },
    /** 外部已算好时强制显示 */
    show: { type: Boolean, value: false },
    /** xs 缩略图 / sm 卡片 / md 详情主图 */
    size: { type: String, value: 'sm' },
    /**
     * 角标锚点（父级需 position:relative）
     * tl | tr | bl | br | static（文档流内联）
     */
    corner: { type: String, value: 'bl' }
  },
  data: {
    visible: false,
    label: BADGE_TEXT
  },
  observers: {
    'product, protectionType, show'(product, protectionType, show) {
      const visible =
        !!show ||
        isProtectedProduct(product) ||
        isProtectedProduct(protectionType)
      if (visible !== this.data.visible) {
        this.setData({ visible })
      }
    }
  }
})
