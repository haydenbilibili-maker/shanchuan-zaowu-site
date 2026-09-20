/**
 * 心愿文案的「字数」口径 —— 纯函数核（无 wx / 无云 / 无相对 require，可在 Node 里直接单测）
 *
 * ## 为什么要有这个模块（P0 真 bug）
 *
 * 出处：`docs/祈福墙_全面改造_交付记录_2026-09-20.md` §7 第 4 条
 * ——「emoji 计数仍按 UTF-16 码元（`draft.length` / `.slice(0,30)`）：emoji 算 2、
 * ZWJ 家庭 emoji 算 8，30 字上限对纯中文准确、对 emoji 会少算，极端情况下 `.slice`
 * 会截出半个代理对」。
 *
 * 具体地：
 *   · `'👨‍👩‍👧'.length === 8`（3 个代理对 = 6 个 UTF-16 码元 + 2 个 ZWJ）→ 明明只写了
 *     1 个字，却按 8 个字算，30 字上限对 emoji 严重少算；
 *   · `'🙂🙂'.slice(0, 3)` = `'🙂' + '\uD83D'`（半个代理对）→ 输入框/弹幕里出现「口」，
 *     字体渲染、长度比较、审核视图全都错。
 *
 * ## 计数口径（本模块是这条口径的唯一事实源）
 *
 * **一个「字」= 一个 Unicode 码点，外加紧跟其后的「附码」（extend）；附码与基码点同属一个字。**
 *
 * 「附码」按下面的规则**近似** grapheme cluster（字形簇）：
 *   1. `\u{1F3FB}`–`\u{1F3FF}` —— 肤色修饰符（`👍🏽` 算 1 个字）；
 *   2. `\uFE0E` / `\uFE0F` —— 变体选择符 VS15/VS16（`❤️` 算 1 个字）；
 *   3. `\p{Emoji_Modifier}` —— 兜住第 1 条之外的 emoji 修饰符；
 *   4. `\p{Mark}` —— 组合用记号（`e` + U+0301 算 1 个字）；
 *   5. `\u200D`（ZWJ）**连同它后面那一个码点** —— 把 `👨‍👩‍👧` 这类 ZWJ 序列整体粘成
 *      一个字（末尾孤立 ZWJ 只吃掉自己）；
 *   6. `\u{1F1E6}`–`\u{1F1FF}`（区域指示符）—— 两枚成一面国旗（`🇨🇳` 算 1 个字）。
 *
 * ⚠️ **刻意不把「emoji 基字」本身放进附码类**：`\p{Emoji_Presentation}` 与
 * `\p{Emoji_Modifier}` 在 Unicode 里几乎重合，放进去会把**相邻的两个 emoji** 粘成一个
 * 字（`'🙂🙂'` 会算成 1）。emoji 之间的边界靠"基码点不吸收基码点"来保证。
 *
 * 于是：
 *   · `'👨‍👩‍👧'` → **1**（此前的 `.length` 是 8）；
 *   · `'👨‍👩‍👧‍👦'` → 1；`'🇨🇳'` → 1；`'🇨🇳🇯🇵'` → 2；`'👍🏽'` → 1；`'❤️'` → 1；`'e\u0301'` → 1；
 *   · `'abc'` → 3；`'马上有'` → 3；`'🙂🙂'` → 2。
 *     **纯中文 / 纯 ASCII 的旧口径完全不变**，所以既有的 2–30 上限对它们是等价的
 *     （不是"顺手把闸门放宽"，emoji 只是从"被算多"回到"算 1"）。
 *
 * ### ⚠️ 已知边界（写清楚，不许含糊）
 *
 * 1. **这是近似，不是 UAX #29 的完整 grapheme cluster。** 真机上没有可依赖的
 *    `Intl.Segmenter`（Node 22 有，但小程序基础库不保证有），所以按「基码点 + 后续
 *    ZWJ / 变体 / 组合符」的规则近似。已知会与完整规则不一致的形态：
 *      · 未用 ZWJ 连接的 `👨👩👧`（三个独立 emoji）算 3 —— 它本身就是 3 个独立字形；
 *      · 韩文 Jamo 组合（L+V+T 三个码点）会算成 2 而不是 1（`\p{Mark}` 只吃掉 T）；
 *      · 相邻两枚 emoji 之间的修饰符不会跨字（`'👍🏽🙂'` = 2，正确）。
 *    这些偏差**只会让计数偏大**（更保守），不会偏小到出现「端上允许、服务端拒绝」。
 * 2. **`normalizeWishText` 目前会剥掉 ZWJ。** `utils/wishWall.js` 与
 *    `cloudfunctions/manageWishWall/index.js` 的 `normalizeWishText` 用的是
 *    `/[\u200B-\u200D\uFEFF]/g` —— `\u200D` 正是 ZWJ，于是**经过归一化的文案里 ZWJ
 *    已经没了**，`👨‍👩‍👧` 会先被拆成 `👨👩👧`（按本模块算 3）。所以本模块的 ZWJ 规则
 *    只在「未经归一化的原文」上生效 —— **输入框草稿（`onDraftInput`）正是这种原文**，
 *    所以"用户键入组合 emoji 时计数正确"这条路是真的成立的；
 *    而"抄一句 / 灵感词 / 云函数校验"这三条路走的是归一化后的文本，家庭 emoji 在那里已被拆成
 *    3 个独立 emoji（按本模块算 3 —— 与"它就是 3 个字形"的实际渲染一致，不是少算）。
 *    要彻底坐实"家庭 emoji 全程 = 1 个字"，需要把那两处正则里的 `\u200D` 去掉
 *    （即把 ZWJ 从"零宽垃圾字符"里豁免）。那两处不在本次改动的文件白名单内，
 *    **已作为必办事项写进交付说明交给集成官**，本模块不擅自越界。
 * 3. 本模块只回答「几个字」与「怎么安全截到几个字」，**不负责归一化**
 *    （折叠空白、去控制字符仍走 `utils/wishWall.normalizeWishText`）。
 *
 * ## 两端口径同源（本仓 `check:shared-modules` 的既有惯例）
 *
 * 云函数是**独立部署单元**（微信上传按函数目录打包），不能 require 小程序目录的文件；
 * 而两端必须同一口径，否则会出现「端上允许、服务端拒绝」。
 * 故按 `utils/ritualProfileCore.js` ↔ `cloudfunctions/wishRitualProfile/ritualProfileCore.js`
 * 的**逐字节相同双份**模式：云函数把本文件里 `WISH_TEXT_COUNT_BEGIN` 与
 * `WISH_TEXT_COUNT_END` 两个标记之间的区间**原样**内嵌进
 * `cloudfunctions/manageWishWall/index.js`（区间里没有 `module.exports = {…}` 整体赋值 ——
 * 整体赋值会把云函数自己的 `module.exports`（`main` 等）整个覆盖掉，所以这里用逐属性赋值）。
 * `miniprogram/scripts/test-wish-wall.mjs` 会：
 *   ① 逐字节比对两份正文；② 用同一组用例跑两端实现并比对结果；
 *   ③ 用注入证明「退回 `.length`」与「`.slice` 截出半个代理对」都会被检出。
 */
// WISH_TEXT_COUNT_BEGIN —— 字数口径同源区间的起点：本区间在「小程序 utils/wishTextCount.js」
// 与「云函数 manageWishWall/index.js」里**逐字节相同**（理由与守卫见文件头）。
'use strict'

/**
 * 「附码」判定（与基码点同属一个字）。
 * 用 `u` 标志是为了 `\u{…}` 与 `\p{…}`（Node ≥ 12 与小程序基础库都支持）。
 */
const WISH_TEXT_EXTEND_RE =
  /[\u{1F3FB}-\u{1F3FF}\uFE0E\uFE0F\p{Emoji_Modifier}\p{Mark}\u200D\u{1F1E6}-\u{1F1FF}]/u

/**
 * 一个「字」由几个码点组成？返回正数表示 `codePoints[index]` 是「附码」。
 * 单独抽出来只为让「基码点 + 后续附码」这条规则只有一处实现。
 */
/** ZWJ（U+200D）的数值码点。写成常量而不是行内字面量，便于守卫按名字断言。 */
const WISH_TEXT_ZWJ = 8205

function wishTextExtendSize(codePoints, index) {
  const el = codePoints[index]
  // 入参可能是「单码点字符串」（`Array.from(str)` 的产物），也可能是数值码点
  // （`Array.from(str, (c) => c.codePointAt(0))` 的产物）—— 两种都收。
  // 孤立代理项会拿到 NaN → 视为「不是附码」，绝不让 `String.fromCodePoint` 抛 RangeError。
  const cp = typeof el === 'number' ? el : String(el).codePointAt(0)
  if (!Number.isInteger(cp)) return 0
  if (cp === WISH_TEXT_ZWJ) {
    // ZWJ：把自己与**紧跟的那一个码点**一起挂到当前字上。
    // 这就是 `👨‍👩‍👧` = 1 个字的原因（人 + ZWJ + 人 + ZWJ + 人 全部同属一个字）。
    // 末尾孤立 ZWJ 只吃掉自己（返回 1），不会越界。
    return index + 1 < codePoints.length ? 2 : 1
  }
  return WISH_TEXT_EXTEND_RE.test(String.fromCodePoint(cp)) ? 1 : 0
}

/**
 * 区域指示符（国旗字母）判定。
 *
 * 为什么要单拎出来：`\u{1F1E6}-\u{1F1FF}` 在 `WISH_TEXT_EXTEND_RE` 里是"可附"的，
 * 但**一枚国旗恰好由两枚组成** —— 无脑往后粘会把 `🇨🇳🇯🇵` 粘成一个字（应为 2）。
 * 故在拼接循环里数「已经吃掉几枚」：吃掉偶数枚时，下一枚可以成对；吃掉奇数枚时结字。
 */
function wishTextIsRegionalIndicator(cp) {
  return cp >= 0x1f1e6 && cp <= 0x1f1ff
}

/**
 * 把文本拆成「字」的数组（每项是一个字，元素数量 = 字数）。
 * 截断与计数都走这一处，防止两条口径漂移。
 * @param {*} raw
 * @returns {string[]}
 */
function wishTextGraphemes(raw) {
  const text = String(raw == null ? '' : raw)
  if (!text) return []
  const chars = Array.from(text)
  const out = []
  let i = 0
  while (i < chars.length) {
    let end = i
    let ris = wishTextIsRegionalIndicator(String(chars[i]).codePointAt(0)) ? 1 : 0
    for (;;) {
      if (end + 1 >= chars.length) break
      const size = wishTextExtendSize(chars, end + 1)
      if (!size) break
      // 国旗：已吃掉偶数枚区域指示符时才允许再粘一枚（两枚 = 一面旗）
      const nextCp = String(chars[end + 1]).codePointAt(0)
      if (wishTextIsRegionalIndicator(nextCp)) {
        // 已经吃掉偶数枚 = 上一面旗配齐了，不许再粘（否则 🇨🇳🇯🇵 会粘成一个字）
        if (ris % 2 === 0) break
        ris += 1
      }
      end += size
    }
    out.push(chars.slice(i, end + 1).join(''))
    i = end + 1
  }
  return out
}

/**
 * 按**字**计数（emoji / ZWJ 序列 / 变体选择符 = 1）。口径与已知边界见文件头。
 * @param {*} raw
 * @returns {number}
 */
function wishTextCount(raw) {
  return wishTextGraphemes(raw).length
}

/**
 * 按**字**安全截断：只保留前 `max` 个字，**绝不切出半个代理对**。
 *
 * 实现说明：先切成「字」，再 `slice(0, max)` —— 一个「字」在源码里始终是完整的码点序列，
 * 所以截断点永远落在字边界上（`.slice(0,30)` 的代理对 / ZWJ 撕裂不可能再发生）。
 * `max <= 0` 返回空串；`max` 非有限数时返回原文（口径：调用方传错就别丢用户内容）。
 *
 * @param {*} raw
 * @param {number} max
 * @returns {string}
 */
function wishTextTruncate(raw, max) {
  const text = String(raw == null ? '' : raw)
  const n = Number(max)
  if (!Number.isFinite(n)) return text
  if (n <= 0) return ''
  return wishTextGraphemes(text).slice(0, Math.floor(n)).join('')
}

// 逐属性赋值而不是 `module.exports = {…}`：本区间要**原样内嵌**到云函数里，
// 整体赋值会把云函数自己的 `module.exports`（main 等）整个覆盖掉。
module.exports.WISH_TEXT_EXTEND_RE = WISH_TEXT_EXTEND_RE
module.exports.wishTextExtendSize = wishTextExtendSize
module.exports.wishTextGraphemes = wishTextGraphemes
module.exports.wishTextCount = wishTextCount
module.exports.wishTextTruncate = wishTextTruncate
// WISH_TEXT_COUNT_END
