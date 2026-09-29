#!/usr/bin/env node
/**
 * 财务核算系统 · 门店日报解析 + 营收热力日历按日聚合（2026-09-27）
 *
 * 事故：ERP 热力日历 9/26 显示「¥2886、无订单」，而山川造物日报是 POS 9773.60 / 150 单。
 * 根因不在解析：同一天两家门店各一条日账（山川造物 + 星宸），日历用
 * `records.find(r => r.date === day)` 只取了第一条 → 显示的是星宸 ¥2886.32（星宸日报无订单数）。
 * 9/12 起凡两店同日的格子都会随机显示其中一家（14/16/17/20/21/22/23 的「黄格 + 负利润」即星宸）。
 *
 * 本守卫钉住：
 *   A. 黄金用例（山川造物 9/26 原文、星宸 9/26 原文）逐字段值；
 *   B. 变体：全/半角冒号、年月日带空格、全角数字、¥ 前缀、千分位、无「元」、ISO 日期、
 *      「9 月合计」、无分隔线仅编号明细、明细里出现「退款/订单/线上/POS/现金」字样不得被识别；
 *   C. 口径：营收 = POS + 线上 − 退款；现金（在手余额）与月合计**不计入**；
 *   D. 小程序店长端副本（manager + extra 镜像）与 Admin 对黄金用例/变体给出同样结果；
 *   E. 日历/「今日」速览按日聚合（同日多店求和），Finance.vue 不得退回 `.find(r => r.date === …)`。
 *   F. 门店营收按店拆分（2026-09-29「日报门店营收需要区分门店」）：
 *      ERP 财务页（当日 + 本月）与小程序每日日报（dailyDigest → getUserMessages 白名单 → digestView → 详情页）
 *      每店一行 + 合计行，**合计 = Σ 各店**；别名 id 归主店；无 storeId 一律归山川造物（产品负责人 2026-09-29 拍板，与 syncFinanceData 同惯例）；
 *      有 POS 却记 0 单显示「单数未记」。
 *   G. 店长首页金卡「门店｜STORE」= 山川 + 星宸合计（上月对比同口径），下方小字列各店；某店取数失败写「未取到」。
 *
 * 用法：
 *   node admin/scripts/test-finance-daily-parse.mjs
 *   node admin/scripts/test-finance-daily-parse.mjs --selftest   # 注入回归 → 必须检出（只改临时副本）
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const F = {
  parse: join(ROOT, 'admin/src/utils/financeDailyParse.js'),
  agg: join(ROOT, 'admin/src/utils/financeDayAggregate.js'),
  vue: join(ROOT, 'admin/src/components/Finance.vue'),
  mpManager: join(ROOT, 'miniprogram/subpackages/manager/utils/financeDailyParse.js'),
  mpExtra: join(ROOT, 'miniprogram/subpackages/extra/utils/financeDailyParse.js'),
  catalog: join(ROOT, 'miniprogram/cloudfunctions/dailyDigest/reportCatalog.js'),
  digestCore: join(ROOT, 'miniprogram/cloudfunctions/dailyDigest/dailyDigestCore.js'),
  digestCollect: join(ROOT, 'miniprogram/cloudfunctions/dailyDigest/dailyDigestCollect.js'),
  digestIndex: join(ROOT, 'miniprogram/cloudfunctions/dailyDigest/index.js'),
  getMessages: join(ROOT, 'miniprogram/cloudfunctions/getUserMessages/index.js'),
  digestView: join(ROOT, 'miniprogram/subpackages/extra/utils/digestView.js'),
  detailWxml: join(ROOT, 'miniprogram/subpackages/extra/user/messages/detail/index.wxml'),
  offlineSummary: join(ROOT, 'miniprogram/subpackages/manager/utils/offlineStoreSummary.js'),
  managerPage: join(ROOT, 'miniprogram/subpackages/manager/manager/managerPageConfig.js'),
  managerWxml: join(ROOT, 'miniprogram/subpackages/manager/manager/index.wxml'),
}
const read = (p) => readFileSync(p, 'utf8')

// ───────────── 黄金用例（产品负责人 2026-09-27 提供的原文，含其手打的「手镊/耳钙」） ─────────────
export const GOLDEN_SHANCHUAN_0926 = `山川造物
2026年 9月26日
银联POS收款:9773.60元
订单数:150
线上：0元
退款：0元
现金：1549.5元
9月合计：127204.18元
—————————
1.蓝闪蝶
   戒指 39
  蛇戒 0
  手链 单珠 37
           三珠30
           四珠1
           五珠29
           六珠7
           吊坠23
           耳钉 45s925 7个
           八珠项链 9
           蓝闪胸针2
2.夜明珠
   戒指 0
  手链 单珠 22
           三珠 21
           四珠2
           五珠 25
           六珠2
           吊坠 18
           耳钉0
3.血漪蛱蝶
   戒指31
  手链  单珠17
            三珠28
            四珠2
            五珠11
            吊坠 54
4.华艳色螅  
   戒指27
  手链 单珠14
           三珠18
           四珠4
           五珠9
           吊坠16
           八珠吊坠0
5.光明女神
   戒指0
6.彩珠 手链0
7.雅灰蝶
  胸针 9
  手镊 2
  手链1
8.蝴蝶翅膀耳钙17`

const GOLDEN_XINGCHEN_0926 = `星宸标本   (内部) 
2026年 9 月 26 日
银联POS收款:2886.32 元
退款：0元
线上：0 元
今日总额：2886.32 元
现金：787.1 元
9 月合计:40412.56 元
———————————
🦋光明女神
戒指—3个

🦋夜明珠
戒指—24 个（s925—0个）
手链单珠—15 个`

/** [名称, 原文, 期望（只比对列出的字段）] */
const CASES = [
  ['A1 黄金用例 · 山川造物 9/26', GOLDEN_SHANCHUAN_0926, {
    ok: true, date: '2026-09-26', pos: 9773.6, online: 0, refund: 0, cashBalance: 1549.5,
    orderCount: 150, monthTotal: 127204.18, revenue: 9773.6, storeNameHint: '山川造物',
  }],
  ['A2 黄金用例 · 星宸 9/26（无订单数）', GOLDEN_XINGCHEN_0926, {
    ok: true, date: '2026-09-26', pos: 2886.32, online: 0, refund: 0, cashBalance: 787.1,
    orderCount: null, monthTotal: 40412.56, revenue: 2886.32,
  }],
  ['B1 半角冒号 + 年月日无空格 + 退款相减', '山川造物\n2026年9月25日\n银联POS收款:12640.76元\n订单数:197\n线上:0元\n退款:39元\n现金:1244.5元\n9月合计:117430.58元', {
    ok: true, date: '2026-09-25', pos: 12640.76, refund: 39, orderCount: 197, revenue: 12601.76, monthTotal: 117430.58,
  }],
  ['B2 全角数字 + 全角冒号 + 年月日各带空格', '山川造物\n２０２６ 年 ９ 月 ２６ 日\n银联POS收款：９７７３．６０元\n订单数：１５０\n现金：１５４９．５元', {
    ok: true, date: '2026-09-26', pos: 9773.6, orderCount: 150, cashBalance: 1549.5, revenue: 9773.6,
  }],
  ['B3 ¥ 前缀 + 千分位 + 无「元」', '2026-09-26\n银联POS收款：¥9,773.60\n线上：￥116\n退款：0\n订单数：150', {
    ok: true, date: '2026-09-26', pos: 9773.6, online: 116, refund: 0, revenue: 9889.6, orderCount: 150,
  }],
  ['B4 缺「线上/退款」行 → 视为 0，不报错', '2026年9月26日\n银联POS收款:9773.60元', {
    ok: true, pos: 9773.6, online: null, refund: null, revenue: 9773.6,
  }],
  ['B5 本月合计 / 月合计标签不计入营收', '2026.9.26\n银联POS收款 9773.6 元\n本月合计：127204.18元', {
    ok: true, date: '2026-09-26', pos: 9773.6, monthTotal: 127204.18, revenue: 9773.6,
  }],
  ['B6 无分隔线 · 编号明细里的「退款/订单/线上/POS/现金」不得被识别', '2026年9月26日\n银联POS收款:9773.60元\n1.蓝闪蝶\n  订单 99\n  退款 88\n  线上 77\n  现金 66\n  POS 55\n  9月合计 44', {
    ok: true, pos: 9773.6, orderCount: null, refund: null, online: null, cashBalance: null, monthTotal: null, revenue: 9773.6,
  }],
  ['B7 分隔线后出现财务字样也不得被识别（---- 分隔）', '2026年9月26日\n银联POS收款:100元\n----------\n线上：999元\n退款：50元\n订单数：7', {
    ok: true, pos: 100, online: null, refund: null, orderCount: null, revenue: 100,
  }],
  ['B8 表头缺 POS、明细里有 POS → 必须报错而不是拿明细', '2026年9月26日\n现金：100元\n——————\n1.蓝闪蝶\n  POS收款 30', {
    ok: false,
  }],
  ['B9 🦋 明细（无编号、无分隔线）', '星宸\n2026年9月26日\n银联POS收款:500元\n🦋蓝闪蝶\n退款—3个\n订单—2个', {
    ok: true, pos: 500, refund: null, orderCount: null, revenue: 500,
  }],
]

/** 小程序副本的既有契约：缺「线上/退款」时回 0 而非 null（写表单用），视为等价 */
const ZERO_AS_NULL = new Set(['online', 'refund'])

function runParseChecks (parseFn, tag, { zeroAsNull = false } = {}) {
  const out = []
  for (const [name, text, exp] of CASES) {
    const got = parseFn(text)
    for (const [k, v] of Object.entries(exp)) {
      const g = got[k]
      const same = typeof v === 'number'
        ? typeof g === 'number' && Math.abs(g - v) < 0.005
        : g === v || (zeroAsNull && v === null && g === 0 && ZERO_AS_NULL.has(k))
      if (!same) out.push(`[${tag}] ${name}：${k} 期望 ${JSON.stringify(v)}，实得 ${JSON.stringify(g)}`)
    }
  }
  return out
}

function runAggregateChecks (agg) {
  const out = []
  const recs = [
    { date: '2026-09-26', storeId: 'store_xingchen', revenue: 2886.32, profit: -200, orderCount: 0 },
    { date: '2026-09-26', storeId: 'store_shanhaizaowu', revenue: 9812.6, profit: 3000, orderCount: 150 },
    { date: '2026-09-13', storeId: 'store_shanhaizaowu', revenue: 6862.74, profit: 2739, orderCount: 93 },
  ]
  const m = agg.groupFinanceRecordsByDate(recs)
  const d26 = m.get('2026-09-26')
  if (!d26) return ['[聚合] 9/26 没有分组结果']
  if (Math.abs(d26.revenue - 12698.92) > 0.005) out.push(`[聚合] 同日两店营收应求和 12698.92，实得 ${d26.revenue}`)
  if (d26.orderCount !== 150) out.push(`[聚合] 同日订单应求和 150（星宸 0 单不计），实得 ${d26.orderCount}`)
  if (Math.abs(d26.profit - 2800) > 0.005) out.push(`[聚合] 同日利润应求和 2800，实得 ${d26.profit}`)
  if (d26.storeCount !== 2) out.push(`[聚合] storeCount 应为 2，实得 ${d26.storeCount}`)
  const d13 = m.get('2026-09-13')
  if (!d13 || d13.revenue !== 6862.74 || d13.orderCount !== 93 || d13.storeCount !== 1) out.push('[聚合] 单店日不应被改动')
  const noOrder = agg.groupFinanceRecordsByDate([{ date: '2026-09-22', revenue: 98, orderCount: 0 }]).get('2026-09-22')
  if (!noOrder || noOrder.orderCount !== null) out.push('[聚合] 无订单数的日子 orderCount 应为 null（不显示「0 单」）')
  return out
}

function runVueChecks (src) {
  const out = []
  const cal = src.slice(src.indexOf('renderCalendar(monthStr, records)'), src.indexOf('\n    renderCumulative('))
  if (!cal || cal.length < 100) return ['[Finance.vue] 找不到 renderCalendar 函数体（锚点失效）']
  if (/records\.find\(\s*r\s*=>\s*r\.date\s*===/.test(cal)) out.push('[Finance.vue] renderCalendar 退回 records.find(r => r.date === …)：同日多店只会显示其中一家')
  if (!/groupFinanceRecordsByDate\(records\)/.test(cal)) out.push('[Finance.vue] renderCalendar 未按日聚合（groupFinanceRecordsByDate）')
  const quick = src.slice(src.indexOf('renderQuickDashboard(processed, s)'), src.indexOf('\n    renderMonthSelector('))
  if (!quick || quick.length < 100) return out.concat(['[Finance.vue] 找不到 renderQuickDashboard 函数体（锚点失效）'])
  if (/processed\.find\(\s*r\s*=>\s*r\.date\s*===\s*todayStr/.test(quick)) out.push('[Finance.vue] 「今日」速览退回 processed.find：同日多店只取一家')
  if (!/this\.renderStoreBreakdown\(records, keepDate\)/.test(cal)) out.push('[Finance.vue] renderCalendar 未渲染门店按店拆分（renderStoreBreakdown）')
  const sb = src.slice(src.indexOf('renderStoreBreakdown(records, date) {'), src.indexOf('\n    renderCumulative('))
  if (sb.length < 100) return out.concat(['[Finance.vue] 找不到 renderStoreBreakdown 函数体（锚点失效）'])
  if (!/buildFinanceStoreBreakdown\(records/.test(sb)) out.push('[Finance.vue] 按店拆分未走 buildFinanceStoreBreakdown（合计 = Σ 各店的唯一实现）')
  if (!/dayRow\(bd\.day\.total, true\)/.test(sb) || !/monthRow\(bd\.month\.total, true\)/.test(sb)) out.push('[Finance.vue] 按店拆分缺当日/本月合计行')
  if (!/id="storeBreakdown"/.test(src)) out.push('[Finance.vue] 模板缺 #storeBreakdown 容器')
  return out
}

const near = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 0.005
const sumOf = (rows, k) => {
  const vals = rows.map((r) => r[k]).filter((v) => v != null)
  return vals.length ? Math.round(vals.reduce((x, y) => x + y, 0) * 100) / 100 : null
}
/** 合计行每列必须 = Σ 各店（null 列两边都应为 null） */
function checkTotalIsSum (tag, rows, total, keys) {
  const out = []
  for (const k of keys) {
    const s = sumOf(rows, k)
    const t = total && total[k]
    if (s == null ? t != null : !near(s, t)) out.push(`[${tag}] 合计「${k}」${JSON.stringify(t)} ≠ 各店之和 ${JSON.stringify(s)}`)
  }
  return out
}

/** ERP 财务页：buildFinanceStoreBreakdown（当日 + 本月） */
function runErpStoreChecks (agg) {
  const out = []
  const recs = [
    { date: '2026-09-26', storeId: 'store_1780146782017_6w0okpr', revenue: 9812.6, pos: 9812.6, online: 0, refund: 0, orderCount: 150, cashBalance: 1549.5 },
    { date: '2026-09-26', storeId: 'store_xingchen', revenue: 2886.32, pos: 2886.32, online: 0, refund: 0, orderCount: 0, cashBalance: 787.1 },
    { date: '2026-09-25', storeId: 'store_shanhaizaowu', revenue: 12601.76, pos: 12640.76, online: 0, refund: 39, orderCount: 197, cashBalance: 1244.5 },
    { date: '2026-09-25', storeId: 'store_xingchen', revenue: 1000, pos: 1000, orderCount: 0 },
    // 无 storeId：即便原文写着「星宸」也归山川造物（2026-09-29 产品负责人拍板，与 syncFinanceData 同惯例）
    { date: '2026-09-24', storeId: '', raw: '星宸标本 (内部)\n2026年9月24日\n银联POS收款:88元', revenue: 88, pos: 88 },
  ]
  if (typeof agg.buildFinanceStoreBreakdown !== 'function') return ['[ERP 按店] 缺 buildFinanceStoreBreakdown 导出']
  const bd = agg.buildFinanceStoreBreakdown(recs, { date: '2026-09-26' })
  const names = bd.day.rows.map((r) => r.name).join('/')
  if (names !== '山川造物/星宸标本') out.push(`[ERP 按店] 9/26 当日应为「山川造物/星宸标本」两行（别名 id 归主店），实得「${names}」`)
  const sc = bd.day.rows.find((r) => r.storeId === 'store_shanhaizaowu')
  if (!sc || !near(sc.revenue, 9812.6) || sc.orderCount !== 150 || !near(sc.cashBalance, 1549.5)) out.push(`[ERP 按店] 山川造物当日行不对：${JSON.stringify(sc)}`)
  const xc = bd.day.rows.find((r) => r.storeId === 'store_xingchen')
  if (!xc || !near(xc.revenue, 2886.32) || xc.orderCount !== null) out.push(`[ERP 按店] 星宸当日行不对（0 单应为 null =「单数未记」）：${JSON.stringify(xc)}`)
  out.push(...checkTotalIsSum('ERP 当日', bd.day.rows, bd.day.total, agg.STORE_DAY_COLUMNS))
  if (!near(bd.day.total.revenue, 12698.92)) out.push(`[ERP 按店] 9/26 合计营收应为 12698.92，实得 ${bd.day.total.revenue}`)

  const monthNames = bd.month.rows.map((r) => r.name).join('/')
  if (monthNames !== '山川造物/星宸标本') out.push(`[ERP 按店] 本月应按「山川造物/星宸标本」拆分（无 storeId 归山川，不再有「未指定门店」），实得「${monthNames}」`)
  const mxc = bd.month.rows.find((r) => r.storeId === 'store_xingchen')
  if (!mxc || !near(mxc.revenue, 3886.32) || mxc.days !== 2) out.push(`[ERP 按店] 星宸本月应 3886.32 / 2 天，实得 ${JSON.stringify(mxc)}`)
  const msc = bd.month.rows.find((r) => r.storeId === 'store_shanhaizaowu')
  if (!msc || !near(msc.revenue, 22502.36) || msc.days !== 3) out.push(`[ERP 按店] 山川本月应 22502.36 / 3 天（含无 storeId 的 9/24，即便原文写星宸），实得 ${JSON.stringify(msc)}`)
  out.push(...checkTotalIsSum('ERP 本月', bd.month.rows, bd.month.total, ['revenue', 'orderCount']))
  if (bd.month.total.days !== 3) out.push(`[ERP 按店] 本月合计「有数据天数」应为去重日期数 3（营业天数不可相加），实得 ${bd.month.total.days}`)

  const latest = agg.buildFinanceStoreBreakdown(recs)
  if (latest.date !== '2026-09-26') out.push(`[ERP 按店] 未指定日期时应默认本月最近一天 2026-09-26，实得 ${latest.date}`)
  for (const r of [{}, { storeId: 'default' }, { storeName: '星宸标本' }]) {
    if (agg.resolveFinanceStore(r).storeId !== 'store_shanhaizaowu') out.push(`[ERP 按店] 无 storeId 应一律归山川造物：${JSON.stringify(r)}`)
  }
  return out
}

/** 9/26 两店真实形态（数值取自线上 daily_revenues / store_ledger 的形态，测试内构造） */
function digestRows0926 () {
  return {
    daily_revenues: [
      { date: '2026-09-26', storeId: 'store_shanhaizaowu', total: 9812.6, online: 0 },
      { date: '2026-09-26', storeId: 'store_xingchen', total: 2886.32, online: 0 },
    ],
    store_ledger: [
      { date: '2026-09-26', storeId: 'store_1780146782017_6w0okpr', pos: 9812.6, orderCount: 150, refundAmount: 0, cashBalance: 1549.5 },
      { date: '2026-09-26', storeId: 'store_xingchen', pos: 2886.32, orderCount: 0, refundAmount: 0, cashBalance: 787.1 },
    ],
  }
}
/** 当日出货单（ops_shipments 投影出的目标门店）：山川 2 单（含旧编号）、星宸 1 单 */
const SHIP_ROWS_0926 = [{ storeId: 'store_shanhaizaowu' }, { storeId: 'store_1780146782017_6w0okpr' }, { storeId: 'store_xingchen' }]
const DIGEST_KEYS = ['revenueYuan', 'posYuan', 'orderCount', 'refundYuan', 'onlineYuan', 'cashBalanceYuan', 'shipmentCount']

/** 小程序每日日报：dailyDigestCore → getUserMessages 白名单 → digestView → 详情页 wxml */
function runDigestStoreChecks (core, normalizeStoreBreakdown, view, srcs) {
  const out = []
  const digest = core.buildDigest({
    dayKey: '2026-09-26',
    dateKeyedRows: digestRows0926(),
    simpleDay: { studio_shipments: 3 },
    simpleDayRows: { studio_shipments: SHIP_ROWS_0926 },
  })
  const bd = digest.storeBreakdown
  if (!bd || !Array.isArray(bd.rows)) return ['[日报 按店] 超管日报没有 storeBreakdown（门店营收未按店拆分）']
  const names = bd.rows.map((r) => r.name).join('/')
  if (names !== '山川造物/星宸标本') out.push(`[日报 按店] 应为「山川造物/星宸标本」两行（账本别名 id 与营收主 id 归同一店），实得「${names}」`)
  const sc = bd.rows[0] || {}
  if (!near(sc.revenueYuan, 9812.6) || !near(sc.posYuan, 9812.6) || sc.orderCount !== 150 || !near(sc.cashBalanceYuan, 1549.5)) out.push(`[日报 按店] 山川造物行不对：${JSON.stringify(sc)}`)
  if (sc.shipmentCount !== 2 || (bd.rows[1] || {}).shipmentCount !== 1) out.push(`[日报 按店] 出货单应按目标门店拆成 山川 2 / 星宸 1（旧编号归山川），实得 ${sc.shipmentCount} / ${(bd.rows[1] || {}).shipmentCount}`)
  const shipFail = core.buildStoreBreakdown(digestRows0926(), {}, { studio_shipments: { error: 'x' } })
  if (!shipFail || !shipFail.failedCollections.includes('ops_shipments') || shipFail.total.shipmentCount !== null) out.push('[日报 按店] 出货单取数失败应记进 failedCollections 且显示「—」，不当成 0 单')
  out.push(...checkTotalIsSum('日报', bd.rows, bd.total, DIGEST_KEYS))
  if (!near(bd.total && bd.total.revenueYuan, 12698.92)) out.push(`[日报 按店] 合计营收应为 12698.92，实得 ${bd.total && bd.total.revenueYuan}`)
  if (!Array.isArray(bd.mismatches) || bd.mismatches.length) out.push(`[日报 按店] 按店合计应与门店营收指标对得上，实得 mismatches=${JSON.stringify(bd.mismatches)}`)

  const tampered = JSON.parse(JSON.stringify(bd))
  // 在手现金没有同口径指标，只能靠「合计 = Σ 各店」这一条对账检出
  tampered.total.cashBalanceYuan += 1
  if (!core.checkStoreBreakdownBalance(tampered, digest.metrics).length) out.push('[日报 按店] 合计 ≠ 各店之和时 checkStoreBreakdownBalance 未报出')

  const text = core.buildMessageText(digest)
  for (const s of ['按门店：', '· 山川造物：', '· 星宸标本：', '· 合计：']) {
    if (!text.includes(s)) out.push(`[日报 按店] 站内信正文缺「${s}」`)
  }
  const xcLine = text.split('\n').find((l) => l.startsWith('· 星宸标本：')) || ''
  if (/\b0 单/.test(xcLine) || !xcLine.includes('单数未记')) out.push(`[日报 按店] 星宸有 POS 却记 0 单，应显示「单数未记」：${xcLine}`)

  const fb = core.buildStoreBreakdown({
    daily_revenues: [
      { storeId: '', raw: '星宸标本 2026年9月26日', total: 50 },
      { total: 30 },
      { storeId: 'store_xingchen', total: 20 },
    ],
    store_ledger: { error: 'timeout' },
  })
  const fbNames = fb ? fb.rows.map((r) => r.name).join('/') : ''
  if (fbNames !== '山川造物/星宸标本' || !near(fb.rows[0].revenueYuan, 80)) {
    out.push(`[日报 按店] 历史无 storeId 应一律归山川造物（即便原文写星宸），实得「${fbNames}」${fb ? ' 山川营收 ' + fb.rows[0].revenueYuan : ''}`)
  }
  if (!fb || !fb.failedCollections.includes('store_ledger')) out.push('[日报 按店] store_ledger 取数失败应记进 failedCollections（不当成 0）')
  if (fb && fb.total.posYuan !== null) out.push('[日报 按店] store_ledger 取数失败时 POS 合计应为 null（—），不得显示 ¥0')
  if (core.buildStoreBreakdown({ daily_revenues: { error: 'x' }, store_ledger: { error: 'y' } }) !== null) out.push('[日报 按店] 两个来源都失败时应返回 null（不渲染按店块）')

  if (typeof normalizeStoreBreakdown !== 'function') {
    out.push('[getUserMessages] 缺 normalizeStoreBreakdown（payload.storeBreakdown 会被白名单丢弃）')
  } else {
    const n = normalizeStoreBreakdown(JSON.parse(JSON.stringify(bd)))
    if (!n || n.rows.length !== 2 || !near(n.total.revenueYuan, 12698.92) || n.rows[1].orderCount !== 0) out.push('[getUserMessages] normalizeStoreBreakdown 未原样放行按店行/合计')
    if (normalizeStoreBreakdown(undefined) !== null) out.push('[getUserMessages] 旧日报无 storeBreakdown 应回 null')
  }
  if (!/storeBreakdown:\s*normalizeStoreBreakdown\(raw\.storeBreakdown\)/.test(srcs.getMessages)) out.push('[getUserMessages] normalizeDigestPayload 未透传 storeBreakdown')
  if (!/storeBreakdown:\s*digest\.storeBreakdown/.test(srcs.digestIndex)) out.push('[dailyDigest] 站内信 payload 未写入 storeBreakdown')

  const v = view.buildStoreBreakdownView(bd)
  if (!v || v.rows.length !== 2 || !v.total) {
    out.push('[digestView] buildStoreBreakdownView 未产出各店行 + 合计行')
  } else {
    if (v.rows[1].orderText !== '单数未记') out.push(`[digestView] 星宸 0 单且有 POS 应显示「单数未记」，实得「${v.rows[1].orderText}」`)
    if (v.rows[0].orderText !== '150 单') out.push(`[digestView] 山川造物单数应为「150 单」，实得「${v.rows[0].orderText}」`)
    if (v.balanceWarn) out.push(`[digestView] 对得上的数据不应报 balanceWarn：${v.balanceWarn}`)
  }
  const vt = view.buildStoreBreakdownView(tampered)
  if (!vt || !vt.balanceWarn) out.push('[digestView] 合计 ≠ 各店之和时未给出 balanceWarn')
  if (view.buildStoreBreakdownView(undefined) !== null) out.push('[digestView] 旧日报无 storeBreakdown 应回 null')
  // 详情页：用真实目录（带 source/caveat 开发口径）生成的全量 payload 跑一遍视图
  const payload = {
    metrics: digest.metrics,
    sections: digest.sections.map((s) => ({ key: s.key, label: s.label, ids: s.metrics.map((m) => m.id) })),
    storeBreakdown: typeof normalizeStoreBreakdown === 'function' ? normalizeStoreBreakdown(JSON.parse(JSON.stringify(bd))) : bd,
  }
  const dv = view.buildDigestView({ payload })
  const storeSec = dv && dv.sections.find((s) => s.key === 'store')
  if (!storeSec || !storeSec.storeBreakdown) return out.concat(['[digestView] 「门店营收」分组未挂 storeBreakdown'])
  const row = (id) => storeSec.metrics.find((m) => m.id === id) || {}
  const split = (id) => (row(id).stores || []).map((s) => `${s.name} ${s.valueText}`).join(' / ')
  const wantSplit = {
    store_revenue_yuan: '山川造物 ¥9812.60 / 星宸标本 ¥2886.32',
    store_ledger_pos_yuan: '山川造物 ¥9812.60 / 星宸标本 ¥2886.32',
    store_ledger_offline_orders: '山川造物 150 单 / 星宸标本 未记单数',
    studio_shipments: '山川造物 2 单 / 星宸标本 1 单',
    store_cash_balance: '山川造物 ¥1549.50 / 星宸标本 ¥787.10',
  }
  for (const [id, want] of Object.entries(wantSplit)) {
    if (split(id) !== want) out.push(`[digestView] 门店营收「${row(id).label || id}」应逐店显示「${want}」，实得「${split(id)}」`)
  }
  if (row('store_cash_balance').valueText !== '¥2336.60') out.push(`[digestView] 在手现金合计应为 ¥2336.60，实得 ${row('store_cash_balance').valueText}`)

  // 开发侧说明（集合名 / 字段 / 口径辩护 / markdown）只留在 reportCatalog 与代码注释，界面不得出现
  const DEV_TEXT = /daily_revenues|store_ledger|ops_shipments|order_paid_fen|analytics_daily|totalFen|\*\*|禁止|口径/
  const shown = []
  dv.sections.forEach((s) => {
    shown.push(s.label, s.countText, s.storeNotice || '')
    s.metrics.forEach((m) => {
      shown.push(m.label, m.valueText, m.note || '', m.failedText || '')
      ;(m.stores || []).forEach((st) => shown.push(st.name, st.valueText))
    })
  })
  shown.push(dv.healthSummary, dv.snapshotNote, dv.countNote, dv.missingNote, dv.failedNote)
  const leaked = shown.filter((t) => DEV_TEXT.test(String(t || '')))
  if (leaked.length) out.push(`[digestView] 界面文案混入开发侧说明：${leaked.slice(0, 3).join(' | ')}`)
  const tailLine = core.buildMessageText(digest).split('\n').pop()
  if (DEV_TEXT.test(tailLine)) out.push(`[日报 正文] 结尾仍是开发侧口径提示：${tailLine}`)

  const old = view.buildDigestView({ payload: { ...payload, storeBreakdown: undefined } })
  const oldStore = old && old.sections.find((s) => s.key === 'store')
  if (!oldStore || !/还没有按门店拆分/.test(oldStore.storeNotice || '') || oldStore.metrics.some((m) => m.stores)) {
    out.push('[digestView] 按店拆分上线前的旧日报应提示「还没有按门店拆分」，且不伪造各店数')
  }

  const w = srcs.detailWxml
  if (!/wx:if="\{\{m\.stores\}\}"/.test(w) || !/wx:for="\{\{m\.stores\}\}"/.test(w)) out.push('[详情页 wxml] 门店营收指标未逐店渲染（m.stores）')
  if (!/\{\{sec\.storeNotice\}\}/.test(w)) out.push('[详情页 wxml] 未渲染门店段提示 sec.storeNotice')
  for (const k of ['m.caveat', 'm.sourceText', 'm.sourceBrief', 'showSources']) {
    if (w.includes(k)) out.push(`[详情页 wxml] 仍渲染开发侧口径字段 ${k}（说明应保留在开发侧）`)
  }
  return out
}

/**
 * 日报「门店出货单」排除已删除（2026-09-29 产品负责人拍板）：
 * 生产实测软删标记 = ops_shipments.deleted（布尔，manageStoreShipment 删除写 true；老行可能缺字段 → 视为未删）。
 * 用按条件过滤的内存假库跑真实 collectSimpleDay，合计（count 路径）与分门店（行路径）必须一致排除。
 */
function fakeShipmentDb (rows) {
  const NEQ = Symbol('neq')
  const match = (where) => (r) => Object.entries(where).every(([k, v]) =>
    v && v[NEQ] !== undefined ? r[k] !== v[NEQ] : r[k] === v)
  return {
    command: { neq: (v) => ({ [NEQ]: v }) },
    collection: () => ({
      where: (w) => {
        const hit = rows.filter(match(w))
        const q = { field: () => q, skip: (n) => { q._s = n; return q }, limit: () => q,
          get: async () => ({ data: hit.slice(q._s || 0, (q._s || 0) + 1000) }),
          count: async () => ({ total: hit.length }) }
        return q
      },
    }),
  }
}
async function runShipmentDeletedChecks (collect, core, catalog) {
  const out = []
  const metric = (catalog.METRICS || []).find((m) => m.id === 'studio_shipments')
  if (!metric) return ['[日报 出货单] 目录缺 studio_shipments']
  const day = '2026-09-26'
  const rows = [
    { shipmentDate: day, storeId: 'store_shanhaizaowu', deleted: false },
    { shipmentDate: day, storeId: 'store_shanhaizaowu', deleted: true },
    { shipmentDate: day, storeId: 'store_xingchen' },
    { shipmentDate: day, storeId: 'store_xingchen', deleted: false },
    { shipmentDate: day, storeId: 'store_xingchen', deleted: true },
    { shipmentDate: '2026-09-25', storeId: 'store_xingchen', deleted: false },
  ]
  const db = fakeShipmentDb(rows)
  const rowsOut = {}
  const withRows = await collect.collectSimpleDay(db, day, [metric], rowsOut)
  const countOnly = await collect.collectSimpleDay(db, day, [metric])
  if (withRows.studio_shipments !== 3) out.push(`[日报 出货单] 合计应排除已删除（deleted: true）= 3 单，实得 ${JSON.stringify(withRows.studio_shipments)}`)
  if (countOnly.studio_shipments !== 3) out.push(`[日报 出货单] 计数路径也应排除已删除 = 3 单，实得 ${JSON.stringify(countOnly.studio_shipments)}`)
  const bd = core.buildStoreBreakdown({ daily_revenues: [], store_ledger: [] }, rowsOut, withRows)
  const byName = {}
  ;((bd && bd.rows) || []).forEach((r) => { byName[r.name] = r.shipmentCount })
  if (byName['山川造物'] !== 1 || byName['星宸标本'] !== 2) out.push(`[日报 出货单] 分门店应同样排除已删除：山川 1 / 星宸 2，实得 ${JSON.stringify(byName)}`)
  if (bd && bd.total && bd.total.shipmentCount !== withRows.studio_shipments) out.push('[日报 出货单] 分门店合计与指标合计不一致')
  return out
}

/** 店长首页金卡「门店｜STORE」：两店合计 + 各店拆分（2026-09-29 点名修复：原来只算山川） */
async function runGoldCardChecks (mod, srcs) {
  const out = []
  const fmt = (n) => Number(n).toFixed(2)
  const s = mod.summarizeOfflineStores([
    { storeId: 'store_shanhaizaowu', total: 9812.6, ok: true },
    { storeId: 'store_xingchen', total: 2886.32, ok: true },
  ], fmt)
  if (!near(s.total, 12698.92)) out.push(`[金卡] 门店合计应为两店之和 12698.92，实得 ${s.total}`)
  if (!near(s.total, s.stores.reduce((a, x) => a + x.total, 0))) out.push('[金卡] 合计 ≠ 各店之和')
  if (s.splitText !== '山川 ¥9812.60 · 星宸 ¥2886.32') out.push(`[金卡] 各店拆分小字应为「山川 ¥9812.60 · 星宸 ¥2886.32」，实得「${s.splitText}」`)
  const f = mod.summarizeOfflineStores([{ storeId: 'store_shanhaizaowu', total: 100, ok: true }, { storeId: 'store_xingchen', total: 0, ok: false }], fmt)
  if (!f.splitText.includes('星宸 未取到') || !f.failedNames.includes('星宸标本')) out.push(`[金卡] 某店取数失败应写「未取到」而不是 ¥0：${f.splitText}`)
  const called = []
  const viaFn = await mod.sumOfflineByStore(async (sid, ym) => { called.push(`${sid}@${ym}`); return { total: sid === 'store_xingchen' ? 2 : 1 } }, '2026-08', fmt)
  if (called.sort().join(',') !== 'store_shanhaizaowu@2026-08,store_xingchen@2026-08' || viaFn.total !== 3) out.push(`[金卡] sumOfflineByStore 应按月逐店取数并求和，实得调用 ${called.join(',')} 合计 ${viaFn.total}`)

  const load = srcs.managerPage.slice(srcs.managerPage.indexOf('async loadOfflineStats()'), srcs.managerPage.indexOf('async _fetchPaidOrderAmounts('))
  if (load.length < 50) return out.concat(['[金卡] 找不到 loadOfflineStats 函数体（锚点失效）'])
  if (!/sumOfflineByStore\(storeLedger\.sumMonthOffline/.test(load) || /sumMonthOffline\(storeLedger\.FINANCE_STORE_ID\)/.test(load)) out.push('[金卡] loadOfflineStats 退回只统计主店（山川）')
  if (!/'stats\.offlineSplitText':\s*summary\.splitText/.test(load)) out.push('[金卡] loadOfflineStats 未写入各店拆分 stats.offlineSplitText')
  const stats = srcs.managerPage.slice(srcs.managerPage.indexOf('async loadStats(offlineTotal = 0)'), srcs.managerPage.indexOf('async loadStats(offlineTotal = 0)') + 3000)
  if (!/sumOfflineByStore\(storeLedger\.sumMonthOffline, prevYm\)/.test(stats)) out.push('[金卡] 上月对比仍只算主店（环比会拿两店本月比一店上月）')
  if (!/stats\.offlineSplitText/.test(srcs.managerWxml)) out.push('[金卡] 店长首页 wxml 未展示各店拆分')
  return out
}

/** getUserMessages 依赖 wx-server-sdk，不整文件加载：只抽出 clipText … normalizeStoreBreakdown 这一段执行 */
function extractNormalizeStoreBreakdown (src) {
  const a = src.indexOf('function clipText')
  const b = src.indexOf('function normalizeDigestPayload')
  if (a === -1 || b === -1 || b < a || !src.slice(a, b).includes('function normalizeStoreBreakdown')) return null
  // eslint-disable-next-line no-new-func
  return new Function('DIGEST_STR_MAX', `${src.slice(a, b)}\nreturn normalizeStoreBreakdown`)(200)
}

function loadCjs (path, deps = {}) {
  const m = { exports: {} }
  const req = (id) => (id in deps ? deps[id] : {})
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', read(path))(m, m.exports, req)
  return m.exports
}

async function loadEsm (path) {
  return import(pathToFileURL(path).href + `?t=${Date.now()}${Math.random()}`)
}

async function collect (paths) {
  const p = { ...F, ...paths }
  const problems = []
  const parse = await loadEsm(p.parse)
  const agg = await loadEsm(p.agg)
  problems.push(...runParseChecks(parse.parseDailyFinanceText, 'admin'))
  problems.push(...runParseChecks(loadCjs(p.mpManager).parseDailyFinanceText, '小程序 manager', { zeroAsNull: true }))
  if (read(p.mpManager) !== read(p.mpExtra)) problems.push('[小程序] extra/utils/financeDailyParse.js 与 manager 源不一致（subpackage-mirrors）')
  problems.push(...runAggregateChecks(agg))
  problems.push(...runVueChecks(read(p.vue)))
  problems.push(...runErpStoreChecks(agg))
  const catalog = loadCjs(p.catalog)
  const core = loadCjs(p.digestCore, { './reportCatalog': catalog })
  problems.push(...await runShipmentDeletedChecks(
    loadCjs(p.digestCollect, { './reportCatalog': catalog, './dailyDigestCore': core }), core, catalog))
  const getMessagesSrc = read(p.getMessages)
  problems.push(...runDigestStoreChecks(core, extractNormalizeStoreBreakdown(getMessagesSrc), loadCjs(p.digestView), {
    getMessages: getMessagesSrc,
    digestIndex: read(p.digestIndex),
    detailWxml: read(p.detailWxml),
  }))
  problems.push(...await runGoldCardChecks(loadCjs(p.offlineSummary), {
    managerPage: read(p.managerPage),
    managerWxml: read(p.managerWxml),
  }))
  return problems
}

async function selftest () {
  const tmp = mkdtempSync(join(tmpdir(), 'fin-parse-self-'))
  let ok = 0
  let bad = 0
  const t = (label, res) => { if (res) { console.log(`  ✓ ${label}`); ok++ } else { console.error(`  ✗ ${label}`); bad++ } }
  let n = 0
  /** 在临时副本里注入；锚点不命中视为注入失效（判失败，而非恒绿） */
  const mutate = (key, from, to) => {
    const src = read(F[key])
    if (!src.includes(from)) return null
    const ext = F[key].endsWith('.vue') ? '.vue' : '.js'
    const p = join(tmp, `${key}-${n++}${ext}`)
    writeFileSync(p, src.split(from).join(to), 'utf8')
    return p
  }
  const expectCaught = async (label, key, from, to) => {
    const p = mutate(key, from, to)
    if (!p) { t(`${label}（锚点失效）`, false); return }
    const probs = await collect({ [key]: p, ...(key === 'mpManager' ? { mpExtra: p } : {}) })
    t(`★ 被检出：${label}`, probs.length > 0)
  }
  try {
    const clean = await collect({})
    t('基线：干净源码零问题', clean.length === 0)
    clean.forEach((e) => console.error('     · ' + e))

    await expectCaught('解析不再限定表头（明细里的退款/订单被当成金额）', 'parse',
      'const head = splitDailyReportHeader(normalizeDailyReportText(raw)).header',
      'const head = normalizeDailyReportText(raw)')
    await expectCaught('在手现金被计入当日营收', 'parse',
      'const revenue = Math.max(0, pos + onlineN - refundN)',
      'const revenue = Math.max(0, pos + onlineN - refundN + (cashBalance || 0))')
    await expectCaught('退款不再相减', 'parse',
      'const revenue = Math.max(0, pos + onlineN - refundN)',
      'const revenue = Math.max(0, pos + onlineN)')
    await expectCaught('不再识别 ¥ 前缀', 'parse', '[¥￥]?\\\\s*', '')
    await expectCaught('全角数字不再折半角', 'parse', ".replace(/[０-９]/g,", ".replace(/[]/g,")
    await expectCaught('聚合退回「后到者覆盖」（同日只剩一家）', 'agg',
      'g.revenue += Number(r.revenue) || 0', 'g.revenue = Number(r.revenue) || 0')
    await expectCaught('热力日历退回 records.find（本次事故形态）', 'vue',
      'const day = byDate.get(dateStr);',
      'const day = (() => { const r = records.find(r => r.date === dateStr); return r ? { revenue: r.revenue, profit: r.profit, orderCount: r.orderCount, storeCount: 1, records: [r] } : null })();')
    await expectCaught('「今日」速览退回 processed.find', 'vue',
      'const todayData = groupFinanceRecordsByDate(processed.filter(r => r.date === todayStr)).get(todayStr) || null;',
      'const todayData = processed.find(r => r.date === todayStr);')
    await expectCaught('小程序店长端解析不再限定表头', 'mpManager',
      'const head = splitDailyReportHeader(normalizeDailyReportText(raw)).header',
      'const head = normalizeDailyReportText(raw)')
    await expectCaught('ERP 按店合计不再求和（只取第一家）', 'agg',
      'total[k] = vals.length ? round2(vals.reduce((a, b) => a + b, 0)) : null',
      'total[k] = vals.length ? vals[0] : null')
    await expectCaught('ERP 别名 id 不再归主店（山川造物被拆成两行）', 'agg',
      '(s.storeId === sid || s.aliases.includes(sid))', '(s.storeId === sid)')
    await expectCaught('ERP 无 storeId 不再归山川（退回「未指定门店」）', 'agg',
      "if (!sid || sid === 'default') return { storeId: main.storeId, name: main.name }",
      "if (!sid || sid === 'default') return { storeId: '__unassigned__', name: '未指定门店' }")
    await expectCaught('ERP 无 storeId 按原文推断（原文写星宸就归星宸）', 'agg',
      "if (!sid || sid === 'default') return { storeId: main.storeId, name: main.name }",
      "if (!sid || sid === 'default') return /星宸/.test(`${r?.storeName || ''} ${r?.raw || ''}`) ? { storeId: 'store_xingchen', name: '星宸标本' } : { storeId: main.storeId, name: main.name }")
    await expectCaught('日报无 storeId 不再归山川（退回「未指定门店」）', 'digestCore',
      "if (!sid || sid === 'default') return { storeId: main.storeId, name: main.name }",
      "if (!sid || sid === 'default') return { storeId: '__unassigned__', name: '未指定门店' }")
    await expectCaught('Finance.vue 日历不再渲染按店拆分', 'vue',
      'this.renderStoreBreakdown(records, keepDate);', '')
    await expectCaught('日报按店合计不再求和（只取第一家）', 'digestCore',
      'total[c.key] = vals.length ? round2(vals.reduce((a, b) => a + b, 0)) : null',
      'total[c.key] = vals.length ? vals[0] : null')
    await expectCaught('日报别名 id 不再归主店', 'digestCore',
      "(s.aliases || []).indexOf(sid) !== -1", 'false')
    await expectCaught('超管日报不再生成 storeBreakdown', 'digestCore',
      'storeBreakdown = buildStoreBreakdown(dateKeyedRows, raw.simpleDayRows, simpleDay)', 'storeBreakdown = null')
    await expectCaught('合计 ≠ 各店之和不再报出', 'digestCore',
      'out.push(`${c.label}：合计 ${tot} ≠ 各店之和 ${sum}`)', 'void 0')
    await expectCaught('站内信正文不再输出各店行', 'digestCore',
      'bd.rows.forEach((r) => lines.push(breakdownLine(r)))', 'void 0')
    await expectCaught('日报 payload 不再写 storeBreakdown', 'digestIndex',
      'storeBreakdown: digest.storeBreakdown || null,', '')
    await expectCaught('getUserMessages 白名单丢掉 storeBreakdown', 'getMessages',
      'storeBreakdown: normalizeStoreBreakdown(raw.storeBreakdown),', '')
    await expectCaught('digestView 不再把按店块挂到「门店营收」分组', 'digestView',
      'storeBreakdown: isStore ? storeBreakdown : null', 'storeBreakdown: null')
    await expectCaught('digestView 把「有 POS 的 0 单」显示成「0 单」', 'digestView',
      'r && r.orderCount === 0 && toNumber(r.posYuan) > 0 ? null : ', '')
    await expectCaught('详情页门店营收退回只显示合计（不逐店）', 'detailWxml',
      '<view class="dg-split" wx:if="{{m.stores}}">', '<view class="dg-split" wx:if="{{false}}">')
    await expectCaught('详情页重新渲染开发侧口径（caveat）', 'detailWxml',
      '<text class="dg-row-note" wx:if="{{m.note}}">{{m.note}}</text>',
      '<text class="dg-row-note" wx:if="{{m.note}}">{{m.note}}</text><text class="dg-caveat">{{m.caveat}}</text>')
    await expectCaught('digestView 门店营收不再逐项挂各店数', 'digestView',
      'rows.forEach((r) => { if (!r.failed) r.stores = storeSplitFor(r.id, payload.storeBreakdown); });', 'void 0;')
    await expectCaught('digestView 把目录 caveat（集合名/markdown）当成界面说明', 'digestView',
      "note: USER_NOTES[m.id] || ''", "note: String(m.caveat || USER_NOTES[m.id] || '')")
    await expectCaught('digestView 逐店单数把「有 POS 的 0 单」显示成「0 单」', 'digestView',
      "const noOrders = key === 'orderCount' && v === 0 && toNumber(r.posYuan) > 0;", 'const noOrders = false;')
    await expectCaught('日报出货单目录去掉软删标记（已删除又被计入）', 'catalog',
      "deletedField: 'deleted',", '')
    await expectCaught('日报出货单查询不再排除已删除', 'digestCollect',
      'if (metric.deletedField) where[metric.deletedField] = db.command.neq(true)', '')
    await expectCaught('日报出货单只在计数路径排除已删除（分门店没排除）', 'digestCollect',
      '.where(where)\n            .field(', '.where({ [field]: dayKey })\n            .field(')
    await expectCaught('日报出货单不再按门店计数', 'digestCore',
      'const v = col.count ? 1 : row && row[col.field]', 'const v = col.count ? 0 : row && row[col.field]')

    await expectCaught('金卡合计只取山川一家', 'offlineSummary',
      'const total = round2(stores.reduce((a, s) => a + s.total, 0))', 'const total = stores[0].total')
    await expectCaught('金卡某店取数失败被显示成 ¥0', 'offlineSummary',
      "s.ok ? '¥' + s.totalText : '未取到'", "'¥' + fmt(s.total)")
    await expectCaught('金卡退回只统计主店（本次点名修复的事故形态）', 'managerPage',
      'await sumOfflineByStore(storeLedger.sumMonthOffline, undefined, storeLedger.formatMoney)',
      "({ total: (await storeLedger.sumMonthOffline(storeLedger.FINANCE_STORE_ID)).total, splitText: '' })")
    await expectCaught('金卡上月对比退回只算主店', 'managerPage',
      'sumOfflineByStore(storeLedger.sumMonthOffline, prevYm)', 'storeLedger.sumMonthOffline(storeLedger.FINANCE_STORE_ID, prevYm)')
    await expectCaught('店长首页不再展示各店拆分', 'managerWxml',
      '{{stats.offlineSplitText}}', '')

    const drift = join(tmp, 'extra-drift.js')
    writeFileSync(drift, read(F.mpExtra) + '\n// drift\n', 'utf8')
    t('★ 被检出：extra 镜像与 manager 源漂移', (await collect({ mpExtra: drift })).length > 0)
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  }
  console.log(`\n自检：${ok} 项通过 / ${bad} 项失败`)
  return bad === 0
}

async function main () {
  if (process.argv.includes('--selftest')) process.exit((await selftest()) ? 0 : 1)
  const problems = await collect({})
  if (problems.length) {
    console.error(`✗ 门店日报解析 / 日历聚合守卫失败 ${problems.length} 项：`)
    problems.forEach((p) => console.error('  · ' + p))
    process.exit(1)
  }
  console.log(`✓ 门店日报解析 / 日历聚合守卫通过：${CASES.length} 个解析用例 × 2 端（Admin + 小程序店长）、按日聚合 6 项、Finance.vue 聚合 + 按店拆分、ERP/日报门店营收按店拆分（合计 = Σ 各店、别名归主店、无 storeId 归山川）、店长金卡两店合计`)
}

main().catch((e) => { console.error('✗ 守卫执行异常：', e); process.exit(1) })
