#!/usr/bin/env node
/**
 * 分包体积守卫：任一分包按上传口径（编译后）超过 2M，或余量低于阈值 → 失败（2026-10-11）
 *
 * 背景：礼赠「凭礼笺领取」上线后 feature 分包源码原始体积 2123.9 KiB，被怀疑超过微信单分包 2M 上限。
 * 实测（微信 CLI preview --info-output，与上传同一编译器）：feature 编译后 1,539,519 B（距十进制 2M 尚余约 450 KiB），未超限。
 * extra / manager 源码原始体积在此之前就已 > 2048 KiB 且一直能上传 —— 所以**源码原始体积不能当判据**
 * （直接判会假红，错题本 E7）；编译后体积只有本机开发者工具能测，CI 测不了。
 *
 * 口径：
 *   · 基线 subpackage-size-baseline.json：每个分包的「编译后实测字节」与「测量时的源码原始字节」；
 *   · 估算编译后 = 基线编译后 + max(0, 当前原始 − 基线原始)
 *     —— 源码增量按 1:1 计入（编译会去注释 / 缩进，实际增量更小，偏保守）；
 *        源码变小不抵扣（删注释能让原始体积大降、编译后不变，抵扣会假绿）；
 *   · 上限按十进制 2,000,000 B（比 2048 KiB 严约 95 KiB；微信按十进制判主包 1.5M 已实测，见 check:main-package-size，
 *     分包同按十进制取严，宁可早红不假绿）；
 *   · 失败：估算 > 2,000,000 B，或余量 < MIN_MARGIN_BYTES；
 *           app.json 有分包而基线没有（新分包必须先实测），或基线里有已不存在的分包；
 *   · 警告：余量 < WARN_MARGIN_BYTES；或源码相对基线变动超过 STALE_DRIFT_BYTES（估算已偏粗，建议重测）。
 *
 * 用法：
 *   node miniprogram/scripts/check-subpackage-size.mjs
 *   node miniprogram/scripts/check-subpackage-size.mjs --selftest
 *   # 重测基线（本机、开发者工具已登录；--project 指向与本仓 miniprogram 内容一致的开发仓）：
 *   node miniprogram/scripts/check-subpackage-size.mjs --measure --project <开发仓目录> [--info <已有 info-output.json>]
 *   （--info-output 不能写 /tmp：开发者工具不认，见 docs/发版审计_1.1.1_2026-09-16.md）
 */
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir, homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { loadPackedProject, subpackageRawBytes } from './lib/packed-files.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP_DEFAULT = resolve(HERE, '..')
const BASELINE_DEFAULT = join(HERE, 'subpackage-size-baseline.json')
const WECHAT_SUB_LIMIT_BYTES = 2000000
const MIN_MARGIN_BYTES = 50 * 1024
const WARN_MARGIN_BYTES = 150 * 1024
const STALE_DRIFT_BYTES = 200 * 1024
const WECHAT_CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'

const kib = (b) => `${(b / 1024).toFixed(1)} KiB`

function argValue(args, name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

export function evaluate(mpRoot, baseline) {
  const { subRoots, packed } = loadPackedProject(mpRoot)
  const raw = subpackageRawBytes(mpRoot, subRoots, packed)
  const base = (baseline && baseline.packages) || {}
  const problems = []
  const warns = []
  const rows = []
  for (const root of subRoots) {
    const b = base[root]
    if (!b || !Number.isFinite(b.compiledBytes) || !Number.isFinite(b.rawBytes)) {
      problems.push(`分包 ${root} 不在基线里：新分包须先用 --measure 实测编译后体积再登记`)
      continue
    }
    const drift = raw[root] - b.rawBytes
    const estimate = b.compiledBytes + Math.max(0, drift)
    const margin = WECHAT_SUB_LIMIT_BYTES - estimate
    rows.push({ root, raw: raw[root], drift, estimate, margin })
    if (estimate > WECHAT_SUB_LIMIT_BYTES) {
      problems.push(`分包 ${root} 估算编译后 ${estimate} B（${kib(estimate)}）> 微信单分包上限 2M（${WECHAT_SUB_LIMIT_BYTES} B），上传会失败`)
    } else if (margin < MIN_MARGIN_BYTES) {
      problems.push(`分包 ${root} 估算编译后 ${kib(estimate)}，余量 ${kib(margin)} < 阈值 ${kib(MIN_MARGIN_BYTES)}：先迁页面到余量大的分包`)
    } else if (margin < WARN_MARGIN_BYTES) {
      warns.push(`分包 ${root} 余量 ${kib(margin)} < ${kib(WARN_MARGIN_BYTES)}，再加功能前先规划迁页`)
    }
    if (Math.abs(drift) > STALE_DRIFT_BYTES) {
      warns.push(`分包 ${root} 源码相对基线变动 ${drift > 0 ? '+' : ''}${kib(drift)}，估算已偏粗，建议 --measure 重测基线`)
    }
  }
  for (const root of Object.keys(base)) {
    if (!subRoots.includes(root)) problems.push(`基线里的分包 ${root} 已不在 app.json：请重测或删掉该条`)
  }
  return { rows, problems, warns }
}

function measure(args) {
  const project = argValue(args, '--project')
  if (!project || !existsSync(join(project, 'app.json'))) {
    console.error('✗ --measure 需要 --project <含 app.json 的小程序工程目录>')
    process.exit(2)
  }
  let infoPath = argValue(args, '--info')
  if (!infoPath) {
    const dir = join(homedir(), '.mp-size-probe')
    mkdirSync(dir, { recursive: true })
    infoPath = join(dir, `info-${Date.now()}.json`)
    const r = spawnSync(WECHAT_CLI, [
      'preview', '--project', resolve(project), '--info-output', infoPath,
      '--qr-format', 'base64', '--qr-output', join(dir, 'qr.txt'), '--lang', 'zh'
    ], { encoding: 'utf8' })
    if (r.status !== 0 || !existsSync(infoPath)) {
      console.error(`✗ 微信 CLI 预览编译失败（exit ${r.status}）：\n${r.stdout || ''}\n${r.stderr || ''}`)
      process.exit(2)
    }
  }
  const info = JSON.parse(readFileSync(infoPath, 'utf8'))
  const compiled = {}
  for (const p of (info.size && info.size.packages) || []) {
    const root = String(p.name || '').replace(/^\//, '').replace(/\/$/, '')
    if (root && root !== 'TOTAL' && root !== 'main') compiled[root] = p.size
  }
  const { subRoots, packed } = loadPackedProject(resolve(project))
  const raw = subpackageRawBytes(resolve(project), subRoots, packed)
  const packages = {}
  for (const root of subRoots) {
    if (!Number.isFinite(compiled[root])) {
      console.error(`✗ info-output 里没有分包 ${root} 的编译后体积`)
      process.exit(2)
    }
    packages[root] = { compiledBytes: compiled[root], rawBytes: raw[root] }
  }
  const out = {
    _doc: '分包编译后体积实测基线（check:subpackage-size 用）。只能用 --measure 重写，不要手改数字。',
    measuredAt: new Date().toISOString().slice(0, 10),
    method: '微信开发者工具 CLI preview --info-output（与上传同一编译器）',
    commit: argValue(args, '--commit') || '',
    packages
  }
  const target = argValue(args, '--baseline') || BASELINE_DEFAULT
  writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`)
  console.log(`✓ 已写基线 ${target}`)
  for (const [root, v] of Object.entries(packages)) console.log(`  ${root} 编译后 ${kib(v.compiledBytes)} · 原始 ${kib(v.rawBytes)}`)
}

/** 自检：最小假工程 + 假基线，跑真脚本的子进程，不碰真仓 */
function runFake({ subs, baseline, pads }) {
  const dir = mkdtempSync(join(tmpdir(), 'subpkg-size-'))
  try {
    const mp = join(dir, 'miniprogram')
    mkdirSync(join(mp, 'pages', 'index'), { recursive: true })
    writeFileSync(join(mp, 'app.json'), JSON.stringify({
      pages: ['pages/index/index'],
      subpackages: subs.map((root) => ({ root, pages: ['x/index'] }))
    }))
    writeFileSync(join(mp, 'project.config.json'), JSON.stringify({
      packOptions: { ignore: [{ type: 'folder', value: 'scripts' }] }
    }))
    for (const root of subs) {
      mkdirSync(join(mp, root, 'x'), { recursive: true })
      writeFileSync(join(mp, root, 'x', 'pad.bin'), Buffer.alloc(pads[root] || 0, 1))
    }
    mkdirSync(join(mp, 'scripts'), { recursive: true })
    writeFileSync(join(mp, 'scripts', 'ignored.bin'), Buffer.alloc(3 * 1024 * 1024, 1))
    const bl = join(dir, 'baseline.json')
    writeFileSync(bl, JSON.stringify({ packages: baseline }))
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--root', mp, '--baseline', bl], { encoding: 'utf8' })
    return { status: r.status, out: `${r.stdout || ''}\n${r.stderr || ''}` }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function selftest() {
  const fail = (msg, out) => {
    console.error(`selftest ✗ ${msg}\n${out || ''}`)
    process.exit(1)
  }
  const KB = 1024
  const S = 'subpackages/feature'
  const T = 'subpackages/extra'

  // ① 基线内、余量充足（被 ignore 的 3 MiB scripts/ 不得计入）→ 通过
  const a = runFake({ subs: [S], pads: { [S]: 100 * KB }, baseline: { [S]: { compiledBytes: 1500 * KB, rawBytes: 100 * KB } } })
  if (a.status !== 0) fail('余量充足却失败（或把 packOptions.ignore 的目录算进去了）', a.out)

  // ② 源码增长让估算越过 2M → 失败并点名分包与上限
  const b = runFake({ subs: [S], pads: { [S]: 700 * KB }, baseline: { [S]: { compiledBytes: 1500 * KB, rawBytes: 100 * KB } } })
  if (b.status === 0 || !/subpackages\/feature/.test(b.out) || !/上限 2M（2000000 B）/.test(b.out)) fail('估算超 2M 未失败或未点名', b.out)

  // ③ 未超 2M 但余量 < 50 KiB → 失败
  const c = runFake({ subs: [S], pads: { [S]: 100 * KB }, baseline: { [S]: { compiledBytes: 1920 * KB, rawBytes: 100 * KB } } })
  if (c.status === 0 || !/余量 .* < 阈值 50\.0 KiB/.test(c.out)) fail('余量低于阈值未失败', c.out)

  // ④ 源码大幅变小（如删注释）不得抵扣：基线编译后已贴线 → 仍失败
  const d = runFake({ subs: [S], pads: { [S]: 10 * KB }, baseline: { [S]: { compiledBytes: 1930 * KB, rawBytes: 500 * KB } } })
  if (d.status === 0) fail('源码变小被抵扣，贴线分包假绿', d.out)

  // ⑤ app.json 新增分包但基线没有 → 失败
  const e = runFake({ subs: [S, T], pads: { [S]: 1 * KB, [T]: 1 * KB }, baseline: { [S]: { compiledBytes: 100 * KB, rawBytes: 1 * KB } } })
  if (e.status === 0 || !/subpackages\/extra 不在基线里/.test(e.out)) fail('新分包缺基线未失败', e.out)

  // ⑥ 基线里有已删除的分包 → 失败
  const f = runFake({ subs: [S], pads: { [S]: 1 * KB }, baseline: { [S]: { compiledBytes: 100 * KB, rawBytes: 1 * KB }, [T]: { compiledBytes: 100 * KB, rawBytes: 1 * KB } } })
  if (f.status === 0 || !/subpackages\/extra 已不在 app\.json/.test(f.out)) fail('基线残留分包未失败', f.out)

  // ⑦ 余量介于 50–150 KiB → 只警告不失败
  const g = runFake({ subs: [S], pads: { [S]: 1 * KB }, baseline: { [S]: { compiledBytes: 1860 * KB, rawBytes: 1 * KB } } })
  if (g.status !== 0 || !/⚠ 分包 subpackages\/feature 余量/.test(g.out)) fail('警告带内应只警告不失败', g.out)

  console.log('selftest ok（超 2M / 余量低于阈值 / 变小不抵扣 / 新分包缺基线 / 基线残留 均失败；警告带只警告；ignore 目录不计入）')
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--selftest')) return selftest()
  if (args.includes('--measure')) return measure(args)
  const mpRoot = resolve(argValue(args, '--root') || MP_DEFAULT)
  const blPath = resolve(argValue(args, '--baseline') || BASELINE_DEFAULT)
  if (!existsSync(blPath)) {
    console.error(`✗ 缺少基线 ${blPath}（用 --measure 生成）`)
    process.exit(1)
  }
  const baseline = JSON.parse(readFileSync(blPath, 'utf8'))
  const { rows, problems, warns } = evaluate(mpRoot, baseline)
  if (baseline.measuredAt) console.log(`基线 ${baseline.measuredAt}${baseline.commit ? ` @ ${baseline.commit}` : ''} · 上限 ${WECHAT_SUB_LIMIT_BYTES} B · 失败阈值余量 < ${kib(MIN_MARGIN_BYTES)}`)
  for (const r of rows) {
    console.log(`  ${r.root} 估算编译后 ${kib(r.estimate)}（余 ${kib(r.margin)}）· 源码 ${kib(r.raw)}（较基线 ${r.drift >= 0 ? '+' : ''}${kib(r.drift)}）`)
  }
  for (const w of warns) console.warn(`⚠ ${w}`)
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`)
    process.exit(1)
  }
  console.log('✓ 分包体积检查通过')
}

main()
