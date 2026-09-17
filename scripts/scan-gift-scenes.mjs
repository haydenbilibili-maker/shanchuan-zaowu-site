/**
 * 礼赠场景标签：**只读**盘点 + 方案 dry-run
 *
 * 用途：给「藏品库商品补礼赠场景标签（giftScenes）」这件事提供可复核依据。
 *   · `--scan`（默认）：只读拉取 products 全量关键字段，输出统计与原始数据供离线分析；
 *   · `--dry-run`：按 `giftSceneRules.mjs` 的规则算出每件商品的建议场景，输出清单（**不写库**）。
 *
 * 安全：本脚本**只调用 .get()**，不含任何写操作；写入由单独的 `apply-gift-scenes.mjs` 承担，
 * 且必须先出 dry-run 清单经人工确认。
 *
 * 用法：
 *   node scripts/scan-gift-scenes.mjs --scan
 *   node scripts/scan-gift-scenes.mjs --dry-run [--out /tmp/plan.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const require = createRequire(import.meta.url)

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const COLLECTION = 'products'

/** 从 admin/.env 读管理凭据（不回显明文） */
function readCreds() {
  const txt = readFileSync(resolve(ROOT, 'admin/.env'), 'utf8')
  const out = {}
  for (const raw of txt.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const [k, ...rest] = line.split('=')
    out[k.trim()] = rest.join('=').trim()
  }
  const secretId = out.TCB_SECRET_ID
  const secretKey = out.TCB_SECRET_KEY
  if (!secretId || !secretKey) throw new Error('admin/.env 缺少 TCB_SECRET_ID / TCB_SECRET_KEY')
  return { secretId, secretKey }
}

/** 只读拉取全量商品（分页；仅取分析需要的字段） */
async function fetchProducts(db) {
  const FIELD = {
    title: true, name: true, category: true, rootCategoryName: true,
    price: true, stock: true, isOffShelf: true, giftEligible: true, giftScenes: true,
    protectionType: true, images: true, sales: true, latinName: true
  }
  const rows = []
  const PAGE = 100
  for (let skip = 0; skip < 5000; skip += PAGE) {
    const res = await db.collection(COLLECTION).field(FIELD).skip(skip).limit(PAGE).get()
    const batch = (res && res.data) || []
    rows.push(...batch)
    if (batch.length < PAGE) break
  }
  return rows
}

const args = process.argv.slice(2)
const mode = args.includes('--dry-run') ? 'dry-run' : 'scan'
const outArg = args.indexOf('--out')
const outPath = outArg >= 0 ? args[outArg + 1] : '/tmp/gift-scenes-plan.json'

// node-sdk 只在开发仓的云函数依赖里（主库不重复安装）
const SDK_CANDIDATES = [
  resolve(ROOT, '../WeChatProjects/shanchuanspecimens-只上传/cloudfunctions/manageProducts/node_modules/@cloudbase/node-sdk'),
  resolve(ROOT, 'node_modules/@cloudbase/node-sdk')
]
let tcb = null
for (const p of SDK_CANDIDATES) {
  try { tcb = require(p); break } catch (e) { /* 继续找 */ }
}
if (!tcb) {
  console.error('✗ 未找到 @cloudbase/node-sdk（期望在开发仓 cloudfunctions/manageProducts/node_modules 下）')
  process.exit(1)
}

const { secretId, secretKey } = readCreds()
const app = tcb.init({ env: ENV_ID, secretId, secretKey })
const db = app.database()

const rows = await fetchProducts(db)

if (mode === 'scan') {
  const withScenes = rows.filter((r) => Array.isArray(r.giftScenes) && r.giftScenes.length > 0)
  const eligible = rows.filter((r) => r.giftEligible !== false)
  const offShelf = rows.filter((r) => r.isOffShelf === true)
  console.log(`  商品总数: ${rows.length}`)
  console.log(`  已打场景标签: ${withScenes.length}`)
  console.log(`  giftEligible 未关闭: ${eligible.length}（关闭 ${rows.length - eligible.length}）`)
  console.log(`  已下架: ${offShelf.length}`)
  const prices = rows.map((r) => Number(r.price)).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  const q = (p) => prices[Math.min(prices.length - 1, Math.floor(prices.length * p))] || 0
  console.log(`  价格分位: min=${prices[0] || 0} p25=${q(0.25)} p50=${q(0.5)} p75=${q(0.75)} p90=${q(0.9)} max=${prices[prices.length - 1] || 0}`)
  const byRoot = {}
  for (const r of rows) {
    const k = r.rootCategoryName || '(无根分类)'
    byRoot[k] = (byRoot[k] || 0) + 1
  }
  console.log('  根分类分布:', Object.entries(byRoot).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '))
  writeFileSync('/tmp/products-raw.json', JSON.stringify(rows, null, 1))
  console.log('  原始数据已写入 /tmp/products-raw.json（供离线设计规则）')
} else {
  const { proposeScenes } = await import('./giftSceneRules.mjs')
  const plan = rows.map((r) => {
    const proposed = proposeScenes(r)
    const current = Array.isArray(r.giftScenes) ? r.giftScenes : []
    return {
      _id: r._id,
      title: r.title || r.name || '',
      category: r.category || '',
      root: r.rootCategoryName || '',
      price: Number(r.price) || 0,
      offShelf: r.isOffShelf === true,
      giftEligible: r.giftEligible !== false,
      current,
      proposed,
      changed: proposed.join(',') !== current.join(',')
    }
  })
  const changed = plan.filter((p) => p.changed)
  const hist = {}
  for (const p of plan) {
    const k = p.proposed.join('+') || '(无)'
    hist[k] = (hist[k] || 0) + 1
  }
  writeFileSync(outPath, JSON.stringify(plan, null, 1))
  console.log(`  计划条目: ${plan.length}（需变更 ${changed.length}）`)
  console.log('  建议场景组合分布:')
  for (const [k, v] of Object.entries(hist).sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(4)}  ${k}`)
  console.log(`  明细已写入 ${outPath}`)
  console.log('  ⚠️ 本模式**不写库**；确认后再执行 apply-gift-scenes.mjs')
}
