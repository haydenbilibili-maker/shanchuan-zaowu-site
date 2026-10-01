/**
 * B 流（C 端交易与「我的」）细节雕刻预览台（开发工具，不进守卫链）
 *
 * 一次起一个 Chrome，把若干「面板」排进同一张图：每个面板是一个 iframe，
 * 只加载**该页真实的 wxss**（rpx 按 1:1 当 px，令牌取自 app.wxss 的 page 块），
 * 骨架照 wxml 的类名手搭、数据用真实形态代入。证明的是「结构与排版」，
 * 证明不了真机 rpx 精度与原生组件（E8 / E26）。
 *
 * 用法：node miniprogram/scripts/render-bflow-preview.mjs --round 1 [--out <png>]
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const MP = resolve(ROOT, 'miniprogram')

const argv = process.argv.slice(2)
const argOf = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const round = argOf('--round', '1')
const out = argOf('--out', join(tmpdir(), `bflow-round${round}.png`))

const chrome = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean).find((p) => existsSync(p))
if (!chrome) {
  console.error('✗ 未找到 Chrome（可用 CHROME_PATH 指定）——预览工具，不参与守卫')
  process.exit(1)
}

const rpx2px = (text) => text.replace(/(\d*\.?\d+)rpx/g, '$1px')
const wxss = (rel) => rpx2px(readFileSync(resolve(MP, rel), 'utf8'))
  .replace(/@import[^;]+;/g, '')
  .replace(/(^|[\s,}])page(\s*[{,])/g, '$1body$2')

function appTokens() {
  const app = readFileSync(resolve(MP, 'app.wxss'), 'utf8')
  const start = app.indexOf('page {')
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
const TOKENS = appTokens()

const BOX = '<div class="ph-box"></div>'
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

/** 一个面板 = 标题 + 宽 375 的 iframe（内部按 750 设计稿排，再缩 0.5） */
function panel(title, cssFiles, body, height = 900, extraCss = '') {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>
:root { ${TOKENS} --font-mono: "SF Mono", Menlo, monospace; }
html, body { margin: 0; padding: 0; width: 750px; background: #1A1814; font-family: "PingFang SC", sans-serif; }
view, text { display: block; }
*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; }
.ph-box { width: 100%; height: 100%; background: repeating-linear-gradient(45deg,#3a352c 0 6px,#2f2b24 6px 12px); }
</style>${cssFiles.map((f) => `<style>${wxss(f)}</style>`).join('')}<style>${extraCss}</style></head><body>${body}</body></html>`
  return `<figure><figcaption>${title}</figcaption>
<iframe srcdoc="${esc(doc)}" style="width:750px;height:${height}px;transform:scale(.5);transform-origin:0 0;margin-bottom:-${height / 2}px;margin-right:-375px"></iframe></figure>`
}

const ROUNDS = {
  1: () => [
    panel('订单列表 · 多件 + 缺图占位 + 支付中', ['subpackages/business/orders/index.wxss'], `
<div class="container"><div class="archive-cabinet"><div class="order-list">
  <div class="order-card">
    <div class="card-head"><span class="order-no">NO.SH20261001001</span>
      <div class="status-stamp pending_pay"><div class="stamp-inner"><span class="cn">待付款</span><span class="en">TO PAY</span></div></div></div>
    <div class="card-body">
      <div class="prod-img-wrap"><div class="prod-img prod-img-ph">${BOX}</div><div class="prod-more">共 3 件</div></div>
      <div class="prod-info"><span class="prod-name">海伦闪蝶 · 博物级标本框</span><span class="prod-latin">Morpho helenor</span><div class="sku-tag">× 1</div></div>
    </div>
    <div class="card-foot"><div class="total-box"><span class="lbl">合计</span><span class="val">¥1,288.00</span></div>
      <div class="btn-group" style="display:flex; gap:20px;"><div class="btn-action primary is-busy">支付中…</div></div></div>
  </div>
  <div class="order-card">
    <div class="card-head"><span class="order-no">NO.SH20260920017</span>
      <div class="status-stamp received"><div class="stamp-inner"><span class="cn">已签收</span><span class="en">SIGNED</span></div></div></div>
    <div class="card-body">
      <div class="prod-img-wrap"><div class="prod-img">${BOX}</div></div>
      <div class="prod-info"><span class="prod-name">绿带翠凤蝶</span><div class="sku-tag">× 2</div></div>
    </div>
    <div class="card-foot"><div class="total-box"><span class="lbl">合计</span><span class="val">¥376.00</span></div>
      <div class="btn-group" style="display:flex; gap:20px;"><div class="btn-action">写下感受</div><div class="btn-action gold">查看详情</div></div></div>
  </div>
  <div class="order-card">
    <div class="card-head"><span class="order-no">NO.SH20260912003</span>
      <div class="status-stamp cancelled"><div class="stamp-inner"><span class="cn">已取消</span><span class="en">OPEN</span></div></div></div>
    <div class="card-body">
      <div class="prod-img-wrap"><div class="prod-img">${BOX}</div></div>
      <div class="prod-info"><span class="prod-name">琥珀原石摆件</span><div class="sku-tag">× 1</div></div>
    </div>
    <div class="card-foot"><div class="total-box"><span class="lbl">合计</span><span class="val">¥88.00</span></div></div>
  </div>
</div>
<div class="empty-state"><div class="safe-box-icon"><div class="lock"></div></div>
  <span class="empty-title">没有待付款的订单</span><span class="empty-desc">下单后未完成支付的会停在这里</span>
  <div class="empty-cta">去逛逛</div></div>
</div></div>`, 1500),
    panel('订单详情 · 账单（7 折 + 定金抵扣）+ 支付中', ['subpackages/business/order-detail/index.wxss'], `
<div class="container" style="padding:30px">
  <div class="finance-section">
    <div class="f-row"><span>藏品合计</span><span>¥ 1,000.00</span></div>
    <div class="f-row highlight"><span>会员折扣（7折）</span><span>- ¥ 300.00</span></div>
    <div class="f-row highlight"><span>礼券抵扣</span><span>- ¥ 20.00</span></div>
    <div class="f-row"><span>运费</span><div class="shipping-fee-cell gold-txt"><span>免邮</span></div></div>
    <div class="f-divider"></div>
    <div class="f-total"><span>定金金额</span><span class="gold-txt">¥ 680.00</span></div>
    <div class="f-row highlight "><span>已付定金抵扣</span><span>- ¥ 200.00</span></div>
  </div>
  <div class="pending-pay-actions" style="margin-top:40px">
    <div class="btn-text cancel">取消订单</div>
    <div class="hologram-btn flex-grow is-busy"><span>正在拉起支付…</span></div>
  </div>
</div>`, 520),
    panel('购物车 · 礼券弹层（无门槛 / 空态）', ['pages/cart/index.wxss'], `
<div class="sheet-panel" style="position:static">
  <div class="sheet-drag-handle"></div><div class="sheet-header">选择礼券</div>
  <div class="sheet-list" style="height:auto">
    <div class="sheet-item"><span class="sheet-item-name">不使用礼券</span><div class="radio"></div></div>
    <div class="sheet-item selected"><div class="cp-left"><span class="cp-val">¥20</span><div class="cp-meta"><span class="cp-name">新人礼券</span><span class="cp-cond">无门槛</span><span class="cp-save">本单可省 ¥20</span></div></div><div class="radio checked"><div class="radio-dot"></div></div></div>
    <div class="sheet-item disabled"><div class="cp-left"><span class="cp-val">¥50</span><div class="cp-meta"><span class="cp-name">满减礼券</span><span class="cp-cond">满 ¥299 可用</span><span class="cp-save is-off">满 ¥299 可用，本单未达门槛</span></div></div><div class="radio"></div></div>
  </div>
</div>
<div class="sheet-panel" style="position:static;margin-top:24px">
  <div class="sheet-header">选择礼券（无券时）</div>
  <div class="sheet-list" style="height:auto">
    <div class="sheet-item selected"><span class="sheet-item-name">不使用礼券</span><div class="radio checked"><div class="radio-dot"></div></div></div>
    <div class="sheet-empty">暂无可用礼券</div>
  </div>
</div>`, 900),
    panel('确认下单 · 缺图占位 + 运费说明 + 礼券门槛', ['subpackages/business/confirm-order/index.wxss'], `
<div class="page" style="padding:24px">
  <div class="card"><div class="section-label">藏品清单</div>
    <div class="goods-item"><div class="goods-img-wrap"><div class="goods-img goods-img-ph">${BOX}</div></div>
      <div class="goods-info"><span class="goods-title">蓝闪蝶 · A1 博物级</span><span class="goods-latin">Morpho menelaus</span>
        <div class="goods-row"><span class="goods-price">¥468</span><span class="goods-count">×1</span></div></div></div>
  </div>
  <div class="card bill-card"><div class="section-label">账单</div>
    <div class="row-item"><span class="row-label">藏品合计</span><span class="row-value mono">¥468.00</span></div>
    <div class="row-item"><span class="row-label">礼券</span><div class="row-value"><span class="coupon-hint muted">2 张可用</span><span class="row-arrow">›</span></div></div>
    <div class="row-item"><span class="row-label">运费（顺丰）</span><div class="row-value"><span class="mono">¥18.00</span></div></div>
    <div class="shipping-tip">藏品满 ¥500 包邮，再买 ¥32.00 免运费</div>
    <div class="row-item total-row"><span class="row-label total-label">应付</span><span class="total-price">¥486.00</span></div>
    <span class="summary-foot-hint">尾款将通过微信支付</span>
  </div>
  <div class="modal-panel" style="position:static">
    <div class="coupon-opt"><div class="c-left"><span class="c-val">¥20</span><span class="c-min">无门槛</span></div><div class="c-right"><span class="c-name">新人礼券</span><span class="c-save">本单可省 ¥20</span></div><div class="radio"></div></div>
    <div class="coupon-opt disabled"><div class="c-left"><span class="c-val">¥50</span><span class="c-min">满 ¥599 可用</span></div><div class="c-right"><span class="c-name">满减礼券</span><span class="c-save is-off">满 ¥599 可用，本单未达门槛</span></div><div class="radio"></div></div>
  </div>
</div>`, 1100)
  ]
}

const build = ROUNDS[round]
if (!build) {
  console.error(`✗ 未定义第 ${round} 轮面板`)
  process.exit(1)
}
const panels = build()
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body { margin: 0; padding: 16px; background: #0d0c0b; color: #ddd; font: 13px -apple-system, sans-serif; display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
figure { margin: 0; width: 375px; } figcaption { margin-bottom: 6px; color: #C4A76C; }
iframe { border: 0; display: block; background: #1A1814; }
</style></head><body>${panels.join('')}</body></html>`

const htmlPath = join(tmpdir(), `bflow-${process.pid}.html`)
writeFileSync(htmlPath, html)
const profile = mkdtempSync(join(tmpdir(), 'sc-bflow-preview-'))
if (existsSync(out)) rmSync(out)
const child = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--no-default-browser-check', `--user-data-dir=${profile}`,
  '--hide-scrollbars', '--force-device-scale-factor=2',
  `--window-size=${16 + panels.length * 391},820`, '--virtual-time-budget=3000',
  `--screenshot=${out}`, `file://${htmlPath}`
], { stdio: 'ignore' })

const deadline = Date.now() + 30000
while (Date.now() < deadline) {
  if (existsSync(out) && statSync(out).size > 1000) break
  await new Promise((r) => setTimeout(r, 250))
}
try { child.kill('SIGKILL') } catch { /* ignore */ }
try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
try { rmSync(htmlPath) } catch { /* ignore */ }
if (!existsSync(out)) {
  console.error('✗ 截图未生成')
  process.exit(1)
}
console.log(`✓ round ${round} → ${out}（${Math.round(statSync(out).size / 1024)}KB）`)
