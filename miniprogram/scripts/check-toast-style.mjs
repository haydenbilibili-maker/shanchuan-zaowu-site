/**
 * 提示（toast）主视觉一致性守卫
 *
 * 背景（2026-09-17 真机反馈）：重新进入成功时弹的是**原生** `wx.showToast` →「已重新进入」，
 * 系统样式就是一个裸的深色圆角框，在博物黑 + 铜金的界面里非常突兀。
 * 这类反馈恰恰出现在顾客注意力最集中的一刻，必须与主视觉一致。
 *
 * 本守卫钉住四件事：
 *   ① 视觉同源：`components/AppToast` 的关键令牌必须与 `components/AppModal` **逐字相同**
 *      （铜金描边 / 渐变黑底 / 圆角），否则「一致」会随时间漂移；
 *   ② 非阻塞：轻提示不得拦点击或滚动（`pointer-events: none`，且不 catchtouchmove）——
 *      提示归提示，不能挡住用户手里的动作；
 *   ③ 接线：四个「重新进入」入口（我的页 / 券夹 / 钱包 / 地址）都走 AppToast，
 *      且全仓不再出现原生「已重新进入」文案。
 *   ④ **字阶令牌（契约 C7 §1）**：`app.wxss` 必须定义全部 14 档 `--fs-*`，
 *      且两个统一组件（AppModal / AppToast）的 `font-size` **必须**引用在册令牌、不得写字面量。
 *      为什么钉在这里：这两个组件是全站弹层/提示的母版，它们自己带离群字号（27rpx/29rpx）
 *      会被 124 个页面照抄 —— 令牌落地必须先钉住母版（契约 C7 §0 冻结项 ①）。
 *
 * 用法：
 *   node miniprogram/scripts/check-toast-style.mjs
 *   node miniprogram/scripts/check-toast-style.mjs --selftest
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

const APP_WXSS = 'miniprogram/app.wxss'
const TOAST_WXSS = 'miniprogram/components/AppToast/index.wxss'
const TOAST_WXML = 'miniprogram/components/AppToast/index.wxml'
const MODAL_WXSS = 'miniprogram/components/AppModal/index.wxss'

/** 契约 C7 §1.1 的字阶令牌（命名即尺寸；改这套必须同步改契约文档与这里） */
export const FS_TOKENS = [16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 40, 44, 48]
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

/* ── 1) 视觉同源：两个母版的牌面都取 app.wxss 同一组弹层令牌 ────────────────
 * 2026-10-13 弹层规范（docs/弹层视觉规范_2026-10-13.md）：事实源从「两份逐字相同的字面量」
 * 收到 app.wxss 的 --pop-* 令牌 —— AppModal 用全局零件 .ui-pop-dialog，AppToast 牌面直接引用令牌。
 * 判据：令牌在 app.wxss 定义且 .ui-pop-dialog 引用它；AppToast 引用同一令牌；两者都不再写字面量牌面。 */
const appWxssAll = read(APP_WXSS)
const modalWxml = read('miniprogram/components/AppModal/index.wxml')
const popDialog = (stripComments(appWxssAll).match(/\n\.ui-pop-dialog\s*\{([^}]*)\}/) || [, ''])[1]  // 行首独立规则（不取 .is-toggle .ui-pop-dialog 这类变体）
const TOKENS = [
  ['发丝金描边', '--pop-hairline', /border:\s*1rpx solid var\(--pop-hairline\);/],
  ['渐变黑底', '--pop-surface', /background:\s*var\(--pop-surface\);/],
  ['投影', '--pop-shadow-dialog', /box-shadow:\s*var\(--pop-shadow-dialog\);/],
  ['圆角', '--pop-radius-dialog', /border-radius:\s*var\(--pop-radius-dialog\);/]
]
check('★ AppModal 牌面用全局零件 ui-pop-dialog', /class="ui-pop-dialog\b/.test(modalWxml))
for (const [label, token, re] of TOKENS) {
  check(`★ app.wxss 定义了弹层令牌 ${token}`, new RegExp(`${token}\\s*:`).test(appWxssAll), token)
  check(`★ ${label}：AppModal（ui-pop-dialog）与 AppToast 同取 ${token}`, re.test(popDialog) && re.test(toastWxss),
    `ui-pop-dialog=${re.test(popDialog)} AppToast=${re.test(toastWxss)}`)
}
check('AppToast 用品牌衬线字体做标题', /font-family:\s*var\(--font-brand\)/.test(toastWxss))
check('★ 牌面不再自带四角铭牌（规范：发丝金框即边界）', !/am-corner|at-corner/.test(toastWxss + read(TOAST_WXML) + modalWxss + modalWxml))
check('★ AppModal 不再自写牌面字面量（只留组件特有样式）', !/linear-gradient\(180deg, #221F1B/.test(stripComments(modalWxss)))

/* ── 1b) 字阶令牌（契约 C7 §1）：母版不得自带离群字号 ─────────────────────── */
{
  const appWxss = read(APP_WXSS)
  const appNoComment = stripComments(appWxss)
  const missing = FS_TOKENS.filter((n) => !new RegExp(`--fs-${n}\\s*:\\s*${n}rpx\\s*;`).test(appNoComment))
  check('★ app.wxss 定义了全部 14 档 --fs-* 字阶令牌（契约 C7 §1.1）', missing.length === 0,
    missing.length ? `缺 ${missing.map((n) => `--fs-${n}`).join(' / ')}` : '')

  const uiPopBlock = (appWxss.match(/\/\* =+ 弹层[\s\S]*?@keyframes ui-pop-fade/) || [''])[0]
  for (const [label, file, wxss] of [
    ['AppModal', MODAL_WXSS, `${modalWxss}\n${uiPopBlock}`],
    ['AppToast', TOAST_WXSS, toastWxss]
  ]) {
    const body = stripComments(wxss)
    // 判据一：不得出现字面量字号（这是「差 1rpx 噪音」的唯一入口）
    const literals = body.match(/font-size:\s*[0-9][^;]*;/g) || []
    check(`★ ${label} 不得使用字面量 font-size（只许 var(--fs-*)）`, literals.length === 0,
      literals.join(' '))
    // 判据二：引用的令牌必须**在册**（防 --fs-27 这类幻影令牌绕过上一条）
    const used = [...body.matchAll(/var\((--fs-[0-9]+)\)/g)].map((m) => m[1])
    const phantom = used.filter((t) => !FS_TOKENS.includes(Number(t.slice(5))))
    check(`★ ${label} 引用的 --fs-* 全部在册（契约 C7 §1.1 的 14 档）`, phantom.length === 0,
      phantom.join(' '))
    // 判据三：真的用上了（防「删掉所有字号」也算通过）
    check(`${label} 至少引用了 3 处 --fs-* 令牌`, used.length >= 3, `实际 ${used.length} 处`)
  }
}

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

/* ── 输出 / 自检 / 渲染证据 ─────────────────────────────────────────────── */
if (process.argv.includes('--selftest')) {
  selftest()
} else if (process.argv.includes('--render')) {
  await renderPreview()
} else if (failed) {
  console.log('✗ 提示主视觉检查失败：')
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`✗ ${failed} 项失败 / ${passed} 项通过`)
  process.exit(1)
} else {
  console.log(`✓ 提示主视觉：${passed} 项通过（令牌与 AppModal 同源 / 非阻塞 / 四处接线走 AppToast / 字阶令牌已钉住母版）`)
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
      name: 'toast 描边与 AppModal 漂移（写回字面量，视觉不再同源）',
      file: TOAST_WXSS,
      from: 'border: 1rpx solid var(--pop-hairline);',
      to: 'border: 1rpx solid rgba(196, 167, 108, 0.25);'
    },
    {
      name: 'AppModal 牌面脱离全局零件（自写一套）',
      file: 'miniprogram/components/AppModal/index.wxml',
      from: 'class="ui-pop-dialog am-plate"',
      to: 'class="am-plate"'
    },
    {
      name: 'app.wxss 弹层零件改走字面量底色（令牌失效）',
      file: APP_WXSS,
      from: '  background: var(--pop-surface);\n  border: 1rpx solid var(--pop-hairline);\n  border-radius: var(--pop-radius-dialog);',
      to: '  background: #222;\n  border: 1rpx solid var(--pop-hairline);\n  border-radius: var(--pop-radius-dialog);'
    },
    {
      name: '券夹面板漏注册 app-toast',
      file: SITES[1].json,
      from: '    "app-toast": "/components/AppToast/index"',
      to: '    "app-toast-x": "/components/AppToast/index"'
    },
    {
      name: 'app.wxss 丢掉一档字阶令牌（--fs-26）',
      file: APP_WXSS,
      from: '  --fs-26: 26rpx;\n',
      to: ''
    },
    {
      name: '母版开始写死字面量字号（AppToast 25rpx）',
      file: TOAST_WXSS,
      from: '  font-size: var(--fs-24);',
      to: '  font-size: 25rpx;'
    },
    {
      name: '母版引用幻影令牌（AppModal 用不在册的 --fs-27）',
      file: MODAL_WXSS,
      from: '.am-content {\n  display: block;\n  margin-top: 16rpx;\n  font-size: var(--fs-26);',
      to: '.am-content {\n  display: block;\n  margin-top: 16rpx;\n  font-size: var(--fs-27);'
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

/**
 * 渲染证据（E8：视觉/版式类必须真机或真图）—— **开发工具，不在 check:admin 里**
 *
 * 为什么挂在守卫里而不是另建一个 render-*.mjs：本流 owns 的文件只有这一批
 * （见 `docs/并发工作流注册表.json` 的 `visual.owns`），新建文件就越界。
 * 把真源码（真 WXSS + 真 WXML，rpx 按 1:1 当 px）转成 HTML，再用本机无头 Chrome 截图。
 *
 * 用法：
 *   node miniprogram/scripts/check-toast-style.mjs --render                 # → /tmp/app-toast-modal-render.png
 *   node miniprogram/scripts/check-toast-style.mjs --render /tmp/x.png
 *   CHROME_PATH=/path/to/chrome node … --render
 */
async function renderPreview() {
  const outIdx = process.argv.indexOf('--render')
  const out = (process.argv[outIdx + 1] && !process.argv[outIdx + 1].startsWith('--'))
    ? process.argv[outIdx + 1]
    : join(tmpdir(), 'app-toast-modal-render.png')
  const chrome = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium'
  ].filter(Boolean).find((p) => existsSync(p))
  if (!chrome) {
    console.error('✗ 未找到 Chrome（可用 CHROME_PATH 指定）—— --render 只做证据，不参与守门')
    process.exit(1)
  }

  const toPx = (s) => s.replace(/(\d*\.?\d+)rpx/g, '$1px')  // rpx 在浏览器里非法：**令牌值也必须转**
  const pageBlock = (read(APP_WXSS).match(/page\s*\{([\s\S]*?)\n\}/) || [, ''])[1]
  const rootVars = toPx([...pageBlock.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)]
    .map((m) => `  ${m[1]}: ${m[2].trim()};`).join('\n'))

  const uiPopCss = () => (read(APP_WXSS).match(/\.ui-pop-mask \{[\s\S]*?@keyframes ui-pop-fade/) || [''])[0].replace(/@keyframes ui-pop-fade$/, '')
  const toHtml = (wxml, binds) => {
    let s = wxml.replace(/<!--[\s\S]*?-->/g, '')
    for (const [k, v] of Object.entries(binds)) s = s.split(k).join(v)
    return s
      .replace(/\swx:if="\{\{[^}]*\}\}"/g, '')
      .replace(/\s(?:bind|catch)[a-z]*="[^"]*"/g, '')
      .replace(/\shover-[a-z-]+="[^"]*"/g, '')
      .replace(/\suser-select\b/g, '')
      .replace(/<view/g, '<div').replace(/<\/view>/g, '</div>')
      .replace(/<text/g, '<span').replace(/<\/text>/g, '</span>')
  }

  const modal = toHtml(read('miniprogram/components/AppModal/index.wxml'), {
    "{{visible ? 'is-on' : 'is-off'}}": 'is-on',
    '{{overline}}': 'COMPLIMENTARY GIFT',
    '{{title}}': '删除这条收货地址？',
    '{{content}}': '删除后不可恢复。\n如需再次使用，请重新填写。',  // 真换行：证明 pre-wrap
    '{{cancelText}}': '取消',
    '{{confirmText}}': '删除',
    "{{tone === 'danger' ? 'is-danger' : (tone === 'warn' ? 'is-primary is-warn' : 'is-primary')}}": 'is-danger'
  })
  const toast = toHtml(read(TOAST_WXML), {
    "{{leaving ? 'is-out' : 'is-in'}}": 'is-in',
    '{{overline}}': 'WELCOME BACK',
    '{{title}}': '欢迎回来，林淑',
    '{{desc}}': '礼券、积分与成长值都还在'
  })

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
:root {\n${rootVars}\n}
html, body { margin: 0; padding: 0; background: #12100E; }
.stage { display: flex; gap: 26px; padding: 26px; align-items: flex-start; }
/* 750rpx 设计宽 == 750px：字号才与真机同比例 */
.pane { position: relative; width: 750px; height: 560px; background: #151311; border-radius: 8px; overflow: hidden; }
.pane-label { position: absolute; left: 10px; top: 6px; z-index: 9999; color: #C4A76C; font: 11px/1.4 -apple-system, sans-serif; letter-spacing: .08em; }
.pane .am-mask, .pane .at-mask { position: absolute; padding: 16px; }
.pane .am-plate, .pane .at-plate { max-width: none; }
${toPx(uiPopCss())}
${toPx(read(MODAL_WXSS))}
${toPx(read(TOAST_WXSS))}
</style></head><body><div class="stage">
<div class="pane"><div class="pane-label">AppModal · danger（点遮罩不关）</div>${modal}</div>
<div class="pane"><div class="pane-label">AppToast · 非阻塞</div>${toast}</div>
</div></body></html>`

  const htmlPath = join(tmpdir(), `app-toast-modal-${process.pid}.html`)
  writeFileSync(htmlPath, html)
  const profile = mkdtempSync(join(tmpdir(), 'sc-toast-render-'))
  if (existsSync(out)) rmSync(out)
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=1580,620', `--screenshot=${out}`, `file://${htmlPath}`
  ], { stdio: 'ignore' })
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (existsSync(out) && statSync(out).size > 1000) break
    await new Promise((r) => setTimeout(r, 250))
  }
  try { child.kill('SIGKILL') } catch { /* ignore */ }
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
  if (!existsSync(out)) {
    console.error('✗ 截图未生成（Chrome 可能被沙箱拦截）')
    process.exit(1)
  }
  console.log(`✓ 渲染证据 → ${out}（${Math.round(statSync(out).size / 1024)}KB）`)
  console.log('  这是「真源码 + 无头 Chrome」的图，**不等于微信渲染引擎** —— 版式类改动仍需真机验收（E8）')
}
