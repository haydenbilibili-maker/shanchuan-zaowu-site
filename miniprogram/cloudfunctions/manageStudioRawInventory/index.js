/**
 * 原材料库存 — manageStudioRawInventory
 *
 * 飞书「库存管理」= 原材料（多平台进货）→ studio_raw_inventory
 * 成品见 manageStudioInventory → studio_inventory（飞书「成品库存」）
 *
 * action: meta | list | get | create | update | remove | upsertFromFeishu
 * 权限：超管 / 店长
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
  const addRes = await withCollectionRetry(() => db.collection(COLLECTION).add({ data }))
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
  const patch = Object.assign({}, normalized.row, {
    updatedAt: now,
    updatedBy: (actor && (actor.name || actor.openid)) || '',
    createdAt: prev.createdAt || now,
    createdBy: prev.createdBy || ''
  })
  await withCollectionRetry(() => db.collection(COLLECTION).doc(id).update({ data: patch }))
  return ok({ item: mapRow(Object.assign({ _id: id }, patch)) })
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
      if (prev && prev._id) {
        await withCollectionRetry(() =>
          db.collection(COLLECTION).doc(prev._id).update({
            data: Object.assign({}, normalized.row, {
              updatedAt: now,
              updatedBy: (actor && (actor.name || actor.openid)) || 'feishu_sync',
              createdAt: prev.createdAt || now,
              createdBy: prev.createdBy || 'feishu_sync'
            })
          })
        )
        updated += 1
      } else {
        await withCollectionRetry(() =>
          db.collection(COLLECTION).add({
            data: Object.assign({}, normalized.row, {
              createdAt: now,
              updatedAt: now,
              createdBy: 'feishu_sync',
              updatedBy: (actor && (actor.name || actor.openid)) || 'feishu_sync'
            })
          })
        )
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
