#!/usr/bin/env node
/**
 * 会员卡「信封态」离线预览渲染（开发工具，**不在 check:admin 里**）
 *
 * 为什么需要它：真机/开发者工具之外，`components/UserVipCard` 的信封与封蜡**没有任何办法用眼睛看**——
 * 静态检查能证明「样式规则存在」，证明不了「看起来像信封」。本仓库已经被「静态分析 ≠ 事实」坑过多次
 * （见 AGENTS.md），而会员卡信封恰好连着两轮都是**肉眼反馈**（封盖看不见 / 蜡像红圆片）。
 *
 * 做法：把真源码（同一份 WXSS + WXML）转成 HTML —— rpx 按 1:1 当 px，WXML 标签换成 HTML 标签，
 * `{{}}` 绑定按状态求值 —— 再用本机无头 Chrome 截图。零依赖（复用 admin/scripts/lib/cdp.mjs 的 Chrome 定位思路）。
 *
 * 用法：
 *   node miniprogram/scripts/render-vip-card-preview.mjs                       # 退出登录态 · 封缄态
 *   node miniprogram/scripts/render-vip-card-preview.mjs --state guest         # 未注册态
 *   node miniprogram/scripts/render-vip-card-preview.mjs --phase lid --out /tmp/open.png
 * 参数：--state loggedOut|guest   --phase idle|seal|lid|done   --out <png>
 */
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const WXSS = resolve(ROOT, 'miniprogram/components/UserVipCard/index.wxss')
const WXML = resolve(ROOT, 'miniprogram/components/UserVipCard/index.wxml')
const ASSETS = resolve(ROOT, 'miniprogram/assets')

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean)

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const state = argOf('--state', 'loggedOut')
const phase = argOf('--phase', 'idle')
const out = argOf('--out', join(tmpdir(), `vip-card-envelope-${state}-${phase}.png`))
const loggedOut = state === 'loggedOut'

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chrome) {
  console.error('✗ 未找到 Chrome（可用 CHROME_PATH 指定）——本工具只做预览，不参与守卫')
  process.exit(1)
}

/* ---------- WXSS → CSS（只取信封段；rpx 按 1:1 当 px，750 设计稿宽 ↔ 686px 卡） ---------- */
const wxss = readFileSync(WXSS, 'utf8')
const guestCss = wxss.slice(wxss.indexOf('/* === 需求 20')).replace(/(\d*\.?\d+)rpx/g, '$1px')

/* ---------- WXML → HTML（解绑定 + 换标签） ---------- */
let markup = readFileSync(WXML, 'utf8')
markup = markup.slice(markup.indexOf('<!-- 0. 未注册'), markup.indexOf('<!-- 1. 光感会员卡'))
markup = markup
  .replace(/\{\{guestLoggedOut \? '([^']*)' : '([^']*)'\}\}/g, (_, a, b) => (loggedOut ? a : b))
  .replace(/phase-\{\{ritePhase\}\}/g, `phase-${phase}`)
  .replace(/\{\{butterflyAlert \? 'is-alert' : ''\}\}/g, '')
  .replace(/\swx:if="\{\{[^}]*\}\}"/g, '')
  .replace(/\s(?:bind|catch)[a-z]*="[^"]*"/g, '')
  .replace(/\shover-class="[^"]*"/g, '')
  .replace(/\shover-stay-time="[^"]*"/g, '')
  .replace(/\saria-[a-z]+="[^"]*"/g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  // WXML 标签 → HTML：不换的话 <view> 是未知元素、默认 inline，整个卡面会塌成一列
  .replace(/<view/g, '<div')
  .replace(/<\/view>/g, '</div>')
  .replace(/<text/g, '<span')
  .replace(/<\/text>/g, '</span>')
  .replace(/<image([^>]*?)\s*\/?>/g, '<img$1>')
  // file:// 下解析不了小程序绝对路径，换成真文件
  .replace(/src="\/assets\//g, `src="file://${ASSETS}/`)

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root {
  --radius-lg: 22px;
  --radius-md: 14px;
  --font-brand: "Songti SC", "STSong", serif;
  --font-mono: "SF Mono", Menlo, monospace;
  --color-text-muted: #6B6560;
  --color-text-secondary: #A09A90;
  --brass-100: #F0E6CC;
  --brass-300: #D4BC85;
  --brass-400: #C4A76C;
}
html, body { margin: 0; padding: 0; }
body { background: #1A1814; padding: 26px; }
.vip-card-container { width: 686px; height: 448px; }
${guestCss}
</style></head>
<body><div class="vip-card-container guest-card-wrap">${markup}</div></body></html>`

const htmlPath = join(tmpdir(), `vip-card-preview-${process.pid}.html`)
writeFileSync(htmlPath, html)

/* ---------- 无头 Chrome 截图（新版 headless 写完图会以非 0 退出 → spawn + 轮询产物） ---------- */
const profile = mkdtempSync(join(tmpdir(), 'sc-vip-preview-'))
if (existsSync(out)) rmSync(out)
const child = spawn(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${profile}`,
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--window-size=740,500',
  `--screenshot=${out}`,
  `file://${htmlPath}`
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
console.log(`✓ ${state} / ${phase} → ${out}（${Math.round(statSync(out).size / 1024)}KB）`)
