/**
 * 内容工厂 · 指标聚合（供 ContentReview / retrospect）
 * 装配范式参考 AIStrategicBrain + BehaviorAnalytics 多源摘要
 */

/** @returns {string} 如 2026-W27 */
export function currentContentPeriod(date = new Date()) {
  const d = new Date(date)
  const year = d.getFullYear()
  const onejan = new Date(year, 0, 1)
  const week = Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}

const num = (v) => Number(v) || 0

/**
 * 聚合 content_pieces.metrics
 * @param {object[]} pieces
 * @param {object|null} [behaviorSnippet] - 可选 C 端行为摘要
 */
export function assembleContentMetrics(pieces = [], behaviorSnippet = null) {
  const published = pieces.filter((p) => p.state === 'published')
  const scheduled = pieces.filter((p) => ['published', 'scheduled', 'approved'].includes(p.state))

  const sumMetric = (key, list = published) =>
    list.reduce((s, p) => s + num(p.metrics?.[key]), 0)

  const avgMetric = (key, list = published) => {
    const vals = list.map((p) => num(p.metrics?.[key])).filter((n) => n > 0)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  }

  const byPlatform = {}
  published.forEach((p) => {
    const pl = p.platform || 'other'
    if (!byPlatform[pl]) {
      byPlatform[pl] = { count: 0, views: 0, 收藏: 0, 引流私域: 0 }
    }
    byPlatform[pl].count += 1
    byPlatform[pl].views += num(p.metrics?.views)
    byPlatform[pl].收藏 += num(p.metrics?.收藏)
    byPlatform[pl].引流私域 += num(p.metrics?.引流私域)
  })

  const byIp = { GRAVITY: 0, LIGHTNESS: 0, other: 0 }
  published.forEach((p) => {
    const k = p.ip === 'LIGHTNESS' ? 'LIGHTNESS' : p.ip === 'GRAVITY' ? 'GRAVITY' : 'other'
    byIp[k] += num(p.metrics?.views)
  })

  const topPieces = [...published]
    .sort((a, b) => num(b.metrics?.views) - num(a.metrics?.views))
    .slice(0, 15)
    .map((p) => ({
      _id: p._id,
      title: p.title,
      platform: p.platform,
      ip: p.ip,
      publishedAt: p.publishMeta?.publishedAt,
      views: num(p.metrics?.views),
      完播率: num(p.metrics?.完播率),
      收藏: num(p.metrics?.收藏),
      评论具体句: num(p.metrics?.评论具体句),
      引流私域: num(p.metrics?.引流私域),
    }))

  const trendByDate = {}
  published.forEach((p) => {
    const ts = p.publishMeta?.publishedAt || p.updatedAt
    if (!ts) return
    const dk = new Date(ts).toISOString().slice(0, 10)
    if (!trendByDate[dk]) trendByDate[dk] = { views: 0, count: 0 }
    trendByDate[dk].views += num(p.metrics?.views)
    trendByDate[dk].count += 1
  })

  return {
    period: currentContentPeriod(),
    publishedCount: published.length,
    pipelineCount: scheduled.length,
    totalViews: sumMetric('views'),
    total收藏: sumMetric('收藏'),
    total评论具体句: sumMetric('评论具体句'),
    total引流私域: sumMetric('引流私域'),
    avg完播率: Number(avgMetric('完播率').toFixed(2)),
    byPlatform,
    byIp,
    topPieces,
    trendByDate,
    behaviorSnippet,
    samples: topPieces.slice(0, 8),
  }
}

/** 轻量拉取 C 端行为摘要（经 getAnalyticsDashboard，避免 CDN 直读 analytics_daily） */
export async function fetchBehaviorSnippet(_getCdnDatabaseUnused) {
  try {
    const { callCdnFunction } = await import('./cloudbaseCdnDb.js')
    const res = await callCdnFunction('getAnalyticsDashboard', {
      action: 'behaviorSnippet',
      days: 7,
    })
    if (res && res.success === false) return null
    const data = res?.data || res
    if (!data || typeof data !== 'object') return null
    return {
      range: data.range || '',
      totalEvents: Number(data.totalEvents) || 0,
      uv: Number(data.uv) || 0,
      note: data.note || '小程序行为埋点摘要，辅助内容复盘',
    }
  } catch {
    return null
  }
}

export const PLATFORM_CHART_COLORS = {
  xhs: '#ff2442',
  douyin: '#1a1a1a',
  shipinhao: '#07c160',
  bilibili: '#00a1d6',
  other: '#909399',
}
