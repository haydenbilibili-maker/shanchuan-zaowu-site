#!/usr/bin/env node
/**
 * 订单状态迁移守卫（契约 C3 §6.2「守卫 2」，2026-09-19 新立）
 *
 * 为什么需要：契约 C3 §6.1 实测——现有 3 条 order 域守卫对状态机**零覆盖**。
 * 守卫 1（check-order-status-enum）钉「有哪些状态、谁能写」；本守卫钉「**哪些迁移合法、哪几次写入必须原子**」。
 * 两者缺一不可：枚举对了但迁移可以乱跳，状态机仍然不可信。
 *
 * 判据（全部来自契约 C3 §2.1/§2.2/§3.1 + 本轮逐行实测源码；判据表就写在本文件的 TRANSITIONS / ILLEGAL 里）：
 *   ① **迁移存在性**：每条已证实迁移必须仍能在登记的 `file` 里被锚点命中（写路径被删/被改 → 红）。
 *   ② **原子性**：契约 C3 §3.2 标为「CAS 占位」的迁移，其 update 必须**同链带 `where({...status...})`**
 *      且**同函数有 `stats.updated` / `updatedCount` 的抢占判定**（契约 §6.2 注入 I1：删 where → 必红）。
 *   ③ **非法迁移**（契约 §3.1 的「必须被拒绝」表，只取能在源码上判定的）：
 *        · `refundOrder` 的 `allowFrom` 只许 {paid, paid_awaiting_address, ready_pickup, shipped, received}
 *          （=> 不含 pending_pay ⇒ 未付款不可退；不含 refunded ⇒ 不可撤销退款，契约 §3.1）；
 *        · `refundOrder` 的 execute 白名单不含 `refunded`（契约 §3.1「refunded → 任意：无路径」）；
 *        · `confirmOrderReceipt` 必须有 `order.status !== 'shipped'` 前置（契约 §6.2 注入 I3）；
 *        · `managerShipOrder` 发货/工坊推进前置必须拒绝非 {paid, shipped}（契约 §3.1「fulfilling → shipped」）；
 *        · 门店核销前置必须 ∈ {paid, ready_pickup}（契约 §2.1 T17）；
 *        · 兑换单（source==='exchange'）必须被显式拒绝（契约 §3.1）；
 *        · `store_return` 未确认收回不得退款（契约 §3.1）；
 *        · **任何 `update/set` 都不得写 `pending_pay`**（它是建单初态，全仓只有 `add` 写它 ⇒ 无回退路径，契约 §3.1）。
 *   ④ **迁移图完整（双向）**：登记的 `to` 集合必须 == 源码实测的服务端写出值集合。
 *      （新写一个没人登记的状态值 → 红；登记了一条源码里不存在的迁移 → 红。）
 *   ⑤ **覆盖面上报（E16）**：打印 登记条数 / 命中条数 / 原子条数；未命中的一定点名。
 *   ⑥ **判据覆盖不到 → exit 2**（E16：无法判定不是通过）。
 *
 * 依赖：复用守卫 1 的扫描器（`./check-order-status-enum.mjs` 的导出），**不复制第二份正则/读文件逻辑**
 * （契约 C3 §6.2 共同实现约束 ③）。
 *
 * 用法：
 *   node miniprogram/scripts/check-order-transition-guard.mjs
 *   node miniprogram/scripts/check-order-transition-guard.mjs --selftest
 *   node miniprogram/scripts/check-order-transition-guard.mjs --report        # 只打印迁移事实表
 * 退出码：0 通过；1 判据不成立；2 无法判定（非 0 —— 不会被汇总表当成 ✓）。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  ROOT,
  REL,
  blankComments,
  lineAt,
  allCloudFnJs,
  collectOrdersWrites,
  loadManifest
} from './check-order-status-enum.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

// ─────────────────────────────────────────────────────────────────────────────
// 迁移登记表 —— 判据唯一来源：契约 C3 §2.1（T1–T18）/ §2.2（R1–R6）+ 本轮源码实测行号。
//   · `anchor`   ：该迁移的**写入点**锚点（正则，必须命中；命中行号会被打印）
//   · `atomic`   ：契约 §3.2 判为「CAS 占位」的迁移 —— 必须同时满足
//                  `chain`（同链 where 带 status）+ `guard`（同函数 stats.updated 抢占判定）
//   · `expect`   ：命中次数下限（默认 1）
// ─────────────────────────────────────────────────────────────────────────────
export const TRANSITIONS = [
  // ── 建单（∅ → pending_pay，只有 add 可以写 pending_pay）──────────────
  { id: 'T1', file: 'miniprogram/cloudfunctions/makeOrder/index.js', from: '∅', to: 'pending_pay', verb: 'add', trigger: 'makeOrder（买家下单）',
    anchor: /status:\s*'pending_pay',\s*\n\s*createTime:\s*db\.serverDate\(\),/ },
  { id: 'T1b', file: 'miniprogram/cloudfunctions/createDepositIntent/index.js', from: '∅', to: 'pending_pay', verb: 'add', trigger: 'createDepositIntent（定金意向建单）',
    anchor: /status:\s*'pending_pay',\s*\n\s*totalPrice:\s*depositAmount,/ },

  // ── 建单自救：券不可用 / 券锁失败 → void ─────────────────────────────
  { id: 'T2', file: 'miniprogram/cloudfunctions/makeOrder/index.js', from: '∅', to: 'void', verb: 'update', trigger: 'makeOrder（券不可用自救）',
    anchor: /status:\s*'void',\s*\n\s*cancelReason:\s*'coupon_unavailable'/ },
  { id: 'T3', file: 'miniprogram/cloudfunctions/makeOrder/index.js', from: '∅', to: 'void', verb: 'update', trigger: 'makeOrder（券锁失败自救）',
    anchor: /status:\s*'void',\s*\n\s*cancelReason:\s*'coupon_lock_failed'/ },
  { id: 'T3b', file: 'miniprogram/cloudfunctions/createDepositIntent/index.js', from: '∅', to: 'void', verb: 'update', trigger: 'createDepositIntent（定金单超时复用）',
    anchor: /\{\s*status:\s*'void',\s*cancelReason:\s*'deposit_pay_timeout'\s*\}/ },

  // ── pending_pay → void（原子）───────────────────────────────────────
  { id: 'T4', file: 'miniprogram/cloudfunctions/cancelOrder/index.js', from: 'pending_pay', to: 'void', verb: 'update', trigger: 'cancelOrder（买家取消）',
    anchor: /status:\s*'void',\s*\n\s*cancelTime:\s*db\.serverDate\(\),/,
    atomic: {
      chain: /\.collection\('orders'\)\s*\.where\(\{\s*_id:\s*orderId,\s*status:\s*'pending_pay'\s*\}\)\s*\.update\(\{\s*data:\s*\{\s*status:\s*'void'/,
      guard: /const\s+voided\s*=\s*voidClaim\s*&&\s*voidClaim\.stats/,
      guard2: /if\s*\(voided\s*<=\s*0\)/
    } },
  { id: 'T5', file: 'miniprogram/cloudfunctions/sweepExpiredOrders/index.js', from: 'pending_pay', to: 'void', verb: 'update', trigger: 'sweepExpiredOrders（定时清扫）',
    anchor: /status:\s*'void',\s*\n\s*cancelTime:\s*db\.serverDate\(\),\s*\n\s*cancelReason:\s*'expired_sweep'/,
    atomic: {
      chain: /\.collection\('orders'\)\.where\(\{\s*_id:\s*orderId,\s*status:\s*'pending_pay'\s*\}\)\.update\(\{\s*data:\s*\{\s*status:\s*'void'/,
      guard: /return\s+n\s*>\s*0/
    } },
  { id: 'T6', file: 'miniprogram/cloudfunctions/confirmPayment/fulfillOrder.js', from: 'pending_pay', to: 'void', verb: 'update', trigger: 'confirmPayment/fulfillOrder（支付超时·adminFulfill）',
    anchor: /status:\s*'void',\s*\n\s*cancelReason:\s*'支付超时'/ },
  { id: "T6'", file: 'miniprogram/cloudfunctions/payCallback/fulfillOrder.js', from: 'pending_pay', to: 'void', verb: 'update', trigger: "payCallback/fulfillOrder（支付超时·无支付证据）",
    anchor: /status:\s*'void',\s*\n\s*cancelReason:\s*'支付超时'/ },

  // ── pending_pay → fulfilling（原子抢占）────────────────────────────
  { id: 'T8', file: 'miniprogram/cloudfunctions/confirmPayment/fulfillOrder.js', from: 'pending_pay', to: 'fulfilling', verb: 'update', trigger: 'confirmPayment/fulfillOrder.tryClaimPending',
    anchor: /status:\s*'fulfilling',\s*\n\s*fulfillStartedAt:\s*db\.serverDate\(\)/,
    atomic: {
      chain: /\.collection\('orders'\)\.where\(\{\s*_id:\s*orderId,\s*status:\s*'pending_pay'\s*\}\)\.update\(\{\s*data:\s*\{\s*status:\s*'fulfilling'/,
      guard: /return\s+updatedCount\(claim\)\s*>\s*0/
    } },
  { id: "T8'", file: 'miniprogram/cloudfunctions/payCallback/fulfillOrder.js', from: 'pending_pay', to: 'fulfilling', verb: 'update', trigger: 'payCallback/fulfillOrder.tryClaimPending',
    anchor: /status:\s*'fulfilling',\s*\n\s*fulfillStartedAt:\s*db\.serverDate\(\)/,
    atomic: {
      chain: /\.collection\('orders'\)\.where\(\{\s*_id:\s*orderId,\s*status:\s*'pending_pay'\s*\}\)\.update\(\{\s*data:\s*\{\s*status:\s*'fulfilling'/,
      guard: /return\s+updatedCount\(claim\)\s*>\s*0/
    } },

  // ── fulfilling → paid / paid_awaiting_address / ready_pickup（原子，三分支）──
  { id: 'T9/T10/T11', file: 'miniprogram/cloudfunctions/confirmPayment/fulfillOrder.js', from: 'fulfilling|pending_pay', to: 'paid|paid_awaiting_address|ready_pickup', verb: 'update', trigger: 'confirmPayment/fulfillOrder.finalize',
    anchor: /const\s+nextStatus\s*=\s*invite\s*\n\s*\?\s*'paid_awaiting_address'\s*\n\s*:\s*\(isRegularStorePickup\s*\?\s*'ready_pickup'\s*:\s*'paid'\)/,
    atomic: {
      chain: /\.collection\('orders'\)\.where\(\{\s*_id:\s*orderId,\s*status:\s*_\.in\(\['fulfilling',\s*'pending_pay'\]\)\s*\}\)\.update\(\{\s*data:\s*updateData\s*\}\)/,
      guard: /if\s*\(updatedCount\(finalize\)\s*===\s*0\)/
    } },
  { id: "T9'/T10'/T11'", file: 'miniprogram/cloudfunctions/payCallback/fulfillOrder.js', from: 'fulfilling|pending_pay', to: 'paid|paid_awaiting_address|ready_pickup', verb: 'update', trigger: 'payCallback/fulfillOrder.finalize',
    anchor: /const\s+nextStatus\s*=\s*invite\s*\n\s*\?\s*'paid_awaiting_address'\s*\n\s*:\s*\(isRegularStorePickup\s*\?\s*'ready_pickup'\s*:\s*'paid'\)/,
    atomic: {
      chain: /\.collection\('orders'\)\.where\(\{\s*_id:\s*orderId,\s*status:\s*_\.in\(\['fulfilling',\s*'pending_pay'\]\)\s*\}\)\.update\(\{\s*data:\s*updateData\s*\}\)/,
      guard: /if\s*\(updatedCount\(finalize\)\s*===\s*0\)/
    } },

  // ── 定金履约 → paid（原子）────────────────────────────────────────
  { id: 'T-deposit', file: 'miniprogram/cloudfunctions/confirmPayment/depositFulfill.js', from: 'fulfilling|pending_pay', to: 'paid', verb: 'update', trigger: 'confirmPayment/depositFulfill',
    anchor: /status:\s*'paid',\s*\n\s*paidTime:\s*db\.serverDate\(\),/,
    atomic: {
      chain: /\.collection\('orders'\)\.where\(\{\s*_id:\s*orderId,\s*status:\s*_\.in\(\['fulfilling',\s*'pending_pay'\]\)\s*\}\)\.update\(\{\s*data:\s*\{\s*status:\s*'paid'/,
      guard: /if\s*\(updatedCount\(finalize\)\s*===\s*0\)/
    } },
  { id: "T-deposit'", file: 'miniprogram/cloudfunctions/payCallback/depositFulfill.js', from: 'fulfilling|pending_pay', to: 'paid', verb: 'update', trigger: 'payCallback/depositFulfill',
    anchor: /status:\s*'paid',\s*\n\s*paidTime:\s*db\.serverDate\(\),/,
    atomic: {
      chain: /\.collection\('orders'\)\.where\(\{\s*_id:\s*orderId,\s*status:\s*_\.in\(\['fulfilling',\s*'pending_pay'\]\)\s*\}\)\.update\(\{\s*data:\s*\{\s*status:\s*'paid'/,
      guard: /if\s*\(updatedCount\(finalize\)\s*===\s*0\)/
    } },

  // ── 发货 paid → shipped（含 paid_awaiting_address 脏数据修复）────────
  { id: 'T13', file: 'miniprogram/cloudfunctions/managerShipOrder/index.js', from: 'paid_awaiting_address', to: 'paid', verb: 'update', trigger: 'managerShipOrder（地址已交脏数据修复）',
    anchor: /\.doc\(orderId\)\.update\(\{\s*data:\s*\{\s*status:\s*'paid'\s*\}\s*\}\)/ },
  { id: 'T12', file: 'miniprogram/cloudfunctions/managerShipOrder/index.js', from: 'paid|shipped', to: 'shipped', verb: 'update', trigger: 'managerShipOrder（店长发货/改运单）',
    anchors: [/const\s+shipPatch\s*=\s*\{\s*\n\s*status:\s*'shipped',/, /\.doc\(orderId\)\.update\(\{\s*data:\s*shipPatch\s*\}\)/] },
  { id: 'T14', file: 'miniprogram/cloudfunctions/managerShipOrder/index.js', from: 'paid|shipped', to: 'shipped', verb: 'update', trigger: 'managerShipOrder.advanceProduction（工坊推进发出）',
    anchor: /updateData\.status\s*=\s*'shipped'/ },

  // ── 签收 shipped → received ────────────────────────────────────────
  { id: 'T15', file: 'miniprogram/cloudfunctions/confirmOrderReceipt/index.js', from: 'shipped', to: 'received', verb: 'update', trigger: 'confirmOrderReceipt（买家确认收货）',
    anchor: /\.doc\(orderId\)\.update\(\{\s*data:\s*\{\s*status:\s*'received',/ },
  { id: 'T16', file: 'miniprogram/cloudfunctions/sweepExpiredOrders/index.js', from: 'shipped', to: 'received', verb: 'update', trigger: 'sweepExpiredOrders.autoReceiveShipped（定时自动签收）',
    anchor: /status:\s*'received',\s*\n\s*receiveTime:\s*db\.serverDate\(\),\s*\n\s*autoReceived:\s*true,/,
    atomic: {
      chain: /\.collection\('orders'\)\s*\.where\(\{\s*_id:\s*order\._id,\s*status:\s*'shipped'\s*\}\)\s*\.update\(\{\s*data:\s*\{\s*status:\s*'received'/,
      guard: /const\s+updated\s*=\s*\(upd\s*&&\s*upd\.stats\s*&&\s*upd\.stats\.updated\)/
    } },

  // ── 门店核销 paid|ready_pickup → received（两处：完单自取 / 亮码核销）──
  { id: 'T17a', file: 'miniprogram/cloudfunctions/managerShipOrder/index.js', from: 'paid|ready_pickup', to: 'received', verb: 'update', trigger: 'managerShipOrder.completeStorePickup',
    anchor: /status:\s*'received',\s*\n\s*receiveTime:\s*db\.serverDate\(\),\s*\n\s*pickupStatus:\s*'claimed',/, expect: 2 },

  // ── 礼赠核销 paid|shipped|ready_pickup → received ──────────────────
  { id: 'T17c', file: 'miniprogram/cloudfunctions/manageGift/index.js', from: 'paid|shipped|ready_pickup', to: 'received', verb: 'update', trigger: 'manageGift（礼赠领取码核销）',
    anchor: /status:\s*'received',\s*\n\s*receiveTime:\s*db\.serverDate\(\),\s*\n\s*giftMeta:\s*nextMeta,/ },

  // ── 退款链：入边 ───────────────────────────────────────────────────
  { id: 'R1', file: 'miniprogram/cloudfunctions/refundOrder/index.js', from: 'paid|paid_awaiting_address|ready_pickup|shipped|received', to: 'aftersales|refunding', verb: 'update', trigger: 'refundOrder.requestRefundByBuyer（买家申请）',
    anchor: /status:\s*postShip\s*\?\s*'aftersales'\s*:\s*'refunding'/ },
  { id: 'R2', file: 'miniprogram/cloudfunctions/refundOrder/index.js', from: 'paid|paid_awaiting_address|ready_pickup|shipped|received', to: 'refunding', verb: 'update', trigger: 'refundOrder.staffMarkRefunding（店长/超管发起）',
    anchor: /status:\s*'refunding',\s*\n\s*statusBeforeRefund:\s*order\.status/ },
  { id: 'R3', file: 'miniprogram/cloudfunctions/refundOrder/index.js', from: 'paid_awaiting_address|expired_refunding|refunding', to: 'refunding', verb: 'update', trigger: 'refundOrder.giftExpireRefund（礼赠填址超时）',
    anchor: /status:\s*'refunding',\s*\n\s*cancelReason:\s*'gift_address_timeout'/ },
  { id: 'R4', file: 'miniprogram/cloudfunctions/refundOrder/index.js', from: 'expired_refunding', to: 'refunding', verb: 'update', trigger: 'refundOrder.execute（内部收口）',
    anchor: /status:\s*'refunding',\s*\n\s*statusBeforeRefund:\s*'expired_refunding'/ },
  { id: 'R5', file: 'miniprogram/cloudfunctions/refundOrder/index.js', from: 'refunding|aftersales', to: '(动态)statusBeforeRefund', verb: 'update', trigger: 'refundOrder.staffRejectRefund（拒绝 = 回退，不是进入「被拒」态）',
    anchor: /status:\s*restoreStatus,/ },

  // ── 退款链：出边（钱已出）──────────────────────────────────────────
  { id: 'T18', file: 'miniprogram/cloudfunctions/refundOrder/index.js', from: 'refunding|aftersales|refund_approved|expired_refunding', to: 'refunded', verb: 'update', trigger: 'refundOrder.executeRefund（微信/钱包真退款）',
    anchor: /status:\s*'refunded',\s*\n\s*refundTime:\s*db\.serverDate\(\),\s*\n\s*refundNo,/ },

  // ── 礼赠分支 ───────────────────────────────────────────────────────
  { id: 'T-gift-expire', file: 'miniprogram/cloudfunctions/manageGift/index.js', from: 'paid_awaiting_address', to: 'expired_refunding', verb: 'update', trigger: 'manageGift（填址超时扫描）',
    anchor: /status:\s*'expired_refunding',/ },
  { id: 'T-gift-addr', file: 'miniprogram/cloudfunctions/manageGift/index.js', from: 'paid_awaiting_address', to: 'paid', verb: 'update', trigger: 'manageGift.submitAddress（填址完成强制离开待填址）',
    anchors: [/status:\s*'paid',\s*\n\s*address:\s*addressDoc,/, /status:\s*'paid',\s*\n\s*address:\s*_\.set\(addressDoc\),/] },
  { id: 'T-gift-heal', file: 'miniprogram/cloudfunctions/manageGift/index.js', from: 'paid_awaiting_address', to: 'paid', verb: 'update', trigger: 'manageGift.ensureGiftAddressStatusPaid（脏数据兜底）',
    anchor: /\.doc\(orderId\)\.update\(\{\s*data:\s*\{\s*status:\s*'paid'\s*\}\s*\}\)/ },

  // ── 兑换单 ─────────────────────────────────────────────────────────
  { id: 'T-exchange', file: 'miniprogram/cloudfunctions/exchangeCoupon/index.js', from: '∅', to: 'exchanged', verb: 'add', trigger: 'exchangeCoupon（券兑换建单）',
    anchor: /status:\s*'exchanged',/ },
  { id: 'T-redeem', file: 'miniprogram/cloudfunctions/redeemReward/index.js', from: '∅', to: 'paid|unverified', verb: 'add', trigger: 'redeemReward（积分兑换建单）',
    anchors: [/const\s+status\s*=\s*type\s*===\s*'goods'\s*\?\s*'paid'\s*:\s*'unverified'/, /status,\s*\n\s*source:\s*'exchange',/] }
]

// ─────────────────────────────────────────────────────────────────────────────
// 非法迁移 / 前置条件断言（契约 C3 §3.1「必须被拒绝的迁移」+ §2.1 的前置条件）
// ─────────────────────────────────────────────────────────────────────────────
export const ILLEGAL = [
  { id: 'N1', file: 'miniprogram/cloudfunctions/refundOrder/index.js', what: 'allowFrom 只许 {paid, paid_awaiting_address, ready_pickup, shipped, received}（⇒ 不含 pending_pay：未付款不可退；不含 refunded：不可撤销退款）',
    kind: 'array-members-subset', varName: 'allowFrom', allowed: ['paid', 'paid_awaiting_address', 'ready_pickup', 'shipped', 'received'], expect: 2 },
  { id: 'N2', file: 'miniprogram/cloudfunctions/refundOrder/index.js', what: 'giftExpireRefund 的 allowStatus 只许 {paid_awaiting_address, expired_refunding, refunding}（不含 refunded）',
    kind: 'array-members-subset', varName: 'allowStatus', allowed: ['paid_awaiting_address', 'expired_refunding', 'refunding'] },
  { id: 'N3', file: 'miniprogram/cloudfunctions/refundOrder/index.js', what: '已退款不可再退：giftExpireRefund 必须对 status===\'refunded\' 提前返回 already',
    kind: 'require', pattern: /if\s*\(order\.status\s*===\s*'refunded'\)\s*\{/ },
  { id: 'N4', file: 'miniprogram/cloudfunctions/refundOrder/index.js', what: '兑换单（source===\'exchange\'）必须被显式拒绝',
    kind: 'require', pattern: /String\(order\.source\s*\|\|\s*''\)\s*===\s*'exchange'/ },
  { id: 'N5', file: 'miniprogram/cloudfunctions/refundOrder/index.js', what: 'store_return 未确认收回实物不得退款',
    kind: 'require', pattern: /order\.returnMode\s*===\s*'store_return'\s*&&\s*order\.pickupReturnStatus\s*!==\s*'returned'/ },
  { id: 'N6', file: 'miniprogram/cloudfunctions/refundOrder/index.js', what: 'execute 白名单不得含 refunded（契约 §3.1「refunded → 任意：无路径」）',
    kind: 'includes-array-excludes', marker: 'expired_refunding', forbidden: 'refunded' },
  { id: 'N7', file: 'miniprogram/cloudfunctions/confirmOrderReceipt/index.js', what: '确认收货前置必须要求 status === \'shipped\'',
    kind: 'require', pattern: /order\.status\s*!==\s*'shipped'/ },
  { id: 'N8', file: 'miniprogram/cloudfunctions/managerShipOrder/index.js', what: '发货 / 工坊推进前置必须拒绝非 {paid, shipped}（两处：advanceProduction + ship）',
    kind: 'require', pattern: /order\.status\s*!==\s*'paid'\s*&&\s*order\.status\s*!==\s*'shipped'/, expect: 2 },
  { id: 'N9', file: 'miniprogram/cloudfunctions/managerShipOrder/index.js', what: 'completeStorePickup 核销前置必须 ∈ {paid, ready_pickup}',
    kind: 'require', pattern: /\[\s*'paid',\s*'ready_pickup'\s*\]\.includes\(String\(order\.status/ },
  { id: 'N10', file: 'miniprogram/cloudfunctions/managerShipOrder/index.js', what: 'verifyPickup 核销前置必须拒绝非 {paid, ready_pickup}',
    kind: 'require', pattern: /order\.status\s*!==\s*'paid'\s*&&\s*order\.status\s*!==\s*'ready_pickup'/ },
  { id: 'N11', file: 'miniprogram/cloudfunctions/manageGift/index.js', what: '礼赠核销前置必须 ∈ {paid, shipped, ready_pickup}',
    kind: 'require', pattern: /\[\s*'paid',\s*'shipped',\s*'ready_pickup'\s*\]\.includes\(String\(order\.status/ },
  { id: 'N12', file: '(全云函数)', what: '任何 update/set 都不得写 pending_pay（建单初态只由 add 写 ⇒ 无「回退到待支付」路径）',
    kind: 'no-write' }
]

// ─────────────────────────────────────────────────────────────────────────────
// 检查实现
// ─────────────────────────────────────────────────────────────────────────────
function arrayLiterals(blanked, varName) {
  const out = []
  const re = new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*\\[`, 'g')
  for (const m of blanked.matchAll(re)) {
    const open = blanked.indexOf('[', m.index + m[0].length - 1)
    let depth = 0
    let end = -1
    for (let i = open; i < blanked.length; i++) {
      const c = blanked[i]
      if (c === '"' || c === "'" || c === '`') { i += 1; while (i < blanked.length && blanked[i] !== c) { if (blanked[i] === '\\') i += 1; i += 1 } continue }
      if (c === '[') depth += 1
      else if (c === ']') { depth -= 1; if (depth === 0) { end = i; break } }
    }
    const members = [...blanked.slice(open, end < 0 ? blanked.length : end).matchAll(/'([a-z_]+)'/g)].map((s) => s[1])
    out.push({ varName, members, line: lineAt(blanked, m.index) })
  }
  return out
}

/** `!['a','b'].includes(order.status)` / `['a','b'].includes(order.status)` 里的内联白名单 */
function inlineIncludesArrays(blanked) {
  const out = []
  for (const m of blanked.matchAll(/\[([^[\]]*)\]\s*\.includes\(/g)) {
    out.push({ members: [...m[1].matchAll(/'([a-z_]+)'/g)].map((s) => s[1]), line: lineAt(blanked, m.index) })
  }
  return out
}

export function runChecks() {
  const problems = []
  const notes = []
  const matched = []
  const noWriteProblems = []

  // ④ 先取源码实测写出值集合（复用守卫 1 的扫描器）
  const writeScan = collectOrdersWrites()
  const written = new Set()
  for (const w of writeScan.writes) for (const st of w.statuses) written.add(st.value)

  const fileCache = new Map()
  const src = (rel) => {
    if (!existsSync(join(ROOT, rel))) return null
    if (!fileCache.has(rel)) fileCache.set(rel, blankComments(readFileSync(join(ROOT, rel), 'utf8')))
    return fileCache.get(rel)
  }

  // ① + ② 迁移存在性 / 原子性
  const registeredTargets = new Set()
  for (const t of TRANSITIONS) {
    const b = src(t.file)
    if (b == null) { problems.push(`① ${t.id} 登记的文件不存在：${t.file}`); continue }
    const anchors = t.anchors || [t.anchor]
    let hits = 0
    let firstLine = 0
    for (const a of anchors) {
      const n = [...b.matchAll(new RegExp(a.source, a.flags.includes('g') ? a.flags : a.flags + 'g'))].length
      if (!n) { problems.push(`① ${t.id}（${t.from} → ${t.to}）的写入锚点在 ${t.file} 找不到 —— 写路径被删/被改写`); continue }
      const m = new RegExp(a.source).exec(b)
      if (!firstLine && m) firstLine = lineAt(b, m.index)
      hits += n
    }
    const want = t.expect || 1
    if (hits && hits < want) problems.push(`① ${t.id} 命中 ${hits} 处 < 期望 ${want} 处（${t.file}）`)
    for (const v of String(t.to).split('|')) if (/^[a-z_]+$/.test(v)) registeredTargets.add(v)
    if (t.atomic) {
      const chainOk = [...b.matchAll(new RegExp(t.atomic.chain.source, 'g'))].length > 0
      const guards = [t.atomic.guard, t.atomic.guard2].filter(Boolean)
      const missing = guards.filter((g) => !new RegExp(g.source).test(b))
      if (!chainOk) problems.push(`② ${t.id} 标记为「必须原子」，但同链 ${t.file} 里找不到 \`where({…status…}).update({data:{status:…\n\` —— CAS 前置条件被删（契约 §3.2 / §6.2 注入 I1）`)
      if (missing.length) problems.push(`② ${t.id} 标记为「必须原子」，但缺 stats.updated 抢占判定（${t.file}）`)
      else if (chainOk && !missing.length) notes.push(`${t.id} 原子性 OK（where(status) + updated 抢占都在）`)
    }
    if (hits) matched.push({ ...t, line: firstLine, hits })
  }

  // ④ 双向：登记目标集 == 实测写出集
  const onlyRegistered = [...registeredTargets].filter((v) => !written.has(v))
  const onlyWritten = [...written].filter((v) => !registeredTargets.has(v))
  for (const v of onlyWritten) problems.push(`④ 源码写出了「${v}」，但没有任何登记迁移指向它 —— 迁移图不完整（新写路径未登记）`)
  for (const v of onlyRegistered) if (!written.has(v)) notes.push(`④ 登记目标「${v}」当前无实测写入方（可能是条件分支未触发，或迁移已被删）`)

  // ③ 非法迁移 / 前置条件
  for (const rule of ILLEGAL) {
    if (rule.kind === 'no-write') {
      const bad = []
      for (const w of writeScan.writes) {
        if (!['update', 'set'].includes(w.verb)) continue
        for (const st of w.statuses) if (st.value === 'pending_pay') bad.push(`${w.file}:${st.line}`)
      }
      if (bad.length) problems.push(`③ ${rule.id} ${rule.what} —— 违反：${bad.join(' , ')}`)
      else noWriteProblems.push(`${rule.id} OK：${writeScan.writes.filter((w) => ['update', 'set'].includes(w.verb)).length} 个 update/set 调用点，零个写 pending_pay`)
      continue
    }
    const b = src(rule.file)
    if (b == null) { problems.push(`③ ${rule.id} 登记的文件不存在：${rule.file}`); continue }
    if (rule.kind === 'require') {
      const n = [...b.matchAll(new RegExp(rule.pattern.source, 'g'))].length
      const want = rule.expect || 1
      if (n < want) problems.push(`③ ${rule.id} ${rule.what} —— 在 ${rule.file} 只命中 ${n} 处（期望 ≥${want}）`)
      continue
    }
    if (rule.kind === 'array-members-subset') {
      const arrs = arrayLiterals(b, rule.varName)
      if (!arrs.length) { problems.push(`③ ${rule.id} ${rule.file} 里找不到 \`const ${rule.varName} = [...]\``); continue }
      if (rule.expect && arrs.length < rule.expect) problems.push(`③ ${rule.id} ${rule.varName} 只找到 ${arrs.length} 处（期望 ≥${rule.expect}）`)
      const allowed = new Set(rule.allowed)
      for (const a of arrs) {
        for (const v of a.members) {
          if (!allowed.has(v)) problems.push(`③ ${rule.id} ${rule.file}:${a.line} 的 ${rule.varName} 含非法迁移来源「${v}」—— ${rule.what}`)
        }
      }
      continue
    }
    if (rule.kind === 'includes-array-excludes') {
      const arrs = inlineIncludesArrays(b).filter((a) => a.members.includes(rule.marker))
      if (!arrs.length) { problems.push(`③ ${rule.id} ${rule.file} 里找不到含「${rule.marker}」的内联白名单`); continue }
      for (const a of arrs) {
        if (a.members.includes(rule.forbidden)) problems.push(`③ ${rule.id} ${rule.file}:${a.line} 内联白名单 [${a.members.join(',')}] 含禁止值「${rule.forbidden}」—— ${rule.what}`)
      }
      continue
    }
    problems.push(`⚠ 内部错误：未知判据 kind=${rule.kind}`)
  }

  // ⑥ 判据覆盖不到 → 无法判定
  const undecidable = []
  if (!loadManifest()) undecidable.push('缺 lib/orderStatusAllowed.json —— 迁移目标无法与枚举事实源对齐')

  return { problems, undecidable, notes, matched, written, writeScan, registeredTargets }
}

// ── 输出 ────────────────────────────────────────────────────────────────────
function printReport(res) {
  const atomic = TRANSITIONS.filter((t) => t.atomic).length
  console.log(`登记迁移 ${TRANSITIONS.length} 条（其中「必须原子」${atomic} 条，含 ${TRANSITIONS.filter((t) => t.anchors).length} 条多锚点）/ 实测命中 ${res.matched.length} 条`)
  console.log(`登记目标值 ${res.registeredTargets.size} 个 / 源码实测写出值 ${res.written.size} 个`)
  console.log('\n合法迁移（file:行号 → from → to）：')
  for (const t of res.matched) {
    console.log(`  ${t.id.padEnd(14)} ${t.file.replace('miniprogram/cloudfunctions/', '')}:${t.line}  ${t.from} → ${t.to}${t.atomic ? '  [原子]' : ''}   ${t.trigger}`)
  }
  console.log('\n非法迁移 / 前置条件断言：')
  for (const r of ILLEGAL) console.log(`  ${r.id.padEnd(4)} ${r.file.replace('miniprogram/cloudfunctions/', '')}  ${r.what}`)
}

function main() {
  const res = runChecks()
  if (process.argv.includes('--report')) {
    printReport(res)
    process.exit(0)
  }
  for (const n of res.notes) console.log(`ⓘ ${n}`)
  for (const p of res.problems) console.error(`✗ ${p}`)
  if (!res.problems.length && !res.undecidable.length) {
    printReport(res)
    console.log('\n✓ 订单状态迁移不变量通过：合法迁移集合可命中 + 原子迁移仍是 CAS + 非法迁移/前置条件齐全 + 迁移图与源码双向一致')
    process.exit(0)
  }
  if (res.problems.length) {
    console.error(`\n订单状态迁移不变量未通过：${res.problems.length} 处`)
    process.exit(1)
  }
  console.error(`\n无法判定 ${res.undecidable.length} 处 —— 按错题本 E16 以 exit 2 结束（**不是通过**）：${res.undecidable.join(' ; ')}`)
  process.exit(2)
}

// ── 自检：注入回归 → 必须检出 → 逐字节还原 ─────────────────────────────────
export function selftest() {
  const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
  let bad = 0
  let probes = 0
  const ok = (n) => console.log(`  ✓ ${n}`)
  const no = (n) => { bad += 1; console.error(`  ✗ ${n}`) }

  const base = runChecks()
  if (base.problems.length || base.undecidable.length) {
    console.error('✗ 基线就有问题，先修再谈自检：')
    base.problems.forEach((p) => console.error('  - ' + p))
    process.exit(1)
  }
  ok(`基线：${TRANSITIONS.length} 条合法迁移全部命中，非法迁移断言全部成立`)

  const inject = (name, relPath, mutate, want, expectRed = true) => {
    probes += 1
    const abs = join(ROOT, relPath)
    const before = readFileSync(abs)
    const digest = sha(abs)
    let hit = null
    try {
      const mutated = mutate(before.toString('utf8'))
      if (mutated === before.toString('utf8')) { no(`${name}（注入锚点没匹配上 → 自检本身失效）`); return }
      writeFileSync(abs, mutated)
      const r = runChecks()
      hit = [...r.problems, ...r.undecidable].find((p) => want.test(p)) || null
    } finally {
      writeFileSync(abs, before)
    }
    if (sha(abs) !== digest) { no(`${name}（还原后字节不一致）`); return }
    if (expectRed) { if (hit) ok(`${name}\n      → ${hit.slice(0, 160)}`); else no(name) } else if (hit) no(`${name} —— 反例不该红，命中：${hit.slice(0, 120)}`)
    else ok(`${name}（确认不产生假失败）`)
  }

  // I1：删掉 cancelOrder 的原子 where 条件
  inject('★ I1 删掉 cancelOrder 的 CAS where(status) 被检出（契约 §6.2 注入 I1）',
    'miniprogram/cloudfunctions/cancelOrder/index.js',
    (s) => s.replace(`    const voidClaim = await db.collection('orders').where({
      _id: orderId,
      status: 'pending_pay'
    }).update({`, `    const voidClaim = await db.collection('orders').doc(orderId).update({`),
    /② T4 标记为「必须原子」/)

  // I2：allowFrom 里加 pending_pay
  inject('★ I2 refundOrder 的 allowFrom 混入 pending_pay 被检出（契约 §6.2 注入 I2）',
    'miniprogram/cloudfunctions/refundOrder/index.js',
    (s) => s.replace("const allowFrom = ['paid', 'paid_awaiting_address', 'ready_pickup', 'shipped', 'received']",
      "const allowFrom = ['paid', 'paid_awaiting_address', 'ready_pickup', 'shipped', 'received', 'pending_pay']"),
    /含非法迁移来源「pending_pay」/)

  // I3：删掉确认收货的前置
  inject('★ I3 删掉 confirmOrderReceipt 的 status!==\'shipped\' 前置被检出（契约 §6.2 注入 I3）',
    'miniprogram/cloudfunctions/confirmOrderReceipt/index.js',
    (s) => s.replace("    if (order.status !== 'shipped') {", '    if (false) {'),
    /③ N7/)

  // I4：删掉一个迁移的写入点
  inject('★ I4 删掉一条登记迁移的写入点被检出（exchangeCoupon 不再写 exchanged）',
    'miniprogram/cloudfunctions/exchangeCoupon/index.js',
    (s) => s.replace("          status: 'exchanged',", "          status: 'exchanged_x',"),
    /① T-exchange|④ 源码写出了/)

  // I5：登记迁移被改成新状态值（迁移图不完整）
  inject('★ I5 出现未登记的写出值被检出（manageGift 改写 unknown_status）',
    'miniprogram/cloudfunctions/manageGift/index.js',
    (s) => s.replace("          status: 'expired_refunding',", "          status: 'expired_refunding_x',"),
    /④ 源码写出了/)

  // I6：原子迁移失去 updated 抢占判定
  inject('★ I6 原子迁移失去 stats.updated 抢占判定被检出（sweepExpiredOrders claimExpiredOrder）',
    'miniprogram/cloudfunctions/sweepExpiredOrders/index.js',
    (s) => s.replace('  return n > 0', '  return true'),
    /② T5 标记为「必须原子」，但缺 stats\.updated/)

  // I7：update 里写 pending_pay（回退路径）
  inject('★ I7 update 里写 pending_pay（非法回退）被检出',
    'miniprogram/cloudfunctions/cancelOrder/index.js',
    (s) => s.replace("        status: 'void',\n        cancelTime: db.serverDate(),", "        status: 'pending_pay',\n        cancelTime: db.serverDate(),"),
    /不得写 pending_pay|④ 源码写出了/)

  // I8（反例）：只改注释/空白
  inject('☆ I8 反例：只改注释与缩进 → 必须保持绿',
    'miniprogram/cloudfunctions/refundOrder/index.js',
    (s) => s.replace('  const allowFrom = [', '  // 退款来源白名单（注释变更，不影响判据）\n  const allowFrom = ['),
    /allowFrom|§3\.1/,
    false)

  if (bad) {
    console.error(`\n自检失败 ${bad} 项 —— 守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log(`\n自检通过：${probes} 个注入（CAS 被删 / 非法来源 / 前置被删 / 写入点消失 / 未登记值 / 丢失抢占判定 / 回退写 pending_pay）都能被检出，且还原字节一致；1 个反例不假红`)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  if (process.argv.includes('--selftest')) selftest()
  else main()
}
