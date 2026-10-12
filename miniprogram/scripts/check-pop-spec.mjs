#!/usr/bin/env node
/**
 * 弹层视觉规范守卫（docs/弹层视觉规范_2026-10-13.md，产品负责人 2026-10-13 点名）
 *
 * 钉三件事：
 *   ① 全局零件在场：app.wxss 定义 --pop-* 令牌与 ui-pop-* 零件，零件不用回弹缓动（C7 §5.2）、有 reduced-motion 分支；
 *   ② 已迁移弹层不回退：MIGRATED 里每个「wx:if 开关」所在的遮罩挂 ui-pop-mask，其牌面挂 ui-pop-sheet / ui-pop-dialog；
 *   ③ 自写遮罩棘轮：C 端 wxss 里「全屏 fixed + 自带底色」的规则按文件计数，只许减少（新文件必须 0）——
 *      新弹层一律用 ui-pop-mask，不再各写一个遮罩色。
 *
 * 用法：node miniprogram/scripts/check-pop-spec.mjs [--selftest] [--print-baseline]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')

/** 已迁移的弹层：[wxml, wx:if 开关变量, 'mask' = 只验遮罩（海报 / 360° 这类仪式卡没有牌面，直接是图）] */
export const MIGRATED = [
  ['pages/cart/index.wxml', 'showCouponModal'],
  ['pages/user/index.wxml', 'showQrModal'],
  ['pages/user/index.wxml', 'showGroupModal'],
  ['pages/user/index.wxml', 'showStatisticsModal'],
  ['pages/user/index.wxml', 'showLevelUp'],
  ['pages/user/index.wxml', 'showBirthdayCard'],
  ['subpackages/business/confirm-order/index.wxml', 'showCouponModal'],
  ['subpackages/business/confirm-order/index.wxml', 'showCareNotice'],
  ['subpackages/business/confirm-order/index.wxml', 'showSpecimenNotice'],
  ['subpackages/business/address/index.wxml', 'showManualForm'],
  ['subpackages/feature/detail/index.wxml', 'showSkuSheet'],
  ['subpackages/feature/detail/index.wxml', 'showCouponSheet'],
  ['subpackages/feature/detail/index.wxml', 'showRefundSheet'],
  ['subpackages/feature/detail/index.wxml', 'showPosterModal', 'mask'],
  ['subpackages/feature/detail/index.wxml', 'show360Modal', 'mask']
]

/** 自写遮罩棘轮基线（按文件，只许减少；迁移一处就把数字改小） */
export const MASK_BASELINE = {
  'components/MemberLevelModal/index.wxss': 1,
  'components/SensitiveBlurGate/index.wxss': 1,
  'subpackages/business/booking/index.wxss': 2,
  'subpackages/business/components/CouponPrintMint/index.wxss': 1,
  'subpackages/business/components/WalletPanelCoupons/index.wxss': 2,
  'subpackages/business/components/WalletPanelPoints/index.wxss': 2,
  'subpackages/business/store/index.wxss': 2,
  'subpackages/business/ticket/index.wxss': 1,
  'subpackages/content/live/watch/index.wxss': 1,
  'subpackages/feature/collection/detail/index.wxss': 1,
  'subpackages/feature/collection/index.wxss': 1,
  'subpackages/feature/components/CouponPrintMint/index.wxss': 1,
  'subpackages/feature/components/RegisterAuthDialog/index.wxss': 1,
  'subpackages/feature/gift/claim-sheet/index.wxss': 1,
  'subpackages/feature/gift/my-gifts/index.wxss': 1,
  'subpackages/feature/gift/phone-sheet/index.wxss': 1,
  'subpackages/feature/gift/proxy-address-sheet/index.wxss': 1,
  'subpackages/feature/identify/index.wxss': 1,
  'subpackages/feature/identify/result/index.wxss': 2
}

/** 不计入：员工 / 管理端（第 3 批）、祈福墙 / 心愿签（另一流的纸感语言）、吸底栏（不是遮罩） */
const OUT_OF_SCOPE = /^(subpackages\/(extra|manager|b2bdesk|staff)\/|subpackages\/feature\/wish-wall\/|subpackages\/feature\/components\/WallFeed\/|subpackages\/feature\/wish-labels\/)/
const SKIP_DIRS = new Set(['node_modules', 'cloudfunctions', 'scripts', 'docs', 'minitest'])

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (SKIP_DIRS.has(n)) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.wxss')) out.push(relative(MP, p))
  }
  return out
}

/** 全屏 fixed + 带底色的规则（吸底栏这类非全屏不算；--pop-* 令牌底色不算） */
export function ownMasks(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const hits = []
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim()
    const body = m[2]
    if (!/position\s*:\s*fixed/.test(body)) continue
    const full = /inset\s*:\s*0/.test(body) ||
      (/\btop\s*:\s*0/.test(body) && /\bbottom\s*:\s*0/.test(body)) ||
      (/\btop\s*:\s*0/.test(body) && /height\s*:\s*100(%|vh)/.test(body))
    const bg = (body.match(/background(?:-color)?\s*:\s*([^;]+)/) || [])[1] || ''
    if (!full || !/rgba?\(|#[0-9a-fA-F]{3}/.test(bg) || /var\(--pop-/.test(bg)) continue
    hits.push(sel)
  }
  return hits
}

const openTag = (src, i) => {
  let j = i
  let q = null
  while (j < src.length) {
    const c = src[j]
    if (q) { if (c === q) q = null } else if (c === '"' || c === "'") q = c
    else if (c === '>') break
    j += 1
  }
  return src.slice(i, j + 1)
}

export function run(read = (f) => readFileSync(join(MP, f), 'utf8'), files = null) {
  const fails = []
  const app = read('app.wxss')
  for (const t of ['--pop-mask:', '--pop-mask-deep:', '--pop-surface:', '--pop-hairline:', '--pop-radius-dialog:', '--pop-radius-sheet:', '--dur-base:', '--ease-out-soft:']) {
    if (!app.includes(t)) fails.push(`app.wxss 缺弹层令牌 ${t.slice(0, -1)}`)
  }
  for (const c of ['ui-pop-mask', 'ui-pop-dialog', 'ui-pop-sheet', 'ui-pop-grip', 'ui-pop-head', 'ui-pop-kicker', 'ui-pop-title', 'ui-pop-close', 'ui-pop-foot', 'ui-pop-btn', 'ui-pop-row', 'ui-pop-radio']) {
    if (!new RegExp(`\\n\\.${c}\\s*\\{`).test(app)) fails.push(`app.wxss 缺零件 .${c}`)
  }
  const block = (app.match(/\/\* =+ 弹层[\s\S]*?@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\}\s*\}/) || [''])[0]
  if (!block) fails.push('app.wxss 弹层段缺 prefers-reduced-motion 分支')
  if (/cubic-bezier\(0\.175, 0\.885/.test(block)) fails.push('弹层零件用了回弹缓动（C7 §5.2 禁止）')
  if (!/\.ui-pop-mask\s*\{[^}]*background:\s*var\(--pop-mask\)/.test(block)) fails.push('.ui-pop-mask 底色不是 var(--pop-mask)')

  for (const [wxml, flag, only] of MIGRATED) {
    const src = read(wxml)
    const at = src.search(new RegExp(`<view\\b[^>]*wx:if="\\{\\{${flag}\\}\\}"`))
    if (at < 0) { fails.push(`${wxml}：找不到 wx:if="{{${flag}}}" 的弹层`); continue }
    const mask = openTag(src, at)
    if (!/class="[^"]*\bui-pop-mask\b/.test(mask)) fails.push(`${wxml}（${flag}）：遮罩没挂 ui-pop-mask`)
    if (only === 'mask') continue
    // 牌面在遮罩后的前 3 个 view 里（会员码弹层第一个子 view 是拦截点击的透明挡板）
    let pos = at + mask.length
    let found = false
    for (let k = 0; k < 3 && !found; k += 1) {
      const next = src.indexOf('<view', pos)
      if (next < 0) break
      const tag = openTag(src, next)
      found = /class="[^"]*\bui-pop-(sheet|dialog)\b/.test(tag)
      pos = next + tag.length
    }
    if (!found) fails.push(`${wxml}（${flag}）：牌面没挂 ui-pop-sheet / ui-pop-dialog`)
  }

  const list = files || walk(MP)
  for (const f of list) {
    if (OUT_OF_SCOPE.test(f) || f === 'app.wxss') continue
    const n = ownMasks(read(f)).length
    const base = MASK_BASELINE[f] || 0
    if (n > base) fails.push(`${f}：自写遮罩 ${n} 处 > 基线 ${base}（新弹层用 ui-pop-mask，见 docs/弹层视觉规范_2026-10-13.md）`)
  }
  return fails
}

function selftest() {
  const real = (f) => readFileSync(join(MP, f), 'utf8')
  const cases = [
    ['已迁移弹层回退为自写遮罩', (f) => f === 'pages/cart/index.wxml' ? real(f).replace('class="ui-pop-mask" wx:if="{{showCouponModal}}"', 'class="modal-mask" wx:if="{{showCouponModal}}"') : real(f), 'ui-pop-mask'],
    ['牌面脱离 ui-pop-sheet', (f) => f === 'subpackages/feature/detail/index.wxml' ? real(f).replace('class="ui-pop-sheet sku-panel"', 'class="sku-panel"') : real(f), 'ui-pop-sheet'],
    ['页面新增一个自写遮罩', (f) => f === 'pages/cart/index.wxss' ? `${real(f)}\n.new-mask { position: fixed; inset: 0; background: rgba(0,0,0,.6); }\n` : real(f), '自写遮罩'],
    ['零件改用回弹缓动', (f) => f === 'app.wxss' ? real(f).replace('animation: ui-pop-rise var(--dur-base) var(--ease-out-soft) both;', 'animation: ui-pop-rise 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) both;') : real(f), '回弹'],
    ['遮罩底色脱离令牌', (f) => f === 'app.wxss' ? real(f).replace('  background: var(--pop-mask);\n  animation: ui-pop-fade', '  background: rgba(0,0,0,.6);\n  animation: ui-pop-fade') : real(f), 'var(--pop-mask)'],
    ['丢掉一个令牌', (f) => f === 'app.wxss' ? real(f).replace('  --pop-hairline:', '  --pop-hairline-x:') : real(f), '--pop-hairline']
  ]
  let bad = 0
  const base = run()
  if (base.length) { console.log(`✗ 基线不干净：\n  ${base.join('\n  ')}`); bad += 1 }
  for (const [name, reader, needle] of cases) {
    const r = run(reader)
    const ok = r.some((x) => x.includes(needle))
    console.log(`${ok ? '  ✓ 已检出' : '✗ 未检出'}：${name}`)
    if (!ok) bad += 1
  }
  const fp = ownMasks('.bar { position: fixed; left: 0; right: 0; bottom: 0; height: 120rpx; background: #1A1814; }\n.m { position: fixed; inset: 0; background: var(--pop-mask); }')
  console.log(`${fp.length === 0 ? '  ✓ 不误报' : '✗ 误报'}：吸底栏 / 令牌底色`)
  if (fp.length) bad += 1
  if (bad) { console.log(`✗ 自检失败 ${bad} 项`); process.exit(1) }
  console.log(`✓ 自检通过（${cases.length} 注入 + 1 不误报，内存副本不写盘）`)
}

if (process.argv.includes('--selftest')) selftest()
else if (process.argv.includes('--print-baseline')) {
  const out = {}
  for (const f of walk(MP)) { if (OUT_OF_SCOPE.test(f) || f === 'app.wxss') continue; const n = ownMasks(readFileSync(join(MP, f), 'utf8')).length; if (n) out[f] = n }
  console.log(JSON.stringify(out, null, 2))
} else {
  const fails = run()
  if (fails.length) {
    console.error(`✗ 弹层规范检查失败（${fails.length}）：`)
    for (const f of fails) console.error(`  - ${f}`)
    process.exit(1)
  }
  console.log(`✓ 弹层规范：零件 / 令牌在场，${MIGRATED.length} 个已迁移弹层未回退，自写遮罩未增长`)
}
