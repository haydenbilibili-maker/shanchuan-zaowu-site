/**
 * 预约订阅消息（C 端授权）。模板 ID 与 cloudfunctions/sendBookingReminder/subscribeTemplates.js 一致。
 * requestSubscribeMessage 只能在用户点击的同步栈里调用：报名按钮的 tap 里先请求，complete 后再走确认弹层；
 * 拒绝 / 失败 / 不支持都照常继续，不阻塞报名。改期模板未申请，不请求。
 */
const BOOKING_CANCEL_TMPL_ID = 'C_vs4N7_ahe1KAVmBSclyR02FsGf0MzJU5Xfou3tQbk'

function requestBookingSubscribe(next) {
  let done = false
  const go = () => {
    if (done) return
    done = true
    next()
  }
  if (typeof wx === 'undefined' || !wx.requestSubscribeMessage) return go()
  try {
    wx.requestSubscribeMessage({ tmplIds: [BOOKING_CANCEL_TMPL_ID], complete: go })
  } catch (e) {
    go()
  }
}

module.exports = { BOOKING_CANCEL_TMPL_ID, requestBookingSubscribe }
