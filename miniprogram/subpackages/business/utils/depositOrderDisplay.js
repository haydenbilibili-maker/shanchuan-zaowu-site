/**
 * 定金 / 尾款订单展示口径（C 端订单、店长订单管理共用）
 */
function isDepositOrder(order) {
  if (!order) return false
  return order.orderType === 'deposit' || order.source === 'deposit'
}

function isDepositBalanceOrder(order) {
  if (!order || isDepositOrder(order)) return false
  return (
    order.source === 'deposit_balance' ||
    order.orderType === 'deposit_balance' ||
    !!order.depositIntentId
  )
}

/**
 * @returns {{ label: string, en: string, tag: string, canShip: boolean } | null}
 */
function resolveDepositDisplay(order) {
  if (!order) return null
  if (isDepositOrder(order)) {
    const st = String(order.status || '')
    if (st === 'pending_pay') {
      return { label: '待付定金', en: 'DEPOSIT DUE', tag: '孤品定金', canShip: false }
    }
    if (st === 'fulfilling') {
      return { label: '定金确认中', en: 'CONFIRMING', tag: '孤品定金', canShip: false }
    }
    if (st === 'paid') {
      return { label: '已付定金', en: 'DEPOSIT PAID', tag: '孤品定金', canShip: false }
    }
    if (st === 'void' || st === 'cancelled') {
      return { label: '定金已取消', en: 'CANCELLED', tag: '孤品定金', canShip: false }
    }
    return { label: '定金单', en: 'DEPOSIT', tag: '孤品定金', canShip: false }
  }
  if (isDepositBalanceOrder(order)) {
    const st = String(order.status || '')
    const credit =
      order.depositCredit != null && Number(order.depositCredit) > 0
        ? `已抵定金 ¥${order.depositCredit}`
        : '定金尾款'
    if (st === 'pending_pay') {
      return { label: '待付尾款', en: 'BALANCE DUE', tag: credit, canShip: false }
    }
    if (st === 'fulfilling') {
      return { label: '尾款确认中', en: 'CONFIRMING', tag: credit, canShip: false }
    }
    // 已付尾款后走普通发货状态，仅保留标签
    return { label: '', en: '', tag: credit, canShip: true }
  }
  return null
}

module.exports = {
  isDepositOrder,
  isDepositBalanceOrder,
  resolveDepositDisplay
}
