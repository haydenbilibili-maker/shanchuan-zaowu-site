import { fetchStoreData } from './storeData'
import { fetchFinancialData } from './financialData'
import { loadStoreBundle, storeLicenseAlertLevel, sumStoreNetRevenueForMonth } from './storeStorage'
import { loadPayrollBundle } from './payrollStorage'

export const OPS_LOW_STOCK_THRESHOLD = 5
export const OPS_OVER_STOCK_THRESHOLD = 50

function money(n) {
  return Number.isFinite(Number(n)) ? Number(n) : 0
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

function buildRisks({ products, stores, finance, payroll }) {
  const risks = []
  if (products.outOfStock > 0) risks.push({ level: 'high', title: '缺货风险', desc: `${products.outOfStock} 个商品缺货，可能影响成交转化。` })
  if (products.lowStock > 0) risks.push({ level: 'medium', title: '低库存预警', desc: `${products.lowStock} 个商品库存低于 ${OPS_LOW_STOCK_THRESHOLD} 件。` })
  if (stores.licenseExpired > 0) risks.push({ level: 'high', title: '证照过期', desc: `${stores.licenseExpired} 家门店存在当前证照过期。` })
  if (stores.licenseSoon > 0) risks.push({ level: 'medium', title: '证照将过期', desc: `${stores.licenseSoon} 家门店存在证照临期。` })
  if (finance.revenue <= 0) risks.push({ level: 'medium', title: '营收账本缺失', desc: '当前周期未读取到有效财务营收，AI 建议可信度会下降。' })
  if (payroll.activeEmployees === 0) risks.push({ level: 'low', title: '人事数据缺失', desc: '未读取到在职员工，暂无法计算人效。' })
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
  const [storeData, financialData] = await Promise.all([
    fetchStoreData(false, { useFinancialData: true, period }),
    fetchFinancialData({ period }),
  ])
  const productSource = products.length ? products : (storeData?.products?.items || [])
  const orderSource = orders.length ? orders : (storeData?.orders?.items || [])
  const storeBundle = loadStoreBundle()
  const payrollBundle = loadPayrollBundle()
  const productMetrics = buildProductMetrics(productSource)
  const storeMetrics = buildStoreMetrics(storeBundle, payrollBundle, yearMonth)
  const payrollMetrics = buildPayrollMetrics(payrollBundle, yearMonth)
  const finance = {
    revenue: money(storeData?.finance?.totalRevenue ?? financialData.revenue),
    orderCount: Number(storeData?.finance?.weeklyOrdersCount ?? financialData.orderCount ?? orderSource.length) || 0,
    averageOrderValue: money(storeData?.finance?.averageOrderValue ?? financialData.averageOrderValue),
    totalCost: money(storeData?.finance?.totalCost),
    grossProfit: money(storeData?.finance?.grossProfit),
    profitMargin: money(storeData?.finance?.profitMargin),
    trend: storeData?.finance?.trend || '暂无趋势',
    costStructure: storeData?.finance?.costStructure || '暂无成本结构',
    source: storeData?.finance?.source || 'finance_ledger',
    sourceLabel: storeData?.finance?.sourceLabel || '财务账本',
    records: financialData.records || [],
  }
  const kpis = [
    { key: 'revenue', label: '本月营收', value: `¥${finance.revenue.toLocaleString()}`, desc: finance.sourceLabel },
    { key: 'orders', label: '订单数', value: String(finance.orderCount), desc: '财务账本/云订单' },
    { key: 'aov', label: '客单价', value: `¥${finance.averageOrderValue.toFixed(0)}`, desc: '营收 / 订单数' },
    { key: 'profit', label: '估算毛利', value: `¥${finance.grossProfit.toLocaleString()}`, desc: finance.costStructure },
    { key: 'stockRisk', label: '库存风险', value: String(productMetrics.lowStock + productMetrics.outOfStock), desc: '低库存 + 缺货' },
    { key: 'staff', label: '在职员工', value: String(payrollMetrics.activeEmployees), desc: '薪酬花名册' },
  ]
  const risks = buildRisks({ products: productMetrics, stores: storeMetrics, finance, payroll: payrollMetrics })
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
    risks,
    opportunities,
    inventoryViz,
    storeBars,
    financeTrend,
    actionQueue: buildActionQueue({ products: productMetrics, stores: storeMetrics, risks }),
    sourceHealth: [
      { name: '财务账本', status: finance.records.length > 0 ? 'ok' : 'empty', detail: `${finance.records.length} 条周期记录` },
      { name: '云商品/商品档案', status: productMetrics.total > 0 ? 'ok' : 'empty', detail: `${productMetrics.total} 个商品` },
      { name: '店铺本地包', status: storeMetrics.total > 0 ? 'ok' : 'empty', detail: `${storeMetrics.total} 家门店` },
      { name: '薪酬花名册', status: payrollMetrics.activeEmployees > 0 ? 'ok' : 'empty', detail: `${payrollMetrics.activeEmployees} 名在职员工` },
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
