/**
 * 审批记录写入 / 状态同步 — 供业务云函数与 manageApprovals 共用（复制到各目录）
 */
const {
  COLLECTION,
  STATUS_PENDING,
  STATUS_APPROVED,
  STATUS_REJECTED,
  getMeta,
  resolveApproverRole
} = require('./approvalRules')

async function enqueueApproval(db, input = {}) {
  if (!db) return { ok: false, msg: 'no db' }
  const actionType = String(input.actionType || '').trim()
  const meta = getMeta(actionType)
  if (!meta) return { ok: false, msg: `未知 actionType: ${actionType}` }

  const applicantWorkspaceRole = String(input.applicantWorkspaceRole || '').trim()
  const approverRole = input.approverRole != null
    ? input.approverRole
    : resolveApproverRole(actionType, applicantWorkspaceRole)

  // 直通：不写审批单
  if (!approverRole) {
    return { ok: true, skipped: true, reason: 'direct' }
  }

  const relatedId = String(input.relatedId || '').trim()
  const nowMs = Date.now()

  // 同 relatedId + actionType 的 pending 去重
  if (relatedId) {
    try {
      const dup = await db.collection(COLLECTION)
        .where({
          actionType,
          relatedId,
          status: STATUS_PENDING
        })
        .limit(1)
        .get()
      if (dup.data && dup.data.length) {
        return { ok: true, skipped: true, reason: 'duplicate', approvalId: dup.data[0]._id }
      }
    } catch (e) {
      // 集合未建时继续尝试 add，由调用方处理
    }
  }

  const doc = {
    actionType,
    actionLabel: meta.label,
    payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
    status: STATUS_PENDING,
    applicantOpenid: String(input.applicantOpenid || '').slice(0, 128),
    applicantName: String(input.applicantName || '').slice(0, 40),
    applicantRole: String(input.applicantRole || '').slice(0, 32),
    applicantWorkspaceRole: applicantWorkspaceRole.slice(0, 32),
    approverRole,
    finalApproverRole: meta.finalApproverRole,
    relatedId,
    relatedType: meta.relatedType,
    storeId: String(input.storeId || '').slice(0, 64),
    title: String(input.title || meta.label).slice(0, 80),
    summary: String(input.summary || '').slice(0, 200),
    rejectReason: '',
    decidedBy: '',
    decidedByName: '',
    decidedAt: null,
    createTime: db.serverDate(),
    createTimeMs: nowMs,
    source: String(input.source || '').slice(0, 64)
  }

  try {
    const added = await db.collection(COLLECTION).add({ data: doc })
    return { ok: true, approvalId: added._id, approverRole }
  } catch (e) {
    console.warn('enqueueApproval', e && e.message)
    return { ok: false, msg: e.message || '审批单写入失败' }
  }
}

/**
 * 业务侧旧审批路径通过/驳回后，同步 staff_approvals 状态
 */
async function markApprovalDecided(db, input = {}) {
  if (!db) return
  const relatedId = String(input.relatedId || '').trim()
  const actionType = String(input.actionType || '').trim()
  if (!relatedId || !actionType) return

  const status = input.status === STATUS_REJECTED ? STATUS_REJECTED : STATUS_APPROVED
  try {
    const res = await db.collection(COLLECTION)
      .where({
        relatedId,
        actionType,
        status: STATUS_PENDING
      })
      .limit(5)
      .get()
    const rows = res.data || []
    await Promise.all(rows.map((row) =>
      db.collection(COLLECTION).doc(row._id).update({
        data: {
          status,
          rejectReason: String(input.rejectReason || '').slice(0, 200),
          decidedBy: String(input.decidedBy || '').slice(0, 128),
          decidedByName: String(input.decidedByName || '').slice(0, 40),
          decidedAt: db.serverDate(),
          decidedAtMs: Date.now(),
          syncFrom: String(input.source || '').slice(0, 64)
        }
      })
    ))
  } catch (e) {
    console.warn('markApprovalDecided', e && e.message)
  }
}

module.exports = { enqueueApproval, markApprovalDecided }
