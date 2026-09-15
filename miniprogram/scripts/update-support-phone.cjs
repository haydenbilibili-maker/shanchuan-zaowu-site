#!/usr/bin/env node
/**
 * 将 support_configs.config.phone 统一为默认客服热线 19917242871
 * - 若已有记录：更新全部文档的 config.phone（保留其余字段）
 * - 若无记录：写入一条 active 默认配置
 *
 * 环境：cloud1-8gnkty5bfff9f0bf
 * 密钥：shanchuanzaowu/admin/.env 的 TCB_SECRET_*
 *
 * 用法：node scripts/update-support-phone.cjs
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const COLLECTION = 'support_configs'
const DEFAULT_PHONE = '19917242871'
const ADMIN_ENV = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/admin/.env'
const OUT_FILE = path.join(__dirname, 'update-support-phone.result.json')

function loadDotEnv() {
  if (!fs.existsSync(ADMIN_ENV)) throw new Error('缺少 ' + ADMIN_ENV)
  for (const line of fs.readFileSync(ADMIN_ENV, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i <= 0) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (!process.env[k]) process.env[k] = v
  }
}

function unwrapDoc(doc) {
  if (!doc || typeof doc !== 'object') return doc
  if (doc.$oid) return String(doc.$oid)
  const out = {}
  for (const [k, v] of Object.entries(doc)) {
    if (v && typeof v === 'object' && v.$oid) out[k] = String(v.$oid)
    else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) out[k] = unwrapDoc(v)
    else out[k] = v
  }
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
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, env: process.env }
  )
  const out = (res.stdout || '') + (res.stderr || '')
  if (res.status !== 0) {
    throw new Error(`tcb exit ${res.status}: ${out.slice(0, 800)}`)
  }
  const parsed = parseTcbJson(out)
  const data = parsed.data || parsed
  return { parsed, results: data.results || [], requestId: data.requestId }
}

function firstPayload(results) {
  if (!results || !results.length) return null
  return results[0]
}

function findDocs(limit = 50) {
  const { results } = tcbExecute([
    {
      TableName: COLLECTION,
      CommandType: 'QUERY',
      Command: JSON.stringify({ find: COLLECTION, filter: {}, limit })
    }
  ])
  const payload = firstPayload(results)
  if (!Array.isArray(payload)) return []
  return payload.map(unwrapDoc)
}

function updatePhoneById(id, phone) {
  const { results } = tcbExecute([
    {
      TableName: COLLECTION,
      CommandType: 'UPDATE',
      Command: JSON.stringify({
        update: COLLECTION,
        updates: [
          {
            q: { _id: id },
            u: { $set: { 'config.phone': phone, updateTime: Date.now() } },
            multi: false,
            upsert: false
          }
        ]
      })
    }
  ])
  const payload = firstPayload(results)
  const doc = payload && payload[0] ? unwrapDoc(payload[0]) : {}
  return { n: Number(doc.n) || 0, raw: doc }
}

function insertDefault() {
  const now = Date.now()
  const doc = {
    name: '默认客服入口',
    priority: 10,
    status: 'active',
    config: {
      phone: DEFAULT_PHONE,
      hours: '上午10点至下午5点',
      responseHint: '专员通常在服务时间内 30 分钟内回复',
      address: '吉林省长春市朝阳区红旗街959号这有山商场山坡X-06-1',
      latitude: 43.86661,
      longitude: 125.29306,
      communityQr: '/assets/qrcode/wechat-assistant-qr.png',
      topics: [],
      faqs: []
    },
    createTime: now,
    updateTime: now
  }
  const { results } = tcbExecute([
    {
      TableName: COLLECTION,
      CommandType: 'INSERT',
      Command: JSON.stringify({ insert: COLLECTION, documents: [doc] })
    }
  ])
  return firstPayload(results)
}

function main() {
  loadDotEnv()
  if (!process.env.TCB_SECRET_ID || !process.env.TCB_SECRET_KEY) {
    throw new Error('缺少 TCB_SECRET_ID / TCB_SECRET_KEY')
  }

  const rows = findDocs(50)
  const report = {
    envId: ENV_ID,
    at: new Date().toISOString(),
    defaultPhone: DEFAULT_PHONE,
    before: rows.map((r) => ({
      _id: r._id,
      name: r.name,
      status: r.status,
      phone: (r.config && r.config.phone) || null
    })),
    actions: []
  }

  if (!rows.length) {
    const inserted = insertDefault()
    report.actions.push({ op: 'insert', result: inserted })
  } else {
    for (const row of rows) {
      const prev = (row.config && row.config.phone) || ''
      if (prev === DEFAULT_PHONE) {
        report.actions.push({ op: 'skip', _id: row._id, phone: prev })
        continue
      }
      const upd = updatePhoneById(row._id, DEFAULT_PHONE)
      report.actions.push({
        op: 'update',
        _id: row._id,
        from: prev,
        to: DEFAULT_PHONE,
        n: upd.n
      })
    }
  }

  const after = findDocs(50)
  report.after = after.map((r) => ({
    _id: r._id,
    name: r.name,
    status: r.status,
    phone: (r.config && r.config.phone) || null
  }))

  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  console.log('Wrote', OUT_FILE)
}

main()
