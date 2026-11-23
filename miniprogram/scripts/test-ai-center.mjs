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
  roles: join(MP, 'subpackages/ai/ai-center/roles.js'),
  page: join(MP, 'subpackages/ai/ai-center/index.js'),
  wxml: join(MP, 'subpackages/ai/ai-center/index.wxml'),
  personas: join(MP, 'cloudfunctions/askMuseumGuide/staffPersonas.js'),
  ctx: join(MP, 'cloudfunctions/askMuseumGuide/staffContext.js'),
  rails: join(MP, 'cloudfunctions/askMuseumGuide/staffGuardrails.js'),
  debate: join(MP, 'subpackages/ai/ai-debate/index.js'),
  debateWxml: join(MP, 'subpackages/ai/ai-debate/index.wxml'),
  tasksClient: join(MP, 'subpackages/ai/ai-center/tasks.js'),
  tasksServer: join(MP, 'cloudfunctions/askMuseumGuide/staffTasks.js'),
  fn: join(MP, 'cloudfunctions/askMuseumGuide/index.js'),
  patrol: join(MP, 'cloudfunctions/askMuseumGuide/staffPatrol.js'),
  memo: join(MP, 'cloudfunctions/askMuseumGuide/staffMemo.js'),
  guardCopy: join(MP, 'cloudfunctions/askMuseumGuide/staffGuard.js'),
  guardCanon: join(MP, 'cloudfunctions/manageStaff/staffGuard.js'),
  fnConfig: join(MP, 'cloudfunctions/askMuseumGuide/config.json'),
  view: join(MP, 'subpackages/ai/ai-center/centerView.js'),
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
  // 2026-11-23 第七轮：迁到独立分包 subpackages/ai（extra 余量告急）；extra 原地址留跳转页，旧工作信息链接不失效
  const extra = app.subpackages.find((s) => s.root === 'subpackages/ai')
  const oldPack = app.subpackages.find((s) => s.root === 'subpackages/extra')
  ok('A1 页面注册在独立分包 subpackages/ai；extra 原地址仍注册为跳转页', !!extra && extra.pages.includes('ai-center/index') &&
    !!oldPack && oldPack.pages.includes('ai-center/index') && oldPack.pages.includes('ai-debate/index'), fails)
  const stubs = ['ai-center', 'ai-debate'].map((n) => read(join(MP, `subpackages/extra/${n}/index.js`)))
  ok('A1 旧地址跳转页：原样带参数 redirectTo 新地址、不含业务逻辑', stubs.every((t, i) => {
    const n = ['ai-center', 'ai-debate'][i]
    return t.includes(`wx.redirectTo({ url: \`/subpackages/ai/${n}/index`) && /encodeURIComponent\(options\[k\]\)/.test(t) && !/callFunction|setStorageSync/.test(t)
  }), fails)
  const userJs = read(P.userJs)
  ok('A1 我的·工作台有 ai_center 磁贴，点了进 AI 智能中心',
    /key: 'ai_center'/.test(userJs) && /title: 'AI 智能中心'/.test(userJs) &&
    /if \(key === 'ai_center'\) \{\s*\n\s*wx\.navigateTo\(\{ url: '\/subpackages\/ai\/ai-center\/index' \}\)/.test(userJs), fails)

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
    /const sec = await checkText\(openid, relay \? `\$\{relay\.text\}\\n\$\{question\}` : question, 2\)/.test(fn) && !/db\.collection\([^)]*\)\.(add|set|update|remove)\(/.test(fn.slice(fn.indexOf('async function staffChat'), fn.indexOf('exports.main'))), fails)

  const page = read(P.page)
  ok('A4 会话只存本机（v2 多会话、按角色分桶、≤20 条会话 / 每条 ≤80 条消息），不上云，兼容 v1 迁移',
    /ai_center_v2_/.test(page) && /MAX_SESSIONS = 20/.test(page) && /MAX_KEEP = 80/.test(page) &&
    /ai_center_session_v1_/.test(page) && /wx\.getStorageSync/.test(page) && /wx\.setStorageSync\(/.test(page) &&
    !/db\.collection|\.add\(/.test(page), fails)
  ok('A4 基础操作：新建 / 切换 / 删除会话 + 复制 / 重试 / 停止',
    /onNewSession\(\)/.test(page) && /onSessionTap\(/.test(page) && /onDeleteSession\(/.test(page) &&
    /onCopy\(/.test(page) && /\n  onRetry\((opts)?\) \{/.test(page) && /onStop\(\)/.test(page) && /this\._abort/.test(page), fails)
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
    // 2026-11-23：辩论也调 contextFor，改为钉住 staffChat 自己的那一句（否则 staffChat 不注入也会被辩论那处满足）
    /try \{ context = await contextFor\(roleId, db\) \} catch \(e\) \{ context = '' \}/.test(fn) && /【当前经营数据/.test(fn) &&
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

  /* ---------------- A8 第六轮（2026-11-23）：人设 / 门禁 / 全局上下文 / 主动巡检 / 页面 ---------------- */
  ok('A8 每位同事有名字 / 三行履历 / 口头禅，客户端与云端逐一一致；人设提示词带身份与说话方式',
    client.ROLES.every((r) => {
      const s = server.STAFF_ROLES[r.id]
      return s && r.person && s.person === r.person && s.motto === r.motto && JSON.stringify(s.cv) === JSON.stringify(r.cv) && r.cv.length === 3 && r.seal === r.person.slice(0, 1)
    }) && new Set(client.ROLES.map((r) => r.person)).size === client.ROLES.length &&
    server.ROLE_IDS.every((id) => server.systemPromptOf(id).indexOf(`你叫${server.STAFF_ROLES[id].person}`) === 0), fails)
  ok('A8 话风：拟人、不说「作为 AI」、回答引用具体数字并给可验证的建议',
    /不要说「作为 AI」/.test(server.STAFF_SYSTEM_SUFFIX) && /引用下面「当前经营数据」里的具体数字/.test(server.STAFF_SYSTEM_SUFFIX) && /看哪个指标验证/.test(server.STAFF_SYSTEM_SUFFIX), fails)
  // 逐个通道点名（不数个数）：员工通道开头先过门禁；巡检 / 备忘要超管
  const gated = (name, sup) => fn.includes(`async function ${name}(event, openid) {\n  const gate = await staffGate(openid${sup ? ', { requireSuperAdmin: true }' : ''})\n  if (!gate.ok) return gate.out\n`)
  ok('A8 员工门禁：staff / debate / staffBrief 先过 staffGuard，staffPatrol / staffMemo 要超管；staffGuard 是规范副本',
    gated('staffChat') && gated('staffDebate') && gated('staffBrief') && gated('staffPatrol', true) && gated('staffMemo', true) &&
    read(P.guardCopy) === read(P.guardCanon) && /async function staffChat\(event, openid\) \{\n  const gate = await staffGate\(openid\)/.test(fn), fails)
  const D = 86400000
  const now = Date.UTC(2026, 10, 23, 12)
  const tr = C.summarizeTrend([
    { status: 'paid', totalPrice: 100, createTime: new Date(now - D) }, { status: 'pending', totalPrice: 900, createTime: now - D },
    { status: 'shipped', totalPrice: 50, createTime: now - 9 * D }, { status: 'paid', totalPrice: 30, createTime: now - 60000 }
  ], now)
  ok('A8 趋势：只算已付、近 7 天与前 7 天分开、今天单独计；前期 < 3 不给百分比',
    tr.last7 === 2 && tr.prev7 === 1 && tr.gmv7 === 130 && tr.today === 1 && C.changePct(2, 1) === null && C.changePct(6, 10) === -40, fails)
  const gl = C.globalLine({ trend: { last7: 6, prev7: 10, gmv7: 900, today: 1 }, products: { onSale: 40, lowStock: 6 }, users: { last7: 3, prev7: 5 }, hr: { pendingLeaves: 2, gross: 99999 } })
  ok('A8 全局一句：每个角色都先看到经营全貌（订单趋势 / 在售与低库存 / 新会员），不带工资；上下文标明数据时间',
    /^全局：/.test(gl) && /↓40%/.test(gl) && /库存 ≤3 的 6 件/.test(gl) && !/99999|工资/.test(gl) &&
    /const g = globalLine\(snap\)\n  if \(g\) lines\.push\(g\)/.test(ctxSrc) && /数据截至北京时间/.test(ctxSrc) &&
    !/gross|net|wage|salary/i.test(JSON.stringify(Object.keys(C.pulseOf({ hr: { gross: 1 } })))), fails)
  const PT = loadCjsModule(P.patrol, { transform })
  const issues = PT.findIssues({ trend: { last7: 4, prev7: 12, today: 0 }, products: { onSale: 40, lowStock: 9 }, orders: { gmv: 20000, refund: 2000 }, hr: { pendingLeaves: 3, late: 1, early: 0 }, users: { last7: 2, prev7: 10 } })
  ok('A8 巡检规则：只按阈值判（样本太小不判）、严重的在前、最多 4 条、每条归到一位同事',
    issues.length === PT.MAX_ISSUES && issues[0].level === 'high' && issues.every((i) => server.STAFF_ROLES[i.roleId] && i.person === server.STAFF_ROLES[i.roleId].person) &&
    PT.findIssues({}).length === 0 && PT.findIssues({ trend: { last7: 0, prev7: 2 } }).length === 0 &&
    PT.findIssues({ products: { onSale: 40, lowStock: 5 } }).length === 0, fails)
  const L = PT.letterOf(issues[0], '11-23 21:40', now)
  ok('A8 工作信息：标题带名字与岗位、正文落款并写明数据时间；进工作信息队列；同一问题每人每天一封；点开进 AI 中心对应同事且问题预填',
    L.title.indexOf(`${issues[0].person}（${issues[0].roleName}）：`) === 0 && /—— /.test(L.content) && /11-23 21:40/.test(L.content) &&
    L.category === 'ops' && L.queue === 'workflow' && L.relatedId === `${issues[0].id}:2026-11-23` &&
    L.actionUrl.indexOf(`subpackages/ai/ai-center/index?roleId=${issues[0].roleId}&ask=`) === 0, fails)
  const patrolSrc = read(P.patrol)
  ok('A8 巡检投递：试跑不发信；收件人只取超管；关掉开关定时不跑；改开关先记审计；定时只认「无 OPENID 的 Timer」；配置了每天两次触发器',
    /if \(!ctx\.dryRun\) \{/.test(patrolSrc) && /const recipients = dryRun \? \[\] : await resolveSuperAdminOpenids\(db\)/.test(fn) &&
    /if \(!cfg\.enabled\) return \{ success: true, skipped: 'disabled' \}/.test(fn) &&
    fn.indexOf("collection('admin_operation_logs').add") >= 0 && fn.indexOf("collection('admin_operation_logs').add") < fn.indexOf('await writePatrolConfig(db, { enabled') &&
    /if \(!OPENID && isTimerEvent\(event\)\) return timerPatrol\(\)/.test(fn) &&
    /"name": "staffPatrolRun"/.test(read(P.fnConfig)) && /"type": "timer"/.test(read(P.fnConfig)), fails)
  const V = loadCjsModule(P.view, { transform })
  const cells = V.pulseCells({ orders7: 8, ordersChange: -33, gmv7: 12680, today: 1, onSale: 46, lowStock: 9, members7: null, membersChange: null })
  ok('A8 页面纯函数：脉搏读不到写「—」不编 0、下降染色、复制全文跳过出错与进行中、会话名 ≤16 字',
    cells[0].value === '8' && cells[0].sub === '↓33%' && cells[0].tone === 'down' && cells[1].value === '¥1.3万' && cells[3].value === '—' && cells[2].tone === 'warn' &&
    V.transcriptOf([{ role: 'user', text: '问' }, { role: 'assistant', text: '答' }, { role: 'assistant', text: 'x', isError: true }, { role: 'assistant', pending: true, text: '' }], '周砚') === '我：问\n\n周砚：答' &&
    V.cleanTitle('  一二三四五六七八九十一二三四五六七  ') === '一二三四五六七八九十一二三四五六' && V.issueCountByRole([{ roleId: 'cfo' }, { roleId: 'cfo' }]).cfo === 2, fails)
  const wxml = read(P.wxml)
  ok('A8 页面接线：进页取脉搏（staffBrief）、工作信息带来的问题只预填不自动发、超管才有巡检按钮与开关、会话可重命名与复制全文、回答写明依据时间',
    /mode: 'staffBrief'/.test(page) && /if \(ask\) this\.setData\(\{ draft: ask\.slice\(0, 200\) \}\)/.test(page) && !/if \(ask\) this\.send\(\)/.test(page) &&
    /<view class="ac-patrol" wx:if="\{\{isSuper\}\}">/.test(wxml) && /bindtap="onPatrolRun"/.test(wxml) && /bindchange="onPatrolToggle"/.test(wxml) &&
    /'重命名', '复制全文', '删除这条会话'/.test(page) && /class="ac-basis" wx:if="\{\{item\.asOf\}\}"/.test(wxml) && /class="ac-seal/.test(wxml) && !/item\.emoji/.test(wxml), fails)
  const R = loadCjsModule(P.rails, { transform })
  const bad = R.detectFabrication('给云南那家合作三年的蝴蝶场发消息，重点盯账期和破损率承诺，签合同条款')
  const good = R.detectFabrication('优先补货量按近 7 天订单量×1.5 倍估算，验证指标看售罄率')
  ok('A9 事实护栏：供应商 / 合作年限 / 账期 / 破损率 / 合同 / 政策 都能识别，正常分析不误伤',
    bad.length >= 4 && good.length === 0 && R.FABRICATION_RULES.length >= 6, fails)
  ok('A9 护栏接线：staffChat 命中后重写一次、仍命中则 needsVerify；提示词明确禁止编造这几类',
    /detectFabrication\(answer\)/.test(fn) && /if \(flags\.length\) \{\s*\n\s*const strict = \[\{ role: 'system'/.test(fn) && /askStaffModel\(strict, apiKey\)/.test(fn) && /needsVerify: flags\.length > 0/.test(fn) &&
    /不得编造以下具体信息/.test(server.STAFF_SYSTEM_SUFFIX) && /需核实/.test(server.STAFF_SYSTEM_SUFFIX), fails)
  ok('A9 页面：需要核实的气泡有明确提示，且请求结果带 needsVerify',
    /ac-verify/.test(read(P.wxml)) && /item\.needsVerify/.test(read(P.wxml)) && /needsVerify: body\.needsVerify === true/.test(page), fails)


  /* ---------------- A9 第七轮（2026-11-23）：巡检可配置可追溯 / 转交与换个说法 ---------------- */
  const ns = PT.normalizePatrolSettings({ muted: ['low_stock', 'nope', 'low_stock'], limits: { orders_drop: 999, low_stock: '3.5', refund_high: 5 } })
  ok('A9 巡检设置归一：未知规则丢掉、静音去重、阈值取整并夹在上下限、缺省回默认',
    JSON.stringify(ns.muted) === '["low_stock"]' && ns.limits.orders_drop === 80 && ns.limits.low_stock === 5 && ns.limits.refund_high === 5 && ns.limits.leave_pending === 3 && !('no_orders' in ns.limits), fails)
  const sn = { trend: { last7: 7, prev7: 10 }, products: { onSale: 40, lowStock: 6 } }
  ok('A9 判定按配置：静音的规则不报、阈值调高后不报',
    PT.findIssues(sn).length === 2 && PT.findIssues(sn, { muted: ['low_stock'] }).map((i) => i.id).join() === 'orders_drop' &&
    PT.findIssues(sn, { limits: { orders_drop: 35, low_stock: 7 } }).length === 0, fails)
  const hist = PT.historyOf(Array.from({ length: 20 }, (_, i) => ({ at: i + 1, by: i % 2 ? 'timer' : 'x', ids: ['low_stock', 'bad'], sent: 1 })))
  ok('A9 巡检记录：新的在前、最多 14 条、触发方式只认定时 / 手动、未知规则丢掉',
    hist.length === PT.HISTORY_MAX && PT.HISTORY_MAX === 14 && hist[0].at === 20 && hist.every((h) => h.by === 'timer' || h.by === 'manual') && hist.every((h) => h.ids.join() === 'low_stock') &&
    /const history = historyOf\(\[\{ at: now, by: ctx\.by/.test(patrolSrc) && /patrolOnce\(false, 'timer'\)/.test(fn) && /patrolOnce\(false, 'manual'\)/.test(fn), fails)
  ok('A9 页面提醒与巡检同一份配置；改设置先审计再写；超管才拿到规则清单',
    /issues: findIssues\(snap, cfg\)/.test(fn) && /const settings = await readPatrolConfig\(db\)/.test(fn) &&
    // indexOf 必须先判 ≥ 0：审计语句被删时 -1 也「小于」写入位置，旧写法会被绕过（错题本：守卫判据自身错误）
    [["await auditPatrol(gate, openid, 'staff_patrol_config', next)", 'await writePatrolConfig(db, { muted: next.muted'],
      ["await auditPatrol(gate, openid, 'staff_patrol_toggle', { enabled })", 'await writePatrolConfig(db, { enabled']]
      .every(([a, w]) => fn.indexOf(a) >= 0 && fn.indexOf(a) < fn.indexOf(w)) &&
    /if \(isSuper\) Object\.assign\(out, \{ patrol: cfg, rules: ruleViews\(cfg\) \}\)/.test(fn), fails)
  ok('A9 转交：来源必须是另一位真实同事（名字按 roleId 取）、看法 ≤400 字、放在用户消息不进 system、与问题一起过内容安全；换个说法只追加一句语气要求',
    /if \(ROLE_IDS\.indexOf\(fromId\) < 0 \|\| fromId === roleId\) return null/.test(fn) && /return \{ from: displayOf\(fromId\), text \}/.test(fn) && /\.slice\(0, 400\)/.test(fn) &&
    /const messages = \[\{ role: 'system', content: system \}\]\.concat\(history, \[\{ role: 'user', content: userContent \}\]\)/.test(fn) &&
    !/system \+?= .*relay|relay\.text[^\n]*system/.test(fn) && /event\.rephrase === true/.test(fn), fails)
  ok('A9 页面纯函数：巡检记录换成同事名字、阈值按步长夹边、设置回存、转交取最近的问题且一键任务不转',
    V.historyRows([{ at: 1, by: 'timer', ids: ['orders_drop', 'low_stock'], sent: 2 }], [{ id: 'orders_drop', person: '林晓棠' }, { id: 'low_stock', person: '周砚' }])[0].text === '发现 2 项（林晓棠、周砚）· 发出 2 封' &&
    V.stepLimit({ limit: 30, step: 5, min: 10, max: 32 }, 1) === 32 && V.stepLimit({ limit: 10, step: 5, min: 10, max: 80 }, -1) === 10 &&
    JSON.stringify(V.settingsOf([{ id: 'a', muted: true, limit: 3 }, { id: 'b', muted: false, limit: null }])) === '{"muted":["a"],"limits":{"a":3}}' &&
    V.questionBefore([{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' }], 1) === 'q' && V.questionBefore([{ role: 'user', text: 't', taskId: 'x' }, { role: 'assistant', text: 'a' }], 1) === '', fails)
  ok('A9 页面接线：设置面板只给超管、存设置走 op config；有用 / 没用只记本机；没用才出换个说法；转交带 relay 与来源标签',
    /<view class="ac-settings" wx:if="\{\{isSuper && settingsOpen\}\}">/.test(wxml) && /op: 'config' \}, V\.settingsOf\(this\.data\.rules\)/.test(page) &&
    /bindtap="onVote"/.test(wxml) && !/callFunction[^\n]*vote/.test(page) &&
    /wx:if="\{\{item\.vote === 'down' && index === messages\.length - 1 && !sending\}\}" bindtap="onRephrase"/.test(wxml) && /this\.onRetry\(\{ rephrase: true \}\)/.test(page) &&
    /bindtap="onHandoff"/.test(wxml) && /relay: \{ fromRoleId: from\.id/.test(page) && /class="ac-relay" wx:if="\{\{item\.relayFrom\}\}"/.test(wxml), fails)

  /* ---------------- A10 第八轮（2026-11-23）：团队备忘 / 礼券数据 ---------------- */
  const MM = loadCjsModule(P.memo, { transform })
  const mIn = MM.normalizeMemoInput([{ text: ' 周六下午  有课 ' }, { text: '' }, { text: '双十二', until: '2026-12-12' }, { text: 'x', until: '12/12' }])
  ok('A10 备忘写入归一：空条丢掉、压空白、到期日只认 YYYY-MM-DD；超字数 / 超条数直接拒（不偷偷截）',
    mIn.items.length === 3 && mIn.items[0].text === '周六下午 有课' && mIn.items[1].until === '2026-12-12' && mIn.items[2].until === '' &&
    !!MM.normalizeMemoInput([{ text: '字'.repeat(MM.MEMO_LEN + 1) }]).error && !!MM.normalizeMemoInput(Array.from({ length: MM.MEMO_MAX + 1 }, () => ({ text: 'a' }))).error &&
    !!MM.normalizeMemoInput('x').error, fails)
  const memoNow = Date.UTC(2026, 10, 23, 4)
  ok('A10 备忘读出：到期的不带（到期日当天仍有效）、拼成一段给模型且要求不提冲突方案',
    MM.activeMemo([{ text: '过期', until: '2026-11-22' }, { text: '当天', until: '2026-11-23' }, { text: '长期' }], memoNow).map((m) => m.text).join() === '当天,长期' &&
    /不要提出与之冲突的方案/.test(MM.memoBlock([{ text: 'a', until: '' }])) && MM.memoBlock([]) === '', fails)
  const gatedMemo = fn.slice(fn.indexOf('async function staffMemo'), fn.indexOf('/** 投递一封工作信息'))
  ok('A10 写备忘：只有超管、先过内容安全、再审计、最后整份覆盖',
    gated('staffMemo', true) && gatedMemo.indexOf('await checkText(openid') > 0 && gatedMemo.indexOf('await checkText(openid') < gatedMemo.indexOf("await auditPatrol(gate, openid, 'staff_memo_save'") &&
    gatedMemo.indexOf("await auditPatrol(gate, openid, 'staff_memo_save'") < gatedMemo.indexOf('.doc(MEMO_DOC).set('), fails)
  ok('A10 备忘进上下文：对话、董事发言、主持人收口都带；页面所有员工可见',
    /const memo = memoBlock\(await readMemo\(\)\)\n  const system = systemPromptOf\(roleId\)/.test(fn) && /\(memo \? `\\n\\n\$\{memo\}` : ''\)/.test(fn) &&
    (fn.match(/memoBlock\(await readMemo\(\)\)/g) || []).length === 3 && /isSuper, memo: await readMemo\(\) \}/.test(fn), fails)
  ok('A10 礼券：两次 count、不取持券人；核销率样本 < 10 不给；只进市场 / 财务 / 数据',
    /collection\('user_coupons'\)\.where\(\{ createTime: _\.gte\(since\) \}\)\.count\(\)/.test(ctxSrc) &&
    /collection\('user_coupons'\)\.where\(\{ status: 'used', usedTime: _\.gte\(since\) \}\)\.count\(\)/.test(ctxSrc) &&
    C.summarizeCoupons(9, 3).rate === null && C.summarizeCoupons(20, 5).rate === 25 &&
    /\['marketing', 'cfo', 'data_analyst'\]\.indexOf\(roleId\) >= 0 && snap\.coupons/.test(ctxSrc), fails)
  const ma = V.memoAdd([], '  周六 有课 ', '2026-12-12')
  ok('A10 页面：备忘草稿与云端同口径（≤60 字 / ≤6 条 / 空的拒）；编辑只给超管；保存走 staffMemo',
    ma.list && ma.list[0].text === '周六 有课' && ma.list[0].until === '2026-12-12' && !!V.memoAdd([], '', '').error &&
    !!V.memoAdd([], '字'.repeat(61), '').error && !!V.memoAdd(Array.from({ length: 6 }, () => ({})), 'a', '').error && V.MEMO_LEN === MM.MEMO_LEN && V.MEMO_MAX === MM.MEMO_MAX &&
    /class="ac-memo-edit" wx:if="\{\{isSuper && !memoEdit\}\}"/.test(wxml) && /mode: 'staffMemo', items: this\.data\.memoDraft/.test(page) && /if \(!this\.data\.isSuper\) return/.test(page), fails)
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
    { name: '护栏不检测账期', file: P.rails, find: "{ key: 'terms', label: '账期', re: /账期/ },", replace: '' },
    { name: '命中后不重写', file: P.fn, find: 'if (flags.length) {', replace: 'if (false) {' },
    { name: '辩论不分发', file: P.fn, find: "if (event && event.mode === 'debate') return staffDebate(event, OPENID)", replace: 'if (false) return null' },
    { name: '辩论允许单人', file: P.fn, find: 'if (members.length < 2) return', replace: 'if (members.length < 0) return' },
    { name: '去掉停止', file: P.page, find: '  onStop() {', replace: '  onStopX() {' },
    { name: '会话改存云端', file: P.page, find: 'wx.setStorageSync(', replace: 'wx.cloud.callFunction({ name: "x", data: {' },
    { name: '客户端名字与云端不一致', file: P.roles, find: "person: '周砚'", replace: "person: '周岩'" },
    { name: '人设丢了「不说作为 AI」', file: P.personas, find: "不要说「作为 AI」", replace: '尽量自然' },
    { name: '员工对话不过门禁', file: P.fn, find: 'async function staffChat(event, openid) {\n  const gate = await staffGate(openid)\n  if (!gate.ok) return gate.out\n', replace: 'async function staffChat(event, openid) {\n' },
    { name: '巡检不要求超管', file: P.fn, find: 'staffGate(openid, { requireSuperAdmin: true })', replace: 'staffGate(openid)' },
    { name: '全局一句没进上下文', file: P.ctx, find: '  const g = globalLine(snap)\n  if (g) lines.push(g)\n', replace: '' },
    { name: '小样本也报环比', file: P.ctx, find: '  if (!(prev >= 3)) return null\n', replace: '' },
    { name: '低库存阈值放宽到 1 件', file: P.patrol, find: 'const need = Math.max(limit, Math.ceil(p.onSale * 0.15))', replace: 'const need = 1' },
    { name: '工作信息不按天去重', file: P.patrol, find: 'relatedId: `${issue.id}:${day}`', replace: 'relatedId: `${issue.id}:${now}`' },
    { name: '试跑也发信', file: P.patrol, find: '  if (!ctx.dryRun) {', replace: '  if (true) {' },
    { name: '定时巡检可被客户端伪造', file: P.fn, find: 'if (!OPENID && isTimerEvent(event)) return timerPatrol()', replace: 'if (isTimerEvent(event)) return timerPatrol()' },
    { name: '工作信息带来的问题自动发出', file: P.page, find: 'if (ask) this.setData({ draft: ask.slice(0, 200) })', replace: 'if (ask) this.setData({ draft: ask.slice(0, 200) }, () => this.send())\n    if (ask) this.send()' },
    { name: '非超管也有巡检按钮', file: P.wxml, find: '<view class="ac-patrol" wx:if="{{isSuper}}">', replace: '<view class="ac-patrol">' },
    { name: '静音的规则照样报', file: P.patrol, find: '    if (cfg.muted.indexOf(r.id) >= 0) return\n', replace: '' },
    { name: '阈值不夹边', file: P.patrol, find: '  return Math.min(rule.param.max, Math.max(rule.param.min, raw))', replace: '  return raw' },
    { name: '巡检记录不封顶', file: P.patrol, find: '    .slice(0, HISTORY_MAX)\n', replace: '\n' },
    { name: '页面提醒不按配置', file: P.fn, find: 'issues: findIssues(snap, cfg)', replace: 'issues: findIssues(snap)' },
    { name: '改设置不审计', file: P.fn, find: "      await auditPatrol(gate, openid, 'staff_patrol_config', next)\n", replace: '' },
    { name: '转交给自己也收', file: P.fn, find: 'if (ROLE_IDS.indexOf(fromId) < 0 || fromId === roleId) return null', replace: 'if (ROLE_IDS.indexOf(fromId) < 0) return null' },
    { name: '转交看法进 system', file: P.fn, find: "const messages = [{ role: 'system', content: system }].concat(history, [{ role: 'user', content: userContent }])", replace: "const messages = [{ role: 'system', content: system + userContent }].concat(history, [{ role: 'user', content: question }])" },
    { name: '一键任务也转交', file: P.view, find: "return m.taskId ? '' : String(m.text || '')", replace: "return String(m.text || '')" },
    { name: '非超管也有设置面板', file: P.wxml, find: '<view class="ac-settings" wx:if="{{isSuper && settingsOpen}}">', replace: '<view class="ac-settings" wx:if="{{settingsOpen}}">' },
    { name: '备忘超字数偷偷截断', file: P.memo, find: "  if (text.length > MEMO_LEN) return { error: `每条备忘不超过 ${MEMO_LEN} 字` }\n", replace: '' },
    { name: '过期备忘照样带', file: P.memo, find: '    .filter((m) => !m.until || m.until >= today)\n', replace: '' },
    { name: '备忘不过内容安全', file: P.fn, find: "    const sec = await checkText(openid, v.items.map((m) => m.text).join('\\n'), 2)\n", replace: '    const sec = { ok: true }\n' },
    { name: '员工也能写备忘', file: P.fn, find: 'async function staffMemo(event, openid) {\n  const gate = await staffGate(openid, { requireSuperAdmin: true })', replace: 'async function staffMemo(event, openid) {\n  const gate = await staffGate(openid)' },
    { name: '对话不带备忘', file: P.fn, find: "    (context ? `\\n\\n【当前经营数据（近 ${30} 天，服务端实时汇总；未出现的指标就是没有数据，不要推算）】\\n${context}` : '') +\n    (memo ? `\\n\\n${memo}` : '')", replace: "    (context ? `\\n\\n【当前经营数据（近 ${30} 天，服务端实时汇总；未出现的指标就是没有数据，不要推算）】\\n${context}` : '')" },
    { name: '礼券小样本也给核销率', file: P.ctx, find: 'rate: i >= 10 ?', replace: 'rate: i >= 1 ?' },
    { name: '脉搏读不到编 0', file: P.view, find: "return n == null || !Number.isFinite(Number(n)) ? '—' : String(n)", replace: 'return String(n || 0)' }
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
  console.log('✓ test:ai-center：入口 / 角色同源 / 云端白名单与兜底 / 本机会话 / 人设与门禁 / 全局上下文 / 主动巡检 全部通过')
}
