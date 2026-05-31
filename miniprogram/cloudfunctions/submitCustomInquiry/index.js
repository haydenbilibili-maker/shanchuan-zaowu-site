const cloud = require('wx-server-sdk')
const { dispatchInAppMessage } = require('./inAppMessage')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const TYPE_LABELS = {
  enterprise: '企业团购',
  store_visit: '到店确认'
}

function buildSummaryText(customMeta, quantity) {
  if (!customMeta) return ''
  const lines = [
    customMeta.specimen ? `标本：${customMeta.specimen.title}` : '',
    customMeta.frame ? `装裱：${customMeta.frame.name}` : '',
    customMeta.packaging ? `包装：${customMeta.packaging.name}` : '',
    customMeta.framer ? `标本师：${customMeta.framer.name}` : '',
    quantity ? `数量：${quantity} 件` : ''
  ].filter(Boolean)
  return lines.join(' · ')
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  if (!openid) return { success: false, msg: '未登录' }

  const {
    type = 'enterprise',
    quantity = 0,
    companyName = '',
    contactName = '',
    contactPhone = '',
    message = '',
    draftId = '',
    customMeta = null,
    bookingId = ''
  } = event

  if (!TYPE_LABELS[type]) {
    return { success: false, msg: '无效的类型' }
  }

  if (type === 'enterprise') {
    const qty = parseInt(quantity, 10) || 0
    if (qty < 10) {
      return { success: false, msg: '企业团购需至少 10 件' }
    }
    if (!contactName || !contactPhone) {
      return { success: false, msg: '请填写联系人与手机号' }
    }
    if (String(contactPhone).length < 11) {
      return { success: false, msg: '手机号格式有误' }
    }
  }

  let meta = customMeta
  if (draftId && !meta) {
    try {
      const draftRes = await db.collection('custom_drafts').doc(draftId).get()
      if (draftRes.data) meta = draftRes.data.customMeta
    } catch (e) {
      console.warn('draft load failed', e.message)
    }
  }

  const summary = buildSummaryText(meta, quantity)
  const note = String(message || '').trim().slice(0, 500)

  try {
    const addRes = await db.collection('custom_inquiries').add({
      data: {
        _openid: openid,
        type,
        typeLabel: TYPE_LABELS[type],
        status: 'pending',
        quantity: parseInt(quantity, 10) || 0,
        companyName: String(companyName || '').trim().slice(0, 80),
        contactName: String(contactName || '').trim().slice(0, 40),
        contactPhone: String(contactPhone || '').trim().slice(0, 20),
        message: note,
        draftId,
        customMeta: meta,
        summary,
        bookingId,
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    })

    await dispatchInAppMessage(db, {
      eventType: 'custom_inquiry_received',
      openid,
      relatedId: addRes._id,
      vars: {}
    }).catch((err) => console.warn('inquiry message failed:', err))

    return { success: true, inquiryId: addRes._id, msg: '提交成功' }
  } catch (err) {
    console.error('submitCustomInquiry error:', err)
    return { success: false, msg: err.message || '提交失败' }
  }
}
