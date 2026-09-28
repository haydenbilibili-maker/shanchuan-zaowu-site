#!/usr/bin/env node
/**
 * 写结果校验守卫
 *
 * 背景（2026-09-16 真实浏览器实测）：权限被拒时 CloudBase SDK **不抛错**，
 * 而是 resolve 一个带错误码的对象 `{ code: 'DATABASE_PERMISSION_DENIED', … }`。
 * 因此「await 一句写 + 弹一句成功」**在权限被拒时依然显示成功** —— 这是审计
 * P0-5 / P1「写失败被当成成功」最隐蔽的形态。
 *
 * 两条写路径的安全性不同：
 *   · **代理路径**（`cloud-fn`，仅 13 个集合走它）：服务端失败会返回 `success:false`，
 *     `callCloudFunction` 会**抛错** → 天然安全，本守卫不要求额外校验。
 *   · **CDN 直写路径**（其余集合）：可能静默 resolve 错误码 → **必须校验写结果**，
 *     否则就是假成功。
 *
 * **2026-09-16 更新（本守卫的关切面已收窄）**：`cloudbaseCdnDb.js` 的四个直写包装器
 * （`cdnAdd`/`cdnUpdate`/`cdnRemove`/`cdnSet`）现在**集中**调用 `assertNoWriteError()`，
 * 权限被拒会**由包装器自己抛 `WriteNotAppliedError`** —— 也就是说「权限被拒却假成功」
 * 这一类已经在**一个地方**根治，不再依赖每个调用点各自校验。
 *
 * 因此本守卫现在盯的是**残余关切**：`updated:0` / `deleted:0`（没有匹配到文档）——
 * 这类不会被集中层拦（一刀切会制造假失败），仍需要调用点明确语义（用 upsert 或断言）。
 * 基线里的历史项据此降级为「info」性质，但**棘轮照旧**：新增未校验直写仍会失败。
 *
 * 本守卫对 CDN 直写调用点要求附近存在校验证据：
 *   `assertWriteApplied` / `writeApplied` / `WriteNotAppliedError` / `success === false`
 *
 * 用法：
 *   node admin/scripts/check-write-verify.mjs            # 报告
 *   node admin/scripts/check-write-verify.mjs --update   # 复核后收编基线
 *   node admin/scripts/check-write-verify.mjs --strict   # 超出基线的未校验写即失败（=棘轮）；无基线则 exit 2
 *   node admin/scripts/check-write-verify.mjs --selftest # 证明会失败
 */
'use strict'

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ADMIN = resolve(HERE, '..')
const SRC = join(ADMIN, 'src')
const BASELINE = join(HERE, 'write-verify-baseline.json')
const CLOUD_JS = join(SRC, 'cloud.js')

/**
 * 本文件是否被**直接执行**（而非被 import）。
 * 为什么需要：本模块导出纯函数供 `:selftest` 使用；若顶层直接跑扫描/`--update`，
 * import 就会产生副作用（写入基线、提前 `process.exit`）——那样测试也只能靠子进程断言退出码。
 */
function isDirectRun() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href
  } catch {
    return false
  }
}

/**
 * 从 `cloud.js` 读 `COLLECTIONS` 的「键 → 集合名」映射。
 * 为什么需要：87 处写调用的集合实参不是字面量，其中最多的是 `COLLECTIONS.PRODUCTS` 这类
 * **常量引用** —— 它们完全可静态解析，不该被当成盲区（尤其 `products` 恰恰是 write:false）。
 */
export function readCollectionsMap(cloudSrc) {
  const start = cloudSrc.indexOf('export const COLLECTIONS = {')
  if (start < 0) return {}
  const body = cloudSrc.slice(start, cloudSrc.indexOf('\n}', start))
  const map = {}
  for (const m of body.matchAll(/^\s*([A-Z_0-9]+):\s*'([^']+)'/gm)) map[m[1]] = m[2]
  return map
}

/** utils/cloudbaseCdnDb.js 里 `const|export const NAME = new Set([...])` 的集合名 */
export function readProxySet(gatewaySrc, name) {
  const m = gatewaySrc.match(new RegExp(`${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`))
  return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : []
}

const GATEWAY_JS = join(SRC, 'utils', 'cloudbaseCdnDb.js')

/**
 * 走代理的集合：manageStoreContent（手写，与 STORE_CONTENT_WRITE_COLLECTIONS 对齐）
 * + secureDataWrite（运行时从 PROXY_WRITE_COLLECTIONS 读取；网关 success:false 即抛错，不会假成功）
 */
export const PROXIED_COLLECTIONS = [
  'banners', 'categories', 'activities', 'rewards', 'framers', 'care_guides',
  'custom_configs', 'custom_inquiries', 'pet_memorial_orders',
  'framer_recruit_applications', 'articles', 'cms_wikis', 'configs',
  ...readProxySet(existsSync(GATEWAY_JS) ? readFileSync(GATEWAY_JS, 'utf8') : '', 'PROXY_WRITE_COLLECTIONS'),
]

export const WRITE_HELPERS = [
  'cdnAdd', 'cdnUpdate', 'cdnSet', 'cdnRemove',
  'cdnUpsertSingleton', 'cdnUpsertDoc', 'cdnUpsertByWhere',
]

const VERIFY_RE = /assertWriteApplied|writeApplied|WriteNotAppliedError|success\s*===\s*false/

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(vue|js)$/.test(e.name)) out.push(p)
  }
  return out
}

/**
 * 找出「CDN 直写且未校验结果」的调用点。
 * @param {string} txt 文件内容
 * @param {string} rel 相对路径（用于报告）
 * @param {Set<string>} proxied 走代理的集合名
 * @returns {Array<{line:number, helper:string, collection:string}>}
 */
export function findUnverifiedWrites(txt, rel = '', proxied = new Set(PROXIED_COLLECTIONS), collectionsMap = {}) {
  const lines = txt.split('\n')
  const out = []
  for (const helper of WRITE_HELPERS) {
    // 1) 字面量集合名；2) `COLLECTIONS.KEY` 常量引用（可静态解析，不该算盲区）
    // 其余（真正的变量）留作已知盲区，由统计单独报出。
    const patterns = [
      { re: new RegExp(`\\b${helper}\\(\\s*(['"\`])([a-z_]+)\\1`, 'g'), pick: (m) => m[2] },
      { re: new RegExp(`\\b${helper}\\(\\s*COLLECTIONS\\.([A-Z_0-9]+)`, 'g'), pick: (m) => collectionsMap[m[1]] || null },
    ]
    for (const { re, pick } of patterns) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(txt))) {
        const collection = pick(m)
        if (!collection) continue
        if (proxied.has(collection)) continue
        const line = txt.slice(0, m.index).split('\n').length
        const ctx = lines.slice(Math.max(0, line - 25), line + 25).join('\n')
        if (VERIFY_RE.test(ctx)) continue
        out.push({ line, helper, collection })
      }
    }
  }
  return out
}

/**
 * 棘轮的比对键。**刻意不含行号**：
 * `file:line helper('collection')` 会让同文件里无关改动的行号平移，
 * 把一批老调用点报成**幻影「新增」**（详见 main() 里的历史说明）。
 */
export function writeKey(f) {
  return `${f.file} ${f.helper}('${f.collection}')`
}

/**
 * 归一化基线条目。**读取时同时兼容两种格式**：
 *   旧：`file:line helper('collection')`（行号会平移 → 幻影新增）
 *   新：`file helper('collection') ×N`（不含行号）
 * 这样旧基线不必一次性重写也能继续用，避免「改了比对键就必须同步重刷基线」的脆弱耦合。
 */
export function baselineKeyOf(e) {
  return String(e).replace(/^([^:]+):\d+\s+/, '$1 ').replace(/\s*×\d+$/, '')
}

/**
 * 退出码语义的唯一判定点（纯函数，由 `--selftest` 直接覆盖）。
 *
 * 正确语义 = **棘轮**，不是「有任何 findings 就红」：
 *   · findings ⊆ 基线（历史项，已在基线中登记）→ 绿。它们是 2026-09-16 收窄关切面后
 *     的**已知残留**（`updated:0`/`deleted:0` 类，属调用点语义；权限被拒已由写层包装器
 *     集中抛出），一刀切判红会制造大面积误伤，也违背基线机制存在的意义。
 *   · findings 超出基线（真正新增的未校验直写）→ 红（exit 1）。
 *   · **无基线文件**（`--strict`）→ **无法验证**，exit 2，不得静默通过。
 *     「无法验证 ≠ 通过」（错题本 E16）：此前没基线时 `--strict` 恒 exit 0，
 *     等于「删掉基线文件即可让守卫变绿」。
 *   · 非 `--strict` 报告模式：新增才红；无基线只提示，不改变退出码。
 *
 * 历史教训（本函数修掉的 bug）：退出码原写作
 *   `if (fail || process.argv.includes('--strict') && findings.length === 0) process.exit(1)`
 * 语义整个反转 —— 有 67 处 findings 时 `findings.length === 0` 为假 → `--strict` exit 0，
 * 而 findings 恰为 0（理想态）时反而 exit 1。且它把「无基线 + 有 findings」也放过了。
 *
 * @param {Array<{file:string,helper:string,collection:string}>} findings
 * @param {{exists:boolean, entries?:string[]}} baseline
 * @param {{strict?:boolean}} [opts]
 * @returns {{mode:'baseline'|'absent', knownCount:number, added:Array, noBaselineButFindings:boolean, fail:boolean}}
 */
export function evaluateRatchet(findings, baseline, opts = {}) {
  const strict = !!opts.strict
  const added = []
  if (baseline && baseline.exists) {
    const known = new Set((baseline.entries || []).map(baselineKeyOf))
    for (const f of findings) if (!known.has(writeKey(f))) added.push(f)
    return {
      mode: 'baseline',
      knownCount: known.size,
      added,
      noBaselineButFindings: false,
      // 报告模式与 strict 模式对「超出基线」的判定一致：都是红。
      // 二者的差别只在**无基线**时的处置（见下方 `absent` 分支）。
      fail: added.length > 0,
    }
  }
  // 无基线：扫描到的每一项都无法判定是否历史项
  return {
    mode: 'absent',
    knownCount: 0,
    added,
    noBaselineButFindings: findings.length > 0,
    fail: strict && findings.length > 0,
  }
}

const CASES = [
  ['直写且不校验 → 命中', (c) => c.findUnverifiedWrites(`
    const save = async () => {
      await cdnUpdate('products', id, { a: 1 })
      ElMessage.success('已保存')
    }`).length === 1],
  ['secureDataWrite 网关集合（PROXY_WRITE_COLLECTIONS 运行时读取）→ 不要求校验', (c) =>
    c.PROXIED_COLLECTIONS.has('home_configs') && c.findUnverifiedWrites(`
      await cdnUpdate('home_configs', id, { a: 1 })`, '', c.PROXIED_COLLECTIONS).length === 0],
  ['直写 + assertWriteApplied → 不命中', (c) => c.findUnverifiedWrites(`
    const save = async () => {
      const res = await cdnUpdate('home_configs', id, { a: 1 })
      assertWriteApplied('home_configs', res, '保存')
    }`).length === 0],
  ['直写 + writeApplied 判定 → 不命中', (c) => c.findUnverifiedWrites(`
    const res = await cdnUpdate('home_configs', id, { a: 1 })
    if (!writeApplied(res)) throw new Error('no')`).length === 0],
  ['代理集合的直写 → 不要求校验（代理会抛错）', (c) => c.findUnverifiedWrites(`
    await cdnUpdate('categories', id, { a: 1 })`).length === 0],
  ['代理 + 非代理混用 → 只报非代理那个', (c) => {
    const r = c.findUnverifiedWrites(`
      await cdnUpdate('categories', id, { a: 1 })
      await cdnUpdate('bookings', id, { a: 1 })`)
    return r.length === 1 && r[0].collection === 'bookings'
  }],
  ['变量集合名 → 静态不可判，不误报', (c) => c.findUnverifiedWrites(`
    await cdnUpdate(colName, id, { a: 1 })`).length === 0],
  ['COLLECTIONS.KEY 常量引用可解析（不该算盲区）', (c) => {
    const map = { PRODUCTS: 'products' }
    const r = c.findUnverifiedWrites(`await cdnUpdate(COLLECTIONS.PRODUCTS, id, { stock: 1 })`, '', new Set(), map)
    return r.length === 1 && r[0].collection === 'products'
  }],
  ['COLLECTIONS.X 指向代理集合 → 不要求校验', (c) => {
    const map = { BANNERS: 'banners' }
    return c.findUnverifiedWrites(`await cdnAdd(COLLECTIONS.BANNERS, d)`, '', c.PROXIED_COLLECTIONS, map).length === 0
  }],
  ['校验出现在同一函数内的较远处（窗口内）→ 不命中', (c) => c.findUnverifiedWrites(`
    const save = async () => {
      const res = await cdnUpdate('stores', id, { a: 1 })
      await doOther()
      await doMore()
      assertWriteApplied('stores', res, '保存')
    }`).length === 0],
]
// ---- 退出码语义（棘轮）自检 ----
// 为什么单独成组：本守卫曾整条闸门失效（有 67 处 findings 仍 exit 0），
// 而旧自检只测「能不能发现」，不测「发现了之后退出码是什么」→ 全绿的假象。
// 这组断言直接把「哪种情形必须红 / 必须绿」钉死；若有人再反转退出码，这里必红。
const f = (file, helper, collection) => ({ file, helper, collection, line: 1 })
const EXIT_CASES = [
  ['棘轮：findings 全在基线内 → 绿', (c) => {
    const fs1 = [f('A.vue', 'cdnUpdate', 'home_configs')]
    const r = c.evaluateRatchet(fs1, { exists: true, entries: ["A.vue cdnUpdate('home_configs') ×1"] }, { strict: true })
    return r.fail === false && r.added.length === 0 && r.mode === 'baseline'
  }],
  ['棘轮：新键超出基线 → 红（strict 与报告模式都必须红）', (c) => {
    const fs1 = [f('A.vue', 'cdnUpdate', 'home_configs'), f('B.vue', 'cdnAdd', 'stores')]
    const base = { exists: true, entries: ["A.vue cdnUpdate('home_configs') ×1"] }
    const rs = c.evaluateRatchet(fs1, base, { strict: true })
    const rr = c.evaluateRatchet(fs1, base, { strict: false })
    return rs.fail === true && rs.added.length === 1 && rr.fail === true && rr.added.length === 1
  }],
  ['棘轮：无基线 → strict 必须红（无法验证 ≠ 通过；不得静默变绿）', (c) => {
    const r = c.evaluateRatchet([f('A.vue', 'cdnUpdate', 'home_configs')], { exists: false }, { strict: true })
    return r.fail === true && r.mode === 'absent' && r.noBaselineButFindings === true
  }],
  ['棘轮：无基线 + 报告模式 → 只提示，不红', (c) => {
    const r = c.evaluateRatchet([f('A.vue', 'cdnUpdate', 'home_configs')], { exists: false }, { strict: false })
    return r.fail === false && r.mode === 'absent'
  }],
  ['棘轮：无基线 + 零 findings → 绿（无「无基线」可报）', (c) => {
    const r = c.evaluateRatchet([], { exists: false }, { strict: true })
    return r.fail === false && r.noBaselineButFindings === false
  }],
  ['棘轮：零 findings（理想态）→ 绿（旧实现恰好在此误红）', (c) => {
    const r = c.evaluateRatchet([], { exists: true, entries: ["A.vue cdnUpdate('home_configs') ×1"] }, { strict: true })
    return r.fail === false && r.added.length === 0
  }],
  ['棘轮：旧格式基线条目（含行号）仍能归一去重 → 不误判新增', (c) => {
    const r = c.evaluateRatchet([f('A.vue', 'cdnUpdate', 'home_configs')], { exists: true, entries: ["A.vue:123 cdnUpdate('home_configs')"] }, { strict: true })
    return r.fail === false && r.knownCount === 1
  }],
  ['棘轮：键已在基线时，同键的第二处调用**不**计入 added（已知局限，如实钉住）', (c) => {
    // 比对是「键集合」而非「键×计数」：同文件里第二处同键调用不会让 added 变多。
    // 本条**不是**在为漏洞背书、也不是放宽断言，而是把既有语义钉死，防止有人
    // 误以为「复制粘贴会被抓住」而删掉别处的真防护。局限已登记在 main() 的注释里。
    const fs1 = [f('A.vue', 'cdnUpdate', 'home_configs'), f('A.vue', 'cdnUpdate', 'home_configs')]
    const r = c.evaluateRatchet(fs1, { exists: true, entries: ["A.vue cdnUpdate('home_configs') ×1"] }, { strict: true })
    return r.fail === false && r.added.length === 0
  }],
  ['棘轮：基线里没有该键的任何一个调用点 → 全部算新增', (c) => {
    const fs1 = [f('B.vue', 'cdnAdd', 'stores'), f('B.vue', 'cdnAdd', 'stores')]
    const r = c.evaluateRatchet(fs1, { exists: true, entries: ["A.vue cdnUpdate('home_configs') ×1"] }, { strict: true })
    return r.fail === true && r.added.length === 2
  }],
  ['基线归一化：`file:line call` → `file call`；`×N` 后缀剥离', (c) => {
    const r = c.evaluateRatchet([f('A.vue', 'cdnUpdate', 'home_configs')], { exists: true, entries: ['A.vue:9 cdnUpdate(\'home_configs\') ×3'] }, { strict: true })
    return r.fail === false && r.knownCount === 1
  }],
]

if (isDirectRun() && process.argv.includes('--selftest')) {
  console.log('自检：证明「该拦的会拦、该放的不拦」+ 退出码语义\n')
  let bad = 0
  const ctx = {
    findUnverifiedWrites,
    evaluateRatchet,
    PROXIED_COLLECTIONS: new Set(PROXIED_COLLECTIONS),
  }
  // 两组断言：① 侦测能力（findUnverifiedWrites）② 退出码语义（evaluateRatchet）。
  // 分开列原因：退出码语义曾整条失效而旧自检全绿（只测①不测②）。
  for (const [label, fn] of [...CASES, ...EXIT_CASES]) {
    let ok = false
    let err = ''
    try { ok = !!fn(ctx) } catch (e) { err = e.message }
    console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` ${err}`}`)
    if (!ok) bad += 1
  }
  console.log()
  if (bad) {
    console.error(`自检失败：${bad} 项判定不符，守卫不可信。`)
    process.exit(1)
  }
  console.log('自检通过：未校验的直写会被拦，已校验/代理/变量集合不会误报；')
  console.log('          退出码语义（基线内绿 / 超出基线红 / 无基线 strict 红）与上述一致。\n')
  process.exit(0)
}

if (isDirectRun()) {
  const collectionsMap = readCollectionsMap(readFileSync(CLOUD_JS, 'utf8'))
  const files = walk(SRC).filter((p) => !p.includes('cloudbaseCdnDb.js') && !p.includes('cloud.js'))
  const findings = []
  let variableWrites = 0
  let proxiedWrites = 0
  for (const p of files) {
    const txt = readFileSync(p, 'utf8')
    const rel = relative(ADMIN, p)
    for (const f of findUnverifiedWrites(txt, rel, new Set(PROXIED_COLLECTIONS), collectionsMap)) findings.push({ file: rel, ...f })
    // 只统计**非注释行**上的调用，避免把文档/注释里的示例也算进来
    // （上一版就因为这个把「变量集合」报成了约 87 处，是假的数字，已删）
    const codeLines = txt.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    for (const helper of WRITE_HELPERS) {
      const all = codeLines.match(new RegExp(`\\b${helper}\\(`, 'g')) || []
      const literal = codeLines.match(new RegExp(`\\b${helper}\\(\\s*['"\`][a-z_]+['"\`]`, 'g')) || []
      const constRef = codeLines.match(new RegExp(`\\b${helper}\\(\\s*COLLECTIONS\\.[A-Z_0-9]+`, 'g')) || []
      variableWrites += all.length - literal.length - constRef.length
      literal.forEach((s2) => {
        const c = s2.match(/['"`]([a-z_]+)['"`]/)[1]
        if (PROXIED_COLLECTIONS.includes(c)) proxiedWrites += 1
      })
    }
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  // 比对键 = `writeKey()`（不含行号，理由见该函数注释与下面的历史说明）。
  // 原先键是 `file:line helper('collection')`，于是在同一文件里别处（哪怕是并行分支）加几行，
  // 所有后续调用的行号都会平移，棘轮就报出一批**幻影「新增」**——实测被这个坑过：
  // report_templates 的两处直写只是从 :611/:639 移到 :633/:661，却被判成「新增 2 处」。
  // 真正要拦的是「多了一个未校验的直写调用」，而不是「文件变长了」。
  // 行号仍保留在展示层（下面 findings.forEach 里会打印），只是不参与比对。
  //
  // **已知局限（本次复核确认，未改语义）**：比对是「键集合」而非「键×计数」，
  // 所以「把一个**已在基线里的**调用原样复制到同文件另一处」不会让 added 变多，
  // 因而**不会被棘轮单独抓住**。之所以不在本次改动里顺手改成计数比较：
  // 基线里同一键被拆成 `×1`/`×2` 多条（如 AchievementConfig 的 cdnUpdate 合计 3 处
  // 却分成 ×1 与 ×2 两条），任何一种「求和」口径都可能把历史项误判成新增（假红），
  // 那是本仓明令禁止的「为变绿/变红乱动断言」的镜像错误。真正要收口它，属独立工作项，
  // 需先把基线刷新为「一键一条 ×N」的规范形态再比较。此处如实登记，不假装已覆盖。
  const countByKey = new Map()
  for (const it of findings) {
    const k = writeKey(it)
    countByKey.set(k, (countByKey.get(k) || 0) + 1)
  }
  const keys = [...countByKey.keys()].map((k) => `${k} ×${countByKey.get(k)}`)

  console.log(`写结果校验守卫：扫描 ${files.length} 个文件`)
  console.log(`  走代理（天然安全，不要求校验）：约 ${proxiedWrites} 处`)
  console.log(`  集合名是变量、**静态不可判定**（本守卫覆盖不到）：${variableWrites} 处 —— 这是本守卫的已知盲区`)
  console.log(`  CDN 直写但调用点未校验（残余关切：updated:0 类；权限被拒已由包装器集中抛出）：${findings.length} 处`)

  let fail = 0
  const baseline = existsSync(BASELINE)
    ? { exists: true, entries: (JSON.parse(readFileSync(BASELINE, 'utf8')).unverified || []) }
    : { exists: false }
  const ratchet = evaluateRatchet(findings, baseline, { strict: process.argv.includes('--strict') })
  if (ratchet.mode === 'baseline') {
    console.log(`\n棘轮：基线 ${ratchet.knownCount} 个调用点 / 本次 ${countByKey.size} 个调用点（${findings.length} 处）`)
    if (ratchet.added.length) {
      console.error(`✗ 新增 ${ratchet.added.length} 处未校验的直写（权限被拒时会假成功）：`)
      ratchet.added.forEach((e) => console.error(`   ${e.file}:${e.line} ${writeKey(e)}`))
      fail += ratchet.added.length
    } else {
      console.log('  无新增。')
    }
  } else {
    console.log(`\n（未找到基线 ${BASELINE.replace(ADMIN + '/', '')}，用 --update 生成）`)
    // 无基线 = 每一项都无法判定是不是历史项。「无法验证 ≠ 通过」（错题本 E16）。
    if (ratchet.noBaselineButFindings) {
      console.error(
        ratchet.fail
          ? `✗ 无基线，${findings.length} 处 findings 的归属**无法判定** → exit 2（不得静默通过）。`
          : `⚠ 无基线，${findings.length} 处 findings 归属无法判定（报告模式不改变退出码；加 --strict 即 exit 2）。`
      )
    }
  }

  if (process.argv.includes('--update')) {
    // 基线取「旧基线（归一化后）∪ 本次扫描结果」，即**超集**。
    // 为什么要超集：本仓与另一条并行工作流共用同一工作树，工作树里可能有尚未提交的改动
    // （实测：member_welcome_gift 的两处直写已被改成走云函数，但那次改动还没提交）。
    // 若基线只按工作树生成，就会比 HEAD 少 2 条 → 一旦 checkout/提交到 HEAD 状态，
    // 棘轮立刻报「新增 2 处」的假告警。超集对两边都成立，且**仍能**拦住真正的新增直写。
    const legacy = existsSync(BASELINE) ? (JSON.parse(readFileSync(BASELINE, 'utf8')).unverified || []) : []
    const normalized = legacy
      .map((e) => String(e).replace(/^([^:]+):\d+\s+/, '$1 ')) // 旧格式 file:line call → file call
      .map((e) => (/×\d+$/.test(e) ? e : `${e} ×1`))
    const union = [...new Set([...normalized, ...keys])].sort()
    writeFileSync(BASELINE, `${JSON.stringify({
      updatedAt: new Date().toISOString().slice(0, 10),
      note: '已知的「CDN 直写但未校验写结果」调用点。权限被拒时 SDK 不抛错 → 会假成功。'
        + '新增即失败；逐项改为 assertWriteApplied / writeApplied 后再 --update 收编。'
        + '走代理的集合不需要校验（代理失败会抛错），不计入。'
        + '比对键**不含行号**（file helper(\'collection\') ×N）—— 行号会因同文件里无关改动而平移，'
        + '曾造成「新增 2 处」的幻影告警；×N 用于发现「同一处直写被复制粘贴」。',
      unverified: union,
    }, null, 2)}\n`, 'utf8')
    console.log(`已写入基线（本次 ${keys.length} 处 / 超集 ${union.length} 处）`)
    process.exit(0)
  }

  console.log()
  // 「无基线 + 有 findings」：strict 已由 ratchet.fail 判定为红，exit 2（无法验证）；
  // 报告模式只提示，不改退出码。退出原因用 stderr 说清，避免与「棘轮抓到新增」混为一谈。
  const unverifiable = ratchet.fail && fail === 0
  if (unverifiable) {
    console.error('✗ 退出码 2：基线缺失，本次 findings 的归属无法判定 —— 无法验证 ≠ 通过。')
    process.exit(2)
  }
  if (fail) process.exit(1)
  if (findings.length) {
    console.log('当前未校验的调用点（按文件）：')
    const byFile = new Map()
    findings.forEach((f) => {
      if (!byFile.has(f.file)) byFile.set(f.file, [])
      byFile.get(f.file).push(f)
    })
    ;[...byFile.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([file, list]) => {
      console.log(`   ${file}  (${list.length})`)
      list.slice(0, 3).forEach((f) => console.log(`      ${f.line}  ${f.helper}('${f.collection}')`))
      if (list.length > 3) console.log(`      …另有 ${list.length - 3} 处`)
    })
  }
  console.log('\n通过（仍有待收编的历史项，见基线）。')
  process.exit(0)
}
