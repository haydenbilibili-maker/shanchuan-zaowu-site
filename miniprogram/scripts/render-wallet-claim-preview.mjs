#!/usr/bin/env node
/**
 * 券夹「可领取」区块 · 离线版式预览（开发工具，不参与守卫 / check:admin）
 * 结构从真 WXML 现读：页头 + 可领取区块按注释锚点截段；持有券卡取 <template name="coupon-card"> 的模板体逐张渲染
 * （wxml-preview 不支持 template，这里把 is= 展开成同一份模板体）。样式从真 WXSS 现读；无头 Chrome 750px 视口截图。
 * AppToast 是自定义组件，预览器整棵跳过。字体与真机不同，只看版式，不能替代真机验收。
 *
 * 用法：node miniprogram/scripts/render-wallet-claim-preview.mjs [--out-dir <dir>]
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderWxml } from './lib/wxml-preview.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const PANEL = join(MP, 'subpackages/business/components/WalletPanelCoupons')
const argOf = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const outDir = argOf('--out-dir', join(tmpdir(), 'wallet-claim-preview'))
mkdirSync(outDir, { recursive: true })

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

const rpx2px = (t) => t.replace(/(\d*\.?\d+)rpx/g, '$1px')
const read = (p) => readFileSync(p, 'utf8')
function cut(src, startMark, endMark) {
  const s = src.indexOf(startMark)
  if (s < 0) throw new Error(`锚点缺失：${startMark}`)
  const e = src.indexOf(endMark, s + 1)
  if (e < 0) throw new Error(`结束锚点缺失：${endMark}`)
  return src.slice(s, e)
}

const wxml = read(join(PANEL, 'index.wxml'))
const head = cut(wxml, '<view class="header">', '<!-- 可领取：')
const claimBlock = cut(wxml, '<!-- 可领取：', '<!-- 可用券：平铺 -->')
const cardTpl = cut(wxml, '<template name="coupon-card">', '</template>').replace('<template name="coupon-card">', '')

const usableList = (items) => items.length
  ? `<view class="coupon-list">${items.map((item) => renderWxml(cardTpl, { item }, { lenient: true })).join('')}</view>`
  : ''

const CLAIM = {
  _id: 'c11', title: '双十一 · 全场八折券', type: 'discount', value: 8, minSpend: 0, channel: 'all',
  faceLabel: '8折', channelLabel: '门店+线上', expireText: '有效期至 2026.11.15', limitText: '每人限领 1 张',
  claimed: false, claimError: ''
}
const HELD_GIFT = {
  _id: 'u0', title: '新客礼 · 满 199 减 20', value: 20, minSpend: 199, faceLabel: '¥20', channel: 'all', channelLabel: '门店+线上',
  expireDate: '2026.11.28', canUse: true, canUseOnline: true, canUseStore: true, useLabel: '去使用', sourceLabel: '新客礼', costPoints: 0
}
const HELD_1111 = {
  _id: 'u1', title: '双十一 · 全场八折券', value: 8, minSpend: 0, faceLabel: '8折', channel: 'all', channelLabel: '门店+线上',
  expireDate: '2026.11.15', canUse: true, canUseOnline: true, canUseStore: true, useLabel: '去使用', sourceLabel: '', costPoints: 0
}

const page = (data, held) =>
  `<view class="container">${renderWxml(head + claimBlock, data, { lenient: true })}${usableList(held)}</view>`

const scenes = [
  {
    name: '1-有可领券', h: 760,
    body: () => page({ usableCouponCount: 1, closedCount: 0, expiringCount: 0, claimables: [CLAIM], claimingId: '' }, [HELD_GIFT])
  },
  {
    name: '2-领取后', h: 980,
    body: () => page({ usableCouponCount: 2, closedCount: 0, expiringCount: 0, claimables: [{ ...CLAIM, claimed: true }], claimingId: '' }, [HELD_1111, HELD_GIFT])
  },
  {
    name: '3-无可领券', h: 520,
    body: () => page({ usableCouponCount: 1, closedCount: 0, expiringCount: 0, claimables: [], claimingId: '' }, [HELD_GIFT])
  }
]

function appTokens() {
  const app = read(join(MP, 'app.wxss'))
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

const CSS = rpx2px(read(join(PANEL, 'index.wxss')))

async function shoot(scene, idx) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
:root { ${appTokens()} }
html, body { margin: 0; padding: 0; width: 750px; min-height: ${scene.h}px; background: #1A1814; color: #fff; font-family: -apple-system, "PingFang SC", sans-serif; }
text { display: inline; }
</style><style>${CSS.replace(/(^|[^.\w-])page\s*\{/g, '$1body {')}</style><style>
.container { padding: 24px 32px 40px; box-sizing: border-box; min-height: 0 !important; }
</style></head><body>${scene.body()}</body></html>`
  const htmlPath = join(tmpdir(), `wallet-claim-${process.pid}-${idx}.html`)
  writeFileSync(htmlPath, html)
  const out = join(outDir, `${scene.name}.png`)
  if (existsSync(out)) rmSync(out)
  const profile = mkdtempSync(join(tmpdir(), 'wallet-claim-preview-'))
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--hide-scrollbars', '--force-device-scale-factor=1', '--virtual-time-budget=2000',
    `--window-size=750,${scene.h}`, `--screenshot=${out}`, `file://${htmlPath}`
  ], { stdio: 'ignore' })
  const deadline = Date.now() + 60000
  let lastSize = -1
  while (Date.now() < deadline) {
    const size = existsSync(out) ? statSync(out).size : 0
    if (size > 1000 && size === lastSize) break
    lastSize = size
    await new Promise((r) => setTimeout(r, 400))
  }
  try { child.kill('SIGKILL') } catch { /* ignore */ }
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
  try { rmSync(htmlPath) } catch { /* ignore */ }
  if (!existsSync(out)) throw new Error(`截图未生成：${scene.name}`)
  console.log(`✓ ${scene.name} → ${out}`)
}

for (const [i, s] of scenes.entries()) await shoot(s, i)
