#!/usr/bin/env node
/**
 * 店长端「多规格库存」不得静默丢弃 / 不得假成功（2026-09-18 反馈后新增）
 *
 * 反馈原话：「多规格，库存无法编辑」→ 追问后确认：**能输入，但保存后没生效（回到旧值/0）**。
 *
 * 排查结论（真源码执行探针，见提交说明）：
 *   · 客户端 → 云函数 → 写库 这条链路本身是**对的**（`skus[].stock` 有带上、汇总 = Σ）；
 *   · 线上 8 件多规格藏品的 `skus[].stock` 与汇总也**完全自洽**；
 *   · 真正会「静默不生效」的是另外两处：
 *       ① 店长端「批量工具」里的 **统一价/统一库存** 填了却**没点『应用到全部』** →
 *          值被默默丢掉（payload 里仍是旧库存）→ 用户看到「保存后回到旧值」；
 *       ② 云函数 `upsert` 更新时若文档不存在/命中 0 条，`update()` **不报错** →
 *          客户端照样弹「已保存」，实际一个字都没写。
 *
 * 本守卫钉住这四条不变量：
 *   A. 店长端保存前必须把「未落地的统一价/统一库存」应用到全部规格；
 *   B. 店长端保存后必须核对云函数回带的规格库存，不一致要**报错**而不是报成功；
 *   C. 云函数 upsert 的更新路径：文档不存在 → 失败；命中 0 条 → 失败；成功则回带库存口径；
 *   D. 规格库存合计必须随「逐规格改库存 / 批量套用」刷新（改没改进去要当场可见）。
 *
 * 用法：
 *   node miniprogram/scripts/check-manager-sku-stock.mjs
 *   node miniprogram/scripts/check-manager-sku-stock.mjs --selftest
 * 退出码：任一条不成立为 1。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const MANAGER = 'miniprogram/subpackages/manager/manager/managerPageConfig.js'
const CLOUD_FN = 'miniprogram/cloudfunctions/manageProducts/index.js'

export function stripComments(src) {
  return String(src || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** A. 保存前落地未应用的批量输入 */
export function checkSubmitAppliesBulk(managerSrc) {
  const code = stripComments(managerSrc)
  const problems = []
  if (!/bulkApplied = true/.test(code)) {
    problems.push(`${MANAGER}：submitProduct 没有把「统一价/统一库存」落地（缺少 bulkApplied = true）—— 填了不点按钮就会静默丢值`)
  }
  if (!/p\.skus = rows/.test(code)) {
    problems.push(`${MANAGER}：submitProduct 未把批量输入写回规格行（缺少 p.skus = rows）—— 统一值会被静默丢弃`)
  }
  return problems
}

/** B. 保存后核对回带库存 */
export function checkClientVerifiesEcho(managerSrc) {
  const code = stripComments(managerSrc)
  const problems = []
  if (!/result\.skus/.test(code)) {
    problems.push(`${MANAGER}：保存后没有核对云函数回带的规格库存（result.skus）—— 写没写进去无从发现`)
  }
  if (!/STOCK_NOT_APPLIED/.test(code)) {
    problems.push(`${MANAGER}：库存回带不一致时没有明确失败码（STOCK_NOT_APPLIED）—— 会退化成「假成功」`)
  }
  return problems
}

/** C. 云函数：不存在 / 0 命中 都要失败；成功回带口径 */
export function checkCloudFnWriteVerify(fnSrc) {
  const code = stripComments(fnSrc)
  const problems = []
  if (!/docMissing/.test(code) || !/'NOT_FOUND'/.test(code)) {
    problems.push(`${CLOUD_FN}：upsert 更新路径没有对「文档不存在」报失败 —— update 命中 0 条也不报错，就是假成功`)
  }
  if (!/updated === 0/.test(code) || !/'NOT_APPLIED'/.test(code)) {
    problems.push(`${CLOUD_FN}：upsert 更新路径没有对「命中 0 条」报失败（NOT_APPLIED）`)
  }
  if (!/skus: Array\.isArray\(data\.skus\)/.test(code)) {
    problems.push(`${CLOUD_FN}：upsert 成功结果没有回带规格库存口径，客户端无法核对`)
  }
  return problems
}

/** D. 合计随改库存的入口刷新 */
export function checkTotalRefresh(managerSrc) {
  const code = stripComments(managerSrc)
  const problems = []
  if (!/refreshSkuStockTotal\(\)/.test(code)) {
    problems.push(`${MANAGER}：缺少 refreshSkuStockTotal（规格库存合计不可见）`)
  }
  if (!/if \(field === 'stock'\) this\.refreshSkuStockTotal\(\)/.test(code)) {
    problems.push(`${MANAGER}：逐规格改库存后没有刷新合计 —— 店长看不出「改没改进去」`)
  }
  if (!/applySkuBulkFields[\s\S]{0,600}?refreshSkuStockTotal\(\)/.test(code)) {
    problems.push(`${MANAGER}：批量套用后没有刷新合计`)
  }
  return problems
}

export function scan() {
  const managerSrc = readFileSync(join(ROOT, MANAGER), 'utf8')
  const fnSrc = readFileSync(join(ROOT, CLOUD_FN), 'utf8')
  return [
    ...checkSubmitAppliesBulk(managerSrc),
    ...checkClientVerifiesEcho(managerSrc),
    ...checkCloudFnWriteVerify(fnSrc),
    ...checkTotalRefresh(managerSrc)
  ]
}

function selftest() {
  let bad = 0
  const say = (n) => console.log(`  ✓ ${n}`)
  const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

  const base = scan()
  if (base.length) {
    console.error('✗ 基线就有问题，先修再谈自检：')
    base.forEach((p) => console.error('  - ' + p))
    process.exit(1)
  }
  say('基线：四条不变量全部成立')

  const probes = [
    {
      name: '★ 保存前不落地批量库存被检出',
      file: MANAGER,
      mutate: (s) => s.replace(/let bulkApplied = false[\s\S]*?^\s*}\n/m, ''),
      want: /bulkApplied|静默丢值/
    },
    {
      name: '★ 客户端不核对回带库存被检出',
      file: MANAGER,
      mutate: (s) => s.replace(/result\.skus/g, 'result.__none__'),
      want: /回带/
    },
    {
      name: '★ 云函数 0 命中不报失败被检出',
      file: CLOUD_FN,
      mutate: (s) => s.replace('updated === 0', 'updated <= -1'),
      want: /命中 0 条/
    },
    {
      name: '★ 逐规格改库存后不刷合计被检出',
      file: MANAGER,
      mutate: (s) => s.replace("if (field === 'stock') this.refreshSkuStockTotal()", '/* 合计不刷 */'),
      want: /合计/
    }
  ]

  for (const probe of probes) {
    const abs = join(ROOT, probe.file)
    const before = readFileSync(abs)
    const digest = sha(abs)
    let detected = false
    try {
      const mutated = probe.mutate(before.toString())
      if (mutated === before.toString()) {
        console.error(`  ✗ ${probe.name}（注入锚点没匹配上，自检失效）`)
        bad += 1
        continue
      }
      writeFileSync(abs, mutated)
      detected = scan().some((p) => probe.want.test(p))
    } finally {
      writeFileSync(abs, before)
    }
    if (sha(abs) !== digest) {
      console.error(`  ✗ ${probe.name}（还原后字节不一致）`)
      bad += 1
      continue
    }
    if (!detected) {
      console.error(`  ✗ ${probe.name}`)
      bad += 1
    } else say(probe.name)
  }

  if (bad) {
    console.error(`\n自检失败 ${bad} 项——守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：批量值不落地、不核对回带、0 命中假成功、合计不刷新 都能被检出，且还原字节一致')
}

if (process.argv.includes('--selftest')) {
  selftest()
} else {
  const problems = scan()
  for (const p of problems) console.error(`✗ ${p}`)
  if (problems.length) {
    console.error(`\n店长端多规格库存不变量未通过：${problems.length} 处`)
    process.exit(1)
  }
  console.log('✓ 店长端多规格库存不变量通过（批量值会落地 / 保存后核对回带 / 云函数不假成功 / 合计可见）')
}
