/**
 * 对标研究 · CloudBase 动态入库与全文检索
 */
import {
  COLLECTIONS,
  fetchCollectionSorted,
  cdnUpsertByWhere,
  uploadAdminBinary,
} from '../cloud'
import { BENCHMARK_BRANDS } from '../data/benchmarkResearchLibrary'

export const BENCHMARK_DOCS = COLLECTIONS.BENCHMARK_RESEARCH_DOCS
export const SEARCHABLE_TEXT_LIMIT = 120000

const BRAND_HINTS = [
  [/中川|nakagawa/i, 'nakagawa'],
  [/aesop/i, 'aesop'],
  [/patagonia/i, 'patagonia'],
  [/故宫/i, 'palace'],
  [/泡泡玛特|pop\s*mart/i, 'popmart'],
  [/felissimo/i, 'felissimo'],
  [/muji|无印/i, 'muji'],
  [/观夏|to\s*summer/i, 'guanxia'],
  [/闻献|documents/i, 'documents'],
  [/蔦屋|tsutaya|tsutaya/i, 'tsutaya'],
  [/\bv\s*&\s*a\b|\bva\b|维多利亚/i, 'va'],
  [/disney|迪士尼/i, 'disney'],
  [/national\s*geographic|国家地理/i, 'natgeo'],
  [/skansen/i, 'skansen'],
  [/\bkew\b|邱园/i, 'kew'],
  [/mariage/i, 'mariage'],
  [/单向街|one\s*way/i, 'oneway'],
  [/门店扩张/i, null],
  [/产业链/i, null],
  [/公共合作/i, null],
  [/宪章/i, null],
  [/方法论/i, null],
]

export function slugifyDocKey(input) {
  return String(input || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w\u4e00-\u9fa5.\-/]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 180)
}

export function inferBrandIdFromName(name = '') {
  for (const [re, id] of BRAND_HINTS) {
    if (re.test(name)) return id
  }
  return ''
}

export function inferEraFromPath(path = '') {
  const p = path.replace(/\\/g, '/')
  if (/宪章|方法论/.test(p)) return 'charter'
  if (/专题研究/.test(p)) return 'topic'
  if (/山海造物期/.test(p)) return 'shanhai'
  if (/山川造物期/.test(p)) return 'shanchuan'
  return 'upload'
}

export function inferGroupFromBrandId(brandId) {
  const brand = BENCHMARK_BRANDS.find((b) => b.id === brandId)
  return brand?.group || ''
}

export function truncateSearchableText(text = '', limit = SEARCHABLE_TEXT_LIMIT) {
  const raw = String(text || '').replace(/\u0000/g, ' ').trim()
  if (raw.length <= limit) return { searchableText: raw, charCount: raw.length, truncated: false }
  return {
    searchableText: raw.slice(0, limit),
    charCount: raw.length,
    truncated: true,
  }
}

export function makeExcerpt(text = '', len = 400) {
  const one = String(text || '').replace(/\s+/g, ' ').trim()
  if (one.length <= len) return one
  return `${one.slice(0, len)}…`
}

export async function extractTextFromPdfFile(file) {
  const pdfjs = await import('pdfjs-dist')
  const { getDocument, GlobalWorkerOptions } = pdfjs
  GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()

  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise

  const parts = []
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const line = (content.items || [])
      .map((it) => (typeof it?.str === 'string' ? it.str : ''))
      .filter(Boolean)
      .join(' ')
    if (line) parts.push(line)
  }
  return { text: parts.join('\n'), pageCount: pdf.numPages }
}

export async function extractTextFromUploadFile(file) {
  const name = file?.name || 'file'
  const lower = name.toLowerCase()
  if (lower.endsWith('.md') || lower.endsWith('.txt') || lower.endsWith('.markdown')) {
    const text = await file.text()
    return { text, pageCount: 0, docType: lower.endsWith('.txt') ? 'txt' : 'md' }
  }
  if (lower.endsWith('.pdf')) {
    const { text, pageCount } = await extractTextFromPdfFile(file)
    return { text, pageCount, docType: 'pdf' }
  }
  throw new Error('仅支持 PDF / Markdown / TXT')
}

export function buildBenchmarkDocPayload({
  docKey,
  title,
  fileName,
  relativePath = '',
  era = 'upload',
  brandId = '',
  group = '',
  docType = 'other',
  source = 'admin_upload',
  text = '',
  pageCount = 0,
  fileID = '',
  textStatus = 'ready',
  tags = [],
}) {
  const { searchableText, charCount, truncated } = truncateSearchableText(text)
  const resolvedBrand = brandId || inferBrandIdFromName(`${title} ${fileName} ${relativePath}`)
  const resolvedGroup = group || inferGroupFromBrandId(resolvedBrand) || (
    era === 'charter' ? 'meta' : era === 'topic' ? 'topic' : ''
  )
  return {
    docKey,
    title: title || fileName || docKey,
    fileName: fileName || '',
    relativePath,
    era,
    brandId: resolvedBrand,
    group: resolvedGroup,
    docType,
    source,
    excerpt: makeExcerpt(searchableText),
    searchableText,
    charCount,
    truncated: !!truncated,
    pageCount: pageCount || 0,
    fileID: fileID || '',
    textStatus: searchableText ? textStatus : (textStatus === 'ready' ? 'empty' : textStatus),
    tags: tags.length
      ? tags
      : [resolvedBrand, resolvedGroup, era, docType].filter(Boolean),
    updateTime: Date.now(),
  }
}

export async function upsertBenchmarkDoc(payload) {
  const data = {
    ...payload,
    createTime: payload.createTime || Date.now(),
  }
  await cdnUpsertByWhere(BENCHMARK_DOCS, { docKey: payload.docKey }, data)
  return data
}

export async function loadBenchmarkDocs({ limit = 300 } = {}) {
  return fetchCollectionSorted(BENCHMARK_DOCS, {
    limit,
    throwOnError: true,
    sortFn: (a, b) => (b.updateTime || b.createTime || 0) - (a.updateTime || a.createTime || 0),
  })
}

/**
 * 客户端全文检索（多关键词 AND）
 */
export function searchBenchmarkDocs(docs, query, { limit = 40 } = {}) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return []
  const tokens = q.split(/\s+/).filter(Boolean)
  const scored = []

  for (const doc of docs || []) {
    const hay = [
      doc.title,
      doc.fileName,
      doc.relativePath,
      doc.brandId,
      doc.group,
      doc.era,
      ...(doc.tags || []),
      doc.excerpt,
      doc.searchableText,
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase()

    if (!tokens.every((t) => hay.includes(t))) continue

    let score = 0
    const title = String(doc.title || '').toLowerCase()
    for (const t of tokens) {
      if (title.includes(t)) score += 8
      if (String(doc.brandId || '').includes(t)) score += 5
      score += 1
    }
    scored.push({
      ...doc,
      _score: score,
      _snippet: buildSearchSnippet(doc.searchableText || doc.excerpt || '', tokens[0]),
    })
  }

  return scored.sort((a, b) => b._score - a._score || (b.updateTime || 0) - (a.updateTime || 0)).slice(0, limit)
}

export function buildSearchSnippet(text, token, radius = 70) {
  const raw = String(text || '').replace(/\s+/g, ' ')
  if (!raw) return ''
  const lower = raw.toLowerCase()
  const idx = lower.indexOf(String(token || '').toLowerCase())
  if (idx < 0) return makeExcerpt(raw, radius * 2)
  const start = Math.max(0, idx - radius)
  const end = Math.min(raw.length, idx + String(token).length + radius)
  const slice = raw.slice(start, end)
  return `${start > 0 ? '…' : ''}${slice}${end < raw.length ? '…' : ''}`
}

export async function ingestUploadFile(file, { uploadOriginal = true } = {}) {
  const { text, pageCount, docType } = await extractTextFromUploadFile(file)
  const fileName = file.name || 'upload'
  const docKey = `upload/${slugifyDocKey(fileName)}_${file.size || Date.now()}`
  let fileID = ''
  if (uploadOriginal) {
    try {
      fileID = await uploadAdminBinary(file, 'benchmark-research')
    } catch (err) {
      console.warn('[benchmark] 原文上传失败，仅入库文本', err)
    }
  }
  const payload = buildBenchmarkDocPayload({
    docKey,
    title: fileName.replace(/\.[^.]+$/, ''),
    fileName,
    era: 'upload',
    docType,
    source: 'admin_upload',
    text,
    pageCount,
    fileID,
    textStatus: text?.trim() ? 'ready' : 'empty',
  })
  await upsertBenchmarkDoc(payload)
  return payload
}

export function docsForBrand(docs, brandId) {
  if (!brandId) return []
  return (docs || []).filter((d) => d.brandId === brandId)
}
