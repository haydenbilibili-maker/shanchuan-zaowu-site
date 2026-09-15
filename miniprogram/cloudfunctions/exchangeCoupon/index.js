/**
 * 积分兑换代金券
 *
 * 复用既有链路：rewards(type=coupon) → user_coupons(type=cash) → makeOrder/pricing.js → fulfillOrder 核销。
 * 从 redeemReward 拆出「券」这一条分支单独加固幂等与流水，实物/虚拟兑换仍走 redeemReward。
 *
 * 原子性：point_records.dedupeKey 唯一索引挡重复 + pending 状态机 + 失败即回滚，不引入云开发事务。
 */
const cloud = require('wx-server-sdk')
const { loadBalance, ensureUserDoc } = require('./pointsBalance')
const { dispatchInAppMessage } = require('./inAppMessage')
const { normalizeCouponChannel } = require('./couponChannel')
const { validateCashCoupon, defaultMinSpendForValue } = require('./couponDiscountRules')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const POINT_RECORDS = 'point_records'
const USER_COUPONS = 'user_coupons'
const DEFAULT_EXPIRE_DAYS = 30

function fail(msg, extra) {
  return { success: false, msg, ...(extra || {}) }
}

function isDuplicateKeyError(e) {
  const msg = (e && (e.message || e.errMsg)) || ''
  return /duplicate|E11000|已存在|unique/i.test(msg)
}

function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function countUserExchanges(openid, rewardId) {
  try {
    const res = await db.collection(POINT_RECORDS)
      .where({ userOpenid: openid, refId: rewardId, source: 'coupon_exchange', status: _.in(['pending', 'done']) })
      .count()
    return res.total || 0
  } catch (e) {
    console.warn('exchangeCoupon countUserExchanges failed:', e.message)
    return 0
  }
}

async function findExistingRecord(dedupeKey) {
  try {
    const res = await db.collection(POINT_RECORDS).where({ dedupeKey }).limit(1).get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    return null
  }
}

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID
  if (!openid) return fail('请先登录')

  const rewardId = String((event && event.rewardId) || '').trim()
  const clientRequestId = String((event && event.clientRequestId) || '').trim()
  if (!rewardId) return fail('参数错误')
  if (!clientRequestId) return fail('缺少请求标识，请重新进入兑换')

  const dedupeKey = `exchange:${openid}:${clientRequestId}`

  try {
    const existing = await findExistingRecord(dedupeKey)
    if (existing && existing.status === 'done') {
      return {
        success: true,
        duplicated: true,
        userCouponId: existing.refCouponId || '',
        costPoints: Math.abs(Number(existing.points) || 0),
        leftPoints: Number(existing.balanceAfter) || 0,
        msg: '该兑换已完成'
      }
    }
    if (existing && existing.status === 'pending') {
      return fail('上一次兑换正在处理中，请稍后在我的券夹确认')
    }

    let reward = null
    try {
      const rewardDoc = await db.collection('rewards').doc(rewardId).get()
      reward = rewardDoc.data
    } catch (e) {
      return fail('权益不存在或已下架')
    }
    if (!reward || reward.isOffShelf) return fail('权益不存在或已下架')
    if ((reward.type || 'virtual') !== 'coupon') return fail('该权益不是代金券，请走常规兑换')

    const stock = parseInt(reward.stock, 10) || 0
    if (stock <= 0) return fail('已兑完')

    const cost = parseInt(reward.cost, 10) || 0
    if (cost <= 0) return fail('权益配置无效')

    const limitPerUser = parseInt(reward.limitPerUser, 10) || 0
    if (limitPerUser > 0) {
      const used = await countUserExchanges(openid, rewardId)
      if (used >= limitPerUser) return fail(`每人限兑 ${limitPerUser} 次`)
    }

    const balance = await loadBalance(db, openid)
    if (balance.available < cost) return fail('积分不足')

    // 面额/门槛/有效期/渠道一律读 rewards 云库配置，禁止前端常量
    const couponValue = Number(reward.value)
    if (!Number.isFinite(couponValue) || couponValue <= 0) return fail('代金券面额未配置')
    const minSpendRaw = Number(reward.minSpend)
    const minSpend = Number.isFinite(minSpendRaw) && minSpendRaw > 0
      ? Math.floor(minSpendRaw)
      : defaultMinSpendForValue(couponValue)
    const spendCheck = validateCashCoupon(couponValue, minSpend)
    if (!spendCheck.ok) {
      return fail(spendCheck.msg || '该代金券门槛配置违规，请联系店长调整')
    }
    const expireDays = parseInt(reward.expireDays, 10) > 0 ? parseInt(reward.expireDays, 10) : DEFAULT_EXPIRE_DAYS
    const expireTime = new Date(Date.now() + expireDays * 24 * 60 * 60 * 1000)
    const title = reward.title || `${couponValue} 元代金券`
    const image = reward.image || ''
    const channel = normalizeCouponChannel(reward.channel)

    // 1. 先落幂等键（唯一索引挡住连点）
    let recordId = ''
    try {
      const added = await db.collection(POINT_RECORDS).add({
        data: {
          _openid: openid,
          userOpenid: openid,
          type: 'spend',
          source: 'coupon_exchange',
          action: 'coupon_exchange',
          points: -cost,
          title: `兑换 ${title}`,
          refCollection: 'rewards',
          refId: rewardId,
          dedupeKey,
          status: 'pending',
          clientRequestId,
          dateStr: formatDate(new Date()),
          createTime: db.serverDate()
        }
      })
      recordId = added._id
    } catch (e) {
      if (isDuplicateKeyError(e)) return fail('请勿重复提交')
      console.error('exchangeCoupon add point_record', e)
      return fail('积分流水写入失败')
    }

    const rollback = async (reason) => {
      try {
        await db.collection(POINT_RECORDS).doc(recordId).update({
          data: { status: 'rolled_back', rollbackReason: reason, rollbackTime: db.serverDate() }
        })
      } catch (err) {
        console.warn('exchangeCoupon rollback record failed:', err.message)
      }
    }

    // 2. 扣积分
    const userDocId = balance.userDocId || await ensureUserDoc(db, openid)
    try {
      await db.collection('users').doc(userDocId).update({ data: { usedPoints: _.inc(cost) } })
    } catch (e) {
      await rollback('deduct_failed')
      return fail('积分扣减失败，请重试')
    }

    // 3. 扣库存，扣成负数则回滚
    try {
      await db.collection('rewards').doc(rewardId).update({ data: { stock: _.inc(-1) } })
      const recheck = await db.collection('rewards').doc(rewardId).get()
      if (recheck.data && (parseInt(recheck.data.stock, 10) || 0) < 0) {
        await db.collection('rewards').doc(rewardId).update({ data: { stock: _.inc(1) } })
        await db.collection('users').doc(userDocId).update({ data: { usedPoints: _.inc(-cost) } })
        await rollback('out_of_stock')
        return fail('已兑完')
      }
    } catch (e) {
      await db.collection('users').doc(userDocId).update({ data: { usedPoints: _.inc(-cost) } }).catch(() => {})
      await rollback('stock_failed')
      return fail('库存扣减失败，请重试')
    }

    // 4. 发券
    let userCouponId = ''
    try {
      const added = await db.collection(USER_COUPONS).add({
        data: {
          _openid: openid,
          couponId: rewardId,
          couponSource: 'reward',
          title,
          type: 'cash',
          value: couponValue,
          minSpend,
          status: 'unused',
          source: 'points_exchange',
          sourceRefId: recordId,
          costPoints: cost,
          channel,
          receiveType: 'exchange',
          createTime: db.serverDate(),
          expireTime,
          image
        }
      })
      userCouponId = added._id
    } catch (e) {
      await db.collection('rewards').doc(rewardId).update({ data: { stock: _.inc(1) } }).catch(() => {})
      await db.collection('users').doc(userDocId).update({ data: { usedPoints: _.inc(-cost) } }).catch(() => {})
      await rollback('issue_failed')
      console.error('exchangeCoupon add user_coupon', e)
      return fail('发券失败，积分已退回，请重试')
    }

    // 5. 收尾：置 done + 兑换单（points 页「我的兑换」依赖 orders.source='exchange'）
    const after = await loadBalance(db, openid)
    try {
      await db.collection(POINT_RECORDS).doc(recordId).update({
        data: { status: 'done', refCouponId: userCouponId, balanceAfter: after.displayAvailable }
      })
    } catch (e) {
      console.warn('exchangeCoupon finalize record failed:', e.message)
    }

    try {
      await db.collection('orders').add({
        data: {
          _openid: openid,
          orderNo: 'EX' + Date.now(),
          createTime: db.serverDate(),
          status: 'exchanged',
          source: 'exchange',
          totalPrice: 0,
          costPoints: cost,
          products: [{ id: rewardId, title, image, price: cost + ' PTS', latin: 'COUPON' }],
          count: 1,
          address: { name: '系统发放', phone: '', detail: '自动充值' }
        }
      })
    } catch (e) {
      console.warn('exchangeCoupon exchange order write failed:', e.message)
    }

    try {
      await dispatchInAppMessage(db, {
        eventType: 'coupon_exchanged',
        openid,
        relatedId: userCouponId,
        vars: {
          couponTitle: title,
          expireDate: formatDate(expireTime),
          costPoints: String(cost)
        }
      })
    } catch (e) {
      console.warn('coupon_exchanged message skipped:', e.message)
    }

    return {
      success: true,
      userCouponId,
      costPoints: cost,
      leftPoints: after.displayAvailable,
      coupon: { title, value: couponValue, minSpend, expireDate: formatDate(expireTime), channel },
      msg: '兑换成功，券已放入我的券夹'
    }
  } catch (e) {
    console.error('exchangeCoupon', e)
    return fail(e.message || '系统繁忙')
  }
}
