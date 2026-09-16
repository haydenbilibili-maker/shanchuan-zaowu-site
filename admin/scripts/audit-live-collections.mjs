#!/usr/bin/env node
/**
 * 线上集合权限 × 仓库规则 × 代码引用 —— **只读**三向核对
 *
 * 为什么需要它：审计报告「附录 A」原先指向 ` /tmp/dbdiag/*.cjs` 三个临时脚本，
 * 那些文件在本机早已不存在，结论无法复跑。本脚本把它们固化成仓库内的只读工具。
 *
 * **只读保证**：只调用 `ListTables`（列集合）与 `DescribeResourcePermission`（查权限），
 * 代码中不出现 create/modify/delete 类 API。跑一次不会改动线上任何东西。
 *
 * 凭据：`admin/.env` 的 `TCB_SECRET_ID` / `TCB_SECRET_KEY`（腾讯云 API 密钥，勿提交）。
 *
 * 用法：
 *   node admin/scripts/audit-live-collections.mjs            # 人类可读报告
 *   node admin/scripts/audit-live-collections.mjs --json     # 机器可读（stdout 仅 JSON）
 *   node admin/scripts/audit-live-collections.mjs --selftest # 用合成数据证明判定逻辑会失败
 *
 * 输出分区：
 *   A. 线上开放但仓库无规则      —— 未纳管，且线上是 `auth != null` / `read:true`（安全面）
 *   B. 仓库规则 ≠ 线上规则        —— 改了仓库但没部署，或线上被手工改过（漂移面）
 *   C. 有仓库规则但线上无该集合    —— 规则空转（治理面）
 *   D. 线上有集合但仓库无规则、代码也没引用 —— 历史残留（清理面）
 *   E. 线上 PRIVATE 但代码在读写   —— 功能直接不可用（功能面）
 */
'use strict'

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const ADMIN = resolve(ROOT, 'admin')
const RULES_DIR = resolve(ROOT, 'cloudbase', 'rules')
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'

const argv = process.argv.slice(2)
const jsonMode = argv.includes('--json')

// ─────────────────────────── 纯逻辑（可被 selftest 直接喂合成数据）───────────────────────────

/** 规则归一化：把两种仓库格式（read/write 或 read/create/update/delete）折成可比较的形状 */
export function normalizeRule(raw) {
  if (raw == null) return null
  let obj = raw
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) return null
    try { obj = JSON.parse(t) } catch { return { raw: t } }
  }
  if (typeof obj !== 'object') return { raw: String(obj) }
  const keys = Object.keys(obj).sort()
  // 旧格式（per-op）折成 write = create/update/delete 的合取描述，仅用于「是否与线上一致」的展示
  if (keys.some((k) => ['create', 'update', 'delete'].includes(k))) {
    const ops = {}
    for (const k of ['read', 'create', 'update', 'delete']) if (k in obj) ops[k] = obj[k]
    return ops
  }
  return obj
}

/** 线上权限是否等于仓库规则（JSON 语义比较，忽略键顺序与空白） */
export function sameRule(repoRule, liveRule) {
  const a = normalizeRule(repoRule)
  const b = normalizeRule(liveRule)
  if (a == null || b == null) return a === b
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false
  return ka.every((k) => String(a[k]) === String(b[k]))
}

/** 线上规则是否「对匿名/任意登录者开放」——安全面的判据 */
export function isOpenRule(liveRule) {
  const r = normalizeRule(liveRule)
  if (!r) return false
  const permissive = (v) => v === true || v === 'true' || v === 'auth != null' || v === 'auth!=null'
  if (r.read === true || r.write === true) return true
  if (permissive(r.read) || permissive(r.write)) return true
  // 旧格式：任一写操作开放
  return ['create', 'update', 'delete'].some((k) => permissive(r[k]))
}

/**
 * 规则「强度档」——用于判断「把仓库规则部署上去会变松还是变严」。
 * 0 = 谁都不行(false) < 1 = 归属人限定(表达式) < 2 = 任意登录者(auth != null) < 3 = 所有人(true)
 */
export function strengthClass(v) {
  if (v === false || v === 'false') return 0
  if (v === true || v === 'true') return 3
  const s = String(v ?? '')
  if (s === 'auth != null' || s === 'auth!=null') return 2
  if (!s) return -1 // 无此项
  return 1
}

/**
 * 仓库规则相对线上是更严还是更松。
 * 关键：**部署仓库规则不等于变安全**。实测 `deposit_intents` 仓库写的是
 * `doc._openid == auth.openid`，线上却是 `auth != null && doc._openid == auth.openid`
 * —— 少了一个 `auth != null` 合取项，直接部署会**放松**。
 */
export function compareStrength(repoRule, liveRule) {
  const a = normalizeRule(repoRule) || {}
  const b = normalizeRule(liveRule) || {}
  const dirs = new Set()
  for (const k of ['read', 'write', 'create', 'update', 'delete']) {
    if (!(k in a) && !(k in b)) continue
    const ca = strengthClass(a[k])
    const cb = strengthClass(b[k])
    if (ca === cb) {
      const hasAuth = (v) => /auth\s*!=\s*null/.test(String(v ?? ''))
      if (!hasAuth(a[k]) && hasAuth(b[k])) dirs.add('looser')
      else if (hasAuth(a[k]) && !hasAuth(b[k]) && ca === 1) dirs.add('stricter')
      continue
    }
    if (ca < cb) dirs.add('stricter')
    else dirs.add('looser')
  }
  if (dirs.has('looser') && dirs.has('stricter')) return 'mixed'
  if (dirs.has('looser')) return 'looser'
  if (dirs.has('stricter')) return 'stricter'
  return 'ambiguous'
}

/**
 * 三向分类。
 * @param {{repoRules: Record<string, any>, declared: string[], liveCollections: string[], livePerms: Record<string, {Permission: string, SecurityRule: string}>, codeRefs: Record<string, string[]>}} input
 */
export function classify({ repoRules, declared = [], liveCollections, livePerms, codeRefs }) {
  const repo = Object.keys(repoRules)
  const live = new Set(liveCollections)
  const refsOf = (n) => codeRefs[n] || { client: [], server: [] }
  const anyRef = (n) => totalRefs(refsOf(n)) > 0
  const clientRef = (n) => clientRefs(refsOf(n)).length > 0
  const permOf = (n) => livePerms[n] || { Permission: '(未知)', SecurityRule: '' }

  const A = [] // 线上开放但仓库无规则
  const B = [] // 仓库规则 ≠ 线上**自定义**规则（可比）
  const B2 = [] // 线上是预设权限（非 CUSTOM）→ 无法做字符串比较，需人工判断
  const C = [] // 有仓库规则但线上无集合
  const D = [] // 线上有、仓库无规则、代码也没引用
  const E = [] // 线上 PRIVATE 且**客户端**在读写在（云函数不受规则约束，不算问题）
  const F = [] // 代码引用 / COLLECTIONS 声明了，但线上根本没有这个集合

  for (const n of repo) {
    if (!live.has(n)) { C.push({ name: n, refs: refsOf(n) }); continue }
    const p = permOf(n)
    if (p.Permission === 'PRIVATE') {
      if (clientRef(n)) E.push({ name: n, refs: clientRefs(refsOf(n)) })
      continue
    }
    if (p.Permission !== 'CUSTOM') {
      // 预设权限的 SecurityRule 是空串，拿它跟仓库规则比会造出假阳性（实测 `curated_collections`
      // / `vip_levels` 的线上 Permission = READONLY，SecurityRule 为空，曾被误报为「漂移」）。
      B2.push({ name: n, preset: p.Permission, repo: normalizeRule(repoRules[n]), refs: refsOf(n) })
      continue
    }
    if (!sameRule(repoRules[n], p.SecurityRule)) {
      B.push({
        name: n,
        repo: normalizeRule(repoRules[n]),
        live: normalizeRule(p.SecurityRule),
        permission: p.Permission,
        direction: compareStrength(repoRules[n], p.SecurityRule),
        refs: refsOf(n),
      })
    }
  }
  for (const n of liveCollections) {
    if (repo.includes(n)) continue
    const p = permOf(n)
    if (p.Permission === 'PRIVATE') {
      if (clientRef(n)) E.push({ name: n, refs: clientRefs(refsOf(n)) })
      continue
    }
    const open = p.Permission === 'CUSTOM' ? isOpenRule(p.SecurityRule) : true // 预设一律按「对登录者开放」保守看待
    if (open) A.push({ name: n, live: p.Permission === 'CUSTOM' ? normalizeRule(p.SecurityRule) : p.Permission, permission: p.Permission, refs: refsOf(n) })
    else if (!anyRef(n)) D.push({ name: n, live: normalizeRule(p.SecurityRule), permission: p.Permission })
  }
  // F：代码引用或 COLLECTIONS 声明了，线上却没有这个集合。
  // 这类名字既不在 liveCollections 里，也不在 repoRules 里（或在 repoRules 里则由 C 覆盖），
  // 若不单独收集就会**从报告里彻底消失** —— 实测 `likes`/`vip_cards`/`equity_goods`/`feishu_shipments`
  // 就是这样被漏掉的（先只按 listCollections 迭代，看不见不存在的集合）。
  const declaredSet = new Set(declared)
  const names = new Set([...Object.keys(codeRefs), ...declared])
  for (const n of names) {
    if (live.has(n)) continue
    if (repo.includes(n)) continue // 已由 C 覆盖
    F.push({ name: n, refs: refsOf(n), declared: declaredSet.has(n) })
  }
  return { A, B, B2, C, D, E, F, repoCount: repo.length, liveCount: liveCollections.length }
}

// ─────────────────────────── 采集层 ───────────────────────────

function loadDotEnv() {
  const path = join(ADMIN, '.env')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}

function readRepoRules() {
  const out = {}
  for (const f of readdirSync(RULES_DIR)) {
    if (!f.endsWith('.json')) continue
    const name = f.replace(/\.json$/, '')
    if (name.startsWith('_template')) continue
    out[name] = JSON.parse(readFileSync(join(RULES_DIR, f), 'utf8'))
  }
  return out
}

/** 读 admin/src/cloud.js 的 COLLECTIONS 值——「声明了要用」的集合 */
function readDeclaredCollections() {
  const s = readFileSync(join(ADMIN, 'src', 'cloud.js'), 'utf8')
  const start = s.indexOf('export const COLLECTIONS = {')
  if (start < 0) return []
  const body = s.slice(start, s.indexOf('\n}', start))
  return [...body.matchAll(/^\s*[A-Z_0-9]+:\s*'([^']+)'/gm)].map((m) => m[1])
}

/**
 * 扫描代码里引用到的集合名。两层：
 *  1) 「参数就是集合名」的直接调用（`cdnAdd('x')` / `.collection('x')`）——精确；
 *  2) **已知集合名**（仓库规则 ∪ COLLECTIONS 声明 ∪ 线上集合）作为字符串字面量出现在任何位置
 *     —— 用来兜住间接用法，例如 `pullTable('shipment', COLLECTIONS.FEISHU_SHIPMENTS || 'feishu_shipments', …)`
 *     这种「集合名不是第一个参数」的写法（实测 `feishu_shipments` 就是这么漏掉的）。
 *     只匹配已知名字，因此不会把飞书表名之类的自由字符串当成集合名。
 */
const HELPERS = [
  'cdnAdd', 'cdnUpdate', 'cdnSet', 'cdnRemove', 'cdnDocGet', 'cdnCount', 'cdnQueryPage',
  'cdnUpsertSingleton', 'cdnUpsertDoc', 'cdnUpsertByWhere',
  'fetchCollectionSorted', 'fetchCollectionWhere', 'fetchCollectionLimit',
  'getCollectionData', 'countCollection',
]
const SCAN_DIRS = ['admin/src', 'miniprogram/cloudfunctions', 'miniprogram/utils', 'miniprogram/pages', 'miniprogram/components', 'miniprogram/services']

/**
 * 引用方是**客户端**还是**云函数**——这个区分决定了 PRIVATE 规则算不算问题。
 *
 * 微信云函数以管理端身份访问数据库，**不受安全规则约束**；浏览器 / 小程序页面才受。
 * 所以「线上 PRIVATE 但代码在用」只对客户端引用成立：实测若不区分，
 * `live_sessions`、`stored_value_*`、`platform_order_binds` 等 13 个纯云函数访问的集合
 * 会被全部误报为「功能不可用」。
 */
export function refParty(relPath) {
  if (relPath.startsWith('miniprogram/cloudfunctions/')) return 'server'
  return 'client'
}

function scanCodeRefs(vocabulary = []) {
  const refs = {}
  const helperRe = new RegExp(`\\b(?:${HELPERS.join('|')})\\(\\s*['"]([a-z][a-z0-9_]{2,})['"]`, 'g')
  const vocab = vocabulary.filter((v) => /^[a-z][a-z0-9_]{2,}$/.test(v))
  const vocabRe = vocab.length
    ? new RegExp(`['"](${vocab.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})['"]`, 'g')
    : null
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir) } catch { return }
    for (const e of entries) {
      if (e === 'node_modules' || e.startsWith('.')) continue
      const p = join(dir, e)
      const st = statSync(p)
      if (st.isDirectory()) { walk(p); continue }
      if (!['.js', '.cjs', '.mjs', '.vue'].includes(p.slice(p.lastIndexOf('.')))) continue
      if (st.size > 2_000_000) continue
      const txt = readFileSync(p, 'utf8')
      const rel = p.replace(ROOT + '/', '')
      const add = (n) => {
        if (!refs[n]) refs[n] = { client: [], server: [] }
        const bucket = refs[n][refParty(rel)]
        if (!bucket.includes(rel)) bucket.push(rel)
      }
      for (const m of txt.matchAll(helperRe)) add(m[1])
      for (const m of txt.matchAll(/\.collection\(\s*['"]([a-z][a-z0-9_]{2,})['"]/g)) add(m[1])
      if (vocabRe) for (const m of txt.matchAll(vocabRe)) add(m[1])
      // `getCollectionName()` 之类「函数返回集合名」的写法：抓 return 'x' 字面量
      for (const m of txt.matchAll(/return\s+['"]([a-z][a-z0-9_]{2,})['"]\s*\/\/\s*需在云开发创建/g)) add(m[1])
    }
  }
  for (const d of SCAN_DIRS) walk(join(ROOT, d))
  return refs
}

/** 引用总处数（客户端 + 云函数），用于展示 */
const totalRefs = (r) => (r ? r.client.length + r.server.length : 0)
const clientRefs = (r) => (r ? r.client : [])
const allRefs = (r) => (r ? [...r.client, ...r.server] : [])

async function fetchLive() {
  loadDotEnv()
  const secretId = process.env.TCB_SECRET_ID
  const secretKey = process.env.TCB_SECRET_KEY
  if (!secretId || !secretKey) {
    console.error('缺少 TCB_SECRET_ID / TCB_SECRET_KEY（应写在 admin/.env，勿提交）。')
    console.error('本脚本只读线上权限，不会做任何修改；没有凭据就无法核对。')
    process.exit(2)
  }
  const CloudBase = (await import('@cloudbase/manager-node')).default
  const app = CloudBase.init({ secretId, secretKey, envId: ENV_ID })
  const { database, permission } = app

  const collections = []
  for (let offset = 0; offset < 5000; offset += 100) {
    const r = await database.listCollections({ MgoLimit: 100, MgoOffset: offset })
    const arr = (r.Collections || r.Tables || []).map((c) => (typeof c === 'string' ? c : c.CollectionName))
    collections.push(...arr)
    if (arr.length < 100) break
  }

  const livePerms = {}
  for (let i = 0; i < collections.length; i += 100) {
    const batch = collections.slice(i, i + 100)
    const res = await permission.describeResourcePermission({ resourceType: 'collection', resources: batch })
    for (const item of res?.Data?.PermissionList || []) {
      livePerms[item.Resource] = { Permission: item.Permission, SecurityRule: item.SecurityRule || '' }
    }
  }
  return { collections, livePerms }
}

// ─────────────────────────── 呈现层 ───────────────────────────

const fmt = (r) => (r == null ? '(无)' : typeof r === 'string' ? r : JSON.stringify(r))

function report(out) {
  const line = (s = '') => console.log(s)
  const DIR = { stricter: '仓库更严→部署会收紧', looser: '⚠ 仓库更松→部署会放松', mixed: '⚠ 松紧混合', ambiguous: '无法判定' }
  line(`线上集合 ${out.liveCount} 个 · 仓库规则 ${out.repoCount} 份（已排除 _template*）`)
  line()
  line(`A. 线上对登录者开放但仓库无规则（安全面，${out.A.length}）`)
  out.A.forEach((x) => line(`   ${x.name.padEnd(26)} 线上 ${x.permission} ${fmt(x.live)}  引用 客户端 ${x.refs.client.length} / 云函数 ${x.refs.server.length}`))
  line()
  line(`B. 仓库规则 ≠ 线上自定义规则（漂移面，${out.B.length}）`)
  out.B.forEach((x) => line(
    `   ${x.name.padEnd(26)} [${DIR[x.direction] || x.direction}]\n` +
    `${' '.repeat(31)}仓库 ${fmt(x.repo)}\n` +
    `${' '.repeat(31)}线上 ${fmt(x.live)}`
  ))
  line()
  line(`B2. 线上是预设权限、非自定义规则（无法与仓库规则逐字比较，需人工判断，${out.B2.length}）`)
  out.B2.forEach((x) => line(`   ${x.name.padEnd(26)} 线上预设 ${x.preset.padEnd(10)} 仓库 ${fmt(x.repo)}  引用 客户端 ${x.refs.client.length} / 云函数 ${x.refs.server.length}`))
  line()
  line(`C. 有仓库规则但线上无该集合（规则空转，${out.C.length}）`)
  out.C.forEach((x) => line(`   ${x.name.padEnd(26)} 引用 客户端 ${x.refs.client.length} / 云函数 ${x.refs.server.length}${totalRefs(x.refs) ? ' ← 功能会直接失败' : ''}`))
  line()
  line(`D. 线上有集合、仓库无规则、代码也没引用（历史残留，${out.D.length}）`)
  out.D.forEach((x) => line(`   ${x.name.padEnd(26)} 线上 ${x.permission} ${fmt(x.live)}`))
  line()
  line(`E. 线上 PRIVATE 但代码在读写（功能不可用，${out.E.length}）`)
  out.E.forEach((x) => line(`   ${x.name.padEnd(26)} ← ${x.refs.slice(0, 2).join(', ')}`))
  line()
  line(`F. 代码引用 / COLLECTIONS 声明了，但线上没有这个集合（${out.F.length}）`)
  out.F.slice().sort((a, b) => totalRefs(b.refs) - totalRefs(a.refs)).forEach((x) => {
    const tag = totalRefs(x.refs)
      ? `引用 客户端 ${x.refs.client.length} / 云函数 ${x.refs.server.length} ← 功能会失败`
      : (x.declared ? '仅 COLLECTIONS 声明（死声明）' : '')
    line(`   ${x.name.padEnd(26)} ${tag}`)
    const files = allRefs(x.refs)
    if (files.length) line(`${' '.repeat(31)}${files.slice(0, 3).join(', ')}`)
  })
}

// ─────────────────────────── 自检 ───────────────────────────

if (argv.includes('--selftest')) {
  console.log('自检：用合成数据验证各分区都真的会命中（不联网）\n')
  const fixture = {
    repoRules: {
      ok_same: { read: 'auth != null', write: false },
      drifted: { read: false, write: false },
      ghost: { read: true, write: false },
      priv_used: { read: 'auth != null', write: false },
      legacy: { read: true, create: 'auth != null', update: 'auth != null', delete: false },
      preset_readonly: { read: true, write: false },
      weaker_than_live: { read: 'doc._openid == auth.openid', write: false },
      priv_server_only: { read: 'auth != null', write: false },
    },
    declared: ['declared_only_missing', 'open_unmanaged'],
    liveCollections: ['ok_same', 'drifted', 'priv_used', 'legacy', 'open_unmanaged', 'quiet_unmanaged', 'preset_readonly', 'weaker_than_live', 'priv_server_only'],
    livePerms: {
      ok_same: { Permission: 'CUSTOM', SecurityRule: '{"read":"auth != null","write":false}' },
      drifted: { Permission: 'CUSTOM', SecurityRule: '{"read":"auth != null","write":"auth != null"}' },
      priv_used: { Permission: 'PRIVATE', SecurityRule: '' },
      legacy: { Permission: 'CUSTOM', SecurityRule: '{"read":true,"create":"auth != null","update":"auth != null","delete":false}' },
      open_unmanaged: { Permission: 'CUSTOM', SecurityRule: '{"read":"auth != null","write":"auth != null"}' },
      quiet_unmanaged: { Permission: 'CUSTOM', SecurityRule: '{"read":false,"write":false}' },
      preset_readonly: { Permission: 'READONLY', SecurityRule: '' },
      weaker_than_live: { Permission: 'CUSTOM', SecurityRule: '{"read":"auth != null && doc._openid == auth.openid","write":false}' },
      priv_server_only: { Permission: 'PRIVATE', SecurityRule: '' },
    },
    codeRefs: {
      priv_used: { client: ['admin/src/a.vue'], server: [] },
      open_unmanaged: { client: ['admin/src/b.vue'], server: [] },
      used_but_missing: { client: [], server: ['miniprogram/cloudfunctions/fn/index.js'] },
      declared_only_missing: { client: [], server: [] },
      priv_server_only: { client: [], server: ['miniprogram/cloudfunctions/g/index.js'] },
    },
  }
  const out = classify(fixture)
  const expect = [
    ['A 检出「线上开放但仓库无规则」', out.A.length === 1 && out.A[0].name === 'open_unmanaged', JSON.stringify(out.A.map((x) => x.name))],
    ['B 检出「仓库≠线上」漂移', out.B.length === 2 && out.B.some((x) => x.name === 'drifted'), JSON.stringify(out.B.map((x) => x.name))],
    ['B 判定方向：线上 write=auth != null → 仓库更严（部署会收紧）', out.B.find((x) => x.name === 'drifted')?.direction === 'stricter', String(out.B.find((x) => x.name === 'drifted')?.direction)],
    ['B 判定方向：仓库少了 auth != null 合取项 → 仓库更松（部署会放松）', out.B.find((x) => x.name === 'weaker_than_live')?.direction === 'looser', String(out.B.find((x) => x.name === 'weaker_than_live')?.direction)],
    ['B2 预设权限（READONLY）单独成桶，不进 B', out.B2.length === 1 && out.B2[0].name === 'preset_readonly' && !out.B.some((x) => x.name === 'preset_readonly'), JSON.stringify(out.B2.map((x) => `${x.name}:${x.preset}`))],
    ['C 检出「规则空转」', out.C.length === 1 && out.C[0].name === 'ghost', JSON.stringify(out.C.map((x) => x.name))],
    ['D 检出「历史残留」', out.D.length === 1 && out.D[0].name === 'quiet_unmanaged', JSON.stringify(out.D.map((x) => x.name))],
    ['E 检出「PRIVATE 但代码在用」', out.E.length === 1 && out.E[0].name === 'priv_used', JSON.stringify(out.E.map((x) => x.name))],
    ['旧格式规则（create/update/delete）判为与线上一致', !out.B.some((x) => x.name === 'legacy') && !out.B2.some((x) => x.name === 'legacy'), JSON.stringify(out.B.map((x) => x.name))],
    ['完全一致的规则不进任何分区', ![out.A, out.B, out.B2, out.C, out.D, out.E].flat().some((x) => x?.name === 'ok_same'), 'ok_same 误报'],
    ['PRIVATE 且代码未引用 → 不进 E', !out.E.some((x) => x.name === 'quiet_unmanaged'), ''],
    ['F 检出「云函数引用但线上不存在」', out.F.some((x) => x.name === 'used_but_missing' && x.refs.server.length === 1), JSON.stringify(out.F.map((x) => x.name))],
    ['F 检出「仅 COLLECTIONS 声明的死声明」', out.F.some((x) => x.name === 'declared_only_missing' && x.declared && totalRefs(x.refs) === 0), JSON.stringify(out.F.map((x) => x.name))],
    ['E 只认客户端引用：纯云函数访问的 PRIVATE 集合不误报', !out.E.some((x) => x.name === 'priv_server_only'), JSON.stringify(out.E.map((x) => x.name))],
    ['F 不收录线上确实存在的集合', !out.F.some((x) => x.name === 'open_unmanaged'), JSON.stringify(out.F.map((x) => x.name))],
  ]
  let bad = 0
  for (const [label, ok, detail] of expect) {
    console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${detail}`}`)
    if (!ok) bad += 1
  }
  console.log()
  if (bad) {
    console.error(`自检失败：${bad} 项判定不符，分类逻辑不可信。`)
    process.exit(1)
  }
  console.log('自检通过：各分区都能命中，方向判定正确，预设权限不再被误报为漂移。\n')
  process.exit(0)
}

const repoRules = readRepoRules()
const declared = readDeclaredCollections()
const { collections, livePerms } = await fetchLive()
// 词汇表必须在扫代码之前确定：规则名 ∪ COLLECTIONS 声明 ∪ 线上集合
const vocabulary = [...new Set([...Object.keys(repoRules), ...declared, ...collections])]
const codeRefs = scanCodeRefs(vocabulary)
const out = classify({ repoRules, declared, liveCollections: collections, livePerms, codeRefs })

if (jsonMode) {
  console.log(JSON.stringify({ envId: ENV_ID, ...out }, null, 2))
} else {
  report(out)
  console.log()
  console.log(`小结：A 线上开放但无规则 ${out.A.length}；B 自定义规则漂移 ${out.B.length}；B2 预设权限待判断 ${out.B2.length}；C 规则空转 ${out.C.length}；D 历史残留 ${out.D.length}；E PRIVATE 但在用 ${out.E.length}；F 引用了但线上不存在 ${out.F.length}。`)
  const broken = out.F.filter((x) => totalRefs(x.refs) > 0).map((x) => x.name)
  if (broken.length) console.log(`其中 F 里「代码在引用」的 ${broken.length} 个（${broken.join('、')}）意味着对应功能现在就在失败。`)
}
