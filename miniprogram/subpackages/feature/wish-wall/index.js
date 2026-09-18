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
  parseWishWallScene,
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
const ritualFeedback = require('../../../utils/ritualFeedback')
const ritualPlay = require('../../../utils/ritualPlay')
const { RITUAL_PLAYS, PROFILE_PAGE } = require('../../../config/ritualPlays')
const { sanitizeBlessTags, blessPlayIds, blessLabel } = require('../../../config/blessTags')
const { recoCacheKey, pickReco } = require('../../../utils/blessProducts')
const easterEgg = require('../../../utils/easterEgg')
const easterEggHost = require('../../../utils/easterEggHost')
// 创新钩子 H2「功德证」的纯函数核（里程点判定 + 持证记录 + 本地存档），见 utils/muyuCertificate.js
const muyuCert = require('../../../utils/muyuCertificate')
const { trackBehavior } = require('../../../utils/trackBehavior')
const {
  fetchContentDisplayFlags,
  toastWishWallClosed,
  toastRitualProfileClosed
} = require('../../../utils/contentDisplayFlags')

/**
 * 纸签弹层拖拽关闭的阈值（纯函数，便于单测）：下拉超过 88px 视为"想关掉"。
 * 抽出来的理由与其他纯函数一致 —— 手势判定写成内联表达式就只能靠手感验证。
 */
const SHEET_CLOSE_DRAG_PX = 88
function sheetDragShouldClose(dy) {
  return (Number(dy) || 0) >= SHEET_CLOSE_DRAG_PX
}

/**
 * 「连续记录云保存」注册钩子的阈值 —— **只在用户真的有可丢的进展时**才谈注册。
 *
 * 定这两个数的理由（写死在这里，免得以后有人"为了能弹"悄悄调低）：
 *   · 连续点灯 ≥ 2 天：1 天只是"今天随手点了"，还没有形成任何会心疼的记录，
 *     此刻谈"记录会丢"是空话；第 2 天意味着他**昨天来过、今天又来**，这两天的灯
 *     本身就是"丢了会可惜"的第一份投入，也是"断签"这个概念成立的最小天数。
 *   · 木鱼 ≥ 21 下：木鱼是连点动作，3~5 下是随手玩，拿它谈"功德会丢"属于骚扰级；
 *     21 下是一次认真静坐能敲到的量，够得上"我攒了点东西"；再往上（如 108）
 *     门槛会高到近乎永不触发 —— 那就是假功能。
 * 两条满足一条即可（有人只点灯不敲木鱼，反之亦然）。
 */
const RITUAL_GATE_MIN_STREAK = 2
const RITUAL_GATE_MIN_MUYU = 21

/**
 * 已产生的「可丢进展」类型（纯函数）：'' = 还没有值得谈的进展。
 * 单独抽出来是为了让页面能做**零成本预筛**：木鱼可连点，门槛不满足时不该去问一次会话。
 * 不变量：本函数判"没有进展"时，shouldOfferRitualGate 必须也为 false（预筛不得比正式判定更宽）。
 */
function ritualGateProgress(state) {
  const s = state || {}
  if ((Number(s.streak) || 0) >= RITUAL_GATE_MIN_STREAK) return 'streak'
  if ((Number(s.muyuCount) || 0) >= RITUAL_GATE_MIN_MUYU) return 'muyu'
  return ''
}

/**
 * 是否该弹「连续记录云保存」注册钩子（纯函数，便于单测）。
 * 每一条都是"否则就是骚扰 / 就是骗人"的否定条件：
 *   allowed=false       —— 墙没开放，别去谈墙里的记录；
 *   flagOn=false        —— `showRitualProfile` 缺省关（超管没显式打开 = 这能力还没上线）；
 *   alreadyOffered=true —— 一次访问只谈一次（否则同一次访问每敲一下木鱼都弹）；
 *   registerDialogOpen  —— 落愿门禁正开着：同一时刻只允许一个注册弹窗，落愿优先（那是主转化）；
 *   isGuest=false       —— 已注册用户没有"注册后"这回事；
 *   没有进展            —— 见 RITUAL_GATE_MIN_*。
 */
function shouldOfferRitualGate(state) {
  const s = state || {}
  if (s.allowed !== true) return false
  if (s.flagOn !== true) return false
  if (s.alreadyOffered === true) return false
  if (s.registerDialogOpen === true) return false
  // 「功德证」的领证门禁正开着：同一时刻只允许一个注册弹窗（H2 方案点名的骚扰风险要求互斥）
  if (s.certDialogOpen === true) return false
  if (s.isGuest !== true) return false
  return ritualGateProgress(s) !== ''
}

/** 钩子弹窗的 desc（纯函数）：说清"存什么 + 换手机还在 + 断签提醒"三件事，且报出真实进度 */
function buildRitualGateDesc(reason, state) {
  const s = state || {}
  if (reason === 'streak') {
    return `已连续点灯 ${Number(s.streak) || 0} 天。注册后这份记录存到云端，换手机、清缓存都还在，断签前还会提醒你。`
  }
  return `已敲了 ${Number(s.muyuCount) || 0} 下木鱼。注册后功德与连灯记录存到云端，换手机、清缓存都还在，断签前还会提醒你。`
}

/**
 * 「功德证」次级入口的判定（**纯函数**，便于单测）。
 *
 * 为什么是"入口"而不是"弹窗"：领证是**次级**动作（方案 §H2 明确"弹出次级入口"），
 * 主仪式（敲木鱼）一步都不该被打断；而且连点场景下弹窗级骚扰是方案点名的风险。
 *
 * 返回 `null`（不显示）或 `{ mode, milestone }`：
 *   · flagOn=false       —— `showMuyuCertificate` 缺省关（超管没显式打开 = 这能力还没上线）；
 *   · allowed=false      —— 墙没开放时整页都不成立，别谈墙里的证；
 *   · mode='claim'       —— 到达了某个**未领取**的里程点：请他领证；
 *   · mode='view'        —— 档位都领过了：给一个**回看**入口（"可保管、可回看"的兑现）。
 * 阈值一个都不在页面里写死，全部来自 `utils/muyuCertificate.CERT_MILESTONES`（口径待产品确认）。
 */
function certEntryState(state) {
  const s = state || {}
  if (s.flagOn !== true) return null
  if (s.allowed !== true) return null
  const claimed = s.claimed || {}
  const unclaimed = muyuCert.nextUnclaimed(s.muyuCount, claimed)
  if (unclaimed) return { mode: 'claim', milestone: unclaimed }
  const top = muyuCert.highestClaimed(claimed)
  if (top) return { mode: 'view', milestone: top }
  return null
}

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
    /** 入口来源（门店码 → store_qr；线上入口 → 组件传入的 from） */
    entryFrom: 'direct',
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
    heartBurst: false,
    muyuCount: 0,     // 安心木鱼：本地功德计数（不上云，纯陪伴）
    muyuBeat: false,
    muyuPlus: false,
    /**
     * 即时反馈（需求 28 · 玩法动作 → 弹幕墙回声）：
     * `echoRows` 是 0/1 条的数组而不是对象 —— 靠 `wx:key` 换 key 让 DOM 重建，
     * 动画才会在连点时**重播**（同 key 不会重播，这是本页弹幕轮播同一套手法）。
     */
    echoRows: [],
    /** 仪式音效开关（默认开，见 utils/ritualFeedback.isSoundEnabled） */
    soundOn: true,
    /**
     * 玩法（今日一签 / 拆签饼 / 星座签 / MBTI 贴士）：瓦片**由注册表派生**，
     * 页面不写死任何玩法名（加玩法只改 config/ritualPlays.js + 内容池）。
     */
    plays: RITUAL_PLAYS,
    /** 这面墙的祈运标签（由入口从商品带过来；没有就不排不提示，页面照常） */
    blessTags: [],
    /** 祈运标签的中文名（页头那颗 chip 用；空串则不显示） */
    blessLabelText: '',
    /** 抽到的结果（就地展开的卡片；null = 未抽/已收起） */
    playResult: null,
    /** 需要补资料时的引导状态（不给假结果） */
    playNeed: null,
    /** 纸签弹层的拖拽位移（rpx 由 WXSS 换算；这里存 px） */
    sheetDragY: 0,
    /**
     * 弱推：同好也在看的藏品（云函数 getBlessProducts 按祈运标签取）。
     * 推荐是锦上添花 —— 取不到就为 null，卡片照常显示（绝不影响玩法本身）。
     */
    reco: null,
    /** 注册转化：落愿时未注册 → 就地弹注册（见 submitWish / onRegisterSuccess） */
    showRegisterDialog: false,
    /**
     * 「连续记录云保存」注册钩子（2026-09-20）：
     * `showRitualProfile` 是开关（`content_display_flags.showRitualProfile`，缺配置默认关），
     * `showRitualDialog` 是弹窗态，`ritualGateDesc` 是带真实进度的文案。
     * 本钩子只**新增**：不改点灯/木鱼/落愿/弹幕任何既有语义。
     */
    showRitualProfile: false,
    showRitualDialog: false,
    ritualGateDesc: '',
    /**
     * 创新钩子 H2「功德证」（2026-09-20）：
     * `showMuyuCertificate` 是开关（`content_display_flags.showMuyuCertificate`，**缺字段默认关**），
     * `certEntry` 是木鱼动作区下方的**次级入口**（null = 不显示），`showCertDialog` 是领证注册门禁，
     * `certCard` 是那张证（可保管、可回看）。阈值与文案全部来自 `utils/muyuCertificate`。
     */
    showMuyuCertificate: false,
    showCertDialog: false,
    certGateDesc: '',
    certEntry: null,
    certCard: null,
    /** 证书下的一句合规说明（单一来源在 utils/muyuCertificate.CERT_NOTE） */
    certNote: muyuCert.CERT_NOTE,
    /**
     * 统一轻提示（AppToast）。本页是**原生 toast 棘轮**（`check:dialog-ratchet`）盯着的文件：
     * 新增一处 `wx.showToast` 会把守卫弄红，故钩子的结果反馈走 AppToast 铭牌轻提示。
     */
    toastShow: false,
    toastOverline: '',
    toastTitle: '',
    toastDesc: '',
    toastDuration: 2200
  },

  onLoad(options) {
    const opts = options || {}
    // 门店/物料**小程序码**走 scene（wxacode.getUnlimited）：内容是 `from=store_qr&k=mashangyou`。
    // 只在显式参数缺失时采用 scene（与 identify / onboarding 两页同口径），
    // 这样普通 URL 入口（带 productKey/from）不会被 scene 抢走。
    const fromScene = parseWishWallScene(opts.scene)
    this.setData({
      productId: String(opts.productId || ''),
      // 作用域来自入口组件或门店码；非法/缺失一律回落到默认墙，避免拼出一个读不到内容的 key
      productKey: normalizeProductKey(opts.productKey || fromScene.productKey),
      productTitle: String(opts.title ? decodeURIComponent(opts.title) : '马上有'),
      /** 入口来源：门店码会带 store_qr，用于埋点区分"现场扫码"与线上入口 */
      entryFrom: String(opts.from || fromScene.from || 'direct')
    })
    this.applyBlessScope(opts.bless)
    trackBehavior('wish_wall_enter', 'from', this.data.entryFrom)
    // 仪式音效：一个动作一个 InnerAudioContext 实例（连点不叠音，见 utils/ritualFeedback）
    this._soundPlayer = ritualFeedback.createPlayer()
    this._echoSeq = 0
    // 开关是持久化的（默认开）：进页要按存档回显，否则用户关过又"自己开了"
    this.setData({ soundOn: ritualFeedback.isSoundEnabled(), muyuCount: wishRitual.readMuyuCount() })
    // 「功德证」持证记录：进页就本地读回来（"可保管" = 关掉小程序再打开还看得到）。
    // `_certBacked` = 已领过证 = 已注册的持证人；未领证的用户**一次都不写云端**（见 reportCertProgress）。
    // `_certSyncedCount = null`：换设备/清缓存后不能假设云端与本地一致，本次离开页面时对齐一次。
    this._certRecord = muyuCert.readRecord()
    this._certBacked = muyuCert.highestClaimed(this._certRecord.claimed) !== null
    this._certSyncedCount = null
    this._certShownKey = ''
    this.refreshCertEntry()
    this.initRitual()
    this.bootstrap()
  },

  onPullDownRefresh() {
    // 下拉 = **强制**重读开关 + 重拉列表。开关走 SWR 缓存（TTL 10 分钟 / 陈旧窗口 24 小时），
    // 下拉是用户自己能把门禁刷新过来的动作 —— 否则只能等缓存过期或清缓存。
    this.bootstrap({ force: true }).finally(() => wx.stopPullDownRefresh())
  },

  /**
   * 祈运作用域：入口把商品的祈运标签带在 URL 上（见 utils/wishWall.buildWishWallUrl）。
   *
   * 只做两件事：**重排**玩法瓦片 + 显示一句提示。
   * 刻意**不隐藏**任何玩法：标签只决定"先看到哪个" —— 隐藏玩法等于替用户做决定，也更难解释；
   * 参数缺失/非法一律当"没有标签"（页面照常可用，绝不因为一个查询参数就报错）。
   */
  applyBlessScope(raw) {
    const tags = sanitizeBlessTags(raw || '')
    if (!tags.length) {
      this.setData({ blessTags: [], blessLabelText: '', plays: RITUAL_PLAYS })
      return
    }
    const order = blessPlayIds(tags)
    const rank = (id) => {
      const i = order.indexOf(id)
      return i === -1 ? order.length : i
    }
    // 稳定排序：没被点名的玩法保持注册表原顺序（同分不重排，结果可预期）
    const plays = RITUAL_PLAYS
      .map((p, i) => ({ p, i }))
      .sort((a, b) => (rank(a.p.id) - rank(b.p.id)) || (a.i - b.i))
      .map((x) => x.p)
    // 页头只放**标签名**（「偏「求成」」）—— 完整那句解释太长，塞进页头会挤成三行
    this.setData({ blessTags: tags, blessLabelText: blessLabel(tags[0]), plays })
  },

  /** 结果卡上的「看这件藏品」：这面墙就是某个商品的墙，转化链路最短的一条 */
  goProduct() {
    const id = String(this.data.productId || '')
    if (!id) return
    trackBehavior('wish_wall_play', 'to_product', this.data.productKey || '')
    wx.navigateTo({ url: `/subpackages/feature/detail/index?id=${encodeURIComponent(id)}`, fail: () => {} })
  },

  /* ----------------------------- 玩法（今日一签 / 签饼 / 星座 / MBTI） ----------------------------- */

  /**
   * 抽一次玩法。页面只做三件事：取资料 → 交给纯函数 → 摊开结果。
   *
   * 不做的三件事（都是刻意的）：
   *   - 不写云、不进集合：玩法结果**不是 UGC**，不进弹幕墙数据；墙上只回一条第一人称回声；
   *   - 不弹窗：结果就地展开（`playResult`），用户能一边看一边点「写成心愿」；
   *   - 不给假结果：需要星座/MBTI 而资料里没有 → 引导去补（那两项各有 7/8 分完善奖励）。
   */
  async onPlayTap(e) {
    const id = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    const play = (RITUAL_PLAYS || []).find((p) => p.id === id)
    if (!play) return
    if (this.data.playResult && this.data.playResult.id === id) {
      // 再点同一张 = 收起（同一份结果不重复播回声，免得墙上刷屏）
      this.setData({ playResult: null })
      return
    }
    let profile = null
    if ((play.needs || []).length) {
      profile = await this.loadPlayProfile()
    }
    const result = ritualPlay.resolvePlay(id, {
      dayKey: shanghaiDayKey(Date.now()),
      profile: profile || {}
    })
    if (!result.ok) {
      if (result.reason === 'need_profile') {
        this.setData({ playResult: null, playNeed: result })
        trackBehavior('wish_wall_play', 'need_profile', id)
      }
      return
    }
    this.setData({ playResult: result, playNeed: null, sheetDragY: 0 })
    try { wx.vibrateShort({ type: 'light' }) } catch (e) { /* ignore */ }
    // 墙上回声用注册表里那句第一人称文案（结果里的依据不上墙）
    this.pushEcho('play', { text: result.echo })
    trackBehavior('wish_wall_play', 'ok', result.id)
    // 弱推：这条签对应的祈运标签 → 同好也在看的藏品（异步，失败就不显示）
    this.loadBlessReco()
  },

  /**
   * 读玩法的资料依据（星座 / MBTI）：走已有会话（`ensureSession` 带缓存，不额外发请求），
   * 读不到就返回 null → 走"引导补资料"分支。任何失败都不抛（玩法不能把页面弄崩）。
   */
  async loadPlayProfile() {
    if (this._playProfile) return this._playProfile
    try {
      const { ensureSession } = require('../../../utils/userSession')
      const session = await ensureSession()
      const user = (session && session.user) || null
      if (!user) return null
      this._playProfile = { zodiac: user.zodiac || '', mbti: user.mbti || '' }
      return this._playProfile
    } catch (e) {
      return null
    }
  },

  /**
   * 结果卡 → 写成心愿：预填心愿词（没有可用的就只给「马上有」开头），并滚到写愿签那里。
   *
   * ⚠️ **必须收掉纸签弹层**（2026-09-19 修）：`.ww-sheet` 与 `.ww-composer` 都是
   * `position: fixed; bottom: 0`，而弹层 `z-index: 41` **高于**发送条 `z-index: 30` ——
   * 点「写下我的心愿」若只填草稿、不收弹层，弹层会**一直盖住发送条**，用户看到的现象是
   * 「页面滚下去了，但看不到输入框」。而且本页发送条是吸底的、本来就常驻可见，
   * **不是靠滚动才能看到** —— 此前想用 `pageScrollTo` 修这件事属于改错了地方
   * （`pageScrollTo` 对 `position: fixed` 元素本来就无效，它不在文档流里）。
   * 判据：`test:wish-wall` 钉住「调用后 `playResult === null`（弹层已收）」。
   */
  usePlayWish() {
    const r = this.data.playResult
    if (!r) return
    this.setData({ draft: r.wish || '马上有' })
    trackBehavior('wish_wall_play', 'to_wish', r.id)
    // 先收弹层，露出吸底发送条；再滚一下（保留既有行为，对非 fixed 落点仍有效）
    this.closePlayResult()
    try {
      wx.pageScrollTo({ selector: '#wishInput', duration: 260, fail: () => {} })
    } catch (e) { /* 低版本基础库不支持 selector，忽略 */ }
  },

  closePlayResult() {
    this.setData({ playResult: null, sheetDragY: 0 })
  },

  /**
   * 纸签弹层的拖拽关闭：只挂在顶部"把手"上（整层可拖会让内部的滚动/点击变难用）。
   * 阈值抽成纯函数：`sheetDragShouldClose(dy)` —— 手势的判定必须能被单测钉住，不能只靠手感。
   */
  onSheetGripStart(e) {
    const t = (e && e.touches && e.touches[0]) || null
    this._sheetStartY = t ? t.clientY : 0
  },

  onSheetGripMove(e) {
    if (!this._sheetStartY) return
    const t = (e && e.touches && e.touches[0]) || null
    if (!t) return
    const dy = Math.max(0, t.clientY - this._sheetStartY)
    this.setData({ sheetDragY: dy })
  },

  onSheetGripEnd() {
    const dy = Number(this.data.sheetDragY) || 0
    this._sheetStartY = 0
    if (sheetDragShouldClose(dy)) {
      this.closePlayResult()
      return
    }
    this.setData({ sheetDragY: 0 })
  },

  /**
   * 弱推：按**这面墙的祈运标签**取一件"同好也在看的藏品"。
   *
   * 三条刻意的约束：
   *   1. 用**墙的标签**而不是"用户是谁"：用户资料不该为一条推荐被读取，推荐也不该依赖隐私字段；
   *   2. 排除**当前这面墙的商品**（不给自己推荐自己）；
   *   3. 按「标签 + 当日」缓存一次：同一天反复抽签不会反复打云函数（推荐本来就是一天一件）。
   * 任何失败都只是"没有推荐"（`reco = null`），不弹错、不阻断玩法。
   */
  async loadBlessReco() {
    const tag = (this.data.blessTags || [])[0]
    if (!tag) return
    const cacheKey = recoCacheKey(tag, shanghaiDayKey(Date.now()))
    if (cacheKey && this._recoCache && this._recoCache.key === cacheKey) {
      this.setData({ reco: this._recoCache.row })
      return
    }
    try {
      const res = await wx.cloud.callFunction({
        name: 'getBlessProducts',
        data: { tag, excludeIds: this.data.productId ? [this.data.productId] : [], limit: 3 }
      })
      const reco = pickReco(res && res.result, tag, blessLabel(tag))
      this._recoCache = { key: cacheKey, row: reco }
      this.setData({ reco })
    } catch (e) {
      // 推荐失败不影响玩法：保持 reco=null（卡片少一行而已）
      this.setData({ reco: null })
    }
  },

  goRecoProduct() {
    const r = this.data.reco
    if (!r || !r._id) return
    trackBehavior('wish_wall_reco', 'tap', r.tag || '')
    wx.navigateTo({ url: `/subpackages/feature/detail/index?id=${encodeURIComponent(r._id)}`, fail: () => {} })
  },

  /** 需要补资料 → 去资料页（那两项自带完善奖励；不在这里拦注册，价值先行） */
  goProfileField() {
    trackBehavior('wish_wall_play', 'go_profile', (this.data.playNeed && this.data.playNeed.field) || '')
    try {
      wx.navigateTo({ url: PROFILE_PAGE, fail: () => {} })
    } catch (e) { /* ignore */ }
  },

  /* ----------------------------- 即时反馈（动作 → 弹幕墙回声） ----------------------------- */

  /**
   * 玩法动作的即时反馈总口子：音效 + 墙上回声（震动仍由各动作自己调）。
   *
   * 为什么做成一个口子而不是每处各写一遍：需求 28 后续要加卜卦 / Fortune Cookie /
   * 星座 / MBTI 等玩法，**每个玩法的"我做了这件事"都要在墙上被看见** ——
   * 新玩法只需 `this.pushEcho('play', { text? })`，墙上回声、音效表、计时器都复用这里。
   *
   * 三条不变量：
   *   1) 只走本地：不进愿签集合、不写云（木鱼可连点，写服务端就是写放大）；
   *   2) 回声文案第一人称：墙上其余弹幕是别人的心愿，回声不能冒充别人的愿；
   *   3) 静默降级：音效失败/素材缺失只是"没响"，回声照样出现（视觉反馈不依赖音频）。
   *
   * @param {string} action muyu / lamp / wish / play（后续玩法）
   * @param {{text?:string, sub?:string}} [extra] 覆盖文案（玩法自带的签语等）
   */
  pushEcho(action, extra) {
    const x = extra || {}
    // seq 从 0 起算（第一次动作说文案池第一句），先取后加 —— 顺序反了会让首句永远轮不到
    const seq = Number(this._echoSeq) || 0
    this._echoSeq = seq + 1
    const res = ritualFeedback.emitFeedback(action, {
      seq,
      player: this._soundPlayer,
      soundEnabled: this.data.soundOn !== false,
      muyuCount: this.data.muyuCount,
      streak: (this.data.lamp && this.data.lamp.streak) || 0,
      quotaLeft: (this.data.quota && this.data.quota.left) || 0
    })
    const echo = res && res.echo
    if (!echo) return null
    if (x.text) echo.text = String(x.text)
    if (x.sub !== undefined) echo.sub = String(x.sub || '')
    this.setData({ echoRows: [echo] })
    clearTimeout(this._echoTimer)
    this._echoTimer = setTimeout(() => this.setData({ echoRows: [] }), ritualFeedback.ECHO_HOLD_MS)
    return echo
  },

  clearEcho() {
    if (this._echoTimer) {
      clearTimeout(this._echoTimer)
      this._echoTimer = null
    }
  },

  /** 仪式音效开关：关掉时也给一次震动与回声（手感不依赖声音），开的时候敲一声让你听见 */
  onToggleSound() {
    const next = ritualFeedback.toggleSound()
    this.setData({ soundOn: next })
    if (next) {
      // 开启时立刻响一声：音效开关最怕"开了没感觉"
      try { if (this._soundPlayer) this._soundPlayer.play('muyu') } catch (e) { /* ignore */ }
    }
    try { wx.vibrateShort({ type: 'light' }) } catch (e) { /* ignore */ }
    // 刻意**不弹 toast**：胶囊自己的开/关两态 + 开启时那一声就是反馈，
    // 再弹一个是噪音；而且本页的原生调用数被 `check:dialog-ratchet` 棘轮钉着，
    // 新增原生弹窗要走 AppToast/AppModal —— 这里根本不需要。
    trackBehavior('wish_wall_sound', 'on', next ? '1' : '0')
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

  /** 安心木鱼：敲一下 +1（本地存档，不联网、不上榜 —— 只是给自己一个静下来的动作） */
  onMuyuTap() {
    const next = (this.data.muyuCount || 0) + 1
    this.setData({ muyuCount: next, muyuBeat: true, muyuPlus: true })
    // 存档走 utils/wishRitual（键名与读取都在那里，避免"只写不读"再次发生）
    wishRitual.writeMuyuCount(next)
    try { wx.vibrateShort({ type: 'light' }) } catch (e) { /* 部分机型不支持 */ }
    // 即时反馈：音效 + 墙上回声（「我敲了一下木鱼 · 功德 N」）
    this.pushEcho('muyu')
    clearTimeout(this._muyuTimer)
    this._muyuTimer = setTimeout(() => this.setData({ muyuBeat: false, muyuPlus: false }), 420)
    // 「连续记录云保存」钩子：功德刚被创造出来的这一刻才谈（门槛与判定见 ritualGateProgress）
    this.maybeOfferRitualGate()
    // 「功德证」次级入口：只做**纯函数判定 + setData**，一次云端写都没有
    // （写放大防护的源码判据：本方法体内不出现任何云调用/上报，见 test-wish-wall §15）
    this.refreshCertEntry()
  },

  onLampTap() {
    const lamp = this.data.lamp || {}
    if (lamp.lit) {
      // 已点：再点一次＝「再看一眼灯」——爱心动效 + 墙上回声。
      // 这里原来是 `wx.showToast(lamp.line)`：灯语此刻**就写在卡片上**，
      // 弹一个框把同一句话再念一遍是多余的一层（还让原生弹窗棘轮多一处，见 check:dialog-ratchet）。
      this.setData({ heartBurst: true })
      clearTimeout(this._heartTimer)
      this._heartTimer = setTimeout(() => this.setData({ heartBurst: false }), 2600)
      try { wx.vibrateShort({ type: 'light' }) } catch (e) { /* ignore */ }
      this.pushEcho('lampAgain')
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
    // 即时反馈：点灯也要在墙上回一声（与木鱼同一个口子）
    this.pushEcho('lamp')
    trackBehavior('wish_wall_lamp', 'day', dayKey)
    // 连续点灯彩蛋：门槛（几天算数）在注册表里，页面只报事实
    this.fireLampStreakEgg(next.streak)
    // 「连续记录云保存」钩子：只在**今天这一盏刚点亮**时谈（连灯天数就是在这一刻变长的；
    // 点已经亮着的灯只是想再看一眼，不该被拦一个注册弹窗）
    this.maybeOfferRitualGate()
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
    // 「连续记录云保存」钩子的开关：单独同步，**不动**原来的门禁控制流
    // （合并进下面的 early-return 会让"只改了这一个开关"也走一遍 refresh + 进页彩蛋）。
    // 读不到 / 缺字段一律当关（normalizeContentDisplayFlags 已保证，这里是第二道）。
    const showRitualProfile = !!(flags && flags.showRitualProfile === true)
    if (showRitualProfile !== this.data.showRitualProfile) this.setData({ showRitualProfile })
    // 「功德证」钩子的开关：同样单独同步（与 showRitualProfile 同一先例，缺字段一律当关）。
    // 关掉/打开都要重算入口：开关的意义就是"一键关掉"（关掉时 refreshCertEntry 会把证也收起）。
    const showMuyuCertificate = !!(flags && flags.showMuyuCertificate === true)
    if (showMuyuCertificate !== this.data.showMuyuCertificate) {
      this.setData({ showMuyuCertificate })
      this.refreshCertEntry()
    }
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

  /**
   * 墙页脚 → 愿签列表。
   *
   * 为什么值得加一步跳转：弹幕墙是"看一眼就有感觉"的面，愿签列表是"细看/复制"的面；
   * 两者之间原本只有"手动往下滚一屏"。落在 `#wishList`（分段控件那一行）而不是列表底部，
   * 这样切换「墙上的愿签 / 我的心愿」的入口也在视野里。
   * 失败不兜底弹窗（不支持 selector 的基础库就直接不动）—— 滚动是锦上添花。
   */
  goWishList() {
    try {
      wx.pageScrollTo({ selector: '#wishList', duration: 260, fail: () => {} })
    } catch (e) {
      /* 低版本基础库不支持 selector，忽略 */
    }
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
    // 「功德证」：离开页面才把功德推一次（写放大防护见 reportCertProgress —— 绝不逐次写）
    void this.reportCertProgress()
  },

  onUnload() {
    this.clearDanmakuCycle()
    this.clearFreshTimer()
    // 音效实例与回声计时器都要收：页面卸载后还在响/还在 setData = 内存与噪声双泄漏
    this.clearEcho()
    if (this._muyuTimer) clearTimeout(this._muyuTimer)
    if (this._heartTimer) clearTimeout(this._heartTimer)
    try { if (this._soundPlayer) this._soundPlayer.destroy() } catch (e) { /* ignore */ }
    this._soundPlayer = null
    // 退出也要对一次账（在途闸保证与 onHide 连击时只写一次）
    void this.reportCertProgress()
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
    // 注册转化钩子（2026-09-18 产品口径：祈福墙是**注册转化路径**，对齐 AI 识别）：
    // 浏览与仪式免费（价值先行），**落愿这一步才要身份** —— 心愿挂在谁名下、以后回看谁的心愿，
    // 都需要账号。未注册时就地弹注册（不让用户跳走），注册成功后**自动续发这条心愿**。
    // `_resumeAfterRegister`：刚注册完的这次续发**跳过门禁**（否则会话还没刷新 → 又弹一次，死循环）。
    const resumingAfterRegister = !!this._resumeAfterRegister
    this._resumeAfterRegister = false
    if (!resumingAfterRegister && await this.isGuestUser()) {
      this._pendingWish = checked.text
      trackBehavior('wish_wall_register_gate', 'wish_wall', this.data.productKey, { step: 'show' })
      this.setData({ showRegisterDialog: true })
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
      // 即时反馈：落愿是主转化动作，墙上也要回一声（附"今日还可写 N 条"，顺带说清额度）
      this.pushEcho('wish')
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

  /* ----------------------------- 注册转化（落愿这一步要身份） ----------------------------- */

  /**
   * 是否未注册。
   *
   * ⚠️ **判断失败一律按"已注册"处理（fail-open）**：注册引导是**转化动作**，
   * 不能因为会话读不到就把「挂上墙」这个核心动作挡下来 —— 宁少一次曝光，不废一个功能。
   */
  async isGuestUser() {
    try {
      const { ensureSession } = require('../../../utils/userSession')
      const { resolveAuthState } = require('../../../utils/profileHelper')
      const session = await ensureSession()
      const state = (session && session.authState) || resolveAuthState(session && session.user)
      return state === 'guest'
    } catch (e) {
      console.warn('wish wall session check failed', e)
      return false
    }
  },

  /** 原地注册成功：刷新会话态，并把刚才那条心愿**自动续发**（用户的意图不该丢） */
  async onRegisterSuccess() {
    this.setData({ showRegisterDialog: false })
    trackBehavior('wish_wall_register_gate', 'wish_wall', this.data.productKey, { step: 'resume_success' })
    // 会话刷新**不阻塞续发**：注册已经成功，不该因为一次刷新往返把心愿吞掉。
    // 续发走 `_resumeAfterRegister` 跳过门禁，所以这里不需要等会话刷新完成。
    try {
      const { refreshSessionAfterAuth } = require('../../../utils/userSession')
      Promise.resolve(refreshSessionAfterAuth()).catch(() => {})
    } catch (e) {
      console.warn('wish wall refresh session failed', e)
    }
    const text = this._pendingWish
    this._pendingWish = ''
    if (!text) return
    this._resumeAfterRegister = true
    this.setData({ draft: text })
    this.submitWish()
  },

  /** 关掉弹窗：只丢"待发"，**草稿保留**（回来还是那句话，不制造白写的挫败） */
  /**
   * 弹窗里的「去注册」被点（还没拿到手机号）：这一步单独立一个漏斗环节。
   * 没有它就无法区分"曝光多但没人点"（文案/位置问题）与"点了但授权失败"（流程问题）。
   */
  onRegisterDialogCta() {
    trackBehavior('wish_wall_register_gate', 'wish_wall', this.data.productKey, { step: 'go_register' })
  },

  onRegisterDialogClose() {
    this._pendingWish = ''
    if (this.data.showRegisterDialog) this.setData({ showRegisterDialog: false })
    trackBehavior('wish_wall_register_gate', 'wish_wall', this.data.productKey, { step: 'dismiss' })
  },

  /** 授权失败/被拒：同样只收口，不打断 */
  onRegisterDialogFail(e) {
    const reason = (e && e.detail && e.detail.reason) || 'unknown'
    trackBehavior('wish_wall_register_gate', 'wish_wall', this.data.productKey, { step: `fail_${reason}` })
  },

  /* ----------------------------- 连续记录云保存（注册钩子，2026-09-20） ----------------------------- */
  /**
   * 纯函数转接：判定逻辑都写在模块作用域（`shouldOfferRitualGate` / `ritualGateProgress` /
   * `buildRitualGateDesc`），这里只是让页面与测试都能直接调到同一份实现 ——
   * 判定做成纯函数的意义就在于「能被断言」，藏在闭包里就白抽了。
   */
  shouldOfferRitualGate,
  ritualGateProgress,
  buildRitualGateDesc,
  /**
   * 产品逻辑：连灯天数与木鱼功德都只存本地，换手机/清缓存即丢。
   * 钩子话术 = 「注册后连续记录存云端，不会丢，且断签前会提醒你」。
   *
   * 为什么是**动作触发**而不是进页就弹：进页弹窗是拦截；动作之后弹才是
   * 「我刚做完这件事，现在告诉你怎么把它留住」。而且本页的连续天数只在"今天点了灯"
   * 时才有意义（`lamp.streak` 未点灯恒为 0），动作点正是它刚被创造出来的那一刻。
   *
   * 三条边界（与既有纪律一致）：
   *   1) 只在真有可丢进展时谈（`ritualGateProgress` 的阈值）；
   *   2) 一次访问最多谈一次（`_ritualGateOffered`），不跟着木鱼连点反复弹；
   *   3) 钩子失败/开关关闭/用户拒绝，都**不得影响**点灯 / 木鱼 / 落愿（下面全部 catch）。
   */
  maybeOfferRitualGate() {
    // 不 await、不返回给调用方（onLampTap / onMuyuTap 的主流程一步都不该被钩子拖住）；
    // 但**返回这个 promise**，测试才能 await 它来断言"到底弹没弹"。
    return Promise.resolve()
      .then(() => this.evaluateRitualGate())
      .catch((e) => {
        console.warn('wish wall ritual gate failed', e)
      })
  },

  /**
   * 埋点收口（纯转发）：`wish_ritual_gate` 这个 action 只在这里出现一次 ——
   * 既避免五处各写一遍 action 名（改名漏一处就多一条恒 0 的漏斗），
   * 也让测试可以替换它来断言"哪一步真的上报了"。
   */
  trackRitualGate(step, extra) {
    trackBehavior('wish_ritual_gate', 'wish_wall', this.data.productKey, Object.assign({ step }, extra || {}))
  },

  async evaluateRitualGate() {
    const state = {
      allowed: this.data.allowed === true,
      flagOn: this.data.showRitualProfile === true,
      alreadyOffered: this._ritualGateOffered === true,
      registerDialogOpen: this.data.showRegisterDialog === true,
      // 「功德证」领证门禁也算"已有一个注册弹窗"：同页两个门禁不许叠（见 shouldOfferRitualGate）
      certDialogOpen: this.data.showCertDialog === true,
      // 会话要异步问；先按"未知"（非 true）走预筛
      isGuest: false,
      streak: (this.data.lamp && this.data.lamp.streak) || 0,
      muyuCount: this.data.muyuCount || 0
    }
    // 零成本预筛：门槛不满足就不必为一次点击去问会话（木鱼可连点，别每下都走一次 ensureSession）
    const reason = ritualGateProgress(state)
    if (!reason) return
    state.isGuest = await this.isGuestUser()
    if (!shouldOfferRitualGate(state)) return
    // 先占位再弹：`isGuestUser` 是异步的，占位放在后面会让连续两下木鱼各弹一次
    this._ritualGateOffered = true
    this.trackRitualGate('show', { reason })
    this.setData({ showRitualDialog: true, ritualGateDesc: buildRitualGateDesc(reason, state) })
  },

  /**
   * 统一主视觉轻提示（AppToast）—— 取代原生 toast，见 components/AppToast。
   * 与 pages/cart/index.js 的 showAppToast 同形（原生 toast 在博物黑界面里最不像本产品），
   * 且本页被 `check:dialog-ratchet` 冻结了原生调用数（只许降不许涨）。
   */
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

  /**
   * 把本地仪式记录同步上云（注册成功后的**真正兑现**那一步）。
   *
   * ⚠️ `require` 必须**在函数内 + try/catch**：`utils/ritualProfile.js` 与 `wishRitualProfile`
   * 云函数由并行流程落地，本页可能先于它们上线。模块缺失 / 云函数未部署 / 网络失败
   * 一律**只返回 false**（调用方据此说真话），绝不让祈夆墙不可用 ——
   * 这页有「降级不得影响主功能」的既有纪律。
   * 接口契约（不在此实现）：`syncToCloud(): Promise<boolean>`，成功 true、失败 false。
   */
  async syncRitualToCloud() {
    try {
      const ritualProfile = require('../../../utils/ritualProfile')
      if (!ritualProfile || typeof ritualProfile.syncToCloud !== 'function') return false
      const ok = await ritualProfile.syncToCloud()
      return ok === true
    } catch (e) {
      console.warn('wish wall ritual sync failed', e)
      return false
    }
  },

  /**
   * 注册成功。**必须真的同步**：只弹个"成功"却什么都没存，这个钩子就是空承诺
   * （所以漏斗的终点 `resume_success` 只在同步成功后上报，失败走 `fail_sync`）。
   * 同步结果如实告诉用户：成功「已存到云端」，失败「记录仍在本机」——不假装。
   */
  async onRitualRegisterSuccess() {
    this.setData({ showRitualDialog: false })
    // 会话刷新不阻塞同步（与落愿门禁同一口径）
    try {
      const { refreshSessionAfterAuth } = require('../../../utils/userSession')
      Promise.resolve(refreshSessionAfterAuth()).catch(() => {})
    } catch (e) {
      console.warn('wish wall refresh session failed', e)
    }
    // 开关在授权期间被关掉（SWR 回填 / 超管改动）：能力不可用就明说，别假装存上了
    if (this.data.showRitualProfile !== true) {
      toastRitualProfileClosed((text) => this.showAppToast({ overline: 'RITUAL BACKUP', title: text }))
      this.trackRitualGate('fail_flag_off')
      return
    }
    const ok = await this.syncRitualToCloud()
    // 终点只在**真的存上云**时上报：失败走 fail_sync，否则漏斗数字会是假的
    if (ok) this.trackRitualGate('resume_success')
    else this.trackRitualGate('fail_sync')
    // 结果如实告诉用户：成功「已存到云端」，失败说清"还在本机"（不假装）
    this.showAppToast({
      overline: 'RITUAL BACKUP',
      title: ok ? '已存到云端' : '记录仍在本机',
      desc: ok ? '连灯天数与木鱼功德已同步到云端' : '云端暂不可用，本地记录没有丢'
    })
  },

  /** 弹窗里的「去注册」被点（还没拿到手机号）：单独立一个漏斗环节，区分"曝光多没人点"与"点了授权失败" */
  onRitualDialogCta() {
    this.trackRitualGate('go_register')
  },

  /**
   * 「先存着」（关掉弹窗）：只收弹窗，**本地记录一个字都不动**
   * （用户拒绝的是"现在注册"，不是"删掉我的连灯"）。
   */
  onRitualDialogClose() {
    if (this.data.showRitualDialog) this.setData({ showRitualDialog: false })
    this.trackRitualGate('dismiss')
  },

  /** 授权失败/被拒：只收口 + 记一笔，不打断主功能（用户可再点一次 CTA 重试） */
  onRitualDialogFail(e) {
    const reason = (e && e.detail && e.detail.reason) || 'unknown'
    this.trackRitualGate('fail_' + reason)
  },

  /* ----------------------------- 功德证（创新钩子 H2，2026-09-20） ----------------------------- */
  /**
   * 纯函数转接：判定写在模块作用域（`certEntryState`），阈值与文案写在 `utils/muyuCertificate`。
   * 页面与测试直接调同一份实现 —— 抽成纯函数的意义就是"能被断言"。
   */
  certEntryState,

  /**
   * 刷新「功德证」次级入口（**只 setData，不联网**）。
   *
   * 木鱼可连点，入口判定必须在本地零成本完成；云端写入只在两个时刻发生，
   * 见 `reportCertProgress` 与 `claimCert`（写放大防护）。
   * 入口曝光埋点（`show`）同一次访问同一档只报一次 —— 否则连点会刷出一堆 show，
   * 把漏斗的曝光分母污染成"被敲了多少下"。
   */
  refreshCertEntry() {
    const next = certEntryState({
      flagOn: this.data.showMuyuCertificate === true,
      allowed: this.data.allowed === true,
      muyuCount: this.data.muyuCount || 0,
      claimed: (this._certRecord && this._certRecord.claimed) || {}
    })
    const cur = this.data.certEntry
    const same = (!cur && !next) || (!!cur && !!next && cur.mode === next.mode && cur.milestone === next.milestone)
    if (!same) {
      const patch = {
        certEntry: next
          ? Object.assign({}, next, { muyuCount: this.data.muyuCount || 0 }, muyuCert.buildEntryText(next.mode, next.milestone))
          : null
      }
      // 关掉开关（或不再有可领/可看的证）时，正在展开的证也要一起收 ——
      // 开关的意义是"关掉写入与展示"，还留一张证在屏幕上等于没关。
      if (!next) patch.certCard = null
      this.setData(patch)
    }
    if (next && next.mode === 'claim') {
      const key = 'claim:' + next.milestone
      if (this._certShownKey !== key) {
        this._certShownKey = key
        this.trackCertGate('show', { milestone: next.milestone })
      }
    }
  },

  /**
   * 埋点收口（纯转发）：`muyu_cert_gate` 这个 action 只在这里出现一次 ——
   * 五处各写一遍 action 名，改名漏一处就多一条恒 0 的漏斗。
   */
  trackCertGate(step, extra) {
    trackBehavior('muyu_cert_gate', 'wish_wall', this.data.productKey, Object.assign({ step }, extra || {}))
  },

  /**
   * 次级入口被点。回看 = 纯本地展开（不问身份、不联网）；
   * 领证才需要身份 —— 复用 `RegisterAuthDialog`（与落愿门禁 / 连续记录钩子同一条链）。
   */
  async onCertEntryTap() {
    const entry = this.data.certEntry
    if (!entry) return false
    if (entry.mode === 'view') return this.openCertCard(entry.milestone)
    if (this.data.showMuyuCertificate !== true) return false
    // 互斥：落愿门禁 / 连灯云存钩子的注册弹窗正开着时，不再叠第二个注册弹窗
    // （同一页两个门禁同时弹 = 方案 §H2 点名的骚扰风险；对应 shouldOfferRitualGate 的反向闸）
    if (this.data.showRegisterDialog === true || this.data.showRitualDialog === true) return false
    this._pendingCertMilestone = entry.milestone
    const guest = await this.isGuestUser()
    if (guest) {
      // 门禁文案报真实里程点与真实计数（不编数字）；show 已在入口出现时上报过
      this.setData({
        showCertDialog: true,
        certGateDesc: muyuCert.buildCertDesc(entry.milestone, this.data.muyuCount)
      })
      return true
    }
    // 已注册用户：不必走门禁，直接发证；但**同样**要同步上云并如实反馈
    return this.claimCert(entry.milestone)
  },

  /**
   * 发证 + 同步上云 + 如实反馈（**唯一**的领证实现，门禁路径与已注册路径共用）。
   *
   * 顺序刻意是"本地先落、云端后同步"：本地仍是权威（见 `utils/ritualProfile.js` 头注），
   * 云同步失败不影响本地这张证，但**绝不说假话** —— 只有 `syncToCloud()` 返回成功
   * 才说「已存到云端」，否则说「记录仍在本机」，且漏斗终点只记在成功那一支。
   */
  async claimCert(milestone) {
    const m = muyuCert.toCount(milestone)
    if (!m) return false
    const dayKey = shanghaiDayKey(Date.now())
    this._certRecord = muyuCert.claimMilestone(this._certRecord, m, dayKey, this.data.muyuCount)
    // 本地存档 = "可保管"的兑现；写失败也不拦（本次仍看得到证，下次再存）
    muyuCert.writeRecord(this._certRecord)
    // 从此这台设备上的功德允许上报（＝已领证＝已注册的持证人）
    this._certBacked = true
    this.openCertCard(m)
    this.refreshCertEntry()
    const ok = await this.syncRitualToCloud()
    if (ok) {
      this._certSyncedCount = this.data.muyuCount
      this.trackCertGate('resume_success', { milestone: m })
      this.showAppToast({
        overline: 'MUYU CERTIFICATE',
        title: '已存到云端',
        desc: '功德计数已同步到云端，随时可以回来回看这张功德证'
      })
    } else {
      this.trackCertGate('fail_sync', { milestone: m })
      this.showAppToast({
        overline: 'MUYU CERTIFICATE',
        title: '记录仍在本机',
        desc: '云端暂不可用，本地功德没有丢，证也已经发到本机'
      })
    }
    return ok
  },

  /**
   * 注册成功。**必须真的同步**：只弹个"成功"却什么都没存，这个钩子就是空承诺
   * （所以漏斗终点 `resume_success` 只在同步成功后上报，失败走 `fail_sync`）。
   */
  async onCertRegisterSuccess() {
    this.setData({ showCertDialog: false })
    // 会话刷新不阻塞发证（与落愿门禁同一口径）
    try {
      const { refreshSessionAfterAuth } = require('../../../utils/userSession')
      Promise.resolve(refreshSessionAfterAuth()).catch(() => {})
    } catch (e) {
      console.warn('wish wall refresh session failed', e)
    }
    // 开关在授权期间被关掉（SWR 回填 / 超管改动）：能力不可用就明说，别假装存上了
    if (this.data.showMuyuCertificate !== true) {
      this._pendingCertMilestone = 0
      this.trackCertGate('fail_flag_off')
      this.showAppToast({ overline: 'MUYU CERTIFICATE', title: '功德证暂未开放' })
      return
    }
    const milestone = this._pendingCertMilestone
    this._pendingCertMilestone = 0
    if (!milestone) return
    await this.claimCert(milestone)
  },

  /** 弹窗里的「去注册」被点（还没拿到手机号）：单独立一个漏斗环节，区分"曝光多没人点"与"点了授权失败" */
  onCertDialogCta() {
    this.trackCertGate('go_register')
  },

  /** 「先存着」：只收弹窗，本地功德与已发的证一个字都不动 */
  onCertDialogClose() {
    if (this.data.showCertDialog) this.setData({ showCertDialog: false })
    this.trackCertGate('dismiss')
  },

  /** 授权失败/被拒：只收口 + 记一笔，不打断主功能（可再点一次领证重试） */
  onCertDialogFail(e) {
    const reason = (e && e.detail && e.detail.reason) || 'unknown'
    this.trackCertGate('fail_' + reason)
  },

  /** 展开 / 回看这张证（纯本地：证由本地持证记录派生，不需要联网） */
  openCertCard(milestone) {
    const rec = muyuCert.normalizeRecord(this._certRecord)
    const card = muyuCert.buildCertificate(rec.claimed[String(muyuCert.toCount(milestone))])
    if (!card) return false
    this.setData({ certCard: card })
    return true
  },

  closeCertCard() {
    if (!this.data.certCard) return
    this.setData({ certCard: null })
  },

  /**
   * 功德上报 —— 云端写入的**唯一**非领证入口（领证那一刻的写入在 `claimCert` 里）。
   *
   * 方案 §H2 把「木鱼可连点 → 写放大」列为头号风险，这里用三道闸一起挡：
   *   ① **只在离开页面 / 退出时**被调用（`onHide` / `onUnload`）；`onMuyuTap` 体内
   *      没有任何云端写入（行为断言：连点 300 下写入 0 次；源码断言：方法体内不出现云调用）；
   *   ② **只在已领证（＝已注册的持证人）之后**才写 —— 没领证就不该有云端档案，
   *      也守住「存云端是注册的兑现」这条产品口径（未注册用户一次都不写）；
   *   ③ **计数没变就不写**（脏标记 `_certSyncedCount`），再加在途闸 ——
   *      `onHide` + `onUnload` 连击只写一次，离开十次也只写真正有变化的那几次。
   */
  reportCertProgress() {
    if (this.data.showMuyuCertificate !== true) return Promise.resolve(false)
    if (this._certBacked !== true) return Promise.resolve(false)
    if (muyuCert.toCount(this.data.muyuCount) === muyuCert.toCount(this._certSyncedCount)) return Promise.resolve(false)
    if (this._certReportInFlight === true) return Promise.resolve(false)
    this._certReportInFlight = true
    return Promise.resolve()
      .then(() => this.syncRitualToCloud())
      .then((ok) => {
        if (ok) this._certSyncedCount = this.data.muyuCount
        return ok
      })
      .catch(() => false)
      .then((ok) => {
        this._certReportInFlight = false
        return ok
      })
  },

  /** 浮层内层的空处理器：`catchtap`/`catchtouchmove` 需要一个存在的目标，防穿透 */
  noop() {}
})
