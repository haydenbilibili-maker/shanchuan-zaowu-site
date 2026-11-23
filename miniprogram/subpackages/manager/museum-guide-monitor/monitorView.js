/**
 * 超管「博物君」监测 —— 报表视图纯函数（2026-11-23；守卫 test:museum-guide-monitor 直接 require）
 * 界面不出现集合名 / 字段名；没有数据写「—」，不编 0。
 */
const DAILY_LIMIT_OPTIONS = [10, 20, 30, 50, 100]

/** 失败分布：状态 → 人话 */
const FAIL_LABELS = [
  ['ai_service', '模型或密钥出错'],
  ['risky', '问题未过内容安全'],
  ['answer_risky', '回答被换成安全回复'],
  ['quota', '当日次数用完'],
  ['off', '闭馆时来问'],
  ['invalid', '问题为空或过长']
]

/** 馆内去处（与博物君云函数 knowledge.PLACES 的 key 一致） */
const PLACE_LABELS = {
  atlas: '山海图鉴', identify: 'AI 鉴定', care: '标本养护', booking: '预约参观',
  donations: '我的捐赠', achievements: '我的成就', shop: '馆藏'
}

const ENTRY_LABELS = { user: '我的', atlas: '图鉴页', identify: 'AI 鉴定结果', share: '分享卡片', daily: '今日一物', quiz: '博物小测', notes: '博物笔记', workshop: '标本工坊', home: '首页口播', direct: '其它' }

function msText(ms) {
  if (typeof ms !== 'number') return '—'
  return ms < 1000 ? `${ms} 毫秒` : `${(ms / 1000).toFixed(1)} 秒`
}

function rateText(r) {
  return typeof r === 'number' ? `${r}%` : '—'
}

function shortDay(day) {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(day || ''))
  return m ? `${m[1]}.${m[2]}` : String(day || '')
}

function timeText(ts) {
  if (!ts) return ''
  const d = new Date(ts + 8 * 3600 * 1000)
  const p = (n) => (n < 10 ? `0${n}` : String(n))
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

function listOf(rows, labels) {
  const total = (rows || []).reduce((a, r) => a + r.n, 0)
  return (rows || []).map((r) => ({ key: r.key, label: labels[r.key] || r.key, n: r.n, pct: total ? Math.round((r.n / total) * 100) : 0 }))
}

/**
 * 云函数 overview → 页面数据。
 * bars 的宽度按区间内最大提问数折算（最大的一天 = 100%），没有提问的天宽 0。
 */
/** 首页口播「馆内通知」：最多 3 条、每条 ≤ 36 字（与云函数 museumGuideMonitor 同口径） */
const NOTICE_MAX = 3
const NOTICE_LEN = 36

/** 编辑框草稿：已存的通知补满 3 格（空格子留空） */
function noticeDrafts(notices) {
  const list = Array.isArray(notices) ? notices.slice(0, NOTICE_MAX) : []
  while (list.length < NOTICE_MAX) list.push('')
  return list
}

function buildView(d) {
  const data = d || {}
  const series = data.series || []
  const max = series.reduce((a, s) => Math.max(a, s.asks), 0)
  const t = data.totals || {}
  const today = data.today || {}
  const cfg = data.config || {}
  const limit = cfg.dailyLimit || cfg.defaultLimit || 30
  return {
    config: {
      enabled: cfg.enabled !== false,
      stateText: cfg.enabled === false ? '闭馆中' : '开馆中',
      dailyLimit: cfg.dailyLimit || null,
      limitText: cfg.dailyLimit ? `每人每天 ${cfg.dailyLimit} 问` : `每人每天 ${cfg.defaultLimit || 30} 问（默认）`,
      notices: Array.isArray(cfg.notices) ? cfg.notices.slice(0, NOTICE_MAX) : [],
      updatedText: cfg.updatedAt ? `最近修改 ${timeText(cfg.updatedAt)}${cfg.updatedByName ? ' · ' + cfg.updatedByName : ''}` : ''
    },
    kpis: [
      { k: '今日提问', v: String(today.asks || 0) },
      { k: '今日人数', v: String(today.users || 0) },
      { k: `${data.days || 7} 日成功率`, v: rateText(t.successRate) },
      { k: '平均耗时', v: msText(t.avgMs) },
      { k: '九成不超过', v: msText(t.p90Ms) },
      // 单人今天问到几次：接近额度说明额度可能偏紧，或有人在刷
      { k: '单人今日最多', v: today.maxPerUser ? `${today.maxPerUser} / ${limit}` : '—' }
    ],
    totalsText: `${data.days || 7} 天共 ${t.asks || 0} 问 · ${t.users || 0} 人 · 回答 ${t.answered || 0} 次`,
    // 回答反馈：投票的人少时满意度不稳，票数一起写出来
    satisfactionText: data.votes && (data.votes.up + data.votes.down)
      ? `满意度 ${rateText(data.votes.rate)}（有帮助 ${data.votes.up} · 没帮助 ${data.votes.down}）`
      : '满意度 —（还没有人投票）',
    bars: series.map((s) => ({
      day: s.day,
      label: shortDay(s.day),
      asks: s.asks,
      width: max ? Math.round((s.asks / max) * 100) : 0,
      sub: s.asks ? `${s.users} 人${s.failed ? ' · 出错 ' + s.failed : ''}${s.risky ? ' · 拦下 ' + s.risky : ''}${s.quota ? ' · 满额 ' + s.quota : ''}` : ''
    })).reverse(),
    fails: FAIL_LABELS.map(([key, label]) => ({ key, label, n: (data.fails && data.fails[key]) || 0 })).filter((f) => f.n > 0),
    species: (data.topSpecies || []).map((s) => ({ no: s.no, label: `No.${s.no} ${s.zh || ''}`.trim(), n: s.n })),
    actions: listOf(data.actions, PLACE_LABELS),
    entries: listOf(data.entries, ENTRY_LABELS),
    models: listOf(data.models, {}),
    truncatedText: data.truncated ? '记录太多，本页只统计了最早的 2 万条' : ''
  }
}

/** 错误 → 给运营看的一句话（2026-11-23：原先把 errMsg 原文连堆栈一起渲染给超管了） */
const ERROR_NOT_DEPLOYED = '监测函数还没部署，请在开发者工具里上传 museumGuideMonitor'
const ERROR_TIMEOUT = '报表算得有点久，超时了；过一会儿再试'
const ERROR_NETWORK = '网络不太稳，没能取回报表'
const ERROR_GENERIC = '暂时取回报表失败，过一会儿再试'

function friendlyError(err) {
  if (err && err.business) return String(err.message || ERROR_GENERIC)
  const s = String((err && (err.errMsg || err.message)) || err || '')
  if (/FUNCTION_NOT_FOUND|FunctionName parameter could not be found|-505005/i.test(s)) return ERROR_NOT_DEPLOYED
  if (/timeout|timed out|超时/i.test(s)) return ERROR_TIMEOUT
  if (/network|request:fail|errCode: -1\b/i.test(s)) return ERROR_NETWORK
  return ERROR_GENERIC
}

module.exports = { NOTICE_MAX, NOTICE_LEN, noticeDrafts, DAILY_LIMIT_OPTIONS, FAIL_LABELS, PLACE_LABELS, ENTRY_LABELS, buildView, msText, shortDay, friendlyError, ERROR_NOT_DEPLOYED }
