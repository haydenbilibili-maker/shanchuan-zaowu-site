#!/usr/bin/env node
/**
 * test:inbox-mark-read —— 山海有信「全部标为已读」真的落库（2026-11-24，产品负责人截图「始终有一个未读，且点击全部标为已读无反应」）
 *
 * 真跑 getUserMessages 源码（桩 wx-server-sdk + 内存库），不联网不写盘：
 *   R1 同一封信的多处落点（user_messages 新旧两条 + notification_logs 一条，全部未读）：全部已读后**每一条**都是 read=true，
 *      云端回报 unreadCount = 0；原实现只改 _id + 一个 _altId，且把 _altId 一律当「另一张表」，同表那条会漏改
 *   R2 有一条怎么也改不上：不再报「成功」，如实返回 success=false + 剩余未读数（原实现 .catch(() => null) 吞掉失败）
 *   R3 单条已读：整组落点一起标上（不留一条未读的「影子」）
 *   R4 页面：先关 loading 再提示（微信 loading 与 toast 共用一个浮层，hideLoading 会把提示一并关掉 =「点了没反应」）；未读数以云端回报为准
 *   R5 列表响应不带内部字段 _members / _source
 *   R6 影子未读：旧实现漏改、被同组已读那条盖住的残留，全部已读时也按库扫掉（组成一变它就会单独冒出来）
 *
 *   node miniprogram/scripts/test-inbox-mark-read.mjs [--selftest]
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCjsModule } from './lib/cjs-loader.mjs'

const MP = join(dirname(fileURLToPath(import.meta.url)), '..')
const P = {
  fn: join(MP, 'cloudfunctions/getUserMessages/index.js'),
  page: join(MP, 'subpackages/extra/user/messages/index.js'),
  wxss: join(MP, 'subpackages/extra/user/messages/index.wxss')
}

let INJECT = null
const transform = (file, src) => {
  if (!INJECT || INJECT.file !== file) return src
  if (src.indexOf(INJECT.find) === -1) throw new Error(`注入锚点失效：${INJECT.name}`)
  return src.replace(INJECT.find, INJECT.replace)
}
const read = (f) => transform(f, readFileSync(f, 'utf8'))

const ME = 'u_me'

/** 内存库：只实现 getUserMessages 用到的链式调用；where 条件里只认本测试用到的字段 */
function memDb(seed, opts = {}) {
  const docs = JSON.parse(JSON.stringify(seed))
  const cmd = {
    or: (arr) => ({ $or: arr }),
    and: (arr) => ({ $and: arr }),
    in: (arr) => ({ $in: arr }),
    neq: (v) => ({ $neq: v })
  }
  const match = (doc, w) => {
    if (!w) return true
    if (w.$or) return w.$or.some((x) => match(doc, x))
    if (w.$and) return w.$and.every((x) => match(doc, x))
    return Object.keys(w).every((k) => {
      const v = w[k]
      if (v && v.$in) return v.$in.includes(doc[k])
      if (v && Object.prototype.hasOwnProperty.call(v, '$neq')) return doc[k] !== v.$neq
      return doc[k] === v
    })
  }
  const query = (name, w) => {
    const q = {
      where: (x) => query(name, x),
      orderBy: () => q,
      limit: () => q,
      skip: () => q,
      field: () => q,
      get: async () => ({ data: Object.values(docs[name] || {}).filter((d) => match(d, w)).map((d) => Object.assign({}, d)) }),
      count: async () => ({ total: Object.values(docs[name] || {}).filter((d) => match(d, w)).length })
    }
    return q
  }
  return {
    docs,
    command: cmd,
    serverDate: () => 'NOW',
    collection: (name) => Object.assign(query(name, null), {
      doc: (id) => ({
        get: async () => { const d = (docs[name] || {})[id]; if (!d) throw new Error('not exist'); return { data: Object.assign({}, d) } },
        update: async ({ data }) => {
          if ((opts.stuck || []).includes(id)) return { stats: { updated: 0 } }
          const d = (docs[name] || {})[id]
          if (!d) return { stats: { updated: 0 } }
          Object.assign(d, data)
          return { stats: { updated: 1 } }
        },
        remove: async () => { delete (docs[name] || {})[id]; return { stats: { removed: 1 } } }
      }),
      add: async ({ data }) => { const id = 'n' + Math.random(); (docs[name] = docs[name] || {})[id] = Object.assign({ _id: id }, data); return { _id: id } }
    })
  }
}

function loadFn(db) {
  return loadCjsModule(P.fn, {
    transform,
    stubs: {
      'wx-server-sdk': { init() {}, DYNAMIC_CURRENT_ENV: 'x', database: () => db, getWXContext: () => ({ OPENID: ME }) },
      './staffGuard': { assertStaff: async () => ({ ok: false }), ROLE_STAFF: 'staff' }
    },
    globals: { console: { warn() {}, log() {}, error() {} } }
  })
}

/** 一封信的三处落点：user_messages 新旧两条（同键）+ notification_logs 一条，全部未读；另一封普通已读信 */
function seed() {
  const t = 1795000000000
  return {
    user_messages: {
      um1: { _id: 'um1', _openid: ME, type: 'points_earned', relatedId: 'o1', title: '门店消费已入账', category: 'points', read: false, createTime: t, actionUrl: 'a' },
      um2: { _id: 'um2', _openid: ME, type: 'points_earned', relatedId: 'o1', title: '门店消费已入账', category: 'points', read: false, createTime: t - 1 },
      um3: { _id: 'um3', _openid: ME, type: 'booking_created', relatedId: 'b1', title: '预约已记下', category: 'booking', read: true, createTime: t - 5 }
    },
    notification_logs: {
      nl1: { _id: 'nl1', recipient: ME, channel: 'inapp', type: 'points_earned', relatedId: 'o1', title: '门店消费已入账', category: 'points', read: false, sentAt: t - 2 }
    }
  }
}

async function runChecks() {
  const fails = []
  const ok = (name, cond) => { if (!cond) fails.push(name) }

  // R1
  const db1 = memDb(seed())
  const fn1 = loadFn(db1)
  const before = await fn1.main({ action: 'getMessages', category: 'all', queue: 'customer' })
  const r1 = await fn1.main({ action: 'markAllRead', category: 'all', queue: 'customer' })
  const after = await fn1.main({ action: 'getMessages', category: 'all', queue: 'customer' })
  ok('R1 前提：三处落点合并成一封未读', before.success && before.unreadCount === 1 && before.messages.length === 2)
  ok('R1 全部已读后每一处落点都是已读（含同表的旧那条）、云端回报 0 封未读',
    r1.success === true && r1.unreadCount === 0 && ['um1', 'um2'].every((id) => db1.docs.user_messages[id].read === true) && db1.docs.notification_logs.nl1.read === true &&
    after.unreadCount === 0)

  // R2
  const db2 = memDb(seed(), { stuck: ['um1', 'um2', 'nl1'] })
  const r2 = await loadFn(db2).main({ action: 'markAllRead', category: 'all', queue: 'customer' })
  ok('R2 改不上时如实报失败与剩余未读数（不吞成「成功」）', r2.success === false && r2.unreadCount === 1 && /还有 1 封/.test(r2.msg || ''))

  // R3
  const db3 = memDb(seed())
  await loadFn(db3).main({ action: 'markRead', messageId: 'um1' })
  ok('R3 单条已读：整组落点一起标上', db3.docs.user_messages.um2.read === true && db3.docs.notification_logs.nl1.read === true)

  // R6 影子未读：旧实现留下的残留（同组另一条已读把它盖住，计数为 0）—— 全部已读也要把它清掉
  const sd = seed()
  sd.user_messages.um1.read = true
  sd.notification_logs.nl1.read = true
  const db6 = memDb(sd)
  const fn6 = loadFn(db6)
  const b6 = await fn6.main({ action: 'getMessages', category: 'all', queue: 'customer' })
  await fn6.main({ action: 'markAllRead', category: 'all', queue: 'customer' })
  ok('R6 被同组已读盖住的残留未读（影子）也在全部已读时清掉', b6.unreadCount === 0 && db6.docs.user_messages.um2.read === true)

  // R4
  const page = read(P.page)
  const at = page.indexOf('  async markAllRead() {')
  const body = at >= 0 ? page.slice(at, page.indexOf('\n  },\n', at)) : ''
  const hideAt = body.indexOf('wx.hideLoading()')
  const toastAt = body.indexOf("wx.showToast({ title: '已全部读过'")
  ok('R4 页面：先关 loading 再提示（不在 finally 里 hideLoading 吞掉提示）；未读数取云端回报；失败时重拉列表',
    hideAt > 0 && toastAt > hideAt && !/finally\s*\{\s*wx\.hideLoading\(\)/.test(body) &&
    /const left = Math\.max\(0, Number\(result\.unreadCount\) \|\| 0\)/.test(body) && /this\.loadMessages\(true, \{ silent: true \}\)/.test(body))

  // R5
  // R7 兜底强标（2026-11-25 再一次「点了仍有 1 封」）：不看分类 / 队列，按本人把两个集合的未读全扫一遍；
  // doc().update 失败再试 where(_id) 更新；只在「标记 + 重数后仍有未读」时触发。
  const src = read(P.fn)
  ok('R7 兜底强标：按本人扫两集合（不带分类 / 队列条件）、doc 失败回落 where 更新、仅在仍有未读时触发',
    /async function forceMarkUnread\(openid\)/.test(src) &&
    /const specs = \[\s*\n\s*\['user_messages', _\.and\(\[buildRecipientWhere\(openid, 'all'\)/.test(src) &&
    /db\.collection\(col\)\.where\(\{ _id: id \}\)\.update\(patch\)/.test(src) &&
    /const swept = await forceMarkUnread\(openid\)/.test(src) &&
    !/forceMarkUnread\(openid, category/.test(src))

  // R8 诊断（2026-11-25「点了毫无反应」）：点不掉时把库内原貌回给页面弹窗，便于精确定位
  const pageSrc = read(P.page)
  const diagFn = (pageSrc.match(/async diagnoseUnread\(reason\) \{[\s\S]*?\n  \},/) || [''])[0]
  ok('R8 诊断动作保留：只查本人未读、两集合都扫、返回 id/集合/类型/分类/读取字段',
    /case 'diagnoseUnread'/.test(src) && /col, id: String\(d\._id \|\| ''\)/.test(src) && /read: d\.read === true/.test(src) &&
    /async diagnoseUnread\(reason\)/.test(pageSrc) && /this\.diagnoseUnread\(failed \?/.test(pageSrc) && /if \(left > 0\) this\.diagnoseUnread/.test(pageSrc))
  ok('R8 诊断在 C 端**不弹界面**（产品负责人 2026-11-25）：只写 console.warn，不用 Modal / Toast',
    !!diagFn && /console\.warn\(/.test(diagFn) && !/openAppModal|wx\.showModal|wx\.showToast/.test(diagFn) &&
    !/封没标上/.test(pageSrc))

  ok('R5 列表响应不带内部字段', before.messages.every((m) => !('_members' in m) && !('_source' in m)))

  // R9（2026-11-25 产品负责人「优化下方交互样式」）：顾客来信行改成可点的信笺：
  // 日期变胶囊锚点、行脚与正文用虚线分开、状态变胶囊、动作变按钮（点击域从小字变成药丸）
  const wxss = read(P.wxss)
  ok('R9 顾客来信行：日期胶囊 / 行脚虚线分隔 / 状态胶囊 / 动作按钮',
    /\.queue-customer \.day-rail-t \{[^}]*border-radius: 999rpx;/.test(wxss) &&
    /\.queue-customer \.message-item[^{]*\.message-foot \{[^}]*border-top: 1rpx dashed/.test(wxss) &&
    /\.queue-customer \.status-chip \{[^}]*border-radius: 999rpx;/.test(wxss) &&
    /\.queue-customer \.action-hint\.is-go \{[^}]*border-radius: 999rpx;/.test(wxss))
  // R10（2026-11-25 第三轮）：「山海」水印沉在纸里、正文抬一层 —— 否则水印压住状态与按钮
  const P3 = '.queue-customer .message-item:not(.workflow-card):not(.digest-card)'
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  ok('R10 纸笺水印在正文之下（正文 z-index:1、水印 z-index:0）',
    new RegExp(esc(P3 + ' .message-body') + '[^{]*\\{[^}]*z-index: 1;').test(wxss) &&
    new RegExp(esc(P3 + '::after') + ' \\{[^}]*z-index: 0;').test(wxss))
  return fails
}

const INJECTIONS = [
  { name: '合并只记两个 id', file: P.fn, find: '    _members: [].concat(prev._members || [], item._members || [])\n      .filter((m, i, arr) => m && m.id && arr.findIndex((x) => x && x.col === m.col && x.id === m.id) === i)\n', replace: '    _members: (primary._members || []).slice(0, 1)\n' },
  { name: '诊断又弹窗', file: P.page, find: "console.warn('[inbox] 未读诊断'", replace: "openAppModal({ title: '还有', content: 'x' }); console.warn('[inbox] 未读诊断'" },
  { name: '诊断不查库', file: P.fn, find: "case 'diagnoseUnread': {", replace: 'case \'diagnoseUnreadX\': {' },
  { name: '兜底不扫', file: P.fn, find: 'const swept = await forceMarkUnread(openid', replace: 'const swept = 0; void (openid' },
  { name: '改不上也报成功', file: P.fn, find: "    return { success: false, msg: `还有 ${left.length} 封没标上，已记录，稍后再试`, unreadCount: left.length, updated: r.updated }", replace: "    return { success: true, msg: '全部标记成功', unreadCount: 0 }" },
  { name: '单条已读不带整组', file: P.fn, find: '      if (group && group._members && group._members.length > 1) await markMembersRead(group._members)\n', replace: '' },
  { name: '提示又被 hideLoading 吞掉', file: P.page, find: "    wx.hideLoading();\n    this._markingAll = false;\n", replace: "    this._markingAll = false;\n" },
  { name: '全部已读不扫影子', file: P.fn, find: '  const ghosts = await loadUnreadMembers(openid, category, typeFilter, requestedQueue)', replace: '  const ghosts = []' },
  { name: '来信行脚又贴回正文（没有虚线分隔）', file: P.wxss, find: 'border-top: 1rpx dashed rgba(138, 117, 48, 0.32);', replace: 'border-top: 0;' },
  { name: '水印又压在按钮上', file: P.wxss, find: '  position: relative;\n  z-index: 1;\n}\n.queue-customer .message-item:not(.workflow-card):not(.digest-card)::after {\n  z-index: 0;', replace: '  position: relative;\n}\n.queue-customer .message-item:not(.workflow-card):not(.digest-card)::after {\n  z-index: 2;' },
  { name: '内部字段漏到前端', file: P.fn, find: '  const { _source, _members, ...rest } = msg', replace: '  const { _source, ...rest } = msg' }
]

if (process.argv.includes('--selftest')) {
  const base = await runChecks()
  if (base.length) { console.error('✗ 自检前提：真源须先通过\n  - ' + base.join('\n  - ')); process.exit(1) }
  let bad = 0
  for (const inj of INJECTIONS) {
    INJECT = inj
    let res
    try { res = await runChecks() } catch (e) { res = ['抛错：' + e.message] }
    INJECT = null
    if (res.length && /注入锚点失效/.test(res[0])) { bad++; console.log(`✗ 注入「${inj.name}」→ 锚点失效（注入未发生）`) }
    else if (res.length) console.log(`✓ 注入「${inj.name}」→ 检出（${res[0]}）`)
    else { bad++; console.log(`✗ 注入「${inj.name}」→ 未检出`) }
  }
  if (bad) { console.error(`✗ 自检失败：${bad} 条注入未检出 / 锚点失效`); process.exit(1) }
  console.log(`✓ 自检通过：${INJECTIONS.length} 条注入全部检出（内存副本，不写盘）`)
} else {
  const fails = await runChecks()
  if (fails.length) { console.error('✗ test:inbox-mark-read 失败：\n  - ' + fails.join('\n  - ')); process.exit(1) }
  console.log('✓ test:inbox-mark-read：全部已读每处落点都落库 / 改不上如实报 / 单条整组 / 页面提示不被吞')
}
