/**
 * 专题档案阅读计数核（db 注入，便于离线测试；云函数入口见 index.js）
 *
 * 防刷：同一 openid 对同一专题在 WINDOW_MS 内重复打开只计一次（滑动窗口，从上次计数时刻起算）。
 *   标记文档 `wiki_view_marks/<openid>_<wikiId>`：
 *     1. 条件更新 `where({ _id, lastAt < now - WINDOW_MS }).update({ lastAt: now })` —— 窗口外才命中，单文档原子；
 *     2. 未命中再 `add({ _id })` —— 首次打开成功；已存在（窗口内）因主键冲突失败 → 不计。
 *   两个并发请求最多一个拿到计数权。
 * 计数文档 `wiki_stats/<wikiId>`：`views` 用 `_.inc(1)`；文档不存在时 `add`，主键冲突（并发首建）再 inc。
 */
const WINDOW_MS = 30 * 60 * 1000
const ID_RE = /^[\w-]{1,64}$/
const STATS = 'wiki_stats'
const MARKS = 'wiki_view_marks'
const SOURCES = ['cms_wikis', 'curated_collections']

const updated = (r) => !!(r && r.stats && r.stats.updated > 0)

async function readStats(db, wikiId) {
  try {
    const r = await db.collection(STATS).doc(wikiId).get()
    const d = (r && r.data) || {}
    return { views: Math.max(0, Number(d.views) || 0), likes: Math.max(0, Number(d.likes) || 0) }
  } catch (e) {
    return { views: 0, likes: 0 }
  }
}

async function wikiExists(db, wikiId) {
  for (const col of SOURCES) {
    try {
      const r = await db.collection(col).doc(wikiId).get()
      if (r && r.data) return true
    } catch (e) { /* 不存在会抛错，继续查下一个来源 */ }
  }
  return false
}

async function claimView(db, _, openid, wikiId, now) {
  const key = `${openid}_${wikiId}`
  const r = await db.collection(MARKS).where({ _id: key, lastAt: _.lt(now - WINDOW_MS) }).update({ data: { lastAt: now } })
  if (updated(r)) return true
  try {
    await db.collection(MARKS).add({ data: { _id: key, _openid: openid, wikiId, lastAt: now } })
    return true
  } catch (e) {
    return false
  }
}

async function incViews(db, _, wikiId, serverDate) {
  const r = await db.collection(STATS).doc(wikiId).update({ data: { views: _.inc(1), updateTime: serverDate } }).catch(() => null)
  if (updated(r)) return
  try {
    await db.collection(STATS).add({ data: { _id: wikiId, views: 1, likes: 0, createTime: serverDate, updateTime: serverDate } })
  } catch (e) {
    await db.collection(STATS).doc(wikiId).update({ data: { views: _.inc(1), updateTime: serverDate } })
  }
}

/**
 * action：
 *   view  { wikiId } 记一次阅读（窗口内重复不计）→ { success, counted, views, likes }
 *   get   { wikiId } 只读计数 → { success, views, likes }
 * likes 暂无写入方（专题页没有收藏入口），恒为 0，页面按 0 隐藏。
 */
async function handle(event, { db, _, openid, now, serverDate }) {
  const action = event && event.action
  const wikiId = String((event && event.wikiId) || '')
  if (!ID_RE.test(wikiId)) return { success: false, code: 'BAD_ID', msg: 'wikiId 不合法' }
  if (action === 'get') return { success: true, ...(await readStats(db, wikiId)) }
  if (action !== 'view') return { success: false, code: 'BAD_ACTION', msg: '未知 action' }
  if (!openid) return { success: true, counted: false, ...(await readStats(db, wikiId)) }
  if (!(await wikiExists(db, wikiId))) return { success: false, code: 'NOT_FOUND', msg: '专题不存在' }
  const counted = await claimView(db, _, openid, wikiId, now)
  if (counted) await incViews(db, _, wikiId, serverDate)
  return { success: true, counted, ...(await readStats(db, wikiId)) }
}

module.exports = { handle, WINDOW_MS, STATS, MARKS }
