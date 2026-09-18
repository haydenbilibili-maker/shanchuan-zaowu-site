/**
 * 祈福墙 · 仪式档案云端存储（客户端封装）
 *
 * 解决什么：连续点灯（streak）与木鱼功德（muyuCount）此前**只存本地**
 * （`utils/wishRitual.js` 的 `wx.setStorageSync`），换手机 / 清缓存即丢。
 * 本文件把本地状态推到云函数 `wishRitualProfile`，并在需要时把云端档案与本地合并回来。
 *
 * 三条铁律：
 *   ① **本地仍是权威**：本文件不改写 `wishRitual` 的存储逻辑，只 require 它读写；
 *      点灯/敲木鱼照旧先落本地，云同步是**附加**动作。
 *   ② **失败必须静默降级**：网络失败 / 云函数未部署 / `wx.cloud` 不可用时，
 *      所有导出都不抛异常，返回 `{ ok:false, degraded:true, profile:<本地值> }`，
 *      本地功能（点灯、木鱼、连续天数展示）照常可用 —— 仪式感功能不能因为网络挂了就不能点灯。
 *   ③ **不碰 UI**：这里没有 setData / 弹窗 / 页面引用，页面自行决定何时调用与怎么展示。
 *
 * 合并语义与云函数**完全同源**：都走 `ritualProfileCore.mergeProfiles`
 * （两份副本逐字节相同，由 `miniprogram/scripts/test-ritual-profile.mjs` 比对）。
 *
 * 与 page 的衔接（由 UI 侧接线，本文件只提供函数）：
 *   · 读页面用 `readLocalProfile()` / `snapshotFromState()`；
 *   · 进页面时 `loadFromCloud()`（拉云端 + 回填本地），点灯/敲木鱼后 `syncToCloud()`（可 fire-and-forget）。
 */
'use strict'

const wishRitual = require('./wishRitual')
const { lampStreak } = require('./wishWall')
const core = require('./ritualProfileCore')

/** 云函数名（与 miniprogram/cloudbaserc.json 的登记一致） */
const CLOUD_FN = 'wishRitualProfile'

/**
 * 本地存档 → 档案快照（**纯函数**，可单测）。
 *
 * 两个刻意的口径：
 *   · `streak` 以**最近一个点灯日**为锚点算连续天数，而不是"今天"。
 *     页面展示口径是"今日未点灯则 streak=0"（`wishWall.lampStreak(days, today)`），
 *     但**存云端的档案**要保留"截至最近一次点灯的连续记录"：否则昨天连了 7 天、
 *     今天还没点，同步上去的就是 0，跨设备恢复时会白丢 7 天。
 *   · `streak` 再钳到 `core.STREAK_MAX`（= 本地窗口 KEEP_DAYS）：本地存档最多 30 个
 *     日期键，良构值本就 ≤30；这里钳一次，避免被外部改写的存档把非法值推到服务端。
 *
 * @param {object} state `wishRitual.readState()` 的返回（`{ version, days }`）
 * @param {number} muyuCount `wishRitual.readMuyuCount()` 的返回
 * @returns {{streak:number, lastLitDayKey:string, muyuCount:number}}
 */
function snapshotFromState(state, muyuCount) {
  const days = (state && state.days) || {}
  const keys = Object.keys(days).filter(core.isValidDayKey).sort()
  const lastLitDayKey = keys.length ? keys[keys.length - 1] : ''
  return {
    streak: lastLitDayKey ? Math.min(core.STREAK_MAX, lampStreak(days, lastLitDayKey)) : 0,
    lastLitDayKey,
    muyuCount: Math.max(0, Math.floor(Number(muyuCount) || 0))
  }
}

/** 读本地档案（`wishRitual` 的读法，任何失败都降级为全 0） */
function readLocalProfile() {
  return snapshotFromState(wishRitual.readState(), wishRitual.readMuyuCount())
}

/**
 * 云端档案 → 本地要补写的日期键（**纯函数**，从早到晚排序）。
 *
 * 为什么要"回填"而不是只存一个数字：页面用 `days` 映射算连续天数（`lampStreak`），
 * 云端只有一个聚合值。以 `lastLitDayKey` 为锚、向前铺 `streak` 天，
 * 换手机/清缓存后才能把连续记录**真正恢复**成页面认得的形状。
 *
 * 铺出来的日期是"两端并集的连续段"：`wishRitual.lightLamp` 是幂等的（已有日期不覆盖 litAt），
 * 且每次写入都会 `pruneDays` 只留最近 30 天 → 恢复后 `lampStreak` 不会超过 STREAK_MAX。
 */
function planRestoreDays(profile) {
  const p = profile && typeof profile === 'object' ? profile : {}
  const streak = Math.max(0, Math.min(core.STREAK_MAX, Math.floor(Number(p.streak) || 0)))
  let cursor = core.isValidDayKey(p.lastLitDayKey) ? p.lastLitDayKey : ''
  const out = []
  for (let i = 0; i < streak && cursor; i += 1) {
    out.push(cursor)
    cursor = core.shiftDayKey(cursor, -1)
  }
  return out.reverse()
}

/**
 * 把（已合并的）档案写回本地：功德计数 + 连续点灯日期。
 * 存储失败不影响调用方（`wishRitual` 内部已吞掉异常），返回**写后的真实本地档案**。
 * ⚠️ 调用方应传"合并后的档案"：本函数不做 max 保护，传什么写什么（合并由 mergeProfiles 负责）。
 */
function applyProfileToLocal(profile) {
  const p = profile && typeof profile === 'object' ? profile : {}
  wishRitual.writeMuyuCount(p.muyuCount)
  for (const dayKey of planRestoreDays(p)) {
    try {
      wishRitual.lightLamp(dayKey)
    } catch (e) {
      /* 本地存档失败不影响仪式：下次再恢复 */
    }
  }
  return readLocalProfile()
}

/** 云能力是否可用（开发者工具/未 init 的环境里 `wx.cloud` 可能不存在） */
function canCallCloud() {
  return typeof wx !== 'undefined' && !!wx && !!wx.cloud && typeof wx.cloud.callFunction === 'function'
}

async function callCloud(data) {
  const res = await wx.cloud.callFunction({ name: CLOUD_FN, data })
  return (res && res.result) || {}
}

/**
 * 拉云端档案并与本地合并，把结果回填本地。
 *
 * 合并规则与云函数一致（`core.mergeProfiles`：streak / muyuCount 取大、lastLitDayKey 取更晚）。
 * @returns {Promise<{ok:boolean, degraded:boolean, profile:object, local?:object, remote?:object|null, error?:string}>}
 *   `degraded:true` = 云端不可用，已静默降级；`profile` 始终是**当前可用的本地档案**。
 */
async function loadFromCloud() {
  const local = readLocalProfile()
  if (!canCallCloud()) return { ok: false, degraded: true, profile: local, error: '云能力不可用' }
  try {
    const result = await callCloud({ action: 'get' })
    if (!result || result.success !== true) {
      return { ok: false, degraded: true, profile: local, error: (result && result.msg) || '云端读取失败' }
    }
    const remote = result.profile || core.emptyProfile()
    const merged = core.mergeProfiles(local, remote)
    const profile = applyProfileToLocal(merged)
    return { ok: true, degraded: false, profile, local, remote }
  } catch (e) {
    console.warn('ritualProfile loadFromCloud failed', e)
    return { ok: false, degraded: true, profile: local, error: (e && e.message) || '网络异常' }
  }
}

/**
 * 把本地档案推给云函数（合并写入，服务端幂等）。
 *
 * 服务端可能存着另一台设备更大的值，故用**服务端返回的合并结果**回填本地（同样静默降级）。
 * 调用方可以 `void syncToCloud()`（fire-and-forget）：失败不影响本地任何行为。
 * @returns {Promise<{ok:boolean, degraded:boolean, profile:object, changed?:boolean, code?:string, error?:string}>}
 */
async function syncToCloud() {
  const local = readLocalProfile()
  if (!canCallCloud()) return { ok: false, degraded: true, profile: local, error: '云能力不可用' }
  try {
    const result = await callCloud({
      action: 'sync',
      streak: local.streak,
      lastLitDayKey: local.lastLitDayKey,
      muyuCount: local.muyuCount
    })
    if (!result || result.success !== true) {
      // 服务端拒绝（校验/跳变闸）也按降级处理：本地照常，下一次再试
      return {
        ok: false,
        degraded: true,
        profile: local,
        code: (result && result.code) || 'REJECTED',
        error: (result && result.msg) || '同步被拒'
      }
    }
    const remote = result.profile || core.emptyProfile()
    const profile = applyProfileToLocal(core.mergeProfiles(local, remote))
    return { ok: true, degraded: false, profile, changed: result.changed !== false }
  } catch (e) {
    console.warn('ritualProfile syncToCloud failed', e)
    return { ok: false, degraded: true, profile: local, error: (e && e.message) || '网络异常' }
  }
}

module.exports = {
  CLOUD_FN,
  snapshotFromState,
  readLocalProfile,
  planRestoreDays,
  applyProfileToLocal,
  loadFromCloud,
  syncToCloud
}
