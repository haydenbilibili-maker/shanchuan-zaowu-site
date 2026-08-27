/**
 * 店铺管理模块 — 本地聚合存储（与 PRD 逻辑模型对齐，后续可迁云）
 */

const STORAGE_KEY = 'sc_store_bundle_v1'
const DATA_VERSION = 1

export const STORE_STATUS = {
  preparing: '筹备',
  operating: '在营',
  closed: '停业',
}

export const REVENUE_CHANNELS = {
  offline_pos: '线下收银',
  miniprogram: '小程序到店',
  other: '其他',
}

/** 证照「将过期」阈值（天），与 PRD L-04 可配置思路一致 */
export const LICENSE_EXPIRY_SOON_DAYS = 30

/**
 * 单条证照有效期状态（与服务器/本机日期比较）
 * @returns {{ key: string, label: string, tag: 'success' | 'warning' | 'danger' | 'info' }}
 */
export function licenseValidityStatus(license) {
  const to = license?.validTo
  if (!to) return { key: 'unknown', label: '未填', tag: 'info' }
  const day = String(to).slice(0, 10)
  const end = new Date(day + 'T23:59:59')
  const now = new Date()
  if (Number.isNaN(end.getTime())) return { key: 'unknown', label: '—', tag: 'info' }
  if (end < now) return { key: 'expired', label: '已过期', tag: 'danger' }
  const soon = new Date(now)
  soon.setDate(soon.getDate() + LICENSE_EXPIRY_SOON_DAYS)
  if (end <= soon) return { key: 'soon', label: '将过期', tag: 'warning' }
  return { key: 'valid', label: '有效', tag: 'success' }
}

/**
 * 门店在营证照角标：已过期优先于将过期
 * @returns {'expired' | 'soon' | null}
 */
export function storeLicenseAlertLevel(bundle, storeId) {
  const list = (bundle?.licenses || []).filter((l) => l.storeId === storeId && l.isCurrent)
  let hasSoon = false
  for (const l of list) {
    const k = licenseValidityStatus(l).key
    if (k === 'expired') return 'expired'
    if (k === 'soon') hasSoon = true
  }
  return hasSoon ? 'soon' : null
}

export function defaultLicenseTypes() {
  return [
    { id: 'lt_business', name: '营业执照' },
    { id: 'lt_food', name: '食品经营许可' },
    { id: 'lt_special', name: '特种行业许可' },
    { id: 'lt_fire', name: '消防备案' },
    { id: 'lt_health', name: '卫生许可' },
  ]
}

function emptyBundle() {
  return {
    _v: DATA_VERSION,
    licenseTypes: defaultLicenseTypes(),
    stores: [],
    licenses: [],
    rentPayments: [],
    invoices: [],
    staff: [],
    revenueEntries: [],
  }
}

export function loadStoreBundle() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyBundle()
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return emptyBundle()
    const b = emptyBundle()
    b.licenseTypes = parsed.licenseTypes?.length ? parsed.licenseTypes : defaultLicenseTypes()
    b.stores = Array.isArray(parsed.stores) ? parsed.stores : []
    b.licenses = Array.isArray(parsed.licenses) ? parsed.licenses : []
    b.rentPayments = Array.isArray(parsed.rentPayments) ? parsed.rentPayments : []
    b.invoices = Array.isArray(parsed.invoices) ? parsed.invoices : []
    b.staff = Array.isArray(parsed.staff) ? parsed.staff : []
    b.revenueEntries = Array.isArray(parsed.revenueEntries) ? parsed.revenueEntries : []
    return b
  } catch {
    return emptyBundle()
  }
}

export function saveStoreBundle(bundle) {
  const next = { ...bundle, _v: DATA_VERSION, _updatedAt: Date.now() }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function genStoreEntityId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

/** 下拉用：财务账本、筛选等 */
export function getStoreSelectOptions(bundle) {
  const list = bundle?.stores || []
  return list.map((s) => ({
    value: s.id,
    label: `${s.code || '—'} · ${s.name || '未命名'}`,
    code: s.code,
    name: s.name,
    status: s.status,
  }))
}

export function findStoreById(bundle, id) {
  return (bundle?.stores || []).find((s) => s.id === id) || null
}

/** 财务入账默认关联门店 = 楼上山川造物（ERP 财务核算口径） */
export const DEFAULT_FINANCE_STORE_NAME = '长春这有山1号门店'

/** 与小程序 storeSeed 对齐的 canonical storeId（楼上=山海造物，楼下=星宸标本） */
export const CANONICAL_STORE_IDS = {
  shanhaizaowu: 'store_shanhaizaowu',
  xingchen: 'store_xingchen',
}

export const CANONICAL_STORE_DEFS = [
  {
    key: 'shanhaizaowu',
    storeId: CANONICAL_STORE_IDS.shanhaizaowu,
    name: '山海造物',
    code: 'CCYS-SH',
    floor: '楼上',
    locationLabel: '这有山 · 山腰',
  },
  {
    key: 'xingchen',
    storeId: CANONICAL_STORE_IDS.xingchen,
    name: '星宸标本工作室',
    code: 'CCYS-XC',
    floor: '楼下',
    locationLabel: '这有山 · 楼下',
  },
]

/**
 * 将财务账本行解析为 canonical 门店 key（shanhaizaowu | xingchen）
 * ERP 财务入账 storeId 可能是 bundle 内部 id，需反查门店主数据
 */
export function resolveCanonicalStoreKey(record, bundle) {
  const sid = String(record?.storeId || '')
  const sn = String(record?.storeName || '')
  if (sid === CANONICAL_STORE_IDS.xingchen || /星宸/i.test(sn)) return 'xingchen'
  if (
    sid === CANONICAL_STORE_IDS.shanhaizaowu ||
    /山海造物|山川造物/i.test(sn) ||
    /这有山.*(1号|一号)/.test(sn) ||
    sn.trim() === DEFAULT_FINANCE_STORE_NAME
  ) {
    return 'shanhaizaowu'
  }

  const b = bundle || loadStoreBundle()
  if (sid && b?.stores?.length) {
    const st = b.stores.find((s) => s.id === sid || s.storeId === sid)
    if (st) {
      if (st.storeId === CANONICAL_STORE_IDS.xingchen || /星宸/i.test(String(st.name || ''))) {
        return 'xingchen'
      }
      if (
        st.storeId === CANONICAL_STORE_IDS.shanhaizaowu ||
        /山海造物|山川造物/i.test(String(st.name || '')) ||
        String(st.name || '').trim() === DEFAULT_FINANCE_STORE_NAME
      ) {
        return 'shanhaizaowu'
      }
    }
  }

  // 无门店字段或无法识别时，ERP 账本默认归属楼上山川造物
  return 'shanhaizaowu'
}

/**
 * 解析默认财务门店 id：优先楼上山海造物 → 旧「1号门店」→ 模糊匹配
 */
export function findDefaultFinanceStoreId(bundle) {
  const stores = [...(bundle?.stores || [])]
  const byCanonical = stores.find(
    (s) => s.storeId === CANONICAL_STORE_IDS.shanhaizaowu || String(s.name || '').includes('山海造物'),
  )
  if (byCanonical?.id) return byCanonical.id
  const exact = stores.find((s) => String(s.name || '').trim() === DEFAULT_FINANCE_STORE_NAME)
  if (exact?.id) return exact.id
  const fuzzy = stores.find((s) => {
    const n = String(s.name || '')
    return (n.includes('长春') || n.includes('这有山')) && (n.includes('1号') || n.includes('一号'))
  })
  return fuzzy?.id || ''
}

/** 账本记录无门店时补上默认门店字段 */
export function applyDefaultStoreToFinanceRecord(record, bundle) {
  if (!record || record.storeId) return record
  const id = findDefaultFinanceStoreId(bundle)
  if (!id) return record
  const st = findStoreById(bundle, id)
  if (!st) return record
  return {
    ...record,
    storeId: id,
    storeCode: st.code || '',
    storeName: st.name || '',
  }
}

/**
 * 若本地店铺主数据中尚不存在 canonical 双店，则自动补齐（便于财务与沙盘双店拆分）
 */
export function ensureDefaultFinanceStoreInLocalBundle() {
  let b = loadStoreBundle()
  let changed = false
  const stores = [...(b.stores || [])]

  for (const def of CANONICAL_STORE_DEFS) {
    const exists = stores.some(
      (s) =>
        s.storeId === def.storeId ||
        String(s.name || '').trim() === def.name ||
        (def.key === 'shanhaizaowu' && String(s.name || '').trim() === DEFAULT_FINANCE_STORE_NAME),
    )
    if (exists) continue
    stores.push({
      id: genStoreEntityId('store'),
      storeId: def.storeId,
      code: def.code,
      name: def.name,
      status: 'operating',
      city: '长春',
      managerName: '',
      address: def.locationLabel,
      postalCode: '',
      latLng: '',
      areaM2: null,
      unitNo: def.floor,
      leaseStart: '',
      leaseEnd: '',
      landlordName: '',
      landlordContact: '',
    })
    changed = true
  }

  if (!findDefaultFinanceStoreId(b) && !changed) {
    stores.push({
      id: genStoreEntityId('store'),
      storeId: CANONICAL_STORE_IDS.shanhaizaowu,
      code: 'CCYS001',
      name: DEFAULT_FINANCE_STORE_NAME,
      status: 'operating',
      city: '长春',
      managerName: '',
      address: '红旗街这有山',
      postalCode: '',
      latLng: '',
      areaM2: null,
      unitNo: '楼上',
      leaseStart: '',
      leaseEnd: '',
      landlordName: '',
      landlordContact: '',
    })
    changed = true
  }

  if (!changed) return b
  b.stores = stores
  return saveStoreBundle(b)
}

/** 自然月内某店「门店营收」净额之和（与店铺管理列表口径一致） */
export function sumStoreNetRevenueForMonth(bundle, storeId, yearMonth) {
  const ym = String(yearMonth || '').slice(0, 7)
  if (!storeId || !ym) return 0
  return (bundle?.revenueEntries || [])
    .filter((r) => r.storeId === storeId && r.bizDate && String(r.bizDate).startsWith(ym))
    .reduce((a, r) => {
      const net = Number(r.netAmount)
      if (Number.isFinite(net)) return a + net
      const g = Number(r.grossAmount) || 0
      const ref = Number(r.refundAmount) || 0
      return a + Math.max(0, g - ref)
    }, 0)
}
