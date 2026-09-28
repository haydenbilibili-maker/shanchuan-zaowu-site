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
  return out
}

function loadCjs (path) {
  const m = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', read(path))(m, m.exports, () => ({}))
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
  console.log(`✓ 门店日报解析 / 日历聚合守卫通过：${CASES.length} 个解析用例 × 2 端（Admin + 小程序店长）、按日聚合 6 项、Finance.vue 2 处聚合调用`)
}

main().catch((e) => { console.error('✗ 守卫执行异常：', e); process.exit(1) })
