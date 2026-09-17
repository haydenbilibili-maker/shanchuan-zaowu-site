/**
 * 店长/超管账本 · 小程序 GMV 1% 应捐（与 C 端 onePercentPledge 分位口径一致）
 * 基数仅限小程序净 GMV = mpOnline − mpRefund；不含 POS / 现金 / 遗留线上。
 */

/**
 * @param {number|string} amountYuan
 * @returns {number}
 */
function calcOnePercentYuan(amountYuan) {
  const yuan = Number(amountYuan)
  const safe = Number.isFinite(yuan) && yuan > 0 ? yuan : 0
  const fen = Math.round(safe * 100)
  return Math.round(fen * 0.01) / 100
}

/**
 * @param {number|string} mpOnline
 * @param {number|string} [mpRefund=0]
 * @returns {{ mpNet: number, base: number, amount: number, amountText: string }}
 */
function calcPledgeDueFromMp(mpOnline, mpRefund) {
  const mpO = Number(mpOnline)
  const mpR = Number(mpRefund)
  const online = Number.isFinite(mpO) ? mpO : 0
  const refund = Number.isFinite(mpR) ? mpR : 0
  const mpNet = Math.round((online - refund) * 100) / 100
  const base = Math.max(0, mpNet)
  const amount = calcOnePercentYuan(base)
  return {
    mpNet,
    base,
    amount,
    amountText: amount.toFixed(2)
  }
}

module.exports = {
  calcOnePercentYuan,
  calcPledgeDueFromMp
}
