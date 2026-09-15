/**
 * 业务分包运费 helper
 *
 * 必须使用与主包 utils/shipping.js 不同的文件名：
 * 微信开发者工具会把同名模块缓存成旧的「满 299 / ¥15」实现，
 * 导致确认订单页改了源码仍渲染旧文案。
 *
 * 逻辑只来自主包 config/shipping.js。
 */
const cfg = require('../../../config/shipping')

module.exports = {
  FREE_SHIPPING_THRESHOLD: cfg.freeShippingThreshold,
  DEFAULT_SHIPPING_FEE: cfg.shippingFee,
  THRESHOLDS: cfg.thresholds,
  DEFAULT_CARRIER: cfg.defaultCarrier,
  SHIPPING_KIND: cfg.SHIPPING_KIND,
  isFreeShippingCampaignActive: cfg.isCampaignActive,
  getCampaignLabel: cfg.getCampaignLabel,
  resolveShippingKind: cfg.resolveShippingKind,
  resolveThreshold: cfg.resolveThreshold,
  calcShipping: cfg.calcShippingFee,
  getShippingRuleText: cfg.getRuleText,
  getShippingHint: cfg.getHint,
  estimateFreeShippingCouponSave: cfg.calcShippingFee,
  getShippingFeeLabel: cfg.getFeeLabel,
  getCarrierLabel: cfg.getCarrierLabel
}
