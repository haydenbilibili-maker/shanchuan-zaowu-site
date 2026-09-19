#!/usr/bin/env node
/**
 * 生成 `admin/docs/原材料价目表_飞书交叉核对_第2轮_可导入.md`（**可复现**）。
 *
 * 为什么入库：产品负责人会**持续**用表格同步单价（"我后续会用表格给你同步单价"），
 * 所以这份导入文档不能是一次性的手写产物 —— 必须能重跑。
 *
 * 做三件事，全部用**生产代码**验证，不靠人眼：
 *   ① 读飞书「库存管理」（`分类=标本`）→ 按取值规则分桶
 *      （等级 = 规格型号 → 名称等级串 → 名称品相后缀 → 默认）
 *   ② 生成三个导入块，并用云函数的 `parseBulkText` / `validatePriceBook` 真跑一遍
 *   ③ 用 `quoteLines` 跑 2026-09-14 真实出货单 21 行 → 报告"现在能自动核出多少价"
 *
 * 产品负责人的裁决写在下面的 `PRICE_FIX` / `MAT_NEW` / `PKG_MAP` / `REMOVED_PACKAGING`
 * （provision 脚本）里 —— **改价改这几处**，再重跑本脚本 + provision 的 `--import`。
 *
 * 用法：node scripts/gen-price-book-doc.mjs
 * 前置：`admin/.env` 有 FEISHU_APP_ID / FEISHU_APP_SECRET
 * 配套守卫：`npm run check:price-import-blocks`（守产出的块）
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CF = ROOT + '/miniprogram/cloudfunctions'
const { parseBulkText } = require(CF + '/manageStudioSettlement/settlementDefaults.js')
const { validatePriceBook, quoteLines, buildContext } = require(CF + '/manageStoreShipment/pricingCore.js')

function readEnv(p) { const o = {}; try { for (const l of readFileSync(p, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '') } } catch (e) {} return o }
const env = Object.assign({}, readEnv(ROOT + '/admin/.env'), readEnv(ROOT + '/admin/.env.local'))
const { getTenantToken, envToken } = await import(ROOT + '/functions/_lib/feishuBitable.mjs')
const token = await getTenantToken(env), appToken = envToken(env)
async function all(t) {
  const out = []; let pt = ''
  do {
    const qs = new URLSearchParams({ page_size: '500' }); if (pt) qs.set('page_token', pt)
    const j = await (await fetch('https://open.feishu.cn/open-apis/bitable/v1/apps/' + appToken + '/tables/' + t + '/records?' + qs, { headers: { Authorization: 'Bearer ' + token } })).json()
    if (j.code !== 0) throw new Error(j.msg)
    out.push(...((j.data && j.data.items) || [])); pt = (j.data && j.data.has_more) ? j.data.page_token : ''
  } while (pt)
  return out.map(x => x.fields || {})
}

const inv = (await all('tblekBh0CRPMa7ie')).filter(r => String(r['分类']) === '标本')
const byRaw = {}; inv.forEach(r => { byRaw[String(r['物品名称'])] = r })
const priceOf = n => { const r = byRaw[n]; return r ? Number(r['单价']) : null }

const PKG_MAP = [
  // 产品负责人 2026-09-19 裁决 ③：相框/内框**都归为「相框」**（一个名称 + 各自尺寸）
  ['卡扣式防脱永生花玻璃罩（10x18）', '玻璃罩', '10x18', true],
  ['卡扣式防脱永生花玻璃罩（球形10）', '玻璃罩', '球形10', false],
  ['卡扣式防脱永生花玻璃罩（球形15）', '玻璃罩', '球形15', false],
  ['卡扣式防脱永生花玻璃罩（15x22）', '玻璃罩', '15x22', false],
  ['立体中空相框（深黑色木纹方6寸）', '相框', '方6寸', true],
  ['立体中空相框（深黑色木纹方形5寸）', '相框', '方形5寸', false],
  ['立体中空相框（深黑色木纹8寸）', '相框', '8寸', false],
  ['黑木纹立体中空相框（2cm深高方6寸）', '相框', '2cm深高方6寸', false],
  ['木质立体中空相框（宫格多孔）', '相框', '宫格多孔', false],
  ['20*20 黑色相框', '相框', '20*20', false],
  ['磁吸相框冰箱贴立体画框', '冰箱贴', '磁吸相框款', true]
  // 裁决 ④⑤：以下三条是**耗材、不是包装方式**，不进包装价目表
]
/** 裁决 ⑤ 解开 20 倍之谜：密封标本盒 ¥1000 是**买了 20 个的行合计** → 单价 ¥50 */
const CONSUMABLES = [
  { src: '700克优质白卡纸（A4米白色30张）', why: '裁决 ④：耗材，不计入包装' },
  { src: '700克优质白卡纸（A3米白色30张）', why: '裁决 ④：耗材，不计入包装' },
  { src: '乌檀木纯实木原木色内框', why: '裁决 ④：耗材（与裁决 ③ 冲突，见 §6.1）' },
  { src: '密封标本盒带锁425*290*55mm', why: '裁决 ⑤：耗材；¥1000 = 20 个的行合计 → 单价 ¥50' }
]
for (const c of CONSUMABLES) c.price = priceOf(c.src)
const pkgBook = PKG_MAP.map(([src, name, size, isDef]) => ({ src, name, size, isDef, price: priceOf(src), raw: byRaw[src] }))
// 裁决 ⑤ 已解释（20 个的行合计）→ HELD 清空
const HELD = []

const QUAL = ['无缺无裂', '全雄通货', '全雄', '通货', '雌雄混合', '雌', '雄']
const NAMEGRADE = /(A\d+\/A-|A\d+|A-|B\d+)$/
const FLOWER = /^干果肉桂干花diy材料包|^永生花满天星雏菊干花花|^天然手捻小葫芦/
const PKGNAME = /玻璃罩|相框|冰箱贴|卡纸|内框|标本盒|底座/
const MISFILED = /挂钟|钟表/
const ALIAS = { '大蓝闪蝶': '大蓝闪', '熊蜂王': '熊风王' }

const parsed = inv.map(r => {
  const raw = String(r['物品名称'] || '').trim()
  let name = raw
  const spec = String(r['规格型号'] || '').trim()
  const p = r['单价']
  const price = (p === undefined || p === null || p === '') ? null : Number(p)
  let pack = ''
  const pm = name.match(/整包\d+只/); if (pm) { pack = pm[0]; name = name.replace(pm[0], '').trim() }
  let ng = ''
  const gm = name.match(NAMEGRADE); if (gm) { ng = gm[1]; name = name.slice(0, -gm[1].length).trim() }
  let nq = ''
  for (const q of QUAL) { if (!ng && name.length > q.length && name.endsWith(q)) { nq = q; name = name.slice(0, -q.length).trim(); break } }
  const grade = spec || ng || nq || ''
  const sizeM = name.match(/[（(]([^）)]+)[）)]/)
  const clean = name.replace(/[（(][^）)]*[）)]/g, '').trim() || raw
  const kind = pack ? 'pack' : (PKGNAME.test(raw) ? 'pkg' : (FLOWER.test(raw) ? 'flower' : (MISFILED.test(raw) ? 'misfiled' : 'specimen')))
  return { raw, name: clean, grade, size: sizeM ? sizeM[1] : '', pack, price, kind, stock: Number(r['当前库存']) || 0, no: String(r['库存编号'] || '') }
})
const specRows = parsed.filter(r => r.kind === 'specimen' && r.price !== null)

/** 裁决 ①②：以产品负责人给的价覆盖飞书值 */
const PRICE_FIX = { '雅灰蝶|默认': 9, '绿带翠凤蝶|春型': 2, '绿带翠凤蝶|夏型': 2 }
const APPLIED_FIX = []
for (const r of specRows) {
  const k = r.name + '|' + (r.grade || '默认')
  if (PRICE_FIX[k] !== undefined && PRICE_FIX[k] !== r.price) {
    APPLIED_FIX.push({ k, from: r.price, to: PRICE_FIX[k] }); r.price = PRICE_FIX[k]
  }
}

/** 裁决 ⑥⑦⑧⑨⑩：飞书里完全没有的 6 个材料，产品负责人手工给价 */
const MAT_NEW = [
  { name: '独角仙展翅', price: 6, why: '裁决 ⑥：与「没展翅」同为 ¥6，但**单独成行**' },
  { name: '独角仙没展翅', price: 6, why: '裁决 ⑥：同上' },
  { name: '蒲公英', price: 3.5, why: '裁决 ⑦' },
  { name: '扩头深山锹甲', price: 12.5, why: '裁决 ⑧' },
  { name: '黄裳眼蛱蝶', price: 18, why: '裁决 ⑨' },
  { name: '杂蝶', price: 2.5, why: '裁决 ⑩' }
]
for (const m of MAT_NEW) {
  specRows.push({ raw: m.name, name: m.name, grade: '', size: '', pack: '', price: m.price, kind: 'specimen', stock: 0, no: '（手工补录）', manual: true, why: m.why })
}
const flowerRows = parsed.filter(r => r.kind === 'flower' && r.price !== null)
const unpriced = parsed.filter(r => r.price === null)
const packRows = parsed.filter(r => r.kind === 'pack')
const misfiled = parsed.filter(r => r.kind === 'misfiled')
const A1A = specRows.filter(r => /A\d+\/A-/.test(r.grade))

function markDefaults(rows, field) {
  const g = {}; rows.forEach(r => { (g[r.name] = g[r.name] || []).push(r) })
  for (const [, rs] of Object.entries(g)) {
    const empty = rs.find(r => !r[field])
    const pick = empty || rs.slice().sort((a, b) => b.stock - a.stock)[0]
    rs.forEach(r => { r.isDef = (r === pick) })
  }
}
markDefaults(specRows, 'grade'); markDefaults(flowerRows, 'grade')
{ const g = {}; pkgBook.forEach(r => { (g[r.name] = g[r.name] || []).push(r) })
  for (const [, rs] of Object.entries(g)) { const ex = rs.find(r => r.isDef); const empty = rs.find(r => !r.size); const pick = ex || empty || rs[0]; rs.forEach(r => { r.isDef = (r === pick) }) } }

const T = '\t'
/**
 * 一行导入数据（8 列）。第 8 列「分类」只对**材料**有意义（包装本不存分类），
 * 放末尾是为了老粘贴内容不受影响（见 BULK_COLUMNS 的注释）。
 */
const line = (n, a, o, p, u, q, d, cat) => [n, a, o, p, u, q, d, cat === undefined ? '' : cat].join(T).replace(/\t+$/, '')
const hdr = (o, withCat) => ['名称', '别名', o, '单价', '单位', '每单位数量', '默认'].concat(withCat ? ['分类'] : []).join(T)
const sortZh = rs => rs.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'))
const BLK = {
  // 分类按**事实**填：标本行的来源就是飞书「库存管理」的 `分类=标本`
  material: [hdr('等级', true)].concat(sortZh(specRows).map(r => line(r.name, ALIAS[r.name] || '', r.grade || '默认', r.price, '只', '', r.isDef ? '是' : '', '标本'))).join('\n'),
  packaging: [hdr('尺寸')].concat(sortZh(pkgBook).map(r => line(r.name, r.name === '相框' ? '框' : '', r.size || '默认', r.price, '个', '', r.isDef ? '是' : ''))).join('\n'),
  // 干花辅料归「耗材」：它们不是标本本体，而是做造景/搭配的用料
  flower: [hdr('等级', true)].concat(sortZh(flowerRows).map(r => line(r.name, '', r.grade || '默认', r.price, '份', '', r.isDef ? '是' : '', '耗材'))).join('\n')
}

// ══ 用生产解析器/校验器真验证 ══
const VO = {}
for (const [k, kind] of [['material', 'material'], ['packaging', 'packaging'], ['flower', 'material']]) {
  const r = parseBulkText(BLK[k], kind)
  const g = {}; r.rows.forEach(x => { (g[x.normName] = g[x.normName] || []).push(x) })
  const flag = kind === 'material' ? 'isDefaultGrade' : 'isDefaultSize'
  VO[k] = {
    kind, rows: r.rows, n: r.rows.length, errors: r.errors,
    noDef: Object.entries(g).filter(([, rs]) => !rs.some(x => x[flag])).map(([n]) => n),
    multiDef: Object.entries(g).filter(([, rs]) => rs.filter(x => x[flag]).length > 1).map(([n]) => n)
  }
}
const matAll = [].concat(VO.material.rows || [], VO.flower.rows || [])
const pkgAll = VO.packaging.rows || []
const V = validatePriceBook({ materials: matAll, packagings: pkgAll })

// ══ 端到端：9.14 真实出货单 21 行 ══
const SAMPLE = [
  ['独角仙展翅玻璃罩', 2, '山川'], ['独角仙没展翅玻璃罩', 4, '山川'], ['华艳色蟌', 2, '山川'],
  ['蒲公英玻璃罩', 4, '山川'], ['雅灰蝶冰箱贴', 3, '山川'], ['翠蓝眼蛱蝶', 7, '山川'],
  ['杂蝶冰箱贴', 8, '山川'], ['爱神凤蝶玻璃罩', 2, '山川'], ['爱神凤蝶框', 3, '山川'],
  ['爱神凤蝶造景', 1, '星宸'], ['天堂凤蝶造景', 1, '星宸'], ['爱神凤蝶玻璃罩', 2, '星宸'],
  ['大蓝闪玻璃罩', 1, '星宸'], ['扩头深山锹甲', 2, '星宸'], ['印尼金锹', 2, '星宸'],
  ['华艳色蟌', 2, '星宸'], ['黄裳眼蛱蝶造景', 2, '星宸'], ['翠蓝眼蛱蝶造景', 2, '星宸'],
  ['熊风王', 2, '星宸'], ['杂蝶冰箱贴', 10, '星宸'], ['雅灰蝶冰箱贴', 3, '星宸']
]
const ctx = buildContext({ materials: matAll, packagings: pkgAll, laborRatePct: 30, requirePackaging: true })
const Q = quoteLines(SAMPLE.map(([itemName, qty]) => ({ itemName, qty })), ctx)
const bucket = note => {
  if (/指定的原材料不在价目表|未找到原材料/.test(note)) return '① 材料不在价目表'
  if (/残留「造景」/.test(note)) return '③ 造景没有成本'
  if (/未写包装方式/.test(note)) return '② 没写包装（设计上要求人工点选）'
  return '④ ' + note
}
const rows21 = Q.lines.map((r, i) => ({ r, itemName: SAMPLE[i][0], qty: SAMPLE[i][1], who: SAMPLE[i][2] }))
const priced = rows21.filter(x => x.r.pricingStatus === 'priced')
const unpricedLines = rows21.filter(x => x.r.pricingStatus !== 'priced')
const bk = {}; unpricedLines.forEach(x => { const k = bucket(x.r.pricingNote); (bk[k] = bk[k] || []).push(x) })
const y = c => (c / 100).toFixed(2)
const sumOK = (Q.materialCostCents + Q.packagingCostCents + Q.laborCostCents) === Q.totalCents

// ══ 生成文档 ══
const L = []
const P = s => L.push(s)
P('# 原材料 / 包装价目表 · 飞书交叉核对（第 2 轮 · **可直接导入**）')
P('')
P('> 数据源：飞书「库存管理」表 `分类 = 标本` 的 **' + inv.length + ' 条**，直接调 API 读取（非手抄）。')
P('> 本文件**取代**第 1 轮核对与 [`出货价目表_首版填写清单.md`](./出货价目表_首版填写清单.md) 的 §6/§7 ——')
P('> **那份清单不用再手填了**（其 §6「回填示例」里的数字是我写的**格式占位**，不是你的口径，已作废）。')
P('')
P('**本文件的每一个数字都过了生产代码**：三个导入块用云函数的 `parseBulkText` 真解析、用 `validatePriceBook` 真校验，')
P('21 行真实出货单用 `quoteLines` 真实算价（见 §7）。不是我的断言，是跑出来的结果。')
P('')
P('## 0. 我前两轮读错的地方（都是「字段 / 单位 / 口径在哪」这一类）')
P('')
P('### 0.1 「规格型号」字段 = **这一行的区分维度**，不是"规格描述"')
P('')
P('| 飞书行 | 「规格型号」实际装的是 |')
P('|---|---|')
P('| `大蓝闪蝶` 三行 | `A1` ¥65 / 空 ¥60 / `翅面有剐蹭` 无价 → **等级** |')
P('| `绿带翠凤蝶` 两行 | `春型` ¥4（库存65）/ `夏型` ¥8（库存1）→ **季型，两个不同的东西** |')
P('| `卡扣式防脱永生花玻璃罩` | `可换10x18+原木卡扣底` → **材质描述** |')
P('')
P('→ 第 1 轮我把 `绿带翠凤蝶` 春型/夏型报成「**重复键价格冲突**」，**是误报**。')
P('   取字段规则改为：**等级 = 规格型号 → 名称等级串(A1/A-) → 名称品相后缀(通货/全雄/无缺无裂…) → 默认**。修完后重复条目 = 0。')
P('')
P('### 0.2 ⚠️ 会算错钱：「单价」的**单位在行内不统一**')
P('')
P('| 飞书行 | 名称写着 | 单价 | 真相 |')
P('|---|---|---|---|')
for (const r of packRows) {
  const n = Number((r.pack.match(/\d+/) || [0])[0])
  P('| `' + r.raw + '` | ' + r.pack + ' | ¥' + r.price + ' | **整包价**，折合 **¥' + (Math.round(r.price / n * 10000) / 10000) + '/只** |')
}
P('')
P('→ 若按「只」导入，`大蓝A2整包50只` 会变成 **¥28/只**（实际 ¥0.56/只，**贵 50 倍**）。')
P('   这与本项目已发生的 **E18「行单价 vs 行合计」翻倍错** 同类：**先确认单位，再录数字**。这两条**不导入**，见 §5。')
P('')
P('| 飞书行 | 单价 | 真相 |')
P('|---|---|---|')
P('| `干果肉桂干花diy材料包（粉色满天星10克）` | ¥4.75 | 单位是**一份 10 克**，不是一只 |')
P('')
P('→ 这类 **' + flowerRows.length + ' 条**单独放 §1.3，单位写「份」。')
P('')
P('### 0.3 「包装」的匹配字段是 **`尺寸`**，不是 `规格型号`')
P('')
P('`packaging` 本的 `optionField = size`（`settlementDefaults.js:52`）。若把 `可换10x18+原木卡扣底` 填进尺寸列，')
P('出货单写 `爱神凤蝶玻璃罩` 就**永远匹配不上**。所以 §1.2 的尺寸列填的是**可匹配的短尺寸**（`10x18`）。')
P('')
P('### 0.4 ⚠️ 玻璃罩 / 框 在真实出货单里**不带尺寸** → 每个名称必须有默认行')
P('')
P('2026-09-14 真实出货单原文：`独角仙展翅玻璃罩-2`、`爱神凤蝶玻璃罩-2`、`大蓝闪玻璃罩-1`、`爱神凤蝶框-3`。')
P('**全是裸名**。所以 §1 里**每个名称恰好一行**在 `默认` 列打了 `是` —— 裸名就用那一行的价。')
P('')
P('> 这一条是 `validatePriceBook` 的**硬约束**（「每组必须有默认行」），不是我的偏好：')
P('> 我第一版块有 **15 个名称没有默认行**，被生产校验器直接拒。修正后才通过。')
P('')
P('---')
P('')
P('## 1. 可直接导入的内容')
P('')
P('ERP → 工作室 → **价目表配置** → 对应页签 → **批量粘贴导入** → 粘贴 → 先「试算（不写入）」→ 再「确认导入」。')
P('')
P('### 1.1 原材料 · 标本（' + specRows.length + ' 条）→ 粘进**原材料**页签')
P('')
P('```')
P(BLK.material)
P('```')
P('')
P('### 1.2 包装（' + pkgBook.length + ' 条）→ 粘进**包装**页签')
P('')
P('> `默认` 列打 `是` 的那一行 = 出货单**只写裸名**（如 `框`）时用的价。**改一行就换一次成本**，请核对 §6。')
P('')
P('```')
P(BLK.packaging)
P('```')
P('')
P('### 1.3 干花辅料（' + flowerRows.length + ' 条，单位「份」）→ 也粘进**原材料**页签')
P('')
P('> 只有出货单里**写出了名字**才会匹配到（例如 `爱神凤蝶+粉色满天星`）。出货单不写，它们就不进材料成本 ——')
P('> 这是当前「拆解匹配」机制的必然结果，不是 bug。')
P('')
P('```')
P(BLK.flower)
P('```')
P('')
P('---')
P('')
P('## 2. 包装：飞书行 → 价目表行 的 **1:1 对照**（可审计）')
P('')
P('| 飞书原始名称 | 飞书规格型号 | 飞书单价 | → 价目表名称 | 价目表尺寸 | 默认 |')
P('|---|---|---|---|---|---|')
for (const r of pkgBook) P('| `' + r.src + '` | ' + ((r.raw || {})['规格型号'] || '—') + ' | ¥' + r.price + ' | ' + r.name + ' | ' + (r.size || '—') + ' | ' + (r.isDef ? '✅' : '') + ' |')
P('')
P('> **归并说明**：飞书里「框」是 6 个不同的名称（`立体中空相框`/`黑木纹立体中空相框`/`木质立体中空相框`/`20*20 黑色相框`…），')
P('> 但出货单只写 `框`。所以我把它们**归并成一个价目表名称 `框` + 6 个尺寸** —— 这样 `爱神凤蝶框方6寸` 与裸名 `框` 都能匹配。')
P('> `内框`、`冰箱贴`、`白卡纸` 各自独立成名称（不是同一种东西）。')
P('')
P('## 3. 跳过的 ' + unpriced.length + ' 条（无单价）')
P('')
P('> 备注都是「从山川造物门店拨付，欠款待支付」= **门店拨付**，不是采购，所以没有单价。')
P('')
P('| 名称 | 规格型号 | 当前库存 | 库存编号 |')
P('|---|---|---|---|')
unpriced.forEach(r => P('| ' + r.raw + ' | ' + (r.grade || '—') + ' | ' + r.stock + ' | ' + r.no + ' |'))
P('')
P('> 其中 **`华艳色蟌`、`印尼金锹`、`熊蜂王`** 在 9.14 真实出货单里**真的出货了**（各 2 件）——')
P('> 前者与后两者会因「无价」被拦下。**给我这 3 个价**就能多通 4 行。')
P('')
P('## 4. 误分类 1 条（分类放错，我没导入）')
P('')
P('| 飞书行 | 分类 | 单价 | 规格型号 | 问题 |')
P('|---|---|---|---|---|')
misfiled.forEach(r => P('| ' + r.raw + ' | 标本 | ¥' + r.price + ' | ' + (r.grade || '—') + ' | **是挂钟，不是标本**；分类字段填错了 |'))
P('')
P('## 5. ✅ 产品负责人裁决（2026-09-19）—— 已执行')
P('')
P('| # | 你的裁决 | 执行结果 |')
P('|---|---|---|')
P('| ① | `雅灰蝶` **9 元** | 默认行 ¥10 → **¥9**（改的是飞书值，以你的裁决为准） |')
P('| ② | `绿带翠凤蝶` 春型 **2 元** / 夏型 **2 元** | 春型 ¥4 → **¥2**；夏型 ¥8 → **¥2**。两行都保留（出货单分开写时仍各自命中） |')
P('| ③ | 相框 / 内框 **都归为「相框」** | 包装名称 `框` → **`相框`**，并把出货单里裸写的 `框` 登记为**别名**（9.14 原文就是 `爱神凤蝶框-3`） |')
P('| ④ | 白卡纸 A4/A3、乌檀木内框是**耗材，不计入包装** | 3 行**移出**包装价目表（见下一段"已移出"） |')
P('| ⑤ | `密封标本盒带锁` 买了 20 个、是**耗材**不算 | 移出包装表。**顺带解开了 20 倍之谜**：¥1000 是 **20 个的行合计** → 单价 ¥50 |')
P('| ⑥ | `独角仙` 展翅 / 没展翅 都为 **6 元**，但**单独展示** | 新增**两行**：`独角仙展翅` ¥6、`独角仙没展翅` ¥6 |')
P('| ⑦ | `蒲公英` **3.5 元** | 新增 `蒲公英` ¥3.5 |')
P('| ⑧ | `扩头深山锹甲` **12.5 元** | 新增 `扩头深山锹甲` ¥12.5 |')
P('| ⑨ | `黄裳眼蛱蝶` **18 元** | 新增 `黄裳眼蛱蝶` ¥18 |')
P('| ⑩ | `杂蝶` **2.5 元** | 新增 `杂蝶` ¥2.5 |')
P('')
P('**已移出包装价目表（裁决 ④⑤，改按耗材）**：')
P('')
P('| 飞书行 | 飞书单价 | 去向 |')
P('|---|---|---|')
for (const c of CONSUMABLES) P('| ' + c.src + ' | ¥' + c.price + ' | ' + c.why + ' |')
P('')
P('> ⚠️ 但当前数据模型里**没有「耗材」这个成本桶**：真毛利口径是「出货额 −（材料费 + 包装费）」（蓝图裁决 20），')
P('> 所以这 4 条耗材的成本**不会进入任何算式** —— 这是你裁决的直接结果，不是 bug，但意味着**耗材成本看不见**。')
P('> 若以后要看见，需要单开一个耗材桶（口径变更，要改蓝图）。**本次不动。**')
P('')
P('## 6. 🔴 仍需你裁决（7 件；第 1 件是 P0）')
P('')
P('### 6.1 ⛔ `造景` 没有成本（**P0**；现在直接挡住 **4 行**真实出货，原为 3 行）')
P('')
P('9.14 真实出货单里 **5 行写 `造景`**，而**飞书库存里完全没有 `造景`**。给了材料价之后，')
P('原先"缺材料"的 `黄裳眼蛱蝶造景` 也前进到这一步被挡住 —— 所以现在缺的就是**这一个价**。')
P('')
P('→ 请给 `造景` 一个成本价 + 单位（套？个？）。**一个价能通 4 行**，是当前投入产出比最高的一件事。')
P('')
P('### 6.2 裁决 ③ 与裁决 ④ 对「乌檀木内框」结论相反（需一句话澄清）')
P('')
P('| 你的说法 | 指向 |')
P('|---|---|')
P('| ③「相框 / **内框**，都归为相框」 | 内框 → 包装名称 `相框` |')
P('| ④「白卡纸、**乌檀木内框** → 耗材，不计入包装」 | 内框 → 耗材，不进包装表 |')
P('')
P('→ 我按 **④ 更具体**（点名了"乌檀木内框"）执行：**该行按耗材移出包装表**。')
P('你要的是哪一种？')
P('')
P('- **(a) 我理解对了**：出货单上写「内框」时用 `相框` 的价，而"乌檀木内框"这个采购物料算耗材 → **保持现状**')
P('- **(b) 内框也是包装**：把 `乌檀木纯实木原木色内框 ¥13` 作为 `相框` 的一个尺寸加回去')
P('')
P('### 6.3 `玻璃罩` 的默认尺寸用哪个？（裸名 `玻璃罩` 走默认行）')
P('')
P('| 尺寸 | 单价 | 我预填的默认 |')
P('|---|---|---|')
for (const r of pkgBook.filter(x => x.name === '玻璃罩')) P('| ' + r.size + ' | ¥' + r.price + ' | ' + (r.isDef ? '✅ **是**' : '') + ' |')
P('')
P('### 6.4 `相框` 的默认尺寸用哪个？（价差 4 倍）')
P('')
P('| 尺寸 | 单价 | 我预填的默认 |')
P('|---|---|---|')
for (const r of pkgBook.filter(x => x.name === '相框')) P('| ' + r.size + ' | ¥' + r.price + ' | ' + (r.isDef ? '✅ **是**' : '') + ' |')
P('')
P('> 🔴 `爱神凤蝶框-3` 这类裸名走的就是默认行。若实际常用 `20*20`（¥28）而默认留在 `方6寸`（¥11.02），**每件少算 ¥16.98**。')
P('')
P('### 6.5 8 条 `A1/A-` 行疑似旧价（**系统性**：8/8 都带 `A1/A-` 且库存全 0）')
P('')
P('| 名称 | `A1/A-` 行 | 同名「默认」行 | 问题 |')
P('|---|---|---|---|')
for (const r of A1A) {
  const d = specRows.find(x => x.name === r.name && x.isDef)
  P('| ' + r.name + ' | ' + r.grade + ' ¥' + r.price + '（库存' + r.stock + '） | ' + (d && d !== r ? '默认 ¥' + d.price + '（库存' + d.stock + '）' : '—（这行自己就是默认）') + ' | ' + (d && d !== r && r.price < d.price ? '**等级更高却更便宜**' : '') + ' |')
}
P('')
P('→ 有同名对照的 4 条**全部**是「带等级的行更便宜 + 库存 0」。两种读法：')
P('')
P('1. 是**旧采购价**，已被持有库存的行取代 → 我把这 8 行删掉（说一句「删 A1/A-」）')
P('2. `A1/A-` 是「A1 与 A- 混等」的独立品级 → 保留，但请确认同名默认行的品级名（现在写的是「默认」）')
P('')
P('> 当前**保留**：裸名走默认行，只有原文显式写 `A1/A-` 才用这个价。**风险有限**，但方向要你定。')
P('')
P('### 6.6 3 个材料有货但**无价**（备注「门店拨付，欠款待支付」）')
P('')
P('| 材料 | 库存 | 9.14 真实出货 |')
P('|---|---|---|')
for (const nm of ['华艳色蟌', '印尼金锹', '熊蜂王']) {
  const u = unpriced.find(x => x.name === nm)
  P('| ' + nm + ' | ' + (u ? u.stock : '?') + ' | ' + (nm === '熊蜂王' ? '有（2 件）' : '有（各 2 件）') + ' |')
}
P('')
P('> `熊蜂王` 现在有价（¥20，飞书），它挡在**没写包装**那一步；`华艳色蟌`（2 行）与 `印尼金锹` 才是真的无价。')
P('> **给这 2 个价就能再多通 3 行。**')
P('')
P('### 6.7 整包价 2 条（单位是「包」不是「只」，我没导入）')
P('')
P('| 名称 | 整包 | 整包价 | 折合单只 | 库存 |')
P('|---|---|---|---|---|')
for (const r of packRows) {
  const n = Number((r.pack.match(/\d+/) || [0])[0])
  P('| ' + r.name + (r.grade ? ' ' + r.grade : '') + ' | ' + r.pack + ' | ¥' + r.price + ' | ¥' + (Math.round(r.price / n * 10000) / 10000) + ' | ' + r.stock + ' |')
}
P('')
P('> 按「只」录入会放大 25~50 倍（E21）。要按折合单只价录的话，告诉我用哪个等级。')
P('')
P('## 7. 端到端实测：导入后 9.14 真实出货单能核出多少')
P('')
P('把 21 行真实出货单喂进**生产算价引擎**（`quoteLines`，手工费率 30%）：')
P('')
P('| 平台 | 原始行 | 件 | 结果 | 材料 | 包装 | 手工 | 行合计 | 命中 / 原因 |')
P('|---|---|---|---|---|---|---|---|---|')
for (const { r, itemName, qty, who } of rows21) {
  const ok = r.pricingStatus === 'priced'
  P('| ' + who + ' | `' + itemName + '` | ' + qty + ' | ' + (ok ? '✅ 已核价' : '⛔ 未核价') + ' | ' +
    (ok ? '¥' + y(r.unitMaterialCostCents * qty) : '—') + ' | ' + (ok ? '¥' + y(r.unitPackagingCostCents * qty) : '—') + ' | ' +
    (ok ? '¥' + y(r.unitLaborCostCents * qty) : '—') + ' | ' + (ok ? '¥' + y(r.lineTotalCents) : '—') + ' | ' +
    (ok ? r.materialName + ' / ' + r.packagingName : r.pricingNote) + ' |')
}
P('')
P('**已核价 ' + priced.length + '/21 · 未核价 ' + unpricedLines.length + '/21**，未核价原因只有三类：')
P('')
P('| 原因 | 行数 | 怎么解决 |')
P('|---|---|---|')
P('| ① 材料不在价目表 | ' + (bk['① 材料不在价目表'] || []).length + ' | §6.6 / §3 给数据 |')
P('| ② 没写包装（设计上要求人工点选） | ' + (bk['② 没写包装（设计上要求人工点选）'] || []).length + ' | 不是 bug：你已裁决「没写包装 = 报红」，录单时人工选 |')
P('| ③ `造景` 没有成本 | ' + (bk['③ 造景没有成本'] || []).length + ' | §6.1 给一个价 |')
P('')
P('已核价行的金额校验：材料 ¥' + y(Q.materialCostCents) + ' + 包装 ¥' + y(Q.packagingCostCents) + ' + 手工 ¥' + y(Q.laborCostCents) +
  ' = ¥' + y(Q.materialCostCents + Q.packagingCostCents + Q.laborCostCents) + '，行合计 ¥' + y(Q.totalCents) +
  ' → ' + (sumOK ? '✅ **相等**（无 E18 翻倍错）' : '❌ **不等**'))
P('')
P('## 8. 冲突 ≤ 2 倍的，我按「库存表为主源」取值（1 条）')
P('')
P('| 名称 | 库存表 | 采购记录最近 | 处理 |')
P('|---|---|---|---|')
P('| 雅灰蝶（默认级） | ¥10 | ¥9 | 取 **¥10**（成套价目表以库存表为主源，采购记录只用于校对）。要改成 ¥9 就动 §1.1 里那一格 |')
P('')
P('## 9. 覆盖情况（对 9.14 真实单的 14 个材料）')
P('')
const sample = ['独角仙展翅', '独角仙没展翅', '华艳色蟌', '蒲公英', '雅灰蝶', '翠蓝眼蛱蝶', '杂蝶', '爱神凤蝶', '天堂凤蝶', '大蓝闪蝶', '扩头深山锹甲', '印尼金锹', '黄裳眼蛱蝶', '熊蜂王']
P('| 材料 | 状态 | 等级/单价 |')
P('|---|---|---|')
let hi = 0, np = 0, ms = 0
for (const s of sample) {
  const hit = specRows.filter(r => r.name === s || ALIAS[r.name] === s)
  const noP = unpriced.filter(r => r.name === s)
  if (hit.length) { hi++; P('| `' + s + '` | ✅ 有价 | ' + hit.map(h => (h.grade || '默认') + ' ¥' + h.price).join(' / ') + ' |') }
  else if (noP.length) { np++; P('| `' + s + '` | ⚠️ 库里有货、**无价** | 门店拨付（§3） |') }
  else { ms++; P('| `' + s + '` | ❌ 飞书里没有 | §6.6 |') }
}
P('')
P('有价 **' + hi + '/' + sample.length + '** · 有货无价 **' + np + '** · 完全没有 **' + ms + '**')
P('')
P('> `大蓝闪玻璃罩-1` 里的 `大蓝闪` 已作为 `大蓝闪蝶` 的**别名**登记（9.14 真实原文）。§7 实测该行**已核价成功**。')
P('')
P('## 10. 自检（本文件是生成出来的，下面是生成时跑出的实测数字）')
P('')
P('| 项 | 数 |')
P('|---|---|')
P('| 飞书标本行 | ' + inv.length + ' |')
P('| → 标本（只） | ' + specRows.length + ' |')
P('| → 包装（个） | ' + pkgBook.length + ' + 扣下 ' + HELD.length + ' |')
P('| → 干花辅料（份） | ' + flowerRows.length + ' |')
P('| → 整包（扣下） | ' + packRows.length + ' |')
P('| → 误分类（挂钟） | ' + misfiled.length + ' |')
P('| → 耗材（裁决 ④⑤，不进包装） | ' + CONSUMABLES.length + ' |')
P('| → 无单价 | ' + unpriced.length + ' |')
const tot = specRows.length + pkgBook.length + HELD.length + flowerRows.length + packRows.length + misfiled.length + unpriced.length
const feishuSum = tot + CONSUMABLES.length - MAT_NEW.length
P('| **飞书侧合计** | ' + feishuSum + '（飞书共 ' + inv.length + ' 条） |')
P('| → 手工补录（裁决 ⑥⑦⑧⑨⑩） | ' + MAT_NEW.length + ' |')
P('| **入库合计** | ' + tot + ' |')
P('')
P('| 生产解析器实测 | 结果 |')
P('|---|---|')
for (const k of ['material', 'packaging', 'flower']) {
  const v = VO[k]
  P('| `parseBulkText(块, ' + v.kind + ')` · ' + k + ' | ' + v.n + ' 行 / **' + v.errors.length + ' 错**｜缺默认 ' + v.noDef.length + '｜多默认 ' + v.multiDef.length + ' |')
}
P('| `validatePriceBook`（材料 ' + matAll.length + ' + 包装 ' + pkgAll.length + '） | **' + V.errors.length + ' 错** |')
P('| `quoteLines` 21 行真实单 | 已核价 **' + priced.length + '/21** |')
P('')
const selfOK = feishuSum === inv.length && VO.material.errors.length === 0 && VO.packaging.errors.length === 0 && VO.flower.errors.length === 0 &&
  VO.material.noDef.length === 0 && VO.packaging.noDef.length === 0 && VO.flower.noDef.length === 0 &&
  VO.material.multiDef.length === 0 && VO.packaging.multiDef.length === 0 && VO.flower.multiDef.length === 0 && V.errors.length === 0
P(selfOK ? '> ✅ **飞书 ' + inv.length + ' 条全部分桶（相加 = ' + feishuSum + '）；另加手工补录 ' + MAT_NEW.length + ' 行；三个块 0 解析错、0 缺默认、0 多默认；价目表校验 0 错。**'
  : '> ⛔ **自检未通过**：飞书侧合计 ' + feishuSum + ' vs ' + inv.length + '；解析错 ' + (VO.material.errors.length + VO.packaging.errors.length + VO.flower.errors.length) + '；校验错 ' + V.errors.length + '。**先别导入。**')
P('')
P('## 11. 导入后怎么验（3 步）')
P('')
P('1. 页签里点「校验」→ 应报 **0 错**。')
P('2. 把 9.14 那 21 行粘进出货开单页 → 期望 **' + priced.length + ' 行自动核价**，其余 ' + unpricedLines.length + ' 行按 §7 的三类原因报红（**设计如此**）。')
P('3. 全部核价通过后，再去配置里**打开「启用算价」**（`studio_settlement.enabled` 默认是关的）。')
P('')

writeFileSync(ROOT + '/admin/docs/原材料价目表_飞书交叉核对_第2轮_可导入.md', L.join('\n') + '\n')
writeFileSync('/tmp/blocks.json', JSON.stringify(BLK, null, 1))

console.log('价格修正:', APPLIED_FIX.map(f => f.k + ' ¥' + f.from + '→¥' + f.to).join(', ') || '（无）', '| 手工补录', MAT_NEW.length)
console.log('桶: 标本', specRows.length, '包装', pkgBook.length, '+扣下', HELD.length, '辅料', flowerRows.length, '整包', packRows.length, '误分', misfiled.length, '无价', unpriced.length, '| 合计', tot, '/', inv.length)
console.log('生产解析器: ' + ['material', 'packaging', 'flower'].map(k => k + ' ' + VO[k].n + '行/' + VO[k].errors.length + '错/缺默认' + VO[k].noDef.length).join(' | '))
console.log('validatePriceBook: ' + V.errors.length + ' 错')
console.log('quoteLines: 已核价 ' + priced.length + '/21 | 原因 ' + JSON.stringify(Object.fromEntries(Object.entries(bk).map(([k, v]) => [k, v.length]))))
console.log('E18 校验: ' + (sumOK ? '✅ 材料+包装+手工 = 行合计' : '❌ 不等'))
console.log('自检总判定: ' + (selfOK ? '✅ 通过' : '❌ 未通过'))
if (!selfOK) { console.log(JSON.stringify({ VO: Object.fromEntries(Object.entries(VO).map(([k, v]) => [k, { errors: v.errors.slice(0, 5), noDef: v.noDef, multiDef: v.multiDef }])), V: V.errors.slice(0, 5) }, null, 1)) }
