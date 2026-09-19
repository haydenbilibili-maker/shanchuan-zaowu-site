/**
 * 成品库存管理 — manageStudioInventory
 *
 * 命名：本函数管理「成品库存」（已做好的标本成品），集合 studio_inventory。
 * 飞书 SSOT：多维表「成品库存」（非「库存管理」）。
 * 原材料（多平台进货）见 manageStudioRawInventory → studio_raw_inventory。
 *
 * action:
 *   parse | commitSnapshot | list | listSnapshots | getSnapshot | meta | dashboard | upsertFromFeishu
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')
const { parseStudioInventoryText } = require('./parseStudioInventory')
const {
  COLLECTION,
  SNAPSHOT_COLLECTION,
  LOCATION_STUDIO,
  WRITE_MODE,
  buildLineDoc,
  mapInventoryRow,
  mapSnapshotRow,
  feishuItemToLine,
  ROLE_LABEL,
  ROLE_HINT,
  FEISHU_TABLE_NAME
} = require('./inventoryDefaults')
const { buildInventoryDashboard } = require('./inventoryDashboard')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const MAX_LIMIT = 100

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

async function requireManager(event, openid) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return { ok: false, res: fail(guard.msg, guard.code) }
  return { ok: true, actor: guard.actor }
}

async function fetchAllWhere(collection, where, limit = 500) {
  const col = db.collection(collection)
  const pageSize = 100
  const out = []
  let skip = 0
  while (skip < limit) {
    const take = Math.min(pageSize, limit - skip)
    const res = await col.where(where).skip(skip).limit(take).get()
    const list = (res && res.data) || []
    out.push(...list)
    if (list.length < take) break
    skip += list.length
  }
  return out
}

async function removeDocsByIds(collection, ids) {
  const col = db.collection(collection)
  const chunk = 20
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk)
    await Promise.all(slice.map((id) => col.doc(id).remove().catch(() => null)))
  }
}

async function addDocs(collection, docs) {
  const col = db.collection(collection)
  const chunk = 20
  const ids = []
  for (let i = 0; i < docs.length; i += chunk) {
    const slice = docs.slice(i, i + chunk)
    const results = await Promise.all(slice.map((doc) => col.add({ data: doc })))
    results.forEach((r) => {
      if (r && r._id) ids.push(r._id)
    })
  }
  return ids
}

function actorName(actor) {
  return String((actor && (actor.name || actor.displayName || actor.nickname)) || '').trim()
}

async function handleParse(event) {
  const parsed = parseStudioInventoryText(event && event.text)
  if (!parsed.ok) return fail(parsed.error || '解析失败', 'PARSE_FAIL')
  return ok({ parsed })
}

async function handleCommitSnapshot(event, actor) {
  const text = event && event.text
  const parsed = parseStudioInventoryText(text)
  if (!parsed.ok) return fail(parsed.error || '解析失败', 'PARSE_FAIL')

  let inventoryDate = String((event && event.inventoryDate) || parsed.inventoryDate || '').trim()
  if (!inventoryDate) {
    return fail('未能识别盘点日期，请在文本中包含「YYYY年M月D日」或手动指定 inventoryDate', 'DATE_REQUIRED')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inventoryDate)) {
    return fail('inventoryDate 格式应为 YYYY-MM-DD', 'DATE_INVALID')
  }

  const now = Date.now()
  const openid = (actor && actor.openid) || ''
  const name = actorName(actor)
  const sourceLabel = String((event && event.sourceLabel) || parsed.sourceLabel || '工作室库存').trim()
  const note = String((event && event.note) || '').trim().slice(0, 200)

  const snapshotPayload = {
    inventoryDate,
    sourceLabel,
    location: LOCATION_STUDIO,
    writeMode: WRITE_MODE.SNAPSHOT_OVERWRITE,
    lineCount: parsed.stats.lineCount,
    totalQty: parsed.stats.totalQty,
    groupCount: parsed.stats.groupCount,
    groups: parsed.groups,
    lines: parsed.lines.map((l) => ({
      skuName: l.skuName,
      qty: l.qty,
      unit: l.unit || '个',
      groupName: l.groupName || '',
      lineNo: l.lineNo || 0,
      skuId: null,
      productId: null,
      feishuRecordId: null
    })),
    rawSkipped: (parsed.skipped || []).slice(0, 50),
    note,
    createdAt: now,
    operatorOpenid: openid,
    operatorName: name
  }

  const snapRes = await withCollectionRetry(SNAPSHOT_COLLECTION, () =>
    db.collection(SNAPSHOT_COLLECTION).add({ data: snapshotPayload })
  )
  const snapshotId = snapRes._id

  // 覆盖当前工作室台账（全量替换，保留历史快照）
  const existing = await withCollectionRetry(COLLECTION, () =>
    fetchAllWhere(COLLECTION, { location: LOCATION_STUDIO }, 2000)
  )
  await removeDocsByIds(COLLECTION, existing.map((d) => d._id).filter(Boolean))

  const lineDocs = parsed.lines.map((line) =>
    buildLineDoc(line, {
      now,
      inventoryDate,
      sourceLabel,
      location: LOCATION_STUDIO,
      snapshotId,
      operatorOpenid: openid,
      operatorName: name
    })
  )
  await withCollectionRetry(COLLECTION, () => addDocs(COLLECTION, lineDocs))

  return ok({
    msg: `已写入盘点快照 ${inventoryDate}，覆盖当前库存 ${lineDocs.length} 条`,
    snapshotId,
    writeMode: WRITE_MODE.SNAPSHOT_OVERWRITE,
    parsed: {
      inventoryDate,
      sourceLabel,
      stats: parsed.stats,
      groups: parsed.groups,
      skippedCount: (parsed.skipped || []).length
    },
    replaced: existing.length,
    written: lineDocs.length
  })
}

async function handleList(event) {
  const location = String((event && event.location) || LOCATION_STUDIO).trim() || LOCATION_STUDIO
  if (location !== LOCATION_STUDIO) {
    return fail('一期仅支持工作室库存', 'LOCATION_UNSUPPORTED')
  }

  const keyword = String((event && event.keyword) || '').trim()
  const rawGroup = event && event.groupName != null ? String(event.groupName) : ''
  const filterUngrouped = rawGroup === '__ungrouped__'
  const groupName = filterUngrouped ? '' : String(rawGroup || '').trim()
  const hasGroupFilter = filterUngrouped || !!groupName
  const inventoryDate = String((event && event.inventoryDate) || '').trim()
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(event && event.limit, 10) || 80))

  // 若指定历史盘点日且与当前台账日期不同，从快照取最新一条该日记录
  if (inventoryDate) {
    const currentSample = await withCollectionRetry(COLLECTION, () =>
      db.collection(COLLECTION).where({ location: LOCATION_STUDIO }).limit(1).get()
    )
    const currentDate =
      currentSample && currentSample.data && currentSample.data[0]
        ? currentSample.data[0].inventoryDate
        : ''

    if (currentDate && currentDate !== inventoryDate) {
      const snaps = await withCollectionRetry(SNAPSHOT_COLLECTION, () =>
        db
          .collection(SNAPSHOT_COLLECTION)
          .where({ location: LOCATION_STUDIO, inventoryDate })
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get()
      )
      const snap = snaps && snaps.data && snaps.data[0]
      if (!snap) {
        return ok({
          list: [],
          groups: [],
          summary: {
            count: 0,
            skuCount: 0,
            totalQty: 0,
            groupCount: 0,
            inventoryDate,
            fromSnapshot: true
          },
          source: 'snapshot'
        })
      }
      let lines = Array.isArray(snap.lines) ? snap.lines.slice() : []
      if (hasGroupFilter) {
        lines = lines.filter((l) => String(l.groupName || '') === groupName)
      }
      if (keyword) {
        lines = lines.filter((l) => String(l.skuName || '').indexOf(keyword) !== -1)
      }
      const list = lines.slice(0, limit).map((l, i) => ({
        _id: `${snap._id}_${i}`,
        skuName: l.skuName,
        skuId: l.skuId || null,
        qty: Number(l.qty) || 0,
        unit: l.unit || '个',
        groupName: l.groupName || '',
        inventoryDate: snap.inventoryDate,
        sourceLabel: snap.sourceLabel || '',
        location: LOCATION_STUDIO,
        snapshotId: snap._id,
        productId: l.productId || null,
        feishuRecordId: l.feishuRecordId || null,
        updatedAt: snap.createdAt || 0,
        readOnly: true
      }))
      const groups = buildGroupBuckets(list)
      return ok({
        list,
        groups,
        summary: {
          count: list.length,
          skuCount: list.length,
          totalQty: list.reduce((s, x) => s + (x.qty || 0), 0),
          groupCount: groups.length,
          inventoryDate,
          fromSnapshot: true,
          snapshotId: snap._id
        },
        source: 'snapshot'
      })
    }
  }

  const where = { location: LOCATION_STUDIO }
  if (inventoryDate) where.inventoryDate = inventoryDate
  if (hasGroupFilter) where.groupName = groupName

  let rows = await withCollectionRetry(COLLECTION, () => fetchAllWhere(COLLECTION, where, 1000))
  if (keyword) {
    rows = rows.filter((r) => String(r.skuName || '').indexOf(keyword) !== -1)
  }
  rows.sort((a, b) => {
    const g = String(a.groupName || '').localeCompare(String(b.groupName || ''), 'zh')
    if (g !== 0) return g
    return String(a.skuName || '').localeCompare(String(b.skuName || ''), 'zh')
  })
  const sliced = rows.slice(0, limit).map(mapInventoryRow)
  const groups = buildGroupBuckets(sliced)
  return ok({
    list: sliced,
    groups,
    summary: {
      count: sliced.length,
      skuCount: sliced.length,
      totalQty: sliced.reduce((s, x) => s + (Number(x.qty) || 0), 0),
      groupCount: groups.length,
      inventoryDate: (sliced[0] && sliced[0].inventoryDate) || inventoryDate || '',
      fromSnapshot: false
    },
    source: 'current'
  })
}

function buildGroupBuckets(list) {
  const map = Object.create(null)
  const order = []
  ;(list || []).forEach((row) => {
    const key = String((row && row.groupName) || '').trim() || '未分组'
    if (!map[key]) {
      map[key] = {
        key,
        name: key,
        items: [],
        totalQty: 0,
        skuCount: 0,
        collapsed: false
      }
      order.push(key)
    }
    map[key].items.push(row)
    map[key].totalQty += Number(row.qty) || 0
    map[key].skuCount += 1
  })
  return order.map((k) => map[k])
}

async function handleListSnapshots(event) {
  const limit = Math.min(50, Math.max(1, parseInt(event && event.limit, 10) || 20))
  const res = await withCollectionRetry(SNAPSHOT_COLLECTION, () =>
    db
      .collection(SNAPSHOT_COLLECTION)
      .where({ location: LOCATION_STUDIO })
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get()
  )
  const list = ((res && res.data) || []).map((d) => mapSnapshotRow(d, false))
  return ok({ list })
}

async function handleGetSnapshot(event) {
  const id = String((event && event.id) || (event && event.snapshotId) || '').trim()
  if (!id) return fail('缺少 snapshotId', 'BAD_REQUEST')
  try {
    const res = await withCollectionRetry(SNAPSHOT_COLLECTION, () =>
      db.collection(SNAPSHOT_COLLECTION).doc(id).get()
    )
    const doc = res && res.data
    if (!doc) return fail('快照不存在', 'NOT_FOUND')
    return ok({ snapshot: mapSnapshotRow(doc, true) })
  } catch (err) {
    if (isMissingCollectionError(err)) return fail('快照不存在', 'NOT_FOUND')
    throw err
  }
}

async function handleMeta() {
  const rows = await withCollectionRetry(COLLECTION, () =>
    fetchAllWhere(COLLECTION, { location: LOCATION_STUDIO }, 1000)
  )
  const groupSet = Object.create(null)
  let inventoryDate = ''
  let sourceLabel = ''
  let totalQty = 0
  rows.forEach((r) => {
    const g = String(r.groupName || '').trim() || '未分组'
    groupSet[g] = true
    if (!inventoryDate && r.inventoryDate) inventoryDate = r.inventoryDate
    if (!sourceLabel && r.sourceLabel) sourceLabel = r.sourceLabel
    totalQty += Number(r.qty) || 0
  })

  let snapDates = []
  try {
    const snaps = await withCollectionRetry(SNAPSHOT_COLLECTION, () =>
      db
        .collection(SNAPSHOT_COLLECTION)
        .where({ location: LOCATION_STUDIO })
        .orderBy('createdAt', 'desc')
        .limit(30)
        .get()
    )
    const seen = Object.create(null)
    ;((snaps && snaps.data) || []).forEach((s) => {
      const d = s.inventoryDate
      if (d && !seen[d]) {
        seen[d] = true
        snapDates.push(d)
      }
    })
  } catch (e) {
    snapDates = inventoryDate ? [inventoryDate] : []
  }

  return ok({
    location: LOCATION_STUDIO,
    inventoryRole: 'finished',
    roleLabel: ROLE_LABEL,
    roleHint: ROLE_HINT,
    feishuTableName: FEISHU_TABLE_NAME,
    locations: [
      { value: LOCATION_STUDIO, label: '成品库存', enabled: true },
      { value: 'store', label: '门店成品（二期）', enabled: false }
    ],
    writeMode: WRITE_MODE.SNAPSHOT_OVERWRITE,
    writeModeLabel: '盘点日快照覆盖当前成品台账，并保留历史',
    schemaNote:
      '成品库存字段对齐飞书「成品库存」：物品名称 / 规格装裱 / 数量 / 盘点日期 / 备注。原材料请走「原材料库存」。',
    current: {
      inventoryDate,
      sourceLabel: sourceLabel || ROLE_LABEL,
      lineCount: rows.length,
      totalQty,
      groups: Object.keys(groupSet).sort((a, b) => a.localeCompare(b, 'zh'))
    },
    snapshotDates: snapDates
  })
}

/**
 * 飞书「成品库存」→ studio_inventory 按 feishuRecordId upsert
 * （勿用飞书「库存管理」表写入本集合——那是原材料）
 */
/**
 * 清掉「飞书同步进来的行」（**仅超管**）—— 用于同步写错后的收拾。
 *
 * 为什么要有它：`upsertFromFeishu` 只会按 `feishuRecordId` 增改，**不会删**；
 * 一旦用错了映射把别的表的行灌进来（2026-09-19 真实发生：成品库存被灌进 205 条原材料），
 * 没有任何入口能把它们去掉。删接口就这么一个，条件写死得很紧：
 *   · `feishuRecordId` 非空（同步写入的行才有）
 *   · `sourceLabel === '飞书成品库存'`（同步写入时打的标）
 *   · **没有 `snapshotId`**（盘点快照行一定有 —— 这条保证**永远碰不到人工盘点数据**）
 * 且只删调用方显式列出的 `ids`（最多 300），不做"按来源全删"。
 */
async function handleRemoveFeishuSynced (event, actor) {
  if (!actor || actor.superAdmin !== true) return fail('只有超管可以清理同步数据', 'NOT_SUPER')
  const ids = (Array.isArray(event.ids) ? event.ids : []).map((x) => String(x || '').trim()).filter(Boolean)
  if (!ids.length) return fail('缺少 ids', 'BAD_PARAM')
  if (ids.length > 300) return fail('一次最多清理 300 条', 'BAD_PARAM')

  const removed = []
  const skipped = []
  for (const id of ids) {
    let doc = null
    try {
      const res = await withCollectionRetry(COLLECTION, () => db.collection(COLLECTION).doc(id).get())
      doc = (res && res.data) || null
    } catch (e) {
      doc = null
    }
    if (!doc) { skipped.push({ id, why: '不存在' }); continue }
    if (!doc.feishuRecordId) { skipped.push({ id, why: '不是同步行（无 feishuRecordId）' }); continue }
    if (String(doc.sourceLabel || '') !== '飞书成品库存') { skipped.push({ id, why: '来源不是飞书同步' }); continue }
    if (doc.snapshotId) { skipped.push({ id, why: '属于盘点快照，拒绝删除' }); continue }
    try {
      await withCollectionRetry(COLLECTION, () => db.collection(COLLECTION).doc(id).remove())
      removed.push(id)
    } catch (e) {
      skipped.push({ id, why: (e && e.message) || '删除失败' })
    }
  }
  return ok({ removed: removed.length, skipped, msg: `已清理 ${removed.length} 条同步行，跳过 ${skipped.length} 条` })
}

async function handleUpsertFromFeishu(event, actor) {
  const items = Array.isArray(event.items) ? event.items : []
  if (!items.length) return fail('缺少 items')
  const now = Date.now()
  let created = 0
  let updated = 0
  let skipped = 0
  const errors = []

  for (let i = 0; i < items.length; i += 1) {
    const line = feishuItemToLine(items[i])
    if (!line.itemName) {
      skipped += 1
      errors.push({ index: i, msg: '缺少物品名称' })
      continue
    }
    try {
      let prev = null
      if (line.feishuRecordId) {
        const found = await withCollectionRetry(COLLECTION, () =>
          db.collection(COLLECTION).where({ feishuRecordId: line.feishuRecordId }).limit(1).get()
        )
        prev = (found.data && found.data[0]) || null
      }
      const doc = buildLineDoc(line, {
        now,
        inventoryDate:
          line.inventoryDate ||
          String((event && event.inventoryDate) || new Date().toISOString().slice(0, 10)),
        sourceLabel: '飞书成品库存',
        location: LOCATION_STUDIO,
        operatorOpenid: (actor && actor.openid) || '',
        operatorName: (actor && (actor.name || actor.openid)) || 'feishu_sync'
      })
      if (prev && prev._id) {
        await withCollectionRetry(COLLECTION, () =>
          db.collection(COLLECTION).doc(prev._id).update({
            data: Object.assign({}, doc, {
              createdAt: prev.createdAt || now,
              createdBy: prev.createdBy || 'feishu_sync'
            })
          })
        )
        updated += 1
      } else {
        await withCollectionRetry(COLLECTION, () =>
          db.collection(COLLECTION).add({
            data: Object.assign({}, doc, { createdBy: 'feishu_sync' })
          })
        )
        created += 1
      }
    } catch (err) {
      skipped += 1
      errors.push({ index: i, msg: err.message || String(err) })
    }
  }

  return ok({
    stats: { created, updated, skipped, total: items.length },
    errors: errors.slice(0, 30),
    msg: `已同步成品库存至 ${COLLECTION}：新建 ${created}，更新 ${updated}，跳过 ${skipped}`
  })
}

async function handleDashboard() {
  const dash = await buildInventoryDashboard({ db })
  return ok(dash)
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const action = String((event && event.action) || '').trim()

  try {
    const auth = await requireManager(event, openid)
    if (!auth.ok) return auth.res

    switch (action) {
      case 'parse':
        return await handleParse(event)
      case 'commitSnapshot':
        return await handleCommitSnapshot(event, auth.actor)
      case 'list':
        return await handleList(event)
      case 'listSnapshots':
        return await handleListSnapshots(event)
      case 'getSnapshot':
        return await handleGetSnapshot(event)
      case 'meta':
        return await handleMeta()
      case 'dashboard':
        return await handleDashboard()
      case 'upsertFromFeishu':
        return await handleUpsertFromFeishu(event, auth.actor)
      case 'removeFeishuSynced':
        return await handleRemoveFeishuSynced(event, auth.actor)
      default:
        return fail('未知 action', 'BAD_ACTION')
    }
  } catch (err) {
    console.error('[manageStudioInventory]', action, err)
    return fail(err && err.message ? err.message : '服务异常', 'INTERNAL')
  }
}
