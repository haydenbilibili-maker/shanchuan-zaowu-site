/**
 * 飞书多维表对接
 * 凭证：环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET
 * 映射：configs / feishu_bitable
 */
const cloud = require('wx-server-sdk')
const {
  envToken,
  getTenantToken,
  listTables,
  listFields,
  listAllRecords,
  createRecord,
  cellText,
  cellNumber,
  pickField,
} = require('./feishuClient')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const CONFIG_ID = 'feishu_bitable'

function ok(data = {}) {
  return { success: true, ...data }
}
function fail(msg) {
  return { success: false, msg: msg || '失败' }
}

function getAdminOpenids() {
  const env = process.env.MESSAGE_ADMIN_OPENIDS || ''
  return env.split(',').map((s) => s.trim()).filter(Boolean)
}
function isAdmin(openid) {
  const admins = getAdminOpenids()
  // Web Admin 匿名登录无 OPENID，与现网订货履约同一门控（后台口令）
  if (!openid) return true
  if (!admins.length) return true
  return admins.includes(openid)
}

async function readConfig() {
  try {
    const doc = await db.collection('configs').doc(CONFIG_ID).get()
    return doc.data || {}
  } catch {
    return {
      appToken: envToken(),
      tables: {
        purchase: { tableId: '', fields: { orderNo: '单号', skuName: '物料', qty: '数量', supplier: '供应商', status: '状态', date: '日期' } },
        inventory: { tableId: '', fields: { skuName: '品名', skuId: 'SKU', qty: '数量', unit: '单位' } },
        shipment: { tableId: '', fields: { orderNo: '订货单号', storeName: '门店', carrier: '物流公司', trackingNumber: '物流单号', status: '状态' } },
      },
    }
  }
}

async function writeConfig(patch) {
  const cur = await readConfig()
  const data = { ...cur, ...patch, appToken: patch.appToken || cur.appToken || envToken(), updatedAt: Date.now() }
  try {
    await db.collection('configs').doc(CONFIG_ID).set({ data })
  } catch {
    await db.collection('configs').add({ data: { _id: CONFIG_ID, ...data } }).catch(async () => {
      await db.collection('configs').doc(CONFIG_ID).update({ data })
    })
  }
  return data
}

async function logSync(action, result) {
  try {
    await db.collection('feishu_sync_logs').add({
      data: {
        action,
        ok: !!result.success,
        message: result.msg || result.message || '',
        stats: result.stats || {},
        createdAt: Date.now(),
      },
    })
  } catch (e) {
    console.warn('logSync', e.message)
  }
}

async function upsertByRecordId(col, recordId, data) {
  const found = await db.collection(col).where({ recordId }).limit(1).get()
  const payload = { ...data, recordId, syncedAt: Date.now() }
  if (found.data && found.data[0]) {
    await db.collection(col).doc(found.data[0]._id).update({ data: payload })
    return 'update'
  }
  await db.collection(col).add({ data: payload })
  return 'insert'
}

function mapRecord(rec, fieldMap) {
  const f = rec.fields || {}
  const out = { raw: f }
  for (const [key, colName] of Object.entries(fieldMap || {})) {
    const v = pickField(f, colName)
    out[key] = key === 'qty' ? cellNumber(v) : cellText(v)
  }
  return out
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  if (!isAdmin(OPENID || '')) return fail('无管理权限')

  const action = event.action
  let result
  try {
    switch (action) {
      case 'inspect':
        result = await inspect()
        break
      case 'saveMapping':
        result = await saveMapping(event.mapping)
        break
      case 'getConfig':
        result = ok({ config: await readConfig() })
        break
      case 'pullPurchases':
        result = await pullTable('purchase', 'feishu_purchases')
        break
      case 'pullInventory':
        result = await pullInventory()
        break
      case 'applyInventory':
        result = await applyInventory()
        break
      case 'pushShipments':
        result = await pushShipments()
        break
      case 'listLogs':
        result = await listLogs()
        break
      default:
        result = fail('未知 action')
    }
  } catch (e) {
    console.error(action, e)
    result = fail(e.message || '同步失败')
  }
  if (action && action !== 'getConfig' && action !== 'listLogs') {
    await logSync(action, result)
  }
  return result
}

async function inspect() {
  const token = await getTenantToken()
  const appToken = envToken()
  const tables = await listTables(token, appToken)
  const detailed = []
  for (const t of tables) {
    const fields = await listFields(token, t.table_id, appToken)
    detailed.push({
      tableId: t.table_id,
      name: t.name,
      fields: (fields || []).map((f) => ({ name: f.field_name, type: f.type, uiType: f.ui_type })),
    })
  }
  return ok({ appToken, tables: detailed })
}

async function saveMapping(mapping) {
  if (!mapping || typeof mapping !== 'object') return fail('映射无效')
  const config = await writeConfig({ tables: mapping.tables || mapping, appToken: mapping.appToken || envToken() })
  return ok({ config })
}

async function pullTable(role, col) {
  const config = await readConfig()
  const spec = (config.tables || {})[role]
  if (!spec?.tableId) return fail(`请先映射「${role}」表`)
  const token = await getTenantToken()
  const records = await listAllRecords(token, spec.tableId, config.appToken || envToken())
  let upserted = 0
  for (const rec of records) {
    const mapped = mapRecord(rec, spec.fields)
    await upsertByRecordId(col, rec.record_id, mapped)
    upserted += 1
  }
  return ok({ stats: { pulled: records.length, upserted }, msg: `已同步 ${upserted} 条` })
}

async function pullInventory() {
  const pulled = await pullTable('inventory', 'feishu_inventory')
  if (!pulled.success) return pulled

  const products = (await db.collection('products').limit(400).get()).data || []
  const rows = (await db.collection('feishu_inventory').limit(400).get()).data || []
  let matched = 0
  for (const row of rows) {
    const productId = matchProduct(row, products)
    if (productId && row.productId !== productId) {
      await db.collection('feishu_inventory').doc(row._id).update({ data: { productId } })
      matched += 1
    } else if (row.productId) matched += 1
  }
  return ok({
    stats: { ...pulled.stats, matched },
    msg: `库存镜像 ${pulled.stats.upserted} 条，已映射藏品 ${matched} 条`,
  })
}

function matchProduct(row, products) {
  const sku = String(row.skuId || '').trim()
  const name = String(row.skuName || '').replace(/\s/g, '')
  if (sku) {
    const hit = products.find((p) => p._id === sku || p.skuId === sku || String(p.sku || '') === sku)
    if (hit) return hit._id
  }
  if (!name) return null
  const hit =
    products.find((p) => String(p.title || '').replace(/\s/g, '') === name) ||
    products.find((p) => String(p.title || '').includes(row.skuName) || name.includes(String(p.title || '').replace(/\s/g, '')))
  return hit ? hit._id : null
}

async function applyInventory() {
  const rows = (await db.collection('feishu_inventory').limit(400).get()).data || []
  let applied = 0
  let skipped = 0
  for (const row of rows) {
    if (!row.productId) {
      skipped += 1
      continue
    }
    const prodRes = await db.collection('products').doc(row.productId).get()
    const product = prodRes.data
    if (!product) {
      skipped += 1
      continue
    }
    const current = parseInt(product.stock, 10) || 0
    const target = Number(row.qty) || 0
    const delta = target - current
    if (delta === 0) {
      skipped += 1
      continue
    }
    await db.collection('products').doc(row.productId).update({
      data: { stock: target },
    })
    await db.collection('stock_movements').add({
      data: {
        warehouseId: 'hq',
        productId: row.productId,
        skuId: row.skuId || null,
        skuName: product.title || row.skuName,
        delta,
        balanceAfter: target,
        type: 'feishu_pull',
        refType: 'feishu_inventory',
        refId: row.recordId,
        note: `飞书库存对齐 ${row.skuName || ''} ${current}→${target}`,
        operator: 'feishu_sync',
        createdAt: Date.now(),
      },
    })
    applied += 1
  }
  return ok({ stats: { applied, skipped }, msg: `已应用 ${applied} 条，跳过 ${skipped} 条` })
}

async function pushShipments() {
  const config = await readConfig()
  const spec = (config.tables || {}).shipment
  if (!spec?.tableId) return fail('请先映射「出货」表')
  const token = await getTenantToken()
  const ships = (await db.collection('fulfillment_shipments').limit(200).get()).data || []
  const pending = ships.filter((s) => s.status === 'shipped' || s.status === 'delivered')
    .filter((s) => !s.feishuRecordId)
  let pushed = 0
  const fmap = spec.fields || {}
  for (const s of pending) {
    const fields = {}
    if (fmap.orderNo) fields[fmap.orderNo] = s.orderNo || ''
    if (fmap.storeName) fields[fmap.storeName] = s.storeName || ''
    if (fmap.carrier) fields[fmap.carrier] = (s.logistics && s.logistics.carrier) || ''
    if (fmap.trackingNumber) fields[fmap.trackingNumber] = (s.logistics && s.logistics.trackingNumber) || ''
    if (fmap.status) fields[fmap.status] = s.status === 'delivered' ? '已送达' : '已发货'
    const rec = await createRecord(token, spec.tableId, fields, config.appToken || envToken())
    const rid = rec && (rec.record_id || rec.id)
    await db.collection('fulfillment_shipments').doc(s._id).update({
      data: { feishuRecordId: rid, updatedAt: Date.now() },
    })
    pushed += 1
  }
  return ok({ stats: { pushed, skipped: pending.length - pushed }, msg: `已回写 ${pushed} 张出货单` })
}

async function listLogs() {
  try {
    const res = await db.collection('feishu_sync_logs').limit(40).get()
    const list = (res.data || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    return ok({ list })
  } catch {
    return ok({ list: [] })
  }
}
