/**
 * 鉴定结果物种档案：从 species_knowledge / cms_wikis / 商品著录补全
 * 保护等级只取已著录字段，绝不编造 IUCN / 国家名录 / CITES
 */

const TAXONOMY_ORDER = [
  { key: 'kingdom', label: '界' },
  { key: 'phylum', label: '门' },
  { key: 'class', label: '纲' },
  { key: 'order', label: '目' },
  { key: 'family', label: '科' },
  { key: 'genus', label: '属' }
]

const IUCN_LABELS = {
  EX: '绝灭 EX',
  EW: '野外绝灭 EW',
  CR: '极危 CR',
  EN: '濒危 EN',
  VU: '易危 VU',
  NT: '近危 NT',
  LC: '无危 LC',
  DD: '数据缺乏 DD',
  NE: '未评估 NE'
}

const IUCN_ZH = {
  绝灭: 'EX',
  灭绝: 'EX',
  野外绝灭: 'EW',
  野外灭绝: 'EW',
  极危: 'CR',
  濒危: 'EN',
  易危: 'VU',
  近危: 'NT',
  无危: 'LC',
  低危: 'LC',
  数据缺乏: 'DD',
  数据不足: 'DD',
  未评估: 'NE'
}

const PRODUCT_PROTECTION = {
  sanyou: { label: '三有保护动物', tone: 'info' },
  protected_plant: { label: '保护植物', tone: 'warn' },
  protected_animal: { label: '保护动物', tone: 'warn' }
}

const PROFILE_VERSION = 2

const EMPTY_PROTECTION = '暂无等级'
const EMPTY_UNLISTED = '数据未著录'
const EMPTY_FIELD = '暂未著录'

const PROTECTION_HINTS = {
  china_1:
    '列入《国家重点保护野生动物名录》一级。禁止非法猎捕、杀害、收购、运输及出售；标本收藏须具备合法来源与许可证明。',
  china_2:
    '列入《国家重点保护野生动物名录》二级。禁止非法猎捕、买卖；合法收藏与展示须核验来源及必要许可。',
  china_plant:
    '列入国家重点保护野生植物名录。禁止非法采挖、买卖；标本来源须合法可溯。',
  sanyou:
    '列入《有重要生态、科学、社会价值的陆生野生动物名录》（三有）。禁止非法猎捕；收藏须合法来源。',
  iucn_ex: 'IUCN 评估为绝灭（EX），野外已无已知存活个体。',
  iucn_ew: 'IUCN 评估为野外绝灭（EW），仅存于人工饲养或收藏体系。',
  iucn_cr: 'IUCN 评估为极危（CR），野外种群面临极高灭绝风险。',
  iucn_en: 'IUCN 评估为濒危（EN），种群数量持续减少，需加强保护。',
  iucn_vu: 'IUCN 评估为易危（VU），面临较高灭绝风险。',
  iucn_nt: 'IUCN 评估为近危（NT），接近受威胁阈值。',
  iucn_lc: 'IUCN 评估为无危（LC），当前种群相对稳定。',
  iucn_dd: 'IUCN 标注数据缺乏（DD），尚不足以评估威胁等级。',
  cites_1:
    'CITES 附录 I：国际商业贸易严格管制；跨境流转须符合公约与国内法规。',
  cites_2: 'CITES 附录 II：国际贸易须许可与来源证明；收藏流转须合规。',
  cites_3: 'CITES 附录 III：部分国家提出管制要求；跨境须留意许可。',
  product:
    '馆藏商品标注提示：该物种在售卖链路中标记为需核验保护属性；交易须符合法律法规。'
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstText(...vals) {
  for (const v of vals) {
    if (v == null) continue
    if (typeof v === 'number' && Number.isFinite(v)) {
      const t = String(v).trim()
      if (t) return t
      continue
    }
    if (typeof v === 'string') {
      const t = stripHtml(v)
      if (t && !isPlaceholder(t)) return t
    }
  }
  return ''
}

function isPlaceholder(s) {
  const t = String(s || '').trim()
  if (!t) return true
  return /^(暂无|暂未著录|未知|未著录|无|none|n\/a|null|-|—|–)$/i.test(t)
}

function pickPath(obj, path) {
  if (!obj || typeof obj !== 'object') return undefined
  const parts = path.split('.')
  let cur = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[p]
  }
  return cur
}

function pickField(obj, paths) {
  if (!obj) return ''
  for (const path of paths) {
    const v = pickPath(obj, path)
    const t = firstText(v)
    if (t) return t
  }
  return ''
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function looksLikeMineral(taxonomy, nameZh) {
  const blob = `${(taxonomy && taxonomy.kingdom) || ''} ${(taxonomy && taxonomy.phylum) || ''} ${nameZh || ''}`
  return /矿物|矿石|晶体|石英|mineral/i.test(blob)
}

function buildTaxonomyRows(taxonomy) {
  const tax = taxonomy && typeof taxonomy === 'object' ? taxonomy : {}
  return TAXONOMY_ORDER.map((row) => {
    const value = firstText(tax[row.key])
    return value ? { label: row.label, value } : null
  }).filter(Boolean)
}

function iucnTone(code) {
  if (code === 'CR' || code === 'EN' || code === 'EW' || code === 'EX') return 'warn'
  if (code === 'VU' || code === 'NT') return 'brass'
  if (code === 'LC') return 'ok'
  return 'muted'
}

function normalizeIucn(raw) {
  const s = firstText(raw)
  if (!s) return null
  const compact = s.replace(/\s+/g, '')
  const upper = s.toUpperCase()
  const codeMatch = upper.match(/\b(EX|EW|CR|EN|VU|NT|LC|DD|NE)\b/)
  if (codeMatch) {
    const code = codeMatch[1]
    return { code, label: IUCN_LABELS[code], tone: iucnTone(code), hintKey: `iucn_${code.toLowerCase()}` }
  }
  for (const [zh, code] of Object.entries(IUCN_ZH)) {
    if (compact.indexOf(zh) !== -1) {
      return { code, label: IUCN_LABELS[code], tone: iucnTone(code), hintKey: `iucn_${code.toLowerCase()}` }
    }
  }
  return null
}

function normalizeChinaLevel(raw) {
  const s = firstText(raw)
  if (!s) return null
  const t = s.replace(/\s+/g, '')
  if (/国家一级|一级保护|national[_\s-]*1|class\s*i\b/i.test(t) && !/二级/.test(t)) {
    const isPlant = /植物/.test(t)
    return {
      label: isPlant ? '国家一级重点保护野生植物' : '国家一级重点保护野生动物',
      tone: 'warn',
      hintKey: isPlant ? 'china_plant' : 'china_1'
    }
  }
  if (/国家二级|二级保护|national[_\s-]*2|class\s*ii\b/i.test(t)) {
    const isPlant = /植物/.test(t)
    return {
      label: isPlant ? '国家二级重点保护野生植物' : '国家二级重点保护野生动物',
      tone: 'warn',
      hintKey: isPlant ? 'china_plant' : 'china_2'
    }
  }
  if (/三有/.test(t)) {
    return { label: '三有保护动物', tone: 'info', hintKey: 'sanyou' }
  }
  if (/保护植物/.test(t)) {
    return { label: '国家重点保护野生植物', tone: 'warn', hintKey: 'china_plant' }
  }
  if (/保护动物/.test(t)) {
    return { label: '国家重点保护野生动物', tone: 'warn', hintKey: 'china_2' }
  }
  if (/重点保护/.test(t)) {
    return {
      label: s.length > 24 ? '国家重点保护物种' : s,
      tone: 'warn',
      hintKey: /植物/.test(t) ? 'china_plant' : 'china_2'
    }
  }
  return { label: s, tone: 'brass', hintKey: '' }
}

function normalizeCites(raw) {
  const s = firstText(raw)
  if (!s) return null
  if (/未列入|未收录|未附录|不在|none|n\/a/i.test(s)) return null
  const t = s.replace(/\s+/g, '').toUpperCase().replace(/APPENDIX/g, '附录').replace(/APP\./g, '附录')
  if (/附录III|附录Ⅲ|附录3/.test(t) || t === 'III' || t === '3') {
    return { label: 'CITES 附录 III', tone: 'muted', hintKey: 'cites_3' }
  }
  if (/附录II|附录Ⅱ|附录2/.test(t) || t === 'II' || t === '2') {
    return { label: 'CITES 附录 II', tone: 'brass', hintKey: 'cites_2' }
  }
  if (/附录I|附录Ⅰ|附录1/.test(t) || t === 'I' || t === '1') {
    return { label: 'CITES 附录 I', tone: 'warn', hintKey: 'cites_1' }
  }
  if (/CITES/.test(t) || /附录/.test(t)) {
    return { label: s.length > 24 ? s.slice(0, 24) : s, tone: 'brass', hintKey: 'cites_2' }
  }
  return null
}

function mergeTaxonomy(primary, secondary) {
  const a = primary && typeof primary === 'object' ? primary : {}
  const b = secondary && typeof secondary === 'object' ? secondary : {}
  const out = {}
  TAXONOMY_ORDER.forEach(({ key }) => {
    out[key] = firstText(a[key], b[key])
  })
  return out
}

function sourceLabelOf(source) {
  if (source === 'species_knowledge') return '物种知识库'
  if (source === 'cms_wikis') return '馆藏档案'
  if (source === 'products') return '馆藏标注'
  if (source === 'ai') return '识别模型整理'
  if (source === 'mixed') return '馆藏著录'
  return ''
}

function pushUniqueTag(tags, tag) {
  if (!tag || !tag.label) return
  const key = `${tag.system}::${tag.label}`
  if (tags.some((t) => `${t.system}::${t.label}` === key)) return
  tags.push(tag)
}

function collectProtectionTags(knowledge, wiki, productProtection) {
  const tags = []
  const pools = [knowledge, wiki].filter(Boolean)

  pools.forEach((doc) => {
    const iucn = normalizeIucn(
      pickField(doc, [
        'iucn',
        'iucnStatus',
        'iucn_status',
        'iucnRedList',
        'redList',
        'red_list',
        'conservation.iucn',
        'conservation.iucnStatus',
        'conservationStatus.iucn',
        'protection.iucn'
      ])
    )
    if (iucn) {
      pushUniqueTag(tags, {
        key: 'iucn',
        system: 'IUCN',
        label: iucn.label,
        tone: iucn.tone,
        hint: PROTECTION_HINTS[iucn.hintKey] || ''
      })
    }

    const china = normalizeChinaLevel(
      pickField(doc, [
        'china_level',
        'chinaLevel',
        'chinaProtection',
        'nationalProtection',
        'national_level',
        'protectionLevel',
        'protection_level',
        'protectionStatus',
        'conservation.china',
        'conservation.chinaLevel',
        'conservation.national',
        'protection.china',
        'protection.national'
      ])
    )
    if (china) {
      pushUniqueTag(tags, {
        key: 'china',
        system: '国家重点保护',
        label: china.label,
        tone: china.tone,
        hint: PROTECTION_HINTS[china.hintKey] || ''
      })
    }

    const cites = normalizeCites(
      pickField(doc, [
        'cites',
        'citesAppendix',
        'cites_appendix',
        'conservation.cites',
        'conservation.citesAppendix',
        'protection.cites'
      ])
    )
    if (cites) {
      pushUniqueTag(tags, {
        key: 'cites',
        system: 'CITES',
        label: cites.label,
        tone: cites.tone,
        hint: PROTECTION_HINTS[cites.hintKey] || ''
      })
    }
  })

  if (!tags.length && productProtection && productProtection.type && productProtection.type !== 'none') {
    const mapped = PRODUCT_PROTECTION[productProtection.type]
    if (mapped) {
      pushUniqueTag(tags, {
        key: 'product',
        system: '馆藏标注',
        label: mapped.label,
        tone: mapped.tone,
        hint: PROTECTION_HINTS.product || ''
      })
    }
  }

  return tags
}

function buildSections(rows) {
  return rows
    .filter((row) => row && row.text)
    .map((row) => ({
      title: row.title,
      text: row.text,
      aiSourced: !!row.aiSourced
    }))
}

function parseSimilarSpecies(raw, primaryZh) {
  if (!Array.isArray(raw)) return []
  const primary = String(primaryZh || '').trim()
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const zh = firstText(item.species_name_zh, item.zh, item.name)
      const latin = firstText(item.species_name_latin, item.latin)
      const note = firstText(item.note, item.diff, item.description)
      if (!zh || (primary && zh === primary)) return null
      return { species_name_zh: zh, species_name_latin: latin, note }
    })
    .filter(Boolean)
    .slice(0, 4)
}

function extractRegionsFromDocs(knowledge, wiki, distributionText) {
  const regions = []
  const pushRegion = (name) => {
    const t = firstText(name)
    if (t && regions.indexOf(t) === -1) regions.push(t)
  }
  ;[knowledge, wiki].filter(Boolean).forEach((doc) => {
    const geo = doc.geo || doc.geography || doc.regions
    if (Array.isArray(geo)) {
      geo.forEach((g) => {
        if (typeof g === 'string') pushRegion(g)
        else if (g && typeof g === 'object') pushRegion(g.name || g.region || g.province)
      })
    } else if (geo && typeof geo === 'object' && Array.isArray(geo.regions)) {
      geo.regions.forEach(pushRegion)
    }
    const regionField = pickField(doc, ['regions', 'distribution_regions', 'geoDistribution'])
    if (regionField) {
      regionField.split(/[、,，;；\/]/).forEach(pushRegion)
    }
  })
  if (!regions.length && distributionText) {
    distributionText.split(/[、,，;；\/]/).forEach((part) => {
      const t = part.trim()
      if (t.length >= 2 && t.length <= 8) pushRegion(t)
    })
  }
  return regions.slice(0, 12)
}

function buildEncyclopediaBlocks(payload) {
  const {
    taxonomyRows,
    morphology,
    morphologyKb,
    identificationNotes,
    identificationKb,
    habits,
    habitsKb,
    habitat,
    habitatKb,
    distribution,
    distributionKb,
    distributionRegions,
    tags,
    protectionEmpty,
    protectionEmptyLabel,
    legalNote,
    threats,
    measures,
    measuresKb,
    collectionNote,
    collectionNoteKb,
    similarSpecies,
    similarAiSourced,
    nomenclature,
    nomenclatureKb,
    phenology,
    phenologyKb,
    sourceLabel,
    emptyFieldLabel
  } = payload

  const rowBlock = (id, title, rows, emptyHint, alwaysShow) => {
    const validRows = (rows || []).filter((r) => r && r.text)
    return {
      id,
      title,
      type: 'rows',
      visible: alwaysShow || validRows.length > 0,
      rows: validRows,
      emptyLabel: emptyHint || emptyFieldLabel
    }
  }

  const taxonomyBlockRows = taxonomyRows.map((row) => ({
    title: row.label,
    text: row.value,
    aiSourced: false
  }))

  const morphologyRows = []
  if (morphology) {
    morphologyRows.push({
      title: '形态特征',
      text: morphology,
      aiSourced: !morphologyKb && !!morphology
    })
  }
  if (identificationNotes) {
    morphologyRows.push({
      title: '鉴别要点',
      text: identificationNotes,
      aiSourced: !identificationKb && !!identificationNotes
    })
  }

  const ecologyRows = []
  if (habits) {
    ecologyRows.push({ title: '生活习性', text: habits, aiSourced: !habitsKb && !!habits })
  }
  if (habitat && habitat !== distribution) {
    ecologyRows.push({ title: '栖息地', text: habitat, aiSourced: !habitatKb && !!habitat })
  }

  const conservationRows = []
  tags.forEach((tag) => {
    if (tag.hint) {
      conservationRows.push({ title: tag.label, text: tag.hint, aiSourced: false })
    }
  })
  if (threats) conservationRows.push({ title: '濒危原因', text: threats, aiSourced: false })
  if (measures) {
    conservationRows.push({
      title: '保护建议',
      text: measures,
      aiSourced: !measuresKb && !!measures
    })
  }
  if (legalNote) conservationRows.push({ title: '法律提示', text: legalNote, aiSourced: false })

  const blocks = [
    rowBlock('taxonomy', '分类检索', taxonomyBlockRows, emptyFieldLabel, taxonomyBlockRows.length > 0),
    rowBlock('morphology', '形态与鉴别要点', morphologyRows, emptyFieldLabel, true),
    rowBlock('ecology', '生态与习性', ecologyRows, emptyFieldLabel, true),
    {
      id: 'distribution',
      title: '地理分布',
      type: 'distribution',
      visible: true,
      text: distribution || '',
      aiSourced: !distributionKb && !!distribution,
      distributionRegions: distributionRegions || [],
      emptyLabel: emptyFieldLabel
    },
    {
      id: 'conservation',
      title: '保护与法规',
      type: 'conservation',
      visible: true,
      protectionTags: tags,
      protectionEmpty: protectionEmpty,
      protectionEmptyLabel,
      rows: conservationRows,
      emptyLabel: emptyFieldLabel
    },
    rowBlock('collection', '收藏与养护提示', [
      collectionNote
        ? {
            title: '标本保存',
            text: collectionNote,
            aiSourced: !collectionNoteKb && !!collectionNote
          }
        : null
    ], emptyFieldLabel, true),
    {
      id: 'similar',
      title: '相近物种 · 易混淆',
      type: 'similar',
      visible: similarSpecies.length > 0,
      items: similarSpecies,
      aiSourced: similarAiSourced,
      emptyLabel: emptyFieldLabel
    },
    rowBlock('nomenclature', '文献与命名简史', [
      nomenclature ? { title: '命名简史', text: nomenclature, aiSourced: !nomenclatureKb } : null
    ]),
    rowBlock('phenology', '季节与物候', [
      phenology ? { title: '物候', text: phenology, aiSourced: !phenologyKb } : null
    ])
  ]

  if (sourceLabel) {
    blocks.push({
      id: 'source',
      title: '著录来源',
      type: 'source',
      visible: true,
      sourceLabel
    })
  }

  return blocks
}

function toViewModel({
  species,
  knowledge,
  wiki,
  productProtection,
  aiStructured,
  alternatives
}) {
  const tax = mergeTaxonomy(
    knowledge && knowledge.taxonomy,
    mergeTaxonomy(wiki && wiki.taxonomy, species && species.taxonomy)
  )
  const mineral = looksLikeMineral(tax, species && species.species_name_zh)
  const ai = aiStructured && typeof aiStructured === 'object' ? aiStructured : {}

  const fromKb = (paths) => firstText(pickField(knowledge, paths), pickField(wiki, paths))

  const distributionKb = fromKb([
    'distribution',
    'geoDistribution',
    'geographic_distribution',
    'range',
    'distributionText',
    'conservation.distribution'
  ])
  const habitatKb = fromKb(['habitat', 'habitats', 'habitatType', 'ecology.habitat'])
  const morphologyKb = fromKb(['morphology', 'morphological', 'appearance', 'features', 'form'])
  const identificationKb = fromKb([
    'identification',
    'identification_notes',
    'identificationNotes',
    'diagnostic_features',
    'diagnosis'
  ])
  const habitsKb = fromKb(['habits', 'lifestyle', 'behavior', 'ecology', 'life_habits'])
  const collectionNoteKb = fromKb([
    'collection_note',
    'collectionNote',
    'specimen_note',
    'collector_note',
    'collectionHint'
  ])
  const threatsKb = fromKb(['threats', 'threat', 'endangered_reason', 'decline_cause', 'conservation.threats'])
  const measuresKb = fromKb([
    'measures',
    'conservation_measures',
    'protection_measures',
    'advice',
    'conservation.measures'
  ])
  const legalKb = fromKb(['legal_note', 'legalNote', 'legal_hint', 'law_note', 'conservation.legalNote'])
  const nomenclatureKb = fromKb([
    'nomenclature',
    'naming_history',
    'namingHistory',
    'etymology',
    'taxonomy_history'
  ])
  const phenologyKb = fromKb(['phenology', 'seasonality', 'season', 'phenological'])

  const distribution = distributionKb || firstText(ai.distribution)
  const habitat = habitatKb || firstText(ai.habitat)
  const morphology = morphologyKb || firstText(ai.morphology)
  const identificationNotes = identificationKb || firstText(ai.identification_notes)
  const habits = habitsKb || firstText(ai.habits)
  const collectionNote = collectionNoteKb || firstText(ai.collection_note)
  const nomenclature = nomenclatureKb || firstText(ai.nomenclature)
  const phenology = phenologyKb || firstText(ai.phenology)
  const threats = threatsKb
  const measures = measuresKb || firstText(ai.conservation_advice)
  const tags = collectProtectionTags(knowledge, wiki, productProtection)

  const protectionSummary = tags.length
    ? tags
        .map((t) => t.hint)
        .filter(Boolean)
        .slice(0, 2)
        .join(' ')
    : mineral
      ? '矿物标本无野生动物保护等级体系；交易与收藏仍须遵守相关法规。'
      : '知识库暂未著录该物种保护等级。以下形态与分布描述仅供标本对照参考，不构成名录判定。'

  const legalNote =
    legalKb ||
    (tags.length
      ? '受保护物种的收藏、展示与流转须核验合法来源及证书。本页等级来自馆藏著录，仅供参考，不构成法律意见。禁止非法猎捕、收购、运输及出售保护物种。'
      : '')

  let source = ''
  if (knowledge && knowledge.source === 'species_knowledge') source = 'species_knowledge'
  else if (wiki || (knowledge && knowledge.source === 'cms_wikis')) source = 'cms_wikis'
  else if (tags.some((t) => t.key === 'product')) source = 'products'
  else if (distribution || morphology || habits || collectionNote || measures) source = 'ai'
  if ((knowledge || wiki) && firstText(ai.morphology, ai.habits, ai.distribution, ai.conservation_advice)) {
    source = source && source !== 'ai' ? 'mixed' : source || 'ai'
  }

  const taxonomyRows = buildTaxonomyRows(tax)
  const distributionRegions = extractRegionsFromDocs(knowledge, wiki, distributionKb ? '' : distribution)

  const similarFromAi = parseSimilarSpecies(ai.similar_species, species && species.species_name_zh)
  const similarFromAlt = parseSimilarSpecies(alternatives, species && species.species_name_zh)
  const similarSpecies = similarFromAi.length ? similarFromAi : similarFromAlt
  const similarAiSourced = similarFromAi.length > 0

  const sectionsDistribution = buildSections([
    { title: '地理分布', text: distribution, aiSourced: !distributionKb && !!distribution },
    { title: '栖息地', text: habitat && habitat !== distribution ? habitat : '', aiSourced: !habitatKb && !!habitat }
  ])
  const sectionsDetail = buildSections([
    ...taxonomyRows.map((row) => ({ title: row.label, text: row.value })),
    { title: '形态特征', text: morphology, aiSourced: !morphologyKb && !!morphology },
    { title: '鉴别要点', text: identificationNotes, aiSourced: !identificationKb && !!identificationNotes },
    { title: '生活习性', text: habits, aiSourced: !habitsKb && !!habits },
    { title: '收藏短注', text: collectionNote, aiSourced: !collectionNoteKb && !!collectionNote }
  ])
  const sectionsConservation = buildSections([
    { title: '濒危原因', text: threats },
    { title: '保护建议', text: measures, aiSourced: !measuresKb && !!measures },
    { title: '法律提示', text: legalNote }
  ])

  const blocks = buildEncyclopediaBlocks({
    taxonomyRows,
    morphology,
    morphologyKb,
    identificationNotes,
    identificationKb,
    habits,
    habitsKb,
    habitat,
    habitatKb,
    distribution,
    distributionKb,
    distributionRegions,
    tags,
    protectionEmpty: tags.length === 0,
    protectionEmptyLabel: mineral ? EMPTY_UNLISTED : EMPTY_PROTECTION,
    legalNote,
    threats,
    measures,
    measuresKb,
    collectionNote,
    collectionNoteKb,
    similarSpecies,
    similarAiSourced,
    nomenclature,
    nomenclatureKb,
    phenology,
    phenologyKb,
    sourceLabel: sourceLabelOf(source),
    emptyFieldLabel: EMPTY_FIELD
  })

  const hasDistribution = sectionsDistribution.length > 0 || distributionRegions.length > 0
  const hasDetail = sectionsDetail.length > 0
  const hasConservation = sectionsConservation.length > 0 || tags.length > 0
  const shareProtection = tags.length ? tags.map((t) => t.label).join(' · ') : ''

  return {
    profileVersion: PROFILE_VERSION,
    source,
    sourceLabel: sourceLabelOf(source),
    taxonomy: tax,
    taxonomyRows,
    distribution,
    distributionRegions,
    habitat,
    morphology,
    identificationNotes,
    habits,
    collectionNote,
    nomenclature,
    phenology,
    protectionTags: tags,
    protectionSummary,
    protectionEmpty: tags.length === 0,
    protectionEmptyLabel: mineral ? EMPTY_UNLISTED : EMPTY_PROTECTION,
    threats,
    measures,
    legalNote,
    similarSpecies,
    hasDistribution,
    hasDetail,
    hasConservation,
    emptyFieldLabel: EMPTY_FIELD,
    shareProtection,
    blocks,
    sectionsDistribution,
    sectionsDetail,
    sectionsConservation
  }
}

function wikiToKnowledge(w) {
  if (!w) return null
  return {
    source: 'cms_wikis',
    species_name_zh: w.title || w.commonName || '',
    species_name_latin: w.latinName || '',
    description: stripHtml(w.brief || w.content || '').slice(0, 1200),
    taxonomy: w.taxonomy || {},
    distribution: firstText(w.distribution, w.geoDistribution, w.type === 'exhibition' ? '' : w.origin),
    habitat: firstText(w.habitat),
    morphology: firstText(w.morphology, w.features),
    habits: firstText(w.habits, w.ecology),
    collection_note: firstText(w.collection_note, w.collectionNote),
    identification_notes: pickField(w, ['identification', 'identificationNotes', 'diagnostic_features']),
    nomenclature: pickField(w, ['nomenclature', 'namingHistory', 'etymology']),
    phenology: pickField(w, ['phenology', 'seasonality']),
    geo: w.geo || w.regions || null,
    iucn: pickField(w, ['iucn', 'iucnStatus', 'conservation.iucn']),
    china_level: pickField(w, ['china_level', 'protectionLevel', 'nationalProtection', 'conservation.china']),
    cites: pickField(w, ['cites', 'citesAppendix', 'conservation.cites']),
    threats: pickField(w, ['threats', 'conservation.threats']),
    measures: pickField(w, ['measures', 'conservation.measures']),
    legal_note: pickField(w, ['legal_note', 'conservation.legalNote'])
  }
}

async function queryKnowledgeCollection(db, zh, latin) {
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
  return null
}

async function queryWikiDoc(db, _, zh, latin) {
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
    return w ? wikiToKnowledge(w) : null
  } catch (e) {
    console.warn('cms_wikis 知识查询跳过', e.message)
    return null
  }
}

async function queryProductProtection(db, _, zh, latin) {
  const orConds = []
  if (zh && zh.length >= 2) {
    orConds.push({ title: db.RegExp({ regexp: escapeRegExp(zh.slice(0, 10)), options: 'i' }) })
  }
  if (latin && latin.length >= 3) {
    orConds.push({ latinName: db.RegExp({ regexp: escapeRegExp(latin.slice(0, 18)), options: 'i' }) })
  }
  if (!orConds.length) return null
  try {
    const res = await db
      .collection('products')
      .where(_.and([{ isOffShelf: _.neq(true) }, { protectionType: _.exists(true) }, _.or(orConds)]))
      .limit(8)
      .get()
    const hit = (res.data || []).find((p) => p.protectionType && p.protectionType !== 'none')
    if (!hit) return null
    return { type: hit.protectionType, title: hit.title || '' }
  } catch (e) {
    console.warn('products 保护标注查询跳过', e.message)
    return null
  }
}

/**
 * 供科普 Prompt 使用：优先物种知识库，其次馆藏档案
 */
async function fetchSpeciesKnowledge(db, _, zh, latin) {
  const knowledge = await queryKnowledgeCollection(db, zh, latin)
  if (knowledge) return knowledge
  return queryWikiDoc(db, _, zh, latin)
}

async function buildSpeciesProfile(db, _, species, options) {
  const opts = options || {}
  const zh = (species && species.species_name_zh) || ''
  const latin = (species && species.species_name_latin) || ''
  const [knowledge, wiki, queriedProduct] = await Promise.all([
    opts.knowledge && opts.knowledge.source === 'species_knowledge'
      ? Promise.resolve(opts.knowledge)
      : queryKnowledgeCollection(db, zh, latin),
    opts.knowledge && opts.knowledge.source === 'cms_wikis'
      ? Promise.resolve(opts.knowledge)
      : queryWikiDoc(db, _, zh, latin),
    opts.productProtection
      ? Promise.resolve(opts.productProtection)
      : queryProductProtection(db, _, zh, latin)
  ])

  return toViewModel({
    species: species || {},
    knowledge: knowledge || (opts.knowledge && opts.knowledge.source === 'species_knowledge' ? opts.knowledge : null),
    wiki: wiki || (opts.knowledge && opts.knowledge.source === 'cms_wikis' ? opts.knowledge : null),
    productProtection: queriedProduct || opts.productProtection || null,
    aiStructured: opts.aiStructured || null,
    alternatives: opts.alternatives || (species && species.alternatives) || []
  })
}

function extractAiStructured(aiContent) {
  if (!aiContent || typeof aiContent !== 'object') return null
  let similar = aiContent.similar_species
  if (typeof similar === 'string') {
    try {
      similar = JSON.parse(similar)
    } catch (e) {
      similar = []
    }
  }
  return {
    morphology: firstText(aiContent.morphology),
    habits: firstText(aiContent.habits),
    distribution: firstText(aiContent.distribution),
    habitat: firstText(aiContent.habitat),
    identification_notes: firstText(aiContent.identification_notes),
    collection_note: firstText(aiContent.collection_note),
    conservation_advice: firstText(aiContent.conservation_advice),
    nomenclature: firstText(aiContent.nomenclature),
    phenology: firstText(aiContent.phenology),
    similar_species: Array.isArray(similar) ? similar : []
  }
}

function knowledgePromptSnippet(knowledge) {
  if (!knowledge) return ''
  const src = knowledge.source === 'cms_wikis' ? '馆藏档案' : '物种知识库'
  const bits = [
    firstText(knowledge.description, knowledge.brief, knowledge.content),
    knowledge.distribution ? `分布：${knowledge.distribution}` : '',
    knowledge.habitat ? `栖息地：${knowledge.habitat}` : '',
    knowledge.morphology ? `形态：${knowledge.morphology}` : '',
    knowledge.habits ? `习性：${knowledge.habits}` : ''
  ].filter(Boolean)
  if (!bits.length) return ''
  return `\n${src}参考（请消化后自然融入叙述，勿整段照抄）：\n${bits.join('\n').slice(0, 900)}`
}

module.exports = {
  fetchSpeciesKnowledge,
  buildSpeciesProfile,
  extractAiStructured,
  knowledgePromptSnippet,
  toViewModel,
  PROFILE_VERSION,
  EMPTY_PROTECTION,
  EMPTY_UNLISTED,
  EMPTY_FIELD
}
