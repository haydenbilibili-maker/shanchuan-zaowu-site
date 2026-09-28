#!/usr/bin/env node
/**
 * 活动名额 / C 端过期隐藏 / 工作台子页提示 守卫（manager 域；2026-09-28 产品负责人拍板三项「修复」）
 * 设计说明：miniprogram/docs/超管工作台_活动课程_升级_2026-09-28.md §9
 *
 * 钉住：
 *   ① 子页提示可见：workspace 页把 showHubTip 转到已挂的 <app-toast>（Hub 仍用自己的 page-tip，不重复）；长文案拆标题 + 说明；
 *   ② C 端不展示过期活动：首页 / 预约页 / 门店页查询层带 date >= 今天（北京时间），当天过了结束时间再滤一次；搜索同口径；
 *      判据 utils/activityExpiry.js 与 createBooking 副本逐字一致；
 *   ③ 报名服务端校验 + 条件原子扣减：临时加载真实 createBooking / cancelBooking + 内存 mock db 跑行为
 *      （并发不超报、满员/截止/过期拒绝、写库失败回补、取消归还且幂等、不带 activityId 的旧调用不变）；
 *   ④ 历史预约回退：ERP 报名进度 activityId 优先、无 activityId 回退「标题 + 日期」。
 *
 * 用法：
 *   node miniprogram/scripts/test-activity-seats.mjs
 *   node miniprogram/scripts/test-activity-seats.mjs --selftest   （注入只写临时副本，真源码只读）
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

const MP = 'miniprogram'
const WS_JS = `${MP}/subpackages/manager/manager/workspace/index.js`
const WS_WXML = `${MP}/subpackages/manager/manager/workspace/index.wxml`
const HUB_WXML = `${MP}/subpackages/manager/manager/index.wxml`
const EXP = `${MP}/utils/activityExpiry.js`
const CB = `${MP}/cloudfunctions/createBooking`
const CANCEL = `${MP}/cloudfunctions/cancelBooking/index.js`
const UPDATE = `${MP}/cloudfunctions/updateBooking/index.js`
const SBR = `${MP}/cloudfunctions/sendBookingReminder`
const SUB_CLIENT = `${MP}/subpackages/business/utils/bookingSubscribe.js`
const TICKET_JS = `${MP}/subpackages/business/ticket/index.js`
const HOME = `${MP}/pages/index/index.js`
const BOOK_JS = `${MP}/subpackages/business/booking/index.js`
const BOOK_WXML = `${MP}/subpackages/business/booking/index.wxml`
const STORE_JS = `${MP}/subpackages/business/store/index.js`
const SEARCH_JS = `${MP}/subpackages/feature/search/index.js`
const ERP = 'admin/src/components/Activities.vue'
const FILES = [
  WS_JS, WS_WXML, HUB_WXML, EXP,
  `${CB}/index.js`, `${CB}/activityExpiry.js`, `${CB}/activitySeat.js`, `${CB}/messageWrite.js`, `${CB}/bookingRules.js`, `${CB}/orderSummary.js`,
  CANCEL, UPDATE, `${SBR}/index.js`, `${SBR}/subscribeTemplates.js`, `${SBR}/sourceOrigin.js`, SUB_CLIENT, TICKET_JS, HOME, BOOK_JS, BOOK_WXML, STORE_JS, SEARCH_JS, ERP
]

if (argv.includes('--selftest')) selftest()

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
let passed = 0
const failures = []
const tests = []
const t = (name, fn) => tests.push([name, fn])

function loadCjs(absPath, mocks = {}, cache = new Map()) {
  if (cache.has(absPath)) return cache.get(absPath).exports
  const mod = { exports: {} }
  cache.set(absPath, mod)
  const req = (id) => {
    if (mocks[id]) return mocks[id]
    for (const c of [resolve(dirname(absPath), id), `${resolve(dirname(absPath), id)}.js`]) {
      if (existsSync(c) && statSync(c).isFile()) return loadCjs(c, mocks, cache)
    }
    throw new Error('require 解析失败：' + id)
  }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', 'console', readFileSync(absPath, 'utf8'))(mod, mod.exports, req, QUIET)
  return mod.exports
}
const ERRS = []
const QUIET = { log() {}, warn() {}, error: (...a) => ERRS.push(a.map(String).join(' ')), info() {} }

/* ── 内存 mock db：where+update 在同一个同步段里判定并写入 = 与云数据库条件更新同样的原子语义 ── */
function makeDb(seed = {}) {
  const cols = {}
  let seq = 0
  const col = (n) => (cols[n] = cols[n] || new Map())
  for (const [n, rows] of Object.entries(seed)) rows.forEach((r) => col(n).set(r._id, JSON.parse(JSON.stringify(r))))
  const op = (name) => (v) => ({ $op: name, v })
  const cmd = new Proxy({ or: (xs) => ({ $or: xs }), and: (xs) => ({ $and: xs }) }, { get: (o, k) => o[k] || op(k) })
  const test = (val, c) => {
    if (c && typeof c === 'object' && c.$op) {
      const v = c.v
      switch (c.$op) {
        case 'gte': return val >= v
        case 'gt': return val > v
        case 'lt': return val < v
        case 'neq': return val !== v
        case 'in': return v.includes(val)
        case 'exists': return v ? val !== undefined : val === undefined
        default: return false
      }
    }
    return val === c
  }
  const match = (doc, cond) => {
    if (!cond) return true
    if (cond.$or) return cond.$or.some((x) => match(doc, x))
    if (cond.$and) return cond.$and.every((x) => match(doc, x))
    return Object.entries(cond).every(([k, c]) => test(doc[k], c))
  }
  const apply = (doc, data) => {
    for (const [k, v] of Object.entries(data)) {
      if (v && v.$op === 'inc') doc[k] = (Number(doc[k]) || 0) + v.v
      else if (v && v.$op === 'push') doc[k] = [...(doc[k] || []), ...[].concat(v.v)]
      else doc[k] = v
    }
  }
  const db = {
    cols,
    failAdd: 0,
    command: cmd,
    serverDate: () => ({ $serverDate: true }),
    collection(n) {
      const q = (cond) => {
        const chain = {
          where: (c) => q(c),
          limit: () => chain, skip: () => chain, orderBy: () => chain, field: () => chain,
          get: async () => ({ data: [...col(n).values()].filter((d) => match(d, cond)).map((d) => ({ ...d })) }),
          count: async () => ({ total: [...col(n).values()].filter((d) => match(d, cond)).length }),
          update: async ({ data }) => {
            let updated = 0
            for (const d of col(n).values()) if (match(d, cond)) { apply(d, data); updated += 1 }
            return { stats: { updated } }
          },
          doc: (id) => ({
            get: async () => {
              const d = col(n).get(id)
              if (!d) throw new Error('document.get:fail document not exists')
              return { data: { ...d } }
            },
            update: async ({ data }) => {
              const d = col(n).get(id)
              if (!d) throw new Error('document.update:fail document not exists')
              apply(d, data)
              return { stats: { updated: 1 } }
            }
          }),
          add: async ({ data }) => {
            if (db.failAdd > 0) { db.failAdd -= 1; throw new Error('mock add failed') }
            const _id = `${n}_${++seq}`
            col(n).set(_id, { ...data, _id })
            return { _id }
          }
        }
        return chain
      }
      return q(null)
    }
  }
  return db
}
function loadFn(rel, db, openid = 'u1') {
  const sdk = {
    DYNAMIC_CURRENT_ENV: 'env', init() {}, database: () => db, getWXContext: () => ({ OPENID: sdk.openid, SOURCE: sdk.source || '' }), openid,
    sends: [],
    sendImpl: async () => ({ errCode: 0 }),
    openapi: { subscribeMessage: { send: (req) => { sdk.sends.push(req); return sdk.sendImpl(req) } } },
    calls: [],
    callImpl: async () => ({ result: { success: true } }),
    callFunction: (req) => { sdk.calls.push(req); return sdk.callImpl(req) }
  }
  const main = loadCjs(join(ROOT, rel), { 'wx-server-sdk': sdk }).main
  return { main, sdk }
}

/* ① 子页提示可见 */
const wsJs = read(WS_JS)
const hubTip = (() => {
  const m = /\n  showHubTip\(msg, tone\) \{[\s\S]*?\n  \},\n/.exec(wsJs)
  if (!m) return null
  // eslint-disable-next-line no-new-func
  return new Function(`return {${m[0]}}`)().showHubTip
})()
const tip = (msg, tone) => {
  const calls = []
  hubTip.call({ showAppToast: (o) => calls.push(o) }, msg, tone)
  return calls
}
t('子页提示：workspace 页覆写 showHubTip（在 ...managerPageConfig 之后），转到 showAppToast，不用原生 toast', () => {
  const spread = wsJs.indexOf('...managerPageConfig')
  const own = wsJs.indexOf('\n  showHubTip(msg, tone) {')
  return !!hubTip && spread > 0 && own > spread && !/wx\.showToast/.test(/\n  showHubTip[\s\S]*?\n  \},\n/.exec(wsJs)[0])
})
t('子页提示：宿主 <app-toast> 挂在 workspace 页；Hub 仍只用自己的 page-tip（首页不重复）', () =>
  /<app-toast[\s\S]*show="\{\{toastShow\}\}"/.test(read(WS_WXML)) && !/hubTipText/.test(read(WS_WXML)) &&
    /page-tip is-\{\{hubTipTone\}\}/.test(read(HUB_WXML)) && !/<app-toast/.test(read(HUB_WXML)))
t('子页提示：短文案整句做标题；warn / info 有不同眉题；空文案不弹', () => {
  const a = tip('无此功能权限', 'warn')[0]
  const b = tip('已保存', 'info')[0]
  return a.title === '无此功能权限' && a.desc === '' && a.overline !== b.overline && tip('  ', 'warn').length === 0
})
t('子页提示：长文案按首个标点拆成标题 + 说明；无标点时给短标题、整句进说明（不截断丢字）', () => {
  const a = tip('保存失败，云函数 manageProducts 返回权限不足请联系超管', 'warn')[0]
  const text = '藏品未加载请稍后在列表中打开再试一次'
  const b = tip(text, 'warn')[0]
  return a.title === '保存失败' && a.desc.startsWith('云函数') && b.title.length <= 12 && b.desc === text && b.duration > 2200
})

/* ② C 端过期隐藏 */
const expSrc = read(EXP)
const exp = loadCjs(join(ROOT, EXP))
const bj = (iso) => Date.parse(`${iso}+08:00`)
t('过期判据：北京时间（UTC 16:30 = 北京次日 00:30，前一天的活动已过期）', () =>
  exp.todayKey(Date.parse('2026-09-28T16:30:00Z')) === '2026-09-29' &&
    exp.isActivityExpired({ date: '2026-09-28' }, Date.parse('2026-09-28T16:30:00Z')) === true &&
    exp.isActivityExpired({ date: '2026-09-29' }, Date.parse('2026-09-28T16:30:00Z')) === false)
t('过期判据：当天过了结束时间才算过期（无结束取开始，都没写到 24:00）；未填日期不藏；不补零日期也认', () => {
  const now = bj('2026-09-28T15:30:00')
  const f = (item) => exp.isActivityExpired(item, now)
  return f({ date: '2026-09-28', time: '14:00 - 16:00' }) === false && f({ date: '2026-09-28', time: '13:00 - 15:00' }) === true &&
    f({ date: '2026-09-28', time: '15:00' }) === true && f({ date: '2026-09-28', time: '16:00' }) === false &&
    f({ date: '2026-09-28' }) === false && f({ date: '' }) === false && f({ date: '2026-9-27' }) === true && f({ date: '2026-10-1' }) === false
})
t('过期判据：createBooking 副本与主包件逐字一致', () => read(`${CB}/activityExpiry.js`) === expSrc)
const home = read(HOME)
t('首页：活动查询层带 date >= 今天（北京时间）并再滤当天已结束的；不碰 HomeReco', () =>
  /collection\('activities'\)\.where\(\{ status, date: _\.gte\(todayKey\(\)\) \}\)/.test(home) &&
    /res\.data = \(res\.data \|\| \[\]\)\.filter\(\(a\) => !isActivityExpired\(a\)\)/.test(home) &&
    /require\('\.\.\/\.\.\/utils\/activityExpiry'\)/.test(home))
const store = read(STORE_JS)
t('门店页：两条查询分支都带 date >= 今天，展示前再滤已结束', () =>
  (store.match(/where\(\{ status: 'open', (storeId, )?date: db\.command\.gte\(todayKey\(\)\) \}\)/g) || []).length === 2 &&
    /all\.filter\(\(a\) => !isActivityExpired\(a\)\)\.slice\(0, 4\)/.test(store))
const book = read(BOOK_JS)
t('预约页：两条查询分支都带 date >= 今天，展示前再滤已结束', () =>
  (book.match(/where\(\{ status: 'open', (storeId, )?date: db\.command\.gte\(todayKey\(\)\) \}\)/g) || []).length === 2 &&
    /all = all\.filter\(\(a\) => !isActivityExpired\(a\)\)/.test(book))
t('搜索：活动结果滤掉已结束的', () => /\(actRes\.data \|\| \[\]\)\.filter\(\(a\) => !isActivityExpired\(a\)\)/.test(read(SEARCH_JS)))

/* ③ 预约页：带 activityId、满员显示已满并禁用 */
const bookWx = read(BOOK_WXML)
t('预约页：报名带 activityId；满员（remain<=0 且有名额上限）标 _full，选中 / 提交都拦下并提示「名额已满」', () =>
  /activityId: item\._id/.test(book) && /const full = max > 0 && Number\.isFinite\(left\) && left <= 0/.test(book) &&
    /if \(item\.status !== 'open' \|\| item\._full\)/.test(book) && /status === 'full' \? '名额已满'/.test(book) &&
    (bookWx.match(/data-status="\{\{item\._full \? 'full' : item\.status\}\}"/g) || []).length === 2 &&
    (bookWx.match(/wx:if="\{\{item\._seat\}\}">\{\{item\._seat\}\}</g) || []).length === 2)

const shift = (days) => exp.todayKey(Date.now() + days * 864e5)
const ACT = (over) => ({ _id: 'A1', title: '蝴蝶课', type: 'course', date: shift(3), time: '14:00 - 16:00', price: 99, status: 'open', maxPeople: 2, remain: 2, ...over })
const REQ = (over) => ({ type: 'course', title: '客户端标题', date: '2000-01-01', people: 1, price: 0, name: '张三', phone: '13800000000', storeId: 'store_shanhaizaowu', activityId: 'A1', ...over })
const bookings = (db) => [...db.cols.bookings?.values() || []]
const remainOf = (db, id = 'A1') => db.cols.activities.get(id).remain

t('报名：带 activityId 时服务端扣 1 个名额，预约记 activityId / seatHeld，标题日期价格以活动为准；回包形状不变', async () => {
  const db = makeDb({ activities: [ACT()] })
  const r = await loadFn(`${CB}/index.js`, db).main(REQ())
  const b = bookings(db)[0]
  return r.success === true && typeof r.bookingId === 'string' && typeof r.ticketCode === 'string' && remainOf(db) === 1 &&
    b.activityId === 'A1' && b.seatHeld === 1 && b.title === '蝴蝶课' && b.date === shift(3) && b.price === 99
})
t('报名：余 1 个名额时 3 人并发，只成功 1 个、不超报（remain 不为负）', async () => {
  const db = makeDb({ activities: [ACT({ remain: 1 })] })
  const { main } = loadFn(`${CB}/index.js`, db)
  const rs = await Promise.all([main(REQ()), main(REQ()), main(REQ())])
  return rs.filter((r) => r.success).length === 1 && remainOf(db) === 0 && bookings(db).length === 1 &&
    rs.filter((r) => !r.success).every((r) => r.msg === '名额已满')
})
t('报名：满员 / 已截止 / 已结束（北京时间）/ 活动不存在 —— 全部拒绝，不写预约、不动名额', async () => {
  const run = async (act, req) => {
    const db = makeDb({ activities: [act] })
    const r = await loadFn(`${CB}/index.js`, db).main(REQ(req))
    return { r, n: bookings(db).length, left: remainOf(db) }
  }
  const full = await run(ACT({ remain: 0 }))
  const closed = await run(ACT({ status: 'closed' }))
  const ended = await run(ACT({ date: shift(-1) }))
  const gone = await run(ACT(), { activityId: 'nope' })
  return full.r.success === false && full.r.msg === '名额已满' && full.n === 0 &&
    closed.r.success === false && /截止/.test(closed.r.msg) && closed.n === 0 && closed.left === 2 &&
    ended.r.success === false && /已结束/.test(ended.r.msg) && ended.n === 0 && ended.left === 2 &&
    gone.r.success === false && gone.n === 0
})
t('报名：不限名额（maxPeople 0）照常报名、不扣 remain；历史活动没写 remain 时先按名额补齐再扣', async () => {
  const db1 = makeDb({ activities: [ACT({ maxPeople: 0, remain: 5 })] })
  const r1 = await loadFn(`${CB}/index.js`, db1).main(REQ())
  const db2 = makeDb({ activities: [ACT({ maxPeople: 3, remain: undefined })] })
  const r2 = await loadFn(`${CB}/index.js`, db2).main(REQ())
  return r1.success && remainOf(db1) === 5 && bookings(db1)[0].seatHeld === 0 && r2.success && remainOf(db2) === 2
})
t('报名：写预约失败时把扣掉的名额回补', async () => {
  const db = makeDb({ activities: [ACT()] })
  db.failAdd = 1
  const r = await loadFn(`${CB}/index.js`, db).main(REQ())
  return r.success === false && remainOf(db) === 2 && bookings(db).length === 0
})
t('报名：不带 activityId 的旧调用（到店参观等）行为不变：不读活动、不动名额、不写 activityId', async () => {
  const db = makeDb({ activities: [ACT()] })
  const r = await loadFn(`${CB}/index.js`, db).main(REQ({ activityId: undefined, type: 'museum_visit', title: '到店参观', date: shift(2) }))
  const b = bookings(db)[0]
  return r.success === true && remainOf(db) === 2 && b && !('activityId' in b) && !('seatHeld' in b) && b.title === '到店参观'
})
const BK = (over) => ({ _id: 'B1', _openid: 'u1', status: 'confirmed', date: shift(5), time: '14:00', price: 0, activityId: 'A1', seatHeld: 1, ...over })
t('取消：归还 seatHeld 个名额并记 seatReleased；再取消一次不重复归还', async () => {
  const db = makeDb({ activities: [ACT({ remain: 0 })], bookings: [BK()] })
  const { main } = loadFn(CANCEL, db)
  const r1 = await main({ bookingId: 'B1' })
  const r2 = await main({ bookingId: 'B1' })
  const b = db.cols.bookings.get('B1')
  return r1.success === true && r2.success === false && remainOf(db) === 1 && b.status === 'cancelled' && b.seatReleased === true
})
t('取消：同一预约并发取消两次，只成功一次、只归还一次（幂等）', async () => {
  const db = makeDb({ activities: [ACT({ remain: 0 })], bookings: [BK()] })
  const { main } = loadFn(CANCEL, db)
  const rs = await Promise.all([main({ bookingId: 'B1' }), main({ bookingId: 'B1' })])
  return rs.filter((r) => r.success).length === 1 && remainOf(db) === 1
})
t('取消：历史预约（无 activityId）照常取消，不动任何活动名额', async () => {
  const db = makeDb({ activities: [ACT({ remain: 0, title: 'x' })], bookings: [BK({ activityId: undefined, seatHeld: undefined })] })
  const r = await loadFn(CANCEL, db).main({ bookingId: 'B1' })
  return r.success === true && remainOf(db) === 0 && db.cols.bookings.get('B1').status === 'cancelled'
})

const reminders = (sdk) => sdk.calls.filter((c) => c && c.name === 'sendBookingReminder')
t('取消提醒：取消成功经 cloud.callFunction 触发一次 sendBookingReminder（type=cancelled, bookingId）；重复取消不再发', async () => {
  const db = makeDb({ activities: [ACT({ remain: 0 })], bookings: [BK()] })
  const { main, sdk } = loadFn(CANCEL, db)
  const r1 = await main({ bookingId: 'B1' })
  const r2 = await main({ bookingId: 'B1' })
  const rs = reminders(sdk)
  return r1.success === true && r2.success === false && rs.length === 1 && rs[0].data.type === 'cancelled' && rs[0].data.bookingId === 'B1'
})
t('取消提醒：提醒抛错 / 回包失败都不影响取消成功，且 console.error 记录（不静默）', async () => {
  const run = async (impl) => {
    const db = makeDb({ activities: [ACT({ remain: 0 })], bookings: [BK()] })
    const { main, sdk } = loadFn(CANCEL, db)
    sdk.callImpl = impl
    ERRS.length = 0
    const r = await main({ bookingId: 'B1' })
    return r.success === true && db.cols.bookings.get('B1').status === 'cancelled' && remainOf(db) === 1 && ERRS.some((e) => /取消提醒失败/.test(e))
  }
  return (await run(async () => { throw new Error('boom') })) && (await run(async () => ({ result: { success: false, msg: 'x' } })))
})
t('改期提醒：改期成功触发一次 sendBookingReminder（type=changed, bookingId）；提醒失败不影响改期成功且有 console.error', async () => {
  const db = makeDb({ bookings: [BK({ activityId: undefined, seatHeld: undefined })] })
  const { main, sdk } = loadFn(UPDATE, db)
  const r = await main({ bookingId: 'B1', newDate: shift(9), newTime: '15:00' })
  const rs = reminders(sdk)
  const db2 = makeDb({ bookings: [BK({ activityId: undefined, seatHeld: undefined })] })
  const f = loadFn(UPDATE, db2)
  f.sdk.callImpl = async () => { throw new Error('boom') }
  ERRS.length = 0
  const r2 = await f.main({ bookingId: 'B1', newDate: shift(9), newTime: '15:00' })
  return r.success === true && rs.length === 1 && rs[0].data.type === 'changed' && rs[0].data.bookingId === 'B1' &&
    r2.success === true && db2.cols.bookings.get('B1').date === shift(9) && ERRS.some((e) => /改期提醒失败/.test(e))
})

/* ⑤ 预约取消订阅消息（模板 47766：thing1 活动名称 / time2 预约时段 / thing3 温馨提示） */
const subTpl = loadCjs(join(ROOT, `${SBR}/subscribeTemplates.js`))
t('订阅模板：取消模板是真实 ID（非 booking_* 占位），与 C 端请求订阅的 ID 一致', () => {
  const id = subTpl.BOOKING_CANCEL_TMPL_ID
  const client = /const BOOKING_CANCEL_TMPL_ID = '([^']+)'/.exec(read(SUB_CLIENT))
  return /^[A-Za-z0-9_-]{30,}$/.test(id) && !/^booking_/.test(id) && subTpl.TEMPLATES.cancelled.templateId === id && client && client[1] === id
})
t('订阅模板：取消 data 键 = thing1 / time2 / thing3（取证字段）；thing ≤20 字；time2 为「2026年9月28日 14:00」且区间只取开始', () => {
  const r = subTpl.buildSubscribe('cancelled', { title: '一二三四五六七八九十一二三四五六七八九十一二三', date: '2026-9-28', time: '14:00 - 16:00' })
  const keys = Object.keys(r.data || {}).sort().join(',')
  return r.templateId === subTpl.BOOKING_CANCEL_TMPL_ID && keys === 'thing1,thing3,time2' &&
    r.data.thing1.value.length <= 20 && r.data.thing3.value.length <= 20 && r.data.time2.value === '2026年9月28日 14:00' &&
    subTpl.buildSubscribe('cancelled', { title: 'x', date: '2026-09-28', time: '' }).skip === 'bad_fields'
})
t('订阅模板：改期 / 成功 / 前一天等没有真实模板的类型不发订阅（不拿占位 ID 误发）', () =>
  ['changed', 'success', 'day_before', 'hour_before'].every((k) => subTpl.buildSubscribe(k, { title: 'x', date: '2026-09-28', time: '14:00' }).skip === 'no_template'))
const loadSbr = (db) => {
  const f = loadFn(`${SBR}/index.js`, db)
  f.sdk.source = 'wx_client,scf'
  return f
}
t('sendBookingReminder：取消 → 订阅消息发一次（真实模板 + 取证键、跳票夹）+ 站内信；43101 未订阅时只记日志，站内信照发、回包成功', async () => {
  const db = makeDb({ bookings: [BK({ status: 'cancelled', title: '蝴蝶课' })] })
  const a = loadSbr(db)
  const r1 = await a.main({ type: 'cancelled', bookingId: 'B1' })
  const s = a.sdk.sends[0] || {}
  const b = loadSbr(makeDb({ bookings: [BK({ status: 'cancelled', title: '蝴蝶课' })] }))
  b.sdk.sendImpl = async () => { const e = new Error('user refuse to accept the msg'); e.errCode = 43101; throw e }
  ERRS.length = 0
  const r2 = await b.main({ type: 'cancelled', bookingId: 'B1' })
  const dispatched = (sdk) => sdk.calls.filter((c) => c.name === 'dispatchMessage').length
  return r1.success === true && a.sdk.sends.length === 1 && s.templateId === subTpl.BOOKING_CANCEL_TMPL_ID && s.touser === 'u1' &&
    Object.keys(s.data).sort().join(',') === 'thing1,thing3,time2' && /ticket\/index\?id=B1/.test(s.page) && dispatched(a.sdk) === 1 &&
    r2.success === true && dispatched(b.sdk) === 1 && ERRS.some((e) => /订阅消息失败/.test(e) && /43101/.test(e))
})
t('sendBookingReminder：改期只发站内信，不调订阅消息', async () => {
  const a = loadSbr(makeDb({ bookings: [BK()] }))
  const r = await a.main({ type: 'changed', bookingId: 'B1' })
  return r.success === true && a.sdk.sends.length === 0 && a.sdk.calls.filter((c) => c.name === 'dispatchMessage').length === 1
})
t('C 端：报名按钮 tap 里、任何 await 之前请求订阅，complete 后才弹确认（拒绝不阻塞）；取消按钮不再请求', () => {
  const fn = /async submitActivityBooking\(\) \{[\s\S]*?requestBookingSubscribe\(\(\) => this\.modal\(/.exec(book)
  const cli = read(SUB_CLIENT)
  return !!fn && !/await /.test(fn[0]) && /wx\.requestSubscribeMessage\(\{ tmplIds: \[BOOKING_CANCEL_TMPL_ID\], complete: go \}\)/.test(cli) &&
    !/requestSubscribeMessage/.test(read(TICKET_JS))
})

/* ④ ERP 报名进度 */
const erp = read(ERP)
t('ERP：报名进度按 bookings 计 —— activityId 优先，历史无 activityId 回退「标题 + 日期」；不再用 maxPeople - remain', () =>
  /b\.activityId \? b\.activityId === row\._id : b\.title === row\.title && b\.date === row\.date/.test(erp) &&
    /const joined = joinedOf\(row\)/.test(erp) && /\$\{joinedOf\(scope\.row\)\}/.test(erp) && !/maxPeople \|\| 0\) - \(scope\.row\.remain/.test(erp))

for (const [name, fn] of tests) {
  let ok = false
  let err = ''
  try { ok = (await fn()) === true } catch (e) { err = e.message }
  if (ok) passed += 1
  else failures.push(err ? `${name}（${err}）` : name)
}
console.log(`test-activity-seats：${passed} 通过 / ${failures.length} 失败`)
if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`))
  process.exit(1)
}
console.log('✓ 活动名额：子页提示可见 / C 端不展示过期 / 服务端原子扣减 + 取消归还幂等 / 历史预约回退')

/* ── 自检：每条注入都必须让对应断言红 ───────────────────────────────── */
function selftest() {
  const REAL = resolve(HERE, '../..')
  const SEAT = `${CB}/activitySeat.js`
  const INJECTS = [
    { name: '子页不再覆写 showHubTip', file: WS_JS, from: '  showHubTip(msg, tone) {', to: '  _oldHubTip(msg, tone) {', expect: '子页提示：workspace' },
    { name: '长文案整句塞进标题', file: WS_JS, from: "const title = text.length <= 12 ? text :", to: 'const title = true ? text :', expect: '长文案' },
    { name: '子页丢了 app-toast 宿主', file: WS_WXML, from: '<app-toast', to: '<view', expect: '宿主' },
    { name: '过期判据按 UTC 取日', file: EXP, from: 'Date.now() : now) + TZ)', to: 'Date.now() : now))', expect: '北京时间' },
    { name: '过期判据只看开始时间', file: EXP, from: 'const cut = hm[1] || hm[0]', to: 'const cut = hm[0]', expect: '结束时间' },
    { name: '云函数副本漂移', file: `${CB}/activityExpiry.js`, from: 'const TZ = 8 * 3600 * 1000', to: 'const TZ = 8 * 3600 * 1000 // drift', expect: '逐字' },
    { name: '首页查询去掉日期条件', file: HOME, from: 'where({ status, date: _.gte(todayKey()) })', to: 'where({ status })', expect: '首页' },
    { name: '门店页兜底分支去掉日期条件', file: STORE_JS, from: "where({ status: 'open', date: db.command.gte(todayKey()) }).orderBy('date', 'asc').limit(30)", to: "where({ status: 'open' }).orderBy('date', 'asc').limit(30)", expect: '门店页' },
    { name: '预约页不传 activityId', file: BOOK_JS, from: '        activityId: item._id\n', to: '\n', expect: 'activityId' },
    { name: '预约页满员不拦', file: BOOK_JS, from: "if (item.status !== 'open' || item._full)", to: "if (item.status !== 'open')", expect: '名额已满' },
    { name: '搜索不滤过期', file: SEARCH_JS, from: '(actRes.data || []).filter((a) => !isActivityExpired(a))', to: '(actRes.data || [])', expect: '搜索' },
    { name: '扣名额去掉 remain 条件（非原子）', file: SEAT, from: "status: 'open', remain: _.gte(n) }", to: "status: 'open' }", expect: '不超报' },
    { name: '不校验活动状态', file: SEAT, from: "if (act.status !== 'open') return", to: 'if (false) return', expect: '截止' },
    { name: '不校验过期', file: SEAT, from: "if (isActivityExpired(act, now)) return { ok: false, msg: '该活动已结束' }", to: '', expect: '已结束' },
    { name: '写库失败不回补', file: `${CB}/index.js`, from: '    if (seatHeld && !bookingSaved) {', to: '    if (false) {', expect: '回补' },
    { name: '旧调用也去读活动', file: `${CB}/index.js`, from: '  if (activityId) {\n    let hold', to: "  activityId = activityId || 'A1'\n  if (activityId) {\n    let hold", expect: '旧调用' },
    { name: '取消改回无条件更新（重复归还）', file: CANCEL, from: "where({ _id: bookingId, status: 'confirmed' })", to: 'where({ _id: bookingId })', expect: '幂等' },
    { name: '取消不归还名额', file: CANCEL, from: 'data: { remain: db.command.inc(held) }', to: 'data: { remain: db.command.inc(0) }', expect: '归还' },
    { name: '取消提醒改回 wx.cloud（云端无 wx）', file: CANCEL, from: "const r = await cloud.callFunction({\n        name: 'sendBookingReminder',\n        data: { type: 'cancelled', bookingId }", to: "const r = await wx.cloud.callFunction({\n        name: 'sendBookingReminder',\n        data: { type: 'cancelled', bookingId }", expect: '取消提醒' },
    { name: '取消提醒失败静默吞掉', file: CANCEL, from: "      console.error('发送取消提醒失败:', bookingId, err);", to: '', expect: '不静默' },
    { name: '改期提醒改回 wx.cloud', file: UPDATE, from: 'const r = await cloud.callFunction({', to: 'const r = await wx.cloud.callFunction({', expect: '改期提醒' },
    { name: '取消模板退回占位 ID', file: `${SBR}/subscribeTemplates.js`, from: "const BOOKING_CANCEL_TMPL_ID = 'C_vs4N7_ahe1KAVmBSclyR02FsGf0MzJU5Xfou3tQbk'", to: "const BOOKING_CANCEL_TMPL_ID = 'booking_cancelled'", expect: '真实 ID' },
    { name: '字段键写错（time2 → date2）', file: `${SBR}/subscribeTemplates.js`, from: '        time2: { value: time2 },', to: '        date2: { value: time2 },', expect: '取证键' },
    { name: 'time2 塞区间原文', file: `${SBR}/subscribeTemplates.js`, from: "return `${d[1]}年${Number(d[2])}月${Number(d[3])}日 ${t[1].padStart(2, '0')}:${t[2]}`", to: "return `${d[1]}年${Number(d[2])}月${Number(d[3])}日 ${time}`", expect: '区间只取开始' },
    { name: 'thing1 不截断', file: `${SBR}/subscribeTemplates.js`, from: 'return t.length > 20 ? `${t.slice(0, 19)}…` : t', to: 'return t', expect: 'thing ≤20' },
    { name: '改期也拿占位 ID 发订阅', file: `${SBR}/subscribeTemplates.js`, from: 'const TEMPLATES = {\n', to: "const TEMPLATES = {\n  changed: { templateId: 'booking_changed', build: () => ({ thing1: { value: 'x' } }) },\n", expect: '占位 ID 误发' },
    { name: '客户端 ID 与服务端不一致', file: SUB_CLIENT, from: "const BOOKING_CANCEL_TMPL_ID = 'C_vs4N7_ahe1KAVmBSclyR02FsGf0MzJU5Xfou3tQbk'", to: "const BOOKING_CANCEL_TMPL_ID = 'C_vs4N7_OTHER_ahe1KAVmBSclyR02FsGf0'", expect: 'C 端请求订阅的 ID 一致' },
    { name: '订阅失败连站内信都不发', file: `${SBR}/index.js`, from: "        console.error('发送订阅消息失败:', type, booking._id || bookingId, err && (err.errCode || err.errMsg || err.message));", to: '        throw err;', expect: '43101' },
    { name: '订阅请求挪到 await 之后（丢了点击手势）', file: BOOK_JS, from: "    requestBookingSubscribe(() => this.modal({", to: "    await Promise.resolve();\n    requestBookingSubscribe(() => this.modal({", expect: '任何 await 之前' },
    { name: 'ERP 去掉历史回退', file: ERP, from: 'b.activityId ? b.activityId === row._id : b.title === row.title && b.date === row.date', to: 'b.activityId === row._id', expect: 'ERP' }
  ]
  let ok = true
  const snapshot = new Map(FILES.map((f) => [f, readFileSync(join(REAL, f), 'utf8')]))
  for (const inj of INJECTS) {
    const dir = mkdtempSync(join(tmpdir(), 'activity-seats-selftest-'))
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
