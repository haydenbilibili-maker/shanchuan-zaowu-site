/**
 * AI 鉴定：图片校验与压缩（目标 ≤ maxBytes，默认 2MB）
 * 仅允许 jpg / png / webp
 */

const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp']

function getExt(filePath) {
  const m = (filePath || '').toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}

function isAllowedImage(filePath) {
  const ext = getExt(filePath)
  return ALLOWED_EXT.includes(ext)
}

function getFileSize(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileInfo({
      filePath,
      success: (res) => resolve(res.size || 0),
      fail: reject
    })
  })
}

/**
 * 压缩到不超过 maxBytes；若基础库不支持 compressImage 则原样返回
 * @param {string} filePath 本地临时路径
 * @param {number} maxBytes 最大字节数
 * @returns {Promise<string>} 压缩后的本地路径
 */
async function compressToMaxSize(filePath, maxBytes = 2 * 1024 * 1024) {
  if (!filePath) throw new Error('缺少图片路径')
  if (!isAllowedImage(filePath)) {
    throw new Error('仅支持 JPG、PNG、WEBP 格式')
  }

  let size = await getFileSize(filePath)
  if (size <= maxBytes) return filePath

  if (typeof wx.compressImage !== 'function') {
    console.warn('当前基础库不支持 wx.compressImage，可能超过大小限制')
    return filePath
  }

  let quality = 85
  let currentPath = filePath

  while (quality >= 20) {
    const res = await new Promise((resolve, reject) => {
      wx.compressImage({
        src: currentPath,
        quality,
        success: resolve,
        fail: reject
      })
    })
    const outPath = res.tempFilePath || currentPath
    size = await getFileSize(outPath)
    if (size <= maxBytes) return outPath
    currentPath = outPath
    quality -= 15
  }

  throw new Error('图片过大，请选择较小图片或降低分辨率后重试')
}

module.exports = {
  isAllowedImage,
  compressToMaxSize,
  getExt
}
