#!/usr/bin/env node
/**
 * 文档索引守卫（`check:docs-index`）
 *
 * 背景（交接页 `docs/交接_云端接手_2026-09-18.md` §12-⑤）：
 *   `docs/README.md` 写着「新增任何 `docs/**` 文档后，必须在本文件加一行」，
 *   但 `guards/` 里**没有任何守卫**在守它。2026-09-19 云端为这件事连修两次
 *   （`5c654f9` 登记 3 份、`872eb6d` 补登 2 份 —— 后者是**既存漂移**）。
 *   纯人工约定会持续漂移，且漂移时**没有任何信号** → 补这条守卫。
 *
 * 判据（按**文件名**比对，不解析 markdown 表格结构 —— 越简单越不易假绿）：
 *   ① 候选集 = `docs/` 下全部 .md（递归），排除索引自身 `docs/README.md` 与各子目录的 `README.md`；
 *   ② 「自有索引目录」（`dirExempt`）下的 md 由**该目录自己的 README** 登记 —— 守卫会
 *      **逐个核实**那份 README 真的提到了它：豁免不是「闭眼放过」，而是「把核对下移一层」；
 *      子索引漏登 → ✗（这正是本仓最怕的「自有索引目录 = 假绿池」）；
 *   ③ 其余候选必须出现在 `docs/README.md` 正文里（basename 子串匹配）；
 *   ④ **棘轮**：未登记集合只许缩不许长 ——
 *      · 出现基线里没有的未登记文件（**哪怕总数没涨**，即"补一个老的、漏一个新的"）→ ✗
 *      · 基线条目已补登记（未登记数下降）→ ✓ + 提示 `--update` 拧紧；
 *   ⑤ 豁免清单每条必须带**非空理由**；失效豁免（指向不存在的文件/目录）→ ✗。
 *
 * ⚠️ **不放宽判据来变绿**：降基线只能靠补登记后的 `--update`，
 *    不能靠往豁免清单里塞一条（塞进去要写理由，且 `dirExempt` 会被判据②逐个核实）。
 *
 * 用法：
 *   node scripts/check-docs-index.mjs              # 校验
 *   node scripts/check-docs-index.mjs --report     # 只报告（未登记全量清单 + 自有索引目录核对结果）
 *   node scripts/check-docs-index.mjs --update     # 补登记后拧紧棘轮（重设基线）
 *   node scripts/check-docs-index.mjs --selftest   # 注入一个未登记 md → 必须检出 → 逐字节还原
 *
 * 退出码：0 通过 / 1 失败。
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const SELF = fileURLToPath(import.meta.url)
const HERE = dirname(SELF)
const ROOT = resolve(HERE, '..')
const DOCS = join(ROOT, 'docs')
const INDEX_REL = 'docs/README.md'
const INDEX = join(ROOT, INDEX_REL)
const CONFIG_REL = 'docs/.docs-index-exempt.json'
const CONFIG = join(ROOT, CONFIG_REL)
const PROBE_REL = 'docs/__selftest_docs_index_probe__.md'
const PROBE = join(ROOT, PROBE_REL)

const argv = process.argv.slice(2)

const toRel = (abs) => relative(ROOT, abs).split(sep).join('/')
const baseName = (rel) => rel.slice(rel.lastIndexOf('/') + 1)
const normPath = (p) => String(p == null ? '' : p).replace(/\\/g, '/')
const normDir = (d) => normPath(d).replace(/\/+$/, '')

/** 递归收集 docs/ 下全部 .md（含未跟踪的新文件 —— 守卫要在提交前就能拦住） */
function walkMarkdown(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) walkMarkdown(abs, out)
    else if (name.endsWith('.md')) out.push(toRel(abs))
  }
  return out
}

/**
 * 核心判定。返回结构化结果，便于 `--selftest` 直接断言（不依赖文件系统之外的猜测）。
 * @param {{dirExempt?: Array<{dir:string,reason:string}>, fileExempt?: Array<{path:string,reason:string}>, baseline?: string[]}} cfg
 */
export function analyze(cfg) {
  const all = walkMarkdown(DOCS).sort()
  const indexText = existsSync(INDEX) ? readFileSync(INDEX, 'utf8') : null
  const dirRules = (cfg.dirExempt || []).map((e) => ({ dir: normDir(e.dir), reason: e.reason }))
  const fileRules = new Set((cfg.fileExempt || []).map((e) => normPath(e.path)))

  const subIndexFiles = []
  const candidates = []
  // ⚠️ 这两个必须在**扫描之前**声明（const 有 TDZ；第一版放在下面，扫描先跑 → 整个守卫抛异常）
  const missingDocs = []

  if (indexText) {
    const seen = new Set()
    // ⚠️ README 里的引用**多数是裸文件名**（索引表本身就在 docs/ 下，所以写的是 `xxx.md`），
    //    只有少数带 `docs/` 前缀 —— 第一版只匹配带前缀的，结果一条都没扫到（白名单形同虚设）。
    for (const m of indexText.matchAll(/`([^`\s]+\.md)`/g)) {
      const raw = m[1]
      // 只认"文档目录内"的引用：裸文件名，或显式 docs/ 前缀；其它路径（admin/docs、miniprogram/…）跳过
      if (raw.includes('/') && !raw.startsWith('docs/')) continue
      const rel = normPath(raw.startsWith('docs/') ? raw : 'docs/' + raw)
      if (seen.has(rel)) continue
      seen.add(rel)
      const base = rel.replace(/^docs\//, '')
      // ⚠️ 裸文件名有两种真实落点：`docs/x.md`（索引表里的绝大多数）**和仓库根**（如 `AGENTS.md`）。
      //    第一版只查 docs/ 下 → 把 `AGENTS.md` 误报成"不存在"（判据自身的错，不是文档的错）。
      if (!existsSync(join(DOCS, base)) && !existsSync(join(ROOT, base))) missingDocs.push(rel)
    }
  }

  for (const rel of all) {
    if (rel === INDEX_REL) continue
    if (rel.endsWith('/README.md')) { subIndexFiles.push(rel); continue }
    candidates.push(rel)
  }

  const registered = []
  const selfIndexed = []
  const exempted = []
  const unregistered = []
  const violations = []
  /* ── **反向**：README 里写了的文档必须真的存在 ──────────────────────────────
   * 2026-09-21 夜班发现：`docs/README.md` 用整整一段（含阅读入口）描述了 6 份
   * `内容体系_*.md`，而这 6 份**从未提交**（`git log --all --diff-filter=A` 查无）——
   * 索引在描述不存在的东西。原判据只查「文档 → README」这一个方向，所以完全看不见。
   * ⚠️ 这 6 份的**内容可能还在云端会话的工作副本里**（那次会话"改了 README 忘了 git add"），
   *    所以**先钉住、不删行**：等确认取不回来再清 README。基线只许降不许涨。 */
  const dirStats = new Map()

  for (const rel of candidates) {
    const rule = dirRules.find((r) => r.dir && rel.startsWith(r.dir + '/'))
    if (rule) {
      const idxRel = `${rule.dir}/README.md`
      const idxAbs = join(ROOT, idxRel)
      const st = dirStats.get(rule.dir) || { dir: rule.dir, hasIndex: existsSync(idxAbs), total: 0, covered: 0 }
      st.total++
      if (!st.hasIndex) {
        violations.push(`${rel}：自有索引目录 \`${rule.dir}\` 下**没有 README.md**，豁免不成立（请补该目录索引，或从 dirExempt 移除）`)
      } else if (!readFileSync(idxAbs, 'utf8').includes(baseName(rel))) {
        violations.push(`${rel}：自有索引目录 \`${idxRel}\` **未登记它**（豁免 = 把核对下移一层，不是闭眼放过）`)
      } else {
        st.covered++
        selfIndexed.push(rel)
      }
      dirStats.set(rule.dir, st)
      continue
    }
    if (indexText && indexText.includes(baseName(rel))) { registered.push(rel); continue }
    if (fileRules.has(rel)) { exempted.push(rel); continue }
    unregistered.push(rel)
  }

  return { all, candidates, subIndexFiles, registered, selfIndexed, exempted, unregistered,
    missingDocs, violations, dirStats }
}

/** 配置自身的合法性问题（理由缺失、失效豁免、重复项、baseline 形态） */
export function validateConfig(cfg) {
  const errs = []
  const dirs = cfg.dirExempt || []
  const files = cfg.fileExempt || []
  if (!Array.isArray(dirs)) errs.push('dirExempt 必须是数组')
  if (!Array.isArray(files)) errs.push('fileExempt 必须是数组')
  if (!Array.isArray(cfg.baseline)) errs.push('baseline 必须是字符串数组（用 --update 生成）')

  const seenDir = new Set()
  for (const [i, e] of (Array.isArray(dirs) ? dirs : []).entries()) {
    const d = normDir(e && e.dir)
    if (!d || !d.startsWith('docs/')) errs.push(`dirExempt[${i}]：dir 必须是 \`docs/\` 下的相对路径（得到 ${JSON.stringify(e && e.dir)}）`)
    if (!e || !String(e.reason || '').trim()) errs.push(`dirExempt[${i}]（${d}）：**必须带一行理由**（reason 非空）`)
    if (seenDir.has(d)) errs.push(`dirExempt 重复：${d}`)
    seenDir.add(d)
    if (d && !existsSync(join(ROOT, d, 'README.md'))) errs.push(`dirExempt ${d}：该目录没有 README.md，豁免不成立`)
  }

  const seenFile = new Set()
  for (const [i, e] of (Array.isArray(files) ? files : []).entries()) {
    const p = normPath(e && e.path)
    if (!e || !String(e.reason || '').trim()) errs.push(`fileExempt[${i}]（${p}）：**必须带一行理由**（reason 非空）`)
    if (seenFile.has(p)) errs.push(`fileExempt 重复：${p}`)
    seenFile.add(p)
    if (!p || !existsSync(join(ROOT, p))) errs.push(`fileExempt ${p}：文件不存在（失效豁免请删除）`)
  }
  return errs
}

/** 集合棘轮：新增（基线外）必须失败；减少只提示拧紧 */
export function judge(current, baseline) {
  const base = new Set(baseline)
  const cur = new Set(current)
  return {
    newDrift: current.filter((f) => !base.has(f)),
    improved: baseline.filter((f) => !cur.has(f)),
    countGrew: current.length > baseline.length,
  }
}

function loadConfig() {
  if (!existsSync(CONFIG)) return { cfg: null, err: `找不到豁免清单/基线文件 ${CONFIG_REL}` }
  try {
    return { cfg: JSON.parse(readFileSync(CONFIG, 'utf8')), err: null }
  } catch (e) {
    return { cfg: null, err: `${CONFIG_REL} 不是合法 JSON：${e.message}` }
  }
}

function reportSummary(res, baseline) {
  const covered = res.selfIndexed.length
  let s = `docs/**/*.md ${res.all.length} 份\n`
  s += `   · 索引自身 + 子目录 README：${1 + res.subIndexFiles.length} 份（不计入登记要求）\n`
  s += `   · 自有索引目录覆盖：${covered} 份 / ${res.dirStats.size} 个目录（已逐个核实其目录 README 确实登记）\n`
  s += `   · 应登记：${res.candidates.length - covered} 份 → 已登记 ${res.registered.length} + 豁免 ${res.exempted.length} / 未登记 ${res.unregistered.length}（基线 ${baseline.length}）`
  return s
}

function main() {
  if (!existsSync(INDEX)) {
    console.log(`✗ 文档索引守卫：找不到索引文件 ${INDEX_REL}`)
    return 1
  }
  const { cfg, err } = loadConfig()
  if (!cfg) {
    console.log(`✗ 文档索引守卫：${err}`)
    return 1
  }

  const cfgErrs = validateConfig(cfg)
  const res = analyze(cfg)
  /* 反向判据：README 引用但仓库里不存在的文档 → 违规（白名单内的只提示、不红）。
   * 基线只许降：白名单外新增一条就红。 */
  {
    const known = new Set((cfg.indexKnownMissing || []).map(normPath))
    const fresh = (res.missingDocs || []).filter((d) => !known.has(d))
    if (fresh.length) {
      res.violations.push(`README 引用了**仓库里不存在**的文档（${fresh.length} 条）：${fresh.join('、')}`
        + ' —— 要么补提交这些文件，要么删掉 README 里那几行')
    }
    res.indexKnownMissingFresh = fresh
    res.indexKnownMissingStale = [...known].filter((d) => !(res.missingDocs || []).includes(d))
  }
  const baseline = Array.isArray(cfg.baseline) ? cfg.baseline.map(normPath) : []
  const { newDrift, improved } = judge(res.unregistered, baseline)

  if (argv.includes('--update')) {
    const blockers = [...cfgErrs, ...res.violations]
    if (blockers.length) {
      console.log('✗ 棘轮基线未更新 —— 先修好下列问题：')
      for (const b of blockers) console.log(`   - ${b}`)
      return 1
    }
    const next = { ...cfg, baseline: [...res.unregistered].sort() }
    writeFileSync(CONFIG, JSON.stringify(next, null, 2) + '\n', 'utf8')
    console.log(`✓ 文档索引棘轮基线已更新：未登记 ${res.unregistered.length} 条 → ${CONFIG_REL}`)
    return 0
  }

  if (argv.includes('--report')) {
    console.log('docs 索引现状（--report 只报告，不改动）：')
    console.log(reportSummary(res, baseline))
    if (cfgErrs.length) {
      console.log('\n⚠ 豁免清单/基线本身不合法（--report 也照实报）：')
      for (const e of cfgErrs) console.log(`   ✗ ${e}`)
    }
    for (const st of res.dirStats.values()) {
      console.log(`   自有索引目录 ${st.dir}：${st.covered}/${st.total} 由自身 README 覆盖${st.hasIndex ? '' : '（⚠ 无 README.md）'}`)
    }
    console.log(`\n未登记 ${res.unregistered.length} 条：`)
    for (const f of res.unregistered) console.log(`   - ${f}`)
    if (res.exempted.length) {
      console.log(`\n已豁免（已知漂移，各带理由）：${res.exempted.length} 条`)
      for (const f of res.exempted) console.log(`   - ${f}（见 ${CONFIG_REL}）`)
    }
    if (res.violations.length) {
      console.log('\n违规（自有索引目录未覆盖）：')
      for (const v of res.violations) console.log(`   ✗ ${v}`)
    }
    console.log('')
    return cfgErrs.length ? 1 : 0
  }

  const hardFail = cfgErrs.length + res.violations.length + newDrift.length

  if (hardFail) {
    console.log(`✗ 文档索引守卫：未登记 ${res.unregistered.length} 份 / 基线 ${baseline.length} 份（新增 ${newDrift.length}）`)
    if (cfgErrs.length) {
      console.log('  豁免清单/基线本身不合法：')
      for (const e of cfgErrs) console.log(`   ✗ ${e}`)
    }
    if (res.violations.length) {
      console.log('  自有索引目录未覆盖其下的文件（豁免不成立）：')
      for (const v of res.violations.slice(0, 10)) console.log(`   ✗ ${v}`)
    }
    if (newDrift.length) {
      console.log('  新增未登记（基线外的文件；登记一行，或走带理由的豁免）：')
      for (const f of newDrift.slice(0, 10)) console.log(`   - ${f}`)
      if (newDrift.length > 10) console.log(`   … 另有 ${newDrift.length - 10} 条`)
      console.log(`  说明：新增 docs/** 文档后请在 ${INDEX_REL} 加一行；`)
      console.log(`       确属不该登记的，在 ${CONFIG_REL} 加一条**带 reason** 的豁免。`)
    }
    return 1
  }

  console.log(`✓ 文档索引守卫：${reportSummary(res, baseline)}`)
  if (improved.length) {
    console.log(`  ↓ 已有 ${improved.length} 条离开未登记集合（补登记 / 转豁免；请跑 --update 拧紧棘轮）：`)
    for (const f of improved.slice(0, 3)) console.log(`     ${f}`)
    if (improved.length > 3) console.log(`     … 另有 ${improved.length - 3} 条`)
  }
  if (res.unregistered.length) {
    console.log(`  已知漂移前 3 条（未登记但已在基线内，只许降不许涨）：`)
    for (const f of res.unregistered.slice(0, 3)) console.log(`     ${f}`)
  }
  if (res.exempted.length) console.log(`  显式豁免（各带理由）：${res.exempted.length} 条`)
  return 0
}

// ── 自检：注入一个未登记的 docs md → 必须检出 → 逐字节还原 ──────────────────

function snapshotDocs() {
  const map = new Map()
  for (const rel of walkMarkdown(DOCS)) {
    map.set(rel, createHash('sha256').update(readFileSync(join(ROOT, rel))).digest('hex'))
  }
  return map
}

function selftest() {
  console.log('docs-index 自检：注入「新增一个未登记的 docs md」→ 必须检出 → 逐字节还原\n')
  const runGuard = () => spawnSync(process.execPath, [SELF], { encoding: 'utf8', cwd: ROOT })
  let bad = 0
  const t = (label, ok, detail) => {
    console.log(`${ok ? '✓' : '✗'} ${label}`)
    if (!ok) { bad++; if (detail) console.log(`    ${String(detail).split('\n').join('\n    ')}`) }
  }

  if (existsSync(PROBE)) rmSync(PROBE, { force: true })
  const before = snapshotDocs()
  const configBefore = existsSync(CONFIG) ? readFileSync(CONFIG) : null

  // ① 基线必须绿 —— 否则「被检出」可能只是"恒红"，不算证明
  const clean = runGuard()
  t('基线：当前 docs/ 通过检查（退出码 0）', clean.status === 0, `退出码 ${clean.status}\n${(clean.stdout || '') + (clean.stderr || '')}`)

  // ② 判据单位测试：集合棘轮 —— 补一个老的、漏一个新的（总数不变）也必须红
  const syn = judge(['docs/a.md', 'docs/b.md'], ['docs/a.md', 'docs/c.md'])
  t('★ 判据：未登记集合出现基线外的新成员即失败（哪怕总数没涨）',
    syn.newDrift.length === 1 && syn.newDrift[0] === 'docs/b.md' && !syn.countGrew, JSON.stringify(syn))

  // ③ 注入
  writeFileSync(PROBE, '# 文档索引自检探针\n\n本条由 `--selftest` 临时注入，用于证明守卫会失败。\n', 'utf8')
  const injected = runGuard()
  const out = `${injected.stdout || ''}${injected.stderr || ''}`
  t('★ 被检出：新增一个未登记的 docs md',
    injected.status !== 0 && out.includes('__selftest_docs_index_probe__.md'),
    `退出码 ${injected.status}\n${out}`)

  // ④ 还原
  if (existsSync(PROBE)) rmSync(PROBE, { force: true })
  const after = snapshotDocs()
  const changed = []
  for (const [rel, hash] of before) if (after.get(rel) !== hash) changed.push(rel)
  for (const rel of after.keys()) if (!before.has(rel)) changed.push(`${rel}（新增残留）`)
  t('逐字节还原：注入的探针文件已删除', !existsSync(PROBE))
  t('逐字节还原：注入前已存在的 docs md 全部未变', changed.length === 0, changed.join(', '))
  const configAfter = existsSync(CONFIG) ? readFileSync(CONFIG) : null
  t('未改动棘轮基线文件', Boolean(configBefore && configAfter && configBefore.equals(configAfter)))

  // ⑤ 还原后必须回到绿
  const restored = runGuard()
  t('还原后：检查恢复通过（退出码 0）', restored.status === 0, `退出码 ${restored.status}\n${(restored.stdout || '') + (restored.stderr || '')}`)

  console.log(bad ? `\n✗ docs-index 自检失败 ${bad} 项` : '\n✓ docs-index 自检通过：注入被检出、源文件逐字节还原')
  return bad ? 1 : 0
}

process.exit(argv.includes('--selftest') ? selftest() : main())
