/**
 * 隐私授权失败的统一处理
 *
 * 背景：小程序调用相册/摄像头/位置/地址/麦克风/剪贴板等隐私接口前需用户同意
 * 《用户隐私保护指引》。未同意或后台未配置指引时，接口会以
 * `errno: 104 / api scope is not declared in the privacy agreement` 之类失败。
 *
 * 注意：本文件**不**注册 `wx.onNeedPrivacyAuthorization`，也不做 `requirePrivacyAuthorize`
 * 预门控 —— 微信自带默认隐私弹窗，自行注册若实现不当会出现 success/fail 都不回调的静默挂起
 * （见 utils/pickAvatar.js 顶部结论）。这里只做「失败后的可解释恢复路径」。
 */

/** 是否为隐私协议相关的失败 */
function isPrivacyError(err) {
  const msg = String((err && (err.errMsg || err.message)) || err || '')
  return /privacy|agreePrivacyAuthorization|scope is not declared|需要同意|隐私/i.test(msg)
}

/**
 * 展示隐私失败的恢复引导。
 * @param {{ title?: string, content?: string }} [opts]
 */
function showPrivacyGuide(opts) {
  const title = (opts && opts.title) || '需要先同意隐私保护指引'
  const content =
    (opts && opts.content) ||
    '该功能需要读取相册/摄像头等信息。请查看并同意《用户隐私保护指引》后重试；如你此前拒绝过授权，可在「设置」中重新开启。'
  wx.showModal({
    title,
    content,
    confirmText: '查看指引',
    cancelText: '暂不使用',
    confirmColor: '#C4A76C',
    success: (res) => {
      if (!res.confirm) return
      if (typeof wx.openPrivacyContract === 'function') {
        wx.openPrivacyContract({
          fail: () => wx.showToast({ title: '暂无法打开指引，请稍后重试', icon: 'none' })
        })
      } else {
        wx.showToast({ title: '请在小程序内查看隐私政策', icon: 'none' })
      }
    }
  })
}

/**
 * 统一失败出口：隐私类错误走引导弹窗，其它错误原样回调。
 * @param {any} err
 * @param {{ onOther?: (err:any)=>void, title?: string, content?: string }} [opts]
 * @returns {boolean} 是否已按隐私错误处理
 */
function handleMediaFailure(err, opts) {
  if (isPrivacyError(err)) {
    showPrivacyGuide(opts)
    return true
  }
  if (opts && typeof opts.onOther === 'function') opts.onOther(err)
  return false
}

module.exports = {
  isPrivacyError,
  showPrivacyGuide,
  handleMediaFailure
}
