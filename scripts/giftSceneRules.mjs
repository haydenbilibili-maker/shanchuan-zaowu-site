/**
 * 礼赠场景标签：建议规则（可复核、可讨论）
 *
 * 场景唯一事实源：`miniprogram/cloudfunctions/getGiftSceneProducts/giftScenes.js`（8 个）
 *   housewarming 乔迁 / wedding 新婚 / birthday 生日 / anniversary 纪念日
 *   enrollment 升学 / graduation 毕业 / new_job 新工作 / gratitude 致谢
 *
 * 设计原则（为什么不是「全部打满 8 个」）
 *   场景标签决定「这件商品在哪个场景下被优先看到」（hub 里带「场景」角标的就是命中项，
 *   其余是兜底混入）。若所有商品都打满 8 个，角标与排序就失去意义 → 必须**有区分度**。
 *
 * 规则（每条都能解释；阈值来自 197 件商品的实际分布：p25=198 / p50=499 / p75=1200 / p90=2300）
 *   R0 排除：已下架、或价格异常（< ¥10，如「测试勿拍」¥0.01）→ 不打标签，单独列出待人工处理
 *   R1 基础：生日 + 致谢 —— 送人的通用场合，几乎任何一件都成立
 *   R2 陈设·郑重：**陈列类**品类且价格 ≥ 300 → 加 乔迁 + 新婚 + 纪念日
 *        （乔迁/新婚要的是「落在桌上/新家里」的陈设件；首饰是个人佩戴，不进这三档 —— R4）
 *   R3 可带走·轻礼：价格 ≤ 800 → 加 升学 + 毕业 + 新工作
 *        （给同学/新同事的礼要「轻、能带走」；¥800 是 p75 附近，往上就偏离伴手礼的量级）
 *   R4 首饰馆：加 纪念日（个人佩戴最贴合纪念日），**不进** 乔迁/新婚（非陈设件）
 *   R5 收藏级修正：价格 ≥ 3000 → 去掉 升学/毕业/新工作；价格 ≥ 10000 → 只留 纪念日
 *
 * 结果：每个场景拿到的商品集合**互不相同**（乔迁/新婚偏中高价陈设件、升学/毕业偏轻礼、
 * 纪念日覆盖最广），既「都打上了」又保留区分度。
 */

/** 陈列类根分类（可落桌/挂墙的陈设件）——不含首饰馆 */
const DISPLAY_ROOTS = ['昆虫馆', '动物馆', '海洋馆', '植物馆', '矿石馆', '衍生品']
const WEARABLE_ROOT = '首饰馆'

const MIN_SANE_PRICE = 10
const LIGHT_GIFT_MAX = 800
const STATEMENT_MIN = 300
const COLLECTOR_MIN = 3000
const TOP_TIER_MIN = 10000

/** @returns {string[]} 建议场景（已去重、按固定顺序） */
function proposeScenes(product) {
  const p = product || {}
  const price = Number(p.price) || 0
  const root = String(p.rootCategoryName || '').trim()

  // R0：下架 / 价格异常 → 不打标签（由人工决定）
  if (p.isOffShelf === true) return []
  if (!(price >= MIN_SANE_PRICE)) return []

  const set = new Set()
  const add = (...keys) => keys.forEach((k) => set.add(k))

  // R1 基础
  add('birthday', 'gratitude')

  const isDisplay = DISPLAY_ROOTS.indexOf(root) !== -1
  const isWearable = root === WEARABLE_ROOT

  // R2 陈设·郑重
  if (isDisplay && price >= STATEMENT_MIN) add('housewarming', 'wedding', 'anniversary')

  // R3 可带走·轻礼
  if (price <= LIGHT_GIFT_MAX) add('enrollment', 'graduation', 'new_job')

  // R4 首饰：贴合纪念日，但不进乔迁/新婚
  if (isWearable) add('anniversary')

  // R5 收藏级修正
  if (price >= COLLECTOR_MIN) {
    set.delete('enrollment')
    set.delete('graduation')
    set.delete('new_job')
  }
  if (price >= TOP_TIER_MIN) {
    set.clear()
    add('anniversary') // 收藏级只作为「值得记得的一天」的纪念
  }

  // 固定顺序输出（与 giftScenes.js 一致），便于比对与 diff
  const ORDER = ['housewarming', 'wedding', 'birthday', 'anniversary', 'enrollment', 'graduation', 'new_job', 'gratitude']
  return ORDER.filter((k) => set.has(k))
}

export { proposeScenes, DISPLAY_ROOTS, WEARABLE_ROOT, MIN_SANE_PRICE, LIGHT_GIFT_MAX, STATEMENT_MIN, COLLECTOR_MIN, TOP_TIER_MIN }
