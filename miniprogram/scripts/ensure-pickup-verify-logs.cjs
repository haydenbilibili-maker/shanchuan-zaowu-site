#!/usr/bin/env node
/**
 * 门店自取核销流水：确保集合存在并套用安全规则
 *   - 集合：pickup_verify_logs（仅云函数写；客户端只读）
 *   - 规则来源：miniprogram/database-rules/pickup_verify_logs.json
 *
 * 用法：node scripts/ensure-pickup-verify-logs.cjs [--dry-run]
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ENV_ID = process.env.CLOUDBASE_ENV || 'cloud1-8gnkty5bfff9f0bf'
const ADMIN_ENV = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/admin/.env'
const MANAGER_NODE = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/node_modules/@cloudbase/manager-node'
const RULE_FILE = path.join(__dirname, '..', 'database-rules', 'pickup_verify_logs.json')
const COLLECTION = 'pickup_verify_logs'
const DRY_RUN = process.argv.includes('--dry-run')

function loadDotEnv() {
  if (!fs.existsSync(ADMIN_ENV)) return
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

function tcbExecute(commands) {
  const res = spawnSync('tcb', ['db', 'nosql', 'execute', '-e', ENV_ID, '--json', '--command', JSON.stringify(commands)], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  return { status: res.status, out: (res.stdout || '') + (res.stderr || '') }
}

async function main() {
  const rule = JSON.stringify(JSON.parse(fs.readFileSync(RULE_FILE, 'utf8')))
  console.log(`集合=${COLLECTION} env=${ENV_ID}${DRY_RUN ? ' (dry-run)' : ''}`)
  console.log('目标规则：', rule)
  if (DRY_RUN) return

  // 1) 建集合（已存在会报 NamespaceExists，忽略即可）
  const created = tcbExecute([{ TableName: COLLECTION, CommandType: 'COMMAND', Command: JSON.stringify({ create: COLLECTION }) }])
  const createMsg = created.out.replace(/\s+/g, ' ').slice(0, 200)
  console.log('建集合：', created.status === 0 ? 'ok' : `（已存在或不可用，忽略）${createMsg}`)

  // 2) 套用安全规则
  loadDotEnv()
  const secretId = process.env.TCB_SECRET_ID
  const secretKey = process.env.TCB_SECRET_KEY
  if (!secretId || !secretKey) throw new Error('缺少 TCB_SECRET_ID / TCB_SECRET_KEY（见 admin/.env）')
  const CloudBase = require(MANAGER_NODE)
  const app = CloudBase.init({ secretId, secretKey, envId: ENV_ID })
  const mod = await app.permission.modifyResourcePermission({
    resourceType: 'collection',
    resource: COLLECTION,
    permission: 'CUSTOM',
    securityRule: rule
  })
  console.log('规则写入：', !!(mod && mod.Data && mod.Data.Success))

  // 3) 复核
  await new Promise((r) => setTimeout(r, 1500))
  const resp = await app.permission.describeResourcePermission({ resourceType: 'collection', resources: [COLLECTION] })
  const row = ((resp && resp.Data && resp.Data.PermissionList) || []).find((it) => it.Resource === COLLECTION)
  const got = row ? String(row.SecurityRule || '') : ''
  const matched = row && row.Permission === 'CUSTOM' && got.replace(/\s+/g, '') === rule.replace(/\s+/g, '')
  console.log('复核：', row ? JSON.stringify({ permission: row.Permission, securityRule: row.SecurityRule }) : '未读取到（可在控制台确认）')
  console.log('规则匹配：', !!matched)
  if (!matched) process.exitCode = 1
}

main().catch((e) => {
  console.error('失败：', e.message || e)
  process.exit(1)
})
