/**
 * 头像选图：相册 / 拍照。
 * 直接调 chooseMedia（或 chooseImage 兜底），由微信官方隐私弹窗处理授权。
 * 不要用 requirePrivacyAuthorize 预门控——未注册 onNeedPrivacyAuthorization 时，
 * 部分真机/审核环境会出现 success/fail 都不回调的静默挂起。
 */

const { showPrivacyGuide } = require('./privacy')

function pickAvatarImage() {
  return new Promise((resolve, reject) => {
    const fail = (err) => {
      const msg = String((err && err.errMsg) || err || '')
      if (/cancel|取消/i.test(msg)) {
        const e = new Error('CANCEL')
        e.code = 'CANCEL'
        reject(e)
        return
      }
      if (/privacy|authorize|scope is not declared/i.test(msg)) {
        const e = new Error('PRIVACY')
        e.code = 'PRIVACY'
        reject(e)
        return
      }
      const e = new Error(msg || 'PICK_FAIL')
      e.code = 'PICK_FAIL'
      reject(e)
    }

    const ok = (path) => {
      if (!path) {
        fail({ errMsg: 'empty path' })
        return
      }
      resolve(path)
    }

    if (typeof wx.chooseMedia === 'function') {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success: (res) => {
          const file = (res.tempFiles && res.tempFiles[0]) || {}
          ok(file.tempFilePath)
        },
        fail
      })
      return
    }

    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => ok((res.tempFilePaths || [])[0]),
      fail
    })
  })
}

function avatarExtFromPath(filePath) {
  const clean = String(filePath || '').split('?')[0]
  const m = /\.(jpe?g|png|gif|webp)$/i.exec(clean)
  if (!m) return 'jpg'
  const ext = m[1].toLowerCase()
  return ext === 'jpeg' ? 'jpg' : ext
}

function toastAvatarPickError(err) {
  if (!err || err.code === 'CANCEL') return
  if (err.code === 'PRIVACY') {
    // 升级为可恢复引导：可直接查看《用户隐私保护指引》
    showPrivacyGuide({
      title: '需要先同意隐私保护指引',
      content: '更换头像需读取相册/摄像头。请查看并同意《用户隐私保护指引》后重试。'
    })
    return
  }
  wx.showToast({ title: '头像未更新，请重试', icon: 'none' })
}

module.exports = {
  pickAvatarImage,
  avatarExtFromPath,
  toastAvatarPickError
}
