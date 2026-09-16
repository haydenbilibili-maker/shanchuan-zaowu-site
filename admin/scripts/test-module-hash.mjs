#!/usr/bin/env node
/**
 * 模块深链格式契约测试（审计 §0 P0-16）
 *
 * 为什么只测这一层：`#/m/<id>` 的**格式解析/生成**是最容易写错、最容易回归的部分；
 * 剩下的 DOM 接线（watch / hashchange / replaceState）只能在浏览器里验证，
 * 无法在这里覆盖 —— 这一点已在测试末尾显式声明，不假装全覆盖。
 *
 * 关键边界：必须**严格匹配**，否则 `#/m/42/extra` 会被解析成 `42/extra`，
 * 进而把非法 id 写进 currentTab，触发「未注册 tab 静默回退驾驶舱」（审计 P2）。
 *
 * 用法：
 *   node admin/scripts/test-module-hash.mjs
 *   node admin/scripts/test-module-hash.mjs --selftest   # 证明宽松正则会失败
 */
'use strict'

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MODULE_PATH = resolve(HERE, '..', 'src', 'utils', 'moduleHash.js')
const TMP_PATH = resolve(HERE, '..', 'src', 'utils', '__selftest_loose_hash.js')

/** [hash, 期望解析结果] —— 期望为空串的都是「不是模块深链」 */
const PARSE_CASES = [
  ['#/m/42', '42'],
  ['#/m/0', '0'],
  ['#/m/nav-business', 'nav-business'],
  ['#/m/nav-miniapp', 'nav-miniapp'],
  ['#/m/1-2', '1-2'],
  ['#/m/c9', 'c9'],
  // 非模块深链：必须一律为空
  ['#admin', ''],
  ['#brand', ''],
  ['#/brand-b', ''],
  ['', ''],
  [undefined, ''],
  [null, ''],
  ['#', ''],
  ['#/m/', ''],
  ['#/m', ''],
  ['#/m/42/extra', ''],       // 严格：多一段就不认（否则非法 id 会进 currentTab）
  ['#/m/42?x=1', ''],
  ['#/M/42', ''],             // 大小写敏感
  ['#/m/4 2', ''],            // 不允许空格
  ['#/m/中文', '']            // 不允许非 ASCII
]

/** [id, 期望生成的 hash] */
const BUILD_CASES = [
  ['42', '#/m/42'],
  ['nav-customer', '#/m/nav-customer'],
  [' 7 ', '#/m/7'],   // 去空格
  ['', ''],
  [null, ''],
  [undefined, '']
]

function assert(cond, msg, failures, state) {
  if (cond) state.pass += 1
  else failures.push(msg)
}

async function runSuite(modulePath) {
  const mod = await import(`file://${modulePath}?t=${Date.now()}`)
  const { parseModuleHash, buildModuleHash } = mod
  const failures = []
  const state = { pass: 0 }

  for (const [hash, want] of PARSE_CASES) {
    const got = parseModuleHash(hash)
    assert(got === want, `parseModuleHash(${JSON.stringify(hash)}) 期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`, failures, state)
  }
  for (const [id, want] of BUILD_CASES) {
    const got = buildModuleHash(id)
    assert(got === want, `buildModuleHash(${JSON.stringify(id)}) 期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`, failures, state)
  }
  // 往返一致
  for (const id of ['42', 'nav-business', '0']) {
    assert(parseModuleHash(buildModuleHash(id)) === id, `往返不一致：${id}`, failures, state)
  }
  // 前缀契约
  assert(mod.MODULE_HASH_PREFIX === '#/m/', `MODULE_HASH_PREFIX 应为 '#/m/'，实际 ${JSON.stringify(mod.MODULE_HASH_PREFIX)}`, failures, state)

  return { failures, pass: state.pass }
}

if (process.argv.includes('--selftest')) {
  console.log('自检：把严格正则改成宽松（/^#\\/m\\/(.+)$/），测试必须失败\n')
  const src = readFileSync(MODULE_PATH, 'utf8')
  const loose = src.replace(
    'const MODULE_HASH_RE = /^#\\/m\\/([A-Za-z0-9_-]+)$/',
    'const MODULE_HASH_RE = /^#\\/m\\/(.+)$/'
  )
  let detected = false
  let reason = ''
  try {
    if (loose === src) throw new Error('未能构造宽松版本（正则锚点未命中）')
    writeFileSync(TMP_PATH, loose, 'utf8')
    const { failures } = await runSuite(TMP_PATH)
    detected = failures.length > 0
    reason = failures[0] || ''
  } catch (e) {
    console.log(`✗ 自检构造失败（不算有效检出）：${e.message}`)
  } finally {
    try { unlinkSync(TMP_PATH) } catch { /* ignore */ }
  }
  console.log(`${detected ? '✓' : '✗'} 宽松正则 → ${detected ? '已检出' : '【漏检】'}`)
  if (detected) console.log(`    · ${reason}`)
  console.log()
  if (!detected) {
    console.error('自检失败：宽松正则没被抓到，说明边界用例无效。')
    process.exit(1)
  }
  console.log('自检通过：宽松正则会因非法 hash 边界用例而失败。\n')
}

const { failures, pass } = await runSuite(MODULE_PATH)
console.log(`模块深链格式测试：${pass} 项通过，${failures.length} 项失败`)
if (failures.length) {
  console.error('\n失败明细：')
  failures.forEach((f) => console.error(`  ✗ ${f}`))
  process.exit(1)
}
console.log('全部通过：解析严格、生成去空格、往返一致、前缀契约固定。')
console.log('\n注意：本测试只覆盖 format 层。App.vue 里的 watch / hashchange / replaceState')
console.log('接线已由浏览器 DOM 守卫覆盖：`npm run dev:admin` 后执行 `npm run check:nav-dom`。')
