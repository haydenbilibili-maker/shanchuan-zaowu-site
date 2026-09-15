/**
 * 山海有信 — 召回/转化站内信 AI 文案（超管）
 * 环境变量：DASHSCOPE_API_KEY（与 assistProductCopy 共用）
 */
const cloud = require('wx-server-sdk')
const https = require('https')
const { assertStaff } = require('./staffGuard')
const { SEGMENTS } = require('./segmentation')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const DASHSCOPE_HOST = 'dashscope.aliyuncs.com'
const TEXT_PATH = '/api/v1/services/aigc/text-generation/generation'

const EMOJI_LEAD = /^[\u{1F300}-\u{1FAFF}\u2600-\u27BF\uFE0F\u200D\s]+/u

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
        }
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
    parameters: { result_format: 'message', temperature: 0.35 }
  }
  const res = await httpsPostJson(TEXT_PATH, body, { Authorization: `Bearer ${apiKey}` })
  return extractTextGen(res)
}

function campaignLabel(type) {
  if (type === 'recall') return '召回唤醒'
  if (type === 'conversion') return '转化关怀'
  return '运营通知'
}

function buildPrompt({ campaignType, segment, offerHint, portraitHint }) {
  const segMeta = SEGMENTS[segment] || { name: segment || '会员', desc: '' }
  const hint = offerHint ? `\n【可选权益/商品提示】${offerHint}` : ''
  const portrait = portraitHint ? `\n【会员画像摘要（勿复述手机号/openid）】${portraitHint}` : ''
  return `你是「山海造物 Nature's Creations」会员沟通文案助手。品牌调性：朋友式分享，克制、具体、有感官细节；禁止浮夸推销、禁止 emoji、禁止直播电商话术（如「家人们」「秒杀」「冲鸭」）。

【任务类型】${campaignLabel(campaignType)}
【RFM 分群】${segMeta.name} — ${segMeta.desc || ''}${hint}${portrait}

输出 JSON，字段：
- title：站内信标题，8–22 字，不含 emoji，不用感叹号堆叠
- content：正文 40–180 字，一段即可，可提及门店/养护/馆藏，但不编造具体订单或金额

仅输出 JSON：{"title":"","content":""}`
}

function sanitizeCopy(title, content) {
  let t = String(title || '').trim().replace(/\s+/g, ' ')
  let c = String(content || '').trim().replace(/\s+/g, ' ')
  t = t.replace(EMOJI_LEAD, '').replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
  c = c.replace(EMOJI_LEAD, '').replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
  if (/家人们|秒杀|冲鸭|下单立减|限时疯抢/.test(t + c)) {
    return { ok: false, msg: '文案含直播话术，请重试' }
  }
  if (!t || t.length > 30) return { ok: false, msg: '标题无效' }
  if (!c || c.length > 200) return { ok: false, msg: '正文无效或过长' }
  return { ok: true, title: t, content: c }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const operatorOpenid = wxContext.OPENID

  const guard = await assertStaff(db, operatorOpenid, {
    requireSuperAdmin: true,
    permission: 'pushMessage'
  })
  if (!guard.ok) {
    return { success: false, code: guard.code, msg: guard.msg }
  }

  const campaignType = String((event && event.campaignType) || 'general').trim()
  const segment = String((event && event.segment) || '').trim()
  const offerHint = String((event && event.offerHint) || '').trim().slice(0, 120)
  const portraitHint = String((event && event.portraitHint) || '').trim().slice(0, 200)

  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) {
    return {
      success: false,
      msg: '未配置 AI 密钥：请在云开发控制台为 assistYouxinCopy 配置 DASHSCOPE_API_KEY'
    }
  }

  try {
    const raw = await callQwenText(
      buildPrompt({ campaignType, segment, offerHint, portraitHint }),
      apiKey
    )
    const parsed = parseJsonObject(raw)
    if (!parsed) {
      return { success: false, msg: 'AI 返回格式异常，请重试' }
    }
    const cleaned = sanitizeCopy(parsed.title, parsed.content)
    if (!cleaned.ok) {
      return { success: false, msg: cleaned.msg }
    }
    return {
      success: true,
      title: cleaned.title,
      content: cleaned.content
    }
  } catch (e) {
    console.error('assistYouxinCopy error:', e)
    return { success: false, msg: e.message || 'AI 撰写失败' }
  }
}
