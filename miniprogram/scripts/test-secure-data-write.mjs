#!/usr/bin/env node
/**
 * test:secure-data-write —— 敏感集合写网关（secureDataWrite）行为测试
 *
 * 覆盖：
 *   1. 写入策略：集合 / 动作白名单（admin_users、admin_roles、finance_settings、store_ledger、
 *      purchase_orders、price_list_items 一律不收）；字段白名单；$ 操作符与非法字段名被拒；
 *      _openid 剔除；PII 表不得写回脱敏值；Date 经 {$date} 往返
 *   2. ERP 端 dataToWire：Date 编码、SDK 操作符（db.command）直接报错、undefined 丢弃
 *   3. 两端集合清单一致：admin cloudbaseCdnDb.js PROXY_WRITE_COLLECTIONS ≡ policy.js WRITE_POLICY
 *   4. 函数入口（内存 mock wx-server-sdk + 真 staffGuard）：仅超管；动作不允许零写入；
 *      先审计后写、审计失败即拒绝；目标文档不存在时不写审计也不写库
 *
 * --selftest：对 policy.js / index.js / 清单文本做内存注入（不写盘），每个注入都必须被检出。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Module, { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const FN_DIR = resolve(ROOT, 'miniprogram/cloudfunctions/secureDataWrite')
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

/** 用 data: URL 从源码文本加载 ERP 端模块（注入用例改的是内存文本，不写盘） */
async function importClient(source) {
  const shimmed = source
    .replaceAll('import.meta.env', '({ BASE_URL: "/" })')
    .replace("from '../utils/safeStorage.js'", `from '${new URL('../../admin/src/utils/safeStorage.js', import.meta.url).href}'`)
  return import(`data:text/javascript;base64,${Buffer.from(shimmed).toString('base64')}`)
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

function listsConsistent(clientText, policyText) {
  const cm = clientText.match(/PROXY_WRITE_COLLECTIONS = new Set\(\[([\s\S]*?)\]\)/)
  const pm = policyText.match(/const WRITE_POLICY = \{([\s\S]*?)\n\}/)
  if (!cm || !pm) return { ok: false, detail: '找不到清单定义' }
  const client = new Set([...cm[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]))
  const server = new Set([...pm[1].matchAll(/^ {2}([a-z_]+):/gm)].map((x) => x[1]))
  const onlyClient = [...client].filter((c) => !server.has(c))
  const onlyServer = [...server].filter((c) => !client.has(c))
  return {
    ok: !onlyClient.length && !onlyServer.length,
    detail: `仅客户端：${onlyClient.join(',') || '-'}；仅云函数：${onlyServer.join(',') || '-'}`,
  }
}

/** 最小 wx-server-sdk mock：existing 为「集合 → 已存在的 _id 集合」；auditFails 模拟审计写失败 */
function makeSdkMock({ staff = null, existing = {}, auditFails = false } = {}) {
  const calls = []
  function coll(name) {
    const state = { name, where: null }
    const api = {
      where(w) { state.where = w; return api },
      field() { return api },
      limit() { return api },
      async get() {
        calls.push({ op: 'get', ...state })
        if (name === 'staff_members') return { data: staff ? [staff] : [] }
        const id = state.where && state.where._id
        return { data: id && (existing[name] || []).includes(id) ? [{ _id: id }] : [] }
      },
      async add({ data }) {
        calls.push({ op: 'add', name, data })
        if (name === 'admin_operation_logs' && auditFails) throw new Error('audit down')
        return { _id: data._id || 'new1' }
      },
      doc(id) {
        return {
          async update({ data }) { calls.push({ op: 'update', name, id, data }); return { stats: { updated: 1 } } },
          async remove() { calls.push({ op: 'remove', name, id }); return { stats: { removed: 1 } } },
          async get() { throw new Error('not used') },
        }
      },
    }
    return api
  }
  let ctx = { OPENID: '' }
  return {
    calls,
    setOpenid(o) { ctx = { OPENID: o } },
    sdk: {
      init() {},
      DYNAMIC_CURRENT_ENV: 'x',
      database: () => ({ collection: coll, command: {}, serverDate: () => new Date() }),
      getWXContext: () => ctx,
    },
  }
}

async function runChecks(policySource, clientSource, indexSource) {
  const t = makeAsserter()
  const policy = loadCjsFromSource(POLICY_PATH, policySource)
  const client = await importClient(clientSource)
  const rejects = (name, fn, code = 'BAD_INPUT') => {
    try { fn(); t.ok(name, false, '未被拒') } catch (e) { t.ok(name, e.code === code, e.message) }
  }

  // 1. 策略
  for (const c of ['admin_users', 'admin_roles', 'finance_settings', 'store_ledger', 'purchase_orders', 'price_list_items', 'orders', 'users']) {
    t.ok(`不收 ${c}`, !policy.isAllowedCollection(c))
  }
  t.ok('finance_records 只许 remove', policy.isOpAllowed('finance_records', 'remove') && !policy.isOpAllowed('finance_records', 'add') && !policy.isOpAllowed('finance_records', 'update'))
  t.ok('stock_movements 只许追加', policy.isOpAllowed('stock_movements', 'add') && !policy.isOpAllowed('stock_movements', 'update') && !policy.isOpAllowed('stock_movements', 'remove'))
  t.ok('purchase_intents 不许新增（官网表单直写 create）', !policy.isOpAllowed('purchase_intents', 'add'))
  t.ok('products 只许 update（入档 / 删除走 manageProducts）', policy.isOpAllowed('products', 'update') && !policy.isOpAllowed('products', 'add') && !policy.isOpAllowed('products', 'remove'))
  t.eq('products 库存写入放行（B2B 出货 / 飞书对齐 / 财务同步）', policy.prepareData('products', 'update', { skus: [{ stock: 1 }], stock: 1, soldCount: 2, updateTime: 1 }).fields, ['skus', 'stock', 'soldCount', 'updateTime'])
  rejects('products 不许改价（走 manageProducts.patch）', () => policy.prepareData('products', 'update', { price: 1 }))
  rejects('products 不许上下架（走 manageApprovals）', () => policy.prepareData('products', 'update', { isOffShelf: true }))
  t.ok('notification_templates 不进写网关（无写入方，已 write:false）', !policy.isAllowedCollection('notification_templates'))

  const p = policy.prepareData('stores', 'add', { name: '山川', _openid: 'oa_x', updatedAt: { $date: 5 }, zones: [{ at: { $date: 6 } }] })
  t.ok('_openid 剔除', !('_openid' in p.data))
  t.ok('{$date} 还原为 Date（含嵌套数组）', p.data.updatedAt instanceof Date && p.data.updatedAt.getTime() === 5 && p.data.zones[0].at instanceof Date)
  t.eq('返回写入字段', p.fields.sort(), ['name', 'updatedAt', 'zones'])
  t.eq('add 可带 _id（cdnUpsertDoc 语义）', policy.prepareData('stores', 'add', { _id: 'store_a', name: 'x' }).id, 'store_a')
  rejects('update 不得改 _id', () => policy.prepareData('stores', 'update', { _id: 'b', name: 'x' }))
  rejects('拒绝 $ 操作符键', () => policy.prepareData('stores', 'update', { $set: { a: 1 } }))
  rejects('拒绝嵌套操作符', () => policy.prepareData('stores', 'update', { stock: { $inc: 1 } }))
  rejects('拒绝非法字段名', () => policy.prepareData('stores', 'update', { 'a-b': 1 }))
  rejects('拒绝 __proto__', () => policy.prepareData('stores', 'update', JSON.parse('{"__proto__x":1}')))
  rejects('点路径只用于 update', () => policy.prepareData('stores', 'add', { 'a.b': 1 }))
  t.ok('update 可用点路径', policy.prepareData('stores', 'update', { 'hours.open': '10:00' }).fields[0] === 'hours.open')
  rejects('候补单只许改状态类字段', () => policy.prepareData('waitlist', 'update', { phone: '13800000000' }))
  t.eq('候补单改状态', policy.prepareData('waitlist', 'update', { status: 'notified', notifiedAt: 1 }).fields, ['status', 'notifiedAt'])
  rejects('采购意向不许改联系人', () => policy.prepareData('purchase_intents', 'update', { contactPhone: '1' }))
  rejects('退款单拒绝写回脱敏手机号', () => policy.prepareData('refunds', 'add', { orderId: 'o1', contactPhone: '138****5678' }))
  rejects('退款单拒绝写回脱敏姓名（嵌套）', () => policy.prepareData('refunds', 'update', { contact: { userName: '张**' } }))
  t.ok('退款单写空联系人放行', policy.prepareData('refunds', 'add', { orderId: 'o1', contactPhone: '', userName: '' }).fields.length === 3)
  t.ok('非 PII 表含 ** 的文案放行', policy.prepareData('home_configs', 'update', { title: '**限时**' }).fields[0] === 'title')
  rejects('拒绝超大数据', () => policy.prepareData('home_configs', 'add', { blob: 'x'.repeat(300 * 1024) }))
  rejects('拒绝空 data', () => policy.prepareData('stores', 'update', { _openid: 'x' }))
  rejects('拒绝非法 id', () => policy.normalizeId('a/b'))

  // 2. ERP 端编码
  const { Command: _ } = require('@cloudbase/database/dist/commonjs/command')
  t.eq('dataToWire Date', client.dataToWire({ a: new Date(7), b: [new Date(8)], c: undefined, d: 'x' }), { a: { $date: 7 }, b: [{ $date: 8 }], d: 'x' })
  let threw = false
  try { client.dataToWire({ stock: _.inc(1) }) } catch { threw = true }
  t.ok('dataToWire 遇 db.command 直接报错（不能静默丢）', threw)
  const round = policy.prepareData('home_configs', 'update', JSON.parse(JSON.stringify(client.dataToWire({ updatedAt: new Date(9) }))))
  t.ok('ERP → 云函数 Date 往返', round.data.updatedAt instanceof Date && round.data.updatedAt.getTime() === 9)

  // 3. 两端清单一致
  const lc = listsConsistent(clientSource, policySource)
  t.ok('ERP PROXY_WRITE_COLLECTIONS ≡ 云函数 WRITE_POLICY', lc.ok, lc.detail)

  // 4. 函数入口
  const staffGuardSrc = readFileSync(resolve(FN_DIR, 'staffGuard.js'), 'utf8')
  const run = async (event, opts = {}) => {
    const mock = makeSdkMock(opts)
    mock.setOpenid(opts.openid || '')
    const guard = loadCjsFromSource(resolve(FN_DIR, 'staffGuard.js'), staffGuardSrc, { 'wx-server-sdk': mock.sdk })
    const fn = loadCjsFromSource(INDEX_PATH, indexSource, { 'wx-server-sdk': mock.sdk, './staffGuard': guard, './policy': policy })
    return { res: await fn.main(event), calls: mock.calls }
  }
  const writes = (calls) => calls.filter((c) => c.op !== 'get' && c.name !== 'admin_operation_logs')
  const audits = (calls) => calls.filter((c) => c.op === 'add' && c.name === 'admin_operation_logs')
  process.env.ADMIN_OPS_KEY = 'k-test'
  const K = 'k-test'
  const manager = { _id: 's1', openid: 'oa_mgr', status: 'active', roles: ['manager'] }
  const existing = { stores: ['st1'], refunds: ['rf1'], finance_records: ['fr1'] }

  let r = await run({ action: 'update', collection: 'stores', id: 'st1', data: { name: 'x' } }, { openid: 'oa_mgr', staff: manager, existing })
  t.ok('店长不可写（仅超管）', r.res.success === false && !writes(r.calls).length, JSON.stringify(r.res))
  r = await run({ action: 'update', collection: 'stores', id: 'st1', data: { name: 'x' } })
  t.ok('未登录被拒', r.res.success === false && r.res.code === 'UNAUTHORIZED')
  r = await run({ action: 'update', collection: 'stores', id: 'st1', data: { name: 'x' }, adminOpsKey: 'wrong' }, { existing })
  t.ok('错误 adminOpsKey 被拒', r.res.success === false && !writes(r.calls).length)
  r = await run({ action: 'update', collection: 'admin_users', id: 'u1', data: { role: 'super' }, adminOpsKey: K })
  t.ok('admin_users 被拒且零写入', r.res.code === 'COLLECTION_NOT_ALLOWED' && !writes(r.calls).length && !audits(r.calls).length)
  r = await run({ action: 'update', collection: 'finance_records', id: 'fr1', data: { revenue: 1 }, adminOpsKey: K }, { existing })
  t.ok('不允许的动作被拒且零写入', r.res.code === 'ACTION_DENIED' && !writes(r.calls).length)
  r = await run({ action: 'drop', collection: 'stores', adminOpsKey: K })
  t.ok('未知动作被拒', r.res.code === 'UNKNOWN_ACTION')
  r = await run({ action: 'update', collection: 'stores', id: 'st1', data: { $set: 1 }, adminOpsKey: K }, { existing })
  t.ok('非法数据被拒且零写入', r.res.code === 'BAD_INPUT' && !writes(r.calls).length)

  r = await run({ action: 'update', collection: 'stores', id: 'st1', data: { name: '新名' }, adminOpsKey: K }, { existing })
  const ai = r.calls.findIndex((c) => c.name === 'admin_operation_logs')
  const wi = r.calls.findIndex((c) => c.op === 'update')
  t.ok('超管 update 成功', r.res.success === true && r.res.updated === 1, JSON.stringify(r.res))
  t.ok('先审计后写', ai !== -1 && wi !== -1 && ai < wi, `audit@${ai} write@${wi}`)
  t.eq('审计记录集合 / 文档 / 字段', audits(r.calls)[0] && [audits(r.calls)[0].data.collection, audits(r.calls)[0].data.docId, audits(r.calls)[0].data.fields], ['stores', 'st1', ['name']])

  r = await run({ action: 'update', collection: 'stores', id: 'ghost', data: { name: 'x' }, adminOpsKey: K }, { existing })
  t.ok('目标不存在：返回 0、不写审计、不写库', r.res.success === true && r.res.updated === 0 && !audits(r.calls).length && !writes(r.calls).length, JSON.stringify(r.res))
  r = await run({ action: 'remove', collection: 'finance_records', id: 'ghost', adminOpsKey: K }, { existing })
  t.ok('删除不存在的文档：返回 0、零写入', r.res.deleted === 0 && !audits(r.calls).length && !writes(r.calls).length)
  r = await run({ action: 'update', collection: 'stores', id: 'st1', data: { name: 'x' }, adminOpsKey: K }, { existing, auditFails: true })
  t.ok('审计写失败 → 拒绝且不写库', r.res.code === 'AUDIT_FAILED' && !writes(r.calls).length, JSON.stringify(r.res))
  r = await run({ action: 'add', collection: 'refunds', data: { orderId: 'o1', status: 'pending', _openid: 'oa_c' }, adminOpsKey: K })
  const added = writes(r.calls)[0]
  t.ok('超管 add 成功并返回 id', r.res.success === true && r.res.id === 'new1' && r.res._id === 'new1', JSON.stringify(r.res))
  t.ok('add 前已审计、写入不含 _openid', audits(r.calls).length === 1 && added && !('_openid' in added.data))
  r = await run({ action: 'remove', collection: 'finance_records', id: 'fr1', adminOpsKey: K }, { existing })
  t.ok('超管 remove 成功', r.res.success === true && r.res.deleted === 1 && audits(r.calls).length === 1)

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
    ['字段白名单失效', { policy: (s) => s.replace('if (allow && !allow.has(root)) throw', 'if (false) throw') }],
    ['PII 表允许写回脱敏值', { policy: (s) => s.replace('if (hit) throw badInput(`字段 ${hit} 是脱敏值', 'if (false) throw badInput(`字段 ${hit} 是脱敏值') }],
    ['放行 $ 操作符', { policy: (s) => s.replace("if (k.charAt(0) === '$') throw", "if (false) throw") }],
    ['admin_users 进写白名单', { policy: (s) => s.replace("  refunds: { ops: ['add', 'update'], pii: true },", "  refunds: { ops: ['add', 'update'], pii: true },\n  admin_users: { ops: ['add', 'update', 'remove'] },") }],
    ['_openid 不再剔除', { policy: (s) => s.replace('const STRIP_KEYS = { _openid: 1 }', 'const STRIP_KEYS = {}') }],
    ['降级为店长可写', { index: (s) => s.replace('{ adminOpsKey, requireSuperAdmin: true }', "{ adminOpsKey, role: 'manager' }") }],
    ['动作门禁被删', { index: (s) => s.replace('if (!policy.isOpAllowed(collection, action)) {', 'if (false) {') }],
    ['审计失败仍写库', { index: (s) => s.replace("return fail('AUDIT_FAILED'", "return run() || fail('AUDIT_FAILED'") }],
    ['不再先查存在性', { index: (s) => s.replace('if (!(await docExists(collection, id))) return { success: true, id, updated: 0 }', '') }],
    ['ERP 写清单漏一张表', { client: (s) => s.replace("  'home_configs',\n  'pet_craft_configs',\n  'feishu_inventory',", "  'pet_craft_configs',\n  'feishu_inventory',") }],
    ['dataToWire 放过 db.command', { client: (s) => s.replace("throw new Error('写网关不支持数据库操作符", "return value; throw new Error('写网关不支持数据库操作符") }],
  ]
  let allCaught = true
  for (const [name, inj] of injections) {
    const pSrc = inj.policy ? inj.policy(policySrc) : policySrc
    const cSrc = inj.client ? inj.client(clientSrc) : clientSrc
    const iSrc = inj.index ? inj.index(indexSrc) : indexSrc
    if (pSrc === policySrc && cSrc === clientSrc && iSrc === indexSrc) {
      console.error(`✗ 自检注入「${name}」未命中源码（锚点失效）`)
      allCaught = false
      continue
    }
    let caught = false
    try {
      caught = (await runChecks(pSrc, cSrc, iSrc)).failures.length > 0
    } catch {
      caught = true
    }
    console.log(`${caught ? '✓' : '✗'} 自检注入「${name}」${caught ? '已检出' : '未检出'}`)
    if (!caught) allCaught = false
  }
  process.exit(allCaught ? 0 : 1)
} else {
  const t = await runChecks(policySrc, clientSrc, indexSrc)
  process.exit(report(t, 'test:secure-data-write') ? 0 : 1)
}
