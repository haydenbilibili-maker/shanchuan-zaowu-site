#!/usr/bin/env node
/**
 * A 流（C 端浏览与发现动线）细节雕刻守卫 —— 钉住每轮打磨的交互 / 文案结论，防止后续改动悄悄退回
 * 台账：miniprogram/docs/细节雕刻_A流_2026-10.md（每条断言对应文档里的一项）
 *
 * 用法：
 *   node miniprogram/scripts/check-a-flow-polish.mjs
 *   node miniprogram/scripts/check-a-flow-polish.mjs --selftest   （内存注入，不写盘）
 */
import { readFileSync } from 'node:fs'
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
  wikiWxml: 'subpackages/feature/detail/wiki-detail/index.wxml',
  articleWxml: 'subpackages/feature/articles/detail/index.wxml',
  detailWxss: 'subpackages/feature/detail/index.wxss',
  searchJson: 'subpackages/feature/search/index.json',
  cdWxml: 'subpackages/content/collection-detail/index.wxml',
  atlasWxml: 'subpackages/feature/collection/detail/index.wxml'
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

  // R2-2 搜索：相关推荐图片失败退回占位块；标签不再重复「换个词试试」
  const relImgs = s.searchWxml.match(/wx:if="\{\{item\.image && !item\.imgBroken\}\}"[\s\S]*?binderror="onRelatedImgError"/g) || []
  add('R2-2 搜索相关卡两处图片都有 binderror 并按 imgBroken 退占位',
    relImgs.length === 2 && /imgBroken`\]: true/.test(methodBody(s.searchJs, 'onRelatedImgError')))
  add('R2-2 搜索相关区标签为「相近线索」', /<text class="related-label">相近线索<\/text>/.test(s.searchWxml))

  // R2-3 详情页底部主操作与加载失败按钮有按压态（view 上 :active 真机不可靠）
  const pressed = (src, re) => /hover-class="[\w-]+"/.test(openTag(src, re))
  add('R2-3 商品详情底部 CTA（加购/立即购买/定制/送 TA/到货通知/定金）都有 hover-class',
    ['add-cart-btn', 'buy-now-btn', 'custom-btn', 'gift-btn', 'wishlist-cta', 'deposit-cta'].every((c) => pressed(s.detailWxml, new RegExp(`<view\\s+class="${c}\\b(?![^>]*cta-skel)`))))
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
    tagsWith(s.detailWxml, /class="sku-close"/).filter((t) => /hover-class=/.test(t)).length === 2)
  add('R3-1 「数量」标签去掉下边距（与步进器垂直居中）、SKU 头部 ✕ 热区放大',
    /\.qty-section \.sku-label \{ margin-bottom: 0; \}/.test(s.detailWxss) && /\.sku-head \.sku-close \{[^}]*padding: 24rpx;/.test(s.detailWxss))

  // R3-2 优惠券 / 退款说明 / 海报弹层按钮有按压态；已领取的券按钮不给按压反馈
  add('R3-2 礼券领取（已领取为 none）/ 礼券夹 / 立即购买 / 知道了 / 海报关闭都有 hover-class',
    /bindtap="claimCoupon"[\s\S]{0,160}?hover-class="\{\{item\.claimed \? 'none' : 'cta-press'\}\}"/.test(s.detailWxml) &&
    ['goToCoupons', 'buyNowWithCoupon', 'closeRefundSheet"', 'closePosterModal'].every((h) => tagsWith(s.detailWxml, new RegExp(`class="(?:coupon-link-btn|coupon-buy-btn|refund-sheet-btn|close-icon-out)" bindtap="${h.replace('"', '')}"`)).some((t) => /hover-class=/.test(t))))
  add('R3-2 详情吸顶 tab 三项都有 hover-class', tagsWith(s.detailWxml, /bindtap="scrollToSection"/).filter((t) => /hover-class=/.test(t)).length === 3)

  // R3-3 专题档案页：价格带 ¥、0 阅读 0 收藏不展示、画廊与关联藏品有按压态
  add('R3-3 专题档案页关联藏品价格带 ¥ 且无价不画', /<text class="p-price" wx:if="\{\{item\.price\}\}">¥\{\{item\.price\}\}<\/text>/.test(s.cdWxml))
  add('R3-3 专题档案页阅读 / 收藏均为 0 时整行不画', /<view class="stats-row" wx:if="\{\{wiki\.stats\.views \|\| wiki\.stats\.likes\}\}">/.test(s.cdWxml))
  add('R3-3 专题档案页画廊 / 关联藏品 / 返回 + 图鉴卡两处返回链接有 hover-class',
    ['previewGallery', 'goToProduct', 'goBack'].every((h) => tagsWith(s.cdWxml, new RegExp(`bindtap="${h}"`)).every((t) => /hover-class=/.test(t))) &&
    tagsWith(s.atlasWxml, /bindtap="goAtlas"/).every((t) => /hover-class=/.test(t)) &&
    (s.atlasWxml.match(/bindtap="goAtlas" hover-class="link-press"/g) || []).length === 2)

  // R3-4 搜索「清空最近搜索」走样式化 AppModal（不再是白底系统弹窗）
  add('R3-4 搜索页清空历史走 this.modal、页面 withAppModal 包裹、宿主已挂且已注册',
    !/wx\.showModal/.test(s.searchJs) && /await this\.modal\(/.test(methodBody(s.searchJs, 'clearHistory')) &&
    /\nPage\(withAppModal\(\{/.test(s.searchJs) && /<app-modal id="appModal" \/>/.test(s.searchWxml) && /"app-modal": "\/components\/AppModal\/index"/.test(s.searchJson))
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
    ['搜索相关卡图片去掉 binderror', 'searchWxml', (t) => t.replace('binderror="onRelatedImgError"', '')],
    ['搜索相关标签改回「换个词试试」', 'searchWxml', (t) => t.replace('<text class="related-label">相近线索</text>', '<text class="related-label">换个词试试</text>')],
    ['立即购买去按压态', 'detailWxml', (t) => t.replace('bindtap="handleBuyNow" hover-class="buy-now-btn-press" hover-stay-time="80"', 'bindtap="handleBuyNow"')],
    ['定金按钮去按压态', 'detailWxml', (t) => t.replace('bindtap="handleDeposit"\n          hover-class="cta-press"\n          hover-stay-time="80"', 'bindtap="handleDeposit"')],
    ['文章加载失败返回按钮去按压态', 'articleWxml', (t) => t.replace('<view class="load-error-btn" bindtap="goBack" hover-class="load-error-btn-press" hover-stay-time="80">', '<view class="load-error-btn" bindtap="goBack">')],
    ['鉴定结果重新加载去按压态', 'identifyResultWxml', (t) => t.replace('<view class="act ghost" bindtap="retryLoad" hover-class="act-ghost-press" hover-stay-time="80">', '<view class="act ghost" bindtap="retryLoad">')],
    ['档案页立即购买去按压态', 'wikiWxml', (t) => t.replace(' hover-class="bottom-buy-press" hover-stay-time="80"', '')],
    ['SKU 规格 pill 去按压态', 'detailWxml', (t) => t.replace('              bindtap="selectDimension"\n              hover-class="cta-press"\n', '              bindtap="selectDimension"\n')],
    ['SKU 数量加号去按压态', 'detailWxml', (t) => t.replace('data-delta="1" hover-class="cta-press" hover-stay-time="80"', 'data-delta="1"')],
    ['SKU 确认去按压态', 'detailWxml', (t) => t.replace('bindtap="confirmSkuAction" hover-class="sku-confirm-press" hover-stay-time="80"', 'bindtap="confirmSkuAction"')],
    ['「数量」标签恢复下边距', 'detailWxss', (t) => t.replace('.qty-section .sku-label { margin-bottom: 0; }', '')],
    ['SKU ✕ 热区回到原大小', 'detailWxss', (t) => t.replace('.sku-head .sku-close { right: -16rpx; top: -16rpx; padding: 24rpx; }', '')],
    ['已领取礼券也给按压态', 'detailWxml', (t) => t.replace("hover-class=\"{{item.claimed ? 'none' : 'cta-press'}}\"", 'hover-class="cta-press"')],
    ['退款说明「知道了」去按压态', 'detailWxml', (t) => t.replace('bindtap="closeRefundSheet" hover-class="cta-press" hover-stay-time="80"', 'bindtap="closeRefundSheet"')],
    ['吸顶 tab 去按压态', 'detailWxml', (t) => t.replace('data-tab="review" hover-class="tab-item-press" hover-stay-time="80"', 'data-tab="review"')],
    ['专题档案价格丢 ¥', 'cdWxml', (t) => t.replace('<text class="p-price" wx:if="{{item.price}}">¥{{item.price}}</text>', '<text class="p-price">{{item.price}}</text>')],
    ['专题档案 0 阅读也画', 'cdWxml', (t) => t.replace('<view class="stats-row" wx:if="{{wiki.stats.views || wiki.stats.likes}}">', '<view class="stats-row">')],
    ['专题档案关联藏品去按压态', 'cdWxml', (t) => t.replace('bindtap="goToProduct" data-id="{{item._id}}" hover-class="cd-press" hover-stay-time="80"', 'bindtap="goToProduct" data-id="{{item._id}}"')],
    ['图鉴卡面包屑去按压态', 'atlasWxml', (t) => t.replace('<text class="crumb-link" bindtap="goAtlas" hover-class="link-press" hover-stay-time="80">', '<text class="crumb-link" bindtap="goAtlas">')],
    ['搜索清空历史退回 wx.showModal', 'searchJs', (t) => t.replace('const res = await this.modal({', 'const res = await wx.showModal({')],
    ['搜索页漏挂 AppModal 宿主', 'searchWxml', (t) => t.replace('<app-modal id="appModal" />', '')],
    ['工坊描述超长（恢复截断原文）', 'atelierJs', (t) => t.replace("desc: '为陪伴过的伙伴留存纪念，专员评估工艺周期',", "desc: '为陪伴过你的伙伴留存纪念藏品，专员评估工艺与周期',")]
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
