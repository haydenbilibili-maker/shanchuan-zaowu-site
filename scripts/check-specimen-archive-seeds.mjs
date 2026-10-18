/**
 * 馆藏「标本档案」种子批次守卫（`scripts/specimen-archive-seeds/*.json` → 集合 `cms_wikis`）
 *
 * 2026-10-18 产品负责人「馆藏标本档案模块还没有高质量内容，请创作一批用于填充」。
 * 判据（每条对应一种上线后才会暴露的缺陷）：
 *   ① 不编造保护等级：iucn / protectionLevel / cites 三字段必须为空串（由馆员对照官方名录填写）；
 *      正文与档案栏也不得出现保护名录类字眼（与 2026-09-15 社区内容重写同一纪律）；
 *   ② 合规选题：排除受国际贸易管制或高风险类群（学名命中排除表即红），不写「动物馆」；
 *   ③ 措辞：营销词、投资暗示、晶石玄学（能量 / 疗愈 / 辟邪 / 招财 / 风水…）、感叹号、外链、HTML 标签一律不许；
 *   ④ 结构：必填字段齐、4–7 节且每节有标题与正文、正文 450–3000 汉字、引言 20–90 字、分布与形态两栏必填；
 *   ⑤ 入库形态：type=specimen、status=draft（getEncyclopediaFeed 过滤 draft，审定后才对用户可见）、
 *      一级馆名在 seedCategories 品类树中真实存在、category 以该馆名开头（二级筛选按 category 模糊匹配）；
 *   ⑥ 去重：seedKey 形如 archive_xxx 且跨批次唯一，标题跨批次唯一。
 *
 * 用法：
 *   node scripts/check-specimen-archive-seeds.mjs
 *   node scripts/check-specimen-archive-seeds.mjs --selftest   # 内存注入，不写盘
 */
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const DATA_DIR = resolve(HERE, 'specimen-archive-seeds')
const require = createRequire(import.meta.url)
const { DEFAULT_CATEGORY_TREE } = require(resolve(ROOT, 'miniprogram/cloudfunctions/seedCategories/categorySeed.js'))

const ROOT_NAMES = new Set(DEFAULT_CATEGORY_TREE.map((n) => n.name))
const FORBIDDEN_ROOTS = new Set(['动物馆'])
const PROTECTION_FIELDS = ['iucn', 'protectionLevel', 'cites']

/** 受国际贸易管制或高风险的类群（学名前缀，大小写不敏感）—— 命中即不写档案 */
const EXCLUDED_TAXA = [
  'Ornithoptera', 'Troides', 'Trogonoptera', 'Teinopalpus', 'Bhutanitis', 'Parnassius apollo',
  'Nautilus', 'Allonautilus', 'Scleractinia', 'Antipatharia', 'Tridacna', 'Hippoporus', 'Strombus gigas',
  'Cassis cornuta', 'Charonia', 'Hippocampus', 'Pandinus', 'Dynastes hercules'
]

const BANNED = [
  [/IUCN|CITES|保护等级|保护级别|国家重点|国家一级|国家二级|濒危|易危|极危|红色名录|附录\s*[IⅠ一二Ⅱ]/i, '保护名录类字眼'],
  [/合法带证|带证|证件齐全/, '「带证」类话术'],
  [/投资|升值|保值|收益|分红|回报/, '投资暗示'],
  [/震撼|绝美|独一无二|必看|神器|顶级|天花板|极品/, '营销词'],
  [/能量|疗愈|辟邪|招财|风水|磁场|开运|灵性|净化身心/, '晶石玄学'],
  [/[!！]/, '感叹号'],
  [/https?:\/\/|www\./i, '外链'],
  [/<[a-z/][^>]*>/i, 'HTML 标签']
]

const cjk = (s) => (String(s || '').match(/[一-龥]/g) || []).length

function textsOf(e) {
  const out = [e.title, e.brief, e.distribution, e.habitat, e.morphology, e.habits, ...(e.tags || [])]
  ;(e.sections || []).forEach((s) => { out.push(s.title, ...(s.paragraphs || [])) })
  return out.filter((x) => typeof x === 'string')
}

export function judge(batches) {
  const errs = []
  const seenKey = new Map()
  const seenTitle = new Map()
  for (const { file, batch } of batches) {
    if (batch.collection !== 'cms_wikis') errs.push(`${file}：collection 须为 cms_wikis`)
    if (!/^specimen_archive_\d{4}-\d{2}-\d{2}/.test(String(batch.batch || ''))) errs.push(`${file}：batch 须形如 specimen_archive_YYYY-MM-DD`)
    const entries = Array.isArray(batch.entries) ? batch.entries : []
    if (!entries.length) errs.push(`${file}：entries 为空`)
    for (const e of entries) {
      const tag = `${file} · ${e.title || e.seedKey || '(无名)'}`
      // ⑥ 去重
      if (!/^archive_[a-z0-9_]+$/.test(String(e.seedKey || ''))) errs.push(`${tag}：seedKey 须形如 archive_xxx`)
      if (seenKey.has(e.seedKey)) errs.push(`${tag}：seedKey 与 ${seenKey.get(e.seedKey)} 重复`)
      seenKey.set(e.seedKey, file)
      if (seenTitle.has(e.title)) errs.push(`${tag}：标题与 ${seenTitle.get(e.title)} 重复`)
      seenTitle.set(e.title, file)
      // ⑤ 入库形态
      if (e.type !== 'specimen') errs.push(`${tag}：type 须为 specimen`)
      if (e.status !== 'draft') errs.push(`${tag}：status 须为 draft（审定后再发布）`)
      if (!ROOT_NAMES.has(e.rootCategoryName)) errs.push(`${tag}：一级馆「${e.rootCategoryName}」不在品类树中`)
      if (FORBIDDEN_ROOTS.has(e.rootCategoryName)) errs.push(`${tag}：不写「${e.rootCategoryName}」档案`)
      if (!String(e.category || '').startsWith(String(e.rootCategoryName || '\u0000'))) errs.push(`${tag}：category 须以一级馆名开头`)
      // ① 不编造保护等级
      for (const f of PROTECTION_FIELDS) if (e[f] !== '') errs.push(`${tag}：${f} 须为空串（不编造保护等级，由馆员对照官方名录填写）`)
      // ② 合规选题
      const latin = String(e.latinName || '')
      const hit = EXCLUDED_TAXA.find((t) => latin.toLowerCase().startsWith(t.toLowerCase()))
      if (hit) errs.push(`${tag}：学名命中排除类群 ${hit}`)
      // ④ 结构
      for (const f of ['title', 'latinName', 'brief', 'distribution', 'morphology']) if (!String(e[f] || '').trim()) errs.push(`${tag}：${f} 必填`)
      if (!e.taxonomy || !e.taxonomy.kingdom || !e.taxonomy.class) errs.push(`${tag}：taxonomy 须有 kingdom 与 class（详情页展示这两级）`)
      const briefLen = String(e.brief || '').length
      if (briefLen < 20 || briefLen > 90) errs.push(`${tag}：引言 ${briefLen} 字，须 20–90`)
      const secs = Array.isArray(e.sections) ? e.sections : []
      if (secs.length < 4 || secs.length > 7) errs.push(`${tag}：${secs.length} 节，须 4–7 节`)
      secs.forEach((s, i) => {
        if (!String(s.title || '').trim() || !(s.paragraphs || []).some((p) => String(p).trim())) errs.push(`${tag}：第 ${i + 1} 节缺标题或正文`)
      })
      const bodyLen = cjk(secs.map((s) => [s.title, ...(s.paragraphs || [])].join('')).join(''))
      if (bodyLen < 450 || bodyLen > 3000) errs.push(`${tag}：正文 ${bodyLen} 汉字，须 450–3000`)
      // ③ 措辞
      for (const t of textsOf(e)) {
        for (const [re, what] of BANNED) if (re.test(t)) errs.push(`${tag}：出现${what}「${(t.match(re) || [''])[0]}」`)
      }
    }
  }
  return errs
}

function loadBatches() {
  return readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')).sort()
    .map((file) => ({ file, batch: JSON.parse(readFileSync(resolve(DATA_DIR, file), 'utf8')) }))
}

function selftest() {
  const base = loadBatches()
  const clone = () => JSON.parse(JSON.stringify(base))
  const first = (b) => b[0].batch.entries[0]
  const cases = [
    ['编造保护等级', (b) => { first(b).cites = '附录 II' }, /cites 须为空串/],
    ['正文写进保护名录', (b) => { first(b).sections[0].paragraphs[0] += '它被列入 IUCN 红色名录。' }, /保护名录类字眼/],
    ['选了鸟翼凤蝶', (b) => { first(b).latinName = 'Ornithoptera priamus' }, /排除类群 Ornithoptera/],
    ['写动物馆', (b) => { first(b).rootCategoryName = '动物馆'; first(b).category = '动物馆 · 鸟纲' }, /不写「动物馆」档案/],
    ['晶石玄学', (b) => { first(b).brief += '据说能带来正能量与疗愈。' }, /晶石玄学/],
    ['投资暗示', (b) => { first(b).habits = '稀有品种，升值空间大。' }, /投资暗示/],
    ['感叹号', (b) => { first(b).sections[1].paragraphs[0] += '太美了！' }, /感叹号/],
    ['夹带外链', (b) => { first(b).distribution += ' 详见 https://example.com' }, /外链/],
    ['直接发布不审', (b) => { first(b).status = 'published' }, /status 须为 draft/],
    ['正文太短', (b) => { first(b).sections = first(b).sections.slice(0, 4).map((s) => ({ title: s.title, paragraphs: ['短。'] })) }, /正文 \d+ 汉字/],
    ['节数不够', (b) => { first(b).sections = first(b).sections.slice(0, 3) }, /3 节，须 4–7 节/],
    ['形态栏留空', (b) => { first(b).morphology = '' }, /morphology 必填/],
    ['seedKey 重复', (b) => { b[0].batch.entries[1].seedKey = first(b).seedKey }, /seedKey 与 .* 重复/],
    ['馆名写错', (b) => { first(b).rootCategoryName = '蝴蝶馆'; first(b).category = '蝴蝶馆' }, /不在品类树中/],
    ['category 不带馆名（二级筛选匹配不到）', (b) => { first(b).category = '鳞翅目 · 蝴蝶' }, /category 须以一级馆名开头/]
  ]
  const baseErrs = judge(base)
  if (baseErrs.length) { console.error('✗ 自检前提失败：基线本身不绿\n  - ' + baseErrs.join('\n  - ')); process.exit(1) }
  let fail = 0
  for (const [name, mutate, expect] of cases) {
    const b = clone()
    mutate(b)
    const errs = judge(b)
    if (errs.some((e) => expect.test(e))) console.log(`  ✓ 注入「${name}」→ 被检出`)
    else { fail += 1; console.log(`  ✗ 注入「${name}」→ 未检出（${errs.join(' | ') || '无报错'}）`) }
  }
  if (fail) { console.error(`✗ check:specimen-archive-seeds 自检失败 ${fail}/${cases.length}`); process.exit(1) }
  console.log(`✓ check:specimen-archive-seeds 自检通过（${cases.length} 条内存注入全部检出，未写盘）`)
}

if (process.argv.includes('--selftest')) {
  selftest()
} else {
  const batches = loadBatches()
  const errs = judge(batches)
  if (errs.length) {
    console.error(`✗ 标本档案种子未通过（${errs.length} 处）：\n  - ` + errs.join('\n  - '))
    process.exit(1)
  }
  const n = batches.reduce((s, b) => s + b.batch.entries.length, 0)
  console.log(`✓ 标本档案种子：${batches.length} 批 ${n} 条 —— 保护等级留空、选题合规、措辞干净、结构完整、默认草稿`)
}
