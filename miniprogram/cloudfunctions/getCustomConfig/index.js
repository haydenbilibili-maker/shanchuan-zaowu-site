const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const DEFAULT_FRAMES = [
  { id: 'frame_wood_classic', type: 'frame', name: '经典木框', desc: '原木色细框', priceDelta: 0, sort: 1 },
  { id: 'frame_metal_slim', type: 'frame', name: '窄边金属框', desc: '黄铜色细框', priceDelta: 120, sort: 2 },
  { id: 'frame_museum', type: 'frame', name: '博物馆复刻框', desc: '加厚框体', priceDelta: 280, sort: 3 }
]

const DEFAULT_PACKAGING = [
  { id: 'pkg_standard', type: 'packaging', name: '标准包装', desc: '品牌手提袋', priceDelta: 0, sort: 1 },
  { id: 'pkg_gift_box', type: 'packaging', name: '天地盖礼盒', desc: '暖灰纸盒', priceDelta: 68, sort: 2 },
  { id: 'pkg_birthday', type: 'packaging', name: '生日礼盒', desc: '限定腰封', priceDelta: 98, theme: 'birthday', sort: 3 }
]

const DEFAULT_FRAMERS = [
  { id: 'framer_store', name: '门店标本师', type: 'store', bio: '标准交期', priceDelta: 0, extraDays: 0 }
]

async function loadConfigsByType(type, defaults) {
  try {
    const res = await db.collection('custom_configs')
      .where({ type, status: 'active' })
      .orderBy('sort', 'asc')
      .get()
    if (res.data && res.data.length) {
      return res.data.map((row) => ({
        id: row.configId || row._id,
        type: row.type,
        name: row.name,
        desc: row.desc || '',
        priceDelta: row.priceDelta || 0,
        theme: row.theme || '',
        image: row.image || '',
        sort: row.sort || 0
      }))
    }
  } catch (e) {
    console.warn('custom_configs read failed:', type, e.message)
  }
  return defaults
}

async function loadFramers() {
  try {
    const _ = db.command
    // Admin 隐藏写入 active:false；缺省/undefined 视为公开展示
    const res = await db.collection('framers')
      .where({ active: _.neq(false) })
      .get()
    const rows = (res.data || []).filter((row) => row && row.active !== false)
    if (rows.length) {
      return rows.map((row) => ({
        id: row._id,
        name: row.name,
        avatar: row.avatar || '',
        type: row.type || 'store',
        bio: row.bio || '',
        priceDelta: row.priceDelta || 0,
        extraDays: row.extraDays || 0
      }))
    }
  } catch (e) {
    console.warn('framers read failed:', e.message)
  }
  return DEFAULT_FRAMERS
}

exports.main = async () => {
  const [frames, packaging, framers] = await Promise.all([
    loadConfigsByType('frame', DEFAULT_FRAMES),
    loadConfigsByType('packaging', DEFAULT_PACKAGING),
    loadFramers()
  ])

  return {
    success: true,
    config: { frames, packaging, framers, estimatedDays: 7 }
  }
}
