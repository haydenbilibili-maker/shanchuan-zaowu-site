/**
 * 需求 10 行为断言：站内信商品卡的展示粒度 = **名称 + 图片 + 规格**。
 *
 * 为什么要独立成文件：`sync-order-summary.sh` 的 `--check` 与 `--selftest`
 * 都要跑同一套断言 —— selftest 必须把**注入后的真源本身**拿去断言，
 * 而不是跑整条 `--check`（那会先被「副本漂移」拦下，导致「假检出」）。
 *
 * 用法：node miniprogram/scripts/assert-order-summary.cjs <orderSummary.js 绝对路径>
 */
const path = require('path')

const target = process.argv[2]
if (!target) {
  console.error('用法: node assert-order-summary.cjs <orderSummary.js>')
  process.exit(2)
}

const { pickMessageProducts, orderProductLine, DEFAULT_CARD_MAX } = require(path.resolve(target))

let bad = 0
const fail = (m) => {
  bad += 1
  console.error('  ✗ ' + m)
}

const rows = [
  {
    id: 'p1',
    title: '黑马标本·马上有',
    skuLabel: '大号',
    image: 'cloud://a.png',
    count: 1,
    price: 1200,
    craftType: 'wing_art',
    framerName: 'NATURE',
    tags: ['内部'],
    memberDiscountEnabled: true
  },
  { id: 'p1', title: '黑马标本·马上有', skuLabel: '大号', image: 'cloud://a.png', count: 2 },
  { title: '只有名称' },
  { image: 'cloud://only.png' }
]
const cards = pickMessageProducts(rows)

if (cards.length !== 3) fail(`合并/过滤后应有 3 项，实际 ${cards.length}`)
if (cards[0].title !== '黑马标本·马上有') fail('名称未带出')
if (cards[0].skuLabel !== '大号') fail('规格未带出')
if (cards[0].image !== 'cloud://a.png') fail('图片未带出')
if (cards[0].count !== 3) fail(`同款同规格应合并为 3 件，实际 ${cards[0].count}`)

// 粒度就是「名称+图片+规格」：内部字段随信外泄 = 读到一封信就能反推成本与内部枚举码
for (const key of ['price', 'craftType', 'framerName', 'tags', 'memberDiscountEnabled', 'key']) {
  if (key in cards[0]) fail(`内部字段 ${key} 泄漏进商品卡`)
}

if (cards[1].image !== '') fail('缺图应为空串（前端据此走占位）')
if (cards[2].title !== '藏品') fail('缺名应回落「藏品」')
if (pickMessageProducts(null).length !== 0) fail('空输入应为空数组')
if (pickMessageProducts('not-an-array').length !== 0) fail('非数组输入应为空数组')

// 截断：必须是**9 件不同商品**才测得出上限（同款同规格会先被合并成 1 项）
const nine = Array.from({ length: 9 }, (_, i) => ({ title: '藏品' + i, skuLabel: 'S' + i, image: '' }))
if (pickMessageProducts(nine).length !== DEFAULT_CARD_MAX) {
  fail(`超过 ${DEFAULT_CARD_MAX} 件应被截断`)
}

// 文本行仍按「名称（规格）」口径，与商品卡同源
if (orderProductLine([{ title: '黑马标本', skuLabel: '大号', count: 1 }]) !== '黑马标本（大号）') {
  fail('orderProductLine 口径被改动')
}

if (bad) {
  console.error(`✗ orderSummary 行为断言失败 ${bad} 项（文件：${target}）`)
  process.exit(1)
}
console.log('✓ orderSummary 行为断言通过（名称/规格/图片粒度 + 内部字段不外泄 + 截断）')
