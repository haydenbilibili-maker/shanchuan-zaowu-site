/**
 * #20 / #21 会员卡「未注册 / 退出登录」信封态 + 藏家档案动线 行为断言
 *
 * 为什么必须跑真源码：
 *   1. 「未注册 = 等级 1」是**渲染事实**，不是文案问题 —— 只要 `cardGuest` 没落到
 *      `guestMemberCardFields()` 上，信封卡就会被 Lv1「原木·见习者」悄然顶掉；
 *   2. 「动态蝴蝶」全靠 CSS 动效（给定素材是静态图），keyframes 被改名 / 被 `animation:none`
 *      覆盖时静态检查不会报错，只会「蝴蝶不动」；
 *   3. 档案动线的价值在**可达性**：清单里的每个 anchor 都必须真在 WXML 上有对应 id，
 *      否则点「去补全」什么都不发生（静默失效，最难发现）；
 *   4. 清单分值必须与 `calcProfileScore` 同源：两套口径会让「完成度 100%」和「待补 2 项」同时出现。
 *
 * 用法：
 *   node miniprogram/scripts/test-member-card-guest.mjs
 *   node miniprogram/scripts/test-member-card-guest.mjs --selftest
 */
import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

const PAGE_USER_JS = 'miniprogram/pages/user/index.js'
const PAGE_USER_WXML = 'miniprogram/pages/user/index.wxml'
const CARD_JS = 'miniprogram/components/UserVipCard/index.js'
const CARD_WXML = 'miniprogram/components/UserVipCard/index.wxml'
const CARD_WXSS = 'miniprogram/components/UserVipCard/index.wxss'
const PROFILE_JS = 'miniprogram/subpackages/extra/user/profile/index.js'
const PROFILE_WXML = 'miniprogram/subpackages/extra/user/profile/index.wxml'
const PROFILE_WXSS = 'miniprogram/subpackages/extra/user/profile/index.wxss'
const GIFT_RITE_JS = 'miniprogram/subpackages/feature/gift/receive/index.js'
const GIFT_RITE_WXSS = 'miniprogram/subpackages/feature/gift/receive/index.wxss'
const HELPER_JS = 'miniprogram/utils/profileHelper.js'
const BUTTERFLY = 'miniprogram/assets/envelope/butterfly_pink.png'

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

/* ------------------------------------------------------------------ *
 * 回归注入：每个都必须让断言真的失败
 * ------------------------------------------------------------------ */

const INJECTIONS = {
  'guest-not-flagged': {
    file: PAGE_USER_JS,
    from: 'cardGuest: true,',
    to: 'cardGuest: false,'
  },
  'pending-draws-envelope': {
    file: PAGE_USER_JS,
    from: '    /** 骨架态不画信封（还不知道是不是未注册），避免闪一下又换成等级卡 */\n    cardGuest: false,',
    to: '    cardGuest: true,'
  },
  'guest-cta-always-onboarding': {
    file: PAGE_USER_JS,
    from: '    if (isLocalLoggedOut()) {\n      this.onResumeLoginTap();\n      return;\n    }\n    this.startOnboarding();',
    to: '    this.startOnboarding();'
  },
  'guest-signal-drops-phone': {
    file: PAGE_USER_JS,
    from: "const notRegistered = !session.user.phone || sessionAuthState === 'guest';",
    to: "const notRegistered = sessionAuthState === 'guest';"
  },
  'envelope-not-exclusive': {
    file: CARD_WXML,
    from: 'class="vip-card-container {{cardFlipped ? \'is-flipped\' : \'\'}}" wx:else>',
    to: 'class="vip-card-container {{cardFlipped ? \'is-flipped\' : \'\'}}">'
  },
  'butterfly-wrong-asset': {
    file: CARD_WXML,
    from: 'src="/assets/envelope/butterfly_pink.png"',
    to: 'src="/assets/icons/user.png"'
  },
  'butterfly-static': {
    file: CARD_WXSS,
    from: 'animation: ge-butterfly-wing 1.7s ease-in-out infinite;',
    to: 'animation: none;'
  },
  'butterfly-no-alert': {
    file: CARD_WXSS,
    from: '.ge-butterfly.is-alert .ge-butterfly-img {',
    to: '.ge-butterfly.is-alert-x .ge-butterfly-img {'
  },
  'butterfly-no-flyaway': {
    file: CARD_WXSS,
    from: '.phase-seal .ge-butterfly,',
    to: '.phase-seal-x .ge-butterfly,'
  },
  'butterfly-off-seal': {
    file: CARD_WXSS,
    from: '.ge-butterfly {\n  position: absolute;\n  top: 56rpx;\n  left: 50%;',
    to: '.ge-butterfly {\n  position: absolute;\n  top: 56rpx;\n  left: 62%;'
  },
  'butterfly-floats-above-seal': {
    file: CARD_WXSS,
    from: '.ge-butterfly {\n  position: absolute;\n  top: 56rpx;',
    to: '.ge-butterfly {\n  position: absolute;\n  top: 8rpx;'
  },
  'seal-not-wax': {
    file: CARD_WXSS,
    from: 'radial-gradient(64% 64% at 44% 36%, #C93A42 0%, #A62330 40%, #7E1620 72%, #520A11 100%)',
    to: 'radial-gradient(64% 64% at 44% 36%, #C4A76C 0%, #A8903C 40%, #8A7530 72%, #6B5A24 100%)'
  },
  'wax-drips-as-balls': {
    file: CARD_WXSS,
    from: '  left: 8rpx;\n  bottom: -13rpx;\n  width: 58rpx;\n  height: 46rpx;',
    to: '  left: -10rpx;\n  bottom: -6rpx;\n  width: 34rpx;\n  height: 30rpx;'
  },
  'wax-no-cold-edge': {
    file: CARD_WXSS,
    from: '    0 0 0 2rpx rgba(84, 10, 16, 0.6),\n',
    to: ''
  },
  'wax-no-gloss': {
    file: CARD_WXSS,
    from: 'radial-gradient(38% 30% at 36% 24%, rgba(255, 240, 232, 0.66) 0%, rgba(255, 240, 232, 0) 100%),',
    to: 'radial-gradient(38% 30% at 36% 24%, rgba(160, 20, 26, 0.4) 0%, rgba(160, 20, 26, 0) 100%),'
  },
  'flap-no-brass-line': {
    file: CARD_WXSS,
    from: 'rgba(232, 216, 180, 0.42) 50%',
    to: 'rgba(232, 216, 180, 0) 50%'
  },
  'flap-center-line-back': {
    file: CARD_WXSS,
    from: '.ge-flap-crease {\n  position: absolute;\n  left: 50%;\n  top: 0;\n  height: 186rpx;\n  width: 56rpx;\n  margin-left: -28rpx;',
    to: '.ge-flap-crease {\n  position: absolute;\n  left: 50%;\n  top: 0;\n  height: 186rpx;\n  width: 1px;\n  margin-left: -28rpx;'
  },
  'butterfly-no-contact-shadow': {
    file: CARD_WXSS,
    from: '    radial-gradient(ellipse 44% 18% at 50% 76%, rgba(6, 4, 3, 0.5) 0%, rgba(6, 4, 3, 0) 72%),\n',
    to: ''
  },
  'flap-same-as-pocket': {
    file: CARD_WXSS,
    from: 'linear-gradient(180deg, #574C3E 0%, #433A2E 52%, #332C23 100%);',
    to: 'linear-gradient(180deg, #332E26 0%, #2A251E 52%, #232019 100%);'
  },
  'flap-no-fold-line': {
    file: CARD_WXSS,
    from: 'border-bottom: 2rpx solid rgba(232, 216, 180, 0.4);',
    to: 'border-bottom: 1px solid rgba(196, 167, 108, 0.2);'
  },
  'seam-back-to-blob': {
    file: CARD_WXSS,
    from: '.ge-pocket-seam-l {\n  position: absolute;\n  left: 0;\n  top: 352rpx;\n  width: 52%;\n  height: 2rpx;\n  transform: rotate(-21deg);',
    to: '.ge-pocket-seam-l {\n  position: absolute;\n  left: 0;\n  bottom: 0;\n  width: 52%;\n  height: 168rpx;'
  },
  'seal-glyph-not-debossed': {
    file: CARD_WXSS,
    from: '  color: rgba(255, 226, 216, 0.9);\n  text-shadow: 0 1rpx 1rpx rgba(64, 6, 10, 0.65);',
    to: '  color: var(--brass-300);'
  },
  'rite-beat-drift': {
    file: CARD_JS,
    from: 'const RITE_SEAL_MS = 320;',
    to: 'const RITE_SEAL_MS = 220;'
  },
  'rite-flap-angle-drift': {
    file: CARD_WXSS,
    from: 'transform: translateZ(24rpx) rotateX(-118deg);',
    to: 'transform: translateZ(24rpx) rotateX(-90deg);'
  },
  'rite-no-auto-cta': {
    file: CARD_JS,
    from: '      this.scheduleGuestRite(\n        () => this.fireGuestCta(),\n        RITE_SEAL_MS + RITE_LID_MS + RITE_DONE_MS\n      );',
    to: '      void 0;'
  },
  'rite-double-fire': {
    file: CARD_JS,
    from: 'fireGuestCta() {\n      if (this._guestCtaFired) return;',
    to: 'fireGuestCta() {'
  },
  'rite-no-skip': {
    file: CARD_JS,
    from: "onGuestSkip() {\n      if (this.data.ritePhase === 'done') return;",
    to: "onGuestSkip() {\n      if (true) return;"
  },
  'rite-no-detach-cleanup': {
    file: CARD_JS,
    from: '    detached() {\n      this._cleared = true;\n      this.clearGuestRite();\n    }',
    to: '    detached() {\n      this.clearGuestRite();\n    }'
  },
  'letter-never-revealed': {
    file: CARD_WXSS,
    from: '  opacity: 1;\n  transform: translateY(0);',
    to: '  opacity: 0;\n  transform: translateY(0);'
  },
  'chip-back-to-arrow': {
    file: CARD_WXML,
    from: 'class="profile-entry-chip"',
    to: 'class="profile-edit-hint"'
  },
  'back-link-conditional': {
    file: CARD_WXML,
    from: '<text class="cb-row-link" wx:if="{{cardBirthday.hasBirthday}}" catchtap="onGoProfileFromCardBack">档案 →</text>',
    to: '<text class="cb-row-link" wx:if="{{false}}" catchtap="onGoProfileFromCardBack">档案 →</text>'
  },
  'no-menu-entry': {
    file: PAGE_USER_WXML,
    from: 'data-path="profile"',
    to: 'data-path="profile-disabled"'
  },
  'anchor-drift': {
    file: PROFILE_JS,
    from: "anchor: '#field-zodiac'",
    to: "anchor: '#field-zodiac-x'"
  },
  'gain-sum-drift': {
    file: PROFILE_JS,
    from: "{ key: 'phone', gain: 25,",
    to: "{ key: 'phone', gain: 20,"
  },
  'no-next-steps-refresh': {
    file: PROFILE_JS,
    from: 'this.refreshNextSteps()',
    to: 'void 0'
  },
  'checklist-card-missing': {
    file: PROFILE_WXML,
    from: 'class="account-section-card next-steps-card"',
    to: 'class="account-section-card next-steps-card-off"'
  }
}

const INJECT = String(process.env.MEMBER_CARD_INJECT || '').trim()
function readSrc(file) {
  const raw = readFileSync(resolve(ROOT, file), 'utf8')
  if (!INJECT) return raw
  const inj = INJECTIONS[INJECT]
  if (!inj) throw new Error('unknown injection ' + INJECT)
  if (inj.file !== file) return raw
  if (raw.indexOf(inj.from) === -1) throw new Error('injection anchor missing: ' + INJECT)
  return raw.replace(inj.from, inj.to)
}

/** 取「{ ... }」配平片段（函数 / 方法体 / 对象） */
function sliceBalanced(src, startToken, open = '{', close = '}') {
  const start = src.indexOf(startToken)
  if (start < 0) throw new Error('token not found: ' + startToken)
  let depth = 0
  for (let i = src.indexOf(open, start); i < src.length; i += 1) {
    if (src[i] === open) depth += 1
    else if (src[i] === close) {
      depth -= 1
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error('unbalanced: ' + startToken)
}


/* ------------------------------------------------------------------ *
 * 1) #20 页面态：未注册 / 退出 → cardGuest；骨架态不画信封
 * ------------------------------------------------------------------ */

const userPageSrc = readSrc(PAGE_USER_JS)
const guestFns = new Function(
  'GUEST_NICK',
  'PENDING_SKIN_LEVEL',
  'resolveSkinClass',
  'specimenFieldsFor',
  `${sliceBalanced(userPageSrc, 'function guestMemberCardFields()')}
   ${sliceBalanced(userPageSrc, 'function pendingMemberCardFields()')}
   return { guestMemberCardFields, pendingMemberCardFields };`
)(
  '未登录用户',
  6,
  (level) => `level-skin-${level}`,
  () => ({ specimenEmoji: '', specimenName: '', specimenLatin: '', specimenMaterial: '' })
)

eq('★ 访客 / 本机退出 → cardGuest = true（信封卡）', guestFns.guestMemberCardFields().cardGuest, true)
eq('骨架态不画信封（避免闪卡再变等级卡）', guestFns.pendingMemberCardFields().cardGuest, false)
eq('访客态仍显式声明 level 1 数据（信封卡不读它，但保持在数据结构里）', guestFns.guestMemberCardFields().level, 1)
check(
  '★ 会话回填时「未绑手机」也算未注册（注册完成标志，与 onboarding 文案一致）',
  /const notRegistered = !session\.user\.phone \|\| sessionAuthState === 'guest';/.test(userPageSrc)
)
check(
  '会话态同时清掉 guestLoggedOut（否则未注册会显示「已退出」文案）',
  /cardGuest: notRegistered,\n\s*guestLoggedOut: false/.test(userPageSrc)
)
check('本机退出态标记 guestLoggedOut', /guestLoggedOut: true,/.test(userPageSrc))

{
  // onGuestCardCta：未注册 → 注册引导；本机退出 → 重新进入
  const body = sliceBalanced(userPageSrc, 'onGuestCardCta() {')
  const make = (loggedOut) => {
    const calls = []
    const fn = new Function('isLocalLoggedOut', `return { ${body} };`)(() => loggedOut).onGuestCardCta
    fn.call({
      onResumeLoginTap: () => calls.push('resume'),
      startOnboarding: () => calls.push('onboarding')
    })
    return calls
  }
  eq('★ 本机退出 → 走「重新进入」', make(true).join(','), 'resume')
  eq('★ 未注册 → 走注册引导', make(false).join(','), 'onboarding')
}

/* ------------------------------------------------------------------ *
 * 2) #20 组件契约：cardGuest 属性 + guestcta 事件
 * ------------------------------------------------------------------ */

{
  const src = readSrc(CARD_JS)
  let def = null
  // eslint-disable-next-line no-new-func
  new Function('Component', src)((d) => { def = d })
  check('组件已定义', !!def)
  check('★ 组件暴露 cardGuest 属性', !!(def.properties && def.properties.cardGuest), 'missing cardGuest')
  eq('cardGuest 为布尔且默认 false（默认仍是等级卡）', def.properties.cardGuest.type, Boolean)
  eq('cardGuest 默认 false', def.properties.cardGuest.value, false)
  check('★ 组件暴露 guestLoggedOut（区分「已退出」与「未注册」文案）', !!(def.properties && def.properties.guestLoggedOut))
  eq('onGuestCta 是方法', typeof def.methods.onGuestCta, 'function')

  const emitted = []
  def.methods.onGuestCta.call({ emit: (n) => emitted.push(n), triggerEvent: (n) => emitted.push(n) })
  eq('★ 信封卡 CTA 冒泡 guestcta 事件', emitted.join(','), 'guestcta')
  eq('启封仪式初始相位为 idle（封缄态）', def.data.ritePhase, 'idle')
}

/* ------------------------------------------------------------------ *
 * 3) #20 信封卡结构 + 动态蝴蝶（WXML / WXSS / 资产）
 * ------------------------------------------------------------------ */

const cardWxml = readSrc(CARD_WXML)
const cardWxss = readSrc(CARD_WXSS)

check('★ 信封卡分支由 cardGuest 控制', /<view class="vip-card-container guest-card-wrap" wx:if="\{\{cardGuest\}\}">/.test(cardWxml))
check(
  '★ 等级卡与信封卡互斥（等级卡 wx:else）',
  /guest-card-wrap" wx:if="\{\{cardGuest\}\}"[\s\S]*?class="vip-card-container \{\{cardFlipped \? 'is-flipped' : ''\}\}" wx:else>/.test(cardWxml)
)
{
  // 只取信封卡那一段（到等级卡注释为止），避免正则跨段匹配到等级卡的结构
  const envStart = cardWxml.indexOf('guest-card-wrap')
  const envEnd = cardWxml.indexOf('<!-- 1. 光感会员卡')
  const envBlock = envStart > -1 && envEnd > envStart ? cardWxml.slice(envStart, envEnd) : ''
  check('信封卡段已定位', envBlock.length > 200)
  check(
    '★ 信封卡没有等级卡的结构件（等级章 / 成长轨 / 翻转字形 / 标本水印 / 头像）',
    !/badge-pill|growth-panel|card-flip-glyph|card-specimen|avatar-wrap/.test(envBlock)
  )
}
check(
  '★ 蝴蝶用专供素材（主包 envelope）',
  /class="ge-butterfly-img" src="\/assets\/envelope\/butterfly_pink\.png"/.test(cardWxml)
)
check('信封有封缄红蜡（阴刻「山海」）', /class="ge-seal"[\s\S]*?山海/.test(cardWxml))

/* —— 红蜡 + 蝴蝶落位：几何必须真的对得上，否则只是「看起来差不多」 —— */
function cssBlock(src, selector) {
  const pattern = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = src.match(new RegExp(`${pattern} \\{[\\s\\S]*?\\n\\}`))
  return m ? m[0] : ''
}
function cssRpx(block, prop) {
  const m = block.match(new RegExp(`${prop}:\\s*(-?[\\d.]+)rpx`))
  return m ? Number(m[1]) : null
}
{
  const seal = cssBlock(cardWxss, '.ge-seal')
  const fly = cssBlock(cardWxss, '.ge-butterfly')
  check('红蜡 / 蝴蝶两块样式都能定位', seal.length > 0 && fly.length > 0)

  const reds = (seal.match(/#[0-9A-Fa-f]{6}/g) || [])
    .map((hex) => ({
      hex,
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16)
    }))
    .filter((c) => c.r > 150 && c.r - c.g > 60 && c.r - c.b > 60)
  check('★ 封蜡是红色系（不是铜印 / 金印）', reds.length > 0, (seal.match(/#[0-9A-Fa-f]{6}/g) || []).join(' '))
  check('红蜡不直接用错误色 token（避免语义串味 #D64045）', !/#D64045/i.test(seal))
  check(
    '★ 蜡面有湿润高光（近白径向，且收得小 —— 大高光会把上半块冲成粉色）',
    /radial-gradient\(24% 18% at 34% 22%, rgba\(255, 244, 238, 0\.5\)/.test(seal)
  )
  check(
    '★ 蜡体有冷蜡硬边（三层：暗红描边 + 外圈柔影）—— 没有它边缘会糊进信封',
    /0 0 0 3rpx rgba\(74, 9, 15, 0\.75\)/.test(seal) && /0 0 0 7rpx rgba\(8, 5, 4, 0\.3\)/.test(seal)
  )
  check('★ 蜡体有实物落影（蜡是凸出纸面的）', /0 10rpx 20rpx rgba\(6, 4, 3, 0\.6\)/.test(seal))
  check(
    '压印圈是凹槽（暗线 + 紧邻亮边），不是一条浅色描边',
    /\.ge-seal-ring \{[\s\S]*?border: 2rpx solid rgba\(62, 6, 10, 0\.55\);/.test(cardWxss) &&
      /\.ge-seal-ring \{[\s\S]*?box-shadow:\n\s*0 1rpx 0 rgba\(255, 214, 204, 0\.22\)/.test(cardWxss)
  )

  // 溢蜡：必须是「流开的一坨」，不是两颗圆珠（真机曾看起来像红色小球）
  const drips = [...cardWxss.matchAll(/\.ge-seal::(?:before|after) \{[\s\S]*?\n\}/g)]
    .map((m) => m[0])
    // 共用块（.ge-seal::before, .ge-seal::after { 材质 }）没有尺寸，只取两处实际几何块
    .filter((block) => /width:/.test(block))
  eq('两处溢蜡都已定义', drips.length, 2)
  const sealWidth = cssRpx(seal, 'width')
  const sealHeight = cssRpx(seal, 'height')
  const big = drips[0]
  const bigW = cssRpx(big, 'width')
  const bigH = cssRpx(big, 'height')
  const bigBottom = cssRpx(big, 'bottom')
  check(
    '★ 溢蜡是「流开的一坨」（最大溢蜡宽度 ≥ 蜡体宽度 45%；早期 34/116 = 29% → 像圆珠）',
    bigW >= sealWidth * 0.45,
    `${bigW}/${sealWidth}`
  )
  check(
    '★ 溢蜡大面积压在蜡体内（嵌入深度 ≥ 25rpx，不是挂在下缘的独立小球）',
    bigH + bigBottom >= 25,
    `embed ${bigH + bigBottom}rpx`
  )
  {
    const shared = (cardWxss.match(/\.ge-seal::before,\n\.ge-seal::after \{[\s\S]*?\n\}/) || [''])[0]
    check(
      '溢蜡自身也有高光与落影（与蜡体同一材质语言）',
      /inset 0 2rpx 3rpx rgba\(255, 216, 206, 0\.3\)/.test(shared) && /0 5rpx 10rpx rgba\(6, 4, 3, 0\.45\)/.test(shared)
    )
  }
  check('蜡体与溢蜡尺寸成比例（溢蜡不得比蜡体还大）', bigW < sealWidth && bigH < sealHeight)
  check(
    '蜡面阴刻「山海」为双色阴影（上缘压痕 + 下缘受光）',
    /\.ge-seal-glyph \{[\s\S]*?0 1rpx 0 rgba\(255, 236, 228, 0\.34\),\n\s*0 -1rpx 2rpx rgba\(56, 4, 8, 0\.72\)/.test(cardWxss)
  )

  // 中轴：蜡印与蝴蝶都必须以容器中线为心（left:50% + margin-left:-宽/2）
  check('蜡印与蝴蝶都锚在中线', /left: 50%;/.test(seal) && /left: 50%;/.test(fly))
  const sealW = cssRpx(seal, 'width')
  const flyW = cssRpx(fly, 'width')
  eq('蜡印水平居中（margin-left = -宽/2）', cssRpx(seal, 'margin-left'), -sealW / 2)
  eq('★ 蝴蝶水平居中于蜡印（同一中轴，落在「山海」上）', cssRpx(fly, 'margin-left'), -flyW / 2)

  const sealTop = cssRpx(seal, 'top')
  const sealH = cssRpx(seal, 'height')
  const flyTop = cssRpx(fly, 'top')
  const flyH = cssRpx(fly, 'height')
  check(
    '★ 蝴蝶翼尖搭在蜡面上（重叠 ≥40rpx，不是浮在半空）',
    flyTop + flyH - sealTop >= 40,
    `overlap ${flyTop + flyH - sealTop}rpx (fly ${flyTop}..${flyTop + flyH} vs seal ${sealTop}..${sealTop + sealH})`
  )
  check(
    '★ 蝴蝶停在蜡印上半部（「山海」二字仍露在下方，不被压住）',
    flyTop + flyH / 2 < sealTop + sealH / 2,
    `fly center ${flyTop + flyH / 2} vs seal center ${sealTop + sealH / 2}`
  )
}
check('信封有封盖（斜切两片）与封盖折痕', /ge-flap-half ge-flap-l/.test(cardWxml) && /ge-flap-half ge-flap-r/.test(cardWxml) && /ge-flap-crease/.test(cardWxml))
check('信封有信纸层（启封后升起）', /class="ge-letter"/.test(cardWxml) && /ge-letter-deco/.test(cardWxml))
check('信封有手势提示（轻触 / 长按）', /轻触开启 · 长按可直接进入/.test(cardWxml))
check('轻触 / 长按 / 按住三个手势都已接线', /bindtap="onGuestRite"/.test(cardWxml) && /bindlongpress="onGuestSkip"/.test(cardWxml) && /bindtouchstart="onGuestTouchStart"/.test(cardWxml))
check('信封已声明为可点区域（aria-role / aria-label）', /aria-role="button"/.test(cardWxml) && /aria-label="\{\{guestLoggedOut/.test(cardWxml))

/* ------------------------------------------------------------------ *
 * 3b) #20 启封仪式：节拍与礼赠启封同源 + 相位机 + 只发一次 + 长按跳过
 * ------------------------------------------------------------------ */

/** 礼赠启封的节拍（真源） */
const giftRiteSrc = readFileSync(resolve(ROOT, GIFT_RITE_JS), 'utf8')
const giftBeats = ['PHASE_SEAL_MS', 'PHASE_LID_MS', 'PHASE_DONE_MS'].map((key) => {
  const m = giftRiteSrc.match(new RegExp(`const ${key} = (\\d+)`))
  return m ? Number(m[1]) : null
})
const cardRiteSrc = readSrc(CARD_JS)
const cardBeats = ['RITE_SEAL_MS', 'RITE_LID_MS', 'RITE_DONE_MS'].map((key) => {
  const m = cardRiteSrc.match(new RegExp(`const ${key} = (\\d+)`))
  return m ? Number(m[1]) : null
})
check('礼赠启封节拍已读到', giftBeats.every((n) => n > 0), giftBeats.join('/'))
eq('★ 信封启封节拍 === 礼赠启封节拍（320/720/420，两处手感必须是同一套）', cardBeats.join('/'), giftBeats.join('/'))
check(
  '★ 封盖掀起角度 === 礼盒盖掀起角度（rotateX(-118deg)）',
  /\.phase-lid \.ge-flap,[\s\S]*?rotateX\(-118deg\)/.test(cardWxss) && /rotateX\(-118deg\)/.test(giftRiteSrc + readFileSync(resolve(ROOT, GIFT_RITE_WXSS), 'utf8'))
)
check('启封飞离复用礼赠的蝴蝶语言（透明度归零 + 上移放大）', /\.phase-seal \.ge-butterfly,[\s\S]*?opacity: 0;/.test(cardWxss))

/** 用可控定时器跑真组件方法的相位机 */
function makeCardCtx() {
  const timers = []
  let def = null
  const fakeSetTimeout = (fn, ms) => {
    const t = { fn, ms, cleared: false }
    timers.push(t)
    return t
  }
  const fakeClearTimeout = (t) => { if (t) t.cleared = true }
  // eslint-disable-next-line no-new-func
  new Function('Component', 'setTimeout', 'clearTimeout', readSrc(CARD_JS))(
    (d) => { def = d },
    fakeSetTimeout,
    fakeClearTimeout
  )
  const ctx = {
    data: JSON.parse(JSON.stringify(def.data)),
    events: [],
    setData(patch, cb) { Object.assign(this.data, patch); if (typeof cb === 'function') cb() },
    triggerEvent(name) { this.events.push(name) }
  }
  Object.keys(def.methods).forEach((k) => { ctx[k] = def.methods[k].bind(ctx) })
  // 真实定时器触发后即消失；假定时器也要消费掉，否则 pending 永远非空
  const fire = (ms) => timers
    .filter((t) => t.ms === ms && !t.cleared)
    .forEach((t) => { t.cleared = true; t.fn() })
  const pending = () => timers.filter((t) => !t.cleared).map((t) => t.ms)
  return { ctx, def, timers, fire, pending }
}

{
  const { ctx, fire, pending } = makeCardCtx()
  ctx.onGuestRite()
  eq('轻触 → 立刻进入 seal 相位（裂蜡）', ctx.data.ritePhase, 'seal')
  eq('★ 三个节拍已排程：320（裂蜡）/ 1040（掀盖）/ 1460（展信后进入）', pending().join(','), '320,1040,1460')
  fire(320)
  eq('+320ms → lid（掀盖）', ctx.data.ritePhase, 'lid')
  fire(1040)
  eq('+1040ms → done（展信）', ctx.data.ritePhase, 'done')
  eq('展信时还没跳转（先让用户看到信）', ctx.events.length, 0)
  fire(1460)
  eq('★ +1460ms → 只发一次 guestcta（进入注册 / 重新登录）', ctx.events.join(','), 'guestcta')
  ctx.onGuestRite()
  eq('仪式进行中重复轻触不再排程（防连点）', pending().join(','), '')
}

{
  const { ctx, fire } = makeCardCtx()
  ctx.onGuestRite()
  ctx.fireGuestCta()
  fire(1460)
  eq('★ guestcta 只发一次（长按与轻触叠加也不重复跳转）', ctx.events.join(','), 'guestcta')
}

{
  const { ctx, pending } = makeCardCtx()
  ctx.onGuestRite()
  ctx.onGuestSkip()
  eq('★ 长按 → 跳过仪式直接展信', ctx.data.ritePhase, 'done')
  eq('★ 长按 → 立即进入（不必等 1.46s）', ctx.events.join(','), 'guestcta')
  eq('长按后清掉未触发的节拍（不会二次跳转）', pending().join(','), '')
}

{
  const { ctx, fire, pending } = makeCardCtx()
  ctx.onGuestTouchStart()
  eq('★ 手指按住 → 蝴蝶加速振翅', ctx.data.butterflyAlert, true)
  fire(620)
  eq('松手（620ms 后）→ 蝴蝶回到常态', ctx.data.butterflyAlert, false)
  ctx.onGuestRite()
  eq('启封时按住态被清掉（不与飞离动画打架）', ctx.data.butterflyAlert, false)
  eq('启封后仍有节拍在跑', pending().length > 0, true)
}

{
  const { ctx, def, pending } = makeCardCtx()
  ctx.onGuestRite()
  check('★ 组件声明了 detached 生命周期（离开页面要清定时器）', !!(def.lifetimes && typeof def.lifetimes.detached === 'function'))
  def.lifetimes.detached.call(ctx)
  eq('detached → 未触发的节拍全部取消（避免卸载后 setData）', pending().join(','), '')
  ctx.onGuestRite()
  eq('detached 后不再排程', pending().join(','), '')
}

{
  const st = statSync(resolve(ROOT, BUTTERFLY))
  const head = readFileSync(resolve(ROOT, BUTTERFLY)).subarray(0, 8)
  check('★ 蝴蝶素材已入库', st.isFile() && st.size > 0)
  check('蝴蝶为 PNG（带透明通道）', head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47)
  check('蝴蝶素材 < 120KB（主包体积可控）', st.size < 120 * 1024, `${Math.round(st.size / 1024)}KB`)
}

check('★ 蝴蝶漂浮动画存在', /@keyframes ge-butterfly-float/.test(cardWxss))
check('★ 蝴蝶振翅动画存在', /@keyframes ge-butterfly-wing/.test(cardWxss))
check(
  '★ 漂浮与振翅都真正挂在元素上（两层分离，transform 不互相覆盖）',
  /\.ge-butterfly \{[\s\S]*?animation: ge-butterfly-float/.test(cardWxss) &&
    /\.ge-butterfly-img \{[\s\S]*?animation: ge-butterfly-wing/.test(cardWxss)
)
check('蝴蝶有暖光呼吸层', /@keyframes ge-butterfly-glow/.test(cardWxss))
check(
  '★ 按住加速振翅的样式真实存在（.is-alert 覆盖三层 animation-duration）',
  /\.ge-butterfly\.is-alert \{[\s\S]*?animation-duration: 1\.2s;/.test(cardWxss) &&
    /\.ge-butterfly\.is-alert \.ge-butterfly-img \{[\s\S]*?animation-duration: 0\.42s;/.test(cardWxss)
)
check(
  '★ 卸载后不再 setData（_cleared 双重保险：detached 置位 + 回调前检查）',
  /detached\(\) \{\n\s*this\._cleared = true;/.test(cardRiteSrc) && /if \(this\._cleared\) return;/.test(cardRiteSrc)
)
{
  const pocket = cardWxss.match(/\.ge-pocket \{[\s\S]*?\n\}/)
  check('★ 袋身材质为深墨卡纸（与 Lv1 浅色卡纸形成材质区分）', !!pocket && /#2E2A23|#221F1A|#171410/.test(pocket[0]), pocket ? pocket[0].slice(0, 60) : 'no block')
  check('袋身有纸板厚度：外沿冷边 + 内沿暗角（bevel）', /inset 0 0 0 1rpx rgba\(10, 8, 6, 0\.4\)/.test(pocket[0]) && /inset 0 -18rpx 30rpx/.test(pocket[0]))
  check('袋身有纵横两向纸纤维（不是单向条纹）', (cardWxss.match(/repeating-linear-gradient\((?:90|180)deg/g) || []).length >= 2)

  // 折痕：底部 Λ（左右各一道带亮线+暗线的折痕），对齐真实信封背面
  const seams = ['\\.ge-pocket-seam-l \\{[\\s\\S]*?\\n\\}', '\\.ge-pocket-seam-r \\{[\\s\\S]*?\\n\\}']
    .map((re) => (cardWxss.match(new RegExp(re)) || [''])[0])
  check('底部折角是折痕线而非色块（左右各一道）', seams.every((s) => /height: 2rpx;/.test(s) && /transform: rotate\(-?19deg\);/.test(s)))
  check(
    '折痕带亮线 + 暗线（一条线不够「折」），且两端要淡出（否则卡面变几何图）',
    seams.every((s) => /rgba\(224, 207, 163, 0\.16\)/.test(s)) &&
      seams.every((s) => /rgba\(224, 207, 163, 0\) 0%/.test(s)) &&
      seams.every((s) => /box-shadow: 0 -?1rpx 0 rgba\(8, 6, 4, 0\.(34|4)\)/.test(s))
  )

  // ★ 封盖必须明显比袋身亮一档 —— 这正是真机反馈「封盖看不见」的量化口径
  const flapHalf = (cardWxss.match(/\.ge-flap-half \{[\s\S]*?\n\}/) || [''])[0]
  const luma = (hex) => {
    const m = hex.match(/#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})/)
    if (!m) return null
    return 0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)
  }
  const flapLuma = luma((flapHalf.match(/linear-gradient\(180deg, (#[0-9A-Fa-f]{6})/) || [])[1] || '')
  const pocketLuma = luma((pocket[0].match(/linear-gradient\(168deg, (#[0-9A-Fa-f]{6})/) || [])[1] || '')
  check(
    '★ 封盖比袋身高一档可辨识（感知亮度差 ≥15；此前仅差 ~12 → 几乎不可见；过亮又会变浅色帐篷）',
    flapLuma != null && pocketLuma != null && flapLuma - pocketLuma >= 15,
    `flap ${flapLuma} vs pocket ${pocketLuma}`
  )
  check(
    '★ 封盖亮度不失控（与袋身差 ≤34；封盖是「另一块纸板」，过亮会变浅色帐篷）',
    flapLuma != null && pocketLuma != null && flapLuma - pocketLuma <= 34,
    `flap ${flapLuma} vs pocket ${pocketLuma}`
  )
  check('封盖有「亮折口 + 紧随暗线」的折痕（border-bottom 亮 + box-shadow 暗）', /border-bottom: 2rpx solid rgba\(232, 216, 180, 0\.3\);/.test(flapHalf) && /0 3rpx 0 rgba\(20, 16, 12, 0\.55\)/.test(flapHalf))
  check('封盖在袋身上有投影（box-shadow 随 skew 倾斜；不用 filter:drop-shadow）', /0 12rpx 16rpx rgba\(6, 4, 3, 0\.5\)/.test(flapHalf) && !/filter: drop-shadow/.test(cardWxss))
  check(
    '★ 封盖有内侧黄铜细线（对齐礼赠 .lid-brass-line：一条边太单薄，两条才像折过的纸）',
    /\.ge-flap-half::after \{[\s\S]*?rgba\(232, 216, 180, 0\.42\)/.test(cardWxss)
  )
  check(
    '★ 封盖与袋身共用同一套纸纹（同一种纸的另一层，对齐礼赠 lid 与盒身同源）',
    /repeating-linear-gradient\(90deg/.test(flapHalf) && /repeating-linear-gradient\(180deg/.test(flapHalf)
  )
  {
    const crease = (cardWxss.match(/\.ge-flap-crease \{[\s\S]*?\n\}/) || [''])[0]
    check(
      '★ 封盖中线不得是 1px 亮线（信封背面没有这道折痕，真机会读成裂缝）',
      !!crease && !/width: 1px;/.test(crease) && /width: 56rpx;/.test(crease),
      crease.slice(0, 60)
    )
  }
  check(
    '★ 蝴蝶有落在蜡面上的接触影（没有它蝴蝶像贴在屏幕上，不是停在蜡上）',
    /\.ge-butterfly-glow \{[\s\S]*?rgba\(6, 4, 3, 0\.5\)/.test(cardWxss)
  )
}
check('信封卡沿用同高容器（不跳版）', /\.guest-card-wrap \{/.test(cardWxss))
check('启封相位选择器齐备（seal/lid/done 三档）', /\.phase-lid \.ge-flap,/.test(cardWxss) && /\.phase-seal \.ge-seal,/.test(cardWxss) && /\.phase-done \.ge-letter \{/.test(cardWxss))
check('信纸启封后可见（opacity 1 + 归位）', /\.phase-lid \.ge-letter,[\s\S]*?opacity: 1;\n\s*transform: translateY\(0\);/.test(cardWxss))
check('封缄态文案在启封后淡出（不与信纸文字重叠）', /\.phase-lid \.ge-face,[\s\S]*?opacity: 0;/.test(cardWxss))

/* ------------------------------------------------------------------ *
 * 4) #21 档案入口与动线
 * ------------------------------------------------------------------ */

const userWxml = readSrc(PAGE_USER_WXML)

check(
  '★ 卡面档案入口带完成度（不再是一个裸「›」）',
  /class="profile-entry-chip"[\s\S]*?catchtap="onGoProfile"[\s\S]*?\{\{profileScore\}\}%/.test(cardWxml)
)
check('裸「›」入口已移除', !/class="profile-edit-hint"/.test(cardWxml))
check('死样式 profile-edit-hint 已清理', !/profile-edit-hint/.test(cardWxss))
check('★ 背板生日行常驻档案入口', /wx:if="\{\{cardBirthday\.hasBirthday\}\}" catchtap="onGoProfileFromCardBack">档案 →/.test(cardWxml))
check('★ 背板标签区常驻档案入口', /class="cb-tags-link"[\s\S]*?管理档案 →/.test(cardWxml))
check('★ 背板页脚常驻「完善藏家档案」', /class="cb-profile-cta"[\s\S]*?完善藏家档案 →/.test(cardWxml))

check('★「我的」新增藏家档案入口（2026-09-17：从服务列表上移到资产位，原「我的积分」位置）', /asset-item[\s\S]*?data-path="profile"[\s\S]*?<text class="as-lbl">我的档案<\/text>/.test(userWxml))
check('入口显示完成度', /data-path="profile"[\s\S]*?as-val[\s\S]*?profileScore/.test(userWxml))
check('入口未注册/骨架态不显示百分比', /data-path="profile"[\s\S]*?cardPending \|\| cardGuest\) \? '—'/.test(userWxml))
check('★ 页面把 cardGuest / guestLoggedOut / guestcta 接到组件', /card-guest="\{\{cardGuest\}\}"/.test(userWxml) && /guest-logged-out="\{\{guestLoggedOut\}\}"/.test(userWxml) && /bind:guestcta="onGuestCardCta"/.test(userWxml))
check('★ handleMenuClick 有 profile 分支（兜底入口），不再依赖卡面', /case 'profile':[\s\S]*?this\.goToProfile\(\)/.test(userPageSrc))

/* ------------------------------------------------------------------ *
 * 5) #21 档案页「下一步」清单：分值与 calcProfileScore 同源、anchor 必须真实存在
 * ------------------------------------------------------------------ */

const profileSrc = readSrc(PROFILE_JS)
const profileWxml = readSrc(PROFILE_WXML)
const profileWxss = readSrc(PROFILE_WXSS)

/** 真实分享真源：分值口径必须来自 profileHelper，不另立一套 */
const helper = (() => {
  const mod = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', readFileSync(resolve(ROOT, HELPER_JS), 'utf8'))(mod, mod.exports)
  return mod.exports
})()
const FULL_USER = {
  avatarUrl: 'cloud://env.abc/avatars/a.png',
  nickName: '藏家甲',
  phone: '13800000000',
  birthday: '1996-05-20',
  interests: ['insect'],
  gender: 'male',
  mbti: 'INTJ',
  zodiac: 'taurus'
}
eq('满档档案 calcProfileScore = 100（清单分值之和必须与它一致）', helper.calcProfileScore(FULL_USER), 100)

const stepsDef = new Function(
  `${sliceBalanced(profileSrc, 'const NEXT_STEP_DEFS = [', '[', ']')};\nreturn NEXT_STEP_DEFS;`
)()
const buildNextSteps = new Function(
  'sanitizeNickName',
  'NEXT_STEP_DEFS',
  `${sliceBalanced(profileSrc, 'function buildNextSteps(')}\nreturn buildNextSteps;`
)(helper.sanitizeNickName, stepsDef)

eq('清单项数 = 8（对应档案 8 个加分项）', stepsDef.length, 8)
eq(
  '★ 清单分值之和 === calcProfileScore 满分（两套口径会自相矛盾）',
  stepsDef.reduce((sum, s) => sum + s.gain, 0),
  100
)
check(
  '清单按分值从高到低排序（先补收益最大的）',
  stepsDef.every((s, i) => i === 0 || stepsDef[i - 1].gain >= s.gain),
  stepsDef.map((s) => s.gain).join(',')
)
check('每项都有 key / label / anchor', stepsDef.every((s) => s.key && s.label && s.anchor && s.anchor.startsWith('#')))

eq(
  '空档案 → 8 项待补，顺序即建议顺序',
  buildNextSteps({}).map((s) => s.key).join(','),
  'phone,avatar,birthday,interests,nickName,mbti,zodiac,gender'
)
eq('满档档案 → 无待补项', buildNextSteps({ phoneBound: true, avatarUrl: 'cloud://x/a.png', birthday: '1996-05-20', interests: ['insect'], nickName: '藏家甲', mbti: 'INTJ', zodiac: 'taurus', gender: 'male' }).length, 0)
eq(
  '占位昵称不算已填（与 calcProfileScore / sanitizeNickName 同口径）',
  buildNextSteps({ nickName: '微信用户' }).some((s) => s.key === 'nickName'),
  true
)
eq(
  '兴趣为空数组 = 未填（不是「已选 0 项」）',
  buildNextSteps({ interests: [] }).some((s) => s.key === 'interests'),
  true
)

// refreshNextSteps：只展示前 4 项 + 折叠计数 + 完成态
let ctx0 = null
{
  const body = sliceBalanced(profileSrc, 'refreshNextSteps() {')
  const make = () => {
    const ctx = { data: {}, setData(patch) { Object.assign(this.data, patch) } }
    new Function('buildNextSteps', `return { ${body} };`)(buildNextSteps).refreshNextSteps.call(ctx)
    return ctx.data
  }
  ctx0 = make()
}
check('清单一次只铺 4 条（其余折叠）', ctx0.nextSteps.length === 4 && ctx0.nextStepsMore === 4 && ctx0.nextStepsTotal === 8, JSON.stringify({ n: ctx0.nextSteps.length, more: ctx0.nextStepsMore }))
eq('未补齐时不显示「已完整」', ctx0.nextStepsDone, false)

{
  const body = sliceBalanced(profileSrc, 'refreshNextSteps() {')
  const ctx = {
    data: { phoneBound: true, avatarUrl: 'cloud://x/a.png', birthday: '1996-05-20', interests: ['insect'], nickName: '藏家甲', mbti: 'INTJ', zodiac: 'taurus', gender: 'male' },
    setData(patch) { Object.assign(this.data, patch) }
  }
  new Function('buildNextSteps', `return { ${body} };`)(buildNextSteps).refreshNextSteps.call(ctx)
  check('★ 满档 → 待补 0、显示已完整、不渲染行', ctx.data.nextStepsDone === true && ctx.data.nextStepsTotal === 0 && ctx.data.nextSteps.length === 0)
}

// goNextStep：点条目必须滚到该项 anchor
{
  const body = sliceBalanced(profileSrc, 'goNextStep(e) {')
  const scrolled = []
  // 桩 wx / setTimeout：否则 slice 出来的真方法会在 160ms 后碰到未定义的 wx
  const fn = new Function('NEXT_STEP_DEFS', 'wx', 'setTimeout', `return { ${body} };`)(
    stepsDef,
    { showToast() {}, vibrateShort() {} },
    () => 0
  ).goNextStep
  fn.call({ scrollToField: (s) => scrolled.push(s) }, { currentTarget: { dataset: { key: 'birthday' } } })
  eq('★ 点「填写生日」滚到生日字段', scrolled.join(','), '#field-birthday')
  scrolled.length = 0
  fn.call({ scrollToField: (s) => scrolled.push(s) }, { currentTarget: { dataset: { key: 'nope' } } })
  eq('未知 key 不滚动（不误跳到页面顶部）', scrolled.length, 0)
}

check('★ 完成度刷新时同步刷新清单（否则分数与待补项会脱节）', /syncProfileHeader\(score\) \{[\s\S]*?this\.refreshNextSteps\(\)/.test(profileSrc))
check('清单卡片存在且绑定 goNextStep', /class="account-section-card next-steps-card"/.test(profileWxml) && /bindtap="goNextStep"/.test(profileWxml) && /data-key="\{\{item\.key\}\}"/.test(profileWxml))
check('清单展示「待补 N 项」与已完整态', /待补 \{\{nextStepsTotal\}\} 项/.test(profileWxml) && /next-steps-count is-done/.test(profileWxml))
check('清单行有分值 / 文案 / CTA 三段', /next-step-gain[\s\S]*?next-step-label[\s\S]*?next-step-cta/.test(profileWxml))
check('清单样式已定义', /\.next-step-row \{/.test(profileWxss) && /\.next-step-gain \{/.test(profileWxss) && /\.next-step-empty \{/.test(profileWxss))
check('清单文案与分值同源说明写在代码里', /与 calcProfileScore 的加分项\*\*逐项对应\*\*/.test(profileSrc))

// ★ 可达性：清单 anchor 必须都能在 WXML 上找到对应 id
{
  const missing = stepsDef
    .map((s) => s.anchor.slice(1))
    .filter((id) => !new RegExp(`id="${id}"`).test(profileWxml))
  check('★ 清单 anchor 全部真实存在（否则点「去补全」静默失效）', missing.length === 0, missing.join(','))
}

/* ------------------------------------------------------------------ */

if (process.argv.includes('--selftest') && !INJECT) {
  const { spawnSync } = await import('node:child_process')
  let bad = 0
  for (const name of Object.keys(INJECTIONS)) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, MEMBER_CARD_INJECT: name },
      encoding: 'utf8'
    })
    if (run.status !== 0) console.log(`  ✓ 注入 ${name} 被检出`)
    else {
      bad += 1
      console.error(`  ✗ 注入 ${name} 未被检出（断言不会失败 = 守卫无效）`)
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

console.log(`\n#20 / #21 会员卡信封态与档案动线断言：通过 ${passed} / ${passed + failed}`)
if (failed) {
  failures.forEach((f) => console.error('  ✗ ' + f))
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ 通过（未注册/退出=信封+动态蝴蝶 / 等级卡互斥 / 档案入口可达 / 清单与完成度同源）')
