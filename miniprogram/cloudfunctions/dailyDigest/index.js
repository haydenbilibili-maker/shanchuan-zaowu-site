/**
 * 每日日报（dailyDigest）
 *
 * 产品口径：按自然日汇总「小程序数据 / 订单数据 / 门店营收」，生成一份日报，
 * 通过**工作信息**（workflow 队列）发给超管；后续可扩展到店长/店员/标本师/股东/主播/投资人。
 *
 * ── 为什么是「定时生成 + 落库」而不是「打开时实时算」 ──────────────────────
 *   1. 日报要**可回看**：打开时实时算 = 昨天的数字会被今天的数据覆盖（订单会退款、账本会补录），
 *      历史日报必须冻结在生成那一刻；
 *   2. 一次日报要查 4 类集合（analytics_daily / orders×7 个聚合 / daily_revenues / store_ledger /
 *      ops_shipments），压在用户打开小程序那一刻做，既慢又会随并发重复烧读次数；
 *   3. 本仓已有定时触发器先例：`sweepExpiredOrders/config.json` 的 `triggers[].type='timer'`
 *      （cron 6 段 `0 0/5 * * * * *`），照它的形态新增一个即可。
 *   代价：数字是「生成时点」的快照；日报 payload 里记 `generatedAt` 明示这一点。
 *
 * ── 触发 ────────────────────────────────────────────────────────────────
 *   定时：config.json triggers，cron `0 20 * * * * *` = **每小时的第 20 分钟**跑一次。
 *     为什么不是「每天固定一刻」：腾讯云 SCF 定时触发器的 cron 时区语义在不同环境里
 *     说法不一（本仓既有 8 个 trigger 全是 7 段，但**没有任何一处写明时区**），
 *     赌一个时区一旦赌错就是「每天在错误的时间发日报」这种只有人肉才能发现的故障。
 *     改成每小时跑 + **内部日切 + 确定性幂等键**：
 *       · dayKey 取「最后一次北京日切之前的那一天」（见 resolveTargetDayKey），
 *         所以无论 cron 解释成 UTC 还是东八，北京日切后第一次运行生成的都正是那一天；
 *       · 幂等键 = daily_digest:<role>:<dayKey>:<openid>（不含时刻），
 *         所以同一天无论被触发多少次，每个收件人**只会有一封**；
 *       · 代价：一天最多 24 次空跑（每次 1 次 where 查询/人），换来的是「时区猜错也不会错发」。
 *   手动：callFunction({ name:'dailyDigest', data:{ action:'build', dayKey, role, dryRun, internalKey } })
 *        必须携带 DAILY_DIGEST_INTERNAL_KEY（或回落到 PAY_CALLBACK_INTERNAL_KEY），
 *        禁止客户端空调用（同 sweepExpiredOrders 的来源判定约定）。
 *        持 ADMIN_OPS_KEY 的运维侧只能 dryRun（forcedDryRun），不能发。
 *
 * ── 部署 ────────────────────────────────────────────────────────────────
 *   新函数：tcb fn deploy dailyDigest
 *   环境变量：ADMIN_OPS_KEY（与既有函数同一把，供 /api/cloud-fn 与一次性脚本只读核对）
 *             ＋ DAILY_DIGEST_INTERNAL_KEY（手动补发用；不配则手动补发放不开，定时不受影响）
 *   定时触发器：部署后须在云开发控制台确认 Timer 已创建（config.json 不一定自动生效）
 *   索引建议（user_messages）：dedupeKey（幂等检查用，已在 ensure-dedupe-indexes.cjs 登记）；
 *                             type + openid（prune 用）
 */
const cloud = require('wx-server-sdk')
const { reportCatalog, ENABLED_ROLES, ROLES, ROLE_SLICES } = require('./reportCatalog')
const { collectRaw } = require('./dailyDigestCollect')
const {
  buildDigest,
  buildMessageText,
  beijingDayKey,
  previousDayKey,
  assertDayKey
} = require('./dailyDigestCore')
const {
  writeDigestMessage,
  pruneOldDigests,
  retentionCutoffDayKey
} = require('./dailyDigestStore')
const { isClientSource } = require('./sourceOrigin')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const INTERNAL_KEY =
  process.env.DAILY_DIGEST_INTERNAL_KEY || process.env.PAY_CALLBACK_INTERNAL_KEY || ''

const MAX_RECIPIENTS = 200
const SAFE_ROLE = ROLES.SUPER_ADMIN

function isTimerEvent (event) {
  const t = (event && (event.Type || event.triggerType || event.triggerSource)) || ''
  return /timer/i.test(String(t)) || !!(event && event.TriggerName)
}

function allowManual (event) {
  if (!INTERNAL_KEY) return false
  const key = String((event && (event.internalKey || event.callbackKey)) || '').trim()
  return !!key && key === INTERNAL_KEY
}

/** 运维密钥：与 cloudfunctions 里既有的 ADMIN_OPS_KEY 约定一致（见 staffGuard 的 admin_ops_key 分支） */
function hasAdminOpsKey (event) {
  const expected = process.env.ADMIN_OPS_KEY || ''
  if (!expected) return false
  const got = String((event && event.adminOpsKey) || '').trim()
  return !!got && got === expected
}

/** 收件人：staff_members 里 status='active' 的成员（超管白名单里的人也在其中） */
async function loadRecipients (role) {
  const out = []
  try {
    const res = await db.collection('staff_members')
      .where({ status: 'active' })
      .limit(MAX_RECIPIENTS)
      .get()
    for (const row of (res.data || [])) {
      const openid = String(row.openid || '').trim()
      if (!openid) continue
      const roles = Array.isArray(row.roles) && row.roles.length ? row.roles.map(String) : [String(row.role || '')]
      const isSuper = roles.indexOf('super_admin') !== -1
      // 第一批只发超管：角色的工作区切片能力在 workspaceRoles/staffGuard，这里只做最小判定
      if (role === ROLES.SUPER_ADMIN && !isSuper) continue
      out.push({ openid, name: row.name || '', staffId: row._id || '', roles, isSuper })
    }
  } catch (e) {
    console.warn('dailyDigest loadRecipients failed:', e && e.message)
  }
  return out
}

/**
 * 定时任务的目标日 = 「最后一次北京日切之前的那一天」。
 *
 * 例：北京 2026-09-21 00:05 触发 → 取 2026-09-20；
 *     北京 2026-09-21 13:00 触发 → 仍取 2026-09-20（幂等键保证只发一封）。
 * 这样即使 cron 时区被解释成 UTC（= 北京 08:00 才日切），当天 08:00 之后第一次运行
 * 生成的也仍然是 2026-09-20，**不会把没结束的一天当成完整一天发出去**。
 */
function resolveTargetDayKey (nowMs) {
  return previousDayKey(nowMs)
}

exports.main = async (event = {}) => {
  const action = String(event.action || '').trim() ||
    (isTimerEvent(event) ? 'runDaily' : 'catalog')

  if (action === 'catalog') {
    return { success: true, catalog: reportCatalog() }
  }

  // 只读预览：持 ADMIN_OPS_KEY 的运维侧（ERP / 一次性脚本）可核对口径，**不写任何消息**。
  // 与 getStudioDashboard 同一套鉴权形态；「只能看不能发」由 forcedDryRun 强制。
  const adminOpsOk = hasAdminOpsKey(event)

  // 写操作（runDaily / build）必须来自非客户端来源 + 内部密钥
  if (isClientSource()) {
    return { success: false, code: 'FORBIDDEN', msg: '日报生成仅限定时任务或内部调用' }
  }
  if (!isTimerEvent(event) && !allowManual(event) && !adminOpsOk) {
    return {
      success: false,
      code: INTERNAL_KEY ? 'FORBIDDEN' : 'INTERNAL_KEY_MISSING',
      msg: INTERNAL_KEY ? '缺少或错误的 internalKey' : '云函数未配置 DAILY_DIGEST_INTERNAL_KEY'
    }
  }
  const forcedDryRun = adminOpsOk && !allowManual(event) && !isTimerEvent(event)

  const role = ENABLED_ROLES.indexOf(String(event.role || '')) !== -1 ? String(event.role) : SAFE_ROLE
  const now = Number(event.now) > 0 ? Number(event.now) : Date.now()
  // 定时任务默认生成「前一天」（东八日）；手动可指定 dayKey 回补某一天
  const dayKey = assertDayKey(event.dayKey) || resolveTargetDayKey(now)
  const dryRun = event.dryRun === true || forcedDryRun
  const slice = ROLE_SLICES[role] || ROLE_SLICES[SAFE_ROLE]

  const raw = await collectRaw(db, dayKey, { metrics: slice.metrics })
  const digest = buildDigest({ ...raw, dayKey, role })
  const content = buildMessageText(digest)
  const payload = {
    v: 1,
    dayKey,
    role,
    roleLabel: digest.roleLabel,
    generatedAt: new Date(now).toISOString(),
    generatedAtBeijing: beijingDayKey(now),
    metrics: digest.metrics,
    sections: digest.sections.map((s) => ({ key: s.key, label: s.label, ids: s.metrics.map((m) => m.id) })),
    missing: digest.missing,
    // 取数失败单独回传（含原因）—— 故障不许伪装成"当日无数据"
    failed: digest.failed || [],
    catalogVersion: 'daily-digest-v1'
  }

  const recipients = await loadRecipients(role)
  const results = []
  for (const r of recipients) {
    if (dryRun) {
      results.push({ openid: r.openid, dryRun: true })
      continue
    }
    const wrote = await writeDigestMessage(db, {
      openid: r.openid,
      dayKey,
      role,
      title: digest.title,
      content,
      payload
    })
    results.push({ openid: r.openid, ...wrote })
  }

  let prune = null
  if (!dryRun) {
    const cutoff = retentionCutoffDayKey(beijingDayKey(now))
    prune = { cutoff, byRecipient: [] }
    for (const r of recipients) {
      const p = await pruneOldDigests(db, { openid: r.openid, beforeDayKey: cutoff })
      prune.byRecipient.push({ openid: r.openid, ...p })
    }
  }

  const sent = results.filter((x) => x.success && !x.skipped).length
  const skipped = results.filter((x) => x.skipped).length
  const failed = results.filter((x) => x.success === false).length

  return {
    success: failed === 0,
    dayKey,
    role,
    roleLabel: digest.roleLabel,
    dryRun,
    recipients: recipients.length,
    sent,
    skipped,
    failed,
    results,
    prune,
    metricsCount: digest.metrics.length,
    missing: digest.missing,
    failed: digest.failed || [],
    // 抽样返回结构化日报，便于人工/脚本核对（不写库时也能看数）
    digest: dryRun ? payload : { dayKey, role, metrics: payload.metrics }
  }
}
