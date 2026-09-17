/**
 * 尺寸规范化的「跨端同口径」守卫
 *
 * 同一件事（把 sizeL/sizeW/sizeH 拼成规范尺寸串）在三处存在实现，必须逐例一致：
 *   1. 小程序 C 端展示/店长端保存：`miniprogram/utils/skuSize.js`
 *   2. ERP 保存（admin/src/App.vue → `admin/src/utils/sizeCanonical.js`）
 *   3. 云函数入库：`cloudfunctions/manageProducts` 的 trimSizeNumber + 重建
 *
 * 为什么必须钉（2026-09-17 真机反馈两次）：
 *   · ERP 原先手搓 `${L || 0}x${W || 0}x${H || 0} cm` → 没填的维度写成 0，库里出现 `0x0x0 cm`，
 *     C 端把它当有效尺寸显示成「0×0×厚度 0 厘米」；
 *   · 且不去小数尾零 → `21.0` 原样入库并上屏「29.7×21.0×厚度 4.5 厘米」。
 * 三处只要有一处偷懒，脏值就会从那个入口流进库里（本次正是 ERP 这一处）。
 *
 * 用法：
 *   node miniprogram/scripts/check-size-canonical-sync.mjs
 *   node miniprogram/scripts/check-size-canonical-sync.mjs --selftest
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

const MP_UTIL = 'miniprogram/utils/skuSize.js'
const ERP_MODULE = 'admin/src/utils/sizeCanonical.js'
const ERP_VIEW = 'admin/src/App.vue'
const CLOUD = 'miniprogram/cloudfunctions/manageProducts/index.js'

let passed = 0
let failed = 0
const failures = []
function check(name, cond, extra) {
  if (cond) passed += 1
  else {
    failed += 1
    failures.push(`${name}${extra ? ' — ' + extra : ''}`)
  }
}
function eq(name, got, want) {
  check(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}
/** 断言「代码」而不是注释 */
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

function loadCjs(file) {
  const src = readFileSync(resolve(ROOT, file), 'utf8')
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', src)(module, module.exports)
  return module.exports
}

const mp = loadCjs(MP_UTIL)
const erp = await import(pathToFileURL(resolve(ROOT, ERP_MODULE)).href)

const CASES = [
  [['29.7', '21.0', '4.5'], '29.7x21x4.5 cm', '★ 报告里那条数据（21.0 去尾零）'],
  [['', '', ''], '', '全空 → 空串（旧 ERP 会写 0x0x0 cm）'],
  [['20', '30', ''], '20x30 cm', '两维'],
  [['', '30', ''], '30 cm', '只有中间一维'],
  [['29.70', '', ''], '29.7 cm', '尾零'],
  [['20.00', '30.00', '4.50'], '20x30x4.5 cm', '全带尾零'],
  [['0', '0', '0'], '0x0x0 cm', '全零仍按数值拼（由云函数负责清空）'],
  [['A4', '', ''], 'A4 cm', '非数字尺寸原样']
]

/* ── 1) 跨端逐例一致 ─────────────────────────────────────────────────────── */
for (const [args, want, label] of CASES) {
  const a = mp.formatSizeCanonical(...args)
  const b = erp.buildCanonicalSize(...args)
  // 跨端比对用 check（值本身是布尔），诊断信息放在 extra 里
  check(`小程序 ↔ ERP 一致：${label}`, a === b, `小程序=${JSON.stringify(a)} ERP=${JSON.stringify(b)}`)
  eq(`结果符合预期：${label}`, a, want)
}

/* ── 2) 数值归一的边界（两端） ───────────────────────────────────────────── */
for (const [input, want] of [['21.0', '21'], ['4.50', '4.5'], ['20.00', '20'], ['0.0', '0'], ['29.7', '29.7'], ['A4', 'A4'], ['', '']]) {
  eq(`小程序 trimSizeNumber(${JSON.stringify(input)})`, mp.trimSizeNumber(input), want)
  eq(`ERP trimSizeNumber(${JSON.stringify(input)})`, erp.trimSizeNumber(input), want)
}

/* ── 3) 解析口径一致（ERP 表单载入） ─────────────────────────────────────── */
const PARSE_CASES = [
  '29.7×21.0×厚度 4.5 厘米',
  '29.7x21x4.5 cm',
  '29.7×21',
  '直径 8 厘米',
  ''
]
for (const raw of PARSE_CASES) {
  const a = mp.parseSizeParts(raw)
  const b = erp.parseCanonicalSize(raw)
  eq(`解析一致：「${raw || '(空)'}」`,
    JSON.stringify([a.sizeL, a.sizeW, a.sizeH]),
    JSON.stringify([b.sizeL, b.sizeW, b.sizeH]))
}
eq('★ 库里的「29.7×21.0×厚度 4.5 厘米」能被解析成三段（否则 ERP 输入框会塞进「厚度 4.5 厘米」）',
  JSON.stringify(erp.parseCanonicalSize('29.7×21.0×厚度 4.5 厘米')),
  JSON.stringify({ sizeL: '29.7', sizeW: '21.0', sizeH: '4.5' }))

/* ── 4) 接线：三处都别再手搓 ─────────────────────────────────────────────── */
const erpView = stripComments(readFileSync(resolve(ROOT, ERP_VIEW), 'utf8'))
const cloudSrc = stripComments(readFileSync(resolve(ROOT, CLOUD), 'utf8'))

check('★ ERP 保存走共享模块（不再手搓）', /buildCanonicalSize\(form\.value\.sizeL/.test(erpView),
  'App.vue 未调用 buildCanonicalSize')
check('★ ERP 不再出现 `|| 0` 造零写法', !/\|\|\s*0\}\s*x\s*\$\{/.test(erpView),
  '又回到 `${L || 0}x${W || 0}x${H || 0} cm` → 空尺寸会被写成 0x0x0 cm')
check('★ ERP 载入也走共享解析', /parseProductSize = \(sizeStr\) => parseCanonicalSize\(sizeStr\)/.test(erpView),
  'App.vue 又自己解析尺寸串')
check('★ 云函数入库侧有数值归一', /function trimSizeNumber\(/.test(cloudSrc))
check('★ 云函数结构化字段存在时以它为权威重建 size',
  /if \(sizeL \|\| sizeW \|\| sizeH\) \{\s*\n\s*const parts = \[sizeL, sizeW, sizeH\]\.map\(trimSizeNumber\)/.test(cloudSrc),
  '又回到 `if (!size && …)` → 调用方传来的脏 size 会原样入库')

/* ── 输出 / 自检 ─────────────────────────────────────────────────────────── */
if (process.argv.includes('--selftest')) {
  selftest()
} else if (failed) {
  console.log('✗ 尺寸跨端同口径检查失败：')
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`✗ ${failed} 项失败 / ${passed} 项通过`)
  process.exit(1)
} else {
  console.log(`✓ 尺寸跨端同口径：${passed} 项通过（小程序 / ERP / 云函数逐例一致；ERP 不再造 0）`)
}

function selftest() {
  const injections = [
    {
      name: 'ERP 退回 `|| 0` 造零写法',
      file: ERP_VIEW,
      from: '        const sizeStr = buildCanonicalSize(form.value.sizeL, form.value.sizeW, form.value.sizeH)',
      to: '        const sizeStr = `${form.value.sizeL || 0}x${form.value.sizeW || 0}x${form.value.sizeH || 0} cm`'
    },
    {
      name: 'ERP 共享模块丢掉尾零归一',
      file: ERP_MODULE,
      from: "  return s.replace(/\\.?0+$/, '') || '0'",
      to: '  return s'
    },
    {
      name: '小程序展示侧丢掉尾零归一',
      file: MP_UTIL,
      from: "  return s.replace(/\\.?0+$/, '') || '0';",
      to: '  return s;'
    },
    {
      name: '云函数退回「仅在 size 为空时才重建」',
      file: CLOUD,
      from: '  if (sizeL || sizeW || sizeH) {\n    const parts = [sizeL, sizeW, sizeH].map(trimSizeNumber).filter(Boolean)',
      to: '  if (!size && (sizeL || sizeW || sizeH)) {\n    const parts = [sizeL, sizeW, sizeH]'
    }
  ]
  let bad = 0
  for (const inj of injections) {
    const abs = resolve(ROOT, inj.file)
    const orig = readFileSync(abs, 'utf8')
    const hits = orig.split(inj.from).length - 1
    if (hits !== 1) {
      console.log(`✗ 锚点不唯一（命中 ${hits} 次）：${inj.name}`)
      bad += 1
      continue
    }
    writeFileSync(abs, orig.replace(inj.from, inj.to))
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
    writeFileSync(abs, orig)
    if (readFileSync(abs, 'utf8') !== orig) {
      console.log(`✗ 未能逐字还原：${inj.file}`)
      bad += 1
      continue
    }
    if (r.status === 0) {
      console.log(`✗ 注入回归未被检出：${inj.name}`)
      bad += 1
    } else {
      console.log(`  ✓ 已检出：${inj.name}`)
    }
  }
  if (bad) {
    console.log(`✗ 自检失败：${bad} 项`)
    process.exit(1)
  }
  console.log(`✓ 自检通过：${injections.length} 条注入全部被检出、源文件逐字还原`)
}
