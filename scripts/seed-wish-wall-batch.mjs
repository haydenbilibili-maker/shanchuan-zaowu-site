/**
 * 祈福墙预埋弹幕：按批次写入 / 下线（**默认 dry-run，需显式 --apply**）
 *
 * 数据源：`scripts/wish-wall-seeds/<批次>.json`（守卫 `npm run check:wish-seeds`）。
 * 落库形态与 `manageWishWall.staffSeedAi` 写的基础内容**逐字段一致**：
 *   `_openid/openid` 空串（不属于任何用户，不进频控与「我的」）、`nickname` = 山海造物（SEED_AUTHOR）、
 *   `source: 'seed'`、`seedBatch` = 批次号、`createTime` = 写入时的服务端时间（不回填、不伪造时间）。
 * 与用户弹幕同表同字段 → 超管「内容开关 → 祈福墙内容管理」照常可隐藏/删除单条。
 *
 * 安全设计
 *   · 默认不写，只打印将写入的条目与对公开列表（最近 LIST_MAX 条）的影响；
 *   · 写前先跑守卫，守卫不绿不写；再把该墙**全量快照**落 backups/wish-wall-seeds/（.gitignore 覆盖）；
 *   · 幂等：与墙上**全部状态**（含 hidden）的文案比对，已存在的不再插入 → 重复执行不重复；
 *   · 插入顺序按类别轮转：公开列表只取最近 30 条，轮转保证露出的那部分六类均衡。
 *
 * 用法：
 *   node scripts/seed-wish-wall-batch.mjs [--file <json>]            # dry-run
 *   node scripts/seed-wish-wall-batch.mjs [--file <json>] --apply    # 写入
 *   node scripts/seed-wish-wall-batch.mjs [--file <json>] --hide     # 整批下线（status → hidden，可恢复）
 *   node scripts/seed-wish-wall-batch.mjs [--file <json>] --show     # 整批恢复展示
 *   node scripts/seed-wish-wall-batch.mjs [--file <json>] --prune    # 本批里已从 json 删掉/改掉的旧文案 → hidden
 *   node scripts/seed-wish-wall-batch.mjs [--file <json>] --remove   # 整批删除（先快照）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const require = createRequire(import.meta.url)
const { SEED_AUTHOR } = require(resolve(ROOT, 'miniprogram/cloudfunctions/manageWishWall/wishSeeds.js'))

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const COLLECTION = 'wish_wall_messages'
const LIST_MAX = 30
const BACKUP_DIR = resolve(ROOT, 'backups/wish-wall-seeds')

const args = process.argv.slice(2)
const flag = (f) => args.includes(f)
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : ''
const DATA_DIR = resolve(HERE, 'wish-wall-seeds')
const dataFile = fileArg
  ? resolve(process.cwd(), fileArg)
  : resolve(DATA_DIR, readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')).sort().pop())
const batch = JSON.parse(readFileSync(dataFile, 'utf8'))
const BATCH = batch.batch
const PRODUCT_KEY = batch.productKey

function readCreds() {
  const out = {}
  for (const raw of readFileSync(resolve(ROOT, 'admin/.env'), 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const [k, ...rest] = line.split('=')
    out[k.trim()] = rest.join('=').trim()
  }
  if (!out.TCB_SECRET_ID || !out.TCB_SECRET_KEY) throw new Error('admin/.env 缺少 TCB 凭据')
  return out
}

let tcb = null
for (const p of [
  resolve(ROOT, 'node_modules/@cloudbase/node-sdk'),
  resolve(ROOT, '../WeChatProjects/shanchuanspecimens-只上传/cloudfunctions/manageProducts/node_modules/@cloudbase/node-sdk')
]) {
  try { tcb = require(p); break } catch (e) { /* 继续 */ }
}
if (!tcb) { console.error('✗ 未找到 @cloudbase/node-sdk'); process.exit(2) }
const creds = readCreds()
const db = tcb.init({ env: ENV_ID, secretId: creds.TCB_SECRET_ID, secretKey: creds.TCB_SECRET_KEY }).database()

async function fetchWall() {
  const rows = []
  for (let skip = 0; skip < 10000; skip += 500) {
    const { data } = await db.collection(COLLECTION).where({ productKey: PRODUCT_KEY }).skip(skip).limit(500).get()
    rows.push(...data)
    if (data.length < 500) break
  }
  return rows
}

function snapshot(rows, tag) {
  mkdirSync(BACKUP_DIR, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const file = resolve(BACKUP_DIR, `${tag}-${PRODUCT_KEY}-${ts}.json`)
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), collection: COLLECTION, productKey: PRODUCT_KEY, rows }, null, 1))
  if (!existsSync(file)) throw new Error('快照未落盘，中止')
  console.log(`✓ 快照 ${file}（${rows.length} 行）`)
  return file
}

/** 按类别轮转：生计1 相遇1 身体1 … 生计2 相遇2 …（最后写入的在公开列表最前） */
function interleave(items) {
  const groups = new Map()
  for (const it of items) {
    if (!groups.has(it.theme)) groups.set(it.theme, [])
    groups.get(it.theme).push(it)
  }
  const out = []
  const lists = [...groups.values()]
  for (let i = 0; out.length < items.length; i += 1) for (const l of lists) if (l[i]) out.push(l[i])
  return out
}

function publicView(rows) {
  return rows
    .filter((r) => r.status === 'visible')
    .sort((a, b) => ((b.pinned === true) - (a.pinned === true)) || (new Date(b.createTime) - new Date(a.createTime)))
    .slice(0, LIST_MAX)
}

const tally = (rows) => rows.reduce((m, r) => { const k = `${r.source || 'user'}/${r.status}`; m[k] = (m[k] || 0) + 1; return m }, {})

const rows = await fetchWall()
const mine = rows.filter((r) => r.seedBatch === BATCH)
console.log(`批次 ${BATCH} · 墙 ${PRODUCT_KEY} · 库内 ${rows.length} 行 ${JSON.stringify(tally(rows))} · 本批已在库 ${mine.length} 行`)

if (flag('--hide') || flag('--show')) {
  const status = flag('--hide') ? 'hidden' : 'visible'
  snapshot(rows, status === 'hidden' ? 'before-hide' : 'before-show')
  const res = await db.collection(COLLECTION).where({ productKey: PRODUCT_KEY, seedBatch: BATCH })
    .update({ status, updateTime: db.serverDate(), updatedBy: 'script:seed-wish-wall-batch' })
  const after = (await fetchWall()).filter((r) => r.seedBatch === BATCH)
  console.log(`✓ ${status === 'hidden' ? '整批下线' : '整批恢复'}：更新 ${res.updated ?? '?'} 行；读回 ${JSON.stringify(tally(after))}`)
  process.exit()
}

if (flag('--prune')) {
  const keep = new Set(batch.items.map((it) => it.text))
  const stale = mine.filter((r) => !keep.has(r.text) && r.status !== 'hidden')
  if (!stale.length) { console.log('✓ 没有需要下线的旧文案'); process.exit() }
  snapshot(rows, 'before-prune')
  for (const r of stale) {
    await db.collection(COLLECTION).doc(r._id).update({ status: 'hidden', updateTime: db.serverDate(), updatedBy: 'script:seed-wish-wall-batch' })
    console.log(`  hidden ${r._id}「${r.text}」`)
  }
  process.exit()
}

if (flag('--remove')) {
  if (!mine.length) { console.log('✓ 本批不在库，无需删除'); process.exit() }
  snapshot(rows, 'before-remove')
  const res = await db.collection(COLLECTION).where({ productKey: PRODUCT_KEY, seedBatch: BATCH }).remove()
  const left = (await fetchWall()).filter((r) => r.seedBatch === BATCH).length
  console.log(`✓ 整批删除：${res.deleted ?? '?'} 行；读回剩余 ${left} 行`)
  process.exit(left ? 1 : 0)
}

const existing = new Set(rows.map((r) => String(r.text || '')))
const todo = interleave(batch.items).filter((it) => !existing.has(it.text))
const skipped = batch.items.length - todo.length
console.log(`待写入 ${todo.length} 条（已存在跳过 ${skipped} 条）`)

const now = Date.now()
const simulated = rows.concat(todo.map((it, i) => ({ text: it.text, status: 'visible', source: 'seed', createTime: new Date(now + i) })))
const view = publicView(simulated)
const viewTally = view.reduce((m, r) => { m[r.source || 'user'] = (m[r.source || 'user'] || 0) + 1; return m }, {})
console.log(`写入后公开列表（最近 ${LIST_MAX} 条）来源构成：${JSON.stringify(viewTally)}`)

if (!flag('--apply')) {
  todo.forEach((it, i) => console.log(`  ${String(i + 1).padStart(2)} [${it.theme}] ${it.text}`))
  console.log('\n（dry-run：未写入。确认后加 --apply）')
  process.exit()
}

const guard = spawnSync(process.execPath, [resolve(HERE, 'check-wish-seed-batch.mjs')], { stdio: 'inherit' })
if (guard.status !== 0) { console.error('✗ 守卫未通过，不写入'); process.exit(1) }
if (!todo.length) { console.log('✓ 全部已在库，无需写入（幂等）'); process.exit() }

snapshot(rows, 'before-apply')
const inserted = []
for (const it of todo) {
  const t = db.serverDate()
  const res = await db.collection(COLLECTION).add({
    _openid: '',
    openid: '',
    productKey: PRODUCT_KEY,
    text: it.text,
    nickname: SEED_AUTHOR,
    avatar: '',
    status: 'visible',
    pinned: false,
    source: 'seed',
    aiGenerated: false,
    seedBatch: BATCH,
    securityChecked: false,
    createTime: t,
    updateTime: t
  })
  inserted.push({ _id: res.id || res._id, text: it.text, theme: it.theme })
}
const after = await fetchWall()
const afterMine = after.filter((r) => r.seedBatch === BATCH)
mkdirSync(BACKUP_DIR, { recursive: true })
const resultFile = resolve(BACKUP_DIR, `applied-${BATCH}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
writeFileSync(resultFile, JSON.stringify({ batch: BATCH, inserted }, null, 1))
console.log(`✓ 写入 ${inserted.length} 条；读回本批 ${afterMine.length} 行 ${JSON.stringify(tally(afterMine))}；明细 ${resultFile}`)
const liveView = publicView(after)
console.log(`读回公开列表（最近 ${LIST_MAX} 条）来源构成：${JSON.stringify(liveView.reduce((m, r) => { m[r.source || 'user'] = (m[r.source || 'user'] || 0) + 1; return m }, {}))}`)
process.exit(afterMine.length >= batch.items.length ? 0 : 1)
