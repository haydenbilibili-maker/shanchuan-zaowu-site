#!/usr/bin/env node
/**
 * 亮码二维码「不得静默失败」守卫（2026-09-18 真机事故后新增）
 *
 * 事故现场（产品负责人真机截图）：礼券夹 →「到店亮码」弹层里**二维码一片空白**，
 * 而编号 MT-VEIT-1JUY 与 58s 倒计时都在，**没有任何报错、也没有重试入口**。
 *
 * 真因（两层，缺一不可）：
 *   ① `subpackages/business/components/WalletPanelCoupons/index.js` 里写的是
 *      `require.async('../utils/qrCanvas.js')` —— 该路径解析到**不存在的**
 *      `subpackages/business/components/utils/qrCanvas.js`（少退一层；正确是 `../../utils/qrCanvas`，
 *      同目录兄弟组件 WalletPanelPoints 用的就是它）→ 模块加载必然失败；
 *   ② 失败后的 `.catch()` **只重试、不置失败态**，重试 4 次后彻底静默。
 *   另有一层系统性隐患：`qrCanvas.js` 用 `new Promise(async (resolve) => …)` 包裹绘制，
 *   异步 executor 里任何抛错都会被吞掉 → Promise 永不 settle → 上层「重试 + 失败提示」永远不触发。
 *
 * 本守卫钉住三件事（都属于「不变量」，不是「实现细节」）：
 *   A. 绘制器**必须始终 settle**：有兜底超时、失败 resolve(false)、不得用 async executor、
 *      画完要**回读像素**（防「画到已分离节点却返回成功」——那同样是空白）；
 *   B. 亮码入口**必须有可见失败态**（文案 + 重试），不得只重试不报错；
 *   C. **同一分包内不得用 `require.async`**（异步加载是给跨包用的，同包写它只会引入加载竞态；
 *      事故就是这类写法）。
 *
 * 用法：
 *   node miniprogram/scripts/check-qr-draw.mjs
 *   node miniprogram/scripts/check-qr-draw.mjs --selftest
 * 退出码：任一条不成立为 1。
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const MP = join(ROOT, 'miniprogram')

const QR_CANVAS = 'subpackages/business/utils/qrCanvas.js'
/** 亮码入口：必须把「绘制失败」变成用户能看见的东西 */
const PASS_ENTRIES = [
  'subpackages/business/components/WalletPanelCoupons/index.js',
  'pages/user/index.js'
]
/** 失败态文案：wxml 的 error 分支就是靠它与重试入口渲染出来的 */
const FAIL_TEXT = '二维码绘制失败'
const SKIP_DIRS = new Set(['node_modules', 'cloudfunctions', 'scripts', 'docs', 'miniprogram_npm', '.git'])

export function stripComments(src) {
  return String(src || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** 纯函数：绘制器必须始终 settle + 必须能发现「画了但没落墨」 */
export function checkQrCanvasSource(src) {
  const code = stripComments(src)
  const problems = []
  if (/new\s+Promise\s*\(\s*async/.test(code)) {
    problems.push(`${QR_CANVAS}：用了 new Promise(async …) —— 异步 executor 抛错会被吞掉、Promise 永不 settle（调用方的重试与失败提示全部失效）`)
  }
  if (!/setTimeout\s*\(/.test(code)) {
    problems.push(`${QR_CANVAS}：缺少兜底超时 —— 选择器查询不回调时会永远挂着，界面就是空白框`)
  }
  if (!/resolve\s*\(\s*false\s*\)/.test(code)) {
    problems.push(`${QR_CANVAS}：失败路径没有 resolve(false) —— 失败无法被调用方感知`)
  }
  if (!/getImageData/.test(code)) {
    problems.push(`${QR_CANVAS}：没有回读像素 —— 画到已分离/未布局的 canvas 节点时会误报成功，界面仍是空白`)
  }
  return problems
}

/** 纯函数：亮码入口必须有可见失败态 + 有限次重试 */
export function checkPassEntrySource(rel, src) {
  const code = stripComments(src)
  const problems = []
  if (!code.includes(FAIL_TEXT)) {
    problems.push(`${rel}：没有「${FAIL_TEXT}」失败态 —— 绘制失败时用户只会看到空白，且无重试入口`)
  }
  if (!/attempt\s*<\s*\w+/.test(code)) {
    problems.push(`${rel}：重试没有上限常量（应写成 attempt < XXX_MAX）—— 无限重试或零重试都不可接受`)
  }
  return problems
}

/** 纯函数：取出一段源码里所有 require.async 的相对路径（允许跨行） */
export function collectAsyncRequires(src) {
  const out = []
  for (const m of stripComments(src).matchAll(/require\s*\.\s*async\s*\(\s*['"](\.[^'"]+)['"]/g)) {
    out.push(m[1])
  }
  return out
}

/** 文件属于哪个分包；主包返回 '' */
export function subpackageOf(abs) {
  const rel = relative(MP, abs).replace(/\\/g, '/')
  const m = rel.match(/^subpackages\/([^/]+)\//)
  return m ? m[1] : ''
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.js')) out.push(p)
  }
  return out
}

export function scan(files = walk(MP)) {
  const problems = []
  problems.push(...checkQrCanvasSource(readFileSync(join(MP, QR_CANVAS), 'utf8')))
  for (const rel of PASS_ENTRIES) {
    problems.push(...checkPassEntrySource(rel, readFileSync(join(MP, rel), 'utf8')))
  }
  // C. 同分包内不得 require.async（跨包才允许）
  for (const f of files) {
    const from = subpackageOf(f)
    if (!from) continue // 主包 → 分包 正是分包异步化的用途
    for (const spec of collectAsyncRequires(readFileSync(f, 'utf8'))) {
      const target = resolve(dirname(f), spec)
      if (subpackageOf(target) === from) {
        problems.push(
          `${relative(ROOT, f).replace(/\\/g, '/')}：同分包（${from}）内用了 require.async('${spec}') —— 同包请用同步 require`
        )
      }
    }
  }
  return problems
}

function selftest() {
  let bad = 0
  const t = (name, ok) => {
    if (!ok) bad += 1
    console.error(`  ✗ ${name}`)
  }
  const say = (name) => console.log(`  ✓ ${name}`)
  const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

  const base = scan()
  if (base.length) {
    console.error('✗ 基线就有问题，先修再谈自检：')
    base.forEach((p) => console.error('  - ' + p))
    process.exit(1)
  }
  say('基线：亮码绘制不变量全部成立')

  const probes = [
    {
      name: '★ 同分包 require.async 被检出（事故写法，跨行）',
      file: join(MP, PASS_ENTRIES[0]),
      mutate: (s) => s.replace("const { drawMemberQr } = require('../../utils/qrCanvas')",
        "const { drawMemberQr } = require\n  .async('../utils/qrCanvas.js')\n  .then((m) => m.drawMemberQr)"),
      want: /同分包/
    },
    {
      name: '★ 绘制器缺兜底超时被检出',
      file: join(MP, QR_CANVAS),
      mutate: (s) => s.replace("timer = setTimeout(() => finish(false), DRAW_TIMEOUT_MS)", "/* 超时被删 */"),
      want: /兜底超时/
    },
    {
      name: '★ 绘制器用 new Promise(async …) 被检出',
      file: join(MP, QR_CANVAS),
      mutate: (s) => s.replace('return new Promise((resolve) => {', 'return new Promise(async (resolve) => {'),
      want: /new Promise\(async/
    },
    {
      name: '★ 亮码入口丢失败态被检出',
      file: join(MP, PASS_ENTRIES[0]),
      mutate: (s) => s.replace(/二维码绘制失败，可出示下方编号/g, '稍后重试'),
      want: /失败态/
    }
  ]

  for (const probe of probes) {
    const before = readFileSync(probe.file)
    const digest = sha(probe.file)
    let detected = false
    try {
      const mutated = probe.mutate(before.toString())
      if (mutated === before.toString()) {
        console.error(`  ✗ ${probe.name}（注入锚点没匹配上，自检本身失效）`)
        bad += 1
        continue
      }
      writeFileSync(probe.file, mutated)
      detected = scan().some((p) => probe.want.test(p))
    } finally {
      writeFileSync(probe.file, before)
    }
    if (sha(probe.file) !== digest) {
      console.error(`  ✗ ${probe.name}（还原后字节不一致）`)
      bad += 1
      continue
    }
    if (!detected) {
      console.error(`  ✗ ${probe.name}`)
      bad += 1
    } else {
      say(probe.name)
    }
  }

  if (bad) {
    console.error(`\n自检失败 ${bad} 项——守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：同分包 async require、缺超时、async executor、丢失败态 都能被检出，且还原字节一致')
}

if (process.argv.includes('--selftest')) {
  selftest()
} else {
  const problems = scan()
  for (const p of problems) console.error(`✗ ${p}`)
  if (problems.length) {
    console.error(`\n亮码二维码不变量未通过：${problems.length} 处`)
    console.error('  背景：2026-09-18 礼券「到店亮码」真机空白事故（路径写错 + 失败不报错 + Promise 永不 settle）')
    process.exit(1)
  }
  console.log('✓ 亮码二维码不变量通过（绘制器始终 settle + 回读像素；入口失败可见；无同分包 require.async）')
}
