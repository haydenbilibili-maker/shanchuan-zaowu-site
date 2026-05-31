const { getSoldCount } = require('../../utils/productStats')

Component({
  properties: { info: Object },
  data: {
    priceText: '',
    priceFrom: false,
    soldCount: 0
  },
  observers: {
    info(info) {
      if (!info) return
      const hasSku = info.hasSku && Array.isArray(info.skus) && info.skus.length > 0
      let price = info.price
      if (hasSku) {
        const prices = info.skus.map(s => parseFloat(s.price) || 0).filter(p => p > 0)
        if (prices.length) price = Math.min(...prices)
      }
      const sold = getSoldCount(info)
      this.setData({
        priceText: price,
        priceFrom: hasSku && (info.skus || []).length > 1,
        soldCount: sold
      })
    }
  },
  methods: { onTap() { this.triggerEvent('click', this.data.info) } }
})