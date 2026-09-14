/**
 * 商场月累计超额抽成 — 多端 SSOT（CJS 镜像，供 Node 脚本引用）
 *
 * 公式：超额 = max(0, 月营收 − 阈值)；抽成 = 超额 × 扣点
 * 默认：阈值 170000 元，扣点 15%
 */
const DEFAULT_MALL_THRESHOLD = 170000
const DEFAULT_MALL_RATE = 0.15

const FORMULA_NOTE =
  '超额 = max(0, 月营收 − 抽成阈值)，抽成 = 超额 × 扣点。默认阈值 ¥170,000、扣点 15%。月累计对赌口径；员工销售分成与股东分红等基数先扣本抽成。成本明细按日折算可并存，分红利润已含日成本故不二次扣除月累计额。'

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function normalizeMallParams(settings) {
  const s = settings || {}
  let threshold = Number(s.mallThreshold)
  if (!Number.isFinite(threshold) || threshold < 0) threshold = DEFAULT_MALL_THRESHOLD
  let rate = Number(s.mallRate)
  if (!Number.isFinite(rate) || rate < 0) rate = DEFAULT_MALL_RATE
  if (rate > 1) rate /= 100
  return { threshold, rate }
}

function computeMallCommission(monthRevenue, settings) {
  const { threshold, rate } = normalizeMallParams(settings)
  const reached = Math.max(0, Number(monthRevenue) || 0)
  const excess = Math.max(0, reached - threshold)
  const fee = round2(excess * rate)
  const baseAfterMall = round2(Math.max(0, reached - fee))
  return {
    threshold,
    rate,
    ratePct: Math.round(rate * 1000) / 10,
    reached: round2(reached),
    excess: round2(excess),
    fee,
    baseAfterMall,
    formulaNote: FORMULA_NOTE
  }
}

function computeDailyMallCost(dayRevenue, settings) {
  const { threshold, rate } = normalizeMallParams(settings)
  const dailyThreshold = threshold / 30
  const rev = Math.max(0, Number(dayRevenue) || 0)
  if (rev <= dailyThreshold) return 0
  return (rev - dailyThreshold) * rate
}

function formatMallForUi(mall) {
  const m = mall || computeMallCommission(0)
  const fmt = (n) => round2(n).toFixed(2)
  return {
    ...m,
    thresholdFmt: fmt(m.threshold),
    reachedFmt: fmt(m.reached),
    excessFmt: fmt(m.excess),
    feeFmt: fmt(m.fee),
    mallShareFmt: fmt(m.fee),
    baseAfterMallFmt: fmt(m.baseAfterMall || Math.max(0, (m.reached || 0) - (m.fee || 0)))
  }
}

module.exports = {
  DEFAULT_MALL_THRESHOLD,
  DEFAULT_MALL_RATE,
  FORMULA_NOTE,
  normalizeMallParams,
  computeMallCommission,
  computeDailyMallCost,
  formatMallForUi
}
