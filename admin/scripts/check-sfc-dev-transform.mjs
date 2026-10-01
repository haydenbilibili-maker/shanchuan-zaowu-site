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
 * 这同时也校验了「静态 import 全部可解析」，并对账 src 内「具名导入的名字在目标模块里真的导出了」。
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

/**
 * 具名导入 ↔ 导出对账（2026-10-01 实测）：`blessTags.js` 被改成 `module.exports` 后，
 * dev transform 照常成功、import 路径也能解析，本守卫全绿；但浏览器报
 * `does not provide an export named 'BLESS_TAGS'`，整个 ERP 停在「加载中…」。
 * 所以光「能编译 + 能解析」不够，还要核对 src 内模块之间的导入名在目标模块里真的导出了。
 * 判据跑在 dev transform 的**产物**上（与浏览器拿到的代码同一份），只认行首 import/export。
 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')

function parseExports(code) {
  const names = new Set()
  if (/^export\s*\*/m.test(code) || /^export\s+(?:const|let|var)\s*[{[]/m.test(code)) return null
  for (const m of code.matchAll(/^export\s+(?:async\s+)?function\s*\*?\s*([\w$]+)/gm)) names.add(m[1])
  for (const m of code.matchAll(/^export\s+(?:const|let|var|class)\s+([\w$]+)/gm)) names.add(m[1])
  for (const m of code.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of stripComments(m[1]).split(',')) {
      const seg = part.trim().split(/\s+as\s+/)
      const name = (seg[1] || seg[0] || '').trim()
      if (name) names.add(name)
    }
  }
  if (/^export\s+default\b/m.test(code)) names.add('default')
  return names
}

function parseImports(code) {
  const out = []
  const push = (clause, spec, reexport) => {
    const c = stripComments(clause).trim()
    if (/^type\b/.test(c)) return
    const names = []
    const brace = c.match(/\{([\s\S]*)\}/)
    if (brace) {
      for (const part of brace[1].split(',')) {
        const p = part.trim()
        if (!p || /^type\s/.test(p)) continue
        names.push(p.split(/\s+as\s+/)[0].trim())
      }
    }
    if (!reexport) {
      const head = c.replace(/\{[\s\S]*\}/, '').split(',')[0].trim()
      if (head && !head.startsWith('*')) names.push('default')
    }
    out.push({ spec, names })
  }
  // dev 产物会把 `import.meta.env = {…};` 注入在第一条 import 同一行之前，故允许 `;` 作为语句起点
  for (const m of code.matchAll(/(?:^|;)\s*import\s+([\w$\s,{}*]+?)\s+from\s*["']([^"']+)["']/gm)) push(m[1], m[2], false)
  for (const m of code.matchAll(/^export\s*(\{[^}]*\})\s*from\s*["']([^"']+)["']/gm)) push(m[1], m[2], true)
  return out
}

/** @returns {{failures: Array<{file: string, message: string}>, edges: number, names: number}} */
export function checkNamedImports(codeByUrl) {
  const failures = []
  let edges = 0
  let checkedNames = 0
  const exportsByUrl = new Map()
  for (const [url, code] of codeByUrl) exportsByUrl.set(url, parseExports(code))
  for (const [url, code] of codeByUrl) {
    for (const { spec, names } of parseImports(code)) {
      // dev 产物的说明符带 base（`/admin/src/…`），键是 `/src/…`
      const target = spec.split('?')[0].replace(/^\/[^/]+(?=\/src\/)/, '')
      if (!exportsByUrl.has(target)) continue
      const exported = exportsByUrl.get(target)
      if (!exported) continue
      edges += 1
      checkedNames += names.length
      const missing = names.filter((n) => !exported.has(n))
      if (missing.length) {
        failures.push({ file: url, message: `具名导入不存在：${target} 没有导出 ${missing.join(', ')}（CommonJS 写法或改名都会这样；浏览器里整页停在「加载中…」）` })
      }
    }
  }
  return { failures, edges, names: checkedNames }
}

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
  const codeByUrl = new Map()
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
          codeByUrl.set(url, res.code)
        }
      } catch (e) {
        failures.push({ file: url, message: String(e?.message || e).split('\n')[0] })
      }
    }
  } finally {
    console.warn = realWarn
    await server.close()
  }
  const named = checkNamedImports(codeByUrl)
  failures.push(...named.failures)
  return { failures, ok, total: files.length, warnings, importEdges: named.edges, importNames: named.names }
}

if (argv.includes('--selftest')) {
  // 2026-09-19 实测：旧样本注入的是「<keep-alive> 里放两个子节点」，但当前工具链下
  // @vue/compiler-sfc 已不再把它当编译错误 —— transformRequest 正常返回 code，
  // runChecks 里一条 failure 都没有，自检因此恒假绿。这是注入样本过时，不是守卫能力退化。
  // 故换成当前工具链确实会在编译期拒绝的「元素未闭合」（真实开发中最常见的模板手误）。
  // 不要再改回 keep-alive：它不会红。本仓库错题本 E7：不许为了变绿放宽/删掉判据。
  console.log('自检：注入「元素未闭合」「CJS 被具名导入」「导出改名」三种真实故障，守卫必须逐一检出\n')
  const broken = `<template>
  <div class="selftest-root">
    <span>自检样本</span>
</template>
<script setup>
const n = 1
</script>
`
  // 具名导入样本：复刻 2026-10-01 blessTags.js 事故（CJS 被具名导入）与「导出改名、导入没跟上」
  const SELFTEST_CJS = join(SRC, '__selftest_cjs_lib.js')
  const SELFTEST_ESM = join(SRC, '__selftest_esm_lib.js')
  const SELFTEST_USER = join(SRC, '__selftest_named_user.js')
  const samples = [
    [SELFTEST_FILE, broken],
    [SELFTEST_CJS, "const BLESS_TAGS = []\nmodule.exports = { BLESS_TAGS }\n"],
    [SELFTEST_ESM, "export const renamedTags = []\nexport function keepMe() { return 1 }\n"],
    [SELFTEST_USER, "import { BLESS_TAGS } from './__selftest_cjs_lib.js'\nimport { keepMe, oldTags } from './__selftest_esm_lib.js'\nexport const n = [BLESS_TAGS, keepMe, oldTags]\n"]
  ]
  const expectations = [
    ['未闭合的元素', (f) => /__selftest_broken\.vue/.test(f.file) && /Element is missing end tag/i.test(f.message)],
    ['CommonJS 模块被具名导入', (f) => /__selftest_named_user\.js/.test(f.file) && /__selftest_cjs_lib\.js 没有导出 BLESS_TAGS/.test(f.message)],
    ['导出改名、导入没跟上（只报缺的那个）', (f) => /__selftest_named_user\.js/.test(f.file) && /__selftest_esm_lib\.js 没有导出 oldTags（/.test(f.message)]
  ]
  let allDetected = true
  try {
    for (const [file, src] of samples) writeFileSync(file, src, 'utf8')
    const { failures } = await runChecks({ extraFiles: samples.map(([file]) => file) })
    // 判据必须盯住本次注入缺陷对应的报错，而不是「有失败项就行」——
    // 否则将来任何别的文件编译失败都会让自检假绿。
    for (const [name, match] of expectations) {
      const hit = failures.find(match)
      if (!hit) allDetected = false
      console.log(`${hit ? '✓' : '✗'} ${name} → ${hit ? '已检出' : '【漏检】'}`)
      console.log(`    · ${hit ? `${hit.file} → ${hit.message}` : (failures[0] ? `${failures[0].file} → ${failures[0].message}` : '(无失败项)')}`)
    }
  } catch (e) {
    allDetected = false
    console.log(`✗ 构造/执行异常：${e.message}`)
  } finally {
    for (const [file] of samples) {
      try { unlinkSync(file) } catch { /* ignore */ }
    }
  }
  console.log()
  if (!allDetected) {
    console.error('自检失败：注入的故障未被全部检出，守卫不可信。')
    process.exit(1)
  }
  console.log('自检通过：dev 管线编译错误与不存在的具名导入都会被拦住。\n')
}

const { failures, ok, total, warnings, importEdges, importNames } = await runChecks()
console.log(`验收环境编译守卫（dev 管线）：${ok}/${total} 个 src 文件编译通过，${failures.length} 个失败`)
console.log(`具名导入对账：src 内 ${importEdges} 条模块引用、${importNames} 个导入名逐一核对了目标模块的导出`)
if (importEdges < 50) {
  console.error('具名导入对账覆盖异常：src 内模块引用不足 50 条，解析规则可能已与 dev 产物格式脱节（判据失效 ≠ 通过）')
  process.exit(1)
}
if (warnings) console.log(`（另有 ${warnings} 条 @vue/compiler-sfc 弃用提示，如 ::v-deep，不影响编译）`)
if (failures.length) {
  console.error('\n失败明细（这些会让 localhost:5178/admin/ 白屏或停在「加载中…」）：')
  failures.forEach((f) => console.error(`  ✗ ${f.file}\n      ${f.message}`))
  process.exit(1)
}
console.log('全部通过：src 下所有 .js/.vue 都能被 dev server 编译，且静态 import 均可解析。')
