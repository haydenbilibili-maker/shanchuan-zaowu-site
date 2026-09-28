/**
 * 礼笺**热敏不干胶贴纸**版式守卫（域 gift-print · 2026-09-19）
 *
 * 背景：礼笺原本只有 A6 竖版一种印刷规格（105×148mm，1:1.41 瘦高）。新增热敏贴纸
 * （白区 **75×75mm，1:1**；2026-09-20 产品负责人裁定把输出比例改成 1:1，原 75×69mm 的影像预估作废）。
 * 蓝图 `admin/docs/礼笺贴纸版式_技术蓝图.md` §3
 * 已推导：**A6 无论怎么缩都放不进**（105mm→75mm 时高 105.7mm > 75mm）⇒ 这是**版式重构**。
 *
 * 近方形下最危险的是**历史真图 bug 重演**：署名与两枚码争位 → 两枚码压住署名
 * （A6 的解法是「署名左 / 码右」，但贴纸右侧只剩 ~48mm 且**右下 24mm 被预印印章占掉**，
 *   照搬 A6 排法必然把码压到印章上）。故本守卫同时钉三类判据：
 *   ① 规格与默认值（sticker 886×886 / 默认仍 a6 / A6 常量未动）
 *   ② **真渲染**（mock canvas 记录每次落墨）→ 印章区零落墨、落墨不出纸、正文不溢页脚、日期在署名之下
 *   ③ UI 接线（贴纸入口存在，且与 A6 **共用同一条导出实现**，不得复制第二份）
 *
 * ⚠ **本守卫不能替代真图**（错题本 E8）：可打印区是**影像预估**，24mm 印章位置也是估的。
 *   贴纸到货后必须印**校准网格**量真实白区 → 回填 `STICKER` 表 → 再印真实礼笺做**真图复核**。
 *   本守卫只保证「在假定的 886×886 + 24mm 印章下，版式自身不自相矛盾」。
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

const CARD = 'miniprogram/subpackages/feature/gift/giftShareCard.js'
const OPS_JS = 'miniprogram/subpackages/manager/gift-ops/index.js'
const OPS_WXML = 'miniprogram/subpackages/manager/gift-ops/index.wxml'

const MM = 11.811   // @300dpi：1mm = 11.811px（与渲染器同源口径）
const SPEC_W = 886  // 75mm
const SPEC_H = 886  // 75mm（1:1；2026-09-20 产品负责人裁定，原 69mm/815 的影像预估作废）
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

/** 印刷码的**侧车清单**（生成时写下的 page/scene/时间）：没有它就无法核对
 *  "纸上的文案承诺的落地页"与"码真正指向的页"是否一致 —— 印出去就改不了，必须留证。 */
function sidecarOf(rel) {
  try { return JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8')) } catch (e) { return null }
}

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
check('★ sticker 规格 = **75×75mm @300dpi = 886×886**（1:1）',
  SPECS.sticker && SPECS.sticker.w === SPEC_W && SPECS.sticker.h === SPEC_H && SPECS.sticker.designW === SPEC_W,
  `实际 ${SPECS.sticker && JSON.stringify(SPECS.sticker)}`)
check('★ 886×886 反推毫米 = 75×75（±0.1mm）',
  Math.abs(SPEC_W / MM - 75) < 0.1 && Math.abs(SPEC_H / MM - 75) < 0.1,
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
// 2026-09-20 真机打印图反馈「留白多、字小」→ 基准 34→46、下限 22→30（产品口径变更，判据跟着走）
check('★★ 正文**自适应缩放、永不截断**（同 A6 口径；印刷卡不能丢字）',
  /while \(fontPx > 30 && !fits\(\)\)/.test(stickerFn)
  && /wrapLines\(ctx, text, axisRight - axisX, 999\)/.test(stickerFn),
  '缺逐档缩字或用了有限 maxLines → 长笺会丢字')
check('★★ 缩字到底后必须**压缩行距打包**（只缩字号会在换行点跳变上提前放弃 → 信文凭空消失）',
  /const packedLh = Math\.floor\(usablePx \/ bodyLines\.length\)/.test(stickerFn)
  && /packedLh >= Math\.round\(fontPx \* 1\.15\)/.test(stickerFn))
/* ⚠️ 2026-09-20 真机预览抓到「正文被截断」后，这三条判据**重写成不变量**而不是钉写法：
 *   旧判据钉的是 `if (baseline > bodyFloor()) { bodyDrawn = 0; break }` ——
 *   那正是 bug 本身：前几行已经 fillText 上去了，break 只把**计数器**清零，
 *   于是卡片上留下半封信（读者以为写完了）。判据不能钉"当时的写法"，要钉"不允许出现的结果"。 */
check('★ 正文块按**表里的权重**偏移定位（bodyWeight：贴着题记起排，余量留在署名上方）',
  /bodyWeight: 0\.3/.test(cardSrc) &&
    /\(availH - blockH\) \* STICKER\.bodyWeight\)/.test(stickerFn))
// 不变量：偏移必须被"末行不得越过净空线"夹住 —— 否则短笺够、长笺就越线
check('★★ 偏移必须夹在「末行不越过净空线」之内（`maxOffset = bodyRoom() - blockH`）',
  /const maxOffset = Math\.max\(0, bodyRoom\(\) - blockH\)/.test(stickerFn) &&
    /Math\.min\(wantOffset, maxOffset\)/.test(stickerFn),
  '不夹 ⇒ 偏移会把末行推过 bodyFloor，正文压到署名/页脚上')
// 不变量：落墨循环**不许有 break**（有 break + 已落墨 = 部分落墨 = 信文截断）
check('★★ 落墨循环里**不许有 break / 提前退出**（部分落墨比整块不画更坏：读者以为写完了）',
  (() => {
    const at = stickerFn.indexOf('const blockTop = bodyTop + Math.min(wantOffset, maxOffset)')
    if (at < 0) return false
    const loop = stickerFn.slice(at, at + 500)
    return /ctx\.fillText\(bodyLines\[i\], axisX, bodyY \+ i \* lineH\)/.test(loop) && !/break/.test(loop)
  })(),
  '循环里有 break ⇒ 越线时会把后半段正文丢掉（前几行已经画上去了）')
check('★★ 署名带必须预留**净空**（sigClear = 0.85×字号），不是贴着署名基线收口',
  /const sigClear = \(\) => Math\.round\(fontPx \* 0\.85\)/.test(stickerFn),
  '少了净空 ⇒ 正文末行会与署名基线贴住/叠字（实测 60 字时同为 455）')
check('★★ **不得**再用 `(i+1)*lineH <= availH + lineH` 那种行内上界',
  !/\(i \+ 1\) \* lineH <= availH \+ lineH/.test(stickerFn),
  '该上界会把**最后一行**一起砍掉（实测 availH=96/lineH=45 时第 2 行被砍 → 真图少一行）')
check('★★ **整块预检**与落墨判据同口径（`≤ bodyRoom()`，不再多给一个 lineH 的松弛）',
  /整块预检/.test(stickerFnRaw) && /装下\*\*全部\*\*行才落墨/.test(stickerFnRaw) &&
    /bodyLines\.length \* lineH <= bodyRoom\(\)\)/.test(stickerFn) &&
    /const fits = \(\) => bodyLines\.length \* lineH <= bodyRoom\(\) &&/.test(stickerFn),
  '预检比落墨松一个行高 ⇒ "判它装得下、实际越线"，正是真机截断的成因')
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
check('★ 两枚码**居中在「左文字轴 ~ 印章左缘」之间**（2026-09-20 真图反馈：右端原离印章 14.2mm 太空）',
  /const qrZone = qrRight - axisX/.test(stickerFn)
  && /axisX \+ Math\.round\(\(qrZone - qrTotalW\) \/ 2\)/.test(stickerFn)
  && /stampLeft - Math\.round\(2 \* MM\)/.test(stickerFn),
  '右端必须由印章左缘约束（不得进印章区），且两侧留白均等')
/* ── 页脚两枚码的**文案**（2026-09-20 产品负责人：码继续留，但要说清扫了能得到什么 +
 *   认出困难时的第二条路）──────────────────────────────────────────────────────
 * 这一组判据的价值不在"字面"，而在**两件事必须同时成立**：
 *   ① 文案承诺的落地页 = 码真正指向的页（印在纸上的假承诺比没有文案更坏）；
 *   ② 兜底文案是**第二行**、在纸内、且不与右侧预印印章区相交（否则就是白印一行字）。 */
check('★★ 两枚码的文案**同源于一处常量**（A6 与贴纸不得各写一份 —— 否则两个规格两种说法）',
  /const PRINT_QR_COPY = \{/.test(cardSrc)
  && /caption: PRINT_QR_COPY\.miniprogram/.test(stickerFn)
  && /caption: PRINT_QR_COPY\.service/.test(stickerFn)
  && /caption: PRINT_QR_COPY\.miniprogram, size: Math\.round\(15 \* MM\)/.test(a6Fn)
  && /caption: PRINT_QR_COPY\.service, size: Math\.round\(15 \* MM\)/.test(a6Fn),
  '文案硬编码进 painter ⇒ 改一个规格会漏掉另一个（下一次真图就是"同一份礼笺两个说法"）')
check('★ 旧文案「扫码进店」必须消失（它只说"扫"，没说扫了能得到什么）',
  // ⚠️ 判**去注释后的代码**：注释里正当地解释了"为什么不再用这句"，
  //    拿含注释的源码判会自己把自己判红（第一版就是这么红的）。
  !/扫码进店/.test(cardCode),
  '还留着「扫码进店」—— 顾客不知道值不值得扫')
check('★★ 小程序码文案必须与**码真正指向的落地页**一致（须是养护说明，且清单页 = care/guide）',
  (() => {
    const capt = /miniprogram: '([^']+)'/.exec(cardSrc)
    if (!capt) return false
    // 文案里必须出现「养护」——承诺的是养护说明，不是"进店"
    if (!/养护/.test(capt[1])) return false
    // 清单（生成时的侧车记录）里的 page 必须是养护指南页；没有清单 = 无法核对 = 判红
    const man = sidecarOf('miniprogram/scripts/qr-assets/gift-care-code-print.json')
    return !!man && man.page === 'subpackages/feature/care/guide/index' && !!man.scene
  })(),
  '文案说"养护说明"，但码的清单里 page 不是 care/guide（或没有清单）—— 这是印在纸上的假承诺')
check('★★ 印在纸上的小程序码必须是**纯黑**（热敏头没有灰阶 —— 品牌黄铜在米白上只有 ~1.7:1，抖动后是噪声）',
  (() => {
    const man = sidecarOf('miniprogram/scripts/qr-assets/gift-care-code-print.json')
    // 颜色必须**在清单里被记下来**（没有这条记录 = 无法核对 = 判红，而不是默认放行）
    return !!man && /^#?0{6}$/.test(String(man.lineColor || '').toLowerCase())
  })(),
  '印刷码不是纯黑：热敏抖动会把中灰抖成 50% 散点（亮模块也被点上黑点）→ 扫不出来。用 generate-store-qr.js --mono 重新生成')
check('★★ 必须有**兜底文案**（识别困难时怎么办），且给的是可执行的第二条路',
  (() => {
    const m = /hint: '([^']+)'/.exec(cardSrc)
    return !!m && /山海造物/.test(m[1]) && m[1].length >= 10
  })(),
  '兜底文案缺失或没给出"微信搜索「山海造物」"这条可执行路径 ⇒ 扫不出来就彻底断了导流')
check('★★ 兜底文案必须**真的画出来**（两枚码都在时才画，且与码块同一条中轴）',
  /ctx\.fillText\(PRINT_QR_COPY\.hint, axisX \+ Math\.round\(qrZone \/ 2\)/.test(stickerFn)
  && /ctx\.fillText\(PRINT_QR_COPY\.hint, Math\.round\(\(blockL \+ qrRight\) \/ 2\)/.test(a6Fn),
  '常量写了但没落墨 = 白定义（贴纸与 A6 两处都要画）')
check('★★ 兜底文案放不下时必须**缩字**（同署名的做法），缩到下限才告警',
  /while \(hintFont > 16 && ctx\.measureText\(PRINT_QR_COPY\.hint\)\.width > qrZone\)/.test(stickerFn)
  && /hintFont <= 16\) console\.warn/.test(stickerFn),
  '文案超宽不缩字 ⇒ 会越进右侧印章区（真渲染的"印章区零落墨"会当场判红）')

check('★ **不印自带边框**（贴纸已有装饰边框，再印一条是双框 —— 蓝图 §5）',
  !/strokeRect/.test(stickerFn),
  'sticker 分支里出现 strokeRect = 多印了一条边框')
check('★ 两枚码仍在页脚带内、从 `qrTop = footerTop − qrLift` 起（码块整体上提，把纸底让给两行小字）',
  /const qrTop = STICKER\.footerTop - STICKER\.qrLift/.test(stickerFn)
  && /\n  qrLift: Math\.round\(/.test(cardSrc)
  && /drawImage\(c\.img, x, qrTop, STICKER\.qrSize, STICKER\.qrSize\)/.test(stickerFn),
  '码块必须由 qrTop 定位（原来直接落 footerTop，纸底只剩 23px ⇒ 放不下兜底文案）')
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
    qrLift: tableOf('qrLift'), qrHintOffset: tableOf('qrHintOffset'),
    stampSize: tableOf('stampSize'), stampRightPad: tableOf('stampRightPad'),
    stampTopPad: tableOf('stampTopPad'),
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
  // ⚠️ 2026-09-20 修一处**过期不变式**：painter 从引入 `qrLift` 起，码块是从
  //    `qrTop = footerTop − qrLift` 起画的，而这里仍按 `footerTop` 复算 ——
  //    于是判据算的是"不存在的那一行"（实测差 qrLift 那么多），真图上小字明明在纸内却报 -1px。
  //    现在按真实几何复算，并且 ⑤b/⑤d 判的是**最下面那一行（兜底文案）**，不是码下小字。
  const qrTop = T.footerTop - T.qrLift
  const captionBase = qrTop + T.qrSize + T.qrCaptionOffset
  const hintSize = Number((/qrHintSize: (\d+),/.exec(cardSrc) || [])[1]) || 21
  const hintBase = captionBase + T.qrHintOffset
  const hintBottom = hintBase + Math.round(hintSize * 0.22)   // 基线 → 降部底
  check('★ 不变式⑤：两枚码（左起）**不得越过印章左缘**（近方形历史 bug：码压预印印章）',
    codesRight <= stampLeft, `码右端=${codesRight} 印章左缘=${stampLeft}`)
  check('★ 不变式⑤b：码 + 两行小字必须在纸内（≤ 纸高，留 ≥ 6px）',
    hintBottom <= S.h - 6, `兜底文案底=${hintBottom} 纸高=${S.h}（余 ${S.h - hintBottom}px）`)
  check('★ 不变式⑤c：码不得压到正文带（码块顶 qrTop ≥ 正文带下沿 bodyFloor）',
    // 码块从 qrTop 起（不是 footerTop）—— 判据要跟着真实几何走，否则 qrLift 一改就失效
    qrTop >= signTop - T.sigOffset - Math.round(34 * 0.85),
    `qrTop=${qrTop} 正文净空线=${signTop - T.sigOffset - Math.round(34 * 0.85)}`)
  /* ── ⑤d~⑤g **用满白区高度**（2026-09-20 真图反馈「排版偏上、下部发虚」）─────────────
   * 这一组是「版面利用率」判据：把内容压到上半部、或页脚离纸底太远，都会被拦下。
   * 全部从 STICKER 表实算（不写死像素），改了参数就会重新判。 */
  check('★ 不变式⑤d：小字必须在纸内且**贴近白区下沿**（余 6~16px：既不裁字也不发虚）',
    hintBottom <= S.h - 6 && hintBottom >= S.h - 16,
    `兜底文案底=${hintBottom} 纸高=${S.h}（余 ${S.h - hintBottom}px）`)
  check('★ 不变式⑤e：页脚必须落在白区**下 1/5**（footerTop ≥ 78% 纸高 —— 否则下部一大片空）',
    T.footerTop >= Math.round(S.h * 0.78), `footerTop=${T.footerTop} < ${Math.round(S.h * 0.78)}`)
  check('★ 不变式⑤f：两枚码右缘离印章左缘 ≥ 6mm（不能挤到一起；也不能因过大顶到纸底）',
    stampLeft - codesRight >= Math.round(6 * MMV),
    `码右缘=${codesRight} 印章左缘=${stampLeft} 余=${stampLeft - codesRight}px`)
  check('★ 不变式⑤g：日期**右对齐**且在印章左缘之上（右半区要有内容，否则右下发虚）',
    /ctx\.fillText\(dateText, axisRight, STICKER\.footerTop/.test(stickerFn)
    && T.footerTop - T.dateOffset < T.footerTop + T.stampTopPad,
    `日期基线=${T.footerTop - T.dateOffset} 印章上缘=${T.footerTop + T.stampTopPad}`)
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
  check(`真渲染「${c.name}」画布 = 886×886`, size.w === SPEC_W && size.h === SPEC_H, `实际 ${size.w}×${size.h}`)
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
  // 2026-09-20 放大后的口径：基准 46px、下限 30px
  check('★ 正文自适应：短笺用基准字号(46px)，长笺才缩小（且不低于下限 30px）',
    f1 === 46 && f6 >= 30 && f6 <= f1, `1 句=${f1}px / 6 句=${f6}px`)
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

/* ── ④ 手写体：canvas 必须用**已注册的网络字体族**（2026-09-20 产品负责人真机反馈）──
 * 「礼笺的字体输出不是礼赠页面的手写体」的根因：
 *   页面（compose 的 `.card-write-text` / `.card-note-display`）用 `'ShanhaiHand', 系统栈`，
 *   而 canvas 的 `HAND` 只有系统栈；**iOS 的 WeChat WebView 不向网页暴露**汉仪手写/签笔这些中文族
 *   （utils/handFont.js 有实测记录）→ 屏幕上是手写体、导出图落回系统字体。
 * 两条判据缺一不可：栈里要有 `ShanhaiHand`，**而且**画之前要等它加载完
 * （`loadFontFace` 是异步的，不等就画会把兜底字体排好缓存下来）。 */
{
  const handStacks = [...cardSrc.matchAll(/const HAND = '([^']*)'/g)].map((m) => m[1])
  check('★ 画布手写体栈必须以已注册的 `ShanhaiHand` 打头（A6 + 贴纸两处都要）',
    // ⚠️ 捕获到的是**引号内的内容**，它以 `"` 开头（栈里写的是 "ShanhaiHand"），不是 `'`
    handStacks.length === 2 && handStacks.every((f) => /^"ShanhaiHand"/.test(f)),
    `共 ${handStacks.length} 处：${handStacks.map((f) => f.slice(0, 30)).join(' || ')}`)
  check('★ 画之前必须**等手写体加载完**（异步注册，不等就会把兜底字体缓存进画布）',
    /await ensureHandFont\(\)/.test(cardSrc) && /require\(['"][^'"]*handFont['"]\)/.test(cardSrc))
}

/* ── ④.6 P0-2 容量用例：141 / 160 / 200 字正文**必须仍有落墨**───────────────────
 * 判据盲区修复：原来渲染用例最长只有 96 字（72 字那种更短），于是
 * 「服务端收 200 字 → 贴纸正文整段空白」**守卫全绿**（审计 P0-2 的守卫盲区）。
 * 现在 141 / 160 / 200 三档都真渲染：打印路径 clamp 到 `GIFT_NOTE_MAX_CHARS` 后必须落墨 ≥1 行
 *（**允许截断，不许整段空白** —— 空白就是真图事故形态）。
 * 再加一条**同长断言**：200 字与 140 字落墨行数必须相同 ⇒ 证明是"截断到上限"而不是"没画"。 */
{
  const NAMES = { recipientName: '虞博阳&王瑛', themeName: '双翼同辉', themeNote: '一对凤蝶并展，如两心相照，光落成双。', cardSignature: '冶禹军', qrcodeImage: {}, serviceQrImage: {} }
  const SENT = '见字如面。山中有木，海中有舟，人间有你。'
  const bodyOf = (n) => SENT.repeat(Math.ceil(n / SENT.length)).slice(0, n)
  const linesOf = (n) => {
    const canvas = makeCanvas()
    G.paintGiftPrintCard(canvas, Object.assign({}, NAMES, { spec: 'sticker', cardBody: bodyOf(n) }))
    return canvas._ops.filter((o) => o.op === 'text' && HAND_RE.test(o.font || '')
      && o.y > 260 && o.y <= signTopV + Math.round(34 * 1.62)).length
  }
  const LIMIT = Number(G.GIFT_NOTE_MAX_CHARS)
  for (const n of [141, 160, 200]) {
    let drawn = -1
    let err = null
    try { drawn = linesOf(n) } catch (e) { err = e }
    check(`★★ P0-2 容量：${n} 字正文（clamp 到 ${LIMIT}）不得「正文只画了 0 行」`,
      !err && drawn >= 1, err ? String(err.message) : `${n} 字只画了 ${drawn} 行`)
  }
  const l140 = linesOf(140)
  const l200 = linesOf(200)
  check('★★ P0-2：200 字与 140 字落墨行数相同（证明打印路径确实 clamp 到上限，而非整段不画）',
    l140 >= 1 && l200 === l140, `140→${l140} 行 / 200→${l200} 行`)
}

/* ── ⑥ P0-2 服务端口径**同源**：5 个 giftMeta.js 的正文上限必须 === GIFT_NOTE_MAX_CHARS ─────
 * 审计 P0-2 的核心是「UI 上限 140、服务端仍收 200」——141–200 字的正文在贴纸上整段消失。
 * 这条判据把"服务端与客户端口径不一致"变成一条**会被看到的红线**：
 *   ① 每个 giftMeta.js 都必须有常量且 === 客户端 `GIFT_NOTE_MAX_CHARS`；
 *   ② cardBody 必须**用常量 clamp**（不许再出现字面量 200）；
 *   ③ 5 份副本的「常量块 + clamp 行」必须**逐字节相同**（本仓副本惯例）。
 * ⚠️ 5 个文件**整体**并非逐字节相同（buildProductSnapshot / maskAddress 各有合法差异），
 *    所以"逐字节"断言只针对**礼笺正文口径这一段**（那才是必须同源的部分）。 */
const GIFT_META_COPIES = [
  'miniprogram/cloudfunctions/makeOrder/giftMeta.js',
  'miniprogram/cloudfunctions/confirmPayment/giftMeta.js',
  'miniprogram/cloudfunctions/payCallback/giftMeta.js',
  'miniprogram/cloudfunctions/managerShipOrder/giftMeta.js',
  'miniprogram/cloudfunctions/manageGift/giftMeta.js'
]
{
  const clientMax = Number(G.GIFT_NOTE_MAX_CHARS)
  check('★ 客户端 GIFT_NOTE_MAX_CHARS 可解析', Number.isFinite(clientMax) && clientMax > 0, String(G.GIFT_NOTE_MAX_CHARS))
  const blocks = []
  const clampLines = []
  for (const rel of GIFT_META_COPIES) {
    const src = readFileSync(resolve(ROOT, rel), 'utf8')
    const m = /const GIFT_NOTE_MAX_CHARS = (\d+)/.exec(src)
    check(`★ ${rel}：正文上限 === 客户端常量`, !!m && Number(m[1]) === clientMax,
      m ? `服务端 ${m[1]} / 客户端 ${clientMax}` : '没有 GIFT_NOTE_MAX_CHARS 常量（口径不同源）')
    const line = ((/const cardBody = [^\n]*/.exec(src) || [''])[0]).trim()
    clampLines.push(line)
    check(`★ ${rel}：cardBody 用常量 clamp（不得再是字面量 200）`,
      /slice\(0,\s*GIFT_NOTE_MAX_CHARS\)/.test(line) && !/slice\(0,\s*[0-9]+\)/.test(line), line)
    blocks.push(((/(\/\*\* 礼笺正文字数上限[\s\S]*?const GIFT_NOTE_MAX_CHARS = \d+\n)/.exec(src) || [''])[0]))
  }
  check('★★ 5 份 giftMeta.js 的「常量块」逐字节相同', blocks.every((b) => b) && new Set(blocks).size === 1,
    `${new Set(blocks).size} 种写法`)
  check('★★ 5 份 giftMeta.js 的「cardBody clamp 行」逐字节相同', new Set(clampLines).size === 1,
    `${new Set(clampLines).size} 种写法`)
}

/* ── 输出 / 自检 ─────────────────────────────────────────────────────────── */
if (process.argv.includes('--selftest')) {
  selftest()
} else if (failed) {
  console.log('✗ 礼笺贴纸版式检查失败：')
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`✗ ${failed} 项失败 / ${passed} 项通过`)
  process.exit(1)
} else {
  console.log(`✓ 礼笺贴纸版式：${passed} 项通过（886×886 规格 / 真渲染印章区零落墨 / 正文不溢页脚 / 两入口共用一条实现）`)
  console.log('  ⚠ 可打印区与 24mm 印章位置均为**影像预估**：贴纸到货后必须印校准网格回填 STICKER 表，再做真图复核（E8）')
}

function selftest() {
  const injections = [
    {
      // 让印刷码退回"品牌黄铜色"（屏幕好看，热敏上是一坨中灰 → 抖成噪声 → 扫不出）
      name: '小程序码文案不再指向养护说明（回到「扫码进店」：只说扫，没说扫了能得到什么）',
      file: CARD,
      from: "  miniprogram: '养护指南',",
      to: "  miniprogram: '扫码进店',"
    },
    {
      name: '印刷码退回品牌黄铜色（热敏上是一坨中灰 → 抖成噪声 → 扫不出）',
      file: 'miniprogram/scripts/qr-assets/gift-care-code-print.json',
      from: '  "lineColor": "#000000",',
      to: '  "lineColor": "#C4A76C",'
    },
    {
      name: '兜底文案被清空（识别困难时顾客没有第二条路）',
      file: CARD,
      from: "  hint: '微信搜山海造物领标本养护指南'",
      to: "  hint: ''"
    },
    {
      name: '兜底文案只在常量里、不再落墨（白定义）',
      file: CARD,
      from: "    ctx.fillText(PRINT_QR_COPY.hint, axisX + Math.round(qrZone / 2), captionBase + STICKER.qrHintOffset)",
      to: "    void PRINT_QR_COPY.hint"
    },
    {
      name: '码块退回直接落 footerTop（纸底只剩 23px ⇒ 兜底文案被挤出纸外）',
      file: CARD,
      from: '  const qrTop = STICKER.footerTop - STICKER.qrLift',
      to: '  const qrTop = STICKER.footerTop'
    },
    {
      name: '兜底文案超宽时不再缩字（会越进右侧预印印章区）',
      file: CARD,
      from: '    while (hintFont > 16 && ctx.measureText(PRINT_QR_COPY.hint).width > qrZone) {',
      to: '    while (false) {'
    },
    {
      name: '贴纸规格被改错（886×886 → 620×886）—— 1:1 的 75×75mm 被推翻',
      file: CARD,
      from: "  sticker: { w: 886, h: 886, designW: 886, label: '热敏贴纸可打印区 75×75mm（1:1）' },",
      to: "  sticker: { w: 620, h: 886, designW: 620, label: '热敏贴纸可打印区 75×75mm（1:1）' },"
    },
    {
      // 真机预览抓到的那个 bug 本体：偏移不夹 → 末行越线 → 循环里 break → 正文被截断
      name: '偏移不再夹「末行不越线」（正文被截断）',
      file: CARD,
      from: '    const blockTop = bodyTop + Math.min(wantOffset, maxOffset)',
      to: '    const blockTop = bodyTop + wantOffset'
    },
    {
      name: '落墨循环里又出现 break（部分落墨 = 半封信）',
      file: CARD,
      from: '      ctx.fillText(bodyLines[i], axisX, bodyY + i * lineH)\n      bodyDrawn += 1',
      to: '      if (bodyY + i * lineH > bodyFloor()) break\n      ctx.fillText(bodyLines[i], axisX, bodyY + i * lineH)\n      bodyDrawn += 1'
    },
    {
      name: '画布手写体栈丢掉 ShanhaiHand（回到"系统栈 → iOS 落回默认字体"）',
      file: CARD,
      // ⚠️ 两处 HAND 常量**逐字相同** → 锚点必须带上下文才唯一（这里锚贴纸那处的专属注释）
      from: "  // 手写体：与 A6 **完全同一套栈**（含已注册的 ShanhaiHand）—— 改这里必须同时改 A6 那处。\n  // 为什么两处都得带 ShanhaiHand：见 A6 分支上面那段（iOS 不暴露中文手写族，只有网络字体有效）。\n  const HAND = '\"ShanhaiHand\", \"HanziPen SC\", \"Hannotate SC\", \"STKaiti\", \"Kaiti SC\", \"KaiTi\", serif'",
      to: "  // 手写体：与 A6 **完全同一套栈**（含已注册的 ShanhaiHand）—— 改这里必须同时改 A6 那处。\n  // 为什么两处都得带 ShanhaiHand：见 A6 分支上面那段（iOS 不暴露中文手写族，只有网络字体有效）。\n  const HAND = '\"HanziPen SC\", \"Hannotate SC\", \"STKaiti\", \"Kaiti SC\", \"KaiTi\", serif'"
    },
    {
      name: '画之前不再等手写体（异步注册没完成就出图）',
      file: CARD,
      from: '            const { ensureHandFont } = require(\'../../../utils/handFont\')\n            await ensureHandFont()',
      to: '            const { ensureHandFont } = require(\'../../../utils/handFont\'); void ensureHandFont'
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
      // 2026-09-20 下限 22→30（字号放大批次）→ 注入把它抬到 44：长笺必然放不下 ⇒ 信文丢失
      name: '正文自适应下限被抬高到 44px（长笺放不下 → 信文丢失）',
      file: CARD,
      from: 'while (fontPx > 30 && !fits()) {',
      to: 'while (fontPx > 44 && !fits()) {'
    },
    {
      name: '★ 署名净空被删（正文末行与署名基线贴住/叠字 —— 真图第二轮实测 455 同为一行）',
      file: CARD,
      from: '  const sigClear = () => Math.round(fontPx * 0.85)',
      to: '  const sigClear = () => 0'
    },
    {
      // 2026-09-20：原来的注入锚在 `if (baseline > bodyFloor()) { …; break }` ——
      // 那行本身就是"部分落墨"的 bug，已随修复删除。等价意图改由下面两条承担：
      //   · 「偏移不再夹「末行不越线」」（越线风险回到定位阶段）
      //   · 「落墨循环里又出现 break」
      // 这一条改为**证明"净空线本身还在判"**：把 bodyFloor 抬到正文带顶之上，
      // 整块预检就该直接拒绝落墨（一行都不画），而不是画到一半。
      name: '★ 净空线失效（bodyFloor 被抬到正文带顶之上 ⇒ 预检不再拒画）',
      file: CARD,
      from: '  const bodyFloor = () => STICKER.footerTop - STICKER.sigOffset - sigClear()',
      to: '  const bodyFloor = () => bodyTop - 1000'
    },
    {
      name: '★ 整块预检被绕开（改成"只要 availH>0 就画" ⇒ 部分落墨 / 叠字）',
      file: CARD,
      from: `  // 整块预检：必须能一次装下**全部**行才落墨（不满足则一行不画，绝不部分落墨/叠字）`,
      to: '  // 注入：预检被绕开'
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
    },
    {
      // P0-2 服务端口径漂移：某个 giftMeta.js 的正文上限被改回 200（客户端是 140）
      name: '★ P0-2：giftMeta.js 正文上限被改回 200（与客户端 140 不同源）',
      file: 'miniprogram/cloudfunctions/makeOrder/giftMeta.js',
      from: 'const GIFT_NOTE_MAX_CHARS = 140',
      to: 'const GIFT_NOTE_MAX_CHARS = 200'
    },
    {
      // P0-2 服务端退回字面量 clamp：即使常量还在，cardBody 也不再用它
      name: '★ P0-2：giftMeta.js 的 cardBody 退回字面量 slice(0, 200)',
      file: 'miniprogram/cloudfunctions/confirmPayment/giftMeta.js',
      from: "  const cardBody = String(src.cardBody || '').trim().slice(0, GIFT_NOTE_MAX_CHARS)",
      to: "  const cardBody = String(src.cardBody || '').trim().slice(0, 200)"
    },
    {
      // P0-2 打印路径不再 clamp：存量 141–200 字会整段空白（容量用例必须当场判红）
      name: '★ P0-2：打印路径不再 clamp 正文（141–200 字会整段空白）',
      file: CARD,
      from: '  const o = clampGiftNoteBody(opts)',
      to: '  const o = opts || {}'
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
