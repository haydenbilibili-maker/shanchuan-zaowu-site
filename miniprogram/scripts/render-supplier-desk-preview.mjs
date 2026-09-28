/**
 * 超管「供应商预览 → 供应商管理」改前 / 改后预览（开发工具，不进 check:admin）
 *
 * 结构与样式都从真源码现读；页面 data 由**真页面 JS** 产出：用最小 Page / wx 桩加载各页 index.js，
 * wx.cloud.callFunction 桩按 manageSupplierDesk 的出参形状、用真 deskCore 纯函数算出结果 —— 口径与线上一致。
 * 无头 Chrome 以 750px 视口截图（rpx 1:1 当 px）。
 *
 * 用法：node miniprogram/scripts/render-supplier-desk-preview.mjs --out-dir <目录> [--before-dir <旧快照目录>] [--only a,b]
 *   旧快照目录下放改前的 Hub `hub.wxml`（extra/supplier/index.wxml）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderWxml } from './lib/wxml-preview.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const MP = join(ROOT, 'miniprogram')
const DESK = join(MP, 'subpackages/b2bdesk')
const HUB = join(MP, 'subpackages/extra/supplier')

const argv = process.argv.slice(2)
const argOf = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const outDir = argOf('--out-dir', join(tmpdir(), 'supplier-desk-preview'))
const beforeDir = argOf('--before-dir', join(HERE, '.tmp/supplier-desk-before'))
const only = argOf('--only', '')
mkdirSync(outDir, { recursive: true })

const chrome = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean).find((p) => existsSync(p))
if (!chrome) {
  console.error('✗ 未找到 Chrome（可用 CHROME_PATH 指定）——预览工具，不参与守卫')
  process.exit(1)
}

/* ── CJS 加载（带全局桩） ── */
function loadCjs(absPath, globals = {}) {
  const mod = { exports: {} }
  const req = (id) => {
    for (const c of [resolve(dirname(absPath), id), `${resolve(dirname(absPath), id)}.js`]) {
      if (existsSync(c) && statSync(c).isFile()) return loadCjs(c, globals)
    }
    return {}
  }
  const names = Object.keys(globals)
  new Function('module', 'exports', 'require', ...names, readFileSync(absPath, 'utf8'))(mod, mod.exports, req, ...names.map((n) => globals[n]))
  return mod.exports
}

const core = loadCjs(join(MP, 'cloudfunctions/manageSupplierDesk/deskCore.js'))

/* ── 样例数据（形状对齐 2026-09-28 线上只读实测：purchase_orders / price_list_items / staff_members） ── */
const NOW = Date.parse('2026-09-28T14:00:00Z') // 北京时间 22:00
const at = (iso) => Date.parse(iso)
const orders = [
  { _id: 'po1', orderNo: 'PO20260920001', source: 'buyer_workbench', _openid: 'oBUY', company: '令狐文创', status: 'shipped', paymentStatus: 'paid', paymentChannel: 'wechat_jsapi', totalAmount: 900, payFen: 90000, paidFen: 90000, transactionId: '4200001234567890', payTrades: [{ outTradeNo: 'B2B1727000000001' }], payOutTradeNos: ['B2B1727000000001'], submittedAt: at('2026-09-20T03:00:00Z'), paidAt: at('2026-09-20T03:05:00Z'), confirmedAt: at('2026-09-21T02:00:00Z'), items: [{ name: '光明女神闪蝶 · 12cm 玻璃罩', skuId: 'BF-001', quantity: 6, unitPrice: 150 }], contactName: '令狐', contactPhone: '138****0001', shipToAddress: '成都市锦江区春熙路 1 号' },
  { _id: 'po2', orderNo: 'PO20260912002', source: 'buyer_workbench', _openid: 'oB2', company: '青禾文创', status: 'submitted', paymentStatus: 'unpaid', totalAmount: 180, submittedAt: at('2026-09-12T06:00:00Z'), items: [{ name: '金凤蝶压制标本', skuId: 'BF-014', quantity: 3, unitPrice: 60 }] },
  { _id: 'po3', orderNo: 'SP20260922003', party: 'supplier_fulfillment', supplierId: 'SUP1', status: 'shipped', totalAmount: 500, submittedAt: at('2026-09-22T02:00:00Z'), shippedAt: at('2026-09-24T08:00:00Z'), logisticsCarrier: '中通', logisticsTracking: 'ZT7788990011', items: [{ name: '枯叶蛱蝶原虫', skuId: 'RAW-003', quantity: 50, unitPrice: 10 }] },
  { _id: 'po4', orderNo: 'PO20260926004', source: 'buyer_workbench', _openid: 'oBUY', company: '令狐文创', status: 'confirmed', paymentStatus: 'offline_pending', paymentChannel: 'offline', totalAmount: 1280, submittedAt: at('2026-09-26T05:00:00Z'), items: [{ name: '蓝闪蝶蝶翅画 · 相框', skuId: 'BF-021', quantity: 4, unitPrice: 320 }] },
  { _id: 'po5', orderNo: 'PO20260927005', source: 'buyer_workbench', _openid: 'oB2', company: '青禾文创', status: 'submitted', paymentStatus: 'pay_review', totalAmount: 360, payFen: 36000, payAnomaly: { code: 'AMOUNT_MISMATCH', paidFen: 35000, expectedFen: 36000, at: at('2026-09-27T09:00:00Z') }, submittedAt: at('2026-09-27T08:50:00Z'), items: [{ name: '海洋贝类冰箱贴', skuId: 'SEA-006', quantity: 12, unitPrice: 30 }] },
  { _id: 'po6', orderNo: 'PO20260918006', source: 'buyer_workbench', _openid: 'oBUY', company: '令狐文创', status: 'cancelled', paymentStatus: 'refunded', totalAmount: 240, paidFen: 24000, refund: { status: 'refunded', reason: '采购商改期' }, refundedAt: at('2026-09-19T02:00:00Z'), submittedAt: at('2026-09-18T02:00:00Z'), items: [{ name: '甲虫收藏级标本', skuId: 'BT-002', quantity: 2, unitPrice: 120 }] }
]
const shipments = { po1: [{ purchaseOrderId: 'po1', shipmentNo: 'SH-0921-01', logistics: { carrier: '顺丰', trackingNumber: 'SF1234567890123', shipTime: at('2026-09-21T09:30:00Z') } }] }
const names = { 'b:oBUY': '令狐采购', 'b:oB2': '青禾文创', 's:SUP1': '云南蝶谷标本社' }
const priceItems = [
  { _id: 'p1', skuId: 'BF-001', name: '光明女神闪蝶', species: '光明女神闪蝶', packaging: '12cm 玻璃罩', price: 150, guidePrice: 299, status: 'active', sort: 1, refCount: 2 },
  { _id: 'p2', skuId: 'BF-021', name: '蓝闪蝶蝶翅画', species: '蓝闪蝶', packaging: 'A4 相框', price: { min: 280, max: 360 }, status: 'active', sort: 2, refCount: 1 },
  { _id: 'p3', skuId: 'SEA-006', name: '海洋贝类冰箱贴', species: '混合贝类', packaging: '单枚吸塑', price: 30, guidePrice: 58, status: 'active', sort: 3, refCount: 1 },
  { _id: 'p4', skuId: 'BT-009', name: '长戟大兜虫', species: '长戟大兜虫', packaging: '收藏级标本盒', price: null, status: 'inactive', sort: 4, refCount: 0, retiredAt: at('2026-09-10T00:00:00Z') }
]
const priceRow = (r) => ({ ...r, priceText: core.priceText(r.price), guideText: r.guidePrice == null ? '' : core.priceText(r.guidePrice), retired: !!r.retiredAt, prepMethod: '干制', packagingFilter: '玻璃罩', bioFilter: '蝴蝶', specs: '', note: '', image: '' })
const partnerRow = (staffId, name, openid, roles, extra = {}) => {
  const sides = core.deskSidesOf(roles)
  const keys = [sides.buyer ? `b:${openid}` : '', sides.supplier ? `s:${extra.supplierId || openid}` : ''].filter(Boolean)
  const mine = orders.filter((o) => keys.includes(core.partnerKeyOf(o)) && core.fulfilStageOf(o) !== 'cancelled')
  const amountFen = mine.reduce((s, o) => s + core.amountFenOf(o), 0)
  const dueFen = mine.filter((o) => ['due', 'offline', 'review'].includes(core.payBucketOf(o))).reduce((s, o) => s + core.amountFenOf(o), 0)
  const lastAt = Math.max(0, ...mine.map((o) => o.submittedAt))
  return {
    staffId, name, roles, sides, b2bOnly: core.isB2bOnlyRoles(roles), status: extra.status || 'active',
    supplierId: extra.supplierId || '', features: core.normalizeFeatures(extra.features), note: extra.note || '', partnerKeys: keys,
    orders: { count: mine.length, amountFen, dueFen, overdue: mine.filter((o) => core.agingOf(o, NOW).overdue).length, lastAt, amountText: core.yuanText(amountFen), dueText: core.yuanText(dueFen), lastText: core.bizDateKey(lastAt) }
  }
}
const partners = [
  { ...partnerRow('st1', '令狐采购', 'oBUY', ['buyer']), openidTail: '1a2b3c' },
  { ...partnerRow('st2', '青禾文创', 'oB2', ['channel'], { features: { order: false } }), openidTail: 'd4e5f6' },
  { ...partnerRow('st3', '云南蝶谷标本社', 'oSUP', ['supplier'], { supplierId: 'SUP1', note: '合同到期 2027-03' }), openidTail: 'g7h8i9' },
  { ...partnerRow('st4', '旧渠道·停用', 'oOLD', ['franchisee'], { status: 'disabled' }), openidTail: 'j1k2l3' }
]

function fnResult(data) {
  const a = data.action
  const t = NOW
  if (a === 'adminDashboard') {
    return { success: true, dashboard: core.buildDashboard(orders, { range: data.range, names }, t), partnerStats: { buyers: 3, suppliers: 1, disabled: 1 }, priceStats: { active: 3, inactive: 1 }, truncated: false }
  }
  if (a === 'adminListOrders') {
    const list = core.filterOrders(orders, data, t).sort((x, y) => y.submittedAt - x.submittedAt)
    return { success: true, list: list.map((o) => core.orderRow(o, { names, shipmentsByPo: shipments }, t)), total: list.length, page: 1, hasMore: false }
  }
  if (a === 'adminGetOrder') {
    const po = orders.find((o) => o._id === data.id)
    const sh = shipments[po._id] || []
    return {
      success: true,
      order: core.orderRow(po, { names, shipmentsByPo: shipments }, t),
      items: po.items.map((it) => ({ name: it.name, skuId: it.skuId, qty: it.quantity, unitText: core.yuanText(it.unitPrice * 100), lineText: core.yuanText(it.unitPrice * 100 * it.quantity) })),
      contact: { company: po.company, contactName: po.contactName, contactPhone: po.contactPhone, shipToAddress: po.shipToAddress },
      payment: { status: po.paymentStatus, channel: po.paymentChannel, payFenText: po.payFen ? core.yuanText(po.payFen) : '', paidFenText: po.paidFen ? core.yuanText(po.paidFen) : '', attempts: (po.payTrades || []).length, outTradeTails: (po.payOutTradeNos || []).map((s) => s.slice(-8)), transactionTail: po.transactionId ? po.transactionId.slice(-6) : '' },
      aging: core.agingOf(po, t),
      timeline: core.buildTimeline(po, sh, t),
      logistics: core.logisticsOf(po, sh).map((x) => ({ ...x, shipTimeText: core.fmtTime(x.shipTime) }))
    }
  }
  if (a === 'adminListPriceItems') return { success: true, list: priceItems.map(priceRow), total: 4, page: 1, hasMore: false, counts: { all: 4, active: 3 }, canMove: true }
  if (a === 'adminGetPriceItem') {
    const options = { prep: core.PREP_METHODS, packaging: core.PACKAGING_FILTERS, bio: core.BIO_FILTERS }
    const r = priceItems.find((x) => x._id === data.id)
    return { success: true, item: r ? priceRow(r) : null, options }
  }
  if (a === 'adminListPartners') return { success: true, list: partners, catalog: core.DESK_FEATURES }
  if (a === 'myStatement') {
    const mine = orders.filter((o) => core.partnerKeyOf(o) === 'b:oBUY')
    return {
      success: true, preview: false, partnerName: '令狐采购', sides: { buyer: true, supplier: false },
      summary: core.buildDashboard(mine, { range: data.range, names }, t),
      list: mine.map((o) => ({ ...core.orderRow(o, { names, shipmentsByPo: shipments }, t), timeline: core.buildTimeline(o, shipments[o._id] || [], t) }))
    }
  }
  if (a === 'myAccess') return { success: true, deskKind: 'buyer', features: core.normalizeFeatures({}), catalog: core.DESK_FEATURES }
  return { success: false, msg: `预览桩未实现 ${a}` }
}

/* ── 用真页面 JS 产出 data ── */
function setPath(obj, path, val) {
  const ks = path.split('.')
  let o = obj
  ks.slice(0, -1).forEach((k) => { o[k] = o[k] && typeof o[k] === 'object' ? { ...o[k] } : {}; o = o[k] })
  o[ks[ks.length - 1]] = val
}
async function pageData(jsFile, query, after) {
  let cfg = null
  const wx = {
    cloud: { callFunction: ({ data }) => Promise.resolve({ result: JSON.parse(JSON.stringify(fnResult(data))) }) },
    setNavigationBarTitle() {}, navigateTo() {}, navigateBack() {}, stopPullDownRefresh() {}, setClipboardData() {}
  }
  loadCjs(jsFile, { Page: (c) => { cfg = c }, wx, getCurrentPages: () => [], setTimeout: () => 0, clearTimeout() {} })
  const inst = Object.create(cfg)
  inst.data = JSON.parse(JSON.stringify(cfg.data))
  inst.setData = (patch) => Object.keys(patch).forEach((k) => setPath(inst.data, k, patch[k]))
  if (inst.onLoad) await inst.onLoad(query || {})
  await new Promise((r) => setImmediate(r))
  if (after) await after(inst)
  await new Promise((r) => setImmediate(r))
  return inst.data
}

/* ── 渲染 ── */
const rpx2px = (t) => t.replace(/(\d*\.?\d+)rpx/g, '$1px')
function loadWxss(file, seen = new Set()) {
  if (seen.has(file)) return ''
  seen.add(file)
  return readFileSync(file, 'utf8').replace(/@import\s+['"]([^'"]+)['"];?/g, (_, rel) => {
    const p = resolve(dirname(file), rel)
    return existsSync(p) ? loadWxss(p, seen) : ''
  })
}
function appTokens() {
  const app = readFileSync(join(MP, 'app.wxss'), 'utf8')
  const start = app.indexOf('page {')
  let depth = 0
  for (let i = app.indexOf('{', start); i < app.length; i += 1) {
    if (app[i] === '{') depth += 1
    else if (app[i] === '}') { depth -= 1; if (depth === 0) return rpx2px(app.slice(app.indexOf('{', start) + 1, i)) }
  }
  return ''
}

const hubPreviewData = (extra = {}) => ({
  ready: true, staffName: '海登', isPreview: true, isBuyer: false, isSupplier: false, modeLabel: '超管预览',
  roleHint: '总部预览：上方采购路径写真实订货单；下方供货方区可开本地演示（与采购支付无关）。',
  demoOn: false, cartCount: 0, supplierOpen: false, showSupplierSection: true, features: null,
  buyerModules: [
    { key: 'catalog', title: '供货价目选购', desc: '图文价目 · 选 SKU 与数量', icon: '/assets/icons/box.png', badge: '' },
    { key: 'buyer-orders', title: '我的采购单', desc: '支付 · 待对公 · 履约进度', icon: '/assets/icons/cart.png', badge: '' }
  ],
  supplierModules: [], visibleSupplierModules: [],
  ...extra
})

const scenes = [
  { name: 'before-hub', h: 1300, wxml: join(beforeDir, 'hub.wxml'), wxss: join(HUB, 'index.wxss'), data: async () => hubPreviewData() },
  { name: 'after-center-dash', h: 2600, wxml: join(DESK, 'center/index.wxml'), wxss: join(DESK, 'center/index.wxss'), data: () => pageData(join(DESK, 'center/index.js'), {}, (p) => p.onDashRange({ currentTarget: { dataset: { key: 'all' } } })) },
  { name: 'after-center-orders', h: 2100, wxml: join(DESK, 'center/index.wxml'), wxss: join(DESK, 'center/index.wxss'), data: () => pageData(join(DESK, 'center/index.js'), { tab: 'orders' }, (p) => p.onOrderFilter({ currentTarget: { dataset: { field: 'range', key: 'all' } } })) },
  { name: 'after-center-price', h: 1500, wxml: join(DESK, 'center/index.wxml'), wxss: join(DESK, 'center/index.wxss'), data: () => pageData(join(DESK, 'center/index.js'), { tab: 'price' }) },
  { name: 'after-center-partners', h: 1500, wxml: join(DESK, 'center/index.wxml'), wxss: join(DESK, 'center/index.wxss'), data: () => pageData(join(DESK, 'center/index.js'), { tab: 'partners' }) },
  { name: 'after-order', h: 2300, wxml: join(DESK, 'order/index.wxml'), wxss: join(DESK, 'order/index.wxss'), data: () => pageData(join(DESK, 'order/index.js'), { id: 'po1' }) },
  { name: 'after-price-edit', h: 2500, wxml: join(DESK, 'price-edit/index.wxml'), wxss: join(DESK, 'price-edit/index.wxss'), data: () => pageData(join(DESK, 'price-edit/index.js'), { id: 'p2' }, (p) => p.remove()) },
  { name: 'after-partner', h: 1800, wxml: join(DESK, 'partner/index.wxml'), wxss: join(DESK, 'partner/index.wxss'), data: () => pageData(join(DESK, 'partner/index.js'), { id: 'st2' }) },
  { name: 'after-statement', h: 2000, wxml: join(DESK, 'statement/index.wxml'), wxss: join(DESK, 'statement/index.wxss'), data: () => pageData(join(DESK, 'statement/index.js'), {}, (p) => p.toggleOpen({ currentTarget: { dataset: { id: 'po1' } } })) },
  {
    name: 'after-hub', h: 1400, wxml: join(HUB, 'index.wxml'), wxss: join(HUB, 'index.wxss'),
    data: async () => hubPreviewData({
      features: core.normalizeFeatures({}),
      buyerModules: [
        { key: 'catalog', title: '供货价目选购', desc: '图文价目 · 选 SKU 与数量', icon: '/assets/icons/box.png', badge: '' },
        { key: 'buyer-orders', title: '我的采购单', desc: '支付 · 待对公 · 履约进度', icon: '/assets/icons/cart.png', badge: '' },
        { key: 'statement', title: '对账与物流', desc: '货款、账龄、运单号与进度时间线', icon: '/assets/icons/pay.png', badge: '' }
      ]
    })
  }
]

async function shoot(scene) {
  const missing = new Set()
  const data = await scene.data()
  const wxml = readFileSync(scene.wxml, 'utf8')
  const body = renderWxml(wxml, data, { lenient: true, onMissing: (k) => missing.add(k) })
    .replace(/src="\/assets\//g, `src="file://${MP}/assets/`)
  const css = rpx2px(loadWxss(scene.wxss))
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
:root { ${appTokens()} }
html, body { margin: 0; padding: 0; width: 750px; background: #1a1814; color: #fff; font-family: -apple-system, "PingFang SC", sans-serif; }
div, span { box-sizing: border-box; }
span { display: inline; }
input { display: block; box-sizing: border-box; width: 100%; font: inherit; }
</style><style>${css.replace(/(^|[^.\w-])page\s*\{/g, '$1body {')}</style></head><body>${body}</body></html>`
  const htmlPath = join(tmpdir(), `supplier-desk-${scene.name}-${process.pid}.html`)
  writeFileSync(htmlPath, html)
  const out = join(outDir, `${scene.name}.png`)
  if (existsSync(out)) rmSync(out)
  const profile = mkdtempSync(join(tmpdir(), 'supplier-desk-preview-'))
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
    `--user-data-dir=${profile}`, '--hide-scrollbars', '--force-device-scale-factor=1', '--virtual-time-budget=3000',
    `--window-size=750,${scene.h}`, `--screenshot=${out}`, `file://${htmlPath}`
  ], { stdio: 'ignore' })
  const deadline = Date.now() + 150000
  let lastSize = -1
  while (Date.now() < deadline) {
    const size = existsSync(out) ? statSync(out).size : 0
    if (size > 1000 && size === lastSize) break
    lastSize = size
    await new Promise((r) => setTimeout(r, 400))
  }
  try { child.kill('SIGKILL') } catch { /* ignore */ }
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
  if (!existsSync(out)) throw new Error(`截图未生成：${scene.name}`)
  console.log(`✓ ${scene.name} → ${out}${missing.size ? `（缺字段按空渲染：${[...missing].slice(0, 6).join(', ')}）` : ''}`)
}

for (const s of scenes) if (!only || only.split(',').includes(s.name)) await shoot(s)
