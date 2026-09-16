/**
 * 山海经彩蛋：发现、持久化、触发。
 * 云同步预留 getSyncPayload / syncToCloud，不改积分账。
 *
 * 触发类型（`config/easterEggs.js` 的 triggers[].type）：
 *   - `longPress` / `secretKeyword` / `tapCount`：**用户主动**动作，已拾得的彩蛋可反复重看；
 *   - `pageEnter` / `wishPosted` / `lampStreak` / `wishCount`：**页面自动**触发。
 *     自动触发必须"只弹一次" —— 否则每次进同一页都会弹窗，
 *     彩蛋就从惊喜变成骚扰。故自动类型走 `skipIfDiscovered`（见 discover）。
 *
 * 后两类是**带门槛**的自动触发：`lampStreak` 需要连续点灯天数够（`minStreak`），
 * `wishCount` 需要我的心愿条数够（`minCount`）。门槛写在注册表里；
 * 页面只负责报事实（`tryLampStreak({ streak })`），调门槛不必改页面。
 */
const { STORAGE_KEY, LOCAL_ACHIEVEMENT, EGGS } = require('../config/easterEggs')

const tapBuckets = Object.create(null)
const TAP_GUARD_MS = 700

/** 自动触发类型：命中后若已拾得则不再弹出 */
const AUTO_TRIGGER_TYPES = ['pageEnter', 'wishPosted', 'lampStreak', 'wishCount']
const PAGE_ENTER = 'pageEnter'
const WISH_POSTED = 'wishPosted'
const LAMP_STREAK = 'lampStreak'
const WISH_COUNT = 'wishCount'

function normalizeKeyword(s) {
  return String(s || '').trim().toLowerCase()
}

function getEgg(id) {
  return EGGS.find((egg) => egg.id === id) || null
}

function listEggs() {
  return EGGS.slice()
}

/**
 * 当前页面路由（`pageEnter` 类触发靠它匹配）。
 * 组件/behavior 里 `this.route` 可能取不到，故回落到 getCurrentPages() 栈顶。
 */
function currentRoute(page) {
  const target = resolvePage(page)
  if (target && target.route) return String(target.route)
  try {
    const pages = getCurrentPages()
    const last = pages && pages.length ? pages[pages.length - 1] : null
    return (last && last.route) || ''
  } catch (e) {
    return ''
  }
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
  // 自动触发（进页/首次许愿）只弹一次；用户主动触发（长按/关键词/连点）允许重看
  if (!firstTime && extras.skipIfDiscovered) return null

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

/**
 * 单条 trigger 是否命中当前上下文。
 *
 * 除了"类型 + 路由"，部分类型还带**门槛条件**（连续天数 / 条数）。
 * 条件放在注册表里而不是页面里：页面只报"我现在连续 5 天"，
 * 具体几天算彩蛋由注册表定 —— 调门槛不用改页面。
 *
 * @param {{type?:string,pages?:string[],minStreak?:number,minCount?:number}} trigger
 * @param {{type?:string,route?:string,streak?:number,wishCount?:number}} ctx
 */
function triggerMatches(trigger, ctx) {
  const t = trigger || {}
  const c = ctx || {}
  if (c.type && t.type !== c.type) return false
  if (Array.isArray(t.pages) && t.pages.length) {
    if (t.pages.indexOf(String(c.route || '')) === -1) return false
  }
  if (t.type === LAMP_STREAK) {
    const need = Number(t.minStreak) || 3
    if (!(Number(c.streak) >= need)) return false
  }
  if (t.type === WISH_COUNT) {
    const need = Number(t.minCount) || 3
    if (!(Number(c.wishCount) >= need)) return false
  }
  return true
}

/**
 * 按**触发类型**批量判定（彩蛋注册表驱动，页面只报事件、不认 egg id）。
 *
 * 「全站拓展」就靠这里：新页面接彩蛋 = 在注册表里加一条 trigger，
 * 页面侧只需 `tryPageEnter({ page: this })` 一行，不必改 easterEgg.js。
 *
 * @param {string} type 见 AUTO_TRIGGER_TYPES
 * @param {object} [extras] 透传给 present/discover，如 { page, source }
 * @returns {object|null} 最后一个被触发的记录
 */
function tryTriggerType(type, extras = {}) {
  const ctx = {
    type: String(type || ''),
    route: extras.route || currentRoute(extras.page),
    // 门槛条件的当前值：页面报事实，门槛由注册表定
    streak: extras.streak,
    wishCount: extras.wishCount
  }
  const skipIfDiscovered = AUTO_TRIGGER_TYPES.indexOf(ctx.type) !== -1
  let last = null
  EGGS.forEach((egg) => {
    const hit = (egg.triggers || []).some((t) => triggerMatches(t, ctx))
    if (!hit) return
    const res = discover(egg.id, { ...extras, triggerType: ctx.type, skipIfDiscovered })
    if (res) last = res
  })
  return last
}

/** 进入页面时判定（自动触发，已拾得的不再重复弹出） */
function tryPageEnter(extras = {}) {
  return tryTriggerType(PAGE_ENTER, extras)
}

/** 首次/每次成功许愿后判定（自动触发，已拾得的不再重复弹出） */
function tryWishPosted(extras = {}) {
  return tryTriggerType(WISH_POSTED, extras)
}

/**
 * 连续点灯判定。
 * @param {{streak:number, page?:object, source?:string}} extras `streak` = 今日连续天数
 */
function tryLampStreak(extras = {}) {
  return tryTriggerType(LAMP_STREAK, extras)
}

/**
 * 我的心愿条数判定（`wishCount` = 我在本面墙的心愿总数，含被收起的）。
 */
function tryWishCount(extras = {}) {
  return tryTriggerType(WISH_COUNT, extras)
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
  tryTriggerType,
  tryPageEnter,
  tryWishPosted,
  tryLampStreak,
  tryWishCount,
  triggerMatches,
  currentRoute,
  markTapGuard,
  shouldIgnoreTap,
  getSyncPayload,
  syncToCloud,
  LOCAL_ACHIEVEMENT,
  AUTO_TRIGGER_TYPES,
  PAGE_ENTER,
  WISH_POSTED,
  LAMP_STREAK,
  WISH_COUNT
}
