/**
 * 马上有 · 心愿签 —— 页面纯函数（无 wx / 无网络，守卫 test:wish-labels 直接 require 跑）
 * 蓝图：miniprogram/docs/马上有心愿签_重设计蓝图_2026-10-13.md
 */
const { normalizeWishText, formatWishTime, wishTimeMs } = require('../../../utils/wishWall')

/** 首屏露角的最新签张数 */
const PEEK_COUNT = 3
/** 「我也想要」本地已点记录（服务端按 msgId + openid 幂等，这里只决定按钮态） */
const ECHO_STORE_KEY = 'wish_labels_echoed_v1'
const ECHO_STORE_MAX = 300

/** 标签编号：取 _id 末 4 位大写（稳定、不编造流水号；本地乐观条目无编号） */
function labelNo(id) {
  const s = String(id || '')
  if (!s || s.indexOf('local-') === 0) return ''
  return 'No.' + s.slice(-4).toUpperCase()
}

/** 2026.10.13（北京时间）；无时间返回空串（不显示占位） */
function labelDate(value) {
  const t = wishTimeMs(value)
  if (!t) return ''
  const d = new Date(t + 8 * 3600 * 1000)
  const pad = (n) => (n < 10 ? '0' + n : String(n))
  return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`
}

/** 公开列表行 → 标签视图 */
function toLabel(row, now, echoed) {
  const r = row || {}
  const id = String(r._id || '')
  const text = normalizeWishText(r.text)
  return {
    _id: id,
    no: labelNo(id),
    text,
    long: text.length > 8,
    author: String(r.nickname || '匿名藏家'),
    official: r.source === 'ai' || r.source === 'seed',
    pinned: r.pinned === true,
    timeText: formatWishTime(r.createTime, now),
    date: labelDate(r.createTime),
    echoCount: Math.max(0, parseInt(r.echoCount, 10) || 0),
    echoed: !!(echoed && echoed.has(id)),
    isMine: false,
    hidden: false,
    // 语音：公开列表只在试听通过后带 voiceUrl（临时链接）
    voiceSec: Math.max(0, parseInt(r.voiceDuration, 10) || 0),
    voiceUrl: String(r.voiceUrl || ''),
    voiceText: (parseInt(r.voiceDuration, 10) || 0) > 0 ? voiceLabel(r.voiceDuration) : '',
    voiceStatus: '',
    voiceTag: ''
  }
}

/** 「声音审核中 / 声音未通过」只给作者自己看 */
function voiceTag(label) {
  const l = label || {}
  if (!l.isMine) return ''
  if (l.voiceStatus === 'pending') return '声音审核中'
  if (l.voiceStatus === 'rejected') return '声音未通过'
  return ''
}

/** 0:08 */
function voiceLabel(sec) {
  const n = Math.max(0, Math.floor(Number(sec) || 0))
  return `${Math.floor(n / 60)}:${n % 60 < 10 ? '0' : ''}${n % 60}`
}

/** 两列错落：按序交替入列（与旧墙一致的确定性，不做测高） */
/**
 * 首屏露角选哪几张（2026-11-23）：墙紧挨在下面已经按「最新」排了，露角再放最新三张是重复；
 * 改成「大家最想要」—— 按「我也想要」人数取前几张（同数取新的），不够数用最新补满；还没人点过时退回最新。
 * 返回 { list, mode }，mode = 'echo' | 'latest'。收起的签不进露角。
 */
function peekOf(wall, n) {
  const count = n || PEEK_COUNT
  const visible = (wall || []).filter((l) => l && !l.hidden)
  const echoed = visible.filter((l) => (l.echoCount || 0) > 0)
  if (!echoed.length) return { list: visible.slice(0, count), mode: 'latest' }
  const order = new Map(visible.map((l, i) => [l._id, i]))
  const top = echoed.slice().sort((a, b) => (b.echoCount - a.echoCount) || (order.get(a._id) - order.get(b._id))).slice(0, count)
  // 想要的不够数时用最新的补满，首屏仍是一整排
  const picked = new Set(top.map((l) => l._id))
  const list = top.concat(visible.filter((l) => !picked.has(l._id)).slice(0, count - top.length))
  return { list, mode: 'echo' }
}

/**
 * 签详情翻页（2026-11-23）：在当前这面墙（最新 / 我的）的顺序里，算出这张的位置与前后两张。
 * 返回 { index, total, prevId, nextId }；不在列表里时 null。
 */
function cardPager(list, id) {
  const ids = (list || []).filter((l) => l && l._id).map((l) => l._id)
  const i = ids.indexOf(id)
  if (i < 0 || ids.length < 2) return null
  return { index: i + 1, total: ids.length, prevId: i > 0 ? ids[i - 1] : '', nextId: i < ids.length - 1 ? ids[i + 1] : '' }
}

function splitColumns(labels) {
  const cols = [[], []]
  ;(labels || []).forEach((l, i) => cols[i % 2].push(l))
  return cols
}

/** 「我的」行（decorateMineRows 的结果）补标签字段 */
function mineToLabels(rows, rawRows) {
  const raw = Array.isArray(rawRows) ? rawRows : []
  return (rows || []).map((r, i) => Object.assign({}, r, {
    no: labelNo(r._id),
    long: String(r.text || '').length > 8,
    author: r.nickname || '我',
    date: labelDate(raw[i] && raw[i].createTime),
    echoCount: Math.max(0, parseInt(raw[i] && raw[i].echoCount, 10) || 0),
    echoed: false,
    voiceSec: Math.max(0, parseInt(raw[i] && raw[i].voiceDuration, 10) || 0),
    voiceUrl: String((raw[i] && raw[i].voiceUrl) || ''),
    voiceStatus: String((raw[i] && raw[i].voiceStatus) || '')
  })).map((l) => Object.assign(l, { voiceTag: voiceTag(l), voiceText: l.voiceSec ? voiceLabel(l.voiceSec) : '' }))
}

function readEchoed(storage) {
  try {
    const arr = storage.getStorageSync(ECHO_STORE_KEY)
    return new Set(Array.isArray(arr) ? arr.map(String) : [])
  } catch (e) {
    return new Set()
  }
}

function writeEchoed(storage, set) {
  try {
    const arr = Array.from(set).slice(-ECHO_STORE_MAX)
    storage.setStorageSync(ECHO_STORE_KEY, arr)
  } catch (e) { /* 本地记不住只影响按钮态，服务端仍幂等 */ }
}

module.exports = {
  PEEK_COUNT,
  ECHO_STORE_KEY,
  labelNo,
  labelDate,
  toLabel,
  splitColumns,
  peekOf,
  cardPager,
  voiceTag,
  voiceLabel,
  mineToLabels,
  readEchoed,
  writeEchoed
}
