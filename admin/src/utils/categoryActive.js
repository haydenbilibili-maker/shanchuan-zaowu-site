/**
 * 与小程序 utils/categoryTree.isActiveCategory 对齐：
 * Admin 二级用 active 布尔；种子/店长同步用 status 字符串。
 * 已合并项通常带 status:'inactive' + mergedInto，两端一律不展示。
 */
export function isActiveCategory(c) {
  if (!c) return false
  if (c.mergedInto) return false
  if (c.active === false) return false
  const s = c.status
  return s !== 'inactive' && s !== 'deleted'
}

/** 列表展示用：缺省 active 时按 status 推断开关态 */
export function categorySwitchOn(c) {
  return isActiveCategory(c)
}
