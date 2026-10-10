/**
 * 门店出货单 — SSOT: ops_shipments
 *
 * 职责（多端共用同一集合，禁止各写各的）：
 *   1. 小程序超管/店长：主录入（粘贴解析 + 表单）
 *   2. ERP：记账核对 / 报表 / 飞书同步编排（经本云函数读写）
 *   3. 飞书出货表：双向同步（upsertFromFeishu / bindFeishuRecord）
 *
 * action:
 *   meta | list | get | dashboard | parseText | quotePrice | searchSku | create | createFromParsed | createFromSkus
 *   update | setStatus | remove
 *   upsertFromFeishu | syncStatus | syncLogs | bindFeishuRecord | repriceShipments（仅超管）
 *   memo.list | memo.get | memo.updateDraft | memo.confirmDraft | memo.removeDraft（仅超管；草稿 / 历史备忘走独立旁路集合，见 shipmentMemos.js）
 *   skuAdmin.refs | skuAdmin.removeIfUnused | skuAdmin.markReviewed（仅超管；出货中心 SKU 模块，见 skuAdmin.js）
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
  ENTRY_PATH,
  STATUS_LABEL,
  STATUS_FLOW,
  CATEGORY_OPTIONS,
  storeById,
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
const { buildContext, quoteLines, buildRepricePlan, PRICING_STATUS, SHIPMENT_PRICING_STATUS } = require('./pricingEngine')
const {
  NOTIFY_EVENTS,
  resolveRecipients,
  notifyStaff,
  buildShipmentPricedNotice,
  toDispatchVars
} = require('./settlementNotify')
const { createMemoHandlers, countSkuRefsInMemos } = require('./shipmentMemos')
const { createSkuAdminHandlers } = require('./skuAdmin')

/**
 * 算价的三个外部数据源（蓝图 §4）。
 * 读的是**集合本身**而不是 manageStudioSettlement 云函数：云函数之间不互相调用
 * （仓库既有做法），共享的是数据；同口径由共享内核 `pricingCore.js` 保证。
 */
const SKU_COLLECTION = 'studio_shipment_skus'
const MATERIAL_PRICE_COLLECTION = 'studio_material_prices'
const PACKAGING_PRICE_COLLECTION = 'studio_packaging_prices'
const SETTLEMENT_CONFIG_COLLECTION = 'configs'
const SETTLEMENT_CONFIG_ID = 'studio_settlement'

/** 结算配置缺字段一律按「关 + 30% + 要求写包装」兜底（与 manageStudioSettlement 同口径） */
const DEFAULT_SETTLEMENT_CONFIG = { enabled: false, laborRatePct: 30, requirePackaging: true }

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
  const dateFromOk = /^\d{4}-\d{2}-\d{2}$/.test(dateFrom)
  const dateToOk = /^\d{4}-\d{2}-\d{2}$/.test(dateTo)

  const where = { deleted: _.neq(true) }
  if (storeId) where.storeId = storeId
  if (status && status !== 'all') where.status = normalizeStatus(status)
  if (source && source !== 'all') where.source = source

  // 日期推进 where（YYYY-MM-DD 字符串可比较），避免「先 limit 再内存滤日期」把刚写入的单滤没
  if (dateFromOk && dateToOk && dateFrom === dateTo) {
    where.shipmentDate = dateFrom
  } else if (dateFromOk && dateToOk) {
    where.shipmentDate = _.and(_.gte(dateFrom), _.lte(dateTo))
  } else if (dateFromOk) {
    where.shipmentDate = _.gte(dateFrom)
  } else if (dateToOk) {
    where.shipmentDate = _.lte(dateTo)
  }

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

  let list = []
  let listNote = ''
  try {
    const res = await withCollectionRetry(() =>
      db.collection(COLLECTION).where(where).orderBy('updatedAt', 'desc').limit(limit).get()
    )
    list = (res.data || []).map(mapRow).filter(Boolean)
  } catch (err) {
    // 缺索引时降级：多取再内存排序（仍把日期条件放在 where，避免漏掉当日新单）
    listNote = 'list-fallback-no-index'
    const fetchLimit = Math.min(Math.max(limit * 5, 100), 200)
    const res = await withCollectionRetry(() =>
      db.collection(COLLECTION).where(where).limit(fetchLimit).get()
    )
    list = (res.data || []).map(mapRow).filter(Boolean)
    list.sort((a, b) => {
      const d = String(b.shipmentDate || '').localeCompare(String(a.shipmentDate || ''))
      if (d !== 0) return d
      return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)
    })
    if (list.length > limit) list = list.slice(0, limit)
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
    canWrite: isSuper(actor) || isStoreManager(actor),
    listNote: listNote || undefined
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

/**
 * **写入前服务端强制重算**（蓝图 §9.2「不信任前端传的价」）。
 *
 * 为什么必须重算而不是信前端：前端传的 `unitPrice/totalPrice` 可以被任意构造，
 * 而这些数直接决定门店要付多少钱。所以只要算价开着，客户端传来的价**只当作参考**，
 * 落库一律以服务端按价目表 + 引擎算出的结果为准。
 *
 * 三种情况**不重算**（保持既有行为，避免把历史/飞书路径弄坏）：
 *   ① 算价未启用（`enabled` 缺字段默认关）；
 *   ② 该行的 `pricingStatus` 是 `manual`（飞书带价 / 人工手填）—— 那本来就是"外部给定的价"；
 *   ③ 行里没有任何可用定价线索且文本也匹配不上 → 交给引擎报 unmatched（不编价）。
 *
 * @returns {Array} 重算后的 items（未启用时原样返回）
 */
async function recomputeItemsPricing(items) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) return list
  const config = await loadSettlementConfig()
  if (!config.enabled) return list

  const materials = await loadPriceRows(MATERIAL_PRICE_COLLECTION)
  const packagings = await loadPriceRows(PACKAGING_PRICE_COLLECTION)
  const ctx = buildContext({
    materials,
    packagings,
    laborRatePct: config.laborRatePct,
    requirePackaging: config.requirePackaging
  })

  return list.map((it) => {
    // 人工/外部来源的价不覆盖（那是刻意的口径，不是"前端传的价"）
    if (String(it.pricingStatus || '') === PRICING_STATUS.MANUAL) return it
    const quoted = quoteLines(
      [
        {
          itemName: it.itemName,
          qty: it.qty,
          materialId: it.materialId,
          materialName: it.materialName,
          materialGrade: it.materialGrade,
          packagingId: it.packagingId,
          packagingName: it.packagingName,
          packagingSize: it.packagingSize,
          // 造景成本：行上存的就是这一行实际用的（来源是 SKU 默认或人工覆盖）
          sceneCost: it.sceneCost,
          laborRatePct: it.laborRateSource === 'line' ? it.laborRatePct : undefined
        }
      ],
      ctx
    ).lines[0]
    if (!quoted || quoted.pricingStatus !== PRICING_STATUS.PRICED) {
      // 算不出来就保留原值 + 引擎的原因，**不编价**
      return Object.assign({}, it, {
        pricingStatus: quoted ? quoted.pricingStatus : PRICING_STATUS.UNMATCHED,
        pricingNote: quoted ? quoted.pricingNote : '重算失败'
      })
    }
    return Object.assign({}, it, {
      materialId: quoted.materialId,
      materialName: quoted.materialName,
      materialGrade: quoted.materialGrade,
      packagingId: quoted.packagingId,
      packagingName: quoted.packagingName,
      packagingSize: quoted.packagingSize,
      unitMaterialCostCents: quoted.unitMaterialCostCents,
      unitPackagingCostCents: quoted.unitPackagingCostCents,
      unitSceneCostCents: quoted.unitSceneCostCents,
      unitLaborCostCents: quoted.unitLaborCostCents,
      unitTotalCents: quoted.unitTotalCents,
      lineTotalCents: quoted.lineTotalCents,
      laborRatePct: quoted.laborRatePct,
      laborRateSource: quoted.laborRateSource,
      pricingStatus: quoted.pricingStatus,
      pricingNote: '',
      unitPrice: quoted.unitPrice,
      totalPrice: quoted.totalPrice
    })
  })
}

/**
 * 「重算历史单」（裁决 16）——**仅超管**，且**默认 dry-run**。
 *
 * 三条设计：
 *   ① **默认 dry-run**（`event.dryRun !== false`）：不显式说"我要真写"就绝不落库 ——
 *      这是会改历史金额的动作，安全默认必须是"只看不改"。
 *   ② 可重算范围由纯函数 `buildRepricePlan` 判定（已结清 / 已入账单 / 已取消 / 已删除都拒），
 *      并把每一条**拒绝原因**回传，而不是静默少算几张。
 *   ③ 只更新**定价相关字段**，其余（结算状态、账单、物流状态、备注…）原样不动 ——
 *      重算不该顺手改别的。
 */
async function handleRepriceShipments(event) {
  const dryRun = event.dryRun !== false
  const storeId = String(event.storeId || '').trim()
  const limit = Math.min(500, Math.max(1, parseInt(event.limit, 10) || 200))

  const where = { deleted: _.neq(true) }
  if (storeId) where.storeId = storeId
  const rows = []
  let skip = 0
  while (skip < limit) {
    const take = Math.min(100, limit - skip)
    const res = await db.collection(COLLECTION).where(where).skip(skip).limit(take).get()
    const list = (res && res.data) || []
    rows.push(...list)
    if (list.length < take) break
    skip += list.length
  }

  const plan = buildRepricePlan(rows)
  const config = await loadSettlementConfig()
  if (!config.enabled) {
    return fail('算价未启用，重算没有意义：请先在「价目表配置」里开启算价', 'PRICING_DISABLED')
  }

  const changes = []
  let changedCount = 0
  let updated = 0
  let issueAdded = 0

  for (const row of plan.eligible) {
    const items = await recomputeItemsPricing(row.items)
    const normalized = normalizePayload({ items }, row)
    if (!normalized.ok) {
      changes.push({
        _id: row._id,
        shipmentNo: row.shipmentNo || '',
        storeName: row.storeName || '',
        error: normalized.msg
      })
      continue
    }
    const beforeCents = Number(row.totalCents) || 0
    const afterCents = Number(normalized.row.totalCents) || 0
    const deltaCents = afterCents - beforeCents
    const becameIncomplete =
      String(normalized.row.pricingStatus || '') === SHIPMENT_PRICING_STATUS.INCOMPLETE &&
      String(row.pricingStatus || '') !== SHIPMENT_PRICING_STATUS.INCOMPLETE
    if (becameIncomplete) issueAdded += 1
    if (deltaCents !== 0) changedCount += 1
    changes.push({
      _id: row._id,
      shipmentNo: row.shipmentNo || '',
      storeName: row.storeName || '',
      shipmentDate: row.shipmentDate || '',
      beforeCents,
      afterCents,
      deltaCents,
      pricingStatus: normalized.row.pricingStatus || ''
    })
    if (!dryRun && deltaCents !== 0) {
      await db
        .collection(COLLECTION)
        .doc(row._id)
        .update({
          data: {
            items: normalized.row.items,
            itemCount: normalized.row.itemCount,
            totalQty: normalized.row.totalQty,
            totalAmount: normalized.row.totalAmount,
            unitPrice: normalized.row.unitPrice,
            pricingStatus: normalized.row.pricingStatus,
            pricingIssueCount: normalized.row.pricingIssueCount,
            materialCostCents: normalized.row.materialCostCents,
            packagingCostCents: normalized.row.packagingCostCents,
            laborCostCents: normalized.row.laborCostCents,
            totalCents: normalized.row.totalCents,
            laborRatePct: normalized.row.laborRatePct,
            pricedAt: Date.now()
          }
        })
      updated += 1
    }
  }

  const deltaSum = changes.reduce((n, c) => n + (Number(c.deltaCents) || 0), 0)
  return ok({
    dryRun,
    scanned: rows.length,
    eligibleCount: plan.eligible.length,
    skippedCount: plan.skipped.length,
    changedCount,
    updatedCount: updated,
    issueAdded,
    deltaSumCents: deltaSum,
    deltaSumAmount: Math.round(deltaSum) / 100,
    // 明细截断展示，避免一次返回几百条把响应撑爆
    changes: changes.slice(0, 100),
    changesTruncated: changes.length > 100,
    skipped: plan.skipped.slice(0, 100),
    msg: dryRun
      ? `试算完成：${rows.length} 张扫描 · ${plan.eligible.length} 张可重算 · ${changedCount} 张金额会变（合计 ${Math.round(deltaSum) / 100} 元）· 未写入`
      : `已重算：${updated} 张更新（${changedCount} 张金额变化，合计 ${Math.round(deltaSum) / 100} 元）`
  })
}

/**
 * **v1.3 新入口**：按「出货 SKU」开单（产品负责人 2026-09-19 改造指令）。
 *
 * 与老 `createFromParsed` 的区别：明细不是从文本解析来的，而是**选出来的 SKU**，
 * 所以不存在"名字写法对不上"这类匹配歧义 —— 这正是做 SKU 化的目的。
 *
 * 三条与老路径**完全一致**的地方（刻意复用，不写第二套）：
 *   ① 算价走同一个共享内核（把 SKU 的显式选择喂给引擎）；
 *   ② 落库走同一个 `normalizePayload`（结算字段仍只继承、不从入参读）；
 *   ③ 写完发同一套「待支付」通知。
 * 价格照旧**服务端重算**，不信前端传的价（recomputeItemsPricing 已在写入前跑）。
 */
/** opts.silentNotify 只由服务端内部传入（导入草稿转正式）；客户端入参无法触达 */
async function handleCreateFromSkus(event, actor, opts) {
  const storeId = String(event.storeId || '').trim()
  const shipmentDate = String(event.shipmentDate || '').trim()
  const store = storeById(storeId)
  if (!store) return fail('门店无效', 'BAD_PARAM')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(shipmentDate)) return fail('出货日期格式应为 YYYY-MM-DD', 'BAD_PARAM')
  if (!canAccessStore(actor, storeId)) return fail('无该门店出货录入权限', 'FORBIDDEN')

  const rawLines = Array.isArray(event.lines) ? event.lines : []
  if (!rawLines.length) return fail('请至少添加一个 SKU', 'BAD_PARAM')

  // 取 SKU 定义（客户端只送 skuId + qty，**不送材料/包装**，杜绝前端伪造组合）
  const ids = rawLines.map((l) => String((l && l.skuId) || '').trim()).filter(Boolean)
  if (ids.length !== rawLines.length) return fail('有明细缺少 skuId', 'BAD_PARAM')
  const skuRows = []
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const res = await db.collection(SKU_COLLECTION).where({ _id: _.in(chunk) }).limit(100).get()
    skuRows.push(...((res && res.data) || []))
  }
  const byId = {}
  skuRows.forEach((r) => { byId[r._id] = r })
  const missing = ids.filter((id) => !byId[id])
  if (missing.length) return fail(`有 ${missing.length} 个 SKU 不存在（可能已删除），请刷新后重试`, 'NOT_FOUND')

  const items = rawLines.map((l) => {
    const sku = byId[String(l.skuId)]
    const qty = Number(l.qty)
    const item = {
      itemName: sku.skuName || sku.materialName + ' · ' + sku.packagingName,
      qty: Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 0,
      materialId: sku.materialId || '',
      materialName: sku.materialName || '',
      materialGrade: sku.materialGrade || '',
      packagingId: sku.packagingId || '',
      packagingName: sku.packagingName || '',
      packagingSize: sku.packagingSize || '',
      // 造景：**快照进单据**（裁决 26 同口径：出货时定值，之后改 SKU 不影响历史单）
      hasScene: sku.hasScene === true,
      sceneCost: Number(sku.sceneCost) || 0,
      // 关联回 SKU 目录（items.skuId 是既有字段，不新加）
      skuId: sku._id || ''
    }
    // 行级费率覆盖：与既有裁决 22 一致（显式传 0 也要生效）
    const hasLineRate = l.laborRatePct !== undefined && l.laborRatePct !== null && l.laborRatePct !== ''
    if (hasLineRate) item.laborRatePct = Number(l.laborRatePct) || 0
    else if (sku.laborRatePct !== null && sku.laborRatePct !== undefined) item.laborRatePct = sku.laborRatePct
    // recomputeItemsPricing 只在 laborRateSource === 'line' 时采用行上的费率，否则回落全局费率
    if (item.laborRatePct !== undefined) item.laborRateSource = 'line'
    // 行级造景成本覆盖（同费率形态：显式传 0 也生效）—— 开单时能当场改这一行的造景成本
    const hasLineScene = l.sceneCost !== undefined && l.sceneCost !== null && l.sceneCost !== ''
    if (hasLineScene) item.sceneCost = Number(l.sceneCost) || 0
    return item
  })

  const recomputed = await recomputeItemsPricing(items)
  const normalized = normalizePayload(
    {
      storeId,
      shipmentDate,
      items: recomputed,
      source: SOURCE.MANUAL,
      entryPath: ENTRY_PATH.SKU,
      note: String(event.note || '').trim()
    },
    null
  )
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
  const item = mapRow(Object.assign({ _id: addRes._id }, data))
  const notify = opts && opts.silentNotify === true
    ? { sent: 0, failed: 0, targetCount: 0, skipped: 'IMPORTED_DRAFT' }
    : await notifyShipmentPricedQuietly([item])
  return ok({
    id: addRes._id,
    item,
    notify,
    msg: `已按 SKU 开单：${item.itemCount} 行 · ¥${item.totalAmount}`
  })
}

/** 价目表可能还没建（首次使用）→ 视作空表，让页面提示「没有可选项」而不是报服务异常 */
async function loadPriceRows(collection) {
  const out = []
  try {
    let skip = 0
    while (skip < 2000) {
      const res = await db.collection(collection).where({ deleted: _.neq(true) }).skip(skip).limit(100).get()
      const list = (res && res.data) || []
      out.push(...list)
      if (list.length < 100) break
      skip += list.length
    }
  } catch (err) {
    if (!/not exist|集合不存在|502005/i.test(String((err && err.errMsg) || err.message || err))) throw err
    return []
  }
  return out
}

async function loadSettlementConfig() {
  let doc = null
  try {
    const res = await db.collection(SETTLEMENT_CONFIG_COLLECTION).doc(SETTLEMENT_CONFIG_ID).get()
    doc = (res && res.data) || null
  } catch (err) {
    doc = null
  }
  const src = doc || {}
  const rate = Number(src.laborRatePct)
  return {
    enabled: src.enabled === true,
    laborRatePct: Number.isFinite(rate) && rate >= 0 ? rate : DEFAULT_SETTLEMENT_CONFIG.laborRatePct,
    requirePackaging: src.requirePackaging !== false
  }
}

/**
 * 出货单生成后的「待支付」通知（裁决：每一次填写出货单之后通知去付款）。
 *
 * 收件人 = 超管 + **该门店店长**（付款方是门店）。**有未核价行时文案改口径**，
 * 不报一个假总额 —— 门店据此备钱，报错金额比不报更糟。
 *
 * **best-effort**：通知失败绝不影响录单成功（录单是主流程，消息是告知）。
 */
async function notifyShipmentPricedQuietly(shipments) {
  const list = Array.isArray(shipments) ? shipments.filter(Boolean) : []
  if (!list.length) return { sent: 0, failed: 0, targetCount: 0, skipped: 'NO_SHIPMENT' }
  const first = list[0]
  try {
    const resolved = await resolveRecipients(db, {
      storeId: first.storeId,
      includeSuper: true,
      includeStoreManager: true
    })
    const notice = buildShipmentPricedNotice(
      list.length === 1
        ? first
        : Object.assign({}, first, {
            // 一次粘多店时把门店名说清，避免店长以为是自己那单
            storeName: list.map((x) => x.storeName).filter(Boolean).join('、')
          })
    )
    const sent = await notifyStaff(cloud, {
      eventType: NOTIFY_EVENTS.SHIPMENT_PRICED,
      openids: resolved.openids,
      relatedId: first._id || first.batchId || '',
      vars: toDispatchVars(notice)
    })
    return Object.assign({ targetCount: resolved.openids.length }, sent, {
      storeManagerMissing: !!resolved.storeManagerMissing
    })
  } catch (e) {
    console.error('[manageStoreShipment] notify shipment priced failed', e)
    return { sent: 0, failed: 1, errors: [String((e && e.message) || e)], targetCount: 0 }
  }
}

/**
 * 算价（蓝图 §5）——「逐行可编辑页」与保存时的**唯一**取价入口。
 *
 * 为什么客户端不许自己算：预览价与落库价必须同源。前端只传「选了什么」（材料/等级/包装/尺寸/数量/费率），
 * 金额一律由服务端用共享内核算出来，因此不存在「预览 160、落库 180」。
 *
 * 入参：{ lines: [{ itemName, qty, materialId?, materialName?, grade?, packagingId?, packagingName?, size?, laborRatePct? }],
 *        laborRatePct? }   ← 单据级费率；行级 laborRatePct 优先（裁决 22）
 */
async function handleQuotePrice(event) {
  const config = await loadSettlementConfig()
  const lines = Array.isArray(event.lines) ? event.lines : []
  if (!config.enabled) {
    return ok({
      enabled: false,
      pricingStatus: SHIPMENT_PRICING_STATUS.INCOMPLETE,
      lines: [],
      msg: '算价未启用：请先在「价目表配置」里维护价目并开启结算算价',
      config
    })
  }

  const materials = await loadPriceRows(MATERIAL_PRICE_COLLECTION)
  const packagings = await loadPriceRows(PACKAGING_PRICE_COLLECTION)
  const ctx = buildContext({
    materials,
    packagings,
    laborRatePct: event.laborRatePct != null ? event.laborRatePct : config.laborRatePct,
    requirePackaging: config.requirePackaging
  })
  const quoted = quoteLines(lines, ctx)

  return ok({
    enabled: true,
    config: { laborRatePct: config.laborRatePct, requirePackaging: config.requirePackaging },
    priceBook: { materials: materials.length, packagings: packagings.length },
    ...quoted,
    msg:
      quoted.issueCount > 0
        ? `已算 ${quoted.pricedCount} 行，另有 ${quoted.issueCount} 行待处理`
        : `已算 ${quoted.pricedCount} 行 · 合计 ¥${quoted.totalAmount}`
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
  // 写入前服务端强制重算（不信任前端传的价）
  if (Array.isArray(input.items)) {
    input.items = await recomputeItemsPricing(input.items)
  }
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
  const item = mapRow(Object.assign({ _id: addRes._id }, data))
  const notify = await notifyShipmentPricedQuietly([item])
  return ok({ id: addRes._id, item, notify })
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
    // 写入前服务端强制重算（不信任前端传的价）—— 逐店重算，各店费率一致
    const recomputedItems = await recomputeItemsPricing(block.items)
    const normalized = normalizePayload(
      {
        storeId: block.storeId,
        shipmentDate,
        items: recomputedItems,
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

  /**
   * 通知**按门店分别发**（不是把多家店的单合成一条）：每个店长只该看到自己门店的待付款，
   * 合成一条会把别家门店的金额发给他。
   */
  const notify = []
  const byStore = {}
  for (const it of created) {
    const sid = it.storeId || ''
    if (!byStore[sid]) byStore[sid] = []
    byStore[sid].push(it)
  }
  for (const sid of Object.keys(byStore)) {
    notify.push(await notifyShipmentPricedQuietly(byStore[sid]))
  }

  return ok({
    batchId,
    list: created,
    stats: { created: created.length, failed: errors.length },
    errors: errors.slice(0, 20),
    notify,
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

const memoHandlers = createMemoHandlers({
  db,
  _,
  ok,
  fail,
  withCollectionRetry,
  storeById,
  recomputeItemsPricing,
  createFromSkus: (ev, actor, opts) => handleCreateFromSkus(ev, actor, opts),
  SKU_COLLECTION
})

const skuAdminHandlers = createSkuAdminHandlers({
  db,
  _,
  ok,
  fail,
  withCollectionRetry,
  SKU_COLLECTION,
  SHIPMENT_COLLECTION: COLLECTION,
  countSkuRefsInMemos
})

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const action = String((event && event.action) || '').trim()

  const syncWriteActions = {
    upsertFromFeishu: 1,
    bindFeishuRecord: 1,
    // 重算历史单会改历史金额 → 与飞书写入同档，仅超管（裁决 16）
    repriceShipments: 1
  }
  const entryWriteActions = {
    create: 1,
    createFromParsed: 1,
    update: 1,
    setStatus: 1,
    remove: 1
  }

  try {
    if (Object.prototype.hasOwnProperty.call(memoHandlers, action)) {
      const auth = await requireSuperAdmin(event, openid)
      if (!auth.ok) return auth.res
      return await memoHandlers[action](event, auth.actor)
    }

    if (Object.prototype.hasOwnProperty.call(skuAdminHandlers, action)) {
      const auth = await requireSuperAdmin(event, openid)
      if (!auth.ok) return auth.res
      return await skuAdminHandlers[action](event, auth.actor)
    }

    if (syncWriteActions[action]) {
      const auth = await requireSuperAdmin(event, openid)
      if (!auth.ok) return auth.res
      if (action === 'upsertFromFeishu') return await handleUpsertFromFeishu(event, auth.actor)
      if (action === 'bindFeishuRecord') return await handleBindFeishuRecord(event, auth.actor)
      if (action === 'repriceShipments') return await handleRepriceShipments(event)
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

    if (action === 'createFromSkus') {
      const auth = await requireWriter(event, openid)
      if (!auth.ok) return auth.res
      return await handleCreateFromSkus(event, auth.actor)
    }

    if (action === 'quotePrice') {
      const auth = await requireWriter(event, openid)
      if (!auth.ok) return auth.res
      return await handleQuotePrice(event)
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
