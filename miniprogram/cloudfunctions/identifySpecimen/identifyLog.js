/**
 * AI 鉴定调用日志（旁路）：每次鉴定调用写一条 ai_identify_logs，供超管「AI 鉴定监测」查看。
 *
 * 不变量：写日志**绝不影响**鉴定出参 —— 组装抛错、写库失败、写库挂起（超过 LOG_WRITE_TIMEOUT_MS）
 * 一律吞掉；调用方拿到的返回值与未接日志前逐字相同。
 * 蓝图：miniprogram/docs/超管工作台_AI鉴定监测_2026-09-29.md
 */
const LOG_COLLECTION = 'ai_identify_logs'
const LOG_WRITE_TIMEOUT_MS = 1500

const { visionModels, textModels } = require('./aiModels')

/** index.js 里走独立分支的 action；不在此列的调用都会落到鉴定分支（与原函数判定同口径） */
const NON_IDENTIFY_ACTIONS = [
  'backfill_species_dedup',
  'list_recent',
  'get_record',
  'mark_shared',
  'save_atlas',
  'submit_feedback',
  'get_species_profile'
]

function isIdentifyCall(event) {
  const action = event && event.action
  return !action || NON_IDENTIFY_ACTIONS.indexOf(action) === -1
}

function beijingDay(ts) {
  return new Date(ts + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

function clip(s, n) {
  return String(s == null ? '' : s).slice(0, n)
}

function pickProducts(list) {
  return (Array.isArray(list) ? list : []).slice(0, 6).map((p) => ({
    _id: clip(p && p._id, 64),
    title: clip(p && p.title, 80),
    price: Number(p && p.price) || 0,
    cover: clip(p && p.cover, 500)
  }))
}

/**
 * @param {object} event   原始入参
 * @param {object|null} result 原函数返回值（抛错时为 null）
 * @param {object} meta    { openid, startedAt, finishedAt, error }
 */
function buildIdentifyLog(event, result, meta) {
  const ev = event || {}
  const res = result && typeof result === 'object' ? result : {}
  const data = res.success && res.data && typeof res.data === 'object' ? res.data : null
  const species = (data && data.species_info) || {}
  const success = res.success === true
  const reused = !!(data && data.from_cache)
  const mock = ev.use_mock === true
  let errorMsg = ''
  if (meta.error) errorMsg = (meta.error && meta.error.message) || String(meta.error)
  else if (!success) errorMsg = res.msg || '识别失败'
  const created = meta.finishedAt
  const trace = meta.trace || {}
  return {
    openid: clip(meta.openid, 64),
    image_file_id: clip(ev.image_file_id, 500),
    status: success ? (reused ? 'reused' : 'success') : 'failed',
    success,
    error_msg: clip(errorMsg, 300),
    record_id: clip(data && data.record_id, 64),
    reuse_reason: reused ? (data.reuse_reason === 'same_species' ? 'same_species' : 'same_image') : '',
    species_name_zh: clip(species.species_name_zh, 80),
    species_name_latin: clip(species.species_name_latin, 120),
    confidence: typeof species.confidence === 'number' ? species.confidence : null,
    confidence_level: clip(data && data.confidence_level, 20),
    is_specimen: species.is_specimen !== false,
    species_info: data ? data.species_info || null : null,
    ai_content: data ? data.ai_content || null : null,
    related_products: pickProducts(data && data.related_products),
    // 实际成功的模型；没走到 / 全部失败时记首选，便于从日志看出卡在哪个模型
    model: mock ? 'mock' : clip(trace.visionModel || visionModels()[0], 60),
    text_model: mock ? 'mock' : clip(trace.textModel || textModels()[0], 60),
    duration_ms: Math.max(0, created - meta.startedAt),
    entry_source: clip(ev.entry_source, 40),
    category_hint: clip(ev.category_hint, 20),
    created_at: created,
    day: beijingDay(created),
    source: 'live'
  }
}

async function writeIdentifyLog(db, event, result, meta) {
  let timer = null
  try {
    const doc = buildIdentifyLog(event, result, meta)
    const write = Promise.resolve()
      .then(() => db.collection(LOG_COLLECTION).add({ data: doc }))
      .catch((e) => console.warn('[identifyLog] 写入失败', e && e.message))
    const timeout = new Promise((resolve) => {
      timer = setTimeout(resolve, LOG_WRITE_TIMEOUT_MS)
    })
    await Promise.race([write, timeout])
  } catch (e) {
    console.warn('[identifyLog] 组装失败', e && e.message)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

module.exports = {
  LOG_COLLECTION,
  LOG_WRITE_TIMEOUT_MS,
  NON_IDENTIFY_ACTIONS,
  isIdentifyCall,
  buildIdentifyLog,
  writeIdentifyLog
}
