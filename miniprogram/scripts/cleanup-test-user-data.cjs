#!/usr/bin/env node
/**
 * 测试数据清除专项（破坏性）
 * 保留主测账号；其它账号事务数据删除 + users 数值字段重置为新账号基线。
 *
 * 用法：
 *   node scripts/cleanup-test-user-data.cjs --dry-run
 *   node scripts/cleanup-test-user-data.cjs --execute
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const PRIMARY_TOKEN = 'oa22s5ZcMY7xkQDlNW8X8jaYy46M'
const OUT_PATH = path.join(__dirname, 'cleanup-test-user-data.result.json')

const mode = process.argv.includes('--execute')
  ? 'execute'
  : process.argv.includes('--dry-run')
    ? 'dry-run'
    : null

if (!mode) {
  console.error('Usage: node scripts/cleanup-test-user-data.cjs --dry-run | --execute')
  process.exit(2)
}

/**
 * 事务型集合：按字段匹配非主账号 openid 列表删除。
 * 使用 $in(otherOpenids) 而非 $ne，避免「缺字段文档」被误删（含主账号文档）。
 */
const DELETE_TARGETS = [
  { name: 'orders', fields: ['_openid'] },
  { name: 'point_records', fields: ['_openid', 'openid'] },
  { name: 'user_coupons', fields: ['_openid'] },
  { name: 'user_messages', fields: ['_openid', 'openid'] },
  { name: 'notification_logs', fields: ['_openid', 'openid'] },
  { name: 'user_behaviors', fields: ['_openid', 'openid'] },
  { name: 'collections', fields: ['_openid'] },
  { name: 'collection_folders', fields: ['_openid'] },
  { name: 'bookings', fields: ['_openid'] },
  { name: 'booking_reminders', fields: ['_openid', 'openid'] },
  { name: 'waitlist', fields: ['_openid'] },
  { name: 'support_tickets', fields: ['_openid'] },
  { name: 'user_addresses', fields: ['_openid'] },
  { name: 'user_atlas', fields: ['_openid'] },
  { name: 'member_pass_tokens', fields: ['openid', '_openid'] },
  { name: 'custom_drafts', fields: ['_openid'] },
  { name: 'custom_inquiries', fields: ['_openid'] },
  { name: 'pet_memorial_orders', fields: ['_openid'] },
  { name: 'identification_records', fields: ['_openid', 'openid'] },
  { name: 'care_reminder_queue', fields: ['_openid', 'openid'] },
  { name: 'comments', fields: ['_openid'] },
  { name: 'invoice_requests', fields: ['_openid'] },
  { name: 'store_visits', fields: ['_openid'] },
  { name: 'platform_order_binds', fields: ['openid', '_openid', 'memberOpenid'] },
  { name: 'store_purchases', fields: ['openid', '_openid', 'memberOpenid'] },
  { name: 'group_buyings', fields: ['_openid'] },
  { name: 'framer_recruits', fields: ['_openid'] }
]

/** users 重置字段（保留资料与 staff/admin 标记） */
const USER_RESET_SET = {
  bonusPoints: 0,
  usedPoints: 0,
  storePointsTotal: 0,
  storeGrowthValue: 0,
  storeSpendTotal: 0,
  points: 0,
  pointsDebt: 0,
  isHonorary: false,
  honoraryNotifiedGrantId: '',
  birthdayGiftYear: 0,
  profileRewardClaimed: false
}

function unwrapMongo(v) {
  if (v == null || typeof v !== 'object') return v
  if ('$numberInt' in v) return Number(v.$numberInt)
  if ('$numberLong' in v) return Number(v.$numberLong)
  if ('$numberDouble' in v) return Number(v.$numberDouble)
  if ('$oid' in v) return v.$oid
  if ('$date' in v) {
    const d = v.$date
    if (typeof d === 'object' && d && '$numberLong' in d) {
      return new Date(Number(d.$numberLong)).toISOString()
    }
    return d
  }
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
  return { parsed, results: data.results || [], requestId: data.requestId }
}

function firstPayload(results) {
  if (!results || !results.length) return null
  return results[0]
}

function isMissingError(msg) {
  return /ResourceNotFound|COLLECTION_NOT_EXIST|not exist|不存在|TableNotExist|DbOrTableNotExist/i.test(
    String(msg || '')
  )
}

function countQuery(collection, query) {
  try {
    const { results } = tcbExecute([
      {
        TableName: collection,
        CommandType: 'COMMAND',
        Command: JSON.stringify({ count: collection, query: query || {} })
      }
    ])
    const payload = firstPayload(results)
    if (!payload || !Array.isArray(payload) || !payload.length) {
      return { ok: false, n: 0, err: 'empty' }
    }
    const doc = unwrapDoc(payload[0])
    if (doc.ok === 0 || doc.errmsg) {
      const err = doc.errmsg || 'fail'
      return { ok: false, n: 0, missing: isMissingError(err), err }
    }
    return { ok: true, n: Number(doc.n) || 0 }
  } catch (e) {
    const msg = e.message || String(e)
    return { ok: false, n: 0, missing: isMissingError(msg), err: msg.slice(0, 200) }
  }
}

function findDocs(collection, filter, limit = 100, projection) {
  const cmd = { find: collection, filter: filter || {}, limit }
  if (projection) cmd.projection = projection
  try {
    const { results } = tcbExecute([
      { TableName: collection, CommandType: 'QUERY', Command: JSON.stringify(cmd) }
    ])
    const payload = firstPayload(results)
    if (!Array.isArray(payload)) return []
    return payload.map(unwrapDoc)
  } catch (e) {
    if (isMissingError(e.message)) return []
    throw e
  }
}

function deleteByQuery(collection, query) {
  const { results } = tcbExecute([
    {
      TableName: collection,
      CommandType: 'DELETE',
      Command: JSON.stringify({
        delete: collection,
        deletes: [{ q: query, limit: 0 }]
      })
    }
  ])
  const payload = firstPayload(results)
  const doc = payload && payload[0] ? unwrapDoc(payload[0]) : {}
  return { n: Number(doc.n) || 0, raw: doc }
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
  const doc = payload && payload[0] ? unwrapDoc(payload[0]) : {}
  return {
    n: Number(doc.n) || 0,
    nModified: Number(doc.nModified != null ? doc.nModified : doc.n) || 0,
    raw: doc
  }
}

function inOthers(field, otherOpenids) {
  return { [field]: { $in: otherOpenids } }
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function resolvePrimary() {
  const tries = [
    { field: '_openid', filter: { _openid: PRIMARY_TOKEN } },
    { field: 'openid', filter: { openid: PRIMARY_TOKEN } },
    { field: 'memberNo', filter: { memberNo: PRIMARY_TOKEN } },
    { field: '_id', filter: { _id: PRIMARY_TOKEN } }
  ]
  for (const t of tries) {
    const docs = findDocs('users', t.filter, 5, {
      _id: 1,
      _openid: 1,
      openid: 1,
      memberNo: 1,
      nickName: 1,
      bonusPoints: 1,
      usedPoints: 1,
      storeGrowthValue: 1,
      storePointsTotal: 1,
      storeSpendTotal: 1,
      isHonorary: 1,
      points: 1,
      pointsDebt: 1
    })
    if (docs.length) {
      return {
        matchField: t.field,
        docs: docs.map((d) => ({
          _id: d._id,
          _openid: d._openid,
          openid: d.openid,
          memberNo: d.memberNo,
          nickName: d.nickName,
          bonusPoints: d.bonusPoints,
          usedPoints: d.usedPoints,
          storeGrowthValue: d.storeGrowthValue,
          storePointsTotal: d.storePointsTotal,
          storeSpendTotal: d.storeSpendTotal,
          isHonorary: d.isHonorary,
          points: d.points,
          pointsDebt: d.pointsDebt
        }))
      }
    }
  }
  return null
}

function listOtherOpenids(primaryOpenid) {
  const docs = findDocs(
    'users',
    { _openid: { $ne: primaryOpenid } },
    200,
    { _id: 1, _openid: 1, nickName: 1 }
  )
  const openids = []
  const seen = new Set()
  for (const d of docs) {
    const oid = d._openid
    if (!oid || oid === primaryOpenid || seen.has(oid)) continue
    seen.add(oid)
    openids.push(oid)
  }
  return { openids, users: docs }
}

function countForTarget(name, fields, otherOpenids) {
  if (!otherOpenids.length) return { ok: true, n: 0, perField: [] }
  const perField = []
  let maxN = 0
  let anyOk = false
  let missing = false
  let err = null
  for (const field of fields) {
    let total = 0
    let fieldOk = true
    for (const part of chunk(otherOpenids, 50)) {
      const c = countQuery(name, inOthers(field, part))
      if (c.missing) {
        missing = true
        fieldOk = false
        perField.push({ field, ...c })
        break
      }
      if (!c.ok) {
        fieldOk = false
        err = c.err
        perField.push({ field, ...c })
        break
      }
      total += c.n
    }
    if (fieldOk && !missing) {
      anyOk = true
      maxN = Math.max(maxN, total)
      perField.push({ field, ok: true, n: total })
    }
  }
  return { ok: anyOk || missing, n: maxN, missing, err, perField }
}

function dryRunCounts(otherOpenids) {
  const summary = []
  const usersTotal = countQuery('users', {})
  summary.push({
    collection: 'users',
    action: 'reset_fields',
    total: usersTotal.n,
    affected: otherOpenids.length,
    ok: usersTotal.ok
  })

  for (const t of DELETE_TARGETS) {
    const c = countForTarget(t.name, t.fields, otherOpenids)
    summary.push({
      collection: t.name,
      action: 'delete',
      fields: t.fields,
      affected: c.n,
      ok: c.ok,
      missing: c.missing,
      err: c.err,
      perField: c.perField
    })
  }
  return summary
}

function deleteTarget(name, fields, otherOpenids) {
  const ops = []
  if (!otherOpenids.length) {
    ops.push({ collection: name, action: 'delete', status: 'noop', deleted: 0 })
    return ops
  }
  for (const field of fields) {
    let deleted = 0
    let before = 0
    try {
      for (const part of chunk(otherOpenids, 50)) {
        const q = inOthers(field, part)
        const c = countQuery(name, q)
        if (c.missing) {
          ops.push({ collection: name, field, action: 'delete', status: 'missing' })
          return ops
        }
        if (!c.ok) {
          ops.push({ collection: name, field, action: 'delete', status: 'skip', err: c.err })
          break
        }
        before += c.n
        if (c.n > 0) {
          const del = deleteByQuery(name, q)
          deleted += del.n
        }
      }
      const after = countForTarget(name, [field], otherOpenids)
      ops.push({
        collection: name,
        field,
        action: 'delete',
        before,
        deleted,
        after: after.n,
        status: 'ok'
      })
    } catch (e) {
      ops.push({
        collection: name,
        field,
        action: 'delete',
        before,
        deleted,
        status: 'fail',
        err: (e.message || String(e)).slice(0, 240)
      })
    }
  }
  return ops
}

function executeCleanup(primaryOpenid, otherOpenids) {
  const ops = []
  for (const t of DELETE_TARGETS) {
    ops.push(...deleteTarget(t.name, t.fields, otherOpenids))
  }

  // reset users by $in other openids (never $ne alone on whole collection without openid list)
  let nModified = 0
  let matched = 0
  try {
    for (const part of chunk(otherOpenids, 50)) {
      const u = updateByQuery('users', { _openid: { $in: part } }, USER_RESET_SET)
      matched += u.n
      nModified += u.nModified
    }
    ops.push({
      collection: 'users',
      action: 'reset_fields',
      before: otherOpenids.length,
      n: matched,
      nModified,
      fields: Object.keys(USER_RESET_SET),
      status: 'ok'
    })
  } catch (e) {
    ops.push({
      collection: 'users',
      action: 'reset_fields',
      status: 'fail',
      err: (e.message || String(e)).slice(0, 240)
    })
  }
  return ops
}

function snapshotPrimary(primaryOpenid) {
  const docs = findDocs('users', { _openid: primaryOpenid }, 1)
  return docs[0] || null
}

function pickMetrics(u) {
  if (!u) return null
  return {
    bonusPoints: u.bonusPoints,
    usedPoints: u.usedPoints,
    storeGrowthValue: u.storeGrowthValue,
    storePointsTotal: u.storePointsTotal,
    storeSpendTotal: u.storeSpendTotal,
    isHonorary: u.isHonorary,
    points: u.points,
    pointsDebt: u.pointsDebt,
    profileRewardClaimed: u.profileRewardClaimed,
    birthdayGiftYear: u.birthdayGiftYear
  }
}

function metricsEqual(a, b) {
  if (!a || !b) return false
  const keys = [
    'bonusPoints',
    'usedPoints',
    'storeGrowthValue',
    'storePointsTotal',
    'storeSpendTotal',
    'points',
    'pointsDebt'
  ]
  for (const k of keys) {
    if (Number(a[k] || 0) !== Number(b[k] || 0)) return false
  }
  if (Boolean(a.isHonorary) !== Boolean(b.isHonorary)) return false
  return true
}

function main() {
  console.log('env=', ENV_ID)
  console.log('mode=', mode)
  console.log('token=', PRIMARY_TOKEN)

  const resolved = resolvePrimary()
  if (!resolved || !resolved.docs.length) {
    console.error('STOP: 未匹配到主测账号，拒绝执行全库清除。')
    fs.writeFileSync(
      OUT_PATH,
      JSON.stringify(
        {
          envId: ENV_ID,
          at: new Date().toISOString(),
          mode,
          primaryToken: PRIMARY_TOKEN,
          matched: false,
          stopped: true
        },
        null,
        2
      )
    )
    process.exit(1)
  }

  const primary = resolved.docs[0]
  const primaryOpenid = primary._openid || PRIMARY_TOKEN
  console.log('matched_by=', resolved.matchField)
  console.log('primary_openid=', primaryOpenid)
  console.log('primary_id=', primary._id)
  console.log('primary_nick=', primary.nickName)
  console.log('primary_snapshot=', JSON.stringify(pickMetrics(primary)))

  if (resolved.docs.length > 1) {
    console.warn('WARN: matched multiple user docs; using first; count=', resolved.docs.length)
  }

  const { openids: otherOpenids, users: otherUsers } = listOtherOpenids(primaryOpenid)
  console.log('other_users=', otherOpenids.length)
  console.log(
    'other_sample=',
    otherUsers.slice(0, 5).map((u) => ({ _openid: u._openid, nickName: u.nickName }))
  )

  const beforePrimary = snapshotPrimary(primaryOpenid)
  const dry = dryRunCounts(otherOpenids)
  console.log('\n=== DRY-RUN COUNTS ===')
  for (const row of dry) {
    if (row.missing) console.log(`- ${row.collection}: MISSING`)
    else if (row.err && !row.ok) console.log(`- ${row.collection}: ERR ${row.err}`)
    else {
      console.log(
        `- ${row.collection}: ${row.action} affected≈${row.affected}` +
          (row.total != null ? ` (users total=${row.total})` : '')
      )
    }
  }

  let ops = []
  if (mode === 'execute') {
    console.log('\n=== EXECUTING ===')
    ops = executeCleanup(primaryOpenid, otherOpenids)
    for (const op of ops) console.log(JSON.stringify(op))
  }

  const afterPrimary = snapshotPrimary(primaryOpenid)
  const afterCounts = mode === 'execute' ? dryRunCounts(otherOpenids) : null
  const sampleReset =
    mode === 'execute' && otherOpenids[0]
      ? findDocs('users', { _openid: otherOpenids[0] }, 1, {
          _openid: 1,
          nickName: 1,
          bonusPoints: 1,
          usedPoints: 1,
          storeGrowthValue: 1,
          storePointsTotal: 1,
          isHonorary: 1,
          points: 1,
          profileRewardClaimed: 1
        })[0]
      : null

  const report = {
    envId: ENV_ID,
    at: new Date().toISOString(),
    mode,
    matched: true,
    matchField: resolved.matchField,
    primary: { _id: primary._id, _openid: primaryOpenid, nickName: primary.nickName },
    otherUserCount: otherOpenids.length,
    userResetFields: USER_RESET_SET,
    dryRun: dry,
    ops,
    afterCounts,
    sampleResetUser: sampleReset ? pickMetrics({ ...sampleReset }) : null,
    primaryBefore: pickMetrics(beforePrimary),
    primaryAfter: pickMetrics(afterPrimary),
    primaryUntouched: mode === 'dry-run' ? null : metricsEqual(pickMetrics(beforePrimary), pickMetrics(afterPrimary))
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2))
  console.log('\nreport =>', OUT_PATH)
  if (mode === 'execute') console.log('primaryUntouched=', report.primaryUntouched)
}

main()
