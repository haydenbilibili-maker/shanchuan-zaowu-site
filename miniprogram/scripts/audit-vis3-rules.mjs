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
function ruleR2(relPath, src, kind) {
  if (kind !== 'wxss') return []
  const out = []
  const css = stripComments(src)
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].trim().replace(/\s+/g, ' ').slice(0, 60)
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
        if (blur > 4 || (!inset && blur > 0)) {
          out.push(`金色发光：${sels} → ${layer.trim().replace(/\s+/g, ' ').slice(0, 70)}`)
        }
      }
    }
  }
  return out
}

/** R3 一屏一个主按钮 —— 只判**同一父节点下的并列**实心金（页面级计数静态不可判） */
function ruleR3(relPath, src, kind) {
  if (kind !== 'wxss') return []
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

/** R5 左标签，右数值（参考项：金额是否走 --font-mono 需浏览器实测） */
function ruleR5(relPath, src, kind) {
  if (kind !== 'wxml') return []
  return textNodes(src)
    .filter((t) => /¥\s*\{\{|¥\s*\d/.test(t))
    .map((t) => `金额文本：「${t.slice(0, 30)}」—— 确认走 --font-mono`)
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
 * ⚠️ 2026-10-13 第三次校准 —— 这次是**找错了文件**。
 *   前三版都只在 **WXML 片段**里找 `gradient`，可渐隐是写在 **WXSS** 里的：
 *   `pages/index/index.wxss:218` 的 `linear-gradient(180deg, …, var(--color-bg) 100%)`、
 *   `wiki-detail/index.wxss:8` 的 `.hero-overlay { linear-gradient(to bottom, transparent 40%, var(--color-bg)) }`
 *   —— 两处都被误报成「缺渐隐层」。
 *   判据必须**跨到同名 WXSS**去找（这正是错题本 E3 的形态：读的是半个镜像）。
 *   同一条判据一天内错了三次（子串 → `\b` → 找错文件），所以它始终只作**参考项**。 */
const HERO_TOKEN = /(^|\s)(hero|hero-[a-z-]+|[a-z-]+-hero)(\s|$)/
const NOT_HERO = /(^|\s)(hero-plate|hero-content|hero-over-row|hero-credit|hero-topshade|hero-seal)(\s|$)/
/** 渐隐的形态：一个 gradient，且要么到透明、要么到页面底色 */
const FADE_CSS = /gradient\([^)]*(?:transparent|color-bg)/i
function ruleR7(relPath, src, kind) {
  if (kind !== 'wxml') return []
  const out = []
  const s = stripComments(src)
  // 同名 WXSS 在**仓库根**下（relPath 是相对 ROOT 的，不是相对 miniprogram/）——
  // 拼错一层就会永远读到空串，判据静默失效（本条自检会当场抓到）。
  const siblingCss = stripComments(read(join(ROOT, relPath.replace(/\.wxml$/, '.wxss'))))
  for (const m of s.matchAll(/<view\b[^>]*class="([^"]*)"[^>]*>/g)) {
    const cls = m[1].trim()
    if (!HERO_TOKEN.test(cls) || NOT_HERO.test(cls)) continue
    if (/sk-|skeleton|skel-|placeholder/.test(cls)) continue
    const token = cls.split(/\s+/).find((c) => HERO_TOKEN.test(` ${c} `)) || cls.split(/\s+/)[0]
    const seg = s.slice(m.index, m.index + 3000)
    if (!/<image\b|<swiper\b/.test(seg)) continue
    // 渐隐层通常挂在**子元素**上（如首页 `.hero-item` 里的 `.hero-mask-vignette`），
    // 只查容器自身的规则会漏判 —— 所以取该英雄区标记段里**出现过的每一个 class**，
    // 看其中是否有一个在 WXSS 里带渐隐渐变。
    const inWxml = /hero-shade|img-shade|topshade|hero-overlay|mask-vignette|fade/.test(seg)
    let inWxss = false
    if (!inWxml && siblingCss) {
      const segClasses = new Set()
      for (const cm of seg.matchAll(/class="([^"]*)"/g)) {
        for (const c of cm[1].split(/\s+/)) if (c && !c.includes('{')) segClasses.add(c.replace(/[{}]/g, ''))
      }
      for (const r of siblingCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!FADE_CSS.test(r[2])) continue
        const rSels = r[1]
        for (const c of segClasses) {
          if (new RegExp(`\\.${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(rSels)) { inWxss = true; break }
        }
        if (inWxss) break
      }
    }
    if (inWxml || inWxss) continue
    out.push(`主图容器 .${token} 内有图但未见渐隐层（WXML 与同名 WXSS 都没找到）`)
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
  R5: { title: '左标签，右数值', run: (p, s, k) => ruleR5(p, s, k) },
  R6: { title: '空就隐藏', run: (p, s, k) => ruleR6(p, s, k) },
  R7: { title: '图像融入夜色', run: (p, s, k) => ruleR7(p, s, k) },
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
const ADVISORY = { R2: true, R3: true, R5: true, R6: 'partial', R7: true }

/* ── 自检：喂合成样本，证明每条判据都会红 ───────────────────────────────── */
if (has('--selftest')) {
  const CASES = [
    ['R1', 'miniprogram/subpackages/feature/detail/index.wxml', 'wxml',
      '<text>孤品</text><text>镇店</text>', '主图印章一次'],
    ['R2', 'miniprogram/x/index.wxss', 'wxss',
      '.a { text-shadow: 0 0 12rpx rgba(212, 188, 133, 0.45); }', '金色发光'],
    ['R2-neg', 'miniprogram/x/index.wxss', 'wxss',
      '.a { box-shadow: inset 0 1rpx 0 rgba(212, 188, 133, 0.08); }', null],   // 发丝线 = 合规
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
      '<view class="hero-card"><image src="a.png"></image></view>', '渐隐层'],
    ['R7-neg', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="hero-card"><image src="a.png"><view class="hero-shade"></view></view>', null],
    ['R7-neg2', 'miniprogram/x/index.wxml', 'wxml',
      '<view class="sk-hero"><image src="a.png"></image></view>', null],        // 骨架屏不是主图
    ['R8', 'miniprogram/app.wxss', 'wxss',
      '\n.btn-primary { background: red; }', 'nowrap']
  ]
  let ok = true
  for (const [name, path, kind, src, expect] of CASES) {
    const base = name.replace(/-neg2?$/, '')
    const fn = RULES[base.replace(/^R(\d)$/, 'R$1')]
    const hits = fn.run(path, src, kind)
    const isNeg = /-neg2?$/.test(name)
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
