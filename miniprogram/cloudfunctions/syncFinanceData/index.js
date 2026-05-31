/**
 * 财务 / 店长账本同步云函数
 * 店长端主集合：store_ledger；上传时镜像 finance_records 供 Web ERP 读取
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const STORE_LEDGER = 'store_ledger'
const FINANCE_RECORDS = 'finance_records'
const FINANCE_SETTINGS = 'finance_settings'
const DEFAULT_STORE_ID = 'store_shanhaizaowu'
const _ = db.command

function normalizeStoreId(storeId) {
  const sid = String(storeId || '').trim()
  if (!sid || sid === 'default') return DEFAULT_STORE_ID
  return sid
}

function ledgerKey(record) {
  const store = normalizeStoreId(record.storeId || record.storeCode)
  const date = String(record.date || record.bizDate || '').trim()
  return `${store}|${date}`
}

/** 与店长账本卡片 NET 一致：有渠道明细则 pos+online+cash-refund，否则取 net/revenue */
function rowNetAmount(record) {
  const pos = Number(record.pos) || 0
  const online = Number(record.online) || 0
  const cash = Number(record.cash) || 0
  const refund = Number(record.refundAmount ?? record.refund) || 0
  const netField = Number(record.netAmount ?? record.revenue ?? record.total) || 0
  if (pos || online || cash) {
    return Math.max(0, pos + online + cash - refund)
  }
  return netField
}

function monthDateRange() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return {
    startDate: `${y}-${m}-01`,
    endDate: `${y}-${m}-${d}`,
  }
}

function normalizeDateStr(date) {
  if (!date) return ''
  const m = String(date).trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (!m) return String(date).trim()
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

/** 按日期范围分页拉取（读路径用，避免全表扫描超时） */
async function fetchInDateRange(collectionName, startDate, endDate, options = {}) {
  const { maxRows = 400, storeId } = options
  const all = []
  let skip = 0
  const pageSize = 100

  while (all.length < maxRows) {
    const where = { date: _.gte(startDate).and(_.lte(endDate)) }
    if (storeId && collectionName === STORE_LEDGER) {
      where.storeId = storeId
    }

    let batch = []
    try {
      const res = await db
        .collection(collectionName)
        .where(where)
        .orderBy('date', 'desc')
        .skip(skip)
        .limit(pageSize)
        .get()
      batch = res.data || []
    } catch (err) {
      const res = await db
        .collection(collectionName)
        .where(where)
        .skip(skip)
        .limit(pageSize)
        .get()
      batch = res.data || []
    }

    if (!batch.length) break
    all.push(...batch)
    if (batch.length < pageSize) break
    skip += pageSize
  }

  return all
}

/** 分页拉全量（仅 upload / 迁移等写路径使用） */
async function fetchAllOrdered(collectionName, orderField, direction = 'desc', maxRows = 5000) {
  const all = []
  let skip = 0
  const pageSize = 100

  while (all.length < maxRows) {
    let query = db.collection(collectionName)
    if (orderField) {
      query = query.orderBy(orderField, direction)
    }
    const res = await query.skip(skip).limit(pageSize).get()
    const batch = res.data || []
    if (!batch.length) break
    all.push(...batch)
    if (batch.length < pageSize) break
    skip += pageSize
  }

  return all
}

async function fetchExistingByKeyInRange(collectionName, keyFn, startDate, endDate) {
  const rows = await fetchInDateRange(collectionName, startDate, endDate)
  return new Map(rows.map((d) => [keyFn(d), d]))
}

async function fetchExistingByKey(collectionName, keyFn, maxRows = 5000) {
  const rows = await fetchAllOrdered(collectionName, 'date', 'desc', maxRows)
  return new Map(rows.map((d) => [keyFn(d), d]))
}

function sumRecordsInRange(records, startDate, endDate) {
  let total = 0
  let dayCount = 0
  for (const record of records) {
    const date = normalizeDateStr(record.date || record.bizDate)
    if (!date || date < startDate || date > endDate) continue
    total += rowNetAmount(record)
    dayCount++
  }
  return { total, dayCount }
}

async function buildMergedLedgerList(sid, startDate, endDate) {
  const rangeStart = startDate || monthDateRange().startDate
  const rangeEnd = endDate || monthDateRange().endDate

  const [financeRows, dailyRows, ledgerRows] = await Promise.all([
    fetchInDateRange(FINANCE_RECORDS, rangeStart, rangeEnd),
    fetchInDateRange('daily_revenues', rangeStart, rangeEnd, { maxRows: 120 }),
    fetchInDateRange(STORE_LEDGER, rangeStart, rangeEnd, { storeId: sid }),
  ])

  const mergedMap = new Map()
  const normSid = normalizeStoreId(sid)

  const put = (record) => {
    const date = normalizeDateStr(record.date || record.bizDate)
    if (!date || date < rangeStart || date > rangeEnd) return
    const normalized = {
      ...record,
      storeId: normalizeStoreId(record.storeId || sid),
      date,
      bizDate: date,
    }
    if (normalizeStoreId(normalized.storeId) !== normSid) return
    const key = ledgerKey(normalized)
    const ts = record._updateTime || record.syncedAt || 0
    const prev = mergedMap.get(key)
    if (!prev || ts >= (prev._updateTime || prev.syncedAt || 0)) {
      mergedMap.set(key, { ...normalized, _updateTime: ts || Date.now() })
    }
  }

  dailyRows.forEach((r) => {
    put({
      storeId: sid,
      date: r.date,
      pos: r.pos || 0,
      online: r.online || 0,
      cash: r.cash || 0,
      refund: r.refund || 0,
      revenue: r.total || 0,
      source: 'daily_revenues',
      _updateTime: r.updateTime ? new Date(r.updateTime).getTime() : Date.now(),
    })
  })

  financeRows.forEach((r) => put({ ...r, storeId: r.storeId || sid }))

  ledgerRows.forEach((r) => {
    put({ ...r, storeId: sid, date: r.date || r.bizDate })
  })

  return [...mergedMap.values()]
}

function toStoreLedgerDoc(record) {
  const pos = Number(record.pos) || 0
  const online = Number(record.online) || 0
  const cash = Number(record.cash) || 0
  const refund = Number(record.refundAmount ?? record.refund) || 0
  const gross = Number(record.grossAmount) || pos + online + cash
  const net = Number(record.netAmount ?? record.revenue ?? record.total) || gross - refund
  const date = normalizeDateStr(record.date || record.bizDate)

  return {
    storeId: normalizeStoreId(record.storeId || DEFAULT_STORE_ID),
    storeCode: record.storeCode || '',
    date,
    bizDate: date,
    revenue: net,
    grossAmount: gross,
    refundAmount: refund,
    netAmount: net,
    orderCount: Number(record.orderCount) || 0,
    pos,
    online,
    cash,
    refund,
    channel: record.channel || 'offline_pos',
    raw: record.raw || record.remark || '',
    remark: record.raw || record.remark || '',
    source: record.source || 'store_manager',
    _updateTime: Date.now(),
    syncedAt: Date.now(),
  }
}

function toFinanceRecord(doc) {
  const ledger = toStoreLedgerDoc(doc)
  return {
    date: ledger.date,
    storeId: ledger.storeId,
    storeCode: ledger.storeCode,
    revenue: ledger.netAmount,
    orderCount: ledger.orderCount,
    pos: ledger.pos,
    online: ledger.online,
    cash: ledger.cash,
    refund: ledger.refund,
    raw: ledger.raw,
    _updateTime: doc._updateTime || Date.now(),
    syncedAt: Date.now(),
  }
}

async function mirrorFinanceRecords(records) {
  if (!records?.length) return { mirrored: 0 }

  const byKey = await fetchExistingByKey(FINANCE_RECORDS, ledgerKey)
  const ops = []

  for (const record of records) {
    const payload = toFinanceRecord(record)
    if (!payload.date) continue
    const key = ledgerKey(payload)
    const prev = byKey.get(key)
    if (prev?._id) {
      ops.push(
        db.collection(FINANCE_RECORDS).doc(prev._id).update({
          data: { ...payload, _updateTime: Date.now(), syncedAt: Date.now() },
        }),
      )
    } else {
      ops.push(
        db.collection(FINANCE_RECORDS).add({
          data: {
            ...payload,
            _createTime: Date.now(),
            _updateTime: Date.now(),
            syncedAt: Date.now(),
          },
        }),
      )
    }
  }

  if (ops.length) await Promise.all(ops)
  return { mirrored: ops.length }
}

async function upsertStoreLedgerRecords(records) {
  if (!records?.length) return { added: 0, updated: 0, total: 0 }

  const dates = records
    .map((r) => normalizeDateStr(r.date || r.bizDate))
    .filter(Boolean)
    .sort()
  const rangeStart = dates[0]
  const rangeEnd = dates[dates.length - 1]
  const byKey = await fetchExistingByKeyInRange(STORE_LEDGER, ledgerKey, rangeStart, rangeEnd)

  let added = 0
  let updated = 0
  const ops = []

  for (const record of records) {
    const doc = toStoreLedgerDoc(record)
    if (!doc.date) continue
    const key = ledgerKey(doc)
    const prev = byKey.get(key)
    const newTs = record._updateTime || Date.now()

    if (prev?._id) {
      const prevTs = prev._updateTime || prev.syncedAt || 0
      if (newTs >= prevTs) {
        ops.push(
          db.collection(STORE_LEDGER).doc(prev._id).update({
            data: { ...doc, _updateTime: newTs },
          }),
        )
        updated++
      }
    } else {
      ops.push(
        db.collection(STORE_LEDGER).add({
          data: { ...doc, _createTime: Date.now(), _updateTime: newTs },
        }),
      )
      added++
    }
  }

  if (ops.length) await Promise.all(ops)
  return { added, updated, total: ops.length }
}

exports.main = async (event) => {
  const { action, records, settings, storeId } = event

  try {
    // 上传账本 → store_ledger + 镜像 finance_records
    if (action === 'upload_records') {
      if (!records || !Array.isArray(records) || records.length === 0) {
        return { success: false, message: '记录数据为空' }
      }

      const ledgerResult = await upsertStoreLedgerRecords(records)
      const mirrorResult = await mirrorFinanceRecords(records)

      return {
        success: true,
        message: `store_ledger 同步 ${ledgerResult.total} 条（新增 ${ledgerResult.added}，更新 ${ledgerResult.updated}）；镜像 finance_records ${mirrorResult.mirrored} 条`,
        ...ledgerResult,
        mirrored: mirrorResult.mirrored,
      }
    }

    // 下载账本（默认 store_ledger，兼容旧客户端仍传 download_records）
    if (action === 'download_records' || action === 'download_store_ledger') {
      const limit = event.limit || 1000
      const sid = storeId || DEFAULT_STORE_ID
      let query = db.collection(STORE_LEDGER)

      if (sid) {
        query = query.where({ storeId: sid })
      }

      const res = await query.orderBy('date', 'desc').limit(limit).get()
      const data = (res.data || []).map(toFinanceRecord)

      return {
        success: true,
        data,
        count: data.length,
      }
    }

    if (action === 'upload_settings') {
      if (!settings) {
        return { success: false, message: '设置数据为空' }
      }

      const existing = await db.collection(FINANCE_SETTINGS).limit(1).get()
      const settingsData = {
        settings,
        _updateTime: Date.now(),
        syncedAt: Date.now(),
      }

      if (existing.data?.length) {
        const prev = existing.data[0]
        const prevTs = prev._updateTime || prev.syncedAt || 0
        const newTs = event.updateTime || Date.now()
        if (newTs > prevTs) {
          await db.collection(FINANCE_SETTINGS).doc(prev._id).update({ data: settingsData })
          return { success: true, message: '设置更新成功' }
        }
        return { success: true, message: '云端设置已是最新，无需更新' }
      }

      settingsData._createTime = Date.now()
      await db.collection(FINANCE_SETTINGS).add({ data: settingsData })
      return { success: true, message: '设置创建成功' }
    }

    if (action === 'download_settings') {
      const res = await db
        .collection(FINANCE_SETTINGS)
        .orderBy('_updateTime', 'desc')
        .limit(1)
        .get()

      return {
        success: true,
        data: res.data?.length ? res.data[0] : null,
      }
    }

    /**
     * 合并 finance_records + daily_revenues + store_ledger → store_ledger
     * 解决 Web 已更新但店长页仍读旧 daily_revenues / 空 storeId 的问题
     */
    if (action === 'refresh_store_ledger') {
      const sid = normalizeStoreId(storeId || DEFAULT_STORE_ID)
      const listLimit = event.listLimit || 31
      const range = monthDateRange()
      const startDate = event.startDate || range.startDate
      const endDate = event.endDate || range.endDate
      const persist = event.persist === true

      const mergedList = await buildMergedLedgerList(sid, startDate, endDate)
      let ledgerResult = { added: 0, updated: 0, total: 0 }
      if (persist) {
        ledgerResult = await upsertStoreLedgerRecords(mergedList)
      }

      const monthRows = mergedList
        .filter((r) => {
          const d = normalizeDateStr(r.date || r.bizDate)
          return d && d >= startDate && d <= endDate
        })
        .sort((a, b) => normalizeDateStr(b.date).localeCompare(normalizeDateStr(a.date)))

      const dates = monthRows.map((r) => normalizeDateStr(r.date)).filter(Boolean).sort()

      return {
        success: true,
        message: `已合并 ${mergedList.length} 条 → store_ledger（写入 ${ledgerResult.total}）`,
        merged: mergedList.length,
        ...ledgerResult,
        data: monthRows.slice(0, listLimit),
        count: Math.min(monthRows.length, listLimit),
        monthTotal: monthRows.length,
        dateRange: { startDate, endDate, min: dates[0] || null, max: dates[dates.length - 1] || null },
      }
    }

    /**
     * 本月门店营收汇总（与账本卡片 NET 求和一致）
     * 先合并三源数据，再按营业日累加，避免 client limit(100) / storeId 漏计
     */
    if (action === 'sum_month_store_ledger') {
      const sid = normalizeStoreId(storeId || DEFAULT_STORE_ID)
      const range = monthDateRange()
      const startDate = event.startDate || range.startDate
      const endDate = event.endDate || range.endDate
      const persist = event.persist === true

      const mergedList = await buildMergedLedgerList(sid, startDate, endDate)
      if (persist) {
        await upsertStoreLedgerRecords(mergedList)
      }
      const { total, dayCount } = sumRecordsInRange(mergedList, startDate, endDate)
      const dates = mergedList
        .map((r) => normalizeDateStr(r.date || r.bizDate))
        .filter((d) => d && d >= startDate && d <= endDate)
        .sort()

      return {
        success: true,
        total,
        dayCount,
        startDate,
        endDate,
        merged: mergedList.length,
        dateRange: {
          startDate,
          endDate,
          min: dates[0] || null,
          max: dates[dates.length - 1] || null,
        },
        message: `${startDate} ~ ${endDate} 共 ${dayCount} 天，门店营收 ¥${total}`,
      }
    }

    // 历史 daily_revenues → store_ledger（一次性迁移）
    if (action === 'sync_daily_revenues') {
      const limit = event.limit || 100
      const sid = storeId || DEFAULT_STORE_ID
      const dailyRes = await db
        .collection('daily_revenues')
        .orderBy('date', 'desc')
        .limit(limit)
        .get()

      const toMigrate = (dailyRes.data || []).map((r) => ({
        storeId: sid,
        date: r.date,
        pos: r.pos || 0,
        online: r.online || 0,
        cash: r.cash || 0,
        refund: r.refund || 0,
        revenue: r.total || 0,
        source: 'daily_revenues_migration',
        _updateTime: r.updateTime ? new Date(r.updateTime).getTime() : Date.now(),
      }))

      const ledgerResult = await upsertStoreLedgerRecords(toMigrate)
      await mirrorFinanceRecords(toMigrate)

      return {
        success: true,
        message: `迁移 ${ledgerResult.total} 条 daily_revenues → store_ledger`,
        synced: ledgerResult.total,
      }
    }

    return { success: false, message: '未知操作类型' }
  } catch (error) {
    console.error('财务数据同步失败:', error)
    return {
      success: false,
      message: error.message || '同步失败',
      error: error.toString(),
    }
  }
}
