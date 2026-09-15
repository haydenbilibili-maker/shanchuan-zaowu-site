#!/usr/bin/env node
/**
 * 代金券折扣地板迁移（不低于 7.5 折：value/minSpend ≤ 0.25）
 *
 * 处理：
 * 1) member_welcome_gift — 礼券档位对齐代码默认（约 8～9 折）
 * 2) 未使用 user_coupons — 抬门槛 / 对齐生日礼新档
 * 3) coupons / rewards(type=coupon) — 过低门槛抬至地板
 *
 * 用法：
 *   node scripts/migrate-coupon-discount-floor.cjs --dry-run
 *   node scripts/migrate-coupon-discount-floor.cjs --execute
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const OUT_PATH = path.join(__dirname, 'migrate-coupon-discount-floor.result.json')
const MAX_OFF_RATIO = 0.25
const mode = process.argv.includes('--execute')
  ? 'execute'
  : process.argv.includes('--dry-run')
    ? 'dry-run'
    : null

if (!mode) {
  console.error('Usage: node scripts/migrate-coupon-discount-floor.cjs --dry-run | --execute')
  process.exit(2)
}

const WELCOME_COUPONS = [
  { id: 'c10', enabled: true, value: 10, minSpend: 100, expireDays: 30, count: 1, title: '新会员礼券 · 满100减10', channel: 'all' },
  { id: 'c30', enabled: true, value: 30, minSpend: 200, expireDays: 30, count: 1, title: '新会员礼券 · 满200减30', channel: 'all' },
  { id: 'c50', enabled: true, value: 50, minSpend: 300, expireDays: 30, count: 1, title: '新会员礼券 · 满300减50', channel: 'all' },
  { id: 'c100', enabled: true, value: 100, minSpend: 500, expireDays: 30, count: 1, title: '新会员礼券 · 满500减100', channel: 'all' }
]

function unwrapMongo(v) {
  if (v == null || typeof v !== 'object') return v
  if ('$numberInt' in v) return Number(v.$numberInt)
  if ('$numberLong' in v) return Number(v.$numberLong)
  if ('$numberDouble' in v) return Number(v.$numberDouble)
  if ('$oid' in v) return v.$oid
  if (Array.isArray(v)) return v.map(unwrapMongo)
  const out = {}
  for (const [k, val] of Object.entries(v)) out[k] = unwrapMongo(val)
  return out
}

function parseTcbJson(raw) {
  const i = raw.indexOf('{')
  if (i < 0) throw new Error('no JSON in tcb output: ' + raw.slice(0, 200))
  return JSON.parse(raw.slice(i))
}

function tcbExecute(commands) {
  const cmd = JSON.stringify(commands)
  const res = spawnSync(
    'tcb',
    ['db', 'nosql', 'execute', '-e', ENV_ID, '--json', '--command', cmd],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  )
  const out = (res.stdout || '') + (res.stderr || '')
  if (res.status !== 0) {
    throw new Error(`tcb exit ${res.status}: ${out.slice(0, 800)}`)
  }
  const parsed = parseTcbJson(out)
  const data = parsed.data || parsed
  return { parsed, results: data.results || [] }
}

function firstPayload(results) {
  return results && results.length ? results[0] : null
}

function findDocs(collection, query, limit = 100) {
  const { results } = tcbExecute([
    {
      TableName: collection,
      CommandType: 'COMMAND',
      Command: JSON.stringify({
        find: collection,
        filter: query || {},
        limit
      })
    }
  ])
  const payload = firstPayload(results)
  const rows = Array.isArray(payload) ? payload : (payload && payload.data) || []
  return (rows || []).map(unwrapMongo)
}

function updateById(collection, id, setFields) {
  const { results } = tcbExecute([
    {
      TableName: collection,
      CommandType: 'UPDATE',
      Command: JSON.stringify({
        update: collection,
        updates: [{ q: { _id: id }, u: { $set: setFields }, multi: false, upsert: false }]
      })
    }
  ])
  return unwrapMongo(firstPayload(results) || {})
}

function cashFloor(value) {
  const v = Math.max(0, Number(value) || 0)
  if (v <= 0) return 0
  return Math.ceil(v / MAX_OFF_RATIO)
}

function violatesFloor(value, minSpend) {
  const v = Number(value) || 0
  const m = Number(minSpend) || 0
  if (!(v > 0)) return false
  if (!(m > 0)) return true
  return v / m > MAX_OFF_RATIO + 1e-9
}

const report = {
  mode,
  envId: ENV_ID,
  at: new Date().toISOString(),
  welcomeGift: [],
  userCoupons: [],
  templates: []
}

// 1) member_welcome_gift
try {
  const docs = findDocs('member_welcome_gift', {}, 20)
  for (const doc of docs) {
    const entry = { id: doc._id, before: doc.coupons || [], action: 'set_default_coupons' }
    if (mode === 'execute') {
      updateById('member_welcome_gift', doc._id, {
        coupons: WELCOME_COUPONS,
        updateTime: Date.now(),
        _updateTime: Date.now(),
        discountFloorMigratedAt: new Date().toISOString()
      })
      entry.updated = true
    }
    report.welcomeGift.push(entry)
  }
  if (!docs.length) {
    report.welcomeGift.push({ note: 'no member_welcome_gift docs; code defaults apply on next grant' })
  }
} catch (e) {
  report.welcomeGift.push({ error: String(e.message || e).slice(0, 300) })
}

// 2) unused user_coupons — birthday 旧档对齐；其余抬门槛
const USER_BATCH = 100
try {
  const candidates = findDocs(
    'user_coupons',
    { status: { $in: ['unused', 'available'] } },
    USER_BATCH
  )
  for (const c of candidates) {
    const value = Number(c.value) || 0
    const minSpend = Number(c.minSpend) || 0
    const source = String(c.source || c.couponSource || '')
    let patch = null

    if (source === 'birthday_gift' && value === 100 && minSpend === 300) {
      // 旧生日礼：改为新默认满100减20（未使用库存）
      patch = {
        value: 20,
        minSpend: 100,
        title: '生日礼券 · 满100减20',
        couponId: 'birthday_gift_20',
        discountFloorMigratedAt: new Date().toISOString()
      }
    } else if (violatesFloor(value, minSpend)) {
      const floor = cashFloor(value)
      patch = {
        minSpend: floor,
        title: c.title || `满${floor}减${value}`,
        discountFloorMigratedAt: new Date().toISOString()
      }
    }

    if (!patch) continue
    const entry = {
      id: c._id,
      source,
      before: { value, minSpend, title: c.title },
      after: patch
    }
    if (mode === 'execute') {
      updateById('user_coupons', c._id, patch)
      entry.updated = true
    }
    report.userCoupons.push(entry)
  }
  if (candidates.length >= USER_BATCH) {
    report.userCoupons.push({
      note: `scanned first ${USER_BATCH} unused coupons; re-run if more remain`
    })
  }
} catch (e) {
  report.userCoupons.push({ error: String(e.message || e).slice(0, 300) })
}

// 3) coupons + rewards templates
for (const collection of ['coupons', 'rewards']) {
  try {
    const query = collection === 'rewards' ? { type: 'coupon' } : {}
    const docs = findDocs(collection, query, 200)
    for (const doc of docs) {
      const value = Number(doc.value) || 0
      const minSpend = Number(doc.minSpend) || 0
      if (!violatesFloor(value, minSpend)) continue
      const floor = cashFloor(value)
      const patch = {
        minSpend: floor,
        discountFloorMigratedAt: new Date().toISOString()
      }
      const entry = {
        collection,
        id: doc._id,
        before: { value, minSpend, title: doc.title || doc.name },
        after: patch
      }
      if (mode === 'execute') {
        updateById(collection, doc._id, patch)
        entry.updated = true
      }
      report.templates.push(entry)
    }
  } catch (e) {
    report.templates.push({ collection, error: String(e.message || e).slice(0, 300) })
  }
}

fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2))
console.log(JSON.stringify({
  mode,
  welcomeGift: report.welcomeGift.length,
  userCoupons: report.userCoupons.filter((x) => x.id).length,
  templates: report.templates.filter((x) => x.id).length,
  out: OUT_PATH
}, null, 2))
