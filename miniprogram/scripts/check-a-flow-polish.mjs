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
  artisanWxss: 'subpackages/extra/artisan/index.wxss'
}
const readAll = () => Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, readFileSync(join(MP, p), 'utf8')]))

/** 取 Page 方法体：从 `  name(` 到下一个同缩进的方法头（按语法边界，不用固定长度；错题本 E7） */
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
  add('R12-4 预约成功的入馆券打印动画保留（打印机出纸 0→800rpx / 2.5s、进度条、扫描线，2.6s 后出操作区）',
    /<view class="mint-machine">[\s\S]*?<view class="printer-slot"><\/view>/.test(s.bookingWxml) &&
      /<view class="ticket-paper \{\{mintAnimation \? 'printing' : ''\}\}">/.test(s.bookingWxml) &&
      /class="scan-bar"/.test(s.bookingWxml) && /<view class="mint-progress"><view class="mp-bar"><\/view><\/view>/.test(s.bookingWxml) &&
      /\n\.ticket-paper \{[^}]*height: 0;[^}]*transition: height 2\.5s/.test(s.bookingWxss) && /\.ticket-paper\.printing \{ height: 800rpx; \}/.test(s.bookingWxss) &&
      /\.mp-bar \{[^}]*animation: bk-progress 2\.5s linear forwards/.test(s.bookingWxss) &&
      /\n\.mint-actions \{[^}]*opacity: 0;[^}]*2\.6s/.test(s.bookingWxss) &&
      /this\.setData\(\{ mintAnimation: true \}\);[\s\S]{0,80}\}, 100\);[\s\S]{0,40}setTimeout\(\(\) => \{\s*this\.setData\(\{ mintFinished: true \}\);[\s\S]{0,60}\}, 2600\);/.test(s.bookingJs))
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
    ['打印动画出纸被去掉', 'bookingWxss', (t) => t.replace('.ticket-paper.printing { height: 800rpx; }', '.ticket-paper.printing { }')],
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
