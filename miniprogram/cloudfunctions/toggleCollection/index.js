// cloudfunctions/toggleCollection/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { targetId, type, snapshot, skuId, skuLabel, action } = event
  const normalizedSkuId = skuId || ''
  const recordType = type || 'product'

  try {
    const check = await db.collection('collections').where({
      _openid: openid,
      productId: targetId,
      skuId: normalizedSkuId,
      type: recordType
    }).get()

    if (action === 'add' || (!action && check.data.length === 0)) {
      const addCount = Math.max(1, parseInt(snapshot && snapshot.count, 10) || 1)
      if (check.data.length > 0) {
        const existing = check.data[0]
        const newCount = (parseInt(existing.count, 10) || 1) + addCount
        await db.collection('collections').doc(existing._id).update({
          data: {
            count: newCount,
            price: snapshot && snapshot.price != null ? snapshot.price : existing.price,
            title: (snapshot && snapshot.title) || existing.title,
            image: (snapshot && snapshot.image) || existing.image,
            skuLabel: skuLabel || (snapshot && snapshot.skuLabel) || existing.skuLabel || '',
            updateTime: db.serverDate()
          }
        })
        return { success: true, action: 'merged', msg: '已更新数量', count: newCount }
      }
      await db.collection('collections').add({
        data: {
          _openid: openid,
          productId: targetId,
          skuId: normalizedSkuId,
          skuLabel: skuLabel || (snapshot && snapshot.skuLabel) || '',
          type: recordType,
          title: snapshot.title,
          image: snapshot.image,
          price: snapshot.price,
          latinName: snapshot.latinName,
          count: addCount,
          createTime: db.serverDate()
        }
      })
      return { success: true, action: 'added', msg: recordType === 'wishlist' ? '已收藏' : '已加入购物车' }
    }

    if (check.data.length > 0) {
      await db.collection('collections').doc(check.data[0]._id).remove()
      return { success: true, action: 'removed', msg: '已移出购物车' }
    }

    return { success: true, action: 'none', msg: '未找到记录' }
  } catch (e) {
    console.error(e)
    return { success: false, msg: '操作失败' }
  }
}
