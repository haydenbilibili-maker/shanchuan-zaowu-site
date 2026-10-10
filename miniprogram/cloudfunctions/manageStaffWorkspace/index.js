/**
 * 店员工作台：考勤、请假、门店清单、工资条、报销
 * 集合 staff_attendance | staff_leave_requests | staff_store_todos | staff_payslips | staff_reimbursements
 *
 * 请假状态：pending → approved | rejected | cancelled
 * 审批：店员/标本师/主播 → 店长(leaveReview)；店长本人 → 超管；超管提交 → 直通通过
 */
const cloud = require('wx-server-sdk')
const {
  assertStaff: _assertStaff,
  ROLE_MANAGER,
  hasRole,
  STORED_ROLE_SUPER,
  WORKSPACE_SUPER_ADMIN,
  WORKSPACE_STORE_MANAGER
} = require('./staffGuard')

/**
 * 鉴权包装（2026-09-15 修复）：Admin Web 经 /api/cloud-fn 调用时，代理会把密钥注入
 * event.adminOpsKey，而 staffGuard 只比较 options.adminOpsKey —— 原实现从不透传，
 * 导致 ERP 调用本函数一律 NOT_LOGGED_IN。此处统一从 globalThis 取用。
 *
 * 注意：入口对 globalThis.__adminOpsKey 必须**无条件赋值**（无密钥时置空）。
 * 预热容器会跨请求复用 globalThis，若只在有密钥时赋值，上一个请求的超管身份
 * 会泄漏给下一个无密钥请求。
 */
function assertStaff(db, openid, options = {}) {
  const opts = { ...(options || {}) }
  if (opts.adminOpsKey == null) opts.adminOpsKey = globalThis.__adminOpsKey || ''
  return _assertStaff(db, openid, opts)
}

const {
  MORNING_ITEMS,
  EVENING_ITEMS,
  CLOCK_IN_DEADLINE,
  CLOCK_OUT_EARLIEST,
  REIMBURSE_CATEGORIES,
  LEAVE_TYPES
} = require('./defaults')
const { computeMonthlySalesShare } = require('./salesShareRevenue')
const SI = require('./socialInsurance')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const COL_ATT = 'staff_attendance'
const COL_LEAVE = 'staff_leave_requests'
const COL_TODO = 'staff_store_todos'
const COL_PAY = 'staff_payslips'
const COL_REIM = 'staff_reimbursements'

const LEAVE_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled'
}

const APPROVER_MANAGER = 'store_manager'
const APPROVER_SUPER = 'super_admin'

function fail(msg, extra) {
  return { success: false, msg, ...(extra || {}) }
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function localDateKey(d = new Date()) {
  return chinaDateKey(d)
}

function isCloudFileId(value) {
  return /^cloud:\/\//.test(String(value || '').trim())
}

function normalizeImages(raw) {
  if (!Array.isArray(raw)) return []
  return raw.map((x) => String(x || '').trim()).filter(isCloudFileId).slice(0, 5)
}

function evaluateClockStatus(type, at = new Date()) {
  const h = at.getHours()
  const m = at.getMinutes()
  const mins = h * 60 + m
  if (type === 'in') {
    const deadline = CLOCK_IN_DEADLINE.hour * 60 + CLOCK_IN_DEADLINE.minute
    return mins <= deadline ? 'on_time' : 'late'
  }
  const earliest = CLOCK_OUT_EARLIEST.hour * 60 + CLOCK_OUT_EARLIEST.minute
  return mins >= earliest ? 'on_time' : 'early'
}

function defaultTodoItems(shift) {
  const src = shift === 'evening' ? EVENING_ITEMS : MORNING_ITEMS
  return src.map((item) => ({
    id: item.id,
    label: item.label,
    checked: false,
    checkedAt: null
  }))
}

function mergeTodoItems(stored, shift) {
  const defaults = defaultTodoItems(shift)
  if (!stored || !Array.isArray(stored.items)) return defaults
  const map = {}
  stored.items.forEach((row) => {
    if (row && row.id) map[row.id] = row
  })
  return defaults.map((d) => {
    const hit = map[d.id]
    if (!hit) return d
    return {
      id: d.id,
      label: d.label,
      checked: !!hit.checked,
      checkedAt: hit.checkedAt || null
    }
  })
}

function leaveTypeMeta(key) {
  const hit = (LEAVE_TYPES || []).find((t) => t.key === key)
  return hit || LEAVE_TYPES[LEAVE_TYPES.length - 1] || { key: 'other', label: '其他' }
}

function parseDateTimeInput(dateStr, timeStr, endOfDay) {
  const d = String(dateStr || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  let t = String(timeStr || '').trim()
  if (!/^\d{2}:\d{2}$/.test(t)) {
    t = endOfDay ? '23:59' : '00:00'
  }
  const at = new Date(`${d}T${t}:00+08:00`)
  if (Number.isNaN(at.getTime())) return null
  return at
}

/** 按东八区日历日生成 YYYY-MM-DD（与小程序端一致） */
function chinaDateKey(d = new Date()) {
  const shifted = new Date(d.getTime() + 8 * 3600000)
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
}

function hoursBetween(startAt, endAt) {
  const ms = endAt.getTime() - startAt.getTime()
  if (ms <= 0) return 0
  return Math.round((ms / 3600000) * 10) / 10
}

function durationLabel(hours) {
  const h = Number(hours) || 0
  if (h <= 0) return '0 小时'
  const days = Math.floor(h / 24)
  const rem = Math.round((h - days * 24) * 10) / 10
  if (days > 0 && rem > 0) return `${days} 天 ${rem} 小时`
  if (days > 0) return `${days} 天`
  return `${h} 小时`
}

function isManagerApplicant(actor) {
  if (!actor) return false
  if (actor.superAdmin || hasRole(actor, STORED_ROLE_SUPER)) return false
  return (
    actor.workspaceRole === WORKSPACE_STORE_MANAGER ||
    actor.role === ROLE_MANAGER ||
    hasRole(actor, ROLE_MANAGER)
  )
}

function resolveLeaveApproverRole(actor) {
  if (!actor) return APPROVER_MANAGER
  if (actor.superAdmin || hasRole(actor, STORED_ROLE_SUPER) || actor.workspaceRole === WORKSPACE_SUPER_ADMIN) {
    return null
  }
  if (isManagerApplicant(actor)) return APPROVER_SUPER
  return APPROVER_MANAGER
}

async function findApprovedLeaveCovering(openid, dateKey) {
  try {
    const res = await db.collection(COL_LEAVE)
      .where({
        staffOpenid: openid,
        status: LEAVE_STATUS.APPROVED,
        startKey: _.lte(dateKey),
        endKey: _.gte(dateKey)
      })
      .limit(5)
      .get()
    const rows = res.data || []
    return rows[0] || null
  } catch (e) {
    try {
      const res = await db.collection(COL_LEAVE)
        .where({ staffOpenid: openid, status: LEAVE_STATUS.APPROVED })
        .orderBy('startKey', 'desc')
        .limit(30)
        .get()
      const rows = (res.data || []).filter((row) => row.startKey <= dateKey && row.endKey >= dateKey)
      return rows[0] || null
    } catch (e2) {
      return null
    }
  }
}

function serializeLeave(row) {
  if (!row) return null
  return {
    ...row,
    durationLabel: durationLabel(row.durationHours),
    statusLabel:
      row.status === LEAVE_STATUS.APPROVED
        ? '已通过'
        : row.status === LEAVE_STATUS.REJECTED
          ? '已驳回'
          : row.status === LEAVE_STATUS.CANCELLED
            ? '已撤销'
            : '待审批'
  }
}

async function attendanceToday(event, openid) {
  const guard = await assertStaff(db, openid, { permission: 'staffAttendance', storeId: event.storeId })
  if (!guard.ok) return fail(guard.msg, { code: guard.code })
  const storeId = String(event.storeId || '').trim()
  if (!storeId) return fail('缺少 storeId')
  const dateKey = localDateKey()
  let leave = null
  try {
    leave = await findApprovedLeaveCovering(openid, dateKey)
  } catch (e) {
    leave = null
  }
  try {
    const res = await db.collection(COL_ATT)
      .where({ staffOpenid: openid, storeId, dateKey })
      .orderBy('clockAt', 'asc')
      .get()
    const rows = res.data || []
    const last = rows.length ? rows[rows.length - 1] : null
    const canClockIn = !last || last.type === 'out'
    const canClockOut = last && last.type === 'in'
    return {
      success: true,
      dateKey,
      storeId,
      today: rows,
      canClockIn,
      canClockOut,
      lastType: last ? last.type : '',
      onLeave: !!leave,
      leave: leave ? serializeLeave(leave) : null,
      /** 已通过请假覆盖今日：不计异常缺勤 */
      absenceExempt: !!leave
    }
  } catch (e) {
    return {
      success: true,
      dateKey,
      storeId,
      today: [],
      canClockIn: true,
      canClockOut: false,
      onLeave: !!leave,
      leave: leave ? serializeLeave(leave) : null,
      absenceExempt: !!leave,
      fallback: true
    }
  }
}

async function attendanceClock(event, openid) {
  const storeId = String(event.storeId || '').trim()
  const storeName = String(event.storeName || '').trim()
  const type = event.type === 'out' ? 'out' : 'in'
  const guard = await assertStaff(db, openid, { permission: 'staffAttendance', storeId })
  if (!guard.ok) return fail(guard.msg, { code: guard.code })
  if (!storeId) return fail('缺少 storeId')

  const dateKey = localDateKey()
  const now = new Date()
  const status = evaluateClockStatus(type, now)

  try {
    const prev = await db.collection(COL_ATT)
      .where({ staffOpenid: openid, storeId, dateKey })
      .orderBy('clockAt', 'desc')
      .limit(1)
      .get()
    const last = prev.data && prev.data[0]
    if (type === 'in' && last && last.type === 'in') return fail('请先打下班卡')
    if (type === 'out' && (!last || last.type === 'out')) return fail('请先打上班卡')

    const doc = {
      staffOpenid: openid,
      staffName: guard.actor.name || '',
      storeId,
      storeName,
      dateKey,
      type,
      status,
      clockAt: now,
      createTime: now
    }
    const add = await db.collection(COL_ATT).add({ data: doc })
    return {
      success: true,
      id: add._id,
      record: { ...doc, _id: add._id },
      statusText: status === 'on_time' ? '准时' : status === 'late' ? '迟到' : '早退'
    }
  } catch (e) {
    return fail(e.message || '打卡失败')
  }
}

async function attendanceList(event, openid) {
  const guard = await assertStaff(db, openid, { permission: 'staffAttendance' })
  if (!guard.ok) return fail(guard.msg, { code: guard.code })
  const limit = Math.min(50, Math.max(5, Number(event.limit) || 20))
  try {
    const res = await db.collection(COL_ATT)
      .where({ staffOpenid: openid })
      .orderBy('clockAt', 'desc')
      .limit(limit)
      .get()
    return { success: true, list: res.data || [] }
  } catch (e) {
    return { success: true, list: [], fallback: true }
  }
}

async function leaveSubmit(event, openid) {
  const storeId = String(event.storeId || '').trim()
  const guard = await assertStaff(db, openid, { permission: 'staffAttendance', storeId })
  if (!guard.ok) return fail(guard.msg, { code: guard.code })

  const typeMeta = leaveTypeMeta(String(event.leaveType || '').trim())
  const startAt = parseDateTimeInput(event.startDate, event.startTime, false)
  const endAt = parseDateTimeInput(event.endDate, event.endTime, true)
  if (!startAt || !endAt) return fail('请选择有效的开始与结束时间')
  if (endAt.getTime() <= startAt.getTime()) return fail('结束时间须晚于开始时间')

  const reason = String(event.reason || '').trim().slice(0, 200)
  if (!reason) return fail('请填写请假事由')

  const durationHours = hoursBetween(startAt, endAt)
  if (durationHours <= 0) return fail('请假时长无效')
  if (durationHours > 24 * 60) return fail('单次请假最长 60 天')

  const approverRole = resolveLeaveApproverRole(guard.actor)
  const now = new Date()
  const autoApproved = approverRole == null
  const doc = {
    staffOpenid: openid,
    staffName: guard.actor.name || '',
    storeId,
    storeName: String(event.storeName || '').trim(),
    leaveType: typeMeta.key,
    leaveTypeLabel: typeMeta.label,
    startAt,
    endAt,
    startKey: localDateKey(startAt),
    endKey: localDateKey(endAt),
    durationHours,
    reason,
    status: autoApproved ? LEAVE_STATUS.APPROVED : LEAVE_STATUS.PENDING,
    approverRoleRequired: approverRole || APPROVER_SUPER,
    createTime: now,
    updateTime: now
  }
  if (autoApproved) {
    doc.reviewedBy = openid
    doc.reviewedByName = guard.actor.name || '超管'
    doc.reviewedAt = now
    doc.reviewNote = '超管直通'
  }

  try {
    const add = await db.collection(COL_LEAVE).add({ data: doc })
    return {
      success: true,
      id: add._id,
      status: doc.status,
      autoApproved,
      durationLabel: durationLabel(durationHours),
      msg: autoApproved ? '已通过（超管直通）' : '已提交，待审批'
    }
  } catch (e) {
    return fail(e.message || '提交失败')
  }
}

async function leaveList(event, openid) {
  const guard = await assertStaff(db, openid, { permission: 'staffAttendance' })
  if (!guard.ok) return fail(guard.msg, { code: guard.code })
  const limit = Math.min(50, Math.max(5, Number(event.limit) || 30))
  try {
    const res = await db.collection(COL_LEAVE)
      .where({ staffOpenid: openid })
      .orderBy('createTime', 'desc')
      .limit(limit)
      .get()
    return { success: true, list: (res.data || []).map(serializeLeave) }
  } catch (e) {
    return { success: true, list: [], fallback: true }
  }
}

async function leavePendingList(event, openid) {
  const guard = await assertStaff(db, openid, { role: ROLE_MANAGER, permission: 'leaveReview' })
  if (!guard.ok) return fail(guard.msg, { code: guard.code })
  const limit = Math.min(50, Math.max(5, Number(event.limit) || 30))
  const isSuper = !!(guard.actor.superAdmin || hasRole(guard.actor, STORED_ROLE_SUPER))
  try {
    let query = db.collection(COL_LEAVE).where({ status: LEAVE_STATUS.PENDING })
    if (!isSuper) {
      query = db.collection(COL_LEAVE).where({
        status: LEAVE_STATUS.PENDING,
        approverRoleRequired: APPROVER_MANAGER
      })
    }
    const res = await query.orderBy('createTime', 'desc').limit(limit).get()
    let list = (res.data || []).map(serializeLeave)
    if (isSuper) {
      // 超管可见全部待审；店长只看待己审的（已在 where 过滤）
    } else {
      list = list.filter((row) => row.staffOpenid !== openid)
    }
    return { success: true, list }
  } catch (e) {
    return { success: true, list: [], fallback: true }
  }
}

async function leaveReview(event, openid) {
  const guard = await assertStaff(db, openid, { role: ROLE_MANAGER, permission: 'leaveReview' })
  if (!guard.ok) return fail(guard.msg, { code: guard.code })
  const id = String(event.id || '').trim()
  const decision = event.decision === 'approved'
    ? LEAVE_STATUS.APPROVED
    : event.decision === 'rejected'
      ? LEAVE_STATUS.REJECTED
      : ''
  if (!id || !decision) return fail('缺少申请 id 或审批结论')
  const reviewNote = String(event.reviewNote || '').trim().slice(0, 200)
  const isSuper = !!(guard.actor.superAdmin || hasRole(guard.actor, STORED_ROLE_SUPER))

  try {
    const got = await db.collection(COL_LEAVE).doc(id).get()
    const row = got.data
    if (!row) return fail('请假单不存在')
    if (row.status !== LEAVE_STATUS.PENDING) return fail('该申请已处理')
    if (row.staffOpenid === openid) return fail('不能审批本人请假')
    if (row.approverRoleRequired === APPROVER_SUPER && !isSuper) {
      return fail('店长请假须由超管审批')
    }
    if (!isSuper && row.approverRoleRequired !== APPROVER_MANAGER) {
      return fail('无权审批此单')
    }

    await db.collection(COL_LEAVE).doc(id).update({
      data: {
        status: decision,
        reviewNote,
        reviewedBy: openid,
        reviewedByName: guard.actor.name || '',
        reviewedAt: new Date(),
        updateTime: new Date()
      }
    })
    return { success: true, status: decision }
  } catch (e) {
    return fail(e.message || '审批失败')
  }
}

async function leaveCancel(event, openid) {
  const guard = await assertStaff(db, openid, { permission: 'staffAttendance' })
  if (!guard.ok) return fail(guard.msg, { code: guard.code })
  const id = String(event.id || '').trim()
  if (!id) return fail('缺少申请 id')
  try {
    const got = await db.collection(COL_LEAVE).doc(id).get()
    const row = got.data
    if (!row) return fail('请假单不存在')
    if (row.staffOpenid !== openid) return fail('只能撤销本人申请')
    if (row.status !== LEAVE_STATUS.PENDING) return fail('仅待审批可撤销')
    await db.collection(COL_LEAVE).doc(id).update({
      data: {
        status: LEAVE_STATUS.CANCELLED,
        updateTime: new Date(),
        cancelledAt: new Date()
      }
    })
    return { success: true }
  } catch (e) {
    return fail(e.message || '撤销失败')
  }
}

async function todoGet(event, openid) {
  const storeId = String(event.storeId || '').trim()
  const shift = event.shift === 'evening' ? 'evening' : 'morning'
  const guard = await assertStaff(db, openid, { permission: 'storeTodo', storeId })
  if (!guard.ok) return fail(guard.msg, { code: guard.code })
  if (!storeId) return fail('缺少 storeId')
  const dateKey = String(event.dateKey || localDateKey()).trim()
  const docId = `${storeId}_${dateKey}_${shift}`
  try {
    const res = await db.collection(COL_TODO).doc(docId).get()
    const row = res.data
    const items = mergeTodoItems(row, shift)
    const done = items.filter((i) => i.checked).length
    return {
      success: true,
      dateKey,
      shift,
      storeId,
      items,
      progress: { done, total: items.length }
    }
  } catch (e) {
    const items = defaultTodoItems(shift)
    return {
      success: true,
      dateKey,
      shift,
      storeId,
      items,
      progress: { done: 0, total: items.length },
      newDoc: true
    }
  }
}

async function todoSave(event, openid) {
  const storeId = String(event.storeId || '').trim()
  const storeName = String(event.storeName || '').trim()
  const shift = event.shift === 'evening' ? 'evening' : 'morning'
  const guard = await assertStaff(db, openid, { permission: 'storeTodo', storeId })
  if (!guard.ok) return fail(guard.msg, { code: guard.code })
  if (!storeId) return fail('缺少 storeId')
  const dateKey = String(event.dateKey || localDateKey()).trim()
  const rawItems = Array.isArray(event.items) ? event.items : []
  const defaults = defaultTodoItems(shift)
  const allowed = {}
  defaults.forEach((d) => { allowed[d.id] = d.label })
  const now = new Date()
  const items = defaults.map((d) => {
    const hit = rawItems.find((r) => r && r.id === d.id)
    const checked = !!(hit && hit.checked)
    return {
      id: d.id,
      label: d.label,
      checked,
      checkedAt: checked ? (hit.checkedAt || now) : null
    }
  })
  const docId = `${storeId}_${dateKey}_${shift}`
  const payload = {
    storeId,
    storeName,
    dateKey,
    shift,
    items,
    updatedBy: openid,
    updatedAt: now
  }
  try {
    await db.collection(COL_TODO).doc(docId).set({ data: payload })
  } catch (e) {
    try {
      await db.collection(COL_TODO).add({ data: { _id: docId, ...payload, createTime: now } })
    } catch (e2) {
      return fail(e2.message || '保存失败')
    }
  }
  const done = items.filter((i) => i.checked).length
  return { success: true, progress: { done, total: items.length } }
}

async function payslipList(event, openid) {
  const guard = await assertStaff(db, openid, { permission: 'viewPayslip' })
  if (!guard.ok) return fail(guard.msg, { code: guard.code })
  try {
    const res = await db.collection(COL_PAY)
      .where({ staffOpenid: openid })
      .orderBy('month', 'desc')
      .limit(24)
      .get()
    return { success: true, list: res.data || [] }
  } catch (e) {
    return { success: true, list: [], fallback: true }
  }
}

/**
 * 店员 / 店长销售分成（实时）：(范围内本月营业额 − 商场月累计抽成) × 1%
 * 商场抽成 SSOT：单店各自 max(0, 该店 R − 170000) × 15%，多店范围取各店之和（可配置 finance_settings）
 * 权限与工资条一致：viewPayslip（本人查工资条即可看；店长/超管同权）
 * 门店范围：优先按 actor 绑定门店（一般一店 → 该门店）；店长未绑店回落山川造物；
 * 超管已绑店按其门店，未绑店才双店合计兜底
 */
async function payslipSalesShare(event, openid) {
  const guard = await assertStaff(db, openid, { permission: 'viewPayslip' })
  if (!guard.ok) return fail(guard.msg, { code: guard.code })
  try {
    const share = await computeMonthlySalesShare(db, _, {
      yearMonth: event && event.yearMonth,
      actor: guard.actor
    })
    if (share && share.error) {
      return fail(share.error)
    }
    return { success: true, salesShare: share }
  } catch (e) {
    return fail(e.message || '销售分成计算失败')
  }
}

async function payslipDetail(event, openid) {
  const guard = await assertStaff(db, openid, { permission: 'viewPayslip' })
  if (!guard.ok) return fail(guard.msg, { code: guard.code })
  const id = String(event.id || '').trim()
  if (!id) return fail('缺少工资条 id')
  try {
    const res = await db.collection(COL_PAY).doc(id).get()
    const row = res.data
    if (!row) return fail('工资条不存在')
    if (row.staffOpenid !== openid && guard.actor.workspaceRole !== 'super_admin' && guard.actor.role !== ROLE_MANAGER) {
      return fail('无权查看')
    }
    return { success: true, detail: row }
  } catch (e) {
    return fail('工资条不存在')
  }
}

function normalizePayslipItems(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((row) => {
      const name = String((row && row.name) || '').trim().slice(0, 40)
      const amount = Math.round(Number(row && row.amount) * 100) / 100
      const kind = row && row.kind === 'deduct' ? 'deduct' : 'earn'
      if (!name || !Number.isFinite(amount)) return null
      return { name, amount: Math.abs(amount), kind }
    })
    .filter(Boolean)
    .slice(0, 30)
}

function totalsFromPayslipPayload(event) {
  const items = normalizePayslipItems(event.items)
  if (items.length) {
    let earn = 0
    let deduct = 0
    items.forEach((it) => {
      if (it.kind === 'deduct') deduct += it.amount
      else earn += it.amount
    })
    const gross = Math.round(earn * 100) / 100
    const deduction = Math.round(deduct * 100) / 100
    const net = Math.round((gross - deduction) * 100) / 100
    return { items, base: 0, bonus: gross, deduction, gross, net, useItems: true }
  }
  const base = Number(event.base)
  const bonus = Number(event.bonus) || 0
  const deduction = Number(event.deduction) || 0
  if (!Number.isFinite(base) || base < 0) return { error: '请填写有效基本工资' }
  const gross = Math.round((base + bonus) * 100) / 100
  const net = Math.round((base + bonus - deduction) * 100) / 100
  return { items: [], base, bonus, deduction, gross, net, useItems: false }
}

async function payslipAdminList(event, openid) {
  const guard = await assertStaff(db, openid, { requireSuperAdmin: true })
  if (!guard.ok) return fail(guard.msg, { code: guard.code })
  const staffOpenid = String(event.staffOpenid || '').trim()
  const month = String(event.month || '').trim()
  const limit = Math.min(Math.max(Number(event.limit) || 50, 1), 100)
  try {
    let query = db.collection(COL_PAY)
    const where = {}
    if (staffOpenid) where.staffOpenid = staffOpenid
    if (month && /^\d{4}-\d{2}$/.test(month)) where.month = month
    if (Object.keys(where).length) query = query.where(where)
    const res = await query.orderBy('month', 'desc').limit(limit).get()
    return { success: true, list: res.data || [] }
  } catch (e) {
    return { success: true, list: [], fallback: true }
  }
}

async function payslipRemove(event, openid) {
  const guard = await assertStaff(db, openid, { requireSuperAdmin: true })
  if (!guard.ok) return fail(guard.msg, { code: guard.code })
  const id = String(event.id || '').trim()
  if (!id) return fail('缺少工资条 id')
  try {
    await db.collection(COL_PAY).doc(id).remove()
    return { success: true }
  } catch (e) {
    return fail(e.message || '删除失败')
  }
}

/** 该员工同一年度已扣过「全年一次」品目的工资条月份（排除正在编辑的这一张） */
async function findAnnualChargedMonth(staffOpenid, year, excludeId) {
  const res = await db.collection(COL_PAY).where({ staffOpenid }).limit(100).get()
  const hit = (res.data || []).find((r) =>
    r && r._id !== excludeId && r.socialInsurance && r.socialInsurance.annualIncluded && r.socialInsurance.annualYear === year
  )
  return hit ? String(hit.month || '') : ''
}

/**
 * 工资条的社保快照：raw = { standardId, paidMonth?, includeAnnual? }；不传 standardId = 不套用（旧行为）。
 * includeAnnual 不传时：本年度还没扣过「全年一次」品目就扣；已扣过再要求扣 → 拒绝。
 */
async function resolveSocialInsurance(raw, staffOpenid, payslipMonth, docId) {
  if (!raw || !raw.standardId) return { snapshot: null, annualChargedIn: '' }
  const paidMonth = String(raw.paidMonth || '').trim() || SI.defaultPaidMonth(payslipMonth)
  const year = paidMonth.slice(0, 4)
  let chargedIn = ''
  try {
    chargedIn = await findAnnualChargedMonth(staffOpenid, year, docId)
  } catch (e) {
    return { error: '暂时读不到该员工往期工资条，请稍后再套用社保标准' }
  }
  const includeAnnual = raw.includeAnnual == null ? !chargedIn : !!raw.includeAnnual
  if (includeAnnual && chargedIn) return { error: `大额医疗互助 ${year} 年已在 ${chargedIn} 工资条扣过，全年只扣一次`, annualChargedIn: chargedIn }
  const r = SI.computeSocialInsurance({ standardId: raw.standardId, paidMonth, includeAnnual })
  if (!r.ok) return { error: r.msg, annualChargedIn: chargedIn }
  return { snapshot: r.snapshot, annualChargedIn: chargedIn }
}

async function payslipSiPreview(event, openid) {
  const guard = await assertStaff(db, openid, { requireSuperAdmin: true })
  if (!guard.ok) return fail(guard.msg, { code: guard.code })
  const targetOpenid = String(event.staffOpenid || '').trim()
  const month = String(event.month || '').trim()
  const raw = event.socialInsurance || {}
  const paidMonth = String(raw.paidMonth || '').trim() || SI.defaultPaidMonth(month)
  const std = raw.standardId ? SI.findStandard(raw.standardId) : SI.standardForMonth(paidMonth)
  const base = { success: true, standards: SI.listStandards(), standardId: std ? std.id : '', paidMonth }
  if (!targetOpenid || !/^\d{4}-\d{2}$/.test(month) || !std) return { ...base, snapshot: null, annualChargedIn: '' }
  const si = await resolveSocialInsurance({ ...raw, standardId: std.id, paidMonth }, targetOpenid, month, `${targetOpenid}_${month}`)
  if (si.error) return { ...base, snapshot: null, annualChargedIn: si.annualChargedIn || '', msg: si.error }
  return { ...base, snapshot: si.snapshot, annualChargedIn: si.annualChargedIn }
}

async function payslipUpsert(event, openid) {
  const guard = await assertStaff(db, openid, { requireSuperAdmin: true })
  if (!guard.ok) return fail(guard.msg, { code: guard.code })
  const targetOpenid = String(event.staffOpenid || '').trim()
  const month = String(event.month || '').trim()
  if (!targetOpenid || !/^\d{4}-\d{2}$/.test(month)) return fail('请填写员工 openid 与月份 YYYY-MM')
  const totals = totalsFromPayslipPayload(event)
  if (totals.error) return fail(totals.error)
  const docId = `${targetOpenid}_${month}`
  const si = await resolveSocialInsurance(event.socialInsurance, targetOpenid, month, docId)
  if (si.error) return fail(si.error)
  const now = new Date()
  const doc = {
    staffOpenid: targetOpenid,
    staffName: String(event.staffName || '').trim(),
    month,
    base: totals.base,
    bonus: totals.bonus,
    deduction: totals.deduction,
    gross: totals.gross,
    net: totals.net,
    remark: String(event.remark || '').trim().slice(0, 200),
    updatedAt: now,
    updatedBy: openid,
    updatedByName: guard.actor.name || ''
  }
  if (totals.items.length) doc.items = totals.items
  if (si.snapshot) {
    // 只有个人部分进扣款；公司缴纳部分只存快照供展示
    doc.otherDeduction = totals.deduction
    doc.deduction = Math.round((totals.deduction + si.snapshot.personalTotal) * 100) / 100
    doc.net = Math.round((totals.gross - doc.deduction) * 100) / 100
    doc.socialInsurance = si.snapshot
  }
  try {
    await db.collection(COL_PAY).doc(docId).set({ data: doc })
    return { success: true, id: docId }
  } catch (e) {
    try {
      await db.collection(COL_PAY).add({ data: { _id: docId, ...doc, createTime: now } })
      return { success: true, id: docId }
    } catch (e2) {
      return fail(e2.message || '保存失败')
    }
  }
}

async function reimburseSubmit(event, openid) {
  const guard = await assertStaff(db, openid, { permission: 'submitReimbursement' })
  if (!guard.ok) return fail(guard.msg, { code: guard.code })
  const amount = Number(event.amount)
  if (!Number.isFinite(amount) || amount <= 0) return fail('请填写有效报销金额')
  const category = String(event.category || '').trim() || '其他'
  const remark = String(event.remark || '').trim().slice(0, 500)
  const images = normalizeImages(event.images)
  const storeId = String(event.storeId || '').trim()
  const now = new Date()
  const doc = {
    staffOpenid: openid,
    staffName: guard.actor.name || '',
    storeId,
    amount: Math.round(amount * 100) / 100,
    category,
    remark,
    images,
    status: 'pending',
    createTime: now,
    updateTime: now
  }
  try {
    const add = await db.collection(COL_REIM).add({ data: doc })
    return { success: true, id: add._id }
  } catch (e) {
    return fail(e.message || '提交失败')
  }
}

async function reimburseList(event, openid) {
  const guard = await assertStaff(db, openid, { permission: 'submitReimbursement' })
  if (!guard.ok) return fail(guard.msg, { code: guard.code })
  try {
    const res = await db.collection(COL_REIM)
      .where({ staffOpenid: openid })
      .orderBy('createTime', 'desc')
      .limit(50)
      .get()
    return { success: true, list: res.data || [] }
  } catch (e) {
    return { success: true, list: [], fallback: true }
  }
}

async function reimbursePendingList(event, openid) {
  const guard = await assertStaff(db, openid, { role: ROLE_MANAGER, permission: 'reimburseReview' })
  if (!guard.ok) return fail(guard.msg, { code: guard.code })
  const limit = Math.min(50, Math.max(5, Number(event.limit) || 30))
  try {
    const res = await db.collection(COL_REIM)
      .where({ status: 'pending' })
      .orderBy('createTime', 'desc')
      .limit(limit)
      .get()
    return { success: true, list: res.data || [] }
  } catch (e) {
    return { success: true, list: [], fallback: true }
  }
}

async function reimburseReview(event, openid) {
  const guard = await assertStaff(db, openid, { role: ROLE_MANAGER, permission: 'reimburseReview' })
  if (!guard.ok) return fail(guard.msg, { code: guard.code })
  const id = String(event.id || '').trim()
  const decision = event.decision === 'approved' ? 'approved' : event.decision === 'rejected' ? 'rejected' : ''
  if (!id || !decision) return fail('缺少申请 id 或审批结论')
  const reviewNote = String(event.reviewNote || '').trim().slice(0, 200)
  try {
    await db.collection(COL_REIM).doc(id).update({
      data: {
        status: decision,
        reviewNote,
        reviewedBy: openid,
        reviewedAt: new Date()
      }
    })
    return { success: true }
  } catch (e) {
    return fail(e.message || '审批失败')
  }
}

async function getMeta() {
  return {
    success: true,
    morningItems: MORNING_ITEMS,
    eveningItems: EVENING_ITEMS,
    reimburseCategories: REIMBURSE_CATEGORIES,
    leaveTypes: LEAVE_TYPES
  }
}

exports.main = async (event) => {
  globalThis.__adminOpsKey = (event && event.adminOpsKey) || ''
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const action = String((event && event.action) || '').trim()

  if (action === 'getMeta') return getMeta()

  if (!openid) return fail('请先登录')

  switch (action) {
    case 'attendanceToday':
      return attendanceToday(event, openid)
    case 'attendanceClock':
      return attendanceClock(event, openid)
    case 'attendanceList':
      return attendanceList(event, openid)
    case 'leaveSubmit':
      return leaveSubmit(event, openid)
    case 'leaveList':
      return leaveList(event, openid)
    case 'leavePendingList':
      return leavePendingList(event, openid)
    case 'leaveReview':
      return leaveReview(event, openid)
    case 'leaveCancel':
      return leaveCancel(event, openid)
    case 'todoGet':
      return todoGet(event, openid)
    case 'todoSave':
      return todoSave(event, openid)
    case 'payslipList':
      return payslipList(event, openid)
    case 'payslipDetail':
      return payslipDetail(event, openid)
    case 'payslipSalesShare':
      return payslipSalesShare(event, openid)
    case 'payslipUpsert':
      return payslipUpsert(event, openid)
    case 'payslipAdminList':
      return payslipAdminList(event, openid)
    case 'payslipSiPreview':
      return payslipSiPreview(event, openid)
    case 'payslipRemove':
      return payslipRemove(event, openid)
    case 'reimburseSubmit':
      return reimburseSubmit(event, openid)
    case 'reimburseList':
      return reimburseList(event, openid)
    case 'reimburseReview':
      return reimburseReview(event, openid)
    case 'reimbursePendingList':
      return reimbursePendingList(event, openid)
    default:
      return fail('未知 action')
  }
}
