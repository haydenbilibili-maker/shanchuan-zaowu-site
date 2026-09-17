/**
 * 动物伦理 / 来源说明（展示用文案 + 品类判断）
 * 仅昆虫馆 / 海洋馆 / 动物馆等动物相关品类展示；植物、矿石不展示。
 */

const ANIMAL_ETHICS_LABEL = 'ORIGIN · 取材'
const ANIMAL_ETHICS_SUMMARY = '来源可溯，尽量自然。'
const ANIMAL_ETHICS_NOTE =
  '动物类藏品以自然死亡或合法养殖个体为主要来源，具体来源见各藏品说明。'

/** 与 careDefaults 养护大类对齐 */
const ANIMAL_CARE_CATEGORIES = new Set(['INSECTA', 'MARINE', 'ANIMALIA'])

function isAnimalCareCategory(category) {
  return ANIMAL_CARE_CATEGORIES.has(String(category || '').toUpperCase())
}

/**
 * @param {object} product
 * @param {(p: object|string) => string} resolveCareCategory 各分包的 resolveCareCategory
 */
function isAnimalSpecimenProduct(product, resolveCareCategory) {
  if (!product || typeof resolveCareCategory !== 'function') return false
  return isAnimalCareCategory(resolveCareCategory(product))
}

/**
 * @param {Array<object>} items
 * @param {(p: object|string) => string} resolveCareCategory
 */
function orderHasAnimalSpecimen(items, resolveCareCategory) {
  if (!Array.isArray(items) || !items.length) return false
  return items.some((item) => isAnimalSpecimenProduct(item, resolveCareCategory))
}

module.exports = {
  ANIMAL_ETHICS_LABEL,
  ANIMAL_ETHICS_SUMMARY,
  ANIMAL_ETHICS_NOTE,
  ANIMAL_CARE_CATEGORIES,
  isAnimalCareCategory,
  isAnimalSpecimenProduct,
  orderHasAnimalSpecimen
}
