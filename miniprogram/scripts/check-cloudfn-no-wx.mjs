#!/usr/bin/env node
/**
 * 云函数目录禁用小程序端 `wx.*` API（manager 域；2026-09-28 产品负责人拍板修复）
 *
 * 事故：cancelBooking / updateBooking 在云函数里写 `wx.cloud.callFunction(...)` 发提醒 ——
 * 云函数运行时没有 `wx` 全局，ReferenceError 被 try/catch 吞掉，取消 / 改期提醒从来没发出去，
 * 日志里只有一行「发送提醒失败」。云端互调应使用 wx-server-sdk 的 `cloud.callFunction`。
 *
 * 判据：miniprogram/cloudfunctions 下（不含 node_modules）的 .js 去掉注释后，
 * 不得出现 `wx.cloud.` 或 `wx.<api>(`。存量命中走 ALLOW 棘轮（只许减少）；当前为空。
 *
 * 用法：
 *   node miniprogram/scripts/check-cloudfn-no-wx.mjs
 *   node miniprogram/scripts/check-cloudfn-no-wx.mjs --selftest   （注入只写临时目录）
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const rootIdx = argv.indexOf('--root')
const ROOT = rootIdx >= 0 ? resolve(argv[rootIdx + 1]) : resolve(HERE, '../..')
const FN_DIR = join(ROOT, 'miniprogram/cloudfunctions')

/** 存量白名单（相对 cloudfunctions 的路径 → 允许的命中数）；只许删、不许加 */
const ALLOW = {}

if (argv.includes('--selftest')) selftest()

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (name.endsWith('.js')) out.push(p)
  }
  return out
}

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')
const PATTERN = /\bwx\s*\.\s*(cloud\s*\.|[A-Za-z_$][\w$]*\s*\()/g

const hits = {}
for (const file of walk(FN_DIR)) {
  const code = stripComments(readFileSync(file, 'utf8'))
  const lines = code.split('\n')
  lines.forEach((line, i) => {
    if (PATTERN.test(line)) {
      const rel = relative(FN_DIR, file)
      ;(hits[rel] = hits[rel] || []).push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`)
    }
    PATTERN.lastIndex = 0
  })
}

const bad = []
for (const [rel, list] of Object.entries(hits)) {
  if (list.length > (ALLOW[rel] || 0)) bad.push(...list)
}
if (bad.length) {
  console.error(`✗ 云函数里出现小程序端 wx.* 调用 ${bad.length} 处（云函数没有 wx 全局，调用会抛 ReferenceError；互调请用 wx-server-sdk 的 cloud.callFunction）：`)
  bad.forEach((b) => console.error(`  ${b}`))
  process.exit(1)
}
console.log(`✓ 云函数无 wx.* 误用（白名单 ${Object.keys(ALLOW).length} 个文件）`)

function selftest() {
  const REAL = resolve(HERE, '../..')
  const SRC = join(REAL, 'miniprogram/cloudfunctions/cancelBooking/index.js')
  const base = readFileSync(SRC, 'utf8')
  const CASES = [
    { name: '云函数里 wx.cloud.callFunction', inject: "\nwx.cloud.callFunction({ name: 'x' })\n", fail: true },
    { name: '云函数里 wx.getStorageSync(', inject: "\nconst a = wx.getStorageSync('k')\n", fail: true },
    { name: '带空格的 wx . cloud .', inject: "\nwx . cloud . database()\n", fail: true },
    { name: '只在注释里提到 wx.cloud.init（不算）', inject: '\n// 与 app.js 的 wx.cloud.init 一致\n/* wx.cloud.callFunction(...) 已废弃 */\n', fail: false },
    { name: '字符串里的 URL 注释符不误伤', inject: "\nconst u = 'https://example.com/wx.cloud.x'\n", fail: true }
  ]
  let ok = true
  for (const c of CASES) {
    const dir = mkdtempSync(join(tmpdir(), 'cloudfn-no-wx-selftest-'))
    try {
      const target = join(dir, 'miniprogram/cloudfunctions/cancelBooking/index.js')
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, base + c.inject)
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--root', dir], { encoding: 'utf8' })
      const failed = r.status !== 0
      if (failed === c.fail) console.log(`  ✓ ${c.fail ? '注入' : '对照'}「${c.name}」${c.fail ? '被检出' : '未误报'}`)
      else {
        ok = false
        console.error(`  ✗ 「${c.name}」期望${c.fail ? '失败' : '通过'}，实际${failed ? '失败' : '通过'}\n${r.stdout}${r.stderr}`)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  if (readFileSync(SRC, 'utf8') !== base) {
    console.error('✗ 自检改动了真源码')
    process.exit(1)
  }
  if (!ok) process.exit(1)
  console.log(`✓ selftest 通过：${CASES.length} 个用例（含 1 个不误报对照）；真源码未被改动`)
  process.exit(0)
}
