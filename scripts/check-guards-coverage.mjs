#!/usr/bin/env node
/**
 * 守卫清单完整性守卫（2026-09-18 P1-1）
 *
 * 为什么需要：守卫清单从 `package.json` 的**单行 2690 字符**外置成 `guards/<NN>-<域>.txt`
 * （一文件一域，见 `guards/_meta.json` 的 `_why`）。**拆分会引入新的失效模式**：
 *   · 拆的过程中**漏掉**某条守卫（旧的那一条静默消失，于是没人再跑它）；
 *   · 同一条守卫被写进两个域（重复执行，且归属不清）；
 *   · 域文件里的脚本名写错 / 那条守卫没有 `:selftest`（AGENTS.md 硬性要求）；
 *   · 新增了域文件却忘了登记 `domainOrder`（永远不被执行）。
 * 这些**都不会自己报错**——清单少一条，CI 只会"更绿"。所以必须有守卫守清单本身。
 *
 * 判定五项：
 *   ① **落盘完整**：`domainOrder` 每个域恰有一个 `<NN>-<域>.txt`；`guards/` 下无游离 txt
 *   ② **互斥**：任一条守卫不得同时出现在两个域
 *   ③ **真实**：每条都是 `npm run <script>` 形式，且 `package.json` 真有这个脚本
 *   ④ **可自证**：每条都配了 `:selftest`（`:strict`/`:json`/`:update` 变体映射回基名）
 *   ⑤ **棘轮**：总条数不得少于 `_meta.json` 的 `minGuards`（**只许增不许减**，`--update` 抬基线）
 *   另：`crossWith` 只能引用真实域；`meta` 域必须登记本守卫自己（防"校验器自己不在清单里"）。
 *
 * 用法：
 *   node scripts/check-guards-coverage.mjs
 *   node scripts/check-guards-coverage.mjs --list
 *   node scripts/check-guards-coverage.mjs --update     # 抬高 minGuards 棘轮
 *   node scripts/check-guards-coverage.mjs --selftest
 * 退出码：任一硬失败为 1。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const GUARDS_DIR = join(ROOT, 'guards')
const META_FILE = join(GUARDS_DIR, '_meta.json')
const PKG_FILE = join(ROOT, 'package.json')

const argv = process.argv.slice(2)
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const selftestNameOf = (n) => `${n.replace(/:(?:strict|json|update)$/, '')}:selftest`
const scriptNameOf = (cmd) => {
  const m = /^npm run ([^\s]+)$/.exec(String(cmd).trim())
  return m ? m[1] : null
}

/** 域文件命名：`<NN>-<域>.txt`；返回 { domain -> 文件名 } */
export function domainFiles(dir = GUARDS_DIR) {
  const map = new Map()
  const orphans = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.txt')) continue
    const m = /^\d+-(.+)\.txt$/.exec(f)
    if (!m) { orphans.push(f); continue }
    map.set(m[1], f)
  }
  return { map, orphans }
}

export function readDomain(dir, file) {
  return readFileSync(join(dir, file), 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'))
}

export function runChecks(meta, scripts, dir = GUARDS_DIR) {
  const fail = []
  const warn = []
  const order = meta.domainOrder || []
  const { map, orphans } = domainFiles(dir)

  // ① 落盘完整
  for (const d of order) if (!map.has(d)) fail.push(`域 ${d} 在 domainOrder 里，但没有 guards/<NN>-${d}.txt`)
  for (const d of map.keys()) if (!order.includes(d)) fail.push(`guards/${map.get(d)} 存在，但域 ${d} 不在 domainOrder 里（永远不会被执行）`)
  for (const f of orphans) fail.push(`guards/${f} 不符合 <NN>-<域>.txt 命名，不会被读到`)

  // ② 互斥 + ③ 真实 + ④ 可自证
  const seen = new Map()
  let total = 0
  const perDomain = []
  for (const d of order) {
    if (!map.has(d)) continue
    const list = readDomain(dir, map.get(d))
    perDomain.push([d, list.length])
    for (const cmd of list) {
      total++
      if (seen.has(cmd)) fail.push(`重复：${cmd}\n      同时出现在 ${seen.get(cmd)} 与 ${d}`)
      else seen.set(cmd, d)
      const name = scriptNameOf(cmd)
      if (!name) { fail.push(`域 ${d}：不是 \`npm run <script>\` 形式 → ${cmd}`); continue }
      if (!scripts[name]) fail.push(`域 ${d}：package.json 里没有脚本 ${name}`)
      else if (!scripts[selftestNameOf(name)]) {
        fail.push(`域 ${d}：${name} 缺少 ${selftestNameOf(name)}（AGENTS.md：每条守卫都必须能证明自己会失败）`)
      }
    }
  }

  // ⑤ 棘轮
  if (typeof meta.minGuards === 'number' && total < meta.minGuards) {
    fail.push(`棘轮：清单只剩 ${total} 条，低于基线 ${meta.minGuards} 条 —— **守卫只许多不许少**。
      若确实是有意删除，请用 --update 明确抬高/下调基线并说明理由`)
  }

  // 附加
  for (const d of meta.crossWith || []) {
    if (!order.includes(d)) fail.push(`crossWith 引用了不存在的域 ${d}`)
    if (d === 'cross' || d === 'meta') warn.push(`crossWith 里出现 ${d}（一般不需要）`)
  }
  if (!seen.has('npm run check:guards-coverage')) {
    fail.push('meta 域没有登记 `npm run check:guards-coverage` 自己 —— 校验器不在清单里，等于没人守清单')
  }

  return { fail, warn, total, perDomain, meta }
}

// ── 运行 ────────────────────────────────────────────────────────────────

function main() {
  if (!existsSync(META_FILE)) { console.error(`✗ 缺 ${relative(ROOT, META_FILE)}`); process.exit(1) }
  const meta = readJson(META_FILE)
  const scripts = readJson(PKG_FILE).scripts || {}
  const { fail, warn, total, perDomain } = runChecks(meta, scripts)

  if (argv.includes('--update')) {
    if (fail.length) { fail.forEach((f) => console.error(`✗ ${f}`)); console.error('\n✗ 清单先修好再抬基线'); process.exit(1) }
    meta.minGuards = total
    writeFileSync(META_FILE, JSON.stringify(meta, null, 2) + '\n')
    console.log(`✓ minGuards 基线已抬到 ${total}`)
    process.exit(0)
  }

  if (argv.includes('--list')) {
    console.log(`guards/：${meta.domainOrder.length} 个域 / 共 ${total} 条 / 基线 ${meta.minGuards}\n`)
    for (const [d, n] of perDomain) console.log(`  ${d.padEnd(14)} ${String(n).padStart(3)} 条`)
    process.exit(fail.length ? 1 : 0)
  }

  warn.forEach((w) => console.warn(`⚠ ${w}`))
  fail.forEach((f) => console.error(`✗ ${f}`))
  if (fail.length) {
    console.error(`\n✗ 守卫清单完整性失败 ${fail.length} 项（共 ${total} 条 / 基线 ${meta.minGuards}）`)
    process.exit(1)
  }
  console.log(`✓ 守卫清单完整：${meta.domainOrder.length} 个域 / ${total} 条（基线 ${meta.minGuards}）`
    + `，无重复、脚本与自检齐全`
    + (perDomain.length ? `；最大域 ${perDomain.slice().sort((a, b) => b[1] - a[1])[0][0]} ${perDomain.slice().sort((a, b) => b[1] - a[1])[0][1]} 条` : ''))
}

// ── 自检：注入回归必须被检出，且按字节还原 ────────────────────────────────

function selftest() {
  const metaRaw = readFileSync(META_FILE)
  const sha = (b) => createHash('sha256').update(b).digest('hex')
  const scripts = readJson(PKG_FILE).scripts || {}
  let bad = 0
  let total = 0
  const t = (name, ok) => { total++; if (!ok) { bad++; console.error(`✗ ${name}`) } else console.log(`✓ ${name}`) }
  const quiet = (fn) => {
    const lo = console.log; const le = console.error; const lw = console.warn
    console.log = () => {}; console.error = () => {}; console.warn = () => {}
    try { return fn() } finally { console.log = lo; console.error = le; console.warn = lw }
  }
  const { map } = domainFiles()
  const targetDomain = 'pay'
  const targetFile = map.get(targetDomain)
  if (!targetFile) { console.error('✗ 自检前提：找不到 pay 域文件'); process.exit(1) }
  const targetPath = join(GUARDS_DIR, targetFile)
  const before = readFileSync(targetPath)

  // 基线
  t('基线：当前清单通过全部分硬判定', quiet(() => runChecks(readJson(META_FILE), scripts)).fail.length === 0)

  /** 改某个域文件 → 跑判定 → 还原字节 */
  const withMutatedDomain = (file, mut, metaMut) => {
    const p = join(GUARDS_DIR, file)
    const orig = readFileSync(p)
    writeFileSync(p, mut(orig.toString('utf8')))
    let m = JSON.parse(metaRaw.toString('utf8'))
    if (metaMut) m = metaMut(m) || m
    writeFileSync(META_FILE, JSON.stringify(m, null, 2) + '\n')
    const res = quiet(() => runChecks(JSON.parse(readFileSync(META_FILE, 'utf8')), scripts))
    writeFileSync(p, orig)
    writeFileSync(META_FILE, metaRaw)
    return res
  }

  const inj = [
    ['重复：把 cross 里的一条亦写进 pay 域', (s) => s + 'npm run check:write-verify:strict\n'],
    ['真实：写一个 package.json 里不存在的脚本名', (s) => s + 'npm run check:no-such-guard-xyz\n'],
    ['可自证：加一条没有 :selftest 的守卫', (s) => s + 'npm run check:fn-sync\n'],
    ['棘轮：删掉 pay 域里的一条（总数跌破基线）', (s) => s.split('\n').filter((l) => !/test:points-ledger$/.test(l.trim())).join('\n')],
  ]
  for (const [label, mut] of inj) {
    const res = withMutatedDomain(targetFile, mut)
    t(`★ 被检出：${label}`, res.fail.length > 0)
  }

  // domainOrder 里加一个没有文件的域
  {
    const res = withMutatedDomain(targetFile, (s) => s, (m) => ({ ...m, domainOrder: [...m.domainOrder, 'no-such-domain'] }))
    t('★ 被检出：domainOrder 里有一个没有域文件的域', res.fail.some((f) => /没有 guards\/<NN>-no-such-domain\.txt/.test(f)))
  }
  // 游离 txt：命名不合规 → 永远不被读到，必须点名
  {
    const orphan = join(GUARDS_DIR, 'zz-orphan.txt')
    writeFileSync(orphan, 'npm run check:fn-integrity\n')
    let detected = false
    try {
      const res = quiet(() => runChecks(readJson(META_FILE), scripts))
      detected = res.fail.some((f) => /不符合 <NN>-<域>\.txt 命名/.test(f))
    } finally {
      rmSync(orphan, { force: true })   // ⚠️ 必须真删：留一个空 txt 会反过来把基线判红
    }
    t('★ 被检出：游离的域文件（命名不合规，永远不会被读到）', detected)
    t('★ 游离文件已被删除（不残留）', !existsSync(orphan))
  }
  // meta 域把自己摘掉 → 必须检出（防"校验器不在清单里，等于没人守清单"）
  {
    const metaFile = map.get('meta')
    const res = withMutatedDomain(metaFile, (s) =>
      s.split('\n').filter((l) => l.trim() !== 'npm run check:guards-coverage').join('\n'))
    t('★ 被检出：meta 域没有登记 check:guards-coverage 自己',
      res.fail.some((f) => /meta 域没有登记/.test(f)))
  }

  t('★ 全部还原为注入前字节（域文件）', sha(readFileSync(targetPath)) === sha(before))
  t('★ 全部还原为注入前字节（_meta.json）', sha(readFileSync(META_FILE)) === sha(metaRaw))
  const after = quiet(() => runChecks(readJson(META_FILE), scripts))
  t('★ 还原后守卫恢复通过', after.fail.length === 0)

  if (bad) { console.error(`\n自检失败 ${bad} 项——守卫不可信`); process.exit(1) }
  console.log(`\n自检通过：${total} 项断言（含 ${inj.length} 个清单回归注入 + 游离文件/缺域 + 字节还原）`)
}

if (argv.includes('--selftest')) selftest()
else main()
