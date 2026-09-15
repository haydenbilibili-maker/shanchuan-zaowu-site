/**
 * 伴宠记忆 — 工单构建与展示
 */
const {
  STATUS_LABELS,
  SPECIES_OPTIONS,
  WEIGHT_RANGES,
  STORAGE_OPTIONS,
  INTAKE_METHODS,
  RELATION_OPTIONS,
  RELATION_LABEL_ALIASES,
  POSE_OPTIONS
} = require('./petMemorialDefaults')

function labelOf(list, id) {
  const item = list.find((x) => x.id === id)
  return item ? item.label : id || ''
}

/** 关系展示文案：id=owner 保持不变；旧「本人」映射为「主人」 */
function relationLabelOf(relation, storedLabel) {
  const byId = labelOf(RELATION_OPTIONS, relation)
  if (byId && byId !== relation) return byId
  const key = String(relation || storedLabel || '').trim()
  if (RELATION_LABEL_ALIASES[key]) return RELATION_LABEL_ALIASES[key]
  if (storedLabel === '本人') return '主人'
  return storedLabel || byId || key || ''
}

function buildOrderPayload(form) {
  return {
    pet: {
      name: (form.petName || '').trim(),
      species: form.species,
      speciesLabel: labelOf(SPECIES_OPTIONS, form.species),
      breed: (form.breed || '').trim(),
      coatColor: (form.coatColor || '').trim(),
      weightRange: form.weightRange,
      weightLabel: labelOf(WEIGHT_RANGES, form.weightRange),
      passedAt: form.passedAt || '',
      storage: form.storage,
      storageLabel: labelOf(STORAGE_OPTIONS, form.storage),
      photos: form.photos || []
    },
    craft: {
      craftId: form.craftId,
      craftName: form.craftName || '',
      pose: form.pose || '',
      poseLabel: labelOf(POSE_OPTIONS, form.pose),
      poseNote: (form.poseNote || '').trim(),
      plaqueText: (form.plaqueText || '').trim().slice(0, 40)
    },
    intake: {
      method: form.intakeMethod,
      methodLabel: labelOf(INTAKE_METHODS, form.intakeMethod),
      preferredDate: form.preferredDate || '',
      addressNote: (form.addressNote || '').trim()
    },
    contact: {
      name: (form.contactName || '').trim(),
      phone: (form.contactPhone || '').trim(),
      relation: form.relation === '本人' ? 'owner' : (form.relation || 'owner'),
      relationLabel: relationLabelOf(form.relation),
      note: (form.contactNote || '').trim().slice(0, 500)
    },
    consent: {
      version: form.consentVersion,
      agreedAt: form.consentAgreedAt || new Date().toISOString()
    }
  }
}

function buildSummaryLines(payload) {
  if (!payload) return []
  const lines = []
  if (payload.pet) {
    lines.push({ label: '名字', value: payload.pet.name })
    lines.push({ label: '物种', value: payload.pet.speciesLabel || payload.pet.species })
    if (payload.pet.breed) lines.push({ label: '品种', value: payload.pet.breed })
    if (payload.pet.weightLabel) lines.push({ label: '体量', value: payload.pet.weightLabel })
  }
  if (payload.craft) {
    lines.push({ label: '工艺', value: payload.craft.craftName })
    if (payload.craft.poseLabel) lines.push({ label: '姿态', value: payload.craft.poseLabel })
  }
  if (payload.intake) {
    lines.push({ label: '交接', value: payload.intake.methodLabel })
  }
  if (payload.contact) {
    const rel = relationLabelOf(payload.contact.relation, payload.contact.relationLabel)
    if (rel) lines.push({ label: '关系', value: rel })
  }
  return lines
}

function buildStaffCopyText(order) {
  if (!order) return ''
  const p = order.pet || {}
  const c = order.craft || {}
  const i = order.intake || {}
  const ct = order.contact || {}
  return [
    '【山海造物 · 伴宠记忆工单】',
    `工单号：${order.orderNo || order._id}`,
    `状态：${STATUS_LABELS[order.status] || order.status}`,
    `名字：${p.name || ''}`,
    `物种：${p.speciesLabel || p.species || ''}`,
    p.breed ? `品种：${p.breed}` : '',
    p.weightLabel ? `体量：${p.weightLabel}` : '',
    p.passedAt ? `离世：${p.passedAt}` : '',
    p.storageLabel ? `存放：${p.storageLabel}` : '',
    `工艺：${c.craftName || ''}`,
    order.quote && order.quote.amount != null ? `报价：¥${order.quote.amount}` : '',
    c.poseLabel ? `姿态：${c.poseLabel}` : '',
    c.plaqueText ? `纪念牌：${c.plaqueText}` : '',
    `交接：${i.methodLabel || ''}`,
    i.preferredDate ? `期望日期：${i.preferredDate}` : '',
    `联系人：${ct.name || ''} ${ct.phone || ''}`,
    (() => {
      const rel = relationLabelOf(ct.relation, ct.relationLabel)
      return rel ? `与伴宠关系：${rel}` : ''
    })(),
    ct.note ? `补充：${ct.note}` : ''
  ].filter(Boolean).join('\n')
}

function formatQuoteAmount(amount) {
  if (amount == null || amount === '') return ''
  const num = Number(amount)
  if (Number.isNaN(num)) return String(amount)
  return `¥${num.toLocaleString('zh-CN')}`
}

function formatOrderTime(time) {
  if (!time) return ''
  const d = time instanceof Date ? time : new Date(time)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function mapOrderListItem(order) {
  if (!order) return null
  return {
    ...order,
    statusLabel: STATUS_LABELS[order.status] || order.status,
    petTitle: order.pet ? `${order.pet.name} · ${order.pet.speciesLabel || order.pet.species}` : '',
    craftName: order.craft ? order.craft.craftName : '',
    formatTime: formatOrderTime(order.createTime),
    quoteText: order.quote && order.quote.amount != null ? formatQuoteAmount(order.quote.amount) : ''
  }
}

function buildQuoteDisplay(quote) {
  if (!quote || quote.amount == null) return null
  const lines = [{ label: '报价金额', value: formatQuoteAmount(quote.amount) }]
  if (quote.note) lines.push({ label: '说明', value: quote.note })
  if (quote.validUntil) lines.push({ label: '有效期至', value: quote.validUntil })
  return lines
}

module.exports = {
  buildOrderPayload,
  buildSummaryLines,
  buildStaffCopyText,
  formatQuoteAmount,
  formatOrderTime,
  mapOrderListItem,
  buildQuoteDisplay,
  relationLabelOf,
  getStatusLabel: (status) => STATUS_LABELS[status] || status
}
