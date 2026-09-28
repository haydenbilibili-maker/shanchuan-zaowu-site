#!/usr/bin/env node
/**
 * 超管数据报表 ·「昨日 / 选某一天」单日视图守卫（reporting 域；2026-09-28 产品负责人点名需求）
 *
 * 钉住四件容易静默失效的事：
 *   ① 营业日口径：昨日 = 北京时间（UTC+8）自然日 00:00–24:00；凌晨 00:00–08:00 不许按 UTC 算成前天；
 *      跨月 / 跨年 / 闰年边界正确；不依赖设备时区（源码不许用 getDate/getDay/toISOString 这类本地或 UTC 取日）；
 *   ② 契约不动：单日只用云函数既有的 startDate + endDate，入参不多一个键；云函数的显式区间分支仍在；
 *   ③ 界面接线：「昨日」按钮、选日 picker、前一日/后一日、单日对比卡都接到 managerPageConfig 的真实方法；
 *   ④ 对比诚实：基准为 0 不算百分比、取不到的写「无数据」而不是 0；分时段无数据源就明说，不编。
 * 另：ERP 行为看板的「昨日」按北京时间取 dateKey。
 *
 * 用法：
 *   node miniprogram/scripts/test-report-day.mjs
 *   node miniprogram/scripts/test-report-day.mjs --selftest   （注入只写临时副本，真源码只读）
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const rootIdx = argv.indexOf('--root')
const ROOT = rootIdx >= 0 ? resolve(argv[rootIdx + 1]) : resolve(HERE, '../..')

/** 自检副本需要的文件（相对仓库根） */
const FILES = [
  'miniprogram/subpackages/manager/utils/reportDay.js',
  'miniprogram/subpackages/manager/manager/managerPageConfig.js',
  'miniprogram/subpackages/manager/manager/workspace/_subviews.wxml',
  'miniprogram/cloudfunctions/getAnalyticsDashboard/index.js',
  'admin/src/components/BehaviorAnalytics.vue',
  'miniprogram/subpackages/manager/manager/index.wxss'
]

if (argv.includes('--selftest')) selftest()

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
let passed = 0
const failures = []
function t(name, fn) {
  let ok = false
  let err = ''
  try { ok = fn() === true } catch (e) { err = e.message }
  if (ok) passed += 1
  else failures.push(err ? `${name}（${err}）` : name)
}

function loadCjs(absPath) {
  const mod = { exports: {} }
  const req = (id) => {
    const dir = dirname(absPath)
    for (const c of [resolve(dir, id), `${resolve(dir, id)}.js`]) {
      if (existsSync(c) && statSync(c).isFile()) return loadCjs(c)
    }
    throw new Error('require 解析失败：' + id)
  }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', readFileSync(absPath, 'utf8'))(mod, mod.exports, req)
  return mod.exports
}

const RD_REL = 'miniprogram/subpackages/manager/utils/reportDay.js'
const rd = loadCjs(join(ROOT, RD_REL))
const bj = (iso) => Date.parse(`${iso}+08:00`)

/* ① 营业日口径 */
t('营业日：北京时间凌晨 00:30 的昨日仍是前一个自然日（不按 UTC 算成前天）', () =>
  rd.yesterdayKey(bj('2026-09-28T00:30:00')) === '2026-09-27')
t('营业日：北京时间 07:59（UTC 仍是前一天）昨日 = 09-27', () =>
  rd.yesterdayKey(bj('2026-09-28T07:59:59')) === '2026-09-27')
t('营业日：北京时间 23:59 昨日 = 09-27', () => rd.yesterdayKey(bj('2026-09-28T23:59:59')) === '2026-09-27')
t('营业日：跨月（10-01 00:10 → 09-30）', () => rd.yesterdayKey(bj('2026-10-01T00:10:00')) === '2026-09-30')
t('营业日：跨年（2027-01-01 00:05 → 2026-12-31）', () => rd.yesterdayKey(bj('2027-01-01T00:05:00')) === '2026-12-31')
t('营业日：闰年（2028-03-01 → 2028-02-29）', () => rd.yesterdayKey(bj('2028-03-01T09:00:00')) === '2028-02-29')
t('营业日：今日在 UTC+8 00:00 切换', () =>
  rd.todayKey(bj('2026-09-28T00:00:00')) === '2026-09-28' && rd.todayKey(bj('2026-09-27T23:59:59')) === '2026-09-27')
t('营业日：起止 = 北京时间 00:00:00.000 ～ 23:59:59.999', () => {
  const b = rd.dayBounds('2026-09-27')
  return b.startTs === Date.parse('2026-09-26T16:00:00.000Z') && b.endTs === Date.parse('2026-09-27T15:59:59.999Z')
})
t('营业日：前一日 / 上周同日跨月跨年', () =>
  rd.addDays('2026-10-01', -1) === '2026-09-30' && rd.addDays('2027-01-03', -7) === '2026-12-27')
t('营业日：源码不依赖设备时区（禁用 getDate/getDay/getMonth/getFullYear/getHours/toISOString）', () => {
  const src = read(RD_REL).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  return !/\.(getDate|getDay|getMonth|getFullYear|getHours|toISOString)\(/.test(src)
})
t('日期标题：「9月27日 周日」；跨年带年份', () =>
  rd.formatDayLabel('2026-09-27', bj('2026-09-28T10:00:00')) === '9月27日 周日' &&
  rd.formatDayLabel('2025-12-31', bj('2026-01-01T10:00:00')) === '2025年12月31日 周三')

/* ② 契约不动 */
t('入参只有既有的 action / startDate / endDate', () => {
  const p = rd.buildDayPayload('2026-09-27')
  return JSON.stringify(Object.keys(p).sort()) === '["action","endDate","startDate"]' &&
    p.action === 'report' && p.startDate === '2026-09-27' && p.endDate === '2026-09-27'
})
t('云函数仍有显式营业日区间分支（startDate + endDate 优先、东八区换算）', () => {
  const src = read('miniprogram/cloudfunctions/getAnalyticsDashboard/index.js')
  return src.includes('if (startDate && endDate && startDate <= endDate)') &&
    /function bizDateStartMs[\s\S]{0,200}- TZ_SHANGHAI/.test(src)
})
t('对比窗口 = 上周同日～当日（8 天）', () => {
  const w = rd.buildCompareWindow('2026-09-27')
  return w.startDate === '2026-09-20' && w.endDate === '2026-09-27'
})

/* ③ 界面接线 */
const cfg = read('miniprogram/subpackages/manager/manager/managerPageConfig.js')
const wxml = read('miniprogram/subpackages/manager/manager/workspace/_subviews.wxml')
t('接线：单日视图走 reportDay.buildDayPayload', () =>
  /_buildAnalyticsRangePayload\(\) \{\s*if \(this\.data\.analyticsRangeType === 'day' && this\.data\.analyticsDayKey\) \{\s*return reportDay\.buildDayPayload/.test(cfg))
t('接线：「昨日」按钮绑定 setAnalyticsYesterday 且方法存在', () =>
  /bindtap="setAnalyticsYesterday">昨日</.test(wxml) && /\n  setAnalyticsYesterday\(\) \{/.test(cfg))
t('接线：选日 picker / 前一日 / 后一日', () =>
  /bindchange="onAnalyticsDayPick"/.test(wxml) && /bindtap="shiftAnalyticsDay" data-delta="-1"/.test(wxml) &&
  /bindtap="shiftAnalyticsDay" data-delta="1"/.test(wxml) && /\n  onAnalyticsDayPick\(e\) \{/.test(cfg) &&
  /\n  shiftAnalyticsDay\(e\) \{/.test(cfg))
t('接线：单日对比只调既有 action（orders / users）+ startDate/endDate', () => {
  const m = cfg.match(/\n  async loadAnalyticsDayCompare\(dayKey\) \{[\s\S]*?\n  \},\n/)
  if (!m) throw new Error('找不到 loadAnalyticsDayCompare')
  const body = m[0]
  return /data: \{ action, startDate: win\.startDate, endDate: win\.endDate \}/.test(body) &&
    /call\('orders'\)/.test(body) && /call\('users'\)/.test(body) && !/call\('report'\)/.test(body)
})
t('接线：对比结果回来时校验仍是同一天（快速切日不串数）', () =>
  /this\.data\.analyticsDayKey !== dayKey\) return/.test(cfg))
t('接线：主数据加载完成后触发单日对比', () =>
  /if \(isDayView\) this\.loadAnalyticsDayCompare\(this\.data\.analyticsDayKey\)/.test(cfg))
t('展示：单日视图隐藏逐日柱图（单根柱无意义），显示单日对比卡', () =>
  /wx:if="\{\{analyticsRangeType!=='day'\}\}">\s*<view class="card-top"><text class="no">订单数 \/ 日/.test(wxml) &&
  /wx:for="\{\{analyticsDayCompare\.rows\}\}"/.test(wxml))
t('展示：标题标明日期（综合营收 / 当日合计带日期）', () =>
  /综合营收\{\{analyticsRangeType==='day'\?' · ' \+ analyticsDayLabel:''\}\}/.test(wxml) &&
  /'当日合计 · ' \+ analyticsDayLabel/.test(wxml))

/* ③-b 统计周期区排版（2026-09-28 真机反馈：孤行 / 双高亮 / 日期说三遍 / 「· 13」看不懂） */
const wxss = read('miniprogram/subpackages/manager/manager/index.wxss')
const cssRule = (sel) => {
  const all = [...wxss.matchAll(new RegExp('(^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}', 'g'))]
  return all.length ? all[all.length - 1][2] : ''
}
t('排版：五个范围项在同一个分段控件里、一行等分不换行', () => {
  const m = wxml.match(/<view class="report-seg">([\s\S]*?)\n        <\/view>/)
  if (!m) throw new Error('找不到 report-seg')
  const items = m[1].match(/class="report-seg-item /g) || []
  const seg = cssRule('.report-seg'), item = cssRule('.report-seg-item')
  return items.length === 5 && /display: flex/.test(seg) && !/flex-wrap: wrap/.test(seg) &&
    /flex: 1/.test(item) && /white-space: nowrap/.test(item)
})
t('排版：次级导航无实心底（只有分段选中项用实心金）', () => {
  const sub = ['.report-subnav', '.report-subnav-arrow', '.report-subnav-label'].map(cssRule).join('')
  return sub && !/background/.test(sub) && !/report-subnav[\s\S]{0,200}btn ship active/.test(wxml)
})
t('排版：单日模式下日期只在次级导航说一遍（头部不再重复 rangeLabel）', () =>
  !/<text class="status gold" wx:if="\{\{analyticsReport\.rangeLabel\}\}">/.test(wxml) &&
  !/北京时间 \{\{analyticsDayKey\}\} 00:00/.test(wxml))
t('排版：口径说明的数字写成「N 条」，不留裸「· N」', () =>
  /'口径说明（' \+ analyticsReport\.notes\.length \+ ' 条）'/.test(wxml) &&
  !/口径说明'\}\} · \{\{analyticsReport\.notes\.length\}\}/.test(wxml))

/* ④ 对比诚实 */
t('对比：基准 0 不算百分比', () => {
  const r = rd.compareTo(5, 0, true)
  return r.text === '前值为 0' && r.tone === 'up'
})
t('对比：涨跌百分比一位小数', () =>
  rd.compareTo(150, 100, true).text === '↑ 50%' && rd.compareTo(2, 3, true).text === '↓ 33.3%' &&
  rd.compareTo(7, 7, true).text === '持平')
t('对比：取不到的写「无数据」不编 0', () => {
  const cmp = rd.buildDayCompare('2026-09-27', {
    ordersDaily: [
      { dateKey: '2026-09-27', grandDay: 300, netOnline: 200, offlineLedger: 100, paid: 3, orders: 4 },
      { dateKey: '2026-09-26', grandDay: 150, netOnline: 100, offlineLedger: 50, paid: 0, orders: 2 }
    ],
    newUsersByDay: [],
    dauByDay: []
  }, (n) => Number(n).toFixed(2))
  const byKey = Object.fromEntries(cmp.rows.map((r) => [r.key, r]))
  return byKey.grandDay.valueText === '¥300.00' && byKey.grandDay.prev.text === '↑ 100%' &&
    byKey.grandDay.week.text === '无数据' && byKey.paid.prev.text === '前值为 0' &&
    byKey.dau.valueText === '—' && byKey.dau.prev.text === '无数据' && cmp.prevLabel === '9月26日 周六'
})
t('对比：近 8 日走势只取窗口内、按日期升序、当日高亮', () => {
  const s = rd.buildWindowSeries('2026-09-27', [
    { dateKey: '2026-09-27', netOnline: 1, offlineLedger: 2 },
    { dateKey: '2026-09-19', netOnline: 9 },
    { dateKey: '2026-09-20', netOnline: 3 }
  ])
  return s.length === 2 && s[0].dateKey === '2026-09-20' && s[1].isFocus && s[1].day === '当日' && s[1].total === 3
})
t('诚实：分时段分布无数据源时明说未展示', () => /分时段分布暂无数据源/.test(wxml))

/* ERP 行为看板 */
t('ERP：行为看板「昨日」按北京时间取 dateKey', () => {
  const vue = read('admin/src/components/BehaviorAnalytics.vue')
  return /<el-radio-button label="yesterday">昨日<\/el-radio-button>/.test(vue) &&
    /Date\.now\(\) \+ 8 \* 3600 \* 1000/.test(vue) &&
    /rangePreset\.value === 'yesterday'\) return \[bjDateKeyAt\(-1\), bjDateKeyAt\(-1\)\]/.test(vue)
})

console.log(`test-report-day：${passed} 通过 / ${failures.length} 失败`)
if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`))
  process.exit(1)
}
console.log('✓ 数据报表单日视图：北京时间营业日 / 契约不动 / 接线齐全 / 对比诚实')

/* ── 自检：每条注入都必须让对应断言红 ───────────────────────────────── */
function selftest() {
  const REAL = resolve(HERE, '../..')
  const RD = 'miniprogram/subpackages/manager/utils/reportDay.js'
  const CFG = 'miniprogram/subpackages/manager/manager/managerPageConfig.js'
  const WX = 'miniprogram/subpackages/manager/manager/workspace/_subviews.wxml'
  const INJECTS = [
    { name: '昨日按 UTC 取日', file: RD, from: 'const s = new Date(t + TZ_SHANGHAI)', to: 'const s = new Date(t)', expect: '凌晨' },
    { name: '改用设备本地时区取日', file: RD, from: 'return WEEKDAYS[new Date(keyToUtcNoon(key)).getUTCDay()]', to: 'return WEEKDAYS[new Date(keyToUtcNoon(key)).getDay()]', expect: '设备时区' },
    { name: '起止少算 1 毫秒以外的一整段', file: RD, from: 'return { startTs, endTs: startTs + MS_DAY - 1 }', to: 'return { startTs, endTs: startTs + MS_DAY - 1 - TZ_SHANGHAI }', expect: '起止' },
    { name: '入参偷加新键', file: RD, from: "return { action: 'report', startDate: key, endDate: key }", to: "return { action: 'report', rangeType: 'yesterday', startDate: key, endDate: key }", expect: '入参只有' },
    { name: '云函数显式区间分支被改', file: 'miniprogram/cloudfunctions/getAnalyticsDashboard/index.js', from: 'if (startDate && endDate && startDate <= endDate)', to: 'if (false && startDate && endDate)', expect: '显式营业日区间' },
    { name: '单日视图没走单日入参', file: CFG, from: 'return reportDay.buildDayPayload(this.data.analyticsDayKey)', to: 'return { action: \'report\', rangeType: \'days\', days: 1 }', expect: 'buildDayPayload' },
    { name: '昨日按钮丢了绑定', file: WX, from: 'bindtap="setAnalyticsYesterday">昨日<', to: '>昨日<', expect: '昨日」按钮' },
    { name: '选日 picker 丢了绑定', file: WX, from: 'bindchange="onAnalyticsDayPick"', to: '', expect: '选日 picker' },
    { name: '对比改调整份 report', file: CFG, from: "call('users')]", to: "call('report')]", expect: '既有 action' },
    { name: '快速切日串数', file: CFG, from: "this.data.analyticsDayKey !== dayKey) return", to: "false) return", expect: '同一天' },
    { name: '单日视图仍画逐日柱', file: WX, from: '<view class="card" wx:if="{{analyticsRangeType!==\'day\'}}">\n          <view class="card-top"><text class="no">订单数 / 日', to: '<view class="card">\n          <view class="card-top"><text class="no">订单数 / 日', expect: '逐日柱图' },
    { name: '基准 0 算出百分比', file: RD, from: "if (b === 0) return { text: '前值为 0', tone: c > 0 ? 'up' : 'down' }", to: '', expect: '基准 0' },
    { name: '取不到的编成 0', file: RD, from: "if (!hasBase) return { text: '无数据', tone: 'none' }", to: '', expect: '无数据' },
    { name: '标题丢了日期', file: WX, from: "综合营收{{analyticsRangeType==='day'?' · ' + analyticsDayLabel:''}}", to: '综合营收', expect: '标题标明日期' },
    { name: '分段控件允许换行（自然月掉孤行）', file: 'miniprogram/subpackages/manager/manager/index.wxss', from: '.report-seg {\n  display: flex;\n', to: '.report-seg {\n  display: flex;\n  flex-wrap: wrap;\n', expect: '一行等分' },
    { name: '次级导航日期又做成实心金', file: 'miniprogram/subpackages/manager/manager/index.wxss', from: '.report-subnav-label {\n  display: block;\n', to: '.report-subnav-label {\n  display: block;\n  background: #C4A76C;\n', expect: '实心底' },
    { name: '口径说明回到裸数字', file: WX, from: "'口径说明（' + analyticsReport.notes.length + ' 条）'", to: "'查看口径说明'}} · {{analyticsReport.notes.length", expect: 'N 条' },
    { name: 'ERP 昨日按 UTC', file: 'admin/src/components/BehaviorAnalytics.vue', from: 'new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 86400000)', to: 'new Date(Date.now() + offsetDays * 86400000)', expect: 'ERP' }
  ]
  let ok = true
  const snapshot = new Map(FILES.map((f) => [f, readFileSync(join(REAL, f), 'utf8')]))
  for (const inj of INJECTS) {
    const dir = mkdtempSync(join(tmpdir(), 'report-day-selftest-'))
    try {
      for (const f of FILES) {
        mkdirSync(dirname(join(dir, f)), { recursive: true })
        cpSync(join(REAL, f), join(dir, f))
      }
      const target = join(dir, inj.file)
      let src = readFileSync(target, 'utf8')
      if (!src.includes(inj.from)) throw new Error(`锚点失效：${inj.from.slice(0, 60)}`)
      src = src.split(inj.from).join(inj.to)
      writeFileSync(target, src)
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--root', dir], { encoding: 'utf8' })
      const out = `${r.stdout}\n${r.stderr}`
      if (r.status !== 0 && out.includes(inj.expect)) console.log(`  ✓ 注入「${inj.name}」被检出`)
      else {
        ok = false
        console.error(`  ✗ 注入「${inj.name}」未被检出（期望命中「${inj.expect}」）\n${out}`)
      }
    } catch (e) {
      ok = false
      console.error(`  ✗ 注入「${inj.name}」无法施加：${e.message}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  for (const [f, s] of snapshot) {
    if (readFileSync(join(REAL, f), 'utf8') !== s) {
      console.error(`✗ 自检改动了真源码：${f}`)
      process.exit(1)
    }
  }
  if (!ok) process.exit(1)
  console.log(`✓ selftest 通过：${INJECTS.length} 个注入全部被检出；真源码未被改动`)
  process.exit(0)
}
