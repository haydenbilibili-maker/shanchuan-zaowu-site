#!/usr/bin/env node
/**
 * check:member-pricing-sync —— 会员价「只在一处报、只有一份口径」守卫
 *
 * 沿革：
 *   2026-09-19 裁决 46-a：礼赠编排页底栏「备妥应付」显示当前等级会员价，为此在 feature 分包
 *   复制了一份定级口径 `subpackages/feature/utils/memberPayable.js`，本守卫当时拦「副本漂移」。
 *   2026-10-12 产品负责人撤回编排页报价：「在最后一个环节展示价格即可，并展示会员折扣信息」——
 *   送礼页不再报价，价格与会员折扣只在第 3 步确认页给一次。副本随之删除（它只服务编排页）。
 *
 *   ⇒ 现在要拦的是**反方向**：有人把编排页报价加回来，又在分包里复制一份定级口径（漂移源复活）。
 *
 * 断言（任一条不成立即失败）：
 *   ① 副本不复活：`subpackages/feature/utils/memberPayable.js` 不存在；小程序端（云函数、scripts 除外）
 *      除业务真源 `subpackages/business/utils/memberPricing.js` 外，没有别处定义
 *      `resolveFromLadder` / `levelRate` / `normalizeDiscountRate`。
 *   ② 送礼页不报价：编排页 JS 不取会员等级（无 getUserStats / memberPayable / memberPricing / payablePrice），
 *      底栏无金额与「会员价」字样。
 *   ③ 确认页是唯一口径：仍从 getUserStats 取等级、优先 stats.discountRate；
 *      orderPricing 会员乘法形态未变（合计 × 费率一次成形）。
 *
 * 用法：
 *   node miniprogram/scripts/check-member-pricing-sync.mjs            # 校验
 *   node miniprogram/scripts/check-member-pricing-sync.mjs --selftest # 证明它会失败（临时根上注入，不动工作区）
 *   node miniprogram/scripts/check-member-pricing-sync.mjs --root <dir>  # 只给自检用
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { join, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP_DEFAULT = join(HERE, '..')

const REL = {
  pricing: 'subpackages/business/utils/memberPricing.js',
  orderPricing: 'subpackages/business/utils/orderPricing.js',
  compose: 'subpackages/feature/gift/compose/index.js',
  composeWxml: 'subpackages/feature/gift/compose/index.wxml',
  confirm: 'subpackages/business/confirm-order/index.js'
}
const RETIRED_COPY = 'subpackages/feature/utils/memberPayable.js'
const SHARED_FNS = ['normalizeDiscountRate', 'levelRate', 'resolveFromLadder']
const SKIP_DIRS = new Set(['node_modules', 'cloudfunctions', 'scripts', 'docs', 'minitest', '.git'])

function walkJs(root, dir = root, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) walkJs(root, abs, out)
    else if (name.endsWith('.js')) out.push(relative(root, abs).split(sep).join('/'))
  }
  return out
}

function check(mp) {
  const problems = []
  const texts = {}
  for (const [key, rel] of Object.entries(REL)) {
    try {
      texts[key] = readFileSync(join(mp, rel), 'utf8')
    } catch (e) {
      problems.push(`${rel} 读不到：${e.message}`)
    }
  }
  if (problems.length) return problems

  // ① 副本不复活
  if (existsSync(join(mp, RETIRED_COPY))) {
    problems.push(`${RETIRED_COPY} 复活了 —— 编排页已不报价，分包里的定级口径副本只会漂移（2026-10-12 删除）`)
  }
  for (const rel of walkJs(mp)) {
    if (rel === REL.pricing) continue
    const src = readFileSync(join(mp, rel), 'utf8')
    for (const fn of SHARED_FNS) {
      if (new RegExp(`function ${fn}\\s*\\(`).test(src)) {
        problems.push(`${rel} 又定义了 ${fn}() —— 定级口径只许在 ${REL.pricing} 一处`)
      }
    }
  }

  // ② 送礼页不报价
  for (const bad of ['getUserStats', 'memberPayable', 'memberPricing', 'payablePrice']) {
    if (texts.compose.includes(bad)) problems.push(`${REL.compose} 又出现 ${bad} —— 送礼页不取会员等级、不算价（价格只在确认页）`)
  }
  const w = texts.composeWxml
  const barAt = w.indexOf('<view class="bottom-bar')
  if (barAt < 0) problems.push(`${REL.composeWxml} 找不到底栏 bottom-bar`)
  else {
    const bar = w.slice(barAt, w.indexOf('<view class="page checking"', barAt))
    if (/¥|会员价|备妥应付|以结算页为准/.test(bar)) problems.push(`${REL.composeWxml} 底栏又报价（¥ / 会员价 / 备妥应付）—— 与确认页底栏重复`)
  }

  // ③ 确认页是唯一口径
  if (!texts.confirm.includes('getUserStats')) problems.push(`${REL.confirm} 不再从 getUserStats 取等级`)
  if (!/stats\.discountRate/.test(texts.confirm)) problems.push(`${REL.confirm} 不再优先取 stats.discountRate`)
  if (!/discountedSubtotal \* discountRate \+ nonDiscounted/.test(texts.orderPricing)) {
    problems.push(`${REL.orderPricing} 的会员乘法形态变了（合计 × 费率一次成形），请核对账单与服务端是否同口径`)
  }
  return problems
}

// ────────────────────────────── 自检 ──────────────────────────────
function copyTree(src, dst) {
  for (const name of readdirSync(src)) {
    if (SKIP_DIRS.has(name)) continue
    const a = join(src, name)
    const b = join(dst, name)
    if (statSync(a).isDirectory()) { mkdirSync(b, { recursive: true }); copyTree(a, b) }
    else if (name.endsWith('.js') || name.endsWith('.wxml')) writeFileSync(b, readFileSync(a))
  }
}

function selftest() {
  let bad = 0
  const tmp = mkdtempSync(join(tmpdir(), 'member-pricing-sync-'))
  try {
    copyTree(MP_DEFAULT, tmp)
    const run = () => spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--root', tmp], { encoding: 'utf8' })
    const base = run()
    if (base.status !== 0) {
      console.error(`✗ 自检前提：真文件副本须先通过\n${base.stdout}${base.stderr}`)
      process.exit(1)
    }
    const pricingSrc = readFileSync(join(MP_DEFAULT, REL.pricing), 'utf8')
    const injections = [
      { name: '分包副本 memberPayable.js 复活', file: RETIRED_COPY, mutate: () => 'module.exports = {}\n', expect: /复活/ },
      {
        name: '别处又复制一份 resolveFromLadder',
        file: 'utils/memberLevelCopy.js',
        mutate: () => `function resolveFromLadder(ladder, growth) { return ladder }\nmodule.exports = { resolveFromLadder }\n`,
        expect: /又定义了 resolveFromLadder/
      },
      { name: '送礼页又取会员等级', file: REL.compose, mutate: (s) => s.replace('_maybeApplySceneNote() {', "_load() { wx.cloud.callFunction({ name: 'getUserStats' }) },\n  _maybeApplySceneNote() {"), expect: /getUserStats/ },
      { name: '送礼页底栏又报价', file: REL.composeWxml, mutate: (s) => s.replace('<view class="pay-btn', '<text class="bottom-value">¥{{displayPrice}}</text>\n    <view class="pay-btn'), expect: /底栏又报价/ },
      { name: '确认页不再取 stats.discountRate', file: REL.confirm, mutate: (s) => s.split('stats.discountRate').join('stats.rateX'), expect: /stats\.discountRate/ },
      {
        name: '结算页折扣改成分段取整',
        file: REL.orderPricing,
        mutate: (s) => s.replace('discountedSubtotal * discountRate + nonDiscounted', 'Math.round(discountedSubtotal * discountRate * 100) / 100 + nonDiscounted'),
        expect: /乘法形态变了/
      }
    ]
    if (!pricingSrc.includes('function resolveFromLadder')) {
      bad += 1
      console.log('✗ 前提：业务真源里找不到 resolveFromLadder（注入「别处复制」失去对照）')
    }
    for (const inj of injections) {
      const abs = join(tmp, inj.file)
      const had = existsSync(abs)
      const orig = had ? readFileSync(abs, 'utf8') : null
      const mutated = inj.mutate(orig || '')
      if (had && mutated === orig) {
        bad += 1
        console.log(`✗ 注入锚点缺失：${inj.name}`)
        continue
      }
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, mutated)
      const res = run()
      const out = `${res.stdout || ''}${res.stderr || ''}`
      if (res.status !== 0 && inj.expect.test(out)) console.log(`✓ 注入「${inj.name}」→ 检出`)
      else {
        bad += 1
        console.log(`✗ 注入「${inj.name}」→ 未检出（status=${res.status}）\n${out.slice(0, 400)}`)
      }
      if (had) writeFileSync(abs, orig)
      else rmSync(abs)
    }
    if (run().status !== 0) { bad += 1; console.log('✗ 还原后未重新通过') }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  if (bad) {
    console.error(`\n自检失败 ${bad} 项 —— 守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n✓ check:member-pricing-sync 自检通过（6 处注入全部检出，临时根上进行，未动工作区）')
}

function main() {
  if (process.argv.includes('--selftest')) return selftest()
  const i = process.argv.indexOf('--root')
  const mp = i >= 0 ? process.argv[i + 1] : MP_DEFAULT
  const problems = check(mp)
  if (problems.length) {
    console.error('✗ 会员价不在一处 / 口径不唯一：')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log('✓ check:member-pricing-sync：送礼页不报价、不取等级 / 分包无定级口径副本 / 确认页从 getUserStats + stats.discountRate 取价、乘法形态未变')
}

main()
