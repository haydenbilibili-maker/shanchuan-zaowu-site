/**
 * AI 智能中心 · 虚拟员工的主动巡检（2026-11-23 第六轮，产品负责人「让角色更具有主动性，当发现问题时可主动通过
 * 工作信息通道发送信息到超管角色」）
 *
 * 做法：
 *   - **规则判定，不让模型决定要不要报**：阈值写死在下面的 RULES 里，读的是 staffContext 的同一份经营快照；
 *     模型只在超管点进来追问时才参与 —— 巡检本身不花模型调用，也不会「编出一个问题」。
 *   - 每条问题归到一位同事，用 TA 的口吻写成一封工作信息（标题带名字与岗位，正文带依据数字与建议）；
 *   - 投递走既有 dispatchMessage（category 'ops' → 工作信息队列），收件人是超管（staffGuard.resolveSuperAdminOpenids）；
 *   - **去重**：relatedId = 规则 id + 北京时间日期，dispatchMessage 按 eventType + relatedId + openid 去重 → 同一问题每人每天最多一封；
 *   - **开关**：museum_guide_config/staff_patrol.enabled（缺省开启）；超管在 AI 智能中心页可关可开、可「立即巡检」。
 *
 * 纯函数（findIssues / letterOf）不碰 wx / db，守卫直接调。
 */
const { STAFF_ROLES } = require('./staffPersonas')
const { changePct } = require('./staffContext')

const EVENT_TYPE = 'staff_ai_alert'
const CONFIG_COLLECTION = 'museum_guide_config'
const PATROL_DOC = 'staff_patrol'
const MAX_ISSUES = 4

function money(n) {
  const v = Math.round(Number(n) || 0)
  return v >= 10000 ? `${(v / 10000).toFixed(1)} 万` : String(v)
}

/**
 * 规则：每条 = 归属同事 + 判定 + 用 TA 的口吻说清「看到了什么 / 为什么要紧 / 建议先做什么」。
 * 阈值偏保守（宁可少报，不让超管被打扰到关掉它）；样本太小时不判。
 */
const RULES = [
  {
    id: 'orders_drop', roleId: 'store_manager', level: 'high',
    test: (s) => {
      const t = s.trend
      const p = t ? changePct(t.last7, t.prev7) : null
      return t && t.prev7 >= 5 && p != null && p <= -30 ? { p, t } : null
    },
    title: ({ p }) => `近 7 天已付订单少了 ${Math.abs(p)}%`,
    detail: ({ p, t }) => `我对了一下这两周的单：近 7 天已付 ${t.last7} 笔，前 7 天是 ${t.prev7} 笔，掉了 ${Math.abs(p)}%。先别急着打折，我想先看看是进店的人少了，还是进来了没成交。建议这两天先在门口和收银各记一下客流。`,
    ask: '近 7 天订单掉得厉害，帮我拆一下是客流还是转化的问题，先做哪三件事？'
  },
  {
    id: 'low_stock', roleId: 'procurement', level: 'warn',
    test: (s) => {
      const p = s.products
      if (!p || p.onSale < 10) return null
      const need = Math.max(5, Math.ceil(p.onSale * 0.15))
      return p.lowStock >= need ? { p } : null
    },
    title: ({ p }) => `${p.lowStock} 件在售藏品快见底了`,
    detail: ({ p }) => `我把在售库存过了一遍：${p.onSale} 件里有 ${p.lowStock} 件只剩 3 件以内，约占 ${Math.round((p.lowStock / p.onSale) * 100)}%。这周如果有活动，最好先把卖得动的那几件补上；补不上的，详情页提示一下「少量」，免得顾客下单后等。`,
    ask: '低库存的藏品哪些最该先补？按优先级排一下，并说说依据。'
  },
  {
    id: 'ops_open', roleId: 'procurement', level: 'warn',
    test: (s) => (s.ops && s.ops.openCount >= 8 ? { o: s.ops } : null),
    title: ({ o }) => `${o.openCount} 张店内采购单还没结`,
    detail: ({ o }) => `近 30 天的店内采购里，还有 ${o.openCount} 张单停在下单、待付或待发的状态（合计 ¥${money(o.amount)}）。单子拖久了，到货和账期都容易对不上，建议这周集中跟一次。`,
    ask: '店内采购未结的单比较多，怎么排一个清单把它们跟完？'
  },
  {
    id: 'refund_high', roleId: 'cfo', level: 'high',
    test: (s) => {
      const o = s.orders
      if (!o || o.gmv < 1000) return null
      const rate = o.refund / o.gmv
      return rate >= 0.08 ? { o, rate } : null
    },
    title: ({ rate }) => `近 30 天退款占实付 ${Math.round(rate * 100)}%`,
    detail: ({ o, rate }) => `近 30 天实付 ¥${money(o.gmv)}，退款 ¥${money(o.refund)}，占 ${Math.round(rate * 100)}%，比我心里的警戒线（8%）高。退款会直接吃掉现金流，想先弄清楚是哪几类藏品、哪种原因退得多。`,
    ask: '退款占比偏高，帮我列一下排查顺序和要看的数据。'
  },
  {
    id: 'leave_pending', roleId: 'hr_manager', level: 'warn',
    test: (s) => (s.hr && s.hr.pendingLeaves >= 3 ? { h: s.hr } : null),
    title: ({ h }) => `${h.pendingLeaves} 条请假还在等审批`,
    detail: ({ h }) => `现在有 ${h.pendingLeaves} 条请假申请还没批。批晚了，排班就容易临时补人，同事心里也不踏实。方便的时候集中处理一下，我可以帮你把这几天的人手先排一排。`,
    ask: '有几条请假待审批，帮我看看这几天的排班怎么补位。'
  },
  {
    id: 'attendance', roleId: 'hr_manager', level: 'warn',
    test: (s) => (s.hr && s.hr.late + s.hr.early >= 10 ? { h: s.hr } : null),
    title: ({ h }) => `本月迟到早退已有 ${h.late + h.early} 次`,
    detail: ({ h }) => `本月考勤里，迟到 ${h.late} 次、早退 ${h.early} 次。我不想点谁的名，更想先看看是不是排班或通勤出了问题。建议先把班次时间和高峰时段对一下。`,
    ask: '本月迟到早退偏多，先从排班还是制度入手？'
  },
  {
    id: 'members_drop', roleId: 'marketing', level: 'warn',
    test: (s) => {
      const u = s.users
      const p = u ? changePct(u.last7, u.prev7) : null
      return u && u.prev7 >= 5 && p != null && p <= -40 ? { u, p } : null
    },
    title: ({ p }) => `新会员比前一周少了 ${Math.abs(p)}%`,
    detail: ({ u, p }) => `近 7 天新增会员 ${u.last7} 人，前 7 天是 ${u.prev7} 人，少了 ${Math.abs(p)}%。拉新一断，后面的复购都会跟着淡。我想这周先补一条能让熟客愿意转发的内容。`,
    ask: '新会员掉得多，这周用什么内容把拉新补回来？'
  },
  {
    id: 'no_orders', roleId: 'data_analyst', level: 'high',
    test: (s) => (s.trend && s.trend.last7 === 0 && s.trend.prev7 >= 3 ? { t: s.trend } : null),
    title: () => '近 7 天一笔已付订单都没有',
    detail: ({ t }) => `前 7 天还有 ${t.prev7} 笔已付订单，近 7 天一笔都没有。这不太像正常波动，我更担心是支付或订单数据出了问题。建议先下一笔测试单，确认支付和记账都通。`,
    ask: '近 7 天没有已付订单，帮我列一份排查清单：先查数据链路还是业务？'
  }
]

/** 经营快照 → 问题清单（按严重程度排序，最多 MAX_ISSUES 条）。纯函数。 */
function findIssues(snap) {
  const s = snap || {}
  const out = []
  RULES.forEach((r) => {
    let hit = null
    try { hit = r.test(s) } catch (e) { hit = null }
    if (!hit) return
    const role = STAFF_ROLES[r.roleId]
    out.push({
      id: r.id,
      roleId: r.roleId,
      person: role ? role.person : '',
      roleName: role ? role.name : '',
      level: r.level,
      title: r.title(hit),
      detail: r.detail(hit),
      ask: r.ask
    })
  })
  out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'high' ? -1 : 1))
  return out.slice(0, MAX_ISSUES)
}

function bjDayText(ts) {
  return new Date((Number(ts) || Date.now()) + 8 * 3600000).toISOString().slice(0, 10)
}

/** 问题 → 一封工作信息（标题带名字与岗位，正文落款；点开进 AI 中心对应同事，问题预填好） */
function letterOf(issue, asOf, now) {
  const day = bjDayText(now)
  return {
    eventType: EVENT_TYPE,
    relatedId: `${issue.id}:${day}`,
    title: `${issue.person}（${issue.roleName}）：${issue.title}`,
    content: `${issue.detail}\n\n${asOf ? `（依据北京时间 ${asOf} 的经营数据）\n` : ''}—— ${issue.person}\n点开和我聊聊，我把细节和建议一起给你。`,
    actionUrl: `subpackages/extra/ai-center/index?roleId=${issue.roleId}&ask=${encodeURIComponent(issue.ask)}`,
    category: 'ops',
    queue: 'workflow'
  }
}

async function readPatrolConfig(db) {
  try {
    const r = await db.collection(CONFIG_COLLECTION).doc(PATROL_DOC).get()
    const d = (r && r.data) || {}
    return { enabled: d.enabled !== false, lastRunAt: Number(d.lastRunAt) || 0, lastIssues: Number(d.lastIssues) || 0, lastSent: Number(d.lastSent) || 0 }
  } catch (e) {
    return { enabled: true, lastRunAt: 0, lastIssues: 0, lastSent: 0 }
  }
}

async function writePatrolConfig(db, patch) {
  const data = Object.assign({}, patch, { updatedAt: Date.now() })
  try {
    const r = await db.collection(CONFIG_COLLECTION).doc(PATROL_DOC).update({ data })
    if (r && r.stats && r.stats.updated) return
  } catch (e) { /* 文档不存在走 set */ }
  const cur = await readPatrolConfig(db)
  await db.collection(CONFIG_COLLECTION).doc(PATROL_DOC).set({ data: Object.assign({ enabled: cur.enabled }, data) })
}

/**
 * 跑一次巡检：判问题 → 发给超管。dispatch 失败不抛（少一封不影响其它）。
 * @param {{ db, snapshot, asOf, recipients: string[], dispatch: (payload) => Promise<any>, now?: number, dryRun?: boolean }} ctx
 */
async function runPatrol(ctx) {
  const now = ctx.now || Date.now()
  const issues = findIssues(ctx.snapshot)
  let sent = 0
  if (!ctx.dryRun) {
    for (const issue of issues) {
      const letter = letterOf(issue, ctx.asOf, now)
      for (const openid of ctx.recipients || []) {
        try {
          const r = await ctx.dispatch(Object.assign({ openid }, letter))
          if (r && r.success && !r.skipped) sent += 1
        } catch (e) { /* 少一封不影响其它 */ }
      }
    }
    try { await writePatrolConfig(ctx.db, { lastRunAt: now, lastIssues: issues.length, lastSent: sent }) } catch (e) { /* ignore */ }
  }
  return { issues, sent }
}

module.exports = { RULES, findIssues, letterOf, runPatrol, readPatrolConfig, writePatrolConfig, bjDayText, EVENT_TYPE, PATROL_DOC, CONFIG_COLLECTION, MAX_ISSUES }
