#!/usr/bin/env node
/**
 * WallFeed（祈福内容流组件）「版式离线预览 + 实测」（开发工具，**不在 check:admin 里**：需要本机 Chrome）
 *
 * 为什么需要它：产品负责人 2026-09-21 的主诉是「页面下方的祈福的内容流也需要彻底优化」，
 * 而"排版不合理"从来不是"样式规则写错了"，是"画出来挤/断/溢出"—— 静态检查证明不了。
 * 本仓为此吃过多次亏（AGENTS.md：静态分析 ≠ 事实）。
 *
 * ⚠️ 结构**不手抄**：直接解析真 `subpackages/feature/components/WallFeed/index.wxml`，
 * 并**调用组件自己的** `index.js` / `logic.js` 推导出渲染数据（跑真 `_recompute`）。
 * 手抄件会静默漂移：`render-wall-preview.mjs` 的前身就画过一个真源码里根本不存在的元素，
 * 于是"看着没问题"而真机是另一回事（错题本 E3）。这里连"筛选/排序/分页"的推导都走真实现，
 * 所以渲染台量到的就是真组件会画出来的东西。
 *
 * 用法：
 *   CHROME_PATH=/usr/bin/google-chrome node miniprogram/scripts/render-wall-feed-preview.mjs --scene full
 *   … --check                 只跑版式不变量（非 0 = 违反）
 *   … --check --selftest      证明判据真的会红（注入 → 检出 → 还原；真源码全程只读）
 *   … --out /tmp/x.png
 *
 * 场景（--scene）：full（墙上·默认态）/ more（可加载）/ loading（骨架）/ empty（空）/ error（失败）/
 *                moreerror（加载更多失败）/ mine（我的心愿·可管理）/ detail（愿签详情）
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderWxml } from './lib/wxml-preview.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const APP_WXSS = resolve(ROOT, 'miniprogram/app.wxss')
/** 真源码路径（自检**只读**它们；注入一律写 .tmp 副本 —— 见 --selftest 段） */
const REAL_WXSS = resolve(ROOT, 'miniprogram/subpackages/feature/components/WallFeed/index.wxss')
const REAL_WXML = resolve(ROOT, 'miniprogram/subpackages/feature/components/WallFeed/index.wxml')
/**
 * 实际读取的路径 —— 允许用环境变量指向**副本**。
 * 为什么（与 render-wall-preview 同因）：上一代工具的自检是"写进真源码再 finally 还原"，
 * `finally` 挡得住异常、**挡不住 SIGKILL / 超时** —— 实测抓到过 `!important` 覆盖残留在要发版的样式表里。
 * 现在自检写 `.tmp/` 副本，真源码全程一个字节都不被写。
 */
const PAGE_WXSS = process.env.WALLFEED_PREVIEW_WXSS || REAL_WXSS
const PAGE_WXML = process.env.WALLFEED_PREVIEW_WXML || REAL_WXML
const COMPONENT_JS = resolve(ROOT, 'miniprogram/subpackages/feature/components/WallFeed/index.js')
const LOGIC_JS = resolve(ROOT, 'miniprogram/subpackages/feature/components/WallFeed/logic.js')
/** 产物目录（.tmp 被 .gitignore；**必须自建**，否则新 clone / 新 worktree 里直接 ENOENT） */
const TMP_DIR = resolve(ROOT, 'miniprogram/scripts/.tmp')
mkdirSync(TMP_DIR, { recursive: true })

const argv = process.argv.slice(2)
const has = (n) => argv.includes(n)
const argOf = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const SCENES = ['full', 'more', 'loading', 'empty', 'error', 'moreerror', 'mine', 'detail']
const SCENE = (() => {
  const s = argOf('--scene', 'full')
  if (!SCENES.includes(s)) {
    console.error(`✗ 未知场景 ${s}（可用：${SCENES.join(' / ')}）`)
    process.exit(1)
  }
  return s
})()
const OUT = argOf('--out', join(ROOT, 'miniprogram/scripts/.tmp', `wall-feed-preview-${SCENE}.png`))
const CHECK_ONLY = has('--check')

/* ── 0. 判据阈值（都是**量出来的**，不是拍的） ───────────────────────────
 * 视口 750px ↔ 750rpx：1rpx = 1px，与任意真机等比。故下列数字直接就是 rpx。
 */
/** 可点区下限：44pt ≈ 88rpx（真机手指可点中的下限） */
const TAP_MIN = 88
/** 卡片正文的行数上限与高度上限（`.wf-card-text` 的 line-clamp 4 × line-height 1.5 × 30rpx） */
const TEXT_MAX_LINES = 4
const TEXT_MAX_H = 30 * 1.5 * TEXT_MAX_LINES + 4   // +4rpx 容差
/** 骨架卡与真卡的高度差（数据到达时不跳高） */
const SKEL_MAX_DIFF = 60

/* ── 0b. 自检：判据必须能被打红（AGENTS.md：每条守卫都要能证明自己会失败） ──
 * 注入按 `file` 分派：wxss 追加 !important 覆盖，wxml / js 做一次字面替换
 * （替换不到就抛错，避免"注入没生效 = 假绿"）。判定要求错误信息命中预期关键词 ——
 * 只看"非 0 就算过"会把 Chrome 崩溃也算成"检出"。
 */
if (has('--selftest')) {
  const INJECTS = [
    {
      name: 'long-text-uncapped',
      file: 'wxss',
      scene: 'full',
      css: '\n.wf-card-text { -webkit-line-clamp: unset !important; max-height: none !important; overflow: visible !important; }\n',
      expect: '长文案撑破卡片'
    },
    {
      name: 'taparea-tiny',
      file: 'wxss',
      scene: 'detail',
      css: '\n.wf-sheet-close { min-height: 30rpx !important; min-width: 30rpx !important; padding: 0 !important; }\n',
      expect: '可点区'
    },
    {
      name: 'chips-overflow',
      file: 'wxss',
      scene: 'full',
      css: '\n.wf-chips { flex-wrap: nowrap !important; }\n.wf-chip { min-width: 420rpx !important; }\n',
      expect: '溢出'
    },
    {
      name: 'error-falls-to-empty',
      file: 'wxml',
      scene: 'error',
      from: '<view class="wf-error" wx:elif="{{showError}}">',
      to: '<view class="wf-error" wx:elif="{{false}}">',
      expect: '故障被渲染成空态'
    },
    {
      name: 'loadmore-canload-dropped',
      file: 'wxml',
      scene: 'more',
      from: "wx:if=\"{{loadState === 'canload'}}\"",
      to: "wx:if=\"{{false}}\"",
      expect: '可加载'
    },
    {
      name: 'default-sort-changed',
      file: 'js',
      scene: 'full',
      from: "    sort: 'new',",
      to: "    sort: 'old',",
      expect: '默认态'
    }
  ]
  const baseWxss = readFileSync(REAL_WXSS, 'utf8')
  const baseWxml = readFileSync(REAL_WXML, 'utf8')
  const baseJs = readFileSync(COMPONENT_JS, 'utf8')
  let ok = true
  for (const inj of INJECTS) {
    const c1 = join(TMP_DIR, `wallfeed-selftest-${inj.name}.wxss`)
    const c2 = join(TMP_DIR, `wallfeed-selftest-${inj.name}.wxml`)
    const c3 = join(TMP_DIR, `wallfeed-selftest-${inj.name}.js`)
    try {
      let wxss = baseWxss
      let wxml = baseWxml
      let js = baseJs
      if (inj.file === 'wxml') {
        if (!baseWxml.includes(inj.from)) throw new Error(`注入锚点在 WXML 里找不到：${inj.name}`)
        wxml = baseWxml.replace(inj.from, inj.to)
      } else if (inj.file === 'js') {
        if (!baseJs.includes(inj.from)) throw new Error(`注入锚点在 JS 里找不到：${inj.name}`)
        js = baseJs.replace(inj.from, inj.to)
      } else {
        wxss = baseWxss + inj.css
      }
      writeFileSync(c1, wxss)
      writeFileSync(c2, wxml)
      writeFileSync(c3, js)
      const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--check', '--scene', inj.scene || SCENE], {
        encoding: 'utf8',
        env: { ...process.env, WALLFEED_PREVIEW_WXSS: c1, WALLFEED_PREVIEW_WXML: c2, WALLFEED_PREVIEW_JS: c3 }
      })
      const caught = run.status !== 0 && `${run.stderr}\n${run.stdout}`.includes(inj.expect)
      if (!caught) {
        ok = false
        console.error(`✗ selftest「${inj.name}」没被检出（期望红在「${inj.expect}」）—— 判据无效`)
      } else {
        console.log(`  ✓ 注入「${inj.name}」被检出：${inj.expect}`)
      }
    } catch (e) {
      ok = false
      console.error(`✗ selftest「${inj.name}」无法施加：${e.message}`)
    } finally {
      for (const f of [c1, c2, c3]) { try { rmSync(f, { force: true }) } catch { /* ignore */ } }
    }
  }
  // 真源码**只读**：自检全程一个字节都不许被写
  const untouched = readFileSync(REAL_WXSS, 'utf8') === baseWxss &&
    readFileSync(REAL_WXML, 'utf8') === baseWxml &&
    readFileSync(COMPONENT_JS, 'utf8') === baseJs
  if (!untouched) {
    console.error('✗ selftest 改动了真源码：请立刻 git checkout components/WallFeed（自检只许写 .tmp 副本）')
    process.exit(1)
  }
  if (!ok) process.exit(1)
  console.log(`✓ selftest 通过：${INJECTS.length} 个版式/结构注入全部被检出；真源码未被改动（注入只写 .tmp 副本）`)
  process.exit(0)
}

/* ── 1. 真源码的样式（与 render-wall-preview 同口径：先剥注释，再做 rpx→px） ── */
const toCssEarly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(\d*\.?\d+)rpx/g, (_, n) => `${Number(n)}px`)
  .replace(/env\(safe-area-inset-bottom\)/g, '0px')

const appCss = toCssEarly(readFileSync(APP_WXSS, 'utf8'))
const pageVarBlock = (() => {
  const m = /(^|\n)page\s*\{([\s\S]*?)\}/.exec(appCss)
  return m ? m[2] : ''
})()
// token 必须**先做 rpx→px** 再输出：原样写 rpx 进 :root 会让 var() 失效（本仓踩过，量出来全是满宽）
const vars = [...toCssEarly(pageVarBlock).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)]
  .map((m) => `  ${m[1]}: ${m[2].trim()};`)
  .join('\n')
const compCss = toCssEarly(readFileSync(PAGE_WXSS, 'utf8'))

/* ── 2. 载入**真组件**（index.js / logic.js），跑真 _recompute 拿渲染数据 ────
 * `new Function` 而不是 `require`：本仓根 package.json 是 "type": "module"，
 * 而小程序源码是 CJS（`module.exports` / `Component({})`）——直接 require 会炸在加载期。
 * 这里自己解析相对 require（与 test-wish-wall 的 loadCjs 同思路），并顺手支持注入。 */
const INJECT_JS = process.env.WALLFEED_PREVIEW_JS ? resolve(process.env.WALLFEED_PREVIEW_JS) : ''
function makeLoader() {
  const cache = new Map()
  function load(absPath) {
    if (cache.has(absPath)) return cache.get(absPath)
    const mod = { exports: {} }
    cache.set(absPath, mod.exports)
    let src = readFileSync(absPath, 'utf8')
    if (INJECT_JS && absPath === COMPONENT_JS && INJECT_JS !== COMPONENT_JS) {
      src = readFileSync(INJECT_JS, 'utf8')
    }
    const dir = dirname(absPath)
    const localRequire = (id) => {
      if (!String(id).startsWith('.')) throw new Error('不支持的 require：' + id)
      for (const cand of [resolve(dir, id), `${resolve(dir, id)}.js`, resolve(dir, id, 'index.js')]) {
        if (existsSync(cand) && statSync(cand).isFile()) return load(cand)
      }
      throw new Error('require 解析失败：' + id)
    }
    let captured = null
    const Component = (cfg) => { captured = cfg }
    const Behavior = (cfg) => cfg
    const wxStub = new Proxy({}, { get: () => () => {} })
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', 'Component', 'Behavior', 'wx', src)(
      mod, mod.exports, localRequire, Component, Behavior, wxStub
    )
    cache.set(absPath, mod.exports)
    if (captured) mod.exports.__componentConfig = captured
    return mod.exports
  }
  return load
}
const loadCjs = makeLoader()
const logic = loadCjs(LOGIC_JS)
const compMod = loadCjs(COMPONENT_JS)
const compCfg = compMod.__componentConfig
if (!compCfg || !compCfg.methods || typeof compCfg.methods._recompute !== 'function') {
  console.error('✗ 没能从 subpackages/feature/components/WallFeed/index.js 里拿到 Component 配置（_recompute 缺失）')
  process.exit(1)
}
const wish = loadCjs(resolve(ROOT, 'miniprogram/utils/wishWall.js'))

/* ── 3. 样例数据（结构与组件契约对齐；超长文案是**故意**的脏数据） ───────── */
const AVATAR = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
/** 10 字 × 6 = 60 字：**故意超过服务端 30 字上限**，用来证明"脏数据/未来放宽上限也不撑破卡片" */
const LONG_TEXT = '马上有一盏灯为你亮着'.repeat(6)
const WISHES = [
  { _id: 'w1', text: LONG_TEXT, nickname: '蛋炒饭', avatar: AVATAR, timeText: '刚刚' },
  { _id: 'w2', text: '马上有热汤', nickname: '令狐冲大哥', avatar: AVATAR, timeText: '1 天前' },
  { _id: 'w3', text: '马上有回音', nickname: '山客', avatar: AVATAR, timeText: '1 天前', pinned: true },
  { _id: 'w4', text: '马上有归处', nickname: '我', avatar: AVATAR, timeText: '2 天前', isMine: true },
  { _id: 'w5', text: '马上有一封写得很慢的信', nickname: '拾贝人', avatar: AVATAR, timeText: '2 天前' },
  { _id: 'w6', text: '马上有好胃口', nickname: '阿满', avatar: AVATAR, timeText: '3 天前' },
  { _id: 'w7', text: '马上有风', nickname: '匿名藏家', avatar: '', timeText: '3 天前' },
  { _id: 'w8', text: '马上有花看', nickname: '南舟', avatar: AVATAR, timeText: '4 天前', isMine: true }
]
const MINE_ROWS = [
  { _id: 'm1', text: '马上有归处', nickname: '我', avatar: AVATAR, timeText: '2 天前', isMine: true, hidden: false },
  { _id: 'm2', text: '马上有一盏灯为你亮着'.repeat(3), nickname: '我', avatar: AVATAR, timeText: '3 天前', isMine: true, hidden: false },
  { _id: 'm3', text: '马上有花看', nickname: '我', avatar: AVATAR, timeText: '4 天前', isMine: true, hidden: false },
  { _id: 'm4', text: '马上有勇气', nickname: '我', avatar: AVATAR, timeText: '5 天前', isMine: true, hidden: true },
  { _id: 'm5', text: '马上有答案', nickname: '我', avatar: AVATAR, timeText: '6 天前', isMine: true, hidden: true }
]

/** 每个场景：props（页面传的）+ view（组件自己的视图态，模拟用户点过什么） */
const SCENES_PATCH = {
  full: {},
  // ⚠️ 必须显式 hasMore:true：baseProps() 默认 false，组件会（正确地）显示"墙底"行，
  //    于是场景期望的"加载更多按钮"根本不该出现 —— 原判据把这报成组件缺陷，是场景写漏了。
  more: { props: { pageSize: 4, hasMore: true } },
  loading: { props: { items: [], loading: true } },
  empty: { props: { items: [] } },
  error: { props: { items: [], loadError: '网络开小差了，愿签没能读到' } },
  moreerror: { props: { pageSize: 4, loadError: '这一页没加载上，再试一次' } },
  mine: { props: { manageable: true }, view: { viewMode: 'mine' } },
  detail: { view: { detailIndex: 0 } }
}

function baseProps() {
  return {
    items: WISHES,
    mineRows: MINE_ROWS,
    wallCount: WISHES.length,
    mineTotal: MINE_ROWS.length,
    loading: false,
    loadError: '',
    mineLoading: false,
    mineError: '',
    allowed: true,
    hasMore: false,
    manageable: false,
    pageSize: logic.PAGE_SIZE
  }
}

function buildData() {
  const patch = SCENES_PATCH[SCENE] || {}
  const props = Object.assign(baseProps(), patch.props || {})
  const data = JSON.parse(JSON.stringify(compCfg.data))
  Object.assign(data, patch.view || {})
  const inst = {
    properties: props,
    data,
    setData(p) { Object.assign(this.data, p) },
    triggerEvent() {}
  }
  for (const [k, fn] of Object.entries(compCfg.methods)) {
    if (typeof fn === 'function') inst[k] = fn.bind(inst)
  }
  inst._recompute()
  // detail 场景：模拟"点开第一张愿签"（走真 onOpen 的数据形态，但直接落 detail 更稳定）
  if (SCENE === 'detail') {
    const first = WISHES[0]
    inst.setData({ detail: first, detailCount: first.text.length })
  }
  return Object.assign({}, inst.properties, inst.data)
}

const data = buildData()

/* ── 3b. 样例数据必须覆盖 WXML 引用的每个根标识符（少一个 = 预览静默少画一块） ── */
function assertSampleCovers(wxml, scope) {
  const idents = new Set()
  for (const m of wxml.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    const stripped = m[1].replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
    for (const t of stripped.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)/g)) {
      if (['true', 'false', 'null', 'undefined', 'item', 'index', 'col', 'ci'].includes(t[2])) continue
      idents.add(t[2])
    }
  }
  const missing = [...idents].filter((k) => !(k in scope))
  if (missing.length) {
    console.error(`✗ 样例数据缺字段：${missing.join(', ')} —— 预览会少画内容，先去补 baseProps()/baseData()`)
    process.exit(1)
  }
}

const wxmlSrc = readFileSync(PAGE_WXML, 'utf8')
assertSampleCovers(wxmlSrc, data)

/* ── 3c. 「默认态与现状一致」的期望值：**用真 splitTagColumns** 现算 ─────────
 * 判据不是"我写死一个顺序比对"，而是"默认态的分列 === 改造前页面用的那个函数的结果"。 */
const DEFAULT_COLUMNS = wish.splitTagColumns(WISHES, logic.COLUMNS)
const EXPECT_FIRST_TEXT = WISHES[0].text

const markup = renderWxml(wxmlSrc, data)

/* ── 4. 组装 HTML ─────────────────────────────────────────────────────── */
const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root {
${vars}
}
html, body { margin: 0; padding: 0; }
body { background: var(--color-bg, #14120F); color: var(--color-text-body); font-family: var(--font-body); }
page, .page-root { display: block; }
img { display: block; object-fit: cover; }
/* 还原页面环境：组件**不带左右内边距**，沿用页面 .ww-page 的 --space-4（32rpx） */
.page-root { padding: 0 32px; }
${compCss}
/* 预览专用：不做动画（否则量到的是动画中间态）。
   副作用：靠 animation-fill-mode 从 opacity:0 入场的元素会停在 0 —— 本组件没有这种入场，故不需补终态。 */
* { animation: none !important; transition: none !important; }
</style></head>
<body><div class="page-root">${markup}</div></body></html>`

/* ── 5. 无头 Chrome：一次 --dump-dom 量几何，一次 --screenshot 出图 ────────
   本沙箱里 CDP 的 WebSocket 能连上但 Page.enable 永不回（同机 --screenshot 却正常），
   故用 Chrome 自带的 --dump-dom / --screenshot 两个开关，零依赖、零 CDP。 */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean)
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chromePath) {
  console.error('✗ 未找到 Chrome（可用 CHROME_PATH 指定）—— 本工具只做预览，不参与 check:admin')
  process.exit(1)
}

/* 量的清单：[标签, 选择器, 行数上限?, 模式?]
 *   mode 'same-row' = 子元素必须同一行；mode 'lines' = 按行数上限判 */
const METRICS = [
  ['组件根 .wf', '.wf'],
  ['分段控件 .wf-seg', '.wf-seg', 0, 'same-row'],
  ['分段·墙上', '.wf-seg-item:nth-child(1)', 1],
  ['分段·我的心愿', '.wf-seg-item:nth-child(2)', 1],
  ['筛选行 .wf-chips', '.wf-chips', 1, 'same-row'],
  ['筛选 chip 1', '.wf-chip:nth-child(1)', 1],
  ['排序行 .wf-sorts', '.wf-sorts', 1, 'same-row'],
  // ⚠️ 不可用 `.wf-sort:nth-child(1)`：第一子节点是 `.wf-sort-lead`，该选择器恒空（假缺失）。
  ['排序 chip 1', '.wf-sorts .wf-sort', 1],
  ['两列瀑布 .wf-cols', '.wf-cols'],
  ['列1 .wf-col', '.wf-col:nth-child(1)'],
  ['列2 .wf-col', '.wf-col:nth-child(2)'],
  ['长文案卡（列1首张）', '.wf-col:nth-child(1) .wf-card:nth-child(1)'],
  ['长文案正文', '.wf-col:nth-child(1) .wf-card:nth-child(1) .wf-card-text', 4],
  ['短文案卡（列2首张）', '.wf-col:nth-child(2) .wf-card:nth-child(1)'],
  ['短文案正文', '.wf-col:nth-child(2) .wf-card:nth-child(1) .wf-card-text', 4],
  ['卡脚 .wf-card-foot', '.wf-card-foot', 1, 'same-row'],
  ['卡内印记 .wf-card-seal', '.wf-card-seal', 1],
  ['我的卡管理行', '.wf-card-acts', 0, 'same-row'],
  ['管理动作 .wf-act', '.wf-act', 1],
  ['加载更多行 .wf-more', '.wf-more', 1],
  ['加载更多按钮', '.wf-more-btn', 1],
  ['加载中提示 .wf-more-loading', '.wf-more-loading', 1],
  ['墙底收尾 .wf-more-end', '.wf-more-end', 0, 'same-row'],
  ['骨架卡 .wf-skel', '.wf-skel'],
  ['错误块 .wf-error', '.wf-error'],
  ['错误文案 .wf-error-text', '.wf-error-text', 3],
  ['错误重试 .wf-error-retry', '.wf-error-retry', 1],
  ['加载更多重试 .wf-more-retry', '.wf-more-retry', 1],
  ['空文案 .wf-empty', '.wf-empty', 1],
  ['详情遮罩 .wf-mask', '.wf-mask'],
  ['详情笺 .wf-sheet', '.wf-sheet'],
  ['详情关闭 .wf-sheet-close', '.wf-sheet-close', 1],
  ['详情正文 .wf-sheet-text', '.wf-sheet-text'],
  ['详情 meta .wf-sheet-meta', '.wf-sheet-meta', 1, 'same-row'],
  ['详情动作行 .wf-sheet-acts', '.wf-sheet-acts', 0, 'same-row']
]

/** 场景 → 必须存在的选择器（其余缺失 = 该场景本来就不该有，不算问题） */
const MUST = {
  full: ['.wf-seg', '.wf-chips', '.wf-sorts', '.wf-cols', '.wf-card', '.wf-card-text', '.wf-more', '.wf-more-end'],
  more: ['.wf-cols', '.wf-card', '.wf-more', '.wf-more-btn'],
  loading: ['.wf-cols', '.wf-skel'],
  empty: ['.wf-empty'],
  error: ['.wf-error', '.wf-error-retry'],
  moreerror: ['.wf-cols', '.wf-card', '.wf-more', '.wf-more-retry'],
  mine: ['.wf-cols', '.wf-card', '.wf-card-acts', '.wf-act'],
  detail: ['.wf-mask', '.wf-sheet', '.wf-sheet-close', '.wf-sheet-text', '.wf-sheet-acts']
}
/** 场景 → 必须**不存在**的选择器（负向判据：三态互斥 / 不许把故障说成空） */
const ABSENT = {
  full: ['.wf-error', '.wf-empty'],
  more: ['.wf-error', '.wf-empty', '.wf-more-end'],
  loading: ['.wf-empty', '.wf-error', '.wf-card'],
  empty: ['.wf-error', '.wf-card', '.wf-more-btn'],
  error: ['.wf-empty', '.wf-card'],
  moreerror: ['.wf-empty', '.wf-error', '.wf-more-end'],
  mine: ['.wf-empty'],
  detail: []
}
/** 可点区（≥88rpx）逐条钉住：这些元素都必须 h≥88 且 w≥88 */
const TAP_TARGETS = ['.wf-seg-item', '.wf-chip', '.wf-sort', '.wf-card', '.wf-act', '.wf-more-btn', '.wf-error-retry', '.wf-more-retry', '.wf-sheet-close', '.wf-sheet-act']

// MUST/ABSENT 里出现的**全部**裸选择器 —— 注入页面做存在性探测（见页内注释）
const EXIST_SELECTORS = Array.from(new Set(
  Object.values(MUST).flat().concat(Object.values(ABSENT).flat())
)).sort()

const MEASURE_JS = `
<script>
const __SCENE__ = ${JSON.stringify(SCENE)};
const __EXIST_SELECTORS__ = ${JSON.stringify(EXIST_SELECTORS)};
const __METRICS__ = ${JSON.stringify(METRICS)};
const __TAP__ = ${JSON.stringify(TAP_TARGETS)};
window.addEventListener('load', () => {
  const out = []
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
  /* 视觉行数。
   * ⚠️ 2026-09-22 集成官修：原实现是 Range.getClientRects().length —— 它返回的是
   * **内联盒子**的矩形，**不是视觉行数**：一行里放两个 <text>（比如「墙上的愿签」+ 角标 8）
   * 就会被算成 2 行；分段控件（4 个内联盒子）被算成 **4 行**。
   * 于是渲染台对着**正确的一行排版**报「折成 4 行（上限 1）」—— 工具在说谎，
   * 而它比真缺陷更危险：会把人骗去改本来没坏的样式（本仓已栽过同类一次）。
   * 正确做法：把矩形**按 top 聚类**（同一行内的盒子 top 几乎相同），聚出的类数才是行数。 */
  const lineCount = (el) => {
    const r = document.createRange()
    r.selectNodeContents(el)
    // 只数**可见框内**的行：被 -webkit-line-clamp 夹掉的行仍然有矩形（在框下方），
    // 不加这一刀就会把"4 行截断"报成「折成 7 行」（本判据第二次说谎的形态）。
    const boxBottom = el.getBoundingClientRect().bottom
    const all = Array.from(r.getClientRects()).filter((x) => x.height > 1 && x.width > 0)
    // 只保留**最内层**矩形：Range 会同时给出"子元素盒子"和"子元素里的文字"两层，
    // 而它们 top 相差可达几十像素（子盒子满高、文字居中）→ 会被聚成两行。
    // （.wf-more 报 2 行、它的子元素 .wf-more-end 却报 1 行，就是这个嵌套造成的。）
    const inner = all.filter((x) => !all.some((o) => o !== x &&
      o.left >= x.left - 1 && o.right <= x.right + 1 && o.top >= x.top - 1 && o.bottom <= x.bottom + 1))
    const rects = (inner.length ? inner : all).filter((x) => x.top < boxBottom - 1)
    if (!rects.length) return 0
    const cs = getComputedStyle(el)
    const lh = parseFloat(cs.lineHeight) || 0
    // 容差：优先行高的一半；flex 容器常见 line-height: normal（→ parseFloat 得 NaN），
    // 这时退回**字号** —— 原来硬编码 6px，会把同一行里 top 差 11px 的两个盒子（分隔线 + 文字）
    // 拆成两行（.wf-more 被误报「折成 2 行」就是这么来的）。
    const fs = parseFloat(cs.fontSize) || 0
    const tol = lh > 1 ? lh / 2 : Math.max(8, fs * 0.75)
    const tops = []
    rects.map((x) => x.top).sort((a, b) => a - b).forEach((t) => {
      if (!tops.length || t - tops[tops.length - 1] > tol) tops.push(t)
    })
    return tops.length
  }
  const kidsSameRow = (el) => {
    const kids = Array.from(el.children).filter((k) => k.getBoundingClientRect().height > 1)
    if (kids.length < 2) return true
    const top = Math.max(...kids.map((k) => k.getBoundingClientRect().top))
    const bottom = Math.min(...kids.map((k) => k.getBoundingClientRect().bottom))
    return bottom - top > 1
  }
  const idxOf = new Map()
  Array.from(document.querySelectorAll('*')).forEach((el, i) => idxOf.set(el, i))
  const push = (label, sel, maxLines, mode) => {
    const el = document.querySelector(sel)
    if (!el) { out.push({ label, missing: true, sel }); return }
    const cs = getComputedStyle(el)
    out.push(Object.assign({ label, sel }, rect(el), {
      lines: lineCount(el),
      // 裁切容器的 scrollHeight 才是"内容到底多高"；与 clientHeight 的差 = 真的被截掉了多少
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
      lineHeight: Math.round(parseFloat(cs.lineHeight) || 0),
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      clips: cs.overflowX === 'hidden',
      overflowX: cs.overflowX !== 'hidden' && el.scrollWidth > el.clientWidth + 1,
      maxLines: maxLines || 0,
      mode: mode || 'lines',
      sameRow: kidsSameRow(el),
      wrap: cs.flexWrap,
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 24)
    }))
  }
  const el = (s) => document.querySelector(s)
  out.push({ label: '视口', sel: ':window', x: 0, y: 0, w: innerWidth, h: innerHeight, lines: 0, text: innerWidth + 'x' + innerHeight })
  const br = document.body.getBoundingClientRect()
  out.push({ label: '整页 body', sel: 'body', x: 0, y: 0, w: Math.round(br.width), h: Math.round(br.height),
    lines: 0, maxLines: 0, mode: 'lines', scrollW: document.body.scrollWidth, clientW: document.body.clientWidth,
    overflowX: false, clips: false, sameRow: true, text: '' })
  __METRICS__.forEach((m) => push(m[0], m[1], m[2], m[3]))

  // ── 可点区：逐条量 box（静态样式表里"看"不出——min-height 与 padding 分散在多处） ──
  const taps = []
  __TAP__.forEach((sel) => {
    const e = el(sel)
    if (!e) { taps.push({ sel, missing: true }); return }
    const r = e.getBoundingClientRect()
    taps.push({ sel, w: Math.round(r.width), h: Math.round(r.height), ok: r.height >= 88 && r.width >= 88 })
  })
  out.push({ label: '可点区 ≥88rpx', sel: ':taps', mode: 'taps', lines: 0, maxLines: 0, x: 0, y: 0, w: 0, h: 0, taps,
    text: taps.filter((t) => !t.missing).map((t) => t.sel + ' ' + t.w + 'x' + t.h).join(' / ') })

  // ── 三态互斥（真渲染的正/负判据，不是读源码字符串） ──
  out.push({ label: '三态存在性', sel: ':tristate', mode: 'tristate', lines: 0, maxLines: 0, x: 0, y: 0, w: 0, h: 0,
    hasError: !!el('.wf-error'), hasEmpty: !!el('.wf-empty'), hasSkel: !!el('.wf-skel'), hasCards: !!el('.wf-card'),
    text: 'error=' + !!el('.wf-error') + ' empty=' + !!el('.wf-empty') + ' skel=' + !!el('.wf-skel') + ' cards=' + !!el('.wf-card') })

  // ── 两列等宽（瀑布对齐） ──
  const c1 = el('.wf-col:nth-child(1)'), c2 = el('.wf-col:nth-child(2)')
  if (c1 && c2) {
    const w1 = Math.round(c1.getBoundingClientRect().width), w2 = Math.round(c2.getBoundingClientRect().width)
    out.push({ label: '两列等宽', sel: ':cols', mode: 'cols', lines: 0, maxLines: 0, x: 0, y: 0, w: w1, h: 0,
      w1, w2, delta: Math.abs(w1 - w2), text: w1 + ' / ' + w2 })
  }
  // ── 列表首项是不是"服务端第一项"（默认态：不重排） ──
  const firstText = el('.wf-col:nth-child(1) .wf-card:nth-child(1) .wf-card-text')
  if (firstText) {
    out.push({ label: '首项正文', sel: ':first', mode: 'first', lines: 0, maxLines: 0, x: 0, y: 0, w: 0, h: 0,
      // 与 push() 同口径截 24 字：判据那边比的是 EXPECT_FIRST_TEXT.slice(0,24)，
      // 这里给全文就永远不相等（原判据因此恒红，是**判据自身的 bug**）
      text: (firstText.textContent || '').trim().slice(0, 24) })
  }
  // 存在性：MUST/ABSENT 用的是**裸选择器**（.wf-card / .wf-more-btn …），
  // 而 METRICS 里只有带作用域的（.wf-col:nth-child(1) .wf-card:nth-child(1)）——
  // 原来的实现拿 metrics 去匹配 sel === '.wf-card'，**永远匹配不到** ⇒ 判据恒红（假失败）。
  // 现在由 Node 侧把全集传进来，这里逐个 querySelector 探一遍。
  const exists = {}
  ;(__EXIST_SELECTORS__ || []).forEach((sel) => { exists[sel] = !!document.querySelector(sel) })
  out.push({ label: '存在性', sel: ':exists', mode: 'exists', lines: 0, maxLines: 0, x: 0, y: 0, w: 0, h: 0, exists })

  const pre = document.createElement('pre')
  pre.id = 'wallfeed-metrics'
  pre.textContent = JSON.stringify(out)
  document.body.appendChild(pre)
})
</script>`

const htmlPath = join(ROOT, 'miniprogram/scripts/.tmp', `wall-feed-preview-${SCENE}.html`)
writeFileSync(htmlPath, html.replace('</body>', `${MEASURE_JS}</body>`))

function runChrome(args, timeoutMs = 30000) {
  return new Promise((resolvePromise) => {
    const profile = mkdtempSync(join(tmpdir(), 'sc-wallfeed-preview-'))
    const child = spawn(chromePath, [
      '--headless=new', '--disable-gpu', '--no-sandbox',
      '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${profile}`, '--hide-scrollbars',
      '--force-device-scale-factor=1', '--virtual-time-budget=2000',
      ...args
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* ignore */ } }, timeoutMs)
    child.on('close', () => {
      clearTimeout(timer)
      try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
      resolvePromise(out)
    })
  })
}

const dom = await runChrome(['--window-size=750,1334', '--dump-dom', `file://${htmlPath}`])
const m = /<pre id="wallfeed-metrics">([\s\S]*?)<\/pre>/.exec(dom)
if (!m) {
  console.error('✗ 没拿到量测结果（--dump-dom 里找不到 #wallfeed-metrics）—— Chrome 可能被沙箱拦了')
  process.exit(1)
}
const metrics = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
const byLabel = (l) => metrics.find((x) => x.label === l)

/* ── 6. 判据 ──────────────────────────────────────────────────────────── */
const problems = []
const advisories = []
const must = MUST[SCENE] || []
const absent = ABSENT[SCENE] || []

const existsRow = metrics.find((r) => r.sel === ':exists')
const existsMap = (existsRow && existsRow.exists) || {}
for (const sel of must) {
  if (!existsMap[sel]) problems.push(`${SCENE} 场景必须有的元素没渲染出来：${sel}（判据失效 = 假通过）`)
}
for (const sel of absent) {
  if (existsMap[sel]) problems.push(`${SCENE} 场景不该出现的元素渲染出来了：${sel}`)
}

metrics.forEach((row) => {
  if (row.missing) return
  if (row.overflowX) problems.push(`${row.label}：横向溢出（scrollW ${row.scrollW} > clientW ${row.clientW}）`)
  if (row.mode === 'same-row' && !row.sameRow) problems.push(`${row.label}：子元素折行了（本该同一行）`)
  if (row.mode === 'lines' && row.maxLines && row.lines > row.maxLines) {
    problems.push(`${row.label}：折成 ${row.lines} 行（上限 ${row.maxLines}）`)
  }
})

// ① 长文案不撑破卡片 / 有截断（几何判据，不看样式表里有没有写 line-clamp）
if (SCENE === 'full' || SCENE === 'more' || SCENE === 'moreerror' || SCENE === 'detail') {
  const t = byLabel('长文案正文')
  const card = byLabel('长文案卡（列1首张）')
  if (!t || t.missing) {
    problems.push('没量到长文案正文（判据失效 = 假通过）')
  } else {
    const lines = t.lineHeight ? Math.round(t.clientH / t.lineHeight) : t.lines
    if (lines > TEXT_MAX_LINES) problems.push(`长文案撑破卡片：正文占 ${lines} 行 > 上限 ${TEXT_MAX_LINES} 行（clientH ${t.clientH} / lineHeight ${t.lineHeight}）`)
    if (t.clientH > TEXT_MAX_H) problems.push(`长文案撑破卡片：正文高 ${t.clientH}rpx > 上限 ${TEXT_MAX_H}rpx`)
    if (!(t.scrollH > t.clientH)) {
      problems.push(`长文案没有被截断（scrollH ${t.scrollH} ≤ clientH ${t.clientH}）—— 样例文案没超过 4 行，判据空转`)
    }
    if (card && !card.missing && card.h > 360) problems.push(`长文案卡片高 ${card.h}rpx > 360rpx（正文没被夹住）`)
  }
  // 负向对照：短文案**不该**被截
  const s = byLabel('短文案正文')
  if (s && !s.missing && s.scrollH > s.clientH + 1) problems.push(`短文案也被截了（scrollH ${s.scrollH} > clientH ${s.clientH}）—— 夹得太狠`)
}

// ② 可点区 ≥88rpx（逐条；缺失的选择器在本场景合法时不判）
{
  const row = byLabel('可点区 ≥88rpx')
  if (!row || row.mode !== 'taps' || !row.taps || !row.taps.length) {
    problems.push('没量到可点区（判据失效 = 假通过）')
  } else {
    row.taps.filter((t) => !t.missing && !t.ok).forEach((t) => {
      problems.push(`可点区不足 ${TAP_MIN}rpx：${t.sel} ${t.w}x${t.h}`)
    })
    // 判据不能空转：本场景至少要量到 2 个可点元素
    if (row.taps.filter((t) => !t.missing).length < 2) problems.push('可点区判据空转（有效元素 < 2）')
  }
}

// ③ 三态互斥：故障不许被渲染成空态；空文案不许在失败/加载时出现
{
  const t = byLabel('三态存在性')
  if (!t) problems.push('没量到三态存在性（判据失效 = 假通过）')
  else if (t.hasError && t.hasEmpty) problems.push('故障被渲染成空态：.wf-error 与 .wf-empty 同时出现')
  else if (SCENE === 'error' && !t.hasError) problems.push('故障被渲染成空态：error 场景没有 .wf-error')
  else if (SCENE === 'loading' && (t.hasEmpty || t.hasError)) problems.push('加载态被渲染成空态或错误态')
  else if (SCENE === 'empty' && !t.hasEmpty) problems.push('确认成功且为空时没有空文案')
}

// ④ 加载更多状态机：每个场景必须命中**它该有的那一态**，且不许同时出现两态
if (SCENE === 'more') {
  if (!byLabel('加载更多按钮') || byLabel('加载更多按钮').missing) problems.push('可加载态没有「加载更多」按钮')
}
if (SCENE === 'loading') {
  if (!byLabel('骨架卡 .wf-skel') || byLabel('骨架卡 .wf-skel').missing) problems.push('加载态没有骨架')
}
if (SCENE === 'full') {
  if (!byLabel('墙底收尾 .wf-more-end') || byLabel('墙底收尾 .wf-more-end').missing) problems.push('没有更多态没有「已到墙底」收尾')
  if (byLabel('加载更多按钮') && !byLabel('加载更多按钮').missing) problems.push('没有更多态却渲染了「加载更多」按钮')
}
if (SCENE === 'moreerror') {
  if (!byLabel('加载更多重试 .wf-more-retry') || byLabel('加载更多重试 .wf-more-retry').missing) problems.push('加载更多失败态没有重试入口')
  if ((byLabel('长文案卡（列1首张）') || {}).missing) problems.push('加载更多失败时已有内容被抹掉了（卡片应当还在）')
}

// ⑤ 默认态与现状一致：列内容 === 改造前用的 splitTagColumns(items, 2)
if (SCENE === 'full') {
  const cols = (data.columns || []).map((c) => c.map((r) => r._id))
  const want = DEFAULT_COLUMNS.map((c) => c.map((r) => r._id))
  if (JSON.stringify(cols) !== JSON.stringify(want)) {
    problems.push(`默认态与现状不一致：列内容 ${JSON.stringify(cols)} ≠ splitTagColumns(items,2) ${JSON.stringify(want)}`)
  }
  const first = byLabel('首项正文')
  if (!first || first.text !== EXPECT_FIRST_TEXT.slice(0, 24)) {
    problems.push(`默认态首项不是服务端第一项（量到「${first ? first.text : '无'}」）`)
  }
}

// ⑥ 两列等宽 —— 只在**该场景本来就有两列**时判：
//    骨架/空/失败态没有 .wf-cols，原来无条件要求"必须量到两列宽度"⇒ 恒红（判据作用域错）。
{
  const hasCols = !!existsMap['.wf-cols']
  const c = byLabel('两列等宽')
  if (hasCols) {
    if (!c || c.missing) problems.push('没量到两列宽度（判据失效 = 假通过）')
    else if (c.delta > 2) problems.push(`两列不等宽：${c.w1} vs ${c.w2}`)
  }
}

// ⑦ 骨架不跳高（骨架卡与真卡同量级）
if (SCENE === 'loading') {
  const sk = byLabel('骨架卡 .wf-skel')
  if (!sk || sk.missing) problems.push('没量到骨架卡')
  else {
    const real = 196 // 真卡（2 行正文）在 686rpx 容器下的实测高度，见 full 场景输出
    const diff = Math.abs(sk.h - real)
    if (diff > SKEL_MAX_DIFF) advisories.push(`骨架卡 ${sk.h}rpx 与真卡 ${real}rpx 差 ${diff}rpx（> ${SKEL_MAX_DIFF}）—— 数据到达时会跳高`)
  }
}

// ⑧ 详情层：明确的层级 + 关闭方式 + 正文不截断
if (SCENE === 'detail') {
  const mask = byLabel('详情遮罩 .wf-mask')
  const sheet = byLabel('详情笺 .wf-sheet')
  if (mask && sheet && !mask.missing && !sheet.missing) {
    if (mask.y > sheet.y) problems.push('详情遮罩没有盖住整个视口（遮罩顶边低于笺顶边）')
  }
  const txt = byLabel('详情正文 .wf-sheet-text')
  if (txt && !txt.missing && txt.scrollH > txt.clientH + 1) problems.push('详情正文被截断了（详情层应当是完整正文）')
}

/* ── 7. 出图 ──────────────────────────────────────────────────────────── */
if (!CHECK_ONLY) {
  const pngPath = join(ROOT, 'miniprogram/scripts/.tmp', `wall-feed-preview-${SCENE}.png`)
  try { rmSync(pngPath, { force: true }) } catch { /* ignore */ }
  const bodyH = (byLabel('整页 body') || {}).h || 1334
  await runChrome([`--window-size=750,${Math.min(8000, bodyH + 40)}`, `--screenshot=${pngPath}`, `file://${htmlPath}`])
  if (existsSync(pngPath)) {
    writeFileSync(OUT, readFileSync(pngPath))
    console.log(`\n截图：${OUT}（${Math.round(statSync(OUT).size / 1024)}KB）`)
  } else {
    console.error('\n✗ 截图未生成')
  }
}

if (advisories.length) {
  console.log('\n⚠ 参考项（不红：字体度量差异 / 产品取舍，需真机或产品确认）：')
  advisories.forEach((a) => console.log('  - ' + a))
}
const show = (row) => {
  if (row.missing) return `  ✗ ${String(row.label).padEnd(26)} 未渲染（${row.sel}）`
  if (row.mode === 'taps') return `  · ${String(row.label).padEnd(26)} ${row.taps.filter((t) => !t.missing).map((t) => t.sel + ' ' + t.w + 'x' + t.h).join(' / ')}`
  if (row.mode === 'tristate') return `  · ${String(row.label).padEnd(26)} ${row.text}`
  if (row.mode === 'cols' || row.mode === 'first') return `  · ${String(row.label).padEnd(26)} ${row.text}`
  return `  · ${String(row.label).padEnd(26)} y${String(row.y).padStart(4)} ${String(row.w).padStart(4)}x${String(row.h).padStart(4)}  行 ${row.lines}  ${row.text}`
}
console.log(`WallFeed 版式预览（场景 ${SCENE}；视口 750px ↔ 750rpx，等比于任意真机宽度）`)
metrics.forEach((row) => console.log(show(row)))

if (problems.length) {
  console.error(`\n✗ 版式不变量违反 ${problems.length} 处：`)
  problems.forEach((p) => console.error('  - ' + p))
  process.exit(1)
}
console.log(`\n✓ 版式不变量通过（宽度 / 换行 / 溢出 / 同组同行 / 三态互斥 / 长文案截断 / 可点区 ≥${TAP_MIN}rpx / 加载更多四态 / 默认态一致 / 两列等宽；字体度量与安全区仍需真机确认）`)
