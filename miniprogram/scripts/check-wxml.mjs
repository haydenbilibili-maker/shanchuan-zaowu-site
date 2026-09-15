#!/usr/bin/env node
/**
 * WXML 静态检查：拦截「只在微信开发者工具编译时才暴露」的两类错误。
 *
 * 背景：本项目曾出现 `Bad attr wx:else with message: wx:if not found`——
 * 一次改动把某个兄弟节点的 wx:else 改成 wx:if、却把 wx:else 留在前一个节点上，
 * 造成孤立的 wx:else，整个小程序**编译失败**。当时的手工校验只检查了标签配对，
 * 抓不到这类问题，直到开发者工具报错才发现。
 *
 * 检查项：
 *   1. wx:else / wx:elif 必须紧跟同一父节点下、前一个带 wx:if/wx:elif 的兄弟元素
 *   2. 标签开闭配对
 *
 * 关于空元素：WXML 里 `<image .../>`、`<image ...></image>`、`<image ...>`
 * 三种写法都合法，因此空元素不入栈；遇到 `</image>` 这类闭合标签时直接忽略。
 *
 * 用法：
 *   node scripts/check-wxml.mjs              # 检查当前目录（miniprogram/）
 *   node scripts/check-wxml.mjs <dir|file>   # 检查指定路径
 * 退出码：有问题为 1，可用于 CI / 提交前钩子。
 *
 * 自检：node scripts/check-wxml.mjs --selftest
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 小程序里允许不写闭合标签的内置元素 */
const VOID_TAGS = new Set([
  'image', 'input', 'import', 'include', 'wxs', 'icon', 'progress', 'switch',
  'slider', 'audio', 'video', 'camera', 'canvas', 'map', 'textarea',
  'live-player', 'live-pusher', 'open-data', 'ad', 'official-account',
  'navigation-bar', 'page-meta', 'keyboard-accessory', 'match-media',
  'functional-page-navigator', 'voip-room', 'channel-live', 'channel-video',
])

const TAG_RE = /<(\/?)([A-Za-z][-\w:]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/gs
const ATTR_RE = /(wx:(?:if|elif|else))\b/g

function walk(target, out = []) {
  const st = statSync(target)
  if (st.isFile()) {
    if (extname(target) === '.wxml') out.push(target)
    return out
  }
  for (const name of readdirSync(target)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    walk(join(target, name), out)
  }
  return out
}

/** 用等长换行替换注释，保证行号不漂移 */
const stripComments = (src) =>
  src.replace(/<!--[\s\S]*?-->/g, (m) => '\n'.repeat((m.match(/\n/g) || []).length))

export function checkSource(src, rel = '<inline>') {
  const errors = []
  const text = stripComments(src)
  const lineAt = (idx) => text.slice(0, idx).split('\n').length

  // 元素栈：tags 与 frames 严格同步 push/pop
  const tags = [] // { tag, line }
  // 每帧记录「该父节点下最近一个已结束的子元素是否带 if/elif」
  const frames = [{ lastChildCond: false }]

  for (const m of text.matchAll(TAG_RE)) {
    const [, closing, tag, attrs, selfClose] = m
    const line = lineAt(m.index)

    if (closing) {
      const top = tags[tags.length - 1]
      if (top && top.tag === tag) {
        tags.pop()
        if (frames.length > 1) frames.pop()
      } else if (VOID_TAGS.has(tag)) {
        // 空元素的显式闭合（<image></image>）：从未入栈，忽略
      } else if (!top) {
        errors.push(`${rel}:${line}: 多余的闭合标签 </${tag}>`)
      } else {
        errors.push(`${rel}:${line}: </${tag}> 与未闭合的 <${top.tag}> (第 ${top.line} 行) 不匹配`)
      }
      continue
    }

    const kinds = new Set([...attrs.matchAll(ATTR_RE)].map((a) => a[1]))
    const hasIf = kinds.has('wx:if')
    const hasElif = kinds.has('wx:elif')
    const hasElse = kinds.has('wx:else')

    const parent = frames[frames.length - 1]
    if ((hasElse || hasElif) && !parent.lastChildCond) {
      const kw = hasElse ? 'wx:else' : 'wx:elif'
      errors.push(
        `${rel}:${line}: \`${kw}\` 缺少前置的 wx:if/wx:elif 兄弟节点（微信开发者工具会报 "wx:if not found"）`,
      )
    }
    parent.lastChildCond = hasIf || hasElif

    if (!selfClose && !VOID_TAGS.has(tag)) {
      tags.push({ tag, line })
      frames.push({ lastChildCond: false })
    }
  }

  for (const t of tags) errors.push(`${rel}:${t.line}: <${t.tag}> 未闭合`)
  return errors
}

/** 自检：确认检查器真的能抓到已知错误，而不是永远返回通过 */
function selftest() {
  const bad = `<view>\n  <view class="locked" wx:else>x</view>\n  <view wx:if="{{ok}}">y</view>\n</view>\n`
  const good = `<view>\n  <view wx:if="{{a}}">x</view>\n  <view wx:else>y</view>\n</view>\n`
  const voidBoth = `<view>\n  <image src="a.png"></image>\n  <image src="b.png" />\n  <image src="c.png">\n</view>\n`
  const badTag = `<view>\n  <text>abc</view>\n</view>\n`
  const cases = [
    ['孤立 wx:else 必须报错', bad, 1],
    ['正确的 if/else 不得报错', good, 0],
    ['空元素三种写法不得报错', voidBoth, 0],
    ['标签错配必须报错', badTag, 1],
  ]
  let failed = 0
  for (const [name, src, want] of cases) {
    const got = checkSource(src).length
    const ok = want === 0 ? got === 0 : got > 0
    if (!ok) failed += 1
    console.log(`${ok ? '✓' : '✗'} ${name}（期望${want === 0 ? '通过' : '报错'}，实际 ${got} 处）`)
  }
  if (failed) {
    console.error(`\n自检失败 ${failed} 项——检查器不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：检查器能抓到已知错误，也不会误报合法写法')
}

function main() {
  if (process.argv.includes('--selftest')) return selftest()

  const root = process.argv[2] || '.'
  const files = walk(root)
  const errors = []
  for (const f of files) {
    errors.push(...checkSource(readFileSync(f, 'utf8'), relative(root, f) || f))
  }

  for (const e of errors) console.error(`✗ ${e}`)
  if (errors.length) {
    console.error(`\nWXML 检查未通过：${files.length} 个文件，${errors.length} 处问题`)
    process.exit(1)
  }
  console.log(`✓ WXML 检查通过（${files.length} 个文件）`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
