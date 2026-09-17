/**
 * 品牌「1% 承诺」展示文案（全馆通用，不限品类）
 */

const ONE_PERCENT_PLEDGE_LABEL = 'GIVING · 1%'
/** 下单温馨提示 / 品牌脚注 slogan */
const ONE_PERCENT_PLEDGE_SLOGAN = '取自山海，还于自然'
const ONE_PERCENT_PLEDGE_SUMMARY = '取自山海，还于自然。您的1%心意我们将代为捐赠。'
const ONE_PERCENT_PLEDGE_NOTE =
  '山海造物承诺将本平台营收的1%捐赠给动植物保护、护林员关爱、国家公园建设、自然环境保护等相关公益组织，感谢您选择与我们同行。年度捐赠报告届时将通过私信转呈于您。'

/** 下单确认：致谢（短句，可与金额行并用） */
const ONE_PERCENT_PLEDGE_ACK = '感谢您与山海造物同行。'

/**
 * 按金额（元）计算 1% 应转投额；负数/非法按 0。分位四舍五入与本单确认页一致。
 * @param {number|string} amountYuan
 * @returns {number} 元，两位小数
 */
function calcOnePercentYuan(amountYuan) {
  const yuan = Number(amountYuan)
  const safe = Number.isFinite(yuan) && yuan > 0 ? yuan : 0
  const fen = Math.round(safe * 100)
  return Math.round(fen * 0.01) / 100
}

/**
 * 按订单应付金额（元）计算本单约投入自然保护的 1%。
 * @param {number|string} orderAmountYuan 与确认页应付一致的金额（元）
 * @returns {{
 *   amount: number,
 *   amountText: string,
 *   line: string,
 *   hasAmount: boolean,
 *   lineBefore: string,
 *   lineAmount: string,
 *   lineAfter: string
 * }}
 */
function calcPledgeAmount(orderAmountYuan) {
  const amount = calcOnePercentYuan(orderAmountYuan)
  const amountText = amount.toFixed(2)
  if (amount > 0) {
    const lineBefore = '本单约 '
    const lineAmount = `¥${amountText}`
    const lineAfter =
      ' 将由山海造物代为捐赠动植物与自然环境保护组织，感谢您与山海造物同行。'
    return {
      amount,
      amountText,
      line: lineBefore + lineAmount + lineAfter,
      hasAmount: true,
      lineBefore,
      lineAmount,
      lineAfter
    }
  }
  const line =
    '本单将由山海造物代为捐赠动植物与自然环境保护组织，感谢您与山海造物同行。'
  return {
    amount,
    amountText,
    line,
    hasAmount: false,
    lineBefore: '',
    lineAmount: '',
    lineAfter: line
  }
}

/**
 * B 端账本：应捐基数 = 小程序净 GMV（mpOnline − mpRefund），不含 POS/现金/遗留线上。
 * @param {number|string} mpOnline 小程序已付 GMV（元）
 * @param {number|string} [mpRefund=0] 小程序退款（元）
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
  ONE_PERCENT_PLEDGE_LABEL,
  ONE_PERCENT_PLEDGE_SLOGAN,
  ONE_PERCENT_PLEDGE_SUMMARY,
  ONE_PERCENT_PLEDGE_NOTE,
  ONE_PERCENT_PLEDGE_ACK,
  calcOnePercentYuan,
  calcPledgeAmount,
  calcPledgeDueFromMp
}
