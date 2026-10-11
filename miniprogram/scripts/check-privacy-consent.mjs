#!/usr/bin/env node
/**
 * 注册 / 登录 / 授权手机号 · 协议主动勾选守卫（2026-10-11）
 *
 * 起因：微信审核驳回「默认自动同意《用户服务协议》及《隐私政策》，应当由用户自主阅读后自行选择是否同意」。
 *   被驳回的写法是祈福墙注册弹层：主按钮「同意并一键注册」+ 小字「点击即表示同意」，没有勾选框。
 *
 * 钉住：
 *   ① 小程序 / ERP / 官网源码不得出现「即表示同意 / 即视为同意 / 同意并注册 / 同意并一键注册 / 同意并登录」；
 *   ② 每个授权手机号入口都有「我已阅读并同意《用户服务协议》和《隐私政策》」勾选行，
 *      协议名用 catchtap 打开协议页（点协议名 ≠ 勾选）；
 *   ③ 勾选初始值为 false，只能由用户点击翻转（不得从缓存 / 会话 / 已注册态预置为 true）；
 *   ④ 全部 open-type="getPhoneNumber" 按钮都受勾选变量门控（wx:if 或动态 open-type），
 *      未勾时的那个按钮不带 open-type；授权回调首行再挡一次；
 *   ⑤ 勾选 / 未勾提示里不弹确认框、不代用户勾选（不得用弹窗代用户勾选）。
 *
 * 用法：
 *   node miniprogram/scripts/check-privacy-consent.mjs
 *   node miniprogram/scripts/check-privacy-consent.mjs --selftest   # 内存注入，不写盘
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

const FORBIDDEN = /即表示同意|即视为同意|同意并注册|同意并一键注册|同意并登录/
const SCAN_ROOTS = ['miniprogram', 'admin/src', 'src']
const SCAN_EXT = /\.(js|wxml|json|vue|astro|ts|mjs)$/
const SKIP = new Set(['node_modules', '.git', 'miniprogram_npm', 'dist', 'scripts', 'docs'])

/** 授权手机号入口：勾选变量名 + 授权回调名 */
const ENTRIES = [
  {
    name: '共用注册弹层（祈福墙 / 图鉴详情 / 鉴定结果）',
    wxml: 'miniprogram/subpackages/feature/components/RegisterAuthDialog/index.wxml',
    js: 'miniprogram/subpackages/feature/components/RegisterAuthDialog/index.js',
    flag: 'agreed',
    handler: 'onGetPhoneNumber',
    toggle: 'onToggleAgree',
    blocked: 'onCtaBlocked'
  },
  {
    name: '注册页（门店码 / 收银台码 / 礼赠领取 / 我的 等都跳这里）',
    wxml: 'miniprogram/subpackages/extra/user/onboarding/index.wxml',
    js: 'miniprogram/subpackages/extra/user/onboarding/index.js',
    flag: 'agreed',
    handler: 'onGetPhoneNumber',
    toggle: 'toggleAgree',
    blocked: 'nudgeAgree'
  },
  {
    name: '个人资料页「手机号快捷绑定」',
    wxml: 'miniprogram/subpackages/extra/user/profile/index.wxml',
    js: 'miniprogram/subpackages/extra/user/profile/index.js',
    flag: 'phoneAgreed',
    handler: 'onGetPhoneNumber',
    toggle: 'togglePhoneAgree',
    blocked: 'onPhoneBindBlocked'
  }
]

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (SCAN_EXT.test(name)) out.push(relative(ROOT, p))
  }
  return out
}

function loadFiles() {
  const files = {}
  for (const r of SCAN_ROOTS) for (const rel of walk(join(ROOT, r))) files[rel] = readFileSync(join(ROOT, rel), 'utf8')
  return files
}

const stripJs = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const stripWxml = (s) => String(s).replace(/<!--[\s\S]*?-->/g, ' ')

const fnBody = (src, name) => {
  const m = new RegExp(`(^|\\n)\\s*(async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{`).exec(src)
  if (!m) return ''
  const open = m.index + m[0].length - 1
  let d = 0
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') d++
    else if (src[j] === '}') { d--; if (d === 0) return src.slice(open + 1, j) }
  }
  return ''
}

let failures = 0
const check = (name, ok, detail) => {
  if (!ok) { failures++; console.error(`✗ ${name}${detail ? `\n    ${detail}` : ''}`) }
  else console.log(`✓ ${name}`)
}

/** 按钮标签是否受勾选门控：wx:if="{{flag}}"（无取反）或 open-type 表达式以 flag 为条件 */
function phoneButtonGated(tag) {
  const ifm = /wx:(?:el)?if="\{\{\s*([^}]*)\}\}"/.exec(tag)
  if (ifm && /^\s*\w*[aA]greed\b/.test(ifm[1]) && !/!\s*\w*[aA]greed/.test(ifm[1])) return true
  return /open-type="\{\{\s*\w*[aA]greed\b[^}?]*\?\s*'getPhoneNumber'\s*:\s*''\s*\}\}"/.test(tag)
}

function runChecks(files) {
  failures = 0

  const hits = Object.entries(files).filter(([, s]) => FORBIDDEN.test(s)).map(([f]) => f)
  check('★ 源码不出现「即表示同意 / 即视为同意 / 同意并注册 / 同意并一键注册 / 同意并登录」',
    hits.length === 0, hits.join(', '))

  const ungated = []
  for (const [rel, src] of Object.entries(files)) {
    if (!rel.startsWith('miniprogram/') || !rel.endsWith('.wxml')) continue
    for (const tag of stripWxml(src).match(/<button\b[^>]*>/g) || []) {
      if (/getPhoneNumber/.test(tag) && !phoneButtonGated(tag)) ungated.push(`${rel}: ${tag.replace(/\s+/g, ' ').slice(0, 120)}`)
    }
  }
  check('★ 全部 getPhoneNumber 按钮都受协议勾选门控（未勾时绝不弹微信授权）', ungated.length === 0, ungated.join('\n    '))

  for (const e of ENTRIES) {
    const wxml = stripWxml(files[e.wxml] || '')
    const js = stripJs(files[e.js] || '')
    check(`${e.name}：文件存在`, wxml.length > 0 && js.length > 0)

    check(`★ ${e.name}：有「我已阅读并同意《用户服务协议》和《隐私政策》」勾选行`,
      /我已阅读并同意/.test(wxml) && /《用户服务协议》/.test(wxml) && /《隐私政策》/.test(wxml))
    const linkTags = wxml.match(/<text\b[^>]*>《(?:用户服务协议|隐私政策)》<\/text>/g) || []
    check(`★ ${e.name}：协议名用 catchtap 打开（点协议名不等于勾选）`,
      linkTags.length === 2 && linkTags.every((t) => /catchtap=/.test(t) && !/bindtap=/.test(t)))

    const assigns = [...js.matchAll(new RegExp(`\\b${e.flag}\\s*:\\s*([^,\\n}]+)`, 'g'))].map((m) => m[1].trim())
    const allowed = new Set(['false', `!this.data.${e.flag}`])
    check(`★ ${e.name}：勾选初始值为 false，且只能由用户点击翻转`,
      assigns.includes('false') && assigns.every((v) => allowed.has(v)) && !new RegExp(`data\\.${e.flag}\\s*=`).test(js),
      `赋值：${JSON.stringify(assigns)}`)

    const handler = fnBody(js, e.handler)
    check(`★ ${e.name}：授权回调首段再挡一次未勾选`,
      new RegExp(`if\\s*\\([^)]*!this\\.data\\.${e.flag}\\b`).test(handler.slice(0, 200)))

    const btns = (wxml.match(/<button\b[^>]*>/g) || []).filter((t) => /getPhoneNumber|wx:else/.test(t))
    const elseBtn = btns.find((t) => /wx:else/.test(t))
    if (elseBtn) {
      check(`★ ${e.name}：未勾选时的按钮不带 open-type`, !/open-type=/.test(elseBtn))
    }
    const toggle = fnBody(js, e.toggle)
    const blocked = fnBody(js, e.blocked)
    check(`★ ${e.name}：勾选 / 未勾提示里不弹确认框、不代用户勾选`,
      toggle.length > 0 && blocked.length > 0
      && !/wx\.showModal\s*\(/.test(toggle + blocked)
      && !new RegExp(`${e.flag}\\s*:\\s*true|${e.toggle}\\(`).test(blocked))
  }
  return failures === 0
}

function selftest() {
  const base = loadFiles()
  let bad = 0
  const t = (name, ok) => { if (!ok) { bad++; console.error(`✗ ${name}`) } else console.log(`✓ ${name}`) }
  const quiet = (fn) => {
    const l = console.log; const e = console.error
    console.log = () => {}; console.error = () => {}
    try { return fn() } finally { console.log = l; console.error = e }
  }
  t('基线：当前仓库通过全部断言', quiet(() => runChecks(base)))

  const D = ENTRIES[0]; const O = ENTRIES[1]; const P = ENTRIES[2]
  const injections = [
    ['弹层恢复「点击即表示同意」小字', D.wxml, (s) => s.replace('<text>我已阅读并同意</text>', '<text>点击即表示同意</text>')],
    ['祈福墙按钮文案恢复「同意并一键注册」', 'miniprogram/subpackages/feature/wish-wall/index.wxml',
      (s) => s.replace(/cta="一键注册"/, 'cta="同意并一键注册"')],
    ['ERP 报表标签写回「同意并一键注册」', 'admin/src/utils/analyticsSchema.js', (s) => s.replace('点「一键注册」', '点「同意并一键注册」')],
    ['弹层勾选默认为已勾', D.js, (s) => s.replace('agreed: false,', 'agreed: true,')],
    ['注册页按已注册态自动勾上', O.js, (s) => s.replace('agreed: false,', 'agreed: !!(u.agreedTermsAt || u.phone),')],
    ['资料页从缓存预置勾选', P.js, (s) => s.replace('phoneAgreed: false,', "phoneAgreed: !!wx.getStorageSync('agreed'),")],
    ['弹层授权按钮去掉勾选门控（永远可弹授权）', D.wxml, (s) => s.replace(/\n\s*wx:if="\{\{agreed\}\}"/, '')],
    ['弹层未勾按钮也带上 getPhoneNumber', D.wxml, (s) => s.replace('class="rad-cta is-off"', 'class="rad-cta is-off"\n      open-type="getPhoneNumber"')],
    ['注册页 open-type 不再看勾选', O.wxml, (s) => s.replace(/open-type="\{\{agreed && !saving \? 'getPhoneNumber' : ''\}\}"/, "open-type=\"{{!saving ? 'getPhoneNumber' : ''}}\"")],
    ['资料页绑定按钮门控写反（未勾才可授权）', P.wxml, (s) => s.replace('wx:if="{{phoneAgreed}}"', 'wx:if="{{!phoneAgreed}}"')],
    ['新增一个不受门控的手机号按钮', 'miniprogram/subpackages/feature/detail/wiki-detail/index.wxml',
      (s) => s + '\n<button open-type="getPhoneNumber" bindgetphonenumber="x">授权</button>\n'],
    ['弹层授权回调不再挡未勾选', D.js, (s) => s.replace('if (this.data.saving || !this.data.agreed) return\n      const detail', 'if (this.data.saving) return\n      const detail')],
    ['弹层协议名改成 bindtap（点协议名会顺带勾选）', D.wxml, (s) => s.replace(/catchtap="onAgreementTap">《隐私政策》/, 'bindtap="onAgreementTap">《隐私政策》')],
    ['资料页删掉《隐私政策》入口', P.wxml, (s) => s.replace(/<text[^>]*>《隐私政策》<\/text>/, '')],
    ['注册页用 showModal 代用户勾选', O.js, (s) => s.replace('nudgeAgree() {', "nudgeAgree() {\n    wx.showModal({ title: '同意协议', success: () => this.toggleAgree() })")]
  ]
  for (const [label, target, mut] of injections) {
    const orig = base[target] || ''
    const mutated = mut(orig)
    t(`注入可生效：${label}`, mutated !== orig)
    const detected = quiet(() => !runChecks({ ...base, [target]: mutated }))
    t(`★ 被检出：${label}`, detected)
  }
  t('★ 还原后守卫恢复通过（内存注入，未写盘）', quiet(() => runChecks(loadFiles())))
  if (bad) { console.error(`\n自检失败 ${bad} 项——守卫不可信`); process.exit(1) }
  console.log(`\n自检通过：${injections.length} 个回归注入全部被检出（内存注入，不写盘）`)
}

if (process.argv.includes('--selftest')) {
  selftest()
} else {
  const ok = runChecks(loadFiles())
  if (!ok) { console.error('\n协议主动勾选断言失败：见上'); process.exit(1) }
  console.log('\n✓ 协议主动勾选断言全部通过')
}
