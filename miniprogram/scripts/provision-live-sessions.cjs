#!/usr/bin/env node
/**
 * 幂等创建直播相关集合 + PRIVATE ACL + 查询索引
 *
 * - live_sessions：场次（含 pushUrl，PRIVATE）
 * - live_messages：本场留言墙（PRIVATE）
 * - live_reminders：开播「提醒我」登记（PRIVATE）
 *
 * 依据：docs/live-streaming.md、manageLiveSession
 * 环境：cloud1-8gnkty5bfff9f0bf
 * 密钥：shanchuanzaowu/admin/.env 的 TCB_SECRET_*
 *
 * 用法：node scripts/provision-live-sessions.cjs
 */
const fs = require('fs')
const path = require('path')

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const ADMIN_ENV = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/admin/.env'
const MANAGER_NODE = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/node_modules/@cloudbase/manager-node'

/** 与 staff_approvals / store_receipt_claims 对齐：仅云函数可读写 */
const ACL_PERMISSION = 'PRIVATE'

const COLLECTIONS = [
  {
    name: 'live_sessions',
    indexes: [
      {
        Name: 'status_1_startTime_-1',
        Keys: [
          { Name: 'status', Direction: '1' },
          { Name: 'startTime', Direction: '-1' }
        ],
        Unique: false
      },
      {
        Name: 'hostOpenid_1_createTime_-1',
        Keys: [
          { Name: 'hostOpenid', Direction: '1' },
          { Name: 'createTime', Direction: '-1' }
        ],
        Unique: false
      }
    ]
  },
  {
    name: 'live_messages',
    indexes: [
      {
        Name: 'sessionId_1_ts_-1',
        Keys: [
          { Name: 'sessionId', Direction: '1' },
          { Name: 'ts', Direction: '-1' }
        ],
        Unique: false
      },
      {
        Name: 'sessionId_1_openid_1_ts_-1',
        Keys: [
          { Name: 'sessionId', Direction: '1' },
          { Name: 'openid', Direction: '1' },
          { Name: 'ts', Direction: '-1' }
        ],
        Unique: false
      }
    ]
  },
  {
    name: 'live_reminders',
    indexes: [
      {
        Name: 'sessionId_1_openid_1_status_1',
        Keys: [
          { Name: 'sessionId', Direction: '1' },
          { Name: 'openid', Direction: '1' },
          { Name: 'status', Direction: '1' }
        ],
        Unique: false
      },
      {
        Name: 'sessionId_1_status_1',
        Keys: [
          { Name: 'sessionId', Direction: '1' },
          { Name: 'status', Direction: '1' }
        ],
        Unique: false
      }
    ]
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

async function provisionOne(database, permission, def, results) {
  const COLLECTION = def.name
  const INDEXES = def.indexes || []

  console.log('collection=', COLLECTION)

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

  let aclOk = false
  try {
    await permission.modifyResourcePermission({
      resourceType: 'collection',
      resource: COLLECTION,
      permission: ACL_PERMISSION
    })
    results.push(row(COLLECTION + ' ACL', '设权限', 'ok', ACL_PERMISSION))
    aclOk = true
  } catch (e) {
    results.push(row(COLLECTION + ' ACL', '设权限', 'fail', (e.message || String(e)).slice(0, 160)))
  }

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
      results.push(row(`${COLLECTION}.${idx.Name}`, '建索引', 'exists', 'non-unique'))
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
      results.push(row(`${COLLECTION}.${idx.Name}`, '建索引', 'created', 'non-unique'))
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

  let finalIndexes = []
  let verified = false
  try {
    const desc = await database.describeCollection(COLLECTION)
    verified = true
    finalIndexes = (desc.Indexes || []).map((i) => ({
      name: i.Name,
      keys: (i.Keys || (i.MgoKeySchema && i.MgoKeySchema.MgoIndexKeys) || []).map((k) => ({
        name: k.Name || k.name,
        direction: String(k.Direction || k.direction || '')
      }))
    }))
    results.push(row(COLLECTION, '校验集合', 'ok', 'indexes=' + finalIndexes.map((i) => i.name).join(',')))
  } catch (e) {
    results.push(row(COLLECTION, '校验集合', 'fail', (e.message || String(e)).slice(0, 120)))
  }

  let observedPermission = null
  try {
    const resp = await permission.describeResourcePermission({
      resourceType: 'collection',
      resources: [COLLECTION]
    })
    const list = (resp && resp.Data && resp.Data.PermissionList) || []
    const item = list.find((x) => x.Resource === COLLECTION) || list[0]
    observedPermission = item
      ? { permission: item.Permission, securityRule: item.SecurityRule || null }
      : null
    results.push(row(
      COLLECTION + ' 权限核对',
      'describe',
      observedPermission ? 'ok' : 'empty',
      observedPermission ? String(observedPermission.permission) : 'no PermissionList'
    ))
  } catch (e) {
    results.push(row(COLLECTION + ' 权限核对', 'describe', 'fail', (e.message || String(e)).slice(0, 120)))
  }

  return { name: COLLECTION, aclOk, verified, observedPermission, finalIndexes }
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
  const summaries = []

  console.log('env=', ENV_ID)

  for (const def of COLLECTIONS) {
    const summary = await provisionOne(database, permission, def, results)
    summaries.push(summary)
  }

  console.log('\n| 集合/索引 | 操作 | 结果 | 备注 |')
  console.log('| --- | --- | --- | --- |')
  for (const r of results) {
    console.log(`| \`${r.name}\` | ${r.op} | ${r.result} | ${r.note} |`)
  }

  const outPath = path.join(__dirname, 'provision-live-sessions.result.json')
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        envId: ENV_ID,
        collections: summaries,
        permission: ACL_PERMISSION,
        at: new Date().toISOString(),
        results
      },
      null,
      2
    )
  )
  console.log('\nresult →', outPath)
  if (summaries.some((s) => !s.verified)) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
