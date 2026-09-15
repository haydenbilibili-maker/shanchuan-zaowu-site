/**
 * 出货单仪表盘聚合 — 信号灯 / KPI / 趋势 / TOP 客户
 * 数据源：ops_shipments（可选对照 ops_purchases 算净差额）
 */
const { COLLECTION, STATUS, roundMoney, mapRow } = require('./shipmentDefaults')

const OPS_PURCHASES = 'ops_purchases'

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

function shipmentMonthKey(row) {
  const fromDate = monthKeyFromDate(row && row.shipmentDate)
  if (fromDate) return fromDate
  const ms = Number(row && (row.createdAt || row.updatedAt)) || 0
  if (ms > 0) return monthKeyFromDate(shanghaiYmd(ms))
  return ''
}

function isActiveShipment(row) {
  if (!row || row.deleted) return false
  return String(row.status || '') !== STATUS.CANCELLED
}

function shipmentAmount(row) {
  if (!row) return 0
  if (row.totalAmount != null) return roundMoney(row.totalAmount)
  const items = Array.isArray(row.items) ? row.items : []
  if (items.length) {
    return roundMoney(
      items.reduce(
        (n, it) => n + (Number(it.totalPrice) || (Number(it.qty) || 0) * (Number(it.unitPrice) || 0)),
        0
      )
    )
  }
  return 0
}

function purchaseAmount(row) {
  if (!row) return 0
  if (row.amount != null) return roundMoney(row.amount)
  return roundMoney((Number(row.qty) || 0) * (Number(row.unitPrice) || 0))
}

function isIncomplete(row) {
  const amount = shipmentAmount(row)
  const cust = String((row && (row.customerName || row.storeName)) || '').trim()
  const noCust = !cust || cust === '未标注客户' || cust === '未标注'
  const noAmount = !(amount > 0)
  const noDate = !String((row && row.shipmentDate) || '').trim()
  return { noCust, noAmount, noDate, incomplete: noCust || noAmount || noDate }
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
    const key = shipmentMonthKey(r)
    if (!key) return
    if (!map[key]) map[key] = { key, label: key, amount: 0, count: 0 }
    map[key].amount = roundMoney(map[key].amount + shipmentAmount(r))
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

function buildShipmentSignals(pack) {
  const {
    count,
    revenueTotal,
    customerCount,
    monthCount,
    prevMonthCount,
    monthAmount,
    prevMonthAmount,
    incompletePct,
    zeroAmountPct,
    topSharePct,
    netProfit,
    purchaseTotal,
    hasPurchaseSample
  } = pack

  // 1) 本月出货活跃度
  let actStatus = 'muted'
  let actReason = '尚无本月出货样本'
  let actValue = String(monthCount || 0)
  if (count <= 0) {
    actStatus = 'muted'
    actReason = '柜中暂无出货记录'
    actValue = '—'
  } else if (monthCount <= 0) {
    actStatus = 'warn'
    actReason = '本月尚无出货，柜门偏静'
  } else if (prevMonthCount > 0) {
    const deltaPct = pctOrNull(monthCount - prevMonthCount, prevMonthCount)
    actValue = `${monthCount} 笔`
    if (deltaPct != null && deltaPct <= -40) {
      actStatus = 'danger'
      actReason = `本月笔数较上月骤降 ${Math.abs(deltaPct)}%`
    } else if (deltaPct != null && deltaPct <= -15) {
      actStatus = 'warn'
      actReason = `本月笔数较上月回落 ${Math.abs(deltaPct)}%`
    } else {
      actStatus = 'ok'
      actReason =
        deltaPct != null && deltaPct > 0
          ? `本月笔数较上月升 ${deltaPct}%`
          : '本月出货节奏平稳'
    }
  } else {
    actStatus = 'ok'
    actValue = `${monthCount} 笔`
    actReason = '本月已有出货，样本尚浅可续记'
  }

  // 2) 营收金额异常
  let revStatus = 'muted'
  let revReason = '暂无金额样本'
  let revValue = revenueTotal > 0 ? `¥${moneyText(revenueTotal)}` : '—'
  if (count > 0) {
    if (!(revenueTotal > 0)) {
      revStatus = 'danger'
      revReason = '出货金额合计为 0，请核对单价/总价'
      revValue = '¥0'
    } else if (prevMonthAmount > 0 && monthAmount >= 0) {
      const drop = pctOrNull(monthAmount - prevMonthAmount, prevMonthAmount)
      revValue = `¥${moneyText(monthAmount)}`
      if (monthAmount <= 0 && monthCount > 0) {
        revStatus = 'danger'
        revReason = '本月有单无金额，账目未闭合'
      } else if (drop != null && drop <= -50) {
        revStatus = 'danger'
        revReason = `本月营收较上月骤降 ${Math.abs(drop)}%`
      } else if (drop != null && drop <= -20) {
        revStatus = 'warn'
        revReason = `本月营收较上月回落 ${Math.abs(drop)}%`
      } else {
        revStatus = 'ok'
        revReason = '本月营收走势尚安'
      }
    } else {
      revStatus = revenueTotal > 0 ? 'ok' : 'warn'
      revReason = revenueTotal > 0 ? '累计营收已入柜' : '金额样本偏少'
    }
  }

  // 3) 待补全 / 无客户无金额占比
  let qualStatus = 'muted'
  let qualReason = '暂无单据可检'
  let qualValue = incompletePct != null ? `${incompletePct}%` : '—'
  if (count > 0 && incompletePct != null) {
    if (incompletePct >= 40 || (zeroAmountPct != null && zeroAmountPct >= 50)) {
      qualStatus = 'danger'
      qualReason = `待补全约 ${incompletePct}%（无客户/无金额/无日期）`
    } else if (incompletePct >= 15 || (zeroAmountPct != null && zeroAmountPct >= 20)) {
      qualStatus = 'warn'
      qualReason = `待补全约 ${incompletePct}%，宜回填单价与客户`
    } else {
      qualStatus = 'ok'
      qualReason = '字段完整度尚可'
    }
  }

  // 4) 客户集中度
  let concStatus = 'muted'
  let concReason = '客户样本不足'
  let concValue = topSharePct != null ? `${topSharePct}%` : '—'
  if (customerCount <= 0) {
    concStatus = count > 0 ? 'warn' : 'muted'
    concReason = count > 0 ? '客户名缺失，难以看结构' : '暂无客户'
  } else if (topSharePct != null) {
    if (topSharePct >= 80 && customerCount >= 2) {
      concStatus = 'danger'
      concReason = `TOP 客户占营收 ${topSharePct}%，过于集中`
    } else if (topSharePct >= 60 && customerCount >= 2) {
      concStatus = 'warn'
      concReason = `TOP 客户占 ${topSharePct}%，结构偏倾`
    } else {
      concStatus = 'ok'
      concReason =
        customerCount === 1 ? '目前仅一位客户有金额' : `客户分散度尚可（${customerCount} 家）`
    }
  }

  // 5) 出货笔数健康度（总量）
  let volStatus = 'muted'
  let volReason = '样本不足'
  let volValue = String(count || 0)
  if (count <= 0) {
    volStatus = 'muted'
    volReason = '尚无有效出货单'
    volValue = '—'
  } else if (count < 5) {
    volStatus = 'warn'
    volReason = '有效单据偏少，趋势仅供参考'
  } else {
    volStatus = 'ok'
    volReason = `有效出货 ${count} 笔已入账`
  }

  // 6) 与采购对照的净差额
  let balStatus = 'muted'
  let balReason = '暂无采购对照样本'
  let balValue = '—'
  if (hasPurchaseSample) {
    balValue = `¥${moneyText(netProfit)}`
    if (revenueTotal <= 0 && purchaseTotal > 0) {
      balStatus = 'warn'
      balReason = '有采购尚无出货营收'
    } else if (netProfit < 0 && Math.abs(netProfit) >= Math.max(purchaseTotal * 0.3, 1)) {
      balStatus = 'danger'
      balReason = '出货营收尚未覆盖采购，差额偏大'
    } else if (netProfit < 0) {
      balStatus = 'warn'
      balReason = '净差额暂为负，出货仍在追赶采购'
    } else {
      balStatus = 'ok'
      balReason = '出货覆盖采购，柜中账目向好'
    }
  } else if (revenueTotal > 0) {
    balStatus = 'muted'
    balReason = '未取到采购样本，净差额暂缺'
    balValue = `营收 ¥${moneyText(revenueTotal)}`
  }

  const items = [
    makeSignal({
      id: 'month_activity',
      name: '本月活跃度',
      value: actValue,
      valueRaw: monthCount,
      status: actStatus,
      reason: actReason
    }),
    makeSignal({
      id: 'revenue_health',
      name: '营收金额',
      value: revValue,
      valueRaw: monthAmount || revenueTotal,
      status: revStatus,
      reason: revReason
    }),
    makeSignal({
      id: 'data_quality',
      name: '字段完整度',
      value: qualValue,
      valueRaw: incompletePct,
      status: qualStatus,
      reason: qualReason
    }),
    makeSignal({
      id: 'customer_concentration',
      name: '客户集中度',
      value: concValue,
      valueRaw: topSharePct,
      status: concStatus,
      reason: concReason
    }),
    makeSignal({
      id: 'volume',
      name: '出货笔数',
      value: volValue,
      valueRaw: count,
      status: volStatus,
      reason: volReason
    }),
    makeSignal({
      id: 'net_balance',
      name: '采购净差额',
      value: balValue,
      valueRaw: netProfit,
      status: balStatus,
      reason: balReason
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
      title: '出货安稳',
      label: '向好',
      tone: 'up',
      className: 'blink',
      insight: '本月出货与金额节奏尚安，柜中账目可按计划推进。'
    },
    warn: {
      title: '宜留意',
      label: '关注',
      tone: 'warn',
      className: 'warn',
      insight: '活跃度、金额或字段完整度已近黄灯，宜先补全再开新单。'
    },
    danger: {
      title: '出货承压',
      label: '告警',
      tone: 'down',
      className: 'danger',
      insight: '营收骤降、数据集中或净差额承压，请先核对飞书同步与单价字段。'
    },
    muted: {
      title: '样本不足',
      label: '持平',
      tone: 'flat',
      className: 'lamp-muted',
      insight: '有效出货尚少，灯色暂作参考；录入或同步后会更清晰。'
    }
  }
  const verdict = Object.assign({}, verdictMap[worst] || verdictMap.muted)
  if (count > 0 && worst === 'ok') {
    verdict.insight = `近柜共 ${count} 笔 · 营收 ¥${moneyText(revenueTotal)} · ${customerCount} 位客户。${verdict.insight}`
  }

  return {
    items,
    summary,
    verdict,
    rulesNote:
      '绿·正常 / 黄·关注 / 红·告警。本月笔数或营收骤降发黄/红；待补全≥15%黄、≥40%红；TOP 客户占比≥60%黄、≥80%红。'
  }
}

function buildCategoryStructure(byCategory, revenueTotal) {
  const rows = (byCategory || []).filter((x) => Number(x.amount) > 0 || Number(x.count) > 0)
  const sum = rows.reduce((n, x) => n + (Number(x.amount) || 0), 0) || revenueTotal || 1
  const tones = ['used', 'rent', 'ok', 'safety', 'fixed']
  return rows.slice(0, 6).map((x, i) => {
    const amount = roundMoney(x.amount)
    const pct = Math.max(1, Math.round((amount / sum) * 1000) / 10)
    return {
      key: x.key || x.label,
      label: x.label || x.key || '未分类',
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

async function fetchPurchasesSafe(db, storeFilter) {
  const _ = db.command
  try {
    const where = { deleted: _.neq(true) }
    if (storeFilter && storeFilter.length === 1) {
      where.storeId = storeFilter[0]
    } else if (storeFilter && storeFilter.length > 1) {
      where.storeId = _.in(storeFilter)
    }
    let rows = await fetchAll(db, OPS_PURCHASES, where, 2000)
    // 若按门店过滤为空且过滤了 storeId，回退全量（采购可能无 storeId）
    if ((!rows || !rows.length) && storeFilter) {
      rows = await fetchAll(db, OPS_PURCHASES, { deleted: _.neq(true) }, 2000)
    }
    return (rows || []).filter((r) => r && String(r.status || '') !== 'cancelled')
  } catch (err) {
    const msg = [err && err.errMsg, err && err.message, String(err || '')].join(' ')
    if (/502005|COLLECTION_NOT_EXIST|集合不存在|not exist/i.test(msg)) return []
    return []
  }
}

/**
 * @param {object} opts
 * @param {object} opts.db
 * @param {string[]|null} opts.storeFilter  null=超管全量；数组=店长门店
 * @param {string} [opts.storeId] 可选单店筛选
 */
async function buildShipmentDashboard(opts) {
  const db = opts.db
  const _ = db.command
  const storeFilter = opts.storeFilter
  const storeId = String(opts.storeId || '').trim()

  const where = { deleted: _.neq(true) }
  if (storeId) {
    if (storeFilter && storeFilter.indexOf(storeId) === -1) {
      return {
        empty: true,
        kpis: emptyKpis(),
        signals: buildShipmentSignals(emptySignalPack()),
        verdict: buildShipmentSignals(emptySignalPack()).verdict,
        charts: emptyCharts()
      }
    }
    where.storeId = storeId
  } else if (storeFilter && storeFilter.length) {
    where.storeId = _.in(storeFilter)
  }

  const raw = await fetchAll(db, COLLECTION, where, 3000)
  const mapped = raw.map(mapRow).filter(Boolean)
  const shipments = mapped.filter(isActiveShipment)

  const todayYm = monthKeyFromDate(shanghaiYmd(Date.now()))
  const prevYm = addMonths(todayYm, -1)

  let revenueTotal = 0
  let totalQty = 0
  let monthCount = 0
  let prevMonthCount = 0
  let monthAmount = 0
  let prevMonthAmount = 0
  let incompleteCount = 0
  let zeroAmountCount = 0
  const customerSet = {}

  shipments.forEach((row) => {
    const amt = shipmentAmount(row)
    revenueTotal = roundMoney(revenueTotal + amt)
    totalQty += Number(row.totalQty) || 0
    const mk = shipmentMonthKey(row)
    if (mk === todayYm) {
      monthCount += 1
      monthAmount = roundMoney(monthAmount + amt)
    } else if (mk === prevYm) {
      prevMonthCount += 1
      prevMonthAmount = roundMoney(prevMonthAmount + amt)
    }
    const flags = isIncomplete(row)
    if (flags.incomplete) incompleteCount += 1
    if (flags.noAmount) zeroAmountCount += 1
    const cust = String(row.customerName || row.storeName || '').trim() || '未标注客户'
    customerSet[cust] = true
  })

  const count = shipments.length
  const customerCount = Object.keys(customerSet).filter((c) => c && c !== '未标注客户').length
  const incompletePct = pctOrNull(incompleteCount, count)
  const zeroAmountPct = pctOrNull(zeroAmountCount, count)

  const byCustomer = groupSum(
    shipments,
    (r) => r.customerName || r.storeName || '未标注客户',
    shipmentAmount
  )
  const byCategory = groupSum(
    shipments,
    (r) => r.category || '未分类',
    shipmentAmount
  )
  const byStore = groupSum(
    shipments,
    (r) => r.storeName || r.storeId || '未标注门店',
    shipmentAmount
  )
  const byStatus = groupSum(
    shipments,
    (r) => r.statusLabel || r.status || '未知',
    () => 0
  ).map((x) => ({ label: x.label, key: x.key, count: x.count, amount: 0 }))

  const topCustomer = byCustomer[0] || null
  const topSharePct =
    topCustomer && revenueTotal > 0
      ? pctOrNull(topCustomer.amount, revenueTotal)
      : customerCount === 1 && revenueTotal > 0
        ? 100
        : null

  const purchases = await fetchPurchasesSafe(db, storeId ? [storeId] : storeFilter)
  const purchaseTotal = roundMoney(purchases.reduce((n, r) => n + purchaseAmount(r), 0))
  const hasPurchaseSample = purchases.length > 0
  const netProfit = roundMoney(revenueTotal - purchaseTotal)

  const monthDeltaPct =
    prevMonthCount > 0 ? pctOrNull(monthCount - prevMonthCount, prevMonthCount) : null
  const amountDeltaPct =
    prevMonthAmount > 0 ? pctOrNull(monthAmount - prevMonthAmount, prevMonthAmount) : null

  const signalPack = {
    count,
    revenueTotal,
    customerCount,
    monthCount,
    prevMonthCount,
    monthAmount,
    prevMonthAmount,
    incompletePct,
    zeroAmountPct,
    topSharePct,
    netProfit,
    purchaseTotal,
    hasPurchaseSample
  }
  const signals = buildShipmentSignals(signalPack)
  const trend = buildMonthTrend(shipments, 12)
  const structure = buildCategoryStructure(byCategory, revenueTotal)

  const completenessOkPct =
    incompletePct == null ? null : Math.max(0, Math.round((100 - incompletePct) * 10) / 10)

  return {
    empty: count === 0,
    title: '出货观测台',
    subtitle: '出货笔数 · 营收 · 客户 · 完整度',
    sourceNote:
      '指标来自云库 ops_shipments 实时聚合；净差额对照 ops_purchases（若有）。飞书出货表经同步中心写入本集合。',
    kpis: {
      shipmentCount: count,
      revenueTotal,
      totalQty,
      customerCount,
      monthCount,
      monthAmount,
      prevMonthCount,
      prevMonthAmount,
      monthDeltaPct,
      amountDeltaPct,
      incompleteCount,
      incompletePct,
      zeroAmountCount,
      zeroAmountPct,
      topCustomerName: (topCustomer && topCustomer.label) || '',
      topCustomerAmount: (topCustomer && topCustomer.amount) || 0,
      topSharePct,
      purchaseTotal,
      netProfit,
      hasPurchaseSample,
      completenessOkPct
    },
    signals,
    verdict: signals.verdict,
    charts: {
      shipmentTrend: trend,
      trendNote: trend.length
        ? '按出货日期（或缺省创建时间）按月汇总，近 12 个月有数据的月份。'
        : '暂无带日期的出货记录，趋势图暂缺。',
      byCustomer: byCustomer.slice(0, 12),
      byCategory,
      byStore,
      byStatus,
      categoryStructure: structure,
      completeness: {
        okPct: completenessOkPct,
        incompletePct,
        zeroAmountPct,
        incompleteCount,
        zeroAmountCount,
        total: count
      }
    },
    generatedAt: Date.now()
  }
}

function emptyKpis() {
  return {
    shipmentCount: 0,
    revenueTotal: 0,
    totalQty: 0,
    customerCount: 0,
    monthCount: 0,
    monthAmount: 0,
    prevMonthCount: 0,
    prevMonthAmount: 0,
    monthDeltaPct: null,
    amountDeltaPct: null,
    incompleteCount: 0,
    incompletePct: null,
    zeroAmountCount: 0,
    zeroAmountPct: null,
    topCustomerName: '',
    topCustomerAmount: 0,
    topSharePct: null,
    purchaseTotal: 0,
    netProfit: 0,
    hasPurchaseSample: false,
    completenessOkPct: null
  }
}

function emptySignalPack() {
  return {
    count: 0,
    revenueTotal: 0,
    customerCount: 0,
    monthCount: 0,
    prevMonthCount: 0,
    monthAmount: 0,
    prevMonthAmount: 0,
    incompletePct: null,
    zeroAmountPct: null,
    topSharePct: null,
    netProfit: 0,
    purchaseTotal: 0,
    hasPurchaseSample: false
  }
}

function emptyCharts() {
  return {
    shipmentTrend: [],
    trendNote: '暂无出货记录。',
    byCustomer: [],
    byCategory: [],
    byStore: [],
    byStatus: [],
    categoryStructure: [],
    completeness: {
      okPct: null,
      incompletePct: null,
      zeroAmountPct: null,
      incompleteCount: 0,
      zeroAmountCount: 0,
      total: 0
    }
  }
}

module.exports = {
  buildShipmentDashboard
}
