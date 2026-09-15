/**
 * 物业成本常量
 * 集合 property_costs — 水电 / 房租 / 其他，归属两门店 + 工作室
 */

const COLLECTION = 'property_costs'
const MAX_RECEIPTS = 6

const ENTITIES = [
  { id: 'store_shanhaizaowu', name: '山川造物', scope: 'store' },
  { id: 'store_xingchen', name: '星宸标本', scope: 'store' },
  { id: 'studio_specimen', name: '标本工作室', scope: 'studio' }
]

const COST_TYPES = [
  { value: 'utilities', label: '水电费' },
  { value: 'rent', label: '房租' },
  { value: 'other', label: '其他' }
]

const COST_TYPE_LABEL = {
  utilities: '水电费',
  rent: '房租',
  other: '其他'
}

function entityById(id) {
  const key = String(id || '').trim()
  return ENTITIES.find((e) => e.id === key) || null
}

function normalizeCostType(raw) {
  const s = String(raw || '').trim()
  if (COST_TYPE_LABEL[s]) return s
  return 'other'
}

function costTypeLabel(t) {
  return COST_TYPE_LABEL[normalizeCostType(t)] || t || ''
}

function roundMoney(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.round(v * 100) / 100
}

function normalizeReceiptIds(src, prev) {
  let ids = []
  if (Array.isArray(src.receiptFileIds)) {
    ids = src.receiptFileIds
  } else if (src.receiptFileIds != null && typeof src.receiptFileIds === 'string') {
    ids = String(src.receiptFileIds)
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  } else if (src.receiptFileId != null) {
    const one = String(src.receiptFileId || '').trim()
    ids = one ? [one] : []
  } else if (Array.isArray(prev.receiptFileIds) && prev.receiptFileIds.length) {
    ids = prev.receiptFileIds
  } else if (prev.receiptFileId) {
    ids = [String(prev.receiptFileId)]
  }
  const seen = {}
  const out = []
  ids.forEach((raw) => {
    const id = String(raw || '').trim()
    if (!id || seen[id]) return
    seen[id] = true
    out.push(id)
  })
  return out.slice(0, MAX_RECEIPTS)
}

function normalizePayload(input, existing) {
  const src = input && typeof input === 'object' ? input : {}
  const prev = existing && typeof existing === 'object' ? existing : {}
  const entity = entityById(src.entityId || prev.entityId)
  if (!entity) return { ok: false, msg: '请选择成本归属主体' }

  const costType = normalizeCostType(src.costType != null ? src.costType : prev.costType)
  const amount = roundMoney(src.amount != null ? src.amount : prev.amount)
  if (!(amount > 0)) return { ok: false, msg: '金额须大于 0' }

  const periodMonth = String(
    src.periodMonth != null ? src.periodMonth : prev.periodMonth || ''
  ).trim()
  let periodStart = String(
    src.periodStart != null ? src.periodStart : prev.periodStart || ''
  ).trim()
  let periodEnd = String(
    src.periodEnd != null ? src.periodEnd : prev.periodEnd || ''
  ).trim()

  if (periodMonth && !/^\d{4}-\d{2}$/.test(periodMonth)) {
    return { ok: false, msg: '所属月格式应为 YYYY-MM' }
  }

  if (periodMonth && /^\d{4}-\d{2}$/.test(periodMonth)) {
    if (!periodStart) periodStart = `${periodMonth}-01`
    if (!periodEnd) {
      const [y, m] = periodMonth.split('-').map(Number)
      const last = new Date(y, m, 0).getDate()
      periodEnd = `${periodMonth}-${String(last).padStart(2, '0')}`
    }
  }

  if (!periodMonth && !periodStart) {
    return { ok: false, msg: '请填写成本所属月或周期起止' }
  }

  if (periodStart && periodEnd && periodStart > periodEnd) {
    return { ok: false, msg: '周期起止日期顺序有误' }
  }

  const paidAt = String(src.paidAt != null ? src.paidAt : prev.paidAt || '').trim()
  const receiptFileIds = normalizeReceiptIds(src, prev)
  const receiptFileId = receiptFileIds[0] || ''

  return {
    ok: true,
    row: {
      entityId: entity.id,
      entityName: entity.name,
      scope: entity.scope,
      costType,
      costTypeLabel: costTypeLabel(costType),
      amount,
      periodMonth: periodMonth || (periodStart ? periodStart.slice(0, 7) : ''),
      periodStart,
      periodEnd,
      paidAt,
      receiptFileId,
      receiptFileIds,
      note: String(src.note != null ? src.note : prev.note || '').trim(),
      deleted: false
    }
  }
}

function mapRow(doc) {
  if (!doc) return null
  const costType = normalizeCostType(doc.costType)
  const receiptFileIds = Array.isArray(doc.receiptFileIds) && doc.receiptFileIds.length
    ? doc.receiptFileIds.map((x) => String(x || '').trim()).filter(Boolean)
    : (doc.receiptFileId ? [String(doc.receiptFileId)] : [])
  return {
    _id: doc._id,
    entityId: doc.entityId || '',
    entityName: doc.entityName || '',
    scope: doc.scope || '',
    costType,
    costTypeLabel: costTypeLabel(costType),
    amount: roundMoney(doc.amount),
    periodMonth: doc.periodMonth || '',
    periodStart: doc.periodStart || '',
    periodEnd: doc.periodEnd || '',
    paidAt: doc.paidAt || '',
    receiptFileId: receiptFileIds[0] || '',
    receiptFileIds,
    receiptCount: receiptFileIds.length,
    note: doc.note || '',
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
    createdBy: doc.createdBy || '',
    updatedBy: doc.updatedBy || ''
  }
}

/** 按主体 / 类型 / 月份小计 */
function buildSummary(list) {
  const rows = Array.isArray(list) ? list : []
  const byEntityMap = {}
  const byTypeMap = {}
  const byMonthMap = {}
  let totalAmount = 0

  rows.forEach((row) => {
    if (!row) return
    const amount = roundMoney(row.amount)
    totalAmount = roundMoney(totalAmount + amount)

    const ek = row.entityId || '_unknown'
    if (!byEntityMap[ek]) {
      byEntityMap[ek] = {
        entityId: row.entityId || '',
        entityName: row.entityName || '未标注主体',
        amount: 0,
        count: 0
      }
    }
    byEntityMap[ek].amount = roundMoney(byEntityMap[ek].amount + amount)
    byEntityMap[ek].count += 1

    const tk = row.costType || 'other'
    if (!byTypeMap[tk]) {
      byTypeMap[tk] = {
        costType: tk,
        costTypeLabel: row.costTypeLabel || costTypeLabel(tk),
        amount: 0,
        count: 0
      }
    }
    byTypeMap[tk].amount = roundMoney(byTypeMap[tk].amount + amount)
    byTypeMap[tk].count += 1

    const mk = row.periodMonth || (row.periodStart ? String(row.periodStart).slice(0, 7) : '未标注')
    if (!byMonthMap[mk]) {
      byMonthMap[mk] = { periodMonth: mk, amount: 0, count: 0 }
    }
    byMonthMap[mk].amount = roundMoney(byMonthMap[mk].amount + amount)
    byMonthMap[mk].count += 1
  })

  return {
    totalAmount,
    count: rows.length,
    byEntity: Object.keys(byEntityMap).map((k) => byEntityMap[k]),
    byType: Object.keys(byTypeMap).map((k) => byTypeMap[k]),
    byMonth: Object.keys(byMonthMap)
      .map((k) => byMonthMap[k])
      .sort((a, b) => String(b.periodMonth).localeCompare(String(a.periodMonth)))
  }
}

module.exports = {
  COLLECTION,
  MAX_RECEIPTS,
  ENTITIES,
  COST_TYPES,
  COST_TYPE_LABEL,
  entityById,
  normalizeCostType,
  costTypeLabel,
  normalizePayload,
  mapRow,
  buildSummary,
  roundMoney
}
