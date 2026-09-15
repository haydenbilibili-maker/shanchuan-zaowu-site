/** 微信支付配置（payOrder / refundOrder 共用） */
const ENV_ID = process.env.TCB_ENV || process.env.SCF_NAMESPACE || 'cloud1-8gnkty5bfff9f0bf'
const SUB_MCH_ID = process.env.WX_PAY_SUB_MCH_ID || ''

function parseYuanToFen(amount) {
  const num = parseFloat(String(amount || 0).replace(/,/g, ''))
  if (!num || num <= 0) return 0
  return Math.round(num * 100)
}

function getAdminOpenids() {
  const env = process.env.MESSAGE_ADMIN_OPENIDS || ''
  return env.split(',').map((s) => s.trim()).filter(Boolean)
}

/**
 * 是否具备退款管理员身份：
 * 1) MESSAGE_ADMIN_OPENIDS
 * 2) users.isAdmin
 * 3) 可选 ADMIN_OPS_KEY（Admin Web 调用时传入 event.adminOpsKey）
 */
async function isUserAdmin(db, openid, options = {}) {
  const opsKey = process.env.ADMIN_OPS_KEY || ''
  if (opsKey && options.adminOpsKey && String(options.adminOpsKey) === opsKey) {
    return true
  }
  if (openid && getAdminOpenids().indexOf(openid) !== -1) {
    return true
  }
  if (!openid) return false
  try {
    const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
    return !!(res.data[0] && res.data[0].isAdmin === true)
  } catch (e) {
    return false
  }
}

module.exports = { ENV_ID, SUB_MCH_ID, parseYuanToFen, isUserAdmin, getAdminOpenids }
