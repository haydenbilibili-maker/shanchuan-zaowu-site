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
  atelierJs: 'pages/atelier/index.js'
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
