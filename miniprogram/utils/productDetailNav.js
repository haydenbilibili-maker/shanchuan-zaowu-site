/**
 * 商品详情导航：列表预填缓存后跳转，减少二次请求感。
 */

const { seedProductPreview } = require('./productDetailCache')

/**
 * @param {string} id
 * @param {{
 *   seed?: object,
 *   query?: Record<string, string|number|boolean>,
 *   missingToast?: string,
 *   failToast?: string
 * }} [options]
 */
function navigateToProductDetail(id, options) {
  const opts = options || {}
  const pid = String(id || '').trim()
  if (!pid) {
    wx.showToast({ title: opts.missingToast || '藏品不存在', icon: 'none' })
    return false
  }
  if (opts.seed) {
    try {
      seedProductPreview(opts.seed._id || opts.seed.id ? opts.seed : { ...opts.seed, _id: pid })
    } catch (e) { /* ignore */ }
  }

  let qs = `id=${encodeURIComponent(pid)}`
  const query = opts.query || {}
  Object.keys(query).forEach((k) => {
    const v = query[k]
    if (v == null || v === '') return
    qs += `&${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`
  })

  wx.navigateTo({
    url: `/subpackages/feature/detail/index?${qs}`,
    fail: (err) => {
      console.error('打开商品详情失败', err)
      wx.showToast({ title: opts.failToast || '无法打开藏品', icon: 'none' })
    }
  })
  return true
}

module.exports = {
  navigateToProductDetail
}
