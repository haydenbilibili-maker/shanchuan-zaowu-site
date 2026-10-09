/**
 * 出货备忘（旁路集合 ops_shipment_memos）—— 飞书出货表导入的「草稿」与「已结清历史」
 * 口径：miniprogram/docs/出货中心首批SKU导入_2026-10-09.md §8
 *
 * ⚠️ 本集合**刻意不进 ops_shipments**：ops_shipments 的读取方（看板 / 仪表盘 / 日报 / 账单 / 对账）
 *    只排除 cancelled，草稿或历史写进去就会被计入统计。独立集合 = 任何统计都读不到它。
 *    这里也**不发通知、不动库存、不碰结算字段**；唯一会产生正式单据的出口是 confirmDraft，
 *    且它调用的是正式开单 createFromSkus 本身（金额口径与直接开单一致）。
 *
 * kind：draft（9.21 起，待人工审核修改后转正式）| history（9.21 前，已结清，只读）
 * 行：{ key, rawName, rawSpec, qty, feishuUnitPrice, feishuAmount, feishuNote, feishuRecordId,
 *       match: 'sku'|'none', skuId, skuName, matchNote, hintKeyword, refUnitPrice, refAmount, diff, removed }
 */
const MEMO_COLLECTION = 'ops_shipment_memos'
const KIND = { DRAFT: 'draft', HISTORY: 'history' }
const MEMO_STATUS = { DRAFT: 'draft', CONFIRMING: 'confirming', CONFIRMED: 'confirmed', HISTORY: 'history' }

function money(n) {
  const v = Number(n)
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null
}

/** 汇总（纯函数）：飞书金额只加有值的行；待匹配 = 未删除且未对应到 SKU 的行 + 门店待匹配 */
function summarizeMemo(doc) {
  const lines = (doc.lines || []).filter((l) => !l.removed)
  let feishuTotal = 0
  let feishuMissing = 0
  let refTotal = 0
  let refMissing = 0
  lines.forEach((l) => {
    if (l.feishuAmount === null || l.feishuAmount === undefined) feishuMissing += 1
    else feishuTotal += Number(l.feishuAmount) || 0
    if (l.refAmount === null || l.refAmount === undefined) refMissing += 1
    else refTotal += Number(l.refAmount) || 0
  })
  const pendingLines = lines.filter((l) => l.match !== 'sku').length
  return {
    lineCount: lines.length,
    totalQty: lines.reduce((a, l) => a + (Number(l.qty) || 0), 0),
    feishuTotal: money(feishuTotal),
    feishuMissing,
    refTotal: money(refTotal),
    refMissing,
    pendingLines,
    pendingCount: pendingLines + (doc.storeMatched ? 0 : 1)
  }
}

/**
 * 已结清历史备忘 → 营收行（产品负责人 2026-10-09 口径；与 getStudioDashboard/settlementKpis.historyRevenueRows 同口径）。
 * **只**进「营收 / 出货额」类数（出货观测台的营收、月度金额、趋势金额、按客户 / 门店 / 品类的金额分布、净差额）；
 * 不进笔数、完整度、应收 / 待结算 / 对账 / 提醒。草稿永不计入。行带 historical:true，聚合时只加金额不加笔数。
 */
function historyRevenueRows(memos) {
  return (Array.isArray(memos) ? memos : [])
    .filter((m) => m && m.kind === KIND.HISTORY && m.deleted !== true)
    .map((m) => ({
      _id: m._id,
      historical: true,
      shipmentDate: m.shipmentDate || '',
      storeId: m.storeId || '',
      storeName: m.storeName || '',
      customerName: m.customerName || '',
      category: '历史备忘',
      totalAmount: summarizeMemo(m).feishuTotal || 0
    }))
}

/** 按看板的门店范围读历史备忘；集合不存在视作没有 */
async function loadHistoryRevenueRows(db, scope) {
  const _ = db.command
  const s = scope || {}
  const where = { kind: KIND.HISTORY, deleted: _.neq(true) }
  if (s.storeId) where.storeId = s.storeId
  else if (Array.isArray(s.storeFilter) && s.storeFilter.length) where.storeId = _.in(s.storeFilter)
  try {
    const res = await db.collection(MEMO_COLLECTION).where(where).limit(500).get()
    return historyRevenueRows((res && res.data) || [])
  } catch (e) {
    if (/not exist|集合不存在|502005/i.test(String((e && (e.errMsg || e.message)) || e))) return []
    throw e
  }
}

function mapMemo(doc) {
  const d = doc || {}
  return Object.assign(
    {
      _id: d._id || '',
      kind: d.kind === KIND.HISTORY ? KIND.HISTORY : KIND.DRAFT,
      status: d.status || '',
      storeId: d.storeId || '',
      storeName: d.storeName || '',
      storeMatched: d.storeMatched === true,
      customerName: d.customerName || '',
      shipmentDate: d.shipmentDate || '',
      note: d.note || '',
      settled: d.settled === true,
      historical: d.historical === true,
      importBatch: d.importBatch || '',
      confirmedShipmentId: d.confirmedShipmentId || '',
      lines: (d.lines || []).map((l) => Object.assign({}, l)),
      updatedAt: Number(d.updatedAt) || 0
    },
    summarizeMemo(d)
  )
}

/** 草稿编辑（纯函数）：只按 key 改 qty / skuId / removed；飞书原文字段一律保留 */
function applyDraftPatch(doc, patch, skuById) {
  const p = patch || {}
  const byKey = {}
  ;(Array.isArray(p.lines) ? p.lines : []).forEach((l) => { if (l && l.key) byKey[String(l.key)] = l })
  const errs = []
  const lines = (doc.lines || []).map((line) => {
    const ch = byKey[line.key]
    if (!ch) return line
    const next = Object.assign({}, line)
    if (ch.removed !== undefined) next.removed = ch.removed === true
    if (ch.qty !== undefined) {
      const q = Math.floor(Number(ch.qty))
      if (!(q > 0)) errs.push(`「${line.rawName}」数量须为正整数`)
      else next.qty = q
    }
    if (ch.skuId !== undefined) {
      const id = String(ch.skuId || '')
      if (!id) {
        Object.assign(next, { match: 'none', skuId: '', skuName: '', refUnitPrice: null, refAmount: null, diff: null })
      } else if (!skuById[id]) {
        errs.push(`「${line.rawName}」选的 SKU 不存在或已停用`)
      } else {
        Object.assign(next, { match: 'sku', skuId: id, skuName: skuById[id].skuName || '', matchNote: '人工选定' })
      }
    }
    return next
  })
  return { errs, lines }
}

/**
 * @param deps { db, _, ok, fail, withCollectionRetry, storeById, recomputeItemsPricing, createFromSkus, SKU_COLLECTION }
 */
function createMemoHandlers(deps) {
  const { db, _, ok, fail, withCollectionRetry, storeById, recomputeItemsPricing, createFromSkus, SKU_COLLECTION } = deps
  const coll = () => db.collection(MEMO_COLLECTION)
  const actorName = (actor) => (actor && (actor.name || actor.openid)) || ''

  async function loadMemo(id) {
    const key = String(id || '').trim()
    if (!key) return null
    try {
      const res = await coll().doc(key).get()
      const d = res && res.data
      return d && d.deleted !== true ? Object.assign({ _id: key }, d) : null
    } catch (e) {
      return null
    }
  }

  async function loadSkus(ids) {
    const out = {}
    const list = [...new Set(ids.filter(Boolean))]
    for (let i = 0; i < list.length; i += 100) {
      const res = await db.collection(SKU_COLLECTION).where({ _id: _.in(list.slice(i, i + 100)) }).limit(100).get()
      ;((res && res.data) || []).forEach((r) => { if (r.deleted !== true && r.status !== 'inactive') out[r._id] = r })
    }
    return out
  }

  /** 参考金额：SKU → 行，与 createFromSkus 同字段、同一个 recomputeItemsPricing；只作对照，不落正式单 */
  async function refreshRefs(lines, skuById) {
    const idx = []
    const items = []
    lines.forEach((l, i) => {
      if (l.removed || l.match !== 'sku' || !skuById[l.skuId]) return
      const sku = skuById[l.skuId]
      idx.push(i)
      items.push({
        itemName: sku.skuName || '', qty: l.qty,
        materialId: sku.materialId || '', materialName: sku.materialName || '', materialGrade: sku.materialGrade || '',
        packagingId: sku.packagingId || '', packagingName: sku.packagingName || '', packagingSize: sku.packagingSize || '',
        hasScene: sku.hasScene === true, sceneCost: Number(sku.sceneCost) || 0, skuId: sku._id,
        laborRatePct: sku.laborRatePct === null || sku.laborRatePct === undefined ? undefined : sku.laborRatePct,
        laborRateSource: sku.laborRatePct === null || sku.laborRatePct === undefined ? undefined : 'line'
      })
    })
    const priced = items.length ? await recomputeItemsPricing(items) : []
    const out = lines.map((l) => Object.assign({}, l))
    idx.forEach((i, k) => {
      const it = priced[k] || {}
      const ok2 = it.pricingStatus === 'priced'
      out[i].refUnitPrice = ok2 ? money(it.unitPrice) : null
      out[i].refAmount = ok2 ? money(it.totalPrice) : null
      out[i].diff = ok2 && out[i].feishuAmount !== null && out[i].feishuAmount !== undefined ? money(it.totalPrice - out[i].feishuAmount) : null
    })
    return out
  }

  async function list(event) {
    const kind = event.kind === KIND.HISTORY ? KIND.HISTORY : KIND.DRAFT
    const rows = []
    for (let skip = 0; skip < 2000; skip += 100) {
      let res
      try {
        res = await coll().where({ kind, deleted: _.neq(true) }).skip(skip).limit(100).get()
      } catch (e) {
        if (/not exist|集合不存在|502005/i.test(String((e && (e.errMsg || e.message)) || e))) break
        throw e
      }
      const page = (res && res.data) || []
      rows.push(...page)
      if (page.length < 100) break
    }
    const visible = rows.filter((r) => r.kind === kind && r.deleted !== true && (kind === KIND.HISTORY || r.status !== MEMO_STATUS.CONFIRMED))
    visible.sort((a, b) => (a.shipmentDate < b.shipmentDate ? 1 : a.shipmentDate > b.shipmentDate ? -1 : 0))
    return ok({ kind, list: visible.map(mapMemo), total: visible.length })
  }

  async function get(event) {
    const doc = await loadMemo(event.id)
    if (!doc) return fail('备忘不存在（可能已删除）', 'NOT_FOUND')
    return ok({ item: mapMemo(doc) })
  }

  async function updateDraft(event, actor) {
    const doc = await loadMemo(event.id)
    if (!doc) return fail('草稿不存在（可能已删除）', 'NOT_FOUND')
    if (doc.kind !== KIND.DRAFT || doc.status !== MEMO_STATUS.DRAFT) return fail('只有未转正式的草稿可以修改', 'BAD_STATE')
    const patch = event.patch || {}
    const wantSku = (Array.isArray(patch.lines) ? patch.lines : []).map((l) => l && l.skuId).filter(Boolean)
    const keptSku = (doc.lines || []).map((l) => l.skuId).filter(Boolean)
    const skuById = await loadSkus(wantSku.concat(keptSku))
    const applied = applyDraftPatch(doc, patch, skuById)
    if (applied.errs.length) return fail(applied.errs.join('；'), 'BAD_PARAM')
    const data = { lines: await refreshRefs(applied.lines, skuById), updatedAt: Date.now(), updatedBy: actorName(actor) }
    if (patch.storeId !== undefined) {
      const st = storeById(patch.storeId)
      if (!st) return fail('门店无效', 'BAD_PARAM')
      Object.assign(data, { storeId: st.id, storeName: st.name, storeMatched: true })
    }
    if (patch.note !== undefined) data.note = String(patch.note || '').slice(0, 500)
    await withCollectionRetry(() => coll().doc(doc._id).update({ data }), MEMO_COLLECTION)
    return ok({ item: mapMemo(Object.assign({}, doc, data)), msg: '草稿已保存' })
  }

  /**
   * 草稿 → 正式：**调用正式开单 createFromSkus 本身**（不另算一遍），金额与直接开单一致。
   * 先把状态从 draft 抢成 confirming（条件更新，防双击重复开单），失败则退回 draft。
   */
  async function confirmDraft(event, actor) {
    const doc = await loadMemo(event.id)
    if (!doc) return fail('草稿不存在（可能已删除）', 'NOT_FOUND')
    if (doc.kind !== KIND.DRAFT || doc.status !== MEMO_STATUS.DRAFT) return fail('这张草稿已转正式或不可转', 'BAD_STATE')
    const s = summarizeMemo(doc)
    if (!doc.storeMatched || !storeById(doc.storeId)) return fail('门店待匹配：请先选门店', 'PENDING_MATCH')
    if (s.pendingLines) return fail(`还有 ${s.pendingLines} 行待匹配：请为每行选 SKU，或删除该行`, 'PENDING_MATCH')
    const lines = (doc.lines || []).filter((l) => !l.removed)
    if (!lines.length) return fail('草稿没有有效明细', 'BAD_PARAM')

    const claim = await coll().where({ _id: doc._id, status: MEMO_STATUS.DRAFT }).update({ data: { status: MEMO_STATUS.CONFIRMING, updatedAt: Date.now() } })
    if (!claim || !claim.stats || claim.stats.updated !== 1) return fail('这张草稿正在转正式或已转过，请刷新', 'BAD_STATE')
    // 导入批次（feishu-*）的草稿是补录旧单：转正式不发「待支付」等通知（产品负责人 2026-10-09）；手工草稿照常通知
    const silentNotify = /^feishu-/.test(String(doc.importBatch || ''))
    let res
    try {
      res = await createFromSkus({
        storeId: doc.storeId,
        shipmentDate: doc.shipmentDate,
        lines: lines.map((l) => ({ skuId: l.skuId, qty: l.qty })),
        note: ['飞书草稿转正式', doc.note].filter(Boolean).join(' · ')
      }, actor, { silentNotify })
    } catch (e) {
      res = fail((e && e.message) || '开单失败', 'SERVER_ERROR')
    }
    if (!res || !res.success) {
      await coll().doc(doc._id).update({ data: { status: MEMO_STATUS.DRAFT, updatedAt: Date.now() } })
      return res || fail('开单失败')
    }
    await coll().doc(doc._id).update({
      data: { status: MEMO_STATUS.CONFIRMED, confirmedShipmentId: res.id || '', confirmedAt: Date.now(), confirmedBy: actorName(actor), notifySuppressed: silentNotify, updatedAt: Date.now() }
    })
    return Object.assign({}, res, { memoId: doc._id, msg: '草稿已转为正式出货单' + (res.msg ? '：' + res.msg : '') })
  }

  async function removeDraft(event, actor) {
    const doc = await loadMemo(event.id)
    if (!doc) return fail('草稿不存在（可能已删除）', 'NOT_FOUND')
    if (doc.kind !== KIND.DRAFT || doc.status !== MEMO_STATUS.DRAFT) return fail('只有未转正式的草稿可以删除', 'BAD_STATE')
    await coll().doc(doc._id).update({ data: { deleted: true, deletedAt: Date.now(), updatedAt: Date.now(), updatedBy: actorName(actor) } })
    return ok({ _id: doc._id, msg: '草稿已删除' })
  }

  return {
    'memo.list': list,
    'memo.get': get,
    'memo.updateDraft': updateDraft,
    'memo.confirmDraft': confirmDraft,
    'memo.removeDraft': removeDraft
  }
}

module.exports = { MEMO_COLLECTION, KIND, MEMO_STATUS, summarizeMemo, mapMemo, applyDraftPatch, historyRevenueRows, loadHistoryRevenueRows, createMemoHandlers }
