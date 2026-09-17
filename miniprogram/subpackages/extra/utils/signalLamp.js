/**
 * 全局信号灯语义（Museum Mode）
 * 视觉类名以 app.wxss 为准：.signal-light / .lamp + lamp-* 修饰
 *
 * 色板：
 *   success #52B788 · warn #E9A23B · error #D64045
 *   info #5B8FB9 · brass #C4A76C · forest #2D5A3F · muted #6B6560
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

/** 与历史 .signal-light 修饰兼容（投资人/通行码/直播已在用） */
const SIGNAL = {
  successPulse: 'blink',
  successStatic: 'on',
  warn: 'warn',
  warnPulse: 'warn blink',
  error: 'danger',
  errorPulse: 'danger blink',
  live: 'live blink',
  liveStatic: 'live',
  muted: ''
}

function hollow(cls) {
  const base = String(cls || '').trim()
  return base ? `${base} hollow` : 'lamp-muted hollow'
}

/** 待办计数：0 绿静；≥warnAt 黄；≥errorAt 红 */
function countLamp(n, opts) {
  const v = Number(n) || 0
  const warnAt = (opts && opts.warnAt != null) ? opts.warnAt : 1
  const errorAt = (opts && opts.errorAt != null) ? opts.errorAt : Infinity
  if (v >= errorAt) return SIGNAL.errorPulse
  if (v >= warnAt) return SIGNAL.warn
  return SIGNAL.successStatic
}

/** 健康计数：0 绿；≥warnAt 黄；≥errorAt 红（库存/退款等同口径） */
function healthLamp(n, opts) {
  const v = Number(n) || 0
  const warnAt = (opts && opts.warnAt != null) ? opts.warnAt : 1
  const errorAt = (opts && opts.errorAt != null) ? opts.errorAt : 8
  if (v <= 0) return SIGNAL.successPulse
  if (v >= errorAt) return SIGNAL.errorPulse
  if (v >= warnAt) return SIGNAL.warnPulse
  return SIGNAL.successPulse
}

/** 履约在途：有单绿静，无单灰（偏高不告警） */
function fulfillmentLamp(n) {
  return (Number(n) || 0) > 0 ? SIGNAL.successStatic : LAMP.muted
}

/** 已签收存量：有单 forest，无单灰 */
function receivedLamp(n) {
  return (Number(n) || 0) > 0 ? LAMP.forest : LAMP.muted
}

/**
 * 退款存量占比灯（对齐投资人：≥8% 黄 / ≥15% 红）
 * rate = refunded / (received + refunded)
 */
function refundStockLamp(refunded, received) {
  const r = Number(refunded) || 0
  const base = (Number(received) || 0) + r
  if (base <= 0) return SIGNAL.successStatic
  const rate = r / base
  if (rate >= 0.15) return SIGNAL.errorPulse
  if (rate >= 0.08) return SIGNAL.warn
  return SIGNAL.successStatic
}

function momLamp(momClass) {
  const c = String(momClass || 'flat')
  if (c === 'up') return SIGNAL.successPulse
  if (c === 'down') return SIGNAL.error
  return LAMP.muted
}

function stockReadyLamp(dash) {
  if (!dash) return LAMP.muted
  if (dash.error) return SIGNAL.error
  if (dash.loading && !dash.ready) return LAMP.muted
  if (dash.empty) return LAMP.muted
  const low = Number(dash.lowStockSkus) || 0
  if (low > 0) return healthLamp(low, { warnAt: 1, errorAt: 8 })
  if ((Number(dash.onShelf) || 0) <= 0) return SIGNAL.warn
  return SIGNAL.successPulse
}

function verifyResultLamp(ok) {
  return ok ? SIGNAL.successPulse : SIGNAL.error
}

function liveStatusLamp(tone, label) {
  const t = String(tone || '')
  const l = String(label || '')
  if (t === 'live') return SIGNAL.live
  if (t === 'warn') return SIGNAL.warnPulse
  if (l.indexOf('待开播') >= 0) return LAMP.brass
  if (l.indexOf('结束') >= 0) return LAMP.muted
  return LAMP.muted
}

function liveReadyLamp(ok) {
  return ok ? SIGNAL.successStatic : SIGNAL.warn
}

function permissionStatusLamp(status) {
  return status === 'active' ? LAMP.forest : hollow(LAMP.muted)
}

function payslipPresenceLamp(hasRows) {
  return hasRows ? LAMP.forest : LAMP.muted
}

function dayDiff(a, b) {
  const da = String(a || '').slice(0, 10)
  const db = String(b || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(da) || !/^\d{4}-\d{2}-\d{2}$/.test(db)) return null
  const ta = new Date(`${da}T12:00:00`).getTime()
  const tb = new Date(`${db}T12:00:00`).getTime()
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null
  return Math.round((tb - ta) / 86400000)
}

/**
 * 财务月报 · 账本同步信号灯（对齐 docs/signal-lamp.md）
 * 替代居中 toast「账本至 xx，Web端请同步云端」
 *
 * @param {{
 *   empty?: boolean,
 *   cloudError?: boolean,
 *   latestDate?: string,
 *   endDate?: string,
 *   yearMonth?: string,
 *   currentYearMonth?: string,
 * }} opts
 * @returns {{ lampClass: string, tip: string, tone: 'success'|'warn'|'error'|'forest'|'muted' }}
 */
function ledgerSyncLamp(opts) {
  const o = opts || {}
  if (o.cloudError) {
    return {
      lampClass: `${LAMP.warn} blink`,
      tip: '云端合并失败，已显示本地账本',
      tone: 'warn',
    }
  }
  if (o.empty) {
    return {
      lampClass: LAMP.muted,
      tip: '本月暂无日流水',
      tone: 'muted',
    }
  }
  const latest = String(o.latestDate || '').slice(0, 10)
  const end = String(o.endDate || '').slice(0, 10)
  const ym = String(o.yearMonth || '').slice(0, 7)
  const curYm = String(o.currentYearMonth || '').slice(0, 7)
  const md = latest.length >= 10 ? latest.slice(5) : latest

  if (!latest) {
    return {
      lampClass: LAMP.muted,
      tip: '账本日期未知',
      tone: 'muted',
    }
  }

  const isCurrent = ym && curYm && ym === curYm
  if (!isCurrent) {
    return {
      lampClass: LAMP.forest,
      tip: `账本至 ${md}（历史月）`,
      tone: 'forest',
    }
  }

  const lag = dayDiff(latest, end)
  if (lag == null || lag <= 0) {
    return {
      lampClass: `${LAMP.success} on`,
      tip: `账本至 ${md} · 已对齐`,
      tone: 'success',
    }
  }
  if (lag >= 3) {
    return {
      lampClass: `${LAMP.error} blink`,
      tip: `账本至 ${md} · 滞后 ${lag} 天，Web 端请同步云端`,
      tone: 'error',
    }
  }
  return {
    lampClass: `${LAMP.warn} blink`,
    tip: `账本至 ${md} · Web 端请同步云端`,
    tone: 'warn',
  }
}

module.exports = {
  LAMP,
  SIGNAL,
  hollow,
  countLamp,
  healthLamp,
  fulfillmentLamp,
  receivedLamp,
  refundStockLamp,
  momLamp,
  stockReadyLamp,
  verifyResultLamp,
  liveStatusLamp,
  liveReadyLamp,
  permissionStatusLamp,
  payslipPresenceLamp,
  ledgerSyncLamp,
}
