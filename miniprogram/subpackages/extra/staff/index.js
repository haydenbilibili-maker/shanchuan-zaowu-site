/**
 * 店员工作台 — 现场服务入口（按职责分组，不复制超管九宫格）
 */
const { hasPermission } = require('../utils/staffAuth')
const { openWorkspaceMemberScan } = require('../utils/memberScan')
const { initStaffStores, applyStoreChange } = require('./utils/pageSetup')

const db = wx.cloud.database()

const FIELD = '/subpackages/extra/staff/field/index'

const SCENE_GROUPS = [
  {
    key: 'onsite',
    title: '现场服务',
    en: 'ON-SITE',
    items: [
      {
        key: 'verify',
        title: '核销验票',
        desc: '会员码 · 预约票 · 门店礼券 · 礼赠自提',
        en: 'TICKET',
        icon: '/assets/icons/qrcode.png',
        path: `${FIELD}?tab=verify`,
        anyOf: ['verifyBooking', 'verifyMemberPass', 'verifyStoreCoupon', 'verifyGiftPickup']
      },
      {
        key: 'grant',
        title: '消费赠分',
        desc: '扫会员码录入消费并赠分',
        en: 'GRANT',
        icon: '/assets/icons/coin_gold.png',
        path: `${FIELD}?tab=grant`,
        permission: 'grantStorePoints'
      },
      {
        key: 'visit',
        title: '到店签到',
        desc: '查看今日到店人数',
        en: 'VISIT',
        icon: '/assets/icons/checkin.png',
        path: `${FIELD}?tab=visit`,
        anyOf: ['viewStoreVisits', 'grantStorePoints', 'verifyBooking', 'verifyStoreCoupon', 'verifyGiftPickup'],
        staffFallback: true
      },
      {
        key: 'records',
        title: '赠分流水',
        desc: '本人或本店今日赠分记录',
        en: 'LEDGER',
        icon: '/assets/icons/list.png',
        path: `${FIELD}?tab=records`,
        anyOf: ['viewOwnRecords', 'grantStorePoints', 'revokeStorePoints']
      }
    ]
  },
  {
    key: 'shift',
    title: '班次日常',
    en: 'SHIFT',
    items: [
      {
        key: 'attendance',
        title: '考勤打卡',
        desc: '上下班打卡，记录门店与时间',
        en: 'ATTENDANCE',
        icon: '/subpackages/manager/assets/icons/clock.png',
        path: '/subpackages/extra/staff/attendance/index',
        permission: 'staffAttendance'
      },
      {
        key: 'leave',
        title: '请假申请',
        desc: '事假病假年假调休，提交后待审批',
        en: 'LEAVE',
        icon: '/assets/icons/list.png',
        path: '/subpackages/extra/staff/leave/index',
        permission: 'staffAttendance'
      },
      {
        key: 'todos',
        title: '早晚门店清单',
        desc: '开闭店陈列、收银与安防核对',
        en: 'CHECKLIST',
        icon: '/assets/icons/done.png',
        path: '/subpackages/extra/staff/store-todos/index',
        permission: 'storeTodo'
      }
    ]
  },
  {
    key: 'hr',
    title: '人事与薪酬',
    en: 'PAYROLL',
    items: [
      {
        key: 'payslip',
        title: '工资条明细',
        desc: '应发实发 · 所属门店销售分成 1%',
        en: 'PAYSLIP',
        icon: '/assets/icons/wallet_gold.png',
        path: '/subpackages/extra/staff/payslips/index',
        permission: 'viewPayslip'
      },
      {
        key: 'reimburse',
        title: '报销申请',
        desc: '提交费用报销并跟踪审核',
        en: 'EXPENSE',
        icon: '/assets/icons/pay.png',
        path: '/subpackages/extra/staff/reimbursements/index',
        permission: 'submitReimbursement'
      },
      {
        key: 'reimburseReview',
        title: '报销审批',
        desc: '审核店员提交的报销申请',
        en: 'REVIEW',
        icon: '/subpackages/manager/assets/icons/edit.png',
        path: '/subpackages/extra/staff/reimburse-review/index',
        permission: 'reimburseReview'
      },
      {
        key: 'leaveReview',
        title: '请假审批',
        desc: '审核同事请假；店长请假需超管',
        en: 'LEAVE REVIEW',
        icon: '/subpackages/manager/assets/icons/edit.png',
        path: '/subpackages/extra/staff/leave-review/index',
        permission: 'leaveReview'
      }
    ]
  }
]

function sceneVisible(role, scene) {
  if (scene.permission) return hasPermission(role, scene.permission)
  const keys = scene.anyOf || []
  if (keys.some((p) => hasPermission(role, p))) return true
  return !!(scene.staffFallback && role && role.isStaff)
}

/** 与现场服务主 CTA 一致：任一核销 / 赠分权限即可扫码入口 */
const SCAN_CTA_PERMS = [
  'verifyMemberPass',
  'verifyBooking',
  'verifyStoreCoupon',
  'verifyGiftPickup',
  'verifyOrderPickup',
  'grantStorePoints'
]

function canShowScanCta(role) {
  if (!role) return false
  if (role.isSuperAdmin || role.isManager) return true
  return SCAN_CTA_PERMS.some((p) => hasPermission(role, p))
}

Page({
  data: {
    ready: false,
    roleText: '',
    staffName: '',
    storeOptions: [],
    storeNames: [],
    storeIndex: 0,
    storeId: '',
    storeName: '',
    groups: [],
    hasScenes: false,
    showScanCta: false
  },

  async onLoad() {
    try {
      const setup = await initStaffStores('staff')
      if (!setup) return
      this._role = setup.role
      const groups = this.buildGroups(setup.role)
      this.setData({
        ready: true,
        roleText: setup.roleText,
        staffName: setup.staffName,
        storeOptions: setup.storeOptions,
        storeNames: setup.storeNames,
        storeIndex: setup.storeIndex,
        storeId: setup.storeId,
        storeName: setup.storeName,
        groups,
        hasScenes: groups.some((g) => g.items && g.items.length),
        showScanCta: canShowScanCta(setup.role)
      })
      this.loadBadges()
    } catch (e) {
      console.warn('staff hub onLoad', e)
      wx.showToast({ title: '工作台加载失败', icon: 'none' })
    }
  },

  buildGroups(role, counts) {
    const badges = counts || {}
    return SCENE_GROUPS.map((group) => ({
      key: group.key,
      title: group.title,
      en: group.en,
      items: (group.items || []).filter((s) => sceneVisible(role, s)).map((s) => {
        const n = Number(badges[s.key]) || 0
        return {
          ...s,
          badge: n > 99 ? '99+' : (n > 0 ? String(n) : '')
        }
      })
    })).filter((g) => g.items.length)
  },

  async loadBadges() {
    const role = this._role
    if (!role) return
    const storeId = this.data.storeId || ''
    const counts = {}
    try {
      let rows = []
      try {
        const res = await db.collection('bookings')
          .where({ status: db.command.in(['confirmed', 'pending']) })
          .limit(40)
          .get()
        rows = res.data || []
      } catch (e) {
        const res = await db.collection('bookings')
          .where({ status: 'confirmed' })
          .limit(30)
          .get()
        rows = res.data || []
      }
      counts.verify = rows.filter((item) => !storeId || !item.storeId || item.storeId === storeId).length
    } catch (e) {
      counts.verify = 0
    }
    if (hasPermission(role, 'reimburseReview')) {
      try {
        const res = await wx.cloud.callFunction({
          name: 'manageStaffWorkspace',
          data: { action: 'reimbursePendingList', limit: 30 }
        })
        counts.reimburseReview = (((res && res.result) || {}).list || []).length
      } catch (e) {
        counts.reimburseReview = 0
      }
    }
    if (hasPermission(role, 'leaveReview')) {
      try {
        const res = await wx.cloud.callFunction({
          name: 'manageStaffWorkspace',
          data: { action: 'leavePendingList', limit: 30 }
        })
        counts.leaveReview = (((res && res.result) || {}).list || []).length
      } catch (e) {
        counts.leaveReview = 0
      }
    }
    const groups = this.buildGroups(role, counts)
    this.setData({ groups, hasScenes: groups.some((g) => g.items && g.items.length) })
  },

  onStoreChange(e) {
    const index = parseInt(e.detail.value, 10) || 0
    applyStoreChange(this, index)
    this.loadBadges()
  },

  openScene(e) {
    const path = String((e.currentTarget.dataset && e.currentTarget.dataset.path) || '').trim()
    if (!path) {
      wx.showToast({ title: '页面暂不可用', icon: 'none' })
      return
    }
    const qs = `storeId=${encodeURIComponent(this.data.storeId || '')}&storeName=${encodeURIComponent(this.data.storeName || '')}`
    const url = path.indexOf('?') >= 0 ? `${path}&${qs}` : `${path}?${qs}`
    wx.navigateTo({
      url,
      fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' })
    })
  },

  /** 首屏主 CTA：立刻开相机；成功后再进现场服务复用解析/核销 */
  goScanMember() {
    const role = this._role
    if (!canShowScanCta(role)) {
      wx.showToast({ title: '无扫码核销权限', icon: 'none' })
      return
    }
    // 缺 verifyOrderPickup 会让「只授自取核销」的店员被误判进「消费赠分」tab，
    // 进而被 field 页拒绝「消费赠分只认会员码」，扫码后无法交付自取单
    const canVerifyAny = ['verifyMemberPass', 'verifyBooking', 'verifyStoreCoupon', 'verifyGiftPickup', 'verifyOrderPickup']
      .some((p) => hasPermission(role, p))
    const tab = (canVerifyAny || role.isSuperAdmin || role.isManager) ? 'verify' : 'grant'
    openWorkspaceMemberScan({
      purpose: tab === 'grant' ? 'grant' : 'verify',
      tab,
      storeId: this.data.storeId || '',
      storeName: this.data.storeName || '',
      fieldPath: FIELD
    })
  },

  onShow() {
    if (this.data.ready) this.loadBadges()
  },

  onPullDownRefresh() {
    const jobs = []
    if (this.data.ready) jobs.push(this.loadBadges())
    Promise.all(jobs).then(() => wx.stopPullDownRefresh())
  }
})
