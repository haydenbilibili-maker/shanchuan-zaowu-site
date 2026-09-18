/**
 * 祈福墙 · 安心木鱼「功德证」—— 里程点判定 + 持证记录（纯函数 + 本地存档）
 *
 * 产品口径（方案 `docs/创新钩子方案_2026-09-19.md` §H2）：
 *   敲木鱼的功德攒到里程点 → 用户可领一张**可保管、可回看**的证书。
 *   主目标是留存（次：注册）；分享形态是 W1 的未决口径，本模块**不做分享、不做奖励**。
 *
 * 本文件只做三件事，且都不碰网络 / 不碰 UI：
 *   ① **里程点判定**（纯函数）：`milestonesReached` / `nextMilestone` / `nextUnclaimed`；
 *   ② **持证记录的形状**（纯函数）：`claimMilestone` / `normalizeRecord`（幂等、可归一脏数据）；
 *   ③ **本地存档**：`readRecord` / `writeRecord`（任何失败都静默降级，绝不抛）。
 *
 * 为什么单独成模块：里程点判定必须是**纯函数**才可断言（藏进页面闭包就只能靠手感验）；
 * 且「本地存档 + 云端同步」的分工与本仓 `utils/wishRitual.js` / `utils/ritualProfile.js` 同一套：
 * **本地仍是权威**，云端同步是附加动作（由页面在注册成功后调 `ritualProfile.syncToCloud()`）。
 *
 * 合规（与 `utils/ritualFeedback.js` 头注同一条口径：文化娱乐向、不涉命理改运）：
 *   本文件（以及证书上的一切文案）**只写计数与日期**，不含任何运势 / 改运 / 应验承诺。
 *   `CERT_NOTE` 是对外可见的一句免责说明，同样只陈述"这是计数凭证"。
 */
'use strict'

const CERT_VERSION = 1

/**
 * 里程点阈值。
 *
 * ⚠️ **口径待产品确认，当前按方案建议 100 / 500 / 1000**。
 *   `docs/创新钩子方案_2026-09-19.md` §H2 把「里程点数字（100/500/1000？）」明确列入
 *   **需要产品口径**的地方，方案自己只给"建议"。因此这里只做**取值建议**，不当定稿：
 *   · 改口径 = 只改这一行（判定与文案都从这里派生，页面没有任何写死的数字）；
 *   · 功能整体由开关 `content_display_flags.showMuyuCertificate` 兜住（**缺字段默认关**），
 *     口径未确认前不会对用户生效，也不会为了"看起来做了"而猜一个数上线。
 */
const CERT_MILESTONES = [100, 500, 1000]

/** 本地持证记录的存储键（版本化：形状变更时 +1，避免旧档被按新结构读） */
const CERT_STORAGE_KEY = 'shanhai_muyu_cert_v1'

/** 证书对外文案（单一来源；页面不写死字面量，改口径/文案只改这里） */
const CERT_OVERLINE = 'MUYU MERIT'
const CERT_TITLE = '功德证'
/**
 * 证书下的一句说明。**刻意只陈述"这是计数凭证"**：
 * 不写"心愿必成 / 时来运转 / 好运加持"这类承诺，也不写"应验"。
 * （该句是否合产品/合规口径，已在交付说明里列为**待确认项**。）
 */
const CERT_NOTE = '本证为文化娱乐性质的计数凭证，仅记录敲木鱼的次数与领取日期。'

/** 入口文案（`mode` 由判定给出，页面直接用，不在 WXML 里拼字符串） */
function buildEntryText(mode, milestone) {
  if (mode === 'view') return { tag: '功德证', action: '回看 ›' }
  return { tag: `功德 ${toCount(milestone)}`, action: '领证 ›' }
}

/**
 * 领证门禁（RegisterAuthDialog）的 desc（纯函数）。
 * 只陈述"敲了多少下 + 注册后这份计数存到云端"，数字全部取自真实里程点与真实计数（不编）。
 * 合规：不写任何运势 / 改运 / 应验之类的承诺（与 `utils/ritualFeedback.js` 头注同口径）。
 */
function buildCertDesc(milestone, muyuCount) {
  const m = toCount(milestone)
  const n = toCount(muyuCount)
  return `已敲满 ${m} 下功德（当前 ${n} 下）。注册后这份计数会存到云端，凭它随时能调出这张功德证，换手机也还在。`
}

/** 非负整数计数（负数 / NaN / 字符串一律归一，绝不抛） */
function toCount(n) {
  const v = Math.floor(Number(n) || 0)
  return v > 0 ? v : 0
}

/** 已到达的里程点（升序）。返回数组而不是布尔：一份证书对应一个里程点，可有多档。 */
function milestonesReached(muyuCount) {
  const n = toCount(muyuCount)
  return CERT_MILESTONES.filter((m) => n >= m)
}

/** 下一个**还没到**的里程点（封顶后返回 null —— 不编一个更大的数去诱导继续敲）。 */
function nextMilestone(muyuCount) {
  const n = toCount(muyuCount)
  for (const m of CERT_MILESTONES) {
    if (n < m) return m
  }
  return null
}

/**
 * 下一个**可领**的里程点（已到达且未领取；null = 当前没有可领的证）。
 * `claimed` 是记录里的 `claimed` 映射（键是里程点的字符串形式）。
 */
function nextUnclaimed(muyuCount, claimed) {
  const n = toCount(muyuCount)
  const c = claimed || {}
  for (const m of CERT_MILESTONES) {
    if (n >= m && !c[String(m)]) return m
  }
  return null
}

/** 已领到的**最高**里程点（null = 还没领过证）；「回看」用它决定展示哪一档。 */
function highestClaimed(claimed) {
  const c = claimed || {}
  let hit = null
  for (const m of CERT_MILESTONES) {
    if (c[String(m)]) hit = m
  }
  return hit
}

function emptyRecord() {
  return { version: CERT_VERSION, claimed: {} }
}

/**
 * 归一秒化为合法记录（纯函数）。
 * 为什么要归一而不是直接信 storage：本地存储可被手改 / 旧版本写过 / 部分写入，
 * 一个脏键（如 `'42'`、`null`）不该让页面崩，也不该凭空变出一张"证"。
 */
function normalizeRecord(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const claimedSrc = src.claimed && typeof src.claimed === 'object' ? src.claimed : {}
  const claimed = {}
  for (const m of CERT_MILESTONES) {
    const item = claimedSrc[String(m)]
    if (!item || typeof item !== 'object') continue
    claimed[String(m)] = {
      milestone: m,
      dayKey: String(item.dayKey || ''),
      muyuCount: toCount(item.muyuCount)
    }
  }
  return { version: CERT_VERSION, claimed }
}

/**
 * 标记某个里程点为已领取（**纯函数**：返回新记录，不改入参）。
 *   · 非法档位（不在 CERT_MILESTONES 里）→ 原样返回（不写进存档，也就造不出假证）；
 *   · 重复领同一档 → 原样返回（**幂等**：连点不会改掉首次领取日期）。
 */
function claimMilestone(record, milestone, dayKey, muyuCount) {
  const rec = normalizeRecord(record)
  const m = toCount(milestone)
  if (CERT_MILESTONES.indexOf(m) === -1) return rec
  const key = String(m)
  if (rec.claimed[key]) return rec
  const claimed = Object.assign({}, rec.claimed)
  claimed[key] = { milestone: m, dayKey: String(dayKey || ''), muyuCount: toCount(muyuCount) }
  return { version: CERT_VERSION, claimed }
}

/**
 * 证书视图模型（纯函数）：**只有计数与日期**。
 * 返回 null 表示"没有这张证"，页面据此不渲染（绝不用空数据凑一张假证）。
 */
function buildCertificate(claim) {
  const c = claim && typeof claim === 'object' ? claim : {}
  const milestone = toCount(c.milestone)
  if (!milestone) return null
  return {
    milestone,
    muyuCount: toCount(c.muyuCount),
    dayKey: String(c.dayKey || '')
  }
}

/** 读本地持证记录（任何失败 → 空记录，绝不抛） */
function readRecord() {
  try {
    if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return emptyRecord()
    return normalizeRecord(wx.getStorageSync(CERT_STORAGE_KEY))
  } catch (e) {
    return emptyRecord()
  }
}

/** 写本地持证记录（返回是否写入成功；失败不影响领证流程本身） */
function writeRecord(record) {
  try {
    if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return false
    wx.setStorageSync(CERT_STORAGE_KEY, normalizeRecord(record))
    return true
  } catch (e) {
    console.warn('muyuCertificate writeRecord', e)
    return false
  }
}

module.exports = {
  CERT_VERSION,
  CERT_MILESTONES,
  CERT_STORAGE_KEY,
  CERT_OVERLINE,
  CERT_TITLE,
  CERT_NOTE,
  buildEntryText,
  buildCertDesc,
  toCount,
  milestonesReached,
  nextMilestone,
  nextUnclaimed,
  highestClaimed,
  emptyRecord,
  normalizeRecord,
  claimMilestone,
  buildCertificate,
  readRecord,
  writeRecord
}
