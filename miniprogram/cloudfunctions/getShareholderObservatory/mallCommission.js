/**
 * 商场月累计超额抽成（财务 SSOT）
 *
 * 公式：mallFee = max(0, R − threshold) × rate
 * 默认：阈值 ¥170,000，扣点 15%
 *
 * 与 ERP Finance「商场分成情况」、销售分成 mallCommission 同口径。
 * 股东分红利润经 calcProfit 已含按日折算商场成本，展示月累计 mallFee 仅作合同口径，不二次扣除。
 */
const DEFAULT_MALL_THRESHOLD = 170000
const DEFAULT_MALL_RATE = 0.15
const FORMULA_NOTE =
  '商场抽成 SSOT：mallFee = max(0, 营收 − ¥170,000) × 15%；分红利润已在成本模型中计入商场成本，观测台「商场超额分成」仅合同口径展示，不重复扣除。薪酬/销售分成基数 = 营收 − mallFee。'

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function money(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0.00'
  return v.toFixed(2)
}

function normalizeMallSettings(raw) {
  const s = raw || {}
  let threshold = Number(s.mallThreshold)
  if (!Number.isFinite(threshold) || threshold < 0) threshold = DEFAULT_MALL_THRESHOLD
  let rate = Number(s.mallRate)
  if (!Number.isFinite(rate) || rate < 0) rate = DEFAULT_MALL_RATE
  if (rate > 1) rate /= 100
  return { mallThreshold: threshold, mallRate: rate }
}

/**
 * 月累计对赌口径（SSOT）
 * @param {number} revenue 周期/月营收基数 R
 * @param {{ mallThreshold?: number, mallRate?: number }|null} [settings]
 */
function computeMonthlyMallFee(revenue, settings) {
  const cfg = normalizeMallSettings(settings)
  const R = Math.max(0, Number(revenue) || 0)
  const mallExcess = round2(Math.max(0, R - cfg.mallThreshold))
  const mallFee = round2(mallExcess * cfg.mallRate)
  const baseAfterMall = round2(Math.max(0, R - mallFee))
  return {
    mallThreshold: cfg.mallThreshold,
    mallRate: cfg.mallRate,
    mallRatePct: Math.round(cfg.mallRate * 1000) / 10,
    revenue: round2(R),
    mallExcess,
    mallFee,
    baseAfterMall,
    formulaNote: `商场抽成 = max(0, 营收 − ¥${Math.round(cfg.mallThreshold).toLocaleString()}) × ${(cfg.mallRate * 100).toFixed(0)}%`
  }
}

/** 别名：与股东观测台 / ERP 命名对齐 */
function computeMallCommission(revenue, settings) {
  const pack = computeMonthlyMallFee(revenue, settings)
  return {
    threshold: pack.mallThreshold,
    rate: pack.mallRate,
    ratePct: pack.mallRatePct,
    reached: pack.revenue,
    excess: pack.mallExcess,
    fee: pack.mallFee,
    baseAfterMall: pack.baseAfterMall,
    formulaNote: pack.formulaNote
  }
}

/**
 * 成本模型按日折算（与 Finance.vue calcProfit 同口径）
 * 日阈值 = 月阈值 / 30；仅用于日利润估算，不替代月累计 SSOT 展示。
 */
function computeDailyMallCost(revenue, settings) {
  const cfg = normalizeMallSettings(settings)
  const rev = Math.max(0, Number(revenue) || 0)
  const dailyThreshold = (cfg.mallThreshold || 0) / 30
  if (rev <= dailyThreshold) return 0
  return round2((rev - dailyThreshold) * (cfg.mallRate || 0))
}

function formatMallForUi(mall) {
  const m = mall || {}
  return {
    threshold: Number(m.threshold) || 0,
    thresholdFmt: money(m.threshold),
    reached: Number(m.reached) || 0,
    reachedFmt: money(m.reached),
    excess: Number(m.excess) || 0,
    excessFmt: money(m.excess),
    fee: Number(m.fee) || 0,
    feeFmt: money(m.fee),
    ratePct: Number(m.ratePct) || 0,
    baseAfterMall: Number(m.baseAfterMall) || 0,
    baseAfterMallFmt: money(m.baseAfterMall),
    formulaNote: m.formulaNote || FORMULA_NOTE
  }
}

module.exports = {
  DEFAULT_MALL_THRESHOLD,
  DEFAULT_MALL_RATE,
  FORMULA_NOTE,
  normalizeMallSettings,
  computeMonthlyMallFee,
  computeMallCommission,
  computeDailyMallCost,
  formatMallForUi
}
