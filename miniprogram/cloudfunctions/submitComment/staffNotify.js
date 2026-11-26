/**
 * 用户评价 → 员工「工作信息」通知（2026-11-25 产品负责人）
 *
 * 诉求：「工作信息新增：收到用户商品评价，请记得及时回复类型通知」。
 * 口径：
 *   · 只通知**能进「用户评价」页的人**（该页菜单键只进超管清单），即超管 / 店长；
 *   · 消息进 `user_messages` 的 `workflow` 队列（工作信息），带 5 星 / 藏品 / 摘录 / 深链；
 *   · 深链直达工作台「用户评价」(tab 17)，点开就能回复；
 *   · 发信失败只记 warn，**不阻断评价提交**（提交成败与通知解耦）。
 */

const MAX_RECIPIENTS = 50

function uniq(list) {
  return Array.from(new Set((list || []).filter(Boolean)))
}

function envAdminOpenids() {
  return String(process.env.MESSAGE_ADMIN_OPENIDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function staffRolesOf(row) {
  const out = []
  if (!row) return out
  if (Array.isArray(row.roles)) out.push(...row.roles)
  if (row.role) out.push(String(row.role))
  if (row.workspaceRole) out.push(String(row.workspaceRole))
  return out.map((r) => String(r || '').trim()).filter(Boolean)
}

/** 能处理评价的人：超管（env / users.isAdmin / staff_members 里的 super_admin / manager） */
async function listReviewStaffOpenids(db) {
  const openids = envAdminOpenids()
  try {
    const res = await db.collection('users').where({ isAdmin: true }).limit(50).get()
    ;(res.data || []).forEach((u) => {
      const oid = (u && (u._openid || u.openid)) || ''
      if (oid) openids.push(oid)
    })
  } catch (e) {
    // 可选来源，失败不影响
  }
  try {
    const res = await db.collection('staff_members').where({ status: 'active' }).limit(200).get()
    ;(res.data || []).forEach((row) => {
      const oid = (row && row.openid) || ''
      if (!oid) return
      const roles = staffRolesOf(row)
      if (roles.some((r) => r === 'super_admin' || r === 'manager' || r === 'store_manager')) openids.push(oid)
    })
  } catch (e) {
    console.warn('listReviewStaffOpenids staff_members', e && e.message)
  }
  return uniq(openids).slice(0, MAX_RECIPIENTS)
}

function buildMessage({ commentId, rating, content, productTitle, orderId, kind }) {
  const excerpt = String(content || '').replace(/\s+/g, ' ').trim()
  const clipped = excerpt.length > 40 ? `${excerpt.slice(0, 40)}…` : excerpt
  // 2026-11-27：追加评价复用同一条通知链路，标题与首行区分
  const isAppend = kind === 'append'
  const title = isAppend ? '收到一条追加评价' : '收到一条商品评价'
  const lines = []
  if (isAppend) lines.push(`追评${productTitle ? ` · ${productTitle}` : ''}`)
  else lines.push(`${'★'.repeat(Math.max(0, Math.min(5, Number(rating) || 0)))}${rating ? ` ${rating} 星` : ''}${productTitle ? ` · ${productTitle}` : ''}`)
  if (clipped) lines.push(`「${clipped}」`)
  lines.push('记得及时回复')
  return {
    title,
    content: lines.join('\n'),
    actionUrl: `/subpackages/manager/manager/index?tab=17&title=${encodeURIComponent('用户评价')}`,
    relatedId: commentId || '',
    orderId: orderId || ''
  }
}

async function notifyStaffNewComment(db, payload) {
  try {
    const openids = await listReviewStaffOpenids(db)
    if (!openids.length) return { success: true, skipped: true, count: 0 }
    const msg = buildMessage(payload || {})
    const now = Date.now()
    let ok = 0
    for (const openid of openids) {
      try {
        await db.collection('user_messages').add({
          data: {
            _openid: openid,
            openid,
            recipient: openid,
            category: 'ops',
            queue: 'workflow',
            type: 'staff_comment_new',
            title: msg.title,
            content: msg.content,
            relatedId: msg.relatedId,
            orderId: msg.orderId || '',
            actionUrl: msg.actionUrl,
            templateCode: 'staff_comment_new',
            dedupeKey: `staff_comment_new:${msg.relatedId}:${openid}:${now}`,
            read: false,
            createTime: db.serverDate(),
            _createTime: db.serverDate()
          }
        })
        ok += 1
      } catch (e) {
        console.warn('staff comment message failed:', openid, e && e.message)
      }
    }
    return { success: ok > 0, count: ok }
  } catch (e) {
    console.warn('notifyStaffNewComment failed:', e && e.message)
    return { success: false, count: 0 }
  }
}

module.exports = { notifyStaffNewComment, listReviewStaffOpenids, buildMessage }
