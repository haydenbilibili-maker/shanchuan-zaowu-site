/**
 * 标本师招募合作意向提交
 * 集合：framer_recruit_applications（须与店长后台 Tab「标本师合作」一致）
 *
 * 预建（与 custom_inquiries / support_tickets 相同，控制台操作）：
 * 1. 微信开发者工具 → 云开发 → 数据库 → 添加集合 `framer_recruit_applications`
 *    环境：cloud1-8gnkty5bfff9f0bf
 * 2. 权限：建议「所有用户可读，仅创建者可写」（写入走本云函数；店长后台用客户端 SDK 列表/改状态）
 * 3. 索引：复合索引 status 升序 + createTime 降序（按状态筛选后按时间排序）
 *
 * 限制：微信开发者工具 CLI 无建集合命令。wx-server-sdk 可在云函数内 db.createCollection
 *（小程序端不行）。本函数仅在首次写入遇到 -502005 时自建；索引与权限仍须控制台配置。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTION = 'framer_recruit_applications'

const CATEGORY_OPTIONS = {
  insect: '昆虫',
  mineral: '矿物',
  plant: '植物',
  marine: '海洋',
  pet: '伴宠',
  other: '其他'
}

const INTENT_OPTIONS = {
  stores: '门店渠道',
  miniprogram: '小程序上架',
  share: '分成合作',
  orders: '伴宠/定制订单',
  logistics: '物流保价',
  supply: '包装与合规供应链'
}

const PHONE_RE = /^1[3-9]\d{9}$/
const FRIENDLY_UNAVAILABLE = '服务暂未开通，请稍后重试'
const FRIENDLY_FAIL = '提交失败，请稍后重试'

function pickLabels(map, ids) {
  return (ids || [])
    .map((id) => map[id])
    .filter(Boolean)
}

function normalizeIds(raw, allowed) {
  const list = Array.isArray(raw) ? raw : []
  const seen = {}
  const out = []
  list.forEach((item) => {
    const id = String(item || '').trim()
    if (!allowed[id] || seen[id]) return
    seen[id] = true
    out.push(id)
  })
  return out
}

function errorText(err) {
  return [err && err.errCode, err && err.errMsg, err && err.message, String(err || '')]
    .filter(Boolean)
    .join(' ')
}

function isMissingCollectionError(err) {
  return /502005|DATABASE_COLLECTION_NOT_EXIST|collection not exist/i.test(errorText(err))
}

function isCollectionExistsError(err) {
  return /already exist|already exists|COLLECTION_EXIST|ResourceExist|-501001/i.test(errorText(err))
}

async function ensureCollection() {
  try {
    await db.createCollection(COLLECTION)
    console.log('created collection', COLLECTION)
  } catch (err) {
    if (isCollectionExistsError(err)) return
    throw err
  }
}

async function addApplication(data) {
  try {
    return await db.collection(COLLECTION).add({ data })
  } catch (err) {
    if (!isMissingCollectionError(err)) throw err
    try {
      await ensureCollection()
    } catch (createErr) {
      console.error('createCollection failed:', createErr)
      throw err
    }
    return await db.collection(COLLECTION).add({ data })
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''

  if (event && event.action === 'ensureCollection') {
    try {
      await ensureCollection()
      return { success: true, collection: COLLECTION, msg: '集合已就绪' }
    } catch (err) {
      console.error('ensureCollection error:', err)
      return {
        success: false,
        code: isMissingCollectionError(err) ? 'COLLECTION_MISSING' : 'ENSURE_FAILED',
        msg: FRIENDLY_UNAVAILABLE
      }
    }
  }

  const contactName = String(event.contactName || '').trim().slice(0, 40)
  const phone = String(event.phone || '').trim().slice(0, 20)
  const wechat = String(event.wechat || '').trim().slice(0, 40)
  const city = String(event.city || '').trim().slice(0, 40)
  const experience = String(event.experience || '').trim().slice(0, 500)
  const note = String(event.note || '').trim().slice(0, 500)
  const categories = normalizeIds(event.categories, CATEGORY_OPTIONS)
  const intents = normalizeIds(event.intents, INTENT_OPTIONS)
  const source = String(event.source || 'framer_recruit').trim().slice(0, 40)

  if (!contactName) {
    return { success: false, msg: '请填写姓名或称呼' }
  }
  if (!PHONE_RE.test(phone)) {
    return { success: false, msg: '请填写正确的手机号' }
  }
  if (!categories.length) {
    return { success: false, msg: '请至少选择一项擅长品类' }
  }
  if (!intents.length) {
    return { success: false, msg: '请至少选择一项合作意向' }
  }

  try {
    const addRes = await addApplication({
      _openid: openid,
      contactName,
      phone,
      wechat,
      city,
      categories,
      categoryLabels: pickLabels(CATEGORY_OPTIONS, categories),
      experience,
      intents,
      intentLabels: pickLabels(INTENT_OPTIONS, intents),
      note,
      source,
      status: 'pending',
      createTime: db.serverDate(),
      updateTime: db.serverDate(),
      _createTime: db.serverDate()
    })

    return {
      success: true,
      applicationId: addRes._id,
      msg: '合作意向已提交'
    }
  } catch (err) {
    console.error('submitFramerRecruit error:', err)
    const missing = isMissingCollectionError(err)
    return {
      success: false,
      code: missing ? 'COLLECTION_MISSING' : 'SUBMIT_FAILED',
      msg: missing ? FRIENDLY_UNAVAILABLE : FRIENDLY_FAIL
    }
  }
}
