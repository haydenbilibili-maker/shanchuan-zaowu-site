/**
 * 玩法逻辑（纯函数）：注册表 + 内容池 → 今天这一次的结果。
 *
 * 三条设计约束：
 *   1. **确定性**：结果由 `(玩法 id, 日期, 资料字段值)` 决定，**不用随机数** ——
 *      与弹幕布局、每日灯语同一条铁律。好处不只是"能测"：用户同一天再点一次
 *      结果不变（"今日一签"就真的是一天一支），刷新页面也不会换一个。
 *   2. **缺资料就给引导，不给假结果**：需要星座/MBTI 的玩法在字段为空时返回
 *      `{ ok:false, reason:'need_profile' }`，页面据此把用户引到资料页
 *      （资料页补这两项各有 7/8 分完善奖励 —— 这本身就是一条转化路径）。
 *   3. **页面零判断**：页面拿到的永远是"标题 + 正文 + 可挂上墙的心愿词"，
 *      不需要知道某个玩法是抽签还是拼句（加玩法只改注册表与内容池）。
 */
const { findPlay, NEED_PROFILE_FIELDS, PROFILE_PAGE, VARIANT_PLAYS, playPage } = require('../config/ritualPlays')
const content = require('../config/ritualPlayContent')
const { ZODIAC_OPTIONS, MBTI_OPTIONS } = require('../../../utils/profileConstants')
const { rotateIndex, TEXT_MAX, solarTermOn, solarTermGap, SOLAR_TERMS } = require('../../../utils/wishWall')

/** 星座 key → 中文标签：从资料页那份常量取，**不在这里再写一遍中文**（两处必然漂移） */
function zodiacLabel(key) {
  const item = (ZODIAC_OPTIONS || []).find((z) => z.key === String(key || ''))
  return item ? item.label : String(key || '')
}

const SEASON_LABEL = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' }

/** 内容池 id → 取池函数（池不存在直接抛在启动期，别等到用户点下去才发现） */
const POOLS = {
  QIAN: () => content.QIAN,
  COOKIE: () => content.COOKIE,
  ZODIAC: () => content.ZODIAC_DAILY,
  MBTI: () => content.MBTI_DAILY,
  SOLAR: () => content.SOLAR_LINES,
  COIN: () => content.COIN
}

/**
 * 可"换一个"的玩法（星座 12 / MBTI 16）的候选维度。
 * 返回 `[{ key, label }]`；不可换的玩法返回空数组。
 * 为什么放这里：这是**资料字段的受控取值域**，页面与资料页必须同源（不各自写一遍中文）。
 */
function variantOptions(playId) {
  const key = VARIANT_PLAYS[String(playId || '')]
  if (!key) return []
  if (key === 'zodiac') return (ZODIAC_OPTIONS || []).map((z) => ({ key: z.key, label: z.label }))
  return (MBTI_OPTIONS || []).map((t) => ({ key: t, label: t }))
}

/** 从池里按 seed 稳定取一条（确定性：同 seed 同一条） */
function pick(pool, seed) {
  const list = Array.isArray(pool) ? pool : []
  if (!list.length) return null
  return list[rotateIndex(seed, list.length)] || list[0]
}

/**
 * 今日一签：池子条目自带 yi/ji/line/wish，整条即结果（不做二次拼装，内容可控）
 */
function resolveQian(seed) {
  const row = pick(POOLS.QIAN(), seed)
  if (!row) return null
  return {
    overline: '今日一签',
    title: `宜 ${row.yi}`,
    sub: `忌 ${row.ji}`,
    lines: [row.line],
    // 一签自带"可挂上墙"的心愿词（内容池里逐条写好，不靠模板拼字）
    wish: row.wish ? `马上有${row.wish}` : ''
  }
}

/** 拆签饼：签条一句 + 一句轻建议 */
function resolveCookie(seed) {
  const row = pick(POOLS.COOKIE(), seed)
  if (!row) return null
  return {
    overline: '签饼',
    title: '签饼里写着',
    sub: '',
    lines: [row.line, row.advice].filter(Boolean),
    // 签饼不预设心愿词：硬拼一个"马上有X"只会是废话，让用户自己写（页面给「马上有」开头）
    wish: ''
  }
}

/**
 * 节气签：按「今天 / 下一个节气」取时令句。
 * 确定性：同一天同一节气名 → 同一条；非节气日用距下个节气的那条。
 */
function resolveSolar(dayKey, seed) {
  const on = solarTermOn(dayKey)
  const gap = on ? null : solarTermGap(dayKey)
  const name = (on && on.name) || (gap && gap.name) || ''
  const season = (on && on.season) || (gap && gap.season) || ''
  const pool = POOLS.SOLAR() || {}
  const row = (name && pool[name]) || null
  if (!row) {
    // 表缺条时：按季节兜底取池里同季第一条（仍确定性）
    const seasonHit = (SOLAR_TERMS || []).find((t) => t.season === season)
    const fallbackName = (seasonHit && seasonHit.name)
      || ((SOLAR_TERMS || [])[rotateIndex(seed, (SOLAR_TERMS || []).length)] || {}).name
    const fb = fallbackName && pool[fallbackName]
    if (!fb) return null
    return {
      overline: on ? `今日 · ${on.name}` : (gap ? `距${gap.name} ${gap.inDays} 天` : '节气签'),
      title: fallbackName || '时令',
      sub: SEASON_LABEL[season] ? `${SEASON_LABEL[season]}季` : '',
      lines: [fb.line, fb.advice].filter(Boolean),
      wish: fb.wish ? `马上有${fb.wish}` : ''
    }
  }
  return {
    overline: on ? `今日 · ${on.name}` : (gap ? `距${gap.name} ${gap.inDays} 天` : '节气签'),
    title: name,
    sub: SEASON_LABEL[season] ? `${SEASON_LABEL[season]}季` : '',
    lines: [row.line, row.advice].filter(Boolean),
    wish: row.wish ? `马上有${row.wish}` : ''
  }
}

/**
 * 铜钱签：池子条目自带面文一字 + 一句 + 建议 + 心愿词。
 * 确定性：同 seed 同一枚面文。
 */
function resolveCoin(seed) {
  const row = pick(POOLS.COIN(), seed)
  if (!row) return null
  return {
    overline: '铜钱签',
    title: String(row.face || ''),
    sub: '今日一枚',
    lines: [row.line, row.advice].filter(Boolean),
    wish: row.wish ? `马上有${row.wish}` : ''
  }
}

/**
 * 星座 / MBTI：**底色（按字段选）+ 今日一句（按日期轮换）** 两段拼装。
 * 为什么不做成"每型 30 条"：内容量会失控且质量必然下滑；拼装让"同一天同一星座"
 * 稳定、不同星座之间也有差异，同时内容池保持可读、可审。
 */
function resolveHook(type, field, seed) {
  const hooks = type === 'ZODIAC' ? content.ZODIAC_HOOKS : content.MBTI_HOOKS
  const row = hooks[field]
  if (!row) return null
  const daily = pick(POOLS[type](), seed)
  const keyword = type === 'ZODIAC' ? row.keyword : ''
  const hook = type === 'ZODIAC' ? row.hook : row
  return {
    // 依据（星座/MBTI 型）只出现在**用户自己的卡片**上作上下文，绝不进墙上回声与分享文案
    overline: type === 'ZODIAC' ? `${zodiacLabel(field)} · 今日` : `${String(field)} · 今日`,
    title: keyword || '今天这一句',
    sub: '',
    lines: [hook, daily].filter(Boolean),
    wish: ''
  }
}

/**
 * 心愿词规范化：**只接受「马上有X」（1–3 个汉字）**，其余一律回落为空串。
 *
 * 为什么单独抽出来：这是"预填进写愿签的那句话"的最后一道锁（内容池写错、将来接 AI 生成
 * 都可能产出脏值）。抽成纯函数才**测得到**：合成断言（池子 + 校验）里，任何单点回归都会被
 * 另一层挡住，等于这条守卫永远不会失败（本轮注入自检就是这么暴露它的）。
 */
function normalizeWish(raw) {
  const wish = String(raw || '')
  return /^马上有[\u4e00-\u9fa5]{1,3}$/.test(wish) && wish.length <= TEXT_MAX ? wish : ''
}

/** 结果卡的 seed：玩法 + 日期（不含用户身份 —— 同一天同一玩法给同一结果，可分享、可对账） */
function playSeed(playId, dayKey) {
  return `${String(playId)}|${String(dayKey)}`
}

/**
 * 解析一次玩法。
 *
 * @param {string} playId
 * @param {{dayKey:string, profile?:{zodiac?:string,mbti?:string}}} ctx
 * @returns {{ok:true, id, mark, name, dayKey, title, sub, lines:string[], wish, share, kind, page, variant}
 *          |{ok:false, reason:'unknown_play'|'need_profile', field?, fieldLabel?, anchor?, profilePage?, gain?}}
 */
function resolvePlay(playId, ctx) {
  const play = findPlay(playId)
  if (!play) return { ok: false, reason: 'unknown_play' }
  const o = ctx || {}
  const dayKey = String(o.dayKey || '')
  const profile = o.profile || {}
  // 「换一个」（星座 12 / MBTI 16，PRD §11.2-4）：同一天内允许指定另一个维度取值。
  // 只在注册表声明可换（VARIANT_PLAYS）且值非空时生效 —— 其它玩法的 variant 一律忽略。
  const variant = VARIANT_PLAYS[play.id] ? String(o.variant || '') : ''

  // 需要资料字段的玩法：读不到就引导，不给假结果
  const need = (play.needs || [])[0]
  let fieldValue = ''
  if (need) {
    fieldValue = variant || String(profile[need] || '')
    if (!fieldValue) {
      const meta = NEED_PROFILE_FIELDS[need] || { label: need, anchor: '', gain: '' }
      return {
        ok: false,
        reason: 'need_profile',
        field: need,
        fieldLabel: meta.label,
        anchor: meta.anchor,
        gain: meta.gain,
        profilePage: PROFILE_PAGE
      }
    }
  }

  const seed = playSeed(play.id, dayKey)
  let body = null
  if (play.pool === 'QIAN') body = resolveQian(seed)
  else if (play.pool === 'COOKIE') body = resolveCookie(seed)
  else if (play.pool === 'ZODIAC') body = resolveHook('ZODIAC', fieldValue, `${seed}|z`)
  else if (play.pool === 'MBTI') body = resolveHook('MBTI', fieldValue, `${seed}|m`)
  else if (play.pool === 'SOLAR') body = resolveSolar(dayKey, seed)
  else if (play.pool === 'COIN') body = resolveCoin(seed)
  if (!body) return { ok: false, reason: 'unknown_play' }

  // 心愿词（可空）：要么是「马上有X」且长度合法，要么为空 —— 页面据此决定"预填"还是"只给开头"
  const safeWish = normalizeWish(body.wish)

  return {
    ok: true,
    id: play.id,
    mark: play.mark,
    name: play.name,
    cta: play.cta,
    echo: play.echo,
    // 玩法的结构事实：结果纸面语言 / 独立页 / 进行态参数（页面按它渲染，不写死玩法名）
    kind: String(play.kind || ''),
    page: playPage(play.id),
    spinMs: Number(play.spinMs) || 0,
    spinText: String(play.spinText || ''),
    // 文化一层（§11.3：只讲来历习俗，不做个人吉凶判断）
    note: String((content.KIND_NOTES || {})[play.kind] || ''),
    dayKey,
    // 「换一个」的当前维度（无则可换玩法的空串）与它的中文标签（星座）／型别（MBTI）
    variant,
    variantLabel: play.pool === 'ZODIAC' && variant ? zodiacLabel(variant) : variant,
    overline: String(body.overline || ''),
    title: String(body.title || ''),
    sub: String(body.sub || ''),
    lines: (body.lines || []).map((s) => String(s || '')).filter(Boolean),
    wish: safeWish,
    /**
     * 分享文案：**不含"依据"** —— 需要星座/MBTI 的玩法，分享出去只带抽到的那句，
     * 不带「白羊座」「INFP」（口径：只公开结果与建议，不公开依据；守卫按此断言）。
     */
    share: `${play.name}：${(play.needs || []).length ? '' : (body.overline ? String(body.overline) + ' · ' : '')}${String(body.title || '')}${body.lines && body.lines[0] ? ' · ' + body.lines[0] : ''}`
  }
}

module.exports = {
  POOLS,
  pick,
  playSeed,
  normalizeWish,
  variantOptions,
  resolvePlay
}
