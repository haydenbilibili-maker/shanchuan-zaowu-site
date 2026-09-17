#!/usr/bin/env node
/**
 * 「调用方身份透传」必须带来源门的守卫
 *
 * 背景（2026-09-17 全面审计 C4）：
 *   服务端互调（审批通过、券核销联动）时云函数拿不到用户 OPENID，于是约定用
 *   `event._callerOpenid` 传递**操作人身份**。但这个字段来自 `event`，也就是
 *   **调用方可以自己填**。为了不让客户端伪造操作人，全仓统一加了一道来源门：
 *
 *     if (!openid && isNonClientSource() && event._fromApproval && event._callerOpenid) { … }
 *
 *   `isNonClientSource()` 为真表示调用**不是**来自小程序/开发者工具（见 sourceOrigin.js）。
 *   实测 `managerShipOrder` 是 7 处透传点里**唯一**漏掉这道门的：
 *   经 `/api/cloud-fn`（SCF Invoke，SOURCE 段为空）即可指定任意 openid 写入审计日志
 *   —— 影响的是**审计归属可伪造**，不是任意越权（后续仍有业务级 assert）。
 *
 * 检查项：
 *   G1 `cloudfunctions/*\/index.js` 里**从 event 读取** `_callerOpenid` 的位置
 *      （`event._callerOpenid`，排除生产者与诊断字段），前后 3 行内必须有 `isNonClientSource()`
 *   G2 出现消费点的文件必须 require 了 `./sourceOrigin`
 *
 * 用法：
 *   node miniprogram/scripts/check-caller-openid-gate.mjs
 *   node miniprogram/scripts/check-caller-openid-gate.mjs --selftest
 * 退出码：缺门为 1。
 */
'use strict'

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const CF = join(MP, 'cloudfunctions')

const WINDOW = 3

/**
 * 该行是否在**从 event 读取** `_callerOpenid`（= 把调用方可控字段当身份用）。
 *
 * 只认 `event._callerOpenid` 这一形态，其余一律不算消费点：
 *   · `payload._callerOpenid = actorOpenid` / `{ _callerOpenid: openid }` —— 是**生产**（往下游传），
 *     值来自服务端已确认的 openid；
 *   · `hasCallerOpenid: !!(event && event._callerOpenid)` —— 诊断日志字段，不参与鉴权；
 *   · 注释里的提及。
 */
export function isIdentityConsumer(line) {
  const t = String(line).trim()
  if (!/event\._callerOpenid/.test(t)) return false
  if (/^\s*\/\//.test(t) || /^\s*\*/.test(t)) return false
  if (/hasCallerOpenid\s*:/.test(t)) return false
  if (/_callerOpenid\s*:/.test(t)) return false
  return true
}

/**
 * 纯函数：扫一段源码，返回问题列表。
 * @param {string} src
 * @param {string} file 仅用于报错文案
 * @returns {string[]}
 */
export function scanSource(src, file = '(inline)') {
  const lines = String(src).split('\n')
  const problems = []
  const consumes = []
  lines.forEach((l, i) => {
    if (isIdentityConsumer(l)) consumes.push(i)
  })
  if (!consumes.length) return problems

  if (!/require\(\s*'\.\/sourceOrigin'\s*\)/.test(src)) {
    problems.push(`${file} 消费 _callerOpenid 但未 require('./sourceOrigin')`)
  }
  for (const i of consumes) {
    const from = Math.max(0, i - WINDOW)
    const to = Math.min(lines.length - 1, i + WINDOW)
    const window = lines.slice(from, to + 1).join('\n')
    if (!/isNonClientSource\s*\(/.test(window)) {
      problems.push(
        `${file}:${i + 1} 消费 _callerOpenid 但附近没有 isNonClientSource() 来源门`
        + ` —— 客户端可伪造操作人身份，审计归属失真`
      )
    }
  }
  return problems
}

function scanRepo() {
  const problems = []
  let files = 0
  let consumes = 0
  for (const entry of readdirSync(CF, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const f = join(CF, entry.name, 'index.js')
    let src
    try { src = readFileSync(f, 'utf8') } catch { continue }
    if (!/_callerOpenid/.test(src)) continue
    files += 1
    const lines = src.split('\n')
    consumes += lines.filter((l) => isIdentityConsumer(l)).length
    problems.push(...scanSource(src, `cloudfunctions/${entry.name}/index.js`))
  }
  return { problems, files, consumes }
}

function selftest() {
  let bad = 0
  const t = (n, ok) => { if (!ok) bad += 1; console.log(`${ok ? '✓' : '✗'} ${n}`) }
  const REQ = "const { isNonClientSource } = require('./sourceOrigin')\n"

  t('★ 漏门形态必须被检出（managerShipOrder 的历史形态）',
    scanSource(`${REQ}if (!openid && event && event._fromApproval && event._callerOpenid) {`).length === 1)
  t('★ 对照：带门形态通过',
    scanSource(`${REQ}if (!openid && isNonClientSource() && event && event._fromApproval && event._callerOpenid) {`).length === 0)
  t('★ 门在邻近行也算（grantStorePoints 的 forwarded 拆行写法）',
    scanSource(`${REQ}const forwarded = !!(event && event._callerOpenid && event._fromApproval)\nif (!openid && isNonClientSource() && forwarded) {`).length === 0)
  t('  生产者（对象字面量 _callerOpenid: openid）不被误报',
    scanSource(`${REQ}await call({ _callerOpenid: openid })`).length === 0)
  t('  生产者（属性赋值 payload._callerOpenid）不被误报',
    scanSource(`${REQ}payload._callerOpenid = actorOpenid`).length === 0)
  t('  诊断日志字段 hasCallerOpenid 不被误报（grantStorePoints 的真实形态）',
    scanSource(`${REQ}console.warn('x', JSON.stringify({ hasCallerOpenid: !!(event && event._callerOpenid) }))`).length === 0)
  t('  注释里的 _callerOpenid 不被误报',
    scanSource(`${REQ}// 说明：_callerOpenid 由上游注入\nconst a = 1`).length === 0)
  t('★ 未 require sourceOrigin 会被单独点名',
    scanSource(`if (!openid && isNonClientSource() && event._callerOpenid) {`).some((p) => /未 require/.test(p)))
  t('  完全不涉及 _callerOpenid 的文件不报错', scanSource('const a = 1').length === 0)

  if (bad) {
    console.error(`\n自检失败 ${bad} 项 —— 守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：漏门必检出、带门不误报、生产者与注释不误报')
}

function main() {
  if (process.argv.includes('--selftest')) return selftest()
  const { problems, files, consumes } = scanRepo()
  if (problems.length) {
    console.error(`✗ 身份透传缺来源门 ${problems.length} 处：`)
    problems.forEach((p) => console.error(`  - ${p}`))
    console.error('\n修法：`if (!openid && isNonClientSource() && event._fromApproval && event._callerOpenid)`')
    process.exit(1)
  }
  console.log(`✓ 身份透传来源门齐全（${files} 个函数、${consumes} 处消费点）`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
