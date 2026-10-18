/**
 * 馆藏「标本档案」种子：按批次写入 / 发布 / 撤回 / 删除（**默认 dry-run，需显式 --apply**）
 *
 * 数据源：`scripts/specimen-archive-seeds/<批次>.json`（守卫 `npm run check:specimen-archive-seeds`）→ 集合 `cms_wikis`。
 * 字段与 `getWikiData.get_detail` / `getEncyclopediaFeed` 的读取口径一致：
 *   title / latinName / brief / content(HTML，由 sections 生成) / type=specimen / category（全路径，二级筛选按它模糊匹配）/
 *   categoryId（一级馆 _id，按 rootCategoryName 从 categories 查得）/ taxonomy / tags /
 *   distribution / habitat / morphology / habits / iucn / protectionLevel / cites / coverImage / gallery / relatedProductIds
 * 另记 `_seedKey`、`seedBatch`，与 2026-09-15 社区内容种子同一套标识。
 *
 * 安全设计
 *   · 默认不写，只打印将写入 / 更新的条目与一级馆解析结果；
 *   · 写前先跑守卫，守卫不绿不写；再把本批涉及的现有文档**快照**到 backups/specimen-archive-seeds/（.gitignore 覆盖）；
 *   · 新条目一律 status=draft（列表过滤 draft，用户看不到），审定后 `--publish` 整批发布；
 *   · 幂等：按 `_seedKey` 匹配，已存在的只更新正文类字段 ——
 *     **不覆盖**馆员在后台补的 coverImage / gallery / relatedProductIds / 保护等级三字段 / status；
 *   · 一级馆名解析不到 categoryId → 整批中止（否则条目在一级馆 Tab 下不出现）；
 *   · 配图与「馆藏关联」取自商品（2026-10-18 产品负责人「配图可取商品图」）：按 productMatch 关键词在 products 里找在售商品，
 *     同馆优先（「大蓝闪蝶」先挑昆虫馆标本，不挑首饰），首图作 coverImage、前 4 件的图作 gallery、前 6 件作 relatedProductIds；
 *     已存在条目只在这几个字段为空时补，不覆盖馆员调整。
 *
 * 用法：
 *   node scripts/seed-specimen-archive.mjs [--file <json>]              # dry-run
 *   node scripts/seed-specimen-archive.mjs [--file <json>] --apply      # 写入（草稿）
 *   node scripts/seed-specimen-archive.mjs [--file <json>] --publish    # 整批发布（status → published）
 *   node scripts/seed-specimen-archive.mjs [--file <json>] --unpublish  # 整批撤回为草稿
 *   node scripts/seed-specimen-archive.mjs [--file <json>] --remove     # 整批删除（先快照）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const require = createRequire(import.meta.url)

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const COLLECTION = 'cms_wikis'
const BACKUP_DIR = resolve(ROOT, 'backups/specimen-archive-seeds')
/** 馆员在后台维护的字段：重跑种子时一律不覆盖 */
const STAFF_DEFAULTS = { coverImage: '', gallery: [], relatedProductIds: [], relatedSkus: [], iucn: '', protectionLevel: '', cites: '', status: 'draft' }

const args = process.argv.slice(2)
const flag = (f) => args.includes(f)
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : ''
const DATA_DIR = resolve(HERE, 'specimen-archive-seeds')
const dataFile = fileArg
  ? resolve(process.cwd(), fileArg)
  : resolve(DATA_DIR, readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')).sort().pop())
const batch = JSON.parse(readFileSync(dataFile, 'utf8'))
const BATCH = batch.batch
const MODE = flag('--apply') ? 'apply' : flag('--publish') ? 'publish' : flag('--unpublish') ? 'unpublish' : flag('--remove') ? 'remove' : 'dry'

const RELATED_MAX = 6
const GALLERY_MAX = 4
const imageOf = (p) => (Array.isArray(p.images) && p.images.find(Boolean)) || p.image || p.coverImage || ''
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 按关键词找在售商品：同馆优先、有图优先、去重；返回 { ids, cover, gallery, titles } */
export function pickProducts(entry, products) {
  const kws = entry.productMatch || []
  const hit = products.filter((p) => p && p.isOffShelf !== true && kws.some((k) => String(p.title || '').includes(k)))
  const seen = new Set()
  const ranked = hit
    .filter((p) => (seen.has(p._id) ? false : seen.add(p._id)))
    .sort((a, b) => {
      const sa = (a.rootCategoryName === entry.rootCategoryName ? 0 : 1) * 2 + (imageOf(a) ? 0 : 1)
      const sb = (b.rootCategoryName === entry.rootCategoryName ? 0 : 1) * 2 + (imageOf(b) ? 0 : 1)
      return sa - sb
    })
  const withImg = ranked.filter((p) => imageOf(p))
  return {
    ids: ranked.slice(0, RELATED_MAX).map((p) => p._id),
    cover: withImg.length ? imageOf(withImg[0]) : '',
    gallery: withImg.slice(0, GALLERY_MAX).map(imageOf),
    titles: ranked.slice(0, RELATED_MAX).map((p) => p.title)
  }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** sections → 详情页 mp-html 正文（与社区内容种子同一形态：h3 小节标题 + p 段落） */
export function sectionsToHtml(sections) {
  return (sections || []).map((s) => `<h3>${esc(s.title)}</h3>${(s.paragraphs || []).map((p) => `<p>${esc(p)}</p>`).join('')}`).join('')
}

function contentFields(e) {
  return {
    type: 'specimen',
    title: e.title,
    latinName: e.latinName,
    brief: e.brief,
    content: sectionsToHtml(e.sections),
    category: e.category,
    taxonomy: e.taxonomy,
    tags: e.tags || [],
    distribution: e.distribution || '',
    habitat: e.habitat || '',
    morphology: e.morphology || '',
    habits: e.habits || '',
    _seedKey: e.seedKey,
    seedBatch: BATCH
  }
}

function readCreds() {
  const out = {}
  for (const raw of readFileSync(resolve(ROOT, 'admin/.env'), 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const [k, ...rest] = line.split('=')
    out[k.trim()] = rest.join('=').trim()
  }
  if (!out.TCB_SECRET_ID || !out.TCB_SECRET_KEY) throw new Error('admin/.env 缺少 TCB 凭据')
  return out
}

async function main() {
  console.log(`批次 ${BATCH} · ${batch.entries.length} 条 · 模式 ${MODE}${MODE === 'dry' ? '（只预览，不写库）' : ''}`)

  const guard = spawnSync(process.execPath, [resolve(HERE, 'check-specimen-archive-seeds.mjs')], { stdio: 'inherit' })
  if (guard.status !== 0) { console.error('✗ 守卫未通过，中止'); process.exit(1) }

  if (MODE === 'dry' && !existsSync(resolve(ROOT, 'admin/.env'))) {
    for (const e of batch.entries) console.log(`  · [草稿] ${e.rootCategoryName} / ${e.title}（${e.latinName}）· ${e.sections.length} 节 · 商品关键词 ${(e.productMatch || []).join('、')}`)
    console.log('（未找到 admin/.env：只做离线预览；有凭据时 dry-run 还会比对线上现有条目与一级馆 _id）')
    return
  }

  let tcb = null
  for (const p of [resolve(ROOT, 'node_modules/@cloudbase/node-sdk')]) {
    try { tcb = require(p); break } catch (e) { /* 继续 */ }
  }
  if (!tcb) { console.error('✗ 未找到 @cloudbase/node-sdk'); process.exit(2) }
  const creds = readCreds()
  const db = tcb.init({ env: ENV_ID, secretId: creds.TCB_SECRET_ID, secretKey: creds.TCB_SECRET_KEY }).database()
  const _ = db.command

  // 一级馆 _id
  const roots = [...new Set(batch.entries.map((e) => e.rootCategoryName))]
  const { data: rootRows } = await db.collection('categories').where({ level: 1, name: _.in(roots) }).get()
  const rootId = Object.fromEntries(rootRows.map((r) => [r.name, r._id]))
  const missing = roots.filter((n) => !rootId[n])
  if (missing.length) { console.error(`✗ categories 里找不到一级馆：${missing.join('、')}，中止`); process.exit(1) }

  // 配图与馆藏关联：按关键词取在售商品
  const kwAll = [...new Set(batch.entries.flatMap((e) => e.productMatch || []))]
  const products = []
  for (const kw of kwAll) {
    const { data } = await db.collection('products')
      .where({ isOffShelf: _.neq(true), title: db.RegExp({ regexp: escRe(kw), options: 'i' }) })
      .field({ title: true, images: true, image: true, coverImage: true, rootCategoryName: true, isOffShelf: true })
      .limit(50).get()
    products.push(...data)
  }
  const picks = Object.fromEntries(batch.entries.map((e) => [e.seedKey, pickProducts(e, products)]))

  const keys = batch.entries.map((e) => e.seedKey)
  const { data: existing } = await db.collection(COLLECTION).where({ _seedKey: _.in(keys) }).limit(100).get()
  const byKey = Object.fromEntries(existing.map((r) => [r._seedKey, r]))

  for (const e of batch.entries) {
    const hit = byKey[e.seedKey]
    const pk = picks[e.seedKey]
    console.log(`  ${hit ? '↻ 更新' : '+ 新增'} ${e.rootCategoryName}(${rootId[e.rootCategoryName]}) / ${e.title}${hit ? `（现状 ${hit.status || '无 status'}）` : ''}`)
    console.log(`      配图 ${pk.cover ? '✓' : '✗ 无匹配商品图'} · 关联 ${pk.ids.length} 件${pk.titles.length ? '：' + pk.titles.join('、') : ''}`)
  }
  if (MODE === 'dry') return

  mkdirSync(BACKUP_DIR, { recursive: true })
  const snap = resolve(BACKUP_DIR, `${MODE}-${BATCH}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(snap, JSON.stringify({ at: new Date().toISOString(), collection: COLLECTION, batch: BATCH, rows: existing }, null, 1))
  if (!existsSync(snap)) throw new Error('快照未落盘，中止')
  console.log(`✓ 快照 ${snap}（${existing.length} 行）`)

  if (MODE === 'apply') {
    for (const e of batch.entries) {
      const fields = { ...contentFields(e), categoryId: rootId[e.rootCategoryName], updateTime: db.serverDate() }
      const hit = byKey[e.seedKey]
      const pk = picks[e.seedKey]
      const media = { coverImage: pk.cover, gallery: pk.gallery, relatedProductIds: pk.ids }
      if (hit) {
        // 馆员维护字段：只在为空时补
        const fill = {}
        if (!hit.coverImage && media.coverImage) fill.coverImage = media.coverImage
        if (!(hit.gallery && hit.gallery.length) && media.gallery.length) fill.gallery = media.gallery
        if (!(hit.relatedProductIds && hit.relatedProductIds.length) && media.relatedProductIds.length) fill.relatedProductIds = media.relatedProductIds
        await db.collection(COLLECTION).doc(hit._id).update({ ...fields, ...fill })
      } else {
        await db.collection(COLLECTION).add({ ...STAFF_DEFAULTS, ...media, ...fields, createTime: db.serverDate() })
      }
    }
    console.log(`✓ 已写入 ${batch.entries.length} 条（新条目为草稿；已存在条目只更新正文类字段，馆员维护字段未动）`)
    return
  }
  if (MODE === 'publish' || MODE === 'unpublish') {
    const status = MODE === 'publish' ? 'published' : 'draft'
    for (const r of existing) await db.collection(COLLECTION).doc(r._id).update({ status, updateTime: db.serverDate() })
    console.log(`✓ ${existing.length} 条 status → ${status}`)
    return
  }
  if (MODE === 'remove') {
    for (const r of existing) await db.collection(COLLECTION).doc(r._id).remove()
    console.log(`✓ 已删除 ${existing.length} 条（快照可恢复）`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error('✗', err && err.message ? err.message : err); process.exit(1) })
}
