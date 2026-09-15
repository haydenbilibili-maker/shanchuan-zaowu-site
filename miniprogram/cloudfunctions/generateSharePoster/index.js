/**
 * 生成分享海报所需素材：小程序码 + 标本图临时链接 + 文案字段
 * 完整画面由小程序端 Canvas 合成（保证中文排版可靠）
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { record_id } = event

  if (!record_id) {
    return { success: false, msg: '缺少 record_id' }
  }

  try {
    let doc = null
    try {
      const rec = await db.collection('identification_records').doc(record_id).get()
      doc = rec && rec.data
    } catch (e) {
      return { success: false, code: 'RECORD_NOT_FOUND', msg: '记录不存在' }
    }
    if (!doc) {
      return { success: false, code: 'RECORD_NOT_FOUND', msg: '记录不存在' }
    }
    // 归属校验：必须本人记录。原实现仅在 doc._openid 存在时才比对，
    // 无归属字段的历史记录会被放行、并顺手写成 is_shared 转为公开
    if (!doc._openid || doc._openid !== wxContext.OPENID) {
      return { success: false, msg: '无权生成该记录海报' }
    }

    // 生成分享海报 = 用户主动公开该条鉴定（重试一次，避免好友扫码仍未公开）
    let sharedOk = false
    for (let i = 0; i < 2 && !sharedOk; i++) {
      try {
        await db.collection('identification_records').doc(record_id).update({
          data: { is_shared: true, shared_at: Date.now() }
        })
        sharedOk = true
      } catch (e) {
        console.warn('标记 is_shared 失败', i, e && e.message)
      }
    }
    if (!sharedOk) {
      return { success: false, msg: '公开鉴定失败，请稍后重试再分享' }
    }

    // 1. 小程序码（scene 最长 32，Mongo _id 通常为 24 位）
    const scene = String(record_id)
    if (scene.length > 32) {
      return { success: false, msg: 'record_id 过长，无法用于小程序码' }
    }

    const wxacodeRes = await cloud.openapi.wxacode.getUnlimited({
      scene,
      page: 'subpackages/feature/identify/result/index',
      width: 430,
      autoColor: false,
      lineColor: { r: 212, g: 175, b: 55 },
      isHyaline: true,
      checkPath: false,
      // 开发/体验版测试时，让二维码指向对应版本（默认正式版）
      envVersion: ['release', 'trial', 'develop'].includes(String(event.env_version || ''))
        ? String(event.env_version)
        : 'release'
    })

    let qrBuffer = null
    if (Buffer.isBuffer(wxacodeRes)) {
      qrBuffer = wxacodeRes
    } else if (wxacodeRes && Buffer.isBuffer(wxacodeRes.buffer)) {
      qrBuffer = wxacodeRes.buffer
    } else if (wxacodeRes && wxacodeRes.data && Buffer.isBuffer(wxacodeRes.data)) {
      qrBuffer = wxacodeRes.data
    } else if (wxacodeRes && wxacodeRes.body && Buffer.isBuffer(wxacodeRes.body)) {
      qrBuffer = wxacodeRes.body
    }
    if (!Buffer.isBuffer(qrBuffer)) {
      return { success: false, msg: '小程序码生成失败：返回格式异常' }
    }

    const qrPath = `poster-qr/${record_id}-${Date.now()}.png`
    const upQr = await cloud.uploadFile({
      cloudPath: qrPath,
      fileContent: qrBuffer
    })

    const qrUrlRes = await cloud.getTempFileURL({ fileList: [upQr.fileID] })
    const qrTempUrl = (qrUrlRes.fileList && qrUrlRes.fileList[0] && qrUrlRes.fileList[0].tempFileURL) || ''

    // 2. 标本图临时链接
    let specimenTempUrl = ''
    if (doc.image_url) {
      const imgRes = await cloud.getTempFileURL({ fileList: [doc.image_url] })
      specimenTempUrl =
        (imgRes.fileList && imgRes.fileList[0] && imgRes.fileList[0].tempFileURL) || ''
    }

    const si = doc.species_info || {}
    const ai = doc.ai_content || {}

    return {
      success: true,
      data: {
        qrFileID: upQr.fileID,
        qrTempUrl,
        specimenTempUrl,
        species_name_zh: si.species_name_zh || '',
        species_name_latin: si.species_name_latin || '',
        fun_fact: ai.fun_fact || '',
        brief: si.brief_description || '',
        protection_label: (doc.species_profile && doc.species_profile.shareProtection) || '',
        poster_title: '山海造物 · AI 标本鉴定',
        brand_sub: '把山川带回家',
        brand_en: "NATURE'S CREATIONS"
      }
    }
  } catch (e) {
    console.error('generateSharePoster', e)
    return {
      success: false,
      msg: e.message || '生成失败'
    }
  }
}
