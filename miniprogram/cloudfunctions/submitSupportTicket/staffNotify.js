/**
 * 顾客留言 → 员工「工作信息」通知（2026-11-26 产品负责人：留言后链路要通知超管）
 * 复制自 submitComment/staffNotify（同一套收件人白名单与队列），深链到客服工作台。
 */
const MAX_RECIPIENTS = 50
const uniq = (l) => Array.from(new Set((l || []).filter(Boolean)))
function envAdminOpenids() {
  return String(process.env.MESSAGE_ADMIN_OPENIDS || '').split(',').map((s) => s.trim()).filter(Boolean)
}
function staffRolesOf(row) {
  const out = []
  if (!row) return out
  if (Array.isArray(row.roles)) out.push(...row.roles)
  if (row.role) out.push(String(row.role))
  if (row.workspaceRole) out.push(String(row.workspaceRole))
  return out.map((r) => String(r || '').trim()).filter(Boolean)
}
async function listSupportStaffOpenids(db) {
  const openids = envAdminOpenids()
  try {
    const res = await db.collection('users').where({ isAdmin: true }).limit(50).get()
    ;(res.data || []).forEach((u) => { const oid = (u && (u._openid || u.openid)) || ''; if (oid) openids.push(oid) })
  } catch (e) { /* 可选来源 */ }
  try {
    const res = await db.collection('staff_members').where({ status: 'active' }).limit(200).get()
    ;(res.data || []).forEach((row) => {
      const oid = (row && row.openid) || ''
      if (!oid) return
      if (staffRolesOf(row).some((r) => r === 'super_admin' || r === 'manager' || r === 'store_manager')) openids.push(oid)
    })
  } catch (e) { console.warn('listSupportStaffOpenids staff_members', e && e.message) }
  return uniq(openids).slice(0, MAX_RECIPIENTS)
}
function buildMessage({ ticketId, topicLabel, content, productName, orderNo }) {
  const excerpt = String(content || '').replace(/\s+/g, ' ').trim()
  const clipped = excerpt.length > 40 ? `${excerpt.slice(0, 40)}…` : excerpt
  const lines = [String(topicLabel || '顾客留言')]
  if (orderNo) lines.push(`订单 ${orderNo}`)
  if (productName) lines.push(productName)
  if (clipped) lines.push(`「${clipped}」`)
  lines.push('记得及时回复')
  return {
    title: '收到一条顾客留言',
    content: lines.join('\n'),
    actionUrl: `/subpackages/ai/support-desk/index?ticketId=${encodeURIComponent(ticketId || '')}`,
    relatedId: ticketId || ''
  }
}
async function notifyStaffNewTicket(db, payload) {
  try {
    const openids = await listSupportStaffOpenids(db)
    if (!openids.length) return { success: true, skipped: true, count: 0 }
    const msg = buildMessage(payload || {})
    const now = Date.now()
    let ok = 0
    for (const openid of openids) {
      try {
        await db.collection('user_messages').add({
          data: {
            _openid: openid, openid, recipient: openid,
            category: 'ops', queue: 'workflow', type: 'staff_support_ticket',
            title: msg.title, content: msg.content,
            relatedId: msg.relatedId, actionUrl: msg.actionUrl,
            templateCode: 'staff_support_ticket',
            dedupeKey: `staff_support_ticket:${msg.relatedId}:${openid}:${now}`,
            read: false, createTime: db.serverDate(), _createTime: db.serverDate()
          }
        })
        ok += 1
      } catch (e) { console.warn('staff support message failed:', openid, e && e.message) }
    }
    return { success: ok > 0, count: ok }
  } catch (e) {
    console.warn('notifyStaffNewTicket failed:', e && e.message)
    return { success: false, count: 0 }
  }
}
module.exports = { notifyStaffNewTicket, listSupportStaffOpenids, buildMessage }
