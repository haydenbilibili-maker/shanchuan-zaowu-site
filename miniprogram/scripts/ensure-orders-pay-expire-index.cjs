#!/usr/bin/env node
/**
 * 为 orders 创建超时清扫复合索引：status ASC + payExpireTime ASC
 *
 * 对齐：cloudfunctions/sweepExpiredOrders
 *   .where({ status: 'pending_pay', payExpireTime: _.lt(now) })
 *
 * 环境：cloud1-8gnkty5bfff9f0bf
 * 密钥：shanchuanzaowu/admin/.env 的 TCB_SECRET_*
 *
 * 用法：node scripts/ensure-orders-pay-expire-index.cjs
 */
const fs = require('fs')
const path = require('path')

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const COLLECTION = 'orders'
const ADMIN_ENV = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/admin/.env'
const MANAGER_NODE = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/node_modules/@cloudbase/manager-node'

const INDEX = {
  Name: 'status_1_payExpireTime_1',
  Keys: [
    { Name: 'status', Direction: '1' },
    { Name: 'payExpireTime', Direction: '1' }
  ],
  Unique: false
}

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

function normalizeIndex(idx) {
  const name = idx.Name || idx.name
  const keys =
    idx.Keys ||
    (idx.MgoKeySchema && idx.MgoKeySchema.MgoIndexKeys) ||
    []
  return {
    name,
    keys: keys.map((k) => ({
      name: k.Name || k.name,
      direction: String(k.Direction || k.direction || '')
    })),
    unique: !!(idx.Unique || (idx.MgoKeySchema && idx.MgoKeySchema.MgoIsUnique))
  }
}

function sameKeys(a, b) {
  if (a.length !== b.length) return false
  return a.every((k, i) => k.name === b[i].name && String(k.direction) === String(b[i].direction))
}

async function main() {
  loadDotEnv()
  const secretId = process.env.TCB_SECRET_ID
  const secretKey = process.env.TCB_SECRET_KEY
  if (!secretId || !secretKey) throw new Error('缺少 TCB_SECRET_ID / TCB_SECRET_KEY')

  const CloudBase = require(MANAGER_NODE)
  const app = CloudBase.init({ secretId, secretKey, envId: ENV_ID })
  const { database } = app

  console.log('env=', ENV_ID)
  console.log('collection=', COLLECTION)
  console.log('index=', INDEX.Name, 'keys=status ASC + payExpireTime ASC')

  await database.describeCollection(COLLECTION)

  const beforeDesc = await database.describeCollection(COLLECTION)
  const before = (beforeDesc.Indexes || []).map(normalizeIndex)
  console.log('\nbefore indexes:', before.map((i) => i.name).join(', ') || '(none)')

  const wantedKeys = INDEX.Keys.map((k) => ({ name: k.Name, direction: String(k.Direction) }))
  const existedByName = before.find((i) => i.name === INDEX.Name)
  const existedByKeys = before.find((i) => sameKeys(i.keys, wantedKeys))

  let action = 'skip'
  let note = ''
  if (existedByName || existedByKeys) {
    action = 'exists'
    note = existedByName
      ? `name=${existedByName.name}`
      : `equivalent name=${existedByKeys.name}`
    console.log('index already present:', note)
  } else {
    const payload = {
      IndexName: INDEX.Name,
      MgoKeySchema: {
        MgoIsUnique: false,
        MgoIndexKeys: INDEX.Keys.map((k) => ({ Name: k.Name, Direction: String(k.Direction) }))
      }
    }
    try {
      await database.updateCollection(COLLECTION, { CreateIndexes: [payload] })
      action = 'created'
      note = 'CreateIndexes accepted'
      console.log('CreateIndexes submitted')
    } catch (e) {
      const msg = e.message || String(e)
      if (/exist|已存在|already|Duplicate/i.test(msg)) {
        action = 'exists'
        note = msg.slice(0, 160)
        console.log('treated as exists:', note)
      } else {
        action = 'fail'
        note = msg.slice(0, 200)
        console.error('CreateIndexes failed:', note)
      }
    }
  }

  // poll briefly for index to appear
  let after = before
  let observed = null
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 1500 : 2000))
    const desc = await database.describeCollection(COLLECTION)
    after = (desc.Indexes || []).map(normalizeIndex)
    observed = after.find((x) => x.name === INDEX.Name) || after.find((x) => sameKeys(x.keys, wantedKeys))
    if (observed) break
    process.stdout.write('.')
  }
  console.log('')

  const result = {
    envId: ENV_ID,
    collection: COLLECTION,
    index: INDEX,
    action,
    note,
    observed: observed || null,
    afterNames: after.map((i) => i.name),
    at: new Date().toISOString()
  }

  const outPath = path.join(__dirname, 'ensure-orders-pay-expire-index.result.json')
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2))
  console.log('\nresult →', outPath)
  console.log('action=', action, 'observed=', observed ? observed.name : '(building or missing)')
  if (action === 'fail') process.exitCode = 1
  if (action !== 'fail' && !observed) {
    console.log('索引已提交，列表尚未出现 —— 云库可能仍在构建中，稍后在控制台索引管理可见。')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
