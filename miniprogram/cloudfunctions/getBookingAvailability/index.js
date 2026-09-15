const cloud = require('wx-server-sdk')
const {
  getDefaultRules,
  isDateClosed,
  slotCapacity
} = require('./bookingRules')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function loadRules(storeId) {
  try {
    const res = await db.collection('store_booking_rules').where({ storeId }).limit(1).get()
    if (res.data && res.data.length) {
      const row = res.data[0]
      const defaults = getDefaultRules(storeId)
      return {
        ...defaults,
        ...row,
        visitSlots: row.visitSlots && row.visitSlots.length ? row.visitSlots : defaults.visitSlots,
        // 全年不休：门店周末正常营业，忽略库内旧 weekendClosed
        weekendClosed: false
      }
    }
  } catch (e) {
    console.warn('store_booking_rules read', e.message)
  }
  return getDefaultRules(storeId)
}

async function countSlotBookings(storeId, date, time) {
  try {
    const res = await db
      .collection('bookings')
      .where({
        storeId,
        date,
        time,
        status: _.in(['confirmed', 'pending'])
      })
      .get()
    let people = 0
    ;(res.data || []).forEach((b) => {
      people += Number(b.people) || 1
    })
    return people
  } catch (e) {
    console.warn('countSlotBookings', e.message)
    return 0
  }
}

async function countDayBookings(storeId, date) {
  try {
    const res = await db
      .collection('bookings')
      .where({
        storeId,
        date,
        status: _.in(['confirmed', 'pending'])
      })
      .get()
    let people = 0
    ;(res.data || []).forEach((b) => {
      people += Number(b.people) || 1
    })
    return people
  } catch (e) {
    return 0
  }
}

exports.main = async (event) => {
  const { storeId, date, type = 'museum_visit' } = event
  if (!storeId || !date) {
    return { success: false, msg: '缺少 storeId 或 date' }
  }

  const rules = await loadRules(storeId)
  const closed = isDateClosed(rules, date)
  const dayTotal = await countDayBookings(storeId, date)
  const dayFull = dayTotal >= (rules.maxPerDay || 40)

  if (closed) {
    return {
      success: true,
      data: {
        storeId,
        date,
        closed: true,
        closedReason: rules.weekendClosed && [0, 6].includes(parseDateDay(date)) ? 'weekend' : 'closed_date',
        dayFull: false,
        slots: []
      }
    }
  }

  const slots = []
  for (const s of rules.visitSlots || []) {
    const used = await countSlotBookings(storeId, date, s.start)
    const capacity = s.capacity || slotCapacity(rules, s.start)
    const remain = Math.max(0, capacity - used)
    let status = 'available'
    if (dayFull || remain <= 0) status = 'full'
    slots.push({
      time: s.start,
      capacity,
      remain,
      status
    })
  }

  return {
    success: true,
    data: {
      storeId,
      date,
      closed: false,
      dayFull,
      dayTotal,
      maxPerDay: rules.maxPerDay,
      slots
    }
  }
}

function parseDateDay(dateStr) {
  const parts = String(dateStr).split('-').map(Number)
  if (parts.length < 3) return -1
  return new Date(parts[0], parts[1] - 1, parts[2]).getDay()
}
