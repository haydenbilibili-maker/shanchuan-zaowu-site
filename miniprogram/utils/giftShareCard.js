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
// A6 竖版 @300dpi = 1240 × 1748 px（105 × 148 mm）—— 印刷用，**满幅无黑边**（打印/裁切方便）
// 版式坐标按 1240 宽的设计稿书写，绘制前统一等比缩放 → 改纸张只改这两个常量
const PRINT_W = 1240
const PRINT_H = 1748
const PRINT_DESIGN_W = 1240

function paintGiftPrintCard(canvas, opts) {
  // 版式学习前端礼笺卡（compose 的 .card-* ）：写给 TA + 右上印章 → 题记带 → 手写体正文
  //   → 署名(左, 铜金下划线) + 日期(右, 弱化) → 右下淡「山海」水印
  const o = opts || {}
  const MM = 11.811
  const margin = Math.round(10 * MM)
  const pad = Math.round(14 * MM)
  canvas.width = PRINT_W
  canvas.height = PRINT_H
  const ctx = canvas.getContext('2d')
  // 等比放大：之后所有坐标按 A6 设计稿写（改纸张规格不动版式）
  const S = PRINT_W / PRINT_DESIGN_W
  const LW = PRINT_W / S
  const LH = PRINT_H / S
  ctx.setTransform(S, 0, 0, S, 0, 0)

  // 满幅米白：印刷要出血/裁切方便，不做「深色桌面上的卡片」那种展示框（黑边打印不便）
  ctx.fillStyle = '#F2EDE4'
  ctx.fillRect(0, 0, LW, LH)
  const cardX = margin
  const cardY = margin
  const cardW = LW - margin * 2
  const cardH = LH - margin * 2
  // 内嵌细铜金框（印刷级留白内的一条静线，替代原来的深色外框）
  ctx.strokeStyle = 'rgba(196, 167, 108, 0.45)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(cardX, cardY, cardW, cardH)

  const axisX = cardX + pad
  const axisRight = cardX + cardW - pad
  // 手写体：与前端同一套系统字体栈（iOS 命中汉仪手写体/签笔，Android 落衬线兜底）
  const HAND = '"HanziPen SC", "Hannotate SC", "STKaiti", "Kaiti SC", "KaiTi", serif'

  // ── 顶行：写给 · TA（左）＋「山海」印章（右）—— 学前端那张卡的首行
  const topY = cardY + Math.round(16 * MM)
  const toName = String(o.recipientName || '').trim()
  ctx.textAlign = 'left'
  if (toName) {
    ctx.fillStyle = '#8A7530'
    ctx.font = '400 28px serif'
    ctx.fillText('写给 · ' + toName, axisX, topY)
  }

  // 印章：朱红实心圆角方印（白文 = 字为米色挖空）+ 轻微倾斜 —— 学真印章的形制
  const sealSize = Math.round(20 * MM)
  const sealCx = axisRight - sealSize / 2
  const sealCy = topY - Math.round(9 * MM)
  ctx.save()
  ctx.translate(sealCx, sealCy)
  ctx.rotate(-0.055)                                  // 略斜，像手盖上去的
  const half = sealSize / 2
  ctx.fillStyle = '#B23A2E'                            // 朱砂红（比之前的砖红更正）
  roundRect(ctx, -half, -half, sealSize, sealSize, Math.round(3 * MM))
  ctx.fill()
  ctx.globalAlpha = 0.06                               // 印泥的斑驳（轻）
  ctx.fillStyle = '#F2EDE4'
  for (let i = 0; i < 26; i += 1) {
    const px = -half + ((i * 37) % sealSize)
    const py = -half + ((i * 61) % sealSize)
    ctx.fillRect(px, py, 3, 3)
  }
  ctx.globalAlpha = 1
  ctx.fillStyle = '#F2EDE4'                            // 白文：字挖空
  ctx.font = '600 44px serif'
  ctx.textAlign = 'center'
  ctx.fillText('山', -Math.round(4.6 * MM), Math.round(6 * MM))
  ctx.fillText('海', Math.round(4.6 * MM), Math.round(6 * MM))
  ctx.restore()

  // ── 题记带（整宽；学习前端 .card-epigraph：铜金左线 + 暖底 + 金主题名 + 灰题记）
  let y = topY + Math.round(14 * MM)
  const themeName = String(o.themeName || '').trim()
  const themeNote = String(o.themeNote || '').trim()
  if (themeName) {
    const bandW = axisRight - axisX
    const innerPad = Math.round(6 * MM)
    const noteLines = themeNote ? wrapLines(ctx, themeNote, bandW - innerPad * 2, 3) : []
    const bandH = Math.round(15 * MM) + noteLines.length * 32
    ctx.fillStyle = 'rgba(196, 167, 108, 0.10)'
    roundRect(ctx, axisX, y, bandW, bandH, 10)
    ctx.fill()
    ctx.fillStyle = '#C4A76C'
    ctx.fillRect(axisX, y, 6, bandH)
    ctx.textAlign = 'left'
    ctx.fillStyle = '#B08A3E'
    ctx.font = '600 38px serif'
    ctx.fillText(themeName, axisX + innerPad, y + Math.round(10 * MM))
    ctx.fillStyle = '#6A6258'
    ctx.font = '400 28px serif'
    for (let i = 0; i < noteLines.length; i += 1) {
      ctx.fillText(noteLines[i], axisX + innerPad, y + Math.round(15.5 * MM) + i * 34)
    }
    y += bandH + Math.round(8 * MM)
  }

  // ── 正文（手写体、大字距宽行距；前端那张卡的正文观感）
  const lineH = 62
  // 页脚区带：两枚码（各 22mm）+ 各自小字 ≈ 30mm，上方再留 10mm 呼吸 → 正文区必须让位
  const FOOTER_H = Math.round(44 * MM)
  const footerTop = cardY + cardH - FOOTER_H
  const signTop = footerTop - Math.round(10 * MM)
  ctx.fillStyle = '#2B2723'
  ctx.font = '400 34px ' + HAND
  const maxLines = Math.max(1, Math.floor((signTop - y - Math.round(8 * MM)) / lineH))
  const bodyLines = wrapLines(ctx, String(o.cardBody || ''), axisRight - axisX, maxLines)
  // 垂直居中：短笺不再「贴着题记、下留大片空」；长笺自然填满
  const bodyBlockH = bodyLines.length * lineH
  const freeTop = y + Math.round(6 * MM)
  const freeBottom = signTop - Math.round(4 * MM)
  const bodyY = freeTop + Math.max(0, Math.round((freeBottom - freeTop - bodyBlockH) / 2)) + Math.round(9 * MM)
  for (let i = 0; i < bodyLines.length; i += 1) {
    ctx.fillText(bodyLines[i], axisX, bodyY + i * lineH)
  }

  // ── 页脚带：左＝署名 + 日期；右＝两枚码（都在带内，永不压正文）
  const footBase = footerTop + Math.round(20 * MM)     // 码的基线：带内偏上
  const sig = String(o.cardSignature || '').trim()
  if (sig) {
    ctx.textAlign = 'left'
    ctx.fillStyle = '#2B2723'
    ctx.font = '500 36px ' + HAND
    ctx.fillText(sig, axisX, footBase)
    const sw = ctx.measureText(sig).width
    ctx.strokeStyle = 'rgba(196, 167, 108, 0.6)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(axisX, footBase + 12)
    ctx.lineTo(axisX + Math.max(sw, Math.round(28 * MM)), footBase + 12)
    ctx.stroke()
  }
  const d = new Date()
  const dateText = d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0')
  ctx.textAlign = 'left'
  ctx.fillStyle = '#B4AC9F'
  ctx.font = '400 22px serif'
  ctx.fillText(dateText, axisX, footBase + Math.round(11 * MM))

  // 两枚码：从右往左排（小程序码在最右），各自带小字；素材缺失各自静默跳过
  const codes = []
  if (o.qrcodeImage) codes.push({ img: o.qrcodeImage, caption: '扫码进店', size: Math.round(22 * MM) })
  if (o.serviceQrImage) codes.push({ img: o.serviceQrImage, caption: '客服微信', size: Math.round(22 * MM) })
  let cx = axisRight
  for (let i = 0; i < codes.length; i += 1) {
    const c = codes[i]
    const x = cx - c.size
    const y = footerTop + Math.round(2 * MM)
    ctx.save()
    ctx.fillStyle = '#FFFFFF'
    roundRect(ctx, x - 3, y - 3, c.size + 6, c.size + 6, 6)
    ctx.fill()
    try { ctx.drawImage(c.img, x, y, c.size, c.size) } catch (e) { /* 码挂跳过 */ }
    ctx.restore()
    ctx.fillStyle = '#8A7530'
    ctx.font = '400 20px serif'
    ctx.textAlign = 'center'
    ctx.fillText(c.caption, x + c.size / 2, y + c.size + Math.round(6 * MM))
    cx = x - Math.round(8 * MM)
  }
  ctx.textAlign = 'left'

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
          // 印刷卡不画藏品图（版式对齐前端礼笺卡）→ 不再下载云文件，省一次 IO
          try {
            let qrcodeImage = null
            let serviceQrImage = null
            if (options.qrcodePath) {
              try { qrcodeImage = await loadCanvasImage(canvas, options.qrcodePath) } catch (e) { /* 素材缺失跳过 */ }
            }
            if (options.serviceQrPath) {
              try { serviceQrImage = await loadCanvasImage(canvas, options.serviceQrPath) } catch (e) { /* 素材缺失跳过 */ }
            }
            paintGiftPrintCard(canvas, {
              cardBody: options.cardBody,
              cardSignature: options.cardSignature,
              themeName: options.themeName,
              themeNote: options.themeNote,
              recipientName: options.recipientName,
              qrcodeImage,
              serviceQrImage
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
