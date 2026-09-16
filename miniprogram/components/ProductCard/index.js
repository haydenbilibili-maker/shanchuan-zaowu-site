const { getDisplaySoldCount, isOneOfAKindProduct } = require('../../utils/productStats')
const { sanitizeLatinName } = require('../../utils/latinDisplay')
const { isSensitiveBlurProduct, productIdKey } = require('../../utils/sensitiveBlur')
const { buildCraftDisplayTags } = require('../../config/productTaxonomy')

function getTotalStock(info) {
  if (!info) return null
  if (info.hasSku && Array.isArray(info.skus) && info.skus.length) {
    return info.skus.reduce((sum, s) => sum + (parseInt(s && s.stock, 10) || 0), 0)
  }
  if (info.stock == null || info.stock === '') return null
  const n = parseInt(info.stock, 10)
  return Number.isNaN(n) ? null : n
}

Component({
  properties: { info: Object },
  data: {
    priceText: '',
    priceFrom: false,
    soldCount: 0,
    showSold: false,
    isOneOfAKind: false,
    soldOut: false,
    imgBroken: false,
    latinName: '',
    craftTags: [],
    sensitiveEnabled: false,
    productId: ''
  },
  observers: {
    info(info) {
      if (!info) return
      const hasSku = info.hasSku && Array.isArray(info.skus) && info.skus.length > 0
      let price = info.price
      if (hasSku) {
        const prices = info.skus.map(s => parseFloat(s.price) || 0).filter(p => p > 0)
        if (prices.length) price = Math.min.apply(null, prices)
      }
      const priceNum = parseFloat(price)
      const oneOfAKind = isOneOfAKindProduct(info)
      const sold = getDisplaySoldCount(info)
      const stock = getTotalStock(info)
      const soldOut = info.soldOut === true || (stock != null && stock <= 0)
      this.setData({
        priceText: Number.isFinite(priceNum) ? priceNum : '--',
        priceFrom: hasSku && (info.skus || []).length > 1,
        soldCount: sold == null ? 0 : sold,
        showSold: !oneOfAKind && sold != null,
        isOneOfAKind: oneOfAKind,
        soldOut,
        imgBroken: !info.httpImage,
        latinName: sanitizeLatinName(info.latinName || info.latin || info.scientificName),
        craftTags: buildCraftDisplayTags(info),
        sensitiveEnabled: isSensitiveBlurProduct(info),
        productId: productIdKey(info)
      })
    }
  },
  methods: {
    onTap() {
      // 勿用事件名 click：enhance/glass-easel 下会与原生 click 冲突，detail 变成 {x,y}
      const info = this.properties.info || this.data.info || {}
      const id = info._id != null && info._id !== '' ? String(info._id) : String(info.id || '')
      if (!id) {
        this.triggerEvent('cardtap', { id: '', title: '' })
        return
      }
      this.triggerEvent('cardtap', {
        id,
        title: info.title || '',
        category: info.category || '',
        tags: info.tags || []
      })
    },
    onImgError() {
      // 需求 17：加载失败时让缩略图能力自我降级（避免整屏破图），并回落占位。
      try {
        require('../../utils/imageUrl').onImageError()
      } catch (e) { /* 工具缺失不影响占位降级 */ }
      this.setData({ imgBroken: true })
    }
  }
})
