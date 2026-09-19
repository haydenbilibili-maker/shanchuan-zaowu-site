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
  compose: 'subpackages/feature/gift/compose/index.js',
  success: 'subpackages/feature/gift/success/index.js',
  receive: 'subpackages/feature/gift/receive/index.js'
}

/** 每次音效之间的最小间隔下界（毫秒）：低于这个数就是在轰音频管线 */
const MIN_GAP_FLOOR = 60

/** 打桩 wx + 可控时钟：数清每一次原生调用 */
function makeHarness (source) {
  const counters = { create: 0, srcSet: 0, volumeSet: 0, play: 0, stop: 0, destroy: 0, onError: 0 }
  let currentSrc = ''
  let currentVolume = 1
  const ctx = {
    obeyMuteSwitch: true,
    paused: true,
    _onError: null,
    get src () { return currentSrc },
    set src (v) { counters.srcSet += 1; currentSrc = v },
    get volume () { return currentVolume },
    set volume (v) { counters.volumeSet += 1; currentVolume = v },
    play () { counters.play += 1 },
    stop () { counters.stop += 1 },
    destroy () { counters.destroy += 1 },
    onError (cb) { counters.onError += 1; ctx._onError = cb }
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
  const mod = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('wx', 'Date', 'module', 'exports', 'require', source)(
    wxStub, DateStub, mod, mod.exports, () => { throw new Error('giftTextEffect 不该 require 别的模块') }
  )
  return {
    api: mod.exports,
    counters,
    ctx,
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
  if (typeof api.MIN_TICK_GAP_MS !== 'number') problems.push('未导出 MIN_TICK_GAP_MS（节流间隔不可观测）')
  else if (api.MIN_TICK_GAP_MS < MIN_GAP_FLOOR) {
    problems.push(`MIN_TICK_GAP_MS = ${api.MIN_TICK_GAP_MS}ms 太小（下限 ${MIN_GAP_FLOOR}ms）：逐字间隔只有 52~99ms，等于每个字都重启音频`)
  }

  // ① 同一毫秒内连打 50 次：只许一次"创建 + 写 src + 写 volume + play"
  for (let i = 0; i < 50; i += 1) api.playTick(false)
  if (counters.create !== 1) problems.push(`同刻连打 50 次却创建了 ${counters.create} 个音频上下文（应恰好 1 个）`)
  if (counters.srcSet !== 1) problems.push(`同刻连打 50 次却重设 src ${counters.srcSet} 次（应恰好 1 次 —— 每 tick 重设 src 就是真机卡顿主因）`)
  if (counters.volumeSet !== 1) problems.push(`同刻连打 50 次却写 volume ${counters.volumeSet} 次（应恰好 1 次，只在创建时设）`)
  if (counters.play !== 1) problems.push(`同刻连打 50 次却 play 了 ${counters.play} 次（节流应只放行 1 次；节流必须在碰音频之前）`)

  // ② 正常节奏（100ms）不被节流吞掉
  const beforePlay = counters.play
  for (let i = 0; i < 20; i += 1) { advance(100); api.playTick(false) }
  if (counters.play - beforePlay !== 20) {
    problems.push(`间隔 100ms 连打 20 次只响了 ${counters.play - beforePlay} 次（正常按键不该被节流吞掉）`)
  }
  if (counters.srcSet !== 1) problems.push(`正常节奏下 src 被重设了 ${counters.srcSet} 次（热路径不许碰 src）`)

  // ③ 静音：零原生调用
  const snapshot = { ...counters }
  for (let i = 0; i < 20; i += 1) { advance(100); api.playTick(true) }
  Object.keys(snapshot).forEach((k) => {
    if (counters[k] !== snapshot[k]) problems.push(`静音时仍产生了原生调用 ${k}（${snapshot[k]} → ${counters[k]}）`)
  })

  // ④ 节流边界（先制造一次基准发声 —— 否则"上次发声"还停在静音循环之前，窗口早就过期了）
  const gap = typeof api.MIN_TICK_GAP_MS === 'number' ? api.MIN_TICK_GAP_MS : 90
  api.playTick(false)
  const p0 = counters.play
  advance(gap - 1)
  api.playTick(false)
  if (counters.play !== p0) problems.push(`距上次发声 ${gap - 1}ms 就响了（应被节流拦下）`)
  advance(2)
  api.playTick(false)
  if (counters.play !== p0 + 1) problems.push(`距上次发声 ${gap + 1}ms 仍不响（节流过头）`)

  // ⑤ destroy 后可重建且立即发声（节流状态复位）
  const c0 = counters.create
  const p1 = counters.play
  api.destroySfx()
  if (counters.destroy < 1) problems.push('destroySfx() 未销毁音频上下文')
  api.playTick(false)
  if (counters.create !== c0 + 1) problems.push('destroySfx() 之后未重建音频上下文')
  if (counters.play !== p1 + 1) problems.push('destroySfx() 之后首次 tick 被节流拦下（节流状态未复位）')

  // ⑥ 报错后只自愈一次
  if (typeof ctx._onError !== 'function') {
    problems.push('未注册 onError（音频报错后无法自愈，会一直变哑）')
  } else {
    const srcBefore = counters.srcSet
    ctx._onError({ errMsg: 'guard-injected error' })
    advance(gap + 10)
    api.playTick(false)
    if (counters.srcSet !== srcBefore + 1) {
      problems.push(`音频报错后应恰好重设 src 1 次（实际 ${counters.srcSet - srcBefore} 次）`)
    }
    const srcAfter = counters.srcSet
    for (let i = 0; i < 5; i += 1) { advance(gap + 10); api.playTick(false) }
    if (counters.srcSet !== srcAfter) {
      problems.push('自愈后又在热路径重设 src（应只在报错后的下一次重设一次）')
    }
  }

  // ⑦ 三页都走共享件
  for (const [key, rel] of [['compose', REL.compose], ['success', REL.success], ['receive', REL.receive]]) {
    let src = ''
    try {
      src = readFileSync(join(root, rel), 'utf8')
    } catch (e) {
      problems.push(`${rel} 读不到：${e.message}`)
      continue
    }
    if (!src.includes('giftTextEffect')) problems.push(`${rel} 未引用共享件 giftTextEffect`)
    if (!src.includes('playTick(')) problems.push(`${rel} 的逐字循环没有调用 textFx.playTick（${key} 页会退回旧写法）`)
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
        name: '节流被删掉（每个字都重启音频）',
        file: REL.helper,
        mutate: (s) => s.replace('  if (now - _lastTickAt < MIN_TICK_GAP_MS) return\n', ''),
        expect: /play 了 50 次|play .*次/
      },
      {
        name: '热路径又重设 src（本次卡顿的原写法）',
        file: REL.helper,
        mutate: (s) => s.replace('    a.stop()\n', '    a.src = SFX_SRC\n    a.stop()\n'),
        expect: /重设 src/
      },
      {
        name: '热路径又写 volume',
        file: REL.helper,
        mutate: (s) => s.replace('    a.stop()\n', '    a.volume = SFX_VOLUME\n    a.stop()\n'),
        expect: /写 volume/
      },
      {
        name: '节流间隔被调到 20ms（等于没节流）',
        file: REL.helper,
        mutate: (s) => s.replace('const MIN_TICK_GAP_MS = 90', 'const MIN_TICK_GAP_MS = 20'),
        expect: /MIN_TICK_GAP_MS/
      },
      {
        name: '某页不再走共享件（退回自己的音频写法）',
        file: REL.receive,
        mutate: (s) => s.replace(/textFx\.playTick\(/g, 'this._legacyTick('),
        expect: /没有调用 textFx\.playTick/
      }
    ]
    for (const inj of injections) {
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
  console.log('\n自检通过：切片/计数判据 + 5 处真实注入（删节流、热路径重设 src、热路径写 volume、间隔调小、某页不走共享件）全部拦下')
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
  console.log('  同刻连打 50 次只创建 1 个上下文 / 只写 1 次 src / 只写 1 次 volume / 只响 1 次；')
  console.log('  间隔 100ms 的正常按键不被吞；静音零原生调用；destroy 后可重建；报错只自愈一次；三页共用共享件')
}

main()
