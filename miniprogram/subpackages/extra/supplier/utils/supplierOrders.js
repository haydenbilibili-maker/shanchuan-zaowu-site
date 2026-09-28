/**
 * 第三方供货方 · 真数据最小契约（经云函数 payB2bPurchase.supplierList 读 purchase_orders）
 *
 * 假设（产品点名会默认，写死在此）：
 * - 集合仍用 purchase_orders，与买方→总部单隔离靠 party 字段
 * - party === 'supplier_fulfillment' 才对供货方可见
 * - supplierId === staff_members 上的 supplierId（或 openid 兜底）
 * - 禁止回挂 ops_* / purchase-ops / shipment-ops / studio-bills
 *
 * 演示数据仅超管 preview + demo 开关；正式 supplier 账号永远读云端（无行则空态）。
 */

const PARTY = 'supplier_fulfillment'

/** desk tab → 履约 status 集合 */
const TAB_STATUSES = {
  pending_confirm: ['submitted', 'pending_supplier_confirm'],
  pending_ship: ['confirmed', 'shipping'],
  shipped: ['shipped']
}

function mapRow(row) {
  if (!row) return null
  const st = String(row.status || '')
  let deskStatus = 'pending_confirm'
  if (TAB_STATUSES.pending_ship.indexOf(st) !== -1) deskStatus = 'pending_ship'
  else if (TAB_STATUSES.shipped.indexOf(st) !== -1) deskStatus = 'shipped'
  const items = Array.isArray(row.items) ? row.items : []
  const first = items[0] || {}
  const qty = items.reduce((s, it) => s + (parseInt(it.quantity, 10) || 0), 0)
  return {
    key: row._id,
    _id: row._id,
    orderNo: row.orderNo || '',
    status: deskStatus,
    rawStatus: st,
    title: first.name || row.storeName || '采购需求',
    qtyLabel: qty ? `× ${qty}` : '',
    meta: [
      row.orderNo ? `需求号 ${row.orderNo}` : '',
      row.expectedShipBy ? `期望交期 ${row.expectedShipBy}` : '',
      row.logisticsCarrier && row.logisticsTracking
        ? `${row.logisticsCarrier} ${row.logisticsTracking}`
        : ''
    ]
      .filter(Boolean)
      .join(' · '),
    actionHint:
      deskStatus === 'pending_confirm'
        ? '请确认可否接单与交期'
        : deskStatus === 'pending_ship'
          ? '待您发货并回传运单'
          : '已发货',
    carrier: row.logisticsCarrier || '',
    trackingNo: row.logisticsTracking || '',
    demoTag: false,
    canConfirm: deskStatus === 'pending_confirm',
    source: 'cloud'
  }
}

/**
 * @param {{ supplierId: string, tab?: string, limit?: number }} opts
 * @returns {Promise<{ ok: boolean, list: object[], msg?: string, code?: string }>}
 */
async function listSupplierOrders(opts) {
  const supplierId = String((opts && opts.supplierId) || '').trim()
  const tab = String((opts && opts.tab) || 'pending_confirm').trim()
  const limit = Math.min(80, Math.max(1, parseInt((opts && opts.limit) || 40, 10) || 40))
  if (!wx.cloud) {
    return { ok: false, list: [], code: 'NO_CLOUD', msg: '云能力不可用' }
  }
  // purchase_orders 对客户端只读本人单：供货需求由云函数按花名册 supplierId 查询（supplierId 仅超管预览时采信）
  try {
    const call = await wx.cloud.callFunction({
      name: 'payB2bPurchase',
      data: { action: 'supplierList', supplierId, tab, limit }
    })
    const r = (call && call.result) || {}
    if (!r.success) {
      return { ok: false, list: [], code: r.code || 'QUERY_FAIL', msg: r.msg || '读取供货需求失败' }
    }
    const list = (r.list || []).map(mapRow).filter(Boolean)
    return { ok: true, list, msg: r.msg || '' }
  } catch (e) {
    console.warn('listSupplierOrders', e)
    return {
      ok: false,
      list: [],
      code: 'QUERY_FAIL',
      msg: (e && (e.errMsg || e.message)) || '读取供货需求失败'
    }
  }
}

/**
 * 从角色解析 supplierId：优先 staff 行上的 supplierId，否则用 openid。
 */
function resolveSupplierId(role) {
  if (!role) return ''
  const sid = String(role.supplierId || '').trim()
  if (sid) return sid
  return String(role.openid || role._openid || '').trim()
}

module.exports = {
  PARTY,
  TAB_STATUSES,
  listSupplierOrders,
  resolveSupplierId,
  mapRow
}
