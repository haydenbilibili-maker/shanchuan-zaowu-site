/**
 * secureDataRead 纯逻辑：集合白名单 / 脱敏策略 / 过滤条件解码（不依赖 wx-server-sdk，便于本地单测）
 *
 * MASK  = C 端个人信息表：手机号 / 地址明细 / 联系人姓名默认脱敏
 * PLAIN = 经营 / 财务 / 账号 / B2B 线索表：不脱敏（仅超管可读；B2B 线索需回电、转单要写入原值）
 * 所有集合一律剔除密码 / 密钥 / 令牌类字段。
 */
const MASK = 'mask'
const PLAIN = 'plain'

const COLLECTION_POLICY = {
  orders: MASK,
  bookings: MASK,
  refunds: MASK,
  support_tickets: MASK,
  custom_inquiries: MASK,
  custom_drafts: MASK,
  pet_memorial_orders: MASK,
  waitlist: MASK,
  pickup_verify_logs: MASK,
  notification_logs: MASK,
  framer_recruit_applications: MASK,
  purchase_intents: PLAIN,
  admin_users: PLAIN,
  admin_roles: PLAIN,
  admin_login_logs: PLAIN,
  admin_operation_logs: PLAIN,
  finance_records: PLAIN,
  finance_settings: PLAIN,
  store_ledger: PLAIN,
  daily_revenues: PLAIN,
  feishu_inventory: PLAIN,
  feishu_purchases: PLAIN,
  feishu_shipments: PLAIN,
  feishu_sync_logs: PLAIN,
  fulfillment_shipments: PLAIN,
  stock_movements: PLAIN
}

/** 这些集合的顶层 name 是顾客/申请人本人姓名（其余集合的 name 多为商品/门店/角色名，不得脱敏） */
const TOP_LEVEL_PERSON_NAME = {
  bookings: true,
  waitlist: true,
  framer_recruit_applications: true
}

const SECRET_KEY = /^(password|passwd|pwd|passwordHash|pwdHash|salt|secret|secretKey|appSecret|token|accessToken|refreshToken|sessionKey|session_key|apiKey|opsKey|adminOpsKey)$/i
const PHONE_KEY = /^(phone|mobile|tel|telNumber|phoneNumber|purePhoneNumber|contactPhone|receiverPhone|userPhone|consigneePhone)$/i
const ADDRESS_TEXT_KEY = /^(detailInfo|detailAddress|addressDetail|fullAddress|shipToAddress|address)$/i
/** detail / street 只在联系人/地址容器内才算地址（工单等的 detail 是正文） */
const ADDRESS_TEXT_IN_CONTAINER_KEY = /^(detail|street)$/i
const PERSON_NAME_KEY = /^(receiverName|consigneeName|contactName|realName|userName|buyerName)$/i
const ID_CARD_KEY = /^(idCard|idNumber|idNo)$/i
const CONTACT_CONTAINER_KEY = /^(address|contact|receiver|consignee|shipping|shippingAddress|deliveryAddress|receiverInfo|userAddress)$/i

const MASK_MARK = '**'

function maskPhone(v) {
  const s = String(v)
  const digits = s.replace(/\D/g, '')
  if (digits.length >= 7) return `${digits.slice(0, 3)}****${digits.slice(-4)}`
  return s ? `${s.slice(0, 1)}****` : s
}

function maskName(v) {
  const s = String(v)
  return s ? `${s.slice(0, 1)}${MASK_MARK}` : s
}

function maskAddress(v) {
  const s = String(v)
  if (!s) return s
  return s.length > 6 ? `${s.slice(0, 6)}****` : `${MASK_MARK}**`
}

function maskIdCard(v) {
  const s = String(v)
  return s.length > 4 ? `${s.slice(0, 2)}**********${s.slice(-2)}` : `${MASK_MARK}**`
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
}

/**
 * 递归处理单个文档：剔除密钥字段；MASK 策略下再脱敏个人信息。
 * parentKey 用于判断 `name` 是否处于联系人/地址容器内。
 */
function sanitizeValue(value, ctx, parentKey, depth) {
  if (depth > 8) return value
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v, ctx, parentKey, depth + 1))
  if (!isPlainObject(value)) return value
  const out = {}
  for (const key of Object.keys(value)) {
    if (SECRET_KEY.test(key)) continue
    const v = value[key]
    if (ctx.mask && (typeof v === 'string' || typeof v === 'number') && v !== '') {
      const inContainer = !!parentKey && CONTACT_CONTAINER_KEY.test(parentKey)
      if (PHONE_KEY.test(key)) { out[key] = maskPhone(v); continue }
      if (ID_CARD_KEY.test(key)) { out[key] = maskIdCard(v); continue }
      if (typeof v === 'string') {
        if (ADDRESS_TEXT_KEY.test(key) || (inContainer && ADDRESS_TEXT_IN_CONTAINER_KEY.test(key))) {
          out[key] = maskAddress(v)
          continue
        }
        if (PERSON_NAME_KEY.test(key)) { out[key] = maskName(v); continue }
        if (key === 'name' && (inContainer || (depth === 0 && ctx.topLevelPersonName))) {
          out[key] = maskName(v)
          continue
        }
      }
    }
    out[key] = sanitizeValue(v, ctx, key, depth + 1)
  }
  return out
}

function sanitizeDoc(collection, doc, { reveal = false } = {}) {
  const policy = COLLECTION_POLICY[collection]
  const ctx = {
    mask: policy === MASK && !reveal,
    topLevelPersonName: !!TOP_LEVEL_PERSON_NAME[collection]
  }
  return sanitizeValue(doc, ctx, '', 0)
}

/** Date → {$date: ms}，供 ERP 端还原为 Date（HTTP 代理 JSON 化会把 Date 变成字符串，破坏排序/比较） */
function encodeOut(value, depth = 0) {
  if (depth > 12) return value
  if (value instanceof Date) return { $date: value.getTime() }
  if (Array.isArray(value)) return value.map((v) => encodeOut(v, depth + 1))
  if (isPlainObject(value)) {
    const out = {}
    for (const k of Object.keys(value)) out[k] = encodeOut(value[k], depth + 1)
    return out
  }
  return value
}

const FIELD_RE = /^[A-Za-z_][\w.]{0,63}$/
const VALUE_OPS = { eq: 1, neq: 1, gt: 1, gte: 1, lt: 1, lte: 1 }
const LIST_OPS = { in: 1, nin: 1 }
const LOGIC_OPS = { and: 1, or: 1 }
const MAX_LIST = 200
const MAX_REGEX = 64

function badInput(msg) {
  const err = new Error(msg)
  err.code = 'BAD_INPUT'
  return err
}

/**
 * 线格式 → 数据库查询条件
 *   原始值              相等
 *   {$date: ms}         Date
 *   {$regex, $options}  正则（长度 ≤ 64）
 *   {$op, $args}        命令：eq/neq/gt/gte/lt/lte/in/nin/exists/and/or（字段级）
 *   普通对象            嵌套字段相等
 * deps = { command: db.command, RegExp: db.RegExp }
 */
function decodeValue(v, deps, depth) {
  if (depth > 6) throw badInput('查询条件嵌套过深')
  if (v == null || typeof v !== 'object') return v
  if (Array.isArray(v)) {
    if (v.length > MAX_LIST) throw badInput('数组条件过长')
    return v.map((x) => decodeValue(x, deps, depth + 1))
  }
  if (Object.prototype.hasOwnProperty.call(v, '$date')) {
    const ms = Number(v.$date)
    if (!Number.isFinite(ms)) throw badInput('无效日期条件')
    return new Date(ms)
  }
  if (Object.prototype.hasOwnProperty.call(v, '$regex')) {
    const regexp = String(v.$regex || '')
    const options = String(v.$options || '')
    if (regexp.length > MAX_REGEX) throw badInput('正则条件过长')
    if (!/^[imsx]*$/.test(options)) throw badInput('无效正则选项')
    // 空正则 = 不筛选（服务端 SDK 拒绝空串 regexp）
    if (!regexp) return undefined
    return deps.RegExp({ regexp, options })
  }
  if (Object.prototype.hasOwnProperty.call(v, '$op')) return decodeCommand(v, deps, depth)
  const out = {}
  for (const k of Object.keys(v)) {
    if (!FIELD_RE.test(k)) throw badInput(`非法字段名：${k}`)
    const decoded = decodeValue(v[k], deps, depth + 1)
    if (decoded !== undefined) out[k] = decoded
  }
  return out
}

function decodeCommand(v, deps, depth) {
  const op = String(v.$op || '')
  const args = Array.isArray(v.$args) ? v.$args : []
  const _ = deps.command
  if (VALUE_OPS[op]) return _[op](decodeValue(args[0], deps, depth + 1))
  if (LIST_OPS[op]) {
    if (args.length > MAX_LIST) throw badInput('in 条件过长')
    return _[op](args.map((x) => decodeValue(x, deps, depth + 1)))
  }
  if (op === 'exists') return _.exists(!!args[0])
  if (LOGIC_OPS[op]) {
    if (!args.length || args.length > 8) throw badInput('逻辑条件项数无效')
    return _[op](args.map((x) => decodeValue(x, deps, depth + 1)))
  }
  throw badInput(`不支持的查询操作：${op}`)
}

function decodeWhere(where, deps) {
  if (where == null) return null
  if (!isPlainObject(where)) throw badInput('where 必须是对象')
  const keys = Object.keys(where)
  if (!keys.length) return null
  if (keys.length > 12) throw badInput('查询字段过多')
  return decodeValue(where, deps, 0)
}

function normalizeOrderBy(orderBy) {
  const list = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []
  return list.slice(0, 2).map((o) => {
    const field = String((o && o.field) || '')
    if (!FIELD_RE.test(field)) throw badInput(`非法排序字段：${field}`)
    const direction = o.direction === 'asc' ? 'asc' : 'desc'
    return { field, direction }
  })
}

function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10)
  if (!Number.isFinite(n)) return dflt
  return Math.min(Math.max(n, min), max)
}

function isAllowedCollection(name) {
  return Object.prototype.hasOwnProperty.call(COLLECTION_POLICY, String(name || ''))
}

module.exports = {
  MASK,
  PLAIN,
  MASK_MARK,
  COLLECTION_POLICY,
  isAllowedCollection,
  sanitizeDoc,
  encodeOut,
  decodeWhere,
  normalizeOrderBy,
  clampInt,
  maskPhone,
  maskName,
  maskAddress
}
