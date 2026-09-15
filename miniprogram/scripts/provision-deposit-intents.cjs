#!/usr/bin/env node
/**
 * 幂等创建 deposit_intents 集合 + ACL + 查询索引
 *
 * 权限：CUSTOM — 仅本人可读；write:false（写入经 createDepositIntent 云函数）
 * 对齐：wishlist 页客户端本人读；createDepositIntent 云函数读写
 *
 * 环境：cloud1-8gnkty5bfff9f0bf
 * 密钥：shanchuanzaowu/admin/.env 的 TCB_SECRET_*
 *
 * 用法：node scripts/provision-deposit-intents.cjs
 */
const fs = require('fs')
const path = require('path')

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const COLLECTION = 'deposit_intents'
const ADMIN_ENV = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/admin/.env'
const MANAGER_NODE = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/node_modules/@cloudbase/manager-node'
const RULES_DIR = path.join(__dirname, '..', 'database-rules')

/** 与 users / user_coupons 对齐：本人可读，客户端不可写 */
const ACL_PERMISSION = 'CUSTOM'
const SECURITY_RULE = JSON.stringify({
  read: 'auth != null && doc._openid == auth.openid',
  write: false
})

const INDEXES = [
  {
    Name: '_openid_1_productId_1_status_1',
    Keys: [
      { Name: '_openid', Direction: '1' },
      { Name: 'productId', Direction: '1' },
      { Name: 'status', Direction: '1' }
    ],
    Unique: false
  },
  {
    Name: '_openid_1_status_1_createTime_-1',
    Keys: [
      { Name: '_openid', Direction: '1' },
      { Name: 'status', Direction: '1' },
      { Name: 'createTime', Direction: '-1' }
    ],
    Unique: false
  },
  {
    Name: 'status_1_createTime_-1',
    Keys: [
      { Name: 'status', Direction: '1' },
      { Name: 'createTime', Direction: '-1' }
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

function ensureRulesFile() {
  const p = path.join(RULES_DIR, `${COLLECTION}.json`)
  const desired = {
    read: 'auth != null && doc._openid == auth.openid',
    write: false
  }
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, JSON.stringify(desired, null, 2) + '\n')
    return { path: p, op: 'created' }
  }
  return { path: p, op: 'exists' }
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

  const rulesFile = ensureRulesFile()
  results.push(row(COLLECTION + '.json', '规则文件', rulesFile.op, rulesFile.path))

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

  // 2. ACL — 本人可读 / 客户端不可写（云函数不受限）
  try {
    const mod = await permission.modifyResourcePermission({
      resourceType: 'collection',
      resource: COLLECTION,
      permission: ACL_PERMISSION,
      securityRule: SECURITY_RULE
    })
    const ok = !!(mod && mod.Data && mod.Data.Success === true)
    results.push(
      row(
        COLLECTION + ' ACL',
        '设权限',
        ok ? 'ok' : 'uncertain',
        `${ACL_PERMISSION} read=own write=false`
      )
    )
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

  // 4. 校验
  try {
    const desc = await database.describeCollection(COLLECTION)
    const indexNames = (desc.Indexes || []).map((i) => i.Name)
    results.push(row(COLLECTION, '校验', 'ok', 'indexes=' + indexNames.join(',')))
  } catch (e) {
    results.push(row(COLLECTION, '校验', 'fail', (e.message || String(e)).slice(0, 120)))
  }

  console.log('\n| 集合/索引 | 操作 | 结果 | 备注 |')
  console.log('| --- | --- | --- | --- |')
  for (const r of results) {
    console.log(`| \`${r.name}\` | ${r.op} | ${r.result} | ${r.note} |`)
  }

  const outPath = path.join(__dirname, 'provision-deposit-intents.result.json')
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        envId: ENV_ID,
        collection: COLLECTION,
        permission: ACL_PERMISSION,
        securityRule: JSON.parse(SECURITY_RULE),
        note: '客户端仅本人可读；写入经 createDepositIntent；云函数不受安全规则限制',
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
