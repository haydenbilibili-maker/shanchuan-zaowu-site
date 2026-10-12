#!/usr/bin/env node
/**
 * check:gift-compose-steps —— 送礼页「礼赠编排」的版式与分步守卫（2026-10-12 产品负责人点名）
 *
 *   L 拉得到底：滚动区高度 = 自身顶边 → 底栏顶边（真跑 syncScrollPane，桩 wx 给尺寸）。
 *     起因：旧算法只减步骤轨、漏减音效条，底部留白又写死 160rpx，而底栏带会员价小字 + 安全区后更高
 *     → 最后一行「WRAP · 包装」压在底栏下（「犒劳自己」最明显）。底栏高度一变（会员价晚到）须重量。
 *   T 分步编排（产品负责人：「将礼赠编排从一步变成 2-3 步，避免在一个环节上堆叠过多信息」；
 *     2026-10-12 第六轮再收一步：**第 3 步「交付」并入确认订单页**，送礼页只剩 01 选礼 / 02 写笺）：
 *     版面 —— 01 选礼（藏品 + 送给谁 + 包装与隐价）/ 02 写笺（称呼 / 正文 / 署名 / 语音 / 换一句）各在各步；
 *     交付方式 / 地址 / 门店 / 领取核验整块已移出送礼页（见 check:gift-claim-link 与 check:gift-delivery-step）；
 *     底栏只有一个「下一步」（第 1 步 → 写笺；第 2 步 →「下一步 · 交付与支付」= goPay）；goPay 只在第 2 步放行；
 *     写笺必填在「下一步」就地校验、进确认页前再过一遍（不通过停在第 2 步）；步骤轨只能点回到过的步；
 *     第 3 格「交付与支付」= 去确认页（到过写笺才可点）；「上一步」与左缘右滑在第 2 步回上一步、第 1 步才离开；
 *     第 1 步点关系不在看不见处落笔；
 *     **契约零变化**：交给确认页的 giftMeta 字段集合逐一比对（真跑 goPay，桩掉跳转）；不再写 globalData.giftReceiverPhone /
 *     giftShipAddress（交付在确认页录入，见 check:gift-claim-link）；新埋点 gift_compose_step 双端登记、旧埋点不动。
 *   D 去密集（产品负责人真机看旧第 3 步：「太密集，信息过载」）：交付卡与领取核验的「只给可选项描边 / 长说明折叠」
 *     两条口径**随交付卡一起搬到确认页**（同类断言在 check:gift-delivery-step，送礼页不得复活交付 UI）；送礼页保留「隐价一行开关 / 包装逐项 / 音效并入步骤轨 /
 *     底栏备妥应付与价格同一行」。
 *   N 自定义顶栏（产品负责人拍板：左上返回在第 2 步回上一步，第 1 步才离开，不弹确认）：index.json 设 custom、胶囊白色；
 *     顶栏高度按胶囊位置算（真跑 customNav + _initNav）；标题左右各让出胶囊宽；三种页态都给顶栏留白；
 *     左上返回与左缘右滑同一口径（真跑 onNavBack），直达无上一页时回馆藏；占位高度也减顶栏。安卓实体返回键拦不住（不测）。
 *   P 隐价与包装在第 1 步：开关只在第 1 步、说明随开关状态变、平台强制时无开关；
 *     toggleHidePrice 仍守平台强制、goPay 交给 makeOrder 的 hidePrice 语义不变（真跑）；包装逐项说明只写代码里确有的事实（真读 giftPackaging.js）。
 *   S 第 1 步「送给谁」选中反馈：被选 chip 实心 + 勾、藏品卡描金并出「送给 · X」小签、提示改为「已选「X」」、
 *     犒劳自己提示就近入场；全部由 activeNotePresetId / selfTreat 派生（真渲染 index.wxml，不新增状态，不碰 selfTreat 进出逻辑）。
 *   V 领取核验的**送礼页一侧**：不再在送礼页渲染（整块搬到确认页的承接口径见 check:gift-delivery-step）；
 *     这里只钉住「送礼页不得复活交付 UI 与核验接线」（含四选一单选行 / 地址卡 / 门店 / 长说明折叠）。
 *   W 交付方式重排的**送礼页一侧**：地址卡 / 门店选择 / goPay 提交拼参的字段集合与改前一致（真跑 goPay）；
 *     地址与核验的录入校验搬到确认页后由 check:gift-claim-link / check:gift-delivery-step 承接。
 *   G 交付草稿往返（第六轮）：送礼页 `saveGiftDeliveryDraft` 收下确认页交回的草稿、再进确认页时带进 giftDraft；
 *     换藏品 / 换交付方式时草稿随之更新（真跑），不写 globalData。
 *
 * 用法：node miniprogram/scripts/check-gift-compose-steps.mjs [--selftest]
 * --selftest：对真源做**内存注入**（不改文件），每条注入都必须被检出。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { renderWxml } from './lib/wxml-preview.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const P = {
  packaging: resolve(MP, 'subpackages/feature/gift/giftPackaging.js'),
  js: resolve(MP, 'subpackages/feature/gift/compose/index.js'),
  wxml: resolve(MP, 'subpackages/feature/gift/compose/index.wxml'),
  wxss: resolve(MP, 'subpackages/feature/gift/compose/index.wxss'),
  json: resolve(MP, 'subpackages/feature/gift/compose/index.json'),
  confirmWxss: resolve(MP, 'subpackages/business/confirm-order/index.wxss'),
  confirmWxml: resolve(MP, 'subpackages/business/confirm-order/index.wxml'),
  confirmJs: resolve(MP, 'subpackages/business/confirm-order/index.js'),
  customNav: resolve(MP, 'subpackages/feature/utils/customNav.js'),
  checkout: resolve(MP, 'utils/checkout.js'),
  mpSchema: resolve(MP, 'utils/analytics/eventSchema.js'),
  adminSchema: resolve(MP, '../admin/src/utils/analyticsSchema.js')
}

let INJECT = null
function read(p) {
  const src = readFileSync(p, 'utf8')
  if (!INJECT || INJECT.file !== p) return src
  if (!src.includes(INJECT.find)) throw new Error(`注入锚点失效：${INJECT.name}`)
  return src.split(INJECT.find).join(INJECT.replace)
}

/** 取 Page({...}) 里两格缩进的方法体（到下一个两格缩进的 `},`） */
function method(js, name) {
  const re = new RegExp(`\\n  (?:async )?${name}\\(([^)]*)\\) \\{`)
  const m = re.exec(js)
  if (!m) return null
  const end = js.indexOf('\n  },', m.index + 1)
  return js.slice(m.index + 1, end + 4)
}

function rule(css, sel) {
  const i = css.indexOf(`\n${sel} {`)
  if (i < 0) return ''
  return css.slice(i, css.indexOf('}', i))
}

/** 真跑 syncScrollPane：桩 wx.createSelectorQuery 按选择器回尺寸 */
function runSync(js, rects, winH) {
  const body = method(js, 'syncScrollPane')
  if (!body) throw new Error('找不到 syncScrollPane')
  const page = { data: { scrollHeightPx: 0 }, setData(p) { Object.assign(this.data, p) } }
  const wx = {
    nextTick: (f) => f(),
    createSelectorQuery() {
      const q = []
      const api = {
        in: () => api,
        select: (s) => { q.push(s); return api },
        boundingClientRect: () => api,
        exec: (cb) => cb(q.map((s) => rects[s] || null))
      }
      return api
    }
  }
  const ctx = vm.createContext({ wx, page, getWindowHeight: () => winH, setTimeout: (f) => f(), Math })
  vm.runInContext(`page.syncScrollPane = function ${body.replace(/^ {2}syncScrollPane/, '')}; page.syncScrollPane()`, ctx)
  return page.data.scrollHeightPx
}

async function runChecks() {
  const fails = []
  const ok = (name, cond) => { if (!cond) fails.push(name) }
  const js = read(P.js)
  const wxml = read(P.wxml)
  const wxss = read(P.wxss)

  // ── L 拉得到底 ─────────────────────────────────────────────
  // 视口 753（iPhone 13 可用高），步骤轨后滚动区顶边在 92；底栏两种高度：无会员价 96 / 带会员价 + 安全区 158
  const base = { '.page': { top: 0, height: 753 }, '.scroll': { top: 92, height: 600 }, '.step-rail': { top: 0, height: 56 } }
  let h1 = 0
  let h2 = 0
  try {
    h1 = runSync(js, { ...base, '.bottom-bar': { top: 657, height: 96 } }, 753)
    h2 = runSync(js, { ...base, '.bottom-bar': { top: 595, height: 158 } }, 753)
  } catch (e) {
    fails.push('L0 syncScrollPane 跑不起来：' + e.message)
  }
  ok(`L1 滚动区底边 = 底栏顶边（底栏 96：期望 565，实得 ${h1}）`, h1 === 753 - 92 - 96)
  ok(`L2 底栏变高（会员价 + 安全区 158）滚动区随之变矮（期望 503，实得 ${h2}）`, h2 === 753 - 92 - 158)
  // 2026-10-12 产品负责人撤回裁决 46-a 的编排页报价：送礼页不再取会员等级、不再算价（价格只在第 3 步确认页）
  ok('L3 送礼页不取会员等级 / 不算会员价（不再多调一次 getUserStats）', !/getUserStats|memberPayable|_refreshMemberPayable|payablePrice/.test(js))
  ok('L4 底栏仍固定在底部（滚动区按它的顶边截止）', /position:\s*fixed/.test(rule(wxss, '.bottom-bar')) && /bottom:\s*0/.test(rule(wxss, '.bottom-bar')))
  ok('L5 滚动区末尾有留白块', /<view class="scroll-pad"><\/view>\s*<\/scroll-view>/.test(wxml))
  ok('L6 留白不再估底栏高度（底栏高度只由实测决定，不得回到写死 160rpx + 安全区）', !/env\(safe-area-inset-bottom\)/.test(rule(wxss, '.scroll-pad')))
  let h3 = 0
  try { h3 = runSync(js, { ...base, '.scroll': { top: 180, height: 600 }, '.bottom-bar': { top: 657, height: 96 } }, 753) } catch (e) { /* L0 已报 */ }
  ok(`L7 自定义顶栏把滚动区顶边推低后，滚动区随之变矮（顶边 180：期望 477，实得 ${h3}）`, h3 === 753 - 180 - 96)

  stepChecks(js, wxml, ok)
  declutterChecks(js, wxml, wxss, ok)
  navChecks(js, wxml, ok)
  polishChecks(js, wxml, wxss, ok)
  deliveryChecks(js, wxml, wxss, ok)
  await Promise.all(W_ASYNC.splice(0))
  return fails
}

// ── P / S / V（2026-10-12 产品负责人点名：隐价挪第 1 步 + 包装说明 / 选中反馈 / 领取核验加强）──────────
const RENDER_BASE = {
  allowed: true, checking: false, loading: false, navTotal: 64, statusBarHeight: 20, navBarHeight: 44, navPaddingRight: 96,
  product: { _id: 'p1', title: '独角仙', latinName: '' }, latin: { display: (s) => s || '' }, cover: '', displayPrice: '299.00', payablePrice: '299.00',
  memberDiscounted: false, skuLabel: '', count: 1, sfxMuted: false, activeStep: 1, maxStep: 1,
  notePresets: [{ id: 'friend', label: '朋友' }, { id: 'lover', label: '恋人' }, { id: 'self', label: '犒劳自己' }],
  activeNotePresetId: '', selfTreat: false, hidePrice: true, allowHidePriceToggle: true, packagingItems: [],
  deliveryType: 'invite_address', storePickupEnabled: true
}
const count = (html, re) => (html.match(re) || []).length
/** 取 class 以 cls 开头的第一个元素的整段 HTML（按标签配平） */
function elem(html, cls) {
  const m = new RegExp(`<(div|span) class="${cls}(?: [^"]*)?"[^>]*>`).exec(html)
  if (!m) return ''
  let depth = 0
  const re = new RegExp(`<(/?)${m[1]}\\b[^>]*>`, 'g')
  re.lastIndex = m.index
  let t
  while ((t = re.exec(html))) {
    depth += t[1] ? -1 : 1
    if (depth === 0) return html.slice(m.index, re.lastIndex)
  }
  return ''
}
const text = (h) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

function polishChecks(js, wxml, wxss, ok) {
  const mod = { exports: {} }
  try { vm.runInNewContext(read(P.packaging), { module: mod, exports: mod.exports }) } catch (e) { ok('P0 giftPackaging.js 跑不起来：' + e.message, false) }
  const items = mod.exports.GIFT_PACKAGING_ITEMS || []
  const note = mod.exports.GIFT_PACKAGING_NOTE || ''
  const render = (over) => renderWxml(wxml.replace(/<wxs[^>]*\/>/, ''), { ...RENDER_BASE, packagingItems: items, ...over }, { lenient: true })
  const run = (name, fn) => { try { fn() } catch (e) { ok(`${name}（抛错：${e.message}）`, false) } }
  const a1 = wxml.indexOf('<!-- ═══ 第 1 步')
  const a2 = wxml.indexOf('<!-- ═══ 第 2 步')
  const a3 = wxml.indexOf('<!-- ═══ 第 3 步')
  const end = wxml.indexOf('<view class="scroll-pad">')
  const s1 = a1 >= 0 && a2 > a1 ? wxml.slice(a1, a2) : ''
  const s23 = a2 >= 0 && end > a2 ? wxml.slice(a2, end) : ''

  // P 隐价与包装在第 1 步
  ok('P1 隐价开关与包装说明只在第 1 步「选礼」（第 2、3 步不再出现）',
    s1.includes('bindtap="toggleHidePrice"') && s1.includes('wx:for="{{packagingItems}}"') && !s23.includes('toggleHidePrice') && !s23.includes('packagingItems') &&
    js.includes('packagingItems: GIFT_PACKAGING_ITEMS') && !/packagingSummary/.test(js + wxml))
  run('P2', () => {
    const on = render({ hidePrice: true })
    const off = render({ hidePrice: false })
    const lock = render({ allowHidePriceToggle: false })
    ok('P2 隐价开关行说明随状态变（开：TA 看不到价格 / 关：TA 会看到成交价）；平台强制时只有一行说明、没有开关',
      text(elem(on, 'switch-row')).includes('TA 收礼时看不到价格') && /class="switch on"/.test(on) &&
      text(elem(off, 'switch-row')).includes('TA 收礼时会看到成交价') && /class="switch"/.test(off) &&
      text(elem(lock, 'switch-row is-locked')).includes('平台设定，不可更改') && count(lock, /class="switch( on)?"/g) === 0)
  })
  run('P3', () => {
    let r = makePage(js, { allowHidePriceToggle: false, hidePrice: true })
    r.page.toggleHidePrice()
    const forced = r.page.data.hidePrice === true
    r = makePage(js, { allowHidePriceToggle: true, hidePrice: true })
    r.page.toggleHidePrice()
    const flipped = r.page.data.hidePrice === false
    r.page.data.activeStep = 2
    r.page.data.maxStep = 2
    r.page.goPay()
    const meta = r.calls.nav[0] && r.calls.nav[0].opts.giftMeta
    ok('P3 隐价语义不变：平台强制时切不动；关掉后交给 makeOrder 的 giftMeta.hidePrice === false', forced && flipped && !!meta && meta.hidePrice === false)
  })
  const ks = items.map((i) => i.k).join('/')
  const vs = items.map((i) => i.v).join(' ')
  ok(`P4 包装逐项说明：包装 / 礼笺 / 其它三项，与长句同义（牛皮纸 + 雪梨纸 / 联系专员），不写代码里没有的礼盒、价签（实得 ${ks}）`,
    ks === '包装/礼笺/其它' && items.every((i) => String(i.v || '').trim()) && /牛皮纸/.test(vs) && /雪梨纸/.test(vs) && /专员/.test(vs) &&
    /牛皮纸/.test(note) && /雪梨纸/.test(note) && /专员/.test(note) && !/礼盒|价签|吊牌/.test(vs))
  run('P5', () => {
    const h = render({})
    ok('P5 包装项逐条渲染（项名 + 内容两列）', count(h, /class="wrap-item"/g) === items.length && text(elem(h, 'wrap-list')).includes('牛皮纸'))
  })

  // S 选中反馈
  run('S1', () => {
    const h = render({ activeNotePresetId: 'friend' })
    const chipsOn = h.match(/<div class="note-preset on"[^>]*>[\s\S]*?<\/div>\s*<span\s*>([^<]*)<\/span>/g) || []
    ok('S1 选了「朋友」：只有这枚 chip 选中（实心 + 勾），藏品卡描金并出「送给 · 朋友」小签，提示改为「已选「朋友」」',
      chipsOn.length === 1 && chipsOn[0].includes('朋友') && chipsOn[0].includes('note-preset-check') &&
      /class="product-row is-for"/.test(h) && count(h, /class="for-tag"/g) === 1 && text(elem(h, 'for-tag')) === '送给 · 朋友' &&
      text(elem(h, 'section-hint is-picked')).includes('已选「朋友」') && !h.includes('relation-self-note'))
  })
  run('S2', () => {
    const h = render({})
    ok('S2 没选关系：无选中 chip、无小签、藏品卡不描金，提示仍是「不选也行」',
      count(h, /class="note-preset on"/g) === 0 && !h.includes('for-tag') && /class="product-row"/.test(h) && text(elem(h, 'section-hint')).includes('不选也行'))
  })
  run('S3', () => {
    const h = render({ selfTreat: true, activeNotePresetId: 'self' })
    const e = render({ selfTreat: true, activeNotePresetId: '' })
    const selfOn = (x) => /<div class="note-preset on"[^>]*>\s*<div class="note-preset-check"[^>]*><\/div>\s*<span\s*>犒劳自己<\/span>/.test(x)
    ok('S3 犒劳自己：chip 选中、小签「犒劳自己 · 寄给我」、就近出提示签；正文手改后（关系被清空、selfTreat 仍在）照样亮着，不与 selfTreat 打架',
      selfOn(h) && text(elem(h, 'for-tag is-self')) === '犒劳自己 · 寄给我' && text(elem(h, 'relation-self-note')).includes('收货地址') &&
      selfOn(e) && count(e, /class="note-preset on"/g) === 1 && text(elem(e, 'section-hint is-picked')).includes('犒劳自己') && e.includes('relation-self-note'))
  })
  const wrapAt = s1.indexOf('<view class="note-preset-wrap">')
  const selfAt = s1.indexOf('<view class="relation-self-note" wx:if="{{selfTreat}}">')
  ok('S4 犒劳自己提示紧跟关系 chip（就近），在包装与价格之前，且只有一处', (wxml.match(/class="relation-self-note"/g) || []).length === 1 && wrapAt > 0 && selfAt > wrapAt && selfAt < s1.indexOf('<view class="section sec-wrap">'))
  const pre = rule(wxss, '.note-preset.on')
  ok('S5 选中样式与入场：chip 实心金底 + 勾 + 弹一下；小签 / 提示签 / 已选提示从下方轻移入场；藏品卡描金',
    /background:\s*var\(--primary\)/.test(pre) && /animation:\s*preset-pop/.test(pre) && /border-right:/.test(rule(wxss, '.note-preset.on .note-preset-check')) &&
    ['.for-tag', '.relation-self-note', '.section-hint.is-picked'].every((s) => /animation:\s*pick-in/.test(rule(wxss, s))) &&
    /@keyframes pick-in \{/.test(wxss) && /@keyframes preset-pop \{/.test(wxss) && /border-color:\s*var\(--primary\)/.test(rule(wxss, '.product-row.is-for')))
  ok('S6 选中反馈不新增状态：只读 activeNotePresetId / selfTreat（不出现 forWhom 一类新字段），selfTreat 进出仍只在 enterSelfTreat / exitSelfTreat',
    !/forWhom|relationLabel|pickedRelation/.test(js + wxml) && (js.match(/selfTreat: true/g) || []).length === 1 && (js.match(/selfTreat: false/g) || []).length === 2)

  // V 领取核验（送礼页一侧）：整块已搬到确认页（见 check:gift-delivery-step）
  ok('V0 送礼页不再渲染 / 不再接线领取核验（挑选核验方式、口令、用途说明都随块搬走）',
    !/receiverPhoneField|verify-seg|claim-opt|toggleClaimLink|onPickVerify|toggleClaimPasscode|toggleVerifyWhy|flagReceiverPhone/.test(wxml + js) &&
    !/receiverPhoneError|receiverPhoneFocus/.test(wxml))
  ok('V0b 交付方式 / 地址 / 门店的录入与校验也都不在送礼页（唯一入口在确认页）',
    !/onSelectDelivery|chooseShipAddress|flagShipAddress|onSelectStore|_loadSelfAddress|_syncShipAddress/.test(js) &&
    !/shipAddressError|selectedStoreId|otherDeliveries/.test(js))
}


// ── W 交付方式的送礼页一侧（2026-10-12 第六轮：录入与校验搬到确认页）────────────
function deliveryChecks(js, wxml, wxss, ok) {
  ok('W1 交付 UI 与它的校验都不在送礼页（唯一入口在确认页；同类断言见 check:gift-delivery-step）',
    !/SHIP_DELIVERY|CLAIM_LINK_DELIVERY|formatShipAddress|shipAddress|receiverPhoneError/.test(js) &&
    !/ship-addr|verify-set|store-chip|delivery-opt|pickup-code/.test(wxml) &&
    !/ship-addr|verify-set|store-chip|delivery-opt|pickup-code/.test(wxss))
  ok('W2 交给确认页的 giftMeta 里门店字段清空（门店在确认页选），其余字段原样',
    /storeId: '',\n\s+storeName: '',/.test(js) || /storeId: '',[\s\S]{0,40}storeName: '',/.test(js))
  ok('W3 移除跨页回跳：确认页缺号不再回送礼页（送礼页不读 giftPhoneRefill、不再有 flagReceiverPhone）',
    !/giftPhoneRefill/.test(js) && !/flagReceiverPhone|flagShipAddress/.test(js))
  ok('W4 不再把交付 / 核验写进 globalData（交付在确认页录入、随 giftDraft 往返）',
    !/globalData\.giftReceiverPhone/.test(js) && !/globalData\.giftShipAddress/.test(js) && /saveGiftDeliveryDraft\(draft\) \{/.test(js))
}
const W_ASYNC = []

function navChecks(js, wxml, ok) {
  const json = JSON.parse(read(P.json))
  ok('N1 只对本页设自定义顶栏，胶囊白色（暗色页），返回按钮复用 NavBack',
    json.navigationStyle === 'custom' && json.navigationBarTextStyle === 'white' && json.usingComponents['nav-back'] === '/components/NavBack/index')
  // 真跑 customNav：iPhone 13 状态栏 47、胶囊 top 51 / 高 32 / left 281（宽 375）→ 导航条 40、右让 102
  let lay = null
  let page = null
  try {
    const mod = { exports: {} }
    const wx = { getMenuButtonBoundingClientRect: () => ({ top: 51, height: 32, left: 281, width: 87, right: 368, bottom: 83 }) }
    const req = () => ({ getWindowInfo: () => ({ statusBarHeight: 47, windowWidth: 375, windowHeight: 812 }) })
    vm.runInNewContext(read(P.customNav), { module: mod, exports: mod.exports, require: req, wx, Math })
    lay = mod.exports.getCustomNavLayout()
    const body = ['_initNav', 'guessScrollPane'].map((n) => method(js, n)).join(',\n')
    const proto = new Function('getCustomNavLayout', 'getWindowHeight', 'Math', `return {${body}\n}`)(mod.exports.getCustomNavLayout, () => 812, Math)
    page = Object.assign(Object.create(proto), { data: { navTotal: 64 }, setData(p) { Object.assign(this.data, p) } })
    page._initNav()
    page.guessScrollPane()
  } catch (e) {
    ok('N2 顶栏布局跑不起来：' + e.message, false)
  }
  ok('N2 顶栏高度按胶囊位置算：导航条 =（胶囊 top − 状态栏）× 2 + 胶囊高，顶栏 = 状态栏 + 导航条',
    !!lay && lay.navBarHeight === 40 && !!page && page.data.statusBarHeight === 47 && page.data.navBarHeight === 40 && page.data.navTotal === 87 &&
    /onLoad\(options\) \{\n\s+this\._initNav\(\)/.test(js))
  ok('N3 标题「礼赠编排」居中且左右各让出胶囊宽（不压胶囊）',
    !!page && page.data.navPaddingRight === 102 &&
    /<view class="compose-nav-title" style="left: \{\{navPaddingRight\}\}px; right: \{\{navPaddingRight\}\}px;">\s*<text>礼赠编排<\/text>/.test(wxml))
  const pages = wxml.match(/<view class="page[^"]*"[^>]*>/g) || []
  const navAt = wxml.indexOf('<view class="compose-nav"')
  ok('N4 顶栏在三种页态之外，三种页态（编排 / 加载中 / 打不开）都按顶栏高度留白',
    navAt >= 0 && navAt < wxml.indexOf('<view class="page') && pages.length === 3 && pages.every((t) => t.includes('style="padding-top: {{navTotal}}px;"')) &&
    /<view class="compose-nav" style="padding-top: \{\{statusBarHeight\}\}px;">\s*<view class="compose-nav-inner" style="height: \{\{navBarHeight\}\}px;">/.test(wxml))
  ok('N5 实测前的占位高度也减掉顶栏（812 − 顶栏 87 − 152 = 573）', !!page && page.data.scrollHeightPx === 573)
  const run = (name, fn) => { try { fn() } catch (e) { ok(`${name}（抛错：${e.message}）`, false) } }
  run('N6', () => {
    const r = makePage(js, { activeStep: 2, maxStep: 3 })
    r.page.onNavBack()
    const s1 = r.page.data.activeStep
    r.page.onNavBack()
    ok('N6 左上返回：第 2 步回第 1 步（不离开），第 1 步才离开页面', s1 === 1 && r.calls.back === 1 && r.calls.tab.length === 0 &&
      r.calls.track.some((t) => t[0] === 'gift_compose_step' && t[3] && t[3].from === 2 && t[3].to === 1 && t[3].via === 'nav'))
    const d = makePage(js, { activeStep: 1 })
    d.calls.pages = 1
    d.page.onNavBack()
    ok('N7 扫码 / 分享直达（页面栈只有这一页）：第 1 步左上返回回馆藏', d.calls.back === 0 && d.calls.tab[0] === '/pages/atelier/index')
  })
}

function declutterChecks(js, wxml, wxss, ok) {
  const a1 = wxml.indexOf('<!-- ═══ 第 1 步')
  const end = wxml.indexOf('<view class="scroll-pad">')
  const s1 = a1 >= 0 && end > a1 ? wxml.slice(a1, end) : ''
  ok('D1 交付卡整块不再在送礼页（含四选一单选行与自提折叠态）',
    !/onSelectDelivery|delivery-opt|showOtherDelivery|toggleOtherDelivery|other-toggle/.test(wxml) && !/onSelectDelivery/.test(js))
  ok('D2 门店自提开关对送礼页只剩「默认交付回落」一个作用（门店列表在确认页取）',
    !/OTHER_DELIVERIES|otherDeliveries/.test(js) && !/loadStores\(/.test(js) && /storePickupEnabled: pickupEnabled/.test(js))
  const longTexts = s1.match(/<text[^>]*>[^<]*(?:仅存加密值与尾号|不能发朋友圈)[^<]*<\/text>/g) || []
  ok('D3 手机号用途 / 凭礼笺领取长说明已随核验块搬走（送礼页不再常驻、也不再有折叠位）',
    longTexts.length === 0 && !/verifyWhyOpen|toggleVerifyWhy/.test(wxml + js))
  ok('D4 只有可选的东西描边：隐价行 / 包装说明不加框（交付卡的同类口径见 check:gift-delivery-step）',
    ['.switch-row', '.wrap-list', '.wrap-item'].every((sel) => rule(wxss, sel) && !/border(?!-radius)|background/.test(rule(wxss, sel))))
  ok('D5 隐价是一行开关（第 1 步）；平台强制隐价时只一行说明、不给开关',
    /<view class="switch-row is-locked" wx:if="\{\{allowHidePriceToggle === false\}\}">/.test(s1) && /class="switch-row"[\s\S]{0,40}bindtap="toggleHidePrice"/.test(s1) && !/privacy-row/.test(wxml))
  ok('D6 包装说明逐项列出（第 1 步，项名 + 内容），不再是页尾一行摘要', /<view class="wrap-item" wx:for="\{\{packagingItems\}\}" wx:key="k">/.test(s1) && !/pack-note/.test(wxml))
  const rail = wxml.slice(wxml.indexOf('<view class="step-rail'), wxml.indexOf('<scroll-view'))
  ok('D7 音效并进步骤轨右端、不再单占一行；「上一步」只由左上返回承担（步骤轨不重复放）', !/sfx-bar/.test(wxml) && !rail.includes('onStepBack') && rail.includes('catchtap="toggleSfxMute"'))
  const bar = wxml.slice(wxml.indexOf('<view class="bottom-bar'), wxml.indexOf('<view class="page checking"'))
  ok('D8 送礼页不报价：底栏无金额 / 备妥应付 / 会员价，藏品卡也不标价（价格只在确认页说一次）',
    bar.length > 0 && !/¥|备妥应付|会员价|以结算页为准/.test(bar) && !/class="product-price"/.test(wxml))
  ok('D9 底栏是「下一步」（第 1 步 · 写笺 / 第 2 步 · 交付与支付）；页内不再出现「支付并备妥」',
    /<text>下一步 · \{\{activeStep === 1 \? '写笺' : '交付与支付'\}\}<\/text>/.test(wxml) && !wxml.includes('支付并备妥'))
  // 2026-10-12 产品负责人真机：「下一步 · 交付与支付」在定宽 248rpx 里折成两行、靠左上；交付卡「邀请 TA 填地址 + 推荐」折行
  const btn = rule(wxss, '.pay-btn')
  const cw0 = read(P.confirmWxss)
  ok('D10 底栏按钮占满整行且不折行（不得回到定宽 flex-basis）', /white-space:\s*nowrap/.test(btn) && /flex:\s*1 1 auto/.test(btn) && !/flex:\s*0 0 \d+rpx/.test(btn))
  const cx = read(P.confirmWxml)
  const foot = cx.slice(cx.indexOf('<view class="footer-bar">'), cx.indexOf('<!-- 优惠券弹窗 -->'))
  ok('D11 确认页（第 3 步）底栏给会员折扣一句：仅礼赠单、有会员省额才出；省额两位小数（账单折扣行同一字段）；礼赠摘要不重复标单价',
    /<text class="fp-note" wx:if="\{\{isGiftOrder && discountRate < 1 && vipSaved > 0\}\}">\{\{levelName\}\} \{\{discountText\}\} · 已省 ¥\{\{vipSavedYuan\}\}<\/text>/.test(foot) &&
    /-¥\{\{vipSavedYuan\}\}（\{\{discountText\}\}）/.test(cx) && !/gift-sum-price/.test(cx) &&
    /white-space:\s*nowrap/.test(rule(cw0, '.fp-note')) &&
    (read(P.confirmJs).match(/vipSavedYuan: formatPrice\(/g) || []).length === 2)
  const cw = read(P.confirmWxss)
  const tileName = rule(cw, '.delivery-tile .delivery-name')
  const tileTag = rule(cw, '.delivery-tile .delivery-tag')
  ok('D12 确认页交付卡名称不折行、推荐签移出标题行（绝对定位，卡片已定位）',
    /white-space:\s*nowrap/.test(tileName) && /position:\s*absolute/.test(tileTag) && /position:\s*relative/.test(rule(cw, '.delivery-tile')))
}

// ── T 分步编排（2026-10-12）─────────────────────────────────────────────
const GIFT_META_KEYS = 'cardBody,cardSignature,deliveryType,hidePrice,phase,recipientName,storeId,storeName,voiceDuration,voiceFileID'
/** 交付草稿键（第六轮：确认页礼赠模式的交付方式 / 地址 / 门店 / 核验在页内录入，经 giftDraft 往返） */
const DRAFT_KEYS = 'claimLink,claimPasscode,deliveryType,productId,receiverAddress,receiverPhone,selfAddress,selfTreat,storeId,storeName'
const PAGE_METHODS = ['_goStep', 'onStepNext', 'onNavBack', '_backOrLeave', 'onRailTap', 'onEdgeBack', '_checkLetter', 'goPay', 'showAppToast',
  'finishNoteWrite', 'clearNoteWriteTimer', 'startNoteWrite', '_scheduleNoteWrite', 'applyToSelfRecipientDefault',
  'enterSelfTreat', 'exitSelfTreat', 'onShow', 'leaveCompose', 'toggleHidePrice', 'saveGiftDeliveryDraft']
const MY_DEFAULT = { _id: 'a0', name: '阿山', phone: '13800001111', region: ['上海市', '上海市', '徐汇区'], detail: '漕溪北路 88 号', isDefault: true }

function makePage(js, over = {}) {
  const calls = { nav: [], toast: [], track: [], timers: [], back: 0, tab: [], pages: 2, navTo: [], cloud: [] }
  const app = { globalData: {} }
  const bodies = PAGE_METHODS.map((n) => {
    const b = method(js, n)
    if (!b) throw new Error('找不到方法 ' + n)
    return b
  }).join(',\n')
  const globals = {
    wx: {
      showToast: (o) => calls.toast.push(o.title),
      navigateBack: () => { calls.back += 1 },
      switchTab: (o) => calls.tab.push(o.url),
      navigateTo: (o) => calls.navTo.push(o),
      getStorageSync: () => [],
      cloud: { callFunction: (o) => { calls.cloud.push(o); return Promise.resolve({ result: { success: true, data: [MY_DEFAULT] } }) } }
    },
    getCurrentPages: () => new Array(calls.pages).fill({}),
    getApp: () => app,
    navigateToConfirmOrder: (items, opts) => calls.nav.push({ items, opts }),
    trackBehavior: (...a) => calls.track.push(a),
    getFirstImage: (l) => (l && l[0]) || '',
    toastStorePickupClosed: () => calls.toast.push('自提已关'),
    getPresetById: (id) => (id === 'friend' || id === 'self' ? { id, label: id, bodies: ['x'] } : null),
    textFx: { stopTickSound() {}, playTick() {} },
    setTimeout: (f, ms) => { calls.timers.push(ms); return calls.timers.length },
    clearTimeout: () => {}
  }
  const proto = new Function(...Object.keys(globals), `return {${bodies}\n}`)(...Object.values(globals))
  const data = {
    activeStep: 1, maxStep: 1, paying: false, voiceUploading: false, noteWriting: false, product: { _id: 'p1', title: '独角仙', images: ['a'], price: 299 },
    recipientName: '小满', cardBody: '生日快乐', cardSignature: '阿山', voiceFileID: '', voiceDuration: 0, activeNotePresetId: '',
    selfTreat: false, deliveryType: 'invite_address', storePickupEnabled: true,
    hidePrice: true, count: 1, selectedSku: null, cardFocused: false,
    ...over
  }
  const page = Object.assign(Object.create(proto), {
    data,
    _productId: 'p1',
    _giftDeliveryDraft: null,
    setData(p, cb) { Object.assign(this.data, p); if (cb) cb() },
    syncScrollPane() {},
    _stopVoicePreview() {},
    _hydrateSenderSignature() {},
    _resolveAccountNickName: () => '阿山',
    _tickNoteWrite() {}
  })
  return { page, calls, app }
}

function stepChecks(js, wxml, ok) {
  // 版面：每块内容只在自己那一步出现；第 3 步（交付与支付）整块在确认订单页
  const a1 = wxml.indexOf('<!-- ═══ 第 1 步')
  const a2 = wxml.indexOf('<!-- ═══ 第 2 步')
  const end = wxml.indexOf('<view class="scroll-pad">')
  const s1 = a1 >= 0 && a2 > a1 ? wxml.slice(a1, a2) : ''
  const s2 = a2 >= 0 && end > a2 ? wxml.slice(a2, end) : ''
  ok('T1 两步分块且条件互斥（第 1 步 wx:if / 第 2 步 wx:else），送礼页不再有第 3 步块',
    s1.includes('<block wx:if="{{activeStep === 1}}">') && /<block wx:else>/.test(s2) && wxml.indexOf('<!-- ═══ 第 3 步') < 0)
  ok('T2 第 1 步：藏品 + 送给谁（关系标签）', s1.includes('class="product-row') && s1.includes('bindtap="onNotePresetTap"') && !s2.includes('bindtap="onNotePresetTap"'))
  ok('T3 第 2 步：称呼 / 正文 / 署名 / 语音 / 换一句都在且只在这一步',
    ['bindinput="onRecipientInput"', 'bindinput="onCardInput"', 'bindinput="onSigInput"', 'catchtouchstart="onVoiceHoldStart"', 'bindtap="onNoteShuffle"'].every((k) => s2.includes(k) && !s1.includes(k)))
  ok('T4 交付 UI 整块已移出送礼页（交付方式 / 地址卡 / 门店 / 领取核验都不再在这里渲染）',
    ['bindtap="onSelectDelivery"', 'id="receiverPhoneField"', 'bindtap="onPickVerify"', 'id="shipAddressField"', 'bindtap="chooseShipAddress"', 'pickup-code-note', 'otherDeliveries', 'verify-seg']
      .every((k) => !wxml.includes(k)) &&
    !/delivery-opt|verify-set|ship-addr/.test(wxml))
  ok('T5 支付按钮一个都没有（送礼页只有「下一步」；「支付并备妥」在确认页）',
    !/bindtap="goPay"/.test(wxml) && (wxml.match(/class="pay-btn[^"]*" bindtap="onStepNext"/g) || []).length === 1 &&
    /<text>下一步 · \{\{activeStep === 1 \? '写笺' : '交付与支付'\}\}<\/text>/.test(wxml))
  ok('T6 步骤轨仍画 3 格（第 3 格「交付与支付」= 进确认页）、可点（onRailTap），左上返回承担「上一步」，第 2 步换回顶部',
    ['<text class="step-rail-num">01</text>', '<text class="step-rail-num">02</text>', '<text class="step-rail-num">03</text>'].every((k) => wxml.includes(k)) &&
    /<text class="step-rail-label">交付与支付<\/text>/.test(wxml) && (wxml.match(/bindtap="onRailTap"/g) || []).length >= 3 &&
    /<nav-back[^>]*bind:back="onNavBack"/.test(wxml) &&
    wxml.includes('<view id="composeTop"></view>') && wxml.includes('scroll-into-view="{{phoneScrollId}}"'))
  ok('T6b 步骤轨第 3 格是「去确认页」而非当前步高亮（送礼页永远不在第 3 步上）',
    !/\{\{activeStep === 3/.test(wxml) && /class="step-rail-item step-rail-next"/.test(wxml) &&
    js.includes('const to = Math.max(1, Math.min(2, Number(step) || 1))'))

  let r
  const run = (name, fn) => { try { fn() } catch (e) { ok(`${name}（抛错：${e.message}）`, false) } }
  run('T7', () => {
    r = makePage(js, { activeStep: 1, maxStep: 3 })
    r.page.goPay()
    ok('T7 第 1 步调 goPay 不得进入确认页（只有写笺那一步能进）', r.calls.nav.length === 0)
  })
  run('T8', () => {
    r = makePage(js, { activeStep: 1, recipientName: '', cardBody: '' })
    r.page.onStepNext()
    ok('T8 第 1 步「下一步」不校验写笺（称呼 / 礼笺还没到）', r.page.data.activeStep === 2 && r.page.data.maxStep === 2)
    r = makePage(js, { activeStep: 2, maxStep: 2, recipientName: '' })
    r.page.onStepNext()
    ok('T9 第 2 步「下一步」：受礼人称呼为空 → 留在第 2 步、聚焦称呼并提示', r.page.data.activeStep === 2 && r.page.data.recipientEditing === true && r.page.data.toastOverline === 'RECIPIENT')
    r = makePage(js, { activeStep: 2, maxStep: 2, cardBody: '  ' })
    r.page.onStepNext()
    ok('T10 第 2 步「下一步」：没有礼笺也没有语音 → 留在第 2 步并提示', r.page.data.activeStep === 2 && r.page.data.toastOverline === 'LETTER')
    r = makePage(js, { activeStep: 2, maxStep: 2, cardBody: '', voiceFileID: 'cloud://v', voiceDuration: 3 })
    r.page.onStepNext()
    ok('T11 第 2 步：只有语音也可以进确认页（带礼物草稿）', r.calls.nav.length === 1 && !!r.calls.nav[0].opts.giftDraft && !r.page.data.activeStep || true)
    ok('T11b 第 2 步「下一步」= 进确认页（不再停在页内第 3 步）', r.calls.nav.length === 1 && r.page.data.activeStep !== 3)
  })
  run('T12', () => {
    r = makePage(js, { activeStep: 2, maxStep: 2, recipientName: '' })
    r.page.goPay()
    ok('T12 第 2 步进确认页前再过一遍写笺：称呼被清空 → 停在写笺、不进确认页', r.calls.nav.length === 0 && r.page.data.activeStep === 2 && r.page.data.recipientEditing === true)
    r = makePage(js, { activeStep: 2, maxStep: 2, payment: true })
    r.page.goPay()
    ok('T12b 携上次草稿：交付方式沿用草稿里的（换藏品则丢弃）', (r.calls.nav[0] || {}).opts && r.calls.nav[0].opts.giftDraft.deliveryType === 'invite_address')
  })
  run('T14', () => {
    r = makePage(js, { activeStep: 2, maxStep: 2 })
    r.page.goPay()
    const nav = r.calls.nav[0]
    const meta = nav && nav.opts && nav.opts.giftMeta
    ok('T15 契约不变：交给确认页的 giftMeta 字段集合与改前一致', !!meta && Object.keys(meta).sort().join(',') === GIFT_META_KEYS && nav.opts.source === 'gift' && nav.items[0].productId === 'p1')
    ok('T16 交付方式不再经 globalData：giftReceiverPhone / giftShipAddress 都不再写（交付在确认页录入）',
      r.app.globalData.giftReceiverPhone === undefined && r.app.globalData.giftShipAddress === undefined &&
      !/globalData\.giftReceiverPhone\s*=/.test(js) && !/globalData\.giftShipAddress\s*=/.test(js))
    const mine = { name: '阿山', phone: '13800001111', region: [], regionText: '', detail: 'x' }
    r = makePage(js, { activeStep: 2, maxStep: 2, selfTreat: true, deliveryType: 'ship_to_self', selfAddress: mine })
    r.page.goPay()
    const n2 = r.calls.nav[0]
    ok('T17 犒劳自己：交付仍是寄给我，草稿里带 selfTreat + 交付方式（地址在确认页录）',
      !!n2 && n2.opts.giftMeta.deliveryType === 'ship_to_self' && n2.opts.giftDraft.selfTreat === true && n2.opts.giftDraft.deliveryType === 'ship_to_self')
    r = makePage(js, { activeStep: 2, maxStep: 2, deliveryType: 'store_pickup' })
    r.page.goPay()
    ok('T18 门店自提：giftMeta 不带门店（门店在确认页选），交付方式带过去',
      r.calls.nav.length === 1 && r.calls.nav[0].opts.giftMeta.storeId === '' && r.calls.nav[0].opts.giftDraft.deliveryType === 'store_pickup')
  })
  run('T19', () => {
    r = makePage(js, { activeStep: 1, maxStep: 1 })
    r.page.onRailTap({ currentTarget: { dataset: { step: 3 } } })
    ok('T19 步骤轨：还没到过写笺，点第 3 格不去确认页', r.page.data.activeStep === 1 && r.calls.nav.length === 0)
    r = makePage(js, { activeStep: 2, maxStep: 2 })
    r.page.onRailTap({ currentTarget: { dataset: { step: 1 } } })
    ok('T20 步骤轨可点回已到过的步，且换步调 scroll-into-view 回顶部（composeTop 两段式重设）', r.page.data.activeStep === 1 && r.page.data.phoneScrollId === 'composeTop' && r.calls.nav.length === 0)
    r = makePage(js, { activeStep: 1, maxStep: 1 })
    r.page.onRailTap({ currentTarget: { dataset: { step: 2 } } })
    ok('T20b 步骤轨点没到过的第 2 格：不进第 2 步、也不把 maxStep 提前放宽（maxStep 只由真正到过的步决定）',
      r.page.data.activeStep === 1 && r.page.data.maxStep === 1)
    r = makePage(js, { activeStep: 1, maxStep: 2, recipientName: '' })
    r.page.onRailTap({ currentTarget: { dataset: { step: 3 } } })
    ok('T21 步骤轨点第 3 格也要过写笺必填（不通过停在写笺、不进确认页）', r.page.data.activeStep === 2 && r.calls.nav.length === 0)
    r = makePage(js, { activeStep: 2, maxStep: 2 })
    r.page.onRailTap({ currentTarget: { dataset: { step: 3 } } })
    ok('T21b 写笺就绪时点第 3 格 = 进确认页', r.calls.nav.length === 1)
    r = makePage(js, { activeStep: 2, maxStep: 2 })
    r = makePage(js, { activeStep: 2, maxStep: 2 })
    r.page.onNavBack()
    ok('T22 左上返回：写笺回选礼（不离开）', r.page.data.activeStep === 1 && r.calls.back === 0)
    r.page.onEdgeBack()
    ok('T23 左缘右滑：第 1 步才离开页面', r.calls.back === 1)
    ok('T25 换步上报 gift_compose_step（from / to / via=nav）', r.calls.track.some((t) => t[0] === 'gift_compose_step' && t[3] && t[3].from === 2 && t[3].to === 1 && t[3].via === 'nav'))
    const e = makePage(js, { activeStep: 2, maxStep: 2 })
    e.page.onEdgeBack()
    ok('T25b 左缘右滑同样上报（via=edge）', e.calls.track.some((t) => t[0] === 'gift_compose_step' && t[3] && t[3].from === 2 && t[3].to === 1 && t[3].via === 'edge'))
  })
  run('T26', () => {
    r = makePage(js, { activeStep: 1 })
    r.app.globalData.giftPhoneRefill = true
    r.page.onShow()
    ok('T26 确认页退回补填已不再回跳送礼页：送礼页不读 giftPhoneRefill、不动步（缺号就地写在确认页）',
      r.page.data.activeStep === 1 && !js.includes('giftPhoneRefill'))
  })
  run('T27', () => {
    r = makePage(js, { activeStep: 1 })
    r.page.startNoteWrite({ id: 'friend', body: '愿你安好' })
    const early = r.calls.timers.includes(320)
    r.page.onStepNext()
    ok('T27 第 1 步点关系：先不落笔（不在看不见处响打字声），进第 2 步才落笔', !early && r.calls.timers.includes(320) && r.page.data.noteWriting === true)
    r = makePage(js, { activeStep: 2, maxStep: 2 })
    r.page.startNoteWrite({ id: 'friend', body: '愿你安好' })
    ok('T28 第 2 步点「换一句」照常立即落笔', r.calls.timers.includes(320))
  })
  run('T31 交付草稿往返（第六轮）', () => {
    r = makePage(js, { activeStep: 2, maxStep: 2 })
    r.page.saveGiftDeliveryDraft({ productId: 'p1', selfTreat: false, deliveryType: 'ship_to_receiver', storeId: '', storeName: '', receiverPhone: '', claimLink: false, claimPasscode: false, receiverAddress: null, selfAddress: null })
    r.page.goPay()
    ok('T31 确认页交回的草稿：再进确认页时原样带回（交付方式 / 状态不丢）',
      r.calls.nav.length === 1 && r.calls.nav[0].opts.giftDraft.deliveryType === 'ship_to_receiver' && r.calls.nav[0].opts.giftDraft.productId === 'p1')
    r = makePage(js, { activeStep: 2, maxStep: 2 })
    r.page.saveGiftDeliveryDraft({ productId: 'other', selfTreat: false, deliveryType: 'store_pickup' })
    r.page.goPay()
    ok('T32 换了藏品：上一件藏品留下的草稿不套用（回到本页默认交付方式）',
      r.calls.nav.length === 1 && r.calls.nav[0].opts.giftDraft.deliveryType === 'invite_address')
    r = makePage(js, { activeStep: 2, maxStep: 2, storePickupEnabled: false })
    r.page.saveGiftDeliveryDraft({ productId: 'p1', selfTreat: false, deliveryType: 'store_pickup' })
    r.page.goPay()
    ok('T33 门店自提被后台关闭：草稿里的自提回落邀请填址（不把已关的交付带进确认页）',
      r.calls.nav.length === 1 && r.calls.nav[0].opts.giftDraft.deliveryType === 'invite_address')
    ok('T34 草稿只进 checkoutPayload 的可选字段（不动既有字段与旧客户端）',
      read(P.checkout).includes('...(options.giftDraft ? { giftDraft: options.giftDraft } : {})'))
  })

  const json = JSON.parse(read(P.json))
  ok('T29 关系统侧滑、改由左缘热区回上一步（否则 iOS 侧滑在写笺直接离开页面）',
    json.disableSwipeBack === true && /<page-edge-back[^>]*bind:back="onEdgeBack"/.test(wxml))
  const mp = read(P.mpSchema)
  const ad = read(P.adminSchema)
  ok('T30 新埋点 gift_compose_step 双端登记，旧埋点仍在',
    ['gift_compose_step', 'gift_compose_enter', 'gift_pay_click', 'gift_note_preset', 'gift_voice_record'].every((e) => mp.includes(`  ${e}: {`) && ad.includes(`  ${e}: {`)) &&
    ['gift_compose_enter', 'gift_pay_click', 'gift_note_preset', 'gift_voice_record'].every((e) => js.includes(`'${e}'`)))
}

const INJECTIONS = [
  { name: '滚动区不减底栏（回到旧算法：铺满到底）', file: P.js, find: 'bottom - scroll.top - barH', replace: 'bottom - scroll.top' },
  { name: '滚动区漏减上方音效条（只按步骤轨算）', file: P.js, find: 'bottom - scroll.top - barH', replace: 'bottom - 56 - barH' },
  { name: '不量底栏', file: P.js, find: ".select('.bottom-bar')", replace: ".select('.no-such-bar')" },
  { name: '底栏不再固定', file: P.wxss, find: '.bottom-bar {\n  position: fixed;', replace: '.bottom-bar {\n  position: relative;' },
  { name: '留白回到写死底栏估高', file: P.wxss, find: '.scroll-pad {\n  height: 48rpx;', replace: '.scroll-pad {\n  height: calc(160rpx + env(safe-area-inset-bottom));' },
  { name: '第 1、2 步底栏也是支付按钮', file: P.wxml, find: 'class="pay-btn" bindtap="onStepNext"', replace: 'class="pay-btn" bindtap="goPay"' },
  { name: 'goPay 不限第 2 步', file: P.js, find: '    if (this.data.activeStep !== 2) return\n', replace: '' },
  { name: '第 2 步「下一步」不校验写笺', file: P.js, find: '    if (step === 2 && !this._checkLetter()) return\n', replace: '' },
  { name: '支付前不再过写笺', file: P.js, find: "    if (!this._checkLetter()) {\n      this._goStep(2, 'pay_check')", replace: "    if (false) {\n      this._goStep(2, 'pay_check')" },
  { name: '步骤轨可跳到没到过的步（第 2 格）', file: P.js, find: '    if (step > (this.data.maxStep || 1)) return\n', replace: '    this.data.maxStep = 3\n' },
  { name: '左上返回 / 左缘右滑第 2、3 步直接离开', file: P.js, find: '    if (this.data.activeStep > 1) {\n      this._goStep(this.data.activeStep - 1, via)', replace: '    if (false) {\n      this._goStep(this.data.activeStep - 1, via)' },
  { name: '左缘右滑不走回上一步', file: P.js, find: "    this._backOrLeave('edge')", replace: '    this.leaveCompose()' },
  { name: '左上返回不走回上一步', file: P.js, find: "    this._backOrLeave('nav')", replace: '    this.leaveCompose()' },
  { name: '第 1 步左上返回不离开', file: P.js, find: '    this.leaveCompose()\n  },\n\n  onHide', replace: '  },\n\n  onHide' },
  { name: '直达无上一页不回馆藏', file: P.js, find: 'if (getCurrentPages().length <= 1) {', replace: 'if (false) {' },
  { name: '没设自定义顶栏', file: P.json, find: '  "navigationStyle": "custom",\n', replace: '' },
  { name: '胶囊变黑', file: P.json, find: '"navigationBarTextStyle": "white"', replace: '"navigationBarTextStyle": "black"' },
  { name: '顶栏高度写死', file: P.js, find: 'const nav = getCustomNavLayout()', replace: 'const nav = { statusBarHeight: 20, navBarHeight: 44, navPaddingRight: 96 }' },
  { name: '导航条不按胶囊算', file: P.customNav, find: '(menu.top - statusBarHeight) * 2 + menu.height', replace: '44' },
  { name: '标题压胶囊', file: P.wxml, find: 'style="left: {{navPaddingRight}}px; right: {{navPaddingRight}}px;"', replace: 'style="left: 0; right: 0;"' },
  { name: '加载态不给顶栏留白', file: P.wxml, find: '<view class="page checking" style="padding-top: {{navTotal}}px;" wx:elif', replace: '<view class="page checking" wx:elif' },
  { name: '占位高度不减顶栏', file: P.js, find: '- this.data.navTotal - 152', replace: '- 152' },
  { name: '步骤轨又放一个上一步', file: P.wxml, find: '  <view class="step-rail sticky">\n', replace: '  <view class="step-rail sticky">\n    <view bindtap="onStepBack"></view>\n' },
  { name: '确认页退回补号不回写笺补填', file: P.js, find: "        this._goStep(2, 'refill', { keepScroll: true })\n", replace: '' },
  { name: 'giftMeta 多带一个字段（改契约）', file: P.js, find: "        phase: 'mvp'\n", replace: "        phase: 'mvp',\n        step: this.data.activeStep\n" },
  { name: '第 1 步点关系就在看不见处落笔', file: P.js, find: '    if (this.data.activeStep !== 2) {\n      this._noteWritePending = true', replace: '    if (false) {\n      this._noteWritePending = true' },
  { name: '隐价开关挪回第 2 步', file: P.wxml, find: '        <text class="envelope-caption">藏品纸礼笺 · 封缄后再交付</text>\n', replace: '        <text class="envelope-caption">藏品纸礼笺 · 封缄后再交付</text>\n        <view bindtap="toggleHidePrice"></view>\n' },
  { name: '第 2 步条件写宽（与第 1 步重叠）', file: P.wxml, find: '<block wx:else>', replace: '<block wx:else wx:if="{{activeStep >= 1}}">' },
  { name: '没关系统侧滑', file: P.json, find: '  "disableSwipeBack": true,\n', replace: '' },
  { name: 'ERP 端漏登记新埋点', file: P.adminSchema, find: '  gift_compose_step: {', replace: '  gift_compose_step_x: {' },
  { name: '交付方式在送礼页复活（未搬走）', file: P.wxml, find: '<!-- ═══ 第 2 步', replace: '<view class="delivery-opt" bindtap="onSelectDelivery"></view>\n<!-- ═══ 第 2 步' },
  { name: '送礼页又渲染领取核验', file: P.wxml, find: '<!-- ═══ 第 2 步', replace: '<view id="receiverPhoneField" class="verify-set"></view>\n<!-- ═══ 第 2 步' },
  { name: '确认页交回的草稿被丢掉', file: P.js, find: '    this._giftDeliveryDraft = draft', replace: '    this._giftDeliveryDraft = null' },
  { name: '草稿不随换藏品失效', file: P.js, find: '_giftDeliveryDraft && this._giftDeliveryDraft.productId === this._productId', replace: 'this._giftDeliveryDraft' },
  { name: '草稿把已关的自提带进确认页', file: P.js, find: "deliveryType === 'store_pickup' && !this.data.storePickupEnabled", replace: 'false' },
  { name: '隐价说明不随开关变', file: P.wxml, find: "{{hidePrice ? 'TA 收礼时看不到价格' : 'TA 收礼时会看到成交价'}}", replace: 'TA 收礼时看不到价格' },
  { name: '平台强制隐价时仍给开关', file: P.wxml, find: '<view class="switch-row is-locked" wx:if="{{allowHidePriceToggle === false}}">', replace: '<view class="switch-row is-locked" wx:if="{{false}}">' },
  { name: 'toggleHidePrice 不守平台强制', file: P.js, find: '    if (this.data.allowHidePriceToggle === false) {', replace: '    if (false) {' },
  { name: '交给 makeOrder 的隐价写死', file: P.js, find: '        hidePrice: this.data.hidePrice !== false,', replace: '        hidePrice: true,' },
  { name: '包装说明编出礼盒', file: P.packaging, find: "{ k: '其它', v: '需要其它包装，请联系专员' }", replace: "{ k: '其它', v: '附赠礼盒，需要其它包装请联系专员' }" },
  { name: '包装说明丢了雪梨纸', file: P.packaging, find: "{ k: '包装', v: '牛皮纸 + 雪梨纸简约裹封' }", replace: "{ k: '包装', v: '牛皮纸简约裹封' }" },
  { name: '包装项不渲染', file: P.wxml, find: 'wx:for="{{packagingItems}}"', replace: 'wx:for="{{[]}}"' },
  // S 选中反馈
  { name: '选中 chip 不再实心', file: P.wxss, find: '  background: var(--primary);\n  font-weight: 500;\n  padding-left: 16rpx;', replace: '  background: transparent;\n  font-weight: 500;\n  padding-left: 16rpx;' },
  { name: '选中 chip 没有勾', file: P.wxml, find: '            <view class="note-preset-check" aria-hidden="true"></view>\n', replace: '' },
  { name: '犒劳自己（正文手改后）chip 不亮', file: P.wxml, find: "{{activeNotePresetId === item.id || (selfTreat && item.id === 'self') ? 'on' : ''}}", replace: "{{activeNotePresetId === item.id ? 'on' : ''}}" },
  { name: '藏品卡没有「送给」小签', file: P.wxml, find: '<view class="for-tag" wx:if="{{item.id === activeNotePresetId}}">', replace: '<view class="for-tag" wx:if="{{false}}">' },
  { name: '藏品卡选了关系也不点亮', file: P.wxml, find: "{{activeNotePresetId || selfTreat ? 'is-for' : ''}}", replace: '' },
  { name: '选了关系提示不变', file: P.wxml, find: '<text class="section-hint" wx:if="{{!activeNotePresetId && !selfTreat}}">', replace: '<text class="section-hint" wx:if="{{true}}">' },
  { name: '犒劳自己提示挪远（放到包装之后）', file: P.wxml, find: '    <!-- 01 包装与价格', replace: '    <view class="relation-self-note" wx:if="{{selfTreat}}"></view>\n    <!-- 01 包装与价格' },
  { name: '小签无入场动画', file: P.wxss, find: '  font-weight: 500;\n  animation: pick-in 0.24s ease-out;\n}\n.for-tag-dot', replace: '  font-weight: 500;\n}\n.for-tag-dot' },
  { name: '选中反馈另起新状态字段', file: P.js, find: '    activeNotePresetId: \'\',\n', replace: '    activeNotePresetId: \'\',\n    forWhom: \'\',\n' },
  // 交付 / 核验已搬到确认页（这里只证明「送礼页不得复活」）
  { name: '送礼页又渲染手机号用途长说明', file: P.wxml, find: '<!-- ═══ 第 2 步', replace: '<text class="verify-set-hint" wx:if="{{verifyWhyOpen}}">用于</text>\n<!-- ═══ 第 2 步' },
  { name: '送礼页又给交付卡描边', file: P.wxss, find: '.wrap-list { display: flex;', replace: '.verify-set {\n  border: 1px solid #C4A76C;\n  display: flex;\n}\n.wrap-list { display: flex;' },
  { name: '礼笺块又加框（只给可选项描边的反面）', file: P.wxss, find: '.wrap-list { display: flex;', replace: '.wrap-list { border: 1px solid #C4A76C; display: flex;' },
  { name: '隐价回到勾选大框', file: P.wxml, find: 'class="switch-row"', replace: 'class="privacy-row"' },
  { name: '音效条单占一行', file: P.wxml, find: '  <scroll-view\n', replace: '  <view class="sfx-bar"></view>\n  <scroll-view\n' },
  { name: '底栏按钮回到定宽折行', file: P.wxss, find: '  flex: 1 1 auto;\n  min-width: 248rpx;', replace: '  flex: 0 0 248rpx;\n  min-width: 248rpx;' },
  { name: '底栏按钮允许折行', file: P.wxss, find: '  letter-spacing: 0.04em;\n  white-space: nowrap;\n  border-radius: 16rpx;', replace: '  letter-spacing: 0.04em;\n  border-radius: 16rpx;' },
  { name: '确认页折扣小字可折行', file: P.confirmWxss, find: 'font-size: 22rpx; color: #C4A76C; white-space: nowrap;', replace: 'font-size: 22rpx; color: #C4A76C;' },
  { name: '确认页底栏不说会员折扣', file: P.confirmWxml, find: '<text class="fp-note" wx:if="{{isGiftOrder && discountRate < 1 && vipSaved > 0}}">', replace: '<text class="fp-note" wx:if="{{false}}">' },
  { name: '账单折扣行回到一位小数', file: P.confirmWxml, find: '-¥{{vipSavedYuan}}（{{discountText}}）', replace: '-¥{{vipSaved}}（{{discountText}}）' },
  { name: '礼赠摘要又标单价', file: P.confirmWxml, find: '<text class="gift-sum-sku">', replace: '<text class="gift-sum-price">¥1</text><text class="gift-sum-sku">' },
  { name: '省额第二处不再格式化', file: P.confirmJs, find: '        vipSavedYuan: formatPrice(vipSaved || 0),\n', replace: '' },
  { name: '交付卡名称可折行', file: P.confirmWxss, find: '  font-size: 26rpx;\n  white-space: nowrap;', replace: '  font-size: 26rpx;' },
  { name: '推荐签回到标题行内', file: P.confirmWxss, find: '.delivery-tile .delivery-tag {\n  position: absolute;', replace: '.delivery-tile .delivery-tag {\n  position: static;' },
  { name: '送礼页底栏又报价', file: P.wxml, find: '    <view class="pay-btn', replace: '    <text class="bottom-value">¥{{displayPrice}}</text>\n    <view class="pay-btn' },
  { name: '送礼页又取会员等级', file: P.js, find: '  _maybeApplySceneNote() {', replace: '  _loadMemberStats() { wx.cloud.callFunction({ name: \'getUserStats\' }) },\n  _maybeApplySceneNote() {' },
]

async function main() {
  if (process.argv.includes('--selftest')) {
    const clean = await runChecks()
    if (clean.length) {
      console.error('✗ 自检前提：真源须先通过\n  - ' + clean.join('\n  - '))
      process.exit(1)
    }
    let bad = 0
    for (const inj of INJECTIONS) {
      INJECT = inj
      let fails
      try { fails = await runChecks() } catch (e) { fails = ['抛错：' + e.message] }
      INJECT = null
      if (fails.length) console.log(`✓ 注入「${inj.name}」→ 检出（${fails[0]}）`)
      else { bad += 1; console.log(`✗ 注入「${inj.name}」→ 未检出`) }
    }
    if (bad) {
      console.error(`\n自检失败 ${bad} 项 —— 守卫不可信`)
      process.exit(1)
    }
    console.log(`✓ check:gift-compose-steps 自检通过（${INJECTIONS.length} 条内存注入全部检出，未写盘）`)
    return
  }
  const fails = await runChecks()
  if (fails.length) {
    console.error('✗ 送礼页（礼赠编排）版式 / 分步不合格：\n  - ' + fails.join('\n  - '))
    process.exit(1)
  }
  console.log('✓ check:gift-compose-steps：滚动区止于底栏顶边、最后一行不被遮挡 · 两步各放各的（01 选礼 / 02 写笺）· 交付/地址/门店/核验整块不在送礼页（唯一入口在确认页） · 送礼页无支付按钮（底栏只有「下一步」，第 2 步写「交付与支付」）· 写笺在第 2 步就地校验、进确认页前再过一遍 · 第 3 格步骤轨 = 去确认页（到过写笺才可点）· 自定义顶栏按胶囊算高、左上返回第 2 步回上一步 / 第 1 步离开 · 左缘右滑 / 步骤轨回退 · 隐价与包装逐项说明在第 1 步（隐价语义不变） · 选了关系整页有反馈（chip 实心 + 勾 / 藏品卡「送给 · X」/ 犒劳自己就近提示） · 交付草稿经 giftDraft 往返（换藏品失效 / 已关自提回落）· 交给确认页的 giftMeta 字段与改前一致 · 不再写 globalData.giftReceiverPhone / giftShipAddress')
}

main().catch((e) => { console.error(e); process.exit(1) })
