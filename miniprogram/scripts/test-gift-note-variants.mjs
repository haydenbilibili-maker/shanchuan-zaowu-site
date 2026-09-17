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

const counts = LIST.map((p) => presets.presetBodyCount(p))
check('★ 每个关系都有多句候选（不再是「一关系一文案」）', counts.every((n) => n >= 3),
  `实际每关系句数：${LIST.map((p) => `${p.id}=${presets.presetBodyCount(p)}`).join(' ')}`)

const flat = LIST.flatMap((p) => (p.bodies || []).map((b) => String(b)))
check('候选总句数 ≥ 关系数×3', flat.length >= LIST.length * 3, `${flat.length} 句`)
check('★ 每句都在 textarea 上限内（≤200 字）', flat.every((b) => b.length <= 200),
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
check('★ 礼笺「用户亲手写」的内容用手写体令牌 var(--font-hand)',
  (readFileSync(resolve(ROOT, COMPOSE_WXSS), 'utf8').match(/font-family: var\(--font-hand\)/g) || []).length >= 2,
  '落笔展示与正文输入都该用手写体（题记是品牌字，不换）')
check('★ 手写体令牌是**系统字体栈**（无 webfont、零体积）',
  /--font-hand:[^;]*HanziPen SC/.test(readFileSync(resolve(ROOT, 'miniprogram/app.wxss'), 'utf8')),
  '改成了 webfont 就会引入下载与首屏闪烁')
check('★ 逐字落笔：wxml 按字渲染（wx:for=writeChars）', /wx:for="\{\{writeChars\}\}"/.test(composeWxml) || composeWxml.indexOf('writeChars') !== -1)
check('★ 逐字落笔：新字播一次动画（card-write-char + keyframes）',
  /\.card-write-char\s*\{/.test(readFileSync(resolve(ROOT, COMPOSE_WXSS), 'utf8'))
  && /@keyframes handWriteIn/.test(readFileSync(resolve(ROOT, COMPOSE_WXSS), 'utf8')))
check('★ writeChars 随落笔推进（与 cardBody 同步）', /writeChars: target\.slice\(0, i\)\.split\(''\)/.test(composeJs))

/* ── 印刷版礼笺卡（A6@300dpi，礼赠履约导出用；2026-09-17）─────────────────── */
{
  const card = readFileSync(resolve(ROOT, 'miniprogram/utils/giftShareCard.js'), 'utf8')
  check('★ 印刷版渲染器存在且导出', /function paintGiftPrintCard\(/.test(card) && /renderGiftPrintImage,/.test(card))
  check('★ 规格为 **A5** 竖版 @300dpi（1748 × 2480 = A4 对半，一张印两张）',
    /const PRINT_W = 1748/.test(card) && /const PRINT_H = 2480/.test(card),
    'A4 对半是 A5（148×210mm），不是 A6')
  check('★ 改纸张只改常量：绘制按设计稿等比放大（setTransform(S,…)）',
    /const S = PRINT_W \/ PRINT_DESIGN_W/.test(card) && /ctx\.setTransform\(S, 0, 0, S, 0, 0\)/.test(card))
  check('★ 印刷卡**必须**画题记带（分享卡不画，这是两者的关键区别）',
    /const themeName = String\(o\.themeName/.test(card) && /const themeNote = String\(o\.themeNote/.test(card),
    '印刷卡缺题记 → 印出来会少掉主题名与那句话')
  check('★ 分享卡未被改动（分享卡绘制函数仍在、未被印刷版替换）',
    /function paintGiftShareCard\(canvas, opts\)/.test(card) && /SHARE_CARD_W: W,/.test(card))
  check('印刷卡复用共享换行/圆角工具（不另造）', /wrapLines\(ctx, String\(o\.cardBody/.test(card) && /roundRect\(ctx, cardX/.test(card))
  // 2026-09-17 真图暴露的两个重叠 bug → 钉成不变量
  // 版式按前端礼笺卡定稿（2026-09-18）：印章在右上、署名在左下 → 分区不相撞
  check('★ 印章与署名**分区**且不相撞（印章右上 / 署名左下）',
    /const sealCy = topY - Math\.round\(8 \* MM\)/.test(card)
    && /const baseY = cardY \+ cardH - Math\.round\(22 \* MM\)/.test(card),
    '印章与署名必须在不同分区，否则会叠在一起')
  check('★ 题记带整宽（axisX → axisRight）', /const bandW = axisRight - axisX/.test(card))
  // 作用域限定在**印刷卡**函数体内（分享卡里本来就有 drawImage，不能一起判）
  const printFn = (function () {
    const i = card.indexOf('function paintGiftPrintCard(')
    return i < 0 ? '' : card.slice(i, i + 9000)
  })()
  check('版式对齐前端：印刷卡不放藏品图（前端那张卡也没有，避免图压题记）',
    printFn.length > 0 && !/drawImage/.test(printFn), '若加回图片，必须重新处理与题记带的重叠')
  check('★ 题记与正文共用同一左轴', /const axisX = cardX \+ pad/.test(card) && /ctx\.fillText\(bodyLines\[i\], axisX,/.test(card))
  check('底部有落款日期（填住下半版空白）', /padStart\(2, '0'\)/.test(card) && /ctx\.fillText\(dateText/.test(card))
  // 2026-09-18：印刷卡版式**学习前端礼笺卡**（compose 的 .card-*）
  check('★ 印刷卡首行是「写给 · TA」（学前端 .card-*）', /写给 · /.test(card) && /o\.recipientName/.test(card))
  check('★ 印章移到**右上**（与前端一致；此前在左下）', /const sealCx = axisRight - sealR/.test(card) && /const sealCy = topY - Math\.round\(8 \* MM\)/.test(card))
  check('★ 正文用**手写体**（与前端同一系统字体栈，零体积）',
    /HanziPen SC/.test(card) && /34px ' \+ HAND/.test(card))
  check('★ 右下有淡「山海」水印（前端那张卡的收尾笔触）', /globalAlpha = 0\.06/.test(card) && /fillText\('山海'/.test(card))
}

/* ── 礼赠履约页「导出礼笺图」接线（印刷用；2026-09-17）────────────────── */
{
  const OPS_JS = 'miniprogram/subpackages/manager/gift-ops/index.js'
  const OPS_WXML = 'miniprogram/subpackages/manager/gift-ops/index.wxml'
  const opsJs = stripComments(readFileSync(resolve(ROOT, OPS_JS), 'utf8'))
  const opsWxml = readFileSync(resolve(ROOT, OPS_WXML), 'utf8')
  check('★ 履约页有「导出礼笺图」入口', /导出礼笺图/.test(opsWxml) && /onExportGiftCard/.test(opsWxml))
  check('★ 用共享印刷渲染器（不另造画布逻辑）', /renderGiftPrintImage\('#giftPrintCanvas', this, \{/.test(opsJs))
  check('★ 导出侧传入 recipientName（印刷卡首行「写给 · TA」）',
    /recipientName: item\.recipientName/.test(opsJs))
  check('★ 引主包实现（分包之间不得互相 require）',
    opsJs.indexOf("require('../../../utils/giftShareCard')") !== -1 && opsJs.indexOf("require('../../feature/") === -1,
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

check('埋点带上句序（便于回看哪一句更常用）',
  /label: preset\.label,\s*\n\s*variant: index \+ 1/.test(composeJs))

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
      name: '印刷卡丢掉题记带（印出来少主题名）',
      file: 'miniprogram/utils/giftShareCard.js',
      from: "  const themeName = String(o.themeName || '').trim()",
      to: "  const themeName = ''"
    },
    {
      name: '礼笺退回衬线（手写体被去掉）',
      file: COMPOSE_WXSS,
      from: '  /* 用户亲手写下的内容 → 手写体令牌（系统字体栈、零体积；iOS 汉仪手写体/签笔，Android 落衬线兜底） */\n  font-family: var(--font-hand);',
      to: "  font-family: 'Source Han Serif SC', serif;"
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
