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
 *   node miniprogram/scripts/render-wall-preview.mjs --check             # 只跑版式不变量（非 0 = 违反）
 *   node miniprogram/scripts/render-wall-preview.mjs --check --selftest  # 证明判据真的会红（注入 → 检出 → 还原）
 *   node miniprogram/scripts/render-wall-preview.mjs --out /tmp/x.png
 *
 * 场景（--scene）：full（默认）整页原样 / lit 已点灯 / ember 点灯余烬 / loading 骨架 / error 加载失败 / closed 开关关 / exhibit 展品卡打开
 *   （2026-09-21 §11.4：玩法结果/推荐搬到玩法页后，`sheet` / `sheet-loading` 两个场景**已下线** ——
 *    本工具渲染的是祈福墙页，那两个场景要画的东西已经不在这一页上了。）
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
 * 愿签内容流组件（`<wall-feed>`）的真源 —— 2026-09-22 接线（PRD v1.4 §11.1 R2）。
 * 预览必须**渲染组件的真 WXML/WXSS**，不能用页面残留的 `.ww-tag` 死样式去量
 * （那是"读的是镜像、不是真源"，错题本 E3）。结构展开见下面的 `FEED_*` 段。
 */
const FEED_WXML = resolve(ROOT, 'miniprogram/subpackages/feature/components/WallFeed/index.wxml')
const FEED_WXSS = resolve(ROOT, 'miniprogram/subpackages/feature/components/WallFeed/index.wxss')
const FEED_LOGIC = resolve(ROOT, 'miniprogram/subpackages/feature/components/WallFeed/logic.js')
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
const SCENES = ['full', 'lit', 'ember', 'loading', 'error', 'closed', 'exhibit']
const SCENE = (() => {
  const s = argOf('--scene', 'full')
  const alias = s
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
    { name: 'wall-inflated', file: 'wxss', css: '\n.ww-wall { height: 900px !important; }\n', expect: '首屏内看得到的玩法入口' },
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
      // 连续天数盒改回**浮层**并压到文字上（回到本轮修掉的那个形态）→ 必须检出"压字"。
      // ⚠️ 2026-09-22：注入形态跟随 DOM 更新 —— 该徽章现在挂在 `.ww-lantern-copy` 里
      // （2026-09-20 从"绝对定位浮层"改成"独占一行的静态行"）。原注入只写 `.ww-lantern .ww-streak`
      // 的 absolute，而它的定位祖先不是文案列 → 浮到别处、**压不到任何字**，判据因此静默失效
      // （本工具的 Chrome 一直没打通，这条假绿直到 2026-09-22 真渲染跑起来才暴露）。
      // 现在注入同时把文案列设成定位祖先，并让它**横贯整列**（left/right 都为 0）——
      // 这才是"徽章浮在标题上、字被盖住"的真实失效形态（只贴右上角时标题太短、压不到字，实测 0.0px）。
      name: 'streak-absolute-again',
      file: 'wxss',
      scene: 'lit',
      css: '\n.ww-lantern-copy { position: relative !important; }\n.ww-lantern .ww-streak { position: absolute !important; left: 0 !important; right: 0 !important; top: 0 !important; display: flex !important; flex-direction: column !important; }\n',
      expect: '连续天数盒压字'
    },
    {
      // 入口区又长出"结果层"（2026-09-21 §11.4 之后，结果/推荐/补资料引导全在玩法页）
      // —— 那会让玩法区重新变成"本页弹层"，与发送条抢层级。
      // ⚠️ 注入必须是**真的会渲染出来**的节点：写 `wx:if="{{playNeed}}"` 而样例数据里 playNeed=null，
      // 节点根本不进 DOM → 判据"看着通过"（注入自检当场抓到过这一次，见 2026-09-22）。
      name: 'result-layer-back',
      file: 'wxml',
      scene: 'full',
      from: '      <view class="ww-play-grid">',
      to: '      <view class="ww-play-need"></view>\n      <view class="ww-play-grid">',
      expect: '入口区不再承载结果层'
    },
    {
      // 入口形态被抹平成同一枚瓦片（`is-{{item.form}}` → `is-tile`）→ 四种形态判据必须红
      name: 'form-degraded',
      file: 'wxml',
      scene: 'full',
      from: 'class="ww-play is-{{item.form}} {{index < 2 ? \'is-lead\' : \'is-minor\'}}"',
      to: 'class="ww-play is-tile {{index < 2 ? \'is-lead\' : \'is-minor\'}}"',
      expect: '入口形态'
    },
    {
      // "今天玩过没有"那一行被改名 → 量不到状态句（状态丢了，用户没有"再进去"的理由）
      name: 'entry-state-dropped',
      file: 'wxml',
      scene: 'full',
      from: '<text class="ww-play-state {{item.played ? \'is-done\' : \'\'}}">',
      to: '<text class="ww-play-note {{item.played ? \'is-done\' : \'\'}}">',
      expect: '入口1 状态句'
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
// ⚠️ 必须把组件的真 WXSS 一起拼进来（2026-09-22 接线）：愿签段的样式现在全在
// subpackages/feature/components/WallFeed/index.wxss（`.wf-*`）里，只拼页面样式会让 `.wf-*` 全部量不到几何。
// 组件的 `styleIsolation: apply-shared` 也不影响这里：预览是把两份样式放进同一个文档，
// 与真机上"页面样式可作用于组件"的语义一致（组件自带样式对自身生效则完全等价）。
const feedCss = toCssEarly(readFileSync(FEED_WXSS, 'utf8'))
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
/* 弹幕行**必须由真逻辑生成**（`utils/wishWall.buildDanmakuRows`）。
 * ⚠️ 2026-09-22 修：这里原来是**手写样例**（清一色正延迟 0/900/1800…），
 * 而真逻辑会给**前 `lanes` 条负延迟预填**（2026-09-19 专门修过"t=0 墙面是空的"）。
 * 样例过期 ⇒ 出图把已经修好的状态画成"弹幕全叠在左边"的假事故，我差点据此去改版面。
 * 判据要跟实现同源，样例也一样 —— 用真函数，逻辑一改出图立刻跟着变。 */
const WALL_LOGIC = resolve(ROOT, 'miniprogram/utils/wishWall.js')
const wallLogic = loadCjs(WALL_LOGIC)
// 玩法注册表（唯一事实源）—— 见上面那段：预览的入口区必须跟它同源
const RITUAL_PLAYS = loadCjs(resolve(ROOT, 'miniprogram/subpackages/plays/config/ritualPlays.js')).RITUAL_PLAYS || []
// 预览里"哪个玩法今天已经玩过"（只影响状态文案与徽章，属于场景态，不是注册表内容）
// 2026-09-27：铜钱签也标已玩 —— 专门压测「已摇 · 再看」状态句是否单行（此前长尾折行把底行撑参差）
const PREVIEW_PLAYED = { cookie: true, coin: true }
/* 弹幕样例必须与墙上愿签同源（同一批 WISHES）—— 再手写一份会漂
 * （2026-09-24：曾与愿签文案不一致，出图审阅时还被误判成"弹幕串了愿签数据"）。 */
const DANMAKU = wallLogic.buildDanmakuRows(WISHES, { cycle: 0 })
/* 展签 / 展品卡：由真函数从 config/wallExhibit.js 生成（无商品 = 门店码首屏、主图未解析前的样子） */
const EXHIBIT = loadCjs(resolve(ROOT, 'miniprogram/subpackages/feature/utils/wallExhibitProduct.js')).buildExhibitView('mashangyou', null, '')

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
    // ── 愿签内容流组件（<wall-feed>）的入参（2026-09-22 接线）──
    // wallItems = 墙面那一份（与视图无关）；wallCapped = 打到服务端上限（收尾条如实说）
    wallItems: WISHES,
    mineRows: [],
    wallCapped: true,
    freshId: '',
    // 09-26 弹幕升级（点按暂停 / 挂签台落愿态）新加的字段
    heldDmId: '',
    deskPosted: false,
    exhibit: EXHIBIT,
    exhibitOpen: false,
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
      /* ⚠️ 玩法入口**必须从注册表派生**，不许在这里手抄一份。
       * 2026-09-22 修：原来是硬编码的 4 条（name/hint/form/entryNote/doneNote 全抄了一遍），
       * 我把 `config/ritualPlays.js` 里「今日一签」的 hint 从 11 字改到 9 字修折行，
       * **出图一字未变** —— 因为预览读的是那份过期镜像（本仓错题本 E3 的形态）。
       * 只有 `played` 是**场景态**（哪个玩法今天已玩过），保留为预览的显式覆盖。 */
      ...RITUAL_PLAYS.filter((p) => p.enabled !== false).map((p) => Object.assign({}, p, {
        played: PREVIEW_PLAYED[p.id] === true
      }))
    ],
    playResult: null,
    playPending: '',
    // 玩法弹层（2026-09-27）：墙页预览画的是「弹层未开」；弹层本身由 render-play-sheet-preview 渲染
    playSheetId: '',
    playSheetCtx: {},
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
  loading: { loading: true, rows: [], items: [], wallItems: [], tagColumns: [[], []], mine: { total: 0 }, relics: { total: 0, found: 0 } },
  error: {
    loading: false, loadError: '网络开小差了，墙面没能展开', rows: [], items: [], wallItems: [], tagColumns: [[], []],
    mine: { total: 0 }, relics: { total: 0, found: 0 }
  },
  closed: { flagChecked: true, allowed: false },
  exhibit: { exhibitOpen: true }
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

/**
 * 极简 CJS 加载器（**只服务组件纯逻辑核**）。
 * 本文件是 `.mjs`，而仓根 package.json 是 `"type": "module"` —— 直接 `require()` 会把
 * 小程序源码（CJS）当 ESM 解析（`require is not defined`）。test-wish-wall.mjs 用的是
 * 同一手法（`new Function` 注入 module/exports/require），这里按最小实现取一份，
 * 目的是**复用组件自己的 `deriveView`** 去算预览要画的数据 —— 绝不在这里重写一份筛选/分页
 * （重写必然漂移：错题本 E3「读的是镜像、不是真源」）。
 */
function loadCjs(absPath, cache = new Map()) {
  if (cache.has(absPath)) return cache.get(absPath)
  const module = { exports: {} }
  cache.set(absPath, module.exports)
  const dir = dirname(absPath)
  const localRequire = (id) => {
    let p = resolve(dir, id)
    if (!existsSync(p) && existsSync(`${p}.js`)) p = `${p}.js`
    return loadCjs(p, cache)
  }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', readFileSync(absPath, 'utf8'))(module, module.exports, localRequire)
  cache.set(absPath, module.exports)
  return module.exports
}
const feedLogic = loadCjs(FEED_LOGIC)

/**
 * 把 `<wall-feed ... />` 展开成**组件的真 WXML**，并用组件自己的 `deriveView` 算出的数据
 * 一起渲染。做法：先把页面 WXML 里的那个自闭合标签替换成组件 WXML 源，再让 `renderWxml`
 * 统一渲染（合并作用域）—— 这样量到的结构与真机一致，也不需要在预览里重写组件结构。
 */
function expandWallFeed(pageWxml, data) {
  const props = {
    items: data.wallItems,
    mineRows: data.mineRows,
    wallCount: data.wallCount,
    mineTotal: (data.mine && data.mine.total) || 0,
    loading: data.loading,
    loadError: data.loadError,
    mineLoading: data.mineLoading,
    mineError: data.mineError,
    allowed: data.allowed,
    hasMore: data.hasMore === true,
    manageable: data.manageable === true,
    capped: data.wallCapped === true,
    pageSize: feedLogic.PAGE_SIZE
  }
  const state = {
    viewMode: 'wall', wallFilter: 'all', mineFilter: 'all', sort: 'new',
    wallLimit: feedLogic.PAGE_SIZE, mineLimit: feedLogic.PAGE_SIZE
  }
  const derived = feedLogic.deriveView(props, state, null)
  const feedData = Object.assign({}, derived, {
    viewMode: state.viewMode,
    sorts: feedLogic.SORTS,
    filters: derived.filters,
    filter: derived.filter,
    wallCount: props.wallCount,
    mineTotal: props.mineTotal,
    allowed: props.allowed,
    capped: props.capped,
    // 详情层预览不打开（null = 未打开），与组件初始态一致
    detail: null,
    detailCount: 0
  })
  const feedWxml = readFileSync(FEED_WXML, 'utf8')
  // ⚠️ 先去注释再替换：页面那段的说明里原样写着 `<wall-feed>`，不去注释会把注释一起吞掉/锚错
  const expanded = pageWxml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<wall-feed\b[\s\S]*?\/>/, feedWxml)
  if (expanded === pageWxml.replace(/<!--[\s\S]*?-->/g, '')) {
    console.error('✗ 页面 WXML 里找不到 <wall-feed ... /> —— 预览无法展开组件（接线被回退了？）')
    process.exit(1)
  }
  // ⚠️ deriveView 也返回 `rows`（内容流当前页切片），会盖掉页面弹幕 `rows`。
  // 组件 WXML 只用 `columns`，不读 `rows`；弹幕必须以页面为准，否则出图文案变成愿签切片、
  // 而 spreadDanmaku 仍按 DANMAKU 填 delay/tone —— 文案与排期两套源（2026-09-24 实锤）。
  return {
    wxml: expanded,
    scope: Object.assign({}, data, feedData, {
      rows: data.rows,
      echoRows: data.echoRows
    })
  }
}

const data = Object.assign(baseData(), SCENE_PATCH[SCENE])
const expanded = expandWallFeed(readFileSync(PAGE_WXML, 'utf8'), data)
const wxmlSrc = expanded.wxml
assertSampleCovers(wxmlSrc, expanded.scope)

// 弹幕是**动画态**：量测要确定、出图要像真机。
// ⚠️ 2026-09-22 修两处（都是"工具说谎"，我差点据此去改版面）：
//   ① 原实现给每条只补 `left:<算出来的%>%` + `animation:none` —— 于是出图里几条**长文案按这些
//      百分比摆出来必然互相压住**，看着像"弹幕糊成一团"的排版事故；真机是错峰滚动的，不会这样。
//   ② 页面里的 `wx:for` 展开后这些元素的 `{{item.*}}`（tone / top / duration / delay）在本渲染库里
//      **解析为空**（`class="ww-danmaku ww-tone-"`、`top:%`），所以原 hack 只能靠"自己摆位置"遮住它。
// 现在：**用真实行数据把值填回去**（top / 时长 / 延迟都来自 `buildDanmakuRows` 的返回值）。
// ⚠️ 2026-09-24 再修：出图路径曾把「量测用的伪造 left%」一并带进放行动画的 HTML ——
//   真机是 `left:100%` + 负 delay 预填；伪造 left（10–58%）+ 负 delay ⇒ 多数条在 t=2s
//   已滚出左缘，出图看起来像"墙上只剩 1–2 条"的假稀疏（又差点据此去改速度/字号）。
//   量测（动画冻结）仍需要伪造 left 把字摆进屏内可量；出图必须 left:100% 与真机一致。
const spreadDanmaku = (html, { place = false } = {}) => {
  let i = -1
  return html.replace(/(class="ww-danmaku[^"]*"[^>]*style=")([^"]*)"/g, (_, headIn, style) => {
    let head = headIn
    i += 1
    const row = DANMAKU[i] || {}
    // 配色类同样是空值（`ww-tone-`）—— 补上真 tone，否则出图的弹幕全是同一个颜色，
    // 而"六种色调"正是这一页的视觉语言之一（预览看不到就等于没验）。
    const tone = row.tone == null ? '' : String(row.tone)
    head = head.replace(/ww-tone-[^"\s]*/, 'ww-tone-' + tone)
    const top = row.topPercent == null ? '' : `top:${row.topPercent}%; `
    const dur = row.durationMs == null ? '' : `animation-duration:${row.durationMs}ms; `
    const delay = row.delayMs == null ? '' : `animation-delay:${row.delayMs}ms; `
    const left = place
      ? `left:${10 + ((i * 23) % 48)}%;`
      : 'left:100%;'
    return `${head}${top}${dur}${delay}${left}"`
  })
}
const markupMeasure = renderWxml(wxmlSrc, expanded.scope, { rewrite: (h) => spreadDanmaku(h, { place: true }) })
const markupShot = renderWxml(wxmlSrc, expanded.scope, { rewrite: (h) => spreadDanmaku(h, { place: false }) })

/* ── 3. 组装 HTML（WXSS 里只有类选择器，所以 <view> → <div> 就够了） ─────── */
/* 量几何那一份要**冻结动画**（不然量到的是动画中间态）；
   出图那一份**必须放行动画**（靠 Chrome 的 --virtual-time-budget=2000 推进到 2s 处的真实状态）。
   ⚠️ 2026-09-22 修：原来两份共用同一份 HTML、都冻结 ⇒ 出图永远是 **0% 帧** ——
   而弹幕正是 `animation-fill-mode: forwards` 从左侧入场，0% 时**所有轨道叠在同一个 x**，
   出图看起来像"弹幕糊成一团"的重排版事故（实际是工具的假象，我差点据此去改版面）。 */
const FREEZE_CSS = `* { animation: none !important; transition: none !important; }
.ww-sheet-line { opacity: 1 !important; }`

const buildHtml = (bodyMarkup, { freeze }) => `<!doctype html>
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
${feedCss}
/* 真机 placeholder 走 placeholder-class，HTML 没有这个概念 —— 把那条规则搬到 ::placeholder 上 */
${(pageCss.match(/\.ww-input-ph\s*\{[^}]*\}/) || [''])[0].replace('.ww-input-ph', '.ww-input::placeholder')}
/* 量测冻结动画（否则量到动画中间态）；出图放行。
   ⚠️ 副作用：靠 animation-fill-mode: forwards 从 opacity:0 入场的元素会**停在 0**（看不见）——
   弹层的签文就是这种（.ww-sheet-line）。这里补一句静态终态，让截图与真机「动画播完」一致。
   ⚠️ 这一段是**注入到页面里的字符串**：注释里不许出现反引号（会把外层模板字符串截断，实测报
   "Unexpected identifier"），一律用「」。 */
${freeze ? FREEZE_CSS : ''}
</style></head>
<body>${bodyMarkup}</body></html>`
const html = buildHtml(markupMeasure, { freeze: true })
const shotHtml = buildHtml(markupShot, { freeze: false })

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
  // 入口形态四种（2026-09-21 §11.4）：几何上必须**各有各的盒子**，不能退化成四枚同质瓦片
  ['入口卡（签筒）', '.ww-play.is-card'],
  ['入口壳（签饼）', '.ww-play.is-shell'],
  ['入口盘（星盘）', '.ww-play.is-ring'],
  ['入口轴（双极）', '.ww-play.is-axis'],
  ['入口叶（时令）', '.ww-play.is-leaf'],
  ['入口钱（方孔）', '.ww-play.is-coin'],
  ['入口1', '.ww-play:nth-child(1)'],
  ['入口2', '.ww-play:nth-child(2)'],
  ['入口3', '.ww-play:nth-child(3)'],
  ['入口4', '.ww-play:nth-child(4)'],
  ['入口1 名字', '.ww-play:nth-child(1) .ww-play-name', 1],
  ['入口1 字标', '.ww-play:nth-child(1) .ww-play-mark', 1],
  ['入口1 状态句', '.ww-play:nth-child(1) .ww-play-state', 1],
  ['入口2 名字', '.ww-play:nth-child(2) .ww-play-name', 1],
  ['入口2 副文案', '.ww-play:nth-child(2) .ww-play-hint', 1],
  ['入口2 状态句', '.ww-play:nth-child(2) .ww-play-state', 1],
  ['入口4 副文案', '.ww-play:nth-child(4) .ww-play-hint', 1],
  ['入口6 名字', '.ww-play:nth-child(6) .ww-play-name', 1],
  ['入口6 副文案', '.ww-play:nth-child(6) .ww-play-hint', 1],
  ['入口6 状态句', '.ww-play:nth-child(6) .ww-play-state', 1],
  ['灵感行 .ww-inspo-row', '.ww-inspo-row'],
  ['灵感 chip1', '.ww-inspo-chip:nth-child(1)', 1],
  ['额度行 .ww-write-foot', '.ww-write-foot', 1, 'same-row'],
  ['额度文字', '.ww-quota', 1],
  ['字数 .ww-count', '.ww-count', 1],
  ['分段控件 .wf-seg', '.wf-seg', 1, 'same-row'],
  // 愿签内容流（2026-09-22 接线）：量点随结构搬进组件（`.wf-*`），不再量页面残留的 `.ww-tag*`
  ['筛选行 .wf-controls', '.wf-controls'],
  ['愿签两列 .wf-cols', '.wf-cols'],
  ['愿签卡（首张）', '.wf-col:nth-child(1) .wf-card:nth-child(1)'],
  ['愿签正文', '.wf-card-text'],
  ['愿签 meta', '.wf-card-meta', 1, 'same-row'],
  ['加载更多 .wf-more', '.wf-more'],
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
  // 「灵感」标签与芯片的**垂直中线**对齐（2026-09-22）：这不是审美，是可量的排版不变量 ——
  // 标签用的是 align-items: flex-start + 手调 margin-top，改字号/内边距就会失准。
  if (el('.ww-inspo-label') && el('.ww-inspo-chip')) {
    const l = el('.ww-inspo-label').getBoundingClientRect()
    const ch = el('.ww-inspo-chip').getBoundingClientRect()
    const d = Math.round((l.top + l.height / 2) - (ch.top + ch.height / 2))
    out.push({ label: '灵感标签中线', sel: ':inspoalign', mode: 'inspoalign', lines: 0, maxLines: 0,
      x: 0, y: d, w: 0, h: 0, delta: Math.abs(d),
      text: '标签中线比芯片低 ' + d + 'px（正=偏低）' })
  }
  if (el('.ww-composer') && el('.ww-inspo-row')) {
    const c = el('.ww-composer').getBoundingClientRect(), i = el('.ww-inspo-row').getBoundingClientRect()
    const d = Math.round(i.top - c.bottom)
    out.push({ label: '灵感行距发送条', sel: ':gap', mode: 'gap', lines: 0, maxLines: 0, x: Math.round(i.top), y: d, w: 0, h: 0,
      text: '相隔 ' + d + 'px · 灵感顶边 y' + Math.round(i.top) })
  }
  // ── 首屏可见清单（不是判据，是给人看的"第一屏到底有什么"） ──
  const vh = innerHeight
  const fold = ['.ww-hero', '.ww-wall', '.ww-composer', '.ww-lantern', '.ww-plays', '.ww-inspo-row', '.wf-seg']
  out.push({ label: '首屏可见', sel: ':fold', mode: 'fold', lines: 0, maxLines: 0, x: 0, y: 0, w: 0, h: 0,
    text: fold.filter((s) => { const e2 = el(s); return e2 && e2.getBoundingClientRect().top < vh }).join(' / ') })
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

  // ── 入口区**不再承载结果层**（2026-09-21 · PRD v1.4 §11.4「玩法各开一页」）──
  // 这条替换了旧的"次瓦片无字标"：那条的前提（四枚同质瓦片靠"有没有字标"分主次）已被产品口径取消，
  // 现在四种入口靠**形态**区分（card/shell/ring/axis 四套纯 CSS），字标每枚都有。
  // 新的失败模式是"结果/推荐/补资料引导又回到本页" —— 那会让玩法区重新变成弹层。
  const resultLayer = document.querySelector('.ww-play-need, .ww-sheet-product, .ww-play-reco')
  out.push({ label: '入口区不再承载结果层', sel: ':absent', mode: 'absent', lines: 0, maxLines: 0, x: 0, y: 0, w: 0, h: 0,
    absent: !resultLayer, text: resultLayer ? '玩法结果层又出现在入口区（应搬到玩法页）' : '未出现（对）' })
  // ── 四种入口形态各有各的盒子（"入口不是四枚同质瓦片"的几何证据；现含 leaf/coin）──
  const formCount = ['card', 'shell', 'ring', 'axis', 'leaf', 'coin'].filter((f) => document.querySelector('.ww-play.is-' + f + ' .ww-play-form')).length
  out.push({ label: '四种入口形态', sel: ':forms', mode: 'forms', lines: 0, maxLines: 0, x: 0, y: 0, w: 0, h: 0,
    forms: formCount, text: formCount + ' 种形态（card/shell/ring/axis/leaf/coin）' })
  const pre = document.createElement('pre')
  pre.id = 'wall-metrics'
  pre.textContent = JSON.stringify(out)
  document.body.appendChild(pre)
})
</script>`

const htmlPath = join(ROOT, 'miniprogram/scripts/.tmp', `wall-preview-${SCENE}.html`)
writeFileSync(htmlPath, html.replace('</body>', `${MEASURE_JS}</body>`))
// 出图：不冻结 + left:100%（与真机一致；勿复用量测的伪造 left%）
const shotHtmlPath = join(ROOT, 'miniprogram/scripts/.tmp', `wall-preview-shot-${SCENE}.html`)
writeFileSync(shotHtmlPath, shotHtml)

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
    if (['full', 'lit', 'ember'].includes(SCENE)) problems.push(`${row.label}：选择器 ${row.sel} 没渲染出来`)
    return
  }
  if (row.overflowX) problems.push(`${row.label}：横向溢出（scrollW ${row.scrollW} > clientW ${row.clientW}）`)
  if (row.mode === 'same-row' && !row.sameRow) problems.push(`${row.label}：子元素折行了（本该同一行）`)
  if (row.mode === 'absent' && !row.absent) problems.push(`${row.label}：${row.text}`)
  if (row.mode === 'forms' && row.forms < 4) {
    problems.push(`入口形态只有 ${row.forms} 种 < 4 种（四枚同质瓦片回来了）`)
  }
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
    // 「灵感」标签中线必须与芯片中线对齐（±4px）—— 手调偏移失准是这类行的常见退化
    const align = byLabel('灵感标签中线')
    if (align && !align.missing && align.delta > 4) {
      problems.push(`「灵感」标签与芯片**垂直中线**差 ${align.delta}px（>4px）—— ${align.text}`)
    }
    const gap = byLabel('灵感行距发送条')
    if (gap && gap.x >= vp.h) {
      problems.push(`灵感词与发送条不在同一屏（灵感顶边 y${gap.x} ≥ 屏高 ${vp.h}）—— 点灵感后看不到输入框`)
    }
    const tiles = [1, 2, 3, 4].map((i) => byLabel(`入口${i}`)).filter((t) => t && !t.missing)
    const seen = tiles.filter((t) => t.y >= 0 && t.y < vp.h)
    if (tiles.length === 4 && seen.length < FOLD_MIN_TILES) {
      // ⚠️ 判据只在 **full（今日未点灯）** 场景打红。点灯之后（lit）页面**合法地**更高：
      // 灯卡从 3 行长到 4 行、还多出一条「功德证」次级入口 —— 实测四枚入口被顶到 y1303。
      // 那是"今天已经来过"的用户，主任务（看一眼墙 / 再写一条）本来就在更上面，
      // 玩法掉到折叠线下属产品取舍，留成参考项给人看，不当回归。
      const msg = `首屏内看得到的玩法入口 ${seen.length} 个 < ${FOLD_MIN_TILES} 个（视口高 ${vp.h}px，四个入口 top ${tiles.map((t) => t.y).join('/')}）`
      if (SCENE === 'full') problems.push(msg)
      else advisories.push(`${msg}〔参考项：点亮态页面合法地更高，是否要压灯卡由产品定〕`)
    }
    // 2026-09-27：六格同高（此前 lead 行 176、次行 140，铜钱签状态折行更参差）
    const six = ['入口卡（签筒）', '入口壳（签饼）', '入口盘（星盘）', '入口轴（双极）', '入口叶（时令）', '入口钱（方孔）']
      .map((l) => byLabel(l)).filter((t) => t && !t.missing)
    if (six.length === 6) {
      const heights = six.map((t) => t.h)
      const lo = Math.min(...heights)
      const hi = Math.max(...heights)
      if (hi - lo > 2) {
        problems.push(`玩法入口六格高度参差：${heights.join('/')}px（差 ${hi - lo}px > 2）—— 标题折行或状态长尾又把格子撑开了`)
      }
    }
  }
}

// ② 出图
if (!CHECK_ONLY) {
  const pngPath = join(ROOT, 'miniprogram/scripts/.tmp', `wall-preview-${SCENE}.png`)
  try { rmSync(pngPath, { force: true }) } catch { /* ignore */ }
  // 全页高度：按量到的 body 高度（+ 余量）设窗口，避免只截到首屏
  const bodyH = (byLabel('整页 body') || {}).h || 1334
  // 出图用**动画版**：--virtual-time-budget 会把它推进到 2s 处（弹幕已散开、入场动画已落定）
  await runChrome([`--window-size=750,${Math.min(8000, bodyH + 40)}`, `--screenshot=${pngPath}`, `file://${shotHtmlPath}`])
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
console.log(`\n✓ 版式不变量通过（宽度 / 换行 / 溢出 / DOM 顺序 / 同屏距离 / 牌匾占屏 ≤${(HERO_MAX_SHARE * 100).toFixed(0)}% / 首屏内看得见的玩法入口 ≥${FOLD_MIN_TILES} 个；字体度量与安全区仍需真机确认）`)
