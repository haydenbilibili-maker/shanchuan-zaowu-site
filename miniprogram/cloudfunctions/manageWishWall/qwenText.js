/**
 * 需求 28：DashScope(Qwen) 文本生成调用
 *
 * 单独成文件的原因：`index.js` 里要能被测试整块替换掉（测试不该发真实网络请求）。
 * 与 `assistYouxinCopy` / `assistProductCopy` 同一惯例（同 host、同 path、同鉴权方式）——
 * 不同之处只是这里**只回文本**，不解析业务 JSON。
 *
 * 云函数之间不能跨目录 require，故此处保留一份本函数专用实现，
 * 但不再引入 https 之外的东西（`wx-server-sdk` 只用于 openapi，与本模块无关）。
 */
const https = require('https')

const DASHSCOPE_HOST = 'dashscope.aliyuncs.com'
const TEXT_PATH = '/api/v1/services/aigc/text-generation/generation'
const DEFAULT_MODEL = 'qwen-plus'

function httpsPostJson(path, body, headers, timeoutMs) {
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
        timeout: timeoutMs || 20000
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
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy(new Error('AI 请求超时'))
    })
    req.write(data)
    req.end()
  })
}

/** 兼容两种返回形态：老版 `output.text` 与新版 `output.choices[0].message.content` */
function extractTextGen(resp) {
  const out = resp && resp.output
  if (!out) return ''
  if (typeof out.text === 'string') return out.text
  const ch = out.choices && out.choices[0]
  if (ch && ch.message && typeof ch.message.content === 'string') return ch.message.content
  return ''
}

/**
 * @param {string} prompt
 * @param {string} apiKey
 * @param {{temperature?:number, model?:string, timeoutMs?:number}} [opts]
 * @returns {Promise<string>}
 */
async function callQwenText(prompt, apiKey, opts) {
  const o = opts || {}
  const body = {
    model: o.model || DEFAULT_MODEL,
    input: { messages: [{ role: 'user', content: String(prompt || '') }] },
    parameters: { result_format: 'message', temperature: typeof o.temperature === 'number' ? o.temperature : 0.85 }
  }
  const res = await httpsPostJson(TEXT_PATH, body, { Authorization: `Bearer ${apiKey}` }, o.timeoutMs)
  return extractTextGen(res)
}

module.exports = { callQwenText, httpsPostJson, extractTextGen, DEFAULT_MODEL }
