/**
 * 藏品录入 AI 补全：分类 / 拉丁学名 / 描述 / 科学分类 / 保护物种
 * 环境变量：DASHSCOPE_API_KEY（与 identifySpecimen 共用，需在云函数配置中填写）
 */
const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const DASHSCOPE_HOST = 'dashscope.aliyuncs.com'
const TEXT_PATH = '/api/v1/services/aigc/text-generation/generation'
const MAX_LATIN_RETRIES = 2

const PROTECTION_TYPES = new Set(['none', 'sanyou', 'protected_plant', 'protected_animal'])

/** 与 seedCategories/categorySeed 对齐的馆名别名 */
const LEGACY_ROOT_ALIASES = {
  神奇昆虫: '昆虫馆',
  蝴蝶昆虫: '昆虫馆',
  群山回响: '矿石馆',
  植物探微: '植物馆',
  植物果实: '植物馆',
  无尽海洋: '海洋馆',
  海洋标本: '海洋馆',
  动物类: '动物馆',
  动物世界: '动物馆',
  昆虫: '昆虫馆',
  植物: '植物馆',
  海洋: '海洋馆',
  矿石: '矿石馆',
  矿物: '矿石馆',
  动物: '动物馆'
}

const LEGACY_CHILD_ALIASES = {
  蝴蝶: '鳞翅目 · 蝴蝶',
  甲虫: '鞘翅目 · 甲虫',
  矿石晶体: '石英与水晶',
  晶洞: '紫水晶与晶洞',
  干花标本: '被子植物 · 押花',
  种子标本: '种子与果实',
  贝壳: '腹足纲 · 贝壳',
  珊瑚: '珊瑚纲 · 珊瑚',
  头足类: '头足纲 · 头足类',
  哺乳类: '哺乳纲',
  爬行类: '爬行纲',
  鸟类: '鸟纲',
  两栖类: '两栖纲',
  鱼类: '辐鳍鱼纲',
  周边文创: '品牌联名周边',
  书籍画册: '书籍与画册',
  工具耗材: '标本工具耗材'
}

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

function isMerchandise(rootCategory, category, categoryType) {
  if (categoryType === 'merch') return true
  const text = `${rootCategory || ''}${category || ''}`
  return /衍生|文创|书籍|画册|工具|耗材|周边|礼品|包装|礼盒/.test(text)
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

function normalizeProtectionType(raw) {
  const s = String(raw || '').trim().toLowerCase()
  if (PROTECTION_TYPES.has(s)) return s
  if (/三有/.test(String(raw || ''))) return 'sanyou'
  if (/保护植物|国家.*植物/.test(String(raw || ''))) return 'protected_plant'
  if (/保护动物|国家.*动物|重点保护/.test(String(raw || ''))) return 'protected_animal'
  return 'none'
}

const { toChineseTaxonomy } = require('./taxonomyZh')

function emptyTaxonomy() {
  return { kingdom: '', phylum: '', class: '', order: '', family: '', genus: '' }
}

function normalizeTaxonomy(raw) {
  const t = raw && typeof raw === 'object' ? raw : {}
  return toChineseTaxonomy({
    kingdom: String(t.kingdom || '').trim(),
    phylum: String(t.phylum || '').trim(),
    class: String(t.class || '').trim(),
    order: String(t.order || '').trim(),
    family: String(t.family || '').trim(),
    genus: String(t.genus || '').trim()
  })
}

async function loadCategoryTree() {
  const [rootsRes, childrenRes] = await Promise.all([
    db.collection('categories').where({ level: 1 }).limit(100).get(),
    db.collection('categories').where({ level: 2 }).limit(500).get()
  ])
  const roots = (rootsRes.data || []).filter((c) => c && c.active !== false && c.status !== 'inactive')
  const children = (childrenRes.data || []).filter((c) => c && c.active !== false && c.status !== 'inactive')
  roots.sort((a, b) => (a.sortOrder ?? a.sort ?? 0) - (b.sortOrder ?? b.sort ?? 0))
  children.sort((a, b) => (a.sortOrder ?? a.sort ?? 0) - (b.sortOrder ?? b.sort ?? 0))
  return { roots, children }
}

function buildCatalogText(roots, children) {
  const lines = []
  for (const root of roots) {
    const subs = children.filter((c) => c.parentId === root._id)
    const subNames = subs.map((c) => c.name).join('、') || '（无二级）'
    lines.push(`- ${root.name}：${subNames}`)
  }
  return lines.join('\n')
}

function toCanonicalRootName(raw, rootNames) {
  const s = String(raw || '').trim()
  if (!s) return ''
  const set = new Set(rootNames)
  if (set.has(s)) return s
  if (LEGACY_ROOT_ALIASES[s]) return LEGACY_ROOT_ALIASES[s]
  if (!s.endsWith('馆')) {
    const withHall = `${s}馆`
    if (set.has(withHall)) return withHall
    if (LEGACY_ROOT_ALIASES[withHall]) return LEGACY_ROOT_ALIASES[withHall]
  }
  // 短名：昆虫馆 → 去掉「馆」后精确命中展示短名
  for (const name of rootNames) {
    if (name === s || name.replace(/馆$/, '') === s) return name
  }
  return ''
}

function normalizeChildName(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (LEGACY_CHILD_ALIASES[s]) return LEGACY_CHILD_ALIASES[s]
  return s
}

function resolveCategorySuggestion(aiRoot, aiChild, roots, children) {
  const rootNames = roots.map((r) => r.name)
  const canonicalRoot = toCanonicalRootName(aiRoot, rootNames)
  if (!canonicalRoot) return null
  const root = roots.find((r) => r.name === canonicalRoot)
  if (!root) return null

  const wanted = normalizeChildName(aiChild)
  const siblings = children.filter((c) => c.parentId === root._id)
  let child = null
  if (wanted) {
    child = siblings.find((c) => c.name === wanted)
      || siblings.find((c) => c.name.includes(wanted) || wanted.includes(c.name))
      || siblings.find((c) => {
        const aliasHit = Object.entries(LEGACY_CHILD_ALIASES).find(
          ([legacy, canon]) => (legacy === wanted || canon === wanted) && (c.name === canon || c.name.includes(legacy))
        )
        return !!aliasHit
      })
  }

  return {
    rootCategoryId: root._id,
    rootCategoryName: root.name,
    categoryId: child ? child._id : '',
    category: child ? child.name : root.name,
    categoryType: (child && child.categoryType) || root.categoryType || 'specimen'
  }
}

function buildPrompt(title, rootCategory, category, origin, catalogText) {
  const merch = isMerchandise(rootCategory, category)
  const originLine = origin ? `\n【采集/产地】${origin}` : ''
  const hasCategory = !!(rootCategory || category)
  return `你是自然标本博物领域的专业文案助手（山海造物）。

【任务】根据「藏品名称」补齐档案字段。输出必须严格对应该藏品，禁止使用示例物种或模板内容。文案克制、事实向，符合博物馆调性；禁止浮夸推销与 emoji。

【藏品名称】${title}
【所属馆】${rootCategory || '未指定'}
【具体分类】${category || '未指定'}${originLine}

【可选分类目录】（必须从中选择；勿自造馆名/二级名）
${catalogText || '（目录暂缺）'}

【硬性规则】
1. 必须以「${title}」为识别主体，不得输出与名称无关的物种。
2. ${merch
    ? '若判定为衍生品/文创类，latinName 可留空 ""，taxonomy 各字段留空 ""，description 写产品描述。'
    : 'latinName 为必填：标准拉丁学名（双名法；矿物可用公认学名）。禁止中文作 latinName。'}
3. description：80-150 字，维基百科式简要介绍，事实向、有感官细节，必须体现「${title}」。
4. taxonomy：必须用中文生物/矿物分类（界门纲目科属），禁止填拉丁文。示例：动物界/节肢动物门/昆虫纲/鳞翅目；不确定的字段留空 ""。
5. protectionType 只能是：none / sanyou / protected_plant / protected_animal。不确定时用 none，禁止夸大保护等级。
6. rootCategoryName、category 必须选自上方目录；${hasCategory ? '若已指定所属馆/分类，优先沿用，仅在明显错误时纠正。' : '根据物种归属给出最合适的一级馆与二级分类。'}
7. 仅输出一个 JSON 对象，不要 markdown 代码围栏，不要任何解释文字。

{
  "rootCategoryName": "",
  "category": "",
  "latinName": "",
  "description": "",
  "protectionType": "none",
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
  const { title, category, rootCategory, origin } = event || {}
  const titleStr = String(title || '').trim()
  if (!titleStr) {
    return { success: false, msg: '请先填写藏品名称' }
  }

  const originStr = String(origin || '').trim()
  const hintRoot = String(rootCategory || '').trim()
  const hintChild = String(category || '').trim()

  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) {
    return {
      success: false,
      msg: '未配置 AI 密钥：请在云开发控制台 → 云函数 assistProductCopy → 环境变量中添加 DASHSCOPE_API_KEY（与 identifySpecimen 相同）'
    }
  }

  try {
    let roots = []
    let children = []
    let catalogText = ''
    try {
      const tree = await loadCategoryTree()
      roots = tree.roots
      children = tree.children
      catalogText = buildCatalogText(roots, children)
    } catch (e) {
      console.warn('loadCategoryTree failed', e)
    }

    const raw = await callQwenText(
      buildPrompt(titleStr, hintRoot, hintChild, originStr, catalogText),
      apiKey
    )
    const parsed = parseJsonObject(raw)
    if (!parsed) {
      return { success: false, msg: 'AI 返回格式异常，请重试' }
    }

    let latinName = normalizeLatinName(parsed.latinName)
    const description = String(parsed.description || '').trim()
    const taxonomy = normalizeTaxonomy(parsed.taxonomy)
    const protectionType = normalizeProtectionType(parsed.protectionType)

    const suggested = resolveCategorySuggestion(
      parsed.rootCategoryName || hintRoot,
      parsed.category || hintChild,
      roots,
      children
    )

    // 若 AI 未命中但表单已有分类提示，尽量用提示归一
    const categoryResult = suggested || resolveCategorySuggestion(hintRoot, hintChild, roots, children)

    const effectiveRoot = (categoryResult && categoryResult.rootCategoryName) || hintRoot
    const effectiveChild = (categoryResult && categoryResult.category) || hintChild
    const merch = isMerchandise(
      effectiveRoot,
      effectiveChild,
      categoryResult && categoryResult.categoryType
    )

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
        effectiveRoot,
        effectiveChild,
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
      data: {
        latinName,
        description,
        taxonomy: taxonomy || emptyTaxonomy(),
        protectionType,
        category: categoryResult || null,
        rootCategoryName: categoryResult ? categoryResult.rootCategoryName : '',
        categoryName: categoryResult ? categoryResult.category : ''
      }
    }
  } catch (e) {
    console.error('assistProductCopy error:', e)
    return { success: false, msg: e.message || 'AI 补全失败' }
  }
}
