/**
 * 仪式反馈层（需求 28 · 玩法动作的即时反馈）—— 主包 utils，供祈福墙与后续全站玩法共用。
 *
 * 一次动作（点灯 / 敲木鱼 / 落愿 / 后续卜卦、星座、MBTI…）→ 三件事：
 *   1) **音效**：只有**存在素材**的动作才响（素材表是唯一事实源，不写不存在的路径）；
 *      默认开、可关、跟随系统静音（`obeyMuteSwitch` 默认 true —— 这是刻意的：
 *      礼赠语音是"内容"所以要压过静音键，仪式音效是"装饰"所以必须让静音键说了算）；
 *   2) **震动**：给页面自己调（各家机型支持度不同，页面侧已有 try/catch）；
 *   3) **弹幕墙上的即时回声**：墙面页脚回一句 + 墙边框脉冲（见页面 `pushEcho`）。
 *
 * 三条硬约束（都与本项目踩过的坑对应）：
 *   - **不写云、不进愿签集合**：木鱼可连点，写服务端就是写放大；回声只是本地瞬时反馈；
 *   - **不用随机数**：回声文案按 `seq` 确定性轮换（与 `buildDanmakuRows` 同一条铁律，
 *     否则每次 setData 都在变，也没法断言）；
 *   - **静默降级**：素材缺失 / 基础库不支持 / 存储不可用 / 播放失败 → 一律不抛、不阻断动作。
 */

/** 音效开关的存储键（默认开：产品口径"默认开但可关"） */
const SOUND_KEY = 'ritual_sound_enabled_v1'

/**
 * 同一动作的最小发声间隔。木鱼可以连点，0.26s 的音效在连点时会叠成噪音，
 * 且频繁重启 InnerAudioContext 在低端机上会掉帧 —— 120ms 是"手感还在、但不叠"的值。
 * ⚠️ 只节流**声音**：视觉回声与震动每次都响应（手感不能丢）。
 */
const SOUND_MIN_GAP_MS = 120

/** 回声在墙上停留的时长（与 WXSS 的 `ww-echo-life` 动画时长同源，改一处必须改两处） */
const ECHO_HOLD_MS = 1800

/** 回声文案长度上限（墙上页脚只有 44rpx 高，一行说完；守卫按此逐条断言） */
const ECHO_MAX_CHARS = 14

/**
 * 音效素材表：动作 → 包内路径。
 * ⚠️ 只登记**磁盘上真实存在**的文件（守卫会核对），否则就是"看起来接了音效、其实永远不响"。
 * 素材由 `miniprogram/scripts/make-ritual-audio.mjs` 合成（可复现、无第三方版权素材）。
 */
const SOUND_SOURCES = {
  muyu: '/subpackages/feature/wish-wall/assets/muyu.mp3',
  // 2026-09-18 补：点灯此前**没有音效**（"玩法动作的音效"只做了木鱼那一半）。
  // 铜磬与木鱼是两套模态参数（金属非谐分音 vs 空心木头），所以是两个文件、两种性格。
  lamp: '/subpackages/feature/wish-wall/assets/lamp.mp3'
}

/**
 * 回声文案池：同一动作给几句，按 seq 轮换（敲木鱼连点会换词，像真的在回应）。
 * ⚠️ 每条 ≤ ECHO_MAX_CHARS，且**必须第一人称开头**（守卫逐条断言）：
 * 墙上其余弹幕都是别人的心愿，回声一旦没有主语（如「笃 · 静一分」），
 * 就会被读成"别人发的"，等于往愿签堆里混了一条假心愿。
 */
const ECHO_LINES = {
  muyu: ['我敲了一下木鱼', '我敲一声，静一分', '我一敲，心事就轻一分'],
  lamp: ['我点了今天的灯', '我点的灯，愿有着落'],
  // 已点过灯再点一次 = 「再看一眼灯」，与"又点了一次灯"要分开说（同一件事不能说两遍）
  lampAgain: ['我又看了一眼今天的灯', '我再看一眼，灯还亮着'],
  wish: ['我把心愿挂上墙了'],
  // 后续玩法（今日一签 / Fortune Cookie / 星座 / MBTI）在这里登记即可，页面不必改
  play: ['我抽了今日一签']
}

/** 动作 → 副文案（计数/连续天数等"事实"，没有就给空串，不硬凑） */
function echoSub(action, ctx) {
  const c = ctx || {}
  if (action === 'muyu') {
    const n = Number(c.muyuCount) || 0
    return n > 0 ? `功德 ${n}` : ''
  }
  if (action === 'lamp') {
    const n = Number(c.streak) || 0
    return n > 1 ? `连续 ${n} 天` : ''
  }
  if (action === 'wish') {
    const left = Number(c.quotaLeft)
    return Number.isFinite(left) && left >= 0 ? `今日还可写 ${left} 条` : ''
  }
  return ''
}

/** 动作 → 回声文案（确定性轮换；未知动作返回空串，页面据此不回显） */
function echoLine(action, seq) {
  const lines = ECHO_LINES[String(action || '')]
  if (!Array.isArray(lines) || !lines.length) return ''
  const i = ((Math.round(Number(seq) || 0) % lines.length) + lines.length) % lines.length
  return String(lines[i] || '')
}

/**
 * 组装一条回声记录（给页面 setData 用）。
 * `key` 必须每次不同 —— 它进 `wx:key`，靠 DOM 重建来**重播**动画（同 key 不会重播）。
 * @returns {{key:string, action:string, text:string, sub:string}|null} 未知动作/空文案 → null
 */
function buildEcho(action, seq, ctx) {
  const text = echoLine(action, seq)
  if (!text) return null
  return {
    key: `${String(action)}#${Math.round(Number(seq) || 0)}`,
    action: String(action),
    text,
    sub: echoSub(action, ctx)
  }
}

/* ------------------------------- 音效开关 ------------------------------- */

function readStore(key, fallback) {
  try {
    if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return fallback
    const v = wx.getStorageSync(key)
    return v === '' || v === null || v === undefined ? fallback : v
  } catch (e) {
    return fallback
  }
}

function writeStore(key, value) {
  try {
    if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return false
    wx.setStorageSync(key, value)
    return true
  } catch (e) {
    return false
  }
}

/** 音效是否开启（**默认开**；存储不可用时也返回默认值，绝不抛） */
function isSoundEnabled() {
  const v = readStore(SOUND_KEY, true)
  return v !== false && v !== 0 && v !== '0'
}

function setSoundEnabled(on) {
  const next = !!on
  writeStore(SOUND_KEY, next)
  return next
}

function toggleSound() {
  return setSoundEnabled(!isSoundEnabled())
}

/* --------------------------------- 播放 --------------------------------- */

/**
 * 纯函数频率闸门：上一次发声距今是否够久。
 * 抽成纯函数是为了能在守卫里断言（页面里没法稳定复现"连点"的时序）。
 *
 * ⚠️ 「没响过」**必须用 null/undefined 表示，不能用 0**：时间戳 0 是合法值，
 * 拿 0 当哨兵会让"t=0 响过一声"被当成"从没响过"，闸门静默失效（自检时抓到的）。
 */
function shouldPlaySound(lastAtMs, nowMs, gapMs) {
  if (lastAtMs === null || lastAtMs === undefined || lastAtMs === '') return true
  const last = Number(lastAtMs)
  if (!Number.isFinite(last)) return true
  const now = Number(nowMs)
  if (!Number.isFinite(now)) return true
  const gap = Number.isFinite(Number(gapMs)) ? Number(gapMs) : SOUND_MIN_GAP_MS
  return now - last >= gap
}

/**
 * 音效播放器：**一个动作一个实例**（同一个实例上连点会互相打断、且安卓上 restart 有杂音）。
 * 返回 `{ play(action, nowMs), destroy() }`；任何失败都只是"没响"，不影响动作本身。
 *
 * @param {{sources?:object, createContext?:Function}} [opts] 便于守卫注入桩
 */
function createPlayer(opts) {
  const o = opts || {}
  const sources = o.sources || SOUND_SOURCES
  const create =
    o.createContext ||
    (() => {
      if (typeof wx === 'undefined' || typeof wx.createInnerAudioContext !== 'function') return null
      return wx.createInnerAudioContext()
    })
  const ctxOf = {}
  const lastAtOf = {}

  function play(action, nowMs) {
    const key = String(action || '')
    const src = sources[key]
    if (!src) return false
    const now = nowMs == null ? Date.now() : Number(nowMs)
    if (!shouldPlaySound(lastAtOf[key], now, SOUND_MIN_GAP_MS)) return false
    try {
      if (!ctxOf[key]) {
        const ctx = create()
        if (!ctx) return false
        // 失败（素材损坏/被系统打断）不该冒泡：装饰性音效不值得弹错
        if (typeof ctx.onError === 'function') ctx.onError(() => {})
        ctx.src = src
        ctxOf[key] = ctx
      }
      lastAtOf[key] = now
      const ctx = ctxOf[key]
      // stop() 后再 play()：连点要"重新敲一下"，不是排长队
      try { ctx.stop() } catch (e) { /* 未播放时 stop 可能报错，忽略 */ }
      ctx.play()
      return true
    } catch (e) {
      return false
    }
  }

  function destroy() {
    Object.keys(ctxOf).forEach((k) => {
      try { ctxOf[k].destroy() } catch (e) { /* ignore */ }
      delete ctxOf[k]
    })
  }

  return { play, destroy }
}

/**
 * 页面唯一入口：算一次动作的全部反馈。
 * @param {string} action
 * @param {{seq?:number, nowMs?:number, player?:object, soundEnabled?:boolean} & object} [opts]
 *        ctx 里的 muyuCount / streak / quotaLeft 会被 echoSub 读取
 * @returns {{echo:object|null, played:boolean}}
 */
function emitFeedback(action, opts) {
  const o = opts || {}
  const enabled = o.soundEnabled == null ? isSoundEnabled() : !!o.soundEnabled
  let played = false
  if (enabled && o.player && typeof o.player.play === 'function') {
    played = o.player.play(action, o.nowMs) === true
  }
  return { echo: buildEcho(action, o.seq, o), played }
}

module.exports = {
  SOUND_KEY,
  SOUND_MIN_GAP_MS,
  ECHO_HOLD_MS,
  ECHO_MAX_CHARS,
  SOUND_SOURCES,
  ECHO_LINES,
  echoLine,
  echoSub,
  buildEcho,
  isSoundEnabled,
  setSoundEnabled,
  toggleSound,
  shouldPlaySound,
  createPlayer,
  emitFeedback
}
