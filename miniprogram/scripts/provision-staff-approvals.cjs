#!/usr/bin/env node
/**
 * 幂等创建 staff_approvals 集合 + PRIVATE ACL（仅云函数可读写）+ 审批队列索引
 *
 * 依据：docs/审批流体系.md、manageApprovals 查询（list / countPending / listMine / approvalBridge）
 * 环境：cloud1-8gnkty5bfff9f0bf
 * 密钥：shanchuanzaowu/admin/.env 的 TCB_SECRET_*
 *
 * 用法：node scripts/provision-staff-approvals.cjs
 */
const fs = require('fs')
const path = require('path')

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const COLLECTION = 'staff_approvals'
const ADMIN_ENV = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/admin/.env'
const MANAGER_NODE = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/node_modules/@cloudbase/manager-node'

/** 与 store_purchases / store_receipt_claims 对齐：Permission=PRIVATE（仅云函数可读写） */
const ACL_PERMISSION = 'PRIVATE'

const INDEXES = [
  // 待审队列 / 计数：where status + approverRole，orderBy createTimeMs desc
  {
    Name: 'status_1_approverRole_1_createTimeMs_-1',
    Keys: [
      { Name: 'status', Direction: '1' },
      { Name: 'approverRole', Direction: '1' },
      { Name: 'createTimeMs', Direction: '-1' }
    ],
    Unique: false
  },
  // 业务单去重与同步：where relatedId + actionType + status
  {
    Name: 'relatedId_1_actionType_1_status_1',
    Keys: [
      { Name: 'relatedId', Direction: '1' },
      { Name: 'actionType', Direction: '1' },
      { Name: 'status', Direction: '1' }
    ],
    Unique: false
  },
  // 我发起的：where applicantOpenid，orderBy createTimeMs desc
  {
    Name: 'applicantOpenid_1_createTimeMs_-1',
    Keys: [
      { Name: 'applicantOpenid', Direction: '1' },
      { Name: 'createTimeMs', Direction: '-1' }
    ],
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

  // 2. ACL — PRIVATE（仅云函数可读写）
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

  // 4. 校验
  let finalIndexes = []
  try {
    const desc = await database.describeCollection(COLLECTION)
    finalIndexes = (desc.Indexes || []).map((i) => ({
      name: i.Name,
      unique: !!(i.Unique || (i.Keys && false)),
      keys: (i.Keys || i.MgoKeySchema && i.MgoKeySchema.MgoIndexKeys || []).map((k) => ({
        name: k.Name || k.name,
        direction: String(k.Direction || k.direction || '')
      }))
    }))
    results.push(row(COLLECTION, '校验', 'ok', 'indexes=' + finalIndexes.map((i) => i.name).join(',')))
  } catch (e) {
    results.push(row(COLLECTION, '校验', 'fail', (e.message || String(e)).slice(0, 120)))
  }

  console.log('\n| 集合/索引 | 操作 | 结果 | 备注 |')
  console.log('| --- | --- | --- | --- |')
  for (const r of results) {
    console.log(`| \`${r.name}\` | ${r.op} | ${r.result} | ${r.note} |`)
  }

  const outPath = path.join(__dirname, 'provision-staff-approvals.result.json')
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        envId: ENV_ID,
        collection: COLLECTION,
        permission: ACL_PERMISSION,
        securityRule: null,
        indexesPlanned: INDEXES.map((i) => i.Name),
        indexesObserved: finalIndexes,
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
