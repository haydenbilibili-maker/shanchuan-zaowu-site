/**
 * aiIdentifyMonitor —— 超管「AI 鉴定监测」只读云函数
 *
 * 动作：
 *   overview                 今日 / 近 7 日次数、7 日成功率、人数、累计（只聚合数，不审计）
 *   list   { dateFrom?, dateTo?, status?, user?, page? }  分页 20 条（查看用户照片 → 先写审计）
 *   detail { id }            单条全文 + 原图临时链接（先写审计）
 *
 * 鉴权：staffGuard.assertStaff({ requireSuperAdmin: true })，只认小程序身份（不收 adminOpsKey）。
 * 审计：list / detail 读数据前先写 admin_operation_logs，写失败即拒绝（同 secureDataRead reveal 惯例）。
 * 数据：ai_identify_logs 由 identifySpecimen 旁路写入；规则客户端读写全拒。
 * 蓝图：miniprogram/docs/超管工作台_AI鉴定监测_2026-09-29.md
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const { assertStaff } = require('./staffGuard')

const LOGS = 'ai_identify_logs'
const PAGE_SIZE = 20
const MAX_PAGE = 500
const TEMP_URL_MAX_AGE = 600
const DAY_MS = 24 * 3600 * 1000
const BJ_OFFSET = 8 * 3600 * 1000

function fail(code, msg) {
  return { success: false, code, msg }
}

function bjDayStart(ts) {
  return Math.floor((ts + BJ_OFFSET) / DAY_MS) * DAY_MS - BJ_OFFSET
}

function parseDay(s) {
  const v = String(s || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const t = Date.parse(`${v}T00:00:00+08:00`)
  return Number.isFinite(t) ? t : null
}

function maskPhone(p) {
  const s = String(p || '').replace(/\D/g, '')
  if (!s) return ''
  if (s.length < 7) return '***'
  return `${s.slice(0, 3)}****${s.slice(-4)}`
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function countOf(where) {
  const q = where ? db.collection(LOGS).where(where) : db.collection(LOGS)
  const res = await q.count()
  return Number(res && res.total) || 0
}

async function distinctUsers(since) {
  try {
    const res = await db
      .collection(LOGS)
      .aggregate()
      .match({ created_at: _.gte(since) })
      .group({ _id: '$openid' })
      .count('n')
      .end()
    const rows = (res && (res.list || res.data)) || []
    const row = rows[0]
    return Number(row && row.n) || 0
  } catch (e) {
    console.warn('distinctUsers', e && e.message)
    return null
  }
}

async function audit(actor, action, detail) {
  await db.collection('admin_operation_logs').add({
    data: {
      module: 'privacy',
      action,
      username: (actor && (actor.name || actor.openid)) || '',
      operatorOpenid: (actor && actor.openid) || '',
      source: 'aiIdentifyMonitor',
      detail,
      timestamp: Date.now()
    }
  })
}

async function tempUrls(fileIds) {
  const ids = [...new Set(fileIds.filter((f) => /^cloud:\/\//.test(String(f || ''))))]
  const map = {}
  if (!ids.length) return map
  try {
    const res = await cloud.getTempFileURL({
      fileList: ids.map((fileID) => ({ fileID, maxAge: TEMP_URL_MAX_AGE }))
    })
    ;(res.fileList || []).forEach((f) => {
      if (f && f.tempFileURL) map[f.fileID] = f.tempFileURL
    })
  } catch (e) {
    console.warn('getTempFileURL', e && e.message)
  }
  return map
}

async function usersOf(openids) {
  const ids = [...new Set(openids.filter(Boolean))]
  const map = {}
  if (!ids.length) return map
  try {
    const res = await db
      .collection('users')
      .where({ _openid: _.in(ids) })
      .field({ _openid: true, nickName: true, phone: true })
      .limit(100)
      .get()
    ;(res.data || []).forEach((u) => {
      map[u._openid] = { nickName: String(u.nickName || '').slice(0, 30), phone: maskPhone(u.phone) }
    })
  } catch (e) {
    console.warn('usersOf', e && e.message)
  }
  return map
}

/** 用户筛选：手机号全号 / openid / 昵称片段 → openid 列表；null = 不筛 */
async function resolveUserFilter(keyword) {
  const kw = String(keyword || '').trim().slice(0, 40)
  if (!kw) return null
  if (/^o[\w-]{20,}$/.test(kw)) return [kw]
  let where
  if (/^1\d{10}$/.test(kw)) where = { phone: kw }
  else where = { nickName: db.RegExp({ regexp: escapeRegExp(kw), options: 'i' }) }
  const res = await db.collection('users').where(where).field({ _openid: true }).limit(20).get()
  return (res.data || []).map((u) => u._openid).filter(Boolean)
}

async function overview() {
  const now = Date.now()
  const today = bjDayStart(now)
  const week = today - 6 * DAY_MS
  const [todayTotal, weekTotal, weekOk, total, historyTotal, todayUsers, weekUsers, firstLive] = await Promise.all([
    countOf({ created_at: _.gte(today) }),
    countOf({ created_at: _.gte(week) }),
    countOf({ created_at: _.gte(week), success: true }),
    countOf(null),
    countOf({ source: 'history' }),
    distinctUsers(today),
    distinctUsers(week),
    db.collection(LOGS).where({ source: 'live' }).orderBy('created_at', 'asc').limit(1).field({ created_at: true }).get()
  ])
  const live = firstLive && firstLive.data && firstLive.data[0]
  return {
    success: true,
    data: {
      todayTotal,
      weekTotal,
      weekSuccessRate: weekTotal ? Math.round((weekOk / weekTotal) * 1000) / 10 : null,
      todayUsers,
      weekUsers,
      total,
      historyTotal,
      liveSince: (live && live.created_at) || 0
    }
  }
}

async function list(event, actor) {
  const from = parseDay(event.dateFrom)
  const to = parseDay(event.dateTo)
  const status = ['success', 'failed'].indexOf(event.status) !== -1 ? event.status : 'all'
  const page = Math.min(Math.max(parseInt(event.page, 10) || 0, 0), MAX_PAGE)
  const userKw = String(event.user || '').trim().slice(0, 40)

  try {
    await audit(actor, 'view_identify_logs', { dateFrom: event.dateFrom || '', dateTo: event.dateTo || '', status, user: userKw, page })
  } catch (e) {
    return fail('AUDIT_FAILED', `查看须先记审计日志，写入失败：${(e && e.message) || e}`)
  }

  const where = {}
  if (from != null && to != null) where.created_at = _.gte(from).and(_.lt(to + DAY_MS))
  else if (from != null) where.created_at = _.gte(from)
  else if (to != null) where.created_at = _.lt(to + DAY_MS)
  if (status === 'success') where.success = true
  if (status === 'failed') where.success = false
  const openids = await resolveUserFilter(userKw)
  if (openids) {
    if (!openids.length) return { success: true, data: { list: [], total: 0, page, pageSize: PAGE_SIZE, hasMore: false } }
    where.openid = _.in(openids)
  }
  const hasWhere = Object.keys(where).length > 0
  const base = () => (hasWhere ? db.collection(LOGS).where(where) : db.collection(LOGS))
  const [res, total] = await Promise.all([
    base()
      .orderBy('created_at', 'desc')
      .skip(page * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .field({
        openid: true, image_file_id: true, status: true, success: true, error_msg: true,
        species_name_zh: true, species_name_latin: true, confidence: true, confidence_level: true,
        is_specimen: true, duration_ms: true, entry_source: true, created_at: true, source: true
      })
      .get(),
    countOf(hasWhere ? where : null)
  ])
  const rows = res.data || []
  const [urls, users] = await Promise.all([
    tempUrls(rows.map((r) => r.image_file_id)),
    usersOf(rows.map((r) => r.openid))
  ])
  return {
    success: true,
    data: {
      list: rows.map(({ image_file_id: fileId, ...r }) => ({
        ...r,
        imageUrl: urls[fileId] || '',
        user: users[r.openid] || null
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
      hasMore: (page + 1) * PAGE_SIZE < total
    }
  }
}

async function detail(event, actor) {
  const id = String(event.id || '').trim()
  if (!id || id.length > 64) return fail('BAD_INPUT', '缺少记录')
  try {
    await audit(actor, 'view_identify_detail', { id })
  } catch (e) {
    return fail('AUDIT_FAILED', `查看须先记审计日志，写入失败：${(e && e.message) || e}`)
  }
  let doc = null
  try {
    const res = await db.collection(LOGS).doc(id).get()
    doc = res && (Array.isArray(res.data) ? res.data[0] : res.data)
  } catch (e) {
    doc = null
  }
  if (!doc) return fail('NOT_FOUND', '记录不存在')

  const [urls, users, feedback, record] = await Promise.all([
    tempUrls([doc.image_file_id]),
    usersOf([doc.openid]),
    doc.record_id
      ? db.collection('identification_feedback').where({ record_id: doc.record_id }).limit(5).get().then((r) => r.data || []).catch(() => [])
      : Promise.resolve([]),
    doc.record_id
      ? db.collection('identification_records').doc(doc.record_id).get().then((r) => r.data || null).catch(() => null)
      : Promise.resolve(null)
  ])
  const coverUrls = await tempUrls((doc.related_products || []).map((p) => p.cover))
  const { image_file_id: fileId, ...rest } = doc
  return {
    success: true,
    data: {
      ...rest,
      imageUrl: urls[fileId] || '',
      user: users[doc.openid] || null,
      related_products: (doc.related_products || []).map((p) => ({
        ...p,
        coverUrl: /^cloud:\/\//.test(String(p.cover || '')) ? coverUrls[p.cover] || '' : p.cover || ''
      })),
      feedback: feedback.map((f) => ({
        corrected_name_zh: f.corrected_name_zh || '',
        note: f.note || '',
        created_at: f.created_at || 0
      })),
      recordFlags: record ? { isShared: !!record.is_shared, isBookmarked: !!record.is_bookmarked, reuseCount: Number(record.reuse_count) || 0 } : null
    }
  }
}

const ACTIONS = { overview, list, detail }

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext() || {}
  const openid = OPENID || ''
  if (!openid) return fail('UNAUTHORIZED', '请先登录')
  const action = String(event.action || '')
  if (!ACTIONS[action]) return fail('UNKNOWN_ACTION', `未知操作：${action}`)
  const guard = await assertStaff(db, openid, { requireSuperAdmin: true })
  if (!guard.ok) return fail(guard.code || 'FORBIDDEN', guard.msg || '仅超管可查看')
  try {
    return await ACTIONS[action](event, guard.actor)
  } catch (err) {
    console.error('aiIdentifyMonitor', action, err)
    return fail('INTERNAL', (err && err.message) || '读取失败')
  }
}
