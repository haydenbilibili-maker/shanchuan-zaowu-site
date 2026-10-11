#!/usr/bin/env node
/**
 * 礼赠 · 凭礼笺领取 · 离线版式预览（开发工具，不参与守卫 / check:admin）
 * 结构从真 WXML 现读（页面按注释锚点截段；claim-sheet / reg-card 组件整份渲染），样式从真 WXSS 现读；
 * 无头 Chrome 以 750px 视口截图（rpx 1:1 当 px）。字体与真机不同，只看版式，不能替代真机验收。
 *
 * 用法：node miniprogram/scripts/render-gift-claim-link-preview.mjs [--out-dir <dir>]
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
const outDir = argOf('--out-dir', join(tmpdir(), 'gift-claim-link-preview'))
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

const composeWxml = read(join(GIFT, 'compose/index.wxml'))
const composeFrame = `<view class="page">${cut(composeWxml, '<!-- 03 交付方式 -->', '<view class="pack-note">')}</view></view>`
const COMPOSE = { deliveryType: 'invite_address', showOtherDelivery: false, otherDeliveries: [], storePickupEnabled: false, stores: [], receiverPhone: '', receiverPhoneFocus: false, receiverPhoneError: '' }

const receiveWxml = read(join(GIFT, 'receive/index.wxml'))
const linkBlock = cut(receiveWxml, '<!-- 凭礼笺领取：', '<!-- 领取核验（N3） -->')
const inviteBlock = cut(receiveWxml, '<!-- 先付后填址 -->', '<!-- 门店自提：').replace('wx:elif="{{isInvite}}"', 'wx:if="{{isInvite}}"')
const holderBlock = cut(receiveWxml, '<!-- 持有期服务：', '<reg-card')
const recvFrame = (inner, tail = '') => `<view class="page"><view class="actions">${inner}</view>${tail}</view>`
const regCardWxml = read(join(GIFT, 'reg-card/index.wxml'))
const claimSheetWxml = read(join(GIFT, 'claim-sheet/index.wxml'))
const successWxml = read(join(GIFT, 'success/index.wxml'))
const successLine = cut(successWxml, '<view class="verify-line" wx:if="{{verify && verify.claimMode === \'link\'}}"', '<text class="subscribe-hint" wx:if="{{subscribeHint}}">')

const R = { claimLink: true, accepted: false, needFriendShare: false, passcodeInput: '', claimNameInput: '', claimBusy: false, claimError: '' }
const STATE_PENDING = { claimMode: 'link', canReset: true, editable: true, passcode: '382519', claimer: null }
const STATE_CLAIMED = { claimMode: 'link', canReset: true, editable: false, passcode: '382519', claimer: { label: '小满', at: '10月11日' } }

const scenes = [
  { name: '1-送礼页-推荐填号', h: 760, css: 'compose', body: () => renderWxml(composeFrame, { ...COMPOSE, claimLink: false, claimPasscode: false }, { lenient: true }) },
  { name: '2-送礼页-凭礼笺领取+口令', h: 760, css: 'compose', body: () => renderWxml(composeFrame, { ...COMPOSE, claimLink: true, claimPasscode: true }, { lenient: true }) },
  { name: '3-领取页-收下前（无口令）', h: 900, body: () => renderWxml(recvFrame(linkBlock), { ...R, passcodeNeeded: false }, { lenient: true }) },
  { name: '4-领取页-收下前（有口令·输错）', h: 980, body: () => renderWxml(recvFrame(linkBlock), { ...R, passcodeNeeded: true, passcodeInput: '38251', claimNameInput: '小满', claimError: '口令不对，还可尝试 4 次' }, { lenient: true }) },
  {
    name: '5-领取页-收下后+注册引导卡', h: 1500,
    body: () => renderWxml(recvFrame(inviteBlock, holderBlock), { isInvite: true, needFriendShare: false, accepted: true, addressDone: false, holderCard: true, verifyNeeded: false, holderReady: false }, { lenient: true }) +
      `<view class="page">${renderWxml(regCardWxml, { show: true, claimName: '小满', useName: true, agreed: false, agreeHint: true, agreeShake: false, saving: false }, { lenient: true })}</view>`
  },
  {
    name: '6-送礼人-成功页领取状态+管理面板（待收下）', h: 1334, css: 'giver',
    body: () => `<view class="page">${renderWxml(successLine, { verify: STATE_PENDING, claimLineText: '口令 382519 · 等 TA 收下', claimTip: '' }, { lenient: true })}</view>` +
      renderWxml(claimSheetWxml, { show: true, state: STATE_PENDING, busy: false, error: '', confirmReset: false }, { lenient: true })
  },
  {
    name: '7-送礼人-看到领取人+作废确认', h: 1334, css: 'giver',
    body: () => `<view class="page">${renderWxml(successLine, { verify: STATE_CLAIMED, claimLineText: '小满 · 10月11日收下', claimTip: '' }, { lenient: true })}</view>` +
      renderWxml(claimSheetWxml, { show: true, state: STATE_CLAIMED, busy: false, error: '', confirmReset: true }, { lenient: true })
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

const CSS = {
  receive: rpx2px(read(join(GIFT, 'receive/index.wxss')) + '\n' + read(join(GIFT, 'reg-card/index.wxss'))),
  compose: rpx2px(read(join(GIFT, 'compose/index.wxss'))),
  giver: rpx2px(read(join(GIFT, 'success/index.wxss')) + '\n' + read(join(GIFT, 'claim-sheet/index.wxss')))
}

async function shoot(scene) {
  const css = CSS[scene.css || 'receive']
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
:root { --color-bg: #151412; ${appTokens()} }
html, body { margin: 0; padding: 0; width: 750px; min-height: ${scene.h}px; background: #151412; color: #fff; font-family: -apple-system, "PingFang SC", sans-serif; }
input { display: block; background: transparent; border: 0; color: inherit; font: inherit; }
button { display: block; border: 0; }
text { display: inline; }
</style><style>${css.replace(/(^|[^.\w-])page\s*\{/g, '$1body {')}</style><style>
.cs-mask, .cs-panel { animation: none !important; opacity: 1 !important; transform: none !important; }
.page { padding: 40px 48px; box-sizing: border-box; min-height: 0 !important; }
</style></head><body>${scene.body()}</body></html>`
  const htmlPath = join(tmpdir(), `gift-claim-link-${process.pid}-${scenes.indexOf(scene)}.html`)
  writeFileSync(htmlPath, html)
  const out = join(outDir, `${scene.name}.png`)
  if (existsSync(out)) rmSync(out)
  const profile = mkdtempSync(join(tmpdir(), 'gift-claim-link-preview-'))
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

for (const s of scenes) await shoot(s)
