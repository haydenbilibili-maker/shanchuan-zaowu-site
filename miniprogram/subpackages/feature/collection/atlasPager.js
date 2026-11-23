/**
 * 图鉴翻页（2026-11-22 大幅优化·二）：详页底部「‹ 上一页 / 下一页 ›」，按标本册当前顺序翻。
 *
 * 顺序由图鉴首页在筛选后写进 globalData（同一会话内有效；分享卡片直达时没有顺序 → 不出翻页条）。
 * 不剧透：未点亮的邻页只写「No.012 未记录」，不带名称。
 * 纯函数 + 一个 globalData 读写，无 require；守卫在内存里求值。
 */
const KEY = 'atlasPagerOrder'

/** 首页：记下当前标本册顺序（只存翻页需要的字段） */
function rememberOrder(app, cards) {
  if (!app || !app.globalData) return
  app.globalData[KEY] = (Array.isArray(cards) ? cards : []).map((c) => ({
    id: String(c.id || ''),
    no: String(c.no || ''),
    label: c.unlocked ? String(c.nameZh || '') : '未记录'
  })).filter((c) => c.id)
}

function readOrder(app) {
  const list = app && app.globalData && app.globalData[KEY]
  return Array.isArray(list) ? list : []
}

/** 详页：当前 id 的上一页 / 下一页（到头为 null；不在顺序里 → 都为 null） */
function neighbors(order, id) {
  const list = Array.isArray(order) ? order : []
  const i = list.findIndex((c) => c.id === String(id || ''))
  if (i < 0) return { prev: null, next: null, pos: '' }
  return {
    prev: i > 0 ? list[i - 1] : null,
    next: i < list.length - 1 ? list[i + 1] : null,
    pos: `${i + 1} / ${list.length}`
  }
}

module.exports = { KEY, rememberOrder, readOrder, neighbors }
