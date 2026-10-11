#!/usr/bin/env node
/**
 * 全局注册简化守卫（2026-10-11，蓝图 miniprogram/docs/全局注册简化方案_2026-10-11.md §0）
 *
 * 按施工步分段，每步落地时追加该段断言（前一步的断言不放松）：
 *   S4 统一口径：注册页 / 注册弹层 / 礼赠引导卡同一漏斗事件 register_panel（双端 schema 登记），各入口旧事件照旧；
 *               注册弹层真跑（假 Component / 假 wx）：曝光只记一次、先不注册记 dismiss、注册成功记 success、
 *               未勾选不注册；第一条权益可配且默认值不变（鉴定场景文案不动）。
 *   S1 门禁原地化：结算 / 预约 / 礼赠收下与核验都挂页面内注册弹层（跨分包必须登记 componentPlaceholder = 按需加载、不进主包），
 *               可关（先不注册）、成功后续做原动作；组件未就绪时退回跳注册页（旧路径照旧可用）；
 *               requirePhone 真跑：带 inline 且弹层就绪 → 不跳页；inline 返回 false / 不带 inline → 照旧跳注册页；已绑号 → 直接放行。
 *
 * 用法：node miniprogram/scripts/check-register-unify.mjs [--selftest]
 * 自检：对真源码做内存注入（不写盘），每条都必须检出。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const P = {
  dialogJs: 'miniprogram/subpackages/feature/components/RegisterAuthDialog/index.js',
  dialogWxml: 'miniprogram/subpackages/feature/components/RegisterAuthDialog/index.wxml',
  onbJs: 'miniprogram/subpackages/extra/user/onboarding/index.js',
  regCardJs: 'miniprogram/subpackages/feature/gift/reg-card/index.js',
  mpSchema: 'miniprogram/utils/analytics/eventSchema.js',
  erpSchema: 'admin/src/utils/analyticsSchema.js',
  session: 'miniprogram/utils/userSession.js',
  coJs: 'miniprogram/subpackages/business/confirm-order/index.js',
  coJson: 'miniprogram/subpackages/business/confirm-order/index.json',
  coWxml: 'miniprogram/subpackages/business/confirm-order/index.wxml',
  bkJs: 'miniprogram/subpackages/business/booking/index.js',
  bkJson: 'miniprogram/subpackages/business/booking/index.json',
  bkWxml: 'miniprogram/subpackages/business/booking/index.wxml',
  grJs: 'miniprogram/subpackages/feature/gift/receive/index.js',
  grJson: 'miniprogram/subpackages/feature/gift/receive/index.json',
  grWxml: 'miniprogram/subpackages/feature/gift/receive/index.wxml'
}
const DIALOG_PATH = '/subpackages/feature/components/RegisterAuthDialog/index'
/** S1 门禁页：页面前缀 / 是否跨分包 / 成功后必须续做的方法 */
const GATES = [
  { key: 'co', name: '结算', crossPackage: true, from: 'checkout', resume: ['submitOrder'] },
  { key: 'bk', name: '预约', crossPackage: true, from: 'booking', resume: ['submitBooking'] },
  { key: 'gr', name: '礼赠收下 / 核验', crossPackage: false, from: 'gift', resume: ['accept', 'verifyByAccount'] }
]
const readSrc = (rel) => readFileSync(resolve(ROOT, rel), 'utf8')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')

/* ── 真跑组件：假 Component / 假 wx / 假 require ───────────────────────── */
function loadComponent(src, fakes) {
  let def = null
  const sandbox = {
    Component: (d) => { def = d },
    getApp: () => ({ globalData: {} }),
    wx: fakes.wx,
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    Promise,
    Date,
    Object,
    require: (spec) => {
      for (const [k, v] of Object.entries(fakes.modules)) if (spec.endsWith(k)) return v
      throw new Error(`未模拟的依赖：${spec}`)
    }
  }
  vm.runInNewContext(src, sandbox, { filename: 'component.js' })
  if (!def) throw new Error('组件未调用 Component()')
  return def
}

function instantiate(def, props) {
  const data = {}
  for (const [k, v] of Object.entries(def.properties || {})) data[k] = v && typeof v === 'object' && 'value' in v ? v.value : undefined
  Object.assign(data, def.data || {}, props || {})
  const events = []
  const inst = {
    data,
    properties: data,
    setData(patch) {
      for (const [k, v] of Object.entries(patch)) {
        data[k] = v
        // 与真机一致：字段被 setData 就触发 observer（值没变也触发）
        const obs = def.observers && def.observers[k]
        if (obs) obs.call(inst, v)
      }
    },
    triggerEvent(name, detail) { events.push({ name, detail }) },
    events
  }
  for (const [k, fn] of Object.entries(def.methods || {})) inst[k] = fn.bind(inst)
  return inst
}

async function runDialog(src) {
  const tracks = []
  const fakes = {
    wx: { showToast() {}, showLoading() {}, hideLoading() {}, navigateTo() {} },
    modules: {
      '/utils/registerPhone': { registerWithPhone: async () => ({ ok: true, payload: { success: true, isNewUser: true } }) },
      '/utils/userSession': { ensureSession: () => Promise.resolve({ success: true, isRegistered: false }) },
      '/utils/trackBehavior': { trackBehavior: (...a) => tracks.push(a) }
    }
  }
  const def = loadComponent(src, fakes)
  const steps = () => tracks.filter((t) => t[0] === 'register_panel').map((t) => `${t[2]}:${t[3] && t[3].step}:${t[3] && t[3].surface}`)
  const out = {}

  const a = instantiate(def, { from: 'checkout', closable: true })
  if (def.lifetimes && def.lifetimes.attached) def.lifetimes.attached.call(a)
  a.setData({ show: true })
  a.setData({ show: true })
  out.showOnce = steps().filter((s) => s === 'checkout:show:dialog').length === 1
  a.onClose()
  out.dismiss = steps().includes('checkout:dismiss:dialog') && a.events.some((e) => e.name === 'close')

  tracks.length = 0
  const b = instantiate(def, { from: 'booking', closable: true })
  b.setData({ show: true })
  await b.onGetPhoneNumber({ detail: { errMsg: 'getPhoneNumber:ok', code: 'c' } })
  out.blockedWhenUnagreed = !b.events.some((e) => e.name === 'success')
  b.setData({ agreed: true })
  b.onCtaTap()
  out.auth = steps().includes('booking:auth:dialog')
  await b.onGetPhoneNumber({ detail: { errMsg: 'getPhoneNumber:ok', code: 'c' } })
  const succ = tracks.find((t) => t[0] === 'register_panel' && t[3] && t[3].step === 'success')
  out.success = !!succ && succ[2] === 'booking' && succ[3].isNewUser === true && b.events.some((e) => e.name === 'success')
  out.reopenCountsAgain = (() => {
    tracks.length = 0
    b.setData({ show: false })
    b.setData({ show: true })
    return steps().filter((s) => s === 'booking:show:dialog').length === 1
  })()
  return out
}

async function runRequirePhone(sessionSrc) {
  const m = /async function requirePhone\(app, options = \{\}\) \{[\s\S]*?\n\}/.exec(stripComments(sessionSrc))
  if (!m) throw new Error('取不到 requirePhone 源码')
  const make = (phone) => {
    const calls = { prompt: 0, inline: 0 }
    // eslint-disable-next-line no-new-func
    const fn = new Function('ensureSession', 'hasPhone', 'needsOnboarding', 'promptPhoneBind', `${m[0]}; return requirePhone`)(
      async () => ({ success: true, user: phone ? { phone: '1' } : {} }),
      (s) => !!(s && s.user && s.user.phone),
      () => true,
      async () => { calls.prompt += 1 }
    )
    return { fn, calls }
  }
  const out = {}
  let t = make(false)
  let r = await t.fn({}, { direct: true, inline: () => { t.calls.inline += 1; return true } })
  out.inlineNoJump = r === false && t.calls.inline === 1 && t.calls.prompt === 0
  t = make(false)
  r = await t.fn({}, { direct: true, inline: () => false })
  out.inlineFallback = r === false && t.calls.prompt === 1
  t = make(false)
  r = await t.fn({}, { direct: true })
  out.noInlineUnchanged = r === false && t.calls.prompt === 1
  t = make(true)
  r = await t.fn({}, { direct: true, inline: () => { t.calls.inline += 1; return true } })
  out.boundPasses = r === true && t.calls.inline === 0 && t.calls.prompt === 0
  return out
}

function methodBody(js, name) {
  const re = new RegExp(`\\n  (?:async )?${name}\\(([^)]*)\\) \\{`)
  const m = re.exec(js)
  if (!m) return ''
  let depth = 0
  for (let i = m.index + m[0].length - 1; i < js.length; i += 1) {
    if (js[i] === '{') depth += 1
    else if (js[i] === '}') { depth -= 1; if (depth === 0) return js.slice(m.index, i + 1) }
  }
  return ''
}

/* ── 判据 ─────────────────────────────────────────────────────────────── */
async function evaluate(src) {
  const fails = []
  const check = (name, ok, hint) => { if (!ok) fails.push(hint ? `${name}（${hint}）` : name) }

  // S4-1 双端 schema
  for (const k of ['mpSchema', 'erpSchema']) {
    check(`${k} 登记 register_panel`, /\n\s*register_panel:\s*\{\s*module:\s*MODULE\.USER,[^}]*targetType:\s*'register'/.test(src[k]))
  }
  // S4-2 三处面板都上报同一事件、四个步骤齐全
  const panels = [
    { key: 'dialogJs', surface: 'dialog', steps: ['show', 'auth', 'success', 'dismiss'] },
    { key: 'onbJs', surface: 'page', steps: ['show', 'auth', 'success', 'dismiss'] },
    { key: 'regCardJs', surface: 'gift_card', steps: ['show', 'auth', 'success', 'dismiss'] }
  ]
  for (const p of panels) {
    const js = stripComments(src[p.key])
    check(`${p.key} 漏斗事件名 register_panel / surface=${p.surface}`,
      /trackBehavior\(\s*'register_panel',\s*'register'/.test(js) && new RegExp(`surface:\\s*'${p.surface}'`).test(js))
    for (const st of p.steps) check(`${p.key} 上报 step=${st}`, new RegExp(`_funnel\\(\\s*'${st}'`).test(js))
    check(`${p.key} 用解构导入 trackBehavior（模块导出对象，见错题本 E32）`,
      /const \{ trackBehavior \} = require\([^)]*utils\/trackBehavior'\)/.test(js))
  }
  // S4-3 旧事件照旧（不改既有事件）
  const onb = stripComments(src.onbJs)
  for (const ev of ['onboarding_start', 'onboarding_complete', 'phone_bind_success', 'auth_register_success', 'auth_login_success']) {
    check(`注册页旧事件 ${ev} 仍在`, onb.includes(`'${ev}'`))
  }
  const card = stripComments(src.regCardJs)
  for (const ev of ['gift_reg_guide_click', 'gift_reg_guide_done']) check(`引导卡旧事件 ${ev} 仍在`, card.includes(`'${ev}'`))
  // S4-4 第一条权益可配、默认值不变
  check('注册弹层第一条权益可配（lead）且默认仍为鉴定场景文案',
    /lead:\s*\{\s*type:\s*String,\s*value:\s*'鉴定结果自动存进山海图鉴'\s*\}/.test(src.dialogJs) && /\{\{lead\}\}/.test(src.dialogWxml))
  // S4-5 真跑注册弹层
  let run = null
  try { run = await runDialog(src.dialogJs) } catch (e) { check('注册弹层可被真跑', false, e.message) }
  if (run) {
    check('真跑：同一次打开只记一次曝光', run.showOnce)
    check('真跑：「先不注册」记 dismiss 且照常发 close', run.dismiss)
    check('真跑：未勾选时授权回调不注册', run.blockedWhenUnagreed)
    check('真跑：勾选后点授权记 auth', run.auth)
    check('真跑：注册成功记 success（带入口 from 与 isNewUser）且照常发 success', run.success)
    check('真跑：关掉再打开重新计一次曝光', run.reopenCountsAgain)
  }

  // S1-1 三个门禁页都挂弹层、跨分包登记占位、可关、成功续做、未就绪退回
  for (const g of GATES) {
    let json = {}
    try { json = JSON.parse(src[`${g.key}Json`]) } catch (e) { check(`${g.name}页 json 可解析`, false, e.message) }
    const uc = json.usingComponents || {}
    check(`${g.name}页引用注册弹层组件`, uc['register-auth-dialog'] === DIALOG_PATH)
    if (g.crossPackage) {
      check(`${g.name}页跨分包引用登记 componentPlaceholder（按需加载，不进主包）`,
        !!(json.componentPlaceholder && json.componentPlaceholder['register-auth-dialog'] === 'view'))
    }
    const tag = (/<register-auth-dialog[\s\S]*?\/>/.exec(src[`${g.key}Wxml`]) || [''])[0]
    check(`${g.name}页弹层可关且文案为「先不注册」`, /closable="\{\{true\}\}"/.test(tag) && /close-text="先不注册"/.test(tag))
    check(`${g.name}页弹层绑定 close / success、id=regDialog、from=${g.from}`,
      /bind:close="onRegDialogClose"/.test(tag) && /bind:success="onRegDialogSuccess"/.test(tag)
      && /id="regDialog"/.test(tag) && new RegExp(`from="${g.from}"`).test(tag))
    const js = stripComments(src[`${g.key}Js`])
    const inlineCalls = (js.match(/inline:\s*\(\)\s*=>/g) || []).length
    check(`${g.name}页 requirePhone 带 inline（原地弹层）`, inlineCalls >= g.resume.length, `${inlineCalls} 处`)
    const open = methodBody(js, 'openRegDialog')
    check(`${g.name}页弹层未就绪时返回 false（退回跳注册页）`,
      /if \(!this\.selectComponent\('#regDialog'\)\) return false/.test(open) && /regDialogShow: true/.test(open))
    const succ = methodBody(js, 'onRegDialogSuccess')
    for (const r of g.resume) check(`${g.name}页注册成功后续做 ${r}`, new RegExp(`this\\.${r}\\(`).test(succ))
    check(`${g.name}页关闭弹层只收起`, /regDialogShow: false/.test(methodBody(js, 'onRegDialogClose')))
  }
  // S1-2 requirePhone 真跑
  let rp = null
  try { rp = await runRequirePhone(src.session) } catch (e) { check('requirePhone 可被真跑', false, e.message) }
  if (rp) {
    check('真跑 requirePhone：带 inline 且弹层就绪 → 不跳注册页', rp.inlineNoJump)
    check('真跑 requirePhone：inline 返回 false → 退回跳注册页', rp.inlineFallback)
    check('真跑 requirePhone：不带 inline → 行为不变（跳注册页）', rp.noInlineUnchanged)
    check('真跑 requirePhone：已绑手机号 → 直接放行、不弹层', rp.boundPasses)
  }
  return fails
}

function loadAll() {
  const src = {}
  for (const [k, rel] of Object.entries(P)) src[k] = readSrc(rel)
  return src
}

const INJECTIONS = [
  { name: '小程序 schema 漏登记 register_panel', key: 'mpSchema', from: /\n\s*register_panel:[^\n]*/, to: '' },
  { name: 'ERP schema 漏登记 register_panel', key: 'erpSchema', from: /\n\s*register_panel:[^\n]*/, to: '' },
  { name: '注册页不再上报曝光', key: 'onbJs', from: "this._funnel('show')", to: '' },
  { name: '注册页离开不记 dismiss', key: 'onbJs', from: "this._funnel('dismiss')", to: '' },
  { name: '引导卡漏报 success', key: 'regCardJs', from: "this._funnel('success', { isNewUser })", to: '' },
  { name: '引导卡退回默认导入（对象当函数调）', key: 'regCardJs', from: "const { trackBehavior } = require('../../../../utils/trackBehavior')", to: "const trackBehavior = require('../../../../utils/trackBehavior')" },
  { name: '注册页删掉旧事件 onboarding_complete', key: 'onbJs', from: /trackBehavior\('onboarding_complete'[^\n]*\n/g, to: '\n' },
  { name: '弹层曝光不去重（每次属性回写都记）', key: 'dialogJs', from: '      if (this._panelShown) return\n', to: '' },
  { name: '弹层「先不注册」不记 dismiss', key: 'dialogJs', from: "      this._funnel('dismiss')\n", to: '' },
  { name: '弹层成功不记 success', key: 'dialogJs', from: "        this._funnel('success', { isNewUser: !!(res.payload && res.payload.isNewUser) })\n", to: '' },
  { name: '弹层默认权益被改（鉴定场景文案被动）', key: 'dialogJs', from: "value: '鉴定结果自动存进山海图鉴'", to: "value: '注册后自动继续'" },
  { name: '结算页丢掉 componentPlaceholder（跨分包组件同步引用）', key: 'coJson', from: /,\n  "componentPlaceholder": \{\n    "register-auth-dialog": "view"\n  \}/, to: '' },
  { name: '预约页弹层不可关（没有「先不注册」）', key: 'bkWxml', from: '  closable="{{true}}"\n  close-text="先不注册"\n', to: '' },
  { name: '结算页注册成功后不续提交', key: 'coJs', from: '    this.submitOrder()\n  },\n\n  dismissAuthResumeHint', to: '  },\n\n  dismissAuthResumeHint' },
  { name: '礼赠页核验门禁退回只跳页（没有 inline）', key: 'grJs', from: "      inline: () => this.openRegDialog('verify')\n", to: '' },
  { name: '预约页弹层未就绪不退回（永远当作已打开）', key: 'bkJs', from: "    if (!this.selectComponent('#regDialog')) return false;\n", to: '' },
  { name: 'requirePhone 忽略 inline 返回值（未就绪也不跳页 → 用户卡住）', key: 'session', from: "options.inline({ from, phoneOnly }) !== false) return false", to: 'options.inline({ from, phoneOnly }) !== null) return false' },
  { name: 'requirePhone 带 inline 仍跳注册页', key: 'session', from: "  if (typeof options.inline === 'function' && options.inline({ from, phoneOnly }) !== false) return false\n", to: '' },
  { name: '弹层未勾选也放行注册', key: 'dialogJs', from: "    async onGetPhoneNumber(e) {\n      if (this.data.saving || !this.data.agreed) return", to: '    async onGetPhoneNumber(e) {\n      if (this.data.saving) return' }
]

async function selftest() {
  const base = loadAll()
  const baseFails = await evaluate(base)
  if (baseFails.length) { console.log('✗ 自检前置：真源码本身未通过'); baseFails.forEach((f) => console.log(`  - ${f}`)); process.exit(1) }
  let bad = 0
  for (const inj of INJECTIONS) {
    const src = { ...base }
    const hits = typeof inj.from === 'string' ? src[inj.key].split(inj.from).length - 1 : (src[inj.key].match(inj.from) || []).length
    if (hits < 1) { console.log(`  ✗ 锚点缺失：${inj.name}`); bad += 1; continue }
    src[inj.key] = typeof inj.from === 'string' ? src[inj.key].split(inj.from).join(inj.to) : src[inj.key].replace(inj.from, inj.to)
    const fails = await evaluate(src)
    if (fails.length) console.log(`  ✓ ${inj.name} → 检出（${fails[0]}）`)
    else { console.log(`  ✗ ${inj.name} → 未检出`); bad += 1 }
  }
  if (bad) { console.log(`✗ 自检失败 ${bad} 项`); process.exit(1) }
  console.log(`✓ 自检通过：${INJECTIONS.length} 个内存注入全部检出（不写盘）`)
}

if (process.argv.includes('--selftest')) {
  await selftest()
} else {
  const fails = await evaluate(loadAll())
  if (fails.length) {
    console.log('✗ 全局注册简化守卫未通过：')
    fails.forEach((f) => console.log(`  - ${f}`))
    process.exit(1)
  }
  console.log('✓ 全局注册简化：S4 统一漏斗 register_panel 双端登记、三处面板四步齐全、旧事件照旧、注册弹层真跑（曝光去重 / 先不注册 / 未勾不注册 / 成功）'
    + ' · S1 结算 / 预约 / 礼赠原地弹层（跨分包占位按需加载、可关、成功续做、未就绪退回跳页）、requirePhone 真跑')
}
