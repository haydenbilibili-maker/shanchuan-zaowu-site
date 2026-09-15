/**
 * 钱包余额读取（支付拆分用）
 *
 * 产品规则：无独立钱包支付折扣；计价只用会员等级折扣（含本单预估定级）。
 * 本模块仅提供账户可用余额，供 useWalletPay 时估算抵扣额。
 */
const ACCOUNTS = 'stored_value_accounts'

async function loadWalletAvailableFen(db, openid) {
  if (!openid) return 0
  try {
    const res = await db.collection(ACCOUNTS).where({ openid }).limit(1).get()
    const acc = (res.data && res.data[0]) || null
    if (!acc) return 0
    if (acc.availableFen != null) return Math.max(0, Number(acc.availableFen) || 0)
    return Math.max(0, (Number(acc.principalFen) || 0) + (Number(acc.bonusFen) || 0))
  } catch (e) {
    return 0
  }
}

module.exports = {
  loadWalletAvailableFen
}
