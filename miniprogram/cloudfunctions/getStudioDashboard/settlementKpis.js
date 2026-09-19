/**
 * 工作室仪表盘 · 结算口径（**纯函数 · 零 db 依赖**）
 * SSOT：admin/docs/出货算价与工作室结算_Phase1_技术蓝图.md（v1.2）§8.4 + 裁决 20
 *
 * 为什么单独一个纯函数文件：
 *   这里每一个数都是**钱的口径**（出货额 / 已结清 / 未收款 / 真毛利）。
 *   原实现把「写入当天即全额计入营收」当成营收（`revenueTotal`），
 *   上了收款之后同一个词会被读出两种意思 —— 必须把口径拆开并**可断言**。
 *
 * ⚠️ 单位（本仓库已因单位混用踩过 E18，翻倍且不报错）：
 *   单据里 `materialCostCents/packagingCostCents/laborCostCents/totalCents` 是**分**（整数），
 *   而 `totalAmount` 是**元**。本文件内部**一律用分**运算，出口才转元。
 */

const CENTS = 100

function toCents(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * CENTS)
}

function toYuan(cents) {
  const n = Number(cents)
  if (!Number.isFinite(n)) return 0
  return Math.round(n) / CENTS
}

/** 分单位字段：缺字段/非法一律 0（这些字段是"没有就是 0 元"，不是 null 语义） */
function centsField(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

/**
 * 单据总额（分）。与既有 `shipmentAmount` 同口径，但优先用精确的 `totalCents`：
 *   ① `totalCents`（新字段，最精确）→ ② `totalAmount × 100`（旧数据/飞书导入）
 *   → ③ 明细 `totalPrice` 求和（最老的数据）
 * 三个来源的优先级是**刻意的**：宁可回落到旧字段，也不要因为新字段缺失就算成 0。
 */
function shipmentTotalCents(row) {
  const cents = Number(row && row.totalCents)
  if (Number.isFinite(cents) && cents > 0) return Math.round(cents)
  const amount = Number(row && row.totalAmount)
  if (Number.isFinite(amount) && amount !== 0) return Math.round(amount * CENTS)
  const items = Array.isArray(row && row.items) ? row.items : []
  if (!items.length) return 0
  return toCents(
    items.reduce(
      (n, it) => n + (Number(it.totalPrice) || (Number(it.qty) || 0) * (Number(it.unitPrice) || 0)),
      0
    )
  )
}

function settleStatusOf(row) {
  const s = String((row && row.settleStatus) || '').trim()
  return s || 'unsettled'
}

/**
 * 结算口径汇总。
 *
 * 口径（裁决 20，产品负责人拍板）：
 *   · `shippedAmount`     出货额：全部有效单据的总额（不管收没收钱）
 *   · `settledAmount`     已结清额：`settleStatus === 'settled'`
 *   · `outstandingAmount` 未收款额：**未结 + 已付待确认**（钱还没被确认到账）
 *   · `paidPendingAmount` 其中"门店已标已付、超管还没确认"的部分（待办）
 *   · `grossProfit`       真毛利 = 出货额 −（材料费 + 包装费）
 *                         —— **手工费算工作室的收入，不减**（裁决 20）
 *   · `netProfit`         既有口径 = 出货额 − 采购总额（保留，两者并列展示）
 *
 * @param {Array} shipments 有效出货单（已剔除作废/软删）
 */
function computeSettlementKpis(shipments) {
  const rows = Array.isArray(shipments) ? shipments : []
  let shippedCents = 0
  let settledCents = 0
  let outstandingCents = 0
  let paidPendingCents = 0
  let materialCents = 0
  let packagingCents = 0
  let sceneCents = 0
  let laborCents = 0
  let settledCount = 0
  let outstandingCount = 0
  let paidPendingCount = 0
  let pendingPricingCount = 0

  for (const row of rows) {
    const total = shipmentTotalCents(row)
    shippedCents += total
    materialCents += centsField(row && row.materialCostCents)
    packagingCents += centsField(row && row.packagingCostCents)
    /**
     * **造景成本**（产品负责人 2026-09-19 定）：它是**成本**，要进成本、扣毛利。
     * 与 `laborCents` 的区别：手工费是工作室的手工收入、**不减**（裁决 20），
     * 造景成本是买/做景的花费，**要减**。
     * ⚠️ 老单没有这个字段 → `centsField` 取 0，历史数字不变。
     */
    sceneCents += centsField(row && row.sceneCostCents)
    laborCents += centsField(row && row.laborCostCents)

    const st = settleStatusOf(row)
    if (st === 'settled') {
      settledCents += total
      settledCount += 1
    } else {
      outstandingCents += total
      outstandingCount += 1
      if (st === 'paid_pending') {
        paidPendingCents += total
        paidPendingCount += 1
      }
    }
    if (String((row && row.pricingStatus) || '') === 'incomplete') pendingPricingCount += 1
  }

  const costCents = materialCents + packagingCents + sceneCents
  const grossCents = shippedCents - costCents

  return {
    // 元（与既有 totalAmount/revenueTotal 同单位）
    shippedAmount: toYuan(shippedCents),
    settledAmount: toYuan(settledCents),
    outstandingAmount: toYuan(outstandingCents),
    paidPendingAmount: toYuan(paidPendingCents),
    materialCostTotal: toYuan(materialCents),
    packagingCostTotal: toYuan(packagingCents),
    sceneCostTotal: toYuan(sceneCents),
    laborTotal: toYuan(laborCents),
    /**
     * **成本合计 = 材料 + 包装 + 造景**（不含手工费：手工费算工作室收入 → 不减，裁决 20）。
     * 真毛利 = 出货额 − `costTotal`。
     */
    costTotal: toYuan(costCents),
    /**
     * ⚠️ 名字必须与含义一致：这一项**只**是 材料 + 包装，**不含造景**。
     * 2026-09-19 加造景桶时我一度把它也写成 `costCents`（含造景）——那是
     * 「名字说谎」，属于 E18/E21 同一类（字段名不反映真实口径）。名称口径以本条为准。
     */
    materialAndPackagingTotal: toYuan(materialCents + packagingCents),
    grossProfit: toYuan(grossCents),
    /** 毛利率（%）：出货额为 0 时返回 null（不是 0 —— 0% 与"没有数据"含义不同） */
    grossMarginPct: shippedCents > 0 ? Math.round((grossCents / shippedCents) * 1000) / 10 : null,
    // 计数
    settledCount,
    outstandingCount,
    paidPendingCount,
    /** 待核价单据数（有行没定好材料/包装）—— 这是"未收款"里最该先处理的一批 */
    pendingPricingCount,
    /** 口径说明直接回传，前端/看板不必各自解释 */
    note:
      '出货额=全部有效单据；已结清=超管已确认收款；未收款=未结+已付待确认。' +
      '真毛利=出货额−(材料费+包装费)，手工费算工作室收入不减（产品负责人 2026-09-19 裁决）。',
    unitNote: '内部一律以「分」运算，出口转元；金额字段 *_Cents 为分、其余为元'
  }
}

module.exports = {
  CENTS,
  toCents,
  toYuan,
  centsField,
  shipmentTotalCents,
  settleStatusOf,
  computeSettlementKpis
}
