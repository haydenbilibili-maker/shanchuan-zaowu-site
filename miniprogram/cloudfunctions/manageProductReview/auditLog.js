/**
 * 轻量审计日志 — 写入 staff_audit_logs，失败不阻断主流程
 */
async function writeAuditLog(db, payload = {}) {
  if (!db) return
  try {
    const action = String(payload.action || '').trim().slice(0, 64)
    if (!action) return
    await db.collection('staff_audit_logs').add({
      data: {
        openid: String(payload.openid || '').slice(0, 128),
        workspaceRole: String(payload.workspaceRole || '').slice(0, 32),
        role: String(payload.role || '').slice(0, 32),
        action,
        relatedId: String(payload.relatedId || '').slice(0, 128),
        relatedType: String(payload.relatedType || '').slice(0, 64),
        detail: payload.detail && typeof payload.detail === 'object' ? payload.detail : {},
        source: String(payload.source || '').slice(0, 64),
        createdAt: db.serverDate(),
        createdAtMs: Date.now()
      }
    })
  } catch (e) {
    console.warn('writeAuditLog', e && e.message)
  }
}

function auditFromActor(actor, fields) {
  return {
    openid: (actor && actor.openid) || '',
    workspaceRole: (actor && actor.workspaceRole) || '',
    role: (actor && actor.role) || '',
    ...(fields || {})
  }
}

module.exports = { writeAuditLog, auditFromActor }
