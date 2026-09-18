/**
 * 列表封面（礼赠 hub / 标本师主页）守卫
 *
 * 真机反馈：两处列表**封面全空**（标题价格正常）。实测（tcb fn invoke getGiftSceneProducts）确认：
 *   商品的 `images[0]` 就是 `cloud://` 云文件 ID，图是好的 —— 问题在客户端各写了一套封面逻辑：
 *   · 礼赠 hub 把 `cloud://` 转临时链，转换没命中时**把值丢成空串**（`… : ''`）→ 封面全空；
 *   · 标本师主页只认服务端临时链（会过期），没有「原始云文件 ID」这条更稳的路。
 * 而本仓既有口径（首页 / 馆藏 ProductList）是：**云文件 ID 直接交给 <image>**（可直接渲染、不过期），
 * 需要缩略时才 `thumbUrl()`（不可用时回落原值）。
 *
 * 本守卫钉住：① 取值链是共享的、**绝不把 cloud:// 丢空**；② 两页都走共享链；
 *            ③ 列表数据里不再依赖会过期的临时链；④ 封面加载失败有回落，不留破图。
 *
 * 用法：
 *   node miniprogram/scripts/test-list-cover-images.mjs
 *   node miniprogram/scripts/test-list-cover-images.mjs --selftest
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

const IMAGE_URL = 'miniprogram/utils/imageUrl.js'
const HUB_JS = 'miniprogram/subpackages/feature/gift/hub/index.js'
const HUB_WXML = 'miniprogram/subpackages/feature/gift/hub/index.wxml'
const FRAMER_JS = 'miniprogram/subpackages/business/framer/index.js'
const STAFF_FN = 'miniprogram/cloudfunctions/manageStaff/index.js'
const PAGE_INDEX = 'miniprogram/pages/index/index.js'
const WIKI_JS = 'miniprogram/subpackages/feature/detail/wiki-detail/index.js'
const CUSTOM_JS = 'miniprogram/subpackages/feature/custom/index.js'
const MANAGER_JS = 'miniprogram/subpackages/manager/manager/managerPageConfig.js'
const DETAIL_WXML = 'miniprogram/subpackages/feature/detail/index.wxml'
const GATE_WXSS = 'miniprogram/components/SensitiveBlurGate/index.wxss'
// 2026-09-20 真机反馈「你可能也喜欢图片展示错误」（三张卡是深色空块）→ 本页也纳入本守卫
const CART_JS = 'miniprogram/pages/cart/index.js'
const CART_WXML = 'miniprogram/pages/cart/index.wxml'
const CART_WXSS = 'miniprogram/pages/cart/index.wxss'

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
function eq(name, got, want) {
  check(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}
const read = (f) => readFileSync(resolve(ROOT, f), 'utf8')
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** imageUrl 里用到 wx（getImageInfo）—— 桩掉即可，firstImageOf 本身是纯函数 */
function loadImageUrl() {
  const module = { exports: {} }
  const wxStub = { getImageInfo: () => {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'wx', read(IMAGE_URL))(module, module.exports, wxStub)
  return module.exports
}

const imageUrl = loadImageUrl()
const hubJs = stripComments(read(HUB_JS))
const hubWxml = read(HUB_WXML)
const framerJs = stripComments(read(FRAMER_JS))
const staffFn = stripComments(read(STAFF_FN))
const cartJs = stripComments(read(CART_JS))
const cartWxml = read(CART_WXML)
const cartWxss = stripComments(read(CART_WXSS))

/* ── 1) 取值链（纯函数，真源码） ─────────────────────────────────────────── */
eq('★ images[0] 优先（即使它是 cloud:// 也不能丢）',
  imageUrl.firstImageOf({ images: ['cloud://env.bucket/products/a.png'] }), 'cloud://env.bucket/products/a.png')
eq('★ cloud:// 不会被判空', imageUrl.firstImageOf({ images: ['cloud://x'] }) === '' , false)
eq('images 空 → 回落 image', imageUrl.firstImageOf({ images: [], image: 'b' }), 'b')
eq('回落 coverImage（服务端字段）', imageUrl.firstImageOf({ coverImage: 'c' }), 'c')
eq('回落 cover', imageUrl.firstImageOf({ cover: 'd' }), 'd')
eq('回落 httpImage', imageUrl.firstImageOf({ httpImage: 'e' }), 'e')
eq('全空 → 空串', imageUrl.firstImageOf({ images: [] }), '')
eq('null 安全', imageUrl.firstImageOf(null), '')
eq('空白字符串不算有效值', imageUrl.firstImageOf({ image: '   ', cover: 'd' }), 'd')

/* ── 1.5) 云文件 ID → https（这次真正的修复点） ───────────────────────────── */
// 实测（tcb storage url products/cover_0_….png）返回：
//   https://636c-cloud1-8gnkty5bfff9f0bf-1387508856.tcb.qcloud.la/products/cover_0_….png
// 即 cloud://<envId>.<bucket>/<path> 可纯字符串换成该 https 地址（无签名、不过期）。
const REAL_ID = 'cloud://cloud1-8gnkty5bfff9f0bf.636c-cloud1-8gnkty5bfff9f0bf-1387508856/products/cover_0_1789641420527_tkogaj.png'
const REAL_HTTPS = 'https://636c-cloud1-8gnkty5bfff9f0bf-1387508856.tcb.qcloud.la/products/cover_0_1789641420527_tkogaj.png'
eq('★ 真实云文件 ID 换算出与 CLI 实测一致的 https 地址', imageUrl.cloudIdToHttps(REAL_ID), REAL_HTTPS)
eq('★ thumbUrl(cloud://) 必须给出可渲染的 https（<image> 渲染不了 cloud://）',
  imageUrl.thumbUrl(REAL_ID), REAL_HTTPS)
eq('★ detailUrl(cloud://) 同理', imageUrl.detailUrl(REAL_ID), REAL_HTTPS)
eq('幂等：已是 https 原样', imageUrl.cloudIdToHttps(REAL_HTTPS), REAL_HTTPS)
eq('空值/非云文件安全', imageUrl.cloudIdToHttps('') + '|' + imageUrl.cloudIdToHttps('/local/a.png'), '|/local/a.png')
eq('畸形 cloud:// 不炸（无路径）', imageUrl.cloudIdToHttps('cloud://env.bucket'), 'cloud://env.bucket')
eq('firstImageOf + thumbUrl 串起来就是可渲染地址',
  imageUrl.thumbUrl(imageUrl.firstImageOf({ images: [REAL_ID] })), REAL_HTTPS)

/* ── 1.6) 其余直绑 images[0] 的页面（同一类 bug，一并收口） ───────────────── */
// ⚠️ 判据盯"意图"而不是函数名：封面必须走 imageUrl 的**尺寸化派生**（不得直出 cloud://）。
// 2026-09-18 首页推荐位按实测卡宽（280rpx=140pt）从 thumbUrl 改成了 midUrl ——
// 写死函数名会把"合法换档"误报成回归（错题本 E7：判据语义错 → 假失败）。
check(
  '★ 首页推荐位封面走尺寸化派生（rail/mid/thumb 任一档，且带只缩不放的 `>`）',
  /(railUrl|midUrl|thumbUrl)\(getFirstImage\(item\.images\)/.test(stripComments(read(PAGE_INDEX))),
  '首页又把原始 cloud:// 塞给 <image>'
)
check(
  '★ 首页推荐位没有绕过派生直出原值',
  !/image:\s*getFirstImage\(item\.images\)/.test(stripComments(read(PAGE_INDEX))),
  '发现未经尺寸化的直出赋值'
)
check('★ 物种百科缩略走 thumbUrl', /thumbUrl\(getFirstImage\(p\.images\)\)/.test(stripComments(read(WIKI_JS))))
check('★ 定制页商品 images 经 thumbUrl 换算',
  /images: \(Array\.isArray\(p\.images\) \? p\.images : \[\]\)\.map\(\(u\) => imageUrl\.thumbUrl\(u\)\)/.test(stripComments(read(CUSTOM_JS))))
check('★ 超管商品列表 images 经 thumbUrl 换算',
  /images: \(Array\.isArray\(it\.images\) \? it\.images : \[\]\)\.map\(\(u\) => imageUrl\.thumbUrl\(u\)\)/.test(stripComments(read(MANAGER_JS))))
check('★ 详情页 360°/SKU 两处改用 imgView 映射（不再直绑 cloud://）',
  !/src="\{\{product\.images\[0\]\}\}"/.test(read(DETAIL_WXML))
  && /imgView\[product\.images\[0\]\]/.test(read(DETAIL_WXML))
  && /imgView\[selectedSku\.image \|\| product\.images\[0\]\]/.test(read(DETAIL_WXML)),
  '详情页还有直绑云文件 ID 的 <image>')

/* ── 1.7) 敏感门控组件必须自己撑开父级（否则卡图被裁成空白） ───────────────── */
// 2026-09-17 真机：礼赠 hub / 标本师作品的图全空，而没被门控包住的头图正常。
// 根因：卡片外层是 `padding-top:100%` 比例盒（content 高度为 0），自定义组件宿主默认 inline
// 不被拉伸 → `.sb-wrap{height:100%}` 算成 0，叠加 overflow:hidden 把绝对定位的图片裁没了。
// ProductCard 之前是靠页面级 `.img-box .sb-wrap{position:absolute}` 局部绕过的；这里在组件内修掉。
{
  const gate = stripComments(read(GATE_WXSS))
  check('★ 门控组件声明 :host（宿主不被拉伸是空白卡的根因）', /:host\s*\{/.test(gate), '缺 :host')
  check('★ :host 铺满父级 padding box（position:absolute + 100% 宽高）',
    /:host\s*\{[^}]*position:\s*absolute/.test(gate)
    && /:host\s*\{[^}]*width:\s*100%/.test(gate)
    && /:host\s*\{[^}]*height:\s*100%/.test(gate),
    ':host 未铺满 → 比例盒内高度仍为 0')
  check('★ :host 是块级（display:block）', /:host\s*\{[^}]*display:\s*block/.test(gate))
  check('门控容器仍裁切（罩层与模糊不外溢）', /\.sb-wrap\s*\{[^}]*overflow:\s*hidden/.test(gate))
}

/* ── 1.8) 组件宿主尺寸棘轮（同类风险逐个核实后的制度化） ───────────────────── */
// 2026-09-17 逐个核实结论：全仓「overflow:hidden + height:100%」的组件里，**只有 SensitiveBlurGate**
// 真的依赖宿主高度（它在比例盒与绝对定位图片之间插了一个 0 高的定位容器）→ 已用 :host 修掉。
// 其余（ProductFilterPanel / ProductCard / MemberLevelModal / UserVipCard / WalletPanelPoints /
// WalletPanelWallet / CouponPrintMint×2 / SpeciesCard）都是「自撑开」：根或图盒有 fixed/inset、
// 显式 rpx 高度、vh、aspect-ratio 或 padding-top 比例盒，与宿主高度无关。
// 本棘轮：**新出现**一个既无 :host、又不自撑开的此类组件时，守卫报错要求复核（不允许静默长出来）。
{
  const COMPONENT_DIRS = [
    'components/ProductFilterPanel', 'components/ProductCard', 'components/MemberLevelModal',
    'components/UserVipCard', 'components/SensitiveBlurGate',
    'subpackages/business/components/WalletPanelPoints', 'subpackages/business/components/WalletPanelWallet',
    'subpackages/business/components/WalletPanelCoupons', 'subpackages/business/components/CouponPrintMint',
    'subpackages/feature/components/SpeciesCard', 'subpackages/feature/components/CouponPrintMint'
  ]
  const risky = []
  for (const dir of COMPONENT_DIRS) {
    const wxss = stripComments(read('miniprogram/' + dir + '/index.wxss'))
    if (!/overflow:\s*hidden/.test(wxss)) continue
    if (!/height:\s*100%/.test(wxss)) continue
    const hasHost = /:host\s*\{/.test(wxss)
    const selfContained =
      /position:\s*fixed/.test(wxss) ||
      /height:\s*\d+(rpx|px|vh|vw)/.test(wxss) ||
      /aspect-ratio/.test(wxss) ||
      /padding-top:\s*100%/.test(wxss)
    if (!hasHost && !selfContained) risky.push(dir)
  }
  check('★ 无「既没有 :host 又不自撑开」的组件（否则卡片图会被裁成空白）',
    risky.length === 0, risky.join(', '))
}

/* ── 2) 礼赠 hub ─────────────────────────────────────────────────────────── */
// ── 购物车（2026-09-20 真机反馈：你可能也喜欢三张卡是深色空块）────────────────
// 根因：本页**漏了共享链的最后一步 thumbUrl()** —— 于是临时链一失败，src 上留下的
// `cloud://` 就永远渲染不出来（本守卫 :88 已钉死「<image> 渲染不了 cloud://」），
// 走 binderror → 清空 → 占位块；而占位块是深底 + 45% 透明图标 ≈ 看不见。
check('★ 购物车推荐封面走共享 thumbUrl（cloud:// 在这里被确定性换成可渲染 https）',
  /imageUrl\.thumbUrl\(/.test(cartJs))
check('★ 购物车推荐封面绝不把 cloud:// 丢空（临时链未命中回落原值）',
  /urlMap\[item\.image\]\)\s*\|\|\s*item\.image/.test(cartJs))
check('★ 购物车推荐封面失败有回落，且占位**看得见**（不透明度 ≥ 0.7；原 0.45 深底上≈不可见）',
  (() => {
    const m = /\.rec-img-ph-icon\s*\{[^}]*opacity:\s*([0-9.]+)/.exec(cartWxss)
    return !!m && Number(m[1]) >= 0.7
  })())
check('★ 购物车缩略图有缺图占位分支（此前 onCartThumbError 清空 src 后模板没有 wx:else → 空白）',
  /class="thumb-ph"/.test(cartWxml) && /class="thumb-ph-icon"/.test(cartWxml))
check('★ 购物车占位文案用可读的次要色（不是深面上 2.7~3.1 的 muted）',
  /\.rec-img-ph-text\s*\{[^}]*var\(--color-text-secondary\)/.test(cartWxss))

check('★ hub 封面走共享取值链', /imageUrl\.firstImageOf\(/.test(hubJs))
check('★ hub 不再为封面做临时链转换（会过期、失败即丢空）',
  !/batchTempFileURLs\s*\(/.test(hubJs), '又回去转临时链 → 转换失败时封面会全空')
check('★ hub 不再出现「cloud:// 就丢空」的写法',
  !/startsWith\('cloud:\/\/'\)\s*\?\s*raw\s*:\s*''/.test(hubJs), 'cover 计算又把 cloud:// 丢成空串')
check('hub 封面经 thumbUrl（不可用时回落原值）', /imageUrl\.thumbUrl\(raw\)/.test(hubJs))
check('★ hub 封面加载失败有回落（不留破图）',
  /onCoverError\(e\)/.test(hubJs) && /binderror="onCoverError"/.test(hubWxml),
  '缺 binderror → 破图会一直挂着')

/* ── 3) 标本师主页 ───────────────────────────────────────────────────────── */
check('★ 标本师主页封面走共享取值链', /imageUrl\.firstImageOf\(item\)/.test(framerJs))
check('★ 标本师主页优先用不过期的原始 ID，而不是服务端临时链',
  /imageUrl\.thumbUrl\(raw\)/.test(framerJs) && /coverFileId/.test(framerJs),
  '仍只认会过期的临时链')
check('标本师主页保留兜底图与错误回落',
  /FALLBACK_COVER/.test(framerJs) && /onWorkCoverError/.test(read(FRAMER_JS)))
check('★ 云函数 works 同时给出原始云文件 ID 与 images',
  /coverFileId: raw/.test(staffFn) && /images: Array\.isArray\(item\.images\)/.test(staffFn),
  'works 只回传临时链 → 客户端没有更稳的来源')

/* ── 输出 / 自检 ─────────────────────────────────────────────────────────── */
if (process.argv.includes('--selftest')) {
  selftest()
} else if (failed) {
  console.log('✗ 列表封面检查失败：')
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`✗ ${failed} 项失败 / ${passed} 项通过`)
  process.exit(1)
} else {
  console.log(`✓ 列表封面：${passed} 项通过（取值链不丢 cloud:// / 两页走同一链 / 不依赖会过期的临时链 / 有错误回落）`)
}

function selftest() {
  const injections = [
    {
      name: '购物车推荐又漏掉 thumbUrl（临时链一失败就永远出不来）',
      file: CART_JS,
      from: '      const next = origin ? imageUrl.thumbUrl(origin) : origin;',
      to: '      const next = origin;'
    },
    {
      name: '购物车占位图标又调回不可见的 0.45',
      file: CART_WXSS,
      from: '  width: 56rpx;\n  height: 56rpx;\n  opacity: 0.8;',
      to: '  width: 56rpx;\n  height: 56rpx;\n  opacity: 0.45;'
    },
    {
      name: '购物车缩略图占位分支被删（清空 src 后直接空白）',
      file: CART_WXML,
      from: '                    <view class="thumb-ph" wx:else>\n                      <image class="thumb-ph-icon" src="/assets/icons/box.png" mode="aspectFit"></image>\n                    </view>',
      to: ''
    },
    {
      name: '取值链不再看 images（回到只认 coverImage）',
      file: IMAGE_URL,
      from: '  const candidates = [imgs[0], item.image, item.coverImage, item.cover, item.httpImage]',
      to: '  const candidates = [item.coverImage]'
    },
    {
      name: 'hub 又回去转临时链（失败即封面全空）',
      file: HUB_JS,
      from: '        const raw = imageUrl.firstImageOf(p)\n        const cover = raw ? imageUrl.thumbUrl(raw) : \'\'',
      to: '        const raw = imageUrl.firstImageOf(p)\n        const urlMap = await batchTempFileURLs([raw])\n        const cover = (raw && urlMap[raw]) || (raw && !String(raw).startsWith(\'cloud://\') ? raw : \'\') || \'\''
    },
    {
      name: 'thumbUrl 不再把云文件 ID 换 https（封面又会全空）',
      file: IMAGE_URL,
      from: 'function thumbUrl(url, width) {\n  const u = cloudIdToHttps(url)',
      to: 'function thumbUrl(url, width) {\n  const u = url'
    },
    {
      name: '门控组件丢掉 :host（卡片图又被裁成空白）',
      file: GATE_WXSS,
      from: ':host {\n  display: block;\n  position: absolute;\n  left: 0;\n  top: 0;\n  width: 100%;\n  height: 100%;\n}\n',
      to: ''
    },
    {
      name: '详情页 360° 又直绑 images[0]',
      file: DETAIL_WXML,
      from: '<image src="{{imgView[product.images[0]] || product.images[0]}}" mode="aspectFill"></image>',
      to: '<image src="{{product.images[0]}}" mode="aspectFill"></image>'
    },
    {
      name: '首页推荐位又直绑原始值',
      file: PAGE_INDEX,
      from: 'image: require(\'../../utils/imageUrl\').midUrl(getFirstImage(item.images) || item.httpImage || \'\'),',
      to: "image: getFirstImage(item.images) || item.httpImage || '',"
    },
    {
      name: 'hub 去掉封面错误回落',
      file: HUB_WXML,
      from: '                  binderror="onCoverError"\n',
      to: ''
    },
    {
      name: '标本师主页又只认临时链',
      file: FRAMER_JS,
      from: '        const raw = imageUrl.firstImageOf(item) || item.coverFileId || \'\'',
      to: "        const raw = item.coverImage || ''"
    },
    {
      name: '云函数 works 不再给原始云文件 ID',
      file: STAFF_FN,
      from: '        coverFileId: raw,\n',
      to: ''
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
