#!/usr/bin/env node
/**
 * B 流细节雕刻守卫（C 端交易与「我的」展示层）—— 产品负责人 2026-10-01「细节雕刻」。
 * 记录：miniprogram/docs/细节雕刻_B流_2026-10.md
 *
 * 只钉**展示层**里改过、且回退了顾客看得见的几件事（不碰契约 / 流程 / 金额）：
 *   B1 订单详情折扣：不得再用 `discountRate * 10` 拼「N折」（0.7×10 = 7.000000000000001），
 *      须用 js 里 formatDiscount 产出的 `order.discountText`；
 *   B2 订单详情账单区：用到的每个类名都必须在本页 wxss 里有定义
 *      （「已付定金抵扣」曾用了不存在的 `price-row` → 标签与金额挤成一团）；
 *   B3 支付防重入：订单列表 / 详情的 handlePay 在调 payForOrder 之前判「进行中」直接返回，
 *      并在 finally 里复位（否则一次失败后按钮永远卡在「支付中…」）；
 *   B4 失败提示不透原文：范围内页面的 toast / 失败副标题不得直接拼 `err.errMsg` / `err.message`
 *      （`navigateTo:fail …`、`cloud.callFunction:fail …` 会原样给到顾客）；
 *   B5 礼券门槛：购物车 / 确认下单弹层不得出现「满 0 可用」形态（无门槛券须写「无门槛」）；
 *   B6 订单列表卡片：不得用占位英文 `Specimen` 冒充学名（错题本 E11），缩略图缺图须有占位分支。
 *   ── 第 2 轮（「我的」子页）──
 *   B7 预约票：人数不得写死前导 0（`0{{bookCount}}` 在 10 人时成「010 人」），持票人缺省不写英文 Guest；
 *   B8 荣誉档案：加载中不显示「共收藏 0 件」，入场动画延迟有上限（证书多时最后一张要等数秒才出现）；
 *   B9 收货地址：默认地址卡不再出现「设为默认」，保存按钮有「保存中…」；
 *   B10 礼赠填址：提交中按钮文案切换（防「点了没反应」再点）。
 *   ── 第 3 轮（凭证 / 订单详情底栏 / 账户提交）──
 *   B11 预约票据：数据回来前不显示「该预约已不可核销」（须有加载分支），字段标签带中文；
 *   B12 订单详情底栏：每一枚按钮 / 状态标签都挂 app.wxss 的 tap-press(-soft)（此前只靠 `:active`，真机 view 上不可靠）；
 *   B13 反馈 / 注册完成按钮有按压反馈（提交中不挂）。
 *   ── 产品负责人点名（2026-10-01）──
 *   B14 荣誉档案：对 orders 的每一处查询都经 `fetchAllPages` 分批取完（skip + limit 循环），
 *      不得裸 `.get()` —— 小程序端单次最多 20 条，签收 >20 件的藏家会静默少证书。
 *   B15 订单详情底栏改版（产品负责人 2026-10-01 真机截图点名）：
 *      ① `.hologram-btn` 基础规则不得写 `flex: 1`（底栏是纵向 flex，flex-basis:0 + overflow:hidden 把按钮压成一条细边）；
 *      ② 礼赠档案排在物流 / 自取卡之后、订单清单之前；③ 已评完不再占大按钮（状态标签）；
 *      ④ 次级行可换行、`.btn-text` 不再 `flex: 0 0 auto` 靠左挤；⑤ 底栏安全区同时写 constant() 与 env()。
 *   B16 评价页（产品负责人 2026-10-01 真机截图点名：已评价订单仍是「写下感受」+ 三处返回 + 状态说不清）：
 *      ① 页内无自定义标题栏 / 返回箭头 / 「返回订单」按钮，返回只剩微信导航一处；
 *      ② index.json 标题不是「发表评价」（已评价订单会先闪撰写态），页内按态设「我的评价 / 发表评价」；
 *      ③ 已评价走「我的评价」查看态：buildViewReview 只认服务端 reviewStatus，pending→审核中、approved→已展示
 *         （可去藏品页）、hidden→未展示（不给重评入口）、可评价 / 无记录→null（撰写态 / 资格提示）—— 真跑页内纯函数；
 *      ④ submitComment.orderStatus 只**新增** myReview（本人评价快照，不带 openid 等身份字段），原有键不变；
 *         同单同藏品多条时按毫秒取最新（updatedAt 审核后是数字、创建时是 Date，不能按字符串比）；
 *      ⑤ 查看态可点元素挂 tap-press(-soft)，说明字至少 secondary。
 *   ── 产品负责人点名流程改动（2026-10-01 晚）──
 *   B17 评价检测明确通过即自动展示（**真跑 submitComment 真源**，桩 openapi + 内存库）：
 *      文本 suggest=pass 且每张图 imgSecCheck errCode=0 → 写 approved；suggest=review / 无 suggest / 报错 / 无 errCode /
 *      超限 → pending；违规文字或图片 → 拒绝且零写入；被隐藏过的评价改写后不自动展示；评价页「审核中」与提交提示按新流程。
 *   B18 订单页区分「审核中 / 已评价」：orderReviewMap 真跑（任意单数只查 2 次库、只回本人订单、hidden 算评完、
 *      审核中单列）；列表 reviewFlags 真跑（评完 / 审核中 / 未回来都不给「写下感受」）且按批调用；
 *      订单详情底栏标签按 reviewChipPending 显示「审核中」/「✓ 已评价」。
 *
 * 自检不写盘：注入在内存副本上做（共享工作区有并行流，写盘注入会覆盖别人的在写内容）。
 *
 * 用法：
 *   node miniprogram/scripts/check-bflow-polish.mjs
 *   node miniprogram/scripts/check-bflow-polish.mjs --selftest
 */
import { readFileSync } from 'node:fs'
import Module from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const B = 'miniprogram/subpackages/business'

const F = {
  odWxml: `${B}/order-detail/index.wxml`,
  odWxss: `${B}/order-detail/index.wxss`,
  odJs: `${B}/order-detail/index.js`,
  ordersWxml: `${B}/orders/index.wxml`,
  ordersJs: `${B}/orders/index.js`,
  cartWxml: 'miniprogram/pages/cart/index.wxml',
  confirmWxml: `${B}/confirm-order/index.wxml`,
  bookingWxml: `${B}/booking/index.wxml`,
  certWxml: 'miniprogram/subpackages/extra/user/certificates/index.wxml',
  addrWxml: `${B}/address/index.wxml`,
  giftAddrWxml: 'miniprogram/subpackages/feature/gift/address/index.wxml',
  ticketWxml: `${B}/ticket/index.wxml`,
  ticketJs: `${B}/ticket/index.js`,
  feedbackWxml: 'miniprogram/subpackages/extra/user/feedback/index.wxml',
  onboardingWxml: 'miniprogram/subpackages/extra/user/onboarding/index.wxml',
  certJs: 'miniprogram/subpackages/extra/user/certificates/index.js',
  appWxss: 'miniprogram/app.wxss',
  cmWxml: 'miniprogram/subpackages/content/comment/index.wxml',
  cmWxss: 'miniprogram/subpackages/content/comment/index.wxss',
  cmJs: 'miniprogram/subpackages/content/comment/index.js',
  cmJson: 'miniprogram/subpackages/content/comment/index.json',
  cmFn: 'miniprogram/cloudfunctions/submitComment/index.js'
}

/** B4 扫描范围（逐轮扩充；只加不减） */
const NO_RAW_ERROR_FILES = [
  F.ordersJs,
  F.odJs,
  `${B}/aftersale-apply/index.js`,
  `${B}/order-claim/index.js`,
  `${B}/logistics-track/index.js`,
  'miniprogram/pages/cart/index.js',
  `${B}/confirm-order/index.js`,
  F.ticketJs
]

const read = (f) => readFileSync(resolve(ROOT, f), 'utf8')
const stripJsComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

/** 取 Page 方法体：从 `  name(` / `  async name(` 到下一个同缩进方法头（语法边界 —— 错题本 E7） */
function methodBody(src, name) {
  const re = new RegExp(`\\n  (?:async )?${name}\\s*\\([^)]*\\)\\s*\\{`)
  const m = re.exec(src)
  if (!m) return ''
  const rest = src.slice(m.index + m[0].length)
  const next = /\n  (?:async )?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/.exec(rest)
  return next ? rest.slice(0, next.index) : rest
}

/** 取 wxml 里以 `class="<cls> …"` 开头的那个 view 块（按 <view>/</view> 配平） */
function viewBlock(wxml, cls) {
  const start = wxml.search(new RegExp(`<view[^>]*class="${cls}[\\s"]`))
  if (start < 0) return ''
  const re = /<view\b|<\/view>/g
  re.lastIndex = start
  let depth = 0
  let m
  while ((m = re.exec(wxml))) {
    depth += m[0] === '</view>' ? -1 : 1
    if (depth === 0) return wxml.slice(start, m.index + m[0].length)
  }
  return wxml.slice(start)
}

/** 静态类名（去掉 {{…}} 表达式后剩下的 token） */
function staticClasses(block) {
  const out = new Set()
  for (const m of block.matchAll(/class="([^"]*)"/g)) {
    for (const t of m[1].replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/)) if (t) out.add(t)
  }
  return out
}

function definedClasses(css) {
  const out = new Set()
  for (const m of stripCssComments(css).matchAll(/\.([A-Za-z_][\w-]*)/g)) out.add(m[1])
  return out
}

/* ── submitComment 真源的运行桩：wx-server-sdk 换成内存实现（openapi / downloadFile / 数据库），不联网不写盘 ── */
const S = { text: null, images: {}, writes: [], orders: {}, comments: [], gets: 0 }
const matchQ = (row, q) => Object.entries(q).every(([k, v]) => {
  if (v && typeof v === 'object' && '$neq' in v) return row[k] !== v.$neq
  if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(row[k])
  return row[k] === v
})
const STUB_DB = {
  command: { neq: (v) => ({ $neq: v }), in: (v) => ({ $in: v }) },
  collection: (name) => ({
    doc: (id) => ({
      get: async () => { S.gets += 1; return { data: name === 'orders' ? S.orders[id] : S.comments.find((c) => c._id === id) } },
      update: async ({ data }) => { S.writes.push({ op: 'update', name, id, data }); return {} }
    }),
    add: async ({ data }) => { S.writes.push({ op: 'add', name, data }); return { _id: 'new-comment' } },
    where: (q) => {
      const chain = {
        field: () => chain,
        limit: () => chain,
        get: async () => { S.gets += 1; return { data: (name === 'orders' ? Object.values(S.orders) : S.comments).filter((r) => matchQ(r, q)) } }
      }
      return chain
    }
  })
}
const STUB_SDK = {
  DYNAMIC_CURRENT_ENV: 'stub',
  init() {},
  getWXContext: () => ({ OPENID: 'U' }),
  database: () => STUB_DB,
  callFunction: async () => ({}),
  downloadFile: async ({ fileID }) => ({ fileContent: (S.images[fileID] || {}).big ? Buffer.alloc(1024 * 1024 + 1) : Buffer.from(fileID) }),
  openapi: {
    security: {
      msgSecCheck: async () => { if (S.text.throw) throw S.text.throw; return S.text.res },
      imgSecCheck: async ({ media }) => { const r = S.images[media.value.toString()] || {}; if (r.throw) throw r.throw; return r.res }
    }
  }
}
let sdkHooked = false
function loadCloudFn(src) {
  if (!sdkHooked) {
    const orig = Module._load
    Module._load = function (req, ...rest) { return req === 'wx-server-sdk' ? STUB_SDK : orig.call(this, req, ...rest) }
    sdkHooked = true
  }
  const filename = resolve(ROOT, F.cmFn)
  const m = new Module(filename)
  m.filename = filename
  m.paths = Module._nodeModulePaths(dirname(filename))
  m._compile(src, filename)
  return m.exports
}

const TXT = {
  pass: { res: { errCode: 0, result: { suggest: 'pass' } } },
  review: { res: { errCode: 0, result: { suggest: 'review' } } },
  unknown: { res: { errCode: 0 } },
  risky: { throw: Object.assign(new Error('risky'), { errCode: 87014 }) },
  error: { throw: new Error('system busy') }
}
const IMG = {
  ok: { res: { errCode: 0 } },
  nocode: { res: {} },
  error: { throw: new Error('system busy') },
  risky: { res: { errCode: 87014 } },
  big: { big: true }
}

async function submitCase(fn, text, imgs, extra = {}) {
  S.text = TXT[text]
  S.images = {}
  const images = imgs.map((k, i) => { const id = `cloud://img-${i}-${k}`; S.images[id] = IMG[k]; return id })
  S.writes = []
  S.orders = { o1: { _id: 'o1', _openid: 'U', status: 'received', products: [{ id: 'p1', title: '自然小匣' }] } }
  S.comments = extra.comments || []
  const event = extra.event || { action: 'submit', targetType: 'product', orderId: 'o1', targetId: 'p1', rating: 5, content: '五个字以上的感受', images }
  let r
  try { r = await fn.main(event) } catch (e) { r = { thrown: String(e && e.message) } }
  return { r, writes: S.writes.slice() }
}

async function checkModeration(src, check) {
  let fn = null
  try { fn = loadCloudFn(src[F.cmFn]) } catch { /* 编译失败按缺失 */ }
  check('B17.fn-loads', !!fn && typeof fn.main === 'function', 'submitComment 真源无法在桩环境加载')
  if (!fn) return
  const written = (c) => (c.writes[0] && c.writes[0].data && c.writes[0].data.status) || ''
  const expectStatus = async (id, text, imgs, want, why) => {
    const c = await submitCase(fn, text, imgs)
    check(id, !!c.r && c.r.success === true && c.r.status === want && written(c) === want && c.writes.length === 1,
      `${why}：期望 ${want}，出参 ${JSON.stringify(c.r)}，写入 ${written(c) || '（无）'}`)
  }
  const expectReject = async (id, text, imgs, why) => {
    const c = await submitCase(fn, text, imgs)
    check(id, !!c.r && c.r.success === false && c.writes.length === 0, `${why}：出参 ${JSON.stringify(c.r)}，写入 ${c.writes.length} 次`)
  }
  await expectStatus('B17.pass-auto-approved', 'pass', ['ok'], 'approved', '文字 pass + 图片 errCode 0 未自动展示')
  await expectStatus('B17.pass-no-image', 'pass', [], 'approved', '文字 pass 无图未自动展示')
  await expectStatus('B17.text-review-pending', 'review', ['ok'], 'pending', '文字 suggest=review（检测不通过）被自动展示')
  await expectStatus('B17.text-unknown-pending', 'unknown', [], 'pending', '文字无 suggest（结果不确定）被自动展示')
  await expectStatus('B17.text-error-pending', 'error', [], 'pending', '文字检测报错被自动展示')
  await expectStatus('B17.img-nocode-pending', 'pass', ['nocode'], 'pending', '图片无 errCode（结果不确定）被自动展示')
  await expectStatus('B17.img-error-pending', 'pass', ['error'], 'pending', '图片检测报错被自动展示')
  await expectStatus('B17.img-big-pending', 'pass', ['big'], 'pending', '图片超同步接口上限被自动展示')
  await expectStatus('B17.img-mixed-pending', 'pass', ['ok', 'error'], 'pending', '多图中一张报错仍被自动展示')
  await expectReject('B17.text-risky-rejected', 'risky', [], '违规文字未拒绝或写了库')
  await expectReject('B17.img-risky-rejected', 'pass', ['ok', 'risky'], '违规图片未拒绝或写了库')
  const hiddenEdit = await submitCase(fn, 'pass', [], {
    comments: [{ _id: 'g1', targetType: 'activity', targetId: 'a1', userId: 'U', status: 'hidden' }],
    event: { action: 'submit', targetType: 'activity', targetId: 'a1', rating: 5, content: '五个字以上的感受', images: [] }
  })
  check('B17.hidden-edit-pending', hiddenEdit.r && hiddenEdit.r.status === 'pending' && written(hiddenEdit) === 'pending', '被隐藏过的评价改写后被自动重新展示')
  const okCase = await submitCase(fn, 'pass', [])
  check('B17.result-keys', okCase.r && ['success', 'msg', 'commentId', 'status'].every((k) => k in okCase.r), `提交出参键变了：${JSON.stringify(okCase.r)}`)

  // B18 orderReviewMap
  const prod = (id) => ({ id, title: id })
  S.orders = {
    oNone: { _id: 'oNone', _openid: 'U', status: 'received', products: [prod('p1')] },
    oPend: { _id: 'oPend', _openid: 'U', status: 'received', products: [prod('p1')] },
    oAppr: { _id: 'oAppr', _openid: 'U', status: 'received', products: [prod('p1')] },
    oHide: { _id: 'oHide', _openid: 'U', status: 'received', products: [prod('p1')] },
    oPart: { _id: 'oPart', _openid: 'U', status: 'received', products: [prod('p1'), prod('p2')] },
    oMix: { _id: 'oMix', _openid: 'U', status: 'received', products: [prod('p1'), prod('p2')] },
    oGift: { _id: 'oGift', _openid: 'X', giftMeta: { receiverOpenid: 'U' }, status: 'received', products: [prod('p1')] },
    oOther: { _id: 'oOther', _openid: 'X', status: 'received', products: [prod('p1')] },
    oVoucher: { _id: 'oVoucher', _openid: 'U', status: 'received', products: [{ id: 'v1', price: '100 PTS' }] },
    oShip: { _id: 'oShip', _openid: 'U', status: 'shipped', products: [prod('p1')] }
  }
  const cm = (orderId, targetId, status, userId = 'U') => ({ _id: `${orderId}-${targetId}`, orderId, targetId, status, userId, targetType: 'product' })
  S.comments = [cm('oPend', 'p1', 'pending'), cm('oAppr', 'p1', 'approved'), cm('oHide', 'p1', 'hidden'), cm('oPart', 'p1', 'approved'),
    cm('oMix', 'p1', 'approved'), cm('oMix', 'p2', 'pending'), cm('oGift', 'p1', 'approved'), cm('oOther', 'p1', 'approved', 'X')]
  S.gets = 0
  let mapRes = null
  try { mapRes = await fn.main({ action: 'orderReviewMap', orderIds: Object.keys(S.orders) }) } catch { /* 按失败 */ }
  const st = (id) => mapRes && mapRes.map && mapRes.map[id] ? mapRes.map[id].reviewState : undefined
  const want = { oNone: 'none', oPend: 'pending', oAppr: 'done', oHide: 'done', oPart: 'partial', oMix: 'pending', oGift: 'done', oVoucher: 'na', oShip: 'na' }
  const wrong = Object.entries(want).filter(([id, s]) => st(id) !== s).map(([id, s]) => `${id}=${st(id)}（应 ${s}）`)
  check('B18.map-states', !!mapRes && mapRes.success === true && wrong.length === 0, `orderReviewMap 状态不对：${wrong.join(', ') || JSON.stringify(mapRes)}`)
  check('B18.map-only-mine', !!mapRes && st('oOther') === undefined, 'orderReviewMap 回了别人的订单')
  check('B18.map-two-queries', S.gets === 2, `orderReviewMap 查了 ${S.gets} 次库（应为 2 次批量，不随单数增长）`)
}

export async function runChecks(src) {
  const fails = []
  let pass = 0
  const check = (id, ok, detail) => {
    if (ok) pass += 1
    else fails.push(`${id}${detail ? ` —— ${detail}` : ''}`)
  }

  // B1
  check('B1.no-float-discount', !/discountRate\s*\*\s*10/.test(src[F.odWxml]), '订单详情 wxml 仍用 discountRate * 10 拼折扣')
  check('B1.uses-discountText', /order\.discountText/.test(src[F.odWxml]), '订单详情 wxml 未使用 order.discountText')
  check('B1.js-formatDiscount', /discountText:\s*formatDiscount\(/.test(stripJsComments(src[F.odJs])), '订单详情 js 未用 formatDiscount 产出 discountText')

  // B2
  const finance = viewBlock(src[F.odWxml], 'finance-section')
  check('B2.finance-block-found', !!finance, '找不到 finance-section 块')
  const defined = definedClasses(src[F.odWxss])
  const missing = [...staticClasses(finance)].filter((c) => !defined.has(c))
  check('B2.finance-classes-defined', missing.length === 0, `账单区类名在 wxss 中无定义：${missing.join(', ')}`)

  // B3
  for (const [tag, file, flag, reset] of [
    ['orders', F.ordersJs, /if\s*\(\s*this\.data\.payingId\s*\)\s*return/, /finally\s*\{[^}]*payingId:\s*''/],
    ['detail', F.odJs, /if\s*\(\s*this\.data\.paying\s*\)\s*return/, /finally\s*\{[^}]*paying:\s*false/]
  ]) {
    const body = stripJsComments(methodBody(src[file], 'handlePay'))
    const guardAt = body.search(flag)
    const payAt = body.indexOf('payForOrder(')
    check(`B3.${tag}-guard-before-pay`, guardAt >= 0 && payAt > guardAt, 'handlePay 调 payForOrder 前没有「进行中即返回」')
    check(`B3.${tag}-finally-reset`, reset.test(body), 'handlePay 没有在 finally 里复位进行中状态')
  }

  // B4
  const RAW = /(?:title|content)\s*:\s*[^\n,]*\b(?:err|e|error)\s*(?:&&\s*(?:err|e|error)\.\w+\s*)?\.(?:errMsg|message)|_fail\([^)]*\b(?:err|e|error)\.(?:errMsg|message)|'[^']*'\s*\+\s*\(?\s*(?:err|e|error)\.(?:errMsg|message)/
  for (const f of NO_RAW_ERROR_FILES) {
    const lines = stripJsComments(src[f]).split('\n')
    const hits = lines.map((l, i) => [i + 1, l]).filter(([, l]) => RAW.test(l))
    check(`B4.${f.split('/').slice(-2, -1)[0]}`, hits.length === 0, hits.map(([n, l]) => `${f}:${n} ${l.trim()}`).join(' | '))
  }

  // B5
  for (const [tag, file] of [['cart', F.cartWxml], ['confirm', F.confirmWxml]]) {
    const w = src[file]
    check(`B5.${tag}-no-bare-minspend`, !/满\s*\{\{\s*item\.minSpend\s*\}\}\s*可用/.test(w), '礼券门槛直接插值 minSpend（会出现「满 0 可用」）')
    check(`B5.${tag}-no-threshold-label`, /无门槛/.test(w), '礼券弹层缺「无门槛」分支')
  }

  // B6
  const ow = src[F.ordersWxml]
  check('B6.no-specimen-placeholder', !/'Specimen'/.test(ow), "订单卡用 'Specimen' 冒充学名")
  check('B6.thumb-placeholder', /prod-img-ph/.test(ow) && /wx:if="\{\{prod\.image\}\}"/.test(ow), '订单卡缩略图缺图无占位分支')

  // B7
  const bw = src[F.bookingWxml]
  check('B7.no-hardcoded-leading-zero', !/>0\{\{\s*bookCount\s*\}\}/.test(bw), '预约票人数写死前导 0')
  check('B7.no-guest-fallback', !/'Guest'/.test(bw), "预约票持票人缺省为英文 'Guest'")

  // B8
  const cw = src[F.certWxml]
  check('B8.loading-header', /<text class="h2" wx:if="\{\{loading\}\}">/.test(cw), '荣誉档案加载中仍显示收藏件数')
  const delay = (cw.match(/animation-delay:\s*\{\{([^}]*)\}\}/) || [])[1] || ''
  check('B8.stagger-capped', !!delay && /index\s*</.test(delay), `入场延迟无上限：${delay || '（未找到）'}`)

  // B9
  const aw = src[F.addrWxml]
  check('B9.default-hides-set-default', /wx:if="\{\{!item\.isDefault\}\}"[^>]*catchtap="setDefault"/.test(aw), '默认地址卡仍显示「设为默认」')
  check('B9.saving-label', /saving \? '保存中…'/.test(aw), '保存地址按钮无进行中文案')

  // B10
  check('B10.gift-addr-submitting-label', /submitting \? '正在记下…'/.test(src[F.giftAddrWxml]), '礼赠填址提交按钮无进行中文案')

  // B11
  const tw = src[F.ticketWxml]
  const loadIdx = tw.indexOf('wx:elif="{{!booking._id}}"')
  const voidIdx = tw.indexOf('该预约已不可核销')
  check('B11.ticket-loading-branch', loadIdx > 0 && loadIdx < voidIdx, '票据加载中会先闪「该预约已不可核销」')
  check('B11.ticket-zh-labels', !/<text class="label">(PROJECT|DATE|GUEST)<\/text>/.test(tw), '票据字段标签仍为纯英文')

  // B12
  const odw = src[F.odWxml]
  const foot = odw.slice(odw.indexOf('<view class="action-footer'))
  const css = stripCssComments(src[F.odWxss])
  const tags = foot.match(/<(?:view|button)\s+class="(?:btn-text|btn-main|hologram-btn|btn-gift-\w+|od-status-chip)\b[^>]*>/g) || []
  const bare = tags.filter((t) => !/hover-class="[^"]*tap-press/.test(t))
  check('B12.footer-hover', tags.length > 0 && bare.length === 0, `订单详情底栏 ${bare.length} 枚按钮未挂 tap-press：${bare.map((t) => t.slice(0, 48)).join(' | ')}`)
  check('B12.tap-press-defined', /\.tap-press-soft\s*\{/.test(stripCssComments(src[F.appWxss])), 'app.wxss 未定义 .tap-press-soft')

  // B15
  const rule = (sel) => (css.match(new RegExp(`(?:^|})\\s*${sel.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`)) || [])[1] || ''
  check('B15.hologram-no-flex1', !!rule('.hologram-btn') && !/(^|;|\s)flex\s*:\s*1\b/.test(rule('.hologram-btn')), '.hologram-btn 基础规则写了 flex: 1（纵向底栏里会被压扁）')
  check('B15.btn-text-not-squeezed', !!rule('.btn-text') && !/flex\s*:\s*0 0 auto/.test(rule('.btn-text')), '.btn-text 仍为 flex: 0 0 auto（次级按钮靠左挤、不铺满）')
  check('B15.btn-group-wrap', /flex-wrap\s*:\s*wrap/.test(rule('.btn-group')), '次级行不换行，按钮多时会溢出')
  const gaAt = odw.indexOf('<view class="gift-archive')
  const shipAt = odw.indexOf('<view class="shipping-label')
  const maniAt = odw.indexOf('<view class="manifest-section')
  check('B15.gift-archive-after-logistics', gaAt > shipAt && gaAt < maniAt, '礼赠档案不在物流卡之后、订单清单之前')
  check('B15.reviewed-as-chip', /class="od-status-chip"[\s\S]{0,400}?!reviewCanAny\}\}"/.test(foot) && !/comment-done/.test(odw), '已评完仍占一枚大按钮')
  const footRule = rule('.action-footer')
  check('B15.safe-area', /constant\(safe-area-inset-bottom\)/.test(footRule) && /env\(safe-area-inset-bottom\)/.test(footRule), '底栏未同时处理 constant()/env() 安全区')

  // B13
  check('B13.feedback-press', /bindtap="submitFeedback"/.test(src[F.feedbackWxml]) && /'account-btn-press'\}\}"[^>]*bindtap="submitFeedback"/.test(src[F.feedbackWxml]), '反馈提交按钮无按压反馈')
  check('B13.onboarding-finish-press', /hover-class="\{\{saving \? '' : 'account-btn-press'\}\}"[\s\S]{0,60}bindtap="finishWithGift"/.test(src[F.onboardingWxml]), '注册完成按钮无按压反馈')


  // B14
  const cj = stripJsComments(src[F.certJs])
  const helperAt = cj.indexOf('async function fetchAllPages(')
  const helper = helperAt >= 0 ? cj.slice(helperAt, cj.indexOf('\n}', helperAt)) : ''
  check('B14.helper-paginates', /for\s*\(|while\s*\(/.test(helper) && /\.skip\(/.test(helper) && /\.limit\(/.test(helper) && /\bbreak\b/.test(helper),
    '荣誉档案缺少 skip + limit 的分批循环（fetchAllPages）')
  const sites = [...cj.matchAll(/db\.collection\('orders'\)/g)].map((m) => m.index)
  const unpaged = sites.filter((i) => !/fetchAllPages\(\(\)\s*=>\s*$/.test(cj.slice(Math.max(0, i - 40), i)))
  check('B14.orders-all-paged', sites.length > 0 && unpaged.length === 0, `荣誉档案有 ${unpaged.length} 处 orders 查询未经分批（单次最多 20 条）`)

  checkCommentPage(src, check)
  await checkModeration(src, check)
  checkOrderReviewUi(src, check)

  return { pass, fails }
}

function checkOrderReviewUi(src, check) {
  // 评价页文案按新流程
  const cmJs = stripJsComments(src[F.cmJs])
  check('B17.pending-copy', /pending:\s*\{\s*statusText:\s*'审核中',\s*statusNote:\s*'正在检测内容/.test(cmJs), '评价页「审核中」说明未按「正在检测内容」新流程')
  const submit = methodBody(cmJs, 'submitComment')
  check('B17.submit-toast-by-status', /res\.result\.status === 'approved'/.test(submit) && /'评价已展示'/.test(submit) && /正在检测内容/.test(submit) && !/title:\s*res\.result\.msg/.test(submit),
    '提交成功提示未按 approved / pending 区分')

  // 订单列表
  const ow = src[F.ordersWxml]
  const writeBtn = (ow.match(/<view class="btn-action"[^>]*?catchtap="goToReview"[^>]*>\s*写下感受/) || [''])[0]
  check('B18.list-write-gated', /item\.reviewCanWrite/.test(writeBtn), '订单列表「写下感受」未按评价状态收起（已评价 / 审核中 / 已隐藏仍显示）')
  check('B18.list-chip', /class="review-chip[\s\S]{0,200}?wx:elif="[^"]*item\.reviewChip/.test(ow), '订单列表评完后缺状态标签')
  const oj = stripJsComments(src[F.ordersJs])
  const fAt = oj.indexOf('function reviewFlags(')
  let flags = null
  try { flags = fAt >= 0 ? new Function(`${oj.slice(fAt, oj.indexOf('\n}', fAt) + 2)}\nreturn reviewFlags`)() : null } catch { /* 按缺失 */ }
  const f = (s) => { try { return flags ? flags(s) : null } catch { return null } }
  const ok = (s, w, chip) => { const r = f(s); return !!r && r.reviewCanWrite === w && r.reviewChip === chip }
  check('B18.flags-reviewed-no-write', ok('done', false, '✓ 已评价') && ok('pending', false, '审核中'), '已评价 / 审核中的订单仍给「写下感受」或标签不对')
  check('B18.flags-writable', ok('none', true, '') && ok('partial', true, '') && ok('unknown', true, ''), '未评 / 部分评 / 查询失败的订单丢了「写下感受」')
  check('B18.flags-loading-blank', ok(undefined, false, '') && ok('na', false, ''), '评价状态未回来时先闪「写下感受」')
  const load = methodBody(oj, 'loadReviewStates')
  check('B18.list-batched', /orderReviewMap/.test(load) && /i \+= REVIEW_MAP_BATCH/.test(load) && /REVIEW_MAP_BATCH = (\d+)/.test(oj) && Number(oj.match(/REVIEW_MAP_BATCH = (\d+)/)[1]) >= 20
    && /this\.loadReviewStates\(list\)/.test(methodBody(oj, 'loadOrders')), '订单列表评价状态不是按批一次调用')

  // 订单详情底栏标签
  const odw = src[F.odWxml]
  check('B18.detail-chip-pending', /\{\{reviewChipPending \? '审核中' : '已评价'\}\}/.test(odw) && /od-chip-tick" wx:if="\{\{!reviewChipPending\}\}"/.test(odw), '订单详情底栏标签不区分「审核中 / 已评价」')
  check('B18.detail-chip-js', /reviewChipPending:\s*reviewProducts\.some\(\(p\) => p && p\.reviewStatus === 'pending'\)/.test(stripJsComments(src[F.odJs])), '订单详情未按 reviewStatus 计算审核中')
}

/** 评价页顶层纯函数（Page 之前的部分）真跑：返回 buildViewReview；取不到 / 抛错 → null */
function loadBuildViewReview(js) {
  const head = js.slice(0, js.indexOf('\nPage({'))
  try {
    return new Function(`${head}\nreturn typeof buildViewReview === 'function' ? buildViewReview : null`)()
  } catch {
    return null
  }
}

function checkCommentPage(src, check) {
  const w = src[F.cmWxml]
  const js = stripJsComments(src[F.cmJs])
  const fn = stripJsComments(src[F.cmFn])
  const css = stripCssComments(src[F.cmWxss])
  const rule = (sel) => (css.match(new RegExp(`(?:^|})\\s*${sel.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`)) || [])[1] || ''

  // ① 返回入口只剩微信导航
  check('B16.no-custom-navbar', !/custom-navbar|back-btn|back-arrow|bindtap="goBack"/.test(w), '评价页又画了自定义标题栏 / 返回箭头（与微信导航重复）')
  check('B16.no-back-to-order-btn', !/>\s*返回订单\s*</.test(w) && !/>\s*返回\s*</.test(w), '评价页又出现「返回订单 / 返回」按钮（与微信导航重复）')

  // ② 标题
  let title = ''
  try { title = JSON.parse(src[F.cmJson]).navigationBarTitleText || '' } catch { /* 解析失败按空 */ }
  check('B16.json-title-neutral', !!title && title !== '发表评价' && title !== '写下感受', `index.json 标题为「${title}」：已评价订单会先闪撰写态标题`)
  const sync = methodBody(js, 'syncTitle')
  check('B16.dynamic-title', /setNavigationBarTitle/.test(sync) && /'我的评价'/.test(sync) && /'发表评价'/.test(sync), 'syncTitle 未按态设置「我的评价 / 发表评价」')
  check('B16.title-synced', /this\.syncTitle\(\)/.test(methodBody(js, 'bootstrap')) && /this\.syncTitle\(\)/.test(methodBody(js, 'selectProduct')), '初始化 / 切换藏品后未同步导航标题')

  // ③ 查看态
  check('B16.view-branch', /wx:elif="\{\{!canReview && !viewReview\}\}"/.test(w) && /<view class="review-card" wx:if="\{\{viewReview\}\}">/.test(w), '已评价藏品未进入「我的评价」查看态（仍落到资格提示卡）')
  const build = loadBuildViewReview(js)
  const run = (sel) => { try { return build ? build(sel) : undefined } catch { return undefined } }
  const p = { productId: 'p1', canReview: false, rating: 4 }
  const pending = run({ ...p, reviewStatus: 'pending', myReview: { status: 'pending', rating: 4, content: '五个字以上', images: ['cloud://a'], createdAt: 1790000000000 } })
  const approved = run({ ...p, reviewStatus: 'approved', myReview: { status: 'approved', rating: 5, content: 'x', images: [], createdAt: 1790000000000, merchantReply: '谢谢' } })
  const hidden = run({ ...p, reviewStatus: 'hidden' })
  check('B16.view-fn-found', !!build, '评价页顶层缺少 buildViewReview（或无法独立运行）')
  check('B16.pending-is-pending', !!pending && pending.statusText === '审核中' && pending.canVisit === false && pending.content === '五个字以上' && pending.images.length === 1 && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(pending.timeText),
    `pending 查看态不对：${JSON.stringify(pending)}`)
  check('B16.approved-is-shown', !!approved && approved.statusText === '已展示' && approved.canVisit === true && approved.rating === 5 && approved.merchantReply === '谢谢',
    `approved 被判成「${approved && approved.statusText}」或无藏品入口`)
  check('B16.hidden-no-revisit', !!hidden && hidden.statusText === '未展示' && hidden.canVisit === false && hidden.rating === 4, `hidden 查看态不对：${JSON.stringify(hidden)}`)
  check('B16.compose-not-view', run({ ...p, canReview: true, reviewStatus: 'none' }) === null && run({ ...p, reviewStatus: 'none' }) === null && run(null) === null,
    '可评价 / 无评价记录的藏品被当成查看态')
  check('B16.no-approved-without-product', (run({ canReview: false, reviewStatus: 'approved' }) || {}).canVisit === false, '无藏品 ID 仍给「去藏品页看看」')

  // ④ 云函数只新增字段
  const mapAt = fn.indexOf('const products = reviewable.map(')
  const mapBody = mapAt >= 0 ? fn.slice(mapAt, fn.indexOf('})', mapAt) + 2) : ''
  const keysKept = ['reviewStatus:', 'statusLabel:', 'canReview:', 'commentId:', 'rating:'].every((k) => mapBody.includes(k))
  check('B16.fn-keys-kept', keysKept && /myReview:\s*myReviewOf\(comment\)/.test(mapBody), 'orderStatus 的 products 原有键缺失或未新增 myReview')
  const mrAt = fn.indexOf('function myReviewOf(')
  const mr = mrAt >= 0 ? fn.slice(mrAt, fn.indexOf('\n}', mrAt)) : ''
  check('B16.fn-myreview-no-identity', !!mr && !/userId|_openid|openid|likedBy|orderId/.test(mr), 'myReview 快照带出了身份 / 订单字段')
  check('B16.fn-latest-by-ms', /toMs\(c\.updatedAt \|\| c\.createdAt\)\s*>\s*toMs\(prev\.updatedAt \|\| prev\.createdAt\)/.test(fn) && !/String\(c\.updatedAt/.test(fn),
    '同单同藏品多条评价仍按字符串比较时间取最新（Date 与毫秒数混排时会取错）')

  // ⑤ 按压与说明字
  check('B16.visit-press', /class="review-visit"[\s\S]{0,160}?hover-class="tap-press"/.test(w), '「去藏品页看看」无 tap-press')
  check('B16.chip-press', /class="product-chip[\s\S]{0,300}?hover-class="tap-press-soft"/.test(w), '藏品切换卡无 tap-press-soft')
  const muted = ['.review-note', '.review-time', '.gate-text'].filter((s) => /#6B6560|text-muted/i.test(rule(s)) || !rule(s))
  check('B16.caption-secondary', muted.length === 0, `说明字低于 secondary 或缺规则：${muted.join(', ')}`)
}

function loadAll() {
  const src = {}
  for (const f of new Set([...Object.values(F), ...NO_RAW_ERROR_FILES])) src[f] = read(f)
  return src
}

function report({ pass, fails }) {
  for (const f of fails) console.error(`  ✗ ${f}`)
  if (fails.length) {
    console.error(`✗ check:bflow-polish：${fails.length} 项失败 / ${pass} 项通过`)
    return 1
  }
  console.log(`✓ check:bflow-polish：${pass} 项通过（交易主链 B1–B6 · 「我的」子页 B7–B10 · 凭证与底栏 B11–B13 · 证书分页 B14 · 底栏改版 B15 · 评价页查看态 B16 · 检测通过自动展示 B17 · 订单页审核中 / 已评价 B18）`)
  return 0
}

const INJECTIONS = [
  ['B1 折扣回退成浮点拼接', F.odWxml, (s) => s.replace('{{order.discountText}}', '{{order.discountRate * 10}}折')],
  ['B2 定金抵扣行用回未定义类名', F.odWxml, (s) => s.replace('<view class="f-row highlight" wx:if="{{depositCredit > 0}}">', '<view class="price-row" wx:if="{{depositCredit > 0}}">')],
  ['B3 列表支付去掉防重入', F.ordersJs, (s) => s.replace('if (this.data.payingId) return;', '')],
  ['B3 详情支付 finally 不复位', F.odJs, (s) => s.replace('this.setData({ paying: false });', '')],
  ['B4 跳转失败拼回 errMsg', F.ordersJs, (s) => s.replace("wx.showToast({ title: '暂时打不开订单详情，请稍后再试', icon: 'none' });", "wx.showToast({ title: '跳转失败： ' + (err.errMsg || '未知错误'), icon: 'none' });")],
  ['B4 售后提交透出 err.message', `${B}/aftersale-apply/index.js`, (s) => s.replace("wx.showToast({ title: /上传失败$/.test(m)", "wx.showToast({ title: (err && err.message) || /上传失败$/.test(m)")],
  ['B5 购物车门槛回到「满 0 可用」', F.cartWxml, (s) => s.replace("{{item.minSpend > 0 ? '满 ¥' + item.minSpend + ' 可用' : '无门槛'}}", '满 {{item.minSpend}} 可用')],
  ['B6 学名回填占位 Specimen', F.ordersWxml, (s) => s.replace('{{prod.latin}}</text>', "{{prod.latin || 'Specimen'}}</text>")],
  ['B7 预约票人数写回前导 0', F.bookingWxml, (s) => s.replace("{{bookCount < 10 ? '0' + bookCount : bookCount}} 人", '0{{bookCount}} 人')],
  ['B8 入场延迟回到无上限', F.certWxml, (s) => s.replace('{{index < 8 ? index * 0.06 : 0.48}}s', '{{index * 0.1}}s')],
  ['B8 加载中显示收藏件数', F.certWxml, (s) => s.replace('<text class="h2" wx:if="{{loading}}">正在检索档案…</text>', '')],
  ['B9 默认卡重新显示设为默认', F.addrWxml, (s) => s.replace('<view class="act-btn" wx:if="{{!item.isDefault}}" catchtap="setDefault"', '<view class="act-btn" catchtap="setDefault"')],
  ['B10 礼赠填址去掉进行中文案', F.giftAddrWxml, (s) => s.replace("{{submitting ? '正在记下…' : '确认收件去处'}}", '确认收件去处')],
  ['B11 票据去掉加载分支', F.ticketWxml, (s) => s.replace('<text class="qr-tip muted" wx:elif="{{!booking._id}}">正在取出票据…</text>', '')],
  ['B11 票据标签回到纯英文', F.ticketWxml, (s) => s.replace('<text class="label">项目｜PROJECT</text>', '<text class="label">PROJECT</text>')],
  ['B4 票据失败拼回 errMsg', F.ticketJs, (s) => s.replace("wx.showToast({ title: '票据没取到，请检查网络后重试', icon: 'none' });", "wx.showToast({ title: err.errMsg || '票据不存在', icon: 'none' });")],
  ['B12 底栏按钮丢 hover-class', F.odWxml, (s) => s.replace('<view class="btn-text cancel" hover-class="tap-press-soft" hover-stay-time="80"', '<view class="btn-text cancel"')],
  ['B12 app.wxss 丢 tap-press-soft', F.appWxss, (s) => s.replace('.tap-press-soft {', '.tap-press-softx {')],
  ['B15 hologram 回到 flex: 1', F.odWxss, (s) => s.replace('.hologram-btn {\n  background: var(--color-bg-card);', '.hologram-btn {\n  flex: 1;\n  background: var(--color-bg-card);')],
  ['B15 次级按钮回到 flex: 0 0 auto', F.odWxss, (s) => s.replace('.btn-text {\n  flex: 1 1 0;', '.btn-text {\n  flex: 0 0 auto;')],
  ['B15 礼赠档案挪回订单编号下', F.odWxml, (s) => {
    const a = s.indexOf('    <!-- 礼赠档案（2026-09-21）')
    const b = s.indexOf('    <view class="manifest-section')
    const blk = s.slice(a, b)
    const t = s.slice(0, a) + s.slice(b)
    const at = t.indexOf('    <view class="shipping-label slide-in-delay-1"')
    return t.slice(0, at) + blk + t.slice(at)
  }],
  ['B15 已评价回到大按钮', F.odWxml, (s) => s.replace('class="od-status-chip"', 'class="btn-text comment-after comment-done"')],
  ['B15 底栏丢 constant() 安全区', F.odWxss, (s) => s.replace('  padding-bottom: calc(20rpx + constant(safe-area-inset-bottom));\n', '')],
  ['B14 证书查询回到裸 get()', F.certJs, (s) => s.replace(`fetchAllPages(() => db.collection('orders')
          .where({
            _openid: openid,
            status: 'received'
          })
          .orderBy('createTime', 'desc')),`, `db.collection('orders')
          .where({
            _openid: openid,
            status: 'received'
          })
          .orderBy('createTime', 'desc')
          .get(),`)],
  ['B14 分批循环丢 skip', F.certJs, (s) => s.replace('.skip(page * PAGE_SIZE)', '')],
  ['B13 反馈按钮丢按压', F.feedbackWxml, (s) => s.replace(` hover-class="{{submitting ? '' : 'account-btn-press'}}" hover-stay-time="80"`, '')],
  ['B16 评价页画回自定义标题栏', F.cmWxml, (s) => s.replace('<view class="page-wrapper">', '<view class="page-wrapper">\n  <view class="custom-navbar"><view class="back-btn" bindtap="goBack"><text class="back-arrow">‹</text></view></view>')],
  ['B16 资格卡加回「返回订单」', F.cmWxml, (s) => s.replace('<text class="gate-text">{{gateMsg}}</text>', '<text class="gate-text">{{gateMsg}}</text>\n        <view class="btn-secondary" bindtap="goOrderDetail">返回订单</view>')],
  ['B16 标题回到「发表评价」', F.cmJson, (s) => s.replace('"navigationBarTitleText": "评价"', '"navigationBarTitleText": "发表评价"')],
  ['B16 不再按态改标题', F.cmJs, (s) => s.replace("viewReview ? '我的评价' : ", '')],
  ['B16 已评价落回资格卡', F.cmWxml, (s) => s.replace('wx:elif="{{!canReview && !viewReview}}"', 'wx:elif="{{!canReview}}"')],
  ['B16 已通过被判成审核中', F.cmJs, (s) => s.replace("approved: { statusText: '已展示'", "approved: { statusText: '审核中'")],
  ['B16 非已展示也给藏品入口', F.cmJs, (s) => s.replace("canVisit: status === 'approved' && !!selected.productId", 'canVisit: !!selected.productId')],
  ['B16 无评价记录也进查看态', F.cmJs, (s) => s.replace("if (!status || status === 'none') return null", 'if (!status) return null')],
  ['B16 云函数不再给 myReview', F.cmFn, (s) => s.replace(',\n      myReview: myReviewOf(comment)', '')],
  ['B16 myReview 带出 openid', F.cmFn, (s) => s.replace("status: comment.status || 'pending',", "status: comment.status || 'pending',\n    userId: comment.userId,")],
  ['B16 取最新回到字符串比较', F.cmFn, (s) => s.replace('toMs(c.updatedAt || c.createdAt) > toMs(prev.updatedAt || prev.createdAt)', "String(c.updatedAt || c.createdAt || '') > String(prev.updatedAt || prev.createdAt || '')")],
  ['B16 藏品入口丢按压', F.cmWxml, (s) => s.replace('bindtap="goProduct"\n              hover-class="tap-press"', 'bindtap="goProduct"')],
  ['B16 说明字回到 muted', F.cmWxss, (s) => s.replace('.review-note {\n  font-size: 24rpx;\n  color: #A09A90;', '.review-note {\n  font-size: 24rpx;\n  color: #6B6560;')],
  ['B17 文字 review（不通过）也自动展示', F.cmFn, (s) => s.replace("  else if (textCheck.needReview) reviewReasons.push('text_suggest_review')\n", '')
    .replace("else if (textCheck.suggest !== 'pass')", "else if (!['pass', 'review'].includes(textCheck.suggest))")],
  ['B17 文字结果不确定当通过', F.cmFn, (s) => s.replace("  else if (textCheck.suggest !== 'pass') reviewReasons.push('text_result_unknown')\n", '')],
  ['B17 图片无 errCode 当通过', F.cmFn, (s) => s.replace("return !!r && r.ok === true && !r.skipped && (r.errcode === 0 || r.errcode === '0')", 'return !!r && r.ok === true')],
  ['B17 图片报错不转人工', F.cmFn, (s) => s.replace("    if (!r.ok) reviewReasons.push(r.openapiUnavailable ? 'image_check_openapi_unavailable' : `image_check_${r.reason}`)\n    else if (!imagePassedExplicitly(r))", '    if (r.ok && !imagePassedExplicitly(r))')],
  ['B17 违规图片不拒绝', F.cmFn, (s) => s.replace("    if (!r.ok && r.reason === 'risky') {\n      return { ok: false, msg: '图片未通过安全检测，请更换后重试' }\n    }\n", '')],
  ['B17 一律写 approved', F.cmFn, (s) => s.replace('  if (secCheck.autoApprove) return', '  if (true) return')],
  ['B17 隐藏后改写自动展示', F.cmFn, (s) => s.replace("const moderation = prev.status === 'hidden'", 'const moderation = false')],
  ['B17 评价页文案回到旧流程', F.cmJs, (s) => s.replace("statusNote: '正在检测内容，稍后展示在藏品页。'", "statusNote: '审核通过后会展示在藏品页，其他藏友就能看到。'")],
  ['B17 提交提示不分状态', F.cmJs, (s) => s.replace("title: shown ? '评价已展示' : '已提交，正在检测内容，稍后展示'", "title: res.result.msg || '已提交'")],
  ['B18 隐藏算可重评', F.cmFn, (s) => s.replace("(byProduct[p.productId] ? byProduct[p.productId].status || 'pending' : 'none')", "(byProduct[p.productId] && byProduct[p.productId].status !== 'hidden' ? byProduct[p.productId].status || 'pending' : 'none')")],
  ['B18 审核中算已评价', F.cmFn, (s) => s.replace("        : statuses.includes('pending')", '        : false')],
  ['B18 reviewMap 不校验订单归属', F.cmFn, (s) => s.replace('    if (!order || !isOrderActor(order, openid)) return\n', '    if (!order) return\n')],
  ['B18 reviewMap 逐单查库', F.cmFn, (s) => s.replace('  const map = {}\n  ;(ordersRes.data', "  for (const id of ids) await db.collection('orders').doc(id).get()\n  const map = {}\n  ;(ordersRes.data")],
  ['B18 列表无条件写下感受', F.ordersWxml, (s) => s.replace(' && !item.isVoucherOrder && item.reviewCanWrite}}"', ' && !item.isVoucherOrder}}"')],
  ['B18 列表已评价仍可写', F.ordersJs, (s) => s.replace("reviewState === 'unknown',", "reviewState === 'unknown' || reviewState === 'done',")],
  ['B18 列表状态未回来先给入口', F.ordersJs, (s) => s.replace("reviewCanWrite: reviewState === 'none'", "reviewCanWrite: !reviewState || reviewState === 'none'")],
  ['B18 列表逐单调用', F.ordersJs, (s) => s.replace('i += REVIEW_MAP_BATCH', 'i += 1')],
  ['B18 详情标签不分审核中', F.odWxml, (s) => s.replace("{{reviewChipPending ? '审核中' : '已评价'}}", "{{reviewSummaryLabel || '已评价'}}")]
]

if (process.argv.includes('--selftest')) {
  const base = loadAll()
  const clean = await runChecks(base)
  if (clean.fails.length) {
    console.error('✗ 自检前置：基线本身不绿')
    process.exit(report(clean))
  }
  let ok = 0
  for (const [name, file, mut] of INJECTIONS) {
    const injected = mut(base[file])
    if (injected === base[file]) {
      console.error(`  ✗ 注入锚点失效：${name}`)
      continue
    }
    const r = await runChecks({ ...base, [file]: injected })
    if (r.fails.length) {
      ok += 1
      console.log(`  ✓ 检出：${name}`)
    } else console.error(`  ✗ 未检出：${name}`)
  }
  if (ok !== INJECTIONS.length) {
    console.error(`✗ 自检：${ok}/${INJECTIONS.length} 条注入被检出`)
    process.exit(1)
  }
  console.log(`✓ 自检：${ok}/${INJECTIONS.length} 条注入全部检出（内存副本，不写盘）`)
  process.exit(0)
}

process.exit(report(await runChecks(loadAll())))
