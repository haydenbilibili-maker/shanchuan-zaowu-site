/**
 * 物业合作测算 v3 模型
 * 与《山海造物_水文化园19号楼_收益测算模型_v3.xlsx》100% 对齐
 *
 * 核心思想：
 * - 以『这有山』门店实测坪效为锚
 * - 通过大店密度折让系数推算旗舰坪效（下行/中性/上行 = 锚×折让 ±20%）
 * - 园区分润按【可分润毛利】= 营收 × (毛利率 − 必要成本率)，非营收
 *
 * 单位：所有金额按"万元"，坪效按"元/㎡/月"，比例按 0-1 小数
 */

const round2 = (n) => Math.round(n * 100) / 100
const round4 = (n) => Math.round(n * 10000) / 10000
// null 透传版：computePayback/computeIRR 用 null 表示"未回本/不收敛"，不能被 round 吞成 0
const r2n = (n) => (n == null ? null : round2(n))
const r4n = (n) => (n == null ? null : round4(n))
// 比例安全除法：分母为 0 时返回 null（如 baseRent=0 时传统租金为 0）
const safeRatio = (num, den) => (den > 0 ? round4(num / den) : null)

// ============ v3 默认输入（与 Excel 完全一致） ============
export const DEFAULT_INPUTS = {
  // 物业元数据
  name: '',
  city: '',
  address: '',
  proposalDate: '',
  status: 'evaluating', // evaluating | negotiating | signed | rejected

  // 一、关键参数
  areaTotal: 1000,           // 名义建筑面积 (㎡)
  areaOpRatio: 0.6,          // 经营面积占比
  // 锚点（这有山门店实测）
  anchorArea: 70,            // 这有山门店面积 (㎡)
  anchorRevenueLow: 20,      // 淡季月营收 (万元)
  anchorRevenueHigh: 30,     // 旺季月营收 (万元)
  anchorNetMargin: 0.495,    // 这有山实测净利率（参考）
  // 大店折让
  bigStoreDiscount: 0.30,    // vs 这有山的坪效折让系数（30% = 比这有山低 70%）
  // 情景开关
  scenario: 2,               // 1 下行 / 2 中性 / 3 上行
  // 营收增长
  growthY2: 0.30,
  growthY3: 0.25,
  monthsPerYear: 12,
  // 经营假设
  grossMargin: 0.60,         // 综合毛利率
  opCostRate: 0.20,          // 必要运营成本率
  // 当地租金
  baseRent: 80,              // 当地可比租金 (元/㎡/月)
  rentGrowth: 0.05,
  // 四种合作结构
  rev_pure_share: 0.28,       // 纯分成（毛利比例）
  rev_floor_rent: 30,         // 保底+分成的保底（元/㎡/月）
  rev_floor_share: 0.22,      // 保底+分成的毛利抽成比例
  ladder_floor_rent: 20,      // 阶梯保底（元/㎡/月）
  ladder_share_y1: 0.20,
  ladder_share_y2: 0.25,
  ladder_share_y3: 0.30,

  // 进阶：改造投入
  renovOp: 2800,             // 经营区改造 (元/㎡)
  renovPublic: 2000,         // 公共区改造 (元/㎡)
  renovPublicParkPart: 0.60, // 园区承担公共区比例
  renovBase: 1200,           // 基础/结构改造 (元/㎡)
  renovBaseParkPart: 0.80,   // 园区承担基础比例
  capexExhibition: 50,       // 标本展陈 (万元)
  capexIP: 18,               // 双 IP 装置 (万元)
  capexWorkshop: 28,         // 工坊设备 (万元)
  capexDesign: 45,           // 设计软装
  capexPrep: 18,             // 开办筹备
  steadyGrowth: 0.08         // 稳态年增长（第四年起）
}

// ============ 计算引擎 ============

/**
 * @param {DEFAULT_INPUTS} i
 * @returns {Object} 完整测算结果（与 Excel 各区块对齐）
 */
export function computeProposal(i = DEFAULT_INPUTS) {
  // —— 派生面积 ——
  const areaOp = i.areaTotal * i.areaOpRatio
  const areaPublic = i.areaTotal - areaOp

  // —— 锚点坪效（这有山门店实测）——
  const anchorEffLow = (i.anchorRevenueLow * 10000) / i.anchorArea  // 元/㎡/月
  const anchorEffHigh = (i.anchorRevenueHigh * 10000) / i.anchorArea
  const anchorEffMid = (anchorEffLow + anchorEffHigh) / 2

  // —— 旗舰坪效（含 30% 大店折让）——
  const flagshipMid = anchorEffMid * i.bigStoreDiscount   // 中性
  const flagshipLow = flagshipMid * 0.8                    // 下行 = 中性 × 0.8
  const flagshipHigh = flagshipMid * 1.2                   // 上行 = 中性 × 1.2

  const currentEff = i.scenario === 1 ? flagshipLow : (i.scenario === 3 ? flagshipHigh : flagshipMid)

  // —— 营收（万元）——
  const revY1 = (currentEff * areaOp * i.monthsPerYear) / 10000
  const revY2 = revY1 * (1 + i.growthY2)
  const revY3 = revY2 * (1 + i.growthY3)
  const revTotal3 = revY1 + revY2 + revY3

  // —— 可分润毛利 = 营收 × (毛利率 − 必要成本率) ——
  const grossRate = i.grossMargin - i.opCostRate
  const grossY1 = revY1 * grossRate
  const grossY2 = revY2 * grossRate
  const grossY3 = revY3 * grossRate
  const grossTotal3 = grossY1 + grossY2 + grossY3

  // —— 四种合作结构 · 园区所得（万元）——
  // 注：与 v3 Excel 100% 对齐
  // (1) 传统固定租金 = baseRent × 名义建筑面积 × 12 / 10000（按全楼计租，符合商业地产惯例）
  const traditionalRentY1 = (i.baseRent * i.areaTotal * 12) / 10000
  const traditionalRentY2 = traditionalRentY1 * (1 + i.rentGrowth)
  const traditionalRentY3 = traditionalRentY2 * (1 + i.rentGrowth)
  const traditionalTotal3 = traditionalRentY1 + traditionalRentY2 + traditionalRentY3

  // (2) 纯分成（毛利比例）
  const pureShareY1 = grossY1 * i.rev_pure_share
  const pureShareY2 = grossY2 * i.rev_pure_share
  const pureShareY3 = grossY3 * i.rev_pure_share
  const pureShareTotal3 = pureShareY1 + pureShareY2 + pureShareY3

  // (3) 保底 + 毛利抽成 — 取保底与抽成的较大者（floor 为兜底，营收高时按 share）
  const floorBaseY = (i.rev_floor_rent * areaOp * 12) / 10000
  const floorY1 = Math.max(floorBaseY, grossY1 * i.rev_floor_share)
  const floorY2 = Math.max(floorBaseY, grossY2 * i.rev_floor_share)
  const floorY3 = Math.max(floorBaseY, grossY3 * i.rev_floor_share)
  const floorTotal3 = floorY1 + floorY2 + floorY3

  // (4) 阶梯·毛利分润（推荐）— 取保底与逐年抽成的较大者
  const ladderBaseY = (i.ladder_floor_rent * areaOp * 12) / 10000
  const ladderY1 = Math.max(ladderBaseY, grossY1 * i.ladder_share_y1)
  const ladderY2 = Math.max(ladderBaseY, grossY2 * i.ladder_share_y2)
  const ladderY3 = Math.max(ladderBaseY, grossY3 * i.ladder_share_y3)
  const ladderTotal3 = ladderY1 + ladderY2 + ladderY3

  // —— 山海毛利留存 = 可分润毛利 − 园区所得 ——
  const retentionTraditional = grossTotal3 - traditionalTotal3
  const retentionPure = grossTotal3 - pureShareTotal3
  const retentionFloor = grossTotal3 - floorTotal3
  const retentionLadder = grossTotal3 - ladderTotal3

  // —— 五年现金流（用阶梯结构） ——
  const revY4 = revY3 * (1 + i.steadyGrowth)
  const revY5 = revY4 * (1 + i.steadyGrowth)
  const grossY4 = revY4 * grossRate
  const grossY5 = revY5 * grossRate
  const ladderY4 = Math.max(ladderBaseY, grossY4 * i.ladder_share_y3)   // 第 4 年起锁顶档
  const ladderY5 = Math.max(ladderBaseY, grossY5 * i.ladder_share_y3)
  const profitY1 = grossY1 - ladderY1
  const profitY2 = grossY2 - ladderY2
  const profitY3 = grossY3 - ladderY3
  const profitY4 = grossY4 - ladderY4
  const profitY5 = grossY5 - ladderY5

  // —— 改造投入（万元）——
  const renovOpTotal = (i.renovOp * areaOp) / 10000
  const renovPublicTotal = (i.renovPublic * areaPublic) / 10000
  const renovPublicSelf = renovPublicTotal * (1 - i.renovPublicParkPart)
  const renovBaseTotal = (i.renovBase * i.areaTotal) / 10000
  const renovBaseSelf = renovBaseTotal * (1 - i.renovBaseParkPart)
  const capexTotal = i.capexExhibition + i.capexIP + i.capexWorkshop
  const capexAll = renovOpTotal + renovPublicSelf + renovBaseSelf + capexTotal + i.capexDesign + i.capexPrep
  const parkBearCapex = renovPublicTotal * i.renovPublicParkPart + renovBaseTotal * i.renovBaseParkPart

  // —— 五年累计 ——
  const cashflow = [
    { period: '投入期', revenue: 0, gross: 0, parkShare: 0, profit: 0, capex: -capexAll, net: -capexAll, cum: -capexAll },
    { period: '第一年', revenue: revY1, gross: grossY1, parkShare: -ladderY1, profit: profitY1, capex: 0, net: profitY1, cum: -capexAll + profitY1 },
    { period: '第二年', revenue: revY2, gross: grossY2, parkShare: -ladderY2, profit: profitY2, capex: 0, net: profitY2, cum: -capexAll + profitY1 + profitY2 },
    { period: '第三年', revenue: revY3, gross: grossY3, parkShare: -ladderY3, profit: profitY3, capex: 0, net: profitY3, cum: -capexAll + profitY1 + profitY2 + profitY3 },
    { period: '第四年', revenue: revY4, gross: grossY4, parkShare: -ladderY4, profit: profitY4, capex: 0, net: profitY4, cum: -capexAll + profitY1 + profitY2 + profitY3 + profitY4 },
    { period: '第五年', revenue: revY5, gross: grossY5, parkShare: -ladderY5, profit: profitY5, capex: 0, net: profitY5, cum: -capexAll + profitY1 + profitY2 + profitY3 + profitY4 + profitY5 }
  ]

  // —— 回本周期（自开业起；按累计 profit 跨越 capexAll 的小数年） ——
  const paybackLadder = computePayback(capexAll, [profitY1, profitY2, profitY3, profitY4, profitY5])
  const paybackTraditional = computePayback(capexAll, [
    grossY1 - traditionalRentY1,
    grossY2 - traditionalRentY2,
    grossY3 - traditionalRentY3,
    grossY4 - traditionalRentY3 * (1 + i.rentGrowth),
    grossY5 - traditionalRentY3 * (1 + i.rentGrowth) * (1 + i.rentGrowth)
  ])
  const paybackPure = computePayback(capexAll, [
    grossY1 - pureShareY1, grossY2 - pureShareY2, grossY3 - pureShareY3,
    grossY4 - grossY4 * i.rev_pure_share, grossY5 - grossY5 * i.rev_pure_share
  ])
  const paybackFloor = computePayback(capexAll, [
    grossY1 - floorY1, grossY2 - floorY2, grossY3 - floorY3,
    // 与第 1-3 年口径一致：保底与抽成取大（非相加）
    grossY4 - Math.max(floorBaseY, grossY4 * i.rev_floor_share),
    grossY5 - Math.max(floorBaseY, grossY5 * i.rev_floor_share)
  ])

  // —— 五年累计经营利润（阶梯） ——
  const total5YearProfit = profitY1 + profitY2 + profitY3 + profitY4 + profitY5
  const fiveYearROI = capexAll > 0 ? total5YearProfit / capexAll : 0
  const irr5 = computeIRR([-capexAll, profitY1, profitY2, profitY3, profitY4, profitY5])

  // —— 三情景敏感性 ——
  const sensitivity = ['low', 'mid', 'high'].map(s => {
    const eff = s === 'low' ? flagshipLow : (s === 'high' ? flagshipHigh : flagshipMid)
    const r1 = (eff * areaOp * i.monthsPerYear) / 10000
    const r2 = r1 * (1 + i.growthY2)
    const r3 = r2 * (1 + i.growthY3)
    const rTotal = r1 + r2 + r3
    const g1 = r1 * grossRate, g2 = r2 * grossRate, g3 = r3 * grossRate
    const gTotal = g1 + g2 + g3
    const lb = ladderBaseY
    const l1 = Math.max(lb, g1 * i.ladder_share_y1)
    const l2 = Math.max(lb, g2 * i.ladder_share_y2)
    const l3 = Math.max(lb, g3 * i.ladder_share_y3)
    const lTotal = l1 + l2 + l3
    return {
      label: { low: '下行（保守）', mid: '中性（基准）', high: '上行（乐观）' }[s],
      eff: round2(eff),
      revTotal: round2(rTotal),
      parkTraditional: round2(traditionalTotal3),     // 三档相同
      parkLadder: round2(lTotal),
      retentionLadder: round2(gTotal - lTotal),
      effectiveShareRate: gTotal > 0 ? round4(lTotal / gTotal) : 0
    }
  })

  return {
    derived: {
      areaOp, areaPublic,
      anchorEffLow: round2(anchorEffLow), anchorEffHigh: round2(anchorEffHigh), anchorEffMid: round2(anchorEffMid),
      flagshipLow: round2(flagshipLow), flagshipMid: round2(flagshipMid), flagshipHigh: round2(flagshipHigh),
      currentEff: round2(currentEff)
    },
    revenue: {
      y1: round2(revY1), y2: round2(revY2), y3: round2(revY3), total: round2(revTotal3)
    },
    gross: {
      y1: round2(grossY1), y2: round2(grossY2), y3: round2(grossY3), total: round2(grossTotal3),
      rate: round4(grossRate)
    },
    structures: [
      {
        key: 'traditional', name: '传统固定租金',
        y1: round2(traditionalRentY1), y2: round2(traditionalRentY2), y3: round2(traditionalRentY3),
        total: round2(traditionalTotal3),
        deltaVsTraditional: 0,
        retention: round2(retentionTraditional),
        retentionShareOfGross: grossTotal3 > 0 ? round4(traditionalTotal3 / grossTotal3) : 0
      },
      {
        key: 'pure', name: '纯分成（毛利比例）',
        y1: round2(pureShareY1), y2: round2(pureShareY2), y3: round2(pureShareY3),
        total: round2(pureShareTotal3),
        deltaVsTraditional: safeRatio(pureShareTotal3 - traditionalTotal3, traditionalTotal3),
        retention: round2(retentionPure),
        retentionShareOfGross: grossTotal3 > 0 ? round4(pureShareTotal3 / grossTotal3) : 0
      },
      {
        key: 'floor', name: '保底 + 毛利抽成',
        y1: round2(floorY1), y2: round2(floorY2), y3: round2(floorY3),
        total: round2(floorTotal3),
        deltaVsTraditional: safeRatio(floorTotal3 - traditionalTotal3, traditionalTotal3),
        retention: round2(retentionFloor),
        retentionShareOfGross: grossTotal3 > 0 ? round4(floorTotal3 / grossTotal3) : 0
      },
      {
        key: 'ladder', name: '阶梯·毛利分润（推荐）', recommended: true,
        y1: round2(ladderY1), y2: round2(ladderY2), y3: round2(ladderY3),
        total: round2(ladderTotal3),
        deltaVsTraditional: safeRatio(ladderTotal3 - traditionalTotal3, traditionalTotal3),
        retention: round2(retentionLadder),
        retentionShareOfGross: grossTotal3 > 0 ? round4(ladderTotal3 / grossTotal3) : 0
      }
    ],
    capex: {
      renovOpTotal: round2(renovOpTotal),
      renovPublicTotal: round2(renovPublicTotal),
      renovPublicSelf: round2(renovPublicSelf),
      renovBaseTotal: round2(renovBaseTotal),
      renovBaseSelf: round2(renovBaseSelf),
      capexSpecial: round2(capexTotal),
      capexDesign: i.capexDesign,
      capexPrep: i.capexPrep,
      capexAll: round2(capexAll),
      parkBear: round2(parkBearCapex)
    },
    cashflow: cashflow.map(c => ({
      ...c,
      revenue: round2(c.revenue), gross: round2(c.gross), parkShare: round2(c.parkShare),
      profit: round2(c.profit), capex: round2(c.capex), net: round2(c.net), cum: round2(c.cum)
    })),
    metrics: {
      capexAll: round2(capexAll),
      paybackLadder: r2n(paybackLadder),
      paybackTraditional: r2n(paybackTraditional),
      paybackPure: r2n(paybackPure),
      paybackFloor: r2n(paybackFloor),
      threeYearProfitLadder: round2(retentionLadder),
      fiveYearProfitLadder: round2(total5YearProfit),
      fiveYearROI: round2(fiveYearROI),
      irr5: r4n(irr5)
    },
    sensitivity,
    summary: {
      recommendedTotal: round2(ladderTotal3),
      recommendedDelta: safeRatio(ladderTotal3 - traditionalTotal3, traditionalTotal3),
      effectiveShareRate: grossTotal3 > 0 ? round4(ladderTotal3 / grossTotal3) : 0
    }
  }
}

// ============ 回本周期 ============
function computePayback(invest, yearlyProfits) {
  if (invest <= 0) return 0
  let cum = 0
  for (let i = 0; i < yearlyProfits.length; i++) {
    const next = cum + yearlyProfits[i]
    if (next >= invest) {
      const remain = invest - cum
      return i + (remain / yearlyProfits[i])
    }
    cum = next
  }
  return null // 五年未回本
}

// ============ IRR (Newton 法) ============
function computeIRR(cashflows, guess = 0.1) {
  const npv = (rate) => cashflows.reduce((s, c, i) => s + c / Math.pow(1 + rate, i), 0)
  const dnpv = (rate) => cashflows.reduce((s, c, i) => s - i * c / Math.pow(1 + rate, i + 1), 0)
  let rate = guess
  for (let k = 0; k < 100; k++) {
    const f = npv(rate)
    const df = dnpv(rate)
    if (Math.abs(f) < 1e-6) return rate
    // 导数为 0：若已接近根则收敛返回，否则视为发散
    if (df === 0) return Math.abs(f) < 1e-4 ? rate : null
    rate = rate - f / df
    if (rate < -0.99) rate = -0.99
    if (rate > 10) rate = 10
  }
  // 100 次未收敛：容差放宽到 1e-4（钳制震荡时真实根附近也算收敛），否则返回 null 表示发散
  return Math.abs(npv(rate)) < 1e-4 ? rate : null
}

// ============ 预置案例 ============
export const PRESET_PROPERTIES = [
  {
    id: 'preset-shuiwenhua-19',
    name: '长春水文化生态园19号楼',
    city: '长春',
    address: '长春市水文化生态园 19 号楼',
    proposalDate: '2026-05-29',
    status: 'evaluating',
    isPreset: true,
    // 与 v3 Excel 完全一致
    areaTotal: 1000,
    areaOpRatio: 0.6,
    anchorArea: 70,
    anchorRevenueLow: 20,
    anchorRevenueHigh: 30,
    anchorNetMargin: 0.495,
    bigStoreDiscount: 0.30,
    scenario: 2,
    growthY2: 0.30,
    growthY3: 0.25,
    monthsPerYear: 12,
    grossMargin: 0.60,
    opCostRate: 0.20,
    baseRent: 80,
    rentGrowth: 0.05,
    rev_pure_share: 0.28,
    rev_floor_rent: 30,
    rev_floor_share: 0.22,
    ladder_floor_rent: 20,
    ladder_share_y1: 0.20,
    ladder_share_y2: 0.25,
    ladder_share_y3: 0.30,
    renovOp: 2800,
    renovPublic: 2000,
    renovPublicParkPart: 0.60,
    renovBase: 1200,
    renovBaseParkPart: 0.80,
    capexExhibition: 50,
    capexIP: 18,
    capexWorkshop: 28,
    capexDesign: 45,
    capexPrep: 18,
    steadyGrowth: 0.08,
    note: '依据《物业合作提案 v3》。以这有山门店实测坪效为锚（淡季 2857 / 旺季 4286 元/㎡/月），通过 0.30 大店折让推算旗舰坪效；中性情景下经营坪效 ≈ 1071 元/㎡/月；推荐阶梯·毛利分润结构。'
  }
]

export const STATUS_LABELS = {
  evaluating: { text: '评估中', type: 'warning', icon: '🔍' },
  negotiating: { text: '谈判中', type: 'primary', icon: '🤝' },
  signed: { text: '已签约', type: 'success', icon: '✅' },
  rejected: { text: '已搁置', type: 'info', icon: '🛑' }
}
