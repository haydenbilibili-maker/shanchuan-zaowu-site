/**
 * 我的钱包 — 默认档位与说明（Admin 可覆盖写入 stored_value_config）
 * 金额单位：分（Fen）
 *
 * 产品规则（2026.09）：
 * - 新充值不发放赠金，实付 = 本金
 * - 默认档位金额 = 会员等级成长值门槛（L1–L6：100 / 1000 / 2000 / 10000 / 30000 / 100000）
 * - 充值成功：每满 ¥1 → 1 积分 + 1 成长值（与门店口径一致；幂等）
 * - **无独立钱包支付折扣**；用钱包支付时折扣 = 会员等级折扣（含本单预估定级）
 * - 余额**仅限小程序内支付**，不适用于线下门店；不可提现或转赠
 * - 旧库 benefit.discountRate / stackMode 字段忽略，仅保留可选说明文案
 */

const { getDefaultLevelPackages } = require('./levelTiers')

const CONFIG_COLLECTION = 'stored_value_config'
const CONFIG_DOC_KEY = 'wallet_v1'

/** 默认档位：对齐会员等级门槛（100 / 1000 / 2000 / 10000 / 30000 / 100000） */
const DEFAULT_PACKAGES = getDefaultLevelPackages()

/** 权益说明：不再含独立折扣率；可被 Admin 覆盖 description */
const DEFAULT_BENEFIT = {
  /** 已废弃：独立钱包折扣（保留字段兼容旧文档，计价不再读取） */
  enabled: false,
  discountRate: 1,
  minAvailableFen: 0,
  minOrderGoodsFen: 0,
  requireWalletPayment: false,
  stackMode: 'none',
  description:
    '充值全额入账，并按实付计入成长值与积分（每满 ¥1 → 1）。档位金额对齐会员升级门槛（L1–L6）；到达对应等级后，指定藏品享受该档折扣。用钱包支付时，折扣随本单可达的会员等级变化。'
}

const BENEFIT_RULE_SUMMARY =
  '余额仅限小程序内支付。充值计入成长值与积分（¥1=1）；支付折扣 = 会员等级折扣（含本单预估定级）；无独立钱包折扣率。'

/** 自定义充值默认：1 元起、10 万元封顶（对齐 Lv6 门槛）、1 元步进 */
const DEFAULT_RECHARGE_OPTIONS = {
  allowCustom: true,
  minCustomFen: 100,
  maxCustomFen: 10000000,
  customStepFen: 100
}

function fenToYuan(fen) {
  const n = Number(fen) || 0
  return (n / 100).toFixed(2)
}

function yuanDisplay(fen) {
  const n = Number(fen) || 0
  if (n % 100 === 0) return String(n / 100)
  return (n / 100).toFixed(2)
}

function normalizePackage(raw, index = 0) {
  const payFen = Math.max(0, Math.round(Number(raw && raw.payFen) || 0))
  const id = String((raw && raw.id) || `T${Math.round(payFen / 100) || index + 1}`).trim()
  const principalFen = payFen
  return {
    id,
    name: String((raw && raw.name) || `充值 ${yuanDisplay(payFen)}`).slice(0, 40),
    payFen,
    principalFen,
    bonusFen: 0,
    sort: Number(raw && raw.sort) || (index + 1) * 10,
    enabled: !(raw && raw.enabled === false)
  }
}

/**
 * 规范化权益：强制关闭独立钱包折；仅保留说明文案（过滤旧「9.5 折 / 更优一档」话术）
 */
function normalizeBenefit(raw) {
  const src = raw || {}
  let description = String(src.description || DEFAULT_BENEFIT.description).slice(0, 200).trim()
  if (/9\.5\s*折|更优一档|叠加相乘|钱包折扣|支付折扣/.test(description) &&
      !/会员等级/.test(description)) {
    description = DEFAULT_BENEFIT.description
  }
  if (/选用钱包支付时可享|与会员等级折扣取更优/.test(description)) {
    description = DEFAULT_BENEFIT.description
  }
  if (/门店与小程序|线下门店|仅限本店|山海造物门店/.test(description)) {
    description = DEFAULT_BENEFIT.description
  }
  return {
    enabled: false,
    discountRate: 1,
    minAvailableFen: 0,
    minOrderGoodsFen: 0,
    requireWalletPayment: false,
    stackMode: 'none',
    description: description || DEFAULT_BENEFIT.description,
    rule: 'member_level',
    ruleSummary: BENEFIT_RULE_SUMMARY
  }
}

function normalizeRechargeOptions(raw) {
  const src = raw || {}
  let minCustomFen = Math.round(Number(src.minCustomFen))
  if (!Number.isFinite(minCustomFen) || minCustomFen < 100) minCustomFen = DEFAULT_RECHARGE_OPTIONS.minCustomFen
  let maxCustomFen = Math.round(Number(src.maxCustomFen))
  if (!Number.isFinite(maxCustomFen) || maxCustomFen < minCustomFen) {
    maxCustomFen = DEFAULT_RECHARGE_OPTIONS.maxCustomFen
  }
  let customStepFen = Math.round(Number(src.customStepFen))
  if (!Number.isFinite(customStepFen) || customStepFen < 1) {
    customStepFen = DEFAULT_RECHARGE_OPTIONS.customStepFen
  }
  return {
    allowCustom: src.allowCustom !== false,
    minCustomFen,
    maxCustomFen,
    customStepFen,
    minCustomYuan: fenToYuan(minCustomFen),
    maxCustomYuan: fenToYuan(maxCustomFen),
    customStepYuan: fenToYuan(customStepFen)
  }
}

/**
 * 校验并解析自定义充值金额（分）。成功返回 { ok, payFen, ... }；失败 { ok:false, msg, code }
 */
function resolveCustomPayFen(options, event) {
  const opts = normalizeRechargeOptions(options)
  if (!opts.allowCustom) {
    return { ok: false, code: 'CUSTOM_DISABLED', msg: '暂不支持自定义金额充值' }
  }

  let payFen = 0
  if (event && event.customPayFen != null && event.customPayFen !== '') {
    payFen = Math.round(Number(event.customPayFen) || 0)
  } else if (event && (event.customAmountYuan != null || event.amountYuan != null)) {
    const yuan = Number(event.customAmountYuan != null ? event.customAmountYuan : event.amountYuan)
    if (!Number.isFinite(yuan)) {
      return { ok: false, code: 'INVALID_AMOUNT', msg: '请输入有效金额' }
    }
    payFen = Math.round(yuan * 100)
  } else {
    return { ok: false, code: 'MISSING_AMOUNT', msg: '请输入充值金额' }
  }

  if (payFen < opts.minCustomFen) {
    return {
      ok: false,
      code: 'AMOUNT_TOO_LOW',
      msg: `自定义充值最低 ¥${opts.minCustomYuan}`
    }
  }
  if (payFen > opts.maxCustomFen) {
    return {
      ok: false,
      code: 'AMOUNT_TOO_HIGH',
      msg: `自定义充值最高 ¥${opts.maxCustomYuan}`
    }
  }
  if (opts.customStepFen > 1 && payFen % opts.customStepFen !== 0) {
    return {
      ok: false,
      code: 'AMOUNT_STEP',
      msg: `请按 ¥${opts.customStepYuan} 的倍数输入`
    }
  }

  return {
    ok: true,
    id: 'CUSTOM',
    name: `充值 ${yuanDisplay(payFen)}`,
    payFen,
    principalFen: payFen,
    bonusFen: 0,
    creditFen: payFen,
    isCustom: true
  }
}

function getDefaultWalletConfig() {
  return {
    docKey: CONFIG_DOC_KEY,
    status: 'active',
    packages: DEFAULT_PACKAGES.map((p, i) => normalizePackage(p, i)),
    benefit: { ...DEFAULT_BENEFIT, rule: 'member_level', ruleSummary: BENEFIT_RULE_SUMMARY },
    recharge: { ...DEFAULT_RECHARGE_OPTIONS },
    featureNote: 'C 端入口开关对齐 showStoredValue；档位对齐会员门槛；充值按 ¥1=1 发积分与成长值'
  }
}

function normalizeWalletConfig(raw) {
  const {
    looksLikeLegacyDefaultPackages,
    looksLikeWrong500Packages
  } = require('./levelTiers')
  const base = getDefaultWalletConfig()
  const src = raw || {}
  let packages = Array.isArray(src.packages) ? src.packages.map(normalizePackage) : base.packages.slice()
  packages = packages
    .filter((p) => p.payFen > 0)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
  // 旧默认 100/300/500/1000，或误配 500–50000 五档 → 切到 L1–L6 门槛档位
  if (
    !packages.length ||
    looksLikeLegacyDefaultPackages(packages) ||
    looksLikeWrong500Packages(packages)
  ) {
    packages = base.packages.slice()
  }
  let benefitRaw = src.benefit || src.walletBenefit || {}
  // 旧说明未提及门槛/积分时，换成新默认文案
  if (benefitRaw && benefitRaw.description &&
      !/成长值|升级门槛|积分/.test(String(benefitRaw.description))) {
    benefitRaw = { ...benefitRaw, description: DEFAULT_BENEFIT.description }
  }
  return {
    docKey: CONFIG_DOC_KEY,
    status: src.status === 'inactive' ? 'inactive' : 'active',
    packages,
    benefit: normalizeBenefit(benefitRaw),
    recharge: normalizeRechargeOptions(src.recharge || src.rechargeOptions || {}),
    featureNote: base.featureNote
  }
}

function serializePackage(p) {
  const payFen = Number(p.payFen) || 0
  const principalFen = Number(p.principalFen) != null ? Number(p.principalFen) : payFen
  const points = Math.floor(payFen / 100)
  return {
    id: p.id,
    name: p.name,
    payFen,
    principalFen,
    bonusFen: 0,
    creditFen: principalFen,
    payYuan: fenToYuan(payFen),
    principalYuan: fenToYuan(principalFen),
    bonusYuan: '0.00',
    creditYuan: fenToYuan(principalFen),
    points,
    sort: p.sort,
    enabled: p.enabled !== false
  }
}

function listEnabledPackagesFromConfig(config) {
  const cfg = normalizeWalletConfig(config || {})
  return cfg.packages
    .filter((p) => p && p.enabled !== false)
    .map(serializePackage)
}

function listEnabledPackages() {
  return listEnabledPackagesFromConfig(getDefaultWalletConfig())
}

function findPackageInConfig(config, packageId) {
  const id = String(packageId || '').trim()
  if (!id || id === 'CUSTOM') return null
  const list = listEnabledPackagesFromConfig(config)
  const found = list.find((p) => p.id === id)
  if (!found) return null
  return {
    id: found.id,
    name: found.name,
    payFen: found.payFen,
    principalFen: found.principalFen,
    bonusFen: 0,
    creditFen: found.principalFen
  }
}

function findPackage(packageId) {
  return findPackageInConfig(getDefaultWalletConfig(), packageId)
}

function describeBenefit(benefit) {
  const b = normalizeBenefit(benefit)
  return b.description || DEFAULT_BENEFIT.description
}

module.exports = {
  CONFIG_COLLECTION,
  CONFIG_DOC_KEY,
  DEFAULT_PACKAGES,
  DEFAULT_BENEFIT,
  DEFAULT_RECHARGE_OPTIONS,
  BENEFIT_RULE_SUMMARY,
  getDefaultWalletConfig,
  normalizeWalletConfig,
  normalizeBenefit,
  normalizeRechargeOptions,
  resolveCustomPayFen,
  listEnabledPackages,
  listEnabledPackagesFromConfig,
  findPackage,
  findPackageInConfig,
  serializePackage,
  describeBenefit,
  fenToYuan,
  yuanDisplay
}
