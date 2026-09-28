/**
 * 价目行引用判定 + 按资料排序（纯函数，可离线测：scripts/test-price-book-refs.mjs）
 *
 * 引用点（2026-09-28 取证）：
 *   · ops_shipments.items[]      —— materialId/materialName/materialGrade、packagingId/packagingName/packagingSize
 *                                   （算过价的行存价目行 _id；旧行 / 手填行可能只有名称 + 等级/尺寸）
 *   · studio_shipment_skus       —— 同名六字段（顶层）
 *   · ops_settlement_bills       —— 只存 shipmentIds，经出货单间接引用（查出货单即覆盖）
 *   · studio_raw_inventory       —— 只按名称对照「参考采购价」，不是引用
 *
 * 判定：行上有 id → 只认 id（id 指向别的行就不再按名称算）；没有 id → 名称（正名 / 展示名 / 别名，归一化）
 * 且等级/尺寸一致；行上等级/尺寸为空或「默认」时，等同于命中该名称的默认档。
 */
const { normalizeName } = require('./pricingCore')

const REF_FIELDS = {
  material: { id: 'materialId', name: 'materialName', option: 'materialGrade' },
  packaging: { id: 'packagingId', name: 'packagingName', option: 'packagingSize' }
}

/** 查询用的原样名称（库里存的是原文，where 只能精确匹配） */
function rawNamesOf(row) {
  const out = [row.name, row.displayName].concat(Array.isArray(row.aliases) ? row.aliases : [])
  return Array.from(new Set(out.map((s) => String(s || '').trim()).filter(Boolean)))
}

function refMatcher(book, row) {
  const f = REF_FIELDS[book.kind]
  const id = String(row._id || '')
  const names = new Set(rawNamesOf(row).map((s) => normalizeName(s)).filter(Boolean))
  const rowOpt = String(row[book.optionField] || '').trim() || book.defaultOption
  const rowIsDefault = row[book.defaultFlagKey] === true || rowOpt === book.defaultOption
  return (obj) => {
    if (!obj) return false
    const refId = String(obj[f.id] || '').trim()
    if (refId) return refId === id
    if (!names.has(normalizeName(obj[f.name] || ''))) return false
    const opt = String(obj[f.option] || '').trim()
    if (!opt || opt === book.defaultOption) return rowIsDefault
    return normalizeName(opt) === normalizeName(rowOpt)
  }
}

/** 统计引用：shipments 按单计（一单多行只算一次），skus 按条计；已软删的出货单单列 */
function countRefs(book, row, shipments, skus) {
  const hit = refMatcher(book, row)
  const res = { shipments: 0, deletedShipments: 0, skus: 0 }
  for (const s of shipments || []) {
    if (!(Array.isArray(s.items) ? s.items : []).some(hit)) continue
    if (s.deleted === true) res.deletedShipments += 1
    else res.shipments += 1
  }
  for (const k of skus || []) if (k.deleted !== true && hit(k)) res.skus += 1
  res.total = res.shipments + res.deletedShipments + res.skus
  return res
}

/** searchPriceBook 的 orderBy:'sort'：组按组内最小 sort，选项按 sort；同 sort 时默认档在前、再按名称 */
function orderGroupsBySort(groups) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  for (const g of groups) {
    g.options.sort((a, b) => num(a.sort) - num(b.sort) || (a.isDefault === b.isDefault ? 0 : a.isDefault ? -1 : 1))
    g.sort = g.options.length ? Math.min(...g.options.map((o) => num(o.sort))) : 0
  }
  return groups.sort((a, b) => a.sort - b.sort || String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'))
}

module.exports = { REF_FIELDS, rawNamesOf, refMatcher, countRefs, orderGroupsBySort }
