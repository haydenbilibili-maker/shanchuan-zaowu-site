/**
 * 藏品录入 AI 补全：拉丁学名 + 描述 + 科学分类
 * 环境变量：DASHSCOPE_API_KEY（与 identifySpecimen 共用，需在云函数配置中填写）
 */
const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const DASHSCOPE_HOST = 'dashscope.aliyuncs.com'
const TEXT_PATH = '/api/v1/services/aigc/text-generation/generation'
const MAX_LATIN_RETRIES = 2

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
    parameters: { result_format: 'message', temperature: 0.25 }
  }
  const res = await httpsPostJson(TEXT_PATH, body, { Authorization: `Bearer ${apiKey}` })
  return extractTextGen(res)
}

function isMerchandise(rootCategory, category) {
  const text = `${rootCategory || ''}${category || ''}`
  return /衍生|文创|书籍|画册|工具|耗材|周边|礼品/.test(text)
}

function isValidLatinName(name) {
  const s = String(name || '').trim()
  if (!s || s.length < 2) return false
  if (/[\u4e00-\u9fff]/.test(s)) return false
  return /[A-Za-z]/.test(s)
}

function normalizeLatinName(raw) {
  let s = String(raw || '').trim()
  s = s.replace(/^["'`]+|["'`]+$/g, '')
  s = s.replace(/（[^）]*）|\([^)]*\)/g, '').trim()
  s = s.replace(/\s+/g, ' ')
  return s
}

function extractLatinFromPlainText(text) {
  const line = String(text || '').trim().split('\n')[0].trim()
  const cleaned = normalizeLatinName(line)
  return isValidLatinName(cleaned) ? cleaned : ''
}

function buildPrompt(title, rootCategory, category, origin) {
  const merch = isMerchandise(rootCategory, category)
  const originLine = origin ? `\n【采集/产地】${origin}` : ''
  return `你是自然标本博物领域的专业文案助手。

【任务】根据下方「藏品名称」和「分类」，生成该藏品的拉丁学名、描述文案、科学分类。输出必须严格对应该藏品，禁止使用示例物种或模板内容。

【藏品名称】${title}
【所属馆】${rootCategory || '未指定'}
【具体分类】${category || '未指定'}${originLine}

【硬性规则】
1. 必须以「${title}」为识别主体，不得输出与名称无关的物种（例如名称不是闪蝶时，禁止输出 Morpho menelaus / 大蓝闪蝶）。
2. ${merch
    ? '该藏品属于衍生品/文创类，latinName 可留空 ""，taxonomy 各字段留空 ""，description 写产品描述。'
    : 'latinName 为必填：给出标准拉丁学名（双名法，属名首字母大写，种加词小写；矿物可用公认拉丁/英文学名如 Amethyst）。禁止留空，禁止输出中文作为 latinName。'}
3. 描述 80-150 字，克制、具体、有感官细节，符合标本馆调性；描述中必须体现「${title}」。
4. ${merch ? '' : 'taxonomy 填写中文生物分类；矿石/晶洞等可填矿物学相关分类。'}
5. 仅输出一个 JSON 对象，不要 markdown 代码围栏，不要任何解释文字。

{
  "latinName": "",
  "description": "",
  "taxonomy": {
    "kingdom": "",
    "phylum": "",
    "class": "",
    "order": "",
    "family": "",
    "genus": ""
  }
}`
}

function buildLatinRetryPrompt(title, rootCategory, category, origin) {
  const originLine = origin ? `\n采集/产地：${origin}` : ''
  return `你是博物学分类专家。请仅根据以下信息，给出「${title}」对应标本的标准拉丁学名。

所属馆：${rootCategory || '未指定'}
具体分类：${category || '未指定'}${originLine}

要求：
1. 输出双名法学名（如 Homarus americanus）；矿物/晶洞可用公认学名（如 Amethyst）。
2. 必须与「${title}」对应，禁止套用无关常见物种。
3. 只输出学名一行，不要中文、不要标点解释、不要引号。`
}

function rejectMorphoMismatch(titleStr, latinName, description) {
  return /大蓝闪蝶|Morpho menelaus/i.test(`${latinName}${description}`)
    && !/闪蝶|Morpho|大蓝/i.test(titleStr)
}

async function resolveLatinName(titleStr, rootCategory, category, origin, apiKey, initialLatin) {
  let latinName = normalizeLatinName(initialLatin)
  if (isMerchandise(rootCategory, category)) {
    return latinName
  }
  if (isValidLatinName(latinName)) {
    return latinName
  }

  for (let i = 0; i < MAX_LATIN_RETRIES; i++) {
    const raw = await callQwenText(
      buildLatinRetryPrompt(titleStr, rootCategory, category, origin),
      apiKey
    )
    latinName = extractLatinFromPlainText(raw)
    if (isValidLatinName(latinName)) {
      return latinName
    }
  }
  return ''
}

exports.main = async (event) => {
  const { title, category, rootCategory, origin } = event
  const titleStr = String(title || '').trim()
  if (!titleStr) {
    return { success: false, msg: '请先填写藏品名称' }
  }

  const merch = isMerchandise(rootCategory, category)
  const originStr = String(origin || '').trim()

  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) {
    return {
      success: false,
      msg: '未配置 AI 密钥：请在云开发控制台 → 云函数 assistProductCopy → 环境变量中添加 DASHSCOPE_API_KEY（与 identifySpecimen 相同）'
    }
  }

  try {
    const raw = await callQwenText(
      buildPrompt(titleStr, rootCategory, category, originStr),
      apiKey
    )
    const parsed = parseJsonObject(raw)
    if (!parsed) {
      return { success: false, msg: 'AI 返回格式异常，请重试' }
    }

    let latinName = normalizeLatinName(parsed.latinName)
    const description = String(parsed.description || '').trim()
    const taxonomy = parsed.taxonomy || {}

    if (rejectMorphoMismatch(titleStr, latinName, description)) {
      return {
        success: false,
        msg: 'AI 返回内容与藏品名称不匹配，请补充更具体的名称或分类后重试'
      }
    }

    if (!description) {
      return { success: false, msg: 'AI 未生成有效描述，请重试' }
    }

    if (!merch) {
      latinName = await resolveLatinName(
        titleStr,
        rootCategory,
        category,
        originStr,
        apiKey,
        latinName
      )
      if (!isValidLatinName(latinName)) {
        return {
          success: false,
          msg: '未能补全拉丁学名：请补充更具体的藏品名称、所属馆/分类或采集地后重试'
        }
      }
    }

    return {
      success: true,
      data: { latinName, description, taxonomy }
    }
  } catch (e) {
    console.error('assistProductCopy error:', e)
    return { success: false, msg: e.message || 'AI 补全失败' }
  }
}
