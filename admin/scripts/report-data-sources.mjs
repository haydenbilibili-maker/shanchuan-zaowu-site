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

/**
 * 运行期代码根：小程序 + 云函数 + 官网（Astro）。
 * **必须含官网**：`price_list_items` / `purchase_intents` 正是官网在读
 * （`src/lib/priceListCloud.ts`、`src/lib/purchaseIntent.ts`）—— 漏掉官网会造出
 * 「只写不读」的**假阳性**，而误报的守卫比没有守卫更糟（错题本 E7）。
 */
const RUNTIME_DIRS = [join(ADMIN, '..', 'miniprogram'), join(ADMIN, '..', 'functions'), join(ADMIN, '..', 'src')]

/**
 * D6 的披露标记：ERP 写入、而**运行期从不读取**的集合，其写入方页面必须带这一句 ——
 * 否则就是把「保存了但不生效」显示成配置成功（与「取数失败显示成 0」同一类谎报）。
 */
export const WRITE_ONLY_DISCLOSURE = '未接通运行期'

/** `admin/src/cloud.js` 的 COLLECTIONS 键 → 集合名（与 check-write-verify 同一套解析） */
function readCollectionsMap() {
  try {
    const src = readFileSync(join(SRC, 'cloud.js'), 'utf8')
    const start = src.indexOf('export const COLLECTIONS = {')
    if (start < 0) return {}
    const body = src.slice(start, src.indexOf('\n}', start))
    const map = {}
    for (const m of body.matchAll(/([A-Z0-9_]+)\s*:\s*'([a-z][a-z0-9_]+)'/g)) map[m[1]] = m[2]
    return map
  } catch { return {} }
}

/** 运行期代码里出现过的全部文本（小程序 + 云函数 + 官网）——只用来判「有没有人读」，不做语法解析。
 *  ⚠️ 官网是 `.ts`：只扫 `.js/.vue` 会把 `src/lib/priceListCloud.ts` 漏掉 → 假阳性。 */
function readRuntimeText() {
  const files = []
  const extRe = /\.(js|cjs|mjs|ts|vue|astro)$/
  for (const dir of RUNTIME_DIRS) { try { walk(dir, files, extRe) } catch { /* 目录不存在视为空 */ } }
  return files.map((f) => readFileSync(f, 'utf8')).join('\n')
}

function walk(dir, out = [], extRe = /\.(vue|js)$/) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out, extRe)
    else if (extRe.test(e.name)) out.push(p)
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
  /** D6 专用：解析过「集合常量」的写入/读取站点（不并入 collections，见下方说明） */
  const writeSites = new Map()
  const readSites = new Map()
  const collMap = readCollectionsMap()
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
    for (const m of txt.matchAll(/\.collection\(\s*['"]([a-z][a-z0-9_]{2,})['"]/g)) {
      touch(m[1], 'read', rel)
      if (!readSites.has(m[1])) readSites.set(m[1], new Set())
      readSites.get(m[1]).add(rel)
    }
    // D6 专用：站点扫描（含 `COLLECTIONS.X` 与「本文件集合常量」两种常量实参）。
    // **不并入 `collections`**：那会改变 D1 的覆盖面（实测：解析常量后多出 20 个未登记集合），
    // D1 的收紧必须单独决策 —— 但 D6 要判「运行期有没有人读」，漏掉常量引用就会误报，
    // 而误报的守卫比没有守卫更糟（错题本 E7）。
    const collConsts = new Map()
    for (const m of txt.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*'([a-z][a-z0-9_]{2,})'/g)) {
      if (/COL|COLLECTION/i.test(m[1])) collConsts.set(m[1], m[2])
    }
    const resolveColl = (raw) => {
      if (/^['"]/.test(raw)) return raw.slice(1, -1)
      if (raw.startsWith('COLLECTIONS.')) return collMap[raw.slice('COLLECTIONS.'.length)] || null
      return collConsts.get(raw) || null
    }
    const siteRe = new RegExp(
      `\\b(${[...READ_HELPERS, ...WRITE_HELPERS].join('|')})\\(\\s*(['"][a-z][a-z0-9_]{2,}['"]|COLLECTIONS\\.[A-Z0-9_]+|[A-Za-z_$][\\w$]*)`,
      'g'
    )
    for (const m of txt.matchAll(siteRe)) {
      const name = resolveColl(m[2])
      if (!name) continue
      const map = WRITE_HELPERS.includes(m[1]) ? writeSites : readSites
      if (!map.has(name)) map.set(name, new Set())
      map.get(name).add(rel)
    }
    for (const m of txt.matchAll(/(?:callCloudFunction|callCdnFunction)\(\s*['"]([A-Za-z][A-Za-z0-9_]+)['"]/g)) { functions.add(m[1]); fileOf(rel).fn.add(`function:${m[1]}`) }
    // 先收集本文件的「键名常量」，再解析 localStorage 调用。
    // 为什么必须这样：`localStorage.getItem(FINANCE_RECORDS_KEY)` 这类写法**原先完全扫不到**，
    // 于是「本机账本到底有几个读取方」被系统性低估（实测：三个读取方只暴露出一个，
    // 使 D5 看起来比真实情况干净）。这与 check-write-verify 里解析 COLLECTIONS.XXX 是同一类修正。
    const keyConsts = new Map()
    for (const m of txt.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"]*)\2/g)) {
      // 拼接出来的键（如 `'sh' + 'an' + 'chuan' + '_v12'`）解析不了明文，跳过，
      // 否则会把拼接的第一段（`sh`）当成一个真实键名，制造假的未登记源。
      if (/^\s*\+/.test(txt.slice(m.index + m[0].length))) continue
      if (/KEY|STORAGE/i.test(m[1])) keyConsts.set(m[1], m[3])
    }
    for (const m of txt.matchAll(/localStorage\.(?:get|set|remove)Item\(\s*([A-Za-z_$][\w$]*|['"][^'"]+['"])\s*\)/g)) {
      const raw = m[1]
      const name = /^['"]/.test(raw) ? raw.slice(1, -1) : keyConsts.get(raw)
      if (!name) continue // 解析不出的变量引用（跨文件常量/拼接），属本检查器已知盲区
      locals.add(name)
      fileOf(rel).local.add(`local:${name}`)
    }
    for (const m of txt.matchAll(/from\s+'\.\.?\/utils\/(\w+Storage)\.js'/g)) { storages.add(m[1]); fileOf(rel).storage.add(`storage:${m[1]}`) }
    if (/data\/productConcept/.test(txt)) { storages.add('productConcept(STORAGE_KEY)'); fileOf(rel).storage.add('storage:productConcept(STORAGE_KEY)') }
  }
  return { collections, functions, locals, storages, perFile, writeSites, readSites }
}

// ─────────────────────── 判定（纯函数，可离线自检）───────────────────────

/**
 * @param {{collections: Map, functions: Set, locals: Set, storages: Set, writeSites?: Map, readSites?: Map}} found
 * @param {Record<string, {concept:string, role:string, erpWriteOnly?: boolean}>} registry
 * @param {object} opts `{ runtimeText?: string, disclosureFiles?: Set<string> }`（D6 用）
 * @returns {{ unregistered: string[], duplicateRole: string[], localAuthority: string[], divergenceCount: number,
 *            writeOnly: Array<{collection:string, writers:string[]}>, writeOnlyUndisclosed: string[] }}
 */
export function judge(found, registry, ssot, opts = {}) {
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
  const allowedReaders = []
  for (const [file, used] of (found.perFile || new Map())) {
    const all = [...used.read, ...used.local, ...used.storage]
    for (const id of all) {
      const meta = registry[id]
      if (!meta || !RISKY.has(meta.role)) continue
      const row = {
        file,
        source: id,
        role: meta.role,
        concept: meta.concept,
        authority: authorityLabel(meta.concept),
        note: meta.note || '',
      }
      // 显式白名单：源可以声明「在这些文件里读是**允许**的」，但必须给出理由。
      // 这些**不计入** D5 计数，但会单独列出来 —— 白名单必须看得见，否则就是消音。
      const allow = (meta.readOkIn || []).find((a) => a.file === file)
      if (allow) allowedReaders.push({ ...row, reason: allow.reason || '（未写明理由）' })
      else nonAuthorityReaders.push(row)
    }
  }
  nonAuthorityReaders.sort((a, b) => a.file.localeCompare(b.file) || a.source.localeCompare(b.source))
  allowedReaders.sort((a, b) => a.file.localeCompare(b.file) || a.source.localeCompare(b.source))

  // D6：**ERP 写入、而运行期从不读取**的集合（=「保存了但不生效」）。
  // 起点是 2026-09-22 审计实测：通知消息配置写 `notification_templates`，而小程序运行期
  // （cloudfunctions/dispatchMessage、messageAdmin）读的是 `message_templates`，字段口径也不同
  // —— 页面看着一切正常，保存也弹「成功」，但**配置从不生效**。
  // 判据（三条同时成立才算）：
  //   ① 写入方里有**页面组件**（`.vue`）—— 工具/存储模块的「自有存储」不算（如 storeDesignStorage 的版本表）；
  //   ② 运行期语料（miniprogram/ + functions/）里**一次都没提到**这个集合名；
  //   ③ 写入方之外**没有别的 ERP 文件读它**（只有自己读回来 = 自说自话）。
  // 只做**棘轮**：已知的存量逐条登记在基线，新增即失败（不要求先修完存量，但要求有意识决定）。
  const runtimeText = opts.runtimeText || ''
  const disclosureFiles = opts.disclosureFiles || new Set()
  const writeSites = found.writeSites || new Map()
  const readSites = found.readSites || new Map()
  const writeOnly = []
  for (const [name, writerSet] of writeSites) {
    const writers = [...writerSet].sort()
    if (!writers.some((f) => f.endsWith('.vue'))) continue
    if (runtimeText.includes(name)) continue
    const readers = [...(readSites.get(name) || [])]
    if (readers.some((f) => !writerSet.has(f))) continue
    writeOnly.push({ collection: name, writers })
  }
  writeOnly.sort((a, b) => a.collection.localeCompare(b.collection))
  // D6b：登记表里标了 `erpWriteOnly: true` 的集合，写入方页面必须**显式披露**
  // （`WRITE_ONLY_DISCLOSURE`）—— 不允许把「未接通」显示成配置成功。
  const writeOnlyUndisclosed = []
  for (const row of writeOnly) {
    const meta = registry[`collection:${row.collection}`]
    if (!meta || !meta.erpWriteOnly) continue
    const missing = row.writers.filter((f) => !disclosureFiles.has(f))
    if (missing.length) writeOnlyUndisclosed.push(`${row.collection}（未披露：${missing.join('、')}）`)
  }
  return { unregistered, duplicateRole, localAuthority, divergenceCount, nonAuthorityReaders, allowedReaders, ids, writeOnly, writeOnlyUndisclosed }
}

// ─────────────────────── 自检 ───────────────────────

if (has('--selftest')) {
  console.log('自检：分别注入各类问题，守卫必须各自失败（不读仓库源码）\n')
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
  const mk = (collections = [], functions = [], locals = [], storages = [], perFile = null, sites = null) => ({
    collections: new Map(collections.map((c) => [c, { read: ['x.vue'], write: [] }])),
    functions: new Set(functions),
    locals: new Set(locals),
    storages: new Set(storages),
    perFile: perFile || new Map(),
    writeSites: new Map(Object.entries((sites && sites.write) || {}).map(([k, v]) => [k, new Set(v)])),
    readSites: new Map(Object.entries((sites && sites.read) || {}).map(([k, v]) => [k, new Set(v)])),
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
    ['D6 检出「页面组件写入、运行期零读取、无其它 ERP 读取方」的集合', () => {
      const sites = { write: { dead_cfg: ['src/components/DeadCfg.vue'] }, read: { dead_cfg: ['src/components/DeadCfg.vue'] } }
      const r = judge(mk([], [], [], [], null, sites), base, ssot, { runtimeText: '' })
      return r.writeOnly.length === 1 && r.writeOnly[0].collection === 'dead_cfg'
    }],
    ['D6 不误报「运行期读到的集合」', () => {
      const sites = { write: { live_cfg: ['src/components/LiveCfg.vue'] }, read: { live_cfg: ['src/components/LiveCfg.vue'] } }
      const r = judge(mk([], [], [], [], null, sites), base, ssot, { runtimeText: "db.collection('live_cfg')" })
      return r.writeOnly.length === 0
    }],
    ['D6 不误报「被别的 ERP 文件读到的集合」（有消费方）', () => {
      const sites = { write: { shared_cfg: ['src/components/SharedCfg.vue'] }, read: { shared_cfg: ['src/components/SharedCfg.vue', 'src/utils/consumer.js'] } }
      const r = judge(mk([], [], [], [], null, sites), base, ssot, { runtimeText: '' })
      return r.writeOnly.length === 0
    }],
    ['D6 不误报「工具模块自有存储」（写入方不是页面组件）', () => {
      const sites = { write: { store_design_versions: ['src/utils/storeDesignStorage.js'] }, read: { store_design_versions: ['src/utils/storeDesignStorage.js'] } }
      const r = judge(mk([], [], [], [], null, sites), base, ssot, { runtimeText: '' })
      return r.writeOnly.length === 0
    }],
    ['D6 标了 erpWriteOnly 的集合缺披露即失败', () => {
      const reg = { ...base, 'collection:dead_cfg': { concept: 'a', role: 'derived', erpWriteOnly: true } }
      const sites = { write: { dead_cfg: ['src/components/DeadCfg.vue'] }, read: { dead_cfg: ['src/components/DeadCfg.vue'] } }
      const r = judge(mk([], [], [], [], null, sites), reg, ssot, { runtimeText: '', disclosureFiles: new Set() })
      return r.writeOnlyUndisclosed.length === 1
    }],
    ['D6 有披露则不误报', () => {
      const reg = { ...base, 'collection:dead_cfg': { concept: 'a', role: 'derived', erpWriteOnly: true } }
      const sites = { write: { dead_cfg: ['src/components/DeadCfg.vue'] }, read: { dead_cfg: ['src/components/DeadCfg.vue'] } }
      const r = judge(mk([], [], [], [], null, sites), reg, ssot, { runtimeText: '', disclosureFiles: new Set(['src/components/DeadCfg.vue']) })
      return r.writeOnlyUndisclosed.length === 0
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
  console.log('自检通过：各类判定都能命中，且已登记/已披露的源不会误报。\n')
  process.exit(0)
}

// ─────────────────────── 主流程 ───────────────────────

const ssot = await import(`file://${SSOT}?t=${Date.now()}`)
const found = scanSources(walk(SRC))
// D6 需要的两份外部输入：运行期语料（小程序 + 云函数）与「披露标记出现在哪些页面」
const runtimeText = readRuntimeText()
const disclosureFiles = new Set(
  walk(SRC)
    .filter((p) => readFileSync(p, 'utf8').includes(WRITE_ONLY_DISCLOSURE))
    .map((p) => relative(ADMIN, p))
)
const { unregistered, duplicateRole, localAuthority, divergenceCount, nonAuthorityReaders, allowedReaders, ids, writeOnly, writeOnlyUndisclosed } = judge(found, ssot.SOURCE_REGISTRY, ssot, { runtimeText, disclosureFiles })

if (has('--json')) {
  console.log(JSON.stringify({
    scannedSources: ids.length,
    registeredSources: Object.keys(ssot.SOURCE_REGISTRY).length,
    unregistered,
    duplicateRole,
    localAuthority,
    divergenceCount,
    nonAuthorityReaders,
    allowedReaders,
    writeOnly,
    writeOnlyUndisclosed,
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
if (allowedReaders.length) {
  console.log()
  console.log(`D5b 已声明白名单（读非权威源但**有取新保证**，不计入 D5）：${allowedReaders.length} 处`)
  allowedReaders.forEach((r) => console.log(`   ${r.file}  ${r.source}（${r.role}）—— ${r.reason}`))
}
console.log()
console.log('声明了非权威同义源的概念（展示层须如实标注来源）：')
ssot.conceptsWithDivergence().forEach((c) => console.log(`   ${c.label}: 权威 ${c.authority.kind}:${c.authority.name}；另有 ${c.divergent.join('、')}`))

console.log()
console.log(`D6 ERP 写入、而运行期（小程序/云函数）从不读取的集合（=「保存了但不生效」）：${writeOnly.length}`)
writeOnly.forEach((r) => console.log(`   ${r.collection}  ← ${r.writers.join('、')}`))
if (writeOnlyUndisclosed.length) {
  console.log(`   ✗ 其中**未显式披露**的（登记表标了 erpWriteOnly 却没写「${WRITE_ONLY_DISCLOSURE}」）：${writeOnlyUndisclosed.length}`)
  writeOnlyUndisclosed.forEach((w) => console.log(`      ${w}`))
}
if (!writeOnly.length) console.log('   （无）')

// 棘轮
const current = { unregistered, duplicateRole, divergenceCount, localAuthorityCount: localAuthority.length, nonAuthorityReaderCount: nonAuthorityReaders.length }
if (has('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify({
    updatedAt: new Date().toISOString().slice(0, 10),
    note: '未登记源应恒为 0；口径分歧数只能减少；本地权威概念数只能减少（要么上云，要么显式标注）；'
      + 'D6「ERP 写入但运行期不读」的集合只能减少，且标了 erpWriteOnly 的必须显式披露',
    unregistered: [],
    duplicateRole: [],
    divergenceCount,
    localAuthorityCount: localAuthority.length,
    nonAuthorityReaderCount: nonAuthorityReaders.length,
    writeOnlyCount: writeOnly.length,
    writeOnly: writeOnly.map((r) => `${r.collection} ← ${r.writers.join('、')}`),
    nonAuthorityReaders: nonAuthorityReaders.map((r) => `${r.file} ${r.source}`),
  }, null, 2)}\n`, 'utf8')
  console.log(`\n已写入基线：口径分歧 ${divergenceCount} / 本地权威概念 ${localAuthority.length} / D6 只写不读 ${writeOnly.length}`)
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
  if (writeOnly.length > (base.writeOnlyCount ?? Number.MAX_SAFE_INTEGER)) {
    bad.push(`ERP 只写不读的集合 ${base.writeOnlyCount}→${writeOnly.length}（新增：${writeOnly.map((r) => r.collection).filter((c) => !(base.writeOnly || []).some((b) => b.startsWith(`${c} `))).join('、')}）`)
  }
  if (writeOnlyUndisclosed.length > 0) bad.push(`标了 erpWriteOnly 却未披露：${writeOnlyUndisclosed.join('、')}`)
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
