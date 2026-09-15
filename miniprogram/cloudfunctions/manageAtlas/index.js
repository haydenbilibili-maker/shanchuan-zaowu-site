const cloud = require('wx-server-sdk')
/**
 * 山海图鉴云函数
 * 云开发控制台需创建集合：user_atlas、atlas_logs（权限：仅创建者可读写）
 */
const {
  ATLAS_SPECIES,
  ATLAS_SERIES,
  ATLAS_SPOTS,
  METHODS,
  getSpeciesById,
  publicSpecies
} = require('./catalog')
const {
  listUnlocks,
  listLogs,
  buildStats,
  collectBySpot,
  collectByPhoto,
  collectByPurchase,
  collectEncounter
} = require('./collectCore')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function ok(data, extra) {
  return Object.assign({ success: true, data }, extra || {})
}

function fail(msg) {
  return { success: false, msg: msg || '图鉴暂时打不开' }
}

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function productCover(p) {
  if (!p) return ''
  if (Array.isArray(p.images) && p.images[0]) return p.images[0]
  return p.cover || p.image || p.thumb || ''
}

function summarizeProduct(p) {
  return {
    _id: p._id,
    title: p.title || p.name || '馆藏',
    latinName: p.latinName || p.latin || '',
    price: p.price,
    image: productCover(p),
    category: p.category || p.categoryName || ''
  }
}

/** 按物种中文名 / 拉丁名 / 别名匹配可购藏品（点亮后才查） */
async function findRelatedProducts(species) {
  if (!species || !species.id) return []
  const full = getSpeciesById(species.id) || species
  const needles = []
  ;[full.nameZh, full.nameLatin]
    .concat(full.aliases || [])
    .forEach((n) => {
      const t = String(n || '').trim()
      if (t && t.length >= 2 && needles.indexOf(t) === -1) needles.push(t)
    })
  if (!needles.length) return []

  const orConds = []
  needles.slice(0, 8).forEach((n) => {
    const re = db.RegExp({ regexp: escapeRegExp(n), options: 'i' })
    orConds.push({ title: re })
    orConds.push({ name: re })
    orConds.push({ latinName: re })
  })

  try {
    const res = await db
      .collection('products')
      .where(_.and([_.or(orConds), { isOffShelf: _.neq(true) }]))
      .limit(12)
      .get()
    return (res.data || []).map(summarizeProduct).slice(0, 4)
  } catch (e) {
    try {
      const res = await db.collection('products').where(_.or(orConds)).limit(12).get()
      return (res.data || [])
        .filter((p) => !p.isOffShelf)
        .map(summarizeProduct)
        .slice(0, 4)
    } catch (err) {
      console.warn('findRelatedProducts', err)
      return []
    }
  }
}

function mergeCatalog(unlocks) {
  const unlocked = {}
  ;(unlocks || []).forEach((u) => {
    if (u && u.speciesId) unlocked[u.speciesId] = u
  })
  const cards = ATLAS_SPECIES.map((sp) => {
    const row = unlocked[sp.id]
    const card = publicSpecies(sp, !!row)
    card.unlockedAt = row ? row.unlockedAt : 0
    card.method = row ? row.method : ''
    card.methodLabel = row && METHODS[row.method] ? METHODS[row.method].label : ''
    return card
  })
  const stats = buildStats(unlocks)
  const series = (stats.series || []).map((s) => {
    const def = ATLAS_SERIES.find((x) => x.id === s.id)
    return Object.assign({}, s, { blurb: def ? def.blurb : s.blurb })
  })
  return { cards, stats: Object.assign({}, stats, { series }) }
}

async function importLegacy(openid, unlocks) {
  if (unlocks && unlocks.length) return { imported: 0 }
  const names = []
  const tryCol = async (name, pick) => {
    try {
      const res = await db.collection(name).where({ _openid: openid }).limit(50).get()
      ;(res.data || []).forEach((doc) => {
        const n = pick(doc)
        if (n) names.push(n)
      })
    } catch (e) {
      /* 集合不存在则跳过 */
    }
  }
  await tryCol('user_collection', (d) => d.species_name || d.name || '')
  await tryCol('identification_records', (d) => {
    const s = d.species_info || {}
    return s.species_name_zh || s.species_name_latin || ''
  })
  if (!names.length) return { imported: 0 }
  let imported = 0
  const uniq = []
  names.forEach((n) => {
    if (n && uniq.indexOf(n) === -1) uniq.push(n)
  })
  for (let i = 0; i < uniq.length; i++) {
    const r = await collectByPhoto(db, openid, [uniq[i]], '', '旧日鉴定')
    if (r && r.matched && r.first) imported += 1
  }
  return { imported }
}

function collectNamesFromOrder(order) {
  const names = []
  ;(order.products || order.items || []).forEach((p) => {
    ;[p.title, p.name, p.latinName, p.latin, p.speciesName].forEach((n) => {
      if (n) names.push(String(n))
    })
  })
  return names
}

exports.main = async (event) => {
  const ctx = cloud.getWXContext()
  const source = String(ctx.SOURCE || '')
  // 仅云函数嵌套可传 event.openid（如 storeCheckIn）；客户端禁止覆盖身份
  const openid =
    ctx.OPENID ||
    ctx.FROM_OPENID ||
    (source === 'scf' ? String((event && event.openid) || '').trim() : '')
  const action = event.action || 'catalog'

  if (!openid) return fail('请先进入小程序')

  try {
    if (action === 'catalog') {
      let unlocks = await listUnlocks(db, openid)
      const legacy = await importLegacy(openid, unlocks)
      if (legacy.imported) unlocks = await listUnlocks(db, openid)
      const pack = mergeCatalog(unlocks)
      const recentLogs = await listLogs(db, openid, '', 6)
      return ok(Object.assign({}, pack, { recentLogs }))
    }

    if (action === 'card') {
      const speciesId = String(event.speciesId || event.id || '')
      const unlocks = await listUnlocks(db, openid)
      const pack = mergeCatalog(unlocks)
      const card = pack.cards.find((c) => c.id === speciesId)
      if (!card) return fail('图鉴里还没有这一页')
      const logs = await listLogs(db, openid, card.unlocked ? speciesId : '', 20)
      const visibleLogs = card.unlocked ? logs : []
      let relatedProducts = []
      if (card.unlocked) {
        relatedProducts = await findRelatedProducts(card)
      }
      return ok({ card, logs: visibleLogs, relatedProducts, stats: pack.stats })
    }

    if (action === 'logs') {
      const rows = await listLogs(db, openid, event.speciesId || '', event.limit || 50)
      const unlocks = await listUnlocks(db, openid)
      return ok({ logs: rows, stats: buildStats(unlocks) })
    }

    if (action === 'collect' || action === 'scanSpot') {
      const method = event.method || (action === 'scanSpot' ? 'discover' : '')
      if (method === 'discover' || event.code || event.spotId) {
        const code = event.code || event.spotId || event.scene || ''
        return collectBySpot(db, openid, code, event.storeName || '')
      }
      if (method === 'photo' || event.recordId || event.names) {
        return collectByPhoto(
          db,
          openid,
          event.names || [],
          event.recordId || '',
          event.place || ''
        )
      }
      if (method === 'behavior') {
        return collectByPurchase(db, openid, event.names || [], event.orderId || '')
      }
      if (method === 'encounter') {
        return collectEncounter(db, openid, event.storeName || '')
      }
      return fail('这一次采集还缺一点线索')
    }

    if (action === 'collectAfterVisit') {
      const enc = await collectEncounter(db, openid, event.storeName || '')
      return ok({ encounter: enc }, { encounter: enc })
    }

    if (action === 'collectAfterOrder') {
      const names = event.names && event.names.length
        ? event.names
        : collectNamesFromOrder(event.order || {})
      const r = await collectByPurchase(db, openid, names, event.orderId || '')
      return Object.assign({ success: true }, r)
    }

    if (action === 'spotsMeta' || action === 'spotsList') {
      const spots = ATLAS_SPOTS.map((s) => {
        const sp = getSpeciesById(s.speciesId)
        return {
          id: s.id,
          code: `ATLAS:${s.id}`,
          hint: s.hint || '',
          storeId: s.storeId || '',
          speciesId: s.speciesId,
          speciesNo: sp ? sp.no : s.speciesId,
          speciesName: sp ? sp.nameZh : ''
        }
      })
      return ok({
        count: spots.length,
        spots,
        hint: '馆里藏着几枚印记。扫到的时候，对应的一页会自己亮。把印记码做成二维码贴在柜位即可。'
      })
    }

    return fail('未知的图鉴动作')
  } catch (e) {
    console.error('manageAtlas', e)
    return fail(e.message || '图鉴暂时打不开')
  }
}
