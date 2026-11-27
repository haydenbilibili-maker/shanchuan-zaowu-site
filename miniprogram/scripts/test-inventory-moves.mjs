#!/usr/bin/env node
/**
 * test:inventory-moves —— 出入库流水（2026-11-27 产品负责人拍板「库存以出入库流水为准」）
 *
 * **真跑**四个云函数真源（内存库 + 桩 wx-server-sdk / staffGuard），验证：
 *   M1 盘点：差异预览只读；写入不再删表重建 —— 差额记 count 流水、台账原子累加、飞书行与唯一件不被误删；
 *      首次触达补 opening，流水合计 = 台账；同一次盘点重放不重复记
 *   M2 唯一件：序列号登记入库、重复在库拒绝；手工调整必须写原因
 *   M3 采购：工作室标本单到「已入库」记原材料 in 流水；工具单 / 门店单不入；来回切状态只入一次
 *   M4 出货：发货扣成品（按 inventoryRecordId / 唯一件 serialNo），对不上的行不臆造台账而是点名；
 *      已发出的单作废 → 回库；草稿单删除不动库存
 *   M5 运费：出货单填运费 → 采购账一条「待确认」草稿（不计预算）；改运费跟着改；确认后计入并回写出货单
 *   M6 共享模块四份副本逐字节一致；集合三处同步（COLLECTIONS / rules / schema）
 *
 * 用法：node miniprogram/scripts/test-inventory-moves.mjs [--selftest]
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const ROOT = resolve(MP, '..')
const CF = join(MP, 'cloudfunctions')
const FNS = ['manageStudioInventory', 'manageStudioRawInventory', 'managePurchaseOrder', 'manageStoreShipment']

let INJECT = null // { file, find, replace }
const readSrc = (abs) => {
  let s = readFileSync(abs, 'utf8')
  if (INJECT && abs === INJECT.file) {
    if (!s.includes(INJECT.find)) throw new Error('注入锚点失效：' + INJECT.name)
    s = s.replace(INJECT.find, INJECT.replace)
  }
  return s
}

const QUIET = { log() {}, warn() {}, error() {}, info() {} }
function loadCjs(absPath, mocks, cache) {
  if (cache.has(absPath)) return cache.get(absPath).exports
  const mod = { exports: {} }
  cache.set(absPath, mod)
  const req = (id) => {
    if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id]
    if (id === 'crypto') return requireNode('crypto')
    for (const c of [resolve(dirname(absPath), id), `${resolve(dirname(absPath), id)}.js`]) {
      if (existsSync(c) && statSync(c).isFile()) return loadCjs(c, mocks, cache)
    }
    throw new Error('require 解析失败：' + id + ' @ ' + absPath)
  }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', 'console', readSrc(absPath))(mod, mod.exports, req, QUIET)
  return mod.exports
}
import { createRequire } from 'node:module'
const requireNode = createRequire(import.meta.url)

/* ── 内存库：主键冲突、条件查询、inc、orderBy desc ── */
function makeDb(seed = {}) {
  const cols = {}
  let seq = 0
  const col = (n) => (cols[n] = cols[n] || new Map())
  for (const [n, rows] of Object.entries(seed)) rows.forEach((r) => col(n).set(r._id, JSON.parse(JSON.stringify(r))))
  const op = (name) => (v) => ({ $op: name, v })
  const cmd = new Proxy({}, { get: (o, k) => op(k) })
  const test = (val, c) => {
    if (c && typeof c === 'object' && c.$op) {
      switch (c.$op) {
        case 'neq': return val !== c.v
        case 'in': return c.v.includes(val)
        case 'exists': return c.v ? val !== undefined : val === undefined
        case 'gte': return val >= c.v
        default: return false
      }
    }
    if (c && typeof c === 'object' && c.$regex) return new RegExp(c.$regex, c.$opts).test(String(val || ''))
    return val === c
  }
  const match = (doc, cond) => !cond || Object.entries(cond).every(([k, c]) => test(doc[k], c))
  const apply = (doc, data) => {
    for (const [k, v] of Object.entries(data)) {
      if (k === '_id') continue
      if (v && v.$op === 'inc') doc[k] = (Number(doc[k]) || 0) + v.v
      else doc[k] = v
    }
  }
  const db = {
    cols,
    command: cmd,
    serverDate: () => Date.now(),
    RegExp: ({ regexp, options }) => ({ $regex: regexp, $opts: options }),
    createCollection: async () => ({}),
    collection(n) {
      const q = (cond, order, lim) => {
        const rows = () => {
          let list = [...col(n).values()].filter((d) => match(d, cond)).map((d) => ({ ...d }))
          if (order) list.sort((a, b) => (order[1] === 'desc' ? -1 : 1) * ((a[order[0]] || 0) - (b[order[0]] || 0)))
          return lim ? list.slice(0, lim) : list
        }
        const chain = {
          where: (c) => q(c, order, lim),
          orderBy: (f, d) => q(cond, [f, d], lim),
          limit: (l) => q(cond, order, l),
          skip: () => chain,
          field: () => chain,
          get: async () => ({ data: rows() }),
          count: async () => ({ total: rows().length }),
          update: async ({ data }) => {
            let updated = 0
            for (const d of col(n).values()) if (match(d, cond)) { apply(d, data); updated += 1 }
            return { stats: { updated } }
          },
          doc: (id) => ({
            get: async () => {
              const d = col(n).get(id)
              if (!d) throw new Error('document.get:fail document not exists')
              return { data: { ...d } }
            },
            update: async ({ data }) => {
              const d = col(n).get(id)
              if (!d) throw new Error('document.update:fail document not exists')
              apply(d, data)
              return { stats: { updated: 1 } }
            },
            remove: async () => { col(n).delete(id); return { stats: { removed: 1 } } }
          }),
          add: async ({ data }) => {
            const _id = data._id || `${n}_${++seq}`
            if (col(n).has(_id)) throw new Error('E11000 duplicate key error')
            col(n).set(_id, { ...data, _id })
            return { _id }
          }
        }
        return chain
      }
      return q(null, null, 0)
    }
  }
  return db
}

const ACTOR = { openid: 'u1', name: '测试员', superAdmin: true, role: 'super_admin', roles: ['super_admin'], storeIds: [] }
function loadFns(db) {
  const sdk = { DYNAMIC_CURRENT_ENV: 'env', init() {}, database: () => db, getWXContext: () => ({ OPENID: 'u1' }), callFunction: async () => ({ result: { success: true } }), openapi: { subscribeMessage: { send: async () => ({}) } } }
  const out = {}
  for (const f of FNS) {
    const cache = new Map()
    const realGuard = loadCjs(join(CF, f, 'staffGuard.js'), { 'wx-server-sdk': sdk }, cache)
    const guard = Object.assign({}, realGuard, { assertStaff: async () => ({ ok: true, actor: ACTOR }) })
    out[f] = loadCjs(join(CF, f, 'index.js'), { 'wx-server-sdk': sdk, './staffGuard': guard }, cache).main
  }
  return out
}
const res = (r) => (r && r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? Object.assign({}, r, r.data) : r)

async function runChecks() {
  const fails = []
  const ok = (name, cond, detail) => { if (!cond) fails.push(name + (detail ? `（${detail}）` : '')) }
  const rows = (db, n) => [...(db.cols[n] || new Map()).values()]
  const sumMoves = (db, ledgerId) => rows(db, 'inventory_moves').filter((m) => m.ledgerId === ledgerId && m.applied).reduce((n, m) => n + m.delta, 0)

  /* ── M1 盘点 ── */
  {
    const db = makeDb({ studio_inventory: [
      { _id: 'a', itemName: '蓝闪蝶', skuName: '蓝闪蝶', framingSpec: '', qty: 3, location: 'studio', inventoryDate: '2026-11-20', groupName: '' },
      { _id: 'b', itemName: '光明女神', skuName: '光明女神', framingSpec: '', qty: 2, location: 'studio', feishuRecordId: 'rec1', sourceLabel: '飞书成品库存' },
      { _id: 'u', itemName: '孤品甲', skuName: '孤品甲', framingSpec: '', qty: 1, location: 'studio', serialNo: 'SN-1' }
    ] })
    const fn = loadFns(db).manageStudioInventory
    const text = '群公告\n工作室库存\n2026年11月27日\n蓝闪蝶 5个\n新品甲 1个'
    const before = JSON.stringify(rows(db, 'studio_inventory'))
    const diff = res(await fn({ action: 'diffSnapshot', text }))
    ok('M1-1 差异预览只读：新增 1 / 清零 1 / 改数 1，点出飞书行会被清零，唯一件不参与',
      diff.success && diff.counts.added === 1 && diff.counts.cleared === 1 && diff.counts.changed === 1 && diff.counts.feishuCleared === 1 && diff.uniqueKept === 1 &&
      JSON.stringify(rows(db, 'studio_inventory')) === before && !rows(db, 'inventory_moves').length, JSON.stringify(diff.counts))
    const c = res(await fn({ action: 'commitSnapshot', text }))
    const inv = rows(db, 'studio_inventory')
    const get = (id) => inv.find((r) => r._id === id)
    const added = inv.find((r) => r.itemName === '新品甲')
    ok('M1-2 写入不删表：原行仍在（清零而不是删除），唯一件原样，新品建行；数量 = 盘点值',
      c.success && get('a') && get('a').qty === 5 && get('b') && get('b').qty === 0 && get('u') && get('u').qty === 1 && added && added.qty === 1 && inv.length === 4,
      JSON.stringify(inv.map((r) => [r.itemName, r.qty])))
    const mv = rows(db, 'inventory_moves')
    ok('M1-3 流水：首次触达补 opening；count 流水记差额且带快照引用；流水合计 = 台账',
      mv.filter((m) => m.type === 'opening').length === 2 && mv.filter((m) => m.type === 'count').length === 3 &&
      mv.every((m) => m.type !== 'count' || (m.refType === 'snapshot' && m.refId === c.snapshotId)) &&
      sumMoves(db, 'a') === 5 && sumMoves(db, 'b') === 0 && sumMoves(db, added._id) === 1)
    ok('M1-4 盘点元信息跟着走：被清零的行也更新盘点日（列表按当前日取数不串日）', get('b').inventoryDate === '2026-11-27' && get('a').inventoryDate === '2026-11-27')
    const list = res(await fn({ action: 'list' }))
    ok('M1-5 列表默认不显示 0 的行；showZero 才显示', list.success && !list.list.some((r) => r.itemName === '光明女神') &&
      res(await fn({ action: 'list', showZero: true })).list.some((r) => r.itemName === '光明女神'))
    // 飞书同步：观测值 → 差额 count 流水，其它字段照旧
    const fs = res(await fn({ action: 'upsertFromFeishu', items: [{ feishuRecordId: 'rec1', 物品名称: '光明女神', 数量: 4 }] }))
    ok('M1-6 飞书同步改数量走 count 流水（+4），不直接覆盖', fs.success && get('b') && rows(db, 'studio_inventory').find((r) => r._id === 'b').qty === 4 &&
      rows(db, 'inventory_moves').some((m) => m.refType === 'feishu' && m.delta === 4 && m.ledgerId === 'b'))
  }

  /* ── M1-7 幂等：同一 idemKey 记两次只生效一次 ── */
  {
    const db = makeDb({ studio_inventory: [{ _id: 'a', itemName: '蓝闪蝶', skuName: '蓝闪蝶', framingSpec: '', qty: 3, location: 'studio' }] })
    const mv = loadCjs(join(CF, 'manageStudioInventory', 'inventoryMoves.js'), {}, new Map())
    const m = { ledger: 'finished', type: 'out', delta: -1, ledgerId: 'a', itemName: '蓝闪蝶', refType: 'shipment', refId: 's1', idemKey: 'ship-out:s1:0:x' }
    const r1 = await mv.applyMove(db, Object.assign({}, m))
    const r2 = await mv.applyMove(db, Object.assign({}, m))
    ok('M1-7 幂等：同一单据同一行重复触发只扣一次（第二次返回 duplicate）', r1.ok && !r1.duplicate && r2.duplicate === true &&
      rows(db, 'studio_inventory')[0].qty === 2 && rows(db, 'inventory_moves').filter((x) => x.type === 'out').length === 1)
  }

  /* ── M2 唯一件 / 调整 ── */
  {
    const db = makeDb({ studio_inventory: [{ _id: 'a', itemName: '蓝闪蝶', skuName: '蓝闪蝶', framingSpec: '', qty: 3, location: 'studio' }] })
    const fn = loadFns(db).manageStudioInventory
    const r1 = res(await fn({ action: 'registerUnique', itemName: '光明女神闪蝶', serialNo: 'sn-0001' }))
    const r2 = res(await fn({ action: 'registerUnique', itemName: '光明女神闪蝶', serialNo: 'SN-0001' }))
    const u = rows(db, 'studio_inventory').find((r) => r.serialNo === 'SN-0001')
    ok('M2-1 唯一件：序列号大写入库 qty=1、记 in 流水；同号在库再登记被拒', r1.success && u && u.qty === 1 && !r2.success &&
      rows(db, 'inventory_moves').some((m) => m.type === 'in' && m.serialNo === 'SN-0001'))
    const a0 = res(await fn({ action: 'adjust', ledgerId: 'a', delta: -1, reason: '' }))
    const a1 = res(await fn({ action: 'adjust', ledgerId: 'a', delta: -1, reason: '运输破损' }))
    ok('M2-2 手工调整必须写原因；写了才记 adjust 流水并扣数', !a0.success && a1.success && rows(db, 'studio_inventory').find((r) => r._id === 'a').qty === 2 &&
      rows(db, 'inventory_moves').some((m) => m.type === 'adjust' && m.note === '运输破损'))
    const v = res(await fn({ action: 'verifyLedger', ledgerId: 'a' }))
    ok('M2-3 核对：流水合计 = 台账（diff 0）', v.success && v.opened && v.diff === 0 && v.qty === 2, JSON.stringify(v))
  }

  /* ── M3 采购入库 ── */
  {
    const db = makeDb({ studio_raw_inventory: [{ _id: 'r1', itemName: '玻璃罩', spec: '大', qty: 2, currentQty: 2, unitPrice: 10, deleted: false }] })
    const fn = loadFns(db).managePurchaseOrder
    const mk = async (o) => res(await fn({ action: 'create', item: Object.assign({ entityId: 'studio_specimen', qty: 5, unitPrice: 8, status: 'arrived' }, o) })).id
    const p1 = await mk({ itemName: '玻璃罩', spec: '大', category: '标本' })
    const p2 = await mk({ itemName: '镊子', category: '工具', budgetType: '工具采购' })
    const p3 = await mk({ itemName: '玻璃罩', spec: '大', category: '标本', entityId: 'store_xingchen' })
    const s1 = res(await fn({ action: 'setStatus', id: p1, status: 'stocked' }))
    await fn({ action: 'setStatus', id: p2, status: 'stocked' })
    await fn({ action: 'setStatus', id: p3, status: 'stocked' })
    await fn({ action: 'setStatus', id: p1, status: 'completed' })
    const raw = rows(db, 'studio_raw_inventory')
    const g = raw.find((r) => r._id === 'r1')
    ok('M3-1 工作室标本单到库 → 原材料 +5（按品名+规格并到已有行，入库累计同步）；返回给前端入库结果',
      s1.success && s1.stockIn && s1.stockIn.ok && g.qty === 7 && g.currentQty === 7 && g.inboundTotal === 5, JSON.stringify(g))
    ok('M3-2 工具单 / 门店单不入原材料；stocked → completed 不重复入库', raw.length === 1 &&
      rows(db, 'inventory_moves').filter((m) => m.refType === 'purchase').length === 1)
    const doc = rows(db, 'ops_purchases').find((r) => r._id === p1)
    ok('M3-3 采购单回写入库流水 id / 台账 id', doc.stockMoveId && doc.stockLedgerId === 'r1')
    // 飞书同步到「已入库」不触发（历史单）
    await fn({ action: 'upsertFromFeishu', items: [{ feishuRecordId: 'f1', 物品名称: '玻璃罩', 规格: '大', 数量: 3, 单价: 8, 状态: '已入库', 主体: '标本工作室', 分类: '标本' }] })
    ok('M3-4 飞书同步来的已入库单不入库（历史单早已在原材料表里）', rows(db, 'inventory_moves').filter((m) => m.refType === 'purchase').length === 1)
  }

  /* ── M4 出货出库 / 回库 + M5 运费 ── */
  {
    const db = makeDb({ studio_inventory: [
      { _id: 'a', itemName: '蓝闪蝶', skuName: '蓝闪蝶', framingSpec: '', qty: 3, location: 'studio' },
      { _id: 'u', itemName: '孤品甲', skuName: '孤品甲', framingSpec: '', qty: 1, location: 'studio', serialNo: 'SN-9' }
    ] })
    const all = loadFns(db)
    const fn = all.manageStoreShipment
    const created = res(await fn({ action: 'create', item: { storeId: 'store_xingchen', shipmentDate: '2026-11-27', status: 'draft', items: [
      { itemName: '蓝闪蝶', qty: 2, inventoryRecordId: 'a', unitPrice: 100 },
      { itemName: '孤品甲', qty: 1, serialNo: 'sn-9', unitPrice: 300 },
      { itemName: '不在库的东西', qty: 1, unitPrice: 10 }
    ] } }))
    ok('M4-0 草稿单不动库存', created.success && !rows(db, 'inventory_moves').length, created.msg)
    const id = created.id
    const s = res(await fn({ action: 'setStatus', id, status: 'shipped' }))
    const inv = rows(db, 'studio_inventory')
    ok('M4-1 发货扣成品：按 inventoryRecordId -2、唯一件按序列号 -1；对不上的行不建台账、点名返回',
      s.success && inv.find((r) => r._id === 'a').qty === 1 && inv.find((r) => r._id === 'u').qty === 0 && inv.length === 2 &&
      s.stock && s.stock.moved === 2 && s.stock.unlinked.length === 1, JSON.stringify(s.stock))
    await fn({ action: 'setStatus', id, status: 'received' })
    ok('M4-2 已发货 → 已签收不重复扣', rows(db, 'studio_inventory').find((r) => r._id === 'a').qty === 1 &&
      rows(db, 'inventory_moves').filter((m) => m.type === 'out').length === 2)
    const ship = rows(db, 'ops_shipments').find((r) => r._id === id)
    ok('M4-3 出货单回写出库时间与未关联行', ship.stockOutAt > 0 && ship.stockUnlinked.length === 1)
    const rm = res(await fn({ action: 'remove', id }))
    const inv2 = rows(db, 'studio_inventory')
    ok('M4-4 已发出的单作废 → 成品回库（唯一件回到 1）', rm.success && inv2.find((r) => r._id === 'a').qty === 3 && inv2.find((r) => r._id === 'u').qty === 1 &&
      rows(db, 'inventory_moves').filter((m) => m.type === 'return').length === 2)

    // M5 运费草稿
    const c2 = res(await fn({ action: 'create', item: { storeId: 'store_xingchen', shipmentDate: '2026-11-27', status: 'draft', freight: 18, expressCompany: '顺丰', items: [{ itemName: '蓝闪蝶', qty: 1, unitPrice: 100 }] } }))
    const draft = () => rows(db, 'ops_purchases').find((r) => r.refShipmentId === c2.id)
    ok('M5-1 填运费 → 采购账一条待确认草稿（物流运费 · 工作室 · 金额 18）', c2.freight && c2.freight.state === 'pending' && draft() &&
      draft().pendingConfirm === true && draft().amount === 18 && draft().budgetType === '物流运费' && draft().scope === 'studio')
    await fn({ action: 'update', id: c2.id, item: { storeId: 'store_xingchen', shipmentDate: '2026-11-27', status: 'draft', freight: 22 } })
    ok('M5-2 改运费：未确认的草稿跟着改金额，不新增第二条', draft().amount === 22 && rows(db, 'ops_purchases').filter((r) => r.refShipmentId === c2.id).length === 1)
    const dash0 = res(await all.managePurchaseOrder({ action: 'dashboard' }))
    const conf = res(await all.managePurchaseOrder({ action: 'confirmDraft', id: draft()._id }))
    const dash1 = res(await all.managePurchaseOrder({ action: 'dashboard' }))
    ok('M5-3 确认入账：草稿变已完成、回写出货单「已入账」；确认前不计预算、确认后计入',
      conf.success && draft().pendingConfirm === false && draft().status === 'completed' &&
      rows(db, 'ops_shipments').find((r) => r._id === c2.id).freightState === 'confirmed' &&
      Number(dash0.kpis && dash0.kpis.purchaseTotal) === 0 && Number(dash1.kpis && dash1.kpis.purchaseTotal) === 22,
      `${dash0.kpis && dash0.kpis.purchaseTotal} / ${dash1.kpis && dash1.kpis.purchaseTotal}`)
    const again = res(await all.managePurchaseOrder({ action: 'confirmDraft', id: draft()._id }))
    ok('M5-4 confirmDraft 只认待确认的运费草稿（不能借它跳过普通采购单状态机）', !again.success)
  }

  /* ── M6 结构 ── */
  const canon = readFileSync(join(CF, 'manageStudioInventory', 'inventoryMoves.js'), 'utf8')
  ok('M6-1 inventoryMoves.js 四份副本逐字节一致', FNS.every((f) => readFileSync(join(CF, f, 'inventoryMoves.js'), 'utf8') === canon))
  ok('M6-2 inventory_moves 三处同步：admin COLLECTIONS / rules（客户端全关）/ schema',
    /INVENTORY_MOVES: 'inventory_moves'/.test(readFileSync(join(ROOT, 'admin/src/cloud.js'), 'utf8')) &&
    /"read": false[\s\S]*"write": false/.test(readFileSync(join(ROOT, 'cloudbase/rules/inventory_moves.json'), 'utf8')) &&
    existsSync(join(ROOT, 'cloudbase/schema/inventory_moves.md')))
  return fails
}

const CASES = [
  { name: '盘点又回到删表重建', file: join(CF, 'manageStudioInventory/index.js'), find: "  const plan = moves.planCount('finished', existing, parsed.lines, { zeroMissing: true })\n  const rowsById", replace: "  await Promise.all(existing.map((d) => db.collection(COLLECTION).doc(d._id).remove()))\n  const plan = moves.planCount('finished', [], parsed.lines, { zeroMissing: true })\n  const rowsById" },
  { name: '盘点把唯一件也按品名清零', file: join(CF, 'manageStudioInventory/inventoryMoves.js'), find: '    if (!r || r.serialNo || r.deleted) return', replace: '    if (!r || r.deleted) return' },
  { name: '幂等失效（流水主键带时间戳）', file: join(CF, 'manageStudioInventory/inventoryMoves.js'), find: "  const id = moveId(move.idemKey)\n", replace: "  const id = moveId(move.idemKey + ':' + Math.random())\n" },
  { name: '不再懒开账', file: join(CF, 'manageStudioInventory/inventoryMoves.js'), find: '  if (row && !row.movesOpenedAt) {', replace: '  if (false) {' },
  { name: '调整不要求原因', file: join(CF, 'manageStudioInventory/index.js'), find: "  if (!reason) return fail('请写明调整原因（报损 / 更正 / 自用…）', 'BAD_PARAM')\n", replace: '' },
  { name: '工具采购也入原材料', file: join(CF, 'managePurchaseOrder/purchaseDefaults.js'), find: "  return d.category === '标本' || STOCK_IN_BUDGET_TYPES.indexOf(d.budgetType) !== -1", replace: '  return true' },
  { name: '采购不再入库', file: join(CF, 'managePurchaseOrder/index.js'), find: '  const stockIn = await stockInIfNeeded(id, prev, next, actor)\n  return ok(', replace: '  const stockIn = null\n  return ok(' },
  { name: '出货对不上的行臆造台账', file: join(CF, 'manageStoreShipment/index.js'), find: "    if (!row) { unlinked.push(`${it.itemName}${it.spec ? ' · ' + it.spec : ''}`); continue }\n", replace: '' },
  { name: '作废不回库', file: join(CF, 'manageStoreShipment/index.js'), find: "  const stock = await syncShipmentStock(id, prev, prev, actor, { removed: true })\n", replace: '  const stock = null\n' },
  { name: '运费草稿计入预算', file: join(CF, 'managePurchaseOrder/purchaseDashboard.js'), find: '  if (row.pendingConfirm === true) return false\n', replace: '' },
  { name: '运费改了草稿不跟', file: join(CF, 'manageStoreShipment/index.js'), find: '    if (Number(draft.amount) !== freight) {', replace: '    if (false) {' },
  { name: 'confirmDraft 不校验草稿', file: join(CF, 'managePurchaseOrder/index.js'), find: "  if (prev.pendingConfirm !== true) return fail('这张单不是待确认的运费草稿', 'NOT_DRAFT')\n", replace: '' }
]

if (process.argv.includes('--selftest')) {
  const base = await runChecks()
  if (base.length) { console.error('✗ 自检前提：真源须先通过\n  - ' + base.join('\n  - ')); process.exit(1) }
  let bad = 0
  for (const c of CASES) {
    INJECT = c
    let fails = []
    try { fails = await runChecks() } catch (e) { fails = [String(e.message || e)] }
    INJECT = null
    if (fails.length === 1 && /^注入锚点失效/.test(fails[0])) { console.error(`✗ 注入「${c.name}」→ ${fails[0]}`); bad += 1; continue }
    if (!fails.length) { console.error(`✗ 注入「${c.name}」→ 未检出`); bad += 1 }
  }
  if (bad) process.exit(1)
  console.log(`✓ test:inventory-moves 自检通过（${CASES.length} 条注入全部检出，内存副本不写盘）`)
} else {
  const fails = await runChecks()
  if (fails.length) {
    console.error('✗ 出入库流水不合格：')
    fails.forEach((f) => console.error('  - ' + f))
    process.exit(1)
  }
  console.log('✓ test:inventory-moves：盘点按差额记流水（不删表 / 唯一件不误伤 / 飞书走流水）· 唯一件与调整 · 采购到库入原材料（只一次 / 飞书不触发）· 出货扣库与作废回库（对不上点名不臆造）· 运费草稿待确认不计预算 · 副本与三处同步')
}
