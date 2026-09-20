/**
 * 印刷二维码（物料码）识别与「转化归因」—— **单一事实源**。
 *
 * 为什么需要（2026-09-20 产品负责人指派）：
 *   店里印出去的三张码（门店 AI 识别码 / 收银台注册码 / 祈福墙立牌码）此前**无法区分**：
 *   `analytics/session.js` 只把 `wx.getLaunchOptionsSync().scene` 记为**数字场景值**（1011/1047…），
 *   而三张码都是"扫码进入"，数字场景值完全相同 → 报表里三张码的转化只能看成一个数。
 *
 * 归因方式（与既有 `session.referrerPage` / `session.scene` 同构，不新增存储）：
 *   1. 本模块把码里的 `scene` 串解析成**物料 key**（见 `QR_MATERIALS`）；
 *   2. app 级入口（`app.js#maybeTrackQrMaterial`）把 key 写进 analytics session 的 `entrySource`；
 *   3. `analytics/index.js#buildPayload` 让**此后会话内所有事件**都带上 `entrySource`
 *      —— 于是"扫码→到达→转化"的整条漏斗都能按物料切开，而不必在每个转化点埋一遍。
 *
 * ⚠️ 云端 `trackUserBehavior` 有**字段白名单**（`BEHAVIOR_ALLOWED_FIELDS`）：`entrySource` 在白名单内，
 *    改字段名会让归因**被静默丢弃**（报表恒 0）。守卫 `check:analytics-schema` 已就这条加了断言。
 *
 * ⚠️ 新增/改动物料必须同步 ERP 镜像 `admin/src/utils/analyticsSchema.js` 的 `QR_MATERIALS`，
 *    否则报表里出现"有数据但没有对应漏斗"的孤儿行（同上守卫拦截）。
 */

/**
 * 三张印刷物料的登记表。
 * · `scene` 是**生成码时写进 `scene` 的原始内容**（`generate-store-qr.js --scene`）；
 * · `targetPage` 是这张码指向的页面（用于报表里"到达目标页"这一步的判据）；
 * · `key` 一旦发布**不可改**（已印出去的码 + 已入库的 `entrySource` 都按它聚合）。
 */
const QR_MATERIALS = [
  {
    key: 'identify_store',
    label: '门店 AI 识别码',
    scene: 'from=store_qr',
    targetPage: 'subpackages/feature/identify/index',
    convertAction: 'identify_success',
    note: '门店立牌/桌牌，扫码进 AI 识别主页（2026-09-15 生成）'
  },
  {
    key: 'register_counter',
    label: '收银台注册码',
    scene: 'from=counter_qr',
    targetPage: 'subpackages/extra/user/onboarding/index',
    convertAction: 'onboarding_complete',
    note: '收银台「新用户注册」立牌，扫码进注册页领新客礼（2026-09-15 生成）'
  },
  {
    key: 'wish_wall_store',
    label: '祈福墙立牌码',
    scene: 'from=store_qr&k=mashangyou',
    targetPage: 'subpackages/feature/wish-wall/index',
    convertAction: 'wish_wall_post',
    note: '祈福墙立牌，扫码进「马上有」祈福墙（2026-09-18 生成）'
  }
]

/** 物料 key → 埋点归因值（`entrySource`）。前缀 `qr:` 用来和普通入口区分开 */
function entrySourceOf(key) {
  const k = String(key || '').trim()
  return k ? `qr:${k}` : ''
}

/** 尽力解码（微信可能给已解码或仍带百分号编码的两种形态） */
function safeDecode(text) {
  const s = String(text == null ? '' : text)
  try {
    return decodeURIComponent(s)
  } catch (e) {
    return s
  }
}

/**
 * 从码的 `scene` 串解析物料 key；不是已登记物料则返回 `''`。
 *
 * 判据与 app 级入口路由**必须一致**（否则会出现"跳过去了但没归因"或反之）：
 *   · `k=` 优先于 `from=store_qr` —— 祈福墙立牌与门店识别码**共用** `from=store_qr` 令牌，
 *     靠 `k=mashangyou` 区分（2026-09-20 实测过抢页，见 docs/扫码识别入口兜底_2026-09-20.md §6）；
 *   · 未登记的 `k=`（别的墙）与其它 scene 一律不归因，返回空串。
 */
function parseQrMaterial(sceneText) {
  const scene = safeDecode(sceneText).trim()
  if (!scene) return ''
  const has = (token) => new RegExp(`(?:^|[&?])${token}(?:&|$)`).test(scene)
  const wallKey = /(?:^|[&?])k=([^&]+)/.exec(scene)
  if (wallKey) {
    // 只有登记的墙才归因；其它墙走各自物料，不在这里认领
    return decodeSafeValue(wallKey[1]) === 'mashangyou' ? 'wish_wall_store' : ''
  }
  if (has('from=counter_qr')) return 'register_counter'
  if (has('from=store_qr')) return 'identify_store'
  return ''
}

function decodeSafeValue(v) {
  return safeDecode(v).trim()
}

/** 按 key 取物料定义（报表/守卫共用），未登记返回 null */
function getQrMaterial(key) {
  const k = String(key || '')
  for (let i = 0; i < QR_MATERIALS.length; i++) {
    if (QR_MATERIALS[i].key === k) return QR_MATERIALS[i]
  }
  return null
}

module.exports = { QR_MATERIALS, parseQrMaterial, entrySourceOf, getQrMaterial }
