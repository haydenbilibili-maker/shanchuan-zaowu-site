#!/usr/bin/env node
/**
 * 生成「仪式音效」素材（木鱼「笃」）—— 可复现、无第三方版权素材。
 *
 * 为什么自己合成而不是找素材：木鱼一声要挂在**每次敲击**上（高频、可连点），
 * 网上素材的授权状态说不清；这个声音本质是"几个非谐波模态 + 3ms 槌击噪声 + 指数衰减"，
 * 用几行数学就能写出来，且**可复现**（谁都能重跑、能 diff 出参数变化）。
 *
 * 用法：
 *   node miniprogram/scripts/make-ritual-audio.mjs                       # 木鱼（默认）
 *   node miniprogram/scripts/make-ritual-audio.mjs --kind lamp           # 点灯的铜磬
 *   node miniprogram/scripts/make-ritual-audio.mjs --out /tmp/x.mp3
 *
 * 依赖：ffmpeg（转 mp3；微信 <audio>/InnerAudioContext 对 mp3 支持最稳）
 * 产物：
 *   subpackages/feature/wish-wall/assets/muyu.mp3 —— 敲木鱼的「笃」（木质、极短）
 *   subpackages/feature/wish-wall/assets/lamp.mp3 —— 点灯的铜磬（金属、有余韵）
 *
 * 为什么两种音色是**两套模态参数**而不是同一声加不同音量：木鱼是"木头被敲"（几个低频模态、衰减 ~70ms），
 * 铜磬是"金属在响"（**非谐分音**、衰减 ~0.6s）。音色对了，动作才有各自的性格。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, statSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')

const SR = 44100

/**
 * 两种音色的模态参数。
 * - muyu（木鱼）：两个靠近的低频模态（770/818Hz，拍频 ≈48Hz = "空心木头"）+ 槌击噪声，衰减 ~70ms
 * - lamp（铜磬）：按**钟/磬的经典非谐分音比** 1 : 2.76 : 5.40 : 8.93 铺开（基频 480Hz），
 *   高次分音衰减更快、基频留 ~0.6s 余韵；击打比木鱼轻（它是个"点亮"动作，不该吓人）
 */
const KINDS = {
  muyu: {
    duration: 0.26,
    modes: [
      { f: 770, tau: 0.058, gain: 1.0 },
      { f: 818, tau: 0.05, gain: 0.62 },
      { f: 1540, tau: 0.026, gain: 0.46 },
      { f: 2320, tau: 0.014, gain: 0.26 }
    ],
    clickMs: 3,
    clickGain: 0.5,
    clickLowpassHz: 3200,
    attackMs: 0.8,
    fadeMs: 15,
    peak: 0.72
  },
  lamp: {
    // tau 0.42 → 自然衰减约 -20dB @0.97s；配 150ms 淡出，尾巴是"自己消散"而不是被切断
    // （第一版 tau 0.6 + 15ms 淡出：实测 -20dB 要到 1.09s，等于在还响着的时候被硬切）
    duration: 1.15,
    modes: [
      { f: 480, tau: 0.42, gain: 1.0 },
      { f: 480 * 2.76, tau: 0.2, gain: 0.48 },
      { f: 480 * 5.4, tau: 0.1, gain: 0.24 },
      { f: 480 * 8.93, tau: 0.06, gain: 0.12 }
    ],
    clickMs: 2,
    clickGain: 0.26,
    clickLowpassHz: 4200,
    attackMs: 1.6,
    fadeMs: 150,
    peak: 0.62
  }
}

function synth(cfg) {
  const n = Math.round(SR * cfg.duration)
  const out = new Float64Array(n)
  const attack = Math.max(1, Math.round((cfg.attackMs / 1000) * SR))
  const clickN = Math.round((cfg.clickMs / 1000) * SR)

  // 槌击噪声（一次性生成，确定性：固定种子的 LCG，不用 Math.random）
  let seed = 20260918
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff * 2 - 1
  }
  const alpha = 1 - Math.exp((-2 * Math.PI * cfg.clickLowpassHz) / SR)
  let lp = 0

  for (let i = 0; i < n; i += 1) {
    const t = i / SR
    let v = 0
    for (const m of cfg.modes) v += m.gain * Math.exp(-t / m.tau) * Math.sin(2 * Math.PI * m.f * t)
    if (i < clickN) {
      lp += alpha * (rnd() - lp)
      // 噪声随敲击一起衰减（否则噪声听起来像"电流声"）
      v += cfg.clickGain * lp * Math.exp(-t / 0.004)
    }
    // 起振包络
    const env = i < attack ? i / attack : 1
    // 收尾淡出：最后 15ms 归零，避免尾部截断爆音
    const fadeStart = n - Math.round(((cfg.fadeMs || 15) / 1000) * SR)
    const fade = i >= fadeStart ? 1 - (i - fadeStart) / (n - fadeStart) : 1
    out[i] = v * env * fade
  }

  // 归一化到 PEAK（留 headroom：mp3 编码后可能过冲）
  let max = 0
  for (let i = 0; i < n; i += 1) max = Math.max(max, Math.abs(out[i]))
  const k = max > 0 ? cfg.peak / max : 0
  for (let i = 0; i < n; i += 1) out[i] *= k
  return out
}

function toWav(samples) {
  const dataBytes = samples.length * 2
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2)
  }
  return buf
}

function main() {
  const argv = process.argv.slice(2)
  const argOf = (n, d) => {
    const i = argv.indexOf(n)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d
  }
  const kind = String(argOf('--kind', 'muyu'))
  const cfg = KINDS[kind]
  if (!cfg) {
    console.error(`✗ 未知音色 ${kind}（可用：${Object.keys(KINDS).join(' / ')}）`)
    process.exit(1)
  }
  const out = resolve(REPO, argOf('--out', `miniprogram/subpackages/feature/wish-wall/assets/${kind}.mp3`))

  const samples = synth(cfg)
  const wavPath = out.replace(/\.mp3$/, '.tmp.wav')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(wavPath, toWav(samples))
  try {
    // -ac 1 / 64k：200ms 单声道 mp3 ≈ 2KB；对"敲一下"这种短音质足够
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-ac', '1', '-b:a', '64k', out])
  } finally {
    rmSync(wavPath, { force: true })
  }
  console.log(`✓ ${out}  ${(statSync(out).size / 1024).toFixed(1)} KB`)
}

main()
