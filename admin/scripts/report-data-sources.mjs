#!/usr/bin/env node
/**
 * 数据源审计守卫（只报告 + 棘轮）
 *
 * 对应产品负责人指令：「全面核查数据口径、数据获取，保证 ERP 各页面的数据源唯一有效，展示合理」。
 *
 * 守卫的不变量（全部可证伪）：
 *   D1 **未登记的数据源**：代码里出现、但没在 `src/utils/dataSources.js` 的 `SOURCE_REGISTRY`
 *      里分类过的集合 / 云函数 / localStorage 键 / 本地存储模块 → 失败。
 *      未登记的数据源正是「同一概念冒出第二个来源」的温床，必须逐个有意识地决定。
 *   D2 **权威源唯一**：一个概念只能有一个 authority；同名源不得登记两次且角色冲突。
 *   D3 **本地权威须标注**：权威源在本地的概念会被列出 —— 它们不跨设备/不跨人，
 *      而云端往往已有同概念的另一份数据。展示层若把它当云端事实呈现，就是「展示不合理」。
 *   D4 **口径分歧**：`METRIC_DIVERGENCES` 登记的「同一指标不同页面不同源」逐条核对，
 *      且**未修复的分歧**会被计入棘轮（只能减少不能增加）。
 *
 * 用法：
 *   node admin/scripts/report-data-sources.mjs              # 报告
 *   node admin/scripts/report-data-sources.mjs --json
 *   node admin/scripts/report-data-sources.mjs --strict     # 未登记源/新增分歧即 exit 1
 *   node admin/scripts/report-data-sources.mjs --update     # 复核后收编棘轮基线
 *   node admin/scripts/report-data-sources.mjs --selftest   # 合成数据证明四类判定会失败
 */
'use strict'

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ADMIN = resolve(HERE, '..')
const SRC = join(ADMIN, 'src')
const SSOT = join(SRC, 'utils', 'dataSources.js')
const BASELINE = join(HERE, 'data-sources-baseline.json')

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)

// ─────────────────────── 采集：代码里真实出现的数据源 ───────────────────────

const READ_HELPERS = [
  'fetchCollectionSorted', 'fetchCollectionWhere', 'fetchCollectionLimit',
  'getCollectionData', 'countCollection', 'cdnDocGet', 'cdnCount', 'cdnQueryPage',
]
const WRITE_HELPERS = [
  'cdnAdd', 'cdnUpdate', 'cdnSet', 'cdnRemove',
  'cdnUpsertSingleton', 'cdnUpsertDoc', 'cdnUpsertByWhere',
]

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(vue|js)$/.test(e.name)) out.push(p)
  }
  return out
}

/**
 * 扫描代码里**真实用到**的数据源。
 * @returns {{ collections: Map<string, {read: string[], write: string[]}>, functions: Set<string>, locals: Set<string>, storages: Set<string> }}
 */
export function scanSources(files) {
  const collections = new Map()
  const functions = new Set()
  const locals = new Set()
  const storages = new Set()
  /** 每个文件用到了哪些源 —— D5「逐页核查」的依据 */
  const perFile = new Map()
  const fileOf = (rel) => {
    if (!perFile.has(rel)) perFile.set(rel, { read: new Set(), write: new Set(), fn: new Set(), local: new Set(), storage: new Set() })
    return perFile.get(rel)
  }
  const touch = (name, kind, file) => {
    if (!collections.has(name)) collections.set(name, { read: [], write: [] })
    const rec = collections.get(name)
    if (!rec[kind].includes(file)) rec[kind].push(file)
    fileOf(file)[kind].add(`collection:${name}`)
  }
  for (const p of files) {
    const txt = readFileSync(p, 'utf8')
    const rel = relative(ADMIN, p)
    for (const h of READ_HELPERS) {
      for (const m of txt.matchAll(new RegExp(`\\b${h}\\(\\s*['"]([a-z][a-z0-9_]{2,})['"]`, 'g'))) touch(m[1], 'read', rel)
    }
    for (const h of WRITE_HELPERS) {
      for (const m of txt.matchAll(new RegExp(`\\b${h}\\(\\s*['"]([a-z][a-z0-9_]{2,})['"]`, 'g'))) touch(m[1], 'write', rel)
    }
    for (const m of txt.matchAll(/\.collection\(\s*['"]([a-z][a-z0-9_]{2,})['"]/g)) touch(m[1], 'read', rel)
    for (const m of txt.matchAll(/(?:callCloudFunction|callCdnFunction)\(\s*['"]([A-Za-z][A-Za-z0-9_]+)['"]/g)) { functions.add(m[1]); fileOf(rel).fn.add(`function:${m[1]}`) }
    for (const m of txt.matchAll(/localStorage\.(?:get|set|remove)Item\(\s*['"]([^'"]+)['"]/g)) { locals.add(m[1]); fileOf(rel).local.add(`local:${m[1]}`) }
    for (const m of txt.matchAll(/from\s+'\.\.?\/utils\/(\w+Storage)\.js'/g)) { storages.add(m[1]); fileOf(rel).storage.add(`storage:${m[1]}`) }
    if (/data\/productConcept/.test(txt)) { storages.add('productConcept(STORAGE_KEY)'); fileOf(rel).storage.add('storage:productConcept(STORAGE_KEY)') }
  }
  return { collections, functions, locals, storages, perFile }
}

// ─────────────────────── 判定（纯函数，可离线自检）───────────────────────

/**
 * @param {{collections: Map, functions: Set, locals: Set, storages: Set}} found
 * @param {Record<string, {concept:string, role:string}>} registry
 * @returns {{ unregistered: string[], duplicateRole: string[], localAuthority: string[], divergenceCount: number }}
 */
export function judge(found, registry, ssot) {
  const ids = [
    ...[...found.collections.keys()].map((n) => `collection:${n}`),
    ...[...found.functions].map((n) => `function:${n}`),
    ...[...found.locals].map((n) => `local:${n}`),
    ...[...found.storages].map((n) => `storage:${n}`),
  ]
  const unregistered = ids.filter((id) => !registry[id]).sort()

  // D2：概念声明的权威集必须与登记表一致。
  // 用**集合**而不是单值：门店 = stores + store_zones、内容 = articles + care_guides、
  // 履约 = ops_purchases + ops_shipments 本就是「一个概念的几张表」，不是两个事实源。
  // 反过来，写入通道（role: channel）**不算**权威 —— 把 manageProducts 也当权威，
  // 会对 13 个概念造出「一个概念两个权威」的假冲突（初版就踩了这个坑）。
  const authByConcept = new Map()
  for (const [id, meta] of Object.entries(registry)) {
    if (meta.role !== 'authority') continue
    if (!authByConcept.has(meta.concept)) authByConcept.set(meta.concept, [])
    authByConcept.get(meta.concept).push(id)
  }
  const duplicateRole = []
  // 与 dataSources.js 的 authoritySetOf 同构（此处自持一份，便于离线自检不依赖仓库文件）
  const authoritySetOf = (c) => [c.authority, ...(c.coAuthorities || [])].map((a) => `${a.kind}:${a.name}`)
  for (const c of ssot.CONCEPTS) {
    const declared = authoritySetOf(c).sort()
    // 共用持有者（如积分与会员都用 users）：登记表只能把一个源挂在一个概念下，
    // 所以这里把「共享概念」的权威 id 一并算进来 —— 但必须显式声明过才允许，
    // 否则就是「一个源偷偷属于两个概念」。
    const shared = c.sharedAuthorityWith ? (authByConcept.get(c.sharedAuthorityWith) || []) : []
    const reg = [...new Set([...(authByConcept.get(c.key) || []), ...shared])].sort()
    const onlyReg = reg.filter((r) => !declared.includes(r))
    const onlyDeclared = declared.filter((d) => !reg.includes(d))
    if (onlyReg.length) duplicateRole.push(`${c.key}：登记表把 ${onlyReg.join('、')} 记为权威，但 CONCEPTS 没声明`)
    if (onlyDeclared.length) duplicateRole.push(`${c.key}：CONCEPTS 声明 ${onlyDeclared.join('、')} 为权威，但登记表未标 authority`)
  }
  // 权威持有者默认只属于一个概念；显式声明 sharedAuthorityWith 的例外（如积分与会员共用 users）
  const sharedOk = new Set(ssot.CONCEPTS.filter((c) => c.sharedAuthorityWith).map((c) => `${c.key}|${c.sharedAuthorityWith}`))
  for (const [concept, list] of authByConcept) {
    for (const id of list) {
      const others = [...authByConcept.entries()].filter(([k, v]) => k !== concept && v.includes(id)).map(([k]) => k)
      const excused = others.every((o) => sharedOk.has(`${concept}|${o}`) || sharedOk.has(`${o}|${concept}`))
      if (others.length && !excused) duplicateRole.push(`${id} 同时是 ${concept} 与 ${others.join('、')} 的权威源`)
    }
  }

  const localAuthority = ssot.localAuthorityConcepts().map((c) => `${c.key}（${c.label} → local:${c.authority.name}）`)
  const divergenceCount = (ssot.METRIC_DIVERGENCES || []).filter((d) => d.status !== 'fixed').length

  // D5：**逐页核查** —— 哪些页面/模块读了「非权威源」。
  // 这是产品负责人「保证 ERP 各页面的数据源唯一有效」的正面检查：
  // 读 authority / channel 是正常的；读 mirror（本机副本，可能过期）、
  // local-only（不跨设备）、legacy（已废弃）则需要给出理由或改读权威源。
  const RISKY = new Set(['mirror', 'local-only', 'legacy'])
  const conceptOf = new Map(ssot.CONCEPTS.map((c) => [c.key, c]))
  const authorityLabel = (conceptKey) => {
    const c = conceptOf.get(conceptKey)
    return c ? authoritySetOf(c).join(' + ') : '（未声明）'
  }
  const nonAuthorityReaders = []
  for (const [file, used] of (found.perFile || new Map())) {
    const all = [...used.read, ...used.local, ...used.storage]
    for (const id of all) {
      const meta = registry[id]
      if (!meta || !RISKY.has(meta.role)) continue
      nonAuthorityReaders.push({
        file,
        source: id,
        role: meta.role,
        concept: meta.concept,
        authority: authorityLabel(meta.concept),
        note: meta.note || '',
      })
    }
  }
  nonAuthorityReaders.sort((a, b) => a.file.localeCompare(b.file) || a.source.localeCompare(b.source))
  return { unregistered, duplicateRole, localAuthority, divergenceCount, nonAuthorityReaders, ids }
}

// ─────────────────────── 自检 ───────────────────────

if (has('--selftest')) {
  console.log('自检：分别注入四类问题，守卫必须各自失败（不读仓库源码）\n')
  const ssot = {
    CONCEPTS: [
      { key: 'a', label: '概念A', authority: { kind: 'collection', name: 'a' } },
      { key: 'b', label: '概念B（本地权威）', authority: { kind: 'local', name: 'k_b' } },
    ],
    localAuthorityConcepts: () => [{ key: 'b', label: '概念B（本地权威）', authority: { kind: 'local', name: 'k_b' } }],
    METRIC_DIVERGENCES: [{ concept: 'a', status: 'open' }, { concept: 'b', status: 'fixed' }],
  }
  const base = {
    'collection:a': { concept: 'a', role: 'authority' },
    'local:k_b': { concept: 'b', role: 'authority' },
  }
  const mk = (collections = [], functions = [], locals = [], storages = [], perFile = null) => ({
    collections: new Map(collections.map((c) => [c, { read: ['x.vue'], write: [] }])),
    functions: new Set(functions),
    locals: new Set(locals),
    storages: new Set(storages),
    perFile: perFile || new Map(),
  })
  const cases = [
    ['D1 未登记集合被检出', () => judge(mk(['a', 'brand_new']), base, ssot).unregistered.includes('collection:brand_new')],
    ['D1 未登记云函数被检出', () => judge(mk(['a'], ['someNewFn']), base, ssot).unregistered.includes('function:someNewFn')],
    ['D1 未登记 localStorage 键被检出', () => judge(mk(['a'], [], ['k_unknown']), base, ssot).unregistered.includes('local:k_unknown')],
    ['D1 已登记源不误报', () => judge(mk(['a'], [], ['k_b']), base, ssot).unregistered.length === 0],
    ['D2 同一概念两个权威源被检出', () => {
      const reg = { ...base, 'collection:a2': { concept: 'a', role: 'authority' } }
      return judge(mk(['a']), reg, ssot).duplicateRole.some((s) => s.includes('登记表把') && s.includes('记为权威'))
    }],
    ['D2 CONCEPTS 与 SOURCE_REGISTRY 写岔被检出', () => {
      const reg = { 'collection:wrong': { concept: 'a', role: 'authority' } }
      return judge(mk([]), reg, ssot).duplicateRole.some((s) => s.includes('CONCEPTS 声明'))
    }],
    ['D3 本地权威概念被列出', () => judge(mk(['a'], [], ['k_b']), base, ssot).localAuthority.some((s) => s.startsWith('b（'))],
    ['D4 只统计未修复的口径分歧', () => judge(mk(['a']), base, ssot).divergenceCount === 1],
    ['D5 检出读「本机副本(mirror)」的页面并指出权威源', () => {
      const reg = { ...base, 'local:k_mirror': { concept: 'a', role: 'mirror' } }
      const ssot2 = { ...ssot, CONCEPTS: ssot.CONCEPTS.concat([{ key: 'a', label: '概念A', authority: { kind: 'collection', name: 'a' } }]) }
      const pf = new Map([['p.vue', { read: new Set(), write: new Set(), fn: new Set(), local: new Set(['local:k_mirror']), storage: new Set() }]])
      const r = judge(mk([], [], [], [], pf), reg, ssot2)
      return r.nonAuthorityReaders.length === 1 && r.nonAuthorityReaders[0].authority === 'collection:a'
    }],
    ['D5 不把读权威源/通道的页面误报', () => {
      const reg = { ...base, 'function:f_a': { concept: 'a', role: 'channel' } }
      const pf = new Map([['p.vue', { read: new Set(['collection:a']), write: new Set(), fn: new Set(['function:f_a']), local: new Set(), storage: new Set() }]])
      return judge(mk([], [], [], [], pf), reg, ssot).nonAuthorityReaders.length === 0
    }],
  ]
  let bad = 0
  for (const [label, fn] of cases) {
    let ok = false
    let err = ''
    try { ok = !!fn() } catch (e) { err = `（异常：${e.message}）` }
    console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` ${err}`}`)
    if (!ok) bad += 1
  }
  console.log()
  if (bad) {
    console.error(`自检失败：${bad} 项判定不符，守卫不可信。`)
    process.exit(1)
  }
  console.log('自检通过：四类判定都能命中，且已登记源不会误报。\n')
  process.exit(0)
}

// ─────────────────────── 主流程 ───────────────────────

const ssot = await import(`file://${SSOT}?t=${Date.now()}`)
const found = scanSources(walk(SRC))
const { unregistered, duplicateRole, localAuthority, divergenceCount, nonAuthorityReaders, ids } = judge(found, ssot.SOURCE_REGISTRY, ssot)

if (has('--json')) {
  console.log(JSON.stringify({
    scannedSources: ids.length,
    registeredSources: Object.keys(ssot.SOURCE_REGISTRY).length,
    unregistered,
    duplicateRole,
    localAuthority,
    divergenceCount,
    nonAuthorityReaders,
    divergentConcepts: ssot.conceptsWithDivergence().map((c) => ({ key: c.key, label: c.label, divergent: c.divergent })),
    metricDivergences: ssot.METRIC_DIVERGENCES,
  }, null, 2))
  process.exit(0)
}

console.log(`数据源审计：代码中出现 ${ids.length} 个源，SSOT 已登记 ${Object.keys(ssot.SOURCE_REGISTRY).length} 个`)
console.log()
console.log(`D1 未登记的源：${unregistered.length} ${unregistered.length ? '✗' : '✓'}`)
unregistered.forEach((u) => console.log(`   ${u}`))
console.log()
console.log(`D2 权威源唯一性冲突：${duplicateRole.length}`)
duplicateRole.forEach((d) => console.log(`   ${d}`))
console.log()
console.log(`D3 权威源在本地的概念（不跨设备，展示层必须标注）：${localAuthority.length}`)
localAuthority.forEach((l) => console.log(`   ${l}`))
console.log()
console.log(`D4 未修复的口径分歧：${divergenceCount}`)
;(ssot.METRIC_DIVERGENCES || []).filter((d) => d.status !== 'fixed').forEach((d) => {
  console.log(`   ${d.label}（${d.concept}）`)
  d.pages.forEach((p) => console.log(`      module ${p.module}  ${p.page}  ← ${p.source}（${p.scope}）`))
})
console.log()
console.log(`D5 读取「非权威源」的页面（读 mirror / local-only / legacy —— 可能过期或换设备即变）：${nonAuthorityReaders.length} 处`)
const byFile = new Map()
nonAuthorityReaders.forEach((r) => {
  if (!byFile.has(r.file)) byFile.set(r.file, [])
  byFile.get(r.file).push(r)
})
;[...byFile.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([file, list]) => {
  console.log(`   ${file}`)
  list.forEach((r) => console.log(`      ${r.source}（${r.role}）→ 权威应为 ${r.authority}`))
})
console.log()
console.log('声明了非权威同义源的概念（展示层须如实标注来源）：')
ssot.conceptsWithDivergence().forEach((c) => console.log(`   ${c.label}: 权威 ${c.authority.kind}:${c.authority.name}；另有 ${c.divergent.join('、')}`))

// 棘轮
const current = { unregistered, duplicateRole, divergenceCount, localAuthorityCount: localAuthority.length, nonAuthorityReaderCount: nonAuthorityReaders.length }
if (has('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify({
    updatedAt: new Date().toISOString().slice(0, 10),
    note: '未登记源应恒为 0；口径分歧数只能减少；本地权威概念数只能减少（要么上云，要么显式标注）',
    unregistered: [],
    duplicateRole: [],
    divergenceCount,
    localAuthorityCount: localAuthority.length,
    nonAuthorityReaderCount: nonAuthorityReaders.length,
    nonAuthorityReaders: nonAuthorityReaders.map((r) => `${r.file} ${r.source}`),
  }, null, 2)}\n`, 'utf8')
  console.log(`\n已写入基线：口径分歧 ${divergenceCount} / 本地权威概念 ${localAuthority.length}`)
} else if (existsSync(BASELINE)) {
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'))
  const bad = []
  if (unregistered.length > (base.unregistered || []).length) bad.push(`未登记源 ${(base.unregistered || []).length}→${unregistered.length}`)
  if (duplicateRole.length > (base.duplicateRole || []).length) bad.push(`权威冲突 ${(base.duplicateRole || []).length}→${duplicateRole.length}`)
  if (divergenceCount > (base.divergenceCount ?? 0)) bad.push(`口径分歧 ${base.divergenceCount}→${divergenceCount}`)
  if (localAuthority.length > (base.localAuthorityCount ?? 0)) bad.push(`本地权威概念 ${base.localAuthorityCount}→${localAuthority.length}`)
  if (nonAuthorityReaders.length > (base.nonAuthorityReaderCount ?? Number.MAX_SAFE_INTEGER)) {
    bad.push(`读取非权威源的页面 ${base.nonAuthorityReaderCount}→${nonAuthorityReaders.length}`)
  }
  console.log(`\n棘轮：${bad.length ? '⚠ ' + bad.join('、') : '未恶化。'}`)
  if (has('--strict') && (bad.length || unregistered.length || duplicateRole.length)) {
    console.error('\n✗ --strict：数据源治理退化。要么修回，要么复核后 --update 收编。')
    process.exit(1)
  }
} else if (has('--strict')) {
  console.error('\n✗ 缺少基线，请先执行 --update。')
  process.exit(1)
}

if (unregistered.length || duplicateRole.length) process.exitCode = unregistered.length || duplicateRole.length ? 1 : 0
