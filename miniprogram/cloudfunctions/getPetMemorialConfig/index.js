const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const DEFAULT_CRAFTS = [
  { craftId: 'fluid', name: '浸液标本', desc: '整体或局部浸于透明保存液，可长久观形态。', estimatedWeeks: '约 4–8 周', sort: 1 },
  { craftId: 'taxidermy', name: '剥制标本', desc: '还原生前姿态，保留真实毛发质感。', estimatedWeeks: '约 8–16 周', sort: 2 },
  { craftId: 'skeletal', name: '骨骼标本', desc: '清理并装裱骨骼，适合特殊纪念形式。', estimatedWeeks: '约 6–10 周', sort: 3 }
]

exports.main = async () => {
  let crafts = DEFAULT_CRAFTS
  try {
    const res = await db.collection('pet_craft_configs')
      .where({ status: 'active' })
      .orderBy('sort', 'asc')
      .get()
    if (res.data && res.data.length) {
      crafts = res.data.map((row) => ({
        craftId: row.craftId || row._id,
        name: row.name,
        desc: row.desc || '',
        estimatedWeeks: row.estimatedWeeks || '',
        sort: row.sort || 0
      }))
    }
  } catch (e) {
    console.warn('pet_craft_configs read failed:', e.message)
  }
  return { success: true, config: { crafts, consentVersion: 'v2' } }
}
