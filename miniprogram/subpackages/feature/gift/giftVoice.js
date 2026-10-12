/**
 * 礼赠礼笺语音：录音 / 上传 / 播放（与落笔文字动画解耦）
 * 上限 60s；格式 mp3（两端试听更稳）；iPhone 优先内置麦 + 全局忽略静音键
 */

const MAX_DURATION_SEC = 60
const MAX_DURATION_MS = MAX_DURATION_SEC * 1000
/** 有效录音最短时长（ms）；低于则视为误触/权限弹窗打断后的空文件 */
const MIN_VOICE_MS = 600
/** 有效文件下限（字节）；过小多为无麦或空壳 */
const MIN_VOICE_BYTES = 800
const VOICE_FORMAT = 'mp3'
const VOICE_EXT = 'mp3'

function formatDuration(sec) {
  const n = Math.max(0, Math.floor(Number(sec) || 0))
  const m = Math.floor(n / 60)
  const s = n % 60
  return `${m}:${s < 10 ? `0${s}` : s}`
}

function isIosDevice() {
  try {
    const info =
      (typeof wx.getDeviceInfo === 'function' && wx.getDeviceInfo()) ||
      wx.getSystemInfoSync() ||
      {}
    const plat = String(info.platform || info.system || '').toLowerCase()
    return plat.indexOf('ios') >= 0 || plat.indexOf('iphone') >= 0
  } catch (e) {
    return false
  }
}

/** 基础库 ≥2.3.0：obeyMuteSwitch 属性失效，须全局设置，否则 iPhone 静音键下「有文件无声音」 */
let _innerAudioOptionReady = false
function ensureInnerAudioOption() {
  if (_innerAudioOptionReady) return
  _innerAudioOptionReady = true
  try {
    if (typeof wx.setInnerAudioOption === 'function') {
      wx.setInnerAudioOption({
        obeyMuteSwitch: false,
        mixWithOther: true,
        success: () => {},
        fail: () => {}
      })
    }
  } catch (e) {
    /* ignore */
  }
}

/**
 * @returns {Promise<'granted'|'denied'|'unknown'>}
 */
function getRecordAuthState() {
  return new Promise((resolve) => {
    wx.getSetting({
      success: (setting) => {
        const v =
          setting && setting.authSetting
            ? setting.authSetting['scope.record']
            : undefined
        if (v === true) resolve('granted')
        else if (v === false) resolve('denied')
        else resolve('unknown')
      },
      fail: () => resolve('unknown')
    })
  })
}

function openRecordSetting() {
  return new Promise((resolve) => {
    // ⚠️ 保留系统弹窗：确认后要调 wx.openSetting，须在用户点击手势内同步发起；
    // AppModal 的回调是 Promise 异步触发，不算手势（docs/弹层视觉规范_2026-10-13.md §7）
    wx.showModal({
      title: '需要麦克风权限',
      content:
        '录制礼笺语音需要麦克风。请在设置中打开「录音」，然后返回再按住说话。',
      confirmText: '去设置',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) {
          resolve(false)
          return
        }
        wx.openSetting({
          success: (s) => {
            resolve(!!(s.authSetting && s.authSetting['scope.record']))
          },
          fail: () => resolve(false)
        })
      },
      fail: () => resolve(false)
    })
  })
}

/**
 * 申请录音权限 scope.record
 * @returns {Promise<{ok:boolean, justGranted?:boolean, denied?:boolean}>}
 */
function ensureRecordAuth() {
  return getRecordAuthState().then((state) => {
    if (state === 'granted') return { ok: true, justGranted: false }
    if (state === 'denied') {
      return openRecordSetting().then((ok) => ({
        ok: !!ok,
        justGranted: !!ok,
        denied: !ok
      }))
    }
    return new Promise((resolve) => {
      wx.authorize({
        scope: 'scope.record',
        success: () => resolve({ ok: true, justGranted: true }),
        fail: () => {
          openRecordSetting().then((ok) => {
            resolve({ ok: !!ok, justGranted: !!ok, denied: !ok })
          })
        }
      })
    })
  })
}

function getFileSize(filePath) {
  return new Promise((resolve) => {
    if (!filePath) {
      resolve(0)
      return
    }
    try {
      wx.getFileSystemManager().getFileInfo({
        filePath,
        success: (res) => resolve((res && res.size) || 0),
        fail: () => resolve(0)
      })
    } catch (e) {
      resolve(0)
    }
  })
}

/** 持久化临时录音，避免预览时 tmp 被回收 */
function persistVoiceLocally(tempFilePath) {
  return new Promise((resolve) => {
    const src = String(tempFilePath || '').trim()
    if (!src) {
      resolve('')
      return
    }
    try {
      const fs = wx.getFileSystemManager()
      const dest = `${wx.env.USER_DATA_PATH}/gift_voice_${Date.now()}.${VOICE_EXT}`
      fs.copyFile({
        srcPath: src,
        destPath: dest,
        success: () => resolve(dest),
        fail: () => resolve(src)
      })
    } catch (e) {
      resolve(src)
    }
  })
}

/**
 * 上传至云存储 gift/voice/
 * @returns {Promise<string>} fileID
 */
function uploadGiftVoice(tempFilePath) {
  const stamp = Date.now()
  const rand = Math.random().toString(36).slice(2, 8)
  const cloudPath = `gift/voice/${stamp}_${rand}.${VOICE_EXT}`
  return wx.cloud
    .uploadFile({
      cloudPath,
      filePath: tempFilePath
    })
    .then((res) => {
      if (!res || !res.fileID) throw new Error('upload empty')
      return res.fileID
    })
}

/** 尽力删除旧录音（失败忽略） */
function deleteCloudVoice(fileID) {
  const id = String(fileID || '').trim()
  if (!id || id.indexOf('cloud://') !== 0) return Promise.resolve()
  return wx.cloud.deleteFile({ fileList: [id] }).catch(() => {})
}

/** 云文件 ID → 临时 HTTPS（播放更稳；无后缀 URL 在部分 iOS 上会失败） */
function resolvePlayableUrl(src) {
  const url = String(src || '').trim()
  if (!url) return Promise.resolve('')
  if (url.indexOf('cloud://') !== 0) return Promise.resolve(url)
  return wx.cloud
    .getTempFileURL({ fileList: [url] })
    .then((res) => {
      const item = (res && res.fileList && res.fileList[0]) || null
      if (item && item.tempFileURL && (!item.status || item.status === 0)) {
        return item.tempFileURL
      }
      return ''
    })
    .catch(() => '')
}

function mapRecordError(err) {
  const msg = String((err && (err.errMsg || err.message)) || '')
  const code = (err && err.code) || ''
  if (code === 'NEED_RETRY' || msg.indexOf('gesture interrupted') >= 0) {
    return { toast: '请再次按住说话', silent: false, needRetry: true }
  }
  if (
    code === 'AUTH_DENIED' ||
    msg.indexOf('auth denied') >= 0 ||
    msg.indexOf('authorize:fail') >= 0 ||
    msg.indexOf('auth deny') >= 0
  ) {
    return {
      toast: '未开启麦克风，请到设置允许录音',
      silent: false,
      authDenied: true
    }
  }
  if (msg.indexOf('is recording') >= 0 || msg.indexOf('fail:is recording') >= 0) {
    return { toast: '上一段还在结束，请稍后再按住', silent: false }
  }
  if (msg.indexOf('NotFoundError') >= 0 || msg.indexOf('not found') >= 0) {
    return { toast: '找不到麦克风，请检查系统权限', silent: false }
  }
  return { toast: '录音未能开始，请重试', silent: false }
}

/** 极短触摸：低于此毫秒视为误触，丢弃 */
const MIN_HOLD_MS = 280

/**
 * 按住说话录音器
 * 关键：touchstart→start / touchend→stop；松手早于 onStart 时用 pendingStop 收束。
 * 权限弹窗会打断触摸：授权成功后提示再按一次，避免空文件上传。
 * @param {{ onStart?: Function, onStop?: Function, onError?: Function, onTick?: Function }} hooks
 */
function createGiftRecorder(hooks) {
  const h = hooks || {}
  const recorder = wx.getRecorderManager()
  let recording = false
  let starting = false
  let sessionId = 0
  let pendingStop = false
  let discardStop = false
  let tickTimer = null
  let startedAt = 0

  const clearTick = () => {
    if (tickTimer) {
      clearInterval(tickTimer)
      tickTimer = null
    }
  }

  const hardStop = () => {
    try {
      recorder.stop()
    } catch (e) {
      /* ignore */
    }
  }

  recorder.onStart(() => {
    recording = true
    starting = false
    startedAt = Date.now()
    if (pendingStop) {
      pendingStop = false
      hardStop()
      return
    }
    clearTick()
    tickTimer = setInterval(() => {
      const elapsed = Math.min(
        MAX_DURATION_SEC,
        Math.floor((Date.now() - startedAt) / 1000)
      )
      if (typeof h.onTick === 'function') h.onTick(elapsed)
    }, 200)
    if (typeof h.onStart === 'function') h.onStart()
  })

  recorder.onStop((res) => {
    const wasDiscard = discardStop
    discardStop = false
    recording = false
    starting = false
    pendingStop = false
    clearTick()
    const durationMs = Math.min(
      MAX_DURATION_MS,
      Math.max(0, (res && res.duration) || (startedAt ? Date.now() - startedAt : 0))
    )
    const durationSec = Math.min(
      MAX_DURATION_SEC,
      Math.max(0, Math.round(durationMs / 1000) || (durationMs >= MIN_VOICE_MS ? 1 : 0))
    )
    if (typeof h.onStop === 'function') {
      h.onStop({
        tempFilePath: wasDiscard ? '' : (res && res.tempFilePath) || '',
        durationSec: wasDiscard ? 0 : durationSec,
        durationMs: wasDiscard ? 0 : durationMs,
        discarded: wasDiscard
      })
    }
  })

  recorder.onError((err) => {
    recording = false
    starting = false
    pendingStop = false
    discardStop = false
    clearTick()
    if (typeof h.onError === 'function') h.onError(err || { errMsg: 'recorder error' })
  })

  return {
    isRecording: () => recording,
    isBusy: () => recording || starting,
    /**
     * 开始一次按住会话。返回 sessionId；若权限弹窗期间用户已松手，调用方用同一 session 的 stop/cancel 收束。
     * @returns {Promise<number|false>}
     */
    async start() {
      if (recording || starting) return false
      starting = true
      pendingStop = false
      discardStop = false
      const mySession = ++sessionId

      const auth = await ensureRecordAuth()
      if (mySession !== sessionId) {
        starting = false
        return false
      }
      if (!auth || !auth.ok) {
        starting = false
        if (typeof h.onError === 'function') {
          h.onError({ errMsg: 'record auth denied', code: 'AUTH_DENIED' })
        }
        return false
      }

      // 首次授权系统弹窗会打断触摸：勿硬开录（易出空/无声文件），提示再按一次
      if (auth.justGranted) {
        starting = false
        pendingStop = false
        discardStop = false
        if (typeof h.onError === 'function') {
          h.onError({
            errMsg: 'record gesture interrupted',
            code: 'NEED_RETRY'
          })
        }
        return false
      }

      // 授权等待期间已松手：静默结束（短按由上层提示「按住说话」）
      if (pendingStop) {
        starting = false
        pendingStop = false
        discardStop = false
        return false
      }

      if (mySession !== sessionId) {
        starting = false
        return false
      }

      try {
        const opts = {
          duration: MAX_DURATION_MS,
          sampleRate: 16000,
          numberOfChannels: 1,
          encodeBitRate: 48000,
          format: VOICE_FORMAT
        }
        // iPhone + 蓝牙音箱无麦时 auto 会录到静音；优先内置麦
        if (isIosDevice()) {
          opts.audioSource = 'buildInMic'
        }
        recorder.start(opts)
        return mySession
      } catch (e) {
        starting = false
        if (typeof h.onError === 'function') h.onError(e)
        return false
      }
    },
    /** 松手结束：若尚在 starting（权限/onStart 未到），记 pendingStop，等 onStart 后立刻 stop */
    stop() {
      if (starting && !recording) {
        pendingStop = true
        return
      }
      if (!recording) return
      hardStop()
    },
    /** 上滑取消 / 极短触摸：停录且不上传 */
    cancel() {
      discardStop = true
      if (starting && !recording) {
        pendingStop = true
        return
      }
      if (!recording) {
        discardStop = false
        return
      }
      hardStop()
    },
    destroy() {
      sessionId += 1
      clearTick()
      discardStop = true
      pendingStop = false
      starting = false
      try {
        if (recording) recorder.stop()
      } catch (e) {
        /* ignore */
      }
      recording = false
    }
  }
}

/**
 * InnerAudioContext 播放器（页面 unload 需 destroy）
 */
function createGiftPlayer(hooks) {
  const h = hooks || {}
  let audio = null
  let playToken = 0
  let pendingCanplay = null

  const ensure = () => {
    ensureInnerAudioOption()
    if (audio) return audio
    audio = wx.createInnerAudioContext()
    // 旧基础库仍读属性；≥2.3.0 依赖 setInnerAudioOption
    try {
      audio.obeyMuteSwitch = false
    } catch (e) {
      /* ignore */
    }
    audio.onPlay(() => {
      if (typeof h.onPlay === 'function') h.onPlay()
    })
    audio.onPause(() => {
      if (typeof h.onPause === 'function') h.onPause()
    })
    audio.onStop(() => {
      if (typeof h.onStop === 'function') h.onStop()
    })
    audio.onEnded(() => {
      if (typeof h.onEnded === 'function') h.onEnded()
    })
    audio.onError((err) => {
      if (typeof h.onError === 'function') h.onError(err)
    })
    return audio
  }

  const clearCanplay = () => {
    if (!audio || !pendingCanplay) return
    try {
      audio.offCanplay(pendingCanplay)
    } catch (e) {
      /* ignore */
    }
    pendingCanplay = null
  }

  return {
    play(src) {
      const raw = String(src || '').trim()
      if (!raw) {
        if (typeof h.onError === 'function') h.onError({ errMsg: 'empty src' })
        return
      }
      const a = ensure()
      const token = ++playToken

      const startWithUrl = (url) => {
        if (!url || token !== playToken) {
          if (!url && typeof h.onError === 'function') {
            h.onError({ errMsg: 'resolve play url failed' })
          }
          return
        }
        if (a.src === url && !a.paused) {
          a.pause()
          return
        }
        if (a.src === url && a.paused) {
          a.play()
          return
        }
        clearCanplay()
        try {
          a.stop()
        } catch (e) {
          /* ignore */
        }
        pendingCanplay = () => {
          if (token !== playToken) return
          clearCanplay()
          try {
            a.play()
          } catch (e) {
            if (typeof h.onError === 'function') h.onError(e)
          }
        }
        a.onCanplay(pendingCanplay)
        a.src = url
        // 部分机型不回调 canplay：短暂兜底再 play（已 play 则无害）
        setTimeout(() => {
          if (token !== playToken || !pendingCanplay) return
          try {
            a.play()
          } catch (e) {
            /* ignore */
          }
        }, 320)
      }

      resolvePlayableUrl(raw).then(startWithUrl)
    },
    pause() {
      if (audio) {
        try {
          audio.pause()
        } catch (e) {
          /* ignore */
        }
      }
    },
    stop() {
      playToken += 1
      clearCanplay()
      if (audio) {
        try {
          audio.stop()
        } catch (e) {
          /* ignore */
        }
      }
    },
    destroy() {
      playToken += 1
      clearCanplay()
      if (audio) {
        try {
          audio.stop()
          audio.destroy()
        } catch (e) {
          /* ignore */
        }
        audio = null
      }
    }
  }
}

module.exports = {
  MAX_DURATION_SEC,
  MAX_DURATION_MS,
  MIN_HOLD_MS,
  MIN_VOICE_MS,
  MIN_VOICE_BYTES,
  VOICE_FORMAT,
  formatDuration,
  ensureRecordAuth,
  ensureInnerAudioOption,
  mapRecordError,
  uploadGiftVoice,
  deleteCloudVoice,
  persistVoiceLocally,
  getFileSize,
  resolvePlayableUrl,
  createGiftRecorder,
  createGiftPlayer
}
