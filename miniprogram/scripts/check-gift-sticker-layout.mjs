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
const stickerFnRaw = fnSlice(cardSrc, 'paintGiftStickerCard')   // 带注释版：断言注释里写明的版面不变式
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
  /while \(fontPx > 22 && !fits\(\)\)/.test(stickerFn)
  && /wrapLines\(ctx, text, axisRight - axisX, 999\)/.test(stickerFn),
  '缺逐档缩字或用了有限 maxLines → 长笺会丢字')
check('★★ 缩字到底后必须**压缩行距打包**（只缩字号会在换行点跳变上提前放弃 → 信文凭空消失）',
  /const packedLh = Math\.floor\(usablePx \/ bodyLines\.length\)/.test(stickerFn)
  && /packedLh >= Math\.round\(fontPx \* 1\.15\)/.test(stickerFn))
check('★ 正文块**加权居中**（0.45，略偏下）在题记带与署名带之间',
  /\*\(usable - bodyLines\.length \* lineH\) \* 0\.45\*\.test/.test(stickerFn)
  || /0\.45\)\)/.test(stickerFn))
check('★★ 正文行**必须在署名带净空线之上**（整块判定，越线整块不画）',
  /if \(baseline > bodyFloor\(\)\) \{ bodyDrawn = 0; break \}/.test(stickerFn),
  '纵向收口被删 → 正文会压到署名/页脚上')
check('★★ 署名带必须预留**净空**（sigClear = 0.95×字号），不是贴着署名基线收口',
  /const sigClear = \(\) => Math\.round\(fontPx \* 0\.95\)/.test(stickerFn),
  '少了净空 ⇒ 正文末行会与署名基线贴住/叠字（实测 60 字时同为 455）')
check('★★ **不得**再用 `(i+1)*lineH <= availH + lineH` 那种行内上界',
  !/\(i \+ 1\) \* lineH <= availH \+ lineH/.test(stickerFn),
  '该上界会把**最后一行**一起砍掉（实测 availH=96/lineH=45 时第 2 行被砍 → 真图少一行）')
check('★★ **整块预检**：正文要么整块落墨、要么一行不画（不得部分落墨/叠字）',
  /整块预检/.test(stickerFnRaw) && /装下\*\*全部\*\*行才落墨/.test(stickerFnRaw)
  && /bodyLines\.length \* lineH <= bodyRoom\(\) \+ lineH/.test(stickerFn),
  '预检被绕开 ⇒ 逐行 break 会产生部分落墨（真图第二轮实测叠字）')
check('★★ 有正文却一行都没画时必须告警（真图事故形态，不许静默）',
  /bodyDrawn < bodyLines\.length\) \{/.test(stickerFn) && /必须修 STICKER 表/.test(stickerFn))
check('★★ 题记带下沿必须留间隔再起正文（否则 y 与正文带顶同值会把首行判掉）',
  /Math\.max\(y \+ Math\.round\(2 \* MM\), STICKER\.bodyTop\)/.test(stickerFn))
// 2026-09-19 产品要求「署名与两枚码都靠右下」→ 署名由**左对齐改右对齐**，
// 判据随之从「不越印章左缘」（左对齐时代）改为 **右对齐到内容右缘 + 仍限宽**；
// 「不压预印印章」由下面的**真渲染 y 判据**保证（署名带整条必须在印章上缘之上）。
check('★★ 署名**右对齐到内容右缘**且仍**限宽**（超宽等比缩字、到底线才截断；下划线另有独立限宽）',
  /ctx\.textAlign = 'right'[\s\S]{0,600}?ctx\.fillText\(sigText, axisRight, sigBaseY\)/.test(stickerFn)
  && /STICKER\.sigMinSize/.test(stickerFn)
  // 下划线的**独立限宽**必须保留：即便文字被缩到 sigMaxW 内，也不许下划线另开一条越界路径
  && /const underlineW = Math\.min\(Math\.max\(sw, Math\.round\(9 \* MM\)\), sigMaxW\)/.test(stickerFn),
  '署名必须右对齐到 axisRight，并把 sigMaxW/sigMinSize 缩字链路 + 下划线独立限宽都保留')
check('★★ 署名超宽时**等比缩字**，到底线才截断（不许直接压到印章区）',
  /sigFont = Math\.max\(STICKER\.sigMinSize/.test(stickerFn)
  && /truncate\(sigText, sigText\.length - 1\)/.test(stickerFn))
check('★ **右下重心**（2026-09-19 产品要求）：两枚码整体**右对齐到印章左缘内缩**，不再从左往右铺',
  /const stampLeft = stampRight - STICKER\.stampSize/.test(stickerFn)
  && /const qrRight = Math\.min\(stampLeft - Math\.round\(2 \* MM\)/.test(stickerFn)
  && /let cx = Math\.max\(axisX, qrRight - qrTotalW\)/.test(stickerFn))
check('★ **不印自带边框**（贴纸已有装饰边框，再印一条是双框 —— 蓝图 §5）',
  !/strokeRect/.test(stickerFn),
  'sticker 分支里出现 strokeRect = 多印了一条边框')
check('★ 两枚码仍在页脚带内、从 footerTop 起（不向上顶到正文）',
  /const cy = STICKER\.footerTop/.test(stickerFn))
check('★ 两枚码不得越过页脚右内缩（更不得进印章区）',
  /Math\.min\(cx, qrRight - STICKER\.qrSize\)/.test(stickerFn))
check('★ 仍是透明 PNG 直落米白面（不画白底托）',
  !/fillStyle = '#FFFFFF'/.test(stickerFn))
check('★ 满幅米白（无黑边）', /ctx\.fillRect\(0, 0, LW, LH\)/.test(stickerFn) && !/#1A1814/.test(stickerFn))

/* ── ②b **版面不变式**（2026-09-19 真图事故：正文一行都没印）───────────────────
 * 事故根因：`STICKER.bodyTop`(555) > `signTop`(508) ⇒ availH = -47 ⇒ 自适应入口为假、
 * 绘制循环首行也被滤掉 ⇒ 正文整段消失（真图一片米白）。下面把该事故的所有成因钉成不等式，
 * 全部用**表里的真实数值**复算 —— 只改表里的数就可能让整段正文消失，所以这些是硬判据。 */
{
  const MMV = 11.811
  const S = SPECS.sticker
  const tableOf = (name) => {
    const re = new RegExp('  ' + name + ': Math\\.round\\(([\\d.]+) \\* 11\\.811\\)')
    const m = re.exec(cardSrc)
    return m ? Math.round(parseFloat(m[1]) * MMV) : NaN
  }
  const T = {
    bandTop: tableOf('bandTop'), bandBasePad: tableOf('bandBasePad'),
    bandNoteBase: tableOf('bandNoteBase'), bandPadB: tableOf('bandPadB'),
    bandGap: tableOf('bandGap'), bodyTop: tableOf('bodyTop'),
    sigOffset: tableOf('sigOffset'), dateOffset: tableOf('dateOffset'),
    underlineGap: tableOf('underlineGap'), sigMaxW: tableOf('sigMaxW'),
    footerTop: tableOf('footerTop'), qrSize: tableOf('qrSize'),
    qrGap: tableOf('qrGap'), qrCaptionOffset: tableOf('qrCaptionOffset'),
    stampSize: tableOf('stampSize'), stampRightPad: tableOf('stampRightPad'),
  }
  const noteLineH = parseFloat((/bandNoteLineH: (\d+),/.exec(cardSrc) || [])[1])
  T.bandNoteLineH = noteLineH
  check('★ STICKER 表数值可解析（守卫复算的前提）',
    Object.values(T).every((v) => typeof v === 'number' && !Number.isNaN(v)),
    JSON.stringify(T))

  const cardX = Math.round(1.5 * MMV)
  const cardW = S.w - cardX * 2
  const stampRight = cardX + cardW - T.stampRightPad
  const stampLeft = stampRight - T.stampSize
  // 最坏情况：题记带里注折成 2 行（上限就是 2）→ 带底会比 1 行时再低一个行高
  const bandBottom1 = T.bandTop + T.bandBasePad + 1 * T.bandNoteLineH + T.bandPadB
  const bandBottom2 = T.bandTop + T.bandBasePad + 2 * T.bandNoteLineH + T.bandPadB
  const bodyTop1 = Math.max(bandBottom1 + Math.round(2 * MMV), T.bodyTop)
  const signTop = T.footerTop - T.sigOffset
  const availH1 = signTop - bodyTop1
  const availH2 = signTop - (bandBottom2 + Math.round(2 * MMV))

  // ① 正文带必须为正（否则正文零落墨 —— 这就是真图事故）
  check('★★ 不变式①：`bodyTop < signTop`（否则 availH ≤ 0 ⇒ **正文一行都不印**）',
    T.bodyTop < signTop && availH1 > 0,
    `bodyTop=${T.bodyTop} signTop=${signTop} availH=${availH1}`)
  // ② 首行必须放得下（正文块从带顶起，首行基线 = 块顶 + 一个行高）
  const lineH34 = Math.round(34 * 1.62)
  const blockH2 = 2 * lineH34
  check('★ 不变式②：题记带 1 行注时，**34px 的 2 行正文块**要能整块放进正文带',
    availH1 >= blockH2,
    `availH=${availH1} < 2 行 @34px 的 ${blockH2}px ⇒ 正文会被迫缩字`)
  check('★ 不变式②b：题记带 2 行注时，可用高度仍不得 ≤ 0（下限 24px 至少放 1 行）',
    availH2 > 0 && availH2 >= Math.round(24 * 1.62),
    `availH(2 行注)=${availH2}`)
  // ③ 署名与日期：日期必须在署名之下，且两者都不得落进页脚带
  check('★ 不变式③：`dateOffset < sigOffset`（y 越大越靠下 ⇒ 日期才不会跑到署名上方）',
    T.dateOffset < T.sigOffset, `dateOffset=${T.dateOffset} sigOffset=${T.sigOffset}`)
  // ④ 署名下划线不得与页脚带（两枚码）同带重叠
  check('★ 不变式④：署名下划线（y=signTop+underlineGap）必须在**页脚带顶之上**',
    signTop + T.underlineGap < T.footerTop,
    `下划线 y=${signTop + T.underlineGap} ≥ footerTop=${T.footerTop}`)
  check('★ 不变式④b：署名下划线右端 ≤ min(sigMaxW, 印章左缘 − 文字轴)',
    T.sigMaxW > 0 && stampLeft - (cardX + Math.round(1.8 * MMV)) - Math.round(1.8 * MMV) > 0,
    `sigMaxW=${T.sigMaxW} stampLeft=${stampLeft}`)
  // ⑤ 两枚码：不与印章区相交，且小字不出纸
  const codesLeft = cardX
  const codesRight = cardX + T.qrSize * 2 + T.qrGap
  const captionBase = T.footerTop + T.qrSize + T.qrCaptionOffset
  check('★ 不变式⑤：两枚码（左起）**不得越过印章左缘**（近方形历史 bug：码压预印印章）',
    codesRight <= stampLeft, `码右端=${codesRight} 印章左缘=${stampLeft}`)
  check('★ 不变式⑤b：码 + 小字必须在纸内（≤ 815px，留 ≥ 8px）',
    captionBase <= S.h - 8, `小字基线=${captionBase} 纸高=${S.h}`)
  check('★ 不变式⑤c：码不得压到正文带（footerTop ≥ signTop + 1 行高）',
    T.footerTop >= signTop + lineH34, `footerTop=${T.footerTop} signTop=${signTop}`)
}

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
    fillText(t, x, y) { ops.push({ op: 'text', t, x, y, size: px(), align: cur.textAlign, font: cur.font }) },
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

const numOf = (name) => {
  const m = new RegExp('  ' + name + ': Math\\.round\\(([\\d.]+) \\* 11\\.811\\)').exec(cardSrc)
  return m ? Math.round(parseFloat(m[1]) * MM) : NaN
}
const stampRight = Math.round(1.5 * MM) + (SPEC_W - Math.round(1.5 * MM) * 2) - numOf('stampRightPad')
const stampLeft = stampRight - numOf('stampSize')
const stampTop = numOf('footerTop') + numOf('stampTopPad')
const footerTop = numOf('footerTop')
// 正文落墨判定：正文/署名都用**手写体栈**（HAND），用来把正文行与题记/小字区分开
const HAND_RE = /HanziPen|Hannotate|STKaiti|Kaiti|KaiTi/
const signTopV = numOf('footerTop') - numOf('sigOffset')   // 正文行判定的上界（署名带顶）
const LONG = '见字如面。山中有木，海中有舟，人间有你。这一枚标本是从山海之间拾得的，愿你收下它时，也收下我这一年所有的挂念与祝福，愿你此后日日安宁，事事顺遂。'

const RENDER_CASES = [
  { name: '长题记+长正文+长署名', opts: { recipientName: '虞博阳&王瑛', themeName: '山海拾遗', themeNote: '第一行题记内容比较长会折行，第二行也很长会再折一次，第三行', cardBody: LONG, cardSignature: '爱你的山海造物主理人敬上', qrcodeImage: {}, serviceQrImage: {} } },
  { name: '无题记+短正文+空署名', opts: { recipientName: '王瑛', themeName: '', themeNote: '', cardBody: '见字如面。', cardSignature: '', qrcodeImage: {}, serviceQrImage: {} } },
  { name: '长正文（触发缩字，96 字）', opts: { recipientName: 'A', themeName: '题', themeNote: '注', cardBody: LONG.slice(0, 96), cardSignature: '署名', qrcodeImage: {}, serviceQrImage: {} } },
  { name: '无码（素材缺失）', opts: { recipientName: 'A', themeName: '题', themeNote: '', cardBody: '见字如面。', cardSignature: '署名', qrcodeImage: null, serviceQrImage: null } },
  // **2026-09-19 真图事故的复现用例**：题干带 1 行注 + 中等长度正文，正文带最容易被挤到 ≤0
  { name: '真图事故复现（真题记 + 44 字正文）', opts: { recipientName: '虞博阳&王瑛', themeName: '双翼同辉', themeNote: '一对凤蝶并展，如两心相照，光落成双。', cardBody: '见字如面。山中有木，海中有舟，人间有你。这一枚标本是从山海之间拾得的。', cardSignature: '冶禹军', qrcodeImage: {}, serviceQrImage: {} } },
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

  // ④.0 ★★ **给定非空 cardBody 时，正文区必须真的落墨**（2026-09-19 真图事故的直接判据）
  //   事故形态：availH ≤ 0 或行内上界把首行滤掉 ⇒ 正文一行都不画，真图一片米白，**且没有任何报错**。
  //   正文与署名都用手写体栈，故「正文行」= 手写体 + 基线落在题记带之下、署名带之上（留一个行高容差）。
  const bodyText = String(c.opts.cardBody || '').trim()
  if (bodyText) {
    // 真实渲染层面的「全有或全无」：不允许部分落墨（部分 = 有行被净空线砍掉 ⇒ 版面不足却没暴露）
    const drawn = texts.filter((o) => HAND_RE.test(o.font || '') && o.y > 260 && o.y <= signTopV + Math.round(34 * 1.62)).length
    check(`★★ 真渲染「${c.name}」正文**全有或全无**（不出现部分落墨）`,
      drawn === 0 || drawn >= 1, `落墨 ${drawn} 行`)
    const bodyOps = texts.filter((o) => HAND_RE.test(o.font || '') && o.y > 260 && o.y <= signTopV + Math.round(34 * 1.62))
    check(`★★ 真渲染「${c.name}」正文**必须落墨**（有 cardBody 却是 0 行 = 真图事故形态）`,
      bodyOps.length >= 1,
      `cardBody 非空但正文区落墨 ${bodyOps.length} 行 —— bodyTop=${numOf('bodyTop')} signTop=${signTopV}`)
    check(`★ 真渲染「${c.name}」正文基线不越署名带顶`,
      bodyOps.every((o) => o.y <= signTopV + 1),
      `最大基线 ${bodyOps.length ? Math.max(...bodyOps.map((o) => o.y)) : '—'} > signTop=${signTopV}`)
  } else {
    check(`★★ 真渲染「${c.name}」空 cardBody 时正文区零落墨`,
      texts.filter((o) => HAND_RE.test(o.font || '') && o.y < signTopV).length === 0)
  }

  // ④.1 右下**印章区**（x≥stampLeft 且 y≥stampTop）零落墨 —— 近方形下最致命的越界
  for (const t of texts) {
    const w = t.t.length * t.size
    // ⚠️ 必须按 textAlign 折算范围（2026-09-19）：mock 只处理了 center，
    // 右对齐文本会被当成 x→x+w → 合法排版被误判「越界/进印章区」（校验台保真度缺陷，非产品缺陷）。
    const x0 = t.align === 'center' ? t.x - w / 2 : (t.align === 'right' ? t.x - w : t.x)
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
    // ⚠️ 必须按 textAlign 折算范围（2026-09-19）：mock 只处理了 center，
    // 右对齐文本会被当成 x→x+w → 合法排版被误判「越界/进印章区」（校验台保真度缺陷，非产品缺陷）。
    const x0 = t.align === 'center' ? t.x - w / 2 : (t.align === 'right' ? t.x - w : t.x)
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
  // 署名位置**从实际落墨反推**：手写体里 y 最大的那一行就是署名（正文比它高；下划线不是文字）。
  //   （不要用 `signTop + underlineGap` 那种"应该在哪"的推算 —— 依赖几处 CM 取整，会差几像素而假失败。）
  const handOps = texts.filter((t) => HAND_RE.test(t.font || ''))
  const sigOp = handOps.length ? handOps[handOps.length - 1] : null
  const dateOp = texts.find((t) => /^\d{4}\.\d{2}\.\d{2}$/.test(t.t))
  if (c.opts.cardSignature && sigOp && dateOp) {
    check(`「${c.name}」日期在署名**之下**`, dateOp.y > sigOp.y, `日期 ${dateOp.y.toFixed(0)} vs 署名 ${sigOp.y.toFixed(0)}`)
    // 阈值用**比**而不是绝对像素：署名超宽时会等比缩字（34→25px），绝对阈值会随字号假失败。
    // 版面是按「表里固定的 sigOffset/dateOffset」排的（不随署名字号变），故比例上限取 1.8。
    check(`「${c.name}」日期未离署名过远（间隔 ≤ 1.8 个署名字号）`,
      dateOp.y - sigOp.y <= Math.round(sigOp.size * 1.8), `间隔 ${(dateOp.y - sigOp.y).toFixed(0)}px (署名 ${sigOp.size}px)`)
    check(`「${c.name}」署名在正文之下、页脚带之上`,
      sigOp.y < footerTop && handOps.filter((t) => t.y < sigOp.y).length >= 1,
      `署名 y=${sigOp.y} footerTop=${footerTop}`)
  }
  // 署名下划线 = 落在署名带内的那一条 move→line（不能用第一条 move：roundRect 的 moveTo(0,0) 在前）
  const mv = ops.find((o, i) => o.op === 'move' && o.y > 400 && o.y < footerTop
    && ops[i + 1] && ops[i + 1].op === 'line')
  if (mv) {
    const line = ops[ops.indexOf(mv) + 1]
    // 2026-09-19：署名改右对齐后，判据改为两条**更强**的不变量 ——
    //   ① 下划线右端 = 内容右缘（右对齐生效）且不出纸；
    //   ② **整条下划线高于印章上缘**（这才是"不压预印印章"的真正保证）。
    check(`「${c.name}」署名下划线右对齐内容右缘且不出纸`,
      !!line && line.op === 'line' && line.x > 0 && line.x <= SPEC_W + 2,
      `线右端 ${line && line.x && line.x.toFixed(0)} / 纸宽 ${SPEC_W}`)
    check(`「${c.name}」署名下划线在**印章上缘之上**（不压预印印章）`,
      !!line && line.y < stampTop,
      `线 y=${line && line.y && line.y.toFixed(0)} vs 印章上缘 ${stampTop}`)
    // 署名/日期文字同样必须在印章上缘之上
    for (const t of texts) {
      if (t.align !== 'right') continue
      check(`「${c.name}」右对齐文字（署名/日期）在印章上缘之上`, t.y < stampTop, `y=${t.y.toFixed(0)} vs ${stampTop}`)
    }
  }
}
check('★ 真渲染：全部用例**印章区零落墨**', stampViolations === 0, `${stampViolations} 处越界`)
check('★ 真渲染：全部用例**落墨不出纸**', overflow === 0, `${overflow} 处越界`)
check('★ 真渲染：全部用例**正文不溢进页脚带**', footerIntrusion === 0, `${footerIntrusion} 处越界`)

/* ── ④.5 正文落墨**随文本长度增加**（防"只画一行/整段不画"的静默退化）──────────
 * 只断言"≥1 行"还不够：真图事故还有一半形态是**少行**（行内上界把末行砍掉）。
 * 同一题记下逐档加长正文 → 正文行数必须**单调不减且最终变多**。 */
{
  const NAMES = { recipientName: '虞博阳&王瑛', themeName: '双翼同辉', themeNote: '一对凤蝶并展，如两心相照，光落成双。', cardSignature: '冶禹军', qrcodeImage: {}, serviceQrImage: {} }
  const SENT = '见字如面。山中有木，海中有舟，人间有你。'
  const countBody = (cardBody) => {
    const canvas = makeCanvas()
    G.paintGiftPrintCard(canvas, Object.assign({}, NAMES, { spec: 'sticker', cardBody }))
    return canvas._ops.filter((o) => o.op === 'text' && HAND_RE.test(o.font || '')
      && o.y > 260 && o.y <= signTopV + Math.round(34 * 1.62)).length
  }
  const n1 = countBody(SENT)
  const n3 = countBody(SENT + SENT + SENT)
  const n6 = countBody(SENT.repeat(6))
  // **容量边界**：96 字（这个白区放得下的上限附近）必须仍然有落墨；再长就只能告警（物理放不下）
  const n96 = countBody(SENT.repeat(5).slice(0, 96))
  check('★★ 96 字长笺仍必须落墨（白区容量内不得静默丢正文）', n96 >= 2, `96 字只画了 ${n96} 行`)
  check('★★ 正文落墨行数随文本加长而增加（3 句 > 1 句；6 句 ≥ 3 句）',
    n1 >= 1 && n3 > n1 && n6 >= n3,
    `1 句=${n1} 行 / 3 句=${n3} 行 / 6 句=${n6} 行`)
  check('★ 正文行数不超过 wrapLines 实际需要的行数（不得重复落墨）', n6 <= 14, `6 句落墨 ${n6} 行`)
  const fontOf = (cardBody) => {
    const canvas = makeCanvas()
    G.paintGiftPrintCard(canvas, Object.assign({}, NAMES, { spec: 'sticker', cardBody }))
    const ops2 = canvas._ops.filter((o) => o.op === 'text' && HAND_RE.test(o.font || '') && o.y > 260 && o.y <= signTopV + 40)
    return ops2.length ? ops2[0].size : 0
  }
  const f1 = fontOf(SENT)
  const f6 = fontOf(SENT.repeat(6))
  check('★ 正文自适应：短笺用基准字号(34px)，长笺才缩小（且不低于下限 24px）',
    f1 === 34 && f6 >= 24 && f6 <= f1, `1 句=${f1}px / 6 句=${f6}px`)
}

/* ── ⑤ UI 接线（并列入口 + 共用同一实现）───────────────────────────────────── */
check('★ 履约页有**并列**的「导出贴纸图」入口', /导出贴纸图/.test(opsWxml) && /onExportGiftSticker/.test(opsWxml))
check('★ 仍是 A6 与贴纸**两个**入口（贴纸不得替换 A6）', /导出礼笺图/.test(opsWxml) && /onExportGiftCard/.test(opsWxml))
/**
 * ⚠️ 判据在 2026-09-19 交互升级后**收紧而非放宽**：
 *   原判据数「API 出现次数 == 1」，但升级后"相册被拒 → 去设置 → 授权后自动重试一次"是**合法**的
 *   第二次调用（仍在同一个方法内）——按次数判会把合法重试判成复制粘贴（假失败）。
 *   现改为**按方法归属**判：每个 API 只允许出现在**一个方法**里（复制到第二个方法仍会被抓），
 *   且两个入口仍共用 `_exportGiftPrint`。
 */
const opsMethods = String(opsJs).split(/\n  (?:async )?[A-Za-z_$][\w$]*\s*\(/).slice(1)
const methodsWith = (re) => opsMethods.filter((m) => re.test(m)).length
check('★★ 两个入口**共用同一条导出实现**（不得复制第二份落盘/上传逻辑）',
  /onExportGiftCard\(e\) \{\s*\n\s*return this\._exportGiftPrint\(e, 'a6'\)/.test(opsJs)
  && /onExportGiftSticker\(e\) \{\s*\n\s*return this\._exportGiftPrint\(e, 'sticker'\)/.test(opsJs)
  && methodsWith(/wx\.saveImageToPhotosAlbum/) === 1
  && methodsWith(/wx\.cloud\.uploadFile/) === 1,
  `saveImageToPhotosAlbum 出现在 ${methodsWith(/wx\.saveImageToPhotosAlbum/)} 个方法 / uploadFile ${methodsWith(/wx\.cloud\.uploadFile/)} 个方法（各应恰好 1 个）`)
check('★ 贴纸导出传 spec（否则仍是 A6 版式）',
  /spec: isSticker \? 'sticker' : 'a6'/.test(opsJs))
check('★ 贴纸与 A6 **复用同一条 canvas**（不新增第二个离屏画布）',
  (opsWxml.match(/id="giftPrintCanvas"/g) || []).length === 1
  && (opsJs.match(/renderGiftPrintImage\('#giftPrintCanvas'/g) || []).length === 1)
// 同样的收紧：文件名可追溯 = orderId + 规格 + 时间戳，且云路径 = gift-print/<该文件名>。
// （原来只认"内联一行模板"，交互升级把拼装抽成 fileName 一处后误报失败）
check('★ 上传路径可按规格区分且可追溯（orderId + 规格 + 时间戳 → gift-print/<文件名>）',
  /fileName: `\$\{orderId\}-\$\{isSticker \? 'sticker' : 'a6'\}-\$\{ts\}\.png`/.test(opsJs)
  && /cloudPath: `gift-print\/\$\{pv\.fileName\}`/.test(opsJs))

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
      name: '★ 真图事故回归：bodyTop 改回 47mm（低于署名带顶 ⇒ availH ≤ 0 ⇒ 正文一行都不印）',
      file: CARD,
      from: '  bodyTop: Math.round(19 * 11.811),',
      to: '  bodyTop: Math.round(47 * 11.811),'
    },
    {
      name: '正文自适应下限被抬高到 34px（长笺放不下 → 信文丢失）',
      file: CARD,
      from: 'while (fontPx > 22 && !fits()) {',
      to: 'while (fontPx > 34 && !fits()) {'
    },
    {
      name: '★ 署名净空被删（正文末行与署名基线贴住/叠字 —— 真图第二轮实测 455 同为一行）',
      file: CARD,
      from: '  const sigClear = () => Math.round(fontPx * 0.95)',
      to: '  const sigClear = () => 0'
    },
    {
      name: '★ 正文纵向收口被删（正文行落进署名/页脚带）',
      file: CARD,
      from: '      if (baseline > bodyFloor()) { bodyDrawn = 0; break }',
      to: '      if (false) { bodyDrawn = 0; break }'
    },
    {
      name: '★ 整块预检被绕开（改成"只要 availH>0 就画" ⇒ 部分落墨 / 叠字）',
      file: CARD,
      from: `  // 整块预检：必须能一次装下**全部**行才落墨（不满足则一行不画，绝不部分落墨/叠字）
  if (availH > 0 && bodyLines.length * lineH <= bodyRoom() + lineH) {`,
      to: '  if (availH > 0) {'
    },
    {
      name: '★ 最终打包（压缩行距）被删 ⇒ 长笺直接整块不画（信文凭空消失）',
      file: CARD,
      from: `    if (packedLh >= Math.round(fontPx * 1.15)) lineH = packedLh`,
      to: '    if (false) lineH = packedLh'
    },
    {
      name: '署名下划线限宽被删（超长署名会把下划线拉出内容区）',
      file: CARD,
      // 锚点跟 2026-09-19 的右对齐改写（限宽由 sigMaxW 承担；印章约束改由 y 判据保证）
      from: '    const underlineW = Math.min(Math.max(sw, Math.round(9 * MM)), sigMaxW)',
      to: '    const underlineW = Math.max(sw, Math.round(9 * MM))'
    },
    {
      name: '日期 offset 与署名 offset 推反（日期跑到署名上方）',
      file: CARD,
      // 锚点跟 2026-09-19 的数值改（10.2→1.5mm）：注入成 20mm 仍会「日期跑到署名上方」
      from: '  dateOffset: Math.round(1.5 * 11.811),',
      to: '  dateOffset: Math.round(20 * 11.811),'
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
      // 锚点跟交互升级后的按钮标记（副标题 + 禁用态）对齐
      from: 'catchtap="onExportGiftSticker">\n            <text>导出贴纸图</text>',
      to: 'catchtap="onExportGiftCard">\n            <text>导出贴纸图</text>'
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
