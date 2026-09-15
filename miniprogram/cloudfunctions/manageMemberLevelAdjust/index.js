/**
 * 会员等级人工调整（Admin）
 *
 * action: listLevels | search | adjust | clearOverride | recentOps
 *
 * 定级规则（与小程序 resolveMemberLevel 一致）：
 * 1. isHonorary → 始终 Lv99 荣誉馆长（优先于一切覆盖）
 * 2. users.levelOverride.mode === 'exact' → 锁定付费档，暂停自动升级
 * 3. users.levelOverride.mode === 'floor'（默认）→
 *    effectiveGrowth = max(自然成长, growthFloor)，自然成长超过后仍可自动升级
 * 4. 否则按自然成长值（订单成长 + storeGrowthValue）对照 member_levels 门槛
 *
 * 与荣誉馆长关系：
 * - 调到非荣誉档时：清除 isHonorary，并将 honorary_curators 对应手机号标为 removed
 * - 目标为 Lv99：拒绝，请走「荣誉馆长名单」页
 *
 * 鉴权：staffGuard manager + manageMemberLevelAdjust；Admin Web 用 ADMIN_OPS_KEY
 * 调整/清除需授权密码（MEMBER_LEVEL_ADJUST_PASSWORD 优先，否则复用荣誉馆长密码）
 * 审计：member_level_adjust_ops
 */
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')
const {
  loadMemberLevels,
  resolveMemberLevel,
  normalizeLevelOverride,
  getDefaultLevels
} = require('./memberLevels')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const PERMISSION = 'manageMemberLevelAdjust'
const OPS_COLLECTION = 'member_level_adjust_ops'
const HONORARY_COLLECTION = 'honorary_curators'
const PHONE_RE = /^1\d{10}$/
const PAGE_SIZE_MAX = 50

function fail(msg, extra) {
  return { success: false, msg, ...(extra || {}) }
}

function ok(data) {
  return { success: true, ...(data || {}) }
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '')
}

function maskPhone(phone) {
  const value = String(phone || '')
  if (value.length < 7) return value || ''
  return value.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
}

function maskOpenid(openid) {
  const v = String(openid || '')
  if (v.length <= 8) return v
  return `${v.slice(0, 4)}…${v.slice(-4)}`
}

function toMs(value) {
  if (!value) return 0
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  if (typeof value.getTime === 'function') return value.getTime()
  const n = Date.parse(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * 授权密码：
 * - MEMBER_LEVEL_ADJUST_PASSWORD / _HASH 优先
 * - 未配置时回退 HONORARY_CURATOR_PASSWORD / _HASH（与馆长授予同审慎）
 */
function verifyAdjustPassword(input) {
  const plain =
    String(process.env.MEMBER_LEVEL_ADJUST_PASSWORD || '') ||
    String(process.env.HONORARY_CURATOR_PASSWORD || '')
  const hashEnv = (
    String(process.env.MEMBER_LEVEL_ADJUST_PASSWORD_HASH || '') ||
    String(process.env.HONORARY_CURATOR_PASSWORD_HASH || '')
  )
    .trim()
    .toLowerCase()
    .replace(/^sha256:/, '')

  if (!plain && !hashEnv) {
    return {
      ok: false,
      code: 'PASSWORD_UNCONFIGURED',
      msg: '未配置授权密码：请设置 MEMBER_LEVEL_ADJUST_PASSWORD（或复用 HONORARY_CURATOR_PASSWORD）'
    }
  }

  const submitted = String(input || '')
  if (!submitted) {
    return { ok: false, code: 'PASSWORD_REQUIRED', msg: '请输入授权密码' }
  }

  try {
    if (hashEnv) {
      if (!/^[0-9a-f]{64}$/.test(hashEnv)) {
        return { ok: false, code: 'PASSWORD_MISCONFIGURED', msg: '授权密码 HASH 格式无效（需 64 位 hex）' }
      }
      const submittedHash = crypto.createHash('sha256').update(submitted, 'utf8').digest('hex')
      const a = Buffer.from(submittedHash, 'hex')
      const b = Buffer.from(hashEnv, 'hex')
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return { ok: false, code: 'PASSWORD_INVALID', msg: '授权密码错误' }
      }
      return { ok: true }
    }

    const a = Buffer.from(submitted, 'utf8')
    const b = Buffer.from(plain, 'utf8')
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, code: 'PASSWORD_INVALID', msg: '授权密码错误' }
    }
    return { ok: true }
  } catch (e) {
    console.error('verifyAdjustPassword', e)
    return { ok: false, code: 'PASSWORD_ERROR', msg: '密码校验失败' }
  }
}

async function requireManager(openid, options = {}) {
  return assertStaff(db, openid, {
    role: ROLE_MANAGER,
    permission: PERMISSION,
    adminOpsKey: options.adminOpsKey
  })
}

async function sumPaidGrowth(openid) {
  if (!openid) return 0
  try {
    const res = await db
      .collection('orders')
      .where({
        _openid: openid,
        status: _.in(['paid', 'shipped', 'received'])
      })
      .limit(100)
      .get()
    let total = 0
    ;(res.data || []).forEach((order) => {
      if (order.source === 'exchange') return
      const raw =
        order.growthAmount != null && order.growthAmount !== ''
          ? order.growthAmount
          : order.totalPrice
      if (raw == null || raw === '') return
      const price = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/,/g, ''))
      if (!isNaN(price)) total += price
    })
    return Math.floor(total)
  } catch (e) {
    console.warn('sumPaidGrowth', e.message)
    return 0
  }
}

function formatDiscountLabel(rate) {
  const n = Number(rate)
  if (!Number.isFinite(n) || n >= 1) return '无折扣'
  const zhe = Math.round(n * 1000) / 100
  if (Number.isInteger(zhe)) return `${zhe} 折`
  return `${zhe} 折`
}

function formatLevelOption(row) {
  return {
    level: row.level,
    name: row.name,
    threshold: row.threshold,
    discountRate: row.discountRate,
    discountLabel: formatDiscountLabel(row.discountRate),
    benefits: Array.isArray(row.benefits) ? row.benefits : [],
    icon: row.icon || '',
    isHonorary: row.level === 99,
    selectable: row.level !== 99
  }
}

async function listLevels() {
  const { levels, source } = await loadMemberLevels(db)
  const paid = levels.filter((l) => l.level !== 99)
  const honorary = levels.find((l) => l.level === 99)
  return ok({
    source,
    levels: levels.map(formatLevelOption),
    paidLevels: paid.map(formatLevelOption),
    honorary: honorary ? formatLevelOption(honorary) : null,
    ruleHint:
      '默认 floor：写入目标档门槛成长值下限，自然成长超过后仍可自动升级；exact 为强制锁定。荣誉馆长请走专用名单页。'
  })
}

async function buildMemberSnapshot(user, levels) {
  const openid = user._openid || ''
  const orderGrowth = await sumPaidGrowth(openid)
  const storeGrowth = Math.max(0, Math.floor(Number(user.storeGrowthValue) || 0))
  const growthValue = orderGrowth + storeGrowth
  const isHonorary = user.isHonorary === true
  const override = user.levelOverride || null
  const natural = resolveMemberLevel(levels, growthValue, false, null)
  const resolved = resolveMemberLevel(levels, growthValue, isHonorary, override)
  const phone = normalizePhone(user.phone)

  return {
    _id: user._id,
    openid,
    openidMasked: maskOpenid(openid),
    nickName: user.nickName || user.name || '藏家',
    avatarUrl: user.avatarUrl || '',
    phone,
    phoneMasked: maskPhone(phone),
    isHonorary,
    growthValue,
    orderGrowth,
    storeGrowth,
    naturalLevel: natural.level,
    naturalLevelName: natural.levelName,
    level: resolved.level,
    levelName: resolved.levelName,
    discountRate: resolved.discountRate,
    discountLabel: formatDiscountLabel(resolved.discountRate),
    nextThreshold: resolved.nextThreshold,
    overrideMode: resolved.overrideMode || '',
    levelOverride: normalizeLevelOverride(override),
    canAdjust: !!user._id
  }
}

async function findUsersByPhone(phone) {
  try {
    const res = await db.collection('users').where({ phone }).limit(20).get()
    return res.data || []
  } catch (e) {
    return []
  }
}

async function findUsersByPhonePartial(phoneQuery) {
  const q = normalizePhone(phoneQuery)
  if (q.length < 3 || q.length > 10) return []
  const escapeRe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    const suffixRes = await db
      .collection('users')
      .where({ phone: db.RegExp({ regexp: `${escapeRe}$`, options: '' }) })
      .limit(20)
      .get()
    if ((suffixRes.data || []).length) return suffixRes.data
    const containsRes = await db
      .collection('users')
      .where({ phone: db.RegExp({ regexp: escapeRe, options: '' }) })
      .limit(20)
      .get()
    return containsRes.data || []
  } catch (e) {
    return []
  }
}

async function searchMembers(event) {
  const keyword = String((event && event.keyword) || '').trim()
  if (!keyword) return fail('请输入手机号、openid 或昵称')

  const { levels } = await loadMemberLevels(db)
  const phoneQ = normalizePhone(keyword)
  let users = []

  try {
    if (PHONE_RE.test(phoneQ)) {
      users = await findUsersByPhone(phoneQ)
    } else if (phoneQ.length >= 3 && phoneQ.length <= 10 && /^\d+$/.test(phoneQ)) {
      users = await findUsersByPhonePartial(phoneQ)
    }

    if (!users.length && keyword.length >= 8) {
      const byOpenid = await db.collection('users').where({ _openid: keyword }).limit(5).get()
      users = byOpenid.data || []
    }

    if (!users.length && keyword.length >= 2) {
      // 昵称：拉近期样本内存过滤（云开发对中文模糊支持有限）
      const sample = await db.collection('users').orderBy('createTime', 'desc').limit(200).get()
      const k = keyword.toLowerCase()
      users = (sample.data || []).filter((u) => {
        const nick = String(u.nickName || u.name || '').toLowerCase()
        const oid = String(u._openid || '').toLowerCase()
        const phone = String(u.phone || '')
        return nick.includes(k) || oid.includes(k) || phone.includes(phoneQ || keyword)
      }).slice(0, 20)
    }
  } catch (e) {
    // createTime 索引缺失时降级
    try {
      const sample = await db.collection('users').limit(200).get()
      const k = keyword.toLowerCase()
      users = (sample.data || []).filter((u) => {
        const nick = String(u.nickName || u.name || '').toLowerCase()
        const oid = String(u._openid || '').toLowerCase()
        const phone = String(u.phone || '')
        return nick.includes(k) || oid.includes(k) || phone.includes(phoneQ || keyword)
      }).slice(0, 20)
    } catch (e2) {
      return fail(e2.message || '搜索失败')
    }
  }

  const list = []
  for (const user of users) {
    list.push(await buildMemberSnapshot(user, levels))
  }

  return ok({
    keyword,
    count: list.length,
    list,
    msg: list.length ? `找到 ${list.length} 位会员` : '未找到匹配会员'
  })
}

async function writeOpsLog(entry) {
  try {
    await db.collection(OPS_COLLECTION).add({
      data: {
        ...entry,
        createTime: db.serverDate()
      }
    })
  } catch (e) {
    console.warn('member_level_adjust_ops write failed:', e.message)
  }
}

async function clearHonoraryForPhone(phone, actor) {
  const normalized = normalizePhone(phone)
  if (!PHONE_RE.test(normalized)) return { clearedUsers: 0, rosterUpdated: false }

  let clearedUsers = 0
  const users = await findUsersByPhone(normalized)
  for (const user of users) {
    if (!user._id) continue
    try {
      await db.collection('users').doc(user._id).update({
        data: {
          isHonorary: false,
          honoraryUpdatedAt: db.serverDate(),
          honoraryNotifiedGrantId: '',
          updateTime: db.serverDate()
        }
      })
      clearedUsers += 1
    } catch (e) {
      console.warn('clearHonorary user update failed:', e.message)
    }
  }

  let rosterUpdated = false
  try {
    const res = await db.collection(HONORARY_COLLECTION).where({ phone: normalized }).limit(1).get()
    const row = res.data && res.data[0]
    if (row && row.status === 'active') {
      await db.collection(HONORARY_COLLECTION).doc(row._id).update({
        data: {
          status: 'removed',
          removedBy: actor.openid || 'admin_web',
          removedByName: actor.name || 'Admin Web',
          removedAt: db.serverDate(),
          updateTime: db.serverDate(),
          note: `${row.note || ''}`.trim()
            ? `${row.note}｜等级调整时自动移出`
            : '等级调整时自动移出荣誉馆长'
        }
      })
      rosterUpdated = true
    }
  } catch (e) {
    console.warn('clearHonorary roster failed:', e.message)
  }

  return { clearedUsers, rosterUpdated }
}

async function adjustLevel(event, actor) {
  const pwd = verifyAdjustPassword(event && (event.confirmPassword || event.grantPassword))
  if (!pwd.ok) return fail(pwd.msg, { code: pwd.code })

  const userId = String((event && event.userId) || '').trim()
  const openidInput = String((event && event.openid) || '').trim()
  const targetLevel = Number(event && event.targetLevel)
  const modeRaw = String((event && event.mode) || 'floor').toLowerCase()
  const mode = modeRaw === 'exact' ? 'exact' : 'floor'
  const note = String((event && event.note) || '').trim().slice(0, 200)

  if (!Number.isFinite(targetLevel) || targetLevel < 1) {
    return fail('请选择有效的目标等级')
  }
  if (targetLevel === 99) {
    return fail('荣誉馆长请前往「荣誉馆长名单」授予，本页仅调整付费档 Lv1–Lv6', {
      code: 'USE_HONORARY_PAGE'
    })
  }

  let user = null
  try {
    if (userId) {
      const doc = await db.collection('users').doc(userId).get()
      user = doc.data || null
      if (user) user._id = userId
    } else if (openidInput) {
      const res = await db.collection('users').where({ _openid: openidInput }).limit(1).get()
      user = (res.data && res.data[0]) || null
    } else {
      return fail('请指定会员 userId 或 openid')
    }
  } catch (e) {
    return fail(e.message || '查找会员失败')
  }

  if (!user || !user._id) return fail('未找到该会员')

  const { levels } = await loadMemberLevels(db)
  const paid = (levels.length ? levels : getDefaultLevels()).filter((l) => l.level !== 99)
  const target = paid.find((l) => l.level === targetLevel)
  if (!target) return fail(`目标等级 Lv${targetLevel} 不在 member_levels 配置中`)

  const before = await buildMemberSnapshot(user, levels)
  const wasHonorary = !!before.isHonorary

  // 若自然成长已高于目标且选 floor，提示但仍可写入（实际展示会保持自然档）
  let warning = ''
  if (mode === 'floor' && before.naturalLevel > targetLevel && !wasHonorary) {
    warning =
      `该会员自然成长已达 Lv${before.naturalLevel}，floor 模式无法下调；` +
      `若需强制到 Lv${targetLevel}，请改用 exact 锁定模式。`
  }

  const levelOverride = {
    level: target.level,
    mode,
    growthFloor: target.threshold,
    note,
    setAt: Date.now(),
    setBy: actor.openid || 'admin_web',
    setByName: actor.name || 'Admin Web'
  }

  let honoraryCleared = { clearedUsers: 0, rosterUpdated: false }
  if (wasHonorary) {
    honoraryCleared = await clearHonoraryForPhone(user.phone, actor)
    // 当前用户若无手机号也要清 isHonorary
    if (!honoraryCleared.clearedUsers) {
      try {
        await db.collection('users').doc(user._id).update({
          data: {
            isHonorary: false,
            honoraryUpdatedAt: db.serverDate(),
            honoraryNotifiedGrantId: '',
            updateTime: db.serverDate()
          }
        })
        honoraryCleared.clearedUsers = 1
      } catch (e) {
        console.warn('clear isHonorary on target failed:', e.message)
      }
    }
  }

  try {
    const updateData = {
      levelOverride,
      // 付费档调整与荣誉馆长互斥：始终清 isHonorary
      isHonorary: false,
      updateTime: db.serverDate()
    }
    if (wasHonorary) {
      updateData.honoraryUpdatedAt = db.serverDate()
      updateData.honoraryNotifiedGrantId = ''
    }
    await db.collection('users').doc(user._id).update({ data: updateData })
  } catch (e) {
    return fail(e.message || '写入等级覆盖失败')
  }

  const refreshed = await db.collection('users').doc(user._id).get()
  const afterUser = refreshed.data || { ...user, levelOverride, isHonorary: false }
  afterUser._id = user._id
  const after = await buildMemberSnapshot(afterUser, levels)

  await writeOpsLog({
    action: 'adjust',
    actionLabel: '调整等级',
    userId: user._id,
    openid: user._openid || '',
    openidMasked: maskOpenid(user._openid),
    phone: normalizePhone(user.phone),
    phoneMasked: maskPhone(user.phone),
    nickName: user.nickName || user.name || '',
    fromLevel: before.level,
    fromLevelName: before.levelName,
    toLevel: after.level,
    toLevelName: after.levelName,
    targetLevel: target.level,
    targetLevelName: target.name,
    mode,
    growthFloor: target.threshold,
    naturalLevelBefore: before.naturalLevel,
    wasHonorary,
    honoraryCleared: !!wasHonorary,
    operatorOpenid: actor.openid || 'admin_web',
    operatorName: actor.name || 'Admin Web',
    source: actor.source || '',
    note,
    warning
  })

  return ok({
    before,
    after,
    warning,
    honoraryCleared: wasHonorary,
    msg: wasHonorary
      ? `已调至 ${after.levelName}，并移出荣誉馆长`
      : warning
        ? `已写入覆盖（${mode}），但当前展示仍为 ${after.levelName}：${warning}`
        : `已将会员调整为 ${after.levelName}（${mode === 'exact' ? '强制锁定' : '成长下限'}）`
  })
}

async function clearOverride(event, actor) {
  const pwd = verifyAdjustPassword(event && (event.confirmPassword || event.grantPassword))
  if (!pwd.ok) return fail(pwd.msg, { code: pwd.code })

  const userId = String((event && event.userId) || '').trim()
  const openidInput = String((event && event.openid) || '').trim()
  const note = String((event && event.note) || '').trim().slice(0, 200)

  let user = null
  try {
    if (userId) {
      const doc = await db.collection('users').doc(userId).get()
      user = doc.data || null
      if (user) user._id = userId
    } else if (openidInput) {
      const res = await db.collection('users').where({ _openid: openidInput }).limit(1).get()
      user = (res.data && res.data[0]) || null
    } else {
      return fail('请指定会员 userId 或 openid')
    }
  } catch (e) {
    return fail(e.message || '查找会员失败')
  }

  if (!user || !user._id) return fail('未找到该会员')

  const { levels } = await loadMemberLevels(db)
  const before = await buildMemberSnapshot(user, levels)

  try {
    await db.collection('users').doc(user._id).update({
      data: {
        levelOverride: _.remove(),
        updateTime: db.serverDate()
      }
    })
  } catch (e) {
    // 部分环境不支持 _.remove，降级写 null
    try {
      await db.collection('users').doc(user._id).update({
        data: {
          levelOverride: null,
          updateTime: db.serverDate()
        }
      })
    } catch (e2) {
      return fail(e2.message || '清除覆盖失败')
    }
  }

  const refreshed = await db.collection('users').doc(user._id).get()
  const afterUser = refreshed.data || { ...user, levelOverride: null }
  afterUser._id = user._id
  afterUser.levelOverride = null
  const after = await buildMemberSnapshot(afterUser, levels)

  await writeOpsLog({
    action: 'clear',
    actionLabel: '清除覆盖',
    userId: user._id,
    openid: user._openid || '',
    openidMasked: maskOpenid(user._openid),
    phone: normalizePhone(user.phone),
    phoneMasked: maskPhone(user.phone),
    nickName: user.nickName || user.name || '',
    fromLevel: before.level,
    fromLevelName: before.levelName,
    toLevel: after.level,
    toLevelName: after.levelName,
    operatorOpenid: actor.openid || 'admin_web',
    operatorName: actor.name || 'Admin Web',
    source: actor.source || '',
    note
  })

  return ok({
    before,
    after,
    msg: `已清除人工覆盖，当前按成长值定为 ${after.levelName}`
  })
}

async function recentOps(event) {
  const limit = Math.min(50, Math.max(1, parseInt((event && event.limit) || 20, 10) || 20))
  try {
    const res = await db.collection(OPS_COLLECTION).orderBy('createTime', 'desc').limit(limit).get()
    const list = (res.data || []).map((row) => ({
      _id: row._id,
      action: row.action,
      actionLabel: row.actionLabel || (row.action === 'adjust' ? '调整等级' : row.action === 'clear' ? '清除覆盖' : row.action),
      phoneMasked: row.phoneMasked || maskPhone(row.phone),
      openidMasked: row.openidMasked || maskOpenid(row.openid),
      nickName: row.nickName || '',
      fromLevel: row.fromLevel,
      fromLevelName: row.fromLevelName || '',
      toLevel: row.toLevel,
      toLevelName: row.toLevelName || '',
      mode: row.mode || '',
      operatorName: row.operatorName || row.operatorOpenid || '',
      note: row.note || '',
      wasHonorary: !!row.wasHonorary,
      createTime: toMs(row.createTime)
    }))
    return ok({ list })
  } catch (e) {
    if (/collection|集合/.test(e.message || '')) {
      return ok({ list: [], msg: `审计集合 ${OPS_COLLECTION} 尚未创建（首次调整时会自动写入）` })
    }
    return fail(e.message || '操作日志加载失败')
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const adminOpsKey = event && event.adminOpsKey
  const action = String((event && event.action) || 'listLevels').trim()

  if (!openid && !adminOpsKey) return fail('未登录')

  const guard = await requireManager(openid, { adminOpsKey })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const actor = guard.actor

  try {
    if (action === 'listLevels') return await listLevels()
    if (action === 'search') return await searchMembers(event)
    if (action === 'adjust') return await adjustLevel(event, actor)
    if (action === 'clearOverride') return await clearOverride(event, actor)
    if (action === 'recentOps') return await recentOps(event)
    return fail(`未知 action: ${action}`)
  } catch (e) {
    console.error('manageMemberLevelAdjust', e)
    return fail(e.message || '操作失败')
  }
}
