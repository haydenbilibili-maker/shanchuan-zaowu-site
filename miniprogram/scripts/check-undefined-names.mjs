#!/usr/bin/env node
/**
 * 全仓「未定义变量」守卫（2026-10-08，C 流真机缺陷后扩为全仓）
 *
 * 起因：出货中心「选 SKU」保存报 `storeById is not defined`（manageStoreShipment 漏解构）。
 * 用同一扫描器扫全仓又查出 4 处同类：refundOrder 的 WALLET_INTERNAL_KEY / ALLOW_MOCK_PAY、
 * managerShipOrder 的三个礼赠物流常量（均为 07046714 抽 isNonClientSource 时连带删掉定义）、
 * getShippingRules/defaults.js 的 normalizeExplicitKind / SHIPPING_KIND（2b87b38d 复制规则表时漏抄）、
 * 5 份 inAppMessage 催领模板里作用域外的 `v`。这类错误语法合法、`node --check` 查不出、只在那条分支炸。
 *
 * 判据：
 *  R1 用 TypeScript 绑定器（devDependency，`npm ci --include=dev`）检查小程序与全部云函数的 .js，
 *     每个文件按独立模块处理，出现「找不到名字」（TS 2304 / 2552）即红。
 *     已知例外登记在 BASELINE（逐条写原因）；基线条目不再出现 = 已修好未删，也判红（棘轮）。
 *     typescript 加载不了 = 无法判定 → exit 2（错题本 E16：不得当作通过）。
 *  R2 礼赠催领站内信（gift_nudge_receiver）在各云函数的兜底模板副本必须逐字一致，
 *     且渲染器把 vars 传给 actionUrl（否则链接里的 token 取不到）。这些文件整体不同源（各函数模板子集不同），
 *     不在 check:shared-modules 的家族里，故在此只钉这一段。
 *
 * 用法：
 *   node miniprogram/scripts/check-undefined-names.mjs
 *   node miniprogram/scripts/check-undefined-names.mjs --selftest   （内存注入，不写盘）
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const MP = resolve(HERE, '..')
const TAG = '[check:undefined-names]'
const SKIP = new Set(['node_modules', 'miniprogram_npm', 'scripts', 'docs', 'minitest'])

/** 已知例外：文件 + 名字 + 原因。修好后必须删掉对应条目。 */
const BASELINE = [
  { file: 'miniprogram/subpackages/business/utils/qrcodeGen.js', name: 'define', why: '第三方 UMD 包装：typeof define 判断 AMD 环境，小程序里恒走 CommonJS 分支' },
  { file: 'miniprogram/subpackages/feature/utils/qrcodeGen.js', name: 'define', why: '同上（同一库的另一份分包副本）' }
]

const AMBIENT = [
  'require', 'module', 'exports', 'process', '__dirname', '__filename', 'Buffer', 'global', 'setImmediate', 'clearImmediate',
  'wx', 'getApp', 'Page', 'Component', 'App', 'Behavior', 'getCurrentPages', 'requirePlugin', 'requireMiniProgram'
]
const SHIM = `declare var ${AMBIENT.map((n) => `${n}: any`).join(', ')};\n`

let ts
try {
  ts = createRequire(import.meta.url)('typescript')
} catch (e) {
  console.error(TAG, '✗ 无法加载 typescript（先 npm ci --include=dev）—— 无法判定，不能当作通过')
  process.exit(2)
}

function listJs(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue
    const f = join(dir, e.name)
    if (e.isDirectory()) listJs(f, out)
    else if (e.name.endsWith('.js')) out.push(f)
  }
  return out
}

const FILES = listJs(MP)

/** overrides：{ 仓库相对路径: 文本 } —— 只改内存 */
function scan(overrides = {}) {
  const shim = join(tmpdir(), 'check-undefined-names-shim.d.ts')
  const opts = {
    allowJs: true, checkJs: true, noEmit: true, noResolve: true, skipLibCheck: true, types: [],
    moduleDetection: ts.ModuleDetectionKind.Force, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts']
  }
  const host = ts.createCompilerHost(opts)
  const orig = host.getSourceFile.bind(host)
  host.getSourceFile = (name, lang, ...rest) => {
    const p = resolve(name)
    if (p === shim) return ts.createSourceFile(name, SHIM, lang)
    const rel = relative(ROOT, p)
    if (overrides[rel] !== undefined) return ts.createSourceFile(name, overrides[rel], lang)
    return orig(name, lang, ...rest)
  }
  const program = ts.createProgram([...FILES, shim], opts, host)
  const wanted = new Set(FILES)
  const hits = []
  for (const sf of program.getSourceFiles()) {
    if (!wanted.has(resolve(sf.fileName))) continue
    for (const d of program.getSemanticDiagnostics(sf)) {
      if (d.code !== 2304 && d.code !== 2552) continue
      const { line } = sf.getLineAndCharacterOfPosition(d.start)
      hits.push({ file: relative(ROOT, sf.fileName), line: line + 1, name: sf.text.substr(d.start, d.length) })
    }
  }
  return hits
}

function undefinedErrs(hits) {
  const errs = []
  const key = (f, n) => `${f}|${n}`
  const allowed = new Set(BASELINE.map((b) => key(b.file, b.name)))
  for (const h of hits) {
    if (!allowed.has(key(h.file, h.name))) errs.push(`未定义变量：${h.file}:${h.line} 「${h.name}」（运行到这里会抛 ReferenceError）`)
  }
  const seen = new Set(hits.map((h) => key(h.file, h.name)))
  for (const b of BASELINE) {
    if (!seen.has(key(b.file, b.name))) errs.push(`基线过期：${b.file} 的「${b.name}」已不再报出，请从 BASELINE 删掉这一条（只许变少）`)
  }
  return errs
}

/* ---------- R2 催领模板副本一致 ---------- */
const FN_ROOT = join(MP, 'cloudfunctions')
const NUDGE_FILES = listJs(FN_ROOT)
  .map((p) => relative(ROOT, p))
  .filter((p) => /\/(inAppMessage|messageWrite)\.js$/.test(p))

function nudgeErrs(overrides = {}) {
  const errs = []
  const blocks = {}
  for (const rel of NUDGE_FILES) {
    const text = overrides[rel] !== undefined ? overrides[rel] : readFileSync(join(ROOT, rel), 'utf8')
    const at = text.indexOf('  gift_nudge_receiver: {')
    if (at < 0) continue
    const end = text.indexOf('\n  }', at)
    blocks[rel] = text.slice(at, end)
    if (!/t\.actionUrl\(relatedId, vars\)/.test(text)) errs.push(`${rel}：renderMini 须把 vars 传给 actionUrl（催领链接的 token 来自 vars）`)
  }
  const files = Object.keys(blocks)
  if (files.length < 5) errs.push(`催领兜底模板副本只找到 ${files.length} 份（应 ≥ 5：confirmPayment / makeOrder / manageGift / payCallback / managerShipOrder）`)
  const first = files[0]
  for (const f of files.slice(1)) {
    if (blocks[f] !== blocks[first]) errs.push(`催领兜底模板与 ${first} 不一致：${f}`)
  }
  if (first && !/actionUrl: \(id, v = \{\}\) =>/.test(blocks[first])) errs.push('催领兜底模板 actionUrl 须声明 (id, v = {}) 再读 v.token')
  return errs
}

function collect(overrides) {
  return undefinedErrs(scan(overrides)).concat(nudgeErrs(overrides))
}

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

if (process.argv.includes('--selftest')) {
  const base = collect()
  if (base.length) {
    base.forEach((e) => console.error(TAG, '基线不绿，selftest 无意义：', e))
    process.exit(1)
  }
  const F = {
    refund: 'miniprogram/cloudfunctions/refundOrder/index.js',
    ship: 'miniprogram/cloudfunctions/managerShipOrder/index.js',
    rules: 'miniprogram/cloudfunctions/getShippingRules/defaults.js',
    gift: 'miniprogram/cloudfunctions/manageGift/inAppMessage.js',
    store: 'miniprogram/cloudfunctions/manageStoreShipment/index.js',
    page: 'miniprogram/subpackages/extra/shipment-ops/parts/create.js',
    qr: 'miniprogram/subpackages/business/utils/qrcodeGen.js'
  }
  const cases = [
    ['refundOrder 删常量定义', F.refund, (t) => t.replace(/const ALLOW_MOCK_PAY = [^\n]*\nconst WALLET_INTERNAL_KEY = [^\n]*\n/, ''), /refundOrder\/index\.js:\d+ 「(ALLOW_MOCK_PAY|WALLET_INTERNAL_KEY)」/],
    ['managerShipOrder 删轮询常量', F.ship, (t) => t.replace(/const GIFT_DELIVERY_POLL_LIMIT = 40\n/, ''), /「GIFT_DELIVERY_POLL_LIMIT」/],
    ['运费规则漏抄 SHIPPING_KIND', F.rules, (t) => t.replace(/const SHIPPING_KIND = \{[\s\S]*?\n\}\n/, ''), /defaults\.js:\d+ 「SHIPPING_KIND」/],
    ['催领模板回到作用域外 v', F.gift, (t) => t.replace('actionUrl: (id, v = {}) =>', 'actionUrl: (id) =>'), /inAppMessage\.js:\d+ 「v」/],
    ['出货开单漏解构 storeById', F.store, (t) => t.replace('  storeById,\n  storeIdsForActor,', '  storeIdsForActor,'), /「storeById」/],
    ['页面引用未定义函数', F.page, (t) => t + '\nfunction __probe() { return formatShipmentLine(1) }\n', /create\.js:\d+ 「formatShipmentLine」/],
    ['基线过期未删', F.qr, (t) => t.replace(/\bdefine\b/g, 'globalThis.__noDefine'), /基线过期/],
    ['催领模板副本漂移', F.gift, (t) => t.replace("token=${v.token || ''}", "t=${v.token || ''}"), /催领兜底模板与 .* 不一致|不一致：.*manageGift/],
    ['渲染器不传 vars', F.gift, (t) => t.replace('t.actionUrl(relatedId, vars)', 't.actionUrl(relatedId)'), /须把 vars 传给 actionUrl/]
  ]
  let bad = 0
  const overridesAll = {}
  for (const [name, rel, mutate, expect] of cases) {
    const orig = read(rel)
    const next = mutate(orig)
    if (next === orig) {
      console.error(TAG, `selftest 失败：「${name}」注入未生效（锚点失配）`)
      bad++
      continue
    }
    overridesAll[name] = { [rel]: next }
  }
  // 一次建 program 摊薄耗时：把互不冲突的注入合并（同文件的分开跑）
  const groups = []
  for (const [name, ov] of Object.entries(overridesAll)) {
    const rel = Object.keys(ov)[0]
    let g = groups.find((x) => !(rel in x.ov))
    if (!g) groups.push((g = { ov: {}, names: [] }))
    g.ov[rel] = ov[rel]
    g.names.push(name)
  }
  for (const g of groups) {
    const errs = collect(g.ov)
    for (const name of g.names) {
      const expect = cases.find((c) => c[0] === name)[3]
      if (!errs.some((e) => expect.test(e))) {
        console.error(TAG, `selftest 失败：「${name}」未被检出`)
        bad++
      }
    }
  }
  // 不误报对照：局部变量 / 参数 / 解构 / 全局对象
  const control = read(F.page) + '\nfunction __ok(v) { const { a } = v || {}; return [a, globalThis, JSON, Math.max(1, 2), console, setTimeout, Promise] }\n'
  const ctl = collect({ [F.page]: control })
  if (ctl.length) {
    console.error(TAG, 'selftest 失败：不误报对照被判红', ctl.slice(0, 2))
    bad++
  }
  if (bad) process.exit(1)
  console.log(TAG, `selftest ok（${cases.length} 条注入全部检出 + 1 条不误报对照）`)
  process.exit()
}

const errs = collect()
if (errs.length) {
  errs.forEach((e) => console.error(TAG, e))
  process.exitCode = 1
} else {
  console.log(TAG, `ok（${FILES.length} 个 .js 无未定义变量；基线 ${BASELINE.length} 条；催领兜底模板副本一致）`)
}
