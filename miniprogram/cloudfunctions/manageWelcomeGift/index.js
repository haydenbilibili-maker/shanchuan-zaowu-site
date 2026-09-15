/**
 * 新会员礼包 — 超管读写（集合 member_welcome_gift）
 * 与 Admin WelcomeGiftConfig / upsertUserProfile 同源
 *
 * action: get | save | resetDefaults | listIncomplete | preview
 * preview：C 端公开只读预览（无敏感字段），无需超管
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')
const {
  COLLECTION,
  getDefaultConfig,
  normalizeConfig,
  describeConfig,
  buildPreview,
  validateConfigCoupons
} = require('./welcomeGiftDefaults')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function fail(msg, code) {
  return { success: false, msg, code: code || 'FAIL' }
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
    points: normalized.points,
    pointsEnabled: normalized.pointsEnabled,
    excludeGrowth: normalized.excludeGrowth,
    couponsEnabled: normalized.couponsEnabled,
    expireDays: normalized.expireDays,
    stackable: normalized.stackable,
    priority: Number(normalized.priority) || 100,
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
    // 与 upsertUserProfile.loadWelcomeConfig 一致：优先启用中的规则
    const active = rows.find((r) => r && r.enabled !== false && r.status !== 'inactive')
    return active || rows[0]
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

/** C 端注册页：公开预览，与发券同源 loadDoc + normalize */
async function previewConfig() {
  const raw = await loadDoc()
  const preview = buildPreview(raw || {})
  return {
    success: true,
    data: preview,
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
    if (docId) {
      await db.collection(COLLECTION).doc(docId).update({ data: payload })
      return {
        success: true,
        docId,
        config: normalizeConfig(payload),
        ruleText: describeConfig(payload),
        msg: '新会员礼包已保存'
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
        msg: '新会员礼包已保存'
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
      msg: '新会员礼包已保存'
    }
  } catch (e) {
    console.error('manageWelcomeGift save', e)
    if (/collection|集合|not exist|502005/i.test(String(e.message || e))) {
      return fail(`请先在云开发控制台创建集合 ${COLLECTION}`)
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

async function listIncomplete(event, openid) {
  const auth = await requireSuperAdmin(event, openid)
  if (!auth.ok) return auth.res
  const limit = Math.min(50, Math.max(1, parseInt(event && event.limit, 10) || 30))
  try {
    const res = await db
      .collection('users')
      .where({ registerGiftIncomplete: true })
      .limit(limit)
      .get()
    const list = (res.data || []).map((u) => ({
      _id: u._id,
      openid: u._openid || u.openid || '',
      nickName: u.nickName || u.nickname || '',
      phone: u.phone || u.mobile || '',
      registerGiftClaimed: !!u.registerGiftClaimed,
      registerGiftClaimedAt: u.registerGiftClaimedAt || null,
      registerGiftIncomplete: true
    }))
    return {
      success: true,
      list,
      count: list.length,
      msg: list.length
        ? '以下用户欢迎礼已打标但券可能未齐；用户下次 upsertUserProfile 会自动补齐'
        : '暂无未齐记录',
      repairHint:
        'C 端：用户打开小程序触发 upsertUserProfile（onboardingDone + registerGiftIncomplete）即补发缺券；勿手工改账本积分。'
    }
  } catch (e) {
    console.error('manageWelcomeGift listIncomplete', e)
    return fail(e.message || '查询失败')
  }
}

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID
  const action = (event && event.action) || 'get'
  try {
    if (action === 'preview') return await previewConfig()
    if (action === 'save') return await saveConfig(event, openid)
    if (action === 'resetDefaults') return await resetDefaults(event, openid)
    if (action === 'listIncomplete') return await listIncomplete(event, openid)
    // 读：需登录后台，避免顾客直调探完整配置
    const auth = await requireSuperAdmin(event, openid)
    if (!auth.ok) return auth.res
    return await getConfig()
  } catch (e) {
    console.error('manageWelcomeGift', e)
    return fail(e.message || '服务异常')
  }
}
