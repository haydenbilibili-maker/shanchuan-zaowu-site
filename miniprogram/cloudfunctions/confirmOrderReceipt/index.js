/**
 * 买家确认收货 — 唯一允许把订单改为 received 的 C 端入口
 * （orders 集合级 write:false 后禁止客户端直写）
 *
 * 礼赠「礼物已送达」主路径：managerShipOrder 轮询/查询微信物流
 * （query_follow_trace status=4/6）后通知送礼人。
 * 此处保留兜底：物流未覆盖（无 token / 未轮询到）时，手动确认签收仍通知 giver；
 * 已由物流通知过则 dispatchMessage 去重，不重复发。
 */
const cloud = require('wx-server-sdk')
const { dispatchInAppMessage } = require('./messageWrite')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function isBuyer(order, openid) {
  if (!openid || !order) return false
  if (openid === order._openid || openid === order.openid) return true
  const receiver = order.giftMeta && order.giftMeta.receiverOpenid
  return !!(receiver && receiver === openid)
}

function isGiftOrder(order) {
  return !!(order && (order.source === 'gift' || order.giftMeta))
}

function giverOpenid(order) {
  return String((order && (order._openid || order.openid)) || '').trim()
}

function firstProductTitle(order) {
  const products = (order && order.products) || []
  const first = products.find((p) => p && (p.title || p.name))
  return (first && (first.title || first.name)) || '您的藏品'
}

/**
 * 确认收货后赠分 — 与门店消费同一规则
 * 复用 grantStorePoints.grantOnlineOrder（store_point_rules + calcPoints，按订单幂等）。
 * best-effort：赠分失败不阻塞签收；订单上留 pointsGrantRequestedAt 供下次调用自愈补发。
 */
async function grantReceiptPoints(orderId) {
  try {
    const res = await cloud.callFunction({
      name: 'grantStorePoints',
      data: { action: 'grantOnlineOrder', orderId, __fromReceipt: true }
    })
    const result = (res && res.result) || {}
    if (!result.success) {
      console.warn('grantOnlineOrder skipped:', result.msg)
      return { pointsGranted: 0, msg: result.msg || '' }
    }
    return {
      pointsGranted: Number(result.pointsGranted) || 0,
      duplicated: !!result.duplicated,
      balanceAfter: result.balanceAfter,
      msg: result.msg || ''
    }
  } catch (e) {
    console.warn('grantOnlineOrder call failed:', e && e.message)
    return { pointsGranted: 0, msg: '' }
  }
}

/** 赠分成功后回写订单，便于详情页展示与审计；失败仅告警 */
async function markOrderPointsGranted(orderId, points) {
  try {
    await db.collection('orders').doc(orderId).update({
      data: {
        pointsGranted: points,
        pointsGrantedAt: db.serverDate(),
        pointsGrantedSource: 'online_order'
      }
    })
  } catch (e) {
    console.warn('mark pointsGranted failed:', e && e.message)
  }
}

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID || ''
  const orderId = String((event && event.orderId) || '').trim()

  if (!openid) return { success: false, msg: '请先登录' }
  if (!orderId) return { success: false, msg: '缺少订单 ID' }

  try {
    const orderRes = await db.collection('orders').doc(orderId).get()
    const order = orderRes.data
    if (!order) return { success: false, msg: '订单不存在' }
    if (!isBuyer(order, openid)) return { success: false, msg: '无权操作此订单' }

    if (order.status === 'received') {
      // 失败自愈：此前发起过赠分但未成功落库 → 本次补发（幂等，不会重复入账）
      let healedPoints = 0
      if (order.pointsGrantRequestedAt && !order.pointsGrantedAt) {
        const healed = await grantReceiptPoints(orderId)
        healedPoints = healed.pointsGranted || 0
        if (healedPoints > 0) await markOrderPointsGranted(orderId, healedPoints)
      }
      return {
        success: true,
        duplicated: true,
        msg: '订单已签收',
        orderNo: order.orderNo || '',
        productTitle: firstProductTitle(order),
        pointsGranted: healedPoints || Number(order.pointsGranted) || 0
      }
    }

    if (order.status !== 'shipped') {
      return { success: false, msg: '当前订单状态不可确认收货' }
    }

    await db.collection('orders').doc(orderId).update({
      data: {
        status: 'received',
        receiveTime: db.serverDate(),
        // 赠分意图：赠分失败时可在下次调用自愈补发
        pointsGrantRequestedAt: db.serverDate()
      }
    })

    // 确认收货后按门店同规则赠分（best-effort，不阻塞签收）
    const grant = await grantReceiptPoints(orderId)
    if (grant.pointsGranted > 0) await markOrderPointsGranted(orderId, grant.pointsGranted)

    const orderNo = order.orderNo || ''
    const productTitle = firstProductTitle(order)
    const careNote = `藏品「${productTitle}」已妥投。可在订单详情写下真实感受，也可查看养护指南。`

    // 签收人本人：山海有信「藏品已签收」（可能是受礼人）
    await dispatchInAppMessage(db, {
      eventType: 'order_received',
      openid,
      relatedId: orderId,
      vars: { orderNo, products: order.products, careNote }
    }).catch((err) => console.warn('order_received message failed:', err))

    // 礼赠兜底：物流未通知过时，手动签收仍告知送礼人（dedupe: gift_delivered:orderId:giver）
    if (isGiftOrder(order)) {
      const giver = giverOpenid(order)
      if (giver) {
        await dispatchInAppMessage(db, {
          eventType: 'gift_delivered',
          openid: giver,
          relatedId: orderId,
          vars: { orderNo, productTitle, products: order.products }
        }).catch((err) => console.warn('gift_delivered message failed:', err))
      }
    }

    return {
      success: true,
      msg: '已签收',
      orderNo,
      productTitle,
      pointsGranted: grant.pointsGranted || 0,
      pointsMsg: grant.msg || ''
    }
  } catch (err) {
    console.error('confirmOrderReceipt', err)
    return { success: false, msg: err.message || '确认收货失败' }
  }
}
