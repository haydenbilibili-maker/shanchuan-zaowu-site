#!/usr/bin/env node
/**
 * check:gift-sfx-perf —— 礼笺打字机音效的**真机开销**守卫（2026-09-19 真机反馈"编排页打字卡顿"）
 *
 * ## 为什么要有这条守卫
 *
 * 卡顿的根因不在"有没有响"，而在**每个字都做了多少次原生调用**：
 *   逐字间隔只有 52~99ms，若每 tick 都重设 `src`，真机上音频管线会一直在
 *   加载/解码/重启（叠加每字一次 setData）→ 打字掉帧、声音发糊。
 *   这种写法**功能上完全正常**（声音照响、测试全绿），只有真机手感能发现，
 *   而且极容易被"复现困难，先把 src 复位一下更保险"这类好心改动加回来。
 *
 * ## 断言（真执行：打桩 wx + 可控时钟，数每一次原生调用）
 *
 *   ① 同一毫秒内连打 50 次 `playTick` → 只创建 1 个上下文 / 只写 1 次 src / 只写 1 次 volume / 只 play 1 次
 *      （**节流必须在碰音频之前**；旧写法这里是 50/50/50，本守卫会红）
 *   ② 间隔 100ms 连打 20 次 → 每次都响（节流不吞正常按键），且 src 仍只写过 1 次
 *   ③ 静音时不产生任何原生调用
 *   ④ 节流边界：< 90ms 跳过、≥ 90ms 发声
 *   ⑤ `destroySfx()` 之后能重建且立即发声（节流状态被复位）
 *   ⑥ 音频报错后**只自愈一次**（重设 src 恰好 1 次），不会回到每 tick 重设
 *   ⑦ 三页的逐字循环都走 `textFx.playTick`（漏一页等于那页还是旧写法）
 *   ⑧ **音源本体**：解码 `SFX_SRC` 指向的 WAV，断言**敲击瞬态 ≤25ms**、时长 ≤250ms、
 *      不削波、不近乎无声、单声道（②③④是"代码怎么用音频"，⑧是"素材本身对不对"——
 *      真机"只响三声"的根因就在素材：敲击在第 110ms，前面 100ms 是静音，
 *      而热路径每 ~90ms 就 stop() 一次 ⇒ 声音在响之前被掐掉）
 *
 * 用法：
 *   node miniprogram/scripts/check-gift-sfx-perf.mjs             # 校验
 *   node miniprogram/scripts/check-gift-sfx-perf.mjs --selftest  # 证明它会失败
 *   node miniprogram/scripts/check-gift-sfx-perf.mjs --root <dir># 自检用（临时副本，不碰真文件）
 */
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP_DEFAULT = join(HERE, '..')

const REL = {
  helper: 'subpackages/feature/gift/giftTextEffect.js',
  asset: 'subpackages/feature/gift/assets/gift-typewriter-bed.wav',
  compose: 'subpackages/feature/gift/compose/index.js',
  success: 'subpackages/feature/gift/success/index.js',
  receive: 'subpackages/feature/gift/receive/index.js'
}

/** 把 WAV 截短到前 ms 毫秒（自检用：复现"只剩一声、密度不足"的形态） */
function truncateWav (file, ms) {
  const buf = readFileSync(file)
  let off = 12
  let fmt = null
  let dataOff = -1
  let dataSize = 0
  let sizeFieldOff = -1
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ') {
      fmt = { channels: buf.readUInt16LE(off + 10), sampleRate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) }
    } else if (id === 'data') {
      dataOff = off + 8
      dataSize = size
      sizeFieldOff = off + 4
      break
    }
    off = off + 8 + size + (size % 2)
  }
  if (!fmt || dataOff < 0) throw new Error('自检注入：找不到 fmt/data 块')
  const bytesPerSec = fmt.sampleRate * fmt.channels * (fmt.bits / 8)
  const keep = Math.min(dataSize, Math.round((bytesPerSec * ms) / 1000))
  const out = Buffer.concat([buf.subarray(0, dataOff), buf.subarray(dataOff, dataOff + keep)])
  out.writeUInt32LE(keep, sizeFieldOff)
  out.writeUInt32LE(out.length - 8, 4)
  writeFileSync(file, out)
}

/** 在 WAV 的 data 块前面插一段静音（自检用：复现"瞬态不在开头"的事故形态） */
function prependSilence (file, ms) {
  const buf = readFileSync(file)
  let off = 12
  let fmt = null
  let dataOff = -1
  let dataSize = 0
  let sizeFieldOff = -1
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ') {
      fmt = { channels: buf.readUInt16LE(off + 10), sampleRate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) }
    } else if (id === 'data') {
      dataOff = off + 8
      dataSize = size
      sizeFieldOff = off + 4
      break
    }
    off = off + 8 + size + (size % 2)
  }
  if (!fmt || dataOff < 0) throw new Error('自检注入：找不到 fmt/data 块')
  const zeros = Buffer.alloc(Math.round(fmt.sampleRate * (ms / 1000)) * fmt.channels * (fmt.bits / 8))
  const out = Buffer.concat([
    buf.subarray(0, dataOff), zeros,
    buf.subarray(dataOff, dataOff + dataSize), buf.subarray(dataOff + dataSize)
  ])
  out.writeUInt32LE(dataSize + zeros.length, sizeFieldOff)
  out.writeUInt32LE(out.length - 8, 4)
  writeFileSync(file, out)
}

/**
 * 解码 16bit PCM WAV（纯 JS，不依赖 ffmpeg —— CI 里也能真跑）。
 * 之所以坚持"能解码"：本次真机事故的根因就在**素材**里（敲击在第 110ms、前面是静音），
 * 只看文件大小/时长这种代理指标抓不住它。
 */
function readWav (file) {
  const buf = readFileSync(file)
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('不是 RIFF/WAVE 文件')
  }
  let off = 12
  let fmt = null
  let dataOff = -1
  let dataLen = 0
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    const body = off + 8
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14)
      }
    } else if (id === 'data') {
      dataOff = body
      dataLen = Math.min(size, buf.length - body)
    }
    off = body + size + (size % 2)
  }
  if (!fmt || dataOff < 0) throw new Error('缺 fmt/data 块')
  if (fmt.bits !== 16) throw new Error(`只支持 16bit PCM（当前 ${fmt.bits}bit）`)
  const count = Math.floor(dataLen / 2)
  const samples = new Array(count)
  for (let i = 0; i < count; i += 1) samples[i] = buf.readInt16LE(dataOff + i * 2)
  return { ...fmt, samples, durationMs: (count / fmt.channels / fmt.sampleRate) * 1000 }
}

/** 数敲击次数（过阈值 + 不应期 30ms），用于断言床的密度 */
function countClacks (wav) {
  const peak = wav.samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  if (!peak) return 0
  const thr = peak * 0.35
  const refractory = Math.round(wav.sampleRate * 0.03)
  let n = 0
  let last = -refractory
  for (let i = 0; i < wav.samples.length; i += 1) {
    if (Math.abs(wav.samples[i]) > thr && i - last > refractory) { n += 1; last = i }
  }
  return n
}

/** 敲击瞬态位置（首个超过峰值 35% 的采样点，毫秒） */
function onsetMs (wav) {
  const peak = wav.samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  if (!peak) return { onsetMs: Infinity, peak: 0 }
  const i = wav.samples.findIndex((v) => Math.abs(v) > peak * 0.35)
  return { onsetMs: (i * 1000) / wav.sampleRate, peak }
}

/** 每次音效之间的最小间隔下界（毫秒）：低于这个数就是在轰音频管线 */
const MIN_GAP_FLOOR = 60

/** 打桩 wx + 可控时钟：数清每一次原生调用
 *  @param {object} [opts] playEvents=false 模拟"这台机型 stop() 后 play() 不重启"（观察不到 onPlay） */
function makeHarness (source, opts = {}) {
  const firePlayEvents = opts.playEvents !== false
  const counters = { create: 0, srcSet: 0, volumeSet: 0, play: 0, stop: 0, destroy: 0, onError: 0, onPlay: 0, onEnded: 0 }
  let currentSrc = ''
  let currentVolume = 1
  const ctx = {
    obeyMuteSwitch: true,
    paused: true,
    _onError: null,
    _onPlay: null,
    _onEnded: null,
    get src () { return currentSrc },
    set src (v) { counters.srcSet += 1; currentSrc = v },
    get volume () { return currentVolume },
    set volume (v) { counters.volumeSet += 1; currentVolume = v },
    play () {
      counters.play += 1
      // 健康机型：play() 会真的开始播放 → 回调 onPlay
      if (firePlayEvents && typeof ctx._onPlay === 'function') ctx._onPlay()
    },
    stop () { counters.stop += 1 },
    destroy () { counters.destroy += 1 },
    onError (cb) { counters.onError += 1; ctx._onError = cb },
    onPlay (cb) { counters.onPlay += 1; ctx._onPlay = cb },
    onEnded (cb) { counters.onEnded += 1; ctx._onEnded = cb }
  }
  const wxStub = {
    createInnerAudioContext () { counters.create += 1; return ctx },
    getStorageSync () { return false },
    setStorageSync () {},
    getSystemInfoSync () { return {} }
  }
  // 可控时钟：模块里的 Date.now() 取参数里的 Date（形参遮蔽全局，无需改 globalThis）
  let now = 1_000_000
  const DateStub = { now: () => now }
  // 可控定时器：守卫要能证明"床不会一直响"（空闲自停 / 试听到时停）
  let timerSeq = 0
  const timerQ = new Map()
  const timers = {
    setTimeout (fn, ms) { const id = ++timerSeq; timerQ.set(id, { fn, ms }); return id },
    clearTimeout (id) { timerQ.delete(id) },
    /** 触发全部待发回调（按延时升序；回调里重新 arm 的进新队列） */
    flush () {
      const items = [...timerQ.entries()].sort((a, b) => a[1].ms - b[1].ms)
      timerQ.clear()
      items.forEach(([, t]) => { try { t.fn() } catch (e) { /* ignore */ } })
    },
    pending: () => timerQ.size
  }
  const mod = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('wx', 'Date', 'setTimeout', 'clearTimeout', 'module', 'exports', 'require', source)(
    wxStub, DateStub, timers.setTimeout, timers.clearTimeout, mod, mod.exports,
    () => { throw new Error('giftTextEffect 不该 require 别的模块') }
  )
  return {
    api: mod.exports,
    counters,
    ctx,
    timers,
    advance: (ms) => { now += ms },
    now: () => now
  }
}

function check (root) {
  const problems = []
  let source = ''
  try {
    source = readFileSync(join(root, REL.helper), 'utf8')
  } catch (e) {
    return [`${REL.helper} 读不到：${e.message}`]
  }

  let h = null
  try {
    h = makeHarness(source)
  } catch (e) {
    return [`giftTextEffect.js 执行失败：${e.message}`]
  }
  const { api, counters, ctx, advance } = h

  if (typeof api.playTick !== 'function') return ['giftTextEffect.js 未导出 playTick']
  if (typeof api.stopTickSound !== 'function') return ['giftTextEffect.js 未导出 stopTickSound（收笔停床靠它）']

  // ① 一次书写：同刻连打 50 次 → 只创建 1 个上下文、只写 1 次 src/volume、**只 play 1 次**
  for (let i = 0; i < 50; i += 1) api.playTick(false)
  if (counters.create !== 1) problems.push(`同刻连打 50 次却创建了 ${counters.create} 个音频上下文（应恰好 1 个）`)
  if (counters.srcSet !== 1) problems.push(`同刻连打 50 次却重设 src ${counters.srcSet} 次（应恰好 1 次 —— 每 tick 重设 src 就是真机卡顿主因）`)
  if (counters.volumeSet !== 1) problems.push(`同刻连打 50 次却写 volume ${counters.volumeSet} 次（应恰好 1 次，只在创建时设）`)
  if (counters.play !== 1) problems.push(`同刻连打 50 次却 play 了 ${counters.play} 次（床只需启动 1 次）`)

  // ② ★核心：整段书写（6 秒、每 100ms 一次落笔 = 60 次）里**原生 play 始终只有 1 次**
  //    —— 这就是"这台机器单次 play 慢也拖不垮页面"的机械证明
  for (let i = 0; i < 60; i += 1) { advance(100); api.playTick(false) }
  if (counters.play !== 1) {
    problems.push(`6 秒书写（60 次落笔）里 play 了 ${counters.play} 次 —— 床在响时逐字回调必须是 0 次原生调用`)
  }
  if (counters.srcSet !== 1) problems.push(`整段书写里 src 被重设了 ${counters.srcSet} 次（热路径不许碰 src）`)
  if (counters.stop !== 0) problems.push(`书写中途不该出现 stop（实际 ${counters.stop} 次）`)

  // ③ 收笔：停床，且幂等（再调一次不该再产生原生调用）
  const beforeStop = counters.stop
  api.stopTickSound()
  if (counters.stop !== beforeStop + 1) problems.push('stopTickSound() 没有停床')
  const afterStop = counters.stop
  api.stopTickSound()
  if (counters.stop !== afterStop) problems.push('stopTickSound() 不幂等（重复调用又发了一次 stop）')

  // ④ 下一次书写：隔开一个空闲期后必须能重新起笔（且仍然只 play 1 次）
  advance(2000)
  const p1 = counters.play
  for (let i = 0; i < 30; i += 1) { advance(100); api.playTick(false) }
  if (counters.play !== p1 + 1) problems.push(`新一次书写应恰好重新起笔 1 次（实际 ${counters.play - p1} 次）`)

  // ⑤ 静音：必须**主动停床**（不能只 return，否则关了声音床还在响）
  const s1 = counters.stop
  api.playTick(true)
  if (counters.stop !== s1 + 1) problems.push('静音时没有停床（关掉声音后床会继续响）')
  const snap = { ...counters }
  for (let i = 0; i < 20; i += 1) { advance(100); api.playTick(true) }
  Object.keys(snap).forEach((k) => {
    if (counters[k] !== snap[k]) problems.push(`静音期间仍产生了原生调用 ${k}（${snap[k]} → ${counters[k]}）`)
  })

  // ⑥ 空闲自停：床在响但一直没落笔 → 定时器到点必须自己停（兜底，不依赖调用方）
  advance(2000)
  api.playTick(false) // 起笔
  const s2 = counters.stop
  advance(5000) // 之后不再有落笔
  h.timers.flush()
  h.timers.flush()
  if (counters.stop <= s2) problems.push('空闲自停失效：长时间没有落笔，床仍在响（会一直响下去）')

  // ⑦ 试听：静音开关的试听必须"放一小段就停"，不能一直响
  advance(2000)
  const p3 = counters.play
  api.previewTickSound(900)
  if (counters.play !== p3 + 1) problems.push('previewTickSound() 没有起笔')
  const s3 = counters.stop
  h.timers.flush()
  if (counters.stop <= s3) problems.push('previewTickSound() 到时没有停（试听会一直响）')

  // ⑧ destroy 后可重建并立即起笔
  const c0 = counters.create
  const p4 = counters.play
  api.destroySfx()
  if (counters.destroy < 1) problems.push('destroySfx() 未销毁音频上下文')
  api.playTick(false)
  if (counters.create !== c0 + 1) problems.push('destroySfx() 之后未重建音频上下文')
  if (counters.play !== p4 + 1) problems.push('destroySfx() 之后首次落笔没有起笔')

  // ⑦ 三页都走共享件：逐字循环调 playTick，且**收笔那个函数体内**调了 stopTickSound
  const PAGES = [
    ['compose', REL.compose, 'clearNoteWriteTimer'],
    ['success', REL.success, '_stopType'],
    ['receive', REL.receive, '_clearLetterWriteTimer']
  ]
  for (const [key, rel, stopFn] of PAGES) {
    let src = ''
    try {
      src = readFileSync(join(root, rel), 'utf8')
    } catch (e) {
      problems.push(`${rel} 读不到：${e.message}`)
      continue
    }
    if (!src.includes('giftTextEffect')) problems.push(`${rel} 未引用共享件 giftTextEffect`)
    if (!src.includes('playTick(')) problems.push(`${rel} 的逐字循环没有调用 textFx.playTick（${key} 页会退回旧写法）`)
    // 只认**定义**形态 `name() {`：`this.name()` 这种调用点会先被 indexOf 命中，锚点就错了
    const at = src.indexOf(`${stopFn}() {`)
    const body = at >= 0 ? src.slice(at, at + 400) : ''
    if (at < 0) problems.push(`${rel} 找不到收笔函数 ${stopFn}(（守卫的锚点需要同步更新）`)
    else if (!body.includes('stopTickSound(')) {
      problems.push(`${rel} 的收笔函数 ${stopFn}() 没有调用 textFx.stopTickSound —— ${key} 页的敲击床会一直响下去`)
    }
  }

  // ⑧ 音源本体：**瞬态必须落在文件开头**（本次真机事故的根因就在素材里）
  const srcMatch = source.match(/const SFX_SRC = '([^']+)'/)
  if (!srcMatch) {
    problems.push('未找到 SFX_SRC 常量')
  } else {
    const assetRel = srcMatch[1].replace(/^\//, '')
    const assetAbs = join(root, assetRel)
    let wav = null
    try {
      wav = readWav(assetAbs)
    } catch (e) {
      problems.push(`音源 ${assetRel} 不可解码：${e.message}（必须 16bit PCM WAV，守卫才能真正量到瞬态）`)
    }
    if (wav) {
      const { onsetMs: onset, peak } = onsetMs(wav)
      if (!(onset <= 25)) {
        problems.push(
          `音源 ${assetRel} 的敲击瞬态在 ${onset.toFixed(0)}ms（必须 ≤25ms）：起笔那一刻就要有声，` +
          '靠后的瞬态在真机上会**在响之前被掐掉** —— 真机表现就是"只响几声、忽有忽无"'
        )
      }
      // 床是"书写期间连续响"的循环音源：时长可以到几秒，但要够密、接缝要顺
      if (wav.durationMs < 500 || wav.durationMs > 3000) {
        problems.push(`音源 ${assetRel} 时长 ${wav.durationMs.toFixed(0)}ms（应在 500~3000ms）：太短循环感强，太长白占包体`)
      }
      const clacks = countClacks(wav)
      if (clacks < 8) {
        problems.push(`音源 ${assetRel} 只检出 ${clacks} 次敲击（应 ≥8）：密度不够听起来是"单响"而不是打字床`)
      }
      // 接缝：末尾必须落在两次敲击之间的安静处，否则循环点会有"咔"的一声
      const tail = Math.abs(wav.samples[wav.samples.length - 1])
      if (tail > peak * 0.5) {
        problems.push(`音源 ${assetRel} 末尾样本 ${tail} 仍接近峰值 —— 循环接缝会听到咔哒（末尾应落在安静处）`)
      }
      if (peak > 0.99 * 32767) problems.push(`音源 ${assetRel} 削波（峰值 ${(peak / 32767).toFixed(3)}）`)
      if (peak < 0.2 * 32767) problems.push(`音源 ${assetRel} 近乎无声（峰值 ${(peak / 32767).toFixed(3)}）`)
      if (wav.channels !== 1) problems.push(`音源 ${assetRel} 是 ${wav.channels} 声道（应单声道，省包体也够用）`)
      console.log(`  · 音源 ${assetRel}: ${wav.durationMs.toFixed(0)}ms / 瞬态 ${onset.toFixed(0)}ms / ${clacks} 次敲击 / 峰值 ${(peak / 32767).toFixed(2)} / ${wav.sampleRate}Hz`)
    }
  }

  // ⑨ 机型不吃 play() 时：看门狗必须**自动切到可靠路径并重试**，且重试有上限（不能一直重试拖死页面）
  {
    const broken = makeHarness(source, { playEvents: false })
    for (let i = 0; i < 40; i += 1) { broken.advance(120); broken.api.playTick(false) }
    if (broken.counters.srcSet < 2) {
      problems.push('观察不到 onPlay（本机 play() 不生效）时，未切换到「重设音源再播」的可靠路径 —— 真机会一声不响')
    }
    if (broken.counters.play < 2) problems.push('切到可靠路径后没有重试起笔（真机仍会一直哑着）')
    if (broken.counters.play > 8) {
      problems.push(`不健康机型下 play 了 ${broken.counters.play} 次 —— 重试没有上限，会一直重试把页面拖死`)
    }
    // 健康机型反过来：独立起一个 harness，40 次落笔里 play 恒为 1、src 恒为 1（廉价路径）
    const healthy = makeHarness(source, { playEvents: true })
    for (let i = 0; i < 40; i += 1) { healthy.advance(120); healthy.api.playTick(false) }
    if (healthy.counters.play !== 1) {
      problems.push(`健康机型 40 次落笔 play 了 ${healthy.counters.play} 次 —— 床在响时应恒为 1 次`)
    }
    if (healthy.counters.srcSet !== 1) {
      problems.push(`健康机型（能观察到 onPlay）下 src 被重设了 ${healthy.counters.srcSet} 次 —— 应始终只写创建时那 1 次`)
    }
  }

  return problems
}

// ────────────────────────────── 自检 ──────────────────────────────
function selftest () {
  let bad = 0
  const t = (name, ok, extra) => {
    if (!ok) bad += 1
    console.log(`${ok ? '✓' : '✗'} ${name}${ok || !extra ? '' : ` —— ${extra}`}`)
  }

  const tmp = mkdtempSync(join(tmpdir(), 'gift-sfx-perf-'))
  try {
    for (const [key, rel] of Object.entries(REL)) {
      const dst = join(tmp, rel)
      mkdirSync(dirname(dst), { recursive: true })
      writeFileSync(dst, readFileSync(join(MP_DEFAULT, rel)))
    }
    const run = () => spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--root', tmp], { encoding: 'utf8' })
    const base = run()
    t('基线（真文件副本）通过', base.status === 0, (base.stdout || '') + (base.stderr || ''))

    const injections = [
      {
        name: '床的幂等被删（每字都重新起笔，回到"每字一次原生调用"）',
        file: REL.helper,
        mutate: (t) => t.replace('    if (_bedPlaying) return // ← 正常情况：0 次原生调用\n', ''),
        expect: /play 了 \d+ 次|床只需启动 1 次/
      },
      {
        name: '热路径又重设 src（第一轮卡顿的原写法）',
        file: REL.helper,
        mutate: (t) => t.replace('    a.play()\n    _bedPlaying = true', '    a.src = SFX_SRC\n    a.play()\n    _bedPlaying = true'),
        expect: /src 被重设/
      },
      {
        name: '静音时不主动停床（关了声音床还在响）',
        file: REL.helper,
        mutate: (t) => t.replace('  if (muted) {\n    stopTickSound()\n    return\n  }', '  if (muted) return'),
        expect: /静音时没有停床/
      },
      {
        name: '空闲自停被删（漏了收笔就会一直响）',
        file: REL.helper,
        mutate: (t) => t.replace('    _silentTicks = 0\n    armIdleWatch()', '    _silentTicks = 0'),
        expect: /空闲自停失效/
      },
      {
        name: '试听不再自动停（点开静音开关后一直响）',
        file: REL.helper,
        mutate: (t) => t.replace('  setTimeout(() => stopTickSound(), Math.max(300, Number(ms) || 900))\n', ''),
        expect: /试听会一直响|previewTickSound\(\) 到时没有停/
      },
      {
        name: '看门狗被删（机型不吃 play 时不再自动切可靠路径）',
        file: REL.helper,
        mutate: (t) => t.replace('        _reliableReload = true\n        console.warn', '        console.warn'),
        expect: /未切换到「重设音源再播」的可靠路径/
      },
      {
        name: '某页的逐字循环不再走共享件',
        file: REL.receive,
        mutate: (t) => t.replace(/textFx\.playTick\(/g, 'this._legacyTick('),
        expect: /没有调用 textFx\.playTick/
      },
      {
        name: '某页收笔不再停床（敲击床会一直响下去）',
        file: REL.success,
        mutate: (t) => t.replace('    textFx.stopTickSound()\n', ''),
        expect: /没有调用 textFx\.stopTickSound/
      },
      {
        name: '音源被换成"前面一段静音"的（起笔即刻没声）',
        file: null,
        mutate: null,
        asset: 'silence',
        expect: /瞬态在 \d+ms/
      },
      {
        name: '音源被换成"只有一声"的（密度不足，听起来是单响不是打字）',
        file: null,
        mutate: null,
        asset: 'truncate',
        expect: /只检出 \d+ 次敲击/
      }
    ]
    for (const inj of injections) {
      if (inj.asset) {
        // 音源类注入：在临时副本上改素材（silence = 前面插静音；truncate = 截成只剩一声）
        const assetAbs = join(tmp, REL.asset)
        try {
          if (inj.asset === 'truncate') truncateWav(assetAbs, 200)
          else prependSilence(assetAbs, 120)
          const res = run()
          const out = `${res.stdout || ''}${res.stderr || ''}`
          if (res.status !== 0 && inj.expect.test(out)) {
            console.log(`✓ ${inj.name} → 被守卫拦下`)
          } else {
            bad += 1
            console.log(`✗ ${inj.name} → 未被拦下（status=${res.status}）\n${out.slice(0, 500)}`)
          }
        } catch (e) {
          bad += 1
          console.log(`✗ ${inj.name} 注入出错：${e.message}`)
        }
        // 还原音源
        writeFileSync(assetAbs, readFileSync(join(MP_DEFAULT, REL.asset)))
        continue
      }
      const abs = join(tmp, inj.file)
      const orig = readFileSync(abs, 'utf8')
      const mutated = inj.mutate(orig)
      if (mutated === orig) {
        bad += 1
        console.log(`✗ 注入锚点缺失：${inj.name}`)
        continue
      }
      writeFileSync(abs, mutated)
      const res = run()
      const out = `${res.stdout || ''}${res.stderr || ''}`
      if (res.status !== 0 && inj.expect.test(out)) {
        console.log(`✓ ${inj.name} → 被守卫拦下`)
      } else {
        bad += 1
        console.log(`✗ ${inj.name} → 未被拦下（status=${res.status}）\n${out.slice(0, 500)}`)
      }
      writeFileSync(abs, orig)
    }
    const after = run()
    t('注入全部还原后重新通过', after.status === 0)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  if (bad) {
    console.error(`\n自检失败 ${bad} 项 —— 守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：切片/计数判据 + 6 处真实注入（删节流、热路径重设 src、热路径写 volume、间隔调小、某页不走共享件、音源瞬态不在开头）全部拦下')
}

function main () {
  if (process.argv.includes('--selftest')) return selftest()
  const i = process.argv.indexOf('--root')
  const root = i >= 0 ? process.argv[i + 1] : MP_DEFAULT
  const problems = check(root)
  if (problems.length) {
    console.error('✗ 礼笺打字机音效真机开销不合格：')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log('✓ 礼笺打字机音效开销合格（真执行打桩计数）：')
  console.log('  一次书写只动两次原生音频调用（起笔 play / 收笔 stop），逐字回调 **0 次**；')
  console.log('  6 秒书写（60 次落笔）里 play 恒为 1、src 恒为 1；静音必停床；空闲会自停；试听到时停；')
  console.log('  音源是「多声循环床」（瞬态 ≤25ms / 敲击数 ≥8 / 接缝落在安静处，全部解码实测）；')
  console.log('  机型不吃 play() 时看门狗自动切可靠路径且有重试上限；三页共用共享件且收笔都停床')
}

main()
