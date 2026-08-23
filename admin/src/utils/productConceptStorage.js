/**
 * 爆品概念 · localStorage 持久化
 */
import { STORAGE_KEY, BRIDGE_KEY } from '../data/productConcept'

const MAX_ITEMS = 80

function safeParse(raw, fallback) {
  try {
    const v = JSON.parse(raw)
    return v ?? fallback
  } catch {
    return fallback
  }
}

export function loadConcepts() {
  if (typeof localStorage === 'undefined') return []
  const list = safeParse(localStorage.getItem(STORAGE_KEY), [])
  return Array.isArray(list) ? list : []
}

export function saveConcepts(list) {
  if (typeof localStorage === 'undefined') return
  const trimmed = (Array.isArray(list) ? list : []).slice(0, MAX_ITEMS)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  return trimmed
}

export function upsertConcept(concept, list = loadConcepts()) {
  if (!concept?.id) return list
  const next = list.filter((c) => c.id !== concept.id)
  next.unshift(concept)
  return saveConcepts(next)
}

export function removeConcept(id, list = loadConcepts()) {
  return saveConcepts(list.filter((c) => c.id !== id))
}

export function toggleFavorite(id, list = loadConcepts()) {
  const next = list.map((c) => (c.id === id ? { ...c, favorite: !c.favorite } : c))
  return saveConcepts(next)
}

/** 带回战略看板的轻量桥接 */
export function markForStrategyBoard(concept) {
  if (typeof localStorage === 'undefined' || !concept) return
  localStorage.setItem(
    BRIDGE_KEY,
    JSON.stringify({
      ...concept,
      bridgedAt: Date.now()
    })
  )
  window.dispatchEvent(new CustomEvent('product-concept-bridged', { detail: concept }))
}

export function peekStrategyBridge() {
  if (typeof localStorage === 'undefined') return null
  return safeParse(localStorage.getItem(BRIDGE_KEY), null)
}

export function clearStrategyBridge() {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(BRIDGE_KEY)
}

export function downloadTextFile(content, filename) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function conceptToMarkdown(c) {
  const points = (c.sellingPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n')
  const channels = Array.isArray(c.channels) ? c.channels.join('、') : (c.channels || '')
  const risks = Array.isArray(c.risks) ? c.risks.map((r, i) => `${i + 1}. ${r}`).join('\n') : (c.risks || '')
  const next = Array.isArray(c.nextActions)
    ? c.nextActions.map((r, i) => `${i + 1}. ${r}`).join('\n')
    : (c.nextActions || '')
  const opts = c.options || {}
  const filterLines = [
    opts.productTypeLabel && `- **定位类型**: ${opts.productTypeLabel}`,
    opts.categoryLabel && `- **产品类别**: ${opts.categoryLabel}`,
    opts.innovationLabel && `- **创新方向**: ${opts.innovationLabel}`,
    opts.channelLabel && `- **渠道场景**: ${opts.channelLabel}`,
    opts.audienceLabel && `- **目标客群筛选项**: ${opts.audienceLabel}`,
    opts.notes && `- **补充约束**: ${opts.notes}`
  ]
    .filter(Boolean)
    .join('\n')

  return `# ${c.name || '未命名概念'}

## 定位与价格
- **品名**: ${c.name || ''}
- **定位**: ${c.position || ''}
- **价格带**: ${c.priceBand || `¥${c.price || ''}`}
- **建议定价**: ¥${c.price || ''}
- **目标毛利率**: ${c.margin || ''}%

## 生成条件
${filterLines || '_（无筛选项快照）_'}

## 目标客群
${c.targetAudience || ''}

## 核心卖点
${points}

## 材质与工艺
${c.materials || ''}

## 渠道建议
${channels}

## 市场策略
${c.strategy || ''}

## 风险提示
${risks}

## 下一步动作
${next}

---
生成时间: ${c.createdAt ? new Date(c.createdAt).toLocaleString('zh-CN') : new Date().toLocaleString('zh-CN')}
`
}
