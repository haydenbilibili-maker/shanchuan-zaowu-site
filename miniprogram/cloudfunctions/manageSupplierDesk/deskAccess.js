/**
 * B2B 伙伴功能项判定（服务端）—— 纯函数，零依赖。
 *
 * 数据：staff_members.b2bDesk.features（缺省 = deskCore.DESK_FEATURES 的默认值）。
 * 账号启停不在这里：staffGuard.resolveActor 只认 status='active'，停用账号根本拿不到 actor。
 *
 * 变更请求 CR-1（蓝图 §7）：payB2bPurchase 的 create/pay/markOfflinePending/list 前判 'order'，
 * supplierList 前判 'demand' —— 把本文件与 deskCore.js 原样复制过去即可。
 */
const { DESK_FEATURES, normalizeFeatures, rolesOfRow, deskSidesOf } = require('./deskCore')

const FEATURE_SIDE = {}
DESK_FEATURES.forEach((f) => { FEATURE_SIDE[f.key] = f.side })

/**
 * @param {object} actor    staffGuard.resolveActor 的结果（ok=true）
 * @param {object} staffRow staff_members 行（超管可为 null）
 * @param {string} key      功能项 key
 * @returns {{ ok: boolean, code?: string, msg?: string }}
 */
function hasDeskFeature(actor, staffRow, key) {
  if (!actor || !actor.ok) return { ok: false, code: 'FORBIDDEN', msg: (actor && actor.msg) || '请先登录' }
  if (actor.superAdmin) return { ok: true }
  const side = FEATURE_SIDE[key]
  if (!side) return { ok: false, code: 'UNKNOWN_FEATURE', msg: `未知功能项：${key}` }
  if (!staffRow || String(staffRow.status || 'active') !== 'active') {
    return { ok: false, code: 'FORBIDDEN', msg: '账号未开通或已停用，请联系山海造物对接人' }
  }
  const sides = deskSidesOf(rolesOfRow(staffRow))
  const sideOk = side === 'both' ? sides.buyer || sides.supplier : !!sides[side]
  if (!sideOk) return { ok: false, code: 'FORBIDDEN', msg: '当前角色无此功能' }
  const features = normalizeFeatures(staffRow.b2bDesk && staffRow.b2bDesk.features)
  if (features[key] !== true) {
    return { ok: false, code: 'FEATURE_OFF', msg: '该功能已被总部关闭，如需开通请联系对接人' }
  }
  return { ok: true }
}

/** 客户端展示用：本人生效的功能项（超管全开） */
function effectiveFeatures(actor, staffRow) {
  const out = {}
  DESK_FEATURES.forEach((f) => {
    out[f.key] = hasDeskFeature(actor, staffRow, f.key).ok
  })
  return out
}

module.exports = { hasDeskFeature, effectiveFeatures }
