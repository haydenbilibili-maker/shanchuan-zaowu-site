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
import { renderWxml } from './lib/wxml-preview.mjs'

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
  },
  // 读管道白名单漏 photos（P0-1 的原样回归：写库有图，顾客侧永远看不到）
  'drop-photos-whitelist': {
    file: 'miniprogram/cloudfunctions/getUserMessages/index.js',
    from: 'photos: normalizePhotos(doc.photos),',
    to: ''
  },
  // 合并时让日志行 / 旧格式行覆盖 → 包装实拍被抹成空数组
  'merge-overwrites-photos': {
    file: 'miniprogram/cloudfunctions/getUserMessages/index.js',
    from: 'photos: (primary.photos && primary.photos.length) ? primary.photos : (secondary.photos || []),',
    to: 'photos: primary.photos || [],'
  },
  // 日报读侧漏 failed（P1-3 的原样回归：取数失败被显示成「当日无数据」）
  'drop-digest-failed-whitelist': {
    file: 'miniprogram/cloudfunctions/getUserMessages/index.js',
    from: 'failed: Array.isArray(raw.failed)',
    to: 'failed: false && Array.isArray(raw.failed)'
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

/* ------------------------------------------------------------------ *
 * 5) photos 读管道（P0-1）：真跑 getUserMessages 入口（桩 sdk）→ 真 enrichMessage → 真渲染
 *
 * ⚠️ 为什么必须走**真实读路径**（而不是像 check-package-photos.mjs:365 那样手工把
 *    photos 喂给 enrichMessage）：手工喂字段**绕过了 normalizeMessage 的白名单**，
 *    白名单漏 photos 时守卫照样绿 —— 这正是 P0-1「顾客侧整个功能是死的、守卫全绿」
 *    的成因（错题本第一族：守卫测层不测链路）。这里喂进去的是**库里的原始文档**，
 *    出来的是**云函数回包里的消息对象**，再交给真 enrichMessage / 真 WXML 渲染。
 * ------------------------------------------------------------------ */

const READ_PHOTO_A = 'cloud://test-env.aaa/ship/pack-1.jpg'
const READ_PHOTO_B = 'cloud://test-env.aaa/ship/pack-2.jpg'
const DETAIL_WXML_REL = 'miniprogram/subpackages/extra/user/messages/detail/index.wxml'

/** 桩 db：记录每个集合要返回的原始文档；链式 API 只回自身，`get()` 才吐数据 */
function makeReadDb(rowsByCollection) {
  return {
    command: {
      or: (v) => ({ $or: v }),
      and: (v) => ({ $and: v }),
      in: (v) => ({ $in: v })
    },
    collection(name) {
      const chain = {
        where() { return chain },
        orderBy() { return chain },
        limit() { return chain },
        doc() { return chain },
        async get() { return { data: (rowsByCollection[name] || []).slice() } }
      }
      return chain
    }
  }
}

/** 真跑读管道：真 getUserMessages 入口（桩 wx-server-sdk）→ 回包里的**消息对象** */
async function runReadPipeline(rowsByCollection, opts = {}) {
  const readDb = makeReadDb(rowsByCollection)
  const cloudStub = {
    init() {},
    DYNAMIC_CURRENT_ENV: 'env',
    database: () => readDb,
    getWXContext: () => ({ OPENID: opts.openid || 'o1' })
  }
  const loadRead = makeLoader(cloudStub)
  const fn = loadRead('miniprogram/cloudfunctions/getUserMessages/index.js')
  check('getUserMessages 导出 main（真实现，不是切片）', typeof fn.main === 'function')
  return fn.main({ action: 'getMessages', pageSize: 20, ...(opts.event || {}) })
}

const photoRow = {
  _id: 'um-photos-1',
  _openid: 'o1',
  type: 'order_shipped',
  category: 'order',
  title: '标本已启程',
  content: '这件标本已启程。',
  relatedId: 'ord-photos-1',
  read: false,
  createTime: '2026-09-21T10:00:00.000Z',
  photos: [READ_PHOTO_A, READ_PHOTO_B]
}
// 同一次发货的 notification_logs 镜像行：永远没有 photos（合并逻辑的另一个坑）
const photoLogRow = {
  _id: 'nl-photos-1',
  recipient: 'o1',
  channel: 'inapp',
  category: 'order',
  type: 'order_shipped',
  title: '标本已启程',
  content: '这件标本已启程。',
  relatedId: 'ord-photos-1',
  read: true,
  sentAt: '2026-09-21T10:00:00.000Z'
}
// 新旧格式并存的**同键** user_messages 行：旧行归一化后 photos 是空数组
const photoLegacyRow = {
  _id: 'um-photos-legacy',
  _openid: 'o1',
  type: 'order_shipped',
  category: 'order',
  title: '标本已启程',
  content: '这件标本已启程。',
  relatedId: 'ord-photos-1',
  read: false,
  createTime: '2026-09-20T10:00:00.000Z',
  photos: []
}

{
  const detailWxml = readFileSync(resolve(ROOT, DETAIL_WXML_REL), 'utf8')

  const res = await runReadPipeline({ user_messages: [photoRow], notification_logs: [photoLogRow] })
  check('读管道回包 success', res && res.success === true, JSON.stringify(res && res.msg))
  const got = res && res.messages && res.messages[0]
  check('读管道回包里有 1 条消息', !!got)
  // ★ 核心断言：写入侧写了 photos，读侧白名单若不透传 → 这里必然 undefined
  check('读管道回包保留 photos（写入侧写了、读侧不许丢）',
    Array.isArray(got && got.photos) && got.photos.length === 2, JSON.stringify(got && got.photos))

  // 真 enrichMessage → 真渲染 detail/index.wxml（端到端「顾客能不能看到」）
  const letter = helper.enrichMessage(got)
  eq('端到端：hasPackagePhotos = true', letter.hasPackagePhotos, true)
  eq('端到端：包装实拍 2 张', letter.packagePhotos.length, 2)
  const rendered = renderWxml(detailWxml, {
    selectedMessage: letter,
    scrollStyle: '',
    entered: true,
    loadError: false,
    digestView: null,
    digestPayloadMissing: false,
    actionPadStyle: ''
  })
  check('真渲染：出现「包装实拍」区块', rendered.includes('包装实拍'))
  check('真渲染：https 地址已就位', rendered.includes('https://'))
  check('真渲染：渲染态里没有 cloud:// 残留（真机空白图的根因）', !rendered.includes('cloud://'))
  eq('真渲染：出现 2 个包装图元素', (rendered.match(/class="photos-item"/g) || []).length, 2)

  // 合并两条同键 user_messages（新旧格式并存）：富行在前 / 在后都不许丢图
  const resRichFirst = await runReadPipeline({ user_messages: [photoRow, photoLegacyRow], notification_logs: [] })
  eq('两条 user_messages：富行在前仍保住 photos', helper.enrichMessage(resRichFirst.messages[0]).hasPackagePhotos, true)
  const resLegacyFirst = await runReadPipeline({ user_messages: [photoLegacyRow, photoRow], notification_logs: [] })
  eq('两条 user_messages：富行在后仍保住 photos', helper.enrichMessage(resLegacyFirst.messages[0]).hasPackagePhotos, true)

  // 存量消息：没有 photos 键 → 与「没传图」一致，不凭空造图
  const resNoPhoto = await runReadPipeline({
    user_messages: [{ ...photoRow, _id: 'um-nophoto', photos: undefined }],
    notification_logs: []
  })
  eq('存量消息（无该键）→ hasPackagePhotos = false', helper.enrichMessage(resNoPhoto.messages[0]).hasPackagePhotos, false)
}

/* 5b) 日报读侧 failed（P1-3）：写侧 dailyDigest 已分档，读侧不许再并回「当日无数据」 */
const digestViewMod = (() => {
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', readSrc('miniprogram/subpackages/extra/utils/digestView.js'))(module, module.exports)
  return module.exports
})()

const digestRow = {
  _id: 'um-digest-1',
  _openid: 'o1',
  type: 'daily_digest',
  category: 'digest',
  queue: 'workflow',
  title: '2026-09-21 日报',
  content: '2026-09-21 日报',
  read: false,
  createTime: '2026-09-21T01:00:00.000Z',
  payload: {
    v: 1,
    dayKey: '2026-09-21',
    role: 'super_admin',
    roleLabel: '超管',
    generatedAt: '2026-09-21T00:20:00.000Z',
    metrics: [
      { id: 'order_paid_fen', section: 'orders', label: '订单支付金额', unit: 'fen', value: null, source: 'orders.paidTime', caveat: '' },
      { id: 'mini_visitors', section: 'miniapp', label: '小程序访客', unit: 'count', value: null, source: 'analytics_daily.date', caveat: '' }
    ],
    sections: [
      { key: 'orders', label: '订单数据', ids: ['order_paid_fen'] },
      { key: 'miniapp', label: '小程序数据', ids: ['mini_visitors'] }
    ],
    missing: ['mini_visitors'],
    failed: [{ id: 'order_paid_fen', label: '订单支付金额', error: 'aggregate failed' }]
  }
}

{
  // 日报是 workflow 队列 → 用超管 openid + queue:'all' 才取得到（真 staffGuard 会放行白名单）
  const SUPER_OID = 'oa22s5ZcMY7xkQDlNW8X8jaYy46M'
  const res = await runReadPipeline(
    { user_messages: [{ ...digestRow, _openid: SUPER_OID }], notification_logs: [] },
    { openid: SUPER_OID, event: { queue: 'all' } }
  )
  const digestMsg = res && res.messages && res.messages[0]
  check('读管道取到日报消息', !!digestMsg)
  check('读管道回包保留 payload.failed（写侧分档、读侧不许并回无数据）',
    Array.isArray(digestMsg && digestMsg.payload && digestMsg.payload.failed) && digestMsg.payload.failed.length === 1,
    JSON.stringify(digestMsg && digestMsg.payload && digestMsg.payload.failed))
  const view = digestViewMod.buildDigestView(digestMsg)
  check('digestView 非空', !!view)
  if (view) {
    eq('failedCount = 1', view.failedCount, 1)
    eq('missingCount 排除取数失败项', view.missingCount, 1)
    check('failedNote 点明「取数失败、不是 0 也不是当日无数据」',
      /取数失败/.test(view.failedNote) && /不是 0/.test(view.failedNote), view.failedNote)
    check('failedNote 带出失败项名称', view.failedNote.includes('订单支付金额'), view.failedNote)
    const flat = view.sections.reduce((a, s) => a.concat(s.metrics), [])
    const failedMetric = flat.find((m) => m.id === 'order_paid_fen')
    const missingMetric = flat.find((m) => m.id === 'mini_visitors')
    eq('失败项 valueText = 取数失败', failedMetric && failedMetric.valueText, '取数失败')
    eq('失败项不再算 missing', failedMetric && failedMetric.missing, false)
    // 技术原因留在开发侧（failedError 进「复制失败清单」），界面 failedText 只给一句人话
    check('失败项原因进 failedError（复制给技术）', /aggregate failed/.test(failedMetric && failedMetric.failedError), failedMetric && failedMetric.failedError)
    check('失败项界面文案不带技术原因', !!(failedMetric && failedMetric.failedText) && !/aggregate failed|Error|collection/i.test(failedMetric.failedText), failedMetric && failedMetric.failedText)
    eq('真没数据项仍是「未取到」', missingMetric && missingMetric.valueText, '未取到')
    eq('真没数据项 missing = true', missingMetric && missingMetric.missing, true)
    eq('真没数据项不算 failed', missingMetric && missingMetric.failed, false)

    const digestRendered = renderWxml(readFileSync(resolve(ROOT, DETAIL_WXML_REL), 'utf8'), {
      selectedMessage: helper.enrichMessage(digestMsg),
      scrollStyle: '',
      entered: true,
      loadError: false,
      digestView: view,
      digestPayloadMissing: false,
      actionPadStyle: '',
      sectionCollapsed: {},
      showSources: false
    })
    check('真渲染：两档都出现（取数失败 + 未取到）',
      digestRendered.includes('取数失败') && digestRendered.includes('未取到'))
    check('真渲染：渲染态里没有 cloud:// 残留', !digestRendered.includes('cloud://'))
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
