/**
 * 供应商管理中心（超管）+ 伙伴对账（采购商 / 供货方）
 * 蓝图：admin/docs/供应商管理中心_Phase2_技术蓝图_2026-09-28.md
 *
 * action（伙伴，需 openid；账号停用 → resolveActor 拿不到 actor → 一律拒绝）：
 *   myAccess        本人生效的功能项（Hub 据此隐藏入口）
 *   myStatement     本人单据的货款 / 账龄 / 运单（功能项 statement）
 * action（仅超管；ERP 可经 adminOpsKey）：
 *   adminDashboard        大盘（北京时间自然日范围 × 伙伴）
 *   adminListOrders       订单列表（只读）
 *   adminGetOrder         订单详情 + 时间线 + 物流（只读）
 *   adminListPartners     B2B 伙伴 + 功能项 + 订单概况
 *   adminSavePartnerAccess 功能项 / supplierId / 备注
 *   adminSetPartnerStatus  启停（仅纯 B2B 伙伴；含门店角色走花名册）
 *   adminSavePartnerProfile 伙伴资料图（门头 / 标志 + 资质照，只收 cloud://，只写带了的键）
 *   adminListPriceItems / adminSavePriceItem / adminSetPriceStatus / adminMovePriceItem / adminRemovePriceItem
 *
 * 边界：purchase_orders / fulfillment_shipments 在本函数内**只读**；支付字段只由 payB2bPurchase / b2bPayCallback 写。
 */
const cloud = require('wx-server-sdk')
const { resolveActor, pickHighestStoredRole } = require('./staffGuard')
const { writeAuditLog, auditFromActor } = require('./auditLog')
const core = require('./deskCore')
const { hasDeskFeature, effectiveFeatures } = require('./deskAccess')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const PO_COL = 'purchase_orders'
const SHIP_COL = 'fulfillment_shipments'
const PRICE_COL = 'price_list_items'
const STAFF_COL = 'staff_members'
const MAX_SCAN = 2000
const BATCH = 500
const ORDER_PAGE = 20
const PRICE_PAGE = 30

function fail(code, msg, extra) {
  return { success: false, code, msg, ...(extra || {}) }
}

function pickStr(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max || 200)
}

function now() {
  return Date.now()
}

/** 分批读满（上限 MAX_SCAN）；truncated 让调用方如实告知「只统计了前 N 条」 */
async function scan(col, where) {
  const out = []
  let truncated = false
  for (let skip = 0; skip < MAX_SCAN; skip += BATCH) {
    let q = db.collection(col)
    if (where) q = q.where(where)
    const res = await q.skip(skip).limit(BATCH).get()
    const rows = (res && res.data) || []
    out.push(...rows)
    if (rows.length < BATCH) return { rows: out, truncated }
  }
  truncated = true
  return { rows: out, truncated }
}

async function getDoc(col, id) {
  try {
    const res = await db.collection(col).doc(id).get()
    const d = res && res.data
    return Array.isArray(d) ? d[0] || null : d || null
  } catch (e) {
    return null
  }
}

async function requireSuperAdmin(openid, adminOpsKey) {
  const actor = await resolveActor(db, openid, { adminOpsKey })
  if (!actor || !actor.ok || !actor.superAdmin) {
    return { ok: false, res: fail('FORBIDDEN', '仅超管可操作供应商管理中心') }
  }
  return { ok: true, actor }
}

async function loadStaffRows() {
  try {
    return (await scan(STAFF_COL, null)).rows
  } catch (e) {
    console.warn('manageSupplierDesk staff scan', e && e.message)
    return []
  }
}

async function loadStaffRowByOpenid(openid) {
  if (!openid) return null
  try {
    const res = await db.collection(STAFF_COL).where({ openid }).limit(1).get()
    return (res && res.data && res.data[0]) || null
  } catch (e) {
    return null
  }
}

function supplierIdOfRow(row) {
  return pickStr((row && row.supplierId) || (row && row.openid), 80)
}

/** 伙伴键 → 显示名（与 deskCore.partnerKeyOf 同键） */
function namesFromStaff(rows) {
  const names = {}
  ;(rows || []).forEach((r) => {
    const roles = core.rolesOfRow(r)
    const sides = core.deskSidesOf(roles)
    const name = pickStr(r.name, 20) || `伙伴…${String(r.openid || '').slice(-4)}`
    if (sides.buyer || roles.indexOf('super_admin') !== -1 || roles.indexOf('manager') !== -1) names[`b:${r.openid}`] = name
    if (sides.supplier) names[`s:${supplierIdOfRow(r)}`] = name
  })
  return names
}

async function loadShipmentsByPo(ids) {
  const map = {}
  const list = (ids || []).filter(Boolean)
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100)
    try {
      const res = await db.collection(SHIP_COL).where({ purchaseOrderId: _.in(chunk) }).limit(1000).get()
      ;((res && res.data) || []).forEach((s) => {
        const k = s.purchaseOrderId
        ;(map[k] || (map[k] = [])).push(s)
      })
    } catch (e) {
      console.warn('manageSupplierDesk shipments', e && e.message)
    }
  }
  return map
}

// ———————————————————————— 大盘 / 订单（只读） ————————————————————————

async function handleDashboard(event) {
  const [po, staff] = await Promise.all([scan(PO_COL, null), loadStaffRows()])
  const names = namesFromStaff(staff)
  const dash = core.buildDashboard(po.rows, {
    range: pickStr(event.range, 10) || '30d',
    startDate: event.startDate,
    endDate: event.endDate,
    partner: pickStr(event.partner, 120),
    scope: event.scope === 'all' ? 'all' : 'desk',
    names
  }, now())
  const partners = staff.filter((r) => core.rolesOfRow(r).some((x) => core.B2B_ROLES.indexOf(x) !== -1))
  let priceActive = 0
  let priceInactive = 0
  try {
    const items = (await scan(PRICE_COL, null)).rows
    items.forEach((it) => { if (String(it.status) === 'active') priceActive += 1; else priceInactive += 1 })
  } catch (e) {
    console.warn('manageSupplierDesk price count', e && e.message)
  }
  return {
    success: true,
    dashboard: dash,
    partnerStats: {
      buyers: partners.filter((r) => core.deskSidesOf(core.rolesOfRow(r)).buyer).length,
      suppliers: partners.filter((r) => core.deskSidesOf(core.rolesOfRow(r)).supplier).length,
      disabled: partners.filter((r) => String(r.status || 'active') !== 'active').length
    },
    priceStats: { active: priceActive, inactive: priceInactive },
    partnerOptions: partnerOptions(names, po.rows),
    truncated: po.truncated,
    scanned: po.rows.length,
    generatedAt: now()
  }
}

function partnerOptions(names, orders) {
  const keys = {}
  Object.keys(names).forEach((k) => { keys[k] = names[k] })
  ;(orders || []).forEach((o) => {
    if (!core.isDeskOrder(o)) return
    const k = core.partnerKeyOf(o)
    if (!keys[k]) keys[k] = o.company || o.storeName || o.contactName || '未命名伙伴'
  })
  return Object.keys(keys).map((k) => ({ key: k, name: keys[k], kind: k.slice(0, 1) === 's' ? 'supplier' : 'buyer' }))
}

async function handleListOrders(event) {
  const [po, staff] = await Promise.all([scan(PO_COL, null), loadStaffRows()])
  const names = namesFromStaff(staff)
  const t = now()
  const filtered = core
    .filterOrders(po.rows, {
      scope: event.scope === 'all' ? 'all' : 'desk',
      direction: pickStr(event.direction, 10),
      partner: pickStr(event.partner, 120),
      stage: pickStr(event.stage, 20),
      pay: pickStr(event.pay, 20),
      keyword: pickStr(event.keyword, 40),
      range: pickStr(event.range, 10),
      startDate: event.startDate,
      endDate: event.endDate
    }, t)
    .sort((a, b) => (Number(b.submittedAt || b.createdAt) || 0) - (Number(a.submittedAt || a.createdAt) || 0))
  const page = Math.max(1, parseInt(event.page, 10) || 1)
  const slice = filtered.slice((page - 1) * ORDER_PAGE, page * ORDER_PAGE)
  const shipmentsByPo = await loadShipmentsByPo(slice.map((o) => o._id))
  return {
    success: true,
    list: slice.map((o) => core.orderRow(o, { names, shipmentsByPo }, t)),
    total: filtered.length,
    page,
    hasMore: page * ORDER_PAGE < filtered.length,
    partnerOptions: partnerOptions(names, po.rows),
    truncated: po.truncated
  }
}

function orderDetailView(po, shipments, names, t) {
  const row = core.orderRow(po, { names, shipmentsByPo: { [po._id]: shipments } }, t)
  const items = (Array.isArray(po.items) ? po.items : []).map((it) => {
    const qty = parseInt(it && it.quantity, 10) || 0
    const unit = Number(it && it.unitPrice)
    const unitFen = Number.isFinite(unit) && unit > 0 ? Math.round(unit * 100) : 0
    return {
      name: pickStr(it && it.name, 60) || '（未命名）',
      skuId: pickStr(it && it.skuId, 64),
      qty,
      unitText: unitFen ? core.yuanText(unitFen) : pickStr(it && it.priceLabel, 20) || '待报价',
      lineText: unitFen ? core.yuanText(unitFen * qty) : '—'
    }
  })
  const trades = Array.isArray(po.payTrades) ? po.payTrades : []
  const tradeNos = Array.isArray(po.payOutTradeNos) ? po.payOutTradeNos : trades.map((x) => x && x.outTradeNo).filter(Boolean)
  const refund = po.refund && typeof po.refund === 'object' ? po.refund : null
  return {
    order: row,
    items,
    contact: {
      company: pickStr(po.company, 80),
      storeName: pickStr(po.storeName, 80),
      contactName: pickStr(po.contactName, 40),
      contactPhone: pickStr(po.contactPhone, 30),
      shipToAddress: pickStr(po.shipToAddress, 200),
      note: pickStr(po.note, 300)
    },
    payment: {
      status: pickStr(po.paymentStatus, 30) || (core.isBuyerOrder(po) ? 'unpaid' : ''),
      channel: pickStr(po.paymentChannel, 30),
      pricingMode: pickStr(po.pricingMode, 30),
      payFenText: Number(po.payFen) > 0 ? core.yuanText(po.payFen) : '',
      paidFenText: Number(po.paidFen) > 0 ? core.yuanText(po.paidFen) : '',
      attempts: trades.length || (po.payOutTradeNo ? 1 : 0),
      outTradeTails: tradeNos.slice(-3).map((s) => String(s).slice(-8)),
      transactionTail: po.transactionId ? String(po.transactionId).slice(-6) : '',
      refundStatus: refund ? pickStr(refund.status, 20) : '',
      anomaly: po.payAnomaly ? pickStr(po.payAnomaly.code, 40) : ''
    },
    aging: core.agingOf(po, t),
    timeline: core.buildTimeline(po, shipments, t),
    logistics: core.logisticsOf(po, shipments).map((x) => ({ ...x, shipTimeText: core.fmtTime(x.shipTime) }))
  }
}

async function handleGetOrder(event) {
  const id = pickStr(event.id, 64)
  if (!id) return fail('MISSING_ID', '缺少订单 ID')
  const po = await getDoc(PO_COL, id)
  if (!po) return fail('NOT_FOUND', '订单不存在')
  const [shipMap, staff] = await Promise.all([loadShipmentsByPo([id]), loadStaffRows()])
  return { success: true, ...orderDetailView(po, shipMap[id] || [], namesFromStaff(staff), now()) }
}

// ———————————————————————— 伙伴与权限 ————————————————————————

async function handleListPartners(event) {
  const [staff, po] = await Promise.all([loadStaffRows(), scan(PO_COL, null)])
  const want = pickStr(event.status, 10)
  const t = now()
  const stat = {}
  po.rows.forEach((o) => {
    if (!core.isDeskOrder(o) || core.fulfilStageOf(o) === 'cancelled') return
    const k = core.partnerKeyOf(o)
    const s = stat[k] || (stat[k] = { count: 0, amountFen: 0, dueFen: 0, overdue: 0, lastAt: 0 })
    const fen = core.amountFenOf(o)
    s.count += 1
    s.amountFen += fen
    const b = core.payBucketOf(o)
    if (b === 'due' || b === 'offline' || b === 'review') s.dueFen += fen
    if (core.agingOf(o, t).overdue) s.overdue += 1
    s.lastAt = Math.max(s.lastAt, Number(o.submittedAt || o.createdAt) || 0)
  })
  const list = staff
    .filter((r) => core.rolesOfRow(r).some((x) => core.B2B_ROLES.indexOf(x) !== -1))
    .filter((r) => !want || String(r.status || 'active') === want)
    .map((r) => {
      const roles = core.rolesOfRow(r)
      const sides = core.deskSidesOf(roles)
      const keys = []
      if (sides.buyer) keys.push(`b:${r.openid}`)
      if (sides.supplier) keys.push(`s:${supplierIdOfRow(r)}`)
      const agg = keys.reduce((a, k) => {
        const s = stat[k]
        if (!s) return a
        a.count += s.count
        a.amountFen += s.amountFen
        a.dueFen += s.dueFen
        a.overdue += s.overdue
        a.lastAt = Math.max(a.lastAt, s.lastAt)
        return a
      }, { count: 0, amountFen: 0, dueFen: 0, overdue: 0, lastAt: 0 })
      return {
        staffId: r._id,
        openidTail: String(r.openid || '').slice(-6),
        name: pickStr(r.name, 20) || '（未填姓名）',
        roles,
        sides,
        b2bOnly: core.isB2bOnlyRoles(roles),
        status: String(r.status || 'active'),
        supplierId: pickStr(r.supplierId, 80),
        features: core.normalizeFeatures(r.b2bDesk && r.b2bDesk.features),
        featuresCustomized: !!(r.b2bDesk && r.b2bDesk.features),
        note: pickStr(r.b2bDesk && r.b2bDesk.note, 120),
        profile: {
          logo: core.isCloudFileId(r.b2bProfile && r.b2bProfile.logo) ? r.b2bProfile.logo : '',
          licenses: ((r.b2bProfile && r.b2bProfile.licenses) || []).filter(core.isCloudFileId).slice(0, core.PARTNER_LICENSE_MAX)
        },
        partnerKeys: keys,
        orders: { ...agg, amountText: core.yuanText(agg.amountFen), dueText: core.yuanText(agg.dueFen), lastText: core.bizDateKey(agg.lastAt) }
      }
    })
    .sort((a, b) => (a.status === b.status ? b.orders.lastAt - a.orders.lastAt : a.status === 'active' ? -1 : 1))
  return { success: true, list, catalog: core.DESK_FEATURES }
}

async function loadB2bRow(staffId) {
  const id = pickStr(staffId, 64)
  if (!id) return { ok: false, res: fail('MISSING_ID', '缺少伙伴 ID') }
  const row = await getDoc(STAFF_COL, id)
  if (!row) return { ok: false, res: fail('NOT_FOUND', '伙伴不存在') }
  const roles = core.rolesOfRow(row)
  if (!roles.some((x) => core.B2B_ROLES.indexOf(x) !== -1)) {
    return { ok: false, res: fail('NOT_B2B', '该账号不是采购商 / 供货方，请在店员花名册管理') }
  }
  return { ok: true, row, roles }
}

async function handleSavePartnerAccess(event, actor) {
  const got = await loadB2bRow(event.staffId)
  if (!got.ok) return got.res
  const { row, roles } = got
  const features = core.normalizeFeatures(event.features)
  const note = pickStr(event.note, 120)
  const data = {
    b2bDesk: _.set({ features, note, updatedAt: now(), updatedBy: actor.openid || 'admin_web' }),
    updateTime: db.serverDate()
  }
  if (core.deskSidesOf(roles).supplier && event.supplierId !== undefined) {
    const sid = pickStr(event.supplierId, 80)
    if (sid && !/^[A-Za-z0-9_-]{2,80}$/.test(sid)) return fail('BAD_SUPPLIER_ID', '供货方 ID 只能用字母、数字、- 或 _')
    if (sid) {
      const dup = await db.collection(STAFF_COL).where({ supplierId: sid }).limit(5).get()
      if (((dup && dup.data) || []).some((r) => r._id !== row._id)) return fail('DUP_SUPPLIER_ID', '该供货方 ID 已被其他伙伴使用')
    }
    data.supplierId = sid
  }
  await db.collection(STAFF_COL).doc(row._id).update({ data })
  await writeAuditLog(db, auditFromActor(actor, {
    action: 'b2b_partner_access',
    relatedId: row._id,
    relatedType: STAFF_COL,
    detail: { features, supplierId: data.supplierId, note },
    source: 'manageSupplierDesk'
  }))
  return { success: true, features, msg: '已保存' }
}

/** 伙伴资料图（门头 / 标志 + 资质照）：只写 b2bProfile 里入参显式带了的键；资质照只经超管动作读出 */
async function handleSavePartnerProfile(event, actor) {
  const got = await loadB2bRow(event.staffId)
  if (!got.ok) return got.res
  const v = core.validatePartnerProfile(event)
  if (!v.ok) return fail('INVALID', v.msg)
  const profile = { ...v.patch, updatedAt: now(), updatedBy: actor.openid || 'admin_web' }
  await db.collection(STAFF_COL).doc(got.row._id).update({ data: { b2bProfile: profile, updateTime: db.serverDate() } })
  await writeAuditLog(db, auditFromActor(actor, {
    action: 'b2b_partner_profile',
    relatedId: got.row._id,
    relatedType: STAFF_COL,
    detail: { keys: Object.keys(v.patch), licenses: (v.patch.licenses || []).length },
    source: 'manageSupplierDesk'
  }))
  return { success: true, profile: v.patch, msg: '图片已保存' }
}

async function handleSetPartnerStatus(event, actor) {
  const got = await loadB2bRow(event.staffId)
  if (!got.ok) return got.res
  const { row, roles } = got
  if (!core.isB2bOnlyRoles(roles)) {
    return fail('MIXED_ROLES', '该账号同时有门店角色，请在店员花名册启停，避免误停门店权限')
  }
  if (actor.openid && row.openid === actor.openid) return fail('SELF', '不能停用自己')
  const status = event.status === 'disabled' ? 'disabled' : 'active'
  await db.collection(STAFF_COL).doc(row._id).update({
    data: { status, updateTime: db.serverDate(), updatedBy: actor.openid || 'admin_web' }
  })
  // 与 manageStaff.remove / upsert 同语义：users.staffRole 跟随（停用清空）
  try {
    const res = await db.collection('users').where({ _openid: row.openid }).limit(1).get()
    const user = res && res.data && res.data[0]
    if (user) {
      await db.collection('users').doc(user._id).update({
        data: { staffRole: status === 'active' ? pickHighestStoredRole(roles) || '' : '', staffStoreIds: [] }
      })
    }
  } catch (e) {
    console.warn('manageSupplierDesk sync users.staffRole', e && e.message)
  }
  await writeAuditLog(db, auditFromActor(actor, {
    action: status === 'active' ? 'b2b_partner_enable' : 'b2b_partner_disable',
    relatedId: row._id,
    relatedType: STAFF_COL,
    detail: { targetOpenid: row.openid || '' },
    source: 'manageSupplierDesk'
  }))
  return { success: true, status, msg: status === 'active' ? '已启用' : '已停用（所有 B2B 接口即刻拒绝）' }
}

// ———————————————————————— 价目单 ————————————————————————

function sortedPrice(rows) {
  return rows.slice().sort((a, b) => {
    const sa = Number.isFinite(Number(a.sort)) ? Number(a.sort) : 1e9
    const sb = Number.isFinite(Number(b.sort)) ? Number(b.sort) : 1e9
    return sa - sb || String(a.skuId || '').localeCompare(String(b.skuId || ''))
  })
}

/** 引用计数：采购单 + 出货单明细里的 skuId（每单计 1） */
async function skuRefCounts() {
  const counts = {}
  for (const col of [PO_COL, SHIP_COL]) {
    let rows = []
    try {
      rows = (await scan(col, null)).rows
    } catch (e) {
      console.warn('manageSupplierDesk ref scan', col, e && e.message)
    }
    rows.forEach((doc) => {
      const seen = {}
      ;(Array.isArray(doc.items) ? doc.items : []).forEach((it) => {
        const k = pickStr(it && it.skuId, 64)
        if (!k || seen[k]) return
        seen[k] = true
        counts[k] = (counts[k] || 0) + 1
      })
    })
  }
  return counts
}

async function refCountOf(skuId) {
  if (!skuId) return 0
  let n = 0
  for (const col of [PO_COL, SHIP_COL]) {
    try {
      const res = await db.collection(col).where({ 'items.skuId': skuId }).count()
      n += Number(res && res.total) || 0
    } catch (e) {
      // 查不到引用时按「有引用」处理：宁可停用，不可误删
      console.warn('manageSupplierDesk refCount', col, e && e.message)
      return 1
    }
  }
  return n
}

function priceRow(r, refs) {
  return {
    _id: r._id,
    skuId: r.skuId || '',
    name: r.name || '',
    species: r.species || '',
    packaging: r.packaging || '',
    packagingFilter: r.packagingFilter || '',
    bioFilter: r.bioFilter || '',
    prepMethod: r.prepMethod || '',
    specs: r.specs || '',
    note: r.note || '',
    image: r.image || '',
    price: r.price == null ? null : r.price,
    guidePrice: r.guidePrice == null ? null : r.guidePrice,
    priceText: core.priceText(r.price),
    guideText: r.guidePrice == null ? '' : core.priceText(r.guidePrice),
    sort: Number.isFinite(Number(r.sort)) ? Number(r.sort) : null,
    status: r.status === 'active' ? 'active' : 'inactive',
    retired: !!r.retiredAt,
    refCount: (refs && refs[r.skuId]) || 0
  }
}

async function handleListPriceItems(event) {
  const [items, refs] = await Promise.all([scan(PRICE_COL, null), skuRefCounts()])
  const kw = pickStr(event.keyword, 40).toLowerCase()
  const status = pickStr(event.status, 10)
  const bio = pickStr(event.bio, 10)
  const all = sortedPrice(items.rows)
  const filtered = all.filter((r) => {
    if (status && (r.status === 'active' ? 'active' : 'inactive') !== status) return false
    if (bio && r.bioFilter !== bio) return false
    if (kw && `${r.name} ${r.skuId} ${r.species}`.toLowerCase().indexOf(kw) === -1) return false
    return true
  })
  const page = Math.max(1, parseInt(event.page, 10) || 1)
  return {
    success: true,
    list: filtered.slice((page - 1) * PRICE_PAGE, page * PRICE_PAGE).map((r) => priceRow(r, refs)),
    total: filtered.length,
    page,
    hasMore: page * PRICE_PAGE < filtered.length,
    counts: {
      all: all.length,
      active: all.filter((r) => r.status === 'active').length
    },
    options: { prep: core.PREP_METHODS, packaging: core.PACKAGING_FILTERS, bio: core.BIO_FILTERS },
    canMove: !kw && !status && !bio
  }
}

async function handleGetPriceItem(event) {
  const id = pickStr(event.id, 64)
  const options = { prep: core.PREP_METHODS, packaging: core.PACKAGING_FILTERS, bio: core.BIO_FILTERS }
  if (!id) return { success: true, item: null, options } // 新建页只取选项
  const r = await getDoc(PRICE_COL, id)
  if (!r) return fail('NOT_FOUND', '价目不存在')
  return { success: true, item: priceRow(r, { [r.skuId]: await refCountOf(r.skuId) }), options }
}

function priceWrite(data) {
  const out = { ...data }
  ;['price', 'guidePrice'].forEach((k) => {
    if (out[k] && typeof out[k] === 'object') out[k] = _.set(out[k])
  })
  return out
}

async function handleSavePriceItem(event, actor) {
  const v = core.validatePriceItem(event.data)
  if (!v.ok) return fail('INVALID', v.errors[0].msg, { errors: v.errors })
  const id = pickStr(event.id, 64)
  const data = v.data
  const dup = await db.collection(PRICE_COL).where({ skuId: data.skuId }).limit(5).get()
  if (((dup && dup.data) || []).some((r) => r._id !== id)) {
    return fail('DUP_SKU', `货号「${data.skuId}」已存在`, { errors: [{ field: 'skuId', msg: '货号已存在' }] })
  }
  const t = now()
  if (id) {
    const old = await getDoc(PRICE_COL, id)
    if (!old) return fail('NOT_FOUND', '价目不存在')
    if (old.skuId && old.skuId !== data.skuId && (await refCountOf(old.skuId)) > 0) {
      return fail('SKU_LOCKED', '该货号已被采购 / 出货单引用，不可修改（可新建一条再停用旧条目）', {
        errors: [{ field: 'skuId', msg: '已被单据引用，不可修改' }]
      })
    }
    if (data.status === 'active' && old.retiredAt) data.retiredAt = null
    if (data.image !== undefined && data.image !== (old.image || '')) data.images = core.nextImages(old.image || '', old.images, data.image)
    await db.collection(PRICE_COL).doc(id).update({ data: priceWrite({ ...data, updatedAt: t }) })
    await writeAuditLog(db, auditFromActor(actor, { action: 'price_item_update', relatedId: id, relatedType: PRICE_COL, detail: { skuId: data.skuId }, source: 'manageSupplierDesk' }))
    return { success: true, id, msg: '已保存' }
  }
  if (data.sort == null) {
    const all = (await scan(PRICE_COL, null)).rows
    data.sort = all.reduce((m, r) => Math.max(m, Number(r.sort) || 0), 0) + 1
  }
  const added = await db.collection(PRICE_COL).add({ data: { ...data, image: data.image || '', images: data.image ? [data.image] : [], createTime: t, updatedAt: t } })
  const newId = (added && (added._id || added.id)) || ''
  await writeAuditLog(db, auditFromActor(actor, { action: 'price_item_create', relatedId: newId, relatedType: PRICE_COL, detail: { skuId: data.skuId }, source: 'manageSupplierDesk' }))
  return { success: true, id: newId, msg: '已新建' }
}

async function handleSetPriceStatus(event, actor) {
  const id = pickStr(event.id, 64)
  const r = id ? await getDoc(PRICE_COL, id) : null
  if (!r) return fail('NOT_FOUND', '价目不存在')
  const status = event.status === 'active' ? 'active' : 'inactive'
  const data = { status, updatedAt: now() }
  if (status === 'active' && r.retiredAt) data.retiredAt = null
  await db.collection(PRICE_COL).doc(id).update({ data })
  await writeAuditLog(db, auditFromActor(actor, { action: `price_item_${status}`, relatedId: id, relatedType: PRICE_COL, detail: { skuId: r.skuId }, source: 'manageSupplierDesk' }))
  return { success: true, status, msg: status === 'active' ? '已上架' : '已下架' }
}

async function handleMovePriceItem(event, actor) {
  const id = pickStr(event.id, 64)
  const direction = event.direction === 'up' ? 'up' : 'down'
  const rows = sortedPrice((await scan(PRICE_COL, null)).rows)
  const plan = core.planMove(rows, id, direction)
  if (!plan.ok) return fail('NOT_FOUND', plan.msg)
  for (const w of plan.writes) {
    await db.collection(PRICE_COL).doc(w._id).update({ data: { sort: w.sort, updatedAt: now() } })
  }
  if (plan.writes.length) {
    await writeAuditLog(db, auditFromActor(actor, { action: 'price_item_move', relatedId: id, relatedType: PRICE_COL, detail: { direction, writes: plan.writes.length }, source: 'manageSupplierDesk' }))
  }
  return { success: true, moved: plan.writes.length > 0, msg: plan.msg || '已调整顺序' }
}

async function handleRemovePriceItem(event, actor) {
  const id = pickStr(event.id, 64)
  const r = id ? await getDoc(PRICE_COL, id) : null
  if (!r) return fail('NOT_FOUND', '价目不存在')
  const plan = core.removalPlan(await refCountOf(r.skuId))
  if (plan.mode === 'retire') {
    await db.collection(PRICE_COL).doc(id).update({ data: { status: 'inactive', retiredAt: now(), updatedAt: now() } })
    await writeAuditLog(db, auditFromActor(actor, { action: 'price_item_retire', relatedId: id, relatedType: PRICE_COL, detail: { skuId: r.skuId, refCount: plan.refCount }, source: 'manageSupplierDesk' }))
    return { success: true, removed: false, retired: true, refCount: plan.refCount, msg: `已被 ${plan.refCount} 张单据引用，已改为停用（保留历史可查）` }
  }
  await db.collection(PRICE_COL).doc(id).remove()
  await writeAuditLog(db, auditFromActor(actor, { action: 'price_item_remove', relatedId: id, relatedType: PRICE_COL, detail: { skuId: r.skuId }, source: 'manageSupplierDesk' }))
  return { success: true, removed: true, retired: false, msg: '已删除' }
}

// ———————————————————————— 伙伴端 ————————————————————————

async function handleMyAccess(openid) {
  const actor = await resolveActor(db, openid)
  if (!actor || !actor.ok) return fail('FORBIDDEN', (actor && actor.msg) || '账号未开通或已停用')
  if (actor.superAdmin) {
    return { success: true, deskKind: 'preview', features: effectiveFeatures(actor, null), catalog: core.DESK_FEATURES }
  }
  const row = await loadStaffRowByOpenid(openid)
  const sides = core.deskSidesOf(core.rolesOfRow(row))
  if (!sides.buyer && !sides.supplier) return fail('FORBIDDEN', '仅采购商 / 供货方可用')
  return {
    success: true,
    deskKind: sides.supplier && !sides.buyer ? 'supplier' : 'buyer',
    sides,
    features: effectiveFeatures(actor, row),
    catalog: core.DESK_FEATURES.filter((f) => f.side === 'both' || sides[f.side])
  }
}

async function ordersOfPartner(row) {
  const sides = core.deskSidesOf(core.rolesOfRow(row))
  const byId = {}
  const add = (list) => (list || []).forEach((o) => { byId[o._id] = o })
  if (sides.buyer) {
    add((await scan(PO_COL, { source: core.SOURCE_BUYER, _openid: row.openid })).rows)
    add((await scan(PO_COL, { source: core.SOURCE_BUYER, buyerOpenid: row.openid })).rows)
  }
  if (sides.supplier) {
    add((await scan(PO_COL, { party: core.PARTY_SUPPLIER, supplierId: supplierIdOfRow(row) })).rows)
  }
  return Object.keys(byId).map((k) => byId[k])
}

async function handleMyStatement(event, openid) {
  const actor = await resolveActor(db, openid)
  if (!actor || !actor.ok) return fail('FORBIDDEN', (actor && actor.msg) || '账号未开通或已停用')
  let row = null
  let preview = false
  if (actor.superAdmin) {
    const target = pickStr(event.partnerStaffId, 64)
    if (!target) return { success: true, preview: true, needPartner: true, list: [], msg: '超管请从「供应商管理 → 伙伴」选择一位伙伴预览其对账' }
    row = await getDoc(STAFF_COL, target)
    if (!row) return fail('NOT_FOUND', '伙伴不存在')
    preview = true
  } else {
    row = await loadStaffRowByOpenid(openid)
    const gate = hasDeskFeature(actor, row, 'statement')
    if (!gate.ok) return fail(gate.code, gate.msg)
  }
  const t = now()
  const orders = await ordersOfPartner(row)
  const range = pickStr(event.range, 10) || 'all'
  const names = namesFromStaff([row])
  const inScope = core.filterOrders(orders, { range, scope: 'desk' }, t)
    .sort((a, b) => (Number(b.submittedAt || b.createdAt) || 0) - (Number(a.submittedAt || a.createdAt) || 0))
    .slice(0, 50)
  const shipmentsByPo = await loadShipmentsByPo(inScope.map((o) => o._id))
  const list = inScope.map((o) => ({
    ...core.orderRow(o, { names, shipmentsByPo }, t),
    timeline: core.buildTimeline(o, shipmentsByPo[o._id] || [], t)
  }))
  return {
    success: true,
    preview,
    partnerName: pickStr(row.name, 20),
    sides: core.deskSidesOf(core.rolesOfRow(row)),
    summary: core.buildDashboard(orders, { range, scope: 'desk', names }, t),
    list
  }
}

// ———————————————————————— 入口 ————————————————————————

const ADMIN_ACTIONS = {
  adminDashboard: handleDashboard,
  adminListOrders: handleListOrders,
  adminGetOrder: handleGetOrder,
  adminListPartners: handleListPartners,
  adminSavePartnerAccess: handleSavePartnerAccess,
  adminSetPartnerStatus: handleSetPartnerStatus,
  adminSavePartnerProfile: handleSavePartnerProfile,
  adminListPriceItems: handleListPriceItems,
  adminGetPriceItem: handleGetPriceItem,
  adminSavePriceItem: handleSavePriceItem,
  adminSetPriceStatus: handleSetPriceStatus,
  adminMovePriceItem: handleMovePriceItem,
  adminRemovePriceItem: handleRemovePriceItem
}

exports.main = async (event) => {
  const ev = event || {}
  const wx = cloud.getWXContext() || {}
  const openid = wx.OPENID || ''
  const action = String(ev.action || '').trim()
  try {
    const admin = ADMIN_ACTIONS[action]
    if (admin) {
      const gate = await requireSuperAdmin(openid, ev.adminOpsKey)
      if (!gate.ok) return gate.res
      return await admin(ev, gate.actor)
    }
    if (!openid) return fail('UNAUTHORIZED', '请先登录')
    if (action === 'myAccess') return await handleMyAccess(openid)
    if (action === 'myStatement') return await handleMyStatement(ev, openid)
    return fail('UNKNOWN_ACTION', `未知 action: ${action}`)
  } catch (e) {
    console.error('manageSupplierDesk', action, e)
    return fail('INTERNAL', '服务开小差了，请稍后重试')
  }
}
