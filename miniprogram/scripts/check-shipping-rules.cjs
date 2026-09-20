#!/usr/bin/env node
/**
 * 运费规则 v3 守卫（两档：¥299/¥18 与 ¥39/¥10）：**代码 4 副本一致 + 云端文档与代码一致 + 装裱方式分类表一致 + 试算矩阵**
 *
 * 为什么必须有（2026-09-19 上一轮的教训）：
 *   本系统是「代码默认值 + **云端 shipping_rules 覆盖** + 异常降级」。上一轮把代码默认值
 *   从 98/298 改成 299/0，**云端文档仍是 98/298 → 云端赢，改动一点没生效**；而
 *   `node --check`、`build`、104 条门禁**全绿都发现不了**（`check:miniprogram-sync` 只管双仓一致，
 *   不管「代码 vs 云端」）。所以本守卫把**云端文档快照**也钉进来：
 *   代码默认值改了而云端没改 → 快照对不上 → 守卫红。
 *
 * 快照从哪来：`node miniprogram/scripts/check-shipping-rules.cjs --update-snapshot`
 *   （直读线上集合；需要 admin/.env 的 TCB_SECRET_* 与已登录的 tcb CLI）。
 *   只改快照文件、不改云端是**过不了**的 —— 因为刷新快照读的就是云端。
 *
 * 四段检查：
 *   A. 4 份代码副本（C 端展示 / 服务端权威 / 规则模型 / ERP 平行副本）关键字段一致
 *   B. 云端文档快照 vs 代码默认值一致（flatFee / freeShippingThreshold / **accessoryFreeThreshold / accessoryFlatFee** / chargedCraftTypes …）
 *   C. 收费 key 在 3 份 productTaxonomy 副本里都存在，且副本之间不漂移；界面不得另抄一份清单
 *   D. **真实执行**试算矩阵：8 组购物车在「服务端」与「C 端」算出同一个金额，且等于期望值
 *
 * 用法：
 *   node miniprogram/scripts/check-shipping-rules.cjs
 *   node miniprogram/scripts/check-shipping-rules.cjs --selftest
 *   node miniprogram/scripts/check-shipping-rules.cjs --live              # 直读线上再比对（手动/部署后）
 *   node miniprogram/scripts/check-shipping-rules.cjs --update-snapshot   # 直读线上并刷新快照
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..', '..')
const ENV_ID = process.env.CLOUD_ENV || 'cloud1-8gnkty5bfff9f0bf'
const COLLECTION = 'shipping_rules'
const ADMIN_ENV = path.join(ROOT, 'admin', '.env')

function defaultPaths() {
  return {
    client: path.join(ROOT, 'miniprogram', 'config', 'shipping.js'),
    server: path.join(ROOT, 'miniprogram', 'cloudfunctions', 'makeOrder', 'shipping.js'),
    defaults: path.join(ROOT, 'miniprogram', 'cloudfunctions', 'getShippingRules', 'defaults.js'),
    erp: path.join(ROOT, 'admin', 'src', 'utils', 'shippingRules.js'),
    managerPage: path.join(ROOT, 'miniprogram', 'subpackages', 'manager', 'manager', 'managerPageConfig.js'),
    erpView: path.join(ROOT, 'admin', 'src', 'components', 'ShippingRulesConfig.vue'),
    snapshot: path.join(__dirname, 'shipping-rules-cloud.snapshot.json'),
    // 免邮券省额的两个云函数（E 节真跑它们：证明「纯免邮订单不再报省 ¥18」）
    couponFns: {
      getProductCoupons: path.join(ROOT, 'miniprogram', 'cloudfunctions', 'getProductCoupons'),
      getBestCoupon: path.join(ROOT, 'miniprogram', 'cloudfunctions', 'getBestCoupon')
    },
    // 三个调用点：必须把「本单是否确定含收费类」传下去（漏一处就回到虚高）
    callSites: {
      detail: path.join(ROOT, 'miniprogram', 'subpackages', 'feature', 'detail', 'index.js'),
      confirm: path.join(ROOT, 'miniprogram', 'subpackages', 'business', 'confirm-order', 'index.js'),
      cart: path.join(ROOT, 'miniprogram', 'pages', 'cart', 'index.js')
    },
    taxonomies: [
      path.join(ROOT, 'miniprogram', 'config', 'productTaxonomy.js'),
      path.join(ROOT, 'miniprogram', 'cloudfunctions', 'manageProducts', 'productTaxonomy.js'),
      path.join(ROOT, 'miniprogram', 'cloudfunctions', 'getEncyclopediaFeed', 'productTaxonomy.js')
    ]
  }
}

const failures = []
const warnings = []
let passCount = 0

function check(name, condition, detail) {
  if (condition) passCount += 1
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

function warn(text) {
  warnings.push(text)
}

/**
 * 以 CommonJS 语义加载一个「无 require 的自包含模块」。
 *
 * ⚠️ 不能用 `require()`：仓库根 `package.json` 是 `"type": "module"`，
 * `miniprogram/config/*.js` 会被 Node 当成 ESM（`module is not defined`）；
 * 而小程序运行时是 CommonJS。所以这里按源码求值，语义与小程序一致。
 */
function loadCjsModule(file) {
  const src = fs.readFileSync(file, 'utf8')
  const mod = { exports: {} }
  // eslint-disable-next-line no-new-func
  const fn = new Function('module', 'exports', 'require', src)
  fn(mod, mod.exports, () => {
    throw new Error(`被守卫加载的模块不应 require 其他文件：${path.relative(ROOT, file)}`)
  })
  return mod.exports
}

function jsonEq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/* ------------------------------------------------------------------ *
 * 云函数装载器（E 节用）：把 `wx-server-sdk` 打桩成内存假库，相对 require 走真文件。
 *
 * 为什么不满足于文本断言：这两个函数算出来的数字是**直接展示给会员的钱**，
 * 只有真跑它们的 `main` 才能证明「纯免邮订单不再报省 ¥18」是真的、而不是注释写对了。
 * ------------------------------------------------------------------ */

/** @param {string} fnDir 云函数目录 @param {object} shippingDoc 喂给 shipping_rules 的文档 @param {Array} heldCoupons 喂给 user_coupons 的持有券 */
function loadCloudFn(fnDir, shippingDoc, heldCoupons) {
  const command = {
    in: (arr) => ({ $in: arr }),
    nin: (arr) => ({ $nin: arr }),
    neq: (v) => ({ $ne: v }),
    gte: (v) => ({ $gte: v }),
    lte: (v) => ({ $lte: v })
  }
  const makeQuery = (name) => {
    const q = {
      where: () => q, orderBy: () => q, limit: () => q, skip: () => q, field: () => q,
      get: async () => {
        if (name === 'shipping_rules') return { data: shippingDoc ? [shippingDoc] : [] }
        if (name === 'user_coupons') return { data: heldCoupons }
        return { data: [] } // coupons / 其它：空即可，claimable 循环不跑
      },
      count: async () => ({ total: 0 })
    }
    return q
  }
  const stub = {
    DYNAMIC_CURRENT_ENV: 'guard-stub-env',
    init: () => {},
    database: () => ({ collection: makeQuery, command }),
    getWXContext: () => ({ OPENID: 'guard-stub-openid' })
  }
  const cache = new Map()
  const miniRequire = (spec, fromDir) => {
    if (spec === 'wx-server-sdk') return stub
    if (!spec.startsWith('.')) throw new Error(`云函数守卫不该 require：${spec}`)
    const p = path.resolve(fromDir, spec.endsWith('.js') ? spec : `${spec}.js`)
    if (!cache.has(p)) {
      const mod = { exports: {} }
      cache.set(p, mod)
      // eslint-disable-next-line no-new-func
      new Function('module', 'exports', 'require', '__dirname', fs.readFileSync(p, 'utf8'))(
        mod, mod.exports, (s) => miniRequire(s, path.dirname(p)), path.dirname(p)
      )
    }
    return cache.get(p).exports
  }
  const mod = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', '__dirname', fs.readFileSync(path.join(fnDir, 'index.js'), 'utf8'))(
    mod, mod.exports, (s) => miniRequire(s, fnDir), fnDir
  )
  return mod.exports
}

/* ------------------------------------------------------------------ *
 * A. 4 份代码副本的关键字段
 * ------------------------------------------------------------------ */

function collectCodeDefaults(paths) {
  const client = loadCjsModule(paths.client)
  const server = loadCjsModule(paths.server)
  server.resetToDefaults()
  const serverCfg = server.snapshotConfig()
  const defaults = loadCjsModule(paths.defaults)
  const defaultsCfg = defaults.getDefaultConfig()
  return { client, server, serverCfg, defaults, defaultsCfg }
}

/** 关键字段快照（改这里必须同时改 4 份副本 + 云端文档） */
function keySnapshot(cfg) {
  return {
    flatFee: Number(cfg.flatFee),
    freeShippingThreshold: Number(cfg.freeShippingThreshold != null ? cfg.freeShippingThreshold : cfg.specimenFreeThreshold),
    // 裁决 48：其它类型那一档（门槛 ¥39 / 费率 ¥10）与收费类档各自独立
    accessoryFreeThreshold: Number(cfg.accessoryFreeThreshold),
    accessoryFlatFee: Number(cfg.accessoryFlatFee),
    chargedCraftTypes: Array.isArray(cfg.chargedCraftTypes) ? cfg.chargedCraftTypes.slice().sort() : null
  }
}

/* ------------------------------------------------------------------ *
 * B. 云端文档快照
 * ------------------------------------------------------------------ */

function loadDotEnv() {
  if (!fs.existsSync(ADMIN_ENV)) return
  for (const line of fs.readFileSync(ADMIN_ENV, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i <= 0) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}

function unwrapMongo(v) {
  if (v == null || typeof v !== 'object') return v
  if ('$numberInt' in v) return Number(v.$numberInt)
  if ('$numberLong' in v) return Number(v.$numberLong)
  if ('$numberDouble' in v) return Number(v.$numberDouble)
  if ('$oid' in v) return v.$oid
  if (Array.isArray(v)) return v.map(unwrapMongo)
  const out = {}
  for (const [k, val] of Object.entries(v)) out[k] = unwrapMongo(val)
  return out
}

/** 直读线上 shipping_rules（--live / --update-snapshot 用；CI 不跑） */
function readLiveDoc() {
  loadDotEnv()
  const cmd = JSON.stringify([
    {
      TableName: COLLECTION,
      CommandType: 'COMMAND',
      Command: JSON.stringify({ find: COLLECTION, filter: { status: 'active' }, limit: 5 })
    }
  ])
  const res = spawnSync('tcb', ['db', 'nosql', 'execute', '-e', ENV_ID, '--json', '--command', cmd], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: process.env
  })
  const out = (res.stdout || '') + (res.stderr || '')
  if (res.status !== 0) throw new Error(`tcb exit ${res.status}: ${out.slice(0, 500)}`)
  const i = out.indexOf('{')
  if (i < 0) throw new Error('tcb 无 JSON 输出')
  const parsed = JSON.parse(out.slice(i))
  const data = parsed.data || parsed
  const results = data.results || []
  const rows = results.map((p) => (Array.isArray(p) ? p : (p && p.data) || []))
  const list = (rows[0] || []).map(unwrapMongo)
  if (!list.length) throw new Error('线上 shipping_rules 没有 active 文档')
  list.sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
  return list[0]
}

/** 从线上文档抽出「快照」形态（去掉 _id / _openid 等运行期字段） */
function snapshotFromDoc(doc) {
  return {
    _note: '线上 shipping_rules 真实值快照；由 check-shipping-rules.cjs --update-snapshot 生成。代码默认值改了而云端没改时，本文件会与代码对不上 → 守卫红。',
    ruleId: doc.ruleId || '',
    name: doc.name || '',
    status: doc.status || '',
    priority: Number(doc.priority || 0),
    defaultCarrier: doc.defaultCarrier || '',
    flatFee: Number(doc.flatFee),
    freeShippingThreshold: Number(doc.freeShippingThreshold != null ? doc.freeShippingThreshold : doc.specimenFreeThreshold),
    chargedCraftTypes: Array.isArray(doc.chargedCraftTypes) ? doc.chargedCraftTypes.slice() : null,
    // 两档（裁决 48）：其它类型的门槛与费率，必须与代码默认值一致
    accessoryFreeThreshold: Number(doc.accessoryFreeThreshold),
    accessoryFlatFee: Number(
      doc.accessoryFlatFee != null ? doc.accessoryFlatFee : doc.accessoryShippingFee
    ),
    // 兼容镜像
    specimenFreeThreshold: Number(doc.specimenFreeThreshold),
    mixCartStrategy: doc.mixCartStrategy || '',
    freeShippingCampaign: {
      enabled: !!(doc.freeShippingCampaign && doc.freeShippingCampaign.enabled),
      label: (doc.freeShippingCampaign && doc.freeShippingCampaign.label) || ''
    }
  }
}

/* ------------------------------------------------------------------ *
 * C. 装裱方式分类表（3 份副本）
 * ------------------------------------------------------------------ */

function extractCraftPairs(src) {
  const m = src.match(/const CRAFT_TYPE_OPTIONS = \[([\s\S]*?)\n\]/)
  if (!m) return null
  const pairs = []
  const re = /\{\s*value:\s*'([^']+)',\s*label:\s*'([^']+)'\s*\}/g
  let x
  while ((x = re.exec(m[1]))) pairs.push({ key: x[1], labels: [x[2]] })
  return pairs
}

function extractCraftValues(src) {
  const m = src.match(/const CRAFT_VALUES = \{([\s\S]*?)\n\}/)
  if (!m) return null
  const pairs = []
  const re = /(\w+):\s*\[([^\]]*)\]/g
  let x
  while ((x = re.exec(m[1]))) {
    const labels = x[2]
      .split(',')
      .map((s) => s.trim().replace(/^'/, '').replace(/'$/, ''))
      .filter(Boolean)
    pairs.push({ key: x[1], labels })
  }
  return pairs
}

/* ------------------------------------------------------------------ *
 * D. 试算矩阵
 * ------------------------------------------------------------------ */

const P = (craftType, extra) => Object.assign({
  // 刻意用 categoryType='specimen' + 标题含「标本」：
  // 这两样在旧实现里都会把商品判成收费类。若 craftType 判定被放到 categoryType 短路之后
  // （or 又回到标题正则），下面「未标注」用例会立刻变红。
  categoryType: 'specimen',
  title: '某件标本',
  craftType
}, extra || {})

const MATRIX = [
  { name: '¥250 相框', amount: 250, items: [P('frame')], expect: 18 },
  { name: '¥250 相框 + ¥60 挂件（全场 ¥310）', amount: 310, items: [P('frame'), P('accessory')], expect: 0 },
  { name: '¥320 相框', amount: 320, items: [P('frame')], expect: 0 },
  { name: '¥320 挂件', amount: 320, items: [P('accessory')], expect: 0 },
  { name: '¥250 挂件', amount: 250, items: [P('accessory')], expect: 0 },
  { name: '¥250 未标注 craftType', amount: 250, items: [P('')], expect: 0 },
  { name: '¥298 相框（差 1 元）', amount: 298, items: [P('frame')], expect: 18 },
  { name: '¥299 相框（刚好满）', amount: 299, items: [P('frame')], expect: 0 },
  // 圆柱形/圆形玻璃罩必须与方形一样收费（只勾一个就漏收的坑）
  { name: '¥250 圆形玻璃罩', amount: 250, items: [P('cloche_round')], expect: 18 },
  { name: '¥250 圆柱形玻璃罩', amount: 250, items: [P('cloche_cylinder')], expect: 18 },
  { name: '¥250 方形玻璃罩', amount: 250, items: [P('cloche')], expect: 18 },
  { name: '¥250 造景', amount: 250, items: [P('diorama')], expect: 0 },
  { name: '¥250 蝶翅画', amount: 250, items: [P('wing_art')], expect: 0 },
  { name: '¥250 冰箱贴', amount: 250, items: [P('magnet')], expect: 0 },
  { name: '¥250 其它', amount: 250, items: [P('other')], expect: 0 },
  // 显式 shippingKind 覆盖仍然优先（人工标注）
  { name: '¥250 显式标注为藏品的挂件', amount: 250, items: [P('accessory', { shippingKind: 'specimen' })], expect: 18 },
  { name: '¥250 显式标注为饰品的相框', amount: 250, items: [P('frame', { shippingKind: 'accessory' })], expect: 0 },
  // —— 裁决 48：其它类型那一档（满 ¥39 包邮，未满收 ¥10）——
  { name: '¥38 挂件（差 1 元到 ¥39）', amount: 38, items: [P('accessory')], expect: 10 },
  { name: '¥39 挂件（刚好满 ¥39）', amount: 39, items: [P('accessory')], expect: 0 },
  { name: '¥20 未标注 craftType（其它档）', amount: 20, items: [P('')], expect: 10 },
  { name: '¥39 未标注 craftType（刚好满）', amount: 39, items: [P('')], expect: 0 },
  { name: '¥20 造景（其它档）', amount: 20, items: [P('diorama')], expect: 10 },
  { name: '¥10 相框（收费档，不满 ¥299 收 ¥18）', amount: 10, items: [P('frame')], expect: 18 },
  // ★混合车（产品负责人 2026-09-20 裁决 48-A）：只要含相框/玻璃罩，就按收费类那一档
  { name: '★混合 ¥10 相框 + ¥50 挂件（全场 ¥60，含收费类）', amount: 60, items: [P('frame'), P('accessory')], expect: 18 },
  { name: '★混合 ¥10 相框 + ¥300 挂件（全场 ¥310）', amount: 310, items: [P('frame'), P('accessory')], expect: 0 },
  { name: '★纯其它多件 ¥20 挂件 ×2（全场 ¥40）', amount: 40, items: [P('accessory'), P('accessory')], expect: 0 }
]

function runMatrix(mod) {
  const rows = MATRIX.map((row) => ({
    name: row.name,
    expect: row.expect,
    fee: mod.calcShipping(row.amount, row.items),
    threshold: mod.resolveThreshold(row.items),
    kind: mod.resolveShippingKind(row.items[0])
  }))
  return rows
}

/* ------------------------------------------------------------------ *
 * 主检查
 * ------------------------------------------------------------------ */

async function runChecks(paths) {
  // —— A. 4 份代码副本 ——
  let code
  try {
    code = collectCodeDefaults(paths)
  } catch (e) {
    check('4 份代码副本可加载', false, e.message)
    return
  }
  const { client, server, serverCfg, defaultsCfg } = code

  let erpCfg = null
  try {
    const mod = await import(pathToFileURL(paths.erp).href + `?t=${Date.now()}`)
    erpCfg = mod.getDefaultShippingConfig()
  } catch (e) {
    check('ERP 平行副本可加载', false, e.message)
  }

  check('收费标准默认清单非空', Array.isArray(client.chargedCraftTypes) && client.chargedCraftTypes.length > 0,
    JSON.stringify(client.chargedCraftTypes))
  check('收费标准默认清单 = 4 项（相框 + 三种玻璃罩）',
    jsonEq(defaultsCfg.chargedCraftTypes.slice().sort(), ['cloche', 'cloche_cylinder', 'cloche_round', 'frame']),
    JSON.stringify(defaultsCfg.chargedCraftTypes))

  const canon = keySnapshot(defaultsCfg)
  const copies = [
    ['C 端展示 config/shipping.js', keySnapshot(client)],
    ['服务端权威 makeOrder/shipping.js', keySnapshot(serverCfg)]
  ]
  if (erpCfg) copies.push(['ERP admin/src/utils/shippingRules.js', keySnapshot(erpCfg)])
  copies.forEach(([label, snap]) => {
    check(`关键字段与规则模型一致：${label}`, jsonEq(snap, canon),
      `期望 ${JSON.stringify(canon)}，实际 ${JSON.stringify(snap)}`)
  })

  // —— B. 云端文档快照 vs 代码默认值 ——
  if (!fs.existsSync(paths.snapshot)) {
    check(`存在云端文档快照 ${path.relative(ROOT, paths.snapshot)}`, false,
      '用 node miniprogram/scripts/check-shipping-rules.cjs --update-snapshot 生成')
  } else {
    const snap = JSON.parse(fs.readFileSync(paths.snapshot, 'utf8'))
    check('云端文档 flatFee 与代码默认值一致', Number(snap.flatFee) === canon.flatFee,
      `云端 ${snap.flatFee} vs 代码 ${canon.flatFee}`)
    check('云端文档 freeShippingThreshold 与代码默认值一致',
      Number(snap.freeShippingThreshold) === canon.freeShippingThreshold,
      `云端 ${snap.freeShippingThreshold} vs 代码 ${canon.freeShippingThreshold}`)
    check('云端文档 chargedCraftTypes 与代码默认值一致',
      Array.isArray(snap.chargedCraftTypes) && jsonEq(snap.chargedCraftTypes.slice().sort(), canon.chargedCraftTypes),
      `云端 ${JSON.stringify(snap.chargedCraftTypes)} vs 代码 ${JSON.stringify(canon.chargedCraftTypes)}`)
    check('云端文档旧字段镜像 specimenFreeThreshold = freeShippingThreshold',
      Number(snap.specimenFreeThreshold) === Number(snap.freeShippingThreshold),
      `specimenFreeThreshold=${snap.specimenFreeThreshold} / freeShippingThreshold=${snap.freeShippingThreshold}`)
    // 裁决 48：其它类型那一档（¥39 / ¥10）也必须与云端文档一致
    check('云端文档 accessoryFreeThreshold 与代码默认值一致',
      Number(snap.accessoryFreeThreshold) === canon.accessoryFreeThreshold,
      `云端 ${snap.accessoryFreeThreshold} vs 代码 ${canon.accessoryFreeThreshold}`)
    check('云端文档 accessoryFlatFee 与代码默认值一致',
      Number(snap.accessoryFlatFee) === canon.accessoryFlatFee,
      `云端 ${snap.accessoryFlatFee} vs 代码 ${canon.accessoryFlatFee}`)
  }

  // —— C. 装裱方式分类表 3 份副本 ——
  let canonPairs = null
  paths.taxonomies.forEach((file, idx) => {
    const rel = path.relative(ROOT, file)
    let src
    try {
      src = fs.readFileSync(file, 'utf8')
    } catch (e) {
      check(`可读 ${rel}`, false, e.message)
      return
    }
    const pairs = extractCraftPairs(src) || extractCraftValues(src)
    if (!pairs) {
      check(`${rel} 能解析出装裱方式表`, false, '既没有 CRAFT_TYPE_OPTIONS 也没有 CRAFT_VALUES')
      return
    }
    if (!canonPairs) {
      canonPairs = pairs
      passCount += 1
      return
    }
    const k1 = canonPairs.map((p) => p.key).sort()
    const k2 = pairs.map((p) => p.key).sort()
    check(`${rel} 的装裱方式 key 与其他副本一致`, jsonEq(k1, k2),
      `${k2.join(',')} vs ${k1.join(',')}`)
    // 每份副本里，「玻璃罩」三个 key 必须都在（少一个就漏收）
    ;['frame', 'cloche', 'cloche_round', 'cloche_cylinder'].forEach((k) => {
      check(`${rel} 含收费 key ${k}`, k2.indexOf(k) !== -1, k2.join(','))
    })
    // 中文名要能在别一份副本里找到（防「方形玻璃罩」被改成「玻璃罩」这类漂移）
    canonPairs.forEach((p) => {
      const other = pairs.find((q) => q.key === p.key)
      if (!other) return
      const overlap = p.labels.some((l) => other.labels.indexOf(l) !== -1)
      check(`${rel} 的 ${p.key} 中文名与基准有交集`, overlap,
        `基准 ${p.labels.join('/')} vs 本副本 ${other.labels.join('/')}`)
    })
  })

  // 收费清单里的 key 必须在分类表里存在
  if (canonPairs) {
    const known = canonPairs.map((p) => p.key)
    canon.chargedCraftTypes.forEach((k) => {
      check(`收费清单的 ${k} 在 productTaxonomy 中存在`, known.indexOf(k) !== -1, known.join(','))
    })
    // 中文名：运费规则里的 label 必须与分类表一致（摘要文案/界面都读它）
    const labelOf = {}
    canonPairs.forEach((p) => { labelOf[p.key] = p.labels[0] })
    const defaults = loadCjsModule(paths.defaults)
    canon.chargedCraftTypes.forEach((k) => {
      check(`运费规则的「${k}」中文名与分类表一致`,
        defaults.CRAFT_TYPE_LABELS[k] === labelOf[k],
        `${defaults.CRAFT_TYPE_LABELS[k]} vs ${labelOf[k]}`)
    })
  }

  // 界面不得另抄一份收费清单（必须引用唯一事实源）
  ;[
    ['小程序超管工作台', paths.managerPage, 'DEFAULT_CHARGED_CRAFT_TYPES'],
    ['ERP 运费规则页', paths.erpView, 'DEFAULT_CHARGED_CRAFT_TYPES']
  ].forEach(([label, file, needle]) => {
    let src = ''
    try {
      src = fs.readFileSync(file, 'utf8')
    } catch (e) {
      check(`可读 ${label}`, false, e.message)
      return
    }
    check(`${label}引用唯一事实源（不另抄收费清单）`, src.indexOf(needle) !== -1,
      `未找到 ${needle}`)
  })

  // —— D. 试算矩阵（真实执行） ——
  let clientRows = []
  let serverRows = []
  try {
    clientRows = runMatrix(client)
  } catch (e) {
    check('C 端试算可执行', false, e.message)
  }
  try {
    server.resetToDefaults()
    serverRows = runMatrix(server)
  } catch (e) {
    check('服务端试算可执行', false, e.message)
  }
  clientRows.forEach((row, i) => {
    check(`C 端试算：${row.name} = ¥${row.expect}`, row.fee === row.expect, `实际 ¥${row.fee}`)
    const s = serverRows[i]
    if (!s) return
    check(`服务端试算：${row.name} = ¥${row.expect}`, s.fee === row.expect, `实际 ¥${s.fee}`)
    check(`双端同价（含门槛）：${row.name}`, s.fee === row.fee && s.threshold === row.threshold,
      `服务端 ¥${s.fee}/${s.threshold} vs C 端 ¥${row.fee}/${row.threshold}`)
  })

  // 免邮凑单层的门槛口径（裁决 48：其它档 ¥39，不出现「满 ¥299」）
  try {
    const addon = loadCjsModule(path.join(ROOT, 'miniprogram', 'utils', 'checkoutAddon.js'))
    const otherCart = addon.computeFreeShipping({
      goodsAmount: 250,
      selectedItems: [P('accessory')],
      shipping: client
    })
    check('其它档购物车（¥250 ≥ ¥39）：凑单行按「已包邮（全场满 ¥39）」',
      otherCart && otherCart.reached === true && /¥39/.test(otherCart.detailText),
      otherCart ? otherCart.detailText : 'null')
    const otherShort = addon.computeFreeShipping({
      goodsAmount: 20,
      selectedItems: [P('accessory')],
      shipping: client
    })
    check('其它档购物车（¥20 < ¥39）：缺口 ¥19、运费 ¥10（不是 ¥18）',
      otherShort && otherShort.gap === 19 && otherShort.fee === 10,
      otherShort ? `gap=${otherShort.gap} fee=${otherShort.fee}` : 'null')
    const chargedCart = addon.computeFreeShipping({
      goodsAmount: 250,
      selectedItems: [P('frame')],
      shipping: client
    })
    check('含收费类购物车：凑单行给出 ¥49 缺口与 ¥18 运费',
      chargedCart && chargedCart.gap === 49 && chargedCart.fee === 18,
      chargedCart ? `gap=${chargedCart.gap} fee=${chargedCart.fee}` : 'null')
  } catch (e) {
    check('免邮凑单层口径可校验', false, e.message)
  }

  // —— E. 两档口径（裁决 48）：门槛 ¥299/¥18 与 ¥39/¥10，及其对免邮券省额的影响 ——
  try {
    // E1. 门槛矩阵：含相框/玻璃罩 → 299 档；其它（含未标注）→ 39 档
    const thrCases = [
      ['相框', [P('frame')], 299],
      ['方形玻璃罩', [P('cloche')], 299],
      ['圆柱形玻璃罩', [P('cloche_cylinder')], 299],
      ['挂件（其它档）', [P('accessory')], 39],
      ['未标注 craftType（其它档）', [P('')], 39],
      ['造景（其它档）', [P('diorama')], 39],
      ['★混合：相框 + 挂件 → 收费档', [P('frame'), P('accessory')], 299],
      ['显式 specimen 的挂件 → 收费档', [P('accessory', { shippingKind: 'specimen' })], 299],
      ['显式 accessory 的相框 → 其它档', [P('frame', { shippingKind: 'accessory' })], 39]
    ]
    thrCases.forEach(([name, ctx, want]) => {
      const got = typeof client.resolveThreshold === 'function' ? client.resolveThreshold(ctx) : 'NOT_A_FUNCTION'
      check(`门槛：${name} = ¥${want}`, got === want, `实际 ${got}`)
    })
    // 空/未知上下文沿用「收费档」口径（收费路径宁可多收不漏收，见 resolveThreshold 注释）
    check('门槛：空清单 → 收费档（¥299）', client.resolveThreshold([]) === 299, String(client.resolveThreshold([])))
    check('门槛：未知 null → 收费档（¥299）', client.resolveThreshold(null) === 299, String(client.resolveThreshold(null)))

    // E2. 费率矩阵：与门槛同一分派结果（否则「按 ¥39 判免邮、却按 ¥18 收」）
    const feeCases = [
      ['相框', [P('frame')], 18],
      ['挂件（其它档）', [P('accessory')], 10],
      ['未标注（其它档）', [P('')], 10],
      ['★混合车按收费档费率', [P('frame'), P('accessory')], 18],
      ['显式 accessory 的相框 → 其它档费率', [P('frame', { shippingKind: 'accessory' })], 10]
    ]
    feeCases.forEach(([name, ctx, want]) => {
      const got = typeof client.resolveFee === 'function' ? client.resolveFee(ctx) : 'NOT_A_FUNCTION'
      check(`费率：${name} = ¥${want}`, got === want, `实际 ${got}`)
    })

    // E3. 真跑两个券云函数：免邮券省额按「本单适用门槛」分档
    const snapDoc = JSON.parse(fs.readFileSync(paths.snapshot, 'utf8'))
    const fsCoupon = { _id: 'guard_fs_coupon', title: '免邮券', type: 'freeShipping', value: 0, minSpend: 0 }
    const couponCases = [
      ['¥250 相框（299 档，未满）', 250, 299, 18],
      ['¥300 相框（299 档，已满）', 300, 299, 0],
      ['¥20 挂件（39 档，未满 → 其它档费率 ¥10）', 20, 39, 10],
      ['¥250 挂件（39 档，已满 → 省 0）', 250, 39, 0],
      ['¥20 相框（299 档，未满 → ¥18）', 20, 299, 18],
      ['缺 shippingThreshold（未知 → 不报）', 20, undefined, 0],
      ['shippingThreshold = 0（规则本身免邮 → 不报）', 20, 0, 0]
    ]
    for (const [fnName, fnDir] of Object.entries(paths.couponFns)) {
      let mod = null
      try {
        mod = loadCloudFn(fnDir, snapDoc, [fsCoupon])
      } catch (e) {
        check(`${fnName} 可装载（打桩 wx-server-sdk）`, false, e.message)
        continue
      }
      for (const [label, amount, threshold, want] of couponCases) {
        const event = {
          productPrice: amount, totalPrice: amount,
          shippingBaseAmount: amount, originalPrice: amount
        }
        if (threshold !== undefined) event.shippingThreshold = threshold
        let got = null
        try {
          const res = await mod.main(event)
          got = res && res.bestCoupon ? Number(res.bestCoupon.savedAmount || 0) : 0
        } catch (e) {
          check(`${fnName}：${label}`, false, e.message)
          continue
        }
        check(`${fnName}：${label} → 免邮券省 ¥${want}`, got === want, `实际 ¥${got}`)
      }
    }

    // E4. 三个调用点都必须把「本单适用门槛」传下去（漏一处就让省额回到虚高/虚低）
    const wiring = [
      ['detail', 'getProductCoupons', 'shippingConfig.resolveThreshold(this.data.product)'],
      ['confirm', 'getBestCoupon', 'shippingConfig.resolveThreshold(this.data.items)'],
      ['cart', 'getBestCoupon', 'shippingConfig.resolveThreshold(']
    ]
    for (const [key, fnName, needle] of wiring) {
      const file = paths.callSites[key]
      let src = ''
      try {
        src = fs.readFileSync(file, 'utf8')
      } catch (e) {
        check(`调用点可读：${key}`, false, e.message)
        continue
      }
      const at = src.indexOf(`name: '${fnName}'`)
      const region = at >= 0 ? src.slice(at, at + 1500) : ''
      check(`调用点 ${key} 调 ${fnName} 时传了 shippingThreshold`,
        at >= 0 && region.includes('shippingThreshold:') && region.includes(needle),
        at < 0 ? '找不到该调用点' : `参数里缺少 shippingThreshold / ${needle}`)
    }
    // E5. 档位判定与**文案**必须与费率同档
    // 2026-09-20 真机截图抓到的回归：其它档商品的说明写成「全场满 ¥299 免邮，否则 ¥18」，
    // 而实际收 ¥10 —— 根因是 resolveOrderKind 用「门槛 > 0」判档（裁决 48 起两档门槛都非零）。
    const tierCases = [
      ['相框（收费档）', [P('frame')], 'specimen', 299, 18],
      ['挂件（其它档）', [P('accessory')], 'accessory', 39, 10],
      ['未标注（其它档）', [P('')], 'accessory', 39, 10],
      ['显式 accessory 的相框（其它档）', [P('frame', { shippingKind: 'accessory' })], 'accessory', 39, 10],
      ['显式 specimen 的挂件（收费档）', [P('accessory', { shippingKind: 'specimen' })], 'specimen', 299, 18]
    ]
    tierCases.forEach(([name, ctx, kind, thr, fee]) => {
      const gotKind = typeof client.resolveOrderKind === 'function' ? client.resolveOrderKind(ctx) : 'NOT_A_FUNCTION'
      check(`档位判定：${name} = ${kind}`, gotKind === kind,
        `实际 ${gotKind}（判据不能写成"门槛 > 0"：裁决 48 起两档门槛都非零）`)
      const text = typeof client.getRuleText === 'function' ? String(client.getRuleText(ctx)) : ''
      const sameTier = text.includes(`¥${thr}`) && text.includes(`¥${fee}`) && client.resolveFee(ctx) === fee
      const noCrossTier = kind !== 'accessory' || (!text.includes('299') && !text.includes('18'))
      check(`说明文案与费率同档：${name}（¥${thr} 免邮 / 否则 ¥${fee}）`, sameTier && noCrossTier,
        `${text} ｜ 费率 ¥${client.resolveFee(ctx)}`)
      // 前缀：顾客侧用**短标签**（2026-09-20 产品负责人：枚举四个装裱方式会把「说明」行挤爆），
      // 但**不得**回到含糊的「全场」（那会让顾客以为门槛是对整单任意商品）
      const wantPrefix = kind === 'accessory' ? '其它类型' : '标本框'
      const noLongEnum = kind !== 'specimen' || !text.includes('方形玻璃罩')
      check(`说明文案用短标签且不溢出：${name}`,
        text.includes('商品满') && text.includes(wantPrefix) && !text.includes('全场') && noLongEnum,
        `${text}（应含「${wantPrefix}…商品满」、不得出现「全场」或长枚举）`)
    })
    check('顾客侧短标签是一个常量（不在页面里内联）',
      typeof client.CHARGED_GROUP_LABEL === 'string' && client.CHARGED_GROUP_LABEL.indexOf('/') > 0,
      String(client.CHARGED_GROUP_LABEL))
    try {
      const confirmSrc = fs.readFileSync(paths.callSites.confirm, 'utf8')
      check('确认页兜底文案也用同一个短标签常量',
        /CHARGED_GROUP_LABEL/.test(confirmSrc) && !/chargedCraftTypesLabel\(\)/.test(confirmSrc),
        '确认页兜底文案应引用 shippingConfig.CHARGED_GROUP_LABEL')
    } catch (e) {
      check('确认页可读（短标签同源）', false, e.message)
    }
    check('说明文案：无上下文时两档都要交代',
      (() => { const t = String(client.getRuleText()); return t.includes('299') && t.includes('39') })(),
      String(client.getRuleText()))

  } catch (e) {
    check('两档口径可校验', false, e.message)
  }
}

/* ------------------------------------------------------------------ *
 * 自检
 * ------------------------------------------------------------------ */

function mirror(paths, tmp) {
  const out = {
    client: path.join(tmp, 'client.js'),
    server: path.join(tmp, 'server.js'),
    defaults: path.join(tmp, 'defaults.js'),
    erp: path.join(tmp, 'erp.mjs'),
    managerPage: path.join(tmp, 'managerPage.js'),
    erpView: path.join(tmp, 'erpView.vue'),
    snapshot: path.join(tmp, 'snapshot.json'),
    taxonomies: paths.taxonomies.map((_, i) => path.join(tmp, `tax${i}.js`))
  }
  ;[
    [paths.client, out.client],
    [paths.server, out.server],
    [paths.defaults, out.defaults],
    [paths.erp, out.erp],
    [paths.managerPage, out.managerPage],
    [paths.erpView, out.erpView],
    [paths.snapshot, out.snapshot]
  ].forEach(([from, to]) => {
    fs.copyFileSync(from, to)
  })
  paths.taxonomies.forEach((from, i) => fs.copyFileSync(from, out.taxonomies[i]))
  // E 节要真跑云函数 + 读三个调用点 → 目录整份镜像（只有几个小文件，无 node_modules）
  out.couponFns = {}
  for (const [k, dir] of Object.entries(paths.couponFns)) {
    const dst = path.join(tmp, 'fn', k)
    fs.cpSync(dir, dst, { recursive: true })
    out.couponFns[k] = dst
  }
  out.callSites = {}
  for (const [k, f] of Object.entries(paths.callSites)) {
    const dst = path.join(tmp, `call-${k}.js`)
    fs.copyFileSync(f, dst)
    out.callSites[k] = dst
  }
  return out
}

async function runSelfTest(paths) {
  console.log('自检：确认检查在「代码副本 / 云端快照 / 分类表 / 判定位置」被改坏时确实会失败\n')
  const cases = [
    ['规则模型门槛被改回 500（云端 299 就不再生效）', (p) => {
      patch(p.defaults, (s) => s.replace('freeShippingThreshold: 299,', 'freeShippingThreshold: 500,'))
    }],
    ['云端快照少一个收费 key（cloche_round 漏收）', (p) => {
      const snap = JSON.parse(fs.readFileSync(p.snapshot, 'utf8'))
      snap.chargedCraftTypes = ['frame', 'cloche', 'cloche_cylinder']
      fs.writeFileSync(p.snapshot, JSON.stringify(snap, null, 2))
    }],
    ['craftType 判定被放回 categoryType 短路之后（未标注会误判收费）', (p) => {
      patch(p.server, (s) => s.replace(
        '  return isChargedCraftType(product.craftType) ? SHIPPING_KIND.SPECIMEN : SHIPPING_KIND.ACCESSORY',
        "  if (product.categoryType === 'specimen' || product.categoryType === 'display') return SHIPPING_KIND.SPECIMEN\n  return SHIPPING_KIND.ACCESSORY"
      ))
    }],
    ['C 端与服务端口径分叉（C 端仍用 98 门槛）', (p) => {
      patch(p.client, (s) => s.replace('  freeShippingThreshold: 299,', '  freeShippingThreshold: 98,'))
    }],
    ['分类表副本被改中文名（方形玻璃罩 → 玻璃罩）', (p) => {
      patch(p.taxonomies[1], (s) => s.replace("label: '方形玻璃罩'", "label: '玻璃罩'"))
    }],
    ['超管界面把收费清单抄成硬编码（不再引用唯一事实源）', (p) => {
      patch(p.managerPage, (s) => s.replace(/DEFAULT_CHARGED_CRAFT_TYPES/g, "['frame', 'cloche']"))
    }],
    // E 节的三条回归：文案/档位判定与免邮券省额，都必须能被拦下
    ['文案退回"全场满 ¥X 免邮"（2026-09-20 产品负责人指出的误会来源）', (p) => {
      patch(p.client, (s) => s.replace(
        'return `${carrier} · ${charged}类商品满 ¥${free} 免邮，否则运费 ¥${fee}`',
        'return `${carrier} · 全场满 ¥${free} 免邮，否则运费 ¥${fee}`'
      ))
    }],
    ['档位判据退回"门槛 > 0"（其它档商品的说明写成 ¥299/¥18 —— 2026-09-20 真机截图的原形态）', (p) => {
      patch(p.client, (s) => s.replace(
        'function resolveOrderKind(context) {\n  if (context == null) return SHIPPING_KIND.SPECIMEN',
        'function resolveOrderKind(context) {\n  return resolveThreshold(context) > 0 ? SHIPPING_KIND.SPECIMEN : SHIPPING_KIND.ACCESSORY\n  if (context == null) return SHIPPING_KIND.SPECIMEN'
      ))
    }],
    ['顾客侧文案退回长枚举（「说明」行会溢出 —— 2026-09-20 真机截图）', (p) => {
      patch(p.client, (s) => s.replace('  const charged = CHARGED_GROUP_LABEL', '  const charged = chargedCraftTypesLabel()'))
    }],
    ['免邮券省额的门槛闸被删（门槛未知也敢报省额）', (p) => {
      Object.values(p.couponFns).forEach((dir) => {
        patch(path.join(dir, 'index.js'), (s) => s.replace('  if (!Number.isFinite(threshold) || threshold <= 0) return 0\n', ''))
      })
    }],
    ['详情页不再把 shippingThreshold 传给券云函数（漏一处即回到按金额猜）', (p) => {
      patch(p.callSites.detail, (s) => s.replace('shippingThreshold:', 'shippingThresholdOff:'))
    }]
  ]
  let allDetected = true
  for (const [label, mutate] of cases) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-selftest-'))
    try {
      const p = mirror(paths, tmp)
      mutate(p)
      failures.length = 0
      warnings.length = 0
      try {
        await runChecks(p)
      } catch (e) {
        failures.push(`执行异常：${e.message}`)
      }
      const detected = failures.length > 0
      allDetected = allDetected && detected
      console.log(`${detected ? '✓' : '✗'} ${label} → ${detected ? '已检出' : '【漏检】'}`)
      if (detected) failures.slice(0, 1).forEach((f) => console.log(`    · ${f}`))
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }
  console.log()
  if (!allDetected) {
    console.error('自检失败：存在漏检用例，检查本身不可信。')
    process.exit(1)
  }
  console.log('自检通过：全部破坏用例均被检出。\n')
}

function patch(file, mutate) {
  fs.writeFileSync(file, mutate(fs.readFileSync(file, 'utf8')), 'utf8')
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */

;(async () => {
  const argv = process.argv.slice(2)
  const paths = defaultPaths()

  if (argv.includes('--update-snapshot')) {
    const doc = readLiveDoc()
    const snap = snapshotFromDoc(doc)
    fs.writeFileSync(paths.snapshot, JSON.stringify(snap, null, 2) + '\n', 'utf8')
    console.log(`已刷新云端快照 → ${path.relative(ROOT, paths.snapshot)}`)
    console.log(JSON.stringify(snap, null, 2))
    return
  }

  if (argv.includes('--live')) {
    const doc = readLiveDoc()
    const snap = snapshotFromDoc(doc)
    const onDisk = JSON.parse(fs.readFileSync(paths.snapshot, 'utf8'))
    const same = jsonEq(snap.chargedCraftTypes, onDisk.chargedCraftTypes)
      && Number(snap.flatFee) === Number(onDisk.flatFee)
      && Number(snap.freeShippingThreshold) === Number(onDisk.freeShippingThreshold)
    console.log(`线上文档实测：flatFee=${snap.flatFee} freeShippingThreshold=${snap.freeShippingThreshold} chargedCraftTypes=${JSON.stringify(snap.chargedCraftTypes)}`)
    if (!same) {
      console.error('\n✗ 线上文档与仓库快照不一致（用 --update-snapshot 刷新，并确认这次变更是有意的）')
      process.exit(1)
    }
    console.log('✓ 线上文档与仓库快照一致')
    return
  }

  if (argv.includes('--selftest')) {
    await runSelfTest(paths)
  }

  failures.length = 0
  warnings.length = 0
  passCount = 0
  await runChecks(paths)

  console.log(`运费规则 v3 守卫：${passCount} 项通过，${failures.length} 项失败`)
  if (warnings.length) {
    console.log('\n提示：')
    warnings.forEach((w) => console.log(`  ⚠ ${w}`))
  }
  if (failures.length) {
    console.error('\n失败明细：')
    failures.forEach((f) => console.error(`  ✗ ${f}`))
    process.exit(1)
  }
  console.log('全部通过：4 份代码副本 / 云端文档快照 / 装裱方式分类表一致（两档：¥299·¥18 与 ¥39·¥10），')
  console.log('          试算矩阵双端同价；免邮券省额按「本单适用门槛」分档（两个券云函数真跑验证）。')
})()
