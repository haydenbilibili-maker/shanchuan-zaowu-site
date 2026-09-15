/**
 * 门店消费赠积分 — 默认规则（代码兜底，云端集合 store_point_rules 可覆盖）
 * 复制到 grantStorePoints / getStorePointRules / getPointRecords / earnPoints / bindPlatformOrder 保持同名同内容。
 *
 * mode 三种赠送方式：
 *   fixed        满 threshold 送 pointsPerThreshold，一单只送一次
 *   perThreshold 每满 threshold 送 pointsPerThreshold，可多次（默认）
 *   ratio        消费额过 minAmount 后按 ratio 比例赠送
 *
 * 门店消费入账：bonusPoints（可用积分）+ storeGrowthValue（会员成长值/等级）。
 * 二者按同一 calcPoints 结果发放；可用积分公式仍为「线上订单成长 + bonusPoints」，
 * 不把 storeGrowthValue 再加进可用积分，避免双计。
 *
 * v4 默认：每满 ¥1 赠 1 积分与 1 成长值（消费 1800 → 1800）
 * roundMode 默认 floor：金额按规则试算后向下取整到整数分（如 ¥19.9 → 19）
 */
const MODE_FIXED = 'fixed'
const MODE_PER_THRESHOLD = 'perThreshold'
const MODE_RATIO = 'ratio'
const VALID_MODES = [MODE_FIXED, MODE_PER_THRESHOLD, MODE_RATIO]

const DEFAULT_MODULES = {
  storePurchase: true,
  share: true,
  review: true,
  checkIn: true,
  browse: true,
  orderBind: true,
  receiptClaim: true
}

const DEFAULT_MODULE_REWARDS = {
  share: { points: 5, dailyLimit: 3 },
  review: { points: 10, dailyLimit: 3 },
  checkIn: { points: 5, dailyLimit: 1 },
  browse: { points: 1, dailyLimit: 5 }
}

const DEFAULT_PLATFORMS = [
  { id: 'douyin', name: '抖音/抖店' },
  { id: 'taobao', name: '淘宝/天猫' },
  { id: 'xiaohongshu', name: '小红书' },
  { id: 'jd', name: '京东' },
  { id: 'other', name: '其他平台' }
]

// 仅店长可见的风控字段，不下发给普通用户
const STAFF_ONLY_FIELDS = [
  'maxAmountPerRecord',
  'dailyPointsCapPerUser',
  'dailyPointsCapPerStore',
  'dailyRecordCapPerUser',
  'revokeWindowDays',
  'updatedBy',
  'updateTime',
  'remark',
  'moduleRewards'
]

function getDefaultConfig() {
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

    // 不叠加会员倍率；成长值与积分按 calcPoints 同步发放
    applyMemberMultiplier: false,

    dailyPointsCapPerUser: 5000,
    dailyPointsCapPerStore: 50000,
    dailyRecordCapPerUser: 3,

    revokeWindowDays: 30,
    notifyUser: true,
    remark: '',

    // 各奖励模块生效开关
    modules: { ...DEFAULT_MODULES },
    moduleRewards: JSON.parse(JSON.stringify(DEFAULT_MODULE_REWARDS)),

    // 多平台订单绑定（一期：用户申请 + 店长确认）
    platformOrderBind: {
      requireAmount: true,
      requireManagerConfirm: true,
      platforms: DEFAULT_PLATFORMS.slice()
    }
  }
}

function toNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
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
    if (src.points !== undefined) base[key].points = Math.max(0, Math.floor(toNumber(src.points, base[key].points)))
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

/**
 * 把云端记录浅合并到默认值上，并把数值字段收敛到合法区间。
 */
function normalizeConfig(raw) {
  const base = getDefaultConfig()
  const merged = { ...base, ...(raw || {}) }

  merged.mode = VALID_MODES.indexOf(merged.mode) === -1 ? base.mode : merged.mode
  // 允许小数门槛（如 9.9），下限 0.01，避免被旧逻辑锁死为整数元
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

function formatAmount(value) {
  const n = Number(value) || 0
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

/**
 * 规则的人话描述，前端与站内信共用。
 */
function describeRule(config) {
  const cfg = normalizeConfig(config)
  if (cfg.mode === MODE_RATIO) {
    const percent = Math.round(cfg.ratio * 1000) / 10
    return `门店消费满 ¥${formatAmount(cfg.minAmount)}，按 ${percent}% 赠送积分与成长值`
  }
  if (cfg.mode === MODE_FIXED) {
    return `门店单笔消费满 ¥${formatAmount(cfg.threshold)}，赠送 ${cfg.pointsPerThreshold} 积分与 ${cfg.pointsPerThreshold} 成长值`
  }
  return `门店消费每满 ¥${formatAmount(cfg.threshold)}，赠送 ${cfg.pointsPerThreshold} 积分与 ${cfg.pointsPerThreshold} 成长值`
}

/**
 * 规则的结构化摘要 — 供 C 端把「线上/门店」两条说明分别讲清楚（同源，避免口径漂移）
 */
function summarizeRule(config) {
  const cfg = normalizeConfig(config)
  return {
    mode: cfg.mode,
    threshold: cfg.threshold,
    thresholdText: formatAmount(cfg.threshold),
    pointsPerThreshold: cfg.pointsPerThreshold,
    ratio: cfg.ratio,
    ratioPercent: Math.round(cfg.ratio * 1000) / 10,
    minAmount: cfg.minAmount,
    minAmountText: formatAmount(cfg.minAmount),
    roundMode: cfg.roundMode,
    revokeWindowDays: cfg.revokeWindowDays
  }
}

/**
 * 按规则试算赠送积分。纯函数，云端唯一计算入口。
 * 成长值与积分使用同一结果（grant 时同步写入 storeGrowthValue）。
 */
function calcPoints(config, amount) {
  const cfg = normalizeConfig(config)
  const value = Number(amount)
  if (!Number.isFinite(value) || value <= 0) {
    return { points: 0, times: 0, reason: 'invalid_amount', ruleSnapshot: snapshotRule(cfg) }
  }

  let raw = 0
  let times = 0

  if (cfg.mode === MODE_RATIO) {
    if (value < cfg.minAmount) {
      return { points: 0, times: 0, reason: 'below_min_amount', ruleSnapshot: snapshotRule(cfg) }
    }
    raw = value * cfg.ratio
  } else if (cfg.mode === MODE_FIXED) {
    if (value < cfg.threshold) {
      return { points: 0, times: 0, reason: 'below_threshold', ruleSnapshot: snapshotRule(cfg) }
    }
    times = 1
    raw = cfg.pointsPerThreshold
  } else {
    times = Math.floor(value / cfg.threshold)
    if (times <= 0) {
      return { points: 0, times: 0, reason: 'below_threshold', ruleSnapshot: snapshotRule(cfg) }
    }
    raw = times * cfg.pointsPerThreshold
  }

  let points
  if (cfg.roundMode === 'ceil') points = Math.ceil(raw)
  else if (cfg.roundMode === 'round') points = Math.round(raw)
  else points = Math.floor(raw)

  return { points: Math.max(0, points), times, reason: '', ruleSnapshot: snapshotRule(cfg) }
}

function snapshotRule(config) {
  const cfg = normalizeConfig(config)
  return {
    ruleId: cfg.ruleId,
    mode: cfg.mode,
    threshold: cfg.threshold,
    pointsPerThreshold: cfg.pointsPerThreshold,
    ratio: cfg.ratio,
    minAmount: cfg.minAmount,
    roundMode: cfg.roundMode,
    ruleText: describeRule(cfg)
  }
}

/**
 * 裁剪风控字段，供普通用户读取规则说明。
 */
function publicConfig(config) {
  const cfg = { ...normalizeConfig(config) }
  STAFF_ONLY_FIELDS.forEach((key) => { delete cfg[key] })
  return cfg
}

function isModuleEnabled(config, moduleKey) {
  const cfg = normalizeConfig(config)
  return cfg.modules[moduleKey] !== false
}

module.exports = {
  MODE_FIXED,
  MODE_PER_THRESHOLD,
  MODE_RATIO,
  VALID_MODES,
  STAFF_ONLY_FIELDS,
  DEFAULT_MODULES,
  DEFAULT_MODULE_REWARDS,
  DEFAULT_PLATFORMS,
  getDefaultConfig,
  normalizeConfig,
  describeRule,
  summarizeRule,
  calcPoints,
  snapshotRule,
  publicConfig,
  formatAmount,
  isModuleEnabled
}
