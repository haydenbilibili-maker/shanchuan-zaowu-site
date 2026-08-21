/**
 * 门店数据获取工具
 * 统一的数据获取接口，供AI功能使用
 * 优化：订单数据优先从财务报表获取，确保数据一致性
 */
import { getCollectionData, countCollection, COLLECTIONS } from '../cloud'
import { fetchFinancialData } from './financialData'

export async function fetchStoreData(showMessage = false, options = {}) {
  const { useFinancialData = true, period = 'week' } = options
  try {
    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - now.getDay())
    weekStart.setHours(0, 0, 0, 0)
    const weekAgo = new Date(now)
    weekAgo.setDate(now.getDate() - 7)

    const results = await Promise.allSettled([
      getCollectionData(COLLECTIONS.PRODUCTS, { limit: 1000 }).catch(() => []),
      getCollectionData(COLLECTIONS.ORDERS, { limit: 500 }).catch(() => []),
      getCollectionData(COLLECTIONS.USERS, { limit: 1000 }).catch(() => []),
      getCollectionData(COLLECTIONS.ACTIVITIES, { limit: 100 }).catch(() => []),
      countCollection(COLLECTIONS.PRODUCTS).catch(() => 0),
      countCollection(COLLECTIONS.ORDERS).catch(() => 0),
      countCollection(COLLECTIONS.USERS).catch(() => 0)
    ])

    const products = results[0].status === 'fulfilled' ? results[0].value : []
    const orders = results[1].status === 'fulfilled' ? results[1].value : []
    const users = results[2].status === 'fulfilled' ? results[2].value : []
    const activities = results[3].status === 'fulfilled' ? results[3].value : []

    const normalizeCostRate = (value) => {
      const n = Number(value)
      if (!Number.isFinite(n) || n < 0) return 0.25
      return n > 1 ? n / 100 : n
    }

    const buildFinanceContract = (financialData, fallbackOrders = []) => {
      const records = Array.isArray(financialData?.records) ? financialData.records : []
      const revenue = Number(financialData?.revenue) || 0
      const orderCount = Number(financialData?.orderCount) || records.reduce((sum, r) => sum + (Number(r.orderCount) || 0), 0)
      const settings = financialData?.settings || {}
      const costRate = normalizeCostRate(settings.costRate ?? settings.setCostRate)
      const totalCost = revenue * costRate
      const grossProfit = revenue - totalCost
      const todayRevenue = Number(financialData?.today?.revenue) || 0
      const yesterdayRevenue = Number(financialData?.yesterday?.revenue) || 0
      const trend =
        todayRevenue > yesterdayRevenue ? '今日营收高于昨日'
          : todayRevenue < yesterdayRevenue ? '今日营收低于昨日'
            : todayRevenue > 0 ? '今日营收与昨日持平'
              : '暂无可比较的日营收'
      return {
        weeklyOrders: records,
        weeklyRevenue: revenue,
        averageOrderValue: financialData?.averageOrderValue || (orderCount > 0 ? revenue / orderCount : 0),
        totalRevenue: revenue,
        weeklyOrdersCount: orderCount || fallbackOrders.length,
        totalCost,
        grossProfit,
        profitMargin: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
        trend,
        costStructure: `按财务设置成本率 ${(costRate * 100).toFixed(1)}% 估算`,
        source: 'finance_ledger',
        sourceLabel: '财务账本',
        period: financialData?.period || period,
      }
    }

    // 优先从财务报表获取订单和营收数据（确保数据一致性）
    let weeklyOrders, weeklyRevenue, averageOrderValue, totalRevenue, financeContract
    
    if (useFinancialData) {
      const financialData = await fetchFinancialData({ period })
      financeContract = buildFinanceContract(financialData)
      weeklyOrders = financeContract.weeklyOrders
      weeklyRevenue = financeContract.weeklyRevenue
      averageOrderValue = financeContract.averageOrderValue
      totalRevenue = financeContract.totalRevenue
    } else {
      // 降级：从云数据库获取（兼容旧逻辑）
      weeklyOrders = orders.filter(o => {
        const orderTime = o.createTime || o._createTime || 0
        return orderTime >= weekAgo.getTime()
      })

      const paidOrders = orders.filter(o => {
        const status = o.status || ''
        return status === 'paid' || status === 'completed' || status === '已支付' || status === '已完成'
      })

      weeklyRevenue = paidOrders
        .filter(o => {
          const orderTime = o.createTime || o._createTime || 0
          return orderTime >= weekAgo.getTime()
        })
        .reduce((sum, o) => sum + (parseFloat(o.totalPrice || o.price || 0)), 0)

      averageOrderValue = weeklyOrders.length > 0 
        ? weeklyRevenue / weeklyOrders.length 
        : 0
        
      totalRevenue = paidOrders.reduce((sum, o) => sum + (parseFloat(o.totalPrice || o.price || 0)), 0)
      financeContract = {
        weeklyOrders,
        weeklyRevenue,
        weeklyOrdersCount: weeklyOrders.length,
        averageOrderValue,
        totalRevenue,
        totalCost: totalRevenue * 0.25,
        grossProfit: totalRevenue * 0.75,
        profitMargin: totalRevenue > 0 ? 75 : 0,
        trend: '使用云订单口径估算',
        costStructure: '未读取财务账本，按默认成本率 25.0% 估算',
        source: 'cloud_orders',
        sourceLabel: '云订单',
        period,
      }
    }

    const weeklyUsers = users.filter(u => {
      const userTime = u.createTime || u._createTime || 0
      return userTime >= weekAgo.getTime()
    })

    const lowStockProducts = products.filter(p => {
      const stock = parseInt(p.stock || 0)
      return stock > 0 && stock < 5
    })

    const outOfStockProducts = products.filter(p => {
      const stock = parseInt(p.stock || 0)
      return stock === 0
    })

    return {
      products: { total: products.length, items: products },
      orders: { total: orders.length, items: orders, weekly: weeklyOrders },
      users: { total: users.length, items: users, weekly: weeklyUsers },
      activities: { total: activities.length, items: activities },
      finance: {
        ...financeContract,
        weeklyRevenue,
        weeklyOrdersCount: financeContract.weeklyOrdersCount ?? weeklyOrders.length,
        averageOrderValue,
        totalRevenue
      },
      inventory: {
        totalProducts: products.length,
        lowStock: lowStockProducts.length,
        outOfStock: outOfStockProducts.length,
        lowStockProducts,
        outOfStockProducts
      },
      members: {
        total: users.length,
        weeklyNew: weeklyUsers.length,
        active: users.length, // 简化处理
        activeRate: 100
      }
    }
  } catch (error) {
    console.error('获取门店数据失败:', error)
    return null
  }
}



