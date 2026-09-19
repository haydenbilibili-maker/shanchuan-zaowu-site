/**
 * Admin 飞书对接：
 * - 飞书 Open API：经 /api/feishu-sync（Cloudflare Function）或本地 Vite 代理
 * - 镜像 / 映射：CloudBase 匿名 SDK 直写
 * - 采购账目 SSOT：managePurchaseOrder → ops_purchases（飞书「采购记录」）
 * - 出货 SSOT：manageStoreShipment → ops_shipments（飞书「出货表」）
 * - 成品库存：manageStudioInventory → studio_inventory（飞书「成品库存」）
 * - 原材料库存：manageStudioRawInventory → studio_raw_inventory（飞书「库存管理」；多平台进货）
 * 勿将飞书「库存管理」同步进成品集合。
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
import { assertWriteApplied } from './cloudbaseCdnDb.js'

const CONFIG_ID = 'feishu_bitable'
const APP_TOKEN = 'WCs2bnIHsaty7vsjcnaczu0Wnod'
const PURCHASE_FN = 'managePurchaseOrder'
const SHIPMENT_FN = 'manageStoreShipment'
const FINISHED_INV_FN = 'manageStudioInventory'
const RAW_INV_FN = 'manageStudioRawInventory'
const CONFIG_CACHE_KEY = 'sc_feishu_bitable_config_v1'

/** 进程内缓存：UI「就绪」与 pull 校验共用，避免匿名读 configs 失败时假就绪 */
let configCache = null

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj || {}))
}

/**
 * 默认映射对齐 .base「标本工作室采购库存管理系统」
 * inventory = 成品库存；rawInventory = 飞书「库存管理」（原材料）
 */
function defaultFeishuConfig() {
  return {
    appToken: APP_TOKEN,
    tables: {
      purchase: {
        tableId: 'tblMHhGXhpmGTiI5',
        fields: {
          orderNo: '采购编号',
          skuName: '物品名称',
          qty: '数量',
          unitPrice: '单价',
          supplier: '供应商',
          status: '状态',
          date: '采购日期',
          entityName: '归属',
          spec: '规格型号',
          category: '分类',
          budgetType: '预算类型',
          platform: '采购平台',
          platformOrderNo: '平台订单号',
          expectedArrival: '预计到货',
          expressCompany: '快递公司',
          trackingNo: '运单号',
          invoiceNo: '发票号',
          note: '备注',
          // 2026-09-19：必须映射「总价」→ amount —— 退款冲正行的总价为负，
          // 只靠 数量×单价 表达不了（数量/单价有硬校验），会导致仪表盘与飞书对不上
          amount: '总价',
        },
      },
      /** 成品库存 → studio_inventory（飞书表名「成品库存」） */
      inventory: {
        tableId: 'tblh9wqtrQmZgRO5',
        fields: {
          skuName: '物品名称',
          itemName: '物品名称',
          framingSpec: '规格装裱',
          qty: '数量',
          date: '盘点日期',
          note: '备注',
        },
      },
      /** 原材料库存 → studio_raw_inventory（飞书表名「库存管理」） */
      rawInventory: {
        tableId: 'tblekBh0CRPMa7ie',
        fields: {
          inventoryNo: '库存编号',
          skuName: '物品名称',
          itemName: '物品名称',
          spec: '规格型号',
          category: '分类',
          qty: '当前库存',
          minQty: '最低库存预警',
          unitPrice: '单价',
          inboundTotal: '累计入库',
          outboundTotal: '累计出库',
          locationText: '存放位置',
          note: '备注',
        },
      },
      shipment: {
        tableId: 'tbl2lCz8GX2MVDnO',
        fields: {
          shipmentNo: '出货编号',
          storeName: '客户名称',
          customerName: '客户名称',
          itemName: '物品名称',
          spec: '规格型号',
          category: '分类',
          qty: '数量',
          unitPrice: '单价',
          totalPrice: '总价',
          status: '状态',
          date: '出货日期',
          expressCompany: '快递公司',
          trackingNo: '运单号',
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
  for (const key of ['purchase', 'inventory', 'rawInventory', 'shipment']) {
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
        credentials: 'include',
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
      const res = await fetch(url, { credentials: 'include' })
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

/** 飞书 DateTime 常为毫秒时间戳；出货/采购日期须落成 YYYY-MM-DD（按上海时区） */
function formatShanghaiYmd(ms) {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value
  return y && m && day ? `${y}-${m}-${day}` : ''
}

function cellDate(value) {
  if (value == null || value === '') return ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    return formatShanghaiYmd(value > 1e12 ? value : value * 1000)
  }
  const s = cellText(value).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s)
    return formatShanghaiYmd(n > 1e12 ? n : n * 1000)
  }
  return s
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
    out[key] =
      key === 'qty' ||
      key === 'unitPrice' ||
      key === 'minQty' ||
      key === 'inboundTotal' ||
      key === 'outboundTotal'
        ? cellNumber(v)
        : key === 'date' || key === 'expectedArrival' || key === 'inventoryDate' || key === 'shipmentDate'
          ? cellDate(v)
          : cellText(v)
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
    category: mapped.category || '',
    budgetType: mapped.budgetType || '',
    platform: mapped.platform || '',
    platformOrderNo: mapped.platformOrderNo || '',
    expectedArrival: mapped.expectedArrival || '',
    expressCompany: mapped.expressCompany || '',
    trackingNo: mapped.trackingNo || '',
    invoiceNo: mapped.invoiceNo || '',
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
    spec: mapped.spec || '',
    category: mapped.category || '',
    qty: mapped.qty,
    unitPrice: mapped.unitPrice || 0,
    status: mapped.status || '',
    date: mapped.date || '',
    shipmentDate: mapped.date || '',
    storeName: mapped.storeName || mapped.customerName || mapped.entityName || '',
    customerName: mapped.customerName || mapped.storeName || '',
    expressCompany: mapped.expressCompany || '',
    trackingNo: mapped.trackingNo || '',
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
  if (fmap.category) fields[fmap.category] = row.category || ''
  if (fmap.budgetType) fields[fmap.budgetType] = row.budgetType || ''
  if (fmap.platform) fields[fmap.platform] = row.platform || ''
  if (fmap.platformOrderNo) fields[fmap.platformOrderNo] = row.platformOrderNo || ''
  if (fmap.expectedArrival) fields[fmap.expectedArrival] = row.expectedArrival || ''
  if (fmap.expressCompany) fields[fmap.expressCompany] = row.expressCompany || ''
  if (fmap.trackingNo) fields[fmap.trackingNo] = row.trackingNo || ''
  if (fmap.invoiceNo) fields[fmap.invoiceNo] = row.invoiceNo || ''
  if (fmap.note) fields[fmap.note] = row.note || ''
  return fields
}

function buildShipmentFeishuFields(row, item, fmap) {
  const fields = {}
  if (fmap.shipmentNo) fields[fmap.shipmentNo] = row.shipmentNo || ''
  if (fmap.orderNo) fields[fmap.orderNo] = row.shipmentNo || ''
  if (fmap.storeName) fields[fmap.storeName] = row.customerName || row.storeName || ''
  if (fmap.customerName) fields[fmap.customerName] = row.customerName || row.storeName || ''
  if (fmap.itemName) fields[fmap.itemName] = (item && item.itemName) || ''
  if (fmap.skuName) fields[fmap.skuName] = (item && item.itemName) || ''
  if (fmap.spec) fields[fmap.spec] = (item && item.spec) || ''
  if (fmap.category) fields[fmap.category] = (item && item.category) || row.category || ''
  if (fmap.qty) fields[fmap.qty] = Number((item && item.qty) || row.totalQty) || 0
  /**
   * 单价 / 总价回写（裁决 17）。
   *
   * ⚠️ 修掉的既有 bug：原实现 `Number((item && item.unitPrice) || row.unitPrice) || 0` 有两处错：
   *   ① 多明细单的 `row.unitPrice` 是 **null**（本来就没有"单一单价"），经 `Number(null)` 变成 0
   *      写进飞书 —— 在飞书表里看起来像「**0 元成交**」；
   *   ② 末尾的 `|| 0` 把所有取不到值的情况都变成 0，同样是把「没有」说成「是 0」。
   * 现在改成：**取不到有效值就不写这个字段**，而不是写 0。
   */
  if (fmap.unitPrice) {
    const fromItem =
      item && item.unitPrice !== undefined && item.unitPrice !== null ? Number(item.unitPrice) : NaN
    const fromRow = row.unitPrice !== undefined && row.unitPrice !== null ? Number(row.unitPrice) : NaN
    const v = Number.isFinite(fromItem) ? fromItem : fromRow
    if (Number.isFinite(v)) fields[fmap.unitPrice] = v
  }
  // 总价：优先明细行的小计，其次单据总额（多明细单靠它才知道这一行值多少钱）
  if (fmap.totalPrice) {
    const fromItem =
      item && item.totalPrice !== undefined && item.totalPrice !== null ? Number(item.totalPrice) : NaN
    const fromRow =
      row.totalAmount !== undefined && row.totalAmount !== null ? Number(row.totalAmount) : NaN
    const v = Number.isFinite(fromItem) ? fromItem : fromRow
    if (Number.isFinite(v)) fields[fmap.totalPrice] = v
  }
  if (fmap.status) fields[fmap.status] = row.statusLabel || row.status || ''
  if (fmap.date) fields[fmap.date] = row.shipmentDate || ''
  if (fmap.expressCompany) fields[fmap.expressCompany] = row.expressCompany || ''
  if (fmap.trackingNo) fields[fmap.trackingNo] = row.trackingNo || ''
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
  let mirrorFailed = 0
  for (const rec of records || []) {
    try {
      await upsertByRecordId(col, rec.record_id, mapRecord(rec, spec.fields))
      upserted += 1
    } catch {
      // 镜像集合权限/缺失不应阻断 SSOT upsert（出货主库 ops_shipments）
      mirrorFailed += 1
    }
  }
  return {
    success: true,
    stats: { pulled: (records || []).length, upserted, mirrorFailed },
    msg: `已同步 ${upserted} 条` + (mirrorFailed ? `（镜像失败 ${mirrorFailed}）` : ''),
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

function configHasAnyTable(tables) {
  return (
    hasRoleTable(tables, 'purchase') ||
    hasRoleTable(tables, 'inventory') ||
    hasRoleTable(tables, 'rawInventory') ||
    hasRoleTable(tables, 'shipment')
  )
}

export async function readFeishuConfig() {
  // 1) 匿名 CDN 直读
  try {
    const doc = await cdnDocGet('configs', CONFIG_ID)
    if (doc?.tables && configHasAnyTable(doc.tables)) {
      return rememberConfig(doc)
    }
    // 文档存在但 tableId 空：继续尝试管理端读 / 本地缓存
    if (doc?.tables) {
      const local = readLocalConfigCache()
      if (local && configHasAnyTable(local.tables)) {
        return local
      }
    }
  } catch {
    /* 匿名常无 configs 读权限 */
  }

  // 2) 管理端 getDoc（manageStoreContent，需云函数已部署 getDoc）
  const viaFn = await readConfigViaStoreContent()
  if (viaFn?.tables && configHasAnyTable(viaFn.tables)) {
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
  if (configHasAnyTable(tables)) {
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
        if (!configHasAnyTable(tables)) {
          result = { success: false, msg: '映射为空：请先探测并选择飞书数据表' }
          break
        }
        const config = rememberConfig({
          tables,
          appToken: extra.mapping?.appToken || APP_TOKEN,
          updatedAt: Date.now(),
        })
        const persisted = {
          purchase: hasRoleTable(tables, 'purchase'),
          inventory: hasRoleTable(tables, 'inventory'),
          rawInventory: hasRoleTable(tables, 'rawInventory'),
          shipment: hasRoleTable(tables, 'shipment'),
        }
        try {
          // 走 setDoc（feishu_bitable 已在白名单）；深拷贝去掉 Vue Proxy
          await cdnSet('configs', CONFIG_ID, deepClone(config))
          result = {
            success: true,
            config,
            msg: hasRoleTable(tables, 'purchase')
              ? '映射已保存（采购表已就绪）'
              : '映射已保存',
            persisted,
          }
        } catch (e) {
          // 本地缓存已写入；同步中心 pull 会带上 mapping / 读 cache，不阻断
          result = {
            success: true,
            config,
            cloudPersist: false,
            msg: `映射已保存到本地，可立即同步。云端写入稍后重试：${e.message || e}`,
            persisted,
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
      case 'pullInventory':
      case 'pullFinishedInventory': {
        // 成品库存：飞书「成品库存」→ 镜像 + studio_inventory
        const override = resolveTablesOverride(extra)
        const pulled = await pullTable('inventory', COLLECTIONS.FEISHU_INVENTORY, override)
        if (!pulled.success) {
          result = pulled
          break
        }
        const items = (pulled.records || []).map((rec) => {
          const mapped = mapRecord(rec, pulled.fieldMap || {})
          return {
            feishuRecordId: rec.record_id || rec.recordId || '',
            itemName: mapped.itemName || mapped.skuName || '',
            skuName: mapped.skuName || mapped.itemName || '',
            framingSpec: mapped.framingSpec || mapped.spec || '',
            qty: mapped.qty,
            inventoryDate: mapped.date || '',
            note: mapped.note || '',
          }
        })
        let ops = { stats: {} }
        try {
          ops = await callCloudFunction(FINISHED_INV_FN, {
            action: 'upsertFromFeishu',
            items,
          })
        } catch (e) {
          ops = { success: false, msg: e.message || String(e), stats: {} }
        }
        result = {
          success: true,
          stats: {
            ...pulled.stats,
            opsCreated: ops.stats?.created || 0,
            opsUpdated: ops.stats?.updated || 0,
            opsSkipped: ops.stats?.skipped || 0,
          },
          msg: `成品库存镜像 ${pulled.stats.upserted} 条；台账新建 ${ops.stats?.created || 0} / 更新 ${ops.stats?.updated || 0}`,
          ops,
        }
        break
      }
      case 'pullRawInventory': {
        // 原材料：飞书「库存管理」→ studio_raw_inventory
        const override = resolveTablesOverride(extra)
        const pulled = await pullTable('rawInventory', 'feishu_raw_inventory', override)
        if (!pulled.success) {
          result = pulled
          break
        }
        const items = (pulled.records || []).map((rec) => {
          const mapped = mapRecord(rec, pulled.fieldMap || {})
          return {
            feishuRecordId: rec.record_id || rec.recordId || '',
            inventoryNo: mapped.inventoryNo || mapped.skuId || '',
            itemName: mapped.itemName || mapped.skuName || '',
            skuName: mapped.skuName || mapped.itemName || '',
            spec: mapped.spec || '',
            category: mapped.category || '',
            qty: mapped.qty,
            minQty: mapped.minQty,
            unitPrice: mapped.unitPrice,
            inboundTotal: mapped.inboundTotal,
            outboundTotal: mapped.outboundTotal,
            locationText: mapped.locationText || '',
            note: mapped.note || '',
          }
        })
        const ops = await callCloudFunction(RAW_INV_FN, {
          action: 'upsertFromFeishu',
          items,
        })
        if (!ops || ops.success === false) {
          throw new Error((ops && ops.msg) || '写入 studio_raw_inventory 失败')
        }
        result = {
          success: true,
          stats: {
            ...pulled.stats,
            opsCreated: ops.stats?.created || 0,
            opsUpdated: ops.stats?.updated || 0,
            opsSkipped: ops.stats?.skipped || 0,
          },
          msg: `原材料镜像 ${pulled.stats.upserted} 条；台账新建 ${ops.stats?.created || 0} / 更新 ${ops.stats?.updated || 0}`,
          ops,
        }
        break
      }
      case 'applyInventory': {
        const rows = await fetchCollectionLimit(COLLECTIONS.FEISHU_INVENTORY, { limit: 400 })
        let applied = 0
        let skipped = 0
        let failed = 0
        const failures = []
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
          // ⚠ 必须先确认库存**真的写进去了**，再记台账。
          //    `products` 线上规则是 write:false，而权限被拒时 SDK **不抛错**，只 resolve
          //    `{code:'DATABASE_PERMISSION_DENIED'}` —— 原实现既不校验、又照样写一条
          //    `stock_movements`（内容声称 current→target），于是台账会记录**一次并未发生的
          //    库存变动**，还报 `applied: N`。台账与实际背离比「台账为空」更危险。
          try {
            const res = await cdnUpdate('products', row.productId, { stock: target })
            assertWriteApplied('products', res, '飞书库存对齐')
          } catch (e) {
            failed += 1
            if (failures.length < 5) failures.push(`${row.skuName || row.productId}: ${e?.name || ''}${e?.message || e}`)
            continue // 库存没写进去 → 不记台账、不计入 applied
          }
          await cdnAdd(COLLECTIONS.STOCK_MOVEMENTS, {
            warehouseId: 'hq',
            productId: row.productId,
            skuId: row.skuId || null,
            skuName: product.title || row.skuName,
            delta,
            balanceAfter: target,
            type: 'feishu_pull',
            refType: 'feishu_finished_inventory',
            refId: row.recordId,
            note: `飞书成品库存对齐 ${row.skuName || ''} ${current}→${target}`,
            operator: 'feishu_sync',
            createdAt: Date.now(),
          })
          applied += 1
        }
        result = {
          // 有失败就是部分成功：如实返回 success:false，让调用方显示错误而不是「已完成」
          success: failed === 0,
          stats: { applied, skipped, failed },
          msg: failed === 0
            ? `已应用 ${applied} 条，跳过 ${skipped} 条`
            : `已应用 ${applied} 条，跳过 ${skipped} 条，**失败 ${failed} 条**（库存未写入，台账已跳过）`,
          ...(failures.length ? { failures } : {}),
        }
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
