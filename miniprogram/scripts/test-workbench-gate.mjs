#!/usr/bin/env node
/**
 * test:workbench-gate —— 「我的」工作台只展示给授权用户，C 端普通用户不出现（2026-11-25 产品负责人核查）
 *
 *   W1 面板渲染条件 = workbenchTiles.length > 0（无权限时列表为空 → 整块不渲染）
 *   W2 瓦片构造器在 entries 为空时直接返回 []（不塞默认瓦片）
 *   W3 首屏本地快照必须**归属当前 openid**（双方都非空且相等），否则不预渲染 —— 防止没登录 / 换号时画出上一位员工的工台
 *   W4 会话回来若没有任何工作台权限 → 清掉本地快照与瓦片状态
 *
 *   node miniprogram/scripts/test-workbench-gate.mjs [--selftest]
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MP = join(dirname(fileURLToPath(import.meta.url)), '..')
const F = {
  pageJs: join(MP, 'pages/user/index.js'),
  pageWxml: join(MP, 'pages/user/index.wxml')
}

let INJECT = null
const transform = (file, src) => {
  if (!INJECT || INJECT.file !== file) return src
  if (src.indexOf(INJECT.find) === -1) throw new Error(`注入锚点失效：${INJECT.name}`)
  return src.replace(INJECT.find, INJECT.replace)
}
const read = (f) => transform(f, readFileSync(f, 'utf8'))

function runChecks() {
  const fails = []
  const ok = (cond, msg) => { if (!cond) fails.push(msg) }
  const js = read(F.pageJs)
  const wxml = read(F.pageWxml)

  ok(/wx:if="\{\{workbenchTiles\.length > 0\}\}"/.test(wxml), 'W1 工作台面板没有按 workbenchTiles.length > 0 渲染')
  ok(/function buildWorkbenchTilesFromCounts\(entries, counts = \{\}\) \{\s*\n\s*const list = Array\.isArray\(entries\) \? entries : \[\];\s*\n\s*if \(!list\.length\) return \[\];/.test(js),
    'W2 瓦片构造器在 entries 为空时没有直接返回 []（可能给无权限用户画默认瓦片）')
  ok(/if \(!openid \|\| !raw\.openid \|\| raw\.openid !== openid\) return null/.test(js),
    'W3 本地快照没有严格校验 openid（空 openid 放行会让 C 端首屏画出员工工台）')
  ok(/if \(!entries\.length\) clearWorkbenchBadgeCache\(\)/.test(js),
    'W4 会话无任何工作台权限时没有清掉本地快照')
  return fails
}

if (process.argv.includes('--selftest')) {
  const base = runChecks()
  if (base.length) { console.error('✗ 自检前提：真源须先通过\n  - ' + base.join('\n  - ')); process.exit(1) }
  const INJ = [
    { name: '面板去掉条件', file: F.pageWxml, find: ' wx:if="{{workbenchTiles.length > 0}}"', replace: '' },
    { name: '无权限也画瓦片', file: F.pageJs, find: "  if (!list.length) return [];\n", replace: '' },
    { name: '快照放行空 openid', file: F.pageJs, find: 'if (!openid || !raw.openid || raw.openid !== openid) return null', replace: 'if (openid && raw.openid && raw.openid !== openid) return null' },
    { name: '无权限不清缓存', file: F.pageJs, find: 'if (!entries.length) clearWorkbenchBadgeCache();', replace: '' }
  ]
  let bad = 0
  for (const inj of INJ) {
    INJECT = inj
    let res = []
    try { res = runChecks() } catch (e) { res = [String(e.message || e)] }
    if (res.length && /注入锚点失效/.test(res[0])) { bad++; console.log(`✗ 注入「${inj.name}」→ 锚点失效`) }
    else if (res.length) console.log(`✓ 注入「${inj.name}」→ 检出（${res[0]}）`)
    else { bad++; console.log(`✗ 注入「${inj.name}」→ 未检出`) }
  }
  INJECT = null
  if (bad) { console.error(`\n✗ test:workbench-gate 自检失败 ${bad} 项`); process.exit(1) }
  console.log(`✓ 自检通过：${INJ.length} 条注入全部检出（内存副本，不写盘）`)
} else {
  const fails = runChecks()
  if (fails.length) { console.error('✗ 工作台可见性不合格：\n  - ' + fails.join('\n  - ')); process.exit(1) }
  console.log('✓ test:workbench-gate：面板条件 / 无权限空列表 / 快照 openid 严格匹配 / 无权限清缓存 全部通过')
}
