/**
 * 专题档案页阅读计数（新增旁路，2026-10-01 A 流第 5 轮）
 *
 * 为什么是新函数：`getWikiData.get_detail` 的 `stats` 写死 `{ views: 0, likes: 0 }`，
 * 现有埋点 `user_behaviors.page_view` 只带页面路径、不带专题 id，无法按专题归因；
 * 不改 getWikiData 的契约，阅读计数单独走本函数。
 *
 * 集合：`wiki_stats`（计数）、`wiki_view_marks`（防刷标记）—— 规则均为仅云函数可读写，
 *   见 cloudbase/rules/、cloudbase/schema/ 同名文件。
 * 归属只取 `cloud.getWXContext().OPENID`，不接受 event 里的 openid。
 * 逻辑与防刷窗口见 viewStatsCore.js。
 */
const cloud = require('wx-server-sdk')
const { handle } = require('./viewStatsCore')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  try {
    return await handle(event, { db, _, openid: OPENID || '', now: Date.now(), serverDate: db.serverDate() })
  } catch (e) {
    console.error('wikiViewStats', e)
    return { success: false, code: 'INTERNAL', msg: (e && e.message) || '计数失败' }
  }
}
