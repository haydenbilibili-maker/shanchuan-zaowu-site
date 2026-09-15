/**
 * RFM 受众解析 — 与 manageMemberCrm 同源采样与 buildProfile
 */
const {
  buildProfile,
  SEGMENTS,
  isActiveProfile,
  isHighValueSegment
} = require('./segmentation')

const FETCH_CAP = 1000
const PREVIEW_CAP = 500

const CAMPAIGN_RECALL_SEGMENTS = new Set([
  'never_purchased',
  'about_to_sleep',
  'need_attention',
  'at_risk',
  'cant_lose',
  'hibernating',
  'lost'
])

const CAMPAIGN_CONVERSION_SEGMENTS = new Set([
  'new_customers',
  'promising',
  'potential_loyal',
  'champions',
  'loyal'
])

async function fetchCollectionSorted(db, name, limit) {
  const PAGE = 100
  const rows = []
  let skip = 0
  while (rows.length < limit) {
    const take = Math.min(PAGE, limit - rows.length)
    let query = db.collection(name).skip(skip).limit(take)
    try {
      if (name === 'users' || name === 'orders') {
        query = query.orderBy('createTime', 'desc')
      } else if (name === 'user_behaviors') {
        query = query.orderBy('createdAt', 'desc')
      }
    } catch (e) {
      /* no index */
    }
    let res
    try {
      res = await query.get()
    } catch (e) {
      try {
        res = await db.collection(name).skip(skip).limit(take).get()
      } catch (e2) {
        console.warn(`fetch ${name} failed:`, e2.message)
        break
      }
    }
    const batch = res.data || []
    rows.push(...batch)
    if (batch.length < take) break
    skip += batch.length
  }
  return rows
}

async function loadPortraitSourceData(db) {
  const [users, orders, behaviors] = await Promise.all([
    fetchCollectionSorted(db, 'users', FETCH_CAP),
    fetchCollectionSorted(db, 'orders', FETCH_CAP),
    fetchCollectionSorted(db, 'user_behaviors', FETCH_CAP)
  ])
  const dataCapped =
    users.length >= FETCH_CAP || orders.length >= FETCH_CAP || behaviors.length >= FETCH_CAP
  return { users, orders, behaviors, dataCapped }
}

function normalizeFilters(raw) {
  return {
    segment: String((raw && raw.segment) || '').trim(),
    campaignType: String((raw && raw.campaignType) || '').trim(),
    honoraryOnly: !!(raw && raw.honoraryOnly),
    activeOnly: !!(raw && raw.activeOnly),
    highValueOnly: !!(raw && raw.highValueOnly),
    minLevel: Math.max(0, parseInt(raw && raw.minLevel, 10) || 0)
  }
}

function segmentAllowedForCampaign(campaignType, segment) {
  if (!campaignType || campaignType === 'general') return true
  if (campaignType === 'recall') return CAMPAIGN_RECALL_SEGMENTS.has(segment)
  if (campaignType === 'conversion') return CAMPAIGN_CONVERSION_SEGMENTS.has(segment)
  return true
}

function applyAudienceFilters(profiles, filters) {
  let list = profiles || []
  const f = normalizeFilters(filters)

  if (f.segment) {
    list = list.filter((p) => p.segment === f.segment)
  } else if (f.campaignType === 'recall') {
    list = list.filter((p) => CAMPAIGN_RECALL_SEGMENTS.has(p.segment))
  } else if (f.campaignType === 'conversion') {
    list = list.filter((p) => CAMPAIGN_CONVERSION_SEGMENTS.has(p.segment))
  }

  if (f.honoraryOnly) {
    list = list.filter((p) => p.isHonorary === true)
  }
  if (f.activeOnly) {
    list = list.filter(isActiveProfile)
  }
  if (f.highValueOnly) {
    list = list.filter((p) => isHighValueSegment(p.segment))
  }
  if (f.minLevel > 0) {
    list = list.filter((p) => {
      const lv = Number(p.level) || 0
      return lv >= f.minLevel
    })
  }

  return list
}

async function resolveAudienceOpenids(db, filters) {
  const { users, orders, behaviors, dataCapped } = await loadPortraitSourceData(db)
  const profiles = buildProfile({ users, orders, behaviors })
  const matched = applyAudienceFilters(profiles, filters)
  const openids = matched.map((p) => p.openid).filter(Boolean)
  const unique = []
  const seen = {}
  openids.forEach((id) => {
    if (!seen[id]) {
      seen[id] = true
      unique.push(id)
    }
  })
  return {
    openids: unique,
    count: unique.length,
    previewCap: PREVIEW_CAP,
    dataCapped,
    fetchCap: FETCH_CAP,
    segmentMeta: filters.segment ? SEGMENTS[filters.segment] || null : null
  }
}

module.exports = {
  FETCH_CAP,
  PREVIEW_CAP,
  CAMPAIGN_RECALL_SEGMENTS,
  CAMPAIGN_CONVERSION_SEGMENTS,
  SEGMENTS,
  normalizeFilters,
  segmentAllowedForCampaign,
  loadPortraitSourceData,
  applyAudienceFilters,
  resolveAudienceOpenids
}
