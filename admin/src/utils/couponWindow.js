/**
 * 券模板「领取 / 使用时间窗」与「固定到期日」的时刻换算（营销中心 · 优惠券表单）
 *
 * 表单里填的是**北京时间墙钟**（YYYY-MM-DD HH:mm:ss），存库的是绝对时刻（Date）。
 * 换算一律显式带 +08:00，不依赖运营电脑的时区；云函数运行在 UTC，按绝对时刻比较。
 * 字段：startTime / endTime（领取窗）、fixedExpireTime（领到的券统一在此刻失效）。
 * 与 receiveCoupon 的口径：有 fixedExpireTime 时用户券到期 = 它与「领取后 expireDays 天」的较早者。
 */
const BJ_OFFSET_MS = 8 * 60 * 60 * 1000
const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/

/** 库里的时刻 → Date；Date / 毫秒 / ISO / {$date} 均可，解析不了返回 null */
export function toInstant(raw) {
  if (raw == null || raw === '') return null
  const v = typeof raw === 'object' && !(raw instanceof Date) && raw.$date != null ? raw.$date : raw
  const d = v instanceof Date ? new Date(v.getTime()) : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 北京时间墙钟 → Date；格式不对返回 null */
export function bjWallToDate(wall) {
  const m = WALL_RE.exec(String(wall || '').trim())
  if (!m) return null
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}+08:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 时刻 → 北京时间墙钟 YYYY-MM-DD HH:mm:ss；没有返回 '' */
export function dateToBjWall(raw) {
  const d = toInstant(raw)
  if (!d) return ''
  return new Date(d.getTime() + BJ_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ')
}

/** 列表「有效期」一栏 */
export function describeCouponExpiry(row) {
  const fixed = dateToBjWall(row && row.fixedExpireTime)
  const days = parseInt(row && row.expireDays, 10) || 0
  if (fixed) return days > 0 ? `至 ${fixed.slice(0, 16)}（或领取后${days}天，取早）` : `至 ${fixed.slice(0, 16)}`
  if (days > 0) return `领取后${days}天`
  const legacy = dateToBjWall(row && row.expireTime)
  return legacy ? `至 ${legacy.slice(0, 16)}` : '领取后30天'
}

/** 列表「领取时间」一栏；未设返回 '' */
export function describeCouponWindow(row) {
  const s = dateToBjWall(row && row.startTime)
  const e = dateToBjWall(row && row.endTime)
  if (!s && !e) return ''
  return `${s ? s.slice(0, 16) : '即日'} ~ ${e ? e.slice(0, 16) : '不限'}`
}
