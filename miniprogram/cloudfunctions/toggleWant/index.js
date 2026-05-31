// cloudfunctions/toggleWant/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { productId, collection } = event
  // 默认操作 products，如果传了 wiki 则操作 wiki
  const targetCollection = collection || 'products'
  
  try {
    await db.collection(targetCollection).doc(productId).update({
      data: {
        wantCount: _.inc(1)
      }
    })
    return { success: true }
  } catch (err) {
    return { success: false, msg: err }
  }
}