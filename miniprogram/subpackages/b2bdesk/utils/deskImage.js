/**
 * 供应商管理中心 · 图片（分包旁路；只调用 utils/imageUrl，不改它）
 * 上传：wx.chooseMedia → 宽 > 1280 压缩 → wx.cloud.uploadFile → 只把 cloud:// fileID 交给页面，点保存才落库。
 * 显示：官网相对路径 → 官网绝对地址；cloud:// → https（价目图 / 门头图）。资质照不走这里，直接用 cloud:// 显示（按云存储权限读）。
 */
const { cloudIdToHttps, railUrl, detailUrl } = require('../../../utils/imageUrl')

const SITE_ORIGIN = 'https://shanhaizaowu.com'
const IMAGE_EDGE = 1280

function absUrl(raw) {
  const u = String(raw == null ? '' : raw).trim()
  if (!u) return ''
  if (/^https?:\/\//i.test(u)) return u
  if (u.indexOf('cloud://') === 0) return cloudIdToHttps(u)
  if (u.indexOf('//') === 0) return `https:${u}`
  return `${SITE_ORIGIN}/${u.replace(/^\/+/, '')}`
}

function thumbOf(raw) {
  const u = absUrl(raw)
  return u ? railUrl(u) || u : ''
}

function bigOf(raw) {
  const u = absUrl(raw)
  return u ? detailUrl(u) || u : ''
}

/** 压缩失败 / 基础库不支持都回落原图；compressedWidth 只在原图更宽时传（它会放大小图） */
function compress(src) {
  return new Promise((resolve) => {
    if (typeof wx.compressImage !== 'function') return resolve(src)
    const run = (width) => {
      const opts = { src, quality: 80, success: (r) => resolve((r && r.tempFilePath) || src), fail: () => resolve(src) }
      if (width > IMAGE_EDGE && wx.canIUse && wx.canIUse('compressImage.object.compressedWidth')) opts.compressedWidth = IMAGE_EDGE
      wx.compressImage(opts)
    }
    wx.getImageInfo({ src, success: (i) => run(Number(i && i.width) || 0), fail: () => run(0) })
  })
}

function chooseOne() {
  return new Promise((resolve) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => resolve(((res.tempFiles || [])[0] || {}).tempFilePath || ''),
      fail: () => resolve('')
    })
  })
}

/**
 * 选 1 张 → 压缩 → 上传到 <dir>/；用户取消返回 { ok:false, cancelled:true }
 * @returns {Promise<{ ok: boolean, fileID?: string, cancelled?: boolean, msg?: string }>}
 */
async function pickAndUpload(dir) {
  const path = await chooseOne()
  if (!path) return { ok: false, cancelled: true }
  try {
    const local = await compress(path)
    const ext = ((/\.(\w+)$/.exec(local) || [])[1] || 'jpg').toLowerCase()
    const up = await wx.cloud.uploadFile({
      cloudPath: `${dir}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`,
      filePath: local
    })
    if (!up || !up.fileID) return { ok: false, msg: '图片没传上去，请重试' }
    return { ok: true, fileID: up.fileID }
  } catch (e) {
    return { ok: false, msg: /timeout|超时/i.test(String((e && e.errMsg) || '')) ? '网络有点慢，图片没传上去，请重试' : '图片上传失败，请重试' }
  }
}

function preview(urls, current) {
  const list = (urls || []).filter(Boolean)
  if (!list.length) return
  wx.previewImage({ urls: list, current: current || list[0] })
}

module.exports = { absUrl, thumbOf, bigOf, pickAndUpload, preview }
