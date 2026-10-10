/**
 * 商品知识卡（博物知识卡）：排版纯函数 + Canvas 2D 绘制
 *
 * 详情页 renderKnowledgeCard 与本地出图脚本（miniprogram/scripts/render-knowledge-card.mjs）共用这一份；
 * 排版只依赖 measure(text, font) → 像素宽，所以能在 node 里用假度量跑测试（test:knowledge-card）。
 * 画布尺寸固定 750 × 1200（与 index.wxss 的 .poster-canvas、保存/分享流程一致）。
 */

const CARD_W = 750
const CARD_H = 1200

const PALETTE = {
  paper: '#F4EFE3',
  mat: '#FBF8F1',
  ink: '#2A2621',
  inkSoft: '#4B443B',
  muted: '#80766A',
  accent: '#8C3D2B',
  rule: 'rgba(42, 38, 33, 0.30)',
  ruleSoft: 'rgba(42, 38, 33, 0.14)'
}

const SERIF = '"Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", serif'
const LATIN_SERIF = 'Georgia, "Times New Roman", serif'

const CAPTION_SIZES = [28, 27, 26, 25, 24]
const CAPTION_LINE_RATIO = 1.62
const TITLE_SIZES = [54, 50, 46, 42, 38]
const LATIN_SIZES = [28, 26, 24, 22]

const SENTENCE_END = '。！？!?；;'
const CLAUSE_END = '，,：:'
const OPENERS = '（(《「『【〔“‘'
const CLOSERS = '）)》」』】〕”’'
/** 不可出现在行首的标点（避头）：遇到时悬挂在上一行行尾 */
const NO_LINE_START = '，。、；：！？）》」』】〕”’,.;:!?)…—～%·'
/** 不可出现在行尾的标点（避尾）：遇到时带到下一行 */
const NO_LINE_END = OPENERS

function fontOf(size, opts) {
  const o = opts || {}
  return [o.style && o.style !== 'normal' ? o.style : '', o.weight && o.weight !== 'normal' ? o.weight : '', `${size}px`, o.family || SERIF]
    .filter(Boolean)
    .join(' ')
}

function normalizeCardText(text) {
  return String(text == null ? '' : text)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+(?=[\u3000-\u303f\uff00-\uffef])/g, '')
    .replace(/([\u3000-\u303f\uff00-\uffef])\s+/g, '$1')
    .replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1')
    .trim()
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 简介开头常是「名称（学名）是……」：标题区已经写了名称和学名，卡面上去掉括号里重复的学名
 * （括号里还有别名就留别名，括号空了整对去掉）；开头「名称：」「名称，」也去掉。
 */
function stripTitleEcho(text, title, latin) {
  let t = normalizeCardText(text)
  if (!t) return ''
  const lat = String(latin || '').trim()
  const binomial = lat.split(/\s+/).slice(0, 2).join(' ')
  const forms = [lat, binomial].filter((v, i, arr) => v.length >= 3 && arr.indexOf(v) === i)
  for (let i = 0; i < forms.length; i += 1) {
    const latRe = escapeRe(forms[i]).replace(/\s+/g, '\\s*')
    const re = new RegExp(`[（(]([^（）()]*?)${latRe}([^（）()]*?)[）)]`, 'i')
    const m = re.exec(t)
    if (m && m.index <= 40) {
      const rest = `${m[1]} ${m[2]}`.replace(/^[\s,，、;；:：]+|[\s,，、;；:：]+$/g, '').trim()
      t = t.slice(0, m.index) + (rest ? `（${rest}）` : '') + t.slice(m.index + m[0].length)
      break
    }
  }
  const ttl = String(title || '').trim()
  if (ttl && t.startsWith(ttl) && /^[：:，,]/.test(t.slice(ttl.length))) {
    t = t.slice(ttl.length).replace(/^[：:，,\s]+/, '')
  }
  return normalizeCardText(t)
}

function firstOf(list) {
  return Array.isArray(list) && list.length ? list[0] : ''
}

/** 简介来源：先取商品已有的短简介/卖点，没有再用完整长描述（由 fitCaption 按句收尾） */
function pickCaptionSource(product, remote) {
  const p = product || {}
  const r = remote || {}
  const short = [p.subtitle, p.sellingPoint, p.slogan, p.highlight, firstOf(p.sellingPoints), firstOf(p.highlights), r.brief, p.brief]
    .map(normalizeCardText)
    .find(Boolean)
  if (short) return short
  const long = [r.description, p.description]
    .map(normalizeCardText)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0]
  if (long) return long
  return [r.cardCaption, r.shareText, p.shareText].map(normalizeCardText).find(Boolean) || ''
}

const LATIN_CHAR = /[A-Za-z0-9\u00C0-\u024F'’\-.%°]/

/** 拆成排版单元：连续拉丁字母/数字为一个词（不可拆），空白为 ' '，其余逐字 */
function tokenize(text) {
  const s = String(text || '')
  const out = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (/\s/.test(ch)) {
      while (i < s.length && /\s/.test(s[i])) i += 1
      out.push(' ')
      continue
    }
    if (LATIN_CHAR.test(ch)) {
      let j = i
      while (j < s.length && LATIN_CHAR.test(s[j])) j += 1
      out.push(s.slice(i, j))
      i = j
      continue
    }
    const cp = s.codePointAt(i)
    const len = cp > 0xffff ? 2 : 1
    out.push(s.slice(i, i + len))
    i += len
  }
  return out
}

/**
 * 按实际字宽折行。英文按词折行（词不拆开，除非单个词比整行还宽）；
 * 行首不出现「，。）」等（悬挂到上一行），行尾不留「（《」等（带到下一行）。
 */
function wrapText(text, maxWidth, measure) {
  const tokens = tokenize(text)
  const lines = []
  let cur = ''
  for (let k = 0; k < tokens.length; k += 1) {
    const tok = tokens[k]
    if (tok === ' ') {
      if (cur) cur += ' '
      continue
    }
    const candidate = cur + tok
    if (!cur.trim() || measure(candidate.trimEnd()) <= maxWidth) {
      if (!cur.trim() && tok.length > 1 && measure(tok) > maxWidth) {
        let piece = ''
        for (const ch of tok) {
          if (piece && measure(piece + ch) > maxWidth) {
            lines.push(piece)
            piece = ch
          } else piece += ch
        }
        cur = piece
      } else {
        cur = candidate
      }
      continue
    }
    if (NO_LINE_START.includes(tok)) {
      cur = candidate
      continue
    }
    let head = cur.trimEnd()
    let carry = ''
    while (head.length > 1 && NO_LINE_END.includes(head[head.length - 1])) {
      carry = head[head.length - 1] + carry
      head = head.slice(0, -1)
    }
    lines.push(head)
    cur = carry + tok
  }
  if (cur.trim()) lines.push(cur.trimEnd())
  return lines
}

/** 可收尾的位置：句末（。！？；）与分句（，：），括号内部不算 */
function breakCandidates(text) {
  const out = []
  let depth = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (OPENERS.includes(ch)) depth += 1
    else if (CLOSERS.includes(ch)) depth = Math.max(0, depth - 1)
    if (depth > 0) continue
    if (SENTENCE_END.includes(ch)) out.push({ end: i + 1, kind: 'sentence' })
    else if (ch === '.' && !/\d/.test(text[i - 1] || '') && (i + 1 >= text.length || /\s/.test(text[i + 1]))) {
      out.push({ end: i + 1, kind: 'sentence' })
    } else if (CLAUSE_END.includes(ch)) out.push({ end: i + 1, kind: 'clause' })
  }
  return out
}

function closeSentence(s) {
  return s.replace(/[；;]$/, '。')
}

/**
 * 简介自适应：先整段试各档字号（大 → 小），放得下就整段展示；
 * 最小字号仍放不下时在句末收尾（必要时在逗号处收尾并加「…」），绝不在半句中间切。
 * 返回 { text, lines, size, lineHeight, truncated, cut: 'none'|'sentence'|'clause'|'word' }
 */
function fitCaption(text, opts) {
  const { maxWidth, maxHeight, measure } = opts
  const sizes = opts.sizes || CAPTION_SIZES
  const ratio = opts.lineRatio || CAPTION_LINE_RATIO
  const t = normalizeCardText(text)
  const empty = { text: '', lines: [], size: sizes[0], lineHeight: Math.round(sizes[0] * ratio), truncated: false, cut: 'none' }
  if (!t) return empty
  for (let i = 0; i < sizes.length; i += 1) {
    const size = sizes[i]
    const lh = Math.round(size * ratio)
    const f = fontOf(size)
    const lines = wrapText(t, maxWidth, (s) => measure(s, f))
    if (lines.length * lh <= maxHeight) return { text: t, lines, size, lineHeight: lh, truncated: false, cut: 'none' }
  }
  const size = sizes[sizes.length - 1]
  const lh = Math.round(size * ratio)
  const f = fontOf(size)
  const m = (s) => measure(s, f)
  const maxLines = Math.floor(maxHeight / lh)
  if (maxLines < 1) return { ...empty, size, lineHeight: lh, truncated: true }
  const fits = (s) => wrapText(s, maxWidth, m).length <= maxLines

  let bestS = ''
  let bestC = ''
  breakCandidates(t).forEach((c) => {
    if (c.kind === 'sentence') {
      const s = closeSentence(t.slice(0, c.end))
      if (s.length > bestS.length && fits(s)) bestS = s
    } else {
      const s = `${t.slice(0, c.end - 1)}…`
      if (s.length > bestC.length && fits(s)) bestC = s
    }
  })
  let chosen = ''
  let cut = 'none'
  if (bestS && (!bestC || bestS.length >= bestC.length * 0.6)) {
    chosen = bestS
    cut = 'sentence'
  } else if (bestC) {
    chosen = bestC
    cut = 'clause'
  } else {
    const tokens = tokenize(t)
    for (let n = tokens.length - 1; n > 0; n -= 1) {
      const s = `${tokens.slice(0, n).join('').replace(/[\s，,、；;：:（(]+$/, '')}…`
      if (fits(s)) {
        chosen = s
        break
      }
    }
    cut = 'word'
  }
  return { text: chosen, lines: chosen ? wrapText(chosen, maxWidth, m) : [], size, lineHeight: lh, truncated: true, cut }
}

/** 单行/两行的标题类文本：逐档缩字号，最小档仍超过 maxLines 时在词边界收尾加「…」 */
function fitShort(text, opts) {
  const { maxWidth, measure, sizes, maxLines, fontOpts, lineRatio } = opts
  const t = normalizeCardText(text)
  if (!t) return { lines: [], size: sizes[0], lineHeight: 0, font: fontOf(sizes[0], fontOpts) }
  for (let i = 0; i < sizes.length; i += 1) {
    const f = fontOf(sizes[i], fontOpts)
    const lines = wrapText(t, maxWidth, (s) => measure(s, f))
    const limit = i === sizes.length - 1 ? maxLines : Math.min(maxLines, i < 2 ? 1 : maxLines)
    if (lines.length <= limit) return { lines, size: sizes[i], lineHeight: Math.round(sizes[i] * lineRatio), font: f }
  }
  const size = sizes[sizes.length - 1]
  const f = fontOf(size, fontOpts)
  const m = (s) => measure(s, f)
  const tokens = tokenize(t)
  for (let n = tokens.length - 1; n > 0; n -= 1) {
    const s = `${tokens.slice(0, n).join('').trimEnd()}…`
    const lines = wrapText(s, maxWidth, m)
    if (lines.length <= maxLines) return { lines, size, lineHeight: Math.round(size * lineRatio), font: f }
  }
  return { lines: [t.slice(0, 1)], size, lineHeight: Math.round(size * lineRatio), font: f }
}

function isBlankMeta(v) {
  const s = String(v == null ? '' : v).trim()
  return !s || s === '—' || s === '-' || s === '暂无' || s === '未知'
}

function buildTaxonomyLine(taxonomy) {
  const tx = taxonomy || {}
  return ['class', 'order', 'family', 'genus']
    .map((k) => String(tx[k] || '').trim())
    .filter((v) => !isBlankMeta(v))
}

function cardSerial(productId) {
  const id = String(productId || '').replace(/[^0-9A-Za-z]/g, '')
  return id ? `No. ${id.slice(-6).toUpperCase()}` : ''
}

/* ── 版面网格 ── */
const G = {
  frameOuter: 22,
  frameInner: 30,
  left: 64,
  right: CARD_W - 64,
  headerBaseline: 80,
  headerSubBaseline: 106,
  headerRule: 122,
  contentTop: 140,
  footerRule: 972,
  captionBottomGap: 26,
  matPadTop: 16,
  matPadBottom: 34,
  matToInfo: 30,
  imgMin: 360,
  imgMax: 480,
  windowMaxW: CARD_W - 64 * 2 - 32,
  windowMinW: 360,
  qr: 128,
  stampPad: 10
}

/**
 * 整张卡的版面（纯函数）：给出每段文字的字体/坐标/行，以及图片窗、邮票框的位置。
 * assets：{ title, latinName, category, taxonomy, origin, caption, productId, brand, brandEn, tagline, hasQr }
 * imageAspect：原图 高/宽（无图传 0）
 */
function layoutKnowledgeCard(assets, measure, imageAspect) {
  const a = assets || {}
  const textW = G.right - G.left
  const title = normalizeCardText(a.title) || '藏品'
  const latin = normalizeCardText(a.latinName)
  const category = normalizeCardText(a.category)
  const taxo = buildTaxonomyLine(a.taxonomy)
  const origin = isBlankMeta(a.origin) ? '' : normalizeCardText(a.origin)
  const caption = stripTitleEcho(a.caption, title, latin)

  /* 信息区固定部分（不含简介） */
  const info = []
  let fixedH = 0
  if (category) {
    info.push({ kind: 'overline', text: category, font: fontOf(20, { family: SERIF }), spacing: 3, h: 34 })
    fixedH += 34
  }
  const t = fitShort(title, { maxWidth: textW, measure, sizes: TITLE_SIZES, maxLines: 2, fontOpts: { weight: 'bold' }, lineRatio: 1.2 })
  info.push({ kind: 'title', ...t, h: t.lines.length * t.lineHeight })
  fixedH += t.lines.length * t.lineHeight
  if (latin) {
    const l = fitShort(latin, { maxWidth: textW, measure, sizes: LATIN_SIZES, maxLines: 2, fontOpts: { style: 'italic', family: LATIN_SERIF }, lineRatio: 1.32 })
    const h = 6 + l.lines.length * l.lineHeight
    info.push({ kind: 'latin', ...l, h })
    fixedH += h
  }
  const metaFont = fontOf(20)
  const metaLabelFont = fontOf(18)
  const metaItems = []
  if (taxo.length >= 2 || (taxo.length === 1 && taxo[0] !== category)) {
    let chain = taxo.join(' · ')
    let parts = taxo.slice()
    while (parts.length > 2 && measure(chain, metaFont) > textW - 60) {
      parts = parts.slice(1)
      chain = parts.join(' · ')
    }
    metaItems.push({ label: '分类', value: chain })
  }
  if (origin) metaItems.push({ label: '产地', value: origin })
  if (metaItems.length) {
    const rows = []
    let row = []
    let rowW = 0
    metaItems.forEach((it) => {
      const w = measure(it.label, metaLabelFont) + 12 + measure(it.value, metaFont)
      if (row.length && rowW + 40 + w > textW) {
        rows.push(row)
        row = []
        rowW = 0
      }
      row.push({ ...it, w })
      rowW += (row.length > 1 ? 40 : 0) + w
    })
    if (row.length) rows.push(row)
    const h = 14 + rows.length * 34
    info.push({ kind: 'meta', rows, font: metaFont, labelFont: metaLabelFont, h })
    fixedH += h
  }
  const ruleH = caption ? 46 : 0
  fixedH += ruleH

  /* 图片窗高度：简介按最大字号整段排下所需的高度先留出来，图片吃剩下的（夹在上下限之间） */
  const regionH = G.footerRule - G.captionBottomGap - G.contentTop
  const matOverhead = G.matPadTop + G.matPadBottom + G.matToInfo
  const capFull = caption
    ? wrapText(caption, textW, (s) => measure(s, fontOf(CAPTION_SIZES[0]))).length * Math.round(CAPTION_SIZES[0] * CAPTION_LINE_RATIO)
    : 0
  const aspect = imageAspect > 0 ? imageAspect : 0.75
  const imgCap = Math.min(G.imgMax, aspect < 1 ? Math.max(G.imgMin, G.windowMaxW * aspect) : G.imgMax)
  let imgH = Math.round(Math.max(G.imgMin, Math.min(imgCap, regionH - matOverhead - fixedH - capFull)))

  const capRoom = regionH - matOverhead - imgH - fixedH
  const cap = caption
    ? fitCaption(caption, { maxWidth: textW, maxHeight: capRoom, measure })
    : fitCaption('', { maxWidth: textW, maxHeight: 0, measure })
  const capH = cap.lines.length * cap.lineHeight
  /* 按句收尾后剩下的高度还给图片，避免简介下方留一截空白 */
  if (capRoom - capH > 0 && imgH < imgCap) imgH = Math.round(Math.min(imgCap, imgH + capRoom - capH))
  const winW = Math.round(Math.max(G.windowMinW, Math.min(G.windowMaxW, imgH / aspect)))
  const used = matOverhead + imgH + fixedH + capH
  const slack = Math.max(0, regionH - used)
  let y = G.contentTop + Math.round(slack / 2)

  const mat = { x: G.left, y, w: G.right - G.left, h: G.matPadTop + imgH + G.matPadBottom }
  const win = { x: Math.round(CARD_W / 2 - winW / 2), y: y + G.matPadTop, w: winW, h: imgH }
  y = mat.y + mat.h + G.matToInfo

  const blocks = []
  info.forEach((b) => {
    if (b.kind === 'overline') {
      blocks.push({ kind: 'text', text: b.text, font: b.font, color: PALETTE.accent, x: G.left, y: y + 20, spacing: b.spacing })
    } else if (b.kind === 'title' || b.kind === 'latin') {
      const top = b.kind === 'latin' ? y + 6 : y
      b.lines.forEach((ln, i) => {
        blocks.push({
          kind: 'text',
          role: b.kind,
          text: ln,
          font: b.font,
          color: b.kind === 'title' ? PALETTE.ink : PALETTE.accent,
          x: G.left,
          y: top + (i + 1) * b.lineHeight - Math.round(b.lineHeight * 0.22)
        })
      })
    } else if (b.kind === 'meta') {
      b.rows.forEach((row, ri) => {
        let x = G.left
        const by = y + 14 + ri * 34 + 24
        row.forEach((it, ii) => {
          if (ii > 0) x += 40
          blocks.push({ kind: 'text', role: 'metaLabel', text: it.label, font: b.labelFont, color: PALETTE.muted, x, y: by })
          const lw = measure(it.label, b.labelFont) + 12
          blocks.push({ kind: 'text', role: 'meta', text: it.value, font: b.font, color: PALETTE.inkSoft, x: x + lw, y: by })
          x += it.w
        })
      })
    }
    y += b.h
  })
  if (caption && cap.lines.length) {
    blocks.push({ kind: 'rule', x: G.left, y: y + 18, w: 72, color: PALETTE.accent, width: 2 })
    blocks.push({ kind: 'rule', x: G.left + 84, y: y + 18, w: textW - 84, color: PALETTE.ruleSoft, width: 1 })
    y += ruleH
    const cf = fontOf(cap.size)
    cap.lines.forEach((ln, i) => {
      blocks.push({ kind: 'text', role: 'caption', text: ln, font: cf, color: PALETTE.inkSoft, x: G.left, y: y + i * cap.lineHeight + Math.round(cap.size * 1.05) })
    })
  }

  const stampSize = G.qr + G.stampPad * 2
  const stamp = a.hasQr === false
    ? null
    : { x: G.right - stampSize, y: G.footerRule + 18, size: stampSize, qr: G.qr, pad: G.stampPad }

  return {
    W: CARD_W,
    H: CARD_H,
    serial: cardSerial(a.productId),
    brand: normalizeCardText(a.brand) || '山海造物',
    brandEn: normalizeCardText(a.brandEn) || "NATURE'S CREATIONS",
    tagline: normalizeCardText(a.tagline) || '把山海带回家',
    mat,
    win,
    blocks,
    caption: cap,
    captionSource: caption,
    stamp,
    slack
  }
}

/* ── 绘制 ── */

function hashSeed(str) {
  let h = 2166136261
  const s = String(str || 'shanhai')
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed) {
  let a = seed >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 纸张：暖白底 + 四周微暗 + 细噪点 + 少量纤维（程序生成，不占素材体积） */
function paintPaper(ctx, W, H, rand) {
  ctx.fillStyle = PALETTE.paper
  ctx.fillRect(0, 0, W, H)
  const g = ctx.createRadialGradient(W / 2, H * 0.42, W * 0.2, W / 2, H / 2, H * 0.78)
  g.addColorStop(0, 'rgba(255, 253, 247, 0.55)')
  g.addColorStop(1, 'rgba(120, 96, 60, 0.10)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  for (let i = 0; i < 7000; i += 1) {
    const x = rand() * W
    const y = rand() * H
    const dark = rand() < 0.62
    ctx.fillStyle = dark ? `rgba(92, 72, 44, ${(0.025 + rand() * 0.05).toFixed(3)})` : `rgba(255, 255, 250, ${(0.12 + rand() * 0.2).toFixed(3)})`
    const s = rand() < 0.86 ? 1 : 2
    ctx.fillRect(x, y, s, s)
  }
  ctx.lineWidth = 0.6
  for (let i = 0; i < 70; i += 1) {
    const x = rand() * W
    const y = rand() * H
    const len = 8 + rand() * 22
    const ang = rand() * Math.PI
    ctx.strokeStyle = `rgba(110, 86, 52, ${(0.05 + rand() * 0.06).toFixed(3)})`
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + Math.cos(ang) * len * 0.5 + (rand() - 0.5) * 6, y + Math.sin(ang) * len * 0.5 + (rand() - 0.5) * 6, x + Math.cos(ang) * len, y + Math.sin(ang) * len)
    ctx.stroke()
  }
}

function drawSpaced(ctx, text, x, y, spacing, align) {
  const chars = Array.from(String(text || ''))
  let total = 0
  chars.forEach((c, i) => {
    total += ctx.measureText(c).width + (i < chars.length - 1 ? spacing : 0)
  })
  let cx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x
  const prev = ctx.textAlign
  ctx.textAlign = 'left'
  chars.forEach((c) => {
    ctx.fillText(c, cx, y)
    cx += ctx.measureText(c).width + spacing
  })
  ctx.textAlign = prev
}

function hline(ctx, x, y, w, color, width) {
  ctx.fillStyle = color
  ctx.fillRect(x, Math.round(y), w, width || 1)
}

function drawFrame(ctx, W, H) {
  ctx.strokeStyle = 'rgba(42, 38, 33, 0.55)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(G.frameOuter, G.frameOuter, W - G.frameOuter * 2, H - G.frameOuter * 2)
  ctx.strokeStyle = 'rgba(42, 38, 33, 0.22)'
  ctx.lineWidth = 0.8
  ctx.strokeRect(G.frameInner, G.frameInner, W - G.frameInner * 2, H - G.frameInner * 2)
  const c = 16
  const o = G.frameInner + 6
  ctx.strokeStyle = PALETTE.accent
  ctx.lineWidth = 1.5
  ;[[o, o, 1, 1], [W - o, o, -1, 1], [o, H - o, 1, -1], [W - o, H - o, -1, -1]].forEach(([x, y, sx, sy]) => {
    ctx.beginPath()
    ctx.moveTo(x, y + sy * c)
    ctx.lineTo(x, y)
    ctx.lineTo(x + sx * c, y)
    ctx.stroke()
  })
}

function drawImageCover(ctx, img, win) {
  const iw = img.width
  const ih = img.height
  const scale = Math.max(win.w / iw, win.h / ih)
  const sw = win.w / scale
  const sh = win.h / scale
  const sx = (iw - sw) / 2
  const sy = (ih - sh) / 2
  ctx.drawImage(img, sx, sy, sw, sh, win.x, win.y, win.w, win.h)
}

/** 小程序码放在邮票框里：齿孔白边 + 细线内框；码四周留足白边保证可识别 */
function drawStamp(ctx, st, qr) {
  const { x, y, size } = st
  ctx.save()
  ctx.shadowColor = 'rgba(70, 50, 25, 0.16)'
  ctx.shadowBlur = 8
  ctx.shadowOffsetY = 2
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(x, y, size, size)
  ctx.restore()
  ctx.fillStyle = PALETTE.paper
  const r = 3.2
  const step = 11
  for (let p = step / 2; p < size; p += step) {
    ;[[x + p, y], [x + p, y + size], [x, y + p], [x + size, y + p]].forEach(([cx, cy]) => {
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
    })
  }
  ctx.strokeStyle = 'rgba(140, 61, 43, 0.55)'
  ctx.lineWidth = 1
  ctx.strokeRect(x + 5.5, y + 5.5, size - 11, size - 11)
  if (qr) ctx.drawImage(qr, x + st.pad, y + st.pad, st.qr, st.qr)

  const cx = x - 46
  const cy = y + 44
  ctx.strokeStyle = 'rgba(140, 61, 43, 0.42)'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.arc(cx, cy, 30, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.arc(cx, cy, 25, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = 'rgba(140, 61, 43, 0.62)'
  ctx.textAlign = 'center'
  ctx.font = fontOf(15, { weight: 'bold' })
  ctx.fillText('山海', cx, cy - 2)
  ctx.font = fontOf(10, { family: LATIN_SERIF })
  ctx.fillText('SPECIMEN', cx, cy + 13)
  ctx.textAlign = 'left'

  ctx.fillStyle = PALETTE.muted
  ctx.textAlign = 'center'
  ctx.font = fontOf(18)
  drawSpaced(ctx, '扫码查看藏品', x + size / 2, y + size + 26, 2, 'center')
  ctx.textAlign = 'left'
}

/**
 * 画整张卡。image / qr 为已加载的画布图片（可为 null）。
 * 返回 layout（便于调用方记录是否收尾、字号等）。
 */
function drawKnowledgeCard(ctx, assets, images) {
  const imgs = images || {}
  const img = imgs.image && imgs.image.width && imgs.image.height ? imgs.image : null
  const qr = imgs.qr || null
  const cache = {}
  const measure = (text, font) => {
    const k = `${font}|${text}`
    if (cache[k] == null) {
      ctx.font = font
      cache[k] = ctx.measureText(text).width
    }
    return cache[k]
  }
  const L = layoutKnowledgeCard({ ...assets, hasQr: !!qr }, measure, img ? img.height / img.width : 0)
  const W = L.W
  const H = L.H

  paintPaper(ctx, W, H, mulberry32(hashSeed(assets && assets.productId)))
  drawFrame(ctx, W, H)

  /* 页眉 */
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillStyle = PALETTE.ink
  ctx.font = fontOf(24, { weight: 'bold' })
  ctx.fillText(L.brand, G.left, G.headerBaseline)
  const bw = ctx.measureText(L.brand).width
  ctx.fillStyle = PALETTE.inkSoft
  ctx.font = fontOf(22)
  ctx.fillText(' · 博物知识卡', G.left + bw, G.headerBaseline)
  ctx.fillStyle = PALETTE.muted
  ctx.font = fontOf(13, { family: LATIN_SERIF })
  drawSpaced(ctx, 'NATURAL HISTORY CARD', G.left, G.headerSubBaseline, 3.2, 'left')
  if (L.serial) {
    ctx.fillStyle = PALETTE.accent
    ctx.font = fontOf(20, { style: 'italic', family: LATIN_SERIF })
    ctx.textAlign = 'right'
    ctx.fillText(L.serial, G.right, G.headerBaseline)
    ctx.textAlign = 'left'
  }
  hline(ctx, G.left, G.headerRule, G.right - G.left, PALETTE.rule, 1)
  hline(ctx, G.left, G.headerRule + 4, G.right - G.left, PALETTE.ruleSoft, 1)

  /* 衬纸 + 图片窗 */
  const { mat, win } = L
  ctx.save()
  ctx.shadowColor = 'rgba(80, 58, 30, 0.14)'
  ctx.shadowBlur = 14
  ctx.shadowOffsetY = 4
  ctx.fillStyle = PALETTE.mat
  ctx.fillRect(mat.x, mat.y, mat.w, mat.h)
  ctx.restore()
  ctx.strokeStyle = 'rgba(42, 38, 33, 0.12)'
  ctx.lineWidth = 1
  ctx.strokeRect(mat.x + 0.5, mat.y + 0.5, mat.w - 1, mat.h - 1)
  if (img) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(win.x, win.y, win.w, win.h)
    ctx.clip()
    drawImageCover(ctx, img, win)
    ctx.restore()
  } else {
    ctx.fillStyle = '#EDE6D6'
    ctx.fillRect(win.x, win.y, win.w, win.h)
    ctx.fillStyle = PALETTE.muted
    ctx.font = fontOf(26)
    ctx.textAlign = 'center'
    ctx.fillText('暂无藏品图', win.x + win.w / 2, win.y + win.h / 2 + 9)
    ctx.textAlign = 'left'
  }
  ctx.strokeStyle = 'rgba(42, 38, 33, 0.45)'
  ctx.lineWidth = 1
  ctx.strokeRect(win.x - 0.5, win.y - 0.5, win.w + 1, win.h + 1)
  const figY = win.y + win.h + 23
  ctx.fillStyle = PALETTE.muted
  ctx.font = fontOf(12, { family: LATIN_SERIF })
  drawSpaced(ctx, 'SPECIMEN PLATE', mat.x + 18, figY, 2.4, 'left')
  ctx.font = fontOf(14, { style: 'italic', family: LATIN_SERIF })
  ctx.textAlign = 'right'
  ctx.fillText('Fig. 1', mat.x + mat.w - 18, figY)
  ctx.textAlign = 'left'

  /* 信息区 */
  L.blocks.forEach((b) => {
    if (b.kind === 'rule') {
      hline(ctx, b.x, b.y, b.w, b.color, b.width)
      return
    }
    ctx.fillStyle = b.color
    ctx.font = b.font
    if (b.spacing) drawSpaced(ctx, b.text, b.x, b.y, b.spacing, 'left')
    else ctx.fillText(b.text, b.x, b.y)
  })

  /* 页脚：品牌 + 邮票框小程序码 */
  hline(ctx, G.left, G.footerRule, G.right - G.left, PALETTE.rule, 1)
  ctx.fillStyle = PALETTE.ink
  ctx.font = fontOf(32, { weight: 'bold' })
  ctx.fillText(L.brand, G.left, G.footerRule + 66)
  ctx.fillStyle = PALETTE.muted
  ctx.font = fontOf(14, { family: LATIN_SERIF })
  drawSpaced(ctx, L.brandEn, G.left, G.footerRule + 96, 2.6, 'left')
  hline(ctx, G.left, G.footerRule + 116, 28, PALETTE.accent, 2)
  ctx.fillStyle = PALETTE.accent
  ctx.font = fontOf(20)
  drawSpaced(ctx, L.tagline, G.left, G.footerRule + 150, 4, 'left')
  if (L.stamp) drawStamp(ctx, L.stamp, qr)

  return L
}

module.exports = {
  CARD_W,
  CARD_H,
  PALETTE,
  CAPTION_SIZES,
  fontOf,
  normalizeCardText,
  stripTitleEcho,
  pickCaptionSource,
  tokenize,
  wrapText,
  breakCandidates,
  fitCaption,
  fitShort,
  buildTaxonomyLine,
  cardSerial,
  layoutKnowledgeCard,
  drawKnowledgeCard
}
