#!/usr/bin/env node
/**
 * A 流（C 端浏览与发现动线）细节雕刻守卫 —— 钉住每轮打磨的交互 / 文案结论，防止后续改动悄悄退回
 * 台账：miniprogram/docs/细节雕刻_A流_2026-10.md（每条断言对应文档里的一项）
 *
 * 用法：
 *   node miniprogram/scripts/check-a-flow-polish.mjs
 *   node miniprogram/scripts/check-a-flow-polish.mjs --selftest   （内存注入，不写盘）
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const FILES = {
  homeWxml: 'pages/index/index.wxml',
  homeJs: 'pages/index/index.js',
  catWxml: 'pages/category/index.wxml',
  catJs: 'pages/category/index.js',
  atelierWxml: 'pages/atelier/index.wxml',
  atelierJs: 'pages/atelier/index.js',
  identifyWxml: 'subpackages/feature/identify/index.wxml',
  identifyResultWxml: 'subpackages/feature/identify/result/index.wxml',
  searchWxml: 'subpackages/feature/search/index.wxml',
  searchJs: 'subpackages/feature/search/index.js',
  detailWxml: 'subpackages/feature/detail/index.wxml',
  detailJs: 'subpackages/feature/detail/index.js',
  wikiWxml: 'subpackages/feature/detail/wiki-detail/index.wxml',
  articleWxml: 'subpackages/feature/articles/detail/index.wxml',
  detailWxss: 'subpackages/feature/detail/index.wxss',
  searchJson: 'subpackages/feature/search/index.json',
  cdWxml: 'subpackages/content/collection-detail/index.wxml',
  atlasWxml: 'subpackages/feature/collection/detail/index.wxml',
  appWxss: 'app.wxss',
  atelierWxss: 'pages/atelier/index.wxss',
  catWxss: 'pages/category/index.wxss',
  homeWxss: 'pages/index/index.wxss',
  cartWxss: 'pages/cart/index.wxss',
  userWxss: 'pages/user/index.wxss',
  identifyWxss: 'subpackages/feature/identify/index.wxss',
  identifyJs: 'subpackages/feature/identify/index.js',
  bookingWxml: 'subpackages/business/booking/index.wxml',
  bookingJs: 'subpackages/business/booking/index.js',
  bookingWxss: 'subpackages/business/booking/index.wxss',
  previewLib: 'scripts/lib/wxml-preview.mjs',
  storeWxml: 'subpackages/business/store/index.wxml',
  storeWxss: 'subpackages/business/store/index.wxss',
  ticketWxml: 'subpackages/business/ticket/index.wxml',
  ticketWxss: 'subpackages/business/ticket/index.wxss',
  pickupWxss: 'subpackages/business/pickup-pass/index.wxss',
  customWxss: 'subpackages/feature/custom/index.wxss',
  customNav: 'subpackages/feature/utils/customNav.js',
  walletLeather: 'subpackages/business/components/WalletPanelWallet/wallet-leather.wxss',
  walletWxss: 'subpackages/business/components/WalletPanelWallet/index.wxss',
  couponsWxss: 'subpackages/business/components/WalletPanelCoupons/index.wxss',
  pointsWxss: 'subpackages/business/components/WalletPanelPoints/index.wxss',
  hubBarWxss: 'subpackages/business/components/WalletHubBar/index.wxss',
  supportWxml: 'subpackages/extra/user/support/index.wxml',
  supportWxss: 'subpackages/extra/user/support/index.wxss',
  searchWxss: 'subpackages/feature/search/index.wxss',
  liveWxss: 'subpackages/extra/live/studio/index.wxss',
  artisanWxss: 'subpackages/extra/artisan/index.wxss',
  artCommission: 'subpackages/extra/artisan/commission/index.wxss',
  artPet: 'subpackages/extra/artisan/pet/index.wxss',
  artWorks: 'subpackages/extra/artisan/works/index.wxss',
  artProfile: 'subpackages/extra/artisan/profile/index.wxss',
  artConcept: 'subpackages/extra/artisan/concept/index.wxss',
  supplierCommon: 'subpackages/extra/supplier/utils/supplier-common.wxss',
  buyCatalog: 'subpackages/extra/supplier/catalog/index.wxss',
  buyCart: 'subpackages/extra/supplier/buyer-cart/index.wxss',
  buyOrders: 'subpackages/extra/supplier/buyer-orders/index.wxss',
  deskCommon: 'subpackages/b2bdesk/desk-common.wxss',
  deskCenter: 'subpackages/b2bdesk/center/index.wxss',
  shareholderWxss: 'subpackages/extra/shareholder/index.wxss',
  investorWxss: 'subpackages/extra/investor/index.wxss',
  staffHubWxml: 'subpackages/extra/staff/index.wxml',
  staffHubWxss: 'subpackages/extra/staff/index.wxss',
  mgrHubNavWxss: 'subpackages/manager/manager/hubNav.wxss',
  mgrWxss: 'subpackages/manager/manager/index.wxss',
  permWxml: 'subpackages/extra/staff-permissions/index.wxml',
  permWxss: 'subpackages/extra/staff-permissions/index.wxss',
  permMgrWxss: 'subpackages/manager/staff-permissions/index.wxss',
  approvalsWxml: 'subpackages/extra/approvals/index.wxml',
  payslipAdminWxml: 'subpackages/manager/payslip/admin/index.wxml',
  wsSubviewsWxml: 'subpackages/manager/manager/workspace/_subviews.wxml',
  petSheetWxml: 'subpackages/manager/manager/workspace/petMemorialSheet.wxml',
  shCfgWxss: 'subpackages/extra/shareholder-config/index.wxss',
  apJs: 'subpackages/extra/approvals/index.js',
  apWxml: 'subpackages/extra/approvals/index.wxml',
  apReasons: 'subpackages/extra/approvals/rejectReasons.js',
  apWxss: 'subpackages/extra/approvals/index.wxss',
  mgrWxml: 'subpackages/manager/manager/index.wxml',
  punchJs: 'subpackages/extra/staff/attendance/punchCard.js',
  attWxml: 'subpackages/extra/staff/attendance/index.wxml',
  attJs: 'subpackages/extra/staff/attendance/index.js',
  todoWxml: 'subpackages/extra/staff/store-todos/index.wxml',
  todoJs: 'subpackages/extra/staff/store-todos/index.js',
  todoWxss: 'subpackages/extra/staff/store-todos/index.wxss',
  coJs: 'subpackages/business/confirm-order/index.js',
  coWxml: 'subpackages/business/confirm-order/index.wxml',
  coWxss: 'subpackages/business/confirm-order/index.wxss',
  rcvJs: 'subpackages/feature/gift/receive/index.js',
  rcvWxml: 'subpackages/feature/gift/receive/index.wxml',
  rcvWxss: 'subpackages/feature/gift/receive/index.wxss',
  spcJs: 'subpackages/feature/components/SpeciesCard/index.js',
  spcWxml: 'subpackages/feature/components/SpeciesCard/index.wxml',
  identifyJs: 'subpackages/feature/identify/index.js',
  identifyResultJs: 'subpackages/feature/identify/result/index.js',
  pickupJs: 'subpackages/business/pickup-pass/index.js',
  pickupWxml: 'subpackages/business/pickup-pass/index.wxml',
  artMetaJs: 'subpackages/feature/articles/detail/readingMeta.js',
  artJs: 'subpackages/feature/articles/detail/index.js',
  artWxml: 'subpackages/feature/articles/detail/index.wxml',
  fbJs: 'subpackages/extra/user/feedback/index.js',
  fbWxml: 'subpackages/extra/user/feedback/index.wxml',
  msgDetailJs: 'subpackages/extra/user/messages/detail/index.js',
  msgDetailWxml: 'subpackages/extra/user/messages/detail/index.wxml',
  msgListWxml: 'subpackages/extra/user/messages/index.wxml',
  certJs: 'subpackages/extra/user/certificates/index.js',
  certSealJs: 'subpackages/extra/user/certificates/certSeal.js',
  certWxml: 'subpackages/extra/user/certificates/index.wxml',
  vrJs: 'subpackages/feature/articles/detail/videoResume.js',
  videosJs: 'subpackages/content/videos/index.js',
  videosWxml: 'subpackages/content/videos/index.wxml',
  odJs: 'subpackages/business/order-detail/index.js',
  odWxml: 'subpackages/business/order-detail/index.wxml',
  journeyJs: 'subpackages/business/order-detail/specimenJourney.js',
  leaveSpanJs: 'subpackages/extra/staff/leave/leaveSpan.js',
  leaveWxml: 'subpackages/extra/staff/leave/index.wxml',
  reimLedgerJs: 'subpackages/extra/staff/reimbursements/reimburseLedger.js',
  reimWxml: 'subpackages/extra/staff/reimbursements/index.wxml',
  achLitJs: 'subpackages/extra/user/achievements/litSeen.js',
  achJs: 'subpackages/extra/user/achievements/index.js',
  achWxml: 'subpackages/extra/user/achievements/index.wxml',
  pfJs: 'subpackages/extra/user/profile/index.js',
  pfWxml: 'subpackages/extra/user/profile/index.wxml',
  pubJs: 'subpackages/feature/community/publish/index.js',
  pubWxml: 'subpackages/feature/community/publish/index.wxml',
  careSpecJs: 'subpackages/feature/utils/careSpecimens.js',
  careMyWxml: 'subpackages/feature/care/my/index.wxml',
  homeGreetJs: 'pages/index/homeGreeting.js',
  gcJs: 'subpackages/feature/gift/compose/index.js',
  gcWxml: 'subpackages/feature/gift/compose/index.wxml',
  shipJs: 'subpackages/extra/shipment-ops/index.js',
  shipWxml: 'subpackages/extra/shipment-ops/index.wxml',
  dayDeltaJs: 'subpackages/manager/utils/dayDelta.js',
  mgrCfgJs: 'subpackages/manager/manager/managerPageConfig.js',
  staffHubJs: 'subpackages/extra/staff/index.js',
  certPageWxml: 'subpackages/business/certificate/index.wxml',
  certPageWxss: 'subpackages/business/certificate/index.wxss',
  customJs: 'subpackages/feature/custom/index.js',
  customWxml: 'subpackages/feature/custom/index.wxml'
}
/** 无 require 的 CommonJS 小模块：内存里求值拿 exports（失败返回 {}） */
function loadCjs(src) {
  try { const m = { exports: {} }; new Function('module', 'exports', src)(m, m.exports); return m.exports } catch (e) { return {} }
}
/** 假本机缓存 */
function memStorage() {
  const store = {}
  return { store, getStorageSync: (k) => store[k], setStorageSync: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)) } }
}
const readAll = () => Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, readFileSync(join(MP, p), 'utf8')]))

/** 取 Page 方法体：从 `  name(` 到下一个同缩进的方法头（按语法边界，不用固定长度；错题本 E7） */
/** 用假定时器跑 SpeciesCard：拿到「刚开始 / 敲完 / 再给同一学名 / 非 fresh」四个快照 */
function runSpeciesTypewriter(src) {
  let def = null
  new Function('Component', 'require', src)((d) => { def = d }, () => ({ toChineseTaxonomy: () => ({}), translateTaxonValue: () => '' }))
  const timers = []
  const fake = { setTimeout: (fn) => { timers.push(fn); return timers.length }, clearTimeout() {}, setInterval: (fn) => { timers.push({ every: fn }); return timers.length }, clearInterval() {} }
  const make = (tw) => {
    const inst = { data: { ...def.data, typewriter: tw }, setData(p) { Object.assign(this.data, p) } }
    Object.keys(def.methods).forEach((k) => { inst[k] = def.methods[k].bind(inst) })
    return inst
  }
  const obs = def.observers['speciesInfo, imageUrl, confidenceLevel']
  const g = globalThis
  const saved = { st: g.setTimeout, ct: g.clearTimeout, si: g.setInterval, ci: g.clearInterval }
  Object.assign(g, { setTimeout: fake.setTimeout, clearTimeout: fake.clearTimeout, setInterval: fake.setInterval, clearInterval: fake.clearInterval })
  try {
    const a = make(true)
    obs.call(a, { species_name_latin: 'Morpho helena', confidence: 0.92 }, '', 'high')
    const start = { ...a.data }
    timers.shift()()
    const tick = timers.shift().every
    for (let i = 0; i < 40 && a.data.latinTyping; i += 1) tick()
    const end = { ...a.data }
    obs.call(a, { species_name_latin: 'Morpho helena', confidence: 0.92 }, '', 'high')
    const again = { ...a.data }
    const b = make(false)
    obs.call(b, { species_name_latin: 'Papilio maackii' }, '', 'high')
    return { start, end, again, plain: { ...b.data } }
  } finally {
    Object.assign(g, { setTimeout: saved.st, clearTimeout: saved.ct, setInterval: saved.si, clearInterval: saved.ci })
  }
}

function methodBody(src, name) {
  const m = new RegExp(`\\n  (?:async )?${name}\\([^)]*\\) \\{`).exec(src)
  if (!m) return ''
  const rest = src.slice(m.index + m[0].length)
  const end = rest.search(/\n  (?:async )?[A-Za-z_$][\w$]*\([^)]*\) \{/)
  return end < 0 ? rest : rest.slice(0, end)
}

/** 取某个开标签（可跨行）的完整文本 */
function openTag(src, re) {
  const m = re.exec(src)
  if (!m) return ''
  let j = m.index
  let q = null
  for (; j < src.length; j += 1) {
    const c = src[j]
    if (q) { if (c === q) q = null } else if (c === '"' || c === "'") q = c
    else if (c === '>') break
  }
  return src.slice(m.index, j + 1)
}

function checks(s) {
  const out = []
  const add = (name, ok) => out.push({ name, ok: !!ok })

  // R1-1 首页：内容在满屏 scroll-view 里 → 下拉刷新由 scroll-view 承接，且有防重入与兜底收起
  const sv = openTag(s.homeWxml, /<scroll-view\b[^>]*?class="main-scroll"|<scroll-view\b(?=[\s\S]*?class="main-scroll")/)
  const handler = (/bindrefresherrefresh="(\w+)"/.exec(sv) || [])[1]
  add('R1-1 首页主滚动区开启 scroll-view 下拉（refresher-enabled + triggered 绑定）',
    /refresher-enabled="\{\{!isSinglePage\}\}"/.test(sv) && /refresher-triggered="\{\{homeRefreshing\}\}"/.test(sv) && !!handler)
  const hb = handler ? methodBody(s.homeJs, handler) : ''
  add('R1-1 下拉回调存在、防重入、调用同一套重置并最终收起',
    !!hb && /\n    if \(this\._refresherBusy\) return;/.test(hb) && /onPullDownRefresh\(\)/.test(hb) && /homeRefreshing: false/.test(hb) && /setTimeout\(done, \d+\)/.test(hb))
  add('R1-1 onPullDownRefresh 返回 Promise（下拉回调要等它结束才收起）',
    /return this\.initData\(\)\.finally/.test(methodBody(s.homeJs, 'onPullDownRefresh')))

  // R1-2 首页：缺内容时不显示占位文案（错题本 E11）
  add('R1-2 首页 banner 副标题 / 专题简介无占位兜底（「探索未知」「点击查看详情」）',
    !/探索未知|点击查看详情/.test(s.homeWxml) && /class="h-sub" wx:if="\{\{item\.subtitle\}\}"/.test(s.homeWxml) && /class="ec-brief text-cut" wx:if="\{\{item\.brief\}\}"/.test(s.homeWxml))

  // R1-3 馆藏：筛选无结果给出口；onFilterConfirm 的 applied 可重新赋值（P0：const 重赋值曾让「全部」tab 选馆后面板关不掉）
  const ef = /<view class="empty-filter" wx:if="\{\{orphanProducts\.length === 0 && filterActiveCount > 0\}\}">[\s\S]*?bindtap="(\w+)"/.exec(s.catWxml)
  add('R1-3 馆藏筛选无结果：空态带「清除筛选」按钮且回调存在',
    !!ef && /清除筛选/.test(s.catWxml) && /onFilterConfirm\(\{ detail: \{\} \}\)/.test(methodBody(s.catJs, ef[1])))
  add('R1-3 馆藏 onFilterConfirm 的 applied 用 let（同函数内会被 applyRootTabFromFilter 结果重新赋值）',
    /\n    let applied = \{/.test(methodBody(s.catJs, 'onFilterConfirm')) && /applied = synced\.applied/.test(methodBody(s.catJs, 'onFilterConfirm')))

  // R1-4 工坊：进度磁贴有按压反馈；四格描述显示宽 ≤ 22 字（实图每行 11 个全角字、两行截断；半角按半个字计）
  add('R1-4 工坊进度查询两枚磁贴都有 hover-class',
    (s.atelierWxml.match(/class="order-tile" bindtap="go\w+Orders" hover-class="order-tile-press"/g) || []).length === 2)
  const descs = [...s.atelierJs.matchAll(/\n    desc: '([^']*)'/g)].map((m) => m[1])
  const width = (d) => [...d].reduce((w, ch) => w + (/[\x20-\x7e]/.test(ch) ? 0.5 : 1), 0)
  add('R1-4 工坊四格描述显示宽均 ≤ 22 字', descs.length >= 4 && descs.every((d) => width(d) <= 22))

  // R2-1 AI 鉴定等待：步骤与上传进度在加载卡内（遮罩外会被压暗，15–60 秒只看得到转圈）
  const core = (/<view class="loading-core">([\s\S]*?)\n    <\/view>\n  <\/view>/.exec(s.identifyWxml) || [])[1] || ''
  add('R2-1 鉴定加载卡内含三步进度与上传进度条',
    /class="steps"/.test(core) && (core.match(/class="step \{\{/g) || []).length === 3 && /class="progress-bar"/.test(core))
  add('R2-1 鉴定页「鉴定记录」入口有按压态', /class="recent-link" bindtap="goLog" hover-class="recent-item-press"/.test(s.identifyWxml))
  // 2026-10-17 鉴定台重构：取景框整框可点即拍（且等待中不重复触发）；最近鉴定缩略图读不到退回占位格；本屏只有一颗实心金
  add('R11-1 鉴定台取景框可点即拍、有按压态，等待中不重复触发',
    /class="frame [^"]*"\s+bindtap="onFrameTap"\s+hover-class="frame-press"/.test(s.identifyWxml) &&
      /onFrameTap\(\) \{\s*if \(this\.data\.busy\) return\s*this\.onTakePhoto\(\)/.test(s.identifyJs))
  add('R11-2 最近鉴定缩略图有 binderror 并按下标退回占位格',
    /class="recent-thumb" src="\{\{item\.thumb\}\}"[^>]*binderror="onRecentThumbError"/.test(s.identifyWxml) &&
      /wx:else class="recent-thumb is-empty"/.test(s.identifyWxml) &&
      /\[`recentList\[\$\{i\}\]\.thumb`\]: ''/.test(methodBody(s.identifyJs, 'onRecentThumbError')))
  // 2026-10-17 预约「入馆券」：页头一张票根（不再是双面翻转票）、分区头不再「中文 | ENGLISH」并列、预览库能解析表达式里的 <
  // 2026-10-17 产品负责人：「预约门票仍然使用之前的设计方案，按整体视觉适配即可，不要推翻重来」
  add('R12-1 预约页头保留双面翻转典藏票（两面 + 翻面交互），只做视觉适配（无 emoji 水印）',
    /<view class="ticket-3d-container \{\{isFlipped \? 'flipped' : ''\}\}" bindtap="flipTicket">/.test(s.bookingWxml) &&
      /class="ticket-face face-front"/.test(s.bookingWxml) && /class="ticket-face face-back"/.test(s.bookingWxml) &&
      /flipTicket\(\) \{[\s\S]{0,160}isFlipped: !this\.data\.isFlipped/.test(s.bookingJs) && /isFlipped: false/.test(s.bookingJs) &&
      (s.bookingWxml.match(/class="val highlight[^"]*">\{\{ticketInfo\.timeStr\}\}/g) || []).length === 2 &&
      !/🦋/.test(s.bookingWxml))
  // 2026-10-17 产品负责人：「入馆券除了目前的样式，还需要保持之前的打印动画」
  add('R12-4 预约成功的入馆券打印动画保留（打印机出纸 0→720rpx / 2.5s、进度条、扫描线，2.6s 后出操作区）',
    /<view class="mint-machine">[\s\S]*?<view class="printer-slot"><\/view>/.test(s.bookingWxml) &&
      /<view class="ticket-paper \{\{mintAnimation \? 'printing' : ''\}\}">/.test(s.bookingWxml) &&
      /class="scan-bar"/.test(s.bookingWxml) && /<view class="mint-progress"><view class="mp-bar"><\/view><\/view>/.test(s.bookingWxml) &&
      /\n\.ticket-paper \{[^}]*height: 0;[^}]*transition: height 2\.5s/.test(s.bookingWxss) && /\.ticket-paper\.printing \{ height: 720rpx; \}/.test(s.bookingWxss) &&
      /\.mp-bar \{[^}]*animation: bk-progress 2\.5s linear forwards/.test(s.bookingWxss) &&
      /\n\.mint-actions \{[^}]*opacity: 0;[^}]*2\.6s/.test(s.bookingWxss) &&
      /this\.setData\(\{ mintAnimation: true \}\);[\s\S]{0,80}\}, 100\);[\s\S]{0,40}setTimeout\(\(\) => \{\s*this\.setData\(\{ mintFinished: true \}\);[\s\S]{0,60}\}, 2600\);/.test(s.bookingJs))
  // 2026-10-18 产品负责人截图：「查看凭证 / 继续预约」压住出纸底边（80vh 定高 + bottom 绝对定位，矮屏必叠）
  {
    const top = +((s.bookingWxss.match(/\n\.ticket-paper \{[^}]*?top: (\d+)rpx/) || [])[1] || NaN)
    const h = +((s.bookingWxss.match(/\.ticket-paper\.printing \{ height: (\d+)rpx; \}/) || [])[1] || NaN)
    const mh = +((s.bookingWxss.match(/\n\.mint-machine \{[^}]*?height: (\d+)rpx/) || [])[1] || NaN)
    const area = (s.bookingWxss.match(/\n\.mint-bottom-area \{([^}]*)\}/) || [])[1] || ''
    const mt = +((area.match(/margin-top: (\d+)rpx/) || [])[1] || NaN)
    add(`R27-1 入馆券打印弹层：操作区在文档流、让出整张纸（纸底 ${top + h} ≤ 操作区顶 ${mh + mt} − 32）`,
      !/position: absolute/.test(area) && !/\n\.mint-content \{[^}]*height: \d+vh/.test(s.bookingWxss) && mh + mt - (top + h) >= 32)
  }
  add('R12-2 预约页分区头为眉标 + 中文主标两行（不再「选择日期 | SELECT DATE」同一节点并列）',
    !/class="section-label">[^<]*\|/.test(s.bookingWxml) && (s.bookingWxml.match(/<view class="section-label"><text class="sl-en">/g) || []).length === 4)
  add('R12-3 wxml-preview 跳过 {{ }} 内的 <（否则预约页无法离线出图）',
    /function nextTagStart\(src, from\)/.test(s.previewLib) && /const lt = nextTagStart\(src, i\)/.test(s.previewLib))
  // 2026-10-17 门店「到店指南」
  add('R13-1 门店名片是浅纸标本签，地图在签外独立成图版（不再塞进深色卡里）',
    /class="info-map-wrap"[\s\S]*?<view class="store-card">\s*<view class="card-pin"/.test(s.storeWxml) &&
      !/<view class="store-card">[\s\S]*?<map[\s\S]*?class="checkin-inline/.test(s.storeWxml) &&
      /\n\.store-card \{[^}]*background: linear-gradient\(180deg, #F3ECDD, #E8DFCB\)/.test(s.storeWxss))
  add('R13-2 门店页实心金只有「预约参观」一处（「我已到店」行内 / 浮钮都是金线环）',
    [...s.storeWxss.matchAll(/\n(\.[^{\n]+) \{([^}]*)\}/g)]
      .filter(([, sel, body]) => /background: var\(--brass-400\)/.test(body) && !/press|disabled/.test(sel)).map(([, sel]) => sel.trim()).join(',') === '.booking-btn')
  add('R13-3 wxml-preview 认识 <map>（门店页离线出图）', /\bmap: 'div'/.test(s.previewLib))
  // 2026-10-17 入馆券 / 门店自取凭证
  const solidGold = (css) => [...css.matchAll(/\n(\.[^{\n]+) \{([^}]*)\}/g)]
    .filter(([, sel, body]) => /background: (var\(--brass-400\)|var\(--color-primary\)|linear-gradient\(135deg, #A8903C)/.test(body) && !/press|disabled/.test(sel)).map(([, sel]) => sel.trim()).join(',')
  add('R14-1 入馆券是博物馆黑票面 + 浅纸二维码图版，实心金只给「改期」（金色页头带退场）',
    solidGold(s.ticketWxss) === '.footer-btn.primary' && /class="qr-plate"/.test(s.ticketWxml) && !/signal-light/.test(s.ticketWxml))
  add('R14-2 自取凭证不用信号橙绿（状态章 / 进度点 / 已自提印章），实心金只给「订单详情」',
    !/--color-(success|warning)|82, 183, 136|233, 162, 59/.test(s.pickupWxss) && solidGold(s.pickupWxss) === '.pass-btn.primary')
  // 2026-10-17 标本定制「定制工坊」
  {
    const navRpx = (k) => Number(((s.customNav.match(new RegExp(`const ${k} = rpx\\((\\d+)\\)`)) || [])[1]))
    const cssH = (sel) => Number(((s.customWxss.match(new RegExp(`\\n\\${sel} \\{[^}]*\\n  height: (\\d+)rpx;`)) || [])[1]))
    add('R15-1 定制页头两段高度与 customNav 预留一致（说明 88rpx / 步骤条 148rpx，否则内容区会钻进页头或留缝）',
      navRpx('mottoHeight') > 0 && cssH('.nav-motto') === navRpx('mottoHeight') && cssH('.header-rail-full') === navRpx('stepBarHeight'))
  }
  // 2026-10-19 产品负责人「优化此页面顶部样式」（真机：主标题偏左、步骤条下大段空白）
  add('R15-3 定制页（系统导航栏）：标题行左右对称不让胶囊；顶距不含状态栏 / 胶囊栏，onReady 按页头实测高度锚定；不重复「STEP 0x / 05」',
    /<view class="nav-row">/.test(s.customWxml) && !/navPaddingRight/.test(s.customWxml) &&
      /headerHeight: nav\.headerHeight - nav\.statusBarHeight - nav\.navBarHeight/.test(s.customJs) &&
      /onReady\(\) \{\s*this\.syncStickyHeaderHeight\(\)/.test(s.customJs) && !/panel-index/.test(s.customWxml))
  add('R15-2 定制页实心金只给底栏主按钮（步骤条当前步不再是实心金圆点）',
    solidGold(s.customWxss) === '.btn-primary' && !/grain-overlay/.test(s.customWxss))
  // 2026-10-17 产品负责人：钱包 / 礼券 / 积分「不要更改卡片的金属与皮质视觉质感，只做页面的视觉对齐和细节质感提升」
  {
    const rule = (src, sel) => (src.match(new RegExp('(^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{[^}]*\\}')) || [''])[0].trim()
    const parts = [s.walletLeather,
      ...['.asset-face', '.asset-back', '.card-texture', '.card-inner', '.level-badge', '.num'].map((x) => rule(s.pointsWxss, x)),
      ...['.coupon-card', '.c-left', '.texture'].map((x) => rule(s.couponsWxss, x))]
    const fp = createHash('sha256').update(parts.join('\n/*--*/\n')).digest('hex').slice(0, 16)
    // 指纹变了 = 有人动了卡面质感。确系产品负责人点名改卡面时，才更新这里的指纹值。
    add(`R16-1 钱包皮质卡 / 积分黑金卡 / 礼券券面的质感规则未被改动（指纹 ${fp}）`, fp === '9c483878d63c163d')
  }
  add('R16-2 钱包页面对齐：顶栏下划线页签、分区去金条盒子、礼券无警示橙、兑换钮不再是实心金药丸',
    !/\n\.whb-seg \{[^}]*background/.test(s.hubBarWxss) && /\.account-section-label::before \{ display: none; \}/.test(s.walletWxss) &&
      !/E9A23B|233, 162, 59/.test(s.couponsWxss) && !/\.btn-outline \{[^}]*background: var\(--color-primary\)/.test(s.pointsWxss) &&
      !/box-shadow: 0 0 10rpx var\(--color-primary\)/.test(s.pointsWxss))
  // 2026-10-17 联系专员「专员服务台」
  add('R17-1 联系专员实心金只给「开始对话」（微信专员是主路径），留言提交为金线环',
    solidGold(s.supportWxss) === '.channel-btn' && /\n\.submit-btn \{[^}]*background: transparent !important;/.test(s.supportWxss))
  add('R17-2 联系专员留言写在浅纸便笺上、无 grain-overlay、联系方式为发丝线行（不再是圆角卡）',
    /\n\.form-card \{[^}]*linear-gradient\(180deg, #F3ECDD, #E8DFCB\)/.test(s.supportWxss) && !/grain-overlay/.test(s.supportWxml) &&
      !/\n\.channel-item \{[^}]*border-radius/.test(s.supportWxss))
  // 2026-10-18 搜索「检索台」
  add('R18-1 搜索结果为发丝线行、分类为下划线页签、签为方角（不再是圆角卡 / 胶囊），颗粒层退场',
    !/\n\.archive-card \{[^}]*border-radius/.test(s.searchWxss) && /\n\.filter-pill \{[^}]*border-bottom: 3rpx solid transparent/.test(s.searchWxss) &&
      !/9999px/.test(s.searchWxss) && !/grain-overlay/.test(s.searchWxml) && !/font-style: italic;\n  color: var\(--brass-400/.test(s.searchWxss))
  // 2026-10-18 主播工作台（员工端，产品负责人点名）
  add('R19-1 主播工作台：主播职责为发丝线行（非圆角卡）、「下一步」为浅纸指引签、流程为下划线；员工端红 / 黄语义色保留',
    !/\n\.module-card \{[^}]*border-radius/.test(s.liveWxss) && /\n\.next-card \{[^}]*linear-gradient\(180deg, #F3ECDD, #E8DFCB\)/.test(s.liveWxss) &&
      /\.flow-step-btn\.hot \{\s*border-bottom-color: var\(--brass-400\);/.test(s.liveWxss) && /\.flow-step-btn\.on-air \{\s*border-bottom-color: var\(--color-error\);/.test(s.liveWxss) &&
      /\.footer-end \{[^}]*var\(--color-error\)/.test(s.liveWxss))
  // 2026-10-18 标本师工作台（员工端，产品负责人点名）
  add('R20-1 标本师工作台：入口为发丝线行（非大圆角卡）、待办有待办格金线环、分区头为眉标 + 宋体',
    !/\n\.module-card \{[^}]*border-radius/.test(s.artisanWxss) && /\.todo-chip\.hot \{[^}]*var\(--ring-brass-soft\)/.test(s.artisanWxss) &&
      /\n\.group-cn \{[^}]*font-family: var\(--font-brand\)/.test(s.artisanWxss))
  // 2026-10-18 标本师五个子页（员工端，点名）
  {
    const subs = ['artCommission', 'artPet', 'artWorks', 'artProfile', 'artConcept']
    const rounded = subs.filter((k) => /border-radius: var\(--radius-(lg|md|full)\)|border-radius: (999rpx|9999px)/.test(s[k]))
    add(`R21-1 标本师子页卡片方角、签不再是胶囊${rounded.length ? '（仍圆角：' + rounded.join(',') + '）' : ''}`, rounded.length === 0)
  }
  add('R21-2 标本师子页：提成 / 伴宠汇总为浅纸账签，概念卡为浅纸标本签，档案选项签选中不再实心金',
    ['artCommission', 'artPet'].every((k) => /\n\.summary-card \{[^}]*linear-gradient\(180deg, #F3ECDD, #E8DFCB\)/.test(s[k])) &&
      /\n\.plate-card \{[^}]*linear-gradient\(180deg, #F3ECDD, #E8DFCB\)/.test(s.artConcept) &&
      !/\.type-chip\.is-on \{[^}]*background: var\(--brass-400\)/.test(s.artProfile))
  // 2026-10-18 采购商工作台（共享 supplier-common，含六个子页的公共零件）
  add('R22-1 采购商工作台：入口为发丝线行、流程为下划线、行内动作非实心金药丸、无胶囊半径；演示橙保留',
    !/\n\.module-card \{[^}]*border-radius/.test(s.supplierCommon) && /\.flow-step-btn\.hot \{\s*border-bottom-color: var\(--brass-400\);/.test(s.supplierCommon) &&
      !/\n\.list-action \{[^}]*background: var\(--brass-500\)/.test(s.supplierCommon) && !/999rpx/.test(s.supplierCommon) && /#e07a5f/.test(s.supplierCommon))
  // 2026-10-18 采购商子页（价目选购 / 采购车 / 我的采购单）
  {
    const pages = ['buyCatalog', 'buyCart', 'buyOrders']
    const rounded = pages.filter((k) => /999rpx|border-radius: var\(--radius-(lg|md|sm|full)\)/.test(s[k]))
    add(`R23-1 采购商子页方角、无胶囊${rounded.length ? '（仍圆角：' + rounded.join(',') + '）' : ''}`, rounded.length === 0)
    add('R23-2 采购商子页实心金只给页面主操作：选购页「去下单」、采购车「提交」；「加入采购车」与采购单「去支付」为金线环',
      solidGold(s.buyCatalog) === '.cart-bar-cta' && solidGold(s.buyCart) === '.btn-primary' && solidGold(s.buyOrders) === '')
  }
  // 2026-10-18 供应商管理工作台（b2bdesk）
  {
    const ROUND = /^\.(kpi-dot|bar-track|bar-fill|tl-dot|toggle|toggle-knob|tab-dot|skel-avatar|state-mark|avatar)$/
    const pills = []
    for (const k of ['deskCommon', 'deskCenter']) {
      for (const [, sel, body] of s[k].matchAll(/\n([^\n{]+?)\s*\{([^}]*)\}/g)) {
        if (/border-radius: (999rpx|var\(--radius-(lg|md)\))/.test(body) && !ROUND.test(sel.trim())) pills.push(sel.trim())
      }
    }
    add(`R24-1 供应商管理：分段 / 芯片 / 卡片 / 按钮方角，仅圆点 / 开关 / 进度条 / 时间轴保持圆${pills.length ? '（仍圆角：' + pills.slice(0, 4).join(',') + '）' : ''}`, pills.length === 0)
    add('R24-2 供应商管理：顶部分段为下划线页签、「供」为方印',
      /\.tab\.on \{\s*border-bottom-color: var\(--brass-400\);/.test(s.deskCommon) && /\n\.hero-mark \{[^}]*border-radius: 2rpx;/.test(s.deskCenter))
  }
  // 2026-10-18 股东观测台
  {
    const KEEP = /^\.(boot-mark|signal-light|progress-track|progress-fill|share-track|share-fill)$/
    const pills = [...s.shareholderWxss.matchAll(/\n([^\n{]+?)\s*\{([^}]*)\}/g)]
      .filter(([, sel, body]) => /border-radius: (9999px|999rpx|var\(--radius-(lg|md|full))/.test(body) && !KEEP.test(sel.trim())).map(([, sel]) => sel.trim())
    add(`R25-1 股东观测台：页签 / 卡片 / 指标格方角，信号灯与进度条保持圆${pills.length ? '（仍圆角：' + pills.slice(0, 4).join(',') + '）' : ''}`,
      pills.length === 0 && /\.range-tab\.on, \.month-chip\.on \{[^}]*var\(--ring-brass\)/.test(s.shareholderWxss))
  }
  // 2026-10-18 投资观测台
  {
    const KEEP = /^\.(boot-mark|share-track|share-fill|dot)$/
    const pills = [...s.investorWxss.matchAll(/\n([^\n{]+?)\s*\{([^}]*)\}/g)]
      .filter(([, sel, body]) => /border-radius: (9999px|999rpx|var\(--radius-(lg|md|full))/.test(body) && !KEEP.test(sel.trim())).map(([, sel]) => sel.trim())
    add(`R26-1 投资观测台：区间页签选中为金线环（非实心金）、卡片方角、分区头宋体${pills.length ? '（仍圆角：' + pills.slice(0, 4).join(',') + '）' : ''}`,
      pills.length === 0 && /\.range-tab\.on \{[^}]*var\(--ring-brass\)/.test(s.investorWxss) && !/\.range-tab\.on \{[^}]*background: var\(--brass-400/.test(s.investorWxss) &&
        /\n\.group-cn \{[^}]*font-family: var\(--font-brand\)/.test(s.investorWxss))
  }
  // 2026-10-18 店员工作台（只覆盖本页；scene.wxss / field 为子页共用件不动）
  add('R28-1 店员工作台：分区头眉标 + 宋体两行、场景格方角发丝账格、角标退为金线环（实心金只留扫码主按钮）',
    /<view class="group-head"><text class="group-en">\{\{item\.en\}\}<\/text><text class="group-cn">\{\{item\.title\}\}<\/text><\/view>/.test(s.staffHubWxml) &&
      !/\{\{item\.title\}\} \/ \{\{item\.en\}\}/.test(s.staffHubWxml) &&
      /\n\.link-row \.link-btn \{[^}]*border-radius: 4rpx;/.test(s.staffHubWxss) &&
      /\n\.link-btn \.scene-badge \{[^}]*background: #1A1814;[^}]*var\(--ring-brass\)/.test(s.staffHubWxss) &&
      /\n\.scene-header \.picker-inner \{[^}]*background: transparent;/.test(s.staffHubWxss))
  // 2026-10-18 店长 / 超管工作台（同一页 manager/manager，按角色出看板）：容器方角、常用为开放分区；
  // 4 列圆形图标宫格与红色数字角标是 2026-10-10 产品负责人口径，归 check:hub-entries 守，这里不碰
  add('R29-1 店长工作台：待处理 / 金卡 / 经营信号 / 分类卡方角，常用去盒改开放分区，胶囊签改方签，宋体主标',
    /\n\.hub-todo \{[^}]*border-radius: 4rpx;/.test(s.mgrHubNavWxss) && /\n\.hub-todo-chip \{[^}]*border-radius: 2rpx;/.test(s.mgrHubNavWxss) &&
      /\n\.hub-fav \{\s*padding: 0;/.test(s.mgrHubNavWxss) && /\n\.hub-fav-edit \{[^}]*border-radius: 2rpx;/.test(s.mgrHubNavWxss) &&
      /\n\.hub-grp \{[^}]*border-radius: 4rpx;/.test(s.mgrHubNavWxss) &&
      /\.sub-welcome \{ font-family: var\(--font-brand\);/.test(s.mgrWxss) && /\n\.kpi-card \{[^}]*border-radius: 4rpx;/.test(s.mgrWxss) &&
      /\n\.ops-signal-board \{[^}]*border-radius: 4rpx;/.test(s.mgrWxss) && /\n\.hub-scan-btn \{[^}]*border-radius: 4rpx;/.test(s.mgrWxss))
  add('R30-1 超管 / 店长看板下半屏：功能搜索方框、数据卡方角发丝框、空态说明与页脚中文可读（不再用 #4A4540 一类近黑灰）',
    /\n\.hub-search-box \{[^}]*border-radius: 4rpx;/.test(s.mgrHubNavWxss) && /\n\.hub-found \{[^}]*border-radius: 4rpx;/.test(s.mgrHubNavWxss) &&
      /\n\.grid-item \{[^}]*border-radius: 4rpx;/.test(s.mgrWxss) && /\n\.kpi-mini-cell \{[^}]*border-radius: 2rpx;/.test(s.mgrWxss) &&
      !/\.chart-empty-hint \{[^}]*#4A4540/i.test(s.mgrWxss) && !/\.footer-cn \{[^}]*#4a4640/i.test(s.mgrWxss))
  // 2026-10-18 产品负责人真机：权限配置「编辑权限」滑不动。遮罩 catchtouchmove 会吞掉 view 的 overflow 滚动 ——
  // 弹窗正文必须是 <scroll-view scroll-y>（docs/弹层视觉规范：长内容用 scroll-view）。唯一豁免：回复评价（正文只有一个 textarea，不需要滚）
  {
    const viewBodies = ['permWxml', 'approvalsWxml', 'payslipAdminWxml', 'wsSubviewsWxml', 'petSheetWxml'].flatMap((k) =>
      [...s[k].matchAll(/<view class="modal-body[^"]*"/g)].filter((m) => !/comment-reply-panel[\s\S]{0,400}$/.test(s[k].slice(0, m.index))).map(() => k))
    add(`R31-1 工作台弹窗正文为 scroll-view（遮罩 catchtouchmove 下 view 滑不动）${viewBodies.length ? '（仍为 view：' + viewBodies.join(',') + '）' : ''}`,
      viewBodies.length === 0)
    add('R31-2 权限配置弹窗：正文限高 + 左右 4rpx 不裁描边、底栏去抽屉卡底；两份样式（manager / extra）同写',
      [s.permWxss, s.permMgrWxss].every((t) => /\n\.modal-body \{\s*flex: 1 1 auto;\s*min-height: 0;\s*max-height: calc\(100vh - 600rpx\);\s*padding: 24rpx 4rpx 16rpx;/.test(t) &&
        /\n\.modal \.workbench-modal-foot \{[^}]*background: transparent;/.test(t)))
  }
  add('R32-1 股东配置：档案卡方角发丝框、比例格发丝账格（仍 48.5%）、口径说明改左金线注记、输入框定高 border-box',
    /\n\.card \{[^}]*border-radius: 4rpx;/.test(s.shCfgWxss) && /\n\.ratio-cell \{[^}]*width: 48\.5%;/.test(s.shCfgWxss) &&
      /\n\.ratio-cell \{[^}]*border-radius: 2rpx;/.test(s.shCfgWxss) && /\n\.formula-card \{[^}]*border-left: 2rpx solid/.test(s.shCfgWxss) &&
      /\n\.input \{[^}]*height: 80rpx;[^}]*box-sizing: border-box;/.test(s.shCfgWxss))
  // 2026-10-18 审批中心驳回面板（前端旁路：提交口径仍是 manageApprovals reject + rejectReason 字符串）
  {
    let rr = {}
    try { const m = { exports: {} }; new Function('module', 'exports', s.apReasons)(m, m.exports); rr = m.exports } catch (e) { rr = {} }
    const okFns = typeof rr.reasonsFor === 'function' && typeof rr.composeReason === 'function'
    const claim = okFns ? rr.reasonsFor('points_receipt_claim') : []
    const unknown = okFns ? rr.reasonsFor('nope') : []
    add('R33-1 驳回常用原因：按类型给 ≤5 枚、未知类型只给通用一条；快选 + 补充说明以「；」拼接，空即空',
      okFns && claim.length === 5 && claim[0] === '小票照片看不清' && unknown.length === 1 &&
        Object.values(rr.BY_TYPE || {}).every((list) => list.length <= 4) &&
        rr.composeReason(['甲', ' 乙 '], ' 丙 ') === '甲；乙；丙' && rr.composeReason([], '  ') === '' && rr.composeReason(null, '丁') === '丁')
    add('R33-2 驳回走自绘面板（不再系统 editable 弹窗）：快选 / 补充 / 预览齐全，必填类型拦 <2 字；提交仍为 reject + rejectReason',
      !/editable: true/.test(s.apJs) && /rejectSheet\.show/.test(s.apWxml) && /bindtap="onRejectReasonTap"/.test(s.apWxml) &&
        /bindinput="onRejectNoteInput"/.test(s.apWxml) && /\{\{rejectSheet\.preview\}\}/.test(s.apWxml) && /bindtap="confirmReject"/.test(s.apWxml) &&
        /sheet\.requireReason && reason\.length < 2/.test(s.apJs) &&
        /action: 'reject',\s*approvalId: id,\s*rejectReason: reason \|\| '已驳回'/.test(s.apJs))
  }
  // 2026-10-18 小惊喜「馆印」：完成时刻盖一方朱印（纯前端、尊重减弱动效）
  add('R34-1 入馆券出纸完成（mintFinished）盖「入馆」朱印，减弱动效下直接静止显示',
    /<view class="tm-seal \{\{mintFinished \? 'is-stamped' : ''\}\}"/.test(s.bookingWxml) &&
      /\.tm-seal\.is-stamped \{ animation: tm-seal-stamp/.test(s.bookingWxss) &&
      /prefers-reduced-motion[\s\S]*\.tm-seal\.is-stamped \{ animation: none;/.test(s.bookingWxss))
  add('R34-2 审批：只有本次进页后亲手办结过才盖「审毕」（首次打开就空不盖），三种办结都计数',
    (s.apWxml.match(/wx:if="\{\{viewMode === 'inbox' && sessionDecided > 0\}\}"/g) || []).length === 2 && /sessionDecided: 0,/.test(s.apJs) &&
      (s.apJs.match(/sessionDecided: this\.data\.sessionDecided \+ 1/g) || []).length === 3 &&
      /prefers-reduced-motion[^{]*\{\s*\.clear-seal \{ animation: none; \}/.test(s.apWxss))
  add('R34-3 店长 / 超管待处理清零盖小朱印「清」（方框宋体，不与红色数字角标混淆）',
    /<view class="hub-clear-seal" aria-hidden="true"><text>清<\/text><\/view>/.test(s.mgrWxml) &&
      /\n\.hub-clear-seal \{[^}]*border-radius: 4rpx;/.test(s.mgrHubNavWxss))
  // 2026-10-18 仪式感：考勤打孔卡 / 门店清单开馆·闭馆（纯前端派生，不改 manageStaffWorkspace）
  {
    let pc = {}
    try { const m = { exports: {} }; new Function('module', 'exports', s.punchJs)(m, m.exports); pc = m.exports } catch (e) { pc = {} }
    let weekOk = false
    try {
      const now = new Date(2026, 9, 18, 15, 0) // 周日
      const recs = [
        { _id: '1', type: 'in', status: 'on_time', clockAt: new Date(2026, 9, 13, 9, 1) },
        { _id: '2', type: 'out', status: 'early', clockAt: new Date(2026, 9, 13, 20, 0) },
        { _id: '5', type: 'in', status: 'on_time', clockAt: new Date(2026, 9, 18, 9, 0) },
        { _id: '3', type: 'in', status: 'late', clockAt: new Date(2026, 9, 18, 10, 0) },
        { _id: '4', type: 'in', status: 'on_time', clockAt: new Date(2026, 9, 6, 9, 0) }
      ]
      const w = pc.buildWeek(pc.mergeRecords(recs.slice(0, 3), recs.slice(2)), now)
      weekOk = w.length === 7 && w[0].day === 12 && w[6].isToday && w[1].in === 'ok' && w[1].out === 'warn' &&
        w[6].in === 'ok' && w.every((c) => !c.isFuture) && pc.weekSummary(w) === '本周出勤 2 天 · 迟到早退 1 次' &&
        pc.weekSummary(pc.buildWeek([], now)) === '' && pc.buildWeek(null, now).length === 7
    } catch (e) { weekOk = false }
    add('R35-1 打孔卡：周一起算 7 格、上孔上班下孔下班、同孔准时优先、跨周记录不进卡、按 _id 去重、汇总文案',
      weekOk && /justPunched: type/.test(s.attJs) && /class="punch-hole \{\{c\.in\}\} \{\{c\.isToday && justPunched === 'in' \? 'just' : ''\}\}"/.test(s.attWxml))
    add('R35-2 门店清单：本页亲手勾完才播开馆 / 闭馆动画（进页已完成 = 静态终态），减弱动效下直接终态',
      /const justDone = shiftStatus === 'done' && this\.data\.shiftStatus !== 'done'/.test(s.todoJs) &&
        /ceremony: shiftStatus === 'done' \? ceremonyOf\(this\.data\.shift\) : '',\s*ceremonyLive: false,/.test(s.todoJs) && /class="ceremony \{\{ceremony\}\} \{\{ceremonyLive \? 'is-live' : ''\}\}"/.test(s.todoWxml) &&
        /prefers-reduced-motion[\s\S]*\.ceremony\.is-live \.cer-lamp \{ animation: none; \}/.test(s.todoWxss))
  }
  // 2026-10-18 产品负责人点名「做强下单主流程与礼赠流程仪式感」—— 稳定期模块，只动展示层：
  // 跳转去向、payForOrder / manageGift 调用与 success 语义不变（下面同时锁住，防止「顺手」改了流程）
  add('R36-1 支付成功「已入藏」标本签：仅普通单（确认中 / 礼赠单仍 toast）、遮罩用 ui-pop-mask、三条跳转去向不变',
    /const paidRite = !pending && !this\.data\.isGiftOrder/.test(s.coJs) &&
      /\} else \{\s*wx\.showToast\(\{\s*title: pending \? '支付确认中' : '支付成功'/.test(s.coJs) &&
      /\}, paidRite \? 1700 : 1200\)/.test(s.coJs) &&
      /url: `\/subpackages\/feature\/gift\/success\/index\?orderId=\$\{result\.orderId\}`/.test(s.coJs) &&
      /url: `\/subpackages\/business\/pickup-pass\/index\?id=\$\{encodeURIComponent\(result\.orderId\)\}`/.test(s.coJs) &&
      /url: '\/subpackages\/business\/orders\/index\?type=paid'\n/.test(s.coJs) &&
      /<view class="ui-pop-mask is-center is-deep paid-rite" wx:if="\{\{paidRite\.show\}\}"/.test(s.coWxml) &&
      /prefers-reduced-motion[\s\S]*\.paid-seal \{ animation: none; \}/.test(s.coWxss))
  add('R36-2 礼笺「已收」朱印：两条收下路径都点亮、只给收礼人、落右上角不压落款；manageGift accept 调用不变',
    (s.rcvJs.match(/acceptStampLive: true/g) || []).length === 2 && /acceptStampLive: false,/.test(s.rcvJs) &&
      /class="accept-seal \{\{acceptStampLive \? 'is-live' : ''\}\}" wx:if="\{\{accepted && !isSender\}\}"/.test(s.rcvWxml) &&
      /\n\.accept-seal \{[^}]*top: 36rpx;/.test(s.rcvWxss) &&
      /action: 'accept',\s*token: this\.data\.token,\s*orderId: this\.data\.orderId/.test(s.rcvJs))
  // 送礼人回执印：只在「对方已收下 / 已留址 / 已到店领取」三态；本机首次落印，之后静态；送礼人状态文案与 manageGift 出参不变
  {
    let rcpt = null
    try {
      const store = {}
      const wxMock = { getStorageSync: (k) => store[k], setStorageSync: (k, v) => { store[k] = v } }
      const src = (s.rcvJs.match(/const RECEIPT_PHASES[\s\S]*?\nfunction senderReceiptOf[\s\S]*?\n\}\n/) || [''])[0]
      rcpt = new Function('wx', `${src}; return senderReceiptOf`)(wxMock)
    } catch (e) { rcpt = null }
    const first = rcpt && rcpt('address_done', 'o1')
    const again = rcpt && rcpt('address_done', 'o1')
    const other = rcpt && rcpt('claimed', 'o2')
    const waiting = rcpt && rcpt('waiting_open', 'o3')
    add('R37-1 送礼人回执印「已收」：收下 / 留址 / 到店领取三态才盖，同一订单本机只首次落印，等待态仍是「待」',
      !!rcpt && first.senderReceipt && first.senderReceiptLive && again.senderReceipt && !again.senderReceiptLive &&
        other.senderReceiptLive && !waiting.senderReceipt && !waiting.senderReceiptLive &&
        /\.\.\.sender,\s*\.\.\.receipt\s*\}\)/.test(s.rcvJs) &&
        /senderTitle: '对方已留下去处'/.test(s.rcvJs) && /senderTitle: '对方已到店领取'/.test(s.rcvJs) &&
        /<block wx:if="\{\{senderReceipt\}\}"><text class="receipt-ch">已<\/text><text class="receipt-ch">收<\/text><\/block>/.test(s.rcvWxml))
  }
  // 2026-10-18 仪式感：鉴定结果打字机（只在刚鉴定完）/ 自取码柜台当场核销落印
  {
    let tw = null
    try { tw = runSpeciesTypewriter(s.spcJs) } catch (e) { tw = null }
    add('R38-1 鉴定结果打字机：刚鉴定完学名从空逐字敲到全文、敲完才填置信度；同一学名不重打；非刚鉴定直接全文',
      !!tw && tw.start.latinShown === '' && tw.start.latinTyping && !tw.start.confReady && tw.start.inkIn &&
        tw.end.latinShown === 'Morpho helena' && !tw.end.latinTyping && tw.end.confReady &&
        !tw.again.latinTyping && tw.again.latinShown === 'Morpho helena' &&
        tw.plain.latinShown === 'Papilio maackii' && !tw.plain.latinTyping && tw.plain.confReady && !tw.plain.inkIn &&
        /url \+= '&fresh=1'/.test(s.identifyJs) && /if \(options\.fresh === '1'\) this\.setData\(\{ typewriter: true \}\)/.test(s.identifyResultJs) &&
        /style="width: \{\{confReady \? confPct : 0\}\}%;"/.test(s.spcWxml) && /<view class="specimen-plate" bindtap="skipTyping">/.test(s.spcWxml))
    add('R38-2 自取码：只有亲眼看着柜台核销（announceClaimed）才落印，历史已核销静态；水印锚点不动',
      /announceClaimed\(\) \{\s*\/\/[^\n]*\n\s*this\.setData\(\{ claimLive: true \}\);/.test(s.pickupJs) &&
        (s.pickupJs.match(/claimLive: true/g) || []).length === 1 &&
        /<view class="pass-qr-frame \{\{claimLive \? 'is-live' : ''\}\}">/.test(s.pickupWxml) &&
        /class="pass-qr-stamp" wx:if="\{\{pass\.statusTone === 'done'\}\}" aria-hidden="true">已自提</.test(s.pickupWxml))
  }
  // 2026-10-18 阅读仪式 + 反馈回执（产品负责人「继续看还有哪些模块，方向，动线可做微创新和优化」）
  {
    let rm = {}
    try { const m = { exports: {} }; new Function('module', 'exports', s.artMetaJs)(m, m.exports); rm = m.exports } catch (e) { rm = {} }
    let ok = false
    try {
      ok = rm.estimateReadMinutes('<p>' + '蝶'.repeat(1200) + '</p>') === 3 && rm.estimateReadMinutes('') === 0 &&
        rm.estimateReadMinutes('<style>' + 'a'.repeat(5000) + '</style><p>短</p>') === 1 && rm.plainTextOf('<b>甲</b>&nbsp;乙') === '甲乙' &&
        rm.progressOf(500, 1500, 500) === 0.5 && rm.progressOf(0, 400, 600) === 1 && rm.progressOf(2000, 1500, 500) === 1 && rm.progressOf(-5, 1500, 500) === 0
    } catch (e) { ok = false }
    add('R40-1 文章阅读：预计时长 / 进度纯函数正确；读到末尾且滚动过才盖「读毕」、只盖一次；离页断开观察；日期为空不留孤点',
      ok && /if \(!res \|\| !\(res\.intersectionRatio > 0\) \|\| this\.data\.readDone \|\| !this\._scrolled\) return/.test(s.artJs) &&
        /onUnload\(\) \{\s*if \(this\._readObserver\) this\._readObserver\.disconnect\(\)/.test(s.artJs) &&
        /<view class="read-end-row" wx:if="\{\{readDone\}\}">/.test(s.artWxml) &&
        /<block wx:if="\{\{article\.createTime\}\}"><text class="meta-divider">•<\/text>/.test(s.artWxml))
    add('R40-2 反馈回执单：提交成功出纸质回执（编号取 ticketId 尾 6 位）+「已收」印，遮罩用 ui-pop-mask，去向仍是山海有信',
      /no: `FB-\$\{String\(result\.ticketId \|\| ''\)\.slice\(-6\)\.toUpperCase\(\) \|\| '------'\}`/.test(s.fbJs) &&
        /url: '\/subpackages\/extra\/user\/messages\/index\?category=system'/.test(s.fbJs) &&
        /<view class="ui-pop-mask is-center is-deep fb-receipt-mask" wx:if="\{\{receipt\.show\}\}"/.test(s.fbWxml))
  }
  // 2026-10-18 方向池 ★★★（产品负责人「继续按照优先级推进」；🔒 标本旅程 / 入藏卡已获点名，只做展示层）
  add('R41-1 来信拆信：只在第一次展示未读纸信时拆封（日报不拆、两次回调不重播）；点信封可跳过；离页清定时器；列表信封记号只给顾客纸信',
    /if \(!this\._unsealDecided\) \{\s*this\._unsealDecided = true;\s*if \(wasUnread && !isDigest\) this\.playUnseal\(\);/.test(s.msgDetailJs) &&
      /onUnload\(\) \{\s*\(this\._unsealTimers \|\| \[\]\)\.forEach\(clearTimeout\);/.test(s.msgDetailJs) &&
      /<view class="unseal-envelope" wx:if="\{\{unsealing && unsealing !== 'done'\}\}" bindtap="skipUnseal">/.test(s.msgDetailWxml) &&
      /class="env-mark \{\{item\.isUnread \? 'is-sealed' : 'is-opened'\}\}" wx:if="\{\{item\.isPaper && !workflowMode && activeQueue === 'customer'\}\}"/.test(s.msgListWxml))
  {
    const cs = loadCjs(s.certSealJs)
    let ok = false
    try {
      const st = memStorage()
      const a = cs.applySeals([{ _id: 'c1' }, { _id: 'c2' }], st)
      const b = cs.applySeals([{ _id: 'c3' }, { _id: 'c1' }, { _id: 'c2' }], st)
      cs.markUnsealed('c3', st)
      const c = cs.applySeals([{ _id: 'c3' }, { _id: 'c1' }], st)
      ok = a.every((x) => !x.sealed) && b[0].sealed && !b[1].sealed && !b[2].sealed && c.every((x) => !x.sealed)
    } catch (e) { ok = false }
    add('R41-2 证书火漆：首次进页老证书不封；之后新签发的才封；启封即记、不重封；掰开后才进证书',
      ok && /if \(i >= 0 && all\[i\]\.sealed\) \{[\s\S]*?markUnsealed\(id, wx(?:, [^;]+)?\);[\s\S]*?this\.openCert\(id\);[\s\S]*?return;\s*\}\s*this\.openCert\(id\);/.test(s.certJs) &&
        /<view class="c-wax \{\{item\.breaking \? 'is-breaking' : ''\}\}" wx:if="\{\{item\.sealed\}\}"/.test(s.certWxml))
  }
  {
    const vr = loadCjs(s.vrJs)
    let ok = false
    try {
      const st = memStorage()
      vr.record(st, 'v1', 134.6, 600, 1)
      const r1 = vr.resumeOf(st, 'v1')
      vr.record(st, 'v1', 597, 600, 2)
      const r2 = vr.resumeOf(st, 'v1')
      vr.record(st, 'v2', 3, 600, 3)
      ok = vr.fmtClock(134) === '02:14' && vr.fmtClock(3725) === '1:02:05' &&
        r1 && r1.t === 134 && r1.label === '02:14' && r1.pct === 22 && r2 === null && vr.resumeOf(st, 'v2') === null &&
        vr.worthKeeping(50, 0) && !vr.worthKeeping(4, 0)
    } catch (e) { ok = false }
    add('R41-3 视频续播：5 秒以上且未到结尾才记、看完即清；播放页一键续播；影像列表读同一个本机 KEY',
      ok && vr.KEY === 'video_resume_v1' && /const RESUME_KEY = 'video_resume_v1'/.test(s.videosJs) &&
        /bindtimeupdate="onVideoTime"/.test(s.artWxml) && /<view class="video-resume" wx:if="\{\{videoResumeAt\}\}" bindtap="resumeVideo"/.test(s.artWxml) &&
        /onVideoEnd\(\) \{[\s\S]{0,120}videoResume\.clear\(wx, this\.data\.article\._id\)/.test(s.artJs) &&
        /wx:if="\{\{item\.resumeLabel\}\}"/.test(s.videosWxml))
  }
  {
    const jn = loadCjs(s.journeyJs)
    let ok = false
    try {
      const pending = jn.buildJourney({ status: 'paid' })
      const ship = jn.buildJourney({ status: 'shipped', createTime: '2026-10-10T10:00:00', logistics: { carrier: '顺丰速运', shipTime: '2026-10-11T09:05:00' } })
      const recv = jn.buildJourney({ status: 'received', logistics: {}, receiveTime: '2026-10-13T15:30:00' })
      ok = pending.length === 0 && ship.map((x) => x.state).join() === 'done,done,now,todo' && ship[1].sub === '交 顺丰速运 承运' &&
        ship[1].time === '10.11 09:05' && recv[3].state === 'done' && recv[3].time === '10.13 15:30' && recv[1].sub === '已交承运'
    } catch (e) { ok = false }
    add('R41-4 标本旅程 + 入藏卡（🔒 点名）：四站只读现有字段；「已达」只在亲手签收那一刻落印；入藏卡不给送礼人，遮罩用 ui-pop-mask',
      ok && (s.odJs.match(/arriveLive: true/g) || []).length === 1 &&
        /if \(this\.data\.order\.status === 'received' && this\.data\.certRole !== 'giver'\) \{/.test(s.odJs) &&
        /class="sj-stamp \{\{arriveLive \? 'is-live' : ''\}\}" wx:if="\{\{item\.key === 'arrive' && item\.state === 'done'\}\}"/.test(s.odWxml) &&
        /<view class="ui-pop-mask is-center is-deep archive-card-mask" wx:if="\{\{archiveCard\.show\}\}"/.test(s.odWxml) &&
        /confirmReceiptOnOrder\(this\.data\.order\._id, orderSnapshot(?:, \{ prompt: !willShowCard \})?\)/.test(s.odJs))
  }
  {
    const ls = loadCjs(s.leaveSpanJs)
    let ok = false
    try {
      const a = ls.buildSpan('2026-10-16', '09:00', '2026-10-18', '13:00')
      ok = a.days === 2.5 && a.label === '共 2.5 天' && a.cells.map((c) => c.fill).join() === 'full,full,half' && a.cells[1].weekend && !a.cells[0].weekend &&
        ls.buildSpan('2026-10-16', '14:00', '2026-10-16', '18:00').days === 0.5 &&
        ls.buildSpan('2026-10-16', '19:00', '2026-10-16', '20:00').label === '不足半天' &&
        ls.buildSpan('2026-10-17', '09:00', '2026-10-16', '18:00') === null &&
        ls.buildSpan('2026-10-01', '09:00', '2026-10-20', '18:00').cells.length === 14 && ls.buildSpan('2026-10-01', '09:00', '2026-10-20', '18:00').more === 6
    } catch (e) { ok = false }
    add('R41-5 请假天数：每天按 09:00–18:00 覆盖折半天 / 一天，周末照算只标出，起止颠倒给「起止有误」，日历条最多 14 格',
      ok && /<text class="duration-value">\{\{span \? span\.label : '起止有误'\}\}<\/text>/.test(s.leaveWxml))
  }
  {
    const rl = loadCjs(s.reimLedgerJs)
    let ok = false
    try {
      const st = memStorage()
      const now = new Date(2026, 9, 18)
      const rows = [
        { _id: 'r1', status: 'approved', amount: 1200.5, createTime: new Date(2026, 9, 3) },
        { _id: 'r2', status: 'pending', amount: 80, createTime: new Date(2026, 9, 9) },
        { _id: 'r3', status: 'approved', amount: 999, createTime: new Date(2026, 8, 30) }
      ]
      const sum = rl.monthSummary(rows, now)
      const first = rl.applyStamps(rows, st)
      const later = rl.applyStamps(rows.concat([{ _id: 'r4', status: 'approved', amount: 5 }]), st)
      const again = rl.applyStamps(rows.concat([{ _id: 'r4', status: 'approved', amount: 5 }]), st)
      ok = sum.month === 10 && sum.count === 2 && sum.approvedText === '1,200.50' && sum.pendingText === '80.00' &&
        first.every((r) => !r.stampLive) && first[0].stamped && !first[1].stamped &&
        later[3].stampLive && !later[0].stampLive && !again[3].stampLive && again[3].stamped
    } catch (e) { ok = false }
    add('R41-6 报销账页：本月已通过 / 审核中合计；已通过盖「核准」（不写「已入账」，通过≠已打款）；只在本机第一次看到时落印',
      ok && /aria-hidden="true">核准<\/view>/.test(s.reimWxml) && !/已入账/.test(s.reimWxml))
  }
  // 2026-10-18 方向池 ★★（产品负责人「继续按方向池推进剩下的 ★★ 项」；🔒 写礼笺在上轮点名范围内，只做展示层）
  {
    const lit = loadCjs(s.achLitJs)
    let ok = false
    try {
      const st = memStorage()
      const a = lit.takeFreshLit(['a1', 'a2'], st, 'u1')
      const b = lit.takeFreshLit(['a1', 'a2', 'a3'], st, 'u1')
      const c = lit.takeFreshLit(['a1', 'a2', 'a3'], st, 'u1')
      ok = a.length === 0 && b.join() === 'a3' && c.length === 0
    } catch (e) { ok = false }
    add('R42-1 成就新点亮射灯：本机首次进页不播；之后只给新点亮的那枚扫一次光',
      ok && /class="node \{\{node\.unlocked \? 'is-lit' : ''\}\} \{\{node\.fresh \? 'is-fresh' : ''\}\}"/.test(s.achWxml) && /takeFreshLit\(normalized\.filter\(\(a\) => a\.unlocked\)/.test(s.achJs))
  }
  add('R42-2 档案完成度：补全一项、分数涨了才弹「+N%」（降分不弹；初次载入不走这条）',
    /const gain = \(parseInt\(score, 10\) \|\| 0\) - \(parseInt\(this\.data\.profileScore, 10\) \|\| 0\)\s*\n\s*if \(gain > 0\) this\.bumpScore\(gain\)/.test(s.pfJs) &&
      /<text class="pf-score-bump" wx:if="\{\{scoreBump\}\}"/.test(s.pfWxml))
  add('R42-3 社区发布：成功后出「入展」展签（写明审核去向），去向仍是社区页；遮罩用 ui-pop-mask',
    /<view class="ui-pop-mask is-center is-deep exhibit-mask" wx:if="\{\{exhibitTag\.show\}\}"/.test(s.pubWxml) &&
      /wx\.redirectTo\(\{ url: '\/subpackages\/feature\/community\/index\?from=publish' \}\)/.test(s.pubJs) && !/title: '已提交审核'/.test(s.pubJs))
  {
    let fn = null
    try { fn = new Function(`${(s.careSpecJs.match(/function companionDaysOf[\s\S]*?\n\}\n/) || [''])[0]}; return companionDaysOf`)() } catch (e) { fn = null }
    let ok = false
    try {
      const now = new Date(2026, 9, 18, 10)
      ok = fn({ receiveTime: new Date(2026, 9, 18, 23) }, now) === 1 && fn({ receiveTime: new Date(2026, 6, 11, 9) }, now) === 100 &&
        fn({ updateTime: new Date(2026, 6, 11) }, now) === 0 && fn({ receiveTime: 'bad' }, now) === 0
    } catch (e) { ok = false }
    add('R42-4 养护「陪伴第 N 天」：只认真实签收时间、签收当天算第 1 天（打孔卡无养护记录可依，按此落地）',
      ok && /wx:if="\{\{item\.companionDays > 0\}\}"/.test(s.careMyWxml))
  }
  {
    const hg = loadCjs(s.homeGreetJs)
    let ok = false
    try {
      const st = { name: '主店', hours: { open: '10:00', close: '21:00' } }
      const at = (h, m) => new Date(2026, 9, 18, h, m)
      ok = hg.buildHomeGreeting(st, at(8, 0)).line === '主店 10:00 开馆，先逛逛线上馆藏' && hg.buildHomeGreeting(st, at(8, 0)).word === '早上好' &&
        hg.buildHomeGreeting(st, at(15, 0)).line === '主店营业中，开到 21:00' && hg.buildHomeGreeting(st, at(20, 30)).line === '主店营业中，21:00 闭馆，还来得及' &&
        hg.buildHomeGreeting(st, at(22, 0)).line === '主店已闭馆，明天 10:00 见' && hg.buildHomeGreeting({ name: '主店' }, at(15, 0)).line === ''
    } catch (e) { ok = false }
    add('R42-5 首页馆员问候：时段 + 开馆前 / 营业中 / 临近闭馆 / 已闭馆；没有营业时间只问候、不报营业状态',
      ok && /<view class="home-greet" wx:if="\{\{homeGreeting\.word\}\}">/.test(s.homeWxml) && /homeGreeting: buildHomeGreeting\(store\),/.test(s.homeJs))
  }
  add('R42-6 写礼笺封缄（🔒 只做展示）：交付时与 paying 同一次 setData 落火漆，跳转仍同步（不延时）；点卡面拆封',
    /this\.setData\(\{ paying: true, letterSealed: true \}\)/.test(s.gcJs) && !/setTimeout\(\(\) => \{?\s*navigateToConfirmOrder/.test(s.gcJs) &&
      /unsealLetter\(\) \{\s*if \(this\.data\.letterSealed\) this\.setData\(\{ letterSealed: false \}\)/.test(s.gcJs) &&
      /<view class="card-seal" wx:if="\{\{letterSealed\}\}"/.test(s.gcWxml) && /bindtap="unsealLetter"/.test(s.gcWxml))
  add('R42-7 发货封条：已发货及之后贴封条；只在本页亲手点「已发货」那一刻落贴，开 / 关详情都复位',
    /sealLive: status === 'shipped',/.test(s.shipJs) && (s.shipJs.match(/sealLive: false/g) || []).length >= 3 &&
      /class="ops-seal-tape \{\{sealLive \? 'is-live' : ''\}\}" wx:if="\{\{detail\.status === 'shipped' \|\| detail\.status === 'received' \|\| detail\.status === 'completed'\}\}"/.test(s.shipWxml))
  {
    const dd = loadCjs(s.dayDeltaJs)
    let ok = false
    try {
      const f = (n) => `F${n}`
      const up = dd.dayVsYesterday([{ total: 1 }, { total: 100 }, { total: 112 }], f)
      const down = dd.dayVsYesterday([{ total: 200 }, { total: 150 }], f)
      const zero = dd.dayVsYesterday([{ total: 0 }, { total: 80 }], f)
      const flat = dd.dayVsYesterday([{ total: 50 }, { total: 50 }], f)
      ok = up.dayDeltaText === '较昨日 ↑12%' && up.dayDeltaClass === 'up' && up.todayFmt === 'F112' && down.dayDeltaText === '较昨日 ↓25%' &&
        zero.dayDeltaText === '昨日无营收' && flat.dayDeltaText === '较昨日持平' && dd.dayVsYesterday([], f).todayFmt === ''
    } catch (e) { ok = false }
    add('R42-8 店长看板「今日 · 较昨日」：同一份 7 日数据现算（不另打云端），昨日为 0 不给百分比',
      ok && /\.\.\.require\('\.\.\/utils\/dayDelta'\)\.dayVsYesterday\(days, /.test(s.mgrCfgJs))
  }
  {
    let same = false
    try {
      const grab = (src, name) => new Function(`${(src.match(new RegExp(`function ${name}\\(hour\\) \\{[\\s\\S]*?\\n\\}\\n`)) || [''])[0]}; return ${name}`)()
      const a = grab(s.staffHubJs, 'greetWordByHour')
      const b = grab(s.mgrCfgJs, 'greetByHour')
      same = Array.from({ length: 24 }, (_, h) => h).every((h) => a(h) === b(h))
    } catch (e) { same = false }
    add('R42-9 店员工作台问候与店长首页 greetByHour 逐时段一致', same)
  }
  // 2026-10-19 产品负责人「正在铸造改为正在打印，打印机动画参考预约打印与代金券打印」
  add('R43-1 证书加载：文案「正在打印专属证书…」，同款打印机（顶杆 + 出纸口 + 三灯）循环出纸 + 往复进度条；不再是转圈 / 「铸造」',
    /<text class="mint-txt">正在打印专属证书…<\/text>/.test(s.certPageWxml) && !/铸造/.test(s.certPageWxml.replace(/<!--[\s\S]*?-->/g, '')) &&
      /<view class="cp-machine">[\s\S]*?<view class="cp-slot"><\/view>[\s\S]*?<view class="cp-lights">/.test(s.certPageWxml) &&
      /animation: cp-feed 3\.2s [^;]*infinite;/.test(s.certPageWxss) && !/mint-spinner/.test(s.certPageWxml))
  add('R11-3 鉴定台实心金只有「拍照鉴定」一处',
    // 只数「实心块」：进度条 / 步骤线 / 扫描线是细线，不算实心金
    [...s.identifyWxss.matchAll(/\n(\.[^{\n]+) \{([^}]*)\}/g)]
      .filter((m) => /background: var\(--brass-400\)/.test(m[2]) && !/progress|step-line|scan/.test(m[1]))
      .map((m) => m[1].trim()).join('|') === '.btn.primary')

  // R2-2 搜索：相关推荐图片失败退回占位块；标签不再重复「换个词试试」
  const relImgs = s.searchWxml.match(/wx:if="\{\{item\.image && !item\.imgBroken\}\}"[\s\S]*?binderror="onRelatedImgError"/g) || []
  add('R2-2 搜索相关卡两处图片都有 binderror 并按 imgBroken 退占位',
    relImgs.length === 2 && /imgBroken`\]: true/.test(methodBody(s.searchJs, 'onRelatedImgError')))
  add('R2-2 搜索相关区标签为「相近线索」', /<text class="related-label">相近线索<\/text>/.test(s.searchWxml))

  // R2-3 详情页底部主操作与加载失败按钮有按压态（view 上 :active 真机不可靠）
  const pressed = (src, re) => /hover-class="[\w-]+"/.test(openTag(src, re))
  add('R2-3 商品详情底部 CTA（加购/立即购买/到货通知/定金）都有 hover-class',
    ['add-cart-btn', 'buy-now-btn', 'wishlist-cta', 'deposit-cta'].every((c) => pressed(s.detailWxml, new RegExp(`<view\\s+class="${c}\\b(?![^>]*cta-skel)`))))
  add('R2-3 详情 / 档案 / 文章 / 鉴定结果的加载失败按钮都有 hover-class',
    [s.detailWxml, s.wikiWxml, s.articleWxml].every((src) => {
      const tags = src.match(/<view class="load-error-btn[^>]*>/g) || []
      return tags.length === 2 && tags.every((t) => /hover-class=/.test(t))
    }) && (((/<view class="load-error-actions">([\s\S]*?)<\/view>\n  <\/view>/.exec(s.identifyResultWxml) || [])[1] || '').match(/<view class="act [^>]*>/g) || []).filter((t) => /hover-class=/.test(t)).length === 4)
  add('R2-3 档案页底部「立即购买」有 hover-class', pressed(s.wikiWxml, /<view class="bottom-buy"/))

  // R3-1 商品详情 SKU 面板：规格 / 数量 / 确认 / 关闭都有按压态；「数量」标签与步进器同一水平线；关闭热区放大
  const tagsWith = (src, re) => [...src.matchAll(/<(?:view|text)\b/g)]
    .map((m) => openTag(src.slice(m.index), /^</))
    .filter((t) => re.test(t))
  add('R3-1 SKU 规格 pill（selectDimension / selectSku）都有 hover-class',
    ['selectDimension', 'selectSku'].every((h) => { const t = tagsWith(s.detailWxml, new RegExp(`bindtap="${h}"`)); return t.length === 1 && /hover-class=/.test(t[0]) }))
  add('R3-1 SKU 数量 ± / 确认 / 两处 ✕ 都有 hover-class',
    tagsWith(s.detailWxml, /bindtap="changeBuyCount"/).filter((t) => /hover-class=/.test(t)).length === 2 &&
    tagsWith(s.detailWxml, /bindtap="confirmSkuAction"/).every((t) => /hover-class=/.test(t)) &&
    // 2026-10-13 弹层规范：礼券抽屉的 ✕ 改为全局 ui-pop-close —— 判据改按两个关闭回调各自的 ✕ 计（意图不变）
    ['closeSkuSheet', 'closeCouponSheet'].every((h) => tagsWith(s.detailWxml, new RegExp(`class="(?:sku-close|ui-pop-close)" bindtap="${h}"`)).some((t) => /hover-class=/.test(t))))
  add('R3-1 「数量」标签去掉下边距（与步进器垂直居中）、SKU 头部 ✕ 热区放大',
    /\.qty-section \.sku-label \{ margin-bottom: 0; \}/.test(s.detailWxss) && /\.sku-head \.sku-close \{[^}]*padding: 24rpx;/.test(s.detailWxss))

  // R3-2 优惠券 / 退款说明 / 海报弹层按钮有按压态；已领取的券按钮不给按压反馈
  add('R3-2 礼券领取（已领取为 none）/ 礼券夹 / 立即购买 / 知道了 / 海报关闭都有 hover-class',
    /bindtap="claimCoupon"[\s\S]{0,160}?hover-class="\{\{item\.claimed \? 'none' : 'cta-press'\}\}"/.test(s.detailWxml) &&
    ['goToCoupons', 'buyNowWithCoupon', 'closeRefundSheet"', 'closePosterModal'].every((h) => tagsWith(s.detailWxml, new RegExp(`class="(?:[^"]*\\s)?(?:coupon-link-btn|coupon-buy-btn|refund-sheet-btn|close-icon-out)" bindtap="${h.replace('"', '')}"`)).some((t) => /hover-class=/.test(t))))
  add('R3-2 详情吸顶 tab 三项都有 hover-class', tagsWith(s.detailWxml, /bindtap="scrollToSection"/).filter((t) => /hover-class=/.test(t)).length === 3)

  // R3-3 专题档案页：价格带 ¥、0 阅读 0 收藏不展示、画廊与关联藏品有按压态
  add('R3-3 专题档案页关联藏品价格带 ¥ 且无价不画', /<text class="p-price" wx:if="\{\{item\.price\}\}">¥\{\{item\.price\}\}<\/text>/.test(s.cdWxml))
  add('R3-3 专题档案页阅读 / 收藏均为 0 时整行不画', /<view class="stats-row" wx:if="\{\{wiki\.stats\.views \|\| wiki\.stats\.likes\}\}">/.test(s.cdWxml))
  add('R3-3 专题档案页画廊 / 关联藏品 / 返回 + 图鉴卡两处返回链接有 hover-class',
    ['previewGallery', 'goToProduct', 'goBack'].every((h) => tagsWith(s.cdWxml, new RegExp(`bindtap="${h}"`)).every((t) => /hover-class=/.test(t))) &&
    tagsWith(s.atlasWxml, /bindtap="goAtlas"/).every((t) => /hover-class=/.test(t)) &&
    (s.atlasWxml.match(/bindtap="goAtlas" hover-class="tap-press"/g) || []).length === 2)

  // R3-4 搜索「清空最近搜索」走样式化 AppModal（不再是白底系统弹窗）
  add('R3-4 搜索页清空历史走 this.modal、页面 withAppModal 包裹、宿主已挂且已注册',
    !/wx\.showModal/.test(s.searchJs) && /await this\.modal\(/.test(methodBody(s.searchJs, 'clearHistory')) &&
    /\nPage\(withAppModal\(\{/.test(s.searchJs) && /<app-modal id="appModal" \/>/.test(s.searchWxml) && /"app-modal": "\/components\/AppModal\/index"/.test(s.searchJson))

  // R4-1 共享按压态：全局 tap-press / tap-press-soft（!important 压过页面 :active 特异性）；主包页面不再自带「只调透明度」的 -press 类
  add('R4-1 app.wxss 定义 tap-press(+wb-press 别名) 0.72 / tap-press-soft 0.86，均 !important',
    /\n\.tap-press, \.wb-press \{ opacity: 0\.72 !important; \}/.test(s.appWxss) && /\n\.tap-press-soft \{ opacity: 0\.86 !important; \}/.test(s.appWxss))
  const localPress = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => /^\s*opacity:\s*[\d.]+;?\s*$/.test(m[2]) && m[1].split(',').every((x) => /^\.[\w-]+-press$/.test(x.trim())))
  add('R4-1 主包五页（首页/馆藏/工坊/购物车/我的）无本页「只调透明度」的 -press 类',
    ['homeWxss', 'catWxss', 'atelierWxss', 'cartWxss', 'userWxss'].every((k) => localPress(s[k]).length === 0))

  // R4-2 共享骨架：工作台类骨架统一为 ui-sk-card / ui-sk-line（脉动不闪光）
  add('R4-2 app.wxss 定义 ui-sk-card / ui-sk-line（wide/title/bar）与 ui-sk-pulse',
    ['.ui-sk-card {', '.ui-sk-line {', '.ui-sk-line.wide {', '.ui-sk-line.title {', '.ui-sk-line.bar {', '@keyframes ui-sk-pulse {'].every((x) => s.appWxss.includes('\n' + x)))

  // R4-3 说明文字最低用 secondary（muted 在深色面仅 2.7–3.1:1）；占位提示保留 muted
  const colorOf = (css, sel) => ((new RegExp(`\\n\\${sel} \\{[^}]*?[;\\s{]color: ([^;]+);`).exec(css)) || [])[1]
  const SEC = 'var(--color-text-secondary)'
  add('R4-3 工坊 / 馆藏 / 鉴定 / 详情的说明字改用 secondary',
    ['.intro-overline', '.tile-overline', '.section-overline', '.order-tile-desc'].every((x) => colorOf(s.atelierWxss, x) === SEC) &&
    // 第 10 轮：馆藏区头改全站 .mu-head，「左滑更多 · N 篇 / N 件」由 app.wxss .mu-act-muted 承载（判据不变：说明字 = secondary）
    colorOf(s.catWxss, '.nav-sub') === SEC && colorOf(s.appWxss, '.mu-act-muted') === SEC && colorOf(s.appWxss, '.mu-sub') === SEC &&
    colorOf(s.identifyWxss, '.ai-privacy-txt') === SEC &&
    // 2026-10-13 弹层规范：详情礼券抽屉空态改用全局 .ui-pop-empty（判据不变：说明字 = secondary）
    ['.gift-panel-sub', '.gift-scene-label', '.param-k'].every((x) => colorOf(s.detailWxss, x) === SEC) &&
    /\n\.ui-pop-empty \{[^}]*color: var\(--color-text-secondary\);/.test(s.appWxss))
  // 2026-10-19 产品负责人「继续优化馆藏页顶部筛选器样式」
  add('R4-5 馆藏品类一行横滑（不再折行），切换时选中项滑入视野；档案横滑去掉压边圆点，改「04 / 13」+ 细进度线',
    /<scroll-view scroll-x class="category-scroll"[^>]*scroll-into-view="\{\{hallIntoView\}\}"/.test(s.catWxml) &&
      /id="hall-\{\{index\}\}"/.test(s.catWxml) && /hallIntoView: `hall-\$\{Math\.max\(0, idx - 1\)\}`/.test(s.catJs) &&
      /\.category-wrap \{ display: inline-flex; flex-wrap: nowrap;/.test(s.catWxss) &&
      !/indicator-dots="\{\{contentTotal > 1\}\}"/.test(s.catWxml) && /class="archive-progress"/.test(s.catWxml))
  add('R4-3 馆藏搜索占位提示保留 muted（占位不属于说明字）', /^var\(--color-text-muted/.test(colorOf(s.catWxss, '.search-placeholder') || ''))

  // R5-1 首页恰好一屏：容器 100vh 纵向 flex 且裁切，顶部占位 + 滚动区（flex:1）+ 底栏让位 = 视口；不再「占位 + 满屏滚动区」叠高
  const rule = (css, sel) => ((new RegExp(`\\n\\${sel} \\{([^}]*)\\}`).exec(css)) || [])[1] || ''
  const ct = rule(s.homeWxss, '.container'), ms = rule(s.homeWxss, '.main-scroll')
  add('R5-1 首页 .container 为 100vh 纵向 flex、overflow hidden，底部仍让出 --tabbar-offset',
    /height: 100vh;/.test(ct) && /display: flex;/.test(ct) && /flex-direction: column;/.test(ct) && /overflow: hidden;/.test(ct) && /padding-bottom: var\(--tabbar-offset\);/.test(ct))
  add('R5-1 首页滚动区 flex:1 + height:0 吃剩余高度，不再写死 100vh 系高度（含单页模式）',
    /flex: 1;/.test(ms) && /height: 0;/.test(ms) && !/100vh/.test(ms) && !/\.is-single-page \.main-scroll\s*\{/.test(s.homeWxss))
  add('R5-1 首页整页错误态同样吃剩余高度（flex:1）', /flex: 1;/.test(rule(s.homeWxss, '.page-error')))

  // R6 规格大图按原图比例：swiper 动态高度 + aspectFit；禁止固定高 + aspectFill 裁切
  const slideImg = openTag(s.detailWxml, /<image\b(?:[^>"']|"[^"]*"|'[^']*')*?class="detail-spec-slide"/)
  const swiperTag = openTag(s.detailWxml, /<swiper\b(?:[^>"']|"[^"]*"|'[^']*')*?class="detail-spec-swiper/)
  const slideCss = rule(s.detailWxss, '.detail-spec-slide')
  const swiperCss = rule(s.detailWxss, '.detail-spec-swiper')
  add('R6 规格大图不用 aspectFill（禁止裁切）', slideImg && !/\bmode="aspectFill"/.test(slideImg))
  add('R6 规格大图用 aspectFit 完整展示 + bindload 量原图比例', /\bmode="aspectFit"/.test(slideImg) && /bindload="onSpecImageLoad"/.test(slideImg) && /data-src="\{\{item\}\}"/.test(slideImg))
  add('R6 规格 swiper 用 specSwiperH 动态定高', /specSwiperH/.test(swiperTag) && /specSwiperH \? 'height: ' \+ specSwiperH \+ 'px/.test(swiperTag))
  add('R6 .detail-spec-slide 高度跟 swiper（100%），不再写死 rpx', /height: 100%;/.test(slideCss) && !/\d+rpx/.test(slideCss))
  add('R6 .detail-spec-swiper 有 height 过渡，加载前有 is-loading 脉动', /transition: height /.test(swiperCss) && /\.detail-spec-swiper\.is-loading/.test(s.detailWxss))
  add('R6 SPEC_RATIO_MIN/MAX + onSpecImageLoad/syncSpecSwiperHeight 存在',
    /const SPEC_RATIO_MIN = 0\.5/.test(s.detailJs) && /const SPEC_RATIO_MAX = 1\.25/.test(s.detailJs) &&
    /onSpecImageLoad\(e\)/.test(s.detailJs) && /syncSpecSwiperHeight\(\)/.test(s.detailJs))

  // R7 详情底栏：定制 / 送 TA 不再占底栏；加购与立即购买的事件保持原样
  const bottomBar = ((/<view class="bottom-bar[\s\S]*?\n  <\/view>/.exec(s.detailWxml) || [])[0]) || ''
  add('R7 底栏不再同时出现定制与送 TA',
    bottomBar && !/定制/.test(bottomBar) && !/送 TA/.test(bottomBar) && !/class="custom-btn"/.test(bottomBar) && !/class="gift-btn"/.test(bottomBar))
  add('R7 加购物车与立即购买仍在底栏，事件仍是 handleBuy / handleBuyNow',
    /class="add-cart-btn"[^>]*bindtap="handleBuy"/.test(bottomBar) &&
    /class="buy-now-btn"[^>]*bindtap="handleBuyNow"/.test(bottomBar))
  // 2026-10-12 详情页质感：「送给 TA」与下方「作为礼物」面板重复 → 送礼入口只留面板（一键送礼 → goGiftCompose，场景 chip → goGiftScene）
  add('R7 定制在信息区仍走 goToCustom（不支持则不显示）；送礼入口唯一 = 「作为礼物」面板，信息区不再重复「送给 TA」',
    /class="offer-link"[\s\S]{0,80}bindtap="goToCustom"[\s\S]{0,80}hover-class="tap-press"/.test(s.detailWxml) &&
    /supportsCustom !== false/.test(s.detailWxml) &&
    />定制</.test(s.detailWxml) &&
    !/>送给 TA</.test(s.detailWxml) &&
    /<view class="gift-panel" wx:if="\{\{product\.giftEligible !== false\}\}">/.test(s.detailWxml) &&
    /class="gift-cta" bindtap="goGiftCompose"/.test(s.detailWxml))
  add('R7 底栏两个购买按钮等宽且不换行',
    /flex:\s*1 1 0;/.test(rule(s.detailWxss, '.add-cart-btn')) &&
    /flex:\s*1 1 0;/.test(rule(s.detailWxss, '.buy-now-btn')) &&
    /flex-wrap:\s*nowrap;/.test(rule(s.detailWxss, '.bottom-bar')) &&
    /white-space:\s*nowrap;/.test(rule(s.detailWxss, '.btn-sub')))

  // R10 单色金图标只许一条品牌金滤镜链（2026-10-13 产品负责人真机：详情底栏图标仍偏黄 —— 第二次出现「两套金」，补守卫）
  //     旧亮黄链实测 (223,183,20)、旧近似链 (204,177,135)；品牌链 Chrome 实测 (198,168,108) ≈ #C4A76C
  {
    const OLD = ['invert(76%) sepia(66%) saturate(709%) hue-rotate(356deg)', 'invert(72%) sepia(28%) saturate(380%) hue-rotate(358deg)']
    const BRAND = 'invert(72%) sepia(14%) saturate(1004%) hue-rotate(2deg)'
    const byPath = { [FILES.detailWxss]: s.detailWxss, [FILES.appWxss]: s.appWxss }
    const hits = []
    const walk = (dir) => {
      for (const n of readdirSync(join(MP, dir))) {
        const rel = dir ? `${dir}/${n}` : n
        if (/node_modules|cloudfunctions|^scripts$|^docs$/.test(rel)) continue
        if (statSync(join(MP, rel)).isDirectory()) { walk(rel); continue }
        if (!rel.endsWith('.wxss')) continue
        const src = byPath[rel] != null ? byPath[rel] : readFileSync(join(MP, rel), 'utf8')
        if (OLD.some((o) => src.includes(o))) hits.push(rel)
      }
    }
    walk('')
    add('R10 全站不再出现旧金色滤镜链（亮黄 / 偏浅近似）', hits.length === 0)
    add('R10 全局 .icon-gold 用品牌金链', /\n\.icon-gold \{[^}]*/.test(s.appWxss) && (/\n\.icon-gold \{([^}]*)\}/.exec(s.appWxss) || [])[1].includes(BRAND))
    if (hits.length) console.error('  旧链：' + hits.join(' / '))
  }

  // R11 界面文字不出现开发术语（2026-10-13 产品负责人「清理技术型文字说明」）：全站 wxml 可见文本禁云函数 / 服务端 / 幂等 / 字段 / 云库 / 回调 / 部署 / JSON / fileID / cloud:// / payload / schema
  //     openid 仅允许作为「微信编号（openid）」这类粘贴提示出现，不在禁词内；祈福墙 / 心愿签由并发流负责，不扫
  {
    const BAN = /云函数|服务端|幂等|字段|云库|回调|部署|JSON|fileID|cloud:\/\/|payload|schema/
    const SKIP = /wish-wall|wish-labels|WallFeed|WishWallEntry|plays\/|mp-html|node_modules|cloudfunctions|^scripts|^docs/
    const byPath = { [FILES.detailWxml]: s.detailWxml }
    const bad = []
    const walk = (dir) => {
      for (const n of readdirSync(join(MP, dir))) {
        const rel = dir ? `${dir}/${n}` : n
        if (SKIP.test(rel)) continue
        if (statSync(join(MP, rel)).isDirectory()) { walk(rel); continue }
        if (!rel.endsWith('.wxml')) continue
        const src = (byPath[rel] != null ? byPath[rel] : readFileSync(join(MP, rel), 'utf8')).replace(/<!--[\s\S]*?-->/g, '').replace(/<wxs[\s\S]*?<\/wxs>/g, '')
        for (const m of src.matchAll(/>([^<>]+)</g)) {
          const t = m[1].replace(/\{\{[^}]*\}\}/g, '').trim()
          if (BAN.test(t)) bad.push(`${rel}：${t.slice(0, 40)}`)
        }
      }
    }
    walk('')
    add('R11 界面文字不出现开发术语（云函数 / 服务端 / 字段 / 云库 …）', bad.length === 0)
    if (bad.length) console.error('  ' + bad.slice(0, 8).join('\n  '))
  }

  // R9 头图叠层必须压在头图层之上（2026-10-12 真机：.hero-wrapper .sb-wrap 曾为 z-index 6，渐隐 / 署名 / 张数全被头图盖住；
  //    离线预览把 sensitive-blur-gate 展平成普通 view，量不出这一层 —— 故按 wxss 里**最后一条**同选择器规则静态比对）
  {
    const zOf = (sel) => {
      const re = new RegExp('(?:^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g')
      let m, z = null
      while ((m = re.exec(s.detailWxss))) { const zm = /z-index:\s*(-?\d+)/.exec(m[1]); if (zm) z = Number(zm[1]) }
      return z
    }
    const base = zOf('.hero-wrapper .sb-wrap')
    const layers = ['.hero-overlay', '.hero-topshade', '.hero-credit', '.hero-seal', '.img-counter', '.hero-badge-stack'].map((k) => [k, zOf(k)])
    add('R9 头图叠层（渐隐 / 顶影 / 署名 / 方印 / 张数 / 带证）z-index 均高于头图层 .hero-wrapper .sb-wrap',
      base != null && layers.every(([, z]) => z != null && z > base))
    add('R9 罩层打开时叠层退场（署名 / 方印 / 张数 / 顶影 / 带证都带 !sensitiveVeiled）',
      ['hero-topshade', 'hero-credit', 'hero-seal', 'img-counter', 'hero-badge-stack'].every((c) =>
        new RegExp('<view class="' + c + '"[^\\n]*!sensitiveVeiled').test(s.detailWxml)))
  }

  // R8 横图铺成正方形；竖图仍是半屏居中裁切，高度切换有过渡
  add('R8 头图两处按 heroFit 显示，并用 bindload 量原比例',
    (s.detailWxml.match(/class="slide-image" mode="\{\{heroFit\}\}" bindload="onHeroImageLoad"/g) || []).length === 2)
  add('R8 头图高度跟 heroSwiperH，盒子有高度过渡',
    /heroSwiperH/.test(openTag(s.detailWxml, /<view class="hero-stage/)) &&
    /transition: height /.test(rule(s.detailWxss, '.hero-stage')) &&
    /<view class="hero-wrapper">/.test(s.detailWxml))
  add('R8 横图头图是正方形并居中铺满，竖图仍取半屏',
    /const HERO_VIEW_MIN = 0\.42/.test(s.detailJs) && /const HERO_VIEW_MAX = 0\.50/.test(s.detailJs) &&
    /\(HERO_VIEW_MIN \+ HERO_VIEW_MAX\) \/ 2/.test(s.detailJs) &&
    /ratio > 1 \? half : Math\.round\(w\)/.test(s.detailJs) &&
    /const heroFit = 'aspectFill'/.test(s.detailJs) &&
    /syncHeroHeight\(\)/.test(s.detailJs) && /onHeroImageLoad\(e\)/.test(s.detailJs))
  return out
}

function report(list) {
  for (const c of list) console.log(`${c.ok ? '✓' : '✗'} ${c.name}`)
  return list.every((c) => c.ok)
}

if (process.argv.includes('--selftest')) {
  const base = readAll()
  const baseOk = checks(base).every((c) => c.ok)
  const INJ = [
    ['首页 scroll-view 去掉下拉', 'homeWxml', (t) => t.replace(/\n    refresher-enabled="\{\{!isSinglePage\}\}"/, '')],
    ['下拉回调去掉防重入', 'homeJs', (t) => t.replace('if (this._refresherBusy) return;', '')],
    ['下拉回调去掉兜底收起', 'homeJs', (t) => t.replace('this._refresherTimer = setTimeout(done, 8000);', '')],
    ['onPullDownRefresh 不再返回 Promise', 'homeJs', (t) => t.replace('return this.initData().finally', 'this.initData().finally')],
    ['banner 副标题恢复「探索未知」占位', 'homeWxml', (t) => t.replace('<text class="h-sub" wx:if="{{item.subtitle}}">{{item.subtitle}}</text>', "<text class=\"h-sub\">{{item.subtitle || '探索未知'}}</text>")],
    ['专题简介恢复「点击查看详情」占位', 'homeWxml', (t) => t.replace('<text class="ec-brief text-cut" wx:if="{{item.brief}}">{{item.brief}}</text>', "<text class=\"ec-brief text-cut\">{{item.brief || '点击查看详情'}}</text>")],
    ['馆藏筛选空态去掉清除按钮', 'catWxml', (t) => t.replace(/\n\s*<view class="empty-filter-btn"[^\n]*<\/view>/, '')],
    ['馆藏 applied 改回 const（P0 原形）', 'catJs', (t) => t.replace('\n    let applied = {', '\n    const applied = {')],
    ['工坊进度磁贴去掉按压态', 'atelierWxml', (t) => t.replace('bindtap="goPetOrders" hover-class="order-tile-press" hover-stay-time="80"', 'bindtap="goPetOrders"')],
    ['鉴定步骤移回遮罩外', 'identifyWxml', (t) => t.replace(/\n      <view class="steps">[\s\S]*?\n      <\/view>/, '')],
    ['鉴定记录入口去按压态', 'identifyWxml', (t) => t.replace('bindtap="goLog" hover-class="recent-item-press" hover-stay-time="80"', 'bindtap="goLog"')],
    ['预约页头翻转票被推翻', 'bookingWxml', (t) => t.replace('<view class="ticket-face face-back">', '<view class="ticket-face">')],
    ['预约票翻面处理器丢失', 'bookingJs', (t) => t.replace('isFlipped: !this.data.isFlipped', 'isFlipped: false')],
    ['预约票水印回到 emoji', 'bookingWxml', (t) => t.replace('<text class="watermark">山海</text>', '<view class="watermark">🦋</view>')],
    ['门店地图塞回名片', 'storeWxml', (t) => t.replace('<view class="card-pin" aria-hidden="true"></view>', '<view class="card-pin" aria-hidden="true"></view><map class="info-map"></map>')],
    ['门店名片回到深色卡', 'storeWxss', (t) => t.replace('  background: linear-gradient(180deg, #F3ECDD, #E8DFCB);\n  box-shadow: 0 12rpx 28rpx', '  background: #1F1D1A;\n  box-shadow: 0 12rpx 28rpx')],
    ['签到浮钮回到实心金', 'storeWxss', (t) => t.replace('  background: #1F1D1A;\n  box-shadow: var(--ring-brass), 0 12rpx', '  background: var(--brass-400);\n  box-shadow: var(--ring-brass), 0 12rpx')],
    ['预览库忘了 map', 'previewLib', (t) => t.replace("map: 'div', ", '')],
    ['入馆券页头回到实心金带', 'ticketWxss', (t) => t.replace('.ticket-header {\n  padding: 44rpx 32rpx 8rpx;', '.ticket-header {\n  background: linear-gradient(135deg, #A8903C 0%, #C4A76C 100%);\n  padding: 44rpx 32rpx 8rpx;')],
    ['入馆券信号灯复活', 'ticketWxml', (t) => t.replace('<view class="live-dot"></view>', '<view class="signal-light blink"></view>')],
    ['自取已自提回到绿章', 'pickupWxss', (t) => t.replace('  border: 4rpx solid rgba(90, 78, 58, 0.85);', '  border: 4rpx solid rgba(82, 183, 136, 0.85);')],
    ['打印动画出纸被去掉', 'bookingWxss', (t) => t.replace('.ticket-paper.printing { height: 720rpx; }', '.ticket-paper.printing { }')],
    ['打印操作区回到底部绝对定位', 'bookingWxss', (t) => t.replace('.mint-bottom-area {\n  position: relative;', '.mint-bottom-area {\n  position: absolute;')],
    ['操作区让位不足压住出纸', 'bookingWxss', (t) => t.replace('margin-top: 748rpx;', 'margin-top: 640rpx;')],
    ['打印机实体被删', 'bookingWxml', (t) => t.replace('<view class="printer-slot"></view>', '')],
    ['打印动画不再触发', 'bookingJs', (t) => t.replace('this.setData({ mintAnimation: true });', 'this.setData({});')],
    ['定制说明段高度漂移', 'customWxss', (t) => t.replace('  height: 88rpx;\n  padding: 0 32rpx;', '  height: 96rpx;\n  padding: 0 32rpx;')],
    ['定制步骤条当前步回到实心金', 'customWxss', (t) => t.replace('.rail-dot.active { border-bottom-color: var(--brass-400); }', '.rail-dot.active {\n  background: var(--brass-400);\n}')],
    ['积分卡斜纹质感被改', 'pointsWxss', (t) => t.replace('background-size: 20rpx 20rpx;', 'background-size: 24rpx 24rpx;')],
    ['皮质钱包卡被改', 'walletLeather', (t) => t + '\n.wallet-leather-card { opacity: 0.98; }'],
    ['礼券临期回到警示橙', 'couponsWxss', (t) => t.replace('  color: var(--brass-200);\n  letter-spacing: 0.04em;', '  color: #E9A23B;\n  letter-spacing: 0.04em;')],
    ['兑换钮回到实心金药丸', 'pointsWxss', (t) => t.replace('font-size: var(--fs-22); color: var(--brass-200); background: rgba(196, 167, 108, 0.08);', 'font-size: var(--fs-22); color: #1A1814; background: var(--color-primary);')],
    ['留言提交回到实心金', 'supportWxss', (t) => t.replace('  background: transparent !important;\n  box-shadow: inset 0 0 0 2rpx #8B6F47;', '  background: var(--brass-400) !important;\n  box-shadow: inset 0 0 0 2rpx #8B6F47;')],
    ['联系方式回到圆角卡', 'supportWxss', (t) => t.replace('  padding: 28rpx 4rpx;\n  border-bottom: 1rpx solid rgba(196, 167, 108, 0.14);\n}\n\n.channel-info', '  padding: 28rpx 4rpx;\n  border-radius: 24rpx;\n  border-bottom: 1rpx solid rgba(196, 167, 108, 0.14);\n}\n\n.channel-info')],
    ['搜索结果回到圆角卡', 'searchWxss', (t) => t.replace('  padding: 24rpx 0;\n  border-bottom: 1rpx solid rgba(196, 167, 108, 0.14);\n  box-sizing: border-box;\n  overflow: hidden;', '  padding: 24rpx 0;\n  border-radius: 24rpx;\n  border-bottom: 1rpx solid rgba(196, 167, 108, 0.14);\n  box-sizing: border-box;\n  overflow: hidden;')],
    ['搜索签回到胶囊', 'searchWxss', (t) => t.replace('  min-height: 56rpx;\n  padding: 0;\n  border-radius: 2rpx;', '  min-height: 56rpx;\n  padding: 0;\n  border-radius: 9999px;')],
    ['主播职责回到大圆角卡', 'liveWxss', (t) => t.replace('  padding: 26rpx 8rpx;\n  border-bottom: 1rpx solid rgba(196, 167, 108, 0.14);', '  padding: 26rpx 8rpx;\n  border-radius: var(--radius-lg);\n  border-bottom: 1rpx solid rgba(196, 167, 108, 0.14);')],
    ['在播步骤丢了红色语义', 'liveWxss', (t) => t.replace('.flow-step-btn.on-air {\n  border-bottom-color: var(--color-error);', '.flow-step-btn.on-air {\n  border-bottom-color: var(--brass-400);')],
    ['标本师入口回到大圆角卡', 'artisanWxss', (t) => t.replace('  padding: 24rpx 4rpx;\n  border-bottom: 1rpx solid rgba(196, 167, 108, 0.14);', '  padding: 24rpx 4rpx;\n  border-radius: var(--radius-lg);\n  border-bottom: 1rpx solid rgba(196, 167, 108, 0.14);')],
    ['标本师作品卡回到大圆角', 'artWorks', (t) => t.replace('  padding: 22rpx 4rpx;\n  border-bottom', '  padding: 22rpx 4rpx;\n  border-radius: var(--radius-lg);\n  border-bottom')],
    ['概念卡回到深色铜牌', 'artConcept', (t) => t.replace('  background: linear-gradient(180deg, #F3ECDD, #E8DFCB);\n  box-shadow: 0 12rpx 28rpx rgba(0, 0, 0, 0.42);\n  color: #2E2618;', '  background: var(--color-bg-card);\n  box-shadow: 0 12rpx 28rpx rgba(0, 0, 0, 0.42);\n  color: #2E2618;')],
    ['采购商行内动作回到实心金', 'supplierCommon', (t) => t.replace('  background: rgba(196, 167, 108, 0.1);\n  box-shadow: var(--ring-brass);\n  color: var(--brass-200);\n  font-size: var(--fs-22);', '  background: var(--brass-500);\n  box-shadow: var(--ring-brass);\n  color: var(--brass-200);\n  font-size: var(--fs-22);')],
    ['加入采购车回到实心金药丸', 'buyCatalog', (t) => t.replace('  border-radius: 4rpx;\n  background: rgba(196, 167, 108, 0.1);\n  box-shadow: var(--ring-brass);\n  color: var(--brass-200);\n  font-size: var(--fs-24);', '  border-radius: 999rpx;\n  background: var(--brass-400);\n  box-shadow: var(--ring-brass);\n  color: var(--brass-200);\n  font-size: var(--fs-24);')],
    ['供应商管理分段回到胶囊', 'deskCommon', (t) => t.replace('.chip {\n  padding: 10rpx 22rpx;\n  border-radius: 2rpx;', '.chip {\n  padding: 10rpx 22rpx;\n  border-radius: 999rpx;')],
    ['股东观测台卡片回到大圆角', 'shareholderWxss', (t) => t.replace('.verdict-card {\n  background: var(--color-bg-card, #1F1D1A);\n  border: 1rpx solid var(--brass-800, #4D401A);\n  border-radius: 4rpx;', '.verdict-card {\n  background: var(--color-bg-card, #1F1D1A);\n  border: 1rpx solid var(--brass-800, #4D401A);\n  border-radius: var(--radius-lg, 24rpx);')],
    ['店员分区头回到中英同行', 'staffHubWxml', (t) => t.replace('<view class="group-head"><text class="group-en">{{item.en}}</text><text class="group-cn">{{item.title}}</text></view>', '<view class="panel-title sub">{{item.title}} / {{item.en}}</view>')],
    ['店员角标回到实心金', 'staffHubWxss', (t) => t.replace('  background: #1A1814;\n  box-shadow: var(--ring-brass);', '  background: var(--brass-400);\n  box-shadow: var(--ring-brass);')],
    ['店长常用回到金边盒', 'mgrHubNavWxss', (t) => t.replace('.hub-fav {\n  padding: 0;', '.hub-fav {\n  background: #262017;\n  border-radius: var(--radius-lg);\n  padding: 0;')],
    ['店长金卡回到大圆角', 'mgrWxss', (t) => t.replace('border-radius: 4rpx; padding: 40rpx;', 'border-radius: var(--radius-lg); padding: 40rpx;')],
    ['超管搜索框回到胶囊', 'mgrHubNavWxss', (t) => t.replace('border-radius: 4rpx;  /* 2026-10-18 视觉对齐：方角（原 40rpx 胶囊） */', 'border-radius: 40rpx;')],
    ['看板空态说明回到近黑灰', 'mgrWxss', (t) => t.replace('.chart-empty-hint { font-size: var(--fs-18); color: rgba(185, 173, 150, 0.75); }', '.chart-empty-hint { font-size: var(--fs-18); color: #4A4540; }')],
    ['权限配置正文退回 view', 'permWxml', (t) => t.replace('<scroll-view scroll-y enhanced show-scrollbar="{{false}}" class="modal-body">', '<view class="modal-body">')],
    ['伴宠工单弹层正文退回 view', 'petSheetWxml', (t) => t.replace('<scroll-view scroll-y class="modal-body pm-sheet-body">', '<view class="modal-body pm-sheet-body">')],
    ['权限配置正文贴边被裁', 'permMgrWxss', (t) => t.replace('  padding: 24rpx 4rpx 16rpx;', '  padding: 24rpx 0 16rpx;')],
    ['股东档案卡回到圆角', 'shCfgWxss', (t) => t.replace('  border: 1rpx solid rgba(196, 167, 108, 0.16);\n  border-radius: 4rpx;\n}\n.card-title', '  border: 1rpx solid rgba(196, 167, 108, 0.16);\n  border-radius: var(--radius-md);\n}\n.card-title')],
    ['驳回原因拼接丢了补充说明', 'apReasons', (t) => t.replace('  if (extra) parts.push(extra)\n', '')],
    ['驳回退回系统输入弹窗', 'apJs', (t) => t.replace("      approvePendingId: '',\n      ignorePendingId: '',\n      rejectSheet: {", "      approvePendingId: '',\n      editable: true,\n      ignorePendingId: '',\n      rejectSheet: {")],
    ['必填驳回不再拦空原因', 'apJs', (t) => t.replace('if (sheet.requireReason && reason.length < 2)', 'if (false)')],
    ['入馆印不再随出纸完成盖下', 'bookingWxml', (t) => t.replace("<view class=\"tm-seal {{mintFinished ? 'is-stamped' : ''}}\"", '<view class="tm-seal"')],
    ['审毕印对首次空列表也盖', 'apWxml', (t) => t.replace("wx:if=\"{{viewMode === 'inbox' && sessionDecided > 0}}\" aria-hidden", "wx:if=\"{{viewMode === 'inbox'}}\" aria-hidden")],
    ['驳回不再计入本轮', 'apJs', (t) => t.replace("expandedId: '', sessionDecided: this.data.sessionDecided + 1, tipTone: 'info', tipText: '已驳回'", "expandedId: '', tipTone: 'info', tipText: '已驳回'")],
    ['打孔卡同孔不再准时优先', 'punchJs', (t) => t.replace("    if (cell[slot] !== 'ok') cell[slot] = tone\n", '    cell[slot] = tone\n')],
    ['打孔卡周起点错成周日', 'punchJs', (t) => t.replace('today.getDate() - ((today.getDay() + 6) % 7)', 'today.getDate() - today.getDay()')],
    ['进页已完成也播开馆动画', 'todoJs', (t) => t.replace("ceremony: shiftStatus === 'done' ? ceremonyOf(this.data.shift) : '',\n        ceremonyLive: false,", "ceremony: shiftStatus === 'done' ? ceremonyOf(this.data.shift) : '',\n        ceremonyLive: true,")],
    ['礼赠单也弹入藏签（叠两次仪式）', 'coJs', (t) => t.replace('const paidRite = !pending && !this.data.isGiftOrder', 'const paidRite = !pending')],
    ['入藏仪式顺手改了跳转去向', 'coJs', (t) => t.replace("url: '/subpackages/business/orders/index?type=paid'\n", "url: '/subpackages/business/orders/index'\n")],
    ['凭礼笺收下不再盖已收', 'rcvJs', (t) => t.replace('this.setData({ accepted: true, holderCard: true, acceptStampLive: true })', 'this.setData({ accepted: true, holderCard: true })')],
    ['回执印每次进页都重播', 'rcvJs', (t) => t.replace('    if (live) wx.setStorageSync(key, 1)\n', '')],
    ['等待对方打开也盖已收', 'rcvJs', (t) => t.replace('const RECEIPT_PHASES = { waiting_address: true,', 'const RECEIPT_PHASES = { waiting_open: true, waiting_address: true,')],
    ['打字机不再等敲完才填置信度', 'spcJs', (t) => t.replace("this.setData({ latinShown: '', latinTyping: true, confReady: false, inkIn: true })", "this.setData({ latinShown: '', latinTyping: true, confReady: true, inkIn: true })")],
    ['打字机对同一学名重打', 'spcJs', (t) => t.replace(" || this._typedFor === latin) {", ") {")],
    ['从最近记录进也打字', 'identifyJs', (t) => t.replace("      url += '&fresh=1'\n", '')],
    ['历史已核销也落印', 'pickupJs', (t) => t.replace("      const closedNow = pass.statusTone === 'closed';", "      const closedNow = pass.statusTone === 'closed';\n      if (claimedNow) this.setData({ claimLive: true });")],
    ['短文一打开就盖读毕', 'artJs', (t) => t.replace(' || this.data.readDone || !this._scrolled) return', ' || this.data.readDone) return')],
    ['定制页标题行又让胶囊', 'customWxml', (t) => t.replace('<view class="nav-row">', '<view class="nav-row" style="padding-right: {{navPaddingRight}}px;">')],
    ['定制页顶距又含系统导航', 'customJs', (t) => t.replace('headerHeight: nav.headerHeight - nav.statusBarHeight - nav.navBarHeight + Math.round((nav.mottoHeight / 88) * 110),', 'headerHeight: nav.headerHeight,')],
    ['馆藏品类又折行', 'catWxss', (t) => t.replace('.category-wrap { display: inline-flex; flex-wrap: nowrap;', '.category-wrap { display: flex; flex-wrap: wrap;')],
    ['档案圆点回来', 'catWxml', (t) => t.replace('current="{{archiveIndex}}"', 'current="{{archiveIndex}}"\n          indicator-dots="{{contentTotal > 1}}"')],
    ['证书加载改回铸造', 'certPageWxml', (t) => t.replace('正在打印专属证书…', '正在铸造专属证书…')],
    ['证书纸只出一次不循环', 'certPageWxss', (t) => t.replace('animation: cp-feed 3.2s cubic-bezier(0.22, 0.82, 0.28, 1) infinite;', 'animation: cp-feed 3.2s cubic-bezier(0.22, 0.82, 0.28, 1) forwards;')],
    ['射灯首次进页全部重播', 'achLitJs', (t) => t.replace('const fresh = seen === null ? [] :', 'const fresh = seen === null ? ids :')],
    ['档案降分也弹', 'pfJs', (t) => t.replace('if (gain > 0) this.bumpScore(gain)', 'if (gain !== 0) this.bumpScore(gain)')],
    ['社区发布改回 toast', 'pubWxml', (t) => t.replace('exhibit-mask" wx:if="{{exhibitTag.show}}"', 'exhibit-mask" wx:if="{{false}}"')],
    ['陪伴天数拿创建时间兜底', 'careSpecJs', (t) => t.replace('const raw = order && order.receiveTime', 'const raw = order && (order.receiveTime || order.updateTime)')],
    ['首页问候缺营业时间也报营业中', 'homeGreetJs', (t) => t.replace("if (open == null || close == null) return { word, line: '' };", "if (open == null || close == null) return { word, line: `${name}营业中` };")],
    ['礼笺封缄改成延时跳转', 'gcJs', (t) => t.replace('    navigateToConfirmOrder([{', '    setTimeout(() => navigateToConfirmOrder([{')],
    ['封条打开详情不复位', 'shipJs', (t) => t.replace("      detailBusy: false,\n      sealLive: false\n", "      detailBusy: false\n")],
    ['较昨日除以 0', 'dayDeltaJs', (t) => t.replace('  if (yest <= 0) {', '  if (yest < 0) {')],
    ['工作台问候分段漂移', 'staffHubJs', (t) => t.replace("if (h >= 5 && h < 9) return '早安'", "if (h >= 5 && h < 10) return '早安'")],
    ['拆信每次回调都重播', 'msgDetailJs', (t) => t.replace('if (!this._unsealDecided) {\n      this._unsealDecided = true;', 'if (true) {\n      this._unsealDecided = true;')],
    ['首次进页老证书全被封上', 'certSealJs', (t) => t.replace('return rows.map((c) => ({ ...c, sealed: false }));', 'return rows.map((c) => ({ ...c, sealed: true }));')],
    ['续播看完不清', 'vrJs', (t) => t.replace('  else delete map[id]\n', '')],
    ['列表续播 KEY 写错', 'videosJs', (t) => t.replace("const RESUME_KEY = 'video_resume_v1'", "const RESUME_KEY = 'video_resume'")],
    ['旅程在途站不亮当前', 'journeyJs', (t) => t.replace("state: arrived ? 'done' : 'now'", "state: arrived ? 'done' : 'todo'")],
    ['入藏卡也给送礼人', 'odJs', (t) => t.replace("if (this.data.order.status === 'received' && this.data.certRole !== 'giver') {", "if (this.data.order.status === 'received') {")],
    ['请假周末被扣掉', 'leaveSpanJs', (t) => t.replace('    days += portion\n', "    if (d.getDay() !== 0 && d.getDay() !== 6) days += portion\n")],
    ['报销首次进页全部落印', 'reimLedgerJs', (t) => t.replace('const live = stamped && !first &&', 'const live = stamped &&')],
    ['报销印文写成已入账', 'reimWxml', (t) => t.replace('aria-hidden="true">核准</view>', 'aria-hidden="true">已入账</view>')],
    ['阅读时长把样式表字数也算进去', 'artMetaJs', (t) => t.replace(".replace(/<(style|script)[\\s\\S]*?<\\/\\1>/gi, '')\n", '')],
    ['反馈回执改了去向', 'fbJs', (t) => t.replace("url: '/subpackages/extra/user/messages/index?category=system'", "url: '/subpackages/extra/user/messages/index'")],
    ['投资观测台区间回到实心金', 'investorWxss', (t) => t.replace('.range-tab.on {\n  background: rgba(196, 167, 108, 0.08);', '.range-tab.on {\n  background: var(--brass-400, #C4A76C);')],
    ['预约分区头回到中英并列', 'bookingWxml', (t) => t.replace('<view class="section-label"><text class="sl-en">DATE</text><text class="sl-cn">选择日期</text></view>', '<view class="section-label">选择日期 | SELECT DATE</view>')],
    ['预览库回到 indexOf 找标签', 'previewLib', (t) => t.replace('const lt = nextTagStart(src, i)', "const lt = src.indexOf('<', i)")],
    ['取景框去掉忙时保护', 'identifyJs', (t) => t.replace('    if (this.data.busy) return\n    this.onTakePhoto()', '    this.onTakePhoto()')],
    ['最近鉴定缩略图去掉 binderror', 'identifyWxml', (t) => t.replace(' binderror="onRecentThumbError"', '')],
    ['鉴定台多一颗实心金', 'identifyWxss', (t) => t.replace('.album-link {\n', '.album-link {\n  background: var(--brass-400);\n')],
    ['搜索相关卡图片去掉 binderror', 'searchWxml', (t) => t.replace('binderror="onRelatedImgError"', '')],
    ['搜索相关标签改回「换个词试试」', 'searchWxml', (t) => t.replace('<text class="related-label">相近线索</text>', '<text class="related-label">换个词试试</text>')],
    ['立即购买去按压态', 'detailWxml', (t) => t.replace('bindtap="handleBuyNow" hover-class="tap-press" hover-stay-time="80"', 'bindtap="handleBuyNow"')],
    ['底栏重新放回定制', 'detailWxml', (t) => t.replace('<view class="add-cart-btn" bindtap="handleBuy"', '<view class="custom-btn"><text class="btn-sub">定制</text></view>\n      <view class="add-cart-btn" bindtap="handleBuy"')],
    ['立即购买改掉事件名', 'detailWxml', (t) => t.replace('bindtap="handleBuyNow"', 'bindtap="handleCheckout"')],
    ['头图退回一律裁切', 'detailWxml', (t) => t.replace(/mode="\{\{heroFit\}\}"/g, 'mode="aspectFill"')],
    ['头图比例上限被删', 'detailJs', (t) => t.replace('const HERO_VIEW_MAX = 0.50;', '')],
    ['横图退回上下留白', 'detailJs', (t) => t.replace("const heroFit = 'aspectFill'", "const heroFit = 'aspectFit'")],
    ['横图不再铺成正方形', 'detailJs', (t) => t.replace('ratio > 1 ? half : Math.round(w)', 'half')],
    ['定金按钮去按压态', 'detailWxml', (t) => t.replace('bindtap="handleDeposit"\n          hover-class="cta-press"\n          hover-stay-time="80"', 'bindtap="handleDeposit"')],
    ['文章加载失败返回按钮去按压态', 'articleWxml', (t) => t.replace('<view class="load-error-btn" bindtap="goBack" hover-class="tap-press" hover-stay-time="80">', '<view class="load-error-btn" bindtap="goBack">')],
    ['鉴定结果重新加载去按压态', 'identifyResultWxml', (t) => t.replace('<view class="act ghost" bindtap="retryLoad" hover-class="act-ghost-press" hover-stay-time="80">', '<view class="act ghost" bindtap="retryLoad">')],
    ['档案页立即购买去按压态', 'wikiWxml', (t) => t.replace(' hover-class="bottom-buy-press" hover-stay-time="80"', '')],
    ['SKU 规格 pill 去按压态', 'detailWxml', (t) => t.replace('              bindtap="selectDimension"\n              hover-class="cta-press"\n', '              bindtap="selectDimension"\n')],
    ['SKU 数量加号去按压态', 'detailWxml', (t) => t.replace('data-delta="1" hover-class="cta-press" hover-stay-time="80"', 'data-delta="1"')],
    ['SKU 确认去按压态', 'detailWxml', (t) => t.replace('bindtap="confirmSkuAction" hover-class="sku-confirm-press" hover-stay-time="80"', 'bindtap="confirmSkuAction"')],
    ['「数量」标签恢复下边距', 'detailWxss', (t) => t.replace('.qty-section .sku-label { margin-bottom: 0; }', '')],
    ['SKU ✕ 热区回到原大小', 'detailWxss', (t) => t.replace('.sku-head .sku-close { right: -16rpx; top: -16rpx; padding: 24rpx; }', '')],
    ['已领取礼券也给按压态', 'detailWxml', (t) => t.replace("hover-class=\"{{item.claimed ? 'none' : 'cta-press'}}\"", 'hover-class="cta-press"')],
    ['退款说明「知道了」去按压态', 'detailWxml', (t) => t.replace('bindtap="closeRefundSheet" hover-class="cta-press" hover-stay-time="80"', 'bindtap="closeRefundSheet"')],
    ['吸顶 tab 去按压态', 'detailWxml', (t) => t.replace('data-tab="review" hover-class="tap-press" hover-stay-time="80"', 'data-tab="review"')],
    ['专题档案价格丢 ¥', 'cdWxml', (t) => t.replace('<text class="p-price" wx:if="{{item.price}}">¥{{item.price}}</text>', '<text class="p-price">{{item.price}}</text>')],
    ['专题档案 0 阅读也画', 'cdWxml', (t) => t.replace('<view class="stats-row" wx:if="{{wiki.stats.views || wiki.stats.likes}}">', '<view class="stats-row">')],
    ['专题档案关联藏品去按压态', 'cdWxml', (t) => t.replace('bindtap="goToProduct" data-id="{{item._id}}" hover-class="tap-press" hover-stay-time="80"', 'bindtap="goToProduct" data-id="{{item._id}}"')],
    ['图鉴卡面包屑去按压态', 'atlasWxml', (t) => t.replace('<text class="crumb-link" bindtap="goAtlas" hover-class="tap-press" hover-stay-time="80">', '<text class="crumb-link" bindtap="goAtlas">')],
    ['搜索清空历史退回 wx.showModal', 'searchJs', (t) => t.replace('const res = await this.modal({', 'const res = await wx.showModal({')],
    ['搜索页漏挂 AppModal 宿主', 'searchWxml', (t) => t.replace('<app-modal id="appModal" />', '')],
    ['全局 tap-press 丢 !important', 'appWxss', (t) => t.replace('.tap-press, .wb-press { opacity: 0.72 !important; }', '.tap-press, .wb-press { opacity: 0.72; }')],
    ['首页回退本页 -press 类', 'homeWxss', (t) => t + '\n.probe-card-press { opacity: 0.86; }\n'],
    ['共享骨架丢 bar 行', 'appWxss', (t) => t.replace(/\n\.ui-sk-line\.bar \{[^\n]*/, '')],
    ['工坊卡片说明退回 muted', 'atelierWxss', (t) => t.replace(/(\n\.order-tile-desc \{[^}]*?color: )var\(--color-text-secondary\)/, '$1var(--color-text-muted)')],
    ['详情礼赠说明退回 muted', 'detailWxss', (t) => t.replace('.gift-panel-sub { font-size: var(--fs-22); color: var(--color-text-secondary); }', '.gift-panel-sub { font-size: 22rpx; color: var(--color-text-muted); }')],
    ['首页滚动区退回 calc(100vh - 底栏)', 'homeWxss', (t) => t.replace('.main-scroll {\n  flex: 1;\n  height: 0;', '.main-scroll {\n  height: calc(100vh - var(--tabbar-offset));')],
    ['首页容器去掉 100vh 裁切', 'homeWxss', (t) => t.replace('.container {\n  height: 100vh;\n', '.container {\n')],
    ['单页模式滚动区写回 100vh', 'homeWxss', (t) => t + '\n.container.is-single-page .main-scroll {\n  height: 100vh;\n}\n'],
    ['工坊描述超长（恢复截断原文）', 'atelierJs', (t) => t.replace("desc: '为陪伴过的伙伴留存纪念，专员评估工艺周期',", "desc: '为陪伴过你的伙伴留存纪念藏品，专员评估工艺与周期',")],
    ['规格大图退回 aspectFill', 'detailWxml', (t) => t.replace('class="detail-spec-slide"\n              src="{{imgView[item] || item}}"\n              mode="aspectFit"', 'class="detail-spec-slide"\n              src="{{imgView[item] || item}}"\n              mode="aspectFill"')],
    ['规格大图去掉 bindload', 'detailWxml', (t) => t.replace('\n              bindload="onSpecImageLoad"\n              data-src="{{item}}"', '')],
    ['规格 swiper 去掉动态高度', 'detailWxml', (t) => t.replace("style=\"{{specSwiperH ? 'height: ' + specSwiperH + 'px;' : ''}}\"\n          ", '')],
    ['规格 slide 写死 520rpx', 'detailWxss', (t) => t.replace('.detail-spec-slide {\n  width: 100%;\n  height: 100%;', '.detail-spec-slide {\n  width: 100%;\n  height: 520rpx;')],
    ['规格 swiper 去掉高度过渡', 'detailWxss', (t) => t.replace('border: 1px solid rgba(38, 35, 32, 0.9);\n  transition: height var(--dur-base) var(--ease-standard);', 'border: 1px solid rgba(38, 35, 32, 0.9);')],
    ['SPEC_RATIO_MAX 改掉', 'detailJs', (t) => t.replace('const SPEC_RATIO_MAX = 1.25;', '')],
    ['信息区又放「送给 TA」', 'detailWxml', (t) => t.replace('>定制</text>', '>定制</text>\n        <text class="offer-link" bindtap="goToGift">送给 TA</text>')],
    ['头图层又压过叠层（sb-wrap z-index 抬回 6）', 'detailWxss', (t) => t.replace('.hero-wrapper .sb-wrap {\n  z-index: 1;\n}', '.hero-wrapper .sb-wrap {\n  z-index: 6;\n}')],
    ['罩层打开时带证角标仍叠在罩层上', 'detailWxml', (t) => t.replace('wx:if="{{isProtected && !sensitiveVeiled}}"', 'wx:if="{{isProtected}}"')],
    ['详情底栏图标回到旧亮黄链', 'detailWxss', (t) => t.replace('brightness(0) saturate(100%) invert(72%) sepia(14%) saturate(1004%) hue-rotate(2deg) brightness(92%) contrast(92%)', 'brightness(0) saturate(100%) invert(76%) sepia(66%) saturate(709%) hue-rotate(356deg) brightness(93%) contrast(87%)')],
    ['全局 icon-gold 回到偏浅近似链', 'appWxss', (t) => t.replace('.icon-gold {\n  filter: brightness(0) saturate(100%) invert(72%) sepia(14%) saturate(1004%) hue-rotate(2deg) brightness(92%) contrast(92%);', '.icon-gold {\n  filter: brightness(0) saturate(100%) invert(72%) sepia(28%) saturate(380%) hue-rotate(358deg) brightness(96%) contrast(88%);')],
    ['详情页又写开发术语', 'detailWxml', (t) => t.replace('<text class="st-zh">藏品参数</text>', '<text class="st-zh">藏品参数（字段）</text>')],
    ['礼赠面板一键送礼不再直达写笺', 'detailWxml', (t) => t.replace('class="gift-cta" bindtap="goGiftCompose"', 'class="gift-cta" bindtap="goToGift"')],
  ]
  let ok = baseOk
  console.log(`${baseOk ? '✓' : '✗'} 基线：真源码全部断言通过`)
  for (const [name, key, fn] of INJ) {
    const mutated = { ...base, [key]: fn(base[key]) }
    if (mutated[key] === base[key]) { console.log(`✗ 注入锚点失效：${name}`); ok = false; continue }
    const red = checks(mutated).some((c) => !c.ok)
    console.log(`${red ? '✓' : '✗'} 注入「${name}」→ ${red ? '被检出' : '未检出'}`)
    if (!red) ok = false
  }
  console.log(ok ? '✓ selftest 通过' : '✗ selftest 失败')
  process.exit(ok ? 0 : 1)
}

const ok = report(checks(readAll()))
console.log(ok ? '✓ A 流细节雕刻断言全部通过' : '✗ A 流细节雕刻断言失败（见上）')
process.exit(ok ? 0 : 1)
