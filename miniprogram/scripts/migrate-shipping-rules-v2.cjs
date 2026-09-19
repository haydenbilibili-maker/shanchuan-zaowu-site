#!/usr/bin/env node
/**
 * shipping_rules 云端文档迁移到 **v2（按装裱方式收费）**
 *
 * 为什么必须单独有这一步：本系统的规则是「代码默认值 + **云端覆盖** + 异常降级」。
 * 只改代码而不改云端文档时，**云端赢 → 代码改动一点都不会生效**
 * （2026-09-19 上一轮就是这么白改一轮的：云端仍是 accessoryFreeThreshold 98 /
 *  specimenFreeThreshold 298，而 `node --check` / build / 门禁全绿都发现不了）。
 *
 * 本脚本做三件事，且**幂等**（重复跑结果一样）：
 *   1. 读线上 active 文档，打印**改前**关键字段
 *   2. `$set` 新口径字段（freeShippingThreshold 299 / chargedCraftTypes 四项 /
 *      flatFee 18 / 旧字段镜像 accessoryFreeThreshold 0、specimenFreeThreshold 299）
 *   3. 读回并打印**改后**关键字段
 *
 * 用法：
 *   node miniprogram/scripts/migrate-shipping-rules-v2.cjs --dry-run   # 只看改前/计划
 *   node miniprogram/scripts/migrate-shipping-rules-v2.cjs             # 真写
 *
 * 权限：直连 CloudBase（admin/.env 的 TCB_SECRET_* + 已登录的 tcb CLI）。
 * 口径：admin/docs/出货算价与工作室结算_Phase1_技术蓝图.md §19
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const ENV_ID = process.env.CLOUD_ENV || 'cloud1-8gnkty5bfff9f0bf'
const COLLECTION = 'shipping_rules'
const ADMIN_ENV = path.join(ROOT, 'admin', '.env')

/** v2 目标状态（与 miniprogram/config/shipping.js、makeOrder/shipping.js、getShippingRules/defaults.js 一致） */
const TARGET = {
  ruleId: 'shipping_default_v2',
  defaultCarrier: '顺丰速运',
  flatFee: 18,
  freeShippingThreshold: 299,
  chargedCraftTypes: ['frame', 'cloche', 'cloche_round', 'cloche_cylinder'],
  // 旧字段镜像：getProductCoupons / getBestCoupon 的读取链更偏好这些字段，必须同值，
  // 否则「免邮券可省金额」会用旧门槛
  accessoryFreeThreshold: 0,
  specimenFreeThreshold: 299,
  mixCartStrategy: 'specimen_wins'
}

const KEY_FIELDS = [
  'ruleId',
  'defaultCarrier',
  'flatFee',
  'freeShippingThreshold',
  'chargedCraftTypes',
  'accessoryFreeThreshold',
  'specimenFreeThreshold',
  'mixCartStrategy'
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

function unwrapMongo(v) {
  if (v == null || typeof v !== 'object') return v
  if ('$numberInt' in v) return Number(v.$numberInt)
  if ('$numberLong' in v) return Number(v.$numberLong)
  if ('$numberDouble' in v) return Number(v.$numberDouble)
  if ('$oid' in v) return v.$oid
  if (Array.isArray(v)) return v.map(unwrapMongo)
  const out = {}
  for (const [k, val] of Object.entries(v)) out[k] = unwrapMongo(val)
  return out
}

function tcbExecute(commands) {
  const cmd = JSON.stringify(commands)
  const res = spawnSync('tcb', ['db', 'nosql', 'execute', '-e', ENV_ID, '--json', '--command', cmd], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: process.env
  })
  const out = (res.stdout || '') + (res.stderr || '')
  if (res.status !== 0) throw new Error(`tcb exit ${res.status}: ${out.slice(0, 800)}`)
  const i = out.indexOf('{')
  if (i < 0) throw new Error('tcb 无 JSON 输出：' + out.slice(0, 300))
  const parsed = JSON.parse(out.slice(i))
  const data = parsed.data || parsed
  return data.results || []
}

function rowsOf(results) {
  return results.map((p) => (Array.isArray(p) ? p : (p && p.data) || []))
}

function findActiveDoc() {
  const results = tcbExecute([
    {
      TableName: COLLECTION,
      CommandType: 'COMMAND',
      Command: JSON.stringify({ find: COLLECTION, filter: { status: 'active' }, limit: 5 })
    }
  ])
  const list = rowsOf(results)[0].map(unwrapMongo)
  if (!list.length) throw new Error('线上 shipping_rules 没有 active 文档 —— 请先在超管工作台保存一次')
  list.sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
  return list[0]
}

function keyView(doc) {
  const out = {}
  KEY_FIELDS.forEach((k) => { out[k] = doc[k] })
  return out
}

function printKeyView(title, doc) {
  console.log(`—— ${title} ——`)
  console.log(JSON.stringify(keyView(doc), null, 2))
}

function main() {
  const dryRun = process.argv.includes('--dry-run')
  loadDotEnv()

  const before = findActiveDoc()
  printKeyView('改前（线上实测）', before)

  const missing = KEY_FIELDS.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(TARGET[k]))
  console.log('\n需要变更的字段：', missing.length ? missing.join(', ') : '（无，已是 v2）')
  if (dryRun) {
    console.log('\n（--dry-run，未写入）目标值：')
    console.log(JSON.stringify(TARGET, null, 2))
    return
  }
  if (!missing.length) {
    console.log('\n✓ 无需写入')
    return
  }

  const results = tcbExecute([
    {
      TableName: COLLECTION,
      CommandType: 'UPDATE',
      Command: JSON.stringify({
        update: COLLECTION,
        updates: [{
          q: { _id: before._id },
          u: {
            $set: {
              ...TARGET,
              updateTime: Date.now(),
              updatedBy: 'shipping-rules-v2-migration'
            }
          },
          multi: false,
          upsert: false
        }]
      })
    }
  ])
  console.log('\n写入结果：', JSON.stringify(unwrapMongo((rowsOf(results)[0] || [])[0] || {})))

  const after = findActiveDoc()
  printKeyView('改后（云端读回）', after)

  const bad = KEY_FIELDS.filter((k) => JSON.stringify(after[k]) !== JSON.stringify(TARGET[k]))
  if (bad.length) {
    console.error('\n✗ 读回校验失败，字段仍不一致：' + bad.join(', '))
    process.exit(1)
  }
  console.log('\n✓ 云端文档已是 v2，读回校验通过')
  console.log('下一步：node miniprogram/scripts/check-shipping-rules.cjs --update-snapshot（刷新仓库快照）')
}

try {
  main()
} catch (e) {
  console.error('迁移失败：' + (e.message || e))
  process.exit(1)
}
