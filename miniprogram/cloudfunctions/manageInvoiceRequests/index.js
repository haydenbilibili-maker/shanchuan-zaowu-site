/**
 * 店长开票申请管理（一期半自动）
 *
 * action: list | detail | markIssued | reject | overview
 * 集合：invoice_requests
 * 鉴权：staffGuard — manager + manageInvoiceRequests
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')
const { dispatchInAppMessage } = require('./inAppMessage')
const { ACTION, resolveApproverRole, actorWorkspaceRole } = require('./approvalRules')
const { enqueueApproval, markApprovalDecided } = require('./approvalBridge')
// 来源判定统一真源（负向子串判定对互调合并串会判反，详见 sourceOrigin.js 顶部说明）
const { isNonClientSource } = require('./sourceOrigin')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTION = 'invoice_requests'
const PERMISSION = 'manageInvoiceRequests'
const PAGE_SIZE_MAX = 50

const STATUS_PENDING = 'pending'
const STATUS_ISSUED = 'issued'
const STATUS_REJECTED = 'rejected'
const VALID_FILTERS = ['', STATUS_PENDING, STATUS_ISSUED, STATUS_REJECTED]

const STATUS_LABELS = {
  pending: '待开具',
  issued: '已开具',
  rejected: '已驳回'
}

function fail(msg, extra) {
  return { success: false, msg, ...(extra || {}) }
}

function toMs(value) {
  if (!value) return 0
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  if (typeof value.getTime === 'function') return value.getTime()
  const n = Date.parse(value)
  return Number.isFinite(n) ? n : 0
}

function maskTaxNo(taxNo) {
  const s = String(taxNo || '').trim()
  if (!s) return ''
  if (s.length <= 6) return s
  return `${s.slice(0, 4)}****${s.slice(-4)}`
}

function formatRow(doc) {
  if (!doc) return null
  return {
    _id: doc._id,
    orderNo: doc.orderNo || '',
    orderId: doc.orderId || '',
    invoiceType: doc.invoiceType || '',
    invoiceTypeLabel: doc.invoiceTypeLabel || (doc.invoiceType === 'company' ? '企业' : '个人'),
    title: doc.title || '',
    taxNo: doc.taxNo || '',
    taxNoMasked: maskTaxNo(doc.taxNo),
    email: doc.email || '',
    phone: doc.phone || '',
    remark: doc.remark || '',
    status: doc.status || STATUS_PENDING,
    statusLabel: STATUS_LABELS[doc.status] || doc.status || '待开具',
    source: doc.source || '',
    orderMatch: doc.orderMatch || null,
    createTime: toMs(doc.createTime || doc._createTime),
    handledAt: toMs(doc.handledAt),
    handledBy: doc.handledBy || '',
    handledByName: doc.handledByName || '',
    staffNote: doc.staffNote || '',
    invoiceNo: doc.invoiceNo || '',
    rejectReason: doc.rejectReason || ''
  }
}

async function requireManager(openid, options = {}) {
  return assertStaff(db, openid, {
    role: ROLE_MANAGER,
    permission: PERMISSION,
    adminOpsKey: options.adminOpsKey
  })
}

async function listRequests(event) {
  const status = String((event && event.status) || '').trim()
  if (VALID_FILTERS.indexOf(status) === -1) {
    return fail('状态筛选无效')
  }
  const page = Math.max(1, parseInt((event && event.page) || 1, 10) || 1)
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, parseInt((event && event.pageSize) || 20, 10) || 20)
  )
  const skip = (page - 1) * pageSize

  const where = status ? { status } : {}
  let query = db.collection(COLLECTION)
  if (status) query = query.where(where)

  let list = []
  let total = 0
  try {
    const [listRes, countRes] = await Promise.all([
      query.orderBy('createTime', 'desc').skip(skip).limit(pageSize).get(),
      status
        ? db.collection(COLLECTION).where(where).count()
        : db.collection(COLLECTION).count()
    ])
    list = (listRes.data || []).map(formatRow)
    total = (countRes && countRes.total) || 0
  } catch (err) {
    // createTime 索引缺失时降级为 _createTime / 无排序
    console.warn('list orderBy createTime failed, fallback:', err && err.message)
    try {
      let q2 = db.collection(COLLECTION)
      if (status) q2 = q2.where(where)
      const listRes = await q2.orderBy('_createTime', 'desc').skip(skip).limit(pageSize).get()
      list = (listRes.data || []).map(formatRow)
      const countRes = status
        ? await db.collection(COLLECTION).where(where).count()
        : await db.collection(COLLECTION).count()
      total = (countRes && countRes.total) || 0
    } catch (err2) {
      console.warn('list fallback failed:', err2 && err2.message)
      let q3 = db.collection(COLLECTION)
      if (status) q3 = q3.where(where)
      const listRes = await q3.skip(skip).limit(pageSize).get()
      list = (listRes.data || [])
        .map(formatRow)
        .sort((a, b) => (b.createTime || 0) - (a.createTime || 0))
      total = list.length + skip
    }
  }

  return {
    success: true,
    list,
    page,
    pageSize,
    total,
    hasMore: skip + list.length < total,
    statusLabels: STATUS_LABELS
  }
}

const OVERVIEW_FETCH_CAP = 500

function pctOf(count, max) {
  if (!max) return 0
  return Math.round((count / max) * 1000) / 10
}

function toBars(entries) {
  const max = entries.reduce((m, e) => Math.max(m, e.count || 0), 0) || 1
  return entries.map((e) => ({
    ...e,
    pct: pctOf(e.count || 0, max)
  }))
}

async function safeCount(where) {
  try {
    const res = Object.keys(where || {}).length
      ? await db.collection(COLLECTION).where(where).count()
      : await db.collection(COLLECTION).count()
    return res.total || 0
  } catch (e) {
    return 0
  }
}

/** 数据概览：待办 / 状态 / 抬头类型 */
async function overview() {
  const [pending, issued, rejected] = await Promise.all([
    safeCount({ status: STATUS_PENDING }),
    safeCount({ status: STATUS_ISSUED }),
    safeCount({ status: STATUS_REJECTED })
  ])
  const total = pending + issued + rejected

  let pendingRows = []
  let dataCapped = false
  try {
    const res = await db.collection(COLLECTION)
      .where({ status: STATUS_PENDING })
      .orderBy('createTime', 'desc')
      .limit(OVERVIEW_FETCH_CAP)
      .get()
    pendingRows = res.data || []
    dataCapped = pending > pendingRows.length
  } catch (e) {
    try {
      const res = await db.collection(COLLECTION)
        .where({ status: STATUS_PENDING })
        .limit(OVERVIEW_FETCH_CAP)
        .get()
      pendingRows = res.data || []
      dataCapped = pending > pendingRows.length
    } catch (e2) {
      console.warn('invoice overview sample', e2 && e2.message)
    }
  }

  let companyPending = 0
  let personalPending = 0
  for (const row of pendingRows) {
    if (row.invoiceType === 'company') companyPending += 1
    else personalPending += 1
  }

  const statusBars = toBars([
    { key: 'pending', name: '待开具', count: pending },
    { key: 'issued', name: '已开具', count: issued },
    { key: 'rejected', name: '已驳回', count: rejected }
  ])
  const typeBars = toBars([
    { key: 'company', name: '企业', count: companyPending },
    { key: 'personal', name: '个人', count: personalPending }
  ])

  return {
    success: true,
    dataCapped,
    fetchCap: OVERVIEW_FETCH_CAP,
    totalLoaded: pendingRows.length,
    definitions: {
      pending: '待开具队列 · 需线下开具后回标',
      status: '全量状态分布（精确 count）',
      type: '待开具抬头类型（采样聚合）'
    },
    pending: {
      count: pending,
      company: companyPending,
      personal: personalPending,
      sampled: pendingRows.length,
      typeBars
    },
    status: {
      total,
      pending,
      issued,
      rejected,
      bars: statusBars
    },
    type: {
      bars: typeBars,
      sampled: pendingRows.length
    }
  }
}

async function getDetail(event) {
  const id = String((event && event.id) || (event && event.requestId) || '').trim()
  if (!id) return fail('缺少申请 ID')
  try {
    const doc = await db.collection(COLLECTION).doc(id).get()
    if (!doc || !doc.data) return fail('申请不存在')
    return { success: true, item: formatRow(doc.data) }
  } catch (err) {
    return fail(err.message || '读取失败')
  }
}

async function loadPending(id) {
  const doc = await db.collection(COLLECTION).doc(id).get()
  const data = doc && doc.data
  if (!data) return { ok: false, msg: '申请不存在' }
  if (data.status !== STATUS_PENDING) {
    return {
      ok: false,
      msg: `当前状态为「${STATUS_LABELS[data.status] || data.status}」，不可再操作`,
      item: formatRow(data)
    }
  }
  return { ok: true, data }
}

async function markIssued(event, actor) {
  const id = String((event && event.id) || (event && event.requestId) || '').trim()
  if (!id) return fail('缺少申请 ID')
  const invoiceNo = String((event && event.invoiceNo) || '').trim().slice(0, 80)
  const staffNote = String((event && event.staffNote) || (event && event.note) || '')
    .trim()
    .slice(0, 500)

  let loaded
  try {
    loaded = await loadPending(id)
  } catch (err) {
    return fail(err.message || '读取失败')
  }
  if (!loaded.ok) return fail(loaded.msg, { item: loaded.item })

  const data = loaded.data
  const fromApproval = !!(event && event._fromApproval)
  const ws = actorWorkspaceRole(actor)
  const approverRole = fromApproval ? null : resolveApproverRole(ACTION.INVOICE_ISSUE, ws)

  if (approverRole) {
    const enqueued = await enqueueApproval(db, {
      actionType: ACTION.INVOICE_ISSUE,
      applicantOpenid: actor.openid || '',
      applicantName: actor.name || '',
      applicantRole: actor.role || '',
      applicantWorkspaceRole: ws,
      relatedId: id,
      storeId: data.storeId || '',
      title: `开具发票 ${data.orderNo || id}`,
      summary: `${data.invoiceTypeLabel || ''} · ${data.title || ''}`,
      payload: { requestId: id, invoiceNo, staffNote, orderNo: data.orderNo || '' },
      source: 'manageInvoiceRequests',
      approverRole
    })
    if (!enqueued.ok) return fail(enqueued.msg || '提交开票审批失败')
    return {
      success: true,
      pendingApproval: true,
      approvalId: enqueued.approvalId,
      msg: '已提交超管审核开具，通过后将标记已开具并通知用户'
    }
  }

  try {
    await db.collection(COLLECTION).doc(id).update({
      data: {
        status: STATUS_ISSUED,
        invoiceNo,
        staffNote,
        handledAt: db.serverDate(),
        handledBy: actor.openid,
        handledByName: actor.name || '',
        updateTime: db.serverDate()
      }
    })
  } catch (err) {
    return fail(err.message || '更新失败')
  }

  const applicant = data._openid || data.openid || ''
  if (applicant) {
    await dispatchInAppMessage(db, {
      eventType: 'invoice_request_issued',
      openid: applicant,
      relatedId: id,
      vars: {
        orderNo: data.orderNo || '',
        title: data.title || '',
        invoiceNo,
        email: data.email || '',
        staffNote
      }
    }).catch((err) => console.warn('invoice issued message failed:', err))
  }

  await markApprovalDecided(db, {
    relatedId: id,
    actionType: ACTION.INVOICE_ISSUE,
    status: 'approved',
    decidedBy: actor.openid || '',
    decidedByName: actor.name || '',
    source: 'manageInvoiceRequests.markIssued'
  })

  return {
    success: true,
    msg: '已标记开具',
    item: formatRow({
      ...data,
      _id: id,
      status: STATUS_ISSUED,
      invoiceNo,
      staffNote,
      handledBy: actor.openid,
      handledByName: actor.name || '',
      handledAt: Date.now()
    })
  }
}

async function rejectRequest(event, actor) {
  const id = String((event && event.id) || (event && event.requestId) || '').trim()
  if (!id) return fail('缺少申请 ID')
  const rejectReason = String(
    (event && event.rejectReason) || (event && event.reason) || (event && event.staffNote) || ''
  )
    .trim()
    .slice(0, 500)
  if (!rejectReason) return fail('请填写驳回原因')

  let loaded
  try {
    loaded = await loadPending(id)
  } catch (err) {
    return fail(err.message || '读取失败')
  }
  if (!loaded.ok) return fail(loaded.msg, { item: loaded.item })

  const data = loaded.data
  try {
    await db.collection(COLLECTION).doc(id).update({
      data: {
        status: STATUS_REJECTED,
        rejectReason,
        staffNote: rejectReason,
        handledAt: db.serverDate(),
        handledBy: actor.openid,
        handledByName: actor.name || '',
        updateTime: db.serverDate()
      }
    })
  } catch (err) {
    return fail(err.message || '更新失败')
  }

  const applicant = data._openid || data.openid || ''
  if (applicant) {
    await dispatchInAppMessage(db, {
      eventType: 'invoice_request_rejected',
      openid: applicant,
      relatedId: id,
      vars: {
        orderNo: data.orderNo || '',
        title: data.title || '',
        rejectReason
      }
    }).catch((err) => console.warn('invoice rejected message failed:', err))
  }

  return {
    success: true,
    msg: '已驳回',
    item: formatRow({
      ...data,
      _id: id,
      status: STATUS_REJECTED,
      rejectReason,
      staffNote: rejectReason,
      handledBy: actor.openid,
      handledByName: actor.name || '',
      handledAt: Date.now()
    })
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  let openid = wxContext.OPENID || ''
  if (!openid && isNonClientSource() && event && event._fromApproval && event._callerOpenid) {
    openid = String(event._callerOpenid).trim()
  }
  const action = String((event && event.action) || '').trim()
  const adminOpsKey = event && event.adminOpsKey

  // Admin Web 可无 OPENID，改用 ADMIN_OPS_KEY（与 Orders 发货/退款一致）
  if (!openid && !adminOpsKey) return fail('未登录')
  if (!action) return fail('缺少 action')

  const guard = await requireManager(openid, { adminOpsKey })
  if (!guard.ok) {
    return { success: false, code: guard.code, msg: guard.msg }
  }

  try {
    if (action === 'list') return await listRequests(event)
    if (action === 'overview') return await overview()
    if (action === 'detail' || action === 'get') return await getDetail(event)
    if (action === 'markIssued' || action === 'issue') {
      return await markIssued(event, guard.actor)
    }
    if (action === 'reject') {
      return await rejectRequest(event, guard.actor)
    }
    return fail(`未知 action: ${action}`)
  } catch (err) {
    console.error('manageInvoiceRequests error:', action, err)
    return fail(err.message || '操作失败')
  }
}
