/**
 * 确认页本单预估定级（与 makeOrder/memberLevels.resolveProjectedUpgrade 对齐）。
 * 成长口径：会员折前货值 + 加价 + 运费（券后简化由调用方传入 orderGrowthEstimate）。
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

/**
 * 若「当前成长 + 本单成长口径」对应等级权益优于当前，返回投影等级；否则 null。
 */
function resolveProjectedUpgrade(ladder, currentGrowth, orderGrowthAmount, currentResolved, isHonorary) {
  if (isHonorary) return null
  const estimated = Math.max(0, Math.floor(Number(orderGrowthAmount) || 0))
  const projectedGrowth = Math.max(0, Math.floor(Number(currentGrowth) || 0)) + estimated
  const projected = resolveFromLadder(ladder, projectedGrowth, false)
  const curRate = Number(currentResolved && currentResolved.discountRate)
  const projRate = Number(projected.discountRate)
  const curLevel = Number(currentResolved && currentResolved.level) || 0
  const betterDiscount = Number.isFinite(projRate) && Number.isFinite(curRate) && projRate < curRate
  const higherTier = projected.level > curLevel && projected.level !== 99
  if (!betterDiscount && !(higherTier && projRate <= curRate)) return null
  return {
    applied: true,
    level: projected.level,
    levelName: projected.levelName,
    discountRate: projected.discountRate,
    estimatedOrderGrowth: estimated,
    projectedGrowth
  }
}

/** 会员折前货值合计（不含运费） */
function estimateGoodsGrowthBase(items, customExtraPrice = 0) {
  let original = 0
  ;(items || []).forEach((item) => {
    original += (parseFloat(item.price) || 0) * (item.count || 1)
  })
  const extra = Math.max(0, parseFloat(customExtraPrice) || 0)
  return Math.round((original + extra) * 100) / 100
}

function buildProvisionalTip(provisional) {
  if (!provisional || !provisional.applied) return ''
  const name = provisional.levelName || `Lv${provisional.level}`
  return `本单可达${name}，已按该等级权益计价`
}

module.exports = {
  normalizeDiscountRate,
  resolveFromLadder,
  resolveProjectedUpgrade,
  estimateGoodsGrowthBase,
  buildProvisionalTip
}
