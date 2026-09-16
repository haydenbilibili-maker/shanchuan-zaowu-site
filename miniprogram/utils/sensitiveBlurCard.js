/**
 * 商品卡片「敏感形态模糊」接入辅助
 *
 * 需求 11：敏感商品模糊展示策略需覆盖**全部商品卡片场景**（此前仅 5 处接入，
 * 首页横滑卡、标本师个人页、展陈页、礼赠场景、百科关联藏品、收藏详情、购物车推荐
 * 共 7 个场景直接露出封面）。
 *
 * 为什么需要本模块：每个页面的卡片数据来自不同云函数/集合，字段名不统一
 * （`sensitiveBlur` / `contentWarning` 兼容在 `isSensitiveBlurProduct` 内处理），
 * 但「给每条商品补一个 `sensitiveEnabled` 布尔」这件事是相同的 —— 抽出来避免 7 处复制。
 *
 * 用法（页面数据映射处）：
 *   const { attachSensitiveFlags } = require('.../utils/sensitiveBlurCard')
 *   list = attachSensitiveFlags(list)            // 就地补字段，返回同一数组
 *
 * WXML 侧统一用：
 *   <sensitive-blur-gate enabled="{{item.sensitiveEnabled}}" product-id="{{item._id}}" size="card">
 */

const { isSensitiveBlurProduct } = require('./sensitiveBlur')

/**
 * 给商品数组补 `sensitiveEnabled`（不改动其它字段；无 _id 时用 productId/id 兜底）。
 * @param {Array} list
 * @returns {Array} 同一数组引用（便于链式使用）
 */
function attachSensitiveFlags(list) {
  if (!Array.isArray(list)) return []
  list.forEach((item) => {
    if (!item || typeof item !== 'object') return
    try {
      item.sensitiveEnabled = isSensitiveBlurProduct(item)
    } catch (e) {
      // 判定失败时按「不模糊」处理，避免整页卡片因单条脏数据不渲染
      item.sensitiveEnabled = false
    }
  })
  return list
}

/** 单条商品的判定（用于非数组场景） */
function sensitiveEnabledOf(item) {
  try {
    return isSensitiveBlurProduct(item)
  } catch (e) {
    return false
  }
}

/** 卡片内用于 reveal 绑定的商品 ID（各页面字段名不统一，按优先级取） */
function cardProductId(item) {
  if (!item || typeof item !== 'object') return ''
  return String(item._id || item.productId || item.id || item.relatedProductId || '')
}

module.exports = {
  attachSensitiveFlags,
  sensitiveEnabledOf,
  cardProductId
}
