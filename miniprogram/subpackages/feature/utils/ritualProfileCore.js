/**
 * 仪式档案（祈福墙「连续点灯」streak + 安心木鱼「功德」muyuCount）—— 纯函数核
 *
 * 为什么单独成模块、且在两处**逐字节同源**：
 *   「合并语义」与「取值校验」必须同时跑在两个运行时 ——
 *     · 云函数 `wishRitualProfile.sync`：把客户端推来的档案与已存档**合并**后落库；
 *     · 小程序 `utils/ritualProfile.loadFromCloud`：把云端档案与本地存档**合并**后回填本地。
 *   同一份语义写两遍就是漂移源（本仓已多次因「两处口径各写一遍」出错，
 *   见 docs/AI施工错题本.md）。云函数不能跨目录 require 小程序代码（上传按函数目录打包），
 *   故按本仓 `check:shared-modules` 的既有惯例**留副本**：
 *     - miniprogram/utils/ritualProfileCore.js                              ← 客户端
 *     - miniprogram/cloudfunctions/wishRitualProfile/ritualProfileCore.js  ← 云函数
 *   两份必须逐字节相同；`miniprogram/scripts/test-ritual-profile.mjs` 逐字节比对
 *   （登记进守卫链归集成官）。本文件不依赖 wx / cloud / 任何相对模块，可在 Node 里直接单测。
 *
 * 本地存档的真实形状（见 utils/wishRitual.js）：
 *   · 点灯：`shanhai_wish_ritual_v1` = `{ version, days: { 'YYYY-MM-DD': { litAt } } }`，
 *     只保留最近 KEEP_DAYS=30 个日期键；
 *   · 木鱼：`wish_muyu_v1` = 非负整数。
 *   云端不存 `days` 明细，只存聚合后的 `{ streak, lastLitDayKey, muyuCount }`。
 */
'use strict'

/** 存档结构版本：字段语义变更时 +1，便于线上按版本兼容（当前只有 v1） */
const VERSION = 1

/**
 * `streak` 上界 = 本地存档窗口长度（`wishRitual.KEEP_DAYS === 30`）。
 *
 * 为什么是这个数（而不是随手写 365）：`streak` 由本地 `days` 映射推导
 * （`wishWall.lampStreak`），而 `wishRitual` 每次写入都会 `pruneDays` 只留最近 30 个
 * 日期键 → **良构客户端不可能报出 > 30 的连续天数**。超上界只可能是：
 *   ① 本地存储被改写 / 手搓请求；② 我们改了 KEEP_DAYS 却忘了同步这里。
 * ②由单测 `STREAK_MAX === wishRitual.KEEP_DAYS` 钉住（漂移即失败）。
 */
const STREAK_MAX = 30

/**
 * 功德单次跳变的速率上界（次/秒）。
 *
 * 木鱼是**手点**出来的：`subpackages/feature/wish-wall/index.js` 的即时反馈动画窗口是
 * 420ms（节奏上限约 2.4 次/秒），真机连续快敲也很难越过 5 次/秒。
 * 取 **10 次/秒 ≈ 反馈节奏的 4 倍**，只拦「1 秒内涨几千」这类明显异常，不拦任何真实连点。
 */
const MUYU_TAPS_PER_SEC = 10

/** 单次同步的固定宽限（次）：吸收首次连点、时钟抖动与网络重试的边界 */
const MUYU_JUMP_GRACE = 50

/**
 * 功德绝对上界（防伪造 / 防存储损坏）。
 * 本地 `wish_muyu_v1` 无上限；100 万次 ≈ 以 10 次/秒**连续点 27.8 小时**，
 * 没有任何真实用户能点到；越过它只可能是脚本刷或数据坏了。
 */
const MUYU_MAX = 1000000

/**
 * 日期键的合理下限：本仪式 2026-09 上线，早于 2026-01-01 的「点灯日」只可能是脏数据
 * （换手机导入 / 手写请求）。留出半年裕量，不至于误伤任何真实记录。
 */
const DAY_KEY_FLOOR = '2026-01-01'

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** 非负整数归一：非法一律当 0（合并/比较用，不做校验） */
function intOr0(v) {
  return Number.isInteger(v) && v > 0 ? v : 0
}

/**
 * 严格解析日期键 `YYYY-MM-DD`。
 * 逐位校验 + UTC 回环，拦掉 `2026-02-30` / `2026-13-01` / `2026-1-1` 这类"看着像日期"的脏值。
 * @returns {{y:number, m:number, d:number, ms:number}|null}
 */
function parseDayKey(key) {
  if (typeof key !== 'string') return null
  const m = DAY_KEY_RE.exec(key)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const ms = Date.UTC(y, mo - 1, d)
  const back = new Date(ms)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null
  return { y, m: mo, d, ms }
}

/** 是否合法日期键（`''` 不算合法，它表示"从未点灯"，由调用方单独处理） */
function isValidDayKey(key) {
  return parseDayKey(key) !== null
}

/** 日期键 → UTC 毫秒（非法返回 NaN） */
function dayKeyToMs(key) {
  const p = parseDayKey(key)
  return p ? p.ms : NaN
}

/**
 * 日期键比较：a 晚于 b → 1；早于 → -1；相同 → 0；任一非法 → null（**不猜**）。
 */
function compareDayKeys(a, b) {
  const pa = parseDayKey(a)
  const pb = parseDayKey(b)
  if (!pa || !pb) return null
  if (pa.ms === pb.ms) return 0
  return pa.ms > pb.ms ? 1 : -1
}

/** 取更晚的一天（任一为空/非法则返回另一个；都不可用返回 `''`） */
function laterDayKey(a, b) {
  const ca = compareDayKeys(a, b)
  if (ca === null) return isValidDayKey(a) ? a : (isValidDayKey(b) ? b : '')
  return ca >= 0 ? a : b
}

/** 日期键 ± N 天（非法输入返回 `''`；结果非法也返回 `''`） */
function shiftDayKey(key, delta) {
  const ms = dayKeyToMs(key)
  if (!Number.isFinite(ms)) return ''
  const days = Number.isFinite(delta) ? Math.trunc(delta) : 0
  const d = new Date(ms + days * 86400000)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

/** 两个日期键相差的自然日数（a - b；任一非法返回 NaN） */
function dayDiff(a, b) {
  const ma = dayKeyToMs(a)
  const mb = dayKeyToMs(b)
  if (!Number.isFinite(ma) || !Number.isFinite(mb)) return NaN
  return Math.round((ma - mb) / 86400000)
}

/**
 * 上海自然日的日期键 `YYYY-MM-DD`（与云函数 `manageWishWall.shanghaiDayKey`、
 * 客户端 `wishWall.shanghaiDayKey` 同口径；容器/设备时区不保证，手工 +8 换算）。
 */
function shanghaiDayKey(ms) {
  const t = Number.isFinite(ms) ? ms : Date.now()
  const sh = new Date(t + 8 * 3600 * 1000)
  return `${sh.getUTCFullYear()}-${pad2(sh.getUTCMonth() + 1)}-${pad2(sh.getUTCDate())}`
}

/** 全 0 的默认档案（未点灯 / 未敲木鱼） */
function emptyProfile() {
  return { streak: 0, lastLitDayKey: '', muyuCount: 0 }
}

/** 只取档案三字段（丢掉 _id / _openid / 时间戳等存储字段） */
function pickProfile(doc) {
  const d = doc && typeof doc === 'object' ? doc : {}
  return {
    streak: intOr0(d.streak),
    lastLitDayKey: isValidDayKey(d.lastLitDayKey) ? d.lastLitDayKey : '',
    muyuCount: intOr0(d.muyuCount)
  }
}

/** 两份档案的三字段是否完全相同（用于 sync 的「无变化即不写」判定） */
function sameProfile(a, b) {
  const x = pickProfile(a)
  const y = pickProfile(b)
  return x.streak === y.streak && x.lastLitDayKey === y.lastLitDayKey && x.muyuCount === y.muyuCount
}

/**
 * 合并两份档案 —— **本地权威 + 只前进**。
 *
 * 三个字段**各自**取优，而不是"整份取新"：
 *   · 两端可能各有一半更新的数据（A 机连续天数高、B 机最近点过灯），逐字段取优不丢任何一边；
 *   · `streak` / `muyuCount` 都是**只增不减**的计数器，本地又是权威 → 取 `max`；
 *   · `lastLitDayKey` 取**更晚的一天**（日期键 `YYYY-MM-DD` 定长，字典序即时间序；
 *     这里仍走 `compareDayKeys` 解析后比较，不依赖字符串序）。
 *
 * 为什么取 max 而不是"信最新一次调用"：换手机/清缓存后，新设备本地是空的，
 * 若用"最新覆盖"，第一次同步就会把云端已有的 30 天连续记录清零 —— 恰是本功能要消灭的缺陷。
 *
 * 重要性质（单测钉住）：**幂等** `merge(merge(a,b), a) === merge(a,b)`、
 * `merge(m, m) === m`，且**可交换** `merge(a,b) === merge(b,a)`。
 * 因此同一份输入重复调用结果一致，不会累加、不会来回抖动。
 *
 * 已知取舍：`streak` 与 `lastLitDayKey` 独立取 max，极端情况下会把"较高的历史连续天数"
 * 挂到"较晚的日期锚点"上（两端数据完全不重叠时）。对**仪式感计数**这没有危害：
 * 它不会凭空生出一段连续点灯（客户端回填的日期是"两端并集的连续段"，
 * 见 utils/ritualProfile.planRestoreDays），也不会丢用户已有的记录；
 * 反过来若改成"信较晚锚点那一端的 streak"，才会真的丢掉本地权威的大值。
 */
function mergeProfiles(local, remote) {
  const l = local && typeof local === 'object' ? local : {}
  const r = remote && typeof remote === 'object' ? remote : {}
  return {
    streak: Math.max(intOr0(l.streak), intOr0(r.streak)),
    lastLitDayKey: laterDayKey(l.lastLitDayKey, r.lastLitDayKey),
    muyuCount: Math.max(intOr0(l.muyuCount), intOr0(r.muyuCount))
  }
}

function invalid(code, field, msg) {
  return { ok: false, code, field, msg }
}

/**
 * 校验 `sync` 入参（服务端**必须**调用；客户端也可先自查）。
 *
 * 拒绝"不可能"的取值，但**不做业务拦截**：
 *   · `streak`        整数 0..STREAK_MAX
 *   · `muyuCount`     整数 0..MUYU_MAX
 *   · `lastLitDayKey` `''`（从未点灯）或合法 `YYYY-MM-DD`；不得为未来日、不得早于 DAY_KEY_FLOOR
 * 缺省（`undefined` / `null`）= 0 或 `''`：老客户端只推一个字段也能工作。
 * 类型故意严格（拒绝数字字符串 `'7'`）：云函数入参来自我们自己的客户端，出现字符串
 * 只可能是调用方写错或被手搓，静默 coerce 会把错误藏起来。
 *
 * 任一字段不合格 → **整份拒绝**（回 code/field/msg），不落任何字段 —— 避免写出"半份档案"
 * （例如 streak 入库了、muyuCount 没入），那会让 next 次合并的基线变得不可解释。
 *
 * @param {object} raw 事件对象（字段直接取 event 顶层，和 action 同级）
 * @param {{nowMs?:number, todayKey?:string}} [opts] 注入"今天"以便单测（默认取 Asia/Shanghai 当天）
 * @returns {{ok:true, profile:object}|{ok:false, code:string, field:string, msg:string}}
 */
function validateProfileInput(raw, opts) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const o = opts || {}
  const todayKey = isValidDayKey(o.todayKey) ? o.todayKey : shanghaiDayKey(o.nowMs)
  const profile = emptyProfile()

  const numbers = [
    { key: 'streak', max: STREAK_MAX, hint: `连续天数上界 ${STREAK_MAX}（本地存档窗口）` },
    { key: 'muyuCount', max: MUYU_MAX, hint: `功德上界 ${MUYU_MAX}` }
  ]
  for (const f of numbers) {
    const v = src[f.key]
    if (v == null) continue // 缺省 = 0
    if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) {
      return invalid('INVALID_TYPE', f.key, `${f.key} 必须是整数`)
    }
    if (v < 0) return invalid('OUT_OF_RANGE', f.key, `${f.key} 不能为负（收到 ${v}）`)
    if (v > f.max) return invalid('OUT_OF_RANGE', f.key, `${f.key}=${v} 超过上界（${f.hint}）`)
    profile[f.key] = v
  }

  const day = src.lastLitDayKey
  if (day != null && day !== '') {
    if (typeof day !== 'string' || !isValidDayKey(day)) {
      return invalid('INVALID_DAY_KEY', 'lastLitDayKey', 'lastLitDayKey 必须是 YYYY-MM-DD')
    }
    if (dayDiff(day, todayKey) > 0) {
      return invalid('FUTURE_DAY_KEY', 'lastLitDayKey', `lastLitDayKey=${day} 是未来日期（今天 ${todayKey}）`)
    }
    if (dayDiff(day, DAY_KEY_FLOOR) < 0) {
      return invalid('DAY_KEY_TOO_OLD', 'lastLitDayKey', `lastLitDayKey=${day} 早于 ${DAY_KEY_FLOOR}`)
    }
    profile.lastLitDayKey = day
  }

  return { ok: true, profile }
}

/**
 * 单次同步的跳变闸：相对**已存档**值，判断这一次推来的增量是否物理上可能。
 *
 * 上界从哪来（两条硬依据，不是拍脑袋）：
 *   · `streak` 每天最多 +1 → 允许增量 = 距上次改动的自然日数 + 1（+1 给"今天"）。
 *   · `muyuCount` 是手点计数 → 允许增量 = MUYU_JUMP_GRACE + 距上次改动秒数 × MUYU_TAPS_PER_SEC。
 *
 * 为什么读不到上次改动时刻时**放行**：`doc.updateTime` 可能是老数据或形态不认识的时间戳；
 * 本地是权威，不能因为"服务端读不出时间"就把用户真实（离线攒下）的功德永久挡在门外 ——
 * 宁可少一道闸，也不制造"同步永远失败"的静默缺陷（绝对上界仍在，见 validateProfileInput）。
 *
 * 另一个刻意的设计：命中跳变闸时**整份拒绝且不推进 updateTime**，
 * 于是下一轮（时间窗更长）同一个值会被正常接受 —— 拒绝是"暂缓"，不是"丢弃"。
 *
 * @param {object} prev 已存档档案（读不到时间时 prevUpdateMs 传 0）
 * @param {object} incoming 本次推来的档案（应已通过 validateProfileInput）
 * @param {{nowMs?:number, prevUpdateMs?:number}} [opts]
 * @returns {{ok:true}|{ok:false, code:string, field:string, msg:string}}
 */
function checkMonotonicJump(prev, incoming, opts) {
  const p = pickProfile(prev)
  const inc = pickProfile(incoming)
  const o = opts || {}
  const nowMs = Number.isFinite(o.nowMs) ? o.nowMs : Date.now()
  const prevUpdateMs = Number.isFinite(o.prevUpdateMs) && o.prevUpdateMs > 0 ? o.prevUpdateMs : 0

  if (inc.streak > p.streak && prevUpdateMs) {
    const elapsedDays = dayDiff(shanghaiDayKey(nowMs), shanghaiDayKey(prevUpdateMs))
    const allowance = Math.max(0, Number.isFinite(elapsedDays) ? elapsedDays : 0) + 1
    if (inc.streak - p.streak > allowance) {
      return invalid(
        'STREAK_JUMP',
        'streak',
        `连续天数一次跳变 ${inc.streak - p.streak} 天，超过 ${allowance} 天（距上次改动 ${allowance - 1} 天 + 今天）`
      )
    }
  }

  if (inc.muyuCount > p.muyuCount && prevUpdateMs) {
    const elapsedSec = Math.max(0, (nowMs - prevUpdateMs) / 1000)
    const allowance = MUYU_JUMP_GRACE + Math.floor(elapsedSec * MUYU_TAPS_PER_SEC)
    if (inc.muyuCount - p.muyuCount > allowance) {
      return invalid(
        'MUYU_JUMP',
        'muyuCount',
        `功德一次跳变 ${inc.muyuCount - p.muyuCount} 次，超过按 ${elapsedSec.toFixed(1)}s×${MUYU_TAPS_PER_SEC}/s 估算的 ${allowance} 次`
      )
    }
  }

  return { ok: true }
}

module.exports = {
  VERSION,
  STREAK_MAX,
  MUYU_TAPS_PER_SEC,
  MUYU_JUMP_GRACE,
  MUYU_MAX,
  DAY_KEY_FLOOR,
  parseDayKey,
  isValidDayKey,
  dayKeyToMs,
  compareDayKeys,
  laterDayKey,
  shiftDayKey,
  dayDiff,
  shanghaiDayKey,
  emptyProfile,
  pickProfile,
  sameProfile,
  mergeProfiles,
  validateProfileInput,
  checkMonotonicJump
}
