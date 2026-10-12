/**
 * 礼赠默认包装说明（展示用；非可选 SKU）
 * 雪梨纸：业内常用名（又称拷贝纸/薄页纸），非「雪耐纸」
 */
const GIFT_PACKAGING_LABEL = 'WRAP · 包装'
const GIFT_PACKAGING_NOTE =
  '藏品取自自然。默认以牛皮纸与雪梨纸简约裹封；若需其它包装，请联系专员。'
/** 送礼页第 1 步「包装与价格」逐项说明（与上句同义，改一处须改另一处；礼笺一项同编排页「藏品纸礼笺 · 封缄后再交付」） */
const GIFT_PACKAGING_ITEMS = [
  { k: '包装', v: '牛皮纸 + 雪梨纸简约裹封' },
  { k: '礼笺', v: '下一步写的礼笺印成纸笺，随礼封缄' },
  { k: '其它', v: '需要其它包装，请联系专员' }
]

module.exports = {
  GIFT_PACKAGING_LABEL,
  GIFT_PACKAGING_NOTE,
  GIFT_PACKAGING_ITEMS
}
