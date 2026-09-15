/**
 * 成品库存（小程序「工作室库存」）— 集合与字段约定
 *
 * 命名对照（务必勿混用）：
 *   - 本集合 studio_inventory = 成品库存 = 已做好的标本成品台账/盘点
 *   - 飞书多维表「成品库存」tblh9wqtrQmZgRO5 为本集合飞书 SSOT
 *   - 飞书「库存管理」= 原材料库存（多平台进货）→ 见 studio_raw_inventory，勿写入本集合
 *
 * 字段 SSOT（飞书成品库存）：
 *   物品名称 / 规格装裱 / 数量 / 盘点日期 / 备注
 *
 * 与出货单 / 原材料库存 / fulfillment 隔离。粘贴盘点快照写入本集合。
 */

const COLLECTION = 'studio_inventory'
const SNAPSHOT_COLLECTION = 'studio_inventory_snapshots'
const LOCATION_STUDIO = 'studio'
const LOCATION_STORE = 'store'

/** 人类可读角色名（UI / 同步备注） */
const ROLE_LABEL = '成品库存'
const ROLE_HINT = '已做好的标本成品台账；对应飞书「成品库存」，非原材料'
const FEISHU_TABLE_NAME = '成品库存'
const FEISHU_TABLE_ID = 'tblh9wqtrQmZgRO5'

const WRITE_MODE = {
  /** 按盘点日写入快照，并覆盖当前成品台账 */
  SNAPSHOT_OVERWRITE: 'snapshot_overwrite'
}

function buildLineDoc(line, meta) {
  const now = meta.now || Date.now()
  const itemName = String(line.itemName || line.skuName || '').trim()
  const qty = Math.max(0, parseInt(line.qty, 10) || 0)
  const framingSpec = String(line.framingSpec || line.spec || line.规格装裱 || '').trim()
  return {
    itemName,
    skuName: itemName,
    skuId: line.skuId || null,
    framingSpec,
    spec: framingSpec,
    qty,
    unit: line.unit || '件',
    groupName: String(line.groupName || '').trim(),
    inventoryDate: meta.inventoryDate || line.inventoryDate || '',
    note: String(line.note || '').trim(),
    sourceLabel: meta.sourceLabel || ROLE_LABEL,
    location: meta.location || LOCATION_STUDIO,
    snapshotId: meta.snapshotId || '',
    productId: line.productId || null,
    feishuRecordId: line.feishuRecordId || null,
    lineNo: line.lineNo || 0,
    inventoryRole: 'finished',
    createdAt: now,
    updatedAt: now,
    operatorOpenid: meta.operatorOpenid || '',
    operatorName: meta.operatorName || ''
  }
}

function mapInventoryRow(doc) {
  if (!doc) return null
  const itemName = doc.itemName || doc.skuName || ''
  const framingSpec = doc.framingSpec || doc.spec || ''
  return {
    _id: doc._id,
    itemName,
    skuName: itemName,
    skuId: doc.skuId || null,
    framingSpec,
    spec: framingSpec,
    qty: Number(doc.qty) || 0,
    unit: doc.unit || '件',
    groupName: doc.groupName || '',
    inventoryDate: doc.inventoryDate || '',
    note: doc.note || '',
    sourceLabel: doc.sourceLabel || ROLE_LABEL,
    location: doc.location || LOCATION_STUDIO,
    snapshotId: doc.snapshotId || '',
    productId: doc.productId || null,
    feishuRecordId: doc.feishuRecordId || null,
    inventoryRole: 'finished',
    updatedAt: doc.updatedAt || 0
  }
}

function mapSnapshotRow(doc, withLines) {
  if (!doc) return null
  const row = {
    _id: doc._id,
    inventoryDate: doc.inventoryDate || '',
    sourceLabel: doc.sourceLabel || ROLE_LABEL,
    location: doc.location || LOCATION_STUDIO,
    writeMode: doc.writeMode || WRITE_MODE.SNAPSHOT_OVERWRITE,
    lineCount: doc.lineCount || 0,
    totalQty: doc.totalQty || 0,
    groupCount: doc.groupCount || 0,
    groups: Array.isArray(doc.groups) ? doc.groups : [],
    createdAt: doc.createdAt || 0,
    operatorOpenid: doc.operatorOpenid || '',
    operatorName: doc.operatorName || '',
    note: doc.note || '',
    inventoryRole: 'finished'
  }
  if (withLines) {
    row.lines = Array.isArray(doc.lines) ? doc.lines : []
  }
  return row
}

/** 飞书「成品库存」行 → 台账 upsert 输入 */
function feishuItemToLine(item) {
  const src = item && typeof item === 'object' ? item : {}
  const itemName = String(src.itemName || src.skuName || src.物品名称 || src.品名 || '').trim()
  const qty = Number(src.qty != null ? src.qty : src.数量 != null ? src.数量 : 0)
  return {
    itemName,
    skuName: itemName,
    framingSpec: String(src.framingSpec || src.spec || src.规格装裱 || src.规格型号 || '').trim(),
    qty: Number.isFinite(qty) && qty >= 0 ? qty : 0,
    inventoryDate: String(src.inventoryDate || src.盘点日期 || src.date || '')
      .trim()
      .slice(0, 10),
    note: String(src.note || src.备注 || '').trim(),
    feishuRecordId: String(src.feishuRecordId || src.recordId || '').trim() || null,
    unit: src.unit || '件'
  }
}

module.exports = {
  COLLECTION,
  SNAPSHOT_COLLECTION,
  LOCATION_STUDIO,
  LOCATION_STORE,
  WRITE_MODE,
  ROLE_LABEL,
  ROLE_HINT,
  FEISHU_TABLE_NAME,
  FEISHU_TABLE_ID,
  buildLineDoc,
  mapInventoryRow,
  mapSnapshotRow,
  feishuItemToLine
}
