#!/usr/bin/env node
/**
 * 应用近期新增/缺规则集合的安全规则（2026-09-15 审计 P1）。
 *
 * 分组：
 * - APPLY_PRIVATE：仅云函数访问（与现网 PRIVATE 对齐，版本化落库）
 * - APPLY_AUTH_READ_NO_WRITE：登录可读、禁止客户端写（含 analytics_daily 收紧写）
 * - DEFERRED：规则文件已写入 database-rules/，但 ERP 仍 CDN 直写，发版后迁云函数再 apply
 *
 * 用法：
 *   node scripts/configure-recent-collections-security-rules.cjs --dry-run
 *   node scripts/configure-recent-collections-security-rules.cjs
 *   node scripts/configure-recent-collections-security-rules.cjs --include-deferred
 */
const fs = require('fs')
const path = require('path')

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const ADMIN_ENV = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/admin/.env'
const MANAGER_NODE = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/node_modules/@cloudbase/manager-node'
const RULES_DIR = path.join(__dirname, '..', 'database-rules')
const DRY_RUN = process.argv.includes('--dry-run')
const INCLUDE_DEFERRED = process.argv.includes('--include-deferred')

const APPLY_PRIVATE = [
  'studio_inventory',
  'studio_inventory_snapshots',
  'studio_raw_inventory',
  'ops_purchases',
  'ops_shipments',
  'store_purchases',
  'store_receipt_claims',
  'property_costs',
  'staff_approvals',
  'staff_attendance',
  'staff_audit_logs',
  'staff_leave_requests',
  'staff_payslips',
  'staff_reimbursements',
  'staff_store_todos',
  'staff_members',
  'honorary_curators',
  'honorary_curator_ops',
  'member_level_adjust_ops',
  'gift_settings',
  'invoice_requests',
  'message_templates',
  'push_campaigns',
  'care_reminder_queue',
  'identification_cache',
  'species_knowledge',
  'species_product_map',
  'store_booking_rules',
  'store_visits',
  'user_addresses',
  'user_atlas',
  'user_behaviors',
  'user_messages',
  'workspace_acl',
  'artisan_commission_ledger',
  'member_pass_tokens',
  'booking_reminders',
  'error_logs',
  'comments'
]

const APPLY_AUTH_READ_NO_WRITE = [
  'analytics_daily',
  'wikis',
  'shipping_rules',
  // 2026-09-15 第六轮：按「文件级作用域 + 完整写 helper（含 cdnSet/cdnUpsertByWhere）+
  // 原生 db.collection(...).update/add/remove + 参数化写路径」四轮排查，确认 ERP 与小程序
  // 均无任何写入路径（仅读取）。此前它们对任意登录（含匿名）用户可写。
  'admin_login_logs',
  'admin_operation_logs',
  'points_rules'
]

/** ERP 仍 CDN 直写/直读；仅版本化，默认不 apply */
const DEFERRED = [
  // 2026-09-15 复核：ERP 「门店积分规则」页用 CDN 直读 fetchCollectionLimit + 直写 cdnUpdate，
  // 收紧为 false 会导致该页读不到规则 → 待 ERP 改走云函数后再 apply
  'store_point_rules',
  'coupons',
  'support_tickets',
  'custom_drafts',
  'home_configs',
  'notification_logs',
  'pet_craft_configs',
  'refunds',
  'stores',
  'store_zones',
  'waitlist'
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
  const byName = {}
  for (let i = 0; i < names.length; i += 15) {
    const chunk = names.slice(i, i + 15)
    const resp = await permission.describeResourcePermission({
      resourceType: 'collection',
      resources: chunk
    })
    const list = (resp && resp.Data && resp.Data.PermissionList) || []
    for (const item of list) {
      byName[item.Resource] = {
        permission: item.Permission,
        securityRule: item.SecurityRule || null,
        securityRuleNormalized: normalizeRuleString(item.SecurityRule)
      }
    }
  }
  return { byName }
}

function desiredMatchesLive(name, live, desiredNorm) {
  if (!live) return false
  const rule = JSON.parse(desiredNorm)
  const isPrivateDesired = rule.read === false && rule.write === false
  if (isPrivateDesired && live.permission === 'PRIVATE') return true
  return live.permission === 'CUSTOM' && live.securityRuleNormalized === desiredNorm
}

async function main() {
  loadDotEnv()
  const secretId = process.env.TCB_SECRET_ID
  const secretKey = process.env.TCB_SECRET_KEY
  if (!secretId || !secretKey) throw new Error('缺少 TCB_SECRET_ID / TCB_SECRET_KEY')

  const COLLECTIONS = [
    ...APPLY_PRIVATE,
    ...APPLY_AUTH_READ_NO_WRITE,
    ...(INCLUDE_DEFERRED ? DEFERRED : [])
  ]

  const CloudBase = require(MANAGER_NODE)
  const app = CloudBase.init({ secretId, secretKey, envId: ENV_ID })
  const { permission } = app

  const desired = {}
  for (const name of COLLECTIONS) desired[name] = loadDesiredRule(name)

  console.log('env=', ENV_ID, DRY_RUN ? '(dry-run)' : '', INCLUDE_DEFERRED ? '(+deferred)' : '')
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
        applyResults.push({
          collection: name,
          success: false,
          note: (e.message || String(e)).slice(0, 200)
        })
        console.error('fail', name, e.message || e)
      }
    }
  }

  await new Promise((r) => setTimeout(r, DRY_RUN ? 0 : 1500))
  const after = await describeCollections(permission, COLLECTIONS)
  const verify = COLLECTIONS.map((name) => {
    const cur = after.byName[name]
    const want = normalizeRuleString(desired[name])
    return {
      collection: name,
      matched: desiredMatchesLive(name, cur, want),
      after: cur || null,
      desiredNormalized: want
    }
  })

  console.log('\n=== AFTER ===')
  verify.forEach((v) => console.log(v.collection, 'matched=', v.matched))

  const out = {
    envId: ENV_ID,
    at: new Date().toISOString(),
    dryRun: DRY_RUN,
    includeDeferred: INCLUDE_DEFERRED,
    deferredNotApplied: INCLUDE_DEFERRED ? [] : DEFERRED,
    desiredRules: Object.fromEntries(COLLECTIONS.map((n) => [n, JSON.parse(desired[n])])),
    beforeLive: before.byName,
    applyResults,
    verify,
    appliedToCloud:
      !DRY_RUN && applyResults.every((r) => r.success) && verify.every((v) => v.matched)
  }
  const outPath = path.join(__dirname, 'configure-recent-collections-security-rules.result.json')
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log('\nresult →', outPath, 'appliedToCloud=', out.appliedToCloud)
  if (!DRY_RUN && !out.appliedToCloud) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
