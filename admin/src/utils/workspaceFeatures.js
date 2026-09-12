/**
 * 与小程序 cloudfunctions/manageStaff/workspaceFeatures.js 对齐
 * Admin「店员工作台权限」细粒度勾选用
 */

export const WORKBENCH_CATALOG = {
  super_admin: {
    title: '超管工作台',
    en: 'SUPER',
    readOnly: true,
    features: [
      {
        key: '_super_full',
        label: '全集能力',
        hint: '含店长经营、标本师/主播模块及人员、内容开关、运费、积分规则、礼赠配置(manageGift)、数据与审计等超管专属'
      }
    ]
  },
  manager: {
    title: '店长工作台',
    en: 'MANAGER',
    features: [
      { key: 'verifyMemberPass', label: '会员码核验' },
      { key: 'verifyBooking', label: '预约核销' },
      { key: 'verifyStoreCoupon', label: '门店代金券核销' },
      { key: 'verifyGiftPickup', label: '礼赠自提核销' },
      { key: 'giftOps', label: '礼赠履约看板' },
      { key: 'grantStorePoints', label: '门店消费赠分' },
      { key: 'viewStoreVisits', label: '到店签到统计' },
      { key: 'revokeStorePoints', label: '撤销赠分' },
      { key: 'viewStoreRecords', label: '全店积分流水' },
      { key: 'manageInvoiceRequests', label: '发票申请处理' },
      { key: 'manageProducts', label: '藏品库管理' },
      { key: 'manageLive', label: '馆内直播（店长侧）' },
      { key: 'reimburseReview', label: '店员报销审批' },
      { key: 'leaveReview', label: '请假审批' }
    ]
  },
  staff: {
    title: '店员工作台',
    en: 'STAFF',
    features: [
      { key: 'staffAttendance', label: '考勤打卡' },
      { key: 'storeTodo', label: '早晚门店清单' },
      { key: 'viewPayslip', label: '工资条查询' },
      { key: 'submitReimbursement', label: '报销申请' },
      { key: 'verifyMemberPass', label: '会员码核验（现场）' },
      { key: 'verifyBooking', label: '预约核销（现场）' },
      { key: 'verifyStoreCoupon', label: '门店代金券核销（现场）' },
      { key: 'verifyGiftPickup', label: '礼赠自提核销（现场）' },
      { key: 'grantStorePoints', label: '消费赠分（现场）' },
      { key: 'viewStoreVisits', label: '到店签到统计（现场）' },
      { key: 'viewOwnRecords', label: '本人操作记录' }
    ]
  },
  specimen_artisan: {
    title: '标本师工作台',
    en: 'ARTISAN',
    features: [
      { key: 'manageProducts', label: '上传与管理本人藏品' },
      { key: 'manageArtisanProfile', label: '个人信息页' },
      { key: 'manageArtisanWorks', label: '个人作品页' },
      { key: 'viewPayslip', label: '工资条查询' },
      { key: 'staffAttendance', label: '考勤打卡 / 请假' }
    ]
  },
  live_host: {
    title: '主播工作台',
    en: 'LIVE HOST',
    features: [
      { key: 'manageLive', label: '直播场次 / 开播 / 挂车 / 公告' },
      { key: 'viewPayslip', label: '工资条查询' },
      { key: 'staffAttendance', label: '考勤打卡 / 请假' }
    ]
  },
  investor: {
    title: '投资人观测台',
    en: 'INVESTOR',
    features: [
      { key: 'viewInvestorFinance', label: '财务汇总（只读）' },
      { key: 'viewInvestorAnalytics', label: '小程序数据大盘（只读）' }
    ]
  }
}

const ROLE_ORDER = ['super_admin', 'manager', 'staff', 'specimen_artisan', 'live_host', 'investor']

export function featureKeysForRoles(roles) {
  const keys = {}
  ;(roles || []).forEach((r) => {
    const cat = WORKBENCH_CATALOG[r]
    if (!cat || cat.readOnly) return
    ;(cat.features || []).forEach((f) => {
      if (f.key && !String(f.key).startsWith('_')) keys[f.key] = true
    })
  })
  return Object.keys(keys)
}

export function buildWorkbenchFeatureUI(roles, selectedPermissions) {
  const selected = {}
  ;(selectedPermissions || []).forEach((k) => {
    if (k) selected[k] = true
  })
  const groups = []
  ROLE_ORDER.forEach((roleKey) => {
    if (!(roles || []).includes(roleKey)) return
    const cat = WORKBENCH_CATALOG[roleKey]
    if (!cat) return
    if (cat.readOnly) {
      groups.push({
        roleKey,
        title: cat.title,
        en: cat.en,
        readOnly: true,
        items: (cat.features || []).map((f) => ({
          key: f.key,
          label: f.label,
          hint: f.hint || '',
          checked: true,
          disabled: true
        }))
      })
      return
    }
    groups.push({
      roleKey,
      title: cat.title,
      en: cat.en,
      readOnly: false,
      items: (cat.features || []).map((f) => ({
        key: f.key,
        label: f.label,
        hint: f.hint || '',
        checked: !!selected[f.key],
        disabled: false
      }))
    })
  })
  return groups
}

export function permissionsFromFeatureGroups(groups) {
  const set = {}
  ;(groups || []).forEach((g) => {
    if (g.readOnly) return
    ;(g.items || []).forEach((item) => {
      if (item.checked && item.key && !String(item.key).startsWith('_')) set[item.key] = true
    })
  })
  return Object.keys(set)
}
