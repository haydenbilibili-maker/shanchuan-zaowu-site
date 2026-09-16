/**
 * 工单类「服务通知」（微信订阅消息）通用通道
 *
 * 背景与语义（2026-09-16 业务确认）：
 *   需求 16 原文写「微信服务号」。经业务确认，**实际指的是小程序「服务通知」**
 *   （即 `cloud.openapi.subscribeMessage.send` 下发后落在微信「服务通知」会话），
 *   **不是公众号模板消息** —— 因此不需要公众号主体与模板审核，复用现有链路即可。
 *
 * 与订单通知的关系：
 *   订单类已由 `staffOrderSubscribe.js`（STAFF_ORDER_PAID_TMPL_ID）覆盖。
 *   本模块补的是**工单类**（审批 / 开票 / 定金 / 补货等）——它们此前只有站内信，
 *   员工离开小程序就收不到。
 *
 * ⚠️ 模板必须先在微信公众平台创建（一次性订阅消息），并把模板 ID 配到云函数环境变量。
 *   未配置时本模块**优雅跳过**（`skipped: 'TMPL_PENDING'`），不报错、不阻断业务；
 *   这样代码可以先上线，等模板审批下来只需加环境变量即可生效。
 *
 * 环境变量（云开发控制台 → 对应云函数 → 环境变量）：
 *   STAFF_APPROVAL_TMPL_ID     审批待办
 *   STAFF_INVOICE_TMPL_ID      开票申请
 *   STAFF_DEPOSIT_TMPL_ID      定金相关
 *   STAFF_RESTOCK_TMPL_ID      补货/想要到货
 *   STAFF_PET_MEMORIAL_TMPL_ID 伴宠工单指派（需求 14，定向发给被指定的标本师）
 *
 * 字段命名沿用平台「详细内容」规定：character_string / thing / time / amount / phrase 五类，
 * 每类模板的字段 ID 以公众平台实际配置为准，故此处用 `fields` 描述符声明。
 */

const WORK_ORDER_CATEGORIES = {
  approval: {
    envKey: 'STAFF_APPROVAL_TMPL_ID',
    eventType: 'approval_submitted',
    logType: 'staff_approval_pending',
    title: '审批待办',
    // 审批队列在店长工作台
    page: 'subpackages/manager/manager/index?tab=8&title=审批中心',
    fields: {
      // 公众平台字段示例：thing1 审批类型 / thing2 申请人 / time3 提交时间 / phrase4 状态
      thing1: (v) => clip(v.title || '待审批', 20),
      thing2: (v) => clip(v.applicantName || '同事', 20),
      time3: (v) => formatTimeValue(v.submitTime),
      phrase4: () => '待处理'
    }
  },
  invoice: {
    envKey: 'STAFF_INVOICE_TMPL_ID',
    eventType: 'invoice_request_staff',
    logType: 'staff_invoice_pending',
    title: '开票申请',
    page: 'subpackages/manager/manager/index?tab=8&title=开票申请',
    fields: {
      character_string1: (v) => clipCharacterString(v.requestNo || 'INVOICE', 32),
      thing2: (v) => clip(v.customerName || '客户', 20),
      amount3: (v) => clipMoney(v.amount),
      time4: (v) => formatTimeValue(v.submitTime)
    }
  },
  deposit: {
    envKey: 'STAFF_DEPOSIT_TMPL_ID',
    eventType: 'staff_deposit_paid',
    logType: 'staff_deposit_pending',
    title: '定金待办',
    page: 'subpackages/manager/manager/index?tab=2&title=订单管理',
    fields: {
      character_string1: (v) => clipCharacterString(v.orderNo || 'DEPOSIT', 32),
      thing2: (v) => clip(v.productNames || '定金订单', 20),
      amount3: (v) => clipMoney(v.amount),
      time4: (v) => formatTimeValue(v.payTime)
    }
  },
  restock: {
    envKey: 'STAFF_RESTOCK_TMPL_ID',
    eventType: 'wishlist_restock_request',
    logType: 'staff_restock_pending',
    title: '补货提醒',
    page: 'subpackages/manager/manager/index?tab=2&title=订单管理',
    fields: {
      thing1: (v) => clip(v.productNames || '藏品', 20),
      thing2: (v) => clip(v.storeName || '门店', 20),
      time3: (v) => formatTimeValue(v.requestTime),
      phrase4: () => '待补货'
    }
  },
  // 需求 14：客户指定了某位标本师做伴宠工单 → 定向通知该标本师本人。
  // 前缀必须是 staff_（logType），否则会落进 customer 队列，标本师在「工作通知」里看不到。
  pet_memorial_assigned: {
    envKey: 'STAFF_PET_MEMORIAL_TMPL_ID',
    eventType: 'pet_memorial_assigned',
    logType: 'staff_pet_memorial_assigned',
    title: '伴宠工单指派',
    page: 'subpackages/extra/artisan/pet/index',
    fields: {
      character_string1: (v) => clipCharacterString(v.orderNo || 'PET', 32),
      thing2: (v) => clip(v.petName || '伴宠', 20),
      thing3: (v) => clip(v.craftName || '工艺待定', 20),
      time4: (v) => formatTimeValue(v.submitTime)
    }
  }
}

function clip(v, n) {
  const s = String(v == null ? '' : v).trim()
  if (!s) return '—'
  return s.length > n ? s.slice(0, n) : s
}

/** character_string：仅数字/字母/常见符号 */
function clipCharacterString(v, n = 32) {
  const raw = String(v == null ? '' : v).trim()
  const cleaned = raw.replace(/[^\w\-./#:]+/g, '')
  if (!cleaned) return 'ORDER'
  return cleaned.length > n ? cleaned.slice(0, n) : cleaned
}

/** amount：金额，保留两位（平台要求 amount 可带币种前缀，此处用纯数字） */
function clipMoney(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

/** time.DATA：24 小时制 */
function formatTimeValue(v) {
  let d = null
  if (v instanceof Date) d = v
  else if (v && typeof v === 'object' && typeof v.toDate === 'function') {
    try {
      d = v.toDate()
    } catch (e) {
      d = null
    }
  } else if (v) {
    d = new Date(v)
  }
  if (!d || Number.isNaN(d.getTime())) d = new Date()
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}年${m}月${day}日 ${hh}:${mm}`
}

function resolveCategory(category) {
  const key = String(category || '').trim()
  return WORK_ORDER_CATEGORIES[key] || null
}

function tmplIdFor(category) {
  const conf = resolveCategory(category)
  if (!conf) return ''
  return String(process.env[conf.envKey] || '').trim()
}

/** 构建模板 data（字段 ID 由各 category 的 fields 描述符决定） */
function buildTemplateData(category, vars) {
  const conf = resolveCategory(category)
  if (!conf) return null
  const v = vars || {}
  const data = {}
  Object.keys(conf.fields).forEach((fieldId) => {
    data[fieldId] = { value: conf.fields[fieldId](v) }
  })
  return data
}

/**
 * 下发一条工单服务通知。
 * @returns {Promise<{sent:boolean, skipped:boolean, reason?:string}>}
 */
async function sendWorkOrderSubscribe(cloud, { category, openid, page, data, templateId }) {
  const conf = resolveCategory(category)
  const tmpl = String(templateId || '').trim() || tmplIdFor(category)
  const touser = String(openid || '').trim()
  if (!tmpl) return { sent: false, skipped: true, reason: 'TMPL_PENDING' }
  if (!touser) return { sent: false, skipped: true, reason: 'NO_OPENID' }
  if (!conf) return { sent: false, skipped: true, reason: 'UNKNOWN_CATEGORY' }
  try {
    await cloud.openapi.subscribeMessage.send({
      touser,
      templateId: tmpl,
      page: String(page || conf.page || '').replace(/^\//, ''),
      data: data || {},
      miniprogramState: 'formal'
    })
    return { sent: true, skipped: false }
  } catch (e) {
    const raw = (e && (e.message || e.errMsg)) || 'SEND_FAIL'
    let reason = raw
    if (/43101/.test(raw) || /refuse to accept/i.test(raw)) {
      reason = 'USER_REFUSED_OR_NO_QUOTA(43101)'
    } else if (/47003/.test(raw)) {
      reason = 'ARG_ERROR(47003):' + raw
    }
    console.warn('workOrderSubscribe send', category, reason)
    return { sent: false, skipped: false, reason }
  }
}

/** 投递留痕（与订单订阅同一集合约定，便于报表统一统计） */
async function logWorkOrderAttempt(db, { category, openid, relatedId, vars, result }) {
  const conf = resolveCategory(category)
  if (!conf) return
  try {
    await db.collection('notification_logs').add({
      data: {
        recipient: openid,
        channel: 'subscribe',
        queue: 'workflow',
        category: 'ops',
        type: conf.logType,
        templateCode: conf.eventType,
        title: conf.title,
        content: clip((vars && (vars.title || vars.productNames || vars.orderNo)) || conf.title, 60),
        relatedId: relatedId || '',
        actionUrl: conf.page,
        status: result && result.sent ? 'success' : result && result.skipped ? 'skipped' : 'fail',
        skipReason: (result && result.reason) || '',
        sentAt: db.serverDate(),
        read: false
      }
    })
  } catch (e) {
    // 留痕失败不影响主流程
  }
}

/**
 * 一步到位：下发 + 留痕。调用方只需给出 category / openid / vars。
 * 任何异常都被吞掉（通知失败绝不影响业务主流程）。
 */
async function notifyWorkOrder(cloud, db, { category, openid, relatedId, vars }) {
  try {
    const data = buildTemplateData(category, vars)
    const result = await sendWorkOrderSubscribe(cloud, { category, openid, data })
    if (db) await logWorkOrderAttempt(db, { category, openid, relatedId, vars, result })
    return result
  } catch (e) {
    return { sent: false, skipped: false, reason: (e && e.message) || 'NOTIFY_ERR' }
  }
}

module.exports = {
  WORK_ORDER_CATEGORIES,
  clip,
  clipCharacterString,
  clipMoney,
  formatTimeValue,
  resolveCategory,
  tmplIdFor,
  buildTemplateData,
  sendWorkOrderSubscribe,
  logWorkOrderAttempt,
  notifyWorkOrder
}
