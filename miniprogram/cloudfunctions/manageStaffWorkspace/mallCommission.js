/**
 * 商场月累计超额抽成（财务 SSOT）
 *
 * 公式：mallFee = max(0, R − threshold) × rate（R = 单店月营收；多店合计 = 各店分别计后相加）
 * 默认：阈值 ¥170,000，扣点 15%
 *
 * 与 ERP Finance「商场分成情况」、股东观测台 period.mallShare 同口径。
 * 员工销售分成基数 = R − mallFee。
 * 股东分红：成本模型 calcProfit 已按日折算计入商场成本，不得再从分红池二次扣除本 mallFee。
 */
const DEFAULT_MALL_THRESHOLD = 170000
const DEFAULT_MALL_RATE = 0.15

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
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

/**
 * 多店口径：商场抽成只按单店算 —— 每店 max(0, 该店营收 − threshold) × rate，合计 = 各店之和。
 * 不得把多店营收先加总再套阈值（2026-09-30 产品负责人口径）。
 * @param {Array<{ storeId?: string, name?: string, revenue: number }>} stores
 * @param {{ mallThreshold?: number, mallRate?: number }|null} [settings]
 */
function computeMallFeeByStores(stores, settings) {
  const cfg = normalizeMallSettings(settings)
  const byStore = (stores || []).map((s) => {
    const one = computeMonthlyMallFee(s && s.revenue, cfg)
    return {
      storeId: (s && s.storeId) || '',
      name: (s && s.name) || (s && s.storeId) || '',
      revenue: one.revenue,
      mallExcess: one.mallExcess,
      mallFee: one.mallFee,
      reached: one.mallExcess > 0
    }
  })
  const revenue = round2(byStore.reduce((a, s) => a + s.revenue, 0))
  const mallExcess = round2(byStore.reduce((a, s) => a + s.mallExcess, 0))
  const mallFee = round2(byStore.reduce((a, s) => a + s.mallFee, 0))
  return {
    mallThreshold: cfg.mallThreshold,
    mallRate: cfg.mallRate,
    mallRatePct: Math.round(cfg.mallRate * 1000) / 10,
    revenue,
    mallExcess,
    mallFee,
    baseAfterMall: round2(Math.max(0, revenue - mallFee)),
    byStore
  }
}

module.exports = {
  DEFAULT_MALL_THRESHOLD,
  DEFAULT_MALL_RATE,
  normalizeMallSettings,
  computeMonthlyMallFee,
  computeMallFeeByStores
}
