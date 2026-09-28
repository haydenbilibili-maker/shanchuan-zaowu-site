/**
 * 敏感集合只读网关 · secureDataRead（2026-09-28 订单隐私收紧 S1 / S3）
 *
 * 背景：orders 等集合规则 read:"auth != null"，Web 匿名登录即可全表读取（收货人手机号/地址公网可读）。
 * 收紧规则前，ERP（匿名 CDN）与店长工作台的读取先改走本函数；本函数只读、不写业务集合。
 *
 * ERP（超管；经 /api/cloud-fn 注入 adminOpsKey）：
 *   query  { collection, where?, orderBy?, skip?, limit? ≤200 }  → { list }
 *   count  { collection, where? }                                → { total }
 *   get    { collection, id | ids[≤100], reveal? }               → { list }
 *   —— 集合白名单与脱敏策略见 policy.js；reveal=true 仅 get 可用，返回原值并写 admin_operation_logs。
 *
 * 小程序店长工作台（role=manager）：
 *   mpPaidOrderAmounts  { start, end? }（毫秒）→ 已付订单金额/时间投影（无个人信息）
 *   mpOrderStatusCounts                        → shipped / received / aftersale / refunded 计数
 *   mpCustomOrders                             → 定制订单列表（仅渲染所需字段）
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')
const policy = require('./policy')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const ERP_ACTIONS = { query: 1, count: 1, get: 1 }
const PAID_STATUSES = ['paid', 'paid_awaiting_address', 'shipped', 'received']

function fail(code, msg) {
  return { success: false, code, msg }
}

function toMs(v) {
  if (v instanceof Date) return v.getTime()
  return v
}

function queryDeps() {
  return { command: _, RegExp: (opts) => db.RegExp(opts) }
}

async function erpQuery(event) {
  const collection = String(event.collection || '')
  const where = policy.decodeWhere(event.where, queryDeps())
  const orderBy = policy.normalizeOrderBy(event.orderBy)
  const skip = policy.clampInt(event.skip, 0, 100000, 0)
  const limit = policy.clampInt(event.limit, 1, 200, 100)
  let q = db.collection(collection)
  if (where) q = q.where(where)
  orderBy.forEach((o) => { q = q.orderBy(o.field, o.direction) })
  const res = await q.skip(skip).limit(limit).get()
  const list = (res.data || []).map((d) => policy.encodeOut(policy.sanitizeDoc(collection, d)))
  return { success: true, list }
}

async function erpCount(event) {
  const collection = String(event.collection || '')
  const where = policy.decodeWhere(event.where, queryDeps())
  let q = db.collection(collection)
  if (where) q = q.where(where)
  const res = await q.count()
  return { success: true, total: res.total || 0 }
}

async function erpGet(event, actor) {
  const collection = String(event.collection || '')
  const ids = (Array.isArray(event.ids) ? event.ids : [event.id])
    .map((id) => String(id || '').trim())
    .filter(Boolean)
  if (!ids.length) return fail('BAD_INPUT', '缺少 id')
  if (ids.length > 100) return fail('BAD_INPUT', '单次最多 100 条')
  const reveal = event.reveal === true
  const res = await db.collection(collection).where({ _id: _.in(ids) }).limit(100).get()
  const rows = res.data || []
  if (reveal && policy.COLLECTION_POLICY[collection] === policy.MASK && rows.length) {
    try {
      await db.collection('admin_operation_logs').add({
        data: {
          module: 'privacy',
          action: 'reveal_pii',
          username: actor.name || actor.openid || 'admin_web',
          collection,
          ids: rows.map((r) => r._id).slice(0, 100),
          count: rows.length,
          reason: String(event.reason || '').slice(0, 60),
          source: 'secureDataRead',
          timestamp: Date.now()
        }
      })
    } catch (e) {
      return fail('AUDIT_FAILED', `查看原值须先记审计日志，写入失败：${e.message || e}`)
    }
  }
  const list = rows.map((d) => policy.encodeOut(policy.sanitizeDoc(collection, d, { reveal })))
  return { success: true, list }
}

async function mpPaidOrderAmounts(event) {
  const start = Number(event.start)
  if (!Number.isFinite(start)) return fail('BAD_INPUT', '缺少 start')
  const end = Number(event.end)
  const createTime = Number.isFinite(end)
    ? _.and(_.gte(new Date(start)), _.lte(new Date(end)))
    : _.gte(new Date(start))
  const res = await db
    .collection('orders')
    .where({ status: _.in(PAID_STATUSES), createTime })
    .field({ _id: true, totalPrice: true, payAmount: true, amount: true, paidTime: true, createTime: true })
    .limit(1000)
    .get()
  const list = (res.data || []).map((o) => ({
    _id: o._id,
    totalPrice: o.totalPrice,
    payAmount: o.payAmount,
    amount: o.amount,
    paidTime: toMs(o.paidTime),
    createTime: toMs(o.createTime)
  }))
  return { success: true, list }
}

async function mpOrderStatusCounts() {
  const count = (status) => db.collection('orders').where({ status }).count().then((r) => r.total || 0)
  const [shipped, received, aftersale, refunded] = await Promise.all([
    count('shipped'),
    count('received'),
    count(_.in(['refunding', 'aftersales', 'expired_refunding'])),
    count('refunded')
  ])
  return { success: true, counts: { shipped, received, aftersale, refunded } }
}

async function mpCustomOrders() {
  const res = await db
    .collection('orders')
    .where({ source: 'custom', status: _.in(['paid', 'shipped']) })
    .orderBy('createTime', 'desc')
    .field({
      _id: true,
      orderNo: true,
      status: true,
      source: true,
      type: true,
      name: true,
      desc: true,
      priceDelta: true,
      productionStatus: true,
      createTime: true,
      customMeta: true,
      products: true,
      'address.name': true,
      'address.phone': true
    })
    .limit(50)
    .get()
  const list = (res.data || []).map((o) => ({ ...o, createTime: toMs(o.createTime) }))
  return { success: true, list }
}

const MP_ACTIONS = { mpPaidOrderAmounts, mpOrderStatusCounts, mpCustomOrders }

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext() || {}
  const openid = OPENID || ''
  const adminOpsKey = event.adminOpsKey
  if (!openid && !adminOpsKey) return fail('UNAUTHORIZED', '请先登录')

  const action = String(event.action || '')
  try {
    if (ERP_ACTIONS[action]) {
      const guard = await assertStaff(db, openid, { adminOpsKey, requireSuperAdmin: true })
      if (!guard.ok) return fail(guard.code, guard.msg)
      if (!policy.isAllowedCollection(event.collection)) {
        return fail('COLLECTION_NOT_ALLOWED', `集合不在只读白名单：${event.collection}`)
      }
      if (action === 'query') return await erpQuery(event)
      if (action === 'count') return await erpCount(event)
      return await erpGet(event, guard.actor)
    }
    if (MP_ACTIONS[action]) {
      const guard = await assertStaff(db, openid, { adminOpsKey, role: ROLE_MANAGER })
      if (!guard.ok) return fail(guard.code, guard.msg)
      return await MP_ACTIONS[action](event)
    }
    return fail('UNKNOWN_ACTION', `未知 action：${action}`)
  } catch (err) {
    if (err && err.code === 'BAD_INPUT') return fail('BAD_INPUT', err.message)
    console.error('secureDataRead', action, err)
    return fail('INTERNAL', (err && err.message) || '读取失败')
  }
}
