/**
 * 我的钱包 manageStoredValue
 *
 * action:
 *   getAccount | listLedgers | listPackages(=listTiers)
 *   getConfig | saveConfig（店长/超管 + adminOpsKey）
 *   createRecharge | confirmRecharge  — 新充值仅本金、不发赠金
 *   debitForOrder / refundWalletForOrder — 订单钱包扣款与待支付回账
 *   creditRefundForOrder — 已成交退款退回钱包
 *   releaseHeldWalletDebits — 超时/取消 held 扣款清理
 *   creditFromPayCallback（仅支付回调 / 内部密钥）
 *   reconcileRecharge（超管补单：支付回调缺失时人工核对微信流水后入账）
 *   ensureCollections（超管）
 *   staffDebit（门店核销骨架）
 *
 * 集合：stored_value_accounts / ledgers / recharge_orders / stored_value_config
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_STAFF, ROLE_MANAGER, WORKSPACE_SUPER_ADMIN } = require('./staffGuard')
const { assertStoredValueEnabled, isStoredValueEnabled } = require('./flags')
const {
  fenToYuan,
  describeBenefit,
  normalizeWalletConfig
} = require('./defaults')
const { getWalletConfig, saveWalletConfig, resolveRechargeTarget, CONFIG_COLLECTION } = require('./walletConfig')
const { ensureCollection, withCollectionRetry, isMissingCollectionError } = require('./collections')
const {
  ACCOUNTS,
  LEDGERS,
  RECHARGE_ORDERS,
  ensureAccount,
  findAccountByOpenid,
  emptyAccountView,
  serializeAccount,
  creditRechargeOrder,
  debitForOrder,
  refundCreditForOrder,
  creditOrderRefund
} = require('./account')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const ENV_ID = process.env.TCB_ENV || process.env.SCF_NAMESPACE || 'cloud1-8gnkty5bfff9f0bf'
const SUB_MCH_ID = process.env.WX_PAY_SUB_MCH_ID || ''
const ALLOW_MOCK_PAY = process.env.ALLOW_MOCK_PAY === '1'
const PAY_CALLBACK_KEY = process.env.STORED_VALUE_CALLBACK_KEY || process.env.PAY_CALLBACK_INTERNAL_KEY || ''

const LEDGER_TYPE_LABELS = {
  recharge: '充值',
  recharge_bonus: '历史赠金',
  order_pay: '订单消费',
  order_unfreeze: '支付回账',
  refund_credit: '退款入账',
  store_debit: '门店扣款',
  adjust: '调账',
  expire: '赠金过期'
}

const LEDGER_TYPE_HINTS = {
  recharge: '微信支付入账',
  recharge_bonus: '历史活动赠金',
  order_pay: '订单支付扣款',
  order_unfreeze: '未完成支付·余额退回',
  refund_credit: '订单退款退回钱包',
  store_debit: '门店核销',
  adjust: '人工调账',
  expire: '赠金过期'
}

function serializeLedgerRow(row) {
  const amountFen = Number(row.amountFen) || 0
  const isCredit = amountFen >= 0
  const type = row.type || ''
  const orderNo = row.orderNo || ''
  const remark = row.remark || ''
  let subtitle = LEDGER_TYPE_HINTS[type] || ''
  if (orderNo) {
    subtitle = subtitle ? `${subtitle} · ${orderNo}` : orderNo
  } else if (remark && remark !== subtitle) {
    subtitle = remark
  }
  return {
    id: row._id,
    type,
    typeLabel: LEDGER_TYPE_LABELS[type] || type || '流水',
    subtitle,
    amountFen,
    amountYuan: fenToYuan(Math.abs(amountFen)),
    amountSignedYuan: fenToYuan(amountFen),
    principalDeltaFen: Number(row.principalDeltaFen) || 0,
    bonusDeltaFen: Number(row.bonusDeltaFen) || 0,
    balanceAfterFen: Number(row.balanceAfterFen) || 0,
    balanceAfterYuan: fenToYuan(row.balanceAfterFen),
    remark,
    refType: row.refType || '',
    refId: row.refId || '',
    orderNo,
    packageId: row.packageId || '',
    isCredit,
    tone: isCredit ? 'credit' : 'debit',
    createTime: row.createTime || null
  }
}

function fail(msg, code, extra) {
  return Object.assign({ success: false, msg, code: code || 'ERROR' }, extra || {})
}

function buildOutTradeNo() {
  const t = Date.now().toString(36).toUpperCase()
  const r = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `SV${t}${r}`.slice(0, 32)
}

async function requireEnabled() {
  return assertStoredValueEnabled(db)
}

async function getAccount(openid) {
  const gate = await requireEnabled()
  const wallet = await getWalletConfig(db)
  if (!gate.ok) {
    return {
      success: true,
      enabled: false,
      code: gate.code,
      msg: gate.msg,
      account: serializeAccount(emptyAccountView(openid)),
      packages: [],
      recharge: wallet.recharge || wallet.config.recharge,
      benefit: wallet.config.benefit,
      benefitText: wallet.benefitText
    }
  }

  let account = null
  try {
    account = await findAccountByOpenid(db, openid)
    if (!account) {
      account = await ensureAccount(db, openid)
    }
  } catch (e) {
    if (isMissingCollectionError(e)) {
      account = emptyAccountView(openid)
    } else {
      throw e
    }
  }

  const serialized = serializeAccount(account || emptyAccountView(openid))
  return {
    success: true,
    enabled: true,
    account: serialized,
    packages: wallet.packages,
    recharge: wallet.recharge || wallet.config.recharge,
    benefit: wallet.config.benefit,
    benefitText: wallet.benefitText,
    pointsRuleText: wallet.pointsRuleText || '',
    levelTiers: wallet.levelTiers || [],
    walletLabel: '我的钱包'
  }
}

async function listPackages() {
  const gate = await requireEnabled()
  if (!gate.ok) return fail(gate.msg, gate.code)
  const wallet = await getWalletConfig(db)
  return {
    success: true,
    packages: wallet.packages,
    recharge: wallet.recharge || wallet.config.recharge,
    benefit: wallet.config.benefit,
    benefitText: wallet.benefitText
  }
}

async function getConfigAction(openid, event) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    adminOpsKey: event && event.adminOpsKey
  })
  // 读配置：店员也可只读；无权限时仍返回 defaults（供 Admin 未登录预览）
  const wallet = await getWalletConfig(db)
  const enabled = await isStoredValueEnabled(db)
  return {
    success: true,
    enabled,
    config: wallet.config,
    packages: wallet.packages,
    recharge: wallet.recharge || wallet.config.recharge,
    benefit: wallet.config.benefit,
    benefitText: wallet.benefitText,
    docId: wallet.docId,
    fromDefault: wallet.fromDefault,
    canWrite: !!(guard && guard.ok)
  }
}

async function saveConfigAction(openid, event) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    permission: 'manageStoredValueConfig',
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return fail(guard.msg || '无权限', guard.code || 'FORBIDDEN')

  const payload = (event && (event.config || event.walletConfig)) || {}
  const normalized = normalizeWalletConfig(payload)
  const saved = await saveWalletConfig(db, normalized, (guard.actor && guard.actor.openid) || openid)
  return {
    success: true,
    ...saved,
    msg: '钱包配置已保存'
  }
}

async function listLedgers(openid, event) {
  const gate = await requireEnabled()
  if (!gate.ok) return fail(gate.msg, gate.code)

  const limit = Math.min(50, Math.max(1, parseInt(event.limit, 10) || 20))
  const offset = Math.max(0, parseInt(event.offset, 10) || 0)

  try {
    const res = await withCollectionRetry(db, LEDGERS, async () => {
      return db.collection(LEDGERS)
        .where({ openid })
        .orderBy('createTime', 'desc')
        .skip(offset)
        .limit(limit)
        .get()
    })

    const list = (res.data || []).map((row) => serializeLedgerRow(row))

    return { success: true, list, limit, offset }
  } catch (e) {
    if (isMissingCollectionError(e)) {
      return { success: true, list: [], limit, offset }
    }
    try {
      const res = await db.collection(LEDGERS).where({ openid }).limit(limit).get()
      const list = (res.data || [])
        .sort((a, b) => {
          const ta = a.createTime ? new Date(a.createTime).getTime() : 0
          const tb = b.createTime ? new Date(b.createTime).getTime() : 0
          return tb - ta
        })
        .map((row) => serializeLedgerRow(row))
      return { success: true, list, limit, offset, fallbackSort: true }
    } catch (err) {
      throw err
    }
  }
}

async function createRecharge(openid, event) {
  const gate = await requireEnabled()
  if (!gate.ok) return fail(gate.msg, gate.code)
  if (!openid) return fail('请先登录', 'UNAUTHORIZED')

  const resolved = await resolveRechargeTarget(db, event || {})
  if (!resolved.ok) return fail(resolved.msg, resolved.code)
  const pkg = resolved.pkg

  await ensureAccount(db, openid)

  const outTradeNo = buildOutTradeNo()
  // 新产品规则：仅本金入账，bonusFen 固定 0
  const orderDoc = {
    openid,
    _openid: openid,
    packageId: pkg.id,
    tierId: pkg.id,
    packageName: pkg.name,
    isCustom: !!resolved.isCustom,
    payFen: pkg.payFen,
    principalFen: pkg.principalFen,
    bonusFen: 0,
    status: 'pending',
    outTradeNo,
    idempotencyKey: `create:${outTradeNo}`,
    transactionId: '',
    wxPayMode: '',
    createTime: db.serverDate(),
    updateTime: db.serverDate(),
    payExpireTime: new Date(Date.now() + 30 * 60 * 1000)
  }

  const added = await withCollectionRetry(db, RECHARGE_ORDERS, async () => {
    return db.collection(RECHARGE_ORDERS).add({ data: orderDoc })
  })
  const orderId = added._id

  if (SUB_MCH_ID) {
    try {
      const res = await cloud.cloudPay.unifiedOrder({
        body: `山海造物·钱包充值 ${pkg.name}`,
        outTradeNo,
        spbillCreateIp: '127.0.0.1',
        subMchId: SUB_MCH_ID,
        totalFee: pkg.payFen,
        envId: ENV_ID,
        functionName: 'payCallback',
        tradeType: 'JSAPI',
        openid
      })
      return {
        success: true,
        orderId,
        outTradeNo,
        packageId: pkg.id,
        isCustom: !!resolved.isCustom,
        payFen: pkg.payFen,
        payYuan: fenToYuan(pkg.payFen),
        creditFen: pkg.principalFen,
        creditYuan: fenToYuan(pkg.principalFen),
        payment: res.payment
      }
    } catch (payErr) {
      console.error('wallet unifiedOrder failed:', payErr)
      if (!ALLOW_MOCK_PAY) {
        await db.collection(RECHARGE_ORDERS).doc(orderId).update({
          data: { status: 'closed', closeReason: 'PAY_UNAVAILABLE', updateTime: db.serverDate() }
        }).catch(() => {})
        return fail('微信支付暂不可用，请稍后重试', 'PAY_UNAVAILABLE')
      }
    }
  }

  if (ALLOW_MOCK_PAY) {
    return {
      success: true,
      orderId,
      outTradeNo,
      packageId: pkg.id,
      isCustom: !!resolved.isCustom,
      payFen: pkg.payFen,
      payYuan: fenToYuan(pkg.payFen),
      creditFen: pkg.principalFen,
      creditYuan: fenToYuan(pkg.principalFen),
      mockPay: true,
      msg: '开发模式：模拟钱包充值（ALLOW_MOCK_PAY=1）'
    }
  }

  await db.collection(RECHARGE_ORDERS).doc(orderId).update({
    data: { status: 'closed', closeReason: 'PAY_NOT_ENABLED', updateTime: db.serverDate() }
  }).catch(() => {})

  return fail('支付未开通，请稍后再试或联系门店', 'PAY_NOT_ENABLED', { orderId })
}

async function loadRechargeOrder(orderId, openid) {
  const res = await withCollectionRetry(db, RECHARGE_ORDERS, async () => {
    return db.collection(RECHARGE_ORDERS).doc(orderId).get()
  })
  const order = res.data
  if (!order) return null
  if (openid && order.openid !== openid && order._openid !== openid) return null
  return { ...order, _id: orderId }
}

async function findRechargeByOutTradeNo(outTradeNo) {
  return withCollectionRetry(db, RECHARGE_ORDERS, async () => {
    const res = await db.collection(RECHARGE_ORDERS).where({ outTradeNo }).limit(1).get()
    return (res.data && res.data[0]) || null
  })
}

async function confirmRecharge(openid, event) {
  const gate = await requireEnabled()
  if (!gate.ok) return fail(gate.msg, gate.code)

  const orderId = String(event.orderId || '').trim()
  if (!orderId) return fail('缺少充值单 ID')

  const order = await loadRechargeOrder(orderId, openid)
  if (!order) return fail('充值单不存在')

  if (order.status === 'credited') {
    const account = await findAccountByOpenid(db, openid)
    return {
      success: true,
      alreadyCredited: true,
      orderId,
      account: serializeAccount(account)
    }
  }

  // 生产微信支付：入账仅由 payCallback 触发，客户端只轮询状态，避免与回调双写
  if (SUB_MCH_ID && !ALLOW_MOCK_PAY) {
    const latest = await loadRechargeOrder(orderId, openid)
    if (!latest) return fail('充值单不存在')
    if (latest.status === 'credited') {
      const account = await findAccountByOpenid(db, openid)
      return {
        success: true,
        alreadyCredited: true,
        orderId,
        account: serializeAccount(account)
      }
    }
    return {
      success: false,
      pendingConfirm: true,
      code: 'AWAITING_CALLBACK',
      msg: '支付结果确认中，请稍后下拉刷新余额'
    }
  }

  const hasWxEvidence = !!(order.transactionId || order.wxPayMode === 'wechat')

  if (hasWxEvidence || order.status === 'paid' || order.status === 'crediting') {
    const result = await creditRechargeOrder(db, _, order, {
      transactionId: order.transactionId || '',
      wxPayMode: order.wxPayMode || 'wechat'
    })
    return result
  }

  if (ALLOW_MOCK_PAY) {
    await db.collection(RECHARGE_ORDERS).doc(orderId).update({
      data: {
        status: 'paid',
        wxPayMode: 'mock',
        updateTime: db.serverDate(),
        mockBy: 'dev'
      }
    }).catch(() => {})

    const latest = await loadRechargeOrder(orderId, openid)
    return creditRechargeOrder(db, _, latest, { wxPayMode: 'mock', transactionId: '' })
  }

  if (SUB_MCH_ID) {
    return {
      success: false,
      pendingConfirm: true,
      code: 'AWAITING_CALLBACK',
      msg: '支付结果确认中，请稍后下拉刷新余额'
    }
  }

  return fail('支付未开通，订单仍为待支付', 'PAY_NOT_ENABLED')
}

/**
 * 超管补单入账：支付回调缺失（或历史被误判）时，人工核对微信商户平台流水后补入账。
 * - 仅超管（或 Admin Web 携带 adminOpsKey）可调用；
 * - 入账复用 creditRechargeOrder 的幂等键（recharge:{outTradeNo}），重复调用安全；
 * - 会写 reconciledBy / reconciledAt / reconcileNote 便于审计。
 */
async function reconcileRechargeAction(openid, event) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return fail(guard.msg || '无权限', guard.code || 'FORBIDDEN')
  const actor = guard.actor || {}
  const isSuper = !!(actor.superAdmin || actor.workspaceRole === WORKSPACE_SUPER_ADMIN)
  if (!isSuper) return fail('仅超管可补单入账', 'FORBIDDEN')

  const orderId = String((event && event.orderId) || '').trim()
  const outTradeNoInput = String((event && event.outTradeNo) || '').trim()
  let order = null
  if (orderId) {
    try {
      const res = await withCollectionRetry(db, RECHARGE_ORDERS, () =>
        db.collection(RECHARGE_ORDERS).doc(orderId).get()
      )
      order = (res && res.data) || null
    } catch (e) {
      order = null
    }
  }
  if (!order && outTradeNoInput) order = await findRechargeByOutTradeNo(outTradeNoInput)
  if (!order) return fail('充值单不存在（请核对 orderId 或 outTradeNo）', 'ORDER_NOT_FOUND')
  if (order.status === 'closed') return fail('该充值单已关闭，不能补单', 'ORDER_CLOSED')

  const transactionId = String(
    (event && (event.transactionId || event.transaction_id)) || ''
  ).trim()
  const note = String((event && event.note) || '').slice(0, 120)

  await withCollectionRetry(db, RECHARGE_ORDERS, () =>
    db.collection(RECHARGE_ORDERS).doc(order._id).update({
      data: {
        status: order.status === 'credited' ? 'credited' : 'paid',
        wxPayMode: 'wechat',
        transactionId: transactionId || order.transactionId || '',
        reconciledBy: actor.openid || openid || 'admin',
        reconciledAt: db.serverDate(),
        reconcileNote: note,
        updateTime: db.serverDate()
      }
    })
  ).catch((e) => console.warn('reconcileRecharge mark paid failed', e && e.message))

  const freshRes = await withCollectionRetry(db, RECHARGE_ORDERS, () =>
    db.collection(RECHARGE_ORDERS).doc(order._id).get()
  )
  const fresh =
    freshRes && freshRes.data ? { ...freshRes.data, _id: order._id } : order

  const result = await creditRechargeOrder(db, _, fresh, {
    transactionId: transactionId || fresh.transactionId || '',
    wxPayMode: 'wechat'
  })
  if (!result.success) return fail(result.msg || '入账失败', 'CREDIT_FAILED')

  return {
    success: true,
    orderId: order._id,
    outTradeNo: fresh.outTradeNo || '',
    alreadyCredited: !!result.alreadyCredited,
    account: result.account || null,
    msg: result.alreadyCredited ? '该充值单此前已入账' : '补单入账完成'
  }
}

async function creditFromPayCallback(event) {
  if (!PAY_CALLBACK_KEY) {
    return fail('未配置 STORED_VALUE_CALLBACK_KEY，拒绝远程入账', 'CALLBACK_KEY_REQUIRED')
  }
  const key = String(event.callbackKey || event.internalKey || '').trim()
  if (key !== PAY_CALLBACK_KEY) {
    return fail('禁止客户端直接入账', 'FORBIDDEN')
  }

  const outTradeNo = String(event.outTradeNo || '').trim()
  if (!outTradeNo) return fail('missing outTradeNo')

  const order = await findRechargeByOutTradeNo(outTradeNo)
  if (!order) {
    return { success: false, code: 'ORDER_NOT_FOUND', msg: 'recharge order not found' }
  }

  const transactionId = event.transactionId || event.transaction_id || ''
  if (transactionId) {
    await db.collection(RECHARGE_ORDERS).doc(order._id).update({
      data: {
        transactionId,
        wxPayMode: 'wechat',
        status: order.status === 'credited' ? 'credited' : 'paid',
        updateTime: db.serverDate()
      }
    }).catch(() => {})
  } else if (order.status === 'pending') {
    await db.collection(RECHARGE_ORDERS).doc(order._id).update({
      data: { status: 'paid', wxPayMode: 'wechat', updateTime: db.serverDate() }
    }).catch(() => {})
  }

  const latest = await findRechargeByOutTradeNo(outTradeNo)
  return creditRechargeOrder(db, _, latest, {
    transactionId,
    wxPayMode: 'wechat'
  })
}

async function debitForOrderAction(openid, event) {
  const gate = await requireEnabled()
  if (!gate.ok) return fail(gate.msg, gate.code)

  const orderId = String(event.orderId || '').trim()
  if (!orderId) return fail('缺少订单 ID', 'MISSING_ORDER')

  // 用户直调：用 OPENID；payOrder 嵌套调用时常无 OPENID/FROM_OPENID，改用 event.openid
  // （仍以订单 _openid 强校验，避免冒用）
  let payerOpenid = openid || String(event.openid || '').trim()
  if (!payerOpenid) return fail('请先登录', 'UNAUTHORIZED')

  // 可选：配置了内部密钥时，嵌套调用须带正确 key（防伪造空 OPENID + 他人 openid）
  // 用户直调有真实 OPENID，不强制 key
  if (!openid && PAY_CALLBACK_KEY) {
    const key = String(event.internalKey || event.callbackKey || '').trim()
    if (key && key !== PAY_CALLBACK_KEY) {
      return fail('无权扣款', 'FORBIDDEN')
    }
  }

  const orderRes = await db.collection('orders').doc(orderId).get()
  const order = orderRes.data
  if (!order || order._openid !== payerOpenid) {
    return fail('订单不存在', 'ORDER_NOT_FOUND')
  }
  if (order.status !== 'pending_pay') {
    return fail('订单不可支付', 'INVALID_STATUS', { status: order.status })
  }
  if (!order.useWalletPay && !event.force) {
    return fail('本单未选用钱包支付', 'WALLET_NOT_REQUESTED')
  }

  const totalFen = Math.round(parseFloat(String(order.totalPrice).replace(/,/g, '')) * 100)
  if (!totalFen || totalFen <= 0) return fail('订单金额异常', 'INVALID_AMOUNT')

  const requestedFen = event.amountFen != null
    ? Math.round(Number(event.amountFen) || 0)
    : (order.paymentBreakdown && order.paymentBreakdown.walletPayFen != null
      ? Math.round(Number(order.paymentBreakdown.walletPayFen) || 0)
      : totalFen)
  const debitFen = Math.min(totalFen, Math.max(0, requestedFen))
  if (debitFen <= 0) return fail('钱包扣款额无效', 'INVALID_AMOUNT')

  // 若上次扣款已回账，递增 attempt；若仍 held 则复用当前 attempt（幂等）
  let attempt = Math.max(1, Math.round(Number(order.walletDebitAttempt) || 1))
  if (order.walletDebitStatus === 'refunded') {
    attempt += 1
  }

  const result = await debitForOrder(db, _, payerOpenid, debitFen, {
    orderId,
    orderNo: order.orderNo || '',
    remark: '订单钱包支付',
    attempt
  })
  if (!result.success) return result

  const wxpayFen = Math.max(0, totalFen - result.debitedFen)
  const breakdown = {
    totalFen,
    walletPayFen: result.debitedFen,
    wxpayFen,
    ledgerId: result.ledgerId || '',
    attempt: result.attempt || attempt,
    updatedAt: new Date().toISOString()
  }

  await db.collection('orders').doc(orderId).update({
    data: {
      paymentBreakdown: breakdown,
      walletPaidFen: result.debitedFen,
      walletLedgerId: result.ledgerId || '',
      walletDebitAttempt: result.attempt || attempt,
      walletDebitStatus: 'held',
      updateTime: db.serverDate(),
      ...(wxpayFen === 0 ? { wxPayMode: 'wallet' } : {})
    }
  }).catch((e) => console.warn('order wallet breakdown update', e && e.message))

  return {
    success: true,
    orderId,
    debitedFen: result.debitedFen,
    wxpayFen,
    fullyPaidByWallet: wxpayFen === 0,
    account: result.account,
    alreadyDebited: !!result.alreadyDebited,
    paymentBreakdown: breakdown,
    attempt: result.attempt || attempt
  }
}

/**
 * 微信支付失败 / 用户取消：回退已扣钱包（仅 pending_pay）
 */
async function refundWalletForOrderAction(openid, event) {
  const orderId = String(event.orderId || '').trim()
  if (!orderId) return fail('缺少订单 ID', 'MISSING_ORDER')

  let payerOpenid = openid || String(event.openid || '').trim()
  if (!payerOpenid) return fail('请先登录', 'UNAUTHORIZED')

  if (!openid && PAY_CALLBACK_KEY) {
    const key = String(event.internalKey || event.callbackKey || '').trim()
    if (key && key !== PAY_CALLBACK_KEY) {
      return fail('无权回账', 'FORBIDDEN')
    }
  }

  const orderRes = await db.collection('orders').doc(orderId).get()
  const order = orderRes.data
  if (!order || order._openid !== payerOpenid) {
    return fail('订单不存在', 'ORDER_NOT_FOUND')
  }

  // 待支付回账；已 void 仍 held 的孤儿单允许补救回账
  const status = order.status
  const heldOrphan = order.walletDebitStatus === 'held' &&
    (status === 'void' || status === 'cancelled' || status === 'closed')
  if (status !== 'pending_pay' && !heldOrphan) {
    return fail('订单状态不可回账', 'INVALID_STATUS', { status })
  }

  if (!order.walletPaidFen && order.walletDebitStatus !== 'held') {
    return { success: true, nothingToRefund: true, creditedFen: 0 }
  }

  const attempt = Math.max(
    1,
    Math.round(Number(
      (order.paymentBreakdown && order.paymentBreakdown.attempt) ||
      order.walletDebitAttempt ||
      1
    ))
  )

  const result = await refundCreditForOrder(db, _, payerOpenid, orderId, {
    orderNo: order.orderNo || '',
    attempt,
    remark: event.remark || (heldOrphan ? '超时关单·钱包回账' : '支付未完成·钱包回账')
  })
  if (!result.success) return result

  if (!result.nothingToRefund) {
    await db.collection('orders').doc(orderId).update({
      data: {
        walletDebitStatus: 'refunded',
        walletPaidFen: 0,
        walletLedgerId: '',
        'paymentBreakdown.walletPayFen': 0,
        'paymentBreakdown.wxpayFen': Math.round(parseFloat(String(order.totalPrice).replace(/,/g, '')) * 100) || 0,
        'paymentBreakdown.refundedAt': new Date().toISOString(),
        updateTime: db.serverDate(),
        wxPayMode: _.remove
      }
    }).catch(async (e) => {
      console.warn('order wallet refund update', e && e.message)
      await db.collection('orders').doc(orderId).update({
        data: {
          walletDebitStatus: 'refunded',
          walletPaidFen: 0,
          updateTime: db.serverDate()
        }
      }).catch(() => {})
    })
  }

  return {
    success: true,
    orderId,
    creditedFen: result.creditedFen || 0,
    alreadyRefunded: !!result.alreadyRefunded,
    nothingToRefund: !!result.nothingToRefund,
    account: result.account
  }
}

/**
 * 已成交订单退款：钱包实付部分退回（供 refundOrder 调用）
 */
async function creditRefundForOrderAction(openid, event) {
  const orderId = String(event.orderId || '').trim()
  if (!orderId) return fail('缺少订单 ID', 'MISSING_ORDER')

  let actorOpenid = openid || String(event.openid || '').trim()
  const key = String(event.internalKey || event.callbackKey || '').trim()
  const keyOk = !!(PAY_CALLBACK_KEY && key && key === PAY_CALLBACK_KEY)

  const orderRes = await db.collection('orders').doc(orderId).get()
  const order = orderRes.data
  if (!order) return fail('订单不存在', 'ORDER_NOT_FOUND')

  const ownerOpenid = order._openid || ''
  // 内部密钥 / 店员嵌套 / 买家本人均可触发（最终入买家账户）
  if (!keyOk) {
    if (!actorOpenid) return fail('请先登录', 'UNAUTHORIZED')
    if (actorOpenid !== ownerOpenid) {
      const guard = await assertStaff(db, actorOpenid, {
        role: ROLE_STAFF,
        adminOpsKey: event && event.adminOpsKey
      })
      if (!guard.ok) return fail('无权退回钱包', 'FORBIDDEN')
    }
  }

  const walletPaidFen = Math.max(0, Math.round(Number(order.walletPaidFen) || 0))
  const breakdownWallet = order.paymentBreakdown
    ? Math.max(0, Math.round(Number(order.paymentBreakdown.walletPayFen) || 0))
    : 0
  const baseWallet = walletPaidFen || breakdownWallet
  if (baseWallet <= 0 && order.walletDebitStatus !== 'consumed' && order.walletDebitStatus !== 'held') {
    return { success: true, nothingToRefund: true, creditedFen: 0 }
  }

  let amountFen = event.amountFen != null
    ? Math.max(0, Math.round(Number(event.amountFen) || 0))
    : baseWallet
  if (baseWallet > 0 && amountFen > baseWallet) amountFen = baseWallet
  if (amountFen <= 0) {
    return { success: true, nothingToRefund: true, creditedFen: 0 }
  }

  const attempt = Math.max(
    1,
    Math.round(Number(
      (order.paymentBreakdown && order.paymentBreakdown.attempt) ||
      order.walletDebitAttempt ||
      1
    ))
  )

  const result = await creditOrderRefund(db, _, ownerOpenid, orderId, {
    amountFen,
    orderNo: order.orderNo || '',
    attempt,
    remark: event.remark || '订单退款·退回钱包'
  })
  if (!result.success) return result

  if (!result.nothingToRefund && !result.alreadyRefunded) {
    await db.collection('orders').doc(orderId).update({
      data: {
        walletDebitStatus: 'order_refunded',
        walletRefundedFen: amountFen,
        walletRefundLedgerId: result.ledgerId || '',
        walletRefundAt: db.serverDate(),
        updateTime: db.serverDate()
      }
    }).catch((e) => console.warn('order wallet credit refund update', e && e.message))
  }

  return {
    success: true,
    orderId,
    creditedFen: result.creditedFen || 0,
    alreadyRefunded: !!result.alreadyRefunded,
    nothingToRefund: !!result.nothingToRefund,
    account: result.account,
    ledgerId: result.ledgerId || ''
  }
}

/**
 * 清理超时/已取消订单上仍 held 的钱包扣款（店长或用户扫自己的单）
 */
async function releaseHeldWalletDebitsAction(openid, event) {
  const gate = await requireEnabled()
  if (!gate.ok) return fail(gate.msg, gate.code)
  if (!openid) return fail('请先登录', 'UNAUTHORIZED')

  const orderId = String((event && event.orderId) || '').trim()
  if (orderId) {
    // 单笔：走 refundWalletForOrder（含 void 孤儿补救）
    return refundWalletForOrderAction(openid, {
      ...event,
      orderId,
      remark: (event && event.remark) || '超时/取消·释放钱包冻结'
    })
  }

  // 批量：仅处理本人 pending_pay/void 且 held 的订单
  const limit = Math.min(20, Math.max(1, parseInt(event && event.limit, 10) || 10))
  let rows = []
  try {
    const res = await db.collection('orders')
      .where({
        _openid: openid,
        walletDebitStatus: 'held',
        status: _.in(['pending_pay', 'void', 'cancelled', 'closed'])
      })
      .limit(limit)
      .get()
    rows = res.data || []
  } catch (e) {
    console.warn('releaseHeldWalletDebits query', e && e.message)
    return fail('查询待释放订单失败', 'QUERY_FAILED')
  }

  const results = []
  for (const order of rows) {
    const oid = order._id
    const expired = order.payExpireTime
      ? new Date(order.payExpireTime).getTime() < Date.now()
      : order.status !== 'pending_pay'
    if (order.status === 'pending_pay' && !expired && !(event && event.force)) {
      results.push({ orderId: oid, skipped: true, reason: 'not_expired' })
      continue
    }
    const r = await refundWalletForOrderAction(openid, {
      orderId: oid,
      remark: expired ? '支付超时·自动释放钱包' : '取消订单·释放钱包'
    })
    results.push({ orderId: oid, ...r })
  }

  return {
    success: true,
    scanned: rows.length,
    released: results.filter((r) => r.success && (r.creditedFen > 0 || r.alreadyRefunded)).length,
    results
  }
}

async function ensureCollectionsSafe(openid, event) {
  const guard = await assertStaff(db, openid, {
    role: 'manager',
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return fail(guard.msg || '无权限', guard.code || 'FORBIDDEN')

  const names = [ACCOUNTS, LEDGERS, RECHARGE_ORDERS, CONFIG_COLLECTION]
  for (const name of names) {
    await ensureCollection(db, name)
  }
  return { success: true, collections: names, msg: '集合已就绪（建议权限 PRIVATE；索引见文档）' }
}

async function staffDebit(openid, event) {
  const gate = await requireEnabled()
  if (!gate.ok) return fail(gate.msg, gate.code)

  const guard = await assertStaff(db, openid, { role: ROLE_STAFF })
  if (!guard.ok) return fail(guard.msg || '无店员权限', guard.code || 'FORBIDDEN')

  const amountFen = Math.round(Number(event.amountFen) || 0)
  const targetOpenid = String(event.targetOpenid || '').trim()
  if (!targetOpenid) return fail('缺少会员 openid', 'INVALID_TARGET')
  if (amountFen <= 0) return fail('扣款金额无效', 'INVALID_AMOUNT')

  return {
    success: false,
    code: 'NOT_IMPLEMENTED',
    msg: '门店核销扣款将在后续开放',
    preview: {
      targetOpenid,
      amountFen,
      amountYuan: fenToYuan(amountFen),
      operator: (guard.actor && guard.actor.openid) || openid
    }
  }
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext()
  // 嵌套 callFunction 时用户身份在 FROM_OPENID
  const openid = wxContext.OPENID || wxContext.FROM_OPENID || ''
  const action = String((event && event.action) || 'getAccount').trim()

  try {
    switch (action) {
      case 'getAccount':
        return await getAccount(openid)
      case 'listPackages':
      case 'listTiers':
        return await listPackages()
      case 'getConfig':
        return await getConfigAction(openid, event)
      case 'saveConfig':
        return await saveConfigAction(openid, event)
      case 'listLedgers':
        return await listLedgers(openid, event)
      case 'createRecharge':
        return await createRecharge(openid, event)
      case 'confirmRecharge':
        return await confirmRecharge(openid, event)
      case 'debitForOrder':
        return await debitForOrderAction(openid, event)
      case 'refundWalletForOrder':
        return await refundWalletForOrderAction(openid, event)
      case 'creditRefundForOrder':
        return await creditRefundForOrderAction(openid, event)
      case 'releaseHeldWalletDebits':
        return await releaseHeldWalletDebitsAction(openid, event)
      case 'creditFromPayCallback':
        return await creditFromPayCallback(event)
      case 'reconcileRecharge':
        return await reconcileRechargeAction(openid, event)
      case 'ensureCollections':
        return await ensureCollectionsSafe(openid, event)
      case 'staffDebit':
        return await staffDebit(openid, event)
      case 'ping':
        return {
          success: true,
          enabled: await isStoredValueEnabled(db),
          payConfigured: !!SUB_MCH_ID,
          allowMockPay: ALLOW_MOCK_PAY,
          walletLabel: '我的钱包'
        }
      default:
        return fail(`未知 action: ${action}`, 'UNKNOWN_ACTION')
    }
  } catch (e) {
    console.error('manageStoredValue error', action, e)
    if (isMissingCollectionError(e)) {
      return fail(`请先创建集合（可超管调用 ensureCollections）`, 'COLLECTION_MISSING')
    }
    return fail(e.message || '服务异常', 'INTERNAL')
  }
}
