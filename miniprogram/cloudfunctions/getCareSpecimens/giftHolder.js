/**
 * 礼赠持有权 —— 读时推导，不落库（证书 / 养护 / 触达共用判据）
 * 蓝图：miniprogram/docs/礼赠_证书与养护闭环_2026-09-28.md
 * 逐字副本（check:gift-holder 钉住）：cloudfunctions/sendCareReminder、cloudfunctions/getCareSpecimens
 */
var VOID_STATUS = { refunded: 1, cancelled: 1, void: 1, expired_refunding: 1 }

function isGiftOrder(order) {
  return !!(order && (order.source === 'gift' || order.giftMeta))
}

function isGiverOf(order, openid) {
  return !!(order && openid && (order._openid === openid || order.openid === openid))
}

function receiverOf(order) {
  var meta = (order && order.giftMeta) || {}
  return String(meta.receiverOpenid || '')
}

/** 持有人 openid；'' = 礼赠尚未绑定受礼人（线上暂无持有人） */
function resolveHolderOpenid(order) {
  if (!order) return ''
  if (!isGiftOrder(order)) return String(order._openid || order.openid || '')
  return receiverOf(order)
}

function isVoidGift(order) {
  return !!(order && isGiftOrder(order) && VOID_STATUS[order.status])
}

/**
 * 查看者对该单的证书身份：
 * holder 收藏证书 · giver 赠予凭证 · pending 礼赠未签收 · void 礼赠已结束 · none 与本单无关
 * 非礼赠单：下单人恒为 holder（与改动前一致，不看状态）
 */
function resolveCertRole(order, openid) {
  if (!order || !openid) return 'none'
  var receiver = receiverOf(order)
  var isReceiver = !!receiver && receiver === openid
  if (!isGiverOf(order, openid) && !isReceiver) return 'none'
  if (!isGiftOrder(order)) return 'holder'
  if (VOID_STATUS[order.status]) return 'void'
  if (order.status !== 'received') return 'pending'
  return isReceiver ? 'holder' : 'giver'
}

function toMillis(v) {
  if (!v) return 0
  if (typeof v === 'number') return v
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'object' && v.$date) return new Date(v.$date).getTime()
  var t = new Date(v).getTime()
  return isFinite(t) ? t : 0
}

/** 证书上的礼赠信息：署名取送礼人在礼笺上的落款（不查对方资料） */
function giftCertInfo(order) {
  var meta = (order && order.giftMeta) || {}
  return {
    fromName: String(meta.cardSignature || '').trim(),
    recipientName: String(meta.recipientName || meta.salutation || '').trim(),
    note: String(meta.cardBody || '').replace(/\s+/g, ' ').trim(),
    receivedAt: toMillis(order && (order.receiveTime || meta.claimedAt))
  }
}

/**
 * 证书签发时间：首次签发时固化在 certMeta.issuedAt；存量单未固化 → 取最接近的真实签收时间（读时推导，不迁移）。
 * 0 = 尚无任何签收时间（未签收单）
 */
function certIssuedAt(order) {
  if (!order) return 0
  var cm = order.certMeta || {}
  var meta = order.giftMeta || {}
  return toMillis(cm.issuedAt) || toMillis(order.receiveTime) || toMillis(meta.claimedAt) ||
    toMillis(order.pickupClaimedAt) || toMillis(order.autoReceivedAt)
}

/** 证书版式：holder 普通收藏证书 · gift_holder 受礼人收藏证书 · gift_voucher 送礼人赠予凭证 · '' 不签发 */
function certKindOf(order, openid) {
  var role = resolveCertRole(order, openid)
  if (role === 'none' || role === 'pending' || role === 'void') return ''
  if (!isGiftOrder(order)) return 'holder'
  return role === 'giver' ? 'gift_voucher' : 'gift_holder'
}

function certSerial(order, role) {
  var no = String((order && order.orderNo) || '')
  return role === 'giver' ? 'GV-' + no : no
}

module.exports = {
  isGiftOrder: isGiftOrder,
  isGiverOf: isGiverOf,
  receiverOf: receiverOf,
  resolveHolderOpenid: resolveHolderOpenid,
  isVoidGift: isVoidGift,
  resolveCertRole: resolveCertRole,
  toMillis: toMillis,
  giftCertInfo: giftCertInfo,
  certIssuedAt: certIssuedAt,
  certKindOf: certKindOf,
  certSerial: certSerial
}
