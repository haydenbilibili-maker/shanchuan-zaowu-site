/**
 * 商品写入代理 — products 集合 write:false 后唯一店长/Admin 写入口
 *
 * action:
 *   list              分页列表 { page, pageSize, keyword, archiveFilter, promoFilter, sortBy, giftScene }
 *                     sortBy: new | sales | price_asc | price_desc（默认 new；与 C 端 ProductList 语义对齐）
 *                     giftScene: 可选，按 products.giftScenes 含该 key 过滤
 *   upsert            新建 / 更新商品（更新时剥离 isOffShelf；上架走 manageApprovals）
 *   patch             单条字段补丁（白名单，不含 isOffShelf）
 *   batchPatch        批量补丁 { items: [{ productId, data }] }
 *   clearExpiredSeckill 清理过期秒杀 { productIds: [] }
 *   remove            删除商品（仅超管）
 *   stats             藏品库统计聚合 { trendDays: 7|30 }
 *                     含预估积压货款 cost（costPrice×stock；trendDays 仅影响近期成本占比）
 *   backfillMineLinks 标本师 —— 为本人 openid / 装裱师姓名字段补写 framerId（不覆盖他人 framerId）
 *   backfillTags      超管：存量商品补 tags（空/缺失才写，不覆盖已有）
 *
 * 鉴权：店长(staff) 或 Admin Web adminOpsKey
 */
const cloud = require('wx-server-sdk')
const {
  assertStaff,
  ROLE_STAFF,
  WORKSPACE_SPECIMEN_ARTISAN,
  WORKSPACE_SUPER_ADMIN
} = require('./staffGuard')
const { writeAuditLog, auditFromActor } = require('./auditLog')
const {
  buildKeywordCondition,
  rankByKeyword,
  PRODUCT_FIELDS
} = require('./fuzzySearch')
const { sanitizeProductTags, readProductTags } = require('./productTags')
const { sanitizeGiftScenes, readGiftScenes } = require('./giftScenes')
const { backfillProductTags } = require('./backfillTags')
const {
  normalizeChannel,
  normalizeCraftType,
  normalizeCraftProcess
} = require('./productTaxonomy')
const { resolveSensitiveBlurForSave } = require('./sensitiveMorphology')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const ALLOWED_FIELDS = [
  'title', 'latinName', 'price', 'costPrice', 'stock', 'hasSku', 'skus', 'skuDimensions',
  'category', 'categoryId', 'categoryType', 'rootCategoryName', 'rootCategoryId',
  'channel', 'craftType', 'craftProcess', 'framerName', 'framerId', 'origin', 'description', 'detailHtml',
  'detailImages', 'collectDate', 'size', 'sizeL', 'sizeW', 'sizeH', 'isTreasure', 'isOneOfAKind', 'inArchive',
  'memberDiscountEnabled', 'supportsCustom', 'giftEligible', 'depositEligible', 'protectionType', 'collectionCertificate',
  'taxonomy', 'images', 'seckill', 'groupBuying', 'updateTime', 'createTime',
  'experienceStores', 'tags', 'giftScenes', 'coverImage', 'sort',
  'sensitiveBlur', 'sensitiveBlurSetByUser',
  // 「珍稀」角标：商品级人工打标（勿与 manageAtlas 的物种 rarity 混用）
  'productRarity', 'productRaritySetByUser',
  // 需求 28：祈福墙的两件套（全站拓展的开关）。
  // ⚠️ 这个白名单是**静默**的：没登记 = 保存时字段被丢掉、界面还提示"已保存"。
  // 所以每加一个商品级字段，这里与小程序藏品表单必须同时改（守卫有结构断言）。
  'wishWallEnabled', 'wishWallKey'
]

const PATCH_FIELDS = ALLOWED_FIELDS.filter((k) => k !== 'createTime')

function fail(msg, code) {
  return { success: false, msg, code: code || 'FAIL' }
}

function pickFields(obj, allowed) {
  const out = {}
  if (!obj || typeof obj !== 'object') return out
  allowed.forEach((k) => {
    if (obj[k] !== undefined) out[k] = obj[k]
  })
  return out
}

function finiteNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** 去掉 undefined / NaN，避免云库 update 抛错；规范多规格 SKU 结构 */
function sanitizeForDb(value) {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForDb(item)).filter((item) => item !== undefined)
  }
  const out = {}
  Object.keys(value).forEach((key) => {
    const next = sanitizeForDb(value[key])
    if (next !== undefined) out[key] = next
  })
  return out
}

function parseSkuSizeParts(sizeStr) {
  let sizeL = ''
  let sizeW = ''
  let sizeH = ''
  const raw = String(sizeStr || '').trim()
  if (!raw) return { sizeL, sizeW, sizeH }
  const clean = raw
    .replace(/厘米/gi, '')
    .replace(/cm/gi, '')
    .replace(/直径/g, '')
    .replace(/高度/g, '')
    .replace(/厚度/g, '')
    .trim()
  const parts = clean.split(/[xX×✕✖*]/).map((p) => String(p || '').trim()).filter(Boolean)
  if (parts.length === 1) {
    sizeL = parts[0].slice(0, 16)
  } else if (parts.length >= 2) {
    sizeL = String(parts[0] || '').trim().slice(0, 16)
    sizeW = String(parts[1] || '').trim().slice(0, 16)
    if (parts.length >= 3) sizeH = String(parts[2] || '').trim().slice(0, 16)
  }
  return { sizeL, sizeW, sizeH }
}

function normalizeSkuSizeFields(s) {
  const sizeText = String(s.sizeText || '').trim().slice(0, 120)
  let sizeL = String(s.sizeL != null ? s.sizeL : '').trim().slice(0, 16)
  let sizeW = String(s.sizeW != null ? s.sizeW : '').trim().slice(0, 16)
  let sizeH = String(s.sizeH != null ? s.sizeH : '').trim().slice(0, 16)
  let size = String(s.size || '').trim().slice(0, 64)
  if (!sizeL && !sizeW && !sizeH && size) {
    const parsed = parseSkuSizeParts(size)
    sizeL = parsed.sizeL
    sizeW = parsed.sizeW
    sizeH = parsed.sizeH
  }
  if (!size && (sizeL || sizeW || sizeH)) {
    const parts = []
    if (sizeL) parts.push(sizeL)
    if (sizeW) parts.push(sizeW)
    if (sizeH) parts.push(sizeH)
    if (parts.length) size = `${parts.join('x')} cm`
  }
  const sizeNorm = String(size || '')
    .replace(/\s+/g, '')
    .replace(/[×✕✖*]/g, 'x')
    .replace(/厘米/gi, '')
    .replace(/cm$/i, '')
  if (/^(0+(?:\.0+)?)(?:x(?:0+(?:\.0+)?))+$/i.test(sizeNorm)) {
    size = ''
  }
  return { sizeL, sizeW, sizeH, sizeText, size }
}

function normalizeSkus(rawSkus) {
  if (!Array.isArray(rawSkus)) return []
  return rawSkus.slice(0, 50).map((s, i) => {
    if (!s || typeof s !== 'object') return null
    const images = Array.isArray(s.images)
      ? s.images.map((img) => String(img || '').trim()).filter(Boolean).slice(0, 9)
      : (s.image ? [String(s.image).trim()].filter(Boolean) : [])
    const specs =
      s.specs && typeof s.specs === 'object' && !Array.isArray(s.specs)
        ? sanitizeForDb(s.specs)
        : {}
    const sizeFields = normalizeSkuSizeFields(s)
    return {
      id: String(s.id || `sku_${Date.now()}_${i}`).slice(0, 64),
      specLabel: String(s.specLabel || '').trim().slice(0, 120),
      sku: String(s.sku || s.skuCode || '').trim().slice(0, 64),
      specs,
      price: Math.max(0, finiteNumber(s.price, 0)),
      stock: Math.max(0, Math.floor(finiteNumber(s.stock, 0))),
      image: images[0] || '',
      images,
      sizeL: sizeFields.sizeL,
      sizeW: sizeFields.sizeW,
      sizeH: sizeFields.sizeH,
      sizeText: sizeFields.sizeText,
      size: sizeFields.size
    }
  }).filter((s) => s && s.specLabel)
}

function prepareProductData(raw) {
  const data = pickFields(raw, ALLOWED_FIELDS)
  // 兼容录入别名 contentWarning → sensitiveBlur
  if (
    !Object.prototype.hasOwnProperty.call(data, 'sensitiveBlur') &&
    raw &&
    Object.prototype.hasOwnProperty.call(raw, 'contentWarning')
  ) {
    data.sensitiveBlur = !!raw.contentWarning
  }
  if (Object.prototype.hasOwnProperty.call(data, 'sensitiveBlur')) {
    data.sensitiveBlur = !!data.sensitiveBlur
  }
  if (Object.prototype.hasOwnProperty.call(data, 'sensitiveBlurSetByUser')) {
    data.sensitiveBlurSetByUser = !!data.sensitiveBlurSetByUser
  }
  if (Object.prototype.hasOwnProperty.call(data, 'hasSku')) {
    data.hasSku = !!data.hasSku
  }
  if (Object.prototype.hasOwnProperty.call(data, 'skus') || data.hasSku) {
    const skus = normalizeSkus(data.skus)
    data.hasSku = skus.length > 0
    data.skus = data.hasSku ? skus : []
    if (!data.hasSku) {
      data.skuDimensions = []
    } else if (Array.isArray(data.skuDimensions)) {
      data.skuDimensions = data.skuDimensions
        .map((d) => String(d || '').trim())
        .filter(Boolean)
        .slice(0, 8)
    } else {
      data.skuDimensions = []
    }
    if (data.hasSku) {
      const prices = skus.map((s) => s.price).filter((n) => n > 0)
      if (prices.length) data.price = Math.min(...prices)
      data.stock = skus.reduce((sum, s) => sum + s.stock, 0)
      if ((!Array.isArray(data.images) || !data.images.length) && skus[0].images[0]) {
        data.images = [skus[0].images[0]]
      }
    }
  }
  if (typeof data.price === 'number') data.price = Math.max(0, finiteNumber(data.price, 0))
  if (typeof data.costPrice === 'number') data.costPrice = Math.max(0, finiteNumber(data.costPrice, 0))
  if (typeof data.stock === 'number') data.stock = Math.max(0, Math.floor(finiteNumber(data.stock, 0)))
  if (Object.prototype.hasOwnProperty.call(data, 'tags')) {
    data.tags = sanitizeProductTags(data.tags)
    if (!data.tags.length) {
      data.tags = readProductTags(raw)
    }
  }
  if (Object.prototype.hasOwnProperty.call(data, 'giftScenes')) {
    data.giftScenes = sanitizeGiftScenes(data.giftScenes)
  }
  if (Object.prototype.hasOwnProperty.call(data, 'latinName')) {
    const latin = String(data.latinName == null ? '' : data.latinName).trim()
    data.latinName = /^(n\/?a|n\.a\.?|null|undefined|none|nil|unknown|-|—|–|暂无|无|未知)$/i.test(latin)
      ? ''
      : latin
  }
  if (Object.prototype.hasOwnProperty.call(data, 'channel')) {
    data.channel = normalizeChannel(data.channel) || ''
  }
  if (Object.prototype.hasOwnProperty.call(data, 'craftType')) {
    data.craftType = normalizeCraftType(data.craftType) || ''
  }
  if (Object.prototype.hasOwnProperty.call(data, 'craftProcess')) {
    data.craftProcess = normalizeCraftProcess(data.craftProcess) || ''
  }
  return sanitizeForDb(data)
}

/**
 * 蛇/两栖等：新建默认开敏感模糊；编辑仅在库内未设时默认开；尊重 sensitiveBlurSetByUser
 */
function applySensitiveBlurDefaults(data, raw, existing, isCreate) {
  const resolved = resolveSensitiveBlurForSave(
    Object.assign({}, raw || {}, data || {}),
    { isCreate: !!isCreate, existing: existing || null }
  )
  data.sensitiveBlur = resolved.sensitiveBlur
  data.sensitiveBlurSetByUser = resolved.sensitiveBlurSetByUser
  return data
}

async function requireManager(openid, adminOpsKey) {
  const guard = await assertStaff(db, openid, { role: ROLE_STAFF, permission: 'manageProducts', adminOpsKey })
  if (!guard.ok) return { ok: false, code: guard.code, msg: guard.msg }
  return { ok: true, actor: { ...guard.actor, openid } }
}

async function findFramerIdForStaffOpenid(staffOpenid) {
  if (!staffOpenid) return ''
  try {
    const res = await db.collection('framers').where({ staffOpenid }).limit(1).get()
    const row = res.data && res.data[0]
    return row && row._id ? String(row._id) : ''
  } catch (e) {
    return ''
  }
}

async function findFramerRowForStaffOpenid(staffOpenid) {
  if (!staffOpenid) return null
  try {
    const res = await db.collection('framers').where({ staffOpenid }).limit(1).get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    return null
  }
}

/** mineOnly 列表：以服务端 staffOpenid 为准；客户端 framerId 须与 framers.staffOpenid 一致才采纳 */
async function resolveVerifiedArtisanFramerId(actor, clientFramerId) {
  const openid = actor && actor.openid ? String(actor.openid) : ''
  if (!openid) return ''
  let serverId = await findFramerIdForStaffOpenid(openid)
  const clientId = String(clientFramerId || '').trim()
  if (!clientId) return serverId
  if (serverId && clientId === serverId) return serverId
  try {
    const doc = await db.collection('framers').doc(clientId).get()
    const row = doc.data
    if (row && String(row.staffOpenid || '') === openid) {
      return clientId
    }
  } catch (e) {
    /* ignore */
  }
  return serverId
}

const PRODUCT_MAKER_FIELD_KEYS = ['framerName', 'framer', 'artisan', 'maker', 'artistName']

function normalizeMakerToken(s) {
  return String(s || '').trim().replace(/\s+/g, ' ')
}

function productMakerNamesMatch(row, framerDisplayName) {
  const target = normalizeMakerToken(framerDisplayName)
  if (!target || target.length < 2) return false
  if (target.toUpperCase() === 'NATURE') return false
  for (let i = 0; i < PRODUCT_MAKER_FIELD_KEYS.length; i += 1) {
    const key = PRODUCT_MAKER_FIELD_KEYS[i]
    const val = normalizeMakerToken(row && row[key])
    if (val && val === target) return true
  }
  return false
}

function productNeedsFramerLink(row, framerId) {
  if (!row || !framerId) return false
  const existing = String(row.framerId || '').trim()
  if (!existing) return true
  return existing === framerId
}

async function applyArtisanOwnershipFields(data, actor, existingRow) {
  if (!actor || actor.workspaceRole !== WORKSPACE_SPECIMEN_ARTISAN || !actor.openid) return
  const framerId = await findFramerIdForStaffOpenid(actor.openid)
  if (framerId) {
    data.framerId = framerId
    if (!data.framerName && actor.name) data.framerName = actor.name
  }
  if (!existingRow || !existingRow.createdByOpenid) {
    data.createdByOpenid = actor.openid
  }
}

function isFullProductEditor(actor) {
  if (!actor) return false
  if (actor.superAdmin || actor.workspaceRole === WORKSPACE_SUPER_ADMIN) return true
  if (actor.workspaceRole === 'store_manager') return true
  return false
}

async function assertCanEditProduct(productId, actor) {
  if (!productId) return { ok: true }
  if (isFullProductEditor(actor)) return { ok: true }
  if (actor.workspaceRole !== WORKSPACE_SPECIMEN_ARTISAN) {
    return { ok: false, msg: '无操作权限', code: 'FORBIDDEN' }
  }
  try {
    const doc = await db.collection('products').doc(productId).get()
    const row = doc.data
    if (!row) return { ok: false, msg: '商品不存在', code: 'NOT_FOUND' }
    const openid = actor.openid || ''
    if (row.createdByOpenid && row.createdByOpenid === openid) return { ok: true }
    const framerId = await findFramerIdForStaffOpenid(openid)
    if (framerId && row.framerId === framerId) return { ok: true }
    return { ok: false, msg: '只能编辑自己的作品', code: 'FORBIDDEN' }
  } catch (e) {
    return { ok: false, msg: e.message || '校验失败', code: 'FAIL' }
  }
}

async function upsert(event, actor) {
  const productId = String((event && event.productId) || '').trim()
  const raw = (event && event.data) || {}
  const data = prepareProductData(raw)
  if (!data.title && !productId) return fail('缺少商品标题')
  if (data.hasSku && (!Array.isArray(data.skus) || !data.skus.length)) {
    return fail('多规格商品至少需要一条有效规格')
  }
  if (data.hasSku) {
    const missingImg = data.skus.find((s) => !s.images || !s.images.length)
    if (missingImg) return fail(`规格「${missingImg.specLabel}」至少需要 1 张图`)
  }

  data.updateTime = data.updateTime || Date.now()

  if (productId) {
    const own = await assertCanEditProduct(productId, actor)
    if (!own.ok) return fail(own.msg, own.code)
    let existingRow = null
    try {
      const doc = await db.collection('products').doc(productId).get()
      existingRow = doc.data || null
    } catch (e) {
      existingRow = null
    }
    applySensitiveBlurDefaults(data, raw, existingRow, false)
    await applyArtisanOwnershipFields(data, actor, existingRow)
    // 上下架仅 manageApprovals；保存时禁止改 isOffShelf
    delete data.isOffShelf
    delete data.createTime
    await db.collection('products').doc(productId).update({ data })
    await writeAuditLog(db, auditFromActor(actor, {
      action: 'product_upsert',
      relatedId: productId,
      relatedType: 'products',
      detail: {
        mode: 'update',
        title: data.title || '',
        hasSku: !!data.hasSku,
        skuCount: Array.isArray(data.skus) ? data.skus.length : 0,
        sensitiveBlur: !!data.sensitiveBlur
      },
      source: 'manageProducts'
    })).catch(() => {})
    return { success: true, productId, mode: 'update', hasSku: !!data.hasSku }
  }

  // 新建：默认下架；仅超管/Admin Web 可显式指定上架
  applySensitiveBlurDefaults(data, raw, null, true)
  const isSuper = !!(actor && (actor.superAdmin || actor.workspaceRole === 'super_admin'))
  if (isSuper && raw.isOffShelf === false) {
    data.isOffShelf = false
  } else {
    data.isOffShelf = true
  }
  data.createTime = data.createTime || db.serverDate()
  if (actor && actor.openid) {
    data.createdByOpenid = actor.openid
  }
  await applyArtisanOwnershipFields(data, actor, null)
  const addRes = await db.collection('products').add({ data })
  const newId = addRes._id
  await writeAuditLog(db, auditFromActor(actor, {
    action: 'product_upsert',
    relatedId: newId,
    relatedType: 'products',
    detail: {
      mode: 'create',
      title: data.title || '',
      isOffShelf: data.isOffShelf,
      sensitiveBlur: !!data.sensitiveBlur
    },
    source: 'manageProducts'
  })).catch(() => {})
  return { success: true, productId: newId, mode: 'create', isOffShelf: data.isOffShelf }
}

async function patch(event, actor) {
  const productId = String((event && event.productId) || '').trim()
  if (!productId) return fail('缺少 productId')
  const own = await assertCanEditProduct(productId, actor)
  if (!own.ok) return fail(own.msg, own.code)
  const data = prepareProductData(pickFields((event && event.data) || {}, PATCH_FIELDS))
  delete data.isOffShelf
  delete data.createTime
  if (!Object.keys(data).length) return fail('无有效字段')
  data.updateTime = data.updateTime || Date.now()
  await db.collection('products').doc(productId).update({ data })
  await writeAuditLog(db, auditFromActor(actor, {
    action: 'product_patch',
    relatedId: productId,
    relatedType: 'products',
    detail: { keys: Object.keys(data) },
    source: 'manageProducts'
  })).catch(() => {})
  return { success: true, productId }
}

async function batchPatch(event, actor) {
  const items = Array.isArray(event && event.items) ? event.items : []
  if (!items.length) return fail('缺少 items')
  if (items.length > 100) return fail('单次最多 100 条')

  let ok = 0
  const errors = []
  for (const item of items) {
    const productId = String((item && item.productId) || (item && item._id) || '').trim()
    if (!productId) {
      errors.push({ productId: '', msg: '缺少 id' })
      continue
    }
    try {
      const data = prepareProductData(pickFields((item && item.data) || {}, PATCH_FIELDS))
      delete data.isOffShelf
      delete data.createTime
      if (!Object.keys(data).length) {
        errors.push({ productId, msg: '无有效字段' })
        continue
      }
      data.updateTime = data.updateTime || Date.now()
      await db.collection('products').doc(productId).update({ data })
      ok += 1
    } catch (e) {
      errors.push({ productId, msg: (e && e.message) || '失败' })
    }
  }

  await writeAuditLog(db, auditFromActor(actor, {
    action: 'product_batch_patch',
    relatedId: '',
    relatedType: 'products',
    detail: { ok, fail: errors.length, total: items.length },
    source: 'manageProducts'
  })).catch(() => {})

  return { success: true, ok, fail: errors.length, errors: errors.slice(0, 20) }
}

async function clearExpiredSeckill(event, actor) {
  const ids = Array.isArray(event && event.productIds) ? event.productIds : []
  const productIds = ids.map((id) => String(id || '').trim()).filter(Boolean)
  if (!productIds.length) return fail('缺少 productIds')
  if (productIds.length > 100) return fail('单次最多 100 条')

  let ok = 0
  for (const productId of productIds) {
    try {
      await db.collection('products').doc(productId).update({
        data: { seckill: null, updateTime: Date.now() }
      })
      ok += 1
    } catch (e) {
      console.warn('clearExpiredSeckill', productId, e && e.message)
    }
  }

  await writeAuditLog(db, auditFromActor(actor, {
    action: 'product_clear_seckill',
    relatedId: '',
    relatedType: 'products',
    detail: { ok, total: productIds.length },
    source: 'manageProducts'
  })).catch(() => {})

  return { success: true, ok, msg: `已清理 ${ok} 件` }
}

async function removeProduct(event, actor) {
  const productId = String((event && event.productId) || '').trim()
  if (!productId) return fail('缺少 productId')
  const isSuper = !!(actor && (actor.superAdmin || actor.workspaceRole === 'super_admin'))
  if (!isSuper) return fail('仅超管可删除商品', 'FORBIDDEN')
  await db.collection('products').doc(productId).remove()
  await writeAuditLog(db, auditFromActor(actor, {
    action: 'product_remove',
    relatedId: productId,
    relatedType: 'products',
    detail: {},
    source: 'manageProducts'
  })).catch(() => {})
  return { success: true, productId }
}

function toMs(value) {
  if (value == null || value === '') return 0
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'object' && value.$date != null) {
    const n = Number(value.$date)
    return Number.isFinite(n) ? n : 0
  }
  const n = new Date(value).getTime()
  return Number.isFinite(n) ? n : 0
}

function isSeckillExpiredDoc(row, now = Date.now()) {
  if (!row || !row.seckill || !row.seckill.enabled) return false
  const end = row.seckill.endTime != null ? Number(row.seckill.endTime) : NaN
  return Number.isFinite(end) && end < now
}

function matchesPromoFilter(row, promoFilter, now = Date.now()) {
  if (promoFilter === 'seckill') {
    return !!(row && row.seckill && row.seckill.enabled && !isSeckillExpiredDoc(row, now))
  }
  if (promoFilter === 'seckill_expired') {
    return isSeckillExpiredDoc(row, now)
  }
  if (promoFilter === 'group') {
    return !!(row && row.groupBuying && row.groupBuying.enabled)
  }
  return true
}

/** 与 C 端 ProductList SORT_MAP 对齐；店长销量用真实 soldCount（非 C 端美化展示值） */
const LIST_SORT_KEYS = ['new', 'sales', 'price_asc', 'price_desc']

function normalizeListSort(raw) {
  const key = String(raw || 'new').trim()
  return LIST_SORT_KEYS.indexOf(key) >= 0 ? key : 'new'
}

function getListProductPrice(row) {
  if (row && row.hasSku && Array.isArray(row.skus) && row.skus.length) {
    const prices = row.skus
      .map((s) => finiteNumber(s && s.price, 0))
      .filter((p) => p > 0)
    if (prices.length) return Math.min.apply(null, prices)
  }
  return Math.max(0, finiteNumber(row && row.price, 0))
}

function getListSoldCount(row) {
  const sold = Math.floor(finiteNumber(row && row.soldCount, NaN))
  if (Number.isFinite(sold) && sold >= 0) return sold
  const legacy = Math.floor(finiteNumber(row && row.sales, NaN))
  if (Number.isFinite(legacy) && legacy >= 0) return legacy
  return 0
}

function compareProductsForSort(a, b, sortBy) {
  if (sortBy === 'sales') {
    const d = getListSoldCount(b) - getListSoldCount(a)
    if (d !== 0) return d
  } else if (sortBy === 'price_asc') {
    const d = getListProductPrice(a) - getListProductPrice(b)
    if (d !== 0) return d
  } else if (sortBy === 'price_desc') {
    const d = getListProductPrice(b) - getListProductPrice(a)
    if (d !== 0) return d
  }
  // 最新（默认）及同分兜底：createTime 新→旧（toMs 兼容 Number/Date 混类型）
  return toMs(b && b.createTime) - toMs(a && a.createTime)
}

function buildListWhere(event, actor, verifiedFramerId) {
  const _ = db.command
  const keyword = String((event && event.keyword) || '').trim().slice(0, 64)
  const archiveFilter = String((event && event.archiveFilter) || 'all').trim()
  const promoFilter = String((event && event.promoFilter) || 'all').trim()
  const giftScene = sanitizeGiftScenes([(event && (event.giftScene || event.giftScenes)) || ''])[0] || ''
  const conditions = []

  const mineOnly = !!(event && (event.mineOnly || event.scope === 'mine'))
  if (mineOnly && actor && actor.openid) {
    const framerId = String(verifiedFramerId || '').trim()
    const orParts = [{ createdByOpenid: actor.openid }]
    if (framerId) orParts.push({ framerId })
    conditions.push(_.or(orParts))
  }

  if (archiveFilter === 'archive') conditions.push({ inArchive: true })
  else if (archiveFilter === 'oneOfAKind') conditions.push({ isOneOfAKind: true })

  if (promoFilter === 'group') conditions.push({ 'groupBuying.enabled': true })
  else if (promoFilter === 'seckill' || promoFilter === 'seckill_expired') {
    conditions.push({ 'seckill.enabled': true })
  }

  if (giftScene) conditions.push({ giftScenes: giftScene })

  if (keyword) {
    const kwCond = buildKeywordCondition(db, _, keyword, PRODUCT_FIELDS)
    if (kwCond) conditions.push(kwCond)
  }

  if (!conditions.length) return { where: null, keyword, archiveFilter, promoFilter, giftScene }
  if (conditions.length === 1) return { where: conditions[0], keyword, archiveFilter, promoFilter, giftScene }
  return { where: _.and(conditions), keyword, archiveFilter, promoFilter, giftScene }
}

/**
 * Admin / 店长 藏品库分页列表
 * event: { page, pageSize, keyword, archiveFilter, promoFilter, sortBy }
 * sortBy: new | sales | price_asc | price_desc
 *
 * 说明：不用 DB orderBy(createTime)（混类型会被索引排除）。
 * 全量匹配后内存排序再分页，保证跨页排序正确（上限 5000）。
 * 当前页会关联 staff_approvals，补齐上架审核态（pending/rejected），供藏品卡水印。
 */
async function attachShelfApprovalStatus(list) {
  if (!Array.isArray(list) || !list.length) return list
  const ids = list.map((p) => p && p._id).filter(Boolean)
  if (!ids.length) return list

  const _ = db.command
  const productById = {}
  list.forEach((p) => {
    if (p && p._id) productById[p._id] = p
  })
  const byId = {}
  const mergeRow = (row) => {
    if (!row || !row.relatedId) return
    const pid = String(row.relatedId)
    const prev = byId[pid]
    if (!prev) {
      byId[pid] = row
      return
    }
    if (row.status === 'pending' && prev.status !== 'pending') {
      byId[pid] = row
      return
    }
    if (row.status === prev.status) {
      const a = Number(row.createTimeMs || row.decidedAtMs || 0)
      const b = Number(prev.createTimeMs || prev.decidedAtMs || 0)
      if (a >= b) byId[pid] = row
    }
  }

  try {
    const pendingRes = await db.collection('staff_approvals')
      .where({
        actionType: 'product_shelf_on',
        relatedId: _.in(ids),
        status: 'pending'
      })
      .limit(Math.min(Math.max(ids.length, 1), 100))
      .get()
    ;(pendingRes.data || []).forEach(mergeRow)
  } catch (e) {
    console.warn('attachShelfApprovalStatus pending', e && e.message)
  }

  const needRejected = ids.filter((id) => {
    const p = productById[id]
    if (!p || p.isOffShelf === false) return false
    if (byId[id] && byId[id].status === 'pending') return false
    if (p.shelfApprovalStatus === 'rejected') return false
    return true
  })
  if (needRejected.length) {
    try {
      const rejectedRes = await db.collection('staff_approvals')
        .where({
          actionType: 'product_shelf_on',
          relatedId: _.in(needRejected),
          status: 'rejected'
        })
        .limit(Math.min(Math.max(needRejected.length * 2, 1), 200))
        .get()
      ;(rejectedRes.data || []).forEach(mergeRow)
    } catch (e) {
      console.warn('attachShelfApprovalStatus rejected', e && e.message)
    }
  }

  return list.map((p) => {
    if (!p) return p
    const approval = byId[p._id]
    let status = ''
    if (p.isOffShelf === false) {
      status = 'approved'
    } else if ((approval && approval.status === 'pending') || p.shelfApprovalStatus === 'pending') {
      status = 'pending'
    } else if ((approval && approval.status === 'rejected') || p.shelfApprovalStatus === 'rejected') {
      status = 'rejected'
    }
    const rejectReason = status === 'rejected'
      ? (p.shelfRejectReason || (approval && approval.rejectReason) || '')
      : (p.shelfRejectReason || '')
    return {
      ...p,
      shelfApprovalStatus: status,
      shelfApprovalId: (approval && approval._id) || p.shelfApprovalId || '',
      shelfRejectReason: rejectReason
    }
  })
}

function computeShelfCounts(rows) {
  const counts = { all: 0, on: 0, pending: 0, rejected: 0, off: 0 }
  const list = Array.isArray(rows) ? rows : []
  counts.all = list.length
  list.forEach((p) => {
    if (!p) return
    if (p.isOffShelf === false) counts.on += 1
    else if (p.shelfApprovalStatus === 'pending') counts.pending += 1
    else if (p.shelfApprovalStatus === 'rejected') counts.rejected += 1
    else counts.off += 1
  })
  return counts
}

async function backfillMineProductLinks(event, actor) {
  const openid = actor && actor.openid ? String(actor.openid) : ''
  if (!openid) return fail('未登录')
  const isArtisan = actor.workspaceRole === WORKSPACE_SPECIMEN_ARTISAN
  const isSuper = !!(actor.superAdmin || actor.workspaceRole === WORKSPACE_SUPER_ADMIN)
  if (!isArtisan && !isSuper) return fail('无操作权限', 'FORBIDDEN')

  let targetOpenid = openid
  if (isSuper && event && event.targetStaffOpenid) {
    targetOpenid = String(event.targetStaffOpenid).trim()
  }

  const framerRow = await findFramerRowForStaffOpenid(targetOpenid)
  if (!framerRow || !framerRow._id) {
    return { success: true, linked: 0, scanned: 0, msg: '尚无标本师档案，请先保存个人主页' }
  }
  const framerId = String(framerRow._id)
  const framerDisplayName = normalizeMakerToken(framerRow.name || actor.name || '')

  const MAX_SCAN = 2000
  const PAGE = 100
  let scanned = 0
  let linked = 0
  const patchIds = new Set()

  const consider = (row) => {
    if (!row || !row._id) return
    const id = String(row._id)
    if (patchIds.has(id)) return
    const existingFramer = String(row.framerId || '').trim()
    if (existingFramer && existingFramer !== framerId) return

    const byOpenid = row.createdByOpenid && String(row.createdByOpenid) === targetOpenid
    const byName = !existingFramer && productMakerNamesMatch(row, framerDisplayName)
    if (!byOpenid && !byName) return
    if (!productNeedsFramerLink(row, framerId)) return
    patchIds.add(id)
  }

  let cursor = 0
  while (scanned < MAX_SCAN) {
    const res = await db.collection('products')
      .where({ createdByOpenid: targetOpenid })
      .skip(cursor)
      .limit(PAGE)
      .get()
    const rows = res.data || []
    if (!rows.length) break
    rows.forEach(consider)
    scanned += rows.length
    cursor += rows.length
    if (rows.length < PAGE) break
  }

  if (framerDisplayName) {
    cursor = 0
    let nameScanned = 0
    while (nameScanned < MAX_SCAN) {
      const res = await db.collection('products')
        .where({ framerName: framerDisplayName })
        .skip(cursor)
        .limit(PAGE)
        .get()
      const rows = res.data || []
      if (!rows.length) break
      rows.forEach(consider)
      nameScanned += rows.length
      cursor += rows.length
      if (rows.length < PAGE) break
    }
    scanned += nameScanned
  }

  const ids = Array.from(patchIds)
  for (let i = 0; i < ids.length; i += 1) {
    const productId = ids[i]
    try {
      await db.collection('products').doc(productId).update({
        data: {
          framerId,
          updateTime: Date.now(),
          ...(framerDisplayName ? { framerName: framerDisplayName } : {})
        }
      })
      linked += 1
    } catch (e) {
      console.warn('backfillMineProductLinks', productId, e && e.message)
    }
  }

  if (linked > 0) {
    await writeAuditLog(db, auditFromActor(actor, {
      action: 'product_backfill_framer_link',
      relatedId: framerId,
      relatedType: 'framers',
      detail: { linked, candidateCount: ids.length, targetOpenid },
      source: 'manageProducts'
    })).catch(() => {})
  }

  return { success: true, linked, scanned, framerId, candidateCount: ids.length }
}

async function listProducts(event, actor) {
  const page = Math.max(1, parseInt((event && event.page) || 1, 10) || 1)
  const pageSize = Math.min(Math.max(parseInt((event && event.pageSize) || 50, 10) || 50, 1), 100)
  const skip = (page - 1) * pageSize
  const sortBy = normalizeListSort((event && (event.sortBy || event.sort)) || 'new')
  const mineOnly = !!(event && (event.mineOnly || event.scope === 'mine'))
  let verifiedFramerId = ''
  if (mineOnly && actor && actor.openid) {
    verifiedFramerId = await resolveVerifiedArtisanFramerId(actor, event && event.framerId)
    if (event && event.linkBackfill) {
      await backfillMineProductLinks(event, actor).catch((e) => {
        console.warn('list linkBackfill', e && e.message)
      })
      verifiedFramerId = await resolveVerifiedArtisanFramerId(actor, event && event.framerId)
    }
  }
  const { where, promoFilter, keyword } = buildListWhere(event, actor, verifiedFramerId)
  const needsMemoryPromo =
    promoFilter === 'seckill' || promoFilter === 'seckill_expired'
  const now = Date.now()

  const PAGE = 100
  const MAX = 5000
  const matched = []
  let cursor = 0
  let scanned = 0
  while (scanned < MAX) {
    let query = db.collection('products')
    if (where) query = query.where(where)
    const res = await query.skip(cursor).limit(PAGE).get()
    const rows = res.data || []
    if (!rows.length) break
    rows.forEach((row) => {
      if (needsMemoryPromo) {
        if (matchesPromoFilter(row, promoFilter, now)) matched.push(row)
      } else {
        matched.push(row)
      }
    })
    scanned += rows.length
    cursor += rows.length
    if (rows.length < PAGE) break
  }

  let ordered = matched
  if (keyword) {
    ordered = rankByKeyword(ordered, keyword)
    if (sortBy !== 'new') {
      ordered.sort((a, b) => compareProductsForSort(a, b, sortBy))
    }
  } else {
    ordered.sort((a, b) => compareProductsForSort(a, b, sortBy))
  }
  const total = ordered.length
  const attachAll = !!(mineOnly && total <= 500)
  const withStatus = await attachShelfApprovalStatus(attachAll ? ordered : ordered.slice(skip, skip + pageSize))
  const list = (attachAll ? withStatus.slice(skip, skip + pageSize) : withStatus).map((row) => ({
    ...row,
    tags: readProductTags(row),
    giftScenes: readGiftScenes(row)
  }))
  const shelfCounts = computeShelfCounts(attachAll ? withStatus : ordered)
  return {
    success: true,
    list,
    total,
    page,
    pageSize,
    sortBy,
    scanned,
    truncated: scanned >= MAX,
    shelfCounts
  }
}

function dayKeyFromMs(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function buildDayKeys(days) {
  const keys = []
  const end = new Date()
  end.setHours(0, 0, 0, 0)
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end)
    d.setDate(end.getDate() - i)
    keys.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    )
  }
  return keys
}

/**
 * 藏品库统计聚合（店长看板）
 * event.trendDays: 7 | 30（默认 7）——仅影响录入趋势与「近期录入成本占比」，
 * 预估积压货款始终按当前在库全量（costPrice × stock）汇总。
 */
async function stats(event) {
  const trendDays = Math.min(Math.max(parseInt((event && event.trendDays) || 7, 10) || 7, 7), 30)
  const now = Date.now()
  const trendStart = now - trendDays * 24 * 60 * 60 * 1000

  const counts = {
    total: 0,
    onShelf: 0,
    offShelf: 0,
    inArchive: 0,
    oneOfAKind: 0,
    hasSku: 0,
    treasure: 0,
    seckill: 0,
    groupBuying: 0,
    stockTotal: 0,
    soldTotal: 0
  }
  /** 预估积压货款：在库件数 × 进货成本 costPrice（无成本分级/紧急度字段） */
  const costAgg = {
    estimatedOverstock: 0,
    archiveOverstock: 0,
    recentOverstock: 0,
    pricedItems: 0,
    pricedStock: 0,
    missingCostItems: 0,
    missingCostStock: 0
  }
  const byRoot = {}
  const bySub = {}
  const dayAdds = {}
  const salesCandidates = []

  const PAGE = 100
  const MAX = 3000
  let skip = 0
  let scanned = 0

  while (scanned < MAX) {
    const res = await db
      .collection('products')
      .skip(skip)
      .limit(PAGE)
      .field({
        title: true,
        images: true,
        isOffShelf: true,
        inArchive: true,
        isOneOfAKind: true,
        isTreasure: true,
        hasSku: true,
        stock: true,
        soldCount: true,
        price: true,
        costPrice: true,
        rootCategoryName: true,
        rootCategoryId: true,
        category: true,
        categoryId: true,
        createTime: true,
        seckill: true,
        groupBuying: true
      })
      .get()
    const rows = res.data || []
    if (!rows.length) break

    rows.forEach((p) => {
      counts.total += 1
      if (p.isOffShelf === false) counts.onShelf += 1
      else counts.offShelf += 1
      if (p.inArchive === true) counts.inArchive += 1
      if (p.isOneOfAKind === true) counts.oneOfAKind += 1
      if (p.hasSku) counts.hasSku += 1
      if (p.isTreasure) counts.treasure += 1
      if (p.seckill && p.seckill.enabled) counts.seckill += 1
      if (p.groupBuying && p.groupBuying.enabled) counts.groupBuying += 1
      const stock = Math.max(0, Math.floor(finiteNumber(p.stock, 0)))
      counts.stockTotal += stock
      const sold = Math.max(0, Math.floor(finiteNumber(p.soldCount, 0)))
      counts.soldTotal += sold

      const created = toMs(p.createTime)
      const costPrice = Math.max(0, finiteNumber(p.costPrice, 0))
      if (stock > 0) {
        if (costPrice > 0) {
          const line = costPrice * stock
          costAgg.estimatedOverstock += line
          costAgg.pricedItems += 1
          costAgg.pricedStock += stock
          if (p.inArchive === true) costAgg.archiveOverstock += line
          if (created >= trendStart) costAgg.recentOverstock += line
        } else {
          costAgg.missingCostItems += 1
          costAgg.missingCostStock += stock
        }
      }

      const root = String(p.rootCategoryName || '未分类').trim() || '未分类'
      const sub = String(p.category || '未标注').trim() || '未标注'
      byRoot[root] = (byRoot[root] || 0) + 1
      const subKey = `${root} › ${sub}`
      bySub[subKey] = (bySub[subKey] || 0) + 1

      if (created >= trendStart) {
        const dk = dayKeyFromMs(created)
        if (dk) dayAdds[dk] = (dayAdds[dk] || 0) + 1
      }

      if (sold > 0) {
        salesCandidates.push({
          _id: p._id,
          title: String(p.title || '').slice(0, 40),
          cover: Array.isArray(p.images) && p.images[0] ? p.images[0] : '',
          soldCount: sold,
          price: finiteNumber(p.price, 0),
          rootCategoryName: root
        })
      }
    })

    scanned += rows.length
    skip += rows.length
    if (rows.length < PAGE) break
  }

  const toBars = (obj, limit) => {
    const list = Object.keys(obj)
      .map((key) => ({ key, count: obj[key] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
    const max = list.reduce((m, x) => Math.max(m, x.count), 0) || 1
    return list.map((x) => ({
      ...x,
      pct: Math.round((x.count / max) * 100)
    }))
  }

  const dayKeys = buildDayKeys(trendDays)
  const trendMax = dayKeys.reduce((m, k) => Math.max(m, dayAdds[k] || 0), 0) || 1
  const trend = dayKeys.map((key) => {
    const count = dayAdds[key] || 0
    return {
      key,
      label: key.slice(5),
      count,
      pct: Math.round((count / trendMax) * 100)
    }
  })
  const addedInRange = trend.reduce((s, d) => s + d.count, 0)

  const salesTop = salesCandidates
    .sort((a, b) => b.soldCount - a.soldCount)
    .slice(0, 8)

  const overstock = Math.round(costAgg.estimatedOverstock * 100) / 100
  const recentOverstock = Math.round(costAgg.recentOverstock * 100) / 100
  const archiveOverstock = Math.round(costAgg.archiveOverstock * 100) / 100
  const recentRatio =
    overstock > 0 ? Math.round((recentOverstock / overstock) * 1000) / 10 : 0

  return {
    success: true,
    scanned,
    truncated: scanned >= MAX,
    trendDays,
    counts,
    categoryRoot: toBars(byRoot, 8),
    categorySub: toBars(bySub, 10),
    trend,
    addedInRange,
    salesTop,
    salesTotal: counts.soldTotal,
    cost: {
      estimatedOverstock: overstock,
      archiveOverstock,
      recentOverstock,
      recentRatio,
      pricedItems: costAgg.pricedItems,
      pricedStock: costAgg.pricedStock,
      missingCostItems: costAgg.missingCostItems,
      missingCostStock: costAgg.missingCostStock
    }
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const adminOpsKey = event && event.adminOpsKey
  const action = String((event && event.action) || 'upsert').trim()

  // 安全：不存在「无 OPENID 即超管」的通道。backfillTags 同样必须走 requireManager
  // （原实现让任何无登录态的调用方直接获得 superAdmin，等于公开后门）
  if (!openid && !adminOpsKey) return fail('未登录')

  let access = await requireManager(openid, adminOpsKey)
  if (!access.ok && (action === 'list' || action === 'backfillMineLinks')) {
    access = await assertStaff(db, openid, { role: ROLE_STAFF, permission: 'manageArtisanWorks', adminOpsKey })
      .then((guard) => (guard.ok ? { ok: true, actor: { ...guard.actor, openid } } : { ok: false, code: guard.code, msg: guard.msg }))
  }
  if (!access.ok) return fail(access.msg || '无权限', access.code)

  try {
    switch (action) {
      case 'list':
        return await listProducts(event, access.actor)
      case 'upsert':
        return await upsert(event, access.actor)
      case 'patch':
        return await patch(event, access.actor)
      case 'batchPatch':
        return await batchPatch(event, access.actor)
      case 'clearExpiredSeckill':
        return await clearExpiredSeckill(event, access.actor)
      case 'remove':
        return await removeProduct(event, access.actor)
      case 'stats':
        return await stats(event)
      case 'backfillMineLinks':
        return await backfillMineProductLinks(event, access.actor)
      case 'backfillTags':
        return await backfillProductTags(event, access.actor, { cloud, db })
      default:
        return fail(`未知 action: ${action}`)
    }
  } catch (e) {
    console.error('manageProducts', action, e)
    return fail(e.message || '操作失败')
  }
}
