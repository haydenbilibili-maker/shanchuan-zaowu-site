/**
 * 商城运费规则读取 / 写入
 * 集合 shipping_rules；代码默认值 + 云端覆盖 + 异常降级
 *
 * ⚠️ 本集合是**线上真源**：改代码默认值而不同步这里，代码改动一点都不会生效
 *    （云端文档覆盖代码默认值）。一致性由 `npm run check:shipping-rules-sync` 守卫。
 */
const cloud = require('wx-server-sdk')
const {
  getDefaultConfig,
  normalizeConfig,
  describeRule,
  toClientShape,
  VALID_MIX_STRATEGIES,
  VALID_CRAFT_TYPES
} = require('./defaults')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTION = 'shipping_rules'

const WRITABLE_FIELDS = [
  'name',
  'status',
  'priority',
  'defaultCarrier',
  'flatFee',
  'freeShippingThreshold',
  // 其它类型的门槛与费率（裁决 48：¥39 / ¥10）—— 已是正式字段，两个后台界面都可改
  'accessoryFreeThreshold',
  'accessoryFlatFee',
  'chargedCraftTypes',
  // —— 兼容镜像（保留以兼容老客户端/老 ERP 页面）——
  'specimenFreeThreshold',
  'mixCartStrategy',
  'freeShippingCampaign'
]

async function loadRule() {
  const res = await db.collection(COLLECTION)
    .where({ status: 'active' })
    .orderBy('priority', 'desc')
    .limit(5)
    .get()
  const rows = res.data || []
  if (!rows.length) return null
  return rows[0]
}

async function readConfig() {
  let raw = null
  let fromDefault = true
  let fallback = false
  try {
    raw = await loadRule()
    fromDefault = !raw
  } catch (e) {
    console.warn('getShippingRules fallback:', e.message)
    fallback = true
  }

  const merged = normalizeConfig(raw || {})
  const client = toClientShape(merged)

  return {
    success: true,
    config: client,
    ruleText: describeRule(merged),
    ruleDocId: (raw && raw._id) || '',
    default: fromDefault,
    ...(fallback ? { fallback: true } : {})
  }
}

function pickWritable(payload) {
  const out = {}
  WRITABLE_FIELDS.forEach((key) => {
    if (payload && Object.prototype.hasOwnProperty.call(payload, key)) out[key] = payload[key]
  })
  return out
}

async function saveConfig(event, openid) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    permission: 'manageShippingRules',
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const payload = pickWritable(event && event.config)
  if (payload.mixCartStrategy && VALID_MIX_STRATEGIES.indexOf(payload.mixCartStrategy) === -1) {
    return { success: false, msg: '混合车策略不合法' }
  }

  // 收费装裱方式清单：必须显式、非空、且每个 key 都在规范取值表内。
  // ⚠️ 未知 key 一律**拒绝**而不是静默丢弃 —— 静默丢弃会让该类商品掉成免邮（少收钱），
  //    而保存者以为已经收上费了（2026-09-19 定案的口径：宁可不保存，不可静默漏收）。
  if (Object.prototype.hasOwnProperty.call(payload, 'chargedCraftTypes')) {
    if (!Array.isArray(payload.chargedCraftTypes)) {
      return { success: false, msg: '收费装裱方式必须是数组' }
    }
    const cleaned = payload.chargedCraftTypes
      .map((v) => String(v == null ? '' : v).trim().toLowerCase())
      .filter(Boolean)
    if (!cleaned.length) {
      return { success: false, msg: '至少保留一种收费装裱方式（清空会让所有订单都掉进「其它类型」档 ¥39/¥10）' }
    }
    const unknown = cleaned.filter((k) => VALID_CRAFT_TYPES.indexOf(k) === -1)
    if (unknown.length) {
      return { success: false, msg: `未知装裱方式：${unknown.join('、')}` }
    }
    payload.chargedCraftTypes = cleaned
  }

  const docId = String((event && event.ruleDocId) || '').trim()
  const normalized = normalizeConfig({ ...(docId ? {} : getDefaultConfig()), ...payload })
  const data = pickWritable(normalized)
  data.ruleId = normalized.ruleId
  data.updatedBy = openid || (guard.actor && guard.actor.openid) || 'admin'
  data.updateTime = db.serverDate()

  try {
    if (docId) {
      await db.collection(COLLECTION).doc(docId).update({ data })
      return {
        success: true,
        ruleDocId: docId,
        config: toClientShape(normalized),
        ruleText: describeRule(normalized)
      }
    }
    const added = await db.collection(COLLECTION).add({
      data: {
        ...data,
        status: 'active',
        createTime: db.serverDate(),
        createdBy: openid || 'admin'
      }
    })
    return {
      success: true,
      ruleDocId: added._id,
      config: toClientShape(normalized),
      ruleText: describeRule(normalized)
    }
  } catch (e) {
    console.error('getShippingRules save', e)
    if (/collection|集合/.test(e.message || '')) {
      return { success: false, msg: `请先在云开发控制台创建集合 ${COLLECTION}` }
    }
    return { success: false, msg: e.message || '规则保存失败' }
  }
}

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID
  const action = (event && event.action) || 'get'

  try {
    if (action === 'save') return await saveConfig(event, openid)
    return await readConfig()
  } catch (e) {
    console.error('getShippingRules', e)
    const fallback = getDefaultConfig()
    return {
      success: true,
      config: toClientShape(fallback),
      ruleText: describeRule(fallback),
      default: true,
      fallback: true
    }
  }
}
