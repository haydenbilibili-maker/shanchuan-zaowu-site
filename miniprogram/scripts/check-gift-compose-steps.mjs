#!/usr/bin/env node
/**
 * check:gift-compose-steps —— 送礼页「礼赠编排」的版式与分步守卫（2026-10-12 产品负责人点名）
 *
 *   L 拉得到底：滚动区高度 = 自身顶边 → 底栏顶边（真跑 syncScrollPane，桩 wx 给尺寸）。
 *     起因：旧算法只减步骤轨、漏减音效条，底部留白又写死 160rpx，而底栏带会员价小字 + 安全区后更高
 *     → 最后一行「WRAP · 包装」压在底栏下（「犒劳自己」最明显）。底栏高度一变（会员价晚到）须重量。
 *   T 分步编排（产品负责人：「将礼赠编排从一步变成 2-3 步，避免在一个环节上堆叠过多信息」）：
 *     版面 —— 01 选礼（藏品 + 送给谁）/ 02 写笺（称呼 / 正文 / 署名 / 语音 / 换一句）/ 03 交付（交付方式 / 手机号 / 隐价 / 包装）各在各步；
 *     第 1、2 步没有支付按钮、goPay 在第 3 步以外不放行；写笺必填在第 2 步「下一步」就地校验、支付前再过一遍（不通过退回第 2 步）；
 *     手机号 / 自提门店在第 3 步支付时校验，确认页退回补号回到第 3 步定位字段；步骤轨只能点回到过的步；
 *     「上一步」与左缘右滑在第 2、3 步回上一步、第 1 步才离开；第 1 步点关系不在看不见处落笔；
 *     **契约零变化**：交给确认页的 giftMeta 与 globalData.giftReceiverPhone 字段集合逐一比对（真跑 goPay，桩掉跳转）；
 *     新埋点 gift_compose_step 双端登记、旧埋点不动。
 *   D 去密集（产品负责人真机看第 3 步：「太密集，信息过载」）：四种交付平铺成单选行、不再折叠（自提关闭时不出现）；
 *     长说明收进「为什么要填？/ 领取规则」点开；只有可选的东西描边（领取核验 / 隐价 / 包装不加框）；
 *     隐价是一行开关、平台强制时一行灰字；包装一行摘要；音效在步骤轨右端；底栏「备妥应付」与价格同一行。
 *   N 自定义顶栏（产品负责人拍板：左上返回在第 2、3 步回上一步，第 1 步才离开，不弹确认）：index.json 设 custom、胶囊白色；
 *     顶栏高度按胶囊位置算（真跑 customNav + _initNav）；标题左右各让出胶囊宽；三种页态都给顶栏留白；
 *     左上返回与左缘右滑同一口径（真跑 onNavBack），直达无上一页时回馆藏；占位高度也减顶栏。安卓实体返回键拦不住（不测）。
 *   P 隐价与包装挪到第 1 步（产品负责人改口：隐价从第 3 步移到「选礼」）：开关只在第 1 步、说明随开关状态变、平台强制时无开关；
 *     toggleHidePrice 仍守平台强制、goPay 交给 makeOrder 的 hidePrice 语义不变（真跑）；包装逐项说明只写代码里确有的事实（真读 giftPackaging.js）。
 *   S 第 1 步「送给谁」选中反馈：被选 chip 实心 + 勾、藏品卡描金并出「送给 · X」小签、提示改为「已选「X」」、
 *     犒劳自己提示就近入场；全部由 activeNotePresetId / selfTreat 派生（真渲染 index.wxml，不新增状态，不碰 selfTreat 进出逻辑）。
 *   V 第 3 步「领取核验」：标题右侧标当前方式、两张单选卡（直寄 TA 无）、一句话结论、规则折叠、报错就地；
 *     单选卡有按压反馈、点已选不动、点另一张走原 toggleClaimLink（真跑）。
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
  customNav: resolve(MP, 'subpackages/feature/utils/customNav.js'),
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

function runChecks() {
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
  ok('L3 会员价落定后重量滚动区（底栏高度会变）', /memberLevelName: r\.levelName\s*\}, \(\) => this\.syncScrollPane\(\)\)/.test(js))
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
  return fails
}

// ── P / S / V（2026-10-12 产品负责人点名：隐价挪第 1 步 + 包装说明 / 选中反馈 / 领取核验加强）──────────
const RENDER_BASE = {
  allowed: true, checking: false, loading: false, navTotal: 64, statusBarHeight: 20, navBarHeight: 44, navPaddingRight: 96,
  product: { _id: 'p1', title: '独角仙', latinName: '' }, latin: { display: (s) => s || '' }, cover: '', displayPrice: '299.00', payablePrice: '299.00',
  memberDiscounted: false, skuLabel: '', count: 1, sfxMuted: false, activeStep: 1, maxStep: 1,
  notePresets: [{ id: 'friend', label: '朋友' }, { id: 'lover', label: '恋人' }, { id: 'self', label: '犒劳自己' }],
  activeNotePresetId: '', selfTreat: false, hidePrice: true, allowHidePriceToggle: true, packagingItems: [],
  deliveryType: 'invite_address', otherDeliveries: [], storePickupEnabled: true, stores: [], selectedStoreId: '',
  claimLink: false, claimPasscode: false, receiverPhone: '', receiverPhoneError: '', receiverPhoneFocus: false, verifyWhyOpen: false
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
    r.page.data.activeStep = 3
    r.page.data.maxStep = 3
    r.page.goPay()
    const meta = r.calls.nav[0] && r.calls.nav[0].opts.giftMeta
    ok('P3 隐价语义不变：平台强制时切不动；第 1 步关掉后交给 makeOrder 的 giftMeta.hidePrice === false', forced && flipped && !!meta && meta.hidePrice === false)
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

  // V 领取核验
  run('V1', () => {
    const h = render({ activeStep: 3, maxStep: 3 })
    const segs = elem(h, 'verify-seg-row')
    ok('V1 手机号核验：标题右侧标「手机号核验」、两张单选卡且只有「手机号核验」选中、先给一句结论、规则默认收起',
      text(elem(h, 'verify-mode')) === '手机号核验' && count(segs, /class="verify-seg[ "]/g) === 2 &&
      /class="verify-seg on"[^>]*aria-checked="true"[\s\S]*?手机号核验/.test(segs) && /class="verify-seg"[^>]*aria-checked="false"[\s\S]*?凭礼笺领取/.test(segs) &&
      text(elem(h, 'verify-set-brief')).includes('别人拿到链接也领不走') && !h.includes('verify-set-hint') && text(elem(h, 'why-toggle')) === '为什么要填？')
  })
  run('V2', () => {
    const h = render({ activeStep: 3, maxStep: 3, claimLink: true })
    const p = render({ activeStep: 3, maxStep: 3, claimLink: true, claimPasscode: true })
    ok('V2 凭礼笺领取：标「凭礼笺领取」且该卡选中、无手机号输入；加口令后标「凭礼笺 + 口令」、口令行点亮',
      text(elem(h, 'verify-mode')) === '凭礼笺领取' && /class="verify-seg on"[^>]*>[\s\S]*?凭礼笺领取/.test(elem(h, 'verify-seg-row')) && !h.includes('verify-set-input') &&
      text(elem(p, 'verify-mode')) === '凭礼笺 + 口令' && /class="claim-opt on"/.test(p))
  })
  run('V3', () => {
    const h = render({ activeStep: 3, maxStep: 3, deliveryType: 'ship_to_receiver', claimLink: true })
    ok('V3 直寄 TA：没有单选卡（只能手机号核验）、标「手机号核验」、手机号「* 必填」', !h.includes('verify-seg-row') && text(elem(h, 'verify-mode')) === '手机号核验' && h.includes('* 必填') && h.includes('verify-set-input'))
  })
  run('V4', () => {
    const h = render({ activeStep: 3, maxStep: 3, receiverPhoneError: '请填写受礼人手机号' })
    const field = elem(h, 'verify-set is-error')
    ok('V4 报错就地：错误写在核验块里输入框之下，「手机号核验」卡与输入框同时描红',
      text(elem(field, 'verify-set-err')).includes('请填写受礼人手机号') && field.indexOf('verify-set-err') > field.indexOf('verify-set-input') &&
      /class="verify-seg on is-error"/.test(field) && /\.verify-set\.is-error \.verify-set-input \{[^}]*#E8927C/.test(wxss) && /border-color:\s*#E8927C/.test(rule(wxss, '.verify-seg.on.is-error')))
  })
  run('V5', () => {
    const h = render({ activeStep: 3, maxStep: 3, verifyWhyOpen: true })
    ok('V5 规则可折叠：点开后出完整说明、箭头翻转', text(elem(h, 'verify-set-hint')).includes('仅存加密值与尾号') && /class="why-toggle open"/.test(h) && /transform:\s*rotate\(-135deg\)/.test(rule(wxss, '.why-toggle.open::after')))
  })
  const segTags = wxml.match(/<view\s+class="verify-seg [^"]*"[\s\S]*?>/g) || []
  const optTag = (wxml.match(/<view\s+class="claim-opt [^"]*"[\s\S]*?>/) || [''])[0]
  ok('V6 单选卡与口令行都有按压反馈（hover-class 已定义）、无障碍角色齐全',
    segTags.length === 2 && segTags.every((t) => t.includes('hover-class="verify-seg-press"') && t.includes('aria-role="radio"') && t.includes('bindtap="onPickVerify"')) &&
    optTag.includes('hover-class="verify-seg-press"') && optTag.includes('aria-role="checkbox"') && rule(wxss, '.verify-seg-press').includes('background'))
  run('V7', () => {
    let r = makePage(js, { claimLink: false, receiverPhoneError: '错' })
    r.page.onPickVerify({ currentTarget: { dataset: { mode: 'phone' } } })
    const stay = r.page.data.claimLink === false && r.page.data.receiverPhoneError === '错'
    r.page.onPickVerify({ currentTarget: { dataset: { mode: 'link' } } })
    const sw = r.page.data.claimLink === true && r.page.data.receiverPhoneError === ''
    r.page.onPickVerify({ currentTarget: { dataset: { mode: 'link' } } })
    ok('V7 单选卡：点已选的不动；点另一张 = 原 toggleClaimLink（切换并清掉报错）；再点同一张不来回翻', stay && sw && r.page.data.claimLink === true &&
      /onPickVerify\(e\) \{[\s\S]*?this\.toggleClaimLink\(\)\n {2}\},/.test(js))
  })
  ok('V8 只有可选的东西描边：单选卡 / 口令行有框、选中卡金边金底；核验块本身与标题行不加框',
    /border:/.test(rule(wxss, '.verify-seg')) && /border-color:\s*var\(--primary\)/.test(rule(wxss, '.verify-seg.on')) && /background:/.test(rule(wxss, '.verify-seg.on')) &&
    /border:/.test(rule(wxss, '.claim-opt')) && ['.verify-set', '.verify-head'].every((s) => rule(wxss, s) && !/border(?!-radius)|background/.test(rule(wxss, s))))
}

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
  const a3 = wxml.indexOf('<!-- ═══ 第 3 步')
  const end = wxml.indexOf('<view class="scroll-pad">')
  const s3 = a3 >= 0 && end > a3 ? wxml.slice(a3, end) : ''
  const self = (s3.match(/<block wx:if="\{\{selfTreat\}\}">[\s\S]*?<\/block>/) || [''])[0]
  ok('D1 四种交付平铺成单选行，不再「展开 / 收起」',
    !/showOtherDelivery|toggleOtherDelivery|other-toggle/.test(s3 + js) &&
    (s3.match(/bindtap="onSelectDelivery"/g) || []).length === 2 &&
    /class="delivery-opt [^"]*"\s+data-type="invite_address"/.test(s3) && /class="delivery-opt [^"]*"\s+wx:for="\{\{otherDeliveries\}\}"/.test(s3))
  ok('D2 门店自提关闭时不出现在交付选项里', js.includes("OTHER_DELIVERIES.filter((d) => d.id !== 'store_pickup')") && /otherDeliveries\s*\n\s*\}/.test(js))
  const longTexts = s3.match(/<text[^>]*>[^<]*(?:仅存加密值与尾号|不能发朋友圈)[^<]*<\/text>/g) || []
  ok('D3 长说明收进可点开的小字（手机号用途 / 凭礼笺领取规则默认不展开）',
    longTexts.length >= 3 && longTexts.every((t) => /wx:(?:el)?if="\{\{verifyWhyOpen/.test(t)) && /bindtap="toggleVerifyWhy"/.test(s3) && js.includes('toggleVerifyWhy() {'))
  const unframed = ['.verify-set', '.verify-head', '.switch-row', '.wrap-list', '.wrap-item']
  ok('D4 只有可选的东西描边：领取核验块 / 隐价行 / 包装说明不加框，交付选项有框',
    unframed.every((sel) => rule(wxss, sel) && !/border(?!-radius)|background/.test(rule(wxss, sel))) && /border:/.test(rule(wxss, '.delivery-opt')))
  const a1 = wxml.indexOf('<!-- ═══ 第 1 步')
  const s1 = a1 >= 0 && a3 > a1 ? wxml.slice(a1, a3) : ''
  ok('D5 隐价是一行开关（第 1 步）；平台强制隐价时只一行说明、不给开关',
    /<view class="switch-row is-locked" wx:if="\{\{allowHidePriceToggle === false\}\}">/.test(s1) && /class="switch-row"[\s\S]{0,40}bindtap="toggleHidePrice"/.test(s1) && !/privacy-row/.test(wxml))
  ok('D6 包装说明逐项列出（第 1 步，项名 + 内容），不再是页尾一行摘要', /<view class="wrap-item" wx:for="\{\{packagingItems\}\}" wx:key="k">/.test(s1) && !/pack-note/.test(wxml))
  const rail = wxml.slice(wxml.indexOf('<view class="step-rail'), wxml.indexOf('<scroll-view'))
  ok('D7 音效并进步骤轨右端、不再单占一行；「上一步」只由左上返回承担（步骤轨不重复放）', !/sfx-bar/.test(wxml) && !rail.includes('onStepBack') && rail.includes('catchtap="toggleSfxMute"'))
  ok('D8 底栏「备妥应付」与价格同一行（小字只剩会员价一行）', /<view class="bottom-value-row">\s*<text class="bottom-label">备妥应付<\/text>/.test(wxml))
  ok('D9 犒劳自己第 3 步：只一行已选的「寄到我的收货地址」+ 改回送礼入口', /class="delivery-opt active"/.test(self) && self.includes('bindtap="exitSelfTreat"') && !self.includes('receiverPhoneField'))
}

// ── T 分步编排（2026-10-12）─────────────────────────────────────────────
const GIFT_META_KEYS = 'cardBody,cardSignature,deliveryType,hidePrice,phase,recipientName,storeId,storeName,voiceDuration,voiceFileID'
const PHONE_KEYS = 'at,claimLink,claimPasscode,phone,productId,selfTreat'
const PAGE_METHODS = ['_goStep', 'onStepNext', 'onNavBack', '_backOrLeave', 'onRailTap', 'onEdgeBack', '_checkLetter', 'goPay', 'showAppToast',
  'flagReceiverPhone', 'finishNoteWrite', 'clearNoteWriteTimer', 'startNoteWrite', '_scheduleNoteWrite', 'applyToSelfRecipientDefault',
  'enterSelfTreat', 'exitSelfTreat', 'onShow', 'leaveCompose', 'toggleHidePrice', 'toggleClaimLink', 'onPickVerify']

function makePage(js, over = {}) {
  const calls = { nav: [], toast: [], track: [], timers: [], back: 0, tab: [], pages: 2 }
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
      switchTab: (o) => calls.tab.push(o.url)
    },
    getCurrentPages: () => new Array(calls.pages).fill({}),
    getApp: () => app,
    navigateToConfirmOrder: (items, opts) => calls.nav.push({ items, opts }),
    trackBehavior: (...a) => calls.track.push(a),
    getFirstImage: (l) => (l && l[0]) || '',
    toastStorePickupClosed: () => calls.toast.push('自提已关'),
    getPresetById: (id) => (id === 'friend' || id === 'self' ? { id, label: id, bodies: ['x'] } : null),
    textFx: { stopTickSound() {}, playTick() {} },
    CLAIM_LINK_DELIVERY: ['invite_address', 'store_pickup', 'ship_to_self'],
    setTimeout: (f, ms) => { calls.timers.push(ms); return calls.timers.length },
    clearTimeout: () => {}
  }
  const proto = new Function(...Object.keys(globals), `return {${bodies}\n}`)(...Object.values(globals))
  const data = {
    activeStep: 1, maxStep: 1, paying: false, voiceUploading: false, noteWriting: false, product: { _id: 'p1', title: '独角仙', images: ['a'], price: 299 },
    recipientName: '小满', cardBody: '生日快乐', cardSignature: '阿山', voiceFileID: '', voiceDuration: 0, activeNotePresetId: '',
    selfTreat: false, deliveryType: 'invite_address', storePickupEnabled: true, selectedStoreId: '', selectedStoreName: '',
    claimLink: false, claimPasscode: false, receiverPhone: '13800001111', hidePrice: true, count: 1, selectedSku: null, cardFocused: false,
    ...over
  }
  const page = Object.assign(Object.create(proto), {
    data,
    _productId: 'p1',
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
  // 版面：每块内容只在自己那一步出现
  const a1 = wxml.indexOf('<!-- ═══ 第 1 步')
  const a2 = wxml.indexOf('<!-- ═══ 第 2 步')
  const a3 = wxml.indexOf('<!-- ═══ 第 3 步')
  const end = wxml.indexOf('<view class="scroll-pad">')
  const s1 = a1 >= 0 && a2 > a1 ? wxml.slice(a1, a2) : ''
  const s2 = a2 >= 0 && a3 > a2 ? wxml.slice(a2, a3) : ''
  const s3 = a3 >= 0 && end > a3 ? wxml.slice(a3, end) : ''
  ok('T1 三步分块且条件互斥（第 1 步 wx:if / 第 2 步 wx:elif / 第 3 步 wx:else）',
    s1.includes('<block wx:if="{{activeStep === 1}}">') && s2.includes('<block wx:elif="{{activeStep === 2}}">') && /<block wx:else>/.test(s3))
  ok('T2 第 1 步：藏品 + 送给谁（关系标签）', s1.includes('class="product-row') && s1.includes('bindtap="onNotePresetTap"') && !s2.includes('bindtap="onNotePresetTap"') && !s3.includes('bindtap="onNotePresetTap"'))
  ok('T3 第 2 步：称呼 / 正文 / 署名 / 语音 / 换一句都在且只在这一步',
    ['bindinput="onRecipientInput"', 'bindinput="onCardInput"', 'bindinput="onSigInput"', 'catchtouchstart="onVoiceHoldStart"', 'bindtap="onNoteShuffle"'].every((k) => s2.includes(k) && !s1.includes(k) && !s3.includes(k)))
  ok('T4 第 3 步：交付方式 / 受礼人手机号（领取核验）都在且只在这一步（隐价 / 包装 2026-10-12 起在第 1 步，见 P1）',
    ['bindtap="onSelectDelivery"', 'id="receiverPhoneField"', 'bindtap="onPickVerify"'].every((k) => s3.includes(k) && !s1.includes(k) && !s2.includes(k)))
  ok('T5 支付按钮只有一个，且只在第 3 步（第 1、2 步底栏是「下一步」）',
    (wxml.match(/bindtap="goPay"/g) || []).length === 1 &&
    /<view wx:if="\{\{activeStep < 3\}\}" class="pay-btn" bindtap="onStepNext"[^>]*>[\s\S]*?<\/view>\s*<view wx:else class="pay-btn[^"]*" bindtap="goPay"/.test(wxml))
  ok('T6 步骤轨可点（onRailTap），左上返回承担「上一步」，换步回到顶部',
    (wxml.match(/bindtap="onRailTap"/g) || []).length >= 3 && /<nav-back[^>]*bind:back="onNavBack"/.test(wxml) &&
    wxml.includes('<view id="composeTop"></view>') && wxml.includes('scroll-into-view="{{phoneScrollId}}"'))

  let r
  const run = (name, fn) => { try { fn() } catch (e) { ok(`${name}（抛错：${e.message}）`, false) } }
  run('T7', () => {
    for (const s of [1, 2]) {
      r = makePage(js, { activeStep: s, maxStep: 3 })
      r.page.goPay()
      ok(`T7 第 ${s} 步调 goPay 不得进入确认页`, r.calls.nav.length === 0)
    }
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
    ok('T11 第 2 步：只有语音也可以进第 3 步', r.page.data.activeStep === 3 && r.page.data.maxStep === 3)
  })
  run('T12', () => {
    r = makePage(js, { activeStep: 3, maxStep: 3, receiverPhone: '' })
    r.page.goPay()
    ok('T12 第 3 步支付：未填受礼人手机号 → 就地标红手机号字段、不进确认页', r.calls.nav.length === 0 && /受礼人手机号/.test(r.page.data.receiverPhoneError) && r.page.data.phoneScrollId === 'receiverPhoneField' && r.page.data.activeStep === 3)
    r = makePage(js, { activeStep: 3, maxStep: 3, deliveryType: 'store_pickup', claimLink: true })
    r.page.goPay()
    ok('T13 第 3 步支付：门店自提未选门店 → 提示且不进确认页', r.calls.nav.length === 0 && r.calls.toast.includes('请先选定自提门店'))
    r = makePage(js, { activeStep: 3, maxStep: 3, recipientName: '' })
    r.page.goPay()
    ok('T14 第 3 步支付前再过一遍写笺：称呼被清空 → 退回第 2 步', r.calls.nav.length === 0 && r.page.data.activeStep === 2)
  })
  run('T15', () => {
    r = makePage(js, { activeStep: 3, maxStep: 3 })
    r.page.goPay()
    const nav = r.calls.nav[0]
    const meta = nav && nav.opts && nav.opts.giftMeta
    const ph = r.app.globalData.giftReceiverPhone
    ok('T15 契约不变：交给确认页的 giftMeta 字段集合与改前一致', !!meta && Object.keys(meta).sort().join(',') === GIFT_META_KEYS && nav.opts.source === 'gift' && nav.items[0].productId === 'p1')
    ok('T16 契约不变：globalData.giftReceiverPhone 字段集合与改前一致（含 selfTreat / claimLink / claimPasscode）', !!ph && Object.keys(ph).sort().join(',') === PHONE_KEYS && ph.phone === '13800001111' && ph.selfTreat === false)
    r = makePage(js, { activeStep: 3, maxStep: 3, selfTreat: true, deliveryType: 'ship_to_self', receiverPhone: '' })
    r.page.goPay()
    const n2 = r.calls.nav[0]
    ok('T17 犒劳自己：第 3 步直接可付，寄给我、免填受礼人手机号', !!n2 && n2.opts.giftMeta.deliveryType === 'ship_to_self' && r.app.globalData.giftReceiverPhone.selfTreat === true && r.app.globalData.giftReceiverPhone.phone === '')
    r = makePage(js, { activeStep: 3, maxStep: 3, claimLink: true, claimPasscode: true, receiverPhone: '' })
    r.page.goPay()
    ok('T18 凭礼笺领取 + 口令：第 3 步可付，标记照旧交给确认页', r.calls.nav.length === 1 && r.app.globalData.giftReceiverPhone.claimLink === true && r.app.globalData.giftReceiverPhone.claimPasscode === true)
  })
  run('T19', () => {
    r = makePage(js, { activeStep: 1, maxStep: 2 })
    r.page.onRailTap({ currentTarget: { dataset: { step: 3 } } })
    ok('T19 步骤轨不能跳到没到过的步', r.page.data.activeStep === 1)
    r.page.onRailTap({ currentTarget: { dataset: { step: 2 } } })
    ok('T20 步骤轨可点回 / 点到已到过的步，且换步回到顶部', r.page.data.activeStep === 2 && r.page.data.phoneScrollId === 'composeTop')
    r = makePage(js, { activeStep: 1, maxStep: 3, recipientName: '' })
    r.page.onRailTap({ currentTarget: { dataset: { step: 3 } } })
    ok('T21 步骤轨越过写笺去交付也要过写笺必填（不通过停在第 2 步）', r.page.data.activeStep === 2)
    r = makePage(js, { activeStep: 3, maxStep: 3 })
    r.page.onNavBack()
    ok('T22 左上返回：第 3 步 → 第 2 步', r.page.data.activeStep === 2 && r.calls.back === 0)
    r.page.onEdgeBack()
    ok('T23 左缘右滑：第 2 步 → 第 1 步，不离开页面', r.page.data.activeStep === 1 && r.calls.back === 0)
    r.page.onEdgeBack()
    ok('T24 左缘右滑：第 1 步才离开页面', r.calls.back === 1)
    ok('T25 换步上报 gift_compose_step（from / to / via）', r.calls.track.some((t) => t[0] === 'gift_compose_step' && t[3] && t[3].from === 3 && t[3].to === 2 && t[3].via === 'nav'))
  })
  run('T26', () => {
    r = makePage(js, { activeStep: 3, maxStep: 3, paying: true })
    r.app.globalData.giftPhoneRefill = true
    r.page.data.activeStep = 1
    r.page.onShow()
    ok('T26 确认页退回补手机号：回到第 3 步并定位手机号字段', r.page.data.activeStep === 3 && r.page.data.phoneScrollId === 'receiverPhoneField' && !!r.page.data.receiverPhoneError)
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

  const json = JSON.parse(read(P.json))
  ok('T29 关系统侧滑、改由左缘热区回上一步（否则 iOS 侧滑在第 2、3 步直接离开页面）',
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
  { name: '会员价落定后不重量', file: P.js, find: '}, () => this.syncScrollPane())\n  },', replace: '})\n  },' },
  { name: '底栏不再固定', file: P.wxss, find: '.bottom-bar {\n  position: fixed;', replace: '.bottom-bar {\n  position: relative;' },
  { name: '留白回到写死底栏估高', file: P.wxss, find: '.scroll-pad {\n  height: 48rpx;', replace: '.scroll-pad {\n  height: calc(160rpx + env(safe-area-inset-bottom));' },
  { name: '第 1、2 步底栏也是支付按钮', file: P.wxml, find: 'class="pay-btn" bindtap="onStepNext"', replace: 'class="pay-btn" bindtap="goPay"' },
  { name: 'goPay 不限第 3 步', file: P.js, find: '    if (this.data.activeStep !== 3) return\n', replace: '' },
  { name: '第 2 步「下一步」不校验写笺', file: P.js, find: '    if (step === 2 && !this._checkLetter()) return\n', replace: '' },
  { name: '支付前不再过写笺', file: P.js, find: "    if (!this._checkLetter()) {\n      this._goStep(2, 'pay_check')", replace: "    if (false) {\n      this._goStep(2, 'pay_check')" },
  { name: '步骤轨可跳到没到过的步', file: P.js, find: 'step > (this.data.maxStep || 1)', replace: 'step > 3' },
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
  { name: '确认页退回补号不回第 3 步', file: P.js, find: "        this._goStep(3, 'refill', { keepScroll: true })\n", replace: '' },
  { name: 'giftMeta 多带一个字段（改契约）', file: P.js, find: "        phase: 'mvp'\n", replace: "        phase: 'mvp',\n        step: this.data.activeStep\n" },
  { name: 'giftReceiverPhone 少了 selfTreat（改契约）', file: P.js, find: 'claimPasscode: claimLink && !!this.data.claimPasscode, selfTreat, productId', replace: 'claimPasscode: claimLink && !!this.data.claimPasscode, productId' },
  { name: '第 1 步点关系就在看不见处落笔', file: P.js, find: '    if (this.data.activeStep !== 2) {\n      this._noteWritePending = true', replace: '    if (false) {\n      this._noteWritePending = true' },
  { name: '隐价开关挪回第 2 步', file: P.wxml, find: '        <text class="envelope-caption">藏品纸礼笺 · 封缄后再交付</text>\n', replace: '        <text class="envelope-caption">藏品纸礼笺 · 封缄后再交付</text>\n        <view bindtap="toggleHidePrice"></view>\n' },
  { name: '第 2 步条件写宽（与第 3 步重叠）', file: P.wxml, find: '<block wx:elif="{{activeStep === 2}}">', replace: '<block wx:elif="{{activeStep >= 2}}">' },
  { name: '没关系统侧滑', file: P.json, find: '  "disableSwipeBack": true,\n', replace: '' },
  { name: 'ERP 端漏登记新埋点', file: P.adminSchema, find: '  gift_compose_step: {', replace: '  gift_compose_step_x: {' },
  { name: '交付方式回到折叠', file: P.wxml, find: 'wx:for="{{otherDeliveries}}"', replace: 'wx:if="{{showOtherDelivery}}" wx:for="{{otherDeliveries}}"' },
  { name: '门店自提关闭时仍显示', file: P.js, find: "OTHER_DELIVERIES.filter((d) => d.id !== 'store_pickup')", replace: 'OTHER_DELIVERIES.filter(() => true)' },
  { name: '手机号用途说明常驻', file: P.wxml, find: '<text class="verify-set-hint" wx:if="{{verifyWhyOpen}}">用于', replace: '<text class="verify-set-hint">用于' },
  { name: '领取核验又加框', file: P.wxss, find: '.verify-set {\n  display: flex;', replace: '.verify-set {\n  border: 1px solid #C4A76C;\n  display: flex;' },
  { name: '包装说明加框', file: P.wxss, find: '.wrap-list { display: flex;', replace: '.wrap-list { border: 1px solid #C4A76C; display: flex;' },
  // P 隐价与包装在第 1 步
  { name: '隐价开关挪回第 3 步', file: P.wxml, find: '<view class="verify-head">', replace: '<view bindtap="toggleHidePrice"></view><view class="verify-head">' },
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
  // V 领取核验
  { name: '核验标题不标当前方式', file: P.wxml, find: '<text class="verify-mode" wx:else>手机号核验</text>', replace: '<text class="verify-mode" wx:else></text>' },
  { name: '单选卡选中态写反', file: P.wxml, find: "class=\"verify-seg {{claimLink ? '' : 'on'}}", replace: "class=\"verify-seg {{claimLink ? 'on' : ''}}" },
  { name: '直寄 TA 也给凭礼笺选项', file: P.wxml, find: "<view class=\"verify-seg-row\" wx:if=\"{{deliveryType !== 'ship_to_receiver'}}\">", replace: '<view class="verify-seg-row">' },
  { name: '没有一句话结论', file: P.wxml, find: '        <text class="verify-set-brief">TA 领取时核对这个号码，别人拿到链接也领不走</text>\n', replace: '' },
  { name: '报错不就地显示', file: P.wxml, find: '<view class="verify-set-err" wx:if="{{receiverPhoneError}}">', replace: '<view class="verify-set-err" wx:if="{{false}}">' },
  { name: '出错时手机号卡不描红', file: P.wxml, find: "class=\"verify-seg {{claimLink ? '' : 'on'}} {{receiverPhoneError ? 'is-error' : ''}}\"", replace: "class=\"verify-seg {{claimLink ? '' : 'on'}}\"" },
  { name: '规则展开箭头不翻转', file: P.wxss, find: '.why-toggle.open::after { transform: rotate(-135deg);', replace: '.why-toggle.open::after { transform: none;' },
  { name: '单选卡没有按压反馈', file: P.wxml, find: 'hover-class="verify-seg-press"', replace: 'hover-class="none"' },
  { name: '按压类未定义', file: P.wxss, find: '.verify-seg-press {', replace: '.verify-seg-press-x {' },
  { name: '点已选的卡也会切换', file: P.js, find: '    if (wantLink === !!this.data.claimLink) return\n', replace: '' },
  { name: '单选卡绕开 toggleClaimLink（不清报错）', file: P.js, find: '    this.toggleClaimLink()\n  },', replace: '    this.setData({ claimLink: wantLink })\n  },' },
  { name: '单选卡去掉描边', file: P.wxss, find: '  border: 1px solid rgba(77, 64, 26, 0.45);\n  border-radius: var(--radius-md);\n  transition: border-color 0.18s ease, background-color 0.18s ease;\n}\n.verify-seg.on {', replace: '  border-radius: var(--radius-md);\n  transition: border-color 0.18s ease, background-color 0.18s ease;\n}\n.verify-seg.on {' },
  { name: '隐价回到勾选大框', file: P.wxml, find: 'class="switch-row"', replace: 'class="privacy-row"' },
  { name: '音效条单占一行', file: P.wxml, find: '  <scroll-view\n', replace: '  <view class="sfx-bar"></view>\n  <scroll-view\n' },
  { name: '底栏「备妥应付」单占一行', file: P.wxml, find: '<view class="bottom-value-row">\n        <text class="bottom-label">备妥应付</text>', replace: '<text class="bottom-label">备妥应付</text>\n      <view class="bottom-value-row">' }
]

function main() {
  if (process.argv.includes('--selftest')) {
    const clean = runChecks()
    if (clean.length) {
      console.error('✗ 自检前提：真源须先通过\n  - ' + clean.join('\n  - '))
      process.exit(1)
    }
    let bad = 0
    for (const inj of INJECTIONS) {
      INJECT = inj
      let fails
      try { fails = runChecks() } catch (e) { fails = ['抛错：' + e.message] }
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
  const fails = runChecks()
  if (fails.length) {
    console.error('✗ 送礼页（礼赠编排）版式 / 分步不合格：\n  - ' + fails.join('\n  - '))
    process.exit(1)
  }
  console.log('✓ check:gift-compose-steps：滚动区止于底栏顶边、最后一行不被遮挡 · 三步各放各的 · 第 3 步去密集（平铺单选 / 说明折叠 / 只给可选项描边） · 第 1、2 步无支付 · 写笺在第 2 步校验、手机号 / 门店在第 3 步校验 · 自定义顶栏按胶囊算高、左上返回第 2/3 步回上一步 / 第 1 步离开 · 左缘右滑 / 步骤轨回退 · 隐价与包装逐项说明在第 1 步（隐价语义不变） · 选了关系整页有反馈（chip 实心 + 勾 / 藏品卡「送给 · X」/ 犒劳自己就近提示） · 领取核验标当前方式、单选卡有选中与按压态、一句结论 + 规则折叠、报错就地 · 交给确认页的字段与改前一致')
}

main()
