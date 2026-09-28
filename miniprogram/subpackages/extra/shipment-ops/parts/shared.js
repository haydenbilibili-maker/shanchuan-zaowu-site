/**
 * 出货中心 · 三个分片（核心 / 开单 / 资料）共用的小工具。
 * 客户端不算钱：这里只有格式化，没有任何金额计算。
 */
const SHIPMENT_FN = 'manageStoreShipment'
const SETTLEMENT_FN = 'manageStudioSettlement'

function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data: data || {} }).then((res) => {
    const r = (res && res.result) || {}
    if (!r.success) {
      const err = new Error(r.msg || '操作失败')
      err.code = r.code
      err.result = r
      throw err
    }
    return r
  })
}

function money(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0'
  return v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

/** 分 → 两位小数元字符串 */
function yuan(cents) {
  const n = Number(cents)
  if (!Number.isFinite(n)) return '—'
  return (Math.round(n) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function todayStr() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 弹层 scroll-view 显式高度（px）：scroll-y 无确定高度会把底栏顶出屏外 */
function sheetBodyPx() {
  try {
    const sys = wx.getSystemInfoSync() || {}
    const winH = Number(sys.windowHeight) || 640
    const safeBottom = Number((sys.safeAreaInsets && sys.safeAreaInsets.bottom) || 0)
    // 弹层上限 86vh；头部 + 搜索 ≈ 110px；底部按钮区 ≈ 90px + 安全区
    return Math.max(220, Math.floor(winH * 0.86) - 110 - 90 - safeBottom)
  } catch (e) {
    return 420
  }
}

/** 明细行的原材料 / 包装摘要（有才显示；旧单为空串） */
function materialLine(it) {
  const row = it || {}
  const bits = []
  if (row.materialName) {
    const g = row.materialGrade && row.materialGrade !== '默认' ? `（${row.materialGrade}）` : ''
    bits.push(`原材料 ${row.materialName}${g}`)
  }
  if (row.packagingName) {
    const s = row.packagingSize && row.packagingSize !== '默认' ? ` ${row.packagingSize}` : ''
    bits.push(`包装 ${row.packagingName}${s}`)
  }
  return bits.join(' · ')
}

module.exports = {
  SHIPMENT_FN,
  SETTLEMENT_FN,
  callCloud,
  money,
  yuan,
  todayStr,
  sheetBodyPx,
  materialLine
}
