#!/usr/bin/env node
/**
 * 超管工作台「活动课程」看板守卫（manager 域；2026-09-28 产品负责人点名「进一步优化提升超管工作台-活动页面」）
 * 设计说明：miniprogram/docs/超管工作台_活动课程_升级_2026-09-28.md
 *
 * 钉住五件容易静默失效的事：
 *   ① 分组口径：日期过了就是「已结束」，不看 status；今天按北京时间（源码不许用设备时区 / UTC 取日）；
 *   ② 诚实：报名 / 核销读不到就是「—」，不编 0；过期仍 open 的活动要被点名（stale）；
 *   ③ 契约不动：只用 manageStoreContent 既有 upsert / update / remove；status 只写 open / closed；
 *      编辑不回写 status（旧版每次保存都把已截止改回报名中）；新建写 storeId（C 端预约页按它取数）；
 *   ④ 反馈可见：工作台子页没有 hubTip 宿主，活动区不许用 showHubTip，也不许新增原生弹窗；
 *   ⑤ 三态与版式：加载 / 失败 / 空态都有；编辑面板的滚动区是定高的 .modal-body scroll-view；样式真的被 import。
 *
 * 用法：
 *   node miniprogram/scripts/test-activity-board.mjs
 *   node miniprogram/scripts/test-activity-board.mjs --selftest   （注入只写临时副本，真源码只读）
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

const AB_REL = 'miniprogram/subpackages/manager/utils/activityBoard.js'
const CFG_REL = 'miniprogram/subpackages/manager/manager/managerPageConfig.js'
const WX_REL = 'miniprogram/subpackages/manager/manager/workspace/_subviews.wxml'
const WS_REL = 'miniprogram/subpackages/manager/manager/workspace/index.wxss'
const FILES = [
  AB_REL,
  'miniprogram/utils/storeDefaults.js',
  'miniprogram/config/storeMediaCdn.js',
  'miniprogram/config/cdn.js',
  'miniprogram/config/cloudEnv.js',
  CFG_REL,
  WX_REL,
  WS_REL,
  'miniprogram/subpackages/manager/manager/workspace/activityBoard.wxss'
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
    for (const c of [resolve(dirname(absPath), id), `${resolve(dirname(absPath), id)}.js`]) {
      if (existsSync(c) && statSync(c).isFile()) return loadCjs(c)
    }
    throw new Error('require 解析失败：' + id)
  }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', readFileSync(absPath, 'utf8'))(mod, mod.exports, req)
  return mod.exports
}

const ab = loadCjs(join(ROOT, AB_REL))
const bj = (iso) => Date.parse(`${iso}+08:00`)
const NOW = bj('2026-09-28T21:40:00')
const LIST = [
  { _id: 'past-open', title: '海洋标本制作体验课', type: 'course', date: '2026-01-23', status: 'open', maxPeople: 20, remain: 20 },
  { _id: 'past-full', title: '讲座', date: '2023-12-30', status: 'full', maxPeople: 50 },
  { _id: 'today', title: '秋夜博物馆', type: 'special_activity', date: '2026-09-28', status: 'open', maxPeople: 30, storeId: 'store_shanhaizaowu' },
  { _id: 'later', title: '蝴蝶课', type: 'course', date: '2026-10-12', status: 'open', maxPeople: 8, storeId: 'store_xingchen' },
  { _id: 'closed', title: '闭馆课', type: 'course', date: '2026-10-01', status: 'closed', maxPeople: 8 }
]

/* ① 分组口径 */
t('今天：北京时间 00:30 仍是当天（不按 UTC 算成前一天）', () =>
  ab.todayKey(bj('2026-09-28T00:30:00')) === '2026-09-28' && ab.todayKey(bj('2026-09-27T23:59:59')) === '2026-09-27')
t('今天：源码不依赖设备时区（禁用 getDate/getDay/getMonth/getFullYear/toISOString）', () => {
  const src = read(AB_REL).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  return !/\.(getDate|getDay|getMonth|getFullYear|getHours|toISOString)\(/.test(src)
})
t('分组：过期即已结束（哪怕 status=open）；今天仍算报名中；未到期的 closed/full 算已截止', () => {
  const today = ab.todayKey(NOW)
  return ab.phaseOf(LIST[0], today) === 'ended' && ab.phaseOf(LIST[2], today) === 'live' &&
    ab.phaseOf(LIST[4], today) === 'paused' && ab.phaseOf({ date: '2026-10-02', status: 'full' }, today) === 'paused'
})
t('看板：各组计数 + 过期仍展示数（stale）', () => {
  const b = ab.buildBoard(LIST, { now: NOW, filter: 'all' })
  return b.counts.live === 2 && b.counts.paused === 1 && b.counts.ended === 2 && b.counts.all === 5 && b.stale === 1
})
t('看板：报名中按日期近→远；已结束按远→近倒序且排在最后', () => {
  const ids = ab.buildBoard(LIST, { now: NOW, filter: 'all' }).items.map((x) => x._id)
  return ids.join(',') === 'today,closed,later,past-open,past-full'
})
t('看板：未知筛选键回落到报名中', () => ab.buildBoard(LIST, { now: NOW, filter: 'xx' }).filter === 'live')

/* ② 诚实 */
t('诚实：报名数读不到时 statKnown=false、余位显示「—」，不编 0', () => {
  const c = ab.buildBoard(LIST, { now: NOW, filter: 'live' }).items[0]
  return c.statKnown === false && c.remainText === '—' && c.fillPct === 0
})
t('诚实：有计数时 报名 x/名额、余位、进度条；满员写「已满」；名额 0 写「不限」', () => {
  const stats = { today: { booked: 26, verified: 4 }, later: { booked: 8, verified: 0 } }
  const items = ab.buildBoard(LIST, { now: NOW, stats, filter: 'live' }).items
  const a = items.find((x) => x._id === 'today')
  const b = items.find((x) => x._id === 'later')
  const u = ab.decorate({ _id: 'u', title: 'u', date: '2026-10-09', status: 'open', maxPeople: 0 }, '2026-09-28', { booked: 3, verified: 0 })
  return a.capText === '26/30' && a.remainText === '4' && a.fillPct === 87 && a.verified === 4 &&
    b.remainText === '已满' && u.remainText === '不限' && u.capText === '3'
})
t('诚实：过期仍 open 的卡片标 stillVisible 并给「下架」；未绑门店的未结束活动标 noStore', () => {
  const items = ab.buildBoard(LIST, { now: NOW, filter: 'all' }).items
  const p = items.find((x) => x._id === 'past-open')
  const f = items.find((x) => x._id === 'past-full')
  const c = items.find((x) => x._id === 'closed')
  return p.stillVisible && p.toggle.to === 'closed' && p.toggle.label === '下架' && !f.stillVisible && f.toggle === null &&
    c.noStore === true && c.toggle.to === 'open' && !p.noStore
})
t('展示：免费写「免费」；今天写「今天」；跨年带年份', () => {
  const d = ab.decorate({ _id: 'x', title: 'x', date: '2025-12-24', price: 0, status: 'open' }, '2026-09-28', null)
  const today = ab.buildBoard(LIST, { now: NOW, filter: 'live' }).items[0]
  return d.priceText === '免费' && d.year === '2025' && today.isToday && today.when === '今天'
})
t('统计范围：只统计未结束 + 结束 30 天内，最多 20 条', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ _id: `m${i}`, title: 't', date: '2026-10-05' }))
  const ids = ab.statTargets([...LIST, ...many], NOW).map((x) => x._id)
  return ids.length === 20 && !ids.includes('past-open') && !ids.includes('past-full') && ids.includes('today')
})

/* ③ 契约不动 */
t('新建：status=open、remain=名额、写 storeId、时间合成「14:00 - 16:00」', () => {
  const r = ab.buildPayload({ title: ' 课 ', date: '2026-10-03', timeStart: '14:00', timeEnd: '16:00', price: '200', maxPeople: '12', storeIndex: 1 }, { today: '2026-09-28' })
  const d = r.data
  return r.ok && d.status === 'open' && d.remain === 12 && d.storeId === ab.STORES[1].storeId && d.time === '14:00 - 16:00' &&
    d.title === '课' && d.price === 200 && d.type === 'course' &&
    JSON.stringify(Object.keys(d).sort()) === '["date","location","maxPeople","price","remain","status","storeId","time","title","type"]'
})
t('编辑：不回写 status；名额没变不碰 remain；名额变了按差值平移', () => {
  const same = ab.buildPayload({ title: 'a', date: '2026-10-03', maxPeople: '20' }, { original: { maxPeople: 20, remain: 17, status: 'closed' } }).data
  const up = ab.buildPayload({ title: 'a', date: '2026-10-03', maxPeople: '30' }, { original: { maxPeople: 20, remain: 17 } }).data
  const down = ab.buildPayload({ title: 'a', date: '2026-10-03', maxPeople: '2' }, { original: { maxPeople: 20, remain: 5 } }).data
  return !('status' in same) && !('remain' in same) && up.remain === 27 && down.remain === 0 && !('status' in up)
})
t('校验：缺标题 / 缺日期 / 新活动日期早于今天 / 价格负数 / 名额小数 —— 都落到具体字段', () => {
  const f = (form, opt) => ab.buildPayload(form, opt)
  return f({ date: '2026-10-03' }).field === 'title' && f({ title: 'a' }).field === 'date' &&
    f({ title: 'a', date: '2026-09-27' }, { today: '2026-09-28' }).field === 'date' &&
    f({ title: 'a', date: '2026-09-27' }, { today: '2026-09-28', original: {} }).ok === true &&
    f({ title: 'a', date: '2026-10-03', price: '-1' }).field === 'price' &&
    f({ title: 'a', date: '2026-10-03', maxPeople: '1.5' }).field === 'maxPeople'
})
t('表单：旧数据的「14:00 - 16:00」拆回两个时间；再办一场清空日期、保留其余', () => {
  const src = { title: 'x', type: 'special_activity', date: '2026-01-23', time: '14:00 - 16:00', price: 100, maxPeople: 30, storeId: 'store_xingchen', location: 'L' }
  const e = ab.formFromItem(src)
  const c = ab.formFromItem(src, { copy: true })
  return e.timeStart === '14:00' && e.timeEnd === '16:00' && e.date === '2026-01-23' && e.storeIndex === 1 &&
    c.date === '' && c.title === 'x' && c.type === 'special_activity' && c.price === '100' && c.location === 'L'
})

t('预约归属：activityId 优先；没有 activityId 的历史预约回退「标题 + 日期」', () => {
  const cmd = { or: (xs) => ({ $or: xs }), exists: (v) => ({ $exists: v }) }
  const m = ab.bookingMatch(cmd, { _id: 'A1', title: '蝴蝶课', date: '2026-10-12' })
  const [byId, legacy] = m.$or || []
  return byId && byId.activityId === 'A1' && Object.keys(byId).length === 1 &&
    legacy && legacy.activityId && legacy.activityId.$exists === false && legacy.title === '蝴蝶课' && legacy.date === '2026-10-12'
})

const cfg = read(CFG_REL)
const block = (() => {
  const a = cfg.indexOf('\n  async loadActivities() {')
  const b = cfg.indexOf('\n // 加载分类树', a)
  if (a < 0 || b < 0) throw new Error('找不到活动方法块')
  return cfg.slice(a, b)
})()
t('接线：写库只用 manageStoreContent 既有 upsert / update / remove，集合只有 activities', () => {
  const calls = block.match(/action: '[a-zA-Z]+', collection: '[a-z_]+'/g) || []
  return calls.length >= 4 && calls.every((c) => /action: '(upsert|update|remove)', collection: 'activities'/.test(c))
})
t('接线：状态切换只写 { status: to }，一键下架只写 closed', () =>
  /data: \{ status: to \}/.test(block) && /data: \{ status: 'closed' \}/.test(block) && !/status: '(draft|ended|archived)'/.test(block))
t('接线：保存走 buildPayload，校验失败落到 actFormErr', () =>
  /AB\.buildPayload\(this\.data\.tempActivity/.test(block) && /actFormErr: \{ field: built\.field, msg: built\.msg \}/.test(block))
t('接线：读活动分页（客户端单页 ≤20），失败进 actError', () =>
  /\.limit\(20\)\.get\(\)/.test(block) && /actError: formatCloudFnError\(e/.test(block))
t('接线：报名 / 核销按 AB.bookingMatch 计数 bookings（activityId 优先），回包校验令牌（快速刷新不串数）', () =>
  /const base = AB\.bookingMatch\(_, a\)/.test(block) && /status: _\.in\(AB\.BOOKED_STATUSES\)/.test(block) &&
    /status: 'used'/.test(block) && /token !== this\._actStatToken\) return/.test(block))
t('反馈：活动区不用 showHubTip（工作台子页没有 hubTip 宿主）、不用原生弹窗', () =>
  !/showHubTip|wx\.showModal|wx\.showToast/.test(block) && /showAppToast\(/.test(block))
t('反馈：删除 / 一键下架是两步确认（不弹原生框）', () =>
  /this\.data\.actConfirmDelId !== id/.test(block) && /if \(!this\.data\.actStaleConfirm\)/.test(block))
t('接线：下拉刷新在活动页只重拉活动', () =>
  /if \(this\.data\.curTab === 7\) \{\s*this\.loadActivities\(\)\.finally\(\(\) => wx\.stopPullDownRefresh\(\)\)/.test(cfg))

/* ⑤ 三态与版式 */
const wx = read(WX_REL)
const tab = (() => {
  const a = wx.indexOf('<!-- [Tab 7]')
  const b = wx.indexOf('<!-- [Tab 9]', a)
  if (a < 0 || b < 0) throw new Error('找不到 Tab 7 区块')
  return wx.slice(a, b)
})()
const sheet = (() => {
  const a = wx.indexOf('<!-- 活动编辑面板')
  const b = wx.indexOf('<!-- 分类管理已迁入', a)
  if (a < 0 || b < 0) throw new Error('找不到活动编辑面板')
  return wx.slice(a, b)
})()
t('三态：加载骨架 / 失败可重试 / 空态可直接发布', () =>
  /wx:if="\{\{!actReady\}\}"/.test(tab) && /wx:elif="\{\{actError\}\}"/.test(tab) && /bindtap="loadActivities">重新加载/.test(tab) &&
    /wx:if="\{\{!actBoard\.items\.length\}\}"/.test(tab))
t('版式：分组 Tab、关键数前置（报名 / 核销 / 余位）、不再用会压住卡片的悬浮 ＋', () =>
  /bindtap="switchActFilter"/.test(tab) && /item\.statKnown\?item\.capText:'—'/.test(tab) && /item\.remainText/.test(tab) &&
    !/fab-add/.test(tab) && !/<button/.test(tab))
t('版式：过期仍展示有横幅 + 一键下架；卡片有截止/开放、再办一场、去核销', () =>
  /wx:if="\{\{actBoard\.stale\}\}"/.test(tab) && /bindtap="closeStaleActivities"/.test(tab) &&
    /bindtap="toggleActivityStatus"/.test(tab) && /data-mode="copy"/.test(tab) && /bindtap="goStaffConsole"/.test(tab))
t('编辑面板：滚动区是定高的 .modal-body scroll-view；门店 / 日期 / 时间选择器；字段内报错', () =>
  /<scroll-view scroll-y class="modal-body"/.test(sheet) && /bindtap="bindAStoreChange"/.test(sheet) &&
    /mode="date"[^>]*bindchange="bindADateChange"/.test(sheet) && (sheet.match(/mode="time"/g) || []).length === 2 &&
    /act-f-err" wx:if="\{\{actFormErr\.field==='title'\}\}"/.test(sheet) && /bindtap="submitActivity"/.test(sheet) && !/<button/.test(sheet))
t('样式：workspace/index.wxss 真的 import 了 activityBoard.wxss', () =>
  /@import '\.\/activityBoard\.wxss';/.test(read(WS_REL)))

console.log(`test-activity-board：${passed} 通过 / ${failures.length} 失败`)
if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`))
  process.exit(1)
}
console.log('✓ 活动课程看板：北京时间分组 / 诚实计数 / 契约不动 / 反馈可见 / 三态齐全')

/* ── 自检：每条注入都必须让对应断言红 ───────────────────────────────── */
function selftest() {
  const REAL = resolve(HERE, '../..')
  const INJECTS = [
    { name: '今天按 UTC 取日', file: AB_REL, from: 'const d = new Date(Number(now) + TZ)', to: 'const d = new Date(Number(now))', expect: '00:30' },
    { name: '改用设备时区取星期', file: AB_REL, from: "WEEK[new Date(`${key}T00:00:00Z`).getUTCDay()]", to: "WEEK[new Date(`${key}T00:00:00Z`).getDay()]", expect: '设备时区' },
    { name: '过期但 open 仍算报名中', file: AB_REL, from: "if (date && date < today) return 'ended'", to: "if (date && date < today && item.status !== 'open') return 'ended'", expect: '过期即已结束' },
    { name: '已结束不再倒序', file: AB_REL, from: 'return ea ? -c : c', to: 'return c', expect: '远→近' },
    { name: '读不到报名数时编 0', file: AB_REL, from: "remainText: !known ? '—' :", to: "remainText: !known ? String(max) :", expect: '不编 0' },
    { name: '过期仍展示不再点名', file: AB_REL, from: "if (p === 'ended' && r.status === 'open') stale += 1", to: '', expect: 'stale' },
    { name: '编辑又回写 status', file: AB_REL, from: "  if (!original) {\n    data.status = 'open'\n    data.remain = maxPeople\n  } else {", to: "  data.status = 'open'\n  if (!original) {\n    data.remain = maxPeople\n  } else {", expect: '不回写 status' },
    { name: '新建不写 storeId', file: AB_REL, from: '    storeId: store.storeId\n', to: '', expect: '写 storeId' },
    { name: '允许新活动选过去的日期', file: AB_REL, from: "if (!original && today && date < today)", to: 'if (false)', expect: '早于今天' },
    { name: '再办一场没清日期', file: AB_REL, from: "const date = copy ? '' : normDate(src.date)", to: 'const date = normDate(src.date)', expect: '再办一场' },
    { name: '状态切换改走整文档 set', file: CFG_REL, from: "await callStoreContent({ action: 'update', collection: 'activities', id, data: { status: to } });", to: "await callStoreContent({ action: 'setDoc', collection: 'activities', id, data: { status: to } });", expect: '既有 upsert' },
    { name: '保存失败回到 showHubTip（子页看不见）', file: CFG_REL, from: "this.setData({ actSaving: false, actFormErr: { field: 'submit', msg: formatCloudFnError(e, '保存失败，请重试') } });", to: "this.showHubTip(formatCloudFnError(e, '保存失败'), 'warn');", expect: 'showHubTip' },
    { name: '删除回到原生 showModal', file: CFG_REL, from: '    if (this.data.actConfirmDelId !== id) {', to: "    wx.showModal({ title: '删除' });\n    if (this.data.actConfirmDelId !== id) {", expect: '原生弹窗' },
    { name: '计数回包不校验令牌', file: CFG_REL, from: 'if (token !== this._actStatToken) return;', to: '', expect: '令牌' },
    { name: '读活动不分页（limit 100 超客户端上限）', file: CFG_REL, from: '.skip(skip).limit(20).get()', to: '.limit(100).get()', expect: '分页' },
    { name: '失败态丢了重试', file: WX_REL, from: 'bindtap="loadActivities">重新加载', to: '>重新加载', expect: '三态' },
    { name: '悬浮 ＋ 回来压住卡片', file: WX_REL, from: '      <text class="act-note"', to: '      <view class="fab-add" bindtap="openActivityModal">＋</view>\n      <text class="act-note"', expect: '悬浮' },
    { name: '编辑面板滚动区失去定高类', file: WX_REL, from: '<scroll-view scroll-y class="modal-body" scroll-into-view', to: '<scroll-view scroll-y class="act-body" scroll-into-view', expect: '定高' },
    { name: '历史预约不再回退标题+日期', file: AB_REL, from: ", { activityId: cmd.exists(false), title: a.title, date: a.date }", to: '', expect: '回退' },
    { name: '样式没被 import', file: WS_REL, from: "@import './activityBoard.wxss';\n", to: '', expect: 'import' }
  ]
  let ok = true
  const snapshot = new Map(FILES.map((f) => [f, readFileSync(join(REAL, f), 'utf8')]))
  for (const inj of INJECTS) {
    const dir = mkdtempSync(join(tmpdir(), 'activity-board-selftest-'))
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
