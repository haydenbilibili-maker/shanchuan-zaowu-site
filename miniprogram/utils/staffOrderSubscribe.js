/**
 * 店长 / 超管：新订单订阅消息授权（客户端）
 *
 * 1) 云函数环境变量 STAFF_ORDER_PAID_TMPL_ID（payCallback / confirmPayment）
 * 2) 下方常量填入同一模板 ID 后，在「用户点击」同步栈内 requestSubscribeMessage
 *
 * 重要（微信限制）：
 * - 必须在用户 tap / showModal 确认回调中同步调用，不可放在 onShow / await 之后
 * - 一次性模板：每次「允许」攒 1 次下发额度；未授权或额度用尽时服务端会 43101
 *
 * 下发字段（服务端 staffOrderSubscribe.js，与公众平台一致）：
 * character_string1 订单号 / thing2 商品 / time5 下单时间 /
 * thing3 收货人名 / thing4 收货地址
 */
const STAFF_ORDER_PAID_TMPL_ID = 'MLNyj-ejvgFLt5mBWXEtIUJL59ZaJREtWhLJq6SRbtk'

function tmplIdsForStaffOrder() {
  const ids = []
  if (STAFF_ORDER_PAID_TMPL_ID) ids.push(STAFF_ORDER_PAID_TMPL_ID)
  return ids
}

/**
 * 在店长/超管点击进入工作台、点「订单」、或点「开启微信通知」时调用。
 * @param {{ showTip?: boolean }} [opts]
 * @returns {Promise<{ skipped: boolean, accepted?: boolean, reason?: string }>}
 */
function requestStaffOrderSubscribe(opts) {
  const showTip = !!(opts && opts.showTip)
  const tmplIds = tmplIdsForStaffOrder()
  if (!tmplIds.length) {
    return Promise.resolve({ skipped: true, reason: 'NO_TMPL' })
  }
  if (typeof wx === 'undefined' || !wx.requestSubscribeMessage) {
    return Promise.resolve({ skipped: true, reason: 'NO_API' })
  }
  return new Promise((resolve) => {
    try {
      wx.requestSubscribeMessage({
        tmplIds,
        success: (res) => {
          const id = tmplIds[0]
          const st = res && res[id]
          const accepted = st === 'accept'
          if (showTip) {
            if (accepted) {
              wx.showToast({ title: '已开启新订单通知', icon: 'none' })
            } else if (st === 'reject') {
              wx.showToast({ title: '未允许，将收不到服务通知', icon: 'none' })
            } else if (st === 'ban') {
              wx.showToast({ title: '请到小程序设置中开启通知', icon: 'none', duration: 2500 })
            }
          }
          resolve({ skipped: false, accepted, reason: st || '' })
        },
        fail: (err) => {
          const msg = (err && (err.errMsg || err.message)) || 'fail'
          console.warn('[staffOrderSubscribe] request fail', msg)
          if (showTip) {
            const needTap = /TAP gesture|tap gesture/i.test(msg)
            wx.showToast({
              title: needTipMessage(needTap, msg),
              icon: 'none',
              duration: 2500
            })
          }
          resolve({ skipped: false, accepted: false, reason: msg })
        }
      })
    } catch (e) {
      resolve({ skipped: true, reason: (e && e.message) || 'throw' })
    }
  })
}

function needTipMessage(needTap, msg) {
  if (needTap) return '请点击按钮后再授权'
  if (/ban|设置/i.test(String(msg || ''))) return '请到小程序设置中开启通知'
  return '暂时无法弹出授权'
}

module.exports = {
  STAFF_ORDER_PAID_TMPL_ID,
  tmplIdsForStaffOrder,
  requestStaffOrderSubscribe
}
