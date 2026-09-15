/**
 * 售罄孤品定金 — 超管规则 / 意向列表 / 上架触发尾款 / 逾期开放
 *
 * action:
 *   getRules | saveRules          仅超管
 *   listIntents                   超管 / 店长可读
 *   listArtisanDeposits           标本师 / 店长：本人关联定金待办
 *   openExpired | forfeitIntent   手动逾期开放（超管）
 *   onProductShelved              内部：上架后启动尾款窗口
 *   afterDepositPaid              内部：定金支付成功通知
 *   sweepBalanceDue               定时 / 手动清扫逾期
 *   getProductLock                查询商品锁（可选）
 */
const cloud = require('wx-server-sdk')
const {
  assertStaff,
  ROLE_MANAGER,
  WORKSPACE_SUPER_ADMIN,
  WORKSPACE_SPECIMEN_ARTISAN
} = require('./staffGuard')
const {
  COLLECTION,
  RULE_KEY,
  DEFAULT_RULES,
  STATUS,
  normalizeRules,
  describeRules,
  calcDepositAmount,
  statusLabel
} = require('./depositDefaults')
const {
  notifyDepositPaid,
  notifyBalanceWindow,
  notifyDepositForfeited,
  notifyDepositSettled,
  notifyWishlistAvailable
} = require('./depositNotify')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const INTENT_COLLECTION = 'deposit_intents'

function fail(msg, code) {
  return { success: false, msg, code: code || 'FAIL' }
}

async function requireManager(event, openid) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return { ok: false, res: fail(guard.msg, guard.code) }
  return { ok: true, actor: guard.actor }
}

async function requireSuperAdmin(event, openid) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    requireSuperAdmin: true,
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return { ok: false, res: fail(guard.msg, guard.code) }
  return { ok: true, actor: guard.actor }
}

async function requireArtisanOrManager(event, openid) {
  const guard = await assertStaff(db, openid, {
    role: WORKSPACE_SPECIMEN_ARTISAN,
    adminOpsKey: event && event.adminOpsKey
  })
  if (guard.ok) return { ok: true, actor: guard.actor }
  const asManager = await requireManager(event, openid)
  if (asManager.ok) return asManager
  return { ok: false, res: fail(guard.msg || '无权限', guard.code || 'FORBIDDEN') }
}

function isTimerEvent(event) {
  const triggerType = (event && (event.Type || event.triggerType || event.triggerSource)) || ''
  return /timer/i.test(String(triggerType)) || !!(event && event.TriggerName)
}

/**
 * 是否「非客户端来源」。实测定时触发时 wxContext.SOURCE 为空字符串，
 * 而小程序客户端必带 wx_client / wx_devtools —— 因此该判定 C 端无法伪造。
 * event._internal / event.fromApproval / event.Type 等字段均由调用方控制，
 * **一律不得作为授权依据**（原实现让任意人传 _internal:true 即可跑全站尾款结算）。
 */
function isNonClientSource() {
  try {
    const src = String((cloud.getWXContext() || {}).SOURCE || '')
    return !/wx_client|wx_devtools/i.test(src)
  } catch (e) {
    return false
  }
}

function errorText(err) {
  return [err && err.errCode, err && err.errMsg, err && err.message, String(err || '')]
    .filter(Boolean)
    .join(' ')
}

function isMissingCollectionError(err) {
  return /502005|DATABASE_COLLECTION_NOT_EXIST|COLLECTION_NOT_EXIST|collection not exist|集合不存在|not exist/i
    .test(errorText(err))
}

function isCollectionExistsError(err) {
  return /already exist|already exists|COLLECTION_EXIST|ResourceExist|-501001/i.test(errorText(err))
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name)
  } catch (err) {
    if (isCollectionExistsError(err)) return
    throw err
  }
}

async function withCollectionRetry(name, fn) {
  try {
    return await fn()
  } catch (err) {
    if (!isMissingCollectionError(err)) throw err
    await ensureCollection(name)
    return await fn()
  }
}

function formatDueLabel(raw) {
  if (!raw) return ''
  try {
    let d
    if (raw instanceof Date) d = raw
    else if (typeof raw === 'object' && raw.seconds) d = new Date(raw.seconds * 1000)
    else d = new Date(raw)
    if (Number.isNaN(d.getTime())) return ''
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${m}-${day}`
  } catch (e) {
    return ''
  }
}

function mapIntentRow(row) {
  if (!row) return null
  return {
    _id: row._id,
    productId: row.productId || '',
    title: row.title || '',
    image: row.image || '',
    productPrice: row.productPrice,
    depositAmount: row.depositAmount,
    balanceAmount: row.balanceAmount != null
      ? row.balanceAmount
      : Math.max(0, Math.round((Number(row.productPrice) || 0) - (Number(row.depositAmount) || 0))),
    status: row.status,
    statusLabel: statusLabel(row.status),
    openid: row._openid || row.openid || '',
    balanceDueAt: row.balanceDueAt || null,
    balanceDueLabel: formatDueLabel(row.balanceDueAt),
    shelvedAt: row.shelvedAt || null,
    forfeitedAt: row.forfeitedAt || null,
    createTime: row.createTime || null,
    note: row.note || '',
    depositOrderId: row.depositOrderId || '',
    depositOrderNo: row.depositOrderNo || '',
    balanceOrderId: row.balanceOrderId || '',
    balanceOrderNo: row.balanceOrderNo || ''
  }
}

async function attachOrderStatus(list) {
  const rows = Array.isArray(list) ? list : []
  const orderIds = []
  rows.forEach((r) => {
    if (r.depositOrderId) orderIds.push(r.depositOrderId)
    if (r.balanceOrderId) orderIds.push(r.balanceOrderId)
  })
  if (!orderIds.length) return rows
  const uniqIds = Array.from(new Set(orderIds.map((id) => String(id))))
  const map = {}
  const chunk = 20
  for (let i = 0; i < uniqIds.length; i += chunk) {
    const slice = uniqIds.slice(i, i + chunk)
    try {
      const res = await db.collection('orders').where({ _id: _.in(slice) }).get()
      ;(res.data || []).forEach((o) => {
        if (o && o._id) map[o._id] = o
      })
    } catch (e) {
      // doc get fallback
      await Promise.all(
        slice.map(async (id) => {
          try {
            const one = await db.collection('orders').doc(id).get()
            if (one.data) map[id] = { _id: id, ...one.data }
          } catch (err) { /* ignore */ }
        })
      )
    }
  }
  const orderStatusText = (o) => {
    if (!o) return ''
    if (o.orderType === 'deposit' || o.source === 'deposit') {
      if (o.status === 'pending_pay') return '待付定金'
      if (o.status === 'paid') return '已付定金'
      return o.status || ''
    }
    if (o.depositIntentId) {
      if (o.status === 'pending_pay') return '待付尾款'
      if (o.status === 'paid') return '尾款已付·待发货'
      if (o.status === 'shipped') return '尾款单已发货'
      if (o.status === 'received') return '尾款单已完成'
    }
    return o.status || ''
  }
  return rows.map((r) => {
    const depOrder = r.depositOrderId ? map[r.depositOrderId] : null
    const balOrder = r.balanceOrderId ? map[r.balanceOrderId] : null
    return {
      ...r,
      depositOrderStatus: depOrder ? depOrder.status : '',
      depositOrderStatusLabel: orderStatusText(depOrder),
      balanceOrderStatus: balOrder ? balOrder.status : '',
      balanceOrderStatusLabel: orderStatusText(balOrder)
    }
  })
}

async function loadRulesDoc() {
  return withCollectionRetry(COLLECTION, async () => {
    try {
      const byKey = await db.collection(COLLECTION).where({ key: RULE_KEY }).limit(1).get()
      if (byKey.data && byKey.data[0]) return byKey.data[0]
    } catch (e) { /* ignore */ }
    try {
      const doc = await db.collection(COLLECTION).doc(RULE_KEY).get()
      if (doc.data) return { _id: RULE_KEY, ...doc.data }
    } catch (e) { /* ignore */ }
    return null
  })
}

async function getRules() {
  const row = await loadRulesDoc()
  const rules = normalizeRules(row || DEFAULT_RULES)
  return {
    success: true,
    fromDefault: !row,
    docId: row ? (row._id || RULE_KEY) : '',
    rules,
    ruleText: describeRules(rules)
  }
}

async function saveRules(event, actor) {
  const rules = normalizeRules(event && event.rules)
  if (rules.minDepositAmount > rules.maxDepositAmount) {
    return fail('定金下限不能大于上限')
  }
  const payload = {
    ...rules,
    key: RULE_KEY,
    updateTime: db.serverDate(),
    updatedBy: actor.openid || '',
    updatedByName: actor.name || ''
  }
  await withCollectionRetry(COLLECTION, async () => {
    const existing = await loadRulesDoc()
    if (existing && existing._id) {
      await db.collection(COLLECTION).doc(existing._id).update({ data: payload })
      return
    }
    try {
      await db.collection(COLLECTION).doc(RULE_KEY).set({ data: payload })
    } catch (e) {
      await db.collection(COLLECTION).add({ data: payload })
    }
  })
  return {
    success: true,
    rules,
    ruleText: describeRules(rules),
    msg: '规则已保存'
  }
}

async function listIntents(event) {
  const status = String((event && event.status) || '').trim()
  const productId = String((event && event.productId) || '').trim()
  const limit = Math.min(100, Math.max(1, parseInt(event && event.limit, 10) || 50))
  const where = {}
  if (status && status !== 'all') where.status = status
  if (productId) where.productId = productId

  const res = await withCollectionRetry(INTENT_COLLECTION, async () => {
    let q = db.collection(INTENT_COLLECTION)
    if (Object.keys(where).length) q = q.where(where)
    return q.limit(limit).get()
  })

  const list = (res.data || [])
    .map(mapIntentRow)
    .sort((a, b) => {
      const ta = a.createTime ? new Date(a.createTime).getTime() : 0
      const tb = b.createTime ? new Date(b.createTime).getTime() : 0
      return tb - ta
    })

  const enriched = await attachOrderStatus(list)

  const counts = {
    intent: 0,
    pending_pay: 0,
    deposit_paid: 0,
    awaiting_balance: 0,
    settled: 0,
    forfeited_open: 0,
    cancelled: 0
  }
  enriched.forEach((row) => {
    if (counts[row.status] != null) counts[row.status] += 1
  })

  return { success: true, list: enriched, counts, total: enriched.length }
}

async function clearProductDepositLock(productId, extraPatch) {
  if (!productId) return
  const patch = {
    depositLockOpenid: _.remove(),
    depositLockUntil: _.remove(),
    depositLockIntentId: _.remove(),
    depositPublicOpenAt: db.serverDate(),
    ...(extraPatch || {})
  }
  try {
    await db.collection('products').doc(productId).update({ data: patch })
  } catch (e) {
    // 字段不存在时降级只写开放时间
    try {
      await db.collection('products').doc(productId).update({
        data: {
          depositLockOpenid: '',
          depositLockUntil: null,
          depositLockIntentId: '',
          depositPublicOpenAt: db.serverDate(),
          ...(extraPatch || {})
        }
      })
    } catch (e2) {
      console.warn('clearProductDepositLock', productId, e2 && e2.message)
    }
  }
}

async function setProductDepositLock(productId, openid, untilDate, intentId) {
  if (!productId || !openid) return
  try {
    await db.collection('products').doc(productId).update({
      data: {
        depositLockOpenid: openid,
        depositLockUntil: untilDate,
        depositLockIntentId: intentId || '',
        depositPublicOpenAt: null,
        updateTime: Date.now()
      }
    })
  } catch (e) {
    console.warn('setProductDepositLock', productId, e && e.message)
  }
}

/**
 * 上架后：
 * 1) 通知「想要」候补用户（山海有信）
 * 2) 若有已付定金意向 → 升为待尾款并通知定金用户
 */
async function onProductShelved(event) {
  const productId = String((event && event.productId) || '').trim()
  if (!productId) return fail('缺少 productId')

  let product = null
  try {
    const res = await db.collection('products').doc(productId).get()
    product = res.data
  } catch (e) {
    return fail('商品不存在')
  }
  if (!product) return fail('商品不存在')

  const productTitle = product.title || ''
  const eligible =
    product.depositEligible === true ||
    (product.depositEligible !== false && !!(product.isOneOfAKind || product.isUnique))

  const rulesRes = await getRules()
  const rules = rulesRes.rules || normalizeRules(DEFAULT_RULES)
  const windowDays = rules.balanceWindowDays || 7
  const dueAt = new Date(Date.now() + windowDays * 24 * 60 * 60 * 1000)

  let winner = null
  let winnerOpenid = ''
  let balanceAmount = 0

  if (eligible) {
    const intentsRes = await withCollectionRetry(INTENT_COLLECTION, () =>
      db.collection(INTENT_COLLECTION)
        .where({
          productId,
          status: STATUS.DEPOSIT_PAID
        })
        .limit(50)
        .get()
    )
    const intents = (intentsRes.data || []).slice().sort((a, b) => {
      const ta = a.createTime ? new Date(a.createTime).getTime() : 0
      const tb = b.createTime ? new Date(b.createTime).getTime() : 0
      return ta - tb
    })
    if (intents.length) {
      winner = intents[0]
      winnerOpenid = winner._openid || winner.openid || ''
      const price = Number(winner.productPrice != null ? winner.productPrice : product.price) || 0
      const depositAmount = Number(winner.depositAmount) || calcDepositAmount(price, rules)
      balanceAmount = Math.max(0, Math.round(price - depositAmount))

      await db.collection(INTENT_COLLECTION).doc(winner._id).update({
        data: {
          status: STATUS.AWAITING_BALANCE,
          shelvedAt: db.serverDate(),
          balanceDueAt: dueAt,
          balanceAmount,
          balanceWindowDays: windowDays,
          updateTime: db.serverDate(),
          note: `上架后进入尾款窗口 ${windowDays} 天；逾期将开放给所有人且定金不退`
        }
      })
      await setProductDepositLock(productId, winnerOpenid, dueAt, winner._id)

      notifyBalanceWindow(db, {
        intentId: winner._id,
        productId,
        openid: winnerOpenid,
        productTitle: winner.title || productTitle,
        balanceAmount,
        balanceWindowDays: windowDays,
        balanceDueLabel: formatDueLabel(dueAt)
      }).catch((e) => console.warn('notifyBalanceWindow', e && e.message))
    }
  }

  // 候补用户有信：排除定金得主（对方已收到「请付尾款」）
  notifyWishlistAvailable(db, {
    productId,
    productTitle,
    excludeOpenids: winnerOpenid ? [winnerOpenid] : []
  }).catch((e) => console.warn('notifyWishlistAvailable', e && e.message))

  if (!eligible) {
    return { success: true, skipped: true, reason: 'not_deposit_eligible', wishlistNotified: true }
  }
  if (!winner) {
    return { success: true, skipped: true, reason: 'no_intents', wishlistNotified: true }
  }

  return {
    success: true,
    productId,
    intentId: winner._id,
    openid: winnerOpenid,
    balanceDueAt: dueAt,
    balanceWindowDays: windowDays,
    balanceAmount,
    wishlistNotified: true,
    msg: `已进入待尾款（${windowDays} 天）`
  }
}

async function forfeitIntentRow(row, reason) {
  const productId = row.productId
  await db.collection(INTENT_COLLECTION).doc(row._id).update({
    data: {
      status: STATUS.FORFEITED_OPEN,
      forfeitedAt: db.serverDate(),
      forfeitReason: reason || 'balance_overdue',
      updateTime: db.serverDate(),
      note: '逾期未付尾款，商品已对线上开放；定金不退'
    }
  })
  // 仅当当前锁属于该意向时清除
  try {
    const prod = await db.collection('products').doc(productId).get()
    const p = prod.data || {}
    if (!p.depositLockIntentId || p.depositLockIntentId === row._id) {
      await clearProductDepositLock(productId, {
        depositForfeitIntentId: row._id
      })
    }
  } catch (e) {
    await clearProductDepositLock(productId)
  }

  notifyDepositForfeited(db, {
    intentId: row._id,
    productId,
    openid: row._openid || row.openid,
    productTitle: row.title || '',
    depositAmount: row.depositAmount
  }).catch((e) => console.warn('notifyDepositForfeited', e && e.message))

  return { intentId: row._id, productId }
}

async function openExpired(event, actor) {
  const intentId = String((event && event.intentId) || '').trim()
  const productId = String((event && event.productId) || '').trim()

  if (intentId) {
    const doc = await db.collection(INTENT_COLLECTION).doc(intentId).get()
    const row = doc.data
    if (!row) return fail('意向不存在')
    if (row.status === STATUS.FORFEITED_OPEN) {
      return { success: true, already: true, msg: '已是逾期开放状态' }
    }
    if (row.status !== STATUS.AWAITING_BALANCE && row.status !== STATUS.INTENT && row.status !== 'pending_pay') {
      return fail(`当前状态不可开放：${statusLabel(row.status)}`)
    }
    await forfeitIntentRow(row, actor && actor.openid ? `manual:${actor.openid}` : 'manual')
    return { success: true, msg: '已逾期开放，定金不退' }
  }

  if (productId) {
    const res = await db.collection(INTENT_COLLECTION)
      .where({
        productId,
        status: STATUS.AWAITING_BALANCE
      })
      .limit(20)
      .get()
    const rows = res.data || []
    if (!rows.length) {
      await clearProductDepositLock(productId)
      return { success: true, msg: '无待尾款意向，已清除商品锁' }
    }
    for (const row of rows) {
      await forfeitIntentRow(row, actor && actor.openid ? `manual:${actor.openid}` : 'manual')
    }
    return { success: true, count: rows.length, msg: `已开放 ${rows.length} 条` }
  }

  return fail('请指定 intentId 或 productId')
}

async function sweepBalanceDue(limit) {
  const cap = Math.min(100, Math.max(1, parseInt(limit, 10) || 50))
  const now = new Date()
  let rows = []
  try {
    const res = await db.collection(INTENT_COLLECTION)
      .where({
        status: STATUS.AWAITING_BALANCE,
        balanceDueAt: _.lte(now)
      })
      .limit(cap)
      .get()
    rows = res.data || []
  } catch (e) {
    // 无索引时降级
    const res = await db.collection(INTENT_COLLECTION)
      .where({ status: STATUS.AWAITING_BALANCE })
      .limit(cap)
      .get()
    rows = (res.data || []).filter((r) => {
      if (!r.balanceDueAt) return false
      return new Date(r.balanceDueAt).getTime() <= now.getTime()
    })
  }

  const results = []
  for (const row of rows) {
    try {
      results.push({ ...(await forfeitIntentRow(row, 'sweep_overdue')), success: true })
    } catch (err) {
      results.push({ intentId: row._id, success: false, msg: err.message })
    }
  }
  return {
    success: true,
    scanned: rows.length,
    forfeited: results.filter((r) => r.success).length,
    results
  }
}

async function afterDepositPaid(event) {
  const intentId = String((event && event.intentId) || '').trim()
  let productId = String((event && event.productId) || '').trim()
  let title = String((event && (event.productTitle || event.title)) || '').trim()
  let depositAmount = event && event.depositAmount
  let openid = String((event && event.openid) || '').trim()
  let orderId = String((event && event.orderId) || '').trim()

  if (intentId) {
    try {
      const doc = await db.collection(INTENT_COLLECTION).doc(intentId).get()
      const row = doc.data
      if (row) {
        if (!title) title = row.title || ''
        if (depositAmount == null) depositAmount = row.depositAmount
        if (!productId) productId = row.productId || ''
        if (!openid) openid = row._openid || row.openid || ''
        if (!orderId) orderId = row.depositOrderId || row.orderId || ''
      }
    } catch (e) {
      console.warn('afterDepositPaid load intent', e && e.message)
    }
  }

  return notifyDepositPaid(db, {
    intentId,
    productId,
    productTitle: title,
    depositAmount,
    openid,
    orderId,
    orderNo: (event && event.orderNo) || ''
  })
}

async function afterDepositSettled(event) {
  const intentId = String((event && event.intentId) || '').trim()
  let productId = String((event && event.productId) || '').trim()
  let title = String((event && (event.productTitle || event.title)) || '').trim()
  let openid = String((event && event.openid) || '').trim()
  let orderId = String((event && event.orderId) || '').trim()

  if (intentId) {
    try {
      const doc = await db.collection(INTENT_COLLECTION).doc(intentId).get()
      const row = doc.data
      if (row) {
        if (!title) title = row.title || ''
        if (!productId) productId = row.productId || ''
        if (!openid) openid = row._openid || row.openid || ''
        if (!orderId) orderId = row.balanceOrderId || row.orderId || row.depositOrderId || ''
      }
    } catch (e) {
      console.warn('afterDepositSettled load intent', e && e.message)
    }
  }

  return notifyDepositSettled(db, {
    intentId,
    productId,
    productTitle: title,
    openid,
    orderId,
    orderNo: (event && event.orderNo) || ''
  })
}

async function listArtisanDeposits(event, actor) {
  const openid = (actor && actor.openid) || ''
  const framerId = String((event && event.framerId) || (actor && actor.framerId) || '').trim()
  const limit = Math.min(50, Math.max(1, parseInt(event && event.limit, 10) || 30))

  const productIds = []
  const seen = {}
  const pushId = (id) => {
    const v = String(id || '').trim()
    if (!v || seen[v]) return
    seen[v] = true
    productIds.push(v)
  }

  try {
    if (openid) {
      const byStaff = await db
        .collection('products')
        .where({ staffOpenid: openid })
        .field({ _id: true })
        .limit(100)
        .get()
      ;(byStaff.data || []).forEach((p) => pushId(p._id))
    }
  } catch (e) {
    console.warn('listArtisanDeposits staffOpenid', e && e.message)
  }
  try {
    if (framerId) {
      const byFramer = await db
        .collection('products')
        .where({ framerId })
        .field({ _id: true })
        .limit(100)
        .get()
      ;(byFramer.data || []).forEach((p) => pushId(p._id))
    }
  } catch (e) {
    console.warn('listArtisanDeposits framerId', e && e.message)
  }

  const isBroad =
    !productIds.length &&
    actor &&
    (actor.workspaceRole === WORKSPACE_SUPER_ADMIN ||
      (actor.roles || []).indexOf('super_admin') !== -1 ||
      (actor.roles || []).indexOf('store_manager') !== -1 ||
      (actor.roles || []).indexOf('manager') !== -1)

  const statusFilter = _.in([STATUS.DEPOSIT_PAID, STATUS.AWAITING_BALANCE])
  let intents = []
  if (productIds.length) {
    const chunk = 20
    for (let i = 0; i < productIds.length; i += chunk) {
      const slice = productIds.slice(i, i + chunk)
      try {
        const res = await db
          .collection(INTENT_COLLECTION)
          .where({ productId: _.in(slice), status: statusFilter })
          .limit(limit)
          .get()
        intents = intents.concat(res.data || [])
      } catch (e) {
        console.warn('listArtisanDeposits intents', e && e.message)
      }
    }
  } else if (isBroad) {
    try {
      const res = await db
        .collection(INTENT_COLLECTION)
        .where({ status: statusFilter })
        .limit(limit)
        .get()
      intents = res.data || []
    } catch (e) {
      console.warn('listArtisanDeposits broad', e && e.message)
    }
  }

  const list = intents
    .map(mapIntentRow)
    .filter(Boolean)
    .sort((a, b) => {
      const ta = a.createTime ? new Date(a.createTime).getTime() : 0
      const tb = b.createTime ? new Date(b.createTime).getTime() : 0
      return tb - ta
    })
    .slice(0, limit)

  const enriched = await attachOrderStatus(list)

  const counts = { deposit_paid: 0, awaiting_balance: 0 }
  enriched.forEach((row) => {
    if (row.status === STATUS.DEPOSIT_PAID) counts.deposit_paid += 1
    if (row.status === STATUS.AWAITING_BALANCE) counts.awaiting_balance += 1
  })

  return {
    success: true,
    list: enriched,
    counts,
    total: enriched.length,
    todoTotal: (counts.deposit_paid || 0) + (counts.awaiting_balance || 0)
  }
}

exports.main = async (event = {}) => {
  // 定时分支同时要求「非客户端来源」，避免 C 端伪造 Type/TriggerName 触发全站结算
  if (isTimerEvent(event) && isNonClientSource()) {
    return sweepBalanceDue(50)
  }

  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || wxContext.FROM_OPENID || ''
  const action = String(event.action || '').trim()

  if (action === 'sweepBalanceDue' || action === 'sweep') {
    if (event._internal === true && isNonClientSource()) return sweepBalanceDue(event.limit)
    const auth = await requireSuperAdmin(event, openid)
    if (!auth.ok) return auth.res
    return sweepBalanceDue(event.limit)
  }

  if (action === 'onProductShelved') {
    if ((event._internal === true || event.fromApproval === true) && isNonClientSource()) {
      return onProductShelved(event)
    }
    const auth = await requireManager(event, openid)
    if (!auth.ok) return auth.res
    return onProductShelved(event)
  }

  if (action === 'afterDepositPaid') {
    if (event._internal === true && isNonClientSource()) return afterDepositPaid(event)
    const auth = await requireManager(event, openid)
    if (!auth.ok) return auth.res
    return afterDepositPaid(event)
  }

  if (action === 'afterDepositSettled') {
    if (event._internal === true && isNonClientSource()) return afterDepositSettled(event)
    const auth = await requireManager(event, openid)
    if (!auth.ok) return auth.res
    return afterDepositSettled(event)
  }

  try {
    if (action === 'getRules') {
      const auth = await requireManager(event, openid)
      if (!auth.ok) return auth.res
      const result = await getRules()
      result.canEdit = !!(auth.actor && (
        auth.actor.workspaceRole === WORKSPACE_SUPER_ADMIN ||
        (auth.actor.roles || []).indexOf('super_admin') !== -1 ||
        auth.actor.isSuperAdmin
      ))
      const superCheck = await assertStaff(db, openid, {
        role: ROLE_MANAGER,
        requireSuperAdmin: true,
        adminOpsKey: event && event.adminOpsKey
      })
      result.canEdit = !!(superCheck && superCheck.ok)
      return result
    }

    if (action === 'saveRules') {
      const auth = await requireSuperAdmin(event, openid)
      if (!auth.ok) return auth.res
      return saveRules(event, auth.actor)
    }

    if (action === 'listIntents') {
      const auth = await requireManager(event, openid)
      if (!auth.ok) return auth.res
      return listIntents(event)
    }

    if (action === 'listArtisanDeposits') {
      const auth = await requireArtisanOrManager(event, openid)
      if (!auth.ok) return auth.res
      return listArtisanDeposits(event, auth.actor)
    }

    if (action === 'openExpired' || action === 'forfeitIntent') {
      const auth = await requireSuperAdmin(event, openid)
      if (!auth.ok) return auth.res
      return openExpired(event, auth.actor)
    }

    return fail(`未知 action: ${action || '(empty)'}`)
  } catch (e) {
    console.error('manageDeposit', action, e)
    return fail(e.message || '操作失败', e.code || 'FAIL')
  }
}
