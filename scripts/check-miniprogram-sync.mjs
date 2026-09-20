#!/usr/bin/env node
/**
 * 检查「代码主库」与「微信开发者工具打开的目录」是否一致。
 *
 * 为什么需要：DevTools 编译/上传的是 shanchuanspecimens，而唯一代码主库是
 * monorepo 的 miniprogram/。两者靠手工 cp 同步，一旦漏同步，**开发者工具里跑的
 * 就是旧代码**——曾经就因此让一整轮 toast 修复（icon:success → none）没有生效，
 * 而且本地静态检查全绿、完全看不出来。
 *
 * 允许不同的只有两处，且都是「本机/身份」信息，不参与编译语义：
 *   · project.miniapp.json —— 开发仓专有，含本地 DevTools 配置；
 *   · project.config.json / project.private.config.json 的 **projectname** —— 两仓显示名，
 *     用来在开发者工具里分清「哪个是施工仓、哪个是开发仓」（2026-09-17 加：两仓内容一致后同名无法区分）。
 *     **两份都要写**：DevTools 里私有配置的字段会覆盖公共配置（文件自带的说明就是这么写的），
 *     只改公共配置不会生效。注意是**按字段**例外，其余字段（appid / setting / packOptions …）仍须逐字一致。
 *
 * 另外忽略 `scripts/*.result.json`：provision / migrate 脚本**故意把结果写到开发仓**（见
 * provision-finance-ledger.cjs 的 outDir），主库不会有它们；打包也已被 packOptions.ignore 排除。
 * 不忽略的话本检查会永远红，反而掩盖真实漂移。
 *
 * 用法：
 *   node scripts/check-miniprogram-sync.mjs             # 检查
 *   node scripts/check-miniprogram-sync.mjs --fix       # 不一致时从主库覆盖到开发仓
 *   node scripts/check-miniprogram-sync.mjs --prune     # 【删除类改动的收尾】删掉开发仓里「主库已不存在」的残留文件
 *
 * ⚠️ 为什么需要 --prune：--fix 只做「复制」，从不删除（默认不擅自删本机文件，见自检 E）。
 *   于是「主库删掉某个文件」这类改动会在开发仓留下残骸（2026-09-17 实际踩到：18 个主包工具删了
 *   但开发仓还在，微信「主包未使用」告警不消失、包体也没瘦）。--prune 专门收尾，且**双保险**：
 *   只处理代码/资源后缀、并显式排除 node_modules / .git / DS_Store / project.miniapp.json /
 *   scripts/.tmp / *.result.json / *.log / *.env*；删除清单会写入报告文件备查。
 * 退出码：不一致为 1（--fix 修复成功则为 0）。
 */
import {
  readFileSync, readdirSync, statSync, copyFileSync, mkdirSync, existsSync, unlinkSync,
  mkdtempSync, writeFileSync, rmSync
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 本仓根：脚本就在 `<仓库根>/scripts/` 下，所以**向上只一层**。
// ⚠️ 2026-09-18 修：这里原本是 `'..', '..'` 再用 `join(ROOT, 'shanchuanzaowu', 'miniprogram')`
//    拼主库 —— 那等于**硬编码了仓库目录名**。在 git worktree 里（目录名 = 流 id，如 `integration`）
//    主库路径会算成 `<worktrees 基目录>/shanchuanzaowu/miniprogram`，直接报"找不到主库目录"，
//    于是**任何 worktree 出来的 PR 都会在这条守卫上判红**，等于废掉隔离开发。
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
// 开发仓放在**本仓的兄弟目录**里：基线是本机专有布局，worktree 下这个路径自然不存在 → 安全跳过（见下方逻辑）
const WORKSPACE = join(REPO, '..')
// 可被环境变量覆盖：只为 --selftest 能在临时目录里证明"本检查会失败"。
const SRC = process.env.SYNC_SRC || join(REPO, 'miniprogram')
const DST = process.env.SYNC_DST || join(WORKSPACE, 'WeChatProjects', 'shanchuanspecimens-只上传')

/** 允许整文件不同（开发仓专有配置） */
const ALLOW_DIFF = new Set(['project.miniapp.json'])
/** 允许按**字段**不同：只是显示名，不参与编译。其余字段仍逐字比对。 */
const ALLOW_DIFF_FIELDS = {
  'project.config.json': ['projectname'],
  'project.private.config.json': ['projectname']
}

/** 脚本产物（故意写到开发仓的结果 JSON，打包已忽略）—— 不参与双仓比对 */
const IGNORE_REL = /^scripts\/.*\.result\.json$/

/**
 * --prune 的可删范围（双保险，越窄越好）：
 *   ① 只处理「主库会管理的代码/资源后缀」；
 *   ② 显式排除本机产物与身份文件 —— 这些在开发仓本来就该存在，删了会出事。
 */
// 注意带上 wav/aac/m4a/ogg：礼笺打字机音效就是 .wav（2026-09-20），
// 漏了它 → 删素材时 --prune 会判成"本机产物"跳过，开发仓留残骸、包体也不瘦。
const PRUNE_SAFE_EXT = /\.(js|json|wxml|wxss|wxs|ts|png|jpe?g|gif|svg|webp|mp3|mp4|wav|aac|m4a|ogg|ttf|otf|woff2?)$/i
const PRUNE_EXCLUDE_REL = [
  /(^|\/)node_modules\//,
  /(^|\/)\.git\//,
  /(^|\/)\.DS_Store$/,
  /^project\.miniapp\.json$/,
  /^scripts\/\.tmp\//,
  /^scripts\/.*\.result\.json$/,
  /\.(log|env|local)$/i,
  /(^|\/)\.env/
]
function isPrunable(rel) {
  if (!PRUNE_SAFE_EXT.test(rel)) return false
  return !PRUNE_EXCLUDE_REL.some((re) => re.test(rel))
}
const PRUNE_REPORT = 'scripts/miniprogram-sync-prune.result.json'

/** 读 JSON（失败给 null，调用方自行回落） */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    return null
  }
}

/** 取出目标端某些字段的现有值（文件不存在/不可解析则为 null） */
function pickFields(file, fields) {
  if (!existsSync(file)) return null
  const o = readJson(file)
  if (!o) return null
  const out = {}
  for (const k of fields) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k]
  return Object.keys(out).length ? out : null
}

/**
 * 同一路径的内容是否视为一致。
 * 只对 ALLOW_DIFF_FIELDS 里登记的 JSON 做「删掉这些键再比」；解析失败一律退回逐字比对
 * （宁可报不一致，也不要因为解析异常而漏掉真实漂移）。
 */
function sameContent(rel, a, b) {
  const drop = ALLOW_DIFF_FIELDS[rel]
  if (!drop) return a.equals(b)
  try {
    const norm = (buf) => {
      const o = JSON.parse(buf.toString('utf8'))
      for (const k of drop) delete o[k]
      return JSON.stringify(o)
    }
    return norm(a) === norm(b)
  } catch (e) {
    return a.equals(b)
  }
}
// .tmp = 部署/巡检的临时日志与中间 JSON（miniprogram/.gitignore 已忽略）。
// 必须显式跳过：否则每次部署都会生成带时间戳的新文件，让本检查**不确定**地报不一致。
const IGNORE_DIRS = new Set(['node_modules', '.git', 'miniprogram_npm', '.tmp'])
const IGNORE_FILES = new Set(['.DS_Store'])

function walk(base, dir = '', out = []) {
  const abs = join(base, dir)
  for (const name of readdirSync(abs)) {
    if (IGNORE_DIRS.has(name) || IGNORE_FILES.has(name)) continue
    const rel = dir ? `${dir}/${name}` : name
    if (statSync(join(abs, name)).isDirectory()) walk(base, rel, out)
    else if (!IGNORE_REL.test(rel)) out.push(rel)
  }
  return out
}

function main() {
  const fix = process.argv.includes('--fix')
  const prune = process.argv.includes('--prune')

  if (!existsSync(SRC)) {
    console.error(`✗ 找不到主库目录：${SRC}`)
    process.exit(1)
  }
  // 开发仓是**本机专有**目录（CI / 其他机器上没有）：不存在就没有"不同步"可言，跳过并说明 ——
  // 这样本检查才敢挂进 check:admin，而不会把 CI 弄红。
  if (!existsSync(DST)) {
    console.log(`· 跳过：本机没有开发仓目录（${DST}）—— CI / 他人机器属正常情况`)
    return
  }

  const srcFiles = new Set(walk(SRC))
  const dstFiles = new Set(walk(DST))
  const problems = []

  for (const rel of srcFiles) {
    const a = join(SRC, rel)
    const b = join(DST, rel)
    if (!existsSync(b)) {
      problems.push({ rel, kind: '开发仓缺失' })
    } else if (!sameContent(rel, readFileSync(a), readFileSync(b))) {
      problems.push({ rel, kind: ALLOW_DIFF.has(rel) ? '允许差异' : '内容不一致' })
    }
  }
  for (const rel of dstFiles) {
    if (!srcFiles.has(rel)) problems.push({ rel, kind: '主库缺失（开发仓多出）' })
  }

  // 提示（不参与退出码）：两仓显示名若被改成一样，工具里又会分不清 —— 当场说出来。
  try {
    const nameOf = (base) => {
      const pub = JSON.parse(readFileSync(join(base, 'project.config.json'), 'utf8')).projectname
      let priv = ''
      try { priv = JSON.parse(readFileSync(join(base, 'project.private.config.json'), 'utf8')).projectname || '' } catch (e) { /* 可选文件 */ }
      return { pub, priv }
    }
    const na = nameOf(SRC), nb = nameOf(DST)
    const a = na.priv || na.pub, b = nb.priv || nb.pub
    if (a && b && a === b) {
      console.log(`· 提示：两仓 projectname 相同（${a}）—— 在开发者工具里会分不清施工仓 / 开发仓；` +
        '建议各自设为不同名字（见 docs/施工与发布流程.md「两仓在开发者工具里怎么分」）。')
    }
  } catch (e) { /* 缺文件/解析失败不在这里报，交给上面的比对 */ }

  const real = problems.filter((p) => p.kind !== '允许差异')
  for (const p of problems) {
    const tag = p.kind === '允许差异' ? '·' : '✗'
    if (p.kind === '允许差异' && !fix) continue
    console.log(`${tag} [${p.kind}] ${p.rel}`)
  }

  if (!real.length) {
    console.log(`✓ 双仓一致（主库 ${srcFiles.size} 个文件；仅 ${[...ALLOW_DIFF].join(', ')} 为开发仓专有）`)
    return
  }

  // --prune：删除开发仓里「主库已不存在」的残留（--fix 不做这件事，见文件头说明）
  if (prune) {
    const strays = real.filter((p) => p.kind === '主库缺失（开发仓多出）')
    const prunable = strays.filter((p) => isPrunable(p.rel))
    const skipped = strays.filter((p) => !isPrunable(p.rel)).map((p) => p.rel)
    const removed = []
    for (const p of prunable) {
      try {
        unlinkSync(join(DST, p.rel))
        removed.push(p.rel)
      } catch (e) { /* 删不掉就跳过，下面汇总 */ }
    }
    mkdirSync(dirname(join(SRC, PRUNE_REPORT)), { recursive: true })
    writeFileSync(join(SRC, PRUNE_REPORT), `${JSON.stringify({
      at: new Date().toISOString(),
      removed,
      skippedByPolicy: skipped
    }, null, 2)}\n`)
    console.log(`\n--prune：删除 ${removed.length} 个残留文件${skipped.length ? `；按策略跳过 ${skipped.length} 个（本机产物/身份文件）` : ''}`)
    for (const r of removed.slice(0, 20)) console.log(`  - ${r}`)
    if (skipped.length) for (const r of skipped.slice(0, 10)) console.log(`  · 跳过 ${r}`)
    console.log(`  报告：${PRUNE_REPORT}`)
    const left = real.filter((p) => p.kind !== '主库缺失（开发仓多出）')
    if (left.length) {
      console.error(`\n仍有 ${left.length} 处内容/缺失问题，请再跑 --fix。`)
      process.exit(1)
    }
    process.exit(0)
  }

  if (fix) {
    let copied = 0
    for (const p of real) {
      if (p.kind === '主库缺失（开发仓多出）') continue
      const a = join(SRC, p.rel)
      const b = join(DST, p.rel)
      mkdirSync(dirname(b), { recursive: true })
      const kept = ALLOW_DIFF_FIELDS[p.rel] ? pickFields(b, ALLOW_DIFF_FIELDS[p.rel]) : null
      copyFileSync(a, b)
      if (kept) {
        // ⚠️ 整文件复制会把「本机身份」也带过去：projectname 必须保留目标端的值，
        // 否则一次同步就把开发仓的名字改成施工仓的（2026-09-17 实际踩到过）。
        writeFileSync(b, `${JSON.stringify({ ...readJson(b), ...kept }, null, 2)}\n`)
      }
      copied += 1
    }
    console.log(`\n已从主库覆盖 ${copied} 个文件到开发仓；请复跑本脚本确认。`)
    process.exit(0)
  }

  console.error(`\n双仓不一致：${real.length} 处。**开发者工具编译的是开发仓**，请先跑 --fix 再上传。`)
  process.exit(1)
}

/**
 * 自检：在临时目录里造主库/开发仓，逐场景证明本检查**会失败**、且 --fix 真能修好。
 *   A 两仓一致 → 0 ／ B 开发仓缺文件 → 1 ／ C 内容不一致 → 1
 *   D C 跑 --fix → 0 且内容同步 ／ E 开发仓多出文件 → 1（且 --fix 不擅自删本机文件）
 */
function selftest() {
  const base = mkdtempSync(join(tmpdir(), 'mp-sync-selftest-'))
  const src = join(base, 'miniprogram')
  const dst = join(base, 'devrepo')
  const seed = () => {
    rmSync(src, { recursive: true, force: true })
    rmSync(dst, { recursive: true, force: true })
    mkdirSync(join(src, 'sub'), { recursive: true })
    mkdirSync(join(dst, 'sub'), { recursive: true })
    writeFileSync(join(src, 'app.wxss'), 'same\n')
    writeFileSync(join(dst, 'app.wxss'), 'same\n')
    writeFileSync(join(src, 'sub/a.js'), 'A\n')
    writeFileSync(join(dst, 'sub/a.js'), 'A\n')
    // 真实情形：project.miniapp.json **两仓都有**但内容不同（允许整文件差异）
    writeFileSync(join(src, 'project.miniapp.json'), '{"a":1}\n')
    writeFileSync(join(dst, 'project.miniapp.json'), '{"a":2}\n')
    // 真实情形：project.config.json 只有 projectname 不同（施工仓 / 开发仓 显示名）
    writeFileSync(join(src, 'project.config.json'),
      JSON.stringify({ appid: 'wxSAME', projectname: '山海造物·施工仓', setting: { es6: true } }, null, 2) + '\n')
    writeFileSync(join(dst, 'project.config.json'),
      JSON.stringify({ appid: 'wxSAME', projectname: '山海造物·开发仓', setting: { es6: true } }, null, 2) + '\n')
  }
  const run = (fix, extra = []) => spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), ...(fix ? ['--fix'] : []), ...extra],
    { env: { ...process.env, SYNC_SRC: src, SYNC_DST: dst }, encoding: 'utf8' }
  )
  let bad = 0
  const expect = (name, cond, extra) => {
    if (cond) console.log(`  ✓ ${name}`)
    else { bad += 1; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`) }
  }

  seed()
  expect('A 两仓一致 → 通过（且允许 project.miniapp.json 差异）', run(false).status === 0)

  seed()
  rmSync(join(dst, 'sub/a.js'))
  expect('B 开发仓缺文件 → 检出', run(false).status === 1)

  seed()
  writeFileSync(join(dst, 'app.wxss'), 'stale\n')
  const c = run(false)
  expect('C 内容不一致 → 检出', c.status === 1)
  expect('C 报出具体文件', /app\.wxss/.test(c.stdout + c.stderr))

  const d = run(true)
  expect('D --fix → 退出码 0', d.status === 0)
  expect('D --fix 后内容已同步', readFileSync(join(dst, 'app.wxss'), 'utf8') === 'same\n')
  expect('D --fix 后复跑通过', run(false).status === 0)

  seed()
  writeFileSync(join(dst, 'legacy.js'), 'old\n')
  const e = run(false)
  expect('E 开发仓多出文件 → 检出', e.status === 1)
  run(true)
  expect('E --fix 不擅自删除开发仓多出的文件', existsSync(join(dst, 'legacy.js')))

    // J/K：--prune 专门收尾「删除类改动」留下的残骸，且只删该删的
    seed()
    writeFileSync(join(dst, 'legacy.js'), 'old\n')
    writeFileSync(join(dst, 'sub-legacy.wxml'), '<view/>\n')
    const j = run(false, ['--prune'])
    expect('J --prune 删除开发仓残留代码文件 → 0', j.status === 0, j.stderr)
    expect('J 残留 js 已删', !existsSync(join(dst, 'legacy.js')))
    expect('J 残留 wxml 已删', !existsSync(join(dst, 'sub-legacy.wxml')))
    expect('J 复跑检查通过', run(false).status === 0)

    seed()
    writeFileSync(join(dst, 'legacy-sfx.wav'), 'RIFF....WAVE')
    const l = run(false, ['--prune'])
    expect('L --prune 删除开发仓残留音频（.wav 在主库已删）→ 0', l.status === 0, l.stderr)
    expect('L 残留 wav 已删', !existsSync(join(dst, 'legacy-sfx.wav')))

    seed()
    mkdirSync(join(dst, 'scripts'), { recursive: true })
    writeFileSync(join(dst, 'scripts/keep.result.json'), '{}\n')
    writeFileSync(join(dst, 'scripts/notes.log'), 'x\n')
    run(false, ['--prune'])
    expect('K --prune 不碰本机产物：*.result.json 保留', existsSync(join(dst, 'scripts/keep.result.json')))
    expect('K --prune 不碰本机产物：*.log 保留', existsSync(join(dst, 'scripts/notes.log')))

  seed()
  writeFileSync(join(dst, 'scripts'), '')  // 占位，下面会删掉重建为目录
  rmSync(join(dst, 'scripts'))
  mkdirSync(join(dst, 'scripts'), { recursive: true })
  writeFileSync(join(dst, 'scripts/provision-x.result.json'), '{"ok":true}\n')
  const h = run(false)
  expect('H 开发仓多出的 scripts/*.result.json → 按约定忽略（脚本故意写到开发仓的产物）',
    h.status === 0, h.stdout + h.stderr)

  seed()
  // 源与目标既差 setting（应同步）又差 projectname（必须保留目标端）
  writeFileSync(join(src, 'project.config.json'),
    JSON.stringify({ appid: 'wxSAME', projectname: '山海造物·施工仓', setting: { es6: true, minified: true } }, null, 2) + '\n')
  writeFileSync(join(dst, 'project.config.json'),
    JSON.stringify({ appid: 'wxSAME', projectname: '山海造物·开发仓', setting: { es6: true, minified: false } }, null, 2) + '\n')
  const i1 = run(true)
  const dstCfg = JSON.parse(readFileSync(join(dst, 'project.config.json'), 'utf8'))
  expect('I --fix 同步其它字段（setting.minified 跟随主库）', i1.status === 0 && dstCfg.setting.minified === true,
    JSON.stringify(dstCfg))
  expect('I --fix 保留开发仓自己的 projectname（不被主库覆盖）', dstCfg.projectname === '山海造物·开发仓',
    `实际 ${dstCfg.projectname}`)

  seed()
  const f = run(false)
  expect('F 仅 projectname 不同 → 视为一致（两仓显示名各自保留）', f.status === 0, f.stdout + f.stderr)

  seed()
  writeFileSync(join(dst, 'project.config.json'),
    JSON.stringify({ appid: 'wxDIFFERENT', projectname: '山海造物·开发仓', setting: { es6: true } }, null, 2) + '\n')
  const g = run(false)
  expect('G project.config.json 的 appid 不同 → 仍检出（例外是窄的，只放过 projectname）', g.status === 1)
  expect('G 报出 project.config.json', /project\.config\.json/.test(g.stdout + g.stderr))

  rmSync(base, { recursive: true, force: true })
  if (bad) {
    console.error(`\n✗ selftest 失败 ${bad} 项`)
    process.exit(1)
  }
  console.log('\n✓ selftest 通过：一致 / 缺文件 / 内容不一致 / --fix 修复 / 多出文件 / 显示名可不同 / 其余字段仍须一致 / 产物 JSON 被忽略 / --fix 保留本机显示名')
  process.exit(0)
}

if (process.argv.includes('--selftest')) selftest()
else main()
