#!/usr/bin/env node
/**
 * test:ai-center —— AI 智能中心（员工端 · 2026-11-23 产品负责人「把 ERP 的 AI 智能中心复制到小程序」）
 *
 *   A1 页面注册在 extra 分包；入口磁贴 key=ai_center 且点了进页面
 *   A2 客户端角色表与服务端人设**逐一对应**（id 集合相同、名字一致），客户端不夹带 system prompt
 *   A3 云端只认白名单 roleId；不写库；缺 Key 走 ai_service 兜底；问答都过内容安全
 *   A4 会话只存本机（按角色分桶），不上云
 *
 *   node miniprogram/scripts/test-ai-center.mjs [--selftest]
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCjsModule } from './lib/cjs-loader.mjs'

const MP = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = join(MP, '..')
const P = {
  appJson: join(MP, 'app.json'),
  roles: join(MP, 'subpackages/extra/ai-center/roles.js'),
  page: join(MP, 'subpackages/extra/ai-center/index.js'),
  wxml: join(MP, 'subpackages/extra/ai-center/index.wxml'),
  personas: join(MP, 'cloudfunctions/askMuseumGuide/staffPersonas.js'),
  ctx: join(MP, 'cloudfunctions/askMuseumGuide/staffContext.js'),
  debate: join(MP, 'subpackages/extra/ai-debate/index.js'),
  debateWxml: join(MP, 'subpackages/extra/ai-debate/index.wxml'),
  tasksClient: join(MP, 'subpackages/extra/ai-center/tasks.js'),
  tasksServer: join(MP, 'cloudfunctions/askMuseumGuide/staffTasks.js'),
  fn: join(MP, 'cloudfunctions/askMuseumGuide/index.js'),
  userJs: join(MP, 'pages/user/index.js')
}

let INJECT = null
const transform = (file, src) => {
  if (!INJECT || INJECT.file !== file) return src
  if (src.indexOf(INJECT.find) === -1) throw new Error(`注入锚点失效：${INJECT.name}`)
  return src.replace(INJECT.find, INJECT.replace)
}
const read = (f) => transform(f, readFileSync(f, 'utf8'))
const ok = (name, cond, fails) => { if (!cond) fails.push(name) }

function runChecks() {
  const fails = []
  const app = JSON.parse(read(P.appJson))
  const extra = app.subpackages.find((s) => s.root === 'subpackages/extra')
  ok('A1 页面注册在 extra 分包', !!extra && extra.pages.includes('ai-center/index'), fails)
  const userJs = read(P.userJs)
  ok('A1 我的·工作台有 ai_center 磁贴，点了进 AI 智能中心',
    /key: 'ai_center'/.test(userJs) && /title: 'AI 智能中心'/.test(userJs) &&
    /if \(key === 'ai_center'\) \{\s*\n\s*wx\.navigateTo\(\{ url: '\/subpackages\/extra\/ai-center\/index' \}\)/.test(userJs), fails)

  const client = loadCjsModule(P.roles, { transform })
  const server = loadCjsModule(P.personas, { transform })
  const cIds = client.ROLES.map((r) => r.id).sort()
  const sIds = server.ROLE_IDS.slice().sort()
  ok('A2 客户端角色表与服务端人设 id 集合一致', JSON.stringify(cIds) === JSON.stringify(sIds) && cIds.length >= 6, fails)
  ok('A2 名字一致且客户端不含 system prompt',
    client.ROLES.every((r) => server.STAFF_ROLES[r.id] && server.STAFF_ROLES[r.id].name === r.name) &&
    !/systemPrompt|你是山海造物/.test(read(P.roles)), fails)
  ok('A2 服务端人设带统一边界（不编数据 / 不越界 / 不输出隐私）',
    /不编造数据/.test(server.STAFF_SYSTEM_SUFFIX) && /不输出任何密钥/.test(server.STAFF_SYSTEM_SUFFIX), fails)

  const fn = read(P.fn)
  ok('A3 云端：mode=staff 分发 + roleId 白名单 + 缺 Key 兜底 + 问答都过内容安全',
    /event\.mode === 'staff'\) return staffChat/.test(fn) && /ROLE_IDS\.indexOf\(roleId\) < 0/.test(fn) &&
    /if \(!apiKey\) return \{ success: false, error_type: 'ai_service', msg: 'AI 服务还没配置，请联系超管' \}\n\n  \/\/ 经营上下文/.test(fn) &&
    /const sec = await checkText\(openid, question, 2\)/.test(fn) && !/db\.collection\([^)]*\)\.(add|set|update|remove)\(/.test(fn.slice(fn.indexOf('async function staffChat'), fn.indexOf('exports.main'))), fails)

  const page = read(P.page)
  ok('A4 会话只存本机（v2 多会话、按角色分桶、≤20 条会话 / 每条 ≤80 条消息），不上云，兼容 v1 迁移',
    /ai_center_v2_/.test(page) && /MAX_SESSIONS = 20/.test(page) && /MAX_KEEP = 80/.test(page) &&
    /ai_center_session_v1_/.test(page) && /wx\.getStorageSync/.test(page) && /wx\.setStorageSync\(/.test(page) &&
    !/db\.collection|\.add\(/.test(page), fails)
  ok('A4 基础操作：新建 / 切换 / 删除会话 + 复制 / 重试 / 停止',
    /onNewSession\(\)/.test(page) && /onSessionTap\(/.test(page) && /onDeleteSession\(/.test(page) &&
    /onCopy\(/.test(page) && /onRetry\(\)/.test(page) && /onStop\(\)/.test(page) && /this\._abort/.test(page), fails)
  const ctxSrc = read(P.ctx)
  const C = loadCjsModule(P.ctx, { transform })
  const orders = C.summarizeOrders([
    { status: 'paid', totalPrice: 680 }, { status: 'shipped', payAmount: 320, refundFee: 100 }, { status: 'pending_pay', totalPrice: 999 }
  ])
  const products = C.summarizeProducts([
    { stock: 1, category: '昆虫' }, { stock: 9, category: '昆虫' }, { stock: 0, category: '矿石' }, { stock: 5, category: '植物', isOffShelf: true }
  ])
  ok('A5 经营上下文：只汇总已付态 / 退款单算 / 客单价按已付笔数；在售与低库存口径正确',
    orders.paidCount === 2 && orders.gmv === 1000 && orders.refund === 100 && orders.aov === 500 &&
    products.onSale === 3 && products.lowStock === 2 && /昆虫 2/.test(products.top), fails)
  const fin = C.summarizeFinance([{ cash: 100, pos: 50, online: 30, refund: 10 }, { cashIncome: 20, pos: 0, online: 0 }])
  ok('A5 门店日账汇总：现金 / POS / 线上 / 退款分开累计，合计不含退款', fin.total === 200 && fin.refund === 10 && fin.days === 2, fails)
  ok('A5 上下文注入 staffChat：system 里带「当前经营数据」块；只查 4 张表且不含个人信息；有缓存与字数上限',
    /contextFor\(roleId, db\)/.test(fn) && /【当前经营数据/.test(fn) &&
    /collection\('orders'\)/.test(ctxSrc) && /collection\('products'\)/.test(ctxSrc) &&
    /collection\('users'\)/.test(ctxSrc) && /collection\('bookings'\)/.test(ctxSrc) && /collection\('finance_records'\)/.test(ctxSrc) &&
    /collection\('purchase_orders'\)/.test(ctxSrc) && /collection\('stock_movements'\)/.test(ctxSrc) &&
    /collection\('ops_purchases'\)/.test(ctxSrc) &&
    /collection\('feishu_inventory'\)/.test(ctxSrc) && /collection\('staff_members'\)/.test(ctxSrc) &&
    /collection\('staff_payslips'\)/.test(ctxSrc) && /collection\('staff_attendance'\)/.test(ctxSrc) &&
    /collection\('staff_leave_requests'\)/.test(ctxSrc) &&
    !/phone|mobile|openid|realName|receiver/i.test(ctxSrc) &&
    /TTL_MS/.test(ctxSrc) && C.TEXT_MAX <= 800, fails)
  const pur = C.summarizePurchases([{ totalAmount: 1200, paymentStatus: 'paid' }, { totalAmount: 800, paymentStatus: 'unpaid' }])
  const mv = C.summarizeMoves([{ delta: 5 }, { delta: -3 }, { delta: -2 }])
  ok('A5 采购单与库存流水：金额按单累计、已付按支付状态；入库 / 出库 / 净变化口径正确',
    pur.count === 2 && pur.amount === 2000 && pur.paid === 1 && mv.inQty === 5 && mv.outQty === 5 && mv.net === 0, fails)
  const op = C.summarizeOpsPurchases([
    { amount: 100, status: 'paid', scope: 'store' }, { qty: 2, unitPrice: 50, status: 'cancelled' },
    { amount: 80, status: 'received', scope: 'studio' }, { amount: 999, deleted: true }
  ])
  ok('A5 店内采购（ops_purchases）：跳过已取消 / 已删除，金额回退 qty×unitPrice，门店与工作室分列，未结口径正确',
    op.count === 2 && op.amount === 180 && op.openCount === 1 && op.storeAmount === 100 && op.studioAmount === 80, fails)
  const hr = C.summarizeHr({
    month: '2026-11', members: { total: 12 },
    payslips: { data: [{ gross: 8000, net: 6500, deduction: 1500 }, { gross: 6000, net: 5000, deduction: 1000 }] },
    attendance: { data: [{ status: 'late' }, { status: 'on_time' }] }, leaves: { total: 3 }
  })
  const fi = C.summarizeFeishuInventory([{ qty: 12 }, { qty: '8' }, { qty: null }])
  ok('A5 HR 只给聚合：人数 / 工资合计 / 迟到早退 / 待审批请假；飞书库存只累计数量',
    hr.headcount === 12 && hr.payslipCount === 2 && hr.gross === 14000 && hr.net === 11500 && hr.deduction === 2500 &&
    hr.punches === 2 && hr.late === 1 && hr.pendingLeaves === 3 && fi.lines === 2 && fi.qty === 20, fails)
  const tc = loadCjsModule(P.tasksClient, { transform })
  const ts = loadCjsModule(P.tasksServer, { transform })
  const cTasks = tc.TASKS.map((t) => `${t.id}:${t.roleId}`).sort()
  const sTasks = ts.TASKS.map((t) => `${t.id}:${t.roleId}`).sort()
  const rolesWithTask = new Set(ts.TASKS.map((t) => t.roleId))
  ok('A6 一键任务：客户端与服务端 id+角色逐一一致，每个员工至少一个任务',
    JSON.stringify(cTasks) === JSON.stringify(sTasks) && ts.TASKS.length >= 6 &&
    server.ROLE_IDS.every((id) => rolesWithTask.has(id)), fails)
  ok('A6 任务提示词只在服务端：客户端无 question，云端 taskId 优先且未知任务直接拒',
    !/question/.test(read(P.tasksClient)) && /taskById\(String\(event\.taskId\)/.test(fn) &&
    /if \(event && event\.taskId && !task\) return \{ success: false, error_type: 'invalid'/.test(fn) &&
    /const question = \(task \? task\.question/.test(fn), fails)
  ok('A6 页面有一键任务条与 runTask，请求带 taskId，重试按任务重发',
    /class="ac-task/.test(read(P.wxml)) && /runTask\(e\)/.test(page) && /taskId: task\.taskId/.test(page) &&
    /if \(last\.taskId\) this\._ask/.test(page), fails)
  const debate = read(P.debate)
  ok('A7 董事会辩论：页面注册 + AI 中心有入口',
    extra.pages.includes('ai-debate/index') && /goDebate\(\)/.test(read(P.page)) &&
    /ac-debate/.test(read(P.wxml)) && /ai-debate\/index/.test(read(P.page)), fails)
  ok('A7 云端：mode=debate 分发、2–4 位董事、发言者必须在名单内、收口单独一步、提示词不在客户端',
    /event\.mode === 'debate'\) return staffDebate/.test(fn) &&
    /members\.length < 2/.test(fn) && /members\.indexOf\(roleId\) < 0/.test(fn) &&
    /step === 'verdict'/.test(fn) && /你是山海造物的董事会主持人/.test(fn) &&
    !/你是山海造物的/.test(debate), fails)
  ok('A7 页面：串行发言 + 停止 + 本机保存上一场 + 复制',
    /for \(let i = 0; i < members\.length/.test(debate) && /onStop\(\)/.test(debate) &&
    /ai_debate_last/.test(debate) && /onCopy\(/.test(debate), fails)
  return fails
}

if (process.argv.includes('--selftest')) {
  const base = runChecks()
  if (base.length) { console.error('✗ 自检前提：真源须先通过\n  - ' + base.join('\n  - ')); process.exit(1) }
  const INJ = [
    { name: '入口磁贴被删', file: P.userJs, find: "key: 'ai_center'", replace: "key: 'ai_center_x'" },
    { name: '页面没注册', file: P.page, find: '', replace: '' },
    { name: '角色表与云端不一致', file: P.roles, find: "id: 'cfo'", replace: "id: 'cfo2'" },
    { name: '云端不校验 roleId', file: P.fn, find: 'if (ROLE_IDS.indexOf(roleId) < 0) return', replace: 'if (false) return' },
    { name: '缺 Key 也放行', file: P.fn, find: "  if (!apiKey) return { success: false, error_type: 'ai_service', msg: 'AI 服务还没配置，请联系超管' }\n\n  // 经营上下文", replace: "  if (false) return { success: false, error_type: 'ai_service', msg: 'AI 服务还没配置，请联系超管' }\n\n  // 经营上下文" },
    { name: '上下文不注入 system', file: P.fn, find: 'try { context = await contextFor(roleId, db) } catch (e) { context = \'\' }', replace: 'context = \'\'' },
    { name: '上下文里带手机号', file: P.ctx, find: ".field({ stock: true, category: true, isOffShelf: true })", replace: ".field({ stock: true, category: true, isOffShelf: true, phone: true })" },
    { name: '未知任务不拒', file: P.fn, find: "if (event && event.taskId && !task) return { success: false, error_type: 'invalid', msg: '没有这个任务' }", replace: 'if (false) return {}' },
    { name: '任务角色对不上', file: P.tasksClient, find: "roleId: 'cfo', title: '现金流体检'", replace: "roleId: 'marketing', title: '现金流体检'" },
    { name: '辩论不分发', file: P.fn, find: "if (event && event.mode === 'debate') return staffDebate(event, OPENID)", replace: 'if (false) return null' },
    { name: '辩论允许单人', file: P.fn, find: 'if (members.length < 2) return', replace: 'if (members.length < 0) return' },
    { name: '去掉停止', file: P.page, find: '  onStop() {', replace: '  onStopX() {' },
    { name: '会话改存云端', file: P.page, find: 'wx.setStorageSync(', replace: 'wx.cloud.callFunction({ name: "x", data: {' }
  ].filter((x) => x.find !== '')
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
  if (bad) { console.error(`\n✗ test:ai-center 自检失败 ${bad} 项`); process.exit(1) }
  console.log(`✓ 自检通过：${INJ.length} 条注入全部检出（内存副本，不写盘）`)
} else {
  const fails = runChecks()
  if (fails.length) { console.error('✗ AI 智能中心不合格：\n  - ' + fails.join('\n  - ')); process.exit(1) }
  console.log('✓ test:ai-center：入口 / 角色同源 / 云端白名单与兜底 / 本机会话 全部通过')
}
