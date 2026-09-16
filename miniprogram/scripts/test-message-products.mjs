/**
 * 需求 10「山海有信商品提示只见订单号」行为断言
 *
 * 业务确认的展示粒度：**名称 + 图片 + 规格**（三者都要）。
 *
 * 为什么必须跑真源码而不是只做静态检查，这条链路上有三处**只在运行时才暴露**的坑：
 *   1. 商品卡落库前必须裁掉 price / craftType / framerName 等内部字段 ——
 *      漏裁 = 读到一封信就能反推成本与内部枚举码（越权信息泄漏）；
 *   2. 通知日志行（notification_logs）永远没有商品字段，合并时若让它覆盖
 *      user_messages 行，卡片会被抹成空数组（静默丢卡）；
 *   3. 模板里的 {{productLine}} 只有在调用方传了 products 时才渲染得出，
 *      漏传就退回「只有订单号」的旧形态。
 *
 * 用法：
 *   node miniprogram/scripts/test-message-products.mjs
 *   node miniprogram/scripts/test-message-products.mjs --selftest
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

let passed = 0
let failed = 0
const failures = []
function check(name, cond, extra) {
  if (cond) passed += 1
  else {
    failed += 1
    failures.push(`${name}${extra ? ' — ' + extra : ''}`)
  }
}
function eq(name, got, want) {
  check(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}

/**
 * --selftest 用的源码回归注入：每个注入都是**真实可能写错的一行**。
 */
const INJECTIONS = {
  // 直接把原始 order.products 落库 → price/tags/framerName 等内部字段随信外泄
  'store-raw-products': {
    file: 'miniprogram/cloudfunctions/dispatchMessage/core.js',
    from: 'const messageProducts = pickMessageProducts(vars.products)',
    to: 'const messageProducts = Array.isArray(vars.products) ? vars.products : []'
  },
  // 忘记把商品卡写进消息文档 → 前端永远没有卡片可渲染
  'skip-persist-products': {
    file: 'miniprogram/cloudfunctions/dispatchMessage/core.js',
    from: 'if (Array.isArray(products) && products.length) data.products = products',
    to: 'if (false) data.products = products'
  },
  // 商品卡丢了图片 → 粒度退化成「名称+规格」
  'drop-card-image': {
    file: 'miniprogram/utils/messageHelper.js',
    from: 'hasImage: !!item.image,',
    to: 'hasImage: false,'
  },
  // 制作类模板退回「只有订单号」
  'drop-product-line': {
    file: 'miniprogram/cloudfunctions/dispatchMessage/templates.js',
    from: "contentTemplate: '订单 {{orderNo}} 装裱已完成，正在包装。\\n{{productLine}}\\n即将启程。',",
    to: "contentTemplate: '订单 {{orderNo}} 装裱已完成，正在包装。\\n即将启程。',"
  },
  // 合并时让日志行覆盖 user_messages → 卡片被抹空
  'merge-overwrites-products': {
    file: 'miniprogram/cloudfunctions/getUserMessages/index.js',
    from: 'products: (primary.products && primary.products.length) ? primary.products : (secondary.products || []),',
    to: 'products: primary.products || [],'
  }
}

const INJECT = String(process.env.MSG_PRODUCTS_INJECT || '').trim()
function readSrc(file) {
  const raw = readFileSync(resolve(ROOT, file), 'utf8')
  if (!INJECT) return raw
  const inj = INJECTIONS[INJECT]
  if (!inj) throw new Error('unknown injection ' + INJECT)
  if (inj.file !== file) return raw
  if (raw.indexOf(inj.from) === -1) throw new Error('injection anchor missing: ' + INJECT)
  return raw.replace(inj.from, inj.to)
}

/* ------------------------------------------------------------------ *
 * 1) 客户端：信件商品卡（名称 + 图片 + 规格）
 * ------------------------------------------------------------------ */

const helper = (() => {
  const src = readSrc('miniprogram/utils/messageHelper.js')
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', src)(module, module.exports)
  return module.exports
})()

const baseMsg = {
  _id: 'm1',
  type: 'order_shipped',
  category: 'order',
  title: '标本已启程',
  content: '这件标本已启程。\n订单 ORD001',
  relatedId: 'ord1',
  read: false,
  createTime: '2026-09-16T10:00:00.000Z',
  products: [
    { id: 'p1', title: '黑马标本·马上有', image: 'cloud://a.png', skuLabel: '大号', count: 1 },
    { id: 'p2', title: '蓝闪蝶标本', image: '', skuLabel: '', count: 2 }
  ]
}
const letter = helper.enrichMessage(baseMsg)

check('有商品 → hasProductCards 为真', letter.hasProductCards === true)
eq('商品卡数量', letter.productCards.length, 2)
eq('卡 1 名称', letter.productCards[0].title, '黑马标本·马上有')
eq('卡 1 图片', letter.productCards[0].image, 'cloud://a.png')
eq('卡 1 规格', letter.productCards[0].skuLabel, '大号')
check('卡 1 标记有图', letter.productCards[0].hasImage === true)
check('卡 2 标记无图（前端走占位）', letter.productCards[1].hasImage === false)
eq('卡 2 数量文案', letter.productCards[1].countText, '×2')
eq('卡 1 单件无数量文案', letter.productCards[0].countText, '')

// 列表紧凑摘要
eq('列表摘要取首件名 + 项数', letter.productSummary, '黑马标本·马上有 等 2 项')
eq('列表缩略图只收有图的（≤3）', letter.productThumbs.length, 1)
eq('列表缩略图地址', letter.productThumbs[0].image, 'cloud://a.png')

// 无商品 → 不渲染卡片，也不影响正文解析
const plain = helper.enrichMessage({ ...baseMsg, products: undefined })
check('无商品 → hasProductCards 为假', plain.hasProductCards === false)
eq('无商品 → 卡片数组为空', plain.productCards.length, 0)
eq('无商品 → 列表摘要为空串', plain.productSummary, '')
check('无商品 → 正文照常解析', plain.bodyBlocks.length >= 1)

// 脏数据防御
const dirty = helper.enrichMessage({ ...baseMsg, products: 'oops' })
check('products 非数组 → 不抛错且无卡片', dirty.hasProductCards === false)
const many = helper.enrichMessage({
  ...baseMsg,
  products: Array.from({ length: 9 }, (_, i) => ({ id: 'x' + i, title: '藏品' + i, image: '', skuLabel: '' }))
})
eq('商品卡最多 5 张', many.productCards.length, 5)
const blank = helper.enrichMessage({ ...baseMsg, products: [{ title: '', image: '' }, { title: '有效', image: '' }] })
eq('名称与图片都空的条目被丢弃', blank.productCards.length, 1)

/* ------------------------------------------------------------------ *
 * 2) 云端：dispatch 落库商品卡 + 内部字段不外泄
 * ------------------------------------------------------------------ */

const written = []
function makeDb() {
  return {
    serverDate: () => 'SERVER_DATE',
    command: { push: (a) => ({ $push: a }) },
    collection(name) {
      if (name === 'message_templates') {
        return {
          where() { return this },
          limit() { return this },
          async get() { return { data: [] } }
        }
      }
      if (name === 'user_messages') {
        return {
          where() { return this },
          limit() { return this },
          async get() { return { data: [] } },
          async add({ data }) {
            written.push(data)
            return { _id: 'msg-' + written.length }
          }
        }
      }
      if (name === 'notification_logs') {
        return { async add() { return { _id: 'log1' } } }
      }
      throw new Error('unexpected collection ' + name)
    }
  }
}

/** 支持云函数内部相对 require 的加载器（云函数之间不能跨目录 require） */
function makeLoader(cloudStub) {
  const cache = {}
  const load = (rel) => {
    if (cache[rel]) return cache[rel].exports
    const module = { exports: {} }
    cache[rel] = module
    const dir = rel.slice(0, rel.lastIndexOf('/'))
    const req = (id) => {
      if (id === 'wx-server-sdk') return cloudStub
      if (id.startsWith('./') || id.startsWith('../')) {
        const parts = (dir + '/' + id).split('/')
        const stack = []
        for (const part of parts) {
          if (part === '.' || part === '') continue
          if (part === '..') stack.pop()
          else stack.push(part)
        }
        let resolved = stack.join('/')
        if (!resolved.endsWith('.js')) resolved += '.js'
        return load(resolved)
      }
      throw new Error('unexpected require ' + id)
    }
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', readSrc(rel))(module, module.exports, req)
    return module.exports
  }
  return load
}

const db = makeDb()
const cloudStub = { init() {}, DYNAMIC_CURRENT_ENV: 'env', database: () => db, getWXContext: () => ({ OPENID: 'o1' }) }
const load = makeLoader(cloudStub)
const core = load('miniprogram/cloudfunctions/dispatchMessage/core.js')

const orderProducts = [
  {
    id: 'p1',
    title: '黑马标本·马上有',
    skuLabel: '大号',
    image: 'cloud://a.png',
    count: 1,
    price: 1200,
    craftType: 'wing_art',
    framerName: 'NATURE',
    tags: ['内部标记'],
    memberDiscountEnabled: true
  }
]
const dispatchRes = await core.dispatch(db, {
  eventType: 'custom_production_packing',
  openid: 'o1',
  relatedId: 'ord9',
  vars: { orderNo: 'ORD9', products: orderProducts }
})
eq('dispatch 成功', dispatchRes.success, true)
eq('落库 1 条消息', written.length, 1)
const doc = written[0]
check('消息文档带 products 字段', Array.isArray(doc.products) && doc.products.length === 1)
if (Array.isArray(doc.products) && doc.products[0]) {
  const card = doc.products[0]
  eq('落库卡：名称', card.title, '黑马标本·马上有')
  eq('落库卡：图片', card.image, 'cloud://a.png')
  eq('落库卡：规格', card.skuLabel, '大号')
  for (const key of ['price', 'craftType', 'framerName', 'tags', 'memberDiscountEnabled']) {
    check(`落库卡不含内部字段 ${key}`, !(key in card), JSON.stringify(card))
  }
}
check('正文渲染出商品行（名称+规格）', /黑马标本·马上有（大号）/.test(doc.content), doc.content)
check('正文不再只有订单号', doc.content.split('\n').length >= 3, JSON.stringify(doc.content))

// 没有商品的信不应凭空长出一个空字段
const before = written.length
await core.dispatch(db, {
  eventType: 'support_ticket_received',
  openid: 'o1',
  relatedId: 's1',
  vars: { topicLabel: '养护' }
})
const noGoods = written[written.length - 1]
eq('又写入 1 条', written.length, before + 1)
check('无商品的信不带 products 字段', !('products' in noGoods), JSON.stringify(Object.keys(noGoods)))

/* ------------------------------------------------------------------ *
 * 3) 模板：客户侧订单/礼赠/制作类信件都必须带商品行
 * ------------------------------------------------------------------ */

const templates = load('miniprogram/cloudfunctions/dispatchMessage/templates.js').DEFAULT_TEMPLATES
const mustHaveLine = [
  'order_created',
  'order_received',
  'order_cancelled',
  'order_refunded',
  'gift_paid',
  'gift_awaiting_address',
  'gift_accepted',
  'gift_address_submitted',
  'gift_nudge',
  'gift_delivered',
  'custom_production_framing',
  'custom_production_packing',
  'custom_production_shipped'
]
mustHaveLine.forEach((code) => {
  const t = templates[code]
  check(`模板 ${code} 存在`, !!t)
  if (t) check(`模板 ${code} 含 {{productLine}}`, /\{\{productLine\}\}/.test(t.contentTemplate || ''), t.contentTemplate)
})

/* ------------------------------------------------------------------ *
 * 4) getUserMessages：商品卡透传与合并（真实源码切片执行）
 * ------------------------------------------------------------------ */

const umSrc = readSrc('miniprogram/cloudfunctions/getUserMessages/index.js')
{
  // 取出真实的 normalizeProducts 函数体（按大括号配对切片），直接执行
  const start = umSrc.indexOf('function normalizeProducts')
  check('getUserMessages 内含 normalizeProducts', start > -1)
  if (start > -1) {
    let depth = 0
    let end = -1
    for (let i = umSrc.indexOf('{', start); i < umSrc.length; i += 1) {
      if (umSrc[i] === '{') depth += 1
      else if (umSrc[i] === '}') {
        depth -= 1
        if (depth === 0) { end = i + 1; break }
      }
    }
    const body = umSrc.slice(start, end)
    // eslint-disable-next-line no-new-func
    const normalizeProducts = new Function(`${body}; return normalizeProducts`)()
    const out = normalizeProducts([
      { title: 'a', image: 'cloud://x', skuLabel: '大号', count: 2, price: 999 },
      { title: '', image: '' },
      { title: 'b', image: '', skuLabel: '', count: 0 }
    ])
    eq('normalizeProducts 丢掉空条目', out.length, 2)
    check('normalizeProducts 不保留 price', !('price' in out[0]))
    eq('normalizeProducts count 兜底为 1', out[1].count, 1)
    eq('normalizeProducts 缺名回落', out[1].title, 'b')
    eq('非数组输入返回空数组', normalizeProducts(null).length, 0)
    eq('超 5 项截断', normalizeProducts(Array.from({ length: 9 }, (_, i) => ({ title: 't' + i }))).length, 5)
  }
}

// mergePair：日志行（无 products）不得抹掉 user_messages 行的卡片
{
  const start = umSrc.indexOf('function mergePair')
  check('getUserMessages 内含 mergePair', start > -1)
  if (start > -1) {
    let depth = 0
    let end = -1
    for (let i = umSrc.indexOf('{', start); i < umSrc.length; i += 1) {
      if (umSrc[i] === '{') depth += 1
      else if (umSrc[i] === '}') {
        depth -= 1
        if (depth === 0) { end = i + 1; break }
      }
    }
    const body = umSrc.slice(start, end)
    // eslint-disable-next-line no-new-func
    const mergePair = new Function(
      'resolveMessageQueue',
      `${body}; return mergePair`
    )(() => 'customer')
    const userRow = { _id: 'u1', _source: 'user_messages', products: [{ title: '有卡' }], read: false }
    const logRow = { _id: 'l1', _source: 'notification_logs', products: [], read: true }
    const a = mergePair(userRow, logRow)
    eq('日志行在前也保住卡片', (a.products || []).length, 1)
    const b = mergePair(logRow, userRow)
    eq('日志行在后也保住卡片', (b.products || []).length, 1)

    // 真正的风险场景：两条**同为 user_messages** 的同键行（新旧格式并存）。
    // 旧行经 normalizeMessage 后 products 是**存在的空数组**，展开时会覆盖掉新行的卡片。
    const legacyRow = { _id: 'u0', _source: 'user_messages', products: [], read: false }
    const richRow = { _id: 'u2', _source: 'user_messages', products: [{ title: '有卡' }], read: false }
    eq('两条 user_messages：新行在后仍保住卡片', (mergePair(legacyRow, richRow).products || []).length, 1)
    eq('两条 user_messages：新行在前也保住卡片', (mergePair(richRow, legacyRow).products || []).length, 1)
  }
}

/* ------------------------------------------------------------------ */

if (process.argv.includes('--selftest') && !INJECT) {
  const { spawnSync } = await import('node:child_process')
  let bad = 0
  for (const name of Object.keys(INJECTIONS)) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, MSG_PRODUCTS_INJECT: name },
      encoding: 'utf8'
    })
    if (run.status !== 0) {
      console.log(`  ✓ 注入 ${name} 被检出`)
    } else {
      bad += 1
      console.error(`  ✗ 注入 ${name} 未被检出（断言不会失败 = 守卫无效）`)
    }
  }
  const clean = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
  if (clean.status !== 0) {
    bad += 1
    console.error('  ✗ 未注入时本应通过，实际失败：')
    console.error(clean.stdout || clean.stderr)
  } else {
    console.log('  ✓ 未注入时通过（无假阳性）')
  }
  if (bad) {
    console.error(`\n✗ selftest 失败 ${bad} 项`)
    process.exit(1)
  }
  console.log(`\n✓ selftest 通过：${Object.keys(INJECTIONS).length} 个回归注入全部被检出，且无假阳性`)
  process.exit(0)
}

console.log(`\n需求 10 行为断言：通过 ${passed} / ${passed + failed}`)
if (failed) {
  failures.forEach((f) => console.error('  ✗ ' + f))
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ 需求 10 全链路断言通过（名称+图片+规格粒度 / 内部字段不外泄 / 模板商品行 / 合并不丢卡）')
