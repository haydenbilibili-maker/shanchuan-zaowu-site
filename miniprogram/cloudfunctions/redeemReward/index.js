// cloudfunctions/redeemReward/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  
  // 接收参数: value(面值), minSpend(门槛) 为优惠券专用
  const { rewardId, cost, type, title, image, value, minSpend } = event
  
  if (!rewardId || !cost) return { success: false, msg: '参数错误' }

  try {
    // 1. 计算用户积分余额 (逻辑保持一致)
    const ordersRes = await db.collection('orders')
      .where({ _openid: openid, status: _.in(['paid', 'shipped', 'received']) })
      .get()
    
    let totalEarned = ordersRes.data.reduce((sum, o) => {
      const price = typeof o.totalPrice === 'number' 
        ? o.totalPrice 
        : parseFloat(String(o.totalPrice).replace(/,/g, '')) || 0
      return sum + price
    }, 0)
    totalEarned = Math.floor(totalEarned)

    const userRes = await db.collection('users').where({ _openid: openid }).get()
    let usedPoints = 0
    let userDocId = null
    if (userRes.data.length > 0) {
      usedPoints = userRes.data[0].usedPoints || 0
      userDocId = userRes.data[0]._id
    }

    const currentBalance = totalEarned - usedPoints
    if (currentBalance < cost) return { success: false, msg: '积分不足' }

    // 2. 扣除积分
    if (userDocId) {
      await db.collection('users').doc(userDocId).update({ data: { usedPoints: _.inc(cost) } })
    } else {
      await db.collection('users').add({ data: { _openid: openid, usedPoints: cost, createTime: db.serverDate() } })
    }
    
    // 3. 扣库存
    await db.collection('rewards').doc(rewardId).update({ data: { stock: _.inc(-1) } })

    // 🟢 4. 根据类型分发资产
    if (type === 'coupon') {
       // 写入优惠券表
       const couponValue = value || 50; 
       await db.collection('user_coupons').add({
         data: {
           _openid: openid,
           title: title,
           value: couponValue,
           minSpend: minSpend || couponValue * 2, 
           status: 'unused',
           createTime: db.serverDate(),
           expireTime: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30天有效期
           image: image
         }
       })
    }
    
    // 统一写入兑换流水 (orders表)
    await db.collection('orders').add({
      data: {
        _openid: openid,
        orderNo: 'EX' + Date.now(),
        createTime: db.serverDate(),
        status: type === 'coupon' ? 'received' : (type === 'goods' ? 'paid' : 'unverified'),
        source: 'exchange', 
        totalPrice: 0, 
        costPoints: cost,
        products: [{ id: rewardId, title: title, image: image, price: cost + ' PTS', latin: type.toUpperCase() }],
        count: 1,
        address: event.address || { name: '系统发放', phone: '', detail: '自动充值' }
      }
    })

    return { success: true, leftPoints: currentBalance - cost }

  } catch (err) {
    console.error(err)
    return { success: false, msg: '系统繁忙' }
  }
}