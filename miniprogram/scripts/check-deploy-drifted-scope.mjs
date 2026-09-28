#!/usr/bin/env node
/**
 * deploy-drifted.sh「只比对 / 只部署点名函数」守卫
 *
 * 为什么需要（2026-09-28 产品负责人口径）：
 *   `deploy-drifted.sh <函数名>` 的第 1 步曾**无条件全量比对**（下载 ~130 个云函数，20+ 分钟），
 *   带函数名只影响部署清单 —— 每条流部署一个函数都要白等 20 分钟。
 *   现在要求：带函数名时只比对这些、只部署其中有漂移的、只复比这些；全量必须显式 `--all`。
 *
 * 怎么证明（行为，不是 grep）：把脚本拷到临时目录，用**假比对器**（记录收到的函数名）和
 * **假 tcb**（放在 PATH 最前，记录部署了谁）真跑一遍 bash —— 全程不联网、不可能真部署。
 *   A  --dry-run X        → 比对器只收到 [X]，且只调用一次；不调用 tcb
 *   B  无参数              → exit 2 打印用法，比对器一次都不调
 *   C  --all --dry-run    → 比对器收到 []（全量），这是唯一的全量路径
 *   D  比对器自身失败      → exit 2「比对失败」，绝不谎报「一致」、不调用 tcb
 *   E  点名 a b、仅 a 漂移 → 比对 [a,b]、只部署 a、复比只 [a]
 *   F  --selftest-args     → 脚本自带的参数解析自检通过
 *
 * 用法：
 *   node miniprogram/scripts/check-deploy-drifted-scope.mjs
 *   node miniprogram/scripts/check-deploy-drifted-scope.mjs --selftest   # 注入 5 种回归（只改内存副本，不写源码）
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, existsSync, chmodSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const SH = resolve(HERE, 'deploy-drifted.sh')

const FAKE_CHECKER = `
const fs = require('fs')
const names = process.argv.slice(2).filter((a) => !a.startsWith('--'))
fs.appendFileSync(process.env.FAKE_REC, JSON.stringify(names) + '\\n')
if (process.env.FAKE_FAIL === '1') { console.error('假比对器：模拟缺凭据'); process.exit(2) }
const cnt = process.env.FAKE_CNT
const n = fs.existsSync(cnt) ? Number(fs.readFileSync(cnt, 'utf8')) : 0
fs.writeFileSync(cnt, String(n + 1))
const drift = n === 0 ? (process.env.FAKE_DRIFT || '').split(' ').filter(Boolean) : []
const bad = drift.filter((d) => names.length === 0 || names.includes(d)).map((name) => ({ name, status: '不一致' }))
console.log(JSON.stringify({ total: names.length || 130, inconsistent: bad }))
process.exit(bad.length ? 1 : 0)
`

const FAKE_TCB = `#!/bin/sh
echo "$*" >> "$FAKE_TCB_REC"
echo "deployed successfully"
`

/** 在临时目录里跑一次脚本（src = 脚本源码文本） */
function runOnce(src, args, { drift = '', fail = false, fns = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-drifted-scope-'))
  try {
    mkdirSync(join(dir, 'miniprogram', 'scripts'), { recursive: true })
    for (const f of fns) {
      mkdirSync(join(dir, 'miniprogram', 'cloudfunctions', f), { recursive: true })
      writeFileSync(join(dir, 'miniprogram', 'cloudfunctions', f, 'index.js'), '')
    }
    const sh = join(dir, 'miniprogram', 'scripts', 'deploy-drifted.sh')
    writeFileSync(sh, src)
    writeFileSync(join(dir, 'fake-checker.cjs'), FAKE_CHECKER)
    mkdirSync(join(dir, 'bin'))
    writeFileSync(join(dir, 'bin', 'tcb'), FAKE_TCB)
    chmodSync(join(dir, 'bin', 'tcb'), 0o755)
    const rec = join(dir, 'checker.rec')
    const tcbRec = join(dir, 'tcb.rec')
    const r = spawnSync('bash', [sh, ...args], {
      encoding: 'utf8',
      timeout: 20000,
      env: {
        ...process.env,
        PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
        DEPLOY_DRIFTED_CHECKER: join(dir, 'fake-checker.cjs'),
        FAKE_REC: rec,
        FAKE_CNT: join(dir, 'checker.cnt'),
        FAKE_TCB_REC: tcbRec,
        FAKE_DRIFT: drift,
        FAKE_FAIL: fail ? '1' : '0',
      },
    })
    const lines = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean) : [])
    return {
      code: r.status,
      out: (r.stdout || '') + (r.stderr || ''),
      calls: lines(rec).map((l) => JSON.parse(l)),
      deploys: lines(tcbRec).map((l) => l.split(' ')[2]),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** 对一份脚本源码跑全部场景，返回失败说明列表 */
export function verify(src) {
  const fails = []
  const t = (name, ok, extra) => { if (!ok) fails.push(`${name}${extra ? `\n      ${extra}` : ''}`) }

  const a = runOnce(src, ['--dry-run', 'manageWishWall'], { drift: 'manageWishWall' })
  t('A --dry-run 单函数：比对器只收到 [manageWishWall] 且只调一次', eq(a.calls, [['manageWishWall']]), `实际调用=${JSON.stringify(a.calls)}`)
  t('A --dry-run 单函数：不调用 tcb、exit 0', a.deploys.length === 0 && a.code === 0, `exit=${a.code} deploys=${a.deploys}`)

  const b = runOnce(src, [])
  t('B 无参数：exit 2 且比对器一次都不调（不再默认全量）', b.code === 2 && b.calls.length === 0, `exit=${b.code} 调用=${JSON.stringify(b.calls)}`)

  const c = runOnce(src, ['--all', '--dry-run'], { drift: 'x y' })
  t('C --all --dry-run：比对器收到 []（全量）', eq(c.calls, [[]]) && c.deploys.length === 0, `实际调用=${JSON.stringify(c.calls)}`)

  const d = runOnce(src, ['onlyOne'], { fail: true, fns: ['onlyOne'] })
  t('D 比对器失败：exit 2「比对失败」且不部署', d.code === 2 && /比对失败/.test(d.out) && d.deploys.length === 0,
    `exit=${d.code} deploys=${d.deploys} out=${d.out.slice(0, 120)}`)

  const e = runOnce(src, ['a', 'b'], { drift: 'a', fns: ['a', 'b'] })
  t('E 点名 a b：第 1 步只比对 [a,b]', eq(e.calls[0], ['a', 'b']), `实际=${JSON.stringify(e.calls)}`)
  t('E 只部署漂移的 a（不部署一致的 b）', eq(e.deploys, ['a']), `实际部署=${JSON.stringify(e.deploys)}`)
  t('E 复比只 [a]', eq(e.calls[1], ['a']) && e.calls.length === 2, `实际=${JSON.stringify(e.calls)}`)
  t('E exit 0 且「复比通过」', e.code === 0 && /复比通过/.test(e.out), `exit=${e.code}`)

  const dir = mkdtempSync(join(tmpdir(), 'deploy-drifted-args-'))
  try {
    const p = join(dir, 'x.sh')
    writeFileSync(p, src)
    const f = spawnSync('bash', [p, '--selftest-args'], { encoding: 'utf8', timeout: 10000 })
    t('F --selftest-args 通过', f.status === 0, (f.stdout || '').split('\n').filter((l) => l.startsWith('✗')).join(' | '))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  return fails
}

const INJECTIONS = [
  ['第 1 步不传函数名（带参仍全量）', 'node "$CHECKER" $NAMES --json', 'node "$CHECKER" --json'],
  ['无参数静默走全量', 'if [ "$all" = "0" ] && [ -z "$names" ]; then echo "ERR 未指定函数名（全量请显式 --all）"; return 0; fi', ''],
  ['部署全部点名函数而非仅漂移', 'for name in $DRIFT; do', 'for name in $NAMES; do'],
  ['比对器失败被当成一致/漂移', 'if [ "$rc_check" -ge 2 ] || [ "$DRIFT" = "__READ_FAIL__" ]; then', 'if false; then'],
  ['复比不传函数名（全量复比）', 'node "$CHECKER" $DRIFT --json', 'node "$CHECKER" --json'],
]

function selftest(src) {
  let bad = 0
  const base = verify(src)
  console.log(`${base.length ? '✗' : '✓'} 真源码全部场景通过`)
  if (base.length) { bad += 1; base.forEach((f) => console.log('      ' + f)) }
  for (const [name, from, to] of INJECTIONS) {
    if (!src.includes(from)) { console.log(`✗ 注入锚点缺失：${name}（脚本改过？请同步本自检）`); bad += 1; continue }
    const hit = verify(src.replace(from, to))
    console.log(`${hit.length ? '✓' : '✗'} ★ 注入「${name}」被检出${hit.length ? `（${hit[0].split('\n')[0]}）` : ''}`)
    if (!hit.length) bad += 1
  }
  if (bad) { console.error(`\n自检失败 ${bad} 项 —— 守卫不可信`); process.exit(1) }
  console.log(`\n自检通过：真源码 6 类场景通过，${INJECTIONS.length} 种回归注入全部检出（只改内存副本，不写源码）`)
}

function main() {
  const src = readFileSync(SH, 'utf8')
  if (process.argv.includes('--selftest')) return selftest(src)
  const fails = verify(src)
  for (const f of fails) console.error(`✗ ${f}`)
  if (fails.length) {
    console.error(`\ndeploy-drifted.sh 作用域守卫未通过：${fails.length} 项（带函数名必须只比对/只部署这些；全量须显式 --all）`)
    process.exit(1)
  }
  console.log('✓ deploy-drifted.sh 只比对/只部署点名函数；全量须显式 --all（6 类场景，离线假比对器 + 假 tcb）')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
