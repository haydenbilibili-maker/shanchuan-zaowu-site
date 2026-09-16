/**
 * 门店小票自助兑积分
 *
 * 顾客上传消费小票图片 → 店长核对金额后按门店赠分规则入账。
 * 入账与 grantStorePoints / bindPlatformOrder 同源：bonusPoints + storeGrowthValue + storeSpendTotal
 * 集合 store_receipt_claims：仅云函数可读写（read/write: false）
 *
 * action: getOptions | submit | listMine | listPending | approve | reject | ignore
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

const CLAIMS = 'store_receipt_claims'
const RULES = 'store_point_rules'
const POINT_RECORDS = 'point_records'
const STATUS_PENDING = 'pending'
const STATUS_APPROVED = 'approved'
const STATUS_REJECTED = 'rejected'
const STATUS_IGNORED = 'ignored'
const SLA_WORK_DAYS = 3
const MAX_IMAGES = 3
const SOFT_DEDUPE_HOURS = 2

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

function isCloudFileId(value) {
  const s = String(value || '').trim()
  return /^cloud:\/\//.test(s)
}

function normalizeImages(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => String(item || '').trim())
    .filter(isCloudFileId)
    .slice(0, MAX_IMAGES)
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
  const enabled = isModuleEnabled(config, 'receiptClaim')
  return {
    success: true,
    enabled,
    maxImages: MAX_IMAGES,
    slaWorkDays: SLA_WORK_DAYS,
    requireAmount: true,
    ruleText: describeRule(config),
    notice: enabled
      ? `上传清晰小票照片（1–${MAX_IMAGES} 张）并填写实付金额。店长通常在 ${SLA_WORK_DAYS} 个工作日内核对，通过后按门店消费规则入账。请勿重复提交同一笔消费。`
      : '门店小票兑积分暂未开放'
  }
}

async function findSoftDuplicate(openid, amount, images) {
  const since = new Date(Date.now() - SOFT_DEDUPE_HOURS * 60 * 60 * 1000)
  try {
    const recent = await db.collection(CLAIMS)
      .where({
        memberOpenid: openid,
        amount,
        status: _.in([STATUS_PENDING, STATUS_APPROVED]),
        createTime: _.gte(since)
      })
      .limit(5)
      .get()
    if (recent.data && recent.data.length) {
      const row = recent.data[0]
      return {
        hit: true,
        msg: row.status === STATUS_APPROVED
          ? '相近金额的小票近期已入账，如需补交请联系店员'
          : '你已有相近金额的小票在审核中，请勿重复提交'
      }
    }
  } catch (e) {
    // 索引缺失时跳过软查重，不阻断提交
  }

  if (images && images.length) {
    try {
      const byImage = await db.collection(CLAIMS)
        .where({
          imageFileIds: _.in(images),
          status: _.in([STATUS_PENDING, STATUS_APPROVED])
        })
        .limit(3)
        .get()
      const hit = (byImage.data || []).find((row) => row.memberOpenid === openid)
      if (hit) {
        return {
          hit: true,
          msg: hit.status === STATUS_APPROVED
            ? '该小票图片已兑换过积分'
            : '该小票图片已在审核中'
        }
      }
    } catch (e) {
      // ignore
    }
  }
  return { hit: false }
}

async function submitClaim(event, openid) {
  const storeId = String((event && event.storeId) || '').trim()
  const config = await loadRuleConfig(storeId)
  if (!isModuleEnabled(config, 'receiptClaim')) {
    return fail('门店小票兑积分暂未开放')
  }

  const images = normalizeImages(event && event.images)
  if (!images.length) return fail('请上传小票照片')
  if (images.length > MAX_IMAGES) return fail(`最多上传 ${MAX_IMAGES} 张照片`)

  const amount = parseAmount(event && event.amount)
  if (amount === null) return fail('请填写正确的消费金额')
  if (amount > config.maxAmountPerRecord) {
    return fail(`单笔金额不得超过 ¥${config.maxAmountPerRecord}`)
  }

  const remark = String((event && event.remark) || '').trim().slice(0, 200)
  const storeName = String((event && event.storeName) || '').trim().slice(0, 40)
  const preview = calcPoints(config, amount)

  const soft = await findSoftDuplicate(openid, amount, images)
  if (soft.hit) return fail(soft.msg)

  try {
    const added = await db.collection(CLAIMS).add({
      data: {
        _openid: openid,
        memberOpenid: openid,
        storeId,
        storeName,
        amount,
        previewPoints: preview.points || 0,
        ruleSnapshot: preview.ruleSnapshot || null,
        images,
        imageFileIds: images,
        remark,
        status: STATUS_PENDING,
        pointsGranted: 0,
        createTime: db.serverDate()
      }
    })
    try {
      await dispatchInAppMessage(db, {
        eventType: 'store_receipt_submitted',
        openid,
        relatedId: added._id,
        vars: {
          amount: String(amount),
          slaWorkDays: String(SLA_WORK_DAYS)
        }
      })
    } catch (e) {
      console.warn('receipt submit message skipped:', e.message)
    }
    try {
      await enqueueApproval(db, {
        actionType: ACTION.POINTS_RECEIPT_CLAIM,
        applicantOpenid: openid,
        applicantName: '',
        applicantRole: 'customer',
        applicantWorkspaceRole: 'customer',
        relatedId: added._id,
        storeId,
        title: `小票认领 ¥${amount}`,
        summary: `预计 +${preview.points || 0} 分 · ${storeName || storeId || ''}`,
        payload: {
          claimId: added._id,
          amount,
          points: preview.points || 0,
          imageFileIds: images
        },
        source: 'claimStoreReceipt'
      })
    } catch (e) {
      console.warn('enqueueApproval receipt skipped', e && e.message)
    }
    return {
      success: true,
      claimId: added._id,
      previewPoints: preview.points || 0,
      slaWorkDays: SLA_WORK_DAYS,
      msg: `已提交，通常 ${SLA_WORK_DAYS} 个工作日内完成审核`
    }
  } catch (e) {
    if (/collection|集合/.test(e.message || '')) {
      return fail(`请先在云开发控制台创建集合 ${CLAIMS}`)
    }
    console.error('claimStoreReceipt submit', e)
    return fail(e.message || '提交失败')
  }
}

async function listMine(event, openid) {
  const page = Math.max(1, parseInt((event && event.page) || 1, 10) || 1)
  const pageSize = Math.min(30, Math.max(5, parseInt((event && event.pageSize) || 20, 10) || 20))
  try {
    const where = { memberOpenid: openid }
    const totalRes = await db.collection(CLAIMS).where(where).count()
    const res = await db.collection(CLAIMS)
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
    let countQuery = db.collection(CLAIMS)
    let listQuery = db.collection(CLAIMS)
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
      ruleText: describeRule(await loadRuleConfig(storeId)),
      slaWorkDays: SLA_WORK_DAYS
    }
  } catch (e) {
    if (/collection|集合/.test(e.message || '')) {
      return fail(`请先在云开发控制台创建集合 ${CLAIMS}`)
    }
    return fail('加载失败')
  }
}

async function approveClaim(event, openid) {
  const claimId = String((event && event.claimId) || '').trim()
  if (!claimId) return fail('缺少申请 id')

  let row = null
  try {
    const res = await db.collection(CLAIMS).doc(claimId).get()
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
  if (!isModuleEnabled(config, 'receiptClaim')) return fail('门店小票兑积分模块已关闭')

  let amount = parseAmount(event && event.amount)
  if (amount === null) amount = parseAmount(row.amount)
  if (amount === null) return fail('请确认消费实付金额')
  if (amount > config.maxAmountPerRecord) return fail(`金额不得超过 ¥${config.maxAmountPerRecord}`)

  const reviewRemark = String((event && event.reviewRemark) || '').trim().slice(0, 200)
  const calc = calcPoints(config, amount)
  const memberOpenid = row.memberOpenid
  const operatorOpenid = (guard.actor && guard.actor.openid) || openid || 'admin_web'

  // 门店消费累计与积分解耦：先按小票记一次累计（未达赠分门槛的小票同样计入）
  let spendCounted = false
  if (amount > 0 && !Number(row.spendCountedAt)) {
    try {
      const spendUser = await loadUserDoc(db, memberOpenid)
      const spendDocId = spendUser ? spendUser._id : await ensureUserDoc(db, memberOpenid)
      await db.collection('users').doc(spendDocId).update({
        data: { storeSpendTotal: _.inc(amount) }
      })
      await db.collection(CLAIMS).doc(claimId).update({
        data: { spendCountedAt: Date.now() }
      })
      spendCounted = true
    } catch (e) {
      console.warn('claimStoreReceipt storeSpendTotal failed:', e && e.message)
    }
  }

  if (calc.points <= 0) {
    try {
      await db.collection(CLAIMS).doc(claimId).update({
        data: {
          status: STATUS_APPROVED,
          amount,
          pointsGranted: 0,
          ruleSnapshot: calc.ruleSnapshot,
          reviewRemark,
          reviewBy: operatorOpenid,
          reviewByName: guard.actor.name || '',
          reviewTime: db.serverDate(),
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
      claimId,
      pointsGranted: 0,
      spendCounted,
      msg: `已通过，但按规则未达赠分门槛（${describeRule(config)}）`
    }
  }

  let alreadyCredited = false
  try {
    await db.collection(POINT_RECORDS).add({
      data: {
        _openid: operatorOpenid,
        userOpenid: memberOpenid,
        type: 'earn',
        source: 'store_receipt',
        action: 'store_receipt',
        points: calc.points,
        title: `门店小票 ¥${amount}`,
        refCollection: CLAIMS,
        refId: claimId,
        dedupeKey: `store_receipt:${claimId}`,
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
      console.error('claimStoreReceipt point_record', e)
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
          storeGrowthValue: _.inc(calc.points)
          // 门店消费累计已在上方按小票记一次，此处不再重复累加
        }
      })
    } catch (e) {
      console.error('claimStoreReceipt inc points', e)
      return fail('积分入账失败')
    }
  }

  try {
    await db.collection(CLAIMS).doc(claimId).update({
      data: {
        status: STATUS_APPROVED,
        amount,
        pointsGranted: calc.points,
        ruleSnapshot: calc.ruleSnapshot,
        reviewRemark,
        reviewBy: operatorOpenid,
        reviewByName: guard.actor.name || '',
        reviewTime: db.serverDate(),
        approvedBy: operatorOpenid,
        approvedByName: guard.actor.name || '',
        approveTime: db.serverDate()
      }
    })
  } catch (e) {
    console.error('approveClaim status update failed after credit:', e)
  }

  const balance = await loadBalance(db, memberOpenid)
  if (config.notifyUser && !alreadyCredited) {
    try {
      await dispatchInAppMessage(db, {
        eventType: 'store_receipt_approved',
        openid: memberOpenid,
        relatedId: claimId,
        vars: {
          storeName: row.storeName || '门店',
          amount: String(amount),
          points: String(calc.points),
          balance: String(balance.displayAvailable)
        }
      })
    } catch (e) {
      console.warn('receipt claim message skipped:', e.message)
    }
  }

  await markApprovalDecided(db, {
    relatedId: claimId,
    actionType: ACTION.POINTS_RECEIPT_CLAIM,
    status: 'approved',
    decidedBy: operatorOpenid,
    decidedByName: guard.actor.name || '',
    source: 'claimStoreReceipt.approve'
  })

  return {
    success: true,
    claimId,
    pointsGranted: calc.points,
    balanceAfter: balance.displayAvailable,
    duplicated: alreadyCredited || undefined,
    msg: alreadyCredited
      ? '该笔已入账，已同步审核状态'
      : `已通过并赠送 ${calc.points} 积分与成长值`
  }
}

async function rejectClaim(event, openid) {
  const claimId = String((event && event.claimId) || '').trim()
  if (!claimId) return fail('缺少申请 id')
  const reason = String((event && event.rejectReason) || '').trim().slice(0, 200) || '店长驳回'

  let row = null
  try {
    const res = await db.collection(CLAIMS).doc(claimId).get()
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
    await db.collection(CLAIMS).doc(claimId).update({
      data: {
        status: STATUS_REJECTED,
        rejectReason: reason,
        reviewBy: operatorOpenid,
        reviewByName: guard.actor.name || '',
        reviewTime: db.serverDate(),
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
        eventType: 'store_receipt_rejected',
        openid: memberOpenid,
        relatedId: claimId,
        vars: {
          amount: String(row.amount || 0),
          reason
        }
      })
    } catch (e) {
      console.warn('receipt reject message skipped:', e.message)
    }
  }

  await markApprovalDecided(db, {
    relatedId: claimId,
    actionType: ACTION.POINTS_RECEIPT_CLAIM,
    status: 'rejected',
    rejectReason: reason,
    decidedBy: operatorOpenid,
    decidedByName: guard.actor.name || '',
    source: 'claimStoreReceipt.reject'
  })

  return { success: true, claimId, msg: '已驳回该小票申请' }
}

/**
 * 忽略：不入账、不通知顾客（区别于驳回的强否定反馈），仅移出待审队列。
 * 统一审批收件箱侧以 rejected + 说明清掉待办（approvalBridge 仅识别 approved/rejected）。
 */
async function ignoreClaim(event, openid) {
  const claimId = String((event && event.claimId) || '').trim()
  if (!claimId) return fail('缺少申请 id')

  let row = null
  try {
    const res = await db.collection(CLAIMS).doc(claimId).get()
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
  const note = '店长忽略（不入账）'

  try {
    await db.collection(CLAIMS).doc(claimId).update({
      data: {
        status: STATUS_IGNORED,
        ignoreReason: note,
        reviewBy: operatorOpenid,
        reviewByName: guard.actor.name || '',
        reviewTime: db.serverDate(),
        ignoredBy: operatorOpenid,
        ignoreTime: db.serverDate()
      }
    })
  } catch (e) {
    return fail('忽略失败')
  }

  await markApprovalDecided(db, {
    relatedId: claimId,
    actionType: ACTION.POINTS_RECEIPT_CLAIM,
    status: 'rejected',
    rejectReason: note,
    decidedBy: operatorOpenid,
    decidedByName: guard.actor.name || '',
    source: 'claimStoreReceipt.ignore'
  })

  return { success: true, claimId, msg: '已忽略该小票申请' }
}

exports.main = async (event) => {
  let openid = cloud.getWXContext().OPENID || ''
  if (!openid && isNonClientSource() && event && event._fromApproval && event._callerOpenid) {
    openid = String(event._callerOpenid).trim()
  }
  const action = (event && event.action) || 'getOptions'
  const adminOpsKey = event && event.adminOpsKey
  const staffActions = ['listPending', 'approve', 'reject', 'ignore']
  if (!openid && action !== 'getOptions' && !(adminOpsKey && staffActions.indexOf(action) !== -1)) {
    return fail('请先登录')
  }

  try {
    switch (action) {
      case 'getOptions':
        return await getOptions(event)
      case 'submit':
        return await submitClaim(event, openid)
      case 'listMine':
        return await listMine(event, openid)
      case 'listPending':
        return await listPending(event, openid)
      case 'approve':
        return await approveClaim(event, openid)
      case 'reject':
        return await rejectClaim(event, openid)
      case 'ignore':
        return await ignoreClaim(event, openid)
      default:
        return fail(`未知 action: ${action}`)
    }
  } catch (e) {
    console.error('claimStoreReceipt', action, e)
    return fail(e.message || '操作失败')
  }
}
