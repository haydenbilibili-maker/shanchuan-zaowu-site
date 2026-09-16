#!/usr/bin/env node
/**
 * 埋点 schema 一致性守卫
 *
 * 为什么需要（2026-09-16 审计发现）：小程序 `utils/analytics/eventSchema.js` 与
 * ERP 镜像 `admin/src/utils/analyticsSchema.js` 长期靠**人工同步**，结果：
 *   - ERP 镜像缺 12 个已登记事件（atlas_* ×7、framer_recruit_* ×3、identify_share_link 等）
 *   - **38 个已在页面触发的事件从未登记**（gift_* 15 个、community_* 7 个等）
 *   - constants.js 缺 `gift_` 前缀 → 15 个礼赠事件全被 inferModule 兜底成 `system`，污染模块分布
 * 后果是「报表里的模块/漏斗口径与真实行为不一致」，而这是**没有人会主动发现**的那类缺陷。
 *
 * 检查项：
 *   A. 小程序 eventSchema 的每个 action 都能在 ERP 镜像找到（同构，防再次漂移）
 *   B. module 常量集合双端一致
 *   C. 代码里实际触发的 action 必须在 eventSchema 登记（防「埋了但报表看不到」）
 *   D. `gift_` 前缀必须映射到 GIFT 模块（防模块分布再次被污染）
 *
 * 用法：
 *   node miniprogram/scripts/check-analytics-schema.mjs
 *   node miniprogram/scripts/check-analytics-schema.mjs --selftest
 * 退出码：有问题为 1。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const MP_SCHEMA = join(ROOT, 'miniprogram/utils/analytics/eventSchema.js')
const MP_CONSTANTS = join(ROOT, 'miniprogram/utils/analytics/constants.js')
const ERP_SCHEMA = join(ROOT, 'admin/src/utils/analyticsSchema.js')
const MP_ROOT = join(ROOT, 'miniprogram')

/** 纯函数：解析形如 `action: { module: MODULE.X, desc: '...' }` 的注册表 */
export function parseEvents(src) {
  const out = new Map()
  for (const m of src.matchAll(
    /^\s{2}([a-z][a-z0-9_]*):\s*\{\s*module:\s*MODULE\.([A-Z_]+),/gm,
  )) {
    out.set(m[1], m[2])
  }
  return out
}

/** 纯函数：解析 MODULE 常量名集合 */
export function parseModules(src) {
  const m = src.match(/const MODULE\s*=\s*\{([\s\S]*?)\n\}/)
  if (!m) return new Set()
  return new Set([...m[1].matchAll(/^\s*([A-Z_]+):\s*'/gm)].map((x) => x[1]))
}

/** 纯函数：解析 action 前缀 → module 映射 */
export function parsePrefixMap(src) {
  return [...src.matchAll(/\['([a-z_]+)',\s*MODULE\.([A-Z_]+)\]/g)].map((m) => ({
    prefix: m[1],
    module: m[2],
  }))
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.') || name === 'miniprogram_npm') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(js|wxml)$/.test(name)) out.push(p)
  }
  return out
}

/** 纯函数：从源码中提取被触发的 action 字面量 */
export function extractTriggered(files) {
  const found = new Map()
  const RE = /(?:trackBehavior|track|trackEvent|logEvent)\s*\(\s*['"]([a-z][a-z0-9_]*)['"]/g
  for (const { path, src } of files) {
    for (const m of src.matchAll(RE)) {
      if (!found.has(m[1])) found.set(m[1], path)
    }
  }
  return found
}

export function checkAll(input) {
  const problems = []
  const { mpEvents, erpEvents, mpModules, erpModules, triggered, prefixes, giftModule } = input

  // A. 同构
  for (const [action] of mpEvents) {
    if (!erpEvents.has(action)) {
      problems.push(`A: ERP 镜像缺少小程序已登记事件 \`${action}\`（报表看不到）`)
    }
  }
  // B. module 常量同构
  for (const m of mpModules) {
    if (!erpModules.has(m)) problems.push(`B: ERP MODULE 缺常量 \`${m}\``)
  }
  for (const m of erpModules) {
    if (!mpModules.has(m)) problems.push(`B: 小程序 MODULE 缺常量 \`${m}\``)
  }
  // C. 触发点必须已登记
  for (const [action, file] of triggered) {
    if (!mpEvents.has(action)) {
      problems.push(`C: 事件 \`${action}\` 已在 ${file} 触发但未登记到 eventSchema（埋了但报表看不到）`)
    }
  }
  // D. gift_ 前缀映射
  const giftPrefix = prefixes.find((p) => p.prefix === 'gift_')
  if (!giftPrefix) problems.push('D: constants.js 缺 `gift_` 前缀映射 → 礼赠事件会被兜底成 system')
  else if (giftModule && giftPrefix.module !== giftModule) {
    problems.push(`D: \`gift_\` 前缀映射到 ${giftPrefix.module}，期望 ${giftModule}`)
  }
  return problems
}

function selftest() {
  const base = {
    mpEvents: new Map([['product_view', 'COMMERCE'], ['gift_pay_click', 'GIFT']]),
    erpEvents: new Map([['product_view', 'COMMERCE'], ['gift_pay_click', 'GIFT']]),
    mpModules: new Set(['COMMERCE', 'GIFT']),
    erpModules: new Set(['COMMERCE', 'GIFT']),
    triggered: new Map([['product_view', 'a.js']]),
    prefixes: [{ prefix: 'gift_', module: 'GIFT' }],
    giftModule: 'GIFT',
  }
  const cases = [
    ['一致时不得报错', base, 0],
    ['ERP 缺事件必须报错', { ...base, erpEvents: new Map([['product_view', 'COMMERCE']]) }, 1],
    ['未登记触发点必须报错', { ...base, triggered: new Map([['telemetry_x', 'b.js']]) }, 1],
    ['缺 gift_ 前缀必须报错', { ...base, prefixes: [] }, 1],
    ['gift_ 映射错模块必须报错', { ...base, prefixes: [{ prefix: 'gift_', module: 'SYSTEM' }] }, 1],
    ['module 常量不同构必须报错', { ...base, erpModules: new Set(['COMMERCE']) }, 1],
  ]
  let failed = 0
  for (const [name, input, want] of cases) {
    const got = checkAll(input).length
    const ok = want === 0 ? got === 0 : got > 0
    if (!ok) failed++
    console.log(`${ok ? '✓' : '✗'} ${name}（期望${want === 0 ? '通过' : '报错'}，实际 ${got} 处）`)
  }
  if (failed) {
    console.error(`\n自检失败 ${failed} 项——守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：守卫能抓到「ERP 缺事件 / 未登记触发点 / 缺前缀 / 模块不同构」')
}

function main() {
  if (process.argv.includes('--selftest')) return selftest()
  for (const p of [MP_SCHEMA, MP_CONSTANTS, ERP_SCHEMA]) {
    if (!existsSync(p)) {
      console.error(`✗ 找不到文件 ${p}`)
      process.exit(1)
    }
  }
  const mpSchemaSrc = readFileSync(MP_SCHEMA, 'utf8')
  const mpConstSrc = readFileSync(MP_CONSTANTS, 'utf8')
  const erpSchemaSrc = readFileSync(ERP_SCHEMA, 'utf8')

  const files = walk(MP_ROOT).map((p) => ({ path: p.replace(`${ROOT}/`, ''), src: readFileSync(p, 'utf8') }))
  const problems = checkAll({
    mpEvents: parseEvents(mpSchemaSrc),
    erpEvents: parseEvents(erpSchemaSrc),
    mpModules: parseModules(mpConstSrc),
    erpModules: parseModules(erpSchemaSrc),
    triggered: extractTriggered(files),
    prefixes: parsePrefixMap(mpConstSrc),
    giftModule: 'GIFT',
  })

  for (const p of problems) console.error(`✗ ${p}`)
  if (problems.length) {
    console.error(`\n埋点 schema 一致性未通过：${problems.length} 处问题`)
    process.exit(1)
  }
  console.log(
    `✓ 埋点 schema 一致（小程序 ${parseEvents(mpSchemaSrc).size} 事件 / ERP ${parseEvents(erpSchemaSrc).size} 事件 / 模块 ${parseModules(mpConstSrc).size} 个）`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
