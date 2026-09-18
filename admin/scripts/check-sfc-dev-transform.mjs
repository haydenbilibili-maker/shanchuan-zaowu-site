#!/usr/bin/env node
/**
 * 验收环境编译守卫（dev 管线，非 `vite build`）
 *
 * 为什么需要它（2026-09-16 实测）：
 * `unknownTabs` 的可见告警曾被放进 `<keep-alive>` 里（keep-alive 只接受恰好一个子节点），
 * 于是 `admin/src/App.vue` 在 **dev 管线** 编译失败：
 *   · `curl http://localhost:5178/admin/src/App.vue` → HTTP 500
 *   · 浏览器整页停在 index.html 的「加载中…」占位，Vue 根本没 mount
 * 而 `npm run build:admin`（= `vite build`）**退出码 0、打印「✓ 已构建」**，
 * 因为生产构建走 inlineTemplate 路径，不复现这条编译错误。
 * 实测对照（同一份损坏模板）：
 *   vite build      → exit 0，产物正常
 *   vite dev 管线   → throw `<KeepAlive> expects exactly one child component.`
 * 也就是说：**只跑 build 无法证明用户的验收地址能用**。本守卫补上这一环。
 *
 * 做法：用 admin 自己的 vite.config.js 起一个 middleware 模式 dev server（不监听端口、
 * 不碰网络），把 `src/` 下每个 .js/.vue 都过一遍真实的 dev transform。
 * 这同时也校验了「静态 import 全部可解析」。
 *
 * 用法：
 *   node admin/scripts/check-sfc-dev-transform.mjs
 *   node admin/scripts/check-sfc-dev-transform.mjs --selftest   # 证明能失败
 */
'use strict'

import { readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ADMIN = resolve(HERE, '..')
const SRC = join(ADMIN, 'src')
const SELFTEST_FILE = join(SRC, '__selftest_broken.vue')

const argv = process.argv.slice(2)

/** 递归收集待编译文件（.js / .vue，跳过 .d.ts 与临时自检文件） */
function collect(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (name.startsWith('__selftest_')) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...collect(full))
    else if (/\.(vue|js)$/.test(name) && !name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

const toRequestUrl = (abs) => '/' + relative(ADMIN, abs).split(sep).join(posix.sep)

/** @returns {Promise<{failures: Array<{file: string, message: string}>, ok: number, total: number, warnings: number}>} */
export async function runChecks({ extraFiles = [] } = {}) {
  const { createServer } = await import('vite')
  const server = await createServer({
    configFile: join(ADMIN, 'vite.config.js'),
    root: ADMIN,
    server: { middlewareMode: true, hmr: false },
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true },
  })

  // extraFiles 用于自检：collect() 会跳过 __selftest_* 以免残留文件干扰正常巡检，
  // 所以自检样本必须显式传入，否则自检会「因为没编译到而假通过」。
  const files = [...collect(SRC), ...extraFiles]
  const failures = []
  let ok = 0
  // 暂时收走 console.warn：@vue/compiler-sfc 的 ::v-deep 弃用提示会刷屏，
  // 但它不是失败项，只统计条数（作为单独的清理线索）。
  const realWarn = console.warn
  let warnings = 0
  console.warn = () => { warnings += 1 }
  try {
    for (const abs of files) {
      const url = toRequestUrl(abs)
      try {
        const res = await server.transformRequest(url)
        if (!res || typeof res.code !== 'string' || !res.code.length) {
          failures.push({ file: url, message: 'transform 返回空结果' })
        } else {
          ok += 1
        }
      } catch (e) {
        failures.push({ file: url, message: String(e?.message || e).split('\n')[0] })
      }
    }
  } finally {
    console.warn = realWarn
    await server.close()
  }
  return { failures, ok, total: files.length, warnings }
}

if (argv.includes('--selftest')) {
  // 2026-09-19 实测：旧样本注入的是「<keep-alive> 里放两个子节点」，但当前工具链下
  // @vue/compiler-sfc 已不再把它当编译错误 —— transformRequest 正常返回 code，
  // runChecks 里一条 failure 都没有，自检因此恒假绿。这是注入样本过时，不是守卫能力退化。
  // 故换成当前工具链确实会在编译期拒绝的「元素未闭合」（真实开发中最常见的模板手误）。
  // 不要再改回 keep-alive：它不会红。本仓库错题本 E7：不许为了变绿放宽/删掉判据。
  console.log('自检：注入「元素未闭合」的真实故障，守卫必须检出\n')
  const broken = `<template>
  <div class="selftest-root">
    <span>自检样本</span>
</template>
<script setup>
const n = 1
</script>
`
  let detected = false
  let reason = ''
  try {
    writeFileSync(SELFTEST_FILE, broken, 'utf8')
    const { failures } = await runChecks({ extraFiles: [SELFTEST_FILE] })
    // 判据必须盯住本次注入缺陷对应的报错，而不是「有失败项就行」——
    // 否则将来任何别的文件编译失败都会让自检假绿。
    const hit = failures.find((f) => /__selftest_broken\.vue/.test(f.file) && /Element is missing end tag/i.test(f.message))
    detected = !!hit
    reason = hit ? `${hit.file} → ${hit.message}` : (failures[0] ? `${failures[0].file} → ${failures[0].message}` : '(无失败项)')
  } catch (e) {
    reason = `构造/执行异常：${e.message}`
  } finally {
    try { unlinkSync(SELFTEST_FILE) } catch { /* ignore */ }
  }
  console.log(`${detected ? '✓' : '✗'} 未闭合的元素 → ${detected ? '已检出' : '【漏检】'}`)
  console.log(`    · ${reason}`)
  console.log()
  if (!detected) {
    console.error('自检失败：注入的编译错误未被检出，守卫不可信。')
    process.exit(1)
  }
  console.log('自检通过：dev 管线编译错误会被拦住。\n')
}

const { failures, ok, total, warnings } = await runChecks()
console.log(`验收环境编译守卫（dev 管线）：${ok}/${total} 个 src 文件编译通过，${failures.length} 个失败`)
if (warnings) console.log(`（另有 ${warnings} 条 @vue/compiler-sfc 弃用提示，如 ::v-deep，不影响编译）`)
if (failures.length) {
  console.error('\n失败明细（这些会让 localhost:5178/admin/ 白屏或停在「加载中…」）：')
  failures.forEach((f) => console.error(`  ✗ ${f.file}\n      ${f.message}`))
  process.exit(1)
}
console.log('全部通过：src 下所有 .js/.vue 都能被 dev server 编译，且静态 import 均可解析。')
