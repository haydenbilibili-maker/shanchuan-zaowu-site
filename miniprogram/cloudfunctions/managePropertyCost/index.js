/**
 * 超管物业成本 — 水电费 / 房租 / 其他
 *
 * action: meta | list | get | create | update | remove
 * 权限：仅超管（ADMIN_OPS_KEY / super_admin）
 * 集合：property_costs
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')
const {
  COLLECTION,
  MAX_RECEIPTS,
  ENTITIES,
  COST_TYPES,
  normalizeCostType,
  normalizePayload,
  mapRow,
  buildSummary
} = require('./propertyDefaults')

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
  return /502005|DATABASE_COLLECTION_NOT_EXIST|COLLECTION_NOT_EXIST|collection not exist|集合不存在|not exist/i
    .test(errorText(err))
}

function isCollectionExistsError(err) {
  return /already exist|already exists|COLLECTION_EXIST|ResourceExist|-501001/i.test(errorText(err))
}

async function ensureCollection() {
  try {
    await db.createCollection(COLLECTION)
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
    await ensureCollection()
    return await fn()
  }
}

async function requireSuperAdmin(event, openid) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    requireSuperAdmin: true,
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return { ok: false, res: fail(guard.msg, guard.code) }
  return { ok: true, actor: guard.actor }
}

async function handleMeta() {
  return ok({
    entities: ENTITIES,
    costTypes: COST_TYPES,
    maxReceipts: MAX_RECEIPTS
  })
}

async function handleList(event) {
  const entityId = String(event.entityId || '').trim()
  const costType = String(event.costType || '').trim()
  const periodMonth = String(event.periodMonth || '').trim()
  const limit = Math.min(Math.max(Number(event.limit) || 50, 1), 100)

  const where = { deleted: _.neq(true) }
  if (entityId) where.entityId = entityId
  if (costType && costType !== 'all') where.costType = normalizeCostType(costType)
  if (periodMonth) where.periodMonth = periodMonth

  const res = await withCollectionRetry(() =>
    db.collection(COLLECTION).where(where).limit(limit).get()
  )
  const list = (res.data || [])
    .map(mapRow)
    .filter(Boolean)
    .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
  return ok({
    list,
    total: list.length,
    summary: buildSummary(list)
  })
}

async function handleGet(event) {
  const id = String(event.id || event._id || '').trim()
  if (!id) return fail('缺少 id')
  const res = await withCollectionRetry(() => db.collection(COLLECTION).doc(id).get())
  const doc = res.data
  if (!doc || doc.deleted) return fail('记录不存在', 'NOT_FOUND')
  return ok({ item: mapRow(doc) })
}

async function handleCreate(event, actor) {
  const normalized = normalizePayload(event.item || event, null)
  if (!normalized.ok) return fail(normalized.msg)
  const now = Date.now()
  const data = Object.assign({}, normalized.row, {
    createdAt: now,
    updatedAt: now,
    createdBy: (actor && (actor.name || actor.openid)) || '',
    updatedBy: (actor && (actor.name || actor.openid)) || '',
    deleted: false
  })
  const addRes = await withCollectionRetry(() => db.collection(COLLECTION).add({ data }))
  return ok({ id: addRes._id, item: mapRow(Object.assign({ _id: addRes._id }, data)) })
}

async function handleUpdate(event, actor) {
  const id = String(event.id || event._id || '').trim()
  if (!id) return fail('缺少 id')
  const cur = await withCollectionRetry(() => db.collection(COLLECTION).doc(id).get())
  const prev = cur.data
  if (!prev || prev.deleted) return fail('记录不存在', 'NOT_FOUND')

  const normalized = normalizePayload(event.item || event, prev)
  if (!normalized.ok) return fail(normalized.msg)

  const now = Date.now()
  const patch = Object.assign({}, normalized.row, {
    updatedAt: now,
    updatedBy: (actor && (actor.name || actor.openid)) || '',
    createdAt: prev.createdAt || now,
    createdBy: prev.createdBy || '',
    deleted: false
  })
  await withCollectionRetry(() => db.collection(COLLECTION).doc(id).update({ data: patch }))
  return ok({ item: mapRow(Object.assign({ _id: id }, patch)) })
}

async function handleRemove(event, actor) {
  const id = String(event.id || event._id || '').trim()
  if (!id) return fail('缺少 id')
  const now = Date.now()
  await withCollectionRetry(() =>
    db.collection(COLLECTION).doc(id).update({
      data: {
        deleted: true,
        updatedAt: now,
        updatedBy: (actor && (actor.name || actor.openid)) || ''
      }
    })
  )
  return ok({ id })
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const action = String((event && event.action) || '').trim()

  const auth = await requireSuperAdmin(event, openid)
  if (!auth.ok) return auth.res

  try {
    if (action === 'meta') return await handleMeta()
    if (action === 'list') return await handleList(event)
    if (action === 'get') return await handleGet(event)
    if (action === 'create') return await handleCreate(event, auth.actor)
    if (action === 'update') return await handleUpdate(event, auth.actor)
    if (action === 'remove') return await handleRemove(event, auth.actor)
    return fail('未知 action', 'BAD_ACTION')
  } catch (err) {
    console.error('managePropertyCost error', err)
    return fail(err.message || '服务器错误', 'SERVER_ERROR')
  }
}
