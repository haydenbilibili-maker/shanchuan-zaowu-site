/**
 * 工作通知声音 —— 语料与「工作信号」清单（**唯一真源**）
 *
 * 需求 #29：为超管 / 店长 / 标本师等工作台角色，在有新的工作信息时用声音提示
 * （如「您有新的订单需要处理」「您有新的工单需要处理」），音频由 AI TTS 生成。
 *
 * 为什么语料要单独成文件：
 *   1. 音频生成脚本（`miniprogram/scripts/generate-work-notice-tts.mjs`）与客户端播放
 *      必须用**同一份文案**，否则会出现「播出来的和清单里写的不一样」这种漂移；
 *   2. 守卫（`miniprogram/scripts/check-work-notice-voice.cjs`）用它核对
 *      「清单 ↔ manifest ↔ 磁盘音频 ↔ 页面接线」四者一致。
 *
 * 三类字段的分工：
 *   - `text`     ：要合成/播报的整句（AI TTS 的输入）
 *   - `roles`    ：允许听到该类型的工作台角色（服务端 menu 已按角色裁剪，这里是第二道闸）
 *   - `source`   ：从工作台 `data` 里读哪个计数（点号路径），`ids` 则读消息 id 列表（更精确）
 *
 * 新增一个类型 = ① 这里加一条 ② 跑 `npm run tts:work-notice` 生成音频
 * ③ 在页面 data 里提供对应计数 ④ `npm run check:work-notice` 必须通过。
 */

/** 与 `utils/workspaceRoles.js` 的 WORKSPACE_* 常量一致（此处复制，避免主包/分包循环依赖） */
const ROLE = {
  SUPER_ADMIN: 'super_admin',
  STORE_MANAGER: 'store_manager',
  STORE_STAFF: 'store_staff',
  SPECIMEN_ARTISAN: 'specimen_artisan'
}

/** 音频目录（放在 manager 分包内：只有工作台会播，不占主包体积） */
const AUDIO_DIR = '/subpackages/manager/assets/audio/work-notice'

/**
 * 通知类型清单。`priority` 越小越先播（一次最多播 3 条，先播最要紧的）。
 * 计数来源必须是**工作台 data 里真实存在**的字段（见 `managerPageConfig.js` / `artisan/index.js`）。
 */
const NOTICE_TYPES = [
  {
    type: 'order',
    label: '新订单',
    text: '您有新的订单，请及时处理',
    file: 'order.mp3',
    priority: 10,
    roles: [ROLE.SUPER_ADMIN, ROLE.STORE_MANAGER],
    source: 'newOrderUnreadCount',
    ids: 'newOrderUnreadIds'
  },
  {
    type: 'aftersale',
    label: '售后申请',
    text: '您有新的售后申请，请及时处理',
    file: 'aftersale.mp3',
    priority: 20,
    roles: [ROLE.SUPER_ADMIN, ROLE.STORE_MANAGER],
    source: 'opsOrderCounts.aftersale'
  },
  {
    type: 'workOrder',
    label: '客服工单',
    text: '您有新的工单需要处理',
    file: 'work-order.mp3',
    priority: 30,
    roles: [ROLE.SUPER_ADMIN, ROLE.STORE_MANAGER, ROLE.SPECIMEN_ARTISAN],
    source: 'supportTickets.length'
  },
  {
    type: 'customOrder',
    label: '定制需求',
    text: '您有新的定制需求，请查看工单',
    file: 'custom-order.mp3',
    priority: 40,
    roles: [ROLE.SUPER_ADMIN, ROLE.STORE_MANAGER, ROLE.SPECIMEN_ARTISAN],
    source: 'customOrders.length'
  },
  {
    type: 'artisanMake',
    label: '制作任务（标本师）',
    text: '您有新的制作任务，请及时处理',
    file: 'artisan-make.mp3',
    priority: 45,
    roles: [ROLE.SPECIMEN_ARTISAN],
    source: 'jobPendingMake'
  },
  {
    type: 'artisanShelf',
    label: '待上架审核（标本师）',
    text: '有藏品等待上架审核，请及时处理',
    file: 'artisan-shelf.mp3',
    priority: 46,
    roles: [ROLE.SPECIMEN_ARTISAN],
    source: 'workPendingShelf'
  },
  {
    type: 'artisanShip',
    label: '成品待发货（标本师）',
    text: '您有成品等待发货，请及时处理',
    file: 'artisan-ship.mp3',
    priority: 47,
    roles: [ROLE.SPECIMEN_ARTISAN],
    source: 'jobPendingShip'
  },
  {
    type: 'petOrder',
    label: '伴宠订单（标本师）',
    text: '您有新的伴宠订单，请及时处理',
    file: 'pet-order.mp3',
    priority: 48,
    roles: [ROLE.SPECIMEN_ARTISAN],
    source: 'petOrderTodo'
  },
  {
    type: 'artisanDeposit',
    label: '定金待办（标本师）',
    text: '您有新的定金单待处理',
    file: 'artisan-deposit.mp3',
    priority: 49,
    roles: [ROLE.SPECIMEN_ARTISAN],
    source: 'depositTodo'
  },
  {
    type: 'booking',
    label: '预约待确认',
    text: '您有新的预约需要确认',
    file: 'booking.mp3',
    priority: 50,
    roles: [ROLE.SUPER_ADMIN, ROLE.STORE_MANAGER],
    source: 'bookings.length'
  },
  {
    type: 'invoice',
    label: '开票申请',
    text: '您有新的开票申请，请及时处理',
    file: 'invoice.mp3',
    priority: 60,
    roles: [ROLE.SUPER_ADMIN, ROLE.STORE_MANAGER],
    source: 'invoicePendingCount'
  },
  {
    type: 'approval',
    label: '审批待办',
    text: '您有新的审批待办，请及时处理',
    file: 'approval.mp3',
    priority: 70,
    roles: [ROLE.SUPER_ADMIN, ROLE.STORE_MANAGER],
    source: 'approvalPendingCount'
  },
  {
    type: 'gift',
    label: '礼赠待办',
    text: '您有新的礼赠待办，请及时处理',
    file: 'gift.mp3',
    priority: 80,
    roles: [ROLE.SUPER_ADMIN, ROLE.STORE_MANAGER],
    source: 'giftTodoCount'
  },
  {
    type: 'wishlist',
    label: '心愿补货',
    text: '有藏家在等货，请查看心愿补货',
    file: 'wishlist.mp3',
    priority: 90,
    roles: [ROLE.SUPER_ADMIN, ROLE.STORE_MANAGER, ROLE.SPECIMEN_ARTISAN],
    source: 'wishlistUnreadCount'
  },
  {
    type: 'recruit',
    label: '合作申请',
    text: '您有新的合作申请，请及时处理',
    file: 'recruit.mp3',
    priority: 100,
    roles: [ROLE.SUPER_ADMIN],
    source: 'framerRecruitApps.length'
  }
  // 注：库存预警（stock）暂不纳入 —— 工作台的 `dashStock` 只有 onShelf/offShelf/stockTotal，
  // 没有「低于安全库存」的计数来源。等有了真实信号再按「新增一个类型」的四步加回来。
]

/** 试听专用（不参与「新增」检测）：开关旁的「试听」播这一条 */
const PREVIEW_TYPE = {
  type: 'sample',
  label: '试听样音',
  text: '您有新的工作信息，请查看工作台',
  file: 'sample.mp3',
  priority: 999,
  roles: [ROLE.SUPER_ADMIN, ROLE.STORE_MANAGER, ROLE.SPECIMEN_ARTISAN],
  previewOnly: true,
  source: ''
}

/** 一次进入工作台最多播报几条（其余只留角标，避免刷屏） */
const MAX_ANNOUNCE_PER_CYCLE = 3
/** 两条播报之间的最小间隔（毫秒）；期间检测到的新增不丢，等下一轮再播 */
const MIN_ANNOUNCE_INTERVAL_MS = 15000

const ALL_AUDIO_ENTRIES = NOTICE_TYPES.concat([PREVIEW_TYPE])

function listTypes() {
  return NOTICE_TYPES.map((t) => ({ ...t }))
}

function listAudioEntries() {
  return ALL_AUDIO_ENTRIES.map((t) => ({ ...t }))
}

function getType(type) {
  const key = String(type || '')
  return ALL_AUDIO_ENTRIES.filter((t) => t.type === key)[0] || null
}

function audioPath(entry) {
  const t = typeof entry === 'string' ? getType(entry) : entry
  if (!t || !t.file) return ''
  return `${AUDIO_DIR}/${t.file}`
}

/** 该角色能听到的类型（按 priority 升序） */
function typesForRole(role) {
  const r = String(role || '').trim()
  if (!r) return []
  return NOTICE_TYPES
    .filter((t) => (t.roles || []).indexOf(r) !== -1)
    .sort((a, b) => a.priority - b.priority)
}

function readPath(data, path) {
  if (!data || !path) return undefined
  return String(path)
    .split('.')
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), data)
}

/** 计数归一：数组取长度，数字取自身，非法值当 0 */
function toCount(value) {
  if (Array.isArray(value)) return value.length
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/**
 * 从页面 data 生成「工作信号快照」。
 * 只包含该角色可见的类型；没取到的计数记 0（保持键齐全，便于做增量对比）。
 *
 * @param {object} data  页面 data
 * @param {string} [role] 工作台角色；不传则不过滤（用于单测）
 * @returns {Record<string, {count:number, ids?:string[]}>}
 */
function buildSnapshot(data, role) {
  const list = role ? typesForRole(role) : listTypes()
  const out = {}
  list.forEach((t) => {
    const count = toCount(readPath(data, t.source))
    const rawIds = t.ids ? readPath(data, t.ids) : null
    const entry = { count }
    if (Array.isArray(rawIds)) entry.ids = rawIds.map(String)
    out[t.type] = entry
  })
  return out
}

module.exports = {
  ROLE,
  AUDIO_DIR,
  NOTICE_TYPES,
  PREVIEW_TYPE,
  MAX_ANNOUNCE_PER_CYCLE,
  MIN_ANNOUNCE_INTERVAL_MS,
  listTypes,
  listAudioEntries,
  getType,
  audioPath,
  typesForRole,
  buildSnapshot
}
