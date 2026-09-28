/**
 * 活动报名占位：校验活动可报 + 条件原子扣减 remain（where remain >= 人数 + inc(-人数)）。
 * 只在入参带 activityId 时走；不带的旧调用方行为不变。取消时由 cancelBooking 按 booking.seatHeld 归还。
 * 说明：miniprogram/docs/超管工作台_活动课程_升级_2026-09-28.md §9
 */
const { isActivityExpired } = require('./activityExpiry')

async function holdActivitySeat(db, _, { activityId, people, now }) {
  let act = null
  try {
    act = (await db.collection('activities').doc(activityId).get()).data
  } catch (e) {
    act = null
  }
  if (!act) return { ok: false, msg: '活动不存在或已下架' }
  if (act.status !== 'open') return { ok: false, msg: act.status === 'full' ? '名额已满' : '该活动已截止报名' }
  if (isActivityExpired(act, now)) return { ok: false, msg: '该活动已结束' }

  const n = Math.max(1, parseInt(people, 10) || 1)
  const max = Math.max(0, parseInt(act.maxPeople, 10) || 0)
  if (!max) return { ok: true, act, held: 0 }

  // 历史活动若没写 remain：先按名额补齐一次（条件更新，并发下只有一个生效）
  if (typeof act.remain !== 'number') {
    await db.collection('activities').where({ _id: activityId, remain: _.exists(false) }).update({ data: { remain: max } })
  }
  const res = await db.collection('activities')
    .where({ _id: activityId, status: 'open', remain: _.gte(n) })
    .update({ data: { remain: _.inc(-n) } })
  if (!res || !res.stats || res.stats.updated !== 1) return { ok: false, msg: '名额已满' }
  return { ok: true, act, held: n }
}

async function releaseActivitySeat(db, _, activityId, held) {
  if (!activityId || !(held > 0)) return
  await db.collection('activities').doc(activityId).update({ data: { remain: _.inc(held) } })
}

module.exports = { holdActivitySeat, releaseActivitySeat }
