/**
 * secureDataWrite 写入策略（纯函数，无 SDK 依赖，便于单测）
 *
 * WRITE_POLICY：集合 → { ops, allowFields?, pii? }
 *   ops          允许的动作（add / update / remove）；不在表里的集合一律拒绝
 *   allowFields  只允许写这些根字段（点路径取第一段）；不设 = 除全局禁写外均可
 *   pii          消费者个人信息集合：拒绝把脱敏值（含 **）写回手机 / 姓名 / 地址字段
 *
 * 刻意不收：admin_users / admin_roles（无任何写入方，且属权限类高危表）、
 *   finance_settings / store_ledger（ERP 改走 syncFinanceData 的 upload_settings / upload_records，
 *   后者按时间戳 + 字段级合并写门店账本 SSOT）、feishu_shipments（manageStoreContent）、
 *   purchase_orders / price_list_items（B2B 支付流）。
 * 与 admin/src/utils/cloudbaseCdnDb.js 的 PROXY_WRITE_COLLECTIONS 必须逐项一致（check:sensitive-rules 校验）。
 */
const WRITE_POLICY = {
  refunds: { ops: ['add', 'update'], pii: true },
  waitlist: {
    ops: ['update'],
    allowFields: ['status', 'notifiedAt', 'convertedAt', 'cancelTime', 'updateTime', 'updatedAt'],
    pii: true
  },
  purchase_intents: {
    ops: ['update'],
    allowFields: ['status', 'updatedAt', 'convertedOrderId', 'convertedAt']
  },
  stores: { ops: ['add', 'update', 'remove'] },
  store_zones: { ops: ['add', 'update', 'remove'] },
  home_configs: { ops: ['add', 'update', 'remove'] },
  pet_craft_configs: { ops: ['add', 'update', 'remove'] },
  feishu_inventory: { ops: ['add', 'update'] },
  feishu_purchases: { ops: ['add', 'update'] },
  feishu_sync_logs: { ops: ['add'] },
  fulfillment_shipments: { ops: ['add', 'update'] },
  stock_movements: { ops: ['add'] },
  finance_records: { ops: ['remove'] },
  // 仅库存类写入（飞书库存对齐 / 财务库存同步 / B2B 出货扣减）；改价、上下架、入档等走 manageProducts / manageApprovals
  products: { ops: ['update'], allowFields: ['stock', 'skus', 'soldCount', 'updateTime'] },
  // 内容 / 配置表（2026-09-29 第三轮）：动作按 ERP 实际调用点取最小集
  achievement_configs: { ops: ['add', 'update', 'remove'] },
  benchmark_research_docs: { ops: ['add', 'update'] },
  booking_rules: { ops: ['add', 'update'] },
  content_display_flags: { ops: ['add', 'update'] },
  content_topics: { ops: ['add', 'update'] },
  content_assets: { ops: ['add'] },
  content_pieces: { ops: ['add', 'update'] },
  content_reviews: { ops: ['add'] },
  content_analytics: { ops: ['add'] },
  marketing_rules_config: { ops: ['add', 'update'] },
  member_levels: { ops: ['add', 'update', 'remove'] },
  recommend_algorithm_config: { ops: ['add', 'update'] },
  search_blacklist: { ops: ['add', 'update', 'remove'] },
  search_hot_keywords: { ops: ['add', 'update', 'remove'] },
  support_configs: { ops: ['add', 'update', 'remove'] },
  user_behavior_config: { ops: ['add', 'update'] },
  // 券模板（ERP 营销中心）：规则 write:false，2026-10-29 前 ERP 直写必被拒
  coupons: { ops: ['add', 'update', 'remove'] }
}

const OPS = { add: 1, update: 1, remove: 1 }
const SYSTEM_TIME_KEYS = { _createTime: 1, _updateTime: 1 }
const STRIP_KEYS = { _openid: 1 }
const ROOT_KEY_RE = /^[A-Za-z][\w]{0,63}$/
const PATH_SEG_RE = /^[A-Za-z_]\w{0,63}$/
const DOC_ID_RE = /^[\w-]{1,64}$/
const MAX_DEPTH = 12
const MAX_BYTES = 256 * 1024

const PHONE_KEY = /^(phone|mobile|tel|telNumber|phoneNumber|purePhoneNumber|contactPhone|receiverPhone|userPhone|consigneePhone)$/i
const PERSON_NAME_KEY = /^(receiverName|consigneeName|contactName|realName|userName|buyerName|name)$/i
const ADDRESS_KEY = /^(detailInfo|detailAddress|addressDetail|fullAddress|shipToAddress|address|detail|street)$/i

function badInput(msg) {
  const err = new Error(msg)
  err.code = 'BAD_INPUT'
  return err
}

function isPlainObject(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

function isAllowedCollection(name) {
  return Object.prototype.hasOwnProperty.call(WRITE_POLICY, String(name || ''))
}

function isOpAllowed(collection, op) {
  return isAllowedCollection(collection) && WRITE_POLICY[collection].ops.indexOf(op) !== -1
}

/** {$date: ms} → Date；其余以 $ 开头的键（查询/更新操作符）一律拒绝 */
function decodeValue(v, depth) {
  if (depth > MAX_DEPTH) throw badInput('数据嵌套过深')
  if (Array.isArray(v)) return v.map((x) => decodeValue(x, depth + 1))
  if (v && typeof v === 'object') {
    if (!isPlainObject(v)) throw badInput('数据只接受普通对象')
    const keys = Object.keys(v)
    if (keys.length === 1 && keys[0] === '$date') {
      const ms = Number(v.$date)
      if (!Number.isFinite(ms)) throw badInput('非法日期')
      return new Date(ms)
    }
    const out = {}
    for (const k of keys) {
      if (k.charAt(0) === '$') throw badInput(`不接受操作符字段：${k}`)
      out[k] = decodeValue(v[k], depth + 1)
    }
    return out
  }
  return v
}

function looksMasked(v) {
  return typeof v === 'string' && v.indexOf('**') !== -1
}

/** 在 PII 集合里，手机/姓名/地址类字段（含嵌套）不得写入脱敏值 */
function findMaskedPii(value, key, depth) {
  if (depth > MAX_DEPTH) return ''
  if (Array.isArray(value)) {
    for (const x of value) {
      const hit = findMaskedPii(x, key, depth + 1)
      if (hit) return hit
    }
    return ''
  }
  if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      const hit = findMaskedPii(value[k], k, depth + 1)
      if (hit) return hit
    }
    return ''
  }
  const leaf = String(key || '').split('.').pop()
  if (looksMasked(value) && (PHONE_KEY.test(leaf) || PERSON_NAME_KEY.test(leaf) || ADDRESS_KEY.test(leaf))) return leaf
  return ''
}

/**
 * 校验并解码写入数据。
 * @returns {{ data: object, fields: string[], id?: string }}
 */
function prepareData(collection, op, raw) {
  const policy = WRITE_POLICY[collection]
  if (!isPlainObject(raw)) throw badInput('缺少 data')
  if (JSON.stringify(raw).length > MAX_BYTES) throw badInput('数据过大')
  const allow = policy.allowFields ? new Set(policy.allowFields) : null
  const data = {}
  let docId = ''
  for (const key of Object.keys(raw)) {
    if (STRIP_KEYS[key]) continue
    if (key === '_id') {
      if (op !== 'add') throw badInput('不能修改 _id')
      const id = String(raw._id || '')
      if (!DOC_ID_RE.test(id)) throw badInput('非法 _id')
      docId = id
      continue
    }
    const segs = key.split('.')
    const root = segs[0]
    if (SYSTEM_TIME_KEYS[key]) {
      // 允许 ERP 账本类的 _createTime / _updateTime
    } else if (!ROOT_KEY_RE.test(root) || !segs.slice(1).every((s) => PATH_SEG_RE.test(s))) {
      throw badInput(`非法字段名：${key}`)
    } else if (segs.length > 1 && op !== 'update') {
      throw badInput(`点路径只用于 update：${key}`)
    }
    if (allow && !allow.has(root)) throw badInput(`集合 ${collection} 不允许写字段 ${root}`)
    data[key] = decodeValue(raw[key], 1)
  }
  const fields = Object.keys(data)
  if (!fields.length) throw badInput('缺少 data')
  if (policy.pii) {
    const hit = findMaskedPii(data, '', 0)
    if (hit) throw badInput(`字段 ${hit} 是脱敏值，不能写回（请留空或填原值）`)
  }
  return docId ? { data, fields, id: docId } : { data, fields }
}

function normalizeId(id) {
  const s = String(id || '').trim()
  if (!DOC_ID_RE.test(s)) throw badInput('缺少或非法 id')
  return s
}

module.exports = {
  WRITE_POLICY,
  OPS,
  isAllowedCollection,
  isOpAllowed,
  prepareData,
  normalizeId,
  decodeValue
}
