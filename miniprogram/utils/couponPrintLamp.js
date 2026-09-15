/**
 * 代金券打印动效 · 信号灯映射（对齐 docs/signal-lamp.md / app.wxss）
 * 勿另起色板；变体仅 hollow / blink / dim
 */

const { normalizeCouponChannel } = require('./couponHelper')

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
 * 顶杆主灯：状态机 → 类名（深色杆上 success 比 forest 更可读）
 * standby | printing | success | failure
 */
function printPhaseLamp(phase) {
  const p = String(phase || 'standby')
  if (p === 'printing') return `${LAMP.warn} blink`
  if (p === 'success') return `${LAMP.success} on`
  if (p === 'failure') return LAMP.error
  return LAMP.muted
}

/**
 * 渠道副灯（槽顶 / 凭证行共用）
 * store 需到店关注；online 信息态；all 双渠道就绪
 */
function couponChannelLamp(channel) {
  const ch = normalizeCouponChannel(channel)
  if (ch === 'store') return LAMP.warn
  if (ch === 'online') return LAMP.info
  return LAMP.brass
}

/**
 * 有效期副灯：已过期 error；≤7 日 warn 脉冲；其余 success 静（可用）
 */
function couponExpireLamp(expireDate) {
  if (!expireDate) return LAMP.warn
  const raw = String(expireDate).replace(/\./g, '-').trim()
  const t = new Date(raw).getTime()
  if (Number.isNaN(t)) return `${LAMP.warn} blink`
  const days = (t - Date.now()) / (24 * 60 * 60 * 1000)
  if (days < 0) return LAMP.error
  if (days <= 7) return `${LAMP.warn} blink`
  return `${LAMP.success} on`
}

module.exports = {
  LAMP,
  printPhaseLamp,
  couponChannelLamp,
  couponExpireLamp
}
