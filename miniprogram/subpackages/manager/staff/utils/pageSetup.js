const { guardStaffPage } = require('../../utils/staffAuth')
const { getPreferredStoreId } = require('../../../../utils/storeHelper')
const { fetchStoreCatalog, mapStoreOptions } = require('../../../../utils/storeCatalog')
const { decodeQueryText } = require('../../utils/decodeQueryText')

function formatTime(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function statusTextAttendance(status) {
  if (status === 'on_time') return '准时'
  if (status === 'late') return '迟到'
  if (status === 'early') return '早退'
  if (status === 'leave') return '请假'
  return status || ''
}

function statusTextReimburse(status) {
  if (status === 'approved') return '已通过'
  if (status === 'rejected') return '已驳回'
  return '待审核'
}

function statusTextLeave(status) {
  if (status === 'approved') return '已通过'
  if (status === 'rejected') return '已驳回'
  if (status === 'cancelled') return '已撤销'
  return '待审批'
}

async function initStaffStores(minRole = 'staff') {
  const role = await guardStaffPage(minRole)
  if (!role) return null
  const catalog = await fetchStoreCatalog()
  const allowed = role.storeIds && role.storeIds.length
    ? catalog.filter((s) => role.storeIds.indexOf(s.storeId) !== -1)
    : catalog
  const source = allowed.length ? allowed : catalog
  const storeOptions = mapStoreOptions(source)
  const preferred = getPreferredStoreId()
  const found = storeOptions.findIndex((s) => s.storeId === preferred)
  const storeIndex = found >= 0 ? found : 0
  const cur = storeOptions[storeIndex] || {}
  return {
    role,
    storeOptions,
    storeNames: storeOptions.map((s) => s.name),
    storeIndex,
    storeId: cur.storeId || '',
    storeName: cur.name || '门店',
    roleText: role.isSuperAdmin ? '超管' : (role.isManager ? '店长' : '店员'),
    staffName: role.name || ''
  }
}

function applyStoreChange(page, index) {
  const store = page.data.storeOptions[index]
  if (!store) return
  page.setData({
    storeIndex: index,
    storeId: store.storeId,
    storeName: store.name
  })
}

/**
 * 从页面 query 解析门店：优先 storeId 并在 storeOptions 中取展示名；否则解码 storeName。
 * @param {Record<string, string>|undefined} options onLoad options
 * @param {{ storeId: string, storeName: string, storeIndex: number, storeOptions: { storeId: string, name: string }[] }} setup initStaffStores 返回值
 */
function resolveStoreFromQuery(options, setup) {
  const queryStoreId = decodeQueryText(options && options.storeId)
  const storeId = queryStoreId || setup.storeId
  const idx = setup.storeOptions.findIndex((s) => s.storeId === storeId)
  const matched = idx >= 0 ? setup.storeOptions[idx] : null
  let storeName = matched ? matched.name : setup.storeName
  if (!matched && options && options.storeName) {
    const decoded = decodeQueryText(options.storeName)
    if (decoded) storeName = decoded
  }
  return {
    storeId,
    storeName,
    storeIndex: idx >= 0 ? idx : setup.storeIndex
  }
}

module.exports = {
  formatTime,
  statusTextAttendance,
  statusTextReimburse,
  statusTextLeave,
  initStaffStores,
  applyStoreChange,
  resolveStoreFromQuery
}
