/**
 * 主题名（双层命名）纪律 —— **唯一事实源**
 *
 * 云函数 `assistProductCopy` 内联了一份副本（云函数只能 require 自己目录内的文件），
 * 两者口径由守卫 `test:product-theme-name` 的行为用例比对（2–8 汉字、禁词、去重、与标准名重复剔除）。
 *
 * 何时用：批量生成候选（scripts/scan-product-theme-candidates.mjs）、以及人工复核清单时校验。
 */
export const THEME_NAME_BANNED = ['网红', '爆款', '绝绝子', '爱豆', '明星', '同款', '平替', '秒杀', '限量抢']

/** 2–8 个汉字；无标点/字母/数字；不含禁用词 */
export function isValidThemeName(name) {
  const t = String(name || '').trim()
  if (!/^[\u4e00-\u9fa5]{2,8}$/.test(t)) return false
  return !THEME_NAME_BANNED.some((w) => t.indexOf(w) !== -1)
}

/** 归一化一批候选：校验 → 批内去重 → 剔除与标准名重复 → 最多 5 个 */
export function normalizeThemeCandidates(list, title, seen = new Set()) {
  const out = []
  for (const raw of Array.isArray(list) ? list : []) {
    const name = String((raw && raw.themeName) || '').trim()
    if (!isValidThemeName(name) || seen.has(name)) continue
    if (title && String(title).indexOf(name) !== -1) continue
    seen.add(name)
    out.push({
      themeName: name,
      note: String((raw && raw.note) || '').trim().slice(0, 40),
      scenes: Array.isArray(raw && raw.scenes) ? raw.scenes.slice(0, 4) : []
    })
    if (out.length >= 5) break
  }
  return out
}

/** 与云函数提示词同源的规则片段（批量脚本复用，避免两处措辞漂移） */
export const THEME_PROMPT_RULES = `给出 3–5 个主题名候选（文艺、有意象、贴合送礼场景）：
- 每个 2–8 个汉字，不许用标点/字母/数字；意象取自时间/自然/器物/成对关系；
- 禁止网络流行语、品牌、名人及在世人物、谐音低俗；不得与标准名重复；
- 每项含 themeName（主题名）、note（一句话点题 ≤40 字）、scenes（礼赠场景 key 数组，
  取值 housewarming/wedding/birthday/anniversary/enrollment/graduation/new_job/gratitude）。
例：两件蝴蝶标本 → 双宿双飞（wedding/anniversary）；蝴蝶贝壳钟表 → 时间的守卫者（anniversary/birthday）。`
