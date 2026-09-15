#!/usr/bin/env node
/**
 * 应用店长运营相关集合安全规则：客户端不可写，改走 manageStoreContent / 既有云函数。
 *
 * 用法：node scripts/configure-ops-content-security-rules.cjs
 *       node scripts/configure-ops-content-security-rules.cjs --dry-run
 */
const fs = require('fs')
const path = require('path')

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const ADMIN_ENV = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/admin/.env'
const MANAGER_NODE = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/node_modules/@cloudbase/manager-node'
const RULES_DIR = path.join(__dirname, '..', 'database-rules')
const DRY_RUN = process.argv.includes('--dry-run')

const COLLECTIONS = [
  'banners',
  'categories',
  'activities',
  'rewards',
  'framers',
  'care_guides',
  'custom_configs',
  'custom_inquiries',
  'pet_memorial_orders',
  'framer_recruit_applications',
  'articles',
  'cms_wikis',
  'bookings',
  'configs'
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
  return { byName }
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
  for (const name of COLLECTIONS) desired[name] = loadDesiredRule(name)

  console.log('env=', ENV_ID, DRY_RUN ? '(dry-run)' : '')
  const before = await describeCollections(permission, COLLECTIONS)
  console.log('\n=== BEFORE ===')
  COLLECTIONS.forEach((n) => console.log(n, JSON.stringify(before.byName[n] || null)))

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
        applyResults.push({ collection: name, success: ok, requestId: mod && mod.RequestId })
        console.log('applied', name, ok)
      } catch (e) {
        applyResults.push({ collection: name, success: false, note: (e.message || String(e)).slice(0, 200) })
        console.error('fail', name, e.message || e)
      }
    }
  }

  await new Promise((r) => setTimeout(r, DRY_RUN ? 0 : 1500))
  const after = await describeCollections(permission, COLLECTIONS)
  const verify = COLLECTIONS.map((name) => {
    const cur = after.byName[name]
    const want = normalizeRuleString(desired[name])
    const got = cur && cur.securityRuleNormalized
    return {
      collection: name,
      matched: !!(cur && cur.permission === 'CUSTOM' && got === want),
      after: cur || null,
      desiredNormalized: want
    }
  })

  console.log('\n=== AFTER ===')
  verify.forEach((v) => console.log(v.collection, 'matched=', v.matched, v.after && v.after.securityRuleNormalized))

  const out = {
    envId: ENV_ID,
    at: new Date().toISOString(),
    dryRun: DRY_RUN,
    desiredRules: Object.fromEntries(COLLECTIONS.map((n) => [n, JSON.parse(desired[n])])),
    beforeLive: before.byName,
    applyResults,
    verify,
    appliedToCloud: !DRY_RUN && applyResults.every((r) => r.success) && verify.every((v) => v.matched)
  }
  const outPath = path.join(__dirname, 'configure-ops-content-security-rules.result.json')
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log('\nresult →', outPath, 'appliedToCloud=', out.appliedToCloud)
  if (!DRY_RUN && !out.appliedToCloud) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
