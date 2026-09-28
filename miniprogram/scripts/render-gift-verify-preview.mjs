#!/usr/bin/env node
/**
 * 礼笺领取核验 · 离线版式预览（开发工具，不参与守卫 / check:admin）
 * 结构从真 WXML 现读（领取页核验面板按注释锚点截取；phone-sheet 组件整份渲染），样式从真 WXSS 现读；
 * 无头 Chrome 以 750px 视口截图（rpx 1:1 当 px）。字体与真机不同，只看版式，不能替代真机验收。
 *
 * 用法：node miniprogram/scripts/render-gift-verify-preview.mjs [--out-dir <dir>]
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderWxml } from './lib/wxml-preview.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const GIFT = join(MP, 'subpackages/feature/gift')
const argOf = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const outDir = argOf('--out-dir', join(tmpdir(), 'gift-verify-preview'))
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

const receiveWxml = read(join(GIFT, 'receive/index.wxml'))
const verifyBlock = cut(receiveWxml, '<!-- 领取核验（N3） -->', '<!-- 先付后填址 -->')
const sheetWxml = read(join(GIFT, 'phone-sheet/index.wxml'))
const pageFrame = (inner) => `<view class="page"><view class="actions">${inner}</view></view>`
const composeWxml = read(join(GIFT, 'compose/index.wxml'))
const composeFrame = `<view class="page">${cut(composeWxml, '<!-- 03 交付方式 -->', '<view class="pack-note">')}</view></view>`
const COMPOSE_DATA = {
  deliveryType: 'invite_address', showOtherDelivery: false, otherDeliveries: [], storePickupEnabled: false,
  stores: [], receiverPhone: '', receiverPhoneFocus: false
}

const RECV_SHEET = {
  show: true, overline: 'VERIFY', title: '输入手机号核验', placeholder: '输入 11 位手机号', value: '',
  desc: '请输入送礼人为你预留的手机号。核验通过即记在你名下；多次不一致会暂时锁定 1 小时。',
  confirmText: '核验', quickText: '', clearText: '', busy: false, localError: ''
}
const GIVER_SHEET = {
  show: true, overline: 'VERIFY', title: '修改领取核验（当前尾号 1234）', placeholder: '输入 11 位手机号', value: '',
  desc: '填入受礼人的手机号。TA 打开礼笺领取时，需用这个号码核验，才会记在 TA 名下。号码只用于比对，不会出现在礼笺与分享卡里。',
  confirmText: '保存', quickText: '沿用收件电话（尾号 5678）', clearText: '不设核验', busy: false, localError: ''
}

const scenes = [
  { name: 'receive-verify', h: 900, body: () => renderWxml(pageFrame(verifyBlock), { verifyNeeded: true, verifyBusy: false, verifyError: '', verifySheet: false }, { lenient: true }) },
  {
    name: 'receive-verify-mismatch', h: 900,
    body: () => renderWxml(pageFrame(verifyBlock), { verifyNeeded: true, verifyBusy: false, verifyError: '与送礼人预留的手机号不一致，还可尝试 3 次', verifySheet: false }, { lenient: true })
  },
  {
    name: 'receive-manual-sheet', h: 1334,
    body: () => renderWxml(pageFrame(verifyBlock), { verifyNeeded: true }, { lenient: true }) +
      renderWxml(sheetWxml, { ...RECV_SHEET, error: '尝试次数过多，请 42 分钟后再试' }, { lenient: true })
  },
  { name: 'giver-set-sheet', h: 1334, body: () => renderWxml(sheetWxml, { ...GIVER_SHEET, error: '' }, { lenient: true }) },
  { name: 'compose-phone-required', h: 900, css: 'compose', body: () => renderWxml(composeFrame, { ...COMPOSE_DATA, receiverPhoneError: '' }, { lenient: true }) },
  { name: 'compose-phone-error', h: 900, css: 'compose', body: () => renderWxml(composeFrame, { ...COMPOSE_DATA, receiverPhoneError: '请填写受礼人手机号' }, { lenient: true }) }
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

const CSS = {
  receive: rpx2px(read(join(GIFT, 'receive/index.wxss')) + '\n' + read(join(GIFT, 'phone-sheet/index.wxss'))),
  compose: rpx2px(read(join(GIFT, 'compose/index.wxss')))
}

async function shoot(scene) {
  const css = CSS[scene.css || 'receive']
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
:root { --color-bg: #151412; ${appTokens()} }
html, body { margin: 0; padding: 0; width: 750px; min-height: ${scene.h}px; background: #151412; color: #fff; font-family: -apple-system, "PingFang SC", sans-serif; }
input { display: block; background: transparent; border: 0; color: inherit; font: inherit; }
text { display: inline; }
</style><style>${css.replace(/(^|[^.\w-])page\s*\{/g, '$1body {')}</style><style>
.ps-mask, .ps-panel { animation: none !important; opacity: 1 !important; transform: none !important; }
</style></head><body>${scene.body()}</body></html>`
  const htmlPath = join(tmpdir(), `gift-verify-${scene.name}-${process.pid}.html`)
  writeFileSync(htmlPath, html)
  const out = join(outDir, `${scene.name}.png`)
  if (existsSync(out)) rmSync(out)
  const profile = mkdtempSync(join(tmpdir(), 'gift-verify-preview-'))
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
  if (!existsSync(out)) throw new Error(`截图未生成：${scene.name}`)
  console.log(`✓ ${scene.name} → ${out}`)
}

for (const s of scenes) await shoot(s)
