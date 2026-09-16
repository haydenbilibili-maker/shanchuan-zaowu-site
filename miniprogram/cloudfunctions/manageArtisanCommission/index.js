/**
 * 标本师销售提成 — 超管多规则配置 / 账目明细 / 标本师本人汇总
 *
 * action:
 *   listRules | getRule | saveRule | deleteRule | toggleRule | resetDefaults
 *   listLedger | getSummary
 *   listArtisans | searchProducts（超管配置选商品 / 筛账目）
 *   postForOrder | reverseForOrder（履约/退款内部调用）
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_MANAGER, ROLE_STAFF } = require('./staffGuard')
const {
  COL_CONFIG,
  COL_LEDGER,
  normalizeRule,
  describeRule,
  getDefaultRule,
  loadRules,
  attachRuleDoc,
  validateRuleForSave,
  hasMatchDimensions,
  postCommissionForOrder,
  reverseCommissionForOrder,
  withCollectionRetry,
  round2,
  clampPriority
} = require('./commissionCore')
// 来源判定统一真源（负向子串/全等判定对互调合并串会判反，详见 sourceOrigin.js 顶部说明）
const { isNonClientSource, isInternalSource } = require('./sourceOrigin')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const INTERNAL_KEY =
  process.env.ARTISAN_COMMISSION_INTERNAL_KEY ||
  process.env.PAY_CALLBACK_INTERNAL_KEY ||
  process.env.STORED_VALUE_CALLBACK_KEY ||
  ''

const CRAFT_TYPE_OPTIONS = [
  { value: 'wing_art', label: '蝶翅画' },
  { value: 'frame', label: '相框' },
  { value: 'cloche', label: '方形玻璃罩' },
  { value: 'cloche_round', label: '圆形玻璃罩' },
  { value: 'cloche_cylinder', label: '圆柱形玻璃罩' },
  { value: 'diorama', label: '造景' },
  { value: 'other', label: '其它' }
]

const CRAFT_PROCESS_OPTIONS = [
  { value: 'immersion', label: '浸制' },
  { value: 'plastination', label: '塑化' },
  { value: 'taxidermy', label: '剥制' },
  { value: 'other', label: '其它' }
]

function fail(msg, code) {
  return { success: false, msg, code: code || 'FAIL' }
}

function ok(extra) {
  return { success: true, ...(extra || {}) }
}

function openidFrom(event) {
  try {
    const wxContext = cloud.getWXContext()
    return (wxContext && wxContext.OPENID) || (event && event.openid) || ''
  } catch (e) {
    return (event && event.openid) || ''
  }
}

function allowInternal(event) {
  // __fromFulfill 由调用方控制，必须叠加「非客户端来源」才可信
  if (event && event.__fromFulfill === true && isNonClientSource()) return true
  if (INTERNAL_KEY) {
    const key = String((event && (event.internalKey || event.callbackKey)) || '').trim()
    if (key && key === INTERNAL_KEY) return true
  }
  try {
    const wxContext = cloud.getWXContext()
    // 云函数互调时 SOURCE 可能是逗号合并串（如 "wx_client,scf"），全等比较会判反 →
    // 统一走 sourceOrigin 的分段判定（详见该模块顶部事故说明）。
    if (wxContext && !wxContext.OPENID && isInternalSource()) {
      return true
    }
  } catch (e) { /* ignore */ }
  return false
}

async function requireSuperAdmin(event, openid) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    permission: 'manageArtisanCommission',
    requireSuperAdmin: true,
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return { ok: false, res: fail(guard.msg, guard.code) }
  return { ok: true, actor: guard.actor || guard }
}

async function requirePayslipViewer(event, openid) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_STAFF,
    permission: 'viewPayslip',
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return { ok: false, res: fail(guard.msg, guard.code) }
  return { ok: true, actor: guard.actor || guard }
}

function metaPayload() {
  return {
    craftTypeOptions: CRAFT_TYPE_OPTIONS.concat(
      CRAFT_PROCESS_OPTIONS.filter((o) => o.value !== 'other')
    ),
    craftProcessOptions: CRAFT_PROCESS_OPTIONS,
    matchPriorityNote: '商品级 > 类目/装裱或工艺/标本师级 > 默认规则；同档按优先级数值大者优先；工艺规则可匹配 craftType 或 craftProcess'
  }
}

async function listRulesAction(event, openid) {
  const auth = await requireSuperAdmin(event, openid)
  if (!auth.ok) return auth.res
  const includeArchived = !!(event && event.includeArchived)
  const loaded = await loadRules(db, { includeArchived })
  const enabledCount = (loaded.rules || []).filter((r) => r.enabled && !r.archived).length
  return ok({
    list: loaded.rules || [],
    total: (loaded.rules || []).length,
    enabledCount,
    defaultRule: loaded.defaultRule || null,
    ...metaPayload()
  })
}

async function getRuleAction(event, openid) {
  const superAuth = await requireSuperAdmin(event, openid)
  if (!superAuth.ok) {
    const selfAuth = await requirePayslipViewer(event, openid)
    if (!selfAuth.ok) return selfAuth.res
  }

  const docId = String((event && (event.docId || event.ruleId)) || '').trim()
  if (docId) {
    try {
      const res = await db.collection(COL_CONFIG).doc(docId).get()
      if (!res.data) return fail('规则不存在', 'NOT_FOUND')
      const row = attachRuleDoc({ ...res.data, _id: docId })
      return ok({
        config: row,
        ruleText: row.ruleText,
        docId,
        fromDefault: false,
        ...metaPayload()
      })
    } catch (e) {
      return fail(e.message || '规则读取失败')
    }
  }

  // 兼容旧单规则客户端：返回默认规则摘要 + 列表入口提示
  const loaded = await loadRules(db)
  const focus = loaded.defaultRule || (loaded.rules && loaded.rules[0]) || null
  const rule = focus ? normalizeRule(focus) : normalizeRule(getDefaultRule())
  return ok({
    config: rule,
    ruleText: describeRule(rule),
    docId: (focus && (focus._id || focus.docId)) || '',
    fromDefault: !focus,
    rules: loaded.rules || [],
    multiRule: true,
    ...metaPayload()
  })
}

async function clearOtherDefaults(exceptId) {
  const loaded = await loadRules(db, { includeArchived: true })
  for (const r of loaded.rules || []) {
    const id = r._id || r.docId
    if (!id || id === exceptId) continue
    if (!r.isDefault) continue
    try {
      await db.collection(COL_CONFIG).doc(id).update({
        data: { isDefault: false, updateTime: Date.now() }
      })
    } catch (e) {
      console.warn('clearOtherDefaults', id, e && e.message)
    }
  }
}

async function saveRuleAction(event, openid) {
  const auth = await requireSuperAdmin(event, openid)
  if (!auth.ok) return auth.res

  const raw = (event && (event.config || event.rule)) || {}
  const checked = validateRuleForSave(raw)
  if (!checked.ok) return fail(checked.msg, 'INVALID_RULE')

  const normalized = checked.rule
  if (!hasMatchDimensions(normalized)) {
    return fail('请至少配置工艺、类目、商品或标本师之一', 'INVALID_SCOPE')
  }

  const actorId = openid || (auth.actor && auth.actor.openid) || 'admin'
  const now = Date.now()
  const payload = {
    ...normalized,
    ratePercent: round2(normalized.rate * 100),
    priority: clampPriority(raw.priority != null ? raw.priority : normalized.priority),
    updateTime: now,
    updatedBy: actorId
  }

  let docId = String((event && (event.docId || event.ruleId)) || '').trim()

  return withCollectionRetry(db, COL_CONFIG, async () => {
    // 兼容旧客户端：无 docId 且云端仅 0/1 条时覆盖单规则
    if (!docId && event && event.replaceSingle === true) {
      const loaded = await loadRules(db)
      const only = (loaded.rules || []).filter((r) => !r.isDefault)
      if (only.length === 1) docId = only[0]._id || only[0].docId
      else if ((loaded.rules || []).length === 1) {
        docId = loaded.rules[0]._id || loaded.rules[0].docId
      }
    }

    if (docId) {
      let existing = null
      try {
        const res = await db.collection(COL_CONFIG).doc(docId).get()
        existing = res.data
      } catch (e) {
        return fail('规则不存在', 'NOT_FOUND')
      }
      if (!existing) return fail('规则不存在', 'NOT_FOUND')

      // 不允许把默认规则改成无范围；isDefault 仅超管显式设置
      if (existing.isDefault && raw.isDefault === false) {
        // 取消默认前需已有其它默认，或保存时另有默认
        const loaded = await loadRules(db)
        const others = (loaded.rules || []).filter(
          (r) => (r._id || r.docId) !== docId && r.isDefault && !r.archived
        )
        if (!others.length && !payload.isDefault) {
          // 强制保留为本条默认
          payload.isDefault = true
        }
      }

      await db.collection(COL_CONFIG).doc(docId).update({ data: payload })
      if (payload.isDefault) await clearOtherDefaults(docId)
      const row = attachRuleDoc({ ...existing, ...payload, _id: docId })
      return ok({
        docId,
        config: row,
        ruleText: row.ruleText,
        msg: '提成规则已保存'
      })
    }

    const added = await db.collection(COL_CONFIG).add({
      data: {
        ...payload,
        createTime: now,
        createdBy: actorId
      }
    })
    if (payload.isDefault) await clearOtherDefaults(added._id)
    const row = attachRuleDoc({ ...payload, _id: added._id, createTime: now })
    return ok({
      docId: added._id,
      config: row,
      ruleText: row.ruleText,
      msg: '提成规则已创建'
    })
  })
}

async function toggleRuleAction(event, openid) {
  const auth = await requireSuperAdmin(event, openid)
  if (!auth.ok) return auth.res
  const docId = String((event && (event.docId || event.ruleId)) || '').trim()
  if (!docId) return fail('缺少规则 ID')

  let enabled = event && event.enabled
  return withCollectionRetry(db, COL_CONFIG, async () => {
    const res = await db.collection(COL_CONFIG).doc(docId).get()
    if (!res.data) return fail('规则不存在', 'NOT_FOUND')
    if (enabled === undefined || enabled === null) {
      enabled = !(res.data.enabled !== false)
    } else {
      enabled = !!enabled
    }
    await db.collection(COL_CONFIG).doc(docId).update({
      data: {
        enabled,
        updateTime: Date.now(),
        updatedBy: openid || 'admin'
      }
    })
    const row = attachRuleDoc({ ...res.data, _id: docId, enabled })
    return ok({
      docId,
      config: row,
      enabled,
      msg: enabled ? '规则已启用' : '规则已停用'
    })
  })
}

async function deleteRuleAction(event, openid) {
  const auth = await requireSuperAdmin(event, openid)
  if (!auth.ok) return auth.res
  const docId = String((event && (event.docId || event.ruleId)) || '').trim()
  if (!docId) return fail('缺少规则 ID')
  const hard = !!(event && event.hard)

  return withCollectionRetry(db, COL_CONFIG, async () => {
    const res = await db.collection(COL_CONFIG).doc(docId).get()
    if (!res.data) return fail('规则不存在', 'NOT_FOUND')
    if (res.data.isDefault === true) {
      return fail('默认规则不可删除，可停用或编辑范围与比例', 'FORBIDDEN_DEFAULT')
    }

    if (hard) {
      await db.collection(COL_CONFIG).doc(docId).remove()
      return ok({ docId, deleted: true, msg: '规则已删除' })
    }

    await db.collection(COL_CONFIG).doc(docId).update({
      data: {
        archived: true,
        enabled: false,
        updateTime: Date.now(),
        updatedBy: openid || 'admin',
        archivedAt: Date.now()
      }
    })
    return ok({ docId, archived: true, msg: '规则已归档' })
  })
}

async function resetDefaultsAction(event, openid) {
  const auth = await requireSuperAdmin(event, openid)
  if (!auth.ok) return auth.res

  const loaded = await loadRules(db)
  const def = loaded.defaultRule
  const seed = getDefaultRule()
  const docId = (def && (def._id || def.docId)) || String((event && event.docId) || '').trim()

  return saveRuleAction(
    {
      ...event,
      docId,
      config: {
        ...seed,
        isDefault: true,
        priority: 10
      }
    },
    openid
  )
}

function parseTimeBound(v, endOfDay) {
  if (v == null || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const s = String(v).trim()
  if (!s) return null
  if (/^\d+$/.test(s)) return Number(s)
  const d = new Date(s.length <= 10 && endOfDay ? `${s}T23:59:59.999` : s)
  const t = d.getTime()
  return Number.isFinite(t) ? t : null
}

async function resolveViewerScope(actor, event, isSuper) {
  if (isSuper) {
    return {
      artisanId: String((event && event.artisanId) || '').trim(),
      artisanOpenid: String((event && event.artisanOpenid) || '').trim(),
      mineOnly: false
    }
  }
  const openid = actor && actor.openid
  let artisanId = ''
  try {
    const fr = await db.collection('framers').where({ staffOpenid: openid }).limit(1).get()
    if (fr.data && fr.data[0]) artisanId = String(fr.data[0]._id)
  } catch (e) { /* ignore */ }
  return { artisanId, artisanOpenid: openid, mineOnly: true }
}

function emptySummary() {
  return {
    earnAmount: 0,
    reverseAmount: 0,
    netAmount: 0,
    earnCount: 0,
    reverseCount: 0,
    salesAmount: 0
  }
}

function summarizeRows(rows) {
  const s = emptySummary()
  ;(rows || []).forEach((r) => {
    const amt = Number(r.amount) || 0
    if (r.type === 'reverse') {
      s.reverseAmount = round2(s.reverseAmount + Math.abs(amt))
      s.reverseCount += 1
    } else {
      s.earnAmount = round2(s.earnAmount + Math.abs(amt))
      s.earnCount += 1
      s.salesAmount = round2(s.salesAmount + Math.max(0, Number(r.salesAmount) || 0))
    }
    s.netAmount = round2(s.netAmount + amt)
  })
  return s
}

function filterLedgerList(list, scope, type, fromTs, toTs) {
  return (list || []).filter((r) => {
    if (scope.mineOnly) {
      const hit =
        (scope.artisanOpenid && r.artisanOpenid === scope.artisanOpenid) ||
        (scope.artisanId && r.artisanId === scope.artisanId)
      if (!hit) return false
    } else {
      if (scope.artisanId && r.artisanId !== scope.artisanId) return false
      if (scope.artisanOpenid && r.artisanOpenid !== scope.artisanOpenid) return false
    }
    if (type === 'earn' || type === 'reverse') {
      if (r.type !== type) return false
    }
    const t = Number(r.createTime) || 0
    if (fromTs != null && t < fromTs) return false
    if (toTs != null && t > toTs) return false
    return true
  })
}

function formatTime(ts) {
  const n = Number(ts)
  if (!Number.isFinite(n) || n <= 0) return ''
  const d = new Date(n)
  const p = (x) => (x < 10 ? `0${x}` : `${x}`)
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function formatLedgerRow(r) {
  const amount = Number(r.amount) || 0
  const snap = r.ruleSnapshot || {}
  return {
    _id: r._id,
    type: r.type,
    typeLabel: r.type === 'reverse' ? '冲正' : '提成',
    status: r.status,
    orderId: r.orderId,
    orderNo: r.orderNo,
    productId: r.productId,
    productTitle: r.productTitle,
    artisanId: r.artisanId,
    artisanName: r.artisanName || '',
    artisanOpenid: r.artisanOpenid || '',
    salesAmount: Number(r.salesAmount) || 0,
    rate: Number(r.rate) || 0,
    ratePercent: round2((Number(r.rate) || 0) * 100),
    amount,
    amountAbs: Math.abs(amount),
    craftType: r.craftType || '',
    createTime: r.createTime,
    createTimeText: formatTime(r.createTime),
    reversed: !!r.reversed,
    ruleId: r.ruleId || '',
    ruleName: snap.name || ''
  }
}

async function fetchLedgerPool(limit) {
  return withCollectionRetry(db, COL_LEDGER, async () => {
    try {
      return await db.collection(COL_LEDGER).orderBy('createTime', 'desc').limit(limit).get()
    } catch (err) {
      return db.collection(COL_LEDGER).limit(limit).get()
    }
  })
}

async function listLedgerAction(event, openid) {
  const superAuth = await requireSuperAdmin(event, openid)
  let actor = null
  let isSuper = false
  if (superAuth.ok) {
    actor = superAuth.actor
    isSuper = true
  } else {
    const selfAuth = await requirePayslipViewer(event, openid)
    if (!selfAuth.ok) return selfAuth.res
    actor = selfAuth.actor
  }

  const scope = await resolveViewerScope(actor, event, isSuper)
  const page = Math.max(1, parseInt(event && event.page, 10) || 1)
  const pageSize = Math.min(50, Math.max(1, parseInt(event && event.pageSize, 10) || 20))
  const type = String((event && event.type) || '').trim()
  const fromTs = parseTimeBound(event && (event.from || event.startDate), false)
  const toTs = parseTimeBound(event && (event.to || event.endDate), true)

  const poolLimit = Math.min(1000, Math.max(page * pageSize * 3, 200))
  const all = await fetchLedgerPool(poolLimit)
  let list = filterLedgerList(all.data || [], scope, type, fromTs, toTs)
  list.sort((a, b) => (Number(b.createTime) || 0) - (Number(a.createTime) || 0))
  const total = list.length
  const pageList = list.slice((page - 1) * pageSize, page * pageSize)

  return ok({
    list: pageList.map(formatLedgerRow),
    total,
    page,
    pageSize,
    summary: summarizeRows(list),
    mineOnly: scope.mineOnly
  })
}

async function getSummaryAction(event, openid) {
  const superAuth = await requireSuperAdmin(event, openid)
  let actor
  let isSuper = false
  if (superAuth.ok) {
    actor = superAuth.actor
    isSuper = true
  } else {
    const selfAuth = await requirePayslipViewer(event, openid)
    if (!selfAuth.ok) return selfAuth.res
    actor = selfAuth.actor
  }
  const scope = await resolveViewerScope(actor, event, isSuper)
  const all = await fetchLedgerPool(500)
  const list = filterLedgerList(all.data || [], scope, '', null, null)
  const loaded = await loadRules(db)
  const def = loaded.defaultRule
  const enabledCount = (loaded.rules || []).filter((r) => r.enabled).length
  const ruleText = def
    ? `${describeRule(def)} · 共 ${enabledCount} 条启用规则`
    : enabledCount
      ? `共 ${enabledCount} 条启用规则`
      : '暂无启用规则'
  return ok({
    summary: summarizeRows(list),
    ruleText,
    ratePercent: def ? round2(def.rate * 100) : 10,
    enabled: enabledCount > 0,
    enabledCount,
    mineOnly: scope.mineOnly
  })
}

async function listArtisansAction(event, openid) {
  const auth = await requireSuperAdmin(event, openid)
  if (!auth.ok) return auth.res
  const kw = String((event && event.keyword) || '').trim().toLowerCase()
  const pageSize = Math.min(200, Math.max(1, parseInt(event && event.pageSize, 10) || 100))

  const mapRow = (f) => ({
    _id: f._id,
    name: String(f.name || f.displayName || '未命名标本师').trim() || '未命名标本师',
    type: f.type || '',
    staffOpenid: f.staffOpenid || ''
  })

  try {
    let rows = []
    try {
      const res = await db.collection('framers').orderBy('name', 'asc').limit(pageSize).get()
      rows = res.data || []
    } catch (e) {
      const res = await db.collection('framers').limit(pageSize).get()
      rows = res.data || []
    }
    let list = rows.map(mapRow)
    if (kw) {
      list = list.filter((f) => String(f.name || '').toLowerCase().indexOf(kw) !== -1)
    }
    list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'))
    return ok({ list })
  } catch (e) {
    console.error('listArtisans', e)
    return fail(e.message || '标本师列表加载失败')
  }
}

async function searchProductsAction(event, openid) {
  const auth = await requireSuperAdmin(event, openid)
  if (!auth.ok) return auth.res
  const kw = String((event && event.keyword) || '').trim()
  const pageSize = Math.min(30, Math.max(1, parseInt(event && event.pageSize, 10) || 20))
  const craft = String((event && event.craftType) || '').trim()

  const mapRow = (p) => ({
    _id: p._id,
    title: p.title,
    price: p.price,
    craftType: p.craftType || '',
    categoryId: p.categoryId || '',
    rootCategoryId: p.rootCategoryId || '',
    framerId: p.framerId || '',
    framerName: p.framerName || '',
    isOffShelf: !!p.isOffShelf
  })

  if (kw) {
    try {
      const res = await db
        .collection('products')
        .where({
          title: db.RegExp({
            regexp: kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            options: 'i'
          })
        })
        .limit(pageSize)
        .get()
      return ok({ list: (res.data || []).map(mapRow) })
    } catch (e) {
      const res = await db.collection('products').limit(80).get()
      const lower = kw.toLowerCase()
      const list = (res.data || [])
        .filter((p) => String(p.title || '').toLowerCase().indexOf(lower) !== -1)
        .slice(0, pageSize)
      return ok({ list: list.map(mapRow), degraded: true })
    }
  }

  if (craft) {
    const res = await db.collection('products').where({ craftType: craft }).limit(pageSize).get()
    return ok({ list: (res.data || []).map(mapRow) })
  }

  try {
    const res = await db.collection('products').orderBy('createTime', 'desc').limit(pageSize).get()
    return ok({ list: (res.data || []).map(mapRow) })
  } catch (e) {
    const res = await db.collection('products').limit(pageSize).get()
    return ok({ list: (res.data || []).map(mapRow), degraded: true })
  }
}

async function postForOrderAction(event) {
  if (!allowInternal(event)) {
    const openid = openidFrom(event)
    const auth = await requireSuperAdmin(event, openid)
    if (!auth.ok) return fail('仅内部履约或超管可入账', 'FORBIDDEN')
  }
  const orderId = String((event && event.orderId) || '').trim()
  if (!orderId) return fail('缺少 orderId')
  let order = event && event.order
  if (!order) {
    const res = await db.collection('orders').doc(orderId).get()
    order = res.data
  }
  if (!order) return fail('订单不存在')
  order._id = order._id || orderId
  return postCommissionForOrder(db, _, order, { source: (event && event.source) || 'api' })
}

async function reverseForOrderAction(event) {
  if (!allowInternal(event)) {
    const openid = openidFrom(event)
    const auth = await requireSuperAdmin(event, openid)
    if (!auth.ok) return fail('仅内部退款或超管可冲正', 'FORBIDDEN')
  }
  const orderId = String((event && event.orderId) || '').trim()
  if (!orderId) return fail('缺少 orderId')
  let order = event && event.order
  if (!order) {
    const res = await db.collection('orders').doc(orderId).get()
    order = res.data
  }
  if (!order) return fail('订单不存在')
  order._id = order._id || orderId
  return reverseCommissionForOrder(db, _, order, {
    source: (event && event.source) || 'api',
    refundFee: event && event.refundFee
  })
}

exports.main = async (event) => {
  const action = String((event && event.action) || 'listRules').trim()
  const openid = openidFrom(event)
  try {
    switch (action) {
      case 'list':
      case 'listRules':
        return await listRulesAction(event, openid)
      case 'get':
      case 'getRule':
        return await getRuleAction(event, openid)
      case 'save':
      case 'saveRule':
        return await saveRuleAction(event, openid)
      case 'toggle':
      case 'toggleRule':
        return await toggleRuleAction(event, openid)
      case 'delete':
      case 'deleteRule':
      case 'archiveRule':
        return await deleteRuleAction(event, openid)
      case 'resetDefaults':
        return await resetDefaultsAction(event, openid)
      case 'listLedger':
        return await listLedgerAction(event, openid)
      case 'getSummary':
        return await getSummaryAction(event, openid)
      case 'listArtisans':
        return await listArtisansAction(event, openid)
      case 'searchProducts':
        return await searchProductsAction(event, openid)
      case 'postForOrder':
        return await postForOrderAction(event)
      case 'reverseForOrder':
        return await reverseForOrderAction(event)
      default:
        return fail(`未知 action: ${action}`, 'UNKNOWN_ACTION')
    }
  } catch (err) {
    console.error('manageArtisanCommission error', action, err)
    return fail(err.message || '提成服务异常', 'EXCEPTION')
  }
}
