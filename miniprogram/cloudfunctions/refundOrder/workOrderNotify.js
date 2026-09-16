/**
 * 审批人「服务通知」投递（工单通知的业务侧适配层）
 *
 * 职责分离：
 *   - `workOrderSubscribe.js`：模板字段映射 + 下发 + 留痕（通知层）
 *   - 本文件：审批场景的**收件人解析**（谁是审批人）+ 按 actionType 选模板类别
 *
 * 为什么要单独一层：`approvalBridge.js` 在 9 个云函数里都有副本，
 * 而「收件人解析」需要按 approverRole 查 staff_members —— 这段逻辑必须与
 * approvalBridge 同目录同副本，否则会出现「有的函数通知、有的不通知」。
 *
 * 下发走 `dispatchMessage`（已具 subscribeMessage.send 权限，且是全仓通知层），
 * 故本层不做 openapi 调用，只做一次轻量云调用。
 *
 * ⚠️ 广播开关：`WORK_ORDER_NOTIFY_BROADCAST=1` 时通知所有具备审批角色的人；
 *   默认**只通知超管**（app.js 同源约定），避免店长被非其职责的审批打扰。
 */

/** actionType → 模板类别（与 workOrderSubscribe.WORK_ORDER_CATEGORIES 对应） */
const ACTION_CATEGORY = {
  invoice_issue: 'invoice',
  order_refund: 'approval',
  order_ship_sensitive: 'approval',
  product_shelf_on: 'approval',
  points_store_grant: 'approval',
  points_receipt_claim: 'approval',
  points_platform_bind: 'approval',
  points_store_revoke: 'approval',
  booking_verify_reverse: 'approval',
  store_point_rules: 'approval'
}

function categoryOf(actionType) {
  const key = String(actionType || '').trim()
  return ACTION_CATEGORY[key] || 'approval'
}

/** 收件人：默认超管；可通过环境变量放开到全部审批角色 */
function shouldBroadcast() {
  return String(process.env.WORK_ORDER_NOTIFY_BROADCAST || '').trim() === '1'
}

/**
 * 解析应收到该审批的人（openid 列表）。
 * 与 `staffNotify.listStaffOpenidsByRoles` 同源的查询口径：
 * 读 `staff_members`，按 roles 匹配；超管另有 env 兜底。
 */
async function resolveApproverOpenids(db, { approverRole, applicantOpenid }) {
  const wanted = []
  const role = String(approverRole || '').trim()
  if (shouldBroadcast()) {
    if (role) wanted.push(role)
    wanted.push('manager', 'super_admin')
  } else {
    // 默认只找该审批的实际审批角色，缺省回落超管
    wanted.push(role || 'super_admin')
  }

  const out = []
  const seen = new Set()

  // env 兜底：与 staffNotify.envAdminOpenids 同源（云函数环境变量）
  const envAdmins = String(process.env.MESSAGE_ADMIN_OPENIDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const isSuperWanted = wanted.indexOf('super_admin') !== -1
  if (isSuperWanted) {
    envAdmins.forEach((oid) => {
      if (oid && !seen.has(oid)) {
        seen.add(oid)
        out.push(oid)
      }
    })
  }

  try {
    const res = await db.collection('staff_members').limit(200).get()
    ;(res.data || []).forEach((row) => {
      if (!row || !row.openid) return
      const roles = Array.isArray(row.roles) ? row.roles.map(String) : []
      const hit = wanted.some((w) => roles.indexOf(w) !== -1 || String(row.role || '') === w)
      if (!hit) return
      const oid = String(row.openid)
      if (seen.has(oid)) return
      // 不给申请人自己发通知（自己提交自己审的场景）
      if (applicantOpenid && oid === String(applicantOpenid)) return
      seen.add(oid)
      out.push(oid)
    })
  } catch (e) {
    console.warn('resolveApproverOpenids', e && e.message)
  }
  return out
}

/**
 * 投递一条审批服务通知（尽力而为，任何失败都只告警，绝不抛出）。
 * @returns {Promise<{count:number, results:Array}>}
 */
async function notifyApproversSubscribe(
  cloud,
  db,
  { actionType, approvalId, title, applicantName, relatedId, approverRole, applicantOpenid }
) {
  const results = []
  try {
    const openids = await resolveApproverOpenids(db, { approverRole, applicantOpenid })
    if (!openids.length) return { count: 0, results }
    const category = categoryOf(actionType)
    for (const openid of openids) {
      try {
        const res = await cloud.callFunction({
          name: 'dispatchMessage',
          data: {
            action: 'notifyWorkOrder',
            category,
            openid,
            relatedId: approvalId || relatedId || '',
            vars: {
              title: title || '有新的审批待处理',
              applicantName: applicantName || '',
              submitTime: Date.now(),
              requestNo: approvalId || relatedId || ''
            }
          }
        })
        results.push({ openid, ...((res && res.result) || {}) })
      } catch (e) {
        console.warn('notifyApproversSubscribe', openid, e && e.message)
        results.push({ openid, sent: false, reason: (e && e.message) || 'CALL_ERR' })
      }
    }
  } catch (e) {
    console.warn('notifyApproversSubscribe outer', e && e.message)
  }
  return { count: results.length, results }
}

module.exports = {
  ACTION_CATEGORY,
  categoryOf,
  shouldBroadcast,
  resolveApproverOpenids,
  notifyApproversSubscribe
}
