/**
 * 内容展示开关（馆藏标本档案 / 我的山海社区 / 预约入口 / 标本定制 / 伴宠记忆 / 馆内直播 / 储值卡 / AI 鉴定 / 这有店 / 门店自取 / 礼赠）
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
    showGift: false
  }
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
    // 缺字段 / undefined → true；现网已有门店，仅显式 false 关闭
    showStore: src.showStore !== false,
    // 缺字段 / undefined → true；门店自取在售，仅显式 false 关闭
    showStorePickup: src.showStorePickup !== false,
    // 缺字段 / undefined → false；礼赠默认关闭
    showGift: src.showGift === true
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
    showStore: incoming.showStore,
    showStorePickup: incoming.showStorePickup,
    showGift: incoming.showGift
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

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID
  const action = (event && event.action) || 'get'

  try {
    if (action === 'save') return await saveFlags(event, openid)
    return await readFlags()
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
