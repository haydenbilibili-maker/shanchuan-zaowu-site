/**
 * 礼笺「打字机」效果共享件（打字节奏 + 音效 + 静音偏好）
 *
 * ## 为什么放在这个位置
 *
 * 编排页 `compose`、礼成页 `success`、收礼页 `receive` **三页同在 `subpackages/feature/gift`
 * 分包内** —— 分包内可以互相 `require`，**分包之间不行**。所以这里是三页唯一能共享的位置。
 * （若要给别的分包用，必须放主包 `utils/`。）
 *
 * ## 为什么必须共享
 *
 * 今日本仓已经吃过"同一套语义写三份"的亏（E18 单位、E21 单价、E23 映射）：
 * 三页各写一份打字节奏与音效，迟早出现"编排页响、礼成页不响"或"一处静音一处还在响"，
 * 而且**不会报错**。故：**节奏、音源、静音键、标点判断**全部收敛到这里；
 * 逐字循环本身留在各页（它绑定页面生命周期），调用这里的共享件。
 *
 * ## 静音偏好是**跨页共享**的
 *
 * 存储键沿用收礼页既有的 `gift_receive_sfx_muted` —— 同一个人"在礼赠流程里关过音效"
 * 这个意图应当一贯（收发是不同人不同设备，各自存储互不影响）。
 */

/**
 * ⚠️ 音源的第一条硬约束：**敲击瞬态必须落在文件开头（≤25ms）**。
 *
 * 真机事故（2026-09-19，产品负责人："只播放了三声，每段隔 2 秒左右"）：
 *   原来的 0.5s 素材把敲击放在 **110~120ms**、前面 100ms 是近乎静音，
 *   而热路径每 ~90ms 就 `stop()` 一次 —— **声音在响之前就被掐掉了**，
 *   只有恰好间隔够长的少数几次能走到瞬态，于是"只响几声、忽有忽无"。
 *   现素材 `gift-typewriter.wav` 是同一段录音切出来的 170ms 单声（PCM，瞬态在 1ms）。
 *   守卫 `check:gift-sfx-perf` 会**解码这个文件**断言瞬态位置 ≤25ms，
 *   并断言本常量确实指向它 —— 免得"守卫查一个文件、代码放另一个文件"。
 */
const SFX_SRC = '/subpackages/feature/gift/assets/gift-typewriter.wav'
const SFX_VOLUME = 0.58
const MUTE_KEY = 'gift_receive_sfx_muted'

/** 标点与空白不响、且停顿更久 —— 与"真打字机换行/停顿"的手感一致 */
const PUNCT_RE = /[，。；、！？—…\s]/
const PUNCT_PAUSE_MIN = 260
const PUNCT_PAUSE_MAX = 360

function isMuted () {
  try { return !!wx.getStorageSync(MUTE_KEY) } catch (e) { return false }
}

function setMuted (v) {
  try { wx.setStorageSync(MUTE_KEY, !!v) } catch (e) { /* 存储失败不影响本次会话 */ }
}

/**
 * 两次音效之间的最小间隔（毫秒）。
 *
 * 为什么必须有（2026-09-19 真机反馈"编排页打字时卡顿"，实测代码定位到这里）：
 *   逐字间隔只有 52~99ms，若每个字都重启一次音频，真机上音频管线一直在
 *   **加载/解码/重启**（叠加每字一次 setData），表现就是打字时掉帧、声音发糊。
 *   而打字机本来就是"离散按键"——限到 ≈11 次/秒以内反而更像，
 *   且把热路径的原生调用量直接减半。
 */
const MIN_TICK_GAP_MS = 90

/** 音源单例（与 giftVoice.js 的既有约定一致：模块级持有，避免每次新建上下文） */
let _sfx = null
/** 仅在音频**报错**后置位 → 下一次 tick 才重设 src（自愈），正常路径一次都不重设 */
let _sfxNeedsReload = false
/** 上次真正发声的时刻（节流用；0 = 可立即发声） */
let _lastTickAt = 0

/**
 * 「play 到底生不生效」的看门狗。
 *
 * 为什么需要：`stop()` 之后 `play()` 能否重启，**各基础库/机型不一致** ——
 *   业界流传的保险是"每次都重设 `src`"，但那会让真机反复加载/解码（就是上一轮的卡顿）。
 *   于是改成**运行时观测**：`play()` 成功开始播放会触发 `onPlay`；
 *   若连发 `WATCHDOG_PLAYS` 次 play 却一次 `onPlay` 都没回来，说明这台机型不会重启，
 *   立刻切到"重设 src 再播"的可靠路径（更贵，但比一声不响好）。
 *   观测到一次 `onPlay` 就永不切换 —— 健康的机型全程走廉价路径。
 */
const WATCHDOG_PLAYS = 6
let _plays = 0
let _playEvents = 0
/** 一旦观测到"play 不生效"就置位（**粘性**：不因换页/换会话而被重置，避免反复试错） */
let _reliableReload = false

function ensureSfx () {
  if (_sfx) return _sfx
  const audio = wx.createInnerAudioContext()
  audio.obeyMuteSwitch = true
  audio.volume = SFX_VOLUME
  audio.src = SFX_SRC
  audio.onPlay(() => { _playEvents += 1 })
  audio.onError((err) => {
    // 音效失败不打断书写，但下一次 tick 要重载音源（否则会一直哑）
    _sfxNeedsReload = true
    console.warn('礼笺打字机音效出错，下次重载音源', err && (err.errMsg || err))
  })
  _sfx = audio
  return audio
}

/**
 * 每个字落笔时调用。
 *
 * ⚠️ **热路径只许做两件原生调用（stop + play）**：
 *   · 每 tick 重设 `src` = 让真机反复加载/解码音频 → 这是上一轮卡顿的主因（默认不做）；
 *   · 每 tick 写 `volume` 也是原生属性写入，只在创建时设一次；
 *   · 重设 `src` 只在两种情况下发生：`onError` 之后，或看门狗判定"play 不生效"之后。
 *
 * ⚠️ 节流判断必须在**碰音频之前**：先 stop/play 再判断等于没节流。
 *
 * ⚠️ **不要在 `clearTimer` 里调用销毁** —— 那种函数往往在每次 tick 内部都被调用，
 * 放进去会让音效一声都响不出来（不报错、极难查；编排页就是这么差点踩到的）。
 */
function playTick (muted) {
  if (muted) return
  const now = Date.now()
  // 距上次发声超过一个"书写会话"的间隔 → 视为新会话，重置看门狗计数（但粘性结论不重置）
  if (now - _lastTickAt > 1200) {
    _plays = 0
    _playEvents = 0
  }
  if (now - _lastTickAt < MIN_TICK_GAP_MS) return
  _lastTickAt = now
  try {
    const a = ensureSfx()
    _plays += 1
    if (!_reliableReload && _plays >= WATCHDOG_PLAYS && _playEvents === 0) {
      _reliableReload = true
      console.warn('礼笺打字机音效：本机 play() 未生效，改用「重设音源再播」的可靠路径')
    }
    if (_reliableReload || _sfxNeedsReload) reloadSfxSrc(a)
    a.stop()
    a.play()
  } catch (e) {
    _sfxNeedsReload = true
    console.warn('礼笺打字机音效播放失败，下次重载音源', e)
  }
}

/** 罕见路径：音频报错后重设音源（自愈一次），不在热路径上 */
function reloadSfxSrc (a) {
  _sfxNeedsReload = false
  a.src = SFX_SRC
}

/** 只在页面 onUnload 调用 */
function destroySfx () {
  if (!_sfx) return
  try { _sfx.stop(); _sfx.destroy() } catch (e) { /* ignore */ }
  _sfx = null
  _sfxNeedsReload = false
  _lastTickAt = 0
  _plays = 0
  _playEvents = 0
  // 注意：`_reliableReload` 是**粘性**的 —— 这台机型不会重启就是不会，换页也不必重新试错
}

function isPunct (ch) {
  return PUNCT_RE.test(String(ch || ''))
}

/**
 * 每个字的间隔（毫秒）——三页共用同一节奏。
 * 标点更久、其余字 40~105ms 随机，避免机械等距。
 */
function delayForChar (ch) {
  if (isPunct(ch)) return PUNCT_PAUSE_MIN + Math.floor(Math.random() * (PUNCT_PAUSE_MAX - PUNCT_PAUSE_MIN))
  const base = 40 + Math.floor(Math.random() * 55)
  return base
}

/**
 * 是否偶发"连写两字"（更像运笔，而非机械机打）。
 * 抽出来是为了三页行为一致 —— 编排页原本就有这个手感，另外两页应当照旧。
 */
function shouldDoubleWrite (ch, nextCh) {
  if (isPunct(ch) || isPunct(nextCh)) return false
  return Math.random() < 0.18
}

module.exports = {
  SFX_SRC,
  SFX_VOLUME,
  MUTE_KEY,
  MIN_TICK_GAP_MS,
  PUNCT_RE,
  isMuted,
  setMuted,
  ensureSfx,
  playTick,
  destroySfx,
  isPunct,
  delayForChar,
  shouldDoubleWrite
}
