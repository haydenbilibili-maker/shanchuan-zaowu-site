#!/usr/bin/env node
/**
 * 弹窗按钮文案限长守卫（棘轮：只许减少，不许新增）
 *
 * 为什么需要（2026-09-16 实测事故）：
 *   微信 `wx.showModal` 的 `confirmText` / `cancelText` **最多 4 个字符**（官方文档硬限制）。
 *   超过时 `showModal` 直接失败；若不传 `fail` 回调，**既没有弹窗也没有任何报错** ——
 *   用户看到的就是「点了没反应」。
 *
 *   这不是理论风险，实测已经踩到：需求 28「AI 生成一批心愿」的确认弹窗原本写的是 5 个字
 *   「生成并上墙」，点击毫无反应。全仓扫描另有 5 处同类写法 —— 那 5 个弹窗**永远弹不出来**，
 *   且全在退款 / 履约 / 物流降级路径上（越是低频路径越没人发现）。
 *
 * 做法与 `check-silent-catch.mjs` 同构：把当前每一处 offender 写进基线，之后只许减少。
 *   · 新增一处 → 失败
 *   · 减少一处 → 提示跑 `--update` 拧紧棘轮
 *
 * 用法：
 *   node miniprogram/scripts/check-modal-text.mjs
 *   node miniprogram/scripts/check-modal-text.mjs --update     # 复核后拧紧棘轮
 *   node miniprogram/scripts/check-modal-text.mjs --selftest   # 证明检查会失败
 * 退出码：有新增为 1。
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const BASELINE_PATH = join(HERE, 'modal-text-baseline.json')

/** 微信硬限制：confirmText / cancelText 最多 4 个字符 */
export const MODAL_TEXT_MAX = 4

const IGNORE_DIRS = new Set(['node_modules', '.git', 'miniprogram_npm', '.tmp', 'backups'])

/**
 * 纯函数：抽出一段源码里**超长**的弹窗按钮文案。
 * 只认带引号的字面量（`confirmText: '…'` / `"…"`）；变量与模板串无法静态判定，
 * 那种情况请自己保证 ≤4 字（守卫只挡得住能静态看见的）。
 *
 * @param {string} src
 * @param {string} rel 相对路径（用于报告与基线 key）
 * @returns {Array<{file:string, field:string, text:string, len:number}>}
 */
export function extractLongModalTexts(src, rel = '<inline>') {
  const out = []
  const source = String(src == null ? '' : src)
  const patterns = [/(confirmText|cancelText)\s*:\s*'([^']*)'/g, /(confirmText|cancelText)\s*:\s*"([^"]*)"/g]
  for (const re of patterns) {
    for (const m of source.matchAll(re)) {
      const text = m[2]
      if (text.length > MODAL_TEXT_MAX) {
        out.push({ file: rel, field: m[1], text, len: text.length })
      }
    }
  }
  return out
}

function walkJsFiles(base, dir = '', out = []) {
  for (const name of readdirSync(join(base, dir))) {
    if (IGNORE_DIRS.has(name)) continue
    const rel = dir ? `${dir}/${name}` : name
    const abs = join(base, rel)
    if (statSync(abs).isDirectory()) walkJsFiles(base, rel, out)
    else if (/\.js$/.test(name)) out.push(rel)
  }
  return out
}

function keyOf(o) {
  return `${o.file}#${o.field}#${o.text}`
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return null
  try {
    const raw = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    return Array.isArray(raw.offenders) ? raw.offenders : null
  } catch (e) {
    console.error(`✗ 基线文件损坏：${BASELINE_PATH}（${e.message}）`)
    process.exit(1)
  }
}

function collect() {
  const offenders = []
  for (const rel of walkJsFiles(ROOT)) {
    const src = readFileSync(join(ROOT, rel), 'utf8')
    offenders.push(...extractLongModalTexts(src, rel))
  }
  return offenders
}

function selftest() {
  const cases = [
    [
      '5 字 confirmText 必须被检出（真实事故形态）',
      "wx.showModal({ title: 't', content: 'c', confirmText: '生成并上墙', success() {} })",
      1
    ],
    ['4 字 confirmText 必须放行（正好卡在限制上）', "wx.showModal({ confirmText: '生成上墙' })", 0],
    ['3 字 confirmText 必须放行', "wx.showModal({ confirmText: '删除' })", 0],
    ['超长 cancelText 同样必须被检出', "wx.showModal({ cancelText: '再想一想吧' })", 1],
    ['双引号写法同样要覆盖', 'wx.showModal({ confirmText: "去上传举证" })', 1],
    ['非弹窗字段不得误报（同名字符串在别的上下文）', "const x = { tipText: '很长很长的文案' }", 0]
  ]
  let bad = 0
  for (const [name, src, want] of cases) {
    const got = extractLongModalTexts(src).length
    if (got !== want) {
      bad += 1
      console.error(`  ✗ ${name}（期望 ${want}，实际 ${got}）`)
    } else {
      console.log(`  ✓ ${name}`)
    }
  }
  if (bad) {
    console.error(`\n自检失败 ${bad} 项 —— 守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：能抓到超长按钮文案，也不会误报 4 字以内')
}

function main() {
  if (process.argv.includes('--selftest')) return selftest()

  const offenders = collect()
  const current = offenders.map(keyOf).sort()
  const baseline = readBaseline()

  if (process.argv.includes('--update')) {
    writeFileSync(
      BASELINE_PATH,
      `${JSON.stringify(
        {
          note: 'wx.showModal 的 confirmText/cancelText 最多 4 个字符；这里是已存在的超长写法（棘轮：只许减少）',
          generatedAt: new Date().toISOString().slice(0, 10),
          offenders: current
        },
        null,
        2
      )}\n`
    )
    console.log(`✓ 已写入基线：${current.length} 处（${BASELINE_PATH}）`)
    return
  }

  if (baseline === null) {
    console.error(`✗ 找不到基线 ${BASELINE_PATH}，请先跑 --update 建立`)
    process.exit(1)
  }

  const baseSet = new Set(baseline)
  const added = current.filter((k) => !baseSet.has(k))
  const fixed = baseline.filter((k) => current.indexOf(k) === -1)

  if (fixed.length) {
    console.log(`· 已修掉 ${fixed.length} 处（跑 --update 可拧紧棘轮）：`)
    fixed.forEach((k) => console.log(`    - ${k}`))
  }
  console.log(`· 现存超长按钮文案 ${current.length} 处（基线 ${baseline.length} 处）`)
  current.forEach((k) => console.log(`    ${k}`))

  if (added.length) {
    console.error(`\n✗ 新增 ${added.length} 处超长弹窗按钮文案 —— 该弹窗会静默失败（点了没反应）：`)
    added.forEach((k) => console.error(`    ✗ ${k}`))
    console.error('  修法：压到 4 字以内；并给 showModal 补 fail 回调，让失败可见。')
    process.exit(1)
  }
  console.log('\n✓ 未新增超长弹窗按钮文案')
}

main()
