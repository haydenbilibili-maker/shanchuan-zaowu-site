/**
 * 超管 / 店长工作台「功能入口」改前 / 改后预览（开发工具，不进 check:admin；需要本机 Chrome）
 *
 * 结构从真 `manager/index.wxml` 现读（按注释锚点截出入口块与二级面板），样式从真 `manager/index.wxss` 展开 @import；
 * 菜单可见性用真 `utils/workspaceRoles.js` + `manager/hubNav.js` 按角色计算。无头 Chrome 750px 视口（rpx 1:1 当 px）。
 * 离线预览只能证明结构与配色，证明不了真机 rpx 取整（错题本 E26）。
 *
 * 用法：
 *   node miniprogram/scripts/render-manager-hub-preview.mjs --out-dir <目录> [--before-rev HEAD] [--only a,b]
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderWxml } from './lib/wxml-preview.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const MP = join(ROOT, 'miniprogram')
const MGR = join(MP, 'subpackages/manager/manager')
const REL_WXML = 'miniprogram/subpackages/manager/manager/index.wxml'
const REL_WXSS = 'miniprogram/subpackages/manager/manager/index.wxss'

function loadCjs(absPath) {
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', readFileSync(absPath, 'utf8'))(mod, mod.exports, (id) => {
    throw new Error('预览只加载纯模块：' + id)
  })
  return mod.exports
}

const argv = process.argv.slice(2)
const argOf = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const outDir = argOf('--out-dir', join(tmpdir(), 'manager-hub-preview'))
const beforeRev = argOf('--before-rev', '')
const only = argOf('--only', '')
mkdirSync(outDir, { recursive: true })

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

function loadWxss(file, text, seen = new Set()) {
  if (seen.has(file)) return ''
  seen.add(file)
  const src = text != null ? text : readFileSync(file, 'utf8')
  return src.replace(/@import\s+['"]([^'"]+)['"];?/g, (_, rel) => {
    const p = resolve(dirname(file), rel)
    return existsSync(p) ? loadWxss(p, null, seen) : ''
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

function cut(src, startMarks, endMark) {
  const s = startMarks.map((m) => src.indexOf(m)).find((i) => i >= 0)
  if (s === undefined) throw new Error(`锚点缺失：${startMarks.join(' | ')}`)
  const e = src.indexOf(endMark, s + 1)
  if (e < 0) throw new Error(`结束锚点缺失：${endMark}`)
  return src.slice(s, e)
}

function segments(src, overlay) {
  // 2026-10-02：金卡已上移；扫码 + 常用在搜索 / 待办之后、瀑布流之前
  const cta = cut(src, ['<!-- 首屏主 CTA'], '<!-- 瀑布流布局容器')
  const menu = cut(src, ['<!-- 功能入口', '<!-- 快捷菜单'], '<!-- 数据图表')
  let sheet = ''
  if (overlay === 'fav') sheet = `${cut(src, ['<!-- 常用编辑面板'], '\n</view>\n\n</view>')}\n</view>`
  return `<view class="container"><view class="content-area dashboard-view">${cta}<view class="dashboard-grid">${menu}</view></view>${sheet}</view>`
}

const roles = loadCjs(join(MP, 'utils/workspaceRoles.js'))
const hubNav = loadCjs(join(MGR, 'hubNav.js'))

function menuFor(role) {
  const menu = {}
  Object.values(roles.MENU_KEYS).forEach((k) => { menu[k] = roles.canSeeMenu(role, k) })
  return menu
}

/* 计数样例：形状取自 managerPageConfig.data 的角标字段 */
const counts = {
  orders: new Array(3).fill({}), newOrderUnreadCount: 0, customOrders: new Array(2).fill({}), supportTickets: new Array(5).fill({}),
  framerRecruitApps: new Array(1).fill({}), approvalPendingCount: 4, invoicePendingCount: 1, giftTodoCount: 2,
  liveDash: { statusTone: '' }, isSuperAdmin: true
}

function dataFor(role, extra = {}) {
  const menu = menuFor(role)
  const secs = roles.HUB_MENU_SECTIONS
  const any = (keys) => keys.some((k) => menu[k])
  const d = {
    ...counts,
    isSuperAdmin: role === roles.WORKSPACE_SUPER_ADMIN,
    menu,
    menuSectionOps: any(secs.OPS), menuSectionStudio: any(secs.STUDIO), menuSectionMembers: any(secs.MEMBERS),
    menuSectionOrg: any(secs.ORG), menuSectionOnSite: any(secs.ON_SITE),
    hubSec: hubNav.sectionFlags(menu),
    ...extra
  }
  d.hubTodo = hubNav.buildTodos(d)
  const favIds = extra.favIds || hubNav.defaultFavs(role, menu)
  d.hubFav = hubNav.buildFavView(favIds, d)
  d.hubFavEdit = extra.favEdit ? hubNav.buildFavEditor(favIds, menu) : { open: false, selected: [], groups: [] }
  return d
}

const afterWxml = readFileSync(join(ROOT, REL_WXML), 'utf8')
const scenes = []
if (beforeRev) {
  const git = (rel) => execFileSync('git', ['show', `${beforeRev}:${rel}`], { cwd: ROOT, encoding: 'utf8' })
  scenes.push({ name: 'before-super', wxml: git(REL_WXML), wxssText: git(REL_WXSS), h: 2000, data: dataFor(roles.WORKSPACE_SUPER_ADMIN) })
}
scenes.push(
  { name: 'after-super', wxml: afterWxml, h: 2700, data: dataFor(roles.WORKSPACE_SUPER_ADMIN) },
  { name: 'after-manager', wxml: afterWxml, h: 1500, data: dataFor(roles.WORKSPACE_STORE_MANAGER) },
  {
    name: 'after-fav-edit', wxml: afterWxml, h: 1500, overlay: 'fav',
    data: dataFor(roles.WORKSPACE_SUPER_ADMIN, { favEdit: true, favIds: ['orders', 'ledger', 'analytics', 'approvals', 'support', 'giftOps'] })
  }
)

async function shoot(scene) {
  const missing = new Set()
  let body = renderWxml(segments(scene.wxml, scene.overlay), scene.data, { lenient: true, onMissing: (k) => missing.add(k) })
  body = body.replace(/src="\/(assets|subpackages)\//g, (_, d) => `src="file://${MP}/${d}/`)
  const css = rpx2px(loadWxss(join(ROOT, REL_WXSS), scene.wxssText != null ? scene.wxssText : null))
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
:root { --font-mono: "SF Mono", Menlo, monospace; ${appTokens()} }
html, body { margin: 0; padding: 0; width: 750px; background: #1a1814; color: #fff; font-family: -apple-system, "PingFang SC", sans-serif; }
img:not([src]), img[src=""] { visibility: hidden; }
</style><style>${css.replace(/\bpage\s*\{/g, 'body {')}</style></head><body>${body}</body></html>`
  const htmlPath = join(tmpdir(), `manager-hub-${scene.name}-${process.pid}.html`)
  writeFileSync(htmlPath, html)
  const out = join(outDir, `${scene.name}.png`)
  if (existsSync(out)) rmSync(out)
  const profile = mkdtempSync(join(tmpdir(), 'manager-hub-preview-'))
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
    `--user-data-dir=${profile}`, '--hide-scrollbars', '--force-device-scale-factor=1', '--virtual-time-budget=3000',
    `--window-size=750,${scene.h}`, `--screenshot=${out}`, `file://${htmlPath}`
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
  if (!existsSync(out)) throw new Error(`截图未生成：${scene.name}`)
  console.log(`✓ ${scene.name} → ${out}${missing.size ? `（缺字段按空渲染 ${missing.size} 个）` : ''}`)
}

for (const s of scenes) if (!only || only.split(',').includes(s.name)) await shoot(s)
