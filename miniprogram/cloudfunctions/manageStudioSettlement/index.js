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
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')
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
  bookMeta
} = require('./settlementDefaults')
const { normalizeName } = require('./pricingCore')

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
  return ok({
    kind: book.kind,
    list: all.slice(0, limit),
    total: all.length,
    truncated: all.length > limit
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
  const limit = Math.min(50, Math.max(1, parseInt(event.limit, 10) || 20))

  const groups = []
  for (const k of kinds) {
    const book = bookOf(k)
    const rows = await fetchAll(book.collection, activeWhere())
    const byName = {}
    for (const r of rows) {
      if (r.status !== 'active') continue
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

// ─────────────────────────── 入口 ───────────────────────────

const WRITE_ACTIONS = {
  'config.save': handleConfigSave,
  'priceBook.create': handleCreate,
  'priceBook.update': handleUpdate,
  'priceBook.remove': handleRemove
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const action = String((event && event.action) || '').trim()
  try {
    const isWrite = Object.prototype.hasOwnProperty.call(WRITE_ACTIONS, action)
    const auth = isWrite ? await requireWriter(event, openid) : await requireReader(event, openid)
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
      case 'searchPriceBook':
        return await handleSearchPriceBook(event)
      default:
        return fail('未知 action', 'BAD_ACTION')
    }
  } catch (err) {
    console.error('[manageStudioSettlement]', action, err)
    return fail(err && err.message ? err.message : '服务异常', 'INTERNAL')
  }
}
