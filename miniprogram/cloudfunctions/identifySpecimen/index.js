/**
 * AI 标本鉴定主云函数：视觉识别 + 科普文案 + 商品关联 + 识别记录落库
 * 环境变量：DASHSCOPE_API_KEY（阿里云 DashScope / 通义千问）；可选 IDENTIFY_VISION_MODELS / IDENTIFY_TEXT_MODELS（见 aiModels.js）
 */
const cloud = require('wx-server-sdk')
const https = require('https')
const crypto = require('crypto')

function bufferToDataUrl(buf) {
  const b = buf && buf.length ? buf : Buffer.alloc(0)
  const isPng = b.length > 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
  const mime = isPng ? 'image/png' : 'image/jpeg'
  return `data:${mime};base64,${b.toString('base64')}`
}

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const { checkImageBuffer, checkFileImage } = require('./contentSecurity')
const { isIdentifyCall, writeIdentifyLog } = require('./identifyLog')
const { visionModels, textModels, isModelUnavailable, AI_SERVICE_ERROR } = require('./aiModels')
const {
  fetchSpeciesKnowledge,
  buildSpeciesProfile,
  extractAiStructured,
  knowledgePromptSnippet,
  PROFILE_VERSION
} = require('./speciesProfile')

const DASHSCOPE_HOST = 'dashscope.aliyuncs.com'
const VL_PATH = '/api/v1/services/aigc/multimodal-generation/generation'
const TEXT_PATH = '/api/v1/services/aigc/text-generation/generation'

const MOCK_SPECIES = {
  species_name_zh: '大蓝闪蝶',
  species_name_latin: 'Morpho menelaus',
  species_name_en: 'Blue morpho',
  taxonomy: {
    kingdom: '动物界',
    phylum: '节肢动物门',
    class: '昆虫纲',
    order: '鳞翅目',
    family: '蛱蝶科',
    genus: '闪蝶属'
  },
  confidence: 0.88,
  brief_description: '雨林里掠过的一抹电光蓝。',
  is_specimen: true
}

const MOCK_AI = {
  content:
    '大蓝闪蝶的翅膀像被雨水洗过的薄瓷，在阳光下会泛起近乎幻觉的金属蓝。它们生活在南美雨林的中层，常贴着林冠滑翔，以发酵的果实与树液为食。那抹蓝并非来自色素，而是微观鳞片对光的干涉——自然用最省力的方式，写出了最奢侈的诗句。',
  fun_fact: '闪蝶的蓝色来自结构色，换个角度观察，颜色会悄然变化。',
  morphology: '翅展约 12–20 厘米，翅面呈结构色金属蓝，随观察角度明暗变幻。',
  habits: '活动于热带雨林中下层，滑翔觅食，取食发酵果实与树液。',
  distribution: '中美洲至南美洲北部的热带雨林。',
  collection_note: '常见于展翅标本；结构色来自鳞片微结构，非色素。',
  conservation_advice: '收藏与流转请核验合法来源；野外种群受栖息地变化影响。'
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
        res.on('data', (c) => {
          raw += c
        })
        res.on('end', () => {
          try {
            const j = JSON.parse(raw)
            if (res.statusCode && res.statusCode >= 400) {
              const err = new Error(j.message || j.msg || raw || `HTTP ${res.statusCode}`)
              err.statusCode = res.statusCode
              err.code = j.code || ''
              reject(err)
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

/** 从模型输出中抠出 JSON 对象 */
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

function extractVisionText(resp) {
  const out = resp && resp.output
  if (!out) return ''
  if (typeof out.text === 'string') return out.text
  const ch = out.choices && out.choices[0]
  if (!ch) return ''
  const msg = ch.message
  if (!msg) return ''
  const c = msg.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    const parts = c.map((x) => (x && x.text) || '').filter(Boolean)
    return parts.join('\n')
  }
  return ''
}

function extractTextGen(resp) {
  const out = resp && resp.output
  if (!out) return ''
  if (typeof out.text === 'string') return out.text
  const ch = out.choices && out.choices[0]
  if (ch && ch.message && typeof ch.message.content === 'string') return ch.message.content
  return ''
}

function normalizeAlternative(raw) {
  const d = raw || {}
  return {
    species_name_zh: String(d.species_name_zh || '').trim(),
    species_name_latin: String(d.species_name_latin || '').trim(),
    confidence: typeof d.confidence === 'number' ? d.confidence : parseFloat(d.confidence) || 0
  }
}

const { toChineseTaxonomy } = require('./taxonomyZh')

function normalizeSpecies(raw) {
  const d = raw || {}
  const tax = d.taxonomy || {}
  const alternatives = Array.isArray(d.alternatives)
    ? d.alternatives
        .map(normalizeAlternative)
        .filter((a) => a.species_name_zh)
        .slice(0, 2)
    : []
  return {
    species_name_zh: String(d.species_name_zh || '').trim() || '未知物种',
    species_name_latin: String(d.species_name_latin || '').trim(),
    species_name_en: String(d.species_name_en || '').trim(),
    taxonomy: toChineseTaxonomy({
      kingdom: tax.kingdom || '',
      phylum: tax.phylum || '',
      class: tax.class || '',
      order: tax.order || '',
      family: tax.family || '',
      genus: tax.genus || ''
    }),
    confidence: typeof d.confidence === 'number' ? d.confidence : parseFloat(d.confidence) || 0,
    brief_description: String(d.brief_description || '').trim(),
    is_specimen: d.is_specimen !== false,
    alternatives
  }
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const VISION_PROMPT_BASE = `你是标本与自然博物领域的图像识别助手。请仅输出一个 JSON 对象，不要包含 markdown 代码围栏或其它说明文字。
字段要求（必须齐全）：
{
  "species_name_zh": "中文名或主要识别对象",
  "species_name_latin": "拉丁学名，无法判断可填空字符串",
  "species_name_en": "英文俗名，可空",
  "taxonomy": { "kingdom":"中文界名如动物界","phylum":"中文门名","class":"中文纲名","order":"中文目名","family":"中文科名","genus":"中文属名可空" },
  "confidence": 0.0到1之间的小数,
  "brief_description": "一句话简介",
  "is_specimen": true或false,
  "alternatives": [
    { "species_name_zh":"备选中文名","species_name_latin":"备选拉丁名","confidence":0.0到1的小数 }
  ]
}
规则：
1. 若图片明显不是生物、动植物或标本（如风景、文字、纯物品），设 is_specimen 为 false，confidence 为 0，brief_description 说明原因，alternatives 为空数组。
2. 若是生物/标本但光线、角度导致难以判断，仍给出最佳猜测并适当降低 confidence。
3. alternatives 最多 2 条，为除主结果外最可能的备选物种；若非常确定则返回空数组。
4. taxonomy 各字段必须用中文（如动物界/节肢动物门/昆虫纲/鳞翅目），禁止填 Animalia、Insecta 等拉丁层级名；不确定则留空字符串。`

function buildVisionPrompt(categoryHint) {
  let extra = ''
  if (categoryHint) {
    extra = `\n用户提示：图片更可能属于「${categoryHint}」类标本，请优先考虑该方向识别。`
  }
  return VISION_PROMPT_BASE + extra
}

/** image 传临时 https 链接或 base64 dataUrl 均可 */
async function callQwenVL(model, image, apiKey, categoryHint) {
  const prompt = buildVisionPrompt(categoryHint)
  const body = {
    model,
    input: {
      messages: [
        {
          role: 'user',
          content: [
            { image },
            { text: prompt }
          ]
        }
      ]
    },
    parameters: { enable_thinking: false }
  }
  const res = await httpsPostJson(VL_PATH, body, {
    Authorization: `Bearer ${apiKey}`
  })
  const text = extractVisionText(res)
  let parsed = parseJsonObject(text)
  if (!parsed) {
    throw new Error('视觉模型未返回合法 JSON')
  }
  return normalizeSpecies(parsed)
}

/** 按 visionModels() 顺序尝试；每个模型先传临时链接、失败再传 base64；模型不可用直接换下一个 */
async function identifyWithVision(tempUrl, fileBuf, apiKey, categoryHint, trace) {
  let lastErr = null
  for (const model of visionModels()) {
    try {
      const species = await callQwenVL(model, tempUrl, apiKey, categoryHint)
      trace.visionModel = model
      return species
    } catch (e1) {
      lastErr = e1
      console.warn(`VL[${model}] URL 调用失败`, e1.message)
      if (isModelUnavailable(e1)) continue
    }
    try {
      const species = await callQwenVL(model, bufferToDataUrl(fileBuf), apiKey, categoryHint)
      trace.visionModel = model
      return species
    } catch (e2) {
      lastErr = e2
      console.warn(`VL[${model}] base64 调用失败`, e2.message)
    }
  }
  const err = lastErr || new Error('视觉模型调用失败')
  err.errorType = AI_SERVICE_ERROR
  throw err
}

function buildSciencePrompt(species, knowledge) {
  const tax = species.taxonomy || {}
  const taxStr = ['界', '门', '纲', '目', '科', '属']
    .map((label, i) => {
      const keys = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus']
      const v = tax[keys[i]]
      return v ? `${label}:${v}` : ''
    })
    .filter(Boolean)
    .join('；')

  const archive = knowledgePromptSnippet(knowledge)

  return `你是一位自然博物馆的科普讲解员，同时也是一位文艺作家。
请为以下物种撰写科普介绍，并严格只输出一个 JSON 对象，不要其它文字。
物种信息：
- 中文名：${species.species_name_zh}
- 拉丁学名：${species.species_name_latin || '未知'}
- 分类：${taxStr || '未知'}
${archive}

要求：
1. 科普正文 200-400 字，按「事实（形态/习性/分布）→ 感受（画面与触觉）→ 连接（与收藏/生活）」三层结构组织。
2. 语言温暖自然、有画面感，避免堆砌术语与直播电商话术。
3. 至少一个有趣冷知识融入正文。
4. 不确定的结构化字段必须填空字符串，禁止编造 IUCN、国家重点保护、CITES 等保护等级或具体法律条款。
5. similar_species 最多 2 条，仅列出形态相近、易混淆物种及简短区分点，须标注为形态参考而非名录判定。
6. 输出格式：{"content":"科普正文","fun_fact":"单独一句话冷知识","morphology":"形态特征，可空","identification_notes":"鉴别要点，便于对照标本，可空","habits":"生活习性，可空","distribution":"地理分布，可空","habitat":"栖息地，可空","collection_note":"与标本收藏相关的短注，可空","conservation_advice":"通用保护建议（栖息地、合法来源），不要声称具体名录等级，可空","nomenclature":"命名简史，不确定则空","phenology":"季节物候，不确定则空","similar_species":[{"species_name_zh":"","species_name_latin":"","note":""}]}`
}

async function sendIdentifyNotification(openid, recordId, speciesInfo) {
  if (!openid || !recordId) return
  const zh = (speciesInfo && speciesInfo.species_name_zh) || '未知物种'
  try {
    await cloud.callFunction({
      name: 'sendInAppMessage',
      data: {
        openid,
        templateCode: 'identify_result',
        relatedId: recordId,
        vars: {
          resultSummary: `已识别为「${zh}」，点击查看完整鉴定报告`
        }
      }
    })
  } catch (e) {
    console.warn('鉴定完成站内信发送失败', e.message)
  }
}

async function callQwenText(prompt, apiKey, trace) {
  let res = null
  let lastErr = null
  for (const model of textModels()) {
    const body = {
      model,
      input: {
        messages: [{ role: 'user', content: prompt }]
      },
      parameters: {
        result_format: 'message',
        enable_thinking: false
      }
    }
    try {
      res = await httpsPostJson(TEXT_PATH, body, {
        Authorization: `Bearer ${apiKey}`
      })
      trace.textModel = model
      break
    } catch (e) {
      lastErr = e
      console.warn(`文本模型[${model}] 调用失败`, e.message)
    }
  }
  if (!res) throw lastErr || new Error('文本模型调用失败')
  const text = extractTextGen(res)
  const parsed = parseJsonObject(text)
  if (parsed && parsed.content) {
    let similar = parsed.similar_species
    if (typeof similar === 'string') {
      try {
        similar = JSON.parse(similar)
      } catch (e) {
        similar = []
      }
    }
    return {
      content: String(parsed.content),
      fun_fact: String(parsed.fun_fact || ''),
      morphology: String(parsed.morphology || '').trim(),
      identification_notes: String(parsed.identification_notes || '').trim(),
      habits: String(parsed.habits || '').trim(),
      distribution: String(parsed.distribution || '').trim(),
      habitat: String(parsed.habitat || '').trim(),
      collection_note: String(parsed.collection_note || '').trim(),
      conservation_advice: String(parsed.conservation_advice || '').trim(),
      nomenclature: String(parsed.nomenclature || '').trim(),
      phenology: String(parsed.phenology || '').trim(),
      similar_species: Array.isArray(similar) ? similar : []
    }
  }
  return {
    content: text.slice(0, 1200),
    fun_fact: ''
  }
}

function productProtectionFromList(products) {
  const hit = (products || []).find((p) => p && p.protectionType && p.protectionType !== 'none')
  if (!hit) return null
  return { type: hit.protectionType, title: hit.title || '' }
}

// 需求 1：同物种去重键（canonical 真源，回填脚本共用同一实现，避免判定漂移）
const { buildSpeciesDedupKey } = require('./speciesDedupKey')

function confidenceToLevel(conf, isSpecimen) {
  if (!isSpecimen) return 'low'
  if (typeof conf !== 'number') return 'medium'
  if (conf < 0.6) return 'low'
  if (conf < 0.85) return 'medium'
  return 'high'
}

async function fetchRelatedProductsSnapshot(species) {
  const zh = species.species_name_zh || ''
  const family = (species.taxonomy && species.taxonomy.family) || ''

  let rows = []
  try {
    const exact = await db
      .collection('species_product_map')
      .where({ species_keyword: zh })
      .limit(20)
      .get()
    rows = exact.data || []
    if (!rows.length && family) {
      const fuzzy = await db
        .collection('species_product_map')
        .where({
          match_type: 'fuzzy',
          species_keyword: db.RegExp({
            regexp: family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            options: 'i'
          })
        })
        .limit(20)
        .get()
      rows = fuzzy.data || []
    }
  } catch (e) {
    console.warn('species_product_map 查询失败（集合可能未创建）', e.message)
    return []
  }

  const idSet = new Set()
  rows.forEach((r) => {
    ;(r.product_ids || []).forEach((id) => idSet.add(id))
  })
  const ids = Array.from(idSet).slice(0, 20)
  if (!ids.length) return []

  const products = []
  for (const id of ids) {
    try {
      const doc = await db
        .collection('products')
        .doc(id)
        .get()
      if (doc.data) {
        const p = doc.data
        const imgs = p.images || []
        products.push({
          _id: p._id,
          title: p.title || '',
          price: p.price || 0,
          cover: imgs[0] || '',
          protectionType: p.protectionType || 'none'
        })
      }
    } catch (e) {
      console.warn('读取商品失败', id, e.message)
    }
  }
  return products
}

async function fetchRelatedProductsFromCatalog(species) {
  const zh = (species.species_name_zh || '').trim()
  const latin = (species.species_name_latin || '').trim()
  const family = ((species.taxonomy && species.taxonomy.family) || '').replace(/科$/, '')
  const orConds = []
  if (zh.length >= 2) {
    orConds.push({ title: db.RegExp({ regexp: escapeRegExp(zh.slice(0, 10)), options: 'i' }) })
  }
  if (latin.length >= 3) {
    orConds.push({ latinName: db.RegExp({ regexp: escapeRegExp(latin.slice(0, 18)), options: 'i' }) })
  }
  if (family.length >= 2) {
    orConds.push({ category: db.RegExp({ regexp: escapeRegExp(family), options: 'i' }) })
  }
  if (!orConds.length) return []

  try {
    const res = await db
      .collection('products')
      .where(_.and([{ isOffShelf: _.neq(true) }, _.or(orConds)]))
      .limit(8)
      .get()
    return (res.data || []).map((p) => {
      const imgs = p.images || []
      return {
        _id: p._id,
        title: p.title || '',
        price: p.price || 0,
        cover: imgs[0] || '',
        protectionType: p.protectionType || 'none'
      }
    })
  } catch (e) {
    console.warn('products 模糊关联失败', e.message)
    return []
  }
}

async function fetchAllRelatedProducts(species) {
  const mapped = await fetchRelatedProductsSnapshot(species)
  const seen = new Set(mapped.map((p) => p._id))
  const merged = [...mapped]
  if (merged.length < 4) {
    const catalog = await fetchRelatedProductsFromCatalog(species)
    catalog.forEach((p) => {
      if (!seen.has(p._id)) {
        merged.push(p)
        seen.add(p._id)
      }
    })
  }
  return merged.slice(0, 6)
}

async function fetchRelatedWikiArchive(species) {
  const zh = (species.species_name_zh || '').trim()
  const latin = (species.species_name_latin || '').trim()
  const orConds = []
  if (zh.length >= 2) {
    orConds.push({ title: db.RegExp({ regexp: escapeRegExp(zh.slice(0, 12)), options: 'i' }) })
  }
  if (latin.length >= 3) {
    orConds.push({ latinName: db.RegExp({ regexp: escapeRegExp(latin.slice(0, 20)), options: 'i' }) })
  }
  if (!orConds.length) return []

  try {
    const res = await db
      .collection('cms_wikis')
      .where(_.and([{ status: _.neq('draft') }, _.or(orConds)]))
      .limit(4)
      .get()
    return (res.data || []).map((w) => ({
      _id: w._id,
      title: w.title || '',
      latinName: w.latinName || '',
      coverImage: w.coverImage || w.cover || '',
      brief: w.brief || '',
      taxonomy: w.taxonomy || null,
      distribution: w.distribution || '',
      habitat: w.habitat || '',
      iucn: w.iucn || '',
      protectionLevel: w.protectionLevel || w.china_level || '',
      cites: w.cites || ''
    }))
  } catch (e) {
    console.warn('cms_wikis 关联失败', e.message)
    return []
  }
}

/**
 * 需求 1 存量回填：为缺少 `species_dedup_key` 的历史记录补键。
 *
 * 为什么必须回填：该键只在**建记录时**写入，存量记录没有它 → 同物种去重对旧数据不生效。
 *
 * 设计：
 *   - **默认 dry-run**（只统计与抽样，不写库）；需显式 `apply: true` 才写
 *   - 分批扫描（`limit`，默认 100/批；`cursor` 传上一批最后一个 `_id` 做翻页）
 *   - 幂等：已有 `species_dedup_key` 的记录跳过
 *   - 统计命中情况，便于判断「存量里有多少条本该被合并」
 *
 * @returns {{success:boolean, mode:string, scanned:number, updated:number, skipped:number,
 *            keyed:number, unkeyable:number, nextCursor:string|null, hasMore:boolean, samples:Array}}
 */
async function backfillSpeciesDedup(event) {
  const apply = event && event.apply === true
  const limit = Math.min(Math.max(parseInt((event && event.limit) || 100, 10) || 100, 1), 200)
  const cursor = String((event && event.cursor) || '').trim()

  try {
    let query = db.collection('identification_records')
    if (cursor) query = query.where({ _id: _.gt(cursor) })
    const res = await query.orderBy('_id', 'asc').limit(limit).get()
    const rows = res.data || []

    let updated = 0
    let skipped = 0
    let keyed = 0
    let unkeyable = 0
    const samples = []

    for (const row of rows) {
      if (!row || !row._id) continue
      const info = row.species_info || {}
      if (row.species_dedup_key) {
        skipped += 1
        continue
      }
      const key = buildSpeciesDedupKey(info)
      if (!key) {
        // 非标本 / 未知物种 / 缺名 —— 正确地不参与去重
        unkeyable += 1
        if (samples.length < 5) {
          samples.push({ _id: row._id, key: '', zh: info.species_name_zh || '', reason: 'unkeyable' })
        }
        continue
      }
      keyed += 1
      if (samples.length < 5) {
        samples.push({ _id: row._id, key, zh: info.species_name_zh || '', latin: info.species_name_latin || '' })
      }
      if (apply) {
        try {
          await db.collection('identification_records').doc(row._id).update({
            data: { species_dedup_key: key }
          })
          updated += 1
        } catch (e) {
          console.warn('回填 species_dedup_key 失败', row._id, e && e.message)
        }
      }
    }

    const last = rows.length ? rows[rows.length - 1] : null
    const nextCursor = last ? String(last._id) : null
    return {
      success: true,
      mode: apply ? 'APPLY' : 'DRY-RUN',
      scanned: rows.length,
      updated,
      skipped,
      keyed,
      unkeyable,
      nextCursor,
      hasMore: rows.length >= limit,
      samples
    }
  } catch (e) {
    console.error('backfillSpeciesDedup', e)
    return { success: false, msg: (e && e.message) || '回填失败' }
  }
}

/** trace：exports.main 传入的旁路对象，回填实际用到的模型名供日志记录，不进出参 */
const identifyMain = async (event, context, trace = {}) => {
  const wxContext = cloud.getWXContext()
  const { action, image_file_id, use_mock, category_hint, entry_source } = event

  // ── 运维/回填入口：必须持 ADMIN_OPS_KEY，且默认 dry-run ────────────────────
  // 需求 1 的 `species_dedup_key` 只在建记录时写入，**存量记录没有该键**，
  // 故需要一个一次性回填把历史记录纳入同物种去重（否则旧数据不受该决策影响）。
  if (action === 'backfill_species_dedup') {
    const opsKey = String(process.env.ADMIN_OPS_KEY || '')
    const given = String(event.adminOpsKey || '')
    if (!opsKey || given !== opsKey) {
      return { success: false, code: 'FORBIDDEN', msg: '需要运维口令' }
    }
    return backfillSpeciesDedup(event)
  }

  if (action === 'list_recent') {
    const limit = Math.min(Math.max(parseInt(event.limit, 10) || 5, 1), 50)
    try {
      let res
      try {
        res = await db
          .collection('identification_records')
          .where({ _openid: wxContext.OPENID })
          .orderBy('created_at', 'desc')
          .limit(limit)
          .get()
      } catch (e) {
        res = await db
          .collection('identification_records')
          .where({ _openid: wxContext.OPENID })
          .limit(limit)
          .get()
        const rows = (res.data || []).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
        return { success: true, data: rows.slice(0, limit) }
      }
      return { success: true, data: res.data || [] }
    } catch (e) {
      return { success: false, data: [], msg: e.message }
    }
  }

  // 读取单条鉴定记录（服务端读，绕开客户端「仅本人可读」规则）：
  // 本人记录的详情，或他人通过分享海报公开过的记录（is_shared=true）
  if (action === 'get_record') {
    const recordId = String(event.record_id || '').trim()
    if (!recordId) return { success: false, msg: '缺少 record_id' }
    try {
      const rec = await db.collection('identification_records').doc(recordId).get()
      const doc = rec.data
      if (!doc) return { success: false, msg: '记录不存在' }
      const openid = wxContext.OPENID || ''
      const isOwner = !doc._openid || doc._openid === openid
      if (!isOwner && !doc.is_shared) {
        return { success: false, code: 'FORBIDDEN', msg: '该鉴定未公开分享' }
      }
      return { success: true, data: { doc, is_owner: isOwner } }
    } catch (e) {
      console.error('get_record', e)
      return { success: false, msg: e.message || '记录读取失败' }
    }
  }

  // 标记「允许他人查看」：微信转发 / 朋友圈 / 海报 三条分享路径共用。
  // 分享即公开（owner-only 才能标记）；shared=false 可撤回为仅本人可见。
  if (action === 'mark_shared') {
    const openid = wxContext.OPENID
    if (!openid) return { success: false, msg: '未登录' }
    const recordId = String(event.record_id || '').trim()
    if (!recordId) return { success: false, msg: '缺少 record_id' }
    const shared = event.shared !== false
    const stamp = Date.now()
    try {
      const rec = await db.collection('identification_records').doc(recordId).get()
      const doc = rec.data
      if (!doc) return { success: false, msg: '记录不存在' }
      if (doc._openid && doc._openid !== openid) return { success: false, msg: '无权操作该记录' }
      if (shared) {
        // 公开分享前必须确认图片已通过内容安全检测；历史记录/检测不可用时补检一次
        let imageChecked = !!(doc.secCheck && doc.secCheck.imageChecked === true)
        if (!imageChecked && doc.image_url) {
          const recheck = await checkFileImage(doc.image_url)
          if (recheck.reason === 'risky') {
            return { success: false, msg: '该记录图片未通过安全检测，无法公开分享' }
          }
          imageChecked = !!recheck.ok
        }
        if (!imageChecked) {
          return { success: false, msg: '内容安全检测暂不可用，请稍后再试分享' }
        }
      }
      await db.collection('identification_records').doc(recordId).update({
        data: { is_shared: shared, shared_at: shared ? stamp : null }
      })
      return { success: true, data: { is_shared: shared, shared_at: shared ? stamp : 0 } }
    } catch (e) {
      console.error('mark_shared', e)
      return { success: false, msg: e.message || '标记失败' }
    }
  }

  // 写入山海图鉴（替代客户端直写 user_collection / identification_records）
  if (action === 'save_atlas') {
    const openid = wxContext.OPENID
    if (!openid) return { success: false, msg: '未登录' }
    const recordId = String(event.record_id || '').trim()
    if (!recordId) return { success: false, msg: '缺少 record_id' }
    const ALLOWED = new Set(['昆虫', '矿石', '植物', '海洋', '动物', '衍生品', '其他'])
    let category = String(event.category || '').trim()
    if (!ALLOWED.has(category)) category = '其他'
    try {
      const rec = await db.collection('identification_records').doc(recordId).get()
      const doc = rec.data
      if (!doc) return { success: false, msg: '记录不存在' }
      if (doc._openid && doc._openid !== openid) return { success: false, msg: '无权操作该记录' }

      const exist = await db
        .collection('user_collection')
        .where({ _openid: openid, record_id: recordId })
        .limit(1)
        .get()
      if (!(exist.data && exist.data.length)) {
        await db.collection('user_collection').add({
          data: {
            _openid: openid,
            record_id: recordId,
            category,
            created_at: Date.now()
          }
        })
      }
      await db.collection('identification_records').doc(recordId).update({
        data: { is_bookmarked: true, updated_at: Date.now() }
      })
      return { success: true, bookmarked: true, category }
    } catch (e) {
      console.error('save_atlas', e)
      return { success: false, msg: e.message || '保存失败' }
    }
  }

  // 纠错反馈（替代客户端直写 identification_feedback）
  if (action === 'submit_feedback') {
    const openid = wxContext.OPENID
    if (!openid) return { success: false, msg: '未登录' }
    const recordId = String(event.record_id || '').trim()
    const corrected = String(event.corrected_name_zh || '').trim().slice(0, 80)
    const note = String(event.note || '').trim().slice(0, 500)
    const original = String(event.original_name_zh || '').trim().slice(0, 80)
    if (!recordId) return { success: false, msg: '缺少 record_id' }
    if (!corrected) return { success: false, msg: '请填写正确的中文名' }
    try {
      const rec = await db.collection('identification_records').doc(recordId).get()
      const doc = rec.data
      if (!doc) return { success: false, msg: '记录不存在' }
      if (doc._openid && doc._openid !== openid) return { success: false, msg: '无权操作该记录' }
      await db.collection('identification_feedback').add({
        data: {
          _openid: openid,
          record_id: recordId,
          corrected_name_zh: corrected,
          note,
          original_name_zh: original || ((doc.species_info && doc.species_info.species_name_zh) || ''),
          created_at: Date.now()
        }
      })
      return { success: true }
    } catch (e) {
      console.error('submit_feedback', e)
      return { success: false, msg: e.message || '提交失败' }
    }
  }

  if (action === 'get_species_profile') {
    try {
      let species = event.species_info || {}
      let aiContent = event.ai_content || {}
      const recordId = String(event.record_id || '').trim()
      let relatedProducts = event.related_products || []
      const forceRefresh = event.force_refresh === true

      if (recordId) {
        const rec = await db.collection('identification_records').doc(recordId).get()
        const doc = rec.data
        if (!doc) return { success: false, msg: '记录不存在' }
        // 归属校验：本人可读；他人记录必须已主动公开分享（is_shared）
        // 原实现只看 isOwner 决定是否回写，却**不拦读取** → 拿到 record_id 即可读他人鉴定档案
        const isOwner = !!doc._openid && doc._openid === wxContext.OPENID
        if (!isOwner && !doc.is_shared) {
          return { success: false, code: 'FORBIDDEN', msg: '该鉴定记录未公开' }
        }
        species = doc.species_info || species
        aiContent = doc.ai_content || aiContent
        relatedProducts = doc.related_products_snapshot || relatedProducts
        if (
          !forceRefresh &&
          doc.species_profile &&
          doc.species_profile.profileVersion >= PROFILE_VERSION
        ) {
          return { success: true, data: { species_profile: doc.species_profile } }
        }

        const species_profile = await buildSpeciesProfile(db, _, species, {
          aiStructured: extractAiStructured(aiContent),
          productProtection: productProtectionFromList(relatedProducts),
          alternatives: (species && species.alternatives) || []
        })

        if (isOwner) {
          try {
            await db.collection('identification_records').doc(recordId).update({
              data: { species_profile, updated_at: Date.now() }
            })
          } catch (e) {
            console.warn('回写 species_profile 失败', e.message)
          }
        }

        return { success: true, data: { species_profile } }
      }

      const species_profile = await buildSpeciesProfile(db, _, species, {
        aiStructured: extractAiStructured(aiContent),
        productProtection: productProtectionFromList(relatedProducts),
        alternatives: (species && species.alternatives) || []
      })
      return { success: true, data: { species_profile } }
    } catch (e) {
      console.error('get_species_profile 失败', e)
      return { success: false, msg: e.message || '补全失败' }
    }
  }

  if (!image_file_id) {
    return { success: false, msg: '缺少 image_file_id' }
  }

  const categoryHint = String(category_hint || '').trim()
  const entrySource = String(entry_source || '').trim()

  const apiKey = process.env.DASHSCOPE_API_KEY || ''
  const forceMock = use_mock === true

  if (!forceMock && !apiKey) {
    return {
      success: false,
      msg: '未配置 AI 密钥：请在云开发控制台 → 云函数 identifySpecimen → 环境变量中添加 DASHSCOPE_API_KEY',
      error_type: AI_SERVICE_ERROR
    }
  }

  try {
    let fileBuf
    try {
      const dl0 = await cloud.downloadFile({ fileID: image_file_id })
      fileBuf = dl0.fileContent
    } catch (e) {
      return { success: false, msg: '无法读取云存储图片' }
    }

    // ---- 内容安全：鉴定照片可能被公开分享，先过图检 ----
    // risky → 直接拒绝（同时也避免把违规图送进大模型）；
    // 检测不可用 → 允许本人查看，但禁止公开分享（见 is_shared 门禁）。
    const imageCheck = await checkImageBuffer(fileBuf)
    if (imageCheck.reason === 'risky') {
      return { success: false, msg: '该图片未通过安全检测，请更换一张清晰、合规的藏品照片' }
    }
    const imageChecked = !!imageCheck.ok

    const contentHash = crypto.createHash('sha256').update(fileBuf).digest('hex')

    // P3：同图缓存（不重复调用大模型 API）
    if (!forceMock) {
      try {
        const cached = await db
          .collection('identification_cache')
          .where({ _openid: wxContext.OPENID, content_hash: contentHash })
          .limit(1)
          .get()
        // 需求 1 兜底：identification_cache 的写入失败是被吞掉的，此时改从记录自身
        // 的 content_hash 匹配，避免「缓存缺失 → 每次重跑大模型 + 重复建记录」。
        let cachedRecordId = (cached.data && cached.data[0] && cached.data[0].record_id) || ''
        if (!cachedRecordId) {
          try {
            const byHash = await db
              .collection('identification_records')
              .where({ _openid: wxContext.OPENID, content_hash: contentHash })
              .orderBy('created_at', 'desc')
              .limit(1)
              .get()
            cachedRecordId = (byHash.data && byHash.data[0] && byHash.data[0]._id) || ''
          } catch (e) {
            console.warn('按 content_hash 回查记录失败', e.message)
          }
        }
        if (cachedRecordId) {
          const sourceId = cachedRecordId
          const prev = await db.collection('identification_records').doc(sourceId).get()
          if (prev.data && prev.data.species_info) {
            const now = Date.now()
            const snap = prev.data.related_products_snapshot || []
            const wikiSnap = prev.data.related_wiki_snapshot || []
            let species_profile = prev.data.species_profile
            if (!species_profile) {
              try {
                species_profile = await buildSpeciesProfile(db, _, prev.data.species_info, {
                  aiStructured: extractAiStructured(prev.data.ai_content),
                  productProtection: productProtectionFromList(snap),
                  alternatives: (prev.data.species_info && prev.data.species_info.alternatives) || []
                })
              } catch (e) {
                console.warn('缓存记录补全 species_profile 失败', e.message)
                species_profile = null
              }
            }
            // 需求 1：同图**复用既有记录**，不再每次 add 一条。
            // 原实现命中缓存后仍 add 新记录（仅标记 from_image_cache），于是
            // 「同一张图识别 10 次」会留下 10 条 identification_records，
            // 但只消耗 1 次大模型调用 —— 记录、图鉴、站内信全部重复。
            // 复用是安全的：save_atlas 本就按 {_openid, record_id} 幂等，
            // 分享 / 反馈 / 图鉴日志都以该 record_id 为外键，指向同一份识别结果。
            await db.collection('identification_records').doc(sourceId).update({
              data: {
                // 记录「最近一次同图识别」，便于统计复用率与排查
                last_reused_at: now,
                reuse_count: _.inc(1),
                updated_at: now
              }
            })
            return {
              success: true,
              data: {
                record_id: sourceId,
                species_info: prev.data.species_info,
                ai_content: prev.data.ai_content,
                species_profile,
                related_products: snap,
                related_wiki: wikiSnap,
                confidence_level: prev.data.confidence_level,
                from_cache: true
              }
            }
          }
        }
      } catch (e) {
        console.warn('identification_cache 查询失败，继续走识别', e.message)
      }
    }

    let tempUrl = ''
    try {
      const fu = await cloud.getTempFileURL({ fileList: [image_file_id] })
      const f = fu.fileList && fu.fileList[0]
      tempUrl = (f && f.tempFileURL) || ''
    } catch (e) {
      console.warn('getTempFileURL', e)
    }

    let species_info
    let ai_content
    let knowledge = null

    if (forceMock) {
      species_info = { ...MOCK_SPECIES }
      ai_content = { ...MOCK_AI }
    } else {
      species_info = await identifyWithVision(tempUrl, fileBuf, apiKey, categoryHint, trace)

      const needScience =
        species_info.is_specimen !== false && typeof species_info.confidence === 'number' && species_info.confidence >= 0.6

      if (needScience) {
        try {
          knowledge = await fetchSpeciesKnowledge(db, _, species_info.species_name_zh, species_info.species_name_latin)
          ai_content = await callQwenText(buildSciencePrompt(species_info, knowledge), apiKey, trace)
        } catch (e) {
          console.error('科普生成失败', e)
          ai_content = {
            content: species_info.brief_description || '暂无法生成详细科普，请稍后在网络良好时重试。',
            fun_fact: ''
          }
        }
      } else {
        ai_content = {
          content:
            species_info.brief_description ||
            (species_info.is_specimen === false
              ? '未检测到生物标本，请尝试拍摄清晰的标本或动植物主体。'
              : '识别置信度偏低，建议更换角度与光线后重新拍摄。'),
          fun_fact: ''
        }
      }
    }

    // ── 需求 1（业务决策 2026-09-16：**同物种去重**）────────────────────────────
    // 「同一物种只保留一条鉴定记录 / 一个图鉴」：换角度重拍同一件标本（图片指纹不同）
    // 或上传同物种的另一件，都复用该用户对**该物种**的首条记录，不再新建。
    //
    // 去重键选 `species_name_latin`（学名）优先、中文名兜底：
    //   - 学名是跨语言稳定标识，避免「大蓝闪蝶 / 蓝闪蝶」这类中文别名各建一条
    //   - `is_specimen === false`（未识别出标本）**不参与物种去重** ——
    //     否则用户拍任意非标本照片都会被并进同一条「未知」记录
    // 命中即返回既有记录（record_id 与首条相同），客户端会提示「已跳过重复识别」。
    const speciesDedupKey = buildSpeciesDedupKey(species_info)
    if (speciesDedupKey) {
      try {
        const hit = await db
          .collection('identification_records')
          .where({ _openid: wxContext.OPENID, species_dedup_key: speciesDedupKey })
          .orderBy('created_at', 'desc')
          .limit(1)
          .get()
        const prev = hit.data && hit.data[0]
        if (prev && prev.species_info) {
          const now = Date.now()
          await db.collection('identification_records').doc(prev._id).update({
            data: { last_reused_at: now, reuse_count: _.inc(1), updated_at: now }
          })
          return {
            success: true,
            data: {
              record_id: prev._id,
              species_info: prev.species_info,
              ai_content: prev.ai_content,
              species_profile: prev.species_profile || null,
              related_products: prev.related_products_snapshot || [],
              related_wiki: prev.related_wiki_snapshot || [],
              confidence_level: prev.confidence_level,
              from_cache: true,
              // 区分两种复用来源，便于埋点区分「同图」与「同物种」
              reuse_reason: 'same_species',
              species_dedup_key: speciesDedupKey
            }
          }
        }
      } catch (e) {
        console.warn('species_dedup_key 查询失败，继续建新记录', e.message)
      }
    }

    const confidence_level = confidenceToLevel(species_info.confidence, species_info.is_specimen !== false)
    const [related_products, related_wiki] = await Promise.all([
      fetchAllRelatedProducts(species_info),
      fetchRelatedWikiArchive(species_info)
    ])

    let species_profile = null
    try {
      species_profile = await buildSpeciesProfile(db, _, species_info, {
        knowledge,
        aiStructured: extractAiStructured(ai_content),
        productProtection: productProtectionFromList(related_products),
        alternatives: species_info.alternatives || []
      })
    } catch (e) {
      console.warn('species_profile 构建失败', e.message)
    }

    const now = Date.now()
    const addRes = await db.collection('identification_records').add({
      data: {
        _openid: wxContext.OPENID,
        image_url: image_file_id,
        species_info,
        // 需求 1：同物种去重键（学名优先），后续同物种识别直接命中本记录
        species_dedup_key: speciesDedupKey,
        ai_content,
        species_profile,
        is_bookmarked: false,
        related_products_snapshot: related_products,
        related_wiki_snapshot: related_wiki,
        confidence_level,
        entry_source: entrySource,
        category_hint: categoryHint,
        created_at: now,
        updated_at: now
      }
    })

    if (!forceMock) {
      await sendIdentifyNotification(wxContext.OPENID, addRes._id, species_info)
      // 需求 1：把 contentHash 落到记录上，作为 identification_cache 的兜底索引。
      // 原实现只写 identification_cache，而那次写入失败是被吞掉的（"可忽略"），
      // 一旦失败，同一张图之后每次都会重新调用大模型并再建记录 —— 去重形同失效。
      try {
        await db.collection('identification_records').doc(addRes._id).update({
          data: { content_hash: contentHash }
        })
      } catch (e) {
        console.warn('回写 content_hash 失败', e.message)
      }
      try {
        await db.collection('identification_cache').add({
          data: {
            _openid: wxContext.OPENID,
            content_hash: contentHash,
            record_id: addRes._id,
            created_at: now
          }
        })
      } catch (e) {
        console.warn('写入 identification_cache 失败（可忽略）', e.message)
      }
    }

    return {
      success: true,
      data: {
        record_id: addRes._id,
        species_info,
        ai_content,
        related_products,
        related_wiki,
        species_profile,
        confidence_level,
        from_cache: false
      }
    }
  } catch (e) {
    console.error('identifySpecimen 失败', e)
    const out = {
      success: false,
      msg: e.message || '识别失败'
    }
    if (e && e.errorType === AI_SERVICE_ERROR) out.error_type = AI_SERVICE_ERROR
    return out
  }
}

// 旁路：鉴定调用写一条 ai_identify_logs（超管「AI 鉴定监测」）。
// 返回值必须是 identifyMain 的原对象；日志的任何失败都不得改变出参或抛出。
exports.main = async (event, context) => {
  if (!isIdentifyCall(event)) return identifyMain(event, context)
  const startedAt = Date.now()
  let openid = ''
  try {
    openid = (cloud.getWXContext() || {}).OPENID || ''
  } catch (e) { /* 取不到身份也照常鉴定 */ }
  let result
  const trace = {}
  try {
    result = await identifyMain(event, context, trace)
  } catch (err) {
    await writeIdentifyLog(db, event, null, { openid, startedAt, finishedAt: Date.now(), error: err, trace })
    throw err
  }
  await writeIdentifyLog(db, event, result, { openid, startedAt, finishedAt: Date.now(), trace })
  return result
}
