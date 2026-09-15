#!/usr/bin/env node
/**
 * 代金券渠道默认 all：将历史缺省 / 硬编码 online 迁为 all
 * 保留显式 store；迁完后若需「仅线上」请在 Admin 重新勾选。
 *
 * 用法：
 *   node scripts/migrate-coupon-channel-all.cjs --dry-run
 *   node scripts/migrate-coupon-channel-all.cjs --execute
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const OUT_PATH = path.join(__dirname, 'migrate-coupon-channel-all.result.json')
const mode = process.argv.includes('--execute')
  ? 'execute'
  : process.argv.includes('--dry-run')
    ? 'dry-run'
    : null

if (!mode) {
  console.error('Usage: node scripts/migrate-coupon-channel-all.cjs --dry-run | --execute')
  process.exit(2)
}

function unwrapMongo(v) {
  if (v == null || typeof v !== 'object') return v
  if ('$numberInt' in v) return Number(v.$numberInt)
  if ('$numberLong' in v) return Number(v.$numberLong)
  if ('$oid' in v) return v.$oid
  return v
}

function unwrapDoc(doc) {
  if (!doc || typeof doc !== 'object') return doc
  const out = {}
  for (const [k, v] of Object.entries(doc)) out[k] = unwrapMongo(v)
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

function countQuery(collection, query) {
  const { results } = tcbExecute([
    {
      TableName: collection,
      CommandType: 'COMMAND',
      Command: JSON.stringify({ count: collection, query: query || {} })
    }
  ])
  const payload = firstPayload(results)
  const doc = unwrapDoc((payload && payload[0]) || {})
  return Number(doc.n) || 0
}

function updateByQuery(collection, query, setFields) {
  const { results } = tcbExecute([
    {
      TableName: collection,
      CommandType: 'UPDATE',
      Command: JSON.stringify({
        update: collection,
        updates: [{ q: query, u: { $set: setFields }, multi: true, upsert: false }]
      })
    }
  ])
  const payload = firstPayload(results)
  const doc = unwrapDoc((payload && payload[0]) || {})
  return { n: Number(doc.n) || Number(doc.nModified) || 0, raw: doc }
}

const TARGETS = [
  { name: 'coupons', queries: [
    { channel: { $exists: false } },
    { channel: null },
    { channel: '' },
    { channel: 'online' }
  ]},
  { name: 'rewards', queries: [
    { type: 'coupon', channel: { $exists: false } },
    { type: 'coupon', channel: null },
    { type: 'coupon', channel: '' },
    { type: 'coupon', channel: 'online' }
  ]},
  { name: 'user_coupons', queries: [
    { channel: { $exists: false } },
    { channel: null },
    { channel: '' },
    { channel: 'online' }
  ]}
]

const report = { mode, envId: ENV_ID, at: new Date().toISOString(), collections: {} }

for (const target of TARGETS) {
  const entry = { dryCounts: [], updated: [] }
  for (const q of target.queries) {
    let n = 0
    try {
      n = countQuery(target.name, q)
    } catch (e) {
      entry.dryCounts.push({ query: q, error: String(e.message || e).slice(0, 200) })
      continue
    }
    entry.dryCounts.push({ query: q, n })
    if (mode === 'execute' && n > 0) {
      const r = updateByQuery(target.name, q, { channel: 'all' })
      entry.updated.push({ query: q, matched: n, result: r })
    }
  }
  report.collections[target.name] = entry
  console.log(target.name, JSON.stringify(entry.dryCounts))
}

fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2))
console.log('wrote', OUT_PATH)
