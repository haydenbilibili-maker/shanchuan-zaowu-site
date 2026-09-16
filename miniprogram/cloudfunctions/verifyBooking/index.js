/**
 * 预约核销 / 冲正（店员 / 店长）
 *
 * action 缺省或 verify：核销 confirmed|pending → used
 * action=reverse：冲正 used → confirmed（需审批，店员→店长，店长→超管）
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_MANAGER, ROLE_STAFF } = require('./staffGuard')
const { writeAuditLog, auditFromActor } = require('./auditLog')
const { ACTION, resolveApproverRole, actorWorkspaceRole } = require('./approvalRules')
const { enqueueApproval, markApprovalDecided } = require('./approvalBridge')
// 来源判定统一真源（负向子串判定对互调合并串会判反，详见 sourceOrigin.js 顶部说明）
const { isNonClientSource } = require('./sourceOrigin')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const ALLOWED_FROM = ['confirmed', 'pending']

function fail(msg, extra) {
  return { success: false, msg, ...(extra || {}) }
}

function parseScanPayload(event) {
  const directId = String((event && event.bookingId) || '').trim()
  if (directId) return { bookingId: directId }

  const ticket = String((event && event.ticketCode) || '').trim()
  if (ticket) return { ticketCode: ticket }

  const raw = String((event && (event.qrPayload || event.scanResult || event.code)) || '').trim()
  if (!raw) return {}

  const bookingUri = raw.match(/^BOOKING:([^:]+)(?::|$)/i)
  if (bookingUri) return { ticketCode: bookingUri[1].trim() }

  if (/^[a-zA-Z0-9_-]{8,64}$/.test(raw)) {
    return { bookingId: raw, ticketCode: raw }
  }
  return { raw }
}

async function findBooking(ref) {
  if (ref.bookingId) {
    try {
      const doc = await db.collection('bookings').doc(ref.bookingId).get()
      if (doc.data) return { row: doc.data, id: ref.bookingId }
    } catch (e) {
      // continue
    }
  }
  const code = String(ref.ticketCode || ref.bookingId || '').trim()
  if (code) {
    const res = await db.collection('bookings').where({ ticketCode: code }).limit(1).get()
    const row = res.data && res.data[0]
    if (row) return { row, id: row._id }
  }
  return null
}

async function doVerify(event, openid, guard) {
  const storeId = String((event && event.storeId) || '').trim()
  const ref = parseScanPayload(event)
  if (!ref.bookingId && !ref.ticketCode) {
    return fail('未识别到预约票，请重新扫码或从列表核销')
  }

  let found
  try {
    found = await findBooking(ref)
  } catch (e) {
    console.error('verifyBooking find', e)
    if (/collection|集合/.test(e.message || '')) {
      return fail('预约服务未就绪，请稍后重试')
    }
    return fail(e.message || '查询预约失败')
  }

  if (!found || !found.row) {
    return fail('预约不存在或票号无效')
  }

  const booking = found.row
  const bookingId = found.id

  if (storeId && booking.storeId && booking.storeId !== storeId) {
    return fail('该预约不属于当前门店', { code: 'FORBIDDEN' })
  }

  if (booking.status === 'used') {
    return {
      success: true,
      already: true,
      bookingId,
      msg: '该预约已核销过',
      title: booking.title || '',
      ticketCode: booking.ticketCode || '',
      name: booking.name || ''
    }
  }

  if (booking.status === 'cancelled' || booking.status === 'canceled') {
    return fail('该预约已取消，无法核销')
  }

  if (ALLOWED_FROM.indexOf(booking.status) === -1) {
    return fail(`当前状态不可核销（${booking.status || '未知'}）`)
  }

  try {
    await db.collection('bookings').doc(bookingId).update({
      data: {
        status: 'used',
        verifiedAt: db.serverDate(),
        verifiedBy: openid,
        verifiedByName: (guard.actor && guard.actor.name) || '',
        verifiedStoreId: storeId || booking.storeId || ''
      }
    })
  } catch (e) {
    console.error('verifyBooking update', e)
    return fail(e.message || '核销失败')
  }

  return {
    success: true,
    already: false,
    bookingId,
    msg: '已核销',
    title: booking.title || '',
    ticketCode: booking.ticketCode || '',
    name: booking.name || '',
    people: booking.people || 0,
    storeName: booking.storeName || ''
  }
}

async function doReverse(event, openid, guard) {
  const storeId = String((event && event.storeId) || '').trim()
  const fromApproval = !!(event && event._fromApproval)
  const ref = parseScanPayload(event)
  if (!ref.bookingId && !ref.ticketCode) {
    return fail('缺少预约 id')
  }

  let found
  try {
    found = await findBooking(ref)
  } catch (e) {
    return fail(e.message || '查询预约失败')
  }
  if (!found || !found.row) return fail('预约不存在')

  const booking = found.row
  const bookingId = found.id

  if (booking.status !== 'used') {
    return fail('仅已核销预约可冲正')
  }

  const ws = actorWorkspaceRole(guard.actor)
  const approverRole = fromApproval ? null : resolveApproverRole(ACTION.BOOKING_VERIFY_REVERSE, ws)

  if (approverRole) {
    const enqueued = await enqueueApproval(db, {
      actionType: ACTION.BOOKING_VERIFY_REVERSE,
      applicantOpenid: openid,
      applicantName: (guard.actor && guard.actor.name) || '',
      applicantRole: (guard.actor && guard.actor.role) || '',
      applicantWorkspaceRole: ws,
      relatedId: bookingId,
      storeId: storeId || booking.storeId || '',
      title: `核销冲正 ${booking.ticketCode || bookingId}`,
      summary: `${booking.title || ''} · ${booking.name || ''}`,
      payload: {
        bookingId,
        storeId: storeId || booking.storeId || '',
        ticketCode: booking.ticketCode || ''
      },
      source: 'verifyBooking.reverse',
      approverRole
    })
    if (!enqueued.ok) return fail(enqueued.msg || '提交冲正审批失败')
    return {
      success: true,
      pendingApproval: true,
      approvalId: enqueued.approvalId,
      msg: approverRole === 'super_admin'
        ? '已提交超管审核冲正'
        : '已提交店长审核冲正'
    }
  }

  try {
    await db.collection('bookings').doc(bookingId).update({
      data: {
        status: 'confirmed',
        verifiedAt: _.remove(),
        verifiedBy: '',
        verifiedByName: '',
        reverseAt: db.serverDate(),
        reverseBy: openid,
        reverseByName: (guard.actor && guard.actor.name) || '',
        previousVerifiedBy: booking.verifiedBy || '',
        previousVerifiedAt: booking.verifiedAt || null
      }
    })
  } catch (e) {
    return fail(e.message || '冲正失败')
  }

  await writeAuditLog(db, auditFromActor(guard.actor, {
    action: 'booking_verify_reverse',
    relatedId: bookingId,
    relatedType: 'bookings',
    detail: { ticketCode: booking.ticketCode || '' },
    source: 'verifyBooking'
  }))

  await markApprovalDecided(db, {
    relatedId: bookingId,
    actionType: ACTION.BOOKING_VERIFY_REVERSE,
    status: 'approved',
    decidedBy: openid,
    decidedByName: (guard.actor && guard.actor.name) || '',
    source: 'verifyBooking.reverse'
  })

  return {
    success: true,
    bookingId,
    msg: '已冲正为未核销',
    title: booking.title || '',
    ticketCode: booking.ticketCode || ''
  }
}

exports.main = async (event) => {
  let openid = cloud.getWXContext().OPENID || ''
  if (!openid && isNonClientSource() && event && event._fromApproval && event._callerOpenid) {
    openid = String(event._callerOpenid).trim()
  }
  if (!openid && !(event && event.adminOpsKey)) return fail('请先登录')

  const action = String((event && event.action) || 'verify').trim()
  const storeId = String((event && event.storeId) || '').trim()

  const minRole = action === 'reverse' ? ROLE_STAFF : ROLE_STAFF
  const guard = await assertStaff(db, openid || 'admin_ops', {
    role: minRole,
    permission: 'verifyBooking',
    storeId: storeId || undefined,
    adminOpsKey: event && event.adminOpsKey,
    requireSuperAdmin: false
  })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  if (action === 'reverse') {
    return doReverse(event, openid || guard.actor.openid, guard)
  }
  return doVerify(event, openid || guard.actor.openid, guard)
}
