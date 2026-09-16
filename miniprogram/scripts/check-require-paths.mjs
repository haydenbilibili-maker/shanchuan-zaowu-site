#!/usr/bin/env node
/**
 * 小程序相对 require 路径可解析性守卫
 *
 * 为什么需要（2026-09-16 实测发现，两个真实缺陷）：
 *   小程序没有打包期解析检查 —— 写错一层相对路径**不会报编译错**，
 *   只在**运行到那一行时**抛 `module not found` 式的失败。实测抓到：
 *
 *     `subpackages/feature/articles/detail/index.js:314`  require('../../../utils/util')
 *     `subpackages/feature/collection/detail/index.js:243` require('../../../utils/util')
 *
 *   两者都在 **4 层深**的目录里，却只往上退 3 层 → 指向不存在的 `subpackages/utils/util`。
 *   它们都在**分享**路径上（`resolveShareImage`），即「点分享才炸」——
 *   而分享图黑块在这个仓库已经出过一次事故（见 `check:share-image`）。
 *   只要有一次文件搬迁（本仓库经常做，且刚做过一次），这类错就会成批出现。
 *
 * 检查方式：扫描所有 `.js` 的 `require('<相对路径>')`，逐个解析到真实文件。
 *   - 相对路径支持补 `.js` / `.json` / `/index.js`
 *   - **先剥注释**：JSDoc 里常写 `require('.../utils/x')` 作示例，不剥会假阳性
 *   - 非相对（npm 包 / 内置）不检查
 *
 * 用法：
 *   node miniprogram/scripts/check-require-paths.mjs
 *   node miniprogram/scripts/check-require-paths.mjs --selftest
 * 退出码：存在无法解析的相对 require 为 1。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const MP = join(ROOT, 'miniprogram')
/** 不参与检查的目录（云函数有自己的 require 体系；scripts/docs 不是小程序代码） */
const SKIP_DIRS = new Set(['node_modules', 'cloudfunctions', 'scripts', 'docs', 'miniprogram_npm', '.git'])

/** 纯函数：剥掉块注释与行注释（避免把 JSDoc 示例里的 require 当真实调用） */
export function stripComments(src) {
  return String(src || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** 纯函数：取出所有相对 require 的路径字面量 */
export function collectRelativeRequires(src) {
  const out = []
  for (const m of stripComments(src).matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    out.push(m[1])
  }
  return out
}

/** 纯函数：把相对 spec 解析为真实存在的候选之一；不存在返回 null */
export function resolveRequire(fromFileAbs, spec) {
  const base = resolve(dirname(fromFileAbs), spec)
  const cands = [base, `${base}.js`, `${base}.json`, `${base}.wxs`, join(base, 'index.js')]
  for (const c of cands) {
    try {
      if (existsSync(c) && statSync(c).isFile()) return c
    } catch (e) { /* ignore */ }
  }
  return null
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.js')) out.push(p)
  }
  return out
}

/** 全量扫描；返回问题列表 */
export function scan(jsFiles = walk(MP)) {
  const problems = []
  let checked = 0
  for (const f of jsFiles) {
    for (const spec of collectRelativeRequires(readFileSync(f, 'utf8'))) {
      checked += 1
      if (!resolveRequire(f, spec)) {
        problems.push(`${relative(ROOT, f).replace(/\\/g, '/')} → ${spec}`)
      }
    }
  }
  return { checked, problems }
}

function selftest() {
  let bad = 0
  const t = (n, ok) => {
    if (!ok) bad += 1
    console.log(`${ok ? '✓' : '✗'} ${n}`)
  }

  // 剥注释
  t('块注释里的 require 被剥掉',
    collectRelativeRequires("/** require('.../a') */").length === 0)
  t('行注释里的 require 被剥掉',
    collectRelativeRequires("// require('./a')\nconst x=1").length === 0)
  t('字符串里的 url 不会被误判（非相对）',
    collectRelativeRequires("require('wx-server-sdk')").length === 0)
  t('真实相对 require 被抓到',
    collectRelativeRequires("require('../../utils/util')").length === 1)

  // 解析：用一个真实的**小程序 .js** 文件做基准（本守卫只针对 .js）
  const probe = join(MP, 'subpackages/feature/collection/detail/index.js')
  t('相对路径可解析（同文件所在目录起算）', !!resolveRequire(probe, '../../../../utils/util'))
  t('缺 .js 扩展名可解析', !!resolveRequire(join(MP, 'pages/index/index.js'), '../../utils/util'))
  t('目录 index.js 兜底可解析', !!resolveRequire(join(MP, 'pages/index/index.js'), '.'))
  t('不存在的路径返回 null', !resolveRequire(probe, './definitely-not-here'))

  // ★ 核心断言：**在这个 4 层深的真实文件上，少退一层必须解析失败**
  //   （这正是实测抓到的两个既有缺陷的形态，不必改动磁盘即可断言）
  t('★ 少退一层（../../../utils/util）必须解析失败',
    !resolveRequire(probe, '../../../utils/util'))
  t('  └ 对照：正确层数（../../../../utils/util）可解析',
    !!resolveRequire(probe, '../../../../utils/util'))

  // 该文件的源码里确实用的是正确层数（防止有人改回去）
  t('★ 该文件源码用的是 4 层（已修复，未被改回）',
    readFileSync(probe, 'utf8').includes("require('../../../../utils/util')"))

  if (bad) {
    console.error(`\n自检失败 ${bad} 项——守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：注释剥离、扩展名补齐、index 兜底、少退一层会被检出')
}

function main() {
  if (process.argv.includes('--selftest')) return selftest()
  const { checked, problems } = scan()
  for (const p of problems) console.error(`✗ 无法解析：${p}`)
  if (problems.length) {
    console.error(`\n相对 require 路径未通过：${problems.length} 处（写错一层不会报编译错，只会在运行到那一行时炸）`)
    process.exit(1)
  }
  console.log(`✓ 相对 require 路径全部可解析（${checked} 处）`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
