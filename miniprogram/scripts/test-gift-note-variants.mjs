/**
 * 礼赠礼笺「多句候选 + 换一句」行为断言
 *
 * 为什么需要（顾客原话，2026-09-17）：
 *   「AI 生成的礼赠文案较短，可以给丰富的选项，就是点进去好几次都是同样一段话，
 *     也没有更新的标。」
 * 三件事分别对应三类静默失效：
 *   1. **候选不足/重复** —— 一关系只有一句时，点几次都是同一段（旧实现就是 1 句）；
 *   2. **换句机制失效** —— 同一关系再点不换句、或「换一句」是死按钮；
 *   3. **换句了但看不出来** —— 没有句序标（「第 2/3 句」），顾客以为没更新。
 * 另外两条容易踩的边界：手改后关系高亮不能被误清（要跟**全部候选**比对），
 * 以及临时预设（场景语向只有单句）必须继续按旧路径工作。
 *
 * 做法：加载**真源码**（giftNotePresets）跑纯逻辑 + 对 compose 的接线做源级断言。
 *
 * 用法：
 *   node miniprogram/scripts/test-gift-note-variants.mjs
 *   node miniprogram/scripts/test-gift-note-variants.mjs --selftest
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

const PRESETS = 'miniprogram/subpackages/feature/gift/giftNotePresets.js'
const COMPOSE_JS = 'miniprogram/subpackages/feature/gift/compose/index.js'
const COMPOSE_WXML = 'miniprogram/subpackages/feature/gift/compose/index.wxml'
const COMPOSE_WXSS = 'miniprogram/subpackages/feature/gift/compose/index.wxss'

/**
 * 受礼人姓名必填的提示文案 —— **必须只写这一份**。
 *
 * 它在断言 3 处 + 自检注入锚点 1 处被引用。此前 4 处各自硬编码字面量，
 * 于是改一次文案要同时改 4 个地方，而**漏掉注入锚点**的后果不是报错，是：
 * 锚点命中 0 次 → 自检恒失败 → 该守卫再也"证明不了自己会失败"（**假绿**）。
 *
 * 这不是假想：同一个文件下面那条 `去掉必填拦截` 注入，2026-09-18 就因为弹窗迁到 AppToast
 * 而让旧锚点命中 0 次（见本文件 selftest 内注释）；`test-wallet-hub-lifecycle.mjs` 也留了
 * 同形态的记录（旧锚点 `'  methods: _methods,\n'` 命中 0 次）。
 * 故本次直接让锚点引用常量：**文案与锚点同源，改文案不可能只改一半**。
 *
 * 产品负责人 2026-09-19 验收口径：用**受礼人**（不是「写给谁」），并加「务必」。
 */
const RECIPIENT_REQUIRED_TOAST = '请务必填写受礼人姓名'

let passed = 0
let failed = 0
const failures = []
function check(name, cond, extra) {
  if (cond) passed += 1
  else {
    failed += 1
    failures.push(`${name}${extra ? ' — ' + extra : ''}`)
  }
}
function eq(name, got, want) {
  check(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}

/** 仓根是 "type":"module"，小程序源码是 CJS → 自己喂 module/exports 执行真源码 */
function loadCjs(file) {
  const src = readFileSync(resolve(ROOT, file), 'utf8')
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', src)(module, module.exports)
  return module.exports
}

/** 断言「代码」而不是注释 */
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const presets = loadCjs(PRESETS)
const composeJs = stripComments(readFileSync(resolve(ROOT, COMPOSE_JS), 'utf8'))
const composeWxml = readFileSync(resolve(ROOT, COMPOSE_WXML), 'utf8')

/* ── 1) 候选内容 ─────────────────────────────────────────────────────────── */
const LIST = presets.GIFT_NOTE_PRESETS
check('关系预设存在', Array.isArray(LIST) && LIST.length >= 6, `实际 ${LIST && LIST.length}`)

/* ── 2026-09-21 产品负责人：「送礼的对象目前只有爱人、妻子、同事…现在拓展更多角色」──
 * 扩到 14 个（伴侣/家人/挚友/师长/职场/自己）。两条防回退：
 *   ① 角色数与**关键角色**不许回退（删掉 "看起来用不上" 的角色 = 又把场景砍回去）；
 *   ② chip 必须**换行铺开** —— 原来是不换行的横向滚动，一屏只露 5–6 个，
 *      新增的「老师 / 领导 / 长辈」等于藏起来，"拓展"就白做。 */
check('★ 关系角色已拓展到 ≥20 个（不许回退）', LIST.length >= 20, `实际 ${LIST.length}`)
/* ★ 正文字数上限必须**由打印尺寸反推**，且 UI 只能引用它（2026-09-21 集成官加）。
 * 起因：产品负责人「礼信笺文案允许自己编辑，但需要限定一下字数，使其符合打印尺寸要求」。
 * 实测（真渲染，见 render-gift-print-preview）：贴纸正文带**永不截断**，
 * 155 字 ✓ / 158 字 ✗（0 行 = 整段消失），而**改动前 UI 上限是 200 字** ⇒ 写满的顾客贴纸上没有正文。
 * 判据三件：① 常量存在且 ≤ 实测断点（留余量）；② UI 不许再写死 200；③ 提示要说清原因。 */
{
  const cardMod = loadCjs('miniprogram/subpackages/feature/gift/giftShareCard.js')
  const LIMIT = cardMod && cardMod.GIFT_NOTE_MAX_CHARS
  check('★ 打印模块导出正文字数上限 GIFT_NOTE_MAX_CHARS', typeof LIMIT === 'number' && LIMIT > 0, String(LIMIT))
  check('★ 上限 ≤ 实测断点 155（贴纸 158 字就整段不画）', LIMIT <= 155, `实际 ${LIMIT}`)
  check('★ 上限不至于过紧（预设最长句也放得下，且留出余量）', LIMIT >= 100, `实际 ${LIMIT}`)
  check('★ 编排页用常量而不是写死 200',
    /maxlength="\{\{noteMaxChars\}\}"/.test(composeWxml) && !/maxlength="200"/.test(composeWxml)
    && /\{\{cardBody\.length\}\}\/\{\{noteMaxChars\}\}/.test(composeWxml),
    'textarea 或计数仍写死 200')
  check('★ 上限的**原因**在界面上说得出来（否则用户以为是无理限制）',
    /noteLimitHint/.test(composeJs) && /贴纸|打印/.test(composeJs) && /noteLimitHint/.test(composeWxml))
}

/* ★ 跨关系**长片段**不许复用（2026-09-21 集成官加）。
 * 「完全相同的句子」已有判据，但那挡不住"每段都换个开头、后半句照抄" ——
 * 那正是顾客抱怨的「点进去好几次都是同样一段话」。
 * 加这条当天就抓到我自己写的 12 个角色：老师/师父共享 **41 字**、朋友/同学 30 字。
 * 判据：任意两个关系之间，最长公共子串必须 **< 14 字**（同义的house phrase 如
 * 「挑了件安静的藏品」可以留，整句话不许照搬）。 */
{
  const lcs = (a, b) => {
    let best = 0
    let prev = new Array(b.length + 1).fill(0)
    for (let i = 1; i <= a.length; i++) {
      const cur = new Array(b.length + 1).fill(0)
      for (let j = 1; j <= b.length; j++) {
        if (a[i - 1] === b[j - 1]) { cur[j] = prev[j - 1] + 1; if (cur[j] > best) best = cur[j] }
      }
      prev = cur
    }
    return best
  }
  let worst = { n: 0, pair: '' }
  for (let i = 0; i < LIST.length; i++) {
    for (let j = i + 1; j < LIST.length; j++) {
      for (const x of LIST[i].bodies) {
        for (const y of LIST[j].bodies) {
          const n = lcs(x, y)
          if (n > worst.n) worst = { n, pair: `${LIST[i].label}/${LIST[j].label}` }
        }
      }
    }
  }
  check('★ 跨关系最长公共片段 < 14 字（防"换开头照抄后半句"）', worst.n < 14,
    `最差 ${worst.pair} 共享 ${worst.n} 字 —— 请重写该句，别整句照搬`)
}
{
  const want = ['lover', 'husband', 'wife', 'child', 'parents', 'elder', 'junior',
    'bestie', 'brother', 'friend', 'classmate', 'fellow',
    'teacher', 'master', 'colleague', 'leader', 'team', 'client', 'partner', 'self']
  const ids = LIST.map((p) => p.id)
  const lost = want.filter((id) => ids.indexOf(id) === -1)
  check('★ 关键角色一个都不能少（丈夫/孩子/长辈/老师/朋友/领导 等）', lost.length === 0,
    `缺：${lost.join('、') || '（无）'}`)
  check('角色 id 不重复', new Set(ids).size === ids.length)
  check('「犒劳自己」仍在最后（self 有独立默认地址逻辑）', ids[ids.length - 1] === 'self', ids.join(','))
}
check('★ 关系 chip 换行铺开（不是横向滚动 —— 否则新增角色会被藏起来）',
  /class="note-preset-row"/.test(composeWxml) && !/scroll-x/.test(composeWxml),
  'compose 页仍有 scroll-x 的关系条')
{
  const wxss = readFileSync(resolve(ROOT, COMPOSE_WXSS), 'utf8')
  const row = (/\.note-preset-row\s*\{([^}]*)\}/.exec(wxss) || [])[1] || ''
  check('★ 关系 chip 容器是 flex-wrap（视觉上真的换行）',
    /flex-wrap:\s*wrap/.test(row), row.trim() || '找不到 .note-preset-row')
}

const counts = LIST.map((p) => presets.presetBodyCount(p))
check('★ 每个关系都有多句候选（不再是「一关系一文案」）', counts.every((n) => n >= 3),
  `实际每关系句数：${LIST.map((p) => `${p.id}=${presets.presetBodyCount(p)}`).join(' ')}`)

const flat = LIST.flatMap((p) => (p.bodies || []).map((b) => String(b)))
check('候选总句数 ≥ 关系数×3', flat.length >= LIST.length * 3, `${flat.length} 句`)
// ⚠️ 2026-09-21：这条原来查的是"≤200（textarea 旧上限）" —— 比**打印上限**还宽。
//    预设句是官方文案，必须**印得出来**，所以改查 GIFT_NOTE_MAX_CHARS。
check(`★ 每句都在打印上限内（≤${loadCjs('miniprogram/subpackages/feature/gift/giftShareCard.js').GIFT_NOTE_MAX_CHARS} 字）`,
  flat.every((b) => b.length <= loadCjs('miniprogram/subpackages/feature/gift/giftShareCard.js').GIFT_NOTE_MAX_CHARS),
  `最长 ${Math.max(...flat.map((b) => b.length))} 字`)
check('★ 每句都不再过短（≥40 字，回应「文案较短」）', flat.every((b) => b.length >= 40),
  `最短 ${Math.min(...flat.map((b) => b.length))} 字`)
check('同关系内无重复句', LIST.every((p) => new Set(p.bodies).size === p.bodies.length))
check('跨关系无重复句（否则「换一句」可能给出同一段）', new Set(flat).size === flat.length)
check('每句都非空白', flat.every((b) => b.trim().length > 0))
check('body 保留为 bodies[0]（兼容仍读单句的调用方）',
  LIST.every((p) => p.body === p.bodies[0]))

/* ── 2) pickPresetBody 的边界 ────────────────────────────────────────────── */
const first = presets.getPresetById('lover')
eq('getPresetById 命中', !!first, true)
eq('★ 依次取三句互不相同', new Set([0, 1, 2].map((i) => presets.pickPresetBody(first, i))).size, 3)
eq('★ 取模回绕（第 4 次回到第 1 句）', presets.pickPresetBody(first, 3), presets.pickPresetBody(first, 0))
eq('负数也安全（-1 → 最后一句）', presets.pickPresetBody(first, -1), presets.pickPresetBody(first, 2))
eq('非法入参回落第 1 句', presets.pickPresetBody(first, 'x'), presets.pickPresetBody(first, 0))
eq('★ 临时预设（场景语向只有 body）按旧行为回落',
  presets.pickPresetBody({ id: 'scene_x', body: '场景语向' }, 2), '场景语向')
eq('空预设不抛错', presets.pickPresetBody(null, 1), '')

/* ── 3) compose 接线（源级）──────────────────────────────────────────────── */
check('★ 同一关系再点一次 → 换下一句（而不是重复同一段）',
  /onNotePresetTap\(e\)[\s\S]*?id === this\.data\.activeNotePresetId[\s\S]*?% total/.test(composeJs),
  'onNotePresetTap 未按「同一关系取下一句」实现')
check('★ 存在「换一句」处理器且会前进一句',
  /onNoteShuffle\(\)[\s\S]*?noteVariantIndex \+ 1/.test(composeJs),
  'onNoteShuffle 不存在或未推进句序')
check('★ 「换一句」有可见入口（wxml 上可点）',
  /bindtap="onNoteShuffle"/.test(composeWxml),
  'wxml 上没有 onNoteShuffle 的入口 → 顾客看不到「更新」的动作')
check('★ 有句序标让「确实换了」可见（第 n/N 句）',
  /noteVariantLabel/.test(composeJs) && /\{\{noteVariantLabel\}\}/.test(composeWxml),
  '没有句序标 → 顾客仍会觉得「没更新」')
check('句序标只在多句候选且已选关系时出现',
  /wx:if="\{\{activeNotePresetId && noteVariantTotal > 1\}\}"/.test(composeWxml))
check('★ 手改后关系高亮按**全部候选**比对（选到第 2/3 句不会被误判成已手改）',
  /bodies\.indexOf\(cardBody\) === -1/.test(composeJs),
  'onCardInput 仍在只比 preset.body → 选第 2/3 句会立刻掉高亮、再点又从头开始')
check('落笔仍走同一条 startNoteWrite 路径（不禁用落笔动画）',
  /startNoteWrite\(Object\.assign\(\{\}, preset, \{ body \}\)\)/.test(composeJs))
check('替换前仍会确认（手写内容不被静默覆盖）',
  /requestNoteReplace\(preset, variant, '用推荐文案替换当前内容？'\)/.test(composeJs)
  && /替换礼笺？/.test(composeJs))
/* ── 藏品题记：**叠加层**（2026-09-17 按产品负责人口径修正） ───────────────
 * 题记不占正文：它与场景文案/关系标签/手写正文**叠加展示**，互不替换。
 */
check('★ 礼笺页有题记层（card-epigraph），且读的是 产品 的 themeName+themeNote',
  /class="card-epigraph"/.test(composeWxml) && /\{\{product\.themeNote\}\}/.test(composeWxml))
check('★ 题记**不与正文互斥**：题记层与正文控件同时存在（不再是二选一）',
  composeWxml.indexOf('card-epigraph') < composeWxml.indexOf('bindinput="onCardInput"'),
  '题记应在正文控件之前叠加展示')
check('★ 题记不写进正文（不再预填 cardBody）',
  !/_maybeApplyThemeNote/.test(composeJs) && /_maybeApplySceneNote\(\)/.test(composeJs),
  '预填会把题记占用为正文 → 与场景/身份文案互斥（本次要改掉的行为）')
check('★ 题记层样式存在（铜金左线，区分于正文）', /\.card-epigraph\s*\{/.test(readFileSync(resolve(ROOT, COMPOSE_WXSS), 'utf8')))

/* ── 手写体与逐字落笔（2026-09-17，方案 B：系统楷体栈 + 落笔增强，零体积） ───── */
check('★ 手写体令牌是**系统字体栈**（无 webfont、零体积）',
  /--font-hand:[^;]*HanziPen SC/.test(readFileSync(resolve(ROOT, 'miniprogram/app.wxss'), 'utf8')),
  '改成了 webfont 就会引入下载与首屏闪烁')

/* ── 印刷版礼笺卡（A6@300dpi，礼赠履约导出用；2026-09-17）─────────────────── */
{
  const card = readFileSync(resolve(ROOT, 'miniprogram/subpackages/feature/gift/giftShareCard.js'), 'utf8')
  check('★ 印刷版渲染器存在且导出', /function paintGiftPrintCard\(/.test(card) && /renderGiftPrintImage,/.test(card))
  check('★ 规格为 **A6** 竖版 @300dpi（1240 × 1748 = 105 × 148 mm）',
    /const PRINT_W = 1240/.test(card) && /const PRINT_H = 1748/.test(card))
  const printBody = (function () {
    // 按**函数边界**切片（固定窗口会切到下一个函数，导致误判）
    const i = card.indexOf('function paintGiftPrintCard(')
    if (i < 0) return ''
    const j = card.indexOf('\nfunction ', i + 10)
    return card.slice(i, j < 0 ? card.length : j)
  })()
  check('★ **满幅无黑边**（印刷用；不做深色外框）', printBody.length > 0 && !/#1A1814/.test(printBody),
    '印刷卡不该有博物黑外框（打印/裁切不便）')
  check('★ 正文在题记与署名之间**垂直居中**（短笺不空、长笺不挤）',
    /freeBottom - freeTop - bodyBlockH/.test(card))
  check('★ 页脚带独立、正文区让位（真图曾出现两枚码压住署名）',
    /const FOOTER_H = Math\.round\(30 \* MM\)/.test(card)
    && /const signTop = footerTop - Math\.round\(8 \* MM\)/.test(card),
    '码的高度必须从正文可用高度里扣掉，否则会压住正文与署名')
  check('★ 页脚带内排布：码的 y 从 footerTop 起（不再向上顶）', /const y = footerTop \+ Math\.round\(2 \* MM\)/.test(card))
  // 真图曾因 maxLines 截断**丢了一整行正文** ✗ → 内容安全必须钉死
  check('★★ 正文**自适应缩放、永不截断**（印刷卡不能丢字）',
    /while \(fontPx > 28 && bodyLines\.length \* lineH > availH\)/.test(card)
    && /wrapLines\(ctx, text, axisRight - axisX, 999\)/.test(card)
    && !/wrapLines\(ctx, String\(o\.cardBody \|\| ''\), axisRight - axisX, maxLines\)/.test(card),
    '按 maxLines 截断会在卡上丢字（真图已发生）')
  check('★ 署名下划线不超过字宽附近（免得越过右侧两枚码）',
    /Math\.max\(sw, Math\.round\(14 \* MM\)\)/.test(card))
  check('★ 改纸张只改常量：绘制按设计稿等比放大（setTransform(S,…)）',
    /const S = PRINT_W \/ PRINT_DESIGN_W/.test(card) && /ctx\.setTransform\(S, 0, 0, S, 0, 0\)/.test(card))
  check('★ 印刷卡**必须**画题记带（分享卡不画，这是两者的关键区别）',
    /const themeName = String\(o\.themeName/.test(card) && /const themeNote = String\(o\.themeNote/.test(card),
    '印刷卡缺题记 → 印出来会少掉主题名与那句话')
  check('★ 分享卡未被改动（分享卡绘制函数仍在、未被印刷版替换）',
    /function paintGiftShareCard\(canvas, opts\)/.test(card) && /SHARE_CARD_W: W,/.test(card))
  check('印刷卡复用共享换行/圆角工具（不另造）', /wrapLines\(ctx, text, axisRight - axisX/.test(card) && /roundRect\(ctx, cardX/.test(card))
  // 2026-09-17 真图暴露的两个重叠 bug → 钉成不变量
  // 版式按前端礼笺卡定稿（2026-09-18）：印章在右上、署名在左下 → 分区不相撞
  check('★ 署名与两枚码**分区**不相撞（署名左 / 码右）',
    /let cx = qrRight/.test(card)
    && /const footBase = footerTop \+ Math\.round\(20 \* MM\)/.test(card),
    '印章与署名必须在不同分区，否则会叠在一起')
  check('★ 题记带整宽（axisX → axisRight）', /const bandW = axisRight - axisX/.test(card))
  // 作用域限定在**印刷卡**函数体内（分享卡里本来就有 drawImage，不能一起判）
  const printFn = (function () {
    // 按**函数边界**切片（固定窗口会切到下一个函数，导致误判）
    const i = card.indexOf('function paintGiftPrintCard(')
    if (i < 0) return ''
    const j = card.indexOf('\nfunction ', i + 10)
    return card.slice(i, j < 0 ? card.length : j)
  })()
  check('版式对齐前端：印刷卡不放藏品图（前端那张卡也没有，避免图压题记）',
    printBody.length > 0 && !/specimenImage/.test(printBody), '若加回藏品图，必须重新处理与题记带的重叠（两枚码用 drawImage 属正常）')
  check('★ 题记与正文共用同一左轴', /const axisX = cardX \+ pad/.test(card) && /ctx\.fillText\(bodyLines\[i\], axisX,/.test(card))
  check('底部有落款日期（填住下半版空白）', /padStart\(2, '0'\)/.test(card) && /ctx\.fillText\(dateText/.test(card))
  // 2026-09-18：印刷卡版式**学习前端礼笺卡**（compose 的 .card-*）
  check('★ 印刷卡首行是「写给 · TA」（学前端 .card-*）', /写给 · /.test(card) && /o\.recipientName/.test(card))
  check('★ 两枚码各 **15mm**，右边界贴**内框内侧 4mm**（不再误用文字轴，右移约 10mm）',
    // 2026-09-20：文案改由 `PRINT_QR_COPY` 统一供给（旧字面量 '扫码进店' 已作废），
    //   判据只认"尺寸 + 右边界 + 文案来自常量"这三件事 —— 不再钉某一句具体的话。
    /caption: PRINT_QR_COPY\.miniprogram, size: Math\.round\(15 \* MM\)/.test(card)
    && /caption: PRINT_QR_COPY\.service, size: Math\.round\(15 \* MM\)/.test(card)
    && /const qrRight = cardX \+ cardW - Math\.round\(4 \* MM\)/.test(card)
    && /let cx = qrRight/.test(card),
    '码的右边界若用 axisRight，等于把左内边距算两次 → 离纸边过远')
  check('★ 正文用**手写体**且基线 **40px**（自适应下限 28px；产品负责人要求放大）',
    /HanziPen SC/.test(card) && /fontPx \+ 'px ' \+ HAND/.test(card) && /let fontPx = 40/.test(card) && /while \(fontPx > 28/.test(card))
  /* ⚠️ 2026-09-20 修一条**恒真**判据（错题本 E7：判据自身失效）：
   * 原文锚点是 `'// 页脚带：左＝署名'`，而源码那行前面还有 `── `（盒线字符）→ `indexOf` 返回 **-1**
   * → `''.slice(-1, 2599)` = `''` → 正则恒不命中 → `!false` = **恒真**。
   * 也就是说"卡上不得有水印"这条**从来没生效过**（真加了水印也照样绿）。
   * 现在改成：整段代码里都不许出现 `globalAlpha` 的水印写法 —— 不再依赖任何偏移锚点。 */
  check('★ 卡上**不得有**水印（`globalAlpha` 洗淡写法；定稿：页脚已被署名+两枚码占满，再叠会糊）',
    !/globalAlpha\s*=\s*0\.0[0-9]/.test(stripComments(card)),
    '整份源码里出现 globalAlpha 低透明度水印 —— 定稿明确不要（且热敏纸上会糊）')
}

/* ── 礼赠履约页「导出礼笺图」接线（印刷用；2026-09-17）────────────────── */
{
  const OPS_JS = 'miniprogram/subpackages/manager/gift-ops/index.js'
  const OPS_WXML = 'miniprogram/subpackages/manager/gift-ops/index.wxml'
  const opsJs = stripComments(readFileSync(resolve(ROOT, OPS_JS), 'utf8'))
  const card = readFileSync(resolve(ROOT, 'miniprogram/subpackages/feature/gift/giftShareCard.js'), 'utf8')  // 本块也用到（块级作用域）
  const opsWxml = readFileSync(resolve(ROOT, OPS_WXML), 'utf8')
  check('★ 履约页有「导出礼笺图」入口', /导出礼笺图/.test(opsWxml) && /onExportGiftCard/.test(opsWxml))
  check('★ 用共享印刷渲染器（不另造画布逻辑）', /renderGiftPrintImage\('#giftPrintCanvas', this, \{/.test(opsJs))
  check('★ 导出侧传两枚码路径（打印专用**透明 PNG**，均已确认未被打包忽略）',
    /qrcodePath: '\/subpackages\/manager\/assets\/qrcode\/miniprogram-code-print\.png'/.test(opsJs)
    && /serviceQrPath: '\/assets\/qrcode\/wechat-assistant-qr-print\.png'/.test(opsJs))
  // 透明 PNG 必须真的透明：索引色 PNG 靠 tRNS 块承载 alpha（只看 IHDR 颜色类型会误判）
  ;['miniprogram/subpackages/manager/assets/qrcode/miniprogram-code-print.png',
    'miniprogram/assets/qrcode/wechat-assistant-qr-print.png'].forEach((rel) => {
    const buf = readFileSync(resolve(ROOT, rel))
    const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const ct = buf[25]
    const hasAlpha = ct === 4 || ct === 6 || buf.includes(Buffer.from('tRNS'))
    check(`★ ${rel.split('/').pop()} 是**透明** PNG（alpha 或 tRNS）`, isPng && hasAlpha,
      '两枚码要求透明底，否则贴在米白卡面上会露出白方块')
  })
  check('★ 卡上不再给码画白色底托（否则透明无意义）',
    !/fillStyle = '#FFFFFF'/.test(card.slice(card.indexOf('// 两枚码：从右往左排'), card.indexOf('// 两枚码：从右往左排') + 1200)))
  check('★ 导出侧传入 recipientName（多来源：recipientName/salutation/toName/address.name）',
    /recipientName: item\.recipientName \|\| item\.salutation \|\| item\.toName/.test(opsJs),
    '只取一个字段会在别的单子上落空（实名制印刷卡不能印错）')
  check('★ 底部两枚码：小程序码 + 客服微信码（缺失各自静默跳过）+ 各自文案来自同一常量',
    /o\.qrcodeImage/.test(card) && /o\.serviceQrImage/.test(card)
    && /PRINT_QR_COPY\.miniprogram/.test(card) && /PRINT_QR_COPY\.service/.test(card))
  check('★ 姓名为空时**不印**「写给 · 受礼人」占位（印刷卡不该有假称呼）',
    /if \(toName\) \{/.test(card) && !/写给 · 受礼人/.test(card))
  const printOnly = (function () {   // 断言内内联切片（避免跨块作用域坑）
    const i = card.indexOf('function paintGiftPrintCard(')
    if (i < 0) return ''
    const j = card.indexOf('\nfunction ', i + 10)
    return card.slice(i, j < 0 ? card.length : j)
  })()
  check('★ 卡上**不得有「山海」印章**（产品负责人 2026-09-19 定稿：去掉更干净）',
    printOnly.length > 0 && !/#B23A2E/.test(printOnly) && !/fillText\('山'/.test(printOnly),
    '印章已按定稿移除；若加回需同步这条断言并说明原因')
  check('★ 引主包实现（分包之间不得互相 require）',
    opsJs.indexOf("require('../utils/giftShareCard')") !== -1 && opsJs.indexOf("require('../../feature/") === -1,
    '跨分包 require 微信会拦')
  check('★ 离屏画布挂在页面上（canvas 2d 取 node 要求已渲染）', /id="giftPrintCanvas"/.test(opsWxml))
  check('★ 礼笺正文/署名取自 getBoardDetail', /action: 'getBoardDetail'/.test(opsJs) && /d\.cardBody/.test(opsJs))
  check('★ 云函数 getBoardDetail 回传 productId（消除按标题回查的重复标题风险）',
    /productId: \(order\.products && order\.products\[0\]/.test(readFileSync(resolve(ROOT, 'miniprogram/cloudfunctions/manageGift/index.js'), 'utf8')))
  check('★ 客户端**优先**按 productId 精确取题记/配图',
    /const productId = String\(d\.productId \|\| ''\)/.test(opsJs)
    && /db\.collection\('products'\)\.doc\(productId\)/.test(opsJs), '仍只按标题回查')
  check('★ 保留标题回退（兼容云函数未部署新版）',
    /where\(\{ title: productTitle \}\)/.test(opsJs) && /themeNote: true/.test(opsJs))
  check('★ 落盘：存相册 + 上传云存储（印刷厂取件）',
    /saveImageToPhotosAlbum/.test(opsJs) && /wx\.cloud\.uploadFile/.test(opsJs) && /gift-print\//.test(opsJs))
  check('★ 数据库句柄已就位（履约页原不直连库，漏了会运行时报错）', /const db = wx\.cloud\.database\(\)/.test(opsJs))
}

// 2026-09-19 iOS 真机修复两条：① 逐字 span + animation:both → 每帧重播动画 = 回跳闪白 ✗；
//   ② iOS 的 textarea 不支持 font-family（原生组件样式白名单内没有）→ 未聚焦时必须用 text 展示手写体。
check('★ 落笔用**整段文本**渲染，不得再用逐字 span（iOS 回跳闪白根因）',
  !/writeChars/.test(composeJs) && !/writeChars/.test(composeWxml) && !/card-write-char/.test(readFileSync(resolve(ROOT, COMPOSE_WXSS), 'utf8')))
// 2026-09-19 iOS 实机仍显示系统字体 → 改用**字面量字体栈**（不依赖 var()），并把变量改单行。
const appWxss = readFileSync(resolve(ROOT, 'miniprogram/app.wxss'), 'utf8')
const composeWxssSrc = readFileSync(resolve(ROOT, COMPOSE_WXSS), 'utf8')
const ruleOf = (src, sel) => {
  const i = src.indexOf(sel + ' {')
  return i < 0 ? '' : src.slice(i, src.indexOf('}', i) + 1)
}
// 2026-09-19 结论：iOS 的 WebView 取不到中文手写族 → 改用 loadFontFace + 网络字体（自定义族名 ShanhaiHand）
const handFontJs = readFileSync(resolve(ROOT, 'miniprogram/utils/handFont.js'), 'utf8')
check('★★ 手写体走 loadFontFace（iOS 系统字体栈取不到手写族）', /wx\.loadFontFace\(/.test(handFontJs))
check('★★ loadFontFace 必须 global:true 且 scopes 含 native（否则 iOS 的 text 用不上）',
  /global: true/.test(handFontJs) && /scopes: \['webview', 'native'\]/.test(handFontJs),
  '缺 native scope 时 iOS 上 <text> 不会应用该字体')
{
  // 顺序不变量：loadFontFace 的首选路径依赖 cloud.init —— 必须在 init **之后**调用
  //（2026-09-19 真机事故：写在 app.js 模块求值期 → 早于 onLaunch 里的 cloud.init → downloadFile 必失败，
  //  真机上 https 兜底又没白名单 → 字体永远加载不上；模拟器因 macOS 有系统手写族而"看起来正常"）
  const appJs = readFileSync(resolve(ROOT, 'miniprogram/app.js'), 'utf8')
  const iInit = appJs.indexOf('wx.cloud.init(')
  const iHand = appJs.indexOf('ensureHandFont')
  check('★★ app.js 里手写体加载必须在 cloud.init **之后**（否则 downloadFile 必失败）',
    iInit >= 0 && iHand > iInit,
    '写在模块求值期会早于 cloud.init → 真机上字体加载不上（模拟器会因系统字体而误判为正常）')
}
check('★★ 多源链：**https 优先**（实测公开可读、不依赖 cloud.init）→ 云探测 → 1.5s 重试',
  /tryLoad\(FONT_HTTPS, 'https'\)/.test(handFontJs) && /https-retry/.test(handFontJs),
  '真机事故：原先只在 downloadFile 失败时才试 https，而 loadFontFace 不接受本地路径 → 永不加载')
check('★★ 不得把本地临时路径直接交给 loadFontFace（它只接受网络 URL）',
  !/loadFontFace\(\{[^}]*tempFilePath/s.test(handFontJs))
check('★ WXSS 里自定义族名 **ShanhaiHand 置首**（系统名仅作兜底）',
  /font-family: 'ShanhaiHand', /.test(composeWxssSrc) && /font-family: 'ShanhaiHand', /.test(readFileSync(resolve(ROOT, 'miniprogram/subpackages/feature/wish-wall/index.wxss'), 'utf8')))
check('★ OFL 许可与托管已记录（许可要求保留版权声明）', /OFL-1\.1/.test(readFileSync(resolve(ROOT, 'miniprogram/docs/手写体字体_许可与托管.md'), 'utf8')))
check('★★ 礼笺展示元素用**字面量**手写体栈（不再依赖 var() —— iOS 实测 var 未生效）',
  /"HanziPen SC"/.test(ruleOf(composeWxssSrc, '.card-write-text'))
  && /"HanziPen SC"/.test(ruleOf(composeWxssSrc, '.card-note-display')),
  '只用 var(--font-hand) 在 iOS 实机上会落回默认字体')
check('★★ --font-hand 的值必须**单行**（跨行是小程序 WXSS 编译器的已知风险点）',
  /--font-hand:[^;\n]*;[ \t]*\n/.test(appWxss) && !/--font-hand:[^;\n]*,\s*\n/.test(appWxss),
  '自定义属性值跨行可能导致变量解析失败')
check('祈福墙同机制一并修好（字面量栈）',
  /"HanziPen SC"/.test(readFileSync(resolve(ROOT, 'miniprogram/subpackages/feature/wish-wall/index.wxss'), 'utf8')))
// 2026-09-19 署名默认带出账号昵称：函数原本只在 onLoad 调一次，而那时 globalData.userSession
// 尚未灌入 → 昵称取不到（看起来像"没有自动带出"）。修法：onShow 再调 + 空则 800ms 重试 + 输入框启用微信昵称填写。
check('★ 署名默认带昵称：**onLoad 与 onShow 两处都调**（后者修时序）',
  (composeJs.match(/this\._hydrateSenderSignature\(\)/g) || []).length >= 2,
  '只在 onLoad 调会在会话就绪前取不到昵称（本次真机反馈的根因）')
check('★ 昵称未就绪时**延迟重试**', /_sigHydrateTimer = setTimeout\(\(\) => this\._hydrateSenderSignature\(\)/.test(composeJs))
check('★ 署名输入框启用微信「昵称填写」能力（账号无昵称时一键填）', /type="nickname"/.test(composeWxml))
check('★ 未聚焦时用**手写体 text 展示**（wx:elif=!cardFocused + card-note-display）',
  /wx:elif="\{\{!cardFocused\}\}"/.test(composeWxml) && /card-note-display/.test(composeWxml))
check('★ 只有聚焦时才用 textarea（focus 受 cardFocused 控制）',
  /focus="\{\{cardFocused\}\}"/.test(composeWxml) && /onCardBlur\(\)/.test(composeJs) && /focusCardInput\(\)/.test(composeJs))
check('★ 展示态保留换行（white-space: pre-wrap）',
  /white-space: pre-wrap/.test(readFileSync(resolve(ROOT, COMPOSE_WXSS), 'utf8')))

check('埋点带上句序（便于回看哪一句更常用）',
  /label: preset\.label,\s*\n\s*variant: index \+ 1/.test(composeJs))

/* ── 需求 9：受礼人姓名必填 + 犒劳自己默认账号昵称（2026-09-18；文案口径 2026-09-19）────── */
const composeJsRaw = readFileSync(resolve(ROOT, COMPOSE_JS), 'utf8')
check('★ 必填：goPay 里空名字会拦下并提示（不再静默带去空受礼人）',
  new RegExp(RECIPIENT_REQUIRED_TOAST).test(composeJs)
  && /if \(!String\(this\.data\.recipientName \|\| ''\)\.trim\(\)\) \{[\s\S]{0,200}?return/.test(composeJs))
check('★ 必填拦截发生在进入确认订单之前',
  composeJs.indexOf(RECIPIENT_REQUIRED_TOAST) < composeJs.indexOf('navigateToConfirmOrder(['))
check('★ 空名字时聚焦回输入框（用户知道要改哪里）',
  new RegExp(`if \\(!String\\(this\\.data\\.recipientName \\|\\| ''\\)\\.trim\\(\\)\\) \\{[\\s\\S]{0,160}?recipientEditing: true[\\s\\S]{0,160}?${RECIPIENT_REQUIRED_TOAST}`).test(composeJs))
check('★ 犒劳自己（self）默认写账号昵称：落笔入口统一处理',
  /if \(preset\.id === 'self'\) this\.applyToSelfRecipientDefault\(\)/.test(composeJs))
check('★ 默认值只在空的时候补，不覆盖用户已填的名字',
  /applyToSelfRecipientDefault\(\) \{[\s\S]{0,220}?if \(current\) return/.test(composeJs))
check('★ 昵称来源复用账号昵称解析（globalData → session → 会员卡快照）',
  /applyToSelfRecipientDefault\(\) \{[\s\S]{0,260}?_resolveAccountNickName\(\)/.test(composeJs))
check('★ 占位文案随关系切换（必填可见；犒劳自己指向「你的昵称」）',
  /recipientPlaceholder: preset\.id === 'self' \? '你的昵称（也可改）' : 'TA 的名字（必填）'/.test(composeJs)
  && /placeholder="\{\{recipientPlaceholder\}\}"/.test(composeWxml))
check('  └ placeholder 不再硬编码（否则占位文案永远不会变）',
  !/placeholder="TA 的名字"/.test(composeWxml))
check('提交时仍把受礼人带进 giftMeta（名字不能只停在界面）',
  /recipientName: String\(this\.data\.recipientName \|\| ''\)\.trim\(\)/.test(composeJsRaw))

/* ── 输出 / 自检 ─────────────────────────────────────────────────────────── */
if (process.argv.includes('--selftest')) {
  selftest()
} else if (failed) {
  console.log('✗ 礼笺多句候选检查失败：')
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`✗ ${failed} 项失败 / ${passed} 项通过`)
  process.exit(1)
} else {
  console.log(`✓ 礼笺多句候选：${passed} 项通过（每关系 3 句 / 换一句可点 / 句序标可见 / 手改不被误清）`)
}

function selftest() {
  const injections = [
    {
      name: '履约页漏掉 db 定义（导出时运行时报错）',
      file: 'miniprogram/subpackages/manager/gift-ops/index.js',
      from: 'const db = wx.cloud.database()',
      to: 'const db = null'
    },
    {
      name: '正文字数上限被放宽到 200（贴纸会整段不画）',
      file: 'miniprogram/subpackages/feature/gift/giftShareCard.js',
      from: 'const GIFT_NOTE_MAX_CHARS = 140',
      to: 'const GIFT_NOTE_MAX_CHARS = 200'
    },
    {
      name: '编排页把上限写死回 200（与打印模块脱钩）',
      file: COMPOSE_WXML,
      from: 'maxlength="{{noteMaxChars}}"',
      to: 'maxlength="200"'
    },
    {
      name: '跨关系照抄长句（换开头、后半句整段搬）',
      file: PRESETS,
      from: "      '这份心意不贵重，但来得清楚。摆在书桌一角就好——将来想起今天，还知道有人一直站在你这边。'",
      to: "      '这份心意不贵重，但来得清楚。摆在书桌一角就好——将来想起今天，还知道有人一直站在你这边。',\n      '同好也说一句：这份心意不贵重，但来得清楚。摆在书桌一角就好。'"
    },
    {
      name: '关系角色被砍回 8 个（把新增的角色删掉）',
      file: PRESETS,
      from: "  {\n    id: 'teacher',",
      to: "  {\n    id: 'teacher_removed',"
    },
    {
      name: '关系 chip 退回横向滚动（新增角色会被藏在屏幕外）',
      file: COMPOSE_WXSS,
      from: '  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 12rpx;',
      to: '  display: flex;\n  align-items: center;\n  gap: 12rpx;'
    },
    {
      name: '礼笺字体退回只依赖 var()（iOS 会落回默认字体）',
      file: COMPOSE_WXSS,
      from: "  font-family: 'ShanhaiHand', \"HanziPen SC\", \"Hannotate SC\", \"STKaiti\", \"Kaiti SC\", KaiTi, \"\u6977\u4f53\", \"Songti SC\", serif;\n  font-size: var(--fs-28);",
      to: "  font-family: var(--font-hand);\n  font-size: var(--fs-28);"
    },
    {
      name: '印刷卡丢掉题记带（印出来少主题名）',
      file: 'miniprogram/subpackages/feature/gift/giftShareCard.js',
      from: "  const themeName = String(o.themeName || '').trim()",
      to: "  const themeName = ''"
    },
    {
      name: '题记层被删掉（回到「题记占正文」的旧口径）',
      file: COMPOSE_WXML,
      from: '<view class="card-epigraph" wx:if="{{product.themeName && product.themeNote}}">',
      to: '<view class="card-epigraph-off">'
    },
    {
      name: '候选数被算成 1（换句机制失去依据）',
      file: PRESETS,
      from: '  return (preset && Array.isArray(preset.bodies) && preset.bodies.length) || 0',
      to: '  return 1'
    },
    {
      name: '「换一句」不再推进句序（死按钮）',
      file: COMPOSE_JS,
      from: '    this.requestNoteReplace(preset, (this.data.noteVariantIndex + 1) % total, ',
      to: '    this.requestNoteReplace(preset, this.data.noteVariantIndex, '
    },
    {
      name: '同一关系再点不换句（回到旧的「永远同一段」）',
      file: COMPOSE_JS,
      from: '    const variant = (id === this.data.activeNotePresetId) ? (this.data.noteVariantIndex + 1) % total : 0',
      to: '    const variant = 0'
    },
    {
      name: '去掉句序标（换了也看不出来）',
      file: COMPOSE_WXML,
      from: '        <text class="note-shuffle-count">第 {{noteVariantLabel}} 句</text>\n',
      to: ''
    },
    {
      name: '去掉「换一句」入口（只剩关系 chip）',
      file: COMPOSE_WXML,
      from: '        <text class="note-shuffle" bindtap="onNoteShuffle">换一句 ↻</text>\n',
      to: ''
    },
    {
      name: '手改比对退回只比第一句（选第 2/3 句掉高亮）',
      file: COMPOSE_JS,
      from: "      if (!preset || bodies.indexOf(cardBody) === -1) patch.activeNotePresetId = ''",
      to: "      if (!preset || cardBody !== preset.body) patch.activeNotePresetId = ''"
    },
    {
      name: '去掉「受礼人姓名」必填拦截（空名字也能进确认订单）——《需求 9》',
      file: COMPOSE_JS,
      // 2026-09-18：注入锚点原本是那一行 `wx.showToast(...)`。该处已按 V1.1.2·W2 弹窗统一
      // 迁到统一组件 `this.showAppToast(...)`（修 check:dialog-ratchet 的既存红），
      // 于是旧锚点命中 0 次、自检恒失败。语义不变，只把锚点跟到新写法。
      // 2026-09-19：锚点里的文案改为引用 `RECIPIENT_REQUIRED_TOAST` 常量 —— 文案再变也不会漏这一处。
      // 2026-10-12：分步后这段校验搬进 _checkLetter()（返回 false 拦下），锚点跟到新写法。
      from: `      this.showAppToast({ overline: 'RECIPIENT', title: '${RECIPIENT_REQUIRED_TOAST}' })\n      return false\n`,
      to: ''
    },
    {
      name: '犒劳自己不再默认账号昵称 ——《需求 9》',
      file: COMPOSE_JS,
      from: "    if (preset.id === 'self') this.applyToSelfRecipientDefault()\n",
      to: ''
    }
  ]

  let bad = 0
  for (const inj of injections) {
    const abs = resolve(ROOT, inj.file)
    const orig = readFileSync(abs, 'utf8')
    const hits = orig.split(inj.from).length - 1
    if (hits !== 1) {
      console.log(`✗ 锚点不唯一（命中 ${hits} 次）：${inj.name}`)
      bad += 1
      continue
    }
    writeFileSync(abs, orig.replace(inj.from, inj.to))
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
    writeFileSync(abs, orig)
    if (readFileSync(abs, 'utf8') !== orig) {
      console.log(`✗ 未能逐字还原：${inj.file}`)
      bad += 1
      continue
    }
    if (r.status === 0) {
      console.log(`✗ 注入回归未被检出：${inj.name}`)
      bad += 1
    } else {
      console.log(`  ✓ 已检出：${inj.name}`)
    }
  }
  if (bad) {
    console.log(`✗ 自检失败：${bad} 项`)
    process.exit(1)
  }
  console.log(`✓ 自检通过：${injections.length} 条注入全部被检出、源文件逐字还原`)
}
