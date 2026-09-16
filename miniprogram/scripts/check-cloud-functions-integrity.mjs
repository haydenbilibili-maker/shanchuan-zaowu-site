#!/usr/bin/env node
/**
 * 云函数入口完整性守卫
 *
 * 为什么需要（真实事故 2026-09-16）：一次批量正则改写脚本在 16 个云函数里
 * **静默删除了文件头**（顶部注释 + 全部 require + cloud.init/db 初始化），
 * 另把 2 个文件截断到几十行。`node --check` 全部通过（语法合法！），
 * 现有守卫也全绿 —— 但一部署，这些函数会因 cloud/db 未定义全线崩溃。
 *
 * 本守卫检查每个 cloudfunctions/<fn>/index.js：
 *   1. 必须存在 `exports.main`
 *   2. 必须引入 wx-server-sdk 并初始化（cloud.init）
 *   3. 用到 cloud.database() 时必须定义 db
 *   4. 文件不得短于 5 行（拦截被截断成残片的情况）
 *   5. 顶层 require 的本地模块必须真实存在（拦截误删/误改导入路径）
 *
 * 只检查**结构完整**，不判断业务正确性 —— 与 check-cloud-files.cjs 互补。
 *
 * 用法：
 *   node miniprogram/scripts/check-cloud-functions-integrity.mjs
 *   node miniprogram/scripts/check-cloud-functions-integrity.mjs --selftest
 * 退出码：有问题为 1。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CF_ROOT = resolve(HERE, '..', 'cloudfunctions')

/** 纯函数：检查单个入口源码，返回问题列表（便于 selftest 注入） */
export function checkEntrySource(src, rel = '<inline>', opts = {}) {
  const problems = []
  const lines = src.split('\n')
  const hasFile = opts.fileExists || (() => true)

  if (lines.length < 5) {
    problems.push(`${rel}: 仅 ${lines.length} 行——疑似被截断为残片`)
  }
  if (!/exports\.main\s*=/.test(src)) {
    problems.push(`${rel}: 缺少 \`exports.main\`（云函数入口）`)
  }
  const usesCloud = /\bcloud\.[A-Za-z]/.test(src)
  const declaresCloud = /const\s+cloud\s*=\s*require\(\s*['"]wx-server-sdk['"]\s*\)/.test(src)
  if (usesCloud && !declaresCloud) {
    problems.push(`${rel}: 使用了 cloud 但未 \`const cloud = require('wx-server-sdk')\`（文件头可能被删）`)
  }
  if (/cloud\.init\s*\(/.test(src) === false && usesCloud) {
    problems.push(`${rel}: 未调用 cloud.init()（初始化可能被删）`)
  }
  const usesDb = /\bdb\.[A-Za-z]/.test(src)
  const declaresDb = /const\s+db\s*=\s*cloud\.database\(\s*\)/.test(src)
  if (usesDb && !declaresDb) {
    problems.push(`${rel}: 使用了 db 但未 \`const db = cloud.database()\`（文件头可能被删）`)
  }
  // 顶层本地 require 必须指向真实文件
  for (const m of src.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    const spec = m[1]
    const base = resolve(dirname(opts.absPath || '.') === '' ? '.' : dirname(opts.absPath || '.'), spec)
    const candidates = [base, `${base}.js`, `${base}.json`, join(base, 'index.js')]
    if (!candidates.some((c) => hasFile(c))) {
      problems.push(`${rel}: require('${spec}') 指向的文件不存在（依赖被删或路径写错）`)
    }
  }
  return problems
}

function walkFns(root) {
  const out = []
  for (const name of readdirSync(root)) {
    if (name.startsWith('.') || name === 'node_modules') continue
    const dir = join(root, name)
    if (!statSync(dir).isDirectory()) continue
    const entry = join(dir, 'index.js')
    if (existsSync(entry)) out.push({ name, entry })
  }
  return out
}

function selftest() {
  const ok = `const cloud = require('wx-server-sdk')\ncloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })\nconst db = cloud.database()\nexports.main = async (e) => db.collection('x').get()\n`
  // 头部被删（使用 cloud/db 但无 require / 无 init）
  const noHeader = `function fail(m){return {success:false,msg:m}}\nexports.main = async (e) => {\n  const c = cloud.getWXContext()\n  return db.collection('x').get()\n}\n`
  // 被截断
  const truncated = `const cloud = require('wx-server-sdk')\n`
  // 缺 exports.main
  const noMain = `const cloud = require('wx-server-sdk')\ncloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })\nconst db = cloud.database()\n`
  const cases = [
    ['完整入口不得报错', ok, 0],
    ['文件头被删必须报错', noHeader, 1],
    ['截断残片必须报错', truncated, 1],
    ['缺 exports.main 必须报错', noMain, 1],
  ]
  let failed = 0
  for (const [name, src, want] of cases) {
    const got = checkEntrySource(src, '<selftest>').length
    const good = want === 0 ? got === 0 : got > 0
    if (!good) failed++
    console.log(`${good ? '✓' : '✗'} ${name}（期望${want === 0 ? '通过' : '报错'}，实际 ${got} 处）`)
  }
  if (failed) {
    console.error(`\n自检失败 ${failed} 项——守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：守卫能抓到「文件头被删 / 被截断 / 缺入口」，也不会误报完整文件')
}

function main() {
  if (process.argv.includes('--selftest')) return selftest()
  if (!existsSync(CF_ROOT)) {
    console.error(`✗ 找不到云函数目录 ${CF_ROOT}`)
    process.exit(1)
  }
  const fns = walkFns(CF_ROOT)
  const problems = []
  for (const { name, entry } of fns) {
    const src = readFileSync(entry, 'utf8')
    problems.push(
      ...checkEntrySource(src, `cloudfunctions/${name}/index.js`, {
        absPath: entry,
        fileExists: existsSync,
      }),
    )
  }
  for (const p of problems) console.error(`✗ ${p}`)
  if (problems.length) {
    console.error(`\n云函数入口完整性未通过：${fns.length} 个函数，${problems.length} 处问题`)
    process.exit(1)
  }
  console.log(`✓ 云函数入口完整性通过（${fns.length} 个函数：均有 exports.main / cloud.init / db 定义与可用依赖）`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
