#!/usr/bin/env node
/**
 * 云函数环境变量核对（只读）
 *
 * 为什么需要（2026-09-16 实测发现）：
 *   需求 1 的存量回填脚本一直报「需要运维口令」，排查后发现**不是脚本的问题** ——
 *   线上 `identifySpecimen` **根本没有 `ADMIN_OPS_KEY` 环境变量**（只有 `DASHSCOPE_API_KEY`）。
 *   该函数的 `backfill_species_dedup` action 因此在生产**永远会被拒绝**。
 *
 *   这类缺陷的形态很隐蔽：代码里 `process.env.ADMIN_OPS_KEY` 读不到值时**不会报错**，
 *   只是把「运维口令校验」判成失败 —— 表现是「功能不可用」，而日志里只有一句
 *   「需要运维口令」，看起来像调用方没带参数。
 *
 * 检查项：
 *   A. 代码读了 `process.env.ADMIN_OPS_KEY` 的函数，线上必须有该变量
 *      —— 否则所有 adminOpsKey / ERP 代理路径**在线上不可用**（硬缺陷）
 *   B. 其余被读取的环境变量按「必需 / 可选」分类：
 *      - `*_TMPL_ID`（订阅消息模板）按设计**可选**，缺了会优雅跳过 → 仅提示
 *      - 其它（模型/服务密钥等）缺失 → 提示（可能是设计上的按需配置）
 *
 * 用法：
 *   node miniprogram/scripts/check-cloud-fn-env.mjs                # 全量核对
 *   node miniprogram/scripts/check-cloud-fn-env.mjs --json         # 机器可读
 *   node miniprogram/scripts/check-cloud-fn-env.mjs --only a,b     # 只核对指定函数
 *   node miniprogram/scripts/check-cloud-fn-env.mjs --selftest
 *
 * 退出码：存在 A 类缺陷为 1。（本脚本**只读**，不会修改线上任何东西。）
 */
import { readFileSync, readdirSync, existsSync, mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const FN_ROOT = join(ROOT, 'miniprogram', 'cloudfunctions')
const ENV_ID = process.env.CLOUD_ENV || 'cloud1-8gnkty5bfff9f0bf'

/** 按设计可缺失的环境变量（缺失不是缺陷） */
export const OPTIONAL_ENV_PATTERNS = [
  /_TMPL_ID$/, // 订阅消息模板：未创建时优雅跳过（TMPL_PENDING），不阻断业务
]

export function isOptionalEnv(name) {
  return OPTIONAL_ENV_PATTERNS.some((re) => re.test(name))
}

/** 纯函数：从源码里取出它读取的环境变量名 */
export function collectEnvRefs(src) {
  const out = new Set()
  for (const m of String(src || '').matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
    out.add(m[1])
  }
  for (const m of String(src || '').matchAll(/process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g)) {
    out.add(m[1])
  }
  return out
}

/** 纯函数：判定某个函数的检查结论 */
export function judge(fn, refsArr, envNames) {
  const refs = new Set(refsArr)
  const env = new Set(envNames)
  const blocking = []
  const optionalMissing = []
  const otherMissing = []
  for (const name of refs) {
    if (env.has(name)) continue
    if (name === 'ADMIN_OPS_KEY') blocking.push(name)
    else if (isOptionalEnv(name)) optionalMissing.push(name)
    else otherMissing.push(name)
  }
  return {
    fn,
    refs: [...refs].sort(),
    present: [...refs].filter((n) => env.has(n)).sort(),
    blocking,
    optionalMissing,
    otherMissing
  }
}

function walkFns() {
  const out = []
  for (const name of readdirSync(FN_ROOT)) {
    if (name.startsWith('.')) continue
    const dir = join(FN_ROOT, name)
    try {
      if (!readdirSync(dir)) continue
    } catch (e) {
      continue
    }
    out.push({ name, dir })
  }
  return out
}

/** 读一个函数目录下所有 .js（含子模块，因为 env 常被辅助模块读取） */
function readFnSources(dir) {
  let acc = ''
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.js')) continue
    try {
      acc += readFileSync(join(dir, f), 'utf8')
    } catch (e) { /* ignore */ }
  }
  return acc
}

function pullEnv(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'fn-env-'))
  const outFile = join(tmp, 'env.txt')
  const res = spawnSync(
    'tcb',
    ['fn', 'env', 'pull', fn, '-e', ENV_ID, '--output-file', outFile],
    { cwd: join(ROOT, 'miniprogram'), encoding: 'utf8', timeout: 120000 }
  )
  if (!existsSync(outFile)) {
    return { ok: false, names: [], raw: `${res.stdout || ''}${res.stderr || ''}`.slice(-300) }
  }
  const text = readFileSync(outFile, 'utf8')
  const names = []
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=/)
    if (m) names.push(m[1])
  }
  return { ok: true, names, raw: '' }
}

function selftest() {
  let bad = 0
  const t = (name, ok) => {
    if (!ok) bad += 1
    console.log(`${ok ? '✓' : '✗'} ${name}`)
  }
  t('collectEnvRefs 抓 process.env.X',
    collectEnvRefs('const k = process.env.ADMIN_OPS_KEY').has('ADMIN_OPS_KEY'))
  t('collectEnvRefs 抓下标写法',
    collectEnvRefs("process.env['STAFF_INVOICE_TMPL_ID']").has('STAFF_INVOICE_TMPL_ID'))
  t('collectEnvRefs 忽略小写与非环境变量',
    collectEnvRefs('process.env.foo + process.env2.BAR').size === 0)
  t('模板 ID 视为可选', isOptionalEnv('STAFF_INVOICE_TMPL_ID') && !isOptionalEnv('ADMIN_OPS_KEY'))
  const r1 = judge('f', ['ADMIN_OPS_KEY'], [])
  t('★ 缺 ADMIN_OPS_KEY 判为硬缺陷', r1.blocking.length === 1)
  const r2 = judge('f', ['ADMIN_OPS_KEY'], ['ADMIN_OPS_KEY'])
  t('有 ADMIN_OPS_KEY 不算缺陷', r2.blocking.length === 0)
  const r3 = judge('f', ['STAFF_RESTOCK_TMPL_ID'], [])
  t('缺模板 ID 只算可选缺失', r3.blocking.length === 0 && r3.optionalMissing.length === 1)
  const r4 = judge('f', ['DASHSCOPE_API_KEY'], [])
  t('其它缺失单独归类', r4.otherMissing.length === 1 && r4.blocking.length === 0)
  if (bad) {
    console.error(`\n自检失败 ${bad} 项`)
    process.exit(1)
  }
  console.log('\n自检通过：环境变量引用收集与「硬缺陷 / 可选缺失 / 其它」分类正确')
  process.exit(0)
}

function main() {
  if (process.argv.includes('--selftest')) return selftest()
  const json = process.argv.includes('--json')
  const onlyIdx = process.argv.indexOf('--only')
  const only = onlyIdx > -1 && process.argv[onlyIdx + 1] ? process.argv[onlyIdx + 1].split(',') : null

  const fns = walkFns()
    .map((f) => ({ ...f, refs: collectEnvRefs(readFnSources(f.dir)) }))
    .filter((f) => f.refs.size > 0)
    .filter((f) => !only || only.includes(f.name))

  const results = []
  for (const f of fns) {
    const pulled = pullEnv(f.name)
    if (!pulled.ok) {
      results.push({ fn: f.name, pullFailed: true, detail: pulled.raw, refs: [...f.refs].sort(), blocking: ['<pull failed>'], optionalMissing: [], otherMissing: [] })
      continue
    }
    results.push(judge(f.name, f.refs, pulled.names))
  }

  const blocking = results.filter((r) => (r.blocking || []).length)
  if (json) {
    console.log(JSON.stringify({ envId: ENV_ID, checked: results.length, blocking, results }, null, 2))
  } else {
    console.log(`环境：${ENV_ID} · 核对 ${results.length} 个「读了环境变量」的云函数\n`)
    console.log(`A. 硬缺陷：代码要 adminOpsKey，线上却没有 ADMIN_OPS_KEY（${blocking.length}）`)
    blocking.forEach((r) => {
      console.log(`   ${r.fn.padEnd(26)} 缺失 ${(r.blocking || []).join(',')}${r.pullFailed ? '  [env pull 失败]' : ''}`)
      if (r.pullFailed && r.detail) console.log(`      ${r.detail.replace(/\n/g, ' ').slice(0, 160)}`)
    })
    const optMissing = results.filter((r) => (r.optionalMissing || []).length)
    console.log(`\nB. 可选缺失：订阅消息模板未配置（按设计优雅跳过，${optMissing.length}）`)
    optMissing.forEach((r) => console.log(`   ${r.fn.padEnd(26)} ${r.optionalMissing.join(',')}`))
    const otherMissing = results.filter((r) => (r.otherMissing || []).length)
    console.log(`\nC. 其它缺失（需人工判断是否设计如此，${otherMissing.length}）`)
    otherMissing.forEach((r) => console.log(`   ${r.fn.padEnd(26)} ${r.otherMissing.join(',')}`))
    console.log(
      `\n小结：A ${blocking.length} · B ${optMissing.length} · C ${otherMissing.length}（共核对 ${results.length} 个函数）`
    )
  }
  process.exit(blocking.length ? 1 : 0)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
