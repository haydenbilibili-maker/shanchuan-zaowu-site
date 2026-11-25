#!/usr/bin/env node
/**
 * check:modal-textarea-fixed —— 弹层里的 textarea 必须设 fixed="{{true}}"（2026-11-25 用户反馈）
 *
 * 真机现象：藏品库「录入藏品 → 档案 → 藏品简介」点一下就跳走、改不了。
 * 微信原生 textarea 在 `position: fixed` 的弹层里若不声明 `fixed`，键盘弹起时会按页面坐标重排，
 * 表现为「点一下界面跳走 / 输入不进去」。凡是位于 `ui-pop-mask` 弹层内的 textarea 都要加：
 *   fixed="{{true}}" cursor-spacing="120"
 *
 * 用法：node miniprogram/scripts/check-modal-textarea-fixed.mjs [--selftest]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = join(HERE, '..')

const SKIP = new Set(['node_modules', 'miniprogram_npm'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (name.endsWith('.wxml')) out.push(p)
  }
  return out
}

export function scan(files) {
  const bad = []
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      if (!/<textarea\b/.test(lines[i])) continue
      // 弹层判定：找到最近的 ui-pop-mask，再看它到 textarea 之间的 <view> 深度是否仍 > 0（即还在弹层里）
      let maskAt = -1
      for (let j = i; j >= Math.max(0, i - 400); j -= 1) {
        if (lines[j].includes('class="ui-pop-mask')) { maskAt = j; break }
      }
      if (maskAt < 0) continue
      let depth = 0
      for (let j = maskAt; j <= i; j += 1) {
        const opens = (lines[j].match(/<view\b/g) || []).length
        const closes = (lines[j].match(/<\/view>/g) || []).length
        depth += opens - closes
      }
      if (depth <= 0) continue
      // 属性可能跨行：取 textarea 到下一个 '>' 的片段
      const first = lines[i].slice(lines[i].indexOf('<textarea'))
      let chunk = [first, ...lines.slice(i + 1, i + 12)].join('\n')
      chunk = chunk.slice(0, chunk.indexOf('>') + 1)
      if (/fixed="\{\{true\}\}"/.test(chunk)) continue
      bad.push(`${relative(MP, file)}:${i + 1}`)
    }
  }
  return bad
}

function run() {
  const files = walk(MP)
  const bad = scan(files)
  if (bad.length) {
    console.error('✗ 弹层 textarea 未设 fixed="{{true}}"（iOS 键盘会把界面顶走 / 输不进去）：')
    bad.forEach((b) => console.error('  - ' + b))
    process.exit(1)
  }
  console.log(`✓ check:modal-textarea-fixed：${files.length} 个 wxml 的弹层 textarea 都声明了 fixed`)
}

if (process.argv.includes('--selftest')) {
  const target = join(MP, 'subpackages/manager/manager/workspace/_subviews.wxml')
  const src = readFileSync(target, 'utf8')
  const bad = scan([target])
  if (bad.length) {
    console.error('✗ 自检前提：真源须先通过\n  - ' + bad.join('\n  - '))
    process.exit(1)
  }
  const broken = target + '.selftest.wxml'
  const mutated = src.replace('<textarea fixed="{{true}}" cursor-spacing="120"', '<textarea', 1)
  if (mutated === src) {
    console.error('✗ 自检锚点失效：找不到「<textarea fixed="{{true}}" cursor-spacing="120"」')
    process.exit(1)
  }
  // 内存版扫描：把源写成临时文件跑一遍再删
  const fs = await import('node:fs')
  fs.writeFileSync(broken, mutated)
  let fails = []
  try { fails = scan([broken]) } catch (e) { fails = [String(e.message || e)] }
  fs.unlinkSync(broken)
  if (!fails.length) {
    console.error('✗ 自检失败：去掉 fixed 后没有被检出')
    process.exit(1)
  }
  console.log('✓ 自检通过：1 条注入被检出（临时文件已删除）')
} else {
  run()
}
