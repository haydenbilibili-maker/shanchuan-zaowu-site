/**
 * 鉴定结果物种档案的前端空态，与云函数 species_profile 对齐。
 * 保护等级不得在前端写死。
 */

const { buildMapState } = require('./distributionMap')

const PROFILE_VERSION = 2

/** 展示用英文 overline，不改变栏目可见性或保护等级数据。 */
const BLOCK_OVERLINE = {
  taxonomy: 'TAXONOMY',
  morphology: 'MORPHOLOGY',
  ecology: 'ECOLOGY',
  distribution: 'DISTRIBUTION',
  conservation: 'CONSERVATION',
  collection: 'COLLECTION',
  similar: 'SIMILAR SPECIES',
  nomenclature: 'NOMENCLATURE',
  phenology: 'PHENOLOGY',
  source: 'SOURCE'
}

function attachBlockOverline(blocks) {
  if (!Array.isArray(blocks)) return []
  return blocks.map((block) => {
    if (!block || typeof block !== 'object') return block
    if (block.overline) return block
    return {
      ...block,
      overline: BLOCK_OVERLINE[block.id] || 'ARCHIVE'
    }
  })
}

const EMPTY_PROFILE = {
  profileVersion: 0,
  source: '',
  sourceLabel: '',
  taxonomyRows: [],
  protectionTags: [],
  protectionSummary: '',
  protectionEmpty: true,
  protectionEmptyLabel: '暂无等级',
  emptyFieldLabel: '暂未著录',
  hasDistribution: false,
  hasDetail: false,
  hasConservation: false,
  shareProtection: '',
  blocks: [],
  distributionRegions: [],
  similarSpecies: [],
  sectionsDistribution: [],
  sectionsDetail: [],
  sectionsConservation: [],
  mapState: {
    hasMap: false,
    mapCenter: { latitude: 30, longitude: 105 },
    mapScale: 4,
    mapMarkers: [],
    mapPlaceholder: '分布图待著录'
  }
}

function attachMapState(profile) {
  const distributionText = profile.distribution || ''
  const regions = profile.distributionRegions || []
  let distributionBlock = (profile.blocks || []).find((b) => b.id === 'distribution')
  if (!distributionBlock && distributionText) {
    distributionBlock = { text: distributionText, distributionRegions: regions }
  }
  const mapState = buildMapState({
    distributionText: (distributionBlock && distributionBlock.text) || distributionText,
    regions: (distributionBlock && distributionBlock.distributionRegions) || regions
  })
  return { ...profile, mapState }
}

function synthesizeBlocksFromLegacy(raw) {
  if (Array.isArray(raw.blocks) && raw.blocks.length) return raw.blocks
  const emptyLabel = raw.emptyFieldLabel || '暂未著录'
  const blocks = []

  if (Array.isArray(raw.taxonomyRows) && raw.taxonomyRows.length) {
    blocks.push({
      id: 'taxonomy',
      title: '分类检索',
      type: 'rows',
      visible: true,
      rows: raw.taxonomyRows.map((row) => ({ title: row.label, text: row.value, aiSourced: false }))
    })
  }

  const detailRows = (raw.sectionsDetail || []).filter((r) => r && r.text)
  if (detailRows.length) {
    blocks.push({
      id: 'morphology',
      title: '形态与鉴别要点',
      type: 'rows',
      visible: true,
      rows: detailRows
    })
  }

  const distRows = (raw.sectionsDistribution || []).filter((r) => r && r.text)
  blocks.push({
    id: 'distribution',
    title: '地理分布',
    type: 'distribution',
    visible: true,
    text: raw.distribution || (distRows[0] && distRows[0].text) || '',
    aiSourced: !!(distRows[0] && distRows[0].aiSourced),
    distributionRegions: raw.distributionRegions || [],
    emptyLabel
  })

  blocks.push({
    id: 'conservation',
    title: '保护与法规',
    type: 'conservation',
    visible: true,
    protectionTags: raw.protectionTags || [],
    protectionEmpty: raw.protectionEmpty !== false && !(raw.protectionTags || []).length,
    protectionEmptyLabel: raw.protectionEmptyLabel || '暂无等级',
    rows: (raw.sectionsConservation || []).filter((r) => r && r.text),
    emptyLabel
  })

  return blocks
}

function normalizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return attachMapState({ ...EMPTY_PROFILE })
  const blocks = attachBlockOverline(synthesizeBlocksFromLegacy(raw))
  const profile = {
    ...EMPTY_PROFILE,
    ...raw,
    protectionTags: Array.isArray(raw.protectionTags) ? raw.protectionTags : [],
    taxonomyRows: Array.isArray(raw.taxonomyRows) ? raw.taxonomyRows : [],
    blocks: blocks,
    distributionRegions: Array.isArray(raw.distributionRegions) ? raw.distributionRegions : [],
    similarSpecies: Array.isArray(raw.similarSpecies) ? raw.similarSpecies : [],
    sectionsDistribution: Array.isArray(raw.sectionsDistribution) ? raw.sectionsDistribution : [],
    sectionsDetail: Array.isArray(raw.sectionsDetail) ? raw.sectionsDetail : [],
    sectionsConservation: Array.isArray(raw.sectionsConservation) ? raw.sectionsConservation : [],
    protectionEmpty: !raw.protectionTags || !raw.protectionTags.length
  }
  return attachMapState(profile)
}

function needsProfileEnrich(profile) {
  if (!profile || typeof profile !== 'object') return true
  if (!profile.profileVersion || profile.profileVersion < PROFILE_VERSION) return true
  return !Array.isArray(profile.blocks) || profile.blocks.length === 0
}

module.exports = {
  EMPTY_PROFILE,
  PROFILE_VERSION,
  normalizeProfile,
  needsProfileEnrich,
  attachMapState
}
