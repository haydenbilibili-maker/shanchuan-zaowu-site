/**
 * 藏品图片上传守卫（尺寸 / 体积核验 + 压缩）
 *
 * 为什么需要（需求 17）：藏品库上传商品图**没有任何尺寸核验**，
 * `chooseProductImages()` 直接把 `wx.chooseImage` 的原图路径存进 `tempProduct.images`，
 * 随后原图直传云存储。手机原图常见 4000×3000（约 5–12MB），
 * 于是列表页首屏要下载十几张超大原图 —— 这是「页面加载慢」最主要的单一来源。
 *
 * 本模块在**选图之后、入库之前**做三件事：
 *   1. 体积核验（`maxBytes`）：超限则压缩
 *   2. **像素核验**（`maxEdge` / `minEdge`）：边长超限按比例压到上限内；
 *      过小（如截图缩略图）直接拒绝，避免上架糊图
 *   3. 输出可上传的本地路径 + 摘要（供管理员确认）
 *
 * ── 2026-09-18 修复：上一版把"清晰度"整没了 ──
 *
 * 旧循环（已删）：
 *     const stillLarge = Math.max(next.width, next.height) > maxEdge   // ← 边长没变 → 恒 true
 *     while (quality >= 30) { outPath = await compress(outPath, quality); if (size <= maxBytes && !stillLarge) break; quality -= 15 }
 *   1. `wx.compressImage({ quality })` **只降质量、不改像素边长**（降边长要传 `compressedWidth`/`compressHeight`），
 *      所以 `stillLarge` 对任何"长边超限"的源图恒为真 → 字节达标也不 break → 必然走到 quality < 30，**实际落地 quality 35**；
 *   2. 每轮都对**上一轮的输出**再压一次 → 一张图 4 代累积 JPEG 损失（比单次 q35 更糊）；
 *   3. 结果是：所有手机原图都以 "4000px + quality 35 的糊图" 入库 —— 而这张图是详情主图/长图文/列表卡的**唯一来源**，
 *      URL 侧再怎么调都救不回来。
 *
 * 现口径（**清晰优先**）：
 *   · 先算等比目标边长（长边 ≤ `maxEdge`），用 `compressedWidth/compressHeight` 真正降边长；
 *   · **每次都从原图压**（`src` 恒为原始路径）→ 不累积代际损失；
 *   · 质量从 `TARGET_QUALITY(88)` 起，只降不升，但**有地板 `MIN_QUALITY(70)`** —— 宁可变大，也不把图压糊；
 *   · 地板仍超体积预算时**放行并标记 `overBudget`**（不再像旧版那样一路压到 35，也不阻塞管理员工作）；
 *   · 基础库不支持降边长时：只按质量压（清晰度不降），并标记 `edgeReduced: false` 供调用方提示。
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
/** 首选质量与**质量地板**：地板以下是"宁可超体积也不糊"的红线 */
const TARGET_QUALITY = 88
const MIN_QUALITY = 70
/** 质量下降步长 */
const QUALITY_STEP = 10
/** 地板 + 降边长后仍超预算：标记放行（不阻塞），仅提示 */
const HARD_REJECT_BYTES = 12 * 1024 * 1024

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

/** 基础库是否支持按边长压缩（`wx.compressImage` 的 compressedWidth/compressHeight） */
function canResizeEdge() {
  try {
    return typeof wx.canIUse === 'function' && wx.canIUse('compressImage.object.compressedWidth') === true
  } catch (e) {
    return false
  }
}

/**
 * 压缩一次。`size` 为等比目标尺寸（可为 null = 只降质量）。
 * ⚠️ `src` 必须由调用方传**原始路径**：从压缩产物再压会累积代际损失。
 */
function compress(filePath, quality, size) {
  return new Promise((resolve) => {
    if (typeof wx.compressImage !== 'function') {
      resolve(filePath)
      return
    }
    const payload = { src: filePath, quality }
    if (size && size.width > 0 && size.height > 0) {
      payload.compressedWidth = size.width
      payload.compressHeight = size.height
    }
    wx.compressImage({
      success: (res) => resolve((res && res.tempFilePath) || filePath),
      fail: () => resolve(filePath),
      ...payload
    })
  })
}

/** 等比目标边长：长边压到 maxEdge 内；不需要缩小时返回 null */
function fitEdge(width, height, maxEdge) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  if (!w || !h) return null
  const longest = Math.max(w, h)
  if (longest <= maxEdge) return null
  const scale = maxEdge / longest
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
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

  let size = await getFileSize(filePath)
  const edgeReduced = canResizeEdge()
  // 降边长在**只降质量**不可用时也要照样算出来（能否真的缩由 compress() 决定）
  const target = fitEdge(width, height, maxEdge)
  const needWork = !!target || size > maxBytes

  let outPath = filePath
  let quality = TARGET_QUALITY
  // 实际生效的质量（循环变量会多减一步，回传它会把 q78 说成 q68）
  let usedQuality = TARGET_QUALITY
  let compressedTimes = 0
  let outWidth = width
  let outHeight = height

  if (needWork) {
    while (quality >= MIN_QUALITY) {
      // ⚠️ 恒传 filePath（原图）：每一次尝试都从原图重来，绝不压"上一次的输出"
      // eslint-disable-next-line no-await-in-loop
      const out = await compress(filePath, quality, edgeReduced ? target : null)
      compressedTimes += 1
      usedQuality = quality
      if (out === filePath) break // 压缩未生效（工具不可用）：别再空转
      outPath = out
      // eslint-disable-next-line no-await-in-loop
      size = await getFileSize(outPath)
      // eslint-disable-next-line no-await-in-loop
      const next = await getImageInfo(outPath).catch(() => null)
      if (next && next.width && next.height) {
        outWidth = Number(next.width) || outWidth
        outHeight = Number(next.height) || outHeight
      }
      const withinEdge = Math.max(outWidth, outHeight) <= maxEdge || !edgeReduced
      if (size > 0 && size <= maxBytes && withinEdge) break
      quality -= QUALITY_STEP
    }
  }

  const finalEdge = Math.max(outWidth || 0, outHeight || 0)
  const overBudget = size > maxBytes

  // 极端体积（地板 + 降边长后仍 > 12MB）才拒绝：宁可变大，也不把图压糊、不静默丢用户的工作
  if (overBudget && size > HARD_REJECT_BYTES) {
    return {
      ok: false,
      reason: `${label}压缩后仍为 ${(size / 1024 / 1024).toFixed(1)}MB，超过 ${(HARD_REJECT_BYTES / 1024 / 1024).toFixed(0)}MB 硬上限，请先裁剪`
    }
  }

  return {
    ok: true,
    path: outPath,
    // 调用方据此提示"清晰度已保住但体积偏大"；旧版这里只有一个 size
    info: {
      width,
      height,
      size,
      outWidth,
      outHeight,
      quality: usedQuality,
      compressedTimes,
      edgeReduced: edgeReduced && !!target && finalEdge <= maxEdge,
      overBudget,
      maxEdge,
      maxBytes
    }
  }
}

/**
 * 批量校验：逐张处理，返回 { accepted, rejected }。
 * 不因单张失败中断整批（用户选 10 张、1 张过小，其余仍应可用）。
 */
async function prepareUploadImages(filePaths, options = {}) {
  const accepted = []
  const rejected = []
  const infos = []
  for (const p of filePaths || []) {
    // eslint-disable-next-line no-await-in-loop
    const r = await prepareUploadImage(p, options)
    if (r.ok) {
      accepted.push(r.path)
      infos.push(r.info)
    } else {
      rejected.push({ path: p, reason: r.reason })
    }
  }
  return { accepted, rejected, infos }
}

module.exports = {
  DEFAULT_MAX_EDGE,
  DEFAULT_MIN_EDGE,
  DEFAULT_MAX_BYTES,
  TARGET_QUALITY,
  MIN_QUALITY,
  QUALITY_STEP,
  HARD_REJECT_BYTES,
  fitEdge,
  canResizeEdge,
  prepareUploadImage,
  prepareUploadImages
}
