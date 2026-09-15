/**
 * 门店出货单 — SSOT: ops_shipments
 *
 * 职责（多端共用同一集合，禁止各写各的）：
 *   1. 小程序超管/店长：主录入（粘贴解析 + 表单）
 *   2. ERP：记账核对 / 报表 / 飞书同步编排（经本云函数读写）
 *   3. 飞书出货表：双向同步（upsertFromFeishu / bindFeishuRecord）
 *
 * action:
 *   meta | list | get | dashboard | parseText | searchSku | create | createFromParsed
 *   update | setStatus | remove
 *   upsertFromFeishu | syncStatus | syncLogs | bindFeishuRecord
 */
const cloud = require('wx-server-sdk')
const {
  assertStaff,
  ROLE_MANAGER,
  WORKSPACE_STORE_MANAGER,
  hasRole,
  STORED_ROLE_SUPER
} = require('./staffGuard')
const {
  COLLECTION,
  SYNC_META_COLLECTION,
  SYNC_META_ID,
  SYNC_LOG_COLLECTION,
  STORES,
  SOURCE,
  STATUS_LABEL,
  STATUS_FLOW,
  CATEGORY_OPTIONS,
  storeIdsForActor,
  normalizeStatus,
  canTransit,
  normalizePayload,
  mapRow,
  buildSummary,
  parseShipmentText,
  feishuItemToPayload,
  genBatchId,
  guessStoreId,
  roundMoney
} = require('./shipmentDefaults')
const { buildShipmentDashboard } = require('./shipmentDashboard')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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
  return /502005|DATABASE_COLLECTION_NOT_EXIST|COLLECTION_NOT_EXIST|collection not exist|集合不存在|not exist/i
    .test(errorText(err))
}

function isCollectionExistsError(err) {
  return /already exist|already exists|COLLECTION_EXIST|ResourceExist|-501001/i.test(errorText(err))
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name || COLLECTION)
  } catch (err) {
    if (isCollectionExistsError(err)) return
    throw err
  }
}

async function withCollectionRetry(fn, collectionName) {
  try {
    return await fn()
  } catch (err) {
    if (!isMissingCollectionError(err)) throw err
    await ensureCollection(collectionName || COLLECTION)
    return await fn()
  }
}

function isSuper(actor) {
  return !!(actor && (actor.superAdmin || hasRole(actor, STORED_ROLE_SUPER)))
}

function isStoreManager(actor) {
  return !!(
    actor &&
    (actor.workspaceRole === WORKSPACE_STORE_MANAGER || hasRole(actor, ROLE_MANAGER))
  )
}

function actorStoreFilter(actor) {
  if (isSuper(actor)) return null
  return storeIdsForActor(actor.storeIds || [])
}

function canAccessStore(actor, storeId) {
  const allowed = actorStoreFilter(actor)
  if (!allowed) return true
  return allowed.indexOf(String(storeId || '').trim()) !== -1
}

/** 读：超管或店长 */
async function requireReader(event, openid) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return { ok: false, res: fail(guard.msg, guard.code) }
  if (!isSuper(guard.actor) && !isStoreManager(guard.actor)) {
    return { ok: false, res: fail('仅超管或店长可查出货单', 'FORBIDDEN') }
  }
  return { ok: true, actor: guard.actor }
}

/**
 * 写（主录入）：超管或店长
 * 飞书同步类写操作仍走 requireSuperAdmin
 */
async function requireWriter(event, openid) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return { ok: false, res: fail(guard.msg, guard.code) }
  if (!isSuper(guard.actor) && !isStoreManager(guard.actor)) {
    return { ok: false, res: fail('仅超管或店长可录入出货单', 'FORBIDDEN') }
  }
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

async function handleMeta(actor) {
  const allowed = actorStoreFilter(actor)
  let stores = STORES.slice()
  if (allowed) stores = STORES.filter((s) => allowed.indexOf(s.id) !== -1)
  return ok({
    stores,
    statuses: Object.keys(STATUS_LABEL).map((value) => ({
      value,
      label: STATUS_LABEL[value],
      next: STATUS_FLOW[value] || []
    })),
    sources: [
      { value: SOURCE.FEISHU, label: '飞书' },
      { value: SOURCE.ERP, label: 'ERP' },
      { value: SOURCE.MANUAL, label: '手工录入' }
    ],
    categories: CATEGORY_OPTIONS.map((value) => ({ value, label: value })),
    canWrite: isSuper(actor) || isStoreManager(actor),
    readOnly: !(isSuper(actor) || isStoreManager(actor)),
    isSuper: isSuper(actor),
    ssot: COLLECTION,
    dataFlowNote:
      'SSOT=ops_shipments。小程序为主录入；ERP 记账核对；飞书出货表经同步中心与本集合双向同步。'
  })
}

async function handleList(event, actor) {
  const storeId = String(event.storeId || event.entityId || '').trim()
  const status = String(event.status || '').trim()
  const source = String(event.source || '').trim()
  const keyword = String(event.keyword || '').trim()
  const dateFrom = String(event.dateFrom || '').trim()
  const dateTo = String(event.dateTo || '').trim()
  const limit = Math.min(Math.max(Number(event.limit) || 50, 1), 100)

  const where = { deleted: _.neq(true) }
  if (storeId) where.storeId = storeId
  if (status && status !== 'all') where.status = normalizeStatus(status)
  if (source && source !== 'all') where.source = source

  const allowed = actorStoreFilter(actor)
  if (allowed) {
    if (storeId && allowed.indexOf(storeId) === -1) {
      return ok({
        list: [],
        total: 0,
        summary: buildSummary([]),
        stores: STORES.filter((s) => allowed.indexOf(s.id) !== -1),
        canWrite: true
      })
    }
    if (!storeId) where.storeId = _.in(allowed)
  }

  const res = await withCollectionRetry(() =>
    db.collection(COLLECTION).where(where).limit(limit).get()
  )
  let list = (res.data || []).map(mapRow).filter(Boolean)
  list.sort((a, b) => {
    const d = String(b.shipmentDate || '').localeCompare(String(a.shipmentDate || ''))
    if (d !== 0) return d
    return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)
  })

  if (dateFrom || dateTo) {
    list = list.filter((row) => {
      const d = String(row.shipmentDate || '')
      if (!d) return false
      if (dateFrom && d < dateFrom) return false
      if (dateTo && d > dateTo) return false
      return true
    })
  }

  if (keyword) {
    const kw = keyword.toLowerCase()
    list = list.filter((row) => {
      const itemHay = (row.items || []).map((it) => it.itemName).join(' ')
      const hay = `${row.shipmentNo} ${row.storeName} ${row.customerName} ${row.buyerName} ${itemHay} ${row.note} ${row.sourceLabel}`.toLowerCase()
      return hay.indexOf(kw) !== -1
    })
  }

  const stores = allowed
    ? STORES.filter((s) => allowed.indexOf(s.id) !== -1)
    : STORES.slice()

  return ok({
    list,
    total: list.length,
    summary: buildSummary(list),
    stores,
    canWrite: isSuper(actor) || isStoreManager(actor)
  })
}

async function handleGet(event, actor) {
  const id = String(event.id || event._id || '').trim()
  if (!id) return fail('缺少 id')
  const res = await withCollectionRetry(() => db.collection(COLLECTION).doc(id).get())
  const doc = res.data
  if (!doc || doc.deleted) return fail('记录不存在', 'NOT_FOUND')
  if (!canAccessStore(actor, doc.storeId)) {
    return fail('无该门店出货单查看权限', 'FORBIDDEN')
  }
  return ok({
    item: mapRow(doc),
    canWrite: isSuper(actor) || isStoreManager(actor)
  })
}

/** 出货观测台：KPI + 信号灯 + 趋势 / TOP 客户 / 结构 */
async function handleDashboard(event, actor) {
  const storeId = String(event.storeId || event.entityId || '').trim()
  const storeFilter = actorStoreFilter(actor)
  const dash = await withCollectionRetry(() =>
    buildShipmentDashboard({
      db,
      storeFilter,
      storeId: storeId || undefined
    })
  )
  return ok(
    Object.assign({}, dash, {
      canWrite: isSuper(actor) || isStoreManager(actor),
      isSuper: isSuper(actor),
      storeScope: storeFilter || 'all'
    })
  )
}

async function handleParseText(event) {
  const parsed = parseShipmentText(event.text || event.rawText || '')
  return ok({
    parsed,
    ok: parsed.ok,
    msg: parsed.ok
      ? `已解析 ${parsed.summary.storeCount} 店 · ${parsed.summary.itemCount} 行 · 共 ${parsed.summary.totalQty} 件`
      : (parsed.errors[0] && parsed.errors[0].msg) || '解析失败'
  })
}

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function pushSkuHit(list, seen, hit) {
  if (!hit || !hit.itemName) return
  const key = [
    hit.source || '',
    hit.inventoryRecordId || '',
    hit.productId || '',
    hit.skuId || '',
    hit.itemName
  ].join('|')
  if (seen[key]) return
  seen[key] = true
  list.push(hit)
}

/**
 * SKU / 品名搜索：成品库存 studio_inventory + 商品 products（含多 SKU）
 * 选中后可带回品名、规格、默认价；价格仍可手改。
 */
async function handleSearchSku(event) {
  const keyword = String((event && event.keyword) || '').trim()
  const limit = Math.min(24, Math.max(1, parseInt(event && event.limit, 10) || 12))
  if (!keyword) return ok({ list: [] })

  const lower = keyword.toLowerCase()
  const list = []
  const seen = {}

  try {
    let invRows = []
    try {
      const res = await db
        .collection('studio_inventory')
        .where(
          _.or([
            {
              skuName: db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
            },
            {
              itemName: db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
            }
          ])
        )
        .limit(limit)
        .get()
      invRows = res.data || []
    } catch (e) {
      const res = await db.collection('studio_inventory').limit(120).get()
      invRows = (res.data || []).filter((r) => {
        const hay = `${r.skuName || ''} ${r.itemName || ''} ${r.framingSpec || r.spec || ''}`.toLowerCase()
        return hay.indexOf(lower) !== -1
      })
    }
    invRows.slice(0, limit).forEach((r) => {
      const itemName = String(r.itemName || r.skuName || '').trim()
      if (!itemName) return
      pushSkuHit(list, seen, {
        key: `inv_${r._id}`,
        source: 'inventory',
        sourceLabel: '成品库存',
        itemName,
        spec: String(r.framingSpec || r.spec || '').trim(),
        unitPrice: roundMoney(r.unitPrice != null ? r.unitPrice : r.price),
        stockQty: Number(r.qty) || 0,
        inventoryRecordId: String(r._id || ''),
        productId: String(r.productId || '').trim(),
        skuId: String(r.skuId || '').trim()
      })
    })
  } catch (e) {
    console.warn('searchSku inventory', e && e.message)
  }

  try {
    let products = []
    try {
      const res = await db
        .collection('products')
        .where({
          title: db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
        })
        .limit(limit)
        .get()
      products = res.data || []
    } catch (e) {
      const res = await db.collection('products').limit(80).get()
      products = (res.data || []).filter((p) => {
        const title = String(p.title || '').toLowerCase()
        const skus = Array.isArray(p.skus) ? p.skus : []
        if (title.indexOf(lower) !== -1) return true
        return skus.some((s) => {
          const hay = `${s.specLabel || ''} ${s.sku || s.skuCode || ''} ${s.id || ''}`.toLowerCase()
          return hay.indexOf(lower) !== -1
        })
      })
    }

    products.forEach((p) => {
      const title = String(p.title || '').trim()
      if (!title) return
      const skus = Array.isArray(p.skus) ? p.skus : []
      if (skus.length) {
        skus.forEach((s) => {
          const spec = String(s.specLabel || s.spec || s.sku || '').trim()
          const skuHay = `${title} ${spec} ${s.sku || s.skuCode || ''}`.toLowerCase()
          if (keyword && skuHay.indexOf(lower) === -1 && title.toLowerCase().indexOf(lower) === -1) {
            return
          }
          pushSkuHit(list, seen, {
            key: `prod_${p._id}_${s.id || s.sku || spec}`,
            source: 'product',
            sourceLabel: '商品库',
            itemName: title,
            spec,
            unitPrice: roundMoney(
              s.price != null ? s.price : p.price != null ? p.price : 0
            ),
            stockQty: Number(s.stock != null ? s.stock : p.stock) || 0,
            inventoryRecordId: '',
            productId: String(p._id || ''),
            skuId: String(s.id || s.sku || s.skuCode || '').trim()
          })
        })
      } else {
        pushSkuHit(list, seen, {
          key: `prod_${p._id}`,
          source: 'product',
          sourceLabel: '商品库',
          itemName: title,
          spec: String(p.spec || p.size || '').trim(),
          unitPrice: roundMoney(p.price),
          stockQty: Number(p.stock) || 0,
          inventoryRecordId: '',
          productId: String(p._id || ''),
          skuId: ''
        })
      }
    })
  } catch (e) {
    console.warn('searchSku products', e && e.message)
  }

  return ok({ list: list.slice(0, limit) })
}

async function handleCreate(event, actor) {
  const input = Object.assign({}, event.item || event, {
    source: (event.item && event.item.source) || event.source || SOURCE.MANUAL
  })
  const normalized = normalizePayload(input, null)
  if (!normalized.ok) return fail(normalized.msg)
  if (!canAccessStore(actor, normalized.row.storeId)) {
    return fail('无该门店出货录入权限', 'FORBIDDEN')
  }
  const now = Date.now()
  const data = Object.assign({}, normalized.row, {
    createdAt: now,
    updatedAt: now,
    createdBy: (actor && (actor.name || actor.openid)) || '',
    updatedBy: (actor && (actor.name || actor.openid)) || '',
    deleted: false
  })
  const addRes = await withCollectionRetry(() => db.collection(COLLECTION).add({ data }))
  return ok({ id: addRes._id, item: mapRow(Object.assign({ _id: addRes._id }, data)) })
}

/**
 * 粘贴解析确认写入：一次可写多门店单据，共享 batchId
 */
async function handleCreateFromParsed(event, actor) {
  let parsed = event.parsed
  if (!parsed || !Array.isArray(parsed.shipments)) {
    parsed = parseShipmentText(event.text || event.rawText || '')
  }
  // 允许前端修正失败行后，以可写明细为准（不必原始 parse.ok）
  if (!parsed || !Array.isArray(parsed.shipments) || !parsed.shipments.length) {
    return fail((parsed && parsed.errors && parsed.errors[0] && parsed.errors[0].msg) || '解析结果无效')
  }

  const shipmentDate = String(
    (event.shipmentDate || parsed.shipmentDate || '').trim()
  ).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(shipmentDate)) {
    return fail('出货日期无效')
  }

  const status = normalizeStatus(event.status || 'confirmed')
  const source = event.source || SOURCE.MANUAL
  const note = String(event.note || '').trim()
  const rawText = String(event.rawText || parsed.rawText || '').trim()
  const batchId = String(event.batchId || '').trim() || genBatchId()
  const now = Date.now()
  const created = []
  const errors = []

  for (let i = 0; i < parsed.shipments.length; i += 1) {
    const block = parsed.shipments[i]
    if (!canAccessStore(actor, block.storeId)) {
      errors.push({ storeId: block.storeId, msg: '无该门店权限' })
      continue
    }
    const normalized = normalizePayload(
      {
        storeId: block.storeId,
        shipmentDate,
        items: block.items,
        status,
        source,
        note,
        rawText,
        batchId
      },
      null
    )
    if (!normalized.ok) {
      errors.push({ storeId: block.storeId, msg: normalized.msg })
      continue
    }
    try {
      const data = Object.assign({}, normalized.row, {
        createdAt: now,
        updatedAt: now,
        createdBy: (actor && (actor.name || actor.openid)) || '',
        updatedBy: (actor && (actor.name || actor.openid)) || '',
        deleted: false
      })
      const addRes = await withCollectionRetry(() => db.collection(COLLECTION).add({ data }))
      created.push(mapRow(Object.assign({ _id: addRes._id }, data)))
    } catch (err) {
      errors.push({ storeId: block.storeId, msg: err.message || String(err) })
    }
  }

  if (!created.length) {
    return fail((errors[0] && errors[0].msg) || '未能写入出货单')
  }

  return ok({
    batchId,
    list: created,
    stats: { created: created.length, failed: errors.length },
    errors: errors.slice(0, 20),
    msg: `已录入 ${created.length} 张出货单` + (errors.length ? `，失败 ${errors.length}` : '')
  })
}

async function handleUpdate(event, actor) {
  const id = String(event.id || event._id || '').trim()
  if (!id) return fail('缺少 id')
  const cur = await withCollectionRetry(() => db.collection(COLLECTION).doc(id).get())
  const prev = cur.data
  if (!prev || prev.deleted) return fail('记录不存在', 'NOT_FOUND')
  if (!canAccessStore(actor, prev.storeId)) {
    return fail('无该门店出货单编辑权限', 'FORBIDDEN')
  }

  const normalized = normalizePayload(event.item || event, prev)
  if (!normalized.ok) return fail(normalized.msg)
  if (!canAccessStore(actor, normalized.row.storeId)) {
    return fail('无目标门店权限', 'FORBIDDEN')
  }
  if (normalized.row.status !== prev.status && !canTransit(prev.status, normalized.row.status)) {
    return fail(`状态不可从「${prev.status}」改为「${normalized.row.status}」`)
  }

  const now = Date.now()
  const patch = Object.assign({}, normalized.row, {
    updatedAt: now,
    updatedBy: (actor && (actor.name || actor.openid)) || '',
    createdAt: prev.createdAt || now,
    createdBy: prev.createdBy || '',
    deleted: false
  })
  await withCollectionRetry(() => db.collection(COLLECTION).doc(id).update({ data: patch }))
  return ok({ item: mapRow(Object.assign({ _id: id }, patch)) })
}

async function handleSetStatus(event, actor) {
  const id = String(event.id || event._id || '').trim()
  const next = normalizeStatus(event.status)
  if (!id) return fail('缺少 id')
  const cur = await withCollectionRetry(() => db.collection(COLLECTION).doc(id).get())
  const prev = cur.data
  if (!prev || prev.deleted) return fail('记录不存在', 'NOT_FOUND')
  if (!canAccessStore(actor, prev.storeId)) {
    return fail('无该门店权限', 'FORBIDDEN')
  }
  if (!canTransit(prev.status, next)) {
    return fail(`状态不可从「${prev.status}」改为「${next}」`)
  }
  const now = Date.now()
  const patch = {
    status: next,
    statusLabel: STATUS_LABEL[next] || next,
    updatedAt: now,
    updatedBy: (actor && (actor.name || actor.openid)) || ''
  }
  await withCollectionRetry(() => db.collection(COLLECTION).doc(id).update({ data: patch }))
  return ok({ item: mapRow(Object.assign({}, prev, patch, { _id: id })) })
}

async function handleRemove(event, actor) {
  const id = String(event.id || event._id || '').trim()
  if (!id) return fail('缺少 id')
  const cur = await withCollectionRetry(() => db.collection(COLLECTION).doc(id).get())
  const prev = cur.data
  if (!prev || prev.deleted) return fail('记录不存在', 'NOT_FOUND')
  if (!isSuper(actor) && !canAccessStore(actor, prev.storeId)) {
    return fail('无该门店权限', 'FORBIDDEN')
  }
  const now = Date.now()
  await withCollectionRetry(() =>
    db.collection(COLLECTION).doc(id).update({
      data: {
        deleted: true,
        updatedAt: now,
        updatedBy: (actor && (actor.name || actor.openid)) || ''
      }
    })
  )
  return ok({ id })
}

async function findByFeishuRecordId(feishuRecordId) {
  const rid = String(feishuRecordId || '').trim()
  if (!rid) return null
  const res = await withCollectionRetry(() =>
    db.collection(COLLECTION).where({ feishuRecordId: rid, deleted: _.neq(true) }).limit(1).get()
  )
  if (res.data && res.data[0]) return res.data[0]

  // 明细级 feishuRecordId（扁平出货表一行一品）
  const all = await withCollectionRetry(() =>
    db.collection(COLLECTION).where({ deleted: _.neq(true) }).limit(200).get()
  )
  const hit = (all.data || []).find((doc) => {
    const items = Array.isArray(doc.items) ? doc.items : []
    return items.some((it) => String(it.feishuRecordId || '') === rid)
  })
  return hit || null
}

/**
 * 飞书 → ops_shipments 批量 upsert（按 feishuRecordId）
 * 默认一行飞书记录 = 一张单明细出货单（便于扁平行同步）
 */
async function handleUpsertFromFeishu(event, actor) {
  const items = Array.isArray(event.items) ? event.items : []
  if (!items.length) return fail('缺少 items')
  const defaultStoreId = guessStoreId(event.defaultStoreId || 'store_shanhaizaowu')
  const now = Date.now()
  let created = 0
  let updated = 0
  let skipped = 0
  const errors = []

  for (let i = 0; i < items.length; i += 1) {
    const payload = feishuItemToPayload(items[i], defaultStoreId)
    if (!payload.feishuRecordId) {
      skipped += 1
      errors.push({ index: i, msg: '缺少 feishuRecordId' })
      continue
    }
    if (!payload.items || !payload.items.length) {
      skipped += 1
      errors.push({ index: i, feishuRecordId: payload.feishuRecordId, msg: '缺少品名' })
      continue
    }

    try {
      const prev = await findByFeishuRecordId(payload.feishuRecordId)
      const normalized = normalizePayload(payload, prev)
      if (!normalized.ok) {
        skipped += 1
        errors.push({ index: i, feishuRecordId: payload.feishuRecordId, msg: normalized.msg })
        continue
      }
      if (prev && prev._id) {
        const patch = Object.assign({}, normalized.row, {
          updatedAt: now,
          updatedBy: (actor && (actor.name || actor.openid)) || 'feishu_sync',
          createdAt: prev.createdAt || now,
          createdBy: prev.createdBy || 'feishu_sync',
          deleted: false,
          syncedAt: now,
          source: SOURCE.FEISHU,
          sourceLabel: '飞书'
        })
        await withCollectionRetry(() =>
          db.collection(COLLECTION).doc(prev._id).update({ data: patch })
        )
        updated += 1
      } else {
        const data = Object.assign({}, normalized.row, {
          createdAt: now,
          updatedAt: now,
          createdBy: 'feishu_sync',
          updatedBy: (actor && (actor.name || actor.openid)) || 'feishu_sync',
          syncedAt: now,
          deleted: false
        })
        await withCollectionRetry(() => db.collection(COLLECTION).add({ data }))
        created += 1
      }
    } catch (err) {
      skipped += 1
      errors.push({
        index: i,
        feishuRecordId: payload.feishuRecordId,
        msg: err.message || String(err)
      })
    }
  }

  const stats = { created, updated, skipped, total: items.length }
  await saveSyncMeta({
    lastPullAt: now,
    lastPullStats: stats,
    lastPullOk: errors.length === 0,
    lastPullMsg: `飞书拉取 upsert：新建 ${created} · 更新 ${updated} · 跳过 ${skipped}`
  })
  await appendSyncLog('pullShipmentsToOps', {
    success: errors.length < items.length,
    msg: `新建 ${created} · 更新 ${updated} · 跳过 ${skipped}`,
    stats,
    errors: errors.slice(0, 20)
  })

  return ok({
    stats,
    errors: errors.slice(0, 30),
    msg: `已同步至 ${COLLECTION}：新建 ${created}，更新 ${updated}，跳过 ${skipped}`
  })
}

async function saveSyncMeta(patch) {
  const now = Date.now()
  const data = Object.assign({ _id: SYNC_META_ID }, patch, { updatedAt: now })
  try {
    await withCollectionRetry(async () => {
      try {
        await db.collection(SYNC_META_COLLECTION).doc(SYNC_META_ID).update({ data: patch })
      } catch (err) {
        await db.collection(SYNC_META_COLLECTION).doc(SYNC_META_ID).set({ data })
      }
    }, SYNC_META_COLLECTION)
  } catch (e2) {
    console.warn('saveSyncMeta', e2.message || e2)
  }
}

async function appendSyncLog(action, result) {
  try {
    await withCollectionRetry(
      () =>
        db.collection(SYNC_LOG_COLLECTION).add({
          data: {
            action,
            ok: !!result.success,
            message: result.msg || '',
            stats: result.stats || {},
            errors: result.errors || [],
            createdAt: Date.now()
          }
        }),
      SYNC_LOG_COLLECTION
    )
  } catch (e) {
    console.warn('appendSyncLog', e.message || e)
  }
}

async function handleSyncStatus() {
  let meta = null
  try {
    const res = await withCollectionRetry(
      () => db.collection(SYNC_META_COLLECTION).doc(SYNC_META_ID).get(),
      SYNC_META_COLLECTION
    )
    meta = res.data || null
  } catch (e) {
    meta = null
  }
  return ok({
    meta: meta || {},
    lastPullAt: (meta && meta.lastPullAt) || null,
    lastPushAt: (meta && meta.lastPushAt) || null,
    lastPullMsg: (meta && meta.lastPullMsg) || '',
    lastPullOk: meta && meta.lastPullOk != null ? !!meta.lastPullOk : null,
    lastPullStats: (meta && meta.lastPullStats) || null,
    ssot: COLLECTION
  })
}

async function handleSyncLogs(event) {
  const limit = Math.min(Math.max(Number(event.limit) || 30, 1), 80)
  try {
    const res = await withCollectionRetry(
      () =>
        db
          .collection(SYNC_LOG_COLLECTION)
          .where({
            action: _.in([
              'pullShipmentsToOps',
              'pushShipmentToFeishu',
              'pullShipments',
              'ops_shipment_sync'
            ])
          })
          .orderBy('createdAt', 'desc')
          .limit(limit)
          .get(),
      SYNC_LOG_COLLECTION
    )
    return ok({ logs: res.data || [] })
  } catch (e) {
    try {
      const res = await withCollectionRetry(
        () => db.collection(SYNC_LOG_COLLECTION).limit(100).get(),
        SYNC_LOG_COLLECTION
      )
      const logs = (res.data || [])
        .filter((r) => /shipment|ops_shipment|pullShipments|pushShipment/i.test(String(r.action || '')))
        .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
        .slice(0, limit)
      return ok({ logs })
    } catch (e2) {
      return ok({ logs: [], msg: e2.message || '暂无同步日志' })
    }
  }
}

async function handleBindFeishuRecord(event, actor) {
  const id = String(event.id || event._id || '').trim()
  const feishuRecordId = String(event.feishuRecordId || '').trim()
  const itemIndex = event.itemIndex
  if (!id || !feishuRecordId) return fail('缺少 id 或 feishuRecordId')

  const cur = await withCollectionRetry(() => db.collection(COLLECTION).doc(id).get())
  const prev = cur.data
  if (!prev || prev.deleted) return fail('记录不存在', 'NOT_FOUND')

  const now = Date.now()
  const patch = {
    syncedAt: now,
    updatedAt: now,
    updatedBy: (actor && (actor.name || actor.openid)) || ''
  }

  if (itemIndex != null && Number.isFinite(Number(itemIndex))) {
    const items = Array.isArray(prev.items) ? prev.items.slice() : []
    const idx = Number(itemIndex)
    if (!items[idx]) return fail('明细下标无效')
    items[idx] = Object.assign({}, items[idx], { feishuRecordId })
    patch.items = items
    if (!prev.feishuRecordId) patch.feishuRecordId = feishuRecordId
  } else {
    patch.feishuRecordId = feishuRecordId
  }

  await withCollectionRetry(() => db.collection(COLLECTION).doc(id).update({ data: patch }))
  await saveSyncMeta({ lastPushAt: now, lastPushMsg: `已绑定飞书记录 ${feishuRecordId}` })
  await appendSyncLog('pushShipmentToFeishu', {
    success: true,
    msg: `绑定 ${id} → ${feishuRecordId}`,
    stats: { pushed: 1 }
  })
  const res = await withCollectionRetry(() => db.collection(COLLECTION).doc(id).get())
  return ok({ item: mapRow(Object.assign({}, res.data, { _id: id })) })
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const action = String((event && event.action) || '').trim()

  const syncWriteActions = {
    upsertFromFeishu: 1,
    bindFeishuRecord: 1
  }
  const entryWriteActions = {
    create: 1,
    createFromParsed: 1,
    update: 1,
    setStatus: 1,
    remove: 1
  }

  try {
    if (syncWriteActions[action]) {
      const auth = await requireSuperAdmin(event, openid)
      if (!auth.ok) return auth.res
      if (action === 'upsertFromFeishu') return await handleUpsertFromFeishu(event, auth.actor)
      if (action === 'bindFeishuRecord') return await handleBindFeishuRecord(event, auth.actor)
    }

    if (entryWriteActions[action]) {
      const auth = await requireWriter(event, openid)
      if (!auth.ok) return auth.res
      if (action === 'create') return await handleCreate(event, auth.actor)
      if (action === 'createFromParsed') return await handleCreateFromParsed(event, auth.actor)
      if (action === 'update') return await handleUpdate(event, auth.actor)
      if (action === 'setStatus') return await handleSetStatus(event, auth.actor)
      if (action === 'remove') return await handleRemove(event, auth.actor)
    }

    if (action === 'parseText') {
      const auth = await requireWriter(event, openid)
      if (!auth.ok) return auth.res
      return await handleParseText(event)
    }

    if (action === 'searchSku') {
      const auth = await requireWriter(event, openid)
      if (!auth.ok) return auth.res
      return await handleSearchSku(event)
    }

    const auth = await requireReader(event, openid)
    if (!auth.ok) return auth.res
    if (action === 'meta') return await handleMeta(auth.actor)
    if (action === 'list') return await handleList(event, auth.actor)
    if (action === 'get') return await handleGet(event, auth.actor)
    if (action === 'dashboard') return await handleDashboard(event, auth.actor)
    if (action === 'syncStatus') {
      if (!isSuper(auth.actor)) return fail('仅超管可查看同步状态', 'FORBIDDEN')
      return await handleSyncStatus()
    }
    if (action === 'syncLogs') {
      if (!isSuper(auth.actor)) return fail('仅超管可查看同步日志', 'FORBIDDEN')
      return await handleSyncLogs(event)
    }
    return fail('未知 action', 'BAD_ACTION')
  } catch (err) {
    console.error('manageStoreShipment error', err)
    return fail(err.message || '服务器错误', 'SERVER_ERROR')
  }
}
