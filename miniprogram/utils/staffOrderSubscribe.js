/**
 * 店长 / 超管：新订单 + 工单类订阅消息授权（客户端）
 *
 * 两类模板：
 *   1. 订单类：`STAFF_ORDER_PAID_TMPL_ID`（云函数 payCallback / confirmPayment）
 *   2. 工单类：`STAFF_APPROVAL_TMPL_ID` / `STAFF_INVOICE_TMPL_ID` /
 *             `STAFF_DEPOSIT_TMPL_ID` / `STAFF_RESTOCK_TMPL_ID` /
 *             `STAFF_PET_MEMORIAL_TMPL_ID`（云函数 dispatchMessage）
 *             其中 `STAFF_PET_MEMORIAL_TMPL_ID` 是需求 14 的「伴宠工单指派」，
 *             定向发给被客户指定的标本师本人。
 *
 * 重要（微信平台限制）：
 * - `requestSubscribeMessage` 必须在**用户 tap / showModal 确认回调的同步栈**内调用，
 *   不可放在 onShow 或 await 之后。
 * - 一次性模板：每次「允许」攒 **1 次**下发额度，发完即尽；未授权或额度用尽服务端会 43101。
 * - 模板 ID 必须**同时**配在云函数环境变量与这里（微信不允许客户端动态取模板 ID）。
 *   ⚠️ 工单类模板待公众平台创建后回填下方常量；留空则本次授权自动跳过该模板，
 *      不影响其它模板 —— 因此本文件可先行上线。
 *
 * 下发字段（服务端）：
 *   订单类 `staffOrderSubscribe.js`：character_string1 订单号 / thing2 商品 / time5 下单时间 / thing3 收货人 / thing4 地址
 *   工单类 `workOrderSubscribe.js`：按类别（审批/开票/定金/补货）各自的字段描述符
 */

/** 订单类模板（已上线） */
const STAFF_ORDER_PAID_TMPL_ID = 'MLNyj-ejvgFLt5mBWXEtIUJL59ZaJREtWhLJq6SRbtk'

/**
 * 工单类模板（需求 16）。**待公众平台创建后回填**，留空则自动跳过。
 * 与云函数 `dispatchMessage` 的环境变量一一对应。
 */
const STAFF_APPROVAL_TMPL_ID = ''
const STAFF_INVOICE_TMPL_ID = ''
const STAFF_DEPOSIT_TMPL_ID = ''
const STAFF_RESTOCK_TMPL_ID = ''
const STAFF_PET_MEMORIAL_TMPL_ID = ''

/** 全部可用于授权的模板 ID（去空、去重） */
function allStaffTmplIds() {
  const raw = [
    STAFF_ORDER_PAID_TMPL_ID,
    STAFF_APPROVAL_TMPL_ID,
    STAFF_INVOICE_TMPL_ID,
    STAFF_DEPOSIT_TMPL_ID,
    STAFF_RESTOCK_TMPL_ID,
    STAFF_PET_MEMORIAL_TMPL_ID
  ]
  const seen = new Set()
  const out = []
  raw.forEach((id) => {
    const v = String(id || '').trim()
    if (!v || seen.has(v)) return
    seen.add(v)
    out.push(v)
  })
  return out
}

function tmplIdsForStaffOrder() {
  return STAFF_ORDER_PAID_TMPL_ID ? [STAFF_ORDER_PAID_TMPL_ID] : []
}

/** 工单类模板（已回填的那些） */
function tmplIdsForWorkOrder() {
  return [
    STAFF_APPROVAL_TMPL_ID,
    STAFF_INVOICE_TMPL_ID,
    STAFF_DEPOSIT_TMPL_ID,
    STAFF_RESTOCK_TMPL_ID,
    STAFF_PET_MEMORIAL_TMPL_ID
  ]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
}

function requestSubscribeIds(tmplIds, { showTip, tipText }) {
  const ids = (tmplIds || []).map((x) => String(x || '').trim()).filter(Boolean)
  if (!ids.length) {
    return Promise.resolve({ skipped: true, reason: 'NO_TMPL' })
  }
  if (typeof wx === 'undefined' || !wx.requestSubscribeMessage) {
    return Promise.resolve({ skipped: true, reason: 'NO_API' })
  }
  return new Promise((resolve) => {
    try {
      wx.requestSubscribeMessage({
        tmplIds: ids,
        success: (res) => {
          const acceptedIds = ids.filter((id) => res && res[id] === 'accept')
          const first = ids[0]
          const st = (res && res[first]) || ''
          if (showTip) {
            if (acceptedIds.length) {
              wx.showToast({ title: tipText || '已开启通知', icon: 'none' })
            } else if (st === 'reject') {
              wx.showToast({ title: '未允许，将收不到服务通知', icon: 'none' })
            } else if (st === 'ban') {
              wx.showToast({ title: '请到小程序设置中开启通知', icon: 'none', duration: 2500 })
            }
          }
          resolve({ skipped: false, accepted: acceptedIds.length > 0, acceptedIds, reason: st })
        },
        fail: (err) => {
          const msg = (err && (err.errMsg || err.message)) || 'fail'
          console.warn('[staffSubscribe] request fail', msg)
          if (showTip) {
            const needTap = /TAP gesture|tap gesture/i.test(msg)
            wx.showToast({ title: needTipMessage(needTap, msg), icon: 'none', duration: 2500 })
          }
          resolve({ skipped: false, accepted: false, acceptedIds: [], reason: msg })
        }
      })
    } catch (e) {
      resolve({ skipped: true, reason: (e && e.message) || 'throw' })
    }
  })
}

/**
 * 在店长/超管点击进入工作台、点「订单」、或点「开启微信通知」时调用。
 * @param {{ showTip?: boolean, tmplIds?: string[] }} [opts]
 */
function requestStaffOrderSubscribe(opts) {
  const showTip = !!(opts && opts.showTip)
  const tmplIds = opts && Array.isArray(opts.tmplIds) && opts.tmplIds.length
    ? opts.tmplIds
    : tmplIdsForStaffOrder()
  return requestSubscribeIds(tmplIds, { showTip, tipText: '已开启新订单通知' })
}

/**
 * 需求 16：一次点击同时攒「新订单 + 工单类」全部模板的额度，
 * 避免为每个工单类别各弹一次授权。
 */
function requestStaffAllSubscribe(opts) {
  const showTip = !!(opts && opts.showTip)
  return requestSubscribeIds(allStaffTmplIds(), { showTip, tipText: '已开启工作通知' })
}

function needTipMessage(needTap, msg) {
  if (needTap) return '请点击按钮后再授权'
  if (/ban|设置/i.test(String(msg || ''))) return '请到小程序设置中开启通知'
  return '暂时无法弹出授权'
}

module.exports = {
  STAFF_ORDER_PAID_TMPL_ID,
  STAFF_APPROVAL_TMPL_ID,
  STAFF_INVOICE_TMPL_ID,
  STAFF_DEPOSIT_TMPL_ID,
  STAFF_RESTOCK_TMPL_ID,
  STAFF_PET_MEMORIAL_TMPL_ID,
  allStaffTmplIds,
  tmplIdsForStaffOrder,
  tmplIdsForWorkOrder,
  requestStaffOrderSubscribe,
  requestStaffAllSubscribe
}
