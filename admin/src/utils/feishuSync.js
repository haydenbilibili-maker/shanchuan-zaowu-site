/**
 * Admin 飞书对接：
 * - 飞书 Open API：经 /api/feishu-sync（Cloudflare Function）或本地 Vite 代理
 * - 镜像 / 映射 / 库存：CloudBase 匿名 SDK 直写
 * - 采购账目 SSOT：managePurchaseOrder → ops_purchases（按 feishuRecordId upsert）
 * - 门店出货 SSOT：manageStoreShipment → ops_shipments（小程序主录入；ERP/飞书同步同库）
 * 不再依赖微信云函数直连飞书（Web 匿名会 PERMISSION_DENIED）
 */
import {
  COLLECTIONS,
  callCloudFunction,
  cdnAdd,
  cdnDocGet,
  cdnSet,
  cdnUpdate,
  fetchCollectionLimit,
  fetchCollectionWhere,
} from '../cloud'

const CONFIG_ID = 'feishu_bitable'
const APP_TOKEN = 'WCs2bnIHsaty7vsjcnaczu0Wnod'
const PURCHASE_FN = 'managePurchaseOrder'
const SHIPMENT_FN = 'manageStoreShipment'
const CONFIG_CACHE_KEY = 'sc_feishu_bitable_config_v1'

/** 进程内缓存：UI「就绪」与 pull 校验共用，避免匿名读 configs 失败时假就绪 */
let configCache = null

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj || {}))
}

function defaultFeishuConfig() {
  return {
    appToken: APP_TOKEN,
    tables: {
      purchase: {
        tableId: '',
        fields: {
          orderNo: '单号',
          skuName: '物料',
          qty: '数量',
          unit: '单位',
          unitPrice: '单价',
          supplier: '供应商',
          status: '状态',
          date: '日期',
          entityName: '归属',
          spec: '规格',
          note: '备注',
        },
      },
      inventory: { tableId: '', fields: { skuName: '品名', skuId: 'SKU', qty: '数量', unit: '单位' } },
      shipment: {
        tableId: '',
        fields: {
          shipmentNo: '出货单号',
          storeName: '门店',
          itemName: '品名',
          qty: '数量',
          status: '状态',
          date: '出货日期',
          note: '备注',
        },
      },
    },
  }
}

function normalizeTables(raw) {
  const base = defaultFeishuConfig().tables
  const src = raw && typeof raw === 'object' ? raw : {}
  const out = deepClone(base)
  for (const key of ['purchase', 'inventory', 'shipment']) {
    if (!src[key]) continue
    out[key].tableId = String(src[key].tableId || '').trim()
    out[key].fields = { ...out[key].fields, ...(src[key].fields || {}) }
  }
  return out
}

function hasRoleTable(tables, role) {
  return !!String(tables?.[role]?.tableId || '').trim()
}

function rememberConfig(config) {
  const next = {
    ...defaultFeishuConfig(),
    ...deepClone(config || {}),
    tables: normalizeTables(config?.tables),
    appToken: config?.appToken || APP_TOKEN,
  }
  configCache = next
  try {
    localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  return next
}

function readLocalConfigCache() {
  if (configCache?.tables) return configCache
  try {
    const raw = localStorage.getItem(CONFIG_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.tables) {
      configCache = rememberConfig(parsed)
      return configCache
    }
  } catch {
    /* ignore */
  }
  return null
}

async function readConfigViaStoreContent() {
  try {
    const res = await callCloudFunction('manageStoreContent', {
      action: 'getDoc',
      collection: 'configs',
      id: CONFIG_ID,
    })
    if (res?.success && res.data) return res.data
  } catch {
    /* getDoc 未部署或无权限时降级 */
  }
  return null
}

function candidateUrls() {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '')
  const urls = []
  // 生产：站点根 Cloudflare Function
  urls.push('/api/feishu-sync')
  // 本地 Vite Admin（base=/admin/）
  if (base && base !== '/') urls.push(`${base}/api/feishu-sync`)
  return [...new Set(urls)]
}

async function feishuApi(body) {
  const urls = candidateUrls()
  let lastErr
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const ctype = res.headers.get('content-type') || ''
      if (ctype.includes('text/html')) {
        lastErr = new Error(`${url} 未部署飞书代理（返回了 HTML）`)
        continue
      }
      const json = await res.json().catch(() => ({}))
      if (!res.ok && json.success !== false) {
        lastErr = new Error(`飞书代理 HTTP ${res.status}`)
        continue
      }
      // 代理已到达：业务失败不再换 URL
      if (json.success === false) {
        const err = new Error(json.msg || '飞书同步失败')
        err.fatal = true
        throw err
      }
      return json
    } catch (e) {
      if (e.fatal) throw e
      lastErr = e
    }
  }
  throw lastErr || new Error('飞书代理不可用')
}

export async function feishuProxyStatus() {
  for (const url of candidateUrls()) {
    try {
      const res = await fetch(url)
      const ctype = res.headers.get('content-type') || ''
      if (ctype.includes('text/html')) continue
      const json = await res.json()
      if (json && typeof json === 'object') return json
    } catch {
      /* try next */
    }
  }
  return {
    success: false,
    configured: false,
    msg: '飞书代理不可用。本地：在 admin/.env 配置 FEISHU_APP_ID/SECRET 后重启 npm run dev:admin；线上：Cloudflare Pages 环境变量 + 重新部署（含 functions/）。',
  }
}

function cellText(value) {
  if (value == null || value === '') return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) {
    return value
      .map((v) => (v && (v.text || v.name)) || (typeof v === 'string' || typeof v === 'number' ? String(v) : ''))
      .filter(Boolean)
      .join(',')
  }
  if (value.text) return String(value.text)
  if (value.name) return String(value.name)
  return String(value)
}

function cellNumber(value) {
  const n = Number(cellText(value).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

function pickField(fields, name) {
  if (!name) return undefined
  if (fields[name] !== undefined) return fields[name]
  const key = Object.keys(fields || {}).find((k) => k.trim() === String(name).trim())
  return key ? fields[key] : undefined
}

function mapRecord(rec, fieldMap) {
  const f = rec.fields || {}
  const out = { raw: f }
  for (const [key, colName] of Object.entries(fieldMap || {})) {
    const v = pickField(f, colName)
    out[key] = key === 'qty' || key === 'unitPrice' ? cellNumber(v) : cellText(v)
  }
  return out
}

/** 飞书记录 → managePurchaseOrder upsertFromFeishu 行 */
function toOpsPurchaseItem(rec, fieldMap) {
  const mapped = mapRecord(rec, fieldMap)
  return {
    feishuRecordId: rec.record_id || rec.recordId || '',
    recordId: rec.record_id || rec.recordId || '',
    orderNo: mapped.orderNo || '',
    itemName: mapped.skuName || mapped.itemName || '',
    skuName: mapped.skuName || '',
    qty: mapped.qty,
    unit: mapped.unit || '件',
    unitPrice: mapped.unitPrice || 0,
    supplier: mapped.supplier || '',
    status: mapped.status || '',
    date: mapped.date || '',
    purchaseDate: mapped.date || '',
    entityName: mapped.entityName || mapped.storeName || '',
    spec: mapped.spec || '',
    note: mapped.note || '',
  }
}

async function upsertOpsPurchasesFromFeishu(records, fieldMap) {
  const items = (records || []).map((rec) => toOpsPurchaseItem(rec, fieldMap))
  const res = await callCloudFunction(PURCHASE_FN, {
    action: 'upsertFromFeishu',
    items,
    defaultEntityId: 'studio_specimen',
  })
  if (!res || res.success === false) {
    throw new Error((res && res.msg) || '写入 ops_purchases 失败')
  }
  return res
}

/** 飞书记录 → manageStoreShipment upsertFromFeishu 行 */
function toOpsShipmentItem(rec, fieldMap) {
  const mapped = mapRecord(rec, fieldMap)
  return {
    feishuRecordId: rec.record_id || rec.recordId || '',
    recordId: rec.record_id || rec.recordId || '',
    shipmentNo: mapped.shipmentNo || mapped.orderNo || '',
    itemName: mapped.itemName || mapped.skuName || '',
    skuName: mapped.itemName || mapped.skuName || '',
    qty: mapped.qty,
    status: mapped.status || '',
    date: mapped.date || '',
    shipmentDate: mapped.date || '',
    storeName: mapped.storeName || mapped.entityName || '',
    note: mapped.note || '',
  }
}

async function upsertOpsShipmentsFromFeishu(records, fieldMap) {
  const items = (records || []).map((rec) => toOpsShipmentItem(rec, fieldMap))
  const res = await callCloudFunction(SHIPMENT_FN, {
    action: 'upsertFromFeishu',
    items,
    defaultStoreId: 'store_shanhaizaowu',
  })
  if (!res || res.success === false) {
    throw new Error((res && res.msg) || '写入 ops_shipments 失败')
  }
  return res
}

function buildPurchaseFeishuFields(row, fmap) {
  const fields = {}
  if (fmap.orderNo) fields[fmap.orderNo] = row.orderNo || ''
  if (fmap.skuName) fields[fmap.skuName] = row.itemName || ''
  if (fmap.qty) fields[fmap.qty] = Number(row.qty) || 0
  if (fmap.unit) fields[fmap.unit] = row.unit || ''
  if (fmap.unitPrice) fields[fmap.unitPrice] = Number(row.unitPrice) || 0
  if (fmap.supplier) fields[fmap.supplier] = row.supplier || ''
  if (fmap.status) fields[fmap.status] = row.statusLabel || row.status || ''
  if (fmap.date) fields[fmap.date] = row.purchaseDate || ''
  if (fmap.entityName) fields[fmap.entityName] = row.entityName || ''
  if (fmap.spec) fields[fmap.spec] = row.spec || ''
  if (fmap.note) fields[fmap.note] = row.note || ''
  return fields
}

function buildShipmentFeishuFields(row, item, fmap) {
  const fields = {}
  if (fmap.shipmentNo) fields[fmap.shipmentNo] = row.shipmentNo || ''
  if (fmap.orderNo) fields[fmap.orderNo] = row.shipmentNo || ''
  if (fmap.storeName) fields[fmap.storeName] = row.storeName || ''
  if (fmap.itemName) fields[fmap.itemName] = (item && item.itemName) || ''
  if (fmap.skuName) fields[fmap.skuName] = (item && item.itemName) || ''
  if (fmap.qty) fields[fmap.qty] = Number((item && item.qty) || row.totalQty) || 0
  if (fmap.status) fields[fmap.status] = row.statusLabel || row.status || ''
  if (fmap.date) fields[fmap.date] = row.shipmentDate || ''
  if (fmap.note) fields[fmap.note] = row.note || ''
  return fields
}

async function pullTable(role, col, tablesOverride = null) {
  const config = tablesOverride
    ? { ...defaultFeishuConfig(), tables: normalizeTables(tablesOverride) }
    : await readFeishuConfig()
  const spec = (config.tables || {})[role]
  if (!spec?.tableId) return { success: false, msg: `请先映射「${role}」表并保存` }
  const { records } = await feishuApi({ action: 'listRecords', tableId: spec.tableId })
  let upserted = 0
  for (const rec of records || []) {
    await upsertByRecordId(col, rec.record_id, mapRecord(rec, spec.fields))
    upserted += 1
  }
  return {
    success: true,
    stats: { pulled: (records || []).length, upserted },
    msg: `已同步 ${upserted} 条`,
    records,
    fieldMap: spec.fields || {},
  }
}

async function upsertByRecordId(col, recordId, data) {
  const found = await fetchCollectionWhere(col, { recordId }, 1)
  const payload = { ...data, recordId, syncedAt: Date.now() }
  if (found[0]?._id) {
    await cdnUpdate(col, found[0]._id, payload)
    return found[0]._id
  }
  await cdnAdd(col, payload)
}

async function logSync(action, result) {
  try {
    await cdnAdd(COLLECTIONS.FEISHU_SYNC_LOGS, {
      action,
      ok: !!result.success,
      message: result.msg || '',
      stats: result.stats || {},
      createdAt: Date.now(),
    })
  } catch {
    /* ignore */
  }
}

export async function readFeishuConfig() {
  // 1) 匿名 CDN 直读
  try {
    const doc = await cdnDocGet('configs', CONFIG_ID)
    if (doc?.tables && (hasRoleTable(doc.tables, 'purchase') || hasRoleTable(doc.tables, 'inventory') || hasRoleTable(doc.tables, 'shipment'))) {
      return rememberConfig(doc)
    }
    // 文档存在但 tableId 空：继续尝试管理端读 / 本地缓存
    if (doc?.tables) {
      const local = readLocalConfigCache()
      if (local && (hasRoleTable(local.tables, 'purchase') || hasRoleTable(local.tables, 'inventory'))) {
        return local
      }
    }
  } catch {
    /* 匿名常无 configs 读权限 */
  }

  // 2) 管理端 getDoc（manageStoreContent，需云函数已部署 getDoc）
  const viaFn = await readConfigViaStoreContent()
  if (viaFn?.tables && (hasRoleTable(viaFn.tables, 'purchase') || hasRoleTable(viaFn.tables, 'inventory') || hasRoleTable(viaFn.tables, 'shipment'))) {
    return rememberConfig(viaFn)
  }

  // 3) 同浏览器缓存（保存成功后 pull 立即可用）
  const cached = readLocalConfigCache()
  if (cached) return cached

  return defaultFeishuConfig()
}

function resolveTablesOverride(extra = {}) {
  const raw = extra.mapping?.tables || extra.mapping || extra.tables || null
  if (!raw || typeof raw !== 'object') return null
  const tables = normalizeTables(raw)
  if (
    hasRoleTable(tables, 'purchase') ||
    hasRoleTable(tables, 'inventory') ||
    hasRoleTable(tables, 'shipment')
  ) {
    rememberConfig({ tables, appToken: APP_TOKEN })
    return tables
  }
  return null
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
    products.find(
      (p) =>
        String(p.title || '').includes(row.skuName) ||
        name.includes(String(p.title || '').replace(/\s/g, '')),
    )
  return hit ? hit._id : null
}

export async function runFeishuSync(action, extra = {}) {
  let result
  try {
    switch (action) {
      case 'inspect': {
        const data = await feishuApi({ action: 'inspect' })
        result = { success: true, tables: data.tables || [], appToken: data.appToken }
        break
      }
      case 'getConfig':
        result = { success: true, config: await readFeishuConfig() }
        break
      case 'saveMapping': {
        const tables = normalizeTables(extra.mapping?.tables || extra.mapping || extra.tables)
        if (!hasRoleTable(tables, 'purchase') && !hasRoleTable(tables, 'inventory') && !hasRoleTable(tables, 'shipment')) {
          result = { success: false, msg: '映射为空：请先探测并选择飞书数据表' }
          break
        }
        const config = rememberConfig({
          tables,
          appToken: extra.mapping?.appToken || APP_TOKEN,
          updatedAt: Date.now(),
        })
        try {
          // 走 setDoc（feishu_bitable 已在白名单）；深拷贝去掉 Vue Proxy
          await cdnSet('configs', CONFIG_ID, deepClone(config))
          result = {
            success: true,
            config,
            msg: hasRoleTable(tables, 'purchase')
              ? '映射已保存（采购表已就绪）'
              : '映射已保存',
            persisted: {
              purchase: hasRoleTable(tables, 'purchase'),
              inventory: hasRoleTable(tables, 'inventory'),
              shipment: hasRoleTable(tables, 'shipment'),
            },
          }
        } catch (e) {
          // 本地缓存已写入；同步中心 pull 会带上 mapping / 读 cache，不阻断
          result = {
            success: true,
            config,
            cloudPersist: false,
            msg: `映射已保存到本地，可立即同步。云端写入稍后重试：${e.message || e}`,
            persisted: {
              purchase: hasRoleTable(tables, 'purchase'),
              inventory: hasRoleTable(tables, 'inventory'),
              shipment: hasRoleTable(tables, 'shipment'),
            },
          }
        }
        break
      }
      case 'pullPurchases': {
        const override = resolveTablesOverride(extra)
        const pulled = await pullTable('purchase', COLLECTIONS.FEISHU_PURCHASES, override)
        if (!pulled.success) {
          result = pulled
          break
        }
        // SSOT：同步写入 ops_purchases
        const ops = await upsertOpsPurchasesFromFeishu(pulled.records || [], pulled.fieldMap || {})
        result = {
          success: true,
          stats: {
            ...pulled.stats,
            opsCreated: ops.stats?.created || 0,
            opsUpdated: ops.stats?.updated || 0,
            opsSkipped: ops.stats?.skipped || 0,
          },
          msg: `镜像 ${pulled.stats.upserted} 条；账目库新建 ${ops.stats?.created || 0} / 更新 ${ops.stats?.updated || 0}`,
          ops,
        }
        break
      }
      case 'pushOpsPurchase': {
        resolveTablesOverride(extra)
        const config = await readFeishuConfig()
        const spec = (config.tables || {}).purchase
        if (!spec?.tableId) {
          result = { success: false, msg: '请先映射「采购」表并保存' }
          break
        }
        const row = extra.item || extra.row || null
        if (!row || !row._id) {
          result = { success: false, msg: '缺少采购记录 item' }
          break
        }
        const fmap = spec.fields || {}
        const fields = buildPurchaseFeishuFields(row, fmap)
        let rid = String(row.feishuRecordId || '').trim()
        if (rid) {
          await feishuApi({
            action: 'updateRecord',
            tableId: spec.tableId,
            recordId: rid,
            fields,
          })
        } else {
          const created = await feishuApi({
            action: 'createRecord',
            tableId: spec.tableId,
            fields,
          })
          rid = created.record?.record_id || created.record?.id || ''
          if (rid) {
            await callCloudFunction(PURCHASE_FN, {
              action: 'bindFeishuRecord',
              id: row._id,
              feishuRecordId: rid,
            })
          }
        }
        result = {
          success: true,
          feishuRecordId: rid,
          stats: { pushed: rid ? 1 : 0 },
          msg: rid ? `已回写飞书 ${rid}` : '飞书未返回 record_id',
        }
        break
      }
      case 'pullInventory': {
        const override = resolveTablesOverride(extra)
        const pulled = await pullTable('inventory', COLLECTIONS.FEISHU_INVENTORY, override)
        if (!pulled.success) {
          result = pulled
          break
        }
        const products = await fetchCollectionLimit('products', { limit: 400 })
        const rows = await fetchCollectionLimit(COLLECTIONS.FEISHU_INVENTORY, { limit: 400 })
        let matched = 0
        for (const row of rows) {
          const productId = matchProduct(row, products)
          if (productId && row.productId !== productId) {
            await cdnUpdate(COLLECTIONS.FEISHU_INVENTORY, row._id, { productId })
            matched += 1
          } else if (row.productId) matched += 1
        }
        result = {
          success: true,
          stats: { ...pulled.stats, matched },
          msg: `库存镜像 ${pulled.stats.upserted} 条，已映射藏品 ${matched} 条`,
        }
        break
      }
      case 'applyInventory': {
        const rows = await fetchCollectionLimit(COLLECTIONS.FEISHU_INVENTORY, { limit: 400 })
        let applied = 0
        let skipped = 0
        for (const row of rows) {
          if (!row.productId) {
            skipped += 1
            continue
          }
          const product = await cdnDocGet('products', row.productId)
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
          await cdnUpdate('products', row.productId, { stock: target })
          await cdnAdd(COLLECTIONS.STOCK_MOVEMENTS, {
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
          })
          applied += 1
        }
        result = { success: true, stats: { applied, skipped }, msg: `已应用 ${applied} 条，跳过 ${skipped} 条` }
        break
      }
      case 'pullShipments': {
        const override = resolveTablesOverride(extra)
        const pulled = await pullTable('shipment', COLLECTIONS.FEISHU_SHIPMENTS || 'feishu_shipments', override)
        if (!pulled.success) {
          result = pulled
          break
        }
        const ops = await upsertOpsShipmentsFromFeishu(pulled.records || [], pulled.fieldMap || {})
        result = {
          success: true,
          stats: {
            ...pulled.stats,
            opsCreated: ops.stats?.created || 0,
            opsUpdated: ops.stats?.updated || 0,
            opsSkipped: ops.stats?.skipped || 0,
          },
          msg: `镜像 ${pulled.stats.upserted} 条；出货库新建 ${ops.stats?.created || 0} / 更新 ${ops.stats?.updated || 0}`,
          ops,
        }
        break
      }
      case 'pushShipments':
      case 'pushOpsShipments': {
        resolveTablesOverride(extra)
        const config = await readFeishuConfig()
        const spec = (config.tables || {}).shipment
        if (!spec?.tableId) {
          result = { success: false, msg: '请先映射「出货」表并保存' }
          break
        }
        // SSOT：ops_shipments（小程序主录入）；按明细行回写飞书
        const listRes = await callCloudFunction(SHIPMENT_FN, {
          action: 'list',
          status: 'all',
          limit: 100,
        })
        const ships = (listRes && listRes.list) || []
        const pending = ships.filter((s) => s.status !== 'cancelled' && !s.feishuRecordId)
        const fmap = spec.fields || {}
        let pushed = 0
        for (const s of pending) {
          const items = Array.isArray(s.items) && s.items.length ? s.items : [{ itemName: '', qty: s.totalQty || 0 }]
          let firstRid = ''
          for (let i = 0; i < items.length; i += 1) {
            const it = items[i]
            if (it.feishuRecordId) continue
            const fields = buildShipmentFeishuFields(s, it, fmap)
            const created = await feishuApi({ action: 'createRecord', tableId: spec.tableId, fields })
            const rid = created.record?.record_id || created.record?.id || ''
            if (!rid) continue
            if (!firstRid) firstRid = rid
            await callCloudFunction(SHIPMENT_FN, {
              action: 'bindFeishuRecord',
              id: s._id,
              feishuRecordId: rid,
              itemIndex: i,
            })
            pushed += 1
          }
          if (firstRid && !s.feishuRecordId) {
            await callCloudFunction(SHIPMENT_FN, {
              action: 'bindFeishuRecord',
              id: s._id,
              feishuRecordId: firstRid,
            })
          }
        }
        result = {
          success: true,
          stats: { pushed },
          msg: `已回写 ${pushed} 条出货明细到飞书（SSOT: ops_shipments）`,
        }
        break
      }
      default:
        result = { success: false, msg: `未知 action: ${action}` }
    }
  } catch (e) {
    result = { success: false, msg: e.message || String(e) }
  }
  if (action !== 'getConfig') await logSync(action, result)
  return result
}
