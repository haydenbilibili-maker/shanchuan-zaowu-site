/**
 * 门店预约规则 — 超管读写（集合 store_booking_rules）
 * 与 createBooking / getBookingAvailability 同源字段，勿写 Admin 旧 booking_rules schema
 *
 * action: get | save | listStores
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')
const { getDefaultRules, WORKSHOP_STORE_ID } = require('./bookingRules')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTION = 'store_booking_rules'
const MAIN_STORE_ID = 'store_shanhaizaowu'

const KNOWN_STORES = [
  { storeId: MAIN_STORE_ID, name: '主店', role: 'main' },
  { storeId: WORKSHOP_STORE_ID, name: '工坊', role: 'workshop' }
]

function fail(msg, code) {
  return { success: false, msg, code: code || 'FAIL' }
}

async function requireSuperAdmin(event, openid) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    permission: 'manageBookingRules',
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return { ok: false, res: fail(guard.msg, guard.code) }
  return { ok: true, actor: guard }
}

function normalizeSlot(raw, index) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const start = String(src.start || src.time || '').trim()
  const capacity = Math.max(1, Math.floor(Number(src.capacity != null ? src.capacity : src.limit) || 8))
  return {
    start,
    capacity,
    enabled: src.enabled !== false,
    sort: Number(src.sort) || (index + 1) * 10
  }
}

function normalizeRules(storeId, raw) {
  const defaults = getDefaultRules(storeId)
  const src = raw && typeof raw === 'object' ? raw : {}
  const slotSrc = Array.isArray(src.visitSlots) && src.visitSlots.length
    ? src.visitSlots
    : defaults.visitSlots
  const visitSlots = slotSrc
    .map((row, i) => normalizeSlot(row, i))
    .filter((s) => /^\d{1,2}:\d{2}$/.test(s.start))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))

  const closedDates = Array.isArray(src.closedDates)
    ? src.closedDates.map((d) => String(d || '').trim()).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    : []

  return {
    storeId: storeId || defaults.storeId,
    visitSlots: visitSlots.length ? visitSlots : defaults.visitSlots.map((s, i) => normalizeSlot(s, i)),
    closedDates,
    maxPerDay: Math.max(0, Math.floor(Number(src.maxPerDay != null ? src.maxPerDay : defaults.maxPerDay) || 0)),
    advanceDays: Math.max(1, Math.floor(Number(src.advanceDays != null ? src.advanceDays : defaults.advanceDays) || 7)),
    minAdvanceHours: Math.max(0, Math.floor(Number(src.minAdvanceHours != null ? src.minAdvanceHours : defaults.minAdvanceHours) || 0)),
    // 运行时强制全年不休；后台仍可展示但保存为 false
    weekendClosed: false
  }
}

function describeRules(rules) {
  const slots = (rules.visitSlots || []).filter((s) => s.enabled !== false)
  const closed = (rules.closedDates || []).length
  return `时段 ${slots.length} 个 · 日上限 ${rules.maxPerDay || '不限'} · 可提前 ${rules.advanceDays} 天 · 闭店日 ${closed} 个`
}

async function loadDoc(storeId) {
  try {
    const res = await db.collection(COLLECTION).where({ storeId }).limit(1).get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    if (/COLLECTION_NOT_EXIST|not exist|502005|-502005/i.test(String(e.message || e))) {
      return null
    }
    throw e
  }
}

async function listStores() {
  let stores = KNOWN_STORES.slice()
  try {
    const res = await db.collection('stores').limit(20).get()
    const rows = res.data || []
    if (rows.length) {
      const mapped = rows.map((s) => ({
        storeId: s.storeId || s._id,
        name: s.name || s.storeId || s._id,
        role: s.role || (s.storeId === WORKSHOP_STORE_ID ? 'workshop' : 'main')
      })).filter((s) => s.storeId)
      const ids = new Set(mapped.map((s) => s.storeId))
      KNOWN_STORES.forEach((k) => {
        if (!ids.has(k.storeId)) mapped.push(k)
      })
      stores = mapped
    }
  } catch (e) {
    /* 用内置门店 */
  }
  return { success: true, stores }
}

async function getRules(event) {
  const storeId = String((event && event.storeId) || MAIN_STORE_ID).trim() || MAIN_STORE_ID
  const raw = await loadDoc(storeId)
  const rules = normalizeRules(storeId, raw || {})
  return {
    success: true,
    storeId,
    rules,
    ruleText: describeRules(rules),
    docId: (raw && raw._id) || '',
    fromDefault: !raw
  }
}

async function saveRules(event, openid) {
  const auth = await requireSuperAdmin(event, openid)
  if (!auth.ok) return auth.res

  const storeId = String((event && event.storeId) || '').trim()
  if (!storeId) return fail('缺少 storeId')

  const rules = normalizeRules(storeId, (event && event.rules) || {})
  if (!(rules.visitSlots || []).some((s) => s.enabled !== false && s.start)) {
    return fail('请至少保留一个有效时段')
  }

  const data = {
    storeId,
    visitSlots: rules.visitSlots.map((s) => ({
      start: s.start,
      capacity: s.capacity
    })),
    closedDates: rules.closedDates,
    maxPerDay: rules.maxPerDay,
    advanceDays: rules.advanceDays,
    minAdvanceHours: rules.minAdvanceHours,
    weekendClosed: false,
    updatedBy: openid || (auth.actor && auth.actor.openid) || 'admin',
    updateTime: db.serverDate()
  }

  const docId = String((event && event.docId) || '').trim()
  try {
    if (docId) {
      await db.collection(COLLECTION).doc(docId).update({ data })
      return {
        success: true,
        docId,
        storeId,
        rules: normalizeRules(storeId, data),
        ruleText: describeRules(rules),
        msg: '预约规则已保存'
      }
    }
    const existing = await loadDoc(storeId)
    if (existing && existing._id) {
      await db.collection(COLLECTION).doc(existing._id).update({ data })
      return {
        success: true,
        docId: existing._id,
        storeId,
        rules: normalizeRules(storeId, data),
        ruleText: describeRules(rules),
        msg: '预约规则已保存'
      }
    }
    const added = await db.collection(COLLECTION).add({
      data: {
        ...data,
        createTime: db.serverDate(),
        createdBy: openid || 'admin'
      }
    })
    return {
      success: true,
      docId: added._id,
      storeId,
      rules: normalizeRules(storeId, data),
      ruleText: describeRules(rules),
      msg: '预约规则已保存'
    }
  } catch (e) {
    console.error('manageBookingRules save', e)
    if (/collection|集合|not exist|502005/i.test(String(e.message || e))) {
      return fail(`请先在云开发控制台创建集合 ${COLLECTION}`)
    }
    return fail(e.message || '保存失败')
  }
}

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID
  const action = (event && event.action) || 'get'
  try {
    const auth = await requireSuperAdmin(event, openid)
    if (!auth.ok) return auth.res
    if (action === 'save') return await saveRules(event, openid)
    if (action === 'listStores') return await listStores()
    return await getRules(event)
  } catch (e) {
    console.error('manageBookingRules', e)
    return fail(e.message || '服务异常')
  }
}
