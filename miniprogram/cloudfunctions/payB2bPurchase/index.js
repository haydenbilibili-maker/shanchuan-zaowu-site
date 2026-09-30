/**
 * B2B 采购单服务端入口（采购商 → 总部供货价目）
 *
 * purchase_orders 集合对客户端**不可写**（规则 write:false）；小程序采购商/供货方的全部读写都经本函数。
 *
 * action（小程序，需 openid）：
 *   create             建单：明细只收 skuId+quantity，按 price_list_items 服务端定价
 *   list               我的采购单（_openid = 调用者）
 *   pay                微信 JSAPI 统一下单（归属 + 采购类角色 + 服务端重算金额）
 *   markOfflinePending 登记待对公（归属 + 采购类角色）
 *   markPaidPreview    超管验收旁路（需 B2B_ALLOW_PREVIEW_MARK=1 / ALLOW_MOCK_PAY=1）
 *   supplierList       供货方需求列表（supplierId 取自花名册，不信客户端）
 * action（超管；ERP 经 /api/cloud-fn 注入 adminOpsKey）：
 *   adminList          ERP 采购单列表（集合规则不放行 Web 匿名读）
 *   adminReconcile     按历次商户单号 cloudPay.queryOrder 查单补记
 *   adminRefund        cloudPay.refund 全额退款（须回填单号二次确认 + 退款原因）
 *   adminConfirmOffline 确认对公到账（仅 offline_pending → paid）
 *
 * ⚠️ 稳定期纪律：不读写 C 端 orders，不调用 payOrder / payCallback / confirmPayment。
 * 回调云函数：b2bPayCallback（独立）。
 */
const cloud = require('wx-server-sdk')
const { resolveActor, hasRole } = require('./staffGuard')
const {
  normalizeRequestItems,
  priceItems,
  loadActivePriceIndex
} = require('./b2bPricing')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const COL = 'purchase_orders'
const SOURCE = 'buyer_workbench'
const SUPPLIER_PARTY = 'supplier_fulfillment'
const ENV_ID = process.env.TCB_ENV || process.env.SCF_NAMESPACE || 'cloud1-8gnkty5bfff9f0bf'
const SUB_MCH_ID = process.env.WX_PAY_SUB_MCH_ID || ''
const ALLOW_MOCK_PAY = process.env.ALLOW_MOCK_PAY === '1'
const B2B_ALLOW_PREVIEW_MARK = process.env.B2B_ALLOW_PREVIEW_MARK === '1' || ALLOW_MOCK_PAY
const MAX_TRADES = 20

const SUPPLIER_TABS = {
  pending_confirm: ['submitted', 'pending_supplier_confirm'],
  pending_ship: ['confirmed', 'shipping'],
  shipped: ['shipped']
}

const PAID_LIKE = ['paid', 'marked_paid']
const LOCKED_PAY = ['paid', 'marked_paid', 'refunded', 'pay_review']

function fail(code, msg, extra) {
  return { success: false, code, msg, ...(extra || {}) }
}

/**
 * 商户号（cloudPay 的 subMchId）只能是微信支付 mchid：8–12 位纯数字。
 * 2026-09-30 线上事故：该变量被误填成 64 位回调密钥，微信统一下单报「sub_mch_id 字节数 64 大于最大值 12」，
 * 原文还被直接透给了门店。日志只记长度与判因，**不打印值**（可能是误填的密钥）。
 */
function subMchConfigError(scene) {
  if (!SUB_MCH_ID) return null
  if (/^\d{8,12}$/.test(SUB_MCH_ID)) return null
  console.error(
    `[payB2bPurchase] ${scene}: WX_PAY_SUB_MCH_ID 格式错误（len=${SUB_MCH_ID.length}，` +
      `${/^\d+$/.test(SUB_MCH_ID) ? '纯数字但位数不对' : '含非数字字符'}），应为 8–12 位商户号；值不打印`
  )
  return fail('B2B_PAY_CONFIG_INVALID', '支付配置有误，请联系总部。期间可点「待对公」登记转账。', {
    paymentStatus: 'unpaid'
  })
}

function isValidPayment(payment) {
  if (!payment || typeof payment !== 'object') return false
  const pkg = String(payment.package || '')
  if (!pkg.startsWith('prepay_id=')) return false
  if (pkg.length <= 'prepay_id='.length + 2) return false
  return !!(payment.timeStamp && payment.nonceStr && payment.paySign)
}

function randomToken(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

function buildOutTradeNo() {
  const stamp = Date.now().toString(36).toUpperCase()
  return `B2B${stamp}${randomToken(4)}`.slice(0, 32)
}

function buildRefundNo() {
  const stamp = Date.now().toString(36).toUpperCase()
  return `RB2B${stamp}${randomToken(4)}`.slice(0, 32)
}

function genOrderNo() {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `PO${y}${m}${day}${randomToken(4)}`
}

function pickStr(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max || 200)
}

function fenOf(raw) {
  if (raw == null || raw === '') return null
  const n = Math.round(Number(raw))
  return Number.isFinite(n) && n > 0 ? n : null
}

function ownerOf(po) {
  return String((po && (po._openid || po.buyerOpenid)) || '')
}

function tradesOf(po) {
  return Array.isArray(po && po.payTrades) ? po.payTrades.filter((t) => t && t.outTradeNo) : []
}

function tradeNosOf(po) {
  const list = Array.isArray(po && po.payOutTradeNos) ? po.payOutTradeNos.slice() : []
  for (const t of tradesOf(po)) if (list.indexOf(t.outTradeNo) === -1) list.push(t.outTradeNo)
  if (po && po.payOutTradeNo && list.indexOf(po.payOutTradeNo) === -1) list.push(po.payOutTradeNo)
  return list
}

function expectedFenFor(po, outTradeNo) {
  const hit = tradesOf(po).find((t) => t.outTradeNo === outTradeNo)
  if (hit) return fenOf(hit.fen)
  return fenOf(po && po.payFen)
}

async function getPo(purchaseOrderId) {
  try {
    const res = await db.collection(COL).doc(purchaseOrderId).get()
    const data = res && res.data
    return Array.isArray(data) ? data[0] || null : data || null
  } catch (e) {
    return null
  }
}

/** 采购类角色（buyer / franchisee / channel；超管亦通过） */
async function requireBuyer(openid) {
  const actor = await resolveActor(db, openid)
  if (!actor || !actor.ok) return { ok: false, res: fail('NOT_BUYER', '仅采购商可操作（请联系总部在花名册勾选「采购商」）') }
  if (!hasRole(actor, 'buyer')) return { ok: false, res: fail('NOT_BUYER', '仅采购商可操作（请联系总部在花名册勾选「采购商」）') }
  return { ok: true, actor }
}

async function requireSuperAdmin(openid, adminOpsKey) {
  const actor = await resolveActor(db, openid, { adminOpsKey })
  if (!actor || !actor.ok || !actor.superAdmin) {
    return { ok: false, res: fail('FORBIDDEN', (actor && actor.msg) || '仅超管可操作') }
  }
  return { ok: true, actor }
}

/** 小程序端操作采购单：必须是本人建的采购商台订单 */
async function loadOwnedBuyerPo(purchaseOrderId, openid) {
  const po = await getPo(purchaseOrderId)
  if (!po) return { ok: false, res: fail('NOT_FOUND', '采购单不存在') }
  const owner = ownerOf(po)
  if (!owner) return { ok: false, res: fail('NO_OWNER', '该单无归属采购商，请联系总部处理') }
  if (owner !== openid) return { ok: false, res: fail('FORBIDDEN', '无权操作该采购单') }
  if (String(po.source || '') !== SOURCE) {
    return { ok: false, res: fail('NOT_BUYER_ORDER', '该单不是采购商台订单，请联系总部处理') }
  }
  return { ok: true, po }
}

function toClientRow(po) {
  return {
    _id: po._id,
    orderNo: po.orderNo || '',
    source: po.source || '',
    status: po.status || '',
    paymentStatus: po.paymentStatus || 'unpaid',
    paymentChannel: po.paymentChannel || null,
    pricingMode: po.pricingMode || null,
    items: Array.isArray(po.items) ? po.items : [],
    totalAmount: po.totalAmount != null ? po.totalAmount : null,
    payFen: po.payFen != null ? po.payFen : null,
    storeName: po.storeName || '',
    contactName: po.contactName || '',
    shipToAddress: po.shipToAddress || '',
    note: po.note || '',
    submittedAt: po.submittedAt || null,
    createdAt: po.createdAt || null,
    paidAt: po.paidAt || null
  }
}

// ———————————————————————— 采购商 ————————————————————————

async function handleCreate(event, openid) {
  const role = await requireBuyer(openid)
  if (!role.ok) return role.res
  const reqItems = normalizeRequestItems(event.items)
  if (!reqItems.length) return fail('EMPTY_ITEMS', '请先选择商品')
  const contactName = pickStr(event.contactName, 40)
  if (!contactName) return fail('MISSING_CONTACT', '请填写联系人')

  const priceIndex = await loadActivePriceIndex(db)
  const priced = priceItems(reqItems, priceIndex)
  if (priced.unavailable.length) {
    return fail('ITEM_UNAVAILABLE', '部分商品已下架或价目已调整，请返回价目页重新选择', {
      unavailable: priced.unavailable
    })
  }

  const now = Date.now()
  const company = pickStr(event.company || event.storeName, 80)
  const doc = {
    _openid: openid,
    buyerOpenid: openid,
    orderNo: genOrderNo(),
    source: SOURCE,
    intentId: null,
    storeId: pickStr(event.storeId, 80) || null,
    storeName: pickStr(event.storeName, 80) || company || '渠道采购商',
    buyerType: 'channel',
    contactName,
    contactPhone: pickStr(event.contactPhone, 30),
    company,
    shipToAddress: pickStr(event.shipToAddress, 200),
    note: pickStr(event.note, 300),
    items: priced.items,
    totalAmount: priced.totalAmount,
    payFen: priced.payFen,
    pricingMode: priced.pricingMode,
    priceCheckedAt: now,
    status: 'submitted',
    paymentStatus: 'unpaid',
    paymentChannel: null,
    payOutTradeNo: null,
    payOutTradeNos: [],
    payTrades: [],
    payAttempt: 0,
    shipmentIds: [],
    submittedAt: now,
    confirmedAt: null,
    shippedAt: null,
    receivedAt: null,
    paidAt: null,
    createdAt: now,
    updatedAt: now,
    createdBy: SOURCE
  }
  const res = await db.collection(COL).add({ data: doc })
  const id = (res && res._id) || ''
  if (!id) return fail('CREATE_FAILED', '创建采购单失败')
  return {
    success: true,
    _id: id,
    orderNo: doc.orderNo,
    totalAmount: doc.totalAmount,
    payFen: doc.payFen,
    pricingMode: doc.pricingMode,
    paymentStatus: 'unpaid'
  }
}

async function handleList(event, openid) {
  const n = Math.min(50, Math.max(1, parseInt(event.limit, 10) || 30))
  let rows = []
  try {
    const res = await db
      .collection(COL)
      .where({ _openid: openid, source: SOURCE })
      .orderBy('createdAt', 'desc')
      .limit(n)
      .get()
    rows = (res && res.data) || []
  } catch (e) {
    const res = await db.collection(COL).where({ _openid: openid, source: SOURCE }).limit(n).get()
    rows = ((res && res.data) || []).sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
  }
  return { success: true, list: rows.map(toClientRow) }
}

/** ERP 采购单列表（仅超管）：集合规则不再放行 Web 匿名读，ERP 读经此处 */
async function handleAdminList(event) {
  const cap = Math.min(500, Math.max(1, parseInt(event.limit, 10) || 300))
  const page = async (ordered, skip, n) => {
    let q = db.collection(COL)
    if (ordered) q = q.orderBy('createdAt', 'desc')
    const res = await q.skip(skip).limit(n).get()
    return (res && res.data) || []
  }
  const collect = async (ordered) => {
    const rows = []
    while (rows.length < cap) {
      const batch = await page(ordered, rows.length, Math.min(100, cap - rows.length))
      rows.push(...batch)
      if (batch.length < 100) break
    }
    return rows
  }
  let rows
  try {
    rows = await collect(true)
  } catch (e) {
    rows = (await collect(false)).sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
  }
  return { success: true, list: rows }
}

/**
 * 按当前上架报价重算应付金额。与单内金额不一致 → 回写服务端价格并拒绝本次支付（让采购商看到新金额后再付）。
 * @returns {{ ok:true, payFen:number } | { ok:false, res:object }}
 */
async function repriceForPay(po, purchaseOrderId) {
  const reqItems = normalizeRequestItems(po.items)
  const priceIndex = await loadActivePriceIndex(db)
  const priced = priceItems(reqItems, priceIndex)
  if (priced.pricingMode !== 'fixed' || priced.payFen == null) {
    return {
      ok: false,
      res: fail(
        'QUOTE_REQUIRED',
        priced.unavailable.length
          ? '单内有商品已下架，无法在线支付。可点「待对公」或联系总部确认。'
          : '单内含区间价/议价商品，需总部确认单价，请点「待对公」或联系总部。',
        { paymentStatus: po.paymentStatus || 'unpaid' }
      )
    }
  }
  const storedFen = fenOf(po.payFen)
  if (storedFen !== priced.payFen) {
    const now = Date.now()
    const prevItems = Array.isArray(po.items) ? po.items : []
    const items = priced.items.map((it, i) => ({ ...(prevItems[i] || {}), ...it, thumbUrl: (prevItems[i] && prevItems[i].thumbUrl) || it.thumbUrl }))
    await db.collection(COL).doc(purchaseOrderId).update({
      data: {
        items,
        payFen: priced.payFen,
        totalAmount: priced.totalAmount,
        pricingMode: 'fixed',
        priceCheckedAt: now,
        updatedAt: now
      }
    })
    return {
      ok: false,
      res: fail(
        'PRICE_CHANGED',
        `供货价已更新，应付 ¥${priced.totalAmount}（原 ¥${storedFen != null ? storedFen / 100 : '—'}），请确认后再次支付`,
        { payFen: priced.payFen, totalAmount: priced.totalAmount, paymentStatus: po.paymentStatus || 'unpaid' }
      )
    }
  }
  return { ok: true, payFen: priced.payFen }
}

async function handlePay(purchaseOrderId, openid) {
  const role = await requireBuyer(openid)
  if (!role.ok) return role.res
  const loaded = await loadOwnedBuyerPo(purchaseOrderId, openid)
  if (!loaded.ok) return loaded.res
  const po = loaded.po
  const payStatus = String(po.paymentStatus || 'unpaid')
  if (PAID_LIKE.indexOf(payStatus) !== -1) {
    return { success: true, alreadyPaid: true, paymentStatus: payStatus, msg: '该采购单已支付' }
  }
  if (payStatus === 'refunded') return fail('BAD_PAY_STATUS', '该采购单已退款，无法再次支付', { paymentStatus: payStatus })
  if (payStatus === 'pay_review') {
    return fail('BAD_PAY_STATUS', '该单支付金额待总部核对，请勿重复付款', { paymentStatus: payStatus })
  }
  if (['cancelled', 'closed'].indexOf(String(po.status || '')) !== -1) {
    return fail('BAD_STATUS', '采购单已关闭，无法支付', { paymentStatus: payStatus })
  }

  const priced = await repriceForPay(po, purchaseOrderId)
  if (!priced.ok) return priced.res
  const payFen = priced.payFen

  if (!SUB_MCH_ID) {
    return fail(
      'B2B_PAY_NOT_CONFIGURED',
      '微信支付还没开通。可先点「待对公」登记转账，或联系总部开通。',
      { paymentStatus: 'awaiting_config', payFen }
    )
  }
  const cfgErr = subMchConfigError('pay')
  if (cfgErr) return { ...cfgErr, payFen }

  const attempt = (Number(po.payAttempt) || 0) + 1
  const outTradeNo = buildOutTradeNo()
  const now = Date.now()
  const payOutTradeNos = tradeNosOf(po).concat([outTradeNo]).slice(-MAX_TRADES)
  const payTrades = tradesOf(po).concat([{ outTradeNo, fen: payFen, at: now }]).slice(-MAX_TRADES)
  await db.collection(COL).doc(purchaseOrderId).update({
    data: {
      paymentStatus: 'pending',
      payOutTradeNo: outTradeNo,
      payOutTradeNos,
      payTrades,
      payAttempt: attempt,
      payFen,
      paymentChannel: 'wechat_jsapi',
      updatedAt: now
    }
  })

  let lastErr = ''
  try {
    const res = await cloud.cloudPay.unifiedOrder({
      body: '山海造物·B2B采购',
      outTradeNo,
      spbillCreateIp: '127.0.0.1',
      subMchId: SUB_MCH_ID,
      totalFee: payFen,
      envId: ENV_ID,
      functionName: 'b2bPayCallback',
      tradeType: 'JSAPI',
      openid,
      attach: String(purchaseOrderId).slice(0, 127)
    })
    const returnOk = !res.returnCode || res.returnCode === 'SUCCESS'
    const resultOk = !res.resultCode || res.resultCode === 'SUCCESS'
    if (returnOk && resultOk && isValidPayment(res.payment)) {
      return {
        success: true,
        purchaseOrderId,
        orderNo: po.orderNo,
        outTradeNo,
        payment: res.payment,
        payFen,
        paymentStatus: 'pending'
      }
    }
    lastErr = (res && (res.returnMsg || res.errCodeDes || res.errMsg)) || '统一下单失败'
  } catch (payErr) {
    lastErr = (payErr && (payErr.errMsg || payErr.message)) || '微信支付下单异常'
    console.error('payB2bPurchase unifiedOrder', payErr)
  }

  console.error('payB2bPurchase unifiedOrder fail', { outTradeNo, lastErr })
  await db.collection(COL).doc(purchaseOrderId).update({
    data: { paymentStatus: 'unpaid', updatedAt: Date.now() }
  })
  return fail('PAY_UNAVAILABLE', '微信支付暂时拉不起来，请稍后再试；着急可点「待对公」登记转账。', {
    paymentStatus: 'unpaid',
    payFen
  })
}

async function handleMarkOffline(purchaseOrderId, openid) {
  const role = await requireBuyer(openid)
  if (!role.ok) return role.res
  const loaded = await loadOwnedBuyerPo(purchaseOrderId, openid)
  if (!loaded.ok) return loaded.res
  const po = loaded.po
  const payStatus = String(po.paymentStatus || 'unpaid')
  if (LOCKED_PAY.indexOf(payStatus) !== -1) {
    return fail('BAD_PAY_STATUS', '当前支付状态不可登记对公', { paymentStatus: payStatus })
  }
  if (['cancelled', 'closed'].indexOf(String(po.status || '')) !== -1) {
    return fail('BAD_STATUS', '采购单已关闭', { paymentStatus: payStatus })
  }
  await db.collection(COL).doc(purchaseOrderId).update({
    data: { paymentStatus: 'offline_pending', paymentChannel: 'offline', updatedAt: Date.now() }
  })
  return {
    success: true,
    paid: false,
    via: 'offline',
    paymentStatus: 'offline_pending',
    msg: '已登记待对公转账，总部确认到账后更新'
  }
}

async function handlePreviewMark(purchaseOrderId, openid) {
  const admin = await requireSuperAdmin(openid)
  if (!admin.ok || !B2B_ALLOW_PREVIEW_MARK) {
    return fail('PREVIEW_MARK_DENIED', '验收标记未开启（需超管且云函数 B2B_ALLOW_PREVIEW_MARK/ALLOW_MOCK_PAY=1）')
  }
  const loaded = await loadOwnedBuyerPo(purchaseOrderId, openid)
  if (!loaded.ok) return loaded.res
  const payStatus = String(loaded.po.paymentStatus || 'unpaid')
  if (LOCKED_PAY.indexOf(payStatus) !== -1) {
    return { success: true, alreadyPaid: PAID_LIKE.indexOf(payStatus) !== -1, paymentStatus: payStatus, msg: '当前状态不可标记' }
  }
  const now = Date.now()
  await db.collection(COL).doc(purchaseOrderId).update({
    data: {
      paymentStatus: 'marked_paid',
      paymentChannel: 'preview_mark',
      paidAt: now,
      updatedAt: now,
      payMarkNote: '超管验收旁路标记已付'
    }
  })
  return { success: true, paid: true, via: 'preview_mark', paymentStatus: 'marked_paid', msg: '已标记已付（验收旁路，非真实收款）' }
}

// ———————————————————————— 供货方 ————————————————————————

async function handleSupplierList(event, openid) {
  const actor = await resolveActor(db, openid)
  if (!actor || !actor.ok) return fail('FORBIDDEN', '仅供货方可查看')
  let supplierId = ''
  if (actor.superAdmin) {
    supplierId = pickStr(event.supplierId, 80)
  } else {
    if (!hasRole(actor, 'supplier')) return fail('FORBIDDEN', '仅供货方可查看')
    try {
      const res = await db.collection('staff_members').where({ openid, status: 'active' }).limit(1).get()
      const rec = (res && res.data && res.data[0]) || null
      supplierId = pickStr((rec && rec.supplierId) || openid, 80)
    } catch (e) {
      supplierId = openid
    }
  }
  if (!supplierId) return { success: true, list: [], msg: '未绑定供货方 ID（staff_members.supplierId）' }
  const tab = String(event.tab || 'pending_confirm')
  const statuses = SUPPLIER_TABS[tab] || SUPPLIER_TABS.pending_confirm
  const limit = Math.min(80, Math.max(1, parseInt(event.limit, 10) || 40))
  const res = await db
    .collection(COL)
    .where({ party: SUPPLIER_PARTY, supplierId, status: _.in(statuses) })
    .limit(limit)
    .get()
  const list = ((res && res.data) || [])
    .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
    .map((po) => ({
      _id: po._id,
      orderNo: po.orderNo || '',
      status: po.status || '',
      items: Array.isArray(po.items) ? po.items.map((it) => ({ name: it.name, quantity: it.quantity })) : [],
      storeName: po.storeName || '',
      expectedShipBy: po.expectedShipBy || '',
      logisticsCarrier: po.logisticsCarrier || '',
      logisticsTracking: po.logisticsTracking || '',
      updatedAt: po.updatedAt || null
    }))
  return { success: true, list, supplierId }
}

// ———————————————————————— 超管：查单补记 / 退款 ————————————————————————

function actorLabel(actor) {
  return pickStr(actor.name || actor.openid || actor.source || 'admin', 60)
}

async function markPaidFromTrade(po, info) {
  const now = Date.now()
  const res = await db
    .collection(COL)
    .where({ _id: po._id, paymentStatus: _.nin(['paid', 'refunded']) })
    .update({
      data: {
        paymentStatus: 'paid',
        paymentChannel: 'wechat_jsapi',
        paidAt: now,
        updatedAt: now,
        transactionId: info.transactionId || null,
        paidOutTradeNo: info.outTradeNo,
        paidFen: info.fen,
        payMarkNote: info.note || null,
        reconciledBy: info.by || null,
        reconciledAt: info.by ? now : null
      }
    })
  return !!(res && res.stats && res.stats.updated > 0)
}

async function handleAdminReconcile(purchaseOrderId, actor) {
  if (!SUB_MCH_ID) return fail('B2B_PAY_NOT_CONFIGURED', '未配置 WX_PAY_SUB_MCH_ID，无法查单')
  const cfgErr = subMchConfigError('adminReconcile')
  if (cfgErr) return cfgErr
  const po = await getPo(purchaseOrderId)
  if (!po) return fail('NOT_FOUND', '采购单不存在')
  if (String(po.paymentStatus) === 'paid') return { success: true, alreadyPaid: true, paymentStatus: 'paid', msg: '该单已是已支付' }
  const nos = tradeNosOf(po).slice().reverse()
  if (!nos.length) return fail('NO_TRADE', '该单从未发起过微信支付')
  const results = []
  for (const outTradeNo of nos) {
    let res
    try {
      res = await cloud.cloudPay.queryOrder({ subMchId: SUB_MCH_ID, outTradeNo, nonceStr: randomToken(32) })
    } catch (e) {
      results.push({ outTradeNo, error: (e && (e.errMsg || e.message)) || '查单异常' })
      continue
    }
    const tradeState = String((res && (res.tradeState || res.trade_state)) || '')
    const ok = res && res.returnCode === 'SUCCESS' && res.resultCode === 'SUCCESS'
    results.push({ outTradeNo, tradeState: tradeState || (res && (res.errCodeDes || res.returnMsg)) || '' })
    if (!ok || tradeState !== 'SUCCESS') continue
    const paidFen = fenOf(res.totalFee != null ? res.totalFee : res.total_fee)
    const expected = expectedFenFor(po, outTradeNo)
    const transactionId = String(res.transactionId || res.transaction_id || '')
    if (paidFen == null || expected == null || paidFen !== expected) {
      await db.collection(COL).doc(po._id).update({
        data: {
          paymentStatus: 'pay_review',
          payAnomaly: { code: 'AMOUNT_MISMATCH', outTradeNo, paidFen, expectedFen: expected, transactionId, via: 'adminReconcile', at: Date.now() },
          updatedAt: Date.now()
        }
      })
      return fail('AMOUNT_MISMATCH', `微信实收 ${paidFen} 分 ≠ 应收 ${expected} 分，已标记待核对`, { results })
    }
    await markPaidFromTrade(po, {
      outTradeNo,
      fen: paidFen,
      transactionId,
      note: '超管查单补记',
      by: actorLabel(actor)
    })
    return { success: true, paid: true, paymentStatus: 'paid', outTradeNo, transactionId, results, msg: '查单确认已支付，已补记' }
  }
  return { success: true, paid: false, results, msg: '微信侧未查到成功支付' }
}

/** 对公到账确认：仅 offline_pending → paid（条件更新，重复点击幂等） */
async function handleAdminConfirmOffline(event, purchaseOrderId, actor) {
  const po = await getPo(purchaseOrderId)
  if (!po) return fail('NOT_FOUND', '采购单不存在')
  const pay = String(po.paymentStatus || '')
  if (PAID_LIKE.indexOf(pay) !== -1) return { success: true, alreadyPaid: true, paymentStatus: pay }
  if (pay !== 'offline_pending') return fail('BAD_PAY_STATUS', '仅「待对公」状态可确认到账', { paymentStatus: pay })
  const now = Date.now()
  const res = await db
    .collection(COL)
    .where({ _id: purchaseOrderId, paymentStatus: 'offline_pending' })
    .update({
      data: {
        paymentStatus: 'paid',
        paymentChannel: 'offline',
        paidAt: now,
        updatedAt: now,
        payMarkNote: pickStr(event.note || 'Admin 确认对公到账', 120),
        offlineConfirmedBy: actorLabel(actor),
        offlineConfirmedAt: now
      }
    })
  const updated = res && res.stats ? Number(res.stats.updated) || 0 : 0
  return { success: true, alreadyPaid: updated === 0, paymentStatus: 'paid' }
}

async function handleAdminRefund(event, purchaseOrderId, actor) {
  if (!SUB_MCH_ID) return fail('B2B_PAY_NOT_CONFIGURED', '未配置 WX_PAY_SUB_MCH_ID，无法退款')
  const cfgErr = subMchConfigError('adminRefund')
  if (cfgErr) return cfgErr
  const po = await getPo(purchaseOrderId)
  if (!po) return fail('NOT_FOUND', '采购单不存在')
  if (pickStr(event.confirmOrderNo, 40) !== String(po.orderNo || '')) {
    return fail('CONFIRM_MISMATCH', '二次确认失败：请输入完整采购单号')
  }
  const reason = pickStr(event.reason, 80)
  if (!reason) return fail('MISSING_REASON', '请填写退款原因')
  const refund = po.refund && typeof po.refund === 'object' ? po.refund : null
  if (String(po.paymentStatus) === 'refunded' || (refund && refund.status === 'refunded')) {
    return { success: true, alreadyRefunded: true, paymentStatus: 'refunded', msg: '该单已退款' }
  }
  if (String(po.paymentStatus) !== 'paid' || String(po.paymentChannel) !== 'wechat_jsapi') {
    return fail('NOT_REFUNDABLE', '仅「微信支付·已支付」的采购单可原路退款；对公款请线下退回')
  }
  const outTradeNo = String(po.paidOutTradeNo || po.payOutTradeNo || '')
  if (!outTradeNo) return fail('NO_TRADE', '缺少商户单号，无法退款')

  const q = await cloud.cloudPay.queryOrder({ subMchId: SUB_MCH_ID, outTradeNo, nonceStr: randomToken(32) })
  const state = String((q && (q.tradeState || q.trade_state)) || '')
  const totalFee = fenOf(q && (q.totalFee != null ? q.totalFee : q.total_fee))
  if (!q || q.returnCode !== 'SUCCESS' || q.resultCode !== 'SUCCESS' || (state !== 'SUCCESS' && state !== 'REFUND') || totalFee == null) {
    return fail('QUERY_FAILED', `微信查单未确认该笔已支付（${state || (q && (q.errCodeDes || q.returnMsg)) || '无结果'}）`)
  }

  const outRefundNo = (refund && refund.outRefundNo) || buildRefundNo()
  const by = actorLabel(actor)
  const now = Date.now()
  await db.collection(COL).doc(po._id).update({
    data: {
      refund: { status: 'refunding', outRefundNo, outTradeNo, fen: totalFee, reason, requestedBy: by, requestedAt: now },
      updatedAt: now
    }
  })
  let res
  try {
    res = await cloud.cloudPay.refund({
      subMchId: SUB_MCH_ID,
      outTradeNo,
      outRefundNo,
      totalFee,
      refundFee: totalFee,
      refundDesc: reason,
      nonceStr: randomToken(32)
    })
  } catch (e) {
    res = { returnCode: 'FAIL', returnMsg: (e && (e.errMsg || e.message)) || '退款异常' }
  }
  const ok = res && res.returnCode === 'SUCCESS' && res.resultCode === 'SUCCESS'
  if (!ok) {
    const err = (res && (res.errCodeDes || res.returnMsg || res.errCode)) || '退款失败'
    await db.collection(COL).doc(po._id).update({
      data: { 'refund.status': 'failed', 'refund.lastError': pickStr(err, 200), 'refund.failedAt': Date.now(), updatedAt: Date.now() }
    })
    return fail('REFUND_FAILED', `微信退款失败：${err}（可重试，将沿用同一退款单号）`)
  }
  const done = Date.now()
  await db.collection(COL).doc(po._id).update({
    data: {
      paymentStatus: 'refunded',
      refundedAt: done,
      'refund.status': 'refunded',
      'refund.refundId': String(res.refundId || res.refund_id || ''),
      'refund.refundedBy': by,
      'refund.refundedAt': done,
      updatedAt: done
    }
  })
  return { success: true, refunded: true, paymentStatus: 'refunded', outRefundNo, msg: '微信已受理退款（原路退回，到账以微信为准）' }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || wxContext.FROM_OPENID || ''
  const ev = event || {}
  const action = String(ev.action || 'pay').trim()
  const purchaseOrderId = String(ev.purchaseOrderId || '').trim()

  try {
    if (action === 'adminList' || action === 'adminReconcile' || action === 'adminRefund' || action === 'adminConfirmOffline') {
      const admin = await requireSuperAdmin(openid, ev.adminOpsKey)
      if (!admin.ok) return admin.res
      if (action === 'adminList') return await handleAdminList(ev)
      if (!purchaseOrderId) return fail('MISSING_ID', '缺少采购单 ID')
      if (action === 'adminReconcile') return await handleAdminReconcile(purchaseOrderId, admin.actor)
      if (action === 'adminConfirmOffline') return await handleAdminConfirmOffline(ev, purchaseOrderId, admin.actor)
      return await handleAdminRefund(ev, purchaseOrderId, admin.actor)
    }

    if (!openid) return fail('UNAUTHORIZED', '请先登录')
    if (action === 'create') return await handleCreate(ev, openid)
    if (action === 'list') return await handleList(ev, openid)
    if (action === 'supplierList') return await handleSupplierList(ev, openid)

    if (!purchaseOrderId) return fail('MISSING_ID', '缺少采购单 ID')
    if (action === 'pay') return await handlePay(purchaseOrderId, openid)
    if (action === 'markOfflinePending') return await handleMarkOffline(purchaseOrderId, openid)
    if (action === 'markPaidPreview') return await handlePreviewMark(purchaseOrderId, openid)
    return fail('UNKNOWN_ACTION', `未知 action: ${action}`)
  } catch (e) {
    console.error('payB2bPurchase', action, e)
    return fail('INTERNAL', (e && e.message) || '支付服务异常')
  }
}
