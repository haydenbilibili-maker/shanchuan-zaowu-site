/**
 * 超管工作台「活动课程」改前 / 改后预览（开发工具，不进 check:admin）
 *
 * 结构从真 `workspace/_subviews.wxml` 现读（按注释锚点截出 Tab 7 与活动编辑面板两段），
 * 样式从真 `workspace/index.wxss` 现读并展开 @import；无头 Chrome 以 750px 视口截图（rpx 1:1 当 px）。
 *
 * 用法：
 *   node miniprogram/scripts/render-activity-board-preview.mjs --out-dir <目录> [--before-dir <旧快照目录>] [--only a,b]
 *   旧快照目录下放改前的 `_subviews.wxml` / `index.wxss`（workspace）/ `manager-index.wxss`（manager/index.wxss）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderWxml } from './lib/wxml-preview.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const MGR = join(ROOT, 'miniprogram/subpackages/manager/manager')

/** 小程序源码是 CJS，而仓库根 package.json 是 type:module —— 用最小 CJS 加载器读纯函数模块 */
function loadCjs(absPath) {
  const mod = { exports: {} }
  const req = (id) => {
    for (const c of [resolve(dirname(absPath), id), `${resolve(dirname(absPath), id)}.js`]) {
      if (existsSync(c) && statSync(c).isFile()) return loadCjs(c)
    }
    throw new Error('require 解析失败：' + id)
  }
  new Function('module', 'exports', 'require', readFileSync(absPath, 'utf8'))(mod, mod.exports, req)
  return mod.exports
}

const argv = process.argv.slice(2)
const argOf = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const outDir = argOf('--out-dir', join(tmpdir(), 'activity-board-preview'))
const beforeDir = argOf('--before-dir', '')
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

function loadWxss(file, seen = new Set(), alias = {}) {
  if (seen.has(file)) return ''
  seen.add(file)
  const src = readFileSync(file, 'utf8')
  return src.replace(/@import\s+['"]([^'"]+)['"];?/g, (_, rel) => {
    let p = alias[rel] || resolve(dirname(file), rel)
    if (!existsSync(p)) p = resolve(MGR, 'workspace', rel)
    return existsSync(p) ? loadWxss(p, seen, alias) : ''
  })
}

function appTokens() {
  const app = readFileSync(join(ROOT, 'miniprogram/app.wxss'), 'utf8')
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

/** 按注释锚点截出一段（锚点缺失即抛错：预览对象必须是真源码） */
function cut(src, startMarks, endMark) {
  const s = startMarks.map((m) => src.indexOf(m)).find((i) => i >= 0)
  if (s === undefined) throw new Error(`锚点缺失：${startMarks.join(' | ')}`)
  const e = src.indexOf(endMark, s + 1)
  if (e < 0) throw new Error(`结束锚点缺失：${endMark}`)
  return src.slice(s, e)
}

function segments(wxmlFile) {
  const src = readFileSync(wxmlFile, 'utf8')
  const tab = cut(src, ['<!-- [Tab 7]'], '<!-- [Tab 9]')
  const modal = cut(src, ['<!-- 活动编辑面板', '<!-- 🟢 活动弹窗'], '<!-- 分类管理已迁入')
  return `<view class="container workspace-leaf"><view class="content-area sub-view">${tab}</view>${modal}</view>`
}

/* ── 样例数据（形状取自 2026-09-28 线上 activities 只读实测：4 条，均已过期仍 status=open） ── */
const rawActivities = [
  { _id: 'n1', title: '海洋标本制作体验课', type: 'course', date: '2026-10-03', time: '14:00 - 16:00', location: '本店', price: 200, maxPeople: 12, remain: 12, status: 'open', storeId: 'store_shanhaizaowu', image: '' },
  { _id: 'n2', title: '秋夜博物馆 · 昆虫篇', type: 'special_activity', date: '2026-09-28', time: '19:00 - 21:00', location: '这有山 3F 博物志', price: 0, maxPeople: 30, remain: 30, status: 'open', storeId: 'store_shanhaizaowu', image: '' },
  { _id: 'n3', title: '蝴蝶展翅手作课', type: 'course', date: '2026-10-12', time: '10:00', location: '星宸标本工作室', price: 168, maxPeople: 8, remain: 8, status: 'closed', storeId: 'store_xingchen', image: '' },
  { _id: 'a23', title: '海洋标本制作体验课', type: 'course', date: '2026-01-23', time: '', location: '本店', price: 200, maxPeople: 20, remain: 20, status: 'open', image: '' },
  { _id: 'ab9', title: '博物馆奇妙夜·圣诞节特辑', type: 'special_activity', date: '2025-12-24', time: '', location: '这有山·临水广场', price: 100, maxPeople: 30, remain: 30, status: 'open', image: '' },
  { _id: 'act_101', title: '博物馆奇妙夜 · 昆虫篇', date: '2023-12-24', time: '19:00 - 21:00', location: '这有山 3F 博物志', price: 299, maxPeople: 20, remain: 3, status: 'open', image: '' },
  { _id: 'act_102', title: '专家讲座：从矿石到宝石', date: '2023-12-30', time: '14:00 - 16:00', location: '这有山 3F 多功能厅', price: 0, maxPeople: 50, remain: 0, status: 'full', image: '' }
]
const stats = { n1: { booked: 9, verified: 0 }, n2: { booked: 26, verified: 4 }, n3: { booked: 8, verified: 0 }, a23: { booked: 0, verified: 0 } }
const NOW = Date.parse('2026-09-28T13:40:00Z')

function afterData(extra = {}) {
  const board = loadCjs(join(ROOT, 'miniprogram/subpackages/manager/utils/activityBoard.js'))
  const filter = extra.actFilter || 'live'
  const view = board.buildBoard(extra.rawList || rawActivities, { now: NOW, stats, filter })
  const storeOptions = board.STORES
  return {
    curTab: 7, actReady: true, actLoading: false, actError: '', activities: extra.rawList || rawActivities,
    actFilter: filter, actBoard: view, actStoreNames: storeOptions.map((s) => s.name),
    showActivityModal: false, tempActivity: {}, actFormErr: {}, actConfirmDelId: '', actStaleConfirm: false, actBusyId: '', actSaving: false, isEditing: false,
    ...extra
  }
}

const editorForm = {
  title: '海洋标本制作体验课', type: 'course', date: '2026-10-03', dateText: '10月3日 周六', timeStart: '14:00', timeEnd: '16:00',
  price: '200', maxPeople: '12', location: '本店', storeIndex: 0, image: ''
}

const scenes = []
if (beforeDir) {
  const beforeWxml = join(beforeDir, '_subviews.wxml')
  const beforeWxss = join(beforeDir, 'index.wxss')
  const alias = { '../index.wxss': join(beforeDir, 'manager-index.wxss') }
  const beforeData = { curTab: 7, activities: rawActivities, showActivityModal: false, tempActivity: {} }
  scenes.push(
    { name: 'before-list', wxml: beforeWxml, wxss: beforeWxss, alias, h: 1500, data: beforeData },
    {
      name: 'before-modal', wxml: beforeWxml, wxss: beforeWxss, alias, h: 1334,
      data: { ...beforeData, showActivityModal: true, tempActivity: { title: '海洋标本制作体验课', type: 'course', date: '2026-10-03', time: '14:00', price: '200', maxPeople: '12', location: '本店', image: '' } }
    }
  )
}
const AFTER_WXML = join(MGR, 'workspace/_subviews.wxml')
const AFTER_WXSS = join(MGR, 'workspace/index.wxss')
scenes.push(
  { name: 'after-live', wxml: AFTER_WXML, wxss: AFTER_WXSS, h: 1500, data: () => afterData() },
  { name: 'after-ended', wxml: AFTER_WXML, wxss: AFTER_WXSS, h: 1500, data: () => afterData({ actFilter: 'ended', actConfirmDelId: 'act_102' }) },
  { name: 'after-empty', wxml: AFTER_WXML, wxss: AFTER_WXSS, h: 1000, data: () => afterData({ rawList: [] }) },
  { name: 'after-error', wxml: AFTER_WXML, wxss: AFTER_WXSS, h: 1000, data: () => afterData({ rawList: [], actError: '活动读取失败：网络异常' }) },
  { name: 'after-loading', wxml: AFTER_WXML, wxss: AFTER_WXSS, h: 1000, data: () => afterData({ actReady: false, actLoading: true }) },
  { name: 'after-editor', wxml: AFTER_WXML, wxss: AFTER_WXSS, h: 1334, data: () => afterData({ showActivityModal: true, isEditing: true, tempActivity: editorForm }) },
  {
    name: 'after-editor-error', wxml: AFTER_WXML, wxss: AFTER_WXSS, h: 1334,
    data: () => afterData({ showActivityModal: true, isEditing: false, tempActivity: { ...editorForm, title: '', date: '', dateText: '' }, actFormErr: { field: 'title', msg: '请填写活动标题' } })
  }
)

async function shoot(scene) {
  const missing = new Set()
  const data = typeof scene.data === 'function' ? scene.data() : scene.data
  const body = renderWxml(segments(scene.wxml), data, { lenient: true, onMissing: (k) => missing.add(k) })
  const css = rpx2px(loadWxss(scene.wxss, new Set(), scene.alias || {}))
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
:root { --font-mono: "SF Mono", Menlo, monospace; ${appTokens()} }
html, body { margin: 0; padding: 0; width: 750px; background: #1a1814; color: #fff; font-family: -apple-system, "PingFang SC", sans-serif; }
input, .input { display: block; min-height: 1em; background: transparent; border: 0; color: inherit; font: inherit; }
img:not([src]), img[src=""] { visibility: hidden; }
</style><style>${css.replace(/\bpage\s*\{/g, 'body {')}</style><style>
.modal-mask { opacity: 1 !important; animation: none !important; }
.modal-panel { transform: none !important; animation: none !important; }
</style></head><body>${body}</body></html>`
  const htmlPath = join(tmpdir(), `activity-board-${scene.name}-${process.pid}.html`)
  writeFileSync(htmlPath, html)
  const out = join(outDir, `${scene.name}.png`)
  if (existsSync(out)) rmSync(out)
  const profile = mkdtempSync(join(tmpdir(), 'act-board-preview-'))
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
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
  try { child.kill('SIGKILL') } catch { /* ignore */ }
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
  if (!existsSync(out)) throw new Error(`截图未生成：${scene.name}`)
  console.log(`✓ ${scene.name} → ${out}${missing.size ? `（缺字段按空渲染 ${missing.size} 个）` : ''}`)
}

for (const s of scenes) if (!only || only.split(',').includes(s.name)) await shoot(s)
