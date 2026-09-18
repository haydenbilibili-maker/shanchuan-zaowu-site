#!/usr/bin/env node
/**
 * 藏品保存字段完整性守卫
 *
 * 为什么需要（2026-09-20 真机反馈）：
 *   店长端「一键补齐」给出文艺主题名候选，选中后写进表单，**保存后不生效、再进来是空白**。
 *   根因不是云函数、也不是表单，而是两者中间那一步：
 *     · 云函数 `manageProducts` 的 `ALLOWED_FIELDS` 里有 `themeName` / `themeNote`（:63）；
 *     · 表单 `_subviews.wxml` 也绑了 `tempProduct.themeName` / `themeNote`；
 *     · **唯独 `submitProduct()` 拼的载荷里没有这两个键** ——
 *       服务端 `pickFields()` 只挑白名单里**收到的**键，没送过去的它无从落库，
 *       而界面照样提示「已保存」→ 用户以为存了，其实一个字没提交。
 *
 *   云函数那段注释自己写着「每加一个商品级字段，这里与小程序藏品表单必须同时改（守卫有结构断言）」
 *   —— 但实测**那条结构断言并不存在**：全仓唯一碰 `ALLOWED_FIELDS` 的检查是
 *   `check-bless-tags-sync.mjs`，且它只看 `blessTags` 一项。所以 `themeName` 才能漏过去。
 *   本守卫把那条链补上：**白名单 ∩ 表单可编辑 ⊆ 保存载荷**。
 *
 * 判据（刻意窄，避免假阳性）：
 *   1. 「表单可编辑」= `_subviews.wxml` 里**同时**带 `bindinput="bindPInput"` 与 `data-field="X"`
 *      的元素。`bindPInput` 是藏品表单专属处理器 —— 用它可以精确圈定藏品表单，
 *      而不会把同页的 banner / customConfig 表单（它们的 `data-field="sort"` 等）算进来
 *      （首次实现时用全页 `data-field` 扫，多出 `sort` 等假阳性，已收窄）。
 *   2. 「在载荷里」= `submitProduct()` 中 `const data = { … }` 对象字面量的键。
 *   3. 三者同时满足却不相等 → 检出，并列出缺失字段。
 *
 * 例外必须**逐条登记且带理由**（`EXEMPT`），且过期的例外会被点名（只许变小）。
 *
 * 用法：
 *   node miniprogram/scripts/check-product-save-fields.mjs
 *   node miniprogram/scripts/check-product-save-fields.mjs --selftest
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (f) => readFileSync(resolve(ROOT, f), 'utf8')

const CLOUD_FN = 'miniprogram/cloudfunctions/manageProducts/index.js'
const FORM_WXML = 'miniprogram/subpackages/manager/manager/workspace/_subviews.wxml'
const PAGE_JS = 'miniprogram/subpackages/manager/manager/managerPageConfig.js'

/**
 * 允许「白名单 + 表单有，但载荷故意不放」的字段。**每条必须写清理由**，
 * 且必须在载荷或表单里仍然存在（否则是过期例外，会判红 —— 例外只许变小）。
 */
const EXEMPT = {
  // 例：{ field: 'xxx', why: '由另一个专用接口（action=xxx）单独写，不走 upsert 载荷' }
}

function parseAllowedFields(src) {
  const m = /const ALLOWED_FIELDS = \[(.*?)\n\]/s.exec(src)
  if (!m) throw new Error('manageProducts 里找不到 ALLOWED_FIELDS')
  return new Set([...m[1].matchAll(/'([a-zA-Z][a-zA-Z0-9]*)'/g)].map((x) => x[1]))
}

/** 藏品表单可编辑字段：**任意标签**同时带 bindinput="bindPInput" 与 data-field="X"。
 *  刻意不限定 `<input>` —— 藏品表单里还有 `<textarea>`（描述）等控件；
 *  限定标签类型会让判据**悄悄漏掉**那些字段（本守卫第一次实现就漏了 2 个，已放宽）。 */
function parseProductFormFields(src) {
  const out = new Set()
  for (const m of src.matchAll(/<[a-zA-Z-]+\b[^>]*>/g)) {
    const tag = m[0]
    if (!/bindinput="bindPInput"/.test(tag)) continue
    const f = /data-field="([a-zA-Z][a-zA-Z0-9]*)"/.exec(tag)
    if (f) out.add(f[1])
  }
  return out
}

/** submitProduct 里 `const data = { … }` 的键 */
function parsePayloadFields(src) {
  const start = src.indexOf('const data = {\n        title: p.title,')
  if (start === -1) throw new Error('submitProduct 里找不到载荷对象（锚点变了？）')
  const end = src.indexOf('\n      };', start)
  if (end === -1) throw new Error('载荷对象没有正常收尾（锚点变了？）')
  const body = src.slice(start, end)
  const keys = new Set()
  for (const m of body.matchAll(/^\s{8}([a-zA-Z][a-zA-Z0-9]*)\s*[:,]/gm)) keys.add(m[1])
  return keys
}

function inspect() {
  const allowed = parseAllowedFields(read(CLOUD_FN))
  const formFields = parseProductFormFields(read(FORM_WXML))
  const payload = parsePayloadFields(read(PAGE_JS))
  const shouldPersist = [...allowed].filter((f) => formFields.has(f))
  const missing = shouldPersist.filter((f) => !payload.has(f) && !EXEMPT[f])
  const staleExempt = Object.keys(EXEMPT).filter((f) => !payload.has(f) || !formFields.has(f))
  return { allowed, formFields, payload, shouldPersist, missing, staleExempt }
}

function main() {
  const { allowed, formFields, payload, shouldPersist, missing, staleExempt } = inspect()
  let bad = 0
  const fail = (msg) => {
    bad += 1
    console.error(`✗ ${msg}`)
  }

  console.log(
    `藏品保存字段：白名单 ${allowed.size} · 表单可编辑 ${formFields.size} · 载荷 ${payload.size} · 应落库 ${shouldPersist.length}`
  )

  if (missing.length) {
    fail(
      `白名单与表单都有、但**载荷里没有**（保存会静默丢字段，界面仍提示"已保存"）：\n` +
        missing.map((f) => `    · ${f}  ← 补进 submitProduct 的 data，或在 EXEMPT 登记理由`).join('\n')
    )
  }
  if (staleExempt.length) {
    fail(`EXEMPT 里有过期例外（该字段已不在载荷缺失集里）——例外只许变小，请删掉：${staleExempt.join(', ')}`)
  }
  if (!shouldPersist.length) fail('应落库字段集为空 —— 锚点大概率失效（判据自身坏了，不是"通过"）')

  if (bad) {
    console.error(`\n✗ 藏品保存字段守卫失败 ${bad} 项`)
    process.exit(1)
  }
  console.log('✓ 藏品保存字段：白名单 ∩ 表单可编辑 ⊆ 保存载荷（无静默丢弃）')
}

function selftest() {
  const before = read(PAGE_JS)
  const sha = (s) => {
    // 极简校验和即可 —— 只用于证明"逐字节还原"
    let h = 0
    for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0
    return String(h)
  }
  const h0 = sha(before)
  let ok = 0
  let bad = 0
  const t = (name, cond) => {
    if (cond) {
      ok += 1
      console.log(`✓ ${name}`)
    } else {
      bad += 1
      console.error(`✗ ${name}`)
    }
  }

  // ① 基线：当前仓库必须通过
  const base = inspect()
  t('基线：当前仓库通过（无缺失、无过期例外）', base.missing.length === 0 && base.staleExempt.length === 0)

  // ② 注入：把 themeName 从载荷里抽掉 → 必须检出
  try {
    const injected = before.replace('        themeName: p.themeName || \'\',\n', '')
    t('注入锚点命中（themeName 那一行存在）', injected !== before)
    writeFileSync(resolve(ROOT, PAGE_JS), injected)
    const after = inspect()
    t('★ 被检出：载荷少了 themeName', after.missing.includes('themeName'))
    t('★ 被检出后缺失集非空（守卫确实会红）', after.missing.length > 0)
  } finally {
    writeFileSync(resolve(ROOT, PAGE_JS), before)
  }

  // ③ 逐字节还原
  t('源文件逐字节还原', sha(read(PAGE_JS)) === h0)
  t('还原后守卫恢复通过', (() => {
    const r = inspect()
    return r.missing.length === 0 && r.staleExempt.length === 0
  })())

  if (bad) {
    console.error(`\n✗ 自检失败 ${bad} 项`)
    process.exit(1)
  }
  console.log(`\n✓ 自检通过：${ok} 项（注入被检出 + 源文件逐字节还原）`)
}

if (process.argv.includes('--selftest')) selftest()
else main()
