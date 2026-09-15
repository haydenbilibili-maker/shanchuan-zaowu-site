/**
 * 采购管理 — 门店采购 + 工作室采购（SSOT: ops_purchases）
 *
 * action:
 *   meta | list | get | dashboard | create | update | setStatus | batchSetStatus | remove
 *   upsertFromFeishu | syncStatus | syncLogs | bindFeishuRecord
 *
 * 权限：
 *   - 超管 / Admin ops key：全量读写 + 同步
 *   - 店长：本店相关只读 list/get/meta
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
  ENTITIES,
  SOURCE,
  STATUS_LABEL,
  STATUS_FLOW,
  entitiesByScope,
  entityIdsForStoreIds,
  normalizeStatus,
  canTransit,
  normalizePayload,
  mapRow,
  buildSummary,
  feishuItemToPayload
} = require('./purchaseDefaults')
const { buildPurchaseDashboard } = require('./purchaseDashboard')

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

/** 读：超管或店长；写/同步：仅超管 */
async function requireReader(event, openid) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return { ok: false, res: fail(guard.msg, guard.code) }
  if (!isSuper(guard.actor) && !isStoreManager(guard.actor)) {
    return { ok: false, res: fail('仅超管或店长可查看采购账目', 'FORBIDDEN') }
  }
  return { ok: true, actor: guard.actor, readOnly: !isSuper(guard.actor) }
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

function actorEntityFilter(actor) {
  if (isSuper(actor)) return null
  return entityIdsForStoreIds(actor.storeIds || [])
}

async function handleMeta(actor) {
  const allowed = actorEntityFilter(actor)
  let entities = ENTITIES.slice()
  if (allowed) {
    entities = ENTITIES.filter((e) => allowed.indexOf(e.id) !== -1)
  }
  return ok({
    entities,
    statuses: Object.keys(STATUS_LABEL).map((value) => ({
      value,
      label: STATUS_LABEL[value],
      next: STATUS_FLOW[value] || []
    })),
    sources: [
      { value: SOURCE.FEISHU, label: '飞书' },
      { value: SOURCE.ERP, label: 'ERP' },
      { value: SOURCE.MANUAL, label: '手工' }
    ],
    readOnly: !isSuper(actor),
    ssot: COLLECTION,
    feishuNote:
      'SSOT 为 ops_purchases。飞书多维表经 ERP「飞书同步中心」拉取 upsert（按 feishuRecordId）；采购管理可快捷同步；ERP 新建/编辑可回写飞书。'
  })
}

async function handleList(event, actor) {
  const scope = String(event.scope || '').trim()
  const entityId = String(event.entityId || '').trim()
  const status = String(event.status || '').trim()
  const source = String(event.source || '').trim()
  const keyword = String(event.keyword || '').trim()
  const dateFrom = String(event.dateFrom || '').trim()
  const dateTo = String(event.dateTo || '').trim()
  const limit = Math.min(Math.max(Number(event.limit) || 50, 1), 100)

  const where = { deleted: _.neq(true) }
  if (scope === 'store' || scope === 'studio') where.scope = scope
  if (entityId) where.entityId = entityId
  if (status && status !== 'all') where.status = normalizeStatus(status)
  if (source && source !== 'all') where.source = source

  const allowed = actorEntityFilter(actor)
  if (allowed) {
    if (entityId && allowed.indexOf(entityId) === -1) {
      return ok({
        list: [],
        total: 0,
        summary: buildSummary([]),
        entities: entitiesByScope(scope).filter((e) => allowed.indexOf(e.id) !== -1),
        readOnly: true
      })
    }
    if (!entityId) where.entityId = _.in(allowed)
  }

  const res = await withCollectionRetry(() =>
    db.collection(COLLECTION).where(where).limit(limit).get()
  )
  let list = (res.data || []).map(mapRow).filter(Boolean)
  list.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))

  if (dateFrom || dateTo) {
    list = list.filter((row) => {
      const d = String(row.purchaseDate || '')
      if (!d) return false
      if (dateFrom && d < dateFrom) return false
      if (dateTo && d > dateTo) return false
      return true
    })
  }

  if (keyword) {
    const kw = keyword.toLowerCase()
    list = list.filter((row) => {
      const hay = `${row.orderNo} ${row.itemName} ${row.spec} ${row.supplier} ${row.note} ${row.sourceLabel}`.toLowerCase()
      return hay.indexOf(kw) !== -1
    })
  }

  const ents = allowed
    ? entitiesByScope(scope).filter((e) => allowed.indexOf(e.id) !== -1)
    : entitiesByScope(scope)

  return ok({
    list,
    total: list.length,
    summary: buildSummary(list),
    entities: ents,
    readOnly: !isSuper(actor)
  })
}

async function handleGet(event, actor) {
  const id = String(event.id || event._id || '').trim()
  if (!id) return fail('缺少 id')
  const res = await withCollectionRetry(() => db.collection(COLLECTION).doc(id).get())
  const doc = res.data
  if (!doc || doc.deleted) return fail('记录不存在', 'NOT_FOUND')
  const allowed = actorEntityFilter(actor)
  if (allowed && allowed.indexOf(doc.entityId) === -1) {
    return fail('无该门店采购查看权限', 'FORBIDDEN')
  }
  return ok({ item: mapRow(doc), readOnly: !isSuper(actor) })
}

/** 采购观测台：KPI + 信号灯 + 趋势 / 类型占比 */
async function handleDashboard(event, actor) {
  const scope = String(event.scope || '').trim()
  const entityId = String(event.entityId || '').trim()
  const entityFilter = actorEntityFilter(actor)
  const dash = await withCollectionRetry(() =>
    buildPurchaseDashboard({
      db,
      entityFilter,
      scope: scope || undefined,
      entityId: entityId || undefined
    })
  )
  return ok(
    Object.assign({}, dash, {
      readOnly: !isSuper(actor),
      isSuper: isSuper(actor),
      entityScope: entityFilter || 'all'
    })
  )
}

async function handleCreate(event, actor) {
  const input = Object.assign({}, event.item || event, {
    source: (event.item && event.item.source) || event.source || SOURCE.ERP
  })
  const normalized = normalizePayload(input, null)
  if (!normalized.ok) return fail(normalized.msg)
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

async function handleUpdate(event, actor) {
  const id = String(event.id || event._id || '').trim()
  if (!id) return fail('缺少 id')
  const cur = await withCollectionRetry(() => db.collection(COLLECTION).doc(id).get())
  const prev = cur.data
  if (!prev || prev.deleted) return fail('记录不存在', 'NOT_FOUND')

  const normalized = normalizePayload(event.item || event, prev)
  if (!normalized.ok) return fail(normalized.msg)

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

/** 批量快捷流转：同一目标状态，逐条校验可流转 */
async function handleBatchSetStatus(event, actor) {
  const ids = Array.isArray(event.ids) ? event.ids.map((x) => String(x || '').trim()).filter(Boolean) : []
  const next = normalizeStatus(event.status)
  if (!ids.length) return fail('请选择要流转的采购单')
  if (!next) return fail('缺少目标状态')

  const now = Date.now()
  let okCount = 0
  let skipped = 0
  const errors = []

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i]
    try {
      const cur = await withCollectionRetry(() => db.collection(COLLECTION).doc(id).get())
      const prev = cur.data
      if (!prev || prev.deleted) {
        skipped += 1
        errors.push({ id, msg: '记录不存在' })
        continue
      }
      if (!canTransit(prev.status, next)) {
        skipped += 1
        errors.push({
          id,
          msg: `不可从「${STATUS_LABEL[normalizeStatus(prev.status)] || prev.status}」改为「${STATUS_LABEL[next] || next}」`
        })
        continue
      }
      await withCollectionRetry(() =>
        db.collection(COLLECTION).doc(id).update({
          data: {
            status: next,
            statusLabel: STATUS_LABEL[next] || next,
            updatedAt: now,
            updatedBy: (actor && (actor.name || actor.openid)) || ''
          }
        })
      )
      okCount += 1
    } catch (err) {
      skipped += 1
      errors.push({ id, msg: err.message || String(err) })
    }
  }

  return ok({
    stats: { ok: okCount, skipped, total: ids.length },
    errors: errors.slice(0, 20),
    msg: `已流转 ${okCount} 条` + (skipped ? `，跳过 ${skipped} 条` : '')
  })
}

async function handleRemove(event, actor) {
  const id = String(event.id || event._id || '').trim()
  if (!id) return fail('缺少 id')
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
  return (res.data && res.data[0]) || null
}

/**
 * 飞书 → ops_purchases 批量 upsert（按 feishuRecordId）
 * event.items: 已映射字段数组；defaultEntityId 缺省归属
 */
async function handleUpsertFromFeishu(event, actor) {
  const items = Array.isArray(event.items) ? event.items : []
  if (!items.length) return fail('缺少 items')
  const defaultEntityId = String(event.defaultEntityId || 'studio_specimen').trim()
  const now = Date.now()
  let created = 0
  let updated = 0
  let skipped = 0
  const errors = []

  for (let i = 0; i < items.length; i += 1) {
    const raw = items[i]
    const payload = feishuItemToPayload(raw, defaultEntityId)
    if (!payload.feishuRecordId) {
      skipped += 1
      errors.push({ index: i, msg: '缺少 feishuRecordId' })
      continue
    }
    if (!payload.itemName) {
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
          syncedAt: now
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
  await appendSyncLog('pullPurchasesToOps', {
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
        // 文档不存在或其它：整文档覆盖写入
        await db.collection(SYNC_META_COLLECTION).doc(SYNC_META_ID).set({ data })
      }
    }, SYNC_META_COLLECTION)
  } catch (e2) {
    console.warn('saveSyncMeta', e2.message || e2)
    // 降级：写入同步日志集合，避免丢时间戳
    try {
      await appendSyncLog('ops_purchase_sync_meta', {
        success: true,
        msg: patch.lastPullMsg || patch.lastPushMsg || 'meta',
        stats: Object.assign({}, patch.lastPullStats || {}, { lastPullAt: patch.lastPullAt, lastPushAt: patch.lastPushAt })
      })
    } catch (_) {
      /* ignore */
    }
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

  // 若 meta 缺失，从最近同步日志回退
  if (!meta || !meta.lastPullAt) {
    try {
      const logsRes = await handleSyncLogs({ limit: 5 })
      const logs = (logsRes && logsRes.logs) || []
      const pull = logs.find((l) => String(l.action || '').indexOf('pullPurchases') !== -1)
      if (pull) {
        meta = Object.assign({}, meta || {}, {
          lastPullAt: pull.createdAt || null,
          lastPullOk: !!pull.ok,
          lastPullMsg: pull.message || '',
          lastPullStats: pull.stats || null
        })
      }
    } catch (_) {
      /* ignore */
    }
  }

  return ok({
    meta: meta || {},
    lastPullAt: (meta && meta.lastPullAt) || null,
    lastPushAt: (meta && meta.lastPushAt) || null,
    lastPullMsg: (meta && meta.lastPullMsg) || '',
    lastPullOk: meta && meta.lastPullOk != null ? !!meta.lastPullOk : null,
    lastPullStats: (meta && meta.lastPullStats) || null
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
              'pullPurchasesToOps',
              'pushPurchaseToFeishu',
              'pullPurchases',
              'ops_purchase_sync'
            ])
          })
          .orderBy('createdAt', 'desc')
          .limit(limit)
          .get(),
      SYNC_LOG_COLLECTION
    )
    return ok({ logs: res.data || [] })
  } catch (e) {
    // 无索引时降级
    try {
      const res = await withCollectionRetry(
        () => db.collection(SYNC_LOG_COLLECTION).limit(100).get(),
        SYNC_LOG_COLLECTION
      )
      const logs = (res.data || [])
        .filter((r) => /purchase|ops_purchase|pullPurchases|pushPurchase/i.test(String(r.action || '')))
        .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
        .slice(0, limit)
      return ok({ logs })
    } catch (e2) {
      return ok({ logs: [], msg: e2.message || '暂无同步日志' })
    }
  }
}

/** ERP 回写飞书后绑定 record_id */
async function handleBindFeishuRecord(event, actor) {
  const id = String(event.id || event._id || '').trim()
  const feishuRecordId = String(event.feishuRecordId || '').trim()
  if (!id || !feishuRecordId) return fail('缺少 id 或 feishuRecordId')
  const now = Date.now()
  await withCollectionRetry(() =>
    db.collection(COLLECTION).doc(id).update({
      data: {
        feishuRecordId,
        source: SOURCE.ERP,
        sourceLabel: 'ERP',
        syncedAt: now,
        updatedAt: now,
        updatedBy: (actor && (actor.name || actor.openid)) || ''
      }
    })
  )
  await saveSyncMeta({ lastPushAt: now, lastPushMsg: `已绑定飞书记录 ${feishuRecordId}` })
  await appendSyncLog('pushPurchaseToFeishu', {
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

  const writeActions = {
    create: 1,
    update: 1,
    setStatus: 1,
    batchSetStatus: 1,
    remove: 1,
    upsertFromFeishu: 1,
    bindFeishuRecord: 1
  }

  try {
    if (writeActions[action]) {
      const auth = await requireSuperAdmin(event, openid)
      if (!auth.ok) return auth.res
      if (action === 'create') return await handleCreate(event, auth.actor)
      if (action === 'update') return await handleUpdate(event, auth.actor)
      if (action === 'setStatus') return await handleSetStatus(event, auth.actor)
      if (action === 'batchSetStatus') return await handleBatchSetStatus(event, auth.actor)
      if (action === 'remove') return await handleRemove(event, auth.actor)
      if (action === 'upsertFromFeishu') return await handleUpsertFromFeishu(event, auth.actor)
      if (action === 'bindFeishuRecord') return await handleBindFeishuRecord(event, auth.actor)
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
    console.error('managePurchaseOrder error', err)
    return fail(err.message || '服务器错误', 'SERVER_ERROR')
  }
}
