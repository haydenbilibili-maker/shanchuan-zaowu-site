/**
 * 伴宠工单（工作台「工单 → 伴宠」）：按钮编排、理由校验、山海有信文案。
 *
 * 纯函数，不碰 wx / 云：页面方法在 manager/petMemorialActions.js，守卫 check:pet-memorial-ops 直接跑本文件。
 *
 * 通知通道 = 山海有信 dispatchMessage（action: 'dispatch'）→ user_messages + notification_logs，
 * 顾客在「我的 → 山海有信 → 定制」看到，点开跳工单进度页。生产 message_templates 里已有
 * pet_memorial_* 模板（库内文案优先于代码默认值），为了带上工单号与具体内容，这里传 title/content 覆盖；
 * 「已婉拒」没有模板，靠覆盖字段 + category/actionUrl 显式给出即可发送，不需要改云函数。
 */

const PET_STATUS_DECLINED = 'declined'

/** 可「需补充 / 填写报价 / 直接承接」的状态（与改前按钮出现条件一致） */
const REVIEW_STATUSES = ['pending_review', 'need_info']
/** 可拒绝：承接之前（含已报价、顾客尚未确认） */
const DECLINABLE_STATUSES = ['pending_review', 'need_info', 'quoted']
/** 已结束：列表沉底、不再出任何操作按钮 */
const CLOSED_STATUSES = [PET_STATUS_DECLINED, 'cancelled', 'completed']

/** 承接之后的推进按钮（与改前 wxml 的出现条件逐条一致；最后一个为主操作） */
const STAGE_ACTIONS = {
  accepted: [{ status: 'awaiting_intake', label: '待交接' }],
  awaiting_intake: [
    { status: 'intake_done', label: '已交接' },
    { status: 'in_production', label: '开始制作' }
  ],
  intake_done: [{ status: 'in_production', label: '开始制作' }],
  in_production: [{ status: 'completed', label: '已完成' }]
}

const DECLINE_REASON_MIN = 4
const DECLINE_REASON_MAX = 120
const NEED_INFO_MIN = 4
const NEED_INFO_MAX = 150

const DECLINE_QUICK_REASONS = [
  '物种或体型超出当前工艺范围',
  '遗体保存状况不适合制作',
  '近期排期已满，没法按时完成',
  '所在地区暂不支持交接',
  '多次联系不上，信息无法确认'
]

const NEED_INFO_QUICK_ITEMS = [
  '几张清晰的正面、侧面照片',
  '大致体重和体长',
  '目前的保存方式和保存了多久',
  '想要的姿态或参考图'
]

const STATUS_TONES = {
  pending_review: 'todo',
  need_info: 'todo',
  quoted: 'wait',
  declined: 'closed',
  cancelled: 'closed',
  completed: 'done'
}

function trimText(v) {
  return String(v == null ? '' : v).replace(/\s+$/g, '').replace(/^\s+/g, '')
}

/** 按字计数（emoji / 生僻字按一个字算），与 textarea maxlength 的直觉一致 */
function charLen(v) {
  return Array.from(String(v || '')).length
}

/**
 * 理由 / 补充项校验：必填、去首尾空白后 ≥ min 字、≤ max 字
 * @param {'decline'|'need_info'} kind
 */
function validateNote(kind, text) {
  const isDecline = kind === 'decline'
  const min = isDecline ? DECLINE_REASON_MIN : NEED_INFO_MIN
  const max = isDecline ? DECLINE_REASON_MAX : NEED_INFO_MAX
  const what = isDecline ? '拒绝理由' : '需要补充的内容'
  const value = trimText(text)
  const len = charLen(value)
  if (!len) return { ok: false, value, msg: `请填写${what}` }
  if (len < min) return { ok: false, value, msg: `${what}至少 ${min} 个字，说清楚一点顾客更好理解` }
  if (len > max) return { ok: false, value, msg: `${what}最多 ${max} 个字` }
  return { ok: true, value, msg: '' }
}

/** 快选：把一条常用项并进已有文字（已包含则不重复），超出上限时不并 */
function mergeQuickPick(text, pick, max) {
  const cur = trimText(text)
  const item = trimText(pick)
  if (!item) return cur
  if (cur.indexOf(item) !== -1) return cur
  const next = cur ? `${cur.replace(/[；;，,。]+$/, '')}；${item}` : item
  return charLen(next) > max ? cur : next
}

function petNameOf(order) {
  return (order && order.pet && trimText(order.pet.name)) || '伴宠'
}

function orderNoOf(order) {
  return (order && trimText(order.orderNo)) || ''
}

function statusUrlOf(order) {
  const id = (order && order._id) || ''
  return `subpackages/feature/custom/pet/status/index?id=${id}`
}

/** 承接后的「下一步」大白话，按交接方式区分 */
function acceptNextStep(order) {
  const method = order && order.intake && order.intake.method
  if (method === 'pickup') return '专员会尽快打电话和你约上门收运的时间，请留意来电。'
  return '请在工单页预约一个方便的到店交接时间，标本师会当面和你确认细节。'
}

/**
 * 四个操作的山海有信文案
 * @param {'need_info'|'quoted'|'accepted'|'declined'} op
 * @param {object} order 工单（需 _id / orderNo / pet.name / intake.method）
 * @param {{note?:string, reason?:string, amountText?:string, quoteNote?:string, validUntil?:string}} extra
 * @returns {{eventType:string, title:string, content:string, actionUrl:string, category:string, skipDedupe:boolean}}
 */
function buildPetNotice(op, order, extra = {}) {
  const name = petNameOf(order)
  const no = orderNoOf(order)
  const noPart = no ? `（工单号 ${no}）` : ''
  const base = { actionUrl: statusUrlOf(order), category: 'custom', skipDedupe: false }
  if (op === 'need_info') {
    return {
      ...base,
      eventType: 'pet_memorial_need_info',
      title: '想请你再补充一点资料',
      content: `关于「${name}」的纪念工单${noPart}，标本师评估时还需要你补充：\n${trimText(extra.note)}\n整理好后，在工单页点「联系专员」发给我们就好，不着急，我们等你。`,
      // 同一张单可能先后要几次不同的资料，每次都要送达（默认 24h 去重会吞掉第二次）
      skipDedupe: true
    }
  }
  if (op === 'quoted') {
    const lines = [`「${name}」的纪念工单${noPart}报价出来了：${trimText(extra.amountText)}。`]
    if (trimText(extra.quoteNote)) lines.push(`说明：${trimText(extra.quoteNote)}`)
    if (trimText(extra.validUntil)) lines.push(`报价有效期到 ${trimText(extra.validUntil)}。`)
    lines.push('你可以在工单页看看细节，确认后我们再安排交接；有任何疑问都可以先问专员。')
    return { ...base, eventType: 'pet_memorial_quoted', title: '报价出来了', content: lines.join('\n') }
  }
  if (op === 'accepted') {
    return {
      ...base,
      eventType: 'pet_memorial_accepted',
      title: `我们接下了「${name}」的纪念制作`,
      content: `「${name}」的纪念工单${noPart}我们已经确认承接，会认真对待它。\n下一步：${acceptNextStep(order)}`
    }
  }
  if (op === 'declined') {
    return {
      ...base,
      eventType: 'pet_memorial_declined',
      title: `关于「${name}」的工单`,
      content: `很抱歉，「${name}」的纪念工单${noPart}这次我们没能承接。\n原因：${trimText(extra.reason)}\n谢谢你愿意把它托付给我们。如果还有疑问，可以在工单页联系专员。`
    }
  }
  throw new Error(`未知伴宠工单操作：${op}`)
}

/** 通知发送失败的留痕条目（推进工单的 notifyFailures 数组） */
function notifyFailureEntry(op, eventType, reason, now = new Date()) {
  return {
    op,
    eventType: eventType || '',
    reason: String(reason || '未知原因').slice(0, 200),
    time: now.toISOString()
  }
}

/**
 * 列表行：状态文字 / 色调 / 该出现哪些按钮
 * @param {object} item 原始工单
 * @param {{getStatusLabel:Function, formatQuoteAmount:Function, formatTime?:Function}} fmt
 */
function decoratePetOrder(item, fmt) {
  const status = (item && item.status) || ''
  const closed = CLOSED_STATUSES.indexOf(status) !== -1
  const decline = (item && item.decline) || null
  const needInfo = (item && item.needInfo) || null
  const formatTime = fmt.formatTime || ((t) => (t ? new Date(t).toLocaleString() : ''))
  return {
    ...item,
    statusLabel: fmt.getStatusLabel(status),
    statusTone: STATUS_TONES[status] || 'doing',
    formatTime: item && item.createTime ? formatTime(item.createTime) : '',
    petTitle: item && item.pet ? `${item.pet.name} · ${item.pet.speciesLabel || item.pet.species}` : '',
    quoteText: item && item.quote && item.quote.amount != null ? fmt.formatQuoteAmount(item.quote.amount) : '',
    closed,
    canReview: REVIEW_STATUSES.indexOf(status) !== -1,
    canDecline: DECLINABLE_STATUSES.indexOf(status) !== -1,
    waitingCustomer: status === 'quoted',
    stageActions: closed ? [] : (STAGE_ACTIONS[status] || []),
    canCopy: !closed,
    declineReason: status === PET_STATUS_DECLINED && decline ? trimText(decline.reason) : '',
    needInfoNote: status === 'need_info' && needInfo ? trimText(needInfo.note) : ''
  }
}

/** 进行中在前、已结束沉底；组内保持原顺序（原查询按 createTime 倒序） */
function sortPetOrders(list) {
  const rows = (list || []).slice()
  const open = rows.filter((r) => !r.closed)
  const done = rows.filter((r) => r.closed)
  if (done.length) done[0] = { ...done[0], firstClosed: true }
  return open.concat(done)
}

module.exports = {
  PET_STATUS_DECLINED,
  REVIEW_STATUSES,
  DECLINABLE_STATUSES,
  CLOSED_STATUSES,
  STAGE_ACTIONS,
  DECLINE_REASON_MIN,
  DECLINE_REASON_MAX,
  NEED_INFO_MIN,
  NEED_INFO_MAX,
  DECLINE_QUICK_REASONS,
  NEED_INFO_QUICK_ITEMS,
  charLen,
  validateNote,
  mergeQuickPick,
  acceptNextStep,
  buildPetNotice,
  notifyFailureEntry,
  decoratePetOrder,
  sortPetOrders
}
