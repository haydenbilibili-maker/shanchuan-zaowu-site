/**
 * 工作室账单 —— 状态机与终结副作用（**纯函数 · 零 db 依赖**）
 * SSOT：admin/docs/出货算价与工作室结算_Phase1_技术蓝图.md §4.5 / §6
 *
 * 为什么单独一个纯函数文件：
 *   「确认收款 = 终结」要同时改**账单**与**账单下每一张出货单**（裁决 13）。
 *   这类"一个动作改多处"的逻辑最容易漏改一处或漏掉幂等，而它又是**钱**。
 *   做成纯函数 → 守卫可以直接断言「改了哪几个字段、状态不对时会不会被拒、重复点会不会重复写」，
 *   不需要起云环境；db 那层只负责把返回的 patch 写下去。
 *
 * ⚠️ 本文件是**结算状态的唯一写入方**（架构决定：账单是权威、出货单是派生）。
 *    `manageStoreShipment` **只继承**结算字段、绝不从入参读取（见其 normalizePayload 注释），
 *    由守卫 `check-settlement-single-ledger` 钉死。
 *
 * ⚠️ 只写**状态码**，不写展示标签（`statusLabel`/`settleLabel`）。
 *    标签一律由 `shipmentDefaults.mapRow` 在读取时**派生**，避免出现第二份真相；
 *    存量文档里残留的旧标签不会被任何读取方使用。
 */

const BILL_STATUS = {
  UNSETTLED: 'unsettled',
  PAID_PENDING: 'paid_pending',
  SETTLED: 'settled',
  VOID: 'void'
}

const BILL_STATUS_LABEL = {
  unsettled: '未结',
  paid_pending: '已付待确认',
  settled: '已结清',
  void: '已作废'
}

/** 账单状态流转：已结清是终态；已作废是终态 */
const BILL_FLOW = {
  unsettled: ['paid_pending', 'void'],
  paid_pending: ['settled', 'unsettled'],
  settled: [],
  void: []
}

/** 出货单被终结时应写的**物流终态**（裁决 13：确认收款 = 订单终结） */
const TERMINAL_SHIPMENT_STATUS = 'completed'

const SETTLE_STATUS = {
  UNSETTLED: 'unsettled',
  PAID_PENDING: 'paid_pending',
  SETTLED: 'settled'
}

function normalizeBillStatus(raw) {
  const s = String(raw || '').trim()
  return BILL_STATUS_LABEL[s] ? s : BILL_STATUS.UNSETTLED
}

function billStatusLabel(s) {
  return BILL_STATUS_LABEL[normalizeBillStatus(s)]
}

function canTransitBill(from, to) {
  const f = normalizeBillStatus(from)
  const t = normalizeBillStatus(to)
  return (BILL_FLOW[f] || []).indexOf(t) !== -1
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** `SB20260919-0001`；seq 由调用方按当日已生成数量传入（纯函数不查库） */
function genBillNo(dateStr, seq) {
  const d = String(dateStr || '').replace(/[^0-9]/g, '')
  const day = d.length >= 8 ? d.slice(0, 8) : d
  const n = Number(seq) > 0 ? Number(seq) : 1
  return `SB${day}-${String(n).padStart(4, '0')}`
}

function toCents(v) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : 0
}

function intOrZero(v) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

/**
 * 一张出货单能不能进这张账单。
 * 三类拒绝理由分别返回，便于前端**在勾选列表里就置灰并显示原因**
 * （不让超管勾完才被拒 —— 蓝图 §6.2）。
 */
function shipmentBlockReason(row, storeId) {
  const s = row || {}
  if (!s._id) return { code: 'NO_ID', msg: '单据缺少 id' }
  if (storeId && s.storeId !== storeId) return { code: 'WRONG_STORE', msg: '不属于该门店' }
  const settle = String(s.settleStatus || SETTLE_STATUS.UNSETTLED)
  if (settle !== SETTLE_STATUS.UNSETTLED) {
    return { code: 'ALREADY_IN_BILL', msg: `已${billStatusLabel(settle) === '未结' ? '入账' : '结清或入账'}（${settle}）` }
  }
  if (String(s.billId || '')) return { code: 'ALREADY_IN_BILL', msg: '已在另一张账单里' }
  if (String(s.pricingStatus || '') !== 'priced') {
    return { code: 'PRICING_INCOMPLETE', msg: `有 ${intOrZero(s.pricingIssueCount)} 行待核价` }
  }
  return null
}

/**
 * 生成一张账单（纯计算，不落库）。
 *
 * @param {Object} input { storeId, storeName, shipments:[出货单 doc], laborRatePct, actor, now, seq }
 * @returns {{ok:boolean, bill?:Object, blocked?:Array, msg?:string}}
 */
function buildBill(input) {
  const src = input || {}
  const shipments = Array.isArray(src.shipments) ? src.shipments : []
  const storeId = String(src.storeId || '').trim()
  const actor = src.actor || {}
  const now = Number(src.now) || Date.now()

  if (!storeId) return { ok: false, msg: '请选择门店' }
  if (!shipments.length) return { ok: false, msg: '请至少勾选一张出货单' }

  // 逐张校验：**拒绝时把是哪几张、为什么一并返回**，而不是只给一句"失败"
  const blocked = []
  for (const row of shipments) {
    const reason = shipmentBlockReason(row, storeId)
    if (reason) blocked.push({ _id: (row && row._id) || '', shipmentNo: (row && row.shipmentNo) || '', ...reason })
  }
  if (blocked.length) {
    return {
      ok: false,
      blocked,
      msg: `${blocked.length} 张单不能纳入账单（多为「待核价」或「已入账」）`
    }
  }

  const storeName = String(src.storeName || shipments[0].storeName || '').trim()
  const dates = shipments
    .map((s) => String(s.shipmentDate || '').trim())
    .filter(Boolean)
    .sort()

  let materialCostCents = 0
  let packagingCostCents = 0
  let laborCostCents = 0
  let totalCents = 0
  let totalQty = 0
  let itemCount = 0
  for (const s of shipments) {
    materialCostCents += toCents(s.materialCostCents)
    packagingCostCents += toCents(s.packagingCostCents)
    laborCostCents += toCents(s.laborCostCents)
    // 单据级 totalCents 已是「分」（= 三分项之和），**不再乘任何东西**
    totalCents += toCents(s.totalCents)
    totalQty += intOrZero(s.totalQty)
    itemCount += intOrZero(s.itemCount)
  }

  return {
    ok: true,
    bill: {
      billNo: genBillNo(dates[0] || '', src.seq),
      storeId,
      storeName,
      periodFrom: dates[0] || '',
      periodTo: dates[dates.length - 1] || '',
      shipmentIds: shipments.map((s) => s._id),
      shipmentCount: shipments.length,
      itemCount,
      totalQty,
      materialCostCents,
      packagingCostCents,
      laborCostCents,
      totalCents,
      totalAmount: Math.round(totalCents) / 100,
      laborRatePct: Number.isFinite(Number(src.laborRatePct)) ? Number(src.laborRatePct) : null,
      status: BILL_STATUS.UNSETTLED,
      paidMarkedAt: null,
      paidMarkedBy: '',
      paidMarkedByName: '',
      paidNote: '',
      settledAt: null,
      settledBy: '',
      settledByName: '',
      settleNote: '',
      createdAt: now,
      createdBy: String(actor.openid || ''),
      createdByName: String(actor.name || actor.nickName || ''),
      updatedAt: now,
      updatedBy: String(actor.openid || ''),
      deleted: false
    }
  }
}

function actorFields(actor) {
  const a = actor || {}
  return { by: String(a.openid || ''), byName: String(a.name || a.nickName || a.staffName || '') }
}

/**
 * 门店标「已付款」：仅 `unsettled` 可标。
 * @returns {{ok:boolean, patch?:Object, noop?:boolean, msg?:string}}
 */
function markPaidPatch(bill, actor, options) {
  const b = bill || {}
  const status = normalizeBillStatus(b.status)
  // 幂等：重复点「已付款」不报错、不重复写
  if (status === BILL_STATUS.PAID_PENDING) return { ok: true, noop: true, msg: '该账单已标记为已付款' }
  if (status === BILL_STATUS.SETTLED) return { ok: true, noop: true, msg: '该账单已结清，无需再标记' }
  if (!canTransitBill(status, BILL_STATUS.PAID_PENDING)) {
    return { ok: false, msg: `当前状态（${billStatusLabel(status)}）不能标记已付款` }
  }
  const at = Number((options && options.now) || Date.now())
  const who = actorFields(actor)
  return {
    ok: true,
    patch: {
      status: BILL_STATUS.PAID_PENDING,
      paidMarkedAt: at,
      paidMarkedBy: who.by,
      paidMarkedByName: who.byName,
      paidNote: String((options && options.note) || '').trim(),
      updatedAt: at,
      updatedBy: who.by
    },
    /**
     * 单据侧**镜像**账单状态：账单已付待确认 → 单据也显示「已付待确认」，
     * 这样店长在自己的出货单列表里不用去翻账单就知道钱标了没有。
     * 结算状态始终由账单派生，单据自己不产生结算状态。
     */
    shipmentPatch: {
      settleStatus: SETTLE_STATUS.PAID_PENDING,
      billId: String(b._id || ''),
      billNo: String(b.billNo || ''),
      paidMarkedAt: at,
      paidMarkedBy: who.by
    },
    shipmentIds: Array.isArray(b.shipmentIds) ? b.shipmentIds.filter(Boolean) : [],
    msg: '已标记为已付款，等待超管确认收款'
  }
}

/**
 * 超管「确认收款」= **终结**（裁决 13）：一个动作，改账单 + 账单下每一张出货单。
 *
 * 只要求 `paid_pending`（两步流程，裁决 12）；已结清则**幂等短路**，
 * 不重复写、不重复通知（通知由调用方按 `noop` 判断是否发）。
 *
 * @returns {{ok:boolean, noop?:boolean, billPatch?:Object, shipmentPatch?:Object, msg?:string}}
 */
function confirmSettlePatch(bill, actor, options) {
  const b = bill || {}
  const status = normalizeBillStatus(b.status)
  if (status === BILL_STATUS.SETTLED) return { ok: true, noop: true, msg: '该账单已结清（重复确认已忽略）' }
  if (!canTransitBill(status, BILL_STATUS.SETTLED)) {
    return { ok: false, msg: `当前状态（${billStatusLabel(status)}）不能确认收款；需先由门店标记已付款` }
  }
  const ids = Array.isArray(b.shipmentIds) ? b.shipmentIds.filter(Boolean) : []
  if (!ids.length) return { ok: false, msg: '账单里没有出货单，无法终结' }

  const at = Number((options && options.now) || Date.now())
  const who = actorFields(actor)
  const billPatch = {
    status: BILL_STATUS.SETTLED,
    settledAt: at,
    settledBy: who.by,
    settledByName: who.byName,
    settleNote: String((options && options.note) || '').trim(),
    updatedAt: at,
    updatedBy: who.by
  }
  /**
   * 出货单侧只写**状态码**（标签由 mapRow 读取时派生）：
   *   · settleStatus → settled（结算维度）
   *   · status → completed（物流维度，裁决 13「订单终结」）
   * 两个维度都写，但**不互相推导** —— 它们仍然是两个独立字段。
   */
  const shipmentPatch = {
    settleStatus: SETTLE_STATUS.SETTLED,
    status: TERMINAL_SHIPMENT_STATUS,
    billId: String(b._id || ''),
    billNo: String(b.billNo || ''),
    settledAt: at,
    settledBy: who.by
  }
  return { ok: true, billPatch, shipmentPatch, shipmentIds: ids, msg: '已确认收款，账单结清且相关出货单已终结' }
}

/** 作废：仅未结账单可作废；作废后其下单据回到未结，可重新入账 */
function voidPatch(bill, actor, options) {
  const b = bill || {}
  const status = normalizeBillStatus(b.status)
  if (status === BILL_STATUS.VOID) return { ok: true, noop: true, msg: '该账单已作废' }
  if (!canTransitBill(status, BILL_STATUS.VOID)) {
    return { ok: false, msg: `当前状态（${billStatusLabel(status)}）不能作废；已标已付款的账单请先撤回` }
  }
  const at = Number((options && options.now) || Date.now())
  const who = actorFields(actor)
  return {
    ok: true,
    patch: {
      status: BILL_STATUS.VOID,
      voidedAt: at,
      voidedBy: who.by,
      voidNote: String((options && options.note) || '').trim(),
      updatedAt: at,
      updatedBy: who.by
    },
    // 释放其下单据：清 billId/billNo，结算状态回到未结（金额快照不动）
    shipmentPatch: {
      settleStatus: SETTLE_STATUS.UNSETTLED,
      billId: '',
      billNo: '',
      paidMarkedAt: null,
      paidMarkedBy: '',
      settledAt: null,
      settledBy: ''
    },
    shipmentIds: Array.isArray(b.shipmentIds) ? b.shipmentIds.filter(Boolean) : [],
    msg: '账单已作废，其下出货单已回到未结状态'
  }
}

/** 撤回「已付款」（门店标错了/超管发现的）→ 回到未结 */
function withdrawPaidPatch(bill, actor) {
  const b = bill || {}
  const status = normalizeBillStatus(b.status)
  if (status === BILL_STATUS.UNSETTLED) return { ok: true, noop: true, msg: '该账单本来就是未结' }
  if (!canTransitBill(status, BILL_STATUS.UNSETTLED)) {
    return { ok: false, msg: `当前状态（${billStatusLabel(status)}）不能撤回到未结` }
  }
  const at = Date.now()
  const who = actorFields(actor)
  return {
    ok: true,
    patch: {
      status: BILL_STATUS.UNSETTLED,
      paidMarkedAt: null,
      paidMarkedBy: '',
      paidMarkedByName: '',
      paidNote: '',
      updatedAt: at,
      updatedBy: who.by
    },
    // 单据镜像回「未结」，但保留 billId（还在账单里，只是账单回到未结）
    shipmentPatch: {
      settleStatus: SETTLE_STATUS.UNSETTLED,
      paidMarkedAt: null,
      paidMarkedBy: ''
    },
    shipmentIds: Array.isArray(b.shipmentIds) ? b.shipmentIds.filter(Boolean) : [],
    msg: '已撤回到未结'
  }
}

/** 落库文档 → 客户端形状（补派生字段，前端不必自己算） */
function mapBill(doc) {
  const d = doc || {}
  const ids = Array.isArray(d.shipmentIds) ? d.shipmentIds.filter(Boolean) : []
  const totalCents = toCents(d.totalCents)
  return {
    _id: d._id || '',
    billNo: d.billNo || '',
    storeId: d.storeId || '',
    storeName: d.storeName || '',
    periodFrom: d.periodFrom || '',
    periodTo: d.periodTo || '',
    shipmentIds: ids,
    shipmentCount: intOrZero(d.shipmentCount) || ids.length,
    itemCount: intOrZero(d.itemCount),
    totalQty: intOrZero(d.totalQty),
    materialCostCents: toCents(d.materialCostCents),
    packagingCostCents: toCents(d.packagingCostCents),
    laborCostCents: toCents(d.laborCostCents),
    totalCents,
    totalAmount: Math.round(totalCents) / 100,
    laborRatePct: d.laborRatePct === null || d.laborRatePct === undefined ? null : Number(d.laborRatePct),
    status: normalizeBillStatus(d.status),
    statusLabel: billStatusLabel(d.status),
    canMarkPaid: normalizeBillStatus(d.status) === BILL_STATUS.UNSETTLED,
    canConfirmSettle: normalizeBillStatus(d.status) === BILL_STATUS.PAID_PENDING,
    canVoid: normalizeBillStatus(d.status) === BILL_STATUS.UNSETTLED,
    paidMarkedAt: d.paidMarkedAt || null,
    paidMarkedByName: d.paidMarkedByName || '',
    paidNote: d.paidNote || '',
    settledAt: d.settledAt || null,
    settledByName: d.settledByName || '',
    settleNote: d.settleNote || '',
    createdAt: d.createdAt || null,
    createdByName: d.createdByName || ''
  }
}

module.exports = {
  BILL_STATUS,
  BILL_STATUS_LABEL,
  BILL_FLOW,
  TERMINAL_SHIPMENT_STATUS,
  SETTLE_STATUS,
  normalizeBillStatus,
  billStatusLabel,
  canTransitBill,
  genBillNo,
  shipmentBlockReason,
  buildBill,
  markPaidPatch,
  confirmSettlePatch,
  voidPatch,
  withdrawPaidPatch,
  mapBill
}
