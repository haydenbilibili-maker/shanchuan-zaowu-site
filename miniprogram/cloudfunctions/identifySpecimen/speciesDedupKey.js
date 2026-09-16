/**
 * 同物种去重键（canonical 真源）
 *
 * 需求 1 业务决策（2026-09-16）：**按同物种去重** —— 同一物种只保留一条鉴定记录与一个图鉴。
 *
 * ⚠️ 本文件是唯一真源，两份副本必须一致：
 *   - `cloudfunctions/identifySpecimen/speciesDedupKey.js`（运行时判定 + 建记录时落库）
 *   - `cloudfunctions/identifySpecimen/speciesDedupKey.js` 亦被回填脚本引用
 *     （`miniprogram/scripts/backfill-species-dedup.mjs`），避免「脚本与线上判定不一致」。
 *   修改后运行：`bash miniprogram/scripts/sync-species-dedup.sh`
 *
 * 规则：
 *   - `species_name_latin`（学名）优先：跨语言稳定，避免「大蓝闪蝶 / 蓝闪蝶」这类中文别名各建一条
 *   - 学名缺失时回落中文名
 *   - 归一化：压缩空白 + 转小写（`Morpho  Menelaus` === `morpho menelaus`）
 *   - `is_specimen === false` → 空串（**不参与去重**，否则任意非标本照片会并成一条）
 *   - 占位名（「未知物种」等）→ 空串
 *   - **仅有泛称中文名**（「蝴蝶」「甲虫」这类科/属以上的口语名）→ 空串
 */

const UNKNOWN_SPECIES_LABELS = ['未知物种', '未知', 'unknown', 'unidentified', 'n/a', '-', '—']

/**
 * 泛称（科/属以上的口语名）—— **不是「物种」**。
 *
 * 为什么必须排除（2026-09-16 存量回填 dry-run 实测发现）：
 *   抽样里出现 `key="蝴蝶"` 这类键。模型有时只给出泛称、不给学名，
 *   若照此去重，**所有只被认成「蝴蝶」的不同物种会并成同一条记录** ——
 *   用户拍第二只完全不同的蝴蝶，会被直接复用第一只的结果（错得比"重复记录"严重）。
 *   需求 1 的口径是「**同物种**去重」，泛称不属于物种，故不参与。
 *
 * 边界（诚实声明）：**仅当学名缺失**时才用这份名单拦截。
 * 学名由模型按物种级别给出（如 `Morpho menelaus`），存在即采信 ——
 * 不在此处校验学名的分类层级（那需要分类学数据库，超出本需求范围）。
 */
const GENERIC_NAMES = [
  '蝴蝶', '蛾', '蛾子', '甲虫', '甲壳虫', '昆虫', '蜘蛛', '蟹', '螃蟹', '虾',
  '贝壳', '螺', '蛙', '蛇', '龟', '鸟', '鱼', '植物', '花', '叶', '叶子',
  '蘑菇', '真菌', '化石', '矿物', '标本'
]

/**
 * @param {{species_name_latin?:string, species_name_zh?:string, is_specimen?:boolean}} speciesInfo
 * @returns {string} 去重键；不该去重时返回空串
 */
function buildSpeciesDedupKey(speciesInfo) {
  const s = speciesInfo || {}
  if (s.is_specimen === false) return ''
  const pick = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase()
  const latin = pick(s.species_name_latin)
  const zh = pick(s.species_name_zh)
  const name = latin || zh
  if (!name) return ''
  if (UNKNOWN_SPECIES_LABELS.indexOf(name) !== -1) return ''
  // 只有泛称中文名（没有学名）→ 不是物种级标识，不参与去重
  if (!latin && GENERIC_NAMES.indexOf(zh) !== -1) return ''
  return name.slice(0, 120)
}

module.exports = {
  UNKNOWN_SPECIES_LABELS,
  GENERIC_NAMES,
  buildSpeciesDedupKey
}
