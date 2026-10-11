#!/usr/bin/env node
/**
 * 全局注册简化 · 离线版式预览（开发工具，不参与守卫 / check:admin）
 * 一次只起一个无头 Chrome，把几个场景并排拼成一张图（每列是独立 iframe，样式互不串）：
 *   结算门禁（改前 = 跳到的注册页；改后 = 结算页原地注册弹层）/ 注册页 / 注册成功态（改后才有）/「我的」补资料提示。
 * 结构从真 WXML 现读，样式从真 WXSS 现读（@import 展开）；rpx 1:1 当 px。字体与真机不同，只看版式，不能替代真机验收。
 *
 * 用法：node miniprogram/scripts/render-global-reg-preview.mjs --out <png 路径>
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderWxml } from './lib/wxml-preview.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const argOf = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const out = resolve(argOf('--out', join(tmpdir(), 'global-reg-preview.png')))
mkdirSync(dirname(out), { recursive: true })

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

const read = (p) => readFileSync(join(MP, p), 'utf8')
const rpx2px = (t) => t.replace(/(\d*\.?\d+)rpx/g, '$1px')
function wxss(p) {
  const abs = join(MP, p)
  return readFileSync(abs, 'utf8').replace(/@import\s+['"]([^'"]+)['"];?/g, (_, rel) => {
    const target = resolve(dirname(abs), rel)
    return existsSync(target) ? wxss(target.slice(MP.length + 1)) : ''
  })
}
function cut(src, startMark, endMark) {
  const s = src.indexOf(startMark)
  if (s < 0) throw new Error(`锚点缺失：${startMark}`)
  const e = src.indexOf(endMark, s + 1)
  if (e < 0) throw new Error(`结束锚点缺失：${endMark}`)
  return src.slice(s, e)
}
function appTokens() {
  const app = read('app.wxss')
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

const ONB = 'subpackages/extra/user/onboarding'
const DIALOG = 'subpackages/feature/components/RegisterAuthDialog'
const onbWxml = read(`${ONB}/index.wxml`)
const dialogMounted = /<register-auth-dialog/.test(read('subpackages/business/confirm-order/index.wxml'))
const onbHasSuccess = /wx:if="\{\{doneView\}\}"/.test(onbWxml)

const ONB_BASE = {
  navTitle: '注册领新客礼', navSub: '山海造物 · 藏家档案', navPaddingRight: 100, headerBlockPx: 150, footerPadPx: 260,
  heroOverline: 'WELCOME', heroTitle: '授权手机号，领取新客礼', heroDesc: '注册后礼券即时放入账户，订单与门店通知可达。',
  accountReady: true, showGiftPack: true, showPoints: true, rewardPoints: 100, rewardCouponCount: 2,
  rewardCouponCards: [{ key: 'a', value: 20, label: '满 199 可用' }, { key: 'b', value: 10, label: '满 99 可用' }],
  showProfileExtras: true, avatarUrl: '', nickName: '', phoneBound: false, agreed: false, saving: false,
  ctaPhoneText: '授权手机号 · 领取新客礼', loadingText: '正在注册', hasReturn: false, phoneOnly: false
}
const CHECKOUT_JUMP = {
  ...ONB_BASE, navTitle: '确认手机号', heroOverline: 'ONE STEP', heroTitle: '授权手机号后继续下单',
  heroDesc: '订单通知与售后需要联系手机号。', hasReturn: true, ctaPhoneText: '授权手机号 · 继续下单'
}

function onbCol(data) {
  return { css: rpx2px(wxss(`${ONB}/index.wxss`)), body: renderWxml(onbWxml, data, { lenient: true }) }
}
function checkoutCol() {
  if (!dialogMounted) return onbCol(CHECKOUT_JUMP)
  const bar = '<div style="position:fixed;left:0;right:0;bottom:0;height:150px;background:#1e1c19;border-top:1px solid #3a352d;display:flex;align-items:center;justify-content:space-between;padding:0 40px;box-sizing:border-box;color:#e8dcc0;font-size:30px;"><span>合计 ¥ 398.00</span><span style="background:#c4a76c;color:#151412;padding:22px 56px;border-radius:8px;">提交订单</span></div>'
  const lines = ['收货信息 · 张女士 138****0000', '藏品 · 山海图鉴·青丘 × 1', '礼券 · 暂无可用', '备注 · 选填']
    .map((t) => `<div style="margin:24px 32px;padding:32px;background:#1e1c19;border-radius:12px;color:#cfc4ad;font-size:28px;">${t}</div>`).join('')
  const dialog = renderWxml(read(`${DIALOG}/index.wxml`), {
    show: true, closable: true, maskClosable: false, closeText: '先不注册', isRegistered: false, agreed: false, saving: false,
    overline: 'ONE STEP', title: '授权手机号后继续下单', desc: '订单通知与售后需要联系手机号；注册后自动继续提交。',
    lead: '注册后自动继续刚才的下单', cta: '授权手机号 · 继续下单', agreeHint: false, agreeShake: false
  }, { lenient: true })
  return {
    css: rpx2px(wxss(`${DIALOG}/index.wxss`)),
    body: `<div style="padding-top:120px;color:#e8dcc0;font-size:34px;text-align:center;">确认订单</div>${lines}${bar}${dialog}`
  }
}
function successCol() {
  return onbCol({
    ...ONB_BASE, doneView: true, isNewUser: true, welcomeBack: false, hasReturn: false, primaryCta: '',
    giftPoints: 100, giftCoupons: 2, giftPartial: false, giftFail: false, giftMsg: '', showProfileExtras: false
  })
}
function userCol() {
  const wxml = read('pages/user/index.wxml')
  const banners = cut(wxml, '<!-- 新用户引导条', '<user-vip-card')
  return {
    css: rpx2px(read('pages/user/index.wxss')),
    body: `<view class="container" style="padding-top: 100px;">${renderWxml(banners, {
      showOnboardingBanner: false, isLocalLoggedOut: false, showGiftRepairBanner: false, profileScore: 60,
      showProfileHint: true, profileHintTitle: '给档案署个名', profileHintDesc: '现在显示为「藏家」，补个昵称和头像，证书与祈福墙都用它'
    }, { lenient: true })}<div style="margin:24px 32px;height:360px;border-radius:24px;background:linear-gradient(135deg,#2a2620,#1a1815);color:#8d826c;font-size:26px;display:flex;align-items:center;justify-content:center;">（会员卡区域，略）</div></view>`
  }
}

const H = 1500
const cols = [
  { title: dialogMounted ? '结算门禁：原地注册弹层（不跳页）' : '结算门禁：跳到注册页', ...checkoutCol() },
  { title: '注册页（「我的」/ 收银台码进入）', ...onbCol({ ...ONB_BASE, showProfileExtras: !onbHasSuccess && ONB_BASE.showProfileExtras }) },
  ...(onbHasSuccess ? [{ title: '注册成功：原页成功态（不再跳完成页）', ...successCol() }] : []),
  { title: '「我的」页：已注册、昵称仍是默认「藏家」', ...userCol() }
]

const frame = (c) => `<!doctype html><html><head><meta charset="utf-8"><style>
:root { --color-bg: #151412; ${appTokens()} }
html, body { margin: 0; padding: 0; width: 750px; min-height: ${H}px; background: #151412; color: #fff; font-family: -apple-system, "PingFang SC", sans-serif; }
input { display: block; background: transparent; border: 0; color: inherit; font: inherit; }
button { display: block; border: 0; }
text { display: inline; }
</style><style>${c.css.replace(/(^|[^.\w-])page\s*\{/g, '$1body {')}</style><style>
.stagger-item, .rad-mask, .rad-plate { animation: none !important; opacity: 1 !important; transform: none !important; }
.grain-overlay { display: none; }
</style></head><body>${c.body}</body></html>`
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
const W = cols.length * 790 + 40
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body { margin: 0; padding: 20px; background: #0b0a09; display: flex; gap: 40px; font-family: -apple-system, "PingFang SC", sans-serif; }
.col { width: 750px; } .cap { color: #c4a76c; font-size: 26px; height: 56px; }
iframe { width: 750px; height: ${H}px; border: 1px solid #333; display: block; }
</style></head><body>${cols.map((c) => `<div class="col"><div class="cap">${c.title}</div><iframe srcdoc="${esc(frame(c))}"></iframe></div>`).join('')}</body></html>`

const htmlPath = join(tmpdir(), `global-reg-preview-${process.pid}.html`)
writeFileSync(htmlPath, html)
if (existsSync(out)) rmSync(out)
const profile = mkdtempSync(join(tmpdir(), 'global-reg-preview-'))
const child = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, '--hide-scrollbars', '--force-device-scale-factor=1', '--virtual-time-budget=3000',
  `--window-size=${W},${H + 100}`, `--screenshot=${out}`, `file://${htmlPath}`
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
if (!existsSync(out)) { console.error('✗ 截图未生成'); process.exit(1) }
console.log(`✓ ${cols.length} 列 → ${out}`)
