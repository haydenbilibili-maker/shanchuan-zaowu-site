#!/usr/bin/env node
/**
 * 祈福墙「版式离线预览 + 实测」（开发工具，**不在 check:admin 里**：需要本机 Chrome）
 *
 * 为什么需要它：这一页的版式问题从来不是"样式规则写错了"，而是"画出来挤/断/溢出"——
 * 静态检查证明不了。本仓为此吃过多次亏（AGENTS.md：静态分析 ≠ 事实），而真机截图要等人给。
 * 本工具用**真源码的 WXSS**（app.wxss 的 token + 页面 wxss，rpx 按 1:1 当 px）渲染一份 HTML，
 * 用无头 Chrome 量出**真实 DOM 的几何与换行**，并截图给人看。
 *
 * rpx 的等比性质：1rpx = 屏宽/750 px，所以「视口 750px、1rpx=1px」与任何真机等比 ——
 * 宽度、换行、间距都能据此判断；但**字体度量、安全区、真机字体替换**无法等价，
 * 所以本工具的输出是"改版式前的第一道网"，**不能替代真机验收**。
 *
 * ⚠️ 2026-09-20 重写（重要）：结构**不再手抄**，改为直接解析真 `index.wxml`（见 `lib/wxml-preview.mjs`）。
 * 原因是手抄件已经**静默漂移**过：预览里画着 `.ww-play-mark`（玩法瓦片上的「签/饼/座/我」字标），
 * 真源码里根本没有它；还把发送条摆在了玩法区之后（真源码在弹幕墙正下方），
 * 于是工具报出两条「发送条没有吸底」的**假失败**。凡是"读的是镜像、不是真源"的判据，
 * 都会以这种方式骗人（错题本 E3）。
 *
 * 用法：
 *   node miniprogram/scripts/render-wall-preview.mjs                    # 量 + 截图（默认场景 full）
 *   node miniprogram/scripts/render-wall-preview.mjs --scene sheet       # 纸签弹层展开态
 *   node miniprogram/scripts/render-wall-preview.mjs --check             # 只跑版式不变量（非 0 = 违反）
 *   node miniprogram/scripts/render-wall-preview.mjs --check --selftest  # 证明判据真的会红（注入 → 检出 → 还原）
 *   node miniprogram/scripts/render-wall-preview.mjs --out /tmp/x.png
 *
 * 场景（--scene）：full（默认）整页原样 / lit 已点灯 / sheet 纸签弹层 / sheet-loading 弹层（推荐取件中）/
 *                loading 骨架 / error 加载失败 / closed 开关关
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
/** 真源码路径（自检**只读**它们，见下面的 --selftest） */
const REAL_WXSS = resolve(ROOT, 'miniprogram/subpackages/feature/wish-wall/index.wxss')
const REAL_WXML = resolve(ROOT, 'miniprogram/subpackages/feature/wish-wall/index.wxml')
/**
 * 实际读取的路径 —— 允许用环境变量指向**副本**。
 * 为什么需要这个开关（2026-09-20，子代理静态扫描时抓到的事故）：
 * 自检原本是"把注入写进**真源码** → 跑 → finally 还原"的形态。`finally` 挡得住异常，
 * **挡不住 SIGKILL / 超时**：扫描那一刻正好看到 `index.wxss` 末尾残留着
 * `.ww-wall { height: 900px !important; }`（自检注入串逐字相同）——
 * 一个 `!important` 覆盖留在要发版的样式表里，是这一页最危险的一类残留。
 * 现在自检把注入写进 `.tmp/` 下的**副本**，再让子进程通过环境变量读副本：
 * 真源码在自检全程一个字节都不被写。顺带让自检可以被并行跑。
 */
const PAGE_WXSS = process.env.WALL_PREVIEW_WXSS || REAL_WXSS
const PAGE_WXML = process.env.WALL_PREVIEW_WXML || REAL_WXML
/** 产物目录（scripts/.tmp 被 .gitignore；**必须自建**，否则新 clone / 新 worktree 里直接 ENOENT） */
const TMP_DIR = resolve(ROOT, 'miniprogram/scripts/.tmp')
mkdirSync(TMP_DIR, { recursive: true })

const argv = process.argv.slice(2)
const has = (n) => argv.includes(n)
const argOf = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const SCENES = ['full', 'lit', 'ember', 'sheet', 'sheet-loading', 'loading', 'error', 'closed']
const SCENE = (() => {
  const s = argOf('--scene', 'full')
  const alias = { plays: 'sheet' }[s] || s
  if (!SCENES.includes(alias)) {
    console.error(`✗ 未知场景 ${s}（可用：${SCENES.join(' / ')}）`)
    process.exit(1)
  }
  return alias
})()
const OUT = argOf('--out', join(ROOT, 'miniprogram/scripts/.tmp', `wall-preview-${SCENE}.png`))
const CHECK_ONLY = has('--check')

/* ── 0. 版式判据的阈值（都是**量出来的**，不是拍的） ──────────────────────
 * 需求 7 §3 要求把"位置 / 大小"变成**可量、可打红**的判据，例：牌匾不超 X% 屏高、
 * 玩法区一屏内可见 N 个。这两条此前缺失：元素各自"不溢出、不折行"，合起来却可能
 * 把玩法区整个顶出第一屏 —— 静态断言看不出来（错题本 E8）。
 *
 * 基线（2026-09-20 实量）：`--window-size=750,1334` 下 headless 的**实际可视高是 1191px**
 * （不是 1334 —— 本工具文档一直没写清这点，判据的分母因此不能写死），与 iPhone 8/SE2 的
 * 可用高（667pt − 20 状态栏 − 44 导航 ≈ 603pt ≈ 1206rpx）同量级；1rpx = 1px 等比，
 * 所以宽度 / 换行 / 占比对任意真机宽度成立。
 */
/** 页头「牌匾」占首屏高的上限：它是身份标识，不是内容，不许把弹幕墙顶下去 */
const HERO_MAX_SHARE = 0.22
/** 首屏内必须**看得到**（顶边在折叠线之上）的玩法瓦片数（2 列 × 1 排 = 2） */
const FOLD_MIN_TILES = 2

/* ── 0b. 自检：判据必须能被打红（AGENTS.md：每条守卫都要能证明自己会失败） ──
 * 注入按 `file` 分派：`wxss` 追加到样式末尾用 !important 覆盖，`wxml` 做一次字面替换
 * （替换不到就抛错，避免"注入没生效 = 假绿"）。
 *
 * ⚠️ 2026-09-20 重写（**上一版有真实事故**）：原实现把注入写进**真源码**再 `finally` 还原。
 * `finally` 挡得住异常，**挡不住 SIGKILL / 超时** —— 一个子代理在静态扫描时正好抓到
 * `index.wxss` 末尾残留 `.ww-wall { height: 900px !important; }`（与本文件 `wall-inflated`
 * 注入串逐字相同）。那是一个 `!important` 覆盖留在**要发版的样式表**里：真机上整面弹幕墙被
 * 强制定高 900px，而这个错误任何单测都看不见。
 * 现在：注入写进 `scripts/.tmp/selftest-*` 的**副本**，子进程用环境变量读副本 →
 * **真源码在自检全程一个字节都不被写**（末尾会断言这一点），顺带让自检可并行。
 *
 * 判定要求**错误信息命中预期关键词**（不是"非 0 就算过"）：Chrome 崩溃也会非 0，
 * 那种"自检通过"是假的。
 */
if (has('--selftest')) {
  const INJECTS = [
    { name: 'hero-tall', file: 'wxss', css: '\n.ww-hero { height: 420px !important; }\n', expect: '牌匾占首屏' },
    { name: 'wall-inflated', file: 'wxss', css: '\n.ww-wall { height: 900px !important; }\n', expect: '首屏内看得到的玩法瓦片' },
    { name: 'inspo-detached', file: 'wxss', css: '\n.ww-inspo { margin-top: 900px !important; }\n', expect: '灵感词与发送条不在同一屏' },
    {
      // 发送条改回吸底却不留底部余量 → 最后一张愿签会被盖住（旧 sticky-bar 判据的等价物，
      // 2026-09-20 重写成"按当前设计分支"的形态，见下面 5b）
      name: 'composer-fixed-without-reserve',
      file: 'wxss',
      scene: 'full',
      css: '\n.ww-composer { position: fixed !important; left: 0; right: 0; bottom: 0; z-index: 30; background: var(--color-bg) !important; }\n',
      expect: '发送条改回吸底但没有底部预留'
    },
    {
      // 某颗余烬改回离群色（粉）→ 必须检出"颜色不在铜色系"
      name: 'ember-off-palette',
      file: 'wxss',
      scene: 'ember',
      css: '\n.ww-heart.h3 { color: #E0A9A0 !important; }\n',
      expect: '点灯余烬不合格'
    },
    {
      // 连续天数盒改回**浮层**（回到本轮修掉的那个形态）→ 必须检出"压字"。
      // ⚠️ 第一次写的注入是"把徽章加宽"，但设计已改成静态行，加宽不再压任何字 → 判据抓不到。
      // 注入必须命中**真正的失效形态**：这里就是"又把它绝对定位回右上角"。
      name: 'streak-absolute-again',
      file: 'wxss',
      scene: 'lit',
      css: '\n.ww-lantern .ww-streak { position: absolute !important; right: 20rpx !important; top: 22rpx !important; display: flex !important; flex-direction: column !important; }\n',
      expect: '连续天数盒压字'
    },
    {
      // 推荐取件期间产品行不再占位（回到"弹层事后长高一块"的旧行为）
      name: 'reco-placeholder-dropped',
      file: 'wxml',
      scene: 'sheet-loading',
      // ⚠️ 2026-09-21 锚点跟随源码更新：P2-12 给这一行的条件加了第四档 `recoFailed`
      // （取件失败也要占位，不许整行消失）。注入语义不变：**撤掉占位条件**，
      // 看 preview 还能不能检出"弹层长高一块"。
      from: 'wx:if="{{reco || productId || recoLoading || recoFailed}}"',
      to: 'wx:if="{{reco || productId}}"',
      expect: '取件中：产品行已占位'
    },
    {
      // 取件结束后骨架没收（会盖住真推荐）。
      // ⚠️ 注入形态：把骨架**无条件**插进产品行 —— 这正是"没收骨架"的终态。
      // （第一版写成 `wx:elif="{{recoLoading}}"` → `{{true}}`：它前面那条 `wx:if="{{reco}}"`
      //   在 sheet 场景为真、先命中了链，骨架根本不会渲染 → 注入等于没注入、自检报"判据无效"。
      //   教训：注入必须真正改变**渲染结果**，只改一个分支的条件字符串不算。）
      name: 'reco-skeleton-not-cleared',
      file: 'wxml',
      scene: 'sheet',
      from: '<text class="ww-sheet-product-title" wx:if="{{reco}}">{{reco.title}}</text>',
      to: '<view class="ww-sheet-product-skel wallet-skel" wx:if="{{true}}" aria-hidden="true"></view>',
      expect: '取件完成：骨架已撤'
    },
    {
      // 次瓦片也长出了字标（四枚都加 = 没有层级）
      name: 'minor-mark-back',
      file: 'wxml',
      scene: 'full',
      from: '<view class="ww-play-mark" wx:if="{{index < 2}}" aria-hidden="true">{{item.mark}}</view>',
      to: '<view class="ww-play-mark" aria-hidden="true">{{item.mark}}</view>',
      expect: '次瓦片无字标'
    }
  ]
  const baseWxss = readFileSync(REAL_WXSS, 'utf8')
  const baseWxml = readFileSync(REAL_WXML, 'utf8')
  let ok = true
  for (const inj of INJECTS) {
    const wxssCopy = join(TMP_DIR, `selftest-${inj.name}.wxss`)
    const wxmlCopy = join(TMP_DIR, `selftest-${inj.name}.wxml`)
    let wxss = baseWxss
    let wxml = baseWxml
    try {
      if (inj.file === 'wxml') {
        if (!baseWxml.includes(inj.from)) throw new Error(`注入锚点在 WXML 里找不到：${inj.name}`)
        wxml = baseWxml.replace(inj.from, inj.to)
      } else {
        wxss = baseWxss + inj.css
      }
      writeFileSync(wxssCopy, wxss)
      writeFileSync(wxmlCopy, wxml)
      const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--check', '--scene', inj.scene || SCENE], {
        encoding: 'utf8',
        env: { ...process.env, WALL_PREVIEW_WXSS: wxssCopy, WALL_PREVIEW_WXML: wxmlCopy }
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
      try { rmSync(wxssCopy, { force: true }) } catch (e) { /* ignore */ }
      try { rmSync(wxmlCopy, { force: true }) } catch (e) { /* ignore */ }
    }
  }
  // 真源码**只读**：自检全程一个字节都不许被写（这正是上一版事故的判据）
  const untouched = readFileSync(REAL_WXSS, 'utf8') === baseWxss && readFileSync(REAL_WXML, 'utf8') === baseWxml
  if (!untouched) {
    console.error('✗ selftest 改动了真源码：请立刻 git checkout 页面 WXSS / WXML（自检只许写 .tmp 副本）')
    process.exit(1)
  }
  if (!ok) process.exit(1)
  console.log(`✓ selftest 通过：${INJECTS.length} 个版式/结构注入全部被检出；真源码未被改动（注入只写 .tmp 副本）`)
  process.exit(0)
}

/* ── 1. 真源码的样式 ────────────────────────────────────────────────────── */
const toCssEarly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(\d*\.?\d+)rpx/g, (_, n) => `${Number(n)}px`)
  .replace(/env\(safe-area-inset-bottom\)/g, '0px')

// ⚠️ 必须**先去注释再做任何提取**：否则按 `.signal-light` 抠出来的片段会把注释开头带进来
// （`/* .signal-light 或 .lamp\n * Token…\n */`），CSS 从那里开始崩，后面的规则整条失效 ——
// 第一版就是这样让 `.ww-page` 的左右内边距失效、卡片量出来全是 750 宽（看着"通过"，其实是废的）。
const appCss = toCssEarly(readFileSync(APP_WXSS, 'utf8'))
const pageVarBlock = (() => {
  const m = /(^|\n)page\s*\{([\s\S]*?)\}/.exec(appCss)
  return m ? m[2] : ''
})()
// ⚠️ token 必须**先做 rpx→px** 再输出：第一版把 `--space-4: 32rpx` 原样写进 :root，
// CSS 不认识 rpx → var() 失效 → `.ww-page` 的左右内边距整条丢掉，量出来的卡片宽度全是 750（假通过）。
const vars = [...toCssEarly(pageVarBlock).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)]
  .map((m) => `  ${m[1]}: ${m[2].trim()};`)
  .join('\n')

const pageCss = toCssEarly(readFileSync(PAGE_WXSS, 'utf8').replace(/^page\s*\{[\s\S]*?\}/m, ''))
// signal-light / button 复位等全局小件：从**已去注释**的 app.wxss 里挑（这时正则不会落在注释里）
const globalBits = [
  ...(appCss.match(/\.signal-light[^{]*\{[^}]*\}/g) || []),
  ...(appCss.match(/(^|\n)\s*button[^{,]*\{[^}]*\}/g) || [])
].join('\n')

/* ── 2. 样例数据：模拟 Page 的 data（结构必须与 index.js 的 data 对齐） ────
 * 为什么数据可以手写、结构不能手抄：结构漂移会**静默画出假页面**（见文件头）；
 * 数据漂移只会让预览里少一个字段，而 `assertSampleCovers` 会把缺失的字段名直接报出来。 */
const AVATAR = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
const WISHES = [
  { _id: 'w1', text: '马上有人念', nickname: '蛋炒饭', avatar: AVATAR, timeText: '2 天前', pinned: true },
  { _id: 'w2', text: '马上有热汤', nickname: '令狐冲大哥', avatar: AVATAR, timeText: '1 天前', isMine: true },
  { _id: 'w3', text: '马上有胃口', nickname: '令狐冲大哥', avatar: AVATAR, timeText: '1 天前', isMine: true },
  { _id: 'w4', text: '马上有胃口', nickname: '令狐冲大哥', avatar: AVATAR, timeText: '1 天前', isMine: true },
  { _id: 'w5', text: '马上有胆', nickname: '令狐冲大哥', avatar: AVATAR, timeText: '1 天前', isMine: true },
  { _id: 'w6', text: '马上有 Offer', nickname: '令狐冲大哥', avatar: AVATAR, timeText: '1 天前', isMine: true }
]
const DANMAKU = [
  { key: 'd1', id: 'd1', text: '马上有人念', tone: 0, topPercent: 8, durationMs: 12000, delayMs: 0 },
  { key: 'd2', id: 'd2', text: '马上有好事', tone: 1, topPercent: 23.2, durationMs: 12000, delayMs: 900 },
  { key: 'd3', id: 'd3', text: '马上有归处', tone: 2, topPercent: 38.4, durationMs: 12000, delayMs: 1800 },
  { key: 'd4', id: 'd4', text: '马上有花看', tone: 3, topPercent: 53.6, durationMs: 12000, delayMs: 2700 },
  { key: 'd5', id: 'd5', text: '马上有信', tone: 4, topPercent: 68.8, durationMs: 12000, delayMs: 3600 },
  { key: 'd6', id: 'd6', text: '马上有下一程', tone: 5, topPercent: 84, durationMs: 12000, delayMs: 4500 }
]

function baseData() {
  return {
    flagChecked: true,
    allowed: true,
    loading: false,
    loadError: '',
    gateError: false,
    rows: DANMAKU,
    echoRows: [],
    items: WISHES,
    tagColumns: [[WISHES[0], WISHES[2], WISHES[4]], [WISHES[1], WISHES[3], WISHES[5]]],
    tagCapped: true,
    wallCount: WISHES.length,
    freshId: '',
    viewMode: 'wall',
    mine: { total: 8 },
    productId: 'p-peacock',
    productTitle: '孔雀标本',
    blessLabelText: '求成',
    // 未点灯（与产品负责人 2026-09-20 真机截图一致）
    lamp: {
      lit: false, label: '', solar: null, solarNext: { name: '秋分', inDays: 3 },
      streak: 0, lampDots: [], line: '', tierNote: ''
    },
    heartBurst: false,
    muyuBeat: false,
    muyuCount: 36,
    muyuPlus: false,
    certEntry: null,
    soundOn: true,
    plays: [
      { id: 'qian', mark: '签', name: '今日一签', hint: '摇一支，看今天宜做什么' },
      { id: 'cookie', mark: '饼', name: '拆签饼', hint: '拆开今天的签饼' },
      { id: 'zodiac', mark: '座', name: '星座签', hint: '按你的星座给一句' },
      { id: 'mbti', mark: '我', name: 'MBTI 贴士', hint: '顺着你的性子来一句' }
    ],
    playResult: null,
    playPending: '',
    // 夜班（09-21 P1/P2）新加的字段：样例数据补齐，否则预览会少画内容（守卫会点名）
    draftCount: 0,
    mineLoading: false,
    mineError: '',
    recoFailed: false,
    recoLoading: false,
    playNeed: null,
    sheetDragY: 0,
    inspiration: ['马上有风', '马上有暖', '马上有眠', '马上有劲'],
    quota: { cap: 5, left: 5, exhausted: false, unknown: false },
    myHidden: 0,
    draft: '',
    textMax: 30,
    inputFocus: false,
    posting: false,
    relics: { total: 12, found: 3 },
    card: null,
    justRegistered: false,
    reco: null,
    showRegisterDialog: false,
    showRitualDialog: false,
    showCertDialog: false,
    ritualGateDesc: '',
    certGateDesc: '',
    certNote: '',
    certCard: null,
    toastShow: false,
    toastOverline: '',
    toastTitle: '',
    toastDesc: '',
    toastDuration: 2000
  }
}

const SCENE_PATCH = {
  full: {},
  lit: {
    // ⚠️ 用**最坏档**：7 天 = 5 盏（utils/wishWall.lampTier 的「长明」）。
    // 子代理几何实测证明 3 盏档只压 4px、5 盏档压标题 18px —— 样例取 3 盏就等于
    // "永远只测最松的那一档"。连续天数盒宽度现在被 .ww-lamps{width:40rpx} 钉成常量，
    // 但样例仍取 5 盏，让"宽度被改回自适应"这类回归一定被渲染出来。
    lamp: {
      lit: true, label: '长明', solar: null, solarNext: { name: '秋分', inDays: 3 },
      streak: 7, lampDots: [1, 1, 1, 1, 1], line: '灯亮着，心愿就还没说完。', tierNote: '今天来过，记下了。'
    },
    // ⚠️ 这里**故意不设 certEntry**：H2「功德证」已按 PRD §8 停用
    // （`showMuyuCertificate` 缺字段默认关 → 真机点亮态不会有那条入口）。
    // 上一版预览把它写进了 lit 场景，于是 §7.3「点亮态多一条入口」的结论里混进了一个停用功能 ——
    // 预览态不许冒充生产态。
    echoRows: [{ key: 'e1', text: '我敲了一下木鱼', sub: '功德 36' }]
  },
  ember: {
    // 点灯余烬动效（2026-09-20 动效专项）：lit 的全部内容 + 一次 heartBurst。
    // 单独立场景的原因：`* { animation: none }` 会把动效冻在 0% 帧（5 颗心都是 opacity:0），
    // 所以"看得见"这件事只能靠**静态终态**判断 —— 这里量的是"5 颗都在、且颜色全在铜色系"。
    lamp: {
      lit: true, label: '长明', solar: null, solarNext: { name: '秋分', inDays: 3 },
      streak: 7, lampDots: [1, 1, 1, 1, 1], line: '灯亮着，心愿就还没说完。', tierNote: '今天来过，记下了。'
    },
    heartBurst: true
  },
  sheet: {
    playResult: {
      id: 'daily', mark: '签', overline: '今日一签', name: '今日一签',
      title: '宜 开口', sub: '忌 憋着',
      lines: ['想要什么就说出来，说出口才有回音。'], wish: '马上有回应'
    },
    reco: { label: '偏「求学」· 为你配一件', title: '潮汐书页', latinName: 'Haliotis iris', priceText: '¥78' }
  },
  'sheet-loading': {
    // 弹层已开、推荐还在路上：产品行必须**已经在**（同高骨架），否则弹层会事后长高一块
    playResult: {
      id: 'daily', mark: '签', overline: '今日一签', name: '今日一签',
      title: '宜 开口', sub: '忌 憋着',
      lines: ['想要什么就说出来，说出口才有回音。'], wish: '马上有回应'
    },
    reco: null,
    recoLoading: true,
    productId: '',
    productTitle: ''
  },
  loading: { loading: true, rows: [], items: [], tagColumns: [[], []], mine: { total: 0 }, relics: { total: 0, found: 0 } },
  error: {
    loading: false, loadError: '网络开小差了，墙面没能展开', rows: [], items: [], tagColumns: [[], []],
    mine: { total: 0 }, relics: { total: 0, found: 0 }
  },
  closed: { flagChecked: true, allowed: false }
}

/** 样例数据必须覆盖 WXML 里引用到的**每一个根标识符**，否则预览会静默少画一块 */
function assertSampleCovers(wxml, data) {
  const idents = new Set()
  for (const m of wxml.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    const stripped = m[1].replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
    for (const t of stripped.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)/g)) {
      if (['true', 'false', 'null', 'undefined', 'item', 'index', 'col', 'ci'].includes(t[2])) continue
      idents.add(t[2])
    }
  }
  const missing = [...idents].filter((k) => !(k in data))
  if (missing.length) {
    console.error(`✗ 样例数据缺字段：${missing.join(', ')} —— 预览会少画内容，先去补 baseData()`)
    process.exit(1)
  }
}

const data = Object.assign(baseData(), SCENE_PATCH[SCENE])
const wxmlSrc = readFileSync(PAGE_WXML, 'utf8')
assertSampleCovers(wxmlSrc, data)

// 弹幕是**动画态**：截图里必须把它们摆进画面（否则全停在屏外，墙看着是空的）。
// ⚠️ 这一步只改**渲染产物**的定位，不改任何被量的几何（墙高是 CSS 定的）。
const spreadDanmaku = (html) => {
  let i = -1
  return html.replace(/(class="ww-danmaku[^"]*"[^>]*style=")([^"]*)"/g, (_, head, style) => {
    i += 1
    return `${head}${style} left:${10 + ((i * 23) % 48)}%; animation:none;"`
  })
}
const markup = renderWxml(wxmlSrc, data, { rewrite: spreadDanmaku })

/* ── 3. 组装 HTML（WXSS 里只有类选择器，所以 <view> → <div> 就够了） ─────── */
const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root {
${vars}
}
html, body { margin: 0; padding: 0; }
body { background: var(--color-bg, #14120F); }
page, .page-root { display: block; }
.ww-page { display: block; }
img { display: block; object-fit: cover; }
/* ⚠️ 必须还原小程序 button 的**盒模型**：真机是 display:block + box-sizing:border-box，
   浏览器默认 inline-block + content-box —— 不还原的话 class="ww-sheet-cta" 的 <button>
   会渲染成"铜底比文字窄"的假象（2026-09-21 出图实测，差点据此改错样式）。 */
button { display: block; box-sizing: border-box; border: 0; background: none; padding: 0; margin: 0; font: inherit; color: inherit; line-height: inherit; }
${globalBits}
${pageCss}
/* 真机 placeholder 走 placeholder-class，HTML 没有这个概念 —— 把那条规则搬到 ::placeholder 上 */
${(pageCss.match(/\.ww-input-ph\s*\{[^}]*\}/) || [''])[0].replace('.ww-input-ph', '.ww-input::placeholder')}
/* 预览专用：截图与量测都不做动画（否则量到的是动画中间态）。
   ⚠️ 副作用：靠 animation-fill-mode: forwards 从 opacity:0 入场的元素会**停在 0**（看不见）——
   弹层的签文就是这种（.ww-sheet-line）。这里补一句静态终态，让截图与真机「动画播完」一致。
   ⚠️ 这一段是**注入到页面里的字符串**：注释里不许出现反引号（会把外层模板字符串截断，实测报
   "Unexpected identifier"），一律用「」。 */
* { animation: none !important; transition: none !important; }
.ww-sheet-line { opacity: 1 !important; }
</style></head>
<body>${markup}</body></html>`

/* ── 4. 无头 Chrome：一次 --dump-dom 量几何，一次 --screenshot 出图 ────────
   为什么不用仓库里的 CDP 驱动（admin/scripts/lib/cdp.mjs）：本沙箱里 CDP 的 WebSocket
   能连上但 `Page.enable` 永远不回（同机下 `--screenshot` 却正常，见 render-vip-card-preview）。
   于是改用 Chrome 自带的两个无头开关：`--dump-dom` 把量好的数字**当文本**打回 stdout（可断言），
   `--screenshot` 出图给人看。零依赖、零 CDP。 */
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
  ['页面容器 .ww-page', '.ww-page'],
  ['牌匾 .ww-hero', '.ww-hero'],
  ['牌匾标题', '.ww-title', 1],
  ['墙+牌匾 .ww-wall', '.ww-wall'],
  ['墙页脚', '.ww-wall-foot', 0, 'same-row'],
  ['发送条 .ww-composer', '.ww-composer'],
  ['输入框 .ww-input', '.ww-input'],
  ['挂上墙按钮 .ww-send', '.ww-send', 1],
  ['点灯卡 .ww-lantern', '.ww-lantern'],
  ['点灯卡标题', '.ww-lantern-title', 1],
  ['木鱼卡 .ww-ritual-card', '.ww-ritual-card'],
  ['仪式区区头 .ww-sec-head', '.ww-sec-head', 1, 'same-row'],
  ['写愿助手 .ww-wishassist', '.ww-wishassist'],
  ['玩法区 .ww-plays', '.ww-plays'],
  ['玩法区标题行', '.ww-plays-head', 1, 'same-row'],
  ['瓦片1', '.ww-play:nth-child(1)'],
  ['瓦片2', '.ww-play:nth-child(2)'],
  ['瓦片3', '.ww-play:nth-child(3)'],
  ['瓦片4', '.ww-play:nth-child(4)'],
  ['瓦片1 名字', '.ww-play:nth-child(1) .ww-play-name', 1],
  ['瓦片1 字标', '.ww-play:nth-child(1) .ww-play-mark', 1],
  ['瓦片4 副文案', '.ww-play:nth-child(4) .ww-play-hint', 1],
  ['灵感行 .ww-inspo-row', '.ww-inspo-row'],
  ['灵感 chip1', '.ww-inspo-chip:nth-child(1)', 1],
  ['额度行 .ww-write-foot', '.ww-write-foot', 1, 'same-row'],
  ['额度文字', '.ww-quota', 1],
  ['字数 .ww-count', '.ww-count', 1],
  ['分段控件 .ww-seg', '.ww-seg', 1, 'same-row'],
  ['愿签两列 .ww-tag-cols', '.ww-tag-cols'],
  ['愿签卡（首张）', '.ww-tag-col:nth-child(1) .ww-tag:nth-child(1)'],
  ['愿签正文', '.ww-tag-text'],
  ['愿签 meta', '.ww-tag-meta', 1],
  ['博物笔记 .ww-relics', '.ww-relics', 1, 'same-row']
]

/** 量几何的脚本：结果写进 <pre id="wall-metrics">，靠 --dump-dom 取回 */
const MEASURE_JS = `
<script>
const __SCENE__ = ${JSON.stringify(SCENE)};
const __METRICS__ = ${JSON.stringify(METRICS)};
window.addEventListener('load', () => {
  const out = []
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
  const lineCount = (el) => { const r = document.createRange(); r.selectNodeContents(el); return Array.from(r.getClientRects()).filter((x) => x.height > 1).length }
  /** 子元素是否都在同一行（容器折行的判据 —— Range 在 flex 容器上会给出虚高的行数） */
  const kidsSameRow = (el) => {
    const kids = Array.from(el.children).filter((k) => k.getBoundingClientRect().height > 1)
    if (kids.length < 2) return true
    // 判据是"竖直区间有交集"，不是"y 相等"：徽章带内边距、纯文字不带，两者居中对齐时 y 本就不同
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
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      // 裁切容器（overflow: hidden）不存在"视觉溢出"：弹幕故意排在屏外，靠裁切进屏
      clips: cs.overflowX === 'hidden',
      overflowX: cs.overflowX !== 'hidden' && el.scrollWidth > el.clientWidth + 1,
      maxLines: maxLines || 0,
      mode: mode || 'lines',
      sameRow: kidsSameRow(el),
      padL: cs.paddingLeft,
      docIndex: idxOf.get(el) || 0,
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 24)
    }))
  }
  // 视口单独量：判据的分母/底边都以它为源，写死 1334 会在换视口时静默算错
  out.push({ label: '视口', sel: ':window', x: 0, y: 0, w: innerWidth, h: innerHeight, lines: 0, text: innerWidth + '×' + innerHeight })
  const br = document.body.getBoundingClientRect()
  out.push({ label: '整页 body', sel: 'body', x: 0, y: 0, w: Math.round(br.width), h: Math.round(br.height),
    lines: 0, maxLines: 0, mode: 'lines', scrollW: document.body.scrollWidth, clientW: document.body.clientWidth,
    overflowX: false, clips: false, sameRow: true, padL: '0px', docIndex: 0, text: '' })
  __METRICS__.forEach((m) => push(m[0], m[1], m[2], m[3]))

  // ── DOM 相对顺序（产品口径：发送条必须紧贴弹幕墙正下方、在仪式区之前） ──
  const order = (sel) => { const el = document.querySelector(sel); return el ? (idxOf.get(el) || 0) : -1 }
  const oWall = order('.ww-wall'), oComposer = order('.ww-composer'), oRitual = order('.ww-ritual-row')
  out.push({ label: 'DOM 顺序', sel: ':order', mode: 'order', lines: 0, maxLines: 0, x: 0, y: 0, w: 0, h: 0,
    orderWall: oWall, orderComposer: oComposer, orderRitual: oRitual,
    text: '墙 ' + oWall + ' < 发送条 ' + oComposer + ' < 仪式区 ' + oRitual })
  // ── 同屏距离（灵感词离输入框多远：远了就是"点完看不到输入框"） ──
  const el = (s) => document.querySelector(s)
  if (el('.ww-composer') && el('.ww-inspo-row')) {
    const c = el('.ww-composer').getBoundingClientRect(), i = el('.ww-inspo-row').getBoundingClientRect()
    const d = Math.round(i.top - c.bottom)
    out.push({ label: '灵感行距发送条', sel: ':gap', mode: 'gap', lines: 0, maxLines: 0, x: Math.round(i.top), y: d, w: 0, h: 0,
      text: '相隔 ' + d + 'px · 灵感顶边 y' + Math.round(i.top) })
  }
  // ── 首屏可见清单（不是判据，是给人看的"第一屏到底有什么"） ──
  const vh = innerHeight
  const fold = ['.ww-hero', '.ww-wall', '.ww-composer', '.ww-lantern', '.ww-plays', '.ww-inspo-row', '.ww-seg']
  out.push({ label: '首屏可见', sel: ':fold', mode: 'fold', lines: 0, maxLines: 0, x: 0, y: 0, w: 0, h: 0,
    text: fold.filter((s) => { const e2 = el(s); return e2 && e2.getBoundingClientRect().top < vh }).join(' / ') })
  // ── 弹层产品行（只在弹层场景量）：推荐是异步取的，取件期间那一行**必须已经在**，
  //    否则弹层会在用户读签文时长高一块。所以 sheet-loading 场景要正判"它存在"。
  if (__SCENE__ === 'sheet' || __SCENE__ === 'sheet-loading') {
    push('弹层产品行', '.ww-sheet-product')
    push('弹层产品标题', '.ww-sheet-product-title', 1)
    const skel = document.querySelector('.ww-sheet-product-skel')
    if (__SCENE__ === 'sheet-loading') {
      out.push({ label: '取件中：产品行已占位', sel: ':must-exist', mode: 'must-exist', lines: 0, maxLines: 0, x: 0, y: 0, w: 0, h: 0,
        exists: !!document.querySelector('.ww-sheet-product'),
        text: document.querySelector('.ww-sheet-product') ? '在' : '不在（弹层会事后长高一块）' })
      out.push({ label: '取件中：骨架占位在', sel: ':must-exist', mode: 'must-exist', lines: 0, maxLines: 0, x: 0, y: 0, w: 0, h: 0,
        exists: !!skel, text: skel ? '在' : '不在' })
    } else {
      out.push({ label: '取件完成：骨架已撤', sel: ':must-exist', mode: 'must-exist', lines: 0, maxLines: 0, x: 0, y: 0, w: 0, h: 0,
        exists: !skel, text: skel ? '骨架没收（会盖住真推荐）' : '已撤' })
    }
    /* ── 弹层可用性：**「收起」的触控区**（2026-09-21）。
     * 它原来只有 ~38rpx 高（padding 8 + 行高 22），真机上很容易点不中。
     * 44pt ≈ 88rpx 是可用性下限 —— 静态样式表里"看"不出这件事（padding 与行高是两处），
     * 只有在真渲染里量 getBoundingClientRect 才算数（本仓 E8：静态分析 ≠ 事实）。 */
    const closeEl = document.querySelector('.ww-sheet-close')
    if (closeEl) {
      const r = closeEl.getBoundingClientRect()
      out.push({ label: '弹层「收起」触控区', sel: '.ww-sheet-close', mode: 'box', lines: 0, maxLines: 0,
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        text: Math.round(r.width) + '×' + Math.round(r.height) + 'rpx' })
    }
  }

  // ── 发送条**若被改回吸底**：必须有底部预留（否则最后一张愿签被盖住）。
  // 顺流（当前设计）时本条不适用 —— 与 test:wish-wall 的"按设计分支"同一口径：
  // 旧预览把这一条写成了无条件判据，于是源码改成 static 之后它天天报假失败，最后被整条删掉。
  // 现在它跟着设计走：只有真的改回 fixed 才生效（自检里有对应注入）。
  const composerBar = document.querySelector('.ww-composer')
  const pageBox = document.querySelector('.ww-page')
  if (composerBar && pageBox) {
    const barFixed = getComputedStyle(composerBar).position === 'fixed'
    const barH = Math.round(composerBar.getBoundingClientRect().height)
    const reserved = Math.round(parseFloat(getComputedStyle(pageBox).paddingBottom) || 0)
    out.push({ label: '发送条吸底预留', sel: ':sticky', mode: 'sticky', lines: 0, maxLines: 0, x: 0, y: 0, w: 0, h: barH,
      fixed: barFixed, reserved, bad: barFixed && reserved < barH,
      text: barFixed ? ('吸底：预留 ' + reserved + 'px / 条高 ' + barH + 'px') : '顺流（本条不适用）' })
  }

  // ── 点灯余烬：5 颗、且颜色**全在铜色三档**内（2026-09-20 动效专项）
  // 起因：这 5 颗 ♥ 原来用了 4 种颜色，其中粉 #E0A9A0 与紫 #C7B4DE 不在本页纸/铜语言里
  //（子代理审计列为"无等价 token 的离群色"）。判据直接量**计算后的颜色**，不是 grep 源码：
  // 只有真的渲染成铜色才算数。
  if (__SCENE__ === 'ember') {
    const hearts = document.querySelector('.ww-hearts')
    const kids = hearts ? Array.from(hearts.children) : []
    const cols = kids.map((k) => getComputedStyle(k).color)
    const BRASS = ['rgb(224, 207, 163)', 'rgb(212, 188, 133)', 'rgb(196, 167, 108)'] // 200 / 300 / 400
    out.push({
      label: '点灯余烬', sel: '.ww-hearts', mode: 'embers', lines: 0, maxLines: 0, x: 0, y: 0, w: 0, h: 0,
      count: kids.length,
      allBrass: cols.length > 0 && cols.every((c) => BRASS.indexOf(c) !== -1),
      text: kids.length + ' 颗 · 色值 ' + Array.from(new Set(cols)).join(' / ')
    })
  }

  // ── 连续天数盒**不许压到文案**（2026-09-20 补）：
  // 子代理用 headless-Chrome 量 rect 相交，实测"3 盏压灯位行 4px、5 盏压标题 18px（整字被盖）"——
  // 而当时的判据只量"标题折了几行"，看不出"文字钻到徽章底下"。这里直接判几何相交。
  const streakEl = document.querySelector('.ww-streak')
  if (streakEl) {
    const sr = streakEl.getBoundingClientRect()
    // ⚠️ 必须量**文字的** rect，不是元素的 rect：「.ww-lantern-title」是 display:block，
    // 它的元素盒铺满整列，用元素 rect 判相交会**恒真**（第一版就这样误报 36px）。
    // 用 Range 框住它的文本内容，才是「字画到哪儿」。
    // ⚠️ 这段是**注入到页面里的字符串**：注释里不许出现反引号（会把外层模板字符串截断）——
    // 本文件已经栽过三次，现在由 test:wish-wall 的「node --check」判据兜住。
    const hitPx = (sel) => {
      const e = document.querySelector(sel)
      if (!e) return 0
      const rng = document.createRange()
      rng.selectNodeContents(e)
      const rects = Array.from(rng.getClientRects()).filter((x) => x.height > 1)
      const r = rects.length ? rects[rects.length - 1] : e.getBoundingClientRect()
      const ox = Math.min(sr.right, r.right) - Math.max(sr.left, r.left)
      const oy = Math.min(sr.bottom, r.bottom) - Math.max(sr.top, r.top)
      return (ox > 1 && oy > 1) ? Math.min(ox, oy) : 0
    }
    const oTitle = hitPx('.ww-lantern-title')
    const oMeta = hitPx('.ww-lantern-meta')
    out.push({ label: '连续天数盒压字', sel: ':overlap', mode: 'overlap', lines: 0, maxLines: 0,
      x: Math.round(sr.left), y: Math.round(sr.top), w: Math.round(sr.width), h: Math.round(sr.height),
      overlapTitle: oTitle, overlapMeta: oMeta,
      text: '徽章 ' + Math.round(sr.width) + 'px；压标题 ' + oTitle.toFixed(1) + 'px / 压灯位行 ' + oMeta.toFixed(1) + 'px' })
  }

  // ── 否定判据：次瓦片**不许**有字标（四枚都加 = 没有层级，等于没加）
  const minorMark = document.querySelector('.ww-play.is-minor .ww-play-mark')
  out.push({ label: '次瓦片无字标', sel: ':absent', mode: 'absent', lines: 0, maxLines: 0, x: 0, y: 0, w: 0, h: 0,
    absent: !minorMark, text: minorMark ? '次瓦片上出现了字标（不该有）' : '未出现（对）' })
  const pre = document.createElement('pre')
  pre.id = 'wall-metrics'
  pre.textContent = JSON.stringify(out)
  document.body.appendChild(pre)
})
</script>`

const htmlPath = join(ROOT, 'miniprogram/scripts/.tmp', `wall-preview-${SCENE}.html`)
writeFileSync(htmlPath, html.replace('</body>', `${MEASURE_JS}</body>`))

function runChrome(args, timeoutMs = 30000) {
  return new Promise((resolvePromise) => {
    const profile = mkdtempSync(join(tmpdir(), 'sc-wall-preview-'))
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

// ① 量：--dump-dom 把量好的 JSON 打回 stdout
const dom = await runChrome(['--window-size=750,1334', '--dump-dom', `file://${htmlPath}`])
const m = /<pre id="wall-metrics">([\s\S]*?)<\/pre>/.exec(dom)
if (!m) {
  console.error('✗ 没拿到量测结果（--dump-dom 里找不到 #wall-metrics）—— Chrome 可能被沙箱拦了')
  process.exit(1)
}
const metrics = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
const byLabel = (l) => metrics.find((x) => x.label === l)

/* ── 5. 判据 ────────────────────────────────────────────────────────────── */
const problems = []
const advisories = []
metrics.forEach((row) => {
  // 「没渲染出来」只在**整页都该在的场景**里算问题：closed / loading / error 三个场景
  // 本来就会合法地缺掉发送条、灯卡、愿签列（页面先画骨架，或干脆不画内容）。
  if (row.missing) {
    if (['full', 'lit', 'ember', 'sheet', 'sheet-loading'].includes(SCENE)) problems.push(`${row.label}：选择器 ${row.sel} 没渲染出来`)
    return
  }
  if (row.overflowX) problems.push(`${row.label}：横向溢出（scrollW ${row.scrollW} > clientW ${row.clientW}）`)
  if (row.mode === 'same-row' && !row.sameRow) problems.push(`${row.label}：子元素折行了（本该同一行）`)
  if (row.mode === 'absent' && !row.absent) problems.push(`${row.label}：${row.text}`)
  if (row.mode === 'must-exist' && !row.exists) problems.push(`${row.label}：${row.text}`)
  if (row.mode === 'embers' && (row.count !== 5 || !row.allBrass)) {
    problems.push(`点灯余烬不合格：${row.text}（要求 5 颗，且颜色全在 --brass-200/300/400 内）`)
  }
  if (row.mode === 'overlap' && (row.overlapTitle > 0 || row.overlapMeta > 0)) {
    problems.push(`连续天数盒压字：${row.text} —— 徽章浮在文案列上，字被盖住（几何相交判据）`)
  }
  if (row.mode === 'sticky' && row.bad) {
    problems.push(`发送条改回吸底但没有底部预留（预留 ${row.reserved}px < 条高 ${row.h}px）—— 最后一张愿签会被盖住`)
  }
  if (row.mode === 'lines' && row.maxLines && row.lines > row.maxLines) {
    problems.push(`${row.label}：折成 ${row.lines} 行（上限 ${row.maxLines}）`)
  }
  if (row.label === '页面容器 .ww-page' && row.padL === '0px') {
    problems.push('页面容器 .ww-page 没有左右内边距（token 没生效 —— 会连带所有卡片量成满宽）')
  }
})

/* ①a-2. 弹层「收起」的触控区（2026-09-21）：44pt ≈ 88rpx 是可用性下限。
 *     它原来只有 ~38rpx 高（padding 8 + 行高 22），真机上很容易点不中。
 *     静态样式表里"看"不出来（padding 与行高分散两处）→ 只有真渲染量 box 才算数。 */
if (SCENE === 'sheet' || SCENE === 'sheet-loading') {
  const close = byLabel('弹层「收起」触控区')
  if (!close || close.missing || !close.h) {
    problems.push('没量到弹层「收起」的触控区（判据失效 = 假通过）')
  } else if (close.h < 88 || close.w < 88) {
    problems.push('弹层「收起」触控区 ' + close.w + '×' + close.h + 'rpx < 88×88rpx（真机容易点不中）')
  }
}

// ①b. 结构判据
{
  const vp = byLabel('视口')
  if (!vp || !vp.h) {
    // 判据的输入没量到 = 判据失效。这里必须红（否则工具"看着通过"其实是假通过，本工具已栽过一次）。
    problems.push('没量到视口尺寸（占屏比 / 一屏可见数两条判据无法成立 = 假通过）')
  } else if (SCENE === 'full' || SCENE === 'lit') {
    const hero = byLabel('牌匾 .ww-hero')
    if (hero && !hero.missing) {
      const share = hero.h / vp.h
      if (share > HERO_MAX_SHARE) {
        problems.push(`牌匾占首屏 ${(share * 100).toFixed(1)}% > 上限 ${(HERO_MAX_SHARE * 100).toFixed(0)}%（${hero.h}/${vp.h}px）—— 牌匾一胖，弹幕墙与玩法区就被顶出第一屏`)
      }
    }
    // 顺序：弹幕墙 < 发送条 < 仪式区（产品口径 2026-09-20：写愿是主交互，紧贴墙下）
    const ord = byLabel('DOM 顺序')
    if (ord && !(ord.orderWall < ord.orderComposer && ord.orderComposer < ord.orderRitual)) {
      problems.push(`发送条不在「弹幕墙正下方、仪式区之前」（DOM 序号 墙 ${ord.orderWall} / 发送条 ${ord.orderComposer} / 仪式区 ${ord.orderRitual}）`)
    }
    // 灵感词必须与发送条**同一屏**：点一下就要能看到输入框（否则"点了没反应"）。
    // ⚠️ 判据是"灵感顶边在首屏之内"，不是"相隔 < 一屏高"——后者在发送条位于 y670、
    // 灵感位于 y1342 时仍然通过（相隔 586 < 1191），而那恰恰就是要修的那个毛病。
    const gap = byLabel('灵感行距发送条')
    if (gap && gap.x >= vp.h) {
      problems.push(`灵感词与发送条不在同一屏（灵感顶边 y${gap.x} ≥ 屏高 ${vp.h}）—— 点灵感后看不到输入框`)
    }
    const tiles = [1, 2, 3, 4].map((i) => byLabel(`瓦片${i}`)).filter((t) => t && !t.missing)
    const seen = tiles.filter((t) => t.y >= 0 && t.y < vp.h)
    if (tiles.length === 4 && seen.length < FOLD_MIN_TILES) {
      // ⚠️ 判据只在 **full（今日未点灯）** 场景打红。点灯之后（lit）页面**合法地**更高：
      // 灯卡从 3 行长到 4 行、还多出一条「功德证」次级入口 —— 实测四枚瓦片被顶到 y1303。
      // 那是"今天已经来过"的用户，主任务（看一眼墙 / 再写一条）本来就在更上面，
      // 玩法掉到折叠线下属产品取舍，留成参考项给人看，不当回归。
      const msg = `首屏内看得到的玩法瓦片 ${seen.length} 个 < ${FOLD_MIN_TILES} 个（视口高 ${vp.h}px，四枚瓦片 top ${tiles.map((t) => t.y).join('/')}）`
      if (SCENE === 'full') problems.push(msg)
      else advisories.push(`${msg}〔参考项：点亮态页面合法地更高，是否要压灯卡由产品定〕`)
    }
  }
}

// ② 出图
if (!CHECK_ONLY) {
  const pngPath = join(ROOT, 'miniprogram/scripts/.tmp', `wall-preview-${SCENE}.png`)
  try { rmSync(pngPath, { force: true }) } catch { /* ignore */ }
  // 全页高度：按量到的 body 高度（+ 余量）设窗口，避免只截到首屏
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
const show = (row) => row.missing
  ? `  ✗ ${String(row.label).padEnd(18)} 未渲染（${row.sel}）`
  : row.mode === 'order' || row.mode === 'gap' || row.mode === 'fold' || row.mode === 'absent' || row.mode === 'must-exist' || row.mode === 'sticky' || row.mode === 'overlap' || row.mode === 'embers'
    ? `  · ${String(row.label).padEnd(18)} ${row.text}`
    : `  · ${String(row.label).padEnd(18)} y${String(row.y).padStart(4)} ${String(row.w).padStart(4)}×${String(row.h).padStart(4)}  行 ${row.lines}  ${row.text}`
console.log(`祈福墙版式预览（场景 ${SCENE}；视口 750px ↔ 750rpx，等比于任意真机宽度）`)
metrics.forEach((row) => console.log(show(row)))

if (problems.length) {
  console.error(`\n✗ 版式不变量违反 ${problems.length} 处：`)
  problems.forEach((p) => console.error('  - ' + p))
  // ⚠️ 2026-09-20：这里原来写的是 `process.exit(CHECK_ONLY ? 1 : 0)` ——
  // 不加 `--check` 时版式违反**不再非 0 退出**，等于把这个工具的"看门狗"属性悄悄降级成"报告"。
  // 它是我自己引入的（子代理事实核查抓到）。改回一律非 0：截图场景同样要能挡住回归。
  process.exit(1)
}
console.log(`\n✓ 版式不变量通过（宽度 / 换行 / 溢出 / DOM 顺序 / 同屏距离 / 牌匾占屏 ≤${(HERO_MAX_SHARE * 100).toFixed(0)}% / 首屏内看得见的瓦片 ≥${FOLD_MIN_TILES} 个；字体度量与安全区仍需真机确认）`)
