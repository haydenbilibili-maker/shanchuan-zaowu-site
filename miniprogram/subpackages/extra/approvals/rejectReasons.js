/**
 * 驳回常用原因（2026-10-18 产品负责人「可适当做前端交互与新的功能创新」）
 *
 * 纯前端旁路：只决定驳回面板里给哪些快选签、怎么把快选 + 补充说明拼成一句话；
 * 提交仍是 manageApprovals 的 `reject` + `rejectReason` 字符串，入参出参与 success 语义不变（稳定期纪律）。
 * 类型键与云函数 approvalRules.ACTION 同名；没登记的类型只给通用原因。
 */

const BY_TYPE = {
  points_store_grant: ['消费金额与小票不符', '小票照片看不清', '会员信息对不上', '重复提交'],
  points_receipt_claim: ['小票照片看不清', '金额与小票不符', '这张小票已被认领', '不是本店小票'],
  points_platform_bind: ['查无此订单', '订单与会员信息不符', '该订单已认领过'],
  points_store_revoke: ['撤销理由不充分', '撤销金额有误'],
  product_shelf_on: ['商品图不合格', '价格或库存有误', '描述不完整'],
  order_refund: ['不符合退款条件', '请先与顾客沟通', '退款金额有误'],
  order_ship_sensitive: ['收件信息不全', '请先核实收件人'],
  invoice_issue: ['抬头或税号有误', '开票金额与订单不符'],
  booking_verify_reverse: ['冲正理由不充分', '请附上核销记录'],
  store_point_rules: ['与门店政策不符', '请说明调整原因']
}

const COMMON = ['信息不全，请补充后重新提交']

/** 最多 5 枚：类型专属在前，通用兜底在后，去重 */
function reasonsFor(actionType) {
  const own = BY_TYPE[actionType] || []
  const out = []
  own.concat(COMMON).forEach((label) => {
    if (label && out.indexOf(label) < 0 && out.length < 5) out.push(label)
  })
  return out
}

/** 快选按点选顺序在前、补充说明在后，用「；」连接；空则返回 '' */
function composeReason(picked, note) {
  const parts = (Array.isArray(picked) ? picked : []).map((s) => String(s || '').trim()).filter(Boolean)
  const extra = String(note || '').trim()
  if (extra) parts.push(extra)
  return parts.join('；')
}

module.exports = { reasonsFor, composeReason, BY_TYPE, COMMON }
