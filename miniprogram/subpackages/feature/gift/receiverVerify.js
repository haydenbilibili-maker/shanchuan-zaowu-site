// 礼笺领取核验 · 送礼人侧：号码只经 manageGift 存加盐哈希，前端只拿尾号
const PENDING_TTL_MS = 2 * 60 * 60 * 1000

async function callGift(data) {
  const res = await wx.cloud.callFunction({ name: 'manageGift', data })
  return (res && res.result) || {}
}

function loadReceiverVerify(orderId) {
  return callGift({ action: 'getReceiverVerify', orderId }).catch(() => ({ success: false }))
}

// payload：{ phone } 设置；{ phone: '' } 清除；{ useAddressPhone: true } 沿用收件电话
function saveReceiverPhone(orderId, payload) {
  return callGift({ action: 'setReceiverPhone', orderId, ...payload }).catch(() => ({ success: false, msg: '网络未通，请稍后再试' }))
}

// 送礼页暂存的号码（内存）：同一藏品、2 小时内才补存，用后即清
async function flushPendingReceiverPhone(orderId, productId) {
  const app = getApp()
  const pending = app && app.globalData && app.globalData.giftReceiverPhone
  if (!pending || !orderId) return false
  app.globalData.giftReceiverPhone = null
  if (Date.now() - Number(pending.at || 0) > PENDING_TTL_MS) return false
  if (pending.productId && productId && pending.productId !== productId) return false
  const res = await saveReceiverPhone(orderId, { phone: pending.phone })
  return !!res.success
}

function sheetCopy(state) {
  const on = !!(state && state.receiverVerify)
  return {
    title: on ? `修改领取核验（当前尾号 ${state.phoneTail}）` : '设置领取核验',
    desc: '填入受礼人的手机号。TA 打开礼笺领取时，需用这个号码核验，才会记在 TA 名下。号码只用于比对，不会出现在礼笺与分享卡里。',
    quickText: state && state.addressPhoneTail ? `沿用收件电话（尾号 ${state.addressPhoneTail}）` : '',
    clearText: on ? '不设核验' : ''
  }
}

module.exports = {
  loadReceiverVerify,
  saveReceiverPhone,
  flushPendingReceiverPhone,
  sheetCopy
}
