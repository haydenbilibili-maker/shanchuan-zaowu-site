#!/usr/bin/env node
/**
 * analytics_daily 历史重复文档归并
 *
 * 背景：`trackUserBehavior.bumpDailyRollup` 在 2026-09-16 之前是「先查后写」的无锁读改写，
 * 并发首次写入会对同一 `dateKey + action` 产生**多份文档**，而看板对该维度求和 / 取 uv 并集
 * → 重复计数。代码已改为确定性 `_id`（`<dateKey>::<action>`），但**历史数据仍偏大**。
 *
 * 本脚本把同一 `dateKey + action` 的多份文档归并为一份：
 *   count    = 各文档 count 之和
 *   uv       = 各文档 uv 的并集
 *   uvCount  = 并集长度
 *   保留最早创建的文档作为主文档，其余删除
 *
 * 安全设计：
 *   - **默认 dry-run**（只报告将要做什么，不写库）
 *   - 需显式 `--apply` 才执行；`--apply` 时每条归并都打印结果
 *   - 只处理「确实重复」的组，单文档组不动
 *
 * 用法（需 TCB 凭证，与 check-cloud-functions-sync.cjs 同源）：
 *   node miniprogram/scripts/dedupe-analytics-daily.mjs            # dry-run
 *   node miniprogram/scripts/dedupe-analytics-daily.mjs --apply    # 执行
 *   node miniprogram/scripts/dedupe-analytics-daily.mjs --selftest # 自检归并算法
 */
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const COLLECTION = 'analytics_daily'

/**
 * 纯函数：把一组重复文档归并成一份（便于自检，不依赖云环境）。
 * 返回 { merged, dropIds }
 */
export function mergeDuplicateRows(rows) {
  const list = (rows || []).filter(Boolean)
  if (!list.length) return { merged: null, dropIds: [] }
  // 主文档 = createdAt 最早（无 createdAt 的排后面），保证历史 _id 尽量保留
  const sorted = list.slice().sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : Number.MAX_SAFE_INTEGER
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : Number.MAX_SAFE_INTEGER
    return ta - tb
  })
  const keeper = sorted[0]
  const uvSet = new Set()
  let count = 0
  for (const r of sorted) {
    count += Number(r.count) || 0
    for (const u of Array.isArray(r.uv) ? r.uv : []) if (u) uvSet.add(u)
  }
  return {
    merged: {
      _id: keeper._id,
      dateKey: keeper.dateKey,
      action: keeper.action,
      module: keeper.module || 'system',
      count,
      uv: Array.from(uvSet),
      uvCount: uvSet.size,
      updatedAt: new Date(),
    },
    dropIds: sorted.slice(1).map((r) => r._id),
  }
}

/** 纯函数：按 dateKey+action 分组，只返回真正重复的组 */
export function findDuplicateGroups(rows) {
  const byKey = new Map()
  for (const r of rows || []) {
    if (!r) continue
    const key = `${r.dateKey}::${r.action}`
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(r)
  }
  return [...byKey.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({ key, rows: list }))
}

function readEnv() {
  const out = {}
  for (const f of [join(ROOT, 'admin/.env'), join(ROOT, 'admin/.env.local')]) {
    if (!existsSync(f)) continue
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
  return out
}

function selftest() {
  const rows = [
    { _id: 'a', dateKey: 'd1', action: 'product_view', count: 2, uv: ['u1', 'u2'], createdAt: '2026-09-16T01:00:00Z' },
    { _id: 'b', dateKey: 'd1', action: 'product_view', count: 1, uv: ['u2', 'u3'], createdAt: '2026-09-16T02:00:00Z' },
    { _id: 'c', dateKey: 'd2', action: 'cart_view', count: 5, uv: ['u9'], createdAt: '2026-09-16T03:00:00Z' },
  ]
  const groups = findDuplicateGroups(rows)
  const { merged, dropIds } = mergeDuplicateRows(groups[0].rows)
  const cases = [
    ['只识别出 1 个重复组', groups.length === 1],
    ['保留最早文档作为主文档', merged._id === 'a'],
    ['count 求和 = 3', merged.count === 3],
    ['uv 并集 = 3 人', merged.uvCount === 3 && merged.uv.length === 3],
    ['待删 = 后到的 1 份', dropIds.length === 1 && dropIds[0] === 'b'],
    ['单文档组不参与归并', findDuplicateGroups([rows[2]]).length === 0],
  ]
  let bad = 0
  for (const [name, ok] of cases) {
    if (!ok) bad++
    console.log(`${ok ? '✓' : '✗'} ${name}`)
  }
  if (bad) {
    console.error(`\n自检失败 ${bad} 项`)
    process.exit(1)
  }
  console.log('\n自检通过：归并算法（求和 / uv 并集 / 保留最早 / 只删多余）正确')
}

async function main() {
  if (process.argv.includes('--selftest')) return selftest()
  const apply = process.argv.includes('--apply')
  const env = readEnv()
  const secretId = env.TCB_SECRET_ID || process.env.TCB_SECRET_ID
  const secretKey = env.TCB_SECRET_KEY || process.env.TCB_SECRET_KEY
  if (!secretId || !secretKey) {
    console.error('✗ 缺少 TCB_SECRET_ID / TCB_SECRET_KEY（见 admin/.env）')
    process.exit(1)
  }
  const tcb = require('@cloudbase/node-sdk')
  const app = tcb.init({ env: ENV_ID, secretId, secretKey })
  const db = app.database()

  console.log(apply ? '模式：APPLY（会写库）' : '模式：DRY-RUN（只报告，不改动）')
  const res = await db.collection(COLLECTION).limit(10000).get()
  const rows = res.data || []
  const groups = findDuplicateGroups(rows)
  console.log(`扫描 ${rows.length} 份文档，发现 ${groups.length} 个重复组`)

  let mergedGroups = 0
  let droppedDocs = 0
  for (const g of groups) {
    const { merged, dropIds } = mergeDuplicateRows(g.rows)
    console.log(`  ${g.key}: ${g.rows.length} 份 → 1 份（count=${merged.count} uv=${merged.uvCount}）`)
    if (apply) {
      await db.collection(COLLECTION).doc(merged._id).update({
        count: merged.count,
        uv: merged.uv,
        uvCount: merged.uvCount,
        updatedAt: merged.updatedAt,
      })
      for (const id of dropIds) await db.collection(COLLECTION).doc(id).remove()
      console.log(`    ✓ 已归并，删除 ${dropIds.length} 份多余文档`)
    }
    mergedGroups++
    droppedDocs += dropIds.length
  }
  console.log(`\n合计：${mergedGroups} 组归并，${droppedDocs} 份文档${apply ? '已删除' : '待删除（加 --apply 执行）'}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
