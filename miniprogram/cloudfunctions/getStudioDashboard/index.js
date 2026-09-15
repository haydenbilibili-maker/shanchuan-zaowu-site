/**
 * 工作室仪表盘 — getStudioDashboard
 *
 * 对齐飞书「采购预算仪表盘」指标结构；数据来自云库聚合：
 *   ops_purchases（采购）+ studio_raw_inventory（原材料）+ studio_inventory（成品）+ ops_shipments（出货）
 *
 * 返回：kpis + signals/trafficLights（预算信号灯）+ charts（结构占比 / 采购趋势 / 原有分布）
 *
 * 命名：
 *   - 成品库存 = studio_inventory（飞书「成品库存」）
 *   - 原材料库存 = studio_raw_inventory（飞书「库存管理」）
 *
 * 权限：仅超管
 */
const cloud = require('wx-server-sdk')
const { assertStaff, STORED_ROLE_SUPER } = require('./staffGuard')
const {
  BUDGET_POOLS,
  HARDWARE_BUDGET_TYPES,
  SPECIMEN_BUDGET_TYPES
} = require('./budgetDefaults')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const OPS_PURCHASES = 'ops_purchases'
const OPS_SHIPMENTS = 'ops_shipments'
const RAW_INVENTORY = 'studio_raw_inventory'
const FINISHED_INVENTORY = 'studio_inventory'
const CONFIGS = 'configs'
const BUDGET_CONFIG_ID = 'studio_budget_pools'

function fail(msg, code) {
  return { success: false, msg, code: code || 'FAIL' }
}
function ok(data) {
  return Object.assign({ success: true }, data || {})
}
function roundMoney(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.round(v * 100) / 100
}
function errorText(err) {
  return [err && err.errCode, err && err.errMsg, err && err.message, String(err || '')]
    .filter(Boolean)
    .join(' ')
}
function isMissing(err) {
  return /502005|COLLECTION_NOT_EXIST|collection not exist|集合不存在|not exist/i.test(errorText(err))
}

async function fetchAll(collection, where, limit = 1000) {
  try {
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
  } catch (err) {
    if (isMissing(err)) return []
    throw err
  }
}

async function loadBudgetPools() {
  try {
    const res = await db.collection(CONFIGS).doc(BUDGET_CONFIG_ID).get()
    const doc = res && res.data
    if (doc && Array.isArray(doc.pools) && doc.pools.length) return doc.pools
  } catch (e) {
    /* use defaults */
  }
  return BUDGET_POOLS
}

function poolByCategory(pools, category) {
  return pools.find((p) => p.category === category) || null
}

function isActivePurchase(row) {
  if (!row || row.deleted) return false
  const st = String(row.status || '')
  return st !== 'cancelled'
}

function isActiveShipment(row) {
  if (!row || row.deleted) return false
  const st = String(row.status || '')
  return st !== 'cancelled'
}

function purchaseAmount(row) {
  if (row.amount != null) return roundMoney(row.amount)
  return roundMoney((Number(row.qty) || 0) * (Number(row.unitPrice) || 0))
}

function shipmentAmount(row) {
  if (row.totalAmount != null) return roundMoney(row.totalAmount)
  const items = Array.isArray(row.items) ? row.items : []
  if (items.length) {
    return roundMoney(
      items.reduce((n, it) => n + (Number(it.totalPrice) || (Number(it.qty) || 0) * (Number(it.unitPrice) || 0)), 0)
    )
  }
  return 0
}

function groupSum(rows, keyFn, amountFn) {
  const map = {}
  rows.forEach((r) => {
    const key = keyFn(r) || '未标注'
    if (!map[key]) map[key] = { key, label: key, amount: 0, count: 0 }
    map[key].amount = roundMoney(map[key].amount + amountFn(r))
    map[key].count += 1
  })
  return Object.keys(map)
    .map((k) => map[k])
    .sort((a, b) => b.amount - a.amount)
}

function pctOrNull(num, den) {
  const n = Number(num) || 0
  const d = Number(den) || 0
  if (d <= 0) return null
  return Math.round((n / d) * 1000) / 10
}

function moneyText(n) {
  const v = roundMoney(n)
  return v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
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

/** 工作室预算信号灯：使用率 / 可采购剩余 / 安全储备 / 固定成本 / 采购池 / 收支 */
function buildStudioSignals(pack) {
  const totalBudget = Number(pack.totalBudget) || 0
  const usedBudget = Number(pack.usedBudget) || 0
  const remainingBudget = Number(pack.remainingBudget) || 0
  const purchasableBudget = Number(pack.purchasableBudget) || 0
  const purchasableRemaining = Number(pack.purchasableRemaining) || 0
  const safetyReserve = Number(pack.safetyReserve) || 0
  const rentBudget = Number(pack.rentBudget) || 0
  const broadbandBudget = Number(pack.broadbandBudget) || 0
  const hardwareBudget = Number(pack.hardwareBudget) || 0
  const specimenBudget = Number(pack.specimenBudget) || 0
  const hardwareSpend = Number(pack.hardwareSpend) || 0
  const specimenSpend = Number(pack.specimenSpend) || 0
  const netProfit = Number(pack.netProfit) || 0
  const revenueTotal = Number(pack.revenueTotal) || 0
  const monthlyOps = Number(pack.monthlyOps) || 0

  const usagePct = pctOrNull(usedBudget, totalBudget)
  let usageStatus = 'muted'
  let usageReason = '总预算未配置'
  if (usagePct != null) {
    if (usagePct >= 100) {
      usageStatus = 'danger'
      usageReason = '已用尽或超过总预算，柜门需先停一停'
    } else if (usagePct >= 85) {
      usageStatus = 'danger'
      usageReason = `使用率 ${usagePct}%，接近总预算上限`
    } else if (usagePct >= 70) {
      usageStatus = 'warn'
      usageReason = `使用率 ${usagePct}%，采购节奏宜放缓`
    } else {
      usageStatus = 'ok'
      usageReason = `使用率 ${usagePct}%，总池仍有余裕`
    }
  }

  let purchStatus = 'muted'
  let purchReason = '可采购池未配置'
  let purchValue = '—'
  if (purchasableBudget > 0) {
    purchValue = `¥${moneyText(purchasableRemaining)}`
    const leftPct = pctOrNull(purchasableRemaining, purchasableBudget)
    if (purchasableRemaining < 0) {
      purchStatus = 'danger'
      purchReason = `可采购池已超支 ¥${moneyText(Math.abs(purchasableRemaining))}，须醒目告警`
    } else if (leftPct != null && leftPct <= 15) {
      purchStatus = 'warn'
      purchReason = `可采购剩余仅 ${leftPct}%，新单宜克制`
    } else {
      purchStatus = 'ok'
      purchReason = '可采购额度仍在安全线内'
    }
  }

  const overspend = Math.max(0, -purchasableRemaining)
  let safetyStatus = 'ok'
  let safetyReason = '安全储备未被动用'
  let safetyValue = `¥${moneyText(safetyReserve)}`
  if (safetyReserve <= 0) {
    safetyStatus = 'muted'
    safetyReason = '安全储备未配置'
    safetyValue = '—'
  } else if (remainingBudget < 0) {
    safetyStatus = 'danger'
    safetyReason = '总预算已穿底，安全储备不复存在'
  } else if (remainingBudget < safetyReserve) {
    safetyStatus = 'danger'
    safetyReason = `总剩余已低于安全储备，已动用约 ¥${moneyText(safetyReserve - remainingBudget)}`
  } else if (overspend > 0) {
    const deep = overspend >= safetyReserve * 0.3
    safetyStatus = deep ? 'danger' : 'warn'
    safetyReason = deep
      ? `超支已侵入安全储备约三成（超 ¥${moneyText(overspend)}）`
      : `可采购已超支，安全储备处于被动用风险`
  }

  const fixedCost = roundMoney(rentBudget + broadbandBudget)
  const fixedPct = pctOrNull(fixedCost, totalBudget)
  let fixedStatus = 'muted'
  let fixedReason = '固定成本未配置'
  let fixedValue = fixedCost > 0 ? `¥${moneyText(fixedCost)}` : '—'
  if (fixedPct != null) {
    fixedValue = `${fixedPct}%`
    if (fixedPct >= 45) {
      fixedStatus = 'warn'
      fixedReason = `房租与宽带占预算 ${fixedPct}%，可采购空间偏紧`
    } else {
      fixedStatus = 'ok'
      fixedReason = rentBudget > 0 ? '房租已按年预留；固定成本结构平稳' : '固定成本占比可控'
    }
  }

  const hwPct = pctOrNull(hardwareSpend, hardwareBudget)
  const spPct = pctOrNull(specimenSpend, specimenBudget)
  const poolPct = Math.max(hwPct != null ? hwPct : 0, spPct != null ? spPct : 0)
  let poolStatus = 'muted'
  let poolReason = '子池预算未配置或尚无采购'
  let poolValue = '—'
  if (hardwareBudget > 0 || specimenBudget > 0) {
    poolValue = poolPct > 0 ? `${poolPct}%` : '0%'
    if (poolPct >= 100) {
      poolStatus = 'danger'
      poolReason = '硬件或标本耗材池已用尽'
    } else if (poolPct >= 80) {
      poolStatus = 'warn'
      poolReason = '子池使用偏高，留意分类超支'
    } else if (hardwareSpend > 0 || specimenSpend > 0) {
      poolStatus = 'ok'
      poolReason = '硬件与标本耗材池仍在线内'
    } else {
      poolStatus = 'muted'
      poolReason = '尚无归入子池的采购记录'
      poolValue = '—'
    }
  }

  let balStatus = 'muted'
  let balReason = '暂无出货营收样本'
  let balValue = `¥${moneyText(netProfit)}`
  if (revenueTotal > 0 || usedBudget > 0) {
    if (netProfit < 0 && Math.abs(netProfit) >= monthlyOps) {
      balStatus = 'danger'
      balReason = '净收益为负且超过一月基础运营，收支失衡'
    } else if (netProfit < 0) {
      balStatus = 'warn'
      balReason = '净收益暂为负，出货尚未覆盖采购'
    } else if (revenueTotal <= 0) {
      balStatus = 'warn'
      balReason = '有采购尚无出货营收'
    } else {
      balStatus = 'ok'
      balReason = '出货覆盖采购，柜中账目向好'
    }
  }

  const items = [
    makeSignal({
      id: 'usage_rate',
      name: '预算使用率',
      value: usagePct != null ? `${usagePct}%` : '—',
      valueRaw: usagePct,
      status: usageStatus,
      reason: usageReason
    }),
    makeSignal({
      id: 'purchasable',
      name: '可采购剩余',
      value: purchValue,
      valueRaw: purchasableRemaining,
      status: purchStatus,
      reason: purchReason
    }),
    makeSignal({
      id: 'safety',
      name: '安全储备',
      value: safetyValue,
      valueRaw: safetyReserve,
      status: safetyStatus,
      reason: safetyReason
    }),
    makeSignal({
      id: 'fixed_cost',
      name: '固定成本占用',
      value: fixedValue,
      valueRaw: fixedPct,
      status: fixedStatus,
      reason: fixedReason
    }),
    makeSignal({
      id: 'pool_health',
      name: '采购子池',
      value: poolValue,
      valueRaw: poolPct,
      status: poolStatus,
      reason: poolReason
    }),
    makeSignal({
      id: 'balance',
      name: '收支平衡',
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
      title: '预算健康',
      label: '向好',
      tone: 'up',
      className: 'blink',
      insight: '采购节奏与储备尚安，可按计划推进。'
    },
    warn: {
      title: '需留意',
      label: '关注',
      tone: 'warn',
      className: 'warn',
      insight: '部分指标已近警戒线，新采购宜先核对可采购池。'
    },
    danger: {
      title: '预算承压',
      label: '告警',
      tone: 'down',
      className: 'danger',
      insight: '可采购或安全储备已现红灯，宜暂停非必要进货。'
    },
    muted: {
      title: '样本不足',
      label: '持平',
      tone: 'flat',
      className: 'lamp-muted',
      insight: '预算池或采购记录尚少，灯色暂作参考。'
    }
  }
  const verdict = Object.assign({}, verdictMap[worst] || verdictMap.muted)

  return {
    items,
    summary,
    verdict,
    rulesNote:
      '绿·正常 / 黄·关注 / 红·告警。使用率≥70%黄、≥85%红；可采购为负必红；安全储备被动用则黄或红。'
  }
}

function buildBudgetStructure(pack) {
  const totalBudget = Number(pack.totalBudget) || 0
  const usedBudget = Number(pack.usedBudget) || 0
  const purchasableBudget = Number(pack.purchasableBudget) || 0
  const purchasableRemaining = Number(pack.purchasableRemaining) || 0
  const safetyReserve = Number(pack.safetyReserve) || 0
  const rentBudget = Number(pack.rentBudget) || 0
  const broadbandBudget = Number(pack.broadbandBudget) || 0
  const overspend = Math.max(0, -purchasableRemaining)
  const usedInPool = Math.min(usedBudget, Math.max(purchasableBudget, 0))
  const leftInPool = Math.max(0, purchasableRemaining)

  const raw = [
    { key: 'safety', label: '安全储备', amount: safetyReserve, tone: 'safety' },
    { key: 'rent', label: '房租', amount: rentBudget, tone: 'rent' },
    { key: 'broadband', label: '宽带', amount: broadbandBudget, tone: 'fixed' },
    { key: 'purchased', label: '已采购', amount: usedInPool, tone: 'used' },
    { key: 'purchasable_left', label: '可采购剩余', amount: leftInPool, tone: 'ok' },
    { key: 'overspend', label: '超支占用', amount: overspend, tone: 'danger' }
  ].filter((x) => Number(x.amount) > 0)

  const sum = raw.reduce((n, x) => n + Number(x.amount), 0) || totalBudget || 1
  return raw.map((x) => ({
    key: x.key,
    label: x.label,
    amount: roundMoney(x.amount),
    pct: Math.max(1, Math.round((Number(x.amount) / sum) * 1000) / 10),
    widthPct: Math.max(2, Math.round((Number(x.amount) / sum) * 100)),
    tone: x.tone
  }))
}

function purchaseMonthKey(row) {
  const d = String((row && row.purchaseDate) || '').trim()
  if (/^\d{4}-\d{2}/.test(d)) return d.slice(0, 7)
  const ms = Number(row && (row.createdAtMs || row.createdAt)) || 0
  if (ms > 0) {
    const dt = new Date(ms)
    if (!Number.isNaN(dt.getTime())) {
      const m = dt.getMonth() + 1
      return `${dt.getFullYear()}-${m < 10 ? '0' : ''}${m}`
    }
  }
  if (row && row.createdAt && typeof row.createdAt === 'object' && row.createdAt.$date) {
    const dt = new Date(row.createdAt.$date)
    if (!Number.isNaN(dt.getTime())) {
      const m = dt.getMonth() + 1
      return `${dt.getFullYear()}-${m < 10 ? '0' : ''}${m}`
    }
  }
  return ''
}

function buildPurchaseTrend(purchases) {
  const map = {}
  ;(purchases || []).forEach((r) => {
    const key = purchaseMonthKey(r)
    if (!key) return
    if (!map[key]) map[key] = { key, label: key, amount: 0, count: 0 }
    map[key].amount = roundMoney(map[key].amount + purchaseAmount(r))
    map[key].count += 1
  })
  return Object.keys(map)
    .sort()
    .slice(-12)
    .map((k) => map[k])
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  try {
    const guard = await assertStaff(db, openid, {
      role: 'manager',
      adminOpsKey: event && event.adminOpsKey
    })
    if (!guard.ok) return fail(guard.msg, guard.code)
    const actor = guard.actor || {}
    const isSuper =
      actor.workspaceRole === 'super_admin' ||
      actor.role === STORED_ROLE_SUPER ||
      (Array.isArray(actor.roles) && actor.roles.indexOf(STORED_ROLE_SUPER) !== -1)
    if (!isSuper) return fail('仅超管可查看工作室仪表盘', 'FORBIDDEN')

    const [pools, purchasesRaw, shipmentsRaw, rawInv, finishedInv] = await Promise.all([
      loadBudgetPools(),
      fetchAll(OPS_PURCHASES, { deleted: _.neq(true) }, 2000),
      fetchAll(OPS_SHIPMENTS, { deleted: _.neq(true) }, 2000),
      fetchAll(RAW_INVENTORY, { deleted: _.neq(true) }, 1000),
      fetchAll(FINISHED_INVENTORY, {}, 1000)
    ])

    const purchases = purchasesRaw.filter(isActivePurchase)
    const shipments = shipmentsRaw.filter(isActiveShipment)

    const purchaseTotal = roundMoney(purchases.reduce((n, r) => n + purchaseAmount(r), 0))
    const purchaseCount = purchases.length
    const hardwareSpend = roundMoney(
      purchases
        .filter((r) => HARDWARE_BUDGET_TYPES.indexOf(String(r.budgetType || '')) !== -1)
        .reduce((n, r) => n + purchaseAmount(r), 0)
    )
    const specimenSpend = roundMoney(
      purchases
        .filter((r) => SPECIMEN_BUDGET_TYPES.indexOf(String(r.budgetType || '')) !== -1)
        .reduce((n, r) => n + purchaseAmount(r), 0)
    )

    const revenueTotal = roundMoney(shipments.reduce((n, r) => n + shipmentAmount(r), 0))
    const shipmentCount = shipments.length

    const rawStockValue = roundMoney(
      rawInv.reduce(
        (n, r) => n + (Number(r.stockValue) || (Number(r.qty) || 0) * (Number(r.unitPrice) || 0)),
        0
      )
    )
    const finishedQty = finishedInv.reduce((n, r) => n + (Number(r.qty) || 0), 0)
    const finishedSkuCount = finishedInv.length

    const totalPool = poolByCategory(pools, '总预算') || pools.find((p) => p.poolKey === 'total')
    const safetyPool = poolByCategory(pools, '安全资金')
    const rentPool = poolByCategory(pools, '房租')
    const broadbandPool = poolByCategory(pools, '宽带')
    const purchasablePool = poolByCategory(pools, '采购控制') || pools.find((p) => p.poolKey === 'purchasable')
    const opsPool = poolByCategory(pools, '基础运营')
    const hardwarePool = poolByCategory(pools, '基础硬件')
    const specimenPool = poolByCategory(pools, '标本原材料与耗材')

    const totalBudget = roundMoney((totalPool && totalPool.annualAmount) || 200000)
    const safetyReserve = roundMoney((safetyPool && safetyPool.annualAmount) || 60000)
    const rentBudget = roundMoney((rentPool && rentPool.annualAmount) || 54200)
    const broadbandBudget = roundMoney((broadbandPool && broadbandPool.annualAmount) || 1098)
    const monthlyOps = roundMoney((opsPool && opsPool.monthlyAmount) || 20000)
    const hardwareBudget = roundMoney((hardwarePool && hardwarePool.annualAmount) || 30000)
    const specimenBudget = roundMoney((specimenPool && specimenPool.annualAmount) || 60000)
    const purchasableBudget = roundMoney(
      (purchasablePool && purchasablePool.annualAmount) ||
        totalBudget - safetyReserve - rentBudget - broadbandBudget
    )
    const usedBudget = purchaseTotal
    const remainingBudget = roundMoney(totalBudget - usedBudget)
    const purchasableRemaining = roundMoney(purchasableBudget - usedBudget)
    const netProfit = roundMoney(revenueTotal - purchaseTotal)
    const usagePct = pctOrNull(usedBudget, totalBudget)
    const remainingPct = pctOrNull(Math.max(0, remainingBudget), totalBudget)

    const byBudgetType = groupSum(
      purchases,
      (r) => r.budgetType || '未标注',
      purchaseAmount
    )
    const byPurchaseCategory = groupSum(
      purchases,
      (r) => r.category || '未分类',
      purchaseAmount
    )
    const byPurchaseStatus = groupSum(
      purchases,
      (r) => r.statusLabel || r.status || '未知',
      () => 0
    ).map((x) => ({ label: x.label, count: x.count }))
    const byItem = groupSum(purchases, (r) => r.itemName || '未命名', purchaseAmount).slice(0, 20)

    const byCustomer = groupSum(
      shipments,
      (r) => r.customerName || r.storeName || '未标注客户',
      shipmentAmount
    )
    const byShipCategory = groupSum(
      shipments,
      (r) => r.category || '未分类',
      shipmentAmount
    )
    const byShipStatus = groupSum(
      shipments,
      (r) => r.statusLabel || r.status || '未知',
      () => 0
    ).map((x) => ({ label: x.label, count: x.count }))

    const poolRemainders = pools.map((p) => {
      let used = 0
      if (p.category === '基础硬件') used = hardwareSpend
      else if (p.category === '标本原材料与耗材') used = specimenSpend
      else if (p.category === '总预算' || p.category === '采购控制') used = purchaseTotal
      const annual = roundMoney(p.annualAmount || 0)
      return {
        name: p.name,
        category: p.category,
        annualAmount: annual,
        usedAmount: roundMoney(used),
        remainingAmount: roundMoney(annual - used),
        note: p.note || ''
      }
    })

    const signalPack = {
      totalBudget,
      usedBudget,
      remainingBudget,
      purchasableBudget,
      purchasableRemaining,
      safetyReserve,
      rentBudget,
      broadbandBudget,
      hardwareBudget,
      specimenBudget,
      hardwareSpend,
      specimenSpend,
      netProfit,
      revenueTotal,
      monthlyOps
    }
    const trafficLights = buildStudioSignals(signalPack)
    const budgetStructure = buildBudgetStructure(signalPack)
    const purchaseTrend = buildPurchaseTrend(purchases)
    const progressTone =
      usagePct == null
        ? 'flat'
        : usagePct >= 85 || purchasableRemaining < 0
          ? 'down'
          : usagePct >= 70
            ? 'warn'
            : 'up'

    return ok({
      title: '工作室仪表盘',
      subtitle: '采购预算 · 原材料 · 成品 · 出货',
      sourceNote:
        '指标结构对齐飞书「采购预算仪表盘」；金额与笔数来自云库实时聚合。',
      naming: {
        finished: {
          label: '成品库存',
          collection: FINISHED_INVENTORY,
          feishuTable: '成品库存',
          hint: '已做好的标本成品台账'
        },
        raw: {
          label: '原材料库存',
          collection: RAW_INVENTORY,
          feishuTable: '库存管理',
          hint: '多平台进货的原材料'
        },
        purchases: {
          label: '采购记录',
          collection: OPS_PURCHASES,
          feishuTable: '采购记录',
          hint: 'ops_purchases'
        },
        property: {
          label: '物业成本',
          collection: 'ops_property_cost',
          feishuTable: '物业成本',
          hint: '房租等固定成本以预算池为准'
        }
      },
      kpis: {
        totalBudget,
        usedBudget,
        remainingBudget,
        purchasableBudget,
        purchasableRemaining,
        safetyReserve,
        rentBudget,
        broadbandBudget,
        monthlyOpsCost: monthlyOps,
        hardwareBudget,
        specimenBudget,
        hardwareSpend,
        specimenMaterialsSpend: specimenSpend,
        purchaseCount,
        purchaseTotal,
        rawStockValue,
        finishedSkuCount,
        finishedQty,
        revenueTotal,
        shipmentCount,
        netProfit,
        usagePct,
        remainingPct,
        progressTone,
        safetyTouched: purchasableRemaining < 0 || remainingBudget < safetyReserve,
        overspendAmount: roundMoney(Math.max(0, -purchasableRemaining))
      },
      signals: trafficLights,
      trafficLights,
      verdict: trafficLights.verdict,
      charts: {
        budgetTypeShare: byBudgetType,
        purchaseStatus: byPurchaseStatus,
        purchaseByCategory: byPurchaseCategory,
        purchaseByItem: byItem,
        shipmentByCustomer: byCustomer,
        shipmentByCategory: byShipCategory,
        shipmentStatus: byShipStatus,
        poolRemainders,
        budgetStructure,
        purchaseTrend,
        trendNote: purchaseTrend.length
          ? '按采购日期（或创建时间）按月汇总，近 12 个月。'
          : '暂无带日期的采购记录，趋势图暂缺；可先看结构占比与信号灯。'
      },
      pools: poolRemainders,
      generatedAt: Date.now()
    })
  } catch (err) {
    console.error('[getStudioDashboard]', err)
    return fail(err && err.message ? err.message : '服务异常', 'INTERNAL')
  }
}
