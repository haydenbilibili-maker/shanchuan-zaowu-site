/**
 * 股东观测台 — 对齐财务核算「股东权益与回报 / 双阶段分红 / 股东汇报摘要」
 *
 * action:
 *   dashboard  只读看板（按股东绑定门店 + 占股/分成裁剪）
 * 返回：signals/trafficLights（股东专属信号灯）+ charts（营收/净利/分成趋势、回本、结构）
 */
const cloud = require('wx-server-sdk')
const { assertStaff } = require('./staffGuard')
const {
  DEFAULT_MALL_THRESHOLD,
  DEFAULT_MALL_RATE,
  FORMULA_NOTE,
  computeMallCommission,
  computeDailyMallCost,
  formatMallForUi
} = require('./mallCommission')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const STAFF_COLLECTION = 'staff_members'
const FINANCE_SETTINGS = 'finance_settings'
const STORE_LEDGER = 'store_ledger'
const OPS_PURCHASES = 'ops_purchases'
const DEFAULT_STORE_ID = 'store_shanhaizaowu'

const STORE_LABELS = {
  store_shanhaizaowu: '山川造物',
  store_xingchen: '星宸标本'
}

const DEFAULT_SETTINGS = {
  target: 200000,
  invest: 300000,
  investCount: 2,
  costRate: 0.35,
  earlyShare: 0.8,
  lateShare: 0.6,
  rent: 35000,
  mallThreshold: DEFAULT_MALL_THRESHOLD,
  mallRate: DEFAULT_MALL_RATE,
  utility: 3000,
  staffCount: 4,
  staffSalary: 4500,
  commRate: 0.03,
  tax: 0.03
}

/** 股东专属信号灯阈值（与超管数据报表同风格，指标换成权益口径） */
const SIGNAL_RULES = {
  momWarnPct: -5,
  momDangerPct: -20,
  halfMinDays: 4,
  /** 个人回本进度 */
  paybackWarnPct: 40,
  paybackOkPct: 70,
  paybackDangerPct: 15,
  /** 净利率 */
  marginOkPct: 10,
  marginWarnPct: 5,
  /** 目标达成 */
  targetOkPct: 90,
  targetWarnPct: 60,
  targetDangerPct: 40,
  /** 商场：额度占用 / 已触发抽成相对营收 */
  mallApproachWarnPct: 80,
  mallFeeWarnOfRevPct: 3,
  mallFeeDangerOfRevPct: 8,
  /** 本期分成相对区间营收（偏低关注） */
  periodDivWarnOfRevPct: 0.5
}

function fail(msg, code) {
  return { success: false, code: code || 'FAIL', msg: msg || '失败' }
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function toDateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function parseRange(event) {
  const rangeType = String((event && event.rangeType) || 'days').trim()
  if (rangeType === 'month') {
    const ym = String((event && event.monthKey) || '').trim()
    const m = ym.match(/^(\d{4})-(\d{2})$/)
    if (m) {
      const y = parseInt(m[1], 10)
      const mo = parseInt(m[2], 10)
      const start = `${m[1]}-${m[2]}-01`
      const endDate = new Date(y, mo, 0)
      return {
        rangeType: 'month',
        rangeLabel: `${m[1]}年${mo}月`,
        startDate: start,
        endDate: toDateKey(endDate),
        monthKey: ym
      }
    }
  }
  const days = Math.max(1, Math.min(365, parseInt((event && event.rangeDays) || 30, 10) || 30))
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - (days - 1))
  return {
    rangeType: 'days',
    rangeLabel: `近${days}日`,
    startDate: toDateKey(start),
    endDate: toDateKey(end),
    rangeDays: days
  }
}

function normalizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw || {}) }
  const num = (v, d) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : d
  }
  // 兼容 ERP 表单百分数 / 小数
  let early = num(s.earlyShare, DEFAULT_SETTINGS.earlyShare)
  let late = num(s.lateShare, DEFAULT_SETTINGS.lateShare)
  if (early > 1) early /= 100
  if (late > 1) late /= 100
  let costRate = num(s.costRate, DEFAULT_SETTINGS.costRate)
  let mallRate = num(s.mallRate, DEFAULT_SETTINGS.mallRate)
  let commRate = num(s.commRate, DEFAULT_SETTINGS.commRate)
  let tax = num(s.tax, DEFAULT_SETTINGS.tax)
  if (costRate > 1) costRate /= 100
  if (mallRate > 1) mallRate /= 100
  if (commRate > 1) commRate /= 100
  if (tax > 1) tax /= 100
  return {
    target: num(s.target, DEFAULT_SETTINGS.target),
    invest: num(s.invest, DEFAULT_SETTINGS.invest),
    investCount: Math.max(1, Math.round(num(s.investCount, DEFAULT_SETTINGS.investCount))),
    costRate,
    earlyShare: early,
    lateShare: late,
    rent: num(s.rent, DEFAULT_SETTINGS.rent),
    mallThreshold: num(s.mallThreshold, DEFAULT_SETTINGS.mallThreshold),
    mallRate,
    utility: num(s.utility, DEFAULT_SETTINGS.utility),
    staffCount: num(s.staffCount, DEFAULT_SETTINGS.staffCount),
    staffSalary: num(s.staffSalary, DEFAULT_SETTINGS.staffSalary),
    commRate,
    tax
  }
}

/** 与 Finance.vue calcProfit 同口径（日成本含按日折算商场抽成） */
function calcProfit(revenue, s) {
  let rev = Number(revenue) || 0
  if (rev < 0) rev = 0
  const monthlyFixed = (s.rent || 0) + (s.utility || 0) + ((s.staffCount || 0) * (s.staffSalary || 0))
  const dailyFixed = monthlyFixed / 30
  const cogs = rev * (s.costRate || 0)
  const comm = rev * (s.commRate || 0)
  const mallCost = computeDailyMallCost(rev, s)
  let opProfit = rev - cogs - comm - mallCost - dailyFixed
  if (opProfit > 0) opProfit *= (1 - (s.tax || 0))
  return { net: opProfit, fixed: dailyFixed }
}

/**
 * 与 Finance.vue calcDistribution 同口径：累计双阶段分红（投资人池 vs 经营团队）
 * 并按股东个人「回本前/后分成」切分个人应得（占投资人分红池比重）。
 * personalBefore / personalAfter 为 0–1 小数。
 */
function calcDistribution(processed, s, personalBefore, personalAfter) {
  const beforePct = Math.max(0, Math.min(1, Number(personalBefore) || 0))
  const afterPct = Math.max(0, Math.min(1, Number(personalAfter) || 0))
  let totalInvestReturn = 0
  let totalOpReturn = 0
  let personalDividend = 0
  let isPaidBack = false
  const daily = []
  processed.forEach((r) => {
    const p = Number(r.profit) || 0
    let investorShare = 0
    let opShare = 0
    let personal = 0
    if (p > 0) {
      const poolSharePct = isPaidBack ? afterPct : beforePct
      if (!isPaidBack) {
        investorShare = p * s.earlyShare
        opShare = p * (1 - s.earlyShare)
        if (totalInvestReturn + investorShare >= s.invest) isPaidBack = true
      } else {
        investorShare = p * s.lateShare
        opShare = p * (1 - s.lateShare)
      }
      personal = investorShare * poolSharePct
      totalInvestReturn += investorShare
      totalOpReturn += opShare
      personalDividend += personal
    }
    daily.push({
      date: String((r && r.date) || '').slice(0, 10),
      investorShare,
      opShare,
      personal,
      isPaidBack
    })
  })
  return {
    investTotal: totalInvestReturn,
    opTotal: totalOpReturn,
    personalDividend,
    isPaidBack,
    daily
  }
}

function ledgerRevenue(row) {
  if (!row) return 0
  const candidates = [row.net, row.revenue, row.amount, row.total, row.gmv]
  for (let i = 0; i < candidates.length; i += 1) {
    const n = Number(candidates[i])
    if (Number.isFinite(n) && n !== 0) return n
  }
  return 0
}

function clampPct(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v < 0) return 0
  if (v > 100) return 100
  return Math.round(v * 1000) / 1000
}

function normalizeProfile(raw) {
  const p = raw || {}
  const storeId = String(p.storeId || '').trim() || DEFAULT_STORE_ID
  const ownershipRatio = clampPct(p.ownershipRatio)
  const legacy = clampPct(p.dividendRatio)
  let before = clampPct(
    p.dividendRatioBeforePayback != null && p.dividendRatioBeforePayback !== ''
      ? p.dividendRatioBeforePayback
      : (p.earlyDividendRatio != null && p.earlyDividendRatio !== '' ? p.earlyDividendRatio : legacy)
  )
  let after = clampPct(
    p.dividendRatioAfterPayback != null && p.dividendRatioAfterPayback !== ''
      ? p.dividendRatioAfterPayback
      : (p.lateDividendRatio != null && p.lateDividendRatio !== '' ? p.lateDividendRatio : before)
  )
  // 未配置分成时回退占股（与旧口径一致）
  if (before <= 0 && ownershipRatio > 0) before = ownershipRatio
  if (after <= 0 && before > 0) after = before
  const dividendRatio = before
  return {
    storeId,
    storeName: p.storeName || STORE_LABELS[storeId] || storeId,
    ownershipRatio,
    dividendRatio,
    dividendRatioBeforePayback: before,
    dividendRatioAfterPayback: after,
    capitalContribution: Math.max(0, Number(p.capitalContribution) || 0),
    effectiveDate: String(p.effectiveDate || '').trim()
  }
}

async function loadFinanceSettings() {
  try {
    const res = await db.collection(FINANCE_SETTINGS).orderBy('_updateTime', 'desc').limit(1).get()
    const row = res.data && res.data[0]
    const raw = (row && (row.settings || row)) || null
    return normalizeSettings(raw)
  } catch (e) {
    return normalizeSettings(null)
  }
}

async function loadLedgerRows(storeId, startDate, endDate) {
  const sid = String(storeId || DEFAULT_STORE_ID).trim()
  try {
    const res = await db
      .collection(STORE_LEDGER)
      .where({
        storeId: sid,
        date: _.gte(startDate).and(_.lte(endDate))
      })
      .orderBy('date', 'asc')
      .limit(1000)
      .get()
    return res.data || []
  } catch (e) {
    // 无复合索引时降级
    try {
      const res = await db.collection(STORE_LEDGER).where({ storeId: sid }).limit(1000).get()
      return (res.data || []).filter((r) => {
        const d = String(r.date || '').slice(0, 10)
        return d >= startDate && d <= endDate
      }).sort((a, b) => String(a.date).localeCompare(String(b.date)))
    } catch (e2) {
      return []
    }
  }
}

async function loadAllLedgerForStore(storeId) {
  const sid = String(storeId || DEFAULT_STORE_ID).trim()
  try {
    const res = await db.collection(STORE_LEDGER).where({ storeId: sid }).orderBy('date', 'asc').limit(2000).get()
    return res.data || []
  } catch (e) {
    try {
      const res = await db.collection(STORE_LEDGER).where({ storeId: sid }).limit(2000).get()
      return (res.data || []).sort((a, b) => String(a.date).localeCompare(String(b.date)))
    } catch (e2) {
      return []
    }
  }
}

function money(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0.00'
  return v.toFixed(2)
}

async function loadPurchaseSummary(storeId, startDate, endDate) {
  const sid = String(storeId || DEFAULT_STORE_ID).trim()
  // entityId 与股东绑定门店对齐；主店别名一并纳入
  const entityIds = sid === 'store_shanhaizaowu' || sid === 'store_1780146782017_6w0okpr'
    ? ['store_shanhaizaowu']
    : [sid]
  try {
    const res = await db
      .collection(OPS_PURCHASES)
      .where({
        entityId: _.in(entityIds),
        deleted: _.neq(true)
      })
      .limit(200)
      .get()
    const rows = (res.data || []).filter((r) => {
      const d = String(r.purchaseDate || '').slice(0, 10)
      if (!d) return true
      return d >= startDate && d <= endDate
    })
    let amount = 0
    let count = 0
    const byStatus = {}
    rows.forEach((r) => {
      count += 1
      amount += Number(r.amount) || 0
      const st = String(r.status || 'draft')
      byStatus[st] = (byStatus[st] || 0) + 1
    })
    const recent = rows
      .slice()
      .sort((a, b) => String(b.purchaseDate || '').localeCompare(String(a.purchaseDate || '')))
      .slice(0, 5)
      .map((r) => ({
        orderNo: r.orderNo || '',
        itemName: r.itemName || '',
        amount: Math.round((Number(r.amount) || 0) * 100) / 100,
        amountFmt: money(r.amount),
        purchaseDate: r.purchaseDate || '',
        statusLabel: r.statusLabel || r.status || '',
        sourceLabel: r.sourceLabel || (r.feishuRecordId ? '飞书' : '手工')
      }))
    return {
      count,
      amount: Math.round(amount * 100) / 100,
      amountFmt: money(amount),
      byStatus,
      recent
    }
  } catch (e) {
    return {
      count: 0,
      amount: 0,
      amountFmt: '0.00',
      byStatus: {},
      recent: [],
      unavailable: true
    }
  }
}

function healthFromMargin(marginPct, roiPct, isPaidBack) {
  if (isPaidBack && marginPct >= 15) {
    return { grade: 'A', text: '已回本且利润健康', suggestion: '可关注扩张节奏与分红节奏，保持现金安全垫。' }
  }
  if (roiPct >= 70 && marginPct >= 10) {
    return { grade: 'B', text: '回本接近完成', suggestion: '继续稳住毛利与固定成本，冲刺回本节点。' }
  }
  if (marginPct >= 5) {
    return { grade: 'C', text: '经营尚可', suggestion: '关注成本与商场抽成，加快回本进度。' }
  }
  if (marginPct > 0) {
    return { grade: 'D', text: '利润偏薄', suggestion: '优先控本与提升坪效，避免拉长回收期。' }
  }
  return { grade: 'E', text: '本期承压', suggestion: '复盘低毛利日与固定开支，必要时调整档期目标。' }
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
    lampClass: meta.lampClass,
    target: partial.target || ''
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

/** 周期前后半日均对比（与 getAnalyticsDashboard 同思路） */
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

function eachDateKey(startDate, endDate) {
  const out = []
  const start = new Date(`${String(startDate).slice(0, 10)}T12:00:00`)
  const end = new Date(`${String(endDate).slice(0, 10)}T12:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return out
  const cur = new Date(start)
  let guard = 0
  while (cur <= end && guard < 400) {
    out.push(toDateKey(cur))
    cur.setDate(cur.getDate() + 1)
    guard += 1
  }
  return out
}

/**
 * 股东专属信号灯：回本 / 本期分成 / 净利率 / 目标 / 商场抽成 / 门店营收
 */
function buildShareholderSignals(pack) {
  const equity = pack.equity || {}
  const period = pack.period || {}
  const mall = (period.mall) || {}
  const series = Array.isArray(pack.series) ? pack.series : []
  const personalRoi = Number(equity.personalRoiPct) || 0
  const poolRoi = Number(equity.poolRoiPct) || 0
  const isPaidBack = equity.status === 'paid_back' || !!pack.isPaidBack
  const marginPct = Number(period.marginPct) || 0
  const targetPct = Number(period.targetPct) || 0
  const periodRev = Number(period.revenue) || 0
  const periodDiv = Number(period.personalDividend) || 0
  const mallFee = Number(mall.fee != null ? mall.fee : period.mallShare) || 0
  const mallReached = Number(mall.reached) || 0
  const mallThreshold = Number(mall.threshold) || 0

  // 1) 回本进度
  let paybackStatus = 'muted'
  let paybackReason = '出资或分成数据不足'
  let paybackValue = `${Math.round(personalRoi * 10) / 10}%`
  if (isPaidBack) {
    paybackStatus = 'ok'
    paybackReason = '投资池已回本，进入回本后分红阶段'
    paybackValue = '已回本'
  } else if (personalRoi >= SIGNAL_RULES.paybackOkPct) {
    paybackStatus = 'ok'
    paybackReason = `个人回本 ≥${SIGNAL_RULES.paybackOkPct}%，接近完成`
  } else if (personalRoi >= SIGNAL_RULES.paybackWarnPct) {
    paybackStatus = 'warn'
    paybackReason = `个人回本 ${paybackValue}，池进度 ${Math.round(poolRoi * 10) / 10}%`
  } else if (personalRoi > 0 && personalRoi < SIGNAL_RULES.paybackDangerPct) {
    paybackStatus = 'danger'
    paybackReason = `个人回本偏低（<${SIGNAL_RULES.paybackDangerPct}%）`
  } else if (personalRoi > 0) {
    paybackStatus = 'warn'
    paybackReason = `个人回本 ${paybackValue}，仍在回收期`
  } else if (periodRev > 0) {
    paybackStatus = 'danger'
    paybackReason = '本期有营收但累计个人分成仍为0'
  }

  // 2) 本期应得分成
  const divMom = halfPeriodMom(
    series.map((r) => ({ personal: Number(r.personal) || 0 })),
    'personal',
    { label: '个人分成' }
  )
  let divStatus = 'muted'
  let divReason = '本期暂无应得分成'
  let divValue = period.personalDividendFmt ? `¥${period.personalDividendFmt}` : '—'
  if (periodDiv > 0) {
    divValue = `¥${money(periodDiv)}`
    const ofRev = pctOrNull(periodDiv, periodRev)
    if (divMom.status === 'danger' || divMom.status === 'warn') {
      divStatus = divMom.status
      divReason = divMom.reason
      if (divMom.value && divMom.value !== '—') divValue = `${divValue} ${divMom.value}`
    } else if (ofRev != null && ofRev < SIGNAL_RULES.periodDivWarnOfRevPct && marginPct < SIGNAL_RULES.marginWarnPct) {
      divStatus = 'warn'
      divReason = '本期分成占营收偏低，利润承压'
    } else {
      divStatus = 'ok'
      divReason = divMom.reason && divMom.status === 'ok'
        ? divMom.reason
        : '本期有应得分成入账'
    }
  } else if (periodRev > 0 && marginPct <= 0) {
    divStatus = 'danger'
    divReason = '本期无分成：净利润未形成分红池'
  } else if (periodRev > 0) {
    divStatus = 'warn'
    divReason = '本期有营收但个人应得分成为0'
  }

  // 3) 净利率
  let marginStatus = 'muted'
  let marginReason = '本期无营收样本'
  let marginValue = '—'
  if (periodRev > 0) {
    marginValue = `${Math.round(marginPct * 10) / 10}%`
    if (marginPct < 0) {
      marginStatus = 'danger'
      marginReason = '净利率为负，成本模型下承压'
    } else if (marginPct < SIGNAL_RULES.marginWarnPct) {
      marginStatus = 'warn'
      marginReason = `净利率 <${SIGNAL_RULES.marginWarnPct}%`
    } else if (marginPct >= SIGNAL_RULES.marginOkPct) {
      marginStatus = 'ok'
      marginReason = `净利率 ≥${SIGNAL_RULES.marginOkPct}%`
    } else {
      marginStatus = 'ok'
      marginReason = '净利率在可接受区间'
    }
  }

  // 4) 目标达成
  let targetStatus = 'muted'
  let targetReason = '未配置月目标或本期无营收'
  let targetValue = '—'
  if (periodRev > 0 || targetPct > 0) {
    targetValue = `${Math.round(targetPct * 10) / 10}%`
    if (targetPct >= SIGNAL_RULES.targetOkPct) {
      targetStatus = 'ok'
      targetReason = `目标达成 ≥${SIGNAL_RULES.targetOkPct}%`
    } else if (targetPct >= SIGNAL_RULES.targetWarnPct) {
      targetStatus = 'warn'
      targetReason = `目标达成 ${targetValue}，未达优秀线`
    } else if (targetPct > 0 && targetPct < SIGNAL_RULES.targetDangerPct) {
      targetStatus = 'danger'
      targetReason = `目标达成 <${SIGNAL_RULES.targetDangerPct}%`
    } else if (targetPct > 0) {
      targetStatus = 'warn'
      targetReason = `目标达成 ${targetValue}`
    }
  }

  // 5) 商场抽成压力
  let mallStatus = 'muted'
  let mallReason = '本月尚未形成抽成基数'
  let mallValue = mallFee > 0 ? `¥${money(mallFee)}` : '—'
  const occupyPct = pctOrNull(mallReached, mallThreshold)
  if (mallThreshold > 0) {
    if (mallFee > 0) {
      mallValue = `¥${money(mallFee)}`
      const feeOfRev = pctOrNull(mallFee, mallReached > 0 ? mallReached : periodRev)
      if (feeOfRev != null && feeOfRev >= SIGNAL_RULES.mallFeeDangerOfRevPct) {
        mallStatus = 'danger'
        mallReason = `抽成占月营收 ≥${SIGNAL_RULES.mallFeeDangerOfRevPct}%`
      } else if (feeOfRev != null && feeOfRev >= SIGNAL_RULES.mallFeeWarnOfRevPct) {
        mallStatus = 'warn'
        mallReason = `已触发超额抽成（占营收 ${feeOfRev}%）`
      } else {
        mallStatus = 'warn'
        mallReason = '已越过抽成阈值，关注对赌成本'
      }
    } else if (occupyPct != null && occupyPct >= SIGNAL_RULES.mallApproachWarnPct) {
      mallStatus = 'warn'
      mallValue = `${occupyPct}%`
      mallReason = `月营收已达阈值 ${occupyPct}%（≥${SIGNAL_RULES.mallApproachWarnPct}%）`
    } else if (occupyPct != null) {
      mallStatus = 'ok'
      mallValue = `${occupyPct}%`
      mallReason = '尚未触发超额抽成'
    }
  }

  // 6) 绑定门店营收健康度
  const revMom = halfPeriodMom(
    series.map((r) => ({ revenue: Number(r.revenue) || 0 })),
    'revenue',
    { label: '门店营收' }
  )
  let storeStatus = revMom.status
  let storeReason = revMom.reason
  let storeValue = revMom.value
  if (periodRev <= 0 && series.every((r) => !(Number(r.revenue) > 0))) {
    storeStatus = 'muted'
    storeValue = '—'
    storeReason = '绑定门店本期账本无入账'
  } else if (periodRev > 0 && storeStatus === 'muted' && series.length < SIGNAL_RULES.halfMinDays) {
    storeStatus = 'ok'
    storeValue = `¥${money(periodRev)}`
    storeReason = '有入账（样本不足，暂不看环比）'
  }

  const list = [
    makeSignal({
      id: 'payback_progress',
      name: '回本进度',
      value: paybackValue,
      valueRaw: personalRoi,
      status: paybackStatus,
      reason: paybackReason,
      target: 'equity'
    }),
    makeSignal({
      id: 'period_dividend',
      name: '本期应得分成',
      value: divValue,
      valueRaw: periodDiv,
      status: divStatus,
      reason: divReason,
      target: 'equity'
    }),
    makeSignal({
      id: 'margin_health',
      name: '净利率',
      value: marginValue,
      valueRaw: marginPct,
      status: marginStatus,
      reason: marginReason,
      target: 'period'
    }),
    makeSignal({
      id: 'target_attain',
      name: '目标达成',
      value: targetValue,
      valueRaw: targetPct,
      status: targetStatus,
      reason: targetReason,
      target: 'period'
    }),
    makeSignal({
      id: 'mall_pressure',
      name: '商场抽成压力',
      value: mallValue,
      valueRaw: mallFee,
      status: mallStatus,
      reason: mallReason,
      target: 'mall'
    }),
    makeSignal({
      id: 'store_revenue',
      name: '门店营收健康',
      value: storeValue,
      valueRaw: periodRev,
      status: storeStatus,
      reason: storeReason,
      target: 'charts'
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
      '回本：个人≥70%绿/<40%黄/<15%红；净利率≥10%绿/<5%黄/<0红；目标≥90%绿/<60%黄/<40%红；商场占用≥80%黄、已抽成占营收≥3%/8%黄红；门店营收看周期前后半环比（−5%/−20%）'
  }
}

/**
 * 图表序列：营收 / 净利 / 个人分成趋势 + 回本进度 + 分成结构
 */
function buildCharts(pack) {
  const range = pack.range || {}
  const startDate = range.startDate
  const endDate = range.endDate
  const byDate = {}
  ;(pack.processedRange || []).forEach((r) => {
    const d = String(r.date || '').slice(0, 10)
    if (!d) return
    byDate[d] = {
      date: d,
      revenue: Number(r.revenue) || 0,
      profit: Number(r.profit) || 0,
      personal: 0
    }
  })
  ;(pack.personalDaily || []).forEach((r) => {
    const d = String(r.date || '').slice(0, 10)
    if (!d || d < startDate || d > endDate) return
    if (!byDate[d]) byDate[d] = { date: d, revenue: 0, profit: 0, personal: 0 }
    byDate[d].personal = Number(r.personal) || 0
  })

  const keys = eachDateKey(startDate, endDate)
  const filled = keys.map((d) => {
    const row = byDate[d] || { date: d, revenue: 0, profit: 0, personal: 0 }
    return {
      date: d,
      dateKey: d,
      label: d.slice(5),
      revenue: Math.round(row.revenue * 100) / 100,
      profit: Math.round(row.profit * 100) / 100,
      personal: Math.round(row.personal * 100) / 100
    }
  })

  // 过长序列桶聚合，控制前端柱数
  const maxPts = keys.length > 45 ? 15 : keys.length > 20 ? 14 : keys.length
  let series = filled
  let hint = ''
  if (filled.length > maxPts && maxPts > 0) {
    const bucket = Math.ceil(filled.length / maxPts)
    const out = []
    for (let i = 0; i < filled.length; i += bucket) {
      const slice = filled.slice(i, i + bucket)
      const first = slice[0]
      const last = slice[slice.length - 1]
      out.push({
        date: last.date,
        dateKey: last.dateKey,
        label:
          first.label !== last.label ? `${first.label}~${last.label}` : first.label,
        revenue: Math.round(slice.reduce((a, b) => a + b.revenue, 0) * 100) / 100,
        profit: Math.round(slice.reduce((a, b) => a + b.profit, 0) * 100) / 100,
        personal: Math.round(slice.reduce((a, b) => a + b.personal, 0) * 100) / 100
      })
    }
    series = out
    hint = `已按 ${bucket} 日聚合展示（共 ${filled.length} 日）`
  }

  const equity = pack.equity || {}
  const period = pack.period || {}
  const structure = [
    {
      key: 'investor',
      label: '投资人分红池',
      value: Number(equity.poolDividend) || 0,
      valueFmt: equity.poolDividendFmt || money(equity.poolDividend)
    },
    {
      key: 'op',
      label: '经营团队收益',
      value: Number(equity.opDividend) || 0,
      valueFmt: equity.opDividendFmt || money(equity.opDividend)
    }
  ].filter((x) => x.value > 0)

  const payback = {
    personalPct: Math.min(100, Math.max(0, Number(equity.personalRoiPct) || 0)),
    poolPct: Math.min(100, Math.max(0, Number(equity.poolRoiPct) || 0)),
    personalDividendFmt: equity.personalDividendFmt || '0.00',
    personalCapitalFmt: equity.personalCapitalFmt || '0.00',
    leftPersonalFmt: equity.leftPersonalFmt || '0.00',
    status: equity.status || 'recovering',
    statusLabel: equity.statusLabel || ''
  }

  return {
    revenue: series.map((r) => ({
      dateKey: r.dateKey,
      date: r.date,
      label: r.label,
      value: r.revenue
    })),
    profit: series.map((r) => ({
      dateKey: r.dateKey,
      date: r.date,
      label: r.label,
      value: r.profit
    })),
    personal: series.map((r) => ({
      dateKey: r.dateKey,
      date: r.date,
      label: r.label,
      value: r.personal
    })),
    // 兼容旧前端：扁平日序列
    daily: series,
    payback,
    structure,
    periodSummary: {
      revenue: Number(period.revenue) || 0,
      profit: Number(period.profit) || 0,
      personalDividend: Number(period.personalDividend) || 0,
      mallShare: Number(period.mallShare) || 0
    },
    hint,
    empty: !series.some((r) => r.revenue > 0 || r.profit > 0 || r.personal > 0)
  }
}

async function buildDashboard(event, openid, actor) {
  const staffRes = await db.collection(STAFF_COLLECTION).where({ openid, status: 'active' }).limit(1).get()
  const staffRow = (staffRes.data && staffRes.data[0]) || null
  const isSuper = !!(actor && (actor.superAdmin || (actor.roles || []).indexOf('super_admin') !== -1))
  let profile = normalizeProfile(staffRow && staffRow.shareholderProfile)

  // 超管预览：可指定 storeId / 双阶段分成查看
  if (isSuper && event && event.storeId) {
    profile = normalizeProfile({
      ...profile,
      storeId: event.storeId,
      ownershipRatio: event.ownershipRatio != null ? event.ownershipRatio : (profile.ownershipRatio || 50),
      dividendRatio: event.dividendRatio != null ? event.dividendRatio : profile.dividendRatio,
      dividendRatioBeforePayback:
        event.dividendRatioBeforePayback != null
          ? event.dividendRatioBeforePayback
          : (event.dividendRatio != null ? event.dividendRatio : profile.dividendRatioBeforePayback),
      dividendRatioAfterPayback:
        event.dividendRatioAfterPayback != null
          ? event.dividendRatioAfterPayback
          : profile.dividendRatioAfterPayback,
      capitalContribution: event.capitalContribution != null ? event.capitalContribution : profile.capitalContribution
    })
  }

  if (!profile.storeId) {
    return fail('尚未配置股东绑定门店，请联系超管在股东配置中填写', 'PROFILE_INCOMPLETE')
  }

  const range = parseRange(event)
  const settings = await loadFinanceSettings()
  const allRows = await loadAllLedgerForStore(profile.storeId)
  const rangeRows = allRows.filter((r) => {
    const d = String(r.date || '').slice(0, 10)
    return d >= range.startDate && d <= range.endDate
  })

  const processedAll = allRows.map((r) => {
    const revenue = ledgerRevenue(r)
    const profit = calcProfit(revenue, settings).net
    return { date: String(r.date || '').slice(0, 10), revenue, profit }
  })
  const processedRange = rangeRows.map((r) => {
    const revenue = ledgerRevenue(r)
    const profit = calcProfit(revenue, settings).net
    return { date: String(r.date || '').slice(0, 10), revenue, profit }
  })

  const investCount = Math.max(1, settings.investCount || 1)
  let personalBefore = (profile.dividendRatioBeforePayback || 0) / 100
  let personalAfter = (profile.dividendRatioAfterPayback || 0) / 100
  if (personalBefore <= 0) personalBefore = 1 / investCount
  if (personalAfter <= 0) personalAfter = personalBefore

  const dist = calcDistribution(processedAll, settings, personalBefore, personalAfter)
  const personalPoolShare = dist.isPaidBack ? personalAfter : personalBefore

  const personalDividend = dist.personalDividend
  const personalCapital =
    profile.capitalContribution > 0
      ? profile.capitalContribution
      : settings.invest * ((profile.ownershipRatio || 0) / 100 || personalBefore)
  const personalRoiPct = personalCapital > 0 ? Math.min(100, (personalDividend / personalCapital) * 100) : 0
  const poolRoiPct = settings.invest > 0 ? Math.min(100, (dist.investTotal / settings.invest) * 100) : 0
  const leftPool = Math.max(0, settings.invest - dist.investTotal)
  const leftPersonal = Math.max(0, personalCapital - personalDividend)

  let paybackDate = '数据不足'
  if (leftPool <= 0) {
    paybackDate = '已完成'
  } else {
    const recent = processedAll.slice(-30)
    if (recent.length) {
      const avgProfit = recent.reduce((a, b) => a + b.profit, 0) / recent.length
      if (avgProfit > 0) {
        const dailyShare = avgProfit * settings.earlyShare
        const daysLeft = Math.ceil(leftPool / dailyShare)
        const date = new Date()
        date.setDate(date.getDate() + daysLeft)
        paybackDate = toDateKey(date)
      } else {
        paybackDate = '暂无盈利'
      }
    }
  }

  const rangeRevenue = processedRange.reduce((a, b) => a + b.revenue, 0)
  const rangeProfit = processedRange.reduce((a, b) => a + b.profit, 0)
  const marginPct = rangeRevenue > 0 ? (rangeProfit / rangeRevenue) * 100 : 0
  const targetPct = settings.target > 0 ? (rangeRevenue / settings.target) * 100 : 0
  // 本期应得分成：按全日序走双阶段，再汇总区间内个人应得（跨回本日也正确）
  const personalPeriodDividend = (dist.daily || [])
    .filter((d) => d.date >= range.startDate && d.date <= range.endDate)
    .reduce((a, b) => a + (Number(b.personal) || 0), 0)

  // 商场月累计超额分成（与财务核算「商场分成情况」同口径；非自然月区间改用区间末自然月累计）
  const mallMonthKey =
    range.rangeType === 'month' && range.monthKey
      ? range.monthKey
      : String(range.endDate || '').slice(0, 7) || toDateKey(new Date()).slice(0, 7)
  const mallMonthRevenue = processedAll
    .filter((r) => String(r.date || '').startsWith(mallMonthKey))
    .reduce((a, b) => a + (Number(b.revenue) || 0), 0)
  const mall = formatMallForUi(computeMallCommission(mallMonthRevenue, settings))

  const health = healthFromMargin(marginPct, poolRoiPct, dist.isPaidBack)
  const personalByDate = {}
  ;(dist.daily || []).forEach((row) => {
    const d = String(row.date || '').slice(0, 10)
    if (d) personalByDate[d] = Number(row.personal) || 0
  })
  const series = processedRange.map((r) => {
    const d = String(r.date || '').slice(0, 10)
    return {
      date: d,
      label: (d || '').slice(5),
      revenue: Math.round(r.revenue * 100) / 100,
      profit: Math.round(r.profit * 100) / 100,
      personal: Math.round((personalByDate[d] || 0) * 100) / 100
    }
  })

  const purchases = await loadPurchaseSummary(profile.storeId, range.startDate, range.endDate)

  const equityPack = {
    status: dist.isPaidBack ? 'paid_back' : 'recovering',
    statusLabel: dist.isPaidBack ? '已回本盈利' : '投资回收期',
    poolDividend: Math.round(dist.investTotal * 100) / 100,
    poolDividendFmt: money(dist.investTotal),
    opDividend: Math.round(dist.opTotal * 100) / 100,
    opDividendFmt: money(dist.opTotal),
    poolRoiPct: Math.round(poolRoiPct * 10) / 10,
    leftPool: Math.round(leftPool * 100) / 100,
    leftPoolFmt: money(leftPool),
    paybackDate,
    personalDividend: Math.round(personalDividend * 100) / 100,
    personalDividendFmt: money(personalDividend),
    personalCapital: Math.round(personalCapital * 100) / 100,
    personalCapitalFmt: money(personalCapital),
    personalRoiPct: Math.round(personalRoiPct * 10) / 10,
    leftPersonal: Math.round(leftPersonal * 100) / 100,
    leftPersonalFmt: money(leftPersonal),
    personalPoolSharePct: Math.round(personalPoolShare * 1000) / 10,
    personalPoolShareBeforePct: Math.round(personalBefore * 1000) / 10,
    personalPoolShareAfterPct: Math.round(personalAfter * 1000) / 10,
    currentInvestorSharePct: dist.isPaidBack
      ? Math.round(settings.lateShare * 1000) / 10
      : Math.round(settings.earlyShare * 1000) / 10,
    currentOpSharePct: dist.isPaidBack
      ? Math.round((1 - settings.lateShare) * 1000) / 10
      : Math.round((1 - settings.earlyShare) * 1000) / 10
  }

  const periodPack = {
    revenue: Math.round(rangeRevenue * 100) / 100,
    revenueFmt: money(rangeRevenue),
    profit: Math.round(rangeProfit * 100) / 100,
    profitFmt: money(rangeProfit),
    marginPct: Math.round(marginPct * 10) / 10,
    targetPct: Math.round(targetPct * 10) / 10,
    personalDividend: Math.round(personalPeriodDividend * 100) / 100,
    personalDividendFmt: money(personalPeriodDividend),
    mallShare: mall.fee,
    mallShareFmt: mall.feeFmt,
    mallMonthKey,
    mall: {
      monthKey: mallMonthKey,
      threshold: mall.threshold,
      thresholdFmt: mall.thresholdFmt,
      reached: mall.reached,
      reachedFmt: mall.reachedFmt,
      excess: mall.excess,
      excessFmt: mall.excessFmt,
      fee: mall.fee,
      feeFmt: mall.feeFmt,
      ratePct: mall.ratePct,
      formulaNote: mall.formulaNote
    },
    dayCount: processedRange.length
  }

  const rangePack = {
    type: range.rangeType,
    label: range.rangeLabel,
    startDate: range.startDate,
    endDate: range.endDate,
    days: range.rangeDays || null,
    monthKey: range.monthKey || null
  }

  const trafficLights = buildShareholderSignals({
    equity: equityPack,
    period: periodPack,
    series,
    isPaidBack: dist.isPaidBack
  })

  const charts = buildCharts({
    range: rangePack,
    processedRange,
    personalDaily: dist.daily || [],
    equity: equityPack,
    period: periodPack
  })

  return {
    success: true,
    profile: {
      ...profile,
      name: (staffRow && staffRow.name) || (actor && actor.name) || ''
    },
    range: rangePack,
    settings: {
      invest: settings.invest,
      investCount: settings.investCount,
      earlySharePct: Math.round(settings.earlyShare * 1000) / 10,
      lateSharePct: Math.round(settings.lateShare * 1000) / 10,
      target: settings.target,
      mallThreshold: settings.mallThreshold,
      mallRatePct: Math.round(settings.mallRate * 1000) / 10,
      mallFormulaNote: FORMULA_NOTE
    },
    equity: equityPack,
    period: periodPack,
    purchases,
    health,
    report: {
      title: `股东汇报摘要 · ${range.rangeLabel}`,
      insight: health.suggestion,
      generatedAt: new Date().toISOString()
    },
    series,
    signals: trafficLights,
    trafficLights,
    charts,
    notes: [
      '口径对齐财务核算：双阶段分红（回本前/后投资人池占比 earlyShare/lateShare），净利润按成本模型估算。',
      '回本判定：累计投资人分红池 ≥ 总投资额（finance_settings.invest）后进入回本后阶段。',
      '个人应得分成 = 当日投资人分红池 ×（回本前 dividendRatioBeforePayback / 回本后 dividendRatioAfterPayback）；旧字段 dividendRatio 视为回本前。',
      '未填个人分成时回退占股比例或按投资人数均分；仅展示绑定门店账本。',
      FORMULA_NOTE,
      '采购摘要来自 ops_purchases（飞书/ERP 同源），按绑定门店与统计区间过滤，只读。',
      '信号灯为股东专属口径（回本/分成/净利率/目标/商场抽成/门店营收），与超管数据报表 8 盏灯指标不同。'
    ]
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const action = String((event && event.action) || 'dashboard').trim() || 'dashboard'

  try {
    const guard = await assertStaff(db, openid, { permission: 'viewShareholderObservatory' })
    if (!guard.ok) {
      return { success: false, code: guard.code, msg: guard.msg }
    }

    if (action === 'dashboard' || action === 'getDashboard') {
      return await buildDashboard(event || {}, openid, guard.actor)
    }

    return fail('未知操作')
  } catch (e) {
    console.error('getShareholderObservatory', e)
    return fail(e.message || '股东观测台加载失败')
  }
}
