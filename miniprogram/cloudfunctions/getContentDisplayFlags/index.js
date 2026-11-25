/**
 * 内容展示开关（馆藏标本档案 / 我的山海社区 / 预约入口 / 标本定制 / 伴宠记忆 / 馆内直播 / 储值卡 / AI 鉴定 / 这有店 / 门店自取 / 礼赠 / 马上有祈福）
 * - get（默认）：任意端可读；缺配置时标本档案/社区/标本定制/直播/储值/礼赠关闭、预约 / 伴宠记忆 / AI 鉴定 / 这有店 / 门店自取开启
 * - save：超管 / Admin Web（adminOpsKey）写入 content_display_flags
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTION = 'content_display_flags'
const PERMISSION = 'manageContentDisplayFlags'

function getDefaultFlags() {
  return {
    showSpecimenArchive: false,
    showUserCommunity: false,
    showBookingEntry: true,
    showSpecimenCustom: false,
    // 现网已开放伴宠记忆；缺配置默认开启以保持兼容
    showPetMemorial: true,
    showLive: false,
    showStoredValue: false,
    // 现网已开放；缺配置默认开启以保持兼容
    showAiIdentify: true,
    // 现网已有门店；缺配置默认开启，避免误关
    showStore: true,
    // 门店自取为在售能力；缺配置默认开启，仅显式 false 关闭
    showStorePickup: true,
    // 礼赠为新能力；缺配置默认关闭，由超管显式开启
    showGift: false,
    // iOS 储值充值：缺配置默认**开启**（2026-09-16 恢复）。
    // 原「iOS 一律禁止充值」是 2026-09-15 提审前自审加入的约束（platform.js 当时新建，
    // 依据条款未经核实），并非平台已确认的硬规则；此处改为超管可控开关，
    // 若后续合规复核确认需限制，可在工作台一键关闭而无需改代码。
    allowIosStoredValue: true,
    // 列表缩略图：缺配置默认**开启**（能力不支持时会自动回落原图）
    imageThumbEnabled: true,
    // 山海图鉴 / 我的成就（需求 22/23）：现网已开放 → 缺配置默认**开启**（关掉会让现有入口消失，属回归）
    showAtlas: true,
    showAchievements: true,
    // 需求 28：「马上有」祈福弹幕。UGC 从零开发的**新**能力 → 缺配置默认**关闭**，
    // 由超管在内容模块显式开启；出事时一键关闭写入与展示，无需发版。
    showMaShangYou: false,
    // 祈福墙「连续记录云保存」注册钩子（2026-09-20）：会向未注册用户弹注册弹窗，
    // 属身份相关新能力 → 缺配置默认**关闭**，由超管显式开启（照 showMaShangYou 先例）
    showRitualProfile: false,
    // 祈福墙「功德证」次级入口（创新钩子 H2，2026-09-20）：领证要身份（未注册会被引到注册门禁），
    // 属身份相关新能力 → 缺配置默认**关闭**，由超管显式开启（照 showRitualProfile / showMaShangYou 先例）
    showMuyuCertificate: false,
    // 审核一键（2026-11-25）：默认不在审核模式、无快照
    reviewMode: false,
    reviewSnapshot: null
  }
}

/**
 * 「审核一键」受影响的开关（2026-11-25 产品负责人）：
 * AI 相关（AI 标本鉴定 / 博物君）+ 内容相关（马上有 / 山海社区 / 标本档案 / 馆内直播）。
 * 审核期一键把它们关掉，过审后一键恢复成按下之前的原值（快照存在 flags.reviewSnapshot）。
 * ⚠️ 新增开关若要纳入审核一键，**只改这一处** + 店长端面板同一份清单（守卫 check:hook-registration 比对）。
 */
const REVIEW_FLAGS = [
  'showAiIdentify',
  'museumGuideOpen',
  'showMaShangYou',
  'showUserCommunity',
  'showSpecimenArchive',
  'showLive'
]

function sanitizeReviewSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null
  const out = {}
  for (const k of REVIEW_FLAGS) {
    if (typeof raw[k] === 'boolean') out[k] = raw[k]
  }
  return Object.keys(out).length ? out : null
}

function normalizeFlags(doc) {
  const src = doc || {}
  return {
    showSpecimenArchive: src.showSpecimenArchive === true,
    showUserCommunity: src.showUserCommunity === true,
    // 缺字段 / undefined → true；仅显式 false 关闭
    showBookingEntry: src.showBookingEntry !== false,
    // 缺字段 / undefined → false；本阶段默认关闭标本定制
    showSpecimenCustom: src.showSpecimenCustom === true,
    // 缺字段 / undefined → true；现网已开放伴宠记忆，仅显式 false 关闭
    showPetMemorial: src.showPetMemorial !== false,
    // 缺字段 / undefined → false；直播默认关闭
    showLive: src.showLive === true,
    // 缺字段 / undefined → false；储值卡默认关闭
    showStoredValue: src.showStoredValue === true,
    // 缺字段 / undefined → true；现网已开放，仅显式 false 关闭
    showAiIdentify: src.showAiIdentify !== false,
    // 博物君展示开关（2026-11-23 起并入 ERP「商品内容-开关」）：缺字段 → true；与超管「开馆/闭馆」取 AND
    museumGuideOpen: src.museumGuideOpen !== false,
    // 缺字段 / undefined → true；现网已有门店，仅显式 false 关闭
    showStore: src.showStore !== false,
    // 缺字段 / undefined → true；门店自取在售，仅显式 false 关闭
    showStorePickup: src.showStorePickup !== false,
    // 缺字段 / undefined → false；礼赠默认关闭
    showGift: src.showGift === true,
    // 缺字段 / undefined → true；仅显式 false 关闭 iOS 储值充值
    allowIosStoredValue: src.allowIosStoredValue !== false,
    // 缺字段 / undefined → true；仅显式 false 关闭
    imageThumbEnabled: src.imageThumbEnabled !== false,
    // 需求 22/23：缺字段 / undefined → true；仅显式 false 关闭
    showAtlas: src.showAtlas !== false,
    showAchievements: src.showAchievements !== false,
    // 需求 28：缺字段 / undefined → false；UGC 新能力默认关闭
    showMaShangYou: src.showMaShangYou === true,
    // 祈福墙连续记录云保存钩子：缺字段 / undefined → false；身份新能力默认关闭
    showRitualProfile: src.showRitualProfile === true,
    // 祈福墙功德证钩子（H2）：缺字段 / undefined → false；身份新能力默认关闭
    showMuyuCertificate: src.showMuyuCertificate === true,
    // 审核一键（2026-11-25）：是否处于「审核模式」+ 按下之前的原值快照（用于一键恢复）
    reviewMode: src.reviewMode === true,
    reviewSnapshot: sanitizeReviewSnapshot(src.reviewSnapshot)
  }
}

async function loadActiveDoc() {
  try {
    const res = await db.collection(COLLECTION)
      .where({ status: 'active' })
      .orderBy('priority', 'desc')
      .limit(1)
      .get()
    return (res.data && res.data[0]) || null
  } catch (queryErr) {
    console.warn('getContentDisplayFlags query fallback:', queryErr && queryErr.message)
    const res = await db.collection(COLLECTION).limit(20).get()
    const rows = (res.data || [])
      .filter((d) => d.status !== 'inactive')
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))
    return rows[0] || null
  }
}

async function readFlags() {
  try {
    const doc = await loadActiveDoc()
    if (doc) {
      return {
        success: true,
        flags: normalizeFlags(doc),
        docId: doc._id || '',
        default: false
      }
    }
    return {
      success: true,
      flags: getDefaultFlags(),
      docId: '',
      default: true
    }
  } catch (e) {
    console.warn('getContentDisplayFlags fallback:', e && e.message)
    return {
      success: true,
      flags: getDefaultFlags(),
      docId: '',
      default: true,
      fallback: true
    }
  }
}

async function saveFlags(event, openid) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    permission: PERMISSION,
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const incoming = (event && event.flags) || event || {}
  const flags = normalizeFlags({
    showSpecimenArchive: incoming.showSpecimenArchive,
    showUserCommunity: incoming.showUserCommunity,
    showBookingEntry: incoming.showBookingEntry,
    showSpecimenCustom: incoming.showSpecimenCustom,
    showPetMemorial: incoming.showPetMemorial,
    showLive: incoming.showLive,
    showStoredValue: incoming.showStoredValue,
    showAiIdentify: incoming.showAiIdentify,
    // ⚠️ 漏这一行 = 店长端保存成功、但 ERP 设的「博物君关闭」被静默重置为默认（开）
    museumGuideOpen: incoming.museumGuideOpen,
    showStore: incoming.showStore,
    showStorePickup: incoming.showStorePickup,
    showGift: incoming.showGift,
    allowIosStoredValue: incoming.allowIosStoredValue,
    imageThumbEnabled: incoming.imageThumbEnabled,
    showAtlas: incoming.showAtlas,
    showAchievements: incoming.showAchievements,
    showMaShangYou: incoming.showMaShangYou,
    // ⚠️ 漏这一行 = 店长端保存成功、但 showMuyuCertificate 被静默重置为默认（关）
    showMuyuCertificate: incoming.showMuyuCertificate,
    // ⚠️ 漏这一行 = 超管在后台保存成功、但 showRitualProfile 被静默重置为默认（关）
    showRitualProfile: incoming.showRitualProfile,
    // 审核一键：模式位 + 原值快照（新增字段是加法，不影响旧端）
    reviewMode: incoming.reviewMode,
    reviewSnapshot: incoming.reviewSnapshot
  })

  const docId = String((event && event.docId) || '').trim()
  const payload = {
    ...flags,
    status: 'active',
    priority: 100,
    updatedBy: openid || (guard.actor && guard.actor.openid) || 'admin',
    updateTime: db.serverDate()
  }

  try {
    if (docId) {
      await db.collection(COLLECTION).doc(docId).update({ data: payload })
      return { success: true, flags, docId }
    }

    const existing = await loadActiveDoc()
    if (existing && existing._id) {
      await db.collection(COLLECTION).doc(existing._id).update({ data: payload })
      return { success: true, flags, docId: existing._id }
    }

    const added = await db.collection(COLLECTION).add({
      data: {
        ...payload,
        createTime: db.serverDate(),
        createdBy: openid || 'admin'
      }
    })
    return { success: true, flags, docId: added._id }
  } catch (e) {
    console.error('getContentDisplayFlags save', e)
    if (/collection|集合/.test(e.message || '')) {
      return { success: false, msg: `请先在云开发控制台创建集合 ${COLLECTION}` }
    }
    return { success: false, msg: e.message || '保存失败' }
  }
}

/**
 * 超管「开馆 / 闭馆」（museum_guide_config/main.enabled）。读不到 → 开启。
 * 这把开关不写进内容开关文档。内容开关自己的 museumGuideOpen 由 saveFlags 写入。
 */
async function readMuseumGuideOpen(box) {
  try {
    const r = await db.collection('museum_guide_config').doc('main').get()
    if (box) box.doc = (r && r.data) || null
    return !(r && r.data && r.data.enabled === false)
  } catch (e) {
    return true
  }
}

/**
 * 首页「博物君口播」的馆内通知（2026-11-23）：同一份 museum_guide_config/main 的 notices，只读带出；
 * 闭馆时不带（口播里博物君不再出声）。最多 3 条、每条 22 字，写入侧 museumGuideMonitor 已校验，这里只兜底截断。
 */
function museumGuideNoticesFrom(doc, open) {
  if (!open || !doc || !Array.isArray(doc.notices)) return []
  return doc.notices.map((t) => String(t == null ? '' : t).trim().slice(0, 22)).filter(Boolean).slice(0, 3)
}

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID
  const action = (event && event.action) || 'get'

  try {
    if (action === 'save') return await saveFlags(event, openid)
    const box = {}
    const [res, configOpen] = await Promise.all([readFlags(), readMuseumGuideOpen(box)])
    // C 端看 AND：内容开关（展示）与超管「开馆/闭馆」（服务）任一关闭即视为关闭。
    // museumGuideFlag 是文档里的原值，给编辑面板回写。若把 AND 塞进 museumGuideOpen 再让面板保存，
    // 超管一闭馆，保存其它开关就会把「展示」永久写成关闭。
    const storedGuideOpen = res.flags.museumGuideOpen !== false
    const museumGuideOpen = configOpen && storedGuideOpen
    const out = Object.assign({}, res, { flags: Object.assign({}, res.flags, { museumGuideOpen, museumGuideFlag: storedGuideOpen }) })
    out.flags.museumGuideNotices = museumGuideNoticesFrom(box.doc, museumGuideOpen)
    return out
  } catch (e) {
    console.error('getContentDisplayFlags', e)
    return {
      success: true,
      flags: getDefaultFlags(),
      docId: '',
      default: true,
      fallback: true
    }
  }
}
