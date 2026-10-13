/**
 * VIS 3.0 品牌标志「方寸篆印」（方案 B）的 Canvas 2D 绘制 —— 画布海报 / 礼笺 / 凭证共用一份几何。
 *
 * 几何与 docs/品牌专项/vis3/seal-*.svg、assets/brand/seal-*.png 同源（200 × 200 单位网格）。
 * 分包边界：feature / business / manager 各一份逐字副本（subpackage-mirrors.json 钉住），改动三处同步。
 * 只用基础路径 API（无 roundRect / 曲线），旧基础库与守卫里的桩 ctx 都能跑。
 *
 * filled = true ：实心印面 + 以 ground 色「刻」出山海二字（钤印效果，用于礼赠）。
 * filled = false：朱文描边版，字与边框同色、无底（小尺寸 / 叠在图上用）。
 */

const RECTS = [[30, 80, 10, 50], [54, 48, 10, 82], [78, 80, 10, 50], [26, 124, 66, 10]]
const DOTS = [[115, 60, 6], [113, 90, 6], [153, 87, 4], [153, 121, 4]]
const LINES = [[107, 140, 121, 112, 9], [131, 52, 172, 52, 8], [131, 44, 138, 58, 7], [128, 104, 178, 104, 8]]
const BOX = [138, 70, 30, 68, 8]

function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx 印面中心 x
 * @param {number} cy 印面中心 y
 * @param {number} size 印面边长（px）
 * @param {{ color?: string, ground?: string, filled?: boolean, rotate?: number }} [opts]
 */
function drawBrandSeal(ctx, cx, cy, size, opts) {
  const o = opts || {}
  const color = o.color || '#C4A76C'
  const ground = o.ground || '#1A1814'
  const filled = o.filled !== false
  const ink = filled ? ground : color

  ctx.save()
  ctx.translate(cx, cy)
  if (o.rotate) ctx.rotate(o.rotate * Math.PI / 180)
  ctx.scale(size / 180, size / 180)
  ctx.translate(-100, -100)

  roundedRectPath(ctx, 10, 10, 180, 180, 8)
  if (filled) {
    ctx.fillStyle = color
    ctx.fill()
  } else {
    ctx.strokeStyle = color
    ctx.lineWidth = 8
    ctx.stroke()
  }
  ctx.strokeStyle = ink
  ctx.lineWidth = 1.2
  ctx.strokeRect(18, 18, 164, 164)

  ctx.fillStyle = ink
  RECTS.forEach((r) => ctx.fillRect(r[0], r[1], r[2], r[3]))
  DOTS.forEach((d) => {
    ctx.beginPath()
    ctx.arc(d[0], d[1], d[2], 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.strokeStyle = ink
  ctx.lineCap = 'round'
  LINES.forEach((l) => {
    ctx.lineWidth = l[4]
    ctx.beginPath()
    ctx.moveTo(l[0], l[1])
    ctx.lineTo(l[2], l[3])
    ctx.stroke()
  })
  ctx.lineCap = 'butt'
  ctx.lineWidth = BOX[4]
  ctx.strokeRect(BOX[0], BOX[1], BOX[2], BOX[3])
  ctx.restore()
}

module.exports = { drawBrandSeal }
