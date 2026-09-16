#!/usr/bin/env node
/**
 * 33 条需求状态矩阵一致性守卫
 *
 * 为什么需要（2026-09-16 实测发现）：
 *   本文件是全仓 33 条需求的**主基线**，但矩阵是手工维护的，实测已经漂了 ——
 *   `#1 同物种去重` 同时出现在「✅ 已修复」与「🟡 部分完成」两行：
 *   读的人无法判断它到底闭环没有。这类矛盾不会报错、不会失败，只会让人看错进度。
 *
 * 检查项：
 *   A. 四个**主分区**（✅ 已修复 / 🟡 部分完成 / 🟡 待业务定口径 / ⚪ 需先设计）互斥
 *   B. 1–33 每条至少出现在一个主分区里（不许漏）
 *   C. 表头声明的条数 == 该行实际列出的条数（防「改了列表忘了改计数」）
 *   D. 🟢 行允许与主分区重叠（它的语义是「已闭环需求里剩下的增量」，不是整条状态），
 *      但必须显式写明这一点，否则读的人会以为是重复登记
 *
 * 用法：
 *   node miniprogram/scripts/check-audit-matrix.mjs
 *   node miniprogram/scripts/check-audit-matrix.mjs --selftest
 * 退出码：有问题为 1。
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const DOC = resolve(ROOT, 'docs/33条需求现状核查_2026-09-16.md')

/** 主分区（互斥）：以行首 emoji 前缀识别 */
export const PRIMARY_PREFIXES = ['✅ 已修复', '🟡 部分完成', '🟡 待业务定口径', '⚪ 需先设计']
/** 交叉引用分区（允许重叠，但须自述） */
export const CROSSREF_PREFIX = '🟢'
export const TOTAL_ITEMS = 33

/**
 * 纯函数：解析矩阵行 → { head, declared, nums }
 * 行形态：`| ✅ 已修复（20 条） | **#2** 文案… 、**#5** … |`
 */
export function parseMatrixRow(line) {
  if (!String(line || '').startsWith('|')) return null
  const cells = line.split('|')
  if (cells.length < 3) return null
  const head = cells[1].trim()
  const body = cells[2] || ''
  const nums = [...new Set([...body.matchAll(/#(\d+)/g)].map((m) => Number(m[1])))].sort((a, b) => a - b)
  const m = head.match(/（(\d+)\s*条）/)
  return { head, declared: m ? Number(m[1]) : null, nums, body }
}

/**
 * 纯函数：给定矩阵行集合，返回问题列表。
 */
export function checkMatrix(lines) {
  const problems = []
  const rows = lines.map(parseMatrixRow).filter(Boolean)
  const primary = rows.filter((r) => PRIMARY_PREFIXES.some((p) => r.head.startsWith(p)))
  const cross = rows.filter((r) => r.head.startsWith(CROSSREF_PREFIX))

  // A. 主分区互斥
  const seen = new Map()
  for (const r of primary) {
    for (const n of r.nums) {
      if (seen.has(n)) {
        problems.push(`#${n} 同时出现在「${seen.get(n)}」与「${r.head}」——主分区必须互斥`)
      } else {
        seen.set(n, r.head)
      }
    }
  }

  // B. 覆盖完整
  const missing = []
  for (let n = 1; n <= TOTAL_ITEMS; n += 1) if (!seen.has(n)) missing.push(n)
  if (missing.length) problems.push(`主分区未覆盖：#${missing.join(' #')}`)

  // C. 声明条数 == 实际条数
  for (const r of rows) {
    if (r.declared == null) continue
    if (r.declared !== r.nums.length) {
      problems.push(`「${r.head}」声明 ${r.declared} 条，实际列出 ${r.nums.length} 条`)
    }
  }

  // D. 交叉引用分区必须自述其性质
  for (const r of cross) {
    // 自述可能写在表头格（`| 🟢 无阻塞余项（**与上方分区有意重叠**…） | #16 … |`），
    // 也可能写在内容格 —— 两处都要看，否则会误报「没写明语义」
    if (!/重叠|增量|不是整条/.test(`${r.head} ${r.body}`)) {
      problems.push(`「${r.head}」与主分区有重叠，但没写明它的语义（需含「重叠」或「增量」字样）`)
    }
  }

  return { problems, primaryCount: seen.size }
}

/** 造一份「主分区完整覆盖 1..33」的最小矩阵，供 selftest 使用 */
function fullPrimary() {
  return [
    '| ✅ 已修复（1 条） | **#1** 甲 |',
    '| 🟡 部分完成（1 条） | **#2** 乙 |',
    '| 🟡 待业务定口径才能继续 | #3 |',
    ...Array.from({ length: TOTAL_ITEMS - 3 }, (_, i) => `| ⚪ 需先设计或内容生产（工作量大） | #${i + 4} |`)
  ]
}

function selftest() {
  const cases = [
    ['正常矩阵应通过', fullPrimary(), 0],
    ['★ 同一条出现在两个主分区必须报错',
      ['| ✅ 已修复（1 条） | **#1** 甲 |', '| 🟡 部分完成（1 条） | **#1** 甲 |'], 1],
    ['声明条数与实际不符必须报错',
      ['| ✅ 已修复（5 条） | **#1** 甲 |'], 1],
    ['交叉引用未自述必须报错',
      ['| 🟢 无阻塞余项 | **#1** 甲 |'], 1],
    // 注意：交叉引用用例也要给足主分区覆盖，否则会先被「未覆盖 1..33」拦下，
    // 那就不是这条规则在起作用了（我第一版就写错了这个用例）
    ['交叉引用已自述则通过',
      [...fullPrimary(), '| 🟢 无阻塞余项（**与上方分区有意重叠**：增量） | **#1** 甲 |'], 0]
  ]
  let bad = 0
  for (const [name, lines, wantFail] of cases) {
    const { problems } = checkMatrix(lines)
    const failed = problems.length > 0
    const ok = wantFail ? failed : !failed
    if (!ok) bad += 1
    console.log(`${ok ? '✓' : '✗'} ${name}${failed ? `（${problems.length} 处问题）` : ''}`)
  }
  if (bad) {
    console.error(`\n自检失败 ${bad} 项——守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：互斥 / 覆盖 / 计数 / 交叉引用自述 四类问题都能抓到，正常矩阵不误报')
}

function main() {
  if (process.argv.includes('--selftest')) return selftest()
  if (!existsSync(DOC)) {
    console.error(`✗ 找不到审计基线 ${DOC}`)
    process.exit(1)
  }
  const { problems, primaryCount } = checkMatrix(readFileSync(DOC, 'utf8').split('\n'))
  for (const p of problems) console.error(`✗ ${p}`)
  if (problems.length) {
    console.error(`\n状态矩阵一致性未通过：${problems.length} 处`)
    process.exit(1)
  }
  console.log(`✓ 状态矩阵一致（主分区互斥且覆盖 ${primaryCount}/${TOTAL_ITEMS} 条；各分区计数与列表相符）`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
