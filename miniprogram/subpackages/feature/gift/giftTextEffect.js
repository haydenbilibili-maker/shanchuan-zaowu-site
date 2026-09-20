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
 * 音效设计（2026-09-20 第三轮，按真机证据重做；同日第四轮：素材换成**铅笔书写**录音）
 *
 * **不再"每字敲一下"，而是"书写期间放一条循环敲击床"** —— 一次书写只动两次原生音频调用
 * （起笔 `play()`、收笔 `stop()`），逐字回调里**0 次**。
 *
 * 为什么必须这样（三轮真机反馈推出的结论）：
 *   1. 第一轮："音效导致页面卡顿" → 每字 4 次原生写（含重设 `src`）；
 *   2. 第二轮："只响三声、每段隔 2 秒" → 素材敲击在第 110ms，而每 90ms 就 `stop()`
 *      一次，**声音在响之前被掐掉**（素材已重做，瞬态在 1ms）；
 *   3. 第三轮仍不对 → 说明这台机器上**单次 `play()/stop()` 本身就慢**：
 *      它既让逐字回调被拖住（页面卡顿），又让敲击声稀疏（听感=隔很久响一下）。
 *      ⇒ 唯一稳的解法是把调用次数降到"每段书写一两次"，而不是继续调参数。
 *
 * 第四轮（2026-09-20，产品负责人）：**音色由"打字机"改为一支铅笔在纸上书写**
 *   （素材：`gift-pencil-bed.wav`，取自 freesound「pencil writing」录音的一段）。
 *   换的只是音色，**上面两条硬约束不变**；且新素材刻意做到与旧床**等时长（2000ms）、
 *   等密度（16 次笔触 / 8.0 次每秒）、等响度（RMS 1.2×）**，因此节奏、`SFX_VOLUME`、
 *   静音键与三页调用方式**一律不用动** —— 换素材不该牵动播放逻辑。
 *
 * ⚠️ 素材硬约束（换音源时必须重新满足）：**开头的瞬态 ≤25ms**（床的第一个笔触也必须在
 *    0 附近，起笔即刻有声）；**≥8 次笔触**（否则听起来是单响而不是书写床）；时长 500~3000ms；
 *    末尾落在两次笔触之间的安静处（否则循环接缝会"咔"一声）；16bit PCM 单声道 WAV。
 *    守卫 `check:gift-sfx-perf` 会**解码这个文件**逐条断言，并断言本常量确实指向它 ——
 *    免得"守卫查一个文件、代码放另一个文件"。
 */
const SFX_SRC = '/subpackages/feature/gift/assets/gift-pencil-bed.wav'
/** 床是**连续**在场的，同样音量会比"断续单响"听起来更吵，故比第一轮的 0.58 略低 */
const SFX_VOLUME = 0.45
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
 * 距上次落笔超过它就视为**新的一次书写**（用于重置看门狗计数）。
 * 逐字间隔只有 52~99ms（标点 260~360ms），1.2s 足以把两次书写分开。
 */
const TYPING_IDLE_MS = 1200

/** 音源单例（与 giftVoice.js 的既有约定一致：模块级持有，避免每次新建上下文） */
let _sfx = null
/** 仅在音频**报错**后置位 → 下次启动床时才重设 src（自愈），正常路径不重设 */
let _sfxNeedsReload = false
/** 上次落笔时刻（判"是否同一次书写"；0 = 新会话） */
let _lastTickAt = 0
/** 床当前是否应该在响（乐观置位；`onPlay` 会确认，看门狗会纠偏） */
let _bedPlaying = false

/**
 * 「play 到底生不生效」的看门狗（第三轮新增，仍是运行时观测而非赌机型）。
 *
 * `play()` 成功开始播放会触发 `onPlay`。若连发 `WATCHDOG_PLAYS` 次 play 却一次 `onPlay`
 * 都没回来，说明这台机型不认这条路，于是切到"重设 src 再播"的可靠路径；
 * 观测到一次 `onPlay` 就永不切换。为避免"一直不响就一直重试"把页面拖死，
 * 每次书写最多重试 `MAX_START_RETRIES` 次。
 */
const WATCHDOG_TICKS = 4
const MAX_START_RETRIES = 3
let _plays = 0
let _playEvents = 0
let _retries = 0
/** "床应该响、却始终收不到 onPlay"的落笔计数（看门狗判据） */
let _silentTicks = 0
/** 一旦观测到"play 不生效"就置位（**粘性**：不因换页/换会话而被重置，避免反复试错） */
let _reliableReload = false

function ensureSfx () {
  if (_sfx) return _sfx
  const audio = wx.createInnerAudioContext()
  audio.obeyMuteSwitch = true
  audio.volume = SFX_VOLUME
  audio.src = SFX_SRC
  audio.loop = true
  audio.onPlay(() => {
    _playEvents += 1
    _bedPlaying = true
  })
  audio.onEnded(() => {
    // 理论上 loop=true 不会走到这里；若某些机型 loop 失效，这里补一次（每床一次，不构成热路径）
    _bedPlaying = false
    if (_lastTickAt && Date.now() - _lastTickAt < TYPING_IDLE_MS) startBed()
  })
  audio.onError((err) => {
    // 音效失败不打断书写，但下次启动床时要重载音源（否则会一直哑）
    _sfxNeedsReload = true
    console.warn('礼笺打字机音效出错，下次重载音源', err && (err.errMsg || err))
  })
  _sfx = audio
  return audio
}

/** 启动敲击床：一次书写里只会走 1 次（除非看门狗纠偏） */
function startBed () {
  try {
    const a = ensureSfx()
    _plays += 1
    if (_reliableReload || _sfxNeedsReload) reloadSfxSrc(a)
    a.play()
    _bedPlaying = true
    _silentTicks = 0
    armIdleWatch()
  } catch (e) {
    _sfxNeedsReload = true
    _bedPlaying = false
    console.warn('礼笺打字机音效启动失败，下次重载音源', e)
  }
}

/**
 * 空闲自停：床是循环的，万一某条路径漏了收笔就会一直响。
 * 每 `TYPING_IDLE_MS` 检查一次"最近还有没有落笔"，没有就自己停 —— 兜底，不依赖调用方。
 */
let _idleTimer = null

function armIdleWatch () {
  if (_idleTimer) return
  _idleTimer = setTimeout(() => {
    _idleTimer = null
    if (!_bedPlaying) return
    if (Date.now() - _lastTickAt > TYPING_IDLE_MS) stopTickSound()
    else armIdleWatch()
  }, TYPING_IDLE_MS)
}

function clearIdleWatch () {
  if (!_idleTimer) return
  clearTimeout(_idleTimer)
  _idleTimer = null
}

/**
 * 每个字落笔时调用（三页共用）。
 *
 * ⚠️ **热路径（床已在响时）必须是 0 次原生调用** —— 这是本设计唯一的目的：
 *   这台机器上单次 `play()/stop()` 本身就慢，任何"每字一次"的写法都会同时
 *   拖住逐字回调（页面卡顿）并让敲击变稀疏。
 *
 * ⚠️ 静音态下必须**主动停床**（不能只 `return`）：否则关掉声音后床还在响。
 *
 * ⚠️ **不要在 `clearTimer` 里调用销毁** —— 那种函数往往在每次 tick 内部都被调用，
 * 放进去会让音效一声都响不出来（不报错、极难查；编排页就是这么差点踩到的）。
 *   收笔请用 `stopTickSound()`（幂等，已响才停）。
 */
function playTick (muted) {
  if (muted) {
    stopTickSound()
    return
  }
  const now = Date.now()
  // 距上次落笔很久 → 新的一次书写：重置计数与重试预算（粘性结论 `_reliableReload` 不重置）
  if (now - _lastTickAt > TYPING_IDLE_MS) {
    _plays = 0
    _playEvents = 0
    _retries = 0
  }
  _lastTickAt = now
  if (_bedPlaying) {
    // 看门狗：床"应该"在响，却连一次 onPlay 都没收到 ⇒ 认定本机不认这条路，
    // 切到「重设音源再播」并重来一次；重试有上限，避免"一直不响就一直重试"拖死页面。
    _silentTicks += 1
    if (_playEvents === 0 && _silentTicks >= WATCHDOG_TICKS) {
      if (!_reliableReload) {
        _reliableReload = true
        console.warn('礼笺打字机音效：本机 play() 未生效，改用「重设音源再播」的可靠路径')
      }
      if (_retries >= MAX_START_RETRIES) return
      _retries += 1
      _bedPlaying = false
      _silentTicks = 0
    }
    if (_bedPlaying) return // ← 正常情况：0 次原生调用
  }
  startBed()
}

/** 收笔 / 静音 / 卸载时停床（幂等：没在响就什么都不做） */
function stopTickSound () {
  clearIdleWatch()
  if (!_bedPlaying) return
  _bedPlaying = false
  try { if (_sfx) _sfx.stop() } catch (e) { /* ignore */ }
}

/**
 * 静音开关的「试听」：床不能在没写字时一直响，所以放一小段就自己停。
 * @param {number} [ms] 试听时长
 */
function previewTickSound (ms) {
  _lastTickAt = Date.now()
  playTick(false)
  setTimeout(() => stopTickSound(), Math.max(300, Number(ms) || 900))
}

/** 罕见路径：音频报错/看门狗纠偏后重设音源，不在逐字热路径上 */
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
  _bedPlaying = false
  _plays = 0
  _playEvents = 0
  _retries = 0
  _silentTicks = 0
  clearIdleWatch()
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
  TYPING_IDLE_MS,
  PUNCT_RE,
  isMuted,
  setMuted,
  ensureSfx,
  playTick,
  stopTickSound,
  previewTickSound,
  destroySfx,
  isPunct,
  delayForChar,
  shouldDoubleWrite
}
