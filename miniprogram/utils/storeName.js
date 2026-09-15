const FALLBACK_STORE_NAME = '门店'

function displayStoreName(storeOrName, fallback) {
  const fallbackName = fallback || FALLBACK_STORE_NAME
  if (storeOrName == null || storeOrName === '') return fallbackName
  if (typeof storeOrName === 'string') {
    const text = storeOrName.trim()
    return text || fallbackName
  }
  const text = String(storeOrName.name || storeOrName.storeName || '').trim()
  return text || fallbackName
}

module.exports = {
  FALLBACK_STORE_NAME,
  displayStoreName
}
