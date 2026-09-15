#!/usr/bin/env node
/**
 * 幂等创建 workspace_acl / staff_audit_logs + PRIVATE ACL + 索引
 * 并用 tcb db nosql 写入 workspace_acl/super_admins 最小 seed
 *
 * 环境：cloud1-8gnkty5bfff9f0bf
 * 密钥：shanchuanzaowu/admin/.env 的 TCB_SECRET_*
 *
 * 用法：node scripts/provision-workspace-acl-audit.cjs
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const ADMIN_ENV = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/admin/.env'
const MANAGER_NODE = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/node_modules/@cloudbase/manager-node'

const HARDCODED_SUPER = [
  'oa22s5ZcMY7xkQDlNW8X8jaYy46M',
  'oa22s5RuZSXOCRQtXzdrVEiT1JuY'
]

const COLLECTIONS = [
  {
    name: 'workspace_acl',
    indexes: []
  },
  {
    name: 'staff_audit_logs',
    indexes: [
      {
        Name: 'createdAtMs_-1',
        Keys: [{ Name: 'createdAtMs', Direction: '-1' }],
        Unique: false
      },
      {
        Name: 'action_1_createdAtMs_-1',
        Keys: [
          { Name: 'action', Direction: '1' },
          { Name: 'createdAtMs', Direction: '-1' }
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

async function ensureCollection(database, permission, name, results) {
  let existed = false
  try {
    await database.describeCollection(name)
    existed = true
  } catch (_) {
    existed = false
  }

  if (existed) {
    results.push(row(name, '建集合', 'exists', '已存在'))
  } else {
    try {
      const created = await database.createCollectionIfNotExists(name)
      const isNew = !!(created && (created.IsCreated || created.isCreated))
      results.push(row(name, '建集合', isNew ? 'created' : 'exists', 'createCollectionIfNotExists'))
    } catch (e) {
      const msg = e.message || String(e)
      if (/exist|已存在|already/i.test(msg)) {
        results.push(row(name, '建集合', 'exists', msg.slice(0, 80)))
      } else {
        results.push(row(name, '建集合', 'fail', msg.slice(0, 160)))
        throw e
      }
    }
  }

  try {
    await permission.modifyResourcePermission({
      resourceType: 'collection',
      resource: name,
      permission: 'PRIVATE'
    })
    results.push(row(name + ' ACL', '设权限', 'ok', 'PRIVATE'))
  } catch (e) {
    results.push(row(name + ' ACL', '设权限', 'fail', (e.message || String(e)).slice(0, 160)))
  }
}

async function ensureIndexes(database, col, results) {
  let existingNames = new Set()
  try {
    const desc = await database.describeCollection(col.name)
    for (const idx of desc.Indexes || []) {
      if (idx.Name) existingNames.add(idx.Name)
    }
  } catch (e) {
    results.push(row(col.name + ' 索引', '列举', 'fail', (e.message || String(e)).slice(0, 120)))
  }

  for (const idx of col.indexes || []) {
    if (existingNames.has(idx.Name)) {
      results.push(row(`${col.name}.${idx.Name}`, '建索引', 'exists', idx.Unique ? 'unique' : 'non-unique'))
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
      await database.updateCollection(col.name, { CreateIndexes: [payload] })
      results.push(row(`${col.name}.${idx.Name}`, '建索引', 'created', idx.Unique ? 'unique' : 'non-unique'))
    } catch (e) {
      const msg = e.message || String(e)
      results.push(row(
        `${col.name}.${idx.Name}`,
        '建索引',
        /exist|已存在|already|Duplicate/i.test(msg) ? 'exists' : 'fail',
        msg.slice(0, 140)
      ))
    }
  }
}

function seedSuperAdminsViaTcb(results) {
  // upsert by _id：先 QUERY，不存在则 INSERT
  const queryCmd = JSON.stringify([{
    TableName: 'workspace_acl',
    CommandType: 'QUERY',
    Command: JSON.stringify({ find: 'workspace_acl', filter: { _id: 'super_admins' }, limit: 1 })
  }])
  const q = spawnSync('tcb', ['db', 'nosql', 'execute', '--command', queryCmd, '--json'], {
    encoding: 'utf8',
    env: process.env,
    cwd: path.join(__dirname, '..')
  })
  const qOut = (q.stdout || '') + (q.stderr || '')
  const exists = /super_admins|"_id"\s*:\s*"super_admins"/.test(qOut) && !/\"documents\"\s*:\s*\[\s*\]/.test(qOut)

  if (exists) {
    const updateCmd = JSON.stringify([{
      TableName: 'workspace_acl',
      CommandType: 'UPDATE',
      Command: JSON.stringify({
        update: 'workspace_acl',
        updates: [{
          q: { _id: 'super_admins' },
          u: {
            $set: {
              hardcodedNote: HARDCODED_SUPER,
              seededBy: 'provision-workspace-acl-audit',
              updateTime: new Date().toISOString()
            },
            $setOnInsert: { openids: [] }
          },
          multi: false,
          upsert: true
        }]
      })
    }])
    const u = spawnSync('tcb', ['db', 'nosql', 'execute', '--command', updateCmd, '--json'], {
      encoding: 'utf8',
      env: process.env
    })
    const ok = u.status === 0
    results.push(row(
      'workspace_acl/super_admins',
      'seed',
      ok ? 'updated' : 'fail',
      ok ? '保留既有 openids；刷新 hardcodedNote' : ((u.stderr || u.stdout || '').slice(0, 160))
    ))
    return
  }

  const insertCmd = JSON.stringify([{
    TableName: 'workspace_acl',
    CommandType: 'INSERT',
    Command: JSON.stringify({
      insert: 'workspace_acl',
      documents: [{
        _id: 'super_admins',
        openids: [],
        hardcodedNote: HARDCODED_SUPER,
        createTime: new Date().toISOString(),
        updateTime: new Date().toISOString(),
        seededBy: 'provision-workspace-acl-audit'
      }]
    })
  }])
  const ins = spawnSync('tcb', ['db', 'nosql', 'execute', '--command', insertCmd, '--json'], {
    encoding: 'utf8',
    env: process.env
  })
  const ok = ins.status === 0
  results.push(row(
    'workspace_acl/super_admins',
    'seed',
    ok ? 'created' : 'fail',
    ok ? 'openids=[]；硬编码兜底见 hardcodedNote' : ((ins.stderr || ins.stdout || '').slice(0, 160))
  ))
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

  for (const col of COLLECTIONS) {
    await ensureCollection(database, permission, col.name, results)
    await ensureIndexes(database, col, results)
  }

  seedSuperAdminsViaTcb(results)

  console.log('\n| 集合/索引 | 操作 | 结果 | 备注 |')
  console.log('| --- | --- | --- | --- |')
  for (const r of results) {
    console.log(`| \`${r.name}\` | ${r.op} | ${r.result} | ${r.note} |`)
  }

  const outPath = path.join(__dirname, 'provision-workspace-acl-audit.result.json')
  fs.writeFileSync(outPath, JSON.stringify({
    envId: ENV_ID,
    at: new Date().toISOString(),
    hardcodedSuper: HARDCODED_SUPER,
    results
  }, null, 2))
  console.log('\nresult →', outPath)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
