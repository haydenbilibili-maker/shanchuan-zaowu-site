/**
 * 礼赠受礼人手机号（领取核验）· 逐字副本：cloudfunctions/makeOrder、cloudfunctions/manageGift（check:gift-holder 钉住）
 * 蓝图 miniprogram/docs/礼赠_证书与养护闭环_2026-09-28.md §8 / §14。
 *
 * 只存加盐哈希 + 尾号到 gift_receiver_verify（仅云函数可读写）；orders 登录可读，号码与哈希都不得落 orders。
 *
 * 强制填写（2026-09-28 产品负责人拍板）：
 *   - 新版客户端下单带能力标记 clientCaps 含 GIFT_PHONE_CAP → 缺号 / 号码不合法即拒绝建礼赠单（GIFT_RECEIVER_PHONE_REQUIRED）；
 *   - 旧版客户端不带标记 → 暂不拒绝（否则线上旧版送礼直接失败）；
 *   - 新版全量后开启「对所有请求强制」：把 ENFORCE_ALL_DEFAULT 改为 true 并部署 makeOrder，
 *     或不改代码、给 makeOrder 配环境变量 GIFT_PHONE_ENFORCE_ALL=1。默认关。
 *
 * 凭礼笺领取（2026-10-11 拍板，蓝图 miniprogram/docs/礼赠凭礼笺领取_2026-10-11.md）：
 *   带 GIFT_CLAIM_LINK_CAP 且 giftClaimMode='link'、交付方式在 CLAIM_LINK_DELIVERY 内、未带有效号码 → 免填号，
 *   订单标 claimMode:'link'；可选 6 位口令（passcode 只进核验集合）。其它交付方式仍按上面规则必填。
 */
const crypto = require('crypto')

const GIFT_PHONE_CAP = 'gift_receiver_phone_v1'
const ENFORCE_ALL_DEFAULT = false
const GIFT_VERIFY_COL = 'gift_receiver_verify'
const GIFT_CLAIM_LINK_CAP = 'gift_claim_link_v1'
const CLAIM_LINK_DELIVERY = ['invite_address', 'store_pickup']

function enforceAllGiftPhone() {
  return ENFORCE_ALL_DEFAULT || String(process.env.GIFT_PHONE_ENFORCE_ALL || '') === '1'
}

function clientHasGiftPhoneCap(event) {
  const caps = event && event.clientCaps
  return Array.isArray(caps) && caps.indexOf(GIFT_PHONE_CAP) !== -1
}

function claimLinkAllowed(deliveryType) {
  return CLAIM_LINK_DELIVERY.indexOf(deliveryType) !== -1
}

function wantsClaimLink(event, deliveryType) {
  const caps = event && event.clientCaps
  return !!(event && event.giftClaimMode === 'link' && Array.isArray(caps) && caps.indexOf(GIFT_CLAIM_LINK_CAP) !== -1 && claimLinkAllowed(deliveryType))
}

function createPasscode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0')
}

function normalizeCnPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '')
  const phone = digits.length === 13 && digits.indexOf('86') === 0 ? digits.slice(2) : digits
  return /^1\d{10}$/.test(phone) ? phone : ''
}

function hashPhone(salt, phone) {
  return crypto.createHash('sha256').update(`${salt}:${phone}`).digest('hex')
}

/** gift_receiver_verify 文档体（_id = orderId 由调用方 doc(orderId).set 指定） */
function buildVerifyDoc(orderId, giverOpenid, phone, now) {
  const salt = crypto.randomBytes(16).toString('hex')
  return {
    orderId,
    giverOpenid,
    salt,
    phoneHash: hashPhone(salt, phone),
    phoneTail: phone.slice(-4),
    attempts: [],
    verifiedOpenid: '',
    updatedAt: now
  }
}

/** 凭礼笺领取的核验文档：无号码，可选口令（仅云函数可读） */
function buildLinkVerifyDoc(orderId, giverOpenid, passcode, now) {
  return { orderId, giverOpenid, salt: '', phoneHash: '', phoneTail: '', passcode: passcode || '', attempts: [], verifiedOpenid: '', updatedAt: now }
}

/** 下单校验：{ required, phone, claimLink }；required && !phone → 应拒绝 */
function checkGiftReceiverPhone(event, deliveryType) {
  const phone = normalizeCnPhone(event && event.giftReceiverPhone)
  const claimLink = !phone && wantsClaimLink(event, deliveryType)
  return {
    required: (clientHasGiftPhoneCap(event) || enforceAllGiftPhone()) && !claimLink,
    phone,
    claimLink
  }
}

module.exports = {
  GIFT_PHONE_CAP,
  ENFORCE_ALL_DEFAULT,
  GIFT_VERIFY_COL,
  GIFT_CLAIM_LINK_CAP,
  CLAIM_LINK_DELIVERY,
  claimLinkAllowed,
  wantsClaimLink,
  createPasscode,
  buildLinkVerifyDoc,
  enforceAllGiftPhone,
  clientHasGiftPhoneCap,
  normalizeCnPhone,
  hashPhone,
  buildVerifyDoc,
  checkGiftReceiverPhone
}
