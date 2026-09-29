/**
 * 店员 / 店长销售分成 — 门店经营额度口径
 *
 * 公式：实时销售分成 = (范围内本月营业额 − 商场月累计抽成) × 1%
 * 商场抽成（SSOT）：mallFee = max(0, R − threshold) × rate（默认阈值 17 万、扣点 15%）
 * 营业额 R = 线上净额 + 对应门店账本净额
 * - 线上净额：已付态订单 totalPrice（支付日，Asia/Shanghai）− 周期退款（退款日）
 * - 排除兑换单 source=exchange；含礼赠 / 定金 / 尾款（不重复计货值）
 * - 店员：staff_members.storeIds（一般一店）
 * - 店长：优先按绑定门店；未绑店回落山川造物（store_shanhaizaowu + 历史别名归一），不含星宸、不按多店合计
 * - 超管：已绑店按其门店；未绑店双店合计兜底
 * - 无 storeId 的快递单归入山川造物主店
 * - 与标本师提成（artisan commission）无关
 */
const { computeMonthlyMallFee, normalizeMallSettings } = require('./mallCommission')

const SALES_SHARE_RATE = 0.01
const RATE_LABEL = '1%'
const FINANCE_SETTINGS = 'finance_settings'

const PAID_STATUS = ['paid', 'paid_awaiting_address', 'shipped', 'received', 'ready_pickup']
const REFUND_STATUS = ['refunded', 'refunding', 'expired_refunding', 'aftersales']
const FINANCE_STORE_ID = 'store_shanhaizaowu'
const MAIN_STORE_ALIAS_IDS = [
  'store_1780146782017_6w0okpr',
  'store_1780160394767_szo1k77',
  'store_1780841157244_p48w0bx'
]
const REPORT_STORES = [
  { storeId: 'store_shanhaizaowu', name: '山川造物', aliases: MAIN_STORE_ALIAS_IDS },
  { storeId: 'store_xingchen', name: '星宸标本', aliases: [] }
]

const ORDER_SCAN_MAX = 4000
const MS_DAY = 24 * 60 * 60 * 1000
const TZ_SHANGHAI = 8 * 60 * 60 * 1000

const ORDER_FIELDS = {
  status: true,
  source: true,
  orderType: true,
  createTime: true,
  paidTime: true,
  refundTime: true,
  updateTime: true,
  totalPrice: true,
  payAmount: true,
  amount: true,
  refundAmount: true,
  storeId: true
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function fmtMoney(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0.00'
  return v.toFixed(2)
}

function normalizeDateStr(date) {
  if (!date) return ''
  const m = String(date).trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (!m) return String(date).trim()
  return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`
}

function toBizDate(value) {
  if (value == null || value === '') return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const shifted = new Date(d.getTime() + TZ_SHANGHAI)
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
}

function bizDateStartMs(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map((x) => parseInt(x, 10))
  if (!y || !m || !d) return 0
  return Date.UTC(y, m - 1, d, 0, 0, 0, 0) - TZ_SHANGHAI
}

function bizDateEndMs(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map((x) => parseInt(x, 10))
  if (!y || !m || !d) return 0
  return Date.UTC(y, m - 1, d, 23, 59, 59, 999) - TZ_SHANGHAI
}

function addBizDays(dateKey, delta) {
  const ms = bizDateStartMs(dateKey) + delta * MS_DAY + TZ_SHANGHAI
  const shifted = new Date(ms)
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
}

function dateKeysBetween(startDate, endDate) {
  const keys = []
  let cur = startDate
  let guard = 0
  while (cur && endDate && cur <= endDate && guard < 370) {
    keys.push(cur)
    cur = addBizDays(cur, 1)
    guard += 1
  }
  return keys
}

function toMs(v) {
  if (v == null) return 0
  if (typeof v === 'number') return v
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'object' && v.$date) return new Date(v.$date).getTime()
  const n = Date.parse(v)
  return Number.isFinite(n) ? n : 0
}

function parseOrderAmount(order) {
  if (!order) return 0
  const raw = order.totalPrice != null ? order.totalPrice : order.payAmount != null ? order.payAmount : order.amount
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  const n = parseFloat(String(raw || 0).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

function parseRefundAmount(order) {
  if (!order) return 0
  const raw = order.refundAmount != null ? order.refundAmount : order.refundFen
  if (raw != null && raw !== '') {
    if (typeof raw === 'number') {
      if (raw > 0 && Number.isInteger(raw) && raw >= 1000 && order.refundAmount == null) {
        return Math.round(raw) / 100
      }
      return Number.isFinite(raw) ? raw : 0
    }
    const n = parseFloat(String(raw).replace(/,/g, ''))
    if (Number.isFinite(n)) return n
  }
  return parseOrderAmount(order)
}

function isExchangeOrder(order) {
  return String((order && order.source) || '') === 'exchange'
}

function ledgerNet(doc) {
  const pos = Number(doc.pos) || 0
  const online = Number(doc.online) || 0
  const refund = Number(doc.refundAmount != null ? doc.refundAmount : doc.refund) || 0
  const hasBalance =
    doc.cashBalance != null &&
    doc.cashBalance !== '' &&
    Number.isFinite(Number(doc.cashBalance))
  const cashIncome = hasBalance
    ? Number(doc.cashIncome) || 0
    : Number(doc.cashIncome != null ? doc.cashIncome : doc.cash) || 0
  const netField = Number(doc.netAmount != null ? doc.netAmount : doc.revenue != null ? doc.revenue : doc.total) || 0
  if (pos || online || cashIncome || refund) {
    return Math.max(0, pos + online + cashIncome - refund)
  }
  return netField
}

function resolveYearMonth(raw) {
  const s = String(raw || '').trim()
  if (/^\d{4}-\d{2}$/.test(s)) return s
  const today = toBizDate(Date.now())
  return today.slice(0, 7)
}

function monthRange(yearMonth) {
  const [ys, ms] = yearMonth.split('-')
  const year = parseInt(ys, 10)
  const month = parseInt(ms, 10)
  const startDate = `${yearMonth}-01`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  let endDate = `${yearMonth}-${pad2(lastDay)}`
  const today = toBizDate(Date.now())
  if (startDate > today) {
    return {
      yearMonth,
      startDate: today,
      endDate: today,
      startTs: bizDateStartMs(today),
      endTs: bizDateEndMs(today),
      dateKeys: [today]
    }
  }
  if (endDate > today) endDate = today
  const dateKeys = dateKeysBetween(startDate, endDate)
  return {
    yearMonth,
    startDate,
    endDate,
    startTs: bizDateStartMs(startDate),
    endTs: bizDateEndMs(endDate),
    dateKeys
  }
}

function resolveLedgerGroupId(rawId) {
  const sid = String(rawId || '').trim()
  if (!sid || sid === 'default' || sid === 'main') return FINANCE_STORE_ID
  for (let i = 0; i < REPORT_STORES.length; i++) {
    const s = REPORT_STORES[i]
    if (s.storeId === sid || (s.aliases || []).indexOf(sid) !== -1) return s.storeId
  }
  if (MAIN_STORE_ALIAS_IDS.indexOf(sid) !== -1) return FINANCE_STORE_ID
  return null
}

function storeMetaById(storeId) {
  return (
    REPORT_STORES.find((s) => s.storeId === storeId) || {
      storeId,
      name: storeId,
      aliases: storeId === FINANCE_STORE_ID ? MAIN_STORE_ALIAS_IDS : []
    }
  )
}

function isSuperActor(actor) {
  return !!(
    actor &&
    (actor.superAdmin ||
      actor.workspaceRole === 'super_admin' ||
      (actor.roles || []).indexOf('super_admin') !== -1)
  )
}

function isManagerActor(actor) {
  if (!actor) return false
  if (isSuperActor(actor)) return true
  if (actor.workspaceRole === 'store_manager' || actor.role === 'manager') return true
  const roles = actor.roles || []
  return roles.indexOf('manager') !== -1 || roles.indexOf('store_manager') !== -1
}

/**
 * 解析 actor 的绑定门店（分成范围用）
 * - 直接取 actor.storeIds（兼容单数 storeId / primaryStoreId）
 * - 超管在 staffGuard 中 storeIds 被置空（权限面向全店），此处按其 staff 记录回查绑定门店：
 *   一般一个店员/店长只绑一个门店 → 分成范围即该门店名称；确未绑店才回落兜底口径。
 */
async function resolveActorBoundStoreIds(db, actor) {
  const direct = []
  const list = Array.isArray(actor && actor.storeIds) ? actor.storeIds : []
  list.forEach((id) => direct.push(id))
  const single = actor && (actor.storeId || actor.primaryStoreId)
  if (single) direct.push(single)
  if (direct.length) return direct

  const staffId = String((actor && actor.staffId) || '').trim()
  const openid = String((actor && actor.openid) || '').trim()
  if (!staffId && !openid) return []
  try {
    // 兼容两种返回形态：wx-server-sdk → { data: {...} }；部分 SDK → { data: [ {...} ] }
    const pickDoc = (data) => (Array.isArray(data) ? (data[0] || null) : (data || null))
    let rec = null
    if (staffId) {
      const res = await db.collection('staff_members').doc(staffId).get()
      rec = pickDoc(res && res.data)
    }
    if (!rec && openid) {
      const res = await db
        .collection('staff_members')
        .where({ openid, status: 'active' })
        .limit(1)
        .get()
      rec = (res.data && res.data[0]) || null
    }
    if (!rec) return []
    const out = Array.isArray(rec.storeIds) ? rec.storeIds.slice() : []
    const recSingle = String(rec.storeId || rec.primaryStoreId || '').trim()
    if (recSingle && out.indexOf(recSingle) === -1) out.push(recSingle)
    return out
  } catch (e) {
    console.warn('resolveActorBoundStoreIds', e && e.message)
    return []
  }
}

/**
 * 销售分成门店范围
 * - 优先按绑定门店（boundStoreIds）：一般一个店员只绑一个门店 → 分成范围 = 该门店名称
 *   · 店长绑定门店后按其门店；超管已绑店亦按其门店（不再默认双店）
 * - 店长（非超管）未绑店：回落山川造物门店经营额度（原口径）
 * - 超管未绑店：双店合计兜底
 * - 未绑店且非超管：明确报错
 */
function actorBoundStoreIds(actor, boundStoreIds) {
  const out = []
  const seen = {}
  // 注意：绑定解析里空值必须视为「未绑定」——resolveLedgerGroupId('') 会回落主店（订单归属口径），
  // 若在此沿用会把未绑店误判为绑了山川造物，导致店长/超管口径错位。
  const push = (raw) => {
    const rawText = String(raw == null ? '' : raw).trim()
    if (!rawText) return
    const group = resolveLedgerGroupId(rawText)
    if (group && !seen[group]) {
      seen[group] = true
      out.push(group)
    }
  }
  const source = Array.isArray(boundStoreIds) && boundStoreIds.length
    ? boundStoreIds
    : (Array.isArray(actor && actor.storeIds) ? actor.storeIds : [])
  source.forEach(push)
  push(actor && (actor.storeId || actor.primaryStoreId))
  return out
}

function resolveShareStoreScope(actor, boundStoreIds) {
  const storeIds = actorBoundStoreIds(actor, boundStoreIds)

  // 店长（非超管）未绑店：固定山川造物（不含星宸、不按多店合计）
  if (isManagerActor(actor) && !isSuperActor(actor) && !storeIds.length) {
    const meta = storeMetaById(FINANCE_STORE_ID)
    return {
      ok: true,
      mode: 'manager_main',
      storeIds: [FINANCE_STORE_ID],
      storeNames: [meta.name],
      storeLabel: meta.name,
      roleKind: 'manager'
    }
  }

  if (!storeIds.length) {
    if (isSuperActor(actor)) {
      const all = REPORT_STORES.map((s) => s.storeId)
      return {
        ok: true,
        mode: 'dual',
        storeIds: all,
        storeNames: REPORT_STORES.map((s) => s.name),
        storeLabel: REPORT_STORES.map((s) => s.name).join('、'),
        roleKind: 'super_admin'
      }
    }
    return {
      ok: false,
      mode: 'none',
      storeIds: [],
      storeNames: [],
      storeLabel: '',
      roleKind: 'staff',
      error: '未绑定所属门店，无法计算销售分成'
    }
  }

  const storeNames = storeIds.map((id) => storeMetaById(id).name)
  const roleKind = isSuperActor(actor)
    ? 'super_admin'
    : isManagerActor(actor)
      ? 'manager'
      : 'staff'
  return {
    ok: true,
    mode: storeIds.length === 1 ? 'single' : 'multi',
    storeIds,
    storeNames,
    storeLabel: storeNames.join('、'),
    roleKind
  }
}

function buildScopeNote(scope, yearMonth, mall) {
  const ym = yearMonth || '本月'
  const thr = mall && mall.mallThreshold != null ? Math.round(mall.mallThreshold) : 170000
  const ratePct = mall && mall.mallRatePct != null ? mall.mallRatePct : 15
  const baseCalc =
    `本月营业额 = 范围内线上净额（已付实付 − 周期退款，含礼赠/定金/尾款，不含兑换单）+ 对应门店账本净额；无 storeId 的快递单计入山川造物。商场抽成 = max(0, 营业额 − ¥${thr.toLocaleString()}) × ${ratePct}%；分成 = (营业额 − 商场抽成) × 1%。与标本师提成无关。`

  if (scope.mode === 'manager_main') {
    return `口径：店长 · 山川造物门店经营额度 · ${ym}（不含星宸、不按多店合计）。${baseCalc}`
  }
  if (scope.mode === 'dual') {
    return `口径：超管 · 双店合计 · ${ym}。${baseCalc}`
  }
  if (scope.mode === 'multi') {
    return `口径：所属门店合计（${scope.storeLabel}）· ${ym}。${baseCalc}`
  }
  return `口径：所属门店 · ${scope.storeLabel} · ${ym}。${baseCalc}`
}

async function loadMallSettings(db) {
  try {
    const res = await db.collection(FINANCE_SETTINGS).orderBy('_updateTime', 'desc').limit(1).get()
    const row = res.data && res.data[0]
    const raw = (row && (row.settings || row)) || null
    return normalizeMallSettings(raw)
  } catch (e) {
    return normalizeMallSettings(null)
  }
}

function orderMatchesShareStores(order, storeIds) {
  if (!storeIds || !storeIds.length) return true
  const allow = {}
  storeIds.forEach((id) => {
    allow[id] = true
  })
  const sid = String((order && order.storeId) || '').trim()
  if (!sid) {
    // 快递单常无 storeId：归入主店，与 getAnalyticsDashboard 一致
    return !!allow[FINANCE_STORE_ID]
  }
  const group = resolveLedgerGroupId(sid)
  return !!(group && allow[group])
}

function docUpdateMs(doc) {
  return toMs(doc && (doc._updateTime || doc.syncedAt || doc.updateTime || doc._id))
}

function dedupeLedgerDocs(docs) {
  const best = new Map()
  ;(docs || []).forEach((doc) => {
    const groupId = resolveLedgerGroupId(doc && doc.storeId)
    if (!groupId) return
    const dk = normalizeDateStr((doc && (doc.date || doc.bizDate)) || '')
    if (!dk) return
    const key = `${groupId}|${dk}`
    const prev = best.get(key)
    if (!prev || docUpdateMs(doc) >= docUpdateMs(prev.doc)) {
      best.set(key, { groupId, dk, doc })
    }
  })
  return Array.from(best.values())
}

async function pageOrders(db, _, where, orderByField, skip, limit) {
  try {
    const res = await db
      .collection('orders')
      .where(where)
      .field(ORDER_FIELDS)
      .orderBy(orderByField, 'desc')
      .skip(skip)
      .limit(limit)
      .get()
    return res.data || []
  } catch (e) {
    try {
      const res = await db
        .collection('orders')
        .where(where)
        .field(ORDER_FIELDS)
        .skip(skip)
        .limit(limit)
        .get()
      return res.data || []
    } catch (e2) {
      return []
    }
  }
}

async function fetchOrdersInRange(db, _, startTs, endTs) {
  const PAGE = 100
  const byId = new Map()
  let truncated = false

  const ingest = (rows) => {
    ;(rows || []).forEach((row) => {
      if (!row || !row._id) return
      if (!byId.has(row._id)) byId.set(row._id, row)
    })
    if (byId.size >= ORDER_SCAN_MAX) truncated = true
  }

  const padStart = new Date(startTs - MS_DAY)
  const padEnd = new Date(endTs + MS_DAY)
  let skip = 0
  while (byId.size < ORDER_SCAN_MAX) {
    const rows = await pageOrders(
      db,
      _,
      { createTime: _.gte(padStart).and(_.lte(padEnd)) },
      'createTime',
      skip,
      PAGE
    )
    if (!rows.length) break
    ingest(rows)
    skip += rows.length
    if (rows.length < PAGE) break
  }

  skip = 0
  while (byId.size < ORDER_SCAN_MAX) {
    const rows = await pageOrders(
      db,
      _,
      {
        status: _.in(PAID_STATUS.concat(REFUND_STATUS)),
        paidTime: _.gte(new Date(startTs)).and(_.lte(new Date(endTs)))
      },
      'paidTime',
      skip,
      PAGE
    )
    if (!rows.length) break
    ingest(rows)
    skip += rows.length
    if (rows.length < PAGE) break
  }

  skip = 0
  while (byId.size < ORDER_SCAN_MAX) {
    const rows = await pageOrders(
      db,
      _,
      {
        status: _.in(REFUND_STATUS),
        refundTime: _.gte(new Date(startTs)).and(_.lte(new Date(endTs)))
      },
      'refundTime',
      skip,
      PAGE
    )
    if (!rows.length) break
    ingest(rows)
    skip += rows.length
    if (rows.length < PAGE) break
  }

  return { rows: Array.from(byId.values()), truncated }
}

async function loadLedgerTotal(db, _, dateKeys, storeIds) {
  if (!dateKeys.length) return { offlineLedger: 0, byStore: [] }

  const targetStores = (storeIds || [])
    .map((id) => storeMetaById(id))
    .filter((s, idx, arr) => arr.findIndex((x) => x.storeId === s.storeId) === idx)
  if (!targetStores.length) return { offlineLedger: 0, byStore: [] }

  const dateStart = dateKeys[0]
  const dateEnd = dateKeys[dateKeys.length - 1]
  const dateKeySet = {}
  dateKeys.forEach((dk) => {
    dateKeySet[dk] = true
  })

  const allIds = []
  targetStores.forEach((s) => {
    allIds.push(s.storeId)
    ;(s.aliases || []).forEach((a) => allIds.push(a))
  })

  const PAGE = 100
  const all = []
  let skip = 0
  while (all.length < 800) {
    let rows = []
    try {
      const res = await db
        .collection('store_ledger')
        .where({
          storeId: _.in(allIds),
          date: _.gte(dateStart).and(_.lte(dateEnd))
        })
        .skip(skip)
        .limit(PAGE)
        .get()
      rows = res.data || []
    } catch (e) {
      try {
        const res = await db
          .collection('store_ledger')
          .where({ storeId: _.in(allIds) })
          .skip(skip)
          .limit(PAGE)
          .get()
        rows = (res.data || []).filter((doc) => {
          const dk = normalizeDateStr(doc.date || doc.bizDate)
          return dk && dateKeySet[dk]
        })
      } catch (e2) {
        break
      }
    }
    if (!rows.length) break
    rows.forEach((doc) => {
      const dk = normalizeDateStr(doc.date || doc.bizDate)
      if (dk && dateKeySet[dk]) all.push(doc)
    })
    skip += rows.length
    if (rows.length < PAGE) break
  }

  const allow = {}
  targetStores.forEach((s) => {
    allow[s.storeId] = true
  })
  const storeTotals = {}
  targetStores.forEach((s) => {
    storeTotals[s.storeId] = 0
  })
  const daily = {}
  dateKeys.forEach((dk) => {
    daily[dk] = 0
  })

  dedupeLedgerDocs(all).forEach(({ groupId, dk, doc }) => {
    if (!allow[groupId] || storeTotals[groupId] == null || daily[dk] == null) return
    const net = ledgerNet(doc)
    daily[dk] = round2((daily[dk] || 0) + net)
    storeTotals[groupId] = round2((storeTotals[groupId] || 0) + net)
  })

  const offlineLedger = round2(Object.keys(daily).reduce((s, k) => s + (daily[k] || 0), 0))
  const byStore = targetStores.map((s) => ({
    storeId: s.storeId,
    name: s.name,
    value: round2(storeTotals[s.storeId] || 0),
    valueFmt: fmtMoney(storeTotals[s.storeId] || 0)
  }))

  return { offlineLedger, byStore }
}

/**
 * @param {object} db cloud.database()
 * @param {object} _ db.command
 * @param {{ yearMonth?: string, actor?: object }} [opts]
 */
async function computeMonthlySalesShare(db, _, opts) {
  const yearMonth = resolveYearMonth(opts && opts.yearMonth)
  const actor = opts && opts.actor
  const boundStoreIds = await resolveActorBoundStoreIds(db, actor)
  const scope = resolveShareStoreScope(actor, boundStoreIds)
  if (!scope.ok) {
    return {
      yearMonth,
      error: scope.error || '未绑定所属门店，无法计算销售分成',
      rate: SALES_SHARE_RATE,
      rateLabel: RATE_LABEL,
      storeScopeLabel: '',
      scopeNote: scope.error || ''
    }
  }

  const range = monthRange(yearMonth)
  const dateKeySet = {}
  range.dateKeys.forEach((dk) => {
    dateKeySet[dk] = true
  })

  const [{ rows, truncated }, ledgerPack, mallSettings] = await Promise.all([
    fetchOrdersInRange(db, _, range.startTs, range.endTs),
    loadLedgerTotal(db, _, range.dateKeys, scope.storeIds),
    loadMallSettings(db)
  ])

  let gmvPaid = 0
  let refundAmount = 0

  ;(rows || []).forEach((o) => {
    if (isExchangeOrder(o)) return
    if (!orderMatchesShareStores(o, scope.storeIds)) return
    const st = String(o.status || '')
    const paidDk = toBizDate(o.paidTime || o.createTime)
    const refundDk = toBizDate(o.refundTime || o.updateTime || o.createTime)

    if (PAID_STATUS.indexOf(st) !== -1 && paidDk && dateKeySet[paidDk]) {
      gmvPaid += parseOrderAmount(o)
    }
    if (REFUND_STATUS.indexOf(st) !== -1 && refundDk && dateKeySet[refundDk]) {
      refundAmount += parseRefundAmount(o)
    }
  })

  const gmvRounded = round2(gmvPaid)
  const refundRounded = round2(refundAmount)
  const netOnline = round2(gmvRounded - refundRounded)
  const offlineLedger = round2((ledgerPack && ledgerPack.offlineLedger) || 0)
  const monthRevenue = round2(netOnline + offlineLedger)
  const mall = computeMonthlyMallFee(monthRevenue, mallSettings)
  const shareBase = mall.baseAfterMall
  const shareAmount = round2(Math.max(0, shareBase) * SALES_SHARE_RATE)
  const scopeNote = buildScopeNote(scope, yearMonth, mall)
  let storeScopeLabel = `所属门店 · ${scope.storeLabel}`
  if (scope.mode === 'manager_main') {
    storeScopeLabel = '山川造物 · 门店经营额度'
  } else if (scope.mode === 'dual') {
    storeScopeLabel = '双店合计'
  } else if (scope.mode === 'multi') {
    storeScopeLabel = `所属门店合计 · ${scope.storeLabel}`
  }

  const revenueScopeLabel =
    scope.mode === 'manager_main' ? '山川造物本月经营额度' : '所属门店本月营业额'

  return {
    yearMonth,
    startDate: range.startDate,
    endDate: range.endDate,
    rate: SALES_SHARE_RATE,
    rateLabel: RATE_LABEL,
    gmvPaid: gmvRounded,
    gmvPaidFmt: fmtMoney(gmvRounded),
    refundAmount: refundRounded,
    refundAmountFmt: fmtMoney(refundRounded),
    netOnline,
    netOnlineFmt: fmtMoney(netOnline),
    offlineLedger,
    offlineLedgerFmt: fmtMoney(offlineLedger),
    monthRevenue,
    monthRevenueFmt: fmtMoney(monthRevenue),
    mallThreshold: mall.mallThreshold,
    mallThresholdFmt: fmtMoney(mall.mallThreshold),
    mallRate: mall.mallRate,
    mallRatePct: mall.mallRatePct,
    mallExcess: mall.mallExcess,
    mallExcessFmt: fmtMoney(mall.mallExcess),
    mallFee: mall.mallFee,
    mallFeeFmt: fmtMoney(mall.mallFee),
    shareBase,
    shareBaseFmt: fmtMoney(shareBase),
    shareAmount,
    shareAmountFmt: fmtMoney(shareAmount),
    ledgerByStore: (ledgerPack && ledgerPack.byStore) || [],
    truncated: !!truncated,
    storeIds: scope.storeIds,
    storeNames: scope.storeNames,
    storeScopeLabel,
    scopeMode: scope.mode,
    roleKind: scope.roleKind,
    scopeNote,
    revenueScopeLabel,
    formulaNote:
      mall.mallFee > 0
        ? `销售分成 = (${revenueScopeLabel} ¥${fmtMoney(monthRevenue)} − 商场抽成 ¥${fmtMoney(mall.mallFee)}) × ${RATE_LABEL}`
        : `销售分成 = ${revenueScopeLabel} ¥${fmtMoney(monthRevenue)} × ${RATE_LABEL}（未超商场抽成阈值）`
  }
}

module.exports = {
  SALES_SHARE_RATE,
  computeMonthlySalesShare,
  resolveShareStoreScope
}
