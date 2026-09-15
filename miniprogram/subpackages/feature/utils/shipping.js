/**
 * 主包运费规则（购物车 / 详情等）
 * 全部逻辑以 config/shipping.js 为准，本文件只做具名再导出。
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
