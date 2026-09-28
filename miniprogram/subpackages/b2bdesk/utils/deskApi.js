/**
 * 供应商管理中心 · 云函数调用（全部经 manageSupplierDesk；页面不直连集合）
 * 失败一律返回 { success:false, msg }，由页面落到可见的错误态（不弹原生框）。
 */
function friendlyError(e) {
  const msg = String((e && (e.errMsg || e.message)) || '')
  if (/FUNCTION_NOT_FOUND|-501000|FunctionName parameter could not be found/i.test(msg)) {
    return '云函数 manageSupplierDesk 未部署，请先部署后再试'
  }
  if (/timeout|超时/i.test(msg)) return '请求超时，请检查网络后重试'
  return msg ? `请求失败：${msg.slice(0, 80)}` : '请求失败，请重试'
}

function callDesk(action, data) {
  if (!wx.cloud) return Promise.resolve({ success: false, code: 'NO_CLOUD', msg: '云能力不可用' })
  return wx.cloud
    .callFunction({ name: 'manageSupplierDesk', data: { ...(data || {}), action } })
    .then((res) => {
      const r = (res && res.result) || {}
      if (r.success === false && !r.msg) r.msg = '操作失败'
      return r
    })
    .catch((e) => ({ success: false, code: 'CALL_FAIL', msg: friendlyError(e) }))
}

function yuan(fen) {
  const n = Math.round(Number(fen) || 0)
  const abs = Math.abs(n)
  const y = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const c = abs % 100
  return `${n < 0 ? '-' : ''}¥${y}${c ? '.' + String(c).padStart(2, '0') : ''}`
}

function copyText(text, done) {
  const v = String(text || '').trim()
  if (!v) return
  wx.setClipboardData({
    data: v,
    success: () => done && done(true),
    fail: () => done && done(false)
  })
}

module.exports = { callDesk, yuan, copyText }
