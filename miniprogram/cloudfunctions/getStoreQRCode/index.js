/**
 * 门店 / 运营物料小程序码生成（wxacode.getUnlimited）
 *
 * 用途：门店立牌、宣传物料扫码直达指定页面（如 AI 识别主页，新用户转化）。
 * 调用方：仅超管（staffGuard requireSuperAdmin）或携带 ADMIN_OPS_KEY 的内部调用
 *        （ERP 代理 / CloudBase CLI 部署脚本）。
 * 安全：页面白名单 + scene 长度上限；生成结果落云存储一份（store-qr/）+ 返回 base64。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { assertStaff } = require('./staffGuard')

const DEFAULT_WIDTH = 430
const BRAND_BRASS = { r: 196, g: 167, b: 108 } // #C4A76C

// 允许生成码的页面白名单（新增页面须先在此登记）
const ALLOWED_PAGES = {
  'subpackages/feature/identify/index': true, // AI 识别主页（门店新客转化）
  'subpackages/business/store/index': true, // 这有店门店页
  'pages/index/index': true // 探索首页
}

function pickQrBuffer(res) {
  if (Buffer.isBuffer(res)) return res
  if (res && Buffer.isBuffer(res.buffer)) return res.buffer
  if (res && res.data && Buffer.isBuffer(res.data)) return res.data
  if (res && res.body && Buffer.isBuffer(res.body)) return res.body
  return null
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const db = cloud.database()
  const openid = wxContext.OPENID || ''

  const page = String((event && event.page) || 'subpackages/feature/identify/index')
  const scene = String((event && event.scene) || '').trim().slice(0, 32)
  const envVersion = ['release', 'trial', 'develop'].includes(event && event.envVersion)
    ? event.envVersion
    : 'release'
  const width = Math.min(Math.max(Number(event && event.width) || DEFAULT_WIDTH, 280), 1280)
  const hyaline = !(event && event.hyaline === false)

  if (!ALLOWED_PAGES[page]) {
    return { success: false, msg: '页面不在白名单：' + page }
  }
  if (!scene) {
    return { success: false, msg: '缺少 scene' }
  }

  // 鉴权：仅超管或内部密钥
  let guard
  try {
    guard = await assertStaff(db, openid, {
      requireSuperAdmin: true,
      adminOpsKey: String((event && event.opsKey) || '')
    })
  } catch (e) {
    console.error('getStoreQRCode guard error', e && e.message)
    return { success: false, msg: '鉴权异常', detail: e && e.message }
  }
  if (!guard || !guard.ok) {
    return { success: false, msg: (guard && guard.msg) || '无权限：仅超管可生成门店码' }
  }

  try {
    const wxacodeRes = await cloud.openapi.wxacode.getUnlimited({
      scene,
      page,
      width,
      autoColor: false,
      lineColor: BRAND_BRASS,
      isHyaline: hyaline,
      checkPath: false,
      envVersion
    })

    const qrBuffer = pickQrBuffer(wxacodeRes)
    if (!qrBuffer) {
      return { success: false, msg: '小程序码生成失败：返回格式异常' }
    }

    // 落云存储备查（防丢 / 工作台后续下载），同时返回 base64 供 CLI 直接落盘
    let fileID = ''
    try {
      const safeScene = scene.replace(/[^0-9a-zA-Z_.=\-]/g, '_')
      const safePage = (page.split('/').pop() || 'page').replace(/[^0-9a-zA-Z_.\-]/g, '_')
      const up = await cloud.uploadFile({
        cloudPath: `store-qr/${safePage}-${safeScene}-${Date.now()}.png`,
        fileContent: qrBuffer
      })
      fileID = up.fileID || ''
    } catch (e) {
      console.warn('getStoreQRCode upload failed', e && e.message)
    }

    return {
      success: true,
      page,
      scene,
      envVersion,
      width,
      fileID,
      base64: qrBuffer.toString('base64')
    }
  } catch (e) {
    console.error('getStoreQRCode', e)
    return { success: false, msg: e.message || '生成失败' }
  }
}
