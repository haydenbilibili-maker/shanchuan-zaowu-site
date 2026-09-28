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
// 字数口径（P0 修复）：按「字」算而不是按 UTF-16 码元算 —— `draft.length` 会把 emoji 算 2、
// 把 ZWJ 家庭 emoji 算 8，`.slice(0, TEXT_MAX)` 还会截出半个代理对。口径与已知边界见该模块文件头；
// 服务端 `manageWishWall` 内嵌的副本与它逐字节相同（守卫 test-wish-wall 会比对两份 + 同组用例）。
const { wishTextCount, wishTextTruncate } = require('../../../utils/wishTextCount')
const wishRitual = require('../utils/wishRitual')
const ritualFeedback = require('../utils/ritualFeedback')
// 玩法（2026-09-27 口径）：入口打开本页弹层（plays 分包 PlaySheet），不再跳玩法页。
// 玩法的进行态/结果/推荐/分享全在 `subpackages/plays/utils/ritualPlayPage.js`（弹层与兼容独立页共用），本页不持有。
const { RITUAL_PLAYS, findPlay } = require('../config/ritualPlays')
const ritualPlayArchive = require('../utils/ritualPlayArchive')
const wishHandoff = require('../utils/wishHandoff')
const { sanitizeBlessTags, blessPlayIds, blessLabel, wallDefaultBlessTags } = require('../../../config/blessTags')
const easterEgg = require('../../../utils/easterEgg')
const easterEggHost = require('../../../utils/easterEggHost')
// 创新钩子 H2「功德证」的纯函数核（里程点判定 + 持证记录 + 本地存档），见 utils/muyuCertificate.js
const muyuCert = require('../utils/muyuCertificate')
// 展品主角区：静态文案逐条有出处（config/wallExhibit），商品字段按既有只读方式运行时取
const { pickWallProduct, buildExhibitView } = require('../utils/wallExhibitProduct')
const { trackBehavior } = require('../../../utils/trackBehavior')
const {
  fetchContentDisplayFlags,
  toastWishWallClosed,
  toastRitualProfileClosed
} = require('../../../utils/contentDisplayFlags')

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

/**
 * 钩子弹窗的 desc（纯函数）：只说**两件真的做得到的事** —— "存什么 + 换手机/清缓存都还在"，
 * 并报出真实进度。
 *
 * ⚠️ 2026-09-21（P2-11）：原来这句还承诺「断签前还会提醒你」——**那是没有实现的承诺**：
 * 全仓没有祈福墙的 `requestSubscribeMessage`，云函数也不发任何通知（需后台模板 ID，
 * 超出本机能力）。产品处置：**把未兑现的承诺删掉**，不要在没有实现的情况下继续承诺。
 * 同类话术一并核对过：本页其余文案只陈述"存到云端"这一件事（本次真的做了，见 onRegisterSuccess）。
 */
function buildRitualGateDesc(reason, state) {
  const s = state || {}
  if (reason === 'streak') {
    return `已连续点灯 ${Number(s.streak) || 0} 天。注册后这份记录存到云端，换手机、清缓存都还在。`
  }
  return `已敲了 ${Number(s.muyuCount) || 0} 下木鱼。注册后功德与连灯记录存到云端，换手机、清缓存都还在。`
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
    /**
     * 已写几个「字」（P0 修复：原来展示的是 `{{draft.length}}`，即 UTF-16 码元数 ——
     * 写 1 个家庭 emoji 会显示 8/30）。计数走 `utils/wishTextCount.wishTextCount`，
     * 与服务端同一口径。**每次改 `draft` 都必须同步改它**（本页：onDraftInput /
     * useInspiration / borrowWishText / applyPlayHandoff 四处，守卫有断言钉住）。
     */
    draftCount: 0,
    productId: '',
    productKey: PRODUCT_KEY,
    /** 入口来源（门店码 → store_qr；线上入口 → 组件传入的 from） */
    entryFrom: 'direct',
    productTitle: '马上有',
    items: [],
    /**
     * **墙面那一份**愿签（与当前视图无关）—— 传给 `<wall-feed>` 的 `items`（PRD v1.4 §11.1 R2）。
     * ⚠️ 为什么必须另起一个字段：`items` 会被 `applyView` 整体换成**当前视图**的数据源
     * （改造前两视图共用一套渲染），直接把它传给组件，切到「我的心愿」后组件的墙视图会读到
     * 我的心愿（串台 —— 2026-09-20 刚修过的那一类）。
     * 写入点只有四处（组件接线后，墙数据的每次变更都在这里同步一份）：
     * applyItems / loadMine 回写 isMine / 落愿乐观插入 / 高亮消退。
     */
    wallItems: [],
    /** 两列瀑布的列内容（items 的奇偶分列） */
    tagColumns: [],
    /** 打到服务端上限：文案改说「仅展示最近 N 条」 */
    tagCapped: false,
    /**
     * **墙面**是否打到服务端上限（只由 applyItems 写）。
     * 传给组件的 `capped` —— 组件收尾条据此如实说「仅展示最近 N 条」而不是「共 N 条」。
     * 与 `wallCount` 同口径：只描述**墙**，不被当前视图带偏（tagCapped 会被 applyView 重写）。
     */
    wallCapped: false,
    /**
     * **墙上的**愿签条数（与当前视图无关）。
     * ⚠️ 为什么不能直接用 `items.length`：`items` 会被 applyView 整体换成当前视图的数据源，
     * 于是切到「我的心愿」后，「墙上的愿签」那一段与墙页脚都会显示我的心愿条数（串台）。
     * 只有 applyItems（墙列表回包）写这个字段。
     */
    wallCount: 0,
    rows: [],
    inspiration: [],
    draft: '',
    /** 由「写成心愿」置 true → 输入框自动聚焦、键盘直接起来（失焦时由 onInputBlur 复位） */
    inputFocus: false,
    /**
     * 刚落愿时注册成功的「下一步」提示条（PRD §9-4 裁决：**两者合一** —— 券包 + 去逛）。
     * 只在 `onRegisterSuccess` 置 true；它是一条**就地提示**，不是新弹窗。
     */
    justRegistered: false,
    loadError: '',
    /**
     * **门禁读失败**（不是"馆方关了"）。`flagChecked && !allowed` 有两种成因：
     * 开关读了、确实是关的；或者开关压根没读上（网络/权限异常）。
     * 2026-09-20 改造前两者共用一句「祈福墙暂未开放 / 馆方正在准备这块墙面」——
     * 那是把系统故障说成馆方的状态（假事实），且用户没有重试的路。
     */
    gateError: false,
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
    /**
     * 「我的心愿」自己的加载 / 失败态（2026-09-21 · P1-5）。
     *
     * 为什么必须与墙的 `loading` / `loadError` 分开：`applyView` 用的是 `this._mineRows || []` ——
     * mine 还没回来（或读失败）时它**同样是空数组**，于是 WXML 的 `!items.length` 分支会说出
     * 「你还没在这面墙上写过心愿」：那是把"还没读到"当成"你没写过"，正是本批要消灭的假事实。
     * 两个状态位各自有一个 WXML 分支，空文案只在 `mineLoading===false && !mineError` 时才允许出现。
     */
    mineLoading: false,
    mineError: '',
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
    /** 点按弹幕时短暂高亮/停住的那条（B 站式点弹幕反馈） */
    heldDmId: '',
    /** 落愿瞬间：挂签台切换成「已挂上」态，与墙上回声/落签高亮同窗 */
    deskPosted: false,
    /**
     * 展品主角（这面墙对应的那件线下展品）。null = 这面墙没登记展品 → 墙头展签与展品卡都不渲染。
     * 形状见 utils/wallExhibitProduct.buildExhibitView。
     */
    exhibit: null,
    /** 展品卡（从墙头展签点开的底部卡片） */
    exhibitOpen: false,
    /** 博物笔记进度（彩蛋图鉴入口用） */
    relics: { found: 0, total: 0 },
    /**
     * 弹幕轮次。进 rows 的 key，从而让 DOM 重建、动画重播 ——
     * 弹幕只播一轮（forwards）：若用 CSS 无限循环，第二轮起同轨又会叠在一起
     * （旧实现就是这么叠成灾难现场的）。整批重排由 scheduleDanmakuCycle 定时触发。
     */
    danmakuCycle: 0,
    heartBurst: false,
    // 安心木鱼功德。**本地是权威**；注册后可同步到云端（`wishRitualProfile`）并在换机时恢复。
    // ⚠️ 原注释写「不上云，纯陪伴」—— 自 H1 钩子（连续记录云保存）起已不成立，勿再引用。
    muyuCount: 0,
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
     * 玩法**入口区**（2026-09-21 口径变更 · PRD v1.4 §11.4「玩法各开一页」）：
     * `plays` 由注册表派生，页面不写死任何玩法名；每个入口还带 `played` / `stateText`
     * （"今天玩过没有" —— 由 `refreshPlayStates` 按本地留档与今天的日期键现算）。
     * 进行态 / 结果 / 推荐 / 分享在**玩法弹层**里（plays 分包的 PlaySheet 组件），入口不再跳页。
     */
    plays: RITUAL_PLAYS,
    /** 玩法弹层：当前打开的玩法 id（空串 = 未打开）与带进去的墙上下文 */
    playSheetId: '',
    playSheetCtx: {},
    /** 这面墙的祈运标签（由入口从商品带过来；没有就不排不提示，页面照常） */
    blessTags: [],
    /** 祈运标签的中文名（页头那颗 chip 用；空串则不显示） */
    blessLabelText: '',
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
    const productKey = normalizeProductKey(opts.productKey || fromScene.productKey)
    this.setData({
      productId: String(opts.productId || ''),
      // 作用域来自入口组件或门店码；非法/缺失一律回落到默认墙，避免拼出一个读不到内容的 key
      productKey,
      productTitle: String(opts.title ? decodeURIComponent(opts.title) : '马上有'),
      /** 入口来源：门店码会带 store_qr，用于埋点区分"现场扫码"与线上入口 */
      entryFrom: String(opts.from || fromScene.from || 'direct')
    })
    // `play=<玩法 id>`：旧玩法页兼容落地 / 外链直达，门禁放行后自动打开对应弹层（见 openPendingPlay）
    this._pendingPlay = String(opts.play || '')
    // 展签先用静态文案画出来（零网络）；商品图 / productId 等门禁放行后再补（resolveWallExhibit）
    this.setData({ exhibit: buildExhibitView(productKey, null, '') })
    this.applyBlessScope(opts.bless, productKey)
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
    // 博物笔记入口：**纯本地**（一次云调用都没有），所以放在门禁/云调用之前无条件算一次 ——
    // 它此前只在 loadMine 成功分支被调，mine 一失败入口就整块消失（P2-9，2026-09-21）。
    // 幂等：进度没变时 recordRelics 直接 return，不进 setData。
    this.recordRelics()
    this.bootstrap()
    // ⚠️ P2-10（2026-09-21）：`restoreRitualFromCloud()` **不再在这里**无条件调用。
    // 本文件开头写着「关闭时不发起任何网络请求」，但它在 onLoad 里是无条件的 ——
    // 开关关闭（页面渲染成「暂未开放」）时仍会打一次 `wishRitualProfile`，成功还会写本地存储。
    // 现在移动到 `applyGate` 的 `if (!allowed) return` **之后**（只有真的开放了才拉）。
  },

  onPullDownRefresh() {
    // 下拉 = **强制**重读开关 + 重拉列表。开关走 SWR 缓存（TTL 10 分钟 / 陈旧窗口 24 小时），
    // 下拉是用户自己能把门禁刷新过来的动作 —— 否则只能等缓存过期或清缓存。
    // ⚠️ 2026-09-20 修：`force` 此前在 applyGate 的早退分支里被丢掉 ——
    // 开关没变时整条 refresh 都不执行，"刷新"只刷新了开关。现在 force 会一路传到 applyGate。
    this.bootstrap({ force: true }).finally(() => wx.stopPullDownRefresh())
  },

  /**
   * 门禁读失败后的重试（只有 `gateError` 才渲染这个入口）。
   * 与下拉刷新同一条路：强制跳过 SWR 缓存重读开关。
   */
  onGateRetry() {
    // 重试前先清掉错误态：这样即使这次也读失败，用户看到的是"又失败了一次"，
    // 而不是"上一次的错误 + 一个卡住的加载态"叠在一起（2026-09-20，子代理复核补）。
    this.setData({ loading: true, gateError: false })
    this.bootstrap({ force: true })
  },

  /**
   * 祈运作用域：入口把商品的祈运标签带在 URL 上（见 utils/wishWall.buildWishWallUrl）。
   *
   * 只做两件事：**重排**玩法瓦片 + 显示一句提示。
   * 刻意**不隐藏**任何玩法：标签只决定"先看到哪个" —— 隐藏玩法等于替用户做决定，也更难解释；
   * 参数缺失/非法一律当"没有标签"（页面照常可用，绝不因为一个查询参数就报错）。
   */
  applyBlessScope(raw, productKeyOpt) {
    let tags = sanitizeBlessTags(raw || '')
    // P2-6 选项 B：门店默认墙无 bless 参数时，按 productKey 推导墙级标签（不改印刷物）
    if (!tags.length) {
      tags = wallDefaultBlessTags(productKeyOpt || this.data.productKey)
    }
    if (!tags.length) {
      this.setData({ blessTags: [], blessLabelText: '', plays: this.decoratePlayStates(RITUAL_PLAYS) })
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
    this.setData({ blessTags: tags, blessLabelText: blessLabel(tags[0]), plays: this.decoratePlayStates(plays) })
  },

  /**
   * 页头藏品 chip（第一屏常驻的产品入口，2026-09-21 · P2-7）。
   *
   * ⚠️ 为什么这个 handler 必须与"玩法"分开上报：它挂在**页头 chip** 上，那里
   * **没有任何玩法发生**。此前它与纸签弹层（现已搬到玩法页）共用同一个 `goProduct`，
   * 也就共用 `wish_wall_play/to_product` —— 而 ERP「参与仪式 / 玩法」行的口径是
   * `actions: ['wish_wall_lamp','wish_wall_play','wish_wall_sound']`（只看 action 名），
   * 于是"点一下页头 chip"会被计成一次玩法参与，**参与率可以 >100%**。
   *
   * 处置（在既有维度内区分，不改报表、不改 schema）：
   *   · 玩法转化 → `wish_wall_play` / `targetType='play'`（玩法 id 在 targetId，已随玩法页搬走）；
   *   · 页头 chip → `wish_wall_play` / **`targetType='product'`**（productId 在 targetId）。
   * `targetType` 是**已入库的既有维度**（`BEHAVIOR_ALLOWED_FIELDS` 里就有），
   * 报表侧只需在 engage 行的 action 之外加一条 `targetType === 'play'` 即可把两者分开
   * —— 这正是本条的验收口径（"以报表侧能区分"）。报表侧不属本代理白名单，未改。
   */
  goWallProduct() {
    const id = String(this.data.productId || '')
    if (!id) return
    trackBehavior('wish_wall_play', 'product', id)
    // from=wish_wall：与玩法页出墙同口径，详情侧可区分「从墙回看本品」
    wx.navigateTo({
      url: `/subpackages/feature/detail/index?id=${encodeURIComponent(id)}&from=wish_wall`,
      fail: () => {}
    })
  },

  /* ----------------------------- 展品主角区（墙头展签 + 展品卡） ----------------------------- */

  /**
   * 只读解析「这面墙的那件商品」，补上 productId 与实物主图。
   *
   * 读取方式与详情页同形（`products` 集合 `read: true`，客户端直读）；**不写库、不调任何云函数**。
   *   · 有 productId（从详情页进来）→ `doc(id)`，只为拿主图 / 学名；
   *   · 没有（门店码 / 首页默认墙）→ 按展品名只读取候选，再用入口组件同一套命中口径挑一件
   *     （`pickWallProduct`）。挑不到就维持纯文案展签 —— 不拿别的商品凑数。
   * 失败一律静默降级：展签照常显示，只是没有实物图、页头 chip 仍点不进详情。
   */
  async resolveWallExhibit() {
    const key = this.data.productKey
    if (!this.data.exhibit) return
    if (!(wx.cloud && typeof wx.cloud.database === 'function')) return
    let product = null
    try {
      const db = wx.cloud.database()
      const coll = db.collection('products')
      const pid = String(this.data.productId || '')
      if (pid) {
        const res = await coll.doc(pid).get()
        product = (res && res.data) || null
      } else {
        const where = key === PRODUCT_KEY
          ? { title: db.RegExp({ regexp: this.data.exhibit.name, options: 'i' }) }
          : { wishWallKey: key }
        const res = await coll.where(where).limit(10).get()
        product = pickWallProduct(res && res.data, key)
      }
    } catch (e) {
      console.warn('resolveWallExhibit', e)
      return
    }
    if (!product || this._unloaded) return
    const raw = String((Array.isArray(product.images) && product.images[0]) || product.cover || '')
    let cover = raw
    if (raw.indexOf('cloud://') === 0) {
      try {
        const r = await wx.cloud.getTempFileURL({ fileList: [raw] })
        cover = String((r && r.fileList && r.fileList[0] && r.fileList[0].tempFileURL) || '')
      } catch (e) {
        cover = ''
      }
    }
    if (this._unloaded) return
    const patch = { exhibit: buildExhibitView(key, product, cover) }
    if (!this.data.productId && product._id) patch.productId = String(product._id)
    this.setData(patch)
  },

  openExhibit() {
    if (!this.data.exhibit) return
    this.setData({ exhibitOpen: true })
  },

  closeExhibit() {
    if (this.data.exhibitOpen) this.setData({ exhibitOpen: false })
  },

  /** 展品卡 →「对着它写一句」：收起卡片，滚到挂签台并聚焦（与灵感词同一条聚焦路径） */
  exhibitToWish() {
    this.setData({ exhibitOpen: false })
    try {
      wx.pageScrollTo({ selector: '#wishInput', duration: 260, fail: () => {} })
    } catch (e) { /* 低版本基础库不支持 selector，忽略 */ }
    this.focusWishInput(300)
  },

  /* ----------------------------- 玩法入口区（四个玩法各开一页） ----------------------------- */

  /**
   * 入口区刷新（PRD v1.4 §11.4）：给每个玩法算一句**"今天玩过没有"**。
   *
   * 状态来源：`utils/ritualPlayArchive` 的本地留档（key `shanhai_ritual_play_v1`，
   * 按玩法分桶、每天每维度最多一条）。**跨天不需要任何钩子** —— `playedToday` 是拿留档里的
   * dayKey 与"今天"（`shanghaiDayKey`，与点灯/灯语同源）现算的，所以跨天自然翻页、
   * 也不可能漏重置。不写云：玩法结果是娱乐/收集，不是资产（同 §7 木鱼不写云的口径）。
   *
   * 为什么要在 onShow 也算一次：用户从玩法页返回，状态必须立刻变成"今天已玩过"。
   */
  refreshPlayStates() {
    this.setData({ plays: this.decoratePlayStates(this.data.plays) })
  },

  /**
   * 给注册表条目补一个 `played`（今天玩过没有）。纯本地、必不抛 —— 存储不可用时一律当"没玩过"。
   * 抽成纯函数式的私有方法，是为了让 `applyBlessScope`（重排后）与 `refreshPlayStates`（回页后）
   * 用**同一套**状态口径，不会出现"重排之后状态丢了"。
   */
  decoratePlayStates(plays) {
    const today = shanghaiDayKey(Date.now())
    const list = Array.isArray(plays) ? plays : []
    const playedMap = ritualPlayArchive.playedTodayMap(list.map((p) => p.id), today)
    return list.map((p) => Object.assign({}, p, { played: !!playedMap[p.id] }))
  },

  /**
   * 玩法入口 → **本页弹层**（2026-09-27 产品口径：玩法都在祈福墙上完成，不跳新页面）。
   * 进行态 / 结果 / 推荐 / 分享在 PlaySheet 里（plays 分包，与独立页同一份工厂与皮）。
   *
   * 为什么这里**不**记 `wish_wall_play`：点入口是"去玩"，真正的玩法参与在弹层本体里上报；
   * 在这里也发一次会让 ERP「参与仪式 / 玩法」的参与率被点进门的那一下灌水（P2-7 同一条教训）。
   */
  onPlayTap(e) {
    const id = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    this.openPlaySheet(id)
  },

  /** 打开玩法弹层：只认注册表里的 id；把墙的上下文（本品 / 祈运）带进去，推荐与回看靠它 */
  openPlaySheet(id) {
    const key = String(id || '')
    if (!findPlay(key) || this.data.playSheetId) return false
    this._playShare = null
    this.setData({
      playSheetId: key,
      playSheetCtx: {
        productId: this.data.productId || '',
        productKey: this.data.productKey || '',
        title: this.data.productTitle || '',
        blessTags: (this.data.blessTags || []).slice()
      }
    })
    return true
  },

  /** 深链 `play=<id>`：只消费一次（下拉刷新 / 门禁回填都不会重复弹） */
  openPendingPlay() {
    const id = this._pendingPlay
    this._pendingPlay = ''
    if (id) this.openPlaySheet(id)
  },

  /** 收起弹层：卸载本体 + 入口状态立刻变成"今天已玩过" */
  onPlaySheetClose() {
    this._playShare = null
    this.setData({ playSheetId: '' })
    this.refreshPlayStates()
  },

  /**
   * 弹层「写成心愿」：本体已写好一次性交接 → 当场取走（预填 + 滚到挂签台 + 墙上回一声）。
   * 弹层在出场**开始**时就抛这一声：滚动与面板下沉同时进行，出场结束它再抛 close 卸载自己。
   */
  onPlaySheetWish() {
    if (!this.data.allowed) return
    this.applyPlayHandoff()
  },

  /** 弹层「分享这份结果」：只记下 result.share，交给 onShareAppMessage 用一次 */
  onPlaySheetShare(e) {
    const title = String((e && e.detail && e.detail.title) || '')
    this._playShare = title ? { title } : null
  },

  /**
   * 玩法页「写成心愿」的**落点**（PRD v1.4 §11.4 动线不能断）。
   *
   * 玩法页在跳回之前写一份一次性交接（`utils/wishHandoff`），这里在 `onShow` 取走：
   *   · 有 draft → 预填写愿输入框（同一口径截断 + 同步字数）+ 滚动 + 自动聚焦；
   *   · 有 echo → 在弹幕墙回一声（"我摇了今日一签"这类第一人称句，来自注册表）。
   * `take()` **读到即删 + 5 分钟时效**，所以不会之后每次进墙都诡异地预填一句旧心愿。
   * 交接读不到（用户没走这条路 / 已超时）就什么都不做 —— 页面照常可用。
   */
  applyPlayHandoff() {
    const h = wishHandoff.take()
    if (!h) return
    if (h.draft) {
      const draft = wishTextTruncate(h.draft, TEXT_MAX)
      this.setData({ draft, draftCount: wishTextCount(draft) })
      try {
        wx.pageScrollTo({ selector: '#wishInput', duration: 260, fail: () => {} })
      } catch (e) { /* 低版本基础库不支持 selector，忽略 */ }
      // 滚动（260ms）之后再聚焦，否则"滚动落点"与"键盘顶起"同时发生、落点会跳
      this.focusWishInput(300)
    }
    if (h.echo) this.pushEcho('play', { text: h.echo })
  },

  /**
   * 把焦点交给写愿输入框（`focus="{{inputFocus}}"` 唯一的置真处）。
   *
   * ⚠️ 2026-09-20：定时器**必须存句柄**。此前 usePlayWish 里的 300ms 是匿名 setTimeout，
   * 页面在 300ms 内卸载就会对已卸载页面 setData —— 本页唯一漏清的定时器（审计实测）。
   * 另外灵感词与「抄一句」也从这里聚焦：它们只改 draft，从前既不聚焦也不滚动，
   * 真机上的反馈是"点了像没反应"。
   */
  focusWishInput(delayMs) {
    if (this._focusTimer) clearTimeout(this._focusTimer)
    this._focusTimer = setTimeout(() => {
      this._focusTimer = null
      if (this._unloaded) return
      if (this.data.inputFocus) return
      this.setData({ inputFocus: true })
    }, Math.max(0, Number(delayMs) || 0))
  },

  /** 失焦即复位自动聚焦标记 —— 否则某些机型在后续任意重渲染时会把键盘再次顶起来 */
  onInputBlur() {
    if (this.data.inputFocus) this.setData({ inputFocus: false })
  },

  /* ── 注册成功后的「下一步」（PRD §9-4 裁决：**两者合一**）──────────────────────
     两个出口：去券包（复用共享导航，它会按"有没有可用券"分流）/ 去逛逛（切到馆藏 tab）。
     两条都单独记漏斗 step —— 否则无法知道"给的这个下一步到底有没有人走"，
     这正是 PRD §7「给下一步必须是可测的一步」的要求。 */
  goCouponsAfterRegister() {
    trackBehavior('wish_wall_register_gate', 'wish_wall', this.data.productKey, { step: 'to_coupons' })
    try {
      require('../../../utils/rewardsNav').openWalletHub({ tab: 'coupons' }).catch(() => {})
    } catch (e) { /* 导航失败不影响页面 */ }
  },

  goShoppingAfterRegister() {
    trackBehavior('wish_wall_register_gate', 'wish_wall', this.data.productKey, { step: 'to_shop' })
    // 馆藏是 tabBar 页，必须 switchTab（navigateTo 会失败）
    try { wx.switchTab({ url: '/pages/category/index', fail: () => {} }) } catch (e) { /* ignore */ }
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

  /**
   * 把云端仪式档案拉回来（H1 钩子「记录不丢」的**取**这一半）。
   *
   * 为什么需要（2026-09-20 自查发现，不是新功能）：
   *   `utils/ritualProfile.loadFromCloud()` 早已实现 —— 拉云端 → 与本地按
   *   **max / 更晚日**合并（`core.mergeProfiles`）→ `applyProfileToLocal()` 回填本地存储。
   *   但**从来没有页面调用它**：全仓只有注释提到它，实际接线的只有 `syncToCloud`（存）。
   *   于是「注册后记录存云端、换手机不丢」这句承诺**只成立一半** ——
   *   云端有档案，新设备却没人去拉，用户看到的还是 0。
   *
   * 语义与降级（都来自既有实现，这里不重复造）：
   *   · 云能力不可用 / 云函数未部署 / 网络失败 → `loadFromCloud` 内部已返回
   *     `{ ok:false, degraded:true }`，**本地一个字都不动**，页面照常用本地值；
   *   · 成功 → 本地存储已被回填，这里只需把**页面显示**同步过来
   *     （功德计数 + 灯态/连续天数），否则会「数据回来了、界面还是 0」；
   *   · **fire-and-forget**，不阻塞首屏；任何异常只 warn，绝不影响仪式主功能。
   */
  async restoreRitualFromCloud() {
    try {
      const mod = require('../utils/ritualProfile')
      if (!mod || typeof mod.loadFromCloud !== 'function') return
      const res = await mod.loadFromCloud()
      if (!res || res.ok !== true) return // 降级：本地值不动（保住既有行为）
      // 回填后刷新显示：与 onLoad 同一读取口径，不另写一套
      this.setData({ muyuCount: wishRitual.readMuyuCount() })
      this.initRitual()
    } catch (e) {
      console.warn('wish wall ritual restore failed', e)
    }
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
      await this.applyGate(flags, { force })
    } catch (e) {
      // 开关读取失败：保守关闭（UGC 新能力，读不到就当没开）。
      // ⚠️ 2026-09-20 改造：**必须与"馆方确实没开放"区分开**。此前两者都渲染成
      // 「祈福墙暂未开放 / 馆方正在准备这块墙面」—— 一次网络故障被说成馆方的状态，
      // 用户读到的是假事实，客服也分不清是"没开"还是"没连上"。
      // 页面现在按 `gateError` 说"没读上"并给重试（WXML 的 .ww-closed 分支）。
      this.setData({ allowed: false, flagChecked: true, loading: false, gateError: true })
    }
  },

  /** 门禁收敛：未开放时**提前返回，不发起任何网络请求** */
  async applyGate(flags, opts) {
    const force = !!(opts && opts.force)
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
    if (allowed === this.data.allowed && this.data.flagChecked) {
      // ⚠️ 2026-09-20 修（子代理行为复核抓到）：**读成功就要清错误态**。
      // 原来的早退分支什么都不写，于是"首次读开关失败 → 用户点重试 → 这次读成功、开关确实是关的"
      // 会命中这里直接 return：`gateError` 永远留在 true、`loading` 卡在 true，
      // 页面继续显示「网络或权限异常，没读上馆方的开关」——**这又是一种假事实**，
      // 而且正是本批改造声称要消灭的那一种（把系统状态说成馆方状态）。
      // 语义：`gateError` 只表示"上一次读失败"，任何一次成功读取（无论开关开还是关）都必须清掉它。
      if (this.data.gateError || this.data.loading) this.setData({ gateError: false, loading: false })
      // ⚠️ 2026-09-20 修：开关没变时**也要把内容重拉一遍**。
      // 此前这里直接 return，于是下拉刷新的实际效果是"只重读了开关"——
      // 列表、额度、我的心愿一个都不动，与「刷新」这个词不符（onPullDownRefresh 传的 force 白传）。
      // 只在 force（下拉刷新）时补这一次，不改变普通进页的控制流。
      if (force && allowed) await this.refresh()
      return
    }
    this.setData({ allowed, flagChecked: true, loading: allowed, gateError: false })
    if (!allowed) return
    this.openPendingPlay()
    // H1 钩子的「取」这一半（P2-10，2026-09-21）：换机 / 清缓存后把云端档案拉回来并刷新显示。
    // **只在这里调** —— 门禁已确认开放。刻意 fire-and-forget（不 await）：
    // 它是补强，不该拖慢首屏；失败已在内部降级（见 restoreRitualFromCloud 的注释）。
    void this.restoreRitualFromCloud()
    // 展品主角：只读解析这面墙的那件商品（补 productId 与实物图）。fire-and-forget，失败只是没有图
    void this.resolveWallExhibit()
    await this.refresh()
    // 彩蛋放在内容就位之后：先亮出墙面，再给惊喜
    this.fireEntryEgg()
  },

  async callFn(data) {
    const res = await wx.cloud.callFunction({ name: FN, data: data || {} })
    return (res && res.result) || {}
  },

  /**
   * 列表查询失败 → **一律进错误态**，不许把故障渲染成"空墙/你还没写过"（2026-09-21 · P1-1）。
   *
   * 契约（与云函数侧并行开发，见 docs/祈福墙_夜班审计_2026-09-21.md）：
   *   查询失败回 `{ success:false, msg, fallback:true }`（listPublic 与 listMine 同）。
   * 页面这里**三个条件都要认**，任一命中即故障：
   *   · `!result.success`   —— 契约的主口径；
   *   · `result.fallback`   —— 云函数自己的"这是故障不是真的空"显式标记。即使将来某个版本
   *     又把 success 写回 true，只要 fallback 还在，页面也不会把故障说成事实（两侧只需一边守约）；
   *   · `result.list` 不是数组 —— 回包形状坏了同样是"没读到"，不能当成空数组。
   * 为什么值得多认两个：本仓已有先例（P0「功德的真值被 success 之外的字段遮住」），
   * 而这一条一旦漏掉，用户看到的是**一句他无从分辨的假事实**。
   */
  listFailed(result) {
    const r = result || {}
    if (r.fallback === true) return true
    if (r.success !== true) return true
    return !Array.isArray(r.list)
  },

  async refresh() {
    if (!this.data.allowed) return
    this.setData({ loadError: '' })
    try {
      const result = await this.callFn({ action: 'list', productKey: this.data.productKey, limit: LIST_LIMIT })
      if (this.listFailed(result)) {
        this.setData({ loadError: (result && result.msg) || '加载失败', loading: false })
        return
      }
      this.applyItems(result.list, result.inspiration || [])
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
      // 组件的 `items`：墙面那一份（与当前视图无关，见 data.wallItems 的说明）
      wallItems: items,
      // 「墙上的愿签」条数与墙页脚都用它 —— 与当前视图无关（见 data.wallCount 的说明）
      wallCount: items.length,
      // 两列瀑布与「是否打到上限」都是纯函数（见 utils/wishWall.js），页面只负责接线
      tagColumns: splitTagColumns(items),
      // 服务端一面墙只回 LIST_LIMIT 条：到底了必须说清是"最近 N 条"，不能装作全量
      tagCapped: isTagListCapped(items.length),
      // 组件的 `capped`：同样只描述**墙**（applyView 不许碰它，否则切视图就变味）
      wallCapped: isTagListCapped(items.length),
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
      // ⚠️ 弹幕永远取自**墙上的**那一份（`this._wallItems`），不是 `this.data.items` ——
      // 后者在「我的心愿」视图下是另一份数据，用它会让弹幕在切视图后偷偷换成我的心愿。
      const wall = this._wallItems || []
      if (!this.data.allowed || !wall.length) return
      const cycle = (this.data.danmakuCycle || 0) + 1
      const next = buildDanmakuRows(wall, { cycle })
      this.setData({ danmakuCycle: cycle, rows: next })
      this.scheduleDanmakuCycle(next)
    }, endMs + CYCLE_PAUSE_MS)
  },

  clearDanmakuCycle() {
    if (this._danmakuTimer) {
      clearTimeout(this._danmakuTimer)
      this._danmakuTimer = null
    }
    if (this._heldDmTimer) {
      clearTimeout(this._heldDmTimer)
      this._heldDmTimer = null
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
      this.setData({ freshId: '', wallItems: this._wallItems })
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
    this._unloaded = true
    this.clearDanmakuCycle()
    this.clearFreshTimer()
    // 音效实例与回声计时器都要收：页面卸载后还在响/还在 setData = 内存与噪声双泄漏
    this.clearEcho()
    if (this._deskPostedTimer) {
      clearTimeout(this._deskPostedTimer)
      this._deskPostedTimer = null
    }
    if (this._muyuTimer) clearTimeout(this._muyuTimer)
    if (this._heartTimer) clearTimeout(this._heartTimer)
    // 自动聚焦的延时器（2026-09-20 补）：此前它是匿名 setTimeout，卸页后仍会对已卸载页面 setData
    if (this._focusTimer) clearTimeout(this._focusTimer)
    this._focusTimer = null
    try { if (this._soundPlayer) this._soundPlayer.destroy() } catch (e) { /* ignore */ }
    this._soundPlayer = null
    // 退出也要对一次账（在途闸保证与 onHide 连击时只写一次）
    void this.reportCertProgress()
  },

  onShow() {
    // ⚠️ 2026-09-20：跨天回来必须重算灯态。此前 onShow 只重排弹幕，
    // 于是"昨晚点了灯、今早从后台切回来"时 `lamp.lit` 还是 true ——
    // 点灯会走「再看一眼灯」分支，新的一天点不亮（`lightLamp` 连调用都到不了）。
    const today = shanghaiDayKey(Date.now())
    const lampDay = (this.data.lamp && this.data.lamp.dayKey) || ''
    if (lampDay && lampDay !== today) this.initRitual()
    // 博物笔记入口：纯本地、幂等，与 mine 云调用的成败无关（P2-9，2026-09-21）。
    // 放 onShow 也覆盖"从成就页回来看进度变了"这一路。
    this.recordRelics()
    // 玩法入口区的"今天玩过没有"：从玩法页回来必须立刻变成"已玩过"（§11.4）。
    this.refreshPlayStates()
    // 玩法页「写成心愿」留下的交接（§11.4 动线不能断）：取走 → 预填草稿 + 墙上回一声。
    // ⚠️ 只在开放态消费：关闭态取走会把这份交接白白吃掉（take 读到即删）。
    if (this.data.allowed) this.applyPlayHandoff()
    if (this.data.allowed && (this.data.rows || []).length) {
      // 同值 setData 能否重播弹幕动画取决于基础库 diff；弹幕轮播本来就有
      // `danmakuCycle` 进 key 的确定路径，这里只负责"接着排期"，不指望它重播。
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
    // ⚠️ P1-5（2026-09-21）：进函数就立"我的心愿在读"标记，且**清掉上一次的失败**。
    // 清失败态是必要的：重试成功却留着 mineError，用户会在数据回来后仍看到错误块。
    this.setData({ mineLoading: true, mineError: '' })
    try {
      const result = await this.callFn({ action: 'mine', productKey: this.data.productKey })
      // ⚠️ P1-1（2026-09-21）：mine 失败此前被 `(result && result.list) || []` 吞成空列表 ——
      // 于是「我的心愿」显示「你还没在这面墙上写过心愿」+ 0 条。云函数现在回 success:false，
      // 这里必须进错误态，而不是继续渲染那句假事实。
      if (this.listFailed(result)) {
        const msg = (result && result.msg) || '加载失败'
        this.setData({
          mineLoading: false,
          mineError: msg,
          myHidden: 0,
          quota: Object.assign({}, this.data.quota, { unknown: true })
        })
        return
      }
      const list = result.list
      const summary = mineSummary(list)
      this._mineRows = decorateMineRows(list, Date.now())
      // 标记并回写当前视图（viewMode 可能是 mine，也可能还是 wall）
      this._wallItems = markMine(this._wallItems || [], list)
      // 今日额度：只陈述事实（今天写了几条），上限与云函数 DAILY_LIMIT 同源
      const quota = dailyQuota(list, Date.now())
      // 成功即清失败态（同一次 setData，免得出现"数据到了、错误块还在"的一帧）
      this.setData({
        myHidden: summary.hidden,
        mine: summary,
        mineRows: this._mineRows,
        // 墙面那份被 markMine 回写了 isMine —— 组件要在墙上看出"哪条是我的"，必须同步
        wallItems: this._wallItems,
        quota,
        mineLoading: false,
        mineError: ''
      })
      this.applyView()
      // ⚠️ P2-9（2026-09-21）：博物笔记入口**不再挂在 mine 成功路径上** —— 它是纯本地数据
      // （easterEgg.getProgress），与这次云调用毫无关系。原来只在成功分支调，于是 mine 一失败，
      // 彩蛋图鉴的入口整块消失。真正的调用点已移到 onLoad / onShow（见 recordRelics 注释）。
      // 我的心愿条数彩蛋：门槛（几条算数）在注册表里，页面只报事实
      this.fireWishCountEgg(summary.total)
    } catch (e) {
      // ⚠️ 2026-09-20 修：这里此前只重置 `myHidden`，**额度一个字都不动** ——
      // 于是 mine 读取失败时界面停在默认值「今日还可写 5 条」。而用户可能已经写满 5 条，
      // 那句话是替服务端打包票的假事实（真正被拒要等到点发送那一刻）。
      // 现在如实标记"额度未知"，UI 只说事实（见 WXML 的 quota.unknown 分支）。
      // ⚠️ P1-5（2026-09-21）：同时落 `mineError`，让「我的心愿」说"没读到"而不是"你没写过"。
      // `errMsg` 优先（wx.cloud 的失败形态）、其次 `message`（普通 Error），最后才是兜底话 ——
      // 失败原因不许被吞成一句空话（吞掉就分不清"网络挂了"与"代码坏了"）。
      this.setData({
        myHidden: 0,
        mineLoading: false,
        mineError: (e && (e.errMsg || e.message)) || '加载失败',
        quota: Object.assign({}, this.data.quota, { unknown: true })
      })
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
   *
   * ⚠️ 2026-09-21（P2-9）：读的是**纯本地**数据（`easterEgg.getProgress()` 走
   * `wx.getStorageSync`，一次云调用都没有），所以它**不该依赖任何云调用的成败**。
   * 此前唯一的调用点在 `loadMine` 的**成功分支**，于是 mine 读失败时：
   * 彩蛋照常在进页时被拾到、进度也写进了本地，入口却整块消失 —— 用户找不到刚拿到的东西。
   * 现在由 `onLoad` 与 `onShow` 无条件各算一次（幂等：进度没变就直接 return，不产生 setData）。
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

  /** 点弹幕 → 短暂停住高亮 + 展开愿签（B 站式点弹幕反馈；笺看得住） */
  openWishCard(e) {
    const id = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    if (!id) return
    this.setData({ heldDmId: id })
    try { wx.vibrateShort({ type: 'light' }) } catch (err) { /* ignore */ }
    if (this._heldDmTimer) clearTimeout(this._heldDmTimer)
    this._heldDmTimer = setTimeout(() => {
      this._heldDmTimer = null
      if (this.data.heldDmId === id) this.setData({ heldDmId: '' })
    }, 560)
    const src = (this._mineRows || []).concat(this._wallItems || [])
    const hit = src.find((it) => String(it._id) === id)
    if (!hit) return
    this.setData({ card: Object.assign({}, hit) })
  },

  closeWishCard() {
    if (!this.data.card) return
    this.setData({ card: null })
  },

  /**
   * 抄一句：把别人的心愿填进输入框（仍可改，不直接发布）。
   *
   * ⚠️ 2026-09-22 接线（R2）：`<wall-feed>` 的详情层也有「抄一句」，它 `triggerEvent('borrowwish',
   * {id,text})` 把正文交回页面（组件不碰输入框、不碰云）。这里让本方法同时吃两种来源：
   *   · 页面自己的心愿笺（弹幕墙那一路）→ 从 `this.data.card` 取；
   *   · 组件的 `borrowwish` → 事件里已经带着正文，直接用它。
   * 这样「抄一句」的截断/计数/滚动/聚焦**只有一条实现**（不给组件里再写一份输入框逻辑）。
   * 页面自己的 `card` 收尾时清掉 —— 组件的详情层与页面的愿签笺不会叠在一起。
   */
  borrowWishText(e) {
    const fromEvent = e && e.detail && typeof e.detail.text === 'string' ? e.detail.text : ''
    const card = this.data.card
    const source = fromEvent || (card ? card.text : '')
    if (!source) return
    // 按「字」安全截断（P0：`.slice(0, TEXT_MAX)` 会截出半个代理对）
    const draft = wishTextTruncate(normalizeWishText(source), TEXT_MAX)
    this.setData({ draft, draftCount: wishTextCount(draft), card: null })
    // 2026-09-20 改造：这里原来只弹一句「已填进输入框，可再改」——
    // 而输入框在视口上方（愿签列表在写愿区之下），toast 在说一件用户看不到的事。
    // 现在把它滚进视野并聚焦：说了什么，就让人看到什么。
    try {
      wx.pageScrollTo({ selector: '#wishInput', duration: 260, fail: () => {} })
    } catch (e) { /* 低版本基础库不支持 selector，忽略 */ }
    this.focusWishInput(300)
  },

  copyWishText() {
    const card = this.data.card
    if (!card) return
    wx.setClipboardData({
      data: normalizeWishText(card.text),
      success: () => wx.showToast({ title: '已复制', icon: 'none' })
    })
  },

  /* ── 愿签内容流组件（<wall-feed>）的事件落点（PRD v1.4 §11.1 R2）──────────────
     组件是"属性进 / 事件出"的：它自己持有视图态与详情层，**不发任何云调用**；
     需要数据或写操作时只 `triggerEvent`，由页面接回**既有的**方法与既有状态位。
     三个"不许"（破了就是两种实现各说各话）：
       ① 不许在事件里复制一份取数逻辑 —— 一律调本页已有的 refresh / loadMine；
       ② 不许把云调用搬进组件（`callFn` 只在本文件里）；
       ③ 不许让页面的愿签笺（.ww-card，服务弹幕墙那一路）与组件的详情层同时打开。 */

  /** 两栏切换：组件发的是 `{view}`，本页既有 `switchView` 吃的是 dataset.mode —— 适配一层 */
  onFeedSwitchView(e) {
    const view = String((e && e.detail && e.detail.view) || '')
    this.switchView({ currentTarget: { dataset: { mode: view } } })
  },

  /**
   * 「加载更多」：组件本地展开完且 `hasMore` 时才会发（本页 C 端一次取回 30 条，
   * 所以 `has-more=false` → 通常不会触发；接线是为了契约完整，不是死路）。
   * 页面侧不新增服务端分页契约：仍然走 refresh / loadMine 重取当前视图的数据源。
   */
  onFeedLoadMore(e) {
    const view = String((e && e.detail && e.detail.view) || '')
    if (view === 'mine') this.loadMine()
    else this.refresh()
  },

  /** 墙列表失败（含"加载更多失败"）→ 页面 refresh（`refresh` 自带 allowed 与 error 口径） */
  onFeedRetry() {
    this.refresh()
  },

  /** 「我的心愿」失败 → 页面 loadMine（P1-5 的两个状态位由页面维护） */
  onFeedRetryMine() {
    this.loadMine()
  },

  /**
   * 点开一张愿签：**详情层由组件自己承载**（组件契约：`openwish` 的同时它自己打开详情层，
   * 见 `components/WallFeed/index.js` 的 `onOpen`）。
   * 所以页面**不能**再打开自己的 `.ww-card` —— 两层 fixed 叠在一起（组件 z-index 60 >
   * 页面 41），关掉上面那层会露出下面那张纸。页面自己的愿签笺仍然服务**弹幕墙**那一路
   * （`bindtap="openWishCard"`），这里只保证两条路不会叠。
   */
  onFeedOpenWish() {
    if (this.data.card) this.setData({ card: null })
  },

  /** 组件详情收起：页面侧没有对应状态要改（页面愿签笺只服务弹幕墙），保留事件落点以便同步 */
  onFeedCloseWish() {
    if (this.data.card) this.setData({ card: null })
  },

  /**
   * 组件详情「抄一句」→ 复用页面既有的 `borrowWishText`（它吃 `e.detail.text`，
   * 见那里的说明）。组件不碰输入框，落点只有一个。
   */
  onFeedBorrowWish(e) {
    const text = String((e && e.detail && e.detail.text) || '')
    if (!text) return
    this.borrowWishText({ detail: { text } })
  },

  /**
   * 转发入口（两条链路，2026-09-27 玩法回到墙上弹层后）。
   *
   * A. 愿签卡上的「祈一份」 → 分享的是**愿签正文**（`card.text`）。
   * B. 玩法弹层的「分享这份结果」 → 弹层本体在按钮 bindtap 里抛 `share`（detail.title = `result.share`），
   *    `onPlaySheetShare` 记到实例字段 `_playShare`；这里**先**判它、读到即清，
   *    命中就直接返回 —— 该分支结构上不接触 `card`，不会把玩法分享串成愿签文案。
   */
  onShareAppMessage() {
    const path = `/subpackages/feature/wish-wall/index?productKey=${encodeURIComponent(this.data.productKey)}`
    // 玩法弹层的「分享这份结果」：只用弹层递来的 result.share（一次性，读到即清）
    const playShare = this._playShare
    this._playShare = null
    if (playShare && playShare.title) return { title: playShare.title, path }
    const card = this.data.card
    const text = card ? normalizeWishText(card.text) : ''
    const ex = this.data.exhibit
    // 墙本身的分享卡带出展品（与墙头展签 / 入口组件同一句）；有实物图就当封面
    const share = {
      title: text || (ex && ex.line ? ex.line : '马上有 · 祈福墙'),
      path
    }
    if (!text && ex && ex.cover) share.imageUrl = ex.cover
    return share
  },

  /* ----------------------------- 发布 ----------------------------- */

  onDraftInput(e) {
    // 输入框给什么就存什么（原生 maxlength 已在 WXML 侧取消，见那里的注释）：
    // 截断只走 wishTextTruncate —— 按「字」，绝不切出半个代理对 / 半个 ZWJ 序列。
    const draft = wishTextTruncate(String((e.detail && e.detail.value) || ''), TEXT_MAX)
    this.setData({ draft, draftCount: wishTextCount(draft) })
  },

  /**
   * 灵感 chip：点一下填进输入框（不直接发布，用户仍可改）。
   *
   * 2026-09-20 改造：灵感词从页面下方（灯/木鱼/玩法之后）搬到发送条正下方，所以
   * **不再需要滚动**（离线版式实测：改造前它距发送条 586px、整块在首屏之外）。
   * 剩下必须补的是**聚焦**——它是"输入框收到了"最直接的反馈；此前这个函数只改 draft，
   * 用户看到的唯一变化是远处一个数字跳了一下，真机反馈就是「点了像没反应」。
   */
  useInspiration(e) {
    const text = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.text) || '')
    if (!text) return
    const draft = wishTextTruncate(normalizeWishText(text), TEXT_MAX)
    this.setData({ draft, draftCount: wishTextCount(draft) })
    this.focusWishInput(60)
  },

  /**
   * 落愿（唯一的写入实现）。
   *
   * ⚠️ 2026-09-21（P2-8）：本方法现在**返回布尔**（真的挂上墙 = true；被拦/被拒/异常 = false）。
   * 为什么必须回值：注册续发那条路要用**真实结果**决定漏斗终点发什么 step ——
   * 原来 `onRegisterSuccess` 在 `submitWish` 之前就把 `resume_success` 发出去了，
   * 续发失败（toast 之后什么都不回滚）也被记成"注册完成并自动续发"，
   * 于是 ERP 的注册→落愿转化率**系统性偏高**。返回值是这条判据唯一的真值来源。
   *
   * `_submitting` 锁住门禁那段 await：`posting` 要等门禁读完会话才置真，此前这段时间里连点两下
   * （或键盘「发送」+ 按钮各一下）会发出两次 post。门禁一过 `posting` 同步接手。
   */
  async submitWish() {
    if (this.data.posting || this._submitting) return false
    if (!this.data.allowed) {
      toastWishWallClosed()
      return false
    }
    // 额度用完就地拦住，并**用服务端同一句口径**说明（服务端仍会独立判定，这里只是别让人白写）
    if (this.data.quota && this.data.quota.exhausted) {
      wx.showToast({
        title: `今天已许愿 ${this.data.quota.cap} 次，明天再来`,
        icon: 'none',
        duration: 2500
      })
      return false
    }
    const checked = validateWishText(this.data.draft)
    if (!checked.ok) {
      wx.showToast({ title: checked.msg, icon: 'none' })
      return false
    }
    // 注册转化钩子（2026-09-18 产品口径：祈福墙是**注册转化路径**，对齐 AI 识别）：
    // 浏览与仪式免费（价值先行），**落愿这一步才要身份** —— 心愿挂在谁名下、以后回看谁的心愿，
    // 都需要账号。未注册时就地弹注册（不让用户跳走），注册成功后**自动续发这条心愿**。
    // `_resumeAfterRegister`：刚注册完的这次续发**跳过门禁**（否则会话还没刷新 → 又弹一次，死循环）。
    const resumingAfterRegister = !!this._resumeAfterRegister
    this._resumeAfterRegister = false
    // isGuestUser 自己吞掉异常（fail-open），这把锁不会漏放
    this._submitting = true
    if (!resumingAfterRegister && await this.isGuestUser()) {
      this._submitting = false
      this._pendingWish = checked.text
      trackBehavior('wish_wall_register_gate', 'wish_wall', this.data.productKey, { step: 'show' })
      this.setData({ showRegisterDialog: true })
      return false
    }
    this._submitting = false
    // 落愿闭环（2026-09-27 改为**先落地、后确认**）：点下去这一刻心愿就插到墙首、弹幕立即接住、高亮，
    // 不再干等云函数往返（"挂上…"那 0.3–1s 是全链路最后一段空等）。
    // 云函数说没挂上 / 调用抛错 → 撤回这条、额度还原、**草稿原样还给挂签台**（不白写）。
    // 挂签台「成」、震动、墙上回声只在确认之后给：它们说的是"已经挂上了"，不能先说。
    const before = { items: this._wallItems || [], quota: this.data.quota }
    const fresh = {
      _id: `local-${Date.now()}`,
      text: checked.text,
      nickname: '我',
      avatar: '',
      pinned: false,
      official: false,
      isMine: true,
      isFresh: true,
      timeText: '刚刚'
    }
    const localId = fresh._id
    this._wallItems = [fresh].concat(before.items)
    this.setData({
      posting: true,
      draft: '',
      // 草稿清空 → 字数展示必须一起归零（否则输入框空了、右边还写着「12/30」）
      draftCount: 0,
      freshId: fresh._id,
      // ⚠️ 2026-09-20 修（子代理行为复核抓到）：乐观插入墙上数据之后**必须同步 wallCount**。
      // 否则"空墙写下第一条"时：墙上已经有一条（rows 也重建了、页脚照样渲染），
      // 但页脚文案与分段条数读的是 wallCount = 0 → 显示「0 条心愿正在墙上流动」，
      // 而如果随后的 refresh 回包失败，这个 0 会一直留着（又是一条与画面不符的假事实）。
      wallCount: this._wallItems.length,
      // 组件读的是 wallItems / wallCapped（与 wallCount 同一口径：只描述**墙**）
      wallItems: this._wallItems,
      wallCapped: isTagListCapped(this._wallItems.length),
      // 额度即时递减（诚实：以本地事实为准，服务端刷新会再校准；撤回时还原）
      quota: Object.assign({}, this.data.quota, {
        used: (this.data.quota.used || 0) + 1,
        left: Math.max(0, (this.data.quota.left || 0) - 1),
        exhausted: (this.data.quota.used || 0) + 1 >= (this.data.quota.cap || DAILY_LIMIT)
      })
    })
    if (this.data.viewMode === 'wall') this.applyView()
    this.setData({ rows: buildDanmakuRows(this._wallItems, { cycle: (this.data.danmakuCycle || 0) + 1, boostId: fresh._id }) })
    this.scheduleDanmakuCycle(this.data.rows)
    this.scheduleFreshClear()
    let result = null
    try {
      result = await this.callFn({
        action: 'post',
        productKey: this.data.productKey,
        productId: this.data.productId,
        text: checked.text
      })
    } catch (e) {
      console.error('wish wall post', e)
      result = { success: false, msg: (e && e.errMsg) || '' }
    }
    if (!result || !result.success) {
      this.unlandWish(localId, before, checked.text)
      wx.showToast({ title: (result && result.msg) || '发布失败', icon: 'none', duration: 2500 })
      return false
    }
    // 确认：本地那条换成服务端 _id（弹幕行只换 id、不换 key —— 换 key 会让正在飘的这条重播）
    fresh._id = String(result._id || localId)
    if (result.nickname) fresh.nickname = result.nickname
    this.setData({
      posting: false,
      freshId: fresh._id,
      deskPosted: true,
      wallItems: this._wallItems,
      rows: (this.data.rows || []).map((r) => (r && r.id === localId ? Object.assign({}, r, { id: fresh._id }) : r))
    })
    if (this._deskPostedTimer) clearTimeout(this._deskPostedTimer)
    this._deskPostedTimer = setTimeout(() => {
      this._deskPostedTimer = null
      if (this.data.deskPosted) this.setData({ deskPosted: false })
    }, ritualFeedback.ECHO_HOLD_MS)
    // 反馈只留墙内这一组（弹幕落签 + 挂签台「成」+ 回声），不再叠一个遮住墙面的原生 toast
    try { wx.vibrateShort({ type: 'light' }) } catch (e) { /* ignore */ }
    // 即时反馈：落愿是主转化动作，墙上也要回一声（附"今日还可写 N 条"，顺带说清额度）
    this.pushEcho('wish')
    // ⚠️ P1-3（2026-09-21）：漏斗终点必须与 PRD §7.1 和 ERP 监测表**同一口径**。
    // 签名是 `trackBehavior(action, targetType, targetId, extra)` —— 原来写的是
    // `('wish_wall_post', 'ok', '1')`，即 targetType='ok'、**targetId='1'**；
    // 而监测表按 `String(ev.targetId) === 'ok'` 过滤（admin/src/utils/wishWallMonitor.js 的
    // `post` 行 + `sources[].post`），于是「落愿成功（上墙）」这一行与按来源转化率**恒为 0**。
    // 两个都写 'ok'：既满足事件 schema 声明的 targetType='ok'，也让 targetId 落在报表口径上。
    trackBehavior('wish_wall_post', 'ok', 'ok')
    // 已经挂上了：之后的列表对齐失败只影响"墙上是不是最新"，不许再报「发布失败」、不许让续发记成失败
    try {
      await this.refresh()
    } catch (e) {
      console.warn('wish wall refresh after post', e)
    }
    this.fireWishEgg()
    return true
  },

  /** 乐观落地的撤回：墙、弹幕、额度回到提交前，草稿还给挂签台 */
  unlandWish(localId, before, text) {
    this._wallItems = (this._wallItems || []).filter((it) => it && it._id !== localId)
    this.clearFreshTimer()
    this.setData({
      posting: false,
      draft: text,
      draftCount: wishTextCount(text),
      freshId: '',
      wallCount: this._wallItems.length,
      wallItems: this._wallItems,
      wallCapped: isTagListCapped(this._wallItems.length),
      quota: before.quota,
      rows: (this.data.rows || []).filter((r) => r && r.id !== localId)
    })
    if (this.data.viewMode === 'wall') this.applyView()
  },

  /**
   * 弹层挂签条「挂上墙」：一步落愿。走本页唯一的 submitWish（门禁 / 额度 / 云函数同一条路），
   * 先把这句放进挂签台 —— 被注册门禁拦下、发布失败时草稿就留在挂签台上，不白写。
   * 滚到墙面：落愿的主反馈（弹幕落签 + 挂签台「成」）都在这一屏里。
   */
  onPlaySheetPost(e) {
    if (!this.data.allowed) return
    const draft = wishTextTruncate(String((e && e.detail && e.detail.text) || ''), TEXT_MAX)
    if (!draft) return
    this.setData({ draft, draftCount: wishTextCount(draft) })
    try {
      wx.pageScrollTo({ selector: '.ww-wall', duration: 260, fail: () => {} })
    } catch (err) { /* 低版本基础库不支持 selector，忽略 */ }
    return this.submitWish()
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

  /**
   * 原地注册成功：① 把已有仪式进展**存上云** ② 刷新会话态 ③ 把刚才那条心愿**自动续发**。
   *
   * ⚠️ P1-2（2026-09-21）：PRD §6 原文「注册后必须立刻发生三件事（**缺一条这个钩子就白做**）」，
   * ①就是"把已有进展存上云"（"你的记录不会丢了"是用户能感知的回报）。此前这条主路径
   * **从不写云** —— `syncRitualToCloud()` 只在 H1 钩子（开关默认关）与 H2 功德证（已停用）里被调，
   * 而读那半边（`restoreRitualFromCloud`）在 onLoad 无条件跑：于是"换机不丢"在续发这条主路径上
   * 只成立一半（云端可能压根没有这份档案）。
   * 这里**fire-and-forget**：不 await、不把它并进续发的成败判定 —— 同步失败不得影响续发那条心愿
   * （续发的真值只由 `submitWish` 的返回值决定，见 P2-8）。
   *
   * ⚠️ P2-8（2026-09-21）：漏斗终点 `resume_success` **挪到续发成功之后**。
   * 原来它在方法开头、`submitWish` 之前就发，续发失败也被记成"注册完成并自动续发"，
   * 报表的注册→落愿转化率因此偏高。现在按 `submitWish` 的**真实结果**分 step：
   * 成功 `resume_success`，失败 `fail_resume`（沿用既有 `fail_*` 前缀，报表侧的「注册未完成」
   * 行就是按 `stepPrefix: 'fail_'` 归并的，不必改报表）。
   */
  async onRegisterSuccess() {
    this.setData({ showRegisterDialog: false, justRegistered: true })
    // ① PRD §6①：注册后立刻把已有连灯/功德存上云。fire-and-forget —— 失败静默降级，
    //    绝不影响下面那条心愿的续发（本页的既有纪律：降级不得影响主功能）。
    Promise.resolve(this.syncRitualToCloud()).catch(() => {})
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
    this.setData({ draft: text, draftCount: wishTextCount(text) })
    await this.resumeWishAfterRegister()
  },

  /**
   * 注册后的续发 + 漏斗终点（**唯一**发 `resume_success` 的地方，2026-09-21 · P2-8）。
   *
   * 为什么要单独一个方法而不是内联在 `onRegisterSuccess` 里：终点必须等 `submitWish`
   * 的**真实结果**，所以这里必须是 `await`；而 `submitWish` 的返回值同时也要能被单测直接驱动
   * （见 test-wish-wall 的注册续发行为断言）。抽出来也让"发什么 step"只有一处事实源。
   */
  async resumeWishAfterRegister() {
    const ok = await this.submitWish()
    // 续发失败不能说成成功：报表把这一步当"注册完成并自动续发"的终点，
    // 而失败只 toast、不回滚草稿 —— 只有真值才能决定终点。
    // ⚠️ 走 `trackRitualGate`（而不是直接 `trackBehavior`）：`wish_ritual_gate` 之外的
    // action 名只在这里出现一次是本页的既定口径（改名漏一处就多一条恒 0 的漏斗），
    // 落愿门禁这条漏斗同理，收口在 `trackRitualGate` 一处。
    this.trackRitualGate(ok === true ? 'resume_success' : 'fail_resume')
    return ok === true
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
   * 钩子话术 = 「注册后连续记录存云端，不会丢」（**不含断签提醒** —— 提醒需要订阅消息，
   * 本仓没有实现，见 P2-11 与 buildRitualGateDesc 的说明；不再承诺做不到的事）。
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
      const ritualProfile = require('../utils/ritualProfile')
      if (!ritualProfile || typeof ritualProfile.syncToCloud !== 'function') return false
      const res = await ritualProfile.syncToCloud()
      /*
       * ⚠️ 2026-09-20 修（P0 · 本函数此前**恒返回 false**）：
       * 原来写的是 `return res === true`，而 `utils/ritualProfile.syncToCloud()` 的
       * **每一条 return 都返回对象**（`{ ok, degraded, profile }`，见该文件 141 行的 JSDoc）
       * —— `object === true` 恒为 false。真实后果三条：
       *   ① 用户即使同步成功，也被告知「记录仍在本机 / 云端暂不可用」（说的是假话）；
       *   ② `resume_success` 这个漏斗终点**永远是 0**，PRD §7 的注册转化率一直测不出来；
       *   ③ `_certSyncedCount` 永不写入 → 每次 onHide / onUnload 都重复写一次云。
       * 为什么此前没被发现：所有单测都把 `page.syncRitualToCloud` 整个桩掉了，
       * 源码级断言只查"调用了 syncToCloud"——**桩住被测对象等于把这条链路的真值遮住**。
       * 现在按真形态取 `ok`，并保留布尔兼容（万一将来有实现真的返回布尔）。
       */
      if (res && typeof res === 'object') return res.ok === true
      return res === true
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
