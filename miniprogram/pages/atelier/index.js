// pages/atelier/index.js — 主包 Tab 壳：标本工坊
//
// 需求（2026-09-16）：工坊新增「AI 标本鉴定」入口，开关沿用 `showAiIdentify`；
// 功能展示改为**宫格**；默认四格 = 礼赠 / 定制 / 鉴定 / 伴宠。
//
// 为什么把四格抽成模块级 FEATURES + 运行时 buildTiles()：
//   1. 原实现把「序号」写成 `{{showGift ? '02' : '01'}}` 这类嵌套三元 ——
//      任何一格开关变化，后面所有编号都会跟着漂移（01/02/03 不再对应同一个功能）；
//   2. 四格各有各的守卫、跳转与埋点，散在 WXML 里必然重复四遍；
//   3. 宫格布局要求同一份数据既驱动渲染也驱动守卫，单一真源最省心。
// 现在编号按**固定顺序**分配（01 礼赠 / 02 定制 / 03 鉴定 / 04 伴宠），
// 某一格关闭只是不渲染，其余编号不变。
const { trackBehavior } = require('../../utils/trackBehavior')
const { xingchenCover } = require('../../config/storeMediaCdn')
const {
  fetchContentDisplayFlags,
  toastSpecimenCustomClosed,
  toastPetMemorialClosed,
  toastGiftClosed,
  toastAiIdentifyClosed
} = require('../../utils/contentDisplayFlags')

/**
 * 工坊四功能（固定顺序 = 宫格编号顺序）。
 *
 * flag 口径与 getContentDisplayFlags 对齐：
 *   showGift / showSpecimenCustom = `=== true`（缺配置默认**关**）
 *   showAiIdentify / showPetMemorial = `!== false`（现网已开放，缺配置默认**开**）
 */
const FEATURES = [
  {
    key: 'gift',
    no: '01',
    overline: 'GIFT',
    title: '礼赠',
    desc: '取一件山海封笺赠予，先备妥再请 TA 留下去处',
    flag: 'showGift',
    defaultOn: false,
    toast: 'gift',
    url: '/subpackages/feature/gift/hub/index?from=atelier',
    track: { action: 'gift_entry_click', type: 'from', value: 'atelier' },
    failTitle: '无法打开礼赠'
  },
  {
    key: 'custom',
    no: '02',
    overline: 'SPECIMEN CUSTOM',
    title: '标本定制',
    desc: '从馆藏选型，配框配盒写卡片，线上下单',
    flag: 'showSpecimenCustom',
    defaultOn: false,
    toast: 'custom',
    url: '/subpackages/feature/custom/index?from=hub',
    track: { action: 'custom_hub_select', type: 'type', value: 'standard' },
    failTitle: '无法打开定制'
  },
  {
    key: 'identify',
    no: '03',
    overline: 'AI IDENTIFY',
    title: 'AI 鉴定',
    desc: '拍一张照片，识别物种并生成收藏图鉴',
    flag: 'showAiIdentify',
    defaultOn: true,
    toast: 'identify',
    // from=atelier 会被鉴定页自己的 identify_entry_click 读走 →
    // **此处刻意不再补一条同事件**，否则同一次点击会被计两次
    url: '/subpackages/feature/identify/index?from=atelier',
    track: null,
    failTitle: '无法打开鉴定'
  },
  {
    key: 'pet',
    no: '04',
    overline: 'PET MEMORIAL',
    title: '伴宠记忆',
    desc: '为已逝伙伴申请纪念藏品，专员评估工艺与周期',
    flag: 'showPetMemorial',
    defaultOn: true,
    toast: 'pet',
    highlight: true,
    url: '/subpackages/feature/custom/pet/index?from=hub',
    track: { action: 'custom_hub_select', type: 'type', value: 'pet' },
    failTitle: '无法打开伴宠记忆'
  }
]

/** 工坊开场文案：按**实际开放**的功能说人话，不再用嵌套三元枚举组合 */
function buildIntroText(openKeys) {
  const names = FEATURES.filter((f) => openKeys.indexOf(f.key) !== -1).map((f) => f.title)
  if (!names.length) return '工坊服务逐步开放，敬请留意。'
  const lead = names.length === FEATURES.length ? '四条路径都在' : '当前开放'
  return `${lead}：${names.join('、')}。定制即时选配；鉴定即拍即知；伴宠记忆需专员评估后承接。`
}

/** 按开关算出要渲染的宫格（编号固定，不受可见性影响） */
function buildTiles(flags) {
  const src = flags || {}
  return FEATURES.filter((f) => (f.defaultOn ? src[f.flag] !== false : src[f.flag] === true)).map((f) => ({
    key: f.key,
    no: f.no,
    overline: f.overline,
    title: f.title,
    desc: f.desc,
    highlight: !!f.highlight
  }))
}

function openKeysOf(flags) {
  const src = flags || {}
  return FEATURES.filter((f) => (f.defaultOn ? src[f.flag] !== false : src[f.flag] === true)).map((f) => f.key)
}

Page({
  data: {
    heroImage: xingchenCover,
    showSpecimenCustom: false,
    showPetMemorial: true,
    showGift: false,
    // 需求：AI 鉴定入口随 showAiIdentify 开关；现网已开放 → 缺配置默认开
    showAiIdentify: true,
    tiles: [],
    introText: ''
  },

  onLoad(options) {
    trackBehavior('custom_hub_enter', 'from', (options && options.from) || 'tab')
    try {
      const { getCachedContentDisplayFlags } = require('../../utils/contentDisplayFlags')
      const cached = getCachedContentDisplayFlags()
      if (cached && cached.flags) this.applyFlags(cached.flags)
    } catch (e) { /* ignore */ }
    this.loadDisplayFlags()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
    this.loadDisplayFlags()
  },

  /** 一处把 flags 落到 data（三处调用点共用，避免某个字段被漏掉） */
  applyFlags(flags) {
    const f = flags || {}
    this.setData({
      showSpecimenCustom: f.showSpecimenCustom === true,
      showPetMemorial: f.showPetMemorial !== false,
      showGift: f.showGift === true,
      showAiIdentify: f.showAiIdentify !== false,
      tiles: buildTiles(f),
      introText: buildIntroText(openKeysOf(f))
    })
  },

  async loadDisplayFlags() {
    if (this._displayFlagsLoading) return
    this._displayFlagsLoading = true
    try {
      const { flags } = await fetchContentDisplayFlags({
        onUpdate: (payload) => {
          if (!payload || !payload.flags) return
          this.applyFlags(payload.flags)
        }
      })
      this.applyFlags(flags)
    } catch (e) {
      // 读不到开关 → 保守：只保留「现网已开放」的两项
      this.applyFlags({ showSpecimenCustom: false, showPetMemorial: true, showGift: false, showAiIdentify: true })
    } finally {
      this._displayFlagsLoading = false
    }
  },

  /** 宫格统一分发：一处守卫 + 一处埋点，避免四份重复逻辑各自漂移 */
  onFeatureTap(e) {
    const key = String((e.currentTarget.dataset && e.currentTarget.dataset.key) || '')
    const feature = FEATURES.find((f) => f.key === key)
    if (!feature) return
    wx.vibrateShort({ type: 'light' })
    if (!this.data[feature.flag]) {
      this.toastClosed(feature.toast)
      return
    }
    if (feature.track) {
      trackBehavior(feature.track.action, feature.track.type, feature.track.value)
    }
    wx.navigateTo({
      url: feature.url,
      fail: () => wx.showToast({ title: feature.failTitle, icon: 'none' })
    })
  },

  toastClosed(kind) {
    if (kind === 'gift') return toastGiftClosed()
    if (kind === 'custom') return toastSpecimenCustomClosed()
    if (kind === 'pet') return toastPetMemorialClosed()
    if (kind === 'identify') return toastAiIdentifyClosed()
    return undefined
  },

  goPetOrders() {
    if (!this.data.showPetMemorial) {
      toastPetMemorialClosed()
      return
    }
    wx.navigateTo({
      url: '/subpackages/feature/custom/pet/list/index?from=hub',
      fail: () => wx.showToast({ title: '无法打开工单', icon: 'none' })
    })
  },

  goCustomOrders() {
    if (!this.data.showSpecimenCustom) {
      toastSpecimenCustomClosed()
      return
    }
    wx.navigateTo({
      url: '/subpackages/feature/custom/orders/index?from=hub',
      fail: () => wx.showToast({ title: '无法打开订单', icon: 'none' })
    })
  }
})
