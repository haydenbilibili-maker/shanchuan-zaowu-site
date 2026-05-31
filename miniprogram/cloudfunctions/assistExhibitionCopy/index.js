/**
 * 专题策展 AI 辅助创作：英文副标、摘要、标签、HTML 正文
 * 环境变量：DASHSCOPE_API_KEY（与 identifySpecimen / assistProductCopy 共用）
 */
const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const DASHSCOPE_HOST = 'dashscope.aliyuncs.com'
const TEXT_PATH = '/api/v1/services/aigc/text-generation/generation'

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

function buildPrompt(title, themeHint) {
  const hintLine = themeHint ? `\n【创作方向/关键词】${themeHint}` : ''
  return `你是「山川造物 Nature's Creations」博物馆的专题策展文案助手。品牌调性：维多利亚博物学奇珍柜——克制、具体、有感官细节，禁止直播电商话术与 emoji。

【任务】为以下专题生成策展文案，输出 JSON。

【专题标题】${title}${hintLine}

【硬性规则】
1. latinName：英文副标题，2–5 个词，Title Case 或自然短语（如 Cretaceous Echo、Dinosauria）。
2. brief：中文摘要 40–80 字，一句话说清专题价值与观看路径。
3. tags：3–5 个中文标签数组，必须包含「专题」，可含品类词（昆虫/矿物/植物/海洋/恐龙/白垩纪/博物学等）。
4. content：HTML 正文，2–3 个板块。每板块用 <h2>标题</h2> 开头，正文用 <p>…</p>；可选 <ul><li>…</li></ul> 列 2–3 条观展提示。禁止外链与 script。不要插入图片标签。
5. 内容须与标题「${title}」严格对应，禁止套用无关模板物种。
6. 仅输出一个 JSON 对象，不要 markdown 代码围栏，不要解释文字。

{
  "latinName": "",
  "brief": "",
  "tags": ["专题"],
  "content": "<h2>…</h2><p>…</p>"
}`
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return ['专题']
  const list = tags.map((t) => String(t || '').trim()).filter(Boolean)
  if (!list.includes('专题')) list.unshift('专题')
  return list.slice(0, 6)
}

function sanitizeHtml(html) {
  let s = String(html || '').trim()
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '')
  s = s.replace(/on\w+="[^"]*"/gi, '')
  if (!/<h2|<p|<ul/i.test(s)) {
    return `<h2>专题概述</h2><p>${s.replace(/</g, '&lt;')}</p>`
  }
  return s
}

exports.main = async (event) => {
  const titleStr = String((event && event.title) || '').trim()
  const themeHint = String((event && event.themeHint) || '').trim()

  if (!titleStr) {
    return { success: false, msg: '请先填写专题标题' }
  }

  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) {
    return {
      success: false,
      msg: '未配置 AI 密钥：请在云开发控制台 → 云函数 assistExhibitionCopy → 环境变量中添加 DASHSCOPE_API_KEY（与 identifySpecimen 相同）'
    }
  }

  try {
    const raw = await callQwenText(buildPrompt(titleStr, themeHint), apiKey)
    const parsed = parseJsonObject(raw)
    if (!parsed) {
      return { success: false, msg: 'AI 返回格式异常，请重试' }
    }

    const latinName = String(parsed.latinName || '').trim()
    const brief = String(parsed.brief || '').trim()
    const content = sanitizeHtml(parsed.content)
    const tags = normalizeTags(parsed.tags)

    if (!brief || brief.length < 12) {
      return { success: false, msg: 'AI 未生成有效摘要，请重试' }
    }
    if (!content || content.length < 40) {
      return { success: false, msg: 'AI 未生成有效正文，请重试' }
    }

    return {
      success: true,
      data: {
        latinName,
        brief,
        tags,
        tagsStr: tags.join(','),
        content
      }
    }
  } catch (e) {
    console.error('assistExhibitionCopy error:', e)
    return { success: false, msg: e.message || 'AI 创作失败' }
  }
}
