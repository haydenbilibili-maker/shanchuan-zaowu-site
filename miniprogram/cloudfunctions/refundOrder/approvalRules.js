/**
 * 审批流规则（可扩展）
 *
 * 通用：
 *   store_staff  发起 → store_manager 审
 *   store_manager 发起 → super_admin 审
 *   super_admin 本人操作 → 直通（无需自审）
 *
 * 特例：
 *   积分族（pointsFamily）→ 终审仅为 store_manager，不上报超管
 *     （含赠分/认领/撤销；逾期撤销可显式指定 approverRole=super_admin）
 *   商品上架（product_shelf_on）→ 店长须超管审
 *   敏感发货：改运单 / 孤品镇店 / 金额≥阈值 → 店长须超管审；普通首发直通
 */

const APPROVER_MANAGER = 'store_manager'
const APPROVER_SUPER = 'super_admin'

const STATUS_PENDING = 'pending'
const STATUS_APPROVED = 'approved'
const STATUS_REJECTED = 'rejected'
const STATUS_CANCELLED = 'cancelled'

/** 敏感发货：订单实付 ≥ 此金额（元）视为高额 */
const SHIP_SENSITIVE_AMOUNT = 2000

const ACTION = {
  POINTS_STORE_GRANT: 'points_store_grant',
  POINTS_RECEIPT_CLAIM: 'points_receipt_claim',
  POINTS_PLATFORM_BIND: 'points_platform_bind',
  POINTS_STORE_REVOKE: 'points_store_revoke',
  PRODUCT_SHELF_ON: 'product_shelf_on',
  ORDER_REFUND: 'order_refund',
  ORDER_SHIP_SENSITIVE: 'order_ship_sensitive',
  INVOICE_ISSUE: 'invoice_issue',
  BOOKING_VERIFY_REVERSE: 'booking_verify_reverse',
  STORE_POINT_RULES: 'store_point_rules'
}

/** 待审超时（小时），用于列表高亮 / 催办 */
const SLA_HOURS = 48

const ACTION_META = {
  [ACTION.POINTS_STORE_GRANT]: {
    label: '门店赠分',
    finalApproverRole: APPROVER_MANAGER,
    relatedType: 'store_purchases',
    pointsFamily: true,
    requireRejectReason: false
  },
  [ACTION.POINTS_RECEIPT_CLAIM]: {
    label: '小票认领',
    finalApproverRole: APPROVER_MANAGER,
    relatedType: 'store_receipt_claims',
    pointsFamily: true,
    requireRejectReason: false
  },
  [ACTION.POINTS_PLATFORM_BIND]: {
    label: '外部订单认领',
    finalApproverRole: APPROVER_MANAGER,
    relatedType: 'platform_order_binds',
    pointsFamily: true,
    requireRejectReason: false
  },
  [ACTION.POINTS_STORE_REVOKE]: {
    label: '积分撤销',
    finalApproverRole: APPROVER_MANAGER,
    relatedType: 'store_purchases',
    pointsFamily: true,
    requireRejectReason: true
  },
  [ACTION.PRODUCT_SHELF_ON]: {
    label: '商品上架',
    finalApproverRole: APPROVER_SUPER,
    relatedType: 'products',
    pointsFamily: false,
    requireRejectReason: true
  },
  [ACTION.ORDER_REFUND]: {
    label: '订单退款',
    finalApproverRole: APPROVER_SUPER,
    relatedType: 'orders',
    pointsFamily: false,
    requireRejectReason: true
  },
  [ACTION.ORDER_SHIP_SENSITIVE]: {
    label: '敏感发货',
    finalApproverRole: APPROVER_SUPER,
    relatedType: 'orders',
    pointsFamily: false,
    requireRejectReason: true
  },
  [ACTION.INVOICE_ISSUE]: {
    label: '发票开具',
    finalApproverRole: APPROVER_SUPER,
    relatedType: 'invoice_requests',
    pointsFamily: false,
    requireRejectReason: true
  },
  [ACTION.BOOKING_VERIFY_REVERSE]: {
    label: '核销冲正',
    finalApproverRole: APPROVER_SUPER,
    relatedType: 'bookings',
    pointsFamily: false,
    requireRejectReason: true
  },
  [ACTION.STORE_POINT_RULES]: {
    label: '积分规则变更',
    finalApproverRole: APPROVER_SUPER,
    relatedType: 'store_point_rules',
    pointsFamily: false,
    requireRejectReason: true
  }
}

/** 敏感类型：驳回须填写原因 */
function requiresRejectReason(actionType) {
  const meta = getMeta(actionType)
  return !!(meta && meta.requireRejectReason)
}

const COLLECTION = 'staff_approvals'

function getMeta(actionType) {
  return ACTION_META[actionType] || null
}

/**
 * 根据申请人角色与 actionType 决定下一审批人。
 * 返回 null 表示可直通执行（无需审批）。
 */
function resolveApproverRole(actionType, applicantWorkspaceRole) {
  const meta = getMeta(actionType)
  if (!meta) return APPROVER_MANAGER

  const ws = String(applicantWorkspaceRole || '')
  if (ws === APPROVER_SUPER || ws === 'super_admin') {
    return null
  }

  if (meta.pointsFamily) {
    if (ws === APPROVER_MANAGER || ws === 'store_manager' || ws === 'manager') {
      return null
    }
    return APPROVER_MANAGER
  }

  if (actionType === ACTION.PRODUCT_SHELF_ON) {
    if (ws === APPROVER_MANAGER || ws === 'store_manager' || ws === 'manager') {
      return APPROVER_SUPER
    }
    return APPROVER_MANAGER
  }

  if (ws === APPROVER_MANAGER || ws === 'store_manager' || ws === 'manager') {
    return APPROVER_SUPER
  }
  return APPROVER_MANAGER
}

function canActorApprove(actor, approverRole) {
  if (!actor) return false
  const ws = actor.workspaceRole || ''
  const isSuper = !!(actor.superAdmin || ws === APPROVER_SUPER)
  const isManager = isSuper || ws === APPROVER_MANAGER || actor.role === 'manager'

  if (approverRole === APPROVER_SUPER) return isSuper
  if (approverRole === APPROVER_MANAGER) return isManager
  return false
}

/** 判断发货是否敏感（需超管审） */
function isSensitiveShip(order, { isReship = false } = {}) {
  if (isReship || (order && order.status === 'shipped')) return true
  const total = Number(order && order.totalPrice) || 0
  if (total >= SHIP_SENSITIVE_AMOUNT) return true
  const products = (order && order.products) || []
  for (let i = 0; i < products.length; i++) {
    const p = products[i] || {}
    if (p.isTreasure || p.isUnique || p.isOneOfAKind) return true
  }
  return false
}

function actorWorkspaceRole(actor) {
  if (!actor) return ''
  if (actor.superAdmin || actor.workspaceRole === APPROVER_SUPER) return APPROVER_SUPER
  if (actor.workspaceRole) return actor.workspaceRole
  if (actor.role === 'manager') return APPROVER_MANAGER
  return 'store_staff'
}

module.exports = {
  APPROVER_MANAGER,
  APPROVER_SUPER,
  STATUS_PENDING,
  STATUS_APPROVED,
  STATUS_REJECTED,
  STATUS_CANCELLED,
  SHIP_SENSITIVE_AMOUNT,
  SLA_HOURS,
  ACTION,
  ACTION_META,
  COLLECTION,
  getMeta,
  requiresRejectReason,
  resolveApproverRole,
  canActorApprove,
  isSensitiveShip,
  actorWorkspaceRole
}
