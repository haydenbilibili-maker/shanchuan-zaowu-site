/**
 * 向店长 / 超管（及可选标本师）派发运营站内信
 * 失败不阻断主流程；同一 eventType+relatedId+openid 由 dispatchMessage 去重
 * 新订单额外尝试微信订阅消息（STAFF_ORDER_PAID_TMPL_ID，未配置则跳过）
 */
const cloud = require('wx-server-sdk')
const { notifyStaffOrderSubscribe } = require('./staffOrderSubscribe')

const SUPER_ADMIN_OPENIDS = [
  'oa22s5ZcMY7xkQDlNW8X8jaYy46M',
  'oa22s5RuZSXOCRQtXzdrVEiT1JuY'
]

const ROLE_SUPER = 'super_admin'
const ROLE_MANAGER = 'manager'
const ROLE_STORE_MANAGER = 'store_manager'
const ROLE_ARTISAN = 'specimen_artisan'

function uniq(list) {
  const seen = {}
  const out = []
  ;(list || []).forEach((id) => {
    const v = String(id || '').trim()
    if (!v || seen[v]) return
    seen[v] = true
    out.push(v)
  })
  return out
}

function envAdminOpenids() {
  const raw = process.env.MESSAGE_ADMIN_OPENIDS || ''
  return raw
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

async function loadConfiguredSuperAdminOpenids(db) {
  try {
    const res = await db.collection('workspace_acl').doc('super_admins').get()
    const list = (res.data && Array.isArray(res.data.openids) && res.data.openids) || []
    return list.map((id) => String(id || '').trim()).filter(Boolean)
  } catch (e) {
    return []
  }
}

function staffRolesOf(row) {
  const set = {}
  const push = (r) => {
    const v = String(r || '').trim()
    if (v) set[v] = true
  }
  if (row && Array.isArray(row.roles)) row.roles.forEach(push)
  if (row && row.role) push(row.role)
  return Object.keys(set)
}

function roleMatches(staffRoles, wanted) {
  const list = staffRoles || []
  return (wanted || []).some((w) => {
    if (list.indexOf(w) !== -1) return true
    if (w === ROLE_STORE_MANAGER && list.indexOf(ROLE_MANAGER) !== -1) return true
    if (w === ROLE_MANAGER && list.indexOf(ROLE_STORE_MANAGER) !== -1) return true
    return false
  })
}

/**
 * @param {object} db
 * @param {string[]} rolesWanted 如 ['super_admin','store_manager'] 或含 specimen_artisan
 */
async function listStaffOpenidsByRoles(db, rolesWanted) {
  const wanted = Array.isArray(rolesWanted) ? rolesWanted.filter(Boolean) : []
  const openids = []

  if (wanted.indexOf(ROLE_SUPER) !== -1) {
    const fromDb = await loadConfiguredSuperAdminOpenids(db)
    openids.push(...SUPER_ADMIN_OPENIDS, ...fromDb)
  }

  if (
    wanted.indexOf(ROLE_STORE_MANAGER) !== -1 ||
    wanted.indexOf(ROLE_MANAGER) !== -1
  ) {
    openids.push(...envAdminOpenids())
  }

  try {
    const res = await db
      .collection('staff_members')
      .where({ status: 'active' })
      .limit(200)
      .get()
    ;(res.data || []).forEach((row) => {
      if (!row || !row.openid) return
      if (roleMatches(staffRolesOf(row), wanted)) {
        openids.push(row.openid)
      }
    })
  } catch (e) {
    console.warn('listStaffOpenidsByRoles staff_members', e && e.message)
  }

  if (
    wanted.indexOf(ROLE_STORE_MANAGER) !== -1 ||
    wanted.indexOf(ROLE_MANAGER) !== -1
  ) {
    try {
      const res = await db
        .collection('users')
        .where({ isAdmin: true })
        .limit(50)
        .get()
      ;(res.data || []).forEach((u) => {
        const oid = (u && (u._openid || u.openid)) || ''
        if (oid) openids.push(oid)
      })
    } catch (e) {
      // optional
    }
  }

  return uniq(openids)
}

async function dispatchOne(db, dispatchInAppMessage, { eventType, openid, relatedId, vars }) {
  if (typeof dispatchInAppMessage === 'function') {
    return dispatchInAppMessage(db, { eventType, openid, relatedId, vars })
  }
  try {
    const res = await cloud.callFunction({
      name: 'dispatchMessage',
      data: { action: 'dispatch', eventType, openid, relatedId, vars }
    })
    return res.result || { success: false }
  } catch (e) {
    return { success: false, msg: e && e.message }
  }
}

async function logSubscribeAttempt(db, { openid, relatedId, vars, result }) {
  try {
    await db.collection('notification_logs').add({
      data: {
        recipient: openid,
        channel: 'subscribe',
        queue: 'workflow',
        category: 'ops',
        type: 'staff_order_paid',
        templateCode: 'staff_order_paid',
        title: '新单待发',
        content: `订单 ${vars && vars.orderNo ? vars.orderNo : ''} · ¥${
          (vars && vars.totalPrice) || '0.00'
        }`,
        relatedId: relatedId || '',
        actionUrl: 'subpackages/manager/manager/index?tab=2&title=订单管理',
        status: result && result.sent ? 'success' : result && result.skipped ? 'skipped' : 'fail',
        skipReason: (result && result.reason) || '',
        sentAt: db.serverDate(),
        read: false
      }
    })
  } catch (e) {
    // optional
  }
}

async function notifyStaffByRoles(
  db,
  {
    roles,
    eventType,
    relatedId,
    vars,
    dispatchInAppMessage,
    alsoSubscribe = false
  }
) {
  const openids = await listStaffOpenidsByRoles(db, roles)
  if (!openids.length) {
    console.log('[staffNotify] no recipients', eventType, relatedId)
    return { success: true, skipped: true, reason: 'no_recipients', count: 0 }
  }

  const mergedVars = vars || {}
  const results = []
  for (const openid of openids) {
    try {
      const r = await dispatchOne(db, dispatchInAppMessage, {
        eventType,
        openid,
        relatedId,
        vars: mergedVars
      })
      let subscribe = null
      if (alsoSubscribe) {
        try {
          subscribe = await notifyStaffOrderSubscribe(cloud, {
            openid,
            orderId: relatedId,
            relatedId,
            orderNo: mergedVars.orderNo,
            productNames: mergedVars.productNames,
            orderTime: mergedVars.orderTime,
            receiverName: mergedVars.receiverName,
            receiverAddress: mergedVars.receiverAddress
          })
          await logSubscribeAttempt(db, {
            openid,
            relatedId,
            vars: mergedVars,
            result: subscribe
          })
        } catch (subErr) {
          console.warn('[staffNotify] subscribe fail', openid, subErr && subErr.message)
          subscribe = { sent: false, reason: (subErr && subErr.message) || 'SUBSCRIBE_ERR' }
        }
      }
      results.push({ openid, ...(r || {}), subscribe })
    } catch (e) {
      console.warn('[staffNotify] fail', eventType, openid, e && e.message)
      results.push({ openid, success: false, msg: e && e.message })
    }
  }
  return { success: true, count: openids.length, results }
}

const ORDER_STAFF_ROLES = [ROLE_SUPER, ROLE_STORE_MANAGER, ROLE_MANAGER]
const WISHLIST_STAFF_ROLES = [
  ROLE_SUPER,
  ROLE_STORE_MANAGER,
  ROLE_MANAGER,
  ROLE_ARTISAN
]

async function notifyStaffNewOrder(db, opts) {
  return notifyStaffByRoles(db, {
    roles: ORDER_STAFF_ROLES,
    eventType: 'staff_order_paid',
    relatedId: opts.relatedId,
    vars: opts.vars,
    dispatchInAppMessage: opts.dispatchInAppMessage,
    alsoSubscribe: true
  })
}

async function notifyStaffWishlist(db, opts) {
  return notifyStaffByRoles(db, {
    roles: WISHLIST_STAFF_ROLES,
    eventType: 'wishlist_restock_request',
    relatedId: opts.relatedId,
    vars: opts.vars,
    dispatchInAppMessage: opts.dispatchInAppMessage
  })
}

module.exports = {
  listStaffOpenidsByRoles,
  notifyStaffByRoles,
  notifyStaffNewOrder,
  notifyStaffWishlist,
  ORDER_STAFF_ROLES,
  WISHLIST_STAFF_ROLES
}
