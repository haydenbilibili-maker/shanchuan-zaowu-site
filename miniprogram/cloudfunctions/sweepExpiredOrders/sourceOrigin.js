/**
 * 来源判定（canonical 真源）
 *
 * ⚠️ 本文件是**唯一真源**，请勿单独修改任何 `cloudfunctions/<fn>/sourceOrigin.js` 副本。
 * 云函数之间不能跨目录 require，故每个函数各留一份**完全一致**的副本；
 * 修改后必须运行：
 *   bash miniprogram/scripts/sync-source-origin.sh         # 同步到全部副本
 *   bash miniprogram/scripts/sync-source-origin.sh --check  # 只检查（已接入 check:admin）
 * 这与 orderSummary.js（13 份）、staffGuard.js（55 份）沿用同一惯例。
 *
 * ---------------------------------------------------------------------------
 * 为什么需要这个模块（真实事故 2026-09-16）
 *
 * 现象：店员核销代金券 → 券核销成功，但积分行报「积分申请失败 / 请先登录」。
 *
 * 链路：staff/field → `verifyStoreCoupon{action:'redeem'}`（客户端调用）
 *       → 核销成功后**云函数互调** `grantStorePoints`（带 _callerOpenid 转发操作人）
 *       → grantStorePoints 入口要求 `!openid && isNonClientSource()` 才肯认
 *         `_callerOpenid`；判定失败即无 openid → 返回「请先登录」。
 *
 * 根因：各函数内联的判定是**负向子串正则**
 *       `!/wx_client|wx_devtools/i.test(SOURCE)`。
 *       而云函数互调时 SOURCE 会继承客户端标记形成逗号合并串
 *       （grantStorePoints 自己的 isInternalSource 早就注释「实测为 ',scf'」）。
 *       于是 `"wx_client,scf"` 被判为「客户端来源」→ 拒绝转发 → 报「请先登录」。
 *       实测：该负向判定在 9 个真实 SOURCE 取值上错 4 例。
 *
 *       另有 3 处用**全等**比较（`s === 'wx_client' || s === 'wx_devtools'`）：
 *       合并串被判为「非客户端」，于是 `dispatchMessage` / `sendInAppMessage`
 *       **跳过店员权限校验** —— 这是安全门被绕过（比报错更严重）。
 *
 * 修复：改用**正向证据** —— 云函数互调由平台注入 `scf` 段，客户端无法注入该段。
 *       同时比旧判定更严格：`"scf,wx_client"` 这类旧判定会误放行的串，
 *       现按客户端处理；`wx_cloud` 等非 scf 平台来源也保守判为客户端。
 *
 * 安全边界：判定只决定「是否允许接受 `_callerOpenid` 转发」与「是否强制店员鉴权」；
 *          被接受的 openid 仍要经 `assertStaff` 校验其员工身份与权限，
 *          故修正此处不会引入越权（见 grantStorePoints 入口与 dispatchMessage）。
 * ---------------------------------------------------------------------------
 */

/**
 * 纯函数：把原始 SOURCE 串拆成小写来源段集合。
 * 抽出纯函数是为了可被真实单测（不依赖 wx-server-sdk）。
 */
function parseSource(raw) {
  return String(raw == null ? '' : raw)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * 纯函数：是否非客户端来源（可信到可以接受 `_callerOpenid` 转发）。
 * - 含 `scf` 段 → 服务端互调 → 可信
 * - 空串 → 定时触发 → 可信（保持历史行为）
 * - 其余（含 wx_client / wx_devtools / 未知平台来源）→ 不可信
 */
function classifySource(raw) {
  const segs = parseSource(raw)
  if (!segs.length) return { segments: segs, nonClient: true, client: false, internal: false }
  const internal = segs.some((seg) => seg === 'scf')
  const client = segs.some((seg) => seg === 'wx_client' || seg === 'wx_devtools')
  return { segments: segs, nonClient: internal, client, internal }
}

/** 读取当前调用上下文里的 SOURCE（唯一依赖 wx-server-sdk 的地方） */
function readSource() {
  try {
    const cloud = require('wx-server-sdk')
    const ctx = cloud.getWXContext() || {}
    return ctx.SOURCE
  } catch (e) {
    return ''
  }
}

/** 是否非客户端来源（定时触发 / 云函数互调） */
function isNonClientSource() {
  return classifySource(readSource()).nonClient
}

/** 是否客户端来源（小程序 / 开发者工具，含合并串中带客户端标记的情况） */
function isClientSource() {
  return classifySource(readSource()).client
}

/** 云函数互调（scf 段）——用于 confirmOrderReceipt → grantStorePoints 这类内部链路 */
function isInternalSource() {
  return classifySource(readSource()).internal
}

/** 当前来源段集合 */
function sourceSegments() {
  return classifySource(readSource()).segments
}

/** 诊断用：把 SOURCE 段拼成可读串（打进日志便于线上定位） */
function describeSource() {
  const segs = sourceSegments()
  return segs.length ? segs.join('|') : '(empty)'
}

module.exports = {
  // 纯函数（供测试）
  parseSource,
  classifySource,
  // 运行时包装（依赖微信上下文）
  isNonClientSource,
  isClientSource,
  isInternalSource,
  sourceSegments,
  describeSource
}
