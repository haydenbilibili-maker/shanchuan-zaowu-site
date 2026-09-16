/**
 * C 端内容展示开关（对齐 getContentDisplayFlags）
 * 带分层 TTL + SWR，多页共用同一份缓存，避免 Tab 切换狂打云函数。
 */

const { swr, peekCache, invalidate, TTL, STALE_WINDOW } = require('./cache')

const CLOSED_CUSTOM_TOAST = '标本定制暂未开放'
const CLOSED_PET_MEMORIAL_TOAST = '伴宠记忆暂未开放'
const CLOSED_LIVE_TOAST = '直播暂未开放'
const CLOSED_STORED_VALUE_TOAST = '我的钱包暂未开放'
const CLOSED_AI_IDENTIFY_TOAST = 'AI 鉴定暂未开放'
const CLOSED_STORE_TOAST = '这有店暂未开放'
const CLOSED_STORE_PICKUP_TOAST = '门店自取暂未开放'
const CLOSED_GIFT_TOAST = '礼赠暂未开放，柜门稍后再启'
const CLOSED_WISH_WALL_TOAST = '祈福墙暂未开放'

const CACHE_KEY = 'CONTENT_FLAGS'

function normalizeContentDisplayFlags(raw) {
  const src = raw || {}
  return {
    showSpecimenArchive: src.showSpecimenArchive === true,
    showUserCommunity: src.showUserCommunity === true,
    showBookingEntry: src.showBookingEntry !== false,
    // 缺字段 / undefined → 关闭；本阶段默认不支持标本定制
    showSpecimenCustom: src.showSpecimenCustom === true,
    // 缺字段 / undefined → 开启；现网已开放伴宠记忆，仅显式 false 关闭
    showPetMemorial: src.showPetMemorial !== false,
    // 缺字段 / undefined → 关闭；直播默认不展示
    showLive: src.showLive === true,
    // 缺字段 / undefined → 关闭；我的钱包默认不展示
    showStoredValue: src.showStoredValue === true,
    // 缺字段 / undefined → 开启；现网已开放，仅显式 false 关闭
    showAiIdentify: src.showAiIdentify !== false,
    // 缺字段 / undefined → 开启；现网已有门店，仅显式 false 关闭
    showStore: src.showStore !== false,
    // 缺字段 / undefined → 开启；门店自取在售，仅显式 false 关闭
    showStorePickup: src.showStorePickup !== false,
    // 缺字段 / undefined → 关闭；礼赠默认不展示
    showGift: src.showGift === true,
    // 缺字段 / undefined → 开启；iOS 储值充值默认允许（仅显式 false 关闭）
    allowIosStoredValue: src.allowIosStoredValue !== false,
    // 缺字段 / undefined → 开启；列表缩略图默认开
    imageThumbEnabled: src.imageThumbEnabled !== false,
    // 需求 22/23：山海图鉴 / 我的成就；缺字段 → 开启（现网已开放，仅显式 false 关闭）
    showAtlas: src.showAtlas !== false,
    showAchievements: src.showAchievements !== false,
    // 需求 28：「马上有」祈福弹幕；缺字段 → **关闭**（UGC 新能力由超管显式开启）
    showMaShangYou: src.showMaShangYou === true
  }
}

/** 需求 28：祈福墙关闭时的统一提示 */
function toastWishWallClosed() {
  wx.showToast({ title: CLOSED_WISH_WALL_TOAST, icon: 'none' })
}

function toastLiveClosed() {
  wx.showToast({ title: CLOSED_LIVE_TOAST, icon: 'none' })
}

/**
 * 把「列表缩略图」开关同步给 utils/imageUrl（需求 17）。
 * 放在这里的原因：所有页面都经由 fetchContentDisplayFlags 拿开关，一处生效全局跟随；
 * 工具缺失或异常时静默忽略，绝不因埋点/图片优化影响主流程。
 */
function applyImageThumbFlag(rawFlags) {
  try {
    const { setThumbFlag } = require('./imageUrl')
    setThumbFlag(!rawFlags || rawFlags.imageThumbEnabled !== false)
  } catch (e) { /* ignore */ }
}

function toastStoredValueClosed() {
  wx.showToast({ title: CLOSED_STORED_VALUE_TOAST, icon: 'none' })
}

function toastAiIdentifyClosed() {
  wx.showToast({ title: CLOSED_AI_IDENTIFY_TOAST, icon: 'none' })
}

function toastStoreClosed() {
  wx.showToast({ title: CLOSED_STORE_TOAST, icon: 'none' })
}

function toastStorePickupClosed() {
  wx.showToast({ title: CLOSED_STORE_PICKUP_TOAST, icon: 'none' })
}

function toastGiftClosed() {
  wx.showToast({ title: CLOSED_GIFT_TOAST, icon: 'none' })
}

function toastSpecimenCustomClosed() {
  wx.showToast({ title: CLOSED_CUSTOM_TOAST, icon: 'none' })
}

function toastPetMemorialClosed() {
  wx.showToast({ title: CLOSED_PET_MEMORIAL_TOAST, icon: 'none' })
}

function wrapPayload(flags, extra) {
  return Object.assign({
    success: true,
    flags: normalizeContentDisplayFlags(flags),
    docId: '',
    default: false
  }, extra || {})
}

/** 同步读缓存（首屏水合，避免开关闪烁） */
function getCachedContentDisplayFlags() {
  const peeked = peekCache(CACHE_KEY, { staleMs: STALE_WINDOW.FLAGS })
  if (!peeked || !peeked.data) return null
  return wrapPayload(peeked.data.flags || peeked.data, {
    docId: peeked.data.docId || '',
    default: !!peeked.data.default,
    fromCache: true,
    fresh: peeked.fresh
  })
}

async function fetchFromCloud() {
  const res = await wx.cloud.callFunction({ name: 'getContentDisplayFlags' })
  const result = (res && res.result) || {}
  return {
    success: result.success !== false,
    flags: normalizeContentDisplayFlags(result.flags || {}),
    docId: result.docId || '',
    default: !!result.default
  }
}

/**
 * @param {{ force?: boolean, revalidate?: boolean, onUpdate?: Function }} [options]
 */
async function fetchContentDisplayFlags(options) {
  const opts = options || {}
  try {
    const payload = await swr(CACHE_KEY, fetchFromCloud, {
      expiry: TTL.FLAGS,
      staleMs: STALE_WINDOW.FLAGS,
      force: !!opts.force,
      revalidate: !!opts.revalidate,
      onUpdate: opts.onUpdate
        ? (data, meta) => {
          applyImageThumbFlag(data.flags || data)
          opts.onUpdate(wrapPayload(data.flags || data, {
            docId: data.docId || '',
            default: !!data.default
          }), meta)
        }
        : undefined
    })
    if (!payload) {
      return wrapPayload({}, { success: false, default: true, fallback: true })
    }
    // 需求 17：把列表缩略图开关同步给 imageUrl（一处生效，全局跟随）
    applyImageThumbFlag(payload.flags || payload)
    return wrapPayload(payload.flags || payload, {
      success: payload.success !== false,
      docId: payload.docId || '',
      default: !!payload.default
    })
  } catch (e) {
    console.warn('fetchContentDisplayFlags', e && e.message)
    const cached = getCachedContentDisplayFlags()
    if (cached) return Object.assign(cached, { success: false, fallback: true })
    return {
      success: false,
      flags: normalizeContentDisplayFlags({}),
      docId: '',
      default: true,
      fallback: true
    }
  }
}

function invalidateContentDisplayFlags() {
  invalidate(CACHE_KEY)
}

module.exports = {
  CLOSED_CUSTOM_TOAST,
  CLOSED_PET_MEMORIAL_TOAST,
  CLOSED_LIVE_TOAST,
  CLOSED_STORED_VALUE_TOAST,
  CLOSED_AI_IDENTIFY_TOAST,
  CLOSED_STORE_TOAST,
  CLOSED_STORE_PICKUP_TOAST,
  CLOSED_GIFT_TOAST,
  CLOSED_WISH_WALL_TOAST,
  normalizeContentDisplayFlags,
  fetchContentDisplayFlags,
  getCachedContentDisplayFlags,
  invalidateContentDisplayFlags,
  toastSpecimenCustomClosed,
  toastPetMemorialClosed,
  toastLiveClosed,
  toastStoredValueClosed,
  toastAiIdentifyClosed,
  toastStoreClosed,
  toastStorePickupClosed,
  toastGiftClosed,
  toastWishWallClosed
}
