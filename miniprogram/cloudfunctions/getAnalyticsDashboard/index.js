const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function getAdminOpenids() {
  const env = process.env.MESSAGE_ADMIN_OPENIDS || ''
  return env.split(',').map((s) => s.trim()).filter(Boolean)
}

function isAdmin(openid) {
  const admins = getAdminOpenids()
  if (!admins.length) return true
  return admins.includes(openid)
}

function parseRange(days = 7) {
  const d = Math.min(Math.max(parseInt(days, 10) || 7, 1), 90)
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date(end)
  start.setDate(start.getDate() - (d - 1))
  start.setHours(0, 0, 0, 0)
  return { startTs: start.getTime(), endTs: end.getTime(), days: d }
}

function dateKeysInRange(startTs, endTs) {
  const keys = []
  const cur = new Date(startTs)
  cur.setHours(0, 0, 0, 0)
  const end = new Date(endTs)
  while (cur <= end) {
    const y = cur.getFullYear()
    const m = String(cur.getMonth() + 1).padStart(2, '0')
    const day = String(cur.getDate()).padStart(2, '0')
    keys.push(`${y}-${m}-${day}`)
    cur.setDate(cur.getDate() + 1)
  }
  return keys
}

function aggregateRows(rows) {
  const byAction = {}
  const byModule = {}
  const byPage = {}
  const users = new Set()
  const byDay = {}

  rows.forEach((r) => {
    const action = r.action || 'unknown'
    const module = r.module || 'system'
    const page = r.page || ''
    const dk = r.dateKey || ''
    users.add(r.userId)

    byAction[action] = (byAction[action] || 0) + 1
    byModule[module] = (byModule[module] || 0) + 1
    if (page) byPage[page] = (byPage[page] || 0) + 1
    if (dk) byDay[dk] = (byDay[dk] || 0) + 1
  })

  const toSorted = (obj, limit = 15) =>
    Object.keys(obj)
      .map((k) => ({ key: k, count: obj[k] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)

  return {
    totalEvents: rows.length,
    uniqueUsers: users.size,
    pageViews: byAction.page_view || 0,
    byAction: toSorted(byAction, 20),
    byModule: toSorted(byModule, 12),
    byPage: toSorted(byPage, 15),
    byDay: toSorted(byDay, 31)
  }
}

function buildFunnel(rows) {
  const count = (action) => rows.filter((r) => r.action === action).length
  return {
    identify: {
      entry: count('identify_entry_click'),
      start: count('identify_start'),
      success: count('identify_success'),
      resultView: count('identify_result_view'),
      saveAtlas: count('identify_save_atlas')
    },
    store: {
      tabEnter: count('store_tab_enter'),
      zoneDetail: count('store_zone_detail'),
      bookingClick: count('store_booking_click'),
      checkin: count('store_checkin')
    },
    commerce: {
      productView: count('product_view') + count('view'),
      addCart: count('product_add_cart'),
      orderSubmit: count('order_submit')
    }
  }
}

async function loadBehaviors(startTs, endTs, limit = 2000) {
  const res = await db
    .collection('user_behaviors')
    .where({
      timestamp: _.gte(startTs).and(_.lte(endTs))
    })
    .field({
      action: true,
      module: true,
      page: true,
      userId: true,
      dateKey: true,
      timestamp: true
    })
    .orderBy('timestamp', 'desc')
    .limit(limit)
    .get()
  return res.data || []
}

async function loadDailyRollup(dateKeys) {
  if (!dateKeys.length) return []
  try {
    const res = await db
      .collection('analytics_daily')
      .where({ dateKey: _.in(dateKeys) })
      .limit(500)
      .get()
    return res.data || []
  } catch (e) {
    return []
  }
}

async function overview(event) {
  const { startTs, endTs, days } = parseRange(event.days)
  const dateKeys = dateKeysInRange(startTs, endTs)
  const [rows, daily] = await Promise.all([
    loadBehaviors(startTs, endTs),
    loadDailyRollup(dateKeys)
  ])

  const agg = aggregateRows(rows)
  const funnel = buildFunnel(rows)

  let dailyTrend = dateKeys.map((dk) => {
    const dayRows = daily.filter((d) => d.dateKey === dk)
    const pv = dayRows.filter((d) => d.action === 'page_view').reduce((s, d) => s + (d.count || 0), 0)
    const total = dayRows.reduce((s, d) => s + (d.count || 0), 0)
    return { dateKey: dk, pageViews: pv, totalEvents: total }
  })

  if (!daily.length && rows.length) {
    dailyTrend = agg.byDay.map(({ key, count }) => ({
      dateKey: key,
      pageViews: rows.filter((r) => r.dateKey === key && r.action === 'page_view').length,
      totalEvents: count
    }))
  }

  return {
    range: { startTs, endTs, days },
    summary: agg,
    funnel,
    dailyTrend,
    sampled: rows.length >= 2000,
    note: rows.length >= 2000 ? '数据已采样最近 2000 条，UV 为采样内估算' : ''
  }
}

async function topEvents(event) {
  const { startTs, endTs } = parseRange(event.days)
  const rows = await loadBehaviors(startTs, endTs, 3000)
  return { events: aggregateRows(rows).byAction }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!isAdmin(openid)) {
    return { success: false, msg: '无管理权限' }
  }

  const { action = 'overview' } = event

  try {
    let data
    switch (action) {
      case 'topEvents':
        data = await topEvents(event)
        break
      case 'overview':
      default:
        data = await overview(event)
    }
    return { success: true, data }
  } catch (e) {
    console.error('getAnalyticsDashboard', e)
    return { success: false, msg: e.message }
  }
}
