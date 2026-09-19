#!/usr/bin/env node
/**
 * 生成「黑马标本店」品牌推广曲的**时刻音片段**（可复现，不手搓二进制）。
 *
 * 为什么单独一个脚本：本仓的音效素材已有先例 —— `make-ritual-audio.mjs` 合成敲击音效，
 * 目的是"可复现、无第三方版权素材"。推广曲片段同理：**起点/时长/码率必须写在代码里**，
 * 否则半年后没人知道这个 mp3 是从第几秒切的（那正是本仓反复出现的"文档与现状脱钩"）。
 *
 * ⚠️ 它**不**进 `utils/ritualFeedback.SOUND_SOURCES`：那张表是"每次动作响一下"的敲击音效，
 * 守卫要求每条 **>1KB 且 <32KB**（挂在每次敲击上，不能是大文件）。本片段是**时刻音**：
 * 只在"一次仪式完成"那一刻放一次。两者是不同的东西，所以走不同的路。
 *
 * 素材事实（2026-09-20 实测，产品负责人提供）：
 *   原曲 WAV · 2ch/48kHz/Int16 · **239.64 秒** · 46,011,052 bytes
 *   片段起点 **98.7s** —— 由响度包络定位（astats 每 0.085s 一点，取"最响的 6 秒窗口"附近的
 *   第一次副歌）。⚠️ **我听不到音频：起点是算出来的、不是听出来的**，需产品负责人试听后确认。
 *   备选起点 216.1s（结尾大副歌，响度峰值最高）；改起点只需跑：
 *     node miniprogram/scripts/make-black-horse-clip.mjs <原曲.wav> --start 216.1
 *
 * 输出：`miniprogram/subpackages/feature/wish-wall/assets/black-horse-song-clip.mp3`
 *   mono / 44.1kHz / 64kbps / 6s（含 0.3s 淡入淡出）≈ 47KB
 *
 * 用法：
 *   node miniprogram/scripts/make-black-horse-clip.mjs <原曲.wav> [--start 98.7] [--dur 6]
 *   node miniprogram/scripts/make-black-horse-clip.mjs --selftest     # 不需要原曲，验参数解析与路径
 */
import { spawnSync } from 'node:child_process'
import { existsSync, statSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
/** 片段落点：与敲击音效同目录（同一个页面的音频资产放一起），但**不登记进 SOUND_SOURCES** */
const OUT = join(ROOT, 'miniprogram/subpackages/feature/wish-wall/assets/black-horse-song-clip.mp3')
/** 默认起点：响度包络定位到的第一次副歌（备选 216.1 = 结尾大副歌） */
const DEFAULT_START = 98.7
const DEFAULT_DUR = 6
const FADE = 0.3
/** 体积上限：它是**时刻音**（一次仪式放一次），比敲击音效的 32KB 宽松，但也不许长成一个大文件 */
const MAX_BYTES = 200 * 1024

function parseArgs(argv) {
  const out = { src: '', start: DEFAULT_START, dur: DEFAULT_DUR, selftest: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--selftest') out.selftest = true
    else if (a === '--start') out.start = Number(argv[++i])
    else if (a === '--dur') out.dur = Number(argv[++i])
    else if (!a.startsWith('--')) out.src = a
  }
  return out
}

function buildCmd(src, start, dur) {
  // -ss 放在 -i **之前**（输入侧跳转，快且不需要先解完整首）
  const fadeOutAt = Math.max(0, dur - FADE)
  return [
    '-y', '-v', 'error',
    '-ss', String(start), '-t', String(dur), '-i', src,
    '-af', `afade=t=in:st=0:d=${FADE},afade=t=out:st=${fadeOutAt}:d=${FADE}`,
    '-ac', '1', '-ar', '44100', '-b:a', '64k',
    OUT
  ]
}

function selftest() {
  let bad = 0
  const expect = (name, cond, extra) => {
    if (cond) console.log(`  ✓ ${name}`)
    else { bad += 1; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`) }
  }
  const a = parseArgs(['song.wav', '--start', '216.1', '--dur', '8'])
  expect('解析原曲路径', a.src === 'song.wav')
  expect('解析 --start', a.start === 216.1)
  expect('解析 --dur', a.dur === 8)
  expect('默认起点为 98.7（响度定位的第一次副歌）', parseArgs(['x.wav']).start === DEFAULT_START)
  const cmd = buildCmd('s.wav', 10, 6)
  expect('ffmpeg 命令含输入侧跳转（-ss 在 -i 之前）', cmd.indexOf('-ss') < cmd.indexOf('-i'))
  expect('淡出起点 = 时长 - 淡入淡出（不越界）', cmd.join(' ').includes('afade=t=out:st=5.7:d=0.3'))
  expect('输出为单声道 44.1kHz 64kbps（体积受控）', cmd.join(' ').includes('-ac 1') && cmd.join(' ').includes('-b:a 64k'))
  expect('落点是包内资产路径', OUT.endsWith('wish-wall/assets/black-horse-song-clip.mp3'))
  if (bad) { console.error(`\n✗ selftest 失败 ${bad} 项`); process.exit(1) }
  console.log('\n✓ selftest 通过：参数解析 / 命令构造 / 体积口径 / 落点')
  process.exit(0)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.selftest) return selftest()
  if (!args.src) {
    console.error('✗ 缺少原曲路径。用法：node miniprogram/scripts/make-black-horse-clip.mjs <原曲.wav> [--start 98.7]')
    process.exit(2)
  }
  if (!existsSync(args.src)) {
    console.error(`✗ 原曲不存在：${args.src}`)
    process.exit(2)
  }
  if (!Number.isFinite(args.start) || args.start < 0) {
    console.error(`✗ --start 非法：${args.start}`)
    process.exit(2)
  }
  if (!Number.isFinite(args.dur) || args.dur <= FADE * 2) {
    console.error(`✗ --dur 必须大于 2×淡入淡出(${FADE * 2}s)：${args.dur}`)
    process.exit(2)
  }
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
  if (probe.error) {
    console.error('✗ 本机没有 ffmpeg —— 片段生成需要它（brew install ffmpeg）')
    process.exit(2)
  }
  mkdirSync(dirname(OUT), { recursive: true })
  const r = spawnSync('ffmpeg', buildCmd(args.src, args.start, args.dur), { encoding: 'utf8' })
  if (r.status !== 0) {
    console.error('✗ ffmpeg 失败：\n' + (r.stderr || ''))
    process.exit(1)
  }
  const size = existsSync(OUT) ? statSync(OUT).size : 0
  console.log(`✓ 已生成 ${OUT}`)
  console.log(`  起点 ${args.start}s / 时长 ${args.dur}s / ${(size / 1024).toFixed(1)}KB（上限 ${MAX_BYTES / 1024}KB）`)
  if (size > MAX_BYTES) {
    console.error('✗ 超过体积上限：请降低码率或缩短时长（它不该长成一个大文件）')
    process.exit(1)
  }
  console.log('  ⚠️ 片段起点是**响度定位**得到的，不是听出来的 —— 请产品负责人试听后确认或改 --start 重跑')
}

main()
