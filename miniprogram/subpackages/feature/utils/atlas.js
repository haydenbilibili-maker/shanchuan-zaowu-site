const {
  RARITY,
  ATLAS_SPECIES,
  ATLAS_SERIES,
  ATLAS_SPOTS,
  publicSpecies,
  parseSpotCode,
  getSpeciesById,
  spotsOfSpecies
} = require('../config/atlasCatalog')

function callAtlas(action, data) {
  return wx.cloud
    .callFunction({
      name: 'manageAtlas',
      data: Object.assign({ action }, data || {})
    })
    .then((res) => res.result || { success: false, msg: '图鉴没有回应' })
}

function withMarks(card) {
  if (!card) return card
  const dots = card.rarityDots || (RARITY[card.rarity] && RARITY[card.rarity].dots) || 0
  card.rarityDots = dots
  card.marks = [1, 2, 3, 4, 5].map((i) => i <= dots)
  return card
}

function formatLogTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const m = d.getMonth() + 1
  const day = d.getDate()
  const hh = d.getHours()
  const mm = `${d.getMinutes()}`.padStart(2, '0')
  return `${d.getFullYear()}.${m < 10 ? '0' : ''}${m}.${day < 10 ? '0' : ''}${day}  ${hh}:${mm}`
}

function methodLabel(method) {
  if (method === 'discover') return '发现采集'
  if (method === 'photo') return '拍照采集'
  if (method === 'behavior') return '行为采集'
  if (method === 'encounter') return '偶遇采集'
  return '采集'
}

function orDash(value) {
  const s = value == null ? '' : String(value).trim()
  return s || '—'
}

function formatPrice(price) {
  if (price == null || price === '') return ''
  const n = Number(price)
  if (!Number.isFinite(n)) return String(price)
  return n % 1 === 0 ? String(n) : n.toFixed(2)
}

/** 离线/兜底：为卡片补齐柜位与印记码字段（与云端 publicSpecies 对齐） */
function enrichCardSpots(card) {
  if (!card || !card.id) return card
  if (card.hasSpot == null) {
    const spots = spotsOfSpecies(card.id)
    card.hasSpot = spots.length > 0
    if (card.unlocked && spots.length) {
      card.spots = card.spots || spots
      card.spotHint =
        card.spotHint ||
        spots
          .map((s) => s.hint)
          .filter(Boolean)
          .join(' · ')
      card.imprintCodes = card.imprintCodes || spots.map((s) => s.code)
      card.imprintCode = card.imprintCode || (spots[0] && spots[0].code) || ''
    }
  }
  return card
}

function localCatalogPack() {
  const cards = ATLAS_SPECIES.map((sp) => withMarks(enrichCardSpots(publicSpecies(sp, false))))
  cards.sort((a, b) => String(a.no).localeCompare(String(b.no), 'en', { numeric: true }))
  const series = ATLAS_SERIES.map((s) => ({
    id: s.id,
    name: s.name,
    blurb: s.blurb,
    total: (s.speciesIds || []).length,
    got: 0,
    complete: false
  }))
  return {
    cards,
    stats: { total: cards.length, unlocked: 0, percent: 0, series },
    recentLogs: []
  }
}

function parseEnterSpot(options) {
  const o = options || {}
  let raw = o.spot || o.scene || ''
  if (!raw && o.q) {
    try {
      raw = decodeURIComponent(o.q)
    } catch (e) {
      raw = o.q
    }
  }
  return parseSpotCode(raw) || String(raw || '').trim()
}

function formatRecentLogs(logs) {
  return (logs || []).slice(0, 5).map((row, i) => {
    const wild = !!row.wild
    const speciesName = row.speciesName || ''
    const method = methodLabel(row.method)
    const place = row.place || ''
    const timeText = formatLogTime(row.createdAt)
    const metaParts = [method]
    if (place) metaParts.push(place)
    if (timeText) metaParts.push(timeText)
    return {
      id: row._id || `log-${row.createdAt || i}-${row.speciesId || ''}`,
      title: wild ? speciesName || '野外笔记' : speciesName || '未命名',
      methodLabel: method,
      place,
      timeText,
      metaText: metaParts.join(' · '),
      wild,
      speciesId: row.speciesId || ''
    }
  })
}

/** 店长后台印记码列表（与门店导览点同源，按 storeId 过滤） */
function managerSpotList(storeId) {
  const sid = storeId ? String(storeId) : ''
  return ATLAS_SPOTS.filter((s) => !sid || s.storeId === sid).map((s) => {
    const sp = getSpeciesById(s.speciesId)
    return {
      id: s.id,
      code: `ATLAS:${s.id}`,
      hint: s.hint,
      storeId: s.storeId,
      speciesId: s.speciesId,
      speciesNo: sp ? sp.no : s.speciesId,
      speciesName: sp ? sp.nameZh : '',
      label: sp ? `${sp.no} · ${sp.nameZh}` : s.speciesId
    }
  })
}

function emptyUnlockSheet() {
  return {
    show: false,
    nameZh: '',
    nameLatin: '',
    id: '',
    msg: ''
  }
}

/** 馆藏 Tab 用的品类名（与探索馆藏分类文案对齐） */
function galleryCategoryOf(category) {
  if (category === '昆虫') return '昆虫'
  if (category === '植物') return '植物'
  if (category === '海洋') return '海洋'
  if (category === '矿石') return '矿石'
  return ''
}

/** 详情页事实条：产地 / 习性 / 柜位 / 印记码 / 采集 */
function buildSpecimenFacts(card) {
  if (!card || !card.unlocked) return []
  const facts = [
    { k: '产地', v: orDash(card.origin) },
    { k: '习性', v: orDash(card.habit) }
  ]
  const spotHint = card.spotHint || ''
  if (spotHint) {
    facts.push({ k: '柜位', v: spotHint })
  }
  const codes = (card.imprintCodes && card.imprintCodes.length
    ? card.imprintCodes
    : card.imprintCode
      ? [card.imprintCode]
      : []
  ).filter(Boolean)
  if (codes.length) {
    facts.push({ k: '印记码', v: codes.join(' · ') })
  }
  facts.push({ k: '采集', v: orDash(card.collectHint) })
  if (card.numbered && card.numbered.from) {
    facts.push({
      k: '编号',
      v: `${card.numbered.from}–${card.numbered.to || '—'}。这一批，到此为止。`
    })
  }
  return facts
}

module.exports = {
  callAtlas,
  withMarks,
  enrichCardSpots,
  formatLogTime,
  methodLabel,
  orDash,
  formatPrice,
  localCatalogPack,
  parseEnterSpot,
  formatRecentLogs,
  managerSpotList,
  emptyUnlockSheet,
  galleryCategoryOf,
  buildSpecimenFacts,
  spotsOfSpecies
}
