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
  formatPrice,
  getSafe
}
