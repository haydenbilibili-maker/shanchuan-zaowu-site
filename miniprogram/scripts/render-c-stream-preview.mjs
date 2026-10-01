/**
 * 员工与管理端「细节雕刻」（C 流 2026-10）改后预览（开发工具，不进 check:admin；需要本机 Chrome）
 *
 * 结构从真 wxml 现读（按注释 / 标签锚点截段），样式从真 wxss 展开 @import；样例数据只填版式需要的字段。
 * 一次调用出齐本轮全部场景（AGENTS.md：出图每轮最多 2 次）。离线预览证明不了真机 rpx 取整（错题本 E26）。
 *
 * 用法：
 *   node miniprogram/scripts/render-c-stream-preview.mjs --out-dir <目录> [--only a,b] [--root <另一份检出>] [--measure]
 *   --root    从另一份检出（如 origin/main 的隔离 worktree）读 wxml / wxss，出「改前」图
 *   --measure 截图之外再量一遍：每个直接带字元素的计算色与 alpha 合成后祖先底的对比度（算法同 render-a-flow-preview --measure），
 *             写 <场景>.measure.json
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderWxml } from './lib/wxml-preview.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const argOf = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const ROOT = resolve(argOf('--root', resolve(HERE, '..', '..')))
const MP = join(ROOT, 'miniprogram')
process.env.C_STREAM_MP = MP
const { SCENES } = await import('./lib/c-stream-scenes.mjs')
const outDir = argOf('--out-dir', join(tmpdir(), 'c-stream-preview'))
const only = argOf('--only', '')
const measure = argv.includes('--measure')
mkdirSync(outDir, { recursive: true })

const MEASURE_JS = `(() => {
  const parse = (s) => (String(s).match(/[\\d.]+/g) || []).map(Number)
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
  const rows = []
  for (const el of document.body.querySelectorAll('*')) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('')
    if (!own || !el.getClientRects().length) continue
    const cs = getComputedStyle(el)
    const layers = []
    for (let p = el; p; p = p.parentElement) {
      const c = parse(getComputedStyle(p).backgroundColor)
      const al = c.length > 3 ? c[3] : 1
      if (al > 0) layers.push([c[0], c[1], c[2], al])
      if (al >= 1) break
    }
    let b = [26, 24, 20]
    for (const [r, g, bl, al] of layers.reverse()) b = [r * al + b[0] * (1 - al), g * al + b[1] * (1 - al), bl * al + b[2] * (1 - al)]
    const fc = parse(cs.color), fa = fc.length > 3 ? fc[3] : 1
    const a = [0, 1, 2].map((i) => fc[i] * fa + b[i] * (1 - fa))
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
    rows.push({ cls: String(el.className || el.tagName).slice(0, 60), text: own.slice(0, 16), color: cs.color, bg: 'rgb(' + b.map(Math.round).join(', ') + ')', ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100 })
  }
  const pre = document.createElement('pre'); pre.id = '__m'; pre.textContent = JSON.stringify(rows); document.body.appendChild(pre)
})()`

const chrome = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean).find((p) => existsSync(p))
if (!chrome) {
  console.error('✗ 未找到 Chrome（可用 CHROME_PATH 指定）——预览工具，不参与守卫')
  process.exit(1)
}

const rpx2px = (t) => t.replace(/(\d*\.?\d+)rpx/g, '$1px')

function loadWxss(file, seen = new Set()) {
  if (seen.has(file) || !existsSync(file)) return ''
  seen.add(file)
  return readFileSync(file, 'utf8').replace(/@import\s+['"]([^'"]+)['"];?/g, (_, rel) => {
    const p = rel.startsWith('/') ? join(MP, rel) : resolve(dirname(file), rel)
    return loadWxss(p, seen)
  })
}

function appTokens() {
  const app = readFileSync(join(MP, 'app.wxss'), 'utf8')
  const start = app.indexOf('page {')
  if (start < 0) return ''
  let depth = 0
  for (let i = app.indexOf('{', start); i < app.length; i += 1) {
    if (app[i] === '{') depth += 1
    else if (app[i] === '}') {
      depth -= 1
      if (depth === 0) return rpx2px(app.slice(app.indexOf('{', start) + 1, i))
    }
  }
  return ''
}

async function shoot(scene) {
  const missing = new Set()
  let body = renderWxml(scene.wxml(), scene.data, { lenient: true, onMissing: (k) => missing.add(k) })
  body = body.replace(/src="\/(assets|subpackages)\//g, (_, d) => `src="file://${MP}/${d}/`)
  const css = scene.wxss.map((rel) => rpx2px(loadWxss(join(MP, rel)))).join('\n')
  /** app.wxss 的全局类（ui-sk-* / tap-press 等）页面拿得到，预览也要带上；page 选择器换成 body */
  const appCss = rpx2px(readFileSync(join(MP, 'app.wxss'), 'utf8')).replace(/\bpage\s*\{/g, 'body {')
  const html = (tail) => `<!doctype html><html><head><meta charset="utf-8"><style>
:root { --font-mono: "SF Mono", Menlo, monospace; ${appTokens()} }
</style><style>${appCss}</style><style>
html, body { margin: 0; padding: 0; width: 750px; background: #1a1814; color: #fff; font-family: -apple-system, "PingFang SC", sans-serif; }
img:not([src]), img[src=""] { visibility: hidden; }
</style><style>${css.replace(/\bpage\s*\{/g, 'body {')}</style><style>${scene.extraCss || ''}</style></head><body>${body}${tail}</body></html>`
  const htmlPath = join(tmpdir(), `c-stream-${scene.name}-${process.pid}.html`)
  const flags = ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files', '--virtual-time-budget=3000', `--window-size=750,${scene.h || 1334}`]
  if (measure) {
    writeFileSync(htmlPath, html(`<script>${MEASURE_JS}</script>`))
    const mp = mkdtempSync(join(tmpdir(), 'c-stream-preview-'))
    const r = spawnSync(chrome, [...flags, `--user-data-dir=${mp}`, '--dump-dom', `file://${htmlPath}`], { encoding: 'utf8', maxBuffer: 1 << 27, timeout: 120000 })
    try { rmSync(mp, { recursive: true, force: true }) } catch { /* ignore */ }
    const m = /<pre id="__m">([\s\S]*?)<\/pre>/.exec(r.stdout || '')
    const rows = m ? JSON.parse(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')) : []
    writeFileSync(join(outDir, `${scene.name}.measure.json`), JSON.stringify(rows, null, 1))
  }
  writeFileSync(htmlPath, html(''))
  const out = join(outDir, `${scene.name}.png`)
  if (existsSync(out)) rmSync(out)
  const profile = mkdtempSync(join(tmpdir(), 'c-stream-preview-'))
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
    `--user-data-dir=${profile}`, '--hide-scrollbars', '--force-device-scale-factor=1', '--virtual-time-budget=3000',
    `--window-size=750,${scene.h || 1334}`, `--screenshot=${out}`, `file://${htmlPath}`
  ], { stdio: 'ignore' })
  const deadline = Date.now() + 150000
  let lastSize = -1
  while (Date.now() < deadline) {
    const size = existsSync(out) ? statSync(out).size : 0
    if (size > 1000 && size === lastSize) break
    lastSize = size
    await new Promise((r) => setTimeout(r, 400))
  }
  try { child.kill('SIGKILL') } catch { /* 只杀自己启动的这一个子进程 */ }
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
  try { rmSync(htmlPath, { force: true }) } catch { /* ignore */ }
  if (!existsSync(out)) throw new Error(`截图未生成：${scene.name}`)
  console.log(`✓ ${scene.name} → ${out}${missing.size ? `（缺字段按空渲染 ${missing.size} 个）` : ''}`)
}

const list = SCENES.filter((s) => !only || only.split(',').includes(s.name))
await Promise.all(list.map((s) => shoot(s)))
