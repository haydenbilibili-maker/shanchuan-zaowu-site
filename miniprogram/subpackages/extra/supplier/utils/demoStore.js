/**
 * 超管本地演示开关 + 可连贯的演示状态机（仅 UI 验收）
 * 默认关；打开后用本地假数据预览列表，文案必须标「演示」。
 * 禁止当生产数据源；正式供应商账号不应看到此开关。
 * 演示流：待确认 →（确认）→ 待发货 →（回传）→ 已发货；结算摘要只读。
 */
const DEMO_KEY = 'supplier_ui_demo_v1'
const DEMO_STATE_KEY = 'supplier_ui_demo_state_v1'

const SEED_ORDERS = [
  {
    key: 'd1',
    status: 'pending_confirm',
    title: '干制蝴蝶 · 亚克力盒装',
    qtyLabel: '× 20',
    meta: '需求号 DEMO-1001 · 期望交期 10 日内',
    actionHint: '请确认可否接单与交期'
  },
  {
    key: 'd2',
    status: 'pending_confirm',
    title: '矿物标本 · 透明罩',
    qtyLabel: '× 8',
    meta: '需求号 DEMO-1002 · 期望交期 下月初',
    actionHint: '请确认可否接单与交期'
  },
  {
    key: 'd3',
    status: 'pending_ship',
    title: '干制蝴蝶 · 亚克力盒装',
    qtyLabel: '× 20',
    meta: '需求号 DEMO-0998 · 已确认',
    actionHint: '待您发货并回传运单'
  },
  {
    key: 'd4',
    status: 'shipped',
    title: '海洋生物 · 浸液瓶',
    qtyLabel: '× 12',
    meta: '需求号 DEMO-0980 · 顺丰 SFDEMO123',
    actionHint: '已发货',
    carrier: '顺丰速运',
    trackingNo: 'SFDEMO123'
  }
]

function readDemoOn() {
  try {
    return !!wx.getStorageSync(DEMO_KEY)
  } catch (e) {
    return false
  }
}

function writeDemoOn(on) {
  try {
    if (on) wx.setStorageSync(DEMO_KEY, 1)
    else wx.removeStorageSync(DEMO_KEY)
  } catch (e) { /* ignore */ }
}

function cloneSeed() {
  return SEED_ORDERS.map((r) => ({ ...r }))
}

function readDemoOrders() {
  try {
    const raw = wx.getStorageSync(DEMO_STATE_KEY)
    if (raw && Array.isArray(raw.orders) && raw.orders.length) {
      return raw.orders.map((r) => ({ ...r }))
    }
  } catch (e) { /* ignore */ }
  const orders = cloneSeed()
  writeDemoOrders(orders)
  return orders
}

function writeDemoOrders(orders) {
  try {
    wx.setStorageSync(DEMO_STATE_KEY, {
      orders: Array.isArray(orders) ? orders : [],
      updatedAt: Date.now()
    })
  } catch (e) { /* ignore */ }
}

function resetDemoState() {
  writeDemoOrders(cloneSeed())
}

function demoOrders() {
  return readDemoOrders()
}

function demoOrdersByStatus(status) {
  return demoOrders().filter((r) => r.status === status)
}

/** 演示：确认接单 → pending_ship */
function demoConfirmOrder(key) {
  const id = String(key || '').trim()
  const orders = readDemoOrders()
  const idx = orders.findIndex((r) => r.key === id)
  if (idx < 0) return { ok: false, msg: '未找到演示单' }
  const row = orders[idx]
  if (row.status !== 'pending_confirm') {
    return { ok: false, msg: '当前状态不可确认' }
  }
  orders[idx] = {
    ...row,
    status: 'pending_ship',
    meta: `${String(row.meta || '').split('·')[0].trim()} · 已确认`,
    actionHint: '待您发货并回传运单'
  }
  writeDemoOrders(orders)
  return { ok: true, order: orders[idx] }
}

/** 演示：回传运单 → shipped */
function demoShipOrder(key, carrier, trackingNo) {
  const id = String(key || '').trim()
  const c = String(carrier || '').trim() || '快递'
  const t = String(trackingNo || '').trim() || 'DEMO-TRACK'
  const orders = readDemoOrders()
  const idx = orders.findIndex((r) => r.key === id)
  if (idx < 0) return { ok: false, msg: '未找到演示单' }
  const row = orders[idx]
  if (row.status !== 'pending_ship') {
    return { ok: false, msg: '当前状态不可发货' }
  }
  orders[idx] = {
    ...row,
    status: 'shipped',
    carrier: c,
    trackingNo: t,
    meta: `${String(row.meta || '').split('·')[0].trim()} · ${c} ${t}`,
    actionHint: '已发货'
  }
  writeDemoOrders(orders)
  return { ok: true, order: orders[idx] }
}

function demoShipJobs() {
  return demoOrders()
    .filter((r) => r.status === 'pending_ship' || r.status === 'shipped')
    .map((r) => ({
      key: r.key,
      title: `${r.title} ${r.qtyLabel || ''}`.trim(),
      meta: r.meta,
      needShip: r.status === 'pending_ship',
      carrier: r.carrier || '',
      trackingNo: r.trackingNo || ''
    }))
}

function demoSettlements() {
  const shipped = demoOrders().filter((r) => r.status === 'shipped')
  const pendingShip = demoOrders().filter((r) => r.status === 'pending_ship')
  const rows = []
  if (shipped.length) {
    rows.push({
      key: 'b_shipped',
      title: '已发货待结算（演示）',
      amount: `约 ¥${shipped.length * 4800}`,
      statusLabel: '待结算',
      meta: `含 ${shipped.map((r) => r.key.toUpperCase()).join('、')} 共 ${shipped.length} 笔`
    })
  }
  if (pendingShip.length) {
    rows.push({
      key: 'b_pending',
      title: '待发货不计结算（演示）',
      amount: '—',
      statusLabel: '未计入',
      meta: `${pendingShip.length} 笔待发货，发货后进入结算摘要`
    })
  }
  if (!rows.length) {
    return [
      {
        key: 'b_empty',
        title: '本月演示结算',
        amount: '¥0',
        statusLabel: '暂无',
        meta: '确认并发货演示单后，这里会汇总'
      }
    ]
  }
  rows.push({
    key: 'b_hist',
    title: '2026年8月（演示历史）',
    amount: '¥9,600',
    statusLabel: '已结算',
    meta: '已于 9/5 确认到账'
  })
  return rows
}

module.exports = {
  DEMO_KEY,
  DEMO_STATE_KEY,
  readDemoOn,
  writeDemoOn,
  resetDemoState,
  demoOrders,
  demoOrdersByStatus,
  demoConfirmOrder,
  demoShipOrder,
  demoShipJobs,
  demoSettlements
}
