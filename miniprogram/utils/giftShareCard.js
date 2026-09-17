/**
 * 礼赠分享封面：canvas 绘标本纸礼笺卡（微信 imageUrl / 朋友圈）
 * 可叠入标本缩略图；云图下载失败则降级纯笺。
 * 整卡绘制失败返回 ''，调用方降级为无图分享。
 * 推荐比例约 5:4。
 */

const W = 500
const H = 400

function truncate(str, max) {
  const s = String(str || '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const chars = String(text || '').split('')
  const lines = []
  let line = ''
  let overflow = false
  for (let i = 0; i < chars.length; i++) {
    const test = line + chars[i]
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = chars[i]
      if (lines.length >= maxLines) {
        overflow = i < chars.length - 1
        line = ''
        break
      }
    } else {
      line = test
    }
  }
  if (lines.length < maxLines && line) lines.push(line)
  if (overflow && lines.length) {
    const last = lines[lines.length - 1]
    lines[lines.length - 1] = truncate(last, Math.max(2, last.length))
  }
  return lines
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function loadCanvasImage(canvas, src) {
  return new Promise((resolve) => {
    if (!src || !canvas) {
      resolve(null)
      return
    }
    try {
      const img = canvas.createImage()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = src
    } catch (e) {
      resolve(null)
    }
  })
}

/**
 * 将 cloud:// 或 https 图落到本地临时路径；失败返回 ''
 */
function resolveLocalImage(fileOrUrl) {
  const src = String(fileOrUrl || '').trim()
  if (!src) return Promise.resolve('')

  const download = (url) =>
    new Promise((resolve) => {
      wx.downloadFile({
        url,
        success: (r) => {
          if (r.statusCode === 200 && r.tempFilePath) resolve(r.tempFilePath)
          else resolve('')
        },
        fail: () => resolve('')
      })
    })

  if (src.indexOf('cloud://') === 0) {
    return wx.cloud
      .getTempFileURL({ fileList: [src] })
      .then((res) => {
        const item = (res && res.fileList && res.fileList[0]) || {}
        const url = item.tempFileURL || ''
        if (!url) return ''
        return download(url)
      })
      .catch(() => '')
  }

  if (/^https?:\/\//i.test(src)) return download(src)
  // 已是本地临时路径
  if (src.indexOf('wxfile://') === 0 || src.indexOf('/') === 0) return Promise.resolve(src)
  return Promise.resolve('')
}

/**
 * @param {WechatMiniprogram.Canvas} canvas
 * @param {{ cardBody?: string, cardSignature?: string, hasVoice?: boolean, specimenImage?: CanvasImageSource|null }} opts
 */
function paintGiftShareCard(canvas, opts) {
  const dpr = Math.min(3, (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2)
  canvas.width = W * dpr
  canvas.height = H * dpr
  const ctx = canvas.getContext('2d')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.scale(dpr, dpr)

  ctx.fillStyle = '#1A1814'
  ctx.fillRect(0, 0, W, H)

  const pad = 28
  const cardX = pad
  const cardY = pad
  const cardW = W - pad * 2
  const cardH = H - pad * 2
  ctx.fillStyle = '#F2EDE4'
  ctx.strokeStyle = '#E0CFA3'
  ctx.lineWidth = 2
  roundRect(ctx, cardX, cardY, cardW, cardH, 12)
  ctx.fill()
  ctx.stroke()

  ctx.strokeStyle = 'rgba(196, 167, 108, 0.35)'
  ctx.beginPath()
  ctx.moveTo(cardX + 20, cardY + 36)
  ctx.lineTo(cardX + cardW - 20, cardY + 36)
  ctx.stroke()

  ctx.fillStyle = '#8A7530'
  ctx.font = '500 13px sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('SEALED LETTER', cardX + 22, cardY + 26)

  const hasImg = !!(opts && opts.specimenImage)
  const thumb = 96
  const textRight = hasImg ? cardX + cardW - 22 - thumb - 16 : cardX + cardW - 22
  const textWidth = textRight - (cardX + 22)

  ctx.fillStyle = '#8A7530'
  ctx.font = '600 22px serif'
  ctx.fillText('山海造物 · 礼笺', cardX + 22, cardY + 68)

  if (hasImg) {
    const ix = cardX + cardW - 22 - thumb
    const iy = cardY + 52
    ctx.save()
    roundRect(ctx, ix, iy, thumb, thumb, 8)
    ctx.clip()
    try {
      ctx.drawImage(opts.specimenImage, ix, iy, thumb, thumb)
    } catch (e) {
      /* ignore draw */
    }
    ctx.restore()
    ctx.strokeStyle = '#E0CFA3'
    ctx.lineWidth = 1.5
    roundRect(ctx, ix, iy, thumb, thumb, 8)
    ctx.stroke()
  }

  const body = truncate(opts.cardBody, hasImg ? 56 : 72) || '柜中有一封写给你的信'
  ctx.fillStyle = '#33302C'
  ctx.font = '400 16px serif'
  const lines = wrapLines(ctx, body, textWidth, hasImg ? 3 : 4)
  let ty = cardY + 100
  lines.forEach((ln) => {
    ctx.fillText(ln, cardX + 22, ty)
    ty += 26
  })

  if (opts.hasVoice) {
    ctx.fillStyle = '#A8903C'
    ctx.font = '400 13px sans-serif'
    ctx.fillText('含一段声音', cardX + 22, ty + 12)
  }

  const sig = truncate(opts.cardSignature, 16)
  if (sig) {
    ctx.fillStyle = '#8A7530'
    ctx.font = '400 14px serif'
    const sigText = `— ${sig}`
    const sw = ctx.measureText(sigText).width
    ctx.fillText(sigText, cardX + cardW - 22 - sw, cardY + cardH - 28)
  }

  // 蜡封：有图时靠左下，避免压图
  const cx = hasImg ? cardX + 42 : cardX + cardW - 42
  const cy = hasImg ? cardY + cardH - 42 : cardY + 42
  ctx.beginPath()
  ctx.arc(cx, cy, 22, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(196, 167, 108, 0.18)'
  ctx.fill()
  ctx.strokeStyle = '#C4A76C'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = '#8A7530'
  ctx.font = '500 12px serif'
  ctx.textAlign = 'center'
  ctx.fillText('山海', cx, cy + 4)
  ctx.textAlign = 'left'
}

/**
 * @param {string} selector
 * @param {WechatMiniprogram.Page.Instance} page
 * @param {{ cardBody?: string, cardSignature?: string, hasVoice?: boolean, specimenFileID?: string, specimenUrl?: string }} opts
 */
function renderGiftShareImage(selector, page, opts) {
  const options = opts || {}
  return new Promise((resolve) => {
    try {
      wx.createSelectorQuery()
        .in(page)
        .select(selector)
        .fields({ node: true, size: true })
        .exec(async (res) => {
          const canvas = res && res[0] && res[0].node
          if (!canvas) {
            resolve('')
            return
          }

          let specimenImage = null
          const remote = options.specimenFileID || options.specimenUrl || ''
          if (remote) {
            try {
              const local = await resolveLocalImage(remote)
              if (local) specimenImage = await loadCanvasImage(canvas, local)
            } catch (e) {
              specimenImage = null
            }
          }

          try {
            paintGiftShareCard(canvas, {
              cardBody: options.cardBody,
              cardSignature: options.cardSignature,
              hasVoice: options.hasVoice,
              specimenImage
            })
          } catch (e) {
            console.warn('giftShareCard paint', e)
            // 再试一次纯笺
            try {
              paintGiftShareCard(canvas, {
                cardBody: options.cardBody,
                cardSignature: options.cardSignature,
                hasVoice: options.hasVoice,
                specimenImage: null
              })
            } catch (e2) {
              resolve('')
              return
            }
          }

          setTimeout(() => {
            wx.canvasToTempFilePath({
              canvas,
              fileType: 'png',
              quality: 0.92,
              success: (r) => resolve((r && r.tempFilePath) || ''),
              fail: (err) => {
                console.warn('giftShareCard toTemp', err)
                resolve('')
              }
            })
          }, 64)
        })
    } catch (e) {
      console.warn('giftShareCard query', e)
      resolve('')
    }
  })
}


/* ─────────────────────────────────────────────────────────────────────────
 * 印刷版礼笺卡（**纯新增**，分享卡一行未动）
 *
 * 规格：A6 竖版 @300dpi = 1240 × 1795 px（1mm ≈ 11.81px；四周 10mm 页边距）
 * 版式：标题 → **题记带（主题名 + 题记，铜金左线）** → 正文 → 署名 → 「山海」印
 * 为什么另起一套：分享卡（500×400）标题在 cardY+68、正文从 cardY+100 起，中间塞不下题记；
 *   而分享卡正被订单详情 / 礼赠成功页真实使用 → 不动它，印刷版单独实现。
 * 用法：canvas 尺寸即输出像素（无需 destWidth）→ canvasToTempFilePath → 存相册 / 传云存储
 * ───────────────────────────────────────────────────────────────────────── */
const PRINT_W = 1240
const PRINT_H = 1795

function paintGiftPrintCard(canvas, opts) {
  const o = opts || {}
  const MM = 11.811
  const margin = Math.round(10 * MM)
  const pad = Math.round(10 * MM)
  canvas.width = PRINT_W
  canvas.height = PRINT_H
  const ctx = canvas.getContext('2d')
  ctx.setTransform(1, 0, 0, 1, 0, 0)

  ctx.fillStyle = '#1A1814'
  ctx.fillRect(0, 0, PRINT_W, PRINT_H)
  const cardX = margin
  const cardY = margin
  const cardW = PRINT_W - margin * 2
  const cardH = PRINT_H - margin * 2
  ctx.fillStyle = '#F2EDE4'
  ctx.strokeStyle = '#E0CFA3'
  ctx.lineWidth = 2
  roundRect(ctx, cardX, cardY, cardW, cardH, 24)
  ctx.fill()
  ctx.stroke()

  // 版心左右轴：正文与题记文字共用同一条左轴（对齐才成版面）
  const axisX = cardX + pad
  const axisRight = cardX + cardW - pad

  // 顶部：SEALED LETTER + 细线
  ctx.fillStyle = '#8A7530'
  ctx.font = '500 26px sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('SEALED LETTER', axisX, cardY + Math.round(14 * MM))
  ctx.strokeStyle = 'rgba(196, 167, 108, 0.35)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(axisX, cardY + Math.round(18 * MM))
  ctx.lineTo(axisRight, cardY + Math.round(18 * MM))
  ctx.stroke()

  // 标题（左上）
  const titleY = cardY + Math.round(30 * MM)
  ctx.fillStyle = '#2B2723'
  ctx.font = '600 46px serif'
  ctx.fillText('山海造物 · 礼笺', axisX, titleY)

  // 藏品图（右上）：整块落在标题行右侧，题记带从**图之下**开始 → 永不重叠
  let blockTop = titleY + Math.round(4 * MM)
  if (o.specimenImage) {
    const imgSize = Math.round(40 * MM)
    const imgX = axisRight - imgSize
    const imgY = titleY - Math.round(24 * MM)
    ctx.save()
    roundRect(ctx, imgX, imgY, imgSize, imgSize, 12)
    ctx.clip()
    try { ctx.drawImage(o.specimenImage, imgX, imgY, imgSize, imgSize) } catch (e) { /* 图挂留白 */ }
    ctx.restore()
    blockTop = Math.max(blockTop, imgY + imgSize + Math.round(5 * MM))
  }

  // 题记带：**整宽**（图已在其上方，不再被盖）
  let y = blockTop
  const themeName = String(o.themeName || '').trim()
  const themeNote = String(o.themeNote || '').trim()
  if (themeName) {
    const bandW = axisRight - axisX
    const innerPad = Math.round(6 * MM)
    const noteLines = themeNote ? wrapLines(ctx, themeNote, bandW - innerPad * 2, 3) : []
    const bandH = Math.round(15 * MM) + noteLines.length * 32
    ctx.fillStyle = 'rgba(196, 167, 108, 0.08)'
    roundRect(ctx, axisX, y, bandW, bandH, 8)
    ctx.fill()
    ctx.fillStyle = '#C4A76C'
    ctx.fillRect(axisX, y, 6, bandH)
    ctx.textAlign = 'left'
    ctx.fillStyle = '#B08A3E'
    ctx.font = '600 36px serif'
    ctx.fillText(themeName, axisX + innerPad, y + Math.round(10 * MM))
    ctx.fillStyle = '#5A544C'
    ctx.font = '400 27px serif'
    for (let i = 0; i < noteLines.length; i += 1) {
      ctx.fillText(noteLines[i], axisX + innerPad, y + Math.round(15 * MM) + i * 32)
    }
    y += bandH + Math.round(6 * MM)
  }

  // 正文：与题记同一左轴；行高放宽，让笺面读起来有呼吸
  const lineH = 54
  const footerTop = cardY + cardH - Math.round(34 * MM)
  ctx.fillStyle = '#2B2723'
  ctx.font = '400 31px serif'
  const maxLines = Math.max(1, Math.floor((footerTop - y - Math.round(6 * MM)) / lineH))
  const bodyLines = wrapLines(ctx, String(o.cardBody || ''), axisRight - axisX, maxLines)
  const bodyY = y + Math.round(10 * MM)
  for (let i = 0; i < bodyLines.length; i += 1) {
    ctx.fillText(bodyLines[i], axisX, bodyY + i * lineH)
  }

  // 底部落款：**印章在左、署名在右**，两者永不相撞（此前署名压在圆印里）
  const sealR = Math.round(10 * MM)
  const sealCx = axisX + sealR
  const sealCy = cardY + cardH - Math.round(19 * MM)
  ctx.strokeStyle = 'rgba(196, 167, 108, 0.85)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(sealCx, sealCy, sealR, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = '#C76A4A'
  ctx.font = '600 32px serif'
  ctx.textAlign = 'center'
  ctx.fillText('山海', sealCx, sealCy + 11)

  // 日期（印章右侧，弱化）—— 让下半版有落点，不再空荡
  ctx.textAlign = 'left'
  ctx.fillStyle = '#B4AC9F'
  ctx.font = '400 26px serif'
  const d = new Date()
  const dateText = d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0')
  ctx.fillText(dateText, sealCx + sealR + Math.round(6 * MM), sealCy + 9)

  // 署名（右下，带铜金下划线）
  const sig = String(o.cardSignature || '').trim()
  if (sig) {
    ctx.textAlign = 'right'
    ctx.fillStyle = '#2B2723'
    ctx.font = '500 31px serif'
    const sy = sealCy + 10
    ctx.fillText(sig, axisRight, sy)
    const sw = ctx.measureText(sig).width
    ctx.strokeStyle = 'rgba(196, 167, 108, 0.6)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(axisRight - sw - 8, sy + 12)
    ctx.lineTo(axisRight, sy + 12)
    ctx.stroke()
  }
  ctx.textAlign = 'left'
}

/** 印刷版导出：canvas 尺寸即输出像素（A6@300dpi），返回临时图片路径 */
function renderGiftPrintImage(selector, page, opts) {
  const options = opts || {}
  return new Promise((resolve) => {
    try {
      wx.createSelectorQuery()
        .in(page)
        .select(selector)
        .fields({ node: true, size: true })
        .exec(async (res) => {
          const canvas = res && res[0] && res[0].node
          if (!canvas) { resolve(''); return }
          const remote = options.specimenFileID || options.specimenUrl || ''
          let specimenImage = null
          if (remote) {
            try {
              const local = await resolveLocalImage(remote)
              if (local) specimenImage = await loadCanvasImage(canvas, local)
            } catch (e) { /* 图挂不影响出卡 */ }
          }
          try {
            paintGiftPrintCard(canvas, {
              cardBody: options.cardBody,
              cardSignature: options.cardSignature,
              themeName: options.themeName,
              themeNote: options.themeNote,
              specimenImage
            })
          } catch (e) {
            console.warn('giftShareCard print paint', e)
            resolve('')
            return
          }
          setTimeout(() => {
            wx.canvasToTempFilePath({
              canvas,
              fileType: 'png',
              quality: 1,
              success: (r) => resolve((r && r.tempFilePath) || ''),
              fail: (err) => { console.warn('giftShareCard print toTemp', err); resolve('') }
            })
          }, 64)
        })
    } catch (e) {
      console.warn('giftShareCard print query', e)
      resolve('')
    }
  })
}

module.exports = {
  SHARE_CARD_W: W,
  PRINT_CARD_W: PRINT_W,
  PRINT_CARD_H: PRINT_H,
  paintGiftPrintCard,
  renderGiftPrintImage,
  SHARE_CARD_H: H,
  renderGiftShareImage,
  paintGiftShareCard,
  resolveLocalImage
}
