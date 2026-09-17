#!/usr/bin/env node
/**
 * 「在职员工」数据源回归测试
 *
 * 背景（2026-09-16，产品负责人指出）：经营驾驶舱的「在职员工」KPI 原先读
 * `payrollStorage` 的 localStorage 花名册 —— 那份数据 ERP 侧从未被填充，于是卡片恒显示 **0**。
 * 而 0 无法区分「确实没有员工」与「没读到数据」，运营会据此得出错误结论。
 *
 * 修法：改读小程序超管工作台「员工」模块的同一数据源（`manageStaff` → `staff_members`），
 * 并且**读不到时显示「—」而不是 0**。
 *
 * ⚠️ 2026-09-17 全面审计 D6：本测试原先在文件里**内联了一份同构实现**，
 * 从不读生产代码 —— 生产实现改坏测试照样绿（守卫空转，比没有守卫更糟）。
 * 现在 S/D 直接 import 生产实现（`src/utils/staffDirectoryCore.js`，纯逻辑零依赖），
 * `--selftest` 里还会**临时改坏那个生产文件**再跑子进程，证明「生产代码坏了本测试一定红」。
 *
 * 本测试钉住三件事：
 *   ① 生效/停用计数正确（status 缺省视为生效，与服务端 `row.status || 'active'` 一致）；
 *   ② 服务端 `limit(100)` 且无分页 → 取满 100 条必须标 `truncated` 并显示 `N+`；
 *   ③ **失败时绝不显示 0**（这是本轮缺陷的本质）。
 *
 * 用法：node admin/scripts/test-staff-directory.mjs [--selftest]
 */
'use strict'

import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  STAFF_LIST_LIMIT,
  staffCountDisplay,
  summarizeStaffList,
} from '../src/utils/staffDirectoryCore.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORE = resolve(HERE, '..', 'src', 'utils', 'staffDirectoryCore.js')
const SELF = fileURLToPath(import.meta.url)

/** 生产实现（直接引用，不再内联副本） */
export const impl = {
  summarize: summarizeStaffList,
  display: staffCountDisplay,
}

const rows = (n, status) => Array.from({ length: n }, (_, i) => ({ _id: 's' + i, name: '员工' + i, ...(status ? { status } : {}) }))

/** 每个用例接收实现，返回是否通过 */
export function cases(S, D) {
  return [
    ['正常：3 生效 + 2 停用 → 生效 3、停用 2', () => {
      const r = S({ success: true, list: [...rows(3, 'active'), ...rows(2, 'disabled')] })
      return r.ok && r.active === 3 && r.disabled === 2 && r.total === 5 && D(r) === '3'
    }],
    ['status 缺省视为生效（与服务端 row.status || "active" 一致）', () => S({ success: true, list: rows(4) }).active === 4],
    ['服务端 success:false → ok=false，并带上原因', () => {
      const r = S({ success: false, msg: '未授权' }); return r.ok === false && r.error === '未授权'
    }],
    ['返回 null → ok=false（不能当成空列表）', () => S(null).ok === false],
    ['取满 100 条 → truncated，显示「N+」（服务端 limit(100) 无分页）', () => {
      const r = S({ success: true, list: rows(STAFF_LIST_LIMIT, 'active') }); return r.truncated === true && D(r) === '100+'
    }],
    ['99 条 → 不标 truncated', () => {
      const r = S({ success: true, list: rows(99, 'active') }); return r.truncated === false && D(r) === '99'
    }],
    ['★ 失败时显示「—」而不是 0（原缺陷的本质）', () => D(S({ success: false, msg: 'x' })) === '—'],
    ['★ 真正 0 名员工时显示「0」', () => D(S({ success: true, list: [] })) === '0'],
    ['★ 「失败」与「真的 0」展示必须不同', () => D(S({ success: false })) !== D(S({ success: true, list: [] }))],
  ]
}

export function runChecks(implOverride = impl) {
  const failures = []
  let pass = 0
  for (const [name, fn] of cases(implOverride.summarize, implOverride.display)) {
    let ok = false
    try { ok = !!fn() } catch (e) { failures.push(`${name} — 异常 ${e.message}`); continue }
    if (ok) pass += 1
    else failures.push(name)
  }
  return { pass, failures }
}

if (process.argv.includes('--selftest')) {
  console.log('自检：① 三条关键性质可被破坏检出；② 本测试确实读生产实现（改坏生产文件必须红）\n')
  let bad = 0

  // ── ① 性质级破坏（内存中替换实现） ──
  const mutations = [
    ['把停用行也算作生效（计数错）', {
      ...impl,
      summarize: (res) => { const r = impl.summarize(res); r.active = r.total; return r },
    }, '正常：3 生效'],
    ['去掉 truncated 标记（截断不可辨）', {
      ...impl,
      summarize: (res) => ({ ...impl.summarize(res), truncated: false }),
    }, '取满 100 条'],
    ['失败时显示 0 而不是「—」（回到原缺陷）', {
      ...impl,
      display: (staff) => (staff && staff.ok ? String(staff.active) : '0'),
    }, '★ 失败时显示'],
  ]
  for (const [label, broken, expectCase] of mutations) {
    const { failures } = runChecks(broken)
    const hit = failures.find((f) => f.startsWith(expectCase))
    console.log(`${hit ? '✓' : '✗'} ${label} → ${hit ? '已检出' : '【漏检】'}`)
    if (hit) console.log(`    · ${hit}`)
    if (!hit) bad += 1
  }

  // ── ② 证明「读的是生产实现」：改坏生产核心文件 → 子进程必须红 → 按字节还原 ──
  const original = readFileSync(CORE, 'utf8')
  const NEEDLE = 'truncated: list.length >= limit,'
  if (!original.includes(NEEDLE)) {
    console.error(`✗ 自检无法注入：生产文件里找不到锚点 \`${NEEDLE}\``)
    console.error('   （说明 staffDirectoryCore.js 的截断判定被改写，请同步本自检）')
    bad += 1
  } else {
    try {
      writeFileSync(CORE, original.replace(NEEDLE, 'truncated: false,'))
      const r = spawnSync(process.execPath, [SELF], { encoding: 'utf8' })
      const out = `${r.stdout || ''}${r.stderr || ''}`
      const detected = r.status === 1 && /✗ 取满 100 条/.test(out)
      console.log(`${detected ? '✓' : '✗'} 改坏生产实现 staffDirectoryCore.js → 本测试必须变红`
        + `（${detected ? '已检出' : '【漏检】'}，子进程 exit ${r.status}）`)
      if (!detected) bad += 1
    } finally {
      writeFileSync(CORE, original) // 按字节还原
    }
    const restored = readFileSync(CORE, 'utf8') === original
    console.log(`${restored ? '✓' : '✗'} 生产文件已按字节还原`)
    if (!restored) bad += 1
  }

  console.log()
  if (bad) {
    console.error(`自检失败：${bad} 项未被检出，测试不可信。`)
    process.exit(1)
  }
  console.log('自检通过：三条关键性质可被破坏检出，且测试确实读生产实现。\n')
  process.exit(0)
}

const { pass, failures } = runChecks()
console.log(`「在职员工」数据源测试：${pass} 项通过，${failures.length} 项失败`)
if (failures.length) {
  console.error('\n失败明细：')
  failures.forEach((f) => console.error(`  ✗ ${f}`))
  process.exit(1)
}
console.log('全部通过：计数正确、截断可辨、失败显示「—」而不是 0。')
