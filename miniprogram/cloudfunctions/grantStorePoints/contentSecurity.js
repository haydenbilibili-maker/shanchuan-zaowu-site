/**
 * 内容安全检测（微信 openapi）— 各云函数副本，canonical 源为 submitCommunityPost/contentSecurity.js
 * 同步：node scripts/sync-content-security.js（新增接入函数后请重跑）
 *
 * 设计要点：
 * 1) 文本用 msgSecCheck，图片用 imgSecCheck，音视频用 mediaCheckAsync。
 * 2) **不再 fail-open**：检测报错时不允许直接放行。调用方按内容类型选择处置：
 *    - 有 pending/人工审核流程的（社区帖子、评价）→ 保持待审，绝不自动公开；
 *    - 直接公开展示的（昵称、礼笺、弹幕）→ 直接拒绝并提示用户重试。
 * 3) openapi 权限需在函数 config.json 的 permissions.openapi 中声明，
 *    例如 "security.msgSecCheck" / "security.imgSecCheck" / "security.mediaCheckAsync"。
 *    权限缺失会被识别为 openapiUnavailable，便于日志区分「权限没配」与「真的报错」。
 */
const cloud = require('wx-server-sdk')

const OPENAPI_HINT = /openapi|permission|unauthorized|api scope|not declared|invalid scope|-501007|scope/i

function isRiskyErrCode(code) {
  return Number(code) === 87014
}

function normalizeErr(e) {
  return String((e && (e.errMsg || e.message)) || e || '')
}

/**
 * 文本检测
 * @returns {{ok:boolean, skipped?:boolean, needReview?:boolean, reason?:string, suggest?:string, openapiUnavailable?:boolean, error?:string}}
 */
async function checkText(openid, content, scene = 4) {
  const text = String(content || '').trim()
  if (!text) return { ok: true, skipped: true }
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      openid,
      scene,
      version: 2,
      content: text.slice(0, 2500)
    })
    const suggest = (res && res.result && res.result.suggest) || ''
    if (suggest === 'risky') return { ok: false, reason: 'risky', suggest }
    if (suggest === 'review') return { ok: true, needReview: true, suggest }
    return { ok: true, suggest }
  } catch (e) {
    const error = normalizeErr(e)
    if (isRiskyErrCode(e && (e.errCode || e.errcode))) return { ok: false, reason: 'risky' }
    return {
      ok: false,
      reason: 'error',
      openapiUnavailable: OPENAPI_HINT.test(error),
      error
    }
  }
}

/** 从缓冲区猜测图片 content-type */
function guessImageContentType(buf) {
  const b = buf || Buffer.alloc(0)
  if (b.length > 3 && b[0] === 0x89 && b[1] === 0x50) return 'image/png'
  if (b.length > 3 && b[0] === 0x47 && b[1] === 0x49) return 'image/gif'
  if (b.length > 3 && b[0] === 0x52 && b[1] === 0x49) return 'image/webp'
  return 'image/jpeg'
}

/** imgSecCheck 单张限制 1MB */
const IMG_SEC_CHECK_MAX_BYTES = 1024 * 1024

/**
 * 图片缓冲区检测
 * @returns {{ok:boolean, skipped?:boolean, reason?:string, openapiUnavailable?:boolean, error?:string}}
 */
async function checkImageBuffer(buffer) {
  const b = buffer && buffer.length ? buffer : Buffer.alloc(0)
  if (!b.length) return { ok: true, skipped: true }
  if (b.length > IMG_SEC_CHECK_MAX_BYTES) {
    // 超过同步接口上限：交由调用方走人工审核，不算通过
    return { ok: false, reason: 'too_large' }
  }
  try {
    const res = await cloud.openapi.security.imgSecCheck({
      media: { contentType: guessImageContentType(b), value: b }
    })
    const errcode = res && (res.errCode != null ? res.errCode : res.errcode)
    if (isRiskyErrCode(errcode)) return { ok: false, reason: 'risky' }
    return { ok: true, errcode }
  } catch (e) {
    const error = normalizeErr(e)
    if (isRiskyErrCode(e && (e.errCode || e.errcode))) return { ok: false, reason: 'risky' }
    if (/87014/.test(error)) return { ok: false, reason: 'risky' }
    return {
      ok: false,
      reason: 'error',
      openapiUnavailable: OPENAPI_HINT.test(error),
      error
    }
  }
}

/** 下载 cloud:// 文件并做图片检测 */
async function checkFileImage(fileID) {
  const id = String(fileID || '').trim()
  if (!id) return { ok: true, skipped: true }
  if (!/^cloud:\/\//.test(id)) {
    // 非云存储（如 http(s) 外链）无法 downloadFile，交由调用方按人工审核处理
    return { ok: false, reason: 'not_cloud_file' }
  }
  try {
    const dl = await cloud.downloadFile({ fileID: id })
    return await checkImageBuffer(dl && dl.fileContent)
  } catch (e) {
    const error = normalizeErr(e)
    return {
      ok: false,
      reason: 'error',
      openapiUnavailable: OPENAPI_HINT.test(error),
      error
    }
  }
}

/**
 * 批量图片检测：全部通过才算通过；任一为违规 → risky。
 * 任一报错/超限 → 返回 notOk 且 reason 保留（调用方按 pending 处理）。
 */
async function checkFileImages(fileIDs, max = 9) {
  const list = (Array.isArray(fileIDs) ? fileIDs : []).filter(Boolean).slice(0, max)
  if (!list.length) return { ok: true, skipped: true, checked: 0 }
  for (const fileID of list) {
    const r = await checkFileImage(fileID)
    if (!r.ok) return { ...r, checked: true, failedFileID: fileID }
  }
  return { ok: true, checked: list.length }
}

/**
 * 音视频异步检测（mediaCheckAsync）。结果是异步推送，本函数只负责提交并返回 traceId。
 * 调用方应把内容保持 pending，直到人工或后续回调确认。
 */
async function submitMediaCheck(fileID, openid, mediaType = 2, scene = 4) {
  const id = String(fileID || '').trim()
  if (!id) return { ok: true, skipped: true }
  try {
    const urlRes = await cloud.getTempFileURL({ fileList: [id] })
    const url = urlRes && urlRes.fileList && urlRes.fileList[0] && urlRes.fileList[0].tempFileURL
    if (!url) return { ok: false, reason: 'no_temp_url' }
    const res = await cloud.openapi.security.mediaCheckAsync({
      media_url: url,
      media_type: mediaType,
      version: 2,
      openid,
      scene
    })
    return { ok: true, traceId: (res && res.trace_id) || '', submitted: true }
  } catch (e) {
    const error = normalizeErr(e)
    return {
      ok: false,
      reason: 'error',
      openapiUnavailable: OPENAPI_HINT.test(error),
      error
    }
  }
}

module.exports = {
  checkText,
  checkImageBuffer,
  checkFileImage,
  checkFileImages,
  submitMediaCheck,
  IMG_SEC_CHECK_MAX_BYTES
}
