/**
 * 云开发连通性自检（启动时调用，便于续费/换环境后排错）
 */
const { CLOUD_ENV } = require('../config/cloudEnv')

function formatCloudError(err) {
  if (!err) return '未知错误'
  const code = err.errCode != null ? err.errCode : err.code
  const msg = err.errMsg || err.message || String(err)
  if (code === -501000 || /env not found|INVALID_ENV|环境不存在/i.test(msg)) {
    return `云环境无效（当前配置：${CLOUD_ENV}），请在 app.js 对应 config/cloudEnv.js 中更新环境 ID`
  }
  if (/FUNCTION_NOT_FOUND|云函数不存在/i.test(msg)) {
    return '云函数未部署，请在开发者工具中右键 cloudfunctions 上传并部署'
  }
  if (/permission|权限|PERMISSION/i.test(msg)) {
    return '数据库或云存储权限不足，请在云开发控制台检查安全规则'
  }
  return msg.length > 80 ? msg.slice(0, 80) + '…' : msg
}

async function checkCloudHealth(options = {}) {
  const { probeDb = true } = options
  if (!wx.cloud) {
    return { ok: false, stage: 'init', message: '基础库不支持云能力' }
  }

  try {
    const loginRes = await wx.cloud.callFunction({ name: 'login', data: {} })
    if (!loginRes.result || !loginRes.result.openid) {
      return { ok: false, stage: 'login', message: 'login 云函数无有效返回，请检查是否已部署' }
    }
  } catch (e) {
    return { ok: false, stage: 'login', message: formatCloudError(e), raw: e }
  }

  if (!probeDb) {
    return { ok: true, stage: 'login' }
  }

  try {
    const db = wx.cloud.database()
    await db.collection('products').count()
    return { ok: true, stage: 'db' }
  } catch (e) {
    return { ok: false, stage: 'db', message: formatCloudError(e), raw: e }
  }
}

function notifyCloudHealthFailure(result) {
  if (!result || result.ok) return
  console.error('[cloudHealth]', result.stage, result.message, result.raw || '')
  wx.showToast({
    title: result.message || '云服务连接异常',
    icon: 'none',
    duration: 3500
  })
}

module.exports = {
  checkCloudHealth,
  notifyCloudHealthFailure,
  formatCloudError
}
