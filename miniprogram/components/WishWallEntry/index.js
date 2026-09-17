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
    compact: { type: Boolean, value: false }
  },

  data: {
    visible: false,
    productKey: '',
    brandText: '',
    descText: ''
  },

  observers: {
    'enabled, product, brand, desc'(enabled, product, brand, desc) {
      const visible = enabled === true && isWishWallProduct(product)
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
