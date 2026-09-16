import { fetchStoreData } from './storeData'
import { fetchFinancialData } from './financialData'
import { loadStoreBundle, storeLicenseAlertLevel, sumStoreNetRevenueForMonth } from './storeStorage'
import { loadPayrollBundle } from './payrollStorage'
import { fetchStaffDirectory, staffCountDisplay } from './staffDirectory.js'
import { callCloudFunction } from '../cloud.js'
import { resolveCostRate } from './storeData.js'
import { mapAnalyticsOrdersToAgg } from './dashboardMetrics.js'

/**
 * 经营口径的**权威来源**：`getAnalyticsDashboard`（全量订单，与小程序/驾驶舱同源）。
 * 详见 `src/utils/dataSources.js` 的 `order_metrics` 概念与 `METRIC_DIVERGENCES`。
 * 原实现用 `storeData` 的 `orders(limit:500)` 采样 + 本机财务账本，导致同一 ERP 里
 * 驾驶舱与决策中心对「本月营收」给出不同数字（实测决策中心显示 ¥0/0 单）。
 */
async function fetchAnalyticsReport(period) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - (period === 'month' ? 0 : 0), 1)
  const pad = (n) => String(n).padStart(2, '0')
  const startDate = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-01`
  const endDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  try {
    const res = await callCloudFunction('getAnalyticsDashboard', { action: 'report', startDate, endDate })
    if (!res || res.success === false || !res.data?.orders) {
      return { ok: false, error: res?.msg || 'getAnalyticsDashboard 未返回 orders', startDate, endDate }
    }
    const agg = mapAnalyticsOrdersToAgg(res.data.orders)
    return { ok: true, agg, data: res.data, startDate, endDate }
  } catch (e) {
    return { ok: false, error: e?.message || '经营口径加载失败', startDate, endDate }
  }
}

/**
 * 门店的**权威来源**：云端 `stores` 集合（规则 read: auth != null，ERP 可直接读）。
 * 原实现读本机 `sc_store_bundle_v1` → 决策中心显示「0 家门店」，而云端有店。
 */
async function fetchCloudStores() {
  try {
    const { fetchCollectionLimit } = await import('../cloud.js')
    const rows = await fetchCollectionLimit('stores', { limit: 500 })
    const list = Array.isArray(rows) ? rows : []
    return { ok: true, list, active: list.filter((s) => (s?.status || 'active') !== 'closed' && s?.isActive !== false).length }
  } catch (e) {
    return { ok: false, list: [], active: 0, error: e?.message || '门店集合读取失败' }
  }
}

export const OPS_LOW_STOCK_THRESHOLD = 5
export const OPS_OVER_STOCK_THRESHOLD = 50

function money(n) {
  return Number.isFinite(Number(n)) ? Number(n) : 0
}

/** 金额保留 2 位（KPI 上出现 ¥1,537.635 这种三位小数很难看，且与营收的位数不一致） */
function round2(n) {
  return Math.round(money(n) * 100) / 100
}

function currentYearMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function productTitle(product) {
  return product?.title || product?.name || product?.productName || '未命名商品'
}

function buildProductMetrics(products = []) {
  const list = Array.isArray(products) ? products : []
  const onShelf = list.filter((p) => p.isOnShelf !== false)
  const lowStock = list.filter((p) => {
    const stock = Number(p.stock) || 0
    return stock > 0 && stock < OPS_LOW_STOCK_THRESHOLD
  })
  const outOfStock = list.filter((p) => (Number(p.stock) || 0) <= 0)
  const overStock = list.filter((p) => (Number(p.stock) || 0) > OPS_OVER_STOCK_THRESHOLD)
  const stockValue = list.reduce((sum, p) => sum + money(p.price) * (Number(p.stock) || 0), 0)
  const bestSelling = [...list]
    .filter((p) => Number(p.salesCount) > 0)
    .sort((a, b) => (Number(b.salesCount) || 0) - (Number(a.salesCount) || 0))
    .slice(0, 10)
  const slowMoving = list
    .filter((p) => (Number(p.salesCount) || 0) <= 0 && p.isOnShelf !== false)
    .slice(0, 10)

  return {
    total: list.length,
    onShelf: onShelf.length,
    lowStock: lowStock.length,
    outOfStock: outOfStock.length,
    overStock: overStock.length,
    stockValue,
    bestSelling,
    slowMoving,
    lowStockProducts: lowStock.slice(0, 10),
    outOfStockProducts: outOfStock.slice(0, 10),
    overStockProducts: overStock.slice(0, 10),
    categories: [...new Set(list.map((p) => p.category).filter(Boolean))],
  }
}

function buildStoreMetrics(storeBundle, payrollBundle, yearMonth) {
  const stores = storeBundle.stores || []
  const employees = payrollBundle.employees || []
  const rankings = stores
    .map((store) => {
      const revenue = sumStoreNetRevenueForMonth(storeBundle, store.id, yearMonth)
      const staffCount = employees.filter((e) => e.storeId === store.id && e.status !== 'left').length
      const licenseAlert = storeLicenseAlertLevel(storeBundle, store.id)
      return {
        id: store.id,
        name: store.name || store.code || '未命名门店',
        code: store.code || '',
        status: store.status || 'unknown',
        revenue,
        staffCount,
        revenuePerStaff: staffCount > 0 ? revenue / staffCount : 0,
        licenseAlert,
      }
    })
    .sort((a, b) => b.revenue - a.revenue)

  return {
    total: stores.length,
    operating: stores.filter((s) => s.status === 'operating').length,
    licenseExpired: rankings.filter((s) => s.licenseAlert === 'expired').length,
    licenseSoon: rankings.filter((s) => s.licenseAlert === 'soon').length,
    rankings,
  }
}

function buildPayrollMetrics(payrollBundle, yearMonth) {
  const employees = payrollBundle.employees || []
  const activeEmployees = employees.filter((e) => e.status !== 'left')
  const slips = (payrollBundle.slips || []).filter((s) => s.yearMonth === yearMonth)
  const payrollCost = slips.reduce((sum, s) => sum + money(s.netPay ?? s.totalPay ?? s.grossPay), 0)
  return {
    employees: employees.length,
    activeEmployees: activeEmployees.length,
    storeClerks: activeEmployees.filter((e) => e.employeeType === 'store_clerk').length,
    slips: slips.length,
    payrollCost,
  }
}

function buildRisks({ products, stores, finance, payroll, staff }) {
  const risks = []
  if (products.outOfStock > 0) risks.push({ level: 'high', title: '缺货风险', desc: `${products.outOfStock} 个商品缺货，可能影响成交转化。` })
  if (products.lowStock > 0) risks.push({ level: 'medium', title: '低库存预警', desc: `${products.lowStock} 个商品库存低于 ${OPS_LOW_STOCK_THRESHOLD} 件。` })
  if (stores.licenseExpired > 0) risks.push({ level: 'high', title: '证照过期', desc: `${stores.licenseExpired} 家门店存在当前证照过期。` })
  if (stores.licenseSoon > 0) risks.push({ level: 'medium', title: '证照将过期', desc: `${stores.licenseSoon} 家门店存在证照临期。` })
  if (finance.revenue <= 0) risks.push({ level: 'medium', title: '营收账本缺失', desc: '当前周期未读取到有效财务营收，AI 建议可信度会下降。' })
  if (finance.authoritative === false) {
    risks.push({ level: 'medium', title: '经营口径回退到本机账本', desc: `未取到全量云口径（${finance.fallbackError || '原因未知'}），当前营收/订单数来自本机财务账本，与其他页面的全量口径可能不一致。` })
  }
  // 毛利用的是兜底成本率，而不是用户配的值 —— 必须单独报，否则「毛利」看起来是权威数字。
  // 注意用 `finance.costRate` 而不是外层 `costRate`：本函数是独立作用域，
  // 拿不到 buildOperationsDecisionData 里的局部常量（写成 costRate 会直接 ReferenceError，
  // 整个决策中心白屏 —— 这正是本轮 check:nav-dom 抓到的那次回归）。
  if (finance.costRateSource === 'default') {
    risks.push({ level: 'medium', title: '毛利用的是默认成本率', desc: `本机与云端都没有财务设置，毛利按默认成本率 ${(Number(finance.costRate || 0) * 100).toFixed(0)}% 粗估。请在财务模块设置成本率（设置仅存本机，换设备不会跟随）。` })
  }
  if (stores.authoritative === false) {
    risks.push({ level: 'medium', title: '门店数读取失败', desc: `未能读取云端 stores 集合（${stores.cloudError || '原因未知'}），门店数回落为本机档案包。` })
  }
  if (payroll.activeEmployees === 0) risks.push({ level: 'low', title: '薪酬花名册为空', desc: '未读取到薪酬花名册员工，暂无法计算人效（与小程序「员工」模块是两个来源）。' })
  // 读不到员工通讯录必须与「确实没有员工」分开报 —— 两者都表现为 0，这正是原缺陷的形态
  if (staff && !staff.ok) {
    risks.push({ level: 'medium', title: '员工通讯录读取失败', desc: `未能从云函数 manageStaff 读取员工（${staff.error || '原因未知'}）。卡片显示「—」而非 0，请勿据此判断没有员工。` })
  } else if (staff && staff.ok && staff.active === 0) {
    risks.push({ level: 'low', title: '员工通讯录为空', desc: '小程序超管工作台「员工」模块里没有任何生效员工。' })
  }
  return risks
}

function buildOpportunities({ products, stores, finance }) {
  const opportunities = []
  if (products.bestSelling.length > 0) {
    opportunities.push({
      title: '围绕热销品扩展组合',
      desc: `以「${productTitle(products.bestSelling[0])}」为核心设计套装、体验课或礼赠场景。`,
    })
  }
  if (stores.rankings[0]?.revenue > 0) {
    opportunities.push({
      title: '复制高营收门店打法',
      desc: `优先复盘「${stores.rankings[0].name}」的动线、陈列与人员配置。`,
    })
  }
  if (finance.averageOrderValue > 0) {
    opportunities.push({
      title: '提升客单价',
      desc: `当前客单价约 ¥${finance.averageOrderValue.toFixed(0)}，可测试加价购、组合销售与会员权益。`,
    })
  }
  return opportunities
}

function buildActionQueue({ products, stores, risks }) {
  const actions = []
  if (products.outOfStock > 0) actions.push('本周完成缺货商品补货或下架替换，避免前台继续承诺不可交付 SKU。')
  if (products.overStock > 0) actions.push('为高库存商品设计组合销售、限时折扣或内容种草清单。')
  if (stores.licenseExpired > 0 || stores.licenseSoon > 0) actions.push('将证照过期/临期门店列入运营风险周会，明确责任人与截止日期。')
  if (risks.length === 0) actions.push('暂无高优先级风险，建议用 AI 决策流生成下月增长实验清单。')
  return actions
}

/** 库存结构占比（与 buildProductMetrics 分类互斥） */
function buildInventoryViz(products) {
  const t = products.total || 0
  if (t === 0) {
    return { total: 0, segments: [] }
  }
  const normal = Math.max(0, t - products.outOfStock - products.lowStock - products.overStock)
  const raw = [
    { key: 'out', label: '缺货', value: products.outOfStock, tone: 'error' },
    { key: 'low', label: '低库存', value: products.lowStock, tone: 'warning' },
    { key: 'over', label: '高库存', value: products.overStock, tone: 'info' },
    { key: 'normal', label: '正常', value: normal, tone: 'success' },
  ]
  const segments = raw
    .filter((s) => s.value > 0)
    .map((s) => ({
      ...s,
      pct: (s.value / t) * 100,
    }))
  return { total: t, segments }
}

/** 门店营收横向对比条（相对 Top1） */
function buildStoreBars(rankings, limit = 6) {
  const top = (rankings || []).slice(0, limit)
  const max = Math.max(1, ...top.map((s) => s.revenue || 0))
  return top.map((s) => ({
    id: s.id,
    name: s.name,
    revenue: s.revenue || 0,
    staffCount: s.staffCount ?? 0,
    revenuePerStaff: s.revenuePerStaff ?? 0,
    barPct: ((s.revenue || 0) / max) * 100,
    licenseAlert: s.licenseAlert,
  }))
}

/** 账本周期内按日营收微型趋势（最多取末 14 条有数据的日） */
function buildFinanceTrend(records, limit = 14) {
  const list = Array.isArray(records) ? [...records] : []
  list.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
  const withRev = list.filter((r) => (Number(r.revenue) || 0) > 0 || (Number(r.orderCount) || 0) > 0)
  const slice = withRev.slice(-limit)
  const maxRev = Math.max(1, ...slice.map((r) => Number(r.revenue) || 0))
  return slice.map((r) => ({
    date: r.date,
    revenue: Number(r.revenue) || 0,
    orderCount: Number(r.orderCount) || 0,
    barPct: ((Number(r.revenue) || 0) / maxRev) * 100,
  }))
}

export async function buildOperationsDecisionData(options = {}) {
  const { products = [], orders = [], period = 'month' } = options
  const yearMonth = currentYearMonth()
  const [storeData, financialData, staff, analytics, cloudStores] = await Promise.all([
    fetchStoreData(false, { useFinancialData: true, period }),
    fetchFinancialData({ period }),
    // 与小程序超管工作台「员工」模块同源（manageStaff → staff_members）
    fetchStaffDirectory(),
    // 经营口径权威源（全量订单），与经营驾驶舱同源
    fetchAnalyticsReport(period),
    // 门店权威源（云端集合），替代本机 bundle
    fetchCloudStores(),
  ])
  const productSource = products.length ? products : (storeData?.products?.items || [])
  const orderSource = orders.length ? orders : (storeData?.orders?.items || [])
  const storeBundle = loadStoreBundle()
  const payrollBundle = loadPayrollBundle()
  const productMetrics = buildProductMetrics(productSource)
  const storeMetrics = buildStoreMetrics(storeBundle, payrollBundle, yearMonth)
  // 门店「总数」以云端集合为准（权威）；本机 bundle 只用于 HR 侧字段（证照、提点等）
  storeMetrics.cloudTotal = cloudStores.ok ? cloudStores.list.length : null
  storeMetrics.cloudActive = cloudStores.ok ? cloudStores.active : null
  storeMetrics.cloudError = cloudStores.ok ? null : cloudStores.error
  storeMetrics.displayTotal = cloudStores.ok ? cloudStores.list.length : storeMetrics.total
  storeMetrics.authoritative = cloudStores.ok
  const payrollMetrics = buildPayrollMetrics(payrollBundle, yearMonth)
  // 口径优先级：全量云口径 → 本机财务账本（明确标注「本机」，不再冒充权威）
  const aggTotals = analytics.ok ? (analytics.agg?.totals || {}) : null
  // 成本率来自财务参数（sc_finance_v12.settings / 云端 finance_settings）；与 storeData 共用同一个解析函数。
  // 必须带出处：没有财务设置的设备上会回落默认 25%，若仍写「按财务设置成本率」，
  // 用户读到的就是一个自己从未设置过、却被称作「财务设置」的数字（实测毛利差近一倍）。
  const cost = resolveCostRate(financialData?.settings)
  const costRate = cost.rate
  const costLabel = cost.source === 'setting'
    ? `按财务设置成本率 ${(costRate * 100).toFixed(1)}% 估算`
    : `未取到财务设置，按默认成本率 ${(costRate * 100).toFixed(0)}% 粗估（换设备/清缓存后本机设置不会跟随）`
  // 权威营收下必须**自己**推算成本/毛利：原先直接取 storeData.finance.grossProfit，
  // 而那份计算基于「本机账本营收」——账本为空时就会出现「营收 ¥2050、毛利 ¥0」这种同屏矛盾。
  const authoritativeRevenue = aggTotals ? money(aggTotals.netOnline ?? aggTotals.gmvPaid) : 0
  const authoritativeCost = authoritativeRevenue * costRate
  const finance = aggTotals
    ? {
        revenue: authoritativeRevenue,
        orderCount: Number(aggTotals.paid) || 0,
        // 本 KPI 的说明是「营收 / 订单数」，就用这两个权威值现算 ——
        // 原先取服务端 aov，而它的定义（毛 GMV/已付）与说明不一致，会出现
        // 「说明写营收/订单数、数字却对不上」的情况（实测 ¥189 vs 2050.18/12=¥171）。
        averageOrderValue: (Number(aggTotals.paid) || 0) > 0
          ? round2(authoritativeRevenue / (Number(aggTotals.paid) || 1))
          : money(aggTotals.aov),
        totalCost: round2(authoritativeCost),
        grossProfit: round2(authoritativeRevenue - authoritativeCost),
        profitMargin: authoritativeRevenue > 0 ? ((authoritativeRevenue - authoritativeCost) / authoritativeRevenue) * 100 : 0,
        costRate,
        trend: storeData?.finance?.trend || '暂无趋势',
        // 用**实际参与计算**的 costRate 生成文案：否则数字与口径说明可能各说各话
        costStructure: costLabel,
        costRateSource: cost.source,
        source: 'getAnalyticsDashboard',
        sourceLabel: `全量口径 ${analytics.startDate}~${analytics.endDate}`,
        records: financialData.records || [],
        authoritative: true,
      }
    : {
        revenue: money(storeData?.finance?.totalRevenue ?? financialData.revenue),
        orderCount: Number(financialData.orderCount ?? orderSource.length) || 0,
        averageOrderValue: money(storeData?.finance?.averageOrderValue ?? financialData.averageOrderValue),
        totalCost: money(storeData?.finance?.totalCost),
        grossProfit: money(storeData?.finance?.grossProfit),
        profitMargin: money(storeData?.finance?.profitMargin),
        trend: storeData?.finance?.trend || '暂无趋势',
        costStructure: storeData?.finance?.costStructure || costLabel,
        costRate,
        costRateSource: cost.source,
        source: 'local_ledger',
        // ⚠ 不再写死「财务账本」：本机账本 ≠ 云端财务账本，来源必须说清是本机
        sourceLabel: '本机财务账本（未取到全量云口径）',
        records: financialData.records || [],
        authoritative: false,
        fallbackError: analytics.error,
      }
  const kpis = [
    { key: 'revenue', label: '本月营收', value: `¥${finance.revenue.toLocaleString()}`, desc: finance.sourceLabel },
    { key: 'orders', label: '订单数', value: String(finance.orderCount), desc: finance.authoritative ? `全量口径（已付订单）${analytics.startDate}~${analytics.endDate}` : '本机财务账本（未取到全量云口径）' },
    { key: 'aov', label: '客单价', value: `¥${finance.averageOrderValue.toFixed(0)}`, desc: '营收 / 订单数' },
    { key: 'profit', label: '估算毛利', value: `¥${finance.grossProfit.toLocaleString()}`, desc: finance.costStructure },
    { key: 'stockRisk', label: '库存风险', value: String(productMetrics.lowStock + productMetrics.outOfStock), desc: '低库存 + 缺货' },
    {
      key: 'staff',
      label: '在职员工',
      value: staffCountDisplay(staff),
      desc: staff.ok
        ? `小程序超管工作台 · 员工（staff_members）${staff.truncated ? `，服务端上限 ${100} 条，实际可能更多` : ''}`
        : '员工通讯录读取失败，非 0',
    },
  ]
  const risks = buildRisks({ products: productMetrics, stores: storeMetrics, finance, payroll: payrollMetrics, staff })
  const opportunities = buildOpportunities({ products: productMetrics, stores: storeMetrics, finance })
  const inventoryViz = buildInventoryViz(productMetrics)
  const storeBars = buildStoreBars(storeMetrics.rankings, 6)
  const financeTrend = buildFinanceTrend(finance.records || [], 14)

  return {
    generatedAt: Date.now(),
    period,
    yearMonth,
    kpis,
    products: productMetrics,
    orders: { total: orderSource.length, items: orderSource },
    finance,
    stores: storeMetrics,
    payroll: payrollMetrics,
    staff: { ok: staff.ok, active: staff.active, disabled: staff.disabled, total: staff.total, truncated: staff.truncated, error: staff.error || null },
    risks,
    opportunities,
    inventoryViz,
    storeBars,
    financeTrend,
    actionQueue: buildActionQueue({ products: productMetrics, stores: storeMetrics, risks }),
    sourceHealth: [
      { name: '财务账本', status: finance.records.length > 0 ? 'ok' : 'empty', detail: `${finance.records.length} 条周期记录` },
      { name: '云商品/商品档案', status: productMetrics.total > 0 ? 'ok' : 'empty', detail: `${productMetrics.total} 个商品` },
      {
        name: '门店（云端集合）',
        status: !storeMetrics.authoritative ? 'error' : (storeMetrics.displayTotal > 0 ? 'ok' : 'empty'),
        detail: storeMetrics.authoritative
          ? `${storeMetrics.displayTotal} 家门店（stores 集合，${storeMetrics.cloudActive} 家生效）`
          : `读取失败：${storeMetrics.cloudError || '未知原因'}`,
      },
      { name: '门店本地档案包', status: storeMetrics.total > 0 ? 'ok' : 'empty', detail: `${storeMetrics.total} 家（本机 HR 侧档案，非 C 端事实源）` },
      {
        name: '员工通讯录',
        status: !staff.ok ? 'error' : (staff.active > 0 ? 'ok' : 'empty'),
        detail: staff.ok ? `${staff.active} 名生效员工（staff_members）` : `读取失败：${staff.error || '未知原因'}`,
      },
      { name: '薪酬花名册', status: payrollMetrics.activeEmployees > 0 ? 'ok' : 'empty', detail: `${payrollMetrics.activeEmployees} 名在职员工（本地 HR 花名册）` },
    ],
  }
}

export function operationsDataForPrompt(snapshot) {
  if (!snapshot) return '暂无运营数据快照'
  return JSON.stringify({
    period: snapshot.period,
    kpis: snapshot.kpis,
    finance: snapshot.finance,
    products: {
      total: snapshot.products.total,
      lowStock: snapshot.products.lowStock,
      outOfStock: snapshot.products.outOfStock,
      overStock: snapshot.products.overStock,
      bestSelling: snapshot.products.bestSelling.slice(0, 8).map((p) => ({
        title: productTitle(p),
        category: p.category,
        price: p.price,
        stock: p.stock,
        salesCount: p.salesCount,
      })),
      slowMoving: snapshot.products.slowMoving.slice(0, 8).map((p) => ({
        title: productTitle(p),
        category: p.category,
        price: p.price,
        stock: p.stock,
      })),
    },
    stores: snapshot.stores.rankings.slice(0, 8),
    payroll: snapshot.payroll,
    risks: snapshot.risks,
    opportunities: snapshot.opportunities,
    actionQueue: snapshot.actionQueue,
    sourceHealth: snapshot.sourceHealth,
    inventoryViz: snapshot.inventoryViz,
    storeBars: snapshot.storeBars,
    financeTrend: snapshot.financeTrend,
  }, null, 2)
}
