/**
 * 礼笺**热敏不干胶贴纸**版式守卫（域 gift-print · 2026-09-19）
 *
 * 背景：礼笺原本只有 A6 竖版一种印刷规格（105×148mm，1:1.41 瘦高）。新增热敏贴纸
 * （90×110mm，白区 ≈75×69mm，**1:0.92 近方形**）。蓝图 `admin/docs/礼笺贴纸版式_技术蓝图.md` §3
 * 已推导：**A6 无论怎么缩都放不进**（105mm→75mm 时高 105.7mm > 69mm）⇒ 这是**版式重构**。
 *
 * 近方形下最危险的是**历史真图 bug 重演**：署名与两枚码争位 → 两枚码压住署名
 * （A6 的解法是「署名左 / 码右」，但贴纸右侧只剩 ~48mm 且**右下 24mm 被预印印章占掉**，
 *   照搬 A6 排法必然把码压到印章上）。故本守卫同时钉三类判据：
 *   ① 规格与默认值（sticker 886×815 / 默认仍 a6 / A6 常量未动）
 *   ② **真渲染**（mock canvas 记录每次落墨）→ 印章区零落墨、落墨不出纸、正文不溢页脚、日期在署名之下
 *   ③ UI 接线（贴纸入口存在，且与 A6 **共用同一条导出实现**，不得复制第二份）
 *
 * ⚠ **本守卫不能替代真图**（错题本 E8）：可打印区是**影像预估**，24mm 印章位置也是估的。
 *   贴纸到货后必须印**校准网格**量真实白区 → 回填 `STICKER` 表 → 再印真实礼笺做**真图复核**。
 *   本守卫只保证「在假定的 886×815 + 24mm 印章下，版式自身不自相矛盾」。
 *
 * 用法：
 *   node miniprogram/scripts/check-gift-sticker-layout.mjs
 *   node miniprogram/scripts/check-gift-sticker-layout.mjs --selftest
 * 退出码：任一硬失败为 1。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

const CARD = 'miniprogram/utils/giftShareCard.js'
const OPS_JS = 'miniprogram/subpackages/manager/gift-ops/index.js'
const OPS_WXML = 'miniprogram/subpackages/manager/gift-ops/index.wxml'

const MM = 11.811   // @300dpi：1mm = 11.811px（与渲染器同源口径）
const SPEC_W = 886  // 75mm
const SPEC_H = 815  // 69mm
const STAMP_MM = 24 // 右下预印圆形印章直径（**影像预估**）

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

/** 仓根是 "type":"module"，小程序源码是 CJS → 自己喂 module/exports 执行**真源码** */
function loadCjs(src) {
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', src)(module, module.exports)
  return module.exports
}

/** 代码而非注释（避免断言命中注释里的假锚点 —— 错题本 E7） */
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const cardSrc = readFileSync(resolve(ROOT, CARD), 'utf8')
const cardCode = stripComments(cardSrc)
const opsJs = stripComments(readFileSync(resolve(ROOT, OPS_JS), 'utf8'))
const opsWxml = readFileSync(resolve(ROOT, OPS_WXML), 'utf8')

/** 按**函数边界**切片（固定窗口会越界到下一个函数 —— 错题本 E7） */
function fnSlice(src, name) {
  const i = src.indexOf('function ' + name + '(')
  if (i < 0) return ''
  const j = src.indexOf('\nfunction ', i + 10)
  return src.slice(i, j < 0 ? src.length : j)
}

const stickerFn = fnSlice(cardCode, 'paintGiftStickerCard')
const a6Fn = fnSlice(cardCode, 'paintGiftPrintCard')

/* ── ① 规格表 ─────────────────────────────────────────────────────────────── */
const G = loadCjs(cardSrc)
const SPECS = G.PRINT_SPECS || {}
check('★ PRINT_SPECS 存在且导出（a6 / sticker 两档）',
  !!SPECS.a6 && !!SPECS.sticker, `实际 ${Object.keys(SPECS).join(',') || '无'}`)
check('★ sticker 规格 = 蓝图 §5 的 **75×69mm @300dpi = 886×815**',
  SPECS.sticker && SPECS.sticker.w === SPEC_W && SPECS.sticker.h === SPEC_H && SPECS.sticker.designW === SPEC_W,
  `实际 ${SPECS.sticker && JSON.stringify(SPECS.sticker)}`)
check('★ 886×815 反推毫米 = 75×69（±0.1mm）',
  Math.abs(SPEC_W / MM - 75) < 0.1 && Math.abs(SPEC_H / MM - 69) < 0.1,
  `实际 ${(SPEC_W / MM).toFixed(2)}×${(SPEC_H / MM).toFixed(2)}mm`)
check('★ **A6 规格零改动**（a6 仍 1240×1748/designW 1240 —— 80-cross 的 A6 守卫继续钉这两行）',
  SPECS.a6 && SPECS.a6.w === 1240 && SPECS.a6.h === 1748 && SPECS.a6.designW === 1240
  && /const PRINT_W = 1240/.test(cardSrc) && /const PRINT_H = 1748/.test(cardSrc),
  `实际 ${SPECS.a6 && JSON.stringify(SPECS.a6)}`)
check('★ 默认规格是 **a6**（不传 spec 的老调用方行为不变）',
  /PRINT_SPECS\[o\.spec\] \|\| PRINT_SPECS\.a6/.test(cardCode),
  '默认值被改掉 = 老调用方（礼赠履约页 A6 入口）会印错规格')
check('★ 渲染分派：贴纸走**独立 painter**（近方形版式不是 A6 缩放）',
  /return paintGiftStickerCard\(canvas, o\)/.test(cardCode) && stickerFn.length > 0)
check('★ 导出器把 spec 透传进 painter（否则 UI 传了也没用）',
  /spec: options\.spec/.test(cardCode))
check('★ sticker 尺寸是**影像预估**，实现里必须写清「待实物校准」',
  /待实物校准/.test(cardSrc) && /影像预估/.test(cardSrc),
  'E10：未实测的数值必须以注释标注来源与待验证状态')

/* ── ② sticker 版式硬约束（源码级）─────────────────────────────────────────── */
check('★★ 正文**自适应缩放、永不截断**（同 A6 口径；印刷卡不能丢字）',
  /while \(fontPx > 26 && bodyLines\.length \* lineH > availH\)/.test(stickerFn)
  && /wrapLines\(ctx, text, axisRight - axisX, 999\)/.test(stickerFn),
  '缺逐档缩字或用了有限 maxLines → 长笺会丢字')
check('★ 正文**垂直居中**在题记带与署名带之间（同 A6 口径）',
  /Math\.round\(\(availH - bodyBlockH\) \/ 2\)/.test(stickerFn))
check('★★ 正文行**不得落进署名/页脚带**（近方形下正文带最短，最易溢出）',
  /\(i \+ 1\) \* lineH > signTop\) break/.test(stickerFn))
check('★★ 署名下划线**限宽**（sigMaxW）+ 另受**印章左缘**约束（双保险，防历史真图 bug 重演）',
  /STICKER\.sigMaxW, stampLeft - axisX - STICKER\.pad/.test(stickerFn),
  '只留一个约束时，任一参数被改就会越到印章/两枚码上')
check('★★ 署名超宽时**等比缩字**，到底线才截断（不许直接压到印章区）',
  /sigFont = Math\.max\(STICKER\.sigMinSize/.test(stickerFn)
  && /truncate\(sigText, sigText\.length - 1\)/.test(stickerFn))
check('★ 署名带与页脚带**同在左半区**（近方形下唯一能同时避开右下印章的排法）',
  /const stampLeft = stampRight - STICKER\.stampSize/.test(stickerFn)
  && /const sigBaseY = STICKER\.footerTop - STICKER\.sigOffset/.test(stickerFn))
check('★ 日期数值必须**小于**署名 offset（y 越大越靠下 → 日期才不会跑到署名上方）',
  /sigOffset: Math\.round\(5 \* 11\.811\)/.test(cardCode)
  && /dateOffset: Math\.round\(2 \* 11\.811\)/.test(cardCode))
check('★ **不印自带边框**（贴纸已有装饰边框，再印一条是双框 —— 蓝图 §5）',
  !/strokeRect/.test(stickerFn),
  'sticker 分支里出现 strokeRect = 多印了一条边框')
check('★ 两枚码仍在页脚带内、从 footerTop 起（不向上顶到正文）',
  /const cy = STICKER\.footerTop/.test(stickerFn))
check('★ 两枚码 15mm→**14mm**（近方形下按蓝图收紧，且不得越过页脚右内缩）',
  /qrSize: Math\.round\(14 \* 11\.811\)/.test(cardCode)
  && /Math\.min\(cx, qrRight - STICKER\.qrSize\)/.test(stickerFn))
check('★ 仍是透明 PNG 直落米白面（不画白底托）',
  !/fillStyle = '#FFFFFF'/.test(stickerFn))
check('★ 满幅米白（无黑边）', /ctx\.fillRect\(0, 0, LW, LH\)/.test(stickerFn) && !/#1A1814/.test(stickerFn))

/* ── ③ A6 分支未被本次改动破坏（回归口径，与 80-cross 互补而非重复）────────── */
check('★ A6 分支仍按 PRINT_W/PRINT_DESIGN_W 等比缩放（setTransform(S,…)）',
  /const S = PRINT_W \/ PRINT_DESIGN_W/.test(a6Fn) && /ctx\.setTransform\(S, 0, 0, S, 0, 0\)/.test(a6Fn))
check('★ A6 仍画内嵌铜金框（贴纸不画，两者区别保留）',
  /ctx\.strokeRect\(cardX, cardY, cardW, cardH\)/.test(a6Fn))
check('★ A6 页脚带高度与主函数其余坐标**逐字未动**',
  /const FOOTER_H = Math\.round\(30 \* MM\)/.test(a6Fn)
  && /const signTop = footerTop - Math\.round\(8 \* MM\)/.test(a6Fn)
  && /const y = footerTop \+ Math\.round\(2 \* MM\)/.test(a6Fn)
  && /const qrRight = cardX \+ cardW - Math\.round\(4 \* MM\)/.test(a6Fn)
  && /let cx = qrRight/.test(a6Fn)
  && /const footBase = footerTop \+ Math\.round\(20 \* MM\)/.test(a6Fn))

/* ── ④ 真渲染（mock canvas：记录每次落墨，在**实际绘制结果**上判）──────────── */
function makeCanvas() {
  const ops = []
  const cur = { font: '400 16px serif', textAlign: 'left' }
  const px = () => parseFloat(/(\d+(?:\.\d+)?)px/.exec(cur.font)?.[1] || '16')
  const ctx = {
    set font(v) { cur.font = v }, get font() { return cur.font },
    set textAlign(v) { cur.textAlign = v }, get textAlign() { return cur.textAlign },
    set fillStyle(v) {}, get fillStyle() { return '' },
    set strokeStyle(v) {}, get strokeStyle() { return '' },
    set lineWidth(v) {}, get lineWidth() { return 1 },
    // 与小程序一致的粗估：CJK ≈ 1em，ASCII ≈ 0.55em（仅用于比较相对宽度，不用于绝对判据）
    measureText(t) {
      let w = 0
      for (const ch of String(t)) w += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? px() : px() * 0.55
      return { width: w }
    },
    fillText(t, x, y) { ops.push({ op: 'text', t, x, y, size: px(), align: cur.textAlign }) },
    drawImage(_img, x, y, w, h) { ops.push({ op: 'image', x, y, w, h }) },
    fillRect(x, y, w, h) { ops.push({ op: 'rect-fill', x, y, w, h }) },
    strokeRect(x, y, w, h) { ops.push({ op: 'rect-stroke', x, y, w, h }) },
    beginPath() {}, closePath() {}, save() {}, restore() {}, clip() {}, fill() {},
    scale() {}, setTransform() {}, translate() {}, rotate() {}, arc() {}, arcTo() {},
    moveTo(x, y) { ops.push({ op: 'move', x, y }) },
    lineTo(x, y) { ops.push({ op: 'line', x, y }) },
    stroke() { ops.push({ op: 'stroke-commit' }) },
  }
  return { width: 0, height: 0, _ops: ops, getContext: () => ctx, createImage: () => ({}) }
}

const stampRight = Math.round(1.5 * MM) + (SPEC_W - Math.round(1.5 * MM) * 2) - Math.round(1.5 * MM)
const stampLeft = stampRight - Math.round(STAMP_MM * MM)
const stampTop = Math.round(48 * MM) + Math.round(2 * MM)
const footerTop = Math.round(48 * MM)
const LONG = '见字如面。山中有木，海中有舟，人间有你。这一枚标本是从山海之间拾得的，愿你收下它时，也收下我这一年所有的挂念与祝福，愿你此后日日安宁，事事顺遂。'

const RENDER_CASES = [
  { name: '长题记+长正文+长署名', opts: { recipientName: '虞博阳&王瑛', themeName: '山海拾遗', themeNote: '第一行题记内容比较长会折行，第二行也很长会再折一次，第三行', cardBody: LONG, cardSignature: '爱你的山海造物主理人敬上', qrcodeImage: {}, serviceQrImage: {} } },
  { name: '无题记+短正文+空署名', opts: { recipientName: '王瑛', themeName: '', themeNote: '', cardBody: '见字如面。', cardSignature: '', qrcodeImage: {}, serviceQrImage: {} } },
  { name: '超长正文（触发缩字下限）', opts: { recipientName: 'A', themeName: '题', themeNote: '注', cardBody: LONG + LONG + LONG, cardSignature: '署名', qrcodeImage: {}, serviceQrImage: {} } },
  { name: '无码（素材缺失）', opts: { recipientName: 'A', themeName: '题', themeNote: '', cardBody: '见字如面。', cardSignature: '署名', qrcodeImage: null, serviceQrImage: null } },
]

let stampViolations = 0
let overflow = 0
let footerIntrusion = 0
for (const c of RENDER_CASES) {
  let ops
  let size = { w: 0, h: 0 }
  try {
    const canvas = makeCanvas()
    G.paintGiftPrintCard(canvas, Object.assign({}, c.opts, { spec: 'sticker' }))
    ops = canvas._ops
    size = { w: canvas.width, h: canvas.height }
  } catch (e) {
    check(`真渲染「${c.name}」不抛错`, false, String(e && e.message))
    continue
  }
  check(`真渲染「${c.name}」画布 = 886×815`, size.w === SPEC_W && size.h === SPEC_H, `实际 ${size.w}×${size.h}`)
  const texts = ops.filter((o) => o.op === 'text')
  const images = ops.filter((o) => o.op === 'image')

  // ④.1 右下**印章区**（x≥stampLeft 且 y≥stampTop）零落墨 —— 近方形下最致命的越界
  for (const t of texts) {
    const w = t.t.length * t.size
    const x0 = t.align === 'center' ? t.x - w / 2 : t.x
    if (x0 + w > stampLeft && t.y + t.size * 0.3 > stampTop) {
      stampViolations += 1
      check(`「${c.name}」印章区零落墨（文字）`, false, `"${t.t.slice(0, 14)}" 右缘 ${(x0 + w).toFixed(0)} > ${stampLeft}`)
    }
  }
  for (const im of images) {
    if (im.x + im.w > stampLeft && im.y + im.h > stampTop) {
      stampViolations += 1
      check(`「${c.name}」印章区零落墨（图像）`, false, `x1=${(im.x + im.w).toFixed(0)} y1=${(im.y + im.h).toFixed(0)}`)
    }
  }
  // ④.2 落墨不出纸
  for (const t of texts) {
    const w = t.t.length * t.size
    const x0 = t.align === 'center' ? t.x - w / 2 : t.x
    if (x0 < 0 || x0 + w > SPEC_W + 2 || t.y - t.size < -2 || t.y > SPEC_H + 2) {
      overflow += 1
      check(`「${c.name}」落墨不出纸`, false, `"${t.t.slice(0, 14)}" x0=${x0.toFixed(0)} x1=${(x0 + w).toFixed(0)} y=${t.y.toFixed(0)}`)
    }
  }
  for (const im of images) {
    if (im.x < -1 || im.y < -1 || im.x + im.w > SPEC_W + 1 || im.y + im.h > SPEC_H + 1) {
      overflow += 1
      check(`「${c.name}」图像不出纸`, false, `x1=${(im.x + im.w).toFixed(0)} y1=${(im.y + im.h).toFixed(0)}`)
    }
  }
  // ④.3 正文行不得落进页脚带（正文带 → 页脚带溢出 = 码压正文的历史 bug 形态）
  for (const t of texts) {
    if (t.size > 24 && t.y > footerTop && /[\u4e00-\u9fff]/.test(t.t) && !/^(扫码进店|客服微信)$/.test(t.t)) {
      footerIntrusion += 1
      check(`「${c.name}」正文不落进页脚带`, false, `"${t.t.slice(0, 14)}" y=${t.y.toFixed(0)} > footerTop=${footerTop}`)
    }
  }
  // ④.4 署名带顺序与下划线
  const sigOp = texts.find((t) => t.size >= 30 && t.y > 400 && t.y < footerTop)
  const dateOp = texts.find((t) => /^\d{4}\.\d{2}\.\d{2}$/.test(t.t))
  if (sigOp && dateOp) {
    check(`「${c.name}」日期在署名**之下**`, dateOp.y > sigOp.y, `日期 ${dateOp.y.toFixed(0)} vs 署名 ${sigOp.y.toFixed(0)}`)
    check(`「${c.name}」日期未离署名过远`, dateOp.y - sigOp.y <= sigOp.size * 1.6, `间隔 ${(dateOp.y - sigOp.y).toFixed(0)}px`)
  }
  // 署名下划线 = 落在署名带内的那一条 move→line（不能用第一条 move：roundRect 的 moveTo(0,0) 在前）
  const mv = ops.find((o, i) => o.op === 'move' && o.y > 400 && o.y < footerTop
    && ops[i + 1] && ops[i + 1].op === 'line')
  if (mv) {
    const line = ops[ops.indexOf(mv) + 1]
    check(`「${c.name}」署名下划线不越过印章左缘`, !!line && line.op === 'line' && line.x <= stampLeft, `线右端 ${line && line.x && line.x.toFixed(0)} vs 印章左缘 ${stampLeft}`)
    // 下划线若与码在同一 y 带，则不得横向越过码的右缘
    for (const im of images) {
      const sameBand = mv.y >= im.y - 4 && mv.y <= im.y + im.h + 24
      if (sameBand) check(`「${c.name}」下划线不横向越过码`, !!line && line.x <= im.x, `线右端 ${line && line.x} vs 码 x=${im.x.toFixed(0)}`)
    }
  }
}
check('★ 真渲染：四类极端输入下**印章区零落墨**', stampViolations === 0, `${stampViolations} 处越界`)
check('★ 真渲染：四类极端输入下**落墨不出纸**', overflow === 0, `${overflow} 处越界`)
check('★ 真渲染：四类极端输入下**正文不溢进页脚带**', footerIntrusion === 0, `${footerIntrusion} 处越界`)

/* ── ⑤ UI 接线（并列入口 + 共用同一实现）───────────────────────────────────── */
check('★ 履约页有**并列**的「导出贴纸图」入口', /导出贴纸图/.test(opsWxml) && /onExportGiftSticker/.test(opsWxml))
check('★ 仍是 A6 与贴纸**两个**入口（贴纸不得替换 A6）', /导出礼笺图/.test(opsWxml) && /onExportGiftCard/.test(opsWxml))
check('★★ 两个入口**共用同一条导出实现**（不得复制第二份落盘/上传逻辑）',
  /onExportGiftCard\(e\) \{\s*\n\s*return this\._exportGiftPrint\(e, 'a6'\)/.test(opsJs)
  && /onExportGiftSticker\(e\) \{\s*\n\s*return this\._exportGiftPrint\(e, 'sticker'\)/.test(opsJs)
  && (opsJs.match(/wx\.saveImageToPhotosAlbum/g) || []).length === 1
  && (opsJs.match(/wx\.cloud\.uploadFile/g) || []).length === 1,
  '出现两份 saveImageToPhotosAlbum/uploadFile = 复制粘贴，必然漂移')
check('★ 贴纸导出传 spec（否则仍是 A6 版式）',
  /spec: isSticker \? 'sticker' : 'a6'/.test(opsJs))
check('★ 贴纸与 A6 **复用同一条 canvas**（不新增第二个离屏画布）',
  (opsWxml.match(/id="giftPrintCanvas"/g) || []).length === 1
  && (opsJs.match(/renderGiftPrintImage\('#giftPrintCanvas'/g) || []).length === 1)
check('★ 上传路径可按规格区分（便于印刷厂取件）', /gift-print\/\$\{orderId\}-\$\{isSticker \? 'sticker' : 'a6'\}/.test(opsJs))

/* ── 输出 / 自检 ─────────────────────────────────────────────────────────── */
if (process.argv.includes('--selftest')) {
  selftest()
} else if (failed) {
  console.log('✗ 礼笺贴纸版式检查失败：')
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`✗ ${failed} 项失败 / ${passed} 项通过`)
  process.exit(1)
} else {
  console.log(`✓ 礼笺贴纸版式：${passed} 项通过（886×815 规格 / 真渲染印章区零落墨 / 正文不溢页脚 / 两入口共用一条实现）`)
  console.log('  ⚠ 可打印区与 24mm 印章位置均为**影像预估**：贴纸到货后必须印校准网格回填 STICKER 表，再做真图复核（E8）')
}

function selftest() {
  const injections = [
    {
      name: '贴纸规格被改错（886×815 → 620×815）—— 蓝图 §5 的 75×69mm 被推翻',
      file: CARD,
      from: "  sticker: { w: 886, h: 815, designW: 886, label: '热敏贴纸可打印区 75×69mm（预估，待实物确认）' },",
      to: "  sticker: { w: 620, h: 815, designW: 620, label: '热敏贴纸可打印区 75×69mm（预估，待实物确认）' },"
    },
    {
      name: '默认规格被改成 sticker —— 老调用方（A6 入口不传 spec）会印错规格',
      file: CARD,
      from: 'const spec = PRINT_SPECS[o.spec] || PRINT_SPECS.a6',
      to: 'const spec = PRINT_SPECS[o.spec] || PRINT_SPECS.sticker'
    },
    {
      name: '分派被删（贴纸走回 A6 的逐字版式）',
      file: CARD,
      from: '  if (spec === PRINT_SPECS.sticker) return paintGiftStickerCard(canvas, o)',
      to: '  if (false) return paintGiftStickerCard(canvas, o)'
    },
    {
      name: '导出器不再透传 spec —— UI 传了也仍印 A6',
      file: CARD,
      from: 'spec: options.spec',
      to: 'spec: undefined'
    },
    {
      name: '正文自适应下限被抬高到 34px（长笺直接截断丢字）',
      file: CARD,
      from: 'while (fontPx > 26 && bodyLines.length * lineH > availH) {',
      to: 'while (fontPx > 34 && bodyLines.length * lineH > availH) {'
    },
    {
      name: '正文溢出保护被删（正文行落进署名/页脚带）',
      file: CARD,
      from: '    if (bodyY + i * lineH > bodyTop && bodyY + (i + 1) * lineH > signTop) break  // 绝不落进署名/页脚带\n',
      to: ''
    },
    {
      name: '署名下划线限宽被删（历史真图 bug：下划线/两枚码与署名争位）',
      file: CARD,
      from: '    const underlineW = Math.min(Math.max(sw, Math.round(9 * MM)), STICKER.sigMaxW, stampLeft - axisX - STICKER.pad)',
      to: '    const underlineW = Math.max(sw, Math.round(9 * MM))'
    },
    {
      name: '日期 offset 与署名 offset 推反（日期跑到署名上方）',
      file: CARD,
      from: '  dateOffset: Math.round(2 * 11.811),',
      to: '  dateOffset: Math.round(9 * 11.811),'
    },
    {
      name: '贴纸版式多印一条自带边框（贴纸已有装饰边 → 双框）',
      file: CARD,
      from: "  ctx.fillStyle = '#F2EDE4'\n  ctx.fillRect(0, 0, LW, LH)\n\n  const cardX = STICKER.margin",
      to: "  ctx.fillStyle = '#F2EDE4'\n  ctx.fillRect(0, 0, LW, LH)\n  ctx.strokeRect(0, 0, LW, LH)\n\n  const cardX = STICKER.margin"
    },
    {
      name: '贴纸按钮被接回 A6 处理器（入口名存实亡，导出的是 A6）',
      file: OPS_WXML,
      from: 'catchtap="onExportGiftSticker">导出贴纸图',
      to: 'catchtap="onExportGiftCard">导出贴纸图'
    },
    {
      name: '两个入口不再共用实现（复制出第二份落盘/上传）',
      file: OPS_JS,
      from: `  async onExportGiftSticker(e) {
    return this._exportGiftPrint(e, 'sticker')
  },`,
      to: `  async onExportGiftSticker(e) {
    const res = await wx.cloud.callFunction({ name: 'manageGift', data: { action: 'getBoardDetail' } })
    await wx.saveImageToPhotosAlbum({ filePath: '' })
    await wx.cloud.uploadFile({ cloudPath: 'x', filePath: '' })
    return res
  },`
    },
    {
      name: '贴纸导出不传 spec（仍是 A6 版式）',
      file: OPS_JS,
      from: "        spec: isSticker ? 'sticker' : 'a6',\n",
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
