/**
 * 财务报表数据获取工具
 * 统一从财务报表（localStorage或云端）获取订单和营收数据
 */

import { loadStoreBundle, applyDefaultStoreToFinanceRecord } from './storeStorage.js'

/**
 * 从财务报表获取订单和营收数据
 * @param {Object} options - 配置选项
 * @param {string} options.period - 时间周期：'week' | 'month' | 'today'
 * @param {Date} options.startDate - 自定义开始日期
 * @param {Date} options.endDate - 自定义结束日期
 * @param {boolean} options.useCloud - 是否优先从云端获取（默认false，使用本地缓存）
 * @returns {Object} 财务数据对象
 */
export async function fetchFinancialData(options = {}) {
  const { useCloud = false } = options
  
  try {
    // 如果需要从云端获取，先同步
    if (useCloud) {
      try {
        const { autoSyncFinanceData } = await import('./financeSync')
        await autoSyncFinanceData()
      } catch (error) {
        console.warn('从云端同步失败，使用本地数据:', error)
      }
    }
    
    // 读取财务报表数据（优先从localStorage，已通过同步更新）
    const financeRaw = localStorage.getItem('shanhai_v12')
    const rawList = financeRaw ? JSON.parse(financeRaw) : []
    const bundle = loadStoreBundle()
    const records = Array.isArray(rawList)
      ? rawList.map((r) => applyDefaultStoreToFinanceRecord(r && typeof r === 'object' ? { ...r } : r, bundle))
      : []
    
    if (!records || records.length === 0) {
      return {
        orderCount: 0,
        revenue: 0,
        averageOrderValue: 0,
        records: [],
        period: options.period || 'week'
      }
    }

    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]
    const currentMonth = todayStr.substring(0, 7)
    
    // 计算日期范围
    let startDate, endDate, period
    if (options.startDate && options.endDate) {
      // 自定义日期范围
      startDate = options.startDate.toISOString().split('T')[0]
      endDate = options.endDate.toISOString().split('T')[0]
      period = 'custom'
    } else {
      // 根据period计算
      period = options.period || 'week'
      switch (period) {
        case 'today':
          startDate = todayStr
          endDate = todayStr
          break
        case 'week':
          // 本周：从周一到今天
          const dayOfWeek = now.getDay()
          const monday = new Date(now)
          monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
          monday.setHours(0, 0, 0, 0)
          startDate = monday.toISOString().split('T')[0]
          endDate = todayStr
          break
        case 'month':
          // 本月：从1号到今天
          startDate = `${currentMonth}-01`
          endDate = todayStr
          break
        default:
          // 默认本周
          const defaultDayOfWeek = now.getDay()
          const defaultMonday = new Date(now)
          defaultMonday.setDate(now.getDate() - (defaultDayOfWeek === 0 ? 6 : defaultDayOfWeek - 1))
          defaultMonday.setHours(0, 0, 0, 0)
          startDate = defaultMonday.toISOString().split('T')[0]
          endDate = todayStr
          period = 'week'
      }
    }

    // 筛选时间范围内的记录
    const periodRecords = records.filter(r => {
      const recordDate = r.date
      return recordDate >= startDate && recordDate <= endDate
    })

    // 计算订单数和营收
    const orderCount = periodRecords.reduce((sum, r) => sum + (r.orderCount || 0), 0)
    const revenue = periodRecords.reduce((sum, r) => sum + (r.revenue || 0), 0)
    const averageOrderValue = orderCount > 0 ? (revenue / orderCount) : 0

    // 读取财务系统设置
    const settingsRaw = localStorage.getItem('sc_finance_v12')
    const financeSettings = settingsRaw ? JSON.parse(settingsRaw).settings : {}

    return {
      orderCount,
      revenue,
      averageOrderValue,
      period,
      startDate,
      endDate,
      records: periodRecords,
      settings: financeSettings,
      // 今日数据
      today: {
        orderCount: records.find(r => r.date === todayStr)?.orderCount || 0,
        revenue: records.find(r => r.date === todayStr)?.revenue || 0
      },
      // 昨日数据
      yesterday: {
        orderCount: records.find(r => {
          const yesterday = new Date(now)
          yesterday.setDate(now.getDate() - 1)
          return r.date === yesterday.toISOString().split('T')[0]
        })?.orderCount || 0,
        revenue: records.find(r => {
          const yesterday = new Date(now)
          yesterday.setDate(now.getDate() - 1)
          return r.date === yesterday.toISOString().split('T')[0]
        })?.revenue || 0
      }
    }
  } catch (error) {
    console.error('读取财务报表数据失败:', error)
    return {
      orderCount: 0,
      revenue: 0,
      averageOrderValue: 0,
      records: [],
      period: options.period || 'week',
      error: error.message
    }
  }
}

/**
 * 获取财务设置
 * @param {boolean} useCloud - 是否优先从云端获取
 * @returns {Object} 财务设置对象
 */
export async function getFinancialSettings(useCloud = false) {
  try {
    // 如果需要从云端获取，先同步
    if (useCloud) {
      try {
        const { autoSyncFinanceData } = await import('./financeSync')
        await autoSyncFinanceData()
      } catch (error) {
        console.warn('从云端同步设置失败，使用本地设置:', error)
      }
    }
    
    const settingsRaw = localStorage.getItem('sc_finance_v12')
    return settingsRaw ? JSON.parse(settingsRaw).settings : {}
  } catch (error) {
    console.error('读取财务设置失败:', error)
    return {}
  }
}

/**
 * 统一的数据获取函数（优先从财务报表获取订单数据）
 * @param {Object} options - 配置选项
 * @param {boolean} options.useFinancialData - 是否优先使用财务报表数据（默认true）
 * @param {string} options.period - 时间周期
 * @param {boolean} options.useCloud - 是否从云端获取（默认false）
 * @returns {Object} 统一的数据对象
 */
export async function fetchUnifiedData(options = {}) {
  const { useFinancialData = true, period = 'week', useCloud = false } = options
  
  // 从财务报表获取订单和营收数据
  const financialData = useFinancialData ? await fetchFinancialData({ period, useCloud }) : null
  
  // 如果需要其他实时数据（用户、收藏等），可以从云数据库获取
  // 这里暂时返回财务数据，其他数据可以通过 fetchStoreData 获取
  
  return {
    finance: {
      orderCount: financialData?.orderCount || 0,
      revenue: financialData?.revenue || 0,
      averageOrderValue: financialData?.averageOrderValue || 0,
      period: financialData?.period || period,
      records: financialData?.records || []
    },
    // 可以在这里添加其他数据源
    // users: ...,
    // products: ...,
  }
}

