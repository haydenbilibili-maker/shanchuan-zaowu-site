/**
 * 店长运营内容写入代理
 * 鉴权：staffGuard — manager（含超管）
 *
 * action:
 *   upsert        collection + data + 可选 id（有 id 则 update，否则 add）
 *   update        collection + id + data；可选 pushFields（_.push）
 *   remove        collection + id
 *   removeWhere   collection + where（限量，用于分类级联删二级）
 *   setDoc        collection + id + data（整文档 set，如 configs/booking_config）
 *   getDoc        collection + id（管理端读 configs，匿名 CDN 常无权限）
 *   upsertByField collection + matchField + matchValue + data（如 care_guides.guideId）
 *   batchUpsertByField 同上批量
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')
const { writeAuditLog, auditFromActor } = require('./auditLog')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const ALLOWED_COLLECTIONS = {
  banners: { publicRead: true },
  categories: { publicRead: true },
  activities: { publicRead: true },
  rewards: { publicRead: false, shelfField: 'isOffShelf' },
  // 权益与营销（ERP「权益与营销」页签）：会员权益卡 / 虚拟权益商品
  vip_cards: { publicRead: false, shelfField: 'isOffShelf' },
  equity_goods: { publicRead: false, shelfField: 'isOffShelf' },
  // 飞书出货镜像：逐条 upsert 的镜像集合（SSOT 是 ops_shipments）。
  // 写入是 best-effort（调用方 try/catch 不阻断主库），故这里放行只为让镜像能真正落库。
  feishu_shipments: { publicRead: false },
  framers: { publicRead: true },
  care_guides: { publicRead: false },
  custom_configs: { publicRead: false },
  custom_inquiries: { publicRead: false },
  pet_memorial_orders: { publicRead: false },
  framer_recruit_applications: { publicRead: false },
  articles: { publicRead: true },
  cms_wikis: { publicRead: true },
  configs: {
    publicRead: false,
    allowSetDocIds: ['booking_config', 'feishu_bitable', 'b2b_catalog', 'member_growth_rules'],
    allowGetDocIds: ['booking_config', 'feishu_bitable', 'b2b_catalog', 'member_growth_rules']
  },
  // B2B 订货履约（ERP 订货单 / 意向转单 / 出货回写）与供货价目：集合规则 write:false 后只能经此代理写。
  // 仅超管（ERP 代理注入 adminOpsKey）；店长不可写，防止改价 / 改支付态。
  // 支付字段（paymentStatus/payFen/payOutTradeNos…）的变更只走 payB2bPurchase / b2bPayCallback。
  purchase_orders: {
    publicRead: false,
    superAdminOnly: true,
    denyActions: ['remove', 'removeWhere', 'setDoc'],
    denyFields: [
      'paymentStatus', 'paymentChannel', 'payFen', 'payOutTradeNo', 'payOutTradeNos', 'payTrades',
      'payAttempt', 'paidAt', 'paidFen', 'paidOutTradeNo', 'transactionId', 'refund', 'refundedAt',
      'payAnomaly', 'payDuplicate', 'payMarkNote', 'pricingMode', 'buyerOpenid'
    ]
  },
  price_list_items: {
    publicRead: false,
    superAdminOnly: true,
    denyActions: ['removeWhere', 'setDoc']
  }
}

/** 一次请求涉及的全部集合（batchUpsertByField 可逐条指定 collection） */
function collectionsOf(event) {
  const names = [String(event.collection || '').trim()]
  if (Array.isArray(event.items)) {
    event.items.forEach((it) => names.push(String((it && it.collection) || event.collection || '').trim()))
  }
  return Array.from(new Set(names.filter(Boolean)))
}

/**
 * 集合级门禁：超管专属集合 / 禁用动作 / 禁写字段（含点路径 'refund.status' 的根字段）。
 * 采购单确认对公到账走 payB2bPurchase.adminConfirmOffline，不经本代理。
 */
function gateCollections(event, action, actor) {
  for (const name of collectionsOf(event)) {
    const meta = ALLOWED_COLLECTIONS[name]
    if (!meta) continue
    if (meta.superAdminOnly && !(actor && actor.superAdmin)) {
      return { ok: false, msg: `集合 ${name} 仅超管可写`, code: 'SUPER_ADMIN_ONLY' }
    }
    if (Array.isArray(meta.denyActions) && meta.denyActions.indexOf(action) !== -1) {
      return { ok: false, msg: `集合 ${name} 不允许 ${action}`, code: 'ACTION_DENIED' }
    }
    if (Array.isArray(meta.denyFields)) {
      const payloads = [event.data, event.pushFields]
      if (Array.isArray(event.items)) event.items.forEach((it) => payloads.push(it && it.data))
      for (const p of payloads) {
        if (!p || typeof p !== 'object') continue
        for (const key of Object.keys(p)) {
          const root = key.split('.')[0]
          if (meta.denyFields.indexOf(root) === -1) continue
          return { ok: false, msg: `集合 ${name} 的字段 ${root} 不可经内容代理修改`, code: 'FIELD_DENIED' }
        }
      }
    }
  }
  return { ok: true }
}

const STRIP_KEYS = ['_id', '_openid', '_createTime']

function fail(msg, extra) {
  return { success: false, msg, ...(extra || {}) }
}

function sanitizeData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  Object.keys(raw).forEach((k) => {
    if (STRIP_KEYS.indexOf(k) !== -1) return
    out[k] = raw[k]
  })
  return out
}

function assertCollection(name) {
  const key = String(name || '').trim()
  if (!ALLOWED_COLLECTIONS[key]) {
    return { ok: false, msg: `集合未授权: ${key}` }
  }
  return { ok: true, name: key, meta: ALLOWED_COLLECTIONS[key] }
}

async function requireManager(openid, adminOpsKey) {
  return assertStaff(db, openid, { role: ROLE_MANAGER, adminOpsKey })
}

function applyPushFields(data, pushFields) {
  if (!pushFields || typeof pushFields !== 'object') return data
  const out = { ...data }
  Object.keys(pushFields).forEach((k) => {
    const val = pushFields[k]
    if (val === undefined) return
    out[k] = _.push(Array.isArray(val) ? val : [val])
  })
  return out
}

async function handleUpsert(event) {
  const col = assertCollection(event.collection)
  if (!col.ok) return fail(col.msg)
  const data = sanitizeData(event.data)
  if (!Object.keys(data).length) return fail('缺少 data')
  const id = String(event.id || '').trim()
  const now = Date.now()
  if (id) {
    // 更新：补齐 updateTime（ERP 靠它判断「是否被改过」）；
    // 不在更新时改写 createTime，避免打乱 ERP 的 createTime desc 排序。
    await db.collection(col.name).doc(id).update({ data: { ...data, updateTime: now } })
    return { success: true, id, op: 'update' }
  }
  // 新增：必须自带 createTime，否则 ERP 按 createTime 排序时该行会沉底/乱序。
  const addData = { ...data, createTime: data.createTime || now, updateTime: now }
  // 上架状态由集合声明兜底；小程序端无上架开关，不应因为改个库存就被强制重新上架。
  const shelfField = col.meta && col.meta.shelfField
  if (shelfField && addData[shelfField] === undefined) addData[shelfField] = false
  const addRes = await db.collection(col.name).add({ data: addData })
  return { success: true, id: addRes._id, op: 'add' }
}

async function handleUpdate(event) {
  const col = assertCollection(event.collection)
  if (!col.ok) return fail(col.msg)
  const id = String(event.id || '').trim()
  if (!id) return fail('缺少 id')
  let data = sanitizeData(event.data)
  data = applyPushFields(data, event.pushFields)
  if (!Object.keys(data).length) return fail('缺少 data')
  await db.collection(col.name).doc(id).update({ data })
  return { success: true, id, op: 'update' }
}

async function handleRemove(event) {
  const col = assertCollection(event.collection)
  if (!col.ok) return fail(col.msg)
  const id = String(event.id || '').trim()
  if (!id) return fail('缺少 id')
  await db.collection(col.name).doc(id).remove()
  return { success: true, id, op: 'remove' }
}

async function handleRemoveWhere(event) {
  const col = assertCollection(event.collection)
  if (!col.ok) return fail(col.msg)
  const where = event.where && typeof event.where === 'object' ? event.where : null
  if (!where || !Object.keys(where).length) return fail('缺少 where')
  const limit = Math.min(100, Math.max(1, parseInt(event.limit, 10) || 50))
  const res = await db.collection(col.name).where(where).limit(limit).get()
  const rows = res.data || []
  await Promise.all(rows.map((row) => db.collection(col.name).doc(row._id).remove()))
  return { success: true, removed: rows.length, op: 'removeWhere' }
}

async function handleSetDoc(event) {
  const col = assertCollection(event.collection)
  if (!col.ok) return fail(col.msg)
  const id = String(event.id || '').trim()
  if (!id) return fail('缺少 id')
  const allow = (col.meta.allowSetDocIds || [])
  if (allow.length && allow.indexOf(id) === -1) {
    return fail(`文档未授权 setDoc: ${id}`)
  }
  const data = sanitizeData(event.data)
  if (!Object.keys(data).length) return fail('缺少 data')
  await db.collection(col.name).doc(id).set({ data })
  return { success: true, id, op: 'setDoc' }
}

/** 管理端读 configs 等（匿名 CDN 常无读权限，与 setDoc 白名单对齐） */
async function handleGetDoc(event) {
  const col = assertCollection(event.collection)
  if (!col.ok) return fail(col.msg)
  const id = String(event.id || '').trim()
  if (!id) return fail('缺少 id')
  const allow = (col.meta.allowGetDocIds || col.meta.allowSetDocIds || [])
  if (allow.length && allow.indexOf(id) === -1) {
    return fail(`文档未授权 getDoc: ${id}`)
  }
  const res = await db.collection(col.name).doc(id).get()
  let data = res.data
  if (Array.isArray(data)) data = data.length ? data[0] : null
  return { success: true, id, data: data || null, op: 'getDoc' }
}

async function handleUpsertByField(event) {
  const col = assertCollection(event.collection)
  if (!col.ok) return fail(col.msg)
  const matchField = String(event.matchField || '').trim()
  const matchValue = event.matchValue
  if (!matchField) return fail('缺少 matchField')
  if (matchValue === undefined || matchValue === null || matchValue === '') {
    return fail('缺少 matchValue')
  }
  const data = sanitizeData(event.data)
  if (!Object.keys(data).length) return fail('缺少 data')
  const found = await db.collection(col.name).where({ [matchField]: matchValue }).limit(1).get()
  const row = found.data && found.data[0]
  if (row && row._id) {
    const next = { ...data }
    if (event.bumpVersion) {
      next.version = (Number(row.version) || 1) + 1
    }
    await db.collection(col.name).doc(row._id).update({ data: next })
    return { success: true, id: row._id, op: 'update' }
  }
  const createData = { ...data }
  if (event.bumpVersion && createData.version == null) createData.version = 1
  const addRes = await db.collection(col.name).add({ data: createData })
  return { success: true, id: addRes._id, op: 'add' }
}

async function handleBatchUpsertByField(event) {
  const items = Array.isArray(event.items) ? event.items : []
  if (!items.length) return fail('缺少 items')
  if (items.length > 80) return fail('单次最多 80 条')
  const results = []
  for (const item of items) {
    const one = await handleUpsertByField({
      collection: event.collection || item.collection,
      matchField: item.matchField || event.matchField,
      matchValue: item.matchValue,
      data: item.data,
      bumpVersion: item.bumpVersion != null ? item.bumpVersion : event.bumpVersion
    })
    if (!one.success) return one
    results.push(one)
  }
  return { success: true, count: results.length, results }
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''
  const adminOpsKey = event.adminOpsKey
  if (!openid && !adminOpsKey) return fail('请先登录')

  const action = String(event.action || '').trim()
  if (!action) return fail('缺少 action')

  const guard = await requireManager(openid, adminOpsKey)
  if (!guard.ok) return fail(guard.msg || '无权限', { code: guard.code })

  const gate = gateCollections(event, action, guard.actor)
  if (!gate.ok) return fail(gate.msg, { code: gate.code })

  try {
    let result
    switch (action) {
      case 'upsert':
        result = await handleUpsert(event)
        break
      case 'update':
        result = await handleUpdate(event)
        break
      case 'remove':
        result = await handleRemove(event)
        break
      case 'removeWhere':
        result = await handleRemoveWhere(event)
        break
      case 'setDoc':
        result = await handleSetDoc(event)
        break
      case 'getDoc':
        result = await handleGetDoc(event)
        break
      case 'upsertByField':
        result = await handleUpsertByField(event)
        break
      case 'batchUpsertByField':
        result = await handleBatchUpsertByField(event)
        break
      default:
        return fail(`未知 action: ${action}`)
    }

    if (result && result.success) {
      await writeAuditLog(
        db,
        auditFromActor(guard.actor, {
          action: `storeContent.${action}`,
          relatedId: result.id || '',
          relatedType: String(event.collection || ''),
          detail: { op: result.op || action },
          source: 'manageStoreContent'
        })
      )
    }
    return result
  } catch (e) {
    console.error('manageStoreContent', action, e)
    return fail(e.message || '操作失败')
  }
}
