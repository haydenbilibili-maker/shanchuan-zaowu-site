/**
 * getMyDonations · 我的捐赠（只读旁路，2026-11-22）
 *
 * 只查调用者本人（OPENID 取自上下文，入参里不接受他人 openid）的订单，算「累计实付 × 1%」。
 * 不写库、不改任何订单 / 账本字段；口径说明见 donationLedger.js 文件头。
 *
 * 入参：{ summaryOnly?: boolean }  —— 钱包入口只要合计，不回逐笔明细
 * 出参：{ success, data: { pledgeFen, netFen, paidFen, refundFen, orderCount, pendingCount, firstDate, days, years[], rows?[], truncated } }
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const { ALL_STATUSES, buildLedger } = require('./donationLedger')

const PAGE = 100
const MAX_ORDERS = 2000
const FIELDS = { _id: true, orderNo: true, status: true, totalPrice: true, payAmount: true, amount: true, refundFee: true, paidTime: true, createTime: true, products: true }

async function fetchMyOrders(openid) {
  const all = []
  while (all.length < MAX_ORDERS) {
    const res = await db.collection('orders')
      .where({ _openid: openid, status: _.in(ALL_STATUSES) })
      .field(FIELDS)
      .orderBy('createTime', 'desc')
      .skip(all.length)
      .limit(PAGE)
      .get()
    const batch = (res && res.data) || []
    all.push(...batch)
    if (batch.length < PAGE) break
  }
  return all
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { success: false, code: 'NO_AUTH', msg: '未登录' }
  try {
    const orders = await fetchMyOrders(OPENID)
    const data = buildLedger(orders, { now: Date.now(), withRows: !(event && event.summaryOnly === true) })
    data.capped = orders.length >= MAX_ORDERS
    return { success: true, data }
  } catch (err) {
    console.error('[getMyDonations] 查询失败', err)
    return { success: false, code: 'QUERY_FAILED', msg: '暂时查不到捐赠记录' }
  }
}
