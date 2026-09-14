/**
 * 订单口径：兑换单不是藏品订单
 *
 * 代金券 / 积分兑换会在 `orders` 写一条 `source: 'exchange'`、`status: 'exchanged'`
 * 的记录，供小程序积分中心「我的兑换」展示。它不属于藏品订单，因此不应进入：
 *   · 订单管理列表（全部订单 Tab）
 *   · 经营驾驶舱「今日订单」兜底统计
 *   · 自定义报表的订单类指标
 *   · 会员画像 / AI 战略分析 的订单样本
 *
 * 小程序侧同口径：`miniprogram/subpackages/business/orders/index.js`（列表查询排除
 * `source: _.neq('exchange')` + 客户端兜底）。
 */

export const EXCHANGE_SOURCE = 'exchange'

export function isExchangeOrder(row) {
  return String((row && row.source) || '').trim() === EXCHANGE_SOURCE
}

/** 过滤掉兑换单；入参为任意订单数组，返回新数组（不改原数组） */
export function excludeExchangeOrders(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => !isExchangeOrder(row))
}

/** 是否计入「藏品订单」口径 */
export function isProductOrder(row) {
  return !!row && !isExchangeOrder(row)
}
