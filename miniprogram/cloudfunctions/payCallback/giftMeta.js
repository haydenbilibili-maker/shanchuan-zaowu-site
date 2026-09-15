/**
 * 礼赠元数据规范化（makeOrder / fulfill / manageGift 共用逻辑副本）
 */
const crypto = require('crypto')

const DELIVERY_TYPES = {
  invite_address: true,
  ship_to_receiver: true,
  ship_to_self: true,
  store_pickup: true
}

const DEFAULT_ADDRESS_TIMEOUT_DAYS = 7

function createShareToken() {
  return crypto.randomBytes(16).toString('hex')
}

/** 自提领取码：短码便于口播 + 扫码 payload GIFT:{code} */
function createClaimCode() {
  return crypto.randomBytes(5).toString('hex').toUpperCase()
}

function normalizeGiftMeta(raw, { generateToken = false, generateClaim = false } = {}) {
  const src = raw && typeof raw === 'object' ? raw : null
  if (!src) return null

  const deliveryType = DELIVERY_TYPES[src.deliveryType]
    ? src.deliveryType
    : 'invite_address'
  const hidePrice = src.hidePrice !== false
  const cardBody = String(src.cardBody || '').trim().slice(0, 200)
  const cardSignature = String(src.cardSignature || '').trim().slice(0, 20)
  /** 受赠人名：recipientName / toName / salutation 同源 */
  const recipientName = String(
    src.recipientName || src.toName || src.salutation || ''
  ).trim().slice(0, 40)
  const timeoutDays = Math.min(
    30,
    Math.max(1, parseInt(src.addressTimeoutDays || DEFAULT_ADDRESS_TIMEOUT_DAYS, 10) || DEFAULT_ADDRESS_TIMEOUT_DAYS)
  )

  const claimStatus = ['ready', 'claimed', 'none'].includes(src.claimStatus)
    ? src.claimStatus
    : 'none'

  const voiceFileID = String(src.voiceFileID || '').trim().slice(0, 512)
  const voiceDurationRaw = parseInt(src.voiceDuration, 10) || 0
  const voiceDuration = voiceFileID
    ? Math.min(60, Math.max(0, voiceDurationRaw))
    : 0

  const meta = {
    deliveryType,
    hidePrice,
    cardBody,
    cardSignature,
    voiceFileID: voiceDuration > 0 ? voiceFileID : '',
    voiceDuration: voiceDuration > 0 ? voiceDuration : 0,
    recipientName,
    salutation: recipientName,
    templateId: String(src.templateId || '').trim().slice(0, 40),
    addressTimeoutDays: timeoutDays,
    acceptStatus: src.acceptStatus === 'accepted' ? 'accepted' : 'none',
    addressStatus: src.addressStatus === 'submitted' ? 'submitted' : 'none',
    nudgeCount: Math.max(0, parseInt(src.nudgeCount, 10) || 0),
    lastNudgeAt: src.lastNudgeAt || null,
    nudgeAutoDay3: !!src.nudgeAutoDay3,
    nudgeAutoDay6: !!src.nudgeAutoDay6,
    acceptedAt: src.acceptedAt || null,
    addressSubmittedAt: src.addressSubmittedAt || null,
    expireAt: src.expireAt || null,
    receiverOpenid: src.receiverOpenid || '',
    receiverPhoneMasked: src.receiverPhoneMasked || '',
    shareToken: String(src.shareToken || '').trim(),
    storeId: String(src.storeId || '').trim().slice(0, 64),
    storeName: String(src.storeName || '').trim().slice(0, 80),
    claimCode: String(src.claimCode || '').trim().toUpperCase().slice(0, 24),
    claimStatus,
    claimedAt: src.claimedAt || null,
    claimedByStaff: src.claimedByStaff || '',
    phase: 'mvp'
  }

  if (generateToken && !meta.shareToken) {
    meta.shareToken = createShareToken()
  }
  if (generateClaim && deliveryType === 'store_pickup' && !meta.claimCode) {
    meta.claimCode = createClaimCode()
    meta.claimStatus = meta.claimStatus === 'claimed' ? 'claimed' : 'ready'
  }

  return meta
}

function isInviteAddressGift(orderOrMeta) {
  const meta = orderOrMeta && orderOrMeta.giftMeta
    ? orderOrMeta.giftMeta
    : orderOrMeta
  return !!(meta && meta.deliveryType === 'invite_address')
}

function isGiftOrder(order) {
  return !!(order && (order.source === 'gift' || order.giftMeta))
}

function needsAddressBeforeShip(order) {
  if (!isInviteAddressGift(order)) return false
  const meta = order.giftMeta || {}
  if (meta.addressStatus === 'submitted') return false
  if (order.status === 'paid_awaiting_address') return true
  return order.status === 'paid' && meta.addressStatus !== 'submitted'
}

function maskPhone(phone) {
  const s = String(phone || '').replace(/\s/g, '')
  if (s.length < 7) return s
  return `${s.slice(0, 3)}****${s.slice(-4)}`
}

function buildProductSnapshot(products, { hidePrice = true } = {}) {
  return (products || []).map((p) => ({
    title: p.title || p.name || '',
    latinName: p.latinName || p.latin || '',
    image: p.image || '',
    skuLabel: p.skuLabel || '',
    count: p.count || 1,
    price: hidePrice ? undefined : p.price
  }))
}

function computeExpireAt(fromDate, days) {
  const base = fromDate instanceof Date ? fromDate.getTime() : Date.now()
  const d = Math.min(30, Math.max(1, parseInt(days, 10) || DEFAULT_ADDRESS_TIMEOUT_DAYS))
  return new Date(base + d * 24 * 60 * 60 * 1000)
}

module.exports = {
  DELIVERY_TYPES,
  DEFAULT_ADDRESS_TIMEOUT_DAYS,
  createShareToken,
  createClaimCode,
  normalizeGiftMeta,
  isInviteAddressGift,
  isGiftOrder,
  needsAddressBeforeShip,
  maskPhone,
  buildProductSnapshot,
  computeExpireAt
}
