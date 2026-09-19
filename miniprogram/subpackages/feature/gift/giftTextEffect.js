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

const SFX_SRC = '/subpackages/feature/gift/assets/gift-typewriter.mp3'
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

/** 音源单例（与 giftVoice.js 的既有约定一致：模块级持有，避免每次新建上下文） */
let _sfx = null

function ensureSfx () {
  if (_sfx) return _sfx
  const audio = wx.createInnerAudioContext()
  audio.obeyMuteSwitch = true
  audio.volume = SFX_VOLUME
  audio.src = SFX_SRC
  audio.onError(() => { /* 音效失败不打断书写 */ })
  _sfx = audio
  return audio
}

/**
 * 每个字落笔时调用。
 * ⚠️ **不要在 `clearTimer` 里调用销毁** —— 那种函数往往在每次 tick 内部都被调用，
 * 放进去会让音效一声都响不出来（不报错、极难查；编排页就是这么差点踩到的）。
 */
function playTick (muted) {
  if (muted) return
  try {
    const a = ensureSfx()
    a.volume = SFX_VOLUME
    a.stop()
    // 部分基础库 stop 后再 play 需显式复位 src
    a.src = SFX_SRC
    a.play()
  } catch (e) { /* ignore */ }
}

/** 只在页面 onUnload 调用 */
function destroySfx () {
  if (!_sfx) return
  try { _sfx.stop(); _sfx.destroy() } catch (e) { /* ignore */ }
  _sfx = null
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
