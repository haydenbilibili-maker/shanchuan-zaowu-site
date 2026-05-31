/** 微信支付配置（payOrder / refundOrder 共用） */
const ENV_ID = process.env.TCB_ENV || process.env.SCF_NAMESPACE || 'cloud1-8gnkty5bfff9f0bf'
const SUB_MCH_ID = process.env.WX_PAY_SUB_MCH_ID || ''

function parseYuanToFen(amount) {
  const num = parseFloat(String(amount || 0).replace(/,/g, ''))
  if (!num || num <= 0) return 0
  return Math.round(num * 100)
}

async function isUserAdmin(db, openid) {
  if (!openid) return false
  try {
    const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
    return !!(res.data[0] && res.data[0].isAdmin === true)
  } catch (e) {
    return false
  }
}

module.exports = { ENV_ID, SUB_MCH_ID, parseYuanToFen, isUserAdmin }
