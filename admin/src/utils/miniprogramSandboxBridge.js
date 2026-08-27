/**
 * 小程序订单/营收 + 线上能力估值 — 供资本架构沙盘同步
 * 数据来源：CloudBase orders 集合（需显式开启）；能力清单基于 miniprogram/ 代码盘点
 */
import { COLLECTIONS } from '../cloud.js'
import { fetchAllFromCollection } from './cloudbaseCdnDb.js'

/** 是否从 CloudBase orders 拉 TTM 订单/营收；默认 false（测试数据不计入估值锚点） */
export function isMiniprogramSandboxOrdersEnabled() {
  const raw = String(import.meta.env?.VITE_MINIPROGRAM_SANDBOX_USE_ORDERS ?? '').trim().toLowerCase()
  if (!raw) return false
  return raw === 'true' || raw === '1' || raw === 'yes'
}

const PAID_STATUSES = new Set([
  'paid',
  'shipped',
  'received',
  'completed',
  'refunding',
  'refunded',
  '已支付',
  '已完成',
])

/**
 * 已实现能力（miniprogram/app.json + pages/ + subpackages/ 盘点）
 * weight：战略溢价权重分；implemented 以代码存在为准
 */
export const MINIPROGRAM_CAPABILITIES = [
  {
    id: 'commerce',
    name: '交易闭环',
    desc: '商城 · 购物车 · 下单 · 支付 · 退款',
    evidence: 'pages/cart, subpackages/business/orders, confirm-order',
    weight: 15,
    implemented: true,
  },
  {
    id: 'booking',
    name: '到店预约',
    desc: '预约 · 候补 · 核销 · 电子票',
    evidence: 'subpackages/business/booking, ticket, my-bookings',
    weight: 10,
    implemented: true,
  },
  {
    id: 'member',
    name: '会员体系',
    desc: '积分 · 优惠券 · 成就 · 会员等级',
    evidence: 'subpackages/business/points, coupons, pages/user/achievements',
    weight: 12,
    implemented: true,
  },
  {
    id: 'content',
    name: '内容策展',
    desc: '文章 · 视频 · 社区 · 物种百科',
    evidence: 'pages/articles, videos, community, detail/wiki-detail',
    weight: 10,
    implemented: true,
  },
  {
    id: 'custom',
    name: '定制服务',
    desc: '企业团购 · 宠物纪念 · 名师选师',
    evidence: 'pages/custom/*, subpackages/business/framer',
    weight: 8,
    implemented: true,
  },
  {
    id: 'identify',
    name: 'AI 标本识别',
    desc: '拍照识物种 · 结果分享',
    evidence: 'pages/identify/*',
    weight: 8,
    implemented: true,
  },
  {
    id: 'ar',
    name: 'AR 试摆',
    desc: '家中预览标本摆放效果',
    evidence: 'subpackages/business/ar',
    weight: 6,
    implemented: true,
  },
  {
    id: 'store',
    name: '门店 LBS',
    desc: '这有店 · 展区 · 门店导航',
    evidence: 'pages/store, subpackages/business/store-zone',
    weight: 5,
    implemented: true,
  },
  {
    id: 'manager',
    name: '店长后台',
    desc: '账本 · 订单 · 核销 · 订货 · 人员',
    evidence: 'subpackages/business/manager/*',
    weight: 12,
    implemented: true,
  },
  {
    id: 'cloudbase',
    name: 'CloudBase 同步',
    desc: '与 ERP 共享云库 · 财务/store_ledger 桥接',
    evidence: 'cloudfunctions/syncFinanceData, utils/financeSync.js',
    weight: 8,
    implemented: true,
  },
  {
    id: 'care',
    name: '养护指南',
    desc: '藏品养护知识 · 我的养护记录',
    evidence: 'pages/care/*',
    weight: 4,
    implemented: true,
  },
  {
    id: 'collection',
    name: '数字藏品',
    desc: '会员数字藏品 · 证书',
    evidence: 'pages/collection/*, subpackages/business/certificate',
    weight: 6,
    implemented: true,
  },
]

function parseOrderTime(order) {
  const raw = order.payTime || order.createTime || order._createTime || 0
  if (typeof raw === 'number') return raw
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? 0 : d.getTime()
}

function isCountableOrder(order) {
  const status = String(order.status || '')
  if (!status) return false
  if (status === 'pending' || status === 'cancelled' || status === 'unpaid') return false
  return PAID_STATUSES.has(status) || /paid|ship|receive|complete|refund/i.test(status)
}

function orderAmount(order) {
  return Number(order.totalPrice ?? order.price ?? order.amount ?? 0) || 0
}

function buildPendingOrderMetrics(extra = {}) {
  return {
    orderCount: 0,
    totalOrderCount: 0,
    ttmRevenueYuan: 0,
    ttmRevenueWan: 0,
    isLive: false,
    status: 'pending',
    statusLabel: '待上线',
    dateFrom: null,
    dateTo: null,
    syncedAt: Date.now(),
    source: 'disabled',
    ordersEnabled: false,
    note: '测试订单不计入；上线后设置 VITE_MINIPROGRAM_SANDBOX_USE_ORDERS=true 开启统计',
    collection: COLLECTIONS.ORDERS,
    ...extra,
  }
}

/** 从 CloudBase orders 拉 TTM 订单数与营收；默认关闭，待小程序正式上线后开启 */
export async function fetchMiniprogramOrderMetrics() {
  if (!isMiniprogramSandboxOrdersEnabled()) {
    return buildPendingOrderMetrics()
  }

  try {
    const orders = await fetchAllFromCollection(COLLECTIONS.ORDERS, {
      orderField: '_createTime',
      direction: 'desc',
      maxRows: 3000,
    })

    const countable = orders.filter(isCountableOrder)
    const now = Date.now()
    const cutoff = now - 365 * 24 * 60 * 60 * 1000

    const ttmOrders = countable.filter((o) => {
      const t = parseOrderTime(o)
      return t >= cutoff && t <= now
    })
    const ttmRevenue = ttmOrders.reduce((s, o) => s + orderAmount(o), 0)
    const isLive = ttmOrders.length > 0 || ttmRevenue > 0

    let dateFrom = null
    let dateTo = null
    if (ttmOrders.length) {
      const times = ttmOrders.map(parseOrderTime).filter(Boolean)
      dateFrom = new Date(Math.min(...times)).toISOString().slice(0, 10)
      dateTo = new Date(Math.max(...times)).toISOString().slice(0, 10)
    }

    return {
      orderCount: ttmOrders.length,
      totalOrderCount: countable.length,
      ttmRevenueYuan: ttmRevenue,
      ttmRevenueWan: ttmRevenue / 10000,
      isLive,
      status: isLive ? 'live' : 'pending',
      statusLabel: isLive ? '已上线' : '待上线',
      dateFrom,
      dateTo,
      syncedAt: Date.now(),
      source: 'cloud-orders',
      ordersEnabled: true,
      collection: COLLECTIONS.ORDERS,
    }
  } catch (err) {
    return buildPendingOrderMetrics({
      source: 'cloud-orders',
      ordersEnabled: true,
      error: err?.message || String(err),
      note: 'orders 拉取失败，暂按 0 计',
    })
  }
}

/** 能力评分 → 数字化资产估值（万）；premiumCoeff 为可调假设系数 */
export function buildMiniprogramCapabilityValuation(premiumCoeff = 1.0) {
  const caps = MINIPROGRAM_CAPABILITIES.filter((c) => c.implemented)
  const maxScore = MINIPROGRAM_CAPABILITIES.reduce((s, c) => s + c.weight, 0)
  const score = caps.reduce((s, c) => s + c.weight, 0)
  const scorePct = maxScore > 0 ? score / maxScore : 0
  const coeff = Number(premiumCoeff) > 0 ? Number(premiumCoeff) : 1

  // 每权重分 2 万基准（系数 1.0）；能力清单驱动，非拍脑袋总额
  const baseValueWan = score * 2 * coeff

  return {
    capabilities: MINIPROGRAM_CAPABILITIES,
    implementedCount: caps.length,
    totalCount: MINIPROGRAM_CAPABILITIES.length,
    score,
    maxScore,
    scorePct,
    premiumCoeff: coeff,
    baseValueWan,
    valuationWan: baseValueWan,
    note: '能力基于 miniprogram/ 代码盘点；溢价系数为可调假设，非市场成交价',
  }
}

export async function readMiniprogramSandboxSnapshot(options = {}) {
  const { premiumCoeff = 1.0 } = options
  const [orders, capability] = await Promise.all([
    fetchMiniprogramOrderMetrics(),
    Promise.resolve(buildMiniprogramCapabilityValuation(premiumCoeff)),
  ])
  return {
    orders,
    capability,
    syncedAt: Date.now(),
    source: 'erp-miniprogram',
  }
}

export function pushMiniprogramSnapshotToIframe(iframeEl, snap = null) {
  if (!iframeEl?.contentWindow) return false
  try {
    iframeEl.contentWindow.postMessage({ type: 'erp-miniprogram-sync', payload: snap }, '*')
    return true
  } catch {
    return false
  }
}

export async function pushMiniprogramSnapshotToIframeAsync(iframeEl, options = {}) {
  const snap = await readMiniprogramSandboxSnapshot(options)
  pushMiniprogramSnapshotToIframe(iframeEl, snap)
  return snap
}
