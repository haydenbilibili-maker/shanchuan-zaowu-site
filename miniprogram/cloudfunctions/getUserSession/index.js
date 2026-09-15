const cloud = require('wx-server-sdk')
const { calcProfileScore, resolveAuthState, buildMemberNo, sanitizeUser } = require('./profileUtil')
const { loadMemberLevels, resolveMemberLevel, toLevelLadder } = require('./memberLevels')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function sumPaidGrowth(openid) {
  // 分页累加：原实现只取 100 条，订单破百的用户等级/积分会静默变小
  const PAGE = 100
  const MAX_PAGES = 60
  let totalAmount = 0
  let orderCount = 0
  let skip = 0
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await db.collection('orders')
      .where({
        _openid: openid,
        status: _.in(['paid', 'shipped', 'received'])
      })
      .orderBy('createTime', 'asc')
      .skip(skip)
      .limit(PAGE)
      .get()
    const rows = res.data || []
    rows.forEach((order) => {
      if (order.source === 'exchange') return
      orderCount += 1
      // 首单预估定级订单写 growthAmount（会员折前应付）；否则用实付 totalPrice
      const raw = order.growthAmount != null && order.growthAmount !== ''
        ? order.growthAmount
        : order.totalPrice
      if (raw == null || raw === '') return
      const price = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/,/g, ''))
      if (!isNaN(price)) totalAmount += price
    })
    if (rows.length < PAGE) break
    skip += rows.length
  }
  return { totalAmount, orderCount }
}

/** 与 staffGuard 同源：仅名单内 openid 为超管工作台 */
const SUPER_ADMIN_OPENIDS = [
  'oa22s5ZcMY7xkQDlNW8X8jaYy46M',
  'oa22s5RuZSXOCRQtXzdrVEiT1JuY'
]

async function loadSuperAdminOpenids(db) {
  const superList = SUPER_ADMIN_OPENIDS.slice()
  try {
    const acl = await db.collection('workspace_acl').doc('super_admins').get()
    const fromDb = Array.isArray((acl.data || {}).openids) ? acl.data.openids : []
    fromDb.forEach((id) => {
      const v = String(id || '').trim()
      if (v && superList.indexOf(v) === -1) superList.push(v)
    })
  } catch (e) { /* 集合/文档不存在时忽略 */ }
  return superList
}

function rolesFromStaffRow(row) {
  const set = {}
  const push = (raw) => {
    const v = String(raw || '').trim()
    if (!v) return
    if (v === 'super_admin' || v === 'superAdmin') set.super_admin = true
    else if (v === 'manager' || v === 'owner' || v === 'admin') set.manager = true
    else if (v === 'staff' || v === 'clerk') set.staff = true
    else if (v === 'specimen_artisan') set.specimen_artisan = true
    else if (v === 'live_host') set.live_host = true
    else if (v === 'investor') set.investor = true
    else if (v === 'shareholder') set.shareholder = true
  }
  if (row) {
    if (Array.isArray(row.roles)) row.roles.forEach(push)
    push(row.role)
  }
  return Object.keys(set)
}

function packStaffAccess(roles) {
  const list = Array.isArray(roles) ? roles.filter(Boolean) : []
  const priority = {
    super_admin: 100,
    manager: 80,
    investor: 70,
    shareholder: 68,
    specimen_artisan: 60,
    live_host: 50,
    staff: 10
  }
  let primary = ''
  let score = -1
  list.forEach((r) => {
    const s = priority[r] || 0
    if (s > score) {
      score = s
      primary = r
    }
  })

  let workspaceRole = ''
  if (primary === 'super_admin') workspaceRole = 'super_admin'
  else if (primary === 'manager') workspaceRole = 'store_manager'
  else if (primary === 'investor') workspaceRole = 'investor'
  else if (primary === 'shareholder') workspaceRole = 'shareholder'
  else if (primary === 'specimen_artisan') workspaceRole = 'specimen_artisan'
  else if (primary === 'live_host') workspaceRole = 'live_host'
  else if (primary === 'staff') workspaceRole = 'store_staff'

  let staffRole = ''
  if (primary === 'super_admin' || primary === 'manager') staffRole = 'manager'
  else if (primary === 'investor') staffRole = 'investor'
  else if (primary === 'shareholder') staffRole = 'shareholder'
  else if (primary === 'specimen_artisan') staffRole = 'specimen_artisan'
  else if (primary === 'live_host') staffRole = 'live_host'
  else if (primary === 'staff') staffRole = 'staff'

  const has = (k) => list.indexOf(k) !== -1
  return {
    staffRole,
    workspaceRole,
    roles: list,
    isSuperAdmin: has('super_admin'),
    isManager: has('manager'),
    isStaff: has('staff'),
    isArtisan: has('specimen_artisan'),
    isLiveHost: has('live_host'),
    isInvestor: has('investor'),
    isShareholder: has('shareholder')
  }
}

/**
 * 后台入口可见性。真正鉴权在各云函数 staffGuard。
 * 返回 roles[]（canonical）与兼容字段 staffRole / workspaceRole（最高权限）
 */
async function resolveStaffAccess(db, openid, userInfo) {
  const empty = {
    staffRole: '',
    workspaceRole: '',
    roles: [],
    isSuperAdmin: false,
    isManager: false,
    isStaff: false,
    isArtisan: false,
    isLiveHost: false,
    isInvestor: false,
    isShareholder: false
  }

  let inSuperAcl = false
  if (openid) {
    const superList = await loadSuperAdminOpenids(db)
    inSuperAcl = superList.indexOf(openid) !== -1
  }

  let staffRow = null
  try {
    const res = await db.collection('staff_members').where({ openid, status: 'active' }).limit(1).get()
    staffRow = res.data && res.data[0]
  } catch (e) {
    console.warn('getUserSession staff_members lookup failed:', e.message)
  }

  if (staffRow || inSuperAcl) {
    const set = {}
    rolesFromStaffRow(staffRow).forEach((r) => { set[r] = true })
    if (inSuperAcl) set.super_admin = true
    return packStaffAccess(Object.keys(set))
  }
  if (userInfo && userInfo.isAdmin === true) {
    return {
      staffRole: 'manager',
      workspaceRole: 'store_manager',
      roles: ['manager'],
      isSuperAdmin: false,
      isManager: true,
      isStaff: true,
      isArtisan: false,
      isLiveHost: false,
      isInvestor: false,
      isShareholder: false
    }
  }
  const admins = (process.env.MESSAGE_ADMIN_OPENIDS || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (admins.includes(openid)) {
    return {
      staffRole: 'manager',
      workspaceRole: 'store_manager',
      roles: ['manager'],
      isSuperAdmin: false,
      isManager: true,
      isStaff: true,
      isArtisan: false,
      isLiveHost: false,
      isInvestor: false,
      isShareholder: false
    }
  }
  const role = (userInfo && userInfo.staffRole) || ''
  if (role === 'manager') {
    return {
      ...empty,
      staffRole: 'manager',
      workspaceRole: 'store_manager',
      roles: ['manager'],
      isManager: true,
      isStaff: true
    }
  }
  if (role === 'staff') {
    return {
      ...empty,
      staffRole: 'staff',
      workspaceRole: 'store_staff',
      roles: ['staff'],
      isStaff: true
    }
  }
  if (role === 'specimen_artisan') {
    return {
      ...empty,
      staffRole: 'specimen_artisan',
      workspaceRole: 'specimen_artisan',
      roles: ['specimen_artisan'],
      isStaff: true,
      isArtisan: true
    }
  }
  if (role === 'live_host') {
    return {
      ...empty,
      staffRole: 'live_host',
      workspaceRole: 'live_host',
      roles: ['live_host'],
      isStaff: true,
      isLiveHost: true
    }
  }
  if (role === 'investor') {
    return {
      ...empty,
      staffRole: 'investor',
      workspaceRole: 'investor',
      roles: ['investor'],
      isInvestor: true,
      isStaff: true
    }
  }
  if (role === 'shareholder') {
    return {
      ...empty,
      staffRole: 'shareholder',
      workspaceRole: 'shareholder',
      roles: ['shareholder'],
      isShareholder: true,
      isStaff: true
    }
  }
  return empty
}

async function computeStats(openid, userInfo) {
  let isHonorary = false
  let bonusPoints = 0
  let usedPoints = 0

  if (userInfo) {
    isHonorary = userInfo.isHonorary === true
    bonusPoints = userInfo.bonusPoints || 0
    usedPoints = userInfo.usedPoints || 0
  }

  const { totalAmount, orderCount } = await sumPaidGrowth(openid)
  const orderGrowth = Math.floor(totalAmount)
  const storeGrowth = Math.max(0, Math.floor(Number(userInfo && userInfo.storeGrowthValue) || 0))
  // 等级成长含门店；可用积分不含 storeGrowthValue（门店分在 bonusPoints）
  const growthValue = orderGrowth + storeGrowth
  const availablePoints = (orderGrowth + bonusPoints) - usedPoints

  const { levels, source } = await loadMemberLevels(db)
  const resolved = resolveMemberLevel(levels, growthValue, isHonorary, userInfo && userInfo.levelOverride)
  const access = await resolveStaffAccess(db, openid, userInfo)

  return {
    totalAmount,
    orderCount,
    points: Math.max(0, availablePoints),
    level: resolved.level,
    levelName: resolved.levelName,
    discountRate: resolved.discountRate,
    growthValue,
    storeGrowthValue: storeGrowth,
    nextThreshold: resolved.nextThreshold,
    levelLadder: toLevelLadder(levels),
    levelSource: source,
    isAdmin: !!(userInfo && userInfo.isAdmin),
    staffRole: access.staffRole,
    workspaceRole: access.workspaceRole,
    roles: access.roles,
    isSuperAdmin: access.isSuperAdmin,
    isManager: access.isManager,
    isStaff: access.isStaff,
    isArtisan: access.isArtisan,
    isLiveHost: access.isLiveHost,
    isInvestor: access.isInvestor,
    isShareholder: access.isShareholder,
    isHonorary,
    levelOverride: (userInfo && userInfo.levelOverride) || null,
    overrideMode: resolved.overrideMode || ''
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  if (!openid) {
    return { success: false, msg: '未登录', authState: 'guest' }
  }

  try {
    const userRes = await db.collection('users').where({ _openid: openid }).limit(1).get()
    const rawUser = userRes.data && userRes.data[0] ? userRes.data[0] : null
    const stats = await computeStats(openid, rawUser)
    const user = sanitizeUser(rawUser, openid)
    const profileScore = user ? user.profileScore : 0
    const authState = resolveAuthState(rawUser || {})
    const onboardingDone = !!(rawUser && rawUser.onboardingDone)

    return {
      success: true,
      openid,
      authState,
      onboardingDone,
      profileScore,
      memberNo: buildMemberNo(openid),
      user,
      stats
    }
  } catch (e) {
    console.error('getUserSession', e)
    return { success: false, msg: e.message || '加载失败', authState: 'guest' }
  }
}
