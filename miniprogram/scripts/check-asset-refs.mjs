#!/usr/bin/env node
/**
 * 小程序「相对资源引用」可解析性守卫
 *
 * 为什么需要（2026-09-16 文件搬迁时实测抓到 22 处真实断链）：
 *   小程序编译**不检查**这三类相对路径，缺文件时只在运行时静默失效或报错：
 *     - `.wxss` 的 `@import "./x.wxss"`   → 缺失时样式**整块消失**（页面看着"没坏"，只是没样式）
 *     - `.wxml` 的 `<import src>` / `<include src>` → 缺失时模板报编译错，但错误信息指向行号而非文件
 *     - `.json` 的 `usingComponents` 相对路径 → 缺失时组件不渲染（无报错）
 *   与 `check:require-paths` 是**姊妹守卫**：那一支管 JS 的 `require`，本支管样式/模板/组件。
 *
 *   实测案例（把 `subpackages/manager/<组>` 整体搬到 `subpackages/extra/<组>` 之后）：
 *     `subpackages/extra/staff/index.wxss` → `../utils/workbench-nav.wxss`
 *   目标 `subpackages/manager/utils/` 留在原地没搬，于是 `extra/utils/` 不存在 → 断链。
 *   **只有 @import 断链完全不报错**，这正是最该被守卫兜住的一种。
 *
 * 用法：
 *   node miniprogram/scripts/check-asset-refs.mjs
 *   node miniprogram/scripts/check-asset-refs.mjs --selftest
 * 退出码：存在无法解析的相对引用为 1。
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const MP = join(ROOT, 'miniprogram')
/** 不参与检查的目录（云函数有自己的目录体系；scripts/docs 不是小程序代码） */
const SKIP_DIRS = new Set(['node_modules', 'cloudfunctions', 'scripts', 'docs', 'miniprogram_npm', '.git'])

/** 纯函数：剥掉 WXSS 块注释（`@import` 出现在注释里时不算引用） */
export function stripWxssComments(src) {
  return String(src || '').replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 纯函数：剥掉 WXML 注释 `<!-- -->` */
export function stripWxmlComments(src) {
  return String(src || '').replace(/<!--[\s\S]*?-->/g, '')
}

/** 纯函数：收集一个文件里的相对资源引用；返回 [{kind, spec}] */
export function collectAssetRefs(relPath, src) {
  const text = String(src || '')
  const out = []
  if (relPath.endsWith('.wxss')) {
    for (const m of stripWxssComments(text).matchAll(/@import\s+["']([^"']+)["']/g)) {
      out.push({ kind: 'wxss@import', spec: m[1] })
    }
  } else if (relPath.endsWith('.wxml')) {
    for (const m of stripWxmlComments(text).matchAll(/<(?:import|include)\s+src=["']([^"']+)["']/g)) {
      out.push({ kind: 'wxml src', spec: m[1] })
    }
  } else if (relPath.endsWith('.json')) {
    try {
      const j = JSON.parse(text)
      for (const [name, v] of Object.entries(j.usingComponents || {})) {
        out.push({ kind: `usingComponents:${name}`, spec: v })
      }
    } catch { /* 带注释的 json 解析不了就跳过（微信允许注释，非本守卫职责） */ }
  }
  // 只关心相对路径；绝对 `/xxx` 由 check:page-paths 管，包名（plugin:// 等）跳过
  return out.filter((r) => typeof r.spec === 'string' && r.spec.startsWith('.'))
}

/** 纯函数：把相对 spec 解析为真实存在的候选之一；不存在返回 null */
export function resolveAssetRef(fromFileAbs, spec) {
  const base = resolve(dirname(fromFileAbs), spec)
  const cands = [base, `${base}.wxss`, `${base}.wxml`, `${base}.json`, `${base}.js`,
    join(base, 'index.wxss'), join(base, 'index.wxml'), join(base, 'index.json'), join(base, 'index.js')]
  for (const c of cands) {
    try {
      if (existsSync(c) && statSync(c).isFile()) return c
    } catch { /* ignore */ }
  }
  return null
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(wxss|wxml|json)$/.test(name)) out.push(p)
  }
  return out
}

/** 子包列表（与 app.json 的 root 段一致；主包视为 'main'） */
const SUBPACKAGES = ['business', 'manager', 'feature', 'extra']

/**
 * 纯函数：一个文件属于哪个包（主包返回 'main'）。
 * @param {string} rel 形如 `subpackages/extra/artisan/index.json`
 */
export function packageOf(rel) {
  for (const s of SUBPACKAGES) {
    if (rel === `subpackages/${s}` || rel.startsWith(`subpackages/${s}/`)) return s
  }
  return 'main'
}

/**
 * 纯函数：找出「跨分包引用组件」。
 *
 * 为什么必须为 0（2026-09-16 实测踩到）：微信小程序**不允许分包 A 使用分包 B 的组件**
 * （官方口径：分包之间不能互相引用资源；只有「分包异步化」+ `componentPlaceholder`
 * 才能跨包，本仓库没用那套）。跨包引用会让**整个分包**加载/编译失败 ——
 * 表现就是「这个分包里每个页面点进去都打不开」，而工具的大小检查是**通过**的。
 *
 * 本轮真实案例（都是文件搬迁引入的）：
 *   `subpackages/extra/user/stored-value` → `/subpackages/feature/components/WalletHubBar`
 *   `subpackages/extra/artisan`          → `/subpackages/manager/components/WorkNoticeVoice`
 * 修法：只有一个使用者的组件**随使用者搬**（WalletHubBar）；
 *       多个分包都要用的组件放**主包**、或每个分包各留一份**逐字节相同**的副本（WorkNoticeVoice）。
 *
 * @returns {string[]} 问题描述
 */
export function crossPackageProblems(rel, usingComponents) {
  const problems = []
  const self = packageOf(rel)
  for (const [name, val] of Object.entries(usingComponents || {})) {
    if (typeof val !== 'string' || !val.startsWith('/subpackages/')) continue
    const owner = packageOf(val.replace(/^\//, ''))
    if (owner !== self && owner !== 'main') {
      problems.push(`[跨分包组件] ${rel} 的「${name}」→ ${val}（${self} 引用 ${owner} 的组件，整个 ${self} 分包会加载失败）`)
    }
  }
  return problems
}

/**
 * 允许存在的「同名组件多份副本」：必须**逐字节相同**。
 * 与 `check:shared-modules`（云函数侧家族）同一个思路：可以重复，但不许漂移。
 * 这里只登记因分包限制而不得不多份的**组件**。
 */
export const DUPLICATED_COMPONENTS = [
  {
    // 2026-09-17 实测踩到：给 WalletHubBar 加第三个 tab 时只改了 business 那份，
    // extra 那份仍是旧的两 tab → 同一个组件在两个页面渲染出不同结果。
    // 分包之间不能互相引用组件，所以副本必须存在；既然存在就必须**逐字节锁死**。
    name: 'WalletHubBar',
    copies: [
      'subpackages/business/components/WalletHubBar',
      'subpackages/extra/components/WalletHubBar'
    ]
  },
  {
    name: 'WorkNoticeVoice',
    copies: [
      'subpackages/manager/components/WorkNoticeVoice',
      'subpackages/extra/components/WorkNoticeVoice'
    ]
  }
]

/** 纯函数：比较两组 {相对路径: 内容}，返回差异描述 */
export function compareCopies(name, a, b, labelA, labelB) {
  const problems = []
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if (!(k in a)) { problems.push(`[副本缺文件] ${name}: ${labelA} 缺 ${k}`); continue }
    if (!(k in b)) { problems.push(`[副本缺文件] ${name}: ${labelB} 缺 ${k}`); continue }
    if (a[k] !== b[k]) problems.push(`[副本漂移] ${name}/${k}: ${labelA} 与 ${labelB} 内容不一致（改一份必须同步改另一份）`)
  }
  return problems
}

/** 读取一个组件目录下的所有文件内容 */
function readDir(dirAbs) {
  const out = {}
  if (!existsSync(dirAbs)) return out
  for (const name of readdirSync(dirAbs)) {
    const p = join(dirAbs, name)
    if (statSync(p).isFile()) out[name] = readFileSync(p, 'utf8')
  }
  return out
}

/**
 * 纯函数：页面 WXML 用到的「app.json 全局组件」，必须在**该页面自己的 json** 里再声明一次。
 *
 * 为什么（2026-09-17，实测 4 个页面踩到，其中就有打不开的 `feature/detail`）：
 *   本项目 `app.json` 设了 `lazyCodeLoading: "requiredComponents"` —— 按需注入，
 *   **只注入页面 json 里声明过的组件**。只在 app.json 全局声明、页面 json 不写，
 *   就变成「脆弱依赖」：组件可能没被注入 → WXML 渲染失败 → 页面起不来
 *   → 表现为 `navigateTo:fail timeout`（和包体超限、跨分包引用的现象一模一样）。
 *   四个页面分别是 `feature/detail`(nav-back)、`feature/gift/my-gifts`、
 *   `business/aftersale-apply`(page-edge-back)、`manager/manager`(两者)。
 */
export function missingLocalComponentDecls(rel, wxml, pageJson, globalTags) {
  const problems = []
  let uc = {}
  try { uc = (pageJson && JSON.parse(pageJson).usingComponents) || {} } catch { return problems }
  for (const tag of globalTags) {
    if (!new RegExp(`<${tag}[\\s/>]`).test(wxml)) continue
    if (!uc[tag]) {
      problems.push(`[全局组件未本地声明] ${rel} 用了 <${tag}>，但页面 json 没声明；` +
        `lazyCodeLoading=requiredComponents 下可能不注入 → 页面起不来`)
    }
  }
  return problems
}

/** 全量扫描；返回 { checked, problems } */
export function scan(files = walk(MP)) {
  const problems = []
  let checked = 0
  let globalTags = []
  try {
    const app = JSON.parse(readFileSync(join(MP, 'app.json'), 'utf8'))
    globalTags = Object.keys(app.usingComponents || {})
  } catch { /* app.json 读不到就跳过这一层 */ }
  for (const f of files) {
    const rel = relative(MP, f).replace(/\\/g, '/')
    const src = readFileSync(f, 'utf8')
    for (const { kind, spec } of collectAssetRefs(rel, src)) {
      checked += 1
      if (!resolveAssetRef(f, spec)) problems.push(`[${kind}] ${rel} → ${spec}`)
    }
    if (rel.endsWith('.json')) {
      try {
        const j = JSON.parse(src)
        problems.push(...crossPackageProblems(rel, j.usingComponents))
      } catch { /* 带注释的 json 跳过 */ }
    }
    if (globalTags.length && rel.endsWith('.wxml')) {
      const jf = join(MP, rel.replace(/\.wxml$/, '.json'))
      if (existsSync(jf)) {
        problems.push(...missingLocalComponentDecls(rel, src, readFileSync(jf, 'utf8'), globalTags))
        checked += 1
      }
    }
  }
  for (const fam of DUPLICATED_COMPONENTS) {
    for (let i = 1; i < fam.copies.length; i++) {
      problems.push(...compareCopies(
        fam.name,
        readDir(join(MP, fam.copies[0])),
        readDir(join(MP, fam.copies[i])),
        fam.copies[0], fam.copies[i]
      ))
    }
  }
  return { checked, problems }
}

function selftest() {
  let bad = 0
  const t = (n, ok) => { if (!ok) bad += 1; console.log(`${ok ? '✓' : '✗'} ${n}`) }

  // —— 采集：三类引用 + 注释剥离 ——
  t('wxss @import 被抓到',
    collectAssetRefs('a.wxss', '@import "../utils/x.wxss";').length === 1)
  t('wxss 注释里的 @import 被剥掉',
    collectAssetRefs('a.wxss', '/* @import "../utils/x.wxss"; */').length === 0)
  t('wxml <import src> 被抓到',
    collectAssetRefs('a.wxml', '<import src="./tpl.wxml"/>').length === 1)
  t('wxml <include src> 被抓到',
    collectAssetRefs('a.wxml', '<include src="../tpl.wxml"/>').length === 1)
  t('wxml 注释里的 import 被剥掉',
    collectAssetRefs('a.wxml', '<!-- <import src="./tpl.wxml"/> -->').length === 0)
  t('json usingComponents 相对路径被抓到',
    collectAssetRefs('a.json', '{"usingComponents":{"c":"../../components/c/index"}}').length === 1)
  t('绝对/包名引用被过滤掉',
    collectAssetRefs('a.wxml', '<import src="/abs/tpl.wxml"/>').length === 0
    && collectAssetRefs('a.wxml', '<import src="plugin://x/tpl"/>').length === 0)

  // —— 解析：用真实文件断言 ——
  const wxssProbe = join(MP, 'subpackages/manager/payslip/index.wxss')
  t('真实存在的同级引用可解析（payslip → ../../extra/staff/scene.wxss）',
    !!resolveAssetRef(wxssProbe, '../../extra/staff/scene.wxss'))
  t('不存在的路径返回 null', !resolveAssetRef(wxssProbe, './definitely-not-here.wxss'))
  // 这条断链（manager/payslip 引 extra 的 scene.wxss）已由「分包重基」修好：
  // 副本被镜像到 manager/staff/scene.wxss，路径从「跨分包」变成「包内」。
  // 所以这里断言**现在必须能解析**；跨分包一律违规由 check:subpackage-refs 独立兜住。
  t('★ 重基后 ../staff/scene.wxss 在 manager/payslip 下可解析（镜像副本已就位）',
    !!resolveAssetRef(wxssProbe, '../staff/scene.wxss'))
  t('  └ 对照：真正不存在的路径仍必须解析失败',
    !resolveAssetRef(wxssProbe, './definitely-not-here-either.wxss'))

  // —— ★ 端到端：向真实文件注入一条断链 @import，必须被检出，然后还原 ——
  const inj = join(MP, 'subpackages/extra/staff/index.wxss')
  const before = readFileSync(inj)
  const sha = (b) => createHash('sha256').update(b).digest('hex')
  try {
    writeFileSync(inj, `${before}\n@import "./__dsh_guard_probe__.wxss";\n`)
    const res = scan()
    t('★ 注入的断链 @import 被检出',
      res.problems.some((p) => p.includes('__dsh_guard_probe__')))
    t('★ 注入后问题数 ≥1（守卫真的会失败）', res.problems.length >= 1)
  } finally {
    writeFileSync(inj, before)
  }
  t('★ 还原后字节一致', sha(readFileSync(inj)) === sha(before))

  // ★ 全局组件必须本地声明
  {
    const g = ['nav-back', 'page-edge-back']
    t('★ 用了全局组件但页面未声明 → 检出',
      missingLocalComponentDecls('a/b/index.wxml', '<nav-back />', '{"usingComponents":{}}', g).length === 1)
    t('  └ 对照：页面已声明则不报',
      missingLocalComponentDecls('a/b/index.wxml', '<nav-back />',
        '{"usingComponents":{"nav-back":"/components/NavBack/index"}}', g).length === 0)
    t('  └ 对照：未用到该组件不报',
      missingLocalComponentDecls('a/b/index.wxml', '<view />', '{"usingComponents":{}}', g).length === 0)
  }

  // ★ 跨分包组件引用：必须能被检出（这是「整个分包打不开」的形态）
  t('★ 跨分包组件引用被判为问题（extra 用 feature 的组件）',
    crossPackageProblems('subpackages/extra/artisan/index.json',
      { c: '/subpackages/feature/components/WalletHubBar/index' }).length === 1)
  t('  └ 对照：同包内引用没问题',
    crossPackageProblems('subpackages/extra/artisan/index.json',
      { c: '/subpackages/extra/components/x/index' }).length === 0)
  t('  └ 对照：引用主包组件没问题（主包对所有分包可见）',
    crossPackageProblems('subpackages/extra/artisan/index.json',
      { c: '/components/x/index' }).length === 0)
  t('packageOf 归属判定正确',
    packageOf('subpackages/extra/user/stored-value/index.json') === 'extra'
    && packageOf('pages/index/index.json') === 'main')

  // ★ 副本漂移必须能被检出
  t('★ 副本内容不一致被判为问题',
    compareCopies('C', { 'index.js': 'a' }, { 'index.js': 'b' }, 'A', 'B').length === 1)
  t('  └ 对照：副本一致时无问题',
    compareCopies('C', { 'index.js': 'a' }, { 'index.js': 'a' }, 'A', 'B').length === 0)
  t('★ 副本缺文件被判为问题',
    compareCopies('C', { 'index.js': 'a' }, {}, 'A', 'B').length === 1)

  // ★ 端到端：真的改坏一份副本，scan() 必须报出来，然后还原
  {
    const fam = DUPLICATED_COMPONENTS[0]
    const victim = join(MP, fam.copies[1], 'index.js')
    const before2 = readFileSync(victim)
    try {
      writeFileSync(victim, `${before2}
// drift probe
`)
      const res = scan()
      t('★ 副本漂移被 scan() 检出', res.problems.some((x) => x.includes('副本漂移')))
    } finally {
      writeFileSync(victim, before2)
    }
    t('★ 还原副本后字节一致', sha(readFileSync(victim)) === sha(before2))
  }

  const after = scan()
  t('★ 还原后扫描恢复为 0 问题', after.problems.length === 0)

  if (bad) {
    console.error(`\n自检失败 ${bad} 项——守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：三类引用采集、注释剥离、相对解析、注入断链必被检出且可还原')
}

function main() {
  if (process.argv.includes('--selftest')) return selftest()
  const { checked, problems } = scan()
  for (const p of problems) console.error(`✗ 无法解析：${p}`)
  if (problems.length) {
    console.error(`\n相对资源引用未通过：${problems.length} 处（@import 断链不报错，只会让样式静默消失）`)
    process.exit(1)
  }
  console.log(`✓ 相对资源引用全部可解析（${checked} 处）`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
