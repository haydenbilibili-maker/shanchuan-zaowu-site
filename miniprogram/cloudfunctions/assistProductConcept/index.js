/**
 * 爆品概念生成（与 Admin ProductConceptGenerator 同源 prompt）
 * 环境变量：DASHSCOPE_API_KEY（与 assistProductCopy 共用）
 */
const cloud = require('wx-server-sdk')
const https = require('https')
const { assertStaff: _assertStaff, hasRole, STORED_ROLE_SPECIMEN_ARTISAN, STORED_ROLE_SUPER } = require('./staffGuard')

/**
 * 鉴权包装（2026-09-15 修复）：Admin Web 经 /api/cloud-fn 调用时，代理会把密钥注入
 * event.adminOpsKey，而 staffGuard 只比较 options.adminOpsKey —— 原实现从不透传，
 * 导致 ERP 调用本函数一律 NOT_LOGGED_IN。此处统一从 globalThis 取用。
 *
 * 注意：入口对 globalThis.__adminOpsKey 必须**无条件赋值**（无密钥时置空）。
 * 预热容器会跨请求复用 globalThis，若只在有密钥时赋值，上一个请求的超管身份
 * 会泄漏给下一个无密钥请求。
 */
function assertStaff(db, openid, options = {}) {
  const opts = { ...(options || {}) }
  if (opts.adminOpsKey == null) opts.adminOpsKey = globalThis.__adminOpsKey || ''
  return _assertStaff(db, openid, opts)
}

const {
  snapshotFromEvent,
  buildPrompt,
  normalizeConcept,
  typeMeta
} = require('./productConceptData')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const DASHSCOPE_HOST = 'dashscope.aliyuncs.com'
const TEXT_PATH = '/api/v1/services/aigc/text-generation/generation'
const REQUEST_TIMEOUT_MS = 45000
const MAX_ATTEMPTS = 2

function httpsPostJson(path, body, headers) {
  const data = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: DASHSCOPE_HOST,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...headers
        },
        timeout: REQUEST_TIMEOUT_MS
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => { raw += c })
        res.on('end', () => {
          try {
            const j = JSON.parse(raw)
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(j.message || j.msg || raw || `HTTP ${res.statusCode}`))
            } else {
              resolve(j)
            }
          } catch (e) {
            reject(new Error(raw || e.message))
          }
        })
      }
    )
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('TIMEOUT'))
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function parseJsonObject(text) {
  if (!text || typeof text !== 'string') return null
  const t = text.trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(t.slice(start, end + 1))
  } catch (e) {
    return null
  }
}

function extractTextGen(resp) {
  const out = resp && resp.output
  if (!out) return ''
  if (typeof out.text === 'string') return out.text
  const ch = out.choices && out.choices[0]
  if (ch && ch.message && typeof ch.message.content === 'string') return ch.message.content
  return ''
}

async function callQwenText(prompt, apiKey) {
  const body = {
    model: 'qwen-plus',
    input: { messages: [{ role: 'user', content: prompt }] },
    parameters: {
      result_format: 'message',
      temperature: 0.82,
      max_tokens: 1800
    }
  }
  const res = await httpsPostJson(TEXT_PATH, body, { Authorization: `Bearer ${apiKey}` })
  return extractTextGen(res)
}

function canUseConceptGenerator(actor) {
  if (!actor) return false
  if (hasRole(actor, STORED_ROLE_SUPER) || actor.superAdmin) return true
  if (hasRole(actor, STORED_ROLE_SPECIMEN_ARTISAN)) return true
  if (Array.isArray(actor.permissions) && actor.permissions.indexOf('manageProducts') !== -1) {
    return true
  }
  return false
}

function isConceptComplete(parsed) {
  return !!(parsed && String(parsed.name || '').trim() && String(parsed.price || '').trim())
}

function friendlyError(err) {
  const msg = String((err && err.message) || err || '')
  if (msg === 'TIMEOUT' || /timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(msg)) {
    return '生成超时，请稍后重试（或先用灵感骰子换一组条件）'
  }
  if (/ECONNRESET|ENOTFOUND|network/i.test(msg)) {
    return '网络异常，请检查后重试'
  }
  return msg || '概念生成失败'
}

async function generateOnce(snap, opts, apiKey) {
  const prompt = buildPrompt(snap, opts)
  const rawText = await callQwenText(prompt, apiKey)
  const parsed = parseJsonObject(rawText)
  if (!isConceptComplete(parsed)) {
    const err = new Error('INCOMPLETE')
    err.raw = rawText
    throw err
  }
  return normalizeConcept(parsed, {
    optionsSnapshot: snap,
    variantOf: opts.variantOfName || null
  })
}

exports.main = async (event) => {
  globalThis.__adminOpsKey = (event && event.adminOpsKey) || ''
  const wxContext = cloud.getWXContext()
  const operatorOpenid = wxContext.OPENID || wxContext.FROM_OPENID || ''
  const guard = await assertStaff(db, operatorOpenid, { permission: 'manageProducts' })
  if (!guard.ok) {
    return { success: false, code: guard.code, msg: guard.msg || '无权限' }
  }
  if (!canUseConceptGenerator(guard.actor)) {
    return { success: false, code: 'FORBIDDEN', msg: '概念生成仅标本师与藏品维护角色可用' }
  }

  const snap = snapshotFromEvent(event)
  if (!typeMeta(snap.productType)) {
    return { success: false, msg: '请先选择产品定位' }
  }

  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) {
    return {
      success: false,
      msg: '未配置 AI 密钥：请在云开发控制台 → 云函数 assistProductConcept → 环境变量中添加 DASHSCOPE_API_KEY'
    }
  }

  const variantOfName = String((event && event.variantOfName) || '').trim()
  const batchIndex =
    event && event.batchIndex != null && Number.isFinite(Number(event.batchIndex))
      ? Number(event.batchIndex)
      : null
  const opts = { variantOfName, batchIndex }

  let lastErr = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const concept = await generateOnce(snap, opts, apiKey)
      return { success: true, data: concept, attempts: attempt }
    } catch (e) {
      lastErr = e
      if (String(e.message) === 'INCOMPLETE' && attempt < MAX_ATTEMPTS) {
        console.warn('assistProductConcept incomplete, retry', attempt)
        continue
      }
      if (String(e.message) === 'TIMEOUT' && attempt < MAX_ATTEMPTS) {
        console.warn('assistProductConcept timeout, retry', attempt)
        continue
      }
      break
    }
  }

  if (lastErr && String(lastErr.message) === 'INCOMPLETE') {
    return { success: false, msg: 'AI 返回不完整，请重试一次' }
  }
  console.error('assistProductConcept error:', lastErr)
  return { success: false, msg: friendlyError(lastErr) }
}
