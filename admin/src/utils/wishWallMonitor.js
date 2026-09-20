/**
 * 祈福墙「注册转化监测表」口径与聚合（需求 28 · 注册转化监测）
 *
 * 为什么单独一个纯模块：这张表的每一行都是**口径**（哪个 action、哪个 step、哪个来源），
 * 写错不会报错 —— 只会静默显示 0，看起来像"没人扫码/没人注册"，比崩溃更危险
 * （本仓已有先例：祈福墙漏斗因为合成行只覆盖 identify 而**恒为 0**，见 BehaviorAnalytics.vue 的注释）。
 * 所以口径集中在这里，并可被守卫逐条对账（action 必须存在于 eventSchema、step 必须真的被小程序发出）。
 *
 * 数据来源：`user_behaviors` 明细（`analytics_daily` 是 dateKey+action 级汇总，
 * 既没有 step 也没有来源维度，做不了这张表）。
 *
 * 行结构（全部来自真实埋点，不发明环节）：
 *   进墙 → 其中门店码扫码 → 参与仪式/玩法 → 落愿遇注册钩子 → 先不挂 / 注册未完成 / 成功续发 → 落愿成功
 */

/** 来源拆分：门店现场 vs 线上入口（来源值取自 wish_wall_enter 的 targetId/from） */
export const WALL_SOURCES = [
  { key: 'store_qr', label: '门店码扫码', hint: '立牌/物料上的码（scene: from=store_qr）' },
  { key: 'detail', label: '商品详情页', hint: '详情页入口组件带 from=detail' },
  { key: '__other__', label: '其它/直接进入', hint: '分享、菜单、直达等' }
]

/**
 * 监测表的行口径。
 * - `actions`：命中任一 action 即计数（用于"参与玩法"这类多个动作合并的口径）
 * - `step` / `stepPrefix`：仅对带 step 的漏斗事件生效
 * - `target`：仅对带 targetId 的事件生效（如 wish_wall_post 的 ok）
 * - `of`：转化率的分母行 key（不填则只给绝对数）
 */
export const WALL_MONITOR_ROWS = [
  { key: 'enter', label: '进祈福墙', actions: ['wish_wall_enter'], desc: '进页即上报（含所有入口）' },
  { key: 'enterStore', label: '其中：门店码扫码', actions: ['wish_wall_enter'], from: 'store_qr', indent: true, of: 'enter', desc: '门店现场物料带来的进页' },
  { key: 'engage', label: '参与仪式 / 玩法', actions: ['wish_wall_lamp', 'wish_wall_play', 'wish_wall_sound'], of: 'enter', excludeTargetTypes: ['product'], desc: '点灯 / 抽玩法 / 切音效（同一动作多次只按次计）。⚠️ 排除 targetType=product：那是**页头藏品 chip** 的商品点击（复用同一 action，但没有任何玩法发生），不排除会让本行比率 >100%' },
  { key: 'gateShow', label: '落愿遇注册钩子', actions: ['wish_wall_register_gate'], step: 'show', of: 'enter', desc: '未注册用户点「挂上墙」时弹注册' },
  { key: 'gateGo', label: '点「去注册」', actions: ['wish_wall_register_gate'], step: 'go_register', indent: true, of: 'gateShow', desc: '弹窗里的授权按钮被点（还没拿到手机号）' },
  { key: 'gateDismiss', label: '先不挂（关掉弹窗）', actions: ['wish_wall_register_gate'], step: 'dismiss', indent: true, of: 'gateShow', desc: '弹窗可关：关掉是"暂时不挂"，不是流失' },
  { key: 'gateFail', label: '注册未完成（失败）', actions: ['wish_wall_register_gate'], stepPrefix: 'fail_', indent: true, of: 'gateShow', desc: '授权失败/拒绝等，按 fail_* 归并' },
  { key: 'gateOk', label: '注册成功并自动续发', actions: ['wish_wall_register_gate'], step: 'resume_success', of: 'gateShow', desc: '钩子的终点：注册完成 + 那条心愿自动发出' },
  { key: 'post', label: '落愿成功（上墙）', actions: ['wish_wall_post'], target: 'ok', of: 'enter', desc: '含已注册用户直接落愿；注册续发也走这里' }
]

/** 取一行明细的 step（properties 可能被摊平到顶层，两种位置都认） */
export function stepOf(ev) {
  const raw = ev && (ev.step || (ev.properties && ev.properties.step))
  return String(raw || '').trim()
}

/** 取一行明细的来源（wish_wall_enter 的 targetId 就是 from） */
export function fromOf(ev) {
  const raw = ev && (ev.from || ev.targetId || (ev.properties && ev.properties.from))
  return String(raw || '').trim()
}

/** 取一行明细的用户标识（没有就返回空串，UV 才不会被算成 1 个假用户） */
export function userOf(ev) {
  return String((ev && (ev.userId || ev._openid)) || '')
}

/** 某一行口径是否命中一条明细 */
export function matchRow(ev, row) {
  if (!ev || !row) return false
  const action = String(ev.action || '')
  const actions = row.actions || (row.action ? [row.action] : [])
  if (!actions.includes(action)) return false
  if (row.step && stepOf(ev) !== row.step) return false
  if (row.stepPrefix && !stepOf(ev).startsWith(row.stepPrefix)) return false
  if (row.target && String(ev.targetId || '') !== row.target) return false
  if (row.from && fromOf(ev) !== row.from) return false
  // 2026-09-21（P2-7 报表侧）：**按 targetType 排除**。
  // 为什么需要它：`engage` 行的口径是"点了灯 / 抽了玩法 / 切了音效"，
  // 但同一个 action（`wish_wall_play`）也被**页头藏品 chip** 复用 —— 那里没有任何玩法发生。
  // 页面侧已把 chip 的 targetType 标成 `'product'`（玩法一律 `'play'`），这里据此排除，
  // 否则「参与玩法」的分子被无玩法的点击抬高（可以 >100%，因为分母是进页 UV）。
  if (row.excludeTargetTypes && row.excludeTargetTypes.includes(String(ev.targetType || ''))) return false
  return true
}

/** 命中行的 { 次数, 独立用户 }（UV 用 Set 去重：同一用户刷十次只算一个） */
export function sumRow(rows, row) {
  const users = new Set()
  let count = 0
  ;(Array.isArray(rows) ? rows : []).forEach((ev) => {
    if (!matchRow(ev, row)) return
    count += 1
    const uid = userOf(ev)
    if (uid) users.add(uid)
  })
  return { count, uv: users.size }
}

/**
 * 转化率：分母为 0 时返回 **null**（UI 显示「—」）。
 * ⚠️ 不能返回 0：0% 会被读成"转化极差"，而真相是"这一步根本没有曝光"。
 */
export function rate(part, whole) {
  const p = Number(part) || 0
  const w = Number(whole) || 0
  if (w <= 0) return null
  return Math.round((p / w) * 1000) / 10
}

/** 一行明细属于哪个来源桶（无来源 → __other__） */
export function sourceBucketOf(ev) {
  const from = fromOf(ev)
  const hit = WALL_SOURCES.find((s) => s.key === from)
  return hit ? hit.key : '__other__'
}

/**
 * 组装整张监测表。
 * @param {Array<object>} rows user_behaviors 明细
 * @returns {{hasData:boolean, steps:Array, sources:Array}}
 */
export function buildWallMonitor(rows) {
  const list = Array.isArray(rows) ? rows : []
  const wallRows = list.filter((ev) => String((ev && ev.action) || '').startsWith('wish_wall'))
  const sums = {}
  WALL_MONITOR_ROWS.forEach((row) => { sums[row.key] = sumRow(wallRows, row) })
  const steps = WALL_MONITOR_ROWS.map((row) => ({
    key: row.key,
    label: row.label,
    indent: !!row.indent,
    desc: row.desc || '',
    count: sums[row.key].count,
    uv: sums[row.key].uv,
    of: row.of || '',
    rate: row.of ? rate(sums[row.key].count, sums[row.of] ? sums[row.of].count : 0) : null
  }))

  // 按来源拆分：进墙 / 落愿成功 / 转化率。落愿成功不直接带 from → 用同一用户是否在同区间
  // 有过该来源的进墙事件来归属；没有进墙记录的落愿（老用户直接落愿）算 __other__。
  const enterUsersBySource = {}
  wallRows.forEach((ev) => {
    if (String(ev.action || '') !== 'wish_wall_enter') return
    const uid = userOf(ev)
    if (!uid) return
    const bucket = sourceBucketOf(ev)
    if (!enterUsersBySource[bucket]) enterUsersBySource[bucket] = new Set()
    enterUsersBySource[bucket].add(uid)
  })
  const sources = WALL_SOURCES.map((s) => {
    const enterRow = { key: 'enter', actions: ['wish_wall_enter'], from: s.key === '__other__' ? '' : s.key }
    const enters = s.key === '__other__'
      ? wallRows.filter((ev) => String(ev.action || '') === 'wish_wall_enter' && sourceBucketOf(ev) === '__other__')
      : wallRows.filter((ev) => matchRow(ev, enterRow))
    const users = enterUsersBySource[s.key] || new Set()
    // 落愿成功：按"同一用户"归属到来源（同一用户可能多渠道进过，取第一个命中的来源桶）
    const posted = wallRows.filter((ev) => String(ev.action || '') === 'wish_wall_post' && String(ev.targetId || '') === 'ok')
    const postedBySource = posted.filter((ev) => {
      const uid = userOf(ev)
      if (!uid) return s.key === '__other__'
      const buckets = Object.keys(enterUsersBySource).filter((b) => enterUsersBySource[b].has(uid))
      if (!buckets.length) return s.key === '__other__'
      return buckets[0] === s.key
    })
    return {
      key: s.key,
      label: s.label,
      hint: s.hint,
      enter: enters.length,
      enterUv: users.size,
      post: postedBySource.length,
      rate: rate(postedBySource.length, enters.length)
    }
  })

  return { hasData: wallRows.length > 0, steps, sources }
}
