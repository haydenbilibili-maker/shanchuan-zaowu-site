#!/usr/bin/env node
/**
 * 工作通知声音 —— AI TTS 音频生成（需求 #29）
 *
 * 输入：`utils/workNoticeCatalog.js`（语料唯一真源）
 * 输出：`subpackages/manager/assets/audio/work-notice/*.mp3` + `manifest.json`
 *
 * 两个后端：
 *   --backend macos  （默认）本机 macOS 神经音色 `say` → ffmpeg/lame 转 MP3。
 *                    零密钥、可离线复跑；音色用 `--voice Tingting|Sandy|Eddy|Flo|…` 换。
 *   --backend aliyun 阿里云智能语音交互（真·云端 AI TTS，音质更好）。
 *                    需要 ALIYUN_NLS_ACCESS_KEY_ID / ALIYUN_NLS_ACCESS_KEY_SECRET / ALIYUN_NLS_APPKEY
 *                    （写在 admin/.env，或直接 export）；音色用 `--voice xiaoyun|zhiyan|…`。
 *
 * 用法：
 *   node miniprogram/scripts/generate-work-notice-tts.mjs                 # 生成/覆盖全部
 *   node miniprogram/scripts/generate-work-notice-tts.mjs --only order,workOrder
 *   node miniprogram/scripts/generate-work-notice-tts.mjs --voice Sandy
 *   node miniprogram/scripts/generate-work-notice-tts.mjs --backend aliyun --voice xiaoyun
 *   node miniprogram/scripts/generate-work-notice-tts.mjs --check          # 只校验（守卫用，不写盘）
 *
 * 为什么 manifest 里存 `textHash`：改了文案却忘了重录，是这类「音频资产」最典型的漂移。
 * `--check` 用 hash 把它变成硬失败（守卫 `check:work-notice` 会调它）。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const MP_DIR = join(ROOT, 'miniprogram')
const CATALOG_PATH = join(MP_DIR, 'subpackages', 'manager', 'utils', 'workNoticeCatalog.js')
const AUDIO_DIR = join(MP_DIR, 'subpackages', 'manager', 'assets', 'audio', 'work-notice')
const MANIFEST_PATH = join(AUDIO_DIR, 'manifest.json')

const argv = process.argv.slice(2)
const flag = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const has = (name) => argv.includes(`--${name}`)

const BACKEND = flag('backend', 'macos')
const VOICE = flag('voice', BACKEND === 'aliyun' ? 'xiaoyun' : 'Tingting')
const RATE = Number(flag('rate', '190')) || 190
const SAMPLE_RATE = Number(flag('sampleRate', '22050')) || 22050
const BITRATE = flag('bitrate', '48k')
const ONLY = flag('only', '').trim()
const CHECK = has('check')
const JSON_OUT = has('json')

/** 小程序端是 CommonJS，而仓库根 package.json 是 type:module —— 用显式求值读它 */
function loadCatalog() {
  const src = readFileSync(CATALOG_PATH, 'utf8')
  const mod = { exports: {} }
  const fn = new Function('module', 'exports', 'require', src)
  fn(mod, mod.exports, (spec) => {
    throw new Error(`workNoticeCatalog 不应 require 其它模块（遇到 ${spec}）`)
  })
  return mod.exports
}

function readEnvFile(file) {
  const out = {}
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch (e) {
    /* 缺失即忽略 */
  }
  return out
}

const textHash = (text) => createHash('sha256').update(String(text), 'utf8').digest('hex').slice(0, 16)

function loadManifest() {
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  } catch (e) {
    return null
  }
}

function selectedEntries(catalog) {
  const all = catalog.listAudioEntries()
  if (!ONLY) return all
  const wanted = ONLY.split(',').map((s) => s.trim()).filter(Boolean)
  const picked = all.filter((t) => wanted.indexOf(t.type) !== -1)
  const missing = wanted.filter((w) => !picked.some((p) => p.type === w))
  if (missing.length) throw new Error(`--only 里有清单中不存在的类型：${missing.join(', ')}`)
  return picked
}

function assertTools() {
  const has = (bin) => {
    try {
      execFileSync('which', [bin], { stdio: 'ignore' })
      return true
    } catch (e) {
      return false
    }
  }
  if (!has('say')) throw new Error('未找到 macOS `say`（本后端仅支持 macOS）')
  if (!has('ffmpeg') && !has('lame') && !has('afconvert')) {
    throw new Error('未找到音频转码工具（ffmpeg / lame / afconvert 至少装一个）')
  }
}

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
}

/** 本机神经 TTS：say → aiff → mp3 */
function synthMacos(text, outFile) {
  const aiff = join(tmpdir(), `work-notice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.aiff`)
  run('say', ['-v', VOICE, '-r', String(RATE), '-o', aiff, text])
  try {
    run('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiff, '-codec:a', 'libmp3lame', '-b:a', BITRATE, '-ar', String(SAMPLE_RATE), '-ac', '1', outFile])
  } catch (e) {
    run('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '48000', aiff, outFile.replace(/\.mp3$/, '.m4a')])
    throw new Error('ffmpeg 不可用，已回退 afconvert（产物为 .m4a，请把清单 file 改成 .m4a 后重跑）')
  } finally {
    rmSync(aiff, { force: true })
  }
}

/** 阿里云 NLS RESTful TTS（真云端 AI 音色） */
async function synthAliyun(text, outFile) {
  const { fetchNlsToken } = await import(join(ROOT, 'admin', 'scripts', 'aliyunNlsPopSign.mjs'))
  const env = {
    ...readEnvFile(join(ROOT, 'admin', '.env')),
    ...readEnvFile(join(ROOT, 'admin', '.env.local')),
    ...process.env
  }
  const id = env.ALIYUN_NLS_ACCESS_KEY_ID
  const secret = env.ALIYUN_NLS_ACCESS_KEY_SECRET
  const appkey = env.ALIYUN_NLS_APPKEY
  if (!id || !secret || !appkey) {
    throw new Error('缺少 ALIYUN_NLS_ACCESS_KEY_ID / ALIYUN_NLS_ACCESS_KEY_SECRET / ALIYUN_NLS_APPKEY（admin/.env 或环境变量）')
  }
  const token = await fetchNlsToken(id, secret)
  const endpoint = env.ALIYUN_NLS_GATEWAY || 'https://nls-gateway-cn-shanghai.aliyuncs.com/stream/v1/tts'
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appkey,
      token: token.id,
      text,
      format: 'mp3',
      voice: VOICE,
      sample_rate: SAMPLE_RATE,
      speech_rate: 0,
      volume: 60,
      pitch_rate: 0
    })
  })
  const type = res.headers.get('content-type') || ''
  if (!res.ok || type.indexOf('audio') === -1) {
    const body = await res.text().catch(() => '')
    throw new Error(`NLS TTS 失败（HTTP ${res.status} / ${type}）：${body.slice(0, 200)}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 512) throw new Error(`NLS 返回的音频过小（${buf.length} 字节）`)
  writeFileSync(outFile, buf)
}

function mp3DurationMs(file) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' })
    return Math.round(Number(out.trim()) * 1000)
  } catch (e) {
    return null
  }
}

async function main() {
  const catalog = loadCatalog()
  const entries = selectedEntries(catalog)
  const prev = loadManifest()

  if (CHECK) {
    const problems = []
    for (const t of entries) {
      const file = join(AUDIO_DIR, t.file)
      if (!existsSync(file)) {
        problems.push(`${t.type}: 缺少音频 ${t.file}`)
        continue
      }
      const rec = (prev && prev.entries && prev.entries[t.type]) || null
      if (!rec) {
        problems.push(`${t.type}: manifest 里没有登记`)
        continue
      }
      if (rec.textHash !== textHash(t.text)) problems.push(`${t.type}: 文案改了但音频没重录（hash 不一致）`)
      if (rec.file !== t.file) problems.push(`${t.type}: manifest 文件名与清单不一致（${rec.file} ≠ ${t.file}）`)
      if (Number(rec.bytes) !== statSync(file).size) problems.push(`${t.type}: 音频体积与 manifest 不一致（可能被替换过）`)
    }
    if (prev) {
      const known = {}
      entries.forEach((t) => { known[t.type] = true })
      Object.keys(prev.entries || {}).forEach((k) => {
        if (!known[k] && !ONLY) problems.push(`manifest 里有清单已删除的类型：${k}`)
      })
    }
    const report = { ok: problems.length === 0, problems, checked: entries.length, backend: prev && prev.backend, voice: prev && prev.voice }
    if (JSON_OUT) console.log(JSON.stringify(report, null, 2))
    else if (report.ok) console.log(`✓ 工作通知音频齐备且与文案一致（${report.checked} 条；后端 ${report.backend} / 音色 ${report.voice}）`)
    else {
      console.error(`✗ 工作通知音频校验失败（${problems.length} 项）：`)
      problems.forEach((p) => console.error(`  · ${p}`))
      console.error('  修复：node miniprogram/scripts/generate-work-notice-tts.mjs')
    }
    process.exit(report.ok ? 0 : 1)
  }

  if (BACKEND === 'macos') assertTools()
  mkdirSync(AUDIO_DIR, { recursive: true })

  const out = {
    catalogVersion: 1,
    backend: BACKEND,
    voice: VOICE,
    rate: BACKEND === 'macos' ? RATE : null,
    sampleRate: SAMPLE_RATE,
    bitrate: BACKEND === 'macos' ? BITRATE : 'cloud',
    generatedAt: new Date().toISOString(),
    entries: ONLY && prev && prev.entries ? { ...prev.entries } : {}
  }

  for (const t of entries) {
    const file = join(AUDIO_DIR, t.file)
    process.stdout.write(`→ ${t.type.padEnd(14)} ${t.text}\n`)
    if (BACKEND === 'aliyun') await synthAliyun(t.text, file)
    else synthMacos(t.text, file)
    const bytes = statSync(file).size
    out.entries[t.type] = {
      file: t.file,
      text: t.text,
      textHash: textHash(t.text),
      bytes,
      durationMs: mp3DurationMs(file),
      path: `${catalog.AUDIO_DIR}/${t.file}`
    }
    process.stdout.write(`   ${t.file} · ${bytes} 字节\n`)
  }

  // 未参与本次生成的条目原样保留（--only 局部重录时不丢其它登记）
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(out, null, 2)}\n`, 'utf8')
  const totalKb = Math.round(Object.values(out.entries).reduce((s, e) => s + (Number(e.bytes) || 0), 0) / 1024)
  console.log(`\n✓ 已生成 ${entries.length} 条（后端 ${BACKEND} / 音色 ${VOICE}），累计 ${totalKb} KB`)
  console.log(`  ${MANIFEST_PATH.replace(`${ROOT}/`, '')}`)
}

main().catch((e) => {
  console.error(`✗ 生成失败：${e.message || e}`)
  process.exit(1)
})
