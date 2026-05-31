const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

/** 秒杀功能已下线 */
exports.main = async () => ({
  success: false,
  msg: '限时秒杀功能已关闭'
})
