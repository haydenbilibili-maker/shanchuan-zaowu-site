#!/usr/bin/env node
/**
 * 并发工作流归属守卫（2026-09-18 立）
 *
 * 要解决的问题（见 `docs/并发工作流治理与契约基线_2026-09-18.md` §3.1）：
 *   本仓有七条并行工作流共用一个工作目录。它们真正互相踩的不是业务逻辑，而是**少数几个多写点**
 *   （`package.json` 近 200 次提交里被改 49 次；6 条流要改 ERP 三处；6 条流要改云函数两侧白名单…）。
 *   此前"谁能改什么"只写在散文里（`施工总纲` 的 W6 交接块："本 agent 不再改动以下文件"）——
 *   方向对，但**挡不住人**：下一个 agent 不知道，也没有任何检查在管。
 *
 * 本守卫把那份散文变成机器可读的事实源 `docs/并发工作流注册表.json`，并做五项判定：
 *   ① **互斥**：任何文件最多只能被一条流 `owns`。两个流抢同一文件 → 红。
 *      （这是 R5「祈福墙注册钩子三方撞车」的直接判据。）
 *   ② **真实**：`owns` 里的正向 glob 必须真匹配到文件；`consumes` 路径必须存在；`guards` 必须是
 *      `package.json` 里真实存在的 npm 脚本。防止注册表自己腐化成一张空头支票。
 *   ③ **冻结**：注册表 `frozen` 里的路径被改动时，若改动的不是它的 owner → 报警（`strict` 模式为红）。
 *   ④ **覆盖（棘轮）**：`app.json` 的页面必须有主；今天没主的页冻结在 `unownedPagesBaseline`，
 *      **之后新增的页若无人认领 → 红**；基线里已经有人认领的条目必须删掉（否则基线腐烂）。
 *   ⑤ **单写者完整**：`singleWriter` 的每个多写点必须指向一条真实存在的流。
 *
 * 为什么"冻结"默认只报警不失败：
 *   本仓 git 身份是**共享的**（`git config user.name` = Hadyen，所有 agent 同一个人），
 *   所以**无法从提交者推断"谁改的"** —— 归属只能靠分支名（`feat/<流id>`）或 `--as <流id>` 声明。
 *   在 worktree + 短分支纪律（决策 1）落地之前，冻结违约一律**告警**，避免守卫自己制造假失败。
 *   注册表把 `frozenMode` 设为 `strict` 即切换为硬失败；`--strict` 可临时覆盖。
 *
 * 用法：
 *   node scripts/check-workstream-ownership.mjs
 *   node scripts/check-workstream-ownership.mjs --list        # 打印未认领页（给人看，不判失败）
 *   node scripts/check-workstream-ownership.mjs --as wish-wall
 *   node scripts/check-workstream-ownership.mjs --strict
 *   node scripts/check-workstream-ownership.mjs --update      # 重算 unownedPagesBaseline
 *   node scripts/check-workstream-ownership.mjs --selftest
 * 退出码：任一硬失败为 1。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
// glob 匹配器与 scripts/worktree.mjs 共用一份（不要再复制第二份 —— 多副本必然漂移）
import { globToRegExp, hit, owns } from './lib/glob.mjs'

export { globToRegExp, owns }

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const REGISTRY = join(ROOT, 'docs', '并发工作流注册表.json')
const APP_JSON = join(ROOT, 'miniprogram', 'app.json')
const PKG = join(ROOT, 'package.json')

/** 不在扫描范围的目录：构建产物 / 依赖 / 归档，扫描它们只会变慢且引入假阳性 */
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', '.astro', '.wrangler', 'backups',
  '.dsh', '.audit-tmp', 'coverage', '.idea', '.vscode',
])

// ── 工具 ────────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.isFile()) out.push(relative(ROOT, p))
  }
  return out
}

/** glob 匹配器见 `scripts/lib/glob.mjs`（与 worktree.mjs 共用一份，不再本地复制） */

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

function appPages() {
  const a = readJson(APP_JSON)
  const main = (a.pages || []).slice()
  for (const s of a.subpackages || a.subPackages || []) {
    for (const p of s.pages || []) main.push(`${s.root}/${p}`)
  }
  return main
}

/** 当前改动的文件（工作区 + 暂存区），用于冻结判定 */
function changedFiles() {
  const r = spawnSync('git', ['diff', '--name-only', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
  if (r.status !== 0) return []
  return String(r.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean)
}

/** 分支相对 main 的改动（三点 diff）+ 工作区未提交改动，取并集；用于分支范围判定 */
function branchChangedFiles(base = 'main') {
  const out = new Set()
  for (const args of [
    ['diff', '--name-only', `${base}...HEAD`],
    ['diff', '--name-only', 'HEAD'],
    ['diff', '--name-only', '--cached'],
  ]) {
    const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
    if (r.status !== 0) continue
    for (const s of String(r.stdout || '').split('\n')) {
      const v = s.trim()
      if (v) out.add(v)
    }
  }
  return [...out]
}

function currentBranch() {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
  return r.status === 0 ? String(r.stdout).trim() : ''
}

/** 收集可重复的 --allow <glob> */
function collectAllow(argv) {
  const out = []
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--allow' && argv[i + 1]) out.push(argv[i + 1])
  return out
}

// ── 判定 ────────────────────────────────────────────────────────────────

export function runChecks(reg, files, opts = {}) {
  const fail = []
  const warn = []
  const streams = reg.streams || []
  const byId = new Map(streams.map((s) => [s.id, s]))

  // ① 互斥：任意文件最多一条流拥有
  const effective = new Map()
  for (const s of streams) {
    const set = new Set(files.filter((f) => owns(s.owns || [], f)))
    effective.set(s.id, set)
  }
  for (let i = 0; i < streams.length; i++) {
    for (let j = i + 1; j < streams.length; j++) {
      const a = effective.get(streams[i].id)
      const b = effective.get(streams[j].id)
      const both = [...a].filter((f) => b.has(f))
      if (both.length) {
        fail.push(`互斥冲突：${streams[i].id} 与 ${streams[j].id} 都拥有 ${both.length} 个文件，例如：\n      `
          + both.slice(0, 5).join('\n      '))
      }
    }
  }

  // ② 真实：正向 glob 必须命中；consumes 路径必须存在；guards 必须是真脚本
  let pkgScripts = {}
  try { pkgScripts = readJson(PKG).scripts || {} } catch { /* ignore */ }
  for (const s of streams) {
    for (const g of (s.owns || []).filter((p) => !p.startsWith('!'))) {
      if (!files.some((f) => hit(g, f))) fail.push(`真实失败：流 ${s.id} 的 owns 项匹配不到任何文件 → ${g}`)
    }
    for (const p of (s.consumes || []).filter((p) => !p.includes('*'))) {
      if (!existsSync(join(ROOT, p))) fail.push(`真实失败：流 ${s.id} 的 consumes 项不存在 → ${p}`)
    }
    for (const g of s.guards || []) {
      if (!pkgScripts[g]) fail.push(`真实失败：流 ${s.id} 声明的守卫在 package.json 里不存在 → ${g}`)
    }
  }

  // ③ 冻结
  const mode = opts.strict ? 'strict' : (reg.frozenMode || 'warn')
  const actor = opts.as || (currentBranch().startsWith('feat/') ? currentBranch().slice(5) : '')
  const changed = opts.changed || []
  const frozenHits = []
  for (const f of changed) {
    const owner = streams.find((s) => (s.owns || []).length && owns(s.owns, f))
    const isFrozen = (reg.frozen || []).some((g) => hit(g, f))
    if (isFrozen && owner && owner.id !== actor) {
      frozenHits.push(`${f}（owner=${owner.id}，当前动作者=${actor || '未声明'}）`)
    }
  }
  if (frozenHits.length) {
    const msg = `冻结违约 ${frozenHits.length} 处：\n      ` + frozenHits.slice(0, 8).join('\n      ')
    if (mode === 'strict') fail.push(msg)
    else warn.push(`${msg}\n      （frozenMode=${mode}：仅告警。owner 本人改请加 --as <流id>）`)
  }

  // ④ 覆盖棘轮：app.json 页面必须有主
  const pages = opts.pages || []
  const pageFiles = pages.map((p) => `miniprogram/${p}.js`)
  const unowned = pages.filter((p) => {
    const jf = `miniprogram/${p}.js`
    return !streams.some((s) => owns(s.owns || [], jf))
  })
  const baseline = new Set(reg.unownedPagesBaseline || [])
  const fresh = unowned.filter((p) => !baseline.has(p))
  if (fresh.length) {
    fail.push(`覆盖棘轮：${fresh.length} 个页面无人认领，且不在基线里 →\n      `
      + fresh.slice(0, 10).join('\n      ')
      + `\n      （给它指定一条流的 owns，或跑 --update 收编进基线；但收编前请先确认真没人管）`)
  }
  const stale = [...baseline].filter((p) => !unowned.includes(p))
  if (stale.length) {
    fail.push(`覆盖棘轮：基线里 ${stale.length} 个页面已经有人认领了，应删掉 →\n      `
      + stale.slice(0, 10).join('\n      ')
      + `\n      （跑 --update 自动重算；基线只许变短，不许腐烂）`)
  }

  // ⑤ 单写者完整
  for (const [hot, owner] of Object.entries(reg.singleWriter || {})) {
    if (!byId.has(owner)) fail.push(`单写者失败：多写点 ${hot} 指向不存在的流 → ${owner}`)
  }

  // ⑥ 分支范围（L3 隔离层的牙齿）：
  //    在 feat/<流id> 分支上，**不许改动别的流已声明的文件**。
  //    判据刻意窄：只判「别人 owns 的文件」，不判"无人认领的文件"——
  //    目标是防并发互踩，不是把分支变成范围牢笼。
  //    在 main / 分离 HEAD 上**不判**（main 是集成分支），所以本判断启用当天不会误伤任何人。
  const br = opts.branch || ''
  const feat = /^feat\/(.+)$/.exec(br)
  if (feat) {
    const id = feat[1]
    const stream = byId.get(id)
    if (!stream) {
      fail.push(`分支范围：分支 feat/${id} 的「${id}」不在注册表里（流 id 见 docs/并发工作流注册表.json）`)
    } else {
      const allow = (opts.allow || []).map((g) => (g.startsWith('!') ? g.slice(1) : g))
      const mine = new Set(files.filter((f) => owns(stream.owns || [], f)))
      const intruders = []
      for (const f of opts.branchChanged || []) {
        if (mine.has(f)) continue
        if (allow.some((g) => hit(g, f))) continue
        const owner = streams.find((s) => s.id !== id && owns(s.owns || [], f))
        if (owner) intruders.push(`${f}（属 ${owner.id}）`)
      }
      if (intruders.length) {
        fail.push(`分支范围：feat/${id} 改动了**别的流已声明**的 ${intruders.length} 个文件 →\n      `
          + intruders.slice(0, 8).join('\n      ')
          + `\n      （向该流的 owner 提交变更请求，或把该文件正式划给本流；确需一次性放行用 --allow <glob>）`)
      }
    }
  }

  return { fail, warn, effective, unowned, pages: pageFiles, branch: br }
}

// ── 运行 ────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2)
  const as = argv.includes('--as') ? argv[argv.indexOf('--as') + 1] : ''
  const strict = argv.includes('--strict')
  const list = argv.includes('--list')

  if (!existsSync(REGISTRY)) {
    console.error(`✗ 找不到注册表：${relative(ROOT, REGISTRY)}`)
    process.exit(1)
  }
  const reg = readJson(REGISTRY)
  const files = walk(ROOT)
  const pages = appPages()
  const changed = changedFiles()
  const branch = currentBranch()
  const branchChanged = /^feat\//.test(branch) ? branchChangedFiles() : []

  const { fail, warn, effective, unowned } = runChecks(reg, files, {
    as, strict, changed, pages, branch, branchChanged, allow: collectAllow(argv),
  })

  if (list) {
    console.log(`扫描 ${files.length} 个文件 / ${pages.length} 个页面 / ${(reg.streams || []).length} 条流\n`)
    for (const s of reg.streams || []) {
      console.log(`${s.id.padEnd(14)} owns ${String(effective.get(s.id).size).padStart(4)} 个文件   ${s.name || ''}`)
    }
    console.log(`\n未认领页面 ${unowned.length} 个（已冻结在基线）：`)
    unowned.forEach((p) => console.log('  ' + p))
    process.exit(0)
  }

  if (argv.includes('--update')) {
    const next = Object.assign({}, reg, { unownedPagesBaseline: unowned.slice().sort() })
    writeFileSync(REGISTRY, JSON.stringify(next, null, 2) + '\n')
    console.log(`✓ 已重算 unownedPagesBaseline：${unowned.length} 个页面`)
    process.exit(0)
  }

  for (const w of warn) console.warn(`⚠ ${w}`)
  for (const f of fail) console.error(`✗ ${f}`)

  const total = (reg.streams || []).reduce((n, s) => n + effective.get(s.id).size, 0)
  const scope = /^feat\//.test(branch)
    ? `分支范围已校验（${branch}，比对 ${branchChanged.length} 个改动文件）`
    : `分支范围未启用（当前 ${branch || 'detached'} —— 在 feat/<流id> 分支上才判）`
  if (fail.length) {
    console.error(`\n归属守卫失败 ${fail.length} 项（认领 ${total} 个文件 / ${pages.length} 个页面；${scope}）`)
    process.exit(1)
  }
  console.log(`✓ 归属守卫通过：${(reg.streams || []).length} 条流、认领 ${total} 个文件、`
    + `${unowned.length} 个页面冻结在基线、冻结违约 ${warn.length} 处告警；${scope}`)
}

// ── 自检：注入回归必须被检出，且按字节还原 ────────────────────────────────

function selftest() {
  const before = readFileSync(REGISTRY)
  const sha = (b) => createHash('sha256').update(b).digest('hex')
  const files = walk(ROOT)
  const pages = appPages()
  let bad = 0
  let total = 0
  const t = (name, ok) => { total++; if (!ok) { bad++; console.error(`✗ ${name}`) } else console.log(`✓ ${name}`) }
  const quiet = (fn) => {
    const lo = console.log; const le = console.error; const lw = console.warn
    console.log = () => {}; console.error = () => {}; console.warn = () => {}
    try { return fn() } finally { console.log = lo; console.error = le; console.warn = lw }
  }
  const withReg = (mut) => {
    const reg = JSON.parse(before.toString('utf8'))
    mut(reg)
    writeFileSync(REGISTRY, JSON.stringify(reg, null, 2) + '\n')
    const res = quiet(() => runChecks(JSON.parse(readFileSync(REGISTRY, 'utf8')), files, { pages }))
    writeFileSync(REGISTRY, before)
    return res
  }

  // 基线：**必须把「检出落后」与「真缺陷」分开**
  // 注册表的 owns 可能引用尚未落到**本分支**的文件（例：某流的改动还在它自己的 PR 里）——
  // 那时 `真实` 判定会报"匹配不到任何文件"，那是**检出落后**，而**不是**守卫坏了。
  // 这不是放宽断言（错题本 E7）：只有当**全部**失败都是「真实失败」时才容忍，且必须打印告警；
  // 只要出现任何**别的**失败（互斥/冻结/覆盖/单写者/分支范围），一律照旧判失败。
  const onlyBehind = (res) => res.fail.length > 0 && res.fail.every((f) => /^真实失败/.test(f))
  const describe = (res) => (onlyBehind(res)
    ? `（${res.fail.length} 项全是「真实失败」= 检出落后，非守卫缺陷）`
    : (res.fail.length ? `（${res.fail.length} 项：${res.fail[0].slice(0, 80)}）` : ''))
  const base = quiet(() => runChecks(JSON.parse(before.toString('utf8')), files, { pages }))
  t('基线：注册表通过硬判定（「检出落后」除外）' + describe(base),
    base.fail.length === 0 || onlyBehind(base))
  if (onlyBehind(base)) {
    console.warn(`  ⚠ 本检出缺注册表引用的 ${base.fail.length} 个文件 → 检出落后（它们已在别的分支提交）。
     合入后此告警消失。**这不是守卫缺陷，但也不要把它当成通过。**`)
  }

  const injections = [
    ['互斥：把视觉流的 AppModal 又划给祈福墙', (r) => {
      r.streams.find((s) => s.id === 'wish-wall').owns.push('miniprogram/components/AppModal/**')
    }],
    ['真实：owns 写一个不存在的 glob', (r) => {
      r.streams.find((s) => s.id === 'wish-wall').owns.push('miniprogram/subpackages/feature/does-not-exist/**')
    }],
    ['真实：guards 声明一个不存在的 npm 脚本', (r) => {
      r.streams.find((s) => s.id === 'visual').guards.push('check:no-such-guard')
    }],
    ['真实：consumes 指向不存在的文件', (r) => {
      r.streams.find((s) => s.id === 'order').consumes.push('miniprogram/utils/no-such-util.js')
    }],
    ['覆盖棘轮：新增一个无人认领的页', (r) => {
      r.unownedPagesBaseline = (r.unownedPagesBaseline || []).filter((p) => p !== 'pages/index/index')
    }],
    ['覆盖棘轮：基线把已认领的页面写进去（基线腐烂）', (r) => {
      r.unownedPagesBaseline = [...(r.unownedPagesBaseline || []), 'subpackages/feature/wish-wall/index']
    }],
    ['单写者：多写点指向不存在的流', (r) => {
      r.singleWriter = Object.assign({}, r.singleWriter, { 'package.json': 'no-such-stream' })
    }],
  ]

  for (const [label, mut] of injections) {
    const res = withReg(mut)
    t(`★ 被检出：${label}`, res.fail.length > 0)
  }

  // 冻结：构造一处"非 owner 改了 frozen 路径"，strict 下必须红
  {
    const res = quiet(() => runChecks(
      JSON.parse(readFileSync(REGISTRY, 'utf8')), files,
      { pages, strict: true, as: 'visual', changed: ['miniprogram/subpackages/feature/wish-wall/index.js'] },
    ))
    t('★ 被检出：非 owner 改了冻结路径（strict）', res.fail.some((f) => /冻结违约/.test(f)))
    // 反例：owner 自己改，不该红
    const ok = quiet(() => runChecks(
      JSON.parse(readFileSync(REGISTRY, 'utf8')), files,
      { pages, strict: true, as: 'wish-wall', changed: ['miniprogram/subpackages/feature/wish-wall/index.js'] },
    ))
    t('★ 反例：owner 自己改冻结路径不报（例外是窄的）', !ok.fail.some((f) => /冻结违约/.test(f)))
  }

  // 分支范围：L3 隔离层的牙齿。在 feat/<流id> 上不许动别人已声明的文件。
  {
    const R = () => JSON.parse(readFileSync(REGISTRY, 'utf8'))
    const audit = (opts) => quiet(() => runChecks(R(), files, { pages, ...opts }))

    const hit1 = audit({ branch: 'feat/wish-wall', branchChanged: ['admin/src/App.vue'] })
    t('★ 被检出：feat/wish-wall 改了 ERP 的 App.vue', hit1.fail.some((f) => /分支范围/.test(f)))

    const hit2 = audit({
      branch: 'feat/pay',
      branchChanged: ['miniprogram/utils/analytics/eventSchema.js'],
    })
    t('★ 被检出：feat/pay 改了集成官的埋点契约（C4）', hit2.fail.some((f) => /分支范围/.test(f)))

    const hit3 = audit({ branch: 'feat/no-such-stream', branchChanged: [] })
    t('★ 被检出：feat/<流id> 的 id 不在注册表里', hit3.fail.some((f) => /不在注册表里/.test(f)))

    const ok1 = audit({ branch: 'feat/wish-wall', branchChanged: ['miniprogram/utils/wishWall.js'] })
    t('★ 反例：本流改自己的文件不报', !ok1.fail.some((f) => /分支范围/.test(f)))

    const ok2 = audit({ branch: 'feat/erp', branchChanged: ['admin/src/App.vue'] })
    t('★ 反例：ERP 改自己的 App.vue 不报（判据随 owner 变，不是写死某文件）', !ok2.fail.some((f) => /分支范围/.test(f)))

    const ok3 = audit({
      branch: 'feat/wish-wall',
      branchChanged: ['admin/src/App.vue'],
      allow: ['admin/src/App.vue'],
    })
    t('★ 反例：--allow 一次性放行生效（逃生门存在且是显式的）', !ok3.fail.some((f) => /分支范围/.test(f)))

    const ok4 = audit({ branch: 'main', branchChanged: ['admin/src/App.vue'] })
    t('★ 反例：main（集成分支）上不判分支范围（不误伤今天的工作流）', !ok4.fail.some((f) => /分支范围/.test(f)))
  }

  t('★ 全部还原为注入前字节', sha(readFileSync(REGISTRY)) === sha(before))
  const after = quiet(() => runChecks(JSON.parse(readFileSync(REGISTRY, 'utf8')), files, { pages }))
  t('★ 还原后守卫恢复通过（「检出落后」除外）', after.fail.length === 0 || onlyBehind(after))

  if (bad) { console.error(`\n自检失败 ${bad} 项——守卫不可信`); process.exit(1) }
  console.log(`\n自检通过：${total} 项断言（含 ${injections.length} 个注册表回归注入 + 冻结/分支范围的检出与反例），且还原字节一致`)
}

if (process.argv.includes('--selftest')) selftest()
else main()
