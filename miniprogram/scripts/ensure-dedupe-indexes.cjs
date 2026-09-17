#!/usr/bin/env node
/**
 * 幂等唯一索引 provision（默认只预检，--execute 才真的建）
 *
 * 为什么（2026-09-17 全面审计 C2，P0）：
 *   全仓的防重都靠「`xxx.dedupeKey` 上有唯一索引」，但仓库里**没有任何脚本或校验**
 *   负责建这三个索引（`ensure-gift/leave/orders-pay-expire` 三个脚本都不覆盖 dedupeKey）
 *   —— 文档也自认「不建等于没有防重」（miniprogram/docs/门店积分上线操作清单.md:77-85）。
 *   索引没建时，所有「先查再写」的防重都退化成 read-then-write 竞态：
 *   `earnPoints`、`receiveCoupon`、`transferCoupon`、`bindPlatformOrder`、生日礼/门店赠分
 *   都可能重复发放。这是**资损级**问题，不是洁癖。
 *
 * ⚠️ 为什么默认不建：唯一索引**建错会锁死写入**。
 *   MongoDB 的唯一索引把「字段缺失」视为 null，而**只允许一条 null** —— 若历史文档里
 *   大量记录没有 `dedupeKey`，直接建唯一索引要么建不上，要么建上之后**阻断所有新插入**。
 *   所以本脚本默认只跑**预检**并把三个数打出来（总数 / 缺字段数 / 重复键数），
 *   只有显式 `--execute` 且在预检通过（或缺字段=0、重复=0）时才创建。
 *
 * 用法：
 *   node miniprogram/scripts/ensure-dedupe-indexes.cjs                # 只预检
 *   node miniprogram/scripts/ensure-dedupe-indexes.cjs --execute      # 预检通过后创建
 *   node miniprogram/scripts/ensure-dedupe-indexes.cjs --json         # 预检结果输出 JSON
 *
 * 密钥：admin/.env 的 TCB_SECRET_ID / TCB_SECRET_KEY（与其它 provision 脚本同源）
 * 说明：腾讯云管理端 API 的部分返回结构文档不全，本脚本对「读不懂的返回」**一律拒绝创建**
 *       （宁可让人工去控制台确认，也不盲建唯一索引）。
 */
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'

/**
 * 需要唯一索引的幂等键。
 *
 * 新增任何 `dedupeKey` 写入点时**必须**在这里登记（守卫 `check:dedupe-index-coverage` 会拦）。
 * 实测写入点（2026-09-17，逐行核对 `^\s*dedupeKey\s*[,:]` 且排除 `X.dedupeKey` 读取）：
 *   point_records          bindPlatformOrder:343 / claimBirthdayGift:269 / claimStoreReceipt:412
 *                          / exchangeCoupon:141 / grantStorePoints:448,940,1326
 *                          / redeemReward:118 / refundOrder:323 / upsertUserProfile:385,559
 *   store_purchases        grantStorePoints:615
 *   platform_order_binds   bindPlatformOrder:139
 *   user_messages          toggleCollection:65          （authPhone 只读它做查重）
 *   store_coupon_redeems   verifyStoreCoupon:524
 *
 * ⚠️ 历史数据里 `point_records` 等集合**很可能有大量文档没有 dedupeKey** —— 此时直接建唯一索引
 * 要么建不上，要么建完阻断新写入（MongoDB 把缺失当 null，只允许一条）。所以本脚本默认只预检。
 */
const SPECS = [
  {
    collection: 'point_records',
    field: 'dedupeKey',
    indexName: 'dedupeKey_1',
    reason: '积分/成长值台账防重（生日礼、门店小票、门店赠分、订单退款冲销、兑换、平台单绑定）',
    usedBy: ['bindPlatformOrder', 'claimBirthdayGift', 'claimStoreReceipt', 'exchangeCoupon', 'grantStorePoints', 'redeemReward', 'refundOrder', 'upsertUserProfile'],
  },
  {
    collection: 'store_purchases',
    field: 'dedupeKey',
    indexName: 'dedupeKey_1',
    reason: '门店消费入账防重',
    usedBy: ['grantStorePoints'],
  },
  {
    collection: 'platform_order_binds',
    field: 'dedupeKey',
    indexName: 'dedupeKey_1',
    reason: '外部平台订单绑定防重（bindPlatformOrder 注释即写明依赖 dedupeKey_1）',
    usedBy: ['bindPlatformOrder'],
  },
  {
    collection: 'user_messages',
    field: 'dedupeKey',
    indexName: 'dedupeKey_1',
    reason: '站内信/到货提醒防重（toggleCollection 写入；authPhone 以它查重）',
    usedBy: ['toggleCollection'],
  },
  {
    collection: 'store_coupon_redeems',
    field: 'dedupeKey',
    indexName: 'dedupeKey_1',
    reason: '门店券核销防重（客户端带 clientRequestId）',
    usedBy: ['verifyStoreCoupon'],
  },
]

module.exports = { SPECS, ENV_ID }

function loadDotEnv() {
  const candidates = [
    path.join(ROOT, 'admin', '.env'),
    path.join(ROOT, 'admin', '.env.local'),
  ]
  let loaded = 0
  for (const f of candidates) {
    if (!fs.existsSync(f)) continue
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i <= 0) continue
      const k = t.slice(0, i).trim()
      let v = t.slice(i + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (!process.env[k]) process.env[k] = v
    }
    loaded += 1
  }
  return loaded
}

function normalizeIndex(idx) {
  const keys = idx.Keys || (idx.MgoKeySchema && idx.MgoKeySchema.MgoIndexKeys) || []
  return {
    name: idx.Name || idx.name,
    keys: keys.map((k) => ({ name: k.Name || k.name, direction: String(k.Direction || k.direction || '') })),
    unique: !!(idx.Unique || (idx.MgoKeySchema && idx.MgoKeySchema.MgoIsUnique)),
  }
}

/** 从 runCommands 的返回里尽力取数值；取不到返回 null（**不猜**） */
function pickCount(res) {
  const dig = (v) => {
    if (v == null) return null
    if (typeof v === 'number') return v
    if (Array.isArray(v)) {
      for (const it of v) { const r = dig(it); if (r != null) return r }
      return null
    }
    if (typeof v === 'object') {
      for (const k of ['n', 'count', 'Count', 'total', 'Total']) {
        if (typeof v[k] === 'number') return v[k]
      }
      for (const k of ['Data', 'data', 'Results', 'results', 'Result', 'result', 'MgoResults']) {
        const r = dig(v[k]); if (r != null) return r
      }
    }
    return null
  }
  return dig(res)
}

async function preflight(database, spec) {
  const out = { collection: spec.collection, exists: false, missingField: null, duplicateKeys: null, samples: [] }
  try {
    const desc = await database.describeCollection(spec.collection)
    out.exists = true
    out.indexes = (desc.Indexes || []).map(normalizeIndex)
    out.hasUniqueDedupe = out.indexes.some((i) => i.unique && i.keys.length === 1 && i.keys[0].name === spec.field)
  } catch (e) {
    out.exists = false
    out.error = (e && e.message) || String(e)
    return out
  }

  // 缺字段数：唯一索引把缺失视为 null，只允许一条 → 必须为 0
  try {
    const r = await database.runCommands({
      MgoCommands: [{ count: spec.collection, query: { [spec.field]: { $exists: false } } }],
    })
    out.missingField = pickCount(r)
  } catch (e) {
    out.missingField = null
    out.countError = (e && e.message) || String(e)
  }

  // 重复键（取前几个样本）
  try {
    const r = await database.runCommands({
      MgoCommands: [{
        aggregate: spec.collection,
        pipeline: [
          { $match: { [spec.field]: { $exists: true, $ne: null } } },
          { $group: { _id: `$${spec.field}`, n: { $sum: 1 } } },
          { $match: { n: { $gt: 1 } } },
          { $limit: 5 },
        ],
        cursor: {},
      }],
    })
    const found = []
    const walk = (v) => {
      if (!v) return
      if (Array.isArray(v)) { v.forEach(walk); return }
      if (typeof v === 'object') {
        if (v._id !== undefined && typeof v.n === 'number') found.push({ key: String(v._id), n: v.n })
        for (const k of ['Data', 'data', 'Results', 'results', 'Result', 'result', 'cursor', 'firstBatch']) walk(v[k])
      }
    }
    walk(r)
    out.samples = found
    out.duplicateKeys = found.length ? found.length : 0
  } catch (e) {
    out.duplicateKeys = null
    out.dupError = (e && e.message) || String(e)
  }
  return out
}

async function main() {
  const argv = process.argv.slice(2)
  const execute = argv.includes('--execute')
  const asJson = argv.includes('--json')

  if (!loadDotEnv()) {
    console.error('✗ 未找到 admin/.env 或 admin/.env.local（需要 TCB_SECRET_ID / TCB_SECRET_KEY）')
    process.exit(2)
  }
  const secretId = process.env.TCB_SECRET_ID
  const secretKey = process.env.TCB_SECRET_KEY
  if (!secretId || !secretKey) {
    console.error('✗ 缺少 TCB_SECRET_ID / TCB_SECRET_KEY')
    process.exit(2)
  }

  let CloudBase
  try {
    CloudBase = require(path.join(ROOT, 'node_modules', '@cloudbase', 'manager-node'))
  } catch (e) {
    console.error('✗ 未安装 @cloudbase/manager-node（应在 admin devDependencies 里）：', e.message)
    process.exit(2)
  }
  const app = CloudBase.init({ secretId, secretKey, envId: ENV_ID })
  const { database } = app

  const reports = []
  for (const spec of SPECS) {
    reports.push({ spec, pre: await preflight(database, spec) })
  }

  if (asJson) {
    console.log(JSON.stringify(reports.map((r) => ({ ...r.spec, pre: r.pre })), null, 2))
  } else {
    console.log(`env=${ENV_ID}  模式=${execute ? 'EXECUTE' : '预检（不写库）'}\n`)
    for (const { spec, pre } of reports) {
      console.log(`── ${spec.collection}.${spec.field}（${spec.indexName}）`)
      console.log(`   用途：${spec.reason}`)
      console.log(`   使用方：${spec.usedBy.join(', ')}`)
      if (!pre.exists) {
        console.log(`   ✗ 集合不存在或读不到：${pre.error || ''}`)
        continue
      }
      console.log(`   已有唯一幂等索引：${pre.hasUniqueDedupe ? '是' : '否'}`)
      console.log(`   缺 ${spec.field} 的文档数：${pre.missingField === null ? '读不到（' + (pre.countError || '') + '）' : pre.missingField}`)
      console.log(`   重复键样本：${pre.duplicateKeys === null ? '读不到（' + (pre.dupError || '') + '）' : (pre.samples.length ? pre.samples.map((s) => `${s.key}×${s.n}`).join(', ') : '无')}`)
    }
    console.log('\n判据：**缺字段数必须为 0 且无重复键** 才能建唯一索引')
    console.log('（唯一索引把缺失当 null，只允许一条 null —— 否则建不上或建完阻断写入）')
  }

  if (!execute) {
    console.log('\n这是预检。确认上面两项为 0 后，用 --execute 创建。')
    return
  }

  let fail = 0
  for (const { spec, pre } of reports) {
    if (!pre.exists) { console.error(`✗ ${spec.collection}：集合不存在，跳过`); fail += 1; continue }
    if (pre.hasUniqueDedupe) { console.log(`✓ ${spec.collection}：唯一幂等索引已存在，跳过`); continue }
    if (pre.missingField !== 0 || pre.duplicateKeys !== 0) {
      console.error(`✗ ${spec.collection}：预检未通过（缺字段=${pre.missingField} 重复=${pre.duplicateKeys}）`)
      console.error('   拒绝创建 —— 请先在控制台补齐 dedupeKey / 清理重复，或在控制台确认该集合的历史数据情况。')
      fail += 1
      continue
    }
    try {
      await database.updateCollection(spec.collection, {
        CreateIndexes: [{
          IndexName: spec.indexName,
          MgoKeySchema: {
            MgoIsUnique: true,
            MgoIndexKeys: [{ Name: spec.field, Direction: '1' }],
          },
        }],
      })
      console.log(`✓ ${spec.collection}：已提交创建 ${spec.indexName}（唯一）`)
    } catch (e) {
      const msg = (e && e.message) || String(e)
      if (/exist|已存在|already|Duplicate/i.test(msg)) {
        console.log(`✓ ${spec.collection}：索引已存在（服务端回报）`)
      } else {
        console.error(`✗ ${spec.collection}：创建失败 ${msg.slice(0, 200)}`)
        fail += 1
      }
    }
  }

  // 复核
  console.log('\n复核：')
  for (const { spec } of reports) {
    try {
      const { Exists } = await database.checkIndexExists(spec.collection, spec.indexName)
      console.log(`  ${Exists ? '✓' : '⏳'} ${spec.collection}.${spec.indexName} ${Exists ? '已存在' : '尚未出现（可能仍在构建，稍后控制台可见）'}`)
    } catch (e) {
      console.log(`  ? ${spec.collection}: 无法复核（${(e && e.message) || e}）`)
    }
  }
  if (fail) process.exitCode = 1
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
