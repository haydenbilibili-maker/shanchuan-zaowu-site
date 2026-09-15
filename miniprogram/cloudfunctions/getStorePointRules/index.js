/**
 * 门店消费赠积分规则读取 / 写入
 * 范式对齐 getSupportConfig：代码默认值 + 云端集合覆盖 + 异常降级
 * 配置读写仅超管；店长/店员发分由 grantStorePoints 服务端读已存规则，不经本接口
 * 历史审批通过时经 _fromApproval + 超管 openid 直通写入
 */
const cloud = require('wx-server-sdk')
const { getDefaultConfig, normalizeConfig, describeRule, VALID_MODES } = require('./defaults')
const { assertStaff } = require('./staffGuard')
const { ACTION, resolveApproverRole, actorWorkspaceRole } = require('./approvalRules')
const { enqueueApproval, markApprovalDecided } = require('./approvalBridge')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTION = 'store_point_rules'

const WRITABLE_FIELDS = [
  'name', 'status', 'priority', 'storeIds', 'mode', 'threshold', 'pointsPerThreshold',
  'ratio', 'minAmount', 'maxAmountPerRecord', 'roundMode', 'dailyPointsCapPerUser',
  'dailyPointsCapPerStore', 'dailyRecordCapPerUser', 'revokeWindowDays', 'notifyUser', 'remark',
  'modules', 'moduleRewards', 'platformOrderBind'
]

/**
 * 是否「非客户端来源」：小程序客户端调用必带 wx_client / wx_devtools，
 * 而云函数互调与定时触发不带该标记。用于确保「无 OPENID 时按请求字段
 * 声明身份」这一转发通道不会被 C 端伪造。
 */
function isNonClientSource() {
  try {
    const src = String((cloud.getWXContext() || {}).SOURCE || '')
    return !/wx_client|wx_devtools/i.test(src)
  } catch (e) {
    return false
  }
}

async function assertRulesAdmin(openid, event) {
  return assertStaff(db, openid, {
    requireSuperAdmin: true,
    permission: 'manageStorePointRules',
    adminOpsKey: event && event.adminOpsKey
  })
}

async function loadRule(storeId) {
  const res = await db.collection(COLLECTION)
    .where({ status: 'active' })
    .orderBy('priority', 'desc')
    .limit(20)
    .get()

  const rows = res.data || []
  if (!rows.length) return null

  const scoped = storeId
    ? rows.find((row) => Array.isArray(row.storeIds) && row.storeIds.indexOf(storeId) !== -1)
    : null
  if (scoped) return scoped

  return rows.find((row) => !Array.isArray(row.storeIds) || !row.storeIds.length) || null
}

async function readConfig(event, openid) {
  const guard = await assertRulesAdmin(openid, event)
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const storeId = String((event && event.storeId) || '').trim()

  let raw = null
  let fromDefault = true
  let fallback = false
  try {
    raw = await loadRule(storeId)
    fromDefault = !raw
  } catch (e) {
    console.warn('getStorePointRules fallback:', e.message)
    fallback = true
  }

  const merged = normalizeConfig(raw || {})

  return {
    success: true,
    config: merged,
    ruleText: describeRule(merged),
    ruleDocId: (raw && raw._id) || '',
    role: guard.actor.role || '',
    workspaceRole: guard.actor.workspaceRole || '',
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

async function applySave(openid, docId, data, normalized) {
  if (docId) {
    await db.collection(COLLECTION).doc(docId).update({ data })
    return { success: true, ruleDocId: docId, ruleText: describeRule(normalized) }
  }
  const added = await db.collection(COLLECTION).add({
    data: {
      ...data,
      ruleId: normalized.ruleId,
      status: 'active',
      createTime: db.serverDate(),
      createdBy: openid
    }
  })
  return { success: true, ruleDocId: added._id, ruleText: describeRule(normalized) }
}

async function saveConfig(event, openid) {
  const guard = await assertRulesAdmin(openid, event)
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const payload = pickWritable(event && event.config)
  if (payload.mode && VALID_MODES.indexOf(payload.mode) === -1) {
    return { success: false, msg: '赠送方式不合法' }
  }

  const docId = String((event && event.ruleDocId) || '').trim()
  const normalized = normalizeConfig({ ...(docId ? {} : getDefaultConfig()), ...payload })
  const data = pickWritable(normalized)
  data.updatedBy = openid
  data.updateTime = db.serverDate()

  const fromApproval = !!(event && event._fromApproval)
  const ws = actorWorkspaceRole(guard.actor)
  const approverRole = fromApproval ? null : resolveApproverRole(ACTION.STORE_POINT_RULES, ws)

  if (approverRole) {
    const enqueued = await enqueueApproval(db, {
      actionType: ACTION.STORE_POINT_RULES,
      applicantOpenid: openid,
      applicantName: guard.actor.name || '',
      applicantRole: guard.actor.role || '',
      applicantWorkspaceRole: ws,
      relatedId: docId || `new_${Date.now()}`,
      storeId: String((event && event.storeId) || '').trim(),
      title: `积分规则变更${docId ? '' : '（新建）'}`,
      summary: describeRule(normalized).slice(0, 120),
      payload: { ruleDocId: docId, config: data },
      source: 'getStorePointRules',
      approverRole
    })
    if (!enqueued.ok) return { success: false, msg: enqueued.msg || '提交审批失败' }
    return {
      success: true,
      pendingApproval: true,
      approvalId: enqueued.approvalId,
      msg: '已提交超管审核，通过后规则生效',
      ruleText: describeRule(normalized)
    }
  }

  try {
    const result = await applySave(openid, docId, data, normalized)
    await markApprovalDecided(db, {
      relatedId: result.ruleDocId || docId,
      actionType: ACTION.STORE_POINT_RULES,
      status: 'approved',
      decidedBy: openid,
      decidedByName: guard.actor.name || '',
      source: 'getStorePointRules.save'
    })
    return result
  } catch (e) {
    console.error('getStorePointRules save', e)
    if (/collection|集合/.test(e.message || '')) {
      return { success: false, msg: `请先在云开发控制台创建集合 ${COLLECTION}` }
    }
    return { success: false, msg: e.message || '规则保存失败' }
  }
}

exports.main = async (event) => {
  let openid = cloud.getWXContext().OPENID || ''
  if (!openid && isNonClientSource() && event && event._fromApproval && event._callerOpenid) {
    openid = String(event._callerOpenid).trim()
  }
  const action = (event && event.action) || 'get'

  try {
    if (!openid && !(event && event.adminOpsKey)) {
      return { success: false, msg: '请先登录' }
    }
    if (action === 'save') {
      return await saveConfig(event, openid || 'admin_ops')
    }
    if (action === 'get' || !action) {
      return await readConfig(event, openid || 'admin_ops')
    }
    return { success: false, msg: '未知操作' }
  } catch (e) {
    console.error('getStorePointRules', e)
    return { success: false, msg: e.message || '规则服务异常' }
  }
}
