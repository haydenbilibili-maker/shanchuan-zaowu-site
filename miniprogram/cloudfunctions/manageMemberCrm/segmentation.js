/**
 * RFM / 分群 / 兴趣标签 — 与 Admin `utils/userSegmentation.js` 同源精简版
 * （云函数侧无 ES module，行为标签仅保留 Admin CRM 用到的派生规则）
 */

const DAY_MS = 24 * 60 * 60 * 1000
const VALID_ORDER_STATUS = new Set(['paid', 'shipped', 'received'])

function topInterestTagNames(map, limit) {
  const cap = Math.max(1, limit || 8)
  if (Array.isArray(map)) {
    return map.map((t) => String(t || '').trim()).filter(Boolean).slice(0, cap)
  }
  if (!map || typeof map !== 'object') return []
  return Object.entries(map)
    .filter(([key, weight]) => key && Number(weight) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, cap)
    .map(([key]) => key)
}

/** 兴趣模块元数据 — 禁止 emoji，仅文案（Museum 规范） */
const MODULE_META = {
  system: { name: '系统/页面', icon: '', color: '#A09A90' },
  explore: { name: '探索首页', icon: '', color: '#5B8FB9' },
  encyclopedia: { name: '馆藏/百科', icon: '', color: '#52B788' },
  commerce: { name: '电商交易', icon: '', color: '#E9A23B' },
  store: { name: '门店', icon: '', color: '#D64045' },
  booking: { name: '预约', icon: '', color: '#7B68AE' },
  identify: { name: 'AI 鉴定', icon: '', color: '#5B8FB9' },
  custom: { name: '定制/伴宠', icon: '', color: '#C4A76C' },
  care: { name: '养护', icon: '', color: '#52B788' },
  message: { name: '消息', icon: '', color: '#5B8FB9' },
  support: { name: '客服', icon: '', color: '#E9A23B' },
  community: { name: '社区', icon: '', color: '#8B6F47' },
  user: { name: '会员', icon: '', color: '#A09A90' }
}

const ACTION_MODULE = {
  identify_start: 'identify',
  custom_order_submit: 'custom',
  pet_memorial_submit: 'custom',
  store_checkin: 'store',
  share: 'commerce',
  identify_share_poster: 'identify',
  support_ticket_submit: 'support',
  support_call: 'support',
  care_guide_view: 'care'
}

const SEGMENTS = {
  champions: { name: '冠军客户', icon: '', color: '#C4A76C', desc: '最近购买，频繁，高价值。最忠诚的核心客户。' },
  loyal: { name: '忠诚客户', icon: '', color: '#C4A76C', desc: '频繁购买，价值高，可培养为冠军' },
  potential_loyal: { name: '潜力客户', icon: '', color: '#52B788', desc: '近期客户，消费频次中等，可激励为忠诚' },
  new_customers: { name: '新客户', icon: '', color: '#52B788', desc: '最近完成首单，需要培育和留存' },
  promising: { name: '有潜力', icon: '', color: '#5B8FB9', desc: '近期有单但频次低，可推送优惠激发复购' },
  need_attention: { name: '需要关注', icon: '', color: '#E9A23B', desc: '相对近度一般、频次中等，建议主动跟进复购' },
  about_to_sleep: { name: '即将沉睡', icon: '', color: '#E9A23B', desc: '消费间隔偏长，可能流失，需要主动触达' },
  at_risk: { name: '高价值流失风险', icon: '', color: '#D64045', desc: '过去高价值，长期未到访，重点抢救' },
  cant_lose: { name: '不能失去', icon: '', color: '#D64045', desc: '历史顶级客户，但已很久未消费，必须挽回' },
  hibernating: { name: '冬眠客户', icon: '', color: '#A09A90', desc: '低频次低价值且久未到访，召回成本高' },
  lost: { name: '已流失', icon: '', color: '#6B6560', desc: '极久未到访，低频低额，建议放弃或最后一次激活' },
  never_purchased: { name: '未消费访客', icon: '', color: '#A09A90', desc: '注册但尚未下单，需引导首单' }
}

const SUGGEST_MAP = {
  champions: ['VIP 专属权益', '邀请新品体验', '社群运营加深绑定'],
  loyal: ['复购满减券', '生日礼券', '老带新分销'],
  potential_loyal: ['第二单折扣', '展示热门 SKU'],
  new_customers: ['新人礼包', '产品教学内容', '首单售后回访'],
  promising: ['限时优惠券', '推送相关品类'],
  need_attention: ['唤醒短信', '回归礼包'],
  about_to_sleep: ['流失预警 EDM', '客服主动联系'],
  at_risk: ['客服 1V1 回访', '高额挽回券'],
  cant_lose: ['店长亲自联系', '专属重磅福利'],
  hibernating: ['年度大促唤醒', '低成本触达'],
  lost: ['品牌焕新通知', '最后一波激活'],
  never_purchased: ['新人首单券', '免费体验活动']
}

function toMs(ts) {
  if (ts == null || ts === '') return 0
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    return ts > 0 && ts < 1e12 ? ts * 1000 : ts
  }
  if (ts instanceof Date) return ts.getTime()
  if (typeof ts === 'object') {
    if (typeof ts.toDate === 'function') {
      const d = ts.toDate()
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : 0
    }
    if (ts._seconds != null) {
      const sec = Number(ts._seconds)
      if (Number.isFinite(sec)) {
        const nano = Number(ts._nanoseconds || 0)
        return sec * 1000 + (Number.isFinite(nano) ? Math.floor(nano / 1e6) : 0)
      }
    }
    if (ts.seconds != null) {
      const sec = Number(ts.seconds)
      if (Number.isFinite(sec)) return sec * 1000
    }
    if (ts.$date != null) {
      const inner = ts.$date
      if (typeof inner === 'number' && Number.isFinite(inner)) return inner
      const n = Date.parse(String(inner))
      return Number.isNaN(n) ? 0 : n
    }
    if (typeof ts.getTime === 'function') {
      const n = ts.getTime()
      return Number.isFinite(n) ? n : 0
    }
  }
  if (typeof ts === 'string') {
    const s = ts.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const n = Date.parse(`${s}T00:00:00+08:00`)
      return Number.isNaN(n) ? 0 : n
    }
    const n = Date.parse(s)
    return Number.isNaN(n) ? 0 : n
  }
  return 0
}

function resolveUserRegisteredMs(u) {
  if (!u || typeof u !== 'object') return 0
  const fields = ['createTime', 'registerTime', 'createdAt', '_createTime']
  for (let i = 0; i < fields.length; i += 1) {
    const ms = toMs(u[fields[i]])
    if (ms) return ms
  }
  return 0
}

function deriveSegment(R, F, M) {
  if (R >= 5 && F >= 5 && M >= 4) return 'champions'
  if (R >= 3 && F >= 4 && M >= 4) return 'loyal'
  if (R >= 5 && F <= 1) return 'new_customers'
  if (R >= 4 && F >= 1 && F <= 2 && M <= 2) return 'promising'
  if (R >= 4 && F >= 1 && F <= 3 && M >= 1) return 'potential_loyal'
  if (R >= 3 && R <= 4 && F >= 2 && F <= 3 && M >= 2 && M <= 3) return 'need_attention'
  if (R === 3 && F <= 3) return 'about_to_sleep'
  if (R <= 2 && F >= 4 && M >= 4) return 'cant_lose'
  if (R <= 2 && F >= 3 && M >= 3) return 'at_risk'
  if (R <= 2 && F >= 2 && M >= 2) return 'hibernating'
  if (R <= 1 && F <= 1 && M <= 1) return 'lost'
  return 'hibernating'
}

/**
 * 相对 RFM 分群在小样本下会把「0 天前下单」标成 need_attention（召回文案）。
 * 用绝对近度纠偏，避免运营建议与「最近消费」矛盾。
 */
const RECALL_SEGMENTS = new Set([
  'need_attention',
  'about_to_sleep',
  'at_risk',
  'cant_lose',
  'hibernating',
  'lost'
])

function refineSegmentByAbsoluteRecency(entry) {
  if (!entry || !(entry.frequency > 0)) return entry
  const days = entry.recencyDays
  if (days == null || days === Infinity) return entry
  if (days <= 7 && RECALL_SEGMENTS.has(entry.segment)) {
    let segment = 'potential_loyal'
    if (entry.frequency <= 1) segment = 'new_customers'
    else if (entry.F >= 4 && entry.M >= 4) segment = 'loyal'
    else if (entry.F <= 2 && entry.M <= 2) segment = 'promising'
    return Object.assign({}, entry, { segment })
  }
  if (days <= 30 && (entry.segment === 'hibernating' || entry.segment === 'lost')) {
    return Object.assign({}, entry, { segment: 'need_attention' })
  }
  return entry
}

function scoreByRank(value, sortedArr) {
  const n = sortedArr.length
  if (!n) return 1
  let lt = 0
  let le = 0
  for (let i = 0; i < sortedArr.length; i++) {
    const v = sortedArr[i]
    if (v < value) lt++
    if (v <= value) le++
    else break
  }
  const pct = (lt + le) / (2 * n)
  return Math.min(5, Math.floor(pct * 5) + 1)
}

function computeRawRFM(users, orders, now) {
  const map = new Map()
  ;(users || []).forEach((u) => {
    const openid = (u && (u._openid || u._id)) || ''
    if (!openid) return
    map.set(openid, {
      recencyDays: Infinity,
      frequency: 0,
      monetary: 0,
      lastOrderTs: 0,
      firstOrderTs: 0
    })
  })

  ;(orders || []).forEach((o) => {
    if (!o || !VALID_ORDER_STATUS.has(o.status)) return
    const openid = o._openid || o.userId
    if (!openid) return
    let entry = map.get(openid)
    if (!entry) {
      entry = {
        recencyDays: Infinity,
        frequency: 0,
        monetary: 0,
        lastOrderTs: 0,
        firstOrderTs: 0
      }
      map.set(openid, entry)
    }
    const ts = toMs(o.createTime || o.payTime)
    const price = parseFloat(String(o.totalPrice != null ? o.totalPrice : 0).replace(/,/g, '')) || 0
    entry.frequency += 1
    entry.monetary += price
    if (ts > entry.lastOrderTs) entry.lastOrderTs = ts
    if (!entry.firstOrderTs || ts < entry.firstOrderTs) entry.firstOrderTs = ts
  })

  map.forEach((v) => {
    v.recencyDays = v.lastOrderTs > 0 ? Math.floor((now - v.lastOrderTs) / DAY_MS) : Infinity
  })
  return map
}

/** 与 pointsBalance.sumPaidGrowth 同源：采样 orders 内按 openid 累加成长值（不含 exchange） */
function computeOrderGrowthMap(orders) {
  const map = new Map()
  ;(orders || []).forEach((o) => {
    if (!o || !VALID_ORDER_STATUS.has(o.status)) return
    if (o.source === 'exchange') return
    const openid = o._openid || o.userId
    if (!openid) return
    const raw =
      o.growthAmount != null && o.growthAmount !== '' ? o.growthAmount : o.totalPrice
    if (raw == null || raw === '') return
    const price =
      typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/,/g, ''))
    if (!Number.isFinite(price)) return
    map.set(openid, Math.floor((map.get(openid) || 0) + price))
  })
  return map
}

function computeRFMScores(rawMap) {
  const entries = Array.from(rawMap.entries())
  const buyers = entries.filter(([, v]) => v.frequency > 0)
  const recencyValues = buyers.map(([, v]) => v.recencyDays).sort((a, b) => a - b)
  const frequencyValues = buyers.map(([, v]) => v.frequency).sort((a, b) => a - b)
  const monetaryValues = buyers.map(([, v]) => v.monetary).sort((a, b) => a - b)

  const result = new Map()
  entries.forEach(([openid, v]) => {
    if (v.frequency === 0) {
      result.set(openid, {
        ...v,
        R: 1,
        F: 1,
        M: 1,
        rfm: '111',
        segment: 'never_purchased'
      })
      return
    }
    const R = 6 - scoreByRank(v.recencyDays, recencyValues)
    const F = scoreByRank(v.frequency, frequencyValues)
    const M = scoreByRank(v.monetary, monetaryValues)
    const scored = refineSegmentByAbsoluteRecency({
      ...v,
      R,
      F,
      M,
      rfm: `${R}${F}${M}`,
      segment: deriveSegment(R, F, M)
    })
    result.set(openid, Object.assign({}, scored, { rfm: `${scored.R}${scored.F}${scored.M}` }))
  })
  return result
}

function deriveTagsFromBehaviors(behaviorsByUser) {
  const tagsMap = new Map()
  behaviorsByUser.forEach((events, openid) => {
    const moduleCount = {}
    const actionCount = {}
    events.forEach((ev) => {
      const mod = ACTION_MODULE[ev.action] || ev.module || 'system'
      moduleCount[mod] = (moduleCount[mod] || 0) + (ev.count || 1)
      actionCount[ev.action] = (actionCount[ev.action] || 0) + (ev.count || 1)
    })

    const tags = []
    const totalEvents = Object.values(moduleCount).reduce((s, c) => s + c, 0)
    const sortedModules = Object.entries(moduleCount).sort((a, b) => b[1] - a[1])
    sortedModules.slice(0, 2).forEach(([mod, cnt]) => {
      if (totalEvents > 0 && cnt / totalEvents >= 0.2) {
        const meta = MODULE_META[mod]
        if (meta) {
          tags.push({
            type: 'module',
            key: mod,
            label: `${meta.name}偏好`,
            icon: meta.icon,
            color: meta.color
          })
        }
      }
    })

    if ((actionCount.identify_start || 0) >= 3) {
      tags.push({ type: 'behavior', key: 'identify_lover', label: 'AI 鉴定爱好者', icon: '', color: '#5B8FB9' })
    }
    if ((actionCount.custom_order_submit || 0) >= 1) {
      tags.push({ type: 'behavior', key: 'custom_buyer', label: '定制消费者', icon: '', color: '#C4A76C' })
    }
    if ((actionCount.pet_memorial_submit || 0) >= 1) {
      tags.push({ type: 'behavior', key: 'pet_memorial', label: '伴宠纪念', icon: '', color: '#E9A23B' })
    }
    if ((actionCount.store_checkin || 0) >= 2) {
      tags.push({ type: 'behavior', key: 'store_visitor', label: '门店常客', icon: '', color: '#52B788' })
    }
    if ((actionCount.share || 0) + (actionCount.identify_share_poster || 0) >= 3) {
      tags.push({ type: 'behavior', key: 'sharer', label: '分享达人', icon: '', color: '#7B68AE' })
    }
    if ((actionCount.support_ticket_submit || 0) + (actionCount.support_call || 0) >= 2) {
      tags.push({ type: 'behavior', key: 'high_support', label: '高客服需求', icon: '', color: '#E9A23B' })
    }
    if ((actionCount.care_guide_view || 0) >= 3) {
      tags.push({ type: 'behavior', key: 'collector', label: '资深藏家', icon: '', color: '#52B788' })
    }

    tagsMap.set(openid, tags)
  })
  return tagsMap
}

function buildProfile({ users, orders, behaviors }) {
  const now = Date.now()
  const rawRFM = computeRawRFM(users, orders, now)
  const orderGrowthMap = computeOrderGrowthMap(orders)
  const scored = computeRFMScores(rawRFM)

  const behaviorsByUser = new Map()
  ;(behaviors || []).forEach((b) => {
    const openid = b.userId || b._openid
    if (!openid) return
    if (!behaviorsByUser.has(openid)) behaviorsByUser.set(openid, [])
    behaviorsByUser.get(openid).push({ action: b.action, module: b.module, count: 1 })
  })
  const tagsMap = deriveTagsFromBehaviors(behaviorsByUser)

  return (users || []).map((u) => {
    const openid = u._openid || u._id
    const rfm =
      scored.get(openid) || {
        R: 0,
        F: 0,
        M: 0,
        rfm: '000',
        segment: 'never_purchased',
        recencyDays: Infinity,
        frequency: 0,
        monetary: 0
      }
    const tags = tagsMap.get(openid) || []
    const interestTags = topInterestTagNames(u.interestTags, 8)
    const segmentMeta = SEGMENTS[rfm.segment] || SEGMENTS.never_purchased
    const orderGrowthValue = orderGrowthMap.get(openid) || 0
    const bonusPoints = Math.max(0, Math.floor(Number(u.bonusPoints) || 0))
    const usedPoints = Math.max(0, Math.floor(Number(u.usedPoints) || 0))
    // 列表摘要与详情 availablePoints 同源口径（采样内订单成长 + bonus − used）
    const pointsApprox = Math.max(0, orderGrowthValue + bonusPoints - usedPoints)
    return {
      _id: u._id,
      openid,
      nickName: u.nickName || u.name || '未授权用户',
      avatarUrl: u.avatarUrl || '',
      phone: u.phone || '',
      points: pointsApprox,
      isHonorary: u.isHonorary === true,
      createTime: resolveUserRegisteredMs(u),
      orderGrowthValue,
      storeGrowthValue: Math.max(0, Math.floor(Number(u.storeGrowthValue) || 0)),
      levelOverride: u.levelOverride || null,
      ...rfm,
      tags,
      interestTags,
      segmentMeta,
      suggestions: SUGGEST_MAP[rfm.segment] || []
    }
  })
}

function summarizeSegments(profiles) {
  const summary = {}
  Object.keys(SEGMENTS).forEach((k) => {
    summary[k] = { ...SEGMENTS[k], key: k, count: 0 }
  })
  ;(profiles || []).forEach((p) => {
    const s = summary[p.segment]
    if (s) s.count += 1
  })
  return Object.values(summary)
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count)
}

/**
 * 活跃口径：对齐 Admin CRM 近度色阶
 * - hot/ok：recencyDays ≤ 30
 * - warn：> 30；cold：> 90 或从未下单
 * 仅看有效订单近度（与 RFM 的 R 同源），不含行为埋点。
 */
const ACTIVE_RECENCY_DAYS = 30

/** Admin 分群文案中的高价值相关分群（用于标注，排名主序仍是 monetary） */
const HIGH_VALUE_SEGMENTS = ['champions', 'loyal', 'cant_lose', 'at_risk']

function isActiveProfile(p) {
  const d = p && p.recencyDays
  if (d == null || d === Infinity) return false
  return Number(d) <= ACTIVE_RECENCY_DAYS
}

function isHighValueSegment(segment) {
  return HIGH_VALUE_SEGMENTS.indexOf(String(segment || '')) !== -1
}

/**
 * @param {Array} profiles buildProfile 结果
 * @param {{ topN?: number }} opts
 */
function buildOverview(profiles, opts = {}) {
  const topN = Math.min(50, Math.max(5, Number(opts.topN) || 20))
  const list = Array.isArray(profiles) ? profiles : []
  const total = list.length
  const activeList = list.filter(isActiveProfile)
  const buyers = list.filter((p) => (p.frequency || 0) > 0)

  const segmentBars = summarizeSegments(list).map((s) => ({
    key: s.key,
    name: s.name,
    count: s.count,
    color: s.color
  }))
  const segMax = segmentBars.reduce((m, s) => Math.max(m, s.count), 0) || 1
  segmentBars.forEach((s) => {
    s.pct = Math.max(4, Math.round((s.count / segMax) * 100))
  })

  // 活跃近度分桶（与 Admin rec-hot / rec-ok / 边界对齐）
  const activeBuckets = [
    { key: 'd7', name: '近 7 日', maxDays: 7, count: 0 },
    { key: 'd30', name: '8–30 日', maxDays: 30, count: 0 }
  ]
  activeList.forEach((p) => {
    const d = Number(p.recencyDays)
    if (d <= 7) activeBuckets[0].count += 1
    else activeBuckets[1].count += 1
  })
  const activeMax = activeBuckets.reduce((m, b) => Math.max(m, b.count), 0) || 1
  activeBuckets.forEach((b) => {
    b.pct = b.count ? Math.max(4, Math.round((b.count / activeMax) * 100)) : 0
  })

  const highValueSegCount = list.filter((p) => isHighValueSegment(p.segment)).length
  const ranked = buyers
    .slice()
    .sort((a, b) => (b.monetary || 0) - (a.monetary || 0) || (b.frequency || 0) - (a.frequency || 0))
    .slice(0, topN)
  const moneyMax = ranked.reduce((m, p) => Math.max(m, p.monetary || 0), 0) || 1

  const rank = ranked.map((p, idx) => {
    const seg = p.segmentMeta || SEGMENTS[p.segment] || SEGMENTS.never_purchased
    return {
      rank: idx + 1,
      _id: p._id,
      openid: p.openid,
      nickName: p.nickName,
      avatarUrl: p.avatarUrl || '',
      monetary: Math.round((p.monetary || 0) * 100) / 100,
      frequency: p.frequency || 0,
      rfm: p.rfm || '000',
      segment: p.segment,
      segmentName: seg.name || '',
      highValueSeg: isHighValueSegment(p.segment),
      recencyDays: p.recencyDays === Infinity ? null : p.recencyDays,
      pct: Math.max(4, Math.round(((p.monetary || 0) / moneyMax) * 100))
    }
  })

  return {
    definitions: {
      total: `采样 users 最近 ${opts.fetchCap || 1000} 条（与 Admin CRM / list 同源）；达上限时非全集`,
      active: `近度 ≤ ${ACTIVE_RECENCY_DAYS} 天有有效订单（paid/shipped/received），对齐 Admin CRM 近度 hot/ok`,
      highValue: `已消费会员按累计消费 monetary 降序 Top ${topN}；分群 champions/loyal/cant_lose/at_risk 标为高价值分群`
    },
    total: {
      count: total,
      buyerCount: buyers.length,
      neverPurchased: total - buyers.length,
      segmentBars
    },
    active: {
      count: activeList.length,
      ratio: total > 0 ? Math.round((activeList.length / total) * 1000) / 10 : 0,
      recencyDays: ACTIVE_RECENCY_DAYS,
      buckets: activeBuckets
    },
    highValue: {
      segmentMemberCount: highValueSegCount,
      topN,
      rank
    }
  }
}

module.exports = {
  SEGMENTS,
  SUGGEST_MAP,
  ACTIVE_RECENCY_DAYS,
  HIGH_VALUE_SEGMENTS,
  VALID_ORDER_STATUS,
  toMs,
  buildProfile,
  refineSegmentByAbsoluteRecency,
  summarizeSegments,
  isActiveProfile,
  isHighValueSegment,
  buildOverview
}
