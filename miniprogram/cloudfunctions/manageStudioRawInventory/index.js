/**
 * 原材料库存 — manageStudioRawInventory
 *
 * 飞书「库存管理」= 原材料（多平台进货）→ studio_raw_inventory
 * 成品见 manageStudioInventory → studio_inventory（飞书「成品库存」）
 *
 * action: meta | list | get | create | update | remove | upsertFromFeishu
 * 权限：超管 / 店长
 *
 * 2026-11-27「库存以出入库流水为准」：数量（qty / currentQty / 入出库累计）只经 inventoryMoves 改 ——
 * 手工改数 / 飞书同步是「观测值」，与台账的差额记 count 流水；采购入库由 managePurchaseOrder 记 in 流水。
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')
const {
  COLLECTION,
  CATEGORY_OPTIONS,
  ROLE_LABEL,
  ROLE_HINT,
  FEISHU_TABLE_NAME,
  buildRow,
  mapRow,
  feishuItemToPayload,
  buildSummary
} = require('./rawDefaults')
const moves = require('./inventoryMoves')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function fail(msg, code) {
  return { success: false, msg, code: code || 'FAIL' }
}
function ok(data) {
  return Object.assign({ success: true }, data || {})
}
function errorText(err) {
  return [err && err.errCode, err && err.errMsg, err && err.message, String(err || '')]
    .filter(Boolean)
    .join(' ')
}
function isMissingCollectionError(err) {
  return /502005|DATABASE_COLLECTION_NOT_EXIST|COLLECTION_NOT_EXIST|collection not exist|集合不存在|not exist/i.test(
    errorText(err)
  )
}
function isCollectionExistsError(err) {
  return /already exist|already exists|COLLECTION_EXIST|ResourceExist|-501001/i.test(errorText(err))
}
async function ensureCollection(name) {
  try {
    await db.createCollection(name || COLLECTION)
  } catch (err) {
    if (isCollectionExistsError(err)) return
    throw err
  }
}
async function withCollectionRetry(fn) {
  try {
    return await fn()
  } catch (err) {
    if (!isMissingCollectionError(err)) throw err
    await ensureCollection(COLLECTION)
    return await fn()
  }
}
async function requireManager(event, openid) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return { ok: false, res: fail(guard.msg, guard.code) }
  return { ok: true, actor: guard.actor }
}

async function fetchAll(limit = 500) {
  const col = db.collection(COLLECTION)
  const out = []
  let skip = 0
  while (skip < limit) {
    const take = Math.min(100, limit - skip)
    const res = await col.where({ deleted: _.neq(true) }).skip(skip).limit(take).get()
    const list = (res && res.data) || []
    out.push(...list)
    if (list.length < take) break
    skip += list.length
  }
  return out
}

async function handleMeta() {
  return ok({
    inventoryRole: 'raw',
    roleLabel: ROLE_LABEL,
    roleHint: ROLE_HINT,
    feishuTableName: FEISHU_TABLE_NAME,
    collection: COLLECTION,
    categories: CATEGORY_OPTIONS,
    schemaNote:
      '原材料库存对齐飞书「库存管理」：库存编号/物品名称/规格型号/分类/当前库存/预警/单价/库存价值/累计入出库/存放位置。成品请走「成品库存」。'
  })
}

async function handleList(event) {
  const keyword = String((event && event.keyword) || '').trim()
  const category = String((event && event.category) || '').trim()
  let rows = (await withCollectionRetry(() => fetchAll(800))).map(mapRow).filter(Boolean)
  if (category) rows = rows.filter((r) => r.category === category)
  if (keyword) {
    const k = keyword.toLowerCase()
    rows = rows.filter(
      (r) =>
        (r.itemName && r.itemName.toLowerCase().indexOf(k) !== -1) ||
        (r.spec && r.spec.toLowerCase().indexOf(k) !== -1) ||
        (r.inventoryNo && String(r.inventoryNo).toLowerCase().indexOf(k) !== -1)
    )
  }
  rows.sort((a, b) => String(a.itemName).localeCompare(String(b.itemName), 'zh'))
  return ok({ list: rows, summary: buildSummary(rows) })
}

/** 数量相关字段只经流水改；其余字段照常写 */
const QTY_FIELDS = ['qty', 'currentQty', 'stockValue', 'inboundTotal', 'outboundTotal']
function withoutQty(row) {
  const out = Object.assign({}, row)
  QTY_FIELDS.forEach((k) => { delete out[k] })
  return out
}

/** 把台账行的数量调到 target（差额记 count 流水），再按单价刷新库存金额 */
async function syncQtyByMove(prev, target, ctx) {
  const before = moves.rowQty(prev)
  const delta = Math.round(Number(target) || 0) - before
  if (delta !== 0) {
    await moves.applyMove(db, {
      ledger: 'raw', type: ctx.type || moves.MOVE_TYPE.COUNT, delta, ledgerId: prev._id, row: prev,
      itemName: prev.itemName, spec: prev.spec, refType: ctx.refType || 'manual', refId: ctx.refId || '',
      idemKey: `${ctx.dedupe}:${prev._id}:${Date.now()}`, operator: ctx.operator || '', note: ctx.note || `${before} → ${before + delta}`
    })
  }
  const unitPrice = Number(ctx.unitPrice != null ? ctx.unitPrice : prev.unitPrice) || 0
  await db.collection(COLLECTION).doc(prev._id).update({ data: { stockValue: Math.round((before + delta) * unitPrice * 100) / 100 } })
  return before + delta
}

async function handleGet(event) {
  const id = String((event && event.id) || '').trim()
  if (!id) return fail('缺少 id')
  const res = await withCollectionRetry(() => db.collection(COLLECTION).doc(id).get())
  const doc = res && res.data
  if (!doc || doc.deleted) return fail('记录不存在', 'NOT_FOUND')
  return ok({ item: mapRow(doc) })
}

async function handleCreate(event, actor) {
  const normalized = buildRow(event.item || event, null)
  if (!normalized.ok) return fail(normalized.msg)
  const now = Date.now()
  const data = Object.assign({}, normalized.row, {
    createdAt: now,
    updatedAt: now,
    createdBy: (actor && (actor.name || actor.openid)) || '',
    updatedBy: (actor && (actor.name || actor.openid)) || ''
  })
  // 先建 0 数量的行，再用一条 in 流水把初始数量记进来（建档即开账）
  const initial = data.qty
  const addRes = await withCollectionRetry(() => db.collection(COLLECTION).add({ data: Object.assign({}, data, { qty: 0, currentQty: 0, stockValue: 0, inboundTotal: 0 }) }))
  if (initial) {
    await syncQtyByMove(Object.assign({ _id: addRes._id }, data, { qty: 0, currentQty: 0 }), initial, {
      type: moves.MOVE_TYPE.IN, dedupe: 'raw-create', operator: data.createdBy, note: '建档入库'
    })
  }
  return ok({ id: addRes._id, item: mapRow(Object.assign({ _id: addRes._id }, data)) })
}

async function handleUpdate(event, actor) {
  const id = String((event && event.id) || '').trim()
  if (!id) return fail('缺少 id')
  const prevRes = await withCollectionRetry(() => db.collection(COLLECTION).doc(id).get())
  const prev = prevRes && prevRes.data
  if (!prev || prev.deleted) return fail('记录不存在', 'NOT_FOUND')
  const normalized = buildRow(event.item || event, prev)
  if (!normalized.ok) return fail(normalized.msg)
  const now = Date.now()
  const patch = Object.assign({}, withoutQty(normalized.row), {
    updatedAt: now,
    updatedBy: (actor && (actor.name || actor.openid)) || '',
    createdAt: prev.createdAt || now,
    createdBy: prev.createdBy || ''
  })
  await withCollectionRetry(() => db.collection(COLLECTION).doc(id).update({ data: patch }))
  const qty = await syncQtyByMove(Object.assign({}, prev, { _id: id }), normalized.row.qty, {
    dedupe: 'raw-edit', operator: patch.updatedBy, unitPrice: normalized.row.unitPrice,
    note: String((event && event.reason) || '手工改数').slice(0, 120)
  })
  return ok({ item: mapRow(Object.assign({ _id: id }, prev, patch, { qty, currentQty: qty })) })
}

async function handleRemove(event, actor) {
  const id = String((event && event.id) || '').trim()
  if (!id) return fail('缺少 id')
  await withCollectionRetry(() =>
    db.collection(COLLECTION).doc(id).update({
      data: {
        deleted: true,
        updatedAt: Date.now(),
        updatedBy: (actor && (actor.name || actor.openid)) || ''
      }
    })
  )
  return ok({ id })
}

async function handleUpsertFromFeishu(event, actor) {
  const items = Array.isArray(event.items) ? event.items : []
  if (!items.length) return fail('缺少 items')
  const now = Date.now()
  let created = 0
  let updated = 0
  let skipped = 0
  const errors = []

  for (let i = 0; i < items.length; i += 1) {
    const payload = feishuItemToPayload(items[i])
    if (!payload.itemName) {
      skipped += 1
      errors.push({ index: i, msg: '缺少物品名称' })
      continue
    }
    try {
      let prev = null
      if (payload.feishuRecordId) {
        const found = await withCollectionRetry(() =>
          db
            .collection(COLLECTION)
            .where({ feishuRecordId: payload.feishuRecordId, deleted: _.neq(true) })
            .limit(1)
            .get()
        )
        prev = (found.data && found.data[0]) || null
      }
      const normalized = buildRow(payload, prev)
      if (!normalized.ok) {
        skipped += 1
        errors.push({ index: i, msg: normalized.msg })
        continue
      }
      const syncCtx = { refType: 'feishu', refId: payload.feishuRecordId || '', dedupe: 'raw-feishu', operator: 'feishu_sync', unitPrice: normalized.row.unitPrice, note: '飞书同步' }
      if (prev && prev._id) {
        await withCollectionRetry(() =>
          db.collection(COLLECTION).doc(prev._id).update({
            data: Object.assign({}, withoutQty(normalized.row), {
              updatedAt: now,
              updatedBy: (actor && (actor.name || actor.openid)) || 'feishu_sync',
              createdAt: prev.createdAt || now,
              createdBy: prev.createdBy || 'feishu_sync'
            })
          })
        )
        await syncQtyByMove(prev, normalized.row.qty, syncCtx)
        updated += 1
      } else {
        const addRes = await withCollectionRetry(() =>
          db.collection(COLLECTION).add({
            data: Object.assign({}, normalized.row, {
              qty: 0, currentQty: 0, stockValue: 0,
              createdAt: now,
              updatedAt: now,
              createdBy: 'feishu_sync',
              updatedBy: (actor && (actor.name || actor.openid)) || 'feishu_sync'
            })
          })
        )
        if (normalized.row.qty) await syncQtyByMove(Object.assign({}, normalized.row, { _id: addRes._id, qty: 0, currentQty: 0 }), normalized.row.qty, syncCtx)
        created += 1
      }
    } catch (err) {
      skipped += 1
      errors.push({ index: i, msg: err.message || String(err) })
    }
  }

  return ok({
    stats: { created, updated, skipped, total: items.length },
    errors: errors.slice(0, 30),
    msg: `已同步原材料至 ${COLLECTION}：新建 ${created}，更新 ${updated}，跳过 ${skipped}`
  })
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const action = String((event && event.action) || '').trim()
  try {
    const auth = await requireManager(event, openid)
    if (!auth.ok) return auth.res
    switch (action) {
      case 'meta':
        return await handleMeta()
      case 'list':
        return await handleList(event)
      case 'get':
        return await handleGet(event)
      case 'create':
        return await handleCreate(event, auth.actor)
      case 'update':
        return await handleUpdate(event, auth.actor)
      case 'remove':
        return await handleRemove(event, auth.actor)
      case 'upsertFromFeishu':
        return await handleUpsertFromFeishu(event, auth.actor)
      default:
        return fail('未知 action', 'BAD_ACTION')
    }
  } catch (err) {
    console.error('[manageStudioRawInventory]', action, err)
    return fail(err && err.message ? err.message : '服务异常', 'INTERNAL')
  }
}
