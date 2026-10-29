/**
 * 活动券自动发放（旁路）—— 2026-10-29 双十一八折券，产品负责人点名「直接发到券夹，不需要用户领取」
 *
 * 触发：定时触发器 `issueCampaignCouponRun`（config.json，每 10 分钟；云开发 cron 按 UTC+8 解析，
 *       但本函数**不依赖**触发器时区：是否发放只看下方 CAMPAIGNS 的绝对时刻 ∩ 模板的 startTime / endTime / fixedExpireTime）。
 * 对象：注册会员 = `users` 有文档且未注销（与 getUserSession.isRegistered、ERP 会员 CRM 同口径），含员工账号。
 * 写入：与 receiveCoupon 同构的 user_coupons 文档（receiveType 换成 auto_campaign，前端 / 计价 / 核销均不读该字段）；
 *       `_id = cw_<模板id>_<openid>` 与 receiveCoupon 的活动券同一规则 → 手动领过的不再发、并发 / 重跑只落一张。
 * 不做：不改 receiveCoupon / getUserCoupons / makeOrder；不写 user_behaviors（不是用户行为）；
 *       模板设了 totalStock 时拒绝发放（本函数不扣库存）。
 *
 * 调用：
 *   - 定时触发：event.Type === 'Timer' 且无 OPENID → 窗口内批量发放，窗口外空转。
 *   - { action: 'dryRun' }：只返回将发人数，不写库；仅超管（staffGuard requireSuperAdmin 或 ADMIN_OPS_KEY）。
 */
const cloud = require('wx-server-sdk')
const { normalizeCouponChannel } = require('./couponChannel')
const { validateDiscountCoupon } = require('./couponDiscountRules')
const { assertStaff } = require('./staffGuard')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const CAMPAIGNS = [
  {
    key: 'double11_2026',
    couponId: '40407fa6e7f8342ac6a47201bfc92a15',
    issueFrom: '2026-10-30T00:00:00+08:00',
    issueUntil: '2026-11-15T23:59:59+08:00'
  }
]

const RECEIVE_TYPE = 'auto_campaign'
const DAY_MS = 24 * 60 * 60 * 1000
const PAGE = 1000
const CONCURRENCY = 20
// 云函数超时 60s：留出读名单与收尾的余量，没发完的下一轮接着发
const TIME_BUDGET_MS = 45 * 1000

function toInstant(raw) {
  if (raw == null || raw === '') return null
  const v = raw && typeof raw === 'object' && !(raw instanceof Date) && raw.$date != null ? raw.$date : raw
  const d = v instanceof Date ? new Date(v.getTime()) : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 与 receiveCoupon.resolveUserCouponExpire 同义（本函数只发有 fixedExpireTime 的模板） */
function resolveUserCouponExpire(coupon, nowMs) {
  const fixed = toInstant(coupon.fixedExpireTime)
  if (coupon.expireDays) {
    const byDays = new Date(nowMs + coupon.expireDays * DAY_MS)
    return byDays.getTime() < fixed.getTime() ? byDays : fixed
  }
  return fixed
}

function campaignUserCouponId(couponId, openid) {
  const id = `cw_${couponId}_${openid}`
  return /^[\w-]{1,64}$/.test(id) ? id : ''
}

function parseMinSpend(coupon) {
  if (coupon.minSpend != null && coupon.minSpend !== '') {
    const n = parseFloat(coupon.minSpend)
    if (!isNaN(n)) return n
  }
  if (coupon.condition) {
    const n = parseFloat(String(coupon.condition).replace(/[^0-9.]/g, ''))
    if (!isNaN(n)) return n
  }
  return 0
}

/** 窗口 = 活动常量 ∩ 模板；返回 { open, reason } */
function windowState(campaign, coupon, nowMs) {
  const from = toInstant(campaign.issueFrom)
  const until = toInstant(campaign.issueUntil)
  if (!from || !until) return { open: false, reason: '活动时刻配置异常' }
  if (nowMs < from.getTime()) return { open: false, reason: '未到发放时间' }
  if (nowMs > until.getTime()) return { open: false, reason: '已过发放时间' }
  if (!coupon) return { open: false, reason: '模板不存在' }
  if (!coupon.active) return { open: false, reason: '模板已下架' }
  const start = coupon.startTime ? toInstant(coupon.startTime) : null
  const end = coupon.endTime ? toInstant(coupon.endTime) : null
  if (coupon.startTime && (!start || nowMs < start.getTime())) return { open: false, reason: '模板未开始' }
  if (coupon.endTime && (!end || nowMs > end.getTime())) return { open: false, reason: '模板已截止' }
  const fixed = toInstant(coupon.fixedExpireTime)
  if (!fixed) return { open: false, reason: '模板缺统一到期' }
  if (fixed.getTime() <= nowMs) return { open: false, reason: '模板已到期' }
  return { open: true, reason: '' }
}

function templateProblem(coupon) {
  if (coupon.totalStock !== undefined) return '模板设了 totalStock，本函数不扣库存，拒绝发放'
  if (Number(coupon.limitPerUser) !== 1) return '仅支持每人限 1 张的模板'
  if ((coupon.type || 'cash') !== 'discount') return '仅支持折扣券模板'
  const rateCheck = validateDiscountCoupon(Number(coupon.value) || 0)
  if (!rateCheck.ok) return rateCheck.msg || '折扣券不得低于7.5折'
  return ''
}

/** 与 receiveCoupon 写入的 userCouponData 同构（字段与顺序一致，receiveType 除外） */
function buildUserCoupon(coupon, couponId, openid, nowMs) {
  return {
    _openid: openid,
    couponId: couponId,
    title: coupon.name || coupon.title,
    type: coupon.type || 'cash',
    value: coupon.value,
    minSpend: parseMinSpend(coupon),
    status: 'unused',
    createTime: db.serverDate(),
    expireTime: resolveUserCouponExpire(coupon, nowMs),
    receiveType: RECEIVE_TYPE,
    shareUserId: null,
    image: coupon.image || null,
    channel: normalizeCouponChannel(coupon.channel),
    stackable: coupon.stackable === true
  }
}

async function fetchOpenids(coll, where) {
  const out = new Set()
  for (let skip = 0; ; skip += PAGE) {
    const res = await db.collection(coll).where(where).orderBy('_id', 'asc').skip(skip).limit(PAGE)
      .field({ _openid: true }).get()
    const rows = res.data || []
    rows.forEach((r) => { if (r && r._openid) out.add(r._openid) })
    if (rows.length < PAGE) break
  }
  return out
}

async function plan(campaign) {
  const members = await fetchOpenids('users', { status: _.neq('cancelled') })
  const held = await fetchOpenids('user_coupons', { couponId: campaign.couponId })
  const pending = []
  let invalidId = 0
  members.forEach((openid) => {
    if (held.has(openid)) return
    if (!campaignUserCouponId(campaign.couponId, openid)) { invalidId++; return }
    pending.push(openid)
  })
  return { members: members.size, alreadyHeld: members.size - pending.length - invalidId, invalidId, pending }
}

async function issueOne(coupon, campaign, openid, nowMs) {
  const _id = campaignUserCouponId(campaign.couponId, openid)
  try {
    await db.collection('user_coupons').add({ data: { ...buildUserCoupon(coupon, campaign.couponId, openid, nowMs), _id } })
    return 'issued'
  } catch (e) {
    const dup = await db.collection('user_coupons').where({ _id }).count().catch(() => null)
    return dup && dup.total > 0 ? 'dup' : 'failed'
  }
}

async function runCampaign(campaign, { dryRun, startedAt }) {
  const nowMs = Date.now()
  let coupon = null
  try {
    coupon = (await db.collection('coupons').doc(campaign.couponId).get()).data || null
  } catch (e) {
    coupon = null
  }
  const win = windowState(campaign, coupon, nowMs)
  const problem = coupon ? templateProblem(coupon) : ''
  const base = { campaign: campaign.key, windowOpen: win.open, reason: win.reason || problem }

  if (!dryRun && (!win.open || problem)) return { ...base, skipped: true }
  if (dryRun && (!coupon || problem)) return { ...base, wouldIssue: 0 }

  const p = await plan(campaign)
  const summary = { ...base, members: p.members, alreadyHeld: p.alreadyHeld, invalidId: p.invalidId }
  if (dryRun) return { ...summary, wouldIssue: p.pending.length }

  let issued = 0
  let dup = 0
  let failed = 0
  let budgetHit = false
  for (let i = 0; i < p.pending.length; i += CONCURRENCY) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) { budgetHit = true; break }
    const chunk = p.pending.slice(i, i + CONCURRENCY)
    const results = await Promise.all(chunk.map((openid) => issueOne(coupon, campaign, openid, Date.now())))
    results.forEach((r) => { if (r === 'issued') issued++; else if (r === 'dup') dup++; else failed++ })
  }
  return { ...summary, pending: p.pending.length, issued, dup, failed, budgetHit }
}

exports.main = async (event) => {
  const ev = event || {}
  const startedAt = Date.now()
  const openid = (cloud.getWXContext() || {}).OPENID || ''

  if (ev.action === 'dryRun') {
    const guard = await assertStaff(db, openid, { requireSuperAdmin: true, adminOpsKey: String(ev.opsKey || '') })
      .catch((e) => ({ ok: false, msg: (e && e.message) || '鉴权异常' }))
    if (!guard || !guard.ok) return { success: false, msg: (guard && guard.msg) || '无权限：仅超管' }
    const results = []
    for (const c of CAMPAIGNS) results.push(await runCampaign(c, { dryRun: true, startedAt }))
    return { success: true, dryRun: true, now: new Date(startedAt).toISOString(), results }
  }

  if (openid || ev.Type !== 'Timer') {
    return { success: false, msg: '仅定时触发器调用' }
  }

  const results = []
  for (const c of CAMPAIGNS) {
    const r = await runCampaign(c, { dryRun: false, startedAt })
    results.push(r)
    console.log('[issueCampaignCoupon]', JSON.stringify(r))
  }
  return { success: true, results }
}
