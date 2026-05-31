/**
 * 伴宠记忆 — 工单构建与展示
 */
const { STATUS_LABELS, SPECIES_OPTIONS, WEIGHT_RANGES, STORAGE_OPTIONS, INTAKE_METHODS, RELATION_OPTIONS, POSE_OPTIONS } = require('./petMemorialDefaults')

function labelOf(list, id) {
  const item = list.find((x) => x.id === id)
  return item ? item.label : id || ''
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
      relation: form.relation,
      relationLabel: labelOf(RELATION_OPTIONS, form.relation),
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
  getStatusLabel: (status) => STATUS_LABELS[status] || status
}
