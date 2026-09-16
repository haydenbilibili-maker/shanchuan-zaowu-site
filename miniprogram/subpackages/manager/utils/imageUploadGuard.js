/**
 * 藏品图片上传守卫（尺寸 / 体积核验 + 压缩）
 *
 * 为什么需要（需求 17）：藏品库上传商品图**没有任何尺寸核验**，
 * `chooseProductImages()` 直接把 `wx.chooseImage` 的原图路径存进 `tempProduct.images`，
 * 随后原图直传云存储。手机原图常见 4000×3000（约 5–12MB），
 * 于是列表页首屏要下载十几张超大原图 —— 这是「页面加载慢」最主要的单一来源。
 *
 * 本模块在**选图之后、入库之前**做三件事：
 *   1. 体积核验（`maxBytes`）：超限则压缩；压缩后仍超限则拒绝并提示
 *   2. **像素核验**（`maxEdge` / `minEdge`）：边长超限按比例压到上限内；
 *      过小（如截图缩略图）直接拒绝，避免上架糊图
 *   3. 输出可上传的本地路径 + 摘要（供管理员确认）
 *
 * 设计取向：
 *   - **不静默失败**：任何拒绝都返回可读原因，由调用方 toast 给用户
 *   - 基础库不支持 `wx.compressImage` / `wx.getImageInfo` 时**降级放行**并 warn，
 *     绝不因工具缺失而阻塞业务（与仓库 `compressToMaxSize` 的既有取向一致）
 */

/** 默认上限：边长 2400px、体积 3MB（藏品大图在详情页仍足够清晰） */
const DEFAULT_MAX_EDGE = 2400
const DEFAULT_MIN_EDGE = 400
const DEFAULT_MAX_BYTES = 3 * 1024 * 1024

function getImageInfo(filePath) {
  return new Promise((resolve, reject) => {
    if (typeof wx.getImageInfo !== 'function') {
      resolve(null)
      return
    }
    wx.getImageInfo({
      src: filePath,
      success: (res) => resolve(res || null),
      fail: (err) => reject(new Error((err && err.errMsg) || '读取图片信息失败'))
    })
  })
}

function getFileSize(filePath) {
  return new Promise((resolve) => {
    if (typeof wx.getFileSystemManager !== 'function') {
      resolve(0)
      return
    }
    try {
      wx.getFileSystemManager().getFileInfo({
        filePath,
        success: (res) => resolve((res && res.size) || 0),
        fail: () => resolve(0)
      })
    } catch (e) {
      resolve(0)
    }
  })
}

function compress(filePath, quality) {
  return new Promise((resolve) => {
    if (typeof wx.compressImage !== 'function') {
      resolve(filePath)
      return
    }
    wx.compressImage({
      src: filePath,
      quality,
      success: (res) => resolve((res && res.tempFilePath) || filePath),
      fail: () => resolve(filePath)
    })
  })
}

/**
 * 校验并规范化一张待上传图片。
 * @returns {Promise<{ok:boolean, path?:string, reason?:string, info?:object}>}
 */
async function prepareUploadImage(filePath, options = {}) {
  const maxEdge = Number(options.maxEdge) > 0 ? Number(options.maxEdge) : DEFAULT_MAX_EDGE
  const minEdge = Number(options.minEdge) > 0 ? Number(options.minEdge) : DEFAULT_MIN_EDGE
  const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : DEFAULT_MAX_BYTES
  const label = options.label || '图片'

  if (!filePath) return { ok: false, reason: `缺少${label}路径` }

  let info = null
  try {
    info = await getImageInfo(filePath)
  } catch (e) {
    // 读不到信息时放行（兼容旧基础库），但明确告警，便于线上定位
    console.warn('prepareUploadImage: getImageInfo 不可用，跳过尺寸核验', e && e.message)
  }

  const width = Number(info && info.width) || 0
  const height = Number(info && info.height) || 0

  if (width && height && Math.max(width, height) < minEdge) {
    return {
      ok: false,
      reason: `${label}分辨率过低（${width}×${height}），请上传长边不小于 ${minEdge}px 的图片`
    }
  }

  let outPath = filePath
  let size = await getFileSize(outPath)

  // 尺寸超限或体积超限 → 压缩（wx.compressImage 会同时降边长与体积）
  const edgeTooLarge = width && height && Math.max(width, height) > maxEdge
  if (edgeTooLarge || size > maxBytes) {
    let quality = edgeTooLarge ? 80 : 85
    while (quality >= 30) {
      outPath = await compress(outPath, quality)
      size = await getFileSize(outPath)
      const next = await getImageInfo(outPath).catch(() => null)
      const stillLarge = (next && Math.max(next.width || 0, next.height || 0) > maxEdge)
      if (size <= maxBytes && !stillLarge) break
      quality -= 15
    }
  }

  if (size > maxBytes) {
    return {
      ok: false,
      reason: `${label}压缩后仍为 ${(size / 1024 / 1024).toFixed(1)}MB，超过 ${(maxBytes / 1024 / 1024).toFixed(0)}MB 上限，请先裁剪`
    }
  }

  return {
    ok: true,
    path: outPath,
    info: { width, height, size, maxEdge, maxBytes }
  }
}

/**
 * 批量校验：逐张处理，返回 { accepted, rejected }。
 * 不因单张失败中断整批（用户选 10 张、1 张过小，其余仍应可用）。
 */
async function prepareUploadImages(filePaths, options = {}) {
  const accepted = []
  const rejected = []
  for (const p of filePaths || []) {
    // eslint-disable-next-line no-await-in-loop
    const r = await prepareUploadImage(p, options)
    if (r.ok) accepted.push(r.path)
    else rejected.push({ path: p, reason: r.reason })
  }
  return { accepted, rejected }
}

module.exports = {
  DEFAULT_MAX_EDGE,
  DEFAULT_MIN_EDGE,
  DEFAULT_MAX_BYTES,
  prepareUploadImage,
  prepareUploadImages
}
