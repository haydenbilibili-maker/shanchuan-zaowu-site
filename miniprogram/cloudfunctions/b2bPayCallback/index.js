/**
 * B2B 采购单支付回调（独立旁路）
 * 仅更新 purchase_orders；绝不触碰 C 端 orders / payCallback。
 *
 * 判据（任一不满足都不标记已付）：
 *   - returnCode 与 resultCode 均为 SUCCESS（缺字段 = 失败）
 *   - outTradeNo 属于该单历次发起的商户单号（payOutTradeNos / payTrades / 旧字段 payOutTradeNo）
 *   - 回调金额 totalFee == 发起该笔时服务端记下的应付分（不一致 → pay_review 待人工核对）
 * 幂等：条件更新 paymentStatus ∉ {paid, refunded, pay_review}，重复回调不重复处理。
 * 返回：{ errcode: 0 } 表示已处理；写库异常返回非 0，让微信重试。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const COL = 'purchase_orders'
const FINAL_STATUSES = ['paid', 'refunded', 'pay_review']

const ACK = { errcode: 0, errmsg: 'SUCCESS' }
const RETRY = { errcode: -1, errmsg: 'RETRY' }

function rejectClientForgery() {
  try {
    const wxContext = cloud.getWXContext()
    const source = String(wxContext.SOURCE || '')
    if (source === 'wx_client' || source === 'wx_devtools') {
      console.warn('b2bPayCallback: rejected client/forged call', { source })
      return { errcode: 0, errmsg: 'IGNORED' }
    }
  } catch (e) {
    console.warn('b2bPayCallback: getWXContext failed', e && e.message)
  }
  return null
}

function str(event, ...keys) {
  for (const k of keys) {
    const v = event && event[k]
    if (v != null && v !== '') return String(v).trim()
  }
  return ''
}

function fenOf(raw) {
  if (raw == null || raw === '') return null
  const n = Math.round(Number(raw))
  return Number.isFinite(n) && n > 0 ? n : null
}

function tradeNosOf(po) {
  const list = Array.isArray(po && po.payOutTradeNos) ? po.payOutTradeNos.slice() : []
  const trades = Array.isArray(po && po.payTrades) ? po.payTrades : []
  for (const t of trades) if (t && t.outTradeNo && list.indexOf(t.outTradeNo) === -1) list.push(t.outTradeNo)
  if (po && po.payOutTradeNo && list.indexOf(po.payOutTradeNo) === -1) list.push(po.payOutTradeNo)
  return list
}

function expectedFenFor(po, outTradeNo) {
  const trades = Array.isArray(po && po.payTrades) ? po.payTrades : []
  const hit = trades.find((t) => t && t.outTradeNo === outTradeNo)
  if (hit) return fenOf(hit.fen)
  return fenOf(po && po.payFen)
}

async function firstRow(where) {
  const res = await db.collection(COL).where(where).limit(1).get()
  return (res && res.data && res.data[0]) || null
}

/** 按商户单号定位采购单：历次单号数组 → 旧单字段 → attach（须核验单号属于该单） */
async function findPo(outTradeNo, attach) {
  let po = await firstRow({ payOutTradeNos: outTradeNo })
  if (po) return po
  po = await firstRow({ payOutTradeNo: outTradeNo })
  if (po) return po
  if (attach) {
    let byId = null
    try {
      const res = await db.collection(COL).doc(attach).get()
      byId = (res && res.data) || null
      if (Array.isArray(byId)) byId = byId[0] || null
    } catch (e) {
      byId = null
    }
    if (byId && tradeNosOf(byId).indexOf(outTradeNo) !== -1) return byId
  }
  return null
}

async function flagAnomaly(po, anomaly) {
  await db
    .collection(COL)
    .where({ _id: po._id, paymentStatus: _.nin(['paid', 'refunded']) })
    .update({
      data: { paymentStatus: 'pay_review', payAnomaly: { ...anomaly, at: Date.now() }, updatedAt: Date.now() }
    })
}

exports.main = async (event) => {
  const forged = rejectClientForgery()
  if (forged) return forged

  const outTradeNo = str(event, 'outTradeNo', 'out_trade_no')
  const returnCode = str(event, 'returnCode', 'return_code').toUpperCase()
  const resultCode = str(event, 'resultCode', 'result_code').toUpperCase()
  const transactionId = str(event, 'transactionId', 'transaction_id')
  const attach = str(event, 'attach')
  const paidFen = fenOf(str(event, 'totalFee', 'total_fee') || str(event, 'cashFee', 'cash_fee'))

  if (!outTradeNo) {
    console.warn('b2bPayCallback: missing outTradeNo')
    return ACK
  }
  if (returnCode !== 'SUCCESS' || resultCode !== 'SUCCESS') {
    console.warn('b2bPayCallback: not success, ignore', { outTradeNo, returnCode, resultCode })
    return ACK
  }

  try {
    const po = await findPo(outTradeNo, attach)
    if (!po) {
      console.warn('b2bPayCallback: PO not found for', outTradeNo)
      return ACK
    }

    const status = String(po.paymentStatus || '')
    if (status === 'paid' || status === 'refunded' || status === 'pay_review') {
      if (status === 'paid' && po.paidOutTradeNo && po.paidOutTradeNo !== outTradeNo) {
        console.error('b2bPayCallback: duplicate payment on paid PO', po._id, outTradeNo)
        await db.collection(COL).doc(po._id).update({
          data: {
            payDuplicate: { outTradeNo, transactionId, paidFen, at: Date.now() },
            updatedAt: Date.now()
          }
        })
      }
      return ACK
    }

    const expectedFen = expectedFenFor(po, outTradeNo)
    if (paidFen == null || expectedFen == null || paidFen !== expectedFen) {
      console.error('b2bPayCallback: amount mismatch', { id: po._id, outTradeNo, paidFen, expectedFen })
      await flagAnomaly(po, { code: 'AMOUNT_MISMATCH', outTradeNo, paidFen, expectedFen, transactionId })
      return ACK
    }

    const now = Date.now()
    const res = await db
      .collection(COL)
      .where({ _id: po._id, paymentStatus: _.nin(FINAL_STATUSES) })
      .update({
        data: {
          paymentStatus: 'paid',
          paymentChannel: 'wechat_jsapi',
          paidAt: now,
          updatedAt: now,
          transactionId: transactionId || null,
          paidOutTradeNo: outTradeNo,
          paidFen,
          payCallbackAt: now
        }
      })
    const updated = res && res.stats ? Number(res.stats.updated) || 0 : 0
    console.log('b2bPayCallback: marked paid', po._id, outTradeNo, { updated })
    return ACK
  } catch (e) {
    console.error('b2bPayCallback error (will ask WeChat to retry)', e)
    return RETRY
  }
}
