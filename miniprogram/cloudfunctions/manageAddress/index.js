const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function normalizeAddress(raw) {
  if (!raw) return null
  const region = Array.isArray(raw.region)
    ? raw.region.filter(Boolean)
    : [raw.provinceName, raw.cityName, raw.countyName].filter(Boolean)

  const name = (raw.name || raw.userName || '').trim()
  const phone = (raw.phone || raw.telNumber || '').trim()
  const detail = (raw.detail || raw.detailInfo || '').trim()

  if (!name || !phone) return null

  return {
    name,
    phone,
    region,
    detail,
    postalCode: raw.postalCode || raw.nationalCode || ''
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action, addressId, address, setAsDefault } = event

  if (!openid) {
    return { success: false, msg: '请先登录' }
  }

  const col = db.collection('user_addresses')

  try {
    switch (action) {
      case 'list': {
        const res = await col.where({ _openid: openid }).get()
        const list = (res.data || []).sort((a, b) => {
          if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
          const ta = a.createTime ? new Date(a.createTime).getTime() : 0
          const tb = b.createTime ? new Date(b.createTime).getTime() : 0
          return tb - ta
        })
        return { success: true, data: list }
      }

      case 'add': {
        const normalized = normalizeAddress(address)
        if (!normalized) {
          return { success: false, msg: '地址信息不完整' }
        }

        const existing = await col.where({ _openid: openid }).count()
        const isDefault = setAsDefault === true || existing.total === 0

        if (isDefault) {
          await col.where({ _openid: openid, isDefault: true }).update({
            data: { isDefault: false }
          })
        }

        await col.add({
          data: {
            ...normalized,
            _openid: openid,
            isDefault,
            createTime: db.serverDate()
          }
        })

        return { success: true, msg: '已保存' }
      }

      case 'setDefault': {
        if (!addressId) return { success: false, msg: '地址 ID 无效' }

        const doc = await col.doc(addressId).get()
        if (!doc.data || doc.data._openid !== openid) {
          return { success: false, msg: '地址不存在' }
        }

        await col.where({ _openid: openid, isDefault: true }).update({
          data: { isDefault: false }
        })
        await col.doc(addressId).update({ data: { isDefault: true } })
        return { success: true, msg: '已设为默认' }
      }

      case 'delete': {
        if (!addressId) return { success: false, msg: '地址 ID 无效' }

        const doc = await col.doc(addressId).get()
        if (!doc.data || doc.data._openid !== openid) {
          return { success: false, msg: '地址不存在' }
        }

        const wasDefault = doc.data.isDefault === true
        await col.doc(addressId).remove()

        if (wasDefault) {
          const rest = await col.where({ _openid: openid }).get()
          const sorted = (rest.data || []).sort((a, b) => {
            const ta = a.createTime ? new Date(a.createTime).getTime() : 0
            const tb = b.createTime ? new Date(b.createTime).getTime() : 0
            return tb - ta
          })
          if (sorted.length > 0) {
            await col.doc(sorted[0]._id).update({ data: { isDefault: true } })
          }
        }

        return { success: true, msg: '已删除' }
      }

      default:
        return { success: false, msg: '未知操作' }
    }
  } catch (err) {
    console.error('manageAddress error:', action, err)
    return { success: false, msg: err.message || '操作失败' }
  }
}
