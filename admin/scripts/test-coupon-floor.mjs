#!/usr/bin/env node
/**
 * 券门槛地板一致性守卫
 *
 * 背景：`couponDiscountRules.js` 定了「不低于 7.5 折」的地板
 * `cashCouponMinSpendFloor(value) = ceil(value / MAX_OFF_RATIO)`，MAX_OFF_RATIO = 0.25。
 * 服务端（makeOrder / exchangeCoupon / receiveCoupon 等 10 份副本）都按它校验；
 * 2026-09-16 起 ERP 的兑换品表单也在**前端内联**同一条地板（`Marketing.vue` 的
 * `MIN_SPEND_MAX_OFF`），以便在录入时就拦住「满39减10」这类穿底配置。
 *
 * 风险：两处如果漂移，前端就会**放行**服务端一定会拒绝的配置 —— 运营看到「保存成功」，
 * 实际兑换时才失败。本脚本把两边钉在一起。
 *
 * 用法：
 *   node admin/scripts/test-coupon-floor.mjs
 *   node admin/scripts/test-coupon-floor.mjs --selftest   # 证明地板被改坏时会失败
 */
'use strict'

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const CANON_PATH = resolve(REPO, 'miniprogram/cloudfunctions/makeOrder/couponDiscountRules.js')
const ERP_PATH = resolve(HERE, '..', 'src', 'components', 'Marketing.vue')

const require = createRequire(import.meta.url)

/** 从 ERP 源码里取出内联常量；源码可注入以便自检 */
function readErpRatio(src) {
  const m = src.match(/const\s+MIN_SPEND_MAX_OFF\s*=\s*([0-9.]+)/)
  if (!m) throw new Error('Marketing.vue 中未找到 MIN_SPEND_MAX_OFF')
  return Number(m[1])
}

/**
 * 还要求 ERP 的校验**确实用了**这个常量（而不是写死一个数字），
 * 否则改常量不会影响实际校验 —— 那这条守卫就是假的。
 */
function erpUsesConstant(src) {
  return /Math\.ceil\(\s*face\s*\/\s*MIN_SPEND_MAX_OFF\s*\)/.test(src)
}

export function runChecks(erpSrc) {
  const canon = require(CANON_PATH)
  const failures = []
  let pass = 0
  const check = (name, cond, detail) => {
    if (cond) pass += 1
    else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  }

  const erpRatio = readErpRatio(erpSrc)
  check('ERP 内联比例 == 云函数 MAX_OFF_RATIO',
    erpRatio === canon.MAX_OFF_RATIO,
    `ERP ${erpRatio} vs 云函数 ${canon.MAX_OFF_RATIO}`)
  check('ERP 校验确实引用了该常量（非写死数字）', erpUsesConstant(erpSrc))

  // 地板值逐一对比（覆盖到分币级的边界）
  const samples = [0, 1, 2, 3, 5, 9, 10, 11, 29, 30, 39, 40, 49, 50, 99, 100, 199, 200, 499, 999, 1000]
  samples.forEach((v) => {
    const floor = erpRatio > 0 ? Math.ceil(v / erpRatio) : 0
    const canonFloor = canon.cashCouponMinSpendFloor(v)
    check(`地板一致 value=${v}`, floor === canonFloor, `ERP ${floor} vs 云函数 ${canonFloor}`)
  })

  // 达标/不达标的判定必须一致（这才是运营实际感受到的行为）
  const pairs = [[10, 40], [10, 39], [10, 41], [50, 200], [50, 199], [30, 120], [30, 119]]
  pairs.forEach(([face, minSpend]) => {
    const canonOk = canon.validateCashCoupon(face, minSpend).ok
    const erpOk = !(face > 0) || minSpend >= Math.ceil(face / erpRatio)
    check(`判定一致 满${minSpend}减${face}`, canonOk === erpOk, `ERP ${erpOk} vs 云函数 ${canonOk}`)
  })

  return { failures, pass }
}

if (process.argv.includes('--selftest')) {
  console.log('自检：把 ERP 内联比例改坏，检查必须失败\n')
  const src = readFileSync(ERP_PATH, 'utf8')
  const cases = [
    ['比例改为 0.2（比云函数松，会放行穿底券）', src.replace('const MIN_SPEND_MAX_OFF = 0.25', 'const MIN_SPEND_MAX_OFF = 0.2')],
    ['校验不再引用常量（写死 40）', src.replace('Math.ceil(face / MIN_SPEND_MAX_OFF)', '40')]
  ]
  let allDetected = true
  for (const [label, mutated] of cases) {
    let detected = false
    let first = ''
    try {
      const { failures } = runChecks(mutated)
      detected = failures.length > 0
      first = failures[0] || ''
    } catch (e) {
      detected = true
      first = `抛出异常：${e.message}`
    }
    allDetected = allDetected && detected
    console.log(`${detected ? '✓' : '✗'} ${label} → ${detected ? '已检出' : '【漏检】'}`)
    if (first) console.log(`    · ${first}`)
  }
  console.log()
  if (!allDetected) {
    console.error('自检失败：地板漂移未被检出，守卫不可信。')
    process.exit(1)
  }
  console.log('自检通过：比例漂移与「常量未被引用」都会失败。\n')
}

const { failures, pass } = runChecks(readFileSync(ERP_PATH, 'utf8'))
console.log(`券门槛地板一致性：${pass} 项通过，${failures.length} 项失败`)
if (failures.length) {
  console.error('\n失败明细：')
  failures.forEach((f) => console.error(`  ✗ ${f}`))
  process.exit(1)
}
console.log('全部通过：ERP 内联地板与云函数 couponDiscountRules 同口径，且常量确实被引用。')
