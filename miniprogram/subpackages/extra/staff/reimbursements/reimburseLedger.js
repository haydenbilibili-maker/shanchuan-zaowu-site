/**
 * 报销账页（2026-10-18 仪式感 + 信息）：顶部本月合计 + 已通过的记录盖「核准」印。
 * 纯前端：只读 reimburseList 已返回的 amount / status / createTime / reviewedAt，不改云函数。
 * 云端只有 pending / approved / rejected 三态，「通过」≠「已打款」，所以印文是「核准」不是「已入账」。
 * 落印只在本机第一次看到这条通过时播；首次进页把已通过的全部记为看过（老记录静态）。
 */
const KEY = 'reimb_stamp_seen'
const MAX = 300

function toDate(v) {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function money(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100
  return v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 本月（按提交时间）已通过 / 审核中合计 */
function monthSummary(list, now) {
  const today = toDate(now) || new Date()
  let approved = 0
  let pending = 0
  let count = 0
  ;(Array.isArray(list) ? list : []).forEach((row) => {
    const d = toDate(row && row.createTime)
    if (!d || d.getFullYear() !== today.getFullYear() || d.getMonth() !== today.getMonth()) return
    count += 1
    if (row.status === 'approved') approved += Number(row.amount) || 0
    else if (row.status === 'pending') pending += Number(row.amount) || 0
  })
  return { month: today.getMonth() + 1, count, approvedText: money(approved), pendingText: money(pending), hasPending: pending > 0 }
}

/** 给已通过的打 stamped；本机第一次看到的通过打 stampLive */
function applyStamps(list, storage) {
  const rows = Array.isArray(list) ? list : []
  let seen = null
  try {
    const raw = storage.getStorageSync(KEY)
    seen = Array.isArray(raw) ? raw : null
  } catch (e) { seen = null }
  const first = seen === null
  const set = {}
  ;(seen || []).forEach((id) => { set[id] = true })
  const fresh = []
  const out = rows.map((row) => {
    const stamped = row.status === 'approved'
    const live = stamped && !first && !!row._id && !set[row._id]
    if (stamped && row._id && !set[row._id]) fresh.push(row._id)
    return { ...row, stamped, stampLive: live }
  })
  if (fresh.length || first) {
    try { storage.setStorageSync(KEY, (seen || []).concat(fresh).slice(-MAX)) } catch (e) { /* 存不下下次再播 */ }
  }
  return out
}

module.exports = { monthSummary, applyStamps, money, KEY }
