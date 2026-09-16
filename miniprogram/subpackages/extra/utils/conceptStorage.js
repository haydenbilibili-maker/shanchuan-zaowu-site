const { STORAGE_KEY } = require('./productConcept')

const MAX_ITEMS = 80

function loadConcepts() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY)
    return Array.isArray(raw) ? raw : []
  } catch (e) {
    return []
  }
}

function saveConcepts(list) {
  const rows = (Array.isArray(list) ? list : []).slice(0, MAX_ITEMS)
  try {
    wx.setStorageSync(STORAGE_KEY, rows)
  } catch (e) {
    console.warn('conceptStorage save', e)
  }
  return rows
}

function upsertConcept(concept, list) {
  if (!concept || !concept.id) return list || []
  const rows = (list || loadConcepts()).filter((c) => c.id !== concept.id)
  rows.unshift(concept)
  return saveConcepts(rows)
}

function removeConcept(id, list) {
  const rows = (list || loadConcepts()).filter((c) => c.id !== id)
  return saveConcepts(rows)
}

function toggleFavorite(id, list) {
  const rows = (list || loadConcepts()).map((c) =>
    c.id === id ? { ...c, favorite: !c.favorite } : c
  )
  return saveConcepts(rows)
}

module.exports = {
  loadConcepts,
  saveConcepts,
  upsertConcept,
  removeConcept,
  toggleFavorite
}
