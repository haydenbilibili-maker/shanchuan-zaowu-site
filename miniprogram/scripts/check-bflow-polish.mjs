#!/usr/bin/env node
/**
 * B 流细节雕刻守卫（C 端交易与「我的」展示层）—— 产品负责人 2026-10-01「细节雕刻」。
 * 记录：miniprogram/docs/细节雕刻_B流_2026-10.md
 *
 * 只钉**展示层**里改过、且回退了顾客看得见的几件事（不碰契约 / 流程 / 金额）：
 *   B1 订单详情折扣：不得再用 `discountRate * 10` 拼「N折」（0.7×10 = 7.000000000000001），
 *      须用 js 里 formatDiscount 产出的 `order.discountText`；
 *   B2 订单详情账单区：用到的每个类名都必须在本页 wxss 里有定义
 *      （「已付定金抵扣」曾用了不存在的 `price-row` → 标签与金额挤成一团）；
 *   B3 支付防重入：订单列表 / 详情的 handlePay 在调 payForOrder 之前判「进行中」直接返回，
 *      并在 finally 里复位（否则一次失败后按钮永远卡在「支付中…」）；
 *   B4 失败提示不透原文：范围内页面的 toast / 失败副标题不得直接拼 `err.errMsg` / `err.message`
 *      （`navigateTo:fail …`、`cloud.callFunction:fail …` 会原样给到顾客）；
 *   B5 礼券门槛：购物车 / 确认下单弹层不得出现「满 0 可用」形态（无门槛券须写「无门槛」）；
 *   B6 订单列表卡片：不得用占位英文 `Specimen` 冒充学名（错题本 E11），缩略图缺图须有占位分支。
 *   ── 第 2 轮（「我的」子页）──
 *   B7 预约票：人数不得写死前导 0（`0{{bookCount}}` 在 10 人时成「010 人」），持票人缺省不写英文 Guest；
 *   B8 荣誉档案：加载中不显示「共收藏 0 件」，入场动画延迟有上限（证书多时最后一张要等数秒才出现）；
 *   B9 收货地址：默认地址卡不再出现「设为默认」，保存按钮有「保存中…」；
 *   B10 礼赠填址：提交中按钮文案切换（防「点了没反应」再点）。
 *   ── 第 3 轮（凭证 / 订单详情底栏 / 账户提交）──
 *   B11 预约票据：数据回来前不显示「该预约已不可核销」（须有加载分支），字段标签带中文；
 *   B12 订单详情底栏：btn-text / btn-main / hologram-btn 每一枚都挂 hover-class，且 *-press 类在 wxss 有定义
 *      （此前只靠 `:active`，真机 view 上不可靠）；
 *   B13 反馈 / 注册完成按钮有按压反馈（提交中不挂）。
 *
 * 自检不写盘：注入在内存副本上做（共享工作区有并行流，写盘注入会覆盖别人的在写内容）。
 *
 * 用法：
 *   node miniprogram/scripts/check-bflow-polish.mjs
 *   node miniprogram/scripts/check-bflow-polish.mjs --selftest
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const B = 'miniprogram/subpackages/business'

const F = {
  odWxml: `${B}/order-detail/index.wxml`,
  odWxss: `${B}/order-detail/index.wxss`,
  odJs: `${B}/order-detail/index.js`,
  ordersWxml: `${B}/orders/index.wxml`,
  ordersJs: `${B}/orders/index.js`,
  cartWxml: 'miniprogram/pages/cart/index.wxml',
  confirmWxml: `${B}/confirm-order/index.wxml`,
  bookingWxml: `${B}/booking/index.wxml`,
  certWxml: 'miniprogram/subpackages/extra/user/certificates/index.wxml',
  addrWxml: `${B}/address/index.wxml`,
  giftAddrWxml: 'miniprogram/subpackages/feature/gift/address/index.wxml',
  ticketWxml: `${B}/ticket/index.wxml`,
  ticketJs: `${B}/ticket/index.js`,
  feedbackWxml: 'miniprogram/subpackages/extra/user/feedback/index.wxml',
  onboardingWxml: 'miniprogram/subpackages/extra/user/onboarding/index.wxml'
}

/** B4 扫描范围（逐轮扩充；只加不减） */
const NO_RAW_ERROR_FILES = [
  F.ordersJs,
  F.odJs,
  `${B}/aftersale-apply/index.js`,
  `${B}/order-claim/index.js`,
  `${B}/logistics-track/index.js`,
  'miniprogram/pages/cart/index.js',
  `${B}/confirm-order/index.js`,
  F.ticketJs
]

const read = (f) => readFileSync(resolve(ROOT, f), 'utf8')
const stripJsComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

/** 取 Page 方法体：从 `  name(` / `  async name(` 到下一个同缩进方法头（语法边界 —— 错题本 E7） */
function methodBody(src, name) {
  const re = new RegExp(`\\n  (?:async )?${name}\\s*\\([^)]*\\)\\s*\\{`)
  const m = re.exec(src)
  if (!m) return ''
  const rest = src.slice(m.index + m[0].length)
  const next = /\n  (?:async )?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/.exec(rest)
  return next ? rest.slice(0, next.index) : rest
}

/** 取 wxml 里以 `class="<cls> …"` 开头的那个 view 块（按 <view>/</view> 配平） */
function viewBlock(wxml, cls) {
  const start = wxml.search(new RegExp(`<view[^>]*class="${cls}[\\s"]`))
  if (start < 0) return ''
  const re = /<view\b|<\/view>/g
  re.lastIndex = start
  let depth = 0
  let m
  while ((m = re.exec(wxml))) {
    depth += m[0] === '</view>' ? -1 : 1
    if (depth === 0) return wxml.slice(start, m.index + m[0].length)
  }
  return wxml.slice(start)
}

/** 静态类名（去掉 {{…}} 表达式后剩下的 token） */
function staticClasses(block) {
  const out = new Set()
  for (const m of block.matchAll(/class="([^"]*)"/g)) {
    for (const t of m[1].replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/)) if (t) out.add(t)
  }
  return out
}

function definedClasses(css) {
  const out = new Set()
  for (const m of stripCssComments(css).matchAll(/\.([A-Za-z_][\w-]*)/g)) out.add(m[1])
  return out
}

export function runChecks(src) {
  const fails = []
  let pass = 0
  const check = (id, ok, detail) => {
    if (ok) pass += 1
    else fails.push(`${id}${detail ? ` —— ${detail}` : ''}`)
  }

  // B1
  check('B1.no-float-discount', !/discountRate\s*\*\s*10/.test(src[F.odWxml]), '订单详情 wxml 仍用 discountRate * 10 拼折扣')
  check('B1.uses-discountText', /order\.discountText/.test(src[F.odWxml]), '订单详情 wxml 未使用 order.discountText')
  check('B1.js-formatDiscount', /discountText:\s*formatDiscount\(/.test(stripJsComments(src[F.odJs])), '订单详情 js 未用 formatDiscount 产出 discountText')

  // B2
  const finance = viewBlock(src[F.odWxml], 'finance-section')
  check('B2.finance-block-found', !!finance, '找不到 finance-section 块')
  const defined = definedClasses(src[F.odWxss])
  const missing = [...staticClasses(finance)].filter((c) => !defined.has(c))
  check('B2.finance-classes-defined', missing.length === 0, `账单区类名在 wxss 中无定义：${missing.join(', ')}`)

  // B3
  for (const [tag, file, flag, reset] of [
    ['orders', F.ordersJs, /if\s*\(\s*this\.data\.payingId\s*\)\s*return/, /finally\s*\{[^}]*payingId:\s*''/],
    ['detail', F.odJs, /if\s*\(\s*this\.data\.paying\s*\)\s*return/, /finally\s*\{[^}]*paying:\s*false/]
  ]) {
    const body = stripJsComments(methodBody(src[file], 'handlePay'))
    const guardAt = body.search(flag)
    const payAt = body.indexOf('payForOrder(')
    check(`B3.${tag}-guard-before-pay`, guardAt >= 0 && payAt > guardAt, 'handlePay 调 payForOrder 前没有「进行中即返回」')
    check(`B3.${tag}-finally-reset`, reset.test(body), 'handlePay 没有在 finally 里复位进行中状态')
  }

  // B4
  const RAW = /(?:title|content)\s*:\s*[^\n,]*\b(?:err|e|error)\s*(?:&&\s*(?:err|e|error)\.\w+\s*)?\.(?:errMsg|message)|_fail\([^)]*\b(?:err|e|error)\.(?:errMsg|message)|'[^']*'\s*\+\s*\(?\s*(?:err|e|error)\.(?:errMsg|message)/
  for (const f of NO_RAW_ERROR_FILES) {
    const lines = stripJsComments(src[f]).split('\n')
    const hits = lines.map((l, i) => [i + 1, l]).filter(([, l]) => RAW.test(l))
    check(`B4.${f.split('/').slice(-2, -1)[0]}`, hits.length === 0, hits.map(([n, l]) => `${f}:${n} ${l.trim()}`).join(' | '))
  }

  // B5
  for (const [tag, file] of [['cart', F.cartWxml], ['confirm', F.confirmWxml]]) {
    const w = src[file]
    check(`B5.${tag}-no-bare-minspend`, !/满\s*\{\{\s*item\.minSpend\s*\}\}\s*可用/.test(w), '礼券门槛直接插值 minSpend（会出现「满 0 可用」）')
    check(`B5.${tag}-no-threshold-label`, /无门槛/.test(w), '礼券弹层缺「无门槛」分支')
  }

  // B6
  const ow = src[F.ordersWxml]
  check('B6.no-specimen-placeholder', !/'Specimen'/.test(ow), "订单卡用 'Specimen' 冒充学名")
  check('B6.thumb-placeholder', /prod-img-ph/.test(ow) && /wx:if="\{\{prod\.image\}\}"/.test(ow), '订单卡缩略图缺图无占位分支')

  // B7
  const bw = src[F.bookingWxml]
  check('B7.no-hardcoded-leading-zero', !/>0\{\{\s*bookCount\s*\}\}/.test(bw), '预约票人数写死前导 0')
  check('B7.no-guest-fallback', !/'Guest'/.test(bw), "预约票持票人缺省为英文 'Guest'")

  // B8
  const cw = src[F.certWxml]
  check('B8.loading-header', /<text class="h2" wx:if="\{\{loading\}\}">/.test(cw), '荣誉档案加载中仍显示收藏件数')
  const delay = (cw.match(/animation-delay:\s*\{\{([^}]*)\}\}/) || [])[1] || ''
  check('B8.stagger-capped', !!delay && /index\s*</.test(delay), `入场延迟无上限：${delay || '（未找到）'}`)

  // B9
  const aw = src[F.addrWxml]
  check('B9.default-hides-set-default', /wx:if="\{\{!item\.isDefault\}\}"[^>]*catchtap="setDefault"/.test(aw), '默认地址卡仍显示「设为默认」')
  check('B9.saving-label', /saving \? '保存中…'/.test(aw), '保存地址按钮无进行中文案')

  // B10
  check('B10.gift-addr-submitting-label', /submitting \? '正在记下…'/.test(src[F.giftAddrWxml]), '礼赠填址提交按钮无进行中文案')

  // B11
  const tw = src[F.ticketWxml]
  const loadIdx = tw.indexOf('wx:elif="{{!booking._id}}"')
  const voidIdx = tw.indexOf('该预约已不可核销')
  check('B11.ticket-loading-branch', loadIdx > 0 && loadIdx < voidIdx, '票据加载中会先闪「该预约已不可核销」')
  check('B11.ticket-zh-labels', !/<text class="label">(PROJECT|DATE|GUEST)<\/text>/.test(tw), '票据字段标签仍为纯英文')

  // B12
  const odw = src[F.odWxml]
  const foot = odw.slice(odw.indexOf('<view class="action-footer'))
  const css = stripCssComments(src[F.odWxss])
  const tags = foot.match(/<view\s+class="(?:btn-text|btn-main|hologram-btn)\b[^>]*>/g) || []
  const bare = tags.filter((t) => !/hover-class=/.test(t))
  check('B12.footer-hover', tags.length > 0 && bare.length === 0, `订单详情底栏 ${bare.length} 枚按钮无 hover-class：${bare.map((t) => t.slice(0, 48)).join(' | ')}`)
  for (const cls of ['btn-text-press', 'btn-main-press', 'hologram-press']) {
    check(`B12.${cls}-defined`, new RegExp(`\\.${cls}\\s*[,{]`).test(css), `wxss 未定义 .${cls}`)
  }

  // B13
  check('B13.feedback-press', /bindtap="submitFeedback"/.test(src[F.feedbackWxml]) && /'account-btn-press'\}\}"[^>]*bindtap="submitFeedback"/.test(src[F.feedbackWxml]), '反馈提交按钮无按压反馈')
  check('B13.onboarding-finish-press', /hover-class="\{\{saving \? '' : 'account-btn-press'\}\}"[\s\S]{0,60}bindtap="finishWithGift"/.test(src[F.onboardingWxml]), '注册完成按钮无按压反馈')

  return { pass, fails }
}

function loadAll() {
  const src = {}
  for (const f of new Set([...Object.values(F), ...NO_RAW_ERROR_FILES])) src[f] = read(f)
  return src
}

function report({ pass, fails }) {
  for (const f of fails) console.error(`  ✗ ${f}`)
  if (fails.length) {
    console.error(`✗ check:bflow-polish：${fails.length} 项失败 / ${pass} 项通过`)
    return 1
  }
  console.log(`✓ check:bflow-polish：${pass} 项通过（交易主链 B1–B6 · 「我的」子页 B7–B10 · 凭证与底栏 B11–B13）`)
  return 0
}

const INJECTIONS = [
  ['B1 折扣回退成浮点拼接', F.odWxml, (s) => s.replace('{{order.discountText}}', '{{order.discountRate * 10}}折')],
  ['B2 定金抵扣行用回未定义类名', F.odWxml, (s) => s.replace('<view class="f-row highlight" wx:if="{{depositCredit > 0}}">', '<view class="price-row" wx:if="{{depositCredit > 0}}">')],
  ['B3 列表支付去掉防重入', F.ordersJs, (s) => s.replace('if (this.data.payingId) return;', '')],
  ['B3 详情支付 finally 不复位', F.odJs, (s) => s.replace('this.setData({ paying: false });', '')],
  ['B4 跳转失败拼回 errMsg', F.ordersJs, (s) => s.replace("wx.showToast({ title: '暂时打不开订单详情，请稍后再试', icon: 'none' });", "wx.showToast({ title: '跳转失败： ' + (err.errMsg || '未知错误'), icon: 'none' });")],
  ['B4 售后提交透出 err.message', `${B}/aftersale-apply/index.js`, (s) => s.replace("wx.showToast({ title: /上传失败$/.test(m)", "wx.showToast({ title: (err && err.message) || /上传失败$/.test(m)")],
  ['B5 购物车门槛回到「满 0 可用」', F.cartWxml, (s) => s.replace("{{item.minSpend > 0 ? '满 ¥' + item.minSpend + ' 可用' : '无门槛'}}", '满 {{item.minSpend}} 可用')],
  ['B6 学名回填占位 Specimen', F.ordersWxml, (s) => s.replace('{{prod.latin}}</text>', "{{prod.latin || 'Specimen'}}</text>")],
  ['B7 预约票人数写回前导 0', F.bookingWxml, (s) => s.replace("{{bookCount < 10 ? '0' + bookCount : bookCount}} 人", '0{{bookCount}} 人')],
  ['B8 入场延迟回到无上限', F.certWxml, (s) => s.replace('{{index < 8 ? index * 0.06 : 0.48}}s', '{{index * 0.1}}s')],
  ['B8 加载中显示收藏件数', F.certWxml, (s) => s.replace('<text class="h2" wx:if="{{loading}}">正在检索档案…</text>', '')],
  ['B9 默认卡重新显示设为默认', F.addrWxml, (s) => s.replace('<view class="act-btn" wx:if="{{!item.isDefault}}" catchtap="setDefault"', '<view class="act-btn" catchtap="setDefault"')],
  ['B10 礼赠填址去掉进行中文案', F.giftAddrWxml, (s) => s.replace("{{submitting ? '正在记下…' : '确认收件去处'}}", '确认收件去处')],
  ['B11 票据去掉加载分支', F.ticketWxml, (s) => s.replace('<text class="qr-tip muted" wx:elif="{{!booking._id}}">正在取出票据…</text>', '')],
  ['B11 票据标签回到纯英文', F.ticketWxml, (s) => s.replace('<text class="label">项目｜PROJECT</text>', '<text class="label">PROJECT</text>')],
  ['B4 票据失败拼回 errMsg', F.ticketJs, (s) => s.replace("wx.showToast({ title: '票据没取到，请检查网络后重试', icon: 'none' });", "wx.showToast({ title: err.errMsg || '票据不存在', icon: 'none' });")],
  ['B12 底栏按钮丢 hover-class', F.odWxml, (s) => s.replace('<view class="btn-text cancel" hover-class="btn-text-press" hover-stay-time="80"', '<view class="btn-text cancel"')],
  ['B12 删掉 btn-main-press 定义', F.odWxss, (s) => s.replace('.btn-main:active,\n.btn-main-press {', '.btn-main:active {')],
  ['B13 反馈按钮丢按压', F.feedbackWxml, (s) => s.replace(` hover-class="{{submitting ? '' : 'account-btn-press'}}" hover-stay-time="80"`, '')]
]

if (process.argv.includes('--selftest')) {
  const base = loadAll()
  const clean = runChecks(base)
  if (clean.fails.length) {
    console.error('✗ 自检前置：基线本身不绿')
    process.exit(report(clean))
  }
  let ok = 0
  for (const [name, file, mut] of INJECTIONS) {
    const injected = mut(base[file])
    if (injected === base[file]) {
      console.error(`  ✗ 注入锚点失效：${name}`)
      continue
    }
    const r = runChecks({ ...base, [file]: injected })
    if (r.fails.length) {
      ok += 1
      console.log(`  ✓ 检出：${name}`)
    } else console.error(`  ✗ 未检出：${name}`)
  }
  if (ok !== INJECTIONS.length) {
    console.error(`✗ 自检：${ok}/${INJECTIONS.length} 条注入被检出`)
    process.exit(1)
  }
  console.log(`✓ 自检：${ok}/${INJECTIONS.length} 条注入全部检出（内存副本，不写盘）`)
  process.exit(0)
}

process.exit(report(runChecks(loadAll())))
