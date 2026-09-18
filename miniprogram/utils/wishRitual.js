/**
 * 需求 28：祈福墙 · 点灯仪式（本地状态）
 *
 * 为什么要有「点灯」这一步：
 *   祈福墙的主交互是**输入框**——这是全站转化门槛最高的一个动作。
 *   「点灯」是零门槛的仪式入口：一进来先有一个可做的小动作，
 *   做完会得到今天的一句话；用户因此愿意在墙上多停一会，也更容易写下第一句心愿。
 *
 * 为什么只存本地（不写云端）：
 *   ① 仪式是"今天我来过"的自我记录，不是资产，不需要跨端一致；
 *   ② 一旦落库就要多一张表、多一套权限与治理面 —— 与「不接 UGC 审核」的口径冲突；
 *   ③ 彩蛋/仪式的失败绝不能影响祈福墙主流程，本地存储失败即降级为"灯未点"。
 *
 * 纯函数（日期键、每日一句、连续天数）在 `utils/wishWall.js`，本文件只做**读写与校时**。
 */

const STORAGE_KEY = 'shanhai_wish_ritual_v1'
const VERSION = 1

/** 只保留最近 N 天的点灯记录：存储不是账本，无限增长早晚会撑爆 10MB 上限 */
const KEEP_DAYS = 30

/**
 * 每日一句（点灯后亮出的那句话）。
 * 语气与彩蛋一致：克制、具体，不写"恭喜发财"。
 *
 * ⚠️ **每条 ≤ 13 字（含标点）**，这不是口味问题：这句话在卡片里是**整行**排版，
 * 一行可用宽 = 750 - 2×32(页面) - 2×20(卡片) = 646rpx 减去卡宽折算后约 295rpx，
 * 21rpx 字号下一行装得下 14 字「理论值」，留 1 字余量 → **13 字**。
 * 超了就会折行、并在第二行留一个 2–3 字的孤字（真机截图上的"的心愿。"就是这么来的，
 * 产品反馈「文案过于拥挤」）。守卫 `test:wish-wall` 按上面这套宽度**实算**上限并逐条断言。
 */
const LAMP_LINES = [
  '写下来，风会替你带一段路。',
  '灯亮着，心愿就还没说完。',
  '将就今日，不如等一匹好马。',
  '灯照一行字，抵一次远行。',
  '愿所求都具体，所指都抵达。',
  '先把心愿放下，余下给时间。',
  '夜里点灯的人，白天有去处。',
  '一灯不灭，一事可期。'
]

/**
 * 节气灯语：**节气当天**优先于上面那句通用灯语。
 *
 * 为什么按"季"而不是给 24 个节气各写一句：24 条每年只用一次，写完没人记得住，
 * 也远超"一句话"的体量；真正有体感差异的是四季。所以节气名照实显示（立春/霜降…），
 * 句子按季给 —— 既保留了"今天是个日子"的仪式，又不至于堆 24 条近乎重复的文案。
 */
const SOLAR_LINES = {
  spring: '春气一动，草木比人先知道。',
  summer: '天长，慢慢来也来得及。',
  autumn: '收成不必满仓，够用就好。',
  winter: '天冷了，先把灯留着。'
}

/**
 * 灯位文案：连续点灯到第 3 / 7 天时那句反馈。
 * 与 `utils/wishWall.lampTier` 的 tier 一一对应（1 初见 / 2 守夜 / 3 长明）。
 * 同样受 LAMP_LINES 那条 ≤13 字上限约束（它和灯语在同一行组里，19rpx 也按 13 字算）。
 */
const LAMP_TIER_NOTES = {
  1: '今天来过，记下了。',
  2: '连着来，灯就稳了。',
  3: '这盏灯，已经长明。'
}

function emptyState() {
  return { version: VERSION, days: {} }
}

function readState() {
  try {
    if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return emptyState()
    const raw = wx.getStorageSync(STORAGE_KEY)
    if (raw && typeof raw === 'object' && raw.days && typeof raw.days === 'object') {
      return { version: raw.version || VERSION, days: raw.days }
    }
  } catch (e) {
    console.warn('wishRitual readState', e)
  }
  return emptyState()
}

function writeState(state) {
  try {
    if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return false
    wx.setStorageSync(STORAGE_KEY, state)
    return true
  } catch (e) {
    console.warn('wishRitual writeState', e)
    return false
  }
}

/** 只保留最近 KEEP_DAYS 个日期键（键是 `YYYY-MM-DD`，字典序即时间序） */
function pruneDays(days) {
  const keys = Object.keys(days || {}).sort().reverse()
  if (keys.length <= KEEP_DAYS) return days || {}
  const kept = {}
  keys.slice(0, KEEP_DAYS).forEach((k) => { kept[k] = days[k] })
  return kept
}

/**
 * 读取某天的点灯状态。
 * @param {string} dayKey `YYYY-MM-DD`
 */
function getLamp(dayKey) {
  const state = readState()
  const rec = state.days[dayKey]
  return {
    dayKey,
    lit: !!rec,
    litAt: (rec && rec.litAt) || 0,
    days: Object.keys(state.days)
  }
}

/**
 * 点灯（幂等：同一天重复点不覆盖首次时间）。
 * @param {string} dayKey
 * @returns {{dayKey:string, lit:boolean, litAt:number, days:string[], firstTimeToday:boolean}}
 */
function lightLamp(dayKey) {
  const state = readState()
  const firstTimeToday = !state.days[dayKey]
  if (firstTimeToday) {
    state.days[dayKey] = { litAt: Date.now() }
    state.days = pruneDays(state.days)
    writeState({ version: VERSION, days: state.days })
  }
  return { ...getLamp(dayKey), firstTimeToday }
}

/**
 * 安心木鱼的功德计数（纯本地陪伴，不上云、不上榜）。
 *
 * ⚠️ 2026-09-18 修：这个键此前**只写不读** —— 页面每次进来都从 0 重新数，
 * 用户看到的「功德 N」会莫名归零（而且即时反馈回声里也带着这个数，缺陷更明显）。
 * 读写都收到这里，页面不再出现字面量键名（守卫断言"有写必须有读"）。
 */
const MUYU_KEY = 'wish_muyu_v1'

/** 读取功德计数（任何失败都当 0，绝不抛） */
function readMuyuCount() {
  try {
    if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return 0
    const n = Math.floor(Number(wx.getStorageSync(MUYU_KEY)) || 0)
    return n > 0 ? n : 0
  } catch (e) {
    return 0
  }
}

/** 写入功德计数（返回实际写入值；存储失败也返回该值，界面照常显示本次计数） */
function writeMuyuCount(n) {
  const next = Math.max(0, Math.floor(Number(n) || 0))
  try {
    if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
      wx.setStorageSync(MUYU_KEY, next)
    }
  } catch (e) {
    /* 存档失败不影响计数 */
  }
  return next
}

module.exports = {
  STORAGE_KEY,
  MUYU_KEY,
  KEEP_DAYS,
  LAMP_LINES,
  SOLAR_LINES,
  LAMP_TIER_NOTES,
  readMuyuCount,
  writeMuyuCount,
  readState,
  pruneDays,
  getLamp,
  lightLamp
}
