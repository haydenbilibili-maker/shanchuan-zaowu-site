/**
 * 博物君 · 标本工坊（2026-11-23，产品负责人「在博物君模块新增标本体验游戏，参考标本师页面的标本制作灵感模块，
 * 让用户可以体验标本制作，标本体验，标本灵感，然后打通商品推荐和购买动线」）
 * 纯函数（无 wx / 无网络），守卫 test:museum-guide 直接 require。
 *
 *   制作体验：选一只蝶 → 回软 → 展翅 → 下针 → 干燥 → 装裱，五步小操作各 20 分，出一张「作品卡」
 *   陈列体验：选空间 / 气质 / 预算 → 一份陈列方案
 *   标本灵感：抽一张灵感签（图鉴里的一件 × 一种真实存在的制作工艺）
 * 三条路的终点都是**馆里真的在卖的藏品**（getEncyclopediaFeed 关键词 + 装裱方式 + 价格区间，逐级放宽），
 * 点藏品进详情页，加购 / 购买走原有电商链路（不改）。
 *
 * 口径：装裱方式 / 制作工艺的 key 与商品库 productTaxonomy 的 craftType / craftProcess 一致（守卫比对）；
 * 工艺说明只写通用、确定的事实，不写具体配方与时长承诺。
 */

/** 装裱方式（商品库 craftType）—— 制作体验的最后一步与陈列体验共用 */
const CRAFTS = [
  { key: 'frame', label: '相框', desc: '展平后封进框里，适合挂墙或立在书架上' },
  { key: 'cloche', label: '方形玻璃罩', desc: '立体陈列，四面都能看，适合桌面' },
  { key: 'cloche_round', label: '圆形玻璃罩', desc: '圆罩更柔和，适合单只主角' },
  { key: 'wing_art', label: '蝶翅画', desc: '用蝶翅拼成一幅画，挂起来像一幅小品' },
  { key: 'diorama', label: '造景', desc: '配上苔藓、枝叶，还原它的栖息环境' }
]

/** 衬底：只影响作品卡样式 */
const BACKDROPS = [
  { key: 'linen', label: '米白亚麻' },
  { key: 'ink', label: '墨黑绒面' },
  { key: 'wood', label: '原木' }
]

/** 制作工艺（商品库 craftProcess 的子集）× 适用门类 —— 灵感签用 */
const PROCESSES = [
  { key: 'pinned', label: '针插', desc: '昆虫标本最常见的做法：用昆虫针固定姿态，再慢慢干燥定形。', cats: ['昆虫'] },
  { key: 'pressed', label: '压制', desc: '把植物压平脱水，做成可以长久保存的腊叶标本。', cats: ['植物'] },
  { key: 'resin_embed', label: '包埋', desc: '封进透明树脂里，小件也能拿在手上多角度看。', cats: ['昆虫', '植物', '海洋'] },
  { key: 'immersion', label: '浸制', desc: '浸在保存液里，能留住柔软组织的形态，常见于海洋生物。', cats: ['海洋'] }
]

/** 陈列体验的选项 */
const SPACES = [
  { key: 'study', label: '书房', crafts: ['frame', 'cloche'], line: '书架一格或案头一角' },
  { key: 'living', label: '客厅', crafts: ['cloche', 'diorama'], line: '茶几或边柜上，客人一进门就能看见' },
  { key: 'bedroom', label: '卧室', crafts: ['frame', 'wing_art'], line: '床头墙面，抬头就能看见' },
  { key: 'gift', label: '送礼', crafts: ['cloche_round', 'frame'], line: '一件能讲出故事的礼物' }
]
const MOODS = [
  { key: 'calm', label: '沉静', keyword: '贝', cat: '海洋', line: '颜色收着、线条安静的一件' },
  { key: 'bright', label: '明亮', keyword: '蝶', cat: '昆虫', line: '一抹会随光线变化的颜色' },
  { key: 'ancient', label: '古雅', keyword: '石', cat: '矿石', line: '有年代感、经得起细看的一件' },
  { key: 'wild', label: '野趣', keyword: '甲', cat: '昆虫', line: '带一点山野气的生灵' }
]
const BUDGETS = [
  { key: 'b1', label: '¥300 以内', min: null, max: 300 },
  { key: 'b2', label: '¥300–1000', min: 300, max: 1000 },
  { key: 'b3', label: '¥1000–3000', min: 1000, max: 3000 },
  { key: 'b4', label: '不限', min: null, max: null }
]

/* ------------------------------ 制作体验 ------------------------------ */

/** 可做的蝶：图鉴昆虫里名字带「蝶 / 蛾」的（展翅这套步骤只对鳞翅目成立） */
function makeableSpecies(species) {
  return (species || []).filter((s) => s.category === '昆虫' && /蝶|蛾/.test(s.nameZh))
}

/** 五步的说明与判分。每步 0–20 分；文字只写通用、确定的做法 */
const STEPS = [
  { key: 'relax', title: '回软', how: '按住「回软」，松手停在刚好的时候', why: '干燥的标本翅膀很脆，先放进回软盒吸一点湿气，才展得开。', unit: '秒' },
  { key: 'spread', title: '展翅', how: '拖动，让前翅后缘与身体垂直', why: '常见的展翅标准：前翅后缘与身体成直角，后翅前缘略压在前翅下。', unit: '°' },
  { key: 'pin', title: '下针', how: '针移到正中时点「下针」', why: '昆虫针从胸部正中穿过，左右偏了，展翅就会歪。', unit: '' },
  { key: 'dry', title: '干燥', how: '选一个干燥天数', why: '在展翅板上压条固定、放在干燥处，等它彻底干透再取下；天数随湿度不同。', unit: '天' },
  { key: 'frame', title: '装裱', how: '选一种装裱和衬底', why: '装裱决定它以后怎么被看见。没有对错，只有合不合适。', unit: '' }
]

/** 回软：按住时长（毫秒），1.8–2.6 秒满分 */
function scoreRelax(ms) {
  const s = (ms || 0) / 1000
  if (s >= 1.8 && s <= 2.6) return { score: 20, note: '回软刚好，翅膀能舒展了' }
  if (s >= 1.2 && s <= 3.4) return { score: 14, note: s < 1.8 ? '还有点脆，勉强能展' : '稍微受潮，好在没有变形' }
  return { score: 6, note: s < 1.2 ? '太脆了，翅缘有一点裂' : '受潮过头，鳞片掉了一些' }
}

/** 展翅：前翅后缘与身体夹角（度），90° 满分，每偏 1° 扣 1 分 */
function scoreSpread(deg) {
  const d = Math.abs((Number(deg) || 0) - 90)
  const score = Math.max(4, 20 - Math.round(d))
  return { score, note: d <= 3 ? '左右对称，标准的展翅' : (d <= 10 ? '略有一点倾斜，看得出是手作' : '翅膀明显歪了') }
}

/** 下针：针的位置 0–100，50 为胸部正中 */
function scorePin(pos) {
  const d = Math.abs((Number(pos) || 0) - 50)
  if (d <= 5) return { score: 20, note: '正中胸部，稳' }
  if (d <= 15) return { score: 14, note: '略偏一点，还算端正' }
  return { score: 6, note: '偏得多了，身体有点斜' }
}

/** 干燥：天数，7–14 天满分 */
function scoreDry(days) {
  const n = Number(days) || 0
  if (n >= 7 && n <= 14) return { score: 20, note: '干透了，取下时姿态稳稳的' }
  if (n >= 4 && n <= 21) return { score: 13, note: n < 7 ? '还没干透，取下后翅膀回弹了一点' : '放得久了点，没关系' }
  return { score: 5, note: n < 4 ? '没干就取下，翅膀垂了' : '放太久，落了一层灰' }
}

/** 装裱：选了就满分（没有对错） */
function scoreFrame(craftKey) {
  const c = CRAFTS.find((x) => x.key === craftKey)
  return c ? { score: 20, note: `装进${c.label}：${c.desc}` } : { score: 0, note: '还没选装裱' }
}

/** 总分 → 等级 */
function gradeOf(total) {
  if (total >= 90) return { key: 'museum', label: '馆藏级', line: '可以进标本柜的水准。' }
  if (total >= 70) return { key: 'display', label: '陈列级', line: '放在家里，经得起客人细看。' }
  return { key: 'study', label: '习作级', line: '每位标本师都从习作开始。' }
}

/** 一张作品卡 */
function buildWork(species, results, craftKey, backdropKey, now) {
  const total = (results || []).reduce((n, r) => n + ((r && r.score) || 0), 0)
  const craft = CRAFTS.find((x) => x.key === craftKey) || CRAFTS[0]
  const backdrop = BACKDROPS.find((x) => x.key === backdropKey) || BACKDROPS[0]
  const d = new Date((now || Date.now()) + 8 * 3600 * 1000)
  return {
    no: species.no,
    nameZh: species.nameZh,
    nameLatin: species.nameLatin || '',
    total,
    grade: gradeOf(total),
    craft,
    backdrop,
    notes: (results || []).map((r, i) => ({ step: STEPS[i].title, score: r.score, note: r.note })),
    dateText: `${d.getUTCFullYear()}.${d.getUTCMonth() + 1}.${d.getUTCDate()}`,
    askQ: `${species.nameZh}的标本是怎么做的？`,
    intent: { keyword: species.nameZh, fallbackKeyword: '蝶', craftType: craft.key }
  }
}

/**
 * 作品图形（2026-11-25 产品负责人：做好了之后最好有一个图形展示）
 * 纯函数生成内联 SVG（data:image/svg+xml）：衬底取 backdrop，外框取 craft，中间一只蝶。
 * 不引入任何位图资源，颜色全部走品牌铜金 + 纸色/墨色/木色三档衬底。
 */
const GRAPHIC_BG = { linen: '#EFE6D2', ink: '#1B1916', wood: '#B98E63' }
const GRAPHIC_LINE = '#B08D57'

function butterfly(cx, cy, scale, color) {
  const s = (n) => Math.round(n * scale * 10) / 10
  const wing = (dx, dy, rx, ry, rot) =>
    `<ellipse cx="${cx + s(dx)}" cy="${cy + s(dy)}" rx="${s(rx)}" ry="${s(ry)}" transform="rotate(${rot} ${cx + s(dx)} ${cy + s(dy)})" fill="${color}" opacity="0.92"/>`
  return [
    wing(-26, -14, 26, 16, -22),
    wing(26, -14, 26, 16, 22),
    wing(-22, 16, 20, 14, 14),
    wing(22, 16, 20, 14, -14),
    `<rect x="${cx - s(3)}" y="${cy - s(26)}" width="${s(6)}" height="${s(52)}" rx="${s(3)}" fill="#2E2618" opacity="0.8"/>`,
    `<path d="M${cx - s(2)} ${cy - s(26)} q ${-s(10)} ${-s(12)} ${-s(16)} ${-s(16)}" stroke="#2E2618" stroke-width="1.6" fill="none" opacity="0.7"/>`,
    `<path d="M${cx + s(2)} ${cy - s(26)} q ${s(10)} ${-s(12)} ${s(16)} ${-s(16)}" stroke="#2E2618" stroke-width="1.6" fill="none" opacity="0.7"/>`
  ].join('')
}

function workGraphic(work) {
  const w = work || {}
  const bg = GRAPHIC_BG[(w.backdrop && w.backdrop.key) || 'linen'] || GRAPHIC_BG.linen
  const craft = (w.craft && w.craft.key) || 'cloche'
  const dark = bg === GRAPHIC_BG.ink
  const mat = dark ? '#26231F' : '#F7F0E0'
  const parts = []
  parts.push(`<rect x="0" y="0" width="320" height="200" fill="${bg}"/>`)

  if (craft === 'frame') {
    parts.push(`<rect x="26" y="22" width="268" height="156" rx="4" fill="none" stroke="${GRAPHIC_LINE}" stroke-width="5"/>`)
    parts.push(`<rect x="40" y="36" width="240" height="128" fill="${mat}" stroke="${GRAPHIC_LINE}" stroke-width="1.5" opacity="0.9"/>`)
    parts.push(butterfly(160, 100, 1, '#C9A227'))
  } else if (craft === 'cloche_round') {
    parts.push(`<circle cx="160" cy="102" r="76" fill="${mat}" stroke="${GRAPHIC_LINE}" stroke-width="3"/>`)
    parts.push(`<path d="M96 62 q 22 -26 52 -30" stroke="#FFFFFF" stroke-width="4" fill="none" opacity="0.5"/>`)
    parts.push(butterfly(160, 104, 0.82, '#C9A227'))
  } else if (craft === 'wing_art') {
    parts.push(`<rect x="30" y="24" width="260" height="152" rx="4" fill="${mat}" stroke="${GRAPHIC_LINE}" stroke-width="2"/>`)
    parts.push(butterfly(104, 100, 0.7, '#C9A227'))
    parts.push(butterfly(216, 100, 0.7, '#B08D57'))
  } else if (craft === 'diorama') {
    parts.push(`<rect x="26" y="22" width="268" height="156" rx="6" fill="${mat}" stroke="${GRAPHIC_LINE}" stroke-width="3"/>`)
    parts.push(`<path d="M26 150 q 60 -26 134 -24 q 74 2 134 24 l0 28 l-268 0 z" fill="#6E7F52" opacity="0.55"/>`)
    parts.push(`<path d="M60 150 q 6 -30 18 -44 M250 152 q -8 -28 -20 -42" stroke="#4E5A3A" stroke-width="3" fill="none" opacity="0.8"/>`)
    parts.push(butterfly(160, 96, 0.72, '#C9A227'))
  } else {
    // cloche 方形玻璃罩（默认）
    parts.push(`<rect x="46" y="26" width="228" height="148" rx="6" fill="${mat}" stroke="${GRAPHIC_LINE}" stroke-width="3"/>`)
    parts.push(`<path d="M62 40 q 18 -8 40 -8" stroke="#FFFFFF" stroke-width="4" fill="none" opacity="0.45"/>`)
    parts.push(butterfly(160, 100, 0.86, '#C9A227'))
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">${parts.join('')}</svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

/* ------------------------------ 陈列体验 ------------------------------ */

function buildDisplayPlan(spaceKey, moodKey, budgetKey) {
  const space = SPACES.find((x) => x.key === spaceKey)
  const mood = MOODS.find((x) => x.key === moodKey)
  const budget = BUDGETS.find((x) => x.key === budgetKey) || BUDGETS[3]
  if (!space || !mood) return null
  const craft = CRAFTS.find((x) => x.key === space.crafts[0])
  return {
    title: `${space.label} · ${mood.label}`,
    line: `${space.line}，放${mood.line}。装在${craft.label}里：${craft.desc}。`,
    care: '避开直射阳光和潮湿处，标本的颜色和形态能留得更久。',
    budgetText: budget.label,
    intent: { keyword: mood.keyword, fallbackKeyword: '', craftType: craft.key, altCraftType: space.crafts[1] || '', priceMin: budget.min, priceMax: budget.max }
  }
}

/* ------------------------------ 标本灵感 ------------------------------ */

/** 抽一张灵感签：图鉴里的一件 × 适用于它门类的一种工艺（矿石没有「制作」，用原石陈列） */
function drawInspiration(species, rand) {
  const list = species || []
  if (!list.length) return null
  const r = typeof rand === 'function' ? rand : Math.random
  const sp = list[Math.floor(r() * list.length)]
  const procs = PROCESSES.filter((p) => p.cats.indexOf(sp.category) >= 0)
  const proc = procs.length ? procs[Math.floor(r() * procs.length)] : null
  const essay = String(sp.essay || '')
  const firstLine = essay.split('。').filter(Boolean)[0] || ''
  return {
    no: sp.no,
    nameZh: sp.nameZh,
    nameLatin: sp.nameLatin || '',
    category: sp.category,
    process: proc ? proc.label : '原石陈列',
    processDesc: proc ? proc.desc : '矿物不用「制作」：清理干净、配一个底座，让它本来的晶形说话。',
    line: firstLine ? firstLine + '。' : '',
    askQ: proc ? `${sp.nameZh}可以做成${proc.label}标本吗？` : `${sp.nameZh}怎么陈列好看？`,
    intent: { keyword: sp.nameZh, fallbackKeyword: ({ 昆虫: '蝶', 植物: '押花', 海洋: '贝', 矿石: '石' })[sp.category] || '', craftType: '', processKey: proc ? proc.key : '' }
  }
}

/* ------------------------------ 商品推荐 ------------------------------ */

/**
 * 推荐查询的放宽顺序（getEncyclopediaFeed 入参）：
 *   关键词 + 装裱 + 价格 → 关键词 + 价格 → 备用关键词 + 装裱 + 价格 → 备用关键词 + 价格 → 只按装裱 + 价格
 * 页面从第一条开始查，凑够 4 件为止；同一件不重复。
 */
function productQueries(intent) {
  const it = intent || {}
  const price = {}
  if (it.priceMin != null) price.priceMin = it.priceMin
  if (it.priceMax != null) price.priceMax = it.priceMax
  const base = Object.assign({ contentLimit: 0, productLimit: 6 }, price)
  const out = []
  const push = (q) => {
    const key = JSON.stringify(q)
    if (!out.some((x) => JSON.stringify(x) === key)) out.push(q)
  }
  const kws = [it.keyword, it.fallbackKeyword].filter(Boolean)
  const crafts = [it.craftType, it.altCraftType].filter(Boolean)
  kws.forEach((kw) => {
    crafts.forEach((c) => push(Object.assign({}, base, { keyword: kw, craftType: c })))
    push(Object.assign({}, base, { keyword: kw }))
  })
  crafts.forEach((c) => push(Object.assign({}, base, { craftType: c })))
  if (!out.length) push(base)
  return out
}

/** 合并多次查询结果：去重、有货在前、最多 4 件；转成商品卡要的字段 */
function mergeProducts(batches, toImage) {
  const seen = new Set()
  const all = []
  ;(batches || []).forEach((rows) => (rows || []).forEach((p) => {
    if (!p || !p._id || seen.has(p._id)) return
    seen.add(p._id)
    all.push(p)
  }))
  const inStock = all.filter((p) => !p.soldOut)
  const sold = all.filter((p) => p.soldOut)
  return inStock.concat(sold).slice(0, 4).map((p) => Object.assign({}, p, {
    // 没图就留空（商品卡出占位），不把 undefined 交给缩略图函数拼出一个坏地址
    httpImage: !p.displayImage ? '' : (typeof toImage === 'function' ? toImage(p.displayImage) : p.displayImage)
  }))
}

module.exports = {
  workGraphic,
  GRAPHIC_BG,
  CRAFTS,
  BACKDROPS,
  PROCESSES,
  SPACES,
  MOODS,
  BUDGETS,
  STEPS,
  makeableSpecies,
  scoreRelax,
  scoreSpread,
  scorePin,
  scoreDry,
  scoreFrame,
  gradeOf,
  buildWork,
  buildDisplayPlan,
  drawInspiration,
  productQueries,
  mergeProducts
}
