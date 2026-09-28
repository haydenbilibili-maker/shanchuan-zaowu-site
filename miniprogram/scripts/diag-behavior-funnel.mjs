#!/usr/bin/env node
/**
 * 只读诊断：超管「行为漏斗」全 0 时，本地对照仓内契约（不连云、不改库）。
 *
 * 用法：node miniprogram/scripts/diag-behavior-funnel.mjs
 *
 * 输出：
 *   - 报表期望的 action / step
 *   - 客户端实打埋点是否对齐
 *   - 仓内 loadBehaviors / buildFunnel 是否含 funnel-daily-v2
 *   - 如何区分 A 未部署 / B 取数 / C 埋点未打
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const dash = join(ROOT, 'miniprogram/cloudfunctions/getAnalyticsDashboard/index.js')
const track = join(ROOT, 'miniprogram/cloudfunctions/trackUserBehavior/index.js')
const identify = join(ROOT, 'miniprogram/subpackages/feature/identify/index.js')
const identifyResult = join(ROOT, 'miniprogram/subpackages/feature/identify/result/index.js')
const identifyResultWxml = join(ROOT, 'miniprogram/subpackages/feature/identify/result/index.wxml')
const hubWxml = join(ROOT, 'miniprogram/subpackages/manager/manager/workspace/_subviews.wxml')

const EXPECTED = {
  identify: ['identify_entry_click', 'identify_start', 'identify_success', 'identify_save_atlas'],
  gates: [
    { action: 'identify_save_atlas_gate', steps: ['show', 'go_register', 'dismiss', 'resume_success'] },
    { action: 'identify_result_gate', steps: ['show', 'go_register', 'dismiss', 'resume_success'] }
  ]
}

function has(src, re) {
  return re.test(src || '')
}

function main() {
  const files = { dash, track, identify, identifyResult, identifyResultWxml, hubWxml }
  for (const [k, p] of Object.entries(files)) {
    if (!existsSync(p)) {
      console.error(`✗ 缺文件 ${k}: ${p}`)
      process.exit(1)
    }
  }
  const S = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, readFileSync(p, 'utf8')]))

  console.log('=== 行为漏斗契约对照（仓内只读）===\n')

  console.log('1) 报表 buildFunnel 期望（AI 鉴定）')
  for (const a of EXPECTED.identify) {
    const inDash = S.dash.includes(`'${a}'`) || S.dash.includes(`"${a}"`)
    console.log(`   ${inDash ? '✓' : '✗'} count('${a}')`)
  }
  for (const g of EXPECTED.gates) {
    console.log(`   钩子 ${g.action}:`)
    for (const step of g.steps) {
      const ok =
        S.dash.includes(`'${g.action}'`) &&
        (S.dash.includes(`'${step}'`) || S.dash.includes(`"${step}"`))
      console.log(`     ${ok ? '✓' : '✗'} step=${step}`)
    }
  }

  console.log('\n2) 客户端实打')
  for (const a of EXPECTED.identify) {
    const hit = S.identify.includes(`'${a}'`) || S.identifyResult.includes(`'${a}'`)
    console.log(`   ${hit ? '✓' : '✗'} track ${a}`)
  }
  console.log(
    `   ${S.identifyResult.includes("identify_save_atlas_gate") ? '✓' : '✗'} save_atlas_gate`
  )
  console.log(
    `   ${S.identifyResult.includes("identify_result_gate") ? '✓' : '✗'} result_gate`
  )
  const hasCtaBind = /bind:cta=["']onRegisterCta["']/.test(S.identifyResultWxml)
  const hasCtaHandler = /onRegisterCta\s*\(/.test(S.identifyResult)
  const hasGoRegisterResult =
    /identify_result_gate[\s\S]{0,120}go_register/.test(S.identifyResult)
  console.log(
    `   ${hasCtaBind && hasCtaHandler && hasGoRegisterResult ? '✓' : '✗'} result_gate go_register（需 bind:cta + onRegisterCta）`
  )

  console.log('\n3) 仓内读侧修复指纹')
  const build = has(S.dash, /funnel-daily-v2/)
  const dateKeyIn = has(S.dash, /dateKey\s*:\s*_\.in\(/)
  const dailyFunnel = has(S.dash, /dailyCount\s*=|analytics_daily\+behaviors/)
  const writeTs = has(S.track, /doc\.timestamp\s*=/)
  const writeUid = has(S.track, /doc\.userId\s*=/)
  const diagUi = has(S.hubWxml, /behavior\.diag\.build/)
  console.log(`   ${build ? '✓' : '✗'} build=funnel-daily-v2`)
  console.log(`   ${dateKeyIn ? '✓' : '✗'} loadBehaviors 主路径 dateKey _.in`)
  console.log(`   ${dailyFunnel ? '✓' : '✗'} 漏斗动作级走 analytics_daily`)
  console.log(`   ${writeTs && writeUid ? '✓' : '✗'} trackUserBehavior 写 timestamp+userId`)
  console.log(`   ${diagUi ? '✓' : '✗'} Hub 展示 behavior.diag`)

  console.log('\n4) 线上仍全 0 时怎么分 A/B/C')
  console.log('   A 未部署：报表「构建指纹」不是 funnel-daily-v2（或根本没有诊断卡）')
  console.log('      → 必须上传 getAnalyticsDashboard（建议顺带 trackUserBehavior）')
  console.log('      → bash miniprogram/scripts/deploy-drifted.sh getAnalyticsDashboard trackUserBehavior')
  console.log('   B 取数：指纹已是 v2，但「日汇总·鉴定开始」>0 而漏斗鉴定仍 0 → 再查前端映射')
  console.log('      若日汇总·鉴定开始=0 且 DAU/浏览有数 → 更像区间内无鉴定流量（或 UTC 日界偏差）')
  console.log('   C 埋点：日汇总也无 identify_*，但客户端代码有 track → 查上报队列/云函数写失败')
  console.log('      result_gate「去注册」在修 cta 前会恒 0（其它 step 仍应有数）')

  const ok =
    build && dateKeyIn && dailyFunnel && writeTs && writeUid && hasCtaBind && hasCtaHandler
  console.log(ok ? '\n✓ 仓内契约齐（下一步看线上指纹确认部署）' : '\n✗ 仓内仍有缺口，先修再部署')
  process.exit(ok ? 0 : 1)
}

main()
