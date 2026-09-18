#!/usr/bin/env node
/**
 * 并发工作流 worktree 管理（2026-09-18 立）—— 治理基线 §3.4 L3 隔离层
 *
 * 为什么需要（实测事实）：本仓 391 次提交、**0 次 merge**、只有 main 一条分支。
 * 所谓"并行"其实是**多进程轮流写同一个工作目录**：我实测时最近 40 分钟内有 17 个文件被别的
 * 进程写过，而 `docs/需求5_核销积分报错_修复记录_2026-09-16.md` §9 记录过一次"并发提交把 HEAD
 * 停在半成品上"。一条流一个 worktree 是这件事唯一的物理解法。
 *
 * 本脚本只做三件事，不做别的：
 *   ① 按注册表 `docs/并发工作流注册表.json` 的流 id 建/删 worktree，分支名固定 `feat/<流id>`；
 *   ② 分支名同时是**归属守卫的动作者声明** —— 守卫从分支名推出 `--as <流id>`，
 *      于是在 `feat/wish-wall` 上改 ERP 的 `App.vue` 会被 `check:workstream-ownership` 判红；
 *   ③ 建完打印"接下来该做什么"，避免建了不用。
 *
 * 位置：默认放**仓库外的兄弟目录** `../<仓库名>-worktrees/`，理由有二 ——
 *   · 放仓内（如 `.worktrees/`）会让全仓 87 条守卫都扫到一份**重复检出**
 *     （`check:fn-integrity` 会把云函数数一遍、`check:dup-modules` 基线直接炸）；
 *   · worktree 里有你自己的一份 `.gitignore` 语义，放外面不会互相干扰。
 *   可用 `--base <dir>` 或环境变量 `WORKTREE_BASE` 覆盖（沙箱内兄弟目录被拒时用 `/tmp/...`）。
 *
 * 用法：
 *   node scripts/worktree.mjs list
 *   node scripts/worktree.mjs status
 *   node scripts/worktree.mjs add wish-wall
 *   node scripts/worktree.mjs add erp --base /tmp/wt
 *   node scripts/worktree.mjs remove wish-wall
 *   node scripts/worktree.mjs remove wish-wall --force     # 丢弃未提交改动
 * 退出码：参数错/流 id 不存在/worktree 脏（未加 --force）为 1。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
// 与 check-workstream-ownership.mjs 共用一份 glob 匹配器（不要再复制第二份）
import { hit } from './lib/glob.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const REGISTRY = join(ROOT, 'docs', '并发工作流注册表.json')

const git = (args, opts = {}) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', ...opts })
const out = (args) => {
  const r = git(args)
  return r.status === 0 ? String(r.stdout || '').trim() : ''
}

function registry() {
  if (!existsSync(REGISTRY)) {
    console.error(`✗ 找不到注册表：${REGISTRY}`)
    process.exit(1)
  }
  return JSON.parse(readFileSync(REGISTRY, 'utf8'))
}

const argv = process.argv.slice(2)
const cmd = argv[0]
const argOf = (flag, dflt = '') => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : dflt)

function baseDir() {
  const b = argOf('--base') || process.env.WORKTREE_BASE || ''
  return b ? resolve(b) : resolve(ROOT, '..', `${basename(ROOT)}-worktrees`)
}
const wtPath = (id) => join(baseDir(), id)
const branchOf = (id) => `feat/${id}`

function requireStream(id) {
  const reg = registry()
  const s = (reg.streams || []).find((x) => x.id === id)
  if (!s) {
    console.error(`✗ 流 id 不存在：${id}`)
    console.error(`  可用流：${(reg.streams || []).map((x) => x.id).join(' / ')}`)
    process.exit(1)
  }
  return s
}

function list() {
  const reg = registry()
  const raw = out(['worktree', 'list', '--porcelain'])
  const blocks = raw.split('\n\n').filter(Boolean)
  console.log(`仓库：${ROOT}`)
  console.log(`worktree 基目录：${baseDir()}\n`)
  for (const b of blocks) {
    const lines = b.split('\n')
    const p = (lines.find((l) => l.startsWith('worktree ')) || '').replace('worktree ', '')
    const br = (lines.find((l) => l.startsWith('branch ')) || '').replace('branch refs/heads/', '')
    const detached = lines.some((l) => l.startsWith('detached'))
    const m = /^feat\/(.+)$/.exec(br)
    const sid = m && (reg.streams || []).find((s) => s.id === m[1]) ? m[1] : ''
    const tag = sid ? `→ 流 ${sid}` : (br === 'main' ? '（主干）' : '（未登记的流）')
    console.log(`  ${p}`)
    console.log(`      分支 ${detached ? '(detached)' : br || '—'}  ${tag}`)
  }
}

function status() {
  const reg = registry()
  console.log(`worktree 基目录：${baseDir()}\n`)
  console.log('  流 id'.padEnd(20) + '分支'.padEnd(24) + 'worktree')
  for (const s of reg.streams || []) {
    const p = wtPath(s.id)
    const br = out(['branch', '--list', branchOf(s.id)])
    console.log(`  ${s.id.padEnd(18)}${(br || '—').padEnd(24)}${existsSync(p) ? '✓ ' + p : '—'}`)
  }
  console.log('\n未建 worktree 的流照旧在共享工作区工作（但**不要**碰别人 owns 的文件）。')
}

function add(id) {
  const s = requireStream(id)
  const p = wtPath(s.id)
  const br = branchOf(s.id)

  if (existsSync(p) && readdirSync(p).length) {
    console.error(`✗ 目录已存在且非空：${p}`)
    console.error('  若它已是本流的 worktree，直接用；否则先 remove 或换个 --base。')
    process.exit(1)
  }
  const exists = out(['branch', '--list', '--format=%(refname:short)', br])
  const args = exists ? ['worktree', 'add', p, br] : ['worktree', 'add', p, '-b', br, 'main']
  const r = git(args, { stdio: 'inherit' })
  if (r.status !== 0) {
    console.error(`\n✗ 建 worktree 失败（git exit ${r.status}）`)
    console.error('  常见原因：沙箱不允许写仓库外目录 → 换 --base /tmp/<名字>，或 WORKTREE_BASE=/tmp/<名字>')
    process.exit(1)
  }

  console.log(`
✓ ${s.name || s.id} 的 worktree 已就绪
    目录   ${p}
    分支   ${br}${exists ? '' : '（新建，基于 main）'}

下一步（顺序即依赖）：
  1. cd ${p}
  2. 在里面干活；**不要动 ${s.id} 不拥有的文件** ——
     归属守卫会从分支名认出你是「${s.id}」，改别人 owns 的文件会判红：
       node scripts/check-workstream-ownership.mjs
  3. 收工前跑本域相关守卫（全量 check:admin 留给 PR）
  4. 提交 → push → 开 PR（CI 会跑 check:admin + guards-can-fail）

注意：本流的上游改动（如别人刚改的公共件）不在这个检出里，需要时先 rebase main。`)
}

function remove(id) {
  const s = requireStream(id)
  const p = wtPath(s.id)
  if (!existsSync(p)) { console.error(`✗ 该流没有 worktree：${p}`); process.exit(1) }

  const dirty = String(git(['status', '--porcelain'], { cwd: p }).stdout || '').trim()
  if (dirty && !argv.includes('--force')) {
    console.error(`✗ worktree 有未提交改动，拒绝删除（先提交，或用 --force 丢弃）：\n${dirty}`)
    process.exit(1)
  }
  const r = git(['worktree', 'remove', p, ...(argv.includes('--force') ? ['--force'] : [])], { stdio: 'inherit' })
  if (r.status !== 0) process.exit(1)
  git(['worktree', 'prune'])
  console.log(`✓ 已移除 ${s.id} 的 worktree；分支 ${branchOf(s.id)} 保留（合并后请自行删除）`)
}

/**
 * 就绪度：**worktree 从 HEAD 建，而注册表描述的是当前工作区**。
 * 只要注册表里有 owns 指向「尚未提交」的文件，从 main 新开的 worktree 就会在
 * `真实` 校验上判红（实测：建出来的 worktree 报了 21 项）。
 * 所以切换隔离开发前，先用这条命令问「现在能不能切」。
 */
function ready() {
  const reg = registry()
  const headFiles = out(['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').filter(Boolean)
  let headScripts = {}
  try { headScripts = JSON.parse(out(['show', 'HEAD:package.json'])).scripts || {} } catch { /* ignore */ }

  const set = new Set(headFiles)
  const headHas = (g) => [...set].some((f) => hit(g, f))

  console.log(`HEAD：${out(['rev-parse', '--short', 'HEAD'])}  已提交文件 ${headFiles.length} 个\n`)
  let blocked = 0
  for (const s of reg.streams || []) {
    const deadOwns = (s.owns || []).filter((p) => !p.startsWith('!') && !headHas(p))
    const deadGuards = (s.guards || []).filter((g) => !headScripts[g])
    const n = deadOwns.length + deadGuards.length
    if (!n) { console.log(`  ✓ ${s.id.padEnd(12)} 可切换`); continue }
    blocked++
    console.log(`  ✗ ${s.id.padEnd(12)} 阻塞 ${n} 项 —— 该流还有未提交的工作`)
    deadOwns.slice(0, 4).forEach((x) => console.log(`        · owns 未提交：${x}`))
    if (deadOwns.length > 4) console.log(`        · …另有 ${deadOwns.length - 4} 项`)
    deadGuards.slice(0, 4).forEach((x) => console.log(`        · 守卫未进 package.json：${x}`))
  }

  console.log()
  if (blocked) {
    console.log(`✗ ${blocked} 条流还不能切 worktree（它们的成果尚未提交到 HEAD）。`)
    console.log('  这不影响继续用共享工作区，但**先别切** —— 切了会在新检出里看到一堆"真实失败"，')
    console.log('  那些红是"检出落后"，不是"守卫发现了问题"，会掩盖真正的信号。')
    console.log('  等这条流把当前工作提交后重跑本命令。')
    process.exit(1)
  }
  console.log('✓ 全部流可切换：现在起新工作一律 node scripts/worktree.mjs add <流id>')
}

function usage() {
  console.log(`用法：
  node scripts/worktree.mjs list
  node scripts/worktree.mjs status
  node scripts/worktree.mjs ready                 # 现在能不能切？（注册表 vs HEAD）
  node scripts/worktree.mjs add <流id> [--base <目录>]
  node scripts/worktree.mjs remove <流id> [--force]

流 id 见 docs/并发工作流注册表.json；分支名固定 feat/<流id>。
--base / WORKTREE_BASE 可覆盖 worktree 基目录（默认 ../${basename(ROOT)}-worktrees）。`)
}

if (cmd === 'list') list()
else if (cmd === 'status') status()
else if (cmd === 'ready') ready()
else if (cmd === 'add') { if (!argv[1]) { usage(); process.exit(1) } add(argv[1]) }
else if (cmd === 'remove') { if (!argv[1]) { usage(); process.exit(1) } remove(argv[1]) }
else { usage(); process.exit(cmd ? 1 : 0) }
