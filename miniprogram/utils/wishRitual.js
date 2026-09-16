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
 */
const LAMP_LINES = [
  '把想成真的写下来，风会替你带一段路。',
  '灯亮着，就还有没说完的心愿。',
  '不必将就今日，来日自会有一匹好马。',
  '一盏灯照一行字，一行字抵一次远行。',
  '愿你所求的都具体，所指的都抵达。',
  '先把心愿放下，余下的交给时间。',
  '夜里点灯的人，白天总有去处。',
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
  spring: '春气一动，草木总比人先知道。',
  summer: '天长，慢慢来也来得及。',
  autumn: '收成不必满仓，够用就好。',
  winter: '天冷了，先把灯留着。'
}

/**
 * 灯位文案：连续点灯到第 3 / 7 天时那句反馈。
 * 与 `utils/wishWall.lampTier` 的 tier 一一对应（1 初见 / 2 守夜 / 3 长明）。
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

module.exports = {
  STORAGE_KEY,
  KEEP_DAYS,
  LAMP_LINES,
  SOLAR_LINES,
  LAMP_TIER_NOTES,
  readState,
  pruneDays,
  getLamp,
  lightLamp
}
