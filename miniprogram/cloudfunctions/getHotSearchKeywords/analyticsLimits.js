/**
 * 埋点 / 行为报表的**采样上限单一真源（云函数侧）**
 *
 * 为什么需要（#26 审计余项）：ERP 侧已收敛到 `admin/src/utils/analyticsLimits.js`，
 * 但**云函数侧仍各自就地写数字**，于是同一个指标出现两个答案：
 *   - `getAnalyticsDashboard.loadDailyRollup` 硬编码 `limit(500)`，ERP 是 1000
 *   - `getHotSearchKeywords` 读 `user_behaviors` **完全没写 limit** → 落服务端默认 100 条，
 *     而 ERP `SearchKeywordsManager` 用 2000 条采样 → 同一「热门搜索」两个口径，
 *     且云函数侧是**静默截断**（没人看得出来）
 *   - `manageMemberCrm` 的 `FETCH_CAP = 1000` 就地写死
 *
 * 约定：
 *   1. 云函数读取 `analytics_daily` / `user_behaviors` 时必须引用本文件的常量，
 *      不得就地写数字，也不得**省略 limit**（省略 = 服务端默认 100，属静默截断）。
 *   2. 与 ERP 同名常量（`DAILY_ROLLUP_LIMIT` / `BEHAVIOR_SAMPLE_LIMIT` /
 *      `BEHAVIOR_PULSE_LIMIT` / `KEYWORD_SAMPLE_LIMIT`）的值必须**逐字相等**，
 *      由 `admin/scripts/check-analytics-limits.mjs` 强制校验 —— 这是「同一指标跨页一致」的锁。
 *   3. 云函数专有的扫描上限（订单/藏品/定金/提成/用户/错误日志）只在本文件定义，
 *      ERP 不读这些集合做聚合比较，故无需同名。
 *
 * 跨目录约束：云函数之间不能相互 require，故本文件按仓库惯例**逐函数留副本**，
 * 由 `miniprogram/scripts/sync-analytics-limits.sh` 同步、`--check` 守卫。
 */

/* ------------------ 与 ERP 同名同值（跨页口径一致） ------------------ */

/** 日汇总 `analytics_daily` 单次读取上限（按日期键聚合后行数很少） */
const DAILY_ROLLUP_LIMIT = 1000

/** `user_behaviors` 用于**聚合指标**时的取样上限 */
const BEHAVIOR_SAMPLE_LIMIT = 4000

/** `user_behaviors` 用于**近实时/轻量脉冲**时的取样上限 */
const BEHAVIOR_PULSE_LIMIT = 1000

/** 关键词类分析（搜索热度）取样上限 */
const KEYWORD_SAMPLE_LIMIT = 2000

/* ------------------ 云函数专有扫描上限 ------------------ */

/** 订单明细扫描上限（营收/品类聚合） */
const ORDER_SCAN_MAX = 4000
/** 藏品扫描上限 */
const PRODUCT_SCAN_MAX = 3000
/** 定金意向扫描上限 */
const DEPOSIT_SCAN_MAX = 1500
/** 提成流水扫描上限 */
const COMMISSION_SCAN_MAX = 1500
/** 新增用户扫描上限 */
const USER_SCAN_MAX = 3000
/** C 端错误日志扫描上限 */
const ERROR_SCAN_MAX = 2000
/** 会员 CRM（RFM/分群）拉取上限 */
const CRM_FETCH_CAP = 1000

/* ------------------ 辅助 ------------------ */

/**
 * 触顶时的采样说明；未触顶返回空串（表示全量）。
 * 与 ERP `describeSample` 同口径，避免两端文案不一致。
 */
function describeSample(actual, limit, unit = '条') {
  const n = Number(actual) || 0
  const cap = Number(limit) || 0
  if (!cap || n < cap) return ''
  return `已采样最近 ${cap} ${unit}，非全量`
}

module.exports = {
  DAILY_ROLLUP_LIMIT,
  BEHAVIOR_SAMPLE_LIMIT,
  BEHAVIOR_PULSE_LIMIT,
  KEYWORD_SAMPLE_LIMIT,
  ORDER_SCAN_MAX,
  PRODUCT_SCAN_MAX,
  DEPOSIT_SCAN_MAX,
  COMMISSION_SCAN_MAX,
  USER_SCAN_MAX,
  ERROR_SCAN_MAX,
  CRM_FETCH_CAP,
  describeSample
}
