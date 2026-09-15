const cloud = require('wx-server-sdk')
const { assertStaff } = require('./staffGuard')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function startOfLocalDayMs() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

async function resolveStoreName(db, storeId, provided) {
  const given = String(provided || '').trim()
  if (given) return given
  if (!storeId) return '门店'
  try {
    const res = await db.collection('stores').where({ storeId }).limit(1).get()
    const row = res.data && res.data[0]
    const fromDb = row && String(row.name || '').trim()
    if (fromDb) return fromDb
  } catch (e) {}
  return '门店'
}

async function dispatchVisitThanks(openid, storeId, storeName) {
  try {
    await cloud.callFunction({
      name: 'dispatchMessage',
      data: {
        action: 'dispatch',
        eventType: 'store_visit_thanks',
        openid,
        relatedId: storeId,
        vars: { storeName: storeName || '门店' }
      }
    })
  } catch (e) {
    console.warn('store_visit_thanks message skipped', e.message)
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action = 'checkIn', storeId, storeName, source = 'manual' } = event

  if (action === 'getTodayStatus') {
    if (!openid) return { success: true, checkedIn: false }
    if (!storeId) return { success: false, msg: '缺少 storeId' }
    const since = startOfLocalDayMs()
    try {
      const prev = await db
        .collection('store_visits')
        .where({ _openid: openid, storeId, visitAt: _.gte(since) })
        .limit(1)
        .get()
      return { success: true, checkedIn: !!(prev.data && prev.data.length) }
    } catch (e) {
      return { success: true, checkedIn: false, fallback: true }
    }
  }

  if (action === 'getTodayStats') {
    const guard = await assertStaff(db, openid, {
      permission: 'viewStoreVisits',
      storeId
    })
    if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }
    const since = startOfLocalDayMs()
    try {
      const res = await db.collection('store_visits').where({ visitAt: _.gte(since) }).get()
      const rows = res.data || []
      const byStore = {}
      rows.forEach((v) => {
        const id = v.storeId || 'unknown'
        byStore[id] = (byStore[id] || 0) + 1
      })
      return { success: true, data: { total: rows.length, byStore, since } }
    } catch (e) {
      return { success: true, data: { total: 0, byStore: {}, since }, fallback: true }
    }
  }

  if (!openid) return { success: false, msg: '请先登录' }
  if (!storeId) return { success: false, msg: '缺少 storeId' }

  const since = startOfLocalDayMs()
  try {
    const prev = await db
      .collection('store_visits')
      .where({ _openid: openid, storeId, visitAt: _.gte(since) })
      .limit(1)
      .get()
    if (prev.data && prev.data.length) {
      return { success: true, already: true, msg: '今日已签到' }
    }

    await db.collection('store_visits').add({
      data: {
        _openid: openid,
        storeId,
        visitAt: Date.now(),
        source: source === 'scan' ? 'scan' : 'manual',
        bookingId: event.bookingId || ''
      }
    })

    const resolvedName = await resolveStoreName(db, storeId, storeName)
    await dispatchVisitThanks(openid, storeId, resolvedName)

    let atlas = null
    try {
      const ar = await cloud.callFunction({
        name: 'manageAtlas',
        data: { action: 'collectAfterVisit', openid, storeName: resolvedName }
      })
      const payload = (ar && ar.result) || {}
      atlas = (payload.data && payload.data.encounter) || payload.encounter || null
    } catch (e) {
      console.warn('atlas after visit skipped', e.message)
    }

    return { success: true, already: false, atlas }
  } catch (e) {
    console.error('storeCheckIn', e)
    if (/collection|集合/.test(e.message || '')) {
      return { success: false, msg: '签到服务初始化中，请稍后重试' }
    }
    return { success: false, msg: e.message || '签到失败' }
  }
}
