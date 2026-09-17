/**
 * 提示（toast）主视觉一致性守卫
 *
 * 背景（2026-09-17 真机反馈）：重新进入成功时弹的是**原生** `wx.showToast` →「已重新进入」，
 * 系统样式就是一个裸的深色圆角框，在博物黑 + 铜金的界面里非常突兀。
 * 这类反馈恰恰出现在顾客注意力最集中的一刻，必须与主视觉一致。
 *
 * 本守卫钉住三件事：
 *   ① 视觉同源：`components/AppToast` 的关键令牌必须与 `components/AppModal` **逐字相同**
 *      （铜金描边 / 渐变黑底 / 圆角），否则「一致」会随时间漂移；
 *   ② 非阻塞：轻提示不得拦点击或滚动（`pointer-events: none`，且不 catchtouchmove）——
 *      提示归提示，不能挡住用户手里的动作；
 *   ③ 接线：四个「重新进入」入口（我的页 / 券夹 / 钱包 / 地址）都走 AppToast，
 *      且全仓不再出现原生「已重新进入」文案。
 *
 * 用法：
 *   node miniprogram/scripts/check-toast-style.mjs
 *   node miniprogram/scripts/check-toast-style.mjs --selftest
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

const TOAST_WXSS = 'miniprogram/components/AppToast/index.wxss'
const TOAST_WXML = 'miniprogram/components/AppToast/index.wxml'
const MODAL_WXSS = 'miniprogram/components/AppModal/index.wxss'
const SITES = [
  { name: '我的页', js: 'miniprogram/pages/user/index.js', wxml: 'miniprogram/pages/user/index.wxml', json: 'miniprogram/pages/user/index.json' },
  { name: '券夹面板', js: 'miniprogram/subpackages/business/components/WalletPanelCoupons/index.js', wxml: 'miniprogram/subpackages/business/components/WalletPanelCoupons/index.wxml', json: 'miniprogram/subpackages/business/components/WalletPanelCoupons/index.json' },
  { name: '钱包面板', js: 'miniprogram/subpackages/business/components/WalletPanelWallet/index.js', wxml: 'miniprogram/subpackages/business/components/WalletPanelWallet/index.wxml', json: 'miniprogram/subpackages/business/components/WalletPanelWallet/index.json' },
  { name: '地址页', js: 'miniprogram/subpackages/business/address/index.js', wxml: 'miniprogram/subpackages/business/address/index.wxml', json: 'miniprogram/subpackages/business/address/index.json' }
]

let passed = 0
let failed = 0
const failures = []
function check(name, cond, extra) {
  if (cond) passed += 1
  else {
    failed += 1
    failures.push(`${name}${extra ? ' — ' + extra : ''}`)
  }
}
const read = (f) => readFileSync(resolve(ROOT, f), 'utf8')
/** 断言「代码」而不是注释 */
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const toastWxss = read(TOAST_WXSS)
const toastWxml = read(TOAST_WXML)
const modalWxss = read(MODAL_WXSS)

/* ── 1) 视觉同源：与 AppModal 逐字一致 ───────────────────────────────────── */
const TOKENS = [
  ['铜金描边', /border:\s*1rpx solid rgba\(196, 167, 108, 0\.55\);/],
  ['渐变黑底', /background:\s*linear-gradient\(180deg, #221F1B 0%, #1A1814 100%\);/],
  ['投影', /box-shadow:\s*0 24rpx 64rpx rgba\(0, 0, 0, 0\.55\);/],
  ['圆角令牌', /border-radius:\s*var\(--radius-md, 16rpx\);/],
  ['四角铭牌', /border-color:\s*rgba\(196, 167, 108, 0\.8\);/]
]
for (const [label, re] of TOKENS) {
  check(`AppToast 有${label}`, re.test(toastWxss), label)
  check(`★ ${label}与 AppModal 逐字一致（同一套主视觉）`, re.test(modalWxss) && re.test(toastWxss),
    `AppModal=${re.test(modalWxss)} AppToast=${re.test(toastWxss)}`)
}
check('AppToast 用品牌衬线字体做标题', /font-family:\s*var\(--font-brand\)/.test(toastWxss))
check('AppToast 有铭牌四角元素', (toastWxml.match(/class="at-corner/g) || []).length === 4)

/* ── 2) 非阻塞 ───────────────────────────────────────────────────────────── */
check('★ 轻提示不拦点击（pointer-events: none）', /pointer-events:\s*none/.test(toastWxss),
  '缺少 pointer-events: none → 提示会挡住整屏操作')
check('★ 轻提示不拦滚动（不 catchtouchmove）', !/catchtouchmove/.test(toastWxml),
  'toast 上挂了 catchtouchmove → 用户滚动会被吃掉')
check('轻提示有进出场过渡（与 AppModal 同为 0.24s）', /transition:[^;]*0\.24s/.test(toastWxss))
check('到时自动收起并派发 close（宿主据此复位）',
  /triggerEvent\('close'\)/.test(read('miniprogram/components/AppToast/index.js')))

/* ── 3) 接线 ─────────────────────────────────────────────────────────────── */
for (const site of SITES) {
  const js = read(site.js)
  const wxml = read(site.wxml)
  const json = read(site.json)
  check(`★ ${site.name}：重新进入走 showWelcomeBack`, /showWelcomeBack\(/.test(js),
    '未使用统一提示方法')
  // 断言的是**代码**而不是注释（组件文档里会提到这条旧文案）
  check(`★ ${site.name}：不再用原生 toast 说「已重新进入」`, !/已重新进入/.test(stripComments(js)),
    '原生 toast 又回来了（系统样式与主视觉脱节）')
  check(`${site.name}：已挂 <app-toast>`, /<app-toast/.test(wxml) && /bind:close="onToastClose"/.test(wxml))
  check(`${site.name}：已注册 app-toast`, /"app-toast":\s*"\/components\/AppToast\/index"/.test(json))
  check(`${site.name}：文案是「欢迎回来」口径`, /欢迎回来/.test(js))
}

// 全仓不再出现原生「已重新进入」（被点名的文案）—— 剥注释后再判，只扫代码文件
{
  const hits = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const p = join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.(js|wxml)$/.test(e.name)) continue
      if (/已重新进入/.test(stripComments(readFileSync(p, 'utf8')))) hits.push(relative(ROOT, p))
    }
  }
  for (const d of ['miniprogram/pages', 'miniprogram/subpackages', 'miniprogram/components']) walk(resolve(ROOT, d))
  check('★ 全仓不再出现原生「已重新进入」提示', hits.length === 0, hits.join(', '))
}

/* ── 输出 / 自检 ─────────────────────────────────────────────────────────── */
if (process.argv.includes('--selftest')) {
  selftest()
} else if (failed) {
  console.log('✗ 提示主视觉检查失败：')
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`✗ ${failed} 项失败 / ${passed} 项通过`)
  process.exit(1)
} else {
  console.log(`✓ 提示主视觉：${passed} 项通过（令牌与 AppModal 同源 / 非阻塞 / 四处接线走 AppToast）`)
}

function selftest() {
  const injections = [
    {
      name: '我的页退回原生 toast「已重新进入」',
      file: SITES[0].js,
      from: '        this.showWelcomeBack();',
      to: "        wx.showToast({ title: '已重新进入', icon: 'none' });"
    },
    {
      name: '轻提示开始拦点击（丢掉 pointer-events: none）',
      file: TOAST_WXSS,
      from: '  pointer-events: none;',
      to: ''
    },
    {
      name: '轻提示挂上 catchtouchmove（会吃滚动）',
      file: TOAST_WXML,
      from: '  wx:if="{{visible}}"\n>',
      to: '  wx:if="{{visible}}"\n  catchtouchmove="noop"\n>'
    },
    {
      name: 'toast 描边与 AppModal 漂移（视觉不再同源）',
      file: TOAST_WXSS,
      from: 'border: 1rpx solid rgba(196, 167, 108, 0.55);',
      to: 'border: 1rpx solid rgba(196, 167, 108, 0.25);'
    },
    {
      name: '券夹面板漏注册 app-toast',
      file: SITES[1].json,
      from: '    "app-toast": "/components/AppToast/index"',
      to: '    "app-toast-x": "/components/AppToast/index"'
    }
  ]
  let bad = 0
  for (const inj of injections) {
    const abs = resolve(ROOT, inj.file)
    const orig = readFileSync(abs, 'utf8')
    const hits = orig.split(inj.from).length - 1
    if (hits !== 1) {
      console.log(`✗ 锚点不唯一（命中 ${hits} 次）：${inj.name}`)
      bad += 1
      continue
    }
    writeFileSync(abs, orig.replace(inj.from, inj.to))
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
    writeFileSync(abs, orig)
    if (readFileSync(abs, 'utf8') !== orig) {
      console.log(`✗ 未能逐字还原：${inj.file}`)
      bad += 1
      continue
    }
    if (r.status === 0) {
      console.log(`✗ 注入回归未被检出：${inj.name}`)
      bad += 1
    } else {
      console.log(`  ✓ 已检出：${inj.name}`)
    }
  }
  if (bad) {
    console.log(`✗ 自检失败：${bad} 项`)
    process.exit(1)
  }
  console.log(`✓ 自检通过：${injections.length} 条注入全部被检出、源文件逐字还原`)
}
