#!/usr/bin/env node
/**
 * 幂等创建 deposit_rules 集合 + ACL（PRIVATE）+ 可选写入 key=default 默认规则
 *
 * 权限：PRIVATE — 客户端不可读不可写；仅云函数（manageDeposit / createDepositIntent）可读写
 * 对齐：member_birthday_gift / store_receipt_claims 等配置类集合
 *
 * 环境：cloud1-8gnkty5bfff9f0bf
 * 密钥：shanchuanzaowu/admin/.env 的 TCB_SECRET_*
 *
 * 用法：node scripts/provision-deposit-rules.cjs
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const COLLECTION = 'deposit_rules'
const ADMIN_ENV = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/admin/.env'
const MANAGER_NODE = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/node_modules/@cloudbase/manager-node'
const {
  RULE_KEY,
  DEFAULT_RULES,
  normalizeRules,
  describeRules
} = require('../cloudfunctions/manageDeposit/depositDefaults')

/** 与 member_birthday_gift 对齐：仅云函数可读写 */
const ACL_PERMISSION = 'PRIVATE'

const INDEXES = [
  {
    Name: 'key_1',
    Keys: [{ Name: 'key', Direction: '1' }],
    Unique: true
  }
]

function loadDotEnv() {
  if (!fs.existsSync(ADMIN_ENV)) throw new Error('缺少 ' + ADMIN_ENV)
  for (const line of fs.readFileSync(ADMIN_ENV, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i <= 0) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (!process.env[k]) process.env[k] = v
  }
}

function row(name, op, result, note) {
  return { name, op, result, note }
}

function parseTcbJson(raw) {
  const i = raw.indexOf('{')
  if (i < 0) throw new Error('no JSON in tcb output: ' + String(raw || '').slice(0, 200))
  return JSON.parse(raw.slice(i))
}

function tcbExecute(commands) {
  const cmd = JSON.stringify(commands)
  const res = spawnSync(
    'tcb',
    ['db', 'nosql', 'execute', '-e', ENV_ID, '--json', '--command', cmd],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, env: process.env }
  )
  const out = (res.stdout || '') + (res.stderr || '')
  if (res.status !== 0) {
    throw new Error(`tcb exit ${res.status}: ${out.slice(0, 800)}`)
  }
  const parsed = parseTcbJson(out)
  const data = parsed.data || parsed
  return { parsed, results: data.results || [], out }
}

function unwrapMongo(v) {
  if (v == null || typeof v !== 'object') return v
  if ('$numberInt' in v) return Number(v.$numberInt)
  if ('$numberLong' in v) return Number(v.$numberLong)
  if ('$numberDouble' in v) return Number(v.$numberDouble)
  if ('$oid' in v) return v.$oid
  if (Array.isArray(v)) return v.map(unwrapMongo)
  const out = {}
  for (const [k, val] of Object.entries(v)) out[k] = unwrapMongo(val)
  return out
}

function findDocs(limit = 5) {
  const { results } = tcbExecute([
    {
      TableName: COLLECTION,
      CommandType: 'COMMAND',
      Command: JSON.stringify({
        find: COLLECTION,
        filter: {},
        limit
      })
    }
  ])
  const payload = results && results.length ? results[0] : null
  const rows = Array.isArray(payload) ? payload : (payload && payload.data) || []
  return (rows || []).map(unwrapMongo)
}

function findDefaultDoc() {
  const { results } = tcbExecute([
    {
      TableName: COLLECTION,
      CommandType: 'COMMAND',
      Command: JSON.stringify({
        find: COLLECTION,
        filter: { key: RULE_KEY },
        limit: 1
      })
    }
  ])
  const payload = results && results.length ? results[0] : null
  const rows = Array.isArray(payload) ? payload : (payload && payload.data) || []
  const list = (rows || []).map(unwrapMongo)
  if (list[0]) return list[0]

  // 兼容 _id=default
  const { results: byIdResults } = tcbExecute([
    {
      TableName: COLLECTION,
      CommandType: 'COMMAND',
      Command: JSON.stringify({
        find: COLLECTION,
        filter: { _id: RULE_KEY },
        limit: 1
      })
    }
  ])
  const byIdPayload = byIdResults && byIdResults.length ? byIdResults[0] : null
  const byIdRows = Array.isArray(byIdPayload) ? byIdPayload : (byIdPayload && byIdPayload.data) || []
  return ((byIdRows || []).map(unwrapMongo))[0] || null
}

function buildDefaultDoc() {
  const rules = normalizeRules(DEFAULT_RULES)
  const now = Date.now()
  return {
    _id: RULE_KEY,
    ...rules,
    key: RULE_KEY,
    createTime: now,
    updateTime: now,
    updatedBy: 'provision-deposit-rules',
    updatedByName: 'provision',
    seededBy: 'provision-deposit-rules'
  }
}

function seedDefaultDoc(results) {
  let existing = null
  try {
    existing = findDefaultDoc()
  } catch (e) {
    results.push(row(COLLECTION, 'seed', 'fail', `查询失败: ${String(e.message || e).slice(0, 140)}`))
    return
  }

  if (existing) {
    results.push(
      row(
        COLLECTION,
        'seed',
        'exists',
        `已有 default 文档，跳过写入；docId=${existing._id || ''}；${describeRules(existing)}`
      )
    )
    return
  }

  // 集合非空但无 default 时仍写入 default（与 manageDeposit 约定一致）
  let anyDocs = []
  try {
    anyDocs = findDocs(5)
  } catch (_) {
    anyDocs = []
  }

  const doc = buildDefaultDoc()
  try {
    const { results: insertResults, out } = tcbExecute([
      {
        TableName: COLLECTION,
        CommandType: 'INSERT',
        Command: JSON.stringify({
          insert: COLLECTION,
          documents: [doc]
        })
      }
    ])
    const payload = insertResults && insertResults[0]
    const note = payload
      ? `已写入 key=default（${describeRules(doc)}）${anyDocs.length ? `；集合原有 ${anyDocs.length} 条其他文档` : ''}`
      : String(out || '').slice(0, 160)
    results.push(row(COLLECTION, 'seed', 'created', note))
  } catch (e) {
    results.push(row(COLLECTION, 'seed', 'fail', String(e.message || e).slice(0, 200)))
  }
}

async function describeAcl(permission) {
  const resp = await permission.describeResourcePermission({
    resourceType: 'collection',
    resources: [COLLECTION]
  })
  const list = (resp && resp.Data && resp.Data.PermissionList) || []
  const item = list.find((x) => x.Resource === COLLECTION) || list[0]
  if (!item) return null
  return {
    permission: item.Permission,
    securityRule: item.SecurityRule || null
  }
}

async function main() {
  loadDotEnv()
  const secretId = process.env.TCB_SECRET_ID
  const secretKey = process.env.TCB_SECRET_KEY
  if (!secretId || !secretKey) throw new Error('缺少 TCB_SECRET_ID / TCB_SECRET_KEY')

  const CloudBase = require(MANAGER_NODE)
  const app = CloudBase.init({ secretId, secretKey, envId: ENV_ID })
  const { database, permission } = app
  const results = []

  console.log('env=', ENV_ID, 'collection=', COLLECTION)

  // 1. 建集合
  let existed = false
  try {
    await database.describeCollection(COLLECTION)
    existed = true
  } catch (_) {
    existed = false
  }

  if (existed) {
    results.push(row(COLLECTION, '建集合', 'exists', '已存在'))
  } else {
    try {
      const created = await database.createCollectionIfNotExists(COLLECTION)
      const isNew = !!(created && (created.IsCreated || created.isCreated))
      results.push(row(COLLECTION, '建集合', isNew ? 'created' : 'exists', 'createCollectionIfNotExists'))
      existed = !isNew
    } catch (e) {
      const msg = e.message || String(e)
      if (/exist|已存在|already/i.test(msg)) {
        results.push(row(COLLECTION, '建集合', 'exists', msg.slice(0, 80)))
      } else {
        results.push(row(COLLECTION, '建集合', 'fail', msg.slice(0, 160)))
        throw e
      }
    }
  }

  // 2. ACL — 客户端不可读不可写（云函数不受限）
  try {
    await permission.modifyResourcePermission({
      resourceType: 'collection',
      resource: COLLECTION,
      permission: ACL_PERMISSION
    })
    results.push(row(COLLECTION + ' ACL', '设权限', 'ok', ACL_PERMISSION + ' read=false write=false（仅云函数）'))
  } catch (e) {
    results.push(row(COLLECTION + ' ACL', '设权限', 'fail', (e.message || String(e)).slice(0, 160)))
  }

  try {
    const acl = await describeAcl(permission)
    results.push(
      row(
        COLLECTION + ' ACL',
        '校验',
        acl && acl.permission === ACL_PERMISSION ? 'ok' : 'uncertain',
        JSON.stringify(acl)
      )
    )
  } catch (e) {
    results.push(row(COLLECTION + ' ACL', '校验', 'fail', (e.message || String(e)).slice(0, 120)))
  }

  // 3. 索引
  let existingNames = new Set()
  try {
    const desc = await database.describeCollection(COLLECTION)
    for (const idx of desc.Indexes || []) {
      if (idx.Name) existingNames.add(idx.Name)
    }
  } catch (e) {
    results.push(row(COLLECTION + ' 索引', '列举', 'fail', (e.message || String(e)).slice(0, 120)))
  }

  for (const idx of INDEXES) {
    if (existingNames.has(idx.Name)) {
      results.push(row(`${COLLECTION}.${idx.Name}`, '建索引', 'exists', idx.Unique ? 'unique' : 'non-unique'))
      continue
    }
    const payload = {
      IndexName: idx.Name,
      MgoKeySchema: {
        MgoIsUnique: !!idx.Unique,
        MgoIndexKeys: idx.Keys.map((k) => ({ Name: k.Name, Direction: String(k.Direction) }))
      }
    }
    try {
      await database.updateCollection(COLLECTION, { CreateIndexes: [payload] })
      results.push(row(`${COLLECTION}.${idx.Name}`, '建索引', 'created', idx.Unique ? 'unique' : 'non-unique'))
    } catch (e) {
      const msg = e.message || String(e)
      results.push(
        row(
          `${COLLECTION}.${idx.Name}`,
          '建索引',
          /exist|已存在|already|Duplicate/i.test(msg) ? 'exists' : 'fail',
          msg.slice(0, 140)
        )
      )
    }
  }

  // 4. 默认文档（manageDeposit getRules 不自动 seed，仅内存回退）
  seedDefaultDoc(results)

  // 5. 校验
  try {
    const desc = await database.describeCollection(COLLECTION)
    const indexNames = (desc.Indexes || []).map((i) => i.Name)
    const def = findDefaultDoc()
    results.push(
      row(
        COLLECTION,
        '校验',
        def ? 'ok' : 'uncertain',
        `indexes=${indexNames.join(',')}; default=${def ? 'yes' : 'no'}; ${def ? describeRules(def) : ''}`
      )
    )
  } catch (e) {
    results.push(row(COLLECTION, '校验', 'fail', (e.message || String(e)).slice(0, 120)))
  }

  console.log('\n| 集合/索引 | 操作 | 结果 | 备注 |')
  console.log('| --- | --- | --- | --- |')
  for (const r of results) {
    console.log(`| \`${r.name}\` | ${r.op} | ${r.result} | ${r.note} |`)
  }

  const outPath = path.join(__dirname, 'provision-deposit-rules.result.json')
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        envId: ENV_ID,
        collection: COLLECTION,
        permission: ACL_PERMISSION,
        securityRule: null,
        defaultSummary: describeRules(DEFAULT_RULES),
        note: '客户端不可读不可写；读写经 manageDeposit / createDepositIntent 云函数',
        at: new Date().toISOString(),
        results
      },
      null,
      2
    )
  )
  console.log('\nresult →', outPath)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
