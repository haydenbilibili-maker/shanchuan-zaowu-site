#!/usr/bin/env node
/**
 * 核心链路离线预览（礼赠 / 订单 / 详情 / AI 鉴定 / 钱包礼券）——开发工具，**不在 check:admin 里**（需要本机 Chrome）。
 *
 * 结构与样式从真源码现读（lib/wxml-preview.mjs）；`scroll-view` 按普通容器展开、其它自定义组件整棵跳过，
 * 钱包三块面板本身是组件，按「组件即页面」单独出图。数据是示例，只为看版式 / 层级 / 质感。
 * 证明不了真机 rpx 精度与原生组件行为（错题本 E8 / E26）。
 *
 * 用法：
 *   CHROME_PATH=… node miniprogram/scripts/render-core-flows-preview.mjs --out-dir <目录> [--rev <提交>] [--only detail,order-detail]
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderWxml } from './lib/wxml-preview.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const MP = join(ROOT, 'miniprogram')
const argv = process.argv.slice(2)
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const outDir = resolve(argOf('--out-dir', join(tmpdir(), 'core-flows-preview')))
const rev = argOf('--rev', '')
const only = argOf('--only', '').split(',').filter(Boolean)
mkdirSync(outDir, { recursive: true })

const chrome = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => existsSync(p))
if (!chrome) { console.error('✗ 未找到 Chrome（可用 CHROME_PATH 指定）'); process.exit(1) }

function read(abs) {
  if (!rev) return readFileSync(abs, 'utf8')
  const r = spawnSync('git', ['show', `${rev}:${relative(ROOT, abs)}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
  if (r.status !== 0) throw new Error(`git show ${rev}:${relative(ROOT, abs)} 失败`)
  return r.stdout
}
function loadWxss(file, seen = new Set()) {
  if (seen.has(file) || !existsSync(file)) return ''
  seen.add(file)
  return read(file).replace(/@import\s+['"]([^'"]+)['"];?/g, (_, rel) => {
    const p = rel.startsWith('/') ? join(MP, rel) : resolve(dirname(file), rel)
    return loadWxss(p, seen)
  })
}
/** <template name> 定义 + <template is data="{{item}}"> 调用 → 就地展开（只支持本仓在用的 data="{{item}}" 简写） */
function inlineTemplates(src) {
  const defs = {}
  src = src.replace(/<template\s+name="([^"]+)"\s*>([\s\S]*?)<\/template>/g, (_, name, body) => { defs[name] = body; return '' })
  return src.replace(/<template\b([^>]*?)\bis="([^"]+)"([^>]*?)\/>/g, (all, a, name, b) => {
    if (!defs[name]) return all
    const attrs = (a + b).replace(/\bdata="[^"]*"/, '').trim()
    return `<block ${attrs}>${defs[name]}</block>`
  })
}
/** WXSS 选择器 → 预览 HTML：裸 page / :host → body；标签选择器 view/text/image → div/span/img（渲染器的映射）。
 *  ⚠️ 不能写 \bpage —— `.page {` 的 page 前也是词边界，会把页面根类改坏（首版就这么错了）。 */
function toHtmlCss(css) {
  const TAG = { view: 'div', text: 'span', image: 'img' }
  return css.replace(/(^|[\s,}>+~(])page(?=\s*[{,])/g, '$1body').replace(/:host(?=\s*[{,])/g, 'body')
    .replace(/(^|[\s,}>+~(])(view|text|image)(?=[\s,.:#\[{>+~)])/g, (_, a, t) => a + TAG[t])
}
const rpx2px = (t) => t.replace(/(-?\d*\.?\d+)rpx/g, '$1px').replace(/(?:env|constant)\(safe-area-inset-(?:bottom|top)\)/g, '0px')

const IMG = (n) => `file://${join(ROOT, 'public/images/price-list', n)}`
const P = ['blue-morpho-dome-single.jpg', 'blood-ripple-butterfly-dome.jpg', 'blue-morpho-wood-frame.jpg', 'dandelion-glass-dome.jpg', 'domestic-mixed-butterfly-frame-01.jpg', 'butterfly-plant-combo-frame-01.jpg'].map(IMG)

const product = {
  _id: 'p1', title: '光明女神闪蝶 · 玻璃罩', latinName: 'Morpho helena', themeName: '晨雾', themeNote: '清晨薄雾里的一抹蓝',
  image: P[0], images: [P[0], P[2]], rootCategoryName: '昆虫', giftEligible: true, supportsCustom: true,
  taxonomy: { kingdom: '动物界', phylum: '节肢动物门', class: '昆虫纲', order: '鳞翅目', family: '蛱蝶科', genus: '闪蝶属' },
  skus: [{ id: 's1', specLabel: '玻璃罩 · 小号', stock: 6 }, { id: 's2', specLabel: '实木框', stock: 2 }]
}

const SCENES = [
  {
    name: 'detail', h: 3000, wxml: 'subpackages/feature/detail/index', data: {
      product, commerceReady: true, displayPrice: '388', displayStock: 6, heroSlides: [{ key: 'h1', kind: 'image', src: P[0] }, { key: 'h2', kind: 'image', src: P[2] }], heroFit: 'aspectFill', heroSwiperH: 520,
      imageTotal: 2, activeTab: 'detail', statusBarHeight: 44, navBarHeight: 44, navOpacity: 0, craftTags: [{ key: 'dome', label: '玻璃罩' }, { key: 'hand', label: '手作' }],
      isShippingFree: true, shippingHint: '满 ¥199 包邮', archiveDisplay: { origin: '南美 · 秘鲁', size: '18 × 24 cm', framingMethod: '玻璃罩', framerName: '林一', date: '2026.09', craftProcess: '展翅 · 还软 · 定型 72 小时' },
      descriptionParagraphs: [{ segments: [{ text: '光明女神闪蝶被誉为世界上最美的蝴蝶之一，翅面在不同角度下呈现由蓝到紫的结构色。' }] }],
      selectedSkuSizeText: '玻璃罩 · 小号', buyCount: 1, hasSku: true, isOneOfAKind: false, specSummary: '2 种规格'
    }
  },
  {
    name: 'identify-result', h: 2400, wxml: 'subpackages/feature/identify/result/index', data: {
      loading: false, loadError: false, displayImage: P[0], confidenceLevel: 'high', recordId: 'r1', isOwner: true, showSpeciesArchive: true,
      speciesInfo: { is_specimen: true, species_name_zh: '光明女神闪蝶', species_name_latin: 'Morpho helena', confidence: 0.92, confidencePct: 92 },
      rootCategoryTag: { label: '昆虫', tone: 'insecta' },
      alternatives: [{ name_zh: '海伦闪蝶', name_latin: 'Morpho helenor', confidence: 0.18, confidencePct: '18%' }, { name_zh: '蓝闪蝶', name_latin: 'Morpho menelaus', confidence: 0.06, confidencePct: '6%' }],
      speciesProfile: { blocks: [{ title: '形态', text: '翅展 12–14 厘米，雄蝶翅面呈金属蓝色，边缘有白色斑带。' }, { title: '分布', text: '秘鲁亚马逊雨林海拔 400–1200 米的林冠层。' }], protectionTags: [{ label: '无保护等级', tone: 'muted' }], sourceLabel: 'AI 整理 · 仅供参考' },
      relatedProducts: [{ _id: 'p1', title: '光明女神闪蝶 · 玻璃罩', price: 388, cover: P[0], latinName: 'Morpho helena' }, { _id: 'p2', title: '大蓝闪蝶 · 原木框', price: 520, cover: P[2] }]
    }
  },
  {
    name: 'species-card', h: 1400, wxml: 'subpackages/feature/components/SpeciesCard/index', data: {
      imageUrl: P[0], confidenceLevel: 'high', showConfidence: true, rootCategoryTag: { label: '昆虫', tone: 'insecta' }, showProtection: true,
      speciesInfo: { is_specimen: true, species_name_zh: '光明女神闪蝶', species_name_latin: 'Morpho helena', confidence: 0.92, family_zh: '蛱蝶科', order_zh: '鳞翅目' },
      aiContent: { description: '翅面在不同角度呈现由蓝到紫的结构色，是闪蝶属中最受藏家青睐的物种之一。' },
      protectionTags: [{ label: '无保护等级', tone: 'muted' }]
    }
  },
  {
    name: 'order-detail', h: 2200, wxml: 'subpackages/business/order-detail/index', data: {
      loading: false, loadError: false, isDecrypted: true, showOrderPrice: true, statusBarHeight: 44,
      order: {
        _id: 'o1', serialNo: 'SH20261012008', status: 'shipped', totalPrice: '1,260.00', originalPrice: '1,280.00', discountRate: 0.98, discountText: '9.8 折', discountAmount: '20.00',
        couponValue: 0, shippingFee: 0, shippingFeeLabel: '包邮', archiveDate: '2026.10.12',
        address: { name: '林', phone: '138****0012' }, addressLine: '上海市徐汇区漕溪北路 ** 号',
        logistics: { carrier: '顺丰速运', trackingNumber: 'SF1234567890123' },
        products: [{ _id: 'p1', title: '光明女神闪蝶 · 玻璃罩', latin: 'Morpho helena', price: '1,280.00', count: 1, image: P[0] }]
      },
      hasTracking: true, stampText: '已启程', stampClass: 'shipped', footer: true
    }
  },
  {
    name: 'orders', h: 1500, wxml: 'subpackages/business/orders/index', data: {
      statusBarHeight: 44, currentTab: 0, loading: false,
      tabs: [{ key: 'all', label: '全部' }, { key: 'pending_pay', label: '待付款' }, { key: 'shipped', label: '待收货' }, { key: 'done', label: '已完成' }],
      orders: [
        { _id: 'o1', serialNo: 'SH20261012008', status: 'shipped', statusText: '已启程', totalPrice: '1,260.00', products: [{ title: '光明女神闪蝶 · 玻璃罩', image: P[0], count: 1 }], productCount: 1 },
        { _id: 'o2', serialNo: 'SH20260920017', status: 'done', statusText: '已签收', totalPrice: '376.00', products: [{ title: '绿带翠凤蝶', image: P[1], count: 2 }], productCount: 2 }
      ]
    }
  },
  {
    name: 'gift-compose', h: 2400, wxml: 'subpackages/feature/gift/compose/index', data: {
      loading: false, checking: false, loadError: false, allowed: true, count: 1, activeStep: 1, maxStep: 2, statusBarHeight: 44, navBarHeight: 44, navTotal: 88,
      product: { ...product, cover: P[0] }, skuLabel: '玻璃罩 · 小号', sceneLabel: '生日', activeScene: 'birthday',
      notePresets: [{ id: 'n1', label: '生日' }, { id: 'n2', label: '感谢' }, { id: 'n3', label: '纪念日' }], activeNotePresetId: 'n1',
      packagingItems: [{ id: 'k1', k: '礼盒', v: '黑胡桃木盒 · 烫金封签' }, { id: 'k2', k: '礼笺', v: '藏品纸 · 手写体' }],
      recipientName: '阿禾', cardBody: '愿你的每个清晨都像这只蝴蝶一样，有光。', cardSignature: '小林', noteMaxChars: 120, hidePrice: true, allowHidePriceToggle: true
    }
  },
  {
    name: 'gift-receive', h: 2200, wxml: 'subpackages/feature/gift/receive/index', data: {
      ready: true, expired: false, invalid: false, isSender: false, busy: false, product: { ...product }, recipientName: '阿禾', letterToShown: true, letterBodyShown: true, letterSigReady: true,
      cardSignature: '小林', revealed: true, ritePhase: 'done', isInvite: true, hasVoice: true, voiceDurationLabel: '0:12', hidePrice: true, specimenHint: '玻璃罩 · 小号'
    }
  },
  { name: 'gift-compose-2', h: 2200, wxml: 'subpackages/feature/gift/compose/index', base: 'gift-compose', data: { activeStep: 2, maxStep: 2, cardFocused: false, signed: true, sigJustSigned: false } },
  { name: 'order-pending', h: 2300, wxml: 'subpackages/business/order-detail/index', base: 'order-detail', data: { order: { _id: 'o2', serialNo: 'SH20261015003', status: 'pending_pay', totalPrice: '468.00', originalPrice: '468.00', discountRate: 1, couponValue: 20, shippingFee: 18, shippingFeeDisplay: '18.00', address: { name: '林', phone: '138****0012' }, addressLine: '上海市徐汇区漕溪北路 ** 号', products: [{ _id: 'p3', title: '蓝闪蝶 · A1 博物级', latin: 'Morpho menelaus', price: '468.00', count: 1, image: P[2] }] }, stampText: '待付款', stampClass: 'warn', payBtnLabel: '付款入藏', hasTracking: false } },
  { name: 'gift-receive-done', h: 1700, wxml: 'subpackages/feature/gift/receive/index', base: 'gift-receive', data: { accepted: true, addressDone: true, phoneMasked: '138****0012', addressMaskedLine: '上海市徐汇区 ***' } },
  { name: 'gift-receive-box', h: 1500, wxml: 'subpackages/feature/gift/receive/index', base: 'gift-receive', data: { revealed: false, ritePhase: 'idle', letterToShown: false, letterBodyShown: false } },
  {
    name: 'wallet-coupons', h: 1700, wxml: 'subpackages/business/components/WalletPanelCoupons/index', data: {
      loading: false, usableCouponCount: 3, expiringCount: 1, lockedCount: 1, closedCount: 2, passState: 'idle', memberNo: '0137',
      coupons: [
        { _id: 'c1', title: '新会员礼券', faceLabel: '¥20', value: 20, minSpend: 0, canUse: true, canUseOnline: true, channelLabel: '线上 · 门店通用', expiryHint: '10.31 前有效', sourceLabel: '新会员礼包', useLabel: '去使用' },
        { _id: 'c2', title: '满减礼券', faceLabel: '¥50', value: 50, minSpend: 599, canUse: true, canUseOnline: true, channelLabel: '线上可用', expiryHint: '3 天后到期', expiringSoon: true, sourceLabel: '生日礼', useLabel: '去使用' },
        { _id: 'c3', title: '门店体验券', faceLabel: '8 折', minSpend: 0, canUse: true, canUseStore: true, channelLabel: '门店核销', expiryHint: '11.15 前有效', sourceLabel: '活动赠送', useLabel: '出示核销' }
      ]
    }
  },
  {
    name: 'wallet-balance', h: 1700, wxml: 'subpackages/business/components/WalletPanelWallet/index', data: {
      accountReady: true, account: { availableYuan: '1,280.00', memberNo: '0137' }, allowed: true, rechargeMode: true, needLogin: false, checking: false, iosBlocked: false, flashSuccess: false, ledgerLoading: false, ledgerEmpty: false, allowCustom: true, recharge: { minCustomYuan: 100, maxCustomYuan: 20000 }, paySummaryLabel: '实付 ¥1000 · 到账 ¥1080', selectedBenefitHint: '升至「藏家」，享 9.5 折', ledgerCap: '近 30 天',
      packages: [{ id: 'k1', label: '¥500', displayPayYuan: '500', pointsLine: '+500 积分', discountLine: '到账 ¥530' }, { id: 'k2', label: '¥1000', displayPayYuan: '1000', levelBadge: '升级', levelName: '藏家', pointsLine: '+1000 积分', discountLine: '到账 ¥1080' }, { id: 'k3', label: '¥2000', displayPayYuan: '2000', levelName: '馆员', pointsLine: '+2000 积分', discountLine: '到账 ¥2200' }],
      selectedPackageId: 'k2', rechargeMode: 'package', canPay: true, payBtnLabel: '充值 ¥1000',
      ledgerTimeline: [{ week: '本周', rows: [{ typeLabel: '消费', subtitle: '光明女神闪蝶 · 玻璃罩', amountSign: '-', amountYuan: '388.00', clockText: '10.12 14:20', toneClass: 'minus', balanceAfterYuan: '1,280.00' }, { typeLabel: '充值', subtitle: '储值 ¥1000 送 ¥80', amountSign: '+', amountYuan: '1,080.00', clockText: '10.10 09:12', toneClass: 'plus', isCredit: true, balanceAfterYuan: '1,668.00' }] }]
    }
  },
  {
    name: 'wallet-points', h: 1600, wxml: 'subpackages/business/components/WalletPanelPoints/index', data: {
      loading: false, points: 2680, pointsYuan: '26.80', curTab: 0,
      rewards: [{ _id: 'r1', title: '黄铜书签', cost: 800, image: P[3] }, { _id: 'r2', title: '标本小卡', cost: 300, image: P[4] }]
    }
  }
]

async function shoot(s) {
  const missing = new Set()
  let wxml = inlineTemplates(read(join(MP, s.wxml + '.wxml')))
    .replace(/<wxs[^>]*\/>/g, '').replace(/<wxs\b[^>]*>[\s\S]*?<\/wxs>/g, '')
    .replace(/<scroll-view\b/g, '<view').replace(/<\/scroll-view>/g, '</view>')
    .replace(/<sensitive-blur-gate\b[^>]*>/g, '<view>').replace(/<\/sensitive-blur-gate>/g, '</view>')
    .replace(/<swiper-item\b/g, '<view').replace(/<\/swiper-item>/g, '</view>').replace(/<swiper(?=[\s>])/g, '<view').replace(/<\/swiper>/g, '</view>')
  const body = renderWxml(wxml, { latin: { display: (x) => x || '' }, ...s.data }, { lenient: true, onMissing: (k) => missing.add(k) })
  const css = rpx2px(loadWxss(join(MP, 'app.wxss')) + '\n' + loadWxss(join(MP, s.wxml + '.wxss')))
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; width: 750px; background: #1a1814; color: #fff; font-family: -apple-system, "PingFang SC", "Noto Sans SC", sans-serif; }
img { object-fit: cover; } img:not([src]), img[src=""] { visibility: hidden; }
/* app.wxss 的 view, text, image 的 border-box 选不到渲染后的 div/span/img —— 补上，否则 width:100% + padding 会假溢出 */
div, span, img { box-sizing: border-box; }
</style><style>${toHtmlCss(css)}</style><style>
*, *::before, *::after { animation-play-state: paused !important; animation-delay: -10s !important; }
[class*="mask"][class*="ui-pop"] { display: none !important; }
</style></head><body>${body}</body></html>`
  const htmlPath = join(tmpdir(), `core-${s.name}-${process.pid}.html`)
  writeFileSync(htmlPath, html)
  const out = join(outDir, `${s.name}.png`)
  if (existsSync(out)) rmSync(out)
  const profile = mkdtempSync(join(tmpdir(), 'core-flows-'))
  // headless 截图会少画窗口底部约 90px：窗口多给 120px，截完再裁
  const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--allow-file-access-from-files',
    `--user-data-dir=${profile}`, '--hide-scrollbars', '--force-device-scale-factor=1', '--virtual-time-budget=3000',
    `--window-size=750,${s.h + 120}`, `--screenshot=${out}`, `file://${htmlPath}`], { stdio: 'ignore' })
  const deadline = Date.now() + 120000
  let last = -1
  while (Date.now() < deadline) {
    const size = existsSync(out) ? statSync(out).size : 0
    if (size > 1000 && size === last) break
    last = size
    await new Promise((r) => setTimeout(r, 400))
  }
  try { child.kill('SIGKILL') } catch { /* ignore */ }
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
  try { rmSync(htmlPath, { force: true }) } catch { /* ignore */ }
  console.log(`✓ ${s.name} → ${out}（缺字段 ${missing.size}）`)
}

for (const s of SCENES) if (s.base) s.data = { ...SCENES.find((x) => x.name === s.base).data, ...s.data }
for (const s of SCENES) {
  if (only.length && !only.includes(s.name)) continue
  try { await shoot(s) } catch (e) { console.log(`✗ ${s.name}：${e.message.split('\n')[0]}（订单列表等页另有 render-bflow-preview）`) }
}
