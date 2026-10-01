#!/usr/bin/env node
/**
 * care-common 四份一致性守卫 · `check:care-common-mirrors`
 *
 * 为何是四份而不是一份共享引用（2026-10-01 评估，见 miniprogram/docs/细节雕刻_A流_2026-10.md 第 4 轮）：
 *   - 引用方分属 feature / extra / content / business 四个分包，小程序禁止跨分包 @import；
 *   - 收进主包要 ~8.3KB，而主包余量 < 7KB（建议线 1.5M）。
 * 所以保留四份，用本守卫保证：
 *   1. 仓里所有 care-common.wxss 字节一致（任何一份改了，四份一起改）；
 *   2. 份数与清单 COPIES 一致（多出/少了都红，防止新开第五份或误删一份）；
 *   3. 每个 `@import '…care-common.wxss'` 都解析到**同一分包内**存在的副本。
 * subpackage-mirrors.json 只覆盖 feature→extra→business 两条，content 那份此前无人看守。
 *
 * 用法：node miniprogram/scripts/check-care-common-mirrors.mjs [--selftest]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const NAME = 'care-common.wxss'
const COPIES = [
  'subpackages/feature/care/care-common.wxss',
  'subpackages/extra/care/care-common.wxss',
  'subpackages/content/care/care-common.wxss',
  'subpackages/business/components/WalletPanelWallet/styles/care/care-common.wxss'
]
const SKIP = new Set(['node_modules', 'miniprogram_npm', 'scripts', 'docs'])

function listWxss(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n) || n.startsWith('.')) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) listWxss(p, out)
    else if (n.endsWith('.wxss')) out.push(relative(MP, p).split('\\').join('/'))
  }
  return out
}

const roots = JSON.parse(readFileSync(join(MP, 'app.json'), 'utf8'))
  .subpackages.map((s) => s.root.replace(/\/$/, '') + '/')
const pkgOf = (f) => roots.find((r) => f.startsWith(r)) || '(主包)'

function judge(files) {
  const problems = []
  const copies = Object.keys(files).filter((f) => posix.basename(f) === NAME).sort()
  const want = [...COPIES].sort()
  for (const f of want) if (!copies.includes(f)) problems.push(`缺少副本：${f}`)
  for (const f of copies) if (!want.includes(f)) problems.push(`清单外的副本：${f}（新增副本须登记 COPIES 并说明原因）`)
  const ref = files[COPIES[0]]
  for (const f of copies) if (ref != null && files[f] !== ref) problems.push(`内容漂移：${f} 与 ${COPIES[0]} 不一致（四份须同改）`)
  for (const [f, css] of Object.entries(files)) {
    for (const m of css.matchAll(/@import\s+['"]([^'"]*care-common\.wxss)['"]/g)) {
      const target = posix.normalize(posix.join(posix.dirname(f), m[1]))
      if (!(target in files)) problems.push(`${f} 引用的 ${m[1]} 不存在`)
      else if (pkgOf(target) !== pkgOf(f)) problems.push(`${f} 跨分包引用 ${target}`)
    }
  }
  return { copies, problems }
}

const files = Object.fromEntries(listWxss(MP).map((f) => [f, readFileSync(join(MP, f), 'utf8')]))

if (process.argv.includes('--selftest')) {
  const userAcc = 'subpackages/content/user/user-account.wxss'
  const cases = [
    ['content 那份改一个值', { ...files, [COPIES[2]]: files[COPIES[2]].replace(/;/, '; color: red;') }],
    ['business 那份被删', Object.fromEntries(Object.entries(files).filter(([f]) => f !== COPIES[3]))],
    ['新开第五份', { ...files, 'subpackages/plays/care/care-common.wxss': files[COPIES[0]] }],
    ['引用改成跨分包', { ...files, [userAcc]: files[userAcc].replace("'../care/care-common.wxss'", "'../../feature/care/care-common.wxss'") }]
  ]
  let ok = judge(files).problems.length === 0
  console.log(`${ok ? '✓' : '✗'} 基线：真源码为绿`)
  for (const [name, mutated] of cases) {
    const red = judge(mutated).problems.length > 0
    if (!red) ok = false
    console.log(`${red ? '✓' : '✗'} ${name} → ${red ? '检出' : '漏检'}`)
  }
  console.log(ok ? '✓ selftest 通过' : '✗ selftest 失败')
  process.exit(ok ? 0 : 1)
}

const { copies, problems } = judge(files)
if (problems.length) {
  console.log('✗ care-common 四份一致性：')
  for (const p of problems) console.log('  - ' + p)
  process.exit(1)
}
console.log(`✓ care-common 四份一致：${copies.length} 份字节相同，引用均在本分包内`)
