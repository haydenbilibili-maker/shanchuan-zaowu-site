/**
 * 轻量 QR 绘制（canvas 2d）
 * 基于 qrcode-generator 思路的简化实现
 *
 * ⚠️ 2026-09-18 真机事故（礼券夹「到店亮码」二维码空白、无任何提示）后的加固：
 *   ① 旧实现是 `new Promise(async (resolve) => …)`：异步 executor 里任何抛错
 *      （getWindowInfo 缺失 / getContext 返回 null / 节点已被销毁）都会被**吞掉**，
 *      Promise 永不 settle → 调用方的「重试 + 失败提示」永远不触发 → 只剩一个空白框；
 *   ② 旧实现只看「矩阵算出来了、循环跑完了」就返回 true：如果画到了**已分离的 canvas 节点**上，
 *      像素其实是全透明的，调用方却当成功 → 同样只有空白。
 *   现在三条硬保证：**任何失败都必须 settle(false)**、**有兜底超时**、**画完回读像素确认真的落墨**。
 */
const DRAW_TIMEOUT_MS = 2000

/** 屏幕像素比：新老基础库都要能拿到，拿不到就用 2（绝不抛错） */
function getPixelRatio() {
  try {
    if (typeof wx.getWindowInfo === 'function') {
      const info = wx.getWindowInfo()
      if (info && info.pixelRatio) return info.pixelRatio
    }
  } catch (e) { /* 落到系统信息兜底 */ }
  try {
    if (typeof wx.getSystemInfoSync === 'function') {
      const info = wx.getSystemInfoSync()
      if (info && info.pixelRatio) return info.pixelRatio
    }
  } catch (e) { /* 用默认值 */ }
  return 2
}

/**
 * 回读像素：确认画布上真的落了深色墨点。
 * 画到已分离/未布局的节点上时整块是全透明（alpha=0），此时必须判失败，否则界面就是空白。
 * 老基础库没有 getImageData 时返回 true —— 读不到就不误判，避免把能用的画布判死。
 */
function hasInk(ctx, size, dpr, margin) {
  if (!ctx || typeof ctx.getImageData !== 'function') return true
  try {
    const max = Math.round(size * dpr) - 8
    const at = (v) => Math.max(0, Math.min(max, Math.round(v * dpr)))
    // QR 左上角定位符从 (margin, margin) 起就是深色 7×7，取 8×8 足够
    const box = ctx.getImageData(at(margin + 1), at(margin + 1), 8, 8).data
    for (let i = 0; i < box.length; i += 4) {
      if (box[i + 3] > 0 && box[i] < 128) return true
    }
    return false
  } catch (e) {
    return true
  }
}

function drawModules(ctx, modules, size, margin) {
  const count = modules.length
  const cell = (size - margin * 2) / count
  ctx.setFillStyle('#FAF6ED')
  ctx.fillRect(0, 0, size, size)
  ctx.setFillStyle('#1A1814')
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (modules[row][col]) {
        ctx.fillRect(margin + col * cell, margin + row * cell, cell + 0.5, cell + 0.5)
      }
    }
  }
}

function createMatrix(text) {
  // 使用微信内置能力：若不可用则返回 null，由调用方降级
  try {
    const QR = require('./qrcodeGen')
    const qr = QR(0, 'M')
    qr.addData(text)
    qr.make()
    const n = qr.getModuleCount()
    const modules = []
    for (let r = 0; r < n; r++) {
      const row = []
      for (let c = 0; c < n; c++) row.push(qr.isDark(r, c))
      modules.push(row)
    }
    return modules
  } catch (e) {
    return null
  }
}

function drawOnCanvas(canvas, text, size, options) {
  if (!canvas || !text || !(size > 0)) return Promise.resolve(false)
  const modules = createMatrix(text)
  if (!modules) return Promise.resolve(false)
  const margin = (options && options.margin) != null ? options.margin : 8
  try {
    const dpr = getPixelRatio()
    canvas.width = size * dpr
    canvas.height = size * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return Promise.resolve(false)
    ctx.scale(dpr, dpr)
    const bg = (options && options.bg) || '#FAF6ED'
    const fg = (options && options.fg) || '#1A1814'
    const count = modules.length
    const cell = (size - margin * 2) / count
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = fg
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (modules[row][col]) {
          ctx.fillRect(margin + col * cell, margin + row * cell, cell + 0.5, cell + 0.5)
        }
      }
    }
    return Promise.resolve(hasInk(ctx, size, dpr, margin))
  } catch (e) {
    console.warn('[qrCanvas] 绘制异常：', (e && e.message) || e)
    return Promise.resolve(false)
  }
}

function drawMemberQr(selector, text, component, size, options) {
  return new Promise((resolve) => {
    let settled = false
    let timer = null
    const finish = (value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(value)
    }
    // 兜底超时：查询回调不回来（或内部抛错）也必须 settle，绝不让调用方永远等成空白框
    timer = setTimeout(() => finish(false), DRAW_TIMEOUT_MS)
    const run = (canvas) => {
      Promise.resolve()
        .then(() => drawOnCanvas(canvas, text, size || 200, options))
        .then((ok) => finish(!!ok))
        .catch((e) => {
          console.warn('[qrCanvas] 绘制失败：', selector, (e && e.message) || e)
          finish(false)
        })
    }
    try {
      wx.createSelectorQuery()
        .in(component)
        .select(selector)
        .fields({ node: true, size: true })
        .exec((res) => {
          const canvas = res && res[0] && res[0].node
          if (!canvas) {
            finish(false)
            return
          }
          run(canvas)
        })
    } catch (e) {
      console.warn('[qrCanvas] 查询画布失败：', selector, (e && e.message) || e)
      finish(false)
    }
  })
}

module.exports = { drawMemberQr, drawOnCanvas, getPixelRatio }
