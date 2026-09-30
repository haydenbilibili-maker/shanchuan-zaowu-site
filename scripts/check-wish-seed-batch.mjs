/**
 * 祈福墙预埋弹幕批次守卫（`scripts/wish-wall-seeds/*.json`）
 *
 * 判据（每条都对应一种上墙后才会暴露的缺陷）：
 *   ① 长度：按「字」2–TEXT_MAX（与 manageWishWall/wishSeeds.js 同口径），且弹幕签条估算宽度
 *      ≤ 屏宽（textWidthRpx ≤ SCREEN_RPX，常量从 utils/wishWall.js 源码读）—— 超过一屏宽的签条在弹幕墙里读不完；
 *   ② 形态：已归一化（无零宽/控制字符/多余空白）、无 emoji、无英文字母、无感叹号、不以标点结尾；
 *   ③ 类别：theme 必须是 SEED_WISHES 的六类之一，六类都要有、各类条数差 ≤ 2；
 *   ④ 去重：批内去重（忽略标点）、与基线 SEED_WISHES 去重、跨批次文件去重；
 *   ⑤ 措辞：禁词（促销话术 / 过度承诺 / 宗教迷信）命中即红；「马上有」开头占比 20%–50%（防句式单一）；
 *   ⑥ 元数据：batch 形如 `mashangyou-<名>-YYYY-MM-DD` 且 ≠ 基线批次（整批下线靠它）、productKey 合法；
 *   ⑦ 原文照录批次（`sourcing: "verbatim"`，第三方评论原文）：每条须有 sourceText / source（http 链接，
 *      不得指向 music.163.com —— 不爬其站点）/ song 字段，text 与 sourceText 去标点后逐字相同（只许改标点，
 *      超长原文不选、不截断改写）；_doc 须写明产品负责人的风险确认。
 *      只有这类批次可用 `relax` 放宽 ③ 的「六类齐全且均衡」（themeBalance）与 ⑤ 的开头占比（prefixRatio），
 *      且须写 relaxReason —— 原文不能为凑类别/句式而改写。①②④ 与禁词不放宽。
 *
 * 用法：
 *   node scripts/check-wish-seed-batch.mjs
 *   node scripts/check-wish-seed-batch.mjs --selftest   # 内存注入，不写盘
 */
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const DATA_DIR = resolve(HERE, 'wish-wall-seeds')
const require = createRequire(import.meta.url)
const seeds = require(resolve(ROOT, 'miniprogram/cloudfunctions/manageWishWall/wishSeeds.js'))

function readConst(src, name) {
  const m = new RegExp(`^const ${name} = (\\d+)`, 'm').exec(src)
  if (!m) {
    console.error(`✗ 无法从 utils/wishWall.js 读出 ${name}（判据失去依据，不能当作通过）`)
    process.exit(2)
  }
  return Number(m[1])
}
const wallSrc = readFileSync(resolve(ROOT, 'miniprogram/utils/wishWall.js'), 'utf8')
const SCREEN_RPX = readConst(wallSrc, 'SCREEN_RPX')
const CHAR_RPX = readConst(wallSrc, 'CHAR_RPX')
const SLIP_PAD_RPX = readConst(wallSrc, 'SLIP_PAD_RPX')

const THEMES = [...new Set(seeds.SEED_WISHES.map((s) => s.theme))]
const BASELINE = new Set(seeds.SEED_WISHES.map((s) => s.text))

const BANNED = [
  '暴富', '躺赢', '发财', '稳赚', '保证', '一定会', '必定', '必中', '必过', '包过', '百分百', '100%',
  '灵验', '开光', '转运', '招财', '旺财', '保佑', '菩萨', '佛祖', '神仙', '上帝', '老天爷', '显灵', '还愿',
  '家人们', '宝宝们', '冲鸭', '秒杀', '抢购', '下单', '限量', '优惠', '包邮', '彩票', '中奖', '赌',
  '网易', '云村', '歌词'
]

const RELAXABLE = ['themeBalance', 'prefixRatio']
const RISK_ACK = '确认使用第三方用户评论并承担风险'

const graphemes = (t) => [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(t)].length
const stripPunct = (t) => t.replace(/[\s，,。.、；;：:！!？?…~～·“”"'‘’「」]/g, '')

function checkBatch(batch, fileLabel, others) {
  const fail = []
  const tag = (m) => fail.push(`${fileLabel}：${m}`)
  if (!batch || typeof batch !== 'object') return [`${fileLabel}：不是对象`]
  if (!/^mashangyou-[a-z]+-\d{4}-\d{2}-\d{2}$/.test(String(batch.batch || ''))) tag(`batch 不合法：${batch.batch}`)
  if (batch.batch === seeds.SEED_BATCH) tag('batch 与基线批次同名（整批下线会误伤基线）')
  if (batch.productKey !== 'mashangyou') tag(`productKey 不合法：${batch.productKey}`)
  const items = Array.isArray(batch.items) ? batch.items : []
  if (!items.length) tag('items 为空')
  const verbatim = batch.sourcing === 'verbatim'
  if (batch.sourcing !== undefined && !verbatim) tag(`sourcing 不合法：${batch.sourcing}`)
  const relax = Array.isArray(batch.relax) ? batch.relax : []
  if (batch.relax !== undefined && !Array.isArray(batch.relax)) tag('relax 须为数组')
  for (const r of relax) if (!RELAXABLE.includes(r)) tag(`relax 含不可放宽项「${r}」（只允许 ${RELAXABLE.join('/')}）`)
  if (relax.length && !verbatim) tag('relax 只允许用于原文照录批次（sourcing: "verbatim"）')
  if (relax.length && !String(batch.relaxReason || '').trim()) tag('relax 缺 relaxReason')
  if (verbatim && !String(batch._doc || '').includes(RISK_ACK)) tag(`原文照录批次 _doc 未写明「${RISK_ACK}」`)

  const seen = new Map()
  const perTheme = Object.fromEntries(THEMES.map((t) => [t, 0]))
  let prefixed = 0
  items.forEach((it, i) => {
    const text = String((it && it.text) || '')
    const at = `#${i + 1}「${text}」`
    if (seeds.normalizeSeedText(text) !== text || /\s/.test(text)) tag(`${at} 未归一化（零宽/控制字符/空白）`)
    const n = graphemes(text)
    if (n < seeds.TEXT_MIN || n > seeds.TEXT_MAX) tag(`${at} 字数 ${n} 超出 ${seeds.TEXT_MIN}–${seeds.TEXT_MAX}`)
    const width = text.length * CHAR_RPX + SLIP_PAD_RPX
    if (width > SCREEN_RPX) tag(`${at} 签条估算宽 ${width}rpx > 屏宽 ${SCREEN_RPX}rpx（弹幕一屏读不完）`)
    if (/\p{Extended_Pictographic}/u.test(text)) tag(`${at} 含 emoji（emoji 由 danmakuEmoji 按 id 统一配）`)
    if (/[A-Za-z]/.test(text)) tag(`${at} 含英文字母`)
    if (/[!！]/.test(text)) tag(`${at} 含感叹号`)
    if (/[，,。.、；;：:？?…~～]$/.test(text)) tag(`${at} 以标点结尾`)
    for (const w of BANNED) if (text.includes(w)) tag(`${at} 命中禁词「${w}」`)
    if (!THEMES.includes(it && it.theme)) tag(`${at} theme「${it && it.theme}」不在 ${THEMES.join('/')} 内`)
    else perTheme[it.theme] += 1
    const key = stripPunct(text)
    if (seen.has(key)) tag(`${at} 与 #${seen.get(key)} 重复`)
    else seen.set(key, i + 1)
    if (BASELINE.has(text)) tag(`${at} 与基线 SEED_WISHES 重复`)
    if (others.has(key)) tag(`${at} 与批次 ${others.get(key)} 重复`)
    if (text.startsWith(seeds.SEED_PREFIX)) prefixed += 1
    if (verbatim) {
      const src = String((it && it.sourceText) || '')
      if (!src.trim()) tag(`${at} 缺 sourceText（原文）`)
      else if (stripPunct(src) !== stripPunct(text)) tag(`${at} 与原文不一致（只许改标点）：「${src}」`)
      const url = String((it && it.source) || '')
      if (!/^https?:\/\/\S+$/.test(url)) tag(`${at} 缺来源链接 source`)
      else if (/music\.163\.com/i.test(url)) tag(`${at} 来源指向 music.163.com（不得爬取其站点）`)
      if (!it || !('song' in it)) tag(`${at} 缺 song 字段（未标注写 null）`)
    }
  })
  if (items.length) {
    const counts = Object.values(perTheme)
    const missing = THEMES.filter((t) => !perTheme[t])
    if (!relax.includes('themeBalance')) {
      if (missing.length) tag(`缺类别：${missing.join('、')}`)
      if (Math.max(...counts) - Math.min(...counts) > 2) tag(`类别不均衡：${JSON.stringify(perTheme)}`)
    }
    const ratio = prefixed / items.length
    if (!relax.includes('prefixRatio') && (ratio < 0.2 || ratio > 0.5)) tag(`「${seeds.SEED_PREFIX}」开头占比 ${(ratio * 100).toFixed(0)}% 不在 20%–50%`)
  }
  return fail
}

function loadAll() {
  return readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: `scripts/wish-wall-seeds/${f}`, data: JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8')) }))
}

function run(batches) {
  const fail = []
  const others = new Map()
  const names = new Set()
  for (const b of batches) {
    if (names.has(b.data && b.data.batch)) fail.push(`${b.file}：batch 名与其它文件重复`)
    names.add(b.data && b.data.batch)
    fail.push(...checkBatch(b.data, b.file, others))
    for (const it of (b.data && b.data.items) || []) others.set(stripPunct(String(it.text || '')), b.data.batch)
  }
  return fail
}

function selftest() {
  const base = loadAll()
  if (!base.length) { console.error('✗ 自检：没有批次文件'); process.exit(2) }
  const clone = () => JSON.parse(JSON.stringify(base))
  const origBatch = (bs) => bs.find((b) => !b.data.sourcing).data
  const verbBatch = (bs) => {
    const b = bs.find((x) => x.data.sourcing === 'verbatim')
    if (!b) { console.error('✗ 自检：没有原文照录批次，⑦ 无从注入'); process.exit(2) }
    return b.data
  }
  const first = (bs) => origBatch(bs).items
  const cases = [
    ['超长（超过一屏宽）', (bs) => { first(bs)[0].text = '愿我在这个很长很长很长的冬天里每天都能好好睡觉' }, /屏宽|字数/],
    ['批内重复（仅标点不同）', (bs) => { first(bs)[1].text = first(bs)[0].text.replace('，', '') }, /重复/],
    ['与基线重复', (bs) => { first(bs)[0].text = seeds.SEED_WISHES[0].text }, /基线/],
    ['类别非法', (bs) => { first(bs)[0].theme = '求财' }, /theme/],
    ['含 emoji', (bs) => { first(bs)[0].text = '愿明天是晴天🌞' }, /emoji/],
    ['含零宽字符', (bs) => { first(bs)[0].text = '愿明天\u200B是晴天' }, /归一化/],
    ['禁词：过度承诺', (bs) => { first(bs)[0].text = '马上有好运，保证发财' }, /禁词/],
    ['禁词：宗教', (bs) => { first(bs)[0].text = '愿菩萨听见我的心愿' }, /禁词/],
    ['以标点结尾', (bs) => { first(bs)[0].text = '愿明天是晴天。' }, /标点结尾/],
    ['批次号与基线同名', (bs) => { origBatch(bs).batch = seeds.SEED_BATCH }, /batch/],
    ['类别不均衡', (bs) => { first(bs).forEach((it, i) => { if (i < 8) it.theme = THEMES[1] }) }, /不均衡/],
    ['句式单一（全是马上有）', (bs) => { first(bs).forEach((it, i) => { it.text = `马上有第${'一二三四五六七八九十'[i % 10]}${'甲乙丙丁戊己庚辛壬癸'[Math.floor(i / 10) % 10]}件好事` }) }, /开头占比/],
    ['原创批次偷用 relax', (bs) => { origBatch(bs).relax = ['themeBalance']; origBatch(bs).relaxReason = 'x' }, /relax 只允许/],
    ['relax 放宽长度等不可放宽项', (bs) => { verbBatch(bs).relax.push('length') }, /不可放宽/],
    ['relax 缺理由', (bs) => { delete verbBatch(bs).relaxReason }, /relaxReason/],
    ['原文被改写（改一个字）', (bs) => { const it = verbBatch(bs).items[0]; it.text = it.text.replace(/.$/, '啊') }, /与原文不一致/],
    ['原文被截断', (bs) => { const it = verbBatch(bs).items[0]; it.text = it.text.slice(0, -2) }, /与原文不一致/],
    ['缺来源链接', (bs) => { delete verbBatch(bs).items[0].source }, /来源链接/],
    ['来源指向网易云站点', (bs) => { verbBatch(bs).items[0].source = 'https://music.163.com/#/song?id=1' }, /music\.163\.com/],
    ['缺 song 字段', (bs) => { delete verbBatch(bs).items[0].song }, /song/],
    ['缺风险确认', (bs) => { verbBatch(bs)._doc = '第三方评论' }, /承担风险/],
    ['原文照录批次仍卡长度（超一屏）', (bs) => { const it = verbBatch(bs).items[0]; it.text = it.sourceText = '我在最没有能力的年纪，碰见了最想照顾一生的人' }, /屏宽/]
  ]
  let bad = 0
  const clean = run(clone())
  if (clean.length) { console.error('✗ 自检前置：真源本身不绿\n  ' + clean.join('\n  ')); process.exit(1) }
  for (const [name, mutate, want] of cases) {
    const bs = clone()
    mutate(bs)
    const f = run(bs)
    if (f.some((m) => want.test(m))) console.log(`  ✓ 检出：${name}`)
    else { bad += 1; console.error(`  ✗ 未检出：${name}（得到 ${f.length} 条：${f.slice(0, 2).join(' | ')}）`) }
  }
  if (bad) { console.error(`✗ 自检失败 ${bad}/${cases.length}`); process.exit(1) }
  console.log(`✓ 自检通过：${cases.length} 个注入全部检出（内存注入，未写盘）`)
  process.exit()
}

if (process.argv.includes('--selftest')) selftest()
else {
  const batches = loadAll()
  const fail = run(batches)
  const total = batches.reduce((n, b) => n + ((b.data && b.data.items) || []).length, 0)
  if (fail.length) {
    console.error(`✗ 祈福墙预埋批次：${fail.length} 处问题\n  ` + fail.join('\n  '))
    process.exit(1)
  }
  const relaxed = batches.filter((b) => b.data && Array.isArray(b.data.relax) && b.data.relax.length)
  const note = relaxed.length ? `；原文照录批次 ${relaxed.map((b) => `${b.data.batch}（放宽 ${b.data.relax.join('+')}）`).join('、')} 逐字对原文` : ''
  console.log(`✓ 祈福墙预埋批次：${batches.length} 个文件 / ${total} 条；长度 ≤ 屏宽 ${SCREEN_RPX}rpx、类别 ${THEMES.join('/')} 合法、无重复、无禁词${note}`)
  process.exit()
}
