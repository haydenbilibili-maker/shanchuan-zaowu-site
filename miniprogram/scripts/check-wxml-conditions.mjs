#!/usr/bin/env node
/**
 * WXML 条件链守卫：`wx:elif` / `wx:else` 必须有合法的前置 `wx:if`
 *
 * 为什么需要（2026-09-17 实测，一次线上级事故的**真正根因**）：
 *   微信开发者工具真实编译报错（CLI `preview` 拿到，不是推断）：
 *
 *     wxml 编译错误：./subpackages/feature/wish-wall/index.wxml:1:5018
 *     Bad attr `wx:elif` with message: `wx:if not found, then something must be wrong`
 *
 *   触发写法是经典坑：**`wx:for` 与 `wx:if` 写在同一个标签上**
 *
 *     <view wx:for="{{[1,2,3]}}" wx:key="*this" wx:if="{{loading}}">…</view>
 *     <view wx:elif="{{loadError}}">…</view>      ← 编译报错
 *     <block wx:else>…</block>
 *
 *   编译器把「带 wx:for 的元素」当成循环块，**不认它是 elif 链的起点**，
 *   于是后面的 `wx:elif` 找不到 `wx:if` → **WXML 编译错误**。
 *
 *   为什么这条特别致命：**一个 WXML 编译错误会让整个分包编译失败**，
 *   表现是该分包内**所有页面**点进去都 `navigateTo:fail timeout` ——
 *   与「分包体积超限」「跨分包引用」的现象**完全同形**，极易误诊。
 *   本次事故就是：主包正常、feature 分包里每个页面（商品详情/搜索/礼赠）全打不开。
 *
 *   为什么原有 `lint:wxml` 没拦住：它查的是标签闭合/未声明标签一类结构问题，
 *   **不查条件链**。本守卫补这一层。
 *
 * 规则：
 *   ① 元素带 `wx:elif` / `wx:else` 时，同级**紧邻的前一个元素**必须带 `wx:if` 或 `wx:elif`，
 *      且该前驱**不能带 `wx:for`**（带了就等于没有 if 起点）。
 *   ② `wx:for` 与 `wx:if` 同标签本身也直接报错：它是本坑的成因，
 *      且语义上容易误解（wx:for 优先，wx:if 变成"每项判断"）。修法：把 wx:if 提到外层 `<block>`。
 *
 * 用法：
 *   node miniprogram/scripts/check-wxml-conditions.mjs
 *   node miniprogram/scripts/check-wxml-conditions.mjs --selftest
 * 退出码：存在非法条件链为 1。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const SKIP_DIRS = new Set(['node_modules', 'cloudfunctions', 'scripts', 'docs', 'miniprogram_npm', '.git'])
/**
 * 真正「不写闭合标签」的标签。
 * ⚠️ 不要把 `image` / `input` / `slot` 放进来：本仓库大量写成
 * `<image …></image>`（显式闭合），把它们当 void 会让后面的 `</image>`
 * 误关闭父节点，兄弟序列全错 —— 我的第一版就是这样误报了 53 处。
 */
const VOID_TAGS = new Set(['import', 'include', 'wxs'])

/**
 * 纯函数：把 WXML 解析成「同级兄弟序列」，逐个校验条件链。
 * 返回 [{ line, kind, detail }]
 */
export function checkConditionChains(src) {
  const text = String(src || '').replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
  const problems = []
  // 每个栈帧保存该层级已出现的兄弟（只留"上一个"，因为链只看紧邻）
  const stack = [{ prev: null, tag: '(root)' }]
  const tagRe = /<(\/?)([A-Za-z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
  let m
  while ((m = tagRe.exec(text))) {
    const [full, closing, tag, attrsRaw, selfClose] = m
    const line = text.slice(0, m.index).split('\n').length
    if (closing) {
      // 只在栈顶就是该标签时弹栈；否则向上找最近匹配（WXML 允许 <image></image> 这类写法，
      // 也能容忍 tag 不配对时不让兄弟序列彻底跑偏）
      if (stack[stack.length - 1].tag === tag) {
        if (stack.length > 1) stack.pop()
      } else {
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i].tag === tag) { stack.length = i; break }
        }
      }
      continue
    }
    const attrs = attrsRaw || ''
    const hasFor = /\bwx:for\s*=/.test(attrs)
    const hasIf = /\bwx:if\s*=/.test(attrs)
    const hasElif = /\bwx:elif\s*=/.test(attrs)
    const hasElse = /\bwx:else\b/.test(attrs)

    const prev = stack[stack.length - 1].prev
    if (hasElif || hasElse) {
      const kw = hasElif ? 'wx:elif' : 'wx:else'
      if (!prev) {
        problems.push({ line, kind: 'chain', severity: 'error', detail: `<${tag} ${kw}> 没有同级前置元素（条件链缺少 wx:if 起点）` })
      } else if (!prev.hasIf && !prev.hasElif) {
        problems.push({ line, kind: 'chain', severity: 'error', detail: `<${tag} ${kw}> 的前一个同级元素 <${prev.tag}> 既没有 wx:if 也没有 wx:elif` })
      } else if (prev.hasFor) {
        problems.push({
          line,
          kind: 'chain',
          severity: 'error',
          detail: `<${tag} ${kw}> 的前一个同级元素 <${prev.tag}> 同时带 wx:for —— ` +
            'wx:for 与 wx:if 同标签时编译器不认它为条件链起点（真实报错：Bad attr wx:elif / wx:if not found）'
        })
      }
    }
    if (hasFor && hasIf) {
      // 编译器**接受**这个写法，所以只作警告：它是本坑的成因（一旦后面跟 elif/else 就报错），
      // 但单看它自己不算编译错误。exit code 只由 severity==='error' 决定，与编译器口径一致。
      problems.push({
        line,
        kind: 'for-if',
        severity: 'warn',
        detail: `<${tag}> 同时带 wx:for 与 wx:if（编译器接受，但一旦后面跟 wx:elif/wx:else 就会**编译报错**）。` +
          '建议：把 wx:if 提到外层 <block wx:if>'
      })
    }

    const isVoid = !!selfClose || VOID_TAGS.has(tag)
    if (isVoid) {
      // 自闭合元素也算一个兄弟
      stack[stack.length - 1].prev = { tag, hasIf, hasElif, hasFor }
      continue
    }
    // 进入子层级
    stack[stack.length - 1].prev = { tag, hasIf, hasElif, hasFor }
    stack.push({ prev: null, tag })
  }
  return problems
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.wxml')) out.push(p)
  }
  return out
}

export function scan(files = walk(MP)) {
  const problems = []
  const warnings = []
  let checked = 0
  for (const f of files) {
    checked += 1
    const rel = relative(MP, f).replace(/\\/g, '/')
    for (const p of checkConditionChains(readFileSync(f, 'utf8'))) {
      const line = `${rel}:${p.line}  ${p.detail}`
      if (p.severity === 'warn') warnings.push(line)
      else problems.push(line)
    }
  }
  return { checked, problems, warnings }
}

function selftest() {
  let bad = 0
  const t = (n, ok) => { if (!ok) bad += 1; console.log(`${ok ? '✓' : '✗'} ${n}`) }

  // ★ 事故原形：wx:for + wx:if 同标签 → 后面的 wx:elif 报错
  const accident = `<view class="skel" wx:for="{{[1,2,3]}}" wx:key="*this" wx:if="{{loading}}">x</view>
<view wx:elif="{{loadError}}">err</view>
<block wx:else>list</block>`
  const r1 = checkConditionChains(accident)
  t('★ 事故原形被检出（for+if 同标签）', r1.some((p) => p.kind === 'for-if'))
  t('★ 事故原形被检出（elif 找不到 if 起点）',
    r1.some((p) => p.kind === 'chain' && /前一个同级元素/.test(p.detail)))

  // 正确写法必须放行
  const fixed = `<block wx:if="{{loading}}">
  <view wx:for="{{[1,2,3]}}" wx:key="*this" class="skel">x</view>
</block>
<view wx:elif="{{loadError}}">err</view>
<block wx:else>list</block>`
  t('★ 正确写法（wx:if 提到外层 block）零问题', checkConditionChains(fixed).length === 0)

  // 其他正例/反例
  t('裸 wx:else 被检出（无前置）',
    checkConditionChains('<view wx:else>x</view>').length === 1)
  t('wx:elif 前置是普通 wx:if → 放行',
    checkConditionChains('<view wx:if="{{a}}">1</view><view wx:elif="{{b}}">2</view>').length === 0)
  t('多层 elif 链 → 放行',
    checkConditionChains('<view wx:if="{{a}}">1</view><view wx:elif="{{b}}">2</view><view wx:else>3</view>').length === 0)
  t('链中间夹了无条件的兄弟 → 被检出',
    checkConditionChains('<view wx:if="{{a}}">1</view><view>mid</view><view wx:else>3</view>').length === 1)
  t('注释里的 wx:elif 不误报',
    checkConditionChains('<!-- <view wx:elif="{{a}}">x</view> -->').length === 0)
  t('自闭合元素也算兄弟（input wx:if/ → view wx:else 放行）',
    checkConditionChains('<input wx:if="{{a}}"/><view wx:else>x</view>').length === 0)
  t('★ 显式闭合的 <image></image> 不得打乱兄弟序列（第一版误报的成因）',
    checkConditionChains('<image wx:if="{{a}}"></image><view wx:else>x</view>').length === 0)
  t('★ 被 <image></image> 包住的兄弟链仍正确',
    checkConditionChains('<view wx:if="{{a}}"><image src="x"></image></view><view wx:else>y</view>').length === 0)
  t('不同层级不互相干扰（内层 elif 不受外层影响）',
    checkConditionChains('<view wx:if="{{a}}"><view wx:if="{{b}}">1</view><view wx:else>2</view></view>').length === 0)
  t('内层裸 wx:elif 被检出',
    checkConditionChains('<view wx:if="{{a}}"><view wx:elif="{{b}}">1</view></view>').length === 1)

  // 仓库自身必须干净
  const repo = scan()
  t(`★ 仓库 ${repo.checked} 个 WXML 条件链无编译级问题`, repo.problems.length === 0)
  if (repo.problems.length) repo.problems.slice(0, 6).forEach((p) => console.log('      ' + p))
  if (repo.warnings.length) {
    console.log(`      · 另有 ${repo.warnings.length} 处「wx:for + wx:if 同标签」建议项（编译器接受，不阻断）`)
  }

  if (bad) {
    console.error(`\n自检失败 ${bad} 项——守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：事故原形必被检出、正确写法放行、层级/注释/自闭合均正确处理')
}

function main() {
  if (process.argv.includes('--selftest')) return selftest()
  const { checked, problems, warnings } = scan()
  for (const w of warnings) console.log(`· ${w}`)
  for (const p of problems) console.error(`✗ ${p}`)
  if (problems.length) {
    console.error(`\nWXML 条件链未通过：${problems.length} 处`)
    console.error('（这类错是**编译错误**：会让整个分包编译失败，该分包所有页面都 navigateTo:fail timeout）')
    process.exit(1)
  }
  console.log(`✓ WXML 条件链无编译级问题（${checked} 个文件` +
    (warnings.length ? `；另有 ${warnings.length} 处 for+if 建议项` : '') + '）')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
