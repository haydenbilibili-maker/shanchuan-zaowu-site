/**
 * 商场月累计超额抽成 — 多端 SSOT（与小程序云函数 mallCommission 对齐）
 *
 * 公式：mallFee = max(0, R − threshold) × rate
 * 默认：阈值 ¥170,000，扣点 15%
 */
export const DEFAULT_MALL_THRESHOLD = 170000
export const DEFAULT_MALL_RATE = 0.15

export const FORMULA_NOTE =
  '超额 = max(0, 月营收 − 抽成阈值)，抽成 = 超额 × 扣点。默认阈值 ¥170,000、扣点 15%。月累计对赌口径；员工销售分成等基数先扣本抽成。成本明细按日折算可并存；股东分红利润已含日成本故不二次扣除月累计额。'

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

export function normalizeMallParams(settings) {
  const s = settings || {}
  let threshold = Number(s.mallThreshold)
  if (!Number.isFinite(threshold) || threshold < 0) threshold = DEFAULT_MALL_THRESHOLD
  let rate = Number(s.mallRate)
  if (!Number.isFinite(rate) || rate < 0) rate = DEFAULT_MALL_RATE
  if (rate > 1) rate /= 100
  return { threshold, rate }
}

export function normalizeMallSettings(settings) {
  const { threshold, rate } = normalizeMallParams(settings)
  return { mallThreshold: threshold, mallRate: rate }
}

export function computeMonthlyMallFee(monthRevenue, settings) {
  const cfg = normalizeMallSettings(settings)
  const R = Math.max(0, Number(monthRevenue) || 0)
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
    formulaNote: FORMULA_NOTE
  }
}

export function computeMallCommission(monthRevenue, settings) {
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

/** 日成本模型：月阈值 ÷ 30 后按日超额计成本（与 Finance.vue calcProfit 历史口径一致） */
export function computeDailyMallCost(dayRevenue, settings) {
  const { threshold, rate } = normalizeMallParams(settings)
  const dailyThreshold = threshold / 30
  const rev = Math.max(0, Number(dayRevenue) || 0)
  if (rev <= dailyThreshold) return 0
  return (rev - dailyThreshold) * rate
}

export function formatMallForUi(mall) {
  const m = mall || computeMallCommission(0)
  const fmt = (n) => round2(n).toFixed(2)
  return {
    ...m,
    thresholdFmt: fmt(m.threshold),
    reachedFmt: fmt(m.reached),
    excessFmt: fmt(m.excess),
    feeFmt: fmt(m.fee),
    mallShareFmt: fmt(m.fee),
    baseAfterMallFmt: fmt(m.baseAfterMall),
    formulaNote: m.formulaNote || FORMULA_NOTE
  }
}
