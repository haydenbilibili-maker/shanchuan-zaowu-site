/**
 * manageProductReview —— 藏品「版本审核」快照上架 / 下架（2026-11-25 产品负责人，仅超管）
 *
 * 目的：微信每个新版本审核时，审核员看到的是线上实时在售的商品；运营在开发期陆续上新的商品还没过审。
 * 做法（产品负责人口径，刻意做简单）：
 *   ① 目前已经在架的商品 = 已审核无风险 → 「生成/更新审核白名单」把这批 id 存成一个集合；
 *   ② 提交审核前点「审核下架」：白名单内的保持上架，**其它商品全部下架**（本次被我们下架的记在 reviewOffIds）；
 *   ③ 审核通过后点「审核上架」：把 ② 里下架的那些恢复上架（= 恢复审核前的在架状态）。
 *
 * 额外硬规则（2026-11-25）：首页四个馆（昆虫馆 / 动物馆 / 植物馆 / 海洋馆）**每个馆至少要有 1 件在架商品**；
 * 生成白名单与审核下架都会先算一遍，任一馆为空则拒绝执行并返回空馆名单（避免首页轨道空着）。
 *
 * 集合 product_review_states（doc: main，仅云函数读写）：
 *   { whitelistIds: [], whitelistAt, whitelistBy, reviewOffIds: [], reviewOffAt, status: 'idle' | 'off' }
 *
 * actions: status | buildWhitelist | offShelfForReview | restoreAfterReview
 */
const cloud = require('wx-server-sdk')
const { assertStaff } = require('./staffGuard')
const { writeAuditLog, auditFromActor } = require('./auditLog')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const PRODUCTS = 'products'
const STATES = 'product_review_states'
const DOC_ID = 'main'
const PAGE = 100 // 云函数单次 get 上限
const WRITE_CHUNK = 20

/** 首页四个馆（与 utils/categorySeed.js 的 HOME_ORB_ROOT 同口径） */
const HALLS = ['昆虫馆', '动物馆', '植物馆', '海洋馆']
/** 旧名 / 二级名 → 规范馆名（只收 C 端会写进 product 的那几种） */
const HALL_ALIASES = {
  神奇昆虫: '昆虫馆',
  神奇昆虫馆: '昆虫馆',
  蝴蝶昆虫: '昆虫馆',
  蝴蝶昆虫馆: '昆虫馆',
  昆虫: '昆虫馆',
  昆虫类: '昆虫馆',
  动物类: '动物馆',
  动物世界: '动物馆',
  动物: '动物馆',
  植物探微: '植物馆',
  植物果实: '植物馆',
  植物: '植物馆',
  无尽海洋: '海洋馆',
  海洋标本: '海洋馆',
  海洋: '海洋馆'
}

function hallOf(p) {
  const raw = [p && p.rootCategoryName, p && p.category, p && p.categoryName]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
  for (const s of raw) {
    if (HALLS.includes(s)) return s
    if (HALL_ALIASES[s]) return HALL_ALIASES[s]
    const withHall = `${s}馆`
    if (HALLS.includes(withHall)) return withHall
  }
  return ''
}

function fail(msg, extra) {
  return { success: false, msg, ...(extra || {}) }
}

/** 分页拉全库（只取判定需要的字段） */
async function fetchAllProducts() {
  const out = []
  let skip = 0
  for (;;) {
    const res = await db.collection(PRODUCTS)
      .field({ _id: true, isOffShelf: true, shelfReviewHidden: true, rootCategoryName: true, category: true, categoryName: true, title: true })
      .skip(skip)
      .limit(PAGE)
      .get()
    const batch = (res.data || [])
    out.push(...batch)
    if (batch.length < PAGE) break
    skip += PAGE
    if (skip > 20000) break
  }
  return out
}

function countHalls(products) {
  const map = { 昆虫馆: 0, 动物馆: 0, 植物馆: 0, 海洋馆: 0, '': 0 }
  for (const p of products) {
    const h = hallOf(p)
    map[h] = (map[h] || 0) + 1
  }
  return map
}

function emptyHallsOf(map) {
  return HALLS.filter((h) => !map[h])
}

async function readState() {
  try {
    const res = await db.collection(STATES).doc(DOC_ID).get()
    return (res && res.data) || null
  } catch (e) {
    return null // 集合或 doc 不存在
  }
}

async function ensureCollection() {
  try {
    await db.createCollection(STATES)
  } catch (e) {
    // 已存在（-501001 / already exists）忽略
  }
}

async function writeState(patch) {
  await ensureCollection()
  const now = db.serverDate()
  const base = { updateTime: now }
  let updated = 0
  try {
    // ⚠️ 云库 update 一个不存在的 doc 不报错，只返回 stats.updated = 0 —— 必须据此补 set，
    // 否则第一次生成白名单会「成功但什么都没写」（本守卫 R1 就是抓这个）
    const r = await db.collection(STATES).doc(DOC_ID).update({ data: { ...patch, ...base } })
    updated = (r && r.stats && r.stats.updated) || 0
  } catch (e) {
    updated = 0
  }
  if (!updated) {
    const cur = (await readState()) || {}
    await db.collection(STATES).doc(DOC_ID).set({
      data: {
        whitelistIds: cur.whitelistIds || [],
        whitelistAt: cur.whitelistAt || null,
        whitelistBy: cur.whitelistBy || '',
        reviewOffIds: cur.reviewOffIds || [],
        reviewOffAt: cur.reviewOffAt || null,
        status: cur.status || 'idle',
        createTime: cur.createTime || now,
        ...patch,
        ...base
      }
    })
  }
}

/** 批量写：每批 20，逐件记失败（不因个别失败整单回滚，返回失败 id 供页面重试） */
async function bulkShelf(ids, onShelf) {
  const failed = []
  for (let i = 0; i < ids.length; i += WRITE_CHUNK) {
    const chunk = ids.slice(i, i + WRITE_CHUNK)
    const r = await Promise.all(chunk.map((id) => db.collection(PRODUCTS).doc(id)
      .update({
        data: onShelf
          ? { isOffShelf: false, shelfReviewHidden: false, shelfUpdatedAt: db.serverDate() }
          : { isOffShelf: true, shelfReviewHidden: true, shelfUpdatedAt: db.serverDate() }
      })
      .then(() => null)
      .catch(() => id)))
    r.forEach((x) => { if (x) failed.push(x) })
  }
  return failed
}

async function status() {
  const state = await readState()
  const products = await fetchAllProducts()
  const onProducts = products.filter((p) => p.isOffShelf !== true)
  const whitelistIds = (state && state.whitelistIds) || []
  const byId = new Map(products.map((p) => [p._id, p]))
  const whitelistAlive = whitelistIds.filter((id) => byId.has(id))
  const whitelistOn = whitelistAlive.filter((id) => byId.get(id).isOffShelf !== true)
  const hallOn = countHalls(onProducts)
  const hallWhite = countHalls(whitelistAlive.map((id) => byId.get(id)))
  return {
    success: true,
    status: (state && state.status) || 'idle',
    whitelistCount: whitelistIds.length,
    whitelistAliveCount: whitelistAlive.length,
    whitelistAt: (state && state.whitelistAt) || null,
    reviewOffCount: ((state && state.reviewOffIds) || []).length,
    reviewOffAt: (state && state.reviewOffAt) || null,
    counts: { total: products.length, on: onProducts.length, off: products.length - onProducts.length, whitelistOn: whitelistOn.length },
    halls: HALLS.map((h) => ({ name: h, on: hallOn[h] || 0, whitelist: hallWhite[h] || 0 })),
    emptyHalls: emptyHallsOf(hallOn),
    whitelistEmptyHalls: emptyHallsOf(hallWhite)
  }
}

/** ① 生成 / 更新审核白名单 = 当前在架集合（要求四个馆都有货） */
async function buildWhitelist(actor) {
  const products = await fetchAllProducts()
  const onProducts = products.filter((p) => p.isOffShelf !== true)
  const hallOn = countHalls(onProducts)
  const emptyHalls = emptyHallsOf(hallOn)
  if (emptyHalls.length) {
    return fail(`这四个馆里有馆没有在架商品：${emptyHalls.join('、')}。请先给这些馆上架至少 1 件，再生成审核白名单。`, {
      code: 'HALL_EMPTY',
      emptyHalls
    })
  }
  const ids = onProducts.map((p) => p._id)
  await writeState({
    whitelistIds: ids,
    whitelistAt: db.serverDate(),
    whitelistBy: actor.openid || '',
    // 重新生成白名单时，若正处在审核中，保留 reviewOffIds（不影响恢复）
    status: ((await readState()) || {}).status || 'idle'
  })
  await writeAuditLog(db, auditFromActor(actor, {
    action: 'product_review_whitelist_build',
    relatedId: DOC_ID,
    relatedType: STATES,
    detail: { count: ids.length, halls: hallOn },
    source: 'manageProductReview'
  }))
  return { success: true, whitelistCount: ids.length, halls: HALLS.map((h) => ({ name: h, on: hallOn[h] || 0 })) }
}

/** ② 审核下架：白名单保持上架，其余全部下架 */
async function offShelfForReview(actor) {
  const state = await readState()
  const whitelistIds = (state && state.whitelistIds) || []
  if (!whitelistIds.length) {
    return fail('还没有审核白名单：请先点「生成审核白名单」（把当前在架商品记为已审核）。', { code: 'NO_WHITELIST' })
  }
  if (state && state.status === 'off') {
    return fail('当前已处于审核下架状态；如需重新执行，请先「审核上架」恢复。', {
      code: 'ALREADY_OFF',
      reviewOffCount: (state.reviewOffIds || []).length
    })
  }
  const products = await fetchAllProducts()
  const byId = new Map(products.map((p) => [p._id, p]))
  const whitelistAlive = whitelistIds.filter((id) => byId.has(id))
  const hallWhite = countHalls(whitelistAlive.map((id) => byId.get(id)))
  const emptyHalls = emptyHallsOf(hallWhite)
  if (emptyHalls.length) {
    return fail(`审核期白名单里这四个馆没有货：${emptyHalls.join('、')}。请先补充这些馆的在架商品并重新生成白名单。`, {
      code: 'HALL_EMPTY',
      emptyHalls
    })
  }
  const whiteSet = new Set(whitelistAlive)
  const onProducts = products.filter((p) => p.isOffShelf !== true)
  const toOff = onProducts.filter((p) => !whiteSet.has(p._id)).map((p) => p._id)
  const failed = await bulkShelf(toOff, false)
  const offDone = toOff.filter((id) => !failed.includes(id))
  await writeState({
    status: 'off',
    reviewOffIds: offDone,
    reviewOffAt: db.serverDate()
  })
  await writeAuditLog(db, auditFromActor(actor, {
    action: 'product_review_off',
    relatedId: DOC_ID,
    relatedType: STATES,
    detail: { whitelist: whitelistAlive.length, offCount: offDone.length, failed: failed.length },
    source: 'manageProductReview'
  }))
  return {
    success: true,
    whitelistCount: whitelistAlive.length,
    offCount: offDone.length,
    failed,
    halls: HALLS.map((h) => ({ name: h, on: hallWhite[h] || 0 })),
    partial: failed.length > 0
  }
}

/** ③ 审核上架：只把上次审核下架的那些恢复上架（审核前就已下架的不动） */
async function restoreAfterReview(actor) {
  const state = await readState()
  if (!state || state.status !== 'off') {
    return fail('当前不在审核下架状态，无需恢复。', { code: 'NOT_OFF' })
  }
  const products = await fetchAllProducts()
  const byId = new Map(products.map((p) => [p._id, p]))
  const candidates = (state.reviewOffIds || []).filter((id) => {
    const p = byId.get(id)
    return p && (p.shelfReviewHidden === true || p.isOffShelf === true)
  })
  const failed = await bulkShelf(candidates, true)
  const ok = candidates.filter((id) => !failed.includes(id))
  await writeState({
    status: 'idle',
    reviewOffIds: failed,
    reviewOffAt: failed.length ? db.serverDate() : null
  })
  await writeAuditLog(db, auditFromActor(actor, {
    action: 'product_review_on',
    relatedId: DOC_ID,
    relatedType: STATES,
    detail: { restored: ok.length, failed: failed.length },
    source: 'manageProductReview'
  }))
  return { success: true, restored: ok.length, failed, partial: failed.length > 0 }
}

exports.main = async (event) => {
  const action = String((event && event.action) || 'status').trim()
  const { openid } = cloud.getWXContext()
  const guard = await assertStaff(db, openid, { requireSuperAdmin: true })
  if (!guard.ok) return fail(guard.msg || '仅超管可操作版本审核', { code: guard.code || 'forbidden' })
  const actor = { openid, ...(guard.actor || {}) }
  try {
    switch (action) {
      case 'status': return await status()
      case 'buildWhitelist': return await buildWhitelist(actor)
      case 'offShelfForReview': return await offShelfForReview(actor)
      case 'restoreAfterReview': return await restoreAfterReview(actor)
      default: return fail('未知动作：' + action, { code: 'BAD_ACTION' })
    }
  } catch (e) {
    return fail(e.message || '执行失败', { code: 'INTERNAL' })
  }
}
