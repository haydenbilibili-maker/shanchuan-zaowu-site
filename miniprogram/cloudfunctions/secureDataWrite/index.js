/**
 * 敏感集合写网关 · secureDataWrite（2026-09-29 公网匿名可写收紧）
 *
 * 背景：admin_users / finance_settings / purchase_intents / feishu_* / fulfillment_shipments /
 * stock_movements / refunds / waitlist / stores / home_configs 等集合写规则为 auth != null，
 * Web 匿名登录即可改写。ERP（匿名 CDN）写入先改走本函数，再收紧写规则。
 *
 * 仅 ERP 超管（经 /api/cloud-fn 注入 adminOpsKey）：
 *   add     { collection, data }       → { success, id, _id }
 *   update  { collection, id, data }   → { success, id, updated }
 *   remove  { collection, id }         → { success, id, deleted }
 * 集合 / 动作 / 字段白名单见 policy.js。真实写入前先写 admin_operation_logs，审计失败即拒绝；
 * update / remove 目标文档不存在时直接返回 0（不写审计、不写库）。
 */
const cloud = require('wx-server-sdk')
const { assertStaff } = require('./staffGuard')
const policy = require('./policy')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function fail(code, msg) {
  return { success: false, code, msg }
}

async function docExists(collection, id) {
  const res = await db.collection(collection).where({ _id: id }).field({ _id: true }).limit(1).get()
  return !!(res.data && res.data.length)
}

async function audit(actor, op, collection, id, fields) {
  await db.collection('admin_operation_logs').add({
    data: {
      module: 'data_write',
      action: op,
      username: (actor && (actor.name || actor.openid)) || 'admin_web',
      collection,
      docId: id || '',
      fields: (fields || []).slice(0, 50),
      source: 'secureDataWrite',
      timestamp: Date.now()
    }
  })
}

async function withAudit(actor, op, collection, id, fields, run) {
  try {
    await audit(actor, op, collection, id, fields)
  } catch (e) {
    return fail('AUDIT_FAILED', `写入须先记审计日志，写入失败：${(e && e.message) || e}`)
  }
  return run()
}

async function handleAdd(event, actor) {
  const { collection } = event
  const { data, fields, id } = policy.prepareData(collection, 'add', event.data)
  return withAudit(actor, 'add', collection, id, fields, async () => {
    const res = await db.collection(collection).add({ data: id ? { ...data, _id: id } : data })
    return { success: true, id: res._id, _id: res._id }
  })
}

async function handleUpdate(event, actor) {
  const { collection } = event
  const id = policy.normalizeId(event.id)
  const { data, fields } = policy.prepareData(collection, 'update', event.data)
  if (!(await docExists(collection, id))) return { success: true, id, updated: 0 }
  return withAudit(actor, 'update', collection, id, fields, async () => {
    const res = await db.collection(collection).doc(id).update({ data })
    const updated = res && res.stats ? res.stats.updated : 0
    return { success: true, id, updated }
  })
}

async function handleRemove(event, actor) {
  const { collection } = event
  const id = policy.normalizeId(event.id)
  if (!(await docExists(collection, id))) return { success: true, id, deleted: 0 }
  return withAudit(actor, 'remove', collection, id, [], async () => {
    const res = await db.collection(collection).doc(id).remove()
    const deleted = res && res.stats ? res.stats.removed : 0
    return { success: true, id, deleted }
  })
}

const HANDLERS = { add: handleAdd, update: handleUpdate, remove: handleRemove }

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext() || {}
  const openid = OPENID || ''
  const adminOpsKey = event.adminOpsKey
  if (!openid && !adminOpsKey) return fail('UNAUTHORIZED', '请先登录')

  const action = String(event.action || '')
  if (!policy.OPS[action]) return fail('UNKNOWN_ACTION', `未知 action：${action}`)
  try {
    const guard = await assertStaff(db, openid, { adminOpsKey, requireSuperAdmin: true })
    if (!guard.ok) return fail(guard.code, guard.msg)
    const collection = String(event.collection || '')
    if (!policy.isAllowedCollection(collection)) {
      return fail('COLLECTION_NOT_ALLOWED', `集合不在写网关白名单：${collection}`)
    }
    if (!policy.isOpAllowed(collection, action)) {
      return fail('ACTION_DENIED', `集合 ${collection} 不允许 ${action}`)
    }
    return await HANDLERS[action]({ ...event, collection }, guard.actor)
  } catch (err) {
    if (err && err.code === 'BAD_INPUT') return fail('BAD_INPUT', err.message)
    console.error('secureDataWrite', action, err)
    return fail('INTERNAL', (err && err.message) || '写入失败')
  }
}
