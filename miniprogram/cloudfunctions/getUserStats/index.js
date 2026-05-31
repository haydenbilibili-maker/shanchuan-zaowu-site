// cloudfunctions/getUserStats/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  // 支持查询别人(店长功能) 或 查询自己
  const targetOpenId = event.targetOpenId || wxContext.OPENID

  try {
     // 1. 获取用户信息
     let isHonorary = false
     let userInfo = {}
     // 🟢 新增：获取 bonusPoints
     let bonusPoints = 0
     let usedPoints = 0 // 之前逻辑里有，确保获取到
 
     const userRes = await db.collection('users').where({ _openid: targetOpenId }).get()
     if (userRes.data.length > 0) {
       userInfo = userRes.data[0]
       if (userInfo.isHonorary === true) isHonorary = true
       usedPoints = userInfo.usedPoints || 0
       // 🟢 获取额外奖励分
       bonusPoints = userInfo.bonusPoints || 0
     }

    // 2. 统计消费 (成长值)
    const res = await db.collection('orders')
      .where({
        _openid: targetOpenId,
        status: _.in(['paid', 'shipped', 'received'])
      })
      .get()

    let totalAmount = 0
    const orderCount = res.data.length
    res.data.forEach(order => {
      if (order.totalPrice) {
        let price = parseFloat(order.totalPrice.toString().replace(/,/g, ''))
        if (!isNaN(price)) totalAmount += price
      }
    })
    
    // 成长值 = 消费金额
    const growthValue = Math.floor(totalAmount)

    // 3. 判定等级
    const availablePoints = (growthValue + bonusPoints) - usedPoints
    let level = 1
    let levelName = '原木·见习者'
    let discountRate = 1.00
    let nextThreshold = 500 // 下一级门槛

    if (isHonorary) {
      // 👑 隐藏等级：荣誉馆长
      level = 99
      levelName = '荣誉馆长'
      discountRate = 0.85 // 同 Lv5
      nextThreshold = 0   // 满级
    } else {
      // 普通晋升体系
      if (growthValue >= 30000) {
        level = 5; levelName = '星陨·守护者'; discountRate = 0.85; nextThreshold = 0;
      } else if (growthValue >= 10000) {
        level = 4; levelName = '曜石·策展人'; discountRate = 0.90; nextThreshold = 30000;
      } else if (growthValue >= 3000) {
        level = 3; levelName = '流金·研究员'; discountRate = 0.95; nextThreshold = 10000;
      } else if (growthValue >= 500) {
        level = 2; levelName = '秘银·采集家'; discountRate = 0.98; nextThreshold = 3000;
      } else {
        level = 1; levelName = '原木·见习者'; discountRate = 1.00; nextThreshold = 500;
      }
    }

    return {
      totalAmount: totalAmount,
      points: availablePoints, // 暂时积分=成长值，如果有独立的积分消耗逻辑需减去 usedPoints
      orderCount: orderCount,
      level: level,
      levelName: levelName,
      discountRate: discountRate,
      growthValue: growthValue,
      nextThreshold: nextThreshold,
      isAdmin: userInfo.isAdmin || false,
      userInfo: userInfo
    }

  } catch (err) {
    console.error(err)
    return { totalAmount: 0, points: 0, level: 1, levelName: '游客', discountRate: 1.00 }
  }
}