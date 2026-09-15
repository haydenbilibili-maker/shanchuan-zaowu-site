/**
 * 存量商品补标签：只写 tags 为空/缺失的文档，不覆盖已有标签。
 * 优先 assistProductCopy，失败重试一次，再兜底 fallbackTags。
 */
const {
  sanitizeProductTags,
  fallbackTags,
  hasNonEmptyTags,
  looksLikeMerch
} = require('./productTags')

const SCAN_PAGE = 50
const DEFAULT_LIMIT = 5
const MAX_LIMIT = 8
const AI_RETRIES = 2

function fail(msg, code) {
  return { success: false, msg, code: code || 'FAIL' }
}

function isSuperActor(actor) {
  return !!(actor && (actor.superAdmin || actor.workspaceRole === 'super_admin'))
}

async function generateTagsForProduct(cloud, row) {
  const title = String((row && (row.title || row.name)) || '').trim()
  if (!title) return { ok: false, msg: '无名称', tags: [] }

  let lastErr = ''
  for (let attempt = 0; attempt < AI_RETRIES; attempt += 1) {
    try {
      const res = await cloud.callFunction({
        name: 'assistProductCopy',
        data: {
          title,
          category: row.category || '',
          rootCategory: row.rootCategoryName || '',
          origin: row.origin || ''
        }
      })
      const result = (res && res.result) || {}
      if (result.success) {
        const tags = sanitizeProductTags(result.data && result.data.tags)
        if (tags.length) return { ok: true, tags, source: 'ai' }
        lastErr = 'AI 未返回标签'
      } else {
        lastErr = result.msg || 'AI 失败'
      }
    } catch (e) {
      lastErr = (e && e.message) || 'AI 调用异常'
    }
  }

  const fallback = fallbackTags({
    title,
    latinName: row.latinName,
    rootCategory: row.rootCategoryName,
    category: row.category,
    merch: looksLikeMerch(row)
  })
  if (fallback.length) {
    return { ok: true, tags: fallback, source: 'fallback', warn: lastErr }
  }
  return { ok: false, msg: lastErr || '无法生成标签', tags: [] }
}

async function scanMissingTagStats(db) {
  let offset = 0
  let total = 0
  let missing = 0
  let skipped = 0
  while (offset < 5000) {
    const res = await db.collection('products').orderBy('createTime', 'asc').skip(offset).limit(100).get()
    const rows = res.data || []
    if (!rows.length) break
    rows.forEach((row) => {
      total += 1
      if (hasNonEmptyTags(row)) skipped += 1
      else missing += 1
    })
    offset += rows.length
    if (rows.length < 100) break
  }
  return { total, missing, skipped }
}

async function backfillProductTags(event, actor, { cloud, db }) {
  if (!isSuperActor(actor)) return fail('仅超管可回填标签', 'FORBIDDEN')

  if (event && event.scanOnly) {
    const stats = await scanMissingTagStats(db)
    return { success: true, scanOnly: true, ...stats, done: true }
  }

  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(event && event.limit, 10) || DEFAULT_LIMIT))
  let offset = Math.max(0, parseInt(event && event.offset, 10) || 0)
  const dryRun = !!(event && event.dryRun)

  let scanned = 0
  let skipped = 0
  let filled = 0
  let failed = 0
  const failures = []
  const samples = []
  let processed = 0
  let hasMore = true

  while (processed < limit && hasMore) {
    const page = await db.collection('products')
      .orderBy('createTime', 'asc')
      .skip(offset + scanned)
      .limit(SCAN_PAGE)
      .get()
    const rows = page.data || []
    if (!rows.length) {
      hasMore = false
      break
    }

    for (const row of rows) {
      scanned += 1
      if (hasNonEmptyTags(row)) {
        skipped += 1
        continue
      }
      if (processed >= limit) {
        scanned -= 1
        hasMore = true
        break
      }

      const productId = String(row._id || '')
      const title = String(row.title || row.name || '').trim()
      const gen = await generateTagsForProduct(cloud, row)
      if (!gen.ok || !gen.tags.length) {
        failed += 1
        if (failures.length < 20) {
          failures.push({ productId, title, msg: gen.msg || '失败' })
        }
        processed += 1
        continue
      }

      if (!dryRun) {
        try {
          await db.collection('products').doc(productId).update({
            data: {
              tags: gen.tags,
              tagsBackfilledAt: Date.now(),
              tagsBackfillSource: gen.source
            }
          })
        } catch (e) {
          failed += 1
          if (failures.length < 20) {
            failures.push({ productId, title, msg: (e && e.message) || '写入失败' })
          }
          processed += 1
          continue
        }
      }

      filled += 1
      processed += 1
      if (samples.length < 8) {
        samples.push({ productId, title, tags: gen.tags, source: gen.source })
      }
    }

    if (rows.length < SCAN_PAGE && processed < limit) {
      hasMore = false
    }
  }

  const nextOffset = offset + scanned
  return {
    success: true,
    dryRun,
    scanned,
    skipped,
    filled,
    failed,
    processed,
    offset,
    nextOffset,
    hasMore,
    samples,
    failures
  }
}

module.exports = {
  backfillProductTags
}
