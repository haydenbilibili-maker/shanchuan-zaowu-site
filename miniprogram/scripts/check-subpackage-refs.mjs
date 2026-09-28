#!/usr/bin/env node
/**
 * 分包边界守卫：**分包之间不得互相引用**
 *
 * 为什么需要（2026-09-17 事故复盘，86 处真实违规）：
 *   微信官方「使用分包 · 引用原则」原文：
 *     - packageA **无法 require** packageB 内的 JS 文件，但可以 require 主包、packageA 内的 JS 文件
 *     - packageA 无法 import packageB 的 template / 使用 packageB 的资源与组件
 *   （https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages/basic.html）
 *   跨包引用在开发者工具里表现为**分包内页面全部起不来** → `navigateTo:fail timeout`，
 *   而 `check:require-paths` 是**查不到的** —— 它只验证「目标文件在磁盘上存在」，
 *   跨包引用的目标当然存在（就在隔壁分包），于是 774/774 全绿，事故照样发生。
 *
 *   **静态可解析 ≠ 打包合法**。本守卫补的就是这一层：不只是「找得到」，
 *   还要「允许被引用」。
 *
 * 检查四类引用（全部按「解析后的真实归属包」判定）：
 *   ① `.js`  的 `require('./x')`
 *   ② `.wxss` 的 `@import "./x.wxss"`
 *   ③ `.wxml` 的 `<import src>` / `<include src>`
 *   ④ `.json` 的 `usingComponents`（相对或 `/subpackages/...` 绝对）
 *   注：`navigateTo` 跳到别的分包的**页面**是合法的（页面跳转不是资源引用），不在此列。
 *
 * 用法：
 *   node miniprogram/scripts/check-subpackage-refs.mjs
 *   node miniprogram/scripts/check-subpackage-refs.mjs --selftest
 * 退出码：存在跨分包引用为 1。
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname, resolve, relative, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const SKIP_DIRS = new Set(['node_modules', 'cloudfunctions', 'scripts', 'docs', 'miniprogram_npm', '.git'])

/** 纯函数：判断一份小程序内路径属于哪个包；主包返回 'main' */
export function packageOf(rel, subs) {
  const r = String(rel || '').replace(/^\//, '')
  for (const s of subs) {
    if (r === s || r.startsWith(`${s}/`)) return s
  }
  return 'main'
}

/** 纯函数：把一个文件解析成真实存在的候选之一 */
export function resolveRef(fromFileRel, spec, subs) {
  const root = MP
  const base = spec.startsWith('/')
    ? normalize(join(root, spec))
    : normalize(join(root, dirname(fromFileRel), spec))
  const cands = [base, `${base}.js`, `${base}.json`, `${base}.wxml`, `${base}.wxss`, `${base}.wxs`,
    join(base, 'index.js'), join(base, 'index.json'), join(base, 'index.wxml'), join(base, 'index.wxss')]
  for (const c of cands) {
    try {
      if (existsSync(c) && statSync(c).isFile()) return relative(root, c).replace(/\\/g, '/')
    } catch { /* ignore */ }
  }
  return null
}

/** 纯函数：收集一个文件里的所有「会绑定到具体文件」的引用 */
export function collectRefs(rel, src) {
  const out = []
  const text = String(src || '')
  if (rel.endsWith('.js')) {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    for (const m of code.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) out.push({ kind: 'require', spec: m[1] })
  } else if (rel.endsWith('.wxss')) {
    for (const m of text.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/@import\s+["']([^"']+)["']/g)) {
      out.push({ kind: 'wxss@import', spec: m[1] })
    }
  } else if (rel.endsWith('.wxml')) {
    for (const m of text.replace(/<!--[\s\S]*?-->/g, ' ').matchAll(/<(?:import|include)\s+src=["']([^"']+)["']/g)) {
      out.push({ kind: 'wxml src', spec: m[1] })
    }
  } else if (rel.endsWith('.json')) {
    try {
      const j = JSON.parse(text)
      // 分包异步化：同名登记了 componentPlaceholder 的组件允许跨包（微信官方唯一的跨包组件通道）
      const placeholder = j.componentPlaceholder || {}
      for (const [name, v] of Object.entries(j.usingComponents || {})) {
        if (typeof placeholder[name] === 'string' && placeholder[name]) continue
        if (typeof v === 'string' && (v.startsWith('.') || v.startsWith('/'))) out.push({ kind: `usingComponents:${name}`, spec: v })
      }
    } catch { /* 带注释的 json 跳过 */ }
  }
  return out
}

/**
 * 镜像副本清单（由分包重基修复生成，见 docs/包体优化与可用性修复_交付记录_2026-09-16.md）。
 * 为了不违反「分包不得互相引用」，引用方分包必须**自带**这些文件的副本 ——
 * 代价是副本可能漂移。其中 `staffAuth.js` / `memberScan.js` 是**鉴权**模块，
 * 漂移等于 extra 与 manager 执行不同的权限判定，所以必须逐字节锁死。
 */
export function readMirrorManifest() {
  const f = join(MP, 'scripts/subpackage-mirrors.json')
  if (!existsSync(f)) return []
  try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return [] }
}

/** 纯函数：比较镜像对，返回问题描述 */
export function checkMirrors(pairs, root = MP, digest = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')) {
  const problems = []
  const missing = []
  for (const { source, mirror, identical } of pairs) {
    const a = join(root, source), b = join(root, mirror)
    if (!existsSync(a)) { problems.push(`[镜像清单失效] 源文件不存在：${source}`); continue }
    if (!existsSync(b)) { problems.push(`[镜像缺失] ${mirror} 不存在（应由 ${source} 镜像而来）`); continue }
    if (identical !== false && digest(a) !== digest(b)) {
      problems.push(`[镜像漂移] ${mirror} 与 ${source} 内容不一致（鉴权/工具模块漂移 = 两个分包行为不同，改一份必须同步改另一份）`)
    }
  }
  return { problems, missing }
}

/** 读 app.json 得到分包 root 列表 */
export function readSubpackages() {
  const app = JSON.parse(readFileSync(join(MP, 'app.json'), 'utf8'))
  return (app.subpackages || app.subPackages || []).map((s) => s.root.replace(/\/$/, ''))
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(js|json|wxml|wxss)$/.test(name)) out.push(p)
  }
  return out
}

/** 全量扫描；返回 { checked, problems, byPair } */
export function scan(files = walk(MP), subs = readSubpackages()) {
  const problems = []
  const byPair = {}
  let checked = 0
  for (const f of files) {
    const rel = relative(MP, f).replace(/\\/g, '/')
    const self = packageOf(rel, subs)
    for (const { kind, spec } of collectRefs(rel, readFileSync(f, 'utf8'))) {
      if (!spec.startsWith('.') && !spec.startsWith('/subpackages/')) continue
      checked += 1
      const target = resolveRef(rel, spec, subs)
      if (!target) continue // 缺失由 check:asset-refs / check:require-paths 负责
      const owner = packageOf(target, subs)
      if (owner === self || owner === 'main') continue
      const pair = `${self} → ${owner}`
      byPair[pair] = (byPair[pair] || 0) + 1
      problems.push(`[${kind}] ${rel} → ${spec}  （${self} 引用 ${owner}，微信禁止分包互相引用）`)
    }
  }
  for (const r of checkMirrors(readMirrorManifest()).problems) problems.push(r)
  return { checked, problems, byPair }
}

function selftest() {
  let bad = 0
  const t = (n, ok) => { if (!ok) bad += 1; console.log(`${ok ? '✓' : '✗'} ${n}`) }
  const subs = readSubpackages()
  t('分包列表读到了（含本轮新建的 extra）', subs.includes('subpackages/extra'))

  // packageOf
  t('packageOf: extra 内文件归 extra', packageOf('subpackages/extra/staff/index.js', subs) === 'subpackages/extra')
  t('packageOf: 主包文件归 main', packageOf('utils/util.js', subs) === 'main')
  t('packageOf: 绝对路径也判得对', packageOf('/subpackages/feature/utils/pageNav.js', subs) === 'subpackages/feature')

  // collectRefs：四类引用
  t('收集 require', collectRefs('a/x.js', "const a=require('../../manager/utils/x')").length === 1)
  t('收集 wxss @import', collectRefs('a/x.wxss', '@import "../y.wxss";').length === 1)
  t('收集 wxml import', collectRefs('a/x.wxml', '<import src="../t.wxml"/>').length === 1)
  t('收集 usingComponents', collectRefs('a/x.json', '{"usingComponents":{"c":"/subpackages/feature/c/index"}}').length === 1)
  t('不使用 usingComponents 的 json 不误报', collectRefs('a/x.json', '{"navigationBarTitleText":"x"}').length === 0)
  t('分包异步化：登记了 componentPlaceholder 的跨包组件不收集',
    collectRefs('a/x.json', '{"usingComponents":{"c":"/subpackages/plays/c/index"},"componentPlaceholder":{"c":"view"}}').length === 0)
  t('★ 占位登记在别的名字上 → 仍收集（不能靠任意一条 placeholder 放行全部）',
    collectRefs('a/x.json', '{"usingComponents":{"c":"/subpackages/plays/c/index"},"componentPlaceholder":{"d":"view"}}').length === 1)

  // resolveRef：真实文件
  const probe = 'subpackages/extra/artisan/index.js'
  t('resolveRef 解析真实跨包目标（extra → manager/utils/staffAuth）',
    resolveRef(probe, '../../manager/utils/staffAuth', subs) === 'subpackages/manager/utils/staffAuth.js')
  t('resolveRef 解析主包目标', !!resolveRef(probe, '../../../utils/util', subs))
  t('resolveRef 对不存在返回 null', resolveRef(probe, './definitely-not-here', subs) === null)

  // ★ 核心断言：跨包必须判违规、同包/主包必须放行
  {
    const judge = (self, spec) => {
      const target = resolveRef(self, spec, subs)
      if (!target) return 'unresolved'
      const owner = packageOf(target, subs)
      return owner === packageOf(self, subs) || owner === 'main' ? 'ok' : 'violation'
    }
    t('★ extra 引 manager/utils/staffAuth 判为违规',
      judge('subpackages/extra/artisan/index.js', '../../manager/utils/staffAuth') === 'violation')
    t('★ extra 引 feature/utils/pageNav 判为违规',
      judge('subpackages/extra/user/feedback/index.js', '../../../feature/utils/pageNav') === 'violation')
    t('  └ 对照：extra 引主包 utils 合法（分包可以引主包）',
      judge('subpackages/extra/artisan/index.js', '../../../utils/util') === 'ok')
    t('  └ 对照：manager 引自己包内 utils 合法',
      judge('subpackages/manager/manager/index.js', '../utils/staffAuth') === 'ok')
  }

  // ★ 镜像副本漂移必须能被检出
  {
    const pairs = readMirrorManifest()
    t(`镜像清单被读到（${pairs.length} 对）`, pairs.length > 0)
    t('镜像清单覆盖了鉴权模块 staffAuth', pairs.some((p) => p.mirror.endsWith('utils/staffAuth.js')))
    t('★ 清单内的镜像当前一致（按 identical 声明逐字节核对）',
      checkMirrors(pairs).problems.length === 0)
    t('★ 缺副本会被检出',
      checkMirrors([{ source: 'utils/util.js', mirror: 'subpackages/extra/utils/__nope__.js', identical: true }]).problems.length === 1)
    t('★ 源文件消失会被检出',
      checkMirrors([{ source: 'utils/__nope__.js', mirror: 'utils/util.js', identical: true }]).problems.length === 1)
  }

  // ★ 端到端：真的改坏一份镜像，scan() 必须报出来，然后还原
  {
    const pairs = readMirrorManifest()
    const victim = pairs.find((p) => p.identical !== false && p.mirror.endsWith('.js'))
    const abs = join(MP, victim.mirror)
    const before = readFileSync(abs)
    const sha = (b) => createHash('sha256').update(b).digest('hex')
    try {
      writeFileSync(abs, `${before}\n// drift probe\n`)
      const res = scan()
      t('★ 镜像漂移被 scan() 检出', res.problems.some((x) => x.includes('镜像漂移')))
    } finally {
      writeFileSync(abs, before)
    }
    t('★ 还原镜像后字节一致', sha(readFileSync(abs)) === sha(before))
  }

  // 仓库自身必须干净 —— 这条就是本守卫存在的意义
  const repo = scan()
  t(`★ 仓库当前无跨分包引用（检查 ${repo.checked} 处）`, repo.problems.length === 0)
  if (repo.problems.length) {
    console.log(`      → 仍有 ${repo.problems.length} 处：${JSON.stringify(repo.byPair)}`)
    repo.problems.slice(0, 3).forEach((p) => console.log('      ' + p))
  }

  if (bad) {
    console.error(`\n自检失败 ${bad} 项——守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：四类引用采集、归属判定、跨包必判违规、同包与主包放行')
}

function main() {
  if (process.argv.includes('--selftest')) return selftest()
  const { checked, problems, byPair } = scan()
  if (problems.length) {
    for (const p of problems.slice(0, 40)) console.error(`✗ ${p}`)
    if (problems.length > 40) console.error(`… 另有 ${problems.length - 40} 处`)
    console.error(`\n跨分包引用未通过：${problems.length} 处 ${JSON.stringify(byPair)}`)
    console.error('（微信禁止分包互相引用：分包只能引用主包与自己。跨包会让该分包内页面全部起不来）')
    process.exit(1)
  }
  console.log(`✓ 无跨分包引用（检查 ${checked} 处 · 分包 ${readSubpackages().length} 个）`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
