/** 敏感字段脱敏（展示用；完整值仍存本地花名册） */

export function maskIdCard(value) {
  const s = String(value || '').replace(/\s/g, '')
  if (!s) return ''
  if (s.length <= 8) return '*'.repeat(Math.min(s.length, 6))
  return `${s.slice(0, 4)}${'*'.repeat(Math.max(s.length - 8, 6))}${s.slice(-4)}`
}

export function maskBankCard(value) {
  const s = String(value || '').replace(/\s/g, '')
  if (!s) return ''
  if (s.length <= 4) return '****'
  return `**** **** **** ${s.slice(-4)}`
}

export function maskPhone(value) {
  const s = String(value || '').replace(/\s/g, '')
  if (!s) return ''
  if (s.length < 7) return s
  return `${s.slice(0, 3)}****${s.slice(-4)}`
}
