/**
 * AI 智能中心 · 纯视图函数（2026-11-23 第六轮）。不碰 wx / 云，守卫 test:ai-center A8 直接调。
 */

/** 环比箭头：null（样本太小）不出，0 写「持平」 */
function changeText(p) {
  if (p == null || !Number.isFinite(Number(p))) return ''
  const n = Number(p)
  return n === 0 ? '持平' : `${n > 0 ? '↑' : '↓'}${Math.abs(n)}%`
}

function moneyText(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Math.round(Number(n))
  return v >= 10000 ? `¥${(v / 10000).toFixed(1)}万` : `¥${v}`
}

function countText(n) {
  return n == null || !Number.isFinite(Number(n)) ? '—' : String(n)
}

/**
 * 经营脉搏四格：近 7 天已付单 / 近 7 天实付 / 低库存 / 近 7 天新会员。读不到写「—」不编 0；
 * 订单与会员带环比，下降时 tone=down（页面染暗红），低库存 > 0 时 tone=warn。
 */
function pulseCells(pulse) {
  const p = pulse || {}
  const down = (x) => (x != null && x < 0 ? 'down' : '')
  return [
    { k: 'orders', label: '近 7 天已付', value: countText(p.orders7), sub: changeText(p.ordersChange), tone: down(p.ordersChange) },
    { k: 'gmv', label: '近 7 天实付', value: moneyText(p.gmv7), sub: p.today != null ? `今天 ${p.today} 笔` : '', tone: '' },
    { k: 'stock', label: '低库存', value: countText(p.lowStock), sub: p.onSale != null ? `在售 ${p.onSale}` : '', tone: p.lowStock > 0 ? 'warn' : '' },
    { k: 'members', label: '近 7 天新会员', value: countText(p.members7), sub: changeText(p.membersChange), tone: down(p.membersChange) }
  ]
}

/** 每位同事身上挂了几个问题（选人卡片上的小红点） */
function issueCountByRole(issues) {
  const out = {}
  ;(Array.isArray(issues) ? issues : []).forEach((i) => {
    if (i && i.roleId) out[i.roleId] = (out[i.roleId] || 0) + 1
  })
  return out
}

/** 复制全文：我 / 同事名字交替，一问一答之间空一行；进行中与出错的不带 */
function transcriptOf(messages, person) {
  const who = person || '同事'
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && !m.pending && !m.isError && typeof m.text === 'string' && m.text)
    .map((m) => `${m.role === 'user' ? '我' : who}：${m.text}`)
    .join('\n\n')
}

/** 会话名：去首尾空白、压空白，最多 16 字；空就不改 */
function cleanTitle(raw) {
  return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, 16)
}

/** 北京时间 MM-DD HH:mm */
function bjTime(ms) {
  const t = Number(ms)
  if (!Number.isFinite(t) || t <= 0) return ''
  const d = new Date(t + 8 * 3600000).toISOString()
  return `${d.slice(5, 10)} ${d.slice(11, 16)}`
}

/**
 * 巡检记录（第七轮）：最近几次 → 一行一条「时间 · 定时/手动 · 发现了谁的什么 / 没发现 · 发出几封」。
 * 规则 id 换成同事名字（rules 来自云端 ruleViews）；最多 limit 条。
 */
function historyRows(history, rules, limit) {
  const who = {}
  ;(Array.isArray(rules) ? rules : []).forEach((r) => { if (r && r.id) who[r.id] = r.person || r.id })
  return (Array.isArray(history) ? history : []).slice(0, limit || 5).map((h, i) => {
    const ids = Array.isArray(h.ids) ? h.ids : []
    const names = ids.map((id) => who[id] || id).filter((n, j, arr) => arr.indexOf(n) === j)
    return {
      key: `${h.at}-${i}`,
      when: bjTime(h.at),
      by: h.by === 'timer' ? '定时' : '手动',
      text: ids.length ? `发现 ${ids.length} 项（${names.join('、')}）· 发出 ${Number(h.sent) || 0} 封` : '没发现需要提醒的问题'
    }
  })
}

/** 阈值 −/+：按 step 走，夹在 [min, max]；不可调的规则原样返回 */
function stepLimit(rule, dir) {
  if (!rule || rule.limit == null) return rule && rule.limit
  const step = Number(rule.step) || 1
  const next = Number(rule.limit) + (dir < 0 ? -step : step)
  return Math.min(Number(rule.max), Math.max(Number(rule.min), next))
}

/** 存设置用：rules（页面态）→ { muted, limits } */
function settingsOf(rules) {
  const muted = []
  const limits = {}
  ;(Array.isArray(rules) ? rules : []).forEach((r) => {
    if (!r || !r.id) return
    if (r.muted) muted.push(r.id)
    if (r.limit != null) limits[r.id] = r.limit
  })
  return { muted, limits }
}

/** 转交：上一条回答之前最近的那个问题（一键任务不转，返回空） */
function questionBefore(messages, index) {
  const list = Array.isArray(messages) ? messages : []
  for (let i = Math.min(index, list.length) - 1; i >= 0; i -= 1) {
    const m = list[i]
    if (m && m.role === 'user') return m.taskId ? '' : String(m.text || '')
  }
  return ''
}

module.exports = { changeText, moneyText, countText, pulseCells, issueCountByRole, transcriptOf, cleanTitle, bjTime, historyRows, stepLimit, settingsOf, questionBefore }
