/**
 * 用户画像与分群算法
 * - 单一事实来源：基于 users / orders / user_behaviors 三个集合
 * - 输出：RFM 分数(1-5) / 分群 / 兴趣标签 / 留存矩阵
 *
 * 设计原则：
 * - 算法在前端运行（小数据量场景下毫秒级），避免增设云函数
 * - 分位法（quintile）切分 R/F/M，保证分群在不同样本量下都稳定
 * - 群组定义参考 Marketo / Forrester 的 11-segment 矩阵
 */

import { MODULE, MODULE_META, getEventMeta } from './analyticsSchema'

// ============ R/F/M 计算 ============

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * @param {Date|number|object} ts 服务器/客户端时间戳或 Date
 * @returns {number} unix ms
 */
export function toMs(ts) {
  if (!ts) return 0
  if (typeof ts === 'number') return ts
  if (ts instanceof Date) return ts.getTime()
  if (typeof ts === 'object' && typeof ts.toDate === 'function') return ts.toDate().getTime()
  if (typeof ts === 'string') {
    const n = Date.parse(ts)
    return isNaN(n) ? 0 : n
  }
  return 0
}

const VALID_ORDER_STATUS = new Set(['paid', 'shipped', 'received'])

/**
 * 计算用户的 R/F/M 原始值
 * @param {Array} users
 * @param {Array} orders
 * @param {number} [now]
 * @returns {Map<openid, {recencyDays, frequency, monetary, lastOrderTs, firstOrderTs}>}
 */
export function computeRawRFM(users, orders, now = Date.now()) {
  const map = new Map()

  // 初始化所有用户为零订单
  users.forEach(u => {
    const openid = u._openid || u._id
    if (!openid) return
    map.set(openid, { recencyDays: Infinity, frequency: 0, monetary: 0, lastOrderTs: 0, firstOrderTs: 0 })
  })

  orders.forEach(o => {
    if (!o || !VALID_ORDER_STATUS.has(o.status)) return
    const openid = o._openid || o.userId
    if (!openid) return
    let entry = map.get(openid)
    if (!entry) {
      entry = { recencyDays: Infinity, frequency: 0, monetary: 0, lastOrderTs: 0, firstOrderTs: 0 }
      map.set(openid, entry)
    }
    const ts = toMs(o.createTime || o.payTime)
    const price = parseFloat(String(o.totalPrice ?? 0).replace(/,/g, '')) || 0
    entry.frequency += 1
    entry.monetary += price
    if (ts > entry.lastOrderTs) entry.lastOrderTs = ts
    if (!entry.firstOrderTs || ts < entry.firstOrderTs) entry.firstOrderTs = ts
  })

  // 计算 recency
  map.forEach(v => {
    v.recencyDays = v.lastOrderTs > 0 ? Math.floor((now - v.lastOrderTs) / DAY_MS) : Infinity
  })

  return map
}

/**
 * 按分位计算每个用户的 R/F/M 1-5 分（5 为最佳）
 * - R: 越近越好（recency 越小分越高）
 * - F: 越高越好
 * - M: 越高越好
 * 未消费用户（frequency=0）固定为 1 1 1
 */
export function computeRFMScores(rawMap) {
  const entries = Array.from(rawMap.entries())
  const buyers = entries.filter(([, v]) => v.frequency > 0)

  // 排序值数组（用于平均秩百分位打分）
  const recencyValues = buyers.map(([, v]) => v.recencyDays).sort((a, b) => a - b)
  const frequencyValues = buyers.map(([, v]) => v.frequency).sort((a, b) => a - b)
  const monetaryValues = buyers.map(([, v]) => v.monetary).sort((a, b) => a - b)

  const result = new Map()
  entries.forEach(([openid, v]) => {
    if (v.frequency === 0) {
      result.set(openid, { ...v, R: 1, F: 1, M: 1, rfm: '111', segment: 'never_purchased' })
      return
    }
    // R 反向：recency 越小分越高
    const R = 6 - scoreByRank(v.recencyDays, recencyValues)
    const F = scoreByRank(v.frequency, frequencyValues)
    const M = scoreByRank(v.monetary, monetaryValues)
    result.set(openid, { ...v, R, F, M, rfm: `${R}${F}${M}`, segment: deriveSegment(R, F, M) })
  })
  return result
}

/**
 * 平均秩（midrank）百分位打分，返回 1-5。
 * 相比固定下标的分位切分：
 * - n≥3 且值不全相同时，最大值必得 5、最小值必得 1（小样本下 champions 仍可达）
 * - 单一买家（n=1）得 3 分（中性，不武断推向任一极端）
 * - 全体并列（如所有人 frequency=1 的常见场景）统一得 3 分
 */
function scoreByRank(value, sortedArr) {
  const n = sortedArr.length
  if (!n) return 1
  let lt = 0, le = 0
  for (const v of sortedArr) {
    if (v < value) lt++
    if (v <= value) le++
    else break
  }
  const pct = (lt + le) / (2 * n) // 等价于 (rank-0.5)/n，并列取中
  return Math.min(5, Math.floor(pct * 5) + 1)
}

// ============ 11 分群定义 ============

/**
 * 经典 RFM 11 分群矩阵
 * 参考 Marketo / Klaviyo 行业标准
 */
export const SEGMENTS = {
  champions: { name: '冠军客户', icon: '👑', color: '#d4af37', desc: '最近购买，频繁，高价值。最忠诚的核心客户。' },
  loyal: { name: '忠诚客户', icon: '🏆', color: '#e6a23c', desc: '频繁购买，价值高，可培养为冠军' },
  potential_loyal: { name: '潜力客户', icon: '⭐', color: '#67C23A', desc: '近期客户，消费频次中等，可激励为忠诚' },
  new_customers: { name: '新客户', icon: '🌱', color: '#52B788', desc: '最近完成首单，需要培育和留存' },
  promising: { name: '有潜力', icon: '✨', color: '#00BCD4', desc: '近期到访但频次低，可推送优惠激发' },
  need_attention: { name: '需要关注', icon: '⚠️', color: '#3F51B5', desc: '消费时间稍长，频次中等，需要召回' },
  about_to_sleep: { name: '即将沉睡', icon: '😴', color: '#9C27B0', desc: '消费时间较长，可能流失，需要主动触达' },
  at_risk: { name: '高价值流失风险', icon: '🚨', color: '#FF5722', desc: '过去高价值，长期未到访，重点抢救' },
  cant_lose: { name: '不能失去', icon: '💎', color: '#f56c6c', desc: '历史顶级客户，但已很久未消费，必须挽回' },
  hibernating: { name: '冬眠客户', icon: '❄️', color: '#909399', desc: '低频次低价值且久未到访，召回成本高' },
  lost: { name: '已流失', icon: '🪦', color: '#606266', desc: '极久未到访，低频低额，建议放弃或最后一次激活' },
  never_purchased: { name: '未消费访客', icon: '👀', color: '#C0C4CC', desc: '注册但尚未下单，需引导首单' }
}

/**
 * 根据 R/F/M 分数推断所属分群（11 种）
 * 网格映射经过实战调优
 */
export function deriveSegment(R, F, M) {
  if (R >= 5 && F >= 5 && M >= 4) return 'champions'
  if (R >= 3 && F >= 4 && M >= 4) return 'loyal'
  // 注意规则顺序：更具体的分群必须先于覆盖域更大的分群，否则永远不可达
  if (R >= 5 && F <= 1) return 'new_customers'        // 先于 potential_loyal（其 F∈[1,3] 覆盖 F=1）
  if (R >= 4 && F >= 1 && F <= 2 && M <= 2) return 'promising' // 同上
  if (R >= 4 && F >= 1 && F <= 3 && M >= 1) return 'potential_loyal'
  if (R >= 3 && R <= 4 && F >= 2 && F <= 3 && M >= 2 && M <= 3) return 'need_attention'
  if (R === 3 && F <= 3) return 'about_to_sleep'
  if (R <= 2 && F >= 4 && M >= 4) return 'cant_lose'  // 先于 at_risk（其 F≥3,M≥3 覆盖 F≥4,M≥4）
  if (R <= 2 && F >= 3 && M >= 3) return 'at_risk'
  if (R <= 2 && F >= 2 && M >= 2) return 'hibernating'
  if (R <= 1 && F <= 1 && M <= 1) return 'lost'
  return 'hibernating'
}

// ============ 行为标签（基于 user_behaviors） ============

/**
 * 根据用户的事件流自动派生兴趣标签
 * - 主导模块（最常用的 1-2 个 module）
 * - 高活跃事件（鉴定爱好者、定制偏好等）
 * - 必备阈值：至少 1 个有效事件
 */
export function deriveTagsFromBehaviors(behaviorsByUser) {
  // behaviorsByUser: Map<openid, [{action, module, count}]>
  const tagsMap = new Map()

  behaviorsByUser.forEach((events, openid) => {
    const moduleCount = {}
    const actionCount = {}
    events.forEach(ev => {
      const meta = getEventMeta(ev.action)
      const mod = meta?.module || ev.module || 'system'
      moduleCount[mod] = (moduleCount[mod] || 0) + (ev.count || 1)
      actionCount[ev.action] = (actionCount[ev.action] || 0) + (ev.count || 1)
    })

    const tags = []

    // 1. 主导模块（最多 2 个，需要占比 > 20%）
    const totalEvents = Object.values(moduleCount).reduce((s, c) => s + c, 0)
    const sortedModules = Object.entries(moduleCount).sort((a, b) => b[1] - a[1])
    sortedModules.slice(0, 2).forEach(([mod, cnt]) => {
      if (cnt / totalEvents >= 0.2) {
        const meta = MODULE_META[mod]
        if (meta) tags.push({ type: 'module', key: mod, label: meta.name + '偏好', icon: meta.icon, color: meta.color })
      }
    })

    // 2. 显著行为
    if ((actionCount.identify_start || 0) >= 3) {
      tags.push({ type: 'behavior', key: 'identify_lover', label: 'AI 鉴定爱好者', icon: '🔍', color: '#00BCD4' })
    }
    if ((actionCount.custom_order_submit || 0) >= 1) {
      tags.push({ type: 'behavior', key: 'custom_buyer', label: '定制消费者', icon: '🎨', color: '#d4af37' })
    }
    if ((actionCount.pet_memorial_submit || 0) >= 1) {
      tags.push({ type: 'behavior', key: 'pet_memorial', label: '伴宠纪念', icon: '🐾', color: '#FF8A65' })
    }
    if ((actionCount.store_checkin || 0) >= 2) {
      tags.push({ type: 'behavior', key: 'store_visitor', label: '门店常客', icon: '🏪', color: '#52B788' })
    }
    if ((actionCount.share || 0) + (actionCount.identify_share_poster || 0) >= 3) {
      tags.push({ type: 'behavior', key: 'sharer', label: '分享达人', icon: '📣', color: '#9C27B0' })
    }
    if ((actionCount.support_ticket_submit || 0) + (actionCount.support_call || 0) >= 2) {
      tags.push({ type: 'behavior', key: 'high_support', label: '高客服需求', icon: '💬', color: '#FF5722' })
    }
    if ((actionCount.care_guide_view || 0) >= 3) {
      tags.push({ type: 'behavior', key: 'collector', label: '资深藏家', icon: '🌿', color: '#67C23A' })
    }

    tagsMap.set(openid, tags)
  })

  return tagsMap
}

// ============ 留存矩阵（cohort retention） ============

/**
 * 按"注册周"分队，计算第 N 周的留存比例
 * @param {Array} users users 集合
 * @param {Array} behaviors user_behaviors 集合
 * @param {Object} opts { weeks: 8, anchorAction: any }
 * @returns {Array<{ cohortWeek, cohortSize, retention: number[] }>}
 */
export function computeRetentionCohort(users, behaviors, opts = {}) {
  const weeks = opts.weeks || 8

  // 1. 按 ISO 周分组用户
  const cohortMap = {} // weekKey -> [openid]
  users.forEach(u => {
    const ts = toMs(u.createTime)
    if (!ts) return
    const wk = isoWeekKey(ts)
    if (!cohortMap[wk]) cohortMap[wk] = new Set()
    cohortMap[wk].add(u._openid || u._id)
  })

  // 2. 计算每个用户每周是否活跃
  const userWeekActive = new Map() // openid -> Set<weekKey>
  behaviors.forEach(b => {
    const ts = toMs(b.createdAt || b.timestamp)
    if (!ts) return
    const openid = b.userId
    if (!openid) return
    if (!userWeekActive.has(openid)) userWeekActive.set(openid, new Set())
    userWeekActive.get(openid).add(isoWeekKey(ts))
  })

  // 3. 对每个 cohort 算 weeks 周留存
  const cohorts = Object.entries(cohortMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-weeks)
    .map(([cohortWeek, openidSet]) => {
      const cohortTs = isoWeekToMs(cohortWeek)
      const cohortSize = openidSet.size
      const retention = []
      for (let w = 0; w < weeks; w++) {
        const targetWeek = isoWeekKey(cohortTs + w * 7 * DAY_MS)
        let active = 0
        openidSet.forEach(openid => {
          if (userWeekActive.get(openid)?.has(targetWeek)) active++
        })
        retention.push(cohortSize > 0 ? +(active / cohortSize * 100).toFixed(1) : 0)
      }
      return { cohortWeek, cohortSize, retention }
    })

  return cohorts
}

function isoWeekKey(ts) {
  // ISO-8601 Thursday 法：周一为一周起点，年份取所在周周四的年份。
  // 必须与 isoWeekToMs（真 ISO）保持往返一致，否则留存矩阵跨年错位。
  const d = new Date(ts)
  const day = d.getUTCDay() || 7
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 4 - day))
  const year = thursday.getUTCFullYear()
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const week1Start = jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * DAY_MS
  const week = Math.floor((thursday.getTime() - week1Start) / (7 * DAY_MS)) + 1
  return `${year}-W${String(week).padStart(2, '0')}`
}

function isoWeekToMs(key) {
  const [y, w] = key.split('-W')
  const jan4 = new Date(Date.UTC(+y, 0, 4))
  const dayOfWeek = jan4.getUTCDay() || 7
  const week1Start = jan4.getTime() - (dayOfWeek - 1) * DAY_MS
  return week1Start + (+w - 1) * 7 * DAY_MS
}

// ============ 顶层入口：一次性算所有维度 ============

export function buildProfile({ users, orders, behaviors }) {
  const rawRFM = computeRawRFM(users, orders)
  const scored = computeRFMScores(rawRFM)

  // 按用户聚合行为
  const behaviorsByUser = new Map()
  behaviors.forEach(b => {
    const openid = b.userId
    if (!openid) return
    if (!behaviorsByUser.has(openid)) behaviorsByUser.set(openid, [])
    behaviorsByUser.get(openid).push({ action: b.action, module: b.module, count: 1 })
  })
  const tagsMap = deriveTagsFromBehaviors(behaviorsByUser)

  // 合并：每个 user 一份完整 profile
  const profiles = users.map(u => {
    const openid = u._openid || u._id
    const rfm = scored.get(openid) || { R: 0, F: 0, M: 0, rfm: '000', segment: 'never_purchased', recencyDays: Infinity, frequency: 0, monetary: 0 }
    const tags = tagsMap.get(openid) || []
    return {
      _id: u._id,
      openid,
      nickName: u.nickName,
      avatarUrl: u.avatarUrl,
      points: u.points || 0,
      createTime: u.createTime,
      ...rfm,
      tags,
      segmentMeta: SEGMENTS[rfm.segment] || SEGMENTS.never_purchased
    }
  })

  return profiles
}

/** 计算分群汇总（每个 segment 的人数、平均消费、平均频次） */
export function summarizeSegments(profiles) {
  const summary = {}
  Object.keys(SEGMENTS).forEach(k => {
    summary[k] = { ...SEGMENTS[k], key: k, count: 0, totalMonetary: 0, totalFrequency: 0, users: [] }
  })
  profiles.forEach(p => {
    const s = summary[p.segment]
    if (!s) return
    s.count++
    s.totalMonetary += p.monetary || 0
    s.totalFrequency += p.frequency || 0
    s.users.push(p)
  })
  Object.values(summary).forEach(s => {
    s.avgMonetary = s.count > 0 ? Math.round(s.totalMonetary / s.count) : 0
    s.avgFrequency = s.count > 0 ? +(s.totalFrequency / s.count).toFixed(1) : 0
  })
  return Object.values(summary).sort((a, b) => b.count - a.count)
}
