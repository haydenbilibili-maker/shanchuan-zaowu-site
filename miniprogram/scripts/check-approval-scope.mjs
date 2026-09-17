#!/usr/bin/env node
/**
 * 审批队列「审级可见性」守卫
 *
 * 背景（2026-09-17 全面审计 P0-18，原结论：**店长级单据在 ERP 永久不可见**）：
 *   `ApprovalQueue.vue` 硬编码 `scope: 'super_admin'`，而服务端 `applyListScope()` 会
 *   据此加 `where.approverRole = scope` → 审级为 `store_manager` 的单据（如 `points_store_grant`
 *   门店赠分）**永远不会出现在列表里**，而 ERP 没有任何替代入口 → 单据永久挂起。
 *
 * 修法（两侧都要对）：
 *   客户端请求「全站」(scope:'all')；服务端对**非超管 workspace** 强制降级为店长审级
 *   （客户端不能靠改请求放权）；服务端逐行返回 `canDecide`，客户端据此门控按钮。
 *
 * 本守卫把这三条钉住：
 *   A1 客户端不得硬编码 `scope: 'super_admin'`，且必须请求 'all'
 *   A2 客户端按钮必须按 `canDecide` 门控（不能只看 status）
 *   A3 服务端必须把非超管的 `all` 降级为店长审级（防止客户端越权放宽）
 *   A4 服务端必须逐行给出 `canDecide`
 *
 * 用法：
 *   node miniprogram/scripts/check-approval-scope.mjs
 *   node miniprogram/scripts/check-approval-scope.mjs --selftest
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const CLIENT = resolve(ROOT, 'admin/src/components/ApprovalQueue.vue')
const SERVER = resolve(ROOT, 'miniprogram/cloudfunctions/manageApprovals/index.js')

/** 去掉注释：本项目被「正则吃到注释里的示例」坑过多次，这里统一先剥再匹配 */
export function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\*.*$/gm, '')
    .replace(/\/\/[^\n]*/g, '')
}

/** 纯函数：客户端源码检查 */
export function checkClient(rawSrc) {
  const src = stripComments(rawSrc)
  const problems = []
  // 只看调用参数里的 scope 赋值，避免把这行当注释/文案
  if (/scope\s*:\s*['"]super_admin['"]/.test(src)) {
    problems.push("ApprovalQueue.vue 仍硬编码 scope: 'super_admin' —— 店长审级的单据会永久不可见（审计 P0-18）")
  }
  if (!/scope\s*:\s*['"]all['"]/.test(src)) {
    problems.push("ApprovalQueue.vue 未请求 scope: 'all' —— 只查单一审级会漏掉另一审级的单据")
  }
  if (!/canDecide/.test(src)) {
    problems.push('ApprovalQueue.vue 未使用服务端返回的 canDecide 门控按钮 —— 非本审级的按钮点了必被服务端拒')
  }
  return problems
}

/** 纯函数：服务端源码检查 */
export function checkServer(rawSrc) {
  const src = stripComments(rawSrc)
  const problems = []
  if (!/canDecide\s*:/.test(src)) {
    problems.push('manageApprovals 未逐行返回 canDecide —— 客户端无法判断自己能不能审')
  }
  // 关键：'all' 必须被非超管 workspace 降级，否则客户端一改请求就能看到全部
  const coerces = /scope\s*===\s*['"]all['"][\s\S]{0,160}(WORKSPACE_SUPER_ADMIN|approverRole\s*=\s*APPROVER_MANAGER|scope\s*=\s*APPROVER_MANAGER)/
  if (!coerces.test(src)) {
    problems.push("manageApprovals 未把非超管的 scope:'all' 降级为店长审级 —— 客户端改个请求就能看到全站审批单")
  }
  return problems
}

function scanRepo() {
  const problems = []
  if (!existsSync(CLIENT)) problems.push(`找不到 ${CLIENT}`)
  else problems.push(...checkClient(readFileSync(CLIENT, 'utf8')))
  if (!existsSync(SERVER)) problems.push(`找不到 ${SERVER}`)
  else problems.push(...checkServer(readFileSync(SERVER, 'utf8')))
  return problems
}

function selftest() {
  let bad = 0
  const t = (n, ok) => { if (!ok) bad += 1; console.log(`${ok ? '✓' : '✗'} ${n}`) }

  const goodClient = "scope: 'all'\n<el-button v-if=\"row.status === 'pending' && row.canDecide\">"
  const badClient = "scope: 'super_admin'\n<el-button v-if=\"row.status === 'pending'\">"
  const goodServer = "if (scope === 'all' && actorWorkspace(guard.actor) !== WORKSPACE_SUPER_ADMIN) { scope = APPROVER_MANAGER }\ncanDecide: !!"
  const badServer = "canDecide: !!"

  t('A1/A2：合规客户端（scope=all + canDecide）通过', checkClient(goodClient).length === 0)
  t('★ 注释里的 `scope: \'super_admin\'` 不误报（正则不能吃注释）',
    checkClient("// 原先硬编码 scope: 'super_admin' → 已改\nscope: 'all'\nrow.canDecide").length === 0)
  t('★ HTML 注释里的写法也不误报',
    checkClient("<!-- scope: 'super_admin' -->\nscope: 'all'\nrow.canDecide").length === 0)
  t('★ A1：硬编码 super_admin 被检出', checkClient(badClient).some((p) => /super_admin/.test(p)))
  t('★ A2：未用 canDecide 被检出', checkClient("scope: 'all'\n<el-button v-if=\"row.status === 'pending'\">").some((p) => /canDecide/.test(p)))
  t('★ A1：未请求 all 被检出', checkClient("<el-button v-if=\"row.canDecide\">").some((p) => /scope: 'all'/.test(p)))

  t('A3/A4：合规服务端（降级 + canDecide）通过', checkServer(goodServer).length === 0)
  t('★ A3：服务端不降级被检出', checkServer(badServer).some((p) => /降级/.test(p)))
  t('★ A4：缺 canDecide 被检出', checkServer("if (scope === 'all' && actorWorkspace(a) !== WORKSPACE_SUPER_ADMIN) scope = APPROVER_MANAGER").some((p) => /canDecide/.test(p)))

  if (bad) {
    console.error(`\n自检失败 ${bad} 项 —— 守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：硬编码审级 / 缺 canDecide / 服务端不降级都会被抓，合规写法不误报')
}

if (process.argv.includes('--selftest')) {
  selftest()
} else {
  const problems = scanRepo()
  if (problems.length) {
    console.error(`✗ 审批队列审级可见性守卫失败 ${problems.length} 处：`)
    problems.forEach((p) => console.error(`  - ${p}`))
    process.exit(1)
  }
  console.log('✓ 审批审级可见性正确：客户端请求全站并按 canDecide 门控，服务端对非超管强制降级')
}
