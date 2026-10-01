/**
 * 工作台首页「功能入口」三角色整页预览 + 量版（开发工具，不进 check:admin；需要本机 Chrome）
 *
 * 结构从真 `manager/index.wxml` 现读（主视图整段：问候 → 页脚），样式 = app.wxss + `manager/index.wxss`（展开 @import）；
 * 菜单可见性用真 `utils/workspaceRoles.js` + `manager/hubNav.js` 按角色计算，角标 / 图表用样例数据。
 * 视口 750 宽（rpx 1:1 当 px）；「首屏」按 iPhone 13（390×844pt，扣状态栏 + 导航约 175rpx）= 内容区前 1448px。
 * 离线预览证明不了真机 rpx 取整（错题本 E26）。
 *
 * 用法：
 *   node miniprogram/scripts/render-manager-hub-roles.mjs --out-dir <目录> [--rev <git 提交>] [--only super,manager,staff]
 *   --rev  从该提交读 wxml / wxss / hubNav.js（出「改前」图），默认读工作区
 * 每个角色产出：<角色>.png（整页）、<角色>-first.png（首屏）、<角色>.measure.json（整页高 / 首屏完整可见入口数等）
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderWxml } from './lib/wxml-preview.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const MP = join(ROOT, 'miniprogram')
const MGR_REL = 'miniprogram/subpackages/manager/manager'
const FIRST_SCREEN = 1448

const argv = process.argv.slice(2)
const argOf = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const outDir = argOf('--out-dir', join(tmpdir(), 'manager-hub-roles'))
const rev = argOf('--rev', '')
const only = argOf('--only', '')
mkdirSync(outDir, { recursive: true })

const read = (rel) => (rev
  ? execFileSync('git', ['show', `${rev}:${rel}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
  : readFileSync(join(ROOT, rel), 'utf8'))

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

function loadWxss(rel, seen = new Set()) {
  if (seen.has(rel)) return ''
  seen.add(rel)
  let src
  try { src = read(rel) } catch { return '' }
  return src.replace(/@import\s+['"]([^'"]+)['"];?/g, (_, r) => {
    const p = r.startsWith('/') ? posix.join('miniprogram', r) : posix.normalize(posix.join(posix.dirname(rel), r))
    return loadWxss(p, seen)
  })
}

function loadCjs(code) {
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', code)(mod, mod.exports, (id) => { throw new Error('预览只加载纯模块：' + id) })
  return mod.exports
}

const roles = loadCjs(readFileSync(join(MP, 'utils/workspaceRoles.js'), 'utf8'))
const hubNav = loadCjs(read(`${MGR_REL}/hubNav.js`))
const wxml = read(`${MGR_REL}/index.wxml`)

function cut(src, startMark, endMark) {
  const s = src.indexOf(startMark)
  if (s < 0) throw new Error(`锚点缺失：${startMark}`)
  const e = src.indexOf(endMark, s + 1)
  if (e < 0) throw new Error(`结束锚点缺失：${endMark}`)
  return src.slice(s, e)
}

const N = (n) => new Array(n).fill({})
const sample = {
  curTab: 0, workspaceReady: true, artisanEmbed: false, greeting: '晚上好', staffName: '李', todayDate: '10月1日 周四',
  orders: N(3), newOrderUnreadCount: 1, customOrders: N(2), supportTickets: N(1), framerRecruitApps: N(1),
  approvalPendingCount: 2, invoicePendingCount: 1, giftTodoCount: 2, liveDash: { statusTone: '' },
  opsInfoFeed: [], opsSignalExpanded: false,
  opsSignalSummary: { attentionCount: 2, label: '需关注', worstLamp: 'warn', chips: [{ id: 'a', lamp: 'warn', text: '待发 3', target: 'pending' }, { id: 'b', lamp: 'warn', text: '审批 2', target: 'x' }] },
  stats: {
    displayGrand: '128,640', onlineTotal: '86,200', offlineTotal: '42,440', offlineSplitText: '', ratioEmpty: false,
    donutStyle: 'background: conic-gradient(#C4A76C 0 67%, #2D6A4F 67% 100%);', onlineRatio: 67, offlineRatio: 33,
    orderCountFmt: '214', avgOrderFmt: '¥403', visitCountFmt: '58', dailyAvgFmt: '4,288', momClass: 'up', momLabel: '+12%'
  },
  trendData: ['1', '2', '3', '4', '5', '6', '7'].map((d, i) => ({ dateKey: d, day: `9/${24 + i}`, showVal: true, valShort: `${3 + i}k`, styleOnline: `height:${30 + i * 8}%`, styleOffline: `height:${12 + i * 3}%` })),
  trendMeta: { empty: false, weekTotalFmt: '30,016', weekOnlineFmt: '20,110', weekOfflineFmt: '9,906', weekOnlineBar: 'width:67%', weekOfflineBar: 'width:33%' },
  dashStock: { ready: true, empty: false, onShelf: 412, offShelf: 37, stockTotal: 1288, topCats: [{ key: 'a', name: '蝴蝶', count: 210, barStyle: 'width:80%' }, { key: 'b', name: '甲虫', count: 96, barStyle: 'width:40%' }] },
  chartLayout: {}, opsSignals: {}, opsOrderCounts: {}
}

function dataFor(role) {
  const menu = {}
  Object.values(roles.MENU_KEYS).forEach((k) => { menu[k] = roles.canSeeMenu(role, k) })
  const d = { ...sample, menu, workspaceRole: role, isSuperAdmin: role === roles.WORKSPACE_SUPER_ADMIN }
  d.hubSec = hubNav.sectionFlags(menu)
  d.hubSheet = { open: false, items: [] }
  d.hubPinTip = ''
  d.hubFavEdit = { open: false, selected: [], groups: [] }
  d.hubTodo = hubNav.buildTodos(d)
  const favIds = hubNav.defaultFavs(role, menu)
  d.hubFav = hubNav.buildFavView(favIds, d)
  if (typeof hubNav.buildHubView === 'function') Object.assign(d, hubNav.buildHubView(favIds, d))
  return d
}

const MEASURE_JS = `(() => {
  const top = document.querySelector('.dashboard-view').getBoundingClientRect().top
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const tiles = [...document.querySelectorAll('.hub-tile')].filter(vis)
  const firstTiles = tiles.filter((el) => el.getBoundingClientRect().bottom - top <= ${FIRST_SCREEN})
  const todo = [...document.querySelectorAll('.hub-todo-chip, .hub-todo-cell')].filter(vis)
  const firstTodo = todo.filter((el) => el.getBoundingClientRect().bottom - top <= ${FIRST_SCREEN})
  const box = (sel) => { const el = document.querySelector(sel); if (!el || !vis(el)) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top - top), height: Math.round(r.height) } }
  const out = {
    pageHeight: Math.round(document.querySelector('.dashboard-view').getBoundingClientRect().height),
    tiles: tiles.length, firstScreenTiles: firstTiles.length, firstScreenTileNames: firstTiles.map((el) => (el.querySelector('text') || {}).textContent || ''),
    todoItems: todo.length, firstScreenTodo: firstTodo.length,
    favBox: box('.hub-fav'), todoBox: box('.hub-todo'), catalogBox: box('.hub-cat') || box('.hub-nav'),
    sections: [...document.querySelectorAll('.hub-sec')].filter(vis).map((el) => { const r = el.getBoundingClientRect(); return { title: (el.querySelector('.hub-sec-title') || {}).textContent || '', w: Math.round(r.width), h: Math.round(r.height), tiles: el.querySelectorAll('.hub-tile').length } })
  }
  const pre = document.createElement('pre'); pre.id = '__m'; pre.textContent = JSON.stringify(out); document.body.appendChild(pre)
})()`

function htmlFor(data, tail) {
  const missing = new Set()
  const seg = cut(wxml, '<!-- ==================== 2. 主视图', '<!-- 常用编辑面板')
  let body = renderWxml(`<view class="container">${seg}</view>`, data, { lenient: true, onMissing: (k) => missing.add(k) })
  body = body.replace(/src="\/(assets|subpackages)\//g, (_, d) => `src="file://${MP}/${d}/`)
  // wxml-preview 把 <text> 映射成 <span>：类型选择器跟着换，否则 `.hub-tile > text` 这类规则在预览里不生效
  const css = rpx2px(loadWxss(`${MGR_REL}/index.wxss`)).replace(/(^|[\s>+~,{}])text(?=\s*[{,:>.\s[])/g, '$1span')
  const appCss = rpx2px(readFileSync(join(MP, 'app.wxss'), 'utf8')).replace(/\bpage\s*\{/g, 'body {')
  return `<!doctype html><html><head><meta charset="utf-8"><style>${appCss}</style><style>
:root { --font-mono: "SF Mono", Menlo, monospace; }
html, body { margin: 0; padding: 0; width: 750px; background: #1a1814; color: #fff; font-family: -apple-system, "PingFang SC", sans-serif; }
img:not([src]), img[src=""] { visibility: hidden; }
</style><style>${css.replace(/\bpage\s*\{/g, 'body {')}</style></head><body>${body}${tail}</body></html>`
}

const FLAGS = ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files', '--hide-scrollbars', '--force-device-scale-factor=1', '--virtual-time-budget=3000']

async function screenshot(htmlPath, out, h) {
  if (existsSync(out)) rmSync(out)
  const profile = mkdtempSync(join(tmpdir(), 'hub-roles-'))
  const child = spawn(chrome, [...FLAGS, `--user-data-dir=${profile}`, `--window-size=750,${h}`, `--screenshot=${out}`, `file://${htmlPath}`], { stdio: 'ignore' })
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
  if (!existsSync(out)) throw new Error(`截图未生成：${out}`)
}

const SCENES = [
  { name: 'super', role: roles.WORKSPACE_SUPER_ADMIN },
  { name: 'manager', role: roles.WORKSPACE_STORE_MANAGER },
  { name: 'staff', role: roles.WORKSPACE_STORE_STAFF }
].filter((s) => !only || only.split(',').includes(s.name))

const summary = {}
for (const s of SCENES) {
  const data = dataFor(s.role)
  const htmlPath = join(tmpdir(), `hub-roles-${s.name}-${process.pid}.html`)
  writeFileSync(htmlPath, htmlFor(data, `<script>${MEASURE_JS}</script>`))
  const mp = mkdtempSync(join(tmpdir(), 'hub-roles-'))
  const r = spawnSync(chrome, [...FLAGS, `--user-data-dir=${mp}`, '--window-size=750,1448', '--dump-dom', `file://${htmlPath}`], { encoding: 'utf8', maxBuffer: 1 << 27, timeout: 120000 })
  try { rmSync(mp, { recursive: true, force: true }) } catch { /* ignore */ }
  const m = /<pre id="__m">([\s\S]*?)<\/pre>/.exec(r.stdout || '')
  if (!m) throw new Error(`量版失败：${s.name}`)
  const meas = JSON.parse(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
  writeFileSync(join(outDir, `${s.name}.measure.json`), JSON.stringify(meas, null, 1))
  writeFileSync(htmlPath, htmlFor(data, ''))
  await screenshot(htmlPath, join(outDir, `${s.name}.png`), meas.pageHeight + 40)
  await screenshot(htmlPath, join(outDir, `${s.name}-first.png`), FIRST_SCREEN)
  try { rmSync(htmlPath, { force: true }) } catch { /* ignore */ }
  summary[s.name] = { pageHeight: meas.pageHeight, tiles: meas.tiles, firstScreenTiles: meas.firstScreenTiles, firstScreenTodo: meas.firstScreenTodo, catalog: meas.catalogBox }
  console.log(`✓ ${s.name}：整页 ${meas.pageHeight}px，入口磁贴 ${meas.tiles} 枚，首屏完整可见磁贴 ${meas.firstScreenTiles} 枚 + 待办 ${meas.firstScreenTodo} 项 → ${outDir}`)
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 1))
