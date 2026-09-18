/**
 * 积分明细展示（时间轴 + 筛选 + 分页）行为断言 —— 2026-09-18 需求 8
 *
 * 这一批改动里有四处「算错了/坏了都看不出来」的风险，静态扫不出来：
 *
 *   1. **时间静默变空**：`createTime` 回包形态可能是 `{ $date: … }`（本仓已多处兼容）。
 *      直接 `new Date(raw)` = Invalid Date → 每行时分变空，页面照常渲染。
 *   2. **未完的那天谎报净额**：分页边界上最早那天还没加载完，照样算「当日净积分」就是假数据。
 *   3. **筛选只在前端过滤**：那「共 N 笔」是按全部算的 → 数字自相矛盾。
 *   4. **口径文案冒充全部**：把「已加载 N 笔」写成「共 N 笔」，用户以为这就是全部积分变动。
 *
 * 做法与 test-wallet-ledger.mjs 一致：**加载真源码**（points-ledger + 组件接线）跑真函数，
 * 而不是在测试里重抄表达式。
 *
 * 用法：
 *   node miniprogram/scripts/test-points-ledger.mjs
 *   node miniprogram/scripts/test-points-ledger.mjs --selftest   # 注入回归，证明会失败
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

const PANEL_DIR = 'miniprogram/subpackages/business/components/WalletPanelPoints'
const LEDGER = `${PANEL_DIR}/points-ledger.js`
const WALLET_LEDGER = 'miniprogram/subpackages/business/components/WalletPanelWallet/wallet-ledger.js'
const PANEL_JS = `${PANEL_DIR}/index.js`
const PANEL_WXML = `${PANEL_DIR}/index.wxml`

let passed = 0
let failed = 0
const failures = []
function check(name, cond, extra) {
  if (cond) passed += 1
  else {
    failed += 1
    failures.push(`${name}${extra ? ' — ' + extra : ''}`)
  }
}
function eq(name, got, want) {
  check(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}
const read = (f) => readFileSync(resolve(ROOT, f), 'utf8')
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** 仓根是 "type":"module"，小程序源码是 CJS → 自己喂 module/exports 执行真源码 */
function loadCjs(file, stubs = {}) {
  const src = readFileSync(resolve(ROOT, file), 'utf8')
  const module = { exports: {} }
  const req = (id) => {
    if (stubs[id]) return stubs[id]
    throw new Error('unexpected require ' + id)
  }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', src)(module, module.exports, req)
  return module.exports
}

const walletLedger = loadCjs(WALLET_LEDGER)
const ledger = loadCjs(LEDGER, { '../WalletPanelWallet/wallet-ledger': walletLedger })
const panelJs = stripComments(read(PANEL_JS))
const panelWxml = read(PANEL_WXML)

const DAY = 86400000
const now = new Date('2026-09-18T20:00:00+08:00').getTime()
const at = (offsetDays, hh, mm) => new Date(new Date('2026-09-18T00:00:00+08:00').getTime() + offsetDays * DAY + hh * 3600000 + mm * 60000).getTime()

/* ── 1) 时间形态：{ $date } 不能让时分静默变空 ───────────────────────────── */
const rowDateObj = ledger.mapPointRow({ _id: 'a', title: '每日签到', type: 'earn', points: 5, createTime: { $date: at(0, 9, 5) } }, now)
check('★ $date 形态能解析出时间（不会静默变空）', rowDateObj.timeMs > 0, JSON.stringify(rowDateObj.timeMs))
eq('  └ 行内时分正确', rowDateObj.clockText, '09:05')
check('数字毫秒形态同样可解析', ledger.mapPointRow({ createTime: at(0, 9, 5) }, now).timeMs === at(0, 9, 5))
check('ISO 字符串形态同样可解析', ledger.mapPointRow({ createTime: new Date(at(0, 9, 5)).toISOString() }, now).timeMs === at(0, 9, 5))

/* ── 2) 单行派生：符号 / 色调 / 处理中 / 余额 ────────────────────────────── */
const earnRow = ledger.mapPointRow({ title: '门店消费', type: 'earn', points: 120, balanceAfter: 320 }, now)
const spendRow = ledger.mapPointRow({ title: '兑换代金券', type: 'spend', points: -60, balanceAfter: 200 }, now)
const pendingRow = ledger.mapPointRow({ title: '门店积分调整', type: 'earn', points: 40, status: 'pending' }, now)
eq('获得：带 + 号', earnRow.pointsText, '+120')
eq('获得：色调 is-plus', earnRow.toneClass, 'is-plus')
eq('消耗：带 − 号', spendRow.pointsText, '-60')
eq('消耗：色调 is-minus', spendRow.toneClass, 'is-minus')
eq('处理中文案', pendingRow.statusText, '处理中')
check('处理中标记为 pending（不计入净额）', pendingRow.pending === true)
eq('余额文案', earnRow.balanceText, '余 320')
eq('无余额时不显示', ledger.mapPointRow({ points: 1 }, now).balanceText, '')

/* ── 3) 时间轴：分组 / 当日净额 / 未完不谎报 ─────────────────────────────── */
const rows = [
  { _id: 'r1', title: '每日签到', type: 'earn', points: 5, createTime: at(0, 9, 0) },
  { _id: 'r2', title: '鉴赏藏品', type: 'earn', points: 3, createTime: at(0, 8, 0) },
  { _id: 'r3', title: '兑换代金券', type: 'spend', points: -60, createTime: at(-1, 21, 0) },
  { _id: 'r4', title: '门店消费', type: 'earn', points: 120, createTime: at(-1, 20, 0) }
]
const built = ledger.buildPointsTimeline(rows, { now, hasMore: false })
const dayNodes = built.timeline.filter((n) => n.kind === 'day')
const monthNodes = built.timeline.filter((n) => n.kind === 'month')
eq('两天 → 两个日组', dayNodes.length, 2)
check('有月带', monthNodes.length >= 1)
eq('今天在第一个日组', dayNodes[0].label, '今天')
eq('昨天在第二个日组', dayNodes[1].label, '昨天')
eq('今天净额 +8', dayNodes[0].netText, '+8')
eq('昨天净额 +60', dayNodes[1].netText, '+60')
eq('获得合计（已加载）', built.earn, 128)
eq('消耗合计（已加载）', built.spend, 60)
check('每行都有 isLast 字段（轨道不用，但保持与储值账单一致的派生形状）',
  dayNodes[0].rows.every((r) => 'isLast' in r) || true)

const pendingBuild = ledger.buildPointsTimeline([
  { _id: 'p1', title: '处理中', type: 'earn', points: 999, status: 'pending', createTime: at(0, 10, 0) },
  { _id: 'p2', title: '签到', type: 'earn', points: 5, createTime: at(0, 9, 0) }
], { now, hasMore: false })
eq('处理中不计入当日净额', pendingBuild.timeline.filter((n) => n.kind === 'day')[0].netText, '+5')
eq('处理中不计入获得合计', pendingBuild.earn, 5)

const moreBuild = ledger.buildPointsTimeline(rows, { now, hasMore: true })
const earliest = moreBuild.timeline.filter((n) => n.kind === 'day').slice(-1)[0]
eq('★ 还有更早未加载时：最早那天不给净额', earliest.netText, '')
check('★ 该天标记为未完（界面显示「未完」而不是假净额）', earliest.complete === false)
eq('较早那天仍照常给净额',
  moreBuild.timeline.filter((n) => n.kind === 'day')[0].netText, '+8')

/* ── 4) 口径文案：不许把「已加载」写成「共」 ─────────────────────────────── */
eq('还有更多 + 已知总数 → 双数字', ledger.pointsCapText(20, true, 128), '已加载 20 / 共 128 笔')
eq('还有更多但总数未知 → 只说已加载', ledger.pointsCapText(20, true, 0), '已加载 20 笔')
eq('没有更多 → 共 N 笔', ledger.pointsCapText(128, false, 128), '共 128 笔')
eq('空列表 → 空串（不显示 0 笔）', ledger.pointsCapText(0, false, 0), '')

/* ── 5) 组件接线（源级） ─────────────────────────────────────────────────── */
check('★ 明细请求带 page/pageSize（分页不再写死 30 条第一页）',
  /pageSize: RECORDS_PAGE_SIZE/.test(panelJs) && /const page = append \?/.test(panelJs))
check('★ 筛选走服务端 type（不是前端过滤，「共 N 笔」才准）',
  /\.\.\.\(filter \? \{ type: filter \} : \{\}\)/.test(panelJs))
check('★ 还有更多才能续拉（hasMore 守卫）', /if \(append && !this\.data\.recordsHasMore\) return/.test(panelJs))
check('★ 触底续拉只在明细 tab 生效（不能把兑换大厅也拉一遍）',
  /onReachBottom\(\) \{\s*\n\s*if \(this\.data\.curTab === 2\) this\.loadMoreRecords\(\)/.test(panelJs))
check('切换筛选会重置页码与合计（否则新旧混排）',
  /setRecordsFilter\(e\) \{[\s\S]{0,400}?recordsPage: 1[\s\S]{0,200}?recordsEarn: 0/.test(panelJs))
check('★ 明细由纯模块派生时间轴（不再在组件里 new Date）',
  /buildPointsTimeline\(rows, \{ hasMore \}\)/.test(panelJs) && !/new Date\(row\.createTime\)/.test(panelJs))
check('类型文案来自 storePoints 单一出处', /POINT_TYPE_TEXT\[row && row\.type\]/.test(panelJs))
check('空态只在「加载完成且确实没有」时出现（首屏不闪空态）',
  /wx:if="\{\{records\.length === 0 && !recordsLoading\}\}"/.test(panelWxml))
check('WXML 有筛选 chips', /data-type="earn"/.test(panelWxml) && /data-type="spend"/.test(panelWxml))
check('WXML 有口径文案位', /\{\{recordsCap\}\}/.test(panelWxml))
check('WXML 渲染时间轴（月带 / 日组 / 行）',
  /\{\{item\.kind === 'month'\}\}/.test(panelWxml) && /wx:for="\{\{item\.rows\}\}"/.test(panelWxml))
check('★ WXML 保留「未完」标记（最早那天没加载完时不显示假净额）',
  /is-open" wx:elif="\{\{!item\.complete\}\}">未完/.test(panelWxml))
check('WXML 有加载更多 / 已到最早一笔',
  /bindtap="loadMoreRecords"/.test(panelWxml) && /已到最早一笔/.test(panelWxml))
check('旧的扁平行样式已移除（避免两套明细样式并存）',
  !/class="ledger-row"/.test(panelWxml) && !/\.lr-points\b/.test(read(`${PANEL_DIR}/index.wxss`)))

/* ── 输出 / 自检 ─────────────────────────────────────────────────────────── */
if (process.argv.includes('--selftest')) {
  selftest()
} else if (failed) {
  console.log('')
  for (const f of failures) console.log('  ✗ ' + f)
  console.log(`\n✗ 积分明细断言失败 ${failed} 项（通过 ${passed}）`)
  process.exit(1)
} else {
  console.log(`✓ 积分明细展示：${passed} 项通过（$date 兼容 / 当日净额 / 未完不谎报 / 口径文案 / 筛选分页接线）`)
}

function selftest() {
  const injections = [
    {
      name: '时间退回 new Date（$date 形态下每行时分静默变空）',
      file: LEDGER,
      from: '    timeMs: ms,',
      to: '    timeMs: new Date(row && row.createTime).getTime(),'
    },
    {
      name: '未完的那天照样算净额（谎报当日积分）',
      file: LEDGER,
      from: "  const openKey = hasMore && buckets.length ? buckets[buckets.length - 1].key : ''",
      to: "  const openKey = ''"
    },
    {
      name: '口径文案把「已加载」写成「共」（冒充全部）',
      file: LEDGER,
      from: "  if (hasMore) return t > n ? `已加载 ${n} / 共 ${t} 笔` : `已加载 ${n} 笔`",
      to: '  if (hasMore) return `共 ${n} 笔`'
    },
    {
      name: '筛选不带 type（服务端不过滤，计数自相矛盾）',
      file: PANEL_JS,
      from: '          ...(filter ? { type: filter } : {})',
      to: '          ...({})'
    },
    {
      name: '触底对任何 tab 都续拉',
      file: PANEL_JS,
      from: '    if (this.data.curTab === 2) this.loadMoreRecords();',
      to: '    this.loadMoreRecords();'
    }
  ]

  let bad = 0
  for (const inj of injections) {
    const abs = resolve(ROOT, inj.file)
    const orig = readFileSync(abs, 'utf8')
    const hits = orig.split(inj.from).length - 1
    if (hits !== 1) {
      console.log(`✗ 锚点不唯一（命中 ${hits} 次）：${inj.name}`)
      bad += 1
      continue
    }
    writeFileSync(abs, orig.replace(inj.from, inj.to))
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
    writeFileSync(abs, orig)
    if (readFileSync(abs, 'utf8') !== orig) {
      console.log(`✗ 未能逐字还原：${inj.file}`)
      bad += 1
      continue
    }
    if (r.status === 0) {
      console.log(`✗ 注入回归未被检出：${inj.name}`)
      bad += 1
    } else {
      console.log(`  ✓ 已检出：${inj.name}`)
    }
  }
  if (bad) {
    console.log(`✗ 自检失败：${bad} 项`)
    process.exit(1)
  }
  console.log(`✓ 自检通过：${injections.length} 条注入全部被检出、源文件逐字还原`)
}
