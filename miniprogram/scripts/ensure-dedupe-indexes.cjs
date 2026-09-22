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
 * 2026-09-18 第二轮（集成官裁决：补 spec 让 `check:dedupe-index-coverage` 真绿）新增三个集合：
 *   artisan_commission_ledger  dedupeKey，4 个函数各自一份**逐字节相同**的副本
 *                              （sha256 b5715c25…：confirmPayment|payCallback|refundOrder 的
 *                              artisanCommission.js + manageArtisanCommission/commissionCore.js；
 *                              写入点 :670 与 :789，同文件 `posted.push({ dedupeKey })` 是回显不是写库）
 *   notification_logs          dedupeKey，只有 dispatchMessage/core.js:120 那份副本写它
 *                              （其它 inAppMessage.js 的 notification_logs 文档不带 dedupeKey）
 *   stored_value_ledgers       **idempotencyKey**（字段名不同！）钱包储值账本回账防重，两个写入方：
 *                              `manageStoredValue/account.js`（835 行，全量：recharge: / recharge_bonus:
 *                              / order_pay:<orderId>:<attempt> / order_pay_refund:<oid>:<attempt>
 *                              / order_refund_credit:<oid>）与
 *                              `payCallback/storedValueCredit.js`（412 行，**是前者的裁剪副本**：
 *                              只含 recharge: / recharge_bonus:，require 的 collections 模块名也不同）
 *
 * ⚠️ 历史数据里 `point_records` 等集合**可能有大量文档没有 dedupeKey**。是否阻断建索引取决于
 *    **Sparse**（实测线上 point_records.dedupeKey_1 就是 Sparse=true → 缺字段不占唯一槽位）：
 *    · 非 Sparse 唯一索引：缺失字段视作 null，**只允许一条** → 缺字段数必须为 0；
 *    · Sparse 唯一索引：缺字段的文档不进索引 → 缺字段数随意，但**重复键照样阻断**。
 *    所以 `sparse: true` 的 spec（point_records / notification_logs）由持凭据者在**控制台**建：
 *    本脚本的 SDK 没有声明 Sparse 参数，**不猜**（宁可拒绝自动建，也不盲建一个语义不同的索引）。
 */
const SPECS = [
  {
    collection: 'point_records',
    field: 'dedupeKey',
    indexName: 'dedupeKey_1',
    // 实测线上该索引 Sparse=true（缺字段文档 48 篇却不阻断）→ 把既有事实写进 spec，供预检比对
    sparse: true,
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
    /* ⚠️ 2026-09-21 查清：**这里不能建唯一索引** —— 同一个 dedupeKey 在本集合是**允许重复出现**的，
       因为两种去重语义并存：
         · **永久去重**：`toggleCollection/index.js:41`（查到同键就 skip，**不看时间**）等；
         · **24h 窗去重**：`dispatchMessage/core.js`（`DEDUPE_HOURS = 24`）与
           **`payCallback/inAppMessage.js:167`**（`Date.now() - createTime < 24h` 才 skip）——
           只压 24 小时内的重复，跨天再发生同一事件**有意再发一次**
           （例：顾客隔几天再进店，应该再谢一次）。
       ⚠️ P2-14 订正（2026-09-21）：`229d94f` 的注释把 **`payCallback·inAppMessage` 说成"永久去重"** ——
          与代码不符（实测它是 **<24h 窗**，依据就是上面那行 `:167` 的时间比较）。结论方向（只建普通索引）
          不变，但那句错误依据会被后续班次照抄，故在此订正。
       实测佐证：`store_visit_thanks:store_x:openid` 在 2026-05-24 / 05-27 / 08-15 各有一条。
       所以唯一索引不仅建不起来（现存 9 组重复），**还会把正常写入打成失败**。
       这里只建**普通索引**（供 `where({dedupeKey})` 点查走索引），唯一性交给各写入方自己的判据。 */
    nonUnique: true,
    nonUniqueReason: '同一 dedupeKey 跨时间窗可再次写入（dispatchMessage 的 24h 窗去重），唯一索引会打断正常的再次到店感谢',
    reason: '站内信/到货提醒防重（24 个云函数各自的 inAppMessage.js / messageWrite.js / dispatchMessage core.js 写入；authPhone 以它查重）——**普通索引**，见 nonUniqueReason',
    usedBy: [
      'authPhone', 'bindPlatformOrder', 'cancelOrder', 'claimBirthdayGift', 'claimStoreReceipt',
      'confirmOrderReceipt', 'confirmPayment', 'createBooking', 'dailyDigest', 'dispatchMessage',
      'exchangeCoupon', 'grantStorePoints', 'makeOrder', 'manageApprovals', 'manageGift',
      'manageHonoraryCurators', 'manageInvoiceRequests', 'managerShipOrder', 'payCallback',
      'refundOrder', 'submitCustomInquiry', 'submitInvoiceRequest', 'submitSupportTicket',
      'sweepExpiredOrders', 'toggleCollection',
    ],
  },
  {
    collection: 'store_coupon_redeems',
    field: 'dedupeKey',
    indexName: 'dedupeKey_1',
    reason: '门店券核销防重（客户端带 clientRequestId）',
    usedBy: ['verifyStoreCoupon'],
  },
  {
    collection: 'artisan_commission_ledger',
    field: 'dedupeKey',
    indexName: 'dedupeKey_1',
    reason: '师傅分账流水防重（4 份逐字节相同副本：confirmPayment|payCallback|refundOrder 的 artisanCommission.js + manageArtisanCommission/commissionCore.js）',
    usedBy: ['confirmPayment', 'manageArtisanCommission', 'payCallback', 'refundOrder'],
  },
  {
    collection: 'notification_logs',
    field: 'dedupeKey',
    indexName: 'dedupeKey_1',
    // 实测 112 篇历史文档没有 dedupeKey（只有 dispatchMessage 的活动信带 key）→ 必须 Sparse
    sparse: true,
    reason: '站内信**投递台账**防重（仅 dispatchMessage/core.js:120 写入 dedupeKey；大量历史文档无该字段 → 只能建 Sparse 唯一索引）',
    usedBy: ['dispatchMessage'],
  },
  {
    collection: 'stored_value_ledgers',
    field: 'idempotencyKey',
    indexName: 'idempotencyKey_1',
    reason: '钱包储值账本回账防重（充值 recharge: / 赠送 recharge_bonus: / 订单支付 order_pay:<orderId>:<attempt> / 支付失败回账 order_pay_refund / 订单退款回账 order_refund_credit）',
    usedBy: ['manageStoredValue', 'payCallback'],
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
    // 字段上的**任意**单键索引（唯一与否）—— nonUnique spec 的正确期望就是普通索引，
    // 消费者（check-dedupe-index-live）必须能区分"没有索引"与"索引在但不是唯一"。
    const onField = out.indexes.find((i) => i.keys.length === 1 && i.keys[0].name === spec.field)
    const uni = out.indexes.find((i) => i.unique && i.keys.length === 1 && i.keys[0].name === spec.field)
    out.hasDedupeIndex = !!onField
    out.dedupeIndexUnique = onField ? onField.unique : null
    out.hasUniqueDedupe = !!uni
    out.dedupeIndexSparse = uni ? uni.sparse : (onField ? onField.sparse : null)
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

  // 判据是「凭据在不在」，不是「.env 文件在不在」——
  // worktree 常常没有 admin/.env（被 gitignore，不随 worktree 复制），
  // 此时只要环境变量里有 TCB_SECRET_* 就应该能跑（否则被迫只能去主库跑，容易踩到别人的工作区）。
  const envFiles = loadDotEnv()
  const secretId = process.env.TCB_SECRET_ID
  const secretKey = process.env.TCB_SECRET_KEY
  if (!secretId || !secretKey) {
    console.error(`✗ 缺少 TCB_SECRET_ID / TCB_SECRET_KEY${envFiles ? '' : '（未找到 admin/.env 或 admin/.env.local，环境变量里也没有）'}`)
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
      const wantKind = spec.nonUnique ? '普通（非唯一）' : '唯一'
      const gotKind = pre.hasDedupeIndex ? (pre.dedupeIndexUnique ? '唯一' : '普通（非唯一）') : '无'
      console.log(`   期望 / 线上幂等索引：${wantKind} / ${gotKind}${pre.hasDedupeIndex ? `（Sparse=${pre.dedupeIndexSparse === true ? '是' : pre.dedupeIndexSparse === false ? '否' : '未知'}）` : ''}`)
      if (spec.sparse && pre.hasUniqueDedupe && pre.dedupeIndexSparse === false) {
        console.log('   ⚠️ Sparse 不一致：spec 期望 Sparse 唯一索引，线上这一条**不是** Sparse')
      }
      if (spec.nonUnique && pre.dedupeIndexUnique === true) {
        console.log('   ⚠️ 唯一性相反：spec 期望普通索引（跨时间窗允许重复），线上却是唯一索引')
      }
      console.log(`   缺 ${spec.field} 的文档数：${pre.missingField === null ? '读不到（' + (pre.countError || '') + '）' : pre.missingField}`)
      console.log(`   重复键：${pre.duplicateKeys === null ? '读不到（' + (pre.dupError || '') + '）' : `样本 ${pre.samples.length ? pre.samples.map((s) => `${s.key}×${s.n}`).join(', ') : '无'}；确切重复组数 ${pre.duplicateGroupCount === null ? '读不到' : pre.duplicateGroupCount}`}`)
    }
    console.log('\n判据：**要建唯一索引**的 spec，须**无重复键**（按**非 Sparse** 建时还要求缺字段数为 0）；')
    console.log('      **nonUnique spec**（user_messages.dedupeKey）期望**普通**索引，重复键是预期行为、不构成阻断。')
    console.log('（非 Sparse 唯一索引把缺失当 null，只允许一条 null；Sparse 唯一索引不索引缺失字段；普通索引不受缺失字段影响）')
    const sparseSpecs = SPECS.filter((s) => s.sparse)
    if (sparseSpecs.length) {
      console.log(`\n其中 ${sparseSpecs.length} 个 spec 标记了 sparse:true（${sparseSpecs.map((s) => s.collection).join(', ')}）：`)
      console.log('  本脚本的 SDK 未声明 Sparse 参数 → **不自动建**，请在控制台按「唯一 + Sparse」建（照 point_records 先例）。')
    }
  }

  if (!execute) {
    console.log('\n这是预检。确认上面两项为 0 后，用 --execute 创建')
    console.log('（标了 sparse:true 的集合本脚本**拒绝自动建** —— 见上，请在控制台按「唯一 + Sparse」建）。')
    return
  }

  let fail = 0
  for (const { spec, pre } of reports) {
    if (!pre.exists) { console.error(`✗ ${spec.collection}：集合不存在，跳过`); fail += 1; continue }
    /* 幂等索引"就位"的判据必须带着 spec 声明的**期望唯一性**：
     *   唯一 spec   → 字段上有唯一索引才算就位；
     *   nonUnique spec → 字段上有**普通**索引才算就位（229d94f 的语义结论：user_messages.dedupeKey
     *     跨 24h 时间窗允许再次写入，唯一索引会打断正常写入）。
     * 旧写法 `if (pre.hasUniqueDedupe)` 对 nonUnique spec 是**语义相反**的判据 —— 见 P1-9。 */
    const indexReady = spec.nonUnique
      ? (pre.hasDedupeIndex && pre.dedupeIndexUnique === false)
      : pre.hasUniqueDedupe
    if (indexReady) { console.log(`✓ ${spec.collection}：${spec.nonUnique ? '普通' : '唯一'}幂等索引已存在，跳过`); continue }
    if (spec.nonUnique && pre.hasDedupeIndex && pre.dedupeIndexUnique === true) {
      console.error(`✗ ${spec.collection}：spec 期望**普通**索引，线上却是**唯一**索引 —— 唯一索引会打断跨时间窗的正常再次写入。`)
      console.error('   本脚本不自动改动线上索引；请在控制台核对该索引语义后再决定。')
      fail += 1
      continue
    }
    if (spec.sparse) {
      // 不猜 SDK 的 Sparse 参数名：宁可在控制台手动建，也不自动建一个**语义不同**的非 Sparse 索引
      console.error(`✗ ${spec.collection}：spec 要求 Sparse 唯一索引，本脚本的 SDK 未声明 Sparse 参数 → 拒绝自动创建`)
      console.error(`   请在控制台建：字段 ${spec.field}，唯一=是，Sparse=是（索引名 ${spec.indexName}）`)
      console.error(`   注意：即使 Sparse，也要求**无重复键**（当前重复组数=${pre.duplicateGroupCount === null ? '读不到' : pre.duplicateGroupCount}）`)
      fail += 1
      continue
    }
    // nonUnique 的 spec：重复键是**预期**的（跨时间窗可再写），所以不拿"重复键=0"当门槛
    if (!spec.nonUnique && (pre.missingField !== 0 || pre.duplicateKeys !== 0)) {
      console.error(`✗ ${spec.collection}：预检未通过（缺字段=${pre.missingField} 重复=${pre.duplicateKeys}）`)
      console.error('   拒绝创建 —— 请先在控制台补齐 dedupeKey / 清理重复，或在控制台确认该集合的历史数据情况。')
      fail += 1
      continue
    }
    if (spec.nonUnique && pre.missingField !== 0) {
      console.error(`✗ ${spec.collection}：缺 dedupeKey 字段 ${pre.missingField} 条 —— 请先补齐（普通索引也要求字段可索引）`)
      fail += 1
      continue
    }
    try {
      await database.updateCollection(spec.collection, {
        CreateIndexes: [{
          IndexName: spec.indexName,
          MgoKeySchema: {
            // 唯一性由 spec 决定：跨时间窗可重复写的集合只能建**普通**索引
            MgoIsUnique: spec.nonUnique ? false : true,
            MgoIndexKeys: [{ Name: spec.field, Direction: '1' }],
          },
        }],
      })
      console.log(`✓ ${spec.collection}：已提交创建 ${spec.indexName}（${spec.nonUnique ? '普通（非唯一）' : '唯一'}）`)
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
