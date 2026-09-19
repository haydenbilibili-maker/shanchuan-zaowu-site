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

/**
 * 纸张规格表（**纯增量**：`a6` 值即上面三个常量，绘制路径未改，A6 行为零改动）。
 *
 * ⚠ 为什么 `sticker` **不能**只靠等比缩放：
 *   绘制坐标按 1240 宽的设计稿书写，绘制前**统一等比缩放**。A6 与设计稿同比例
 *   （1240:1748 = 1:1.41）故能「满幅无黑边」；而热敏贴纸的可打印区约 75×69mm（1:0.92，**近方形**），
 *   与设计稿比例不同 ⇒ 等比缩放只会**留白或溢出**，必须**重排版式**
 *   （题记/正文/署名/页脚两枚码在近方形下的纵向分配）。
 *   详见 `admin/docs/礼笺贴纸版式_技术蓝图.md` §3（A6 放不下的推导）与 §6（实现方案）。
 *
 * sticker 尺寸依据 —— **影像预估，待实物「校准网格」确认**（见蓝图 §2/§5）：
 *   贴纸 90×110mm，扣装饰边框（左右 ~7.3/7.9mm、上 ~5.9mm）与底部水彩花带（~29.5mm）后
 *   白区约 75×75mm，再避开右下**预印 24mm 印章** ⇒ 干净可打印区 ≈ 75 × 69 mm
 *   ⇒ @300dpi = **886 × 815 px**。
 */
const PRINT_SPECS = {
  a6: { w: 1240, h: 1748, designW: 1240, label: 'A6 竖版 105×148mm' },
  sticker: { w: 886, h: 815, designW: 886, label: '热敏贴纸可打印区 75×69mm（预估，待实物确认）' },
}

/**
 * 热敏贴纸（90×110mm）**近方形**版式的全部可调参数 —— 单位 px（@300dpi，1mm = 11.811px）。
 *
 * ⚠⚠ **待实物校准网格确认**：下面每一个数都由蓝图 §2 的**影像预估**推出（贴纸未到货）。
 *   到货后必须：① 先印**校准网格**（每 5mm 一格）量真实白区；② 用真实白区重算本表；
 *   ③ 再印真实礼笺做**真图复核**。**在完成 ①②③ 之前，本表一律视为未验证值。**
 *
 * 版式分带（y 从上到下）：
 *   topY        写给 · TA（题记之上的一行）
 *   bandTop     题记带（主题名 + 题记；无主题名则整带不画）
 *   bodyTop/bodyBottom  正文带（自适应缩放，居中；**永不截断**）
 *   sigY        署名带（署名 + 日期，**只在左半区**）
 *   footerTop   页脚带（两枚 14mm 码 + 小字，**只在左半区**）
 *   stampTop    右下**预印 24mm 印章**的上缘 —— 印章区（x ≥ stampLeft 且 y ≥ stampTop）**全空**
 *
 * ⚠⚠ **本表的纵向约束是「不等式」而不是「好看的数」** —— 2026-09-19 真机真图事故：
 *   首版把 `bodyTop` 写成 47mm（=555px），而署名带顶 `signTop = footerTop - sigOffset` 只有 508px
 *   ⇒ `availH = signTop - bodyTop = **-47**` ⇒ 正文的自适应入口 `availH > 0` 为假、
 *   绘制循环首行也被 `(i+1)*lineH <= availH + lineH` 滤掉 ⇒ **正文一行都没印**（真图一片米白）。
 *   教训：**只改 STICKER 表里的数就可能让整段正文消失**，所以本表必须满足下面三条不变式
 *   （守卫 `check:gift-sticker-layout` 逐条复算，见那里的「版面不变式」块）：
 *     ① `bodyTop < signTop`（否则 availH ≤ 0 ⇒ 正文零落墨）
 *     ② 题记带底（最长 2 行注时）≤ `signTop`，且 ≥ `bodyTop`（否则题记与正文/署名相撞）
 *     ③ `signTop`、`footerTop + qrSize + qrCaptionOffset`、印章区彼此不重叠，且都在纸内
 *
 * 为什么署名/两枚码都在左半区（而不是 A6 的「署名左 + 码右」）：
 *   近方形下右侧内缩后只剩 ~48mm，且**右下 24mm 被预印印章占掉**；
 *   若沿用 A6 的「码贴右内框」，两枚码与 24mm 印章必然重叠（历史真图 bug 重演）。
 *   故本版式把「署名 + 日期」与「两枚码」改为**同一左半区的上下两带** → 横向不可能相撞；
 *   右侧留给印章，而署名下划线另有 `sigMaxW` 限宽（双保险）。
 *   （2026-09-19 真图精修：两枚码从 14mm 回 15mm 与 A6 同口径，并整体下移到白区底部，
 *     把中部让给正文 —— 首版正文带被挤到 -47px 就是这么来的。）
 */
const STICKER = {
  margin: Math.round(1.5 * 11.811),                     // 内容外框（贴纸装饰边内再收 1.5mm）
  pad: Math.round(1.8 * 11.811),                        // 文字轴相对外框的内边距
  topY: Math.round(8.5 * 11.811),                       // 「写给 · TA」基线
  bandTop: Math.round(10.5 * 11.811),                   // 题记带顶
  bandBasePad: Math.round(5 * 11.811),                  // 主题名基线（带顶下移）
  bandNoteBase: Math.round(8.8 * 11.811),               // 题记首行基线（带顶下移）
  bandNoteLineH: 27,                                    // 题记行高
  bandPadB: Math.round(3.5 * 11.811),                   // 带底留白
  bandGap: Math.round(2 * 11.811),                      // 带底 → 正文带顶的间隔（**必须存在**：删掉它 y 会变 NaN ⇒ 正文再次消失）
  bodyTop: Math.round(19 * 11.811),                     // 正文带顶（无题记时用）—— **必须 < signTop**
  sigOffset: Math.round(14 * 11.811),                   // 署名基线相对 footerTop（向上）—— 再小就会与正文末行贴住（实测 5px）
  dateOffset: Math.round(10.2 * 11.811),                // 日期基线相对 footerTop（向上）—— **必须小于 sigOffset**（y 越大越靠下）
  underlineGap: Math.round(1.5 * 11.811),               // 署名下划线在基线下
  sigMaxW: Math.round(23 * 11.811),                     // 署名下划线**限宽**（不得越到印章区）
  sigBaseSize: 34,                                      // 署名基准字号（超宽按宽度等比缩，不裁字）
  sigMinSize: 25,
  footerTop: Math.round(52.5 * 11.811),                 // 页脚带顶（码从带顶起；白区底部，给正文让出中部）
  qrSize: Math.round(13.6 * 11.811),                    // 每枚码的边长（白区纵向只有 69mm：码 13.6mm + 小字才放得下，且给正文留块）
  qrGap: Math.round(5 * 11.811),                        // 两枚码间距
  qrCaptionOffset: Math.round(1.8 * 11.811),            // 码下小字基线偏移（码底 + 1.8mm，避免蹭到白区下沿）
  qrCaptionSize: 18,
  qrRightPad: Math.round(1.8 * 11.811),                 // 页脚右内缩（内容不得贴到贴纸装饰边）
  stampSize: Math.round(24 * 11.811),                   // 右下**预印**圆形印章直径
  stampRightPad: Math.round(1.5 * 11.811),              // 印章距内容外框右缘（白区右缘）
  stampTopPad: Math.round(1.5 * 11.811),                // 印章上缘相对 footerTop（让印章留在页脚带右下）
}

function paintGiftPrintCard(canvas, opts) {
  // 版式学习前端礼笺卡（compose 的 .card-* ）：写给 TA → 题记带 → 手写体正文
  //   → 署名(左, 铜金下划线) + 日期(右, 弱化) → 右下淡「山海」水印
  const o = opts || {}
  const spec = PRINT_SPECS[o.spec] || PRINT_SPECS.a6   // 未知/未传 → a6（**默认 A6，行为零改动**）
  // 贴纸（近方形 886×815）与 A6 比例不同 —— **不是缩放问题而是版式问题**（蓝图 §3），
  // 故另起一套 painter（paintGiftStickerCard）。此处除这一行分派外，
  // A6 分支的坐标、字号、循环写法与 80-cross 的断言锚点**逐字未动**。
  if (spec === PRINT_SPECS.sticker) return paintGiftStickerCard(canvas, o)
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

  // ── 顶行：写给 · TA（左上）—— 原「山海」印章已去掉
  const topY = cardY + Math.round(16 * MM)
  const toName = String(o.recipientName || '').trim()
  ctx.textAlign = 'left'
  if (toName) {
    ctx.fillStyle = '#8A7530'
    ctx.font = '400 30px serif'
    ctx.fillText('写给 · ' + toName, axisX, topY)
  }

  // （原右上「山海」朱红印章已按产品负责人要求去掉 —— 卡面留白更干净）

  // ── 题记带（整宽；学习前端 .card-epigraph：铜金左线 + 暖底 + 金主题名 + 灰题记）
  let y = topY + Math.round(12 * MM)
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
    ctx.font = '600 40px serif'
    ctx.fillText(themeName, axisX + innerPad, y + Math.round(10 * MM))
    ctx.fillStyle = '#6A6258'
    ctx.font = '400 28px serif'
    for (let i = 0; i < noteLines.length; i += 1) {
      ctx.fillText(noteLines[i], axisX + innerPad, y + Math.round(15.5 * MM) + i * 34)
    }
    y += bandH + Math.round(8 * MM)
  }

  // ── 正文（手写体、大字距宽行距；前端那张卡的正文观感）
  // 页脚区带：两枚码（各 22mm）+ 各自小字 ≈ 30mm → 36mm 足够，正文拿回空间
  const FOOTER_H = Math.round(30 * MM)
  const footerTop = cardY + cardH - FOOTER_H
  const signTop = footerTop - Math.round(8 * MM)

  // 正文：**自适应缩放，永不截断**（印刷卡不能丢字 —— 真图曾因 maxLines 截断丢了一整行）
  const text = String(o.cardBody || '')
  const availH = signTop - y - Math.round(6 * MM)
  let fontPx = 40
  let lineH = 72
  ctx.fillStyle = '#2B2723'
  ctx.font = '400 ' + fontPx + 'px ' + HAND
  let bodyLines = wrapLines(ctx, text, axisRight - axisX, 999)
  if (bodyLines.length * lineH > availH && availH > 0) {
    // 逐档缩小字号与行高，直到装得下（下限 24px，仍装不下才截断并告警）
    while (fontPx > 28 && bodyLines.length * lineH > availH) {
      fontPx -= 2
      lineH = Math.round(fontPx * 1.8)
      ctx.font = '400 ' + fontPx + 'px ' + HAND
      bodyLines = wrapLines(ctx, text, axisRight - axisX, 999)
    }
    if (bodyLines.length * lineH > availH) console.warn('giftPrint: 礼笺过长，已按可用高度截断')
  }
  const bodyBlockH = bodyLines.length * lineH
  const freeTop = y + Math.round(6 * MM)
  const freeBottom = signTop - Math.round(4 * MM)
  const bodyY = freeTop + Math.max(0, Math.round((freeBottom - freeTop - bodyBlockH) / 2)) + Math.round(9 * MM)
  for (let i = 0; i < bodyLines.length && (i + 1) * lineH <= availH + lineH; i += 1) {
    ctx.fillText(bodyLines[i], axisX, bodyY + i * lineH)
  }

  // ── 页脚带：左＝署名 + 日期；右＝两枚码（都在带内，永不压正文）
  const footBase = footerTop + Math.round(20 * MM)     // 码的基线：带内偏上
  const sig = String(o.cardSignature || '').trim()
  if (sig) {
    ctx.textAlign = 'left'
    ctx.fillStyle = '#2B2723'
    ctx.font = '500 40px ' + HAND
    ctx.fillText(sig, axisX, footBase)
    const sw = ctx.measureText(sig).width
    ctx.strokeStyle = 'rgba(196, 167, 108, 0.6)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(axisX, footBase + 12)
    ctx.lineTo(axisX + Math.max(sw, Math.round(14 * MM)), footBase + 12)  // 只到字宽附近，避免越过右侧两枚码
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
  if (o.qrcodeImage) codes.push({ img: o.qrcodeImage, caption: '扫码进店', size: Math.round(15 * MM) })
  if (o.serviceQrImage) codes.push({ img: o.serviceQrImage, caption: '客服微信', size: Math.round(15 * MM) })
  // 右边界贴内框内侧 4mm（此前误用文字轴 axisRight，等于把左内边距算两次 → 离纸边 24mm ✗）
  const qrRight = cardX + cardW - Math.round(4 * MM)
  let cx = qrRight
  for (let i = 0; i < codes.length; i += 1) {
    const c = codes[i]
    const x = cx - c.size
    const y = footerTop + Math.round(2 * MM)
    // 码已是**透明 PNG**（白底已抠掉）→ 不再画白色底托，让码直接落在米白卡面上
    try { ctx.drawImage(c.img, x, y, c.size, c.size) } catch (e) { /* 码挂跳过 */ }
    ctx.fillStyle = '#8A7530'
    ctx.font = '400 20px serif'
    ctx.textAlign = 'center'
    ctx.fillText(c.caption, x + c.size / 2, y + c.size + Math.round(6 * MM))
    cx = x - Math.round(6 * MM)
  }
  ctx.textAlign = 'left'

ctx.textAlign = 'left'
}

/* ─────────────────────────────────────────────────────────────────────────
 * 热敏不干胶贴纸版（90×110mm，白区 ≈75×69mm @300dpi = 886×815）
 *
 * **这是重排版式，不是 A6 的缩放**（蓝图 §3：A6 1:1.41 vs 可打印区 1:0.92 ⇒ 放不进）：
 *   A6 = 瘦高卡，纵向富裕；贴纸 = 近方形，纵向只剩 69mm ⇒ 四个带（题记/正文/署名/页脚）必须重分。
 *
 * **重点风险（历史真图 bug）**：近方形下「署名」与「两枚码」争位 → 两枚码压住署名。
 *   A6 的解法是「署名左 / 码右」，但贴纸右侧只有 ~48mm 且**右下 24mm 被预印印章占掉**，
 *   沿用 A6 排法必然让码压到印章上。故本版式改用**分区不重叠**的强约束：
 *     · 两枚码 + 小字 全在**左下**（页脚带，从 axisX 起向右排）
 *     · 署名 + 日期 全在**左半区**（署名带，位于页脚带之上）
 *     · 右下**印章区**（stampLeft 右侧 且 stampTop 下方）**一律不落墨**
 *   三条都能被守卫独立复算（见 miniprogram/scripts/check-gift-sticker-layout.mjs），
 *   不靠「调参试出来」。
 *
 * 硬约束延续：满幅无黑边（米白铺满）/ 正文自适应**永不截断** / 不印自带边框 /
 *   署名下划线不越到两枚码（贴纸另有 sigMaxW 限宽）/ 两枚码 15mm→**14mm**（近方形下收紧）。
 * ───────────────────────────────────────────────────────────────────────── */
function paintGiftStickerCard(canvas, o) {
  const MM = 11.811
  canvas.width = PRINT_SPECS.sticker.w
  canvas.height = PRINT_SPECS.sticker.h
  const ctx = canvas.getContext('2d')
  const LW = PRINT_SPECS.sticker.designW
  const LH = PRINT_SPECS.sticker.h
  ctx.setTransform(1, 0, 0, 1, 0, 0)

  // 满幅米白（无黑边；贴纸白区本就米白，铺满防透明/黑底）
  ctx.fillStyle = '#F2EDE4'
  ctx.fillRect(0, 0, LW, LH)

  const cardX = STICKER.margin
  const cardW = LW - STICKER.margin * 2
  const cardH = LH - STICKER.margin * 2
  const axisX = cardX + STICKER.pad
  const axisRight = cardX + cardW - STICKER.pad
  // 手写体：与 A6 同一套字体栈（保持品牌一致）
  const HAND = '"HanziPen SC", "Hannotate SC", "STKaiti", "Kaiti SC", "KaiTi", serif'

  // 禁止落墨的**右下预印印章区**（x ≥ stampLeft 且 y ≥ stampTop）
  const stampRight = cardX + cardW - STICKER.stampRightPad
  const stampLeft = stampRight - STICKER.stampSize
  const stampTop = STICKER.footerTop + STICKER.stampTopPad

  // ── 顶行：写给 · TA（左上）
  const toName = String(o.recipientName || '').trim()
  ctx.textAlign = 'left'
  if (toName) {
    ctx.fillStyle = '#8A7530'
    ctx.font = '400 26px serif'
    ctx.fillText('写给 · ' + toName, axisX, STICKER.topY)
  }

  // ── 题记带（近方形：主题名 32px / 题记 24px，最多 2 行；无主题名则整带不画）
  let y = STICKER.bandTop
  // ⚠ 变量名与 A6 分支**刻意不同**（这里是 `o.themeName ||`，A6 分支用 String(...) 包一层）：
  //   80-cross 的 `test:gift-note-variants:selftest` 拿 A6 那一行的**源码字面量**当注入锚点，
  //   同一文件出现第二份 → 锚点命中 2 次 → 那条**跨域**守卫的自检失败（本轮实测就是这么炸的）。
  //   跨域改守卫要提变更请求，故由本分支改写法。
  //   **不要把这里「统一」回 A6 的写法**（连注释里也不要写出那一整行），除非同步改那条守卫的锚点。
  const bandTheme = String(o.themeName || '').trim()
  const themeNote = String(o.themeNote || '').trim()
  if (bandTheme) {
    const bandW = axisRight - axisX
    const innerPad = Math.round(4 * MM)
    const noteLines = themeNote ? wrapLines(ctx, themeNote, bandW - innerPad * 2, 2) : []
    const bandH = STICKER.bandBasePad + Math.max(1, noteLines.length) * STICKER.bandNoteLineH + STICKER.bandPadB
    ctx.fillStyle = 'rgba(196, 167, 108, 0.10)'
    roundRect(ctx, axisX, y, bandW, bandH, 8)
    ctx.fill()
    ctx.fillStyle = '#C4A76C'
    ctx.fillRect(axisX, y, 6, bandH)
    ctx.textAlign = 'left'
    ctx.fillStyle = '#B08A3E'
    ctx.font = '600 32px serif'
    ctx.fillText(bandTheme, axisX + innerPad, y + STICKER.bandBasePad)
    ctx.fillStyle = '#6A6258'
    ctx.font = '400 24px serif'
    for (let i = 0; i < noteLines.length; i += 1) {
      ctx.fillText(noteLines[i], axisX + innerPad, y + STICKER.bandNoteBase + i * STICKER.bandNoteLineH)
    }
    y += bandH + STICKER.bandGap
  }

  // ── 正文带：题记带下沿（或 bodyTop）→ 署名带之上
  // ⚠ 首版这里是 `Math.max(y, STICKER.bodyTop)` 且**没有**给题记带下沿留间隔：
  //   ① `STICKER.bodyTop`(47mm=555) 落在署名带顶(508) 之下 ⇒ availH=-47 ⇒ 正文一行都没印（真图事故）；
  //   ② 首行顶端判定 `bodyY + i*lineH > bodyTop` 会把**首行**判掉（只差 2px）⇒ 正文整段消失。
  //   现在的口径是 **正文优先**：正文带顶至少是「题记带下沿 + 一个行内间隔」，
  //   但表里的 `bodyTop` 只作**下限参考**（题记带很高时正文仍从带下沿起，不会被压到 0）。
  const bodyTop = Math.max(y + Math.round(2 * MM), STICKER.bodyTop)
  const signTop = STICKER.footerTop - STICKER.sigOffset
  const availH = signTop - bodyTop
  // **版面不变式①的运行时兜底**（2026-09-19 真图事故：availH ≤ 0 ⇒ 正文零落墨）
  if (availH <= 0) console.warn('giftSticker: 正文带高度为 ' + availH + 'px（≤0）—— STICKER.bodyTop 不得低于 signTop，请改表')
  const text = String(o.cardBody || '')
  let fontPx = 34
  let lineH = Math.round(34 * 1.62)
  ctx.fillStyle = '#2B2723'
  ctx.font = '400 ' + fontPx + 'px ' + HAND
  let bodyLines = wrapLines(ctx, text, axisRight - axisX, 999)
  let bodyDrawn = 0
  // **永不截断**：先逐档缩小字号（下限 22px），仍放不下再**压缩行距**（最终打包）。
  //   为什么必须有"压缩行距"这一步（2026-09-19 实测）：只缩字号会在 34px→22px 的
  //   **换行点跳变**上提前放弃 —— 实测容量一度低到 52 字就整块不画（信文凭空消失，比截断更糟）。
  //   压缩行距时按「行数 × 行距 ≤ 可用高」反解行距，保证**全部行都放得下**。
  const sigClear = () => Math.round(fontPx * 0.95)
  const bodyFloor = () => STICKER.footerTop - STICKER.sigOffset - sigClear()
  const bodyRoom = () => bodyFloor() - bodyTop
  const fits = () => bodyLines.length * lineH <= bodyRoom() + lineH && bodyLines.length * lineH <= availH
  while (fontPx > 22 && !fits()) {
    fontPx -= 2
    lineH = Math.round(fontPx * 1.62)
    ctx.font = '400 ' + fontPx + 'px ' + HAND
    bodyLines = wrapLines(ctx, text, axisRight - axisX, 999)
  }
  if (!fits() && bodyLines.length > 0) {
    // 最终打包：缩行距到「全部行都塞进正文带」为止（下限 1.15×字号，仍不行才告警不画）
    const usablePx = Math.min(availH, bodyRoom() + lineH)
    const packedLh = Math.floor(usablePx / bodyLines.length)
    if (packedLh >= Math.round(fontPx * 1.15)) lineH = packedLh
  }
  // 整块预检：必须能一次装下**全部**行才落墨（不满足则一行不画，绝不部分落墨/叠字）
  if (availH > 0 && bodyLines.length * lineH <= bodyRoom() + lineH) {
    // 正文块定位：**加权居中**（权重 0.45，略偏下）——
    //   纯居中会让短笺飘在题记带正下方、与署名之间留一大片空白（实测 1 行时下方空 111px）；
    //   偏下后短笺更靠近署名，视觉重心回到卡面中部。
    const usable = Math.min(availH, bodyRoom() + lineH)
    const blockTop = bodyTop + Math.max(0, Math.round((usable - bodyLines.length * lineH) * 0.45))
    const bodyY = blockTop + lineH
    for (let i = 0; i < bodyLines.length; i += 1) {
      const baseline = bodyY + i * lineH
      // 收口：末行基线必须在「署名基线上方 sigClear 净空」之上；越线整块不画（由下面的告警暴露）
      if (baseline > bodyFloor()) { bodyDrawn = 0; break }
      ctx.fillText(bodyLines[i], axisX, baseline)
      bodyDrawn += 1
    }
  }
  if (text.trim() && bodyDrawn < bodyLines.length) {
    console.warn('giftSticker: 正文只画了 ' + bodyDrawn + '/' + bodyLines.length + ' 行（版面高度不足）—— 这是真图事故形态，必须修 STICKER 表')
  }

  // ── 署名带（**只在左半区**：右端受 sigMaxW 与印章左缘双重限制）
  const sigBaseY = STICKER.footerTop - STICKER.sigOffset
  const sig = String(o.cardSignature || '').trim()
  if (sig) {
    ctx.textAlign = 'left'
    ctx.fillStyle = '#2B2723'
    let sigFont = STICKER.sigBaseSize
    let sigText = sig
    ctx.font = '500 ' + sigFont + 'px ' + HAND
    // 近方形下署名带浅 → 按可用宽度**等比缩字**；到下限仍超宽才截断（宁可小，不可越界/裁字）
    if (ctx.measureText(sigText).width > STICKER.sigMaxW) {
      sigFont = Math.max(STICKER.sigMinSize, Math.floor(sigFont * STICKER.sigMaxW / ctx.measureText(sigText).width))
      ctx.font = '500 ' + sigFont + 'px ' + HAND
      while (ctx.measureText(sigText).width > STICKER.sigMaxW && sigText.length > 2) {
        sigText = truncate(sigText, sigText.length - 1)
      }
    }
    ctx.fillText(sigText, axisX, sigBaseY)
    const sw = ctx.measureText(sigText).width
    ctx.strokeStyle = 'rgba(196, 167, 108, 0.6)'
    ctx.lineWidth = 2
    // 下划线**限宽**：既不超过 sigMaxW，也绝不到印章左缘（近方形历史 bug：署名与两枚码争位）
    const underlineW = Math.min(Math.max(sw, Math.round(9 * MM)), STICKER.sigMaxW, stampLeft - axisX - STICKER.pad)
    ctx.beginPath()
    ctx.moveTo(axisX, sigBaseY + STICKER.underlineGap)
    ctx.lineTo(axisX + Math.max(1, underlineW), sigBaseY + STICKER.underlineGap)
    ctx.stroke()
  }
  const d = new Date()
  const dateText = d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0')
  ctx.textAlign = 'left'
  ctx.fillStyle = '#B4AC9F'
  ctx.font = '400 20px serif'
  ctx.fillText(dateText, axisX, STICKER.footerTop - STICKER.dateOffset)

  // ── 页脚带（**左下**）：两枚码从左往右排，右端不得越过页脚右内缩（更不得进印章区）
  const codes = []
  if (o.qrcodeImage) codes.push({ img: o.qrcodeImage, caption: '扫码进店' })
  if (o.serviceQrImage) codes.push({ img: o.serviceQrImage, caption: '客服微信' })
  const qrRight = cardX + cardW - STICKER.qrRightPad
  let cx = axisX
  for (let i = 0; i < codes.length; i += 1) {
    const c = codes[i]
    const x = Math.min(cx, qrRight - STICKER.qrSize)
    const cy = STICKER.footerTop
    // 码已是**透明 PNG** → 不画白色底托
    try { ctx.drawImage(c.img, x, cy, STICKER.qrSize, STICKER.qrSize) } catch (e) { /* 码挂跳过 */ }
    ctx.fillStyle = '#8A7530'
    ctx.font = '400 ' + STICKER.qrCaptionSize + 'px serif'
    ctx.textAlign = 'center'
    ctx.fillText(c.caption, x + STICKER.qrSize / 2, cy + STICKER.qrSize + STICKER.qrCaptionOffset)
    cx = x + STICKER.qrSize + STICKER.qrGap
  }
  ctx.textAlign = 'left'
}

/** 印刷版导出：canvas 尺寸即输出像素（A6@300dpi / 贴纸@300dpi），返回临时图片路径。
 *  opts.spec = 'a6'（默认）| 'sticker' —— 版式分派见 paintGiftPrintCard 与 STICKER 表。 */
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
              serviceQrImage,
              // 'a6'（默认，行为零改动）| 'sticker'（热敏不干胶 90×110mm，近方形版式）
              spec: options.spec
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
  /** 纸张规格表（a6 既有 / sticker 预留）—— 供守卫与调用方引用，见文件内 PRINT_SPECS 注释 */
  PRINT_SPECS,
  paintGiftPrintCard,
  renderGiftPrintImage,
  SHARE_CARD_H: H,
  renderGiftShareImage,
  paintGiftShareCard,
  resolveLocalImage
}
