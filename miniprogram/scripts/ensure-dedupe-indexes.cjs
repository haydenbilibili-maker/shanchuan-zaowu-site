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
 *   node miniprogram/scripts/check-dedupe-index-live.mjs              # 只读预检（复用本文件的 preflight，只查不建）
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
 * 实测写入点（2026-09-18 修订：**递归**扫云函数目录下全部 `*.js`，不再只看 `index.js`；
 * 判据仍是 `^\s*dedupeKey\s*[,:]` 且排除 `X.dedupeKey` 读取）：
 *   point_records          bindPlatformOrder:343 / claimBirthdayGift:269 / claimStoreReceipt:412
 *                          / exchangeCoupon:141 / grantStorePoints:448,940,1326
 *                          / redeemReward:118 / refundOrder:323 / upsertUserProfile:385,559
 *                          / **manageStoredValue: rechargeRewards.js:98（充值返积分）**
 *                          / **payCallback: rechargeRewards.js:98（支付回调 → 充值返积分，payCallback 内的副本）**
 *   store_purchases        grantStorePoints:615
 *   platform_order_binds   bindPlatformOrder:139
 *   user_messages          每个云函数自带的 inAppMessage.js / messageWrite.js / dispatchMessage core.js
 *                          **共 24 个函数**（原先只登记了 toggleCollection —— 判据只扫 index.js 时看不见这些）
 *   store_coupon_redeems   verifyStoreCoupon:524
 *
 * ⚠️ 已发现但**尚未 provision**（不在 SPECS 里，属显式待办，见守卫输出）：
 *   artisan_commission_ledger  师傅分账流水防重，4 份副本各自写入：
 *                              confirmPayment|payCallback|refundOrder 的 artisanCommission.js:670,789
 *                              + manageArtisanCommission/commissionCore.js:670,789
 *                              （同文件 `posted.push({ dedupeKey })` 是回显，不是写库）
 *   notification_logs          dispatchMessage/core.js:120（**该副本的 notification_logs 文档带 dedupeKey**；
 *                              其它 inAppMessage.js 的 notification_logs 写入不带，故只此一处）
 *   是否给这两个集合建唯一索引需产品负责人拍板（裁决 §6 步骤 2 未包含它们）。
 *
 * ⚠️ 历史数据里 `point_records` 等集合**很可能有大量文档没有 dedupeKey** —— 此时直接建唯一索引
 * 要么建不上，要么建完阻断新写入（MongoDB 把缺失当 null，只允许一条）。所以本脚本默认只预检。
 */
const SPECS = [
  {
    collection: 'point_records',
    field: 'dedupeKey',
    indexName: 'dedupeKey_1',
    reason: '积分/成长值台账防重（生日礼、门店小票、门店赠分、订单退款冲销、兑换、平台单绑定、充值返积分）',
    usedBy: ['bindPlatformOrder', 'claimBirthdayGift', 'claimStoreReceipt', 'exchangeCoupon', 'grantStorePoints', 'manageStoredValue', 'payCallback', 'redeemReward', 'refundOrder', 'upsertUserProfile'],
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
    reason: '站内信/到货提醒防重（24 个云函数各自的 inAppMessage.js / messageWrite.js / dispatchMessage core.js 写入；authPhone 以它查重）',
    usedBy: [
      'authPhone', 'bindPlatformOrder', 'cancelOrder', 'claimBirthdayGift', 'claimStoreReceipt',
      'confirmOrderReceipt', 'confirmPayment', 'createBooking', 'dispatchMessage', 'exchangeCoupon',
      'grantStorePoints', 'makeOrder', 'manageApprovals', 'manageGift', 'manageHonoraryCurators',
      'manageInvoiceRequests', 'managerShipOrder', 'payCallback', 'refundOrder', 'submitCustomInquiry',
      'submitInvoiceRequest', 'submitSupportTicket', 'sweepExpiredOrders', 'toggleCollection',
    ],
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
    // Sparse 决定「缺字段的文档会不会占唯一槽位」——实测线上 point_records.dedupeKey_1 就是 Sparse=true
    sparse: !!(idx.Sparse || (idx.MgoKeySchema && idx.MgoKeySchema.MgoIsSparse)),
  }
}

/**
 * runCommands 的返回是 `Data: string[]`，元素是「JSON 字符串里再套 JSON 字符串」（实测 2026-09-18），
 * 且数值是 MongoDB Extended JSON（`{ $numberInt: "48" }`）。这里逐层解开并拍平成对象数组。
 */
function parseMgoData(res) {
  const out = []
  const push = (v, depth = 0) => {
    if (v == null || depth > 4) return
    if (Array.isArray(v)) { v.forEach((x) => push(x, depth + 1)); return }
    if (typeof v === 'string') {
      const t = v.trim()
      if (!t) return
      try { push(JSON.parse(t), depth + 1) } catch (e) { /* 非 JSON 字符串：忽略 */ }
      return
    }
    if (typeof v === 'object') out.push(v)
  }
  push(res && res.Data)
  return out
}

/** Extended JSON / 数字 / 数字字符串 → number；取不到返回 null（**不猜**） */
function numOf(v) {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') return /^-?\d+$/.test(v.trim()) ? Number(v.trim()) : null
  if (typeof v === 'object') {
    for (const k of ['$numberInt', '$numberLong', '$numberDouble', '$numberDecimal']) {
      if (v[k] != null) return numOf(v[k])
    }
  }
  return null
}

/**
 * 执行一条**只读** MongoDB 命令（count / aggregate）。
 *
 * ⚠️ 2026-09-18 修：旧实现写的是 `{ MgoCommands: [{ count: … }] }` —— **这个形状服务端不认**
 *    （实测报 `The parameter MgoCommands.0.count is not recognized`），于是
 *    「缺字段数 / 重复键样本」这两个数字**从来没真正取到过**（一直是「读不到」）。
 *    正确形状（manager-node `types/database/index.d.ts:19-26` + 实测）：
 *      `{ TableName, CommandType: 'COMMAND', Command: <JSON 字符串> }`，`count`/`aggregate` 放在 Command 里。
 *    本函数只发读命令，没有写入路径。
 */
async function runMgo(database, collection, command) {
  const r = await database.runCommands({
    MgoCommands: [{ TableName: collection, CommandType: 'COMMAND', Command: JSON.stringify(command) }],
  })
  return parseMgoData(r)
}

async function preflight(database, spec) {
  const out = { collection: spec.collection, exists: false, missingField: null, duplicateKeys: null, samples: [] }
  try {
    const desc = await database.describeCollection(spec.collection)
    out.exists = true
    out.indexes = (desc.Indexes || []).map(normalizeIndex)
    const uni = out.indexes.find((i) => i.unique && i.keys.length === 1 && i.keys[0].name === spec.field)
    out.hasUniqueDedupe = !!uni
    out.dedupeIndexSparse = uni ? uni.sparse : null
  } catch (e) {
    out.exists = false
    out.error = (e && e.message) || String(e)
    return out
  }

  // 缺字段数：唯一索引把缺失视为 null，只允许一条 → 必须为 0
  try {
    const docs = await runMgo(database, spec.collection, {
      count: spec.collection,
      query: { [spec.field]: { $exists: false } },
    })
    const hit = docs.find((d) => d && d.n != null)
    out.missingField = hit ? numOf(hit.n) : null
    if (out.missingField === null) out.countError = `返回读不懂：${JSON.stringify(docs).slice(0, 160)}`
  } catch (e) {
    out.missingField = null
    out.countError = (e && e.message) || String(e)
  }

  // 重复键（取前几个样本）
  try {
    const docs = await runMgo(database, spec.collection, {
      aggregate: spec.collection,
      pipeline: [
        { $match: { [spec.field]: { $exists: true, $ne: null } } },
        { $group: { _id: `$${spec.field}`, n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } },
        { $limit: 5 },
      ],
      cursor: {},
    })
    const found = docs
      .filter((d) => d && d._id !== undefined && d.n != null)
      .map((d) => ({ key: String(d._id), n: numOf(d.n) }))
    out.samples = found
    out.duplicateKeys = found.length
  } catch (e) {
    out.duplicateKeys = null
    out.dupError = (e && e.message) || String(e)
  }

  // 重复键的**确切组数**（样本列表被 $limit 5 截断，真实值可能更大 → 单独数一次，不靠样本推断）
  try {
    const grp = await runMgo(database, spec.collection, {
      aggregate: spec.collection,
      pipeline: [
        { $match: { [spec.field]: { $exists: true, $ne: null } } },
        { $group: { _id: `$${spec.field}`, n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } },
        { $count: 'total' },
      ],
      cursor: {},
    })
    const hit = grp.find((d) => d && d.total != null)
    out.duplicateGroupCount = hit ? numOf(hit.total) : 0
  } catch (e) {
    out.duplicateGroupCount = null
    out.dupCountError = (e && e.message) || String(e)
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
      console.log(`   已有唯一幂等索引：${pre.hasUniqueDedupe ? `是（Sparse=${pre.dedupeIndexSparse === true ? '是' : pre.dedupeIndexSparse === false ? '否' : '未知'}）` : '否'}`)
      console.log(`   缺 ${spec.field} 的文档数：${pre.missingField === null ? '读不到（' + (pre.countError || '') + '）' : pre.missingField}`)
      console.log(`   重复键：${pre.duplicateKeys === null ? '读不到（' + (pre.dupError || '') + '）' : `样本 ${pre.samples.length ? pre.samples.map((s) => `${s.key}×${s.n}`).join(', ') : '无'}；确切重复组数 ${pre.duplicateGroupCount === null ? '读不到' : pre.duplicateGroupCount}`}`)
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

// 供**只读**预检脚本 `check-dedupe-index-live.mjs` 复用（同一个预检实现，避免两套判据漂移）。
// 只导出函数，不改变本脚本默认行为（默认仍是「只预检」，--execute 才写库）。
module.exports.loadDotEnv = loadDotEnv
module.exports.normalizeIndex = normalizeIndex
module.exports.parseMgoData = parseMgoData
module.exports.numOf = numOf
module.exports.preflight = preflight
