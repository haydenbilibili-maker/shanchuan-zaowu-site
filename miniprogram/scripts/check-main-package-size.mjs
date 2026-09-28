#!/usr/bin/env node
/**
 * 主包体积（硬线 + 推荐线）+ 主包不可达 JS 守卫（2026-09-27）
 *
 * 背景：微信开发者工具「代码质量」会拦：
 *   ① 主包（不含插件）> 1.5M（建议项；硬上限是 2M）
 *   ② 主包内存在「主包页面/组件不可达」的 JS（典型：只给分包用的 utils）
 *
 * 口径：
 *   · 按 project.config.json 的 packOptions.ignore 排除不入包目录
 *   · 分包根 = app.json subpackages[].root
 *   · 主包可达：从 app.json pages + app.js + usingComponents 出发沿 require 静态图
 *   · 体积两条线（**产品负责人 2026-09-27 口径：「主包 1.5M 是推荐，2M 以内可以」**）：
 *       - 硬线（失败）：主包**源码原始字节** > 1,950,000（微信主包硬上限 2M = 2,000,000 − 余量 50,000）；
 *       - 推荐线（仅警告）：> 1,500,000 时打印警告、不失败 —— 此时微信「代码质量」扫描的
 *         「主包大小」项会变红，但那是**建议项**，不阻塞上传。
 *     微信按十进制判源码体积：2026-09-27 实测 1,561,498 字节（< 1.5 MiB 却 > 1.5e6）被判未通过推荐项；
 *     同一份代码 CLI 编译后仅 1,076,622，所以不能用编译后体积、也不能用 MiB 当口径。
 *   · 不设允许名单：微信不认「多分包共用、留在主包的桥接件」，照样报「主包未使用的 JS」。
 *     多分包共用件一律复制进各分包，副本一致性登记在 subpackage-mirrors.json（check:subpackage-refs）。
 *   · 分包原始体积只打印、超 2048 KiB 仅警告：微信的 2M 分包上限按编译后体积判（CLI preview --info-output）。
 *
 * 用法：
 *   node miniprogram/scripts/check-main-package-size.mjs
 *   node miniprogram/scripts/check-main-package-size.mjs --selftest
 */
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP_DEFAULT = resolve(HERE, '..')
const WECHAT_MAIN_HARD_LIMIT_BYTES = 2000000
const MARGIN_BYTES = 50000
const MAIN_BUDGET_BYTES = WECHAT_MAIN_HARD_LIMIT_BYTES - MARGIN_BYTES
const MAIN_RECOMMENDED_BYTES = 1500000
const SUB_WARN_BYTES = 2048 * 1024


const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'miniprogram_npm'])

function loadJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'))
}

function isIgnored(rel, ignoreRules) {
  const norm = String(rel || '').replace(/\\/g, '/')
  for (const rule of ignoreRules) {
    const v = String(rule.value || '').replace(/^\//, '').replace(/\\/g, '/')
    if (rule.type === 'folder') {
      if (norm === v || norm.startsWith(`${v}/`)) return true
    } else if (rule.type === 'file') {
      if (norm === v || norm.split('/').pop() === v) return true
    } else if (rule.type === 'suffix') {
      if (norm.endsWith(v)) return true
    } else if (rule.type === 'prefix') {
      const base = norm.split('/').pop() || ''
      if (base.startsWith(v) || norm.includes(`/${v}`)) return true
    }
  }
  return false
}

function walkPacked(mpRoot, ignoreRules, dir = mpRoot, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (SKIP_DIR_NAMES.has(e.name)) continue
    const full = join(dir, e.name)
    const rel = relative(mpRoot, full).replace(/\\/g, '/')
    if (isIgnored(rel, ignoreRules)) continue
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walkPacked(mpRoot, ignoreRules, full, out)
    else if (st.isFile()) out.push(rel)
  }
  return out
}

function packageOf(rel, subRoots) {
  const r = String(rel || '').replace(/^\//, '')
  for (const s of subRoots) {
    if (r === s || r.startsWith(`${s}/`)) return s
  }
  return 'main'
}

function extractRequires(src) {
  const code = String(src || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const out = []
  for (const m of code.matchAll(/require(?:\.async)?\s*\(\s*['"]([^'"]+)['"]/g)) out.push(m[1])
  return out
}

function resolveRequire(mpRoot, fromRel, spec) {
  if (!spec || (!spec.startsWith('.') && !spec.startsWith('/'))) return null
  const base = spec.startsWith('/')
    ? join(mpRoot, spec.slice(1))
    : resolve(mpRoot, dirname(fromRel), spec)
  for (const c of [base, `${base}.js`, join(base, 'index.js')]) {
    try {
      if (existsSync(c) && statSync(c).isFile()) return relative(mpRoot, c).replace(/\\/g, '/')
    } catch { /* ignore */ }
  }
  return null
}

function extractComponents(mpRoot, jsonRel) {
  const p = join(mpRoot, jsonRel)
  if (!existsSync(p)) return []
  try {
    const comps = loadJson(p).usingComponents || {}
    const out = []
    for (const v of Object.values(comps)) {
      const rel = String(v || '').replace(/^\//, '')
      for (const c of [`${rel}.js`, join(rel, 'index.js')]) {
        if (existsSync(join(mpRoot, c))) {
          out.push(c.replace(/\\/g, '/'))
          break
        }
      }
    }
    return out
  } catch {
    return []
  }
}

function collectMainReachable(mpRoot, appJson, subRoots) {
  const entries = new Set()
  for (const p of appJson.pages || []) entries.add(`${p}.js`)
  entries.add('app.js')
  for (const c of Object.values(appJson.usingComponents || {})) {
    const rel = String(c || '').replace(/^\//, '')
    if (existsSync(join(mpRoot, `${rel}.js`))) entries.add(`${rel}.js`)
    else if (existsSync(join(mpRoot, rel, 'index.js'))) entries.add(join(rel, 'index.js').replace(/\\/g, '/'))
  }
  if (existsSync(join(mpRoot, 'custom-tab-bar/index.js'))) entries.add('custom-tab-bar/index.js')

  const visitedJson = new Set()
  function pullJson(jsRel) {
    const jsonRel = jsRel.replace(/\.js$/, '.json')
    if (visitedJson.has(jsonRel)) return
    visitedJson.add(jsonRel)
    for (const c of extractComponents(mpRoot, jsonRel)) {
      if (packageOf(c, subRoots) !== 'main') continue
      entries.add(c)
      pullJson(c)
    }
  }
  for (const e of [...entries]) pullJson(e)

  const reachable = new Set()
  const queue = [...entries]
  while (queue.length) {
    const f = queue.pop()
    if (reachable.has(f) || !existsSync(join(mpRoot, f))) continue
    if (packageOf(f, subRoots) !== 'main') continue
    reachable.add(f)
    if (!f.endsWith('.js')) continue
    const src = readFileSync(join(mpRoot, f), 'utf8')
    for (const spec of extractRequires(src)) {
      const r = resolveRequire(mpRoot, f, spec)
      if (r && !reachable.has(r)) queue.push(r)
    }
    pullJson(f)
  }
  return reachable
}

function analyze(mpRoot) {
  const appJson = loadJson(join(mpRoot, 'app.json'))
  const projectConfig = loadJson(join(mpRoot, 'project.config.json'))
  const ignoreRules = (projectConfig.packOptions && projectConfig.packOptions.ignore) || []
  const subRoots = (appJson.subpackages || []).map((s) => String(s.root || '').replace(/\/$/, ''))
  const packed = walkPacked(mpRoot, ignoreRules)
  const mainFiles = packed.filter((f) => packageOf(f, subRoots) === 'main')
  let mainBytes = 0
  for (const f of mainFiles) {
    try {
      mainBytes += statSync(join(mpRoot, f)).size
    } catch {
      /* broken symlink / vanished — skip */
    }
  }

  const reachable = collectMainReachable(mpRoot, appJson, subRoots)
  const unreachable = []
  for (const f of mainFiles) {
    if (!f.endsWith('.js')) continue
    if (!reachable.has(f)) unreachable.push(f)
  }
  unreachable.sort()
  const subBytes = {}
  for (const f of packed) {
    const p = packageOf(f, subRoots)
    if (p === 'main') continue
    try {
      subBytes[p] = (subBytes[p] || 0) + statSync(join(mpRoot, f)).size
    } catch {
      /* vanished — skip */
    }
  }
  return { mainBytes, mainFiles: mainFiles.length, unreachable, budget: MAIN_BUDGET_BYTES, subBytes }
}

function warnings(result) {
  if (result.mainBytes <= MAIN_RECOMMENDED_BYTES || result.mainBytes > result.budget) return []
  return [
    `主包 ${result.mainBytes} 字节 > 推荐线 ${MAIN_RECOMMENDED_BYTES} 字节（未超硬线 ${result.budget}，不失败；微信「代码质量」的主包大小建议项会变红）`
  ]
}

function report(result) {
  const problems = []
  if (result.mainBytes > result.budget) {
    problems.push(
      `主包 ${result.mainBytes} 字节 > 硬线 ${result.budget} 字节（微信主包上限 2M = ${WECHAT_MAIN_HARD_LIMIT_BYTES} 字节 − 余量 ${MARGIN_BYTES}）`
    )
  }
  if (result.unreachable.length) {
    problems.push(
      `主包不可达 JS 共 ${result.unreachable.length} 个：\n  - ${result.unreachable.join('\n  - ')}`
    )
  }
  return problems
}

/** 自检：最小假工程，不拷贝真仓（避免覆盖/耗时） */
function buildFake(dir, padBytes, withJunk) {
  const mp = join(dir, 'miniprogram')
  mkdirSync(join(mp, 'pages', 'index'), { recursive: true })
  mkdirSync(join(mp, 'utils'), { recursive: true })
  mkdirSync(join(mp, 'assets'), { recursive: true })
  writeFileSync(join(mp, 'app.json'), JSON.stringify({
    pages: ['pages/index/index'],
    subpackages: [{ root: 'subpackages/feature', pages: ['x/index'] }]
  }))
  writeFileSync(join(mp, 'project.config.json'), JSON.stringify({
    packOptions: { ignore: [{ type: 'folder', value: 'scripts' }] }
  }))
  writeFileSync(join(mp, 'app.js'), 'App({})\n')
  writeFileSync(join(mp, 'pages/index/index.js'), "Page({ onLoad() { require('../../utils/used') } })\n")
  writeFileSync(join(mp, 'pages/index/index.json'), '{}\n')
  writeFileSync(join(mp, 'utils/used.js'), 'module.exports = {}\n')
  if (withJunk) {
    writeFileSync(join(mp, 'utils/__junk_unreachable.js'), `module.exports = '${'x'.repeat(100)}'\n`)
    // 曾经的「桥接件白名单」名字：不允许再豁免
    writeFileSync(join(mp, 'utils/workNoticeVoice.js'), 'module.exports = {}\n')
  }
  writeFileSync(join(mp, 'assets/pad.bin'), Buffer.alloc(padBytes, 1))
  return mp
}

function runFake(padBytes, withJunk) {
  const dir = mkdtempSync(join(tmpdir(), 'main-pkg-size-'))
  try {
    const mp = buildFake(dir, padBytes, withJunk)
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--root', mp], { encoding: 'utf8' })
    return { status: r.status, out: `${r.stdout || ''}\n${r.stderr || ''}` }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function selftest() {
  const fail = (msg, out) => {
    console.error(`selftest ✗ ${msg}\n${out || ''}`)
    process.exit(1)
  }
  // ① 1,960,000 字节 + 不可达 JS：< 2 MiB 却 > 硬线 —— 必须失败，且两类问题都被点名
  const a = runFake(1960000, true)
  if (a.status === 0) fail('超硬线 + 不可达注入后仍 exit 0', a.out)
  if (!/__junk_unreachable/.test(a.out) || !/utils\/workNoticeVoice\.js/.test(a.out)) fail('未点名不可达文件', a.out)
  if (!/硬线 1950000 字节/.test(a.out)) fail('未点名硬线', a.out)
  // ② 1,600,000 字节、无不可达：介于推荐线与硬线之间 —— 只警告、不失败
  const b = runFake(1600000, false)
  if (b.status !== 0) fail('介于推荐线与硬线之间却失败了（推荐线只应警告）', b.out)
  if (!/⚠ 主包 \d+ 字节 > 推荐线 1500000 字节/.test(b.out)) fail('超推荐线未打印警告', b.out)
  // ③ 仅不可达 JS（体积远低于推荐线）：「不可达 = 0」仍是硬失败
  const c = runFake(1000, true)
  if (c.status === 0) fail('不可达 JS 未失败', c.out)
  if (/⚠ 主包 \d+ 字节 > 推荐线/.test(c.out)) fail('低于推荐线却打印了推荐线警告', c.out)
  console.log('selftest ok（超硬线失败 / 两线之间只警告 / 不可达 JS 硬失败）')
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--selftest')) {
    selftest()
    return
  }
  const rootIdx = args.indexOf('--root')
  const mpRoot = rootIdx >= 0 ? resolve(args[rootIdx + 1]) : MP_DEFAULT
  const result = analyze(mpRoot)
  const problems = report(result)
  console.log(
    `main ${result.mainBytes} B（${(result.mainBytes / 1024).toFixed(1)} KiB）· 推荐线 ${MAIN_RECOMMENDED_BYTES} B（余 ${MAIN_RECOMMENDED_BYTES - result.mainBytes}）· 硬线 ${result.budget} B（余 ${result.budget - result.mainBytes}）· files ${result.mainFiles} · unreachable ${result.unreachable.length}`
  )
  for (const w of warnings(result)) console.warn(`⚠ ${w}`)
  for (const [p, b] of Object.entries(result.subBytes)) {
    const warn = b > SUB_WARN_BYTES ? '  ⚠ 原始体积超 2048 KiB（微信按编译后体积判 2M，需用 CLI 复核）' : ''
    console.log(`  ${p} ${(b / 1024).toFixed(1)} KiB${warn}`)
  }
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`)
    process.exit(1)
  }
  console.log('✓ 主包体积与不可达 JS 检查通过')
}

main()
