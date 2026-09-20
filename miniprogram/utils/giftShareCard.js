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
 *   （1240:1748 = 1:1.41）故能「满幅无黑边」；而热敏贴纸白区 75×75mm（**1:1**，2026-09-20 裁定），
 *   与设计稿比例不同 ⇒ 等比缩放只会**留白或溢出**，必须**重排版式**
 *   （题记/正文/署名/页脚两枚码在近方形下的纵向分配）。
 *   详见 `admin/docs/礼笺贴纸版式_技术蓝图.md` §3（A6 放不下的推导）与 §6（实现方案）。
 *
 * sticker 尺寸依据 —— **影像预估，待实物「校准网格」确认**（见蓝图 §2/§5）：
 *   贴纸 90×110mm，扣装饰边框（左右 ~7.3/7.9mm、上 ~5.9mm）与底部水彩花带（~29.5mm）后
 *   白区约 75×75mm，再避开右下**预印 24mm 印章** ⇒ 干净可打印区 ≈ 75 × 69 mm
 *   ⇒ @300dpi = **886 × 886 px**（1:1；早期影像预估的 75×69→886×815 已作废）。
 */
const PRINT_SPECS = {
  a6: { w: 1240, h: 1748, designW: 1240, label: 'A6 竖版 105×148mm' },
  // ⚠️ 2026-09-20 产品负责人裁定：礼笺**输出比例 1:1** → 贴纸白区按 75×75mm（886×886 @300dpi）。
  //    原来的 75×69 是从实物照片反推的**影像预估**（蓝图 §2 自己就标着"待实物校准网格确认"），
  //    1:0.92 的"近方形"是那个预估的产物，不是产品要求。裁定后按正方形重排纵向。
  sticker: { w: 886, h: 886, designW: 886, label: '热敏贴纸可打印区 75×75mm（1:1）' },
}

/**
 * 热敏贴纸**可打印白区 75×75mm（1:1）**版式的全部可调参数 —— 单位 px（@300dpi，1mm = 11.811px）。
 *   （不干胶底纸是 90×110mm；本表只管**白区**上的版面。）
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
/**
 * 印刷礼笺上两枚码的**文案**（A6 与贴纸同源 —— 只改一个规格会导致"同一份礼笺两个说法"）。
 *
 * 为什么要改（2026-09-20 产品负责人）：
 *   原文案「扫码进店」只说了"扫"，没说"扫了能得到什么"，顾客不知道值不值得扫；
 *   而贴纸是**热敏 75mm 的近方小卡**，扫码本来就难 —— 与其把码换成水印（那样就断了导流），
 *   不如①把好处写清楚，②在码下补一句**识别困难时的兜底路径**（微信搜一搜）。
 *   ⚠️ 码本身指向「养护指南」页（`subpackages/feature/care/guide/index`，见
 *   `scripts/qr-assets/gift-care-code-print.json` 的清单）—— 文案说"看养护说明"必须与它一致，
 *   否则就是印在纸上的假承诺。
 */
const PRINT_QR_COPY = {
  /** 小程序码：扫了到哪（一句就够，长说明交给下面那行兜底文案） */
  miniprogram: '养护指南',
  /** 客服码 */
  service: '客服微信',
  /** 兜底：印刷条件（热敏/小尺寸/磨损）导致识别不了时的第二条路。
   *  2026-09-20 产品负责人：「简化二维码下方文字说明，更改为**微信搜山海造物领标本养护指南**」
   *  —— 原文案"识别困难？"是**从故障出发**的说法；这句是**从结果出发**（搜到就能领养护指南），
   *  对着一张贴纸，后者才是顾客愿意照做的。同时把"搜索什么"和"搜到能得到什么"写在一句里。 */
  hint: '微信搜山海造物领标本养护指南'
}

const STICKER = {
  margin: Math.round(1.5 * 11.811),                     // 内容外框（贴纸装饰边内再收 1.5mm）
  pad: Math.round(1.8 * 11.811),                        // 文字轴相对外框的内边距
  topY: Math.round(8.5 * 11.811),                       // 「写给 · TA」基线
  bandTop: Math.round(10.5 * 11.811),                   // 题记带顶
  bandBasePad: Math.round(5 * 11.811),                  // 主题名基线（带顶下移）
  bandNoteBase: Math.round(8.8 * 11.811),               // 题记首行基线（带顶下移）
  bandNoteLineH: 34,                                    // 题记行高（2026-09-19：27→28 —— 再大就会把长笺正文挤到 24px 下限之下，守卫实测）                                    // 题记行高
  bandPadB: Math.round(3.0 * 11.811),                   // 带底留白（2026-09-19：3.5→3.0mm，为题记字号调大找回空间）                   // 带底留白
  bandGap: Math.round(1.7 * 11.811),                    // 带底→正文间隔（2026-09-19：2→1.7mm，同上；**必须 >0**）                      // 带底 → 正文带顶的间隔（**必须存在**：删掉它 y 会变 NaN ⇒ 正文再次消失）
  // 正文块在「正文带」里的**偏移权重**（0 = 贴着题记带起排；1 = 顶到净空线上）。
  // 2026-09-20：0.55 → 0.3 —— 短笺用 0.55 会被推到带子正中，上下各留一个 ~9mm 的洞
  //（真机打印图里就是"非常多的留白"）；0.3 让余量集中成署名上方的一块下边距。
  bodyWeight: 0.3,
  bodyTop: Math.round(19 * 11.811),                     // 正文带顶（无题记时用）—— **必须 < signTop**
  sigOffset: Math.round(5 * 11.811),                    // 署名基线相对 footerTop（向上）—— 2026-09-19：14→5mm，署名下移到印章正上方（同时把竖向余量还给正文）
  dateOffset: Math.round(1.5 * 11.811),                  // 日期基线相对 footerTop（向上）—— 2026-09-19：10.2→1.5mm（**必须小于 sigOffset** 才在署名之下）
  underlineGap: Math.round(1.5 * 11.811),               // 署名下划线在基线下
  sigMaxW: Math.round(23 * 11.811),                     // 署名下划线**限宽**（不得越到印章区）
  sigBaseSize: 42,                                      // 署名基准字号（超宽按宽度等比缩，不裁字）
  sigMinSize: 30,
  // 页脚带顶：白区**下 1/5** → 75mm × 0.8 = 60mm。
  // 2026-09-20 白区从 69mm 改 75mm（1:1）时**必须一起改**：这组纵坐标全是绝对 mm，
  // 不动它就会出现"内容全挤在上 69mm、底下留 6mm 空白"（守卫不变式⑤d/e 会当场判红）。
  footerTop: Math.round(60 * 11.811),
  qrSize: Math.round(13 * 11.811),                      // 每枚码的边长（白区纵向 75mm 是硬上限：码+小字+纸底 6~16px 余量一起复算，见不变式⑤d）
  qrGap: Math.round(5 * 11.811),                        // 两枚码间距
  // 码块整体**上提**：白区 75mm 的纵向余量只剩 23px（码底 863 → 纸底 886），
  // 放不下"码下小字 + 兜底文案"两行。上提不会撞到右侧署名/日期 ——
  // 码右缘 ≤ stampLeft−2mm = 543，而署名下划线左端 ≥ axisRight − sigMaxW = 847−271 = 576，
  // 两者**横向不相交**（守卫「码块与署名带包围盒不相交」钉住这一点）。
  qrLift: Math.round(3.5 * 11.811),
  // 码下小字基线偏移。2026-09-20 产品负责人「适当加大文字与二维码之间间距」：1.4 → **2.0mm**
  qrCaptionOffset: Math.round(2.0 * 11.811),
  qrCaptionSize: 24,                                    // 码下小字（2026-09-19：18→21px，1.52mm→1.78mm —— 热敏 1.5mm 易糊）
  qrHintSize: 21,                                       // 兜底文案（21px = 1.78mm，与码下小字同档，压在热敏 1.5mm 糊线之上）
  qrHintOffset: Math.round(2.4 * 11.811),               // 兜底文案相对码下小字的基线偏移
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
  // 贴纸（1:1 的 886×886）与 A6 比例不同 —— **不是缩放问题而是版式问题**（蓝图 §3），
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
  // 手写体：**必须先写已注册的网络字体族 `ShanhaiHand`**，系统栈只作兜底。
  // ⚠️ 2026-09-20 产品负责人真机反馈「礼笺的字体输出不是礼赠页面的手写体」——
  //   根因就在这里：页面（compose 的 .card-write-text/.card-note-display）用的是
  //   `'ShanhaiHand', "HanziPen SC", …`，而 canvas 这边只有系统栈；iOS 的 WeChat WebView
  //   **不向网页暴露** 汉仪手写/签笔这些中文族（见 utils/handFont.js 的实测记录），
  //   于是导出图一律落回系统 default —— 同一段字，屏幕上是手写体、打出来不是。
  //   `wx.loadFontFace({global:true, scopes:['webview','native']})` 注册的自定义族名
  //   对 canvas 同样有效，前提是 `ctx.font` 里写的是**它**。
  const HAND = '"ShanhaiHand", "HanziPen SC", "Hannotate SC", "STKaiti", "Kaiti SC", "KaiTi", serif'

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
  if (o.qrcodeImage) codes.push({ img: o.qrcodeImage, caption: PRINT_QR_COPY.miniprogram, size: Math.round(15 * MM) })
  if (o.serviceQrImage) codes.push({ img: o.serviceQrImage, caption: PRINT_QR_COPY.service, size: Math.round(15 * MM) })
  // 右边界贴内框内侧 4mm（此前误用文字轴 axisRight，等于把左内边距算两次 → 离纸边 24mm ✗）
  const qrRight = cardX + cardW - Math.round(4 * MM)
  let cx = qrRight
  let captionBase = 0
  let blockL = qrRight
  for (let i = 0; i < codes.length; i += 1) {
    const c = codes[i]
    const x = cx - c.size
    const y = footerTop + Math.round(2 * MM)
    // 码已是**透明 PNG**（白底已抠掉）→ 不再画白色底托，让码直接落在米白卡面上
    try { ctx.drawImage(c.img, x, y, c.size, c.size) } catch (e) { /* 码挂跳过 */ }
    ctx.fillStyle = '#8A7530'
    ctx.font = '400 20px serif'
    ctx.textAlign = 'center'
    captionBase = y + c.size + Math.round(6 * MM)
    ctx.fillText(c.caption, x + c.size / 2, captionBase)
    blockL = Math.min(blockL, x)
    cx = x - Math.round(6 * MM)
  }
  // 兜底文案：与码块同一条中轴（A6 的页脚带 30mm 富余，横向空间充足，不需要缩字）
  if (codes.length) {
    // 字号与贴纸同源（STICKER.qrHintSize）：A6 原写 20px，热敏模拟里只剩 8% 墨点 —— 抖没了。
    // 兜底文案的**全部价值**就是"码扫不出时还能读"，读不清等于没印。
    ctx.fillStyle = '#8A7530'
    ctx.font = '400 ' + STICKER.qrHintSize + 'px serif'
    ctx.textAlign = 'center'
    ctx.fillText(PRINT_QR_COPY.hint, Math.round((blockL + qrRight) / 2), captionBase + STICKER.qrHintOffset)
  }
  ctx.textAlign = 'left'

ctx.textAlign = 'left'
}

/* ─────────────────────────────────────────────────────────────────────────
 * 热敏不干胶贴纸版（白区 75×75mm @300dpi = 886×886，1:1）
 *
 * **这是重排版式，不是 A6 的缩放**（蓝图 §3：A6 1:1.41 vs 可打印区 1:0.92 ⇒ 放不进）：
 *   A6 = 瘦高卡，纵向富裕；贴纸 = 正方形（75mm）⇒ 四个带（题记/正文/署名/页脚）必须重分。
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
  // 手写体：与 A6 **完全同一套栈**（含已注册的 ShanhaiHand）—— 改这里必须同时改 A6 那处。
  // 为什么两处都得带 ShanhaiHand：见 A6 分支上面那段（iOS 不暴露中文手写族，只有网络字体有效）。
  const HAND = '"ShanhaiHand", "HanziPen SC", "Hannotate SC", "STKaiti", "Kaiti SC", "KaiTi", serif'

  // 禁止落墨的**右下预印印章区**（x ≥ stampLeft 且 y ≥ stampTop）
  const stampRight = cardX + cardW - STICKER.stampRightPad
  const stampLeft = stampRight - STICKER.stampSize
  const stampTop = STICKER.footerTop + STICKER.stampTopPad

  // ── 顶行：写给 · TA（左上）
  const toName = String(o.recipientName || '').trim()
  ctx.textAlign = 'left'
  if (toName) {
    ctx.fillStyle = '#8A7530'
    // 2026-09-19 字号：26→28px（**受礼人**姓名是对方第一眼要看的信息）
    ctx.font = '400 32px serif'
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
    // 2026-09-20 字号放大（真机打印图反馈「非常多留白」）：32→40px，与正文 46px 成层级
    ctx.font = '600 40px serif'
    ctx.fillText(bandTheme, axisX + innerPad, y + STICKER.bandBasePad)
    ctx.fillStyle = '#6A6258'
    // 2026-09-20 字号放大：25→30px（与 40px 主题名成 0.75 层级，两行注在热敏纸上才读得清）
    ctx.font = '400 30px serif'
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
  // 2026-09-20 真机打印图反馈「最多的是留白、字偏小」→ 正文基准 34→**46px**（≈3.9mm），
  // 缩字下限 22→**30px**（再小在热敏纸上就糊了）。「永不截断」的机制不变（缩字 → 压行距）。
  let fontPx = 46
  let lineH = Math.round(46 * 1.62)
  ctx.fillStyle = '#2B2723'
  ctx.font = '400 ' + fontPx + 'px ' + HAND
  let bodyLines = wrapLines(ctx, text, axisRight - axisX, 999)
  let bodyDrawn = 0
  // **永不截断**：先逐档缩小字号（下限 22px），仍放不下再**压缩行距**（最终打包）。
  //   为什么必须有"压缩行距"这一步（2026-09-19 实测）：只缩字号会在 34px→22px 的
  //   **换行点跳变**上提前放弃 —— 实测容量一度低到 52 字就整块不画（信文凭空消失，比截断更糟）。
  //   压缩行距时按「行数 × 行距 ≤ 可用高」反解行距，保证**全部行都放得下**。
  const sigClear = () => Math.round(fontPx * 0.85)
  const bodyFloor = () => STICKER.footerTop - STICKER.sigOffset - sigClear()
  const bodyRoom = () => bodyFloor() - bodyTop
  // 与落墨预检**同一条判据**（原来这里多给了一个 `lineH` 的松弛，导致"判它装得下、实际落墨越线"）
  const fits = () => bodyLines.length * lineH <= bodyRoom() && bodyLines.length * lineH <= availH
  while (fontPx > 30 && !fits()) {
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
  // ⚠️ 2026-09-20 真机预览抓到"正文被截断"：预检用的是「总高 ≤ 带宽 + 一个行高」，
  //   而实际落墨位置还要**加一段偏移**（权重 × 余量）—— 于是"总高够"但"偏移之后末行越线"，
  //   循环里那个 `break` 就把**后半段正文丢掉了**（前几行已经画上去了）。
  //   部分落墨比整块不画更坏：读者以为信就写到这里。现在把不变量前移到**定位**这一步。
  if (availH > 0 && bodyLines.length * lineH <= bodyRoom()) {
    // 正文块定位：在整个正文带（题记带下沿 → 署名净空线）里**加权居中**，权重 0.55（略偏下；0.75 会把正文推得离署名太近，守卫里已实测）。
    //   ⚠ 2026-09-20 真图反馈「排版偏上、下部发虚」的根因就在这里：
    //   原先是 `Math.min(availH, bodyRoom())` 当作可用高 —— 短笺时它会**把块顶顶到净空线上**
    //   （正文末行紧贴署名、而题记带下方留 14.5mm 空档），于是整块看起来"贴在下半部之上、重心偏上"。
    //   改成用真实 `availH` 分配余量：短笺上下各留约 7~8mm 相等的留白，长笺才靠净空线收口。
    const blockH = bodyLines.length * lineH
    // 想要的偏移（贴着题记带起排，余量留到署名上方）；再按"末行不得越过净空线"夹一次。
    // 夹完仍是"整块落墨"——**循环里不再有 break**，进得来就一定画得完。
    const wantOffset = Math.max(0, Math.round((availH - blockH) * STICKER.bodyWeight))
    const maxOffset = Math.max(0, bodyRoom() - blockH)
    const blockTop = bodyTop + Math.min(wantOffset, maxOffset)
    const bodyY = blockTop + lineH
    for (let i = 0; i < bodyLines.length; i += 1) {
      ctx.fillText(bodyLines[i], axisX, bodyY + i * lineH)
      bodyDrawn += 1
    }
  }
  if (text.trim() && bodyDrawn < bodyLines.length) {
    console.warn('giftSticker: 正文只画了 ' + bodyDrawn + '/' + bodyLines.length + ' 行（版面高度不足）—— 这是真图事故形态，必须修 STICKER 表')
  }

  // ── 署名带（**右对齐，落在预印印章的正上方**）
  // 2026-09-19 产品要求「署名与两枚码都靠右下」：署名从"左半区"改为**右对齐**。
  //   约束随之改变：不再是"不超过印章左缘"（那是左对齐时的写法），而是
  //   ① 右端对齐内容右缘 axisRight；② 基线 + 下划线必须**高于印章上缘**（下面 stampTop 断言）。
  const sigBaseY = STICKER.footerTop - STICKER.sigOffset
  const sig = String(o.cardSignature || '').trim()
  const sigMaxW = Math.max(Math.round(10 * MM), axisRight - axisX - Math.round(2 * MM))
  if (sig) {
    ctx.textAlign = 'right'
    ctx.fillStyle = '#2B2723'
    let sigFont = STICKER.sigBaseSize
    let sigText = sig
    ctx.font = '500 ' + sigFont + 'px ' + HAND
    // 近方形下署名带浅 → 按可用宽度**等比缩字**；到下限仍超宽才截断（宁可小，不可越界/裁字）
    if (ctx.measureText(sigText).width > sigMaxW) {
      sigFont = Math.max(STICKER.sigMinSize, Math.floor(sigFont * sigMaxW / ctx.measureText(sigText).width))
      ctx.font = '500 ' + sigFont + 'px ' + HAND
      while (ctx.measureText(sigText).width > sigMaxW && sigText.length > 2) {
        sigText = truncate(sigText, sigText.length - 1)
      }
    }
    ctx.fillText(sigText, axisRight, sigBaseY)
    const sw = ctx.measureText(sigText).width
    ctx.strokeStyle = 'rgba(196, 167, 108, 0.6)'
    ctx.lineWidth = 2
    // 下划线**右端对齐**内容右缘、长度随署名（保底 9mm），并限宽不越版心
    const underlineW = Math.min(Math.max(sw, Math.round(9 * MM)), sigMaxW)
    ctx.beginPath()
    ctx.moveTo(axisRight - Math.max(1, underlineW), sigBaseY + STICKER.underlineGap)
    ctx.lineTo(axisRight, sigBaseY + STICKER.underlineGap)
    ctx.stroke()
  }
  const d = new Date()
  const dateText = d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0')
  // 日期与署名**同一条右对齐轴**（在署名之下）
  ctx.textAlign = 'right'
  ctx.fillStyle = '#B4AC9F'
  // 2026-09-19 字号：20→22px（日期需与署名前后的层级拉开但仍清楚）
  ctx.font = '400 22px serif'
  ctx.fillText(dateText, axisRight, STICKER.footerTop - STICKER.dateOffset)

  // ── 页脚带（**两枚码居中在「左文字轴 ~ 印章左缘」之间**）
  // 2026-09-20 真图反馈「两枚码右侧到边框之间还有空白」：原先是**左对齐**铺开（码右缘离印章区 14.2mm），
  //   右对齐又会把码推到印章正下方（印章是直径 24mm 的圆，圆的**底部**左右两侧仍有白），故取**居中**：
  //   两侧留白均等、不与印章相交，同时把码放大到 14mm 提高扫码率（白区纵向 75mm 的硬上限，见不变式⑤d）。
  const codes = []
  if (o.qrcodeImage) codes.push({ img: o.qrcodeImage, caption: PRINT_QR_COPY.miniprogram })
  if (o.serviceQrImage) codes.push({ img: o.serviceQrImage, caption: PRINT_QR_COPY.service })
  // 右端上限：印章左缘再让 2mm（不得进印章区），同时不越页脚右内缩
  const qrRight = Math.min(stampLeft - Math.round(2 * MM), cardX + cardW - STICKER.qrRightPad)
  const qrTotalW = codes.length * STICKER.qrSize + Math.max(0, codes.length - 1) * STICKER.qrGap
  // 居中：可放区间 [axisX, qrRight]，两侧各留 (zone - qrTotalW)/2
  const qrZone = qrRight - axisX
  const qrTop = STICKER.footerTop - STICKER.qrLift
  const captionBase = qrTop + STICKER.qrSize + STICKER.qrCaptionOffset
  let cx = Math.max(axisX, axisX + Math.round((qrZone - qrTotalW) / 2))
  for (let i = 0; i < codes.length; i += 1) {
    const c = codes[i]
    const x = Math.min(cx, qrRight - STICKER.qrSize)
    // 码已是**透明 PNG** → 不画白色底托
    try { ctx.drawImage(c.img, x, qrTop, STICKER.qrSize, STICKER.qrSize) } catch (e) { /* 码挂跳过 */ }
    ctx.fillStyle = '#8A7530'
    ctx.font = '400 ' + STICKER.qrCaptionSize + 'px serif'
    ctx.textAlign = 'center'
    ctx.fillText(c.caption, x + STICKER.qrSize / 2, captionBase)
    cx = x + STICKER.qrSize + STICKER.qrGap
  }
  // 兜底文案：与码块**同一条中轴**（码块在 [axisX, qrRight] 内居中 ⇒ 中轴 = axisX + qrZone/2）。
  // 太长就缩字（同署名的做法）—— 缩到下限还放不下才告警，绝不越进印章区。
  if (codes.length) {
    let hintFont = STICKER.qrHintSize
    ctx.font = '400 ' + hintFont + 'px serif'
    while (hintFont > 16 && ctx.measureText(PRINT_QR_COPY.hint).width > qrZone) {
      hintFont -= 1
      ctx.font = '400 ' + hintFont + 'px serif'
    }
    if (hintFont <= 16) console.warn('giftSticker: 兜底文案放不下（' + PRINT_QR_COPY.hint + '）—— 需要缩短文案或调整 STICKER 表')
    ctx.fillStyle = '#8A7530'
    ctx.textAlign = 'center'
    ctx.fillText(PRINT_QR_COPY.hint, axisX + Math.round(qrZone / 2), captionBase + STICKER.qrHintOffset)
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
          // 手写体是**异步**注册的（wx.loadFontFace 网络字体，3MB）：
          // 不等它就画，canvas 会先把字排成兜底字体再缓存 —— 屏幕上/导出图都变回系统字体。
          // 所以导出前显式等一次（`ensureHandFont` 幂等 + 并发合并，已加载时立即 resolve）。
          try {
            const { ensureHandFont } = require('./handFont')
            await ensureHandFont()
          } catch (e) { /* 加载失败按兜底字体出图，不阻断导出 */ }
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
              // 'a6'（默认，行为零改动）| 'sticker'（热敏不干胶，可打印白区 75×75mm 1:1）
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
