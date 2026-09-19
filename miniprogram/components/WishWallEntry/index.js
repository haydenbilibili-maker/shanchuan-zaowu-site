/**
 * 需求 28：「马上有」祈福墙 · **可复用入口组件**
 *
 * 为什么做成组件而不是留在详情页里的一小段 wxml：
 *   需求要求「为后续此入口的**全站拓展**做好长线预留」。入口的判定逻辑是
 *   「内容开关 开 **且** 当前藏品命中」，两处条件、两处会漂：
 *   详情页写一遍，下一个页面再抄一遍，早晚出现"开关关了但某个页面还亮着"。
 *   收成一个组件后，全站拓展 = 在新页面的 json 里注册 + 一行标签，判定只有一份。
 *
 * 组件只负责「是否显示 + 点进去」；**开关值仍由宿主页面传入**（`enabled`），
 * 因为开关是页面级 SWR 缓存的产物，组件自己再拉一次会多打一次云函数。
 */
const { isWishWallProduct, resolveWishWallKey, buildWishWallUrl, PRODUCT_KEY } = require('../../utils/wishWall')

/** 跑马灯：最多展示几条 / 至少几条才开（只 1 条会在循环里露空档） */
const MQ_MAX = 8
const MQ_MIN = 2

/**
 * 入口文案：显式传入优先，留空则按**这面墙**自动。
 *
 * 默认墙（`mashangyou`）才配得上「马上有」这个署名；别的墙用别人的商品名是错的，
 * 所以非默认墙不显示品牌署名，说明文案也不点名。
 * 纯函数，便于断言（组件内联判断在测试台里跑不起来）。
 */
function resolveCopy(productKey, brand, desc) {
  const key = String(productKey || '')
  const isDefault = !key || key === PRODUCT_KEY
  const brandText = String(brand == null ? '' : brand).trim() || (isDefault ? '马上有' : '')
  const descText =
    String(desc == null ? '' : desc).trim() ||
    (isDefault ? '把心愿挂上墙，让「马上有」替你记着' : '把心愿挂上墙，替自己记着')
  return { brandText, descText, isDefault }
}

Component({
  /**
   * 宿主可传类名控制外间距：入口从「藏品参数之后」搬到「主图正下方」后，
   * 上下间距由宿主页面决定（组件自己只管内容）。惯例同 components/NavBack 的 ext-class。
   */
  externalClasses: ['ext-class'],

  properties: {
    /** 宿主页面读到的 `content_display_flags.showMaShangYou` */
    enabled: { type: Boolean, value: false },
    /**
     * **默认墙入口**（2026-09-20）：首页这类**没有商品上下文**的页面用它。
     * 为什么不做成"不传 product 就默认显示"：那样任何页面**忘了传 product** 都会亮出入口，
     * 而入口是转化钩子 —— 宁可漏亮，不可错亮。所以要求宿主**显式**声明"我就是要默认墙"。
     */
    defaultWall: { type: Boolean, value: false },
    /** 藏品对象：优先读 `wishWallEnabled` / `wishWallKey`，标题子串只作过渡兜底 */
    product: { type: null, value: null },
    /** 来源标识，写进跳转 URL，供页面埋点区分入口 */
    from: { type: String, value: '' },
    /**
     * 品牌署名 / 说明文案：**留空 = 按这面墙自动**（见下方 resolveCopy）。
     * 多面墙之后「马上有」不再是唯一的墙 —— 把品牌写死在组件里，
     * 第二面墙的入口会写着别人的商品名，那是错的。
     */
    brand: { type: String, value: '' },
    title: { type: String, value: '祈福墙' },
    desc: { type: String, value: '' },
    /**
     * 紧凑单行版：主图正下方是"首屏最贵的一块地"，
     * 三行卡片会把价格卡挤出首屏 —— 故首屏位只用一行（灯 + 品牌 + 标题 + 箭头），不显示 desc。
     */
    compact: { type: Boolean, value: false },
    /**
     * **皮肤**：`paper`（默认，亮纸 + 铜字，祈福墙牌匾语言，详情页用）
     * / `parchment`（**羊皮纸**：同样保留纸的性格，但压暗一档 + 软投影 + 内嵌铜金细框，
     *   给首页这类**博物黑**页面用 —— 产品负责人口径："不是白信纸不好，是比较突兀、需要适配"）。
     *
     * 为什么必须是组件内变体、而不是让宿主页面覆盖：组件 json 没有 `styleIsolation`，
     * 默认 `isolated` → **页面样式进不来**（2026-09-20 实测确认）。故由宿主显式选皮肤。
     */
    tone: { type: String, value: 'paper' },
    /**
     * **跑马灯文案**：真实心愿文本，由宿主拉取后传入（首页用）。
     * ⚠️ 空数组 = 整行不渲染 —— **绝不编造**：宁可没有跑马灯，也不摆几条假心愿充场面
     * （本仓硬口径：不许编造社会证明）。
     */
    wishes: { type: Array, value: [] }
  },

  data: {
    visible: false,
    productKey: '',
    brandText: '',
    descText: '',
    /** 跑马灯条目：文案各两份 + 唯一 key → 平移 -50% 即无缝循环 */
    mqItems: [],
    mqDurationMs: 26000
  },

  observers: {
    'enabled, defaultWall, product, brand, desc'(enabled, defaultWall, product, brand, desc) {
      const visible = enabled === true && (defaultWall === true || isWishWallProduct(product))
      const productKey = visible ? resolveWishWallKey(product) : ''
      const copy = resolveCopy(productKey, brand, desc)
      if (
        visible !== this.data.visible ||
        productKey !== this.data.productKey ||
        copy.brandText !== this.data.brandText ||
        copy.descText !== this.data.descText
      ) {
        this.setData({ visible, productKey, brandText: copy.brandText, descText: copy.descText })
      }
    },
    /**
     * 跑马灯：清洗 + 限长 + 复制一份（无缝循环）。
     * 时长按内容长度换算，让"长文案跑得久"（与祈福墙页 danmakuDurationMs 同一意图）——
     * 固定时长会让短文案一闪而过、长文案挤成一团。
     */
    /**
     * 跑马灯：清洗 + 限长 + 复制一份（无缝循环）。
     * 入参支持两种：字符串，或 `{ text, emoji }` —— 首页会带 emoji（与祈福墙弹幕**同一套规则**，
     * 见 `utils/wishWall.danmakuEmoji`，不在这里另造一套）。
     */
    wishes(list) {
      const rows = (Array.isArray(list) ? list : [])
        .map((it) => {
          if (it && typeof it === 'object') {
            return { t: String(it.text == null ? '' : it.text).trim(), e: String(it.emoji || '') }
          }
          return { t: String(it == null ? '' : it).trim(), e: '' }
        })
        .filter((r) => r.t)
        .slice(0, MQ_MAX)
      const items = rows.length >= MQ_MIN
        ? rows.concat(rows).map((r, i) => ({ i, t: r.t, e: r.e }))
        : []
      const chars = rows.map((r) => r.t).join('').length
      const duration = Math.max(14000, Math.min(46000, 10000 + chars * 260))
      if (items.length !== this.data.mqItems.length) {
        this.setData({ mqItems: items, mqDurationMs: duration })
      } else if (duration !== this.data.mqDurationMs) {
        this.setData({ mqDurationMs: duration })
      }
    }
  },

  methods: {
    onTap() {
      if (!this.data.visible) return
      const url = buildWishWallUrl(this.data.product, { from: this.data.from || 'entry' })
      // 先抛事件再跳转：宿主可据此埋点/埋点失败也不影响跳转
      this.triggerEvent('enter', { productKey: this.data.productKey, url })
      wx.navigateTo({
        url,
        fail: () => wx.showToast({ title: '祈福墙暂不可用', icon: 'none' })
      })
    }
  }
})

// 供行为测试直接引用纯函数（组件运行时不会用到）
module.exports.resolveCopy = resolveCopy
