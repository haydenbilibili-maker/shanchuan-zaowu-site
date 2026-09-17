/**
 * 商场月累计超额抽成（与云端 / ERP Finance SSOT 对齐）
 *
 * 公式：mallFee = max(0, R − threshold) × rate
 * 默认：阈值 ¥170,000，扣点 15%
 * 薪酬/销售分成基数 = R − mallFee；股东分红成本模型已含按日折算，展示不二次扣除。
 */
const DEFAULT_MALL_THRESHOLD = 170000
const DEFAULT_MALL_RATE = 0.15
const FORMULA_NOTE =
  '超额 = max（0, 月营收 − 抽成阈值），抽成 = 超额 × 扣点。默认阈值 ¥170,000、扣点 15%。月累计对赌口径；薪酬/分红基数先扣抽成。与成本明细中按日折算可能不一致，请以合同约定为准。'

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function formatMoney(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0.00'
  return v.toFixed(2)
}

function normalizeMallSettings(raw) {
  const s = raw || {}
  let threshold = Number(s.mallThreshold != null ? s.mallThreshold : s.threshold)
  if (!Number.isFinite(threshold) || threshold < 0) threshold = DEFAULT_MALL_THRESHOLD
  let rate = Number(s.mallRate != null ? s.mallRate : s.rate)
  if (!Number.isFinite(rate) || rate < 0) rate = DEFAULT_MALL_RATE
  if (rate > 1) rate /= 100
  return { mallThreshold: threshold, mallRate: rate }
}

function normalizeMallParams(settings) {
  const cfg = normalizeMallSettings(settings)
  return { threshold: cfg.mallThreshold, rate: cfg.mallRate }
}

function computeMonthlyMallFee(revenue, settings) {
  const cfg = normalizeMallSettings(settings)
  const R = Math.max(0, Number(revenue) || 0)
  const mallExcess = round2(Math.max(0, R - cfg.mallThreshold))
  const mallFee = round2(mallExcess * cfg.mallRate)
  const baseAfterMall = round2(Math.max(0, R - mallFee))
  return {
    mallThreshold: cfg.mallThreshold,
    mallThresholdFmt: formatMoney(cfg.mallThreshold),
    mallRate: cfg.mallRate,
    mallRatePct: Math.round(cfg.mallRate * 1000) / 10,
    revenue: round2(R),
    mallExcess,
    mallExcessFmt: formatMoney(mallExcess),
    mallFee,
    mallFeeFmt: formatMoney(mallFee),
    baseAfterMall,
    baseAfterMallFmt: formatMoney(baseAfterMall),
    formulaHint: `超额 = max（0, 月营收 − ¥${Math.round(cfg.mallThreshold).toLocaleString()}），抽成 = 超额 × ${(cfg.mallRate * 100).toFixed(0)}%（薪酬/分红基数先扣抽成）`,
    formulaNote: FORMULA_NOTE
  }
}

/** 与 managerPageConfig / ERP 命名对齐 */
function computeMallCommission(monthRevenue, settings) {
  const pack = computeMonthlyMallFee(monthRevenue, settings)
  return {
    threshold: pack.mallThreshold,
    rate: pack.mallRate,
    ratePct: pack.mallRatePct,
    reached: pack.revenue,
    excess: pack.mallExcess,
    fee: pack.mallFee,
    baseAfterMall: pack.baseAfterMall,
    formulaNote: FORMULA_NOTE
  }
}

function formatMallForUi(mall) {
  const m = mall || computeMallCommission(0)
  return {
    ...m,
    thresholdFmt: formatMoney(m.threshold),
    reachedFmt: formatMoney(m.reached),
    excessFmt: formatMoney(m.excess),
    feeFmt: formatMoney(m.fee),
    mallShareFmt: formatMoney(m.fee),
    baseAfterMallFmt: formatMoney(m.baseAfterMall),
    formulaNote: m.formulaNote || FORMULA_NOTE
  }
}

module.exports = {
  DEFAULT_MALL_THRESHOLD,
  DEFAULT_MALL_RATE,
  FORMULA_NOTE,
  normalizeMallSettings,
  normalizeMallParams,
  computeMonthlyMallFee,
  computeMallCommission,
  formatMallForUi
}
