/**
 * 采购管理仪表盘聚合 — 信号灯 / KPI / 趋势 / 类型占比
 * 数据源：ops_purchases + configs/studio_budget_pools（可采购池）
 */
const { roundMoney, mapRow, STATUS } = require('./purchaseDefaults')
const {
  BUDGET_POOLS,
  HARDWARE_BUDGET_TYPES,
  SPECIMEN_BUDGET_TYPES
} = require('./budgetDefaults')

const CONFIGS = 'configs'
const BUDGET_CONFIG_ID = 'studio_budget_pools'

function moneyText(n) {
  const v = roundMoney(n)
  return v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function pctOrNull(num, den) {
  const n = Number(num) || 0
  const d = Number(den) || 0
  if (d <= 0) return null
  return Math.round((n / d) * 1000) / 10
}

function signalStatusMeta(status) {
  const map = {
    ok: { statusLabel: '正常', lampClass: 'blink', tone: 'up' },
    warn: { statusLabel: '关注', lampClass: 'warn', tone: 'warn' },
    danger: { statusLabel: '告警', lampClass: 'danger', tone: 'down' },
    muted: { statusLabel: '持平', lampClass: 'lamp-muted', tone: 'flat' }
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
    tone: meta.tone,
    reason: partial.reason || '',
    lampClass: meta.lampClass
  }
}

function statusRank(status) {
  if (status === 'danger') return 3
  if (status === 'warn') return 2
  if (status === 'ok') return 1
  return 0
}

function shanghaiYmd(ms) {
  const d = new Date(Number(ms) || Date.now())
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d)
}

function monthKeyFromDate(ymd) {
  const s = String(ymd || '').trim()
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7)
  return ''
}

function addMonths(ym, delta) {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})$/)
  if (!m) return ''
  const d = new Date(Number(m[1]), Number(m[2]) - 1 + delta, 1)
  const mo = d.getMonth() + 1
  return `${d.getFullYear()}-${mo < 10 ? '0' : ''}${mo}`
}

function purchaseAmount(row) {
  if (!row) return 0
  if (row.amount != null) return roundMoney(row.amount)
  return roundMoney((Number(row.qty) || 0) * (Number(row.unitPrice) || 0))
}

function purchaseMonthKey(row) {
  const fromDate = monthKeyFromDate(row && row.purchaseDate)
  if (fromDate) return fromDate
  const ms = Number(row && (row.createdAt || row.updatedAt)) || 0
  if (ms > 0) return monthKeyFromDate(shanghaiYmd(ms))
  return ''
}

function isActivePurchase(row) {
  if (!row || row.deleted) return false
  return String(row.status || '') !== STATUS.CANCELLED && String(row.status || '') !== 'cancelled'
}

function isUnlabeledType(row) {
  const bt = String((row && row.budgetType) || '').trim()
  return !bt || bt === '未标注' || bt === '其他'
}

function isOpenStatus(row) {
  const st = String((row && row.status) || '')
  return (
    st === STATUS.DRAFT ||
    st === STATUS.PENDING_PAY ||
    st === STATUS.PAID ||
    st === STATUS.ORDERED ||
    st === STATUS.PENDING_SHIP ||
    st === STATUS.SHIPPED
  )
}

function groupSum(rows, keyFn, amountFn) {
  const map = {}
  ;(rows || []).forEach((r) => {
    const key = keyFn(r) || '未标注'
    if (!map[key]) map[key] = { key, label: key, amount: 0, count: 0 }
    map[key].amount = roundMoney(map[key].amount + amountFn(r))
    map[key].count += 1
  })
  return Object.keys(map)
    .map((k) => map[k])
    .sort((a, b) => b.amount - a.amount || b.count - a.count)
}

function buildMonthTrend(rows, months = 12) {
  const map = {}
  ;(rows || []).forEach((r) => {
    const key = purchaseMonthKey(r)
    if (!key) return
    if (!map[key]) map[key] = { key, label: key, amount: 0, count: 0 }
    map[key].amount = roundMoney(map[key].amount + purchaseAmount(r))
    map[key].count += 1
  })
  const todayYm = monthKeyFromDate(shanghaiYmd(Date.now()))
  const keys = []
  for (let i = months - 1; i >= 0; i -= 1) {
    const k = addMonths(todayYm, -i)
    if (k) keys.push(k)
  }
  return keys
    .map((k) => map[k] || { key: k, label: k, amount: 0, count: 0 })
    .filter((r) => r.amount > 0 || r.count > 0)
}

function buildStructure(rows, total) {
  const list = (rows || []).filter((x) => Number(x.amount) > 0 || Number(x.count) > 0)
  const sum = list.reduce((n, x) => n + (Number(x.amount) || 0), 0) || total || 1
  const tones = ['used', 'rent', 'ok', 'safety', 'fixed']
  return list.slice(0, 8).map((x, i) => {
    const amount = roundMoney(x.amount)
    const pct = Math.max(1, Math.round((amount / sum) * 1000) / 10)
    return {
      key: x.key || x.label,
      label: x.label || x.key || '未标注',
      amount,
      count: x.count || 0,
      pct,
      widthPct: Math.max(2, Math.round((amount / sum) * 100)),
      tone: tones[i % tones.length]
    }
  })
}

async function fetchAll(db, collection, where, limit = 2000) {
  const col = db.collection(collection)
  const out = []
  let skip = 0
  while (skip < limit) {
    const take = Math.min(100, limit - skip)
    let q = col
    if (where) q = q.where(where)
    const res = await q.skip(skip).limit(take).get()
    const list = (res && res.data) || []
    out.push(...list)
    if (list.length < take) break
    skip += list.length
  }
  return out
}

async function loadBudgetPools(db) {
  try {
    const res = await db.collection(CONFIGS).doc(BUDGET_CONFIG_ID).get()
    const doc = res && res.data
    if (doc && Array.isArray(doc.pools) && doc.pools.length) return doc.pools
  } catch (e) {
    /* defaults */
  }
  return BUDGET_POOLS
}

function poolByCategory(pools, category) {
  return (pools || []).find((p) => p.category === category) || null
}

function buildPurchaseSignals(pack) {
  const {
    count,
    purchaseTotal,
    monthCount,
    prevMonthCount,
    monthAmount,
    prevMonthAmount,
    unlabeledPct,
    openPct,
    purchasableBudget,
    purchasableRemaining,
    hasBudget
  } = pack

  // 1) 本月活跃度
  let actStatus = 'muted'
  let actReason = '尚无本月采购样本'
  let actValue = String(monthCount || 0)
  if (count <= 0) {
    actStatus = 'muted'
    actReason = '柜中暂无采购记录'
    actValue = '—'
  } else if (monthCount <= 0) {
    actStatus = 'warn'
    actReason = '本月尚无采购，进货节奏偏静'
  } else if (prevMonthCount > 0) {
    const deltaPct = pctOrNull(monthCount - prevMonthCount, prevMonthCount)
    actValue = `${monthCount} 笔`
    if (deltaPct != null && deltaPct >= 80) {
      actStatus = 'warn'
      actReason = `本月笔数较上月陡升 ${deltaPct}%，宜核对预算`
    } else if (deltaPct != null && deltaPct <= -40) {
      actStatus = 'warn'
      actReason = `本月笔数较上月回落 ${Math.abs(deltaPct)}%`
    } else {
      actStatus = 'ok'
      actReason =
        deltaPct != null && deltaPct > 0
          ? `本月笔数较上月升 ${deltaPct}%`
          : '本月采购节奏平稳'
    }
  } else {
    actStatus = 'ok'
    actValue = `${monthCount} 笔`
    actReason = '本月已有采购，样本尚浅可续记'
  }

  // 2) 本月采购额
  let amtStatus = 'muted'
  let amtReason = '暂无金额样本'
  let amtValue = monthAmount > 0 ? `¥${moneyText(monthAmount)}` : '—'
  if (count > 0) {
    if (!(purchaseTotal > 0)) {
      amtStatus = 'danger'
      amtReason = '采购金额合计为 0，请核对单价'
      amtValue = '¥0'
    } else if (prevMonthAmount > 0) {
      const drop = pctOrNull(monthAmount - prevMonthAmount, prevMonthAmount)
      amtValue = `¥${moneyText(monthAmount)}`
      if (monthAmount <= 0 && monthCount > 0) {
        amtStatus = 'danger'
        amtReason = '本月有单无金额，账目未闭合'
      } else if (drop != null && drop >= 100) {
        amtStatus = 'warn'
        amtReason = `本月采购额较上月翻倍+（+${drop}%）`
      } else if (drop != null && drop <= -50) {
        amtStatus = 'warn'
        amtReason = `本月采购额较上月骤降 ${Math.abs(drop)}%`
      } else {
        amtStatus = 'ok'
        amtReason = '本月采购额走势尚安'
      }
    } else {
      amtStatus = purchaseTotal > 0 ? 'ok' : 'warn'
      amtReason = purchaseTotal > 0 ? '累计采购额已入柜' : '金额样本偏少'
      amtValue = `¥${moneyText(purchaseTotal)}`
    }
  }

  // 3) 超预算 / 可采购池
  let budStatus = 'muted'
  let budReason = '可采购池未配置'
  let budValue = '—'
  if (hasBudget && purchasableBudget > 0) {
    budValue = `¥${moneyText(purchasableRemaining)}`
    if (purchasableRemaining < 0) {
      budStatus = 'danger'
      budReason = `可采购池已超支 ¥${moneyText(Math.abs(purchasableRemaining))}`
    } else {
      const leftPct = pctOrNull(purchasableRemaining, purchasableBudget)
      if (leftPct != null && leftPct <= 15) {
        budStatus = 'danger'
        budReason = `可采购剩余仅 ${leftPct}%，新单宜克制`
      } else if (leftPct != null && leftPct <= 30) {
        budStatus = 'warn'
        budReason = `可采购剩余 ${leftPct}%，接近警戒`
      } else {
        budStatus = 'ok'
        budReason = '可采购额度仍在安全线内'
      }
    }
  } else if (purchaseTotal > 0) {
    budStatus = 'muted'
    budReason = '未取到预算池，超预算灯暂缺'
    budValue = `已采 ¥${moneyText(purchaseTotal)}`
  }

  // 4) 未标注预算类型占比
  let typStatus = 'muted'
  let typReason = '暂无单据可检'
  let typValue = unlabeledPct != null ? `${unlabeledPct}%` : '—'
  if (count > 0 && unlabeledPct != null) {
    if (unlabeledPct >= 40) {
      typStatus = 'danger'
      typReason = `未标注预算类型约 ${unlabeledPct}%，结构难读`
    } else if (unlabeledPct >= 15) {
      typStatus = 'warn'
      typReason = `未标注类型约 ${unlabeledPct}%，宜补全`
    } else {
      typStatus = 'ok'
      typReason = '预算类型标注尚可'
    }
  }

  // 5) 在途/未闭环占比
  let openStatus = 'muted'
  let openReason = '暂无在途样本'
  let openValue = openPct != null ? `${openPct}%` : '—'
  if (count > 0 && openPct != null) {
    if (openPct >= 50) {
      openStatus = 'danger'
      openReason = `未闭环单据约 ${openPct}%，宜跟进到货入库`
    } else if (openPct >= 25) {
      openStatus = 'warn'
      openReason = `未闭环约 ${openPct}%，留意物流与签收`
    } else {
      openStatus = 'ok'
      openReason = '多数单据已闭环或近闭环'
    }
  }

  // 6) 采购笔数健康度
  let volStatus = 'muted'
  let volReason = '样本不足'
  let volValue = String(count || 0)
  if (count <= 0) {
    volStatus = 'muted'
    volReason = '尚无有效采购单'
    volValue = '—'
  } else if (count < 5) {
    volStatus = 'warn'
    volReason = '有效单据偏少，趋势仅供参考'
  } else {
    volStatus = 'ok'
    volReason = `有效采购 ${count} 笔已入账`
  }

  const items = [
    makeSignal({
      id: 'month_activity',
      name: '本月笔数',
      value: actValue,
      valueRaw: monthCount,
      status: actStatus,
      reason: actReason
    }),
    makeSignal({
      id: 'month_amount',
      name: '本月采购额',
      value: amtValue,
      valueRaw: monthAmount || purchaseTotal,
      status: amtStatus,
      reason: amtReason
    }),
    makeSignal({
      id: 'budget_pool',
      name: '可采购剩余',
      value: budValue,
      valueRaw: purchasableRemaining,
      status: budStatus,
      reason: budReason
    }),
    makeSignal({
      id: 'type_label',
      name: '未标注类型',
      value: typValue,
      valueRaw: unlabeledPct,
      status: typStatus,
      reason: typReason
    }),
    makeSignal({
      id: 'open_orders',
      name: '未闭环占比',
      value: openValue,
      valueRaw: openPct,
      status: openStatus,
      reason: openReason
    }),
    makeSignal({
      id: 'volume',
      name: '采购笔数',
      value: volValue,
      valueRaw: count,
      status: volStatus,
      reason: volReason
    })
  ]

  let worst = 'muted'
  items.forEach((it) => {
    if (statusRank(it.status) > statusRank(worst)) worst = it.status
  })
  const summary = { ok: 0, warn: 0, danger: 0, muted: 0 }
  items.forEach((it) => {
    if (summary[it.status] != null) summary[it.status] += 1
  })

  const verdictMap = {
    ok: {
      title: '采购安稳',
      label: '向好',
      tone: 'up',
      className: 'blink',
      insight: '本月采购与预算节奏尚安，可按计划推进进货。'
    },
    warn: {
      title: '宜留意',
      label: '关注',
      tone: 'warn',
      className: 'warn',
      insight: '活跃度、类型标注或可采购池已近黄灯，新单宜先核对。'
    },
    danger: {
      title: '采购承压',
      label: '告警',
      tone: 'down',
      className: 'danger',
      insight: '可采购超支、类型缺失或未闭环偏高，请先核对预算与单据字段。'
    },
    muted: {
      title: '样本不足',
      label: '持平',
      tone: 'flat',
      className: 'lamp-muted',
      insight: '有效采购尚少，灯色暂作参考；录入或同步后会更清晰。'
    }
  }
  const verdict = Object.assign({}, verdictMap[worst] || verdictMap.muted)
  if (count > 0 && worst === 'ok') {
    verdict.insight = `近柜共 ${count} 笔 · 采购额 ¥${moneyText(purchaseTotal)}。${verdict.insight}`
  }

  return {
    items,
    summary,
    verdict,
    rulesNote:
      '绿·正常 / 黄·关注 / 红·告警。可采购为负必红；剩余≤30%黄、≤15%红；未标注类型≥15%黄、≥40%红；未闭环≥25%黄、≥50%红。'
  }
}

/**
 * @param {object} opts
 * @param {object} opts.db
 * @param {string[]|null} opts.entityFilter  null=超管全量；数组=店长可见主体
 * @param {string} [opts.scope] store|studio|''
 * @param {string} [opts.entityId]
 */
async function buildPurchaseDashboard(opts) {
  const db = opts.db
  const _ = db.command
  const entityFilter = opts.entityFilter
  const scope = String(opts.scope || '').trim()
  const entityId = String(opts.entityId || '').trim()

  const where = { deleted: _.neq(true) }
  if (scope === 'store' || scope === 'studio') where.scope = scope
  if (entityId) {
    if (entityFilter && entityFilter.indexOf(entityId) === -1) {
      const emptySignals = buildPurchaseSignals(emptySignalPack())
      return {
        empty: true,
        kpis: emptyKpis(),
        signals: emptySignals,
        verdict: emptySignals.verdict,
        charts: emptyCharts()
      }
    }
    where.entityId = entityId
  } else if (entityFilter && entityFilter.length) {
    where.entityId = _.in(entityFilter)
  }

  const [raw, pools] = await Promise.all([
    fetchAll(db, 'ops_purchases', where, 3000),
    loadBudgetPools(db)
  ])
  const mapped = raw.map(mapRow).filter(Boolean)
  const purchases = mapped.filter(isActivePurchase)

  const todayYm = monthKeyFromDate(shanghaiYmd(Date.now()))
  const prevYm = addMonths(todayYm, -1)

  let purchaseTotal = 0
  let monthCount = 0
  let prevMonthCount = 0
  let monthAmount = 0
  let prevMonthAmount = 0
  let unlabeledCount = 0
  let openCount = 0
  let hardwareSpend = 0
  let specimenSpend = 0

  purchases.forEach((row) => {
    const amt = purchaseAmount(row)
    purchaseTotal = roundMoney(purchaseTotal + amt)
    const mk = purchaseMonthKey(row)
    if (mk === todayYm) {
      monthCount += 1
      monthAmount = roundMoney(monthAmount + amt)
    } else if (mk === prevYm) {
      prevMonthCount += 1
      prevMonthAmount = roundMoney(prevMonthAmount + amt)
    }
    if (isUnlabeledType(row)) unlabeledCount += 1
    if (isOpenStatus(row)) openCount += 1
    const bt = String(row.budgetType || '')
    if (HARDWARE_BUDGET_TYPES.indexOf(bt) !== -1) hardwareSpend = roundMoney(hardwareSpend + amt)
    if (SPECIMEN_BUDGET_TYPES.indexOf(bt) !== -1) specimenSpend = roundMoney(specimenSpend + amt)
  })

  const count = purchases.length
  const unlabeledPct = pctOrNull(unlabeledCount, count)
  const openPct = pctOrNull(openCount, count)

  const totalPool = poolByCategory(pools, '总预算') || pools.find((p) => p.poolKey === 'total')
  const safetyPool = poolByCategory(pools, '安全资金')
  const rentPool = poolByCategory(pools, '房租')
  const broadbandPool = poolByCategory(pools, '宽带')
  const purchasablePool =
    poolByCategory(pools, '采购控制') || pools.find((p) => p.poolKey === 'purchasable')

  const totalBudget = roundMoney((totalPool && totalPool.annualAmount) || 200000)
  const safetyReserve = roundMoney((safetyPool && safetyPool.annualAmount) || 60000)
  const rentBudget = roundMoney((rentPool && rentPool.annualAmount) || 54200)
  const broadbandBudget = roundMoney((broadbandPool && broadbandPool.annualAmount) || 1098)
  const purchasableBudget = roundMoney(
    (purchasablePool && purchasablePool.annualAmount) ||
      totalBudget - safetyReserve - rentBudget - broadbandBudget
  )
  const hasBudget = purchasableBudget > 0
  const purchasableRemaining = roundMoney(purchasableBudget - purchaseTotal)
  const usagePct = pctOrNull(purchaseTotal, purchasableBudget)

  const byBudgetType = groupSum(purchases, (r) => r.budgetType || '未标注', purchaseAmount)
  const byCategory = groupSum(purchases, (r) => r.category || '未分类', purchaseAmount)
  const byEntity = groupSum(purchases, (r) => r.entityName || r.entityId || '未标注', purchaseAmount)
  const byStatus = groupSum(purchases, (r) => r.statusLabel || r.status || '未知', () => 0).map(
    (x) => ({ label: x.label, key: x.key, count: x.count, amount: 0 })
  )
  const byItem = groupSum(purchases, (r) => r.itemName || '未命名', purchaseAmount).slice(0, 12)

  const trend = buildMonthTrend(purchases, 12)
  const typeStructure = buildStructure(byBudgetType, purchaseTotal)
  const categoryStructure = buildStructure(byCategory, purchaseTotal)

  const monthDeltaPct =
    prevMonthCount > 0 ? pctOrNull(monthCount - prevMonthCount, prevMonthCount) : null
  const amountDeltaPct =
    prevMonthAmount > 0 ? pctOrNull(monthAmount - prevMonthAmount, prevMonthAmount) : null

  const signalPack = {
    count,
    purchaseTotal,
    monthCount,
    prevMonthCount,
    monthAmount,
    prevMonthAmount,
    unlabeledPct,
    openPct,
    purchasableBudget,
    purchasableRemaining,
    hasBudget
  }
  const signals = buildPurchaseSignals(signalPack)

  return {
    empty: count === 0,
    title: '采购观测台',
    subtitle: '本月采购 · 可采购池 · 类型标注 · 未闭环',
    sourceNote:
      '指标来自云库 ops_purchases 实时聚合；可采购剩余对照 configs/studio_budget_pools。飞书「采购记录」经同步写入本集合。',
    kpis: {
      purchaseCount: count,
      purchaseTotal,
      monthCount,
      monthAmount,
      prevMonthCount,
      prevMonthAmount,
      monthDeltaPct,
      amountDeltaPct,
      unlabeledCount,
      unlabeledPct,
      openCount,
      openPct,
      purchasableBudget,
      purchasableRemaining,
      usagePct,
      hardwareSpend,
      specimenSpend,
      overspendAmount: roundMoney(Math.max(0, -purchasableRemaining)),
      hasBudget
    },
    signals,
    verdict: signals.verdict,
    charts: {
      purchaseTrend: trend,
      trendNote: trend.length
        ? '按采购日期（或缺省创建时间）按月汇总，近 12 个月有数据的月份。'
        : '暂无带日期的采购记录，趋势图暂缺。',
      byBudgetType,
      byCategory,
      byEntity,
      byStatus,
      byItem,
      typeStructure,
      categoryStructure,
      progress: {
        used: purchaseTotal,
        total: purchasableBudget,
        remaining: purchasableRemaining,
        usagePct,
        overspend: roundMoney(Math.max(0, -purchasableRemaining))
      }
    },
    generatedAt: Date.now()
  }
}

function emptyKpis() {
  return {
    purchaseCount: 0,
    purchaseTotal: 0,
    monthCount: 0,
    monthAmount: 0,
    prevMonthCount: 0,
    prevMonthAmount: 0,
    monthDeltaPct: null,
    amountDeltaPct: null,
    unlabeledCount: 0,
    unlabeledPct: null,
    openCount: 0,
    openPct: null,
    purchasableBudget: 0,
    purchasableRemaining: 0,
    usagePct: null,
    hardwareSpend: 0,
    specimenSpend: 0,
    overspendAmount: 0,
    hasBudget: false
  }
}

function emptySignalPack() {
  return {
    count: 0,
    purchaseTotal: 0,
    monthCount: 0,
    prevMonthCount: 0,
    monthAmount: 0,
    prevMonthAmount: 0,
    unlabeledPct: null,
    openPct: null,
    purchasableBudget: 0,
    purchasableRemaining: 0,
    hasBudget: false
  }
}

function emptyCharts() {
  return {
    purchaseTrend: [],
    trendNote: '暂无采购记录。',
    byBudgetType: [],
    byCategory: [],
    byEntity: [],
    byStatus: [],
    byItem: [],
    typeStructure: [],
    categoryStructure: [],
    progress: {
      used: 0,
      total: 0,
      remaining: 0,
      usagePct: null,
      overspend: 0
    }
  }
}

module.exports = {
  buildPurchaseDashboard
}
