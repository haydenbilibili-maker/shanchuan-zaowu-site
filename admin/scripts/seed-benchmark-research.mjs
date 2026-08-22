#!/usr/bin/env node
/**
 * 对标研究：创建集合 + 从桌面归档种子入库（MD 全文；PDF 元数据）
 *
 * 用法：
 *   cd admin
 *   # 可选：export BENCHMARK_ARCHIVE_ROOT="/path/to/03_对标研究"
 *   node scripts/seed-benchmark-research.mjs
 *   node scripts/seed-benchmark-research.mjs --dry-run
 *
 * 需 admin/.env 中 TCB_SECRET_ID / TCB_SECRET_KEY
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, relative, extname, basename } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ADMIN_DIR = join(__dirname, '..')
const ROOT = join(ADMIN_DIR, '..')
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const COLLECTION = 'benchmark_research_docs'
const SEARCHABLE_TEXT_LIMIT = 120000
const DRY = process.argv.includes('--dry-run')

const DEFAULT_ARCHIVE = join(
  process.env.HOME || '',
  'Desktop/山海造物/山海造物-归档/03_对标研究',
)
const ARCHIVE_ROOT = process.env.BENCHMARK_ARCHIVE_ROOT || DEFAULT_ARCHIVE

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
  [/蔦屋|tsutaya/i, 'tsutaya'],
  [/\bv\s*&\s*a\b|_VA_|VA对标/i, 'va'],
  [/disney|迪士尼/i, 'disney'],
  [/national\s*geographic|国家地理/i, 'natgeo'],
  [/skansen/i, 'skansen'],
  [/\bkew\b|邱园/i, 'kew'],
  [/mariage/i, 'mariage'],
  [/单向街/i, 'oneway'],
]

const BRAND_GROUP = {
  nakagawa: 'A', aesop: 'A', patagonia: 'A', palace: 'A',
  popmart: 'B', felissimo: 'B', muji: 'B', guanxia: 'B', documents: 'B',
  tsutaya: 'C', va: 'C', disney: 'C', natgeo: 'C', skansen: 'C', kew: 'C', mariage: 'C', oneway: 'C',
}

function loadDotEnv() {
  const path = join(ADMIN_DIR, '.env')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walkFiles(full, out)
    else out.push(full)
  }
  return out
}

function slugify(input) {
  return String(input || '')
    .replace(/\\/g, '/')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w\u4e00-\u9fa5.\-/]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 180)
}

function inferBrand(name) {
  for (const [re, id] of BRAND_HINTS) {
    if (re.test(name)) return id
  }
  return ''
}

function inferEra(rel) {
  if (/宪章|方法论/.test(rel)) return 'charter'
  if (/专题研究/.test(rel)) return 'topic'
  if (/山海造物期/.test(rel)) return 'shanhai'
  if (/山川造物期/.test(rel)) return 'shanchuan'
  return 'archive'
}

function excerpt(text, n = 400) {
  const one = String(text || '').replace(/\s+/g, ' ').trim()
  return one.length <= n ? one : `${one.slice(0, n)}…`
}

function buildDoc(filePath) {
  const rel = relative(ARCHIVE_ROOT, filePath).replace(/\\/g, '/')
  const ext = extname(filePath).toLowerCase()
  const fileName = basename(filePath)
  const docType = ext === '.pdf' ? 'pdf' : ext === '.md' || ext === '.markdown' ? 'md' : ext === '.txt' ? 'txt' : 'other'
  if (!['pdf', 'md', 'txt'].includes(docType)) return null

  const brandId = inferBrand(`${rel} ${fileName}`)
  const era = inferEra(rel)
  const group = BRAND_GROUP[brandId] || (era === 'charter' ? 'meta' : era === 'topic' ? 'topic' : '')
  const docKey = `archive/${slugify(rel)}`

  let text = ''
  let textStatus = 'pending_pdf'
  if (docType === 'md' || docType === 'txt') {
    text = readFileSync(filePath, 'utf8')
    textStatus = text.trim() ? 'ready' : 'empty'
  }

  const searchableText = text.slice(0, SEARCHABLE_TEXT_LIMIT)
  return {
    docKey,
    title: fileName.replace(/\.[^.]+$/, ''),
    fileName,
    relativePath: rel,
    era,
    brandId,
    group,
    docType,
    source: 'archive_seed',
    excerpt: excerpt(searchableText || fileName),
    searchableText,
    charCount: text.length,
    truncated: text.length > SEARCHABLE_TEXT_LIMIT,
    pageCount: 0,
    fileID: '',
    textStatus,
    tags: [brandId, group, era, docType].filter(Boolean),
    createTime: Date.now(),
    updateTime: Date.now(),
  }
}

function printManual() {
  console.log('\n请在 CloudBase 控制台：')
  console.log('1) 新建集合', COLLECTION)
  console.log('2) 粘贴权限 cloudbase/rules/benchmark_research_docs.json')
  console.log('3) 配置 TCB_SECRET_ID / TCB_SECRET_KEY 后重跑本脚本做种子入库\n')
}

async function main() {
  loadDotEnv()
  console.log('归档目录:', ARCHIVE_ROOT)
  if (!existsSync(ARCHIVE_ROOT)) {
    console.error('归档目录不存在。请设置 BENCHMARK_ARCHIVE_ROOT')
    process.exit(1)
  }

  const files = walkFiles(ARCHIVE_ROOT)
  const docs = files.map(buildDoc).filter(Boolean)
  console.log(`扫描到可入库文件 ${docs.length}（MD 全文 / PDF 元数据）`)
  if (DRY) {
    docs.slice(0, 8).forEach((d) => console.log(' ·', d.docKey, d.textStatus, d.charCount))
    console.log('dry-run 结束')
    return
  }

  const secretId = process.env.TCB_SECRET_ID
  const secretKey = process.env.TCB_SECRET_KEY
  if (secretId && secretKey) {
    try {
      const { initManager, provisionOne } = await import('./lib/cloudbaseProvision.mjs')
      const appMgr = await initManager({ secretId, secretKey, envId: ENV_ID })
      const { database, permission } = appMgr
      await provisionOne(database, permission, ROOT, COLLECTION)
    } catch (e) {
      console.warn('⚠ provision 跳过/失败:', e.message || e)
      printManual()
    }
  } else {
    console.log('未设置 TCB 密钥：跳过集合创建，直接尝试匿名写入（集合需已存在）。')
  }

  let cloudbase
  try {
    cloudbase = (await import('@cloudbase/js-sdk')).default
  } catch (e) {
    console.error('缺少 @cloudbase/js-sdk', e.message || e)
    process.exit(1)
  }

  const app = cloudbase.init({ env: ENV_ID, region: 'ap-shanghai' })
  await app.auth().signInAnonymously()
  const db = app.database()
  const col = db.collection(COLLECTION)

  let ok = 0
  let fail = 0
  for (const doc of docs) {
    try {
      const exist = await col.where({ docKey: doc.docKey }).limit(1).get()
      const rows = exist?.data || []
      if (rows.length) {
        const id = rows[0]._id
        const { createTime, ...rest } = doc
        await col.doc(id).update({
          ...rest,
          createTime: rows[0].createTime || createTime,
        })
      } else {
        await col.add(doc)
      }
      ok += 1
      process.stdout.write(`✓ ${doc.relativePath}\n`)
    } catch (e) {
      fail += 1
      console.warn('✗', doc.relativePath, e.message || e)
    }
  }

  console.log(`\n完成：成功 ${ok}，失败 ${fail}`)
  if (!ok && fail) printManual()
  else console.log('PDF 正文可在 Admin「对标研究」上传后自动抽文本。')
}

main().catch((e) => {
  console.error(e)
  printManual()
  process.exit(1)
})
