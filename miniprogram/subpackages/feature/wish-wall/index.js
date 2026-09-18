// subpackages/feature/wish-wall/index.js
/**
 * 需求 28：马上有 · 弹幕祈福墙（C 端）
 *
 * 闸门：`content_display_flags.showMaShangYou`（缺配置默认关）。
 * 关闭时本页只显示「暂未开放」，且**不发起任何网络请求** ——
 * 开关的意义就是关掉写入与展示，若关闭后还去拉列表，等于没关。
 *
 * 作用域：`productKey` 由入口带过来（缺省 `mashangyou`）。这是「全站拓展」的支点 ——
 * 第二面祈福墙 = 藏品记录上加一个 `wishWallKey`，本页一行都不用改。
 *
 * 仪式与彩蛋（本页三件事，都不依赖网络，失败也不影响祈福墙主流程）：
 *   1. 进页彩蛋：`easterEgg.tryPageEnter` → 注册表里 `pageEnter` 命中「吉量」；
 *   2. 落愿彩蛋：发布成功后 `tryWishPosted` → 命中「驳」；
 *   3. 点灯仪式：本地记录当日点灯 + 每日一句（确定性轮换）。
 *   之所以做成"本地 + 注册表驱动"：彩蛋是**锦上添花**，不能让它成为发弹幕的前置条件，
 *   也不能为了它多一张表、多一个治理面（与「不接 UGC 审核」的口径冲突）。
 */
const {
  normalizeWishText,
  validateWishText,
  buildDanmakuRows,
  danmakuCycleEndMs,
  formatWishTime,
  normalizeProductKey,
  shanghaiDayKey,
  pickDailyLine,
  lampStreak,
  lampTier,
  solarTermOn,
  solarTermGap,
  markMine,
  decorateMineRows,
  mineSummary,
  PRODUCT_KEY,
  TEXT_MAX,
  LIST_LIMIT,
  DAILY_LIMIT,
  dailyQuota,
  splitTagColumns,
  isTagListCapped,
  CYCLE_PAUSE_MS
} = require('../../../utils/wishWall')
const wishRitual = require('../../../utils/wishRitual')
const easterEgg = require('../../../utils/easterEgg')
const easterEggHost = require('../../../utils/easterEggHost')
const { trackBehavior } = require('../../../utils/trackBehavior')
const {
  fetchContentDisplayFlags,
  toastWishWallClosed
} = require('../../../utils/contentDisplayFlags')

const FN = 'manageWishWall'
/** 灵感 chip 展示条数（与服务端 `INSPIRATION_COUNT` 对齐，多取的截掉） */
const INSPIRATION_MAX = 4

/** 刚落愿高亮保持时长（毫秒）：够"看见它落上去"，又不至于变成噪音 */
const FRESH_HOLD_MS = 3200

Page({
  behaviors: [easterEggHost],

  data: {
    allowed: false,
    flagChecked: false,
    loading: true,
    posting: false,
    textMax: TEXT_MAX,
    productId: '',
    productKey: PRODUCT_KEY,
    productTitle: '马上有',
    items: [],
    /** 两列瀑布的列内容（items 的奇偶分列） */
    tagColumns: [],
    /** 打到服务端上限：文案改说「仅展示最近 N 条」 */
    tagCapped: false,
    rows: [],
    inspiration: [],
    draft: '',
    loadError: '',
    myHidden: 0,
    /**
     * 点灯仪式：lit 为当日是否已点，line 为当日那句，streak 为连续天数。
     * `tier`/`lamps`/`label`/`tierNote` 是**灯位层级**（1/3/7 天 → 1/3/5 盏，见 wishWall.lampTier），
     * `solar` 是当天节气（不是节气日则为 null）—— 两者都是纯函数算出来的，页面只负责接线。
     */
    lamp: { dayKey: '', lit: false, litAt: 0, line: '', streak: 0, tier: 0, lamps: 0, label: '', tierNote: '', solar: null },
    /** 愿签墙 / 我的心愿 两个视图（后者含被馆方收起的） */
    viewMode: 'wall',
    mineRows: [],
    mine: { total: 0, visible: 0, hidden: 0 },
    /** 心愿笺（点愿签弹出的那张纸）：null = 未打开 */
    card: null,
    /**
     * 今日额度（诚实预告；拦截始终在服务端）：口径见 utils/wishWall.dailyQuota，
     * 上限与云函数 DAILY_LIMIT 同源（守卫直接读云函数源码比对）。
     */
    quota: { used: 0, left: DAILY_LIMIT, cap: DAILY_LIMIT, exhausted: false },
    /**
     * 刚落愿那条的 _id：愿签与弹幕高亮 ~3.2s。
     * 「挂上墙」此前只有一个 toast —— 心愿落在墙上的**落地感**是这轮补的。
     */
    freshId: '',
    /** 博物笔记进度（彩蛋图鉴入口用） */
    relics: { found: 0, total: 0 },
    /**
     * 弹幕轮次。进 rows 的 key，从而让 DOM 重建、动画重播 ——
     * 弹幕只播一轮（forwards）：若用 CSS 无限循环，第二轮起同轨又会叠在一起
     * （旧实现就是这么叠成灾难现场的）。整批重排由 scheduleDanmakuCycle 定时触发。
     */
    danmakuCycle: 0,
    heartBurst: false
  },

  onLoad(options) {
    const opts = options || {}
    this.setData({
      productId: String(opts.productId || ''),
      // 作用域来自入口组件；非法/缺失一律回落到默认墙，避免拼出一个读不到内容的 key
      productKey: normalizeProductKey(opts.productKey),
      productTitle: String(opts.title ? decodeURIComponent(opts.title) : '马上有')
    })
    trackBehavior('wish_wall_enter', 'from', opts.from || 'direct')
    this.initRitual()
    this.bootstrap()
  },

  onPullDownRefresh() {
    // 下拉 = **强制**重读开关 + 重拉列表。开关走 SWR 缓存（TTL 10 分钟 / 陈旧窗口 24 小时），
    // 下拉是用户自己能把门禁刷新过来的动作 —— 否则只能等缓存过期或清缓存。
    this.bootstrap({ force: true }).finally(() => wx.stopPullDownRefresh())
  },

  /* ----------------------------- 点灯仪式 ----------------------------- */

  /**
   * 组装灯位状态（纯计算，initRitual 与 onLampTap 共用，避免两处各算一遍）。
   *
   * 灯语优先级：**节气当天**用节气句（并显示节气名），否则用通用每日一句 ——
   * 这样"今天是个日子"能被看见，而平时也不会天天重复同一句。
   */
  buildLampState(dayKey, lit, litAt, days) {
    const streak = lit ? lampStreak(days || [], dayKey) : 0
    const tier = lampTier(streak)
    const solar = solarTermOn(dayKey)
    const line = lit
      ? (solar ? String(wishRitual.SOLAR_LINES[solar.season] || '') : pickDailyLine(wishRitual.LAMP_LINES, dayKey))
      : ''
    // 不是节气日时，给"下一个节气还有几天"——给一个"过几天再来"的理由。
    // 只在 7 天内显示：更远的日子说出来只是噪音。
    const gap = solar ? null : solarTermGap(dayKey)
    const solarNext = gap && gap.inDays > 0 && gap.inDays <= 7
      ? { name: gap.name, inDays: gap.inDays }
      : null
    return {
      dayKey,
      lit,
      litAt: litAt || 0,
      line,
      streak,
      tier: tier.tier,
      lamps: tier.lamps,
      // 盏数渲染成小灯：WXML 里 wx:for 传数组最稳（传数字在不同基础库上语义不一致）
      lampDots: Array.from({ length: tier.lamps }, (_, i) => i + 1),
      label: tier.label,
      tierNote: lit ? String(wishRitual.LAMP_TIER_NOTES[tier.tier] || '') : '',
      solar,
      solarNext
    }
  },

  /** 读取当日点灯状态（纯本地；失败即视为未点灯，绝不阻断页面） */
  initRitual() {
    const dayKey = shanghaiDayKey(Date.now())
    let state = { days: [] }
    try {
      state = wishRitual.getLamp(dayKey)
    } catch (e) {
      console.warn('wish wall ritual read failed', e)
    }
    const lit = state.lit === true
    this.setData({ lamp: this.buildLampState(dayKey, lit, state.litAt, state.days) })
  },

  onLampTap() {
    const lamp = this.data.lamp || {}
    if (lamp.lit) {
      // 已点：再点一次把今天那句话读一遍（比弹 toast 更像"看灯"）
      wx.showToast({ title: lamp.line || '今日灯已点', icon: 'none', duration: 2400 })
      return
    }
    const dayKey = lamp.dayKey || shanghaiDayKey(Date.now())
    let saved = { days: [dayKey] }
    try {
      saved = wishRitual.lightLamp(dayKey)
      // 爱心动效：点灯成功时飘一次（transient，约 2.6s 后自动收起 —— 避免常驻重播 ✗）
      this.setData({ heartBurst: true })
      clearTimeout(this._heartTimer)
      this._heartTimer = setTimeout(() => this.setData({ heartBurst: false }), 2600)
    } catch (e) {
      console.warn('wish wall ritual write failed', e)
    }
    const days = saved.days && saved.days.length ? saved.days : [dayKey]
    const next = this.buildLampState(dayKey, true, saved.litAt, days)
    this.setData({ lamp: next })
    try { wx.vibrateShort({ type: 'light' }) } catch (e) { /* ignore */ }
    trackBehavior('wish_wall_lamp', 'day', dayKey)
    // 连续点灯彩蛋：门槛（几天算数）在注册表里，页面只报事实
    this.fireLampStreakEgg(next.streak)
  },

  /** 连续点灯彩蛋（如「騊駼」要求连续 3 天） */
  fireLampStreakEgg(streak) {
    try {
      const res = easterEgg.tryLampStreak({ page: this, source: 'wishWallLamp', streak })
      if (res && res.firstTime && res.egg) trackBehavior('wish_wall_egg', 'egg', res.egg.id)
    } catch (e) {
      console.warn('wish wall lamp egg failed', e)
    }
  },

  /* ----------------------------- 彩蛋 ----------------------------- */

  /**
   * 进页彩蛋。注册表（`config/easterEggs.js`）按 `pages` 命中，本页只报事件 ——
   * 全站拓展时新页面照抄这一行即可，不必回到 easterEgg.js 改匹配逻辑。
   */
  fireEntryEgg() {
    try {
      const res = easterEgg.tryPageEnter({ page: this, source: 'wishWallEnter' })
      if (res && res.firstTime && res.egg) trackBehavior('wish_wall_egg', 'egg', res.egg.id)
    } catch (e) {
      // 彩蛋是锦上添花：失败不得影响祈福墙本身
      console.warn('wish wall entry egg failed', e)
    }
  },

  /** 落愿彩蛋：心愿成功上墙后才判定 */
  fireWishEgg() {
    try {
      const res = easterEgg.tryWishPosted({ page: this, source: 'wishWallPost' })
      if (res && res.firstTime && res.egg) trackBehavior('wish_wall_egg', 'egg', res.egg.id)
    } catch (e) {
      console.warn('wish wall post egg failed', e)
    }
  },

  /* ----------------------------- 数据 ----------------------------- */

  /**
   * 读开关并收敛页面状态（缓存值先到、新鲜值后到，都走 applyGate 同一处判定）。
   *
   * ⚠️ `fetchContentDisplayFlags` 走 SWR：缓存命中时**立刻返回缓存值**，新鲜值只在后台回填
   * （TTL 10 分钟 / 陈旧窗口 24 小时）。不接 `onUpdate` 就等于把新值丢掉 ——
   * 于是「超管刚把开关打开」本页最长 ~24 小时仍然显示「暂未开放」。
   *
   * @param {{force?:boolean}} [opts] force = 跳过缓存直取云端（下拉刷新用）
   */
  async bootstrap(opts) {
    const force = !!(opts && opts.force)
    try {
      const { flags } = await fetchContentDisplayFlags({
        force,
        onUpdate: (payload) => this.applyGate(payload && payload.flags)
      })
      await this.applyGate(flags)
    } catch (e) {
      // 开关读取失败：保守关闭（UGC 新能力，读不到就当没开）
      this.setData({ allowed: false, flagChecked: true, loading: false })
    }
  },

  /** 门禁收敛：未开放时**提前返回，不发起任何网络请求** */
  async applyGate(flags) {
    const allowed = !!(flags && flags.showMaShangYou === true)
    if (allowed === this.data.allowed && this.data.flagChecked) return
    this.setData({ allowed, flagChecked: true, loading: allowed })
    if (!allowed) return
    await this.refresh()
    // 彩蛋放在内容就位之后：先亮出墙面，再给惊喜
    this.fireEntryEgg()
  },

  async callFn(data) {
    const res = await wx.cloud.callFunction({ name: FN, data: data || {} })
    return (res && res.result) || {}
  },

  async refresh() {
    if (!this.data.allowed) return
    this.setData({ loadError: '' })
    try {
      const result = await this.callFn({ action: 'list', productKey: this.data.productKey, limit: LIST_LIMIT })
      if (!result.success) {
        this.setData({ loadError: result.msg || '加载失败', loading: false })
        return
      }
      this.applyItems(result.list || [], result.inspiration || [])
      this.loadMine()
    } catch (e) {
      console.warn('wish wall list', e)
      this.setData({ loadError: (e && e.errMsg) || '加载失败', loading: false })
    }
  },

  applyItems(list, inspiration) {
    const now = Date.now()
    const items = (Array.isArray(list) ? list : []).map((row) => ({
      _id: row._id || '',
      text: normalizeWishText(row.text),
      nickname: row.nickname || '匿名藏家',
      avatar: row.avatar || '',
      pinned: row.pinned === true,
      // 馆方/AI 创作的内容标一下，用户才知道这条不是别人写的
      official: row.source === 'ai' || row.source === 'seed',
      timeText: formatWishTime(row.createTime, now),
      // 刚落愿那条：提交时乐观插入，刷新回包后按 _id 续上高亮
      isFresh: !!this.data.freshId && String(row._id || '') === this.data.freshId
    }))
    // 墙面数据留一份原始副本：`mine` 回来之后要按 _id 给它补 `isMine`
    this._wallItems = items
    this.setData({
      items,
      // 两列瀑布与「是否打到上限」都是纯函数（见 utils/wishWall.js），页面只负责接线
      tagColumns: splitTagColumns(items),
      // 服务端一面墙只回 LIST_LIMIT 条：到底了必须说清是"最近 N 条"，不能装作全量
      tagCapped: isTagListCapped(items.length),
      inspiration: (Array.isArray(inspiration) ? inspiration : [])
        .map((t) => normalizeWishText(t))
        .filter(Boolean)
        .slice(0, INSPIRATION_MAX),
      // 弹幕永远取自**墙面**（不是我的心愿视图）：弹幕是"这面墙在流动"的观感
      rows: buildDanmakuRows(items, { cycle: this.data.danmakuCycle || 0 }),
      loading: false
    })
    this.scheduleDanmakuCycle(this.data.rows)
  },

  /**
   * 把「当前视图」的数据铺进 tagColumns。
   * 墙面 / 我的心愿共用同一套渲染（两列瀑布、愿签样式），只有数据源不同。
   */
  applyView() {
    const freshId = this.data.freshId
    const raw = this.data.viewMode === 'mine' ? (this._mineRows || []) : (this._wallItems || [])
    // 刚落愿那条要一直亮着：视图切换、刷新回包都不能把它闪掉，故按 _id 续标
    const src = raw.map((it) => (it && it.isFresh === undefined
      ? Object.assign({}, it, { isFresh: !!freshId && String(it._id) === freshId })
      : it))
    this.setData({
      items: src,
      tagColumns: splitTagColumns(src),
      // 服务端一面墙只回 LIST_LIMIT 条：到底了必须说清是"最近 N 条"，不能装作全量
      tagCapped: isTagListCapped(src.length)
    })
  },

  /** 切换「墙上的愿签 / 我的心愿」 */
  switchView(e) {
    const mode = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.mode) || '')
    const next = mode === 'mine' ? 'mine' : 'wall'
    if (next === this.data.viewMode) return
    this.setData({ viewMode: next })
    this.applyView()
  },

  /* ----------------------------- 弹幕轮播 ----------------------------- */

  /**
   * 一轮弹幕播完后停顿一下再整批重排。
   *
   * 为什么不是 CSS `animation-iteration-count: infinite`：每条弹幕的时长由字数决定，
   * 各自循环会越走越错位，第二轮起同轨又叠在一起 —— 必须整批按轨道占用重排。
   * 重排靠 `danmakuCycle` 进 key（同 key 不会重播动画）。
   */
  scheduleDanmakuCycle(rows) {
    this.clearDanmakuCycle()
    const endMs = danmakuCycleEndMs(rows)
    if (!endMs) return
    this._danmakuTimer = setTimeout(() => {
      this._danmakuTimer = null
      if (!this.data.allowed || !(this.data.items || []).length) return
      const cycle = (this.data.danmakuCycle || 0) + 1
      const next = buildDanmakuRows(this.data.items, { cycle })
      this.setData({ danmakuCycle: cycle, rows: next })
      this.scheduleDanmakuCycle(next)
    }, endMs + CYCLE_PAUSE_MS)
  },

  clearDanmakuCycle() {
    if (this._danmakuTimer) {
      clearTimeout(this._danmakuTimer)
      this._danmakuTimer = null
    }
  },

  /**
   * 刚落愿高亮 ~3.2s 后自然消退。
   * 不做成"一直亮着"：心愿挂上去就算数，长时间高亮会变成噪音。
   */
  scheduleFreshClear() {
    this.clearFreshTimer()
    if (!this.data.freshId) return
    this._freshTimer = setTimeout(() => {
      this._freshTimer = null
      if (!this.data.freshId) return
      const strip = (rows) => (rows || []).map((it) => (it && it.isFresh ? Object.assign({}, it, { isFresh: false }) : it))
      this._wallItems = strip(this._wallItems)
      this._mineRows = strip(this._mineRows)
      this.setData({ freshId: '' })
      this.applyView()
    }, FRESH_HOLD_MS)
  },

  clearFreshTimer() {
    if (this._freshTimer) {
      clearTimeout(this._freshTimer)
      this._freshTimer = null
    }
  },

  onHide() {
    // 切后台不必继续排期；回前台时 onShow 会按当前 rows 重排
    this.clearDanmakuCycle()
  },

  onUnload() {
    this.clearDanmakuCycle()
    this.clearFreshTimer()
  },

  onShow() {
    if (this.data.allowed && (this.data.rows || []).length) {
      this.setData({ rows: this.data.rows })
      this.scheduleDanmakuCycle(this.data.rows)
    }
  },

  /**
   * 自己发的（含被隐藏的）：既让用户理解「我发的去哪了」，也是「我的心愿」视图的数据源。
   *
   * ⚠️ 为什么用 `mine` 而不是让公开列表回 openid：公开列表**刻意不返回 openid**（最小暴露）。
   * 用我自己记录的 `_id` 集合去标记"哪条是我的"，就不必为了一句"我的"把身份铺到公开数据里。
   */
  async loadMine() {
    try {
      const result = await this.callFn({ action: 'mine', productKey: this.data.productKey })
      const list = (result && result.list) || []
      const summary = mineSummary(list)
      this._mineRows = decorateMineRows(list, Date.now())
      // 标记并回写当前视图（viewMode 可能是 mine，也可能还是 wall）
      this._wallItems = markMine(this._wallItems || [], list)
      // 今日额度：只陈述事实（今天写了几条），上限与云函数 DAILY_LIMIT 同源
      const quota = dailyQuota(list, Date.now())
      this.setData({ myHidden: summary.hidden, mine: summary, mineRows: this._mineRows, quota })
      this.applyView()
      this.recordRelics()
      // 我的心愿条数彩蛋：门槛（几条算数）在注册表里，页面只报事实
      this.fireWishCountEgg(summary.total)
    } catch (e) {
      this.setData({ myHidden: 0 })
    }
  },

  /** 我的心愿条数彩蛋（如「鹿蜀」要求满 3 条） */
  fireWishCountEgg(wishCount) {
    try {
      const res = easterEgg.tryWishCount({ page: this, source: 'wishWallMine', wishCount })
      if (res && res.firstTime && res.egg) trackBehavior('wish_wall_egg', 'egg', res.egg.id)
    } catch (e) {
      console.warn('wish wall count egg failed', e)
    }
  },

  /* ----------------------------- 博物笔记（彩蛋图鉴） ----------------------------- */

  /**
   * 把彩蛋进度显示在墙上 —— 拾到的笔记本来就"收入博物笔记"，
   * 但祈福墙上一直没有任何入口指向它，用户不知道去哪儿看。这里补上（失败静默）。
   */
  recordRelics() {
    try {
      const progress = easterEgg.getProgress()
      const found = Number(progress && progress.found) || 0
      const total = Number(progress && progress.total) || 0
      if (found === this.data.relics.found && total === this.data.relics.total) return
      this.setData({ relics: { found, total } })
    } catch (e) {
      // 图鉴是锦上添花，读不到就不显示（不影响祈福墙）
    }
  },

  /** 进博物笔记（彩蛋图鉴）。图鉴在成就页的「遗物」区，用锚点参数直接定位。 */
  goRelics() {
    wx.navigateTo({
      url: '/subpackages/extra/user/achievements/index?focus=relics',
      fail: () => wx.showToast({ title: '博物笔记暂不可用', icon: 'none' })
    })
  },

  /* ----------------------------- 心愿笺 ----------------------------- */

  /** 点愿签 → 展开那张纸（弹幕看得快，愿签看得清，笺看得住） */
  openWishCard(e) {
    const id = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    if (!id) return
    const src = (this._mineRows || []).concat(this._wallItems || [])
    const hit = src.find((it) => String(it._id) === id)
    if (!hit) return
    this.setData({ card: Object.assign({}, hit) })
  },

  closeWishCard() {
    if (!this.data.card) return
    this.setData({ card: null })
  },

  /** 抄一句：把别人的心愿填进输入框（仍可改，不直接发布） */
  borrowWishText() {
    const card = this.data.card
    if (!card) return
    this.setData({ draft: normalizeWishText(card.text).slice(0, TEXT_MAX), card: null })
    wx.showToast({ title: '已填进输入框，可再改', icon: 'none' })
  },

  copyWishText() {
    const card = this.data.card
    if (!card) return
    wx.setClipboardData({
      data: normalizeWishText(card.text),
      success: () => wx.showToast({ title: '已复制', icon: 'none' })
    })
  },

  /** 分享这张心愿笺（转发标题就是那句心愿） */
  onShareAppMessage() {
    const card = this.data.card
    const text = card ? normalizeWishText(card.text) : ''
    return {
      title: text || '马上有 · 祈福墙',
      path: `/subpackages/feature/wish-wall/index?productKey=${encodeURIComponent(this.data.productKey)}`
    }
  },

  /* ----------------------------- 发布 ----------------------------- */

  onDraftInput(e) {
    this.setData({ draft: String((e.detail && e.detail.value) || '').slice(0, TEXT_MAX) })
  },

  /** 灵感 chip：点一下填进输入框（不直接发布，用户仍可改） */
  useInspiration(e) {
    const text = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.text) || '')
    if (!text) return
    this.setData({ draft: normalizeWishText(text).slice(0, TEXT_MAX) })
  },

  async submitWish() {
    if (this.data.posting) return
    if (!this.data.allowed) {
      toastWishWallClosed()
      return
    }
    // 额度用完就地拦住，并**用服务端同一句口径**说明（服务端仍会独立判定，这里只是别让人白写）
    if (this.data.quota && this.data.quota.exhausted) {
      wx.showToast({
        title: `今天已许愿 ${this.data.quota.cap} 次，明天再来`,
        icon: 'none',
        duration: 2500
      })
      return
    }
    const checked = validateWishText(this.data.draft)
    if (!checked.ok) {
      wx.showToast({ title: checked.msg, icon: 'none' })
      return
    }
    this.setData({ posting: true })
    try {
      const result = await this.callFn({
        action: 'post',
        productKey: this.data.productKey,
        productId: this.data.productId,
        text: checked.text
      })
      if (!result.success) {
        wx.showToast({ title: result.msg || '发布失败', icon: 'none', duration: 2500 })
        return
      }
      // 落愿闭环：先本地落地（愿签插到墙首 + 弹幕立即接住 + 高亮），再等权威数据回来对齐。
      // 这样「挂上墙」不再只是一个 toast —— 而是**看得见心愿落在墙上**。
      const fresh = {
        _id: String(result._id || ''),
        text: checked.text,
        nickname: result.nickname || '我',
        avatar: '',
        pinned: false,
        official: false,
        isMine: true,
        isFresh: true,
        timeText: '刚刚'
      }
      this._wallItems = [fresh].concat(this._wallItems || [])
      this.setData({
        draft: '',
        freshId: fresh._id,
        // 额度即时递减（诚实：以本地事实为准，服务端刷新会再校准）
        quota: Object.assign({}, this.data.quota, {
          used: (this.data.quota.used || 0) + 1,
          left: Math.max(0, (this.data.quota.left || 0) - 1),
          exhausted: (this.data.quota.used || 0) + 1 >= (this.data.quota.cap || DAILY_LIMIT)
        })
      })
      if (this.data.viewMode === 'wall') this.applyView()
      this.setData({ rows: buildDanmakuRows(this._wallItems, { cycle: (this.data.danmakuCycle || 0) + 1 }) })
      this.scheduleDanmakuCycle(this.data.rows)
      this.scheduleFreshClear()
      wx.showToast({ title: result.msg || '心愿已挂上墙', icon: 'none' })
      try { wx.vibrateShort({ type: 'light' }) } catch (e) { /* ignore */ }
      trackBehavior('wish_wall_post', 'ok', '1')
      await this.refresh()
      this.fireWishEgg()
    } catch (e) {
      console.error('wish wall post', e)
      wx.showToast({ title: (e && e.errMsg) || '发布失败', icon: 'none', duration: 2500 })
    } finally {
      this.setData({ posting: false })
    }
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) })
  },

  /** 浮层内层的空处理器：`catchtap`/`catchtouchmove` 需要一个存在的目标，防穿透 */
  noop() {}
})
