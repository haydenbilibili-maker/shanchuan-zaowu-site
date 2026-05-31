/**
 * 生成分享卡片云函数
 * 生成包含藏品信息的分享图片
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { productId, userId, shareType = 'product' } = event

  try {
    // 1. 获取商品信息
    const productRes = await db.collection('products').doc(productId).get()
    if (!productRes.data) {
      return {
        success: false,
        msg: '商品不存在'
      }
    }

    const product = productRes.data

    // 2. 获取小程序码（如果需要）
    // 注意：小程序码生成需要access_token，这里简化处理
    // 实际可以使用云函数调用微信API生成小程序码

    // 3. 返回分享数据（前端使用canvas生成图片）
    return {
      success: true,
      data: {
        product: {
          _id: product._id,
          title: product.title,
          latinName: product.latinName || '',
          price: product.price || 0,
          image: product.images && product.images.length > 0 ? product.images[0] : '',
          description: product.description || ''
        },
        shareText: generateShareText(product),
        qrCodeUrl: '', // 小程序码URL，需要单独生成
        timestamp: Date.now()
      }
    }
  } catch (e) {
    console.error('生成分享卡片失败:', e)
    return {
      success: false,
      msg: e.message
    }
  }
}

/**
 * 生成分享文案
 */
function generateShareText(product) {
  const t = product.title || '标本'
  const templates = [
    `在山海造物看到一件${t}，想分享给你看看。`,
    `${t} · 山海造物 · 把山海带回家`,
    `这件${t}来自山海造物，像朋友在窗边讲起山野里的事。`
  ]
  
  // 随机选择一个模板
  const template = templates[Math.floor(Math.random() * templates.length)]
  return template
}








