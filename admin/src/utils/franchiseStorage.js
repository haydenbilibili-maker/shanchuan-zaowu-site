/**
 * 加盟商拓展模块 — 本地聚合存储（与 PRD-加盟商管理模块 对齐）
 */

const STORAGE_KEY = 'sc_franchise_bundle_v1'
const DATA_VERSION = 1

export const LEAD_STAGES = {
  new: '新线索',
  contacted: '已联系',
  qualifying: '评估中',
  site_selection: '选址中',
  approved: '已通过评审',
  contracting: '签约中',
  won: '已签约',
  lost: '已流失',
}

export const LOST_REASONS = {
  budget: '资金未达标',
  site: '选址未通过',
  competitor: '选择其他品牌',
  silent: '长期未响应',
  other: '其它',
}

export const CITY_PRIORITY = { high: '高', medium: '中', low: '低' }

export const CITY_STATUS = {
  idle: '未启动',
  researching: '调研中',
  open: '已开放加盟',
  paused: '暂缓',
}

export const RESOURCE_TYPES = {
  landlord: '业主/物业',
  gov: '政府园区',
  agency: '中介招商',
  channel: '异业渠道',
  investor_intro: '投资人介绍',
  other: '其它',
}

export const RESOURCE_COOP = {
  touch: '接触中',
  active: '已合作',
  dormant: '休眠',
}

function emptyBundle() {
  return {
    _v: DATA_VERSION,
    leads: [],
    cities: [],
    resources: [],
  }
}

export function loadFranchiseBundle() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyBundle()
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return emptyBundle()
    const b = emptyBundle()
    b.leads = Array.isArray(parsed.leads) ? parsed.leads : []
    b.cities = Array.isArray(parsed.cities) ? parsed.cities : []
    b.resources = Array.isArray(parsed.resources) ? parsed.resources : []
    return b
  } catch {
    return emptyBundle()
  }
}

export function saveFranchiseBundle(bundle) {
  const next = { ...bundle, _v: DATA_VERSION, _updatedAt: Date.now() }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function genFranchiseId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

/** 列表脱敏：11 位大陆手机 */
export function maskPhone(phone) {
  const s = String(phone || '').trim()
  if (/^1\d{10}$/.test(s)) return `${s.slice(0, 3)}****${s.slice(7)}`
  if (s.length >= 7) return `${s.slice(0, 2)}***${s.slice(-2)}`
  return s ? '***' : '—'
}

export function normalizePhone(s) {
  return String(s || '').replace(/\s/g, '')
}

export function isValidCnMobile(phone) {
  return /^1[3-9]\d{9}$/.test(normalizePhone(phone))
}

export function cityLabel(c) {
  if (!c) return ''
  const p = c.province || ''
  const ct = c.city || ''
  return [p, ct].filter(Boolean).join(' · ') || ct || '—'
}
