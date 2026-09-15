/**
 * 生日礼包 — 超管读写（集合 member_birthday_gift）
 * 与 claimBirthdayGift 同源；入口：权益会员 → 生日礼包
 *
 * action: get | save | resetDefaults
 * 权限：与新会员礼包相同（manageWelcomeGift / 超管）
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')
const {
  COLLECTION,
  getDefaultConfig,
  normalizeConfig,
  describeConfig,
  validateConfigCoupons
} = require('./birthdayGiftDefaults')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function fail(msg, code) {
  return { success: false, msg, code: code || 'FAIL' }
}

function errorText(err) {
  return [err && err.errCode, err && err.errMsg, err && err.message, String(err || '')]
    .filter(Boolean)
    .join(' ')
}

function isMissingCollectionError(err) {
  return /502005|DATABASE_COLLECTION_NOT_EXIST|COLLECTION_NOT_EXIST|collection not exist|集合不存在|not exist/i
    .test(errorText(err))
}

function isCollectionExistsError(err) {
  return /already exist|already exists|COLLECTION_EXIST|ResourceExist|-501001/i.test(errorText(err))
}

/** 首次写入遇集合缺失时尝试 createCollection（与 manageStoredValue 一致） */
async function ensureCollection() {
  try {
    await db.createCollection(COLLECTION)
    console.log('created collection', COLLECTION)
  } catch (err) {
    if (isCollectionExistsError(err)) return
    throw err
  }
}

async function withCollectionRetry(fn) {
  try {
    return await fn()
  } catch (err) {
    if (!isMissingCollectionError(err)) throw err
    await ensureCollection()
    return await fn()
  }
}

function buildWritePayload(config) {
  const normalized = normalizeConfig(config)
  return {
    ruleId: normalized.ruleId,
    name: normalized.name,
    status: normalized.enabled ? 'active' : 'inactive',
    enabled: normalized.enabled,
    title: normalized.title,
    messageTitle: normalized.messageTitle,
    pointsTitle: normalized.pointsTitle,
    points: normalized.points,
    pointsEnabled: normalized.pointsEnabled,
    excludeGrowth: normalized.excludeGrowth,
    couponsEnabled: normalized.couponsEnabled,
    expireMode: normalized.expireMode,
    expireDays: normalized.expireDays,
    stackable: normalized.stackable,
    priority: Number(normalized.priority) || 100,
    processBatchLimit: normalized.processBatchLimit,
    coupons: (normalized.coupons || []).map((c) => ({
      id: c.id,
      enabled: c.enabled !== false,
      value: c.value,
      minSpend: c.minSpend,
      expireDays: c.expireDays,
      count: c.count,
      title: c.title,
      channel: c.channel || 'all'
    })),
    updateTime: Date.now(),
    _updateTime: Date.now()
  }
}

async function requireSuperAdmin(event, openid) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    permission: 'manageWelcomeGift',
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return { ok: false, res: fail(guard.msg, guard.code) }
  return { ok: true, actor: guard }
}

async function loadDoc() {
  try {
    const res = await db.collection(COLLECTION).limit(5).get()
    const rows = res.data || []
    if (!rows.length) return null
    rows.sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0)
      || (Number(b.updateTime) || 0) - (Number(a.updateTime) || 0))
    return rows[0]
  } catch (e) {
    if (/COLLECTION_NOT_EXIST|not exist|502005|-502005/i.test(String(e.message || e))) {
      return null
    }
    throw e
  }
}

async function getConfig() {
  const raw = await loadDoc()
  const config = normalizeConfig(raw || {})
  return {
    success: true,
    config,
    ruleText: describeConfig(config),
    docId: (raw && raw._id) || '',
    fromDefault: !raw
  }
}

async function saveConfig(event, openid) {
  const auth = await requireSuperAdmin(event, openid)
  if (!auth.ok) return auth.res

  const rawConfig = (event && event.config) || {}
  const couponCheck = validateConfigCoupons(rawConfig)
  if (!couponCheck.ok) return fail(couponCheck.msg || '礼券档位不符合折扣纪律')

  const payload = buildWritePayload(rawConfig)
  payload.updatedBy = openid || (auth.actor && auth.actor.openid) || 'admin'
  const docId = String((event && event.docId) || '').trim()

  try {
    return await withCollectionRetry(async () => {
      if (docId) {
        await db.collection(COLLECTION).doc(docId).update({ data: payload })
        return {
          success: true,
          docId,
          config: normalizeConfig(payload),
          ruleText: describeConfig(payload),
          msg: '生日礼包已保存'
        }
      }
      const existing = await loadDoc()
      if (existing && existing._id) {
        await db.collection(COLLECTION).doc(existing._id).update({ data: payload })
        return {
          success: true,
          docId: existing._id,
          config: normalizeConfig(payload),
          ruleText: describeConfig(payload),
          msg: '生日礼包已保存'
        }
      }
      const added = await db.collection(COLLECTION).add({
        data: {
          ...payload,
          createTime: Date.now(),
          createdBy: openid || 'admin'
        }
      })
      return {
        success: true,
        docId: added._id,
        config: normalizeConfig(payload),
        ruleText: describeConfig(payload),
        msg: '生日礼包已保存'
      }
    })
  } catch (e) {
    console.error('manageBirthdayGift save', e)
    if (isMissingCollectionError(e)) {
      return fail(
        `集合 ${COLLECTION} 不存在且自动创建失败，请在云开发控制台创建该集合（权限建议仅云函数可读写），或运行 scripts/provision-member-birthday-gift.cjs`,
        'COLLECTION_MISSING'
      )
    }
    return fail(e.message || '保存失败')
  }
}

async function resetDefaults(event, openid) {
  const auth = await requireSuperAdmin(event, openid)
  if (!auth.ok) return auth.res
  const config = getDefaultConfig()
  return {
    success: true,
    config: normalizeConfig(config),
    ruleText: describeConfig(config),
    fromDefault: true,
    msg: '已恢复代码默认（尚未写入云库，请点保存）'
  }
}

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID
  const action = (event && event.action) || 'get'
  try {
    if (action === 'save') return await saveConfig(event, openid)
    if (action === 'resetDefaults') return await resetDefaults(event, openid)
    const auth = await requireSuperAdmin(event, openid)
    if (!auth.ok) return auth.res
    return await getConfig()
  } catch (e) {
    console.error('manageBirthdayGift', e)
    return fail(e.message || '服务异常')
  }
}
