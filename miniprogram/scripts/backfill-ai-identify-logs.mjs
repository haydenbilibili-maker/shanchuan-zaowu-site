#!/usr/bin/env node
/**
 * 一次性：把 identification_records 历史写进 ai_identify_logs（超管「AI 鉴定监测」的历史部分）。
 *
 * - 只写新集合，**不改任何旧数据**；`_id = hist_<record_id>`，已存在即跳过 → 可重复执行
 * - 历史只有「成功新建」的鉴定：status=success、source=history，无耗时 / 模型
 * - 默认 dry-run（只打印将写入的条数），`--apply` 才写
 *
 * 用法：node miniprogram/scripts/backfill-ai-identify-logs.mjs [--apply]
 * 凭据：admin/.env 的 TCB_SECRET_ID / TCB_SECRET_KEY
 * 蓝图：miniprogram/docs/超管工作台_AI鉴定监测_2026-09-29.md §2.3
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const APPLY = process.argv.includes('--apply')
const require = createRequire(import.meta.url)

function loadSdk() {
  const candidates = [resolve(ROOT, 'node_modules/@cloudbase/node-sdk')]
  const devFns = resolve(ROOT, '../WeChatProjects')
  if (existsSync(devFns)) {
    for (const d of readdirSync(devFns)) candidates.push(resolve(devFns, d, 'cloudfunctions/manageProducts/node_modules/@cloudbase/node-sdk'))
  }
  for (const p of candidates) {
    try { return require(p) } catch (e) { /* next */ }
  }
  console.error('✗ 找不到 @cloudbase/node-sdk')
  process.exit(2)
}

function loadEnv() {
  const p = resolve(ROOT, 'admin/.env')
  if (!existsSync(p)) { console.error('✗ 缺少 admin/.env'); process.exit(2) }
  const env = {}
  for (const raw of readFileSync(p, 'utf8').split('\n')) {
    const t = raw.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const i = t.indexOf('=')
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  if (!env.TCB_SECRET_ID || !env.TCB_SECRET_KEY) { console.error('✗ 缺少 TCB_SECRET_ID / TCB_SECRET_KEY'); process.exit(2) }
  return env
}

const clip = (s, n) => String(s == null ? '' : s).slice(0, n)
const bjDay = (ts) => new Date(ts + 8 * 3600e3).toISOString().slice(0, 10)

export function historyLogOf(r) {
  const s = r.species_info || {}
  const created = Number(r.created_at) || 0
  return {
    _id: `hist_${r._id}`,
    openid: clip(r._openid, 64),
    image_file_id: clip(r.image_url, 500),
    status: 'success',
    success: true,
    error_msg: '',
    record_id: clip(r._id, 64),
    reuse_reason: '',
    species_name_zh: clip(s.species_name_zh, 80),
    species_name_latin: clip(s.species_name_latin, 120),
    confidence: typeof s.confidence === 'number' ? s.confidence : null,
    confidence_level: clip(r.confidence_level, 20),
    is_specimen: s.is_specimen !== false,
    species_info: r.species_info || null,
    ai_content: r.ai_content || null,
    related_products: (r.related_products_snapshot || []).slice(0, 6).map((p) => ({
      _id: clip(p && p._id, 64), title: clip(p && p.title, 80), price: Number(p && p.price) || 0, cover: clip(p && p.cover, 500)
    })),
    model: '',
    text_model: '',
    duration_ms: null,
    entry_source: clip(r.entry_source, 40),
    category_hint: clip(r.category_hint, 20),
    created_at: created,
    day: created ? bjDay(created) : '',
    source: 'history'
  }
}

async function main() {
  const env = loadEnv()
  const tcb = loadSdk()
  const db = tcb.init({ env: ENV_ID, secretId: env.TCB_SECRET_ID, secretKey: env.TCB_SECRET_KEY }).database()
  const _ = db.command
  const records = []
  for (let skip = 0; ; skip += 100) {
    const { data } = await db.collection('identification_records').orderBy('created_at', 'asc').skip(skip).limit(100).get()
    records.push(...data)
    if (data.length < 100) break
  }
  const ids = records.map((r) => `hist_${r._id}`)
  const existing = new Set()
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await db.collection('ai_identify_logs').where({ _id: _.in(ids.slice(i, i + 100)) }).field({ _id: true }).limit(100).get()
    data.forEach((d) => existing.add(d._id))
  }
  const todo = records.filter((r) => !existing.has(`hist_${r._id}`))
  console.log(`identification_records ${records.length} 条；已回填 ${existing.size}；待写 ${todo.length}${APPLY ? '' : '（dry-run，加 --apply 才写）'}`)
  if (!APPLY) return
  let ok = 0
  let failed = 0
  for (const r of todo) {
    try {
      await db.collection('ai_identify_logs').add(historyLogOf(r))
      ok += 1
    } catch (e) {
      failed += 1
      console.warn('写入失败', r._id, e.message)
    }
  }
  const total = (await db.collection('ai_identify_logs').where({ source: 'history' }).count()).total
  console.log(`写入 ${ok}，失败 ${failed}；读回 source=history 共 ${total} 条`)
  if (failed) process.exit(1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
