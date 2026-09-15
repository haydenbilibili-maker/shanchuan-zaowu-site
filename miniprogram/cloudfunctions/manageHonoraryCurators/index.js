/**
 * 荣誉馆长名单管理（Admin / 超管工作台）
 *
 * action: list | lookupByPhone | add | remove | recentOps | overview
 *
 * 业务规则：
 * - 以手机号为唯一键维护 honorary_curators（status: active | removed）
 * - 写入时同步 users.isHonorary（小程序 resolveMemberLevel 据此判定 Lv99）
 * - 移出后清除 isHonorary，等级回落到成长值对应档
 * - 新增 / 移出均需 HONORARY_CURATOR_PASSWORD（或 HASH）二次密码；不可仅靠 ADMIN_OPS_KEY
 * - 操作写入 honorary_curator_ops 审计日志
 * - lookupByPhone：完整 11 位精确查；≥3 位后缀/片段模糊查 users，供「找会员授予」
 *
 * 鉴权：staffGuard manager + manageHonoraryCurators；Admin Web 用 ADMIN_OPS_KEY
 */
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')
const { dispatchInAppMessage } = require('./inAppMessage')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const EVENT_HONORARY_GRANTED = 'honorary_curator_granted'

const COLLECTION = 'honorary_curators'
const OPS_COLLECTION = 'honorary_curator_ops'
const PERMISSION = 'manageHonoraryCurators'
const PHONE_RE = /^1\d{10}$/
const PAGE_SIZE_MAX = 50

const STATUS_ACTIVE = 'active'
const STATUS_REMOVED = 'removed'

function fail(msg, extra) {
  return { success: false, msg, ...(extra || {}) }
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '')
}

function maskPhone(phone) {
  const value = String(phone || '')
  if (value.length < 7) return value || ''
  return value.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
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
 * 荣誉馆长发放口令（云函数环境变量，勿写入前端）：
 * - HONORARY_CURATOR_PASSWORD：明文（timingSafeEqual）
 * - 或 HONORARY_CURATOR_PASSWORD_HASH：SHA-256 hex（可带 sha256: 前缀）
 */
function verifyGrantPassword(input) {
  const plain = String(process.env.HONORARY_CURATOR_PASSWORD || '')
  const hashEnv = String(process.env.HONORARY_CURATOR_PASSWORD_HASH || '')
    .trim()
    .toLowerCase()
    .replace(/^sha256:/, '')

  if (!plain && !hashEnv) {
    return {
      ok: false,
      code: 'PASSWORD_UNCONFIGURED',
      msg: '未配置荣誉馆长授权密码：请在云函数环境变量设置 HONORARY_CURATOR_PASSWORD 或 HONORARY_CURATOR_PASSWORD_HASH'
    }
  }

  const submitted = String(input || '')
  if (!submitted) {
    return { ok: false, code: 'PASSWORD_REQUIRED', msg: '请输入荣誉馆长授权密码' }
  }

  try {
    if (hashEnv) {
      if (!/^[0-9a-f]{64}$/.test(hashEnv)) {
        return { ok: false, code: 'PASSWORD_MISCONFIGURED', msg: 'HONORARY_CURATOR_PASSWORD_HASH 格式无效（需 64 位 hex）' }
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
    console.error('verifyGrantPassword', e)
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

function formatRow(doc) {
  if (!doc) return null
  return {
    _id: doc._id,
    phone: doc.phone || '',
    phoneMasked: doc.phoneMasked || maskPhone(doc.phone),
    status: doc.status || STATUS_ACTIVE,
    statusLabel: doc.status === STATUS_REMOVED ? '已移出' : '生效中',
    note: doc.note || '',
    matchedUserCount: Array.isArray(doc.matchedOpenids) ? doc.matchedOpenids.length : (doc.matchedUserCount || 0),
    nickNames: Array.isArray(doc.nickNames) ? doc.nickNames : [],
    createdBy: doc.createdBy || '',
    createdByName: doc.createdByName || '',
    createTime: toMs(doc.createTime || doc._createTime),
    updateTime: toMs(doc.updateTime),
    removedBy: doc.removedBy || '',
    removedByName: doc.removedByName || '',
    removedAt: toMs(doc.removedAt)
  }
}

async function findUsersByPhone(phone) {
  try {
    const res = await db.collection('users').where({ phone }).limit(20).get()
    return res.data || []
  } catch (e) {
    console.warn('findUsersByPhone', e.message)
    return []
  }
}

/**
 * 模糊查 users.phone：优先后缀匹配（与赠分后四位一致），不足再含片段匹配。
 * 仅允许 3–10 位数字，避免扫全表。
 */
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
    const suffixRows = suffixRes.data || []
    if (suffixRows.length) return suffixRows

    const containsRes = await db
      .collection('users')
      .where({ phone: db.RegExp({ regexp: escapeRe, options: '' }) })
      .limit(20)
      .get()
    return containsRes.data || []
  } catch (e) {
    console.warn('findUsersByPhonePartial', e.message)
    return []
  }
}

async function findRosterByPhone(phone) {
  try {
    const res = await db.collection(COLLECTION).where({ phone }).limit(1).get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    return null
  }
}

function formatCandidate(user, roster) {
  const phone = normalizePhone(user && user.phone)
  const isHonorary = !!(user && user.isHonorary === true)
  const onRoster = !!(roster && roster.status === STATUS_ACTIVE)
  const levelNum = Number(user && (user.level || user.memberLevel))
  let levelLabel = ''
  if (onRoster || isHonorary) {
    levelLabel = '荣誉馆长'
  } else if (user && (user.levelName || user.memberLevelName)) {
    levelLabel = String(user.levelName || user.memberLevelName)
  } else if (Number.isFinite(levelNum) && levelNum > 0) {
    levelLabel = `Lv${levelNum}`
  } else {
    levelLabel = '会员'
  }

  return {
    openid: (user && user._openid) || '',
    openidTail: String((user && user._openid) || '').slice(-8),
    nickName: (user && (user.nickName || user.name)) || '藏家',
    avatarUrl: (user && user.avatarUrl) || '',
    phone,
    phoneMasked: maskPhone(phone),
    isHonorary,
    onRoster,
    rosterStatus: roster ? roster.status : '',
    canGrant: !!(phone && PHONE_RE.test(phone) && !onRoster),
    levelLabel,
    statusLabel: onRoster ? '已是荣誉馆长' : isHonorary ? '标记异常（未在名单）' : '可授予'
  }
}

async function syncUsersHonorary(phone, isHonorary) {
  const users = await findUsersByPhone(phone)
  const openids = []
  const nickNames = []
  for (const user of users) {
    if (!user._id) continue
    try {
      const data = {
        isHonorary: !!isHonorary,
        honoraryUpdatedAt: db.serverDate(),
        updateTime: db.serverDate()
      }
      // 移出时清除通知标记，便于再次授予时重新发送
      if (!isHonorary) data.honoraryNotifiedGrantId = ''
      await db.collection('users').doc(user._id).update({ data })
      if (user._openid) openids.push(user._openid)
      nickNames.push(user.nickName || user.name || '藏家')
    } catch (e) {
      console.warn('syncUsersHonorary update failed:', e.message)
    }
  }
  return { matchedUserCount: openids.length, matchedOpenids: openids, nickNames }
}

/**
 * 永久去重：dispatchMessage 仅 24h 窗口，荣誉馆长需按 grantId 终身防重。
 */
async function alreadyNotifiedHonorary(openid, grantId) {
  if (!openid || !grantId) return false
  try {
    const userRes = await db.collection('users').where({ _openid: openid }).limit(1).get()
    const user = userRes.data && userRes.data[0]
    if (user && user.honoraryNotifiedGrantId === grantId) return true
  } catch (e) {
    // ignore
  }
  try {
    const dedupeKey = `${EVENT_HONORARY_GRANTED}:${grantId}:${openid}`
    const dup = await db.collection('user_messages').where({ dedupeKey }).limit(1).get()
    if (dup.data && dup.data.length) return true
  } catch (e) {
    // ignore
  }
  return false
}

async function markHonoraryNotified(openid, grantId) {
  if (!openid || !grantId) return
  try {
    const userRes = await db.collection('users').where({ _openid: openid }).limit(1).get()
    const user = userRes.data && userRes.data[0]
    if (!user || !user._id) return
    await db.collection('users').doc(user._id).update({
      data: { honoraryNotifiedGrantId: grantId }
    })
  } catch (e) {
    console.warn('markHonoraryNotified failed:', e.message)
  }
}

/**
 * 授予成功后向已绑定该手机号的用户发送「山海有信」。
 * relatedId = grantId，与 authPhone 绑号补发共用，防重复。
 */
async function notifyHonoraryGranted(openids, grantId) {
  const notified = []
  const unique = Array.from(new Set((openids || []).filter(Boolean)))
  for (const openid of unique) {
    try {
      if (await alreadyNotifiedHonorary(openid, grantId)) {
        notified.push(openid)
        continue
      }
      const res = await dispatchInAppMessage(db, {
        eventType: EVENT_HONORARY_GRANTED,
        openid,
        relatedId: grantId,
        vars: {}
      })
      if (res && res.success) {
        await markHonoraryNotified(openid, grantId)
        notified.push(openid)
      }
    } catch (e) {
      console.warn('honorary_curator_granted message skipped:', e.message)
    }
  }
  return notified
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
    console.warn('honorary_curator_ops write failed:', e.message)
  }
}

async function listCurators(event) {
  const status = String((event && event.status) || STATUS_ACTIVE).trim()
  const phoneQuery = normalizePhone(event && event.phone)
  const page = Math.max(1, parseInt((event && event.page) || 1, 10) || 1)
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, parseInt((event && event.pageSize) || 20, 10) || 20)
  )
  const skip = (page - 1) * pageSize

  const where = {}
  if (status === STATUS_ACTIVE || status === STATUS_REMOVED) {
    where.status = status
  } else if (status !== 'all') {
    where.status = STATUS_ACTIVE
  }
  if (PHONE_RE.test(phoneQuery)) {
    where.phone = phoneQuery
  } else if (phoneQuery && phoneQuery.length >= 3) {
    // 模糊搜：先拉一批再内存过滤（云开发 where 无正则时的稳妥降级）
  }

  try {
    let query = db.collection(COLLECTION)
    if (Object.keys(where).length) query = query.where(where)

    let list = []
    let total = 0

    if (phoneQuery && !PHONE_RE.test(phoneQuery) && phoneQuery.length >= 3) {
      const fetchLimit = 200
      const listRes = await query.orderBy('createTime', 'desc').limit(fetchLimit).get()
      const filtered = (listRes.data || []).filter((row) =>
        String(row.phone || '').includes(phoneQuery)
      )
      total = filtered.length
      list = filtered.slice(skip, skip + pageSize).map(formatRow)
    } else {
      const [listRes, countRes] = await Promise.all([
        query.orderBy('createTime', 'desc').skip(skip).limit(pageSize).get(),
        Object.keys(where).length
          ? db.collection(COLLECTION).where(where).count()
          : db.collection(COLLECTION).count()
      ])
      list = (listRes.data || []).map(formatRow)
      total = (countRes && countRes.total) || 0
    }

    return { success: true, list, total, page, pageSize }
  } catch (e) {
    if (/collection|集合/.test(e.message || '')) {
      return fail(`请先在云开发控制台创建集合 ${COLLECTION}`)
    }
    // 无 createTime 索引时降级
    console.warn('listCurators orderBy failed, fallback:', e.message)
    try {
      let q2 = db.collection(COLLECTION)
      if (Object.keys(where).length) q2 = q2.where(where)
      const listRes = await q2.limit(pageSize).skip(skip).get()
      return {
        success: true,
        list: (listRes.data || []).map(formatRow),
        total: (listRes.data || []).length,
        page,
        pageSize
      }
    } catch (e2) {
      return fail(e2.message || '列表加载失败')
    }
  }
}

const OVERVIEW_FETCH_CAP = 500

function pctOf(count, max) {
  if (!max) return 0
  return Math.round((count / max) * 1000) / 10
}

function toBars(entries) {
  const max = entries.reduce((m, e) => Math.max(m, e.count || 0), 0) || 1
  return entries.map((e) => ({
    ...e,
    pct: pctOf(e.count || 0, max)
  }))
}

async function safeCount(where) {
  try {
    const res = Object.keys(where || {}).length
      ? await db.collection(COLLECTION).where(where).count()
      : await db.collection(COLLECTION).count()
    return res.total || 0
  } catch (e) {
    return 0
  }
}

/** 数据概览：生效 / 名单 / 近 30 日操作 */
async function overview() {
  const [active, removed] = await Promise.all([
    safeCount({ status: STATUS_ACTIVE }),
    safeCount({ status: STATUS_REMOVED })
  ])

  let activeRows = []
  let dataCapped = false
  try {
    const res = await db.collection(COLLECTION)
      .where({ status: STATUS_ACTIVE })
      .orderBy('createTime', 'desc')
      .limit(OVERVIEW_FETCH_CAP)
      .get()
    activeRows = res.data || []
    dataCapped = active > activeRows.length
  } catch (e) {
    try {
      const res = await db.collection(COLLECTION)
        .where({ status: STATUS_ACTIVE })
        .limit(OVERVIEW_FETCH_CAP)
        .get()
      activeRows = res.data || []
      dataCapped = active > activeRows.length
    } catch (e2) {
      console.warn('honorary overview sample', e2 && e2.message)
    }
  }

  let bound = 0
  let unbound = 0
  for (const row of activeRows) {
    const matched = Array.isArray(row.matchedOpenids)
      ? row.matchedOpenids.length
      : (Number(row.matchedUserCount) || 0)
    if (matched > 0) bound += 1
    else unbound += 1
  }

  const rosterBars = toBars([
    { key: 'active', name: '生效中', count: active },
    { key: 'removed', name: '已移出', count: removed }
  ])
  const bindBars = toBars([
    { key: 'bound', name: '已绑会员', count: bound },
    { key: 'unbound', name: '仅名单', count: unbound }
  ])

  const monthAgo = Date.now() - 30 * 24 * 3600 * 1000
  let grants = 0
  let removals = 0
  let opsLoaded = 0
  try {
    const opsRes = await db.collection(OPS_COLLECTION)
      .orderBy('createTime', 'desc')
      .limit(200)
      .get()
    const ops = (opsRes.data || []).filter((row) => toMs(row.createTime) >= monthAgo)
    opsLoaded = ops.length
    for (const row of ops) {
      if (row.action === 'add') grants += 1
      else if (row.action === 'remove') removals += 1
    }
  } catch (e) {
    console.warn('honorary overview ops', e.message)
  }

  const opsBars = toBars([
    { key: 'add', name: '授予', count: grants },
    { key: 'remove', name: '移出', count: removals }
  ])

  return {
    success: true,
    dataCapped,
    fetchCap: OVERVIEW_FETCH_CAP,
    totalLoaded: activeRows.length,
    definitions: {
      active: '生效中馆长 · 已绑会员 / 仅名单号',
      roster: '名单全量状态（精确 count）',
      recent: '近 30 日授予 / 移出操作'
    },
    active: {
      count: active,
      bound,
      unbound,
      sampled: activeRows.length,
      bindBars
    },
    roster: {
      active,
      removed,
      total: active + removed,
      bars: rosterBars
    },
    recent: {
      days: 30,
      grants,
      removals,
      opsLoaded,
      bars: opsBars
    }
  }
}

async function lookupByPhone(event) {
  const phoneQuery = normalizePhone(event && event.phone)
  if (!phoneQuery || phoneQuery.length < 3) {
    return fail('请输入至少 3 位手机号（完整号或后几位）')
  }
  if (phoneQuery.length > 11) return fail('手机号无效')

  const exact = PHONE_RE.test(phoneQuery)
  let users = []
  if (exact) {
    users = await findUsersByPhone(phoneQuery)
  } else {
    users = await findUsersByPhonePartial(phoneQuery)
  }

  const rosterCache = {}
  async function rosterFor(phone) {
    if (!phone) return null
    if (Object.prototype.hasOwnProperty.call(rosterCache, phone)) return rosterCache[phone]
    const row = await findRosterByPhone(phone)
    rosterCache[phone] = row
    return row
  }

  const candidates = []
  for (const user of users) {
    const phone = normalizePhone(user && user.phone)
    if (!PHONE_RE.test(phone)) continue
    const roster = await rosterFor(phone)
    candidates.push(formatCandidate(user, roster))
  }

  let roster = null
  if (exact) {
    roster = await rosterFor(phoneQuery)
  }

  const onRoster = !!(roster && roster.status === STATUS_ACTIVE)
  let msg = ''
  if (candidates.length) {
    msg = exact
      ? `找到 ${candidates.length} 个绑定该手机号的用户`
      : `找到 ${candidates.length} 个匹配「${phoneQuery}」的会员`
  } else if (exact) {
    msg = onRoster
      ? '该手机号已在荣誉馆长名单中，但暂无绑定用户'
      : '未找到该手机号用户；仍可用完整号加入名单，待对方绑定手机号后自动生效'
  } else {
    msg = '未找到匹配会员，请改用完整 11 位手机号，或确认对方已授权手机号'
  }

  return {
    success: true,
    query: phoneQuery,
    exact,
    phone: exact ? phoneQuery : '',
    phoneMasked: exact ? maskPhone(phoneQuery) : '',
    onRoster: exact ? onRoster : false,
    rosterStatus: exact && roster ? roster.status : '',
    canGrantWithoutUser: exact && !onRoster,
    candidates,
    count: candidates.length,
    msg
  }
}

async function addCurator(event, actor) {
  const pwd = verifyGrantPassword(event && (event.confirmPassword || event.grantPassword))
  if (!pwd.ok) return fail(pwd.msg, { code: pwd.code })

  const phone = normalizePhone(event && event.phone)
  if (!PHONE_RE.test(phone)) return fail('请输入有效的 11 位手机号')

  const note = String((event && event.note) || '').trim().slice(0, 200)
  const sync = await syncUsersHonorary(phone, true)

  try {
    const existing = await db.collection(COLLECTION).where({ phone }).limit(1).get()
    const row = existing.data && existing.data[0]
    const base = {
      phone,
      phoneMasked: maskPhone(phone),
      status: STATUS_ACTIVE,
      note,
      matchedOpenids: sync.matchedOpenids,
      matchedUserCount: sync.matchedUserCount,
      nickNames: sync.nickNames,
      updateTime: db.serverDate(),
      removedBy: '',
      removedByName: '',
      removedAt: null
    }

    let id = ''
    if (row) {
      if (row.status === STATUS_ACTIVE) {
        return fail('该手机号已在荣誉馆长名单中', { code: 'ALREADY_ACTIVE' })
      }
      id = row._id
    } else {
      const added = await db.collection(COLLECTION).add({
        data: {
          ...base,
          grantId: '',
          notifiedOpenids: [],
          createdBy: actor.openid || 'admin_web',
          createdByName: actor.name || 'Admin Web',
          createTime: db.serverDate()
        }
      })
      id = added._id
    }

    // 每次授予生成新 grantId，便于移出后再授予时重新通知；绑号补发共用此 id 防重
    const grantId = `${id}_${Date.now()}`
    await db.collection(COLLECTION).doc(id).update({
      data: {
        ...base,
        grantId,
        notifiedOpenids: [],
        createdBy: actor.openid || 'admin_web',
        createdByName: actor.name || 'Admin Web',
        createTime: db.serverDate()
      }
    })

    const notifiedOpenids = await notifyHonoraryGranted(sync.matchedOpenids, grantId)
    if (notifiedOpenids.length) {
      try {
        await db.collection(COLLECTION).doc(id).update({
          data: { notifiedOpenids }
        })
      } catch (e) {
        console.warn('notifiedOpenids update failed:', e.message)
      }
    }

    await writeOpsLog({
      action: 'add',
      phone,
      phoneMasked: maskPhone(phone),
      operatorOpenid: actor.openid || 'admin_web',
      operatorName: actor.name || 'Admin Web',
      source: actor.source || '',
      matchedUserCount: sync.matchedUserCount,
      notifiedCount: notifiedOpenids.length,
      grantId,
      note,
      rosterId: id
    })

    return {
      success: true,
      id,
      grantId,
      matchedUserCount: sync.matchedUserCount,
      notifiedCount: notifiedOpenids.length,
      msg: sync.matchedUserCount
        ? `已授予荣誉馆长，已同步 ${sync.matchedUserCount} 个账号` +
          (notifiedOpenids.length ? `，已发送 ${notifiedOpenids.length} 条山海有信` : '')
        : '已加入名单（暂无绑定用户，对方授权手机号后将自动生效并补发通知）'
    }
  } catch (e) {
    if (/collection|集合/.test(e.message || '')) {
      return fail(`请先在云开发控制台创建集合 ${COLLECTION}`)
    }
    console.error('addCurator', e)
    return fail(e.message || '授予失败')
  }
}

async function removeCurator(event, actor) {
  const pwd = verifyGrantPassword(event && (event.confirmPassword || event.grantPassword))
  if (!pwd.ok) return fail(pwd.msg, { code: pwd.code })

  const id = String((event && event.id) || '').trim()
  const phoneInput = normalizePhone(event && event.phone)
  let row = null

  try {
    if (id) {
      const doc = await db.collection(COLLECTION).doc(id).get()
      row = doc.data || null
      if (row) row._id = id
    } else if (PHONE_RE.test(phoneInput)) {
      const res = await db.collection(COLLECTION).where({ phone: phoneInput }).limit(1).get()
      row = (res.data && res.data[0]) || null
    } else {
      return fail('请提供名单 id 或手机号')
    }
  } catch (e) {
    return fail(e.message || '查找名单失败')
  }

  if (!row) return fail('未找到该荣誉馆长记录')
  if (row.status === STATUS_REMOVED) return fail('该号码已移出名单')

  const phone = row.phone || phoneInput
  const sync = await syncUsersHonorary(phone, false)

  try {
    await db.collection(COLLECTION).doc(row._id).update({
      data: {
        status: STATUS_REMOVED,
        matchedOpenids: sync.matchedOpenids,
        matchedUserCount: sync.matchedUserCount,
        nickNames: sync.nickNames,
        removedBy: actor.openid || 'admin_web',
        removedByName: actor.name || 'Admin Web',
        removedAt: db.serverDate(),
        updateTime: db.serverDate()
      }
    })

    await writeOpsLog({
      action: 'remove',
      phone,
      phoneMasked: maskPhone(phone),
      operatorOpenid: actor.openid || 'admin_web',
      operatorName: actor.name || 'Admin Web',
      source: actor.source || '',
      matchedUserCount: sync.matchedUserCount,
      note: String((event && event.note) || '').trim().slice(0, 200),
      rosterId: row._id
    })

    return {
      success: true,
      matchedUserCount: sync.matchedUserCount,
      msg: '已移出荣誉馆长名单，会员等级将按成长值恢复'
    }
  } catch (e) {
    console.error('removeCurator', e)
    return fail(e.message || '移出失败')
  }
}

async function recentOps(event) {
  const limit = Math.min(50, Math.max(1, parseInt((event && event.limit) || 20, 10) || 20))
  try {
    const res = await db.collection(OPS_COLLECTION).orderBy('createTime', 'desc').limit(limit).get()
    const list = (res.data || []).map((row) => ({
      _id: row._id,
      action: row.action,
      actionLabel: row.action === 'add' ? '授予' : row.action === 'remove' ? '移出' : row.action,
      phoneMasked: row.phoneMasked || maskPhone(row.phone),
      operatorName: row.operatorName || row.operatorOpenid || '',
      matchedUserCount: row.matchedUserCount || 0,
      note: row.note || '',
      createTime: toMs(row.createTime)
    }))
    return { success: true, list }
  } catch (e) {
    if (/collection|集合/.test(e.message || '')) {
      return { success: true, list: [], msg: `审计集合 ${OPS_COLLECTION} 尚未创建` }
    }
    return fail(e.message || '操作日志加载失败')
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const adminOpsKey = event && event.adminOpsKey
  const action = String((event && event.action) || 'list').trim()

  if (!openid && !adminOpsKey) return fail('未登录')

  const guard = await requireManager(openid, { adminOpsKey })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const actor = guard.actor

  try {
    if (action === 'list') return await listCurators(event)
    if (action === 'overview') return await overview()
    if (action === 'lookupByPhone') return await lookupByPhone(event)
    if (action === 'add') return await addCurator(event, actor)
    if (action === 'remove') return await removeCurator(event, actor)
    if (action === 'recentOps') return await recentOps(event)
    return fail(`未知操作：${action}`)
  } catch (e) {
    console.error('manageHonoraryCurators', e)
    return fail(e.message || '操作失败')
  }
}
