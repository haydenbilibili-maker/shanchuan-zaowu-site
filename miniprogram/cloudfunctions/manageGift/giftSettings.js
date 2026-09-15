/**
 * 礼赠运营配置（集合 gift_settings）
 * 超管可写；店长可读；C 端下单读默认超时天数
 */

const { DEFAULT_ADDRESS_TIMEOUT_DAYS, DELIVERY_TYPES } = require('./giftMeta')

const COLLECTION = 'gift_settings'
const DOC_KEY = 'default'

const TIMEOUT_OPTIONS = [3, 7, 14]

const DELIVERY_LABELS = {
  invite_address: '邀请 TA 填写地址',
  ship_to_receiver: '快递给 TA',
  ship_to_self: '寄给我',
  store_pickup: '门店自提代赠'
}

const DEFAULT_NUDGE_DAYS = [3, 6]

function getDefaultSettings() {
  return {
    addressFillTimeoutDays: DEFAULT_ADDRESS_TIMEOUT_DAYS,
    defaultDeliveryType: 'invite_address',
    allowHidePriceToggle: true,
    nudgeDays: DEFAULT_NUDGE_DAYS.slice()
  }
}

function normalizeTimeoutDays(raw) {
  const n = parseInt(raw, 10)
  if (TIMEOUT_OPTIONS.indexOf(n) !== -1) return n
  const clamped = Math.min(30, Math.max(1, n || DEFAULT_ADDRESS_TIMEOUT_DAYS))
  // 非 3/7/14 时就近落到合法档
  let best = TIMEOUT_OPTIONS[0]
  let bestDiff = Math.abs(clamped - best)
  TIMEOUT_OPTIONS.forEach((opt) => {
    const d = Math.abs(clamped - opt)
    if (d < bestDiff) {
      best = opt
      bestDiff = d
    }
  })
  return best
}

function normalizeDeliveryType(raw) {
  const key = String(raw || '').trim()
  return DELIVERY_TYPES[key] ? key : 'invite_address'
}

function normalizeNudgeDays(raw) {
  if (!Array.isArray(raw) || !raw.length) return DEFAULT_NUDGE_DAYS.slice()
  const days = raw
    .map((d) => parseInt(d, 10))
    .filter((d) => Number.isFinite(d) && d >= 1 && d <= 30)
  return days.length ? Array.from(new Set(days)).sort((a, b) => a - b) : DEFAULT_NUDGE_DAYS.slice()
}

function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const base = getDefaultSettings()
  return {
    addressFillTimeoutDays: normalizeTimeoutDays(
      src.addressFillTimeoutDays != null ? src.addressFillTimeoutDays : base.addressFillTimeoutDays
    ),
    defaultDeliveryType: normalizeDeliveryType(
      src.defaultDeliveryType || base.defaultDeliveryType
    ),
    allowHidePriceToggle: src.allowHidePriceToggle !== false,
    nudgeDays: normalizeNudgeDays(src.nudgeDays)
  }
}

function describeSettings(settings) {
  const s = normalizeSettings(settings)
  const delivery = DELIVERY_LABELS[s.defaultDeliveryType] || s.defaultDeliveryType
  const nudge = (s.nudgeDays || []).map((d) => `D+${d}`).join(' / ')
  return `填址 ${s.addressFillTimeoutDays} 日 · 默认「${delivery}」· 催填 ${nudge || '—'}`
}

function nudgeRuleSummary(settings) {
  const s = normalizeSettings(settings)
  const auto = (s.nudgeDays || []).map((d) => `第 ${d} 日`).join('、')
  return `支付后${auto || '第 3、6 日'}自动催填；送礼人每日手动催填至多 1 次；超时未填址全额退回`
}

async function loadSettingsDoc(db) {
  try {
    const byKey = await db.collection(COLLECTION).where({ key: DOC_KEY }).limit(1).get()
    if (byKey.data && byKey.data[0]) return byKey.data[0]
  } catch (e) {
    if (/COLLECTION_NOT_EXIST|not exist|502005|-502005/i.test(String(e.message || e))) {
      return null
    }
  }
  try {
    const res = await db.collection(COLLECTION).limit(5).get()
    const rows = res.data || []
    if (!rows.length) return null
    rows.sort(
      (a, b) =>
        (Number(b.updatedAtMs) || 0) - (Number(a.updatedAtMs) || 0) ||
        String(b._id || '').localeCompare(String(a._id || ''))
    )
    return rows[0]
  } catch (e2) {
    if (/COLLECTION_NOT_EXIST|not exist|502005|-502005/i.test(String(e2.message || e2))) {
      return null
    }
    console.warn('loadSettingsDoc', e2 && e2.message)
    return null
  }
}

async function loadGiftSettings(db) {
  const doc = await loadSettingsDoc(db)
  return {
    settings: normalizeSettings(doc || {}),
    docId: (doc && doc._id) || '',
    fromDefault: !doc
  }
}

function buildSubscribeStatus() {
  const nudge = !!String(process.env.GIFT_NUDGE_TMPL_ID || '').trim()
  const fulfill = !!String(process.env.GIFT_FULFILL_TMPL_ID || '').trim()
  const expire = !!String(process.env.GIFT_EXPIRE_TMPL_ID || '').trim()
  const configuredCount = [nudge, fulfill, expire].filter(Boolean).length
  let summary = '未就绪'
  let lamp = 'warn'
  if (configuredCount === 3) {
    summary = '已就绪'
    lamp = 'success'
  } else if (configuredCount > 0) {
    summary = `部分就绪（${configuredCount}/3）`
    lamp = 'brass'
  }
  return {
    nudge,
    fulfill,
    expire,
    configuredCount,
    summary,
    lamp,
    items: [
      { key: 'nudge', label: '催填 / 支付提醒', configured: nudge },
      { key: 'fulfill', label: '填址完成', configured: fulfill },
      { key: 'expire', label: '即将过期 / 超时退', configured: expire }
    ],
    hint: configuredCount
      ? '未就绪项会跳过微信提醒，进度仍可通过山海有信送达'
      : '模板审核通过前以山海有信覆盖；就绪后需在云开发配置模板并重新部署相关云函数'
  }
}

module.exports = {
  COLLECTION,
  DOC_KEY,
  TIMEOUT_OPTIONS,
  DELIVERY_LABELS,
  getDefaultSettings,
  normalizeSettings,
  describeSettings,
  nudgeRuleSummary,
  loadSettingsDoc,
  loadGiftSettings,
  buildSubscribeStatus,
  normalizeTimeoutDays,
  normalizeDeliveryType
}
