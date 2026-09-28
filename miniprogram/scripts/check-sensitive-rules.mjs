#!/usr/bin/env node
/**
 * check:sensitive-rules —— 敏感集合安全规则棘轮（订单隐私收紧 2026-09-28）
 *
 * 清单：cloudbase/sensitive-collections.json
 *   1. 每个敏感集合：cloudbase/rules 与 miniprogram/database-rules 两份规则逐字段一致
 *   2. read 不得匿名可读（true / auth != null / auth.openid != null 等），pendingR1 内的除外
 *   3. pendingR1 只许变小：长度必须等于 pendingR1Max；已收紧的集合仍挂在 pendingR1 → 拦下（逼清理）
 *   4. pendingR1 每项在 cloudbase/rules-staged/r1-after-erp-release/ 有待应用规则：
 *      read 非匿名、其余字段与现行规则完全一致（只收紧读，不顺手改写权限）
 *   5. ERP 只读网关清单（admin cloudbaseCdnDb.js PROXY_READ_COLLECTIONS）≡ 敏感集合清单
 *      —— 收紧了 ERP 读不到的表 / ERP 走网关读了不在清单的表，都算漂移
 *
 * --selftest：内存注入（不写盘），每个注入都必须被检出。
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LIST_PATH = 'cloudbase/sensitive-collections.json'
const RULE_DIRS = ['cloudbase/rules', 'miniprogram/database-rules']
const STAGED_DIR = 'cloudbase/rules-staged/r1-after-erp-release'
const CLIENT_PATH = 'admin/src/utils/cloudbaseCdnDb.js'

/**
 * read 是否挡住 Web 匿名（N0 实测口径）：
 *   false；含 `auth.openid != ''`；含 `auth.loginType != 'ANONYMOUS'`；
 *   或仅按 `doc._openid == auth.openid` 限本人（不含 ||，避免与宽条件并列放行）。
 * `auth.openid != null` 单独出现**不算**（匿名 openid 为空串，N0 实测放行）。
 */
export function readBlocksAnonymous(read) {
  if (read === false) return true
  if (typeof read !== 'string') return false
  if (/auth\.openid\s*!=\s*''/.test(read)) return true
  if (/auth\.loginType\s*!=\s*'ANONYMOUS'/.test(read)) return true
  if (/doc\._openid\s*==\s*auth\.openid/.test(read) && !/\|\|/.test(read)) return true
  return false
}

function sortKeys(o) {
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]))
}

function parseJson(files, path, errors) {
  if (!Object.prototype.hasOwnProperty.call(files, path)) {
    errors.push(`缺少文件：${path}`)
    return null
  }
  try {
    return JSON.parse(files[path])
  } catch (e) {
    errors.push(`${path} 不是合法 JSON：${e.message}`)
    return null
  }
}

export function checkSensitiveRules(files) {
  const errors = []
  const list = parseJson(files, LIST_PATH, errors)
  if (!list) return errors
  const collections = list.collections || []
  const pending = list.pendingR1 || []
  const pendingSet = new Set(pending)

  if (pending.length > (list.pendingR1Max ?? 0)) {
    errors.push(`pendingR1 只许变小：当前 ${pending.length} 项 > 上限 pendingR1Max=${list.pendingR1Max}（不得新增匿名可读的敏感集合）`)
  } else if (pending.length < list.pendingR1Max) {
    errors.push(`pendingR1 已缩到 ${pending.length} 项：请把 pendingR1Max 同步调到 ${pending.length}（棘轮基线 = 实数）`)
  }
  pending.forEach((c) => {
    if (!collections.includes(c)) errors.push(`pendingR1 含非敏感集合：${c}`)
  })

  for (const c of collections) {
    const primary = parseJson(files, `${RULE_DIRS[0]}/${c}.json`, errors)
    if (!primary) continue
    const mirrorPath = `${RULE_DIRS[1]}/${c}.json`
    const rules = [primary]
    if (Object.prototype.hasOwnProperty.call(files, mirrorPath)) {
      const mirror = parseJson(files, mirrorPath, errors)
      if (!mirror) continue
      rules.push(mirror)
      if (JSON.stringify(sortKeys(primary)) !== JSON.stringify(sortKeys(mirror))) {
        errors.push(`${c}：两份规则不一致（cloudbase/rules ↔ miniprogram/database-rules）`)
      }
    }
    const safe = readBlocksAnonymous(rules[0].read)
    if (!safe && !pendingSet.has(c)) {
      errors.push(`${c}：read=${JSON.stringify(rules[0].read)} 对 Web 匿名可读（匿名登录对公网开放 = 任何人可读）`)
    }
    if (safe && pendingSet.has(c)) {
      errors.push(`${c}：规则已收紧，请从 pendingR1 移除并调小 pendingR1Max`)
    }
    if (pendingSet.has(c)) {
      const staged = parseJson(files, `${STAGED_DIR}/${c}.json`, errors)
      if (!staged) continue
      if (!readBlocksAnonymous(staged.read)) errors.push(`${c}：待应用规则 read 仍对匿名可读`)
      const rest = (r) => JSON.stringify(sortKeys(Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'read'))))
      const LIVE_DRIFT_WRITE = list.stagedWriteKeepsLive || {}
      const expectedRest = LIVE_DRIFT_WRITE[c]
        ? rest({ ...rules[0], write: LIVE_DRIFT_WRITE[c] })
        : rest(rules[0])
      if (rest(staged) !== expectedRest) {
        errors.push(`${c}：待应用规则除 read 外与现行规则不一致（只收紧读，写权限另案处理）`)
      }
    }
  }

  const client = files[CLIENT_PATH] || ''
  const m = client.match(/PROXY_READ_COLLECTIONS = new Set\(\[([\s\S]*?)\]\)/)
  if (!m) {
    errors.push(`${CLIENT_PATH}：找不到 PROXY_READ_COLLECTIONS`)
  } else {
    const proxied = new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]))
    const missing = collections.filter((c) => !proxied.has(c))
    const extra = [...proxied].filter((c) => !collections.includes(c))
    if (missing.length) errors.push(`ERP 只读网关未覆盖敏感集合（收紧后 ERP 读不到）：${missing.join(', ')}`)
    if (extra.length) errors.push(`ERP 只读网关含未登记为敏感的集合：${extra.join(', ')}`)
  }
  return errors
}

function loadFiles() {
  const files = {}
  const add = (p) => {
    const abs = resolve(ROOT, p)
    if (existsSync(abs)) files[p] = readFileSync(abs, 'utf8')
  }
  add(LIST_PATH)
  add(CLIENT_PATH)
  const list = JSON.parse(files[LIST_PATH])
  for (const c of list.collections) {
    RULE_DIRS.forEach((d) => add(`${d}/${c}.json`))
    add(`${STAGED_DIR}/${c}.json`)
  }
  return files
}

function main() {
  const files = loadFiles()
  if (process.argv.includes('--selftest')) {
    const list = JSON.parse(files[LIST_PATH])
    const applied = list.collections.find((c) => !list.pendingR1.includes(c))
    const pend = list.pendingR1[0]
    const setRule = (dir, c, patch) => (f) => {
      const p = `${dir}/${c}.json`
      return { ...f, [p]: JSON.stringify({ ...JSON.parse(f[p]), ...patch }) }
    }
    const both = (c, patch) => (f) => setRule(RULE_DIRS[1], c, patch)(setRule(RULE_DIRS[0], c, patch)(f))
    const editList = (fn) => (f) => ({ ...f, [LIST_PATH]: JSON.stringify(fn(JSON.parse(f[LIST_PATH]))) })
    const cases = [
      ['已收紧集合回退为 auth != null', both(applied, { read: 'auth != null' })],
      ['用 auth.openid != null（匿名空串放行）冒充收紧', both(applied, { read: 'auth.openid != null' })],
      ['只改了一份规则', setRule(RULE_DIRS[0], applied, { read: true })],
      ['pendingR1 新增一项', editList((l) => ({ ...l, pendingR1: [...l.pendingR1, applied] }))],
      ['pendingR1 已应用却未移除', both(pend, { read: list.r1Rule })],
      ['待应用规则顺手改了写权限', setRule(STAGED_DIR, pend, { write: 'auth != null && auth.openid != null', create: undefined })],
      ['待应用规则 read 仍匿名可读', setRule(STAGED_DIR, pend, { read: 'auth != null' })],
      ['ERP 网关漏一张表', (f) => ({ ...f, [CLIENT_PATH]: f[CLIENT_PATH].replace("  'finance_records',\n", '') })],
      ['敏感清单删掉 orders', editList((l) => ({ ...l, collections: l.collections.filter((c) => c !== 'orders'), pendingR1: l.pendingR1.filter((c) => c !== 'orders'), pendingR1Max: l.pendingR1Max - 1 }))],
    ]
    const base = checkSensitiveRules(files)
    if (base.length) {
      console.error('✗ 自检前提失败：当前源码本身不通过')
      base.forEach((e) => console.error('  - ' + e))
      process.exit(1)
    }
    let ok = true
    for (const [name, inj] of cases) {
      const mutated = inj(files)
      const changed = Object.keys(mutated).some((k) => mutated[k] !== files[k])
      const caught = changed && checkSensitiveRules(mutated).length > 0
      console.log(`${caught ? '✓' : '✗'} 自检注入「${name}」${caught ? '已检出' : changed ? '未检出' : '未命中源码'}`)
      if (!caught) ok = false
    }
    process.exit(ok ? 0 : 1)
  }
  const errors = checkSensitiveRules(files)
  if (errors.length) {
    console.error(`✗ check:sensitive-rules：${errors.length} 项`)
    errors.forEach((e) => console.error('  - ' + e))
    process.exit(1)
  }
  const list = JSON.parse(files[LIST_PATH])
  console.log(`✓ check:sensitive-rules：${list.collections.length} 个敏感集合规则两份一致；已收紧 ${list.collections.length - list.pendingR1.length} 个，待 ERP 上线后收紧 ${list.pendingR1.length} 个（只许变小）`)
}

main()
