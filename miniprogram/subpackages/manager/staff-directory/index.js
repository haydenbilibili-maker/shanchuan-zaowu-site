/**
 * 员工 — 聚合 staff_members（与权限中心同源）
 * 列表 / 角色筛选 / 启停；改角色·门店跳转权限配置
 */
const { guardStaffPage, clearStaffRoleCache, STAFF_PERMISSIONS_PATH } = require('../utils/staffAuth')
const { formatCloudFnError } = require('../utils/memberScan')
const { fetchStoreCatalog, mapStoreOptions } = require('../../../utils/storeCatalog')

const ROLE_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'staff', label: '店员' },
  { key: 'manager', label: '店长' },
  { key: 'specimen_artisan', label: '标本师' },
  { key: 'investor', label: '投资人' },
  { key: 'shareholder', label: '股东' },
  { key: 'super_admin', label: '超管' }
]

const STATUS_FILTERS = [
  { key: 'all', label: '全部状态' },
  { key: 'active', label: '生效' },
  { key: 'disabled', label: '停用' }
]

function rolesNeedStoreScope(roles) {
  const list = Array.isArray(roles) ? roles : []
  return list.indexOf('staff') !== -1 || list.indexOf('manager') !== -1
}

function storeTextForRow(row, storeNameMap) {
  if (!rolesNeedStoreScope(Array.isArray(row.roles) && row.roles.length ? row.roles : [row.role])) {
    return ''
  }
  const ids = Array.isArray(row.storeIds) ? row.storeIds.filter(Boolean) : []
  if (!ids.length) return '全部门店'
  const names = ids.map((id) => storeNameMap[id] || id)
  if (names.length <= 2) return names.join(' · ')
  return `${names.slice(0, 2).join(' · ')} 等${names.length}家`
}

Page({
  data: {
    ready: false,
    loading: false,
    roleFilters: ROLE_FILTERS,
    statusFilters: STATUS_FILTERS,
    roleFilter: 'all',
    statusFilter: 'all',
    staffAll: [],
    staffList: [],
    counts: {
      all: 0,
      active: 0,
      disabled: 0
    },
    emptyHint: '暂无员工记录'
  },

  async onLoad() {
    const role = await guardStaffPage('super_admin')
    if (!role) return

    const catalog = await fetchStoreCatalog()
    const options = mapStoreOptions(catalog)
    const storeNameMap = {}
    ;(options || []).forEach((s) => {
      if (s && s.storeId) storeNameMap[s.storeId] = s.name || s.storeId
    })
    this._storeNameMap = storeNameMap
    this.setData({ ready: true })
    this.loadStaff()
  },

  onShow() {
    if (this.data.ready) this.loadStaff()
  },

  onPullDownRefresh() {
    this.loadStaff().finally(() => wx.stopPullDownRefresh())
  },

  async loadStaff() {
    if (this._loading) return
    this._loading = true
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageStaff',
        data: { action: 'list', status: 'all' }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        this.setData({
          staffAll: [],
          staffList: [],
          counts: { all: 0, active: 0, disabled: 0 },
          emptyHint: result.msg || '加载失败'
        })
        if (result.msg) {
          wx.showToast({ title: formatCloudFnError(result, result.msg), icon: 'none' })
        }
        return
      }
      const storeNameMap = this._storeNameMap || {}
      const staffAll = (result.list || []).map((row) => {
        const roles = Array.isArray(row.roles) && row.roles.length ? row.roles : [row.role]
        return {
          ...row,
          roles,
          showStoreScope: rolesNeedStoreScope(roles),
          storeText: storeTextForRow(row, storeNameMap),
          phoneText: row.phoneMasked || '未绑定手机'
        }
      })
      const active = staffAll.filter((r) => r.status === 'active').length
      this.setData({
        staffAll,
        counts: {
          all: staffAll.length,
          active,
          disabled: staffAll.length - active
        }
      })
      this.applyFilters()
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e, '员工列表加载失败'), icon: 'none' })
    } finally {
      this._loading = false
      this.setData({ loading: false })
    }
  },

  applyFilters() {
    const roleFilter = this.data.roleFilter || 'all'
    const statusFilter = this.data.statusFilter || 'all'
    let list = (this.data.staffAll || []).slice()
    if (statusFilter === 'active' || statusFilter === 'disabled') {
      list = list.filter((row) => row.status === statusFilter)
    }
    if (roleFilter && roleFilter !== 'all') {
      list = list.filter((row) => {
        const roles = Array.isArray(row.roles) ? row.roles : [row.role]
        if (roles.indexOf(roleFilter) !== -1) return true
        return roleFilter === 'super_admin' && !!row.isSuperAdmin
      })
    }
    const emptyHint =
      !(this.data.staffAll || []).length
        ? '还没有登记员工，可在权限配置中开通'
        : '当前筛选下暂无人员'
    this.setData({ staffList: list, emptyHint })
  },

  onRoleFilterTap(e) {
    const key = String((e.currentTarget.dataset && e.currentTarget.dataset.key) || 'all')
    if (key === this.data.roleFilter) return
    this.setData({ roleFilter: key }, () => this.applyFilters())
  },

  onStatusFilterTap(e) {
    const key = String((e.currentTarget.dataset && e.currentTarget.dataset.key) || 'all')
    if (key === this.data.statusFilter) return
    this.setData({ statusFilter: key }, () => this.applyFilters())
  },

  goPermissions() {
    wx.navigateTo({
      url: STAFF_PERMISSIONS_PATH,
      fail: () => wx.showToast({ title: '权限配置暂不可用', icon: 'none' })
    })
  },

  goEditPermissions() {
    wx.navigateTo({
      url: STAFF_PERMISSIONS_PATH,
      fail: () => wx.showToast({ title: '权限配置暂不可用', icon: 'none' })
    })
  },

  disableStaff(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.showModal({
      title: '停用员工',
      content: '停用后该账号将无法进入门店后台，可再次启用。',
      confirmColor: '#D64045',
      success: async (res) => {
        if (!res.confirm) return
        try {
          const call = await wx.cloud.callFunction({
            name: 'manageStaff',
            data: { action: 'remove', staffId: id }
          })
          const result = (call && call.result) || {}
          wx.showToast({
            title: result.success
              ? (result.msg || '已停用')
              : formatCloudFnError(result, result.msg || '停用失败'),
            icon: 'none'
          })
          clearStaffRoleCache()
          this.loadStaff()
        } catch (err) {
          wx.showToast({ title: formatCloudFnError(err, '停用失败'), icon: 'none' })
        }
      }
    })
  },

  enableStaff(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim()
    if (!id) return
    const item = (this.data.staffAll || []).find((row) => row._id === id)
    if (!item || !item.openid) {
      wx.showToast({ title: '账号信息缺失', icon: 'none' })
      return
    }
    wx.showModal({
      title: '恢复生效',
      content: `确认恢复「${item.name || '未命名'} · ${item.roleText || ''}」？`,
      confirmColor: '#52B788',
      success: async (res) => {
        if (!res.confirm) return
        try {
          const roles = Array.isArray(item.roles) && item.roles.length
            ? item.roles
            : [item.role || 'staff']
          const showStoreScope = rolesNeedStoreScope(roles)
          const enablePayload = {
            action: 'upsert',
            openid: item.openid,
            name: item.name || '',
            staffNo: item.staffNo || '',
            roles,
            role: item.role || 'staff',
            permissions: Array.isArray(item.permissions) ? item.permissions : undefined,
            permissionsExplicit: !!item.permissionsExplicit,
            status: 'active'
          }
          if (showStoreScope) {
            enablePayload.storeIds = Array.isArray(item.storeIds) ? item.storeIds : []
            enablePayload.dailyGrantCap = Number(item.dailyGrantCap) || 0
          }
          if (item.shareholderProfile) {
            enablePayload.shareholderProfile = item.shareholderProfile
          }
          const call = await wx.cloud.callFunction({ name: 'manageStaff', data: enablePayload })
          const result = (call && call.result) || {}
          wx.showToast({
            title: result.success
              ? (result.msg || '已启用')
              : formatCloudFnError(result, result.msg || '启用失败'),
            icon: 'none'
          })
          clearStaffRoleCache()
          this.loadStaff()
        } catch (err) {
          wx.showToast({ title: formatCloudFnError(err, '启用失败'), icon: 'none' })
        }
      }
    })
  }
})
