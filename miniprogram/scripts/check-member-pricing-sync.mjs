#!/usr/bin/env node
/**
 * check:member-pricing-sync —— 会员应付「口径同源」守卫（2026-09-19 裁决 46-a）
 *
 * 背景（真事故形态，不是假想）：
 *   礼赠编排页底部「备妥应付」此前直接渲染 `displayPrice`（**原价**），
 *   会员看到的价格与结算页不一致。修法只能是「同一个等级、同一个费率、同一种乘法」，
 *   而微信分包硬约束决定了主包件 `utils/memberPayable.js` 只能是
 *   `subpackages/business/utils/memberPricing.js` 三个纯函数的**副本**
 *   （分包之间不能互 require；主包不能引分包）。
 *
 *   ⇒ 副本就有漂移风险：改了 business 那份的定级口径，编排页会静默按旧口径报价。
 *     本守卫就是拦这个静默漂移。
 *
 * 断言（任一条不成立即失败）：
 *   ① 副本同源：`resolveFromLadder` / `normalizeDiscountRate` / `levelRate`
 *      在 `utils/memberPayable.js` 与 `subpackages/business/utils/memberPricing.js`
 *      里**逐字一致**（副本可以存在，但不许各自演化）。
 *   ② 引用合法：编排页只引主包件，绝不出现 `memberPricing`（跨包会整包起不来）。
 *   ③ 界面真展示会员价：底栏「备妥应付」渲染的是 `payablePrice`，
 *      且带「以结算页为准」（当前等级价 ≠ 结算页含券/运费/自提后的最终价）。
 *   ④ 参与折扣的判据一致：`memberDiscountEnabled === false`（false 才不打折）。
 *   ⑤ 结算页乘法形态未变：`orderPricing` 仍是「合计 × 费率」一次成形
 *      （⇒ 单行订单与编排页 `applyMemberRate` 数学等价，见 ⑥ 的数值证明）。
 *   ⑥ 数值等价（真跑，不靠读代码）：`applyMemberRate(line, rate, true)`
 *      与结算页单行公式 `round2(line * rate)` 在费率 × 金额矩阵上逐点相等；
 *      非法费率（0 / 负数 / NaN / >1）一律回落原价，绝不因脏数据把价格算成 0 或负数。
 *   ⑦ 取数同源：两页都从 `getUserStats` 的同一批字段（levelLadder / growthValue /
 *      userInfo.isHonorary）解析当前等级。
 *
 * 用法：
 *   node miniprogram/scripts/check-member-pricing-sync.mjs            # 校验
 *   node miniprogram/scripts/check-member-pricing-sync.mjs --selftest # 证明它会失败
 *   node miniprogram/scripts/check-member-pricing-sync.mjs --root <dir>  # 只给自检用
 */
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP_DEFAULT = join(HERE, '..')

/** 相对 miniprogram/ 的落点（自检时整体搬到临时根，绝不改共享工作区的真文件） */
const REL = {
  helper: 'utils/memberPayable.js',
  pricing: 'subpackages/business/utils/memberPricing.js',
  orderPricing: 'subpackages/business/utils/orderPricing.js',
  compose: 'subpackages/feature/gift/compose/index.js',
  composeWxml: 'subpackages/feature/gift/compose/index.wxml',
  confirm: 'subpackages/business/confirm-order/index.js'
}

/** 三个必须逐字同源的纯函数（business 件是这些函数的真源） */
const SHARED_FNS = ['normalizeDiscountRate', 'levelRate', 'resolveFromLadder']

/** 从源码里切出一个 `function NAME(...) {...}` 的完整文本（按花括号配平） */
function extractFn(text, name) {
  const start = text.indexOf(`function ${name}(`)
  if (start < 0) return null
  const open = text.indexOf('{', start)
  if (open < 0) return null
  let depth = 0
  for (let p = open; p < text.length; p += 1) {
    const ch = text[p]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, p + 1)
    }
  }
  return null
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/**
 * 结算页 `orderPricing.calculateClientPricing` 在**单行、参与折扣、无券**时的取值：
 *   original = price * count；discountedSubtotal = original；
 *   vipTotal = round2(discountedSubtotal * discountRate + 0)
 * 编排页只有一行（选中 SKU × 件数），故这一条就是两页必须重合的全部情形。
 */
function checkoutSingleLine(line, rate) {
  return round2(line * rate)
}

/** 以 CJS 语义执行主包件（它自带 module.exports，且**不许有 require**） */
function loadHelper(src) {
  const module = { exports: {} }
  const wrapper = new vm.Script(`(function (module, exports, require) {\n${src}\n})`)
  const requireStub = () => {
    throw new Error('主包件不得 require 任何模块（跨包引用会让分包整包起不来）')
  }
  wrapper.runInThisContext()(module, module.exports, requireStub)
  return module.exports
}

function check(mp) {
  const problems = []
  const read = (key) => readFileSync(join(mp, REL[key]), 'utf8')
  const texts = {}
  for (const key of Object.keys(REL)) {
    try {
      texts[key] = read(key)
    } catch (e) {
      problems.push(`${REL[key]} 读不到：${e.message}`)
    }
  }
  if (problems.length) return problems

  // ① 副本同源：三个函数逐字一致
  for (const name of SHARED_FNS) {
    const a = extractFn(texts.helper, name)
    const b = extractFn(texts.pricing, name)
    if (!a) problems.push(`${REL.helper} 里找不到 function ${name}(（副本被删或被改名）`)
    else if (!b) problems.push(`${REL.pricing} 里找不到 function ${name}(（真源被删或被改名）`)
    else if (a !== b) {
      problems.push(
        `「${name}」两处不再逐字一致 —— 定级口径已漂移：编排页会按旧口径报价\n` +
        `    主包副本：${a.split('\n')[0]}\n    业务真源：${b.split('\n')[0]}`
      )
    }
  }

  // ② 引用合法 + 真引了主包件
  if (!/require\((['"])[^'"]*utils\/memberPayable\1\)/.test(texts.compose)) {
    problems.push(`${REL.compose} 没有 require 主包件 utils/memberPayable`)
  }
  if (/require\((['"])[^'"]*memberPricing\1\)/.test(texts.compose)) {
    problems.push(`${REL.compose} require 了 memberPricing —— 分包之间不能互 require，会让整包起不来`)
  }

  // ③ 界面真展示会员价 + 「以结算页为准」
  const bottomAt = texts.composeWxml.indexOf('备妥应付')
  if (bottomAt < 0) {
    problems.push(`${REL.composeWxml} 找不到「备妥应付」`)
  } else {
    const block = texts.composeWxml.slice(bottomAt, bottomAt + 500)
    if (!/bottom-value[^>]*>\s*¥\{\{payablePrice\}\}/.test(block)) {
      problems.push('「备妥应付」的主价没有渲染 payablePrice（会员看到的是原价 —— 这正是本次要修的事故形态）')
    }
    if (/bottom-value[^>]*>\s*¥\{\{displayPrice\}\}/.test(block)) {
      problems.push('「备妥应付」的主价仍在直接渲染 ¥{{displayPrice}}（原价）')
    }
    // 原价只允许作为划掉对照出现（bottom-origin），不许在别处裸奔
    if (block.includes('¥{{displayPrice}}') && !/bottom-origin[^>]*>\s*¥\{\{displayPrice\}\}/.test(block)) {
      problems.push('「备妥应付」里的原价不在 .bottom-origin（划掉对照）里 —— 排版会让人分不清哪个是应付')
    }
    if (!block.includes('以结算页为准')) {
      problems.push('「备妥应付」缺少「以结算页为准」—— 当前等级价不等于含券/运费的最终价')
    }
  }
  const setPriceAt = texts.compose.indexOf('displayPrice: total')
  const refreshAt = texts.compose.indexOf('this._refreshMemberPayable()', setPriceAt)
  if (setPriceAt < 0 || refreshAt < 0) {
    problems.push(`${REL.compose} 未在 displayPrice 落定后调用 _refreshMemberPayable()`)
  }
  if (!texts.compose.includes('this._loadMemberStats()')) {
    problems.push(`${REL.compose} 没有在进页时取会员等级（_loadMemberStats）`)
  }

  // ④ 折扣判据一致
  if (!/memberDiscountEnabled === false/.test(texts.helper)) {
    problems.push(`${REL.helper} 的 applyMemberRate 判据不再是 memberDiscountEnabled === false`)
  }
  if (!/item\.memberDiscountEnabled !== false/.test(texts.orderPricing)) {
    problems.push(`${REL.orderPricing} 的 isMemberDiscountEnabled 判据不再是 item.memberDiscountEnabled !== false`)
  }
  if (!/memberDiscountEnabled: p\.memberDiscountEnabled !== false/.test(texts.compose)) {
    problems.push(`${REL.compose} 传给结算页的 memberDiscountEnabled 判据变了`)
  }

  // ⑤ 结算页乘法形态（单行等价的前提）
  if (!/discountedSubtotal \* discountRate \+ nonDiscounted/.test(texts.orderPricing)) {
    problems.push(
      `${REL.orderPricing} 的会员乘法形态变了 —— 逐行取整会与编排页的整单取整不等价，请同步核对 ⑥ 的矩阵`
    )
  }

  // ⑥ 数值等价（真跑主包件）
  let helper = null
  try {
    helper = loadHelper(texts.helper)
  } catch (e) {
    problems.push(`主包件执行失败：${e.message}`)
  }
  if (helper) {
    for (const fn of ['applyMemberRate', 'payableFor', 'inputsFromStats', 'resolveCurrentRate']) {
      if (typeof helper[fn] !== 'function') problems.push(`主包件未导出 ${fn}`)
    }
  }
  if (helper && typeof helper.applyMemberRate === 'function') {
    const lines = [0.01, 1, 9.99, 33.33, 168, 298, 299, 4500, 12345.67]
    const rates = [0.75, 0.8, 0.85, 0.9, 0.95, 1]
    for (const line of lines) {
      for (const rate of rates) {
        const got = helper.applyMemberRate(line, rate, true)
        const want = checkoutSingleLine(line, rate)
        if (got !== want) {
          problems.push(`折扣价与结算页不等价：¥${line} × ${rate} → 编排页 ${got} / 结算页 ${want}`)
        }
      }
      if (helper.applyMemberRate(line, 0.9, false) !== round2(line)) {
        problems.push(`memberDiscountEnabled=false 时未回落原价（¥${line}）`)
      }
    }
    for (const bad of [0, -1, NaN, 1.5, 'x', null, undefined]) {
      const got = helper.applyMemberRate(100, bad, true)
      if (got !== 100) problems.push(`非法费率 ${String(bad)} 未回落原价（得到 ${got}）`)
    }
    if (helper.applyMemberRate(0, 0.9, true) !== 0) problems.push('0 元订单应仍为 0')

    // 服务端费率优先（与结算页 stats.discountRate 同源）：阶梯为空也必须照服务端算
    const srv = helper.payableFor({ amount: 1000, ladder: [], growthValue: 0, serverRate: 0.9, serverLevelName: '流金·研究员' })
    if (srv.payable !== 900) problems.push(`服务端费率未被优先采用（1000 × 0.9 → ${srv.payable}）`)
    if (srv.levelName !== '流金·研究员') problems.push(`等级名未取服务端值（得到「${srv.levelName}」）`)
    const srvPct = helper.payableFor({ amount: 1000, ladder: [], growthValue: 0, serverRate: 90 })
    if (srvPct.payable !== 900) problems.push(`服务端百分数写法（90）未归一为 0.9（得到 ${srvPct.payable}）`)
    const noSrv = helper.payableFor({
      amount: 1000,
      ladder: [{ level: 3, name: '流金·研究员', threshold: 2000, discountRate: 0.9 }],
      growthValue: 2500
    })
    if (noSrv.payable !== 900) problems.push(`无服务端费率时未按阶梯兜底（得到 ${noSrv.payable}）`)
  }

  // ⑦ 取数同源
  const STAT_KEYS = ['levelLadder', 'growthValue', 'isHonorary']
  for (const [key, label] of [['confirm', '结算页'], ['helper', '主包件']]) {
    for (const k of STAT_KEYS) {
      if (!texts[key].includes(k)) problems.push(`${label} 不再使用 getUserStats 字段 ${k} —— 两页取数口径可能已分叉`)
    }
  }
  if (!texts.confirm.includes('getUserStats') || !texts.compose.includes('getUserStats')) {
    problems.push('两页必须都从 getUserStats 取等级（否则等级口径不同源）')
  }
  // 服务端费率优先：结算页的「当前等级」取 stats.discountRate，主包件必须同源
  if (!/stats\.discountRate/.test(texts.confirm)) {
    problems.push(`${REL.confirm} 不再取 stats.discountRate —— 主包件的 serverRate 优先口径失去对照`)
  }
  if (!/serverRate: inputs\.serverRate/.test(texts.compose)) {
    problems.push(`${REL.compose} 没有把 stats.discountRate 传给 payableFor（会退化成纯本地阶梯推算）`)
  }
  return problems
}

// ────────────────────────────── 自检 ──────────────────────────────
function selftest() {
  let bad = 0
  const t = (name, ok, extra) => {
    if (!ok) bad += 1
    console.log(`${ok ? '✓' : '✗'} ${name}${ok || !extra ? '' : ` —— ${extra}`}`)
  }

  // 合成用例：证明「花括号配平切片」这个判据本身可用
  const src = 'function f() {\n  if (1) { return 2 }\n  return 3\n}\n'
  t('切片：能取到完整函数体', extractFn(src, 'f') === src.trim())
  t('切片：缺函数返回 null', extractFn(src, 'nope') === null)
  t('★ 切片：多一个字符必须不等', extractFn(src, 'f') !== src.trim().replace('return 3', 'return 4'))

  // 真实文件注入：搬到临时根上改，共享工作区一个字节都不动
  const tmp = mkdtempSync(join(tmpdir(), 'member-pricing-sync-'))
  try {
    for (const [key, rel] of Object.entries(REL)) {
      const dst = join(tmp, rel)
      mkdirSync(dirname(dst), { recursive: true })
      writeFileSync(dst, readFileSync(join(MP_DEFAULT, rel)))
    }
    const run = () => spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--root', tmp], { encoding: 'utf8' })
    const baseline = run()
    t('基线（真文件副本）通过', baseline.status === 0, (baseline.stdout || '') + (baseline.stderr || ''))

    const injections = [
      {
        name: '定级口径漂移（主包副本的 resolveFromLadder 改了门槛比较）',
        file: REL.helper,
        mutate: (s) => s.replace('if (growth >= th) current = row', 'if (growth > th) current = row'),
        expect: /不再逐字一致/
      },
      {
        name: '备妥应付退回原价（wxml 渲染 displayPrice）',
        file: REL.composeWxml,
        mutate: (s) => s.replace('¥{{payablePrice}}', '¥{{displayPrice}}'),
        expect: /payablePrice|displayPrice/
      },
      {
        name: '结算页折扣改成分段取整（乘法形态变了）',
        file: REL.orderPricing,
        mutate: (s) =>
          s.replace(
            'discountedSubtotal * discountRate + nonDiscounted',
            'Math.round(discountedSubtotal * discountRate * 100) / 100 + nonDiscounted'
          ),
        expect: /乘法形态变了|不等价/
      },
      {
        name: '编排页改回引分包件 memberPricing（跨包引用）',
        file: REL.compose,
        mutate: (s) => s.replace("require('../../../../utils/memberPayable')", "require('../../utils/memberPricing')"),
        expect: /memberPricing/
      },
      {
        name: '主包件偷偷 require 别的模块（跨包风险）',
        file: REL.helper,
        mutate: (s) => `const x = require('./util')\n${s}`,
        expect: /不得 require/
      },
      {
        name: '不再优先采用服务端费率（退化成纯本地阶梯推算）',
        file: REL.helper,
        mutate: (s) => s.replace('if (Number.isFinite(raw) && raw > 0) {', 'if (false) {'),
        expect: /服务端费率未被优先采用|等级名未取服务端值|百分数写法/
      }
    ]
    for (const inj of injections) {
      const abs = join(tmp, inj.file)
      const orig = readFileSync(abs, 'utf8')
      const mutated = inj.mutate(orig)
      if (mutated === orig) {
        bad += 1
        console.log(`✗ 注入锚点缺失：${inj.name}`)
        continue
      }
      writeFileSync(abs, mutated)
      const res = run()
      const out = `${res.stdout || ''}${res.stderr || ''}`
      if (res.status !== 0 && inj.expect.test(out)) {
        console.log(`✓ ${inj.name} → 被守卫拦下`)
      } else {
        bad += 1
        console.log(`✗ ${inj.name} → 未被拦下（status=${res.status}）\n${out.slice(0, 600)}`)
      }
      writeFileSync(abs, orig)
    }
    const after = run()
    t('注入全部还原后重新通过', after.status === 0)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  if (bad) {
    console.error(`\n自检失败 ${bad} 项 —— 守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：切片判据 + 6 处真实注入（口径漂移/退回原价/乘法变形/跨包引用/偷偷 require/丢弃服务端费率）全部拦下')
}

function main() {
  if (process.argv.includes('--selftest')) return selftest()
  const i = process.argv.indexOf('--root')
  const mp = i >= 0 ? process.argv[i + 1] : MP_DEFAULT
  const problems = check(mp)
  if (problems.length) {
    console.error('✗ 会员应付口径不同源：')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log('✓ 会员应付口径同源：主包副本三函数逐字一致 / 编排页只引主包件 /')
  console.log('  备妥应付渲染 payablePrice 且标注「以结算页为准」/ 折扣判据一致 /')
  console.log('  与结算页单行公式在 9×6 费率矩阵上逐点等价 / 非法费率回落原价 / 两页同取 getUserStats')
}

main()
