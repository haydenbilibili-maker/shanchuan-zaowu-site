/**
 * 提交开票申请（一期半自动：落库 + 通知，人工开票）
 * 集合：invoice_requests
 */
const cloud = require('wx-server-sdk')
const { dispatchInAppMessage, notifyStaffInvoice } = require('./inAppMessage')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTION = 'invoice_requests'
const TYPE_LABELS = {
  personal: '个人',
  company: '企业'
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^1\d{10}$/

function errorText(err) {
  return [err && err.errCode, err && err.errMsg, err && err.message, String(err || '')]
    .filter(Boolean)
    .join(' ')
}

function isMissingCollectionError(err) {
  return /502005|DATABASE_COLLECTION_NOT_EXIST|collection not exist/i.test(errorText(err))
}

function isCollectionExistsError(err) {
  return /already exist|already exists|COLLECTION_EXIST|ResourceExist|-501001/i.test(errorText(err))
}

async function ensureCollection() {
  try {
    await db.createCollection(COLLECTION)
    console.log('created collection', COLLECTION)
  } catch (err) {
    if (!isCollectionExistsError(err)) throw err
  }
}

async function addRequest(data) {
  try {
    return await db.collection(COLLECTION).add({ data })
  } catch (err) {
    if (!isMissingCollectionError(err)) throw err
    await ensureCollection()
    return await db.collection(COLLECTION).add({ data })
  }
}

/** 可选：按 orderId / 订单号匹配归属，失败不阻断 */
async function tryMatchOrder(openid, orderNo, orderId) {
  try {
    if (orderId) {
      const doc = await db.collection('orders').doc(orderId).get()
      const order = doc && doc.data
      if (order) {
        const owned = order._openid === openid
        return {
          matched: owned,
          orderId: order._id || orderId,
          orderNo: order.orderNo || orderNo || '',
          orderStatus: order.status || '',
          note: owned ? '' : 'order_id_other_owner'
        }
      }
    }
    if (!orderNo) return null
    const res = await db
      .collection('orders')
      .where({ orderNo, _openid: openid })
      .limit(1)
      .get()
    const order = res.data && res.data[0]
    if (order) {
      return {
        matched: true,
        orderId: order._id || '',
        orderNo: order.orderNo || orderNo,
        orderStatus: order.status || ''
      }
    }
    // 再尝试仅按 orderNo（可能非本人；仅记录，不阻断）
    const any = await db.collection('orders').where({ orderNo }).limit(1).get()
    const found = any.data && any.data[0]
    if (found) {
      return {
        matched: false,
        orderId: found._id || '',
        orderNo: found.orderNo || orderNo,
        orderStatus: found.status || '',
        note: 'order_exists_other_owner'
      }
    }
  } catch (e) {
    console.warn('order match skipped:', e && e.message)
  }
  return null
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  if (!openid) {
    return { success: false, msg: '未登录' }
  }

  const orderNo = String((event && event.orderNo) || '').trim()
  const orderIdInput = String((event && event.orderId) || '').trim()
  const invoiceType = String((event && event.invoiceType) || '').trim()
  const title = String((event && event.title) || '').trim()
  const taxNo = String((event && event.taxNo) || '').trim()
  const email = String((event && event.email) || '').trim()
  const phone = String((event && event.phone) || '').trim()
  const remark = String((event && event.remark) || '').trim().slice(0, 500)
  const source = String((event && event.source) || 'invoice_request_page').trim().slice(0, 40) || 'invoice_request_page'

  if (!orderNo) {
    return { success: false, msg: '请选择订单' }
  }
  if (!TYPE_LABELS[invoiceType]) {
    return { success: false, msg: '请选择抬头类型' }
  }
  if (!title) {
    return { success: false, msg: '请填写发票抬头' }
  }
  if (invoiceType === 'company' && !taxNo) {
    return { success: false, msg: '企业抬头请填写纳税人识别号' }
  }
  if (email && !EMAIL_RE.test(email)) {
    return { success: false, msg: '邮箱格式有误' }
  }
  if (phone && !PHONE_RE.test(phone)) {
    return { success: false, msg: '请填写 11 位手机号' }
  }

  const orderMatch = await tryMatchOrder(openid, orderNo, orderIdInput)
  const resolvedOrderId = orderIdInput || (orderMatch && orderMatch.orderId) || ''

  try {
    const addRes = await addRequest({
      _openid: openid,
      orderNo,
      orderId: resolvedOrderId,
      invoiceType,
      invoiceTypeLabel: TYPE_LABELS[invoiceType],
      title,
      taxNo: invoiceType === 'company' ? taxNo : '',
      email,
      phone,
      remark,
      status: 'pending',
      source,
      orderMatch: orderMatch || null,
      createTime: db.serverDate(),
      _createTime: db.serverDate()
    })

    const requestId = addRes._id
    const vars = {
      orderNo,
      title,
      taxNo,
      email,
      invoiceTypeLabel: TYPE_LABELS[invoiceType]
    }

    await dispatchInAppMessage(db, {
      eventType: 'invoice_request_received',
      openid,
      relatedId: requestId,
      vars
    }).catch((err) => console.warn('invoice receipt message failed:', err))

    await notifyStaffInvoice(db, { relatedId: requestId, vars }).catch((err) =>
      console.warn('invoice staff notify failed:', err)
    )

    return {
      success: true,
      requestId,
      msg: '开票申请已提交'
    }
  } catch (err) {
    console.error('submitInvoiceRequest error:', err)
    return { success: false, msg: err.message || '提交失败' }
  }
}
