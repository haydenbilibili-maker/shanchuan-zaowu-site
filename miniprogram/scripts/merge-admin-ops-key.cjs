#!/usr/bin/env node
/**
 * 从已配置成功的云函数（默认 manageStoreContent）复制 ADMIN_OPS_KEY，
 * 合并写入目标运维云函数环境变量（不覆盖其它 env）。
 *
 * 用法：
 *   node scripts/merge-admin-ops-key.cjs
 *   node scripts/merge-admin-ops-key.cjs --dry-run
 *   SOURCE=manageStoreContent node scripts/merge-admin-ops-key.cjs manageBirthdayGift manageDeposit
 */
const fs = require('fs')
const path = require('path')

const ENV_ID = process.env.CLOUDBASE_ENV || 'cloud1-8gnkty5bfff9f0bf'
const SOURCE = process.env.SOURCE || 'manageStoreContent'
const DRY = process.argv.includes('--dry-run')
const ADMIN_ENV = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/admin/.env'
const MANAGER_NODE =
  process.env.MANAGER_NODE ||
  '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/node_modules/@cloudbase/manager-node'

/** Admin 代理白名单内、近期易缺 ADMIN_OPS_KEY 的运维函数 */
const DEFAULT_TARGETS = [
  'manageBirthdayGift',
  'manageDeposit',
  'manageArtisanCommission',
  'manageApprovals',
  'manageLiveSession',
  'manageMemberLevelAdjust',
  'manageInvoiceRequests',
  'manageHonoraryCurators',
  'manageStaff',
  'manageProducts',
  'bindPlatformOrder',
  'claimStoreReceipt',
  'managerShipOrder',
  'refundOrder',
  'getShippingRules',
  'manageStoredValue',
  'moderateComment',
  'assistProductCopy',
  'seedCategories',
  // 2026-09：采购 / 物业 / 出货（飞书同步中心）
  'managePurchaseOrder',
  'managePropertyCost',
  'manageStoreShipment',
]

function loadDotEnv() {
  if (!fs.existsSync(ADMIN_ENV)) return
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

function envListToObject(list) {
  const out = {}
  ;(list || []).forEach((item) => {
    if (item && item.Key) out[item.Key] = item.Value == null ? '' : String(item.Value)
  })
  return out
}

function pickEnv(detail) {
  return envListToObject(
    (detail && detail.Environment && detail.Environment.Variables) ||
      (detail && detail.EnvVariables) ||
      [],
  )
}

async function main() {
  loadDotEnv()
  const secretId = process.env.TCB_SECRET_ID
  const secretKey = process.env.TCB_SECRET_KEY
  if (!secretId || !secretKey) throw new Error('缺少 TCB_SECRET_ID / TCB_SECRET_KEY')

  const CloudBase = require(MANAGER_NODE)
  const app = CloudBase.init({ secretId, secretKey, envId: ENV_ID })

  const argvTargets = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  const targets = argvTargets.length ? argvTargets : DEFAULT_TARGETS

  const sourceDetail = await app.functions.getFunctionDetail(SOURCE)
  const sourceEnv = pickEnv(sourceDetail)
  const opsKey = String(sourceEnv.ADMIN_OPS_KEY || process.env.ADMIN_OPS_KEY || '').trim()
  if (!opsKey) {
    throw new Error(`源函数 ${SOURCE} 与本地 .env 均无 ADMIN_OPS_KEY，无法合并`)
  }

  const results = []
  for (const name of targets) {
    if (name === SOURCE) {
      results.push({ name, status: 'skip_source' })
      continue
    }
    try {
      const detail = await app.functions.getFunctionDetail(name)
      const existing = pickEnv(detail)
      if (existing.ADMIN_OPS_KEY) {
        const same = existing.ADMIN_OPS_KEY === opsKey
        results.push({
          name,
          status: same ? 'already_ok' : 'mismatch_kept',
          keys: Object.keys(existing).sort(),
        })
        continue
      }
      const merged = Object.assign({}, existing, { ADMIN_OPS_KEY: opsKey })
      if (!DRY) {
        await app.functions.updateFunctionConfig({
          name,
          envVariables: merged,
        })
      }
      results.push({
        name,
        status: DRY ? 'would_merge' : 'merged',
        keysBefore: Object.keys(existing).sort(),
        keysAfter: Object.keys(merged).sort(),
      })
    } catch (e) {
      results.push({ name, status: 'error', error: e.message || String(e) })
    }
  }

  const out = {
    envId: ENV_ID,
    source: SOURCE,
    dryRun: DRY,
    at: new Date().toISOString(),
    results,
  }
  const outPath = path.join(__dirname, 'merge-admin-ops-key.result.json')
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log(DRY ? 'dry-run →' : 'ok →', outPath)
  for (const r of results) {
    console.log(`${r.status.padEnd(16)} ${r.name}${r.error ? ' · ' + r.error : ''}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
