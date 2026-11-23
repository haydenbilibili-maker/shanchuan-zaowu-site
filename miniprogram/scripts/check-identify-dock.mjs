#!/usr/bin/env node
/**
 * check:identify-dock —— AI 鉴定结果页行动区（2026-11-23 重排，产品负责人「继续优化 AI 标本鉴定页面」）
 *
 * 原先两颗描边钮 + 图鉴钮 + 四个文字链 + 两个页脚链（九个出口三种样式）。重排为三层：
 *   ① 主行动：存进 / 已在山海图鉴（逻辑不变）
 *   ② 四格工具：问问博物君 / 分享海报 / 馆藏同类 / 再拍一张（按条件出，最多 4 格）
 *   ③ 一行小字：识别纠错 · 鉴定疑问 · 相关藏品 · 我的图鉴
 *
 *   D1 九个出口全部还在、处理函数在 JS 里真实存在（重排不许丢功能）
 *   D2 工具带最多 4 格；「再拍一张」在低置信 / 非标本时不出（上面已有「重新拍摄」主按钮，不重复）
 *   D3 问问博物君只在识别出物种时出；馆藏同类非标本不出
 *   D4 旧的页脚链 / 双描边钮不回来；死样式已清
 *   D5 鉴定百科不再「只剩标题」：没有可见正文区块（来源块不算）、不在补全也没失败时出空态卡；整理档案只给本人
 *   D6 鉴定台：「三步」收成按钮下一行小字（等待卡三步仍在）；拍摄建议可折叠，按本机记录决定首帧收展，手动点过不再自动改
 *
 *   node miniprogram/scripts/check-identify-dock.mjs [--selftest]
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MP = join(dirname(fileURLToPath(import.meta.url)), '..')
const F = {
  entryWxml: join(MP, 'subpackages/feature/identify/index.wxml'),
  entryJs: join(MP, 'subpackages/feature/identify/index.js'),
  wxml: join(MP, 'subpackages/feature/identify/result/index.wxml'),
  wxss: join(MP, 'subpackages/feature/identify/result/index.wxss'),
  js: join(MP, 'subpackages/feature/identify/result/index.js')
}

let INJECT = null
const read = (f) => {
  const src = readFileSync(f, 'utf8')
  if (!INJECT || INJECT.file !== f) return src
  if (src.indexOf(INJECT.find) === -1) throw new Error(`注入锚点失效：${INJECT.name}`)
  return src.replace(INJECT.find, INJECT.replace)
}

function runChecks() {
  const fails = []
  const ok = (name, cond) => { if (!cond) fails.push(name) }
  const wxml = read(F.wxml).replace(/<!--[\s\S]*?-->/g, '')
  const wxss = read(F.wxss)
  const js = read(F.js)
  const dockAt = wxml.indexOf('<view class="action-dock">')
  const dock = dockAt >= 0 ? wxml.slice(dockAt, wxml.indexOf('<view class="ui-pop-mask is-center fb-mask"', dockAt)) : ''

  const HANDLERS = ['onSaveAtlas', 'onGoAtlas', 'onAskGuide', 'onGoShare', 'onGoGallery', 'onRetake', 'openFeedback', 'onExpertHelp', 'onViewProducts']
  const missing = HANDLERS.filter((h) => !dock.includes(`bindtap="${h}"`) || !new RegExp(`\\n  (async )?${h}\\(`).test(js))
  ok(`D1 九个出口全在且处理函数存在（缺：${missing.join('、') || '无'}）`, dock && missing.length === 0)

  const grid = (/<view class="tool-grid">([\s\S]*?)\n      <\/view>\n/.exec(dock) || [])[1] || ''
  const tools = grid.match(/<view class="tool"[^>]*>/g) || []
  ok('D2 工具带最多 4 格、每格有按压态', tools.length > 0 && tools.length <= 4 && tools.every((t) => /hover-class="tool-press"/.test(t)))
  const again = tools.find((t) => /bindtap="onRetake"/.test(t)) || ''
  ok('D2 再拍一张：低置信 / 非标本时不出（不与「重新拍摄」重复）', /wx:if="\{\{confidenceLevel !== 'low' && speciesInfo\.is_specimen !== false\}\}"/.test(again) &&
    /<view class="retake-block" wx:if="\{\{confidenceLevel === 'low' \|\| speciesInfo\.is_specimen === false\}\}">/.test(wxml))
  const ask = tools.find((t) => /bindtap="onAskGuide"/.test(t)) || ''
  ok('D3 问问博物君只在识别出物种时出', /wx:if="\{\{speciesInfo\.species_name_zh && speciesInfo\.is_specimen !== false\}\}"/.test(ask))
  const cab = tools.find((t) => /bindtap="onGoGallery"/.test(t)) || ''
  ok('D3 馆藏同类：非标本不出', /wx:if="\{\{speciesInfo\.is_specimen !== false\}\}"/.test(cab))
  ok('D3 识别纠错只在有记录时出、相关藏品只在有藏品时出', /<block wx:if="\{\{recordId\}\}">\s*<text class="meta-link" bindtap="openFeedback"/.test(dock) &&
    /<block wx:if="\{\{relatedProducts\.length > 0\}\}">[\s\S]*?bindtap="onViewProducts"/.test(dock))

  ok('D4 旧页脚链 / 双描边钮不回来', !/class="foot-links"|class="act-grid"|act ghost compact/.test(wxml))
  ok('D4 死样式已清（foot-link / act-grid / .act.compact）', !/\.foot-link|\.act-grid|\.act\.compact/.test(wxss))
  ok('D4 工具带样式齐备', ['.tool-grid {', '.tool {', '.tool-press {', '.tool-en {', '.tool-t {'].every((c) => wxss.includes(c)))

  /* D5 百科空态 */
  const emptyAt = js.indexOf('function archiveIsEmpty(profile)')
  let archiveIsEmpty = null
  try { archiveIsEmpty = new Function(js.slice(emptyAt, js.indexOf('\n}\n', emptyAt) + 2) + '\nreturn archiveIsEmpty')() } catch (e) { archiveIsEmpty = null }
  ok('D5 只剩来源块 / 全不可见 / 无块 → 空；有一块可见正文 → 不空',
    typeof archiveIsEmpty === 'function' && archiveIsEmpty({ blocks: [{ visible: true, type: 'source' }, { visible: false, type: 'text' }] }) === true &&
    archiveIsEmpty(null) === true && archiveIsEmpty({ blocks: [{ visible: true, type: 'text' }] }) === false)
  ok('D5 首次加载与补全成功都重算空态', /archiveEmpty: archiveIsEmpty\(speciesProfile\),/.test(js) && /archiveEmpty: archiveIsEmpty\(next\),/.test(js))
  ok('D5 空态卡：不在补全 / 没失败时才出；整理档案只给本人', /<view class="ency-empty-card" wx:if="\{\{archiveEmpty && !profileEnriching && !profileEnrichError\}\}">/.test(wxml) &&
    /class="ency-empty-btn" wx:if="\{\{isOwner && recordId\}\}" bindtap="retryEnrichProfile"/.test(wxml) && /class="ency-empty-btn is-ghost" wx:if="\{\{speciesInfo\.species_name_zh\}\}" bindtap="onAskGuide"/.test(wxml))

  /* D6 鉴定台 */
  const ew = read(F.entryWxml).replace(/<!--[\s\S]*?-->/g, '')
  const ej = read(F.entryJs)
  ok('D6 三步收成一行小字、不再有独立三步区块；等待卡三步仍在', !/class="flow"|flowSteps/.test(ew) && /<text class="act-meta">入镜 → 归档 → 解读/.test(ew) &&
    /class="step \{\{loadingStep >= 3 \? 'done' : ''\}\}">解读/.test(ew))
  ok('D6 拍摄建议可折叠（头部可点、按 tipsOpen 出）', /class="tips-head" bindtap="onToggleTips"/.test(ew) && /<view class="tip-grid" wx:if="\{\{tipsOpen\}\}">/.test(ew))
  ok('D6 首帧按本机记录决定收展；列表回来后对齐；手动点过不再自动改',
    /tipsOpen: !hasRecord/.test(ej) && /if \(!this\._tipsTouched\) patch\.tipsOpen = list\.length === 0/.test(ej) && /this\._tipsTouched = true/.test(ej) && /wx\.setStorageSync\(HAS_RECORD_KEY/.test(ej))
  return fails
}

const INJECTIONS = [
  { name: '丢了识别纠错', file: F.wxml, find: '<text class="meta-link" bindtap="openFeedback"', replace: '<text class="meta-link"' },
  { name: '处理函数被删', file: F.js, find: '\n  onViewProducts(', replace: '\n  onViewProductsOld(' },
  { name: '工具带塞第五格', file: F.wxml, find: '<view class="tool-grid">', replace: '<view class="tool-grid">\n        <view class="tool" bindtap="onExpertHelp" hover-class="tool-press" hover-stay-time="80"><text class="tool-t">鉴定疑问</text></view>' },
  { name: '低置信时再拍一张重复出', file: F.wxml, find: `wx:if="{{confidenceLevel !== 'low' && speciesInfo.is_specimen !== false}}" bindtap="onRetake"`, replace: 'bindtap="onRetake"' },
  { name: '没物种也出问问博物君', file: F.wxml, find: 'wx:if="{{speciesInfo.species_name_zh && speciesInfo.is_specimen !== false}}" bindtap="onAskGuide"', replace: 'bindtap="onAskGuide"' },
  { name: '非标本也出馆藏同类', file: F.wxml, find: 'wx:if="{{speciesInfo.is_specimen !== false}}" bindtap="onGoGallery"', replace: 'bindtap="onGoGallery"' },
  { name: '页脚链回来', file: F.wxml, find: '<view class="action-group-meta">', replace: '<view class="foot-links"></view>\n      <view class="action-group-meta">' },
  { name: '死样式回来', file: F.wxss, find: '.tool-grid {', replace: '.foot-links { display: flex; }\n.tool-grid {' },
  { name: '来源块也算正文', file: F.js, find: "b && b.visible && b.type !== 'source'", replace: 'b && b.visible' },
  { name: '补全后不重算空态', file: F.js, find: '        archiveEmpty: archiveIsEmpty(next),\n', replace: '' },
  { name: '补全中也出空态', file: F.wxml, find: 'wx:if="{{archiveEmpty && !profileEnriching && !profileEnrichError}}"', replace: 'wx:if="{{archiveEmpty}}"' },
  { name: '他人也能整理档案', file: F.wxml, find: 'wx:if="{{isOwner && recordId}}" bindtap="retryEnrichProfile"', replace: 'bindtap="retryEnrichProfile"' },
  { name: '独立三步区块回来', file: F.entryWxml, find: '  <view class="recent"', replace: '  <view class="flow"></view>\n  <view class="recent"' },
  { name: '拍摄建议不能收', file: F.entryWxml, find: '<view class="tip-grid" wx:if="{{tipsOpen}}">', replace: '<view class="tip-grid">' },
  { name: '手动收起后又被改回', file: F.entryJs, find: 'if (!this._tipsTouched) patch.tipsOpen', replace: 'patch.tipsOpen' },
  { name: '工具格没按压态', file: F.wxml, find: 'bindtap="onGoShare" hover-class="tool-press"', replace: 'bindtap="onGoShare"' }
]

if (process.argv.includes('--selftest')) {
  const base = runChecks()
  if (base.length) { console.error('✗ 自检前提：真源须先通过\n  - ' + base.join('\n  - ')); process.exit(1) }
  let bad = 0
  for (const inj of INJECTIONS) {
    INJECT = inj
    let res
    try { res = runChecks() } catch (e) { res = ['抛错：' + e.message] }
    INJECT = null
    if (res.length && /注入锚点失效/.test(res[0])) { bad++; console.log(`✗ 注入「${inj.name}」→ 锚点失效（注入未发生）`) }
    else if (res.length) console.log(`✓ 注入「${inj.name}」→ 检出（${res[0]}）`)
    else { bad++; console.log(`✗ 注入「${inj.name}」→ 未检出`) }
  }
  if (bad) { console.error(`✗ 自检失败：${bad} 条注入未检出 / 锚点失效`); process.exit(1) }
  console.log(`✓ 自检通过：${INJECTIONS.length} 条注入全部检出（内存副本，不写盘）`)
} else {
  const fails = runChecks()
  if (fails.length) { console.error('✗ check:identify-dock 失败：\n  - ' + fails.join('\n  - ')); process.exit(1) }
  console.log('✓ check:identify-dock：鉴定结果页行动区三层 / 百科空态 / 鉴定台三步与拍摄建议折叠')
}
