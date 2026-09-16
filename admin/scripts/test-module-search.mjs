#!/usr/bin/env node
/**
 * 命令面板「同一屏两行」回归测试（审计 P2）
 *
 * 背景：32 个「已并入 X」的旧模块仍留在 MODULES 里（保留搜索别名），而 `searchModules`
 * 搜索全部条目 → 命令面板对**同一屏给出两行**。实测搜「积分」曾返回 5 条，其中
 * `15 门店积分规则`（别名 → 6）与 `6 权益与营销`（Hub）指向同一屏。
 *
 * 修法：`resolveModuleTarget()` 把别名解析到 Hub，`dedupeByTarget()` 对同一落点只保留
 * 得分最高的一条，并把落点写进 `_aliasTargetName` 供面板提示「并入 X」。
 *
 * 用法：
 *   node admin/scripts/test-module-search.mjs
 *   node admin/scripts/test-module-search.mjs --selftest   # 证明去掉去重会失败
 */
'use strict'

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REGISTRY = resolve(HERE, '..', 'src', 'utils', 'modulesRegistry.js')
const TMP = resolve(HERE, '..', 'src', 'utils', '__selftest_nodedupe.js')
const ALIASES = resolve(HERE, '..', 'src', 'utils', 'moduleAliases.js')

/** 这些查询都必须「无重复落点」，且仍能命中目标屏 */
const QUERIES = ['积分', '会员', '礼赠', '首页', '行为', '预约', '大屏', '门店', '等级', 'a', '']

/** [id, 期望解析到的落点] */
const TARGET_CASES = [
  ['15', '6'],
  ['45', '4'],
  ['8', '13'],
  ['62', '13'],
  ['23', '44'],
  ['49', '26'],
  ['65', '65'], // 非别名：解析到自身
  ['0', '0'],
  ['', '']
]

async function loadRegistry(path) {
  // 临时副本与真实文件同目录，因此其内部相对 import 仍然成立
  return import(`file://${path}?t=${Date.now()}`)
}

export async function runChecks(registryPath) {
  const mod = await loadRegistry(registryPath)
  const { MODULES, searchModules, resolveModuleTarget } = mod
  // 别名映射直接读它自己的源（不从注册表再导出，避免为测试扩大 API）
  const { MODULE_ALIASES } = await import(`file://${ALIASES}?t=${Date.now()}`)
  const failures = []
  let pass = 0
  const check = (name, cond, detail) => {
    if (cond) pass += 1
    else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  }

  // 1) 落点解析
  TARGET_CASES.forEach(([id, want]) => {
    const got = resolveModuleTarget(id)
    check(`resolveModuleTarget('${id}') === '${want}'`, got === want, `实际 ${got}`)
  })

  // 2) 别名确实指向已注册的 Hub（避免别名指向不存在的模块）
  Object.entries(MODULE_ALIASES).forEach(([from, meta]) => {
    const hub = String(meta.hub)
    check(`别名 ${from} 的 Hub ${hub} 已注册`, !!mod.MODULES_BY_ID[hub])
  })

  // 3) 核心：任何查询都不得出现重复落点
  QUERIES.forEach((q) => {
    const rows = searchModules(q, 50)
    const targets = rows.map((r) => resolveModuleTarget(r.id))
    const dup = targets.filter((t, i) => targets.indexOf(t) !== i)
    check(
      `查询「${q}」无重复落点`,
      dup.length === 0,
      `重复落点 ${[...new Set(dup)].join(',')}（结果 ${rows.length} 条）`
    )
  })

  // 4) 去重不能把功能删掉：旧名仍必须能搜到该屏
  const legacy = [
    ['门店积分规则', '6'],
    ['礼赠运营配置', '6'],
    ['荣誉馆长', '4'],
    ['人群包', '4'],
    ['用户画像', '4'],
    ['首页轮播', '13'],
    ['经营数据大屏', '26']
  ]
  legacy.forEach(([q, target]) => {
    const rows = searchModules(q, 50)
    const hit = rows.some((r) => resolveModuleTarget(r.id) === target)
    check(`旧名「${q}」仍能命中 Hub ${target}`, hit, `结果：${rows.map((r) => r.id).join(',') || '(空)'}`)
  })

  // 5) 别名行必须带落点提示（面板据此渲染「并入 X」）
  const aliasRows = searchModules('积分', 50).filter((r) => resolveModuleTarget(r.id) !== String(r.id))
  check('别名结果带 _aliasTargetName', aliasRows.every((r) => !!r._aliasTargetName))

  return { failures, pass, total: MODULES.length }
}

if (process.argv.includes('--selftest')) {
  console.log('自检：去掉 dedupeByTarget 去重，测试必须因「重复落点」失败\n')
  const src = readFileSync(REGISTRY, 'utf8')
  // 让去重变成恒等（保留全部结果）
  const mutated = src
    .replace('  return [...best.values()].map((r) => {', '  return results.map((r) => {')
  let detected = false
  let reason = ''
  try {
    if (mutated === src) throw new Error('未能构造「无去重」版本（锚点未命中）')
    writeFileSync(TMP, mutated, 'utf8')
    const { failures } = await runChecks(TMP)
    detected = failures.some((f) => /无重复落点/.test(f))
    reason = failures.find((f) => /无重复落点/.test(f)) || failures[0] || ''
  } catch (e) {
    console.log(`✗ 自检构造失败（不算有效检出）：${e.message}`)
  } finally {
    try { unlinkSync(TMP) } catch { /* ignore */ }
  }
  console.log(`${detected ? '✓' : '✗'} 无去重版本 → ${detected ? '已检出' : '【漏检】'}`)
  if (reason) console.log(`    · ${reason}`)
  console.log()
  if (!detected) {
    console.error('自检失败：去重被去掉却没抓到，测试不可信。')
    process.exit(1)
  }
  console.log('自检通过：去掉去重会因「重复落点」失败。\n')
}

const { failures, pass, total } = await runChecks(REGISTRY)
console.log(`命令面板去重测试：${pass} 项通过，${failures.length} 项失败（注册表 ${total} 个模块）`)
if (failures.length) {
  console.error('\n失败明细：')
  failures.forEach((f) => console.error(`  ✗ ${f}`))
  process.exit(1)
}
console.log('全部通过：别名解析正确、任何查询都无重复落点、旧名仍能命中、别名行带落点提示。')
