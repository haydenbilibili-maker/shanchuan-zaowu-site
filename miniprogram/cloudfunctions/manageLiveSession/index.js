/**
 * 直播场次管理
 *
 * action:
 *   getActive      — C 端：当前进行中场次（无 pushUrl；受 showLive 约束）；可附带 upcoming / shelf
 *   getSession     — C 端：按 sessionId 取可观看场次（分享进房）
 *   create         — 店长/超管：创建场次（idle），返回 pushUrl
 *   start          — 店长/超管：开播（status=live），返回 pushUrl
 *   end            — 店长/超管：结束直播（清空 pushUrl）
 *   like           — C 端：进行中场次点赞（热度）
 *   heartbeat      — C 端：进房心跳 → 近似在线人数
 *   postMessage    — C 端：本场留言墙（限频 + 粗滤）
 *   listMessages   — C 端/主播：拉取本场最近留言
 *   updateShelf    — 店长/超管：挂车上架/下架/全量替换；另支持 move / clear
 *   setSpotlight   — 店长/超管：设置「讲解中」商品
 *   forceEnd       — 店长/超管：强制结束指定/当前场次（清 pushUrl）
 *   getHostSession — 店长/超管：本人未结束场次（含 pushUrl）
 *   getDashboard   — 店长/超管：当前全场状态 + 本人场次 + lastEnded + 最近列表（列表无 pushUrl）
 *   updateNotice   — 店长/超管：更新本场公告（一条短文案，非弹幕）
 *   updateMeta     — 店长/超管：封面 / 预约时间
 *   listRecent     — 店长/超管：最近场次（无 pushUrl）
 *
 * 安全：publicSession / getActive / listRecent 永不返回 pushUrl。
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_STAFF } = require('./staffGuard')
const { readConfig, isConfigured, buildStreamUrls, makeStreamName } = require('./streamUrls')
const {
  MSG_MAX,
  MSG_RATE_MS,
  MSG_LIST_LIMIT,
  normalizeMessage,
  isBlockedText,
  presenceKey,
  maskAuthor
} = require('./moderation')
const {
  SHELF_MAX,
  normalizeProductIds,
  moveProductId,
  emptyShelf,
  buildShelfSummary
} = require('./shelf')
const {
  MSG_USER_MAX_PER_SESSION,
  HB_MIN_MS,
  PRESENCE_TTL_MS,
  AUDIT_MAX,
  NOTICE_MAX,
  COVER_MAX,
  buildStats,
  shelfAuditEntry
} = require('./abuse')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const COLLECTION = 'live_sessions'
const MSG_COLLECTION = 'live_messages'
const REMIND_COLLECTION = 'live_reminders'
const FLAGS_COLLECTION = 'content_display_flags'
const PERMISSION = 'manageLive'
const STATUS_IDLE = 'idle'
const STATUS_LIVE = 'live'
const STATUS_ENDED = 'ended'
function remindTemplateId() {
  return String(process.env.LIVE_REMIND_TMPL_ID || '').trim()
}

function remindSubscribeMeta() {
  const templateId = remindTemplateId()
  return {
    configured: !!templateId,
    templateId: templateId || '',
    // 客户端用此文案区分「可授权」与「仅登记」
    hint: templateId
      ? '授权后可在开播时收到微信通知'
      : '模板待审：先登记，开播后将尽量通知（配置 LIVE_REMIND_TMPL_ID 后可发订阅消息）'
  }
}

function stripPush(doc) {
  if (!doc) return null
  const copy = { ...doc }
  delete copy.pushUrl
  delete copy.presence
  return copy
}

function countPresence(presence) {
  const now = Date.now()
  const obj = presence && typeof presence === 'object' ? presence : {}
  let n = 0
  Object.keys(obj).forEach((k) => {
    if (Number(obj[k]) > now - PRESENCE_TTL_MS) n += 1
  })
  return n
}

function parseScheduledAt(raw) {
  if (raw == null || raw === '') return null
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
  const s = String(raw).trim()
  if (!s) return null
  const t = Date.parse(s)
  if (!Number.isNaN(t) && t > 0) return t
  const asNum = Number(s)
  if (Number.isFinite(asNum) && asNum > 1e11) return asNum
  return null
}

function formatScheduledLabel(ts) {
  const n = Number(ts) || 0
  if (!n) return ''
  const d = new Date(n)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function normalizeCoverUrl(raw) {
  const s = String(raw == null ? '' : raw).trim()
  if (!s) return ''
  if (s.length > COVER_MAX) return s.slice(0, COVER_MAX)
  if (/^(cloud:\/\/|https:\/\/)/i.test(s)) return s
  return ''
}

function publicSession(doc) {
  if (!doc) return null
  const safe = stripPush(doc)
  const scheduledAt = parseScheduledAt(safe.scheduledAt) || null
  const viewerCount = countPresence(doc.presence)
  const stats = buildStats(doc)
  return {
    _id: safe._id || '',
    title: safe.title || '',
    status: safe.status || '',
    streamName: safe.streamName || '',
    pullUrl: safe.pullUrl || '',
    pullUrlRtmp: safe.pullUrlRtmp || '',
    notice: String(safe.notice || '').slice(0, NOTICE_MAX),
    noticeUpdatedAt: Number(safe.noticeUpdatedAt) || 0,
    likeCount: stats.likeCount,
    viewerCount,
    stats,
    coverUrl: normalizeCoverUrl(safe.coverUrl),
    scheduledAt,
    scheduledLabel: formatScheduledLabel(scheduledAt),
    hostName: safe.hostName || '',
    // 安全：hostOpenid 与 endedToken 不属于公开投影。
    // endedToken 是「结束直播」的凭证，此前对所有观众下发 → 任何观众都能结束他人直播。
    startTime: safe.startTime || null,
    endTime: safe.endTime || null,
    createTime: safe.createTime || null,
    configured: safe.configured !== false,
    shelfCount: normalizeProductIds(safe.shelfProductIds).length
  }
}

function hostSession(doc) {
  const base = publicSession(doc)
  if (!base) return null
  const audit = Array.isArray(doc && doc.shelfAudit) ? doc.shelfAudit.slice(-10) : []
  return {
    ...base,
    // 仅主播投影下发：这些字段不进入 publicSession
    hostOpenid: (doc && doc.hostOpenid) || '',
    endedToken: (doc && doc.endedToken) || '',
    pushUrl: (doc && doc.pushUrl) || '',
    shelfProductIds: normalizeProductIds(doc && doc.shelfProductIds),
    spotlightProductId: String((doc && doc.spotlightProductId) || '').trim(),
    shelfAudit: audit
  }
}

async function enrichSession(doc, opts) {
  const options = opts || {}
  const asHost = !!options.asHost
  const enabled = options.enabled !== false
  const withShelf = options.withShelf !== false
  const base = asHost ? hostSession(doc) : publicSession(doc)
  if (!base) return null
  if (!withShelf) {
    base.shelf = emptyShelf(false)
    return base
  }
  const liveOk = doc.status === STATUS_LIVE && !!(doc.pullUrl && String(doc.pullUrl).trim())
  const purchasable = enabled && liveOk
  base.shelf = await buildShelfSummary(db, doc, { purchasable })
  return base
}

function busyMessage(other) {
  const title = (other && other.title) || '未命名场次'
  const host = (other && other.hostName) || '其他同事'
  return `当前已有直播进行中：「${title}」（主播 ${host}）。请先结束该场再开播，同时仅允许 1 场。`
}

function normalizeNotice(raw) {
  return String(raw == null ? '' : raw).trim().slice(0, NOTICE_MAX)
}

function publicMessage(row) {
  if (!row) return null
  return {
    _id: row._id || '',
    sessionId: row.sessionId || '',
    text: String(row.text || '').slice(0, MSG_MAX),
    author: row.author || '访客',
    createTime: row.createTime || null,
    ts: Number(row.ts) || 0
  }
}

/** status=live 但无可用拉/推地址（常见于未配 LIVE_* 时的历史脏数据） */
function isStaleLive(doc, configured) {
  if (!doc || doc.status !== STATUS_LIVE) return false
  if (!configured) return true
  const hasPull = !!(doc.pullUrl && String(doc.pullUrl).trim())
  const hasPush = !!(doc.pushUrl && String(doc.pushUrl).trim())
  return !hasPull && !hasPush
}

async function markEndedStale(doc) {
  if (!doc || !doc._id) return
  await db.collection(COLLECTION).doc(doc._id).update({
    data: {
      status: STATUS_ENDED,
      endTime: db.serverDate(),
      updateTime: db.serverDate(),
      pushUrl: '',
      staleCleared: true
    }
  })
}

/** 进行中且可播放；脏 live 自动收尾为 ended */
async function findPlayableActiveLive() {
  const configured = isConfigured(readConfig())
  const doc = await findActiveLive()
  if (!doc) return null
  if (isStaleLive(doc, configured)) {
    try {
      await markEndedStale(doc)
    } catch (e) {
      console.warn('markEndedStale', e && e.message)
    }
    return null
  }
  return doc
}

async function isLiveFeatureEnabled() {
  try {
    const res = await db.collection(FLAGS_COLLECTION)
      .where({ status: 'active' })
      .orderBy('priority', 'desc')
      .limit(1)
      .get()
    const doc = (res.data && res.data[0]) || null
    return !!(doc && doc.showLive === true)
  } catch (e) {
    try {
      const res = await db.collection(FLAGS_COLLECTION).limit(20).get()
      const rows = (res.data || [])
        .filter((d) => d.status !== 'inactive')
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))
      return !!(rows[0] && rows[0].showLive === true)
    } catch (err) {
      return false
    }
  }
}

async function findActiveLive() {
  try {
    const res = await db.collection(COLLECTION)
      .where({ status: STATUS_LIVE })
      .orderBy('startTime', 'desc')
      .limit(1)
      .get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    const res = await db.collection(COLLECTION).where({ status: STATUS_LIVE }).limit(20).get()
    const rows = res.data || []
    rows.sort((a, b) => {
      const ta = a.startTime ? new Date(a.startTime).getTime() : 0
      const tb = b.startTime ? new Date(b.startTime).getTime() : 0
      return tb - ta
    })
    return rows[0] || null
  }
}

async function findUpcomingIdle() {
  const now = Date.now()
  try {
    const res = await db.collection(COLLECTION)
      .where({ status: STATUS_IDLE })
      .orderBy('createTime', 'desc')
      .limit(10)
      .get()
    const rows = res.data || []
    const withSchedule = rows
      .map((d) => ({ ...d, _sched: parseScheduledAt(d.scheduledAt) }))
      .filter((d) => d._sched && d._sched >= now - 60 * 60 * 1000)
      .sort((a, b) => a._sched - b._sched)
    return withSchedule[0] || null
  } catch (e) {
    return null
  }
}

/** 最近一场已结束：回放骨架用封面占位 */
async function findRecentEnded() {
  try {
    const res = await db.collection(COLLECTION)
      .where({ status: STATUS_ENDED })
      .orderBy('endTime', 'desc')
      .limit(1)
      .get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    try {
      const res = await db.collection(COLLECTION).where({ status: STATUS_ENDED }).limit(30).get()
      const rows = (res.data || []).slice()
      rows.sort((a, b) => {
        const ta = a.endTime ? new Date(a.endTime).getTime() : 0
        const tb = b.endTime ? new Date(b.endTime).getTime() : 0
        return tb - ta
      })
      return rows[0] || null
    } catch (err) {
      return null
    }
  }
}

function publicReplayStub(doc) {
  if (!doc) return null
  return {
    _id: doc._id || '',
    title: doc.title || '馆内直播',
    coverUrl: normalizeCoverUrl(doc.coverUrl),
    hostName: doc.hostName || '',
    endTime: doc.endTime || null,
    likeCount: Math.max(0, Number(doc.likeCount) || 0),
    replayReady: false,
    replayHint: '回放筹备中，本场封面可供回顾'
  }
}

async function findHostLastEnded(openid) {
  if (!openid) return null
  try {
    const res = await db.collection(COLLECTION)
      .where({ hostOpenid: openid, status: STATUS_ENDED })
      .orderBy('endTime', 'desc')
      .limit(1)
      .get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    try {
      const res = await db.collection(COLLECTION).where({ hostOpenid: openid }).limit(40).get()
      const rows = (res.data || []).filter((d) => d && d.status === STATUS_ENDED)
      rows.sort((a, b) => {
        const ta = a.endTime ? new Date(a.endTime).getTime() : 0
        const tb = b.endTime ? new Date(b.endTime).getTime() : 0
        return tb - ta
      })
      return rows[0] || null
    } catch (err) {
      return null
    }
  }
}

async function findHostOpenSession(openid) {
  try {
    const res = await db.collection(COLLECTION)
      .where({
        hostOpenid: openid,
        status: _.in([STATUS_IDLE, STATUS_LIVE])
      })
      .orderBy('createTime', 'desc')
      .limit(1)
      .get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    const res = await db.collection(COLLECTION).where({ hostOpenid: openid }).limit(30).get()
    const rows = (res.data || []).filter((d) => d.status === STATUS_IDLE || d.status === STATUS_LIVE)
    rows.sort((a, b) => {
      const ta = a.createTime ? new Date(a.createTime).getTime() : 0
      const tb = b.createTime ? new Date(b.createTime).getTime() : 0
      return tb - ta
    })
    return rows[0] || null
  }
}

async function assertHost(event, openid) {
  return assertStaff(db, openid, {
    role: ROLE_STAFF,
    permission: PERMISSION,
    adminOpsKey: event && event.adminOpsKey
  })
}

async function getActive(openid) {
  const enabled = await isLiveFeatureEnabled()
  const configured = isConfigured(readConfig())
  const remindSubscribe = remindSubscribeMeta()
  if (!enabled) {
    return {
      success: true,
      enabled: false,
      configured,
      session: null,
      upcoming: null,
      endedReplay: null,
      reminded: false,
      remindSubscribe,
      msg: '直播入口已关闭',
      emptyCode: 'FLAG_OFF'
    }
  }
  try {
    const doc = await findPlayableActiveLive()
    const playable = doc && doc.pullUrl ? doc : null
    const session = playable ? await enrichSession(playable, { enabled: true, withShelf: true }) : null
    if (session && Object.prototype.hasOwnProperty.call(session, 'pushUrl')) {
      delete session.pushUrl
    }
    let upcoming = null
    let reminded = false
    let endedReplay = null
    if (!session) {
      const up = await findUpcomingIdle()
      upcoming = up ? await enrichSession(up, { enabled: true, withShelf: false }) : null
      if (upcoming) {
        upcoming.pullUrl = ''
        upcoming.pullUrlRtmp = ''
        if (openid) reminded = await hasReminder(upcoming._id, openid)
      } else {
        endedReplay = publicReplayStub(await findRecentEnded())
      }
    }
    return {
      success: true,
      enabled: true,
      configured,
      session,
      upcoming,
      endedReplay,
      reminded,
      remindSubscribe,
      msg: !configured
        ? '推拉流域名尚未配置，暂时无法出画'
        : (session ? '' : (upcoming ? '已有预约场次' : '此刻没有进行中的直播')),
      emptyCode: session ? '' : (configured ? (upcoming ? 'SCHEDULED' : 'OFF_AIR') : 'NOT_CONFIGURED')
    }
  } catch (e) {
    if (/collection|集合/.test(e.message || '')) {
      return {
        success: true,
        enabled: true,
        configured,
        session: null,
        upcoming: null,
        endedReplay: null,
        reminded: false,
        remindSubscribe,
        msg: `请先创建集合 ${COLLECTION}`,
        emptyCode: 'NO_COLLECTION'
      }
    }
    throw e
  }
}

/** 分享卡片带 sessionId 进房 */
async function getSession(event, openid) {
  const enabled = await isLiveFeatureEnabled()
  const configured = isConfigured(readConfig())
  const sessionId = String((event && event.sessionId) || '').trim()
  if (!enabled) {
    return {
      success: true,
      enabled: false,
      configured,
      session: null,
      msg: '直播入口已关闭',
      emptyCode: 'FLAG_OFF'
    }
  }
  if (!sessionId) {
    return getActive(openid)
  }
  try {
    const got = await db.collection(COLLECTION).doc(sessionId).get()
    const doc = got.data || null
    if (!doc) {
      return {
        success: true,
        enabled: true,
        configured,
        session: null,
        msg: '场次不存在或已失效',
        emptyCode: 'OFF_AIR'
      }
    }
    const remindSubscribe = remindSubscribeMeta()
    if (doc.status === STATUS_ENDED) {
      return {
        success: true,
        enabled: true,
        configured,
        session: null,
        ended: true,
        endedReplay: publicReplayStub(doc),
        remindSubscribe,
        msg: '本场已结束',
        emptyCode: 'ENDED'
      }
    }
    if (doc.status === STATUS_LIVE && doc.pullUrl && !isStaleLive(doc, configured)) {
      const session = await enrichSession(doc, { enabled: true, withShelf: true })
      delete session.pushUrl
      return {
        success: true,
        enabled: true,
        configured,
        session,
        remindSubscribe,
        msg: ''
      }
    }
    // 分享进到未开播/预约场：展示预约信息，不给拉流
    const session = await enrichSession(doc, { enabled: true, withShelf: false })
    session.pullUrl = ''
    session.pullUrlRtmp = ''
    const reminded = openid ? await hasReminder(session._id, openid) : false
    return {
      success: true,
      enabled: true,
      configured,
      session: null,
      upcoming: session,
      reminded,
      remindSubscribe,
      msg: session.scheduledLabel ? `预约开播 ${session.scheduledLabel}` : '本场尚未开播',
      emptyCode: session.scheduledLabel ? 'SCHEDULED' : 'OFF_AIR'
    }
  } catch (e) {
    return {
      success: true,
      enabled: true,
      configured,
      session: null,
      msg: '场次加载失败',
      emptyCode: 'ERROR'
    }
  }
}

async function create(event, openid, actor) {
  const title = String((event && event.title) || '').trim() || '山海造物 · 馆内直播'
  const notice = normalizeNotice(event && event.notice)
  const coverUrl = normalizeCoverUrl(event && event.coverUrl)
  const scheduledAt = parseScheduledAt(event && event.scheduledAt)
  const existingLive = await findPlayableActiveLive()
  if (existingLive) {
    return {
      success: false,
      code: 'LIVE_BUSY',
      msg: busyMessage(existingLive),
      session: publicSession(existingLive)
    }
  }
  const open = await findHostOpenSession(openid)
  if (open) {
    if (isStaleLive(open, isConfigured(readConfig()))) {
      await markEndedStale(open)
    } else {
      return {
        success: true,
        reused: true,
        session: await enrichSession(open, { asHost: true, enabled: true, withShelf: true }),
        configured: open.configured !== false && isConfigured(readConfig())
      }
    }
  }

  const streamName = makeStreamName()
  const urls = buildStreamUrls(streamName)
  const payload = {
    title,
    notice,
    coverUrl,
    scheduledAt,
    status: STATUS_IDLE,
    streamName,
    pullUrl: urls.pullUrl || '',
    pullUrlRtmp: urls.pullUrlRtmp || '',
    pushUrl: urls.pushUrl || '',
    configured: urls.configured,
    hostOpenid: openid,
    hostName: (actor && actor.name) || '',
    likeCount: 0,
    presence: {},
    shelfProductIds: [],
    spotlightProductId: '',
    shelfUpdatedAt: 0,
    createTime: db.serverDate(),
    updateTime: db.serverDate(),
    startTime: null,
    endTime: null
  }

  try {
    const added = await db.collection(COLLECTION).add({ data: payload })
    return {
      success: true,
      session: await enrichSession({ ...payload, _id: added._id }, { asHost: true, enabled: true, withShelf: true }),
      configured: urls.configured,
      msg: urls.configured ? '' : urls.msg || '推流域名未配置，可先走通流程'
    }
  } catch (e) {
    if (/collection|集合/.test(e.message || '')) {
      return { success: false, msg: `请先在云开发控制台创建集合 ${COLLECTION}` }
    }
    throw e
  }
}

async function refreshUrlsIfNeeded(doc) {
  if (!doc || !doc.streamName) return doc
  const urls = buildStreamUrls(doc.streamName)
  if (!urls.configured) {
    return { ...doc, configured: false, pushUrl: '', pullUrl: '', pullUrlRtmp: '' }
  }
  await db.collection(COLLECTION).doc(doc._id).update({
    data: {
      pushUrl: urls.pushUrl,
      pullUrl: urls.pullUrl,
      pullUrlRtmp: urls.pullUrlRtmp,
      configured: true,
      updateTime: db.serverDate()
    }
  })
  return {
    ...doc,
    pushUrl: urls.pushUrl,
    pullUrl: urls.pullUrl,
    pullUrlRtmp: urls.pullUrlRtmp,
    configured: true
  }
}

async function start(event, openid, actor) {
  let doc = null
  const sessionId = String((event && event.sessionId) || '').trim()
  if (sessionId) {
    const got = await db.collection(COLLECTION).doc(sessionId).get()
    doc = got.data || null
  } else {
    doc = await findHostOpenSession(openid)
  }

  if (!doc) {
    const created = await create(event, openid, actor)
    if (!created.success) return created
    doc = {
      _id: created.session._id,
      ...created.session,
      pushUrl: created.session.pushUrl
    }
  }

  if (doc.hostOpenid && doc.hostOpenid !== openid && !(actor && actor.superAdmin)) {
    return { success: false, code: 'NOT_HOST', msg: '仅本场主播或超管可开播' }
  }

  const other = await findPlayableActiveLive()
  if (other && other._id !== doc._id) {
    return {
      success: false,
      code: 'LIVE_BUSY',
      msg: busyMessage(other),
      session: publicSession(other)
    }
  }

  const notice = event && Object.prototype.hasOwnProperty.call(event, 'notice')
    ? normalizeNotice(event.notice)
    : normalizeNotice(doc.notice)
  const title = String((event && event.title) || doc.title || '').trim() || '山海造物 · 馆内直播'
  const coverUrl = event && Object.prototype.hasOwnProperty.call(event, 'coverUrl')
    ? normalizeCoverUrl(event.coverUrl)
    : normalizeCoverUrl(doc.coverUrl)
  const scheduledAt = event && Object.prototype.hasOwnProperty.call(event, 'scheduledAt')
    ? parseScheduledAt(event.scheduledAt)
    : parseScheduledAt(doc.scheduledAt)

  doc = await refreshUrlsIfNeeded(doc)

  const configured = isConfigured(readConfig())
  if (!configured || !doc.pushUrl) {
    return {
      success: false,
      code: 'NOT_CONFIGURED',
      configured: false,
      session: hostSession({ ...doc, title, notice, coverUrl, scheduledAt, pushUrl: '' }),
      msg: '暂未配置推流：请在云函数 manageLiveSession 填写 LIVE_PUSH_DOMAIN / LIVE_PLAY_DOMAIN / LIVE_AUTH_KEY（详见 docs/live-streaming.md）'
    }
  }

  await db.collection(COLLECTION).doc(doc._id).update({
    data: {
      title,
      notice,
      coverUrl,
      scheduledAt,
      noticeUpdatedAt: Date.now(),
      status: STATUS_LIVE,
      startTime: doc.startTime || db.serverDate(),
      endTime: null,
      updateTime: db.serverDate(),
      hostOpenid: doc.hostOpenid || openid,
      hostName: doc.hostName || (actor && actor.name) || '',
      pushUrl: doc.pushUrl,
      pullUrl: doc.pullUrl,
      pullUrlRtmp: doc.pullUrlRtmp,
      configured: true,
      likeCount: Math.max(0, Number(doc.likeCount) || 0),
      presence: doc.presence && typeof doc.presence === 'object' ? doc.presence : {}
    }
  })

  const latest = (await db.collection(COLLECTION).doc(doc._id).get()).data || doc
  // 开播后尽力触达「提醒我」登记用户（有 LIVE_REMIND_TMPL_ID 才发订阅消息）
  let remindNotify = { attempted: 0, sent: 0 }
  try {
    remindNotify = await notifyReminders(latest)
  } catch (e) {
    console.warn('notifyReminders', e && e.message)
  }
  return {
    success: true,
    session: await enrichSession({ ...latest, pushUrl: doc.pushUrl || latest.pushUrl }, {
      asHost: true,
      enabled: true,
      withShelf: true
    }),
    configured: true,
    remindNotify,
    msg: ''
  }
}

async function end(event, openid, actor) {
  const sessionId = String((event && event.sessionId) || '').trim()
  let doc = null
  if (sessionId) {
    const got = await db.collection(COLLECTION).doc(sessionId).get()
    doc = got.data || null
  } else {
    doc = (await findHostOpenSession(openid)) || (await findPlayableActiveLive()) || (await findActiveLive())
  }
  if (!doc) {
    return { success: false, msg: '没有可结束的直播场次' }
  }
  if (doc.hostOpenid && doc.hostOpenid !== openid && !(actor && actor.superAdmin)) {
    return { success: false, code: 'NOT_HOST', msg: '仅本场主播或超管可结束' }
  }
  const endedToken = `end_${Date.now().toString(36)}`
  await db.collection(COLLECTION).doc(doc._id).update({
    data: {
      status: STATUS_ENDED,
      endTime: db.serverDate(),
      updateTime: db.serverDate(),
      pushUrl: '',
      presence: {},
      endedToken
    }
  })
  return {
    success: true,
    session: publicSession({ ...doc, status: STATUS_ENDED, pushUrl: '', presence: {}, endedToken })
  }
}

async function getHostSession(openid) {
  const configured = isConfigured(readConfig())
  let doc = await findHostOpenSession(openid)
  if (doc && isStaleLive(doc, configured)) {
    await markEndedStale(doc)
    doc = null
  }
  const active = await findPlayableActiveLive()
  if (!doc) {
    return {
      success: true,
      session: null,
      active: active ? await enrichSession(active, { enabled: true, withShelf: true }) : null,
      configured
    }
  }
  const refreshed = await refreshUrlsIfNeeded(doc)
  return {
    success: true,
    session: await enrichSession(refreshed, { asHost: true, enabled: true, withShelf: true }),
    active: active ? await enrichSession(active, { enabled: true, withShelf: true }) : null,
    configured: refreshed.configured !== false && configured
  }
}

async function updateNotice(event, openid, actor) {
  const sessionId = String((event && event.sessionId) || '').trim()
  let doc = null
  if (sessionId) {
    const got = await db.collection(COLLECTION).doc(sessionId).get()
    doc = got.data || null
  } else {
    doc = await findHostOpenSession(openid)
  }
  if (!doc) {
    return { success: false, msg: '没有可编辑的场次' }
  }
  if (doc.hostOpenid && doc.hostOpenid !== openid && !(actor && actor.superAdmin)) {
    return { success: false, code: 'NOT_HOST', msg: '仅本场主播或超管可改公告' }
  }
  if (doc.status !== STATUS_LIVE && doc.status !== STATUS_IDLE) {
    return { success: false, msg: '场次已结束，无法改公告' }
  }
  const notice = normalizeNotice(event && event.notice)
  await db.collection(COLLECTION).doc(doc._id).update({
    data: {
      notice,
      noticeUpdatedAt: Date.now(),
      updateTime: db.serverDate()
    }
  })
  return {
    success: true,
    session: publicSession({ ...doc, notice, noticeUpdatedAt: Date.now() })
  }
}

async function updateMeta(event, openid, actor) {
  const sessionId = String((event && event.sessionId) || '').trim()
  let doc = null
  if (sessionId) {
    const got = await db.collection(COLLECTION).doc(sessionId).get()
    doc = got.data || null
  } else {
    doc = await findHostOpenSession(openid)
  }
  if (!doc) {
    return { success: false, msg: '没有可编辑的场次，请先创建或开播' }
  }
  if (doc.hostOpenid && doc.hostOpenid !== openid && !(actor && actor.superAdmin)) {
    return { success: false, code: 'NOT_HOST', msg: '仅本场主播或超管可改封面/预约' }
  }
  if (doc.status !== STATUS_LIVE && doc.status !== STATUS_IDLE) {
    return { success: false, msg: '场次已结束，无法修改' }
  }
  const patch = { updateTime: db.serverDate() }
  if (event && Object.prototype.hasOwnProperty.call(event, 'coverUrl')) {
    patch.coverUrl = normalizeCoverUrl(event.coverUrl)
  }
  if (event && Object.prototype.hasOwnProperty.call(event, 'scheduledAt')) {
    patch.scheduledAt = parseScheduledAt(event.scheduledAt)
  }
  if (event && Object.prototype.hasOwnProperty.call(event, 'title')) {
    const title = String(event.title || '').trim()
    if (title) patch.title = title.slice(0, 40)
  }
  await db.collection(COLLECTION).doc(doc._id).update({ data: patch })
  const latest = (await db.collection(COLLECTION).doc(doc._id).get()).data || { ...doc, ...patch }
  return { success: true, session: await enrichSession(latest, { asHost: true, enabled: true, withShelf: true }) }
}

async function resolveEditableSession(event, openid) {
  const sessionId = String((event && event.sessionId) || '').trim()
  if (sessionId) {
    const got = await db.collection(COLLECTION).doc(sessionId).get()
    return got.data || null
  }
  return findHostOpenSession(openid)
}

/**
 * 挂车：add / remove / productIds(全量替换) / spotlightProductId
 */
async function updateShelf(event, openid, actor) {
  const doc = await resolveEditableSession(event, openid)
  if (!doc) {
    return { success: false, msg: '没有可编辑的场次，请先开播或创建场次' }
  }
  if (doc.hostOpenid && doc.hostOpenid !== openid && !(actor && actor.superAdmin)) {
    return { success: false, code: 'NOT_HOST', msg: '仅本场主播或超管可改挂车' }
  }
  if (doc.status !== STATUS_LIVE && doc.status !== STATUS_IDLE) {
    return { success: false, msg: '场次已结束，无法改挂车' }
  }

  let ids = normalizeProductIds(doc.shelfProductIds)
  if (event && Object.prototype.hasOwnProperty.call(event, 'productIds')) {
    ids = normalizeProductIds(event.productIds)
  } else if (event && event.move && (event.move.productId || event.move.id)) {
    ids = moveProductId(ids, event.move.productId || event.move.id, event.move.dir)
  } else if (event && event.clear === true) {
    ids = []
  } else {
    if (event && event.add) {
      ids = normalizeProductIds(ids.concat(normalizeProductIds(event.add)))
    }
    if (event && event.remove) {
      const rem = new Set(normalizeProductIds(event.remove))
      ids = ids.filter((id) => !rem.has(id))
    }
  }
  if (ids.length > SHELF_MAX) {
    return { success: false, code: 'SHELF_FULL', msg: `挂车最多 ${SHELF_MAX} 件` }
  }

  // 校验商品存在（忽略无效 id）
  const validIds = []
  if (ids.length) {
    try {
      const res = await db.collection('products').where({ _id: _.in(ids) }).limit(SHELF_MAX).get()
      const found = new Set((res.data || []).map((p) => p && p._id).filter(Boolean))
      ids.forEach((id) => {
        if (found.has(id)) validIds.push(id)
      })
    } catch (e) {
      validIds.push(...ids)
    }
  }

  let spotlight = String(
    (event && Object.prototype.hasOwnProperty.call(event, 'spotlightProductId')
      ? event.spotlightProductId
      : doc.spotlightProductId) || ''
  ).trim()
  if (spotlight && !validIds.includes(spotlight)) spotlight = ''

  const shelfUpdatedAt = Date.now()
  let auditAction = 'add'
  if (event && Object.prototype.hasOwnProperty.call(event, 'productIds')) auditAction = 'replace'
  else if (event && event.clear === true) auditAction = 'clear'
  else if (event && event.move) auditAction = 'move'
  else if (event && event.remove && !(event && event.add)) auditAction = 'remove'
  const audit = shelfAuditEntry(
    { key: presenceKey(openid), name: (actor && actor.name) || '' },
    auditAction,
    { productIds: validIds, spotlightProductId: spotlight }
  )
  await db.collection(COLLECTION).doc(doc._id).update({
    data: {
      shelfProductIds: validIds,
      spotlightProductId: spotlight,
      shelfUpdatedAt,
      updateTime: db.serverDate(),
      shelfAudit: _.push({
        each: [audit],
        slice: -AUDIT_MAX
      })
    }
  })
  const latest = (await db.collection(COLLECTION).doc(doc._id).get()).data || {
    ...doc,
    shelfProductIds: validIds,
    spotlightProductId: spotlight,
    shelfUpdatedAt
  }
  const enabled = await isLiveFeatureEnabled()
  return {
    success: true,
    session: await enrichSession(latest, { asHost: true, enabled, withShelf: true }),
    msg: validIds.length < ids.length ? '部分商品无效已跳过' : ''
  }
}

async function setSpotlight(event, openid, actor) {
  const doc = await resolveEditableSession(event, openid)
  if (!doc) {
    return { success: false, msg: '没有可编辑的场次' }
  }
  if (doc.hostOpenid && doc.hostOpenid !== openid && !(actor && actor.superAdmin)) {
    return { success: false, code: 'NOT_HOST', msg: '仅本场主播或超管可设置讲解中' }
  }
  if (doc.status !== STATUS_LIVE && doc.status !== STATUS_IDLE) {
    return { success: false, msg: '场次已结束' }
  }
  const ids = normalizeProductIds(doc.shelfProductIds)
  let spotlight = String((event && event.productId) || (event && event.spotlightProductId) || '').trim()
  if (spotlight && !ids.includes(spotlight)) {
    return { success: false, msg: '请先将该商品加入挂车' }
  }
  // 传空或 clear:true 取消高亮
  if (event && event.clear) spotlight = ''
  const shelfUpdatedAt = Date.now()
  const audit = shelfAuditEntry(
    { key: presenceKey(openid), name: (actor && actor.name) || '' },
    spotlight ? 'spotlight' : 'spotlight_clear',
    { productIds: spotlight ? [spotlight] : [], spotlightProductId: spotlight }
  )
  await db.collection(COLLECTION).doc(doc._id).update({
    data: {
      spotlightProductId: spotlight,
      shelfUpdatedAt,
      updateTime: db.serverDate(),
      shelfAudit: _.push({
        each: [audit],
        slice: -AUDIT_MAX
      })
    }
  })
  const latest = (await db.collection(COLLECTION).doc(doc._id).get()).data || {
    ...doc,
    spotlightProductId: spotlight,
    shelfUpdatedAt
  }
  const enabled = await isLiveFeatureEnabled()
  return {
    success: true,
    session: await enrichSession(latest, { asHost: true, enabled, withShelf: true })
  }
}

async function likeSession(openid) {
  if (!openid) {
    return { success: false, code: 'NO_LOGIN', msg: '请先登录' }
  }
  const enabled = await isLiveFeatureEnabled()
  if (!enabled) {
    return { success: false, code: 'FLAG_OFF', msg: '直播入口已关闭' }
  }
  const doc = await findPlayableActiveLive()
  if (!doc || !doc.pullUrl) {
    return { success: false, code: 'OFF_AIR', msg: '没有进行中的直播' }
  }
  const key = presenceKey(openid)
  const likedMap = (doc.likeKeys && typeof doc.likeKeys === 'object') ? doc.likeKeys : {}
  if (likedMap[key]) {
    return {
      success: false,
      code: 'LIKED',
      msg: '本场已点过赞',
      likeCount: Math.max(0, Number(doc.likeCount) || 0),
      viewerCount: countPresence(doc.presence),
      sessionId: doc._id
    }
  }
  try {
    await db.collection(COLLECTION).doc(doc._id).update({
      data: {
        likeCount: _.inc(1),
        [`likeKeys.${key}`]: 1,
        updateTime: db.serverDate()
      }
    })
  } catch (e) {
    await db.collection(COLLECTION).doc(doc._id).update({
      data: {
        likeCount: Math.max(1, (Number(doc.likeCount) || 0) + 1),
        likeKeys: { ...likedMap, [key]: 1 },
        updateTime: db.serverDate()
      }
    })
  }
  const latest = (await db.collection(COLLECTION).doc(doc._id).get()).data || doc
  return {
    success: true,
    likeCount: Math.max(0, Number(latest.likeCount) || 0),
    viewerCount: countPresence(latest.presence),
    stats: buildStats(latest),
    sessionId: doc._id
  }
}

async function heartbeat(event, openid) {
  if (!openid) {
    return { success: false, code: 'NO_LOGIN', msg: '请先登录' }
  }
  const enabled = await isLiveFeatureEnabled()
  if (!enabled) {
    return { success: false, code: 'FLAG_OFF', msg: '直播入口已关闭', viewerCount: 0 }
  }
  let doc = null
  const sessionId = String((event && event.sessionId) || '').trim()
  if (sessionId) {
    try {
      const got = await db.collection(COLLECTION).doc(sessionId).get()
      doc = got.data || null
    } catch (e) {
      doc = null
    }
  }
  if (!doc || doc.status !== STATUS_LIVE || !doc.pullUrl) {
    doc = await findPlayableActiveLive()
  }
  if (!doc || !doc.pullUrl) {
    return { success: false, code: 'OFF_AIR', msg: '没有进行中的直播', viewerCount: 0 }
  }
  const key = presenceKey(openid)
  const now = Date.now()
  const prev = Number((doc.presence && doc.presence[key]) || 0)
  if (prev && now - prev < HB_MIN_MS) {
    return {
      success: true,
      sessionId: doc._id,
      viewerCount: countPresence(doc.presence),
      likeCount: Math.max(0, Number(doc.likeCount) || 0),
      stats: buildStats(doc),
      throttled: true
    }
  }
  const isNewJoin = !prev || now - prev > PRESENCE_TTL_MS
  const nextPresence = { ...(doc.presence && typeof doc.presence === 'object' ? doc.presence : {}), [key]: now }
  const viewerCount = countPresence(nextPresence)
  const peak = Math.max(Number(doc.statsPeakViewers) || 0, viewerCount)
  const patch = {
    [`presence.${key}`]: now,
    statsPeakViewers: peak
  }
  if (isNewJoin) patch.statsJoinCount = _.inc(1)
  try {
    await db.collection(COLLECTION).doc(doc._id).update({ data: patch })
  } catch (e) {
    await db.collection(COLLECTION).doc(doc._id).update({
      data: {
        presence: nextPresence,
        statsPeakViewers: peak,
        statsJoinCount: Math.max(0, Number(doc.statsJoinCount) || 0) + (isNewJoin ? 1 : 0)
      }
    })
  }
  const latest = (await db.collection(COLLECTION).doc(doc._id).get()).data || doc
  return {
    success: true,
    sessionId: doc._id,
    viewerCount: countPresence(latest.presence),
    likeCount: Math.max(0, Number(latest.likeCount) || 0),
    stats: buildStats(latest)
  }
}

async function postMessage(event, openid) {
  if (!openid) {
    return { success: false, code: 'NO_LOGIN', msg: '请先登录' }
  }
  const enabled = await isLiveFeatureEnabled()
  if (!enabled) {
    return { success: false, code: 'FLAG_OFF', msg: '直播入口已关闭' }
  }
  const text = normalizeMessage(event && event.text)
  if (!text) {
    return { success: false, code: 'EMPTY', msg: '请输入留言' }
  }
  if (isBlockedText(text)) {
    return { success: false, code: 'BLOCKED', msg: '留言含不当内容，请修改后再发' }
  }

  let doc = null
  const sessionId = String((event && event.sessionId) || '').trim()
  if (sessionId) {
    try {
      const got = await db.collection(COLLECTION).doc(sessionId).get()
      doc = got.data || null
    } catch (e) {
      doc = null
    }
  }
  if (!doc || doc.status !== STATUS_LIVE) {
    doc = await findPlayableActiveLive()
  }
  if (!doc || doc.status !== STATUS_LIVE || !doc.pullUrl) {
    return { success: false, code: 'OFF_AIR', msg: '没有进行中的直播' }
  }

  const since = Date.now() - MSG_RATE_MS
  try {
    const recent = await db.collection(MSG_COLLECTION)
      .where({
        sessionId: doc._id,
        openid,
        ts: _.gt(since)
      })
      .limit(1)
      .get()
    if (recent.data && recent.data.length) {
      return { success: false, code: 'RATE', msg: '发送太快，请稍候再试' }
    }
  } catch (e) {
    // 集合未建或无索引时放宽限频，仍写入
  }

  try {
    const countRes = await db.collection(MSG_COLLECTION)
      .where({ sessionId: doc._id, openid })
      .count()
    const total = (countRes && countRes.total) || 0
    if (total >= MSG_USER_MAX_PER_SESSION) {
      return { success: false, code: 'MSG_CAP', msg: '本场留言已达上限' }
    }
  } catch (e) { /* ignore */ }

  const row = {
    sessionId: doc._id,
    openid,
    author: maskAuthor(openid),
    text,
    ts: Date.now(),
    createTime: db.serverDate(),
    status: 'visible'
  }
  try {
    const added = await db.collection(MSG_COLLECTION).add({ data: row })
    try {
      await db.collection(COLLECTION).doc(doc._id).update({
        data: { statsMessageCount: _.inc(1) }
      })
    } catch (e) { /* ignore stats */ }
    return {
      success: true,
      message: publicMessage({ ...row, _id: added._id })
    }
  } catch (e) {
    if (/collection|集合/.test(e.message || '')) {
      return { success: false, msg: `请先创建集合 ${MSG_COLLECTION}（建议权限 PRIVATE）` }
    }
    throw e
  }
}

async function listMessages(event) {
  const enabled = await isLiveFeatureEnabled()
  if (!enabled) {
    return { success: true, enabled: false, list: [], msg: '直播入口已关闭' }
  }
  let sessionId = String((event && event.sessionId) || '').trim()
  if (!sessionId) {
    const active = await findPlayableActiveLive()
    sessionId = (active && active._id) || ''
  }
  if (!sessionId) {
    return { success: true, list: [] }
  }
  try {
    const res = await db.collection(MSG_COLLECTION)
      .where({ sessionId, status: 'visible' })
      .orderBy('ts', 'desc')
      .limit(MSG_LIST_LIMIT)
      .get()
    const list = (res.data || []).map(publicMessage).filter(Boolean).reverse()
    return { success: true, list, sessionId }
  } catch (e) {
    try {
      const res = await db.collection(MSG_COLLECTION).where({ sessionId }).limit(80).get()
      const rows = (res.data || [])
        .filter((r) => r.status !== 'hidden')
        .sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0))
        .slice(-MSG_LIST_LIMIT)
      return { success: true, list: rows.map(publicMessage).filter(Boolean), sessionId }
    } catch (err) {
      if (/collection|集合/.test(err.message || '')) {
        return { success: true, list: [], msg: `请先创建集合 ${MSG_COLLECTION}` }
      }
      return { success: true, list: [] }
    }
  }
}

/**
 * 强制结束当前进行中场次（本场或全场 active）
 */
async function forceEnd(event, openid, actor) {
  const sessionId = String((event && event.sessionId) || '').trim()
  let doc = null
  if (sessionId) {
    const got = await db.collection(COLLECTION).doc(sessionId).get()
    doc = got.data || null
  } else {
    doc = (await findHostOpenSession(openid)) || (await findActiveLive())
  }
  if (!doc) {
    return { success: true, alreadyEnded: true, msg: '没有需要结束的场次', session: null }
  }
  if (doc.status === STATUS_ENDED) {
    return { success: true, alreadyEnded: true, session: publicSession(doc) }
  }
  if (doc.hostOpenid && doc.hostOpenid !== openid && !(actor && actor.superAdmin)) {
    return { success: false, code: 'NOT_HOST', msg: '仅本场主播或超管可强制结束' }
  }
  const endedToken = `end_${Date.now().toString(36)}`
  await db.collection(COLLECTION).doc(doc._id).update({
    data: {
      status: STATUS_ENDED,
      endTime: db.serverDate(),
      updateTime: db.serverDate(),
      pushUrl: '',
      presence: {},
      endedToken
    }
  })
  return {
    success: true,
    session: publicSession({ ...doc, status: STATUS_ENDED, pushUrl: '', presence: {}, endedToken })
  }
}

async function listRecent() {
  try {
    const res = await db.collection(COLLECTION)
      .orderBy('createTime', 'desc')
      .limit(20)
      .get()
    return { success: true, list: (res.data || []).map(publicSession) }
  } catch (e) {
    const res = await db.collection(COLLECTION).limit(40).get()
    const rows = (res.data || []).slice()
    rows.sort((a, b) => {
      const ta = a.createTime ? new Date(a.createTime).getTime() : 0
      const tb = b.createTime ? new Date(b.createTime).getTime() : 0
      return tb - ta
    })
    return { success: true, list: rows.slice(0, 20).map(publicSession) }
  }
}

async function hasReminder(sessionId, openid) {
  if (!sessionId || !openid) return false
  try {
    const res = await db.collection(REMIND_COLLECTION)
      .where({ sessionId, openid, status: 'pending' })
      .limit(1)
      .get()
    return !!(res.data && res.data.length)
  } catch (e) {
    return false
  }
}

/** C 端：预约场次「提醒我」登记（模板未审也可先落库） */
async function registerReminder(event, openid) {
  if (!openid) return { success: false, code: 'NO_LOGIN', msg: '请先登录' }
  const enabled = await isLiveFeatureEnabled()
  if (!enabled) return { success: false, code: 'FLAG_OFF', msg: '直播入口已关闭' }
  let sessionId = String((event && event.sessionId) || '').trim()
  let doc = null
  if (sessionId) {
    try {
      doc = (await db.collection(COLLECTION).doc(sessionId).get()).data || null
    } catch (e) {
      doc = null
    }
  }
  if (!doc) {
    doc = await findUpcomingIdle()
    sessionId = (doc && doc._id) || ''
  }
  if (!doc || !sessionId) {
    return { success: false, msg: '暂无可预约的场次' }
  }
  if (doc.status === STATUS_LIVE) {
    return { success: false, code: 'ALREADY_LIVE', msg: '本场已开播，请直接进入直播间' }
  }
  if (doc.status === STATUS_ENDED) {
    return { success: false, msg: '场次已结束' }
  }
  if (await hasReminder(sessionId, openid)) {
    return { success: true, already: true, reminded: true, sessionId }
  }
  try {
    await db.collection(REMIND_COLLECTION).add({
      data: {
        sessionId,
        openid,
        title: doc.title || '馆内直播',
        scheduledAt: parseScheduledAt(doc.scheduledAt),
        status: 'pending',
        subscribeAccepted: !!(event && event.subscribeAccepted),
        createTime: db.serverDate()
      }
    })
    try {
      await db.collection(COLLECTION).doc(sessionId).update({
        data: { statsReminderCount: _.inc(1) }
      })
    } catch (e) { /* ignore */ }
    return { success: true, reminded: true, sessionId }
  } catch (e) {
    if (/collection|集合/.test(e.message || '')) {
      return { success: false, msg: `请先创建集合 ${REMIND_COLLECTION}` }
    }
    throw e
  }
}

async function cancelReminder(event, openid) {
  if (!openid) return { success: false, code: 'NO_LOGIN', msg: '请先登录' }
  const sessionId = String((event && event.sessionId) || '').trim()
  if (!sessionId) return { success: false, msg: '缺少场次' }
  try {
    const res = await db.collection(REMIND_COLLECTION)
      .where({ sessionId, openid, status: 'pending' })
      .limit(20)
      .get()
    const rows = res.data || []
    await Promise.all(rows.map((r) => db.collection(REMIND_COLLECTION).doc(r._id).update({
      data: { status: 'cancelled', updateTime: db.serverDate() }
    })))
    return { success: true, reminded: false, cancelled: rows.length }
  } catch (e) {
    return { success: false, msg: '取消失败' }
  }
}

/**
 * 开播时触达提醒登记用户。
 * 若配置 LIVE_REMIND_TMPL_ID 则尝试订阅消息；否则仅标记 notified（站内可后续扩展）。
 */
async function notifyReminders(session) {
  if (!session || !session._id) return { attempted: 0, sent: 0 }
  const tmplId = remindTemplateId()
  let rows = []
  try {
    const res = await db.collection(REMIND_COLLECTION)
      .where({ sessionId: session._id, status: 'pending' })
      .limit(100)
      .get()
    rows = res.data || []
  } catch (e) {
    return { attempted: 0, sent: 0, msg: 'no_remind_collection' }
  }
  let sent = 0
  for (const row of rows) {
    let ok = false
    if (tmplId && row.openid) {
      try {
        const timeLabel = formatScheduledLabel(parseScheduledAt(session.scheduledAt) || Date.now()) || '即将开始'
        await cloud.openapi.subscribeMessage.send({
          touser: row.openid,
          templateId: tmplId,
          page: `/subpackages/feature/live/watch/index?sessionId=${encodeURIComponent(session._id)}`,
          data: {
            thing1: { value: String(session.title || '馆内直播').slice(0, 20) },
            time2: { value: String(timeLabel).slice(0, 20) },
            thing3: { value: '馆内直播已开始，点击进入' }
          }
        })
        ok = true
        sent += 1
      } catch (e) {
        console.warn('live remind send', e && e.message)
      }
    }
    try {
      await db.collection(REMIND_COLLECTION).doc(row._id).update({
        data: {
          status: 'notified',
          notifiedAt: db.serverDate(),
          subscribeSent: ok
        }
      })
    } catch (e) { /* ignore */ }
  }
  return { attempted: rows.length, sent, hasTemplate: !!tmplId }
}

async function getDashboard(openid) {
  const configured = isConfigured(readConfig())
  const enabled = await isLiveFeatureEnabled()
  let mine = await findHostOpenSession(openid)
  let clearedStale = false
  if (mine && isStaleLive(mine, configured)) {
    await markEndedStale(mine)
    mine = null
    clearedStale = true
  }
  const active = await findPlayableActiveLive()
  const recent = await listRecent()
  let lastEnded = null
  if (!mine) {
    lastEnded = await findHostLastEnded(openid)
  }
  const tips = []
  if (!configured) tips.push('暂未配置推流：请填写 LIVE_PUSH_DOMAIN / LIVE_PLAY_DOMAIN / LIVE_AUTH_KEY')
  if (!enabled) tips.push('内容开关「馆内直播」未开启，C 端看不到入口——请超管在「内容开关」打开')
  if (clearedStale) tips.push('已自动清理异常残留场次（曾显示直播中但未配置推流）')
  return {
    success: true,
    enabled,
    configured,
    syncedAt: Date.now(),
    active: active ? await enrichSession(active, { enabled, withShelf: true }) : null,
    mine: mine
      ? await enrichSession(await refreshUrlsIfNeeded(mine), { asHost: true, enabled, withShelf: true })
      : null,
    lastEnded: lastEnded
      ? await enrichSession(lastEnded, { enabled, withShelf: true })
      : null,
    recent: (recent && recent.list) || [],
    clearedStale,
    msg: tips.join('；')
  }
}

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID
  const action = String((event && event.action) || 'getActive').trim()

  try {
    if (action === 'getActive') return await getActive(openid)
    if (action === 'getSession') return await getSession(event, openid)
    if (action === 'like') return await likeSession(openid)
    if (action === 'heartbeat') return await heartbeat(event, openid)
    if (action === 'postMessage') return await postMessage(event, openid)
    if (action === 'listMessages') return await listMessages(event)
    if (action === 'registerReminder') return await registerReminder(event, openid)
    if (action === 'cancelReminder') return await cancelReminder(event, openid)

    const guard = await assertHost(event, openid)
    if (!guard.ok) {
      return { success: false, code: guard.code, msg: guard.msg }
    }
    const actor = guard.actor || {}

    if (action === 'create') return await create(event, openid, actor)
    if (action === 'start') return await start(event, openid, actor)
    if (action === 'end') return await end(event, openid, actor)
    if (action === 'forceEnd') return await forceEnd(event, openid, actor)
    if (action === 'getHostSession') return await getHostSession(openid)
    if (action === 'getDashboard') return await getDashboard(openid)
    if (action === 'updateNotice') return await updateNotice(event, openid, actor)
    if (action === 'updateMeta') return await updateMeta(event, openid, actor)
    if (action === 'updateShelf') return await updateShelf(event, openid, actor)
    if (action === 'setSpotlight') return await setSpotlight(event, openid, actor)
    if (action === 'listRecent') return await listRecent()

    return { success: false, msg: `未知 action: ${action}` }
  } catch (e) {
    console.error('manageLiveSession', action, e)
    return { success: false, msg: (e && e.message) || '直播服务异常' }
  }
}
