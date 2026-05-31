const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

/** 拼团功能已下线 */
exports.main = async () => ({
  success: false,
  msg: '拼团功能已关闭'
})
