/**
 * 山海有信 — 后台管理（记录 / 留言回复 / 模板）
 * 鉴权：staffGuard — manager + pushMessage
 */
const cloud = require('wx-server-sdk')
const { assertStaff: _assertStaff, ROLE_MANAGER } = require('./staffGuard')

/**
 * 鉴权包装（2026-09-15 修复）：Admin Web 经 /api/cloud-fn 调用时，代理会把密钥注入
 * event.adminOpsKey，而 staffGuard 只比较 options.adminOpsKey —— 原实现从不透传，
 * 导致 ERP 调用本函数一律 NOT_LOGGED_IN。此处统一从 globalThis 取用。
 *
 * 注意：入口对 globalThis.__adminOpsKey 必须**无条件赋值**（无密钥时置空）。
 * 预热容器会跨请求复用 globalThis，若只在有密钥时赋值，上一个请求的超管身份
 * 会泄漏给下一个无密钥请求。
 */
function assertStaff(db, openid, options = {}) {
  const opts = { ...(options || {}) }
  if (opts.adminOpsKey == null) opts.adminOpsKey = globalThis.__adminOpsKey || ''
  return _assertStaff(db, openid, opts)
}


cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  globalThis.__adminOpsKey = (event && event.adminOpsKey) || ''
  const { action } = event
  const wxContext = cloud.getWXContext()
  const operatorOpenid = wxContext.OPENID

  const guard = await assertStaff(db, operatorOpenid, {
    role: ROLE_MANAGER,
    permission: 'pushMessage'
  })
  if (!guard.ok) {
    return { success: false, code: guard.code, msg: guard.msg }
  }

  try {
    switch (action) {
      case 'getCampaigns':
        return await getCampaigns(event)
      case 'getRecentLogs':
        return await getRecentLogs(event)
      case 'getTemplates':
        return await getTemplates()
      case 'updateTemplate':
        return await updateTemplate(event, operatorOpenid)
      case 'listSupportTickets':
        return await listSupportTickets(event)
      case 'countSupportPending':
        return await countSupportPending()
      case 'addSupportNote':
        return await addSupportNote(event, operatorOpenid)
      case 'getCustomerContext':
        return await getCustomerContext(event)
      case 'remindOverdue':
        return await remindOverdue(event)
      case 'getSupportTicket':
        return await getSupportTicket(event)
      case 'replySupportTicket':
        return await replySupportTicket(event, operatorOpenid)
      case 'setSupportTicketStatus':
        return await setSupportTicketStatus(event, operatorOpenid)
      default:
        return { success: false, msg: '未知 action' }
    }
  } catch (err) {
    console.error('messageAdmin error:', err)
    return { success: false, msg: err.message || '操作失败' }
  }
}

async function getCampaigns(event) {
  const limit = Math.min(event.limit || 30, 50)
  try {
    const res = await db.collection('push_campaigns')
      .orderBy('createTime', 'desc')
      .limit(limit)
      .get()
    return { success: true, list: res.data || [] }
  } catch (e) {
    return { success: true, list: [] }
  }
}

async function getRecentLogs(event) {
  const limit = Math.min(event.limit || 30, 50)
  try {
    const res = await db.collection('notification_logs')
      .orderBy('sentAt', 'desc')
      .limit(limit)
      .get()
    return { success: true, list: res.data || [] }
  } catch (e) {
    try {
      const res = await db.collection('notification_logs').limit(limit).get()
      const sorted = (res.data || []).sort((a, b) => {
        const ta = new Date(a.sentAt || 0).getTime()
        const tb = new Date(b.sentAt || 0).getTime()
        return tb - ta
      })
      return { success: true, list: sorted }
    } catch (e2) {
      return { success: true, list: [] }
    }
  }
}

async function getTemplates() {
  try {
    const res = await db.collection('message_templates').limit(100).get()
    if (res.data && res.data.length) {
      return { success: true, list: res.data }
    }
  } catch (e) {
    // fall through
  }
  return { success: true, list: [], needSeed: true }
}

async function updateTemplate(event, operatorOpenid) {
  const { templateCode, titleTemplate, contentTemplate, enabled } = event
  if (!templateCode) return { success: false, msg: '缺少 templateCode' }

  const res = await db.collection('message_templates').where({ templateCode }).limit(1).get()
  const patch = {
    updatedAt: db.serverDate(),
    updatedBy: operatorOpenid
  }
  if (titleTemplate !== undefined) patch.titleTemplate = titleTemplate
  if (contentTemplate !== undefined) patch.contentTemplate = contentTemplate
  if (enabled !== undefined) patch.enabled = !!enabled

  if (res.data && res.data[0]) {
    await db.collection('message_templates').doc(res.data[0]._id).update({ data: patch })
  } else {
    await db.collection('message_templates').add({
      data: {
        templateCode,
        category: 'system',
        priority: 'P1',
        titleTemplate: titleTemplate || '',
        contentTemplate: contentTemplate || '',
        enabled: enabled !== false,
        ...patch
      }
    })
  }
  return { success: true }
}

async function listSupportTickets(event) {
  const status = event.status || 'pending'
  // 2026-11-26：客服工作台需要「全部（含已回复）」与待处理两档
  const col = db.collection('support_tickets')
  const query = status === 'all' ? col : col.where({ status })
  // 2026-11-27 客服工作台：分页（skip，旁路新增；不传时与原来一致取最新 50 条）
  const PAGE = 50
  const skip = Math.max(0, Math.min(Number(event.skip) || 0, 2000))
  const res = await query.orderBy('createTime', 'desc').skip(skip).limit(PAGE).get()
  return { success: true, list: await attachMemberLabels(res.data || []), hasMore: (res.data || []).length === PAGE }
}

/** 客服工作台：单条留言详情（含历史回复） */
async function getSupportTicket(event) {
  const id = String(event.ticketId || '').trim()
  if (!id) return { success: false, msg: '缺少 ticketId' }
  try {
    const res = await db.collection('support_tickets').doc(id).get()
    const doc = res.data
    if (!doc) return { success: false, msg: '留言不存在' }
    const rows = await attachMemberLabels([doc])
    return { success: true, ticket: rows[0] }
  } catch (e) {
    return { success: false, msg: '留言不存在' }
  }
}

/** 与积分 / 储值 / 定金同算法：openid 末 8 位 → MT-XXXX-XXXX */
function buildMemberNo(openid) {
  if (!openid || openid.length < 8) return ''
  const shortId = openid.substr(openid.length - 8).toUpperCase()
  return `MT-${shortId.substr(0, 4)}-${shortId.substr(4, 4)}`
}

/**
 * 工单卡右上角用昵称 / 会员号代替 openid 片段（2026-10-01 产品负责人真机反馈）：
 * 只在原行上新增 memberNickName / memberNo 两个出参字段，只读 users 的 nickName / memberNo（不读手机号）；
 * 读 users 失败不影响列表，会员号回退同算法。
 */
async function attachMemberLabels(list) {
  const rows = Array.isArray(list) ? list : []
  const _ = db.command
  const openids = Array.from(new Set(rows.map((r) => r._openid).filter(Boolean)))
  const users = {}
  for (let i = 0; i < openids.length; i += 20) {
    const slice = openids.slice(i, i + 20)
    try {
      const res = await db.collection('users').where({ _openid: _.in(slice) })
        .field({ _openid: true, nickName: true, memberNo: true }).limit(slice.length).get()
      ;(res.data || []).forEach((u) => { if (u && u._openid) users[u._openid] = u })
    } catch (e) { /* 只影响展示，回退会员号 */ }
  }
  return rows.map((r) => {
    const u = r._openid ? users[r._openid] : null
    return {
      ...r,
      memberNickName: (u && u.nickName) ? String(u.nickName) : '',
      memberNo: (u && u.memberNo) ? String(u.memberNo) : buildMemberNo(r._openid)
    }
  })
}

const SUPPORT_MAX_RECIPIENTS = 50
function uniqOpenids(list) { return Array.from(new Set((list || []).filter(Boolean))) }
function envAdminOpenids() {
  return String(process.env.MESSAGE_ADMIN_OPENIDS || '').split(',').map((x) => x.trim()).filter(Boolean)
}
function staffRolesOfRow(row) {
  const out = []
  if (!row) return out
  if (Array.isArray(row.roles)) out.push(...row.roles)
  if (row.role) out.push(String(row.role))
  if (row.workspaceRole) out.push(String(row.workspaceRole))
  return out.map((r) => String(r || '').trim()).filter(Boolean)
}
/** 能处理留言的人：env 管理员 / users.isAdmin / staff_members 的 super_admin·manager·store_manager */
async function listSupportStaffOpenids() {
  const openids = envAdminOpenids()
  try {
    const res = await db.collection('users').where({ isAdmin: true }).limit(50).get()
    ;(res.data || []).forEach((u) => { const oid = (u && (u._openid || u.openid)) || ''; if (oid) openids.push(oid) })
  } catch (e) { /* 可选 */ }
  try {
    const res = await db.collection('staff_members').where({ status: 'active' }).limit(200).get()
    ;(res.data || []).forEach((row) => {
      const oid = (row && row.openid) || ''
      if (!oid) return
      if (staffRolesOfRow(row).some((r) => r === 'super_admin' || r === 'manager' || r === 'store_manager')) openids.push(oid)
    })
  } catch (e) { console.warn('listSupportStaffOpenids', e && e.message) }
  return uniqOpenids(openids).slice(0, SUPPORT_MAX_RECIPIENTS)
}

/**
 * 客服工作台 2026-11-27 升级：
 *  · countSupportPending  待回复数量（我的·工作台瓦片角标 + 语音播报）
 *  · addSupportNote       内部备注（只员工可见，永不发给顾客）
 *  · getCustomerContext   顾客 360（订单 / 评价 / 留言 计数与最近记录）
 *  · remindOverdue        超时未回复提醒（12 小时仍未回 → 再发一条工作信息，置 remindedAt）
 */
async function countSupportPending() {
  try {
    const res = await db.collection('support_tickets').where({ status: 'pending' }).count()
    return { success: true, count: Number((res && res.total) || 0) }
  } catch (e) {
    return { success: true, count: 0 }
  }
}

async function addSupportNote(event, operatorOpenid) {
  const ticketId = String((event && event.ticketId) || '').trim()
  const note = String((event && event.note) || '').trim()
  if (!ticketId || note.length < 1) return { success: false, msg: '请填写备注' }
  if (note.length > 300) return { success: false, msg: '备注不超过 300 字' }
  try {
    const doc = await db.collection('support_tickets').doc(ticketId).get()
    const t = doc.data
    if (!t) return { success: false, msg: '留言不存在' }
    const notes = Array.isArray(t.notes) ? t.notes.slice(-29) : []
    notes.push({ text: note, at: Date.now(), by: String(operatorOpenid || '') })
    await db.collection('support_tickets').doc(ticketId).update({ data: { notes } })
    return { success: true, notes }
  } catch (e) {
    return { success: false, msg: '备注保存失败' }
  }
}

async function getCustomerContext(event) {
  const openid = String((event && event.openid) || '').trim()
  if (!openid) return { success: false, msg: '缺少顾客标识' }
  const _ = db.command
  let orders = []
  let orderCount = 0
  try {
    const r = await db.collection('orders').where({ _openid: openid }).orderBy('createTime', 'desc').limit(5).get()
    orders = (r.data || []).map((o) => ({
      id: o._id,
      no: o.orderNo || String(o._id || '').slice(-8),
      title: (o.products && o.products[0] && (o.products[0].title || o.products[0].name)) || '订单',
      amount: Number(o.totalPrice || o.payAmount || 0),
      status: o.status || ''
    }))
    const c = await db.collection('orders').where({ _openid: openid }).count()
    orderCount = Number((c && c.total) || 0)
  } catch (e) { /* 可选 */ }
  let commentCount = 0
  let ticketCount = 0
  try { commentCount = Number(((await db.collection('comments').where({ _openid: openid }).count()) || {}).total || 0) } catch (e) {}
  try { ticketCount = Number(((await db.collection('support_tickets').where({ _openid: openid }).count()) || {}).total || 0) } catch (e) {}
  return { success: true, orderCount, orders, commentCount, ticketCount }
}

async function remindOverdue(event) {
  const hours = Math.max(1, Math.min(72, Number((event && event.hours) || 12)))
  const cutoff = Date.now() - hours * 3600 * 1000
  let reminded = 0
  try {
    const res = await db.collection('support_tickets')
      .where({ status: 'pending' })
      .orderBy('createTime', 'asc')
      .limit(20)
      .get()
    const rows = (res.data || []).filter((t) => {
      const created = t.createTime ? new Date(t.createTime).getTime() : 0
      return created && created < cutoff && !t.remindedAt
    })
    if (!rows.length) return { success: true, reminded: 0 }
    const openids = await listSupportStaffOpenids()
    const now = Date.now()
    for (const t of rows) {
      for (const oid of openids) {
        try {
          await db.collection('user_messages').add({
            data: {
              _openid: oid, openid: oid, recipient: oid,
              category: 'ops', queue: 'workflow', type: 'staff_support_overdue',
              title: '留言还没回复',
              content: `「${t.topicLabel || '顾客留言'}」已超过 ${hours} 小时未回复，记得处理`,
              relatedId: t._id,
              actionUrl: `/subpackages/ai/support-desk/index?ticketId=${encodeURIComponent(t._id)}`,
              templateCode: 'staff_support_overdue',
              dedupeKey: `staff_support_overdue:${t._id}:${oid}:${now}`,
              read: false, createTime: db.serverDate(), _createTime: db.serverDate()
            }
          })
        } catch (e) { /* 尽力而为 */ }
      }
      try {
        await db.collection('support_tickets').doc(t._id).update({ data: { remindedAt: db.serverDate() } })
        reminded += 1
      } catch (e) { /* ignore */ }
    }
    return { success: true, reminded }
  } catch (e) {
    return { success: false, reminded: 0, msg: (e && e.message) || '提醒失败' }
  }
}

/** ERP 工单页：标记已处理 / 归档（support_tickets 客户端 write:false） */
// 2026-11-27 客服工作台：已解决的可以「重新打开」回到待回复（pending → reopenedAt）
const TICKET_STATUS_STAMP = { resolved: 'resolveTime', archived: 'archivedAt', pending: 'reopenedAt' }

async function setSupportTicketStatus(event, operatorOpenid) {
  const ticketId = String((event && event.ticketId) || '').trim()
  const status = String((event && event.status) || '').trim()
  if (!ticketId) return { success: false, msg: '缺少工单 id' }
  if (!TICKET_STATUS_STAMP[status]) return { success: false, msg: '不支持的工单状态' }
  const res = await db.collection('support_tickets').where({ _id: ticketId }).update({
    data: {
      status,
      [TICKET_STATUS_STAMP[status]]: db.serverDate(),
      statusUpdatedBy: operatorOpenid || 'admin_web'
    }
  })
  if (!res || !res.stats || res.stats.updated !== 1) return { success: false, msg: '工单不存在' }
  return { success: true, ticketId, status }
}

async function replySupportTicket(event, operatorOpenid) {
  const { ticketId, replyContent } = event
  const content = String(replyContent || '').trim()
  if (!ticketId || content.length < 2) {
    return { success: false, msg: '请填写回复内容' }
  }
  if (content.length > 500) {
    return { success: false, msg: '回复不超过 500 字' }
  }

  const ticketRes = await db.collection('support_tickets').doc(ticketId).get()
  const ticket = ticketRes.data
  if (!ticket) return { success: false, msg: '工单不存在' }

  // 2026-11-26：留言回复保留历史（客服工作台要看到全部往来），最新一条仍写 replyContent 兼容旧读取
  const history = Array.isArray(ticket.replies) ? ticket.replies.slice(-19) : []
  history.push({ content, at: Date.now(), by: String(operatorOpenid || '') })
  await db.collection('support_tickets').doc(ticketId).update({
    data: {
      status: 'replied',
      replyContent: content,
      replies: history,
      repliedAt: db.serverDate(),
      repliedBy: operatorOpenid
    }
  })

  // 给顾客的「山海有信」带完整回复正文（原实现只带 120 字预览，详情看不到）
  //
  // ⚠️ 2026-11-26 修复「客服工作台回复后用户收不到」：
  // 原实现只靠 `cloud.callFunction('dispatchMessage')` 模板派发；模板行缺失 / 模板被改坏 /
  // 组件内调用失败时**静默不落库**（返回值也没检查），用户侧什么都收不到。
  // 现在**直接写 user_messages（customer 队列）**作为主路径，模板派发退化为 best-effort。
  const detail = content.length > 500 ? content.slice(0, 500) : content
  const topicLabel = ticket.topicLabel || '咨询'
  let delivered = false
  try {
    const now = Date.now()
    await db.collection('user_messages').add({
      data: {
        _openid: ticket._openid,
        openid: ticket._openid,
        recipient: ticket._openid,
        category: 'system',
        queue: 'customer',
        type: 'support_ticket_replied',
        title: '专员已回复',
        content: `${topicLabel}\n${detail}`,
        // 2026-11-27 修复「追加回复不通知」：山海有信按 `type::relatedId` 合并同事件，
        // 同一工单第二次回复会被并进第一条 → relatedId 每次回复带时间戳，去重键仍可追溯工单
        relatedId: `${ticketId}#${now}`,
        ticketId,
        actionUrl: '/subpackages/extra/user/support/index',
        templateCode: 'support_ticket_replied',
        dedupeKey: `support_ticket_replied:${ticketId}:${now}`,
        read: false,
        createTime: db.serverDate(),
        _createTime: db.serverDate()
      }
    })
    delivered = true
  } catch (e) {
    console.error('support reply direct message failed:', e && e.message)
  }

  if (!delivered) {
    try {
      await cloud.callFunction({
        name: 'dispatchMessage',
        data: {
          action: 'dispatch',
          eventType: 'support_ticket_replied',
          openid: ticket._openid,
          relatedId: ticketId,
          vars: { replyContent: detail, topicLabel }
        }
      })
      delivered = true
    } catch (e) {
      console.error('support reply dispatch failed:', e && e.message)
    }
  }

  return { success: true, delivered }
}
