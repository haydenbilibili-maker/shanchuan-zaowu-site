#!/usr/bin/env node
/**
 * 注册门禁与一键注册 行为守卫（2026-09-17）
 *
 * 需求：
 *   ① 未登录/注册态：**百科详情页整页灰色模糊**，且**不提供「再看看」**；
 *   ② 不跳注册页：在页面**原地**弹授权弹窗，授权成功即默认注册成功；
 *   ③ 弹窗样式与全站视觉对齐（博物黑 + 铜金铭牌）。
 *
 * 为什么必须有这个守卫：
 *   - 「门禁」最容易被改坏成「只弹个可关的框」—— 内容照样能看，门禁形同不存在，
 *     而静态截图/肉眼一时看不出来（本次就是用户指出「不提供再看看」才发现口径要收紧）。
 *   - `getPhoneNumber` **只能**由 `<button open-type="getPhoneNumber">` 触发，
 *     一旦有人图省事改用 `wx.showModal` 或程序化调用，授权会**静默失效**（拿不到 code），
 *     表现是「点了没反应」，而不是报错。
 *   - 注册链路如果被复制出第二份，两份必然漂移（新客礼、finishRegistration 语义都在链上）。
 *
 * 用法：
 *   node miniprogram/scripts/test-register-gate.mjs
 *   node miniprogram/scripts/test-register-gate.mjs --selftest
 * 退出码：任一断言失败为 1。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')

const F = {
  chain: 'subpackages/feature/utils/registerPhone.js',
  dialogJs: 'subpackages/feature/components/RegisterAuthDialog/index.js',
  dialogWxml: 'subpackages/feature/components/RegisterAuthDialog/index.wxml',
  dialogWxss: 'subpackages/feature/components/RegisterAuthDialog/index.wxss',
  dialogJson: 'subpackages/feature/components/RegisterAuthDialog/index.json',
  wikiJs: 'subpackages/feature/detail/wiki-detail/index.js',
  wikiWxml: 'subpackages/feature/detail/wiki-detail/index.wxml',
  wikiWxss: 'subpackages/feature/detail/wiki-detail/index.wxss',
  wikiJson: 'subpackages/feature/detail/wiki-detail/index.json',
  resultJs: 'subpackages/feature/identify/result/index.js',
  resultWxml: 'subpackages/feature/identify/result/index.wxml',
  resultWxss: 'subpackages/feature/identify/result/index.wxss',
  resultJson: 'subpackages/feature/identify/result/index.json',
  // 祈福墙：注册**软钩子**（口径与上面两处硬门禁相反，见需求28 玩法专项 §1 与 §4）
  wallJs: 'subpackages/feature/wish-wall/index.js',
  wallWxml: 'subpackages/feature/wish-wall/index.wxml',
  wallJson: 'subpackages/feature/wish-wall/index.json'
}

const read = (rel) => {
  const p = join(MP, rel)
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

/**
 * 剥掉注释再断言。
 * 为什么要：第一版守卫用「注释里提到的字面量」把自己判失败了 ——
 * 我的注释里写了「不再跳 extra/user/onboarding」「不提供『再看看』」，
 * 负向断言立刻命中。**守卫必须查代码，不查注释**（同 check:require-paths 的做法）。
 */
const stripJs = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const stripWxml = (s) => String(s).replace(/<!--[\s\S]*?-->/g, ' ')

/**
 * 取**某个注册弹窗自己的标签**（`<register-auth-dialog … >`，按 `show` 表达式定位）。
 *
 * 为什么要：祈福墙这一页现在有 **3 个** `<register-auth-dialog>`（注册弹窗 / 连灯门禁 / 功德证门禁），
 * 三个都写 `closable="{{true}}"`。早先的断言写成 `/closable="\{\{true\}\}"/.test(整页)` ——
 * 它只要求"整页某处有 closable=true"，**判据与对象脱钩**：把注册弹窗改成硬门禁，
 * 另外两个弹窗的 closable 照样让它绿（2026-09-19 自检注入实测到的假绿，错题本 E7）。
 * 断言必须绑到**那个弹窗自己的标签**上。
 */
const dialogTag = (src, showExpr) => {
  const m = String(src).match(
    new RegExp(`<register-auth-dialog\\b[^>]*show="\\{\\{${showExpr}\\}\\}"[^>]*>`)
  )
  return m ? m[0] : ''
}

/**
 * 按**括号配平**取一个函数的函数体。
 * 为什么要：断言"关掉弹窗有没有清空草稿"这类事必须限定在**那个函数内部**，
 * 用固定长度切片会越界到下一个函数、用正则到第一个 `}` 又会截断（错题本 E7）。
 */
const fnBody = (src, name) => {
  const i = String(src).indexOf(name)
  if (i < 0) return ''
  const open = String(src).indexOf('{', i)
  if (open < 0) return ''
  let d = 0
  for (let j = open; j < String(src).length; j++) {
    const c = src[j]
    if (c === '{') d++
    else if (c === '}') { d--; if (d === 0) return String(src).slice(open + 1, j) }
  }
  return ''
}

let failures = 0
const eq = (name, got, want) => {
  const ok = got === want
  if (!ok) { failures++; console.error(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`) }
  else console.log(`✓ ${name}`)
}
const check = (name, ok, detail) => {
  if (!ok) { failures++; console.error(`✗ ${name}${detail ? `\n    ${detail}` : ''}`) }
  else console.log(`✓ ${name}`)
}

/**
 * 门禁页拒绝出口：弹窗标签 closable=true + close-text「先不注册」+ mask-closable=false + bind:close=handler；
 * handler 里离开本页（navigateBack / switchTab / reLaunch），且**不**把 registerGated 置 false。
 */
function gateExitOk(wxml, js, showVar) {
  const tag = (stripWxml(wxml).match(/<register-auth-dialog\b[^>]*>/g) || [])
    .find((t) => new RegExp(`show="\\{\\{${showVar}\\}\\}"`).test(t)) || ''
  const handlerName = (/bind:close="(\w+)"/.exec(tag) || [])[1]
  if (!handlerName) return false
  const src = stripJs(js)
  const m = new RegExp(`\\n\\s*${handlerName}\\s*\\([^)]*\\)\\s*\\{`).exec(src)
  if (!m) return false
  const body = src.slice(m.index + m[0].length, (src.slice(m.index + m[0].length).search(/\n  \}/) + m.index + m[0].length))
  return /closable="\{\{true\}\}"/.test(tag) && /close-text="先不注册"/.test(tag)
    && /mask-closable="\{\{false\}\}"/.test(tag)
    && /navigateBack|switchTab|reLaunch|goHomeTab/.test(body)
    && !/registerGated:\s*false/.test(body)
}

function runChecks(r) {
  // ── 链路唯一出处 ───────────────────────────────────────────────
  check('注册链路 util 存在', r.chain.length > 0)
  check('链路按序调用 authPhone', /name:\s*'authPhone'/.test(r.chain))
  check('链路用 finishRegistration:true（与注册页同语义）', /finishRegistration:\s*true/.test(r.chain))
  check('链路在 finished 之外会补 upsertUserProfile', /name:\s*'upsertUserProfile'/.test(r.chain))
  // ⚠️ 必须断言**调用**而非「出现过这个名字」：第一版只匹配了标识符，
  // 注入把两处 `await refreshSessionAfterAuth(app)` 全删掉后仍然通过（假阴性，自检抓出）。
  // 两条分支（finished / 需补 upsert）都要 refresh，所以要求 ≥2 次调用。
  {
    const calls = (r.chain.match(/await\s+refreshSessionAfterAuth\(/g) || []).length
    check('链路在两处分支都调用 refreshSessionAfterAuth（否则 ensureSession 一直是 guest）',
      calls >= 2, `实际调用 ${calls} 次（需 ≥2）`)
  }

  // ── 弹窗组件 ──────────────────────────────────────────────────
  check('弹窗组件四件套齐全', !!(r.dialogJs && r.dialogWxml && r.dialogWxss && r.dialogJson))
  // 2026-10-11：弹层改为「未勾协议 / 已勾协议」两个按钮后，判据必须落在**同一个** <button> 标签上，
  // 否则未勾那颗普通按钮会让「授权按钮被改成 view」的注入假绿（错题本 E7）。
  check('★ 授权按钮是 button open-type="getPhoneNumber"（唯一合法触发方式）',
    (stripWxml(r.dialogWxml).match(/<button\b[^>]*>/g) || [])
      .some((tag) => /open-type="[^"]*getPhoneNumber/.test(tag) && /bindgetphonenumber=/.test(tag)))
  check('★ 弹窗复用唯一链路，而不是自己拼一遍云函数',
    /require\(['"][^'"]*registerPhone['"]\)/.test(r.dialogJs) && !/name:\s*'authPhone'/.test(r.dialogJs))
  check('★ 弹窗不再跳注册页（不出现 navigateToOnboarding / onboarding 路径）',
    !/navigateToOnboarding/.test(stripJs(r.dialogJs)) && !/user\/onboarding/.test(stripJs(r.dialogJs)))
  check('★ 关闭入口受 closable 控制（门禁场景不渲染）',
    /wx:if="\{\{closable\}\}"/.test(r.dialogWxml) && /closable/.test(r.dialogJs))
  check('弹窗样式使用全站设计令牌（--gold / 博物黑），不是系统默认样式',
    /var\(--gold/.test(r.dialogWxss) && /#1A1814|--color-bg|--bg-root/.test(r.dialogWxss))

  // ── 百科详情页：整页模糊门禁 + 无「再看看」────────────────────
  check('★ 百科详情页注册了注册弹窗组件', /register-auth-dialog/.test(stripJs(r.wikiJson)))
  check('★ 百科详情页对 guest 置 registerGated', /registerGated:\s*true/.test(r.wikiJs))
  // 2026-10-11 产品负责人拍板：门禁页也给「先不注册」拒绝出口（审核「强制注册」风险），
  // 但拒绝 = 离开本页，**不解模糊**；点遮罩不关，只认按钮。口径见 gateExitOk。
  check('★ 门禁弹窗有「先不注册」出口：关掉即离开本页，不解模糊',
    gateExitOk(r.wikiWxml, r.wikiJs, 'registerGated'))
  check('★ 百科详情页门禁路径不含「再看看」「先看看」文案',
    !/再看看|先看看/.test(stripWxml(r.wikiWxml)))
  check('★ 整页灰色模糊（filter blur + grayscale）且挡点击',
    /\.wd-gate\.is-gated/.test(r.wikiWxss) && /blur\(/.test(r.wikiWxss)
    && /grayscale\(/.test(r.wikiWxss) && /pointer-events:\s*none/.test(r.wikiWxss))
  check('★ 注册成功后解除门禁', /onRegisterSuccess/.test(r.wikiJs) && /registerGated:\s*false/.test(r.wikiJs))
  check('门禁判定失败时不拦（宁可少拦，不锁死档案）',
    /catch[\s\S]{0,220}evaluateRegisterGate/.test(r.wikiJs))

  // ── 鉴定结果页：原地授权 ───────────────────────────────────────
  check('★ 结果页注册了注册弹窗组件', /register-auth-dialog/.test(stripJs(r.resultJson)))
  check('★ 结果页改为原地弹窗（不再 navigate 注册页）', /showRegisterDialog:\s*true/.test(r.resultJs))
  check('★ 结果页门禁有「先不注册」出口：关掉即离开本页，不解模糊（文案不含先看看）',
    gateExitOk(r.resultWxml, r.resultJs, 'showRegisterDialog')
    && !/再看看|先看看/.test(stripWxml(r.resultWxml)))
  check('★ 结果页正文整页灰色模糊（blur + grayscale + 挡点击）',
    /\.rg-gate\.is-gated/.test(r.resultWxss) && /blur\(/.test(r.resultWxss)
    && /grayscale\(/.test(r.resultWxss) && /pointer-events:\s*none/.test(r.resultWxss))
  check('★ 结果页门禁位与模糊层联动（置位与解除成对）',
    /registerGated:\s*true/.test(r.resultJs) && /registerGated:\s*false/.test(r.resultJs)
    && /rg-gate \{\{registerGated/.test(stripWxml(r.resultWxml)))
  check('★ 模糊层不包裹 fixed 浮层（否则 filter 会创建包含块、带偏 fixed 定位）',
    /rg-gate[\s\S]*?fb-mask/.test(stripWxml(r.resultWxml))
    && stripWxml(r.resultWxml).indexOf('</view>\n  </block>') > 0)
  check('结果页有成功回调与关闭回调', /onRegisterSuccess/.test(r.resultJs) && /onRegisterDialogClose/.test(r.resultJs))

  // ── 祈福墙：注册**软钩子**（口径与上面两处硬门禁相反）──────────────────
  // 产品口径（2026-09-18）：祈福墙是**注册转化路径**，但「浏览与仪式免费（价值先行），
  // 落愿这一步才要身份」。所以本页刻意**不**整页模糊、**closable=true**、**关掉保草稿**、
  // 注册成功后**自动续发**那条心愿。
  // 断言必须按本页自己的口径写 —— 照抄百科页的 closable=false 就是断言错口径（错题本 E7）。
  const wallJs = stripJs(r.wallJs)
  const wallWxml = stripWxml(r.wallWxml)
  check('★ 祈福墙注册了注册弹窗组件', /register-auth-dialog/.test(stripJs(r.wallJson)))
  {
    const submit = fnBody(wallJs, 'submitWish')
    check('★ 祈福墙落愿路径：未注册就地弹注册（不让用户跳走）',
      /showRegisterDialog:\s*true/.test(submit))
    check('★ 落愿路径记漏斗 step=show（曝光可量化，否则漏斗第一环缺失）',
      /wish_wall_register_gate[\s\S]{0,160}step:\s*'show'/.test(submit))
    check('★ 防死循环：续发时跳过门禁（否则会话未刷新 → 又弹一次 → 死循环）',
      /if\s*\(\s*!resumingAfterRegister\s*&&\s*await\s+this\.isGuestUser\(\)\s*\)/.test(submit)
      && /_resumeAfterRegister\s*=\s*false/.test(submit))
  }
  const wishDialog = dialogTag(wallWxml, 'showRegisterDialog')
  check('★ 祈福墙弹窗是**软钩子**：closable=true（与硬门禁刻意相反，不困住用户）',
    wishDialog.length > 0 && /closable="\{\{true\}\}"/.test(wishDialog))
  {
    // 「同类错误第二次」的补丁：只钉住注册弹窗时，同页另外两个门禁弹窗（连灯 / 功德证）
    // 被谁改成闭不掉的硬门禁**没有任何断言会发现** —— 而本页口径是"三个都是软钩子"
    // （每个弹窗自己的注释都写明 closable=true 的理由）。所以这里断言**整页所有**注册弹窗都是软的。
    const dialogs = wallWxml.match(/<register-auth-dialog\b[^>]*>/g) || []
    check('★ 祈福墙三个注册弹窗**全部**是软钩子（一个都不许变成闭不掉的硬门禁）',
      dialogs.length >= 3 && dialogs.every((tag) => /closable="\{\{true\}\}"/.test(tag)))
  }
  {
    const ok = fnBody(wallJs, 'onRegisterSuccess')
    check('★ 注册成功后自动续发那条心愿（意图不该丢）',
      // ⚠️ 2026-09-21（P2-8）：续发抽成 `resumeWishAfterRegister()` —— 终点要等
      // `submitWish` 的**真实结果**，所以这里锚"调了那次续发"，而不是锚 submitWish 的字面量。
      /_resumeAfterRegister\s*=\s*true/.test(ok) && /draft:\s*text/.test(ok)
      && /this\.resumeWishAfterRegister\(\)/.test(ok))
    check('★ 注册成功记 step=resume_success（按续发真实结果分支）',
      // 终点现在在 `resumeWishAfterRegister` 里：成功 resume_success、失败 fail_resume。
      // 判据语义不变：**成功那条路的 step 仍然是 resume_success**（报表的终点行靠它）。
      /resumeWishAfterRegister\(\)\s*\{[\s\S]{0,600}?'resume_success'/.test(wallJs) &&
      /this\.trackRitualGate\(ok === true \? 'resume_success' : 'fail_resume'\)/.test(wallJs))
  }
  {
    const close = fnBody(wallJs, 'onRegisterDialogClose')
    check('★ 关掉弹窗只丢「待发」，**草稿保留**（回来还是那句话）',
      /_pendingWish\s*=\s*''/.test(close) && !/draft\s*:/.test(close))
    check('★ 关掉弹窗记 step=dismiss', /step:\s*'dismiss'/.test(close))
  }
  check('★ 祈福墙漏斗四环齐全（show / go_register / dismiss / fail_*）',
    ['show', 'go_register', 'dismiss'].every((s) => wallJs.includes(`step: '${s}'`))
    && /step:\s*`fail_/.test(wallJs))

  return failures === 0
}

const snapshot = () => {
  const r = {}
  for (const [k, rel] of Object.entries(F)) r[k] = read(rel)
  return r
}

function selftest() {
  const files = snapshot()
  const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12)
  let bad = 0
  const t = (name, ok) => { if (!ok) { bad++; console.error(`✗ ${name}`) } else console.log(`✓ ${name}`) }

  // 基线必须通过
  failures = 0
  t('基线：当前仓库通过全部断言', runChecks(files))

  // 逐个注入回归：必须被检出，且还原后字节一致
  const injections = [
    ['把授权按钮改成普通 view（授权静默失效）', F.dialogWxml,
      (s) => s.replace(/<button/, '<view').replace(/bindgetphonenumber="onGetPhoneNumber"/, '')],
    ['弹窗自己拼云函数（绕过唯一链路）', F.dialogJs,
      (s) => s.replace(/require\(['"][^'"]*registerPhone['"]\)/, "require('../../utils/noop')")
        .replace('const res = await registerWithPhone({ app, phoneCode: detail.code })',
          "const res = await wx.cloud.callFunction({ name: 'authPhone', data: { code: detail.code } })")],
    ['百科门禁拒绝后解除模糊（拒绝即可看全文，门禁形同不存在）', F.wikiJs,
      (s) => s.replace(/onRegisterDialogClose\(\) \{\n/, 'onRegisterDialogClose() {\n    this.setData({ registerGated: false });\n')],
    ['百科门禁去掉「先不注册」出口（又成关不掉的门禁）', F.wikiWxml,
      (s) => s.replace(/closable="\{\{true\}\}"/, 'closable="{{false}}"')],
    ['去掉整页模糊（只弹窗不门禁）', F.wikiWxss,
      (s) => s.replace(/\.wd-gate\.is-gated \{[\s\S]*?\}/, '.wd-gate.is-gated { opacity: 1; }')],
    ['链路丢掉 refreshSessionAfterAuth（注册后仍判为 guest）', F.chain,
      (s) => s.replace(/await refreshSessionAfterAuth\(app\)/g, '')],
    ['结果页门禁拒绝后解除模糊', F.resultJs,
      (s) => s.replace(/onRegisterDialogClose\(\) \{\n/, 'onRegisterDialogClose() {\n    this.setData({ showRegisterDialog: false, registerGated: false })\n')],
    ['结果页点遮罩也会关（误触即离开）', F.resultWxml,
      (s) => s.replace(/mask-closable="\{\{false\}\}"/, 'mask-closable="{{true}}"')],
    ['结果页去掉整页模糊（只弹窗不门禁）', F.resultWxss,
      (s) => s.replace(/\.rg-gate\.is-gated \{[\s\S]*?\}/, '.rg-gate.is-gated { opacity: 1; }')],
    ['百科详情页忘记给 guest 置门禁', F.wikiJs,
      (s) => s.replace(/registerGated:\s*true/, 'registerGated: false')],
    // 祈福墙软钩子：口径与硬门禁相反，这几条注入证明「本页口径」也被钉住了
    ['祈福墙注册弹窗被改成硬门禁（closable=false，把用户困住）', F.wallWxml,
      (s) => s.replace(/<register-auth-dialog\b[^>]*show="\{\{showRegisterDialog\}\}"[^>]*>/,
        (tag) => tag.replace(/closable="\{\{true\}\}"/, 'closable="{{false}}"'))],
    // 只改**第三个**弹窗（功德证门禁），前两个仍是 closable=true：
    // 旧判据「整页某处有 closable=true」在这条注入下**必然假绿** —— 这就是它当年漏掉的那类错。
    ['祈福墙功德证门禁弹窗被改成硬门禁（注册弹窗仍为软，旧判据会假绿）', F.wallWxml,
      (s) => s.replace(/<register-auth-dialog\b[^>]*show="\{\{showCertDialog\}\}"[^>]*>/,
        (tag) => tag.replace(/closable="\{\{true\}\}"/, 'closable="{{false}}"'))],
    ['祈福墙落愿不再弹注册（转化链路断掉）', F.wallJs,
      (s) => s.replace(/this\.setData\(\{ showRegisterDialog: true \}\)/, 'void 0')],
    ['祈福墙丢掉防死循环（会话未刷新 → 注册后又弹一次）', F.wallJs,
      (s) => s.replace(/if \(!resumingAfterRegister && await this\.isGuestUser\(\)\)/,
        'if (await this.isGuestUser())')],
    ['祈福墙关掉弹窗时清空草稿（制造白写的挫败）', F.wallJs,
      (s) => s.replace(/onRegisterDialogClose\(\) \{\n/,
        "onRegisterDialogClose() {\n    this.setData({ draft: '' })\n")]
  ]

  const paths = Object.values(F)
  const before = {}
  for (const p of paths) before[p] = read(p)

  for (const [label, target, mut] of injections) {
    const orig = read(target)
    const mutated = mut(orig)
    t(`注入可生效：${label}`, mutated !== orig)
    writeFileSync(join(MP, target), mutated)
    failures = 0
    const quietLog = console.log
    const quietErr = console.error
    console.log = () => {}
    console.error = () => {}
    let detected = false
    try { detected = !runChecks(snapshot()) } finally { console.log = quietLog; console.error = quietErr }
    failures = 0
    writeFileSync(join(MP, target), orig)
    t(`★ 被检出：${label}`, detected)
  }

  // 还原字节一致性
  let same = true
  for (const p of paths) if (sha(read(p)) !== sha(before[p])) same = false
  t('★ 全部还原为注入前字节', same)

  failures = 0
  const quietLog2 = console.log
  const quietErr2 = console.error
  console.log = () => {}
  console.error = () => {}
  let clean = false
  try { clean = runChecks(snapshot()) } finally { console.log = quietLog2; console.error = quietErr2 }
  failures = 0
  t('★ 还原后守卫恢复通过', clean)

  if (bad) { console.error(`\n自检失败 ${bad} 项——守卫不可信`); process.exit(1) }
  console.log(`\n自检通过：${injections.length} 个回归注入全部被检出，且还原字节一致`)
}

if (process.argv.includes('--selftest')) {
  selftest()
} else {
  const ok = runChecks(snapshot())
  if (!ok) { console.error('\n注册门禁断言失败：见上'); process.exit(1) }
  console.log('\n✓ 注册门禁与一键注册断言全部通过')
}
