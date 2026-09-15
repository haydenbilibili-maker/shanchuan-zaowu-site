// cloudfunctions/createBooking/index.js
const cloud = require('wx-server-sdk')
const { dispatchInAppMessage, writeDirect, renderMini } = require('./messageWrite')
const {
  getDefaultRules,
  isDateClosed,
  slotCapacity,
  validateWorkshopStoreLock
} = require('./bookingRules')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function cleanCustomMeta(meta) {
  if (!meta || !meta.isCustom) return null
  try {
    return JSON.parse(JSON.stringify(meta))
  } catch (e) {
    return meta
  }
}

async function notifyBookingSuccess(db, { openid, relatedId, title, date, time, ticketCode, storeName }) {
  const storeLine = storeName ? `门店：${storeName}` : '期待您的到来'
  const vars = { title, date, time: time || '', ticketCode, storeLine }
  try {
    const res = await dispatchInAppMessage(db, {
      eventType: 'booking_success',
      openid,
      relatedId,
      vars
    })
    if (res && res.success) return res
  } catch (e) {
    console.warn('dispatchInAppMessage failed:', e.message)
  }
  try {
    const rendered = renderMini('booking_success', relatedId, vars)
    if (rendered) {
      return await writeDirect(db, {
        eventType: 'booking_success',
        openid,
        relatedId,
        title: rendered.title,
        content: rendered.content,
        category: rendered.category,
        actionUrl: rendered.actionUrl
      })
    }
  } catch (e) {
    console.warn('booking notice fallback failed:', e.message)
  }
  return { success: false }
}

// 票号前缀映射
const TICKET_PREFIX_MAP = {
  museum_visit: 'M',
  handcraft_course: 'H',
  special: 'S',
  custom_confirm: 'C',
  pet_intake: 'P'
}

// 生成票号
const generateTicketCode = (type) => {
  const prefix = TICKET_PREFIX_MAP[type] || 'S'
  const year = new Date().getFullYear()
  const randomCode = Math.floor(10000 + Math.random() * 90000) // 5位随机数
  return `${prefix}-${year}-${randomCode}`
}

async function loadBookingRules(storeId) {
  try {
    const res = await db.collection('store_booking_rules').where({ storeId }).limit(1).get()
    if (res.data && res.data.length) {
      const row = res.data[0]
      const defaults = getDefaultRules(storeId)
      return {
        ...defaults,
        ...row,
        visitSlots: row.visitSlots && row.visitSlots.length ? row.visitSlots : defaults.visitSlots,
        // 全年不休：门店周末正常营业，忽略库内旧 weekendClosed
        weekendClosed: false
      }
    }
  } catch (e) {
    console.warn('loadBookingRules', e.message)
  }
  return getDefaultRules(storeId)
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  
  // 接收前端传来的完整预约信息
  // 注意：这里为了简化流程，暂未做严格的 activityId 库存校验 (因为前端目前是纯表单提交)
  // 如果未来有具体的 activities 集合，这里需要先查 activities 表扣库存
  const {
    type, title, date, week, time, people, price, name, phone,
    customDraftId = '', customMeta = null, petMemorialOrderId = '',
    storeId = '', storeName = ''
  } = event

  // 参数校验
  if (!openid) {
    return { success: false, msg: '请先登录后再预约' }
  }
  if (!type || !title || !date || !name || !phone) {
    return { success: false, msg: '预约信息不完整' }
  }

  const lockCheck = validateWorkshopStoreLock(type, storeId)
  if (!lockCheck.ok) {
    return { success: false, msg: lockCheck.msg }
  }

  const slotTypes = ['museum_visit', 'custom_confirm', 'pet_intake']
  if (slotTypes.includes(type) && storeId && time) {
    try {
      const rules = await loadBookingRules(storeId)
      if (isDateClosed(rules, date)) {
        return { success: false, msg: '所选日期不可预约' }
      }
      const capacity = slotCapacity(rules, time)
      const usedRes = await db
        .collection('bookings')
        .where({
          storeId,
          date,
          time,
          status: _.in(['confirmed', 'pending'])
        })
        .get()
      let used = 0
      ;(usedRes.data || []).forEach((b) => {
        used += Number(b.people) || 1
      })
      const peopleNum = Number(people) || 1
      if (used + peopleNum > capacity) {
        return { success: false, msg: '该时段名额已满，请选择其他时间' }
      }
    } catch (e) {
      console.warn('booking capacity check skipped', e.message)
    }
  }

  try {
    // 1. 生成票号
    const ticketCode = generateTicketCode(type)

    // 2. 写入数据库
    const bookingData = {
      _openid: openid,
      type,
      title,
      date,
      week: week || '',
      time: time || '',
      people: Number(people) || 1,
      price: Number(price) || 0,
      name: String(name).trim(),
      phone: String(phone).trim(),
      ticketCode,
      status: 'confirmed',
      createTime: db.serverDate(),
      snapshot: {
        qrData: `BOOKING:${ticketCode}:${openid}`
      }
    }

    const cleanedMeta = cleanCustomMeta(customMeta)
    if (customDraftId) bookingData.customDraftId = customDraftId
    if (cleanedMeta) bookingData.customMeta = cleanedMeta
    if (petMemorialOrderId) bookingData.petMemorialOrderId = petMemorialOrderId
    if (storeId) {
      bookingData.storeId = storeId
      bookingData.storeName = storeName || ''
    }

    const res = await db.collection('bookings').add({ data: bookingData })

    if (customDraftId) {
      db.collection('custom_drafts').doc(customDraftId).update({
        data: { linkedBookingId: res._id, updateTime: db.serverDate() }
      }).catch((e) => console.warn('link draft failed:', e.message))

      cloud.callFunction({
        name: 'submitCustomInquiry',
        data: {
          type: 'store_visit',
          contactName: name,
          contactPhone: phone,
          draftId: customDraftId,
          customMeta,
          bookingId: res._id,
          message: '用户已通过预约页提交定制方案到店确认'
        }
      }).catch((e) => console.warn('store_visit inquiry failed:', e.message))
    }

    await notifyBookingSuccess(db, {
      openid,
      relatedId: res._id,
      title,
      date,
      time,
      ticketCode,
      storeName
    }).catch((e) => console.warn('booking_success notify failed:', e.message))

    if (petMemorialOrderId && type === 'pet_intake') {
      try {
        const orderRes = await db.collection('pet_memorial_orders').doc(petMemorialOrderId).get()
        const order = orderRes.data
        if (order && order._openid === openid) {
          const logEntry = {
            status: 'intake_done',
            time: new Date().toISOString(),
            note: `已预约交接 · ${date} ${time || ''} · 票号 ${ticketCode}`
          }
          await db.collection('pet_memorial_orders').doc(petMemorialOrderId).update({
            data: {
              status: 'intake_done',
              'intake.bookingId': res._id,
              'intake.bookingTicketCode': ticketCode,
              'intake.bookingDate': date,
              'intake.bookingTime': time || '',
              updateTime: db.serverDate(),
              productionLog: _.push([logEntry])
            }
          })
          await dispatchInAppMessage(db, {
            eventType: 'pet_intake_booked',
            openid,
            relatedId: petMemorialOrderId,
            vars: {
              petName: (order.pet && order.pet.name) || '伴宠',
              date,
              time: time || '',
              ticketCode
            }
          }).catch((err) => console.warn('pet intake message failed:', err))
        }
      } catch (e) {
        console.warn('link pet memorial order failed:', e.message)
      }
    }

    return {
      success: true,
      bookingId: res._id,
      ticketCode: ticketCode
    }

  } catch (e) {
    console.error('createBooking error:', e)
    const errMsg = (e && e.message) || ''
    if (/permission|权限/.test(errMsg)) {
      return { success: false, msg: '预约服务暂不可用，请联系店员协助' }
    }
    if (/collection|集合/.test(errMsg)) {
      return { success: false, msg: '预约服务初始化中，请稍后重试' }
    }
    return { success: false, msg: '预约系统繁忙，请稍后重试' }
  }
}