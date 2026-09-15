const {
  METHODS,
  ATLAS_SERIES,
  ATLAS_SPECIES,
  getSpeciesById,
  getSpotById,
  matchSpeciesByNames,
  parseSpotCode,
  publicSpecies,
  isFrostDescent
} = require('./catalog')

const COL_ATLAS = 'user_atlas'
const COL_LOGS = 'atlas_logs'

function isMissingCol(e) {
  const msg = (e && (e.message || e.errMsg)) || ''
  const str = JSON.stringify(e || {})
  return /COLLECTION_NOT_EXIST|not exist|502005|ResourceNotFound/i.test(msg + str)
}

async function listUnlocks(db, openid) {
  try {
    const res = await db.collection(COL_ATLAS).where({ _openid: openid }).limit(200).get()
    return res.data || []
  } catch (e) {
    if (isMissingCol(e)) return []
    throw e
  }
}

async function listLogs(db, openid, speciesId, limit) {
  try {
    let q = db.collection(COL_LOGS).where(
      speciesId ? { _openid: openid, speciesId } : { _openid: openid }
    )
    q = q.orderBy('createdAt', 'desc').limit(limit || 50)
    const res = await q.get()
    return res.data || []
  } catch (e) {
    if (isMissingCol(e)) return []
    throw e
  }
}

async function findUnlock(db, openid, speciesId) {
  try {
    const res = await db
      .collection(COL_ATLAS)
      .where({ _openid: openid, speciesId })
      .limit(1)
      .get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    if (isMissingCol(e)) return null
    throw e
  }
}

function methodLabel(method) {
  return (METHODS[method] && METHODS[method].logLabel) || '记下'
}

async function writeLog(db, openid, row) {
  const now = Date.now()
  try {
    await db.collection(COL_LOGS).add({
      data: Object.assign(
        {
          _openid: openid,
          createdAt: now
        },
        row
      )
    })
  } catch (e) {
    if (isMissingCol(e)) {
      return { skipped: true, reason: 'atlas_logs 集合未创建' }
    }
    throw e
  }
  return { ok: true }
}

async function unlockSpecies(db, openid, species, extra) {
  const existing = await findUnlock(db, openid, species.id)
  const now = Date.now()
  const log = {
    speciesId: species.id,
    speciesName: species.nameZh,
    method: extra.method,
    source: extra.source || '',
    place: extra.place || '',
    recordId: extra.recordId || '',
    orderId: extra.orderId || '',
    spotId: extra.spotId || '',
    wild: false
  }
  if (existing) {
    await writeLog(db, openid, log)
    return { already: true, first: false, species }
  }
  try {
    await db.collection(COL_ATLAS).add({
      data: {
        _openid: openid,
        speciesId: species.id,
        rarity: species.rarity,
        method: extra.method,
        unlockedAt: now,
        place: extra.place || ''
      }
    })
  } catch (e) {
    if (isMissingCol(e)) {
      return { success: false, msg: '图鉴库尚未装订，请在云开发中创建 user_atlas、atlas_logs 集合后重试' }
    }
    throw e
  }
  await writeLog(db, openid, log)
  return { already: false, first: true, species }
}

function seriesProgress(unlockedIds) {
  const set = {}
  unlockedIds.forEach((id) => {
    set[id] = true
  })
  return ATLAS_SERIES.map((s) => {
    const got = s.speciesIds.filter((id) => set[id]).length
    return {
      id: s.id,
      name: s.name,
      blurb: s.blurb,
      total: s.speciesIds.length,
      got,
      complete: got >= s.speciesIds.length && s.speciesIds.length > 0
    }
  })
}

function buildStats(unlocks) {
  const ids = unlocks.map((u) => u.speciesId)
  const byRarity = { common: 0, rare: 0, legendary: 0 }
  ATLAS_SPECIES.forEach((sp) => {
    if (ids.indexOf(sp.id) === -1) return
    byRarity[sp.rarity] = (byRarity[sp.rarity] || 0) + 1
  })
  const total = ATLAS_SPECIES.length
  const unlocked = ids.filter((id) => ATLAS_SPECIES.some((s) => s.id === id)).length
  return {
    total,
    unlocked,
    percent: total ? Math.round((unlocked / total) * 100) : 0,
    byRarity,
    series: seriesProgress(ids)
  }
}

async function collectBySpot(db, openid, code, storeName) {
  const spotId = parseSpotCode(code)
  const spot = getSpotById(spotId)
  if (!spot) {
    return { success: false, msg: '这枚印记还不被图鉴认识。' }
  }
  const species = getSpeciesById(spot.speciesId)
  if (!species) return { success: false, msg: '对应的一页还没装订。' }
  const result = await unlockSpecies(db, openid, species, {
    method: 'discover',
    source: 'spot',
    spotId: spot.id,
    place: storeName || spot.hint
  })
  if (result.success === false) return result
  return {
    success: true,
    already: result.already,
    first: result.first,
    method: 'discover',
    species: publicSpecies(species, true),
    msg: result.already ? '这一页已经在你的本子上了。' : '藏在馆里的一页，被你翻开了。'
  }
}

async function collectByPhoto(db, openid, names, recordId, place) {
  const species = matchSpeciesByNames(names)
  if (!species) {
    const zh = (Array.isArray(names) ? names[0] : names) || ''
    await writeLog(db, openid, {
      speciesId: '',
      speciesName: zh || '未命名',
      method: 'photo',
      source: 'identify',
      recordId: recordId || '',
      place: place || '野外',
      wild: true
    })
    return {
      success: true,
      matched: false,
      wild: true,
      msg: zh ? `记下了「${zh}」。图鉴里还没有对应的一页。` : '这一笔写在野外笔记里。'
    }
  }
  const result = await unlockSpecies(db, openid, species, {
    method: 'photo',
    source: 'identify',
    recordId: recordId || '',
    place: place || '镜头'
  })
  if (result.success === false) return result
  return {
    success: true,
    matched: true,
    already: result.already,
    first: result.first,
    method: 'photo',
    species: publicSpecies(species, true),
    msg: result.already ? '这一页已经点亮过了。' : '图鉴卡点亮，采集日志已落笔。'
  }
}

async function collectByPurchase(db, openid, names, orderId) {
  const species = matchSpeciesByNames(names)
  if (!species) {
    return { success: true, matched: false, msg: '' }
  }
  const result = await unlockSpecies(db, openid, species, {
    method: 'behavior',
    source: 'purchase',
    orderId: orderId || '',
    place: '随收藏落入'
  })
  if (result.success === false) return result
  return {
    success: true,
    matched: true,
    already: result.already,
    first: result.first,
    method: 'behavior',
    species: publicSpecies(species, true),
    msg: result.already ? '' : `「${species.nameZh}」写入图鉴。`
  }
}

async function collectEncounter(db, openid, storeName) {
  if (!isFrostDescent(new Date())) {
    return { success: true, matched: false, msg: '' }
  }
  const species = getSpeciesById('023')
  if (!species) return { success: true, matched: false }
  const result = await unlockSpecies(db, openid, species, {
    method: 'encounter',
    source: 'frost',
    place: storeName || '山海馆'
  })
  if (result.success === false) return result
  return {
    success: true,
    matched: true,
    already: result.already,
    first: result.first,
    method: 'encounter',
    species: publicSpecies(species, true),
    msg: result.already ? '' : '霜降这一天，血漪蛱蝶愿意被慢慢看见。'
  }
}

module.exports = {
  COL_ATLAS,
  COL_LOGS,
  isMissingCol,
  listUnlocks,
  listLogs,
  buildStats,
  collectBySpot,
  collectByPhoto,
  collectByPurchase,
  collectEncounter,
  publicSpecies
}
