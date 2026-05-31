const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function genOrderNo() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `PM${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${String(Date.now()).slice(-6)}`
}

exports.main = async (event) => {
  const { action } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (action === 'get') {
    const { orderId } = event
    if (!orderId) return { success: false, msg: '缺少 orderId' }
    try {
      const res = await db.collection('pet_memorial_orders').doc(orderId).get()
      const doc = res.data
      if (!doc) return { success: false, msg: '工单不存在' }
      if (doc._openid !== openid) return { success: false, msg: '无权查看' }
      return { success: true, order: doc }
    } catch (e) {
      return { success: false, msg: e.message }
    }
  }

  if (action === 'list') {
    if (!openid) return { success: false, list: [] }
    try {
      const res = await db.collection('pet_memorial_orders')
        .where({ _openid: openid })
        .orderBy('createTime', 'desc')
        .limit(20)
        .get()
      return { success: true, list: res.data }
    } catch (e) {
      return { success: false, list: [], msg: e.message }
    }
  }

  if (action === 'confirmQuote') {
    const { orderId } = event
    if (!orderId) return { success: false, msg: '缺少 orderId' }
    try {
      const res = await db.collection('pet_memorial_orders').doc(orderId).get()
      const doc = res.data
      if (!doc || doc._openid !== openid) return { success: false, msg: '无权操作' }
      if (doc.status !== 'quoted') return { success: false, msg: '当前状态不可确认报价' }
      if (!doc.quote || doc.quote.amount == null) return { success: false, msg: '暂无有效报价' }

      const logEntry = {
        status: 'accepted',
        time: new Date().toISOString(),
        note: '用户已确认报价'
      }
      await db.collection('pet_memorial_orders').doc(orderId).update({
        data: {
          status: 'accepted',
          'quote.confirmedAt': new Date().toISOString(),
          updateTime: db.serverDate(),
          productionLog: db.command.push([logEntry])
        }
      })
      return { success: true, msg: '已确认报价' }
    } catch (e) {
      return { success: false, msg: e.message }
    }
  }

  if (action === 'submit') {
    if (!openid) return { success: false, msg: '未登录' }
    const { payload } = event
    if (!payload || !payload.consent) {
      return { success: false, msg: '请完成知情确认' }
    }
    const pet = payload.pet || {}
    const craft = payload.craft || {}
    const contact = payload.contact || {}
    if (!pet.name || !pet.species) {
      return { success: false, msg: '请填写宠物档案' }
    }
    if (!craft.craftId) {
      return { success: false, msg: '请选择工艺' }
    }
    if (!contact.name || !contact.phone || String(contact.phone).length < 11) {
      return { success: false, msg: '请填写有效联系方式' }
    }

    const orderNo = genOrderNo()
    const now = db.serverDate()
    try {
      const addRes = await db.collection('pet_memorial_orders').add({
        data: {
          _openid: openid,
          orderNo,
          status: 'pending_review',
          pet,
          craft,
          intake: payload.intake || {},
          contact,
          consent: payload.consent,
          quote: null,
          productionLog: [{ status: 'pending_review', time: new Date().toISOString(), note: '用户提交意向' }],
          createTime: now,
          updateTime: now
        }
      })

      cloud.callFunction({
        name: 'dispatchMessage',
        data: {
          action: 'dispatch',
          eventType: 'pet_memorial_received',
          openid,
          relatedId: addRes._id,
          vars: {
            petName: pet.name,
            orderNo
          }
        }
      }).catch((err) => console.warn('pet message failed:', err))

      return { success: true, orderId: addRes._id, orderNo, msg: '提交成功' }
    } catch (e) {
      console.error('submit pet memorial:', e)
      return { success: false, msg: e.message || '提交失败' }
    }
  }

  return { success: false, msg: '未知 action' }
}
