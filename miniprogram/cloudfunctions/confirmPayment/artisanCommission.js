/**
 * 标本师销售提成 — 多规则匹配 / 销售额口径 / 入账与冲正
 *
 * 销售额口径（goodsPaid）：
 *   订单商品实付 = max(0, goodsPrice - customExtraPrice)
 *   若缺 goodsPrice：用 max(0, totalPrice - shippingFee - customExtraPrice)
 *   行分摊：按行目录价(price×count)占商品目录价合计的比例，分摊商品实付
 *   不含运费；定制加价不计入提成基数
 *
 * 多规则优先级（命中时取最高档，同档取 priority 更大）：
 *   商品级 (300) > 类目/工艺/标本师范围级 (200) > 默认规则 (100)
 * 无匹配维度的规则永不命中（禁止裸奔全站计提）
 */

const COL_CONFIG = 'artisan_commission_config'
const COL_LEDGER = 'artisan_commission_ledger'
const DEFAULT_RATE = 0.1
const DEFAULT_CRAFT_TYPES = ['wing_art']
const DEFAULT_RULE_NAME = '默认提成 · 蝶翅画'

const TIER_PRODUCT = 300
const TIER_SCOPE = 200
const TIER_DEFAULT = 100

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function uniqStrings(list) {
  const seen = {}
  const out = []
  ;(Array.isArray(list) ? list : []).forEach((v) => {
    const s = String(v || '').trim()
    if (!s || seen[s]) return
    seen[s] = true
    out.push(s)
  })
  return out
}

function clampRate(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_RATE
  if (n > 1) {
    // 允许超管填 10 表示 10%
    if (n <= 100) return round2(n / 100)
    return 1
  }
  return round2(n)
}

function clampPriority(raw, fallback) {
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback != null ? fallback : 100
  return Math.max(0, Math.min(9999, n))
}

function getDefaultRule() {
  return {
    enabled: true,
    name: DEFAULT_RULE_NAME,
    rate: DEFAULT_RATE,
    craftTypes: DEFAULT_CRAFT_TYPES.slice(),
    categoryIds: [],
    categoryTypes: [],
    productIds: [],
    artisanIds: [],
    isDefault: true,
    priority: 10,
    archived: false,
    basisNote:
      '商品实付分摊（会员折+券后，不含运费与定制加价）；默认蝶翅画 craftType=wing_art，比例 10%'
  }
}

function hasMatchDimensions(rule) {
  const r = rule || {}
  return (
    (r.craftTypes && r.craftTypes.length > 0) ||
    (r.categoryIds && r.categoryIds.length > 0) ||
    (r.categoryTypes && r.categoryTypes.length > 0) ||
    (r.productIds && r.productIds.length > 0) ||
    (r.artisanIds && r.artisanIds.length > 0)
  )
}

function normalizeRule(raw) {
  const base = getDefaultRule()
  const src = raw && typeof raw === 'object' ? raw : {}
  const rate =
    src.ratePercent != null && src.rate == null
      ? clampRate(Number(src.ratePercent) / 100)
      : clampRate(src.rate != null ? src.rate : base.rate)

  const craftTypes = uniqStrings(
    src.craftTypes != null ? src.craftTypes : src.isDefault === false ? [] : base.craftTypes
  )
  const categoryIds = uniqStrings(src.categoryIds)
  const categoryTypes = uniqStrings(src.categoryTypes)
  const productIds = uniqStrings(src.productIds)
  const artisanIds = uniqStrings(src.artisanIds)

  const isDefault = src.isDefault === true
  // 非默认且未显式给 craftTypes 时，旧单规则可能依赖默认 wing_art；迁移时保留已有字段
  const rule = {
    enabled: src.enabled !== false,
    name: String(src.name || (isDefault ? base.name : '标本师销售提成')).trim() || base.name,
    rate,
    craftTypes,
    categoryIds,
    categoryTypes,
    productIds,
    artisanIds,
    isDefault,
    priority: clampPriority(src.priority, isDefault ? 10 : 100),
    archived: src.archived === true,
    basisNote: String(src.basisNote || base.basisNote).trim() || base.basisNote
  }

  // 默认规则若被清空维度，回填蝶翅画，避免裸奔
  if (rule.isDefault && !hasMatchDimensions(rule)) {
    rule.craftTypes = DEFAULT_CRAFT_TYPES.slice()
  }

  return rule
}

function describeRule(rule) {
  const r = normalizeRule(rule)
  if (r.archived) return '已归档'
  if (!r.enabled) return '已关闭'
  const pct = `${round2(r.rate * 100)}%`
  const scopes = []
  if (r.isDefault) scopes.push('默认')
  if (r.productIds.length) scopes.push(`商品 ${r.productIds.length} 件`)
  if (r.craftTypes.length) scopes.push(`工艺 ${r.craftTypes.join('/')}`)
  if (r.categoryIds.length) scopes.push(`类目 ${r.categoryIds.length} 个`)
  if (r.categoryTypes.length) scopes.push(`品类 ${r.categoryTypes.join('/')}`)
  if (r.artisanIds.length) scopes.push(`标本师 ${r.artisanIds.length} 位`)
  const scopeText = scopes.length ? scopes.join(' · ') : '未配置范围'
  return `${pct} · ${scopeText}`
}

function describeRuleBrief(rule) {
  const r = normalizeRule(rule)
  const scopes = []
  if (r.productIds.length) scopes.push(`${r.productIds.length} 商品`)
  if (r.craftTypes.length) {
    scopes.push(
      r.craftTypes
        .slice(0, 3)
        .map((c) => c)
        .join('/')
    )
  }
  if (r.categoryIds.length) scopes.push(`${r.categoryIds.length} 类目`)
  if (r.artisanIds.length) scopes.push(`${r.artisanIds.length} 标本师`)
  if (r.isDefault && !scopes.length) scopes.push('默认蝶翅画')
  return scopes.slice(0, 3).join(' · ') || '未配置范围'
}

function productIdOf(line) {
  return String((line && (line.id || line.productId || line._id)) || '').trim()
}

function resolveArtisanFromLine(line) {
  if (!line) return null
  const artisanId = String(
    line.framerId ||
      line.artisanId ||
      (line.framer && (line.framer.framerId || line.framer.id || line.framer._id)) ||
      ''
  ).trim()
  const artisanOpenid = String(
    line.artisanOpenid ||
      line.framerOpenid ||
      line.staffOpenid ||
      (line.framer && (line.framer.staffOpenid || line.framer.openid)) ||
      ''
  ).trim()
  const artisanName = String(
    line.framerName ||
      line.artisanName ||
      (line.framer && line.framer.name) ||
      ''
  ).trim()
  if (!artisanId && !artisanOpenid) return null
  return { artisanId, artisanOpenid, artisanName }
}

function artisanMatchesRule(line, rule) {
  const ids = uniqStrings(rule && rule.artisanIds)
  if (!ids.length) return true
  const artisan = resolveArtisanFromLine(line)
  const aid = artisan && artisan.artisanId
  if (!aid) return false
  return ids.indexOf(aid) !== -1
}

/**
 * 计算规则对某行的命中档位；不命中返回 null
 */
function evaluateRuleMatch(line, rule) {
  const r = normalizeRule(rule)
  if (!r.enabled || r.archived) return null
  if (!hasMatchDimensions(r)) return null
  if (!artisanMatchesRule(line, r)) return null

  const pid = productIdOf(line)
  const productHit = !!(pid && r.productIds.length && r.productIds.indexOf(pid) !== -1)

  const craft = String((line && line.craftType) || '').trim()
  const craftProcess = String((line && line.craftProcess) || '').trim()
  const craftHit = !!(
    r.craftTypes.length &&
    ((craft && r.craftTypes.indexOf(craft) !== -1) ||
      (craftProcess && r.craftTypes.indexOf(craftProcess) !== -1))
  )

  const catId = String((line && (line.categoryId || line.rootCategoryId)) || '').trim()
  const catIdHit = !!(catId && r.categoryIds.length && r.categoryIds.indexOf(catId) !== -1)

  const catType = String((line && line.categoryType) || '').trim()
  const catTypeHit = !!(
    catType &&
    r.categoryTypes.length &&
    r.categoryTypes.indexOf(catType) !== -1
  )

  const artisanOnly =
    r.artisanIds.length > 0 &&
    !r.productIds.length &&
    !r.craftTypes.length &&
    !r.categoryIds.length &&
    !r.categoryTypes.length

  const anyHit = productHit || craftHit || catIdHit || catTypeHit || artisanOnly
  if (!anyHit) return null

  let tier = TIER_SCOPE
  if (r.isDefault) {
    tier = TIER_DEFAULT
  } else if (productHit) {
    tier = TIER_PRODUCT
  } else {
    tier = TIER_SCOPE
  }

  return {
    tier,
    priority: r.priority,
    productHit,
    craftHit,
    catIdHit,
    catTypeHit
  }
}

/** @deprecated 单规则时代 API；多规则下表示「是否命中该条」 */
function productMatchesRule(line, rule) {
  return !!evaluateRuleMatch(line, rule)
}

/**
 * 在规则列表中按优先级选出命中规则
 * 商品级 > 类目/工艺/标本师级 > 默认；同档 priority 大者优先，再比 updateTime
 */
function pickMatchingRule(line, rules) {
  let best = null
  let bestMeta = null
  ;(rules || []).forEach((rule) => {
    const meta = evaluateRuleMatch(line, rule)
    if (!meta) return
    if (!best) {
      best = rule
      bestMeta = meta
      return
    }
    if (meta.tier > bestMeta.tier) {
      best = rule
      bestMeta = meta
      return
    }
    if (meta.tier < bestMeta.tier) return
    if (meta.priority > bestMeta.priority) {
      best = rule
      bestMeta = meta
      return
    }
    if (meta.priority < bestMeta.priority) return
    const tNew = Number(rule.updateTime) || 0
    const tOld = Number(best.updateTime) || 0
    if (tNew > tOld) {
      best = rule
      bestMeta = meta
    }
  })
  if (!best) return null
  return { rule: normalizeRule(best), docId: best._id || best.docId || '', match: bestMeta }
}

/** 商品实付（不含运费、不含定制加价） */
function resolveGoodsPaidYuan(order) {
  const customExtra = Math.max(0, Number(order && order.customExtraPrice) || 0)
  const shipping = Math.max(0, Number(order && order.shippingFee) || 0)
  if (order && order.goodsPrice != null && order.goodsPrice !== '') {
    return Math.max(0, round2(Number(order.goodsPrice) - customExtra))
  }
  const total = Math.max(0, Number(order && order.totalPrice) || 0)
  return Math.max(0, round2(total - shipping - customExtra))
}

function lineCatalogYuan(line) {
  const price = Number(line && line.price) || 0
  const count = Math.max(1, parseInt(line && line.count, 10) || 1)
  return round2(price * count)
}

function allocateLineSales(order, lines) {
  const rows = Array.isArray(lines) ? lines : []
  const catalogs = rows.map(lineCatalogYuan)
  const catalogSum = round2(catalogs.reduce((s, n) => s + n, 0))
  const goodsPaid = resolveGoodsPaidYuan(order)
  return rows.map((line, i) => {
    const catalog = catalogs[i]
    let sales = 0
    if (catalogSum > 0 && goodsPaid > 0) {
      sales = round2((goodsPaid * catalog) / catalogSum)
    } else if (catalog > 0) {
      sales = catalog
    }
    return { line, lineIndex: i, catalogAmount: catalog, salesAmount: sales }
  })
}

function isMissingCollectionError(err) {
  return /502005|DATABASE_COLLECTION_NOT_EXIST|COLLECTION_NOT_EXIST|collection not exist|集合不存在|not exist/i.test(
    String((err && (err.errMsg || err.message)) || err || '')
  )
}

function isCollectionExistsError(err) {
  return /already exist|already exists|COLLECTION_EXIST|ResourceExist|-501001/i.test(
    String((err && (err.errMsg || err.message)) || err || '')
  )
}

async function ensureCollection(db, name) {
  try {
    await db.createCollection(name)
  } catch (err) {
    if (!isCollectionExistsError(err)) throw err
  }
}

async function withCollectionRetry(db, collectionName, fn) {
  try {
    return await fn()
  } catch (err) {
    if (!isMissingCollectionError(err)) throw err
    await ensureCollection(db, collectionName)
    return await fn()
  }
}

function attachRuleDoc(doc) {
  if (!doc) return null
  const rule = normalizeRule(doc)
  return {
    ...rule,
    _id: doc._id,
    docId: doc._id,
    ratePercent: round2(rule.rate * 100),
    ruleText: describeRule(rule),
    scopeBrief: describeRuleBrief(rule),
    updateTime: doc.updateTime || 0,
    createTime: doc.createTime || 0,
    fromLegacy: doc.isDefault == null && doc.priority == null && doc.archived == null
  }
}

async function fetchRuleDocs(db, { includeArchived = false } = {}) {
  try {
    const res = await db.collection(COL_CONFIG).limit(100).get()
    let rows = res.data || []
    if (!includeArchived) {
      rows = rows.filter((d) => d && d.archived !== true)
    }
    rows.sort(
      (a, b) =>
        (Number(b.isDefault) || 0) - (Number(a.isDefault) || 0) ||
        (Number(b.priority) || 0) - (Number(a.priority) || 0) ||
        (Number(b.updateTime) || 0) - (Number(a.updateTime) || 0) ||
        String(b._id).localeCompare(String(a._id))
    )
    return rows
  } catch (err) {
    if (isMissingCollectionError(err)) return []
    throw err
  }
}

/**
 * 平滑迁移：旧单规则文档补齐多规则字段；若无默认规则则写入预置默认
 */
async function migrateAndEnsureDefault(db, docs) {
  const rows = Array.isArray(docs) ? docs.slice() : []
  const now = Date.now()

  for (const doc of rows) {
    if (!doc || !doc._id) continue
    const needsMigrate =
      doc.isDefault == null ||
      doc.priority == null ||
      doc.archived == null ||
      !Array.isArray(doc.artisanIds)
    if (!needsMigrate) continue
    const normalized = normalizeRule({
      ...doc,
      isDefault: doc.isDefault === true,
      priority: doc.priority != null ? doc.priority : doc.isDefault ? 10 : 100,
      archived: doc.archived === true,
      artisanIds: doc.artisanIds || []
    })
    // 旧唯一规则若恰好是蝶翅画 10%，标为默认，避免再插一条重复默认
    const looksLikeSeedDefault =
      rows.length === 1 &&
      Math.abs(normalized.rate - DEFAULT_RATE) < 0.0001 &&
      normalized.craftTypes.length === 1 &&
      normalized.craftTypes[0] === 'wing_art' &&
      !normalized.productIds.length &&
      !normalized.categoryIds.length &&
      !normalized.artisanIds.length
    const patch = {
      ...normalized,
      isDefault: looksLikeSeedDefault ? true : normalized.isDefault === true,
      ratePercent: round2(normalized.rate * 100),
      updateTime: doc.updateTime || now,
      migratedAt: now
    }
    try {
      await db.collection(COL_CONFIG).doc(doc._id).update({ data: patch })
      Object.assign(doc, patch)
    } catch (e) {
      console.warn('migrate rule doc failed', doc._id, e && e.message)
    }
  }

  const active = rows.filter((d) => d && d.archived !== true)
  const hasDefault = active.some((d) => d.isDefault === true)
  if (!hasDefault) {
    const seed = {
      ...getDefaultRule(),
      ratePercent: round2(DEFAULT_RATE * 100),
      createTime: now,
      updateTime: now,
      createdBy: 'system_migrate',
      updatedBy: 'system_migrate'
    }
    try {
      const added = await withCollectionRetry(db, COL_CONFIG, () =>
        db.collection(COL_CONFIG).add({ data: seed })
      )
      rows.push({ ...seed, _id: added._id })
    } catch (e) {
      console.warn('ensure default rule failed', e && e.message)
    }
  }

  return rows
}

async function loadRules(db, options = {}) {
  const includeArchived = !!(options && options.includeArchived)
  let docs = await fetchRuleDocs(db, { includeArchived: true })
  docs = await migrateAndEnsureDefault(db, docs)
  if (!includeArchived) {
    docs = docs.filter((d) => d && d.archived !== true)
  }
  docs.sort(
    (a, b) =>
      (Number(b.isDefault) || 0) - (Number(a.isDefault) || 0) ||
      (Number(b.priority) || 0) - (Number(a.priority) || 0) ||
      (Number(b.updateTime) || 0) - (Number(a.updateTime) || 0) ||
      String(b._id).localeCompare(String(a._id))
  )
  const rules = docs.map(attachRuleDoc).filter(Boolean)
  return {
    rules,
    fromDefault: !docs.length,
    defaultRule: rules.find((r) => r.isDefault) || null
  }
}

/** 兼容旧调用：返回默认规则或第一条 */
async function loadRuleDoc(db) {
  const { rules } = await loadRules(db)
  if (!rules.length) return null
  const def = rules.find((r) => r.isDefault)
  return def || rules[0]
}

async function loadRule(db) {
  const doc = await loadRuleDoc(db)
  if (!doc) {
    return {
      rule: normalizeRule(getDefaultRule()),
      docId: '',
      fromDefault: true
    }
  }
  return {
    rule: normalizeRule(doc),
    docId: doc._id || doc.docId || '',
    fromDefault: false
  }
}

async function enrichLinesFromProducts(db, _, lines) {
  const needIds = []
  ;(lines || []).forEach((line) => {
    const artisan = resolveArtisanFromLine(line)
    const craft = String((line && line.craftType) || '').trim()
    const catId = String((line && line.categoryId) || '').trim()
    const pid = productIdOf(line)
    if (pid && (!artisan || !craft || !catId)) needIds.push(pid)
  })
  const ids = uniqStrings(needIds)
  if (!ids.length) return lines || []

  const map = {}
  const chunk = 20
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk)
    try {
      const res = await db.collection('products').where({ _id: _.in(slice) }).get()
      ;(res.data || []).forEach((p) => {
        if (p && p._id) map[p._id] = p
      })
    } catch (e) {
      console.warn('enrichLinesFromProducts', e && e.message)
    }
  }

  return (lines || []).map((line) => {
    const pid = productIdOf(line)
    const p = pid ? map[pid] : null
    if (!p) return line
    return {
      ...line,
      craftType: line.craftType || p.craftType || '',
      craftProcess: line.craftProcess || p.craftProcess || '',
      categoryId: line.categoryId || p.categoryId || '',
      categoryType: line.categoryType || p.categoryType || '',
      rootCategoryId: line.rootCategoryId || p.rootCategoryId || '',
      rootCategoryName: line.rootCategoryName || p.rootCategoryName || '',
      framerId: line.framerId || p.framerId || '',
      framerName: line.framerName || p.framerName || '',
      artisanOpenid: line.artisanOpenid || p.staffOpenid || ''
    }
  })
}

async function resolveArtisanOpenid(db, artisan) {
  if (!artisan) return artisan
  if (artisan.artisanOpenid) return artisan
  const id = String(artisan.artisanId || '').trim()
  if (!id) return artisan
  try {
    const res = await db.collection('framers').doc(id).get()
    const row = res.data
    if (!row) return artisan
    return {
      artisanId: id,
      artisanOpenid: String(row.staffOpenid || row.openid || '').trim(),
      artisanName: artisan.artisanName || String(row.name || '').trim()
    }
  } catch (e) {
    return artisan
  }
}

async function findByDedupeKey(db, dedupeKey) {
  try {
    const res = await db
      .collection(COL_LEDGER)
      .where({ dedupeKey: String(dedupeKey) })
      .limit(1)
      .get()
    return (res.data && res.data[0]) || null
  } catch (err) {
    if (isMissingCollectionError(err)) return null
    throw err
  }
}

/**
 * 支付成功入账（幂等）— 按行匹配多规则
 */
async function postCommissionForOrder(db, _, order, options = {}) {
  if (!order || !order._id) {
    return { success: false, skipped: true, msg: '订单无效' }
  }
  if (order.artisanCommissionPosted) {
    return { success: true, skipped: true, alreadyPosted: true, posted: 0 }
  }

  const loaded = await loadRules(db)
  const rules = (loaded.rules || []).filter((r) => r.enabled && !r.archived)
  if (!rules.length) {
    return { success: true, skipped: true, msg: '无启用中的提成规则', posted: 0 }
  }

  let lines = Array.isArray(order.products) ? order.products.slice() : []
  lines = await enrichLinesFromProducts(db, _, lines)
  const allocated = allocateLineSales(order, lines)

  const posted = []
  const skipped = []

  for (const row of allocated) {
    const { line, lineIndex, salesAmount } = row
    const hit = pickMatchingRule(line, rules)
    if (!hit) {
      skipped.push({ lineIndex, reason: 'not_in_scope' })
      continue
    }
    const rule = hit.rule
    let artisan = resolveArtisanFromLine(line)
    artisan = await resolveArtisanOpenid(db, artisan)
    if (!artisan || (!artisan.artisanId && !artisan.artisanOpenid)) {
      skipped.push({ lineIndex, reason: 'no_artisan' })
      continue
    }
    if (!(salesAmount > 0)) {
      skipped.push({ lineIndex, reason: 'zero_sales' })
      continue
    }

    const amount = round2(salesAmount * rule.rate)
    if (!(amount > 0)) {
      skipped.push({ lineIndex, reason: 'zero_commission' })
      continue
    }

    const dedupeKey = `${order._id}:${lineIndex}:earn`
    const existing = await findByDedupeKey(db, dedupeKey)
    if (existing) {
      posted.push({ id: existing._id, dedupeKey, duplicated: true })
      continue
    }

    const doc = {
      type: 'earn',
      status: 'posted',
      reversed: false,
      orderId: order._id,
      orderNo: order.orderNo || '',
      productId: productIdOf(line),
      productTitle: String(line.title || line.name || '').trim(),
      lineIndex,
      craftType: String(line.craftType || '').trim(),
      categoryId: String(line.categoryId || '').trim(),
      artisanId: artisan.artisanId || '',
      artisanOpenid: artisan.artisanOpenid || '',
      artisanName: artisan.artisanName || '',
      salesAmount,
      rate: rule.rate,
      amount,
      dedupeKey,
      paidAt: order.paidTime || Date.now(),
      createTime: Date.now(),
      source: options.source || 'fulfill',
      ruleId: hit.docId || '',
      ruleSnapshot: {
        name: rule.name,
        rate: rule.rate,
        isDefault: !!rule.isDefault,
        priority: rule.priority,
        matchTier: hit.match && hit.match.tier,
        craftTypes: rule.craftTypes,
        categoryIds: rule.categoryIds,
        productIds: rule.productIds,
        artisanIds: rule.artisanIds
      }
    }

    const added = await withCollectionRetry(db, COL_LEDGER, () =>
      db.collection(COL_LEDGER).add({ data: doc })
    )
    posted.push({
      id: added._id,
      dedupeKey,
      amount,
      artisanId: artisan.artisanId,
      ruleId: hit.docId,
      ruleName: rule.name
    })
  }

  try {
    await db.collection('orders').doc(order._id).update({
      data: {
        artisanCommissionPosted: true,
        artisanCommissionPostedAt: db.serverDate(),
        artisanCommissionCount: posted.length
      }
    })
  } catch (e) {
    console.warn('mark artisanCommissionPosted failed', e && e.message)
  }

  return {
    success: true,
    posted: posted.length,
    entries: posted,
    skipped
  }
}

/**
 * 退款冲正：按订单全额冲正未冲正的 earn（唯一标本场景为主；幂等）
 */
async function reverseCommissionForOrder(db, _, order, options = {}) {
  if (!order || !order._id) {
    return { success: false, skipped: true, msg: '订单无效' }
  }
  if (order.artisanCommissionReversed) {
    return { success: true, skipped: true, alreadyReversed: true, reversed: 0 }
  }

  let earns = []
  try {
    const res = await db
      .collection(COL_LEDGER)
      .where({
        orderId: order._id,
        type: 'earn',
        reversed: false
      })
      .limit(100)
      .get()
    earns = res.data || []
  } catch (err) {
    if (isMissingCollectionError(err)) {
      return { success: true, skipped: true, msg: '无流水集合', reversed: 0 }
    }
    throw err
  }

  if (!earns.length) {
    try {
      await db.collection('orders').doc(order._id).update({
        data: {
          artisanCommissionReversed: true,
          artisanCommissionReversedAt: db.serverDate()
        }
      })
    } catch (e) { /* ignore */ }
    return { success: true, skipped: true, msg: '无待冲正流水', reversed: 0 }
  }

  const created = []
  for (const earn of earns) {
    const dedupeKey = `${order._id}:${earn.lineIndex}:reverse`
    const existing = await findByDedupeKey(db, dedupeKey)
    if (existing) {
      created.push({ id: existing._id, duplicated: true })
      continue
    }
    const amount = -Math.abs(Number(earn.amount) || 0)
    const doc = {
      type: 'reverse',
      status: 'posted',
      reversed: false,
      orderId: order._id,
      orderNo: order.orderNo || earn.orderNo || '',
      productId: earn.productId || '',
      productTitle: earn.productTitle || '',
      lineIndex: earn.lineIndex,
      craftType: earn.craftType || '',
      categoryId: earn.categoryId || '',
      artisanId: earn.artisanId || '',
      artisanOpenid: earn.artisanOpenid || '',
      artisanName: earn.artisanName || '',
      salesAmount: -(Math.abs(Number(earn.salesAmount) || 0)),
      rate: earn.rate,
      amount,
      dedupeKey,
      relatedEarnId: earn._id,
      ruleId: earn.ruleId || '',
      paidAt: Date.now(),
      createTime: Date.now(),
      source: options.source || 'refund',
      refundFee: options.refundFee != null ? options.refundFee : order.refundFee
    }
    const added = await withCollectionRetry(db, COL_LEDGER, () =>
      db.collection(COL_LEDGER).add({ data: doc })
    )
    try {
      await db.collection(COL_LEDGER).doc(earn._id).update({
        data: { reversed: true, reversedAt: Date.now(), reverseLedgerId: added._id }
      })
    } catch (e) {
      console.warn('mark earn reversed failed', e && e.message)
    }
    created.push({ id: added._id, amount, relatedEarnId: earn._id })
  }

  try {
    await db.collection('orders').doc(order._id).update({
      data: {
        artisanCommissionReversed: true,
        artisanCommissionReversedAt: db.serverDate(),
        artisanCommissionReverseCount: created.length
      }
    })
  } catch (e) {
    console.warn('mark artisanCommissionReversed failed', e && e.message)
  }

  return { success: true, reversed: created.length, entries: created }
}

/**
 * 关联标本师：商品/SKU 售出工作信息（workflow 队列）
 * 按标本师聚合，一单一人一条；依赖 dispatchMessage dedupeKey 幂等
 */
async function notifyArtisanSkuSold(db, _, order, dispatchInAppMessage, options = {}) {
  if (!order || !order._id) {
    return { success: false, skipped: true, msg: '订单无效' }
  }
  if (order.artisanSoldNotified) {
    return { success: true, skipped: true, alreadyNotified: true, count: 0 }
  }

  let lines = Array.isArray(order.products) ? order.products.slice() : []
  lines = await enrichLinesFromProducts(db, _, lines)

  /** @type {Record<string, { openid: string, artisanId: string, artisanName: string, titles: string[], skuHints: string[] }>} */
  const byOpenid = {}

  for (const line of lines) {
    let artisan = resolveArtisanFromLine(line)
    artisan = await resolveArtisanOpenid(db, artisan)
    if (!artisan || !artisan.artisanOpenid) continue

    const openid = artisan.artisanOpenid
    if (!byOpenid[openid]) {
      byOpenid[openid] = {
        openid,
        artisanId: artisan.artisanId || '',
        artisanName: artisan.artisanName || '',
        titles: [],
        skuHints: []
      }
    }
    const title = String(line.title || line.name || '藏品').trim() || '藏品'
    const skuLabel = String(line.skuLabel || line.skuId || '').trim()
    const count = Math.max(1, parseInt(line.count, 10) || 1)
    let label = title
    if (skuLabel) label = `${title}（${skuLabel}）`
    if (count > 1) label = `${label} ×${count}`
    if (byOpenid[openid].titles.indexOf(label) === -1) {
      byOpenid[openid].titles.push(label)
    }
  }

  const recipients = Object.keys(byOpenid)
  if (!recipients.length) {
    try {
      await db.collection('orders').doc(order._id).update({
        data: {
          artisanSoldNotified: true,
          artisanSoldNotifyCount: 0,
          artisanSoldNotifiedAt: db.serverDate()
        }
      })
    } catch (e) { /* ignore */ }
    return { success: true, skipped: true, msg: '无关联标本师', count: 0 }
  }

  const orderNo = order.orderNo || ''
  const results = []
  for (const openid of recipients) {
    const row = byOpenid[openid]
    const productNames = row.titles.slice(0, 3).join('、')
    const more =
      row.titles.length > 3 ? `等 ${row.titles.length} 件` : ''
    const vars = {
      orderNo,
      productNames: productNames + more,
      artisanName: row.artisanName || ''
    }
    try {
      let r
      if (typeof dispatchInAppMessage === 'function') {
        r = await dispatchInAppMessage(db, {
          eventType: 'staff_artisan_sku_sold',
          openid,
          relatedId: order._id,
          vars
        })
      } else {
        const cloud = require('wx-server-sdk')
        const res = await cloud.callFunction({
          name: 'dispatchMessage',
          data: {
            action: 'dispatch',
            eventType: 'staff_artisan_sku_sold',
            openid,
            relatedId: order._id,
            vars
          }
        })
        r = (res && res.result) || { success: false }
      }
      results.push({ openid, artisanId: row.artisanId, result: r })
    } catch (err) {
      console.warn('artisan sku sold notify failed', openid, err && err.message)
      results.push({ openid, artisanId: row.artisanId, error: err && err.message })
    }
  }

  try {
    await db.collection('orders').doc(order._id).update({
      data: {
        artisanSoldNotified: true,
        artisanSoldNotifyCount: results.length,
        artisanSoldNotifiedAt: db.serverDate()
      }
    })
  } catch (e) {
    console.warn('mark artisanSoldNotified failed', e && e.message)
  }

  return {
    success: true,
    count: results.length,
    results,
    source: options.source || 'fulfill'
  }
}

function validateRuleForSave(raw, { requireDefaultScope = true } = {}) {
  const rule = normalizeRule(raw)
  if (!hasMatchDimensions(rule)) {
    return { ok: false, msg: '请至少配置工艺、类目、商品或标本师之一，禁止无范围规则' }
  }
  if (rule.isDefault && requireDefaultScope && !hasMatchDimensions(rule)) {
    return { ok: false, msg: '默认规则必须保留匹配范围（如蝶翅画）' }
  }
  if (!(rule.rate >= 0 && rule.rate <= 1)) {
    return { ok: false, msg: '分成比例无效' }
  }
  return { ok: true, rule }
}

module.exports = {
  COL_CONFIG,
  COL_LEDGER,
  DEFAULT_RATE,
  DEFAULT_CRAFT_TYPES,
  DEFAULT_RULE_NAME,
  TIER_PRODUCT,
  TIER_SCOPE,
  TIER_DEFAULT,
  getDefaultRule,
  normalizeRule,
  describeRule,
  describeRuleBrief,
  hasMatchDimensions,
  clampRate,
  clampPriority,
  round2,
  productMatchesRule,
  evaluateRuleMatch,
  pickMatchingRule,
  resolveGoodsPaidYuan,
  allocateLineSales,
  loadRule,
  loadRuleDoc,
  loadRules,
  attachRuleDoc,
  validateRuleForSave,
  postCommissionForOrder,
  reverseCommissionForOrder,
  notifyArtisanSkuSold,
  withCollectionRetry,
  ensureCollection,
  isMissingCollectionError
}
