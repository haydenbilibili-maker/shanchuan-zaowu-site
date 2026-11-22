/**
 * 小程序 URL Link 生成（urllink.generate）—— 短信 / 邮件 / 微信外网页一键打开小程序
 *
 * 调用方：仅超管（staffGuard requireSuperAdmin）或携带 ADMIN_OPS_KEY 的内部调用
 *        （本地脚本 `miniprogram/scripts/generate-url-link.cjs` 经 `tcb fn invoke` 调用）。
 * 安全：落地页白名单 + query 字符集/长度校验；不写库，只返回链接。
 * 微信口径：URL Link 有效期最长 30 天、不再支持永久链接；过期后须重新生成。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { assertStaff } = require('./staffGuard')

const MAX_VALID_SECONDS = 30 * 24 * 3600

// 允许生成链接的落地页（须是线上版本已有的页面；新增前先确认已发布）
const ALLOWED_PAGES = {
  'pages/index/index': true, // 探索首页
  'subpackages/feature/detail/index': true, // 藏品详情（含「可领取」礼券抽屉）
  'subpackages/business/wallet-hub/index': true, // 钱包 / 礼券夹 / 积分
  'subpackages/extra/user/onboarding/index': true, // 新用户注册
  'subpackages/feature/gift/hub/index': true // 礼赠
}

// 微信文档：query 只允许数字、大小写英文与部分特殊字符，最长 1024
const QUERY_RE = /^[0-9a-zA-Z!#$&'()*+,/:;=?@\-._~%]*$/

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const db = cloud.database()
  const openid = wxContext.OPENID || ''
  const ev = event || {}

  const path = String(ev.path || '').replace(/^\/+/, '')
  const query = String(ev.query || '')
  const envVersion = ['release', 'trial', 'develop'].includes(ev.envVersion) ? ev.envVersion : 'release'

  if (!ALLOWED_PAGES[path]) {
    return { success: false, msg: '页面不在白名单：' + path }
  }
  if (query.length > 1024 || !QUERY_RE.test(query)) {
    return { success: false, msg: 'query 含不允许的字符或超过 1024 字符' }
  }

  const nowSec = Math.floor(Date.now() / 1000)
  let expireTime = Number(ev.expireTime) || 0
  if (!expireTime) expireTime = nowSec + MAX_VALID_SECONDS - 3600
  if (expireTime <= nowSec || expireTime > nowSec + MAX_VALID_SECONDS) {
    return { success: false, msg: 'expireTime 须在当前时间之后 30 天以内（秒级时间戳）' }
  }

  let guard
  try {
    guard = await assertStaff(db, openid, {
      requireSuperAdmin: true,
      adminOpsKey: String(ev.opsKey || '')
    })
  } catch (e) {
    console.error('generateUrlLink guard error', e && e.message)
    return { success: false, msg: '鉴权异常', detail: e && e.message }
  }
  if (!guard || !guard.ok) {
    return { success: false, msg: (guard && guard.msg) || '无权限：仅超管可生成链接' }
  }

  try {
    const res = await cloud.openapi.urllink.generate({
      path,
      query,
      envVersion,
      isExpire: true,
      expireType: 0,
      expireTime
    })
    const urlLink = (res && (res.urlLink || res.url_link)) || ''
    if (!urlLink) {
      return { success: false, msg: 'URL Link 生成失败：返回格式异常', errCode: res && res.errCode }
    }
    console.log('generateUrlLink ok', path, query, expireTime)
    return { success: true, urlLink, path, query, envVersion, expireTime }
  } catch (e) {
    console.error('generateUrlLink', e)
    return { success: false, msg: e.message || '生成失败', errCode: e.errCode }
  }
}
