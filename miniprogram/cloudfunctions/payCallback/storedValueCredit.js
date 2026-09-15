/**
 * 账户保障与入账（本金/赠金分账 + 流水只追加 + 幂等）
 */
const { withCollectionRetry } = require('./storedValueCollections')
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
async function creditRechargeOrderCore(db, _, order, options = {}) {
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
    return {
      success: true,
      alreadyCredited: true,
      account: serializeAccount(account),
      orderId: order._id
    }
  }

  const claim = await claimRechargeOrder(db, _, order)
  if (claim.alreadyCredited) {
    const account = await findAccountByOpenid(db, order.openid)
    return {
      success: true,
      alreadyCredited: true,
      account: serializeAccount(account),
      orderId: order._id
    }
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
        return {
          success: true,
          alreadyCredited: true,
          account: serializeAccount(account),
          orderId: order._id
        }
      }
      return {
        success: false,
        code: 'CREDIT_IN_PROGRESS',
        pendingConfirm: true,
        msg: '入账处理中，请稍后刷新'
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
    return {
      success: true,
      alreadyCredited: true,
      account: serializeAccount(account),
      orderId: order._id
    }
  }

  const account = await ensureAccount(db, order.openid)
  const principalDelta = Number(order.principalFen) || 0
  const bonusDelta = Number(order.bonusFen) || 0
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
      return {
        success: true,
        alreadyCredited: true,
        account: serializeAccount(acc),
        orderId: order._id
      }
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

  return {
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
  }
}

async function creditRechargeOrder(db, _, order, options = {}) {
  const result = await creditRechargeOrderCore(db, _, order, options)
  return attachRechargeRewards(db, _, order, result)
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
  findLedgerByIdempotency
}
