#!/usr/bin/env node
/**
 * 读取并应用 products / orders 云开发自定义安全规则
 *
 * 现网能力结论（2026-09-10 实测）：
 * - 支持 CUSTOM 集合级 read/write（及不含 request.data 的 create/update/delete）
 * - 含 request.data 的字段级规则：API Success=true 但不落库（静默拒绝）
 * → 落地为 write:false（仅云函数可写），读权限保持业务可用
 *
 * 环境：cloud1-8gnkty5bfff9f0bf
 * 密钥：shanchuanzaowu/admin/.env 的 TCB_SECRET_*
 *
 * 用法：node scripts/configure-products-orders-security-rules.cjs
 *       node scripts/configure-products-orders-security-rules.cjs --dry-run
 */
const fs = require('fs')
const path = require('path')

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const ADMIN_ENV = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/admin/.env'
const MANAGER_NODE = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/node_modules/@cloudbase/manager-node'
const RULES_DIR = path.join(__dirname, '..', 'database-rules')
const COLLECTIONS = ['products', 'orders']
const DRY_RUN = process.argv.includes('--dry-run')

/** 改前原始开放规则（本任务启动时快照，便于结果文件对照） */
const ORIGINAL_BEFORE_SNAPSHOT = {
  products: {
    permission: 'CUSTOM',
    securityRule: '{\n  "read": true,\n  "write": true\n}',
    securityRuleNormalized: '{"read":true,"write":true}'
  },
  orders: {
    permission: 'CUSTOM',
    securityRule: '{\n  "read": "auth != null",\n  "write": "auth != null"\n}',
    securityRuleNormalized: '{"read":"auth != null","write":"auth != null"}'
  }
}

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

function loadFieldLevelDesired(name) {
  const p = path.join(RULES_DIR, `${name}.field-level.desired.json`)
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, 'utf8'))
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
  const fieldLevelDesired = {}
  for (const name of COLLECTIONS) {
    desired[name] = loadDesiredRule(name)
    fieldLevelDesired[name] = loadFieldLevelDesired(name)
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
          requestId: mod && mod.RequestId,
          note: 'CUSTOM collection-level (write:false)'
        })
        console.log('\napplied', name, 'Success=', ok, 'RequestId=', mod && mod.RequestId)
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
      applyResults.push({
        collection: name,
        op: 'modifyResourcePermission',
        result: 'skipped',
        success: false,
        note: 'dry-run'
      })
    }
  }

  await new Promise((r) => setTimeout(r, DRY_RUN ? 0 : 1200))
  const after = await describeCollections(permission, COLLECTIONS)

  console.log('\n=== AFTER (live) ===')
  const verify = []
  for (const name of COLLECTIONS) {
    const cur = after.byName[name]
    console.log(name, JSON.stringify(cur || null, null, 2))
    const want = normalizeRuleString(desired[name])
    const got = cur && cur.securityRuleNormalized
    const matched = !!(cur && cur.permission === 'CUSTOM' && got === want)
    verify.push({
      collection: name,
      matched,
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
    mode: 'collection-level-write-false',
    goal: {
      products: '客户端不可改 isOffShelf（集合级 write:false 覆盖）',
      orders: '客户端不可改退款态/金额（集合级 write:false 覆盖）'
    },
    originalBeforeSnapshot: ORIGINAL_BEFORE_SNAPSHOT,
    desiredRules: Object.fromEntries(
      COLLECTIONS.map((n) => [n, JSON.parse(desired[n])])
    ),
    fieldLevelDesiredNotApplied: fieldLevelDesired,
    fieldLevelBlocker: {
      observed: 'modifyResourcePermission(Success:true) + describe 不回显含 request.data 的规则',
      implication: '本环境无法用 API 落库字段级锁；已回退集合级 write:false',
      probedAt: '2026-09-10'
    },
    beforeLive: before.byName,
    applyResults,
    after: after.byName,
    verify,
    appliedToCloud: appliedOk && verifiedOk,
    configEchoMatchesDesired: verifiedOk,
    cSideNotes: [
      '商品读列表/详情：可用（products.read=true）',
      '下单：可用（makeOrder 云函数；orders.write=false）',
      '订单读：登录后可用（orders.read=auth!=null）',
      '退款申请/执行：可用（refundOrder 云函数）',
      '确认收货客户端直写 orders：会失败，需迁云函数',
      '店长端商品/订单生产态客户端直写：会失败，需迁云函数'
    ],
    notes: [
      '云函数写不受客户端安全规则限制',
      '字段级愿望稿见 database-rules/*.field-level.desired.json',
      '勿把 Success:true 当作已落库；必须以 describe 回读为准'
    ]
  }

  const outPath = path.join(__dirname, 'configure-products-orders-security-rules.result.json')
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log('\nresult →', outPath)
  console.log('appliedToCloud=', out.appliedToCloud, 'configEchoMatchesDesired=', out.configEchoMatchesDesired)

  if (!DRY_RUN && (!appliedOk || !verifiedOk)) {
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
