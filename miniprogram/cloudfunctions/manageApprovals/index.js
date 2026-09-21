/**
 * 统一审批流
 *
 * action:
 *   listPending | listDecided | countPending | listMine | overview
 *   approve | reject | ignore | submitProductShelf | whoami | provision | nudge
 *
 * 集合 staff_approvals；积分族终审仅店长；商品上架店长→超管。
 * 超管列表/计数/概览默认 scope=all（全站可见，不按 approverRole 隔离）；
 * 非超管仍按店长审级过滤。小票认领列表会附带顾客上传附件（临时 HTTPS URL）供审阅。
 */
const cloud = require('wx-server-sdk')
const {
  assertStaff,
  ROLE_MANAGER,
  ROLE_STAFF,
  WORKSPACE_SUPER_ADMIN,
  WORKSPACE_STORE_MANAGER
} = require('./staffGuard')
const { writeAuditLog, auditFromActor } = require('./auditLog')
const {
  COLLECTION,
  STATUS_PENDING,
  STATUS_APPROVED,
  STATUS_REJECTED,
  ACTION,
  ACTION_META,
  APPROVER_MANAGER,
  APPROVER_SUPER,
  SLA_HOURS,
  getMeta,
  requiresRejectReason,
  resolveApproverRole,
  canActorApprove
} = require('./approvalRules')
const { enqueueApproval } = require('./approvalBridge')
const { dispatchInAppMessage } = require('./inAppMessage')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function fail(msg, extra) {
  return { success: false, msg, ...(extra || {}) }
}

function actorWorkspace(actor) {
  if (!actor) return ''
  if (actor.superAdmin || actor.workspaceRole === WORKSPACE_SUPER_ADMIN) return WORKSPACE_SUPER_ADMIN
  if (actor.workspaceRole) return actor.workspaceRole
  if (actor.role === ROLE_MANAGER) return WORKSPACE_STORE_MANAGER
  return 'store_staff'
}

function approverLabel(role) {
  if (role === APPROVER_SUPER) return '超管'
  if (role === APPROVER_MANAGER) return '店长'
  return '上级'
}

/** 超管默认全站可见；店长仅看派给店长审级的单据 */
function listScopeForActor(actor) {
  const ws = actorWorkspace(actor)
  if (ws === WORKSPACE_SUPER_ADMIN) return 'all'
  return APPROVER_MANAGER
}

function applyListScope(where, scope) {
  if (scope && scope !== 'all') where.approverRole = scope
  return where
}

function scopeLabel(scope) {
  if (scope === 'all') return '全站'
  if (scope === APPROVER_SUPER) return '超管审级'
  return '店长审级'
}

async function resolveGuard(event, openid, options = {}) {
  const adminOpsKey = (event && event.adminOpsKey) || globalThis.__adminOpsKey || null
  return assertStaff(db, openid, { ...options, adminOpsKey })
}

function enrichApprovalRow(row, actor) {
  const createdMs = Number(row.createTimeMs) || 0
  const ageHours = createdMs ? (Date.now() - createdMs) / (3600 * 1000) : 0
  const overdue = row.status === STATUS_PENDING && ageHours >= SLA_HOURS
  const meta = ACTION_META[row.actionType]
  const slaLeftHours = row.status === STATUS_PENDING
    ? Math.max(0, Math.round((SLA_HOURS - ageHours) * 10) / 10)
    : 0
  return {
    ...row,
    actionLabel: row.actionLabel || (meta && meta.label) || row.actionType,
    canDecide: !!(actor && row.status === STATUS_PENDING && canActorApprove(actor, row.approverRole)),
    requireRejectReason: !!(meta && meta.requireRejectReason),
    overdue,
    ageHours: Math.round(ageHours * 10) / 10,
    slaLeftHours,
    slaHours: SLA_HOURS,
    approverLabel: row.approverRole === APPROVER_SUPER ? '超管' : (row.approverRole === APPROVER_MANAGER ? '店长' : '上级')
  }
}

function collectCloudFileIds(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => String(item || '').trim())
    .filter((id) => /^cloud:\/\//.test(id) || /^https?:\/\//i.test(id))
    .slice(0, 3)
}

async function toTempUrlMap(fileIds) {
  const cloudIds = [...new Set(
    (fileIds || []).filter((id) => String(id || '').indexOf('cloud://') === 0)
  )]
  const map = {}
  if (!cloudIds.length) return map
  try {
    for (let i = 0; i < cloudIds.length; i += 50) {
      const chunk = cloudIds.slice(i, i + 50)
      const res = await cloud.getTempFileURL({ fileList: chunk })
      ;(res.fileList || []).forEach((f) => {
        if (f && f.fileID) map[f.fileID] = f.tempFileURL || f.fileID
      })
    }
  } catch (e) {
    console.warn('manageApprovals getTempFileURL', e && e.message)
  }
  return map
}

/**
 * 小票认领：从 store_receipt_claims 补齐附件图（临时 HTTPS），供审批中心审阅。
 * 历史单据 payload 可能无 imageFileIds，必须回查业务表。
 */
async function attachReceiptClaimImages(list) {
  const rows = Array.isArray(list) ? list : []
  const receiptRows = rows.filter((row) => row && row.actionType === ACTION.POINTS_RECEIPT_CLAIM)
  if (!receiptRows.length) return rows

  const claimIds = [...new Set(
    receiptRows
      .map((row) => String(row.relatedId || (row.payload && row.payload.claimId) || '').trim())
      .filter(Boolean)
  )]

  const fileIdsByClaim = {}
  // payload 兜底（新提交会写入 imageFileIds）
  receiptRows.forEach((row) => {
    const claimId = String(row.relatedId || (row.payload && row.payload.claimId) || '').trim()
    if (!claimId) return
    const fromPayload = collectCloudFileIds(
      (row.payload && (row.payload.imageFileIds || row.payload.images || row.payload.receiptImages)) || []
    )
    if (fromPayload.length) fileIdsByClaim[claimId] = fromPayload
  })

  if (claimIds.length) {
    try {
      const res = await db.collection('store_receipt_claims')
        .where({ _id: _.in(claimIds) })
        .limit(Math.min(50, claimIds.length))
        .field({ images: true, imageFileIds: true })
        .get()
      ;(res.data || []).forEach((claim) => {
        const ids = collectCloudFileIds(claim.images || claim.imageFileIds || [])
        if (ids.length) fileIdsByClaim[claim._id] = ids
      })
    } catch (e) {
      console.warn('attachReceiptClaimImages load claims', e && e.message)
    }
  }

  const allFileIds = []
  Object.keys(fileIdsByClaim).forEach((id) => {
    ;(fileIdsByClaim[id] || []).forEach((fid) => allFileIds.push(fid))
  })
  const urlMap = await toTempUrlMap(allFileIds)

  return rows.map((row) => {
    if (!row || row.actionType !== ACTION.POINTS_RECEIPT_CLAIM) return row
    const claimId = String(row.relatedId || (row.payload && row.payload.claimId) || '').trim()
    const fileIds = fileIdsByClaim[claimId] || []
    const images = fileIds.map((fid) => urlMap[fid] || fid).filter(Boolean)
    return {
      ...row,
      attachmentImages: images,
      attachmentFileIds: fileIds,
      hasAttachments: images.length > 0
    }
  })
}

/**
 * 门店赠分 / 券核销赠分：从 payload 或 store_purchases 补齐赠分凭证附图
 * （门店现场直接赠分上传小票；券核销环节小票尚未产生，上传的是商品实物图）。
 */
async function attachStoreGrantImages(list) {
  const rows = Array.isArray(list) ? list : []
  const grantRows = rows.filter((row) => row && row.actionType === ACTION.POINTS_STORE_GRANT)
  if (!grantRows.length) return rows

  const purchaseIds = [...new Set(
    grantRows
      .map((row) => String(row.relatedId || (row.payload && row.payload.purchaseId) || '').trim())
      .filter(Boolean)
  )]

  const fileIdsByPurchase = {}
  grantRows.forEach((row) => {
    const purchaseId = String(row.relatedId || (row.payload && row.payload.purchaseId) || '').trim()
    if (!purchaseId) return
    const fromPayload = collectCloudFileIds(
      (row.payload && (row.payload.imageFileIds || row.payload.receiptImages || row.payload.images)) || []
    )
    if (fromPayload.length) fileIdsByPurchase[purchaseId] = fromPayload
  })

  if (purchaseIds.length) {
    try {
      const res = await db.collection('store_purchases')
        .where({ _id: _.in(purchaseIds) })
        .limit(Math.min(50, purchaseIds.length))
        .field({ receiptImages: true, imageFileIds: true })
        .get()
      ;(res.data || []).forEach((purchase) => {
        const ids = collectCloudFileIds(purchase.receiptImages || purchase.imageFileIds || [])
        if (ids.length) fileIdsByPurchase[purchase._id] = ids
      })
    } catch (e) {
      console.warn('attachStoreGrantImages load purchases', e && e.message)
    }
  }

  const allFileIds = []
  Object.keys(fileIdsByPurchase).forEach((id) => {
    ;(fileIdsByPurchase[id] || []).forEach((fid) => allFileIds.push(fid))
  })
  const urlMap = await toTempUrlMap(allFileIds)

  return rows.map((row) => {
    if (!row || row.actionType !== ACTION.POINTS_STORE_GRANT) return row
    const purchaseId = String(row.relatedId || (row.payload && row.payload.purchaseId) || '').trim()
    const fileIds = fileIdsByPurchase[purchaseId] || []
    const images = fileIds.map((fid) => urlMap[fid] || fid).filter(Boolean)
    return {
      ...row,
      attachmentImages: images,
      attachmentFileIds: fileIds,
      hasAttachments: images.length > 0
    }
  })
}

async function attachApprovalImages(list) {
  const withClaims = await attachReceiptClaimImages(list)
  return attachStoreGrantImages(withClaims)
}

// ---------------------------------------------------------------- list / count

async function listPending(event, openid) {
  const guard = await resolveGuard(event, openid, { role: ROLE_MANAGER })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const statusRaw = String((event && event.status) != null ? event.status : STATUS_PENDING).trim()
  const status = statusRaw === 'all' || statusRaw === '' ? '' : statusRaw
  const page = Math.max(1, parseInt((event && event.page) || 1, 10) || 1)
  const pageSize = Math.min(50, Math.max(5, parseInt((event && event.pageSize) || 20, 10) || 20))
  const storeId = String((event && event.storeId) || '').trim()
  const actionType = String((event && event.actionType) || '').trim()

  let scope = String((event && event.scope) || '').trim()
  if (!scope) scope = listScopeForActor(guard.actor)
  if (scope === 'all' && actorWorkspace(guard.actor) !== WORKSPACE_SUPER_ADMIN) {
    scope = APPROVER_MANAGER
  }

  const where = applyListScope({}, scope)
  if (status) where.status = status
  if (storeId) where.storeId = storeId
  if (actionType) where.actionType = actionType

  try {
    const totalRes = await db.collection(COLLECTION).where(where).count()
    const res = await db.collection(COLLECTION)
      .where(where)
      .orderBy('createTimeMs', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()

    const list = await attachApprovalImages(
      (res.data || []).map((row) => enrichApprovalRow(row, guard.actor))
    )
    const overdueCount = list.filter((r) => r.overdue).length

    return {
      success: true,
      list,
      total: totalRes.total || 0,
      hasMore: page * pageSize < (totalRes.total || 0),
      scope,
      workspaceRole: actorWorkspace(guard.actor),
      slaHours: SLA_HOURS,
      overdueCount
    }
  } catch (e) {
    if (/collection|集合/.test(e.message || '')) {
      return {
        success: true,
        list: [],
        total: 0,
        hasMore: false,
        msg: `请先创建集合 ${COLLECTION}`,
        scope,
        slaHours: SLA_HOURS
      }
    }
    console.error('listPending', e)
    return fail(e.message || '加载失败')
  }
}

async function countPending(event, openid) {
  const guard = await resolveGuard(event, openid, { role: ROLE_MANAGER })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const scope = listScopeForActor(guard.actor)
  try {
    const where = applyListScope({ status: STATUS_PENDING }, scope)
    const totalRes = await db.collection(COLLECTION).where(where).count()
    return { success: true, count: totalRes.total || 0, scope }
  } catch (e) {
    return { success: true, count: 0, scope }
  }
}

const OVERVIEW_FETCH_CAP = 500

function pctOf(count, max) {
  if (!max) return 0
  return Math.round((count / max) * 1000) / 10
}

function toBars(entries, maxOverride) {
  const max = maxOverride != null
    ? maxOverride
    : entries.reduce((m, e) => Math.max(m, e.count || 0), 0) || 1
  return entries.map((e) => ({
    ...e,
    pct: pctOf(e.count || 0, max)
  }))
}

/** 数据概览：待办 / 类型分布 / 近 7 日吞吐（对齐 CRM overview） */
async function overview(event, openid) {
  const guard = await resolveGuard(event, openid, { role: ROLE_MANAGER })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const scope = listScopeForActor(guard.actor)
  const wherePending = applyListScope({ status: STATUS_PENDING }, scope)
  const now = Date.now()
  const weekAgo = now - 7 * 24 * 3600 * 1000

  let pendingTotal = 0
  let pendingRows = []
  let dataCapped = false
  try {
    const totalRes = await db.collection(COLLECTION).where(wherePending).count()
    pendingTotal = totalRes.total || 0
    const res = await db.collection(COLLECTION)
      .where(wherePending)
      .orderBy('createTimeMs', 'desc')
      .limit(OVERVIEW_FETCH_CAP)
      .get()
    pendingRows = res.data || []
    dataCapped = pendingTotal > pendingRows.length
  } catch (e) {
    if (!/collection|集合/.test(e.message || '')) {
      console.warn('approvals overview pending', e.message)
    }
  }

  let overdue = 0
  let withinSla = 0
  const ageBucketDefs = [
    { key: 'h0_12', name: '0–12h', maxH: 12 },
    { key: 'h12_24', name: '12–24h', maxH: 24 },
    { key: 'h24_48', name: '24–48h', maxH: 48 },
    { key: 'over', name: '已超时', maxH: Infinity }
  ]
  const ageCounts = { h0_12: 0, h12_24: 0, h24_48: 0, over: 0 }
  const typeCounts = {}

  for (const row of pendingRows) {
    const createdMs = Number(row.createTimeMs) || 0
    const ageH = createdMs ? (now - createdMs) / (3600 * 1000) : 0
    if (ageH >= SLA_HOURS) overdue += 1
    else withinSla += 1

    if (ageH >= SLA_HOURS) ageCounts.over += 1
    else if (ageH >= 24) ageCounts.h24_48 += 1
    else if (ageH >= 12) ageCounts.h12_24 += 1
    else ageCounts.h0_12 += 1

    const typeKey = row.actionType || 'unknown'
    const meta = ACTION_META[typeKey]
    if (!typeCounts[typeKey]) {
      typeCounts[typeKey] = {
        key: typeKey,
        name: (meta && meta.label) || row.actionLabel || typeKey,
        count: 0
      }
    }
    typeCounts[typeKey].count += 1
  }

  const typeBars = toBars(
    Object.values(typeCounts).sort((a, b) => b.count - a.count)
  )
  const ageBars = toBars(
    ageBucketDefs.map((d) => ({ key: d.key, name: d.name, count: ageCounts[d.key] || 0 }))
  )

  let decidedApproved = 0
  let decidedRejected = 0
  let decidedLoaded = 0
  try {
    const decidedWhere = {
      decidedAtMs: _.gte(weekAgo),
      status: _.in([STATUS_APPROVED, STATUS_REJECTED])
    }
    // 非超管仍只统计本人办结；超管看全站近 7 日吞吐
    if (scope !== 'all') decidedWhere.decidedBy = openid
    const decidedRes = await db.collection(COLLECTION)
      .where(decidedWhere)
      .orderBy('decidedAtMs', 'desc')
      .limit(OVERVIEW_FETCH_CAP)
      .get()
    const decidedRows = decidedRes.data || []
    decidedLoaded = decidedRows.length
    for (const row of decidedRows) {
      if (row.status === STATUS_APPROVED) decidedApproved += 1
      else if (row.status === STATUS_REJECTED) decidedRejected += 1
    }
  } catch (e) {
    console.warn('approvals overview decided', e.message)
  }

  const throughputBars = toBars([
    { key: 'approved', name: '已通过', count: decidedApproved },
    { key: 'rejected', name: '已驳回', count: decidedRejected }
  ])

  let minePending = 0
  try {
    const mineRes = await db.collection(COLLECTION)
      .where({ applicantOpenid: openid, status: STATUS_PENDING })
      .count()
    minePending = mineRes.total || 0
  } catch (e) { /* ignore */ }

  return {
    success: true,
    scope,
    slaHours: SLA_HOURS,
    dataCapped,
    fetchCap: OVERVIEW_FETCH_CAP,
    totalLoaded: pendingRows.length,
    definitions: {
      pending: `待审（${scopeLabel(scope)}）· SLA ${SLA_HOURS}h`,
      byType: '待办按类型分布（采样聚合）',
      throughput: scope === 'all'
        ? '近 7 日全站办结的通过 / 驳回'
        : '近 7 日你办结的通过 / 驳回'
    },
    pending: {
      count: pendingTotal,
      overdue,
      withinSla,
      sampled: pendingRows.length,
      ageBars
    },
    byType: {
      bars: typeBars,
      sampled: pendingRows.length
    },
    throughput: {
      days: 7,
      approved: decidedApproved,
      rejected: decidedRejected,
      decidedLoaded,
      minePending,
      bars: throughputBars
    }
  }
}

async function listMine(event, openid) {
  const guard = await resolveGuard(event, openid, { role: ROLE_STAFF })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const page = Math.max(1, parseInt((event && event.page) || 1, 10) || 1)
  const pageSize = Math.min(50, Math.max(5, parseInt((event && event.pageSize) || 20, 10) || 20))
  const statusRaw = String((event && event.status) != null ? event.status : '').trim()
  const actionType = String((event && event.actionType) || '').trim()

  const where = { applicantOpenid: openid }
  if (statusRaw && statusRaw !== 'all') where.status = statusRaw
  if (actionType) where.actionType = actionType

  try {
    const totalRes = await db.collection(COLLECTION).where(where).count()
    const res = await db.collection(COLLECTION)
      .where(where)
      .orderBy('createTimeMs', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    const list = await attachApprovalImages(
      (res.data || []).map((row) => enrichApprovalRow(row, guard.actor))
    )
    return {
      success: true,
      list,
      total: totalRes.total || 0,
      hasMore: page * pageSize < (totalRes.total || 0),
      slaHours: SLA_HOURS,
      workspaceRole: actorWorkspace(guard.actor)
    }
  } catch (e) {
    return { success: true, list: [], total: 0, hasMore: false, slaHours: SLA_HOURS }
  }
}

/** 我已办：由我通过/驳回的单据；超管默认看全站已办结 */
async function listDecided(event, openid) {
  const guard = await resolveGuard(event, openid, { role: ROLE_MANAGER })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const page = Math.max(1, parseInt((event && event.page) || 1, 10) || 1)
  const pageSize = Math.min(50, Math.max(5, parseInt((event && event.pageSize) || 20, 10) || 20))
  const statusRaw = String((event && event.status) != null ? event.status : '').trim()
  const actionType = String((event && event.actionType) || '').trim()
  const scope = listScopeForActor(guard.actor)

  const where = {}
  if (scope !== 'all') where.decidedBy = openid
  if (statusRaw === STATUS_APPROVED || statusRaw === STATUS_REJECTED) {
    where.status = statusRaw
  } else {
    where.status = _.in([STATUS_APPROVED, STATUS_REJECTED])
  }
  if (actionType) where.actionType = actionType

  try {
    const totalRes = await db.collection(COLLECTION).where(where).count()
    const res = await db.collection(COLLECTION)
      .where(where)
      .orderBy('decidedAtMs', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()

    const list = await attachApprovalImages(
      (res.data || []).map((row) => enrichApprovalRow(row, guard.actor))
    )
    return {
      success: true,
      list,
      total: totalRes.total || 0,
      hasMore: page * pageSize < (totalRes.total || 0),
      scope,
      workspaceRole: actorWorkspace(guard.actor),
      slaHours: SLA_HOURS
    }
  } catch (e) {
    // decidedAtMs 索引缺失时回退 createTimeMs
    try {
      const res = await db.collection(COLLECTION)
        .where(where)
        .orderBy('createTimeMs', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()
      const list = await attachApprovalImages(
        (res.data || []).map((row) => enrichApprovalRow(row, guard.actor))
      )
      return {
        success: true,
        list,
        total: (res.data || []).length,
        hasMore: false,
        scope,
        workspaceRole: actorWorkspace(guard.actor),
        slaHours: SLA_HOURS
      }
    } catch (e2) {
      return { success: true, list: [], total: 0, hasMore: false, scope, slaHours: SLA_HOURS }
    }
  }
}

// ---------------------------------------------------------------- execute business

async function executePointsApprove(row, event, openid) {
  const relatedId = row.relatedId
  if (!relatedId) return fail('缺少业务单据')

  if (row.actionType === ACTION.POINTS_STORE_GRANT) {
    const res = await cloud.callFunction({
      name: 'grantStorePoints',
      data: {
        action: 'approve',
        purchaseId: relatedId,
        adminOpsKey: event && event.adminOpsKey,
        _fromApproval: true,
        _callerOpenid: openid
      }
    })
    return res.result || fail('赠分审核调用失败')
  }

  if (row.actionType === ACTION.POINTS_RECEIPT_CLAIM) {
    const amount = (event && event.amount) != null
      ? event.amount
      : (row.payload && row.payload.amount)
    const res = await cloud.callFunction({
      name: 'claimStoreReceipt',
      data: {
        action: 'approve',
        claimId: relatedId,
        amount,
        adminOpsKey: event && event.adminOpsKey,
        _fromApproval: true,
        _callerOpenid: openid
      }
    })
    return res.result || fail('小票审核调用失败')
  }

  if (row.actionType === ACTION.POINTS_PLATFORM_BIND) {
    const amount = (event && event.amount) != null
      ? event.amount
      : (row.payload && row.payload.amount)
    const res = await cloud.callFunction({
      name: 'bindPlatformOrder',
      data: {
        action: 'approve',
        bindId: relatedId,
        amount,
        adminOpsKey: event && event.adminOpsKey,
        _fromApproval: true,
        _callerOpenid: openid
      }
    })
    return res.result || fail('外部订单审核调用失败')
  }

  if (row.actionType === ACTION.POINTS_STORE_REVOKE) {
    const payload = row.payload || {}
    const res = await cloud.callFunction({
      name: 'grantStorePoints',
      data: {
        action: 'revoke',
        purchaseId: relatedId,
        revokeAmount: payload.revokeAmount,
        revokeReason: payload.revokeReason,
        adminOpsKey: event && event.adminOpsKey,
        _fromApproval: true,
        _callerOpenid: openid
      }
    })
    return res.result || fail('积分撤销执行失败')
  }

  return fail(`未实现的积分审批类型: ${row.actionType}`)
}

async function executePointsReject(row, event, openid, reason) {
  const relatedId = row.relatedId
  if (!relatedId) return fail('缺少业务单据')

  if (row.actionType === ACTION.POINTS_STORE_GRANT) {
    const res = await cloud.callFunction({
      name: 'grantStorePoints',
      data: {
        action: 'reject',
        purchaseId: relatedId,
        rejectReason: reason,
        adminOpsKey: event && event.adminOpsKey,
        _fromApproval: true,
        _callerOpenid: openid
      }
    })
    return res.result || fail('赠分驳回调用失败')
  }

  if (row.actionType === ACTION.POINTS_RECEIPT_CLAIM) {
    const res = await cloud.callFunction({
      name: 'claimStoreReceipt',
      data: {
        action: 'reject',
        claimId: relatedId,
        rejectReason: reason,
        adminOpsKey: event && event.adminOpsKey,
        _fromApproval: true,
        _callerOpenid: openid
      }
    })
    return res.result || fail('小票驳回调用失败')
  }

  if (row.actionType === ACTION.POINTS_PLATFORM_BIND) {
    const res = await cloud.callFunction({
      name: 'bindPlatformOrder',
      data: {
        action: 'reject',
        bindId: relatedId,
        rejectReason: reason,
        adminOpsKey: event && event.adminOpsKey,
        _fromApproval: true,
        _callerOpenid: openid
      }
    })
    return res.result || fail('外部订单驳回调用失败')
  }

  // 撤销申请驳回：业务尚未执行，无需回滚
  if (row.actionType === ACTION.POINTS_STORE_REVOKE) {
    return { success: true, msg: '已驳回撤销申请' }
  }

  return fail(`未实现的积分驳回类型: ${row.actionType}`)
}

async function syncProductShelfMeta(productId, patch) {
  if (!productId || !patch || typeof patch !== 'object') return
  try {
    await db.collection('products').doc(productId).update({ data: patch })
  } catch (e) {
    console.warn('syncProductShelfMeta', productId, e && e.message)
  }
}

async function notifyDepositOnShelved(productId) {
  if (!productId) return
  try {
    await cloud.callFunction({
      name: 'manageDeposit',
      data: {
        action: 'onProductShelved',
        productId,
        _internal: true,
        fromApproval: true
      }
    })
  } catch (e) {
    console.warn('notifyDepositOnShelved', productId, e && e.message)
  }
}

async function executeProductShelfOn(row) {
  const productId = row.relatedId || (row.payload && row.payload.productId)
  if (!productId) return fail('缺少商品 id')

  try {
    await db.collection('products').doc(productId).update({
      data: {
        isOffShelf: false,
        shelfApprovalStatus: 'approved',
        shelfApprovalId: row._id || '',
        shelfRejectReason: '',
        shelfApprovedAt: db.serverDate(),
        shelfApprovedFrom: row._id || '',
        shelfUpdatedAt: db.serverDate()
      }
    })
    await notifyDepositOnShelved(productId)
    return { success: true, productId, msg: '商品已上架' }
  } catch (e) {
    console.error('executeProductShelfOn', e)
    return fail(e.message || '上架写入失败')
  }
}

async function executeOrderRefund(row, event, openid) {
  const orderId = row.relatedId || (row.payload && row.payload.orderId)
  if (!orderId) return fail('缺少订单 id')
  const res = await cloud.callFunction({
    name: 'refundOrder',
    data: {
      orderId,
      adminOpsKey: event && event.adminOpsKey,
      _fromApproval: true,
      _callerOpenid: openid
    }
  })
  return res.result || fail('退款执行失败')
}

async function executeOrderShipSensitive(row, event, openid) {
  const orderId = row.relatedId || (row.payload && row.payload.orderId)
  if (!orderId) return fail('缺少订单 id')
  const payload = row.payload || {}
  const res = await cloud.callFunction({
    name: 'managerShipOrder',
    data: {
      orderId,
      carrier: payload.carrier || '快递',
      trackingNumber: payload.trackingNumber || '',
      // 发货包装图片（可选）：起单人上传时存进审批 payload，放行时原样回传；
      // 漏这一行 = 走审批的敏感发货永远丢图（静默，只有顾客发现信里没图）
      packagePhotos: payload.packagePhotos,
      adminOpsKey: event && event.adminOpsKey,
      _fromApproval: true,
      _callerOpenid: openid
    }
  })
  return res.result || fail('发货执行失败')
}

async function executeInvoiceIssue(row, event, openid) {
  const requestId = row.relatedId || (row.payload && row.payload.requestId)
  if (!requestId) return fail('缺少发票申请 id')
  const payload = row.payload || {}
  const res = await cloud.callFunction({
    name: 'manageInvoiceRequests',
    data: {
      action: 'markIssued',
      id: requestId,
      invoiceNo: payload.invoiceNo || '',
      staffNote: payload.staffNote || '',
      adminOpsKey: event && event.adminOpsKey,
      _fromApproval: true,
      _callerOpenid: openid
    }
  })
  return res.result || fail('发票开具执行失败')
}

async function executeBookingReverse(row, event, openid) {
  const bookingId = row.relatedId || (row.payload && row.payload.bookingId)
  if (!bookingId) return fail('缺少预约 id')
  const res = await cloud.callFunction({
    name: 'verifyBooking',
    data: {
      action: 'reverse',
      bookingId,
      storeId: (row.payload && row.payload.storeId) || row.storeId || '',
      adminOpsKey: event && event.adminOpsKey,
      _fromApproval: true,
      _callerOpenid: openid
    }
  })
  return res.result || fail('核销冲正执行失败')
}

async function executeStorePointRules(row, event, openid) {
  const payload = row.payload || {}
  const res = await cloud.callFunction({
    name: 'getStorePointRules',
    data: {
      action: 'save',
      ruleDocId: payload.ruleDocId || row.relatedId || '',
      config: payload.config || {},
      adminOpsKey: event && event.adminOpsKey,
      _fromApproval: true,
      _callerOpenid: openid
    }
  })
  return res.result || fail('积分规则写入失败')
}

async function nudgeApproval(event, openid) {
  const approvalId = String((event && event.approvalId) || '').trim()
  if (!approvalId) return fail('缺少审批单 id')
  const row = await loadApproval(approvalId)
  if (!row) return fail('审批单不存在')
  if (row.status !== STATUS_PENDING) return fail('该单不是待审状态')

  const guard = await resolveGuard(event, openid, { role: ROLE_STAFF })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }
  if (row.applicantOpenid !== openid && !guard.actor.superAdmin) {
    return fail('仅申请人或超管可催办')
  }

  const createdMs = Number(row.createTimeMs) || 0
  const ageHours = createdMs ? (Date.now() - createdMs) / (3600 * 1000) : 0
  if (ageHours < 4) {
    return fail('提交未满 4 小时，请稍后再催办')
  }
  const lastNudge = Number(row.lastNudgeAtMs) || 0
  if (lastNudge && Date.now() - lastNudge < 12 * 3600 * 1000) {
    return fail('12 小时内已催办过，请稍后再试')
  }

  // 轻量：站内信通知申请人自己确认已催办；真正审批人由队列 overdue 高亮驱动
  try {
    await dispatchInAppMessage(db, {
      eventType: 'approval_submitted',
      openid: row.applicantOpenid || openid,
      relatedId: approvalId,
      vars: {
        title: row.title || '审批',
        approverLabel: row.approverRole === APPROVER_SUPER ? '超管' : '店长'
      }
    })
  } catch (e) { /* ignore */ }

  try {
    await db.collection(COLLECTION).doc(approvalId).update({
      data: {
        lastNudgeAtMs: Date.now(),
        nudgeCount: (Number(row.nudgeCount) || 0) + 1
      }
    })
  } catch (e) {
    console.warn('nudge update', e && e.message)
  }

  await writeAuditLog(db, auditFromActor(guard.actor, {
    action: 'approval_nudge',
    relatedId: approvalId,
    relatedType: COLLECTION,
    detail: { actionType: row.actionType || '' },
    source: 'manageApprovals'
  }))

  return { success: true, msg: '已记录催办，请等待审批人处理', overdue: ageHours >= SLA_HOURS }
}

// ---------------------------------------------------------------- approve / reject

async function loadApproval(approvalId) {
  try {
    const res = await db.collection(COLLECTION).doc(approvalId).get()
    return res.data || null
  } catch (e) {
    return null
  }
}

async function approve(event, openid) {
  const approvalId = String((event && event.approvalId) || '').trim()
  if (!approvalId) return fail('缺少审批单 id')

  const row = await loadApproval(approvalId)
  if (!row) return fail('审批单不存在')
  if (row.status !== STATUS_PENDING) return fail('该单不是待审状态')

  const guard = await resolveGuard(event, openid, {
    role: row.approverRole === APPROVER_SUPER ? ROLE_MANAGER : ROLE_MANAGER,
    storeId: row.storeId || undefined,
    requireSuperAdmin: row.approverRole === APPROVER_SUPER
  })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }
  if (!canActorApprove(guard.actor, row.approverRole)) {
    return fail('当前角色无权审批此单')
  }

  const meta = getMeta(row.actionType)
  let execResult = { success: true }

  if (meta && meta.pointsFamily) {
    execResult = await executePointsApprove(row, event, openid)
  } else if (row.actionType === ACTION.PRODUCT_SHELF_ON) {
    execResult = await executeProductShelfOn(row)
  } else if (row.actionType === ACTION.ORDER_REFUND) {
    execResult = await executeOrderRefund(row, event, openid)
  } else if (row.actionType === ACTION.ORDER_SHIP_SENSITIVE) {
    execResult = await executeOrderShipSensitive(row, event, openid)
  } else if (row.actionType === ACTION.INVOICE_ISSUE) {
    execResult = await executeInvoiceIssue(row, event, openid)
  } else if (row.actionType === ACTION.BOOKING_VERIFY_REVERSE) {
    execResult = await executeBookingReverse(row, event, openid)
  } else if (row.actionType === ACTION.STORE_POINT_RULES) {
    execResult = await executeStorePointRules(row, event, openid)
  } else {
    return fail(`未知 actionType: ${row.actionType}`)
  }

  if (!execResult || execResult.success === false) {
    return execResult || fail('业务执行失败')
  }

  try {
    await db.collection(COLLECTION).doc(approvalId).update({
      data: {
        status: STATUS_APPROVED,
        decidedBy: openid,
        decidedByName: guard.actor.name || '',
        decidedAt: db.serverDate(),
        decidedAtMs: Date.now(),
        executeResult: {
          success: true,
          msg: execResult.msg || '',
          pointsGranted: execResult.pointsGranted || 0
        }
      }
    })
  } catch (e) {
    console.error('approve status update', e)
  }

  await writeAuditLog(db, auditFromActor(guard.actor, {
    action: 'approval_approve',
    relatedId: approvalId,
    relatedType: COLLECTION,
    detail: { actionType: row.actionType, relatedId: row.relatedId || '' },
    source: 'manageApprovals'
  }))

  if (row.applicantOpenid && row.applicantOpenid !== openid) {
    try {
      await dispatchInAppMessage(db, {
        eventType: 'approval_approved',
        openid: row.applicantOpenid,
        relatedId: approvalId,
        vars: {
          title: row.title || (meta && meta.label) || '申请',
          deciderName: guard.actor.name || ''
        }
      })
    } catch (e) {
      console.warn('approval_approved notify skipped', e.message)
    }
  }

  return {
    success: true,
    approvalId,
    msg: execResult.msg || '已通过',
    execute: execResult
  }
}

async function reject(event, openid) {
  const approvalId = String((event && event.approvalId) || '').trim()
  if (!approvalId) return fail('缺少审批单 id')
  const reasonRaw = String((event && event.rejectReason) || '').trim().slice(0, 200)

  const row = await loadApproval(approvalId)
  if (!row) return fail('审批单不存在')
  if (row.status !== STATUS_PENDING) return fail('该单不是待审状态')

  if (requiresRejectReason(row.actionType) && reasonRaw.length < 2) {
    return fail('请填写驳回原因（至少 2 字）')
  }
  const reason = reasonRaw || '已驳回'

  const guard = await resolveGuard(event, openid, {
    role: ROLE_MANAGER,
    storeId: row.storeId || undefined,
    requireSuperAdmin: row.approverRole === APPROVER_SUPER
  })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }
  if (!canActorApprove(guard.actor, row.approverRole)) {
    return fail('当前角色无权审批此单')
  }

  const meta = getMeta(row.actionType)
  let execResult = { success: true }

  if (meta && meta.pointsFamily) {
    execResult = await executePointsReject(row, event, openid, reason)
    if (!execResult || execResult.success === false) {
      return execResult || fail('业务驳回失败')
    }
  }

  // 商品上架驳回：保持下架，回写 shelfApprovalStatus 供藏品库水印
  if (row.actionType === ACTION.PRODUCT_SHELF_ON) {
    const productId = row.relatedId || (row.payload && row.payload.productId) || ''
    await syncProductShelfMeta(productId, {
      shelfApprovalStatus: 'rejected',
      shelfApprovalId: approvalId,
      shelfRejectReason: reason,
      shelfUpdatedAt: db.serverDate()
    })
  }

  // 退款驳回：清 refundPendingApproval，并恢复订单状态
  if (row.actionType === ACTION.ORDER_REFUND) {
    const orderId = row.relatedId || (row.payload && row.payload.orderId) || ''
    if (orderId) {
      const res = await cloud.callFunction({
        name: 'refundOrder',
        data: {
          action: 'reject',
          orderId,
          reason,
          adminOpsKey: event && event.adminOpsKey,
          _fromApproval: true,
          _callerOpenid: openid
        }
      })
      execResult = res.result || fail('退款驳回同步失败')
      if (!execResult || execResult.success === false) {
        return execResult || fail('退款驳回同步失败')
      }
    }
  }

  try {
    await db.collection(COLLECTION).doc(approvalId).update({
      data: {
        status: STATUS_REJECTED,
        rejectReason: reason,
        decidedBy: openid,
        decidedByName: guard.actor.name || '',
        decidedAt: db.serverDate(),
        decidedAtMs: Date.now()
      }
    })
  } catch (e) {
    return fail('驳回状态更新失败')
  }

  await writeAuditLog(db, auditFromActor(guard.actor, {
    action: 'approval_reject',
    relatedId: approvalId,
    relatedType: COLLECTION,
    detail: { actionType: row.actionType, reason, relatedId: row.relatedId || '' },
    source: 'manageApprovals'
  }))

  if (row.applicantOpenid && row.applicantOpenid !== openid) {
    try {
      await dispatchInAppMessage(db, {
        eventType: 'approval_rejected',
        openid: row.applicantOpenid,
        relatedId: approvalId,
        vars: {
          title: row.title || (meta && meta.label) || '申请',
          reason
        }
      })
    } catch (e) {
      console.warn('approval_rejected notify skipped', e.message)
    }
  }

  return { success: true, approvalId, msg: '已驳回' }
}

/**
 * 忽略小票认领：不入账、不推顾客「未通过」；业务侧 status=ignored，
 * 审批单按 rejected + 说明清出待审（与 claimStoreReceipt.ignore / 门店积分页一致）。
 */
async function ignore(event, openid) {
  const approvalId = String((event && event.approvalId) || '').trim()
  if (!approvalId) return fail('缺少审批单 id')

  const row = await loadApproval(approvalId)
  if (!row) return fail('审批单不存在')
  if (row.status !== STATUS_PENDING) return fail('该单不是待审状态')
  if (row.actionType !== ACTION.POINTS_RECEIPT_CLAIM) {
    return fail('仅小票认领支持忽略')
  }

  const guard = await resolveGuard(event, openid, {
    role: ROLE_MANAGER,
    storeId: row.storeId || undefined
  })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }
  if (!canActorApprove(guard.actor, row.approverRole)) {
    return fail('当前角色无权处理此单')
  }

  const relatedId = row.relatedId || (row.payload && row.payload.claimId) || ''
  if (!relatedId) return fail('缺少业务单据')

  let execResult
  try {
    const res = await cloud.callFunction({
      name: 'claimStoreReceipt',
      data: {
        action: 'ignore',
        claimId: relatedId,
        adminOpsKey: event && event.adminOpsKey,
        _fromApproval: true,
        _callerOpenid: openid
      }
    })
    execResult = res.result || fail('小票忽略调用失败')
  } catch (e) {
    return fail((e && e.message) || '小票忽略调用失败')
  }

  if (!execResult || execResult.success === false) {
    return execResult || fail('忽略失败')
  }

  const note = '店长忽略（不入账）'
  try {
    await db.collection(COLLECTION).doc(approvalId).update({
      data: {
        status: STATUS_REJECTED,
        rejectReason: note,
        decidedBy: openid,
        decidedByName: guard.actor.name || '',
        decidedAt: db.serverDate(),
        decidedAtMs: Date.now(),
        executeResult: {
          success: true,
          msg: execResult.msg || '已忽略',
          ignored: true
        }
      }
    })
  } catch (e) {
    // claimStoreReceipt.ignore 已通过 markApprovalDecided 同步，此处失败不阻断
    console.warn('ignore approval status update', e && e.message)
  }

  await writeAuditLog(db, auditFromActor(guard.actor, {
    action: 'approval_ignore',
    relatedId: approvalId,
    relatedType: COLLECTION,
    detail: { actionType: row.actionType, relatedId: String(relatedId), ignored: true },
    source: 'manageApprovals'
  }))

  // 刻意不发 approval_rejected / 顾客未通过站内信（与门店积分「忽略」一致）
  return {
    success: true,
    approvalId,
    msg: execResult.msg || '已忽略该小票申请',
    execute: execResult
  }
}

// ---------------------------------------------------------------- product shelf

async function resolveArtisanFramerId(openid) {
  if (!openid) return ''
  try {
    const res = await db.collection('framers').where({ staffOpenid: openid }).limit(1).get()
    const row = res.data && res.data[0]
    return row && row._id ? String(row._id) : ''
  } catch (e) {
    return ''
  }
}

function productOwnedByArtisan(product, openid, framerId) {
  if (!product) return false
  if (openid && String(product.createdByOpenid || '') === String(openid)) return true
  if (framerId && String(product.framerId || '') === String(framerId)) return true
  return false
}

function isManagerLevelActor(actor) {
  if (!actor) return false
  if (actor.superAdmin) return true
  const ws = actorWorkspace(actor)
  return ws === WORKSPACE_SUPER_ADMIN || ws === WORKSPACE_STORE_MANAGER || actor.role === ROLE_MANAGER
}

async function assertProductShelfAccess(event, openid, product) {
  const guard = await resolveGuard(event, openid, { role: ROLE_STAFF, permission: 'manageProducts' })
  if (!guard.ok) return { ok: false, code: guard.code, msg: guard.msg }
  if (isManagerLevelActor(guard.actor)) {
    return { ok: true, actor: guard.actor, manager: true }
  }
  const framerId = await resolveArtisanFramerId(openid)
  if (!productOwnedByArtisan(product, openid, framerId)) {
    return { ok: false, code: 'FORBIDDEN', msg: '只能操作本人藏品' }
  }
  return { ok: true, actor: guard.actor, manager: false }
}

async function submitProductShelf(event, openid) {
  const productId = String((event && event.productId) || '').trim()
  if (!productId) return fail('缺少商品 id')

  let product = null
  try {
    const res = await db.collection('products').doc(productId).get()
    product = res.data
  } catch (e) {
    return fail('商品不存在')
  }
  if (!product) return fail('商品不存在')

  const access = await assertProductShelfAccess(event, openid, product)
  if (!access.ok) return { success: false, code: access.code, msg: access.msg }

  const wantOnShelf = event && event.onShelf !== false && event.onShelf !== 'false'
  // 仅上架走审批；下架对本人工品 / 店长直写
  if (!wantOnShelf) {
    const guard = { actor: access.actor, ok: true }
    try {
      let keepPending = false
      try {
        const dup = await db.collection(COLLECTION)
          .where({
            actionType: ACTION.PRODUCT_SHELF_ON,
            relatedId: productId,
            status: STATUS_PENDING
          })
          .limit(1)
          .get()
        keepPending = !!(dup.data && dup.data.length)
      } catch (e) { /* ignore */ }
      const offPatch = {
        isOffShelf: true,
        shelfUpdatedAt: db.serverDate()
      }
      // 保留待审水印；已上架/已驳回态下架后清掉「已上架」
      if (keepPending) {
        offPatch.shelfApprovalStatus = 'pending'
      } else {
        offPatch.shelfApprovalStatus = ''
        offPatch.shelfRejectReason = ''
      }
      await db.collection('products').doc(productId).update({ data: offPatch })
      await writeAuditLog(db, auditFromActor(guard.actor, {
        action: 'product_shelf_off',
        relatedId: productId,
        relatedType: 'products',
        detail: {},
        source: 'manageApprovals'
      }))
      return { success: true, productId, onShelf: false, direct: true, msg: '已下架' }
    } catch (e) {
      return fail(e.message || '下架失败')
    }
  }

  const guard = { actor: access.actor, ok: true }

  const ws = actorWorkspace(guard.actor)
  const approverRole = resolveApproverRole(ACTION.PRODUCT_SHELF_ON, ws)

  // 超管直通
  if (!approverRole) {
    try {
      await db.collection('products').doc(productId).update({
        data: {
          isOffShelf: false,
          shelfApprovalStatus: 'approved',
          shelfApprovalId: '',
          shelfRejectReason: '',
          shelfApprovedAt: db.serverDate(),
          shelfUpdatedAt: db.serverDate()
        }
      })
      await writeAuditLog(db, auditFromActor(guard.actor, {
        action: 'product_shelf_on_direct',
        relatedId: productId,
        relatedType: 'products',
        detail: {},
        source: 'manageApprovals'
      }))
      await notifyDepositOnShelved(productId)
      return { success: true, productId, onShelf: true, direct: true, msg: '已上架' }
    } catch (e) {
      return fail(e.message || '上架失败')
    }
  }

  // 已有待审上架单
  try {
    const dup = await db.collection(COLLECTION)
      .where({
        actionType: ACTION.PRODUCT_SHELF_ON,
        relatedId: productId,
        status: STATUS_PENDING
      })
      .limit(1)
      .get()
    if (dup.data && dup.data.length) {
      await syncProductShelfMeta(productId, {
        shelfApprovalStatus: 'pending',
        shelfApprovalId: dup.data[0]._id,
        shelfUpdatedAt: db.serverDate()
      })
      return {
        success: true,
        pendingApproval: true,
        approvalId: dup.data[0]._id,
        msg: '该商品已有上架待审单，请等待超管审核'
      }
    }
  } catch (e) { /* ignore */ }

  const title = String(product.title || '商品').slice(0, 40)
  const enqueued = await enqueueApproval(db, {
    actionType: ACTION.PRODUCT_SHELF_ON,
    applicantOpenid: openid,
    applicantName: guard.actor.name || '',
    applicantRole: guard.actor.role || '',
    applicantWorkspaceRole: ws,
    relatedId: productId,
    storeId: String((event && event.storeId) || '').trim(),
    title: `上架「${title}」`,
    summary: `${access.manager ? '店长' : '标本师'}申请上架 · ¥${product.price != null ? product.price : '—'}`,
    payload: {
      productId,
      title,
      price: product.price,
      category: product.category || '',
      cover: (Array.isArray(product.images) && product.images[0]) || product.cover || ''
    },
    source: 'manageApprovals.submitProductShelf',
    approverRole
  })

  if (!enqueued.ok) {
    return fail(enqueued.msg || '提交审批失败')
  }

  await syncProductShelfMeta(productId, {
    shelfApprovalStatus: 'pending',
    shelfApprovalId: enqueued.approvalId || '',
    shelfRejectReason: '',
    shelfUpdatedAt: db.serverDate()
  })

  await writeAuditLog(db, auditFromActor(guard.actor, {
    action: 'product_shelf_on_submit',
    relatedId: productId,
    relatedType: 'products',
    detail: { approvalId: enqueued.approvalId || '' },
    source: 'manageApprovals'
  }))

  return {
    success: true,
    pendingApproval: true,
    approvalId: enqueued.approvalId,
    productId,
    onShelf: false,
    msg: `已提交超管审核上架「${title}」`
  }
}

async function whoami(event, openid) {
  const guard = await resolveGuard(event, openid, { role: ROLE_STAFF })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }
  const scope = listScopeForActor(guard.actor)
  let pending = 0
  try {
    const where = applyListScope({ status: STATUS_PENDING }, scope)
    const c = await db.collection(COLLECTION).where(where).count()
    pending = c.total || 0
  } catch (e) { /* ignore */ }
  return {
    success: true,
    workspaceRole: actorWorkspace(guard.actor),
    scope,
    pendingCount: pending,
    actionTypes: Object.keys(ACTION_META)
  }
}

async function provisionCollection(event, openid) {
  const guard = await resolveGuard(event, openid, { role: ROLE_MANAGER, requireSuperAdmin: true })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const pingId = `_provision_${Date.now()}`
  try {
    await db.collection(COLLECTION).add({
      data: {
        _id: pingId,
        actionType: '_provision',
        status: 'cancelled',
        title: '集合探测',
        createTimeMs: Date.now(),
        createTime: db.serverDate(),
        note: 'auto provision ping; safe to delete'
      }
    })
  } catch (e) {
    // 部分环境不允许自定义 _id
    try {
      const added = await db.collection(COLLECTION).add({
        data: {
          actionType: '_provision',
          status: 'cancelled',
          title: '集合探测',
          createTimeMs: Date.now(),
          createTime: db.serverDate()
        }
      })
      try {
        await db.collection(COLLECTION).doc(added._id).remove()
      } catch (e2) { /* keep ping */ }
      return {
        success: true,
        msg: `集合 ${COLLECTION} 可用`,
        collection: COLLECTION,
        indexesHint: [
          'status + approverRole + createTimeMs',
          'relatedId + actionType + status',
          'applicantOpenid + createTimeMs'
        ]
      }
    } catch (e2) {
      return fail(e2.message || `请手动创建集合 ${COLLECTION}`)
    }
  }

  try {
    await db.collection(COLLECTION).doc(pingId).remove()
  } catch (e) { /* ignore */ }

  return {
    success: true,
    msg: `集合 ${COLLECTION} 可用`,
    collection: COLLECTION,
    indexesHint: [
      'status + approverRole + createTimeMs',
      'relatedId + actionType + status',
      'applicantOpenid + createTimeMs'
    ]
  }
}

// ---------------------------------------------------------------- main

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const adminOpsKey = event && event.adminOpsKey
  if (adminOpsKey) globalThis.__adminOpsKey = adminOpsKey

  const action = (event && event.action) || 'listPending'
  const staffActions = [
    'listPending', 'listDecided', 'countPending', 'listMine', 'overview',
    'approve', 'reject', 'ignore', 'submitProductShelf', 'whoami', 'provision', 'nudge'
  ]

  if (!openid && !(adminOpsKey && staffActions.indexOf(action) !== -1)) {
    return fail('请先登录')
  }

  const actorOpenid = openid || 'admin_ops'

  try {
    switch (action) {
      case 'listPending':
        return await listPending(event, actorOpenid)
      case 'listDecided':
        return await listDecided(event, actorOpenid)
      case 'countPending':
        return await countPending(event, actorOpenid)
      case 'listMine':
        return await listMine(event, actorOpenid)
      case 'overview':
        return await overview(event, actorOpenid)
      case 'approve':
        return await approve(event, actorOpenid)
      case 'reject':
        return await reject(event, actorOpenid)
      case 'ignore':
        return await ignore(event, actorOpenid)
      case 'submitProductShelf':
        return await submitProductShelf(event, actorOpenid)
      case 'whoami':
        return await whoami(event, actorOpenid)
      case 'provision':
        return await provisionCollection(event, actorOpenid)
      case 'nudge':
        return await nudgeApproval(event, actorOpenid)
      default:
        return fail(`未知 action: ${action}`)
    }
  } catch (e) {
    console.error('manageApprovals', action, e)
    return fail(e.message || '系统错误')
  }
}
