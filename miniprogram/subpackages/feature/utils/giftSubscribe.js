/**
 * 礼赠订阅消息（模板未齐时不假接）
 *
 * 微信公众平台审核通过后：
 * 1) 云函数环境变量（真发）：
 *    - GIFT_NUDGE_TMPL_ID      催填 / 支付后提醒分享填址
 *    - GIFT_FULFILL_TMPL_ID    填址完成即将启程
 *    - GIFT_EXPIRE_TMPL_ID     即将过期 / 已过期（可空，回退 NUDGE）
 *    配置在 manageGift / confirmPayment / payCallback
 * 2) 客户端常量（授权弹窗）：与上同名，填入下方常量后 success / nudge 会 requestSubscribeMessage
 *
 * 未配置时 requestGiftSubscribe 静默 skip（skipped:true），仅依赖山海有信；
 * 不弹失败 toast、不调用空模板。详见 docs/gift-ops.md「订阅消息」。
 */

const GIFT_NUDGE_TMPL_ID = ''
const GIFT_FULFILL_TMPL_ID = ''
const GIFT_EXPIRE_TMPL_ID = ''

function tmplIdsForScene(scene) {
  const ids = []
  if ((scene === 'nudge' || scene === 'paid' || scene === 'paid_await_address') && GIFT_NUDGE_TMPL_ID) {
    ids.push(GIFT_NUDGE_TMPL_ID)
  }
  if ((scene === 'fulfill' || scene === 'ship' || scene === 'pickup') && GIFT_FULFILL_TMPL_ID) {
    ids.push(GIFT_FULFILL_TMPL_ID)
  }
  if (scene === 'expire' && (GIFT_EXPIRE_TMPL_ID || GIFT_NUDGE_TMPL_ID)) {
    ids.push(GIFT_EXPIRE_TMPL_ID || GIFT_NUDGE_TMPL_ID)
  }
  if (scene === 'all') {
    if (GIFT_NUDGE_TMPL_ID) ids.push(GIFT_NUDGE_TMPL_ID)
    if (GIFT_FULFILL_TMPL_ID) ids.push(GIFT_FULFILL_TMPL_ID)
    if (GIFT_EXPIRE_TMPL_ID) ids.push(GIFT_EXPIRE_TMPL_ID)
  }
  return ids.filter(Boolean)
}

function hasGiftSubscribeTemplates(scene) {
  return tmplIdsForScene(scene || 'all').length > 0
}

/** 克制提示：模板未配时给用户的一行说明（可空则不展示） */
function giftSubscribeSkipHint(scene) {
  if (hasGiftSubscribeTemplates(scene)) return ''
  return '进度将经山海有信送达'
}

/**
 * @param {'nudge'|'fulfill'|'ship'|'pickup'|'expire'|'paid'|'paid_await_address'|'all'} scene
 * @returns {Promise<{ skipped?: boolean, reason?: string, res?: object, err?: object }>}
 */
function requestGiftSubscribe(scene) {
  const tmplIds = tmplIdsForScene(scene || 'all')
  if (!tmplIds.length) {
    return Promise.resolve({ skipped: true, reason: 'TMPL_PENDING' })
  }
  if (typeof wx === 'undefined' || !wx.requestSubscribeMessage) {
    return Promise.resolve({ skipped: true, reason: 'UNSUPPORTED' })
  }
  return new Promise((resolve) => {
    try {
      wx.requestSubscribeMessage({
        tmplIds,
        success: (res) => resolve({ skipped: false, res }),
        fail: (err) => {
          // 用户拒绝 / 系统限制：静默，不抛、不 toast
          resolve({ skipped: true, reason: 'FAIL', err })
        }
      })
    } catch (e) {
      resolve({ skipped: true, reason: 'THROW', err: e })
    }
  })
}

module.exports = {
  GIFT_NUDGE_TMPL_ID,
  GIFT_FULFILL_TMPL_ID,
  GIFT_EXPIRE_TMPL_ID,
  tmplIdsForScene,
  hasGiftSubscribeTemplates,
  giftSubscribeSkipHint,
  requestGiftSubscribe
}
