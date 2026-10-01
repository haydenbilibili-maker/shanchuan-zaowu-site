#!/usr/bin/env node
/**
 * 共享模块「仓库改了、线上没跟上」漂移报告（**只读线上**，手动命令，不进 check:fast 清单）
 *
 * 为什么需要（2026-10-01 实测）：`check:shared-modules` 只保证**仓库内** 64 份 staffGuard.js 逐字一致；
 * 但 99d195da 改了全部副本后只部署了各流自己的函数 → 线上 **45 个函数**跑的仍是 09-19 旧版
 * （B2B 角色在旧版里会被兜底成 staff 档放行）。同一模式 2026-09 已出过一次（29 个函数缺股东门禁）。
 * 仓库内一致 ≠ 线上一致，本脚本补上「线上那一侧」。
 *
 * 做法：对 `check-shared-modules.mjs` 登记的共享家族（+ 已由其它守卫覆盖的同类家族），
 * 逐个下载持有副本的云函数线上包，只比对这些共享文件；对每份漂移再拿线上内容去匹配
 * **仓库 canonical 的 git 历史**，给出方向：
 *   · 「线上是 <提交> 版，仓库较新」 → 漏部署，可用 deploy-drifted.sh 点名补部署；
 *   · 「线上内容不在仓库历史里」      → 可能线上有仓库没有的改动，**先取证再动**。
 *
 * 用法：
 *   npm run audit:shared-drift                                  # 全部家族
 *   npm run audit:shared-drift -- --module staffGuard.js        # 只看某家族（可重复）
 *   npm run audit:shared-drift -- --fn dispatchMessage,refundOrder
 *   npm run audit:shared-drift -- --json
 *   npm run audit:shared-drift -- --selftest                    # 离线自检（不联网）
 * 凭证：admin/.env 或 admin/.env.local 的 TCB_SECRET_ID / TCB_SECRET_KEY
 * 退出码：有漂移 / 下载失败为 1；凭证或依赖缺失为 2。
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FAMILIES, COVERED_ELSEWHERE, findCopies } from '../miniprogram/scripts/check-shared-modules.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const FN_ROOT = join(ROOT, 'miniprogram', 'cloudfunctions')
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const require = createRequire(import.meta.url)

const sha = (buf) => createHash('sha1').update(buf).digest('hex').slice(0, 10)

/**
 * 纯函数：给一份线上副本定性。
 * @param {{local: string|null, online: string|null, history: Array<{commit: string, date: string, sha: string}>}} x
 */
export function classifyDrift({ local, online, history }) {
  if (online == null) return { status: 'online-missing', note: '线上包里没有这个文件（仓库有）' }
  if (local === online) return { status: 'same' }
  const hit = history.find((h) => h.sha === online)
  if (hit) return { status: 'behind', note: `线上是 ${hit.commit}（${hit.date}）版，仓库较新 → 漏部署` }
  return { status: 'unknown', note: '线上内容不在仓库历史里 → 可能线上有仓库没有的改动，先取证再动' }
}

function selftest() {
  const history = [{ commit: 'aaa', date: '2026-09-19', sha: 'old1' }, { commit: 'bbb', date: '2026-09-28', sha: 'new1' }]
  const cases = [
    ['一致', { local: 'new1', online: 'new1', history }, 'same'],
    ['线上是历史旧版 → behind 并点名提交', { local: 'new1', online: 'old1', history }, 'behind', /aaa/],
    ['线上内容不在历史里 → unknown', { local: 'new1', online: 'zzz', history }, 'unknown'],
    ['线上缺文件 → online-missing', { local: 'new1', online: null, history }, 'online-missing']
  ]
  let ok = true
  for (const [name, input, want, noteRe] of cases) {
    const got = classifyDrift(input)
    const pass = got.status === want && (!noteRe || noteRe.test(got.note || ''))
    if (!pass) ok = false
    console.log(`${pass ? '✓' : '✗'} ${name} → ${got.status}${got.note ? '（' + got.note + '）' : ''}`)
  }
  const fams = families()
  const staff = fams.find((f) => f.module === 'staffGuard.js')
  const famOk = !!staff && staff.copies.length >= 50
  console.log(`${famOk ? '✓' : '✗'} 家族清单来自 check-shared-modules（staffGuard 副本 ${staff ? staff.copies.length : 0} 份）`)
  if (!ok || !famOk) {
    console.error('自检失败')
    process.exit(1)
  }
  console.log('自检通过（离线，未联网）')
  process.exit(0)
}

function families() {
  const extra = COVERED_ELSEWHERE.map((s) => s.split('（')[0].trim()).filter((m) => m.endsWith('.js'))
  const list = [...FAMILIES.map((f) => ({ module: f.module, canonical: f.canonical })), ...extra.map((m) => ({ module: m, canonical: null }))]
  return list.map((f) => ({ ...f, copies: findCopies(f.module).filter((p) => p.split('/').length === 2) }))
}

function gitHistory(relPath) {
  try {
    const out = execFileSync('git', ['log', '--format=%h %ad', '--date=short', '--', relPath], { cwd: ROOT, encoding: 'utf8' })
    return out.trim().split('\n').filter(Boolean).map((line) => {
      const [commit, date] = line.split(' ')
      let content = ''
      try { content = execFileSync('git', ['show', `${commit}:${relPath}`], { cwd: ROOT, maxBuffer: 1 << 26 }) } catch (e) { return null }
      return { commit, date, sha: sha(content) }
    }).filter(Boolean)
  } catch (e) {
    return []
  }
}

function readEnv(file) {
  const out = {}
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
  } catch (e) { /* 无此文件 */ }
  return out
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--selftest')) selftest()
  const pick = (flag) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? argv[i + 1].split(',') : []))
  const onlyModules = pick('--module')
  const onlyFns = pick('--fn')
  const asJson = argv.includes('--json')

  const env = { ...readEnv(join(ROOT, 'admin/.env')), ...readEnv(join(ROOT, 'admin/.env.local')) }
  if (!env.TCB_SECRET_ID || !env.TCB_SECRET_KEY) {
    console.error('缺少 TCB_SECRET_ID / TCB_SECRET_KEY（admin/.env 或 admin/.env.local）')
    process.exit(2)
  }
  let CB = null
  for (const c of [join(ROOT, 'node_modules/@cloudbase/manager-node'), join(ROOT, 'admin/node_modules/@cloudbase/manager-node')]) {
    try { CB = require(c); break } catch (e) { /* 试下一个 */ }
  }
  if (!CB) {
    console.error('找不到 @cloudbase/manager-node，请在仓库根目录 npm ci --include=dev 后重试')
    process.exit(2)
  }
  const app = CB.init({ secretId: env.TCB_SECRET_ID, secretKey: env.TCB_SECRET_KEY, envId: ENV_ID })

  const fams = families().filter((f) => !onlyModules.length || onlyModules.includes(f.module))
  const byFn = new Map()
  for (const f of fams) {
    for (const rel of f.copies) {
      const fn = rel.split('/')[0]
      if (onlyFns.length && !onlyFns.includes(fn)) continue
      if (!byFn.has(fn)) byFn.set(fn, [])
      byFn.get(fn).push(f)
    }
  }
  const histCache = new Map()
  // 按副本自身路径取历史：superset 家族（如 makeOrder/memberLevels.js）与 canonical 本就不同
  const historyFor = (f, fn) => {
    const rel = `miniprogram/cloudfunctions/${fn}/${f.module}`
    if (!histCache.has(rel)) histCache.set(rel, gitHistory(rel))
    return histCache.get(rel)
  }

  const TMP = mkdtempSync(join(tmpdir(), 'shared-drift-'))
  const rows = []
  const fnNames = [...byFn.keys()].sort()
  if (!asJson) console.log(`下载 ${fnNames.length} 个云函数线上包，比对 ${fams.length} 个共享家族（只读）…`)
  for (const fn of fnNames) {
    const dest = join(TMP, fn)
    mkdirSync(dest, { recursive: true })
    try {
      await app.functions.downloadFunctionCode({ destPath: dest, envId: ENV_ID, functionName: fn })
    } catch (e) {
      rows.push({ fn, module: '*', status: 'download-failed', note: String((e && e.message) || e).slice(0, 80) })
      continue
    }
    for (const f of byFn.get(fn)) {
      const lp = join(FN_ROOT, fn, f.module)
      const op = join(dest, f.module)
      const local = sha(readFileSync(lp))
      const online = existsSync(op) ? sha(readFileSync(op)) : null
      rows.push({ fn, module: f.module, ...classifyDrift({ local, online, history: historyFor(f, fn) }) })
    }
    try { rmSync(dest, { recursive: true, force: true }) } catch (e) { /* 残留无害 */ }
  }
  try { rmSync(TMP, { recursive: true, force: true }) } catch (e) { /* 残留无害 */ }

  const bad = rows.filter((r) => r.status !== 'same')
  if (asJson) {
    console.log(JSON.stringify({ functions: fnNames.length, checked: rows.length, drift: bad }, null, 2))
    process.exit(bad.length ? 1 : 0)
  }
  const byModule = {}
  for (const r of bad) (byModule[r.module] ||= []).push(r)
  for (const [mod, list] of Object.entries(byModule)) {
    console.log(`\n✗ ${mod}：${list.length} 个函数线上与仓库不一致`)
    const groups = {}
    for (const r of list) (groups[`${r.status}｜${r.note || ''}`] ||= []).push(r.fn)
    for (const [k, fns] of Object.entries(groups)) console.log(`  · ${k.split('｜')[1] || k}：${fns.join(' ')}`)
  }
  console.log(`\n共享文件漂移报告：${fnNames.length} 个函数 / ${rows.length} 份副本，一致 ${rows.length - bad.length}，不一致或异常 ${bad.length}`)
  if (bad.length) {
    console.log('处置：「仓库较新」的用 bash miniprogram/scripts/deploy-drifted.sh --dry-run <函数名> 确认只差共享文件后再点名部署；')
    console.log('      「不在仓库历史里」的先下载线上代码取证，**不要直接覆盖**。')
    process.exit(1)
  }
  console.log('✓ 线上共享文件与仓库完全一致')
}

main().catch((e) => {
  console.error('报告失败:', String((e && e.message) || e))
  process.exit(2)
})
