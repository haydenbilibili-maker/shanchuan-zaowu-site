/**
 * 账户保障与入账（本金/赠金分账 + 流水只追加 + 幂等）
 */
const { withCollectionRetry } = require('./collections')
const { grantRechargeRewards } = require('./rechargeRewards')

const ACCOUNTS = 'stored_value_accounts'
const LEDGERS = 'stored_value_ledgers'
const RECHARGE_ORDERS = 'stored_value_recharge_orders'

async function attachRechargeRewards(db, _, order, result) {
  if (!result || !result.success || !order) return result
  try {
    const rewards = await grantRechargeRewards(db, _, order)
    return Object.assign({}, result, {
      pointsGranted: rewards.points || 0,
      growthGranted: rewards.growth || 0,
      rewardsAlreadyGranted: !!rewards.alreadyGranted,
      rewardsOk: rewards.success !== false
    })
  } catch (e) {
    console.error('attachRechargeRewards', e)
    return Object.assign({}, result, {
      pointsGranted: 0,
      growthGranted: 0,
      rewardsOk: false,
      rewardsMsg: (e && e.message) || 'rewards failed'
    })
  }
}

function buildMemberNo(openid) {
  if (!openid || openid.length < 8) return 'MT-0000-0000'
  const shortId = openid.substr(openid.length - 8).toUpperCase()
  return `MT-${shortId.substr(0, 4)}-${shortId.substr(4, 4)}`
}

async function resolveMemberNo(db, openid) {
  try {
    const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
    const user = (res.data && res.data[0]) || null
    if (user && user.memberNo) return String(user.memberNo)
  } catch (e) {
    /* ignore */
  }
  return buildMemberNo(openid)
}

async function findAccountByOpenid(db, openid) {
  return withCollectionRetry(db, ACCOUNTS, async () => {
    const res = await db.collection(ACCOUNTS).where({ openid }).limit(1).get()
    return (res.data && res.data[0]) || null
  })
}

async function ensureAccount(db, openid) {
  const existing = await findAccountByOpenid(db, openid)
  if (existing) return existing

  const memberNo = await resolveMemberNo(db, openid)
  const payload = {
    openid,
    memberNo,
    principalFen: 0,
    bonusFen: 0,
    availableFen: 0,
    frozenFen: 0,
    status: 'active',
    version: 1,
    createTime: db.serverDate(),
    updateTime: db.serverDate()
  }

  return withCollectionRetry(db, ACCOUNTS, async () => {
    // 并发创建时再读一次
    const again = await db.collection(ACCOUNTS).where({ openid }).limit(1).get()
    if (again.data && again.data[0]) return again.data[0]

    const added = await db.collection(ACCOUNTS).add({ data: payload })
    return {
      _id: added._id,
      ...payload
    }
  })
}

function emptyAccountView(openid) {
  return {
    openid: openid || '',
    memberNo: buildMemberNo(openid),
    principalFen: 0,
    bonusFen: 0,
    availableFen: 0,
    frozenFen: 0,
    status: 'active',
    version: 0
  }
}

function serializeAccount(doc) {
  if (!doc) return null
  const principalFen = Number(doc.principalFen) || 0
  const bonusFen = Number(doc.bonusFen) || 0
  const availableFen = doc.availableFen != null
    ? Number(doc.availableFen) || 0
    : principalFen + bonusFen
  return {
    id: doc._id || '',
    openid: doc.openid || '',
    memberNo: doc.memberNo || '',
    principalFen,
    bonusFen,
    availableFen,
    frozenFen: Number(doc.frozenFen) || 0,
    status: doc.status || 'active',
    version: Number(doc.version) || 1,
    principalYuan: (principalFen / 100).toFixed(2),
    bonusYuan: (bonusFen / 100).toFixed(2),
    availableYuan: (availableFen / 100).toFixed(2)
  }
}

async function findLedgerByIdempotency(db, idempotencyKey) {
  return withCollectionRetry(db, LEDGERS, async () => {
    const res = await db.collection(LEDGERS).where({ idempotencyKey }).limit(1).get()
    return (res.data && res.data[0]) || null
  })
}

/**
 * 认领充值单进入 crediting，防止双回调双入账
 */
async function claimRechargeOrder(db, _, order) {
  // 仅 pending/paid 可认领一次；禁止 crediting→crediting 重复认领（payCallback 与 confirmRecharge 并发）
  const claimRes = await withCollectionRetry(db, RECHARGE_ORDERS, async () => {
    return db.collection(RECHARGE_ORDERS).where({
      _id: order._id,
      status: _.in(['pending', 'paid'])
    }).update({
      data: {
        status: 'crediting',
        creditClaimAt: db.serverDate(),
        updateTime: db.serverDate()
      }
    })
  })

  const updated = claimRes && claimRes.stats && claimRes.stats.updated
  if (updated) return { ok: true, claimed: true }

  const latest = await withCollectionRetry(db, RECHARGE_ORDERS, async () => {
    const res = await db.collection(RECHARGE_ORDERS).doc(order._id).get()
    return res.data
  })
  if (latest && latest.status === 'credited') {
    return { ok: true, alreadyCredited: true, order: latest }
  }
  if (latest && latest.status === 'crediting') {
    return { ok: false, contention: true, order: latest }
  }
  return { ok: false, msg: '充值单状态不可入账', order: latest }
}

async function appendLedgers(db, rows) {
  const ids = []
  for (const row of rows) {
    const added = await withCollectionRetry(db, LEDGERS, async () => {
      return db.collection(LEDGERS).add({ data: row })
    })
    ids.push(added._id)
  }
  return ids
}

/**
 * 支付成功后入账（幂等）。可由 payCallback / confirmRecharge 调用。
 */
async function creditRechargeOrder(db, _, order, options = {}) {
  if (!order || !order._id) {
    return { success: false, msg: '充值单无效' }
  }

  const idempotencyKey = `recharge:${order.outTradeNo}`
  const existing = await findLedgerByIdempotency(db, idempotencyKey)
  if (existing) {
    if (order.status !== 'credited') {
      await withCollectionRetry(db, RECHARGE_ORDERS, async () => {
        return db.collection(RECHARGE_ORDERS).doc(order._id).update({
          data: {
            status: 'credited',
            creditedAt: db.serverDate(),
            updateTime: db.serverDate(),
            transactionId: options.transactionId || order.transactionId || ''
          }
        })
      })
    }
    const account = await findAccountByOpenid(db, order.openid)
    return attachRechargeRewards(db, _, order, {
      success: true,
      alreadyCredited: true,
      account: serializeAccount(account),
      orderId: order._id
    })
  }

  const claim = await claimRechargeOrder(db, _, order)
  if (claim.alreadyCredited) {
    const account = await findAccountByOpenid(db, order.openid)
    return attachRechargeRewards(db, _, order, {
      success: true,
      alreadyCredited: true,
      account: serializeAccount(account),
      orderId: order._id
    })
  }
  if (!claim.ok) {
    if (claim.contention || (claim.order && claim.order.status === 'crediting')) {
      const raced = await findLedgerByIdempotency(db, idempotencyKey)
      if (raced) {
        await withCollectionRetry(db, RECHARGE_ORDERS, async () => {
          return db.collection(RECHARGE_ORDERS).doc(order._id).update({
            data: {
              status: 'credited',
              creditedAt: db.serverDate(),
              updateTime: db.serverDate(),
              transactionId: options.transactionId || order.transactionId || ''
            }
          })
        })
        const account = await findAccountByOpenid(db, order.openid)
        return attachRechargeRewards(db, _, order, {
          success: true,
          alreadyCredited: true,
          account: serializeAccount(account),
          orderId: order._id
        })
      }
      return {
        success: false,
        code: 'CREDIT_IN_PROGRESS',
        pendingConfirm: true,
        msg: '入账处理中，请稍后下拉刷新'
      }
    }
    return { success: false, msg: claim.msg || '无法认领充值单' }
  }

  // 再次检查流水（认领窗口内并发）
  const existing2 = await findLedgerByIdempotency(db, idempotencyKey)
  if (existing2) {
    await withCollectionRetry(db, RECHARGE_ORDERS, async () => {
      return db.collection(RECHARGE_ORDERS).doc(order._id).update({
        data: { status: 'credited', creditedAt: db.serverDate(), updateTime: db.serverDate() }
      })
    })
    const account = await findAccountByOpenid(db, order.openid)
    return attachRechargeRewards(db, _, order, {
      success: true,
      alreadyCredited: true,
      account: serializeAccount(account),
      orderId: order._id
    })
  }

  const account = await ensureAccount(db, order.openid)
  // 新产品规则：充值仅入本金。旧单若已写入 bonusFen>0 仍兼容入账，避免历史回调丢赠金。
  const principalDelta = Number(order.principalFen) || 0
  const bonusDelta = Math.max(0, Number(order.bonusFen) || 0)
  if (principalDelta <= 0 && bonusDelta <= 0) {
    return { success: false, msg: '充值金额异常' }
  }

  const version = Number(account.version) || 1
  const nextPrincipal = (Number(account.principalFen) || 0) + principalDelta
  const nextBonus = (Number(account.bonusFen) || 0) + bonusDelta
  const nextAvailable = nextPrincipal + nextBonus

  const upd = await withCollectionRetry(db, ACCOUNTS, async () => {
    return db.collection(ACCOUNTS).where({
      _id: account._id,
      version
    }).update({
      data: {
        principalFen: nextPrincipal,
        bonusFen: nextBonus,
        availableFen: nextAvailable,
        version: version + 1,
        updateTime: db.serverDate()
      }
    })
  })

  if (!upd.stats || !upd.stats.updated) {
    // 版本冲突：若另一路已写流水则收口 credited；仅 crediting 才回退 paid 供重试
    const raced = await findLedgerByIdempotency(db, idempotencyKey)
    if (raced) {
      await withCollectionRetry(db, RECHARGE_ORDERS, async () => {
        return db.collection(RECHARGE_ORDERS).doc(order._id).update({
          data: {
            status: 'credited',
            creditedAt: db.serverDate(),
            updateTime: db.serverDate()
          }
        })
      })
      const acc = await findAccountByOpenid(db, order.openid)
      return attachRechargeRewards(db, _, order, {
        success: true,
        alreadyCredited: true,
        account: serializeAccount(acc),
        orderId: order._id
      })
    }
    await withCollectionRetry(db, RECHARGE_ORDERS, async () => {
      return db.collection(RECHARGE_ORDERS).where({
        _id: order._id,
        status: 'crediting'
      }).update({
        data: { status: 'paid', updateTime: db.serverDate() }
      })
    })
    return { success: false, code: 'VERSION_CONFLICT', msg: '账户繁忙，请稍后确认支付结果' }
  }

  const now = db.serverDate()
  const ledgerRows = []
  if (principalDelta > 0) {
    ledgerRows.push({
      accountId: account._id,
      openid: order.openid,
      type: 'recharge',
      amountFen: principalDelta,
      principalDeltaFen: principalDelta,
      bonusDeltaFen: 0,
      balanceAfterFen: nextAvailable,
      refType: 'recharge_order',
      refId: order._id,
      outTradeNo: order.outTradeNo,
      packageId: order.packageId || order.tierId || '',
      remark: '钱包充值',
      idempotencyKey,
      createTime: now
    })
  }
  if (bonusDelta > 0) {
    // 仅兼容历史充值单；新单 createRecharge 固定 bonusFen=0
    ledgerRows.push({
      accountId: account._id,
      openid: order.openid,
      type: 'recharge_bonus',
      amountFen: bonusDelta,
      principalDeltaFen: 0,
      bonusDeltaFen: bonusDelta,
      balanceAfterFen: nextAvailable,
      refType: 'recharge_order',
      refId: order._id,
      outTradeNo: order.outTradeNo,
      packageId: order.packageId || order.tierId || '',
      remark: '历史赠金入账',
      idempotencyKey: `recharge_bonus:${order.outTradeNo}`,
      createTime: now
    })
  }

  try {
    await appendLedgers(db, ledgerRows)
  } catch (ledgerErr) {
    console.error('appendLedgers failed after account update', ledgerErr)
    // 账户已加：仍标记 credited，流水失败靠对账补偿；避免重复加款
  }

  await withCollectionRetry(db, RECHARGE_ORDERS, async () => {
    return db.collection(RECHARGE_ORDERS).doc(order._id).update({
      data: {
        status: 'credited',
        creditedAt: now,
        updateTime: now,
        transactionId: options.transactionId || order.transactionId || '',
        wxPayMode: options.wxPayMode || order.wxPayMode || 'wechat'
      }
    })
  })

  return attachRechargeRewards(db, _, order, {
    success: true,
    account: serializeAccount({
      ...account,
      principalFen: nextPrincipal,
      bonusFen: nextBonus,
      availableFen: nextAvailable,
      version: version + 1
    }),
    orderId: order._id,
    creditedFen: principalDelta + bonusDelta
  })
}

/**
 * 订单钱包扣款（幂等）。优先扣本金，再扣历史赠金余额。
 * amountFen：应付扣减额（分）；refId：订单 _id
 * 支持取消支付后回账再扣：用 order.walletDebitAttempt 区分轮次。
 */
async function debitForOrder(db, _, openid, amountFen, options = {}) {
  const payFen = Math.max(0, Math.round(Number(amountFen) || 0))
  if (payFen <= 0) {
    return { success: false, code: 'INVALID_AMOUNT', msg: '扣款金额无效' }
  }
  const orderId = String(options.orderId || options.refId || '').trim()
  if (!orderId) {
    return { success: false, code: 'MISSING_ORDER', msg: '缺少订单 ID' }
  }
  const attempt = Math.max(1, Math.round(Number(options.attempt) || 1))
  const idempotencyKey = `order_pay:${orderId}:${attempt}`
  const existing = await findLedgerByIdempotency(db, idempotencyKey)
  if (existing) {
    const account = await findAccountByOpenid(db, openid)
    return {
      success: true,
      alreadyDebited: true,
      debitedFen: Math.abs(Number(existing.amountFen) || payFen),
      account: serializeAccount(account),
      ledgerId: existing._id,
      attempt
    }
  }

  // 兼容一期无 attempt 的流水
  if (attempt === 1) {
    const legacy = await findLedgerByIdempotency(db, `order_pay:${orderId}`)
    if (legacy) {
      const refunded = await findLedgerByIdempotency(db, `order_pay_refund:${orderId}`)
      const refundedAttempt = await findLedgerByIdempotency(db, `order_pay_refund:${orderId}:1`)
      if (!refunded && !refundedAttempt) {
        const account = await findAccountByOpenid(db, openid)
        return {
          success: true,
          alreadyDebited: true,
          debitedFen: Math.abs(Number(legacy.amountFen) || payFen),
          account: serializeAccount(account),
          ledgerId: legacy._id,
          attempt: 1
        }
      }
    }
  }

  const account = await ensureAccount(db, openid)
  if (account.status && account.status !== 'active') {
    return { success: false, code: 'ACCOUNT_FROZEN', msg: '钱包暂不可用' }
  }

  const available = Number(account.availableFen) != null
    ? Number(account.availableFen) || 0
    : (Number(account.principalFen) || 0) + (Number(account.bonusFen) || 0)
  if (available < payFen) {
    return {
      success: false,
      code: 'INSUFFICIENT_BALANCE',
      msg: '钱包余额不足',
      availableFen: available,
      needFen: payFen
    }
  }

  let remain = payFen
  const principalNow = Number(account.principalFen) || 0
  const bonusNow = Number(account.bonusFen) || 0
  const principalDelta = -Math.min(principalNow, remain)
  remain += principalDelta
  const bonusDelta = -Math.min(bonusNow, remain)

  const version = Number(account.version) || 1
  const nextPrincipal = principalNow + principalDelta
  const nextBonus = bonusNow + bonusDelta
  const nextAvailable = nextPrincipal + nextBonus

  const upd = await withCollectionRetry(db, ACCOUNTS, async () => {
    return db.collection(ACCOUNTS).where({
      _id: account._id,
      version,
      availableFen: _.gte(payFen)
    }).update({
      data: {
        principalFen: nextPrincipal,
        bonusFen: nextBonus,
        availableFen: nextAvailable,
        version: version + 1,
        updateTime: db.serverDate()
      }
    })
  })

  if (!upd.stats || !upd.stats.updated) {
    const raced = await findLedgerByIdempotency(db, idempotencyKey)
    if (raced) {
      const acc = await findAccountByOpenid(db, openid)
      return {
        success: true,
        alreadyDebited: true,
        debitedFen: Math.abs(Number(raced.amountFen) || payFen),
        account: serializeAccount(acc),
        ledgerId: raced._id,
        attempt
      }
    }
    return { success: false, code: 'VERSION_CONFLICT', msg: '账户繁忙，请重试支付' }
  }

  const now = db.serverDate()
  let ledgerId = ''
  try {
    const added = await withCollectionRetry(db, LEDGERS, async () => {
      return db.collection(LEDGERS).add({
        data: {
          accountId: account._id,
          openid,
          type: 'order_pay',
          amountFen: -payFen,
          principalDeltaFen: principalDelta,
          bonusDeltaFen: bonusDelta,
          balanceAfterFen: nextAvailable,
          refType: 'order',
          refId: orderId,
          orderNo: options.orderNo || '',
          remark: options.remark || '订单钱包支付',
          idempotencyKey,
          debitAttempt: attempt,
          createTime: now
        }
      })
    })
    ledgerId = added._id
  } catch (ledgerErr) {
    console.error('debitForOrder ledger failed', ledgerErr)
  }

  return {
    success: true,
    debitedFen: payFen,
    principalDeltaFen: principalDelta,
    bonusDeltaFen: bonusDelta,
    account: serializeAccount({
      ...account,
      principalFen: nextPrincipal,
      bonusFen: nextBonus,
      availableFen: nextAvailable,
      version: version + 1
    }),
    ledgerId,
    attempt
  }
}

/**
 * 待支付订单：微信支付失败/用户取消时回账（幂等）。
 * 仅当订单仍为 pending_pay 且存在未回滚的扣款流水时生效。
 */
async function refundCreditForOrder(db, _, openid, orderId, options = {}) {
  const oid = String(orderId || '').trim()
  if (!oid) {
    return { success: false, code: 'MISSING_ORDER', msg: '缺少订单 ID' }
  }

  const attempt = Math.max(1, Math.round(Number(options.attempt) || 1))
  const refundKey = `order_pay_refund:${oid}:${attempt}`
  const already = await findLedgerByIdempotency(db, refundKey)
  if (already) {
    const account = await findAccountByOpenid(db, openid)
    return {
      success: true,
      alreadyRefunded: true,
      creditedFen: Math.abs(Number(already.amountFen) || 0),
      account: serializeAccount(account)
    }
  }

  let debit = await findLedgerByIdempotency(db, `order_pay:${oid}:${attempt}`)
  if (!debit && attempt === 1) {
    debit = await findLedgerByIdempotency(db, `order_pay:${oid}`)
  }
  if (!debit) {
    return { success: true, nothingToRefund: true, creditedFen: 0 }
  }

  // 本金/赠金按原扣款分项回冲（delta 原为负，取反入账）
  const principalDelta = -Number(debit.principalDeltaFen || 0)
  const bonusDelta = -Number(debit.bonusDeltaFen || 0)
  let creditFen = principalDelta + bonusDelta
  if (creditFen <= 0) {
    creditFen = Math.abs(Number(debit.amountFen) || 0)
  }
  if (creditFen <= 0) {
    return { success: true, nothingToRefund: true, creditedFen: 0 }
  }

  const account = await ensureAccount(db, openid)
  const version = Number(account.version) || 1
  // 若旧流水未拆分 principal/bonus，整笔回本金
  const useSplit = (Number(debit.principalDeltaFen) || 0) !== 0 || (Number(debit.bonusDeltaFen) || 0) !== 0
  const finalPrincipal = useSplit
    ? (Number(account.principalFen) || 0) + principalDelta
    : (Number(account.principalFen) || 0) + creditFen
  const finalBonus = useSplit
    ? (Number(account.bonusFen) || 0) + bonusDelta
    : (Number(account.bonusFen) || 0)
  const nextAvailable = finalPrincipal + finalBonus

  const upd = await withCollectionRetry(db, ACCOUNTS, async () => {
    return db.collection(ACCOUNTS).where({
      _id: account._id,
      version
    }).update({
      data: {
        principalFen: finalPrincipal,
        bonusFen: finalBonus,
        availableFen: nextAvailable,
        version: version + 1,
        updateTime: db.serverDate()
      }
    })
  })

  if (!upd.stats || !upd.stats.updated) {
    const raced = await findLedgerByIdempotency(db, refundKey)
    if (raced) {
      const acc = await findAccountByOpenid(db, openid)
      return {
        success: true,
        alreadyRefunded: true,
        creditedFen: Math.abs(Number(raced.amountFen) || creditFen),
        account: serializeAccount(acc)
      }
    }
    return { success: false, code: 'VERSION_CONFLICT', msg: '账户繁忙，请稍后重试回账' }
  }

  const now = db.serverDate()
  let ledgerId = ''
  try {
    const added = await withCollectionRetry(db, LEDGERS, async () => {
      return db.collection(LEDGERS).add({
        data: {
          accountId: account._id,
          openid,
          type: 'order_unfreeze',
          amountFen: creditFen,
          principalDeltaFen: useSplit ? principalDelta : creditFen,
          bonusDeltaFen: useSplit ? bonusDelta : 0,
          balanceAfterFen: nextAvailable,
          refType: 'order',
          refId: oid,
          orderNo: options.orderNo || '',
          remark: options.remark || '支付未完成·钱包回账',
          idempotencyKey: refundKey,
          debitAttempt: attempt,
          createTime: now
        }
      })
    })
    ledgerId = added._id
  } catch (e) {
    console.error('refundCreditForOrder ledger failed', e)
  }

  return {
    success: true,
    creditedFen: creditFen,
    account: serializeAccount({
      ...account,
      principalFen: finalPrincipal,
      bonusFen: finalBonus,
      availableFen: nextAvailable,
      version: version + 1
    }),
    ledgerId,
    attempt
  }
}

/**
 * 已成交订单退款：将原钱包实扣按退款额退回（幂等）。
 * 与 refundCreditForOrder（待支付回账）区分：流水 type=refund_credit。
 */
async function creditOrderRefund(db, _, openid, orderId, options = {}) {
  const oid = String(orderId || '').trim()
  if (!oid) {
    return { success: false, code: 'MISSING_ORDER', msg: '缺少订单 ID' }
  }

  const refundKey = `order_refund_credit:${oid}`
  const already = await findLedgerByIdempotency(db, refundKey)
  if (already) {
    const account = await findAccountByOpenid(db, openid)
    return {
      success: true,
      alreadyRefunded: true,
      creditedFen: Math.abs(Number(already.amountFen) || 0),
      account: serializeAccount(account),
      ledgerId: already._id
    }
  }

  let creditFen = Math.max(0, Math.round(Number(options.amountFen) || 0))
  let principalDelta = 0
  let bonusDelta = 0
  let useSplit = false

  // 优先按原扣款分项比例回冲；若指定 amountFen 小于原扣款，按比例拆分
  const attempt = Math.max(1, Math.round(Number(options.attempt) || 1))
  let debit = await findLedgerByIdempotency(db, `order_pay:${oid}:${attempt}`)
  if (!debit && attempt === 1) {
    debit = await findLedgerByIdempotency(db, `order_pay:${oid}`)
  }
  // 尝试更高 attempt（多次 held 后实付）
  if (!debit && options.attempt == null) {
    for (let a = attempt + 1; a <= attempt + 5; a += 1) {
      debit = await findLedgerByIdempotency(db, `order_pay:${oid}:${a}`)
      if (debit) break
    }
  }

  if (debit) {
    const origPrincipal = Math.abs(Number(debit.principalDeltaFen) || 0)
    const origBonus = Math.abs(Number(debit.bonusDeltaFen) || 0)
    const origTotal = origPrincipal + origBonus || Math.abs(Number(debit.amountFen) || 0)
    if (creditFen <= 0) creditFen = origTotal
    if (creditFen > origTotal) creditFen = origTotal
    if (origTotal > 0 && (origPrincipal > 0 || origBonus > 0)) {
      useSplit = true
      principalDelta = Math.round(creditFen * (origPrincipal / origTotal))
      bonusDelta = creditFen - principalDelta
    }
  }

  if (creditFen <= 0) {
    return { success: true, nothingToRefund: true, creditedFen: 0 }
  }

  const account = await ensureAccount(db, openid)
  const version = Number(account.version) || 1
  const finalPrincipal = useSplit
    ? (Number(account.principalFen) || 0) + principalDelta
    : (Number(account.principalFen) || 0) + creditFen
  const finalBonus = useSplit
    ? (Number(account.bonusFen) || 0) + bonusDelta
    : (Number(account.bonusFen) || 0)
  const nextAvailable = finalPrincipal + finalBonus

  const upd = await withCollectionRetry(db, ACCOUNTS, async () => {
    return db.collection(ACCOUNTS).where({
      _id: account._id,
      version
    }).update({
      data: {
        principalFen: finalPrincipal,
        bonusFen: finalBonus,
        availableFen: nextAvailable,
        version: version + 1,
        updateTime: db.serverDate()
      }
    })
  })

  if (!upd.stats || !upd.stats.updated) {
    const raced = await findLedgerByIdempotency(db, refundKey)
    if (raced) {
      const acc = await findAccountByOpenid(db, openid)
      return {
        success: true,
        alreadyRefunded: true,
        creditedFen: Math.abs(Number(raced.amountFen) || creditFen),
        account: serializeAccount(acc),
        ledgerId: raced._id
      }
    }
    return { success: false, code: 'VERSION_CONFLICT', msg: '账户繁忙，请稍后重试退款入账' }
  }

  const now = db.serverDate()
  let ledgerId = ''
  try {
    const added = await withCollectionRetry(db, LEDGERS, async () => {
      return db.collection(LEDGERS).add({
        data: {
          accountId: account._id,
          openid,
          type: 'refund_credit',
          amountFen: creditFen,
          principalDeltaFen: useSplit ? principalDelta : creditFen,
          bonusDeltaFen: useSplit ? bonusDelta : 0,
          balanceAfterFen: nextAvailable,
          refType: 'order',
          refId: oid,
          orderNo: options.orderNo || '',
          remark: options.remark || '订单退款·退回钱包',
          idempotencyKey: refundKey,
          createTime: now
        }
      })
    })
    ledgerId = added._id
  } catch (e) {
    console.error('creditOrderRefund ledger failed', e)
  }

  return {
    success: true,
    creditedFen: creditFen,
    account: serializeAccount({
      ...account,
      principalFen: finalPrincipal,
      bonusFen: finalBonus,
      availableFen: nextAvailable,
      version: version + 1
    }),
    ledgerId
  }
}

module.exports = {
  ACCOUNTS,
  LEDGERS,
  RECHARGE_ORDERS,
  buildMemberNo,
  ensureAccount,
  findAccountByOpenid,
  emptyAccountView,
  serializeAccount,
  creditRechargeOrder,
  debitForOrder,
  refundCreditForOrder,
  creditOrderRefund,
  findLedgerByIdempotency
}
