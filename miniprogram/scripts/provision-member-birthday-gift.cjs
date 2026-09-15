#!/usr/bin/env node
/**
 * 幂等创建 member_birthday_gift 集合 + ACL（PRIVATE）+ 写入代码默认配置文档
 * 环境：cloud1-8gnkty5bfff9f0bf
 * 密钥：shanchuanzaowu/admin/.env 的 TCB_SECRET_*
 *
 * 用法：node scripts/provision-member-birthday-gift.cjs
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const COLLECTION = 'member_birthday_gift'
const ADMIN_ENV = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/admin/.env'
const MANAGER_NODE = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/node_modules/@cloudbase/manager-node'
const DEFAULTS = require('../cloudfunctions/manageBirthdayGift/birthdayGiftDefaults')

/** 与 member_welcome_gift 对齐：仅云函数可读写 */
const ACL_PERMISSION = 'PRIVATE'

const INDEXES = [
  {
    Name: 'priority_1_updateTime_-1',
    Keys: [
      { Name: 'priority', Direction: '1' },
      { Name: 'updateTime', Direction: '-1' }
    ],
    Unique: false
  },
  {
    Name: 'ruleId_1',
    Keys: [{ Name: 'ruleId', Direction: '1' }],
    Unique: false
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

function buildDefaultDoc() {
  const cfg = DEFAULTS.normalizeConfig(DEFAULTS.getDefaultConfig())
  const now = Date.now()
  return {
    ruleId: cfg.ruleId,
    name: cfg.name,
    status: cfg.enabled ? 'active' : 'inactive',
    enabled: cfg.enabled,
    title: cfg.title,
    messageTitle: cfg.messageTitle,
    pointsTitle: cfg.pointsTitle,
    points: cfg.points,
    pointsEnabled: cfg.pointsEnabled,
    excludeGrowth: cfg.excludeGrowth,
    couponsEnabled: cfg.couponsEnabled,
    expireMode: cfg.expireMode,
    expireDays: cfg.expireDays,
    stackable: cfg.stackable,
    priority: cfg.priority,
    processBatchLimit: cfg.processBatchLimit,
    coupons: cfg.coupons,
    createTime: now,
    updateTime: now,
    _updateTime: now,
    createdBy: 'provision-member-birthday-gift',
    updatedBy: 'provision-member-birthday-gift',
    seededBy: 'provision-member-birthday-gift'
  }
}

function seedDefaultDoc(results) {
  let docs = []
  try {
    docs = findDocs(5)
  } catch (e) {
    results.push(row(COLLECTION, 'seed', 'fail', `查询失败: ${String(e.message || e).slice(0, 140)}`))
    return
  }

  if (docs.length) {
    results.push(row(
      COLLECTION,
      'seed',
      'exists',
      `已有 ${docs.length} 条文档，跳过写入；docId=${docs[0]._id || ''}`
    ))
    return
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
      ? `默认配置已写入（enabled / 200积分不计成长 / 满100减20×3 / expireMode=end_of_month）`
      : String(out || '').slice(0, 160)
    results.push(row(COLLECTION, 'seed', 'created', note))
  } catch (e) {
    results.push(row(COLLECTION, 'seed', 'fail', String(e.message || e).slice(0, 200)))
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

  // 2. ACL
  try {
    await permission.modifyResourcePermission({
      resourceType: 'collection',
      resource: COLLECTION,
      permission: ACL_PERMISSION
    })
    results.push(row(COLLECTION + ' ACL', '设权限', 'ok', ACL_PERMISSION))
  } catch (e) {
    results.push(row(COLLECTION + ' ACL', '设权限', 'fail', (e.message || String(e)).slice(0, 160)))
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
      results.push(row(
        `${COLLECTION}.${idx.Name}`,
        '建索引',
        /exist|已存在|already|Duplicate/i.test(msg) ? 'exists' : 'fail',
        msg.slice(0, 140)
      ))
    }
  }

  // 4. 默认文档（空集合才写）
  seedDefaultDoc(results)

  // 5. 校验
  try {
    const desc = await database.describeCollection(COLLECTION)
    const indexNames = (desc.Indexes || []).map((i) => i.Name)
    const docs = findDocs(5)
    results.push(row(
      COLLECTION,
      '校验',
      'ok',
      `indexes=${indexNames.join(',')}; docs=${docs.length}; ruleId=${(docs[0] && docs[0].ruleId) || ''}`
    ))
  } catch (e) {
    results.push(row(COLLECTION, '校验', 'fail', (e.message || String(e)).slice(0, 120)))
  }

  console.log('\n| 集合/索引 | 操作 | 结果 | 备注 |')
  console.log('| --- | --- | --- | --- |')
  for (const r of results) {
    console.log(`| \`${r.name}\` | ${r.op} | ${r.result} | ${r.note} |`)
  }

  const outPath = path.join(__dirname, 'provision-member-birthday-gift.result.json')
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        envId: ENV_ID,
        collection: COLLECTION,
        permission: ACL_PERMISSION,
        defaultSummary: 'enabled / 200pts excludeGrowth / 满100减20×3 / expireMode=end_of_month',
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
