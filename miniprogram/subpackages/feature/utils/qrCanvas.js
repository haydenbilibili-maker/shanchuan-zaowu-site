/**
 * 轻量 QR 绘制（canvas 2d）
 * 基于 qrcode-generator 思路的简化实现
 */
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
  if (!canvas || !text) return Promise.resolve(false)
  const dpr = wx.getWindowInfo().pixelRatio || 2
  canvas.width = size * dpr
  canvas.height = size * dpr
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)
  const modules = createMatrix(text)
  if (!modules) return Promise.resolve(false)
  const bg = (options && options.bg) || '#FAF6ED'
  const fg = (options && options.fg) || '#1A1814'
  const margin = (options && options.margin) != null ? options.margin : 8
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
  return Promise.resolve(true)
}

function drawMemberQr(selector, text, component, size, options) {
  return new Promise((resolve) => {
    wx.createSelectorQuery()
      .in(component)
      .select(selector)
      .fields({ node: true, size: true })
      .exec(async (res) => {
        const canvas = res && res[0] && res[0].node
        if (!canvas) {
          resolve(false)
          return
        }
        const ok = await drawOnCanvas(canvas, text, size || 200, options)
        resolve(ok)
      })
  })
}

module.exports = { drawMemberQr, drawOnCanvas }
