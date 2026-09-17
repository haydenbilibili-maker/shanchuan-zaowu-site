#!/usr/bin/env node
/**
 * 幂等创建 platform_order_binds 集合 + ACL（对齐 store_purchases：仅云函数可读写）+ dedupeKey 唯一索引
 * 环境：cloud1-8gnkty5bfff9f0bf
 * 密钥：shanchuanzaowu/admin/.env 的 TCB_SECRET_*
 *
 * 用法：node scripts/provision-platform-order-binds.cjs
 */
const fs = require('fs')
const path = require('path')

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const COLLECTION = 'platform_order_binds'
const ADMIN_ENV = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/admin/.env'
const MANAGER_NODE = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/node_modules/@cloudbase/manager-node'

/** 与线上 store_purchases 原样对齐：Permission=PRIVATE（仅云函数可读写） */
const ACL_PERMISSION = 'PRIVATE'
const SECURITY_RULE = null // PRIVATE 无需 SecurityRule；保留字段供结果落盘说明

const INDEXES = [
  {
    Name: 'dedupeKey_1',
    Keys: [{ Name: 'dedupeKey', Direction: '1' }],
    Unique: true
  },
  {
    Name: 'status_1_createTime_-1',
    Keys: [
      { Name: 'status', Direction: '1' },
      { Name: 'createTime', Direction: '-1' }
    ],
    Unique: false
  },
  {
    Name: 'memberOpenid_1_createTime_-1',
    Keys: [
      { Name: 'memberOpenid', Direction: '1' },
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

  // 2. ACL — 原样对齐 store_purchases：PRIVATE
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

  // 4. 校验：describe + 试写幂等键格式说明
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

  const outPath = path.join(
    '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/WeChatProjects/shanchuanspecimens-只上传/scripts',
    'provision-platform-order-binds.result.json'
  )
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        envId: ENV_ID,
        collection: COLLECTION,
        permission: ACL_PERMISSION,
        securityRule: null,
        dedupeKeyRule: 'platformId:orderNo',
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
