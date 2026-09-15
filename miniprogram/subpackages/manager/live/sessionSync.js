const STORAGE_KEY = 'live_studio_snapshot_v1'
const TTL_MS = 3 * 60 * 1000

function shelfItemsOf(session) {
  if (session && session.shelf && Array.isArray(session.shelf.items)) return session.shelf.items
  return []
}

function snapshotFromSession(session, extra) {
  const extras = extra || {}
  const stats = (session && session.stats) || {}
  const items = shelfItemsOf(session)
  return {
    at: Date.now(),
    sessionId: (session && session._id) || extras.sessionId || '',
    status: (session && session.status) || extras.status || '',
    title: (session && session.title) || extras.title || '',
    notice: (session && session.notice) || extras.notice || '',
    viewerCount: Math.max(0, Number((session && session.viewerCount) || extras.viewerCount) || 0),
    likeCount: Math.max(0, Number(stats.likeCount || (session && session.likeCount) || extras.likeCount) || 0),
    messageCount: Math.max(0, Number(stats.messageCount || extras.messageCount) || 0),
    peakViewers: Math.max(0, Number(stats.peakViewers || extras.peakViewers) || 0),
    joinCount: Math.max(0, Number(stats.joinCount || extras.joinCount) || 0),
    reminderCount: Math.max(0, Number(stats.reminderCount || extras.reminderCount) || 0),
    shelfCount: items.length || Math.max(0, Number((session && session.shelfCount) || extras.shelfCount) || 0),
    shelfItems: items,
    configured: extras.configured,
    enabled: extras.enabled
  }
}

function writeLiveSnapshot(session, extra) {
  try {
    wx.setStorageSync(STORAGE_KEY, snapshotFromSession(session, extra))
  } catch (e) { /* ignore */ }
}

function readLiveSnapshot() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY)
    if (!raw || !raw.at) return null
    if (Date.now() - Number(raw.at) > TTL_MS) return null
    return raw
  } catch (e) {
    return null
  }
}

function decorateShelfItem(item, index, total) {
  if (!item) return null
  const cover = item.cover || ''
  const price = Number(item.price)
  const missingCover = item.missingCover != null ? !!item.missingCover : !cover
  const missingPrice = item.missingPrice != null ? !!item.missingPrice : !(Number.isFinite(price) && price > 0)
  const onShelf = item.onShelf !== false
  const warnParts = []
  if (missingCover) warnParts.push('缺图')
  if (missingPrice) warnParts.push('缺价')
  if (item.soldOut) warnParts.push('售罄')
  if (!onShelf) warnParts.push('已下架')
  return {
    ...item,
    missingCover,
    missingPrice,
    onShelf,
    priceLabel: item.priceLabel || (missingPrice ? '价格待核' : `¥${item.price}${item.hasSku ? ' 起' : ''}`),
    warnText: warnParts.join(' · '),
    canMoveUp: index > 0,
    canMoveDown: index < total - 1
  }
}

function decorateShelfList(items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : []
  return list.map((item, i) => decorateShelfItem(item, i, list.length))
}

function buildTalkSegments(session, notice, shelfItems) {
  const items = Array.isArray(shelfItems) ? shelfItems : shelfItemsOf(session)
  const segs = []
  const open = String(notice || (session && session.notice) || '').trim()
  const title = (session && session.title) || ''
  segs.push({
    key: 'open',
    heading: '开场',
    body: open || (title ? `欢迎来到「${title}」` : '先写一句开场公告')
  })
  items.forEach((item, i) => {
    const lines = []
    lines.push(((item && item.title) || '未命名藏品').trim())
    if (item && item.latinName) lines.push(item.latinName)
    if (item && item.missingPrice) lines.push('价格待核对后再报')
    else if (item) lines.push(item.priceLabel || `¥${item.price}`)
    if (item && item.soldOut) lines.push('库存已尽，可引导看下一件')
    if (item && item.onShelf === false) lines.push('藏品已下架，观众端不可购')
    if (item && item.missingCover) lines.push('缺主图，挂车封面会空')
    if (item && item.spotlight) lines.push('当前讲解中')
    segs.push({
      key: (item && item._id) || `item-${i}`,
      heading: `${i + 1}. ${((item && item.title) || '未命名藏品').trim()}`,
      body: lines.join('\n'),
      spotlight: !!(item && item.spotlight)
    })
  })
  if (items.length) {
    segs.push({
      key: 'close',
      heading: '收束',
      body: '挂车可加购；养护与证书可在详情页查看。'
    })
  }
  return segs
}

function talkTextFromSegments(segments) {
  return (segments || []).map((s) => `【${s.heading}】\n${s.body}`).join('\n\n')
}

module.exports = {
  writeLiveSnapshot,
  readLiveSnapshot,
  snapshotFromSession,
  decorateShelfList,
  buildTalkSegments,
  talkTextFromSegments
}
