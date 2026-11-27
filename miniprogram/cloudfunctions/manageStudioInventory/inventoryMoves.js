/**
 * 出入库流水（inventory_moves）—— 库存的**唯一事实**（2026-11-27 产品负责人拍板「以出入库流水为准」）
 *
 * 真共享模块：canonical = manageStudioInventory/inventoryMoves.js，
 * 副本在 manageStudioRawInventory / managePurchaseOrder / manageStoreShipment，逐字节一致（check:shared-modules）。
 *
 * 口径：
 *   · 每一次库存变化 = 一条流水（谁 / 何时 / 为什么 / 关联单据），台账（studio_inventory 成品、
 *     studio_raw_inventory 原料）只是流水的**累加结果**：台账 qty 用原子 `_.inc(delta)` 更新，不再整表覆盖；
 *   · 幂等：流水 `_id = 'mv_' + sha1(idemKey)`（主键天然唯一，不需要另建唯一索引；参数故意不叫 dedupeKey ——
 *     那个名字在本仓库专指「字段 + 唯一索引」的防重，见 check:dedupe-index-coverage），同一单据同一行重复触发只记一次（状态来回切也不会重复入/出库）；
 *   · 懒开账：某条台账**第一次**被流水触达时，先补一条 `opening`（= 当时的数量），之后「流水汇总 = 台账」可核对；
 *   · 盘点 / 飞书同步是「观测到的绝对数」→ 换算成与台账的差额写 `count` 流水（不再删行重建）；
 *   · 唯一件（孤品）用 `serialNo` 一件一条：台账行 qty ∈ {0,1}，出货 / 回库按 serialNo 定位到那一件。
 *
 * 失败语义：流水先写（幂等闸），台账后 inc；inc 失败时流水 `applied=false` 留痕，`verifyLedger` 能查出差额。
 */
const crypto = require('crypto')

const MOVE_COLLECTION = 'inventory_moves'

const MOVE_TYPE = {
  OPENING: 'opening', // 开账：台账第一次被流水触达时的存量
  IN: 'in', // 入库（采购到货 / 手工入库 / 唯一件登记）
  OUT: 'out', // 出库（出货单发出）
  RETURN: 'return', // 回库（已发出的出货单取消 / 退回）
  COUNT: 'count', // 盘点 / 飞书同步：观测值与台账的差额
  ADJUST: 'adjust' // 手工调整（报损 / 更正）
}

const MOVE_TYPE_LABEL = {
  opening: '开账',
  in: '入库',
  out: '出库',
  return: '回库',
  count: '盘点',
  adjust: '调整'
}

const REF_TYPE_LABEL = {
  purchase: '采购单',
  shipment: '出货单',
  snapshot: '盘点',
  feishu: '飞书同步',
  manual: '手工'
}

/** 两本台账：成品（工作室）/ 原材料 */
const LEDGER = {
  finished: { collection: 'studio_inventory', specField: 'framingSpec', label: '成品' },
  raw: { collection: 'studio_raw_inventory', specField: 'spec', label: '原材料' }
}

function norm(s) {
  return String(s == null ? '' : s)
    .replace(/[\s　]+/g, '')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .toLowerCase()
}

/** 台账行的品项键：品名 + 规格（空白 / 全角括号 / 大小写不敏感）；唯一件按 serialNo */
function itemKey(name, spec) {
  return `${norm(name)}|${norm(spec)}`
}

function moveId(idemKey) {
  return 'mv_' + crypto.createHash('sha1').update(String(idemKey)).digest('hex').slice(0, 32)
}

function toInt(n) {
  const v = Math.round(Number(n))
  return Number.isFinite(v) ? v : 0
}

function rowQty(doc) {
  if (!doc) return 0
  if (doc.qty != null) return toInt(doc.qty)
  if (doc.currentQty != null) return toInt(doc.currentQty)
  return 0
}

function rowKey(ledger, doc) {
  const cfg = LEDGER[ledger] || LEDGER.finished
  if (doc && doc.serialNo) return `sn:${norm(doc.serialNo)}`
  return (doc && doc.itemKey) || itemKey(doc && (doc.itemName || doc.skuName), doc && (doc[cfg.specField] || doc.spec))
}

/**
 * 盘点计划（纯函数）：台账现状 + 观测行 → 每个品项的 before / after / delta。
 * opts.zeroMissing：观测里没出现的台账行按 0 处理（整表盘点的语义；飞书逐条同步时为 false）。
 * 唯一件（有 serialNo 的台账行）不参与按品名盘点，单独管理。
 */
function planCount(ledger, rows, observed, opts) {
  const o = opts || {}
  const cfg = LEDGER[ledger] || LEDGER.finished
  const byKey = new Map()
  ;(rows || []).forEach((r) => {
    if (!r || r.serialNo || r.deleted) return
    const k = rowKey(ledger, r)
    const cur = byKey.get(k)
    if (cur) {
      cur.before += rowQty(r)
      cur.dupIds.push(r._id)
    } else {
      byKey.set(k, { key: k, ledgerId: r._id, dupIds: [], itemName: r.itemName || r.skuName || '', spec: r[cfg.specField] || r.spec || '', before: rowQty(r), after: null, line: null })
    }
  })
  const seen = new Set()
  ;(observed || []).forEach((l) => {
    const name = String((l && (l.itemName || l.skuName)) || '').trim()
    if (!name) return
    const spec = String((l && (l.framingSpec || l.spec)) || '').trim()
    const k = itemKey(name, spec)
    const qty = Math.max(0, toInt(l.qty))
    const cur = byKey.get(k)
    if (cur) {
      cur.after = (seen.has(k) ? cur.after : 0) + qty
      cur.line = cur.line || l
    } else {
      byKey.set(k, { key: k, ledgerId: '', dupIds: [], itemName: name, spec, before: 0, after: qty, line: l })
    }
    seen.add(k)
  })
  const plan = []
  byKey.forEach((v) => {
    if (v.after === null) {
      if (!o.zeroMissing) return
      v.after = 0
    }
    plan.push(Object.assign(v, { delta: v.after - v.before }))
  })
  return plan
}

/** 差异摘要（预览用）：新增 / 清零 / 数量变化 / 不变 + 净变化 */
function summarizePlan(plan) {
  const s = { added: [], cleared: [], changed: [], unchanged: 0, netDelta: 0 }
  ;(plan || []).forEach((p) => {
    s.netDelta += p.delta
    if (p.delta === 0) { s.unchanged += 1; return }
    const row = { itemName: p.itemName, spec: p.spec, before: p.before, after: p.after, delta: p.delta }
    if (!p.ledgerId && p.before === 0) s.added.push(row)
    else if (p.after === 0) s.cleared.push(row)
    else s.changed.push(row)
  })
  return s
}

function isDupError(err) {
  const t = String((err && (err.errMsg || err.message)) || err || '')
  return /duplicate|already exist|E11000|-502001|DATABASE_DUPLICATE/i.test(t)
}

async function findLedgerRow(db, ledger, move) {
  const _ = db.command
  const cfg = LEDGER[ledger]
  const col = db.collection(cfg.collection)
  if (move.ledgerId) {
    const r = await col.doc(move.ledgerId).get().catch(() => null)
    if (r && r.data) return r.data
  }
  const base = ledger === 'finished' ? { location: 'studio' } : { deleted: _.neq(true) }
  if (move.serialNo) {
    const r = await col.where(Object.assign({}, base, { serialNo: String(move.serialNo) })).limit(1).get()
    return (r.data && r.data[0]) || null
  }
  const key = itemKey(move.itemName, move.spec)
  const byKey = await col.where(Object.assign({}, base, { itemKey: key })).limit(1).get()
  if (byKey.data && byKey.data[0]) return byKey.data[0]
  // 老数据没有 itemKey：按品名取回后在内存里比键
  const byName = await col.where(Object.assign({}, base, { itemName: String(move.itemName || '') })).limit(20).get()
  return (byName.data || []).find((d) => !d.serialNo && rowKey(ledger, d) === key) || null
}

/**
 * 记一条流水并作用到台账。
 * move: { ledger, type, delta, itemName, spec?, serialNo?, ledgerId?, refType, refId?, refNo?, idemKey, note?, operator?, seed? }
 *   seed：台账里还没有这一品项时新建行用的字段（各调用方给自己台账的形状）
 * 返回 { ok, duplicate?, ledgerId, before, after, moveId }
 */
async function applyMove(db, move) {
  const _ = db.command
  const ledger = move.ledger === 'raw' ? 'raw' : 'finished'
  const cfg = LEDGER[ledger]
  const delta = toInt(move.delta)
  if (!move.idemKey) return { ok: false, msg: '缺少 idemKey' }
  const id = moveId(move.idemKey)
  const now = Date.now()

  // move.row：调用方已整批读好的台账行（盘点一次读全表，省掉逐条查）
  let row = move.row || await findLedgerRow(db, ledger, move)
  // 懒开账：这条台账第一次被流水触达
  if (row && !row.movesOpenedAt) {
    try {
      await db.collection(MOVE_COLLECTION).add({ data: {
        _id: moveId(`opening:${ledger}:${row._id}`), ledger, type: MOVE_TYPE.OPENING, delta: rowQty(row),
        itemName: row.itemName || row.skuName || '', spec: row[cfg.specField] || row.spec || '', serialNo: row.serialNo || '',
        ledgerId: row._id, refType: 'manual', refId: '', refNo: '', note: '首次接入流水时的存量', operator: 'system',
        before: 0, after: rowQty(row), applied: true, createdAt: now
      } })
    } catch (e) { if (!isDupError(e)) throw e }
    await db.collection(cfg.collection).doc(row._id).update({ data: { movesOpenedAt: now, itemKey: row.serialNo ? '' : rowKey(ledger, row) } })
  }

  const before = row ? rowQty(row) : 0
  const after = before + delta
  try {
    await db.collection(MOVE_COLLECTION).add({ data: {
      _id: id, ledger, type: move.type, delta,
      itemName: String(move.itemName || (row && (row.itemName || row.skuName)) || ''),
      spec: String(move.spec || (row && (row[cfg.specField] || row.spec)) || ''),
      serialNo: String(move.serialNo || ''),
      ledgerId: row ? row._id : '', refType: move.refType || 'manual', refId: String(move.refId || ''), refNo: String(move.refNo || ''),
      note: String(move.note || '').slice(0, 200), operator: String(move.operator || ''),
      before, after, applied: false, createdAt: now
    } })
  } catch (e) {
    if (isDupError(e)) return { ok: true, duplicate: true, moveId: id, ledgerId: row ? row._id : '' }
    throw e
  }

  let ledgerId = row ? row._id : ''
  if (row) {
    const patch = { qty: _.inc(delta), updatedAt: now }
    if (ledger === 'raw') {
      patch.currentQty = _.inc(delta)
      if (delta > 0 && move.type !== MOVE_TYPE.COUNT) patch.inboundTotal = _.inc(delta)
      if (delta < 0 && move.type !== MOVE_TYPE.COUNT) patch.outboundTotal = _.inc(-delta)
    }
    await db.collection(cfg.collection).doc(row._id).update({ data: patch })
  } else {
    const seed = Object.assign({}, move.seed || {})
    const data = Object.assign(seed, {
      itemName: String(move.itemName || seed.itemName || ''),
      qty: delta,
      itemKey: move.serialNo ? '' : itemKey(move.itemName, move.spec),
      serialNo: String(move.serialNo || ''),
      movesOpenedAt: now,
      createdAt: seed.createdAt || now,
      updatedAt: now
    })
    data[cfg.specField] = String(move.spec || seed[cfg.specField] || '')
    if (ledger === 'finished') { data.location = 'studio'; data.skuName = data.itemName; data.spec = data.framingSpec }
    if (ledger === 'raw') { data.currentQty = delta; data.deleted = false; data.inboundTotal = Math.max(0, delta) }
    const added = await db.collection(cfg.collection).add({ data })
    ledgerId = added._id
  }
  await db.collection(MOVE_COLLECTION).doc(id).update({ data: { applied: true, ledgerId } }).catch(() => null)
  return { ok: true, moveId: id, ledgerId, before, after }
}

/** 某条台账的流水（新到旧） */
async function listMoves(db, where, limit) {
  const res = await db.collection(MOVE_COLLECTION).where(where || {}).orderBy('createdAt', 'desc').limit(Math.min(100, Math.max(1, limit || 50))).get()
  return (res.data || []).map((m) => Object.assign({}, m, {
    typeLabel: MOVE_TYPE_LABEL[m.type] || m.type,
    refLabel: REF_TYPE_LABEL[m.refType] || m.refType || ''
  }))
}

/** 核对：某条台账的流水合计是否等于台账数量（未开账的行不核） */
async function verifyLedger(db, ledger, ledgerId) {
  const cfg = LEDGER[ledger === 'raw' ? 'raw' : 'finished']
  const r = await db.collection(cfg.collection).doc(ledgerId).get().catch(() => null)
  const row = r && r.data
  if (!row) return { ok: false, msg: '台账不存在' }
  if (!row.movesOpenedAt) return { ok: true, opened: false, qty: rowQty(row) }
  const res = await db.collection(MOVE_COLLECTION).where({ ledgerId, applied: true }).limit(1000).get()
  const sum = (res.data || []).reduce((n, m) => n + toInt(m.delta), 0)
  const pending = await db.collection(MOVE_COLLECTION).where({ ledgerId, applied: false }).count().catch(() => ({ total: 0 }))
  return { ok: true, opened: true, qty: rowQty(row), movesSum: sum, diff: rowQty(row) - sum, unapplied: Number(pending.total) || 0 }
}

module.exports = {
  MOVE_COLLECTION,
  MOVE_TYPE,
  MOVE_TYPE_LABEL,
  REF_TYPE_LABEL,
  LEDGER,
  itemKey,
  moveId,
  rowKey,
  rowQty,
  planCount,
  summarizePlan,
  findLedgerRow,
  applyMove,
  listMoves,
  verifyLedger
}
