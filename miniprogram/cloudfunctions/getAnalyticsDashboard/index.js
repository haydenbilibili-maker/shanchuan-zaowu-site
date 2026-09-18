/**
 * 超管数据报表 · getAnalyticsDashboard
 * actions: overview | users | orders | catalog | report | behaviorSnippet（汇总）
 *
 * 周期参数：
 * - days（默认）：近 N 日，N∈[1,90]
 * - rangeType=month + yearMonth|year+month：公历自然月（月初～月末/今日）
 * - startDate + endDate：显式营业日闭区间（优先）
 *
 * 指标口径：
 * - 营业日：Asia/Shanghai（云函数默认 UTC，统一换算）
 * - 新增用户：users.createTime|registerTime|createdAt（库内多为 Date/serverDate）
 *   按东八区营业日 count；查询必须用 Date，勿用纯 number（否则恒为 0）
 * - DAU：优先 analytics_daily.uv[] 合并；否则 user_behaviors 采样去重
 * - 留存：日活用户次日 / 7 日回访率（非注册 cohort）
 * - 线上 GMV（毛）：paid|paid_awaiting_address|shipped|received|ready_pickup
 *   按 paidTime（无则 createTime）归入营业日；金额 = totalPrice 实付（含运费）
 *   排除 source=exchange；礼赠待填址计入；定金单与尾款单分别计入（不重复计货值）
 * - 周期退款：status∈refunded|refunding|expired_refunding|aftersales，按 refundTime（无则 updateTime/createTime）
 *   金额优先 refundAmount，否则 totalPrice
 * - 线上净额 = 周期毛 GMV − 周期退款（归属日可能跨期，见 notes）
 * - 门店账本：超管默认汇总 山川造物(store_shanhaizaowu+别名) + 星宸标本(store_xingchen)
 *   日净额按店相加；与线上分列，不把账本 online 当小程序 GMV
 * - 综合营收 = 线上净额 + 双店账本净额合计
 * - 品类：已付订单 products[].categoryType 金额占比
 * - 定金：deposit_intents 状态计数 + 已付定金金额
 * - 标本师提成：artisan_commission_ledger 周期 earn / reverse
 * - 信号灯 signals / trafficLights：综合营收环比、退款率、新增、双店账本、定金、提成冲回、低库存、1%应捐
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const PAID_STATUS = ['paid', 'paid_awaiting_address', 'shipped', 'received', 'ready_pickup']
const UNPAID_STATUS = ['pending_pay', 'void', 'cancelled', 'closed']
const REFUND_STATUS = ['refunded', 'refunding', 'expired_refunding', 'aftersales']
const FINANCE_STORE_ID = 'store_shanhaizaowu'
/** Admin 历史主店别名，与山川造物同实体，汇总时归入主店避免双计 */
const MAIN_STORE_ALIAS_IDS = ['store_1780146782017_6w0okpr']
/** 超管报表默认双店 */
const REPORT_STORES = [
  {
    storeId: 'store_shanhaizaowu',
    name: '山川造物',
    aliases: MAIN_STORE_ALIAS_IDS
  },
  {
    storeId: 'store_xingchen',
    name: '星宸标本',
    aliases: []
  }
]
// 采样上限一律来自单一真源（#26：此前各函数就地写数字，同一指标两个口径）
const {
  BEHAVIOR_SAMPLE_LIMIT,
  DAILY_ROLLUP_LIMIT,
  ORDER_SCAN_MAX,
  PRODUCT_SCAN_MAX,
  DEPOSIT_SCAN_MAX,
  COMMISSION_SCAN_MAX,
  USER_SCAN_MAX,
  ERROR_SCAN_MAX
} = require('./analyticsLimits')
const BEHAVIOR_SAMPLE = BEHAVIOR_SAMPLE_LIMIT
const LOW_STOCK_THRESHOLD = 3
const MS_DAY = 24 * 60 * 60 * 1000
const TZ_SHANGHAI = 8 * 60 * 60 * 1000

/**
 * C 端错误日志聚合（#26-B）。
 *
 * 背景：`logError` → `error_logs` 规则为 `read:false`（仅云函数可读写），
 * 且 `admin/src` 全目录**零引用** → C 端 JS 错误率在 ERP 完全不可见。
 * 本函数作为**只读代理**把聚合结果交给 ERP；`getAnalyticsDashboard` 已在 admin 代理白名单内，
 * 故**不新开云函数、不触发三处同步**，且鉴权口径与其它报表一致（staffGuard）。
 *
 * 只返回**聚合 + 少量样本**，不回传全量 stack（避免把日志集合当明细表拉爆带宽）。
 */
async function errorMetrics(event) {
  const startDate = normalizeDateStr(event.startDate)
  const endDate = normalizeDateStr(event.endDate)
  const notes = []
  let rows = []
  try {
    let query = db.collection('error_logs')
    if (startDate || endDate) {
      const startMs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : 0
      const endMs = endDate ? new Date(`${endDate}T23:59:59`).getTime() : Date.now()
      query = query.where({ timestamp: _.gte(startMs).and(_.lte(endMs)) })
    }
    const res = await query.orderBy('timestamp', 'desc').limit(ERROR_SCAN_MAX).get()
    rows = res.data || []
    if (rows.length >= ERROR_SCAN_MAX) notes.push(`错误日志已采样最近 ${ERROR_SCAN_MAX} 条`)
  } catch (e) {
    // 集合不存在 / 权限问题 → 明确报错，**不返回 0**（否则会被误读成「很健康」）
    return {
      available: false,
      error: (e && e.message) || 'error_logs 读取失败',
      notes: ['error_logs 不可读：请确认集合存在且云函数可访问']
    }
  }

  const byType = {}
  const byDate = {}
  const byPage = {}
  const byMessage = {}
  const users = new Set()
  rows.forEach((r) => {
    const type = String((r && r.type) || 'unknown')
    byType[type] = (byType[type] || 0) + 1
    const d = toBizDate(r && r.timestamp)
    if (d) byDate[d] = (byDate[d] || 0) + 1
    const page = String((r && r.page) || '').trim()
    if (page) byPage[page] = (byPage[page] || 0) + 1
    const msg = String((r && r.message) || '').slice(0, 120)
    if (msg) byMessage[msg] = (byMessage[msg] || 0) + 1
    if (r && r._openid) users.add(String(r._openid))
  })

  const sortDesc = (obj, n) =>
    Object.keys(obj)
      .map((k) => ({ key: k, count: obj[k] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, n)

  return {
    available: true,
    total: rows.length,
    affectedUsers: users.size,
    byType: sortDesc(byType, 10),
    byDate: Object.keys(byDate)
      .sort()
      .map((d) => ({ date: d, count: byDate[d] })),
    topPages: sortDesc(byPage, 10),
    topMessages: sortDesc(byMessage, 10),
    samples: rows.slice(0, 10).map((r) => ({
      type: r.type || '',
      message: String(r.message || '').slice(0, 200),
      page: r.page || '',
      stack: String(r.stack || '').slice(0, 300),
      time: r.timestamp || 0
    })),
    notes
  }
}

/**
 * 数据信号灯阈值（可解释、避免假精确）
 * 环比类：周期前后半日均对比（无需额外扫库）
 * 占比类：退款率 / 定金积压 / 提成冲回 / 双店结构
 */
const SIGNAL_RULES = {
  /** 环比下降：关注 / 告警 */
  momWarnPct: -5,
  momDangerPct: -20,
  /** 退款率 = 周期退款 / 毛 GMV */
  refundWarnPct: 8,
  refundDangerPct: 15,
  /** 定金待尾款占「已付定金漏斗」 */
  depositWarnPct: 40,
  depositDangerPct: 60,
  /** 提成冲回 / 计提 */
  commissionWarnPct: 20,
  commissionDangerPct: 40,
  /** 低库存 SKU 数（在架 1–LOW_STOCK_THRESHOLD） */
  stockWarn: 1,
  stockDanger: 8,
  /** 双店：单店占比 / 单店空账且对侧有额 */
  storeSkewWarnPct: 90,
  storeEmptyPeerMin: 100,
  /** 前后半对比最少天数 */
  halfMinDays: 4
}

const CATEGORY_LABELS = {
  INSECTA: '昆虫',
  MINERALS: '矿石',
  PLANTAE: '植物',
  MARINE: '海洋',
  ANIMALIA: '动物',
  GENERAL: '综合',
  FRAMING: '装裱',
  OTHER: '其他'
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function normalizeDateStr(date) {
  if (!date) return ''
  const m = String(date).trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (!m) return String(date).trim()
  return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`
}

function toBizDate(value) {
  if (value == null || value === '') return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const shifted = new Date(d.getTime() + TZ_SHANGHAI)
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
}

function bizDateStartMs(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map((x) => parseInt(x, 10))
  if (!y || !m || !d) return 0
  return Date.UTC(y, m - 1, d, 0, 0, 0, 0) - TZ_SHANGHAI
}

function bizDateEndMs(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map((x) => parseInt(x, 10))
  if (!y || !m || !d) return 0
  return Date.UTC(y, m - 1, d, 23, 59, 59, 999) - TZ_SHANGHAI
}

function addBizDays(dateKey, delta) {
  const ms = bizDateStartMs(dateKey) + delta * MS_DAY + TZ_SHANGHAI
  const shifted = new Date(ms)
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
}

function dateKeysBetween(startDate, endDate) {
  const keys = []
  let cur = startDate
  let guard = 0
  while (cur && endDate && cur <= endDate && guard < 370) {
    keys.push(cur)
    cur = addBizDays(cur, 1)
    guard += 1
  }
  return keys
}

/** 解析自然月：yearMonth=YYYY-MM 或 year + month（1–12）；缺省为东八区当月 */
function parseYearMonth(event) {
  const ymRaw = String(event.yearMonth || event.monthKey || '').trim()
  const ymMatch = ymRaw.match(/^(\d{4})-(\d{1,2})$/)
  if (ymMatch) {
    return { year: parseInt(ymMatch[1], 10), month: parseInt(ymMatch[2], 10) }
  }
  const y = parseInt(event.year, 10)
  const m = parseInt(event.month, 10)
  if (Number.isFinite(y) && y >= 2000 && y <= 2100 && Number.isFinite(m) && m >= 1 && m <= 12) {
    return { year: y, month: m }
  }
  const today = toBizDate(Date.now())
  return {
    year: parseInt(today.slice(0, 4), 10),
    month: parseInt(today.slice(5, 7), 10)
  }
}

/**
 * 自然月营业日区间：公历月初 00:00 ～ 月末（当月则截到今日）
 * Asia/Shanghai
 */
function parseMonthRange(event) {
  const { year, month } = parseYearMonth(event)
  const yearMonth = `${year}-${pad2(month)}`
  const startDate = `${yearMonth}-01`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  let endDate = `${yearMonth}-${pad2(lastDay)}`
  const today = toBizDate(Date.now())
  if (startDate > today) {
    return {
      startTs: bizDateStartMs(today),
      endTs: bizDateEndMs(today),
      days: 1,
      startDate: today,
      endDate: today,
      rangeType: 'month',
      yearMonth
    }
  }
  if (endDate > today) endDate = today
  const keys = dateKeysBetween(startDate, endDate)
  return {
    startTs: bizDateStartMs(startDate),
    endTs: bizDateEndMs(endDate),
    days: keys.length || 1,
    startDate,
    endDate,
    rangeType: 'month',
    yearMonth
  }
}

function parseRange(daysOrEvent = 7) {
  const event =
    daysOrEvent != null && typeof daysOrEvent === 'object' && !Array.isArray(daysOrEvent)
      ? daysOrEvent
      : { days: daysOrEvent }

  const rangeType = String(event.rangeType || '').trim().toLowerCase()
  // 显式自然月优先于 days；若同时带 startDate/endDate 则仍尊重显式日期（便于联调）
  const startDate = normalizeDateStr(event.startDate)
  const endDate = normalizeDateStr(event.endDate)
  if (startDate && endDate && startDate <= endDate) {
    const keys = dateKeysBetween(startDate, endDate)
    const ym =
      rangeType === 'month'
        ? `${startDate.slice(0, 7)}`
        : String(event.yearMonth || '').trim() || undefined
    return {
      startTs: bizDateStartMs(startDate),
      endTs: bizDateEndMs(endDate),
      days: keys.length || 1,
      startDate,
      endDate,
      rangeType: rangeType === 'month' ? 'month' : rangeType === 'days' ? 'days' : 'custom',
      yearMonth: ym
    }
  }

  if (rangeType === 'month') {
    return parseMonthRange(event)
  }

  const d = Math.min(Math.max(parseInt(event.days, 10) || 7, 1), 90)
  const endKey = toBizDate(Date.now())
  const startKey = addBizDays(endKey, -(d - 1))
  return {
    startTs: bizDateStartMs(startKey),
    endTs: bizDateEndMs(endKey),
    days: d,
    startDate: startKey,
    endDate: endKey,
    rangeType: 'days'
  }
}

function dateKeysInRange(startTs, endTs) {
  return dateKeysBetween(toBizDate(startTs), toBizDate(endTs))
}

function dayBoundsFromKey(dateKey) {
  return { startTs: bizDateStartMs(dateKey), endTs: bizDateEndMs(dateKey) }
}

function toMs(v) {
  if (v == null) return 0
  if (typeof v === 'number') return v
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'object' && v.$date) return new Date(v.$date).getTime()
  const n = Date.parse(v)
  return Number.isFinite(n) ? n : 0
}

function parseOrderAmount(order) {
  if (!order) return 0
  const raw = order.totalPrice ?? order.payAmount ?? order.amount ?? 0
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  const n = parseFloat(String(raw).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

function parseRefundAmount(order) {
  if (!order) return 0
  const raw = order.refundAmount ?? order.refundFen
  if (raw != null && raw !== '') {
    if (typeof raw === 'number') {
      // 偶发以「分」存储
      if (raw > 0 && Number.isInteger(raw) && raw >= 1000 && !order.refundAmount) {
        return Math.round(raw) / 100
      }
      return Number.isFinite(raw) ? raw : 0
    }
    const n = parseFloat(String(raw).replace(/,/g, ''))
    if (Number.isFinite(n)) return n
  }
  return parseOrderAmount(order)
}

function fmtMoney(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0.00'
  return v.toFixed(2)
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function ledgerNet(doc) {
  const pos = Number(doc.pos) || 0
  const online = Number(doc.online) || 0
  const refund = Number(doc.refundAmount ?? doc.refund) || 0
  const hasBalance =
    doc.cashBalance != null &&
    doc.cashBalance !== '' &&
    Number.isFinite(Number(doc.cashBalance))
  const cashIncome = hasBalance
    ? Number(doc.cashIncome) || 0
    : Number(doc.cashIncome ?? doc.cash) || 0
  const netField = Number(doc.netAmount ?? doc.revenue ?? doc.total) || 0
  if (pos || online || cashIncome || refund) {
    return Math.max(0, pos + online + cashIncome - refund)
  }
  return netField
}

function isExchangeOrder(order) {
  return String((order && order.source) || '') === 'exchange'
}

function isDepositOrder(order) {
  if (!order) return false
  return order.orderType === 'deposit' || order.source === 'deposit'
}

function isDepositBalanceOrder(order) {
  if (!order) return false
  return (
    order.orderType === 'deposit_balance' ||
    order.source === 'deposit_balance' ||
    (!!order.depositIntentId && Number(order.depositCredit) > 0 && !isDepositOrder(order))
  )
}

function isGiftOrder(order) {
  if (!order) return false
  return order.source === 'gift' || !!(order.giftMeta && typeof order.giftMeta === 'object')
}

function orderSourceBucket(order) {
  if (isDepositOrder(order)) return 'deposit'
  if (isDepositBalanceOrder(order)) return 'deposit_balance'
  if (isGiftOrder(order)) return 'gift'
  if (String(order.source || '') === 'custom') return 'custom'
  return 'commerce'
}

function categoryLabel(key) {
  const k = String(key || 'OTHER').toUpperCase()
  return CATEGORY_LABELS[k] || key || '其他'
}

function resolveStoreScope(event, actor) {
  const requested = String((event && event.storeId) || '').trim()
  const isSuper = !!(actor && (actor.superAdmin || (actor.roles || []).indexOf('super_admin') !== -1))
  const allowed = (actor && actor.storeIds) || []

  if (requested) {
    if (!isSuper && allowed.length && allowed.indexOf(requested) === -1) {
      return { storeId: allowed[0] || FINANCE_STORE_ID, mode: 'single', restricted: true }
    }
    return { storeId: requested, mode: 'single', restricted: false }
  }

  if (isSuper || !allowed.length) {
    return { storeId: FINANCE_STORE_ID, mode: 'all', restricted: false }
  }
  return { storeId: allowed[0] || FINANCE_STORE_ID, mode: 'single', restricted: false }
}

function orderMatchesStore(order, scope) {
  if (!scope || scope.mode === 'all') return true
  const target = String(scope.storeId || '')
  if (!target) return true
  const sid = String((order && order.storeId) || '')
  if (!sid) {
    // 快递单常无 storeId：归入主店，避免门店视图漏计线上
    return target === FINANCE_STORE_ID
  }
  if (sid === target) return true
  const MAIN_ALIASES = [FINANCE_STORE_ID, 'main', 'default'].concat(MAIN_STORE_ALIAS_IDS)
  if (MAIN_ALIASES.indexOf(target) !== -1 && MAIN_ALIASES.indexOf(sid) !== -1) return true
  return false
}

function aggregateRows(rows) {
  const byAction = {}
  const byModule = {}
  const byPage = {}
  const users = new Set()
  const byDay = {}

  rows.forEach((r) => {
    const action = r.action || 'unknown'
    const module = r.module || 'system'
    const page = r.page || ''
    const dk = r.dateKey || ''
    if (r.userId) users.add(r.userId)

    byAction[action] = (byAction[action] || 0) + 1
    byModule[module] = (byModule[module] || 0) + 1
    if (page) byPage[page] = (byPage[page] || 0) + 1
    if (dk) byDay[dk] = (byDay[dk] || 0) + 1
  })

  const toSorted = (obj, limit = 15) =>
    Object.keys(obj)
      .map((k) => ({ key: k, count: obj[k] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)

  return {
    totalEvents: rows.length,
    uniqueUsers: users.size,
    pageViews: byAction.page_view || 0,
    byAction: toSorted(byAction, 20),
    byModule: toSorted(byModule, 12),
    byPage: toSorted(byPage, 15),
    byDay: toSorted(byDay, 31)
  }
}

function buildFunnel(rows) {
  const count = (action) => rows.filter((r) => r.action === action).length
  const countStep = (step) =>
    rows.filter((r) => r.action === 'identify_save_atlas_gate' && r.step === step).length
  const pct = (part, total) => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0)

  /**
   * 祈福墙：**按 action + step 分桶**（与 identify 同一套写法）。
   *
   * ⚠️ 2026-09-18 产品反馈「数据报表里没有祈福墙数据」：这一段以前根本不存在 ——
   * 报表只算了 identify / store / commerce，于是祈福墙的注册转化在新加坡…不，是在**小程序数据报表里完全看不到**。
   * 现在补齐：进墙 → 落愿遇注册钩子（曝光/去注册/失败/先不挂/完成续发）→ 落愿成功。
   * 口径与 ERP 侧「祈福墙 · 注册转化监测表」一致（同一批 action/step），两边数字必须能对上。
   */
  const wallStep = (step) =>
    rows.filter((r) => r.action === 'wish_wall_register_gate' && r.step === step).length
  const wallFail = rows.filter(
    (r) => r.action === 'wish_wall_register_gate' && String(r.step || '').startsWith('fail_')
  ).length
  const wallEnter = count('wish_wall_enter')
  const wallGateShow = wallStep('show')
  const wallGateGo = wallStep('go_register')
  const wallGateDismiss = wallStep('dismiss')
  const wallGateResume = wallStep('resume_success')
  const wallPost = rows.filter(
    (r) => r.action === 'wish_wall_post' && String(r.targetId || '') === 'ok'
  ).length
  const wallEngage = count('wish_wall_lamp') + count('wish_wall_play') + count('wish_wall_sound')

  // AI 识别「保存图鉴」注册钩子漏斗：show（弹窗）→ go_register（去注册）/ dismiss（暂不保存）
  // → resume_success（注册完成后自动续写成功）
  const gateShow = countStep('show')
  const gateGo = countStep('go_register')
  const gateDismiss = countStep('dismiss')
  const gateResume = countStep('resume_success')

  /** 任意注册钩子 → 同一套口径（曝光/去注册/放弃/完成 + 四个比率） */
  const gateBlock = (action) => {
    const n = (step) => rows.filter((r) => r.action === action && r.step === step).length
    const show = n('show')
    const go = n('go_register')
    const dismiss = n('dismiss')
    const resume = n('resume_success')
    return {
      show,
      goRegister: go,
      dismiss,
      resumeSuccess: resume,
      goRate: pct(go, show),
      dismissRate: pct(dismiss, show),
      completeRate: pct(resume, show),
      resumeRate: pct(resume, go)
    }
  }

  return {
    identify: {
      entry: count('identify_entry_click'),
      start: count('identify_start'),
      success: count('identify_success'),
      resultView: count('identify_result_view'),
      saveAtlas: count('identify_save_atlas'),
      gate: {
        show: gateShow,
        goRegister: gateGo,
        dismiss: gateDismiss,
        resumeSuccess: gateResume,
        // 去注册率 / 放弃率 / 完成率（相对曝光），完成率（相对去注册）
        goRate: pct(gateGo, gateShow),
        dismissRate: pct(gateDismiss, gateShow),
        completeRate: pct(gateResume, gateShow),
        resumeRate: pct(gateResume, gateGo)
      },
      // 「看结果注册钩子」：客户端一直在发（show/go_register/dismiss/resume_success），
      // 但报表只算了「保存图鉴」那个 —— 同一类漏（2026-09-18 与祈福墙一起补齐）
      resultGate: gateBlock('identify_result_gate')
    },
    wishWall: {
      enter: wallEnter,
      engage: wallEngage,
      post: wallPost,
      // 落愿成功占进墙（整条链路的终点）
      postRate: pct(wallPost, wallEnter),
      gate: {
        show: wallGateShow,
        goRegister: wallGateGo,
        dismiss: wallGateDismiss,
        fail: wallFail,
        resumeSuccess: wallGateResume,
        // 与 identify 钩子同一口径：三个分流相对**曝光**；完成率另给"相对去注册"一档
        goRate: pct(wallGateGo, wallGateShow),
        dismissRate: pct(wallGateDismiss, wallGateShow),
        failRate: pct(wallFail, wallGateShow),
        completeRate: pct(wallGateResume, wallGateShow),
        resumeRate: pct(wallGateResume, wallGateGo)
      },
      // 祈福墙「连续记录云保存」注册钩子（2026-09-20）：action 是 wish_ritual_gate，
      // 与落愿钩子共用 gateBlock 的同一套口径（曝光/去注册/放弃/完成 + 四个比率）。
      // 不在这里分桶 = 埋点发了、报表恒 0（祈福墙 2026-09-18 已栽过一次）
      ritualGate: gateBlock('wish_ritual_gate'),
      // 创新钩子 H2「功德证」（2026-09-20）：action 是 muyu_cert_gate，与上面两个钩子共用
      // gateBlock 的同一套口径（曝光/去注册/放弃/完成 + 四个比率）。
      // ⚠️ 不在这里分桶 = 埋点发了、报表恒 0（祈福墙 2026-09-18 已栽过一次）
      certGate: gateBlock('muyu_cert_gate')
    },
    store: {
      tabEnter: count('store_tab_enter'),
      zoneDetail: count('store_zone_detail'),
      bookingClick: count('store_booking_click'),
      checkin: count('store_checkin')
    },
    commerce: {
      productView: count('product_view') + count('view'),
      addCart: count('product_add_cart'),
      orderSubmit: count('order_submit')
    }
  }
}

function buildShareList(map, { valueKey = 'value', limit = 8 } = {}) {
  const rows = Object.keys(map).map((k) => {
    const row = map[k]
    const value = typeof row === 'number' ? row : Number(row[valueKey]) || 0
    return {
      key: k,
      label: (row && row.label) || categoryLabel(k),
      value: round2(value),
      count: (row && row.count) || 0
    }
  })
  rows.sort((a, b) => b.value - a.value)
  const sliced = rows.slice(0, limit)
  const total = sliced.reduce((s, r) => s + r.value, 0)
  return sliced.map((r) => {
    const pct = total > 0 ? Math.round((r.value / total) * 1000) / 10 : 0
    return {
      ...r,
      valueFmt: fmtMoney(r.value),
      pct,
      barStyle: `width:${Math.max(pct > 0 ? 4 : 0, Math.min(100, pct))}%`
    }
  })
}

async function loadBehaviors(startTs, endTs, limit = BEHAVIOR_SAMPLE) {
  const res = await db
    .collection('user_behaviors')
    .where({
      timestamp: _.gte(startTs).and(_.lte(endTs))
    })
    .field({
      action: true,
      module: true,
      page: true,
      userId: true,
      dateKey: true,
      timestamp: true,
      // 注册钩子漏斗按 step 分桶（identify_save_atlas_gate / wish_wall_register_gate）
      step: true,
      // 落愿成功要按 targetId==='ok' 过滤（wish_wall_post 的同名事件也用于失败分支）
      targetId: true
    })
    .orderBy('timestamp', 'desc')
    .limit(limit)
    .get()
  return res.data || []
}

/**
 * 读取日汇总。
 *
 * ⚠️ 这里此前硬编码 `limit(500)`：`analytics_daily` 是「一日 × 一 action」一行，
 * 30 天区间在事件类型多时**会超过 500 行 → 静默丢行 → 看板日趋势偏低**。
 * 现改为真源常量，并在触顶时把截断写进 notes（不静默）。
 */
async function loadDailyRollup(dateKeys) {
  if (!dateKeys.length) return []
  try {
    const res = await db
      .collection('analytics_daily')
      .where({ dateKey: _.in(dateKeys) })
      .limit(DAILY_ROLLUP_LIMIT)
      .get()
    // 截断与否交给调用方用 rows.length 判定（不引入跨调用的可变状态）
    return res.data || []
  } catch (e) {
    return []
  }
}

function mergeDailyUv(dailyRows, dateKeys) {
  const map = {}
  dateKeys.forEach((k) => {
    map[k] = new Set()
  })
  ;(dailyRows || []).forEach((row) => {
    const dk = row.dateKey
    if (!dk || !map[dk]) return
    const uv = row.uv
    if (Array.isArray(uv)) {
      uv.forEach((u) => {
        if (u) map[dk].add(String(u))
      })
    }
  })
  return map
}

function dauFromBehaviorSample(rows, dateKeys) {
  const map = {}
  dateKeys.forEach((k) => {
    map[k] = new Set()
  })
  rows.forEach((r) => {
    const dk = r.dateKey || ''
    if (dk && map[dk] && r.userId) map[dk].add(String(r.userId))
  })
  return map
}

function computeRetention(dauMap, dateKeys) {
  let d1Eligible = 0
  let d1Retained = 0
  let d7Eligible = 0
  let d7Retained = 0

  for (let i = 0; i < dateKeys.length; i++) {
    const dk = dateKeys[i]
    const set = dauMap[dk] || new Set()
    const dk1 = dateKeys[i + 1]
    const dk7 = dateKeys[i + 7]
    if (dk1) {
      const next = dauMap[dk1] || new Set()
      set.forEach((u) => {
        d1Eligible++
        if (next.has(u)) d1Retained++
      })
    }
    if (dk7) {
      const later = dauMap[dk7] || new Set()
      set.forEach((u) => {
        d7Eligible++
        if (later.has(u)) d7Retained++
      })
    }
  }

  const multiDayUsers = new Set()
  const userDays = {}
  const allUsers = new Set()
  dateKeys.forEach((dk) => {
    ;(dauMap[dk] || new Set()).forEach((u) => {
      allUsers.add(u)
      userDays[u] = (userDays[u] || 0) + 1
      if (userDays[u] >= 2) multiDayUsers.add(u)
    })
  })

  return {
    d1Rate: d1Eligible > 0 ? Math.round((d1Retained / d1Eligible) * 1000) / 10 : null,
    d7Rate: d7Eligible > 0 ? Math.round((d7Retained / d7Eligible) * 1000) / 10 : null,
    return7dRate:
      allUsers.size > 0 ? Math.round((multiDayUsers.size / allUsers.size) * 1000) / 10 : null,
    d1Sample: d1Eligible,
    d7Sample: d7Eligible
  }
}

function userRegisteredMs(user) {
  if (!user || typeof user !== 'object') return 0
  const fields = ['createTime', 'registerTime', 'createdAt', '_createTime']
  for (let i = 0; i < fields.length; i++) {
    const ms = toMs(user[fields[i]])
    if (ms) return ms
  }
  return 0
}

async function countNewUsersForDay(startTs, endTs) {
  const startDate = new Date(startTs)
  const endDate = new Date(endTs)
  const fields = ['createTime', 'registerTime', 'createdAt']

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]
    try {
      // 库内多为 db.serverDate() → Date；用 number 比较会静默得到 0
      const res = await db
        .collection('users')
        .where({
          [field]: _.gte(startDate).and(_.lte(endDate))
        })
        .count()
      if ((res.total || 0) > 0) return res.total || 0
    } catch (e) {
      // try next field / fallback
    }
  }

  // 兼容历史 number 型时间戳
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]
    try {
      const res = await db
        .collection('users')
        .where({
          [field]: _.gte(startTs).and(_.lte(endTs))
        })
        .count()
      if ((res.total || 0) > 0) return res.total || 0
    } catch (e) {
      // continue
    }
  }
  return 0
}

/**
 * 一次扫描区间用户，按营业日聚合（避免 7～90 次 count 且兼容字段类型混用）
 */
async function loadNewUsersByDay(dateKeys, startTs, endTs) {
  const dayAgg = {}
  dateKeys.forEach((dk) => {
    dayAgg[dk] = 0
  })
  let scanned = 0
  let truncated = false
  const padStart = startTs - MS_DAY
  const padEnd = endTs + MS_DAY
  const PAGE = 100

  const ingest = (rows) => {
    ;(rows || []).forEach((u) => {
      const ms = userRegisteredMs(u)
      if (!ms || ms < startTs || ms > endTs) return
      const dk = toBizDate(ms)
      if (dayAgg[dk] != null) dayAgg[dk] += 1
    })
  }

  // 优先按 createTime(Date) 拉窗口
  let skip = 0
  while (scanned < USER_SCAN_MAX) {
    let rows = []
    try {
      const res = await db
        .collection('users')
        .where({
          createTime: _.gte(new Date(padStart)).and(_.lte(new Date(padEnd)))
        })
        .field({ createTime: true, registerTime: true, createdAt: true, _createTime: true })
        .orderBy('createTime', 'desc')
        .skip(skip)
        .limit(PAGE)
        .get()
      rows = res.data || []
    } catch (e) {
      break
    }
    if (!rows.length) break
    ingest(rows)
    scanned += rows.length
    skip += rows.length
    if (rows.length < PAGE) break
  }

  // 若 Date 查询无结果，降级采样再过滤（兼容纯 number createTime）
  if (!scanned) {
    skip = 0
    while (scanned < USER_SCAN_MAX) {
      let rows = []
      try {
        const res = await db
          .collection('users')
          .field({ createTime: true, registerTime: true, createdAt: true, _createTime: true })
          .skip(skip)
          .limit(PAGE)
          .get()
        rows = res.data || []
      } catch (e) {
        break
      }
      if (!rows.length) break
      ingest(rows)
      scanned += rows.length
      skip += rows.length
      if (rows.length < PAGE) break
    }
  }

  truncated = scanned >= USER_SCAN_MAX
  const series = dateKeys.map((dk) => ({
    dateKey: dk,
    label: dk.slice(5),
    count: dayAgg[dk] || 0
  }))

  // 若扫描为 0，再逐日 Date count 兜底（小数据量可靠）
  const scanTotal = series.reduce((s, x) => s + x.count, 0)
  if (scanTotal === 0 && dateKeys.length <= 31) {
    const counted = await Promise.all(
      dateKeys.map(async (dk) => {
        const { startTs: ds, endTs: de } = dayBoundsFromKey(dk)
        const count = await countNewUsersForDay(ds, de)
        return { dateKey: dk, label: dk.slice(5), count }
      })
    )
    return { series: counted, truncated: false, source: 'per_day_count' }
  }

  return {
    series,
    truncated,
    source: scanned ? 'scan' : 'empty'
  }
}

async function usersMetrics(event) {
  const range = parseRange(event)
  const { startTs, endTs, days, startDate, endDate, rangeType, yearMonth } = range
  const dateKeys = dateKeysInRange(startTs, endTs)

  const [newUsersPack, dailyRollup, behaviorRows] = await Promise.all([
    loadNewUsersByDay(dateKeys, startTs, endTs),
    loadDailyRollup(dateKeys),
    loadBehaviors(startTs, endTs)
  ])
  const newUserCounts = newUsersPack.series || []

  const dailyUv = mergeDailyUv(dailyRollup, dateKeys)
  let dauSource = 'analytics_daily'
  let behaviorSampled = false
  const emptyDaily = dateKeys.every((k) => !(dailyUv[k] && dailyUv[k].size))

  let dauMap = dailyUv
  if (emptyDaily && behaviorRows.length) {
    dauSource = 'user_behaviors_sample'
    dauMap = dauFromBehaviorSample(behaviorRows, dateKeys)
    behaviorSampled = behaviorRows.length >= BEHAVIOR_SAMPLE
  } else if (!emptyDaily && behaviorRows.length >= BEHAVIOR_SAMPLE) {
    behaviorSampled = true
  }

  const dauByDay = dateKeys.map((dk) => ({
    dateKey: dk,
    label: dk.slice(5),
    dau: (dauMap[dk] && dauMap[dk].size) || 0
  }))

  const retention = computeRetention(dauMap, dateKeys)
  const totalNewUsers = newUserCounts.reduce((s, x) => s + x.count, 0)
  const avgDau =
    dauByDay.length > 0
      ? Math.round((dauByDay.reduce((s, d) => s + d.dau, 0) / dauByDay.length) * 10) / 10
      : 0
  const agg = aggregateRows(behaviorRows)

  const notes = []
  if (dauSource === 'user_behaviors_sample') {
    notes.push('DAU 来自行为表最近采样，非全量 UV')
  } else if (dauSource === 'analytics_daily') {
    notes.push('DAU：各事件 UV 合并去重，可能略高于真实独立访客')
  }
  if (Array.isArray(dailyRollup) && dailyRollup.length >= DAILY_ROLLUP_LIMIT) {
    notes.push(`日汇总读取上限 ${DAILY_ROLLUP_LIMIT} 行，日趋势可能略低估`)
  }
  if (behaviorSampled) {
    notes.push(`行为事件已采样最近 ${BEHAVIOR_SAMPLE} 条`)
  }
  if (newUsersPack.truncated) {
    notes.push(`新增用户扫描上限 ${USER_SCAN_MAX}，日趋势可能略低估`)
  }
  notes.push('新增用户：createTime/registerTime（Date）按东八区营业日')
  notes.push('留存：日活用户次日 / 7 日回访率（非注册 cohort）')
  if (rangeType === 'month') {
    notes.push(`统计周期：自然月 ${yearMonth || startDate.slice(0, 7)}（公历月初～月末/今日，东八区营业日）`)
  }

  return {
    range: { startTs, endTs, days, startDate, endDate, rangeType, yearMonth },
    newUsersByDay: newUserCounts,
    totalNewUsers,
    avgDau,
    dauByDay,
    dauSource,
    retention,
    topEvents: agg.byAction.slice(0, 12),
    behaviorSummary: {
      totalEvents: agg.totalEvents,
      pageViews: agg.pageViews,
      uniqueUsers: agg.uniqueUsers
    },
    sampled: behaviorSampled,
    notes
  }
}

const ORDER_FIELDS = {
  status: true,
  source: true,
  orderType: true,
  createTime: true,
  paidTime: true,
  refundTime: true,
  updateTime: true,
  totalPrice: true,
  payAmount: true,
  amount: true,
  refundAmount: true,
  storeId: true,
  giftMeta: true,
  depositIntentId: true,
  depositCredit: true,
  products: true,
  levelName: true,
  level: true,
  _openid: true
}

async function pageOrders(where, orderByField, skip, limit) {
  try {
    const res = await db
      .collection('orders')
      .where(where)
      .field(ORDER_FIELDS)
      .orderBy(orderByField, 'desc')
      .skip(skip)
      .limit(limit)
      .get()
    return res.data || []
  } catch (e) {
    try {
      const res = await db
        .collection('orders')
        .where(where)
        .field(ORDER_FIELDS)
        .skip(skip)
        .limit(limit)
        .get()
      return res.data || []
    } catch (e2) {
      return []
    }
  }
}

async function fetchOrdersInRange(startTs, endTs) {
  const PAGE = 100
  const byId = new Map()
  let truncated = false

  const ingest = (rows) => {
    ;(rows || []).forEach((row) => {
      if (!row || !row._id) return
      if (!byId.has(row._id)) byId.set(row._id, row)
    })
    if (byId.size >= ORDER_SCAN_MAX) truncated = true
  }

  // 1) createTime 窗口（含两侧 1 日缓冲，覆盖跨时区边界）
  const padStart = new Date(startTs - MS_DAY)
  const padEnd = new Date(endTs + MS_DAY)
  let skip = 0
  while (byId.size < ORDER_SCAN_MAX) {
    const rows = await pageOrders(
      { createTime: _.gte(padStart).and(_.lte(padEnd)) },
      'createTime',
      skip,
      PAGE
    )
    if (!rows.length) break
    ingest(rows)
    skip += rows.length
    if (rows.length < PAGE) break
  }

  // 2) paidTime 窗口：补捞「早下单、周期内支付」的漏单
  skip = 0
  while (byId.size < ORDER_SCAN_MAX) {
    const rows = await pageOrders(
      {
        status: _.in(PAID_STATUS.concat(REFUND_STATUS)),
        paidTime: _.gte(new Date(startTs)).and(_.lte(new Date(endTs)))
      },
      'paidTime',
      skip,
      PAGE
    )
    if (!rows.length) break
    ingest(rows)
    skip += rows.length
    if (rows.length < PAGE) break
  }

  // 3) 退款时间窗口：补捞「周期内退款、支付日在外」的单
  skip = 0
  while (byId.size < ORDER_SCAN_MAX) {
    const rows = await pageOrders(
      {
        status: _.in(REFUND_STATUS),
        refundTime: _.gte(new Date(startTs)).and(_.lte(new Date(endTs)))
      },
      'refundTime',
      skip,
      PAGE
    )
    if (!rows.length) break
    ingest(rows)
    skip += rows.length
    if (rows.length < PAGE) break
  }

  return { rows: Array.from(byId.values()), truncated }
}

function resolveLedgerGroupId(rawId) {
  const sid = String(rawId || '').trim()
  if (!sid || sid === 'default' || sid === 'main') return FINANCE_STORE_ID
  for (let i = 0; i < REPORT_STORES.length; i++) {
    const s = REPORT_STORES[i]
    if (s.storeId === sid || (s.aliases || []).indexOf(sid) !== -1) return s.storeId
  }
  if (MAIN_STORE_ALIAS_IDS.indexOf(sid) !== -1) return FINANCE_STORE_ID
  return null
}

function docUpdateMs(doc) {
  return toMs(doc && (doc._updateTime || doc.syncedAt || doc.updateTime || doc._id))
}

/**
 * 按 (门店组, 营业日) 去重：主店别名与 canonical 同日只保留最新一条，避免双计
 */
function dedupeLedgerDocs(docs) {
  const best = new Map()
  ;(docs || []).forEach((doc) => {
    const groupId = resolveLedgerGroupId(doc && doc.storeId)
    if (!groupId) return
    const dk = normalizeDateStr((doc && (doc.date || doc.bizDate)) || '')
    if (!dk) return
    const key = `${groupId}|${dk}`
    const prev = best.get(key)
    if (!prev || docUpdateMs(doc) >= docUpdateMs(prev.doc)) {
      best.set(key, { groupId, dk, doc })
    }
  })
  return Array.from(best.values())
}

function buildLedgerByStoreShare(storeTotals) {
  const grand = Object.keys(storeTotals).reduce((s, k) => s + (Number(storeTotals[k]) || 0), 0)
  return REPORT_STORES.map((s) => {
    const value = round2(storeTotals[s.storeId] || 0)
    const pct = grand > 0 ? Math.round((value / grand) * 1000) / 10 : 0
    return {
      storeId: s.storeId,
      name: s.name,
      value,
      valueFmt: fmtMoney(value),
      pct,
      barStyle: `width:${Math.max(pct > 0 ? 4 : 0, Math.min(100, pct))}%`
    }
  })
}

async function loadLedgerByDays(dateKeys, scope) {
  if (!dateKeys.length) {
    return { daily: {}, byStore: [], mode: 'empty' }
  }

  const emptyDaily = () => {
    const map = {}
    dateKeys.forEach((dk) => {
      map[dk] = 0
    })
    return map
  }

  const dateStart = dateKeys[0]
  const dateEnd = dateKeys[dateKeys.length - 1]
  const dateKeySet = {}
  dateKeys.forEach((dk) => {
    dateKeySet[dk] = true
  })

  // 日期用区间而非 _.in：云库 in 最多约 10 项，30/90 日会静默失败或截断
  const fetchLedgerDocs = async (ids) => {
    const PAGE = 100
    const all = []
    let skip = 0
    while (all.length < 800) {
      let rows = []
      try {
        const res = await db
          .collection('store_ledger')
          .where({
            storeId: ids.length > 1 ? _.in(ids) : ids[0],
            date: _.gte(dateStart).and(_.lte(dateEnd))
          })
          .skip(skip)
          .limit(PAGE)
          .get()
        rows = res.data || []
      } catch (e) {
        try {
          const res = await db
            .collection('store_ledger')
            .where({
              storeId: ids.length > 1 ? _.in(ids) : ids[0]
            })
            .skip(skip)
            .limit(PAGE)
            .get()
          rows = (res.data || []).filter((doc) => {
            const dk = normalizeDateStr(doc.date || doc.bizDate)
            return dk && dateKeySet[dk]
          })
        } catch (e2) {
          break
        }
      }
      if (!rows.length) break
      rows.forEach((doc) => {
        const dk = normalizeDateStr(doc.date || doc.bizDate)
        if (dk && dateKeySet[dk]) all.push(doc)
      })
      skip += rows.length
      if (rows.length < PAGE) break
    }
    return all
  }

  // 单店模式：指定 storeId（含主店别名）
  if (scope && scope.mode === 'single' && scope.storeId) {
    const storeMeta =
      REPORT_STORES.find((s) => s.storeId === scope.storeId) || {
        storeId: scope.storeId,
        name: scope.storeId,
        aliases: scope.storeId === FINANCE_STORE_ID ? MAIN_STORE_ALIAS_IDS : []
      }
    const ids = [storeMeta.storeId].concat(storeMeta.aliases || [])
    try {
      const docs = await fetchLedgerDocs(ids)
      const daily = emptyDaily()
      let total = 0
      dedupeLedgerDocs(docs).forEach(({ dk, doc }) => {
        if (daily[dk] == null) return
        const net = ledgerNet(doc)
        daily[dk] = round2(net)
        total += net
      })
      return {
        daily,
        byStore: [
          {
            storeId: storeMeta.storeId,
            name: storeMeta.name || storeMeta.storeId,
            value: round2(total),
            valueFmt: fmtMoney(total),
            pct: 100,
            barStyle: 'width:100%'
          }
        ],
        mode: 'single'
      }
    } catch (e) {
      return { daily: emptyDaily(), byStore: [], mode: 'single' }
    }
  }

  // 超管 / 投资人默认：山川造物 + 星宸标本 总账
  const allIds = []
  REPORT_STORES.forEach((s) => {
    allIds.push(s.storeId)
    ;(s.aliases || []).forEach((a) => allIds.push(a))
  })

  try {
    const docs = await fetchLedgerDocs(allIds)
    const daily = emptyDaily()
    const storeTotals = {}
    REPORT_STORES.forEach((s) => {
      storeTotals[s.storeId] = 0
    })

    dedupeLedgerDocs(docs).forEach(({ groupId, dk, doc }) => {
      if (storeTotals[groupId] == null || daily[dk] == null) return
      const net = ledgerNet(doc)
      daily[dk] = round2((daily[dk] || 0) + net)
      storeTotals[groupId] = round2((storeTotals[groupId] || 0) + net)
    })

    return { daily, byStore: buildLedgerByStoreShare(storeTotals), mode: 'dual' }
  } catch (e) {
    return { daily: emptyDaily(), byStore: [], mode: 'dual' }
  }
}

function orderPaidBizDate(order) {
  return toBizDate(order && (order.paidTime || order.createTime))
}

function orderRefundBizDate(order) {
  return toBizDate(order && (order.refundTime || order.updateTime || order.createTime))
}

function orderCreateBizDate(order) {
  return toBizDate(order && order.createTime)
}

async function ordersMetrics(event, scope) {
  const range = parseRange(event)
  const { startTs, endTs, days, startDate, endDate, rangeType, yearMonth } = range
  const dateKeys =
    startDate && endDate ? dateKeysBetween(startDate, endDate) : dateKeysInRange(startTs, endTs)

  const [{ rows: rawRows, truncated }, ledgerPack] = await Promise.all([
    fetchOrdersInRange(startTs, endTs),
    loadLedgerByDays(dateKeys, scope)
  ])
  const ledgerMap = ledgerPack.daily || {}
  const ledgerByStore = ledgerPack.byStore || []

  const rows = (rawRows || []).filter((o) => orderMatchesStore(o, scope))

  const dayAgg = {}
  dateKeys.forEach((dk) => {
    dayAgg[dk] = {
      dateKey: dk,
      label: dk.slice(5),
      orders: 0,
      paid: 0,
      unpaid: 0,
      refunded: 0,
      gmvPaid: 0,
      refundAmount: 0,
      giftGmv: 0,
      depositGmv: 0,
      offlineLedger: ledgerMap[dk] || 0
    }
  })

  let totalOrders = 0
  let totalPaid = 0
  let totalUnpaid = 0
  let totalRefunded = 0
  let gmvPaid = 0
  let refundAmount = 0
  let giftGmv = 0
  let depositGmv = 0
  let depositBalanceGmv = 0
  let commerceGmv = 0
  let customGmv = 0
  let exchangeCount = 0
  const payingUsers = new Set()
  const levelMap = {}
  const categoryMap = {}

  rows.forEach((o) => {
    if (isExchangeOrder(o)) {
      const dk = orderCreateBizDate(o)
      if (dayAgg[dk]) exchangeCount += 1
      return
    }

    const st = String(o.status || '')
    const createDk = orderCreateBizDate(o)
    const paidDk = orderPaidBizDate(o)
    const refundDk = orderRefundBizDate(o)
    const bucket = orderSourceBucket(o)
    const amt = parseOrderAmount(o)

    // 下单量：按创建日落入周期
    if (dayAgg[createDk]) {
      dayAgg[createDk].orders += 1
      totalOrders += 1
      if (UNPAID_STATUS.indexOf(st) !== -1) {
        dayAgg[createDk].unpaid += 1
        totalUnpaid += 1
      }
    }

    // 已付 GMV：当前仍为已付态，按支付日
    if (PAID_STATUS.indexOf(st) !== -1 && dayAgg[paidDk]) {
      dayAgg[paidDk].paid += 1
      totalPaid += 1
      dayAgg[paidDk].gmvPaid += amt
      gmvPaid += amt
      if (o._openid) payingUsers.add(String(o._openid))

      if (bucket === 'gift') {
        dayAgg[paidDk].giftGmv += amt
        giftGmv += amt
      } else if (bucket === 'deposit') {
        dayAgg[paidDk].depositGmv += amt
        depositGmv += amt
      } else if (bucket === 'deposit_balance') {
        depositBalanceGmv += amt
      } else if (bucket === 'custom') {
        customGmv += amt
      } else {
        commerceGmv += amt
      }

      const lv = String((o.levelName || (o.level && o.level.name) || '未定级')).trim() || '未定级'
      if (!levelMap[lv]) levelMap[lv] = { label: lv, value: 0, count: 0 }
      levelMap[lv].value += amt
      levelMap[lv].count += 1

      const products = Array.isArray(o.products) ? o.products : []
      if (products.length) {
        const lineSum = products.reduce((s, p) => {
          const lineAmt = Number(p.price != null ? p.price : p.unitPrice) || 0
          const qty = Math.max(1, Math.floor(Number(p.count || p.quantity) || 1))
          return s + lineAmt * qty
        }, 0)
        products.forEach((p) => {
          const cat = String(p.categoryType || p.rootCategoryName || 'OTHER').toUpperCase() || 'OTHER'
          const lineAmt = Number(p.price != null ? p.price : p.unitPrice) || 0
          const qty = Math.max(1, Math.floor(Number(p.count || p.quantity) || 1))
          const rawLine = lineAmt * qty
          const share = lineSum > 0 ? (rawLine / lineSum) * amt : amt / products.length
          if (!categoryMap[cat]) categoryMap[cat] = { label: categoryLabel(cat), value: 0, count: 0 }
          categoryMap[cat].value += share
          categoryMap[cat].count += qty
        })
      } else {
        if (!categoryMap.OTHER) categoryMap.OTHER = { label: '其他', value: 0, count: 0 }
        categoryMap.OTHER.value += amt
        categoryMap.OTHER.count += 1
      }
    }

    // 退款：按退款日（可与支付日跨期）
    if (REFUND_STATUS.indexOf(st) !== -1 && dayAgg[refundDk]) {
      const rAmt = parseRefundAmount(o)
      dayAgg[refundDk].refunded += 1
      dayAgg[refundDk].refundAmount += rAmt
      totalRefunded += 1
      refundAmount += rAmt
    }
  })

  const daily = dateKeys.map((dk) => {
    const row = dayAgg[dk]
    const aov = row.paid > 0 ? round2(row.gmvPaid / row.paid) : 0
    const netOnline = round2(row.gmvPaid - row.refundAmount)
    return {
      ...row,
      gmvPaid: round2(row.gmvPaid),
      refundAmount: round2(row.refundAmount),
      giftGmv: round2(row.giftGmv),
      depositGmv: round2(row.depositGmv),
      netOnline,
      aov,
      grandDay: round2(netOnline + (row.offlineLedger || 0))
    }
  })

  const offlineTotal = round2(daily.reduce((s, d) => s + d.offlineLedger, 0))
  const gmvRounded = round2(gmvPaid)
  const refundRounded = round2(refundAmount)
  const netOnline = round2(gmvRounded - refundRounded)
  const aov = totalPaid > 0 ? round2(gmvPaid / totalPaid) : 0
  const grand = round2(netOnline + offlineTotal)
  const levelShare = buildShareList(levelMap, { limit: 8 })
  const categoryShare = buildShareList(categoryMap, { limit: 8 })

  const notes = []
  if (truncated) {
    notes.push(`订单明细已采样最近 ${ORDER_SCAN_MAX} 单，合计为采样内统计`)
  }
  if (scope && scope.mode === 'single') {
    notes.push(`门店账本：${scope.storeId}；无 storeId 的快递单计入主店`)
  } else {
    notes.push('门店账本：山川造物 + 星宸标本双店合计（含主店历史别名）；线上订单为全量')
  }
  notes.push(
    '毛 GMV：已付态按支付日 × totalPrice；定金单与尾款单分列（尾款已抵扣定金，不重复计货值）'
  )
  notes.push('周期退款按退款日计；线上净额 = 毛 GMV − 周期退款（支付/退款可跨期）')
  notes.push('综合营收 = 线上净额 + 双店账本净额；兑换单（exchange）不计入')

  return {
    range: { startTs, endTs, days, startDate, endDate, rangeType, yearMonth },
    storeScope: scope,
    daily,
    ledgerByStore,
    ledgerMode: (ledgerPack && ledgerPack.mode) || 'dual',
    totals: {
      orders: totalOrders,
      paid: totalPaid,
      unpaid: totalUnpaid,
      refunded: totalRefunded,
      gmvPaid: gmvRounded,
      gmvPaidFmt: fmtMoney(gmvRounded),
      refundAmount: refundRounded,
      refundAmountFmt: fmtMoney(refundRounded),
      netOnline,
      netOnlineFmt: fmtMoney(netOnline),
      aov,
      aovFmt: aov > 0 ? `¥${fmtMoney(aov)}` : '—',
      offlineLedger: offlineTotal,
      offlineLedgerFmt: fmtMoney(offlineTotal),
      ledgerByStore,
      grandTotal: grand,
      grandTotalFmt: fmtMoney(grand),
      payingUsers: payingUsers.size,
      exchangeCount,
      mix: {
        commerce: round2(commerceGmv),
        commerceFmt: fmtMoney(commerceGmv),
        gift: round2(giftGmv),
        giftFmt: fmtMoney(giftGmv),
        deposit: round2(depositGmv),
        depositFmt: fmtMoney(depositGmv),
        depositBalance: round2(depositBalanceGmv),
        depositBalanceFmt: fmtMoney(depositBalanceGmv),
        custom: round2(customGmv),
        customFmt: fmtMoney(customGmv)
      }
    },
    members: {
      payingUsers: payingUsers.size,
      levelShare,
      notes: ['会员等级占比按周期内已付订单 levelName × 实付金额']
    },
    category: {
      byType: categoryShare,
      notes: ['品类占比按已付订单行 categoryType 分摊实付金额']
    },
    truncated,
    notes
  }
}

function productStockUnits(p) {
  if (p.hasSku && Array.isArray(p.skus) && p.skus.length) {
    return p.skus.reduce((sum, s) => sum + Math.max(0, Math.floor(Number(s.stock) || 0)), 0)
  }
  return Math.max(0, Math.floor(Number(p.stock) || 0))
}

async function catalogMetrics() {
  const counts = {
    total: 0,
    onShelf: 0,
    offShelf: 0,
    stockTotal: 0,
    lowStockSkus: 0
  }
  const byCategory = {}
  let skip = 0
  let scanned = 0
  const PAGE = 100

  while (scanned < PRODUCT_SCAN_MAX) {
    const res = await db
      .collection('products')
      .skip(skip)
      .limit(PAGE)
      .field({
        isOffShelf: true,
        stock: true,
        hasSku: true,
        skus: true,
        categoryType: true
      })
      .get()
    const rows = res.data || []
    if (!rows.length) break

    rows.forEach((p) => {
      counts.total += 1
      const onShelf = p.isOffShelf === false
      if (onShelf) counts.onShelf += 1
      else counts.offShelf += 1
      const stock = productStockUnits(p)
      counts.stockTotal += stock
      if (onShelf && stock > 0 && stock <= LOW_STOCK_THRESHOLD) {
        counts.lowStockSkus += 1
      }
      if (onShelf) {
        const cat = String(p.categoryType || 'OTHER').toUpperCase() || 'OTHER'
        if (!byCategory[cat]) byCategory[cat] = { label: categoryLabel(cat), value: 0, count: 0 }
        byCategory[cat].value += 1
        byCategory[cat].count += 1
      }
    })

    scanned += rows.length
    skip += rows.length
    if (rows.length < PAGE) break
  }

  const notes = []
  if (scanned >= PRODUCT_SCAN_MAX) {
    notes.push(`藏品扫描上限 ${PRODUCT_SCAN_MAX} 条，数量可能略低于全库`)
  }
  notes.push(`低库存：在架且库存 1–${LOW_STOCK_THRESHOLD} 件的商品数`)

  return {
    counts,
    byCategory: buildShareList(byCategory, { limit: 8 }),
    scanned,
    truncated: scanned >= PRODUCT_SCAN_MAX,
    lowStockThreshold: LOW_STOCK_THRESHOLD,
    notes
  }
}

async function depositMetrics(event) {
  const range = parseRange(event)
  const { startTs, endTs, days, startDate, endDate, rangeType, yearMonth } = range
  const counts = {
    intent: 0,
    pending_pay: 0,
    deposit_paid: 0,
    awaiting_balance: 0,
    settled: 0,
    forfeited_open: 0,
    cancelled: 0,
    other: 0
  }
  let paidDepositAmount = 0
  let forfeitedAmount = 0
  let settledCount = 0
  let scanned = 0
  let truncated = false

  try {
    const PAGE = 100
    let skip = 0
    while (scanned < DEPOSIT_SCAN_MAX) {
      let rows = []
      try {
        const res = await db
          .collection('deposit_intents')
          .where({
            updateTime: _.gte(new Date(startTs)).and(_.lte(new Date(endTs)))
          })
          .skip(skip)
          .limit(PAGE)
          .get()
        rows = res.data || []
      } catch (e) {
        const res = await db.collection('deposit_intents').skip(skip).limit(PAGE).get()
        rows = (res.data || []).filter((r) => {
          const t = toMs(r.updateTime || r.paidAt || r.createTime)
          return t >= startTs && t <= endTs
        })
      }
      if (!rows.length) break

      rows.forEach((row) => {
        const st = String(row.status || 'other')
        if (counts[st] != null) counts[st] += 1
        else counts.other += 1
        const amt = Number(row.depositAmount) || 0
        if (st === 'deposit_paid' || st === 'awaiting_balance' || st === 'settled') {
          paidDepositAmount += amt
        }
        if (st === 'forfeited_open') forfeitedAmount += amt
        if (st === 'settled') settledCount += 1
      })

      scanned += rows.length
      skip += rows.length
      if (rows.length < PAGE) break
    }
    truncated = scanned >= DEPOSIT_SCAN_MAX
  } catch (e) {
    return {
      available: false,
      range: { startTs, endTs, days, startDate, endDate, rangeType, yearMonth },
      counts,
      paidDepositAmount: 0,
      paidDepositAmountFmt: '0.00',
      forfeitedAmount: 0,
      forfeitedAmountFmt: '0.00',
      settledCount: 0,
      notes: ['定金意向集合暂不可用']
    }
  }

  const notes = [
    '定金按 deposit_intents 状态计数；已付定金金额含 deposit_paid / awaiting_balance / settled',
    '定金收入已在订单毛 GMV 的 deposit 分桶中体现，本块为意向漏斗'
  ]
  if (truncated) notes.push(`定金意向扫描上限 ${DEPOSIT_SCAN_MAX}`)

  return {
    available: true,
    range: { startTs, endTs, days, startDate, endDate, rangeType, yearMonth },
    counts,
    paidDepositAmount: round2(paidDepositAmount),
    paidDepositAmountFmt: fmtMoney(paidDepositAmount),
    forfeitedAmount: round2(forfeitedAmount),
    forfeitedAmountFmt: fmtMoney(forfeitedAmount),
    settledCount,
    truncated,
    notes
  }
}

async function commissionMetrics(event) {
  const range = parseRange(event)
  const { startTs, endTs, days, startDate, endDate, rangeType, yearMonth } = range
  let earnTotal = 0
  let reverseTotal = 0
  let earnCount = 0
  let reverseCount = 0
  const byArtisan = {}
  let truncated = false

  try {
    const PAGE = 100
    let skip = 0
    let scanned = 0
    while (scanned < COMMISSION_SCAN_MAX) {
      let rows = []
      try {
        const res = await db
          .collection('artisan_commission_ledger')
          .orderBy('createTime', 'desc')
          .skip(skip)
          .limit(PAGE)
          .get()
        rows = res.data || []
      } catch (e) {
        const res = await db.collection('artisan_commission_ledger').skip(skip).limit(PAGE).get()
        rows = res.data || []
      }
      if (!rows.length) break

      let hitInRange = false
      rows.forEach((r) => {
        const t = toMs(r.createTime || r.paidAt)
        if (t < startTs || t > endTs) return
        hitInRange = true
        const amt = Number(r.amount) || 0
        const name = String(r.artisanName || r.artisanId || '未命名').trim() || '未命名'
        if (!byArtisan[name]) byArtisan[name] = { label: name, value: 0, count: 0 }
        if (r.type === 'reverse') {
          reverseTotal += Math.abs(amt)
          reverseCount += 1
          byArtisan[name].value -= Math.abs(amt)
        } else {
          earnTotal += amt
          earnCount += 1
          byArtisan[name].value += amt
          byArtisan[name].count += 1
        }
      })

      scanned += rows.length
      skip += rows.length
      if (rows.length < PAGE) break
      // 按 createTime desc：若本页已无任何落在周期内的记录，可提前结束
      if (!hitInRange && scanned > PAGE) break
    }
    truncated = scanned >= COMMISSION_SCAN_MAX
  } catch (e) {
    return {
      available: false,
      range: { startTs, endTs, days, startDate, endDate, rangeType, yearMonth },
      earnTotal: 0,
      earnTotalFmt: '0.00',
      reverseTotal: 0,
      reverseTotalFmt: '0.00',
      netTotal: 0,
      netTotalFmt: '0.00',
      earnCount: 0,
      reverseCount: 0,
      topArtisans: [],
      notes: ['提成流水集合暂不可用']
    }
  }

  const netTotal = round2(earnTotal - reverseTotal)
  const topArtisans = buildShareList(byArtisan, { limit: 5 }).filter((r) => r.value > 0)
  const notes = ['提成净额 = 入账 earn − 退款冲正 reverse；按流水 createTime 归属营业日']
  if (truncated) notes.push(`提成流水扫描上限 ${COMMISSION_SCAN_MAX}`)

  return {
    available: true,
    range: { startTs, endTs, days, startDate, endDate, rangeType, yearMonth },
    earnTotal: round2(earnTotal),
    earnTotalFmt: fmtMoney(earnTotal),
    reverseTotal: round2(reverseTotal),
    reverseTotalFmt: fmtMoney(reverseTotal),
    netTotal,
    netTotalFmt: fmtMoney(netTotal),
    earnCount,
    reverseCount,
    topArtisans,
    truncated,
    notes
  }
}

async function overview(event) {
  const range = parseRange(event)
  const { startTs, endTs, days, startDate, endDate, rangeType, yearMonth } = range
  const dateKeys = dateKeysInRange(startTs, endTs)
  const [rows, daily] = await Promise.all([
    loadBehaviors(startTs, endTs),
    loadDailyRollup(dateKeys)
  ])

  const agg = aggregateRows(rows)
  const funnel = buildFunnel(rows)

  let dailyTrend = dateKeys.map((dk) => {
    const dayRows = daily.filter((d) => d.dateKey === dk)
    const pv = dayRows.filter((d) => d.action === 'page_view').reduce((s, d) => s + (d.count || 0), 0)
    const total = dayRows.reduce((s, d) => s + (d.count || 0), 0)
    return { dateKey: dk, pageViews: pv, totalEvents: total }
  })

  if (!daily.length && rows.length) {
    dailyTrend = agg.byDay.map(({ key, count }) => ({
      dateKey: key,
      pageViews: rows.filter((r) => r.dateKey === key && r.action === 'page_view').length,
      totalEvents: count
    }))
  }

  return {
    range: { startTs, endTs, days, startDate, endDate, rangeType, yearMonth },
    summary: agg,
    funnel,
    dailyTrend,
    sampled: rows.length >= BEHAVIOR_SAMPLE || daily.length >= DAILY_ROLLUP_LIMIT,
    note: [
      rows.length >= BEHAVIOR_SAMPLE ? `行为数据已采样最近 ${BEHAVIOR_SAMPLE} 条，UV 为采样内估算` : '',
      daily.length >= DAILY_ROLLUP_LIMIT ? `日汇总读取上限 ${DAILY_ROLLUP_LIMIT} 行，日趋势可能略低估` : ''
    ].filter(Boolean).join('；')
  }
}

async function topEvents(event) {
  const { startTs, endTs } = parseRange(event)
  // 这里此前写死 3000 —— 与 BEHAVIOR_SAMPLE(4000) / BEHAVIOR_PULSE(1000) 都不相等，
  // 是「同一集合第三种口径」。收敛到共享采样上限（#26）。
  const rows = await loadBehaviors(startTs, endTs, BEHAVIOR_SAMPLE_LIMIT)
  return { events: aggregateRows(rows).byAction }
}

function signalStatusMeta(status) {
  const map = {
    ok: { statusLabel: '正常', lampClass: 'blink' },
    warn: { statusLabel: '关注', lampClass: 'warn' },
    danger: { statusLabel: '告警', lampClass: 'danger' },
    muted: { statusLabel: '持平', lampClass: 'lamp-muted' }
  }
  return map[status] || map.muted
}

function makeSignal(partial) {
  const status = partial.status || 'muted'
  const meta = signalStatusMeta(status)
  return {
    id: partial.id,
    name: partial.name,
    value: partial.value != null ? String(partial.value) : '—',
    valueRaw: partial.valueRaw != null ? partial.valueRaw : null,
    status,
    statusLabel: meta.statusLabel,
    reason: partial.reason || '',
    lampClass: meta.lampClass
  }
}

function pctOrNull(num, den) {
  const n = Number(num) || 0
  const d = Number(den) || 0
  if (d <= 0) return null
  return Math.round((n / d) * 1000) / 10
}

function fmtPctSigned(pct) {
  if (pct == null || !Number.isFinite(pct)) return '—'
  const r = Math.round(pct * 10) / 10
  if (r > 0) return `+${r}%`
  return `${r}%`
}

/**
 * 周期前后半日均对比。样本不足时返回 muted。
 * @returns {{ status, pct, reason, value }}
 */
function halfPeriodMom(series, valueKey, opts) {
  const rows = Array.isArray(series) ? series : []
  const minDays = (opts && opts.minDays) || SIGNAL_RULES.halfMinDays
  const label = (opts && opts.label) || '指标'
  if (rows.length < minDays) {
    return {
      status: 'muted',
      pct: null,
      value: '—',
      reason: '样本不足（需≥4日）'
    }
  }
  const mid = Math.floor(rows.length / 2)
  const avg = (slice) => {
    if (!slice.length) return 0
    return slice.reduce((s, r) => s + (Number(r[valueKey]) || 0), 0) / slice.length
  }
  const prev = avg(rows.slice(0, mid))
  const curr = avg(rows.slice(mid))
  if (prev <= 0 && curr <= 0) {
    return { status: 'muted', pct: 0, value: '0%', reason: `${label}前后半均接近0` }
  }
  if (prev <= 0 && curr > 0) {
    return { status: 'ok', pct: null, value: '新', reason: `${label}前半为0、后半有量` }
  }
  const pct = ((curr - prev) / prev) * 100
  const rounded = Math.round(pct * 10) / 10
  if (rounded <= SIGNAL_RULES.momDangerPct) {
    return {
      status: 'danger',
      pct: rounded,
      value: fmtPctSigned(rounded),
      reason: `环比下降>${Math.abs(SIGNAL_RULES.momDangerPct)}%（周期前后半）`
    }
  }
  if (rounded <= SIGNAL_RULES.momWarnPct) {
    return {
      status: 'warn',
      pct: rounded,
      value: fmtPctSigned(rounded),
      reason: `环比下降>${Math.abs(SIGNAL_RULES.momWarnPct)}%（周期前后半）`
    }
  }
  if (rounded >= 0.5) {
    return {
      status: 'ok',
      pct: rounded,
      value: fmtPctSigned(rounded),
      reason: '周期后半日均高于前半'
    }
  }
  return {
    status: 'ok',
    pct: rounded,
    value: fmtPctSigned(rounded),
    reason: '周期前后半大致持平'
  }
}

/**
 * 从 report 已算指标生成信号灯列表（4～8 盏）
 * 仅超管看板消费；规则写在 SIGNAL_RULES。
 */
function buildTrafficLights(pack) {
  const totals = (pack.orders && pack.orders.totals) || {}
  const daily = (pack.orders && pack.orders.daily) || []
  const users = pack.users || {}
  const deposit = pack.deposit || {}
  const commission = pack.commission || {}
  const catalog = pack.catalog || {}
  const ledgerByStore = pack.ledgerByStore || []
  const gmvPaid = Number(totals.gmvPaid) || 0
  const refundAmount = Number(totals.refundAmount) || 0
  const netOnline = Number(totals.netOnline) || 0
  const offlineLedger = Number(totals.offlineLedger) || 0

  const revenueSeries = daily.map((row) => ({
    dateKey: row.dateKey,
    total:
      (Number(row.netOnline != null ? row.netOnline : row.gmvPaid) || 0) +
      (Number(row.offlineLedger) || 0)
  }))
  const revMom = halfPeriodMom(revenueSeries, 'total', { label: '综合营收' })
  const userMom = halfPeriodMom(users.newUsersByDay || [], 'count', { label: '新增用户' })

  const refundPct = pctOrNull(refundAmount, gmvPaid)
  let refundStatus = 'muted'
  let refundReason = '本期无毛 GMV'
  let refundValue = '—'
  if (gmvPaid <= 0 && refundAmount <= 0) {
    refundStatus = 'ok'
    refundReason = '无退款'
    refundValue = '0%'
  } else if (refundPct != null) {
    refundValue = `${refundPct}%`
    if (refundPct >= SIGNAL_RULES.refundDangerPct) {
      refundStatus = 'danger'
      refundReason = `退款率偏高（≥${SIGNAL_RULES.refundDangerPct}%）`
    } else if (refundPct >= SIGNAL_RULES.refundWarnPct) {
      refundStatus = 'warn'
      refundReason = `退款率偏高（≥${SIGNAL_RULES.refundWarnPct}%）`
    } else {
      refundStatus = 'ok'
      refundReason = '退款率在健康区间'
    }
  } else if (refundAmount > 0) {
    refundStatus = 'warn'
    refundValue = `¥${fmtMoney(refundAmount)}`
    refundReason = '有退款但毛 GMV 为0（跨期归属）'
  }

  const counts = deposit.counts || {}
  const awaiting = Number(counts.awaiting_balance) || 0
  const depositPaid = Number(counts.deposit_paid) || 0
  const settled = Number(deposit.settledCount != null ? deposit.settledCount : counts.settled) || 0
  const depositFunnel = awaiting + depositPaid + settled
  const depositBacklogPct = pctOrNull(awaiting, depositFunnel)
  let depositStatus = 'muted'
  let depositReason = deposit.available === false ? '定金数据不可用' : '本期无定金意向'
  let depositValue = '—'
  if (deposit.available !== false && depositFunnel > 0) {
    depositValue = depositBacklogPct != null ? `${depositBacklogPct}%` : '—'
    if (depositBacklogPct != null && depositBacklogPct >= SIGNAL_RULES.depositDangerPct) {
      depositStatus = 'danger'
      depositReason = `待尾款占比偏高（≥${SIGNAL_RULES.depositDangerPct}%）`
    } else if (depositBacklogPct != null && depositBacklogPct >= SIGNAL_RULES.depositWarnPct) {
      depositStatus = 'warn'
      depositReason = `待尾款占比偏高（≥${SIGNAL_RULES.depositWarnPct}%）`
    } else {
      depositStatus = 'ok'
      depositReason = '定金漏斗转化正常'
    }
  }

  const earnTotal = Number(commission.earnTotal) || 0
  const reverseTotal = Number(commission.reverseTotal) || 0
  const reversePct = pctOrNull(reverseTotal, earnTotal)
  let commissionStatus = 'muted'
  let commissionReason = commission.available === false ? '提成数据不可用' : '本期无提成计提'
  let commissionValue = '—'
  if (commission.available !== false && (earnTotal > 0 || reverseTotal > 0)) {
    if (earnTotal <= 0 && reverseTotal > 0) {
      commissionStatus = 'warn'
      commissionValue = `冲回¥${fmtMoney(reverseTotal)}`
      commissionReason = '仅有冲回、无计提'
    } else if (reversePct != null) {
      commissionValue = `${reversePct}%`
      if (reversePct >= SIGNAL_RULES.commissionDangerPct) {
        commissionStatus = 'danger'
        commissionReason = `冲回比偏高（≥${SIGNAL_RULES.commissionDangerPct}%）`
      } else if (reversePct >= SIGNAL_RULES.commissionWarnPct) {
        commissionStatus = 'warn'
        commissionReason = `冲回比偏高（≥${SIGNAL_RULES.commissionWarnPct}%）`
      } else {
        commissionStatus = 'ok'
        commissionReason = '冲回比在健康区间'
      }
    }
  }

  const lowStock = Number((catalog.counts && catalog.counts.lowStockSkus) || 0)
  let stockStatus = 'ok'
  let stockReason = '无低库存预警'
  let stockValue = `${lowStock}`
  if (lowStock >= SIGNAL_RULES.stockDanger) {
    stockStatus = 'danger'
    stockReason = `低库存 SKU≥${SIGNAL_RULES.stockDanger}`
  } else if (lowStock >= SIGNAL_RULES.stockWarn) {
    stockStatus = 'warn'
    stockReason = `存在低库存 SKU（阈值 ${SIGNAL_RULES.stockWarn}）`
  }

  let storeStatus = 'muted'
  let storeReason = '本期双店账本无入账'
  let storeValue = '—'
  if (ledgerByStore.length) {
    const vals = ledgerByStore.map((r) => Number(r.value) || 0)
    const sum = vals.reduce((a, b) => a + b, 0)
    const max = Math.max.apply(null, vals.concat([0]))
    const min = Math.min.apply(null, vals.concat([0]))
    const skewPct = pctOrNull(max, sum)
    storeValue = sum > 0 ? `¥${fmtMoney(sum)}` : '¥0.00'
    if (sum <= 0) {
      storeStatus = 'muted'
      storeReason = '本期双店账本无入账'
    } else if (min <= 0 && max >= SIGNAL_RULES.storeEmptyPeerMin) {
      storeStatus = 'warn'
      storeReason = '单店账本为0（对侧有入账）'
    } else if (skewPct != null && skewPct >= SIGNAL_RULES.storeSkewWarnPct) {
      storeStatus = 'warn'
      storeReason = `单店占比过高（≥${SIGNAL_RULES.storeSkewWarnPct}%）`
    } else {
      storeStatus = 'ok'
      storeReason = '双店账本结构正常'
    }
  } else if (offlineLedger > 0) {
    storeStatus = 'ok'
    storeValue = `¥${fmtMoney(offlineLedger)}`
    storeReason = '账本有入账（未分列）'
  }

  const pledge = round2(Math.max(0, netOnline) * 0.01)
  let pledgeStatus = 'ok'
  let pledgeReason = '线上净额×1% 应捐'
  if (netOnline < 0) {
    pledgeStatus = 'warn'
    pledgeReason = '净额为负，应捐按0计'
  } else if (netOnline <= 0) {
    pledgeStatus = 'muted'
    pledgeReason = '本期无线上净额'
  }

  const list = [
    makeSignal({
      id: 'revenue_mom',
      name: '综合营收',
      value: revMom.value,
      valueRaw: revMom.pct,
      status: revMom.status,
      reason: revMom.reason
    }),
    makeSignal({
      id: 'refund_rate',
      name: '退款健康',
      value: refundValue,
      valueRaw: refundPct,
      status: refundStatus,
      reason: refundReason
    }),
    makeSignal({
      id: 'new_users_mom',
      name: '新增用户',
      value: userMom.value,
      valueRaw: userMom.pct,
      status: userMom.status,
      reason: userMom.reason
    }),
    makeSignal({
      id: 'store_ledger',
      name: '双店账本',
      value: storeValue,
      valueRaw: offlineLedger,
      status: storeStatus,
      reason: storeReason
    }),
    makeSignal({
      id: 'deposit_backlog',
      name: '定金待尾款',
      value: depositValue,
      valueRaw: depositBacklogPct,
      status: depositStatus,
      reason: depositReason
    }),
    makeSignal({
      id: 'commission_reverse',
      name: '提成冲回',
      value: commissionValue,
      valueRaw: reversePct,
      status: commissionStatus,
      reason: commissionReason
    }),
    makeSignal({
      id: 'low_stock',
      name: '低库存',
      value: stockValue,
      valueRaw: lowStock,
      status: stockStatus,
      reason: stockReason
    }),
    makeSignal({
      id: 'pledge_1pct',
      name: '1%应捐',
      value: `¥${fmtMoney(pledge)}`,
      valueRaw: pledge,
      status: pledgeStatus,
      reason: pledgeReason
    })
  ]

  const summary = { ok: 0, warn: 0, danger: 0, muted: 0 }
  list.forEach((s) => {
    if (summary[s.status] != null) summary[s.status] += 1
  })

  return {
    items: list,
    summary,
    rulesNote:
      '环比为周期前后半日均；退款≥8%黄/≥15%红；定金待尾款≥40%/60%；提成冲回≥20%/40%；低库存≥1/≥8；双店空账或单店≥90%关注'
  }
}

async function report(event, actor) {
  const scope = resolveStoreScope(event, actor)
  const [users, orders, catalog, behavior, deposit, commission] = await Promise.all([
    usersMetrics(event),
    ordersMetrics(event, scope),
    catalogMetrics(),
    overview(event),
    depositMetrics(event),
    commissionMetrics(event)
  ])

  const notes = []
    .concat(orders.notes || [])
    .concat(users.notes || [])
    .concat(catalog.notes || [])
    .concat(deposit.notes || [])
    .concat(commission.notes || [])
  if (behavior.note) notes.push(behavior.note)

  const totals = orders.totals || {}
  const ledgerByStore = orders.ledgerByStore || []
  const headline = {
    grandTotal: totals.grandTotal || 0,
    grandTotalFmt: totals.grandTotalFmt || '0.00',
    netOnline: totals.netOnline || 0,
    netOnlineFmt: totals.netOnlineFmt || '0.00',
    gmvPaid: totals.gmvPaid || 0,
    gmvPaidFmt: totals.gmvPaidFmt || '0.00',
    refundAmount: totals.refundAmount || 0,
    refundAmountFmt: totals.refundAmountFmt || '0.00',
    offlineLedger: totals.offlineLedger || 0,
    offlineLedgerFmt: totals.offlineLedgerFmt || '0.00',
    ledgerByStore,
    paidOrders: totals.paid || 0,
    aovFmt: totals.aovFmt || '—',
    newUsers: users.totalNewUsers || 0,
    avgDau: users.avgDau || 0
  }

  const trafficLights = buildTrafficLights({
    orders,
    users,
    deposit,
    commission,
    catalog,
    ledgerByStore
  })

  return {
    range: users.range,
    storeScope: scope,
    notes,
    headline,
    users,
    orders,
    ledgerByStore,
    members: orders.members || { payingUsers: 0, levelShare: [], notes: [] },
    category: orders.category || { byType: [], notes: [] },
    deposit,
    commission,
    catalog,
    signals: trafficLights,
    trafficLights,
    behavior: {
      funnel: behavior.funnel,
      topEvents: (users.topEvents && users.topEvents.length
        ? users.topEvents
        : (behavior.summary && behavior.summary.byAction) || []
      ).slice(0, 12)
    }
  }
}

/**
 * ERP 内容工厂轻量摘要：只返回聚合计数，不回传 uv openid 列表。
 * 替代 admin contentMetrics 对 analytics_daily 的 CDN 直读。
 */
async function behaviorSnippet(event = {}) {
  const days = Math.min(30, Math.max(1, Number(event.days) || 7))
  const end = new Date()
  const keys = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86400000)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    keys.push(`${y}-${m}-${day}`)
  }
  const rows = await loadDailyRollup(keys)
  let totalEvents = 0
  const uv = new Set()
  ;(rows || []).forEach((r) => {
    totalEvents += Number(r.count) || 0
    ;(Array.isArray(r.uv) ? r.uv : []).forEach((u) => {
      if (u) uv.add(String(u))
    })
  })
  return {
    range: keys.length ? `${keys[0]} ~ ${keys[keys.length - 1]}` : '',
    totalEvents,
    uv: uv.size,
    note: '小程序行为埋点摘要，辅助内容复盘（经 getAnalyticsDashboard，不含 openid）'
  }
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''
  const adminOpsKey = event.adminOpsKey
  // 与 manageStoreContent 一致：Admin Web 经 /api/cloud-fn 注入 ADMIN_OPS_KEY，无微信 OPENID
  if (!openid && !adminOpsKey) {
    return { success: false, code: 'UNAUTHORIZED', msg: '请先登录' }
  }

  let guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    permission: 'viewAnalytics',
    adminOpsKey
  })
  if (!guard.ok) {
    guard = await assertStaff(db, openid, { permission: 'viewInvestorAnalytics', adminOpsKey })
  }
  if (!guard.ok) {
    return { success: false, code: guard.code, msg: guard.msg }
  }

  const { action = 'overview' } = event
  const scope = resolveStoreScope(event, guard.actor)

  try {
    let data
    switch (action) {
      case 'users':
        data = await usersMetrics(event)
        break
      case 'orders':
        data = await ordersMetrics(event, scope)
        break
      case 'catalog':
        data = await catalogMetrics()
        break
      case 'deposit':
        data = await depositMetrics(event)
        break
      case 'commission':
        data = await commissionMetrics(event)
        break
      case 'report':
        data = await report(event, guard.actor)
        break
      case 'errors':
        // #26-B：C 端 JS 错误聚合（error_logs 只读代理）
        data = await errorMetrics(event)
        break
      case 'topEvents':
        data = await topEvents(event)
        break
      case 'behaviorSnippet':
        data = await behaviorSnippet(event)
        break
      case 'overview':
      default:
        data = await overview(event)
    }
    return { success: true, data }
  } catch (e) {
    console.error('getAnalyticsDashboard', e)
    return { success: false, msg: e.message }
  }
}
