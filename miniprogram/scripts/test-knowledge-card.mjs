#!/usr/bin/env node
/**
 * 商品知识卡（博物知识卡）排版守卫 —— 2026-10-10 产品负责人「避免文案展示不全 + 白纸博物卡重构」
 *
 * 旧卡的两处根因：云函数把简介按 36 个字硬截（没遇到标点就半句收尾：「…是欧洲常见熊蜂的雌」），
 * 小程序端再按每行固定 18 个字符切行（「Bombus te / rrestris」）。这里用**假字宽**跑
 * subpackages/feature/utils/knowledgeCard.js 的真源排版函数，钉住：
 *   K1 英文按词折行，不在单词中间断开；
 *   K2 行首不出现「，。）」等，行尾不留「（」等；
 *   K3 简介放不下时只在句末（或逗号处加「…」）收尾，不在半句 / 括号里切，且收尾结果是原文前缀；
 *   K4 熊蜂王 / 潮痕两件真实商品：简介去掉与标题重复的学名，行拼回 = 展示文本（不丢字）；
 *   K5 缺学名 / 分类 / 简介时不留大空白（剩余高度上下均分）；
 *   K6 详情页走新模块、不再有按字数切行；画布 750×1200 不变；小程序码仍指向商品详情 + 商品 id
 *      （码的路由另由 test:legacy-remap 覆盖）；小程序码四周留白足够；
 *   K7 模块在分包内（不进主包）。
 *
 * 用法：node miniprogram/scripts/test-knowledge-card.mjs [--selftest]（自检为内存注入，不写盘）
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const REL = {
  lib: 'subpackages/feature/utils/knowledgeCard.js',
  page: 'subpackages/feature/detail/index.js',
  wxss: 'subpackages/feature/detail/index.wxss',
  cardFn: 'cloudfunctions/generateShareCard/index.js',
  appJson: 'app.json'
}
const readSources = () => Object.fromEntries(Object.entries(REL).map(([k, p]) => [k, readFileSync(resolve(MP, p), 'utf8')]))

function loadLib(src) {
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', src)(module, module.exports)
  return module.exports
}

/** 假字宽：汉字与全角标点 = 字号，拉丁字母 0.55，空格 0.3 */
function fakeMeasure(text, font) {
  const m = /(\d+(?:\.\d+)?)px/.exec(font || '')
  const size = m ? Number(m[1]) : 24
  let w = 0
  for (const ch of String(text)) {
    if (/\s/.test(ch)) w += size * 0.3
    else if (/[\x21-\x7e\u00c0-\u024f]/.test(ch)) w += size * 0.55
    else w += size
  }
  return w
}

const BEE = {
  _id: '025756256ac9e3bb0001641a4e3f5d7c',
  title: '熊蜂王',
  latinName: 'Bombus terrestris',
  category: '膜翅目 · 蜂蚁',
  origin: '欧洲',
  taxonomy: { class: '昆虫纲', family: '蜜蜂科', genus: '熊蜂属', kingdom: '动物界', order: '膜翅目', phylum: '节肢动物门' },
  description: '熊蜂王（ 地熊蜂 Bombus terrestris）是欧洲常见熊蜂的雌性繁殖个体，体型显著大于工蜂，体长可达2.5厘米，头胸覆浓密黄黑相间绒毛，腹部末端具黑色宽环。翅膜略呈烟褐色，飞行时发出低频嗡鸣。其口器发达，适于深花冠取食；越冬后单独筑巢，产卵建立新群。'
}
const TIDE = {
  _id: '096043316ac7d9ab04ee5db16a7a6449',
  title: '潮痕',
  latinName: 'Beach sediment assemblage',
  category: '岩石标本',
  origin: '',
  taxonomy: { class: '', family: '', genus: '', kingdom: '', order: '', phylum: '' },
  description: '海滩（Beach sediment assemblage）是海岸带经波浪、潮汐长期作用形成的松散沉积物集合体，主要由石英砂、贝壳碎屑、砾石及少量矿物颗粒组成。触感粗粝或细腻依粒径而异，色泽呈浅褐、灰白或淡金，常伴盐霜结晶与潮间带生物残骸痕迹。无固定生物归属，属地质过程产物。'
}
const MIXED = '中华虎凤蝶（Luehdorfia chinensis Leech, 1893）是中国特有的早春蝶种，Papilionidae family members include Graphium sarpedon and Troides aeacus，翅面以黄黑相间的虎斑纹为主。'

const LATIN = /[A-Za-z0-9\u00C0-\u024F'’\-.%°]/
const NO_START = '，。、；：！？）》」』】〕”’,.;:!?)…—～%·'
const OPENERS = '（(《「『【〔“‘'

function assetsOf(p, KC) {
  return {
    productId: p._id,
    title: p.title,
    latinName: p.latinName,
    category: p.category,
    taxonomy: p.taxonomy,
    origin: p.origin,
    caption: KC.pickCaptionSource(p, { description: p.description }),
    hasQr: true
  }
}

function run(src) {
  const problems = []
  const t = (ok, msg) => { if (!ok) problems.push(msg) }
  let KC
  try {
    KC = loadLib(src.lib)
  } catch (e) {
    return [`模块无法加载：${e.message}`]
  }

  /* K1 / K2：多种宽度下折行 */
  const texts = [BEE.description, TIDE.description, MIXED]
  const widths = [180, 260, 333, 420, 590]
  texts.forEach((txt, ti) => {
    widths.forEach((w) => {
      const norm = KC.normalizeCardText(txt)
      const lines = KC.wrapText(norm, w, (s) => fakeMeasure(s, '24px x'))
      const joinedNoSpace = lines.join('').replace(/\s+/g, '')
      t(joinedNoSpace === norm.replace(/\s+/g, ''), `K1 文本 ${ti} 宽 ${w}：折行后丢字或多字`)
      let pos = 0
      for (let i = 0; i < lines.length - 1; i += 1) {
        const a = lines[i]
        const b = lines[i + 1]
        while (/\s/.test(norm[pos] || '')) pos += 1
        const at = norm.indexOf(a, pos)
        const end = at < 0 ? -1 : at + a.length
        if (end > 0) pos = end
        if (end > 0 && !/\s/.test(norm[end] || '') && LATIN.test(norm[end - 1]) && LATIN.test(norm[end] || '')) {
          const word = (a.match(/[A-Za-z0-9\u00C0-\u024F'’\-.%°]+$/) || [''])[0] + (b.match(/^[A-Za-z0-9\u00C0-\u024F'’\-.%°]+/) || [''])[0]
          t(fakeMeasure(word, '24px x') > w, `K1 文本 ${ti} 宽 ${w}：英文单词被拆在两行「${a.slice(-8)} / ${b.slice(0, 8)}」`)
        }
        t(!NO_START.includes(b[0]), `K2 文本 ${ti} 宽 ${w}：第 ${i + 2} 行以标点「${b[0]}」开头`)
        t(!OPENERS.includes(a[a.length - 1]), `K2 文本 ${ti} 宽 ${w}：第 ${i + 1} 行以「${a[a.length - 1]}」结尾`)
      }
    })
  })
  {
    const lines = KC.wrapText('熊蜂王（地熊蜂 Bombus terrestris）是欧洲常见熊蜂', 18 * 24 * 0.55 + 7 * 24, (s) => fakeMeasure(s, '24px x'))
    t(!lines.some((l) => /Bombus te$/.test(l)) && !lines.some((l) => /^rrestris/.test(l)), `K1 旧缺陷复现：${JSON.stringify(lines)}`)
  }

  /* K3：收尾 */
  const capCases = [
    { txt: BEE.description, h: 3 * 39 },
    { txt: BEE.description, h: 2 * 39 },
    { txt: TIDE.description, h: 4 * 39 },
    { txt: KC.stripTitleEcho(TIDE.description, TIDE.title, TIDE.latinName), h: 2 * 39 },
    { txt: '虎凤蝶，又名（中华虎凤蝶，俗名国宝蝴蝶，分布于长江中下游，春季出现）是中国特有种。', h: 2 * 39 },
    { txt: '这是一段没有句号但有逗号的说明，用来验证分句收尾，宽度很窄的时候也只能在逗号处加省略号，不能硬切在半句中间，再补一句足够长的话让它放不下', h: 2 * 39 }
  ]
  capCases.forEach((c, ci) => {
    const fit = KC.fitCaption(KC.normalizeCardText(c.txt), { maxWidth: 400, maxHeight: c.h, measure: fakeMeasure })
    const src0 = KC.normalizeCardText(c.txt)
    t(fit.lines.length * fit.lineHeight <= c.h, `K3 用例 ${ci}：简介超出可用高度`)
    if (fit.truncated && fit.text) {
      const last = fit.text[fit.text.length - 1]
      t('。！？!?…'.includes(last), `K3 用例 ${ci}：收尾不在句末也没有「…」：「${fit.text.slice(-10)}」`)
      const body = fit.text.replace(/[。…]$/, '')
      t(src0.startsWith(body), `K3 用例 ${ci}：收尾结果不是原文前缀`)
      const next = src0[body.length]
      t(fit.cut === 'word' || '。！？!?；;，,：:'.includes(next), `K3 用例 ${ci}：在半句中间切断（切点后是「${next}」）`)
      const open = (body.match(/[（(]/g) || []).length
      const close = (body.match(/[）)]/g) || []).length
      t(open === close, `K3 用例 ${ci}：切在括号里面`)
      t(fit.cut !== 'word', `K3 用例 ${ci}：有标点可用却退到按词硬切`)
    }
    if (!fit.truncated) t(fit.text === src0, `K3 用例 ${ci}：未收尾却改动了文本`)
  })

  /* K4：真实商品 */
  ;[BEE, TIDE].forEach((p) => {
    const L = KC.layoutKnowledgeCard(assetsOf(p, KC), fakeMeasure, 1)
    const cap = L.caption
    t(cap.lines.length >= 2, `K4 ${p.title}：简介只剩 ${cap.lines.length} 行`)
    t(!cap.text.includes(p.latinName), `K4 ${p.title}：简介仍重复学名「${p.latinName}」`)
    t(cap.lines.join('').replace(/\s+/g, '') === cap.text.replace(/\s+/g, ''), `K4 ${p.title}：简介行拼回 ≠ 展示文本`)
    t(!cap.truncated || '。！？…'.includes(cap.text.slice(-1)), `K4 ${p.title}：简介半句收尾「${cap.text.slice(-8)}」`)
    const titles = L.blocks.filter((b) => b.role === 'title').map((b) => b.text).join('')
    t(titles === p.title, `K4 ${p.title}：标题被截`)
    const latin = L.blocks.filter((b) => b.role === 'latin').map((b) => b.text).join(' ')
    t(latin === p.latinName, `K4 ${p.title}：学名展示为「${latin}」`)
    const bottom = Math.max(...L.blocks.filter((b) => b.role === 'caption').map((b) => b.y))
    t(bottom < L.stamp.y - 20, `K4 ${p.title}：简介压到页脚`)
  })
  t(KC.stripTitleEcho(BEE.description, BEE.title, BEE.latinName).startsWith('熊蜂王（地熊蜂）是'), 'K4 熊蜂王：括号里去学名后应保留别名「（地熊蜂）」')
  t(KC.stripTitleEcho(TIDE.description, TIDE.title, TIDE.latinName).startsWith('海滩是海岸带'), 'K4 潮痕：括号只有学名时整对去掉')

  /* K5：缺字段降级 */
  {
    const bare = KC.layoutKnowledgeCard({ productId: 'x1', title: '孔雀石原矿', latinName: '', category: '', taxonomy: null, origin: '', caption: '', hasQr: true }, fakeMeasure, 1.2)
    t(!bare.blocks.some((b) => b.role === 'latin' || b.role === 'meta' || b.role === 'caption'), 'K5 缺字段时仍画出空的学名 / 分类 / 简介行')
    const top = bare.mat.y - 140
    const lastY = Math.max(...bare.blocks.map((b) => b.y))
    const bottomGap = 972 - 26 - lastY
    t(top > 20, `K5 缺字段时内容没有居中（上方仅 ${top}px，空白全堆在下面）`)
    t(bottomGap < 200, `K5 缺字段时下方留白 ${Math.round(bottomGap)}px 过大`)
    const noLatin = KC.layoutKnowledgeCard({ ...assetsOf(TIDE, KC), latinName: '' }, fakeMeasure, 1)
    t(!noLatin.blocks.some((b) => b.role === 'latin'), 'K5 缺学名时仍画学名行')
  }

  /* K6：接线与契约 */
  const page = src.page
  t(/require\(['"]\.\.\/utils\/knowledgeCard['"]\)/.test(page), 'K6 详情页没有引用 utils/knowledgeCard')
  t(/drawKnowledgeCard\(ctx,\s*a,/.test(page), 'K6 renderKnowledgeCard 没有调用 drawKnowledgeCard')
  t(/caption:\s*pickCaptionSource\(product,\s*remote\)/.test(page), 'K6 知识卡简介没有走 pickCaptionSource（会退回云端 36 字硬截版）')
  t(!/wrapCardLines|CARD_CAPTION_CHARS_PER_LINE|\.slice\(i,\s*i\s*\+\s*maxChars\)/.test(page), 'K6 详情页又出现按固定字数切行')
  t(KC.CARD_W === 750 && KC.CARD_H === 1200, 'K6 卡面尺寸改了（应 750×1200）')
  t(/const W = CARD_W;[\s\S]{0,40}const H = CARD_H;/.test(page), 'K6 initPosterCanvas 没用卡面尺寸常量')
  t(/\.poster-canvas\s*\{[^}]*width:\s*750px;[^}]*height:\s*1200px;/.test(src.wxss), 'K6 .poster-canvas 尺寸不是 750×1200px')
  t(/page:\s*'subpackages\/feature\/detail\/index'/.test(src.cardFn), 'K6 generateShareCard 小程序码 page 不再指向商品详情')
  t(/const scene = String\(productId/.test(src.cardFn), 'K6 generateShareCard 小程序码 scene 不再是商品 id')
  const L0 = KC.layoutKnowledgeCard(assetsOf(BEE, KC), fakeMeasure, 1)
  t(L0.stamp && L0.stamp.qr >= 120 && L0.stamp.pad >= 8, 'K6 小程序码过小或四周白边不足')
  t(L0.stamp && L0.stamp.x + L0.stamp.size <= 750 - 40 && L0.stamp.y + L0.stamp.size + 30 <= 1200 - 30, 'K6 邮票框超出内框')

  /* K7：分包 */
  const app = JSON.parse(src.appJson)
  const subs = (app.subpackages || app.subPackages || []).map((s) => s.root.replace(/\/$/, ''))
  t(subs.some((r) => REL.lib.startsWith(`${r}/`)), 'K7 知识卡模块不在分包里（会计入主包）')

  return problems
}

const base = readSources()

if (process.argv.includes('--selftest')) {
  const clean = run(base)
  let ok = clean.length === 0
  console.log(`${ok ? '✓' : '✗'} 真源通过${clean.length ? `：${clean.join(' | ')}` : ''}`)
  const cases = [
    ['英文词不再成组（退回逐字切）', 'lib', 'if (LATIN_CHAR.test(ch)) {', 'if (false) {'],
    ['去掉避头悬挂', 'lib', 'if (NO_LINE_START.includes(tok)) {', 'if (false) {'],
    ['句末收尾改成多切 3 个字', 'lib', 'const s = closeSentence(t.slice(0, c.end))', 'const s = closeSentence(t.slice(0, c.end + 3))'],
    ['括号里也当可收尾处', 'lib', '    if (depth > 0) continue\n', '\n'],
    ['不再去掉重复学名', 'lib', 'if (m && m.index <= 40) {', 'if (false) {'],
    ['剩余高度不再上下均分', 'lib', 'let y = G.contentTop + Math.round(slack / 2)', 'let y = G.contentTop'],
    ['邮票框白边缩没', 'lib', '  stampPad: 10\n', '  stampPad: 2\n'],
    ['详情页不再调用新绘制', 'page', 'drawKnowledgeCard(ctx, a, { image, qr });', ''],
    ['简介退回云端截好的 cardCaption', 'page', 'caption: pickCaptionSource(product, remote),', 'caption: remote && remote.cardCaption,'],
    ['小程序码改指向鉴定结果页', 'cardFn', "page: 'subpackages/feature/detail/index'", "page: 'subpackages/feature/identify/result/index'"],
    ['画布尺寸被改', 'wxss', 'width: 750px; height: 1200px;', 'width: 750px; height: 1334px;']
  ]
  cases.forEach(([name, key, from, to]) => {
    if (!base[key].includes(from)) {
      ok = false
      console.log(`✗ 注入锚点失效：${name}`)
      return
    }
    const probs = run({ ...base, [key]: base[key].replace(from, to) })
    const caught = probs.length > 0
    if (!caught) ok = false
    console.log(`${caught ? '✓' : '✗'} 注入「${name}」${caught ? `→ 检出：${probs[0]}` : ' → 未检出'}`)
  })
  console.log(ok ? '✓ selftest 通过' : '✗ selftest 失败')
  process.exit(ok ? 0 : 1)
}

const problems = run(base)
if (problems.length) {
  console.error(`✗ test:knowledge-card ${problems.length} 处问题：`)
  problems.forEach((p) => console.error(`  - ${p}`))
  process.exit(1)
}
console.log('✓ test:knowledge-card 通过（英文按词折行 / 避头尾标点 / 句末收尾 / 学名去重 / 缺字段降级 / 详情页接线 / 小程序码指向商品详情 / 分包）')
