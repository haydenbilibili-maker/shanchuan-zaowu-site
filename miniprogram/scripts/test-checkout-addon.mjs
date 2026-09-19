/**
 * 结账台「顺手带走一件」+ 免邮凑单 —— 行为断言
 *
 * 为什么必须跑真源码：这段逻辑的判据是**价格档位 + 排序优先级**，全是运行时行为：
 *   · 档位边界错 1 分钱（¥10.00 vs ¥10.01）就会把「低价标本」和「果实手链」混成一档；
 *   · 排序写反（先便宜后档位）会让 ¥48 的手链顶掉 ¥9 的标本 —— 与产品明确给定的优先级相反；
 *   · `hasSku` / 下架 / 售罄 的过滤一旦漏掉，结算栏会摆出一件**点了买不到**的东西。
 * 这些都是「静态看着对、跑起来错」的类型，所以按本仓库规矩：真源码 + 注入自检。
 *
 * 用法：
 *   node miniprogram/scripts/test-checkout-addon.mjs
 *   node miniprogram/scripts/test-checkout-addon.mjs --selftest
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const MODULE = 'miniprogram/utils/checkoutAddon.js'
const CART_JS = 'miniprogram/pages/cart/index.js'
const CART_WXML = 'miniprogram/pages/cart/index.wxml'

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

/* ------------------------------------------------------------------ *
 * 回归注入（在内存里改源码，绝不落盘；每条都必须让断言真的失败）
 * ------------------------------------------------------------------ */

const INJECTIONS = {
  'tier-order-flipped': {
    file: MODULE,
    from: '    if (a.tierIndex !== b.tierIndex) return a.tierIndex - b.tierIndex',
    to: '    if (a.tierIndex !== b.tierIndex) return b.tierIndex - a.tierIndex'
  },
  'cheapest-last': {
    file: MODULE,
    from: '    if (a.item.price !== b.item.price) return a.item.price - b.item.price',
    to: '    if (a.item.price !== b.item.price) return b.item.price - a.item.price'
  },
  'allow-has-sku': {
    file: MODULE,
    from: '  if (p.hasSku === true) return null',
    to: '  if (false) return null'
  },
  'allow-off-shelf': {
    file: MODULE,
    from: '  if (p.isOffShelf === true) return null',
    to: '  if (false) return null'
  },
  'allow-soldout': {
    file: MODULE,
    from: "  if (p.stock != null && p.stock !== '' && Number(p.stock) <= 0) return null",
    to: '  if (false) return null'
  },
  'no-cart-exclusion': {
    file: MODULE,
    from: '    if (exclude.has(c.id)) return',
    to: '    if (false) return'
  },
  'tier-boundary-off-by-one': {
    file: MODULE,
    // 把闭区间改成开区间：¥10.00 / ¥50.00 会掉出档（正是「差一分钱」的回归）
    from: '    if (p > lower && p <= tier.maxPrice) return i',
    to: '    if (p > lower && p < tier.maxPrice) return i'
  },
  'page-no-strip': {
    file: CART_WXML,
    from: 'class="addon-strip"',
    to: 'class="addon-strip-off"'
  },
  'page-no-toggle-collection': {
    file: CART_JS,
    from: "name: 'toggleCollection',",
    to: "name: 'toggleCollectionDisabled',"
  },
  'gap-uses-discounted-amount': {
    file: CART_JS,
    from: '      goodsAmount: total,',
    to: '      goodsAmount: final,'
  },
  'gap-filler-no-upper-bound': {
    file: MODULE,
    from: '    .filter((c) => c.price >= fs.gap && c.price <= max)',
    to: '    .filter((c) => c.price >= fs.gap)'
  },
  'gap-filler-no-lower-bound': {
    file: MODULE,
    // 去掉下界：缺口 ¥480 时也会把 ¥9.9 推成「凑单件」（凑了也到不了免邮）
    from: '    .filter((c) => c.price >= fs.gap && c.price <= max)',
    to: '    .filter((c) => c.price <= max)'
  },
  'gap-hides-when-nothing-selected': {
    file: MODULE,
    // 回归到最初那版：把「fee <= 0」当成已免邮 → 未勾选（合计 ¥0）时整块不显示
    from: '  const reached = campaignActive || coveredByCoupon || amountReached || !feeChargeable',
    to: '  const reached = campaignActive || coveredByCoupon || amountReached || !feeChargeable || fee <= 0'
  },
  'gap-ignores-coupon': {
    file: MODULE,
    from: '  const reached = gap <= 0 || fee <= 0 || coveredByCoupon',
    to: '  const reached = gap <= 0 || fee <= 0'
  },
  'addon-native-toast': {
    file: CART_JS,
    from: "      this.showAppToast({ overline: 'FAILED', title: '加入失败，请重试' })",
    to: "      wx.showToast({ title: '加入失败，请重试', icon: 'none' })"
  },
  'page-drops-coupon-flag': {
    file: CART_JS,
    from: "      shippingCoveredByCoupon: !!(currentCoupon && currentCoupon.type === 'freeShipping')",
    to: '      shippingCoveredByCoupon: false'
  },
  'freeship-row-missing': {
    file: CART_WXML,
    from: 'class="freeship-row"',
    to: 'class="freeship-row-off"'
  },
  'page-no-shelf-filter': {
    file: CART_JS,
    from: 'isOffShelf: _.neq(true)',
    to: 'isOffShelf: _.neq(false)'
  }
}

const INJECT = String(process.env.CHECKOUT_ADDON_INJECT || '').trim()
function readSrc(file) {
  const raw = readFileSync(resolve(ROOT, file), 'utf8')
  if (!INJECT) return raw
  const inj = INJECTIONS[INJECT]
  if (!inj) throw new Error('unknown injection ' + INJECT)
  if (inj.file !== file) return raw
  if (raw.indexOf(inj.from) === -1) throw new Error('injection anchor missing: ' + INJECT)
  return raw.replace(inj.from, inj.to)
}

/** 按大括号配平切出方法体（E7：切片要按语法边界，不能用固定长度窗口） */
function sliceMethod(src, header) {
  const start = src.indexOf(header)
  if (start < 0) return ''
  let depth = 0
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return ''
}

const mod = { exports: {} }
// eslint-disable-next-line no-new-func
new Function('module', 'exports', readSrc(MODULE))(mod, mod.exports)
const addon = mod.exports

/* ------------------------------------------------------------------ *
 * 1) 档位边界：¥10 / ¥50 是**含边界**的，多一分钱就出档
 * ------------------------------------------------------------------ */

eq('9.99 → 第一档（10 元以下）', addon.tierIndexOfPrice(9.99), 0)
eq('★ 10.00 → 第一档（边界含）', addon.tierIndexOfPrice(10), 0)
eq('★ 10.01 → 第二档（50 元以下）', addon.tierIndexOfPrice(10.01), 1)
eq('★ 50.00 → 第二档（边界含）', addon.tierIndexOfPrice(50), 1)
eq('★ 50.01 → 出档（不推荐）', addon.tierIndexOfPrice(50.01), -1)
eq('0 / 负数 / 非数字 → 出档', [0, -1, NaN, null, undefined, ''].map((v) => addon.tierIndexOfPrice(v)).join(','), '-1,-1,-1,-1,-1,-1')
eq('档位配置上界 = 需求给定的 10 / 50', addon.ADDON_TIERS.map((t) => t.maxPrice).join(','), '10,50')
eq('查询上界取最后一档（避免全量拉商品）', addon.ADDON_MAX_PRICE, 50)

/* ------------------------------------------------------------------ *
 * 2) 排序 = 业务优先级：先档位，再便宜，同价稳定
 * ------------------------------------------------------------------ */

const P = (id, price, extra) => Object.assign({ _id: id, title: id, price, stock: 10, images: [`https://x/${id}.png`] }, extra || {})

{
  const pool = addon.listCandidates([
    P('bracelet48', 48),   // 第二档
    P('specimen9', 9),     // 第一档
    P('specimen3', 3),     // 第一档更便宜
    P('chain50', 50)       // 第二档边界
  ])
  const pick = addon.pickAddon(pool)
  eq('★ ¥10 以下的标本优先于 ¥48 的手链（产品给定优先级）', pick.item.id, 'specimen3')
  eq('命中第一档', pick.tier.key, 'under10')
  eq('同档取最便宜（￥3 而不是 ￥9）', pick.item.price, 3)

  const onlyMid = addon.pickAddon(addon.listCandidates([P('bracelet48', 48), P('chain50', 50)]))
  eq('第一档为空时回落到第二档', onlyMid.item.id, 'bracelet48')
  eq('第二档标签正确', onlyMid.tier.label, '50 元以下')

  const none = addon.pickAddon(addon.listCandidates([P('pricey', 88)]))
  eq('无任何入档商品 → 不推荐（不硬凑）', none, null)
}

{
  // 同价稳定：标题排序，避免每次进购物车换一件（看起来像随机抖动）
  const a = addon.pickAddon(addon.listCandidates([P('b', 8), P('a', 8)]))
  const b = addon.pickAddon(addon.listCandidates([P('a', 8), P('b', 8)]))
  eq('★ 同价时结果稳定（两次顺序不同、结论相同）', a.item.id, b.item.id)
}

/* ------------------------------------------------------------------ *
 * 3) 候选过滤：多规格 / 下架 / 售罄 / 无价 / 已在车里
 * ------------------------------------------------------------------ */

{
  eq('多规格（hasSku）不进候选：不是「一次点按」的顺手件', addon.normalizeCandidate(P('sku', 8, { hasSku: true })), null)
  eq('下架（isOffShelf）不进候选', addon.normalizeCandidate(P('off', 8, { isOffShelf: true })), null)
  eq('库存 0 不进候选', addon.normalizeCandidate(P('zero', 8, { stock: 0 })), null)
  eq('无价格不进候选', addon.normalizeCandidate(P('noprice', 0)), null)
  eq('无 id 不进候选', addon.normalizeCandidate({ title: 'x', price: 8 }), null)
  check('库存缺失 → 仍可推荐（既有购物车把 NaN/0 视作 99）', !!addon.normalizeCandidate({ _id: 'nostock', title: 'x', price: 8 }))
  check('价格是字符串也能用（云端数字形态不统一）', addon.normalizeCandidate({ _id: 'str', title: 'x', price: '8.5' }).price === 8.5)

  const c = addon.normalizeCandidate({ _id: 'img', title: '标本', price: 6, images: [{ url: 'https://x/a.png' }], latinName: 'Rosa' })
  eq('images 对象数组能取出图片', c.image, 'https://x/a.png')
  eq('latinName 透传（卡片要展示学名）', c.latinName, 'Rosa')

  const listed = addon.listCandidates([P('a', 5), P('a', 5), P('b', 6)], { excludeIds: ['b'] })
  eq('★ 已在购物车里的商品不再推荐', listed.map((x) => x.id).join(','), 'a')
  eq('同一商品重复出现只算一件', listed.length, 1)
}

/* ------------------------------------------------------------------ *
 * 4) 文案：档位与价格必须出现，无推荐时返回 null
 * ------------------------------------------------------------------ */

{
  const pick = addon.pickAddon(addon.listCandidates([P('s', 9.5)]))
  const text = addon.buildAddonText(pick)
  eq('标题固定为「顺手带走一件」', text.title, '顺手带走一件')
  eq('文案带档位标签（让运营看得出命中哪一档）', text.tierLabel, '10 元以下')
  eq('文案带两位小数价格', text.priceText, '¥9.50')
  eq('无推荐 → 无文案（UI 据此整块不渲染）', addon.buildAddonText(null), null)
}

/* ------------------------------------------------------------------ *
 * 5) 免邮凑单（需求 2/3）
 * ------------------------------------------------------------------ */

/** 假运费配置：门槛 ¥500 / 运费 ¥18（只做本测试的算术夹具，与线上 v2 门槛 299 无关） */
const fakeShipping = (over) => Object.assign({
  // 与 config/shipping.js 同形：shippingFee / flatFee 两个字段线上一定存在
  shippingFee: 18,
  flatFee: 18,
  resolveThreshold: () => 500,
  calcShippingFee: (amount) => (amount >= 500 ? 0 : 18),
  resolveOrderKind: () => 'specimen',
  isCampaignActive: () => false,
  getCampaignLabel: () => '当前全场免邮',
  defaultCarrier: '顺丰速运'
}, over || {})

{
  const far = addon.computeFreeShipping({ goodsAmount: 20, selectedItems: [], shipping: fakeShipping() })
  eq('★ 缺口 = 门槛 − 优惠前合计', far.gap, 480)
  eq('缺口未达时不标已包邮', far.reached, false)
  eq('运费按既有 calcShippingFee 口径（¥18）', far.fee, 18)
  eq('★ 缺口文案与全局金额同口径（两位小数）', addon.computeFreeShipping({ goodsAmount: 492.5, selectedItems: [], shipping: fakeShipping() }).gapText, '7.50')
  eq('整数缺口也保留两位（不出现 ¥8 / ¥8.00 两种形态）', addon.computeFreeShipping({ goodsAmount: 492, selectedItems: [], shipping: fakeShipping() }).gapText, '8.00')

  // ★ 真机回归（2026-09-18）：购物车进入时所有条目 `selected:false` → 合计 ¥0。
  //   `calcShippingFee(0)` 也返回 0，若把「fee<=0」当已免邮，就会**整块不显示**免邮凑单行。
  {
    const empty = addon.computeFreeShipping({ goodsAmount: 0, selectedItems: [], shipping: fakeShipping() })
    eq('★ 未勾选任何商品（合计 ¥0）仍要显示免邮行', empty.reached, false)
    eq('未勾选时缺口 = 门槛', empty.gap, 500)
    eq('未勾选时进度为 0', empty.progress, 0)
    eq('未勾选时标出 nothingSelected（文案改中性）', empty.nothingSelected, true)
    eq('★ 未勾选时「当前运费」仍报规则运费，而不是 ¥0', empty.fee, 18)
    eq('未勾选时不说「再买」', empty.gapTitle, '全场满 ¥500 免运费')
    eq('已勾选时才是「再买 ¥x 免运费」', addon.computeFreeShipping({ goodsAmount: 492, selectedItems: [], shipping: fakeShipping() }).gapTitle, '再买 ¥8.00 免运费')

    // 运费 v2（蓝图 §19）：门槛是「全场」门槛，只在本单含收费装裱方式时才有值；
    // 纯免邮类（含 craftType 未标注）时 resolveThreshold 返回 0 → 规则上就不收运费，没有可凑的单。
    {
      const freeAll = addon.computeFreeShipping({
        goodsAmount: 250,
        selectedItems: [{ craftType: 'accessory' }],
        shipping: fakeShipping({ resolveThreshold: () => 0, calcShippingFee: () => 0 })
      })
      eq('★ 本单不含收费装裱方式（门槛 0）→ 已免邮', freeAll.reached, true)
      eq('★ 门槛 0 时不出现「满 ¥0」荒谬文案', freeAll.gapTitle, '本单免运费')
      eq('门槛 0 时说明原因', freeAll.detailText, '顺丰 · 本单免运费（不含相框/玻璃罩类）')
      eq('门槛 0 时不推凑单件', addon.pickGapFiller(addon.listCandidates([P('a', 9.9)]), freeAll), null)
    }

    const freeRule = addon.computeFreeShipping({ goodsAmount: 0, selectedItems: [], shipping: fakeShipping({ shippingFee: 0, flatFee: 0 }) })
    eq('★ 规则本身不收运费（shippingFee=0）→ 没有可省的运费，不显示凑单', freeRule.reached, true)

    // 配置里两个运费字段都缺失（异常配置）：按「要收运费」处理，不能把提示吞掉
    const noFeeField = addon.computeFreeShipping({
      goodsAmount: 300,
      selectedItems: [],
      shipping: { resolveThreshold: () => 500, calcShippingFee: () => 0, isCampaignActive: () => false }
    })
    eq('★ 运费字段缺失时 fail-safe：照常显示免邮进度', noFeeField.reached, false)
  }
  eq('进度按合计/门槛', far.progress, 4)

  const near = addon.computeFreeShipping({ goodsAmount: 492, selectedItems: [], shipping: fakeShipping() })
  eq('★ 缺口 ¥8 时挑「刚够免邮」的那件', addon.pickGapFiller(addon.listCandidates([P('a', 9.9), P('b', 48)]), near).id, 'a')
  eq('★ 缺口 ¥480 时不硬推（候选都够不到）', addon.pickGapFiller(addon.listCandidates([P('a', 9.9), P('b', 48)]), far), null)
  eq('★ 上界 = 缺口 + 运费：加它多花的钱不超过本来要付的运费', addon.pickGapFiller(addon.listCandidates([P('over', 27)]), near), null)
  eq('边界含上界（26 = 8 + 18 可推）', addon.pickGapFiller(addon.listCandidates([P('edge', 26)]), near).id, 'edge')

  const reached = addon.computeFreeShipping({ goodsAmount: 520, selectedItems: [], shipping: fakeShipping() })
  eq('已达门槛 → reached', reached.reached, true)
  eq('已达门槛 → 不再推凑单件', addon.pickGapFiller(addon.listCandidates([P('a', 9.9)]), reached), null)

  const camp = addon.computeFreeShipping({ goodsAmount: 20, selectedItems: [], shipping: fakeShipping({ isCampaignActive: () => true }) })
  eq('★ 全场免邮活动期 → 不显示凑单（无运费可省）', camp.campaignActive && camp.reached, true)
  eq('活动期文案用活动 label', camp.detailText, '当前全场免邮')
  eq('活动期不推凑单件', addon.pickGapFiller(addon.listCandidates([P('a', 9.9)]), camp), null)

  eq('运费配置缺失 → 返回 null（页面据此不渲染，不抛错）', addon.computeFreeShipping({ goodsAmount: 20, shipping: null }), null)

  // 免邮券：券的节省额 = 运费本身，此时再劝「再买 ¥x 免运费」两个提示会互相打架
  const couponed = addon.computeFreeShipping({ goodsAmount: 492, selectedItems: [], shipping: fakeShipping(), shippingCoveredByCoupon: true })
  eq('★ 已选免邮券 → 视为已包邮', couponed.reached, true)
  eq('★ 已选免邮券 → 文案说明是券免的，不是「再买」', couponed.detailText, '已用免邮券 · 本单免运费')
  eq('★ 已选免邮券 → 不再推凑单件', addon.pickGapFiller(addon.listCandidates([P('a', 9.9)]), couponed), null)

  const attached = addon.attachGapFiller(near, addon.listCandidates([P('a', 9.9), P('b', 48)]))
  eq('attachGapFiller 写入 filler', attached.filler.id, 'a')
  check('attachGapFiller 生成可读文案', /加 ¥9\.90「a」即免邮/.test(attached.fillerText))
  eq('无合格凑单件时 filler 为 null 且无文案', addon.attachGapFiller(far, addon.listCandidates([P('a', 9.9)])).filler, null)
}

{
  const js = readSrc(CART_JS)
  const wxml = readSrc(CART_WXML)
  const wxss = readFileSync(resolve(ROOT, 'miniprogram/pages/cart/index.wxss'), 'utf8')

  check('data 里有 freeShip', /freeShip: null,/.test(js))
  check(
    '★ 缺口按**优惠前合计**算（不能传折后应付，否则与确认页/makeOrder 对不上）',
    /goodsAmount: total,/.test(js) && !/goodsAmount: final/.test(js)
  )
  check('用既有 shippingConfig 作口径源（不在页面里另写门槛）', /shipping: shippingConfig/.test(js))
  check(
    '★ 已选免邮券时传标志位（避免「券免邮」与「再买免邮」同屏打架）',
    /shippingCoveredByCoupon: !!\(currentCoupon && currentCoupon\.type === 'freeShipping'\)/.test(js)
  )
  check('候选就绪后重算一次（凑单件要从候选池里挑）', /this\.calculateTotal\(\)\n\s*this\.remeasureScroll\(\)/.test(js))
  check('未达门槛渲染免邮行', /class="freeship-row" wx:if="\{\{freeShip && !freeShip\.reached\}\}"/.test(wxml))
  check('已包邮回落到规则文案（两行不重复出现）', /class="shipping-hint-row" wx:elif="\{\{shippingHint\}\}"/.test(wxml))
  check('凑单件可一次点按加购', /catchtap="takeGapFiller"/.test(wxml) && /\{\{freeShip\.fillerText\}\}/.test(wxml))
  check('进度条宽度绑定 progress', /style="width: \{\{freeShip\.progress\}\}%;"/.test(wxml))

  const cls = ['freeship-row', 'freeship-head', 'freeship-gap', 'freeship-rule', 'freeship-track', 'freeship-fill', 'freeship-filler', 'freeship-filler-text', 'freeship-filler-cta']
  const miss = cls.filter((c) => !wxss.includes('.' + c))
  check('免邮行样式齐备', miss.length === 0, miss.join(','))
}

/* ------------------------------------------------------------------ *
 * 6) 模块必须是纯的：不碰 wx / 不自己发请求（否则无法被断言，也无法在结算页复用）
 * ------------------------------------------------------------------ */

{
  const src = readSrc(MODULE)
  check('★ 纯逻辑：不出现 wx. 调用', !/\bwx\./.test(src))
  check('★ 纯逻辑：不 require 任何东西', !/\brequire\(/.test(src))
}

/* ------------------------------------------------------------------ *
 * 7) 购物车页接线：候选怎么取、点按怎么落库、UI 挂在结算栏里
 * ------------------------------------------------------------------ */

{
  const js = readSrc(CART_JS)
  const wxml = readSrc(CART_WXML)
  const wxss = readFileSync(resolve(ROOT, 'miniprogram/pages/cart/index.wxss'), 'utf8')

  check('页面引用纯逻辑模块（不在页面里另写一套档位）', /require\('\.\.\/\.\.\/utils\/checkoutAddon'\)/.test(js))
  check('★ 候选池按上架过滤（与 C 端列表同口径 isOffShelf: _.neq(true)）', /isOffShelf: _\.neq\(true\)/.test(js))
  check('★ 候选池排除多规格（hasSku ≠ true）', /hasSku: _\.neq\(true\)/.test(js))
  check('★ 候选池带上界（只拉低价，不把全量商品拉下来）', /price: _\.lte\(checkoutAddon\.ADDON_MAX_PRICE\)/.test(js))
  check(
    '★ 已在购物车里的商品被排除（从 cartList 取 productId 并传进 listCandidates）',
    /const excludeIds = items\.map\(\(i\) => i\.productId\)/.test(js) &&
      /listCandidates\(res\.data \|\| \[\], \{ excludeIds \}\)/.test(js)
  )
  check('挑选用 pickAddon + buildAddonText（判定不散落在页面里）', /checkoutAddon\.pickAddon\(candidates\)/.test(js) && /checkoutAddon\.buildAddonText\(pick\)/.test(js))
  check('清单就绪后触发加载（依赖 cartList 做排除）', /this\.loadCheckoutAddon\(\)/.test(js))
  check('用户关掉后不再自动冒出（addonDismissed 守卫）', /this\.data\.addonDismissed/.test(js))

  // 页面里 toggleCollection 共 4 处调用（改数量 / 删除 / 清理失效 / 结账台加购），
  // 必须**只在本方法体内**判断写路径，否则改名注入会被别处的合法调用掩盖（E7：判据要精确）
  const addBody = sliceMethod(js, 'async _addCheapItem(item, source) {')
  check('能按语法边界切出 _addCheapItem（不用固定长度切片）', addBody.length > 200)
  check(
    '★ 结账台加购走既有 toggleCollection 写路径（不新开直写）',
    // 必须带收尾逗号：否则 'toggleCollectionDisabled' 这种改名也会被正则放过
    /name: 'toggleCollection',/.test(addBody) && /action: 'add',/.test(addBody)
  )
  check('加购后重载购物车（清单与合计同步）', /await this\.loadCollection\(\)/.test(addBody))
  check('加购事件已埋点（guard 会校验双端 schema）', /trackBehavior\('checkout_extra_add'/.test(addBody))
  check('失败不静默：给可见提示（AppToast 铭牌提示）', /this\.showAppToast\([^)]*'加入失败，请重试'/.test(addBody))
  check('顺手件与凑单件共用这一条写路径（不各写一份）', /takeCheckoutAddon\(\)[\s\S]{0,120}_addCheapItem\(this\.data\.addonPick, 'addon'\)/.test(js))
  check('凑单件也走同一路径并标记 source=gap（便于报表区分两种加购）', /takeGapFiller\(\)[\s\S]{0,160}_addCheapItem\(filler, 'gap'\)/.test(js))

  check('★ 顺手件挂在结算栏内部（随结算栏固定，不随清单滚走）', (() => {
    const barTop = wxml.indexOf('class="checkout-bar safe-area"')
    const strip = wxml.indexOf('class="addon-strip"')
    const barMain = wxml.indexOf('class="bar-main"')
    return barTop > -1 && strip > barTop && barMain > strip
  })())
  check('整块由 addonPick 门控（无候选时不渲染空壳）', /class="addon-strip" wx:if="\{\{addonPick && addonText\}\}"/.test(wxml))
  check('CTA 绑定 takeCheckoutAddon', /catchtap="takeCheckoutAddon"/.test(wxml))
  check('可关闭（dismissCheckoutAddon）', /catchtap="dismissCheckoutAddon"/.test(wxml))
  check('缩略图/标题可进详情（沿用 goToDetail）', (wxml.match(/bindtap="goToDetail" data-id="\{\{addonPick\.id\}\}"/g) || []).length === 2)

  const classes = ['addon-strip', 'addon-thumb-wrap', 'addon-thumb', 'addon-copy', 'addon-title', 'addon-reason', 'addon-price', 'addon-cta', 'addon-close']
  const missing = classes.filter((c) => !wxss.includes('.' + c))
  check('新增样式齐备（不留无样式 class）', missing.length === 0, missing.join(','))

  // 轻提示必须走 AppToast（弹窗棘轮 check:dialog-ratchet 不允许新增原生 toast）
  const json = readFileSync(resolve(ROOT, 'miniprogram/pages/cart/index.json'), 'utf8')
  check('页面注册 AppToast 组件', /"app-toast": "\/components\/AppToast\/index"/.test(json))
  check('WXML 挂载 AppToast 宿主（含关闭回调）', /<app-toast[\s\S]{0,200}show="\{\{toastShow\}\}"[\s\S]{0,300}bind:close="onToastClose"/.test(wxml))
  check('JS 有统一 setter / 关闭回调', /showAppToast\(\{ overline = '', title = '', desc = '', duration = 0 \} = \{\}\)/.test(js) && /onToastClose\(\) \{\n\s*this\.setData\(\{ toastShow: false \}\)/.test(js))
  {
    const body = sliceMethod(js, 'async _addCheapItem(item, source) {')
    check('★ 加购反馈走 AppToast，不得用原生 wx.showToast（棘轮会红）', /this\.showAppToast\(/.test(body) && !/wx\.showToast\(/.test(body))
  }
}

/* ------------------------------------------------------------------ */

if (process.argv.includes('--selftest') && !INJECT) {
  const { spawnSync } = await import('node:child_process')
  let bad = 0
  for (const name of Object.keys(INJECTIONS)) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, CHECKOUT_ADDON_INJECT: name },
      encoding: 'utf8'
    })
    if (run.status !== 0) console.log(`  ✓ 注入 ${name} 被检出`)
    else {
      bad += 1
      console.error(`  ✗ 注入 ${name} 未被检出（断言不会失败 = 守卫无效）`)
    }
  }
  const clean = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
  if (clean.status !== 0) {
    bad += 1
    console.error('  ✗ 未注入时本应通过，实际失败：')
    console.error(clean.stdout || clean.stderr)
  } else {
    console.log('  ✓ 未注入时通过（无假阳性）')
  }
  if (bad) {
    console.error(`\n✗ selftest 失败 ${bad} 项`)
    process.exit(1)
  }
  console.log(`\n✓ selftest 通过：${Object.keys(INJECTIONS).length} 个回归注入全部被检出，且无假阳性`)
  process.exit(0)
}

console.log(`\n结账台「顺手带走一件」断言：通过 ${passed} / ${passed + failed}`)
if (failed) {
  failures.forEach((f) => console.error('  ✗ ' + f))
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ 通过（档位边界 / 档位优先于价格 / 过滤多规格与下架售罄 / 排除购物车已有 / 文案与纯度）')
