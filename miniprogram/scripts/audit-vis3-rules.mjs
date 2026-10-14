#!/usr/bin/env node
/**
 * VIS 3.0 八条视觉纪律 —— 盘点 / 守卫 / 自检（三合一）
 *
 * 规范原文：VIS 3.0 十八页（`~/Downloads/山海造物 VIS 3.0-png.zip`）
 *   —— 第 01 页「八条视觉纪律」定规则，第 04/05/06 页给数值，第 07 页给小程序应用。
 * 落地台账：`miniprogram/docs/VIS3落地规范_2026-10-13.md`（决定 / 分批 / 校准记录都在那里）。
 *
 * 用法：
 *   node miniprogram/scripts/audit-vis3-rules.mjs              # 盘点（人读，按文件汇总）
 *   node miniprogram/scripts/audit-vis3-rules.mjs --rule R8    # 只看一条
 *   node miniprogram/scripts/audit-vis3-rules.mjs --json        # 出 JSON
 *   node miniprogram/scripts/audit-vis3-rules.mjs --check       # 守卫模式（非 0 = 有硬项 / 参考项超出基线）
 *   node miniprogram/scripts/audit-vis3-rules.mjs --selftest    # 证明每条判据都会红（合成样本，不碰真源码）
 *   node miniprogram/scripts/audit-vis3-rules.mjs --print-baseline  # 打印当前参考项基线
 *
 * ⚠️ 只**读**源码，不写任何东西（自检也只用内存里的合成样本）。
 *
 * ── 判据校准史（重要，改判据前先读）──────────────────────────────────────
 * 2026-10-13 首版在这三条上共报出 **74 条假红**，全是判据自己读错了主语
 * （本仓错题本 E3：「读的是镜像、不是真源」）：
 *   · R1：把管理端商品筛选器的「孤品」chip、`isOneOfAKind` 表单开关都算成"主图印章标记"
 *     → 6 条假红。规范指的是**详情页主图上那枚营销徽标**，不是商品属性。
 *   · R3：按页统计 `.btn-primary` → `gift/receive` 的 6 处其实落在 wx:if/elif 的**互斥状态块**里，
 *     同屏只渲染一个。**页面级计数静态不可判**（AGENTS.md：静态分析 ≠ 事实）→ 降级为参考项。
 *   · R6：`—` 是价格**区间连接符**（100 — 500）、`-` 是滑块最小值标签与步进器减号按钮
 *     → 3 条假红。规范点名的 `—` 是**空值符号**。
 *   · R7：两版都错 —— 首版按 `hero|cover|banner` **子串**匹配（`hero-plate` 无图 / `note-cover` 是缩略图）
 *     报 6 条；二版用 `\bhero` 又匹配到 `sk-hero`（骨架屏）报 68 条。现按 class **词元**匹配。
 *   · R2：`inset 0 1rpx 0 rgba(212,188,133,.08)` 是规范要的**发丝线**（合规），
 *     首版凡"阴影含黄铜色"就判红 → 22 条假红。现要求 blur > 4rpx 才算"发光"。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(process.env.VIS3_MP_ROOT || join(HERE, '..'))
const ROOT = resolve(MP, '..')

const argv = process.argv.slice(2)
const has = (n) => argv.includes(n)
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }

/* ── 采集 ───────────────────────────────────────────────────────────────── */
const ROOTS = ['pages', 'components', 'subpackages', 'custom-tab-bar']
const SKIP_DIR = /(^|\/)(node_modules|\.tmp|assets)(\/|$)/
function walk(dir, out = []) {
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    const p = join(dir, name)
    if (SKIP_DIR.test(p)) continue
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (/\.(wxml|wxss)$/.test(name)) out.push(p)
  }
  return out
}

/** 容错读取：`<include>` 进来的子视图（如 workspace/_subviews.wxml）**没有同名 wxss**，
 *  样式共用页面那份 —— 这正是弹层盘点那轮踩过的坑（弹层视觉规范 §11.8：
 *  「实例数看 wxml、规则数看 wxss」）。返回 '' 而不是抛错。 */
const read = (f) => { try { return readFileSync(f, 'utf8') } catch { return '' } }
const rel = (p) => relative(ROOT, p)
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

/* ══════════════════════════════════════════════════════════════════════════
 * 判据 —— 每条都是**纯函数**：吃 (relPath, 源码, 类型) 吐 findings。
 * 纯函数化的理由有两条：① `--check` 与实际分享同一份逻辑，不会"守卫和盘点各说各话"；
 * ② `--selftest` 可以直接喂**合成样本**证明它会红，不必往真源码里注入再还原
 *   （那个形态在本仓出过事故：SIGKILL 会把注入的 !important 留在要发版的样式表里，
 *    见 render-wall-preview.mjs 文件头）。
 * ══════════════════════════════════════════════════════════════════════════ */

function textNodes(src) {
  const out = []
  for (const m of stripComments(src).matchAll(/>([^<>]+)</g)) {
    const raw = m[1].replace(/\{\{[\s\S]*?\}\}/g, '\u0000').trim()
    if (raw) out.push(raw)
  }
  return out
}
function classCount(src, cls) {
  let n = 0
  for (const m of stripComments(src).matchAll(/\bclass="([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c === cls) n++
  }
  return n
}
/** 轻量栈解析（判"同一父节点下的并列按钮"用） */
function parseTree(src) {
  const roots = []
  const stack = []
  for (const m of src.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g)) {
    const [, close, name, attrs, self] = m
    if (close) { stack.pop(); continue }
    const node = { name, attrs, kids: [] }
    const parent = stack[stack.length - 1]
    if (parent) parent.kids.push(node); else roots.push(node)
    if (!self) stack.push(node)
  }
  return roots
}

/** R1 一件事只说一次 —— 详情页主图的「孤品/镇店」徽标只许一枚 */
function ruleR1(relPath, src, kind) {
  if (kind !== 'wxml') return []
  if (!/subpackages\/feature\/detail\/index\.wxml$/.test(relPath)) return []
  const badges = textNodes(src).filter((t) => /^(孤品|镇店|孤品 · 镇店|孤品·镇店)$/.test(t))
  if (badges.length <= 1) return []
  return [`详情页「孤品/镇店」徽标渲染 ${badges.length} 次 —— 规范：只在主图印章一次`]
}

/** R2 克制的金 —— 金色不许发光（发丝线是合规的，不算发光） */
const GOLD_RGBA = /rgba?\(\s*(\d{2,3})\s*,\s*(\d{2,3})\s*,\s*(\d{2,3})\s*(?:,\s*0?\.\d+)?\s*\)/g
function isGoldColor(s) {
  for (const m of s.matchAll(GOLD_RGBA)) {
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
    // 黄铜家族色域：R−B ≥ 50（金色红高蓝低）。
    // ⚠️ 只按三段数值区间判会把银蓝皮肤 rgba(198,214,224)（R≈B）也吃进来 —— 那是冷色高光，不是金色发光。
    if (r >= 190 && r <= 240 && g >= 150 && g <= 220 && b <= 170 && r - b >= 50) return true
  }
  return false
}
/**
 * 「光源」豁免 —— R2 唯一的例外口径（2026-10-14 全站去光时定，**每条都带理由**）。
 * 纪律 02 说的是「金色不当装饰」：文字辉光、按钮光晕、卡面外发光、选中态光晕一律去掉
 * （改为金线环 `--ring-brass` / 内发丝线 `--hairline-brass-inset` / 中性投影 `--shadow-lift`）。
 * 但**本身就是光源**的元素（灯、烛、星点、信号灯、落愿那一瞬的回响），光就是它的内容，去掉就不成立。
 * 按「文件 → 选择器正则」登记；**不在表里的发光一律硬红**。新增一条必须写清它为什么是光源。
 */
const R2_LIGHT_SOURCE = {
  'subpackages/business/components/CouponPrintMint/index.wxss': [
    [/^\.signal-light\b/, '印券机信号灯（与 app.wxss 全局信号灯同族）'],
    [/^50%$/, '信号灯闪烁关键帧'],
    [/^\.printer-slot$/, '出券口指示光']
  ],
  'subpackages/feature/components/CouponPrintMint/index.wxss': [
    [/^\.signal-light\b/, '同上（分包副本）'], [/^50%$/, '同上'], [/^\.printer-slot$/, '同上']
  ],
  'components/WishWallEntry/index.wxss': [
    [/wish-wall-entry-lamp$/, '入口的一盏灯（祈福墙「灯」意象）']
  ],
  'subpackages/feature/wish-wall/index.wxss': [
    [/^\.ww-lantern$/, '厅顶灯笼'],
    [/^\.ww-lamp-dot$/, '灯点'],
    [/^\.ww-dm-spark$/, '弹幕落点火花'],
    [/^\.ww-dm-slip\.is-landing$/, '落愿瞬间回响（瞬态，非常驻）'],
    [/^\.ww-desk\.is-posted$/, '落愿瞬间回响（瞬态）'],
    [/^\.ww-tag\.is-fresh$/, '刚落愿的签（瞬态）'],
    [/^\.ww-echo$/, '墙脚回声带（瞬态）'],
    [/^30%$/, '墙体回响关键帧（瞬态）']
  ],
  'subpackages/plays/play-zodiac/index.wxss': [
    [/^\.rp-dot$/, '星盘星点'],
    [/^\.rp-wheel-needle::before$/, '指针星芒']
  ]
}
const isLightSource = (relPath, sel) => {
  const key = Object.keys(R2_LIGHT_SOURCE).find((k) => relPath.endsWith(k))
  return !!key && R2_LIGHT_SOURCE[key].some(([re]) => re.test(sel))
}

function ruleR2(relPath, src, kind) {
  if (kind !== 'wxss') return []
  const out = []
  const css = stripComments(src)
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selFull = m[1].trim().replace(/\s+/g, ' ')
    if (isLightSource(relPath, selFull)) continue
    const sels = selFull.slice(0, 60)
    for (const s of m[2].matchAll(/(text-shadow|box-shadow)\s*:([^;}]+)/g)) {
      const val = s[2]
      if (!isGoldColor(val)) continue
      for (const layer of val.split(/,(?![^()]*\))/)) {
        if (!isGoldColor(layer)) continue
        // ⚠️ 无单位的 `0` 是合法长度（`0 0 12rpx rgba(...)` 的前两个参数就是它）——
        // 只认 `12rpx` 这种带单位的，会把 offset-x / offset-y 整个漏掉，
        // 于是 blur 被算成 0、正例永远红不了（首版自检当场抓到）。
        const cleaned = layer.replace(/rgba?\([^)]*\)/g, ' ')
        const lens = [...cleaned.matchAll(/(-?[\d.]+)(rpx|px)?/g)].map((x) => ({
          n: Number(x[1]),
          u: x[2] || 'px'          // 无单位一律按 px（1px = 2rpx）
        }))
        const px = lens.map((l) => (l.u === 'rpx' ? l.n : l.n * 2))   // 归一到 rpx
        const blur = px.length >= 3 ? Math.abs(px[2]) : 0
        const inset = /inset/.test(layer)
        if (inset && px.every((n) => n <= 4)) continue               // 纯发丝线 = 合规
        // 第七次校准（2026-10-14）：亚像素凹刻高光（偏移 ≤ 2rpx、blur ≤ 1rpx）也是发丝线 ——
        // UserVipCard 金属卡面的刻字「上暗下亮」就是这种写法（`1rpx 1.2rpx 0.6rpx`），不是辉光。
        if (!inset && blur <= 1 && px.slice(0, 2).every((n) => Math.abs(n) <= 2)) continue
        if (blur > 4 || (!inset && blur > 0)) {
          out.push(`金色发光：${sels} → ${layer.trim().replace(/\s+/g, ' ').slice(0, 70)}`)
        }
      }
    }
  }
  return out
}

/**
 * 已核实的「自写实心金按钮同屏只有一枚」——**每条都要带理由**（2026-10-14 逐条取证）。
 * R3 的 wxss 分支只能数"这个文件里有几处自写实心金"，数不出"会不会同屏"；
 * 静态数不出、但人工/结构已确认合规的，登记在这里，避免参考项永远挂着一条查不动的警告。
 */
const R3_CONFIRMED_SINGLE = {
  'subpackages/feature/wish-labels/index.wxss':
    '两处 .wl-primary：一处是展品页主按钮，一处**只**在写签弹层内（`.wl-sheet` 由 wx:if="{{composeOpen}}" 控制），' +
    '且弹层打开时同屏有 `.wl-mask {{composeOpen ? \'is-on\' : \'\'}}` 全屏遮罩 —— 可见的主行动仍只有一枚。2026-10-14 核实。'
}

/** R3 一屏一个主按钮 —— 只判**同一父节点下的并列**实心金（页面级计数静态不可判） */
function ruleR3(relPath, src, kind) {
  if (kind !== 'wxss') return []
  // 键统一用「去掉 miniprogram/ 前缀的相对路径」（relPath 传进来是相对仓库根的）
  const key = relPath.replace(/^miniprogram\//, '')
  if (R3_CONFIRMED_SINGLE[key]) return []
  const own = []
  for (const m of stripComments(src).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/linear-gradient\(1[0-9]{2}deg\s*,\s*#E6D3A1/.test(m[2]) && !/\.btn-primary/.test(m[1])) {
      own.push(m[1].trim().replace(/\s+/g, ' '))
    }
  }
  return own.length ? [`自写实心金按钮 ${own.length} 处（参考项：确认同屏只有一枚）`] : []
}
function ruleR3Wxml(relPath, src) {
  const src2 = stripComments(src)
  const roots = parseTree(src2)
  const hasSolid = (n) => /class="[^"]*\bbtn-primary\b/.test(n.attrs)
  const conditional = (n) => /wx:(if|elif|else)\s*=/.test(n.attrs)
  let groups = 0
  const visit = (n) => {
    const solid = n.kids.filter(hasSolid)
    if (solid.length > 1 && solid.every((k) => !conditional(k))) groups += 1
    n.kids.forEach(visit)
  }
  roots.forEach(visit)
  return groups ? [`同一父节点下有 ${groups} 组**并列**实心金主按钮（真·同屏两枚主行动）`] : []
}

/** R4 英文眉题 + 中文标题 —— 同一文字节点不中英并列（C 端；员工端由 check:c-stream-polish R5 覆盖） */
function ruleR4(relPath, src, kind) {
  if (kind !== 'wxml') return []
  if (!/^(miniprogram\/pages|miniprogram\/components)/.test(relPath)) return []
  const HAN = /\p{Script=Han}/u
  const PAIR = /\p{Script=Han}[\p{Script=Han}\s]*[\/｜·][\s]*[A-Z][A-Z'& ]{2,}[A-Z]|[A-Z][A-Z'& ]{2,}[A-Z][\s]*[\/｜·][\s]*\p{Script=Han}/u
  return textNodes(src)
    .filter((t) => HAN.test(t) && PAIR.test(t))
    .map((t) => `同一行中英并列：「${t.slice(0, 34)}」`)
}

/**
 * R5 左标签，右数值（参考项：金额是否走 --font-mono 需浏览器实测）
 *
 * ⚠️ 2026-10-14 收窄（**第七类误报**：代理指标太宽）：原来凡"文本里出现 ¥ 数字"就报，
 * 于是把**居中脚注**也算成"左标签右数值"。实测那唯一一条：
 * `MemberLevelModal` 的 `.growth-foot`（`text-align: center` 的成长脚注）里
 * `.growth-foot-sub`「每消费 ¥1 = 1 成长值」—— 那是**一句居中说明**，不是"标签左、数值右"的行；
 * 而且同一块里的 `.growth-foot-main` **本来就走 `font-family: var(--font-mono, monospace)`**。
 * 规范点名的形状是「左标签，右数值」的**行**，不是"任何含 ¥ 的文本"。
 * 现在只报**容器规则里有 `display:flex` + `justify-content:space-between`** 的那种行（左右分布才是该形状）。
 */
function ruleR5(relPath, src, kind, readSiblingCss = defaultSiblingCss) {
  if (kind !== 'wxml') return []
  const css = stripComments(readSiblingCss(relPath))
  const s = stripComments(src)
  const out = []
  // 只看「直接含文本、且内部没有再嵌 <view>」的容器（近似"一行"），避免把整页当成一个容器
  const MONO = /font-family\s*:\s*var\(--font-mono|font-family\s*:[^;]*monospace/
  for (const m of s.matchAll(/<view\b[^>]*class="([^"]*)"[^>]*>((?:(?!<view\b)[\s\S])*?)<\/view>/g)) {
    const cls = m[1].trim().split(/\s+/)[0]
    const body = m[2]
    if (!/¥\s*(\{\{|\d)/.test(body)) continue
    const rule = rulesFor(css, cls)
    if (!/display\s*:\s*flex/.test(rule) || !/justify-content\s*:\s*space-between/.test(rule)) continue
    // 已在等宽字上的**不报**（判据要的是"数值该用等宽字"，不是在数"哪行有 ¥"）。
    // 元素自身或所在行有 --font-mono 即视为合规 —— 宁可漏报也不误报。
    if (MONO.test(rule)) continue
    let flagged = 0
    for (const tm of body.matchAll(/<text\b[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/text>/g)) {
      if (!/¥\s*(\{\{|\d)/.test(tm[2])) continue
      if (MONO.test(rulesFor(css, tm[1].trim().split(/\s+/)[0]))) continue
      flagged += 1
    }
    if (!flagged) continue
    const amt = (/¥\s*(?:\{\{[^}]*\}\}|[\d.,]+)/.exec(body) || [''])[0]
    out.push(`左标签右数值行 .${cls} 的金额「${amt}」未走 --font-mono（${flagged} 处）`)
  }
  return out
}

/** R6 空就隐藏 —— 只判 em dash `—` 这个**空值符号**（`-` 是减号/连接符，一律不判） */
const SEPARATOR_CLASS = /dash|sep|range|minus|lbl|s-btn|notch|divider|hyphen/
function ruleR6(relPath, src, kind) {
  if (kind !== 'wxml') return []
  const out = []
  const s = stripComments(src)
  for (const m of s.matchAll(/>([^<>]+)</g)) {
    const t = m[1].replace(/\{\{[\s\S]*?\}\}/g, '\u0000').trim()
    if (!t) continue
    if (/^[—–]$/.test(t)) {
      const before = s.slice(Math.max(0, m.index - 220), m.index)
      const cls = (before.match(/class="([^"]*)"/g) || []).pop() || ''
      if (SEPARATOR_CLASS.test(cls)) continue
      out.push(`空值占位「${t}」${cls ? ` (${cls.replace(/class="|"/g, '')})` : ''} —— 规范：整行隐藏`)
    } else if (/^(暂无|不适用|未设置|无数据)$/.test(t)) {
      out.push(`空态占位「${t}」—— 参考项：确认它是**值位**而非空列表空态`)
    }
  }
  return out
}

/** R7 图像融入夜色（参考项：权威判定需浏览器实测，这里只给候选）
 *
 * ── 判据校准史（**改这条前必读**；一天内被产品负责人推着改了四次）──────────────
 * ① 子串匹配 `hero|cover|banner` → `hero-plate`（无图）/ `note-cover`（缩略图）误报 6 条。
 * ② `\bhero` → 匹配到 `sk-hero`（骨架屏）误报 68 条。
 * ③ 只在 **WXML 片段**里找 `gradient`，而渐隐写在 **WXSS**（首页 `.hero-mask-vignette`、
 *    `wiki-detail/index.wxss:8` 的 `.hero-overlay`）→ 误报 19 条。改为跨同名 WXSS 找。
 * ④ **2026-10-14 第四次校准：把"窗口"当成了"子树"。**
 *    第三版把"容器内有图"实现成 `s.slice(m.index, m.index + 3000)` —— 那**不是子树包含关系**，
 *    只是"这个标签之后 3000 字符内出现过 `<image>`"，而且**只向后看**。于是：
 *      · `care/index` 的 `.hero` 是**纯文字** hero（眉题/标语/分隔线/统计块，整块没有照片），
 *        被后面别的块的图带红 3 条（`.hero` / `.hero-divider` / `.hero-stat`）；
 *      · `articles/detail` 的 `.hero-text` 是**文字块**（只含 1 枚分类小图标），
 *        而真实渐隐是它的**兄弟** `.hero-overlay` —— 兄弟在它**前面**，只向后看所以看不到；
 *      · `cart` 的空购物车**插画** `.empty-hero`（`tab-cart.png` 图标）也被当成"照片主图"；
 *      · 管理端 `_subviews` 的 `.hero-edit-card`（主图/轮播图**配置卡**）不是规范第 07 页的适用面。
 *    现在四条一起改：
 *      Ⅰ **真子树扫描**：按 `<view>` 配平取到闭合标签，"内有图"= 子树里真有 `<image>`/`<swiper>`；
 *      Ⅱ **兄弟也算**：渐隐层常常是与容器**同级**的遮罩（`.hero-overlay`），所以在
 *        "容器子树 ∪ 父级子树"里找 —— 但父级只认**名字像遮罩的类**（shade/overlay/vignette/
 *        fade/mask/scrim），否则父级 = 整页，页面上任何一处渐变都会把英雄区放过（那是把判据废掉）；
 *      Ⅲ 按**角色**排掉不是主图容器的类名（`-text/-divider/-stat/-icon/-badge/…`）与**空态**（`empty-`）；
 *      Ⅳ **管理端**（`subpackages/manager/**`）跳过 —— 这是 C 端主图纪律，管理端没有这个诉求。
 *    ⚠️ 本条始终只作**参考项**：静态只能给候选，权威判定要浏览器量层级与视觉叠加（见落地台账 §4-2）。 */
const FADE_NAME = /(shade|overlay|vignette|scrim|fade|topshade|mask)/i
/** 名字里带这些词元的 hero 类**不是主图容器**：文字块 / 分隔线 / 统计块 / 图标 / 徽标 /
 *  以及**渐隐层自身**（`hero-overlay` / `hero-shade` / `hero-vignette` —— 它们是答案，不是问题）。 */
const HERO_SUBROLE = /(^|\s)hero-(text|divider|stat|plate|content|over-row|credit|topshade|seal|edit-card|preview|icon|badge|title|desc|label|overlay|shade|vignette|fade|mask|scrim)(\s|$)/
const HERO_ANY = /(^|\s)(hero|hero-[a-z-]+|[a-z-]+-hero)(\s|$)/

/** 取 `<view>` 元素树：只关心 tag 配平，用来判断"子树"归属（`<image>` 是自闭合/成对，都不影响 view 深度） */
function parseViewTree(src) {
  const nodes = []
  const stack = []
  const re = /<view\b[^>]*?(\/?)>|<\/view>/g
  let m
  while ((m = re.exec(src))) {
    const tag = m[0]
    if (tag.startsWith('</')) {
      const top = stack.pop()
      if (top) { top.end = m.index + tag.length; nodes.push(top) }
      continue
    }
    const clsM = /class="([^"]*)"/.exec(tag)
    const node = {
      cls: clsM ? clsM[1].trim() : '',
      start: m.index,
      end: src.length,
      parent: stack.length ? stack[stack.length - 1] : null,
      children: []
    }
    if (node.parent) node.parent.children.push(node)
    if (m[1] !== '/') stack.push(node)
    else { nodes.push(node) }   // 自闭合 <view ... />
  }
  // 未闭合的（源码被截断等）也算上，end 兜到末尾
  while (stack.length) { const t = stack.pop(); nodes.push(t) }
  return nodes
}

const HERO_TOKEN = HERO_ANY   // 兼容旧引用（判据内部已改用 HERO_ANY / HERO_SUBROLE）
const NOT_HERO = HERO_SUBROLE

/** 渐隐的形态：规则里既有一个 gradient，又收到透明或页面底色。
 * ⚠️ **第五次校准**：原来写成 `/gradient\([^)]*(?:transparent|color-bg)/` —— `[^)]*` **跨不过渐变参数里的
 * `rgba(...)` 的右括号**，于是最常见的那种写法
 *   `linear-gradient(to bottom, rgba(0,0,0,.4) 0%, …, var(--color-bg) 100%)`
 * 被判成"没有渐隐"。`about/index.wxss` 的 `.hero-mask` 正是这么被误报的（它明明有整整一层遮罩）。
 * 现拆成两条**独立**判据（先有 gradient，再有透明/底色），与参数顺序、参数里有没有括号都无关。 */
const FADE_GRADIENT = /gradient\(/i
const FADE_TO_BG = /transparent|color-bg/i

/** 一段文本里出现过的 class 词元 */
function classesIn(text) {
  const out = new Set()
  for (const cm of text.matchAll(/class="([^"]*)"/g)) {
    for (const c of cm[1].split(/\s+/)) if (c && !c.includes('{')) out.add(c.replace(/[{}]/g, ''))
  }
  return out
}

/** WXSS 里是否有"渐隐渐变"规则落在给定的 class 集合上 */
function fadeRuleHits(siblingCss, classNames) {
  if (!siblingCss || !classNames.size) return false
  for (const r of siblingCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!FADE_GRADIENT.test(r[2]) || !FADE_TO_BG.test(r[2])) continue
    for (const c of classNames) {
      if (new RegExp(`\\.${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(r[1])) return true
    }
  }
  return false
}

/** 取一个 class 在 wxss 里所有规则体（拼起来看，避免只看到第一条就下结论） */
function rulesFor(css, cls) {
  if (!css || !cls) return ''
  const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => new RegExp(`\\.${esc}(?![\\w-])`).test(m[1]))
    .map((m) => m[2]).join(' ; ')
}

/**
 * 主图容器的**形状**判据：得是个"照片框"，不是卡面 / 牌匾 / 图文行。
 *
 * 第六次校准（2026-10-14）：`HERO_ANY` 会把**任何**名字带 hero 的容器都当主图容器，于是
 * 剩下 6 个候选**全是误报**，逐个取证如下：
 *   · `b2bdesk/partner .ptn-hero`      —— 合作方**信息行**（flex + .avatar-img 头像）
 *   · `extra/user/profile .profile-hero` —— **头像区**（flex column + 圆形头像 + 相机角标）
 *   · `extra/member-crm .d-hero`       —— **会员卡卡面**（background: bg-card + border + 圆角）
 *   · `feature/care/guide .cat-hero`   —— **图文行**（flex + bg-card + border，图是 aspectFit 图标）
 *   · `feature/custom .preview-hero`   —— **商品预览行**（flex + 缩略图 + 底部分隔线）
 *   · `feature/wish-wall .ww-hero`     —— **浅色牌匾**（`background: linear-gradient(brass-50…)` + border + 圆角）
 * 规范第 07 页讲的是**满幅照片与夜墨底融合** —— 卡面 / 牌匾 / 头像 / 缩略图都不在其列。
 * 判据（三条都满足才算主图容器）：
 *   ① 容器自身有 `overflow: hidden`（照片框的典型标志；卡面/图文行都没有）
 *   ② 容器自身**不是面板**：不出现"不透明底 + 边框/圆角"这一对（排除卡面与牌匾）
 *   ③ 若那张图有 class 且该 class 有规则，则它必须撑满（`width: 100%` 或 `position: absolute`）
 * ⚠️ 不能用 `display: flex` 当排除条件 —— 真主图（`about .hero-poster`）自己就是 flex（居中叠字）。
 */
function isPhotoFrame(containerCss, containerCls, imgCls) {
  const c = rulesFor(containerCss, containerCls)
  if (!c) return false
  if (!/overflow\s*:\s*hidden/.test(c)) return false
  const panelBg = /background\s*:\s*(?!\s*(?:transparent|none)\b)[^;]+/.test(c)
  const framed = /(?:^|[;\s])border(?:-radius)?\s*:/.test(c)
  if (panelBg && framed) return false
  if (imgCls) {
    const img = rulesFor(containerCss, imgCls)
    if (img && !/width\s*:\s*100%/.test(img) && !/position\s*:\s*absolute/.test(img)) return false
  }
  return true
}

/** 同名 WXSS 的读取（默认从仓库读；自检可以注入桩，否则 WXSS 侧那条判据无法被证明会红/会放行） */
const defaultSiblingCss = (relPath) => read(join(ROOT, relPath.replace(/\.wxml$/, '.wxss')))

function ruleR7(relPath, src, kind, readSiblingCss = defaultSiblingCss) {
  if (kind !== 'wxml') return []
  // Ⅳ 管理端不是 C 端主图纪律的适用面（.hero-edit-card 是"主图/轮播图配置卡"）
  if (/subpackages\/manager\//.test(relPath)) return []
  const out = []
  const s = stripComments(src)
  const siblingCss = stripComments(readSiblingCss(relPath))
  const nodes = parseViewTree(s)

  for (const node of nodes) {
    const cls = node.cls
    if (!cls || !HERO_ANY.test(cls)) continue
    if (HERO_SUBROLE.test(cls)) continue                       // Ⅲ 文字块/分隔线/统计块/渐隐层自身…
    if (/(^|\s)empty-/.test(cls)) continue                     // Ⅲ 空态插画不是照片主图
    if (/sk-|skeleton|skel-|placeholder/.test(cls)) continue    // 骨架屏
    const token = cls.split(/\s+/).find((c) => HERO_ANY.test(` ${c} `)) || cls.split(/\s+/)[0]
    // ⑥ 形状判据：不是"照片框"的（卡面 / 牌匾 / 头像 / 图文行）直接放行
    if (!isPhotoFrame(siblingCss, token, null)) {
      // 图有 class 时还要满足"撑满容器"，所以先取子树里那张非图标图的 class 再判一次
      const seg0 = s.slice(node.start, node.end)
      const tags0 = [...seg0.matchAll(/<image\b[^>]*>/g)].map((t) => t[0])
      const tag0 = tags0.find((t) => !/class="[^"]*icon/.test(t)) || ''
      const imgCls0 = (/class="([^"]*)"/.exec(tag0) || [, ''])[1].split(/\s+/)[0]
      if (!isPhotoFrame(siblingCss, token, imgCls0)) continue
    }
    const subtree = s.slice(node.start, node.end)
    // Ⅰ 真子树里必须有**照片**（不是图标）：
    //    `<image class="hero-max-icon" mode="aspectFit" src="medal_gold.png">` 是勋章图标，
    //    拿它当"主图"会把会员等级卡判成缺渐隐（第五次校准同时修掉的另一条）。
    const photoTags = [...subtree.matchAll(/<image\b[^>]*>/g)].map((t) => t[0])
    const hasPhoto = photoTags.some((t) => !/class="[^"]*icon/.test(t))
    if (!hasPhoto && !/<swiper\b/.test(subtree)) continue

    // Ⅱ 渐隐层：容器子树（任意 class 带渐变）∪ 父级子树（只认名字像遮罩的类）
    const subClasses = classesIn(subtree)
    // wxml 侧证据：**名字像遮罩**的元素本身就是"设计上加过一层"的强证据
    // （改成按名字判而不是硬编码 `hero-overlay|hero-shade|…` 清单 —— 清单会漏 `hero-mask` 这种同义命名）
    if ([...subClasses].some((c) => FADE_NAME.test(c))) continue
    if (fadeRuleHits(siblingCss, subClasses)) continue
    if (node.parent) {
      const parentSub = s.slice(node.parent.start, node.parent.end)
      const parentClasses = classesIn(parentSub)
      const fadeNames = new Set([...subClasses, ...parentClasses].filter((c) => FADE_NAME.test(c)))
      if (fadeNames.size) continue
      if (fadeRuleHits(siblingCss, fadeNames)) continue
    }
    out.push(`主图容器 .${token} 内有图但未见渐隐层（子树与同级遮罩都没找到）`)
  }
  return out
}

/** R8 不折行、不孤字 —— 主按钮 / 分区主标的定义规则须有 nowrap */
function ruleR8(relPath, src, kind) {
  if (kind !== 'wxss') return []
  const out = []
  const css = stripComments(src)
  const isApp = /(^|\/)miniprogram\/app\.wxss$/.test(relPath) || relPath === 'miniprogram/app.wxss'
  if (isApp) {
    for (const cls of ['.btn-primary', '.btn-secondary', '.btn-text', '.btn-ghost']) {
      const re = new RegExp(`\\n\\s*(?:button)?\\${cls}\\s*\\{([^}]*)\\}`, 'g')
      let hit = false
      for (const m of css.matchAll(re)) {
        hit = true
        if (!/white-space\s*:\s*nowrap/.test(m[1])) out.push(`零件 ${cls} 缺 white-space: nowrap（规范：按钮与标题不折行）`)
      }
      if (!hit) out.push(`零件 ${cls} 在 app.wxss 里找不到定义（判据主语消失 = 假通过）`)
    }
    const m = css.match(/\n\.mu-cn\s*\{([^}]*)\}/)
    if (!m) out.push('零件 .mu-cn 在 app.wxss 里找不到定义（判据主语消失 = 假通过）')
    else if (!/white-space\s*:\s*nowrap/.test(m[1])) out.push('零件 .mu-cn 缺 white-space: nowrap')
  } else {
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sels = m[1].split(',').map((s) => s.trim()).filter(Boolean)
      const hit = sels.filter((s) => /\.btn-primary\b/.test(s))
      if (!hit.length) continue
      if (!/font-size|height|padding|line-height|font-weight|background/.test(m[2])) continue
      if (/white-space\s*:\s*nowrap/.test(m[2])) continue
      if (/linear-gradient\(1[0-9]{2}deg\s*,\s*#E6D3A1/.test(m[2])) {
        out.push(`自写实心金 ${hit[0]} 缺 nowrap`)
      }
    }
  }
  return out
}

const RULES = {
  R1: { title: '一件事只说一次', run: (p, s, k) => ruleR1(p, s, k) },
  R2: { title: '克制的金', run: (p, s, k) => ruleR2(p, s, k) },
  R3: { title: '一屏一个主按钮', run: (p, s, k) => (k === 'wxml' ? ruleR3Wxml(p, s) : ruleR3(p, s, k)) },
  R4: { title: '英文眉题 + 中文标题', run: (p, s, k) => ruleR4(p, s, k) },
  R5: { title: '左标签，右数值', run: (p, s, k, css) => ruleR5(p, s, k, css) },
  R6: { title: '空就隐藏', run: (p, s, k) => ruleR6(p, s, k) },
  R7: { title: '图像融入夜色', run: (p, s, k, css) => ruleR7(p, s, k, css) },
  R8: { title: '不折行、不孤字', run: (p, s, k) => ruleR8(p, s, k) }
}
/** 参考项（advisory）：不进硬判据，但计入基线棘轮，只许变少。
 *
 * ⚠️ R2「克制的金」是**有硬判据、但暂缓执行**的一条：静态可判（金色 + blur > 4rpx），
 * 实测 95 处 / 17 个文件，**数字可信**（校准时修掉了"无单位 0"的解析 bug 才拿到真值）。
 * 之所以先挂成参考项：这 95 处里有一大半在**纸品仪式面**（booking 预约票根、certificates 收藏证书、
 * about 仪式版面）—— 规范第 04 页说「宣纸为纸主场」，那些微光可能是刻意的设计，
 * 与"克制"的关系需要产品负责人拍板，不是纯静态能判的（见落地台账 §4-1）。
 * **拍板后把它从这张表里删掉，R2 即成为硬判据，基线随之清零。** */
const ADVISORY = { R3: true, R5: true, R6: 'partial', R7: true }
// 2026-10-14：R2 已摘出参考项 → **硬判据**。全站 74 处装饰性金光已去掉，剩下 19 处是光源，登记在 R2_LIGHT_SOURCE。

/* ── 自检：喂合成样本，证明每条判据都会红 ───────────────────────────────── */
if (has('--selftest')) {
  /** "照片框"容器规则：R7 的多数样本都要带上它，否则会先被形状判据放行（测不到真正要测的那条） */
  const FRAME = '.hero-card, .hero { position: relative; overflow: hidden; }'
  const CASES = [
    ['R1', 'miniprogram/subpackages/feature/detail/index.wxml', 'wxml',
      '<text>孤品</text><text>镇店</text>', '主图印章一次'],
    ['R2', 'miniprogram/x/index.wxss', 'wxss',
      '.a { text-shadow: 0 0 12rpx rgba(212, 188, 133, 0.45); }', '金色发光'],
    ['R2-neg', 'miniprogram/x/index.wxss', 'wxss',
      '.a { box-shadow: inset 0 1rpx 0 rgba(212, 188, 133, 0.08); }', null],   // 发丝线 = 合规
    ['R2-neg2', 'miniprogram/x/index.wxss', 'wxss',
      '.a { text-shadow: 1rpx 1.2rpx 0.6rpx rgba(224, 196, 132, 0.42); }', null],   // 亚像素凹刻高光 = 发丝线
    ['R2-neg3', 'miniprogram/subpackages/feature/wish-wall/index.wxss', 'wxss',
      '.ww-lamp-dot { box-shadow: 0 0 8rpx rgba(233, 190, 110, 0.7); }', null],     // 登记过的光源
    // 光源豁免只认**登记的选择器**：同一文件里别的元素发光仍须红
    ['R2-pos2', 'miniprogram/subpackages/feature/wish-wall/index.wxss', 'wxss',
      '.ww-sec-mark { box-shadow: 0 2rpx 12rpx rgba(196, 167, 108, 0.35); }', '金色发光'],
    ['R3', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="row"><view class="btn-primary">A</view><view class="btn-primary">B</view></view>', '并列'],
    ['R3-neg', 'miniprogram/x/index.wxml', 'wxml',
      '<view><view class="btn-primary" wx:if="{{a}}">A</view><view class="btn-primary" wx:elif="{{b}}">B</view></view>', null],
    ['R4', 'miniprogram/pages/user/index.wxml', 'wxml',
      '<view><text class="m-en">AI IDENTIFY · 当前免费</text></view>', '中英并列'],
    ['R6', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="val">—</view>', '整行隐藏'],
    ['R6-neg', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="price-dash">—</view><view class="s-btn">-</view>', null],  // 连接符 / 减号 = 合规
    ['R7', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="hero-card"><image src="a.png"></image></view>', '渐隐层', FRAME],
    ['R7-neg', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="hero-card"><image src="a.png"><view class="hero-shade"></view></view>', null, FRAME],
    ['R7-neg2', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="sk-hero"><image src="a.png"></image></view>', null],        // 骨架屏不是主图
    /* ── R7 第四次/第五次校准的负例（每一条都对应一个真实的误报来源，别再退回去）── */
    ['R7-neg3', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="hero"><text>只有文字，没有照片</text><view class="hero-divider"></view></view>', null],  // 纯文字 hero + 分隔线
    // ⚠️ 这条要**隔离**角色判据：文字块里放一张**非图标**的照片（articles/detail 的 .hero-text 就是这样），
    //    没有角色判据时它会被报出来 —— 有判据才放行。
    //    （第一版写成"外层还有 .hero 承接"，结果命中的是外层 .hero，测的不是角色判据。）
    ['R7-neg4', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="wrap"><view class="hero-text"><image src="a.png" mode="aspectFill"></image></view></view>', null],  // 文字块不是主图容器
    ['R7-neg5', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="empty-hero"><image class="empty-icon" src="cart.png"></image></view>', null],  // 空态插画
    ['R7-neg6', 'miniprogram/subpackages/manager/manager/x.wxml', 'wxml',
      '<view class="hero-edit-card"><image src="a.png"></image></view>', null],  // 管理端不是 C 端主图纪律的适用面
    ['R7-neg7', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="hero-max"><image class="hero-max-icon" mode="aspectFit" src="medal.png"></image></view>', null],  // 图标不是照片
    ['R7-neg8', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="wrap"><view class="hero-overlay"></view><view class="hero-text"><image src="a.png"></image></view></view>', null, FRAME],  // 渐隐层是**前面的兄弟**
    ['R7-neg9', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="hero"><image src="a.png"></image><view class="hero-mask"></view></view>', null, FRAME],  // 有遮罩层（名字像遮罩就算数）
    // WXSS 侧：渐隐写在同名 WXSS 里也算数 —— 第 6 项是注入的同名 WXSS 桩。
    // ⚠️ 这两条钉住**第五次校准**（`rgba()` 的右括号曾把判据卡死）：参数里带 rgba(...) 的渐变必须认出来。
    ['R7-neg10', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="hero"><image src="a.png"></image><view class="veil-bottom"></view></view>', null,
      FRAME + ' .veil-bottom { background: linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, var(--color-bg) 100%); }'],
    /* ── R7 第六次校准的负例：**这六个形状就是校准前剩下的全部候选**（逐个取证后判误报）。
          判据是"得是照片框"：① 容器 overflow:hidden；② 容器不是"不透明底 + 边框/圆角"的面板；
          ③ 图要撑满。任何一条不满足都放行 —— 卡面 / 牌匾 / 头像 / 图文行不是"满幅照片"。 ── */
    ['R7-neg11', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="ptn-hero"><image class="avatar-img" src="a.png" mode="aspectFill"></image></view>', null,
      '.ptn-hero { display: flex; align-items: center; gap: 28rpx; } .avatar-img { width: 100%; height: 100%; }'],  // 合作方信息行（头像）
    ['R7-neg12', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="profile-hero"><image class="avatar-img" src="a.png" mode="aspectFill"></image></view>', null,
      '.profile-hero { display: flex; flex-direction: column; align-items: center; } .avatar-img { width: 100%; height: 100%; border-radius: 50%; }'],  // 头像区
    ['R7-neg13', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="d-hero"><image class="avatar" src="a.png" mode="aspectFill"></image></view>', null,
      '.d-hero { padding: var(--space-4); background: var(--color-bg-card); border: 1rpx solid var(--brass-800); border-radius: var(--radius-lg); } .avatar { width: 100%; height: 100%; }'],  // 会员卡卡面
    ['R7-neg14', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="cat-hero"><image class="cat-hero-icon" src="a.png" mode="aspectFit"></image></view>', null,
      '.cat-hero { display: flex; align-items: center; gap: var(--space-3); background: var(--color-bg-card); border: 1px solid var(--color-border); }'],  // 图文行（图标）
    ['R7-neg15', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="preview-hero"><image class="preview-hero-img" src="a.png" mode="aspectFill"></image></view>', null,
      '.preview-hero { display: flex; gap: 24rpx; border-bottom: 1px solid rgba(38,35,32,0.8); } .preview-hero-img { width: 100%; height: 100%; }'],  // 商品预览行（缩略图）
    ['R7-neg16', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="ww-hero"><image class="ww-exhibit-img" src="a.png" mode="aspectFill"></image></view>', null,
      '.ww-hero { position: relative; overflow: hidden; background: linear-gradient(165deg, var(--brass-50) 0%, #F2EDE4 100%); border: 1px solid var(--brass-200); border-radius: var(--radius-md); } .ww-exhibit-img { width: 100%; height: 100%; }'],  // **浅色牌匾**（有 overflow:hidden，只能靠"面板底+边框"排除）
    ['R7-pos11', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="hero-poster"><image class="hero-img" src="a.png" mode="aspectFill"></image></view>', '渐隐层',
      '.hero-poster { position: relative; width: 100%; height: 900rpx; overflow: hidden; } .hero-img { position: absolute; width: 100%; height: 100%; }'],  // 真主图（about 的形状）必须仍能被报
    ['R7-pos10', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="hero"><image src="a.png"></image><view class="veil-bottom"></view></view>', '渐隐层',
      FRAME + ' .veil-bottom { background: linear-gradient(to bottom, #111 0%, #222 100%); }'],
    // R5 收窄后的正/负例：同样是"含 ¥ 的文本"，**是左右行**才报、**居中脚注**不报
    ['R5-pos', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="row"><text class="lbl">合计</text><text class="val">¥128</text></view>', '左标签右数值行', '.row { display: flex; justify-content: space-between; }'],
    ['R5-neg', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="growth-foot"><text class="main">当前成长值 120</text><text class="sub">每消费 ¥1 = 1 成长值</text></view>', null, '.growth-foot { padding: 28rpx 0; text-align: center; }'],
    ['R8', 'miniprogram/app.wxss', 'wxss',
      '\n.btn-primary { background: red; }', 'nowrap']
  ]
  let ok = true
  for (const [name, path, kind, src, expect, stubCss] of CASES) {
    const base = name.replace(/-neg\d*$/, '').replace(/-pos\d*$/, '')
    const fn = RULES[base]
    const hits = fn.run(path, src, kind, stubCss ? () => stubCss : undefined)
    const isNeg = /-neg\d*$/.test(name)
    if (isNeg) {
      if (hits.length) { ok = false; console.error(`✗ 负例「${name}」被误报：${hits[0]} —— 判据过宽`) }
      else console.log(`  ✓ 负例「${name}」正确放行（不误报）`)
    } else {
      const caught = hits.some((h) => h.includes(expect))
      if (!caught) { ok = false; console.error(`✗ 正例「${name}」没检出（期望命中「${expect}」）—— 判据无效`) }
      else console.log(`  ✓ 正例「${name}」被检出：${expect}`)
    }
  }
  if (!ok) process.exit(1)
  console.log(`\n✓ selftest 通过：${CASES.length} 个样本（正例全检出 / 负例不误报）；未写任何真实文件`)
  process.exit(0)
}

/* ── 跑判据 ─────────────────────────────────────────────────────────────── */
function collect(files) {
  const findings = []
  for (const p of files) {
    const path = rel(p)
    const kind = p.endsWith('.wxml') ? 'wxml' : 'wxss'
    const src = read(p)
    for (const [id, rule] of Object.entries(RULES)) {
      for (const detail of rule.run(path, src, kind)) {
        const advisory = ADVISORY[id] === true || (id === 'R6' && /参考项/.test(detail))
        findings.push({ rule: id, file: path, detail, advisory })
      }
    }
  }
  return findings
}

const BASELINE_PATH = join(HERE, 'vis3-rules-baseline.json')
/** 参考项基线：按文件+规则计数，**只许变小**（抬高基线要有理由并写进台账） */
const baselineOf = (findings) => {
  const m = {}
  for (const f of findings) {
    if (!f.advisory) continue
    const k = `${f.rule} ${f.file}`
    m[k] = (m[k] || 0) + 1
  }
  return Object.fromEntries(Object.entries(m).sort())
}

const FILES = ROOTS.flatMap((r) => walk(join(MP, r)))
const WXML = FILES.filter((f) => f.endsWith('.wxml'))
const WXSS = FILES.filter((f) => f.endsWith('.wxss'))
const findings = collect(FILES)

if (has('--print-baseline')) {
  console.log(JSON.stringify(baselineOf(findings), null, 2))
  process.exit(0)
}
/** ⚠️ `--rule` 必须在 json / 盘点**之前**生效 ——
 *  首版把 `--json` 分支写在过滤之前，于是 `--rule R2 --json` 吐出的是**全部规则**的合集，
 *  我差点据此把「134 处 R2 发光」报给人（真实 R2 只有几十处）。判据少过滤一层就会骗人。 */
const ONLY = argOf('--rule', null)
const shown0 = ONLY ? findings.filter((f) => f.rule === ONLY) : findings
if (has('--json')) { console.log(JSON.stringify(shown0, null, 2)); process.exit(0) }

const shown = shown0

if (!has('--check')) {
  const byRule = new Map()
  for (const f of shown) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, [])
    byRule.get(f.rule).push(f)
  }
  console.log(`VIS 3.0 八条视觉纪律 · 盘点（扫描 ${WXML.length} 个 wxml / ${WXSS.length} 个 wxss）\n`)
  let hard = 0, soft = 0
  for (const [id, rule] of Object.entries(RULES)) {
    if (ONLY && ONLY !== id) continue
    const list = byRule.get(id) || []
    const h = list.filter((x) => !x.advisory).length
    hard += h; soft += list.length - h
    console.log(`${id} ${rule.title} —— ${list.length ? `${h} 硬 / ${list.length - h} 参考` : '✓ 未发现'}`)
    const byFile = new Map()
    for (const x of list) byFile.set(x.file, (byFile.get(x.file) || 0) + 1)
    const top = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    for (const [file, n] of top) {
      console.log(`    ${file}${n > 1 ? ` ×${n}` : ''}`)
      console.log(`      ${list.find((x) => x.file === file).detail}`)
    }
    if (byFile.size > top.length) console.log(`    …另有 ${byFile.size - top.length} 个文件`)
    console.log()
  }
  console.log(`合计：硬项 ${hard} 条 / 参考项 ${soft} 条。`)
  process.exit(0)
}

/* ── 守卫模式 ───────────────────────────────────────────────────────────── */
const problems = []
const advisories = []
for (const f of findings) (f.advisory ? advisories : problems).push(f)

// 参考项棘轮：基线里没有的 = 新增（要说明）；比基线少的 = 变好了（提示收紧基线）
const now = baselineOf(findings)
const base = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : {}
const grew = []
for (const [k, n] of Object.entries(now)) {
  if (n > (base[k] || 0)) grew.push(`${k}：${base[k] || 0} → ${n}`)
}
const shrank = Object.entries(base).filter(([k, n]) => (now[k] || 0) < n)

console.log(`VIS 3.0 八条视觉纪律 · 守卫（扫描 ${WXML.length} wxml / ${WXSS.length} wxss）`)
if (problems.length) {
  console.error(`\n✗ 硬项 ${problems.length} 条（规范要求为 0）：`)
  problems.forEach((p) => console.error(`  - [${p.rule}] ${p.file}\n      ${p.detail}`))
}
if (advisories.length) {
  console.log(`\n· 参考项 ${advisories.length} 条（不进硬判据，但基线只许变小；权威判定需浏览器实测）`)
}
if (grew.length) {
  console.error(`\n✗ 参考项比基线**增多** ${grew.length} 处（新增就要有理由，并同步 --print-baseline）：`)
  grew.forEach((g) => console.error('  - ' + g))
}
if (shrank.length) {
  console.log(`\n· 参考项比基线减少 ${shrank.length} 处 —— 收口时跑 --print-baseline 收紧（已变好的项要记进台账）`)
}
if (problems.length || grew.length) process.exit(1)
console.log(`\n✓ 通过：硬项 0 / 参考项未超基线（${Object.values(now).reduce((a, b) => a + b, 0)} 条）`)
