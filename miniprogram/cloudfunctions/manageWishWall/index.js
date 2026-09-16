/**
 * 需求 28：马上有 · 弹幕祈福墙
 *
 * 业务口径（2026-09-16 确认）：
 *   - 弹幕**不接 UGC 审核**；内容治理由「超管工作台 → 内容模块」承载（隐藏 / 删除 / 查看）。
 *   - 闸门用 `content_display_flags.showMaShangYou`（缺配置默认**关**）：一键下线无需发版。
 *
 * 因此本函数刻意**没有**默认调用内容安全接口，但保留了**一行开关**：
 *   环境变量 `WISH_WALL_SECURITY=on` 时会走微信 `security.msgSecCheck`，
 *   命中 risky 直接拒绝。若平台复核或客诉要求补审核，改环境变量即可，**不必改代码发版**。
 *
 * action（C 端）：
 *   list   公开拉取 visible 弹幕（分页，最新在前）
 *   post   发布一条（openid 归属 + 频控 + 长度校验）
 *   mine   我发布过的（含被隐藏的，便于用户理解为何看不见）
 * action（管理端，超管/店长）：
 *   staffList      全量列表（含 hidden），支持状态/关键词过滤
 *   staffSetStatus visible | hidden
 *   staffRemove    删除
 *   staffStats     计数
 *   staffSeedAi    用 AI 创作一批「马上有XX」基础内容并上墙（无 key 时走人工基线兜底）
 *
 * 基础内容（AI）：
 *   祈福墙是空墙悖论最重的场景 —— 第一天进来看到空白就不会写，没人写就一直空。
 *   因此 `list` 会附带一组**按上海自然日轮换**的灵感文案（确定性，不用随机数），
 *   管理端则可以一键把一批新句式铺上墙。生成走 DashScope；未配置
 *   `DASHSCOPE_API_KEY` 或 AI 不可用时，自动改用 `wishSeeds.js` 里人工审校过的基线文案，
 *   **不会因为 AI 挂了就拿不出第一批内容**。
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')
const {
  SEED_BATCH,
  SEED_AUTHOR,
  SEED_MAX,
  baselineTexts,
  buildSeedPrompt,
  parseSeedTexts,
  pickInspiration,
  selectNewSeeds
} = require('./wishSeeds')
const { callQwenText } = require('./qwenText')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const COLLECTION = 'wish_wall_messages'
const PERMISSION = 'manageContentDisplayFlags'

/** 祈福墙作用域：当前只挂在「马上有」上，字段留出为后续「为全站拓展」预留 */
const DEFAULT_PRODUCT_KEY = 'mashangyou'

/** 文案长度：弹幕太长会糊满屏幕；下限防「。』这类无意义提交 */
const TEXT_MIN = 2
const TEXT_MAX = 30
/** 频控：每人每日条数 + 两条之间的最小间隔（秒） */
const DAILY_LIMIT = 5
const MIN_INTERVAL_MS = 10 * 1000
/** 公开列表单页上限 */
const LIST_MAX = 30
/** 灵感 chip 条数：给 4 条就够起兴，给多了输入框会被挤下去 */
const INSPIRATION_COUNT = 4
/** AI 播种默认条数（上限见 wishSeeds.SEED_MAX） */
const AI_SEED_DEFAULT = 8

const STATUS_VISIBLE = 'visible'
const STATUS_HIDDEN = 'hidden'

/** 内容来源：用户手写 / AI 创作 / 人工基线兜底 */
const SOURCE_USER = 'user'
const SOURCE_AI = 'ai'
const SOURCE_SEED = 'seed'

const NICK_FALLBACK = '匿名藏家'

/**
 * 归一化祈福文案。
 * - 折叠所有空白（含换行）为单空格：弹幕是单行滚动，换行会撑破轨道
 * - 去掉零宽字符与控制字符（它们能让同一条文案在审核视图里「看起来不一样」）
 */
function normalizeWishText(raw) {
  return String(raw == null ? '' : raw)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 校验祈福文案。
 * @returns {{ok:boolean, text?:string, msg?:string}}
 */
function validateWishText(raw) {
  const text = normalizeWishText(raw)
  if (!text) return { ok: false, msg: '写点想说的吧' }
  if (text.length < TEXT_MIN) return { ok: false, msg: `至少 ${TEXT_MIN} 个字` }
  if (text.length > TEXT_MAX) return { ok: false, msg: `最多 ${TEXT_MAX} 个字` }
  return { ok: true, text }
}

function normalizeProductKey(raw) {
  const key = String(raw || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
  return key.slice(0, 40) || DEFAULT_PRODUCT_KEY
}

/**
 * 上海自然日的日期键 `YYYY-MM-DD`（容器时区不保证，手工 +8 换算）。
 * 灵感文案按它轮换：同一天进两次看到同一组，跨天才换 —— 确定性才可断言。
 */
function shanghaiDayKey(ms) {
  const t = Number.isFinite(ms) ? ms : Date.now()
  const sh = new Date(t + 8 * 3600 * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${sh.getUTCFullYear()}-${pad(sh.getUTCMonth() + 1)}-${pad(sh.getUTCDate())}`
}

function todayRangeShanghai(now) {
  // 频控按 Asia/Shanghai 自然日（CloudBase 容器时区不保证）
  const t = Number.isFinite(now) ? now : Date.now()
  const sh = new Date(t + 8 * 3600 * 1000)
  const y = sh.getUTCFullYear()
  const m = sh.getUTCMonth()
  const d = sh.getUTCDate()
  const start = Date.UTC(y, m, d, 0, 0, 0) - 8 * 3600 * 1000
  return { start: new Date(start), end: new Date(start + 24 * 3600 * 1000) }
}

/** 内容安全（默认关闭；`WISH_WALL_SECURITY=on` 时生效） */
function securityEnabled() {
  return String(process.env.WISH_WALL_SECURITY || '').trim().toLowerCase() === 'on'
}

async function checkTextRisky(openid, text) {
  if (!securityEnabled()) return { ok: true, skipped: true }
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      openid,
      scene: 4,
      version: 2,
      content: String(text || '').slice(0, 2500)
    })
    const suggest = (res && res.result && res.result.suggest) || ''
    if (suggest === 'risky') return { ok: false, reason: 'risky' }
    return { ok: true, suggest }
  } catch (e) {
    // 接口不可用时不放行也不误杀：拒绝并提示，交由人工在内容模块处理
    const msg = (e && (e.errMsg || e.message)) || 'security check failed'
    console.warn('wish wall msgSecCheck failed:', msg)
    return { ok: false, reason: 'error', msg }
  }
}

/** 服务端权威昵称/头像：不信任客户端传来的展示名（可用来冒充他人） */
async function loadActorProfile(openid) {
  const fallback = { nickname: NICK_FALLBACK, avatar: '' }
  try {
    const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
    const row = (res.data || [])[0]
    if (!row) return fallback
    const nickname = String(row.nickName || row.nickname || '').trim().slice(0, 20)
    const avatar = String(row.avatarUrl || row.avatar || '').trim().slice(0, 512)
    return { nickname: nickname || NICK_FALLBACK, avatar }
  } catch (e) {
    console.warn('wish wall profile read failed:', e && e.message)
    return fallback
  }
}

function mapPublicItem(doc) {
  return {
    _id: doc._id,
    text: doc.text || '',
    nickname: doc.nickname || NICK_FALLBACK,
    avatar: doc.avatar || '',
    pinned: doc.pinned === true,
    // 只回"是不是用户写的"这一位：C 端据此给馆方内容加一个小标记。
    // 不回 openid / status —— 最小暴露，这是「公开列表」不是管理列表。
    source: doc.source || SOURCE_USER,
    createTime: doc.createTime || doc._createTime || null
  }
}

function mapStaffItem(doc) {
  return {
    _id: doc._id,
    text: doc.text || '',
    nickname: doc.nickname || NICK_FALLBACK,
    avatar: doc.avatar || '',
    status: doc.status === STATUS_HIDDEN ? STATUS_HIDDEN : STATUS_VISIBLE,
    pinned: doc.pinned === true,
    source: doc.source || 'user',
    openid: doc._openid || doc.openid || '',
    productKey: doc.productKey || DEFAULT_PRODUCT_KEY,
    createTime: doc.createTime || doc._createTime || null
  }
}

async function listPublic(event) {
  const productKey = normalizeProductKey(event && event.productKey)
  const limit = Math.min(LIST_MAX, Math.max(1, parseInt((event && event.limit) || 20, 10) || 20))
  // 灵感文案不依赖列表查询结果：即使集合还没建/查询失败，输入框上方也该有起兴的句子，
  // 否则「空墙 + 空灵感」会让新用户直接退出（这正是本需求要解决的问题）。
  const inspiration = pickInspiration(baselineTexts(), {
    dayKey: shanghaiDayKey(Date.now()),
    count: INSPIRATION_COUNT
  })
  try {
    const res = await db.collection(COLLECTION)
      .where({ productKey, status: STATUS_VISIBLE })
      .orderBy('pinned', 'desc')
      .orderBy('createTime', 'desc')
      .limit(limit)
      .get()
    const rows = (res.data || []).map(mapPublicItem)
    // 置顶项在前，其余保持时间倒序（两次 orderBy 在部分索引缺失时会被忽略，这里再稳一次）
    rows.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return new Date(b.createTime || 0) - new Date(a.createTime || 0)
    })
    return { success: true, list: rows, inspiration, productKey }
  } catch (e) {
    console.warn('wish wall list failed:', e && e.message)
    return { success: true, list: [], inspiration, productKey, fallback: true }
  }
}

async function postWish(event, openid) {
  if (!openid) return { success: false, msg: '请先登录' }
  const checked = validateWishText(event && event.text)
  if (!checked.ok) return { success: false, msg: checked.msg }

  const productKey = normalizeProductKey(event && event.productKey)

  const sec = await checkTextRisky(openid, checked.text)
  if (!sec.ok) {
    return {
      success: false,
      code: sec.reason === 'risky' ? 'CONTENT_RISKY' : 'CONTENT_CHECK_UNAVAILABLE',
      msg: sec.reason === 'risky' ? '这条心愿没能通过检测，换句话说说看' : '暂时无法发布，请稍后再试'
    }
  }

  // 频控：当日条数 + 最小间隔（读两次，写入前判定）
  const { start, end } = todayRangeShanghai()
  try {
    const mine = await db.collection(COLLECTION)
      .where({ _openid: openid, productKey, createTime: _.gte(start).and(_.lt(end)) })
      .orderBy('createTime', 'desc')
      .limit(DAILY_LIMIT + 1)
      .get()
    const rows = mine.data || []
    if (rows.length >= DAILY_LIMIT) {
      return { success: false, code: 'DAILY_LIMIT', msg: `今天已许愿 ${DAILY_LIMIT} 次，明天再来` }
    }
    const last = rows[0]
    const lastAt = last && last.createTime ? new Date(last.createTime).getTime() : 0
    if (lastAt && Date.now() - lastAt < MIN_INTERVAL_MS) {
      const wait = Math.ceil((MIN_INTERVAL_MS - (Date.now() - lastAt)) / 1000)
      return { success: false, code: 'TOO_FAST', msg: `慢一点，${wait} 秒后再发` }
    }
  } catch (e) {
    // 频控查询失败不阻断发布（宁可多一条，也不要因索引缺失导致完全发不出去）
    console.warn('wish wall rate limit check failed:', e && e.message)
  }

  const profile = await loadActorProfile(openid)
  const now = db.serverDate()
  try {
    const added = await db.collection(COLLECTION).add({
      data: {
        _openid: openid,
        openid,
        productKey,
        text: checked.text,
        nickname: profile.nickname,
        avatar: profile.avatar,
        status: STATUS_VISIBLE,
        pinned: false,
        source: SOURCE_USER,
        securityChecked: securityEnabled(),
        createTime: now,
        updateTime: now
      }
    })
    return {
      success: true,
      _id: added._id,
      text: checked.text,
      nickname: profile.nickname,
      msg: '心愿已挂上墙'
    }
  } catch (e) {
    console.error('wish wall post failed:', e)
    if (/collection|集合/.test(e.message || '')) {
      return { success: false, msg: `请先在云开发控制台创建集合 ${COLLECTION}` }
    }
    return { success: false, msg: e.message || '发布失败' }
  }
}

async function listMine(event, openid) {
  if (!openid) return { success: true, list: [] }
  const productKey = normalizeProductKey(event && event.productKey)
  try {
    const res = await db.collection(COLLECTION)
      .where({ _openid: openid, productKey })
      .orderBy('createTime', 'desc')
      .limit(LIST_MAX)
      .get()
    return { success: true, list: (res.data || []).map(mapStaffItem) }
  } catch (e) {
    return { success: true, list: [], fallback: true }
  }
}

/* ------------------------- 管理端（超管工作台-内容模块） ------------------------- */

async function requireManager(event, openid) {
  return assertStaff(db, openid, { role: ROLE_MANAGER, permission: PERMISSION, adminOpsKey: event && event.adminOpsKey })
}

async function staffList(event, openid) {
  const guard = await requireManager(event, openid)
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg || '无权限' }

  const status = String((event && event.status) || '').trim()
  const productKey = normalizeProductKey(event && event.productKey)
  const keyword = normalizeWishText(event && event.keyword)
  const limit = Math.min(100, Math.max(1, parseInt((event && event.limit) || 50, 10) || 50))
  const where = { productKey }
  if (status === STATUS_VISIBLE || status === STATUS_HIDDEN) where.status = status

  try {
    const res = await db.collection(COLLECTION)
      .where(where)
      .orderBy('createTime', 'desc')
      .limit(limit)
      .get()
    let rows = (res.data || []).map(mapStaffItem)
    if (keyword) rows = rows.filter((r) => r.text.indexOf(keyword) !== -1)
    return { success: true, list: rows, productKey }
  } catch (e) {
    console.warn('wish wall staffList failed:', e && e.message)
    return { success: false, list: [], msg: e.message || '加载失败' }
  }
}

async function staffSetStatus(event, openid) {
  const guard = await requireManager(event, openid)
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg || '无权限' }

  const id = String((event && event.id) || '').trim()
  const status = String((event && event.status) || '').trim()
  if (!id) return { success: false, msg: '缺少 id' }
  if ([STATUS_VISIBLE, STATUS_HIDDEN].indexOf(status) === -1) {
    return { success: false, msg: '状态不合法' }
  }
  const data = { status, updateTime: db.serverDate(), updatedBy: openid || (guard.actor && guard.actor.openid) || '' }
  if (typeof (event && event.pinned) === 'boolean') data.pinned = event.pinned
  try {
    await db.collection(COLLECTION).doc(id).update({ data })
    return { success: true, id, status, msg: status === STATUS_HIDDEN ? '已隐藏' : '已恢复展示' }
  } catch (e) {
    return { success: false, msg: e.message || '更新失败' }
  }
}

async function staffRemove(event, openid) {
  const guard = await requireManager(event, openid)
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg || '无权限' }
  const id = String((event && event.id) || '').trim()
  if (!id) return { success: false, msg: '缺少 id' }
  try {
    await db.collection(COLLECTION).doc(id).remove()
    return { success: true, id, msg: '已删除' }
  } catch (e) {
    return { success: false, msg: e.message || '删除失败' }
  }
}

async function staffStats(event, openid) {
  const guard = await requireManager(event, openid)
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg || '无权限' }
  const productKey = normalizeProductKey(event && event.productKey)
  try {
    const visible = await db.collection(COLLECTION).where({ productKey, status: STATUS_VISIBLE }).count()
    const hidden = await db.collection(COLLECTION).where({ productKey, status: STATUS_HIDDEN }).count()
    return {
      success: true,
      productKey,
      counts: { visible: visible.total || 0, hidden: hidden.total || 0 }
    }
  } catch (e) {
    return { success: false, msg: e.message || '统计失败' }
  }
}

/* ------------------- 基础内容：AI 创作一批「马上有XX」 ------------------- */

/**
 * 墙上已有的全部文案 —— **含 hidden**。
 * 只比 visible 的话，被人工隐藏的内容会被下一次播种重新种一遍，等于绕过治理。
 */
async function loadExistingTexts(productKey) {
  try {
    const res = await db.collection(COLLECTION).where({ productKey }).limit(200).get()
    return (res.data || []).map((d) => d.text || '').filter(Boolean)
  } catch (e) {
    console.warn('wish wall seed: existing read failed:', e && e.message)
    return []
  }
}

/**
 * 用 AI 创作一批「马上有XX」基础内容并上墙（超管/店长）。
 *
 * 设计要点：
 *   1. **AI 优先，基线兜底**：AI 条数不足就用人工审校过的基线补齐，
 *      保证"墙上有内容"这件事不依赖外部 API 的可用性；
 *   2. **同一批不重复**：与墙上全部文案（含 hidden）比对，重复的直接丢；
 *   3. **落库即全部可治理**：与用户弹幕同表同字段，管理端可隐藏/删除，
 *      不额外造一条"免治理"的内容通道；
 *   4. `_openid` 留空：基础内容不属于任何用户，不参与用户频控与「我的」。
 *
 * @param {object} event { productKey?, count?, useAi? }
 */
async function staffSeedAi(event, openid) {
  const guard = await requireManager(event, openid)
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg || '无权限' }

  const productKey = normalizeProductKey(event && event.productKey)
  const want = Math.min(
    SEED_MAX,
    Math.max(1, parseInt((event && event.count) || AI_SEED_DEFAULT, 10) || AI_SEED_DEFAULT)
  )
  const useAi = !(event && event.useAi === false)

  const existing = await loadExistingTexts(productKey)

  let aiTexts = []
  let aiError = ''
  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!useAi) {
    aiError = '本次跳过 AI'
  } else if (!apiKey) {
    aiError = '未配置 DASHSCOPE_API_KEY'
  } else {
    try {
      // 多要一倍：模型总会有几条不合句式，留给句式闸门筛
      const raw = await callQwenText(buildSeedPrompt({ count: want * 2, avoid: existing }), apiKey)
      aiTexts = selectNewSeeds({ candidates: parseSeedTexts(raw), existing, limit: want })
    } catch (e) {
      aiError = (e && e.message) || 'AI 调用失败'
      console.warn('wish wall seed ai failed:', aiError)
    }
  }

  const baseTexts = selectNewSeeds({
    candidates: baselineTexts(),
    existing: existing.concat(aiTexts),
    limit: want - aiTexts.length
  })

  if (!aiTexts.length && !baseTexts.length) {
    return { success: false, code: 'NO_NEW_SEED', msg: '这批心愿与墙上已有的重复了', aiError }
  }

  const now = db.serverDate()
  const inserted = []
  const addOne = async (text, source) => {
    try {
      await db.collection(COLLECTION).add({
        data: {
          _openid: '',
          openid: '',
          productKey,
          text,
          nickname: SEED_AUTHOR,
          avatar: '',
          status: STATUS_VISIBLE,
          pinned: false,
          source,
          aiGenerated: source === SOURCE_AI,
          seedBatch: SEED_BATCH,
          securityChecked: false,
          createTime: now,
          updateTime: now
        }
      })
      inserted.push({ text, source })
    } catch (e) {
      console.warn('wish wall seed insert failed:', e && e.message)
    }
  }

  for (const text of aiTexts) await addOne(text, SOURCE_AI)
  for (const text of baseTexts) await addOne(text, SOURCE_SEED)

  if (!inserted.length) {
    return { success: false, msg: `请先在云开发控制台创建集合 ${COLLECTION}`, aiError }
  }

  const aiCount = inserted.filter((r) => r.source === SOURCE_AI).length
  return {
    success: true,
    batch: SEED_BATCH,
    productKey,
    aiUsed: aiCount > 0,
    counts: { total: inserted.length, ai: aiCount, baseline: inserted.length - aiCount },
    texts: inserted,
    aiError: aiError || '',
    msg: `已上墙 ${inserted.length} 条`
  }
}

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID
  const action = String((event && event.action) || 'list')
  try {
    switch (action) {
      case 'list': return await listPublic(event)
      case 'post': return await postWish(event, openid)
      case 'mine': return await listMine(event, openid)
      case 'staffList': return await staffList(event, openid)
      case 'staffSetStatus': return await staffSetStatus(event, openid)
      case 'staffRemove': return await staffRemove(event, openid)
      case 'staffStats': return await staffStats(event, openid)
      case 'staffSeedAi': return await staffSeedAi(event, openid)
      default: return { success: false, msg: `未知 action: ${action}` }
    }
  } catch (e) {
    console.error('manageWishWall', action, e)
    return { success: false, msg: (e && e.message) || '服务异常' }
  }
}

// 供行为测试直接引用纯函数（云函数运行时不会用到这些导出）
module.exports.normalizeWishText = normalizeWishText
module.exports.validateWishText = validateWishText
module.exports.normalizeProductKey = normalizeProductKey
module.exports.todayRangeShanghai = todayRangeShanghai
module.exports.shanghaiDayKey = shanghaiDayKey
module.exports.TEXT_MAX = TEXT_MAX
module.exports.TEXT_MIN = TEXT_MIN
module.exports.DAILY_LIMIT = DAILY_LIMIT
module.exports.DEFAULT_PRODUCT_KEY = DEFAULT_PRODUCT_KEY
module.exports.INSPIRATION_COUNT = INSPIRATION_COUNT
module.exports.AI_SEED_DEFAULT = AI_SEED_DEFAULT
module.exports.SOURCE_USER = SOURCE_USER
module.exports.SOURCE_AI = SOURCE_AI
module.exports.SOURCE_SEED = SOURCE_SEED
