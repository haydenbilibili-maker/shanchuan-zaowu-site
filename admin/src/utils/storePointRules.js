/**
 * 与小程序 cloudfunctions/getStorePointRules/defaults.js 对齐。
 * 线上积分 SSOT：集合 store_point_rules（非旧 points_rules）。
 * v4 默认：每满 ¥1 赠 1 积分与 1 成长值。
 * ⚠ 本文件是云端 defaults.js 的手工平行副本，改动必须两边同步；
 *   守卫见 miniprogram/scripts/check-store-point-rules-sync.cjs
 */

export const MODE_FIXED = 'fixed'
export const MODE_PER_THRESHOLD = 'perThreshold'
export const MODE_RATIO = 'ratio'
export const VALID_MODES = [MODE_FIXED, MODE_PER_THRESHOLD, MODE_RATIO]

export const DEFAULT_MODULES = {
  storePurchase: true,
  share: true,
  review: true,
  checkIn: true,
  browse: true,
  orderBind: true,
  receiptClaim: true
}

export const MODULE_LABELS = {
  storePurchase: '门店消费赠分',
  share: '分享奖励',
  review: '评价奖励',
  checkIn: '每日签到',
  browse: '鉴赏藏品',
  orderBind: '外部订单绑定',
  receiptClaim: '门店小票兑积分'
}

export const DEFAULT_MODULE_REWARDS = {
  share: { points: 5, dailyLimit: 3 },
  review: { points: 10, dailyLimit: 3 },
  checkIn: { points: 5, dailyLimit: 1 },
  browse: { points: 1, dailyLimit: 5 }
}

export const DEFAULT_PLATFORMS = [
  { id: 'douyin', name: '抖音/抖店' },
  { id: 'taobao', name: '淘宝/天猫' },
  { id: 'xiaohongshu', name: '小红书' },
  { id: 'jd', name: '京东' },
  { id: 'other', name: '其他平台' }
]

function toNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function getDefaultStorePointConfig() {
  return {
    // v4：每满 ¥1 赠 1 积分与 1 成长值
    ruleId: 'store_points_default_v4',
    name: '门店消费赠分 · 默认规则',
    status: 'active',
    priority: 100,
    storeIds: [],
    mode: MODE_PER_THRESHOLD,
    threshold: 1,
    pointsPerThreshold: 1,
    ratio: 1,
    minAmount: 1,
    maxAmountPerRecord: 50000,
    roundMode: 'floor',
    applyMemberMultiplier: false,
    dailyPointsCapPerUser: 5000,
    dailyPointsCapPerStore: 50000,
    dailyRecordCapPerUser: 3,
    revokeWindowDays: 30,
    notifyUser: true,
    remark: '',
    modules: { ...DEFAULT_MODULES },
    moduleRewards: JSON.parse(JSON.stringify(DEFAULT_MODULE_REWARDS)),
    platformOrderBind: {
      requireAmount: true,
      requireManagerConfirm: true,
      platforms: DEFAULT_PLATFORMS.slice()
    }
  }
}

function normalizeModules(raw) {
  const base = { ...DEFAULT_MODULES }
  if (!raw || typeof raw !== 'object') return base
  Object.keys(base).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      base[key] = raw[key] !== false
    }
  })
  return base
}

function normalizeModuleRewards(raw) {
  const base = JSON.parse(JSON.stringify(DEFAULT_MODULE_REWARDS))
  if (!raw || typeof raw !== 'object') return base
  Object.keys(base).forEach((key) => {
    const src = raw[key]
    if (!src || typeof src !== 'object') return
    if (src.points !== undefined) {
      base[key].points = Math.max(0, Math.floor(toNumber(src.points, base[key].points)))
    }
    if (src.dailyLimit !== undefined) {
      base[key].dailyLimit = Math.max(0, Math.floor(toNumber(src.dailyLimit, base[key].dailyLimit)))
    }
  })
  return base
}

function normalizePlatforms(raw) {
  if (!Array.isArray(raw) || !raw.length) return DEFAULT_PLATFORMS.slice()
  return raw
    .map((row) => ({
      id: String((row && row.id) || '').trim(),
      name: String((row && row.name) || '').trim()
    }))
    .filter((row) => row.id && row.name)
}

export function normalizeStorePointConfig(raw) {
  const base = getDefaultStorePointConfig()
  const merged = { ...base, ...(raw || {}) }
  merged.mode = VALID_MODES.includes(merged.mode) ? merged.mode : base.mode
  merged.threshold = Math.max(0.01, toNumber(merged.threshold, base.threshold))
  merged.pointsPerThreshold = Math.max(0, Math.floor(toNumber(merged.pointsPerThreshold, base.pointsPerThreshold)))
  merged.ratio = Math.min(10, Math.max(0, toNumber(merged.ratio, base.ratio)))
  merged.minAmount = Math.max(0, toNumber(merged.minAmount, base.minAmount))
  merged.maxAmountPerRecord = Math.max(1, toNumber(merged.maxAmountPerRecord, base.maxAmountPerRecord))
  merged.roundMode = merged.roundMode === 'round' || merged.roundMode === 'ceil' ? merged.roundMode : 'floor'
  merged.applyMemberMultiplier = false
  merged.dailyPointsCapPerUser = Math.max(0, Math.floor(toNumber(merged.dailyPointsCapPerUser, base.dailyPointsCapPerUser)))
  merged.dailyPointsCapPerStore = Math.max(0, Math.floor(toNumber(merged.dailyPointsCapPerStore, base.dailyPointsCapPerStore)))
  merged.dailyRecordCapPerUser = Math.max(0, Math.floor(toNumber(merged.dailyRecordCapPerUser, base.dailyRecordCapPerUser)))
  merged.revokeWindowDays = Math.max(0, Math.floor(toNumber(merged.revokeWindowDays, base.revokeWindowDays)))
  merged.storeIds = Array.isArray(merged.storeIds) ? merged.storeIds.filter(Boolean) : []
  merged.notifyUser = merged.notifyUser !== false
  merged.modules = normalizeModules(merged.modules)
  merged.moduleRewards = normalizeModuleRewards(merged.moduleRewards)
  const pob = (raw && raw.platformOrderBind) || {}
  merged.platformOrderBind = {
    requireAmount: pob.requireAmount !== false,
    requireManagerConfirm: pob.requireManagerConfirm !== false,
    platforms: normalizePlatforms(pob.platforms)
  }
  return merged
}

export function describeStorePointRule(config) {
  const cfg = normalizeStorePointConfig(config)
  const fmt = (v) => (Number.isInteger(v) ? String(v) : Number(v).toFixed(2))
  if (cfg.mode === MODE_RATIO) {
    const percent = Math.round(cfg.ratio * 1000) / 10
    return `门店消费满 ¥${fmt(cfg.minAmount)}，按 ${percent}% 赠送积分`
  }
  if (cfg.mode === MODE_FIXED) {
    return `门店单笔消费满 ¥${fmt(cfg.threshold)}，赠送 ${cfg.pointsPerThreshold} 积分`
  }
  return `门店消费每满 ¥${fmt(cfg.threshold)}，赠送 ${cfg.pointsPerThreshold} 积分`
}
