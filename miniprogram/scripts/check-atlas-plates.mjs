#!/usr/bin/env node
/**
 * 山海图鉴 · 卷一重设计守卫（2026-10-17，home 域）
 *
 * 判据（真源 + 桩，不联网、不写盘）：
 *   A 刻版线描覆盖：图鉴目录（小程序副本 + 云端 catalog）的每个物种都在 SHAPE_BY_SPECIES 里登记了版式，且版式存在；
 *     每张版都是可解析的 SVG data URI（微信 <image> 不渲染 .svg 文件）。
 *   B 不剧透：未点亮的页 plateOf 一律返回空串；WXML 里未点亮分支不渲染图版 / 名称 / 学名。
 *   C 标本册按编号固定位置：真跑图鉴页 applyPack —— 点亮的页不往前挤，顺序 = 编号顺序；
 *     刻度与卡片一一对应；未点亮的卡片没有图。
 *   D 门类与卷章互斥：选门类清掉卷章，选卷章回到「全部」。
 *
 * 用法：node miniprogram/scripts/check-atlas-plates.mjs [--selftest]
 * --selftest：对真源做内存注入（不改文件），每条注入都必须被检出。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCjsModule } from './lib/cjs-loader.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const P = {
  plates: resolve(MP, 'subpackages/feature/utils/atlasPlates.js'),
  catalog: resolve(MP, 'subpackages/feature/config/atlasCatalog.js'),
  cloudCatalog: resolve(MP, 'cloudfunctions/manageAtlas/catalog.js'),
  page: resolve(MP, 'subpackages/feature/collection/index.js'),
  wxml: resolve(MP, 'subpackages/feature/collection/index.wxml'),
  detailWxml: resolve(MP, 'subpackages/feature/collection/detail/index.wxml'),
  careDefaults: resolve(MP, 'subpackages/feature/utils/careDefaults.js'),
  careHubJs: resolve(MP, 'subpackages/feature/care/index.js'),
  careGuideJs: resolve(MP, 'subpackages/feature/care/guide/index.js'),
  careWxml: ['index', 'guide/index', 'my/index'].map((n) => resolve(MP, `subpackages/feature/care/${n}.wxml`)),
  achievements: resolve(MP, 'cloudfunctions/getUserAchievements/index.js')
}

async function run(inject) {
  const fails = []
  const ok = (cond, msg) => { if (!cond) fails.push(msg) }
  const transform = (file, src) => (inject && inject.file === file ? apply(src, inject) : src)
  const read = (file) => transform(file, readFileSync(file, 'utf8'))
  const load = (file, opts) => loadCjsModule(file, Object.assign({ transform }, opts || {}))

  // A 覆盖
  const plates = load(P.plates)
  const catalog = load(P.catalog)
  const cloudIds = [...read(P.cloudCatalog).matchAll(/^\s{4}id: '(\d{3})',$/gm)].map((m) => m[1])
  const ids = [...new Set(catalog.ATLAS_SPECIES.map((s) => s.id).concat(cloudIds))]
  const missing = ids.filter((id) => !plates.SHAPES[plates.SHAPE_BY_SPECIES[id]])
  ok(ids.length >= 16 && !missing.length, `A 物种未登记刻版线描（会回落成同一张蝴蝶）：${missing.join(',')}`)
  for (const shape of Object.keys(plates.SHAPES)) {
    const uri = plates.plateUri(shape)
    const svg = decodeURIComponent(String(uri).split(',').slice(1).join(','))
    ok(/^data:image\/svg\+xml;charset=utf-8,/.test(uri) && /^<svg [^>]*viewBox="0 0 120 120"/.test(svg) && svg.endsWith('</svg>') &&
      (svg.match(/"/g) || []).length % 2 === 0, `A 版式 ${shape} 不是可解析的 SVG data URI`)
  }

  // B 不剧透
  const leaked = catalog.ATLAS_SPECIES.filter((s) => plates.plateOf({ id: s.id, categoryTone: 'insecta', unlocked: false }))
  ok(!leaked.length, `B 未点亮的页拿到了图版（剧透形态）：${leaked.map((s) => s.id).join(',')}`)
  const wxml = read(P.wxml)
  const blank = (wxml.match(/<block wx:else>([\s\S]*?)<\/block>/) || [])[1] || ''
  ok(!!blank && !/item\.(plate|nameZh|nameLatin)/.test(blank), 'B 图鉴页未点亮分支渲染了图版 / 名称 / 学名')
  const dBlank = (read(P.detailWxml).match(/<block wx:else>\s*<text class="blank-no">([\s\S]*?)<\/block>/) || [])[0] || ''
  ok(!!dBlank && !/card\.(plate|nameZh|nameLatin|essay)/.test(dBlank), 'B 详页未点亮分支渲染了图版 / 名称 / 学名')

  // E 标本养护「养护手册」（2026-10-17）：品类手册与指南卷首复用同一套刻版线描；三页改页面滚动
  const careSrc = read(P.careDefaults)
  const careCats = [...((careSrc.match(/const CATEGORY_META = \{([\s\S]*?)\n\}/) || [])[1] || '').matchAll(/^\s{2}([A-Z]+):/gm)].map((m) => m[1])
  const careMissing = careCats.filter((c) => !/^data:image\/svg/.test(plates.carePlateOf(c)))
  ok(careCats.length >= 7 && !careMissing.length, `E 养护品类缺刻版线描：${careMissing.join(',')}`)
  const stale = P.careWxml.filter((f) => /<scroll-view\s+scroll-y|class="header care-header"/.test(read(f)))
  ok(!stale.length, `E 养护页又叠回自绘页头 / 纵向 scroll-view：${stale.map((f) => f.split('/care/')[1]).join(',')}`)
  ok(/wx\.pageScrollTo\(\{ selector: '#care-categories'/.test(read(P.careHubJs)) &&
    /wx\.pageScrollTo\(\{ selector: `#section-\$\{key\}`/.test(read(P.careGuideJs)),
    'E 页面滚动后「浏览品类」与章节跳转须走 wx.pageScrollTo（scroll-into-view 已无容器可滚）')

  // C / D 真跑页面
  let cfg = null
  load(P.page, {
    globals: {
      Page: (o) => { cfg = o },
      getApp: () => ({ globalData: {} }),
      wx: { cloud: { callFunction: async () => ({ result: {} }) }, showToast() {}, navigateTo() {} }
    },
    stubs: { '../../../utils/trackBehavior': { trackBehavior() {} } }
  })
  const page = { ...cfg, data: JSON.parse(JSON.stringify(cfg.data)), setData(p, cb) { Object.assign(this.data, p); if (cb) cb() } }
  const mk = (id, lit, cat) => ({ id, no: id, category: cat || '昆虫', categoryTone: 'insecta', rarity: 'common', unlocked: lit, nameZh: lit ? `n${id}` : '未记录', seriesIds: id === '031' ? ['mountain'] : [] })
  page.applyPack({
    cards: [mk('041', true, '矿石'), mk('001', false), mk('031', true, '植物'), mk('009', false), mk('004', true)],
    stats: { total: 5, unlocked: 3, series: [{ id: 'mountain', name: '守山者', got: 1, total: 1 }] }
  }, { offline: false })
  const order = page.data.filtered.map((c) => c.no).join(',')
  ok(order === '001,004,009,031,041', `C 标本册须按编号固定位置（点亮的页不往前挤），实际 ${order}`)
  ok(page.data.ticks.map((t) => `${t.no}${t.lit ? '+' : '-'}`).join(',') === '001-,004+,009-,031+,041+', 'C 卷首刻度须与标本册一一对应（亮 = 已翻开）')
  ok(page.data.filtered.every((c) => (c.unlocked ? /^data:image\/svg/.test(c.plate) : c.plate === '')), 'C 点亮的页须有图版、未点亮的页不得有图')
  page.onSeries({ currentTarget: { dataset: { id: 'mountain' } } })
  ok(page.data.filter === 'all' && page.data.filtered.map((c) => c.no).join(',') === '031', 'D 选卷章须回到全部门类并只看这一章')
  page.onFilter({ currentTarget: { dataset: { id: '昆虫' } } })
  ok(page.data.seriesFilter === '' && page.data.filtered.length === 3, 'D 选门类须清掉卷章筛选')
  // F 只看已翻开（2026-11-22）：只留点亮页、与门类叠加、「看全部」一并清掉
  page.onFilter({ currentTarget: { dataset: { id: 'all' } } })
  page.onToggleOnlyLit()
  ok(page.data.onlyLit === true && page.data.filtered.map((c) => c.no).join(',') === '004,031,041', 'F 只看已翻开：须只剩点亮的页（仍按编号）')
  page.onFilter({ currentTarget: { dataset: { id: '昆虫' } } })
  ok(page.data.filtered.map((c) => c.no).join(',') === '004', 'F 只看已翻开须与门类叠加')
  page.clearFilters()
  ok(page.data.onlyLit === false && page.data.filtered.length === 5, 'F 「看全部」须一并关掉只看已翻开')

  // G 全册归章（2026-11-23 产品负责人「图鉴已有 200，章节中数量不足 200」）：两份目录各自 200 页每页恰好一章、
  //   章 → 页与页 → 章双向一致、两份目录章节完全相同；前三章页集与成就 ATLAS_SETS 逐一相同（成就绑定，不许动）
  const cloud = load(P.cloudCatalog)
  for (const [tag, cat] of [['小程序', catalog], ['云端', cloud]]) {
    const owner = new Map()
    let dupOrMiss = 0
    cat.ATLAS_SERIES.forEach((sr) => sr.speciesIds.forEach((id) => {
      const sp = cat.ATLAS_SPECIES.find((x) => x.id === id)
      if (owner.has(id) || !sp || !(sp.seriesIds || []).includes(sr.id)) dupOrMiss += 1
      owner.set(id, sr.id)
    }))
    const orphans = cat.ATLAS_SPECIES.filter((sp) => (sp.seriesIds || []).length !== 1 || owner.get(sp.id) !== sp.seriesIds[0]).map((sp) => sp.id)
    ok(owner.size === cat.ATLAS_SPECIES.length && !dupOrMiss && !orphans.length,
      `G ${tag}目录：${cat.ATLAS_SPECIES.length} 页里 ${owner.size} 页归了章，重复 / 双向不一致 ${dupOrMiss} 处，未归章或多章：${orphans.slice(0, 8).join(',')}`)
  }
  const chap = (cat) => JSON.stringify(cat.ATLAS_SERIES.map((sr) => [sr.id, sr.name, sr.speciesIds]))
  ok(chap(catalog) === chap(cloud), 'G 小程序与云端两份目录的卷章不一致')
  ok(catalog.ATLAS_SERIES.length % 3 === 0, `G 卷章卡三张一行：章数须为 3 的倍数（现在 ${catalog.ATLAS_SERIES.length}）`)
  const ach = read(P.achievements)
  const setOf = (k) => ((new RegExp(`${k}: \\[([^\\]]*)\\]`).exec(ach) || [])[1] || '').split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean).join(',')
  ok(['frost', 'overwinter', 'mountain'].every((id, i) => catalog.ATLAS_SERIES[i] && catalog.ATLAS_SERIES[i].id === id && catalog.ATLAS_SERIES[i].speciesIds.join(',') === setOf(`atlas_${id}`)),
    'G 前三章（霜降守望 / 越冬者 / 守山者）页集须与成就 ATLAS_SETS 逐一相同')
  // 刻度：最多 8 格一行、按比例点亮（翻开过至少 1 格、未翻满不全亮）
  const pageSrc = read(P.page)
  const at = pageSrc.indexOf('const PIP_MAX = ')
  let pips = null
  try { pips = new Function(pageSrc.slice(at, pageSrc.indexOf('\nPage({', at)) + '\nreturn chapterPips')() } catch (e) { pips = null }
  const litN = (g, t) => (pips ? pips(g, t).filter((p) => p.lit).length : -1)
  ok(!!pips && pips(5, 32).length === 8 && litN(5, 32) === 1 && litN(1, 32) === 1 && litN(31, 32) === 7 && litN(32, 32) === 8 && litN(0, 32) === 0 &&
    pips(2, 4).length === 4 && litN(2, 4) === 2 && /pips: chapterPips\(sr\.got, sr\.total\)/.test(pageSrc),
    'G 卷章刻度须最多 8 格一行、按比例点亮（翻开过至少 1 格、未翻满不全亮）')
  return fails
}

function apply(src, inj) {
  if (src.indexOf(inj.find) === -1) throw new Error(`注入锚点失效：${inj.name}`)
  return src.replace(inj.find, inj.replace)
}

const INJECTIONS = [
  { name: '只看已翻开不再过滤', file: P.page, find: 'if (onlyLit && !c.unlocked) return false', replace: '' },
  { name: '物种漏登记版式', file: P.plates, find: "'041': 'quartz', ", replace: '' },
  { name: '未点亮也给图', file: P.plates, find: '  if (!card || !card.unlocked) return \'\'\n', replace: "  if (!card) return ''\n" },
  { name: '标本册回到点亮优先', file: P.page, find: "    cards.sort((a, b) => String(a.no).localeCompare(String(b.no), 'en', { numeric: true }))", replace: "    cards.sort((a, b) => (!!a.unlocked !== !!b.unlocked ? (a.unlocked ? -1 : 1) : String(a.no).localeCompare(String(b.no), 'en', { numeric: true })))" },
  { name: '空位露出名称', file: P.wxml, find: '<text class="slot-blank-t">未记录</text>', replace: '<text class="slot-blank-t">{{item.nameZh}}</text>' },
  { name: '详页空位露出图版', file: P.detailWxml, find: '<text class="blank-t">这一页还空着</text>', replace: '<image src="{{card.plate}}"></image><text class="blank-t">这一页还空着</text>' },
  { name: '门类不清卷章', file: P.page, find: "this.setData({ filter: e.currentTarget.dataset.id, seriesFilter: '' }", replace: 'this.setData({ filter: e.currentTarget.dataset.id }' },
  { name: '养护品类漏版式', file: P.plates, find: "MINERALS: 'quartz', GENERAL: 'belljar',", replace: "MINERALS: 'quartz'," },
  { name: '养护页叠回 scroll-view', file: P.careWxml[2], find: '  <!-- 2026-10-17「养护手册」重构', replace: '  <scroll-view scroll-y class="main-scroll">\n  <!-- 2026-10-17「养护手册」重构' },
  { name: '章节跳转回到 scroll-into-view', file: P.careGuideJs, find: "    wx.pageScrollTo({ selector: `#section-${key}`, offsetTop: -16, duration: 300, fail: () => {} })", replace: "    this.setData({ scrollIntoView: `section-${key}` })" },
  { name: '某页没归章', file: P.catalog, find: "    seriesIds: ['lode'],\n    aliases: ['辉锑矿'", replace: "    seriesIds: [],\n    aliases: ['辉锑矿'" },
  { name: '云端目录卷章漂移', file: P.cloudCatalog, find: "  {\n    id: 'lode',\n    name: '矿脉',", replace: "  {\n    id: 'lode',\n    name: '矿石脉',", },
  { name: '动了成就绑定的前三章', file: P.catalog, find: "speciesIds: ['001', '012', '028']", replace: "speciesIds: ['001', '012', '028', '009']" },
  { name: '刻度按页数点亮', file: P.page, find: '  let lit = t <= PIP_MAX ? g : Math.round((g / t) * n)', replace: '  let lit = g' },
  { name: '版式不是合法 SVG', file: P.plates, find: "'\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\">' + SHAPES[key] + '</svg>'", replace: "'\" stroke-width=\"1.4\">' + SHAPES[key]" }
]

if (process.argv.includes('--selftest')) {
  let bad = 0
  for (const inj of INJECTIONS) {
    let fails
    try { fails = await run(inj) } catch (e) {
      if (/注入锚点失效/.test(e.message)) { console.error(`  ✗ ${e.message}`); bad += 1; continue }
      fails = [String(e.message)]
    }
    if (fails.length) console.log(`  ✓ 检出「${inj.name}」→ ${fails[0]}`)
    else { console.error(`  ✗ 注入「${inj.name}」未被检出`); bad += 1 }
  }
  const clean = await run(null)
  if (clean.length) { console.error('  ✗ 未注入时本应通过：', clean); bad += 1 }
  if (bad) { console.error(`✗ check:atlas-plates 自检失败 ${bad} 项`); process.exit(1) }
  console.log(`✓ check:atlas-plates 自检通过（${INJECTIONS.length} 条内存注入全部检出，未写盘）`)
  process.exit(0)
}

const fails = await run(null)
if (fails.length) {
  console.error('✗ 山海图鉴卷一守卫失败：')
  fails.forEach((f) => console.error('  ' + f))
  process.exit(1)
}
console.log('✓ 山海图鉴卷一：每页都有刻版线描 · 未点亮不剧透 · 标本册按编号固定位置 · 门类与卷章互斥')
