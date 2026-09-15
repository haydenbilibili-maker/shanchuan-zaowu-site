#!/usr/bin/env node
/**
 * 财务账本对齐：幂等创建集合 + 索引
 * 环境 cloud1-8gnkty5bfff9f0bf
 * 密钥：shanchuanzaowu/admin/.env 的 TCB_SECRET_*
 *
 * 规则：
 * - 积分三表 skip
 * - 不改既有集合 ACL（users/orders 等绝对不动；已存在财务表也不改 ACL）
 * - 仅对「本次新建」的集合设 ACL
 * - 不使用 ledger_daily（代码 SSOT 为 store_ledger）
 */
const fs = require('fs')
const path = require('path')

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const ADMIN_ENV = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/admin/.env'
const MANAGER_NODE = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/node_modules/@cloudbase/manager-node'

const SKIP_POINT = new Set(['staff_members', 'store_purchases', 'store_point_rules'])

/** 代码实际引用的财务相关集合（无 ledger_daily） */
const FINANCE_COLLECTIONS = [
  {
    name: 'store_ledger',
    // 店长客户端 + Admin CDN 需读写；仅云函数 PRIVATE 会打断现网路径
    aclIfNew: { permission: 'CUSTOM', securityRule: JSON.stringify({ read: 'auth != null', write: 'auth != null' }) },
    indexes: [
      { Name: 'date_1', Keys: [{ Name: 'date', Direction: '1' }], Unique: false },
      { Name: 'storeId_1_date_1', Keys: [{ Name: 'storeId', Direction: '1' }, { Name: 'date', Direction: '1' }], Unique: false },
      { Name: 'date_-1', Keys: [{ Name: 'date', Direction: '-1' }], Unique: false },
    ],
  },
  {
    name: 'finance_records',
    aclIfNew: { permission: 'CUSTOM', securityRule: JSON.stringify({ read: 'auth != null', write: 'auth != null' }) },
    indexes: [
      { Name: 'date_1', Keys: [{ Name: 'date', Direction: '1' }], Unique: false },
      { Name: 'date_-1', Keys: [{ Name: 'date', Direction: '-1' }], Unique: false },
      { Name: 'storeId_1_date_1', Keys: [{ Name: 'storeId', Direction: '1' }, { Name: 'date', Direction: '1' }], Unique: false },
    ],
  },
  {
    name: 'finance_settings',
    aclIfNew: { permission: 'CUSTOM', securityRule: JSON.stringify({ read: 'auth != null', write: 'auth != null' }) },
    indexes: [
      { Name: '_updateTime_-1', Keys: [{ Name: '_updateTime', Direction: '-1' }], Unique: false },
    ],
  },
  {
    name: 'daily_revenues',
    // 历史兼容；若已存在绝不改 ACL
    aclIfNew: { permission: 'CUSTOM', securityRule: JSON.stringify({ read: 'auth != null', write: 'auth != null' }) },
    indexes: [
      { Name: 'date_1', Keys: [{ Name: 'date', Direction: '1' }], Unique: false },
      { Name: 'date_-1', Keys: [{ Name: 'date', Direction: '-1' }], Unique: false },
    ],
  },
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}

function row(name, op, result, note) {
  return { name, op, result, note }
}

async function ensureCollection(database, permission, spec, results) {
  const { name, aclIfNew } = spec
  if (SKIP_POINT.has(name)) {
    results.push(row(name, 'skip', 'skipped', '积分三表已存在，按约定跳过'))
    return { existed: true, created: false }
  }

  let existed = false
  try {
    await database.describeCollection(name)
    existed = true
  } catch (e) {
    existed = false
  }

  if (existed) {
    results.push(row(name, '建集合', 'exists', '已存在；不改 ACL'))
    return { existed: true, created: false }
  }

  try {
    const created = await database.createCollectionIfNotExists(name)
    const isNew = !!(created && (created.IsCreated || created.isCreated))
    results.push(row(name, '建集合', isNew ? 'created' : 'exists', 'createCollectionIfNotExists'))
    // 仅新建时设 ACL
    if (isNew && aclIfNew) {
      try {
        await permission.modifyResourcePermission({
          resourceType: 'collection',
          resource: name,
          permission: aclIfNew.permission,
          securityRule: aclIfNew.securityRule,
        })
        results.push(row(name + ' ACL', '设权限', 'ok', aclIfNew.permission + '（仅新建）'))
      } catch (e) {
        results.push(row(name + ' ACL', '设权限', 'fail', (e.message || String(e)).slice(0, 120)))
      }
    }
    return { existed: false, created: true }
  } catch (e) {
    const msg = e.message || String(e)
    if (/exist|已存在|already/i.test(msg)) {
      results.push(row(name, '建集合', 'exists', msg.slice(0, 80)))
      return { existed: true, created: false }
    }
    results.push(row(name, '建集合', 'fail', msg.slice(0, 160)))
    return { existed: false, created: false, failed: true }
  }
}

async function ensureIndexes(database, spec, results) {
  const { name, indexes } = spec
  if (!indexes || !indexes.length) return

  let existingNames = new Set()
  try {
    const desc = await database.describeCollection(name)
    for (const idx of desc.Indexes || []) {
      if (idx.Name) existingNames.add(idx.Name)
    }
  } catch (e) {
    results.push(row(name + ' 索引', '列举', 'fail', (e.message || String(e)).slice(0, 120)))
    return
  }

  const toCreate = []
  for (const idx of indexes) {
    if (existingNames.has(idx.Name)) {
      results.push(row(`${name}.${idx.Name}`, '建索引', 'exists', '已存在'))
      continue
    }
    // 也按键集合粗判（CloudBase 可能自动命名）
    const keySig = idx.Keys.map((k) => `${k.Name}_${k.Direction}`).join('_')
    const softHit = [...existingNames].some((n) => n.includes(idx.Keys[0].Name) && (idx.Keys.length === 1 || n.includes(idx.Keys[1]?.Name || '___')))
    if (softHit && existingNames.has(keySig)) {
      results.push(row(`${name}.${idx.Name}`, '建索引', 'exists', `近似名已存在`))
      continue
    }
    toCreate.push({
      IndexName: idx.Name,
      MgoKeySchema: {
        MgoIsUnique: !!idx.Unique,
        MgoIndexKeys: idx.Keys.map((k) => ({ Name: k.Name, Direction: String(k.Direction) })),
      },
    })
  }

  if (!toCreate.length) return

  try {
    await database.updateCollection(name, { CreateIndexes: toCreate })
    for (const c of toCreate) {
      results.push(row(`${name}.${c.IndexName}`, '建索引', 'created', c.MgoKeySchema.MgoIsUnique ? 'unique' : 'non-unique'))
    }
  } catch (e) {
    const msg = e.message || String(e)
    // 部分成功或已存在
    if (/exist|已存在|already|Duplicate/i.test(msg)) {
      for (const c of toCreate) {
        results.push(row(`${name}.${c.IndexName}`, '建索引', 'exists/partial', msg.slice(0, 100)))
      }
    } else {
      // 逐条重试，便于定位
      for (const c of toCreate) {
        try {
          await database.updateCollection(name, { CreateIndexes: [c] })
          results.push(row(`${name}.${c.IndexName}`, '建索引', 'created', '逐条'))
        } catch (e2) {
          const m2 = e2.message || String(e2)
          results.push(row(`${name}.${c.IndexName}`, '建索引', /exist|已存在|already|Duplicate/i.test(m2) ? 'exists' : 'fail', m2.slice(0, 120)))
        }
      }
    }
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

  console.log('env=', ENV_ID)
  results.push(row('ledger_daily', 'skip', 'skipped', '代码未使用；SSOT 为 store_ledger'))
  results.push(row('staff_members', 'skip', 'skipped', '积分三表已存在'))
  results.push(row('store_purchases', 'skip', 'skipped', '积分三表已存在'))
  results.push(row('store_point_rules', 'skip', 'skipped', '积分三表已存在'))

  for (const spec of FINANCE_COLLECTIONS) {
    await ensureCollection(database, permission, spec, results)
    await ensureIndexes(database, spec, results)
  }

  // 打印表格
  console.log('\n| 集合/索引 | 操作 | 结果 | 备注 |')
  console.log('| --- | --- | --- | --- |')
  for (const r of results) {
    console.log(`| \`${r.name}\` | ${r.op} | ${r.result} | ${r.note} |`)
  }

  // 写一份结果到 scripts 便于留存（不进 git 也可）
  const outDir = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/WeChatProjects/shanchuanspecimens/scripts'
  try {
    fs.writeFileSync(path.join(outDir, 'provision-finance-ledger.result.json'), JSON.stringify({ envId: ENV_ID, at: new Date().toISOString(), results }, null, 2))
  } catch (_) {}
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
