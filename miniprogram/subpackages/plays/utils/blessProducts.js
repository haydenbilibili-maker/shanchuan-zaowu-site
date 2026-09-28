/**
 * 祈运弱推的**纯逻辑**（需求 28 · item 6 的 C 端收尾）
 *
 * 为什么单独一个文件而不是写在页面里：页面的 `loadBlessReco` 里有三处判断（缓存键、取第一条、
 * 价格文案），写在 Page 里就只能靠"读源码"来守卫 —— 而本轮已经栽过一次
 * （`normalizeWish` 那条断言因为两层校验互相兜底，任何单点回归都测不出来）。
 * 抽成纯函数后：能给注入、能在守卫里直接断言。
 */

/**
 * 缓存键：**标签 + 上海自然日**。
 * ⚠️ 日期不能省：玩法结果是一天一支、推荐是一天一件；只按标签缓存会让跨天还拿昨天的推荐
 * （"一天一件"悄悄变成"永远同一件"）。日期口径与点灯/灯语同源（`shanghaiDayKey`）。
 */
function recoCacheKey(tag, dayKey) {
  const t = String(tag || '').trim()
  if (!t || !dayKey) return ''
  return `${t}|${String(dayKey)}`
}

/** 价格文案：没有价格就不显示（不写 ¥0 也不写 ¥undefined） */
function formatPriceText(price) {
  if (price === null || price === undefined || price === '') return ''
  const n = Number(price)
  if (!Number.isFinite(n)) return ''
  return `¥${n}`
}

/**
 * 推荐区的标题：**只用我们真的知道的事** —— "这面墙偏哪一类心愿"。
 *
 * 历史：这里曾按匹配来源分两句 —— 显式标签说「同好也在看」、场景兜底说「这类心愿常配这件」。
 * 但「同好也在看」是**编出来的社会证明**：系统里根本没有共同浏览/同好数据（§33 已把场景那一半改掉，
 * 2026-09-18 的细节雕刻把另一半也去掉）。现在统一为「偏「X」· 为你配一件」：
 * 前半句是这面墙的真实标签，后半句是这次推荐的真实动作。
 *
 * @param {string} blessLabel 这面墙的祈运标签中文名（可为空）
 */
function recoLabel(blessLabel) {
  const label = String(blessLabel || '').trim()
  return label ? `偏「${label}」· 为你配一件` : '为你配一件'
}

/**
 * 云端回包 → 卡片行。取第一条；没有有效行返回 null（卡片整块不渲染）。
 * 主视觉用**主题名**（双层命名里 themeName 才是文艺名），没有才回落标准名 title。
 */
function pickReco(result, tag, blessLabel) {
  const row = result && result.list && result.list[0]
  if (!row || !row._id) return null
  const cover = Array.isArray(row.images) && row.images[0] ? String(row.images[0]) : ''
  return {
    _id: String(row._id),
    title: row.themeName || row.title || '',
    latinName: row.latinName || '',
    priceText: formatPriceText(row.price),
    /** 主图：云函数 leanProduct 已裁 images[0]；无图时页面走铜占位 */
    cover,
    tag: String(tag || ''),
    // 依据与文案一起带出来：页面不再自己拼词，避免"依据变了文案没变"
    matchSource: String(row.matchSource || ''),
    label: recoLabel(blessLabel)
  }
}

module.exports = {
  recoCacheKey,
  formatPriceText,
  pickReco,
  recoLabel
}
