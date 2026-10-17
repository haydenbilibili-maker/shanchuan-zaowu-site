/**
 * 证书绘制（纯函数，不依赖 wx —— check:gift-holder 在 Node 里录制指令 / 离线出图）
 *
 * 2026-10-17 按新视觉规范重绘（产品负责人点名）：三种证书统一成**纸质标本签**一种纸 ——
 * 浅纸渐变 #F3ECDD → #E8DFCB + 墨色 #2E2618 + 内发丝框 + 顶上一枚铜别针；
 * 眉标（等宽英文）+ 主标（宋体）+ 藏品实拍（标本框）+ 发丝线两栏行 + 方寸篆印（全张唯一一处实色）。
 * 与礼笺、心愿签、藏家档案是同一种纸；旧版的深底金框 / 朱砂双框 / 英文花体已退场。
 *
 * drawHolderCert      非礼赠收藏证书：持有人 / 藏家等级 / 签发日；铜印
 * drawGiftHolderCert  受礼人收藏证书：持有人 + 「由 X 赠予」+ 赠言，日期为签收日；铜印
 * drawGiftVoucher     送礼人赠予凭证：赠予人 / 受赠人 / 状态 / 日期 + 赠言；朱印（礼赠钤印，VIS 3.0）
 *
 * 版式按 300 × 480 设计稿排，真机画布（600rpx × 960rpx）等比缩放、水平垂直居中，任何宽高比都不挤压。
 */

const { drawBrandSeal } = require('../utils/brandSeal')

const DESIGN_W = 300
const DESIGN_H = 480
const PAPER_TOP = '#F3ECDD'
const PAPER_BOTTOM = '#E8DFCB'
const INK = '#2E2618'
const INK_SOFT = '#5E5444'
const INK_MUTE = '#8A7F6C'
const BRASS = '#8B6F47'
const BRASS_PIN = '#B08D57'
const HAIR = 'rgba(46, 38, 24, 0.22)'
const CINNABAR = '#9E3B2E'

async function loadImage(canvas, getImagePath, src) {
  const url = await getImagePath(src)
  if (!url) return null
  const img = canvas.createImage()
  img.src = url
  await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve })
  return img.width && img.height ? img : null
}

function textWidth(ctx, text, size) {
  const m = ctx.measureText(text)
  return (m && m.width) || String(text).length * size
}

/** 超宽时逐级缩小字号（不低于 minSize），返回实际字号 */
function fitFont(ctx, text, maxWidth, size, minSize, style) {
  let s = size
  ctx.font = `${style} ${s}px serif`
  while (s > minSize && textWidth(ctx, text, s) > maxWidth) {
    s -= 1
    ctx.font = `${style} ${s}px serif`
  }
  return s
}

function clip(text, max) {
  const t = String(text || '')
  return t.length > max ? `${t.slice(0, max)}…` : t
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
}

/** 纸：渐变底（桩 ctx 无渐变对象时落回中间色）+ 内发丝框 + 顶边铜别针 */
function drawPaper(ctx, w, h) {
  const grad = typeof ctx.createLinearGradient === 'function' ? ctx.createLinearGradient(0, 0, 0, h) : null
  if (grad && typeof grad.addColorStop === 'function') {
    grad.addColorStop(0, PAPER_TOP)
    grad.addColorStop(1, PAPER_BOTTOM)
    ctx.fillStyle = grad
  } else {
    ctx.fillStyle = '#EEE6D4'
  }
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = HAIR; ctx.lineWidth = 0.75
  ctx.strokeRect(14, 14, w - 28, h - 28)
  // 铜别针：钉在内框顶边正中（一圈深铜 + 一点高光，不发光）
  ctx.fillStyle = BRASS_PIN
  ctx.beginPath(); ctx.arc(w / 2, 14, 4.5, 0, 2 * Math.PI); ctx.fill()
  ctx.fillStyle = 'rgba(255, 248, 230, 0.7)'
  ctx.beginPath(); ctx.arc(w / 2 - 1.2, 12.8, 1.3, 0, 2 * Math.PI); ctx.fill()
}

/** 眉标 + 主标 + 一道发丝线 */
function drawHead(ctx, w, eyebrow, title) {
  const cx = w / 2
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = BRASS; ctx.font = '8px monospace'; ctx.letterSpacing = '3px'
  ctx.fillText(eyebrow, cx, 44)
  ctx.fillStyle = INK; ctx.font = 'bold 16px serif'; ctx.letterSpacing = '3px'
  ctx.fillText(title, cx, 68)
  ctx.letterSpacing = '0px'
  ctx.strokeStyle = HAIR; ctx.lineWidth = 0.75
  line(ctx, 36, 82, w - 36, 82)
}

/** 藏品实拍：标本框（外发丝 + 4px 纸边） */
async function drawSpecimen(ctx, w, top, size, product, canvas, getImagePath) {
  const x = (w - size) / 2
  ctx.strokeStyle = HAIR; ctx.lineWidth = 0.75
  ctx.strokeRect(x - 5, top - 5, size + 10, size + 10)
  const img = await loadImage(canvas, getImagePath, product.image)
  if (img) {
    const s = Math.min(img.width, img.height)
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, x, top, size, size)
  } else {
    ctx.fillStyle = 'rgba(46, 38, 24, 0.06)'
    ctx.fillRect(x, top, size, size)
  }
  const cx = w / 2
  let y = top + size + 28
  ctx.textAlign = 'center'
  ctx.fillStyle = INK
  const title = `《 ${product.title} 》`
  fitFont(ctx, title, w - 72, 16, 11, 'bold')
  ctx.fillText(title, cx, y)
  if (product.latin) {
    y += 14
    ctx.fillStyle = BRASS; ctx.font = 'italic 9px serif'
    ctx.fillText(product.latin, cx, y)
  }
  return y
}

/** 发丝线两栏行：左 = 签名（灰），右 = 值（墨） */
function drawRows(ctx, w, top, rows) {
  const left = 40
  const right = w - 40
  let y = top
  ctx.strokeStyle = HAIR; ctx.lineWidth = 0.75
  line(ctx, left, y, right, y)
  rows.forEach(([k, v]) => {
    y += 22
    ctx.textAlign = 'left'; ctx.fillStyle = INK_MUTE; ctx.font = '9px sans-serif'; ctx.letterSpacing = '1px'
    ctx.fillText(k, left, y - 7)
    ctx.letterSpacing = '0px'
    ctx.textAlign = 'right'; ctx.fillStyle = INK
    fitFont(ctx, String(v), right - left - 70, 11, 8, '')
    ctx.fillText(String(v), right, y - 7)
    line(ctx, left, y, right, y)
  })
  ctx.textAlign = 'center'
  return y
}

/** 赠言：至多两行，斜体 */
function drawNote(ctx, w, top, note) {
  const text = String(note || '')
  if (!text) return top
  const cx = w / 2
  let y = top + 20
  ctx.textAlign = 'center'; ctx.fillStyle = INK_SOFT; ctx.font = 'italic 10px serif'
  ctx.fillText(`“${text.slice(0, 17)}${text.length > 17 ? '' : '”'}`, cx, y)
  if (text.length > 17) {
    y += 15
    ctx.fillText(`${clip(text.slice(17), 15)}”`, cx, y)
  }
  return y
}

/** 页脚：编号（左）+ 签发方（中）+ 方寸篆印（右下，全张唯一实色） */
function drawFoot(ctx, w, h, serial, signLabel, sealColor) {
  const y = h - 30
  ctx.letterSpacing = '0px'
  ctx.textAlign = 'left'; ctx.fillStyle = INK_MUTE; ctx.font = '7.5px monospace'
  ctx.fillText(`NO.${serial}`, 30, y)
  ctx.strokeStyle = HAIR; ctx.lineWidth = 0.75
  line(ctx, w / 2 - 44, y - 22, w / 2 + 44, y - 22)
  ctx.textAlign = 'center'; ctx.fillStyle = INK_MUTE; ctx.font = '8px sans-serif'; ctx.letterSpacing = '2px'
  ctx.fillText(signLabel, w / 2, y - 10)
  ctx.letterSpacing = '0px'
  drawBrandSeal(ctx, w - 52, h - 62, 34, { color: sealColor, ground: PAPER_BOTTOM, rotate: -6 })
}

/** 按设计稿 300 × 480 等比缩放并居中（任何画布宽高比都不挤压） */
async function onDesign(ctx, w, h, body) {
  const k = Math.min(w / DESIGN_W, h / DESIGN_H)
  ctx.save()
  // 纸铺满整张画布；版式在居中的设计框里
  drawPaper(ctx, w, h)
  ctx.translate((w - DESIGN_W * k) / 2, (h - DESIGN_H * k) / 2)
  ctx.scale(k, k)
  await body(DESIGN_W, DESIGN_H)
  ctx.restore()
}

/** 非礼赠收藏证书 */
async function drawHolderCert(ctx, w, h, data, canvas, getImagePath) {
  await onDesign(ctx, w, h, async (W, H) => {
    drawHead(ctx, W, 'CERTIFICATE OF COLLECTION', '山海造物 · 珍藏证书')
    const y = await drawSpecimen(ctx, W, 98, 122, data.product, canvas, getImagePath)
    ctx.fillStyle = INK_SOFT; ctx.font = '9px serif'; ctx.letterSpacing = '1px'
    ctx.fillText('兹证明下列持有人永久珍藏本件自然藏品', W / 2, y + 22)
    ctx.letterSpacing = '0px'
    drawRows(ctx, W, y + 34, [['持有人', data.user], ['藏家等级', data.level], ['签发日', data.date]])
    drawFoot(ctx, W, H, data.orderNo, '山海造物 · 签发', BRASS_PIN)
  })
}

/** 受礼人（持有人）收藏证书 */
async function drawGiftHolderCert(ctx, w, h, data, canvas, getImagePath) {
  const gift = data.gift || {}
  await onDesign(ctx, w, h, async (W, H) => {
    drawHead(ctx, W, 'CERTIFICATE OF COLLECTION', '山海造物 · 珍藏证书')
    const y = await drawSpecimen(ctx, W, 98, 112, data.product, canvas, getImagePath)
    ctx.fillStyle = BRASS; ctx.font = '10px serif'; ctx.letterSpacing = '1px'
    ctx.fillText(`由「${clip(gift.fromName || '一位友人', 10)}」赠予`, W / 2, y + 22)
    ctx.letterSpacing = '0px'
    const rowsEnd = drawRows(ctx, W, y + 34, [['持有人', data.user], ['签收日', data.date]])
    drawNote(ctx, W, rowsEnd, gift.note)
    drawFoot(ctx, W, H, data.serial, '山海造物 · 签发', BRASS_PIN)
  })
}

/** 送礼人赠予凭证 */
async function drawGiftVoucher(ctx, w, h, data, canvas, getImagePath) {
  const gift = data.gift || {}
  await onDesign(ctx, w, h, async (W, H) => {
    drawHead(ctx, W, 'CERTIFICATE OF GIFT', '山海造物 · 赠予凭证')
    const y = await drawSpecimen(ctx, W, 98, 104, data.product, canvas, getImagePath)
    const rowsEnd = drawRows(ctx, W, y + 16, [
      ['赠予人', data.user],
      ['受赠人', clip(gift.recipientName || 'TA', 12)],
      ['状态', gift.statusLabel || 'TA 已收到'],
      ['日期', data.date]
    ])
    drawNote(ctx, W, rowsEnd, gift.note)
    drawFoot(ctx, W, H, data.serial, '山海造物 · 见证', CINNABAR)
  })
}

async function drawCertificate(ctx, w, h, view, canvas, getImagePath) {
  if (view.kind === 'gift_voucher') return drawGiftVoucher(ctx, w, h, view, canvas, getImagePath)
  if (view.kind === 'gift_holder') return drawGiftHolderCert(ctx, w, h, view, canvas, getImagePath)
  return drawHolderCert(ctx, w, h, view, canvas, getImagePath)
}

module.exports = {
  drawCertificate,
  drawHolderCert,
  drawGiftHolderCert,
  drawGiftVoucher
}
