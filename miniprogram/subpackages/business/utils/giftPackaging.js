/**
 * 礼赠默认包装说明（展示用；非可选 SKU）
 * 与 subpackages/feature/gift/giftPackaging 文案保持一致。
 * 放在 business 分包内，避免确认订单页跨分包 require（会导致页面黑屏）。
 * 雪梨纸：业内常用名（又称拷贝纸/薄页纸），非「雪耐纸」
 */
const GIFT_PACKAGING_LABEL = 'WRAP · 包装'
const GIFT_PACKAGING_NOTE =
  '藏品取自自然。默认以牛皮纸与雪梨纸简约裹封；若需其它包装，请联系专员。'

module.exports = {
  GIFT_PACKAGING_LABEL,
  GIFT_PACKAGING_NOTE
}
