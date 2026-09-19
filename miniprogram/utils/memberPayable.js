/**
 * 会员价计算 — **主包**共享件（编排页与下单页共用）
 *
 * ## 为什么必须放主包、并且**内联**这几个函数
 *
 * 微信硬约束：**分包只能引用「主包 + 自己」，分包之间不能互相引用**；主包也不能引用分包文件
 * （`check:subpackage-refs` 实测会红：「跨包会让该分包内页面全部起不来」）。
 * 而编排页在 `subpackages/feature/gift`、下单页在 `subpackages/business` ——
 * 两页**无法**共享 `subpackages/business/utils/memberPricing.js`。
 *
 * 因此本件把 `memberPricing.js` 的三个**纯函数**逐字抽到主包：
 * `normalizeDiscountRate` / `levelRate` / `resolveFromLadder`（**逐字一致，非转写**）。
 * 守卫 `check:member-pricing-sync` 钉住这两份的同名函数**逐字相同** ——
 * 这就是"复制"在这里可接受的前提（本仓 `staffGuard` 57 份、`pricingCore` 2 份同此模式）。
 *
 * ## 口径取舍：只做「当前等级会员价」，**不含预估升级**
 *
 * 下单页的费率可能是 `resolveProjectedUpgrade` 的**预估升级**结果，它依赖
 * `orderGrowthEstimate`（**整单**成长值，含运费与优惠券）。编排页此刻只有一个商品 + 数量，
 * 没有整单上下文 ⇒ **拿不到同一个数**。
 *
 * 产品负责人 2026-09-19 选定：编排页显示 **当前等级会员价**，并标注「实际以结算页为准」。
 * 未触发升级时与下单页**完全一致**；若本单会升级，下单页**更低**（编排页偏保守，不误导）。
 */

function normalizeDiscountRate(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 1
  if (n > 10) return Math.min(1, Math.round((n / 100) * 10000) / 10000)
  if (n > 1) return Math.min(1, Math.round((n / 10) * 10000) / 10000)
  return Math.round(n * 10000) / 10000
}

function levelRate(row) {
  if (!row) return 1
  if (row.discount != null && row.discount !== '') return normalizeDiscountRate(row.discount)
  return normalizeDiscountRate(row.discountRate)
}

function resolveFromLadder(ladder, growthValue, isHonorary) {
  const list = Array.isArray(ladder) ? ladder.slice() : []
  list.sort((a, b) => (Number(a.level) || 0) - (Number(b.level) || 0))
  const growth = Math.max(0, Math.floor(Number(growthValue) || 0))
  const honorary = list.find((l) => Number(l.level) === 99)

  if (isHonorary) {
    return {
      level: 99,
      levelName: (honorary && honorary.name) || '荣誉馆长',
      discountRate: honorary ? levelRate(honorary) : 0.8
    }
  }

  const paid = list.filter((l) => Number(l.level) !== 99)
  let current = paid[0] || {
    level: 1,
    name: '原木·见习者',
    threshold: 0,
    discount: 1
  }
  paid.forEach((row) => {
    const th = Math.max(0, Math.floor(Number(row.threshold) || 0))
    if (growth >= th) current = row
  })

  return {
    level: current.level,
    levelName: current.name,
    discountRate: levelRate(current)
  }
}
/** 费率兜底：非法值一律 1.0（不打折），绝不因脏数据把价格算成 0 或负 */
const FULL_RATE = 1

/**
 * 可信费率下界。为什么需要它：`normalizeDiscountRate` 为兼容「9.5 折 / 95 百分数」两种写法
 * 会把 >1 的值除以 10 或 100 —— 于是脏数据 `1.05`（本意可能是「105%」）会被归一成
 * **0.105**，即近乎免费。会员体系最优档是 7 折（云库 DEFAULT_LEVELS），
 * 故取 0.5 作为「这还能叫会员折扣吗」的下界：落在 [0.5, 1] 之外的服务端费率**不采信**，
 * 退回本地阶梯（同一张表，且 levelRate 会按同一套归一规则算）——
 * 宁可按阶梯显示一个正常价，也不显示一个近乎免费或高于原价的价。
 */
const MIN_PLAUSIBLE_RATE = 0.5

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

/**
 * 把会员费率应用到金额上（**编排页与下单页共用的唯一入口**）。
 * @param {number} amount 原价（元）
 * @param {number} rate 费率（1 = 原价）
 * @param {boolean} memberDiscountEnabled 该商品是否参与会员折扣（false 则不打折）
 */
function applyMemberRate(amount, rate, memberDiscountEnabled) {
  const base = Number(amount)
  if (!Number.isFinite(base) || base <= 0) return 0
  if (memberDiscountEnabled === false) return round2(base)
  const r = Number(rate)
  const safe = Number.isFinite(r) && r > 0 && r <= 1 ? r : FULL_RATE
  return round2(Math.max(0, base * safe))
}

/** 解析「当前等级」费率与等级名（薄封装，内部走上面逐字抽来的 resolveFromLadder） */
function resolveCurrentRate(input) {
  const src = input || {}
  const serverName = String(src.serverLevelName || '')
  // ① 服务端费率优先：结算页的「当前等级」也是取 stats.discountRate（confirm-order:971），
  //    凡服务端给了合法费率就照它算，避免本地阶梯在脏数据/自定义等级下与服务端分叉。
  const raw = Number(src.serverRate)
  if (Number.isFinite(raw) && raw > 0) {
    const rate = normalizeDiscountRate(raw)
    if (rate >= MIN_PLAUSIBLE_RATE && rate <= 1) return { rate, levelName: serverName }
  }
  // ② 兜底：本地按成长值 + 阶梯推（与结算页 applyProvisionalFromStats 同一函数）
  try {
    const hit = resolveFromLadder(src.ladder, src.growthValue, src.isHonorary === true)
    const rate = hit ? Number(hit.discountRate) : NaN
    if (Number.isFinite(rate) && rate >= MIN_PLAUSIBLE_RATE && rate <= 1) {
      return { rate, levelName: serverName || String(hit.levelName || '') }
    }
  } catch (e) {
    // 解析失败一律回落原价：**宁可显示原价，也不显示一个错的折后价**
  }
  return { rate: FULL_RATE, levelName: serverName }
}

/**
 * 从 getUserStats 的返回里取本页要的三个输入（与下单页同口径，见 confirm-order:965-967）。
 * 抽出来是为了两页取数一致 —— 取错 growthValue/levelLadder 同样会显示错价。
 */
function inputsFromStats(stats) {
  const s = stats || {}
  return {
    ladder: s.levelLadder || [],
    growthValue: Math.max(0, Math.floor(Number(s.growthValue) || 0)),
    isHonorary: !!(s.userInfo && s.userInfo.isHonorary) || Number(s.level) === 99,
    // 服务端给的「当前等级」费率/名称：优先照它（与结算页 confirm-order:971 同源）
    serverRate: s.discountRate,
    serverLevelName: s.levelName || ''
  }
}

/** 一次性算出应付（供编排页与下单页共用） */
function payableFor(input) {
  const src = input || {}
  const original = round2(Number(src.amount) || 0)
  const resolved = resolveCurrentRate(src)
  const payable = applyMemberRate(original, resolved.rate, src.memberDiscountEnabled)
  return {
    payable,
    original,
    rate: resolved.rate,
    levelName: resolved.levelName,
    discounted: payable < original
  }
}

module.exports = {
  FULL_RATE,
  MIN_PLAUSIBLE_RATE,
  normalizeDiscountRate,
  levelRate,
  resolveFromLadder,
  applyMemberRate,
  resolveCurrentRate,
  inputsFromStats,
  payableFor,
  round2
}
