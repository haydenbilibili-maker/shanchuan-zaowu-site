/**
 * 需求 14「伴宠标本师选择 + 资质 + 定向通知 + 工作台入口」行为断言
 *
 * 为什么不能只做静态检查：这一条链路上有三处**静默失效**风险，静态扫描全都看不见 ——
 *   1. 客户选了没有 `staffOpenid` 的标本师 → 单能下，但标本师永远收不到通知；
 *   2. 客户端伪造 `artisan.framerName / openid` → 越权把工单派给别人；
 *   3. 名单过滤条件（资质 / 展示中 / 已绑定）任一漏写 → 出现「可选但不可派」的假选项。
 * 因此这里直接**运行**云函数源码（stub 掉 wx-server-sdk 与 db），对真实分支做断言。
 *
 * 用法：
 *   node miniprogram/scripts/test-pet-artisan-flow.mjs
 *   node miniprogram/scripts/test-pet-artisan-flow.mjs --selftest   # 注入回归 → 必须检出
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

let passed = 0
let failed = 0
const failures = []

function check(name, cond, extra) {
  if (cond) {
    passed += 1
  } else {
    failed += 1
    failures.push(`${name}${extra ? ' — ' + extra : ''}`)
  }
}

function eq(name, got, want) {
  check(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}

/**
 * --selftest 用的源码回归注入：证明「断言真的会失败」，而不是自说自话。
 * 每个注入都是本需求历史上真实可能写错的一行，注入后断言必须挂。
 */
const INJECTIONS = {
  // 名单少了「有资质」门槛 → 没声明接单的人也会被客户选中
  'drop-qualify-gate': {
    file: 'miniprogram/cloudfunctions/getPetMemorialConfig/index.js',
    from: "const qualified = rows.filter((row) => row && row.active !== false && row.petOrderQualified === true)",
    to: 'const qualified = rows.filter((row) => row && row.active !== false)'
  },
  // 名单少了「已绑定 openid」门槛 → 选项可选但永远投不出去（静默失效）
  'drop-bind-gate': {
    file: 'miniprogram/cloudfunctions/getPetMemorialConfig/index.js',
    from: "const deliverable = qualified.filter((row) => String(row.staffOpenid || '').trim())",
    to: 'const deliverable = qualified'
  },
  // 落库姓名改用客户端入参 → 可伪造显示名
  'trust-client-name': {
    file: 'miniprogram/cloudfunctions/petMemorialOrder/index.js',
    from: 'framerName: artisan.framerName,',
    to: "framerName: (payload.artisan && payload.artisan.framerName) || artisan.framerName,"
  },
  // 接单不校验归属 → 任何店员都能替别人接单
  'skip-owner-check': {
    file: 'miniprogram/cloudfunctions/petMemorialOrder/index.js',
    from: "if (String(doc.artisanFramerId || '') !== framerId) {",
    to: 'if (false) {'
  },
  // 无条件写资质字段 → 旧版客户端一保存档案就把已声明的资质清成 false
  'wipe-artisan-qualify': {
    file: 'miniprogram/cloudfunctions/manageStaff/index.js',
    from: 'if (hasPetOrderQualified) data.petOrderQualified = petOrderQualified',
    to: 'data.petOrderQualified = petOrderQualified'
  }
}

const INJECT = String(process.env.PET_ARTISAN_INJECT || '').trim()

/** 读源码；--selftest 注入时替换一处源码 */
function readSrc(file) {
  const raw = readFileSync(resolve(ROOT, file), 'utf8')
  if (!INJECT) return raw
  const inj = INJECTIONS[INJECT]
  if (!inj) throw new Error('unknown injection ' + INJECT)
  if (inj.file !== file) return raw
  if (raw.indexOf(inj.from) === -1) throw new Error('injection anchor missing: ' + INJECT)
  return raw.replace(inj.from, inj.to)
}

/** 以 CJS 语义运行小程序源码（根 package.json 是 type:module，不能直接 require .js） */
function loadCjs(file, { require: reqStub, globals = {} } = {}) {
  const src = readSrc(file)
  const module = { exports: {} }
  const names = ['module', 'exports', 'require', ...Object.keys(globals)]
  const vals = [module, module.exports, reqStub || (() => { throw new Error('require not stubbed') }), ...Object.values(globals)]
  // eslint-disable-next-line no-new-func
  const fn = new Function(...names, src)
  fn(...vals)
  return module.exports
}

/* ------------------------------------------------------------------ *
 * 1) getPetMemorialConfig：可选标本师名单的三条门槛
 * ------------------------------------------------------------------ */

const FRAMERS = [
  // 合规：有资质 + 展示中 + 已绑定 openid
  { _id: 'f-ok', name: '林师傅', active: true, petOrderQualified: true, staffOpenid: 'openid-lin', bio: '剥制十年', priceDelta: 200, extraDays: 5 },
  // 有资质但没绑 openid —— 选了也投不出去，必须被过滤
  { _id: 'f-nobind', name: '无主档案', active: true, petOrderQualified: true, staffOpenid: '' },
  // 没有资质
  { _id: 'f-nopet', name: '只做标品', active: true, petOrderQualified: false, staffOpenid: 'openid-x' },
  // 资质字段缺失（历史档案）
  { _id: 'f-legacy', name: '历史档案', active: true, staffOpenid: 'openid-y' },
  // 已隐藏
  { _id: 'f-hidden', name: '已隐藏', active: false, petOrderQualified: true, staffOpenid: 'openid-z' },
  // 另一位合规标本师：用来验证「归属校验」挡得住「同为标本师但不是被指派的人」
  { _id: 'f-ok2', name: '周师傅', active: true, petOrderQualified: true, staffOpenid: 'openid-other' }
]

function makePetConfigDb() {
  const cmd = { neq: (v) => ({ $neq: v }) }
  return {
    command: cmd,
    collection(name) {
      if (name === 'framers') {
        const q = { where: null, limit: null }
        return {
          where(w) { q.where = w; return this },
          limit(n) { q.limit = n; return this },
          orderBy() { return this },
          async get() {
            let rows = FRAMERS.slice()
            if (q.where && q.where.active && q.where.active.$neq === false) {
              rows = rows.filter((r) => r.active !== false)
            }
            return { data: rows }
          }
        }
      }
      if (name === 'pet_craft_configs') {
        return {
          where() { return this },
          orderBy() { return this },
          async get() { return { data: [] } }
        }
      }
      throw new Error('unexpected collection ' + name)
    }
  }
}

const petConfigSrc = readSrc('miniprogram/cloudfunctions/getPetMemorialConfig/index.js')
const petConfigModule = { exports: {} }
{
  const cloudStub = { init() {}, DYNAMIC_CURRENT_ENV: 'env', database: () => makePetConfigDb() }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', petConfigSrc)(
    petConfigModule,
    petConfigModule.exports,
    (id) => (id === 'wx-server-sdk' ? cloudStub : (() => { throw new Error('bad require ' + id) })())
  )
}
const petConfig = await petConfigModule.exports.main()
const artisans = (petConfig.config && petConfig.config.artisans) || []
const artisanIds = artisans.map((a) => a.id)

check('getPetMemorialConfig: 有资质+展示中+已绑定 → 出现在名单', artisanIds.includes('f-ok'))
check('getPetMemorialConfig: 有资质但缺 staffOpenid → 被过滤（否则静默收不到通知）', !artisanIds.includes('f-nobind'))
check('getPetMemorialConfig: 无 petOrderQualified → 被过滤', !artifactIdHelper(artisanIds, 'f-nopet'))
check('getPetMemorialConfig: 资质字段缺失的历史档案 → 被过滤（默认不接单）', !artisanIds.includes('f-legacy'))
check('getPetMemorialConfig: active=false → 被过滤', !artisanIds.includes('f-hidden'))
eq('getPetMemorialConfig: 名单只应有 2 人（f-ok / f-ok2）', artisans.length, 2)
eq('getPetMemorialConfig: 下发对象不暴露 openid（客户端无需也不该拿到）', typeof artisans[0].staffOpenid, 'undefined')

function artifactIdHelper(list, id) {
  return list.includes(id)
}

/* ------------------------------------------------------------------ *
 * 2) petMemorialOrder：越权 / 静默失效 / 归属校验
 * ------------------------------------------------------------------ */

const collections = {
  framers: FRAMERS.map((r) => ({ ...r })),
  pet_memorial_orders: []
}

function makeOrderDb() {
  const cmd = {
    push: (arr) => ({ $push: arr }),
    neq: (v) => ({ $neq: v })
  }
  const matches = (doc, where) =>
    Object.keys(where || {}).every((k) => doc[k] === where[k])
  return {
    command: cmd,
    serverDate: () => 'SERVER_DATE',
    collection(name) {
      const rows = collections[name]
      if (!rows) throw new Error('unexpected collection ' + name)
      const state = { where: null, limit: null, orderBy: null }
      const api = {
        where(w) { state.where = w; return this },
        limit(n) { state.limit = n; return this },
        orderBy() { return this },
        doc(id) {
          return {
            async get() {
              const hit = rows.find((r) => r._id === id)
              if (!hit) throw new Error('document does not exist')
              return { data: hit }
            },
            async update({ data }) {
              const hit = rows.find((r) => r._id === id)
              if (!hit) throw new Error('document does not exist')
              Object.keys(data).forEach((k) => {
                const val = data[k]
                // db.command.push([...]) —— 模拟原子追加
                if (val && typeof val === 'object' && Array.isArray(val.$push)) {
                  const cur = Array.isArray(hit[k]) ? hit[k] : []
                  hit[k] = cur.concat(val.$push)
                  return
                }
                if (k.indexOf('.') === -1) { hit[k] = val; return }
                // 支持 'artisan.acceptedAt' 这类点号路径
                const [head, tail] = k.split('.')
                hit[head] = hit[head] || {}
                hit[head][tail] = val
              })
              return { stats: { updated: 1 } }
            }
          }
        },
        async get() {
          let out = rows.slice()
          if (state.where) out = out.filter((r) => matches(r, state.where))
          if (state.limit) out = out.slice(0, state.limit)
          return { data: out }
        },
        async add({ data }) {
          const _id = 'order-' + (rows.length + 1)
          rows.push({ _id, ...data })
          return { _id }
        }
      }
      return api
    }
  }
}

let currentOpenid = 'openid-customer'
const dispatched = []
const orderSrc = readSrc('miniprogram/cloudfunctions/petMemorialOrder/index.js')
const orderModule = { exports: {} }
{
  const cloudStub = {
    init() {},
    DYNAMIC_CURRENT_ENV: 'env',
    database: () => makeOrderDb(),
    getWXContext: () => ({ OPENID: currentOpenid }),
    callFunction: (opts) => {
      dispatched.push(opts)
      return Promise.resolve({ result: { success: true } })
    }
  }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', orderSrc)(
    orderModule,
    orderModule.exports,
    (id) => (id === 'wx-server-sdk' ? cloudStub : (() => { throw new Error('bad require ' + id) })())
  )
}
const petOrder = orderModule.exports

const basePayload = () => ({
  pet: { name: '豆豆', species: 'cat', speciesLabel: '猫' },
  craft: { craftId: 'fluid', craftName: '浸液标本' },
  intake: { method: 'store', methodLabel: '到店交接' },
  contact: { name: '张先生', phone: '13800000000' },
  consent: { version: 'v2', agreedAt: '2026-09-16T00:00:00.000Z' }
})

// 2a. 未上线的交接方式仍必须被云端拦下（需求 13 回归，防被本次改动带坏）
{
  const bad = basePayload()
  bad.intake.method = 'partner_clinic'
  const res = await petOrder.main({ action: 'submit', payload: bad })
  eq('submit: partner_clinic 云端白名单拦截', res.success, false)
  check('submit: 拦截时给出可执行提示', /暂未开放/.test(res.msg || ''), res.msg)
}

// 2b. 指定了「有资质但没绑定 openid」的标本师 → 必须当场失败，不能静默降级
{
  const p = basePayload()
  p.artisan = { framerId: 'f-nobind', framerName: '伪造名' }
  const res = await petOrder.main({ action: 'submit', payload: p })
  eq('submit: 选的标本师不可投递 → 拒绝下单', res.success, false)
  check('submit: 拒绝时提示改选/平台指派', /不可接单/.test(res.msg || ''), res.msg)
}

// 2c. 指定没有资质的档案 → 同样拒绝
{
  const p = basePayload()
  p.artisan = { framerId: 'f-nopet' }
  const res = await petOrder.main({ action: 'submit', payload: p })
  eq('submit: 无 petOrderQualified 的档案 → 拒绝', res.success, false)
}

// 2d. 合规指定 → 落库字段取自服务端，客户端传的 framerName 不得生效
{
  const p = basePayload()
  p.artisan = { framerId: 'f-ok', framerName: '骗子名字', artisanOpenid: 'openid-attacker' }
  const res = await petOrder.main({ action: 'submit', payload: p })
  eq('submit: 合规指定 → 下单成功', res.success, true)
  const doc = collections.pet_memorial_orders.find((r) => r._id === res.orderId)
  check('submit: 工单已落库', !!doc)
  eq('submit: framerName 以服务端档案为准（客户端的被丢弃）', doc.artisan.framerName, '林师傅')
  eq('submit: artisanOpenid 以服务端档案为准（伪造值被丢弃）', doc.artisanOpenid, 'openid-lin')
  eq('submit: 扁平字段 artisanFramerId 与嵌套一致', doc.artisanFramerId, 'f-ok')
  await new Promise((r) => setTimeout(r, 10))
  const notifies = dispatched.filter((d) => d.data && d.data.action === 'notifyWorkOrder')
  eq('submit: 发出 1 条定向工单通知', notifies.length, 1)
  eq('submit: 通知类别', notifies[0].data.category, 'pet_memorial_assigned')
  eq('submit: 通知发给被指定的标本师（不是客户）', notifies[0].data.openid, 'openid-lin')
  eq('submit: 通知关联工单 id', notifies[0].data.relatedId, res.orderId)
  eq('submit: 通知带宠物名', notifies[0].data.vars.petName, '豆豆')
}

// 2e. 不指定标本师 → 平台指派，不产生定向通知
{
  const before = dispatched.length
  const res = await petOrder.main({ action: 'submit', payload: basePayload() })
  eq('submit: 不指定 → 下单成功（平台指派）', res.success, true)
  const doc = collections.pet_memorial_orders.find((r) => r._id === res.orderId)
  eq('submit: 不指定时 artisan 为空', doc.artisan, null)
  eq('submit: 不指定时 artisanFramerId 为空串', doc.artisanFramerId, '')
  await new Promise((r) => setTimeout(r, 10))
  const notifies = dispatched.slice(before).filter((d) => d.data && d.data.action === 'notifyWorkOrder')
  eq('submit: 不指定 → 不发定向通知', notifies.length, 0)
}

// 2f. listArtisan：客户端传 framerId 一律不采纳，只认服务端反查
{
  currentOpenid = 'openid-other'
  const res = await petOrder.main({ action: 'listArtisan', framerId: 'f-ok' })
  eq('listArtisan: 未绑定标本师的人看不到任何工单', (res.list || []).length, 0)

  currentOpenid = 'openid-lin'
  const mine = await petOrder.main({ action: 'listArtisan' })
  eq('listArtisan: f-ok 本人看到 1 张', (mine.list || []).length, 1)
  eq('listArtisan: 返回服务端解析出的 framerId', mine.framerId, 'f-ok')
  eq('listArtisan: 列表带接单状态（未接单）', !!mine.list[0].acceptedAt, false)
  check('listArtisan: 列表不含客户 openid', !('_openid' in mine.list[0]), JSON.stringify(Object.keys(mine.list[0])))
}

// 2g. acceptAssignment：非本人 / 重复接单
{
  const target = collections.pet_memorial_orders.find((r) => r.artisanFramerId === 'f-ok')
  currentOpenid = 'openid-other'
  const denied = await petOrder.main({ action: 'acceptAssignment', orderId: target._id })
  eq('acceptAssignment: 同为标本师但非被指派者 → 拒绝', denied.success, false)
  check('acceptAssignment: 拒绝理由明确', /未指派给你|未绑定/.test(denied.msg || ''), denied.msg)

  currentOpenid = 'openid-lin'
  const ok = await petOrder.main({ action: 'acceptAssignment', orderId: target._id })
  eq('acceptAssignment: 本人 → 成功', ok.success, true)
  check('acceptAssignment: 写入 acceptedAt', !!target.artisan.acceptedAt)
  check('acceptAssignment: 追加生产日志', (target.productionLog || []).some((l) => /确认接单/.test(l.note || '')))

  const again = await petOrder.main({ action: 'acceptAssignment', orderId: target._id })
  eq('acceptAssignment: 重复接单 → 拒绝', again.success, false)
  check('acceptAssignment: 重复理由明确', /已确认过接单/.test(again.msg || ''), again.msg)
}

/* ------------------------------------------------------------------ *
 * 3) workOrderSubscribe：新类别字段合规 + 未配模板优雅跳过
 * ------------------------------------------------------------------ */

const subSrcPath = 'miniprogram/cloudfunctions/dispatchMessage/workOrderSubscribe.js'
const sub = loadCjs(subSrcPath)
const cat = sub.WORK_ORDER_CATEGORIES.pet_memorial_assigned
check('workOrderSubscribe: 新增 pet_memorial_assigned 类别', !!cat)
eq('workOrderSubscribe: 环境变量名', cat.envKey, 'STAFF_PET_MEMORIAL_TMPL_ID')
check('workOrderSubscribe: logType 走 staff_ 前缀（否则进 customer 队列，标本师看不到）', /^staff_/.test(cat.logType), cat.logType)
// 落地页断言不再写死分包路径：页面搬迁过（manager/artisan → extra/artisan，
// 2026-09-16 包体优化），写死路径的断言会被搬迁弄红，而它想守的是
// 「这个通知落到标本师伴宠页，且该页真实存在」。
check('workOrderSubscribe: 落地页指向标本师工作台伴宠页', /(^|\/)artisan\/pet\/index$/.test(cat.page), cat.page)
{
  const app = JSON.parse(readFileSync(resolve(ROOT, 'miniprogram/app.json'), 'utf8'))
  const registered = new Set()
  for (const p of app.pages || []) registered.add(p.replace(/^\//, ''))
  for (const sp of app.subpackages || []) {
    const root = sp.root.replace(/\/$/, '')
    for (const p of sp.pages || []) registered.add(`${root}/${p}`.replace(/^\//, ''))
  }
  check('workOrderSubscribe: 落地页确实是 app.json 注册页（搬迁后仍可达）',
    registered.has(cat.page), `${cat.page} 不在 ${registered.size} 个注册页里`)
}
eq('workOrderSubscribe: 未配模板 → TMPL_PENDING（不阻断下单）', sub.tmplIdFor('pet_memorial_assigned'), '')

const data = sub.buildTemplateData('pet_memorial_assigned', {
  orderNo: 'PM20260916000001',
  petName: '一只名字特别特别长的宠物名字超过二十个字符',
  craftName: '剥制标本',
  submitTime: '2026-09-16T08:30:00.000Z'
})
eq('模板字段数', Object.keys(data).length, 4)
check('模板 orderNo 走 character_string（无汉字）', /^[\w\-./#:]+$/.test(data.character_string1.value), data.character_string1.value)
check('模板 orderNo 不超 32 字符', data.character_string1.value.length <= 32)
check('模板 petName 被裁到 20 字符内', data.thing2.value.length <= 20, String(data.thing2.value.length))
check('模板 craftName 被裁到 20 字符内', data.thing3.value.length <= 20)
check('模板 time 为年月日 + 24 小时制', /^\d{4}年\d{1,2}月\d{1,2}日 \d{2}:\d{2}$/.test(data.time4.value), data.time4.value)
eq('模板 data 结构为 {value}', typeof data.thing2.value, 'string')

// ---- selftest：把源码改回去（注入回归）→ 本脚本必须以非 0 退出 ----
if (process.argv.includes('--selftest') && !INJECT) {
  const { spawnSync } = await import('node:child_process')
  let bad = 0
  for (const name of Object.keys(INJECTIONS)) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, PET_ARTISAN_INJECT: name },
      encoding: 'utf8'
    })
    const caught = run.status !== 0
    if (!caught) {
      bad += 1
      console.error(`  ✗ 注入 ${name} 未被检出（断言不会失败 = 守卫无效）`)
    } else {
      console.log(`  ✓ 注入 ${name} 被检出`)
    }
  }
  const clean = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
  if (clean.status !== 0) {
    bad += 1
    console.error('  ✗ 未注入时本应通过，实际失败：')
    console.error(clean.stdout || clean.stderr)
  } else {
    console.log('  ✓ 未注入时通过（无假阳性）')
  }
  if (bad) {
    console.error(`\n✗ selftest 失败 ${bad} 项`)
    process.exit(1)
  }
  console.log(`\n✓ selftest 通过：${Object.keys(INJECTIONS).length} 个回归注入全部被检出，且无假阳性`)
  process.exit(0)
}

/* ------------------------------------------------------------------ *
 * 4) manageStaff.saveArtisanProfile：旧客户端不得把已声明资质清成 false
 *    这里**执行源码里真实的那两行**（从文件切片，不是抄一份逻辑），
 *    以此证明「字段缺失 → 不写库」「字段为 false → 写 false」两种分支。
 * ------------------------------------------------------------------ */

{
  const staffSrc = readSrc('miniprogram/cloudfunctions/manageStaff/index.js')
  const hasLine = (staffSrc.match(/^.*const hasPetOrderQualified = .*$/m) || [])[0]
  const valLine = (staffSrc.match(/^.*const petOrderQualified = .*$/m) || [])[0]
  const writeLine = (staffSrc.match(/^.*if \(hasPetOrderQualified\) data\.petOrderQualified = .*$/m) || [])[0]
  check('manageStaff: 存在「字段出现才写」的判定行', !!hasLine, String(hasLine))
  check('manageStaff: 存在条件写入行', !!writeLine, String(writeLine))
  if (hasLine && valLine && writeLine) {
    const decide = (event) => {
      // eslint-disable-next-line no-new-func
      const fn = new Function('event', `${hasLine}\n${valLine}\nconst data = {}\n${writeLine}\nreturn data`)
      return fn(event)
    }
    eq('manageStaff: 旧客户端不带字段 → 不写 petOrderQualified（不清资质）', 'petOrderQualified' in decide({ name: 'x' }), false)
    eq('manageStaff: 显式关闭 → 写 false', decide({ petOrderQualified: false }).petOrderQualified, false)
    eq('manageStaff: 显式开启 → 写 true', decide({ petOrderQualified: true }).petOrderQualified, true)
    eq('manageStaff: 传字符串 "true" 不算开启', decide({ petOrderQualified: 'true' }).petOrderQualified, false)
  }
}

/* ------------------------------------------------------------------ */

console.log(`\n需求 14 行为断言：通过 ${passed} / ${passed + failed}`)
if (failed) {
  failures.forEach((f) => console.error('  ✗ ' + f))
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ 需求 14 全链路断言通过（名单门槛 / 越权投放 / 归属校验 / 模板字段）')
