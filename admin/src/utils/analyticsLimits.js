/**
 * 埋点 / 行为报表的**采样上限单一真源**
 *
 * 为什么需要（2026-09-16 审计）：同一指标在不同页面的取样上限互不一致，导致
 * 「同一时间范围、不同页面对不上」——这是最难解释的一类报表问题：
 *   - `Dashboard.vue:842`  analytics_daily 200
 *   - `Dashboard.vue:852`  user_behaviors 500
 *   - `Dashboard.vue:1237` user_behaviors 1000
 *   - `BehaviorAnalytics.vue` analytics_daily 1000 / user_behaviors 1000
 *   - `RealtimeMonitor.vue` analytics_daily 200 / user_behaviors 5000
 *   - `SearchKeywordsManager.vue` user_behaviors 2000 ×2
 *   - 云函数 `getAnalyticsDashboard` BEHAVIOR_SAMPLE 4000 / daily 500
 *
 * 约定：
 *   1. 需要「聚合口径一致」的场景一律引用本文件的常量，不要就地写数字。
 *   2. 任何**近似**口径都必须在 UI 上标注采样（`describeSample`），
 *      禁止把采样值当全量展示 —— 仓库已有 METRIC_DIVERGENCES 机制承担同责。
 */

/** 日汇总（analytics_daily）单次读取上限：按日聚合后行数很少，够用即可 */
export const DAILY_ROLLUP_LIMIT = 1000

/** 行为明细（user_behaviors）用于**聚合指标**时的取样上限 */
export const BEHAVIOR_SAMPLE_LIMIT = 4000

/** 行为明细用于**轻量脉冲/近实时**展示时的取样上限（成本更敏感） */
export const BEHAVIOR_PULSE_LIMIT = 1000

/** 关键词类分析取样上限（单 action 维度） */
export const KEYWORD_SAMPLE_LIMIT = 2000

/**
 * 「数据报表增强」（模块 21）自定义报表的**逐单读取上限**。
 *
 * 该模块需要逐单 costPrice 才能算自定义分组的利润/成本，故无法改用聚合接口
 * （`getAnalyticsDashboard` 只给不区分分组的聚合）。它在客户端**全量分页**读取，
 * 上限即「超出即截断」——这是营收被截断的真实风险点。
 *
 * 与权威口径的分歧（营收/订单数）：权威是 `getAnalyticsDashboard`（服务端全量聚合）。
 * 本模块的读取上限触发时，其营收会**低于**权威值。已登记进 METRIC_DIVERGENCES。
 */
export const REPORT_ORDER_LIMIT = 1000
export const REPORT_USER_LIMIT = 1000
export const REPORT_PRODUCT_LIMIT = 1000

/**
 * 说明「逐单读取是否可能被上限截断」。
 * @param {number} actual 实际读到的行数
 * @param {number} limit 上限
 * @returns {string} 触顶时的提示语；未触顶返回空串
 */
export function describeTruncation(actual, limit, unit = '条') {
  const n = Number(actual) || 0
  const cap = Number(limit) || 0
  if (!cap || n < cap) return ''
  return `已读取上限 ${cap} ${unit}，可能未覆盖全部数据（自定义报表为逐单读取，与权威口径可能有差）`
}

/** 生成采样说明文案；未触达上限时返回空串（表示全量） */
export function describeSample(actual, limit, unit = '条') {
  const n = Number(actual) || 0
  const cap = Number(limit) || 0
  if (!cap || n < cap) return ''
  return `已采样最近 ${cap} ${unit}，非全量`
}

/** 判断是否触达采样上限（用于在 UI 打「近似」标记） */
export function isSampled(actual, limit) {
  const n = Number(actual) || 0
  const cap = Number(limit) || 0
  return !!cap && n >= cap
}
