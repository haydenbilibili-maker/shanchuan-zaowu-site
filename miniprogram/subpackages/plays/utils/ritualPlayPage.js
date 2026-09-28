/**
 * 玩法页的共享行为（一个玩法一页，PRD v1.4 §11.4）——
 * 四个玩法页各自只写「自己的 WXML/WXSS（入口形态 + 进行态动画 + 结果纸面）」，
 * 行为一律由本工厂提供，避免四份复制粘贴各自漂移。
 *
 * 为什么放在**主包** `utils/`：分包只能引用主包 + 自己（`check:subpackage-refs`）。
 * 四个玩法页都在 `subpackages/feature/` 同一个分包里，从主包取工厂是合法方向。
 *
 * 一页的完整闭环（§11.1 R3）：
 *   入口/进行态(专属动画) → 结果(专属纸面) → 留档(可回看) → 下一步(写成心愿/分享/换一个)
 * 以及"今天玩过没有"的状态（本地留档按日期键现算，跨天自然重置）。
 *
 * 三条不许破的既有口径（都是从祈福墙页原样搬过来的，不是新发明）：
 *   · 确定性：结果只由 `(玩法 id, 日期, 资料值)` 决定，**无随机**（同一天同一玩法同一维度结果一致）；
 *   · 缺资料给引导、不给假结果；玩法失败**必须说出来**（不静默 return），但绝不阻断下一步；
 *   · 分享只用 `ritualPlay.share`（不含"依据"），**没有** `card` 这个输入（玩法页根本没有愿签卡）。
 */
const { findPlay, PROFILE_PAGE, WISH_WALL_PAGE } = require('../config/ritualPlays')
const ritualPlay = require('./ritualPlay')
const archive = require('./ritualPlayArchive')
const handoff = require('./wishHandoff')
const { sanitizeBlessTags, blessLabel } = require('../../../config/blessTags')
const { recoCacheKey, pickReco } = require('./blessProducts')
const { shanghaiDayKey, TEXT_MAX } = require('../../../utils/wishWall')
const { wishTextTruncate, wishTextCount } = require('../../../utils/wishTextCount')
const { trackBehavior } = require('../../../utils/trackBehavior')
const { exhibitFor } = require('../../../config/wallExhibit')

/**
 * 结果区下拉收起的手势阈值（纯函数，便于单测）。
 * 从祈福墙页原样搬来（那边随玩法弹层一起下线）：手势判定写成内联表达式就只能靠手感验证。
 */
const RESULT_CLOSE_DRAG_PX = 88
function sheetDragShouldClose(dy) {
  return (Number(dy) || 0) >= RESULT_CLOSE_DRAG_PX
}

/** 开场动画时长上限：注册表给的是"目标节奏"，这里兜住异常值（0 或超大） */
function safeSpinMs(play) {
  const n = Number(play && play.spinMs) || 0
  if (!n) return 900
  return Math.min(3000, Math.max(200, n))
}

function emptyData(play, id) {
  const variants = ritualPlay.variantOptions(id)
  return {
    /** 玩法 id 与注册表条目：页面**不写死玩法名**，全部从这里读 */
    playId: id,
    play: play || {},
    kind: String((play && play.kind) || ''),
    mark: String((play && play.mark) || ''),
    name: String((play && play.name) || ''),
    /** 闭环节点：idle（可以开始）/ pending（进行态）/ result（结果）/ need（缺资料） */
    stage: 'idle',
    result: null,
    need: null,
    /** 「换一个」（星座 12 / MBTI 16，PRD §11.2-4） */
    variant: '',
    variantLabel: '',
    variantOptions: variants,
    canVariant: variants.length > 0,
    /** 留档与"今天玩过没有" */
    playedToday: false,
    archive: [],
    archiveOpen: false,
    /** 结果区下拉收起的手势位移 */
    sheetDragY: 0,
    /** 入口带过来的上下文（推荐按这面墙的祈运标签取） */
    productId: '',
    productKey: '',
    productTitle: '',
    blessTags: [],
    blessLabelText: '',
    reco: null,
    recoLoading: false,
    recoFailed: false,
    /** 分享来源标记（本页只有玩法结果一种分享，仍显式落标记 —— 与愿签分享同形） */
    shareFrom: '',
    textMax: TEXT_MAX,
    /** 墙页弹层形态（PlayBody 组件里为真）：结果下方出「挂签条」，就地改一句挂上 */
    embedded: false,
    wishDraft: '',
    wishCount: 0,
    /** 轻提示（AppToast 组件；本页不用原生 toast —— 原生弹窗在全仓是棘轮） */
    toastShow: false,
    toastOverline: '',
    toastTitle: '',
    toastDesc: '',
    toastDuration: 2200
  }
}

/**
 * 造一个玩法页配置。
 * @param {string} playId 注册表里的玩法 id（每个玩法页的 index.js 只传这一个事实）
 */
function createRitualPlayPage(playId) {
  const id = String(playId || '')
  const play = findPlay(id)
  const spinMs = safeSpinMs(play)

  const config = {
    data: emptyData(play, id),

    onLoad(options) {
      const opts = options || {}
      this._unloaded = false
      this._profile = null
      this._spinTimer = null
      this._recoCache = null
      this._dayKey = shanghaiDayKey(Date.now())
      const tags = sanitizeBlessTags(opts.bless || '')
      this.setData({
        productId: String(opts.productId || ''),
        productKey: String(opts.productKey || ''),
        productTitle: String(opts.title ? decodeURIComponent(opts.title) : ''),
        blessTags: tags,
        blessLabelText: tags.length ? blessLabel(tags[0]) : ''
      })
      // 标题也来自注册表（页面 json 只是兜底文案）—— 页面不写死玩法名
      // 嵌入祈福墙弹层时不许改标题：导航栏属于墙页
      try { if (!this._embedded && play && play.name) wx.setNavigationBarTitle({ title: play.name }) } catch (e) { console.warn('title', e) }
      // 缺资料的玩法：先读资料 —— 读不到就停在"去补资料"这一态（不给假结果）
      if ((play.needs || []).length) {
        this.hydrateProfile()
      } else {
        this.applyStage()
      }
    },

    onShow() {
      // 从资料页回来：缓存必须作废（P1-4 的老毛病 —— 补完资料再进仍被要求去补）。
      // 只在"正停在缺资料那一态"时自动重试，避免每次回到本页都打一次会话请求。
      if (!(play.needs || []).length) return
      this._profile = null
      if (this.data.stage === 'need') this.hydrateProfile()
    },

    onUnload() {
      this._unloaded = true
      if (this._spinTimer) {
        clearTimeout(this._spinTimer)
        this._spinTimer = null
      }
    },

    /* ───────────────── 资料 / 留档 / 状态机 ───────────────── */

    /**
     * 读资料依据（星座 / MBTI）：走已有会话（`ensureSession` 带缓存，不额外发请求）。
     * 任何失败都不抛 —— 玩法页不能因为读资料失败而白屏。
     */
    async loadPlayProfile() {
      if (this._profile) return this._profile
      try {
        const { ensureSession } = require('../../../utils/userSession')
        const session = await ensureSession()
        const user = (session && session.user) || null
        if (!user) return null
        this._profile = { zodiac: user.zodiac || '', mbti: user.mbti || '' }
        return this._profile
      } catch (e) {
        return null
      }
    },

    async hydrateProfile() {
      const need = (play.needs || [])[0]
      const profile = await this.loadPlayProfile()
      if (this._unloaded) return
      const value = String((profile && profile[need]) || '')
      if (!value) {
        const r = ritualPlay.resolvePlay(id, { dayKey: this._dayKey, profile: {} })
        this.setData({ stage: 'need', need: r, result: null })
        trackBehavior('wish_wall_play', 'play', id, { step: 'need_profile' })
        return
      }
      this.setData({ variant: value, variantLabel: this.labelForVariant(value) })
      this.applyStage()
    },

    /** 进页/换维度后决定停在哪一态：今天有留档就直接给结果，否则停在入口 */
    applyStage() {
      const entry = archive.todayEntry(id, this._dayKey, this.data.variant)
      this.refreshArchive()
      if (entry) {
        this.setData({ stage: 'result', result: this.entryToResult(entry), need: null })
        this.primeWishDraft(this.data.result)
        // 回看留档也要拉弱推：否则「今天已玩过」进页只有结果、没有出墙商品叙事
        this.loadBlessReco()
        return
      }
      this.setData({ stage: this.data.need ? 'need' : 'idle', result: null })
    },

    refreshArchive() {
      // 留档行要显示"哪一天 · 哪一个维度"：星座/MBTI 存的是英文 key，这里换成标签
      // （标签来自资料页那份常量，不在这里再写一遍中文）。
      const rows = archive.listFor(id).map((e) => Object.assign({}, e, {
        label: e && e.variant ? this.labelForVariant(e.variant) : String((e && e.title) || '')
      }))
      this.setData({
        archive: rows,
        playedToday: archive.playedToday(id, this._dayKey)
      })
    },

    /** 留档条目 → 页面渲染用的结果对象（形状与 `ritualPlay.resolvePlay` 的成功结果一致） */
    entryToResult(entry) {
      const e = entry || {}
      return {
        ok: true,
        id,
        mark: e.mark || (play && play.mark) || '',
        name: e.name || (play && play.name) || '',
        kind: e.kind || (play && play.kind) || '',
        page: (play && play.page) || '',
        spinMs,
        spinText: (play && play.spinText) || '',
        note: e.note || '',
        echo: e.echo || '',
        dayKey: e.dayKey || '',
        variant: e.variant || '',
        variantLabel: e.variant ? this.labelForVariant(e.variant) : '',
        overline: e.overline || '',
        title: e.title || '',
        sub: e.sub || '',
        lines: Array.isArray(e.lines) ? e.lines : [],
        wish: e.wish || '',
        share: e.share || '',
        fromArchive: true
      }
    },

    labelForVariant(v) {
      const key = String(v || '')
      const hit = (this.data.variantOptions || []).find((o) => o.key === key)
      return hit ? hit.label : key
    },

    /* ───────────────── 一次玩法 ───────────────── */

    /**
     * 开始一次玩法：进进行态（各自页面的 CSS 动画），`spinMs` 后落结果。
     * 结果本身是确定性的 —— 同一天同一玩法（同一维度）再来一次还是这一支。
     */
    startPlay() {
      if (this.data.stage === 'pending') return
      if (this.data.stage === 'need') return
      this.setData({ stage: 'pending', result: null, sheetDragY: 0 })
      // 进玩法这件事记一笔（漏斗「抽一次玩法」）；语义与搬迁前一致：targetType='play'
      trackBehavior('wish_wall_play', 'play', id)
      if (this._spinTimer) clearTimeout(this._spinTimer)
      this._spinTimer = setTimeout(() => this.settle(), spinMs)
    },

    /** 落结果：解析 → 留档 → 摊开结果 → 取一次弱推（推荐失败不影响玩法） */
    settle() {
      this._spinTimer = null
      if (this._unloaded) return
      const result = ritualPlay.resolvePlay(id, {
        dayKey: this._dayKey,
        profile: this._profile || {},
        variant: this.data.variant
      })
      if (!result.ok) {
        if (result.reason === 'need_profile') {
          this.setData({ stage: 'need', need: result, result: null })
          trackBehavior('wish_wall_play', 'play', id, { step: 'need_profile' })
        } else {
          // 玩法失败不许阻断页面，但**必须说出来**（原来这里是静默 return：点上去毫无反应）
          this.setData({ stage: 'idle', result: null, need: null })
          this.showAppToast({
            overline: 'PLAY',
            title: (play && play.name ? play.name : '这个玩法') + '没摇出来',
            desc: '网络或内容池暂时异常，过一会儿再试。'
          })
          trackBehavior('wish_wall_play', 'play', id, { step: 'fail' })
        }
        return
      }
      archive.saveResult(id, this._dayKey, result)
      this.setData({ stage: 'result', result, need: null, sheetDragY: 0 })
      this.primeWishDraft(result)
      this.refreshArchive()
      try { wx.vibrateShort({ type: 'light' }) } catch (e) { console.warn('vibrate', e) }
      this.loadBlessReco()
    },

    /**
     * 「换一个」：同一天切换 12 星座 / 16 型（PRD §11.2-4）。
     * 只有注册表声明可换的玩法走得到这里（`canVariant`）。
     */
    switchVariant(e) {
      const key = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || '')
      if (!key || key === this.data.variant || !this.data.canVariant) return
      const entry = archive.todayEntry(id, this._dayKey, key)
      this.setData({ variant: key, variantLabel: this.labelForVariant(key) })
      if (entry) {
        // 这个维度今天已经看过：直接摊开留档，不再播一次进行态（省得"换一个"变成等待）
        this.setData({ stage: 'result', result: this.entryToResult(entry), sheetDragY: 0 })
        this.primeWishDraft(this.data.result)
        this.loadBlessReco()
        return
      }
      this.setData({ stage: 'pending', result: null, sheetDragY: 0 })
      if (this._spinTimer) clearTimeout(this._spinTimer)
      // 换一个的等待刻意更短：用户是"看看另一个"，不是"从头摇一次"
      this._spinTimer = setTimeout(() => this.settle(), Math.min(600, spinMs))
    },

    /** 结果区上拉/收起的把手（复用主包那条纯函数阈值，手势判定可被单测钉住） */
    onSheetGripStart(e) {
      const t = (e && e.touches && e.touches[0]) || null
      this._sheetStartY = t ? t.clientY : 0
    },

    onSheetGripMove(e) {
      if (!this._sheetStartY) return
      const t = (e && e.touches && e.touches[0]) || null
      if (!t) return
      this.setData({ sheetDragY: Math.max(0, t.clientY - this._sheetStartY) })
    },

    onSheetGripEnd() {
      const dy = Number(this.data.sheetDragY) || 0
      this._sheetStartY = 0
      if (sheetDragShouldClose(dy)) {
        // 收起结果 = 回到入口态（留档仍在，随时能再摊开）
        this.setData({ stage: 'idle', sheetDragY: 0 })
        return
      }
      this.setData({ sheetDragY: 0 })
    },

    /* ───────────────── 下一步：写成心愿 / 分享 / 推荐 / 补资料 ───────────────── */

    /**
     * 结果 → 写成心愿：把心愿词**带回祈福墙页**（§11.4 动线不能断）。
     *
     * 带回方式：写一份**一次性**本地交接（`utils/wishHandoff`），祈福墙 `onShow` 取走并预填。
     *   · 上一页就是祈福墙 → `navigateBack`，回来即取；
     *   · 上一页不是 / 页面栈只剩本页（直接进入、分享进入）→ `reLaunch` 回祈福墙，同样取得到；
     *   · 用户在这里杀掉小程序 → 存档留在本地，5 分钟内再进祈福墙照样带出来（超时丢弃）。
     * 交接**读到即删 + 5 分钟时效**：不会之后每次进墙都诡异地预填一句旧心愿。
     */
    writeWish() {
      const r = this.data.result
      if (!r) return
      const draft = wishTextTruncate(r.wish || '马上有', TEXT_MAX)
      handoff.stash({ draft, echo: String((play && play.echo) || r.echo || '') })
      trackBehavior('wish_wall_play', 'play', r.id || id, { step: 'to_wish' })
      // 弹层形态：人本来就在祈福墙上 —— 不跳页，交给墙页收起弹层后当场取走交接
      if (this._embedded) {
        this.triggerEvent('wish')
        return
      }
      const pages = (typeof getCurrentPages === 'function' && getCurrentPages()) || []
      const prev = pages.length > 1 ? pages[pages.length - 2] : null
      const backToWall = !!prev && String(prev.route || '').indexOf('wish-wall/index') !== -1
      if (backToWall) {
        try {
          wx.navigateBack({ delta: 1, fail: () => this.fallbackToWall() })
          return
        } catch (e) { console.warn('navigateBack', e) }
      }
      this.fallbackToWall()
    },

    /** 弹层挂签条的初值 = 本次结果的心愿词（与 writeWish 同一口径截断）；独立页不渲染挂签条，不写 */
    primeWishDraft(r) {
      if (!this._embedded) return
      const draft = wishTextTruncate((r && r.wish) || '马上有', TEXT_MAX)
      this.setData({ wishDraft: draft, wishCount: wishTextCount(draft) })
    },

    onWishDraftInput(e) {
      const draft = wishTextTruncate(String((e && e.detail && e.detail.value) || ''), TEXT_MAX)
      this.setData({ wishDraft: draft, wishCount: wishTextCount(draft) })
      return draft
    },

    /**
     * 弹层挂签条「挂上墙」：一步落愿（不经过挂签台、不聚焦键盘）。
     * 只抛 `post` 事件把这句交给墙页 —— 校验 / 注册门禁 / 额度 / 云函数都由墙页唯一的 submitWish 负责，
     * 这里不另写一套发布。墙上回声由落愿那一声统一给（不再先回一声"我摇了…"再回一声"挂上了"）。
     */
    postWish() {
      const r = this.data.result
      if (!r || !this._embedded) return
      const text = String(this.data.wishDraft || '').trim()
      if (!text) return
      trackBehavior('wish_wall_play', 'play', r.id || id, { step: 'to_wish' })
      this.triggerEvent('post', { text })
    },

    /** 降级：直接把用户送回祈福墙（交接已写好，回去照样预填）—— 带上本品/祈运，避免出墙再进墙丢上下文 */
    fallbackToWall() {
      const params = []
      if (this.data.productId) params.push(`productId=${encodeURIComponent(this.data.productId)}`)
      if (this.data.productKey) params.push(`productKey=${encodeURIComponent(this.data.productKey)}`)
      if (this.data.productTitle) params.push(`title=${encodeURIComponent(this.data.productTitle)}`)
      if ((this.data.blessTags || []).length) {
        params.push(`bless=${encodeURIComponent(this.data.blessTags.join(','))}`)
      }
      params.push('from=play_wish')
      const url = params.length ? `${WISH_WALL_PAGE}?${params.join('&')}` : WISH_WALL_PAGE
      try {
        wx.reLaunch({ url, fail: () => {} })
      } catch (e) { console.warn('reLaunch wall', e) }
    },

    /** 分享按钮的 bindtap：只落一个一次性来源标记（不弹 toast、不写云、不改 draft） */
    onShareTap() {
      const r = this.data.result
      if (!r) return
      this.setData({ shareFrom: 'play' })
      trackBehavior('wish_wall_play', 'play', r.id || id, { step: 'share' })
      // 弹层形态：转发由墙页的 onShareAppMessage 应答，只把 result.share 递过去（不含"依据"）
      if (this._embedded) this.triggerEvent('share', { id: r.id || id, title: String(r.share || '') })
    },

    /**
     * 转发：本页**只有玩法结果**一种分享（页面上没有愿签卡，所以不存在"读到别人的心愿"这条路）。
     * 文案只取 `ritualPlay` 的 `share`（不含星座/MBTI 等"依据"），不自己拼。
     */
    onShareAppMessage() {
      const fromPlay = this.data.shareFrom === 'play'
      if (this.data.shareFrom) this.setData({ shareFrom: '' })
      const path = `${WISH_WALL_PAGE}?productKey=${encodeURIComponent(this.data.productKey || '')}`
      const r = this.data.result
      if (r && r.share && fromPlay) return { title: r.share, path }
      const ex = exhibitFor(this.data.productKey)
      return { title: (r && r.share) || (ex && ex.line) || '马上有 · 祈福玩法', path }
    },

    /**
     * 出墙 → 详情：带 from= 让详情侧能区分「墙 chip / 玩法回看 / 弱推」，
     * 不改详情字段契约，只多一个查询参数。
     */
    detailUrl(productId, from) {
      const pid = String(productId || '')
      if (!pid) return ''
      const src = String(from || 'wish_wall')
      return `/subpackages/feature/detail/index?id=${encodeURIComponent(pid)}&from=${encodeURIComponent(src)}`
    },

    /** 结果页的产品入口（有推荐走推荐，否则走这面墙自己的藏品）—— 与搬迁前同口径 */
    goProduct() {
      const pid = String(this.data.productId || '')
      const url = this.detailUrl(pid, 'wish_wall')
      if (!url) return
      trackBehavior('wish_wall_play', 'play', this.data.playId || id, { step: 'to_product' })
      try {
        wx.navigateTo({ url, fail: () => {} })
      } catch (e) { console.warn('goProduct', e) }
    },

    goRecoProduct() {
      const reco = this.data.reco
      if (!reco || !reco._id) return
      trackBehavior('wish_wall_reco', 'reco', (this.data.blessTags || [])[0] || '', { step: 'tap' })
      try {
        wx.navigateTo({
          url: this.detailUrl(reco._id, 'wish_wall_reco'),
          fail: () => {}
        })
      } catch (e) { console.warn('goRecoProduct', e) }
    },

    /** 缺资料 → 去资料页（那两项自带完善奖励；不在这里拦注册，价值先行） */
    goProfileField() {
      trackBehavior('wish_wall_play', 'play', id, { step: 'go_profile' })
      // 离开去补资料前先作废缓存：回来那次一定重新读（P1-4）
      this._profile = null
      try {
        wx.navigateTo({ url: PROFILE_PAGE, fail: () => {} })
      } catch (e) { console.warn('goProfileField', e) }
    },

    /**
     * 弱推：按**这面墙的祈运标签**取一件"同好也在看的藏品"。
     * 取件中占位（弹层/结果区不长高一块）、失败也占位（`recoFailed`）、
     * 失败不影响玩法本身（`reco` 仍为 null）。
     */
    async loadBlessReco() {
      const tag = (this.data.blessTags || [])[0]
      if (!tag) {
        // 没有祈运标签 = 没有推荐依据，不打云；若有本品，结果区仍靠 productId 露出「回看墙上这件」
        if (this._unloaded) return
        this.setData({ reco: null, recoLoading: false, recoFailed: false })
        return
      }
      const cacheKey = recoCacheKey(tag, shanghaiDayKey(Date.now()))
      if (cacheKey && this._recoCache && this._recoCache.key === cacheKey) {
        const cached = this._recoCache.row
        this.setData({ reco: cached, recoLoading: false, recoFailed: !cached })
        return
      }
      this.setData({ recoLoading: true, recoFailed: false })
      try {
        const res = await wx.cloud.callFunction({
          name: 'getBlessProducts',
          data: {
            tag,
            excludeIds: this.data.productId ? [this.data.productId] : [],
            limit: 3,
            dayKey: shanghaiDayKey(Date.now())
          }
        })
        const reco = pickReco(res && res.result, tag, blessLabel(tag))
        this._recoCache = { key: cacheKey, row: reco }
        if (this._unloaded) return
        // 空列表与抛错同形：recoFailed 立住，行不消失；有 productId 时文案落到「先回看墙上这件」
        this.setData({ reco, recoLoading: false, recoFailed: !reco })
      } catch (e) {
        // 推荐失败不影响玩法：`reco` 仍为 null；`recoFailed` 立起来让那一行**留在原位**（同高）
        if (this._unloaded) return
        this.setData({ reco: null, recoLoading: false, recoFailed: true })
      }
    },

    /* ───────────────── 留档回看 / 轻提示 ───────────────── */

    toggleArchive() {
      this.setData({ archiveOpen: !this.data.archiveOpen })
    },

    showAppToast({ overline = '', title = '', desc = '', duration = 0 } = {}) {
      if (!title) return
      this.setData({
        toastOverline: overline,
        toastTitle: title,
        toastDesc: desc,
        toastDuration: duration || 2200,
        toastShow: true
      })
    },

    onToastClose() {
      this.setData({ toastShow: false })
    },

    noop() {}
  }

  return config
}

/** 页面生命周期与页面级回调：组件形态里由 lifetimes / pageLifetimes / 墙页接管 */
const PAGE_ONLY_KEYS = ['onLoad', 'onShow', 'onUnload', 'onShareAppMessage']

/**
 * 祈福墙弹层里的玩法本体（自定义组件配置）。
 *
 * 与独立页**同一份**行为：方法全部取自 `createRitualPlayPage(playId)`，只换三处宿主差异 ——
 *   · 上下文从 `ctx` 属性进来（productId / productKey / title / blessTags），不从 URL；
 *   · 「写成心愿」「分享」改成向墙页抛事件（`wish` / `share`，见上面两处 `_embedded` 分支）；
 *     另多一条挂签条「挂上墙」（`post`，detail = { text }），发布仍由墙页 submitWish 唯一实现；
 *   · 从资料页回来的重读挂在 `pageLifetimes.show`（墙页 onShow 时触发）。
 * `apply-shared`：与页面一样吃 app.wxss（骨架屏等全局类）；玩法样式全是 `rp-` 前缀，与墙页 `ww-` 不相交。
 */
function createRitualPlayBody(playId) {
  const page = createRitualPlayPage(playId)
  const methods = {}
  Object.keys(page).forEach((k) => {
    if (typeof page[k] === 'function' && PAGE_ONLY_KEYS.indexOf(k) === -1) methods[k] = page[k]
  })
  return {
    options: { styleIsolation: 'apply-shared' },
    properties: {
      ctx: { type: Object, value: {} }
    },
    data: page.data,
    lifetimes: {
      attached() {
        this._embedded = true
        this.setData({ embedded: true })
        const c = this.data.ctx || {}
        const tags = Array.isArray(c.blessTags) ? c.blessTags : []
        page.onLoad.call(this, {
          productId: String(c.productId || ''),
          productKey: String(c.productKey || ''),
          title: c.title ? encodeURIComponent(String(c.title)) : '',
          bless: tags.join(',')
        })
      },
      detached() {
        page.onUnload.call(this)
      }
    },
    pageLifetimes: {
      show() {
        page.onShow.call(this)
      }
    },
    methods
  }
}

module.exports = {
  createRitualPlayPage,
  createRitualPlayBody,
  safeSpinMs,
  sheetDragShouldClose,
  RESULT_CLOSE_DRAG_PX
}
