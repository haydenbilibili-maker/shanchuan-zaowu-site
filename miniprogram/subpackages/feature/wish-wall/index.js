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
  PRODUCT_KEY,
  TEXT_MAX,
  LIST_LIMIT,
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
    // 点灯仪式：lit 为当日是否已点，line 为当日那句，streak 为连续天数
    lamp: { dayKey: '', lit: false, litAt: 0, line: '', streak: 0 },
    /**
     * 弹幕轮次。进 rows 的 key，从而让 DOM 重建、动画重播 ——
     * 弹幕只播一轮（forwards）：若用 CSS 无限循环，第二轮起同轨又会叠在一起
     * （旧实现就是这么叠成灾难现场的）。整批重排由 scheduleDanmakuCycle 定时触发。
     */
    danmakuCycle: 0
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
    this.setData({
      lamp: {
        dayKey,
        lit,
        litAt: state.litAt || 0,
        line: lit ? pickDailyLine(wishRitual.LAMP_LINES, dayKey) : '',
        streak: lit ? lampStreak(state.days || [], dayKey) : 0
      }
    })
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
    } catch (e) {
      console.warn('wish wall ritual write failed', e)
    }
    const days = saved.days && saved.days.length ? saved.days : [dayKey]
    this.setData({
      lamp: {
        dayKey,
        lit: true,
        litAt: saved.litAt || Date.now(),
        line: pickDailyLine(wishRitual.LAMP_LINES, dayKey),
        streak: lampStreak(days, dayKey)
      }
    })
    try { wx.vibrateShort({ type: 'light' }) } catch (e) { /* ignore */ }
    trackBehavior('wish_wall_lamp', 'day', dayKey)
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
      timeText: formatWishTime(row.createTime, now)
    }))
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
      // 弹幕层与静态列表同源：弹幕好看，静态列表可读、可复制、无障碍
      rows: buildDanmakuRows(items, { cycle: this.data.danmakuCycle || 0 }),
      loading: false
    })
    this.scheduleDanmakuCycle(this.data.rows)
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

  onHide() {
    // 切后台不必继续排期；回前台时 onShow 会按当前 rows 重排
    this.clearDanmakuCycle()
  },

  onUnload() {
    this.clearDanmakuCycle()
  },

  onShow() {
    if (this.data.allowed && (this.data.rows || []).length) {
      this.setData({ rows: this.data.rows })
      this.scheduleDanmakuCycle(this.data.rows)
    }
  },

  /** 自己发的（含被隐藏的），让用户理解「我发的去哪了」 */
  async loadMine() {
    try {
      const result = await this.callFn({ action: 'mine', productKey: this.data.productKey })
      const list = (result && result.list) || []
      this.setData({ myHidden: list.filter((r) => r.status === 'hidden').length })
    } catch (e) {
      this.setData({ myHidden: 0 })
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
      this.setData({ draft: '' })
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
  }
})
