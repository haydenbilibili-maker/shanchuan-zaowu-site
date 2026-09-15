/**
 * 库存管理仪表盘聚合 — 成品 + 原材料信号灯 / KPI / 结构
 * 数据源：studio_inventory + studio_raw_inventory
 */
const FINISHED = 'studio_inventory'
const RAW = 'studio_raw_inventory'

function roundMoney(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.round(v * 100) / 100
}

function moneyText(n) {
  return roundMoney(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
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

function daysBetween(ymdA, ymdB) {
  const a = String(ymdA || '').trim()
  const b = String(ymdB || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null
  const t0 = new Date(`${a}T00:00:00+08:00`).getTime()
  const t1 = new Date(`${b}T00:00:00+08:00`).getTime()
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null
  return Math.round((t1 - t0) / 86400000)
}

function groupSum(rows, keyFn, qtyFn, valueFn) {
  const map = {}
  ;(rows || []).forEach((r) => {
    const key = keyFn(r) || '未标注'
    if (!map[key]) map[key] = { key, label: key, qty: 0, amount: 0, count: 0 }
    map[key].qty += qtyFn ? qtyFn(r) : Number(r.qty) || 0
    map[key].amount = roundMoney(map[key].amount + (valueFn ? valueFn(r) : 0))
    map[key].count += 1
  })
  return Object.keys(map)
    .map((k) => map[k])
    .sort((a, b) => b.qty - a.qty || b.amount - a.amount || b.count - a.count)
}

function buildStructure(rows, mode) {
  const list = (rows || []).filter((x) => (mode === 'amount' ? Number(x.amount) > 0 : Number(x.qty) > 0 || Number(x.count) > 0))
  const sum =
    list.reduce((n, x) => n + (mode === 'amount' ? Number(x.amount) || 0 : Number(x.qty) || 0), 0) || 1
  const tones = ['used', 'rent', 'ok', 'safety', 'fixed']
  return list.slice(0, 8).map((x, i) => {
    const base = mode === 'amount' ? roundMoney(x.amount) : Number(x.qty) || 0
    const pct = Math.max(1, Math.round((base / sum) * 1000) / 10)
    return {
      key: x.key || x.label,
      label: x.label || x.key || '未标注',
      amount: roundMoney(x.amount),
      qty: Number(x.qty) || 0,
      count: x.count || 0,
      pct,
      widthPct: Math.max(2, Math.round((base / sum) * 100)),
      tone: tones[i % tones.length]
    }
  })
}

async function fetchAll(db, collection, where, limit = 2000) {
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
    const msg = [err && err.errMsg, err && err.message, String(err || '')].join(' ')
    if (/502005|COLLECTION_NOT_EXIST|集合不存在|not exist/i.test(msg)) return []
    throw err
  }
}

function rawStockValue(row) {
  if (!row) return 0
  if (row.stockValue != null) return roundMoney(row.stockValue)
  return roundMoney((Number(row.qty) || 0) * (Number(row.unitPrice) || 0))
}

function isLowStock(row) {
  const qty = Number(row && row.qty != null ? row.qty : row && row.currentQty) || 0
  const minQty = Math.max(0, parseInt(row && row.minQty, 10) || 0)
  if (minQty > 0) return qty <= minQty
  return qty <= 0
}

function buildInventorySignals(pack) {
  const {
    finishedSku,
    finishedQty,
    finishedZeroPct,
    rawSku,
    rawQty,
    rawStockValue: rawValue,
    lowStockCount,
    lowStockPct,
    valueMissingPct,
    inventoryAgeDays,
    finishedSharePct
  } = pack

  const totalSku = (finishedSku || 0) + (rawSku || 0)

  // 1) 成品规模
  let finStatus = 'muted'
  let finReason = '暂无成品台账'
  let finValue = '—'
  if (finishedSku > 0) {
    finValue = `${finishedSku} SKU`
    if (finishedQty <= 0) {
      finStatus = 'danger'
      finReason = '有 SKU 但件数合计为 0'
    } else if (finishedSku < 5) {
      finStatus = 'warn'
      finReason = `成品仅 ${finishedSku} SKU / ${finishedQty} 件，样本偏薄`
    } else {
      finStatus = 'ok'
      finReason = `成品 ${finishedSku} SKU · ${finishedQty} 件在柜`
    }
  }

  // 2) 零库存 / 空件数
  let zeroStatus = 'muted'
  let zeroReason = '暂无成品可检'
  let zeroValue = finishedZeroPct != null ? `${finishedZeroPct}%` : '—'
  if (finishedSku > 0 && finishedZeroPct != null) {
    if (finishedZeroPct >= 40) {
      zeroStatus = 'danger'
      zeroReason = `成品零库存约 ${finishedZeroPct}%，宜复盘盘点`
    } else if (finishedZeroPct >= 15) {
      zeroStatus = 'warn'
      zeroReason = `成品零库存约 ${finishedZeroPct}%`
    } else {
      zeroStatus = 'ok'
      zeroReason = '成品零库存占比尚可'
    }
  }

  // 3) 原材料低库存预警
  let lowStatus = 'muted'
  let lowReason = '暂无原材料台账'
  let lowValue = lowStockCount != null ? String(lowStockCount) : '—'
  if (rawSku > 0) {
    lowValue = `${lowStockCount || 0}`
    if (lowStockPct != null && lowStockPct >= 30) {
      lowStatus = 'danger'
      lowReason = `低库存/预警约 ${lowStockPct}%（${lowStockCount} 项）`
    } else if ((lowStockCount || 0) > 0) {
      lowStatus = 'warn'
      lowReason = `${lowStockCount} 项触及预警或已空`
    } else {
      lowStatus = 'ok'
      lowReason = '原材料库存均在预警线之上'
    }
  }

  // 4) 价值异常（有量无单价）
  let valStatus = 'muted'
  let valReason = '暂无原材料价值样本'
  let valValue = rawValue > 0 ? `¥${moneyText(rawValue)}` : '—'
  if (rawSku > 0) {
    if (valueMissingPct != null && valueMissingPct >= 40) {
      valStatus = 'danger'
      valReason = `有库存无单价约 ${valueMissingPct}%，价值难估`
      valValue = valueMissingPct != null ? `${valueMissingPct}% 缺价` : valValue
    } else if (valueMissingPct != null && valueMissingPct >= 15) {
      valStatus = 'warn'
      valReason = `缺单价约 ${valueMissingPct}%，宜补全`
    } else if (!(rawValue > 0) && rawQty > 0) {
      valStatus = 'warn'
      valReason = '原材料有件数但总价值为 0'
      valValue = '¥0'
    } else {
      valStatus = 'ok'
      valReason = '原材料价值字段尚可'
    }
  }

  // 5) 成品 vs 原材料结构（按 SKU 数）
  let mixStatus = 'muted'
  let mixReason = '结构样本不足'
  let mixValue = finishedSharePct != null ? `成品 ${finishedSharePct}%` : '—'
  if (totalSku > 0 && finishedSharePct != null) {
    if (finishedSharePct >= 95 || finishedSharePct <= 5) {
      mixStatus = 'warn'
      mixReason =
        finishedSharePct >= 95
          ? '几乎仅有成品台账，原材料侧偏空'
          : '几乎仅有原材料，成品台账偏空'
    } else {
      mixStatus = 'ok'
      mixReason = `成品 ${finishedSku} / 原材料 ${rawSku} SKU`
    }
  }

  // 6) 盘点新鲜度
  let ageStatus = 'muted'
  let ageReason = '暂无盘点日期'
  let ageValue = inventoryAgeDays != null ? `${inventoryAgeDays} 天前` : '—'
  if (inventoryAgeDays != null) {
    if (inventoryAgeDays > 60) {
      ageStatus = 'danger'
      ageReason = `成品盘点已逾 ${inventoryAgeDays} 天，宜复盘`
    } else if (inventoryAgeDays > 30) {
      ageStatus = 'warn'
      ageReason = `成品盘点 ${inventoryAgeDays} 天前，建议更新`
    } else {
      ageStatus = 'ok'
      ageReason = inventoryAgeDays <= 0 ? '成品盘点为今日' : `成品盘点 ${inventoryAgeDays} 天前`
    }
  } else if (finishedSku > 0) {
    ageStatus = 'warn'
    ageReason = '成品缺盘点日期，新鲜度难判'
    ageValue = '—'
  }

  const items = [
    makeSignal({
      id: 'finished_scale',
      name: '成品规模',
      value: finValue,
      valueRaw: finishedSku,
      status: finStatus,
      reason: finReason
    }),
    makeSignal({
      id: 'zero_stock',
      name: '零库存占比',
      value: zeroValue,
      valueRaw: finishedZeroPct,
      status: zeroStatus,
      reason: zeroReason
    }),
    makeSignal({
      id: 'raw_low',
      name: '原材料预警',
      value: lowValue,
      valueRaw: lowStockCount,
      status: lowStatus,
      reason: lowReason
    }),
    makeSignal({
      id: 'value_health',
      name: '库存价值',
      value: valValue,
      valueRaw: rawValue,
      status: valStatus,
      reason: valReason
    }),
    makeSignal({
      id: 'mix_structure',
      name: '成品/原料结构',
      value: mixValue,
      valueRaw: finishedSharePct,
      status: mixStatus,
      reason: mixReason
    }),
    makeSignal({
      id: 'inventory_age',
      name: '盘点新鲜度',
      value: ageValue,
      valueRaw: inventoryAgeDays,
      status: ageStatus,
      reason: ageReason
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
      title: '库存安稳',
      label: '向好',
      tone: 'up',
      className: 'blink',
      insight: '成品与原材料台账节奏尚安，可按计划盘点与补货。'
    },
    warn: {
      title: '宜留意',
      label: '关注',
      tone: 'warn',
      className: 'warn',
      insight: '零库存、预警或盘点新鲜度已近黄灯，宜先核对台账。'
    },
    danger: {
      title: '库存承压',
      label: '告警',
      tone: 'down',
      className: 'danger',
      insight: '零库存偏高、价值字段缺失或盘点过旧，请先复盘再开新单。'
    },
    muted: {
      title: '样本不足',
      label: '持平',
      tone: 'flat',
      className: 'lamp-muted',
      insight: '成品或原材料尚少，灯色暂作参考；录入或同步后会更清晰。'
    }
  }
  const verdict = Object.assign({}, verdictMap[worst] || verdictMap.muted)
  if (totalSku > 0 && worst === 'ok') {
    verdict.insight = `成品 ${finishedSku} SKU · 原材料 ${rawSku} SKU · 原料价值 ¥${moneyText(rawValue)}。${verdict.insight}`
  }

  return {
    items,
    summary,
    verdict,
    rulesNote:
      '绿·正常 / 黄·关注 / 红·告警。成品零库存≥15%黄、≥40%红；原材料预警占比≥30%红；缺单价≥15%黄、≥40%红；盘点>30天黄、>60天红。'
  }
}

async function buildInventoryDashboard(opts) {
  const db = opts.db
  const _ = db.command

  const [finishedRaw, rawRows] = await Promise.all([
    fetchAll(db, FINISHED, { location: 'studio' }, 2000),
    fetchAll(db, RAW, { deleted: _.neq(true) }, 2000)
  ])

  // 成品可能无 location 字段（旧数据）
  let finished = finishedRaw
  if (!finished.length) {
    finished = await fetchAll(db, FINISHED, null, 2000)
  }

  const finishedSku = finished.length
  const finishedQty = finished.reduce((n, r) => n + (Number(r.qty) || 0), 0)
  const finishedZeroCount = finished.filter((r) => !(Number(r.qty) > 0)).length
  const finishedZeroPct = pctOrNull(finishedZeroCount, finishedSku)

  let inventoryDate = ''
  finished.forEach((r) => {
    const d = String(r.inventoryDate || '').trim()
    if (d && (!inventoryDate || d > inventoryDate)) inventoryDate = d
  })
  const today = shanghaiYmd(Date.now())
  const inventoryAgeDays = inventoryDate ? daysBetween(inventoryDate, today) : null

  const rawSku = rawRows.length
  const rawQty = rawRows.reduce((n, r) => n + (Number(r.qty != null ? r.qty : r.currentQty) || 0), 0)
  const rawValue = roundMoney(rawRows.reduce((n, r) => n + rawStockValue(r), 0))
  const lowStockList = rawRows.filter(isLowStock)
  const lowStockCount = lowStockList.length
  const lowStockPct = pctOrNull(lowStockCount, rawSku)
  const valueMissingCount = rawRows.filter((r) => {
    const qty = Number(r.qty != null ? r.qty : r.currentQty) || 0
    const price = Number(r.unitPrice) || 0
    return qty > 0 && !(price > 0)
  }).length
  const valueMissingPct = pctOrNull(valueMissingCount, rawSku)

  const totalSku = finishedSku + rawSku
  const finishedSharePct = pctOrNull(finishedSku, totalSku)
  const rawSharePct = pctOrNull(rawSku, totalSku)

  const byFinishedGroup = groupSum(
    finished,
    (r) => r.groupName || '未分组',
    (r) => Number(r.qty) || 0,
    () => 0
  )
  const byRawCategory = groupSum(
    rawRows,
    (r) => r.category || '未分类',
    (r) => Number(r.qty != null ? r.qty : r.currentQty) || 0,
    rawStockValue
  )
  const topRawByValue = groupSum(
    rawRows,
    (r) => r.itemName || '未命名',
    (r) => Number(r.qty != null ? r.qty : r.currentQty) || 0,
    rawStockValue
  )
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 12)

  const topFinished = groupSum(
    finished,
    (r) => r.itemName || r.skuName || '未命名',
    (r) => Number(r.qty) || 0,
    () => 0
  ).slice(0, 12)

  const mixStructure = [
    {
      key: 'finished',
      label: '成品',
      qty: finishedQty,
      amount: 0,
      count: finishedSku,
      pct: finishedSharePct || 0,
      widthPct: Math.max(2, Math.round(finishedSharePct || 0) || 2),
      tone: 'used'
    },
    {
      key: 'raw',
      label: '原材料',
      qty: rawQty,
      amount: rawValue,
      count: rawSku,
      pct: rawSharePct || 0,
      widthPct: Math.max(2, Math.round(rawSharePct || 0) || 2),
      tone: 'ok'
    }
  ].filter((x) => x.count > 0)

  const signalPack = {
    finishedSku,
    finishedQty,
    finishedZeroPct,
    rawSku,
    rawQty,
    rawStockValue: rawValue,
    lowStockCount,
    lowStockPct,
    valueMissingPct,
    inventoryAgeDays,
    finishedSharePct
  }
  const signals = buildInventorySignals(signalPack)

  return {
    empty: totalSku === 0,
    title: '库存观测台',
    subtitle: '成品 · 原材料 · 预警 · 盘点新鲜度',
    sourceNote:
      '成品来自 studio_inventory（飞书「成品库存」）；原材料来自 studio_raw_inventory（飞书「库存管理」）。双柜分存，本页聚合看盘。',
    kpis: {
      finishedSku,
      finishedQty,
      finishedZeroCount,
      finishedZeroPct,
      rawSku,
      rawQty,
      rawStockValue: rawValue,
      lowStockCount,
      lowStockPct,
      valueMissingCount,
      valueMissingPct,
      inventoryDate,
      inventoryAgeDays,
      finishedSharePct,
      rawSharePct,
      totalSku
    },
    signals,
    verdict: signals.verdict,
    charts: {
      mixStructure,
      byFinishedGroup: buildStructure(byFinishedGroup, 'qty'),
      byRawCategory: buildStructure(byRawCategory, 'amount'),
      topFinished: topFinished.map((x) => ({
        key: x.key,
        label: x.label,
        count: x.count,
        qty: x.qty,
        amount: 0
      })),
      topRawByValue: topRawByValue.map((x) => ({
        key: x.key,
        label: x.label,
        count: x.count,
        qty: x.qty,
        amount: x.amount
      })),
      lowStockItems: lowStockList.slice(0, 10).map((r) => ({
        key: r._id || r.itemName,
        label: r.itemName || '未命名',
        qty: Number(r.qty != null ? r.qty : r.currentQty) || 0,
        minQty: Number(r.minQty) || 0,
        category: r.category || ''
      })),
      note: '结构条按件数或价值；紧凑列表可下钻至明细 Tab。'
    },
    generatedAt: Date.now()
  }
}

module.exports = {
  buildInventoryDashboard
}
