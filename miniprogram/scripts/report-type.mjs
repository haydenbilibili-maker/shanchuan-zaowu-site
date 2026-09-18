/**
 * 字号/行高分布报告（**只报告，不改动任何文件**）
 *
 * 用途（v1.1.2 · W1 第一步）：把"字号不统一"从印象变成数字 —— 找出**离群字号**与热点文件，
 * 作为「字阶令牌化」的施工依据。范式同既有 `npm run report:colors`（只报告不改动，禁止 find-replace）。
 *
 * 用法：
 *   node miniprogram/scripts/report-type.mjs            # 人读报告
 *   node miniprogram/scripts/report-type.mjs --json     # 机器可读
 *   node miniprogram/scripts/report-type.mjs --strict   # 离群值超阈值则退出码 1（可用于棘轮）
 *   node miniprogram/scripts/report-type.mjs --selftest
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const MP = resolve(ROOT, 'miniprogram')
const SKIP = new Set(['node_modules', '.git', 'miniprogram_npm', 'dist', 'scripts'])
const ORPHAN_MAX = 2            // 出现 ≤2 次视为离群
const TOKEN_MIN = 10            // 出现 ≥10 次视为事实字阶

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.wxss')) out.push(p)
  }
  return out
}

function collect() {
  const fs = new Map()        // value → count
  const lh = new Map()
  const perFile = new Map()   // file → { count, values:Set, orphan:number }
  for (const abs of walk(MP)) {
    const rel = relative(ROOT, abs)
    const lines = readFileSync(abs, 'utf8').split('\n')
    let count = 0
    const values = new Set()
    for (const line of lines) {
      let m = /font-size:\s*([0-9.]+)rpx/.exec(line)
      if (m) {
        const v = m[1]
        fs.set(v, (fs.get(v) || 0) + 1)
        count += 1
        values.add(v)
      }
      m = /line-height:\s*([0-9.]+)(rpx)?/.exec(line)
      if (m && !/line-height:\s*normal/.test(line)) lh.set(m[1] + (m[2] ? 'rpx' : ''), (lh.get(m[1] + (m[2] ? 'rpx' : '')) || 0) + 1)
    }
    if (count) perFile.set(rel, { count, values })
  }
  const orphans = [...fs.entries()].filter(([, n]) => n <= ORPHAN_MAX)
  const tokens = [...fs.entries()].filter(([, n]) => n >= TOKEN_MIN).map(([v]) => Number(v)).sort((a, b) => a - b)
  const perFileArr = [...perFile.entries()].map(([f, o]) => ({
    file: f,
    count: o.count,
    distinct: o.values.size,
    orphanValues: [...o.values].filter((v) => (fs.get(v) || 0) <= ORPHAN_MAX).length
  })).sort((a, b) => b.orphanValues - a.orphanValues || b.count - a.count)
  return { fs, lh, orphans, tokens, perFileArr, total: [...fs.values()].reduce((a, b) => a + b, 0) }
}

const d = collect()

/**
 * `--strict` 的唯一判定出口 —— **必须被所有输出路径调用**。
 *
 * 为什么抽成函数（2026-09-18 修，错题本 E16：「无法验证」被当成「通过」）：
 *   原实现在 `--json` 分支里 `process.exit(0)` 后就再也走不到 `--strict` 的判定，
 *   于是 `--json --strict` **静默绿**；同理 `TYPE_ORPHAN_MAX=abc` 使 Number() = NaN，
 *   `n > NaN` 恒为 false —— **非法阈值也静默绿**。两者都是"棘轮看起来在，其实没查"。
 *   ⚠️ 本次修复**不改阈值数值**（仍为 22），只堵住"绕过判定"的路径。
 */
function strictExitCode() {
  if (!process.argv.includes('--strict')) return 0
  const raw = process.env.TYPE_ORPHAN_MAX
  const max = raw === undefined || raw === '' ? 22 : Number(raw)
  if (!Number.isFinite(max) || max < 0) {
    console.error(`✗ TYPE_ORPHAN_MAX=${raw} 不是有效阈值（需 ≥0 的有限数）`
      + ' —— 阈值无效时不得给出绿色结论（错题本 E16）；请修正环境变量或去掉它')
    return 2
  }
  if (d.orphans.length > max) {
    console.error(`✗ --strict：离群字号 ${d.orphans.length} 种 > 阈值 ${max}`)
    return 1
  }
  return 0
}

if (process.argv.includes('--selftest')) {
  const self = fileURLToPath(import.meta.url)
  const target = join(MP, 'app.wxss')
  const orig = readFileSync(target, 'utf8')
  let bad = 0
  const t = (label, ok) => { if (ok) console.log(`✓ ${label}`); else { bad += 1; console.error(`✗ ${label}`) } }
  try {
    writeFileSync(target, orig + '\n.wx-probe { font-size: 237rpx; }\n')
    const r = spawnSync(process.execPath, [self, '--json'], { encoding: 'utf8' })
    const probe = (() => { try { return JSON.parse(r.stdout).orphans.find((o) => o[0] === '237') } catch (e) { return null } })()
    t('注入 237rpx 离群字号被报告检出', !!probe)
    // 判据自检（E16）：组合 flag / 非法阈值**都不得绕过硬失败**。
    // 注入的 237rpx 保证 orphans ≥ 1，故阈值 0 必然该红 —— 不依赖仓内当前离群数。
    const rJsonStrict = spawnSync(process.execPath, [self, '--json', '--strict'], {
      encoding: 'utf8', env: { ...process.env, TYPE_ORPHAN_MAX: '0' }
    })
    t('--json --strict 组合仍生效（阈值 0 → exit 1，不得静默绿）', rJsonStrict.status === 1)
    const rBadEnv = spawnSync(process.execPath, [self, '--strict'], {
      encoding: 'utf8', env: { ...process.env, TYPE_ORPHAN_MAX: 'not-a-number' }
    })
    t('非法 TYPE_ORPHAN_MAX 不得静默绿（exit 2）', rBadEnv.status === 2)
  } finally {
    writeFileSync(target, orig)
  }
  t('源文件逐字还原', readFileSync(target, 'utf8') === orig)
  if (bad) { console.error(`✗ report:type 自检失败 ${bad} 项`); process.exit(1) }
  console.log('✓ 自检通过：离群检出 + --json 不绕过棘轮 + 非法阈值不静默放行 + 源文件逐字还原')
  process.exit(0)
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    total: d.total,
    distinct: d.fs.size,
    tokens: d.tokens,
    orphans: d.orphans.sort((a, b) => Number(a[0]) - Number(b[0])),
    topFiles: d.perFileArr.slice(0, 20)
  }, null, 1))
  process.exit(strictExitCode())
}

console.log(`字号分布：${d.total} 处 font-size / ${d.fs.size} 种取值（建议字阶 = 出现 ≥${TOKEN_MIN} 次的值）`)
console.log(`\n事实字阶（${d.tokens.length} 档）: ${d.tokens.map((v) => v + 'rpx').join(' · ')}`)
console.log(`\n离群字号（出现 ≤${ORPHAN_MAX} 次，共 ${d.orphans.length} 种 —— 收敛目标）：`)
for (const [v, n] of d.orphans.sort((a, b) => Number(a[0]) - Number(b[0]))) {
  const num = Number(v)
  // 文本字号（≤48rpx）→ 并入最近的事实字阶；更大的是**图标/装饰类**，不该压到文本档 ✗
  //（首版把 260rpx 也说成"并入 48rpx"，属判据粗糙 ✗ —— 已在报告里区分处理）
  if (num <= 48) {
    const nearest = d.tokens.filter((c) => c <= 48).reduce((p, c) => (Math.abs(c - num) < Math.abs(p - num) ? c : p), 22)
    console.log(`  ${String(v).padStart(4)}rpx ×${n}  → 文本字号：建议并入 ${nearest}rpx`)
  } else {
    console.log(`  ${String(v).padStart(4)}rpx ×${n}  → 图标/装饰类：建议归入**展示档**（56/64/72/88/…，需人工确认，勿压到文本档）`)
  }
}
console.log('\n热点文件（离群字号种类 / 该文件字号总数）：')
for (const f of d.perFileArr.slice(0, 12)) {
  console.log(`  离群 ${String(f.orphanValues).padStart(2)} 种 / 共 ${String(f.count).padStart(3)} 处  ${f.file}`)
}
console.log('\n（只报告不改动 —— 收敛按页分批进行，见 docs/v1.1.2_全局细节雕刻_施工总纲.md · W1）')

process.exit(strictExitCode())
