const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function sumPaidGrowth(openid) {
  const PAGE = 100
  const MAX_PAGES = 60
  let growthValue = 0
  let skip = 0
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const ordersRes = await db.collection('orders')
      .where({ _openid: openid, status: _.in(['paid', 'shipped', 'received']) })
      .orderBy('createTime', 'asc')
      .skip(skip)
      .limit(PAGE)
      .get()
    const rows = ordersRes.data || []
    rows.forEach((o) => {
      if (o.source === 'exchange') return
      const raw = o.growthAmount != null && o.growthAmount !== '' ? o.growthAmount : o.totalPrice
      const price = typeof raw === 'number'
        ? raw
        : parseFloat(String(raw || '').replace(/,/g, '')) || 0
      if (!isNaN(price)) growthValue += price
    })
    if (rows.length < PAGE) break
    skip += rows.length
  }
  return Math.floor(growthValue)
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  // 无登录态时必须拒绝：否则会以空 _openid 记账/建单（历史隐患）
  if (!openid) return { success: false, msg: '请先登录' }
  const { rewardId, address } = event || {}
  /**
   * 兑换幂等键：同一 (openid, clientRequestId) 只扣一次分、只减一次库存。
   * 此前无幂等亦无流水 → 连点会重复扣分扣库存，且明细里看不到扣减。
   */
  const clientRequestId = String((event && event.clientRequestId) || '').trim().slice(0, 64)

  if (!rewardId) return { success: false, msg: '参数错误' }

  const isDuplicateKeyError = (e) => {
    const m = (e && (e.message || e.errMsg)) || ''
    return /duplicate|E11000|已存在|unique/i.test(m)
  }

  const dedupeKey = clientRequestId ? `exchange_reward:${openid}:${clientRequestId}` : ''
  if (dedupeKey) {
    try {
      const exist = await db.collection('point_records').where({ dedupeKey }).limit(1).get()
      if (exist.data && exist.data.length) {
        return { success: true, duplicated: true, msg: '该权益已兑换，未重复扣分' }
      }
    } catch (e) {
      /* 预检失败继续走唯一键兜底 */
    }
  }

  try {
    const rewardDoc = await db.collection('rewards').doc(rewardId).get()
    const reward = rewardDoc.data
    if (!reward || reward.isOffShelf) return { success: false, msg: '权益不存在或已下架' }

    const stock = parseInt(reward.stock, 10) || 0
    if (stock <= 0) return { success: false, msg: '已兑完' }

    const cost = parseInt(reward.cost, 10) || 0
    if (cost <= 0) return { success: false, msg: '权益配置无效' }

    const type = reward.type || 'virtual'
    const title = reward.title || '权益'
    const image = reward.image || ''

    // 代金券必须走 exchangeCoupon（幂等 + point_records），禁止本函数旁路兑券
    if (type === 'coupon') {
      return {
        success: false,
        code: 'USE_EXCHANGE_COUPON',
        msg: '代金券请使用积分兑券接口'
      }
    }

    const growthValue = await sumPaidGrowth(openid)

    const userRes = await db.collection('users').where({ _openid: openid }).get()
    let usedPoints = 0
    let bonusPoints = 0
    let userDocId = null
    if (userRes.data.length > 0) {
      usedPoints = userRes.data[0].usedPoints || 0
      bonusPoints = userRes.data[0].bonusPoints || 0
      userDocId = userRes.data[0]._id
    }

    const currentBalance = growthValue + bonusPoints - usedPoints
    if (currentBalance < cost) return { success: false, msg: '积分不足' }

    // 1) 先写扣分流水（唯一键幂等）
    let recordId = ''
    if (dedupeKey) {
      try {
        const added = await db.collection('point_records').add({
          data: {
            _openid: openid,
            userOpenid: openid,
            type: 'spend',
            source: 'reward_exchange',
            action: 'reward_exchange',
            points: -cost,
            title: `兑换 ${title}`,
            refCollection: 'rewards',
            refId: rewardId,
            dedupeKey,
            status: 'done',
            dateStr: new Date().toISOString().slice(0, 10),
            createTime: db.serverDate()
          }
        })
        recordId = added._id
      } catch (e) {
        if (isDuplicateKeyError(e)) {
          return { success: true, duplicated: true, msg: '该权益已兑换，未重复扣分' }
        }
        console.error('redeemReward add point_record', e)
        return { success: false, msg: '兑换流水写入失败，请稍后重试' }
      }
    }

    // 2) 扣积分
    if (userDocId) {
      await db.collection('users').doc(userDocId).update({ data: { usedPoints: _.inc(cost) } })
    } else {
      await db.collection('users').add({
        data: { _openid: openid, usedPoints: cost, bonusPoints: 0, createTime: db.serverDate() }
      })
    }

    // 3) 条件扣库存（并发下不会超卖）
    let stockTaken = false
    try {
      const stockRes = await db.collection('rewards')
        .where({ _id: rewardId, stock: _.gt(0) })
        .update({ data: { stock: _.inc(-1) } })
      const updated = (stockRes && stockRes.stats && stockRes.stats.updated) || (stockRes && stockRes.updated) || 0
      stockTaken = updated > 0
    } catch (e) {
      console.warn('redeemReward stock decrement failed:', e && e.message)
    }
    if (!stockTaken) {
      // 回滚积分与流水状态，避免「扣了分却没货」
      await db.collection('users').doc(userDocId).update({ data: { usedPoints: _.inc(-cost) } }).catch(() => {})
      if (recordId) {
        await db.collection('point_records').doc(recordId)
          .update({ data: { status: 'reverted', title: `兑换失败（已兑完）· ${title}` } }).catch(() => {})
      }
      return { success: false, msg: '已兑完，换个权益试试' }
    }

    // 4) 建兑换单；失败则回滚积分与库存
    const status = type === 'goods' ? 'paid' : 'unverified'
    let orderId = ''
    try {
      const orderRes = await db.collection('orders').add({
        data: {
          _openid: openid,
          orderNo: 'EX' + Date.now(),
          createTime: db.serverDate(),
          status,
          source: 'exchange',
          clientRequestId,
          totalPrice: 0,
          costPoints: cost,
          products: [{ id: rewardId, title, image, price: cost + ' PTS', latin: String(type).toUpperCase() }],
          count: 1,
          address: address || { name: '系统发放', phone: '', detail: '自动充值' }
        }
      })
      orderId = orderRes._id
    } catch (e) {
      console.error('redeemReward add order', e)
      await db.collection('users').doc(userDocId).update({ data: { usedPoints: _.inc(-cost) } }).catch(() => {})
      await db.collection('rewards').doc(rewardId).update({ data: { stock: _.inc(1) } }).catch(() => {})
      if (recordId) {
        await db.collection('point_records').doc(recordId)
          .update({ data: { status: 'reverted', title: `兑换失败（已回退）· ${title}` } }).catch(() => {})
      }
      return { success: false, msg: '兑换失败，积分已退回，请重试' }
    }

    if (recordId) {
      await db.collection('point_records').doc(recordId)
        .update({ data: { refId: orderId || rewardId } }).catch(() => {})
    }

    return { success: true, orderId, leftPoints: currentBalance - cost }
  } catch (err) {
    console.error(err)
    return { success: false, msg: '系统繁忙' }
  }
}
