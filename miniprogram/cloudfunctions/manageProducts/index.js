/**
 * 商品写入代理 — products 集合 write:false 后唯一店长/Admin 写入口
 *
 * action:
 *   list              分页列表 { page, pageSize, keyword, archiveFilter, promoFilter, sortBy, giftScene, riskFilter, shelfFilter, withRiskMeta }
 *                     sortBy: new | sales | price_asc | price_desc（默认 new；与 C 端 ProductList 语义对齐）
 *                     giftScene: 可选，按 products.giftScenes 含该 key 过滤
 *                     riskFilter（2026-10-13 新增，不传 = all = 与改前逐字一致）:
 *                       high   = 保护类（三有 / 保护植物 / 保护动物）
 *                       medium = **所属分类在「动物馆」下**且**不含保护类**（与 high 互斥）
 *                                （2026-10-14 收窄：不再看 taxonomy.kingdom；产品负责人「而非动物界」）
 *                       normal = **既不是 high 也不是 medium**（2026-10-14 修正：原为「none / 缺失」，
 *                                那会把中等风险那批再包一遍，三层相加 ≠ 全库）
 *                     shelfFilter（同日新增，不传 = all）: on | off | pending | rejected（优先级同 shelfCounts）
 *                     withRiskMeta（2026-10-14 新增，不传 = 逐字同改前）:
 *                       每行附加 riskTier(high|medium|normal) / riskBasis(protection|category) / certMissing
 *   riskOverview      只读风险分层概览 { mineOnly? } → { all, tiers:{high,medium,normal}, scanned, truncated }
 *                     tiers 互斥穷尽（total 相加 = all.total）；high.byProtection / medium.byGroup / *.missingCert
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
const { sanitizeBlessTags } = require('./blessTags')
const { backfillProductTags } = require('./backfillTags')
const {
  normalizeChannel,
  normalizeCraftType,
  normalizeCraftProcess
} = require('./productTaxonomy')
const { resolveSensitiveBlurForSave } = require('./sensitiveMorphology')
const { sanitizeProductMedia, stripVideoUrls, isVideoUrl } = require('./productMedia')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 「高风险藏品」口径 = 商品著录的保护等级非 none。
 * ⚠️ 与 assistProductCopy 的 PROTECTION_TYPES、鉴定流 speciesProfile 的 PRODUCT_PROTECTION
 * 必须同源（三有 / 保护植物 / 保护动物）；改这里就要同时改那两处与小程序表单的选项。
 */
const PROTECTED_TYPES = ['sanyou', 'protected_plant', 'protected_animal']

/**
 * 「中等风险」口径（**产品负责人 2026-10-14 第二轮指令收窄**）：**所属分类在「动物馆」下的藏品**。
 *
 * 沿革（别再把口径改回去）：
 *   2026-10-13 第一版 = **动物界**（`taxonomy.kingdom ∈ 动物界/Animalia` ∨ 所属分类指向动物界分类），
 *     实测命中 216 件 —— 把昆虫馆 121 / 海洋馆 28 / 首饰馆 18（动物源首饰）/ 衍生品 2 /
 *     矿石馆 3（化石、石英）/ 植物馆 1 全扫了进来。产品负责人 2026-10-14 明确：
 *     「**中等风险藏品仅限于分类中为动物馆中的藏品，而非动物界；缩小覆盖面**」。
 *   2026-10-14 第二版（现行）= **只认分类**：`categoryId / rootCategoryId ∈ 动物馆子树`
 *     （动物馆本身 + 哺乳纲 / 爬行纲 / 鸟纲 / 两栖纲 / 辐鳍鱼纲 / 头足类），实测 216 → **43**。
 *     **不再读 `taxonomy.kingdom`** —— 学名属于哪一界不再参与"算不算中等风险"的判定。
 *
 * ⚠️ 与高风险**互斥**：保护类一律归高风险（含保护动物），中等风险 = 动物馆 − 保护类 ——
 *    否则同一件会同时落进两个「一键上下线」，计数重复、两次操作互相打架。
 * ⚠️ 分类名是**一级分类的中文名**；id 每次现查（不写死），改分类树不需要改代码。
 */
const ANIMAL_HALL_NAME = '动物馆'

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
  'wishWallEnabled', 'wishWallKey',
  // 需求：主题名（双层命名 —— title 仍是标准名，用于检索/识别/对账；themeName 是文艺主题名）
  'themeName', 'themeNote',
  // 需求 28 · item 6：商品祈运标签（受控枚举，见 blessTags.js）—— 玩法推荐与祈福墙文案的匹配依据之一
  'blessTags',
  // 2026-09-28 产品点名：视频 / 实况（可选；只有详情页轮播读它，images 仍只放图片）—— 见 productMedia.js
  'media'
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

/**
 * 尺寸数值归一：去掉小数尾零（21.0 → 21、4.50 → 4.5）。只处理纯「数字.数字」，A4 这类不动。
 * 与小程序 utils/skuSize.trimSizeNumber / ERP admin/src/utils/sizeCanonical.js 同口径。
 */
function trimSizeNumber(value) {
  const v = String(value == null ? '' : value).trim()
  if (!/^\d+\.\d+$/.test(v)) return v
  return v.replace(/\.?0+$/, '') || '0'
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
  // 结构化字段存在时**以它们为权威重建** size（旧实现是 `if (!size && ...)`：调用方传来的脏 size
  // 会原样入库 —— ERP 曾写进 `0x0x0 cm` 与带尾零的值，C 端因此显示过「0×0×厚度 0 厘米」）
  if (sizeL || sizeW || sizeH) {
    const parts = [sizeL, sizeW, sizeH].map(trimSizeNumber).filter(Boolean)
    size = parts.length ? `${parts.join('x')} cm` : ''
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
  if (Object.prototype.hasOwnProperty.call(data, 'blessTags')) {
    // 受控枚举：非法 key 直接丢弃（与 tags/giftScenes 同口径：宁可不写，不写脏值）
    data.blessTags = sanitizeBlessTags(data.blessTags)
  }
  if (Object.prototype.hasOwnProperty.call(data, 'giftScenes')) {
    data.giftScenes = sanitizeGiftScenes(data.giftScenes)

    // 主题名纪律（与 scripts/productThemeName.mjs 同源）：2–8 个汉字；不合规**丢弃**（宁可不写脏名字）
    if (Object.prototype.hasOwnProperty.call(data, 'themeName')) {
      const tName = String(data.themeName || '').trim()
      data.themeName = /^[\u4e00-\u9fa5]{2,8}$/.test(tName) ? tName : ''
    }
    if (Object.prototype.hasOwnProperty.call(data, 'themeNote')) {
      data.themeNote = String(data.themeNote || '').trim().slice(0, 40)
    }
  }
  if (Object.prototype.hasOwnProperty.call(data, 'latinName')) {
    const latin = String(data.latinName == null ? '' : data.latinName).trim()
    data.latinName = /^(n\/?a|n\.a\.?|null|undefined|none|nil|unknown|-|—|–|暂无|无|未知)$/i.test(latin)
      ? ''
      : latin
  }
  if (Object.prototype.hasOwnProperty.call(data, 'media')) {
    data.media = sanitizeProductMedia(data.media)
  }
  if (Array.isArray(data.images)) {
    data.images = stripVideoUrls(data.images)
  }
  if (typeof data.coverImage === 'string' && isVideoUrl(data.coverImage)) {
    delete data.coverImage
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
    let docMissing = false
    try {
      const doc = await db.collection('products').doc(productId).get()
      existingRow = doc.data || null
      // 解析成功却没有数据 = 明确不存在（而不是偶发读失败）
      if (!existingRow) docMissing = true
    } catch (e) {
      const msg = String((e && (e.errMsg || e.message)) || '')
      if (/not exist|does not exist|DOCUMENT_NOT_FOUND|-501004/i.test(msg)) docMissing = true
    }
    // 文档不存在时 update 会命中 0 条却**不报错** → 客户端显示「已保存」但什么都没写。
    // 这正是「多规格库存改完保存没生效」的一种静默形态（2026-09-18 排查）。
    if (docMissing) {
      return fail('保存未生效：藏品不存在或已被删除，请刷新后重试', 'NOT_FOUND')
    }
    applySensitiveBlurDefaults(data, raw, existingRow, false)
    await applyArtisanOwnershipFields(data, actor, existingRow)
    // 上下架仅 manageApprovals；保存时禁止改 isOffShelf
    delete data.isOffShelf
    delete data.createTime
    const upd = await db.collection('products').doc(productId).update({ data })
    // 二次防线：命中的文档数若为 0，说明这次保存**什么都没写**（并发删除等），
    // 必须报失败，不能报「已保存」——「写失败被当成成功」在本仓库已有前科（见 714a1bf）。
    const updated = Number(
      (upd && upd.stats && (upd.stats.updated != null ? upd.stats.updated : upd.stats.updatedCount)) || 0
    )
    if (updated === 0) {
      return fail('保存未生效：写入未命中任何记录，请刷新后重试', 'NOT_APPLIED')
    }
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
    return {
      success: true,
      productId,
      mode: 'update',
      hasSku: !!data.hasSku,
      // 回带回写后的库存口径：客户端据此核对「我提交的规格库存有没有被服务端保留」
      // （2026-09-18：让「多规格库存保存没生效」这类问题在客户端就能当场发现）
      stock: typeof data.stock === 'number' ? data.stock : undefined,
      skus: Array.isArray(data.skus)
        ? data.skus.map((s) => ({ id: String(s.id || ''), stock: Number(s.stock) || 0 }))
        : undefined
    }
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

/**
 * 「动物馆」分类子树的 id（一级 `动物馆` + 它的全部二级）。
 * 只在 riskFilter 走 medium / normal，或 `withRiskMeta` 时查一次；
 * categories 是小集合（现 ~63 条），**id 每次现查不写死**（改分类树不用改代码），失败就返回空 = 中等风险为空。
 *
 * 为什么按"一级分类名"找根：`categories` 里一级的 `parentId` 为空，二级带 `parentId`；
 * 先按名字取根，再取 `parentId === 根` 的二级 —— 两步都能命中索引，比一次全表读更省。
 */
async function loadAnimalHallCategoryIds() {
  try {
    const rootRes = await db.collection('categories')
      .where({ name: ANIMAL_HALL_NAME })
      .limit(20)
      .field({ _id: true, parentId: true })
      .get()
    const roots = (rootRes && rootRes.data) || []
    const root = roots.find((c) => c && !c.parentId) || roots[0]
    if (!root || !root._id) return []
    const childRes = await db.collection('categories')
      .where({ parentId: root._id })
      .limit(200)
      .field({ _id: true })
      .get()
    const children = ((childRes && childRes.data) || []).map((c) => (c && c._id) || '').filter(Boolean)
    return [root._id, ...children]
  } catch (e) {
    console.warn('loadAnimalHallCategoryIds', e && e.message)
    return []
  }
}

/**
 * 「本人藏品」作用域条件（`mineOnly` / `scope: 'mine'`）。
 * 抽出来是因为**风险概览也要用同一套作用域** —— 两处各写一遍 = 概览与清单的口径迟早分叉。
 */
function buildScopeCondition(event, actor, verifiedFramerId) {
  const _ = db.command
  const mineOnly = !!(event && (event.mineOnly || event.scope === 'mine'))
  if (!mineOnly || !actor || !actor.openid) return null
  const framerId = String(verifiedFramerId || '').trim()
  const orParts = [{ createdByOpenid: actor.openid }]
  if (framerId) orParts.push({ framerId })
  return _.or(orParts)
}

function buildListWhere(event, actor, verifiedFramerId, animalHallCategoryIds = []) {
  const _ = db.command
  const keyword = String((event && event.keyword) || '').trim().slice(0, 64)
  const archiveFilter = String((event && event.archiveFilter) || 'all').trim()
  const promoFilter = String((event && event.promoFilter) || 'all').trim()
  // 2026-10-13 新增（提审前的合规诉求）：按**保护等级**筛「高风险藏品」。
  // 口径与 product 著录字段 protectionType 完全一致（none / sanyou / protected_plant / protected_animal），
  // 不新增字段、不改既有参数语义（不传 = all = 与改前逐字一致）。
  const riskFilter = String((event && event.riskFilter) || 'all').trim()
  // 2026-10-13 新增：按**上架态**筛（on / off / pending / rejected），口径与 list 返回的 shelfCounts 完全一致。
  // 不传 = all = 与改前逐字一致。
  const shelfFilter = String((event && event.shelfFilter) || 'all').trim()
  const giftScene = sanitizeGiftScenes([(event && (event.giftScene || event.giftScenes)) || ''])[0] || ''
  const blessTag = sanitizeBlessTags([(event && (event.blessTag || event.blessTags)) || ''])[0] || ''
  const conditions = []

  const mineOnly = !!(event && (event.mineOnly || event.scope === 'mine'))
  if (mineOnly) {
    const scopeCond = buildScopeCondition(event, actor, verifiedFramerId)
    if (scopeCond) conditions.push(scopeCond)
  }

  if (archiveFilter === 'archive') conditions.push({ inArchive: true })
  else if (archiveFilter === 'oneOfAKind') conditions.push({ isOneOfAKind: true })

  if (riskFilter === 'high') conditions.push({ protectionType: _.in(PROTECTED_TYPES) })
  else if (riskFilter === 'medium') {
    // 中等风险 = **所属分类在「动物馆」下** − 保护类（两个「一键上下线」入口互斥，见 ANIMAL_HALL_NAME 注释）。
    // 2026-10-14 收窄：**不再读 taxonomy.kingdom**（产品负责人：「仅限于分类中为动物馆中的藏品，而非动物界」）。
    // 分类查不到（hallIds 为空）时**不退化**成"全库都算中等风险" —— 宁可这一层为空，也不能把范围偷偷放大。
    const mediumConds = [{ protectionType: _.nin(PROTECTED_TYPES) }]
    if (animalHallCategoryIds.length) {
      mediumConds.push(_.or([
        { categoryId: _.in(animalHallCategoryIds) },
        { rootCategoryId: _.in(animalHallCategoryIds) }
      ]))
    } else {
      // 哨兵 id：命中零条（比"不追加条件"安全 —— 不追加就等于"全库都算中等风险"，那是把范围偷偷放大）
      mediumConds.push({ _id: '__animal_hall_unavailable__' })
    }
    conditions.push(_.and(mediumConds))
  } else if (riskFilter === 'normal') {
    // 「普通」= **既不是高风险（保护类）也不是中等风险（动物馆）**。
    // 2026-10-14 修正：原来是「protectionType 为 none / 缺失」（= 244 件），
    // 而中等风险那批里绝大多数的 protectionType 恰好就是 none —— 于是「普通」把中等风险
    // 又包了一遍，三层相加 ≠ 全库。分层计数加不回总数，产品负责人一眼就会问。
    // 现在三层与 `riskTierOf`（内存同源判据）**同一个划分**：互斥、穷尽、相加 = 全库。
    const notAnimal = [{ protectionType: _.nin(PROTECTED_TYPES) }]
    if (animalHallCategoryIds.length) {
      notAnimal.push({ categoryId: _.nin(animalHallCategoryIds) })
      notAnimal.push({ rootCategoryId: _.nin(animalHallCategoryIds) })
    }
    conditions.push(_.and(notAnimal))
  }

  if (promoFilter === 'group') conditions.push({ 'groupBuying.enabled': true })
  else if (promoFilter === 'seckill' || promoFilter === 'seckill_expired') {
    conditions.push({ 'seckill.enabled': true })
  }

  // ⚠️ 与 computeShelfCounts 的**同一套优先级**（on → pending → rejected → off），
  // 否则「筛选结果条数」会与卡片上的计数对不上（同一屏两个数字打架最难查）。
  if (shelfFilter === 'on') conditions.push({ isOffShelf: false })
  else if (shelfFilter === 'pending') {
    conditions.push(_.and([{ isOffShelf: _.neq(false) }, { shelfApprovalStatus: 'pending' }]))
  } else if (shelfFilter === 'rejected') {
    conditions.push(_.and([{ isOffShelf: _.neq(false) }, { shelfApprovalStatus: 'rejected' }]))
  } else if (shelfFilter === 'off') {
    conditions.push(_.and([{ isOffShelf: _.neq(false) }, { shelfApprovalStatus: _.nin(['pending', 'rejected']) }]))
  }

  if (giftScene) conditions.push({ giftScenes: giftScene })
  if (blessTag) conditions.push({ blessTags: blessTag })

  if (keyword) {
    const kwCond = buildKeywordCondition(db, _, keyword, PRODUCT_FIELDS)
    if (kwCond) conditions.push(kwCond)
  }

  if (!conditions.length) return { where: null, keyword, archiveFilter, promoFilter, riskFilter, giftScene, blessTag }
  if (conditions.length === 1) return { where: conditions[0], keyword, archiveFilter, promoFilter, riskFilter, giftScene, blessTag }
  return { where: _.and(conditions), keyword, archiveFilter, promoFilter, riskFilter, giftScene }
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 风险分层的内存判据（2026-10-14，产品负责人：「把高风险与中风险能力抽象成独立的『风险管理』tab」）
 *
 * 为什么要有内存版：概览要把**每一件**归到 high / medium / normal，DB 的 `where` 只能回答
 * 「符合条件的有几件」。两层判据并存 = 迟早分叉，所以：
 *   · 常量只有一份（PROTECTED_TYPES / ANIMAL_HALL_NAME），两边都引用它；
 *   · 判据只有一条：保护类 → high；所属分类在动物馆子树 → medium；其余 → normal；
 *   · 守卫 `check:product-lib-risk` 的 A7 钉住「内存三层互斥且相加 = 全库」，
 *     并用线上真数据核对「内存 high/medium/normal == where 三层」
 *     （2026-10-14 收窄口径后实测：11 / 43 / 201，相加 255 = 全库）。
 * ⚠️ 改这里必须同步 `buildListWhere` 的 high/medium/normal 三个分支，反之亦然。
 * ══════════════════════════════════════════════════════════════════════════════ */

/** 商品挂的分类是否在「动物馆」子树下（**唯一**的中等风险判据；不再看 taxonomy） */
function isInAnimalHall(row, animalHallCategoryIds = []) {
  const ids = animalHallCategoryIds || []
  if (!ids.length) return false
  return (!!row.categoryId && ids.indexOf(row.categoryId) >= 0) ||
    (!!row.rootCategoryId && ids.indexOf(row.rootCategoryId) >= 0)
}

/** 单件藏品的风险层级：high（保护类）/ medium（动物馆）/ normal。**互斥且穷尽**。 */
function riskTierOf(row, animalHallCategoryIds = []) {
  const pt = String((row && row.protectionType) || '').trim()
  if (PROTECTED_TYPES.indexOf(pt) >= 0) return 'high'
  // 只看分类 —— 产品负责人 2026-10-14：「仅限于分类中为动物馆中的藏品，而非动物界」
  if (isInAnimalHall(row, animalHallCategoryIds)) return 'medium'
  return 'normal'
}

/** 命中原因（给店主看「为什么这件算风险」）：protection | category | '' */
function riskBasisOf(row, animalHallCategoryIds = []) {
  const tier = riskTierOf(row, animalHallCategoryIds)
  if (tier === 'high') return 'protection'
  if (tier !== 'medium') return ''
  // 中等风险只有一条判据（分类在动物馆），所以原因恒为 category —— 这正是"口径收窄"的含义
  return 'category'
}

/** 收藏证书是否缺失（合规提醒用；空串 / 空数组 / 空对象都算缺） */
function isCertMissing(row) {
  const v = row && row.collectionCertificate
  if (v === undefined || v === null || v === '') return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return !Object.keys(v).length
  return String(v).trim() === ''
}

/**
 * 按 where 全量扫描 products（分页 100、上限 5000）。
 * 抽出来给 `list` 与 `riskOverview` 共用 —— 两边各写一次扫描循环必然漂移（页大小 / 上限 / 截断语义）。
 */
async function scanProducts(where) {
  const PAGE = 100
  const MAX = 5000
  const rows = []
  let cursor = 0
  while (rows.length < MAX) {
    let query = db.collection('products')
    if (where) query = query.where(where)
    const res = await query.skip(cursor).limit(PAGE).get()
    const batch = res.data || []
    if (!batch.length) break
    rows.push(...batch)
    cursor += batch.length
    if (batch.length < PAGE) break
  }
  return { rows, scanned: rows.length, truncated: rows.length >= MAX }
}

/**
 * 风险概览（**只读**，2026-10-14）。
 * 一次调用返回「风险管理」模块顶部的全部分层数字，省掉客户端 3~4 次 count 往返：
 *   all   : 作用域内全量（含上架态拆分）
 *   tiers : high / medium / normal —— 互斥穷尽，`total` 相加 = `all.total`
 *           high   另有 byProtection（三有 / 保护植物 / 保护动物）
 *           medium 另有 byGroup（动物馆下二级分类构成：爬行纲 / 哺乳纲 / 鸟纲 …）
 *                  —— 口径收窄成"只看分类"之后，"凭什么算"已经不言自明，
 *                     更有信息量的是**这一层由什么构成**（原来那个 byBasis 会恒等于一个值，成了废字段）
 *           normal 不细分
 *   每层另有 missingCert（缺收藏证书）—— 合规待办
 * 作用域（mineOnly / framerId）与 list 同源（buildScopeCondition）；
 * 上架态用 `computeShelfCounts` 同一套优先级（on → pending → rejected → off）。
 */
async function riskOverview(event, actor) {
  const animalHallCategoryIds = await loadAnimalHallCategoryIds()
  // 作用域与 list 同源；「本人藏品」下 framerId 同样要过服务端校验才采纳
  const mineOnly = !!(event && (event.mineOnly || event.scope === 'mine'))
  let verifiedFramerId = ''
  if (mineOnly && actor && actor.openid) {
    verifiedFramerId = await resolveVerifiedArtisanFramerId(actor, event && event.framerId)
  }
  const scopeCond = buildScopeCondition(event, actor, verifiedFramerId)
  const { rows, scanned, truncated } = await scanProducts(scopeCond)

  const blank = () => ({ total: 0, on: 0, pending: 0, rejected: 0, off: 0, missingCert: 0 })
  const tiers = { high: blank(), medium: blank(), normal: blank() }
  tiers.high.byProtection = { sanyou: 0, protected_plant: 0, protected_animal: 0 }
  const mediumGroupCounts = {}
  const all = blank()

  rows.forEach((row) => {
    if (!row) return
    const bucket = tiers[riskTierOf(row, animalHallCategoryIds)]
    if (!bucket) return
    bucket.total += 1
    // 与 computeShelfCounts 同一套优先级（否则概览与藏品明细的 chip 会打架）
    if (row.isOffShelf === false) { bucket.on += 1; all.on += 1 }
    else if (row.shelfApprovalStatus === 'pending') { bucket.pending += 1; all.pending += 1 }
    else if (row.shelfApprovalStatus === 'rejected') { bucket.rejected += 1; all.rejected += 1 }
    else { bucket.off += 1; all.off += 1 }
    all.total += 1
    const missing = isCertMissing(row)
    if (missing) { bucket.missingCert += 1; all.missingCert += 1 }
    if (bucket === tiers.high) {
      const pt = String(row.protectionType || '').trim()
      if (tiers.high.byProtection[pt] !== undefined) tiers.high.byProtection[pt] += 1
    } else if (bucket === tiers.medium) {
      const g = String(row.category || '').trim() || '未分二级'
      mediumGroupCounts[g] = (mediumGroupCounts[g] || 0) + 1
    }
  })

  // 构成按件数降序（前端直接 wx:for，不再自己排一次 —— 排序规则两处各写一遍必然不一致）
  tiers.medium.byGroup = Object.keys(mediumGroupCounts)
    .map((name) => ({ name, count: mediumGroupCounts[name] }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'))

  return { success: true, scanned, truncated, all, tiers, generatedAtMs: Date.now() }
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
  // 「动物馆」分类子树 id（中等风险的**唯一**判据）：
  //   · riskFilter = medium / normal → 筛条件的**一部分**，必须查；
  //   · withRiskMeta（风险管理模块的清单）→ 要给每件标 riskTier / riskBasis，也要查。
  // 其余情况（藏品明细的普通浏览）不查 —— 保持与改前逐字一致，不为一个不用到的字段多打一次库。
  const needRiskMeta = !!(event && event.withRiskMeta)
  const riskFilterRaw = String((event && event.riskFilter) || '').trim()
  let animalHallCategoryIds = []
  if (needRiskMeta || riskFilterRaw === 'medium' || riskFilterRaw === 'normal') {
    animalHallCategoryIds = await loadAnimalHallCategoryIds()
  }
  const { where, promoFilter, keyword } = buildListWhere(event, actor, verifiedFramerId, animalHallCategoryIds)
  const needsMemoryPromo =
    promoFilter === 'seckill' || promoFilter === 'seckill_expired'
  const now = Date.now()

  const { rows: scannedRows, scanned, truncated } = await scanProducts(where)
  const matched = needsMemoryPromo
    ? scannedRows.filter((row) => matchesPromoFilter(row, promoFilter, now))
    : scannedRows

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
  const list = (attachAll ? withStatus.slice(skip, skip + pageSize) : withStatus).map((row) => {
    const out = {
      ...row,
      tags: readProductTags(row),
      giftScenes: readGiftScenes(row)
    }
    // 风险管理模块的清单：带上「为什么算风险」—— 店主自己就能核，不用来问口径
    if (needRiskMeta) {
      out.riskTier = riskTierOf(row, animalHallCategoryIds)
      out.riskBasis = riskBasisOf(row, animalHallCategoryIds)
      out.certMissing = isCertMissing(row)
    }
    return out
  })
  const shelfCounts = computeShelfCounts(attachAll ? withStatus : ordered)
  return {
    success: true,
    list,
    total,
    page,
    pageSize,
    sortBy,
    scanned,
    truncated,
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
  // riskOverview（2026-10-14）与 list 是**同一片数据的只读视图**，所以鉴权面与之逐字对齐 ——
  // 多一条更严的判定会出现「能打开藏品库、看得见清单，却读不到概览」这种半通不通的状态。
  if (!access.ok && (action === 'list' || action === 'riskOverview' || action === 'backfillMineLinks')) {
    access = await assertStaff(db, openid, { role: ROLE_STAFF, permission: 'manageArtisanWorks', adminOpsKey })
      .then((guard) => (guard.ok ? { ok: true, actor: { ...guard.actor, openid } } : { ok: false, code: guard.code, msg: guard.msg }))
  }
  if (!access.ok) return fail(access.msg || '无权限', access.code)

  try {
    switch (action) {
      case 'list':
        return await listProducts(event, access.actor)
      case 'riskOverview':
        // 只读：风险管理模块的分层概览（不写库、不改任何既有 action 的入参语义）
        return await riskOverview(event, access.actor)
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
