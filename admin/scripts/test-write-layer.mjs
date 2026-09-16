#!/usr/bin/env node
/**
 * 写层回归测试（审计 §0 P0-7）
 *
 * 被修的 bug：`cdnUpsertDoc` 原本是 `try { update } catch { add }`。
 * CloudBase 的 `update` 对**不存在的文档**返回 `{updated: 0}` 而**不抛错** →
 * `catch` 永不触发、`add` 永不执行 → 「首次保存静默丢失」，而调用方照样弹「保存成功」。
 *
 * 这个 bug 的本质是「静默」，所以**只有测试能防回归**。本文件同时：
 *   1. 用 fixture 覆盖真实 SDK 的返回形状（含 `{updated:0}` 不抛错这一关键语义）；
 *   2. 跑 `--selftest` 时把被测模块复制一份、**改回旧的 buggy 实现**，
 *      断言测试必须失败 —— 证明这套测试真的能抓住那个 bug，而不是空转。
 *
 * 用法：
 *   node admin/scripts/test-write-layer.mjs
 *   node admin/scripts/test-write-layer.mjs --selftest
 */
'use strict'

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MODULE_PATH = resolve(HERE, '..', 'src', 'utils', 'cloudbaseCdnDb.js')
const TMP_PATH = resolve(HERE, '..', 'src', 'utils', '__selftest_buggy.js')

/** 断言小工具 */
function makeAsserter() {
  const failures = []
  let pass = 0
  return {
    ok(name, cond, detail) {
      if (cond) pass += 1
      else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    },
    eq(name, actual, expected) {
      const a = JSON.stringify(actual)
      const e = JSON.stringify(expected)
      if (a === e) pass += 1
      else failures.push(`${name} — 期望 ${e}，实际 ${a}`)
    },
    result: () => ({ failures, pass })
  }
}

/** 真实 CloudBase 返回形状的 fixture */
const SHAPES = [
  ['update 命中：{updated:1}', { updated: 1 }, true],
  ['update 未命中：{updated:0}（关键：不抛错）', { updated: 0 }, false],
  ['update 旧式：{stats:{updated:1}}', { stats: { updated: 1 } }, true],
  ['update 旧式未命中：{stats:{updated:0}}', { stats: { updated: 0 } }, false],
  ['add 成功：{_id:"x"}', { _id: 'x' }, true],
  ['云函数代理成功：{success:true,id:"x"}', { success: true, id: 'x' }, true],
  ['云函数代理失败：{success:false,msg:"..."}', { success: false, msg: '集合未授权' }, false],
  ['set upsert：{upsertedId:"x"}', { upsertedId: 'x' }, true],
  ['remove 成功：{deleted:1}', { deleted: 1 }, true],
  ['remove 未命中：{deleted:0}', { deleted: 0 }, false],
  // ★ 2026-09-16 真实浏览器匿名会话实测到的形状：权限被拒时 SDK **不抛错**，
  //   而是 resolve 一个带错误码的对象。原实现落到 `return true` → 假成功。
  ['权限被拒（实测形状）：{code:"DATABASE_PERMISSION_DENIED"}', { code: 'DATABASE_PERMISSION_DENIED', message: 'Permission denied', requestId: 'x' }, false],
  ['嵌套错误：{error:{code:"X"}}', { error: { code: 'X' } }, false],
  ['未识别形状按已生效但会 warn（不制造假失败）：{foo:1}', { foo: 1 }, true],
  ['形状未知：null', null, true]
]

/** 针对被测模块跑全套断言；modulePath 可指向「改回 bug 的副本」用于自检 */
async function runSuite(modulePath) {
  const mod = await import(`file://${modulePath}?t=${Date.now()}`)
  const { writeApplied, assertWriteApplied, WriteNotAppliedError, cdnUpsertDoc } = mod

  const t = makeAsserter()

  // ① 判定器本身
  SHAPES.forEach(([name, res, expected]) => t.eq(`writeApplied ${name}`, writeApplied(res), expected))
  t.ok(
    'assertWriteApplied 未生效时抛 WriteNotAppliedError',
    (() => {
      try {
        assertWriteApplied('c', { updated: 0 }, 'update')
        return false
      } catch (e) {
        return e instanceof WriteNotAppliedError && /保存未生效/.test(e.message)
      }
    })()
  )
  t.ok(
    'assertWriteApplied 生效时不抛',
    (() => {
      try {
        assertWriteApplied('c', { updated: 1 }, 'update')
        return true
      } catch {
        return false
      }
    })()
  )

  // ② P0-7 的核心：首次保存（update 返回 updated:0 且不抛错）必须转 add
  {
    let addCalled = null
    const res = await cdnUpsertDoc('marketing_rules_config', 'singleton', { a: 1 }, {
      update: async () => ({ updated: 0 }),
      add: async (col, payload) => {
        addCalled = { col, payload }
        return { _id: payload._id }
      }
    })
    t.ok('首次保存：update 未命中时会转 add', addCalled !== null)
    t.eq('首次保存：add 带上同一个 _id', addCalled && addCalled.payload._id, 'singleton')
    t.eq('首次保存：返回 add 的结果', res, { _id: 'singleton' })
  }

  // ③ 已存在文档（update 命中）不应重复 add
  {
    let addCalled = false
    await cdnUpsertDoc('c', 'id1', { a: 2 }, {
      update: async () => ({ updated: 1 }),
      add: async () => {
        addCalled = true
        return { _id: 'id1' }
      }
    })
    t.ok('已存在：update 命中时不得再 add（否则会产生重复文档）', addCalled === false)
  }

  // ④ 「文档不存在」类错误 → 转 add
  {
    let addCalled = false
    await cdnUpsertDoc('c', 'id2', { a: 3 }, {
      update: async () => {
        throw new Error('document does not exist')
      },
      add: async () => {
        addCalled = true
        return { _id: 'id2' }
      }
    })
    t.ok('文档不存在异常：转 add', addCalled === true)
  }

  // ⑤ 权限/网络类错误必须照抛，不得被当成「不存在」而改成新建
  {
    let addCalled = false
    let threw = false
    try {
      await cdnUpsertDoc('c', 'id3', { a: 4 }, {
        update: async () => {
          throw new Error('permission denied')
        },
        add: async () => {
          addCalled = true
          return { _id: 'id3' }
        }
      })
    } catch {
      threw = true
    }
    t.ok('权限错误：必须抛出（不得静默改写为新建）', threw === true)
    t.ok('权限错误：不得调用 add', addCalled === false)
  }

  // ⑥ add 也没写进去 → 必须抛，而不是静默成功
  {
    let threw = false
    try {
      await cdnUpsertDoc('c', 'id4', { a: 5 }, {
        update: async () => ({ updated: 0 }),
        add: async () => ({ updated: 0 })
      })
    } catch (e) {
      threw = e instanceof WriteNotAppliedError
    }
    t.ok('add 未生效：必须抛 WriteNotAppliedError（杜绝假成功）', threw === true)
  }

  return t.result()
}

if (process.argv.includes('--selftest')) {
  console.log('自检：把 cdnUpsertDoc 改回旧的 buggy 实现，测试必须失败\n')
  const src = readFileSync(MODULE_PATH, 'utf8')
  const anchor = 'export async function cdnUpsertDoc(collectionName, docId, data, ops = {}) {'
  const start = src.indexOf(anchor)
  if (start === -1) {
    console.error('自检失败：找不到 cdnUpsertDoc 锚点，无法构造 buggy 版本。')
    process.exit(1)
  }
  const end = src.indexOf('/** 集合仅一条配置时 upsert */', start)
  // 忠实复现旧实现：仍然使用注入的 ops（否则会因为 window 未定义而「假检出」），
  // 但去掉 writeApplied 判定 —— 这正是当时那个 bug：靠 catch 兜底，而 update 对不存在的
  // 文档返回 {updated:0} 并不抛错，于是 add 永不执行、首次保存静默丢失。
  const buggy = `export async function cdnUpsertDoc(collectionName, docId, data, ops = {}) {
  const update = ops.update || cdnUpdate
  const add = ops.add || cdnAdd
  try {
    await update(collectionName, docId, data)
  } catch {
    await add(collectionName, { ...data, _id: docId })
  }
}

`
  writeFileSync(TMP_PATH, src.slice(0, start) + buggy + src.slice(end), 'utf8')
  let isExpectedFailure = false
  let detected = false
  try {
    const { failures } = await runSuite(TMP_PATH)
    detected = failures.length > 0
    // 必须是因为「首次保存没转 add / 假成功」而失败，不能是因为别的无关异常（防假检出）
    isExpectedFailure = failures.some((f) => /首次保存|add 未生效/.test(f))
    console.log(`${detected ? '✓' : '✗'} 旧的 try/catch 实现 → ${detected ? '已检出' : '【漏检】'}`)
    failures.slice(0, 4).forEach((f) => console.log(`    · ${f}`))
  } catch (e) {
    console.log(`✗ 旧实现抛出无关异常（说明自检构造有误，不算有效检出）：${e.message}`)
  } finally {
    try {
      unlinkSync(TMP_PATH)
    } catch {
      /* ignore */
    }
  }
  console.log()
  if (!detected || !isExpectedFailure) {
    console.error('自检失败：必须因「首次保存未转 add / add 未生效被当成功」而失败，否则这套测试不可信。')
    process.exit(1)
  }
  console.log('自检通过：旧的 buggy 实现会因「首次保存静默丢失」被本测试判失败。\n')
}

const { failures, pass } = await runSuite(MODULE_PATH)
console.log(`写层回归测试：${pass} 项通过，${failures.length} 项失败`)
if (failures.length) {
  console.error('\n失败明细：')
  failures.forEach((f) => console.error(`  ✗ ${f}`))
  process.exit(1)
}
console.log('全部通过：写结果判定与 upsert 决策（含「update 返回 updated:0 不抛错」这一关键语义）均正确。')
