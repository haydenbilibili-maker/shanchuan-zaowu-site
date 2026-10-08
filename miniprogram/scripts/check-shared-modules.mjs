#!/usr/bin/env node
/**
 * 真共享模块的副本一致性守卫
 *
 * 为什么需要（2026-09-16 实测盘点）：
 *   云函数之间不能跨目录 require，于是共享模块按仓库惯例**逐函数留副本**。
 *   盘点发现 6 个**真共享**家族共 **93 份副本**没有任何守卫保证一致：
 *
 *     staffGuard.js      56 份   ← 授权层！仓库历史事故正是「29 个函数的 staffGuard 缺少股东角色」
 *     approvalRules.js    9 份
 *     approvalBridge.js   9 份
 *     auditLog.js         8 份
 *     pointsBalance.js    6 份
 *     contentSecurity.js  5 份
 *
 *   另有 5 个家族**已有** `--check` 守卫（orderSummary / sourceOrigin / speciesDedupKey /
 *   workOrderNotify / welcomeGift），本脚本不重复覆盖。
 *
 * 为什么不能简单要求「全部逐字相同」——盘点查出两个**有意分歧**，必须显式登记，
 * 否则后来者会「顺手统一」而改坏语义：
 *
 *   1. `memberLevels.js`：`makeOrder` 是**超集**（6 份通用 + 3 个下单期预估定级导出）。
 *      语义正确 —— 只有下单需要「本单预估升档」，会员卡/CRM 不需要。
 *      → 用「真源行必须原样按序出现（允许插入）」判定；共享部分被改动即失败。
 *   2. `refundPolicy.js`：2 份**同名不同模块**（`refundOrder` 算退款金额；
 *      `makeOrder` 下单时快照规则）。同名是历史巧合，不是漂移。
 *      → 明确排除，并在此登记原因。
 *
 * 用法：
 *   node miniprogram/scripts/check-shared-modules.mjs
 *   node miniprogram/scripts/check-shared-modules.mjs --json
 *   node miniprogram/scripts/check-shared-modules.mjs --selftest
 * 退出码：存在不一致为 1。
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const FN_ROOT = join(ROOT, 'miniprogram', 'cloudfunctions')

/**
 * 家族定义。
 *   kind: 'identical' → 所有副本必须与 canonical 逐字节相同
 *         'superset'  → canonical 的每一行必须原样按序出现在副本中（允许插入）
 *   canonical 必须是其中一个副本（不能是「不存在于云函数里的第三方路径」）
 */
export const FAMILIES = [
  { module: 'staffGuard.js', kind: 'identical', canonical: 'manageStaff/staffGuard.js',
    why: '授权层：56 份副本，历史事故就出在这里（部分函数缺股东角色导致授权落后）' },
  { module: 'approvalRules.js', kind: 'identical', canonical: 'manageApprovals/approvalRules.js',
    why: '审批规则：各函数判定「谁该审」必须同口径' },
  { module: 'approvalBridge.js', kind: 'identical', canonical: 'manageApprovals/approvalBridge.js',
    why: '审批桥接：入队字段与通知挂钩点必须同口径' },
  { module: 'auditLog.js', kind: 'identical', canonical: 'manageStaff/auditLog.js',
    why: '审计留痕：字段结构不一致会让台账缺列' },
  { module: 'pointsBalance.js', kind: 'identical', canonical: 'getPointRecords/pointsBalance.js',
    why: '积分余额：读写口径不一致会算错可用积分' },
  { module: 'contentSecurity.js', kind: 'identical', canonical: 'submitCommunityPost/contentSecurity.js',
    why: '内容安全：各入口检测口径不一致会漏检' },
  { module: 'memberLevels.js', kind: 'superset', canonical: 'manageMemberLevels/memberLevels.js',
    why: 'makeOrder 为超集（多 3 个下单期预估定级导出），共享部分仍须一致' },
  { module: 'settlementNotify.js', kind: 'identical', canonical: 'manageStudioSettlement/settlementNotify.js',
    why: '出货结算通知：出货单生成（manageStoreShipment）与账单状态变更（manageStudioSettlement）两边都要解析同一批收件人（超管 + **指定门店**店长）；各写一份必然出现「一边通知了店长、另一边只通知超管」' },
  { module: 'pricingCore.js', kind: 'identical', canonical: 'manageStoreShipment/pricingCore.js',
    why: '出货算价内核：价目表**写入方**（manageStudioSettlement）与**算价方**（manageStoreShipment）必须同口径归一化 —— 一边把「大蓝闪 蝶」与「大蓝闪蝶」当两个材料、另一边当一个，就会静默算错价' },
  { module: 'categorySeed.js', kind: 'identical', canonical: 'seedCategories/categorySeed.js',
    why: '分类种子与一级馆别名：listCategories 原先跨目录 require 这份文件，部署包里没有 → 线上每次调用都崩（2026-09-29）；改为本目录副本后两边的馆名/别名口径必须一致' },
  { module: 'giftMeta.js', kind: 'identical', canonical: 'manageGift/giftMeta.js',
    why: '礼赠元数据（状态判定 / 礼笺字数 / 商品快照 / 地址脱敏）：5 份副本（manageGift 真源 + makeOrder / confirmPayment / payCallback / managerShipOrder）；曾出现 3 种内容（缺 protectionType 快照、缺 maskAddress、注释路径未跟 giftShareCard 搬家）—— 口径必须一致，否则下单写的 giftMeta 与履约读的不一致' }
]

/** 有意分歧、**不纳入本守卫**的家族（登记原因，防后来者「顺手统一」） */
export const INTENTIONAL_DIVERGENCE = [
  { module: 'refundPolicy.js', copies: 2,
    why: '同名不同模块：refundOrder=算退款金额；makeOrder=下单时快照退款规则。不是漂移。' }
]

/** 已被其它守卫覆盖的家族（避免重复造轮子） */
export const COVERED_ELSEWHERE = [
  'orderSummary.js（check:order-summary）',
  'sourceOrigin.js（check:source-origin）',
  'speciesDedupKey.js（check:sync-species-dedup）',
  'workOrderNotify.js（check:work-order-notify）'
]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/** 找出某模块名在各云函数下的全部副本 */
export function findCopies(moduleName) {
  if (!existsSync(FN_ROOT)) return []
  return walk(FN_ROOT)
    .filter((p) => p.endsWith(`/${moduleName}`))
    .map((p) => relative(FN_ROOT, p).replace(/\\/g, '/'))
    .sort()
}

/** 纯函数：canonical 的所有行是否按序出现在 copy 中（允许插入） */
export function isOrderedSubset(canonicalLines, copyLines) {
  let i = 0
  for (const line of copyLines) {
    if (i < canonicalLines.length && line === canonicalLines[i]) i += 1
  }
  return i === canonicalLines.length
}

/** 纯函数：单个家族的检查结果 */
export function checkFamily(fam, copies, readText) {
  const problems = []
  if (!copies.length) {
    return { module: fam.module, copies: 0, problems: [`找不到任何 ${fam.module} 副本（家族定义已过期？）`] }
  }
  if (copies.indexOf(fam.canonical) === -1) {
    return { module: fam.module, copies: copies.length, problems: [`canonical 不在副本列表中：${fam.canonical}`] }
  }
  const canonicalText = readText(fam.canonical)
  const canonicalLines = canonicalText.split('\n')
  for (const c of copies) {
    if (c === fam.canonical) continue
    const text = readText(c)
    if (fam.kind === 'identical') {
      if (text !== canonicalText) problems.push(`${c} 与真源 ${fam.canonical} 不一致`)
    } else {
      const lines = text.split('\n')
      if (!isOrderedSubset(canonicalLines, lines)) {
        problems.push(`${c} 未包含真源的完整内容（共享部分被改动或缺失）`)
      }
    }
  }
  return { module: fam.module, kind: fam.kind, copies: copies.length, canonical: fam.canonical, problems }
}

function selftest() {
  let bad = 0
  const t = (name, ok) => {
    if (!ok) bad += 1
    console.log(`${ok ? '✓' : '✗'} ${name}`)
  }
  const files = {
    'a/x.js': 'l1\nl2\nl3',
    'b/x.js': 'l1\nl2\nl3',
    'c/x.js': 'l1\nBREAK\nl3'
  }
  const read = (p) => {
    if (!(p in files)) throw new Error('no such file ' + p)
    return files[p]
  }
  const fam = { module: 'x.js', kind: 'identical', canonical: 'a/x.js' }
  t('identical：全一致通过',
    checkFamily(fam, ['a/x.js', 'b/x.js'], read).problems.length === 0)
  t('★ identical：一行不同必须报错',
    checkFamily(fam, ['a/x.js', 'b/x.js', 'c/x.js'], read).problems.length === 1)

  const sup = 'l1\nl2\nl3'
  files['s/canon.js'] = sup
  files['s/super.js'] = 'l1\nEXTRA\nl2\nl3\nEXTRA2'
  files['s/mod.js'] = 'l1\nCHANGED\nl3'
  const fam2 = { module: 'canon.js', kind: 'superset', canonical: 's/canon.js' }
  t('★ superset：真源为超集子序列通过（允许插入）',
    checkFamily(fam2, ['s/canon.js', 's/super.js'], read).problems.length === 0)
  t('★ superset：共享行被改动必须报错',
    checkFamily(fam2, ['s/canon.js', 's/mod.js'], read).problems.length === 1)
  t('★ superset：真源行缺失必须报错',
    isOrderedSubset(['l1', 'l2', 'l3'], ['l1', 'l3']) === false)
  t('canonical 不在副本列表 → 报错',
    checkFamily({ module: 'x.js', kind: 'identical', canonical: 'zzz/x.js' }, ['a/x.js'], read).problems.length === 1)
  t('家族无副本 → 报错',
    checkFamily({ module: 'x.js', kind: 'identical', canonical: 'a/x.js' }, [], read).problems.length === 1)

  // ★ 真实文件注入：合成用例只能证明「比较函数写得对」，
  //   不能证明「真的能拦住这 100 份副本里的漂移」。逐个改回去再还原。
  const injections = [
    {
      name: '把某个 staffGuard 副本改一个字符（授权层漂移）',
      file: 'getMemberPass/staffGuard.js',
      mutate: (t) => t.replace(/^(\/\*\*)/m, '$1 漂移'),
      expect: /staffGuard\.js/
    },
    {
      name: '把某个 memberLevels 副本的共享行改掉（超集家族也要拦）',
      file: 'getMemberPass/memberLevels.js',
      mutate: (t) => t.replace(/^(const|function)/m, '// $1'),
      expect: /memberLevels\.js/
    },
    {
      name: '把某个 giftMeta 副本改注释路径（礼赠元数据漂移）',
      file: 'makeOrder/giftMeta.js',
      mutate: (t) => t.replace('subpackages/feature/gift/giftShareCard.js', 'utils/giftShareCard.js'),
      expect: /giftMeta\.js/
    }
  ]
  for (const inj of injections) {
    let abs
    try {
      abs = join(FN_ROOT, inj.file)
      const orig = readFileSync(abs, 'utf8')
      const mutated = inj.mutate(orig)
      if (mutated === orig) {
        bad += 1
        console.log(`✗ 注入锚点缺失：${inj.name}`)
        continue
      }
      writeFileSync(abs, mutated)
      const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
      const out = `${run.stdout || ''}${run.stderr || ''}`
      if (run.status !== 0 && inj.expect.test(out)) {
        console.log(`✓ ${inj.name} → 被守卫拦下`)
      } else {
        bad += 1
        console.log(`✗ ${inj.name} → 未被拦下（status=${run.status}）`)
      }
      writeFileSync(abs, orig)
    } catch (e) {
      bad += 1
      console.log(`✗ ${inj.name} 注入过程出错：${e.message}`)
    }
  }
  const after = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
  if (after.status !== 0) {
    bad += 1
    console.log('✗ 注入还原后仍未通过——自检污染了工作区')
    console.log(after.stdout || after.stderr)
  } else {
    console.log('✓ 注入全部还原，工作区重新通过')
  }

  if (bad) {
    console.error(`\n自检失败 ${bad} 项——守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：合成用例 + 真实文件注入（staffGuard / memberLevels / giftMeta）全部拦下，且不误报')
}

function main() {
  if (process.argv.includes('--selftest')) return selftest()
  const json = process.argv.includes('--json')
  // 路径基准 = cloudfunctions/（与 FAMILIES[].canonical 声明一致）
  const readText = (p) => readFileSync(join(FN_ROOT, p), 'utf8')

  const results = FAMILIES.map((fam) => checkFamily(fam, findCopies(fam.module), readText))
  const allProblems = results.flatMap((r) => r.problems.map((p) => `${r.module}: ${p}`))

  if (json) {
    console.log(JSON.stringify({ families: results, problems: allProblems }, null, 2))
  } else {
    const totalCopies = results.reduce((s, r) => s + (r.copies || 0), 0)
    console.log(`真共享家族 ${FAMILIES.length} 个 · 副本合计 ${totalCopies} 份\n`)
    results.forEach((r) => {
      const tag = r.problems.length ? '✗' : '✓'
      const kind = r.kind === 'superset' ? '（超集：允许插入）' : ''
      console.log(`  ${tag} ${String(r.module).padEnd(20)} ${String(r.copies).padStart(3)} 份 ${kind}`)
      r.problems.forEach((p) => console.log(`      ${p}`))
    })
    console.log(`\n有意分歧（不纳入，已登记原因）：`)
    INTENTIONAL_DIVERGENCE.forEach((d) => console.log(`  · ${d.module}（${d.copies} 份）—— ${d.why}`))
    console.log(`\n已由其它守卫覆盖：`)
    COVERED_ELSEWHERE.forEach((c) => console.log(`  · ${c}`))
  }
  if (allProblems.length) {
    console.error(`\n真共享模块一致性未通过：${allProblems.length} 处`)
    process.exit(1)
  }
  console.log('\n✓ 真共享模块全部一致（含超集家族的共享部分）')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
