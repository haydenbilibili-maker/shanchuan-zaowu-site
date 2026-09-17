/**
 * 礼赠场景标签：写入（**默认 dry-run，需显式 --apply**）
 *
 * 前置：先跑 `node scripts/scan-gift-scenes.mjs --dry-run` 出清单并人工确认。
 *
 * 安全设计
 *   · 默认不写：只有传 `--apply` 才执行 update；否则只打印将要写入的内容摘要；
 *   · 回滚：写入前把**每件商品的原 giftScenes** 落盘到 rollback 文件，可原样恢复；
 *   · 幂等：建议值与现值相同的条目**不写**；
 *   · 最小写入：只更新 `giftScenes` 一个字段，不动其它任何字段；
 *   · 结果留痕：写完落 `*.result.json`（与仓库既有 provision/configure 脚本约定一致）。
 *
 * 用法：
 *   node scripts/apply-gift-scenes.mjs            # dry-run（默认）
 *   node scripts/apply-gift-scenes.mjs --apply    # 真正写入
 *   node scripts/apply-gift-scenes.mjs --rollback # 按 rollback 文件恢复
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { proposeScenes } from './giftSceneRules.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const require = createRequire(import.meta.url)

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const COLLECTION = 'products'
const ROLLBACK = resolve(HERE, 'apply-gift-scenes-rollback.result.json')
const RESULT = resolve(HERE, 'apply-gift-scenes.result.json')

function readCreds() {
  const txt = readFileSync(resolve(ROOT, 'admin/.env'), 'utf8')
  const out = {}
  for (const raw of txt.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const [k, ...rest] = line.split('=')
    out[k.trim()] = rest.join('=').trim()
  }
  if (!out.TCB_SECRET_ID || !out.TCB_SECRET_KEY) throw new Error('admin/.env 缺少凭据')
  return out
}

let tcb = null
for (const p of [
  resolve(ROOT, '../WeChatProjects/shanchuanspecimens-只上传/cloudfunctions/manageProducts/node_modules/@cloudbase/node-sdk'),
  resolve(ROOT, 'node_modules/@cloudbase/node-sdk')
]) {
  try { tcb = require(p); break } catch (e) { /* 继续 */ }
}
if (!tcb) { console.error('✗ 未找到 @cloudbase/node-sdk'); process.exit(1) }

const creds = readCreds()
const app = tcb.init({ env: ENV_ID, secretId: creds.TCB_SECRET_ID, secretKey: creds.TCB_SECRET_KEY })
const db = app.database()

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const ROLLBACK_MODE = args.includes('--rollback')

async function fetchAll() {
  const rows = []
  for (let skip = 0; skip < 5000; skip += 100) {
    const res = await db.collection(COLLECTION)
      .field({ title: true, name: true, isOffShelf: true, price: true, rootCategoryName: true, category: true, giftScenes: true })
      .skip(skip).limit(100).get()
    const batch = (res && res.data) || []
    rows.push(...batch)
    if (batch.length < 100) break
  }
  return rows
}

if (ROLLBACK_MODE) {
  if (!existsSync(ROLLBACK)) { console.error('✗ 没有回滚文件，无法回滚'); process.exit(1) }
  const snapshot = JSON.parse(readFileSync(ROLLBACK, 'utf8'))
  let n = 0
  for (const item of snapshot.items || []) {
    await db.collection(COLLECTION).doc(item._id).update({ giftScenes: item.before })
    n += 1
  }
  console.log(`  ✓ 已回滚 ${n} 件商品的 giftScenes`)
  process.exit(0)
}

const rows = await fetchAll()
const plan = rows.map((r) => ({
  _id: r._id,
  title: r.title || r.name || '',
  before: Array.isArray(r.giftScenes) ? r.giftScenes : [],
  after: proposeScenes(r)
}))
const todo = plan.filter((p) => p.before.join(',') !== p.after.join(','))

console.log(`  商品 ${plan.length} 件；需变更 ${todo.length} 件${APPLY ? '' : '（dry-run，未写入）'}`)
if (!APPLY) {
  const sample = todo.slice(0, 5)
  for (const p of sample) console.log(`    · ${String(p.title).slice(0, 22).padEnd(24)} ${p.before.join('+') || '—'} → ${p.after.join('+') || '—'}`)
  console.log('  ⚠️ 加 --apply 才会真正写入（会先生成回滚文件）')
  process.exit(0)
}

writeFileSync(ROLLBACK, JSON.stringify({ at: new Date().toISOString(), items: todo.map(({ _id, before }) => ({ _id, before })) }, null, 1))
let ok = 0
const failed = []
for (const p of todo) {
  try {
    await db.collection(COLLECTION).doc(p._id).update({ giftScenes: p.after })
    ok += 1
  } catch (e) {
    failed.push({ _id: p._id, title: p.title, error: (e && e.message) || String(e) })
  }
}
writeFileSync(RESULT, JSON.stringify({ at: new Date().toISOString(), total: plan.length, changed: todo.length, ok, failed }, null, 1))
console.log(`  ✓ 已写入 ${ok}/${todo.length} 件；失败 ${failed.length}`)
console.log(`  回滚文件: scripts/apply-gift-scenes-rollback.result.json；结果: scripts/apply-gift-scenes.result.json`)
if (failed.length) for (const f of failed.slice(0, 5)) console.log(`    ✗ ${f.title}: ${f.error}`)
