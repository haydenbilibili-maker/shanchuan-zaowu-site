/**
 * 馆藏模糊检索：分词 / 后缀剥离 / 同义词 / 多字段 OR / 相关度打分
 * 云端副本：SYNONYMS / 排序规则与小程序 utils/fuzzySearch.js 同步，修改时请两处一并更新。
 */

const MAX_TOKENS = 6
const MAX_OR_CONDS = 20

/** 品类/工艺后缀：剥掉后保留词干，提高「蝴蝶表」「水晶标本」等召回 */
const STRIP_SUFFIXES = [
  '装裱服务', '标本装裱', '装裱', '标本框', '画框', '相框',
  '标本', '挂画', '礼盒', '套装', '系列', '周边', '之宝',
  '表', '框', '裱'
]

/**
 * 同义词 / 品类扩展（小写键）
 * 枢纽词数组顺序即召回优先级：靠前的词优先占 OR 配额
 */
const SYNONYMS = {
  // —— 饰品 ——
  首饰: ['手链', '项链', '耳环', '戒指', '胸针', '手镯', '吊坠', '耳钉', '手串', '饰品'],
  饰品: ['首饰', '手链', '项链', '耳环', '戒指', '胸针', '手镯', '吊坠', '耳饰'],
  珠宝: ['首饰', '饰品', '项链', '戒指', '手链'],
  手链: ['首饰', '饰品', '手镯', '手串', 'bracelet'],
  手串: ['手链', '手镯', '首饰', '饰品'],
  手镯: ['首饰', '手链', '手串', '饰品'],
  项链: ['首饰', '饰品', '吊坠', 'necklace'],
  吊坠: ['项链', '首饰', '饰品'],
  耳环: ['首饰', '饰品', '耳钉', '耳饰', 'earring'],
  耳钉: ['耳环', '耳饰', '首饰', '饰品'],
  耳饰: ['耳环', '耳钉', '首饰', '饰品'],
  戒子: ['戒指', '指环', '首饰', '饰品'],
  戒指: ['戒子', '首饰', '饰品', '指环', 'ring'],
  指环: ['戒指', '戒子', '首饰'],
  胸针: ['首饰', '饰品', '别针', 'brooch'],
  别针: ['胸针', '首饰'],
  jewelry: ['首饰', '饰品', '手链', '项链'],
  bracelet: ['手链', '手镯', '首饰'],
  necklace: ['项链', '吊坠', '首饰'],
  earring: ['耳环', '耳钉', '首饰'],
  ring: ['戒指', '首饰'],
  brooch: ['胸针', '首饰'],

  // —— 装裱 / 框 ——
  蝴蝶: ['蝶', '闪蝶', '蓝闪蝶', 'morpho', 'butterfly'],
  蝶: ['蝴蝶', '闪蝶'],
  闪蝶: ['蝴蝶', '蓝闪蝶', 'morpho'],
  蓝闪蝶: ['闪蝶', '蝴蝶', 'morpho'],
  表: ['装裱', '画框', '标本框', '框'],
  装裱: ['裱', '画框', '框', '标本框', '相框'],
  裱: ['装裱', '画框'],
  框: ['画框', '标本框', '装裱', '相框'],
  画框: ['框', '装裱', '标本框', '相框'],
  相框: ['画框', '标本框', '装裱'],
  标本框: ['画框', '装裱', '相框', '框'],

  // —— 昆虫 / 甲虫 ——
  独角仙: ['独角', '甲虫', 'dynastes'],
  甲虫: ['独角仙', '锹甲', '金龟', '甲虫标本'],
  锹甲: ['甲虫', '独角仙'],
  金龟: ['甲虫', '独角仙'],
  昆虫: ['insecta', '甲虫', '蝴蝶', '蛾'],
  蛾: ['昆虫', '蝴蝶'],

  // —— 矿石 / 晶体 ——
  水晶: ['crystal', '石英', '晶簇', '矿石'],
  矿石: ['矿物', 'mineral', '晶体', '晶簇', '原石', '水晶'],
  矿物: ['矿石', 'mineral', '晶体', '原石'],
  晶体: ['晶簇', '矿石', '矿物', '水晶'],
  晶簇: ['晶体', '水晶', '矿石'],
  原石: ['矿石', '矿物', '晶体'],
  紫水晶: ['水晶', '矿石', 'amethyst'],
  萤石: ['矿石', '矿物', '晶体'],
  mineral: ['矿石', '矿物', '晶体'],
  crystal: ['水晶', '晶体', '晶簇'],

  // —— 海洋 / 植物 ——
  植物: ['plantae', '植物标本', '叶片', '干花', '花'],
  干花: ['植物', '花'],
  海洋: ['marine', '贝壳', '珊瑚', '海螺'],
  贝壳: ['海洋', '海螺', 'marine'],
  珊瑚: ['海洋', 'marine'],
  海螺: ['贝壳', '海洋'],

  // —— 场景 / 运营词 ——
  镇店: ['镇店之宝', 'gold', '镇馆'],
  礼物: ['礼盒', '礼品', '送礼'],
  礼品: ['礼物', '礼盒'],
  礼盒: ['礼物', '礼品', '套装'],
  化石: ['古生物', '标本'],
  猫头鹰: ['owl', '猛禽'],
  morpho: ['闪蝶', '蓝闪蝶', '蝴蝶'],
  butterfly: ['蝴蝶', '闪蝶'],
  gold: ['金色', '镇店']
}

/** 短词噪声：不作独立检索 token（除非用户原词就是它） */
const NOISE_TOKENS = new Set([
  '系列', '周边', '套装', '之宝', '标本', '服务', '一个', '什么', '怎么'
])

const PRODUCT_FIELDS = [
  'title', 'latinName', 'category', 'englishName',
  'rootCategoryName', 'subtitle', 'tags', 'origin'
]

const WIKI_FIELDS = ['title', 'latinName', 'brief', 'category', 'tags', 'englishName']
const ACTIVITY_FIELDS = ['title', 'subtitle', 'description']
const FRAMER_FIELDS = ['name', 'title', 'type', 'description']

/** 查询优先字段；多 token 时会再瘦身为 LEAN_PRIMARY */
const PRIMARY_FIELDS = ['title', 'name', 'category', 'tags', 'latinName']
const LEAN_PRIMARY = ['title', 'name', 'category', 'tags']

/**
 * 主题意图排序（在 token 相关度之上加减分）
 * — 蝴蝶类 query：优先标本/玻璃罩/相框/昆虫馆；弱化名称带「蝴蝶」的项链钟表等衍生品
 * — 仅当用户原词未明确搜首饰/钟表时生效（如搜「蝴蝶项链」则不降权项链）
 */
const BUTTERFLY_INTENT_QUERY_RE = /蝴蝶|闪蝶|蓝闪蝶|大蓝闪蝶|鳞翅|morpho|butterfly/i
const ACCESSORY_INTENT_IN_QUERY_RE = /项链|手链|耳环|耳钉|吊坠|戒指|戒子|指环|胸针|手镯|手串|耳饰|首饰|饰品|钟表|手表|腕表|手环/
const INSECT_CATEGORY_RE = /昆虫|鳞翅|蝴蝶|蝶|insecta/i
const INSECT_HALL_CATEGORY_RE = /昆虫馆/
const SPECIMEN_PRESENTATION_RE = /玻璃罩|相框|标本框|画框|标本|展翅|装裱|蝶翅|昆虫|闪蝶|cloche|diorama/i
/** 标本本体呈现（非首饰衍生品）：相框 / 玻璃罩等保持高权重 */
const SPECIMEN_FRAMING_RE = /玻璃罩|相框|标本框|画框|展翅|装裱|cloche|diorama/i
const BUTTERFLY_SPECIES_TITLE_RE = /大蓝闪蝶|光明女神闪蝶|蓝闪蝶|morpho\s*menelaus|morpho/i
const DERIVATIVE_ACCESSORY_TITLE_RE = /项链|手链|耳环|耳钉|吊坠|戒指|指环|胸针|手镯|手串|耳饰|首饰|饰品|钟表|手表|腕表|手环/
const DERIVATIVE_ROOT_RE = /首饰馆|饰品馆|衍生品/
const SPECIMEN_CRAFT_TYPES = new Set([
  'cloche',
  'cloche_round',
  'cloche_cylinder',
  'frame',
  'wing_art',
  'diorama'
])
const SPECIMEN_CRAFT_PROCESSES = new Set([
  'immersion',
  'plastination',
  'taxidermy'
])

function queryExplicitlyAccessoryIntent(raw) {
  return ACCESSORY_INTENT_IN_QUERY_RE.test(normalizeKeyword(raw))
}

function isButterflySearchIntent(raw) {
  const kw = normalizeKeyword(raw)
  if (!kw) return false
  if (BUTTERFLY_INTENT_QUERY_RE.test(kw)) return true
  // 短 query「蝶」仍视为找虫而非首饰（除非原词含首饰词）
  if (/蝶/.test(kw) && kw.length <= 8) return true
  return false
}

function applyButterflyIntentRanking(item, raw) {
  if (!isButterflySearchIntent(raw)) return 0

  const title = String(item.title || item.name || '')
  if (queryExplicitlyAccessoryIntent(raw)) {
    return DERIVATIVE_ACCESSORY_TITLE_RE.test(title) ? 58 : 0
  }

  const kw = normalizeKeyword(raw)
  const latin = String(item.latinName || '')
  const category = `${item.category || ''} ${item.rootCategoryName || ''}`
  const craft = String(item.craftType || '').toLowerCase()
  const craftProcess = String(item.craftProcess || '').toLowerCase()

  let adj = 0

  const isAccessoryTitle = DERIVATIVE_ACCESSORY_TITLE_RE.test(title)
  const butterflyInTitle = /蝴蝶|闪蝶|蝶/.test(title)

  if (INSECT_CATEGORY_RE.test(category)) adj += 62
  if (INSECT_HALL_CATEGORY_RE.test(category)) adj += 52
  if (DERIVATIVE_ROOT_RE.test(category) && !INSECT_CATEGORY_RE.test(category)) adj -= 58
  if (DERIVATIVE_ROOT_RE.test(category) && butterflyInTitle) adj -= 40

  if (SPECIMEN_PRESENTATION_RE.test(title)) adj += 52
  if (SPECIMEN_FRAMING_RE.test(title) && !isAccessoryTitle) adj += 44
  if (SPECIMEN_CRAFT_TYPES.has(craft)) adj += 42
  if (SPECIMEN_CRAFT_PROCESSES.has(craftProcess)) adj += 36

  if (BUTTERFLY_SPECIES_TITLE_RE.test(title) && !isAccessoryTitle) adj += 46
  if (/大蓝闪蝶/.test(kw) && /大蓝闪蝶/.test(title) && !isAccessoryTitle) adj += 88
  else if (/蓝闪蝶/.test(kw) && /蓝闪蝶|大蓝闪蝶/.test(title) && !isAccessoryTitle) adj += 62
  else if (/闪蝶|蝶/.test(kw) && /闪蝶/.test(title) && !isAccessoryTitle) adj += 36
  if (/morpho/i.test(kw)) {
    if (/morpho/i.test(latin) && !isAccessoryTitle) adj += 72
    else if (/morpho/i.test(title) && !isAccessoryTitle) adj += 54
  }
  if (/大蓝闪蝶|蓝闪蝶/.test(kw) && /morpho\s*menelaus/i.test(latin) && !isAccessoryTitle) adj += 76

  if (isAccessoryTitle) {
    if (butterflyInTitle) adj -= 125
    else adj -= 48
  } else if (butterflyInTitle && INSECT_CATEGORY_RE.test(category)) {
    adj += 32
  }

  return adj
}

const _synonymValueSet = (function buildSynValueSet() {
  const set = new Set()
  Object.keys(SYNONYMS).forEach((k) => {
    set.add(String(k).toLowerCase())
    ;(SYNONYMS[k] || []).forEach((v) => set.add(String(v).toLowerCase()))
  })
  return set
})()

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeKeyword(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 48)
}

function isCjk(ch) {
  return /[\u4e00-\u9fff]/.test(ch)
}

function isMostlyCjk(text) {
  const s = String(text || '')
  if (!s) return false
  let cjk = 0
  for (let i = 0; i < s.length; i++) if (isCjk(s[i])) cjk++
  return cjk >= Math.ceil(s.length * 0.5)
}

function isDictToken(text) {
  return _synonymValueSet.has(String(text || '').toLowerCase())
}

function splitParts(keyword) {
  return String(keyword)
    .split(/[\s,，、|/＋+·.。;；:：]+/)
    .map((p) => p.trim())
    .filter(Boolean)
}

function stripSuffixes(text) {
  let s = String(text || '')
  const stems = []
  const suffixes = []
  let changed = true
  while (changed && s.length >= 3) {
    changed = false
    for (let i = 0; i < STRIP_SUFFIXES.length; i++) {
      const suf = STRIP_SUFFIXES[i]
      if (s.length > suf.length && s.endsWith(suf)) {
        s = s.slice(0, -suf.length)
        suffixes.push(suf)
        if (s.length >= 2) stems.push(s)
        changed = true
        break
      }
    }
  }
  return { stems, suffixes }
}

function expandSynonyms(token, bucket) {
  const key = String(token || '').toLowerCase()
  const list = SYNONYMS[key] || SYNONYMS[token]
  if (!list) return
  list.forEach((w) => {
    const t = String(w || '').trim()
    if (t.length >= 2 && !NOISE_TOKENS.has(t)) bucket.add(t)
  })
}

function addCjkPieces(text, bucket) {
  const s = String(text || '')
  if (s.length < 2) return
  bucket.add(s)

  const { stems, suffixes } = stripSuffixes(s)
  stems.forEach((stem) => {
    if (stem.length >= 2) bucket.add(stem)
  })
  suffixes.forEach((suf) => {
    if (suf.length >= 2 && !NOISE_TOKENS.has(suf)) bucket.add(suf)
    expandSynonyms(suf, bucket)
  })

  // 仅保留二字前缀，避免「水晶标」这类中间前缀噪声
  if (s.length >= 3) {
    bucket.add(s.slice(0, 2))
  }

  // 字典命中的子串才作额外召回（短词防噪）
  if (s.length >= 4) {
    for (let len = 2; len <= 3; len++) {
      for (let i = 0; i <= s.length - len; i++) {
        const piece = s.slice(i, i + len)
        if (isDictToken(piece) && !NOISE_TOKENS.has(piece)) bucket.add(piece)
      }
    }
  }
}

/**
 * 生成检索 token（原词 / 词干 / 枢纽同义优先）
 */
function tokenizeKeyword(raw) {
  const keyword = normalizeKeyword(raw)
  if (!keyword) return []

  const bucket = new Set()
  const stemPreferred = []
  bucket.add(keyword)

  const parts = splitParts(keyword)
  parts.forEach((part) => {
    if (isMostlyCjk(part)) {
      addCjkPieces(part, bucket)
      const stripped = stripSuffixes(part)
      // 词干及物种同义优先于装裱等后缀同义
      stripped.stems.forEach((s) => {
        stemPreferred.push(s)
        const stemSyn = SYNONYMS[s] || SYNONYMS[String(s).toLowerCase()]
        if (stemSyn) stemSyn.slice(0, 3).forEach((w) => stemPreferred.push(w))
      })
      if (part.length >= 3) stemPreferred.push(part.slice(0, 2))
      stripped.suffixes.forEach((suf) => {
        const syn = SYNONYMS[suf] || SYNONYMS[String(suf).toLowerCase()]
        if (syn) syn.slice(0, 2).forEach((w) => stemPreferred.push(w))
      })
      const hubSyn = SYNONYMS[part] || SYNONYMS[String(part).toLowerCase()]
      if (hubSyn) hubSyn.forEach((w) => stemPreferred.push(w))
    } else {
      bucket.add(part)
      stemPreferred.push(part)
      const hubSyn = SYNONYMS[String(part).toLowerCase()]
      if (hubSyn) hubSyn.forEach((w) => stemPreferred.push(w))
      if (part.length >= 4) {
        bucket.add(part.slice(0, Math.min(part.length, 8)))
      }
    }
  })

  Array.from(bucket).forEach((t) => expandSynonyms(t, bucket))

  const valid = (t) => {
    const s = String(t || '').trim()
    if (!s) return false
    if (s === keyword) return true
    if (NOISE_TOKENS.has(s) || NOISE_TOKENS.has(s.toLowerCase())) return false
    if (isMostlyCjk(s)) return s.length >= 2
    return s.length >= 2
  }

  const ordered = []
  const seen = new Set()
  const push = (t) => {
    if (!valid(t)) return
    const k = String(t).toLowerCase()
    if (seen.has(k)) return
    seen.add(k)
    ordered.push(String(t).trim())
  }

  push(keyword)
  stemPreferred.forEach(push)

  Array.from(bucket)
    .filter(valid)
    .sort((a, b) => {
      const ad = isDictToken(a) ? 0 : 1
      const bd = isDictToken(b) ? 0 : 1
      if (ad !== bd) return ad - bd
      const ac = isMostlyCjk(a) ? 0 : 1
      const bc = isMostlyCjk(b) ? 0 : 1
      if (ac !== bc) return ac - bc
      return b.length - a.length || a.localeCompare(b, 'zh')
    })
    .forEach(push)

  return ordered.slice(0, MAX_TOKENS)
}

function suggestRelatedTerms(raw) {
  const keyword = normalizeKeyword(raw)
  if (!keyword) return []
  const stems = []
  splitParts(keyword).forEach((part) => {
    if (isMostlyCjk(part)) {
      stems.push(part)
      const stripped = stripSuffixes(part)
      stripped.stems.forEach((s) => stems.push(s))
      stripped.suffixes.forEach((s) => {
        if (s.length >= 2 && !NOISE_TOKENS.has(s)) stems.push(s)
        const syn = SYNONYMS[s] || SYNONYMS[s.toLowerCase()]
        if (syn && syn[0]) stems.push(syn[0])
      })
      if (part.length >= 3) stems.push(part.slice(0, 2))
      const hubSyn = SYNONYMS[part] || SYNONYMS[String(part).toLowerCase()]
      if (hubSyn) hubSyn.slice(0, 4).forEach((w) => stems.push(w))
    } else {
      stems.push(part)
      const hubSyn = SYNONYMS[String(part).toLowerCase()]
      if (hubSyn) hubSyn.slice(0, 3).forEach((w) => stems.push(w))
    }
  })
  const seen = new Set()
  return stems
    .filter((t) => t && t !== keyword && t.length >= 2 && !NOISE_TOKENS.has(t))
    .filter((t) => {
      const k = t.toLowerCase()
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .slice(0, 4)
}

function prioritizeFields(fields) {
  const list = (fields || []).filter(Boolean)
  const primary = []
  const secondary = []
  const seen = new Set()
  PRIMARY_FIELDS.forEach((f) => {
    if (list.indexOf(f) !== -1 && !seen.has(f)) {
      seen.add(f)
      primary.push(f)
    }
  })
  list.forEach((f) => {
    if (!seen.has(f)) {
      seen.add(f)
      secondary.push(f)
    }
  })
  return primary.concat(secondary)
}

function pickQueryFields(fields, tokenCount) {
  const ordered = prioritizeFields(fields)
  const primaryAll = ordered.filter((f) => PRIMARY_FIELDS.indexOf(f) !== -1)
  const secondary = ordered.filter((f) => PRIMARY_FIELDS.indexOf(f) === -1)
  // token 多时瘦身主字段，把 OR 配额留给同义词
  const primary = tokenCount >= 4
    ? primaryAll.filter((f) => LEAN_PRIMARY.indexOf(f) !== -1)
    : primaryAll
  return { primary, secondary }
}

function buildFieldOrConds(db, tokens, fields) {
  const conds = []
  const limitedTokens = (tokens || []).slice(0, MAX_TOKENS)
  const { primary, secondary } = pickQueryFields(fields, limitedTokens.length)

  const pushTokenFields = (tokenList, fieldList) => {
    for (let i = 0; i < tokenList.length; i++) {
      const re = db.RegExp({
        regexp: escapeRegExp(tokenList[i]),
        options: 'i'
      })
      for (let j = 0; j < fieldList.length; j++) {
        conds.push({ [fieldList[j]]: re })
        if (conds.length >= MAX_OR_CONDS) return true
      }
    }
    return false
  }

  if (pushTokenFields(limitedTokens, primary)) return conds
  if (tokenCountAllowsSecondary(limitedTokens.length)) {
    if (pushTokenFields(limitedTokens.slice(0, 2), secondary.slice(0, 2))) return conds
  }
  return conds
}

function tokenCountAllowsSecondary(n) {
  return n <= 3
}

function buildKeywordCondition(db, command, raw, fields) {
  const tokens = tokenizeKeyword(raw)
  if (!tokens.length) return null
  const conds = buildFieldOrConds(db, tokens, fields || PRODUCT_FIELDS)
  if (!conds.length) return null
  if (conds.length === 1) return conds[0]
  return command.or(conds)
}

function itemHaystack(item) {
  return [
    item.title,
    item.name,
    item.latinName,
    item.englishName,
    item.category,
    item.rootCategoryName,
    item.subtitle,
    item.brief,
    item.origin,
    item.description,
    Array.isArray(item.tags) ? item.tags.join(' ') : item.tags
  ]
    .map((x) => String(x || '').toLowerCase())
    .join(' ')
}

function scoreItemAgainstKeyword(item, raw) {
  const keyword = normalizeKeyword(raw)
  if (!keyword || !item) return 0
  const tokens = tokenizeKeyword(keyword)
  const title = String(item.title || item.name || '').toLowerCase()
  const hay = itemHaystack(item)
  const kwLower = keyword.toLowerCase()

  let score = 0

  if (title === kwLower) score += 220
  else if (title.startsWith(kwLower)) score += 140
  else if (title.includes(kwLower)) score += 90
  else if (hay.includes(kwLower)) score += 50

  tokens.forEach((t, idx) => {
    const tl = t.toLowerCase()
    if (!hay.includes(tl)) return
    // 前几个 token（原词/词干）权重更高，后缀工艺同义靠后
    const weight = Math.max(5, 42 - idx * 7)
    score += weight
    if (title === tl) score += 48
    else if (title.startsWith(tl)) score += 32
    else if (title.includes(tl)) score += 20
    else if (Array.isArray(item.tags) && item.tags.some((tag) => String(tag).toLowerCase().includes(tl))) {
      score += 10
    }
  })

  // 类型轻权重：藏品略优先于档案（搜索主场景是买/逛）
  if (item._searchType === 'product') score += 4
  else if (item._searchType === 'wiki') score += 2

  score += applyButterflyIntentRanking(item, raw)

  return score
}

function rankByKeyword(list, raw) {
  return (list || [])
    .map((item, index) => ({
      item,
      index,
      score: scoreItemAgainstKeyword(item, raw)
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => {
      const next = row.item
      if (next && typeof next === 'object') next._matchScore = row.score
      return next
    })
}

module.exports = {
  escapeRegExp,
  normalizeKeyword,
  tokenizeKeyword,
  suggestRelatedTerms,
  buildKeywordCondition,
  scoreItemAgainstKeyword,
  rankByKeyword,
  PRODUCT_FIELDS,
  WIKI_FIELDS,
  ACTIVITY_FIELDS,
  FRAMER_FIELDS,
  MAX_OR_CONDS,
  MAX_TOKENS
}
