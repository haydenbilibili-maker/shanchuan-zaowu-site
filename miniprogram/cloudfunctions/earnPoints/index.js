// cloudfunctions/earnPoints/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action, productId } = event // action: 'check_in' | 'browse'
  
  // 配置奖励规则
  const RULES = {
    check_in: { points: 5, limit: 1, name: '每日签到' },
    browse:   { points: 1, limit: 5, name: '鉴赏藏品' } // 浏览一次得1分，每天最多5次
  }

  const rule = RULES[action]
  if (!rule) return { success: false, msg: '未知动作' }

  try {
    // 1. 生成今日的时间范围 (用于查询今日是否已做)
    const now = new Date()
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    // 简单的日期标记，用于查询
    
    // 2. 查询今日该动作的记录次数
    const recordQuery = {
      _openid: openid,
      action: action,
      dateStr: todayStr
    }
    
    // 如果是浏览，同一天同一个商品不重复加分 (可选策略)
    if(action === 'browse' && productId) {
      recordQuery.productId = productId
    }

    const records = await db.collection('point_records').where(recordQuery).count()
    
    // 检查是否同一个商品重复浏览 (如果上面的productId查询生效，这里records.total > 0 就代表看过了)
    if (action === 'browse' && productId && records.total > 0) {
       return { success: false, msg: '今日已阅' }
    }

    // 3. 检查每日总上限 (对于浏览，需要查总数)
    if (action === 'browse') {
       const totalBrowse = await db.collection('point_records').where({
         _openid: openid,
         action: action,
         dateStr: todayStr
       }).count()
       
       if (totalBrowse.total >= rule.limit) {
         return { success: false, msg: '明日再来' }
       }
    } else {
       // 签到：查是否已签
       if (records.total >= rule.limit) {
         return { success: false, msg: '今日已签' }
       }
    }

    // 4. 写入流水记录
    await db.collection('point_records').add({
      data: {
        _openid: openid,
        action: action,
        points: rule.points,
        dateStr: todayStr, // 方便索引
        productId: productId || null,
        createTime: db.serverDate()
      }
    })

    // 5. 原子更新用户表 bonusPoints
    const userRes = await db.collection('users').where({ _openid: openid }).get()
    if (userRes.data.length > 0) {
      await db.collection('users').doc(userRes.data[0]._id).update({
        data: {
          bonusPoints: _.inc(rule.points)
        }
      })
    } else {
      // 如果用户不存在（极端情况），创建新用户
      await db.collection('users').add({
        data: {
          _openid: openid,
          bonusPoints: rule.points,
          usedPoints: 0,
          createTime: db.serverDate()
        }
      })
    }

    return { success: true, points: rule.points, msg: `+${rule.points} 积分` }

  } catch (err) {
    console.error(err)
    return { success: false, msg: '系统繁忙' }
  }
}