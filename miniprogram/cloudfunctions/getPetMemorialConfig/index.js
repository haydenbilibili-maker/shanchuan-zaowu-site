const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const DEFAULT_CRAFTS = [
  { craftId: 'fluid', name: '浸液标本', desc: '整体或局部浸于透明保存液，可长久观形态。', estimatedWeeks: '约 4–8 周', sort: 1 },
  { craftId: 'taxidermy', name: '剥制标本', desc: '还原生前姿态，保留真实毛发质感。', estimatedWeeks: '约 8–16 周', sort: 2 },
  { craftId: 'skeletal', name: '骨骼标本', desc: '清理并装裱骨骼，适合特殊纪念形式。', estimatedWeeks: '约 6–10 周', sort: 3 }
]

/**
 * 需求 14：可选标本师。
 *
 * 只返回**同时满足三条**的档案，缺一不可：
 *   1. `petOrderQualified === true` —— 标本师本人在小程序工作台显式声明接伴宠工单；
 *   2. `active !== false`          —— 对外展示中（Admin 隐藏写入 false）；
 *   3. `staffOpenid` 非空          —— 定向通知与工单归属都靠这个 openid，
 *      没有它就会出现「客户选了人，标本师永远收不到」的静默失效。
 *      ⚠️ 该字段只由小程序「标本师工作台 → 个人页面维护」保存时写入（manageStaff.saveArtisanProfile），
 *      ERP 侧目前没有任何 staffOpenid 写入入口，故 ERP 新建的 framers 不会出现在此列表里。
 *
 * 返回结构刻意与 `getCustomConfig.loadFramers` 对齐（id/name/avatar/type/bio/priceDelta/extraDays），
 * 让 C 端两处「指定标本师」的渲染与客户认知完全一致。
 */
async function loadPetArtisans() {
  try {
    const _ = db.command
    const res = await db.collection('framers')
      .where({ active: _.neq(false) })
      .limit(100)
      .get()
    const rows = Array.isArray(res.data) ? res.data : []
    const qualified = rows.filter((row) => row && row.active !== false && row.petOrderQualified === true)
    const deliverable = qualified.filter((row) => String(row.staffOpenid || '').trim())
    if (qualified.length !== deliverable.length) {
      // 有资质但无 openid：配置问题，不影响 C 端，但要能被日志发现
      console.warn(
        'getPetMemorialConfig: 有伴宠资质但缺 staffOpenid 的档案数 =',
        qualified.length - deliverable.length
      )
    }
    return deliverable.map((row) => ({
      id: row._id,
      name: row.name || '标本师',
      avatar: row.avatar || '',
      type: row.type || 'store',
      bio: row.bio || row.title || row.craftIntro || '',
      city: row.city || '',
      yearsExperience: row.yearsExperience != null ? parseInt(row.yearsExperience, 10) || 0 : 0,
      priceDelta: row.priceDelta != null ? Number(row.priceDelta) : 0,
      extraDays: row.extraDays != null ? parseInt(row.extraDays, 10) || 0 : 0
    }))
  } catch (e) {
    console.warn('framers read failed (pet artisans):', e && e.message)
    return []
  }
}

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
  // 需求 14：标本师列表独立容错 —— 读不到就返回空数组，不拖垮工艺配置
  const artisans = await loadPetArtisans()
  return { success: true, config: { crafts, artisans, consentVersion: 'v2' } }
}
