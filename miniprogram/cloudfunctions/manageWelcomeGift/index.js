/**
 * 新会员礼包 — 超管读写（集合 member_welcome_gift）
 * 与 Admin WelcomeGiftConfig / upsertUserProfile 同源
 *
 * action: get | save | resetDefaults | listIncomplete | preview | alignCoupons
 * preview：C 端公开只读预览（无敏感字段），无需超管
 * alignCoupons：把已发未使用礼券条款对齐到当前配置（幂等纠偏；save 时自动执行一次）
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')
const {
  COLLECTION,
  getDefaultConfig,
  normalizeConfig,
  describeConfig,
  buildPreview,
  buildCouponAlignPlan,
  validateConfigCoupons
} = require('./welcomeGiftDefaults')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const USER_COUPONS = 'user_coupons'
const REGISTER_GIFT_SOURCE = 'register_gift'
/** 条款同步单次扫描上限，避免超管保存被大表拖垮 */
const ALIGN_SCAN_CAP = 2000
const ALIGN_WRITE_BATCH = 50

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

function updateCount(res) {
  const stats = (res && res.stats) || {}
  const n = stats.updated != null ? stats.updated : (res && res.updated)
  const num = Number(n)
  return Number.isFinite(num) ? num : 0
}

/** 已发未使用礼券（含 available 兼容态），分页扫描 */
async function scanIssuedCoupons() {
  const out = []
  for (let skip = 0; skip < ALIGN_SCAN_CAP; skip += 100) {
    const res = await db.collection(USER_COUPONS)
      .where({ source: REGISTER_GIFT_SOURCE, status: _.in(['unused', 'available']) })
      .skip(skip)
      .limit(100)
      .get()
    const rows = res.data || []
    out.push(...rows)
    if (rows.length < 100) break
  }
  return out
}

/**
 * 把已发「未使用」礼券的条款同步为当前配置（幂等）。
 * 配置是唯一真源：超管工作台保存后立即生效，不再等会员下次打开小程序；
 * used / expired 券是历史凭证，一律不动（由 buildCouponAlignPlan 保证）。
 */
async function syncIssuedCouponTerms(config) {
  try {
    const rows = await scanIssuedCoupons()
    const plan = buildCouponAlignPlan(config, rows)
    // 同条款归并成一次写，减少写放大
    const groups = new Map()
    plan.items.forEach((item) => {
      const key = `${item.slotKey}|${item.patch.minSpend}|${item.patch.title}|${item.patch.channel}`
      if (!groups.has(key)) groups.set(key, { ids: [], patch: item.patch })
      groups.get(key).ids.push(item._id)
    })
    let updated = 0
    for (const group of groups.values()) {
      for (let i = 0; i < group.ids.length; i += ALIGN_WRITE_BATCH) {
        const ids = group.ids.slice(i, i + ALIGN_WRITE_BATCH)
        try {
          const res = await db.collection(USER_COUPONS)
            .where({ _id: _.in(ids) })
            .update({ data: group.patch })
          updated += updateCount(res)
        } catch (e) {
          console.warn('welcomeGift align batch', e.message)
        }
      }
    }
    return {
      scanned: rows.length,
      updated,
      pending: plan.items.length,
      skipped: plan.skipped,
      unchanged: plan.unchanged,
      truncated: rows.length >= ALIGN_SCAN_CAP
    }
  } catch (e) {
    console.warn('welcomeGift align coupons', e.message)
    return { scanned: 0, updated: 0, pending: 0, error: String(e.message || e) }
  }
}

function alignSuffix(sync) {
  if (!sync || sync.error) return ''
  if (!sync.updated) return '；已发礼券条款本已一致'
  return `；已同步 ${sync.updated} 张未使用礼券门槛`
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

  let savedDocId = docId
  try {
    if (docId) {
      await db.collection(COLLECTION).doc(docId).update({ data: payload })
    } else {
      const existing = await loadDoc()
      if (existing && existing._id) {
        savedDocId = existing._id
        await db.collection(COLLECTION).doc(existing._id).update({ data: payload })
      } else {
        const added = await db.collection(COLLECTION).add({
          data: {
            ...payload,
            createTime: Date.now(),
            createdBy: openid || 'admin'
          }
        })
        savedDocId = added._id
      }
    }
  } catch (e) {
    console.error('manageWelcomeGift save', e)
    if (/collection|集合|not exist|502005/i.test(String(e.message || e))) {
      return fail(`请先在云开发控制台创建集合 ${COLLECTION}`)
    }
    return fail(e.message || '保存失败')
  }

  // 保存成功即把新条款下发给已发未使用券，避免「配置改了、老会员仍显示旧门槛」
  const couponSync = await syncIssuedCouponTerms(payload)

  return {
    success: true,
    docId: savedDocId,
    config: normalizeConfig(payload),
    ruleText: describeConfig(payload),
    couponSync,
    msg: `新会员礼包已保存${alignSuffix(couponSync)}`
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
    if (action === 'alignCoupons') {
      // 人工纠偏入口：把已发未使用礼券条款强制对齐到当前配置（幂等）
      const auth = await requireSuperAdmin(event, openid)
      if (!auth.ok) return auth.res
      const current = await getConfig()
      const couponSync = await syncIssuedCouponTerms(current.config)
      return {
        success: true,
        couponSync,
        config: current.config,
        msg: couponSync.updated
          ? `已同步 ${couponSync.updated} 张未使用礼券门槛`
          : '已发未使用礼券条款与当前配置一致'
      }
    }
    // 读：需登录后台，避免顾客直调探完整配置
    const auth = await requireSuperAdmin(event, openid)
    if (!auth.ok) return auth.res
    return await getConfig()
  } catch (e) {
    console.error('manageWelcomeGift', e)
    return fail(e.message || '服务异常')
  }
}
