/**
 * 钱包充值成功后的积分 / 成长值发放（与门店口径对齐：每满 ¥1 → 1 积分 + 1 成长值）
 *
 * - 可用积分：写入 users.bonusPoints（不并入订单成长，避免与线上订单公式双计积分）
 * - 等级成长：写入 users.storeGrowthValue（与门店一致，计入会员等级）
 * - 幂等键：point_records.dedupeKey = wallet_recharge:{outTradeNo}
 *
 * 说明：后续用钱包余额下单时，订单仍可能按 totalPrice 计线上成长；
 * 本链路只保证「充值入账」与支付回调一致、可重试不重复发分。
 */

const POINT_RECORDS = 'point_records'

function calcRechargePoints(payFen) {
  const fen = Math.max(0, Math.round(Number(payFen) || 0))
  return Math.floor(fen / 100)
}

function isDuplicateKeyError(err) {
  const msg = String((err && (err.message || err.errMsg)) || '')
  return /duplicate|E11000|已存在|unique/i.test(msg)
}

async function loadUserDoc(db, openid) {
  try {
    const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    console.warn('rechargeRewards loadUserDoc', e && e.message)
    return null
  }
}

async function ensureUserDoc(db, openid) {
  const existing = await loadUserDoc(db, openid)
  if (existing) return existing._id
  const added = await db.collection('users').add({
    data: {
      _openid: openid,
      bonusPoints: 0,
      usedPoints: 0,
      storeGrowthValue: 0,
      createTime: db.serverDate()
    }
  })
  return added._id
}

async function findRecordByDedupe(db, dedupeKey) {
  try {
    const res = await db.collection(POINT_RECORDS).where({ dedupeKey }).limit(1).get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    return null
  }
}

/**
 * @returns {{ success: boolean, points?: number, growth?: number, alreadyGranted?: boolean, skipped?: boolean, msg?: string }}
 */
async function grantRechargeRewards(db, _, order) {
  if (!order || !order.openid || !order.outTradeNo) {
    return { success: false, msg: '充值单无效，无法发分' }
  }

  const payFen = Number(order.principalFen) || Number(order.payFen) || 0
  const points = calcRechargePoints(payFen)
  if (points <= 0) {
    return { success: true, points: 0, growth: 0, skipped: true }
  }

  const dedupeKey = `wallet_recharge:${order.outTradeNo}`
  const existing = await findRecordByDedupe(db, dedupeKey)
  if (existing) {
    return {
      success: true,
      points: Number(existing.points) || points,
      growth: Number(existing.points) || points,
      alreadyGranted: true
    }
  }

  const yuan = (payFen / 100).toFixed(payFen % 100 === 0 ? 0 : 2)
  let recordId = ''
  try {
    const added = await db.collection(POINT_RECORDS).add({
      data: {
        _openid: order.openid,
        userOpenid: order.openid,
        type: 'earn',
        source: 'wallet_recharge',
        action: 'wallet_recharge',
        points,
        title: `钱包充值 ¥${yuan}`,
        refCollection: 'stored_value_recharge_orders',
        refId: order._id || '',
        outTradeNo: order.outTradeNo,
        dedupeKey,
        status: 'pending',
        dateStr: new Date().toISOString().slice(0, 10),
        expireTime: null,
        createTime: db.serverDate()
      }
    })
    recordId = added._id
  } catch (e) {
    if (isDuplicateKeyError(e)) {
      return { success: true, points, growth: points, alreadyGranted: true }
    }
    console.error('rechargeRewards add point_record', e)
    return { success: false, msg: '积分流水写入失败' }
  }

  try {
    const userDocId = await ensureUserDoc(db, order.openid)
    await db.collection('users').doc(userDocId).update({
      data: {
        bonusPoints: _.inc(points),
        storeGrowthValue: _.inc(points),
        walletRechargePointsTotal: _.inc(points)
      }
    })
  } catch (e) {
    console.error('rechargeRewards inc user', e)
    return { success: false, msg: '积分入账失败' }
  }

  if (recordId) {
    try {
      await db.collection(POINT_RECORDS).doc(recordId).update({
        data: { status: 'done' }
      })
    } catch (e) {
      console.warn('rechargeRewards finalize record', e && e.message)
    }
  }

  return { success: true, points, growth: points }
}

module.exports = {
  calcRechargePoints,
  grantRechargeRewards
}
