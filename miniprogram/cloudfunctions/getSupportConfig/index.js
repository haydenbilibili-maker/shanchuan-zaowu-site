/**
 * 获取 / 维护联系专员配置（FAQ、服务时间、咨询主题等）
 * 读：代码默认值 + 云端集合覆盖 + 异常降级（公开）
 * 写：action list|save|seed|toggle — 仅超管（manageSupportConfig）
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTION = 'support_configs'

function getDefaultConfig() {
  return {
    phone: '19917242871',
    hours: '上午10点至下午5点',
    responseHint: '专员通常在服务时间内 30 分钟内回复',
    address: '吉林省长春市朝阳区红旗街959号这有山商场山坡X-06-1',
    latitude: 43.86661,
    longitude: 125.29306,
    communityQr: '/assets/qrcode/wechat-assistant-qr.png',
    topics: [
      { id: 'order', label: '订单咨询', desc: '支付、物流、售后', icon: '/assets/icons/cart.png' },
      { id: 'booking', label: '预约改期', desc: '到店预约与变更', icon: '/assets/icons/booking.png' },
      { id: 'product', label: '藏品鉴赏', desc: '选品与规格咨询', icon: '/assets/icons/knowledge.png' },
      { id: 'custom', label: '标本定制', desc: '标本工坊与伴宠记忆', icon: '/assets/icons/knowledge.png' },
      { id: 'specimen_care', label: '标本养护', desc: '安放、清洁与异常咨询', icon: '/assets/icons/care.png' },
      { id: 'pet_memorial', label: '伴宠记忆', desc: '宠物标本制作意向', icon: '/assets/icons/knowledge.png' },
      { id: 'identify', label: '鉴定疑问', desc: 'AI 鉴定结果咨询', icon: '/assets/icons/camera.png' },
      { id: 'refund', label: '售后退款', desc: '退款进度与凭证', icon: '/assets/icons/discount.png' },
      { id: 'invoice', label: '发票开具', desc: '电子发票与抬头', icon: '/assets/icons/coupon.png' },
      { id: 'other', label: '其他问题', desc: '品牌与合作等', icon: '/assets/icons/message.png' },
      { id: 'framer_recruit', label: '标本师招募', desc: '合作意向与分成咨询', icon: '/subpackages/feature/assets/icons/edit.png' }
    ],
    faqs: [
      {
        q: '如何开具发票？',
        a: '下单支付后如需电子发票，请进入「联系专员」选择「发票开具」，在开票申请页选择对应订单并填写抬头信息。专员处理后将电子发票发送至邮箱/微信。'
      },
      {
        q: '订单支付后多久发货？',
        a: '现货订单通常在 1-3 个工作日内发出。定制或装裱类藏品以商详页说明为准，专员会在发货前通过山海有信通知您。'
      },
      {
        q: '如何修改或取消预约？',
        a: '进入「预约参观」，切换到「我的预约」查看行程；在预约详情中查看是否支持改期或取消。若页面无入口，请选择「预约改期」联系专员协助处理。'
      },
      {
        q: '退款规则是怎样的？',
        a: '定制标本不接受退款。孤品与镇店之宝因标本特性与珍藏价值，物流运送难免产生不可逆损耗；如需退款，扣除货款 30% 作为运输损耗。伴宠订单一经发出，不接受非物流原因退款，并以顺丰保价寄出。现货藏品发货前可申请退款，审核通过后一般 1-7 个工作日原路退回。'
      },
      {
        q: '会员等级如何提升？',
        a: '在门店消费、完成预约参观、收藏与分享等行为均可获得成长值。进入「我的」可查看当前等级与下一级门槛。'
      },
      {
        q: '企业团购如何询价？',
        a: '在「标本工坊」完成方案选配后，于预览页选择「企业团购意向」提交（10 件起）。专员会在 1-2 个工作日内联系报价，无需立即支付。'
      },
      {
        q: 'AI 鉴定结果准确吗？',
        a: 'AI 鉴定仅供参考。若对结果有疑问，可选择「鉴定疑问」联系专员，或携带实物到店由标本师进一步确认。'
      }
    ]
  }
}

function fail(msg, code) {
  return { success: false, msg, code: code || 'FAIL' }
}

async function requireSuperAdmin(event, openid) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    permission: 'manageSupportConfig',
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) return { ok: false, res: fail(guard.msg, guard.code) }
  return { ok: true, actor: guard }
}

function normalizeTopics(list) {
  return (Array.isArray(list) ? list : [])
    .map((t) => ({
      id: String((t && t.id) || '').trim(),
      label: String((t && t.label) || '').trim(),
      desc: String((t && t.desc) || '').trim(),
      icon: String((t && t.icon) || '').trim() || '/assets/icons/message.png'
    }))
    .filter((t) => t.id && t.label)
}

function normalizeFaqs(list) {
  return (Array.isArray(list) ? list : [])
    .map((f) => ({
      q: String((f && f.q) || '').trim(),
      a: String((f && f.a) || '').trim()
    }))
    .filter((f) => f.q && f.a)
}

function normalizeConfigBody(raw) {
  const base = getDefaultConfig()
  const src = raw && typeof raw === 'object' ? raw : {}
  return {
    phone: String(src.phone != null ? src.phone : base.phone).trim(),
    hours: String(src.hours != null ? src.hours : base.hours).trim(),
    responseHint: String(src.responseHint != null ? src.responseHint : base.responseHint).trim(),
    address: String(src.address != null ? src.address : base.address).trim(),
    latitude: src.latitude != null && src.latitude !== '' ? Number(src.latitude) : base.latitude,
    longitude: src.longitude != null && src.longitude !== '' ? Number(src.longitude) : base.longitude,
    communityQr: String(src.communityQr != null ? src.communityQr : base.communityQr).trim(),
    topics: normalizeTopics(src.topics && src.topics.length ? src.topics : base.topics),
    faqs: normalizeFaqs(src.faqs && src.faqs.length ? src.faqs : base.faqs)
  }
}

async function loadActiveConfig() {
  let rows = []
  try {
    const res = await db.collection(COLLECTION)
      .where({ status: 'active' })
      .limit(20)
      .get()
    rows = res.data || []
  } catch (e) {
    const msg = String((e && e.message) || e || '')
    if (!/COLLECTION_NOT_EXIST|not exist|502005|-502005/i.test(msg)) {
      const res = await db.collection(COLLECTION).limit(20).get()
      rows = (res.data || []).filter((row) => !row.status || row.status === 'active')
    } else {
      throw e
    }
  }

  if (!rows.length) return null
  rows.sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0))
  return rows[0]
}

async function publicGet() {
  try {
    const cfg = await loadActiveConfig()
    if (cfg) {
      return {
        success: true,
        config: { ...getDefaultConfig(), ...(cfg.config || {}) },
        default: false,
        docId: cfg._id || ''
      }
    }
    return {
      success: true,
      config: getDefaultConfig(),
      default: true,
      docId: ''
    }
  } catch (e) {
    console.warn('getSupportConfig fallback:', e && e.message)
    return {
      success: true,
      config: getDefaultConfig(),
      default: true,
      fallback: true,
      docId: ''
    }
  }
}

async function listConfigs() {
  try {
    const res = await db.collection(COLLECTION).limit(50).get()
    const list = (res.data || [])
      .map((row) => ({
        _id: row._id,
        name: row.name || '客服入口',
        priority: Number(row.priority) || 0,
        status: row.status || 'active',
        phone: (row.config && row.config.phone) || '',
        hours: (row.config && row.config.hours) || '',
        faqCount: ((row.config && row.config.faqs) || []).length,
        topicCount: ((row.config && row.config.topics) || []).length,
        updateTime: row.updateTime || 0
      }))
      .sort((a, b) => b.priority - a.priority || (b.updateTime || 0) - (a.updateTime || 0))
    return { success: true, list, defaults: getDefaultConfig() }
  } catch (e) {
    if (/COLLECTION_NOT_EXIST|not exist|502005/i.test(String(e.message || e))) {
      return { success: true, list: [], defaults: getDefaultConfig(), missingCollection: true }
    }
    return fail(e.message || '加载失败')
  }
}

async function getOne(event) {
  const docId = String((event && event.docId) || '').trim()
  if (!docId) {
    const active = await loadActiveConfig()
    if (!active) {
      return {
        success: true,
        fromDefault: true,
        doc: {
          _id: '',
          name: '主店客服入口',
          priority: 10,
          status: 'active',
          config: getDefaultConfig()
        }
      }
    }
    return {
      success: true,
      fromDefault: false,
      doc: {
        _id: active._id,
        name: active.name || '客服入口',
        priority: Number(active.priority) || 10,
        status: active.status || 'active',
        config: normalizeConfigBody({ ...getDefaultConfig(), ...(active.config || {}) })
      }
    }
  }
  try {
    const res = await db.collection(COLLECTION).doc(docId).get()
    const row = res.data
    if (!row) return fail('配置不存在', 'NOT_FOUND')
    return {
      success: true,
      fromDefault: false,
      doc: {
        _id: row._id,
        name: row.name || '客服入口',
        priority: Number(row.priority) || 10,
        status: row.status || 'active',
        config: normalizeConfigBody({ ...getDefaultConfig(), ...(row.config || {}) })
      }
    }
  } catch (e) {
    return fail(e.message || '读取失败')
  }
}

async function saveConfig(event, openid) {
  const name = String((event && event.name) || '客服入口').trim() || '客服入口'
  const priority = Math.max(0, Math.floor(Number(event && event.priority) || 10))
  const status = (event && event.status) === 'inactive' ? 'inactive' : 'active'
  const config = normalizeConfigBody((event && event.config) || {})

  if (!config.phone) return fail('客服电话必填')
  if (!/^[\d+\-\s]{6,20}$/.test(config.phone)) return fail('客服电话格式不正确')

  const topicIds = config.topics.map((t) => t.id)
  if (new Set(topicIds).size !== topicIds.length) return fail('主题 id 不可重复')

  const payload = {
    name,
    priority,
    status,
    config,
    updateTime: Date.now(),
    updatedBy: openid || 'admin'
  }
  const docId = String((event && event.docId) || '').trim()

  try {
    if (docId) {
      await db.collection(COLLECTION).doc(docId).update({ data: payload })
      return { success: true, docId, msg: '客服配置已保存' }
    }
    const added = await db.collection(COLLECTION).add({
      data: {
        ...payload,
        createTime: Date.now(),
        createdBy: openid || 'admin'
      }
    })
    return { success: true, docId: added._id, msg: '客服配置已保存' }
  } catch (e) {
    console.error('getSupportConfig save', e)
    if (/collection|集合|not exist|502005/i.test(String(e.message || e))) {
      return fail(`请先在云开发控制台创建集合 ${COLLECTION}`)
    }
    return fail(e.message || '保存失败')
  }
}

async function toggleStatus(event) {
  const docId = String((event && event.docId) || '').trim()
  if (!docId) return fail('缺少 docId')
  const status = (event && event.status) === 'inactive' ? 'inactive' : 'active'
  try {
    await db.collection(COLLECTION).doc(docId).update({
      data: { status, updateTime: Date.now() }
    })
    return { success: true, docId, status, msg: status === 'active' ? '已启用' : '已停用' }
  } catch (e) {
    return fail(e.message || '更新失败')
  }
}

async function seedDefault(event, openid) {
  const defaults = getDefaultConfig()
  return saveConfig({
    name: '默认客服入口',
    priority: 10,
    status: 'active',
    config: defaults
  }, openid)
}

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID
  const action = (event && event.action) || 'get'

  // 公开读：保持历史无 action / action=get 兼容
  if (!action || action === 'get') {
    return publicGet()
  }

  const auth = await requireSuperAdmin(event, openid)
  if (!auth.ok) return auth.res

  try {
    if (action === 'list') return await listConfigs()
    if (action === 'getAdmin') return await getOne(event)
    if (action === 'save') return await saveConfig(event, openid)
    if (action === 'toggle') return await toggleStatus(event)
    if (action === 'seed') return await seedDefault(event, openid)
    return fail('未知操作')
  } catch (e) {
    console.error('getSupportConfig admin', e)
    return fail(e.message || '服务异常')
  }
}
