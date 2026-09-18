/**
 * 祈福墙 · 仪式档案云端存储（连续点灯 streak / 木鱼功德 muyuCount）
 *
 * 为什么要有这个函数：
 *   `utils/wishRitual.js` 把「连续点灯」与「木鱼功德」**只存本地**（wx.setStorageSync），
 *   换手机 / 清缓存即丢 —— 而这两项正是「注册/登录能换到真实价值」里最现成的缺口。
 *   本函数按 openid 把它们落库；**本地仍是权威**（合并语义见下），云端只负责"不丢"。
 *
 * action（C 端；入参字段与 action 同级）：
 *   get    取当前用户（openid 归属）的仪式档案。
 *          没有存档 → `{ success:true, exists:false, profile:{streak:0,lastLitDayKey:'',muyuCount:0} }`
 *   sync   合并写入 `{ streak, lastLitDayKey, muyuCount }`。
 *          幂等：同一份输入重复调用，落库结果一致（第二次起 `changed:false`，**不再写库**）。
 *
 * 合并语义（**本地权威 + 只前进**；实现与客户端逐字节同源，见 ritualProfileCore.js）：
 *   streak         取**较大值**   —— 本地是权威且只增不减；取 max 保证任何一次同步都不会把
 *                                   用户已有的连续天数改小（换手机后第一次同步尤其关键）。
 *   muyuCount      取**较大值**   —— 同上，功德是只增不减的计数器。
 *   lastLitDayKey  取**更晚的一天** —— 跨设备时以"最近一次点灯"为准；空串只在两端都空时保留。
 *   为什么三个字段**各自**取优、而不是"整份取新"：两端可能各有一半更新的数据
 *   （A 机连续天数高、B 机最近点过灯），逐字段取优不丢任何一边；且 max / 取更晚日
 *   都满足**幂等 + 交换律**，重复调用结果一致，不会累加或来回抖动。
 *   代价与论证：独立取 max 在极端情况下会把"较高的历史连续天数"挂到"较晚的日期锚点"上；
 *   对仪式感计数无危害（客户端回填的是两端并集的连续段，见 utils/ritualProfile），
 *   而改成"信较晚锚点那一端的 streak"反而会丢掉本地权威的大值 —— 那才是真缺陷。
 *
 * 服务端校验（拒绝"不可能"的取值；上界来源逐条见 ritualProfileCore 常量注释）：
 *   streak        整数 0..30        上界 = 本地存档窗口 wishRitual.KEEP_DAYS（良构客户端报不出更大）
 *   muyuCount     整数 0..1000000   绝对上界（10 次/秒 × 27.8 小时，无真实用户可达）；
 *                                   另按「距上次改动秒数 × 10 次/秒 + 50」拦**单次跳变过大**
 *   lastLitDayKey `''` 或合法 YYYY-MM-DD，且不得为未来日（Asia/Shanghai）、不得早于 2026-01-01
 *   任一字段不合格 → 整份拒绝（`code` / `field` / `msg`），**不落任何字段**。
 *   跳变闸命中时**不推进 updateTime** → 下一轮时间窗更大，同一个值会被正常接受（暂缓而非丢弃）。
 *
 * 未注册用户：
 *   微信云函数拿得到 openid，本函数**照常按 openid 存**，刻意**不加**注册校验 ——
 *   "注册后才存"是客户端的钩子（由客户端决定调不调，本次不改 UI）。
 *   理由：① 注册状态以 `users` 集合为准，在这里加门等于把"客户端选择"变成"服务端硬拦"，
 *   换手机后未注册用户的历史档案将无处安放；② 本档案不产生任何可兑换价值，
 *   没有必须 fail-closed 的风险面；③ 越权风险已由「只能读写自己 openid」的规则与
 *   本函数写入时**只写调用方 openid**兜住。
 *
 * 集合：`wish_ritual_profiles`
 *   权限规则 `cloudbase/rules/wish_ritual_profiles.json`：本人可读、**客户端不可写**
 *   （写一律经本函数 —— 直写会绕过上面的校验）。结构说明 `cloudbase/schema/wish_ritual_profiles.md`。
 *
 * 文档示例（字段设计见 schema 文档）：
 *   {
 *     _id: 'r1aBcD...',
 *     _openid: 'oXXXX',            // 归属（频控/查询键）
 *     openid: 'oXXXX',             // 冗余一份，便于导出与排查
 *     streak: 7,                   // 连续点灯天数（0 = 从未点灯）
 *     lastLitDayKey: '2026-09-20', // 最近一次点灯日（Asia/Shanghai 自然日）
 *     muyuCount: 512,              // 木鱼功德累计
 *     version: 1,
 *     createTime: <serverDate>,
 *     updateTime: <serverDate>     // 只在字段真的变化时推进（幂等：无变化不写）
 *   }
 */
const cloud = require('wx-server-sdk')
const core = require('./ritualProfileCore')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTION = 'wish_ritual_profiles'
const VERSION = core.VERSION

/** 判断"集合还没建"这一种错误，给出可操作提示（照 manageWishWall 的口径） */
function isCollectionMissing(e) {
  return /collection|集合/i.test((e && e.message) || '')
}

/**
 * 时间戳 → 毫秒。`updateTime` 可能来自 serverDate（Date / ISO 串 / `{ $date }` 形态），
 * 读不出来就返回 0（跳变闸据此选择"放行"，不因为时间读不出而永久拒绝）。
 */
function toMs(value) {
  if (value == null || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (value instanceof Date) {
    const t = value.getTime()
    return Number.isNaN(t) ? 0 : t
  }
  if (typeof value === 'object') {
    if (value.$date != null) return toMs(value.$date)
    if (typeof value.getTime === 'function') {
      const t = value.getTime()
      return Number.isNaN(t) ? 0 : t
    }
    return 0
  }
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? 0 : t
}

/** 该 openid 的档案文档（没有则 null） */
async function readStoredDoc(openid) {
  const res = await db.collection(COLLECTION).where({ _openid: openid }).limit(1).get()
  return (res.data || [])[0] || null
}

async function getProfile(openid) {
  if (!openid) return { success: false, code: 'NO_OPENID', msg: '请先登录' }
  try {
    const doc = await readStoredDoc(openid)
    if (!doc) return { success: true, exists: false, profile: core.emptyProfile(), updateTime: null }
    return { success: true, exists: true, profile: core.pickProfile(doc), updateTime: doc.updateTime || null }
  } catch (e) {
    console.warn('wishRitualProfile get failed:', e && e.message)
    if (isCollectionMissing(e)) {
      return { success: false, code: 'COLLECTION_MISSING', msg: `请先在云开发控制台创建集合 ${COLLECTION}` }
    }
    return { success: false, code: 'READ_FAILED', msg: (e && e.message) || '读取失败' }
  }
}

async function syncProfile(event, openid) {
  if (!openid) return { success: false, code: 'NO_OPENID', msg: '请先登录' }

  const nowMs = Date.now()
  const checked = core.validateProfileInput(event, { nowMs })
  if (!checked.ok) return { success: false, code: checked.code, field: checked.field, msg: checked.msg }

  let doc = null
  try {
    doc = await readStoredDoc(openid)
  } catch (e) {
    console.warn('wishRitualProfile sync read failed:', e && e.message)
    if (isCollectionMissing(e)) {
      return { success: false, code: 'COLLECTION_MISSING', msg: `请先在云开发控制台创建集合 ${COLLECTION}` }
    }
    return { success: false, code: 'READ_FAILED', msg: (e && e.message) || '同步失败' }
  }

  const now = db.serverDate()

  // 首次同步：本地是权威，直接落库（不做跳变闸 —— 这正是"把历史档案带上云"的那一次）
  if (!doc) {
    try {
      await db.collection(COLLECTION).add({
        data: Object.assign({}, checked.profile, {
          _openid: openid,
          openid,
          version: VERSION,
          createTime: now,
          updateTime: now
        })
      })
      return { success: true, exists: true, created: true, changed: true, profile: checked.profile }
    } catch (e) {
      console.error('wishRitualProfile create failed:', e)
      if (isCollectionMissing(e)) {
        return { success: false, code: 'COLLECTION_MISSING', msg: `请先在云开发控制台创建集合 ${COLLECTION}` }
      }
      return { success: false, code: 'WRITE_FAILED', msg: (e && e.message) || '同步失败' }
    }
  }

  const stored = core.pickProfile(doc)
  const jump = core.checkMonotonicJump(stored, checked.profile, { nowMs, prevUpdateMs: toMs(doc.updateTime) })
  if (!jump.ok) {
    // 整份拒绝、且**不动 updateTime**：这是"暂缓"，不是"丢弃"。本地照常可用。
    return { success: false, code: jump.code, field: jump.field, msg: jump.msg, profile: stored }
  }

  const merged = core.mergeProfiles(stored, checked.profile)
  if (core.sameProfile(merged, stored)) {
    // 幂等关键：字段没有变化就**不写库**（updateTime 不推进，重复调用结果完全一致）
    return { success: true, exists: true, created: false, changed: false, profile: stored }
  }

  try {
    await db.collection(COLLECTION).doc(doc._id).update({
      data: Object.assign({}, merged, { version: VERSION, updateTime: now })
    })
    return { success: true, exists: true, created: false, changed: true, profile: merged }
  } catch (e) {
    console.error('wishRitualProfile update failed:', e)
    return { success: false, code: 'WRITE_FAILED', msg: (e && e.message) || '同步失败' }
  }
}

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID
  const action = String((event && event.action) || 'get')
  try {
    switch (action) {
      case 'get': return await getProfile(openid)
      case 'sync': return await syncProfile(event, openid)
      default: return { success: false, msg: `未知 action: ${action}` }
    }
  } catch (e) {
    console.error('wishRitualProfile', action, e)
    return { success: false, msg: (e && e.message) || '服务异常' }
  }
}

// 供行为测试直接引用纯函数/常量（云函数运行时不会用到这些导出）
module.exports.COLLECTION = COLLECTION
module.exports.VERSION = VERSION
module.exports.toMs = toMs
module.exports.isCollectionMissing = isCollectionMissing
