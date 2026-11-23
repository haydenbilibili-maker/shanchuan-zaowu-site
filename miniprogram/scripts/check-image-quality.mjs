#!/usr/bin/env node
/**
 * check:image-quality —— 全站图片质感（2026-11-23 起多轮；产品负责人「图片是小程序非常重要的要素……
 * 全局图片展示 / 样式 / 交互 / 清晰度」）
 *
 *   I1 <shan-img> 组件本身：加载中有底与淡方印、加载完淡入且有减弱动效分支、失败不出破图并通知 imageUrl 回落、
 *      换图回到加载中、只给定框模式用
 *   I2 棘轮：每个文件里「远程图用裸 <image> 且没有 binderror」的处数只许变少（基线 image-quality-baseline.json）
 *      —— 新写的远程图要么用 <shan-img>，要么自己接 binderror；迁移后忘了降基线也红（基线须 = 实数）
 *   I3 <shan-img> 不得配 widthFix / heightFix（由图片撑高的模式在定框组件里会塌成 0 高）
 *
 * 「远程图」判定：src 绑定了 {{…}} 且不是图标类（class 里带 icon / ico / arrow / chev 且不带 thumb / cover / photo）。
 * 静态资源（/assets/…、data: URI）不算。管理端也算（同一种破图）。
 *
 *   node miniprogram/scripts/check-image-quality.mjs [--selftest | --print-baseline]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = join(HERE, '..')
const BASELINE_FILE = join(HERE, 'image-quality-baseline.json')
const COMP = {
  js: join(MP, 'components/ShanImage/index.js'),
  wxml: join(MP, 'components/ShanImage/index.wxml'),
  wxss: join(MP, 'components/ShanImage/index.wxss')
}

function listWxml() {
  const out = []
  const walk = (d) => readdirSync(d).forEach((f) => {
    const p = join(d, f)
    if (/node_modules|cloudfunctions|scripts|miniprogram_npm|\.tmp/.test(p)) return
    const st = statSync(p)
    if (st.isDirectory()) walk(p)
    else if (p.endsWith('.wxml')) out.push(p)
  })
  walk(MP)
  return out.sort()
}

/** 一个 wxml 源码里：裸远程 <image> 无 binderror 的处数 + <shan-img> 用了撑高模式的处数 */
export function scanWxml(src) {
  const text = String(src).replace(/<!--[\s\S]*?-->/g, '')
  let bare = 0
  let badMode = 0
  const re = /<image\b([\s\S]*?)\/?>/g
  let m
  while ((m = re.exec(text))) {
    const a = m[1]
    const srcAttr = (a.match(/\bsrc="([^"]*)"/) || [])[1] || ''
    if (!/\{\{/.test(srcAttr)) continue
    const cls = (a.match(/\bclass="([^"]*)"/) || [])[1] || ''
    if (/icon|ico\b|arrow|chev/i.test(cls) && !/thumb|cover|photo/i.test(cls)) continue
    if (!/\bbinderror=|\bcatcherror=/.test(a)) bare += 1
  }
  const re2 = /<shan-img\b([\s\S]*?)\/?>/g
  while ((m = re2.exec(text))) {
    if (/\bmode="(widthFix|heightFix)"/.test(m[1])) badMode += 1
  }
  return { bare, badMode }
}

function currentCounts(readFile) {
  const counts = {}
  const badModes = []
  listWxml().forEach((f) => {
    const rel = relative(MP, f)
    const r = scanWxml(readFile(f))
    if (r.bare) counts[rel] = r.bare
    if (r.badMode) badModes.push(rel)
  })
  return { counts, badModes }
}

function checkComponent(read) {
  const fails = []
  const js = read(COMP.js)
  const wxml = read(COMP.wxml)
  const wxss = read(COMP.wxss)
  if (!/\.si \{[\s\S]*?background: #24211D;/.test(wxss)) fails.push('I1 加载中没有暖深底（外框 background）')
  if (!/<text class="si-mark" wx:if="\{\{mark && !loaded\}\}"/.test(wxml)) fails.push('I1 加载中 / 失败没有淡方印')
  if (!/\.si-img \{[\s\S]*?opacity: 0;[\s\S]*?transition: opacity/.test(wxss) || !/\.si\.is-loaded \.si-img \{ opacity: 1; \}/.test(wxss)) fails.push('I1 加载完不淡入')
  if (!/@media \(prefers-reduced-motion: reduce\) \{\s*\.si-img \{ transition: none; \}/.test(wxss)) fails.push('I1 淡入没有减弱动效分支')
  if (!/wx:if="\{\{src && !failed\}\}"/.test(wxml) || !/binderror="onError"/.test(wxml) || !/bindload="onLoad"/.test(wxml)) fails.push('I1 失败时没收起破图 / 没接 load·error')
  if (!/require\('\.\.\/\.\.\/utils\/imageUrl'\)\.onImageError\(\)/.test(js)) fails.push('I1 失败没通知 imageUrl 回落原图')
  if (!/this\.setData\(\{ loaded: false, failed: false \}\)/.test(js)) fails.push('I1 换图没回到加载中（旧图状态带到新图）')
  if (!/this\.triggerEvent\('error'/.test(js) || !/this\.triggerEvent\('load'/.test(js)) fails.push('I1 没透传 load / error 事件（页面原 binderror 逻辑接不上）')
  return fails
}

function runChecks(read = (f) => readFileSync(f, 'utf8'), baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))) {
  const fails = checkComponent(read)
  const { counts, badModes } = currentCounts(read)
  const base = baseline.counts || {}
  const grew = Object.keys(counts).filter((f) => counts[f] > (base[f] || 0)).map((f) => `${f}：${base[f] || 0} → ${counts[f]}`)
  if (grew.length) fails.push(`I2 远程图用裸 <image> 且无 binderror 变多了（改用 <shan-img> 或接 binderror）：${grew.join('；')}`)
  const stale = Object.keys(base).filter((f) => (counts[f] || 0) < base[f]).map((f) => `${f}：基线 ${base[f]} → 实数 ${counts[f] || 0}`)
  if (stale.length) fails.push(`I2 基线没跟着降（迁移完要把基线拧紧，否则以后退回去也不红）：${stale.join('；')}；跑 --print-baseline 更新`)
  if (badModes.length) fails.push(`I3 <shan-img> 配了 widthFix / heightFix（定框组件里会塌成 0 高，请用原生 <image>）：${badModes.join('、')}`)
  return { fails, counts }
}

const argv = process.argv.slice(2)
if (argv.includes('--print-baseline')) {
  const { counts } = currentCounts((f) => readFileSync(f, 'utf8'))
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  writeFileSync(BASELINE_FILE, JSON.stringify({ _doc: '远程图用裸 <image> 且无 binderror 的处数（文件 → 处数），只许变少；生成：node miniprogram/scripts/check-image-quality.mjs --print-baseline', total, counts }, null, 2) + '\n')
  console.log(`✓ 基线已写：${Object.keys(counts).length} 个文件 / ${total} 处`)
} else if (argv.includes('--selftest')) {
  const real = (f) => readFileSync(f, 'utf8')
  const base = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
  if (runChecks(real, base).fails.length) { console.error('✗ 自检前提：真源须先通过'); process.exit(1) }
  const swap = (file, a, b) => (f) => { const s = real(f); if (f !== file) return s; if (s.indexOf(a) < 0) throw new Error(`注入锚点失效：${a.slice(0, 40)}`); return s.replace(a, b) }
  const home = join(MP, 'pages/index/index.wxml')
  const cases = [
    ['加载中没底', swap(COMP.wxss, 'background: #24211D;', 'background: transparent;')],
    ['不淡入', swap(COMP.wxss, '.si.is-loaded .si-img { opacity: 1; }', '')],
    ['淡入没有减弱动效', swap(COMP.wxss, '.si-img { transition: none; }', '')],
    ['失败照样出破图', swap(COMP.wxml, 'wx:if="{{src && !failed}}"', 'wx:if="{{src}}"')],
    ['失败不通知回落', swap(COMP.js, "require('../../utils/imageUrl').onImageError()", 'void 0')],
    ['换图不重置', swap(COMP.js, 'this.setData({ loaded: false, failed: false })', 'void 0')],
    ['首页退回裸 <image>', swap(home, '<shan-img ext-class="op-img" src="{{item.image}}" mode="aspectFill" />', '<image class="op-img" src="{{item.image}}" mode="aspectFill" lazy-load></image>')],
    ['shan-img 配 widthFix', swap(home, '<shan-img ext-class="op-img" src="{{item.image}}" mode="aspectFill" />', '<shan-img ext-class="op-img" src="{{item.image}}" mode="widthFix" />')]
  ]
  let bad = 0
  for (const [name, reader] of cases) {
    let r
    try { r = runChecks(reader, base) } catch (e) { r = { fails: ['抛错：' + e.message] } }
    if (r.fails.length && !/注入锚点失效/.test(r.fails[0])) console.log(`✓ 注入「${name}」→ 检出（${r.fails[0].slice(0, 60)}）`)
    else { bad++; console.log(`✗ 注入「${name}」→ ${r.fails.length ? '锚点失效' : '未检出'}`) }
  }
  // 基线没跟着降：假装基线多一处
  const loose = JSON.parse(JSON.stringify(base))
  const anyFile = Object.keys(loose.counts)[0]
  loose.counts[anyFile] += 1
  if (runChecks(real, loose).fails.some((f) => /基线没跟着降/.test(f))) console.log('✓ 注入「基线没跟着降」→ 检出')
  else { bad++; console.log('✗ 注入「基线没跟着降」→ 未检出') }
  if (bad) { console.error(`✗ check:image-quality 自检失败 ${bad} 项`); process.exit(1) }
  console.log(`✓ check:image-quality 自检通过（${cases.length + 1} 条内存注入全部检出，未写盘）`)
} else {
  const { fails, counts } = runChecks()
  if (fails.length) { console.error('✗ 全站图片质感：\n  - ' + fails.join('\n  - ')); process.exit(1) }
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  console.log(`✓ check:image-quality：<shan-img> 加载中底与方印 / 淡入 / 失败不破图；裸远程图棘轮 ${total} 处（只许变少）`)
}
