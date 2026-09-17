/**
 * 各工作台可配置能力（与 cloudfunctions/manageStaff/staffGuard 权限点一致）
 * 超管在 staff-permissions 按人勾选；未显式保存时走角色默认并集。
 * 云侧副本：cloudfunctions/manageStaff/workspaceFeatures.js（修改时请两处一并更新）
 */

const WORKBENCH_SUPER = 'super_admin'
const WORKBENCH_MANAGER = 'manager'
const WORKBENCH_STAFF = 'staff'
const WORKBENCH_ARTISAN = 'specimen_artisan'
const WORKBENCH_LIVE = 'live_host'
const WORKBENCH_INVESTOR = 'investor'
const WORKBENCH_SHAREHOLDER = 'shareholder'

/** @typedef {{ key: string, label: string, hint?: string }} FeatureDef */

/** @type {Record<string, { title: string, en: string, readOnly?: boolean, features: FeatureDef[] }>} */
const WORKBENCH_CATALOG = {
  [WORKBENCH_SUPER]: {
    title: '超管工作台',
    en: 'SUPER',
    readOnly: true,
    features: [
      { key: '_super_full', label: '全集能力', hint: '含店长经营、标本师/主播模块及人员、内容开关、运费、积分规则、礼赠配置(manageGift)、数据与审计等超管专属配置' }
    ]
  },
  [WORKBENCH_MANAGER]: {
    title: '店长工作台',
    en: 'MANAGER',
    features: [
      { key: 'verifyMemberPass', label: '会员码核验' },
      { key: 'verifyBooking', label: '预约核销' },
      { key: 'verifyStoreCoupon', label: '门店礼券核销' },
      { key: 'verifyGiftPickup', label: '礼赠自提核销' },
      { key: 'verifyOrderPickup', label: '门店自取核销' },
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
  [WORKBENCH_STAFF]: {
    title: '店员工作台',
    en: 'STAFF',
    features: [
      { key: 'staffAttendance', label: '考勤打卡' },
      { key: 'storeTodo', label: '早晚门店清单' },
      { key: 'viewPayslip', label: '工资条查询' },
      { key: 'submitReimbursement', label: '报销申请' },
      { key: 'verifyMemberPass', label: '会员码核验（现场）' },
      { key: 'verifyBooking', label: '预约核销（现场）' },
      { key: 'verifyStoreCoupon', label: '门店礼券核销（现场）' },
      { key: 'verifyGiftPickup', label: '礼赠自提核销（现场）' },
      { key: 'verifyOrderPickup', label: '门店自取核销（现场）' },
      { key: 'grantStorePoints', label: '消费赠分（现场）' },
      { key: 'viewStoreVisits', label: '到店签到统计（现场）' },
      { key: 'viewOwnRecords', label: '本人操作记录' }
    ]
  },
  [WORKBENCH_ARTISAN]: {
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
  [WORKBENCH_LIVE]: {
    title: '主播工作台',
    en: 'LIVE HOST',
    features: [
      { key: 'manageLive', label: '直播场次 / 开播 / 挂车 / 公告' },
      { key: 'viewPayslip', label: '工资条查询' },
      { key: 'staffAttendance', label: '考勤打卡 / 请假' }
    ]
  },
  [WORKBENCH_INVESTOR]: {
    title: '投资观测台',
    en: 'OBSERVATORY',
    features: [
      { key: 'viewInvestorFinance', label: '财务汇总（只读）', hint: '月净额、日均、渠道占比；无记一笔/删账/对账' },
      { key: 'viewInvestorAnalytics', label: '小程序数据大盘（只读）', hint: '新增/DAU/留存、GMV、库存概况；无 CRM/改价/发货' }
    ]
  },
  [WORKBENCH_SHAREHOLDER]: {
    title: '股东观测台',
    en: 'SHAREHOLDER OBSERVATORY',
    features: [
      {
        key: 'viewShareholderObservatory',
        label: '股东权益与分红（只读）',
        hint: '按绑定门店与占股/回本前·后分成比例查看回本进度、应得分成、月度经营与汇报摘要'
      }
    ]
  }
}

const ROLE_TO_WORKBENCH = {
  super_admin: WORKBENCH_SUPER,
  manager: WORKBENCH_MANAGER,
  staff: WORKBENCH_STAFF,
  specimen_artisan: WORKBENCH_ARTISAN,
  live_host: WORKBENCH_LIVE,
  investor: WORKBENCH_INVESTOR,
  shareholder: WORKBENCH_SHAREHOLDER
}

function featureKeysForRoles(roles) {
  const keys = {}
  ;(roles || []).forEach((r) => {
    const wb = ROLE_TO_WORKBENCH[r]
    const cat = wb && WORKBENCH_CATALOG[wb]
    if (!cat || cat.readOnly) return
    ;(cat.features || []).forEach((f) => {
      if (f.key && f.key.indexOf('_') !== 0) keys[f.key] = true
    })
  })
  return Object.keys(keys)
}

/**
 * @param {string[]} roles stored roles
 * @param {string[]} selectedPermissions current checked keys
 */
function buildWorkbenchFeatureUI(roles, selectedPermissions) {
  const selected = {}
  ;(selectedPermissions || []).forEach((k) => { if (k) selected[k] = true })
  const groups = []
  const order = ['super_admin', 'manager', 'staff', 'specimen_artisan', 'live_host', 'investor', 'shareholder']
  order.forEach((roleKey) => {
    if ((roles || []).indexOf(roleKey) === -1) return
    const wb = ROLE_TO_WORKBENCH[roleKey]
    const cat = WORKBENCH_CATALOG[wb]
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
    const items = (cat.features || []).map((f) => ({
      key: f.key,
      label: f.label,
      hint: f.hint || '',
      checked: !!selected[f.key],
      disabled: false
    }))
    groups.push({
      roleKey,
      title: cat.title,
      en: cat.en,
      readOnly: false,
      items
    })
  })
  return groups
}

function permissionsFromFeatureGroups(groups) {
  const set = {}
  ;(groups || []).forEach((g) => {
    if (g.readOnly) return
    ;(g.items || []).forEach((item) => {
      if (item.checked && item.key && item.key.indexOf('_') !== 0) set[item.key] = true
    })
  })
  return Object.keys(set)
}

module.exports = {
  WORKBENCH_CATALOG,
  WORKBENCH_SUPER,
  WORKBENCH_MANAGER,
  WORKBENCH_STAFF,
  WORKBENCH_ARTISAN,
  WORKBENCH_LIVE,
  WORKBENCH_INVESTOR,
  WORKBENCH_SHAREHOLDER,
  featureKeysForRoles,
  buildWorkbenchFeatureUI,
  permissionsFromFeatureGroups
}
