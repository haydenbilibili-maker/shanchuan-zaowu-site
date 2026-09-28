#!/usr/bin/env node
/**
 * 祈福墙「玩法弹层」渲染台（2026-09-27：六玩法从独立页收回墙内弹层）。
 *
 * 画的是**真源码**：弹层外壳 `PlaySheet` 的 WXML/WXSS + 弹层本体 `PlayBody/<id>`
 * （它 include 的就是独立页 WXML、@import 的就是独立页 WXSS —— 这里按同样的链路展开），
 * 结果纸面用**真工厂 + 真内容池**现算（`ritualPlay.resolvePlay`），背景是祈福墙页的离线渲染图。
 *
 * 用法：
 *   node miniprogram/scripts/render-play-sheet-preview.mjs --play qian --stage entry      # 出图
 *   node miniprogram/scripts/render-play-sheet-preview.mjs --play coin --stage result --check
 *   node miniprogram/scripts/render-play-sheet-preview.mjs --selftest
 *   可选 --wall <png>：墙页背景图（缺省读 .tmp/wall-preview-full.png；没有就用纯色底）
 *   可选 --wall-top <px>：背景图上移多少（把「今天的玩法」六格滚进视口）；--stage wall 只出背景（弹层未开）
 *
 * 判据（--check；每条都有 --selftest 注入）：
 *   ① 近全屏：面板贴左右边、顶距 ≤ 视口 10%；② 收起键可点区 ≥ 88rpx；
 *   ③ 本体真的渲染在面板里（入口态有本玩法形态件、结果态有本玩法纸面内容）；
 *   ④ 面板内无横向溢出；⑤ 结果态动作行（写成心愿 / 分享）在首屏内；
 *   ⑥ 结果态挂签条（输入框 + 「挂上墙」）渲染在面板里且整条在首屏内（2026-09-27 一步落愿）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderWxml } from './lib/wxml-preview.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const TMP_DIR = join(MP, 'scripts/.tmp')
mkdirSync(TMP_DIR, { recursive: true })

const argv = process.argv.slice(2)
const has = (n) => argv.includes(n)
const argOf = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}

/** 入口态形态件 / 结果态纸面内容类（与 render-play-preview 同口径） */
const PLAYS = {
  qian: { form: '.rp-tube', paper: '.rp-paper-title' },
  cookie: { form: '.rp-shell', paper: '.rp-cookie-line' },
  zodiac: { form: '.rp-wheel', paper: '.rp-paper-title' },
  mbti: { form: '.rp-axis', paper: '.rp-paper-title' },
  solar: { form: '.rp-leaf', paper: '.rp-solar-line' },
  coin: { form: '.rp-coin', paper: '.rp-coin-line' }
}
const PLAY = argOf('--play', 'qian')
const STAGE = argOf('--stage', 'entry')
if (!PLAYS[PLAY]) { console.error(`✗ 未知玩法 ${PLAY}（可用：${Object.keys(PLAYS).join(' / ')}）`); process.exit(2) }
if (!['entry', 'result', 'wall'].includes(STAGE)) { console.error('✗ --stage 只支持 entry / result / wall（wall = 弹层未开，只出墙页背景图）'); process.exit(2) }
if (STAGE === 'wall' && (has('--check') || has('--selftest'))) { console.error('✗ wall 只出图，不判版式'); process.exit(2) }
const WALL_TOP = Math.max(0, Number(argOf('--wall-top', '0')) || 0)
const OUT = argOf('--out', join(TMP_DIR, `play-sheet-${PLAY}-${STAGE}.png`))
const WALL_PNG = argOf('--wall', join(TMP_DIR, 'wall-preview-full.png'))

/* ── 源码路径（自检注入走 .tmp 副本，真源码只读） ─────────────────────── */
const SHEET_DIR = join(MP, 'subpackages/plays/components/PlaySheet')
const BODY_DIR = join(MP, `subpackages/plays/components/PlayBody/${PLAY}`)
const sheetWxmlPath = process.env.PLAY_SHEET_WXML || join(SHEET_DIR, 'index.wxml')
const sheetWxssPath = process.env.PLAY_SHEET_WXSS || join(SHEET_DIR, 'index.wxss')
const bodyWxmlPath = process.env.PLAY_BODY_WXML || join(BODY_DIR, 'index.wxml')
const bodyWxssPath = process.env.PLAY_BODY_WXSS || join(BODY_DIR, 'index.wxss')

const toCss = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(\d*\.?\d+)rpx/g, (_, n) => `${Number(n)}px`)
  .replace(/env\(safe-area-inset-(bottom|top)\)/g, '0px')

/** 按小程序的相对路径语义展开 @import（本体 → 独立页 → 共享骨架） */
function expandImports (absPath, seen = new Set()) {
  if (seen.has(absPath)) return ''
  seen.add(absPath)
  const src = readFileSync(absPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  return src.replace(/@import\s+["']([^"']+)["']\s*;?/g, (_, spec) => {
    const p = resolve(dirname(absPath), spec)
    return existsSync(p) ? expandImports(p, seen) : `/* 缺 ${spec} */`
  })
}

/** 展开 `<include src>`（本体 → 独立页 WXML → 共享挂签条；相对路径按**所在文件**解析，与小程序一致） */
function expandInclude (absPath, depth = 0) {
  const src = readFileSync(absPath, 'utf8')
  if (depth > 3) return src
  return src.replace(/<include\s+src="([^"]+)"\s*\/>/g, (_, spec) => {
    const p = resolve(dirname(absPath), spec)
    return existsSync(p) ? expandInclude(p, depth + 1) : ''
  })
}

const appCss = toCss(readFileSync(join(MP, 'app.wxss'), 'utf8'))
const vars = (() => {
  const m = /(^|\n)page\s*\{([\s\S]*?)\}/.exec(appCss)
  return [...String(m ? m[2] : '').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((x) => `  ${x[1]}: ${x[2].trim()};`).join('\n')
})()
const sheetCss = toCss(readFileSync(sheetWxssPath, 'utf8'))
const bodyCss = toCss(expandImports(bodyWxssPath))

/* ── 数据：真工厂 + 真内容池 ─────────────────────────────────────────── */
function loadCjs (absPath, cache = new Map()) {
  if (cache.has(absPath)) return cache.get(absPath)
  const mod = { exports: {} }
  cache.set(absPath, mod.exports)
  const req = (id) => {
    if (!id.startsWith('.')) throw new Error('preview 只解析相对 require：' + id)
    let p = resolve(dirname(absPath), id)
    if (!existsSync(p) && existsSync(p + '.js')) p += '.js'
    return loadCjs(p, cache)
  }
  new Function('module', 'exports', 'require', readFileSync(absPath, 'utf8'))(mod, mod.exports, req)
  cache.set(absPath, mod.exports)
  return mod.exports
}
globalThis.wx = globalThis.wx || new Proxy({}, { get: () => () => '' })
const factory = loadCjs(join(MP, 'subpackages/plays/utils/ritualPlayPage.js'))
const ritualPlay = loadCjs(join(MP, 'subpackages/plays/utils/ritualPlay.js'))
const { findPlay } = loadCjs(join(MP, 'subpackages/plays/config/ritualPlays.js'))
const DAY = '2026-09-27'
const PROFILE = { zodiac: 'scorpio', mbti: 'INFP' }
const bodyData = Object.assign({}, factory.createRitualPlayBody(PLAY).data, { productTitle: '马上有', productId: 'p1', embedded: true })
if (STAGE === 'result') {
  const variant = PLAY === 'zodiac' ? PROFILE.zodiac : PLAY === 'mbti' ? PROFILE.mbti : ''
  const r = ritualPlay.resolvePlay(PLAY, { dayKey: DAY, profile: PROFILE, variant })
  if (!r || !r.ok) { console.error(`✗ 真工厂没解出 ${PLAY} 的结果：${JSON.stringify(r)}`); process.exit(1) }
  // 推荐行走样例（真推荐要打云函数）；其余全部是真工厂现算
  const reco = { _id: 'r1', label: '偏「求成」· 为你配一件', title: '马上有 · 鎏金小马', cover: '', latinName: '', priceText: '¥128' }
  const wishDraft = String(r.wish || '马上有').slice(0, 30)
  Object.assign(bodyData, { stage: 'result', result: r, playedToday: true, variant, reco, wishDraft, wishCount: [...wishDraft].length })
} else {
  Object.assign(bodyData, { stage: 'idle' })
}
const sheetData = { playId: PLAY, ctx: {}, name: (findPlay(PLAY) || {}).name || '', closing: false, dragY: 0 }

const sheetMarkup = renderWxml(readFileSync(sheetWxmlPath, 'utf8'), sheetData)
const bodyMarkup = renderWxml(expandInclude(bodyWxmlPath), bodyData)
const SCROLL_OPEN = /(<div[^>]*class="ps-scroll"[^>]*>)/
if (!SCROLL_OPEN.test(sheetMarkup)) { console.error('✗ 弹层 WXML 里找不到 .ps-scroll 挂点'); process.exit(1) }
const markup = STAGE === 'wall' ? '' : sheetMarkup.replace(SCROLL_OPEN, `$1${bodyMarkup}`)

const wallBg = existsSync(WALL_PNG)
  ? `<img src="data:image/png;base64,${readFileSync(WALL_PNG).toString('base64')}" style="position:absolute;left:0;top:-${WALL_TOP}px;width:750px;display:block;" />`
  : ''
const FREEZE = '* { animation: none !important; transition: none !important; }'
const htmlOf = (freeze) => `<!doctype html><html><head><meta charset="utf-8"><style>
:root {
${vars}
}
html, body { margin: 0; padding: 0; width: 750px; height: 1334px; overflow: hidden; background: #14120F; position: relative; }
.ps-scroll { overflow-y: auto; overflow-x: hidden; }
${appCss.replace(/(^|\n)page\s*\{[\s\S]*?\}/, '')}
${sheetCss}
${bodyCss}
${freeze ? FREEZE : ''}
</style></head><body>${wallBg}${markup}</body></html>`

const MEASURE_JS = `<script>
window.addEventListener('load', () => {
  const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, sw: el.scrollWidth, cw: el.clientWidth } }
  const out = {
    vw: innerWidth, vh: innerHeight,
    panel: r('.ps-panel'), close: r('.ps-close'), scroll: r('.ps-scroll'),
    bodyInPanel: !!document.querySelector('.ps-scroll .rp-page'),
    form: !!document.querySelector('.ps-scroll ${PLAYS[PLAY].form}'),
    paper: !!document.querySelector('.ps-scroll ${PLAYS[PLAY].paper}'),
    acts: r('.ps-scroll .rp-acts'),
    post: r('.ps-scroll .rp-post'),
    postGo: r('.ps-scroll .rp-post-acts .rp-act.is-primary')
  }
  const pre = document.createElement('pre'); pre.id = 'sheet-metrics'; pre.textContent = JSON.stringify(out); document.body.appendChild(pre)
})
</script>`

const tag = `${PLAY}-${STAGE}-${process.pid}`
const measurePath = join(TMP_DIR, `play-sheet-measure-${tag}.html`)
const shotPath = join(TMP_DIR, `play-sheet-shot-${tag}.html`)
writeFileSync(measurePath, htmlOf(true).replace('</body>', `${MEASURE_JS}</body>`))
// 出图也冻结动画：弹层进场 280ms，无头截图的时刻落在动画中途会画出半透明遮罩 / 空面板（实测过）
writeFileSync(shotPath, htmlOf(true))

const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].find((p) => existsSync(p))
if (!CHROME) { console.error('✗ 未找到 Chrome（可用 CHROME_PATH 指定）'); process.exit(1) }

function runChrome (args) {
  return new Promise((done) => {
    const profile = mkdtempSync(join(tmpdir(), 'sc-play-sheet-'))
    const child = spawn(CHROME, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${profile}`, '--hide-scrollbars', '--force-device-scale-factor=1',
      '--allow-file-access-from-files', '--virtual-time-budget=1500', '--window-size=750,1334', ...args
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const kill = () => { try { child.kill('SIGKILL') } catch (e) { /* ignore */ } }
    // 本机无头 Chrome 常在产出之后不退出：产出齐了就收（DOM 读到 </html> / 截图文件落盘）
    const shot = (args.find((a) => a.startsWith('--screenshot=')) || '').slice('--screenshot='.length)
    child.stdout.on('data', (d) => {
      out += d.toString()
      if (!shot && out.includes('</html>')) kill()
    })
    let lastSize = -1
    const poll = shot ? setInterval(() => {
      const size = existsSync(shot) ? statSync(shot).size : -1
      if (size > 0 && size === lastSize) kill()
      lastSize = size
    }, 400) : null
    const timer = setTimeout(kill, 90000)
    child.on('close', () => {
      clearTimeout(timer)
      if (poll) clearInterval(poll)
      try { rmSync(profile, { recursive: true, force: true }) } catch (e) { /* ignore */ }
      done(out)
    })
  })
}

async function measure () {
  const dom = await runChrome(['--dump-dom', `file://${measurePath}`])
  const m = /<pre id="sheet-metrics">([\s\S]*?)<\/pre>/.exec(dom)
  if (!m) { console.error('✗ 没拿到量测结果（Chrome 可能被沙箱拦了）'); process.exit(1) }
  return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
}

function judge (x) {
  const problems = []
  if (!x.panel) return ['弹层面板 .ps-panel 没渲染出来']
  if (x.panel.x > 1 || Math.abs(x.panel.w - x.vw) > 1) problems.push(`面板没贴满左右（x=${x.panel.x} w=${x.panel.w} / 视口 ${x.vw}）`)
  if (x.panel.y > x.vh * 0.1) problems.push(`面板顶距 ${Math.round(x.panel.y)}px > 视口 10%（不是近全屏弹层）`)
  if (!x.close || x.close.w < 88 || x.close.h < 88) problems.push(`收起键可点区不足 88rpx：${x.close ? `${Math.round(x.close.w)}×${Math.round(x.close.h)}` : '缺失'}`)
  if (!x.bodyInPanel) problems.push('玩法本体（.rp-page）没渲染在弹层里')
  if (STAGE === 'entry' && !x.form) problems.push(`入口态缺本玩法形态件 ${PLAYS[PLAY].form}`)
  if (STAGE === 'result' && !x.paper) problems.push(`结果态缺本玩法纸面内容 ${PLAYS[PLAY].paper}`)
  if (x.scroll && x.scroll.sw > x.scroll.cw + 1) problems.push(`面板内横向溢出（scrollW ${x.scroll.sw} > clientW ${x.scroll.cw}）`)
  if (STAGE === 'result' && (!x.acts || x.acts.y > x.vh)) problems.push('结果态动作行（写成心愿 / 分享）不在首屏')
  if (STAGE === 'result' && (!x.post || !x.postGo || !x.post.h || !x.postGo.h)) problems.push('结果态缺挂签条（.rp-post 输入框 / 「挂上墙」）')
  else if (STAGE === 'result' && x.postGo.y + x.postGo.h > x.vh) problems.push(`「挂上墙」不在首屏（底边 ${Math.round(x.postGo.y + x.postGo.h)} > 视口 ${x.vh}）`)
  return problems
}

if (has('--selftest')) {
  const INJECTS = [
    { name: 'panel-half-height', env: 'PLAY_SHEET_WXSS', src: sheetWxssPath, add: '\n.ps-panel { top: 50vh !important; }', stage: 'entry' },
    { name: 'close-tiny', env: 'PLAY_SHEET_WXSS', src: sheetWxssPath, add: '\n.ps-close { height: 30rpx !important; min-width: 0 !important; padding: 0 !important; }', stage: 'entry' },
    { name: 'body-not-included', env: 'PLAY_BODY_WXML', src: bodyWxmlPath, replace: [/<include[^>]*\/>/, '<view></view>'], stage: 'entry' },
    { name: 'paper-overflow', env: 'PLAY_BODY_WXSS', src: bodyWxssPath, add: '\n.rp-paper { width: 1400rpx !important; max-width: none !important; }', stage: 'result' },
    { name: 'post-strip-missing', env: 'PLAY_BODY_WXSS', src: bodyWxssPath, add: '\n.rp-post, .rp-post-acts { display: none !important; }', stage: 'result' },
    { name: 'acts-pushed-away', env: 'PLAY_BODY_WXSS', src: bodyWxssPath, add: '\n.rp-paper { margin-top: 2400rpx !important; }', stage: 'result' }
  ]
  let bad = 0
  for (const inj of INJECTS) {
    let text = readFileSync(inj.src, 'utf8')
    if (inj.replace) {
      if (!inj.replace[0].test(text)) throw new Error('注入锚点失效：' + inj.name)
      text = text.replace(inj.replace[0], inj.replace[1])
    } else {
      text += inj.add
    }
    // 副本放在真文件同目录（点号开头、finally 必删）：@import / include 的相对路径才解析得对
    const copy = join(dirname(inj.src), `.selftest-${inj.name}${inj.src.slice(inj.src.lastIndexOf('.'))}`)
    writeFileSync(copy, text)
    try {
      const run = spawn(process.execPath, [fileURLToPath(import.meta.url), '--play', PLAY, '--stage', inj.stage, '--check'], { env: { ...process.env, [inj.env]: copy } })
      const code = await new Promise((r) => run.on('close', r))
      if (code !== 0) console.log(`  ✓ 注入 ${inj.name} 被检出`)
      else { bad += 1; console.error(`  ✗ 注入 ${inj.name} 未被检出（判据不会失败 = 守卫无效）`) }
    } finally {
      rmSync(copy, { force: true })
    }
  }
  for (const stage of ['entry', 'result']) {
    const clean = spawn(process.execPath, [fileURLToPath(import.meta.url), '--play', PLAY, '--stage', stage, '--check'])
    const code = await new Promise((r) => clean.on('close', r))
    if (code !== 0) { bad += 1; console.error(`  ✗ 未注入的 ${stage} 本应通过，实际失败`) } else console.log(`  ✓ 未注入的 ${stage} 通过（无假阳性）`)
  }
  if (bad) { console.error(`\n✗ selftest 失败 ${bad} 项`); process.exit(1) }
  console.log(`\n✓ selftest 通过：${INJECTS.length} 个注入全部被检出，且无假阳性`)
  process.exit(0)
}

const metrics = await measure()
const problems = STAGE === 'wall' ? [] : judge(metrics)
try { rmSync(measurePath, { force: true }) } catch (e) { /* ignore */ }
if (has('--check')) {
  try { rmSync(shotPath, { force: true }) } catch (e) { /* ignore */ }
  if (problems.length) {
    console.error(`✗ 玩法弹层 ${PLAY} · ${STAGE} 违反 ${problems.length} 处：`)
    problems.forEach((p) => console.error('  - ' + p))
    process.exit(1)
  }
  console.log(`✓ 玩法弹层 ${PLAY} · ${STAGE} 通过（近全屏 / 收起键 ≥88rpx / 本体在面板里 / 无横向溢出 / 结果动作首屏）`)
  process.exit(0)
}
rmSync(OUT, { force: true })
await runChrome([`--screenshot=${OUT}`, `file://${shotPath}`])
try { rmSync(shotPath, { force: true }) } catch (e) { /* ignore */ }
if (existsSync(OUT)) console.log(`✓ 出图：${OUT}`)
if (problems.length) {
  console.error(`⚠ 版式问题 ${problems.length} 处：`)
  problems.forEach((p) => console.error('  - ' + p))
  process.exit(1)
}
