#!/usr/bin/env node
/**
 * 应用 users / user_coupons 云开发自定义安全规则
 * - 仅本人可读
 * - write:false（资料/券包改动经云函数）
 *
 * 环境：cloud1-8gnkty5bfff9f0bf
 * 密钥：shanchuanzaowu/admin/.env 的 TCB_SECRET_*
 *
 * 用法：node scripts/configure-users-coupons-security-rules.cjs
 *       node scripts/configure-users-coupons-security-rules.cjs --dry-run
 */
const fs = require('fs')
const path = require('path')

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const ADMIN_ENV = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/admin/.env'
const MANAGER_NODE = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/node_modules/@cloudbase/manager-node'
const RULES_DIR = path.join(__dirname, '..', 'database-rules')
const COLLECTIONS = ['users', 'user_coupons']
const DRY_RUN = process.argv.includes('--dry-run')

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

function loadDesiredRule(name) {
  const p = path.join(RULES_DIR, `${name}.json`)
  if (!fs.existsSync(p)) throw new Error('缺少规则文件 ' + p)
  return JSON.stringify(JSON.parse(fs.readFileSync(p, 'utf8')))
}

function normalizeRuleString(s) {
  if (s == null || s === '') return null
  try {
    return JSON.stringify(JSON.parse(s))
  } catch (_) {
    return String(s).replace(/\s+/g, ' ').trim()
  }
}

async function describeCollections(permission, names) {
  const resp = await permission.describeResourcePermission({
    resourceType: 'collection',
    resources: names
  })
  const list = (resp && resp.Data && resp.Data.PermissionList) || []
  const byName = {}
  for (const item of list) {
    byName[item.Resource] = {
      permission: item.Permission,
      securityRule: item.SecurityRule || null,
      securityRuleNormalized: normalizeRuleString(item.SecurityRule)
    }
  }
  return { raw: resp, byName, requestId: resp && resp.RequestId }
}

async function main() {
  loadDotEnv()
  const secretId = process.env.TCB_SECRET_ID
  const secretKey = process.env.TCB_SECRET_KEY
  if (!secretId || !secretKey) throw new Error('缺少 TCB_SECRET_ID / TCB_SECRET_KEY')

  const CloudBase = require(MANAGER_NODE)
  const app = CloudBase.init({ secretId, secretKey, envId: ENV_ID })
  const { permission } = app

  const desired = {}
  for (const name of COLLECTIONS) {
    desired[name] = loadDesiredRule(name)
  }

  console.log('env=', ENV_ID, DRY_RUN ? '(dry-run)' : '')

  const before = await describeCollections(permission, COLLECTIONS)
  console.log('\n=== BEFORE (live) ===')
  for (const name of COLLECTIONS) {
    console.log(name, JSON.stringify(before.byName[name] || null, null, 2))
  }

  const applyResults = []
  if (!DRY_RUN) {
    for (const name of COLLECTIONS) {
      try {
        const mod = await permission.modifyResourcePermission({
          resourceType: 'collection',
          resource: name,
          permission: 'CUSTOM',
          securityRule: desired[name]
        })
        const ok = !!(mod && mod.Data && mod.Data.Success === true)
        applyResults.push({
          collection: name,
          op: 'modifyResourcePermission',
          result: ok ? 'ok' : 'uncertain',
          success: ok,
          requestId: mod && mod.RequestId
        })
        console.log('\napplied', name, 'Success=', ok)
      } catch (e) {
        applyResults.push({
          collection: name,
          op: 'modifyResourcePermission',
          result: 'fail',
          success: false,
          note: (e.message || String(e)).slice(0, 300)
        })
        console.error('apply fail', name, e.message || e)
      }
    }
  } else {
    for (const name of COLLECTIONS) {
      applyResults.push({ collection: name, op: 'modifyResourcePermission', result: 'skipped', success: false, note: 'dry-run' })
    }
  }

  await new Promise((r) => setTimeout(r, DRY_RUN ? 0 : 1200))
  const after = await describeCollections(permission, COLLECTIONS)

  const verify = []
  console.log('\n=== AFTER (live) ===')
  for (const name of COLLECTIONS) {
    const cur = after.byName[name]
    console.log(name, JSON.stringify(cur || null, null, 2))
    const want = normalizeRuleString(desired[name])
    const got = cur && cur.securityRuleNormalized
    verify.push({
      collection: name,
      matched: !!(cur && cur.permission === 'CUSTOM' && got === want),
      beforeLive: before.byName[name] || null,
      after: cur || null,
      desiredNormalized: want
    })
  }

  const appliedOk = !DRY_RUN && applyResults.every((r) => r.success)
  const verifiedOk = !DRY_RUN && verify.every((v) => v.matched)

  const out = {
    envId: ENV_ID,
    at: new Date().toISOString(),
    dryRun: DRY_RUN,
    mode: 'owner-read-cloud-write',
    desiredRules: Object.fromEntries(COLLECTIONS.map((n) => [n, JSON.parse(desired[n])])),
    beforeLive: before.byName,
    applyResults,
    after: after.byName,
    verify,
    appliedToCloud: appliedOk && verifiedOk,
    configEchoMatchesDesired: verifiedOk
  }

  const outPath = path.join(__dirname, 'configure-users-coupons-security-rules.result.json')
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log('\nresult →', outPath)
  console.log('appliedToCloud=', out.appliedToCloud)

  if (!DRY_RUN && (!appliedOk || !verifiedOk)) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
