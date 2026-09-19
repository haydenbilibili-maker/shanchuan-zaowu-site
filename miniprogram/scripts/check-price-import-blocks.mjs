#!/usr/bin/env node
/**
 * 价目表**导入块**守卫 —— 守住交付给产品负责人的那份「可直接导入」文档。
 *
 * 为什么需要（同一个底层错误在本项目**第二次**发生，按 AGENTS.md 必须补守卫）：
 *   · 第一次是 **E18**：行级 `materialCostCents` 是「分/件」而 `totalCents` 是「分/行」，
 *     两处都乘数量 → 总额**正好翻倍**。
 *   · 第二次是**飞书价目表**：`大蓝A2整包50只` 的 `¥28` 是**整包价**，
 *     `干果肉桂干花diy材料包（粉色满天星10克）` 的 `¥4.75` 是**一份 10 克**。
 *     若按「只」录入，前者单价**贵 50 倍**（¥28 vs 实际 ¥0.56/只）。
 *   共同点：**先看数字，没看单位**。手工核对 126 行时它 100% 会漏。
 *
 * 本守卫不检查"数字对不对"（那要产品负责人裁决），只检查**块本身自洽**：
 *   ① **单位一致性**：名称写「整包N只」的行不得按「只/个」计价；
 *      规格/尺寸含「N克」的行不得按「只/个」计价（应为「份」）。
 *   ② **每组恰好一个默认行**：`validatePriceBook` 的硬约束
 *      （「每组必须有默认行」+「同组不得多个默认」）。第一版块有 15 个名称缺默认行，
 *      被生产校验器直接拒 —— 本守卫重现这道检查，不必等导入才发现。
 *   ③ **能被生产解析器吃下去**：直接调云函数的 `parseBulkText` / `validatePriceBook`，
 *      不自己重写一份解析（那正是最容易与生产漂移的部分）。
 *
 * 证不了什么（写清楚）：
 *   · 不判断单价是否等于真实采购价（来源是飞书，冲突由产品负责人裁决）。
 *   · 不检查文档散文部分与块的数字是否互相一致。
 *
 * 用法：
 *   node miniprogram/scripts/check-price-import-blocks.mjs
 *   node miniprogram/scripts/check-price-import-blocks.mjs --selftest
 * 退出码：块不自洽 1。
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const DOC = join(ROOT, 'admin', 'docs', '原材料价目表_飞书交叉核对_第2轮_可导入.md')
const CF = join(ROOT, 'miniprogram', 'cloudfunctions')

const { parseBulkText } = require(join(CF, 'manageStudioSettlement', 'settlementDefaults.js'))
const { validatePriceBook } = require(join(CF, 'manageStoreShipment', 'pricingCore.js'))

/** 三个块在文档里的顺序（§1.1 材料 / §1.2 包装 / §1.3 辅料） */
const BLOCK_ORDER = [
  { key: 'material', kind: 'material' },
  { key: 'packaging', kind: 'packaging' },
  { key: 'flower', kind: 'material' }
]

/** 这些单位是「按件」的 —— 用于识别单位与名称/规格矛盾的组合 */
const PER_PIECE_UNITS = ['只', '个', '件', '套']

/**
 * 从 markdown 里抽出三个围栏代码块。
 * **只认恰好 3 个**：多了少了都报错 —— 静默取前几个会让新加的块无人守。
 */
export function extractBlocks(md) {
  const lines = String(md || '').split('\n')
  const blocks = []
  let cur = null
  for (const l of lines) {
    if (/^\s*```/.test(l)) {
      if (cur === null) cur = []
      else { blocks.push(cur.join('\n')); cur = null }
      continue
    }
    if (cur !== null) cur.push(l)
  }
  if (cur !== null) blocks.push(cur.join('\n')) // 未闭合的围栏按到尾处理，后面会因数量不符报错
  return blocks
}

/** 拆一行「制表符分隔」的导入行（表头也走这里，靠列名识别） */
function cells(line) {
  return String(line == null ? '' : line).split('\t').map((c) => c.trim())
}

/**
 * ① 单位一致性：把「名称/规格里写着的单位」与「单位列」对照。
 * 返回问题数组（每条含 line 与说明）。
 */
export function checkUnits(blockText) {
  const problems = []
  const lines = String(blockText || '').split('\n')
  let sawHeader = false
  lines.forEach((raw, i) => {
    if (!raw.trim()) return
    const c = cells(raw)
    if (/^(名称|材料名|包装名|物品名称|name)$/i.test(c[0])) { sawHeader = true; return }
    if (!sawHeader) return
    const name = c[0] || ''
    const option = c[2] || ''
    const unit = c[4] || ''
    const perPiece = PER_PIECE_UNITS.includes(unit)

    // 「整包N只」= 一行的价是整包的价，不能按只计
    const packM = name.match(/整包\s*(\d+)\s*(只|个|件|套)/)
    if (packM && perPiece) {
      problems.push({ line: i + 1, text: raw, msg: `名称写着「${packM[0]}」但单位是「${unit}」—— 这是**整包价**，按「${unit}」录入会把单价放大 ${packM[1]} 倍` })
    }
    // 「N克」= 一份的重量，不能按只计
    const gramM = String(option + ' ' + name).match(/(\d+)\s*克/)
    if (gramM && perPiece) {
      problems.push({ line: i + 1, text: raw, msg: `规格写着「${gramM[0]}」但单位是「${unit}」—— 这是**按重量的一份**，单位应为「份」` })
    }
  })
  return problems
}

/**
 * ② + ③ 走生产代码：解析 → 每组默认行 → 价目表整体校验。
 * 不重写解析逻辑，避免与生产漂移。
 */
export function checkWithProduction(blocks) {
  const problems = []
  const parsed = {}
  const kinds = {}

  for (const { key, kind } of BLOCK_ORDER) {
    const text = blocks[key]
    if (text === undefined) {
      problems.push({ where: key, msg: `文档里找不到第 ${BLOCK_ORDER.findIndex((b) => b.key === key) + 1} 个代码块` })
      continue
    }
    const r = parseBulkText(text, kind)
    parsed[key] = r.rows
    kinds[key] = kind
    r.errors.forEach((e) => problems.push({ where: key, msg: `生产解析器报错（第 ${e.line} 行）：${e.msg}` }))

    // 每组恰好一个默认行
    const groups = {}
    r.rows.forEach((row) => { (groups[row.normName] = groups[row.normName] || []).push(row) })
    const flag = kind === 'material' ? 'isDefaultGrade' : 'isDefaultSize'
    for (const [n, rs] of Object.entries(groups)) {
      const nDef = rs.filter((x) => x[flag]).length
      if (nDef === 0) problems.push({ where: key, msg: `「${n}」没有默认行 —— validatePriceBook 会拒（裸名出货单无法取值）` })
      if (nDef > 1) problems.push({ where: key, msg: `「${n}」有 ${nDef} 个默认行 —— 只能有一个` })
    }
  }

  // 价目表整体校验（材料 = 标本 + 辅料）
  const materials = [].concat(parsed.material || [], parsed.flower || [])
  const packagings = parsed.packaging || []
  if (materials.length || packagings.length) {
    const v = validatePriceBook({ materials, packagings })
    v.errors.forEach((e) => problems.push({ where: 'validatePriceBook', msg: `[${e.book}] ${e.code} ${e.name || ''} ${e.msg || ''}` }))
  }
  return { problems, parsed, counts: { material: (parsed.material || []).length, packaging: (parsed.packaging || []).length, flower: (parsed.flower || []).length } }
}

/** 全量分析（供 main 与 selftest 共用） */
export function analyse(blocks) {
  const unitProblems = []
  for (const { key } of BLOCK_ORDER) {
    if (blocks[key] === undefined) continue
    checkUnits(blocks[key]).forEach((p) => unitProblems.push(Object.assign({ where: key }, p)))
  }
  const prod = checkWithProduction(blocks)
  return { unitProblems, problems: unitProblems.concat(prod.problems), counts: prod.counts }
}

function main() {
  if (!existsSync(DOC)) {
    console.log(`✗ 无法判定：读不到 ${DOC}`)
    process.exit(1)
  }
  const blocks = extractBlocks(readFileSync(DOC, 'utf8'))
  if (blocks.length !== 3) {
    console.log(`✗ 无法判定：文档里的代码块有 ${blocks.length} 个，期望 **3** 个（材料 / 包装 / 辅料）。\n` +
      '  块数变了就说明有人加了新块或删了旧块 —— 本守卫不猜哪块是哪块，请同步更新 BLOCK_ORDER。')
    process.exit(1)
  }
  const keyed = {}
  BLOCK_ORDER.forEach((b, i) => { keyed[b.key] = blocks[i] })
  const res = analyse(keyed)

  console.log('价目表导入块守卫 · ' + DOC.replace(ROOT + '/', ''))
  console.log(`  解析成功：材料 ${res.counts.material} · 包装 ${res.counts.packaging} · 辅料 ${res.counts.flower}`)
  console.log(`  单位一致性：${res.unitProblems.length} 个问题`)
  console.log(`  生产校验（含默认行 / validatePriceBook）：${res.problems.length - res.unitProblems.length} 个问题`)

  if (res.problems.length) {
    console.log('')
    res.problems.slice(0, 40).forEach((p) => {
      console.log(`  ⛔ [${p.where}] ${p.msg}`)
      if (p.text) console.log(`       ${p.text}`)
    })
    if (res.problems.length > 40) console.log(`  … 还有 ${res.problems.length - 40} 个`)
    console.log(`\n✗ 导入块不自洽 ${res.problems.length} 项 —— **先别交给产品负责人导入**`)
    process.exit(1)
  }
  console.log('\n✓ 单位一致、每组恰好一个默认行、生产解析器与校验器 0 错')
}

/** ── 自检：每个注入都必须被检出，且基线干净 ── */
function selftest() {
  const md = readFileSync(DOC, 'utf8')
  const blocks = extractBlocks(md)
  if (blocks.length !== 3) { console.log(`✗ 自检前提失败：代码块 ${blocks.length} 个 ≠ 3`); process.exit(1) }
  const base = {}
  BLOCK_ORDER.forEach((b, i) => { base[b.key] = blocks[i] })

  let bad = 0
  const inj = []

  // 基线：原文档必须干净
  const ok = analyse(base)
  const baseClean = ok.problems.length === 0
  console.log(`${baseClean ? '✓' : '✗'} 基线：未改动的块不该报问题（实报 ${ok.problems.length}）`)
  if (!baseClean) { bad++; ok.problems.slice(0, 5).forEach((p) => console.log(`    · [${p.where}] ${p.msg}`)) }

  const clone = () => JSON.parse(JSON.stringify(base))
  const addRow = (key, row) => { const b = clone(); b[key] = b[key] + '\n' + row; return b }

  // 注入 1（**E18 同类**）：整包价按「只」录入 → 必须检出
  inj.push(['整包价按「只」录入（E18 同类）', () => addRow('material', '大蓝A2整包50只\t\tA2\t28\t只'),
    (r) => r.unitProblems.some((p) => /整包价/.test(p.msg))])
  // 注入 2：按克的辅料按「只」录入 → 必须检出
  inj.push(['按克辅料按「只」录入', () => addRow('material', '粉色满天星\t\t10克\t4.75\t只'),
    (r) => r.unitProblems.some((p) => /按重量的一份/.test(p.msg))])
  // 注入 3：把一个「名称只有一行」的默认行改成带等级 → 必须检出「没有默认行」
  //   ⚠️ 注入必须真的造出缺陷：只删第 7 列的「是」**不够** ——
  //   生产代码里 `isDefault = truthyCell(默认列) || !optionRaw || optionRaw === '默认'`，
  //   选项写着「默认」时本来就判为默认行。第一版注入就是这么写的，于是「漏检」是**注入的错**而非守卫的错。
  inj.push(['名称唯一行改成带等级（造出「没有默认行」）', () => {
    const b = clone()
    b.material = b.material.replace(/^熊蜂王\t.*$/m, '熊蜂王\t熊风王\tA1\t20\t只')
    return b
  }, (r) => r.problems.some((p) => /没有默认行/.test(p.msg))])
  // 注入 4：同一名称重复 → 生产解析器必须报
  inj.push(['同批重复行', () => addRow('material', '熊蜂王\t\t默认\t20\t只'),
    (r) => r.problems.some((p) => /生产解析器报错/.test(p.msg))])
  // 注入 5：单价非数字 → 生产解析器必须报
  inj.push(['单价非数字', () => addRow('material', '测试蝶\t\t默认\t面议\t只'),
    (r) => r.problems.some((p) => /生产解析器报错/.test(p.msg))])
  // 注入 6：包装尺寸写成材质描述（本文件 §0.3 记的那个坑）→ 名称匹配不上，
  //          这是「匹配失败」而不是「块不自洽」，守卫**证不了**，故这里只验证
  //          「能解析但校验器不报错」不会被误判为问题（防守卫自己过度报警）
  inj.push(['包装用材质描述当尺寸（可解析，不该报错）', () => addRow('packaging', '玻璃罩\t\t可换30x40+原木卡扣底\t99\t个'),
    (r) => !r.problems.some((p) => /可换30x40/.test(p.msg))])

  console.log('')
  for (const [label, make, expect] of inj) {
    let r
    try { r = analyse(make()) } catch (e) { console.log(`✗ 注入「${label}」抛异常：${e.message}`); bad++; continue }
    const hit = expect(r)
    console.log(`${hit ? '✓' : '✗'} 注入检出：${label}`)
    if (!hit) { bad++; r.problems.slice(0, 3).forEach((p) => console.log(`    · 实际报的是 [${p.where}] ${p.msg}`)) }
  }

  // 块数守卫本身必须能失败
  const twoBlocks = extractBlocks('```\na\tb\tc\td\te\n```\n\n```\nx\ty\tz\tw\tv\n```')
  const blockCountGuard = twoBlocks.length === 2
  console.log(`${blockCountGuard ? '✓' : '✗'} 代码块抽取：2 个块被数成 ${twoBlocks.length}（非 3 会在 main 里被拒）`)
  if (!blockCountGuard) bad++

  if (bad) { console.log(`\n✗ 自检失败 ${bad} 项 —— 守卫不可信`); process.exit(1) }
  console.log(`\n✓ 自检通过：${inj.length + 2} 项断言（含 ${inj.length} 个回归注入）`)
}

if (process.argv.includes('--selftest')) selftest()
else main()
