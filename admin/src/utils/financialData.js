/**
 * 财务报表数据获取工具
 * 统一从财务报表（localStorage或云端）获取订单和营收数据
 */

import { loadStoreBundle, applyDefaultStoreToFinanceRecord } from './storeStorage.js'

/**
 * 读路径的**只读取新**：把云端权威（`finance_records` / `finance_settings`）拉进本机缓存。
 *
 * 背景（本轮实测）：ERP 里**只有 Finance 页**会 `autoSyncFinanceData()`，而所有取数页
 * （驾驶舱回退、运营决策中心、监控大屏、自定义报表、AI 优化）都只读本机 `shanhai_v12`。
 * 于是「同一个营收」在不同页面、不同设备上给出不同数字 —— 实测清空 localStorage 后，
 * 云端 `finance_records` 有 **308 行**，而监控大屏显示「财务账本暂无记录 / 今日营收 ¥0」。
 *
 * 所以把「先取新、再读数」收口到本模块：每次会话**最多拉一次**（memo 住 Promise，
 * 并发调用合并成一次请求）；**失败不锁定**，留给下一次读重试。
 * `readOnly:true` 保证读页面永不回写云端（理由见 `financeSync.syncFinanceRecords`）。
 */
let ledgerFreshPromise = null

export function ensureLedgerFresh({ force = false } = {}) {
  if (force) ledgerFreshPromise = null
  if (!ledgerFreshPromise) {
    ledgerFreshPromise = (async () => {
      try {
        const { autoSyncFinanceData } = await import('./financeSync.js')
        const res = await autoSyncFinanceData({ readOnly: true })
        const ok = res?.records?.success !== false
        if (!ok) ledgerFreshPromise = null
        return { ok, records: res?.records, settings: res?.settings }
      } catch (error) {
        console.warn('[financialData] 拉取云端财务权威失败，继续用本机缓存:', error)
        ledgerFreshPromise = null
        return { ok: false, error: String(error?.message || error) }
      }
    })()
  }
  return ledgerFreshPromise
}

/**
 * 从财务报表获取订单和营收数据
 * @param {Object} options - 配置选项
 * @param {string} options.period - 时间周期：'week' | 'month' | 'today'
 * @param {Date} options.startDate - 自定义开始日期
 * @param {Date} options.endDate - 自定义结束日期
 * @param {boolean} options.useCloud - 强制重新拉取云端权威（默认false，用会话内已拉过的那次）
 * @param {boolean} options.ensureFresh - 读之前是否先拉云端（默认true；测试可关掉）
 * @returns {Object} 财务数据对象
 */
export async function fetchFinancialData(options = {}) {
  const { useCloud = false, ensureFresh = true } = options

  try {
    // 先取新、再读数。否则「读到多少」取决于本浏览器上次访问 Finance 页的时间。
    if (ensureFresh) {
      await ensureLedgerFresh({ force: useCloud })
    }
    
    // 财务参数（成本率/月薪等）**先读**：它与「本地账本有没有记录」无关，
    // 而原先只在「有记录」的分支里读 → 本地账本为空时 settings 变 undefined，
    // 调用方 `normalizeCostRate(undefined)` 静默回落 25% 默认值，
    // 于是「用户在界面上设的成本率」永远不生效（且界面还写着「按财务设置成本率」）。
    const readFinanceSettings = () => {
      try {
        const raw = localStorage.getItem('sc_finance_v12')
        return raw ? (JSON.parse(raw).settings || {}) : {}
      } catch (e) {
        console.warn('读取财务参数失败', e)
        return {}
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
        period: options.period || 'week',
        // 即使没有账本记录也要返回参数，否则下游只能拿到默认值
        settings: readFinanceSettings()
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

    // 读取财务系统设置（与空账本分支同一实现，避免两处口径不一）
    const financeSettings = readFinanceSettings()

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
      settings: readFinanceSettings(),
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
    // 与 fetchFinancialData 共用同一套取新：财务参数是「多端同步」的（云端 finance_settings），
    // 只读本机缓存会让每台设备各用各的成本率（实测清空 localStorage 后毛利按 25% 默认值算）。
    await ensureLedgerFresh({ force: useCloud })
    
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

