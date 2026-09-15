/**
 * 售后退款规则（C 端展示 + 申请拦截）
 * 与 cloudfunctions/makeOrder|refundOrder 内副本保持语义一致
 */

const TREASURE_DEDUCT_RATE = 0.3

const POLICY = {
  custom: {
    type: 'custom',
    label: '定制藏品',
    shortLabel: '定制不退款',
    serviceLabel: '定制完成后不退款',
    deductRate: 0,
    userCanRequest: false
  },
  treasure: {
    type: 'treasure',
    label: '镇店之宝 / 孤品',
    shortLabel: '退款扣 30% 损耗',
    serviceLabel: '退款扣除货款 30%',
    deductRate: TREASURE_DEDUCT_RATE,
    userCanRequest: true
  },
  pet: {
    type: 'pet',
    label: '伴宠定制',
    shortLabel: '发出后仅处理物流问题',
    serviceLabel: '顺丰保价 · 发出后不退',
    deductRate: 0,
    userCanRequest: false
  },
  standard: {
    type: 'standard',
    label: '现货藏品',
    shortLabel: '发货前可申请退款',
    serviceLabel: '发货前可申请退款',
    deductRate: 0,
    userCanRequest: true
  }
}

function parseYuan(amount) {
  const num = parseFloat(String(amount == null ? 0 : amount).replace(/,/g, ''))
  if (!num || num <= 0) return 0
  return Math.round(num * 100) / 100
}

function formatYuan(amount) {
  return parseYuan(amount).toFixed(2)
}

function calcRefundSplit(paidAmount, deductRate) {
  const paid = parseYuan(paidAmount)
  const rate = Math.max(0, Math.min(1, Number(deductRate) || 0))
  const deduct = Math.round(paid * rate * 100) / 100
  const refund = Math.round((paid - deduct) * 100) / 100
  return { paid, deduct, refund, deductRate: rate }
}

function textIncludesUnique(value) {
  const text = Array.isArray(value) ? value.join(' ') : String(value || '')
  return /孤品|镇店之宝|镇馆之宝/.test(text)
}

function isTreasureLike(product) {
  if (!product) return false
  if (product.isTreasure === true || product.isUnique === true) return true
  return textIncludesUnique(product.title) || textIncludesUnique(product.tags)
}

function isCustomOrder(order) {
  if (!order) return false
  if (order.source === 'custom') return true
  return !!(order.customMeta && order.customMeta.isCustom)
}

function isPetOrder(order) {
  if (!order) return false
  if (order.source === 'pet' || order.source === 'pet_memorial') return true
  if (order.orderType === 'pet' || order.orderType === 'pet_memorial') return true
  return !!(order.pet || order.petMemorial)
}

function orderHasTreasure(order) {
  if (!order) return false
  if (order.refundPolicy && order.refundPolicy.type === 'treasure') return true
  const products = Array.isArray(order.products) ? order.products : []
  return products.some((p) => isTreasureLike(p))
}

function resolvePolicyType(input) {
  if (!input) return 'standard'
  if (typeof input === 'string') {
    return POLICY[input] ? input : 'standard'
  }
  if (input.refundPolicy && POLICY[input.refundPolicy.type]) {
    return input.refundPolicy.type
  }
  if (isPetOrder(input)) return 'pet'
  if (isCustomOrder(input)) return 'custom'
  if (isTreasureLike(input) || orderHasTreasure(input)) return 'treasure'
  return 'standard'
}

function getPolicy(input) {
  return POLICY[resolvePolicyType(input)] || POLICY.standard
}

function getNoticeParagraphs(type) {
  switch (type) {
    case 'custom':
      return [
        '定制藏品按您确认的方案制作，属于个性化藏品，下单后不接受退款。',
        '如遇工艺瑕疵或物流破损，请保留外包装并联系专员处理。'
      ]
    case 'treasure':
      return [
        '由于藏品类产品的特性，孤品与镇店之宝具有较高观赏与珍藏价值；一经物流运送，难免产生不可逆的损耗与状态变化。',
        '如需退款，将扣除货款 30% 作为运输损耗费用。',
        '发货前可提交申请，审核通过后余款原路退回。'
      ]
    case 'pet':
      return [
        '伴宠定制为高度个性化服务。标本师会在制作过程中通过视频等方式多次确认方案与进程。',
        '伴宠订单一经发出，不接受非物流原因的退款申请。',
        '伴宠订单均以顺丰保价寄出。'
      ]
    default:
      return [
        '现货藏品在发货前可申请退款，审核通过后原路退回。',
        '签收后如遇物流破损，请保留外包装并联系专员。'
      ]
  }
}

function getNoticeText(type) {
  return getNoticeParagraphs(type).join('\n')
}

function getCaptionParagraphs(type) {
  switch (type) {
    case 'custom':
      return [
        '按您确认的方案制作，属于个性化藏品，下单后不接受退款。',
        '如遇工艺瑕疵或物流破损，请保留外包装并联系专员处理。'
      ]
    case 'treasure':
      return [
        '由于藏品类产品的特性，孤品与镇店之宝具有较高观赏与珍藏价值；一经物流运送，难免产生不可逆的损耗与状态变化。',
        '如需退款，将扣除货款 30% 作为运输损耗费用。',
        '发货前可提交申请，审核通过后余款原路退回。'
      ]
    case 'pet':
      return [
        '标本师会在制作过程中通过视频等方式多次确认方案与进程。',
        '一经发出，不接受非物流原因的退款申请。',
        '寄送均使用顺丰保价。'
      ]
    default:
      return [
        '发货前可申请退款，审核通过后原路退回。',
        '签收后如遇物流破损，请保留外包装并联系专员。'
      ]
  }
}

/**
 * 将政策文案拆成可着色片段（不改动原文）。
 * warn：费用/扣减关键（警示色）；em：黄铜强调；strong：关键规则加粗
 */
function toRichParagraphs(paragraphs) {
  const splitRe =
    /(扣除货款\s*30%|扣除\s*30%|不可逆的损耗与状态变化|孤品与镇店之宝|观赏与珍藏价值|原路退回|发货前|不接受退款|顺丰保价)/
  const warnExact = /^(扣除货款\s*30%|扣除\s*30%)$/
  const emExact =
    /^(不可逆的损耗与状态变化|孤品与镇店之宝|观赏与珍藏价值|原路退回|发货前|不接受退款|顺丰保价)$/
  const strongExact =
    /^(扣除货款\s*30%|扣除\s*30%|不可逆的损耗与状态变化|不接受退款)$/
  return (paragraphs || []).map((text, idx) => ({
    idx,
    segments: String(text || '')
      .split(splitRe)
      .filter((t) => t !== '')
      .map((t, i) => ({
        i,
        t,
        warn: warnExact.test(t),
        em: emExact.test(t),
        strong: strongExact.test(t)
      }))
  }))
}

function getDisplayNotice(input) {
  const policy = getPolicy(input)
  const paragraphs = getCaptionParagraphs(policy.type)
  return {
    type: policy.type,
    label: policy.label,
    shortLabel: policy.shortLabel,
    paragraphs,
    richParagraphs: toRichParagraphs(paragraphs)
  }
}

/** 详情页「退款说明」弹窗：完整通知文案 + 富文本片段 */
function getNoticeDisplay(input) {
  const policy = getPolicy(input)
  const paragraphs = getNoticeParagraphs(policy.type)
  return {
    type: policy.type,
    label: policy.label,
    paragraphs,
    richParagraphs: toRichParagraphs(paragraphs)
  }
}

function snapshotPolicy(input) {
  const policy = getPolicy(input)
  return {
    type: policy.type,
    deductRate: policy.deductRate,
    label: policy.label,
    shortLabel: policy.shortLabel
  }
}

/** 发货后售后需开箱影像（与发货私信口径一致） */
function needsUnboxEvidence(order) {
  const status = order && order.status
  return status === 'shipped' || status === 'received'
}

function canUserRequestRefund(order) {
  const status = order && order.status
  // 被门店/超管拒绝过退款：允许重新申请（此前该状态被判「不可申请」，用户彻底无路可走）
  const rejected = status === 'refund_rejected'
  const preShip = status === 'paid' || status === 'paid_awaiting_address' || status === 'ready_pickup' || rejected
  const postShip = needsUnboxEvidence(order)
  if (!preShip && !postShip) {
    if (status === 'refunding' || status === 'aftersales') {
      return { ok: false, reason: '售后申请已提交，请等待处理' }
    }
    return { ok: false, reason: '当前状态不可申请退款' }
  }
  const policy = getPolicy(order)
  if (policy.type === 'custom') {
    return { ok: false, reason: '定制藏品不接受退款。如有工艺或物流问题，请联系专员。' }
  }
  if (policy.type === 'pet') {
    return {
      ok: false,
      reason: postShip
        ? '伴宠定制发出后不接受非物流原因退款。如遇物流破损，请联系专员并保留开箱影像。'
        : '伴宠定制发出后不接受非物流原因退款。发货前如需变更，请联系专员。'
    }
  }
  return {
    ok: true,
    policy,
    needsEvidence: postShip,
    aftersale: postShip
  }
}

function buildRequestModal(order) {
  const check = canUserRequestRefund(order)
  if (!check.ok) {
    return {
      allowed: false,
      title: check.aftersale || needsUnboxEvidence(order) ? '无法申请售后' : '无法申请退款',
      content: check.reason,
      confirmText: '联系专员',
      showCancel: true
    }
  }
  const policy = check.policy
  if (check.aftersale) {
    // 发货后的售后走举证流程；但镇店之宝/孤品同样要扣 30% 运输损耗，
    // 此前该分支先于 treasure 分支返回且**完全没提扣款**，用户直到退款到账才发现少了钱。
    const rate = Number(policy && policy.deductRate) || 0
    let content =
      '到柜时请全程录制开箱影像——无开箱影像将难以受理售后。蝶类触须不在包损之列；其余部位若有损毁，可按售后约定处理。\n请准备开箱视频与损坏部位特写后提交。'
    if (rate > 0) {
      const split = calcRefundSplit(order.totalPrice, rate)
      content += `\n\n注意：本单为镇店之宝 / 孤品，退款将扣除货款 ${Math.round(rate * 100)}% 作为运输损耗。\n实付 ¥${formatYuan(split.paid)}，预计退回 ¥${formatYuan(split.refund)}（扣除 ¥${formatYuan(split.deduct)}）。`
    }
    return {
      allowed: true,
      title: '申请售后',
      content,
      confirmText: '去上传举证',
      showCancel: true,
      needsEvidence: true,
      aftersale: true,
      deductRate: policy.deductRate
    }
  }
  if (policy.type === 'treasure') {
    const split = calcRefundSplit(order.totalPrice, policy.deductRate)
    return {
      allowed: true,
      title: '申请退款',
      content: `镇店之宝与孤品退款将扣除货款 30% 作为运输损耗。\n实付 ¥${formatYuan(split.paid)}，预计退回 ¥${formatYuan(split.refund)}（扣除 ¥${formatYuan(split.deduct)}）。\n提交后需门店审核，此操作不可撤销。`,
      confirmText: '确认申请',
      showCancel: true,
      deductRate: policy.deductRate
    }
  }
  return {
    allowed: true,
    title: '申请退款',
    content: '发货前可申请退款，提交后需门店审核。审核通过后款项原路退回。',
    confirmText: '确认申请',
    showCancel: true,
    deductRate: 0
  }
}

function buildAdminConfirm(order) {
  const policy = getPolicy(order)
  const split = calcRefundSplit(order.totalPrice, policy.deductRate)
  if (policy.type === 'custom') {
    return {
      title: '定制藏品退款',
      content: '定制藏品原则上不接受退款。确认仍要原路退回并恢复库存？'
    }
  }
  if (policy.type === 'pet') {
    return {
      title: '伴宠订单退款',
      content: '伴宠订单一经发出，原则上不接受非物流原因退款。确认仍要退款并恢复库存？'
    }
  }
  if (policy.type === 'treasure') {
    return {
      title: '确认退款',
      content: `镇店之宝 / 孤品将扣除 30% 运输损耗。\n实付 ¥${formatYuan(split.paid)}，退回 ¥${formatYuan(split.refund)}（扣除 ¥${formatYuan(split.deduct)}）。\n确认通过微信退款并恢复库存？`
    }
  }
  return {
    title: '确认退款',
    content: `确认退回 ¥${formatYuan(split.paid)} 并恢复库存？`
  }
}

module.exports = {
  TREASURE_DEDUCT_RATE,
  POLICY,
  parseYuan,
  formatYuan,
  calcRefundSplit,
  isTreasureLike,
  isCustomOrder,
  isPetOrder,
  resolvePolicyType,
  getPolicy,
  getNoticeParagraphs,
  getNoticeText,
  getDisplayNotice,
  getNoticeDisplay,
  toRichParagraphs,
  snapshotPolicy,
  needsUnboxEvidence,
  canUserRequestRefund,
  buildRequestModal,
  buildAdminConfirm
}
