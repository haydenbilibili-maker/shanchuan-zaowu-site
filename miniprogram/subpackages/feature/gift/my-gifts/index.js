const {
  fetchContentDisplayFlags,
  toastGiftClosed
} = require('../../../../utils/contentDisplayFlags')
const { batchTempFileURLs } = require('../../../../utils/util')
const { trackBehavior } = require('../../../../utils/trackBehavior')
const { ensureSession } = require('../../../../utils/userSession')
const { requestGiftSubscribe } = require('../../utils/giftSubscribe')
const { loadReceiverVerify, saveReceiverPhone, sheetCopy, setClaimPasscode, resetShareLink } = require('../receiverVerify')
const { openAppModal } = require('../../../../utils/appModal')
const {
  giftFlowSignal,
  giftDateSignal,
  giftLedgerHeadSignal,
  giftDatesPaneSignal
} = require('../../utils/giftSignalLamp')

const PAGE_SIZE = 20
const PROFILE_PATH = '/subpackages/extra/user/profile/index'

/**
 * ⚠️ WXML `<template>` 的作用域是**隔离**的：只能读到 `data="{{...}}"` 传进去的值，
 *    读不到页面 data。本仓同类用法见 `feature/components/mp-html`（它连组件自己的
 *    `opts` / `ctrl` 都要显式写进 `data`，正是这条规则的证据）。
 *
 *    历史缺陷：卡片模板里写 `{{flowTab}}`（页面 data）→ 永远解析成 undefined，
 *    于是「我送出的」卡片上「致 XX」那一行**从不显示**、收到侧角标也不变色；
 *    因为 WXML 对未定义标识符不报错，这个 bug 不会以任何形式报出来。
 *    修法：`flowTab` 随 item 一起进模板（`decorateFlowItem` 落 `flowTab` 字段），
 *    模板改用 `{{item.flowTab}}` —— 不依赖作用域是否隔离，两种语义下都对。
 */

/** iPhone：scroll-view 需明确 px 高度，避免 flex:1+height:0 塌成空白 */
function getWindowHeight() {
  try {
    if (typeof wx.getWindowInfo === 'function') {
      const info = wx.getWindowInfo()
      if (info && info.windowHeight) return info.windowHeight
    }
  } catch (e) {
    /* 旧基础库 */
  }
  try {
    const info = wx.getSystemInfoSync()
    return (info && info.windowHeight) || 0
  } catch (e) {
    return 0
  }
}

const SENT_SEGMENTS = [
  { key: 'all', label: '全部' },
  { key: 'awaiting_open', label: '待启封' },
  { key: 'awaiting_address', label: '待填址' },
  { key: 'fulfillment', label: '履约中' },
  { key: 'done', label: '已完成' }
]

const RECEIVED_SEGMENTS = [
  { key: 'all', label: '全部' },
  { key: 'awaiting_open', label: '待启封' },
  { key: 'awaiting_address', label: '待填址' },
  { key: 'shipping', label: '待收货' },
  { key: 'done', label: '已完成' }
]

function untilText(daysUntil) {
  if (daysUntil == null || daysUntil < 0) return ''
  if (daysUntil === 0) return '就是今天'
  if (daysUntil === 1) return '明日'
  if (daysUntil <= 7) return `${daysUntil} 日内`
  if (daysUntil <= 30) return `${daysUntil} 日后`
  return ''
}

function pad2(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '01'
  return String(Math.max(0, Math.floor(v))).padStart(2, '0')
}

function todayDateStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 与 manageGift.DATE_TYPES 对齐；云端 listDates 返回优先 */
const FALLBACK_DATE_TYPES = [
  { key: 'birthday', label: '生日', sceneKey: 'birthday', requireYear: false },
  { key: 'anniversary', label: '纪念日', sceneKey: 'anniversary', requireYear: true },
  { key: 'wedding', label: '结婚纪念', sceneKey: 'wedding', requireYear: true },
  { key: 'housewarming', label: '乔迁', sceneKey: 'housewarming', requireYear: false },
  { key: 'enrollment', label: '升学', sceneKey: 'enrollment', requireYear: false },
  { key: 'graduation', label: '毕业', sceneKey: 'graduation', requireYear: false },
  { key: 'new_job', label: '入职', sceneKey: 'new_job', requireYear: false },
  { key: 'newborn', label: '新生儿', sceneKey: 'gratitude', requireYear: false },
  { key: 'festival', label: '节日', sceneKey: 'gratitude', requireYear: false },
  { key: 'custom', label: '自定义', sceneKey: 'gratitude', requireYear: false }
]

const TITLE_PLACEHOLDER_BY_TYPE = {
  birthday: '如：我的生日',
  anniversary: '如：相识纪念日',
  wedding: '如：结婚十周年',
  housewarming: '如：新居落成',
  enrollment: '如：开学日',
  graduation: '如：毕业典礼',
  new_job: '如：入职周年',
  newborn: '如：满月',
  festival: '如：中秋、春节',
  custom: '如：值得记得的一天'
}

function resolveDateTypeOptions(list) {
  return Array.isArray(list) && list.length ? list : FALLBACK_DATE_TYPES
}

function dateTypeMeta(type, options) {
  const key = String(type || 'birthday').trim() || 'birthday'
  const hit = resolveDateTypeOptions(options).find((o) => o.key === key)
  return hit || FALLBACK_DATE_TYPES[0]
}

function dateTypeRequiresYear(type, options) {
  const meta = dateTypeMeta(type, options)
  return !!meta.requireYear
}

function titlePlaceholderForType(type) {
  const key = String(type || 'birthday').trim()
  return TITLE_PLACEHOLDER_BY_TYPE[key] || TITLE_PLACEHOLDER_BY_TYPE.custom
}

/** 解析 YYYY-MM-DD / 用户资料 birthday */
function parseYmd(raw) {
  const s = String(raw || '').trim()
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return null
  const year = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  const day = parseInt(m[3], 10)
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null
  return {
    year,
    month,
    day,
    dateValue: `${year}-${pad2(month)}-${pad2(day)}`,
    dateDisplay: `${year}年${month}月${day}日`
  }
}

function buildDateFormFields({ year, month, day, type, dateTypeOptions }) {
  const m = parseInt(month, 10)
  const d = parseInt(day, 10)
  const yRaw = parseInt(year, 10)
  const y = Number.isFinite(yRaw) && yRaw >= 1900 && yRaw <= 2100 ? yRaw : null
  const meta = dateTypeMeta(type, dateTypeOptions)
  const needYear = !!meta.requireYear
  const label = meta.label || '日子'
  if (!Number.isFinite(m) || !Number.isFinite(d) || m < 1 || d < 1) {
    return {
      year: '',
      month: '',
      day: '',
      dateValue: '',
      dateDisplay: '',
      dateHint: needYear
        ? `${label}请选择完整年月日`
        : type === 'birthday'
          ? '生日每年循环提醒；年份用于年龄参考'
          : '每年循环提醒；年份可选'
    }
  }
  const pickerYear = y || new Date().getFullYear()
  return {
    year: y ? String(y) : '',
    month: String(m),
    day: String(d),
    dateValue: `${pickerYear}-${pad2(m)}-${pad2(d)}`,
    dateDisplay: y ? `${y}年${m}月${d}日` : `${m}月${d}日`,
    dateHint: needYear
      ? `${label}请选择完整年月日`
      : type === 'birthday'
        ? y
          ? '生日每年循环提醒；已记下年份作年龄参考'
          : '生日每年循环提醒；年份用于年龄参考'
        : y
          ? '每年循环提醒；已记下年份'
          : '每年循环提醒；年份可选'
  }
}

function emptyDateForm(patch, dateTypeOptions) {
  const p = patch || {}
  const type = p.type || 'birthday'
  const dateFields = buildDateFormFields({
    year: p.year,
    month: p.month,
    day: p.day,
    type,
    dateTypeOptions
  })
  return {
    id: p.id || '',
    type,
    title: p.title != null ? p.title : '',
    titlePlaceholder: titlePlaceholderForType(type),
    contactId: p.contactId != null ? p.contactId : '',
    contactName: p.contactName != null ? p.contactName : '',
    ...dateFields
  }
}

function buildHeroSummary({ flowBadge, upcomingHotCount, contactsCount }) {
  const parts = []
  if (flowBadge > 0) parts.push(`${flowBadge} 笔往来待跟进`)
  if (upcomingHotCount > 0) parts.push(`${upcomingHotCount} 个日子将近`)
  if (!parts.length) {
    if (contactsCount > 0) return '人情账本静静摊开，随时可为 TA 选一份山海。'
    return '记下往来、对象与日子——像一本博物柜里的人情账本。'
  }
  return `${parts.join(' · ')}。`
}

/**
 * 往来待办焦点：从段位计数里挑「最该先处理」的一格（只读现有 segmentCounts，不改契约）。
 * 优先级：待启封 → 待填址 → 履约/待收货。
 */
function pickTodoFocus(flowTab, segments) {
  const list = Array.isArray(segments) ? segments : []
  const byKey = {}
  list.forEach((s) => {
    if (s && s.key) byKey[s.key] = Number(s.count) || 0
  })
  const order =
    flowTab === 'received'
      ? ['awaiting_open', 'awaiting_address', 'shipping']
      : ['awaiting_open', 'awaiting_address', 'fulfillment']
  for (let i = 0; i < order.length; i += 1) {
    const key = order[i]
    const count = byKey[key] || 0
    if (count <= 0) continue
    const hit = list.find((s) => s.key === key)
    return {
      segment: key,
      count,
      label: (hit && hit.label) || key,
      title: `${count} 笔「${(hit && hit.label) || key}」待处理`,
      hint: flowTab === 'received' ? '打开往来，继续启封或填址' : '点此筛选，先把该办的办完'
    }
  }
  return null
}

/** 云函数未部署 progressSteps 时的前端兜底 */
function fallbackProgressSteps(item) {
  if (item && item.progressSteps && item.progressSteps.mode) return item.progressSteps
  const key = String((item && item.progressKey) || '')
  const delivery = String((item && item.deliveryType) || 'invite_address')
  if (key === 'refunded' || key === 'cancelled') {
    return { mode: 'terminal', current: -1, steps: [] }
  }
  let labels = ['备妥', '启封', '填址', '启程', '送达']
  let current = 0
  if (delivery === 'store_pickup') {
    labels = ['备妥', '领取', '完成']
    if (key === 'pending_pay') current = 0
    else if (key === 'pickup_verify' || key === 'awaiting_open') current = 1
    else if (key === 'done') current = 2
    else current = 1
  } else if (delivery === 'invite_address') {
    if (key === 'pending_pay') current = 0
    else if (key === 'awaiting_open') current = 1
    else if (key === 'awaiting_address') current = 2
    else if (key === 'awaiting_ship' || key === 'shipping') current = 3
    else if (key === 'done') current = 4
    else current = 2
  } else {
    labels = ['备妥', '启程', '送达']
    if (key === 'pending_pay') current = 0
    else if (key === 'awaiting_ship' || key === 'shipping') current = 1
    else if (key === 'done') current = 2
    else current = 1
  }
  return {
    mode: 'rail',
    current,
    steps: labels.map((label, i) => ({
      label,
      state: i < current ? 'done' : i === current ? 'current' : 'todo'
    }))
  }
}

function decorateFlowItem(item, flowTab) {
  const progressSteps = fallbackProgressSteps(item)
  const roleLabel = item.roleLabel || (flowTab === 'received' ? '收到' : '送出')
  const progressKey = String((item && item.progressKey) || '')
  // 已取消 / 已退款 / 过期退款中 等失效终态：卡片置灰
  const inactive =
    progressKey === 'cancelled' ||
    progressKey === 'refunded' ||
    progressSteps.mode === 'terminal'
  const actions = Array.isArray(item.actions) ? item.actions : []
  /**
   * 失效终态的兜底出口：
   * 云端 `buildMineActions` 对 refunded / cancelled **不派发任何动作**，
   * 于是折叠区里的卡片一个按钮都没有，只能靠"点卡片"这一条隐晦路径。
   * 这里仅在服务端确实没给动作时补一个「订单详情」（与云端 done 态同词），不覆盖服务端口径。
   */
  const fallback = inactive && !actions.length && item.deepLink
    ? [{ key: 'order', label: '订单详情', type: 'nav', path: item.deepLink }]
    : []
  // 已完成：收到侧 = 持有人的「收藏证书」，送出侧 = 「赠予凭证」（证书页按查看者身份签发不同版式）
  const certAction = progressKey === 'done' && item.orderId
    ? {
      key: 'cert',
      label: flowTab === 'received' ? '收藏证书' : '赠予凭证',
      type: 'nav',
      path: `/subpackages/business/certificate/index?id=${item.orderId}`
    }
    : null
  return {
    ...item,
    // flowTab 必须随 item 一起传给模板：WXML 模板作用域是隔离的（见文件头注释）
    flowTab,
    roleLabel,
    progressSteps,
    signalClass: giftFlowSignal(item),
    showRail: progressSteps.mode === 'rail' && (progressSteps.steps || []).length > 0,
    inactive,
    actions: actions.length ? actions : fallback,
    primaryAction: item.primaryAction || fallback[0] || null,
    secondaryAction: item.secondaryAction || certAction
  }
}

/**
 * 折叠计数口径：分页未到底时，已加载页里的失效笔数**不等于**总笔数，
 * 所以只说「已加载 N 笔」；到底了才说「共 N 笔」。
 * （与钱包账单流水 `ledgerCapText` 同一口径，避免"加载一页就报总数"。）
 */
function foldedCapText(count, hasMore) {
  const n = Number(count) || 0
  if (!n) return ''
  return hasMore ? `已加载 ${n} 笔` : `共 ${n} 笔`
}

Page({
  data: {
    checking: true,
    allowed: false,
    paneReady: false,
    skelRows: [1, 2, 3],
    heroSummary: '记下往来、对象与日子——像一本博物柜里的人情账本。',
    headSignalClass: 'lamp-muted hollow',
    hubTab: 'flow',
    flowTab: 'sent',
    activeSegment: 'all',
    segments: SENT_SEGMENTS.map((s) => ({ ...s, count: 0 })),
    list: [],
    // 需求 31：按失效终态拆分渲染（activeList 在途 / foldedList 已退款·已取消）
    activeList: [],
    foldedList: [],
    foldedCount: 0,
    /** 折叠计数口径文案：分页未到底时只说「已加载 N 笔」 */
    foldedCap: '',
    foldedExpanded: false,
    loading: false,
    loadingMore: false,
    softRefreshing: false,
    refresherTriggered: false,
    formBusy: false,
    errorMsg: '',
    hasMore: false,
    page: 1,
    counts: { sent: 0, received: 0 },
    contactsCount: 0,
    flowBadge: 0,
    todoFocus: null,
    emptyTitle: '',
    emptyDesc: '',
    showEmptyGuide: true,
    recipientFilter: '',
    filterLabel: '',

    contacts: [],
    contactsLoading: false,
    contactsError: '',
    relationOptions: [],
    showContactForm: false,
    sheetContactMounted: false,
    contactForm: { id: '', name: '', relation: 'friend', note: '' },

    dates: [],
    upcomingDates: [],
    upcomingHotCount: 0,
    hotSpotlight: null,
    datesHeadSignalClass: 'lamp-muted hollow',
    datesLoading: false,
    datesError: '',
    dateTypeOptions: FALLBACK_DATE_TYPES,
    contactPickList: [],
    showDateForm: false,
    sheetDateMounted: false,
    dateForm: emptyDateForm(),
    datePickerEnd: todayDateStr(),
    profileBirthday: '',
    profileBirthdayDisplay: '',

    sheetOpen: false,
    verifySheet: false,
    verifyBusy: false,
    verifyError: '',
    verifyCopy: {},
    /** 凭礼笺领取管理面板（2026-10-11） */
    claimSheet: false,
    claimState: {},
    claimNotice: '',
    /** 主滚动区高度（iOS 显式 px） */
    scrollHeightPx: 0,
    scrollStyle: ''
  },

  onReady() {
    this.syncScrollPane()
  },

  onShow() {
    this.syncScrollPane()
    if (this.data.allowed && this._loadedOnce) {
      this.refreshCurrent({ soft: true })
    }
  },

  guessScrollPane() {
    const winH = getWindowHeight()
    const next = Math.max(240, (winH || 600) - 220)
    this.setData({
      scrollHeightPx: next,
      scrollStyle: 'height: ' + next + 'px;'
    })
  },

  syncScrollPane() {
    if (!this.data.allowed) {
      this.guessScrollPane()
      return
    }
    const winH = getWindowHeight()
    const apply = (pageH, chromeH) => {
      const next = Math.max(240, Math.floor((pageH || winH || 600) - (chromeH || 220)))
      if (!next || next === this.data.scrollHeightPx) return
      this.setData({
        scrollHeightPx: next,
        scrollStyle: 'height: ' + next + 'px;'
      })
    }
    const runQuery = () => {
      wx.createSelectorQuery()
        .in(this)
        .select('.page')
        .boundingClientRect()
        .select('.hero-plate')
        .boundingClientRect()
        .select('.hub-tabs')
        .boundingClientRect()
        .select('.sub-tabs')
        .boundingClientRect()
        .select('.segments')
        .boundingClientRect()
        .exec((res) => {
          const pageH = (res && res[0] && res[0].height) || winH
          const heroH = (res && res[1] && res[1].height) || 0
          const hubH = (res && res[2] && res[2].height) || 0
          const subH = (res && res[3] && res[3].height) || 0
          const segH = (res && res[4] && res[4].height) || 0
          const flowChrome = this.data.hubTab === 'flow' ? subH + segH : 0
          apply(pageH, heroH + hubH + flowChrome)
        })
    }
    if (typeof wx.nextTick === 'function') wx.nextTick(runQuery)
    else setTimeout(runQuery, 16)
  },

  onLoad(options) {
    this.guessScrollPane()
    const hub = String((options && options.hub) || '').trim()
    const flow = String((options && options.tab) || '').trim()
    const segment = String((options && options.segment) || '').trim()
    /* ⚠️ `contactName` 是**中文人名**，调用方（订单详情页）按 URL 规范用 `encodeURIComponent`
     * 编码后传进来，而 `options` 拿到的是**未解码**的串（2026-09-21 真机截图：
     * 「致 %E5%8E%89%E7%8E%A9…」——既显示成乱码，筛选也因此匹配不到任何一份礼赠）。
     * 这里**防御性解码**：只在"看起来是百分号编码"时才解，避免把人名里合法的 `%` 解坏。 */
    const rawContact = String((options && options.contactName) || '').trim()
    let contactName = rawContact
    if (/%[0-9A-Fa-f]{2}/.test(rawContact)) {
      try { contactName = decodeURIComponent(rawContact) } catch (e) { contactName = rawContact }
    }
    const patch = {}
    if (hub === 'people' || hub === 'dates' || hub === 'flow') patch.hubTab = hub
    if (flow === 'received' || flow === 'sent') {
      patch.flowTab = flow
      patch.segments = (flow === 'received' ? RECEIVED_SEGMENTS : SENT_SEGMENTS).map((s) => ({
        ...s,
        count: 0
      }))
    }
    if (segment) {
      const segs = patch.segments || this.data.segments
      if (segs.some((s) => s.key === segment)) patch.activeSegment = segment
    }
    if (contactName) {
      patch.hubTab = 'flow'
      patch.flowTab = 'sent'
      patch.recipientFilter = contactName
      patch.filterLabel = `致 ${contactName}`
    }
    if (Object.keys(patch).length) this.setData(patch)
    this.guardAndLoad()
  },

  onPullDownRefresh() {
    this.refreshCurrent({ soft: true }).finally(() => wx.stopPullDownRefresh())
  },

  onRefresherRefresh() {
    this.setData({ refresherTriggered: true })
    this.refreshCurrent({ soft: true }).finally(() => this.setData({ refresherTriggered: false }))
  },

  onEdgeBack() {
    if (this.data.showContactForm || this.data.showDateForm) {
      if (this.data.showContactForm) this.closeContactForm()
      else this.closeDateForm()
      return
    }
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
  },

  updateHeroSummary(extra) {
    const flowBadge = extra && extra.flowBadge != null ? extra.flowBadge : this.data.flowBadge
    const upcomingHotCount =
      extra && extra.upcomingHotCount != null ? extra.upcomingHotCount : this.data.upcomingHotCount
    const contactsCount =
      extra && extra.contactsCount != null ? extra.contactsCount : this.data.contactsCount
    this.setData({
      heroSummary: buildHeroSummary({ flowBadge, upcomingHotCount, contactsCount }),
      headSignalClass: giftLedgerHeadSignal({ flowBadge, upcomingHotCount }),
      contactsCount
    })
  },

  async guardAndLoad() {
    try {
      const { flags } = await fetchContentDisplayFlags()
      if (!flags.showGift) {
        toastGiftClosed()
        this.setData({ checking: false, allowed: false })
        setTimeout(() => {
          wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
        }, 400)
        return
      }
      this.setData({ checking: false, allowed: true })
      setTimeout(() => {
        this.setData({ paneReady: true })
        this.syncScrollPane()
      }, 30)
      trackBehavior('gift_mine_enter', 'hub', this.data.hubTab)
      await this.refreshCurrent()
      this._loadedOnce = true
      // 预取对象数量供页头摘要（不挡主路径）
      if (this.data.hubTab === 'flow') this.prefetchContactsCount()
    } catch (e) {
      toastGiftClosed()
      this.setData({ checking: false, allowed: false })
      setTimeout(() => {
        wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
      }, 400)
    }
  },

  async prefetchContactsCount() {
    try {
      const call = await wx.cloud.callFunction({
        name: 'manageGift',
        data: { action: 'listContacts' }
      })
      const result = (call && call.result) || {}
      if (!result.success) return
      const n = (result.list || []).length
      this.setData({ contactsCount: n })
      this.updateHeroSummary({ contactsCount: n })
    } catch (e) {
      /* ignore */
    }
  },

  refreshCurrent(opts) {
    const soft = !!(opts && opts.soft)
    const hub = this.data.hubTab
    if (hub === 'people') return this.loadContacts({ soft })
    if (hub === 'dates') return this.loadDates({ soft })
    return this.loadList(true, { soft })
  },

  emptyCopy(tab, segment, filterName) {
    const isFilter = segment && segment !== 'all'
    const recipientFilter =
      filterName != null ? String(filterName || '').trim() : String(this.data.recipientFilter || '').trim()
    if (recipientFilter) {
      return {
        emptyTitle: `还没有与「${recipientFilter}」的往来`,
        emptyDesc: '可为 TA 选一份山海，或清除筛选查看全部往来。',
        showEmptyGuide: true
      }
    }
    if (tab === 'received') {
      if (isFilter) {
        return {
          emptyTitle: '这一格暂时空着',
          emptyDesc: '换一段筛选看看，或回到「全部」翻阅。',
          showEmptyGuide: false
        }
      }
      return {
        emptyTitle: '还没有收到的礼赠',
        emptyDesc: '友人交来的礼笺，会出现在这里。也可先记下对象与日子，人情账本会慢慢丰满。',
        showEmptyGuide: true
      }
    }
    if (isFilter) {
      return {
        emptyTitle: '这一格暂时空着',
        emptyDesc: '换一段筛选，或去柜中选一份新的山海。',
        showEmptyGuide: true
      }
    }
    return {
      emptyTitle: '还没有送出的礼赠',
      emptyDesc: '选一份藏品，写上礼笺，交给想送的人——往来会记在这里。',
      showEmptyGuide: true
    }
  },

  /** 点击待办焦点条 → 落到对应段位（不改云端筛选契约） */
  onTodoFocusTap() {
    const focus = this.data.todoFocus
    if (!focus || !focus.segment) return
    if (this.data.hubTab !== 'flow') {
      this.setData({ hubTab: 'flow' })
    }
    const key = focus.segment
    if (key === this.data.activeSegment) return
    wx.vibrateShort({ type: 'light' })
    trackBehavior('gift_mine_todo_focus', 'segment', key)
    const copy = this.emptyCopy(this.data.flowTab, key)
    this.setData({
      activeSegment: key,
      list: [],
      ...this.foldedResetPatch(),
      page: 1,
      hasMore: false,
      errorMsg: '',
      ...copy
    })
    this.loadList(true)
  },

  /** 需求 31：展开/收起「已退款 · 已取消」 */
  toggleFolded() {
    try {
      wx.vibrateShort({ type: 'light' })
    } catch (e) { /* 部分机型不支持 */ }
    this.setData({ foldedExpanded: !this.data.foldedExpanded })
  },

  /**
   * 需求 31：折叠区的复位补丁。
   * 换分栏 / 换段位 / 清筛选都会换掉整批数据，折叠区必须跟着收回 ——
   * 三处共用一个补丁，避免将来只在其中一处补而漏掉另一处。
   */
  foldedResetPatch() {
    return {
      activeList: [],
      foldedList: [],
      foldedCount: 0,
      foldedCap: '',
      foldedExpanded: false
    }
  },

  buildSegments(tab, counts) {
    const base = tab === 'received' ? RECEIVED_SEGMENTS : SENT_SEGMENTS
    const src = counts || {}
    return base.map((s) => ({ ...s, count: Number(src[s.key]) || 0 }))
  },

  onHubTab(e) {
    const tab = String((e.currentTarget.dataset && e.currentTarget.dataset.tab) || '').trim()
    if (!tab || tab === this.data.hubTab) return
    wx.vibrateShort({ type: 'light' })
    this.setData({ hubTab: tab })
    trackBehavior('gift_mine_hub', 'hub', tab)
    this.refreshCurrent({ soft: false })
    this.syncScrollPane()
  },

  onFlowTab(e) {
    const tab = String((e.currentTarget.dataset && e.currentTarget.dataset.tab) || '').trim()
    if (!tab || tab === this.data.flowTab) return
    wx.vibrateShort({ type: 'light' })
    const clearFilter = tab === 'received'
    const nextFilter = clearFilter ? '' : this.data.recipientFilter
    const copy = this.emptyCopy(tab, 'all', nextFilter)
    this.setData({
      flowTab: tab,
      activeSegment: 'all',
      segments: this.buildSegments(tab, {}),
      list: [],
      // 需求 31：切换分栏/筛选时收起折叠区，避免保留上一次的展开态
      ...this.foldedResetPatch(),
      page: 1,
      hasMore: false,
      errorMsg: '',
      todoFocus: null,
      ...(clearFilter ? { recipientFilter: '', filterLabel: '' } : {}),
      ...copy
    })
    this.loadList(true)
  },

  onSegmentTap(e) {
    const key = String((e.currentTarget.dataset && e.currentTarget.dataset.key) || '').trim()
    if (!key || key === this.data.activeSegment) return
    wx.vibrateShort({ type: 'light' })
    const copy = this.emptyCopy(this.data.flowTab, key)
    this.setData({
      activeSegment: key,
      list: [],
      // 需求 31：换段位等于换了一批数据，折叠区必须一起收回（否则会保留上一次的展开态）
      ...this.foldedResetPatch(),
      page: 1,
      hasMore: false,
      errorMsg: '',
      todoFocus: null,
      ...copy
    })
    this.loadList(true)
  },

  clearRecipientFilter() {
    this.setData({
      recipientFilter: '',
      filterLabel: '',
      // 需求 31：清筛选同样换了一批数据 → 折叠区收回
      ...this.foldedResetPatch(),
      todoFocus: null,
      ...this.emptyCopy(this.data.flowTab, this.data.activeSegment, '')
    })
    this.loadList(true)
  },

  onReachBottom() {
    if (this.data.hubTab !== 'flow') return
    if (!this.data.hasMore || this.data.loadingMore || this.data.loading) return
    this.loadList(false)
  },

  reloadFlow() {
    this.loadList(true)
  },

  noop() {},

  async loadList(reset, opts) {
    if (!this.data.allowed) return
    const soft = !!(opts && opts.soft) && reset && (this.data.list || []).length > 0
    if (reset) {
      if (soft) this.setData({ softRefreshing: true, errorMsg: '', page: 1 })
      else this.setData({ loading: true, errorMsg: '', page: 1 })
    } else {
      this.setData({ loadingMore: true })
    }

    const page = reset ? 1 : (this.data.page || 1) + 1
    const tab = this.data.flowTab
    const segment = this.data.activeSegment || 'all'
    const recipientName = tab === 'sent' ? String(this.data.recipientFilter || '').trim() : ''

    try {
      const call = await wx.cloud.callFunction({
        name: 'manageGift',
        data: {
          action: 'listMine',
          tab,
          segment,
          page,
          pageSize: PAGE_SIZE,
          recipientName: recipientName || undefined
        }
      })
      const result = (call && call.result) || {}
      if (!result.success) {
        if (result.code === 'GIFT_CLOSED') {
          toastGiftClosed()
          this.setData({
            allowed: false,
            loading: false,
            loadingMore: false,
            softRefreshing: false
          })
          return
        }
        throw new Error(result.msg || '加载失败')
      }

      const rows = Array.isArray(result.list) ? result.list : []
      const fileIds = []
      rows.forEach((item) => {
        const img = item.productImage || ''
        if (img && String(img).startsWith('cloud://')) fileIds.push(img)
      })
      const urlMap = await batchTempFileURLs(fileIds)
      const mapped = rows.map((item) => {
        const raw = item.productImage || ''
        const productImage =
          (raw && urlMap[raw]) ||
          (raw && !String(raw).startsWith('cloud://') ? raw : '') ||
          ''
        const price = item.totalPrice
        return decorateFlowItem(
          {
            ...item,
            productImage,
            totalPrice:
              price != null && Number.isFinite(Number(price))
                ? Number(price).toFixed(2)
                : undefined
          },
          tab
        )
      })

      const list = reset ? mapped : (this.data.list || []).concat(mapped)
      // 需求 31：已退款 / 已取消（失效终态）折叠展示，不再与在途礼赠混排。
      // 仅拆出用于渲染的两个子列表，`list` 本体保持不变（分页 concat 依赖它）。
      const activeList = list.filter((it) => !it.inactive)
      const foldedList = list.filter((it) => it.inactive)
      const copy = this.emptyCopy(tab, segment)
      const flowBadge = Number(result.todoCount || 0) + Number(result.attentionCount || 0)
      const upcomingHotCount =
        result.upcomingDateCount != null
          ? Number(result.upcomingDateCount) || 0
          : this.data.upcomingHotCount
      const segments = this.buildSegments(tab, result.segmentCounts || {})
      const todoFocus =
        flowBadge > 0 && this.data.activeSegment === 'all' && !recipientName
          ? pickTodoFocus(tab, segments)
          : null
      this.setData({
        list,
        activeList,
        foldedList,
        foldedCount: foldedList.length,
        foldedCap: foldedCapText(foldedList.length, !!result.hasMore),
        page,
        hasMore: !!result.hasMore,
        loading: false,
        loadingMore: false,
        softRefreshing: false,
        errorMsg: '',
        flowBadge,
        todoFocus,
        counts: {
          sent: (result.counts && result.counts.sent) || 0,
          received: (result.counts && result.counts.received) || 0
        },
        segments,
        upcomingHotCount,
        ...copy
      })
      this.updateHeroSummary({ flowBadge, upcomingHotCount })
    } catch (e) {
      console.warn('gift listMine', e)
      this.setData({
        loading: false,
        loadingMore: false,
        softRefreshing: false,
        errorMsg: reset && !soft ? '礼簿片刻未开，请稍后再试' : this.data.errorMsg
      })
      if (!reset) wx.showToast({ title: '加载更多失败', icon: 'none' })
      else if (soft) wx.showToast({ title: '刷新未完成', icon: 'none' })
    }
  },

  onItemTap(e) {
    const link = String((e.currentTarget.dataset && e.currentTarget.dataset.link) || '').trim()
    if (!link) return
    trackBehavior('gift_mine_open', 'path', link.slice(0, 80))
    wx.navigateTo({
      url: link,
      fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' })
    })
  },

  onActionTap(e) {
    const ds = (e.currentTarget && e.currentTarget.dataset) || {}
    const type = String(ds.actionType || '').trim()
    const key = String(ds.actionKey || '').trim()
    const path = String(ds.actionPath || '').trim()
    const orderId = String(ds.orderId || '').trim()
    trackBehavior('gift_mine_action', 'action', key || type, { orderId })
    if (type === 'nudge') {
      this.nudgeOrder(orderId)
      return
    }
    if (type === 'nav' && path) {
      wx.navigateTo({
        url: path,
        fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' })
      })
    }
  },

  async onVerifyTap(e) {
    const orderId = String((e.currentTarget.dataset && e.currentTarget.dataset.orderId) || '')
    const item = (this.data.list || []).find((x) => x.orderId === orderId)
    if (!orderId || this.data.verifyBusy || (item && !item.verifyEditable)) return
    this._verifyOrderId = orderId
    this.setData({ verifyBusy: true, verifyError: '' })
    const state = await loadReceiverVerify(orderId)
    if (!state.success || !state.editable) {
      this.setData({ verifyBusy: false })
      return
    }
    this.setData({ verifyBusy: false, verifySheet: true, sheetOpen: true, verifyCopy: sheetCopy(state) })
  },

  closeVerifySheet() {
    this.setData({ verifySheet: false, sheetOpen: false })
  },

  async onClaimTap(e) {
    const orderId = String((e.currentTarget.dataset && e.currentTarget.dataset.orderId) || '')
    if (!orderId || this.data.verifyBusy) return
    this._verifyOrderId = orderId
    this.setData({ verifyBusy: true, verifyError: '' })
    const state = await loadReceiverVerify(orderId)
    if (!state.success) return this.setData({ verifyBusy: false })
    this.setData({ verifyBusy: false, claimSheet: true, sheetOpen: true, claimState: state, claimNotice: '', verifyCopy: sheetCopy(state) })
  },

  closeClaimSheet() {
    this.setData({ claimSheet: false, sheetOpen: false })
  },

  async onClaimPasscode(e) {
    this.setData({ verifyBusy: true, verifyError: '' })
    const res = await setClaimPasscode(this._verifyOrderId, e.detail && e.detail.enable)
    if (!res.success) return this.setData({ verifyBusy: false, verifyError: res.msg || '此刻未能保存，请稍后再试' })
    const state = await loadReceiverVerify(this._verifyOrderId)
    this.setData({ verifyBusy: false, claimState: state })
    this.loadList(true)
  },

  async onClaimReset() {
    this.setData({ verifyBusy: true, verifyError: '' })
    const res = await resetShareLink(this._verifyOrderId)
    if (!res.success) return this.setData({ verifyBusy: false, verifyError: res.msg || '此刻未能作废，请稍后再试' })
    const state = await loadReceiverVerify(this._verifyOrderId)
    this.setData({
      verifyBusy: false,
      claimState: state,
      claimNotice: '旧链接已作废。请到这份礼赠的详情里重新分享新礼笺给 TA' + (res.passcode ? `，新口令 ${res.passcode}` : '') + '。'
    })
    this.loadList(true)
  },

  onClaimUsePhone() {
    this.setData({ claimSheet: false, verifySheet: true, sheetOpen: true, verifyError: '' })
  },

  async _saveVerify(payload) {
    this.setData({ verifyBusy: true, verifyError: '' })
    const res = await saveReceiverPhone(this._verifyOrderId, payload)
    if (!res.success) {
      this.setData({ verifyBusy: false, verifyError: res.msg || '此刻未能保存，请稍后再试' })
      return
    }
    this.setData({ verifyBusy: false, verifySheet: false, sheetOpen: false })
    this.loadList(true)
  },

  onVerifyPhone(e) { this._saveVerify({ phone: e.detail.phone }) },
  onVerifyUseAddress() { this._saveVerify({ useAddressPhone: true }) },
  onVerifyClear() { this._saveVerify({ phone: '' }) },

  async nudgeOrder(orderId) {
    if (!orderId || this._nudging) return
    this._nudging = true
    wx.showLoading({ title: '轻声提醒中…', mask: true })
    try {
      await requestGiftSubscribe('nudge').catch(() => {})
      const res = await wx.cloud.callFunction({
        name: 'manageGift',
        data: { action: 'nudge', orderId }
      })
      wx.hideLoading()
      const result = (res && res.result) || {}
      wx.showToast({
        title: result.msg || (result.success ? '已轻轻提醒' : '此刻未能提醒'),
        icon: 'none'
      })
      if (result.success) this.loadList(true)
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '网络未通，请稍后再试', icon: 'none' })
    } finally {
      this._nudging = false
    }
  },

  async loadContacts(opts) {
    const soft = !!(opts && opts.soft) && (this.data.contacts || []).length > 0
    this.setData(
      soft
        ? { softRefreshing: true, contactsError: '' }
        : { contactsLoading: true, contactsError: '' }
    )
    try {
      const call = await wx.cloud.callFunction({
        name: 'manageGift',
        data: { action: 'listContacts' }
      })
      const result = (call && call.result) || {}
      if (!result.success) throw new Error(result.msg || '加载失败')
      const contacts = (result.list || []).map((c) => {
        const count = Number(c.giftCount) || 0
        return {
          ...c,
          nameInitial: String(c.name || '赠').slice(0, 1),
          giftCountLabel: count > 0 ? `已送出 ${count} 次` : '尚未送出'
        }
      })
      this.setData({
        contacts,
        contactsCount: contacts.length,
        contactsLoading: false,
        softRefreshing: false,
        contactsError: '',
        relationOptions: result.relations || [],
        contactPickList: (result.list || []).map((c) => ({ id: c.id, name: c.name }))
      })
      this.updateHeroSummary({ contactsCount: contacts.length })
    } catch (e) {
      console.warn('listContacts', e)
      this.setData({
        contactsLoading: false,
        softRefreshing: false,
        contactsError: soft ? '' : '名册片刻未开，请稍后再试'
      })
      if (soft) wx.showToast({ title: '刷新未完成', icon: 'none' })
    }
  },

  openContactForm() {
    this.setData({
      sheetContactMounted: true,
      sheetOpen: true,
      formBusy: false,
      contactForm: { id: '', name: '', relation: 'friend', note: '' }
    })
    setTimeout(() => this.setData({ showContactForm: true }), 20)
  },

  editContact(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim()
    const row = (this.data.contacts || []).find((c) => c.id === id)
    if (!row) return
    this.setData({
      sheetContactMounted: true,
      sheetOpen: true,
      formBusy: false,
      contactForm: {
        id: row.id,
        name: row.name || '',
        relation: row.relation || 'friend',
        note: row.note || ''
      }
    })
    setTimeout(() => this.setData({ showContactForm: true }), 20)
  },

  closeContactForm() {
    if (this.data.formBusy) return
    this.setData({ showContactForm: false })
    setTimeout(() => {
      if (!this.data.showContactForm) {
        this.setData({
          sheetContactMounted: false,
          sheetOpen: this.data.showDateForm
        })
      }
    }, 240)
  },

  onContactName(e) {
    this.setData({ 'contactForm.name': String((e.detail && e.detail.value) || '').slice(0, 20) })
  },
  onContactNote(e) {
    this.setData({ 'contactForm.note': String((e.detail && e.detail.value) || '').slice(0, 40) })
  },
  onContactRelation(e) {
    const key = String((e.currentTarget.dataset && e.currentTarget.dataset.key) || '').trim()
    if (!key) return
    this.setData({ 'contactForm.relation': key })
  },

  async saveContact() {
    if (this.data.formBusy) return
    const form = this.data.contactForm || {}
    if (!String(form.name || '').trim()) {
      wx.showToast({ title: '请填写称呼', icon: 'none' })
      return
    }
    this.setData({ formBusy: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageGift',
        data: {
          action: 'saveContact',
          id: form.id || '',
          name: form.name,
          relation: form.relation,
          note: form.note
        }
      })
      const result = (res && res.result) || {}
      wx.showToast({ title: result.msg || (result.success ? '已保存' : '未能保存'), icon: 'none' })
      if (result.success) {
        this.setData({ formBusy: false })
        this.closeContactForm()
        this.loadContacts()
      } else {
        this.setData({ formBusy: false })
      }
    } catch (e) {
      this.setData({ formBusy: false })
      wx.showToast({ title: '网络未通', icon: 'none' })
    }
  },

  deleteContact(e) {
    if (this.data.formBusy) return
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim()
    if (!id) return
    openAppModal({
      title: '移出名单',
      content: '确定从馈赠对象中移出？关联日子仍会保留。',
      confirmText: '移出',
      confirmColor: '#C4A76C',
      success: async (r) => {
        if (!r.confirm) return
        this.setData({ formBusy: true })
        try {
          const res = await wx.cloud.callFunction({
            name: 'manageGift',
            data: { action: 'deleteContact', id }
          })
          const result = (res && res.result) || {}
          wx.showToast({ title: result.msg || '已移出', icon: 'none' })
          if (result.success) {
            this.setData({ formBusy: false })
            this.closeContactForm()
            this.loadContacts()
          } else {
            this.setData({ formBusy: false })
          }
        } catch (err) {
          this.setData({ formBusy: false })
          wx.showToast({ title: '网络未通', icon: 'none' })
        }
      }
    }, this)
  },

  giftForContact(e) {
    const ds = (e.currentTarget && e.currentTarget.dataset) || {}
    this.goGiftSelect({
      toName: ds.name,
      scene: ds.scene,
      contactId: ds.contactId
    })
  },

  viewContactGifts(e) {
    const ds = (e.currentTarget && e.currentTarget.dataset) || {}
    const name = String(ds.name || '').trim()
    if (!name) return
    wx.vibrateShort({ type: 'light' })
    trackBehavior('gift_mine_contact_flow', 'name', name.slice(0, 20))
    const copy = this.emptyCopy('sent', 'all', name)
    this.setData({
      hubTab: 'flow',
      flowTab: 'sent',
      activeSegment: 'all',
      recipientFilter: name,
      filterLabel: `致 ${name}`,
      list: [],
      // 需求 31：从对象跳往来等于换了一批数据 → 折叠区收回
      ...this.foldedResetPatch(),
      page: 1,
      hasMore: false,
      errorMsg: '',
      todoFocus: null,
      segments: this.buildSegments('sent', {}),
      ...copy
    })
    this.loadList(true)
    this.syncScrollPane()
  },

  async loadDates(opts) {
    const soft = !!(opts && opts.soft) && (this.data.dates || []).length > 0
    this.setData(
      soft ? { softRefreshing: true, datesError: '' } : { datesLoading: true, datesError: '' }
    )
    try {
      const call = await wx.cloud.callFunction({
        name: 'manageGift',
        data: { action: 'listDates' }
      })
      const result = (call && call.result) || {}
      if (!result.success) throw new Error(result.msg || '加载失败')
      const decorate = (d) => ({
        ...d,
        untilText: untilText(d.daysUntil),
        signalClass: giftDateSignal(d.urgency),
        isToday: d.daysUntil === 0,
        isTomorrow: d.daysUntil === 1
      })
      const dates = (result.list || []).map(decorate)
      const upcomingDates = (result.upcoming || []).map(decorate)
      const upcomingHotCount = Number(result.upcomingHotCount) || 0
      const upcomingCount = Number(result.upcomingCount) || upcomingDates.length
      const hotSpotlight =
        upcomingDates.find((d) => d.daysUntil === 0) ||
        upcomingDates.find((d) => d.daysUntil === 1) ||
        upcomingDates.find((d) => d.urgency === 'hot') ||
        null
      this.setData({
        dates,
        upcomingDates,
        upcomingHotCount,
        hotSpotlight,
        datesHeadSignalClass: giftDatesPaneSignal({ upcomingHotCount, upcomingCount }),
        datesLoading: false,
        softRefreshing: false,
        datesError: '',
        dateTypeOptions: resolveDateTypeOptions(result.dateTypes),
        contactPickList: result.contacts || []
      })
      this.updateHeroSummary({ upcomingHotCount })
    } catch (e) {
      console.warn('listDates', e)
      this.setData({
        datesLoading: false,
        softRefreshing: false,
        datesError: soft ? '' : '日历片刻未开，请稍后再试',
        dateTypeOptions: resolveDateTypeOptions(this.data.dateTypeOptions)
      })
      if (soft) wx.showToast({ title: '刷新未完成', icon: 'none' })
    }
  },

  openDateForm() {
    this.setData({
      sheetDateMounted: true,
      sheetOpen: true,
      formBusy: false,
      dateForm: emptyDateForm({ type: 'birthday' }, this.data.dateTypeOptions),
      datePickerEnd: todayDateStr()
    })
    this.prefetchProfileBirthday()
    setTimeout(() => this.setData({ showDateForm: true }), 20)
  },

  editDate(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim()
    const row = (this.data.dates || []).find((d) => d.id === id)
    if (!row) return
    this.setData({
      sheetDateMounted: true,
      sheetOpen: true,
      formBusy: false,
      dateForm: emptyDateForm(
        {
          id: row.id,
          type: row.type || 'birthday',
          title: row.title || '',
          contactId: row.contactId || '',
          contactName: row.contactName || '',
          year: row.year || '',
          month: row.month,
          day: row.day
        },
        this.data.dateTypeOptions
      ),
      datePickerEnd: todayDateStr()
    })
    this.prefetchProfileBirthday()
    setTimeout(() => this.setData({ showDateForm: true }), 20)
  },

  closeDateForm() {
    if (this.data.formBusy) return
    this.setData({ showDateForm: false })
    setTimeout(() => {
      if (!this.data.showDateForm) {
        this.setData({
          sheetDateMounted: false,
          sheetOpen: this.data.showContactForm
        })
      }
    }, 240)
  },

  async prefetchProfileBirthday() {
    try {
      const session = await ensureSession(getApp())
      const birthday = (session && session.user && session.user.birthday) || ''
      const parsed = parseYmd(birthday)
      this.setData({
        profileBirthday: parsed ? parsed.dateValue : '',
        profileBirthdayDisplay: parsed ? parsed.dateDisplay : ''
      })
    } catch (e) {
      this.setData({ profileBirthday: '', profileBirthdayDisplay: '' })
    }
  },

  onDateType(e) {
    const key = String((e.currentTarget.dataset && e.currentTarget.dataset.key) || '').trim()
    if (!key) return
    const form = this.data.dateForm || {}
    const next = emptyDateForm(
      {
        ...form,
        type: key
      },
      this.data.dateTypeOptions
    )
    this.setData({ dateForm: next })
  },
  onDateContact(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    const name = String((e.currentTarget.dataset && e.currentTarget.dataset.name) || '')
    this.setData({
      'dateForm.contactId': id,
      'dateForm.contactName': name
    })
  },
  onDateTitle(e) {
    this.setData({ 'dateForm.title': String((e.detail && e.detail.value) || '').slice(0, 20) })
  },
  onDatePickerChange(e) {
    const value = String((e.detail && e.detail.value) || '').trim()
    const parsed = parseYmd(value)
    if (!parsed) {
      wx.showToast({ title: '日期无效', icon: 'none' })
      return
    }
    const form = this.data.dateForm || {}
    this.setData({
      dateForm: emptyDateForm(
        {
          ...form,
          year: parsed.year,
          month: parsed.month,
          day: parsed.day
        },
        this.data.dateTypeOptions
      )
    })
  },

  importProfileBirthday() {
    const value = this.data.profileBirthday
    const parsed = parseYmd(value)
    if (!parsed) {
      openAppModal({
        title: '尚未填写生日',
        content: '个人资料里还没有生日。去完善后，即可一键导入到这里。',
        confirmText: '去完善',
        confirmColor: '#C4A76C',
        success: (r) => {
          if (r.confirm) {
            wx.navigateTo({
              url: PROFILE_PATH,
              fail: () => wx.showToast({ title: '未能打开资料页', icon: 'none' })
            })
          }
        }
      }, this)
      return
    }
    const form = this.data.dateForm || {}
    const title = form.title && String(form.title).trim() ? form.title : '我的生日'
    this.setData({
      dateForm: emptyDateForm(
        {
          ...form,
          type: 'birthday',
          title,
          year: parsed.year,
          month: parsed.month,
          day: parsed.day,
          contactId: '',
          contactName: ''
        },
        this.data.dateTypeOptions
      )
    })
    wx.showToast({ title: '已导入个人生日', icon: 'none' })
  },

  goEditProfile() {
    wx.navigateTo({
      url: PROFILE_PATH,
      fail: () => wx.showToast({ title: '未能打开资料页', icon: 'none' })
    })
  },

  async saveDate() {
    if (this.data.formBusy) return
    const form = this.data.dateForm || {}
    const month = parseInt(form.month, 10)
    const day = parseInt(form.day, 10)
    const yearRaw = parseInt(form.year, 10)
    const year = Number.isFinite(yearRaw) && yearRaw >= 1900 && yearRaw <= 2100 ? yearRaw : null
    if (!month || !day) {
      wx.showToast({ title: '请选择日期', icon: 'none' })
      return
    }
    if (dateTypeRequiresYear(form.type, this.data.dateTypeOptions) && !year) {
      const label = dateTypeMeta(form.type, this.data.dateTypeOptions).label || '该日子'
      wx.showToast({ title: `${label}请选择完整年月日`, icon: 'none' })
      return
    }
    this.setData({ formBusy: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageGift',
        data: {
          action: 'saveDate',
          id: form.id || '',
          type: form.type,
          title: form.title,
          contactId: form.contactId,
          contactName: form.contactName,
          year: year || '',
          month,
          day
        }
      })
      const result = (res && res.result) || {}
      if (result.success) {
        wx.showToast({ title: result.msg || '已保存', icon: 'none' })
        this.setData({ formBusy: false })
        this.closeDateForm()
        this.loadDates()
        return
      }
      const code = String(result.code || '')
      let title = result.msg || '未能保存'
      if (code === 'NEED_DATE' || code === 'NEED_YEAR') {
        title = result.msg || '请检查日期'
      } else if (code === 'DB_SETUP' || code === 'DB_PERM' || code === 'DB_ERROR') {
        title = result.msg || '账本写入失败，请稍后再试'
      } else if (code === 'GIFT_CLOSED') {
        title = '礼赠暂未开放'
      }
      wx.showToast({ title, icon: 'none' })
      this.setData({ formBusy: false })
    } catch (e) {
      this.setData({ formBusy: false })
      wx.showToast({ title: '网络未通，请检查后重试', icon: 'none' })
    }
  },

  deleteDate(e) {
    if (this.data.formBusy) return
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim()
    if (!id) return
    openAppModal({
      title: '删除日子',
      content: '确定从日历中移出这一天？',
      confirmText: '删除',
      confirmColor: '#C4A76C',
      success: async (r) => {
        if (!r.confirm) return
        this.setData({ formBusy: true })
        try {
          const res = await wx.cloud.callFunction({
            name: 'manageGift',
            data: { action: 'deleteDate', id }
          })
          const result = (res && res.result) || {}
          wx.showToast({ title: result.msg || '已删除', icon: 'none' })
          if (result.success) {
            this.setData({ formBusy: false })
            this.closeDateForm()
            this.loadDates()
          } else {
            this.setData({ formBusy: false })
          }
        } catch (err) {
          this.setData({ formBusy: false })
          wx.showToast({ title: '网络未通', icon: 'none' })
        }
      }
    }, this)
  },

  giftForDate(e) {
    const ds = (e.currentTarget && e.currentTarget.dataset) || {}
    this.goGiftSelect({
      toName: ds.name,
      scene: ds.scene || 'birthday',
      contactId: ds.contactId
    })
  },

  goGiftSelect({ toName, scene, contactId } = {}) {
    const name = String(toName || '').trim().slice(0, 40)
    const sceneKey = String(scene || '').trim()
    const cid = String(contactId || '').trim()
    // URL 传参 + storage 明文双通道，避免中文经 encode 后下游未 decode 成乱码
    try {
      wx.setStorageSync('gift_compose_prefills', {
        toName: name,
        contactId: cid,
        scene: sceneKey
      })
    } catch (e) { /* ignore */ }
    const q = ['from=my_gifts']
    if (sceneKey) q.push(`scene=${encodeURIComponent(sceneKey)}`)
    if (name) q.push(`toName=${encodeURIComponent(name)}`)
    if (cid) q.push(`contactId=${encodeURIComponent(cid)}`)
    trackBehavior('gift_mine_select', 'scene', sceneKey || '', { toName: name })
    wx.navigateTo({
      url: `/subpackages/feature/gift/hub/index?${q.join('&')}`,
      fail: () => this.goAtelier()
    })
  },

  goHub() {
    this.goGiftSelect({})
  },

  goAtelier() {
    wx.switchTab({
      url: '/pages/atelier/index',
      fail: () => wx.showToast({ title: '无法打开工坊', icon: 'none' })
    })
  }
})
