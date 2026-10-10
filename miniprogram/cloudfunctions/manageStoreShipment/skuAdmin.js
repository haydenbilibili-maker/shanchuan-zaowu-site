/**
 * 出货中心 · SKU 模块的旁路动作（仅超管；分发处统一 requireSuperAdmin）
 * 蓝图：miniprogram/docs/出货中心SKU模块_蓝图_2026-10-10.md §4
 *
 *   skuAdmin.refs            { id } | { ids }  → 被正式单 / 草稿 / 历史备忘引用的次数（只读）
 *   skuAdmin.removeIfUnused  { id }            → 有任何引用即拒（IN_USE，零写入）；无引用才软删
 *   skuAdmin.markReviewed    { id }            → needsReview:false + 复核人 / 时间
 *
 * SKU 的新建 / 编辑 / 停用仍走 manageStudioSettlement 的 sku.*（不在这里另写一套）。
 * 正式单引用含已作废与已删除的单：排查历史时仍要能回查这条 SKU（与 priceBook.removeIfUnused 同口径）。
 */

const MAX_IDS = 200

/**
 * @param deps { db, _, ok, fail, withCollectionRetry, SKU_COLLECTION, SHIPMENT_COLLECTION, countSkuRefsInMemos }
 */
function createSkuAdminHandlers(deps) {
  const { db, _, ok, fail, withCollectionRetry, SKU_COLLECTION, SHIPMENT_COLLECTION, countSkuRefsInMemos } = deps
  const actorName = (actor) => (actor && (actor.name || actor.openid)) || ''

  async function loadSku(id) {
    const key = String(id || '').trim()
    if (!key) return null
    try {
      const res = await db.collection(SKU_COLLECTION).doc(key).get()
      const d = res && res.data
      return d && d.deleted !== true ? Object.assign({ _id: key }, d) : null
    } catch (e) {
      return null
    }
  }

  async function countShipmentRefs(ids, out) {
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50)
      for (let skip = 0; skip < 5000; skip += 100) {
        let res
        try {
          res = await db.collection(SHIPMENT_COLLECTION)
            .where(_.or([{ 'items.skuId': _.in(chunk) }, { skuId: _.in(chunk) }]))
            .skip(skip).limit(100).get()
        } catch (e) {
          if (/not exist|集合不存在|502005/i.test(String((e && (e.errMsg || e.message)) || e))) return
          throw e
        }
        const page = (res && res.data) || []
        page.forEach((row) => {
          const hit = new Set(
            [String(row.skuId || '')].concat((row.items || []).map((it) => String((it && it.skuId) || ''))).filter((id) => out[id])
          )
          const key = row.deleted === true ? 'deletedShipments' : row.status === 'cancelled' ? 'cancelledShipments' : 'shipments'
          hit.forEach((id) => { out[id][key] += 1 })
        })
        if (page.length < 100) break
      }
    }
  }

  async function computeRefs(ids) {
    const out = {}
    ids.forEach((id) => {
      out[id] = { shipments: 0, cancelledShipments: 0, deletedShipments: 0, drafts: 0, otherMemos: 0, total: 0 }
    })
    await countShipmentRefs(ids, out)
    const memo = await countSkuRefsInMemos(db, ids)
    ids.forEach((id) => {
      const m = memo[id] || {}
      const r = out[id]
      r.drafts = Number(m.drafts) || 0
      r.otherMemos = Number(m.otherMemos) || 0
      r.total = r.shipments + r.cancelledShipments + r.deletedShipments + r.drafts + r.otherMemos
    })
    return out
  }

  function idsOf(event) {
    const list = Array.isArray(event.ids) ? event.ids : event.id ? [event.id] : []
    return [...new Set(list.map((x) => String(x || '').trim()).filter(Boolean))]
  }

  async function refs(event) {
    const ids = idsOf(event)
    if (!ids.length) return fail('缺少 SKU', 'BAD_PARAM')
    if (ids.length > MAX_IDS) return fail(`一次最多查 ${MAX_IDS} 个 SKU`, 'BAD_PARAM')
    const result = { refs: await computeRefs(ids) }
    if (event.id && ids.length === 1) {
      const doc = await loadSku(ids[0])
      if (!doc) return fail('SKU 不存在（可能已删除）', 'NOT_FOUND')
      result.meta = {
        createdAt: Number(doc.createdAt) || 0,
        createdBy: doc.createdBy || '',
        updatedAt: Number(doc.updatedAt) || 0,
        updatedBy: doc.updatedBy || '',
        reviewedAt: Number(doc.reviewedAt) || 0,
        reviewedBy: doc.reviewedBy || ''
      }
    }
    return ok(result)
  }

  function refsText(r) {
    const parts = []
    if (r.shipments) parts.push(`${r.shipments} 张出货单`)
    if (r.cancelledShipments) parts.push(`${r.cancelledShipments} 张已作废出货单`)
    if (r.deletedShipments) parts.push(`${r.deletedShipments} 张已删除出货单`)
    if (r.drafts) parts.push(`${r.drafts} 张草稿`)
    if (r.otherMemos) parts.push(`${r.otherMemos} 张历史备忘`)
    return parts.join('、')
  }

  async function removeIfUnused(event, actor) {
    const doc = await loadSku(event.id)
    if (!doc) return fail('SKU 不存在（可能已删除）', 'NOT_FOUND')
    const r = (await computeRefs([doc._id]))[doc._id]
    if (r.total > 0) {
      return Object.assign(fail(`被 ${refsText(r)} 引用，不能删除；请改为停用`, 'IN_USE'), { refs: r })
    }
    const now = Date.now()
    await withCollectionRetry(
      () => db.collection(SKU_COLLECTION).doc(doc._id).update({ data: { deleted: true, deletedAt: now, updatedAt: now, updatedBy: actorName(actor) } }),
      SKU_COLLECTION
    )
    return ok({ _id: doc._id, refs: r, msg: '无引用，已删除' })
  }

  async function markReviewed(event, actor) {
    const doc = await loadSku(event.id)
    if (!doc) return fail('SKU 不存在（可能已删除）', 'NOT_FOUND')
    if (doc.needsReview !== true) return ok({ _id: doc._id, noop: true, msg: '这条 SKU 已复核过' })
    const now = Date.now()
    const by = actorName(actor)
    await withCollectionRetry(
      () => db.collection(SKU_COLLECTION).doc(doc._id).update({ data: { needsReview: false, reviewedAt: now, reviewedBy: by, updatedAt: now, updatedBy: by } }),
      SKU_COLLECTION
    )
    return ok({ _id: doc._id, msg: '已标记为复核通过' })
  }

  return {
    'skuAdmin.refs': refs,
    'skuAdmin.removeIfUnused': removeIfUnused,
    'skuAdmin.markReviewed': markReviewed
  }
}

module.exports = { createSkuAdminHandlers }
