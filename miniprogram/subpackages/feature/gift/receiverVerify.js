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
  if (!pending.phone) return false
  if (Date.now() - Number(pending.at || 0) > PENDING_TTL_MS) return false
  if (pending.productId && productId && pending.productId !== productId) return false
  const res = await saveReceiverPhone(orderId, { phone: pending.phone })
  return !!res.success
}

function sheetCopy(state) {
  const on = !!(state && state.receiverVerify)
  return {
    title: on ? `修改领取核验（当前尾号 ${state.phoneTail}）` : (state && state.claimMode === 'link' ? '改为手机号核验' : '设置领取核验'),
    desc: '填入受礼人的手机号。TA 打开礼笺领取时，需用这个号码核验，才会记在 TA 名下。号码只用于比对，不会出现在礼笺与分享卡里。',
    quickText: state && state.addressPhoneTail ? `沿用收件电话（尾号 ${state.addressPhoneTail}）` : '',
    // 「不设核验」已改为「转为凭礼笺领取」（2026-10-11），只限填址 / 自提；其它交付方式不给清号
    clearText: on && state.linkEligible ? '改为凭礼笺领取（不再核验手机号）' : ''
  }
}

// 凭礼笺领取 · 送礼人操作（manageGift 只认送礼人）
function setClaimPasscode(orderId, enable) {
  return callGift({ action: 'setClaimPasscode', orderId, enable: !!enable }).catch(() => ({ success: false, msg: '网络未通，请稍后再试' }))
}

function resetShareLink(orderId) {
  return callGift({ action: 'resetShareLink', orderId }).catch(() => ({ success: false, msg: '网络未通，请稍后再试' }))
}

/** 成功页 / 我的礼赠的一行状态 */
function claimLine(state) {
  if (!state || state.claimMode !== 'link') return ''
  if (state.claimer) return `${state.claimer.label}${state.claimer.at ? ' · ' + state.claimer.at + '收下' : ''}`
  return state.passcode ? `口令 ${state.passcode} · 等 TA 收下` : '等 TA 收下'
}

module.exports = {
  loadReceiverVerify,
  saveReceiverPhone,
  flushPendingReceiverPhone,
  sheetCopy,
  setClaimPasscode,
  resetShareLink,
  claimLine
}
