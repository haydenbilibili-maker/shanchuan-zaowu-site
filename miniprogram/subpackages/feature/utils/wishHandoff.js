/**
 * 「写成心愿」的**跨页交接**（玩法页 → 祈福墙页）—— PRD v1.4 §11.4 的"动线不能断"。
 *
 * 为什么需要它：玩法从"本页弹层"搬到**独立页**后，写愿输入框仍留在祈福墙页。
 * 用户点「写成心愿」时必须把心愿词带回去，且**四种返回情形都不能丢**：
 *   ① 正常 `navigateBack`（上一页就是祈福墙）→ 祈福墙 `onShow` 取走；
 *   ② 返回时祈福墙已被系统回收/被 `redirectTo` 换掉 → 仍靠这份存档在下次进墙时取走；
 *   ③ 玩法页是直接进入的（页面栈只有它一层）→ 玩法页改用 `reLaunch` 回墙，仍能取走；
 *   ④ 用户在玩法页直接杀掉小程序 → 存档留在本地，**5 分钟内**再进墙照样带出来。
 *
 * 两条刻意的约束：
 *   · **一次性**：`take()` 读到即删 —— 否则这句心愿会在之后每次进墙时被反复预填（很吓人）；
 *   · **有时效**：超过 `MAX_AGE_MS` 的存档视为"用户早就忘了这件事"，直接丢弃。
 *
 * 只走本地存储（同 `wishRitual` / `ritualPlayArchive` 的口径）：写愿本身才写云，交接不写云。
 * 任何存储失败都降级为"没有交接"（页面照常可用，用户手打一遍即可），绝不抛。
 */

const STORAGE_KEY = 'shanhai_wish_handoff_v1'
/** 存档有效期：5 分钟。超过就当用户已经离开这件事，不再预填 */
const MAX_AGE_MS = 5 * 60 * 1000

function hasStorage() {
  return typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function'
}

/** 写一份交接（draft / echo 都可空；全空则不写，避免留一条空存档把输入框清空） */
function stash(payload) {
  const p = payload || {}
  const draft = String(p.draft || '')
  const echo = String(p.echo || '')
  if (!draft && !echo) return false
  try {
    if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return false
    wx.setStorageSync(STORAGE_KEY, { draft, echo, at: Date.now() })
    return true
  } catch (e) {
    console.warn('wishHandoff stash', e)
    return false
  }
}

/**
 * 取走交接（读到即删）。
 * @param {number} [nowMs] 便于单测注入"现在"；缺省用 Date.now()
 * @returns {{draft:string, echo:string}|null}
 */
function take(nowMs) {
  if (!hasStorage()) return null
  let raw = null
  try {
    raw = wx.getStorageSync(STORAGE_KEY)
  } catch (e) {
    console.warn('wishHandoff take', e)
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  // 先删再判时效：过期的存档没有留着的理由（否则它会一直躺在本地）
  try {
    if (typeof wx.removeStorageSync === 'function') wx.removeStorageSync(STORAGE_KEY)
  } catch (e) {
    console.warn('wishHandoff clear', e)
  }
  const now = Number(nowMs)
  const at = Number(raw.at) || 0
  const expired = at > 0 && (Number.isFinite(now) ? now : Date.now()) - at > MAX_AGE_MS
  if (expired) return null
  return { draft: String(raw.draft || ''), echo: String(raw.echo || '') }
}

/** 丢弃存档（测试与"用户已重置"路径用） */
function clear() {
  try {
    if (hasStorage() && typeof wx.removeStorageSync === 'function') wx.removeStorageSync(STORAGE_KEY)
  } catch (e) {
    console.warn('wishHandoff clear', e)
  }
}

module.exports = {
  STORAGE_KEY,
  MAX_AGE_MS,
  stash,
  take,
  clear
}
