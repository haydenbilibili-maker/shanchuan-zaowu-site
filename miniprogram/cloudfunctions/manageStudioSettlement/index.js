/**
 * 工作室结算 — manageStudioSettlement
 * SSOT：admin/docs/出货算价与工作室结算_Phase1_技术蓝图.md（v1.2）
 *
 * 职责（P0）：
 *   · 价目表维护：原材料价（studio_material_prices）/ 包装价（studio_packaging_prices）
 *   · 全局结算配置：configs/studio_settlement（手工费率、开关、裸名是否报红）
 *   · 供「逐行可编辑页」搜索价目（searchPriceBook）
 * P0 后续：账单生命周期（bill.*）—— 与算价分开，故不写在这里
 *
 * action:
 *   meta | config.get | config.save
 *   priceBook.list | priceBook.get | priceBook.create | priceBook.update | priceBook.remove | priceBook.validate
 *   searchPriceBook
 *
 * 权限（蓝图 §8.1 + 裁决 9）：
 *   · **读**：超管 / 店长（店长录出货单时要能搜价目）
 *   · **写**：**仅超管**（价目表是定价权，裁决 7「只有超管能改价」的同一原则）；
 *     ERP 侧经 `/api/cloud-fn` 代理注入 adminOpsKey → 判为 super_admin
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_MANAGER, hasRole, STORED_ROLE_SUPER } = require('./staffGuard')
const {
  CONFIG_COLLECTION,
  CONFIG_ID,
  KIND,
  KIND_OPTIONS,
  DEFAULT_CONFIG,
  bookOf,
  collectionOf,
  buildRow,
  mapRow,
  toPatch,
  normalizeConfig,
  normalizeRatePct,
  validateBooks,
  bookMeta,
  parseBulkText,
  CATEGORY_OPTIONS,
  SKU_COLLECTION,
  skuKeyOf,
  autoSkuName,
  buildSkuRow,
  mergeSkuUpdate,
  mapSku
} = require('./settlementDefaults')
const { normalizeName, buildContext, quoteLines, PRICING_STATUS } = require('./pricingCore')
const {
  BILL_STATUS,
  BILL_STATUS_LABEL,
  BILL_FLOW,
  buildBill,
  mapBill,
  markPaidPatch,
  confirmSettlePatch,
  voidPatch,
  withdrawPaidPatch,
  shipmentBlockReason
} = require('./billCore')

const BILL_COLLECTION = 'ops_settlement_bills'
const SHIPMENT_COLLECTION = 'ops_shipments'
const {
  NOTIFY_EVENTS,
  resolveRecipients,
  notifyStaff,
  buildBillPaidMarkedNotice,
  buildBillSettledNotice,
  toDispatchVars
} = require('./settlementNotify')

/**
 * 主店 id 别名（与 `manageStoreShipment/shipmentDefaults.js` 的 `MAIN_IDS` 同源）。
 * 云函数不能跨目录 require，这里只登记这一对；对不上时的后果是**拒绝**而不是放行（见 actorCanAccessStore）。
 */
const STORE_ALIASES = {
  store_shanhaizaowu: ['store_1780146782017_6w0okpr'],
  store_1780146782017_6w0okpr: ['store_shanhaizaowu']
}

/**
 * 「门店标已付款」的门店范围判定 —— **失败即拒**（与既有 `storeIdsForActor` 的
 * 「storeIds 为空 = 全部门店」相反）。
 *
 * 为什么这里要反过来：那是**读/录单**，放开顶多多看几张单；
 * 这是**钱的动作**（标了之后超管会据此确认收款）。没配门店范围的非超管账号
 * 若被默认放开，就能替所有门店标已付款 —— 宁可错拒（超管随时可代标），不可错放。
 */
function actorCanAccessStore(actor, storeId, isSuper) {
  if (isSuper) return true
  const sid = String(storeId || '').trim()
  if (!sid) return false
  const ids = (Array.isArray(actor && actor.storeIds) ? actor.storeIds : []).map((x) => String(x || '').trim())
  if (!ids.length) return false
  const candidates = [sid].concat(STORE_ALIASES[sid] || [])
  return ids.some((id) => candidates.indexOf(id) !== -1)
}

function isSuperActor(actor) {
  return hasRole(actor, STORED_ROLE_SUPER)
}

/**
 * 通知（best-effort）：**任何失败都不影响业务动作**。
 * 录单/收款已经成功，不能因为消息发不出去就回滚或报错。
 * 返回值带 `storeManagerMissing`，便于排查「店长没收到」是没配门店范围还是投递失败。
 */
async function notifyQuietly(params) {
  try {
    const resolved = await resolveRecipients(db, params.want || {})
    const sent = await notifyStaff(cloud, {
      eventType: params.eventType,
      openids: resolved.openids,
      relatedId: params.relatedId,
      vars: toDispatchVars(params.notice)
    })
    return Object.assign({ targetCount: resolved.openids.length }, sent, {
      storeManagerMissing: !!resolved.storeManagerMissing
    })
  } catch (e) {
    console.error('[manageStudioSettlement] notify failed', params && params.eventType, e)
    return { sent: 0, failed: 1, errors: [String((e && e.message) || e)], targetCount: 0 }
  }
}

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const MAX_LIMIT = 200
const WRITE_PERMISSION = 'manageStudioSettlement'

function fail(msg, code) {
  return { success: false, msg, code: code || 'FAIL' }
}
function ok(data) {
  return Object.assign({ success: true }, data || {})
}
function errorText(err) {
  return [err && err.errCode, err && err.errMsg, err && err.message, String(err || '')]
    .filter(Boolean)
    .join(' ')
}
function isMissingCollectionError(err) {
  return /502005|DATABASE_COLLECTION_NOT_EXIST|COLLECTION_NOT_EXIST|collection not exist|集合不存在|not exist/i.test(
    errorText(err)
  )
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
/** 首次使用时集合可能还不存在（建集合前不该红），按仓库既有做法自动建 */
async function withCollectionRetry(name, fn) {
  try {
    return await fn()
  } catch (err) {
    if (!isMissingCollectionError(err)) throw err
    await ensureCollection(name)
    return await fn()
  }
}

async function requireReader(event, openid) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return { ok: false, res: fail(guard.msg, guard.code) }
  return { ok: true, actor: guard.actor }
}

/**
 * 写权限 = 仅超管。
 * permission 已登记进 staffGuard 的 SUPER_ADMIN_ONLY_PERMISSIONS，
 * 由授权层自己保证「非超管即便被误加了该 permission 也过不去」。
 */
async function requireWriter(event, openid) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    permission: WRITE_PERMISSION,
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return { ok: false, res: fail(guard.msg, guard.code) }
  return { ok: true, actor: guard.actor }
}

/** 小体量价目表：整表载入内存过滤/排序（几十~几百行），避免每加一个筛选就多一个索引 */
async function fetchAll(collection, where) {
  const rows = []
  let skip = 0
  while (skip < 2000) {
    const res = await withCollectionRetry(collection, () =>
      db.collection(collection).where(where).skip(skip).limit(100).get()
    )
    const list = (res && res.data) || []
    rows.push(...list)
    if (list.length < 100) break
    skip += list.length
  }
  return rows
}

/**
 * **只读**且容忍集合不存在（不自动建）。
 * 与 `fetchAll` 的区别：`fetchAll` 会在集合缺失时 `createCollection` ——
 * 那是**写**。拿它读「别人家的集合」（如原材料库存）会顺手建一个空集合，
 * 属于越界。所以参考价这类只读对照单独走这里。
 */
async function readMaybe(collection, where) {
  const rows = []
  try {
    let skip = 0
    while (skip < 2000) {
      const res = await db.collection(collection).where(where).skip(skip).limit(100).get()
      const list = (res && res.data) || []
      rows.push(...list)
      if (list.length < 100) break
      skip += list.length
    }
  } catch (err) {
    if (/not exist|集合不存在|502005/i.test(String((err && err.errMsg) || err.message || err))) return []
    throw err
  }
  return rows
}

/** 原材料库存集合（飞书「库存管理」同步；单价是**采购价**，不是出货结算价） */
const RAW_INVENTORY_COLLECTION = 'studio_raw_inventory'

/**
 * 采购价参照表：归一化名称 → 采购单价（元）。
 * ⚠️ **只用于对照显示**，绝不参与算价 —— 出货算价只认 `studio_material_prices`。
 * 产品负责人 2026-09-19 选择：两处独立维护，但价目表里显示参考采购价以便发现漂移。
 */
async function loadRefPurchasePrices() {
  const rows = await readMaybe(RAW_INVENTORY_COLLECTION, { deleted: _.neq(true) })
  const map = {}
  for (const r of rows) {
    const key = normalizeName(r.itemName || r.skuName || r.name || '')
    if (!key || map[key] !== undefined) continue
    const price = Number(r.unitPrice)
    if (Number.isFinite(price)) map[key] = price
  }
  return map
}

function activeWhere() {
  return { deleted: _.neq(true) }
}

function actorName(actor) {
  const a = actor || {}
  return a.name || a.nickName || a.staffName || a.openid || ''
}

async function loadConfigDoc() {
  try {
    const res = await db.collection(CONFIG_COLLECTION).doc(CONFIG_ID).get()
    return (res && res.data) || null
  } catch (err) {
    if (isMissingCollectionError(err)) return null
    // 文档不存在（configs 集合在但没这条）也走默认
    return null
  }
}

function sortRows(rows) {
  return rows.slice().sort((a, b) => {
    const sa = Number(a.sort) || 0
    const sb = Number(b.sort) || 0
    if (sa !== sb) return sa - sb
    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN')
  })
}

// ─────────────────────────── 读 ───────────────────────────

async function handleMeta() {
  const config = normalizeConfig(await loadConfigDoc())
  return ok({
    books: bookMeta(),
    config,
    defaultConfig: DEFAULT_CONFIG,
    // 分类取值表：**唯一事实源**在 settlementDefaults.CATEGORY_OPTIONS，
    // 前端下拉必须用它（原先 ERP 里手写了「标本/工具」两份 —— 那是漂移的种子）
    categoryOptions: CATEGORY_OPTIONS,
    writable: true,
    note: '价目表写权限仅超管；店长可读、可搜（录出货单时要选材料与包装）'
  })
}

async function handleConfigGet() {
  const config = normalizeConfig(await loadConfigDoc())
  return ok({ config, defaultConfig: DEFAULT_CONFIG })
}

async function handleList(event) {
  const book = bookOf(event.kind)
  if (!book) return fail(`未知价目本：${event.kind}`, 'BAD_KIND')
  const keyword = normalizeName(event.keyword || '')
  const status = String(event.status || '').trim()
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(event.limit, 10) || MAX_LIMIT))

  let rows = await fetchAll(book.collection, activeWhere())
  rows = rows.filter((r) => (status ? r.status === status : true))
  if (keyword) {
    rows = rows.filter((r) => {
      const keys = [r.normName || normalizeName(r.name)].concat(
        (Array.isArray(r.aliases) ? r.aliases : []).map((a) => normalizeName(a))
      )
      return keys.some((k) => k && k.indexOf(keyword) !== -1)
    })
  }
  rows = sortRows(rows)

  const all = rows.map((r) => mapRow(Object.assign({ kind: book.kind }, r)))
  // 材料表附上**参考采购价**（只读对照，来自原材料库存；不参与算价）
  if (book.kind === KIND.MATERIAL) {
    const ref = await loadRefPurchasePrices()
    for (const row of all) {
      const keys = [normalizeName(row.name)].concat((row.aliases || []).map((a) => normalizeName(a)))
      let hit = null
      for (const k of keys) {
        if (k && ref[k] !== undefined) {
          hit = ref[k]
          break
        }
      }
      row.refUnitPrice = hit
      row.refDelta = hit === null || hit === undefined ? null : Math.round((row.unitPrice - hit) * 100) / 100
    }
  }
  return ok({
    kind: book.kind,
    list: all.slice(0, limit),
    total: all.length,
    truncated: all.length > limit,
    refNote: book.kind === KIND.MATERIAL ? '参考采购价来自原材料库存（飞书「库存管理」同步），仅供对照，不参与算价' : ''
  })
}

async function handleGet(event) {
  const book = bookOf(event.kind)
  if (!book) return fail(`未知价目本：${event.kind}`, 'BAD_KIND')
  const id = String(event.id || '').trim()
  if (!id) return fail('缺少 id', 'BAD_PARAM')
  try {
    const res = await db.collection(book.collection).doc(id).get()
    const doc = res && res.data
    if (!doc || doc.deleted === true) return fail('条目不存在', 'NOT_FOUND')
    return ok({ item: mapRow(Object.assign({ kind: book.kind }, doc)) })
  } catch (err) {
    if (isMissingCollectionError(err)) return fail('条目不存在', 'NOT_FOUND')
    throw err
  }
}

/**
 * 价目搜索：供「逐行可编辑页」的材料/包装选择器。
 *
 * 按**归一化后的关键词**匹配正名与别名（所以 `大蓝闪` 能搜到 `大蓝闪蝶`），
 * 并**按材料分组成组**返回全部已配等级（尺寸）—— 前端选中材料后能直接给出二级下拉，
 * 不必再发一次请求（少一次往返 = 编辑页改一项更快）。
 */
async function handleSearchPriceBook(event) {
  const kind = String(event.kind || '').trim()
  const kinds = KIND_OPTIONS.includes(kind) ? [kind] : KIND_OPTIONS.slice()
  const keyword = normalizeName(event.keyword || '')
  /** 按分类过滤（空 = 不限）。SKU 新增时用它把长列表收窄 */
  const category = String(event.category || '').trim()
  const limit = Math.min(50, Math.max(1, parseInt(event.limit, 10) || 20))

  const groups = []
  for (const k of kinds) {
    const book = bookOf(k)
    const rows = await fetchAll(book.collection, activeWhere())
    const byName = {}
    for (const r of rows) {
      if (r.status !== 'active') continue
      if (category && String(r.category || '') !== category) continue
      const nk = r.normName || normalizeName(r.name)
      if (!nk) continue
      if (keyword) {
        const keys = [nk].concat((Array.isArray(r.aliases) ? r.aliases : []).map((a) => normalizeName(a)))
        if (!keys.some((key) => key && key.indexOf(keyword) !== -1)) continue
      }
      if (!byName[nk]) {
        byName[nk] = {
          kind: k,
          normName: nk,
          name: r.name || '',
          displayName: r.displayName || r.name || '',
          aliases: Array.isArray(r.aliases) ? r.aliases : [],
          optionField: book.optionField,
          optionLabel: book.optionLabel,
          // 分类随组带出：SKU 新增/查询按分类筛选时要用
          category: String(r.category || ''),
          options: []
        }
      }
      byName[nk].options.push({
        _id: r._id,
        option: r[book.optionField] || book.defaultOption,
        unitPrice: Number(r.unitPrice) || 0,
        qtyPerUnit: Number(r.qtyPerUnit) > 0 ? Number(r.qtyPerUnit) : 1,
        isDefault: r[book.defaultFlagKey] === true,
        unit: r.unit || ''
      })
    }
    for (const nk of Object.keys(byName)) {
      const g = byName[nk]
      g.options.sort((a, b) => (a.isDefault === b.isDefault ? 0 : a.isDefault ? -1 : 1))
      groups.push(g)
    }
  }

  groups.sort((a, b) => {
    const ka = normalizeName(a.name)
    const kb = normalizeName(b.name)
    if (ka === keyword && kb !== keyword) return -1
    if (kb === keyword && ka !== keyword) return 1
    return 0
  })

  return ok({
    keyword: event.keyword || '',
    list: groups.slice(0, limit),
    total: groups.length,
    truncated: groups.length > limit
  })
}

/**
 * 完整性校验：写入前后都能跑。
 * 复用共享内核的 `validatePriceBook`（与算价方同一套规则），所以「保存时能过」= 「算价时能匹配」。
 */
/**
 * 批量粘贴导入（产品负责人 2026-09-19 选定的首批录入方式）。
 *
 * **默认 dry-run**（与重算历史单同一安全默认）：先给「能认几行 / 哪行有问题 /
 * 哪些是新增、哪些是覆盖」的预览，只有显式 `dryRun:false` 才写库。
 *
 * 导入**不做阻断**：允许只导材料、暂不导包装（分两次录是正常的）。
 * 但会把「导入后的完整性预检」结果一并回传 —— 例如某材料没有默认行、
 * 别名与别的材料撞了 —— 让问题在导入当刻就看得见，而不是等算价时才发现。
 */
async function handleBulkUpsert(event, actor) {
  const book = bookOf(event.kind)
  if (!book) return fail(`未知价目本：${event.kind}`, 'BAD_KIND')
  const dryRun = event.dryRun !== false
  const parsed = parseBulkText(event.text, book.kind)

  const existing = await fetchAll(book.collection, activeWhere())
  const byKey = {}
  for (const r of existing) {
    byKey[(r.normName || normalizeName(r.name)) + '|' + (r[book.optionField] || book.defaultOption)] = r
  }

  const plan = parsed.rows.map((r, i) => {
    const hit = byKey[r.__key]
    return {
      line: r.__line,
      name: r.name,
      option: r[book.optionField] || book.defaultOption,
      isDefault: r[book.defaultFlagKey] === true,
      unitPrice: r.unitPrice,
      unit: r.unit || '',
      action: hit ? 'update' : 'create',
      _id: hit ? hit._id : '',
      _index: i
    }
  })

  // 导入后的完整性预检：把导入行按 key 覆盖进现状，再跑与手动录入完全同一套校验
  const merged = existing.slice()
  parsed.rows.forEach((r, i) => {
    const hit = byKey[r.__key]
    const row = Object.assign({}, r, { sort: hit ? hit.sort : existing.length + i })
    delete row.__key
    delete row.__line
    if (hit) {
      const at = merged.findIndex((m) => m._id === hit._id)
      if (at !== -1) merged[at] = Object.assign({}, hit, row)
      else merged.push(row)
    } else {
      merged.push(row)
    }
  })

  const otherKind = book.kind === KIND.MATERIAL ? KIND.PACKAGING : KIND.MATERIAL
  const otherRows = await fetchAll(collectionOf(otherKind), activeWhere())
  const check = validateBooks(
    book.kind === KIND.MATERIAL ? merged : otherRows,
    book.kind === KIND.PACKAGING ? merged : otherRows
  )

  const created = plan.filter((p) => p.action === 'create').length
  const updatedCount = plan.filter((p) => p.action === 'update').length

  if (dryRun) {
    return ok({
      dryRun: true,
      parsedRows: parsed.rows.length,
      created,
      updated: updatedCount,
      errors: parsed.errors,
      plan: plan.slice(0, 200),
      planTruncated: plan.length > 200,
      check,
      msg: `试算：可入库 ${parsed.rows.length} 行（新增 ${created} / 覆盖 ${updatedCount}）` +
        (parsed.errors.length ? `，${parsed.errors.length} 行有问题未计入` : '') +
        '；未写入'
    })
  }

  let okCount = 0
  let failCount = 0
  const writeErrors = []
  for (const r of parsed.rows) {
    const hit = byKey[r.__key]
    const row = Object.assign({}, r, {
      kind: book.kind,
      updatedAt: Date.now(),
      updatedBy: actorName(actor)
    })
    delete row.__key
    delete row.__line
    // 覆盖时**保留原有 sort**（不让一次导入把已有排序打乱）；新增才给新序号
    if (hit) row.sort = hit.sort
    else row.sort = existing.length + (row.sort || 0)
    try {
      if (hit) {
        await db.collection(book.collection).doc(hit._id).update({ data: row })
      } else {
        await db.collection(book.collection).add({
          data: Object.assign({}, row, {
            createdAt: Date.now(),
            createdBy: actorName(actor),
            deleted: false
          })
        })
      }
      okCount += 1
    } catch (err) {
      failCount += 1
      if (writeErrors.length < 10) writeErrors.push({ name: r.name, option: r[book.optionField], msg: String((err && err.message) || err) })
    }
  }
  return ok({
    dryRun: false,
    parsedRows: parsed.rows.length,
    created,
    updated: updatedCount,
    written: okCount,
    failed: failCount,
    errors: parsed.errors,
    writeErrors,
    check,
    msg: `已导入 ${okCount} 行（新增 ${created} / 覆盖 ${updatedCount}）` + (failCount ? `，失败 ${failCount}` : '')
  })
}

async function handleValidate() {
  const materials = await fetchAll(collectionOf(KIND.MATERIAL), activeWhere())
  const packagings = await fetchAll(collectionOf(KIND.PACKAGING), activeWhere())
  const res = validateBooks(materials, packagings)
  return ok({
    ok: res.ok,
    errors: res.errors,
    counts: { materials: materials.length, packagings: packagings.length },
    msg: res.ok
      ? `价目表完整：原材料 ${materials.length} 条 / 包装 ${packagings.length} 条`
      : `发现 ${res.errors.length} 个问题`
  })
}

// ─────────────────────────── 写（仅超管） ───────────────────────────

async function handleConfigSave(event, actor) {
  const incoming = event.config || {}
  const current = normalizeConfig(await loadConfigDoc())
  const next = {
    enabled: incoming.enabled === undefined ? current.enabled : incoming.enabled === true,
    laborRatePct: normalizeRatePct(incoming.laborRatePct, current.laborRatePct),
    requirePackaging:
      incoming.requirePackaging === undefined ? current.requirePackaging : incoming.requirePackaging !== false,
    rounding: DEFAULT_CONFIG.rounding,
    updatedAt: Date.now(),
    updatedBy: actorName(actor)
  }
  await withCollectionRetry(CONFIG_COLLECTION, () =>
    db.collection(CONFIG_COLLECTION).doc(CONFIG_ID).set({ data: next })
  )
  return ok({ config: next, msg: '结算配置已保存' })
}

async function handleCreate(event, actor) {
  const book = bookOf(event.kind)
  if (!book) return fail(`未知价目本：${event.kind}`, 'BAD_KIND')
  const built = buildRow(event.item || {}, book.kind)
  if (!built.ok) return fail(built.msg, 'BAD_PARAM')

  const row = Object.assign({}, built.row, {
    kind: book.kind,
    createdAt: Date.now(),
    createdBy: actorName(actor),
    updatedAt: Date.now(),
    updatedBy: actorName(actor)
  })
  // 写入前先防重：同一「名称 + 等级」只许一行（与 validatePriceBook 同口径）
  const existing = await fetchAll(book.collection, activeWhere())
  const dup = existing.find(
    (r) =>
      (r.normName || normalizeName(r.name)) === row.normName &&
      String(r[book.optionField] || book.defaultOption) === String(row[book.optionField])
  )
  if (dup) {
    return fail(
      `「${row.name}」+ ${book.optionLabel}=${row[book.optionField]} 已存在，请直接编辑那一条`,
      'DUPLICATE'
    )
  }
  if (row[book.defaultFlagKey] === true) {
    const prevDefault = existing.filter(
      (r) => (r.normName || normalizeName(r.name)) === row.normName && r[book.defaultFlagKey] === true
    )
    if (prevDefault.length) return fail(`「${row.name}」已经有默认行了，只能有一个`, 'DUPLICATE_DEFAULT')
  }

  const res = await withCollectionRetry(book.collection, () => db.collection(book.collection).add({ data: row }))
  return ok({ _id: (res && res._id) || '', item: mapRow(Object.assign({ kind: book.kind }, row)), msg: '已新增' })
}

async function handleUpdate(event, actor) {
  const book = bookOf(event.kind)
  if (!book) return fail(`未知价目本：${event.kind}`, 'BAD_KIND')
  const id = String(event.id || '').trim()
  if (!id) return fail('缺少 id', 'BAD_PARAM')

  const built = toPatch(event.item || {}, book.kind)
  if (!built.ok) return fail(built.msg, 'BAD_PARAM')
  const row = built.row

  const existing = await fetchAll(book.collection, activeWhere())
  const dup = existing.find(
    (r) =>
      r._id !== id &&
      (r.normName || normalizeName(r.name)) === row.normName &&
      String(r[book.optionField] || book.defaultOption) === String(row[book.optionField])
  )
  if (dup) {
    return fail(`「${row.name}」+ ${book.optionLabel}=${row[book.optionField]} 已存在，不能改成重复行`, 'DUPLICATE')
  }
  if (row[book.defaultFlagKey] === false) {
    // 不允许把唯一的默认行取消掉（否则「没写等级/尺寸」时取不到价）
    const others = existing.filter(
      (r) =>
        r._id !== id &&
        (r.normName || normalizeName(r.name)) === row.normName &&
        r[book.defaultFlagKey] === true
    )
    if (!others.length) {
      return fail(`「${row.name}」至少要有一个默认${book.optionLabel}行（文本没写时要用它取价）`, 'NO_DEFAULT')
    }
  }

  const patch = Object.assign({}, row, { updatedAt: Date.now(), updatedBy: actorName(actor) })
  await withCollectionRetry(book.collection, () => db.collection(book.collection).doc(id).update({ data: patch }))
  return ok({ _id: id, msg: '已保存' })
}

/**
 * 删除 = 软删（`deleted: true`），**不物理删**。
 * 理由：已出货单里存的是**定价快照**，但排查历史时仍要能回查这一行当时是什么；
 * 物理删会让「这行到底存不存在」变成不可考。停用请用 `status: inactive`。
 */
async function handleRemove(event, actor) {
  const book = bookOf(event.kind)
  if (!book) return fail(`未知价目本：${event.kind}`, 'BAD_KIND')
  const id = String(event.id || '').trim()
  if (!id) return fail('缺少 id', 'BAD_PARAM')

  const res = await db
    .collection(book.collection)
    .doc(id)
    .get()
    .catch(() => null)
  const doc = res && res.data
  if (!doc) return fail('条目不存在', 'NOT_FOUND')

  await withCollectionRetry(book.collection, () =>
    db
      .collection(book.collection)
      .doc(id)
      .update({ data: { deleted: true, deletedAt: Date.now(), updatedAt: Date.now(), updatedBy: actorName(actor) } })
  )
  return ok({ _id: id, msg: '已删除（历史出货单的定价快照不受影响）' })
}

// ─────────────────────── 出货 SKU 目录（材料×等级×包装×尺寸 + 默认费率） ───────────────────────

/**
 * 用**当前价目表**给一批 SKU 算出单价。
 * SKU 自己不存价（蓝图 §16.3）——价格永远由价目表 + 费率现算，这样改价目表立即对新单生效。
 * 走的是与出货单同一个共享内核（显式选择模式），所以"开单页显示的价"与"落库的价"不会漂移。
 */
async function quoteSkus(skus, config) {
  const materials = await fetchAll(collectionOf(KIND.MATERIAL), activeWhere())
  const packagings = await fetchAll(collectionOf(KIND.PACKAGING), activeWhere())
  const ctx = buildContext({
    materials,
    packagings,
    laborRatePct: config.laborRatePct,
    requirePackaging: config.requirePackaging
  })
  const quoted = quoteLines(
    skus.map((k) => ({
      itemName: k.skuName || autoSkuName(k),
      qty: 1,
      materialId: k.materialId,
      materialName: k.materialName,
      materialGrade: k.materialGrade,
      packagingId: k.packagingId,
      packagingName: k.packagingName,
      packagingSize: k.packagingSize,
      // SKU 的默认费率：null = 用全局（**0 是合法值，必须原样传**）
      laborRatePct: k.laborRatePct === null || k.laborRatePct === undefined ? undefined : k.laborRatePct
    })),
    ctx
  )
  return quoted.lines
}

async function handleSkuList(event) {
  const config = normalizeConfig(await loadConfigDoc())
  const keyword = normalizeName(event.keyword || '')
  const status = String(event.status || '').trim()
  /** 按**材料的分类**筛 SKU（SKU 自己不带分类，分类是材料的属性） */
  const category = String(event.category || '').trim()
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(event.limit, 10) || 200))

  let rows = await fetchAll(SKU_COLLECTION, activeWhere())
  rows = rows.filter((r) => (status ? r.status === status : true))

  /**
   * 材料名 → 分类。**每次列表都现读价目表**而不是把分类冗余进 SKU：
   * 分类是价目表那边维护的，改一次应该立刻在 SKU 列表的筛选上生效；
   * 冗余进 SKU 会出现"价目表改了、SKU 里还是旧分类"的静默不一致。
   */
  const matRows = await fetchAll(collectionOf(KIND.MATERIAL), activeWhere())
  const catOf = {}
  matRows.forEach((r) => {
    const nk = r.normName || normalizeName(r.name)
    if (nk && r.category) catOf[nk] = String(r.category)
  })
  if (category) {
    rows = rows.filter((r) => catOf[normalizeName(r.materialName || r.materialId || '')] === category)
  }
  if (keyword) {
    rows = rows.filter((r) => {
      const keys = [r.skuKey || skuKeyOf(r), normalizeName(r.skuName || '')]
      return keys.some((k) => k && k.indexOf(keyword) !== -1)
    })
  }
  rows.sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0))

  const sliced = rows.slice(0, limit)
  const lines = await quoteSkus(sliced, config)
  const list = sliced.map((r, i) => {
    const q = lines[i] || {}
    return Object.assign(mapSku(r), {
      // 材料分类（列表上按分类筛/显示用；取自价目表，不冗余存储）
      materialCategory: catOf[normalizeName(r.materialName || r.materialId || '')] || '',
      // 现算价（只回单价，不落库）：未核价时给 null 并带原因，**不编价**
      unitPrice: q.pricingStatus === PRICING_STATUS.PRICED ? q.unitPrice : null,
      pricingStatus: q.pricingStatus || 'unmatched',
      pricingNote: q.pricingNote || '',
      effectiveRatePct: q.laborRatePct === null || q.laborRatePct === undefined ? null : q.laborRatePct
    })
  })
  return ok({
    list,
    /** 分类下拉的选项来自**数据里实际存在的值**，不在前端写死 —— 加分类不必改前端 */
    categories: [...new Set(matRows.map((r) => String(r.category || '')).filter(Boolean))].sort(),
    total: rows.length,
    truncated: rows.length > limit,
    globalRatePct: config.laborRatePct,
    pricingEnabled: config.enabled,
    note: 'SKU 不存价：单价按当前价目表现算，出货时快照进单据'
  })
}

async function handleSkuGet(event) {
  const id = String(event.id || '').trim()
  if (!id) return fail('缺少 id', 'BAD_PARAM')
  let doc = null
  try {
    const res = await db.collection(SKU_COLLECTION).doc(id).get()
    doc = res && res.data
  } catch (err) {
    doc = null
  }
  if (!doc || doc.deleted === true) return fail('SKU 不存在', 'NOT_FOUND')
  const config = normalizeConfig(await loadConfigDoc())
  const q = (await quoteSkus([doc], config))[0] || {}
  return ok({
    item: Object.assign(mapSku(Object.assign({ _id: id }, doc)), {
      unitPrice: q.pricingStatus === PRICING_STATUS.PRICED ? q.unitPrice : null,
      pricingStatus: q.pricingStatus || 'unmatched',
      pricingNote: q.pricingNote || '',
      effectiveRatePct: q.laborRatePct === null || q.laborRatePct === undefined ? null : q.laborRatePct
    })
  })
}

/** 建/改 SKU 前的一致性检查：引用的材料与包装必须**真的在价目表里**（否则这 SKU 永远算不出价） */
async function checkSkuRefs(row) {
  const problems = []
  const materials = await fetchAll(collectionOf(KIND.MATERIAL), activeWhere())
  const packagings = await fetchAll(collectionOf(KIND.PACKAGING), activeWhere())
  const has = (rows, id, name) =>
    rows.some(
      (r) =>
        (id && String(r._id || '') === id) ||
        (name && (r.normName || normalizeName(r.name)) === normalizeName(name))
    )
  if (!has(materials, row.materialId, row.materialName)) {
    problems.push(`原材料「${row.materialName || row.materialId}」不在价目表里（或已停用）`)
  }
  if (!has(packagings, row.packagingId, row.packagingName)) {
    problems.push(`包装方式「${row.packagingName || row.packagingId}」不在价目表里（或已停用）`)
  }
  return problems
}

async function handleSkuCreate(event, actor) {
  const built = buildSkuRow(event.item || {})
  if (!built.ok) return fail(built.msg, 'BAD_PARAM')
  const row = built.row

  const problems = await checkSkuRefs(row)
  if (problems.length) return ok({ ok: false, problems, msg: problems.join('；') })

  const existing = await fetchAll(SKU_COLLECTION, activeWhere())
  const dup = existing.find((r) => (r.skuKey || skuKeyOf(r)) === row.skuKey)
  if (dup) {
    return ok({
      ok: false,
      duplicate: mapSku(dup),
      msg: `这个组合已经有一个 SKU 了：${dup.skuName || autoSkuName(dup)}（要改默认费率就编辑它，不要新建）`
    })
  }
  const now = Date.now()
  const res = await withCollectionRetry(SKU_COLLECTION, () =>
    db.collection(SKU_COLLECTION).add({
      data: Object.assign({}, row, {
        createdAt: now,
        createdBy: actorName(actor),
        updatedAt: now,
        updatedBy: actorName(actor)
      })
    })
  )
  return ok({ _id: (res && res._id) || '', item: mapSku(Object.assign({ _id: res && res._id }, row)), msg: 'SKU 已创建' })
}

async function handleSkuUpdate(event, actor) {
  const id = String(event.id || '').trim()
  if (!id) return fail('缺少 id', 'BAD_PARAM')
  /**
   * ⚠️ 必须**先读原行再合并**：`event.item` 是**部分更新**（ERP 列表上「停用」只传 `{status}`），
   * 而 `buildSkuRow` 要求材料/包装齐全 —— 不合并的话部分更新会被误判成非法请求。
   */
  const cur = await db.collection(SKU_COLLECTION).doc(id).get().catch(() => null)
  const existingDoc = cur && cur.data
  if (!existingDoc) return fail('SKU 不存在（可能已删除）', 'NOT_FOUND')

  const built = buildSkuRow(mergeSkuUpdate(existingDoc, event.item || {}))
  if (!built.ok) return fail(built.msg, 'BAD_PARAM')
  const row = built.row

  const problems = await checkSkuRefs(row)
  if (problems.length) return ok({ ok: false, problems, msg: problems.join('；') })

  const existing = await fetchAll(SKU_COLLECTION, activeWhere())
  const dup = existing.find((r) => r._id !== id && (r.skuKey || skuKeyOf(r)) === row.skuKey)
  if (dup) {
    return ok({
      ok: false,
      duplicate: mapSku(dup),
      msg: `改成这个组合会和已有 SKU 重复：${dup.skuName || autoSkuName(dup)}`
    })
  }
  await withCollectionRetry(SKU_COLLECTION, () =>
    db.collection(SKU_COLLECTION).doc(id).update({ data: Object.assign({}, row, { updatedAt: Date.now(), updatedBy: actorName(actor) }) })
  )
  return ok({ _id: id, msg: 'SKU 已保存' })
}

async function handleSkuRemove(event, actor) {
  const id = String(event.id || '').trim()
  if (!id) return fail('缺少 id', 'BAD_PARAM')
  await withCollectionRetry(SKU_COLLECTION, () =>
    db.collection(SKU_COLLECTION).doc(id).update({
      data: { deleted: true, deletedAt: Date.now(), updatedAt: Date.now(), updatedBy: actorName(actor) }
    })
  )
  return ok({ _id: id, msg: 'SKU 已删除（历史出货单的快照不受影响）' })
}

// ─────────────────────────── 账单（结算权威） ───────────────────────────

/** 批量改一批出货单（云开发支持 where(_id in [...]) 的服务端 update） */
async function patchShipments(ids, patch) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : []
  if (!list.length) return 0
  const res = await withCollectionRetry(SHIPMENT_COLLECTION, () =>
    db
      .collection(SHIPMENT_COLLECTION)
      .where({ _id: _.in(list) })
      .update({ data: patch })
  )
  return (res && res.stats && res.stats.updated) || 0
}

async function loadShipmentsByIds(ids) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : []
  if (!list.length) return []
  const out = []
  // `in` 一次最多 100 个，分批取
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100)
    const res = await withCollectionRetry(SHIPMENT_COLLECTION, () =>
      db.collection(SHIPMENT_COLLECTION).where({ _id: _.in(chunk) }).limit(100).get()
    )
    out.push(...((res && res.data) || []))
  }
  return out
}

async function loadBill(id) {
  const key = String(id || '').trim()
  if (!key) return null
  try {
    const res = await db.collection(BILL_COLLECTION).doc(key).get()
    const doc = res && res.data
    if (!doc || doc.deleted === true) return null
    return Object.assign({ _id: key }, doc)
  } catch (err) {
    return null
  }
}

async function nextBillSeq(dateStr) {
  const d = String(dateStr || '').replace(/[^0-9]/g, '').slice(0, 8)
  if (!d) return 1
  try {
    const res = await db.collection(BILL_COLLECTION).where({ billNo: db.RegExp({ regexp: `^SB${d}-` }) }).count()
    return ((res && res.total) || 0) + 1
  } catch (err) {
    return 1
  }
}

async function handleBillMeta() {
  return ok({
    statuses: Object.keys(BILL_STATUS_LABEL).map((v) => ({ value: v, label: BILL_STATUS_LABEL[v] })),
    flow: BILL_FLOW,
    collection: BILL_COLLECTION,
    note: '账单是结算唯一权威；出货单的结算状态由账单派生（未结 / 已付待确认 / 已结清）'
  })
}

/**
 * 可入账单据预览：列出该门店**未结且已核价**的出货单，并对不可入账的逐张给出原因。
 * 让超管在勾选列表里就置灰看到原因，而不是勾完才被拒（蓝图 §6.2）。
 */
async function handleBillPreview(event) {
  const storeId = String(event.storeId || '').trim()
  if (!storeId) return fail('请选择门店', 'BAD_PARAM')
  const rows = await fetchAll(SHIPMENT_COLLECTION, { storeId })
  const candidates = []
  for (const r of rows) {
    if (r.deleted === true) continue
    const reason = shipmentBlockReason(r, storeId)
    // 已结清 / 已入账的单不进候选列表（它们不在「待入账」语境里）
    if (reason && reason.code === 'ALREADY_IN_BILL') continue
    candidates.push({
      _id: r._id,
      shipmentNo: r.shipmentNo || '',
      shipmentDate: r.shipmentDate || '',
      storeId: r.storeId || '',
      storeName: r.storeName || '',
      itemCount: Number(r.itemCount) || 0,
      totalQty: Number(r.totalQty) || 0,
      totalCents: Number(r.totalCents) || 0,
      totalAmount: Math.round(Number(r.totalCents) || 0) / 100,
      pricingStatus: r.pricingStatus || 'priced',
      pricingIssueCount: Number(r.pricingIssueCount) || 0,
      selectable: !reason,
      blockReason: reason ? reason.msg : ''
    })
  }
  candidates.sort((a, b) => String(b.shipmentDate).localeCompare(String(a.shipmentDate)))
  const selectable = candidates.filter((c) => c.selectable)
  return ok({
    storeId,
    list: candidates,
    selectableCount: selectable.length,
    selectableTotalAmount: Math.round(selectable.reduce((n, c) => n + c.totalCents, 0)) / 100,
    blockedCount: candidates.length - selectable.length,
    msg: selectable.length
      ? `可入账 ${selectable.length} 张，合计 ¥${Math.round(selectable.reduce((n, c) => n + c.totalCents, 0)) / 100}`
      : '该门店没有可入账的出货单'
  })
}

async function handleBillCreate(event, actor) {
  const storeId = String(event.storeId || '').trim()
  const shipmentIds = Array.isArray(event.shipmentIds) ? event.shipmentIds.filter(Boolean) : []
  if (!shipmentIds.length) return fail('请至少勾选一张出货单', 'BAD_PARAM')

  const shipments = await loadShipmentsByIds(shipmentIds)
  if (shipments.length !== shipmentIds.length) {
    return fail(`有 ${shipmentIds.length - shipments.length} 张单据找不到，请刷新后重试`, 'NOT_FOUND')
  }
  const config = normalizeConfig(await loadConfigDoc())
  const built = buildBill({
    storeId,
    shipments,
    laborRatePct: config.laborRatePct,
    actor,
    now: Date.now(),
    seq: await nextBillSeq(shipments[0] && shipments[0].shipmentDate)
  })
  if (!built.ok) return ok({ ok: false, blocked: built.blocked || [], msg: built.msg })

  const res = await withCollectionRetry(BILL_COLLECTION, () =>
    db.collection(BILL_COLLECTION).add({ data: built.bill })
  )
  const billId = (res && res._id) || ''
  // 单据入账：结算状态仍为「未结」，但记上所属账单
  const updated = await patchShipments(shipmentIds, {
    settleStatus: BILL_STATUS.UNSETTLED,
    billId,
    billNo: built.bill.billNo,
    updatedAt: Date.now(),
    updatedBy: String(actor && actor.openid)
  })
  return ok({
    bill: mapBill(Object.assign({ _id: billId }, built.bill)),
    updatedShipments: updated,
    msg: `账单 ${built.bill.billNo} 已生成（${built.bill.shipmentCount} 张单 · ¥${built.bill.totalAmount}）`
  })
}

async function handleBillList(event) {
  const storeId = String(event.storeId || '').trim()
  const status = String(event.status || '').trim()
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(event.limit, 10) || 50))
  let rows = await fetchAll(BILL_COLLECTION, activeWhere())
  if (storeId) rows = rows.filter((r) => r.storeId === storeId)
  if (status) rows = rows.filter((r) => String(r.status || '') === status)
  rows.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
  const list = rows.slice(0, limit).map(mapBill)
  const outstandingCents = rows
    .filter((r) => String(r.status) !== BILL_STATUS.SETTLED && String(r.status) !== BILL_STATUS.VOID)
    .reduce((n, r) => n + (Number(r.totalCents) || 0), 0)
  return ok({
    list,
    total: rows.length,
    outstandingAmount: Math.round(outstandingCents) / 100,
    truncated: rows.length > limit
  })
}

async function handleBillGet(event) {
  const bill = await loadBill(event.id)
  if (!bill) return fail('账单不存在', 'NOT_FOUND')
  const shipments = await loadShipmentsByIds(bill.shipmentIds)
  return ok({
    bill: mapBill(bill),
    shipments: shipments.map((s) => ({
      _id: s._id,
      shipmentNo: s.shipmentNo || '',
      shipmentDate: s.shipmentDate || '',
      itemCount: Number(s.itemCount) || 0,
      totalQty: Number(s.totalQty) || 0,
      totalAmount: Math.round(Number(s.totalCents) || 0) / 100,
      status: s.status || '',
      settleStatus: s.settleStatus || 'unsettled'
    }))
  })
}

/** 门店标「已付款」。店长可标**自己门店**的账单；超管可代标任意门店。 */
async function handleBillMarkPaid(event, actor) {
  const bill = await loadBill(event.id)
  if (!bill) return fail('账单不存在', 'NOT_FOUND')
  if (!actorCanAccessStore(actor, bill.storeId, isSuperActor(actor))) {
    return fail('只能标记本门店账单的付款状态', 'FORBIDDEN')
  }
  const res = markPaidPatch(bill, actor, { now: Date.now(), note: event.note })
  if (!res.ok) return fail(res.msg, 'BAD_STATE')
  if (res.noop) return ok({ noop: true, bill: mapBill(bill), msg: res.msg })
  await withCollectionRetry(BILL_COLLECTION, () =>
    db.collection(BILL_COLLECTION).doc(bill._id).update({ data: res.patch })
  )
  const updated = await patchShipments(res.shipmentIds, res.shipmentPatch)
  const notify = await notifyQuietly({
    eventType: NOTIFY_EVENTS.BILL_PAID_MARKED,
    relatedId: bill._id,
    notice: buildBillPaidMarkedNotice(Object.assign({}, bill, res.patch)),
    want: { includeSuper: true, includeStoreManager: false }
  })
  return ok({
    bill: mapBill(Object.assign({}, bill, res.patch)),
    updatedShipments: updated,
    msg: res.msg,
    notify
  })
}

/** 撤回到未结：仅超管（店长标错了要找人改，不允许自己来回改钱的状态） */
async function handleBillWithdrawPaid(event, actor) {
  const bill = await loadBill(event.id)
  if (!bill) return fail('账单不存在', 'NOT_FOUND')
  const res = withdrawPaidPatch(bill, actor)
  if (!res.ok) return fail(res.msg, 'BAD_STATE')
  if (res.noop) return ok({ noop: true, bill: mapBill(bill), msg: res.msg })
  await withCollectionRetry(BILL_COLLECTION, () =>
    db.collection(BILL_COLLECTION).doc(bill._id).update({ data: res.patch })
  )
  const updated = await patchShipments(res.shipmentIds, res.shipmentPatch)
  return ok({ bill: mapBill(Object.assign({}, bill, res.patch)), updatedShipments: updated, msg: res.msg })
}

/**
 * 超管「确认收款」= 终结（裁决 13）：账单结清 + 其下每张单 `settleStatus=settled` 且 `status=completed`。
 * 幂等：重复点直接短路，不重复写、不重复通知（靠 `noop` 让调用方跳过通知）。
 */
async function handleBillConfirmSettle(event, actor) {
  const bill = await loadBill(event.id)
  if (!bill) return fail('账单不存在', 'NOT_FOUND')
  const res = confirmSettlePatch(bill, actor, { now: Date.now(), note: event.note })
  if (!res.ok) return fail(res.msg, 'BAD_STATE')
  if (res.noop) return ok({ noop: true, bill: mapBill(bill), msg: res.msg })
  await withCollectionRetry(BILL_COLLECTION, () =>
    db.collection(BILL_COLLECTION).doc(bill._id).update({ data: res.billPatch })
  )
  const updated = await patchShipments(res.shipmentIds, res.shipmentPatch)
  const notify = await notifyQuietly({
    eventType: NOTIFY_EVENTS.BILL_SETTLED,
    relatedId: bill._id,
    notice: buildBillSettledNotice(Object.assign({}, bill, res.billPatch)),
    want: { storeId: bill.storeId, includeSuper: false, includeStoreManager: true }
  })
  return ok({
    bill: mapBill(Object.assign({}, bill, res.billPatch)),
    updatedShipments: updated,
    msg: res.msg,
    notify
  })
}

async function handleBillVoid(event, actor) {
  const bill = await loadBill(event.id)
  if (!bill) return fail('账单不存在', 'NOT_FOUND')
  const res = voidPatch(bill, actor, { now: Date.now(), note: event.note })
  if (!res.ok) return fail(res.msg, 'BAD_STATE')
  if (res.noop) return ok({ noop: true, bill: mapBill(bill), msg: res.msg })
  await withCollectionRetry(BILL_COLLECTION, () =>
    db.collection(BILL_COLLECTION).doc(bill._id).update({ data: res.patch })
  )
  const updated = await patchShipments(res.shipmentIds, res.shipmentPatch)
  return ok({ bill: mapBill(Object.assign({}, bill, res.patch)), updatedShipments: updated, msg: res.msg })
}

// ─────────────────────────── 入口 ───────────────────────────

/**
 * 权限分三档（**唯一驱动判定的是 `SUPER_ONLY_ACTIONS`**，其余按读权限放行）：
 *   ① **仅超管**（`SUPER_ONLY_ACTIONS`）：价目表增删改、费率配置、建账单、撤回已付、
 *      **确认收款**、作废账单 —— 都是定价权或收款权（裁决 7 / 12）。
 *   ② **超管或店长**：所有读动作 + `bill.markPaid`（付款方是门店，由店长操作）。
 *      `bill.markPaid` 另在 handler 内按门店范围**二次判定且失败即拒**（见 actorCanAccessStore）。
 *   ③ 客户端无 openid 的 ERP 通道：经 `/api/cloud-fn` 代理注入 adminOpsKey → 判为 super_admin。
 */
const SUPER_ONLY_ACTIONS = {
  'config.save': 1,
  'priceBook.create': 1,
  'priceBook.update': 1,
  'priceBook.remove': 1,
  'priceBook.bulkUpsert': 1,
  'sku.create': 1,
  'sku.update': 1,
  'sku.remove': 1,
  'bill.create': 1,
  'bill.withdrawPaid': 1,
  'bill.confirmSettle': 1,
  'bill.void': 1
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const action = String((event && event.action) || '').trim()
  try {
    const isSuperAction = Object.prototype.hasOwnProperty.call(SUPER_ONLY_ACTIONS, action)
    const auth = isSuperAction
      ? await requireWriter(event, openid)
      : await requireReader(event, openid)
    if (!auth.ok) return auth.res

    switch (action) {
      case 'meta':
        return await handleMeta()
      case 'config.get':
        return await handleConfigGet()
      case 'config.save':
        return await handleConfigSave(event, auth.actor)
      case 'priceBook.list':
        return await handleList(event)
      case 'priceBook.get':
        return await handleGet(event)
      case 'priceBook.create':
        return await handleCreate(event, auth.actor)
      case 'priceBook.update':
        return await handleUpdate(event, auth.actor)
      case 'priceBook.remove':
        return await handleRemove(event, auth.actor)
      case 'priceBook.validate':
        return await handleValidate()
      case 'priceBook.bulkUpsert':
        return await handleBulkUpsert(event, auth.actor)
      case 'searchPriceBook':
        return await handleSearchPriceBook(event)

      case 'sku.list':
        return await handleSkuList(event)
      case 'sku.get':
        return await handleSkuGet(event)
      case 'sku.create':
        return await handleSkuCreate(event, auth.actor)
      case 'sku.update':
        return await handleSkuUpdate(event, auth.actor)
      case 'sku.remove':
        return await handleSkuRemove(event, auth.actor)

      case 'bill.meta':
        return await handleBillMeta()
      case 'bill.preview':
        return await handleBillPreview(event)
      case 'bill.create':
        return await handleBillCreate(event, auth.actor)
      case 'bill.list':
        return await handleBillList(event)
      case 'bill.get':
        return await handleBillGet(event)
      case 'bill.markPaid':
        return await handleBillMarkPaid(event, auth.actor)
      case 'bill.withdrawPaid':
        return await handleBillWithdrawPaid(event, auth.actor)
      case 'bill.confirmSettle':
        return await handleBillConfirmSettle(event, auth.actor)
      case 'bill.void':
        return await handleBillVoid(event, auth.actor)
      default:
        return fail('未知 action', 'BAD_ACTION')
    }
  } catch (err) {
    console.error('[manageStudioSettlement]', action, err)
    return fail(err && err.message ? err.message : '服务异常', 'INTERNAL')
  }
}
