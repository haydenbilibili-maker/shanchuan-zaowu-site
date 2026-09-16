/**
 * 多平台订单绑定兑积分（一期）
 *
 * 用户提交外部平台订单号 → 店长人工确认金额与真实性 → 按门店赠分规则入账。
 * 防重复：platform_order_binds.dedupeKey = `${platformId}:${orderNo}`（唯一索引 dedupeKey_1）
 * 集合权限对齐 store_purchases：仅云函数可读写（read/write: false）
 *
 * action: getOptions | submit | listMine | listPending | approve | reject
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')
const { normalizeConfig, calcPoints, describeRule, isModuleEnabled } = require('./defaults')
const { loadBalance, loadUserDoc, ensureUserDoc } = require('./pointsBalance')
const { dispatchInAppMessage } = require('./inAppMessage')
const { ACTION } = require('./approvalRules')
const { enqueueApproval, markApprovalDecided } = require('./approvalBridge')
// 来源判定统一真源（负向子串判定对互调合并串会判反，详见 sourceOrigin.js 顶部说明）
const { isNonClientSource } = require('./sourceOrigin')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const BINDS = 'platform_order_binds'
const RULES = 'store_point_rules'
const POINT_RECORDS = 'point_records'
const STATUS_PENDING = 'pending'
const STATUS_APPROVED = 'approved'
const STATUS_REJECTED = 'rejected'

function fail(msg, extra) {
  return { success: false, msg, ...(extra || {}) }
}

function parseAmount(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100) / 100
}

function isDuplicateKeyError(e) {
  const msg = (e && (e.message || e.errMsg)) || ''
  return /duplicate|E11000|已存在|unique/i.test(msg)
}

async function loadRuleConfig(storeId) {
  try {
    const res = await db.collection(RULES)
      .where({ status: 'active' })
      .orderBy('priority', 'desc')
      .limit(20)
      .get()
    const rows = res.data || []
    const scoped = storeId
      ? rows.find((row) => Array.isArray(row.storeIds) && row.storeIds.indexOf(storeId) !== -1)
      : null
    const global = rows.find((row) => !Array.isArray(row.storeIds) || !row.storeIds.length)
    return normalizeConfig(scoped || global || {})
  } catch (e) {
    return normalizeConfig({})
  }
}

async function getOptions(event) {
  const storeId = String((event && event.storeId) || '').trim()
  const config = await loadRuleConfig(storeId)
  const enabled = isModuleEnabled(config, 'orderBind')
  return {
    success: true,
    enabled,
    platforms: (config.platformOrderBind && config.platformOrderBind.platforms) || [],
    requireAmount: !!(config.platformOrderBind && config.platformOrderBind.requireAmount !== false),
    ruleText: describeRule(config),
    notice: enabled
      ? '选择下单平台，填写订单号与实付金额。店长核对属实后，按门店消费规则入账（通常 3 个工作日内）。同一平台订单号仅可绑定一次。'
      : '外部订单绑定暂未开放'
  }
}

async function submitBind(event, openid) {
  const storeId = String((event && event.storeId) || '').trim()
  const config = await loadRuleConfig(storeId)
  if (!isModuleEnabled(config, 'orderBind')) {
    return fail('外部订单绑定暂未开放')
  }

  const platformId = String((event && event.platformId) || '').trim()
  const orderNo = String((event && event.orderNo) || '').trim().slice(0, 64)
  const remark = String((event && event.remark) || '').trim().slice(0, 200)
  if (!platformId || !orderNo) return fail('请选择平台并填写订单号')

  const platforms = (config.platformOrderBind && config.platformOrderBind.platforms) || []
  const platform = platforms.find((p) => p.id === platformId)
  if (!platform) return fail('不支持的平台类型')

  const requireAmount = !(config.platformOrderBind && config.platformOrderBind.requireAmount === false)
  let amount = null
  if (event && event.amount !== undefined && event.amount !== null && event.amount !== '') {
    amount = parseAmount(event.amount)
    if (amount === null) return fail('请输入正确的消费金额')
  }
  if (requireAmount && amount === null) return fail('请填写订单实付金额')

  const preview = amount != null ? calcPoints(config, amount) : { points: 0 }
  const dedupeKey = `${platformId}:${orderNo}`

  try {
    const dup = await db.collection(BINDS).where({ dedupeKey }).limit(1).get()
    if (dup.data && dup.data.length) {
      const row = dup.data[0]
      return fail(
        row.status === STATUS_APPROVED
          ? '该订单已绑定并入账'
          : row.status === STATUS_PENDING
            ? '该订单已提交，等待店长审核'
            : '该订单曾被驳回，请联系店员处理',
        { existingStatus: row.status }
      )
    }
  } catch (e) {
    if (/collection|集合/.test(e.message || '')) {
      return fail(`请先在云开发控制台创建集合 ${BINDS}`)
    }
  }

  try {
    const added = await db.collection(BINDS).add({
      data: {
        _openid: openid,
        memberOpenid: openid,
        storeId,
        platformId,
        platformName: platform.name,
        orderNo,
        amount: amount || 0,
        previewPoints: preview.points || 0,
        ruleSnapshot: preview.ruleSnapshot || null,
        remark,
        dedupeKey,
        status: STATUS_PENDING,
        createTime: db.serverDate()
      }
    })
    try {
      await dispatchInAppMessage(db, {
        eventType: 'platform_order_submitted',
        openid,
        relatedId: added._id,
        vars: {
          platformName: platform.name || '外部平台',
          orderNo,
          amountText: amount != null ? `（¥${amount}）` : ''
        }
      })
    } catch (e) {
      console.warn('platform bind submit message skipped:', e.message)
    }
    try {
      await enqueueApproval(db, {
        actionType: ACTION.POINTS_PLATFORM_BIND,
        applicantOpenid: openid,
        applicantName: '',
        applicantRole: 'customer',
        applicantWorkspaceRole: 'customer',
        relatedId: added._id,
        storeId,
        title: `${platform.name || '外部'}订单认领`,
        summary: `${orderNo}${amount ? ' · ¥' + amount : ''} · 预计 +${preview.points || 0} 分`,
        payload: {
          bindId: added._id,
          orderNo,
          amount: amount || 0,
          points: preview.points || 0,
          platformName: platform.name || ''
        },
        source: 'bindPlatformOrder'
      })
    } catch (e) {
      console.warn('enqueueApproval platform skipped', e && e.message)
    }
    return {
      success: true,
      bindId: added._id,
      previewPoints: preview.points || 0,
      msg: '已提交，等待店长审核'
    }
  } catch (e) {
    if (isDuplicateKeyError(e)) return fail('该订单已提交过')
    console.error('bindPlatformOrder submit', e)
    return fail(e.message || '提交失败')
  }
}

async function listMine(event, openid) {
  const page = Math.max(1, parseInt((event && event.page) || 1, 10) || 1)
  const pageSize = Math.min(30, Math.max(5, parseInt((event && event.pageSize) || 20, 10) || 20))
  try {
    const where = { memberOpenid: openid }
    const totalRes = await db.collection(BINDS).where(where).count()
    const res = await db.collection(BINDS)
      .where(where)
      .orderBy('createTime', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    return {
      success: true,
      list: res.data || [],
      total: totalRes.total || 0,
      hasMore: page * pageSize < (totalRes.total || 0)
    }
  } catch (e) {
    if (/collection|集合/.test(e.message || '')) {
      return { success: true, list: [], total: 0, hasMore: false }
    }
    return fail('加载失败')
  }
}

async function listPending(event, openid) {
  const storeId = String((event && event.storeId) || '').trim()
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    storeId,
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  // status: pending|approved|rejected；空字符串或 all 表示全部（Admin 筛选用）
  const rawStatus = String((event && event.status) != null ? event.status : STATUS_PENDING).trim()
  const status =
    rawStatus === '' || rawStatus === 'all'
      ? ''
      : rawStatus || STATUS_PENDING
  const page = Math.max(1, parseInt((event && event.page) || 1, 10) || 1)
  const pageSize = Math.min(50, Math.max(5, parseInt((event && event.pageSize) || 20, 10) || 20))

  const where = {}
  if (status) where.status = status
  if (storeId) where.storeId = storeId
  const hasWhere = Object.keys(where).length > 0

  try {
    let countQuery = db.collection(BINDS)
    let listQuery = db.collection(BINDS)
    if (hasWhere) {
      countQuery = countQuery.where(where)
      listQuery = listQuery.where(where)
    }
    const totalRes = await countQuery.count()
    const res = await listQuery
      .orderBy('createTime', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    return {
      success: true,
      list: res.data || [],
      total: totalRes.total || 0,
      hasMore: page * pageSize < (totalRes.total || 0),
      ruleText: describeRule(await loadRuleConfig(storeId))
    }
  } catch (e) {
    if (/collection|集合/.test(e.message || '')) {
      return fail(`请先在云开发控制台创建集合 ${BINDS}`)
    }
    return fail('加载失败')
  }
}

async function approveBind(event, openid) {
  const bindId = String((event && event.bindId) || '').trim()
  if (!bindId) return fail('缺少申请 id')

  let row = null
  try {
    const res = await db.collection(BINDS).doc(bindId).get()
    row = res.data
  } catch (e) {
    return fail('申请不存在')
  }
  if (!row) return fail('申请不存在')
  if (row.status !== STATUS_PENDING) return fail('该申请不是待审状态')

  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    storeId: row.storeId,
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const config = await loadRuleConfig(row.storeId)
  if (!isModuleEnabled(config, 'orderBind')) return fail('外部订单绑定模块已关闭')

  let amount = parseAmount(event && event.amount)
  if (amount === null) amount = parseAmount(row.amount)
  if (amount === null) return fail('请确认订单实付金额')
  if (amount > config.maxAmountPerRecord) return fail(`金额不得超过 ¥${config.maxAmountPerRecord}`)

  const calc = calcPoints(config, amount)
  const memberOpenid = row.memberOpenid
  const operatorOpenid = (guard.actor && guard.actor.openid) || openid || 'admin_web'

  // 0 分：只改状态即可
  if (calc.points <= 0) {
    try {
      await db.collection(BINDS).doc(bindId).update({
        data: {
          status: STATUS_APPROVED,
          amount,
          pointsGranted: 0,
          ruleSnapshot: calc.ruleSnapshot,
          approvedBy: operatorOpenid,
          approvedByName: guard.actor.name || '',
          approveTime: db.serverDate()
        }
      })
    } catch (e) {
      return fail('状态更新失败')
    }
    return {
      success: true,
      bindId,
      pointsGranted: 0,
      msg: `已通过，但按规则未达赠分门槛（${describeRule(config)}）`
    }
  }

  // 先入账再改状态，避免「已通过但未到账」；流水幂等键防重复加分
  let alreadyCredited = false
  try {
    await db.collection(POINT_RECORDS).add({
      data: {
        _openid: operatorOpenid,
        userOpenid: memberOpenid,
        type: 'earn',
        source: 'platform_order',
        action: 'platform_order',
        points: calc.points,
        title: `${row.platformName || '外部'}订单 ¥${amount}`,
        refCollection: BINDS,
        refId: bindId,
        dedupeKey: `platform_bind:${bindId}`,
        status: 'done',
        storeId: row.storeId || '',
        operatorOpenid,
        dateStr: new Date().toISOString().slice(0, 10),
        createTime: db.serverDate()
      }
    })
  } catch (e) {
    if (isDuplicateKeyError(e)) {
      alreadyCredited = true
    } else {
      console.error('bindPlatformOrder point_record', e)
      return fail('积分流水写入失败')
    }
  }

  if (!alreadyCredited) {
    try {
      const user = await loadUserDoc(db, memberOpenid)
      const userDocId = user ? user._id : await ensureUserDoc(db, memberOpenid)
      await db.collection('users').doc(userDocId).update({
        data: {
          bonusPoints: _.inc(calc.points),
          storePointsTotal: _.inc(calc.points),
          storeGrowthValue: _.inc(calc.points),
          // 外部平台订单不计入「门店消费累计」，单列 platformSpendTotal
          platformSpendTotal: _.inc(amount)
        }
      })
    } catch (e) {
      console.error('bindPlatformOrder inc points', e)
      return fail('积分入账失败')
    }
  }

  try {
    await db.collection(BINDS).doc(bindId).update({
      data: {
        status: STATUS_APPROVED,
        amount,
        pointsGranted: calc.points,
        ruleSnapshot: calc.ruleSnapshot,
        approvedBy: operatorOpenid,
        approvedByName: guard.actor.name || '',
        approveTime: db.serverDate()
      }
    })
  } catch (e) {
    console.error('approveBind status update failed after credit:', e)
  }

  const balance = await loadBalance(db, memberOpenid)
  if (config.notifyUser && !alreadyCredited) {
    try {
      await dispatchInAppMessage(db, {
        eventType: 'platform_order_approved',
        openid: memberOpenid,
        relatedId: bindId,
        vars: {
          platformName: row.platformName || '外部平台',
          orderNo: row.orderNo || '',
          amount: String(amount),
          points: String(calc.points),
          balance: String(balance.displayAvailable)
        }
      })
    } catch (e) {
      console.warn('platform bind message skipped:', e.message)
    }
  }

  await markApprovalDecided(db, {
    relatedId: bindId,
    actionType: ACTION.POINTS_PLATFORM_BIND,
    status: 'approved',
    decidedBy: operatorOpenid,
    decidedByName: guard.actor.name || '',
    source: 'bindPlatformOrder.approve'
  })

  return {
    success: true,
    bindId,
    pointsGranted: calc.points,
    balanceAfter: balance.displayAvailable,
    duplicated: alreadyCredited || undefined,
    msg: alreadyCredited
      ? `该笔已入账，已同步审核状态`
      : `已通过并赠送 ${calc.points} 积分`
  }
}

async function rejectBind(event, openid) {
  const bindId = String((event && event.bindId) || '').trim()
  if (!bindId) return fail('缺少申请 id')
  const reason = String((event && event.rejectReason) || '').trim().slice(0, 200) || '店长驳回'

  let row = null
  try {
    const res = await db.collection(BINDS).doc(bindId).get()
    row = res.data
  } catch (e) {
    return fail('申请不存在')
  }
  if (!row) return fail('申请不存在')
  if (row.status !== STATUS_PENDING) return fail('该申请不是待审状态')

  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    storeId: row.storeId,
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const operatorOpenid = (guard.actor && guard.actor.openid) || openid || 'admin_web'

  try {
    await db.collection(BINDS).doc(bindId).update({
      data: {
        status: STATUS_REJECTED,
        rejectReason: reason,
        rejectedBy: operatorOpenid,
        rejectTime: db.serverDate()
      }
    })
  } catch (e) {
    return fail('驳回失败')
  }

  const memberOpenid = row.memberOpenid || row._openid
  if (memberOpenid) {
    try {
      await dispatchInAppMessage(db, {
        eventType: 'platform_order_rejected',
        openid: memberOpenid,
        relatedId: bindId,
        vars: {
          platformName: row.platformName || '外部平台',
          orderNo: row.orderNo || '',
          reason
        }
      })
    } catch (e) {
      console.warn('platform reject message skipped:', e.message)
    }
  }

  await markApprovalDecided(db, {
    relatedId: bindId,
    actionType: ACTION.POINTS_PLATFORM_BIND,
    status: 'rejected',
    rejectReason: reason,
    decidedBy: operatorOpenid,
    decidedByName: guard.actor.name || '',
    source: 'bindPlatformOrder.reject'
  })

  return { success: true, bindId, msg: '已驳回该绑定申请' }
}

exports.main = async (event) => {
  let openid = cloud.getWXContext().OPENID || ''
  if (!openid && isNonClientSource() && event && event._fromApproval && event._callerOpenid) {
    openid = String(event._callerOpenid).trim()
  }
  const action = (event && event.action) || 'getOptions'
  const adminOpsKey = event && event.adminOpsKey
  const staffActions = ['listPending', 'approve', 'reject']
  if (!openid && action !== 'getOptions' && !(adminOpsKey && staffActions.indexOf(action) !== -1)) {
    return fail('请先登录')
  }

  try {
    switch (action) {
      case 'getOptions':
        return await getOptions(event)
      case 'submit':
        return await submitBind(event, openid)
      case 'listMine':
        return await listMine(event, openid)
      case 'listPending':
        return await listPending(event, openid)
      case 'approve':
        return await approveBind(event, openid)
      case 'reject':
        return await rejectBind(event, openid)
      default:
        return fail(`未知 action: ${action}`)
    }
  } catch (e) {
    console.error('bindPlatformOrder', action, e)
    return fail(e.message || '操作失败')
  }
}
