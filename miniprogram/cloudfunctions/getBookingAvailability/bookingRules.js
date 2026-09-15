const WORKSHOP_STORE_ID = 'store_xingchen'
const MAIN_STORE_ID = 'store_shanhaizaowu'
const LOCKED_WORKSHOP_TYPES = ['custom_confirm', 'pet_intake']

function buildDefaultVisitSlots(storeId) {
  const times =
    storeId === WORKSHOP_STORE_ID
      ? ['10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00']
      : ['10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00']
  const capacity = storeId === WORKSHOP_STORE_ID ? 4 : 8
  return times.map((start) => ({ start, capacity }))
}

function getDefaultRules(storeId) {
  return {
    storeId: storeId || MAIN_STORE_ID,
    visitSlots: buildDefaultVisitSlots(storeId || MAIN_STORE_ID),
    closedDates: [],
    maxPerDay: storeId === WORKSHOP_STORE_ID ? 20 : 40,
    weekendClosed: false,
    advanceDays: 7,
    minAdvanceHours: 2
  }
}

function parseDateStr(dateStr) {
  if (!dateStr) return null
  const parts = String(dateStr).split('-').map(Number)
  if (parts.length < 3) return null
  return new Date(parts[0], parts[1] - 1, parts[2])
}

function isWeekend(dateStr) {
  const d = parseDateStr(dateStr)
  if (!d) return false
  const day = d.getDay()
  return day === 0 || day === 6
}

function isDateClosed(rules, dateStr) {
  if (!dateStr) return true
  if (rules.weekendClosed && isWeekend(dateStr)) return true
  return (rules.closedDates || []).includes(dateStr)
}

function slotCapacity(rules, time) {
  const slot = (rules.visitSlots || []).find((s) => s.start === time)
  return slot ? slot.capacity : 8
}

function validateWorkshopStoreLock(type, storeId) {
  if (LOCKED_WORKSHOP_TYPES.includes(type) && storeId !== WORKSHOP_STORE_ID) {
    return { ok: false, msg: '定制与伴宠服务需预约星宸标本工作室' }
  }
  return { ok: true }
}

module.exports = {
  WORKSHOP_STORE_ID,
  MAIN_STORE_ID,
  LOCKED_WORKSHOP_TYPES,
  getDefaultRules,
  buildDefaultVisitSlots,
  isDateClosed,
  isWeekend,
  slotCapacity,
  validateWorkshopStoreLock
}
