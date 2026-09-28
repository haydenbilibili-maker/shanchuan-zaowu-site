/**
 * 玩法留档（本地）—— PRD v1.4 §11.1 R3「结果**留档可回看**」的载体。
 *
 * 口径（为什么只存本地、不写云端）：
 *   ① 玩法结果是"我今天抽到的一句"，不是资产，不需要跨端一致；
 *   ② 它是**娱乐/收集**（§11.3 的第六个分区），进云就是多一张表 + 一套权限与治理面；
 *   ③ 木鱼可连点、玩法可反复进，云端写 = 写放大（与 §7「木鱼逐次不写云」同一条纪律）。
 *   所以：key 一份、按玩法分桶、每天每维度最多一条（同日同维度覆盖），跨天**由日期键自然翻页**。
 *
 * 跨天重置口径：不设定时器、不做后台清理 —— `playedToday` 是**现算**的
 * （拿存下来的 dayKey 与「今天」比），所以跨天不需要任何钩子，也不可能漏重置。
 * 「今天」的日期键由调用方用 `utils/wishWall.shanghaiDayKey` 传入（与点灯/灯语同源）。
 *
 * 存储失败（隐私模式 / 10MB 上限 / 老基础库）一律**降级为"没有留档"**，绝不抛 ——
 * 留档是加分项，不能因为它坏掉而让玩法页崩。
 */

const STORAGE_KEY = 'shanhai_ritual_play_v1'
const VERSION = 1

/** 每个玩法最多留 N 条：存储不是账本，无限增长早晚会撑爆（与 wishRitual.KEEP_DAYS 同思路） */
const KEEP_PER_PLAY = 20

function emptyState() {
  return { version: VERSION, plays: {} }
}

function readState() {
  try {
    if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return emptyState()
    const raw = wx.getStorageSync(STORAGE_KEY)
    if (raw && typeof raw === 'object' && raw.plays && typeof raw.plays === 'object') {
      return { version: raw.version || VERSION, plays: raw.plays }
    }
  } catch (e) {
    console.warn('ritualPlayArchive readState', e)
  }
  return emptyState()
}

function writeState(state) {
  try {
    if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return false
    wx.setStorageSync(STORAGE_KEY, state)
    return true
  } catch (e) {
    console.warn('ritualPlayArchive writeState', e)
    return false
  }
}

/** 结果 → 留档条目（只留**展示需要的**字段，避免把整份内部对象塞进存储） */
function entryFromResult(dayKey, result) {
  const r = result || {}
  return {
    dayKey: String(dayKey || ''),
    at: Date.now(),
    variant: String(r.variant || ''),
    kind: String(r.kind || ''),
    mark: String(r.mark || ''),
    name: String(r.name || ''),
    overline: String(r.overline || ''),
    title: String(r.title || ''),
    sub: String(r.sub || ''),
    lines: (r.lines || []).map((s) => String(s || '')).filter(Boolean),
    wish: String(r.wish || ''),
    share: String(r.share || ''),
    echo: String(r.echo || ''),
    note: String(r.note || '')
  }
}

/** 只保留最近 KEEP_PER_PLAY 条（新的在前） */
function pruneList(list) {
  return (Array.isArray(list) ? list : []).slice(0, KEEP_PER_PLAY)
}

/**
 * 存一次结果。同日同维度覆盖（qian/cookie 的 variant 恒为空 → 一天一条）。
 * @returns {{ok:boolean, entry:object}} ok=false 表示这次没写进去（存储不可用）
 */
function saveResult(playId, dayKey, result) {
  const id = String(playId || '')
  if (!id) return { ok: false, entry: entryFromResult(dayKey, result) }
  const entry = entryFromResult(dayKey, result)
  const state = readState()
  const list = Array.isArray(state.plays[id]) ? state.plays[id] : []
  const rest = list.filter((e) => !(e && e.dayKey === entry.dayKey && String(e.variant || '') === entry.variant))
  state.plays[id] = pruneList([entry].concat(rest))
  const ok = writeState(state)
  return { ok, entry }
}

/** 今天这一条（可按维度取；variant 为空 = 该玩法当天第一条，与维度无关） */
function todayEntry(playId, dayKey, variant) {
  const list = listFor(playId)
  const day = String(dayKey || '')
  const v = String(variant || '')
  const hit = list.filter((e) => e && e.dayKey === day && (!v || String(e.variant || '') === v))
  return hit.length ? hit[0] : null
}

/** 今天玩过没有（任何维度都算"玩过"——入口的状态句据此切换） */
function playedToday(playId, dayKey) {
  return !!todayEntry(playId, dayKey, '')
}

/** 多个玩法的"今天玩过没有"（入口区一次算完，避免每个入口各读一次存储） */
function playedTodayMap(playIds, dayKey) {
  const out = {}
  ;(Array.isArray(playIds) ? playIds : []).forEach((id) => { out[String(id)] = playedToday(id, dayKey) })
  return out
}

function listFor(playId) {
  const state = readState()
  const list = state.plays[String(playId || '')]
  return Array.isArray(list) ? list : []
}

/** 全部留档（按玩法分桶；页面"回看"用） */
function listAll() {
  return readState().plays
}

module.exports = {
  STORAGE_KEY,
  KEEP_PER_PLAY,
  readState,
  writeState,
  entryFromResult,
  saveResult,
  todayEntry,
  playedToday,
  playedTodayMap,
  listFor,
  listAll
}
