/**
 * 图鉴翻页（2026-11-22 大幅优化·二）：详页底部「‹ 上一页 / 下一页 ›」，按标本册当前顺序翻。
 *
 * 顺序由图鉴首页在筛选后写进 globalData（同一会话内有效；分享卡片直达时没有顺序 → 不出翻页条）。
 * 不剧透：未点亮的邻页只写「No.012 未记录」，不带名称。
 * 纯函数 + globalData 读写，无 require；守卫在内存里求值。
 * 2026-11-23 加同章小格（rememberAll / chapterOf）：未点亮页只存编号，不存名称与图版。
 */
const KEY = 'atlasPagerOrder'
const ALL_KEY = 'atlasPagerAll'

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

/** 首页：记下整册（同章小格用；未点亮只存编号，不存名称 / 图版） */
function rememberAll(app, cards) {
  if (!app || !app.globalData) return
  app.globalData[ALL_KEY] = (Array.isArray(cards) ? cards : []).map((c) => ({
    id: String(c.id || ''),
    no: String(c.no || ''),
    unlocked: !!c.unlocked,
    label: c.unlocked ? String(c.nameZh || '') : '',
    plate: c.unlocked ? String(c.plate || '') : '',
    seriesIds: Array.isArray(c.seriesIds) ? c.seriesIds.slice() : []
  })).filter((c) => c.id)
}

function readAll(app) {
  const list = app && app.globalData && app.globalData[ALL_KEY]
  return Array.isArray(list) ? list : []
}

/**
 * 同章小格（2026-11-23）：这一页所在的第一章里，各页按编号排；当前页标出。
 * 没有整册数据（分享直达）或不属于任何章 → null（不出）。
 */
function chapterOf(all, card) {
  const sid = card && Array.isArray(card.seriesIds) ? card.seriesIds[0] : ''
  if (!sid) return null
  const items = (Array.isArray(all) ? all : [])
    .filter((c) => c.seriesIds.indexOf(sid) >= 0)
    .sort((a, b) => a.no.localeCompare(b.no, 'en', { numeric: true }))
    .map((c) => Object.assign({}, c, { current: c.id === String(card.id || '') }))
  if (items.length < 2) return null
  return {
    id: sid,
    name: (card.seriesNames && card.seriesNames[0]) || '',
    got: items.filter((c) => c.unlocked).length,
    total: items.length,
    items
  }
}

module.exports = { KEY, ALL_KEY, rememberOrder, readOrder, neighbors, rememberAll, readAll, chapterOf }
