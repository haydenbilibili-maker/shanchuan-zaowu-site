#!/usr/bin/env node
/**
 * test:secure-data-read —— 敏感集合只读网关（secureDataRead）行为测试
 *
 * 覆盖：
 *   1. 脱敏策略：C 端表手机号/地址/联系人姓名脱敏；商品名/门店名/工单正文不误伤；
 *      PLAIN 表原样；密钥字段一律剔除；reveal 返回原值
 *   2. 查询条件：真实 @cloudbase/database 的 QueryCommand / LogicCommand / RegExp / Date
 *      经 ERP 端 whereToWire 序列化 → 云函数 decodeWhere 还原，语义一致；非法字段名/操作被拒
 *   3. 两端集合清单一致：admin cloudbaseCdnDb.js PROXY_READ_COLLECTIONS ≡ policy.js COLLECTION_POLICY
 *   4. 函数入口：ERP 动作要求超管、MP 动作要求店长、白名单外集合被拒（内存 mock wx-server-sdk）
 *
 * --selftest：对 policy.js / 清单文本做内存注入（不写盘），每个注入都必须被检出。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Module, { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const FN_DIR = resolve(ROOT, 'miniprogram/cloudfunctions/secureDataRead')
const POLICY_PATH = resolve(FN_DIR, 'policy.js')
const INDEX_PATH = resolve(FN_DIR, 'index.js')
const CLIENT_PATH = resolve(ROOT, 'admin/src/utils/cloudbaseCdnDb.js')
const require = createRequire(import.meta.url)

function loadCjsFromSource(filename, source, stubs = {}) {
  const m = new Module(filename)
  m.filename = filename
  m.paths = Module._nodeModulePaths(dirname(filename))
  const origRequire = m.require.bind(m)
  m.require = (id) => (Object.prototype.hasOwnProperty.call(stubs, id) ? stubs[id] : origRequire(id))
  m._compile(source, filename)
  return m.exports
}

function makeAsserter() {
  const failures = []
  let pass = 0
  return {
    ok(name, cond, detail) {
      if (cond) pass += 1
      else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    },
    eq(name, actual, expected) {
      const a = JSON.stringify(actual)
      const e = JSON.stringify(expected)
      if (a === e) pass += 1
      else failures.push(`${name} — 期望 ${e}，实际 ${a}`)
    },
    get failures() { return failures },
    get pass() { return pass },
  }
}

function setOf(text, re) {
  const m = text.match(re)
  if (!m) return null
  return new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]))
}

function listsConsistent(clientText, policyText) {
  const client = setOf(clientText, /PROXY_READ_COLLECTIONS = new Set\(\[([\s\S]*?)\]\)/)
  const pol = policyText.match(/const COLLECTION_POLICY = \{([\s\S]*?)\n\}/)
  if (!client || !pol) return { ok: false, detail: '找不到清单定义' }
  const server = new Set([...pol[1].matchAll(/^\s*([a-z_]+):/gm)].map((x) => x[1]))
  const onlyClient = [...client].filter((c) => !server.has(c))
  const onlyServer = [...server].filter((c) => !client.has(c))
  return {
    ok: !onlyClient.length && !onlyServer.length,
    detail: `仅客户端：${onlyClient.join(',') || '-'}；仅云函数：${onlyServer.join(',') || '-'}`,
  }
}

/** 最小 wx-server-sdk mock：记录查询，按 staffGuard 需要返回数据 */
function makeSdkMock({ staff = null } = {}) {
  const { Command } = require('@cloudbase/database/dist/commonjs/command')
  const calls = []
  function coll(name) {
    const state = { name, where: null }
    const api = {
      where(w) { state.where = w; return api },
      orderBy() { return api },
      skip() { return api },
      limit() { return api },
      field() { return api },
      doc() { return { get: async () => { throw new Error('not found') } } },
      async get() {
        calls.push({ op: 'get', ...state })
        if (name === 'staff_members') return { data: staff ? [staff] : [] }
        if (name === 'orders') return { data: [{ _id: 'o1', address: { name: '张三', phone: '13812345678', detail: '某某路 100 号 3 栋' }, createTime: new Date(0) }] }
        return { data: [] }
      },
      async count() { calls.push({ op: 'count', ...state }); return { total: 7 } },
      async add() { calls.push({ op: 'add', ...state }); return { _id: 'log1' } },
    }
    return api
  }
  const db = { command: Command, collection: coll, RegExp: (o) => ({ $regex: o.regexp, $options: o.options }) }
  let ctx = { OPENID: '' }
  return {
    calls,
    setOpenid(o) { ctx = { OPENID: o } },
    sdk: {
      init() {},
      DYNAMIC_CURRENT_ENV: 'x',
      database: () => db,
      getWXContext: () => ctx,
    },
  }
}

async function runChecks(policySource, clientText, policyText, indexSource) {
  const t = makeAsserter()
  const policy = loadCjsFromSource(POLICY_PATH, policySource)
  const client = await import(CLIENT_PATH)

  // 1. 脱敏
  const order = {
    _id: 'o1',
    _openid: 'oa_user',
    address: { name: '张三', phone: '13812345678', province: '浙江省', detail: '西湖区某某路 100 号 3 栋' },
    products: [{ title: '蓝闪蝶标本', name: '蓝闪蝶', detail: '单只装裱' }],
    storeName: '山海造物',
    giftMeta: { receiverOpenid: 'oa_r', receiverPhone: '13900001111' },
    token: 'SECRET',
  }
  const m = policy.sanitizeDoc('orders', order)
  t.eq('订单手机号脱敏', m.address.phone, '138****5678')
  t.ok('订单收货人姓名脱敏', m.address.name !== '张三' && m.address.name.startsWith('张'), m.address.name)
  t.ok('订单地址明细脱敏', m.address.detail !== order.address.detail && m.address.detail.includes('****'), m.address.detail)
  t.eq('省份保留', m.address.province, '浙江省')
  t.eq('商品名不误伤', m.products[0].name, '蓝闪蝶')
  t.eq('商品 detail 不误伤（不在地址容器内）', m.products[0].detail, '单只装裱')
  t.eq('门店名不误伤', m.storeName, '山海造物')
  t.eq('openid 保留（ERP 关联用）', m._openid, 'oa_user')
  t.eq('受礼人手机号脱敏', m.giftMeta.receiverPhone, '139****1111')
  t.ok('密钥字段剔除', !('token' in m))
  t.ok('脱敏值带 ** 标记（ERP 写回前据此剔除）', client.isMaskedPii(m.address.phone) && client.isMaskedPii(m.address.name))

  const ticket = policy.sanitizeDoc('support_tickets', { detail: '收到的标本翅膀破损', contactPhone: '13800000000' })
  t.eq('工单正文不误伤', ticket.detail, '收到的标本翅膀破损')
  t.eq('工单联系电话脱敏', ticket.contactPhone, '138****0000')

  const booking = policy.sanitizeDoc('bookings', { name: '李四', phone: '13711112222', title: '标本课' })
  t.ok('预约顶层姓名脱敏', booking.name.startsWith('李') && booking.name !== '李四', booking.name)
  const product = policy.sanitizeDoc('finance_records', { name: '房租', amount: 100, phone: '13800000000' })
  t.eq('PLAIN 表 name 原样', product.name, '房租')
  t.eq('PLAIN 表手机号原样', product.phone, '13800000000')
  const admin = policy.sanitizeDoc('admin_users', { username: 'a', passwordHash: 'x', password: 'y', role: 'r' })
  t.ok('账号表剔除密码字段', !('passwordHash' in admin) && !('password' in admin) && admin.username === 'a')
  const intent = policy.sanitizeDoc('purchase_intents', { contactName: '王五', contactPhone: '13600000000' })
  t.eq('B2B 线索不脱敏（需回电 / 转单写入原值）', intent.contactPhone, '13600000000')

  const revealed = policy.sanitizeDoc('orders', order, { reveal: true })
  t.eq('reveal 返回原手机号', revealed.address.phone, '13812345678')
  t.ok('reveal 仍剔除密钥', !('token' in revealed))

  const enc = policy.encodeOut({ t: new Date(5), n: [new Date(6)] })
  t.eq('Date 编码为 {$date}', enc, { t: { $date: 5 }, n: [{ $date: 6 }] })
  const dec = client.wireToValue(enc)
  t.ok('ERP 端还原 Date', dec.t instanceof Date && dec.t.getTime() === 5 && dec.n[0] instanceof Date)

  // 2. 查询条件往返
  const { Command: _ } = require('@cloudbase/database/dist/commonjs/command')
  const { RegExp: SdkRegExp } = require('@cloudbase/database/dist/commonjs/regexp')
  const deps = { command: _, RegExp: (o) => new SdkRegExp(o) }
  const where = {
    status: _.in(['paid', 'shipped']),
    timestamp: _.gte(1).and(_.lte(9)),
    createTime: _.gt(new Date(100)),
    username: new SdkRegExp({ regexp: 'ab', options: 'i' }),
    walletRefundPendingReconcile: _.exists(true),
    source: _.neq('exchange'),
    _openid: 'oa_x',
  }
  const round = policy.decodeWhere(JSON.parse(JSON.stringify(client.whereToWire(where))), deps)
  t.eq('in 往返', JSON.stringify(round.status), JSON.stringify(where.status))
  t.eq('and(gte,lte) 往返', JSON.stringify(round.timestamp), JSON.stringify(where.timestamp))
  t.ok('Date 条件往返为 Date', round.createTime.operands[0] instanceof Date && round.createTime.operands[0].getTime() === 100)
  t.eq('RegExp 往返', JSON.stringify(round.username), JSON.stringify(where.username))
  t.eq('exists 往返', JSON.stringify(round.walletRefundPendingReconcile), JSON.stringify(where.walletRefundPendingReconcile))
  t.eq('neq 往返', JSON.stringify(round.source), JSON.stringify(where.source))
  t.eq('相等往返', round._openid, 'oa_x')

  const emptyRe = policy.decodeWhere({ username: { $regex: '', $options: 'i' }, status: 'ok' }, deps)
  t.eq('空正则视为不筛选（线上 SDK 拒绝空串）', Object.keys(emptyRe), ['status'])

  const rejects = (name, w) => {
    try { policy.decodeWhere(w, deps); t.ok(name, false, '未被拒') } catch (e) { t.ok(name, e.code === 'BAD_INPUT', e.message) }
  }
  rejects('拒绝 $ 开头字段名', { $where: 'x' })
  rejects('拒绝未知操作', { a: { $op: 'expr', $args: [1] } })
  rejects('拒绝超长正则', { a: { $regex: 'x'.repeat(65) } })
  rejects('拒绝超长 in', { a: { $op: 'in', $args: new Array(201).fill(1) } })

  // 3. 两端清单一致
  const lc = listsConsistent(clientText, policyText)
  t.ok('ERP PROXY_READ_COLLECTIONS ≡ 云函数 COLLECTION_POLICY', lc.ok, lc.detail)

  // 4. 函数入口鉴权
  const staffGuardSrc = readFileSync(resolve(FN_DIR, 'staffGuard.js'), 'utf8')
  const run = async (event, { openid = '', staff = null } = {}) => {
    const mock = makeSdkMock({ staff })
    mock.setOpenid(openid)
    const guard = loadCjsFromSource(resolve(FN_DIR, 'staffGuard.js'), staffGuardSrc, { 'wx-server-sdk': mock.sdk })
    const fn = loadCjsFromSource(INDEX_PATH, indexSource, {
      'wx-server-sdk': mock.sdk,
      './staffGuard': guard,
      './policy': policy,
    })
    return { res: await fn.main(event), calls: mock.calls }
  }
  process.env.ADMIN_OPS_KEY = 'k-test'
  const manager = { _id: 's1', openid: 'oa_mgr', status: 'active', roles: ['manager'] }
  const staffOnly = { _id: 's2', openid: 'oa_staff', status: 'active', roles: ['staff'] }

  let r = await run({ action: 'query', collection: 'orders' }, { openid: 'oa_mgr', staff: manager })
  t.ok('店长不可调 ERP query', r.res.success === false && !r.calls.some((c) => c.name === 'orders'), JSON.stringify(r.res))
  r = await run({ action: 'query', collection: 'orders', adminOpsKey: 'wrong' })
  t.ok('错误 adminOpsKey 被拒', r.res.success === false)
  r = await run({ action: 'query', collection: 'users', adminOpsKey: 'k-test' })
  t.ok('白名单外集合被拒', r.res.success === false && r.res.code === 'COLLECTION_NOT_ALLOWED')
  r = await run({ action: 'query', collection: 'orders', adminOpsKey: 'k-test' })
  t.ok('超管 query 成功且已脱敏', r.res.success === true && r.res.list[0].address.phone === '138****5678', JSON.stringify(r.res))
  t.ok('Date 以 {$date} 返回', r.res.success && r.res.list[0].createTime && r.res.list[0].createTime.$date === 0)
  r = await run({ action: 'get', collection: 'orders', ids: ['o1'], reveal: true, adminOpsKey: 'k-test' })
  t.ok('reveal 先写审计日志', r.calls.some((c) => c.op === 'add' && c.name === 'admin_operation_logs'))
  t.ok('reveal 返回原值', r.res.success && r.res.list[0].address.phone === '13812345678')
  r = await run({ action: 'mpOrderStatusCounts' }, { openid: 'oa_staff', staff: staffOnly })
  t.ok('店员不可调店长统计', r.res.success === false)
  r = await run({ action: 'mpOrderStatusCounts' }, { openid: 'oa_mgr', staff: manager })
  t.ok('店长统计成功', r.res.success === true && r.res.counts.shipped === 7, JSON.stringify(r.res))
  r = await run({ action: 'mpOrderStatusCounts' })
  t.ok('未登录被拒', r.res.success === false && r.res.code === 'UNAUTHORIZED')

  return t
}

function report(t, label) {
  if (t.failures.length) {
    console.error(`✗ ${label}：${t.failures.length} 项失败（通过 ${t.pass}）`)
    t.failures.forEach((f) => console.error(`  - ${f}`))
    return false
  }
  console.log(`✓ ${label}：${t.pass} 项通过`)
  return true
}

const policySrc = readFileSync(POLICY_PATH, 'utf8')
const clientSrc = readFileSync(CLIENT_PATH, 'utf8')
const indexSrc = readFileSync(INDEX_PATH, 'utf8')

if (process.argv.includes('--selftest')) {
  const injections = [
    ['手机号不再脱敏', { policy: (s) => s.replace("if (PHONE_KEY.test(key)) { out[key] = maskPhone(v); continue }", '') }],
    ['商品 name 被误脱敏', { policy: (s) => s.replace("if (key === 'name' && (inContainer || (depth === 0 && ctx.topLevelPersonName)))", "if (key === 'name')") }],
    ['密钥字段不再剔除', { policy: (s) => s.replace('if (SECRET_KEY.test(key)) continue', '') }],
    ['reveal 失效（永远脱敏）', { policy: (s) => s.replace('mask: policy === MASK && !reveal', 'mask: policy === MASK') }],
    ['字段名校验被放开', { policy: (s) => s.replace("if (!FIELD_RE.test(k)) throw badInput(`非法字段名：${k}`)", '') }],
    ['orders 移出云函数白名单', { policy: (s) => s.replace('  orders: MASK,\n', '') }],
    ['ERP 清单漏登记一张表', { client: (s) => s.replace("  'daily_revenues',\n", '') }],
    ['ERP 动作降级为店长可调', { index: (s) => s.replace('{ adminOpsKey, requireSuperAdmin: true }', '{ adminOpsKey, role: ROLE_MANAGER }') }],
    ['reveal 不写审计', { index: (s) => s.replace("await db.collection('admin_operation_logs').add(", 'await (async () => ({}))(') }],
  ]
  let allCaught = true
  for (const [name, inj] of injections) {
    const p = inj.policy ? inj.policy(policySrc) : policySrc
    const c = inj.client ? inj.client(clientSrc) : clientSrc
    const i = inj.index ? inj.index(indexSrc) : indexSrc
    if (p === policySrc && c === clientSrc && i === indexSrc) {
      console.error(`✗ 自检注入「${name}」未命中源码（锚点失效）`)
      allCaught = false
      continue
    }
    let caught = false
    try {
      const t = await runChecks(p, c, p, i)
      caught = t.failures.length > 0
    } catch (e) {
      caught = true
    }
    console.log(`${caught ? '✓' : '✗'} 自检注入「${name}」${caught ? '已检出' : '未检出'}`)
    if (!caught) allCaught = false
  }
  process.exit(allCaught ? 0 : 1)
} else {
  const t = await runChecks(policySrc, clientSrc, policySrc, indexSrc)
  process.exit(report(t, 'test:secure-data-read') ? 0 : 1)
}
