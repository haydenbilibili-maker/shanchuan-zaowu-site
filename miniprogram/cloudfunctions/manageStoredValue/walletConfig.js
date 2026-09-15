/**
 * 钱包配置读写：集合 stored_value_config
 */
const {
  CONFIG_COLLECTION,
  CONFIG_DOC_KEY,
  getDefaultWalletConfig,
  normalizeWalletConfig,
  listEnabledPackagesFromConfig,
  findPackageInConfig,
  describeBenefit,
  normalizeRechargeOptions,
  resolveCustomPayFen
} = require('./defaults')
const { ensureCollection, withCollectionRetry, isMissingCollectionError } = require('./collections')

async function loadConfigDoc(db) {
  try {
    const byKey = await withCollectionRetry(db, CONFIG_COLLECTION, async () => {
      const res = await db.collection(CONFIG_COLLECTION)
        .where({ docKey: CONFIG_DOC_KEY, status: 'active' })
        .limit(1)
        .get()
      return (res.data && res.data[0]) || null
    })
    if (byKey) return byKey

    const any = await withCollectionRetry(db, CONFIG_COLLECTION, async () => {
      const res = await db.collection(CONFIG_COLLECTION)
        .where({ status: 'active' })
        .limit(5)
        .get()
      return (res.data && res.data[0]) || null
    })
    return any
  } catch (e) {
    if (isMissingCollectionError(e)) return null
    console.warn('loadConfigDoc', e && e.message)
    return null
  }
}

async function getWalletConfig(db) {
  const { loadPaidLevels, enrichPackages } = require('./levelTiers')
  const doc = await loadConfigDoc(db)
  const normalized = normalizeWalletConfig(doc || {})
  const { levels } = await loadPaidLevels(db)
  const packages = enrichPackages(listEnabledPackagesFromConfig(normalized), levels)
  return {
    config: normalized,
    docId: (doc && doc._id) || '',
    fromDefault: !doc,
    packages,
    levelTiers: levels,
    recharge: normalized.recharge,
    benefitText: describeBenefit(normalized.benefit),
    pointsRuleText: '充值成功按实付每满 ¥1 赠 1 积分，并同步计入成长值（与门店口径一致）'
  }
}

async function saveWalletConfig(db, payload, actorOpenid) {
  const normalized = normalizeWalletConfig(payload || {})
  const data = {
    docKey: CONFIG_DOC_KEY,
    status: 'active',
    packages: normalized.packages,
    benefit: normalized.benefit,
    recharge: {
      allowCustom: normalized.recharge.allowCustom,
      minCustomFen: normalized.recharge.minCustomFen,
      maxCustomFen: normalized.recharge.maxCustomFen,
      customStepFen: normalized.recharge.customStepFen
    },
    updatedBy: actorOpenid || 'admin',
    updateTime: db.serverDate()
  }

  const existing = await loadConfigDoc(db)
  if (existing && existing._id) {
    await withCollectionRetry(db, CONFIG_COLLECTION, async () => {
      return db.collection(CONFIG_COLLECTION).doc(existing._id).update({ data })
    })
    return {
      success: true,
      docId: existing._id,
      config: normalized,
      packages: listEnabledPackagesFromConfig(normalized),
      recharge: normalized.recharge,
      benefitText: describeBenefit(normalized.benefit)
    }
  }

  await ensureCollection(db, CONFIG_COLLECTION)
  const added = await withCollectionRetry(db, CONFIG_COLLECTION, async () => {
    return db.collection(CONFIG_COLLECTION).add({
      data: {
        ...data,
        createTime: db.serverDate(),
        createdBy: actorOpenid || 'admin'
      }
    })
  })
  return {
    success: true,
    docId: added._id,
    config: normalized,
    packages: listEnabledPackagesFromConfig(normalized),
    recharge: normalized.recharge,
    benefitText: describeBenefit(normalized.benefit)
  }
}

async function resolvePackage(db, packageId) {
  const { config } = await getWalletConfig(db)
  return findPackageInConfig(config, packageId)
}

/** 解析档位或自定义金额，供 createRecharge 使用 */
async function resolveRechargeTarget(db, event) {
  const { config } = await getWalletConfig(db)
  const wantCustom =
    event &&
    (event.mode === 'custom' ||
      event.isCustom === true ||
      event.packageId === 'CUSTOM' ||
      event.customPayFen != null ||
      event.customAmountYuan != null)

  if (wantCustom) {
    const custom = resolveCustomPayFen(config.recharge, event)
    if (!custom.ok) return custom
    return { ok: true, pkg: custom, isCustom: true }
  }

  const pkg = findPackageInConfig(config, event && (event.packageId || event.tierId))
  if (!pkg) return { ok: false, code: 'INVALID_PACKAGE', msg: '充值档位无效' }
  return { ok: true, pkg, isCustom: false }
}

module.exports = {
  CONFIG_COLLECTION,
  getWalletConfig,
  saveWalletConfig,
  resolvePackage,
  resolveRechargeTarget,
  normalizeRechargeOptions,
  loadConfigDoc
}
