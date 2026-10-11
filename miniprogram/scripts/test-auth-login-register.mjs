/**
 * 「登录 vs 注册」口径守卫（L0 表达层 + L1 事实层）
 *
 * 背景（产品负责人 2026-09-17 提出）：小程序此前不区分登录与注册 —— 老用户也会看到
 * 「注册即领新客礼」，而礼包按 openid 幂等、根本不会再发 → 空承诺。
 *
 * 本守卫钉住三层，任何一层松掉现象就会复发：
 *   L1 事实层：`authPhone` 必须回传 `isNewUser`；`getUserSession` 必须回传 `isRegistered`；
 *             **不得**再拿 `authState`（资料完善度口径）当「是否已注册」用。
 *   L0 表达层：注册页首屏必须是中性文案（不承诺注册/新客礼）、礼包卡受 `accountReady` 门控、
 *             每个承诺注册的入口都有一份不含「注册/新客礼」的登录态文案。
 *   L0 完成页：老号走「欢迎回来」，不再说「注册完成」、不再出现空的礼包卡。
 *
 * 用法：
 *   node miniprogram/scripts/test-auth-login-register.mjs
 *   node miniprogram/scripts/test-auth-login-register.mjs --selftest
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

const AUTH_PHONE = 'miniprogram/cloudfunctions/authPhone/index.js'
const SESSION_FN = 'miniprogram/cloudfunctions/getUserSession/index.js'
const SESSION_UTIL = 'miniprogram/utils/userSession.js'
const ONBOARD_JS = 'miniprogram/subpackages/extra/user/onboarding/index.js'
const ONBOARD_WXML = 'miniprogram/subpackages/extra/user/onboarding/index.wxml'
const DONE_JS = 'miniprogram/subpackages/extra/user/onboarding/index.js' // 2026-10-11 完成页并入注册页成功态
const DONE_WXML = 'miniprogram/subpackages/extra/user/onboarding/index.wxml'
const DIALOG_JS = 'miniprogram/subpackages/feature/components/RegisterAuthDialog/index.js'
const DIALOG_WXML = 'miniprogram/subpackages/feature/components/RegisterAuthDialog/index.wxml'
const IDENTIFY_WXML = 'miniprogram/subpackages/feature/identify/result/index.wxml'

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
/** 断言「代码」而不是注释 */
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
/** 判定「这段文案是否在承诺注册/新客礼」（用于找出哪些入口需要登录态覆盖） */
const PROMISE_WORDS = /注册|新客礼|礼包/
/**
 * 登录态文案里**禁止**的是「承诺」而不是「陈述」：
 *   ✗ 新客礼 / 完成注册 / 注册即 / 注册领 / 领取新客 / 去注册 / 立即注册
 *   ✓ 该微信已完成注册（陈述状态，正确且必要）
 */
const LOGIN_FORBIDDEN = /新客礼|(?<!已)完成注册|注册即|注册领|领取新客|去注册|立即注册/

const authPhone = stripComments(read(AUTH_PHONE))
const sessionFn = stripComments(read(SESSION_FN))
const sessionUtil = stripComments(read(SESSION_UTIL))
const onboardJs = stripComments(read(ONBOARD_JS))
const onboardWxml = read(ONBOARD_WXML)
const doneJs = stripComments(read(DONE_JS))
const doneWxml = read(DONE_WXML)
const dialogJs = stripComments(read(DIALOG_JS))
const dialogWxml = read(DIALOG_WXML)

/* ── 1) L1 事实层 ────────────────────────────────────────────────────────── */
check('★ authPhone 回传 isNewUser（内部本来就分新老）',
  /const isNewUser = !\(selfRes\.data && selfRes\.data\.length > 0\)/.test(authPhone),
  'authPhone 未计算 isNewUser')
eq('★ isNewUser 出现在全部成功返回里（3 处）',
  (authPhone.match(/isNewUser,/g) || []).length, 3)
check('★ getUserSession 回传 isRegistered（区别于 authState）',
  /const isRegistered = !!rawUser/.test(sessionFn) && /isRegistered,/.test(sessionFn),
  'getUserSession 未回传 isRegistered')
check('★ requireRegistered 不得再用 authState 当「是否已注册」',
  !/state !== 'guest'/.test(sessionUtil) && /session\.isRegistered !== undefined/.test(sessionUtil),
  'requireRegistered 仍以 authState 判定 → 已注册但没昵称的人会被反复要求注册')

/* ── 2) L0 注册页：中性首屏 + 入口文案双份 ───────────────────────────────── */
const literals = (() => {
  const pick = (name) => {
    const m = new RegExp(`const ${name} = (\\{[\\s\\S]*?\\n\\})`).exec(onboardJs)
    if (!m) return null
    // eslint-disable-next-line no-new-func
    return new Function(`return (${m[1]})`)()
  }
  return { copy: pick('COPY_BY_FROM'), login: pick('LOGIN_DEFAULT'), neutral: pick('NEUTRAL_COPY') }
})()
check('能从注册页取出 COPY_BY_FROM / LOGIN_DEFAULT / NEUTRAL_COPY（守卫不是空转）',
  !!(literals.copy && literals.login && literals.neutral))

check('★ 首屏中性文案不得承诺注册/新客礼',
  !!literals.neutral && !Object.values(literals.neutral).some((v) => LOGIN_FORBIDDEN.test(String(v))),
  JSON.stringify(literals.neutral))

check('★ 首屏 data 用中性文案（不是入口的注册文案）',
  /heroTitle: NEUTRAL_COPY\.title/.test(onboardJs) && /ctaPhoneText: NEUTRAL_COPY\.ctaPhone/.test(onboardJs))
check('★ 首屏不渲染新客礼卡（受 accountReady 门控）',
  /wx:if="\{\{accountReady && showGiftPack\}\}"/.test(onboardWxml),
  'reward-plate 未受 accountReady 门控 → 老用户首屏仍会被承诺新客礼')
check('★ onLoad 不再同步套用入口文案（竞态根因）',
  !/heroTitle: phoneOnly \? '确认联系手机' : copy\.title/.test(onboardJs)
  && /由 loadSession\(\) 按 isRegistered 落定/.test(read(ONBOARD_JS)))

// 每个承诺注册/新客礼的入口，都必须有一份「不含注册/新客礼」的登录态文案
{
  const entries = Object.entries(literals.copy || {})
  check('入口文案表非空', entries.length >= 5, `${entries.length} 个入口`)
  for (const [from, entry] of entries) {
    const registerCopy = Object.assign({}, entry)
    delete registerCopy.login
    if (!PROMISE_WORDS.test(JSON.stringify(registerCopy))) continue
    // 允许入口不带 login（会回落到 LOGIN_DEFAULT）—— 关键不变量是**合并后**不承诺
    const merged = Object.assign({}, entry, literals.login, entry.login || {})
    delete merged.login
    const bad = Object.entries(merged).filter(([, v]) => LOGIN_FORBIDDEN.test(String(v)))
    check(`★ 入口「${from}」的登录态文案不承诺注册/新客礼`, bad.length === 0,
      bad.map(([k, v]) => `${k}=${v}`).join(' / '))
  }
}

// 行为：真的跑一遍 resolveCopy（真源码 + 真文案表）
{
  const m = /function resolveCopy\(from, isRegistered\) \{[\s\S]*?\n\}/.exec(onboardJs)
  check('能取出 resolveCopy 真源码', !!m)
  if (m) {
    // eslint-disable-next-line no-new-func
    const resolveCopy = new Function('COPY_BY_FROM', 'LOGIN_DEFAULT', `${m[0]}; return resolveCopy`)(
      literals.copy, literals.login
    )
    const hits = Object.keys(literals.copy).filter((from) => LOGIN_FORBIDDEN.test(JSON.stringify(resolveCopy(from, true))))
    check('★ resolveCopy(from, true) 对所有入口都不承诺注册/新客礼', hits.length === 0, hits.join(','))
    const newUserOk = Object.keys(literals.copy).every((from) =>
      JSON.stringify(resolveCopy(from, false)) === JSON.stringify(literals.copy[from]))
    check('resolveCopy(from, false) 原样返回注册文案（新号行为不变）', newUserOk)
  }
}

/* ── 3) L0 完成页：老号走「欢迎回来」 ────────────────────────────────────── */
check('★ 完成页读取新老标记（options.isNew）', /const isNewUser = options\.isNew !== '0'/.test(doneJs))
check('★ 完成页有「欢迎回来」分支（且文案是确认口径，不提礼包）',
  /welcomeBack: !isNewUser && !hasReturn/.test(doneJs)
  && /wx:elif="\{\{welcomeBack\}\}"[\s\S]{0,120}手机号已确认，账号里的礼券与记录都还在/.test(doneWxml),
  '缺少 welcomeBack 的 desc 分支 → 老号会看到「新客礼已放入账户」')
check('★ 老号不再被说成「注册完成」', /isNewUser \? '注册已完成。/.test(doneWxml) && /'手机号已确认。/.test(doneWxml))
check('★ 老号不会出现空礼包卡（0 张礼券）',
  /\(isNewUser \|\| giftCoupons > 0\)/.test(doneWxml),
  'done-gifts 未按新老/券数门控')
check('★ 注册页把新老标记透传给成功态', /isNew: isNewUser \? '1' : '0'/.test(onboardJs))

/* ── 4) L0 授权弹窗 + 鉴定页 ─────────────────────────────────────────────── */
check('★ 弹窗自己判断是否已注册', /ensureSession\(null\)/.test(dialogJs) && /isRegistered: true/.test(dialogJs))
check('★ 弹窗对老号不展示「新客礼包自动到账」',
  /wx:if="\{\{!isRegistered\}\}"/.test(dialogWxml) && /loginTitle/.test(dialogWxml))
check('★ 鉴定页弹窗 desc 不再承诺新客礼', !PROMISE_WORDS.test(
  (/"desc="([^"]*)"/.exec(read(IDENTIFY_WXML).split('<register-auth-dialog')[1] || '') || [, ''])[1]
))

/* ── 5) 埋点分开 ─────────────────────────────────────────────────────────── */
check('★ 注册/登录成功分开埋点',
  /auth_register_success/.test(onboardJs) && /auth_login_success/.test(onboardJs),
  '仍只有 onboarding_* 一条线 → 新老不可度量')

/* ── 输出 / 自检 ─────────────────────────────────────────────────────────── */
if (process.argv.includes('--selftest')) {
  selftest()
} else if (failed) {
  console.log('✗ 登录/注册口径检查失败：')
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`✗ ${failed} 项失败 / ${passed} 项通过`)
  process.exit(1)
} else {
  console.log(`✓ 登录/注册口径：${passed} 项通过（事实层回传新老 / 首屏中性不承诺 / 入口各有登录态文案 / 完成页分支）`)
}

function selftest() {
  const injections = [
    {
      name: 'authPhone 不再回传 isNewUser',
      file: AUTH_PHONE,
      from: '    const isNewUser = !(selfRes.data && selfRes.data.length > 0)',
      to: '    const isNewUserUnused = true'
    },
    {
      name: 'getUserSession 不再回传 isRegistered',
      file: SESSION_FN,
      from: '      isRegistered,',
      to: ''
    },
    {
      name: 'requireRegistered 退回 authState 判据',
      file: SESSION_UTIL,
      from: "  const registered = session.isRegistered !== undefined\n    ? !!session.isRegistered\n    : !!(session.onboardingDone || (session.user && session.user.phone))\n  if (registered) return true",
      to: "  const state = session.authState || resolveAuthState(session.user)\n  if (state !== 'guest' && session.user && session.user.nickName) return true"
    },
    {
      name: '首屏中性文案被换成注册承诺',
      file: ONBOARD_JS,
      from: "  title: '授权手机号即可继续',\n  desc: '正在确认账号…',",
      to: "  title: '注册即领新客礼',\n  desc: '授权手机号即可完成注册，新客礼放入账户。',"
    },
    {
      name: '礼包卡丢掉 accountReady 门控',
      file: ONBOARD_WXML,
      from: 'wx:if="{{accountReady && showGiftPack}}"',
      to: 'wx:if="{{showGiftPack}}"'
    },
    {
      name: '登录态兜底文案开始承诺新客礼（老号又被空承诺）',
      file: ONBOARD_JS,
      from: "  desc: '该微信已完成注册，授权手机号即可确认身份继续。',",
      to: "  desc: '该微信已完成注册，授权手机号即可继续并领取新客礼。',"
    },
    {
      name: '完成页丢掉「欢迎回来」分支',
      file: DONE_WXML,
      from: "    <text class=\"done-desc\" wx:elif=\"{{welcomeBack}}\">手机号已确认，账号里的礼券与记录都还在。</text>\n",
      to: ''
    },
    {
      name: '注册/登录埋点合并回一条线',
      file: ONBOARD_JS,
      from: "      trackBehavior(\n        payload.isNewUser === false ? 'auth_login_success' : 'auth_register_success',\n        'from',\n        this.data.from || 'onboarding'\n      )",
      to: ''
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
