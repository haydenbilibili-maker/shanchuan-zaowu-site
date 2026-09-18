/**
 * 购物车结算栏预览（开发工具，不进 check:admin）
 *
 * 为什么需要：结账台顺手件 + 免邮凑单行都是**版式**改动 —— 静态断言只能证明「类名在、文案对」，
 * 证明不了「摆进结算栏不挤、不溢出、不遮住结算按钮」（本仓库 E8：版式类必须真图复核）。
 *
 * 做法：同一份 `pages/cart/index.wxss` + 手搭结算栏骨架（数据用真实形态代入），
 * 无头 Chrome 截图。rpx 按 1:1 当 px（750 设计稿宽）。
 *
 * 用法：node miniprogram/scripts/render-cart-checkout-preview.mjs [--case both|addon|freeship]
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const WXSS = resolve(ROOT, 'miniprogram/pages/cart/index.wxss')

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean)

const argv = process.argv.slice(2)
const argOf = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const which = argOf('--case', 'both')
const out = argOf('--out', join(tmpdir(), `cart-checkout-${which}.png`))

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chrome) {
  console.error('✗ 未找到 Chrome（可用 CHROME_PATH 指定）——预览工具，不参与守卫')
  process.exit(1)
}

// 真实形态的数据（标题长度刻意取偏长的一档，用来暴露溢出）
// case=empty：购物车进入时的默认状态（合计 ¥0，所有条目 selected:false）
const isEmpty = which === 'empty'
const addon = { title: '蝴蝶标本·绿带翠凤蝶（低价植物标本）', priceText: '¥9.90', image: '' }
const freeShip = isEmpty
  ? {
    reached: false,
    gapTitle: '藏品满 ¥500 免运费',
    detailText: '顺丰 · 藏品满 ¥500 包邮，当前运费 ¥18',
    progress: 0,
    fillerText: ''
  }
  : {
    reached: false,
    gapTitle: '再买 ¥38.00 免运费',
    detailText: '顺丰 · 藏品满 ¥500 包邮，当前运费 ¥18',
    progress: 92,
    fillerText: '凑单：加 ¥9.90「蝴蝶标本·绿带翠凤蝶」即免邮'
  }
const totalText = isEmpty ? '¥0.00' : '¥462.00'

const rpx2px = (text) => text.replace(/(\d*\.?\d+)rpx/g, '$1px')

/** 真实设计令牌：取自 app.wxss 的 `page { … }` 块（浏览器里没有 page 元素，改写成 :root） */
function appTokens() {
  const app = readFileSync(resolve(ROOT, 'miniprogram/app.wxss'), 'utf8')
  const start = app.indexOf('page {')
  if (start < 0) return ''
  let depth = 0
  for (let i = app.indexOf('{', start); i < app.length; i += 1) {
    if (app[i] === '{') depth += 1
    else if (app[i] === '}') {
      depth -= 1
      if (depth === 0) return rpx2px(app.slice(app.indexOf('{', start) + 1, i))
    }
  }
  return ''
}

const css = rpx2px(readFileSync(WXSS, 'utf8'))

const addonHtml = which === 'freeship' ? '' : `
    <div class="addon-strip">
      <div class="addon-thumb-wrap">
        <div class="addon-thumb-ph"><div class="addon-thumb-ph-icon"></div></div>
      </div>
      <div class="addon-copy">
        <span class="addon-title">${addon.title}</span>
        <span class="addon-reason">10 元以下 · 结账台上随手带一件</span>
      </div>
      <span class="addon-price">${addon.priceText}</span>
      <div class="addon-cta"><span>带走</span></div>
      <div class="addon-close">×</div>
    </div>`

const freeshipHtml = which === 'addon' ? '' : `
    <div class="freeship-row">
      <div class="freeship-head">
        <span class="freeship-gap">${freeShip.gapTitle}</span>
        <span class="freeship-rule">${freeShip.detailText}</span>
      </div>
      <div class="freeship-track"><div class="freeship-fill" style="width: ${freeShip.progress}%;"></div></div>
      ${freeShip.fillerText ? `<div class="freeship-filler">
        <span class="freeship-filler-text">${freeShip.fillerText}</span>
        <span class="freeship-filler-cta">加购 →</span>
      </div>` : ''}
    </div>`

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root {
  /* 真令牌来自 app.wxss（下面注入）；这里只补浏览器环境缺的 */
  --tabbar-offset: 0px;
  --font-mono: "SF Mono", Menlo, monospace;
  --space-3: 12px; --space-4: 16px; --space-5: 20px;
  ${appTokens()}
}
html, body { margin: 0; padding: 0; }
body { background: #121110; padding: 20px; }
.phone { width: 750px; }
/* 结算栏在页面里是 fixed，这里改成静态以便截图 */
.checkout-bar { position: static !important; }
</style><style>${css}</style></head>
<body><div class="phone"><div class="checkout-bar safe-area">
${addonHtml}
    <div class="coupon-chip"><span>选择礼券</span></div>
    <div class="bar-main">
      <div class="select-all"><div class="gold-checkbox sm checked"><div class="tick"></div></div><span class="select-label">全选</span></div>
      <div class="total-block">
        <div class="total-row"><span class="total-hint">会员 -¥12.00</span><span class="total-hint">礼券 -¥10.00</span></div>
        <div class="total-main"><span class="total-label">合计</span><span class="total-val">${totalText}</span></div>
      </div>
      <div class="checkout-btn${isEmpty ? ' disabled' : ''}"><span>付款入藏</span><span class="checkout-count">${isEmpty ? '' : '(3)'}</span></div>
    </div>
${freeshipHtml}
</div></div></body></html>`

const htmlPath = join(tmpdir(), `cart-checkout-${process.pid}.html`)
writeFileSync(htmlPath, html)

const profile = mkdtempSync(join(tmpdir(), 'sc-cart-preview-'))
if (existsSync(out)) rmSync(out)
const child = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--no-default-browser-check', `--user-data-dir=${profile}`,
  '--hide-scrollbars', '--force-device-scale-factor=1',
  '--window-size=800,460', `--screenshot=${out}`, `file://${htmlPath}`
], { stdio: 'ignore' })

const deadline = Date.now() + 20000
while (Date.now() < deadline) {
  if (existsSync(out) && statSync(out).size > 1000) break
  await new Promise((r) => setTimeout(r, 250))
}
try { child.kill('SIGKILL') } catch { /* ignore */ }
try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
if (!existsSync(out)) {
  console.error('✗ 截图未生成')
  process.exit(1)
}
console.log(`✓ ${which} → ${out}（${Math.round(statSync(out).size / 1024)}KB）`)
