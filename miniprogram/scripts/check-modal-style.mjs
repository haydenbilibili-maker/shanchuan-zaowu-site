#!/usr/bin/env node
/**
 * 弹窗视觉一致性棘轮守卫（2026-09-17）
 *
 * 背景：全仓曾有 **166 处 `wx.showModal`**（110 确认 + 44 仅提示，横跨约 40 个页面）。
 * 系统弹窗是白底 Material 风，与本站「博物黑 + 铜金铭牌」两张皮，且不可定制
 * （不能做危险色分级、不能带权益说明）。
 *
 * 已建替代品：`components/AppModal`（样式化）+ `utils/appModal.js`（`withAppModal` 包装）。
 * 迁移是**逐页**做的（每页：wxml 挂 `<app-modal id="appModal" />` + js 包一层），
 * 166 处不可能一次改完，所以这里用**棘轮**：
 *   - 原生弹窗数量**只能减少，不能增加**（新增必须用 `this.modal()`）
 *   - 已迁移的页面**不允许回退**成 `wx.showModal`
 *   - `appModal` 的兜底必须保留（页面漏挂宿主时退回系统弹窗，而不是静默不弹）
 *
 * 用法：
 *   node miniprogram/scripts/check-modal-style.mjs
 *   node miniprogram/scripts/check-modal-style.mjs --selftest
 * 退出码：原生弹窗数量上升、或已迁移页回退，为 1。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')

/** 棘轮基线：只许降不许升。每迁移一页就把这个数字改小（并同步 MIGRATED）。 */
export const BASELINE = 164
/** 已迁移到样式化弹窗的页面：不得再出现 wx.showModal */
export const MIGRATED = ['subpackages/business/address/index.js']
const SKIP_DIRS = new Set(['node_modules', 'cloudfunctions', 'scripts', 'docs', '.git'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.js')) out.push(relative(MP, p).replace(/\\/g, '/'))
  }
  return out
}

const stripComments = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

export function countNativeModals(files = walk(MP)) {
  const byFile = {}
  let total = 0
  for (const rel of files) {
    const n = (stripComments(readFileSync(join(MP, rel), 'utf8')).match(/wx\.showModal\s*\(/g) || []).length
    if (n) { byFile[rel] = n; total += n }
  }
  return { total, byFile }
}

export function scan(files) {
  const problems = []
  const { total, byFile } = countNativeModals(files)

  if (total > BASELINE) {
    problems.push(
      `[棘轮] 原生 wx.showModal 从 ${BASELINE} 升到 ${total} 处 —— 新增请改用 this.modal()（components/AppModal）`
    )
  }
  for (const rel of MIGRATED) {
    if (byFile[rel]) problems.push(`[回退] ${rel} 已迁移到样式化弹窗，仍有 ${byFile[rel]} 处 wx.showModal`)
  }

  // 兜底必须保留：页面漏挂宿主时要退回系统弹窗，不能静默不弹
  const helper = readFileSync(join(MP, 'utils/appModal.js'), 'utf8')
  if (!/wx\.showModal\(\{/.test(helper)) {
    problems.push('[兜底缺失] utils/appModal.js 不再在「未挂载宿主」时退回系统弹窗（会变成点了没反应）')
  }
  const comp = 'components/AppModal/index.wxml'
  if (!existsSync(join(MP, comp))) problems.push(`[组件缺失] ${comp} 不存在`)
  else {
    const wxml = readFileSync(join(MP, comp), 'utf8')
    if (!/onConfirm/.test(wxml) || !/onCancel/.test(wxml)) {
      problems.push('[组件残缺] AppModal 缺少确认/取消入口')
    }
  }
  return { total, byFile, problems }
}

function selftest() {
  let bad = 0
  const t = (n, ok) => { if (!ok) { bad++; console.error(`✗ ${n}`) } else console.log(`✓ ${n}`) }
  const victim = 'subpackages/business/address/index.js'
  const abs = join(MP, victim)
  const before = readFileSync(abs)
  const sha = (b) => createHash('sha256').update(b).digest('hex')

  const base = scan()
  t(`基线：原生弹窗 ${base.total} 处 ≤ ${BASELINE}`, base.problems.length === 0)

  // 注入 1：往已迁移页塞回 wx.showModal → 必须被抓
  try {
    writeFileSync(abs, before.toString().replace('deleteAddress(e) {',
      "deleteAddress(e) {\n    wx.showModal({ title: 'x', content: 'y' })"))
    const r = scan()
    t('★ 已迁移页回退被检出', r.problems.some((p) => p.includes('[回退]')))
  } finally { writeFileSync(abs, before) }
  t('★ 注入 1 还原字节一致', sha(readFileSync(abs)) === sha(before))

  // 注入 2：把兜底删掉 → 必须被抓
  const helperAbs = join(MP, 'utils/appModal.js')
  const helperBefore = readFileSync(helperAbs)
  try {
    writeFileSync(helperAbs, helperBefore.toString().replace('wx.showModal({', 'noop({'))
    const r = scan()
    t('★ 兜底被删被检出', r.problems.some((p) => p.includes('[兜底缺失]')))
  } finally { writeFileSync(helperAbs, helperBefore) }
  t('★ 注入 2 还原字节一致', sha(readFileSync(helperAbs)) === sha(helperBefore))

  const after = scan()
  t('★ 还原后守卫恢复通过', after.problems.length === 0)

  if (bad) { console.error(`\n自检失败 ${bad} 项——守卫不可信`); process.exit(1) }
  console.log(`\n自检通过：棘轮、迁移回退、兜底缺失三类都能被检出，且还原字节一致`)
}

if (process.argv.includes('--selftest')) {
  selftest()
} else {
  const { total, byFile, problems } = scan()
  for (const p of problems) console.error(`✗ ${p}`)
  if (problems.length) { console.error('\n弹窗视觉一致性未通过'); process.exit(1) }
  const top = Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 5)
  console.log(`✓ 弹窗视觉一致性通过（原生弹窗 ${total} 处 ≤ 棘轮 ${BASELINE}；已迁移 ${MIGRATED.length} 页）`)
  console.log('  待迁移最多的页面：' + top.map(([f, n]) => `${f}(${n})`).join('、'))
}
