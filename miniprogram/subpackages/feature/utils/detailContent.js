/**
 * 商品详情「图文详情」：纯文本分段 + 拉丁学名 / 书名号片段；mp-html tagStyle
 */

const INLINE_SPLIT_RE = /(《[^》]+》)|(\b[A-Z][a-z]{2,}(?:\s+[a-z]{2,})+\b)/g

/** mp-html 内联样式（与 Museum Mode token 对齐） */
const DETAIL_TAG_STYLE = {
  p: 'margin: 0 0 16px; line-height: 1.75; color: #D5D1C8; font-size: 14px; text-align: justify;',
  h2:
    'display: block; font-size: 15px; font-weight: 600; color: #8A7530; font-family: Georgia, "Times New Roman", serif; padding: 12px 16px; margin: 24px 0 16px; background: rgba(250,246,237,0.04); border: 1px solid rgba(77,64,26,0.45); border-radius: 8px;',
  h3: 'font-size: 15px; font-weight: 500; color: #FFFFFF; margin: 20px 0 12px; line-height: 1.5;',
  strong: 'color: #FFFFFF; font-weight: 600;',
  b: 'color: #FFFFFF; font-weight: 600;',
  em: 'color: #C4A76C; font-style: italic; font-family: Georgia, serif;',
  i: 'color: #C4A76C; font-style: italic; font-family: Georgia, serif;',
  blockquote:
    'background: rgba(196,167,108,0.08); border-left: 3px solid #C4A76C; padding: 12px 16px; margin: 16px 0; color: #A09A90; font-style: italic; line-height: 1.75;',
  ul: 'padding-left: 24px; margin: 0 0 16px; color: #D5D1C8;',
  ol: 'padding-left: 24px; margin: 0 0 16px; color: #D5D1C8;',
  li: 'margin-bottom: 8px; line-height: 1.75; color: #D5D1C8;',
  a: 'color: #C4A76C; text-decoration: underline;',
  img:
    'width: 100% !important; height: auto !important; display: block; margin: 16px 0; border-radius: 12px;'
}

const DETAIL_HTML_CONTAINER_STYLE =
  'color: #D5D1C8; font-size: 14px; line-height: 1.75; word-break: break-word;'

function segmentPlainText(text) {
  const raw = String(text || '')
  if (!raw) return []
  const segments = []
  let last = 0
  let m
  INLINE_SPLIT_RE.lastIndex = 0
  while ((m = INLINE_SPLIT_RE.exec(raw)) !== null) {
    if (m.index > last) {
      segments.push({ t: raw.slice(last, m.index), kind: 'text' })
    }
    if (m[1]) segments.push({ t: m[1], kind: 'book' })
    else if (m[2]) segments.push({ t: m[2], kind: 'latin' })
    last = m.index + m[0].length
  }
  if (last < raw.length) segments.push({ t: raw.slice(last), kind: 'text' })
  if (!segments.length) segments.push({ t: raw, kind: 'text' })
  return segments.map((seg, i) => ({ ...seg, i }))
}

const MIN_PARAGRAPH_LEN = 2

/** 已有块级结构时不改写 HTML */
const STRUCTURED_HTML_RE = /<(h[1-6]|blockquote|ul|ol|table|div|section|article|img)[\s>/]/i

/**
 * 在单个文本块内按中文句读切分（保留 。！？）。
 * 不处理 ASCII `.`；连续 `。。。` 视为省略号不逐字切分。
 */
function splitChunkByChinesePunctuation(chunk) {
  const text = String(chunk || '').trim()
  if (!text) return []
  if (!/[。！？]/.test(text)) return [text]

  const sentences = []
  let i = 0
  while (i < text.length) {
    let j = i
    while (j < text.length) {
      const ch = text[j]
      if (ch === '！' || ch === '？') {
        j += 1
        break
      }
      if (ch === '。') {
        if (text[j + 1] === '。') {
          while (j < text.length && text[j] === '。') j += 1
          break
        }
        j += 1
        break
      }
      j += 1
    }

    if (j === i) {
      const tail = text.slice(i).trim()
      if (tail.length >= MIN_PARAGRAPH_LEN) sentences.push(tail)
      else if (tail && sentences.length) sentences[sentences.length - 1] += tail
      break
    }

    const seg = text.slice(i, j).trim()
    if (seg.length >= MIN_PARAGRAPH_LEN) sentences.push(seg)
    else if (seg && sentences.length) sentences[sentences.length - 1] += seg
    else if (seg) sentences.push(seg)
    i = j
  }

  return sentences.length ? sentences : [text]
}

function splitDescriptionParagraphs(description) {
  const byNewline = String(description || '')
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)

  const merged = []
  byNewline.forEach((chunk) => {
    splitChunkByChinesePunctuation(chunk).forEach((s) => {
      const t = String(s || '').trim()
      if (t.length >= MIN_PARAGRAPH_LEN) merged.push(t)
    })
  })
  return merged
}

/**
 * @returns {{ descriptionParagraphs: Array<{ idx: number, isLead: boolean, segments: Array }> }}
 */
function buildDescriptionDisplay(description) {
  const parts = splitDescriptionParagraphs(description)
  return {
    descriptionParagraphs: parts.map((text, idx) => ({
      idx,
      isLead: idx === 0,
      segments: segmentPlainText(text)
    }))
  }
}

function hasDetailHtml(html) {
  return !!String(html || '').trim()
}

function stripHtmlTags(html) {
  return String(html || '').replace(/<[^>]+>/g, '')
}

function escapeHtmlText(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 单段 `<p>` 且无块级标签时，按句读拆成多个 `<p>`（不破坏已有结构化 HTML）。
 */
function prepareDetailHtml(html) {
  const raw = String(html || '').trim()
  if (!raw) return ''
  if (STRUCTURED_HTML_RE.test(raw)) return raw

  let inner = raw
  const wrappedP = /^<p[^>]*>([\s\S]*)<\/p>$/i.exec(raw)
  if (wrappedP) inner = wrappedP[1].trim()
  else if (/<[a-z][\s\S]*>/i.test(raw)) return raw

  if (STRUCTURED_HTML_RE.test(inner)) return raw

  const stripped = stripHtmlTags(inner).replace(/\s+/g, ' ').trim()
  if (!stripped || !/[。！？]/.test(stripped)) return raw

  const sentences = splitChunkByChinesePunctuation(stripped)
  if (sentences.length <= 1) return raw

  return sentences.map((s) => `<p>${escapeHtmlText(s)}</p>`).join('')
}

/** 青凤蝶类长描述：应拆成 4 段（开发自检） */
function assertSplitSample() {
  const sample =
    '青凤蝶成虫翅展约70–90毫米，前翅黑褐色具翠绿色条纹，后翅外缘具蓝绿色月牙斑及尾突。雌雄异型不显著，雄蝶后翅反面有明显性标。幼虫以樟科、芸香科植物为食，常见于低至中海拔林缘与庭园。飞行迅捷，喜访花吸蜜。'
  const parts = splitDescriptionParagraphs(sample)
  if (parts.length !== 4) {
    throw new Error(`detailContent: expected 4 paragraphs, got ${parts.length}`)
  }
}

module.exports = {
  DETAIL_TAG_STYLE,
  DETAIL_HTML_CONTAINER_STYLE,
  buildDescriptionDisplay,
  hasDetailHtml,
  prepareDetailHtml,
  segmentPlainText,
  splitDescriptionParagraphs,
  splitChunkByChinesePunctuation,
  assertSplitSample
}

if (require.main === module) {
  assertSplitSample()
  const sample =
    '青凤蝶成虫翅展约70–90毫米，前翅黑褐色具翠绿色条纹，后翅外缘具蓝绿色月牙斑及尾突。雌雄异型不显著，雄蝶后翅反面有明显性标。幼虫以樟科、芸香科植物为食，常见于低至中海拔林缘与庭园。飞行迅捷，喜访花吸蜜。'
  splitDescriptionParagraphs(sample).forEach((p, i) => console.log(`${i + 1}. ${p}`))
}
