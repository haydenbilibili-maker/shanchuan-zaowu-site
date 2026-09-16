/**
 * 生日礼券发放
 *
 * action:
 *   claim   — 当前登录用户自助领取/补发
 *   process — 定时批处理
 *
 * 配置：member_birthday_gift（超管可配）；缺省用 birthdayGiftDefaults
 */
const cloud = require('wx-server-sdk')
const {
  SOURCE,
  COLLECTION,
  normalizeConfig,
  activeCoupons,
  getDefaultConfig
} = require('./birthdayGiftDefaults')
const { dispatchInAppMessage } = require('./inAppMessage')
const { validateCashCoupon } = require('./couponDiscountRules')
const { isNonClientSource } = require('./sourceOrigin')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const POINT_RECORDS = 'point_records'
const USER_COUPONS = 'user_coupons'
const USERS = 'users'


function isDuplicateKeyError(e) {
  const msg = (e && (e.message || e.errMsg)) || ''
  return /duplicate|E11000|已存在|unique/i.test(msg)
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function chinaParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const map = {}
  parts.forEach((p) => {
    if (p.type !== 'literal') map[p.type] = p.value
  })
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    mm: String(map.month).padStart(2, '0'),
    dd: String(map.day).padStart(2, '0'),
    dateStr: `${map.year}-${String(map.month).padStart(2, '0')}-${String(map.day).padStart(2, '0')}`
  }
}

function normalizeMonthDay(user) {
  if (user && user.birthdayMonthDay && /^\d{2}-\d{2}$/.test(user.birthdayMonthDay)) {
    return user.birthdayMonthDay
  }
  const birthday = user && user.birthday
  if (!birthday) return ''
  const parts = String(birthday).split('-')
  if (parts.length < 3) return ''
  return `${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`
}

function isBirthdayToday(monthDay, china) {
  if (!monthDay) return false
  const today = `${china.mm}-${china.dd}`
  if (monthDay === today) return true
  if (monthDay === '02-29' && today === '02-28' && !isLeapYear(china.year)) return true
  return false
}

function endOfBirthdayMonthExpire(china) {
  const lastDay = new Date(china.year, china.month, 0).getDate()
  return new Date(Date.UTC(china.year, china.month - 1, lastDay, 15, 59, 59, 999))
}

function expireByDays(china, days) {
  const d = Math.max(1, Math.floor(Number(days) || 30))
  const end = new Date(Date.UTC(china.year, china.month - 1, china.day, 15, 59, 59, 999))
  end.setUTCDate(end.getUTCDate() + d)
  return end
}

function resolveExpireTime(cfg, china) {
  if (cfg && cfg.expireMode === 'days') {
    return expireByDays(china, cfg.expireDays)
  }
  return endOfBirthdayMonthExpire(china)
}

function formatDateLabel(date) {
  const d = date instanceof Date ? date : new Date(date)
  const parts = chinaParts(d)
  return `${parts.year}-${parts.mm}-${parts.dd}`
}

function giftDedupeKey(openid, year) {
  return `${SOURCE}:${openid}:${year}`
}

async function loadGiftConfig() {
  try {
    const res = await db.collection(COLLECTION).limit(5).get()
    const rows = (res.data || []).slice().sort((a, b) =>
      (Number(b.priority) || 0) - (Number(a.priority) || 0)
      || (Number(b.updateTime) || 0) - (Number(a.updateTime) || 0)
    )
    return normalizeConfig(rows[0] || {})
  } catch (e) {
    if (/COLLECTION_NOT_EXIST|not exist|502005|-502005/i.test(String(e.message || e))) {
      return normalizeConfig(getDefaultConfig())
    }
    console.warn('claimBirthdayGift loadGiftConfig', e.message || e)
    return normalizeConfig(getDefaultConfig())
  }
}

async function findUserByOpenid(openid) {
  const res = await db.collection(USERS).where({ _openid: openid }).limit(1).get()
  return (res.data && res.data[0]) || null
}

async function findGiftRecord(dedupeKey) {
  try {
    const res = await db.collection(POINT_RECORDS).where({ dedupeKey }).limit(1).get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    return null
  }
}

function totalCouponSheets(coupons) {
  return (coupons || []).reduce((sum, c) => sum + (Number(c.count) || 0), 0)
}

async function grantCoupons(openid, year, expireTime, recordId, coupons) {
  const ids = []
  for (let i = 0; i < coupons.length; i += 1) {
    const slot = coupons[i]
    const spendCheck = validateCashCoupon(slot.value, slot.minSpend)
    if (!spendCheck.ok) {
      throw new Error(spendCheck.msg || '生日礼券档位不符合折扣纪律')
    }
    const count = Math.max(0, Math.floor(Number(slot.count) || 0))
    for (let n = 0; n < count; n += 1) {
      const added = await db.collection(USER_COUPONS).add({
        data: {
          _openid: openid,
          couponId: slot.id || `birthday_gift_${slot.value}`,
          couponSource: SOURCE,
          title: slot.title || `生日礼券 · 满${slot.minSpend}减${slot.value}`,
          type: 'cash',
          value: slot.value,
          minSpend: slot.minSpend,
          status: 'unused',
          source: SOURCE,
          sourceYear: year,
          sourceRefId: recordId,
          receiveType: 'auto',
          channel: slot.channel || 'all',
          createTime: db.serverDate(),
          expireTime
        }
      })
      ids.push(added._id)
    }
  }
  return ids
}

/**
 * @returns {Promise<object>}
 */
async function claimForOpenid(openid) {
  if (!openid) return { success: false, msg: '缺少 openid' }

  const cfg = await loadGiftConfig()
  if (!cfg.enabled) {
    return { success: true, granted: false, reason: 'disabled', isBirthdayToday: false }
  }

  const coupons = activeCoupons(cfg)
  const points = cfg.pointsEnabled ? Math.max(0, Math.floor(Number(cfg.points) || 0)) : 0
  if (!(points > 0) && !coupons.length) {
    return { success: true, granted: false, reason: 'empty_config', isBirthdayToday: false }
  }

  const china = chinaParts()
  const year = china.year
  const dedupeKey = giftDedupeKey(openid, year)

  const user = await findUserByOpenid(openid)
  if (!user) {
    return { success: true, granted: false, reason: 'no_user', isBirthdayToday: false }
  }

  const monthDay = normalizeMonthDay(user)
  if (!monthDay) {
    return { success: true, granted: false, reason: 'no_birthday', isBirthdayToday: false }
  }

  const today = isBirthdayToday(monthDay, china)
  if (!today) {
    return {
      success: true,
      granted: false,
      reason: 'not_birthday',
      isBirthdayToday: false,
      birthdayMonthDay: monthDay
    }
  }

  if (Number(user.birthdayGiftYear) === year) {
    return {
      success: true,
      granted: false,
      alreadyGranted: true,
      isBirthdayToday: true,
      year,
      reason: 'already_granted_user'
    }
  }

  const existing = await findGiftRecord(dedupeKey)
  if (existing && existing.status === 'done') {
    if (user._id && Number(user.birthdayGiftYear) !== year) {
      try {
        await db.collection(USERS).doc(user._id).update({
          data: { birthdayGiftYear: year, updateTime: db.serverDate() }
        })
      } catch (e) { /* ignore */ }
    }
    return {
      success: true,
      granted: false,
      alreadyGranted: true,
      isBirthdayToday: true,
      year,
      reason: 'already_granted_record'
    }
  }

  const expireTime = resolveExpireTime(cfg, china)
  const expireDate = formatDateLabel(expireTime)
  const couponSheetTotal = totalCouponSheets(coupons)
  const primaryCoupon = coupons[0] || null

  let recordId = existing && existing._id ? existing._id : ''
  if (!recordId) {
    try {
      const added = await db.collection(POINT_RECORDS).add({
        data: {
          _openid: openid,
          userOpenid: openid,
          type: 'earn',
          source: SOURCE,
          action: SOURCE,
          points,
          title: cfg.pointsTitle || '生日礼券 · 专属积分',
          excludeGrowth: cfg.excludeGrowth !== false,
          dedupeKey,
          status: 'pending',
          dateStr: china.dateStr,
          giftYear: year,
          createTime: db.serverDate()
        }
      })
      recordId = added._id
    } catch (e) {
      if (isDuplicateKeyError(e)) {
        return {
          success: true,
          granted: false,
          alreadyGranted: true,
          isBirthdayToday: true,
          year,
          reason: 'dedupe_race'
        }
      }
      console.error('claimBirthdayGift add point_record', e)
      return { success: false, msg: '生日礼券发放失败，请稍后重试' }
    }
  }

  if (points > 0) {
    try {
      await db.collection(USERS).doc(user._id).update({
        data: {
          bonusPoints: _.inc(points),
          birthdayGiftYear: year,
          updateTime: db.serverDate()
        }
      })
    } catch (e) {
      console.error('claimBirthdayGift inc bonusPoints', e)
      try {
        await db.collection(POINT_RECORDS).doc(recordId).update({
          data: { status: 'rolled_back', rollbackReason: 'points_failed', rollbackTime: db.serverDate() }
        })
      } catch (err) { /* ignore */ }
      return { success: false, msg: '积分入账失败' }
    }
  } else {
    try {
      await db.collection(USERS).doc(user._id).update({
        data: { birthdayGiftYear: year, updateTime: db.serverDate() }
      })
    } catch (e) {
      console.warn('claimBirthdayGift mark year', e.message)
    }
  }

  let couponIds = []
  try {
    const priorCoupons = await db.collection(USER_COUPONS)
      .where({ _openid: openid, source: SOURCE, sourceYear: year })
      .limit(Math.max(couponSheetTotal, 1))
      .get()
    if (priorCoupons.data && priorCoupons.data.length >= couponSheetTotal && couponSheetTotal > 0) {
      couponIds = priorCoupons.data.map((c) => c._id)
    } else if (coupons.length) {
      couponIds = await grantCoupons(openid, year, expireTime, recordId, coupons)
    }
  } catch (e) {
    console.error('claimBirthdayGift grant coupons', e)
  }

  try {
    await db.collection(POINT_RECORDS).doc(recordId).update({
      data: {
        status: 'done',
        couponIds,
        couponCount: couponIds.length,
        expireTime,
        doneTime: db.serverDate()
      }
    })
  } catch (e) {
    console.warn('claimBirthdayGift finalize record', e.message)
  }

  try {
    await dispatchInAppMessage(db, {
      eventType: 'birthday_gift',
      openid,
      relatedId: String(year),
      vars: {
        points,
        couponCount: couponIds.length || couponSheetTotal,
        couponValue: primaryCoupon ? primaryCoupon.value : 0,
        minSpend: primaryCoupon ? primaryCoupon.minSpend : 0,
        expireDate
      }
    })
  } catch (e) {
    console.warn('claimBirthdayGift message', e.message)
  }

  return {
    success: true,
    granted: true,
    isBirthdayToday: true,
    year,
    points,
    excludeGrowth: cfg.excludeGrowth !== false,
    couponCount: couponIds.length,
    couponValue: primaryCoupon ? primaryCoupon.value : 0,
    minSpend: primaryCoupon ? primaryCoupon.minSpend : 0,
    couponIds,
    expireDate,
    msg: '生日礼券已到账'
  }
}

async function processBatch() {
  const cfg = await loadGiftConfig()
  if (!cfg.enabled) {
    return { success: true, action: 'process', skipped: true, reason: 'disabled' }
  }
  const china = chinaParts()
  const todayMd = `${china.mm}-${china.dd}`
  const candidates = new Set([todayMd])
  if (todayMd === '02-28' && !isLeapYear(china.year)) {
    candidates.add('02-29')
  }

  const openids = new Set()
  const mdList = Array.from(candidates)
  const batchLimit = Math.max(1, Number(cfg.processBatchLimit) || 40)

  for (let i = 0; i < mdList.length; i += 1) {
    const md = mdList[i]
    try {
      const res = await db.collection(USERS)
        .where({
          birthdayMonthDay: md,
          birthdayGiftYear: _.neq(china.year)
        })
        .limit(batchLimit)
        .get()
      ;(res.data || []).forEach((u) => {
        if (u && u._openid) openids.add(u._openid)
      })
    } catch (e) {
      try {
        const res = await db.collection(USERS)
          .where({ birthdayMonthDay: md })
          .limit(batchLimit)
          .get()
        ;(res.data || []).forEach((u) => {
          if (u && u._openid && Number(u.birthdayGiftYear) !== china.year) {
            openids.add(u._openid)
          }
        })
      } catch (err) {
        console.warn('processBatch query', err.message)
      }
    }
  }

  const results = []
  const list = Array.from(openids).slice(0, batchLimit)
  for (let i = 0; i < list.length; i += 1) {
    try {
      const r = await claimForOpenid(list[i])
      results.push({ openid: list[i], ...r })
    } catch (e) {
      results.push({ openid: list[i], success: false, msg: e.message })
    }
  }

  return {
    success: true,
    action: 'process',
    dateStr: china.dateStr,
    scanned: list.length,
    granted: results.filter((r) => r.granted).length,
    results
  }
}

exports.main = async (event) => {
  const isTimer = !!(event && (event.Type === 'Timer' || event.TriggerName || event.triggerName)) && isNonClientSource()
  const action = isTimer
    ? 'process'
    : (String((event && event.action) || 'claim').trim() || 'claim')

  if (action === 'process') {
    return processBatch()
  }

  const openid = cloud.getWXContext().OPENID
  if (!openid) return { success: false, msg: '请先登录' }
  return claimForOpenid(openid)
}
