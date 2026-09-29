/**
 * aiIdentifyRetention —— AI 鉴定记录保留期清理（每日定时）
 *
 * 产品负责人 2026-09-29 拍板：鉴定记录保留 180 天，到期自动删除。
 *
 * 每次运行：取 created_at 早于「现在 − 180 天」的 ai_identify_logs，按批处理：
 *   1. 照片：只删鉴定目录（cloud://<桶>/identify/<文件名>）下、且已无人引用的文件；
 *      仍被用户自己的鉴定记录（identification_records.image_url，C 端「我的鉴定」/ 结果页在用）
 *      或 180 天内的日志引用的照片一律保留，避免删掉用户仍在看的图。
 *   2. 记录：先删文件、后删记录；文件删除失败（非「文件不存在」）的记录本轮保留，下轮重试，不留孤儿文件。
 *   单批 ≤ 50（与 deleteFile 单次上限一致），单次运行 ≤ 500 条。
 *
 * 触发：config.json triggers（每日 03:30）。只认「定时事件 + 非客户端来源」，客户端伪造 Type/TriggerName 一律拒绝。
 * 蓝图：miniprogram/docs/超管工作台_AI鉴定监测_2026-09-29.md
 */
const cloud = require('wx-server-sdk')
const { isNonClientSource } = require('./sourceOrigin')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const LOGS = 'ai_identify_logs'
const RECORDS = 'identification_records'
const RETENTION_DAYS = 180
const DAY_MS = 24 * 3600 * 1000
const BATCH_SIZE = 50
const MAX_PER_RUN = 500
const IDENTIFY_FILE_RE = /^cloud:\/\/[^/]+\/identify\/[A-Za-z0-9._-]+$/

function isTimerEvent(event) {
  const t = (event && (event.Type || event.triggerType || event.triggerSource)) || ''
  return /timer/i.test(String(t)) || !!(event && event.TriggerName)
}

function isIdentifyPhoto(fileId) {
  const s = String(fileId || '')
  return IDENTIFY_FILE_RE.test(s) && s.indexOf('..') === -1
}

function isMissingFile(f) {
  return /not.?exist|nonexist|no such/i.test(String((f && (f.errMsg || f.code)) || ''))
}

async function stillReferenced(fileIds, cutoff) {
  const kept = new Set()
  if (!fileIds.length) return kept
  const [recs, newer] = await Promise.all([
    db.collection(RECORDS).where({ image_url: _.in(fileIds) }).field({ image_url: true }).limit(100).get(),
    db.collection(LOGS).where({ image_file_id: _.in(fileIds), created_at: _.gte(cutoff) }).field({ image_file_id: true }).limit(100).get()
  ])
  ;(recs.data || []).forEach((r) => kept.add(r.image_url))
  ;(newer.data || []).forEach((l) => kept.add(l.image_file_id))
  return kept
}

async function purgeBatch(cutoff) {
  const res = await db
    .collection(LOGS)
    .where({ created_at: _.lt(cutoff) })
    .orderBy('created_at', 'asc')
    .limit(BATCH_SIZE)
    .field({ image_file_id: true })
    .get()
  const rows = res.data || []
  const out = { rows: rows.length, removed: 0, filesDeleted: 0, filesKept: 0, filesFailed: 0, outsidePrefix: 0 }
  if (!rows.length) return out

  out.outsidePrefix = rows.filter((r) => r.image_file_id && !isIdentifyPhoto(r.image_file_id)).length
  const candidates = [...new Set(rows.map((r) => r.image_file_id).filter(isIdentifyPhoto))]
  const kept = await stillReferenced(candidates, cutoff)
  const toDelete = candidates.filter((f) => !kept.has(f)).slice(0, BATCH_SIZE)
  out.filesKept = kept.size

  const failed = new Set()
  if (toDelete.length) {
    try {
      const d = await cloud.deleteFile({ fileList: toDelete })
      ;(d.fileList || []).forEach((f) => {
        if (f && f.status !== 0 && !isMissingFile(f)) failed.add(f.fileID)
      })
    } catch (e) {
      console.warn('deleteFile', e && e.message)
      toDelete.forEach((f) => failed.add(f))
    }
  }
  out.filesFailed = failed.size
  out.filesDeleted = toDelete.length - failed.size

  const ids = rows.filter((r) => !failed.has(r.image_file_id)).map((r) => r._id)
  if (ids.length) {
    await db.collection(LOGS).where({ _id: _.in(ids) }).remove()
    out.removed = ids.length
  }
  return out
}

exports.main = async (event = {}) => {
  if (!(isTimerEvent(event) && isNonClientSource())) {
    return { success: false, code: 'FORBIDDEN', msg: '仅允许定时触发' }
  }
  const cutoff = Date.now() - RETENTION_DAYS * DAY_MS
  const sum = { rows: 0, removed: 0, filesDeleted: 0, filesKept: 0, filesFailed: 0, outsidePrefix: 0 }
  while (sum.rows < MAX_PER_RUN) {
    const b = await purgeBatch(cutoff)
    Object.keys(sum).forEach((k) => { sum[k] += b[k] })
    if (!b.rows || !b.removed || b.rows < BATCH_SIZE) break
  }
  console.log('aiIdentifyRetention', JSON.stringify({ cutoff, ...sum }))
  return { success: true, cutoff, retentionDays: RETENTION_DAYS, ...sum }
}
