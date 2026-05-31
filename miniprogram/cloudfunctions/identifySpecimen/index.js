/**
 * AI 标本鉴定主云函数：视觉识别 + 科普文案 + 商品关联 + 识别记录落库
 * 环境变量：DASHSCOPE_API_KEY（阿里云 DashScope / 通义千问）
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
  fun_fact: '闪蝶的蓝色来自结构色，换个角度观察，颜色会悄然变化。'
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
    taxonomy: {
      kingdom: tax.kingdom || '',
      phylum: tax.phylum || '',
      class: tax.class || '',
      order: tax.order || '',
      family: tax.family || '',
      genus: tax.genus || ''
    },
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
  "taxonomy": { "kingdom":"界","phylum":"门","class":"纲","order":"目","family":"科","genus":"属" },
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
3. alternatives 最多 2 条，为除主结果外最可能的备选物种；若非常确定则返回空数组。`

function buildVisionPrompt(categoryHint) {
  let extra = ''
  if (categoryHint) {
    extra = `\n用户提示：图片更可能属于「${categoryHint}」类标本，请优先考虑该方向识别。`
  }
  return VISION_PROMPT_BASE + extra
}

async function callQwenVL(imageUrl, apiKey, categoryHint) {
  const prompt = buildVisionPrompt(categoryHint)
  const body = {
    model: 'qwen-vl-plus',
    input: {
      messages: [
        {
          role: 'user',
          content: [
            { image: imageUrl },
            { text: prompt }
          ]
        }
      ]
    }
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

async function callQwenVLWithBase64(dataUrl, apiKey, categoryHint) {
  const prompt = buildVisionPrompt(categoryHint)
  const body = {
    model: 'qwen-vl-plus',
    input: {
      messages: [
        {
          role: 'user',
          content: [
            { image: dataUrl },
            { text: prompt }
          ]
        }
      ]
    }
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

  let archive = ''
  if (knowledge && knowledge.description) {
    const src = knowledge.source === 'cms_wikis' ? '馆藏档案' : '物种知识库'
    archive = `\n${src}参考（请消化后自然融入叙述，勿整段照抄）：\n${String(knowledge.description).slice(0, 900)}`
  }

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
4. 输出格式：{"content":"科普正文","fun_fact":"单独一句话冷知识"}`
}

/** P3：从云库 species_knowledge / cms_wikis 取标准描述，增强科普 Prompt */
async function fetchSpeciesKnowledge(zh, latin) {
  try {
    if (zh) {
      const r = await db.collection('species_knowledge').where({ species_name_zh: zh }).limit(3).get()
      if (r.data && r.data.length) return { source: 'species_knowledge', ...r.data[0] }
    }
    if (latin) {
      const r2 = await db.collection('species_knowledge').where({ species_name_latin: latin }).limit(3).get()
      if (r2.data && r2.data.length) return { source: 'species_knowledge', ...r2.data[0] }
    }
  } catch (e) {
    console.warn('species_knowledge 查询跳过', e.message)
  }

  const orConds = []
  if (zh && zh.length >= 2) {
    orConds.push({ title: db.RegExp({ regexp: escapeRegExp(zh.slice(0, 12)), options: 'i' }) })
  }
  if (latin && latin.length >= 3) {
    orConds.push({ latinName: db.RegExp({ regexp: escapeRegExp(latin.slice(0, 20)), options: 'i' }) })
  }
  if (!orConds.length) return null

  try {
    const res = await db
      .collection('cms_wikis')
      .where(_.and([{ status: _.neq('draft') }, _.or(orConds)]))
      .limit(1)
      .get()
    const w = res.data && res.data[0]
    if (w) {
      return {
        source: 'cms_wikis',
        species_name_zh: w.title,
        species_name_latin: w.latinName,
        description: w.brief || w.content || ''
      }
    }
  } catch (e) {
    console.warn('cms_wikis 知识查询跳过', e.message)
  }
  return null
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

async function callQwenText(prompt, apiKey) {
  const body = {
    model: 'qwen-turbo',
    input: {
      messages: [{ role: 'user', content: prompt }]
    },
    parameters: {
      result_format: 'message'
    }
  }
  const res = await httpsPostJson(TEXT_PATH, body, {
    Authorization: `Bearer ${apiKey}`
  })
  const text = extractTextGen(res)
  const parsed = parseJsonObject(text)
  if (parsed && parsed.content) {
    return {
      content: String(parsed.content),
      fun_fact: String(parsed.fun_fact || '')
    }
  }
  return {
    content: text.slice(0, 1200),
    fun_fact: ''
  }
}

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
          cover: imgs[0] || ''
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
        cover: imgs[0] || ''
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
      brief: w.brief || ''
    }))
  } catch (e) {
    console.warn('cms_wikis 关联失败', e.message)
    return []
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { action, image_file_id, use_mock, category_hint, entry_source } = event

  if (action === 'list_recent') {
    const limit = Math.min(Math.max(parseInt(event.limit, 10) || 5, 1), 20)
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
      msg: '未配置 AI 密钥：请在云开发控制台 → 云函数 identifySpecimen → 环境变量中添加 DASHSCOPE_API_KEY'
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

    const contentHash = crypto.createHash('sha256').update(fileBuf).digest('hex')

    // P3：同图缓存（不重复调用大模型 API）
    if (!forceMock) {
      try {
        const cached = await db
          .collection('identification_cache')
          .where({ _openid: wxContext.OPENID, content_hash: contentHash })
          .limit(1)
          .get()
        if (cached.data && cached.data.length) {
          const sourceId = cached.data[0].record_id
          const prev = await db.collection('identification_records').doc(sourceId).get()
          if (prev.data && prev.data.species_info) {
            const now = Date.now()
            const snap = prev.data.related_products_snapshot || []
            const wikiSnap = prev.data.related_wiki_snapshot || []
            const addDup = await db.collection('identification_records').add({
              data: {
                _openid: wxContext.OPENID,
                image_url: image_file_id,
                species_info: prev.data.species_info,
                ai_content: prev.data.ai_content,
                is_bookmarked: false,
                related_products_snapshot: snap,
                related_wiki_snapshot: wikiSnap,
                confidence_level: prev.data.confidence_level,
                from_image_cache: true,
                cache_source_record_id: sourceId,
                entry_source: entrySource || prev.data.entry_source || '',
                category_hint: categoryHint || prev.data.category_hint || '',
                created_at: now,
                updated_at: now
              }
            })
            await sendIdentifyNotification(wxContext.OPENID, addDup._id, prev.data.species_info)
            return {
              success: true,
              data: {
                record_id: addDup._id,
                species_info: prev.data.species_info,
                ai_content: prev.data.ai_content,
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

    if (forceMock) {
      species_info = { ...MOCK_SPECIES }
      ai_content = { ...MOCK_AI }
    } else {
      try {
        species_info = await callQwenVL(tempUrl, apiKey, categoryHint)
      } catch (e1) {
        console.warn('VL URL 调用失败，尝试 base64', e1.message)
        const dataUrl = bufferToDataUrl(fileBuf)
        species_info = await callQwenVLWithBase64(dataUrl, apiKey, categoryHint)
      }

      const needScience =
        species_info.is_specimen !== false && typeof species_info.confidence === 'number' && species_info.confidence >= 0.6

      if (needScience) {
        try {
          const knowledge = await fetchSpeciesKnowledge(species_info.species_name_zh, species_info.species_name_latin)
          ai_content = await callQwenText(buildSciencePrompt(species_info, knowledge), apiKey)
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

    const confidence_level = confidenceToLevel(species_info.confidence, species_info.is_specimen !== false)
    const [related_products, related_wiki] = await Promise.all([
      fetchAllRelatedProducts(species_info),
      fetchRelatedWikiArchive(species_info)
    ])

    const now = Date.now()
    const addRes = await db.collection('identification_records').add({
      data: {
        _openid: wxContext.OPENID,
        image_url: image_file_id,
        species_info,
        ai_content,
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
        confidence_level,
        from_cache: false
      }
    }
  } catch (e) {
    console.error('identifySpecimen 失败', e)
    return {
      success: false,
      msg: e.message || '识别失败'
    }
  }
}
