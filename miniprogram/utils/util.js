const formatTime = date => {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hour = date.getHours()
  const minute = date.getMinutes()
  const second = date.getSeconds()

  return `${[year, month, day].map(formatNumber).join('/')} ${[hour, minute, second].map(formatNumber).join(':')}`
}

const formatNumber = n => {
  n = n.toString()
  return n[1] ? n : `0${n}`
}

/**
 * 安全获取图片数组的第一张图片
 * @param {Array} images - 图片数组
 * @param {string} fallback - 默认图片URL
 * @returns {string} 图片URL
 */
const getFirstImage = (images, fallback = '') => {
  return (images && Array.isArray(images) && images.length > 0) ? images[0] : fallback
}

/** 临时链内存缓存（约 50min，短于微信默认 2h） */
const _tempUrlMem = Object.create(null)
const TEMP_URL_TTL = 50 * 60 * 1000

/**
 * 批量 cloud:// → HTTPS，避免 N 次 getTempFileURL；命中内存则跳过网络
 */
const batchTempFileURLs = async (fileIds) => {
  const unique = [...new Set((fileIds || []).filter((id) => id && String(id).startsWith('cloud://')))]
  const urlMap = {}
  if (!unique.length || !wx.cloud) return urlMap

  const now = Date.now()
  const miss = []
  unique.forEach((id) => {
    const hit = _tempUrlMem[id]
    if (hit && hit.url && now - hit.at < TEMP_URL_TTL) {
      urlMap[id] = hit.url
    } else {
      miss.push(id)
    }
  })
  if (!miss.length) return urlMap

  try {
    for (let i = 0; i < miss.length; i += 50) {
      const chunk = miss.slice(i, i + 50)
      const res = await wx.cloud.getTempFileURL({ fileList: chunk })
      ;(res.fileList || []).forEach((f) => {
        if (f.fileID && f.tempFileURL) {
          urlMap[f.fileID] = f.tempFileURL
          _tempUrlMem[f.fileID] = { url: f.tempFileURL, at: now }
        }
      })
    }
  } catch (e) {
    console.warn('batchTempFileURLs', e)
  }
  return urlMap
}

/**
 * 格式化价格显示
 * @param {number|string} price - 价格
 * @param {number} decimals - 小数位数
 * @returns {string} 格式化后的价格字符串
 */
const formatPrice = (price, decimals = 2) => {
  const num = typeof price === 'number' ? price : parseFloat(price) || 0
  return num.toLocaleString('en-US', { 
    minimumFractionDigits: decimals, 
    maximumFractionDigits: decimals 
  })
}

/**
 * 安全获取对象属性
 * @param {Object} obj - 对象
 * @param {string} path - 属性路径，如 'a.b.c'
 * @param {*} defaultValue - 默认值
 * @returns {*} 属性值或默认值
 */
const getSafe = (obj, path, defaultValue = null) => {
  try {
    return path.split('.').reduce((current, key) => current && current[key], obj) || defaultValue
  } catch (e) {
    return defaultValue
  }
}

module.exports = {
  formatTime,
  getFirstImage,
  batchTempFileURLs,
  formatPrice,
  getSafe
}
