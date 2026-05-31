/**
 * 标本定制辅助：计价、customMeta 构建、草稿与分享
 */
const { ESTIMATED_DAYS } = require('./customDefaults')

function pickConfigOption(list, id) {
  if (!list || !id) return null
  return list.find((item) => item.id === id || item._id === id) || null
}

function calcCustomExtra(frame, packaging, framer) {
  const frameDelta = frame ? (parseFloat(frame.priceDelta) || 0) : 0
  const pkgDelta = packaging ? (parseFloat(packaging.priceDelta) || 0) : 0
  const framerDelta = framer ? (parseFloat(framer.priceDelta) || 0) : 0
  return Math.round((frameDelta + pkgDelta + framerDelta) * 100) / 100
}

function calcEstimatedDays(baseDays, framer) {
  const base = parseInt(baseDays, 10) || ESTIMATED_DAYS
  const extra = framer ? (parseInt(framer.extraDays, 10) || 0) : 0
  return base + extra
}

function buildCustomLineItems(frame, packaging, framer) {
  const lines = []
  if (frame && (frame.priceDelta || 0) > 0) {
    lines.push({ name: `装裱 · ${frame.name}`, price: frame.priceDelta })
  }
  if (packaging && (packaging.priceDelta || 0) > 0) {
    lines.push({ name: `包装 · ${packaging.name}`, price: packaging.priceDelta })
  }
  if (framer && (framer.priceDelta || 0) > 0) {
    lines.push({ name: `标本师 · ${framer.name}`, price: framer.priceDelta })
  }
  return lines
}

function buildCustomMeta(options) {
  const {
    product,
    sku,
    frame,
    packaging,
    framer,
    cards = {},
    estimatedDays = ESTIMATED_DAYS
  } = options

  const unitPrice = sku
    ? (parseFloat(sku.price) || 0)
    : (parseFloat(product && product.price) || 0)

  const finalDays = calcEstimatedDays(estimatedDays, framer)

  return {
    isCustom: true,
    customId: `CUS${Date.now()}`,
    specimen: {
      productId: product._id || product.id,
      skuId: sku ? sku.id : '',
      skuLabel: sku ? (sku.specLabel || '') : '',
      title: product.title || '',
      latinName: product.latinName || '',
      origin: product.origin || '',
      image: (sku && sku.image) || (product.images && product.images[0]) || '',
      unitPrice
    },
    frame: frame ? {
      configId: frame.id || frame._id,
      name: frame.name,
      priceDelta: frame.priceDelta || 0
    } : null,
    packaging: packaging ? {
      configId: packaging.id || packaging._id,
      name: packaging.name,
      priceDelta: packaging.priceDelta || 0,
      theme: packaging.theme || ''
    } : null,
    framer: framer ? {
      framerId: framer.id || framer._id,
      name: framer.name,
      type: framer.type || 'store',
      priceDelta: framer.priceDelta || 0,
      extraDays: framer.extraDays || 0
    } : null,
    cards: {
      brandCard: cards.brandCard !== false,
      greeting: (cards.greeting || '').trim().slice(0, 60),
      greetingEnabled: !!cards.greetingEnabled,
      ritualCard: !!cards.ritualCard,
      anonymous: !!cards.anonymous
    },
    customLineItems: buildCustomLineItems(frame, packaging, framer),
    customExtraPrice: calcCustomExtra(frame, packaging, framer),
    estimatedDays: finalDays
  }
}

function buildPreviewSummary(customMeta, options = {}) {
  if (!customMeta) return []
  const { hidePrice = false } = options
  const lines = []
  if (customMeta.specimen) {
    lines.push({ label: '标本', value: customMeta.specimen.title })
    if (customMeta.specimen.latinName) {
      lines.push({ label: '拉丁名', value: customMeta.specimen.latinName, latin: true })
    }
    if (customMeta.specimen.skuLabel) {
      lines.push({ label: '规格', value: customMeta.specimen.skuLabel })
    }
  }
  if (customMeta.frame) {
    lines.push({ label: '装裱', value: customMeta.frame.name })
  }
  if (customMeta.framer) {
    lines.push({ label: '标本师', value: customMeta.framer.name })
  }
  if (customMeta.packaging) {
    lines.push({ label: '包装', value: customMeta.packaging.name })
  }
  if (customMeta.cards && customMeta.cards.greetingEnabled && customMeta.cards.greeting) {
    lines.push({ label: '祝福卡', value: customMeta.cards.greeting })
  }
  if (customMeta.cards && customMeta.cards.ritualCard) {
    lines.push({ label: '仪式卡', value: '已选箱内仪式卡' })
  }
  if (customMeta.cards && customMeta.cards.anonymous) {
    lines.push({ label: '匿名送礼', value: '包裹内不含价格清单' })
  }
  if (!hidePrice && customMeta.estimatedDays) {
    lines.push({ label: '交期', value: `约 ${customMeta.estimatedDays} 个工作日` })
  } else if (hidePrice && customMeta.estimatedDays) {
    lines.push({ label: '交期', value: `约 ${customMeta.estimatedDays} 个工作日发出` })
  }
  return lines
}

function serializeWizardState(pageData) {
  return {
    productId: pageData.selectedProduct ? pageData.selectedProduct._id : '',
    selectedSpecs: pageData.selectedSpecs || {},
    selectedFrameId: pageData.selectedFrameId || '',
    selectedPackagingId: pageData.selectedPackagingId || '',
    selectedFramerId: pageData.selectedFramerId || '',
    brandCard: pageData.brandCard !== false,
    greetingEnabled: !!pageData.greetingEnabled,
    greeting: pageData.greeting || '',
    ritualCard: !!pageData.ritualCard,
    anonymous: !!pageData.anonymous,
    theme: pageData.theme || '',
    currentStep: pageData.currentStep || 1
  }
}

function buildDraftTitle(customMeta) {
  if (!customMeta || !customMeta.specimen) return '我的定制方案'
  const parts = [customMeta.specimen.title]
  if (customMeta.frame && customMeta.frame.name) parts.push(customMeta.frame.name)
  return parts.join(' · ')
}

function buildInquirySummary(customMeta, quantity) {
  const lines = buildPreviewSummary(customMeta, { hidePrice: true })
  if (quantity) {
    lines.push({ label: '数量', value: `${quantity} 件` })
  }
  return lines
}

function buildInquiryText(inquiry) {
  if (!inquiry) return ''
  const lines = [
    '【山海造物 · 定制意向单】',
    `类型：${inquiry.typeLabel || inquiry.type || ''}`,
    inquiry.companyName ? `单位：${inquiry.companyName}` : '',
    inquiry.contactName ? `联系人：${inquiry.contactName}` : '',
    inquiry.contactPhone ? `电话：${inquiry.contactPhone}` : '',
    inquiry.quantity ? `数量：${inquiry.quantity} 件` : '',
    inquiry.summary ? `方案：${inquiry.summary}` : '',
    inquiry.message ? `补充：${inquiry.message}` : '',
    inquiry.bookingId ? `关联预约：${inquiry.bookingId}` : ''
  ].filter(Boolean)
  return lines.join('\n')
}

function buildWorkOrderText(order) {
  const meta = order.customMeta
  if (!meta) return ''
  const lines = [
    '【山海造物 · 定制工单】',
    `订单号：${order.orderNo || order._id}`,
    `标本：${meta.specimen && meta.specimen.title || ''}`,
    meta.specimen && meta.specimen.latinName ? `拉丁名：${meta.specimen.latinName}` : '',
    meta.specimen && meta.specimen.skuLabel ? `规格：${meta.specimen.skuLabel}` : '',
    meta.frame ? `装裱：${meta.frame.name}` : '',
    meta.framer ? `标本师：${meta.framer.name}` : '',
    meta.packaging ? `包装：${meta.packaging.name}` : '',
    meta.cards && meta.cards.greetingEnabled && meta.cards.greeting
      ? `祝福卡：${meta.cards.greeting}` : '',
    meta.cards && meta.cards.ritualCard ? '仪式卡：是' : '',
    meta.cards && meta.cards.anonymous ? '匿名送礼：是' : '',
    `收件：${order.address && order.address.name || ''} ${order.address && order.address.phone || ''}`,
    order.address ? `地址：${(order.address.region || []).join('')}${order.address.detail || ''}` : ''
  ].filter(Boolean)
  return lines.join('\n')
}

module.exports = {
  pickConfigOption,
  calcCustomExtra,
  calcEstimatedDays,
  buildCustomLineItems,
  buildCustomMeta,
  buildPreviewSummary,
  serializeWizardState,
  buildDraftTitle,
  buildInquirySummary,
  buildInquiryText,
  buildWorkOrderText
}
