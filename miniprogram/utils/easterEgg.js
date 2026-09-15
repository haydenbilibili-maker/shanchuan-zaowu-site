/**
 * 山海经彩蛋：发现、持久化、触发。
 * 云同步预留 getSyncPayload / syncToCloud，不改积分账。
 */
const { STORAGE_KEY, LOCAL_ACHIEVEMENT, EGGS } = require('../config/easterEggs')

const tapBuckets = Object.create(null)
const TAP_GUARD_MS = 700

function normalizeKeyword(s) {
  return String(s || '').trim().toLowerCase()
}

function getEgg(id) {
  return EGGS.find((egg) => egg.id === id) || null
}

function listEggs() {
  return EGGS.slice()
}

function readStore() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY)
    if (raw && typeof raw === 'object') {
      return {
        version: raw.version || 1,
        discovered: raw.discovered && typeof raw.discovered === 'object' ? raw.discovered : {},
        achievement: raw.achievement && typeof raw.achievement === 'object' ? raw.achievement : {}
      }
    }
  } catch (e) {
    console.warn('easterEgg readStore', e)
  }
  return { version: 1, discovered: {}, achievement: {} }
}

function writeStore(store) {
  try {
    wx.setStorageSync(STORAGE_KEY, store)
    return true
  } catch (e) {
    console.warn('easterEgg writeStore', e)
    return false
  }
}

function isDiscovered(id) {
  const store = readStore()
  return !!(store.discovered && store.discovered[id])
}

function listDiscovered() {
  const store = readStore()
  const rows = []
  EGGS.forEach((egg) => {
    const rec = store.discovered[egg.id]
    if (rec) {
      rows.push({
        id: egg.id,
        title: egg.title,
        latin: egg.latin,
        source: egg.source,
        excerpt: egg.excerpt,
        at: rec.at || 0
      })
    }
  })
  rows.sort((a, b) => (b.at || 0) - (a.at || 0))
  return rows
}

function listCatalog() {
  const store = readStore()
  return EGGS.map((egg) => {
    const rec = store.discovered[egg.id]
    const discovered = !!rec
    return {
      id: egg.id,
      discovered,
      at: rec && rec.at ? rec.at : 0,
      title: discovered ? egg.title : '未著录',
      latin: discovered ? egg.latin : '',
      source: discovered ? egg.source : '',
      excerpt: discovered ? egg.excerpt : ''
    }
  })
}

function getProgress() {
  const found = listDiscovered().length
  const total = EGGS.length
  const store = readStore()
  const unlocked = !!(store.achievement && store.achievement[LOCAL_ACHIEVEMENT.id] && store.achievement[LOCAL_ACHIEVEMENT.id].unlocked)
  return {
    found,
    total,
    threshold: LOCAL_ACHIEVEMENT.threshold,
    achievementId: LOCAL_ACHIEVEMENT.id,
    achievementName: LOCAL_ACHIEVEMENT.name,
    achievementUnlocked: unlocked || found >= LOCAL_ACHIEVEMENT.threshold
  }
}

function markAchievementIfNeeded(store, foundCount) {
  const id = LOCAL_ACHIEVEMENT.id
  const current = store.achievement[id] || {}
  if (current.unlocked || foundCount < LOCAL_ACHIEVEMENT.threshold) {
    return { store, justUnlocked: false }
  }
  store.achievement[id] = { unlocked: true, at: Date.now() }
  return { store, justUnlocked: true }
}

function publicEgg(egg) {
  if (!egg) return null
  return {
    id: egg.id,
    title: egg.title,
    latin: egg.latin,
    source: egg.source,
    excerpt: egg.excerpt,
    rewardNote: egg.rewardNote || '收入博物笔记'
  }
}

function resolvePage(page) {
  if (page) return page
  try {
    const pages = getCurrentPages()
    return pages && pages.length ? pages[pages.length - 1] : null
  } catch (e) {
    return null
  }
}

function present(egg, extras = {}) {
  const page = resolvePage(extras.page)
  if (page && typeof page.selectComponent === 'function') {
    const note = page.selectComponent('#easterEggNote')
    if (note && typeof note.show === 'function') {
      note.show(publicEgg(egg), { firstTime: !!extras.firstTime })
      return true
    }
  }
  try {
    wx.showToast({
      title: extras.firstTime ? `拾得 · ${egg.title}` : egg.title,
      icon: 'none',
      duration: 1800
    })
  } catch (e) {
    // ignore
  }
  return false
}

function discover(id, extras = {}) {
  const egg = getEgg(id)
  if (!egg) return null

  const firstTime = !isDiscovered(id)
  let achievementJustUnlocked = false

  if (firstTime) {
    const store = readStore()
    store.discovered[id] = { at: Date.now() }
    const foundCount = Object.keys(store.discovered).length
    const marked = markAchievementIfNeeded(store, foundCount)
    achievementJustUnlocked = marked.justUnlocked
    writeStore(marked.store)
  }

  present(egg, { ...extras, firstTime })

  return {
    egg: publicEgg(egg),
    firstTime,
    achievementJustUnlocked,
    progress: getProgress()
  }
}

function tryTrigger(id, extras = {}) {
  return discover(id, extras)
}

function tryKeyword(keyword, extras = {}) {
  const q = normalizeKeyword(keyword)
  if (!q) return null
  let last = null
  EGGS.forEach((egg) => {
    const triggers = egg.triggers || []
    const hit = triggers.some((t) => {
      if (t.type !== 'secretKeyword' || !Array.isArray(t.keywords)) return false
      return t.keywords.some((k) => q === normalizeKeyword(k) || q.indexOf(normalizeKeyword(k)) >= 0)
    })
    if (hit) last = discover(egg.id, extras)
  })
  return last
}

function tryTapCount(id, extras = {}) {
  const egg = getEgg(id)
  if (!egg) return null
  const trigger = (egg.triggers || []).find((t) => t.type === 'tapCount')
  if (!trigger) return discover(id, extras)

  const categoryName = String(extras.categoryName || '').replace(/馆$/, '')
  if (Array.isArray(trigger.matchCategory) && trigger.matchCategory.length) {
    const matched = trigger.matchCategory.some((k) => categoryName.indexOf(k) >= 0)
    if (!matched) return null
  }

  const now = Date.now()
  const windowMs = trigger.windowMs || 4000
  const need = trigger.count || 5
  let bucket = tapBuckets[id]
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, count: 0 }
  }
  bucket.count += 1
  tapBuckets[id] = bucket
  if (bucket.count < need) return null
  tapBuckets[id] = { start: 0, count: 0 }
  return discover(id, extras)
}

function markTapGuard(page) {
  const target = resolvePage(page)
  if (!target) return
  target._easterEggGuardUntil = Date.now() + TAP_GUARD_MS
}

function shouldIgnoreTap(page) {
  const target = resolvePage(page)
  if (!target) return false
  return Date.now() < (target._easterEggGuardUntil || 0)
}

function getSyncPayload() {
  const store = readStore()
  return {
    version: store.version || 1,
    discovered: store.discovered,
    achievement: store.achievement,
    updatedAt: Date.now()
  }
}

/**
 * 预留：日后云函数 upsertEasterEggs 就绪后再接。
 * 不写入积分、不调用现有成就云函数。
 */
async function syncToCloud() {
  return { skipped: true, reason: 'cloud_sync_not_wired', payload: getSyncPayload() }
}

module.exports = {
  getEgg,
  listEggs,
  isDiscovered,
  listDiscovered,
  listCatalog,
  getProgress,
  discover,
  present,
  tryTrigger,
  tryKeyword,
  tryTapCount,
  markTapGuard,
  shouldIgnoreTap,
  getSyncPayload,
  syncToCloud,
  LOCAL_ACHIEVEMENT
}
