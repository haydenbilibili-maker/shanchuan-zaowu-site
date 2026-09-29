#!/usr/bin/env node
/**
 * check:sensitive-rules —— 敏感集合安全规则棘轮（订单隐私收紧 2026-09-28）
 *
 * 清单：cloudbase/sensitive-collections.json
 *   1. 每个敏感集合：cloudbase/rules 与 miniprogram/database-rules 两份规则逐字段一致
 *   2. read 不得匿名可读（true / auth != null / auth.openid != null 等），pendingR1 内的除外
 *   3. pendingR1 只许变小：长度必须等于 pendingR1Max；已收紧的集合仍挂在 pendingR1 → 拦下（逼清理）
 *   4. pendingR1 ∪ pendingWrite 每项在 cloudbase/rules-staged/after-erp-release/ 有待应用（目标）规则：
 *      pendingR1 的 read 非匿名，否则 read 与现行一致；pendingWrite 的写字段非匿名（writeExceptions 除外），
 *      否则写字段与现行一致 —— 不在待办里的维度不许顺手改；staged 目录不许有待办外的表
 *   5. ERP 只读网关清单（admin cloudbaseCdnDb.js PROXY_READ_COLLECTIONS）≡ 敏感集合清单
 *      —— 收紧了 ERP 读不到的表 / ERP 走网关读了不在清单的表，都算漂移
 *   6. 写不回退：写保护集合（collections ∪ writeProtectedExtra）的写字段不得匿名放行，
 *      pendingWrite / writeExceptions 除外；pendingWrite 只许变小（= pendingWriteMax），
 *      仓库已收紧且不在 liveWriteDrift 的仍挂 pendingWrite → 拦下；liveWriteDrift ⊆ pendingWrite
 *   7. ERP 写网关清单（PROXY_WRITE_COLLECTIONS）≡ secureDataWrite/policy.js WRITE_POLICY，
 *      且不含 writeGatewayForbidden（admin_users/admin_roles 等提权表）；products 须有 allowFields 且不含改价/上下架/入档字段
 *   8. probeControls.writable 不得指向已收紧写的表（探针对照组失效）
 *   9. serverOnly（仅云函数可读写，如含用户照片的 ai_identify_logs）：read 与全部写字段必须 false，
 *      不得列入 collections、不得进 ERP 只读 / 写网关
 *
 * --selftest：内存注入（不写盘），每个注入都必须被检出。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LIST_PATH = 'cloudbase/sensitive-collections.json'
const RULE_DIRS = ['cloudbase/rules', 'miniprogram/database-rules']
const STAGED_DIR = 'cloudbase/rules-staged/after-erp-release'
const CLIENT_PATH = 'admin/src/utils/cloudbaseCdnDb.js'
const WRITE_POLICY_PATH = 'miniprogram/cloudfunctions/secureDataWrite/policy.js'
const WRITE_KEYS = ['write', 'create', 'update', 'delete']
const PRODUCT_GATED_FIELDS = ['price', 'originalPrice', 'isOffShelf', 'onShelf', 'status', 'inArchive', 'seckill', 'groupBuying', 'storeId', 'storeIds', 'visibility']

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

  const writeExtra = list.writeProtectedExtra || []
  const writeProtected = [...new Set([...collections, ...writeExtra])]
  const pendingW = list.pendingWrite || []
  const pendingWSet = new Set(pendingW)
  const drift = list.liveWriteDrift || {}
  const exceptions = list.writeExceptions || {}

  if (pendingW.length > (list.pendingWriteMax ?? 0)) {
    errors.push(`pendingWrite 只许变小：当前 ${pendingW.length} 项 > 上限 pendingWriteMax=${list.pendingWriteMax}（不得新增匿名可写的敏感集合）`)
  } else if (pendingW.length < list.pendingWriteMax) {
    errors.push(`pendingWrite 已缩到 ${pendingW.length} 项：请把 pendingWriteMax 同步调到 ${pendingW.length}（棘轮基线 = 实数）`)
  }
  pendingW.forEach((c) => {
    if (!writeProtected.includes(c)) errors.push(`pendingWrite 含非写保护集合：${c}`)
  })
  Object.keys(drift).forEach((c) => {
    if (!pendingWSet.has(c)) errors.push(`liveWriteDrift.${c}：线上写漂移的表必须留在 pendingWrite（应用 staged 后两处一起删）`)
  })
  const probeW = list.probeControls?.writable
  if (probeW && writeProtected.includes(probeW) && !pendingWSet.has(probeW)) {
    errors.push(`probeControls.writable=${probeW} 已收紧写，探针对照组失效：换成仍匿名可写的表或置 null`)
  }

  const pickWrite = (r) => Object.fromEntries(WRITE_KEYS.filter((k) => k in r).map((k) => [k, r[k]]))
  const anonWriteKeys = (c, r) =>
    WRITE_KEYS.filter((k) => k in r && !readBlocksAnonymous(r[k]) && exceptions[c]?.[k] !== r[k])

  for (const c of writeProtected) {
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
    const isSensitive = collections.includes(c)
    const safe = readBlocksAnonymous(rules[0].read)
    if (isSensitive && !safe && !pendingSet.has(c)) {
      errors.push(`${c}：read=${JSON.stringify(rules[0].read)} 对 Web 匿名可读（匿名登录对公网开放 = 任何人可读）`)
    }
    if (safe && pendingSet.has(c)) {
      errors.push(`${c}：规则已收紧，请从 pendingR1 移除并调小 pendingR1Max`)
    }
    const openW = anonWriteKeys(c, rules[0])
    if (openW.length && !pendingWSet.has(c)) {
      errors.push(`${c}：${openW.map((k) => `${k}=${JSON.stringify(rules[0][k])}`).join('、')} 对 Web 匿名可写（写规则不许回退）`)
    }
    if (!openW.length && pendingWSet.has(c) && !(c in drift)) {
      errors.push(`${c}：写规则已收紧，请从 pendingWrite 移除并调小 pendingWriteMax`)
    }
    if (!pendingSet.has(c) && !pendingWSet.has(c)) continue
    const staged = parseJson(files, `${STAGED_DIR}/${c}.json`, errors)
    if (!staged) continue
    if (pendingSet.has(c)) {
      if (!readBlocksAnonymous(staged.read)) errors.push(`${c}：待应用规则 read 仍对匿名可读`)
    } else if (JSON.stringify(staged.read) !== JSON.stringify(rules[0].read)) {
      errors.push(`${c}：不在 pendingR1，待应用规则不许改 read`)
    }
    if (pendingWSet.has(c)) {
      const stillOpen = anonWriteKeys(c, staged)
      if (stillOpen.length) errors.push(`${c}：待应用规则 ${stillOpen.join('、')} 仍对匿名可写`)
      if (!WRITE_KEYS.some((k) => k in staged)) errors.push(`${c}：待应用规则缺写字段（缺省语义不明，须显式写出）`)
    } else if (JSON.stringify(sortKeys(pickWrite(staged))) !== JSON.stringify(sortKeys(pickWrite(rules[0])))) {
      errors.push(`${c}：不在 pendingWrite，待应用规则不许改写权限`)
    }
    const extraKeys = Object.keys(staged).filter((k) => k !== 'read' && !WRITE_KEYS.includes(k))
    if (extraKeys.length) errors.push(`${c}：待应用规则含未知字段 ${extraKeys.join(', ')}`)
  }
  const stagedFiles = Object.keys(files).filter((p) => p.startsWith(`${STAGED_DIR}/`))
  stagedFiles.forEach((p) => {
    const c = p.slice(STAGED_DIR.length + 1).replace(/\.json$/, '')
    if (!pendingSet.has(c) && !pendingWSet.has(c)) {
      errors.push(`${p}：不在 pendingR1 / pendingWrite 的待应用规则（已应用请删掉，避免下次误覆盖）`)
    }
  })

  const client = files[CLIENT_PATH] || ''
  const wm = client.match(/PROXY_WRITE_COLLECTIONS = new Set\(\[([\s\S]*?)\]\)/)
  const policySrc = files[WRITE_POLICY_PATH] || ''
  const pm = policySrc.match(/const WRITE_POLICY = \{([\s\S]*?)\n\}/)
  if (!wm) errors.push(`${CLIENT_PATH}：找不到 PROXY_WRITE_COLLECTIONS`)
  if (!pm) errors.push(`${WRITE_POLICY_PATH}：找不到 WRITE_POLICY`)
  if (wm && pm) {
    const erpW = new Set([...wm[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]))
    const fnW = new Set([...pm[1].matchAll(/^ {2}([a-z_]+):/gm)].map((x) => x[1]))
    const onlyErp = [...erpW].filter((c) => !fnW.has(c))
    const onlyFn = [...fnW].filter((c) => !erpW.has(c))
    if (onlyErp.length) errors.push(`ERP 写网关清单有、云函数 WRITE_POLICY 没有（ERP 写入会被拒）：${onlyErp.join(', ')}`)
    if (onlyFn.length) errors.push(`云函数 WRITE_POLICY 有、ERP 写网关清单没有（ERP 仍直写）：${onlyFn.join(', ')}`)
    const forbidden = (list.writeGatewayForbidden || []).filter((c) => fnW.has(c) || erpW.has(c))
    if (forbidden.length) errors.push(`写网关开放了禁写集合（提权 / 审计链路）：${forbidden.join(', ')}`)
    const prodLine = (pm[1].match(/^ {2}products:.*$/m) || [''])[0]
    if (prodLine) {
      const fields = [...((prodLine.match(/allowFields:\s*\[([^\]]*)\]/) || [])[1] || '').matchAll(/'([A-Za-z_]+)'/g)].map((x) => x[1])
      const bad = fields.filter((f) => PRODUCT_GATED_FIELDS.includes(f))
      if (!fields.length) errors.push('WRITE_POLICY.products 缺 allowFields（改价 / 上下架须走 manageProducts / manageApprovals）')
      if (bad.length) errors.push(`WRITE_POLICY.products 放开了须审批的字段：${bad.join(', ')}`)
    }
  }
  const serverOnly = list.serverOnly || []
  const erpWSet = wm ? new Set([...wm[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])) : new Set()
  for (const c of serverOnly) {
    const rule = parseJson(files, `${RULE_DIRS[0]}/${c}.json`, errors)
    if (!rule) continue
    if (rule.read !== false) errors.push(`${c}（serverOnly）：read 必须为 false，当前 ${JSON.stringify(rule.read)}`)
    const openKeys = WRITE_KEYS.filter((k) => k in rule && rule[k] !== false)
    if (!('write' in rule) && !openKeys.length) errors.push(`${c}（serverOnly）：缺 write:false（缺省语义不明，须显式写出）`)
    if (openKeys.length) errors.push(`${c}（serverOnly）：${openKeys.map((k) => `${k}=${JSON.stringify(rule[k])}`).join('、')} 必须为 false`)
    if (collections.includes(c)) errors.push(`${c}（serverOnly）：不得同时列在 collections（那是 ERP 经网关可读的清单）`)
    if (erpWSet.has(c)) errors.push(`${c}（serverOnly）：不得进 ERP 写网关`)
  }
  const m = client.match(/PROXY_READ_COLLECTIONS = new Set\(\[([\s\S]*?)\]\)/)
  if (m) {
    const proxiedR = new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]))
    serverOnly.filter((c) => proxiedR.has(c)).forEach((c) => errors.push(`${c}（serverOnly）：不得进 ERP 只读网关`))
  }
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
  add(WRITE_POLICY_PATH)
  const list = JSON.parse(files[LIST_PATH])
  for (const c of new Set([...list.collections, ...(list.writeProtectedExtra || []), ...(list.serverOnly || [])])) {
    RULE_DIRS.forEach((d) => add(`${d}/${c}.json`))
  }
  const stagedAbs = resolve(ROOT, STAGED_DIR)
  if (existsSync(stagedAbs)) {
    readdirSync(stagedAbs).filter((n) => n.endsWith('.json')).forEach((n) => add(`${STAGED_DIR}/${n}`))
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
      ['已收紧写回退为 auth != null', both('orders', { write: 'auth != null' })],
      ['写用 auth.openid != null 冒充收紧', both('orders', { write: 'auth.openid != null' })],
      ['admin_users 写回退（提权表）', setRule(RULE_DIRS[0], 'admin_users', { write: 'auth != null' })],
      ['配置表写回退（writeProtectedExtra）', (f) => {
        const g = both('stores', { write: 'auth != null' })(editList((l) => ({ ...l, pendingWrite: l.pendingWrite.filter((c) => c !== 'stores'), pendingWriteMax: l.pendingWriteMax - 1, liveWriteDrift: { ...l.liveWriteDrift, stores: undefined } }))(f))
        delete g[`${STAGED_DIR}/stores.json`]
        return g
      }],
      ['pendingWrite 新增一项', editList((l) => ({ ...l, pendingWrite: [...l.pendingWrite, 'admin_users'] }))],
      ['pendingWrite 已收紧却未移除', setRule(RULE_DIRS[0], 'finance_settings', { write: false })],
      ['liveWriteDrift 表离开 pendingWrite', editList((l) => ({ ...l, pendingWrite: l.pendingWrite.filter((c) => c !== 'refunds'), pendingWriteMax: l.pendingWriteMax - 1 }))],
      ['待应用规则写仍匿名可写', setRule(STAGED_DIR, 'refunds', { write: 'auth != null' })],
      ['待应用 purchase_intents 放开 update', setRule(STAGED_DIR, 'purchase_intents', { update: 'auth != null' })],
      ['待应用规则顺手改非 R1 表的 read', setRule(STAGED_DIR, 'stores', { read: true })],
      ['staged 目录多出待办外的表', (f) => ({ ...f, [`${STAGED_DIR}/daily_revenues.json`]: f[`${RULE_DIRS[0]}/daily_revenues.json`] })],
      ['ERP 写网关漏一张表', (f) => ({ ...f, [CLIENT_PATH]: f[CLIENT_PATH].replace(/PROXY_WRITE_COLLECTIONS = new Set\(\[([\s\S]*?)  'stock_movements',\n/, 'PROXY_WRITE_COLLECTIONS = new Set([$1') })],
      ['写网关开放 admin_users', (f) => ({
        ...f,
        [WRITE_POLICY_PATH]: f[WRITE_POLICY_PATH].replace('const WRITE_POLICY = {\n', "const WRITE_POLICY = {\n  admin_users: { ops: ['update'] },\n"),
        [CLIENT_PATH]: f[CLIENT_PATH].replace('PROXY_WRITE_COLLECTIONS = new Set([\n', "PROXY_WRITE_COLLECTIONS = new Set([\n  'admin_users',\n"),
      })],
      ['探针可写对照组指向已收紧表', editList((l) => ({ ...l, probeControls: { ...l.probeControls, writable: 'notification_templates' } }))],
      ['写网关 products 放开 price', (f) => ({ ...f, [WRITE_POLICY_PATH]: f[WRITE_POLICY_PATH].replace("allowFields: ['stock',", "allowFields: ['price', 'stock',") })],
      ['写网关 products 去掉字段白名单', (f) => ({ ...f, [WRITE_POLICY_PATH]: f[WRITE_POLICY_PATH].replace(/(\n {2}products: \{ ops: \['update'\]), allowFields: \[[^\]]*\]/, '$1') })],
      ['serverOnly 集合放开客户端读（本人可读）', setRule(RULE_DIRS[0], 'ai_identify_logs', { read: 'doc.openid == auth.openid' })],
      ['serverOnly 集合放开 create', setRule(RULE_DIRS[0], 'ai_identify_logs', { create: 'auth != null' })],
      ['serverOnly 集合进 ERP 只读网关', (f) => ({ ...f, [CLIENT_PATH]: f[CLIENT_PATH].replace('PROXY_READ_COLLECTIONS = new Set([\n', "PROXY_READ_COLLECTIONS = new Set([\n  'ai_identify_logs',\n") })],
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
  console.log(`✓ check:sensitive-rules：${list.collections.length} 个敏感集合规则两份一致；读已收紧 ${list.collections.length - list.pendingR1.length} 个、待 ERP 上线后收紧读 ${list.pendingR1.length} 个；写保护 ${new Set([...list.collections, ...(list.writeProtectedExtra || [])]).size} 个、待收紧写 ${list.pendingWrite.length} 个（均只许变小）；仅云函数读写 ${(list.serverOnly || []).length} 个`)
}

main()
