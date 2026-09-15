/**
 * 专题策展 AI 辅助创作：英文副标、摘要、标签、HTML 正文
 * 环境变量：DASHSCOPE_API_KEY（与 identifySpecimen / assistProductCopy 共用）
 */
const cloud = require('wx-server-sdk')
const https = require('https')
const { assertStaff: _assertStaff } = require('./staffGuard')

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


cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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
    parameters: { result_format: 'message', temperature: 0.28 }
  }
  const res = await httpsPostJson(TEXT_PATH, body, { Authorization: `Bearer ${apiKey}` })
  return extractTextGen(res)
}

function buildPrompt(title, themeHint) {
  const hintLine = themeHint ? `\n【创作方向/关键词】${themeHint}` : ''
  return `你是「山海造物 Nature's Creations」博物馆的专题策展文案助手。品牌调性：维多利亚博物学奇珍柜——克制、具体、有感官与可核验的科学细节，禁止直播电商话术、浮夸推销与 emoji。

【任务】为以下专题生成科学策展文案，输出 JSON。

【专题标题】${title}${hintLine}

【硬性规则】
1. latinName：英文副标题，2–5 个词，Title Case 或自然短语（如 Cretaceous Echo、Dinosauria）。
2. brief：中文摘要 60–120 字，说清专题观看路径与科学切入点，不要口号。
3. tags：3–5 个中文标签数组，必须包含「专题」，可含品类词（昆虫/矿物/植物/海洋/恐龙/白垩纪/博物学等）。
4. content：HTML 正文，必须包含 4–6 个栏目，每个栏目用 <h2>标题</h2> 开头，正文用 <p>…</p>；「观展与收藏」可另附 <ul><li>…</li></ul> 2–3 条提示。禁止外链、script、图片标签。栏目建议且须贴合标题：
   - 策展说明
   - 科学背景（地质年代/分类/形态/生态，视主题选择，写可核验的常识）
   - 展品解读（至少 2 件典型标本/岩石/植物的观察要点）
   - 观展与收藏（触感、光线、养护；非推销）
   - 法规与伦理提示（只写原则：合法来源、勿编造保护等级；琥珀/象牙/活体等按主题谨慎）
5. 科学准确：不确定的物种鉴定写成「待核」；禁止编造 IUCN、CITES、国家重点保护名录或其他保护等级。
6. 品牌名只用「山海造物」。内容须与标题「${title}」严格对应，禁止套用无关模板物种。
7. content 正文须充分展开（明显长于两三段导语），每个栏目至少一段完整说明。
8. 仅输出一个 JSON 对象，不要 markdown 代码围栏，不要解释文字。

{
  "latinName": "",
  "brief": "",
  "tags": ["专题"],
  "content": "<h2>策展说明</h2><p>…</p>"
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
  globalThis.__adminOpsKey = (event && event.adminOpsKey) || ''
  const wxContext = cloud.getWXContext()
  const operatorOpenid = wxContext.OPENID || wxContext.FROM_OPENID || ''
  const guard = await assertStaff(db, operatorOpenid, { permission: 'manageProducts' })
  if (!guard.ok) {
    return { success: false, code: guard.code, msg: guard.msg || '无权限' }
  }

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

    if (!brief || brief.length < 40) {
      return { success: false, msg: 'AI 未生成有效摘要，请重试' }
    }
    const h2Count = (content.match(/<h2/gi) || []).length
    if (!content || content.length < 400 || h2Count < 4) {
      return { success: false, msg: 'AI 正文偏短，请重试' }
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
