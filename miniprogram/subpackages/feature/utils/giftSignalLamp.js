/**
 * 礼赠人情账本 · 信号灯映射（对齐 docs/signal-lamp.md / app.wxss）
 * 勿另起色板；变体仅 hollow / blink / dim
 */

const LAMP = {
  success: 'lamp-success',
  warn: 'lamp-warn',
  error: 'lamp-error',
  info: 'lamp-info',
  brass: 'lamp-brass',
  forest: 'lamp-forest',
  muted: 'lamp-muted'
}

/**
 * 往来订单进度 → 信号灯类
 * @param {{ progressKey?: string, todo?: boolean, attention?: boolean, expireUrgent?: boolean }} item
 */
function giftFlowSignal(item) {
  const key = String((item && item.progressKey) || '')
  const urgent = !!(item && item.expireUrgent)

  if (key === 'refunded') return `${LAMP.error} dim`
  if (key === 'cancelled') return `${LAMP.muted} hollow`
  if (key === 'done') return LAMP.forest

  if (urgent) return `${LAMP.warn} blink`

  if (key === 'pending_pay') return LAMP.warn
  if (key === 'awaiting_address') return LAMP.warn
  if (key === 'awaiting_open') return LAMP.brass
  if (key === 'pickup_verify') return LAMP.brass
  if (key === 'shipping') return LAMP.info
  if (key === 'awaiting_ship') return LAMP.info

  if (item && item.todo) return LAMP.warn
  if (item && item.attention) return LAMP.brass
  return LAMP.muted
}

/**
 * 日子临近 → 信号灯类
 * urgency: hot | near | idle
 */
function giftDateSignal(urgency) {
  const u = String(urgency || '')
  if (u === 'hot') return `${LAMP.warn} blink`
  if (u === 'near') return LAMP.brass
  return `${LAMP.muted} hollow`
}

/** 页头摘要角灯：有待办黄；仅临近日子黄铜；皆无灰空心 */
function giftLedgerHeadSignal({ flowBadge, upcomingHotCount }) {
  const flow = Number(flowBadge) || 0
  const hot = Number(upcomingHotCount) || 0
  if (flow > 0) return LAMP.warn
  if (hot > 0) return LAMP.brass
  return `${LAMP.muted} hollow`
}

/** 日子分区头角灯：7 日内 warn 脉冲；30 日内 brass；否则灰空心 */
function giftDatesPaneSignal({ upcomingHotCount, upcomingCount }) {
  const hot = Number(upcomingHotCount) || 0
  const near = Number(upcomingCount) || 0
  if (hot > 0) return `${LAMP.warn} blink`
  if (near > 0) return LAMP.brass
  return `${LAMP.muted} hollow`
}

module.exports = {
  LAMP,
  giftFlowSignal,
  giftDateSignal,
  giftLedgerHeadSignal,
  giftDatesPaneSignal
}
