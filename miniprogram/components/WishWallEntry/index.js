// 「注记 X」长注释原文见 miniprogram/docs/源码注记_A流主包.md
/** 需求 28：「马上有」祈福墙 · **可复用入口组件**（注记 E1） */
const {
  isWishWallProduct,
  resolveWishWallKey,
  buildWishWallUrl,
  PRODUCT_KEY,
  normalizeWishText,
  TEXT_MAX,
  WISH_LABELS_V2,
  WISH_EXHIBIT_COVER
} = require('../../utils/wishWall')
const { exhibitFor } = require('../../config/wallExhibit')

/** 跑马灯：最多展示几条 / 至少几条才开（只 1 条会在循环里露空档） */
const MQ_MAX = 8
const MQ_MIN = 2

/** 入口文案：显式传入优先，留空则按**这面墙**自动。（注记 E2） */
function resolveCopy(productKey, brand, desc, hasProduct) {
  const key = String(productKey || '')
  const isDefault = !key || key === PRODUCT_KEY
  const brandText = String(brand == null ? '' : brand).trim() || (isDefault ? '马上有' : '')
  const explicit = String(desc == null ? '' : desc).trim()
  let descText = explicit
  const exhibit = exhibitFor(isDefault ? PRODUCT_KEY : key)
  if (!descText && exhibit && exhibit.line) descText = exhibit.line
  if (!descText) {
    if (hasProduct) {
      descText = '写一句心愿，再回来看这件藏品'
    } else {
      descText = isDefault
        ? '把心愿挂上墙，让「马上有」替你记着'
        : '把心愿挂上墙，替自己记着'
    }
  }
  return { brandText, descText, isDefault }
}

Component({
  /** 宿主可传类名控制外间距：入口从「藏品参数之后」搬到「主图正下方」后，（注记 E3） */
  externalClasses: ['ext-class'],

  properties: {
    /** 宿主页面读到的 `content_display_flags.showMaShangYou` */
    enabled: { type: Boolean, value: false },
    /** **默认墙入口**（2026-09-20）：首页这类**没有商品上下文**的页面用它。（注记 E4） */
    defaultWall: { type: Boolean, value: false },
    /** 藏品对象：优先读 `wishWallEnabled` / `wishWallKey`，标题子串只作过渡兜底 */
    product: { type: null, value: null },
    /** 来源标识，写进跳转 URL，供页面埋点区分入口 */
    from: { type: String, value: '' },
    /** 品牌署名 / 说明文案：**留空 = 按这面墙自动**（见下方 resolveCopy）。（注记 E5） */
    brand: { type: String, value: '' },
    title: { type: String, value: '祈福墙' },
    desc: { type: String, value: '' },
    /** 紧凑单行版：主图正下方是"首屏最贵的一块地"，（注记 E6） */
    compact: { type: Boolean, value: false },
    /** **皮肤**：`paper`（默认，亮纸 + 铜字，祈福墙牌匾语言，详情页用）（注记 E7） */
    tone: { type: String, value: 'paper' },
    /**
     * **跑马灯文案**：真实心愿文本，由宿主拉取后传入（首页用）。
     * ⚠️ 空数组 = 整行不渲染 —— **绝不编造**：宁可没有跑马灯，也不摆几条假心愿充场面
     * （注记 E8）
     */
    wishes: { type: Array, value: [] }
  },

  data: {
    visible: false,
    productKey: '',
    brandText: '',
    descText: '',
    /** 紧凑态下的回看暗示（有商品上下文才出） */
    productHint: '',
    /** 跑马灯条目：文案各两份 + 唯一 key → 平移 -50% 即无缝循环 */
    mqItems: [],
    mqDurationMs: 26000,
    /** 2026-10-13 心愿签卡（v2）：展品缩略 + 最新一句；false = 旧墨底 / 亮纸版（回退路径） */
    v2: WISH_LABELS_V2,
    cover: '',
    latest: ''
  },

  observers: {
    'enabled, defaultWall, product, brand, desc'(enabled, defaultWall, product, brand, desc) {
      const visible = enabled === true && (defaultWall === true || isWishWallProduct(product))
      const productKey = visible ? resolveWishWallKey(product) : ''
      const hasProduct = !!(product && (product._id || product.id))
      const copy = resolveCopy(productKey, brand, desc, hasProduct)
      const exhibit = visible ? exhibitFor(productKey) : null
      const productHint = exhibit && exhibit.line ? exhibit.line : (hasProduct ? '写愿后可回看本品' : '')
      if (
        visible !== this.data.visible ||
        productKey !== this.data.productKey ||
        copy.brandText !== this.data.brandText ||
        copy.descText !== this.data.descText ||
        productHint !== this.data.productHint
      ) {
        this.setData({
          visible,
          productKey,
          brandText: copy.brandText,
          descText: copy.descText,
          productHint
        })
      }
      // v2 缩略：默认墙用店内实拍常量；藏品墙用该藏品首图（读不到就不画图，不编造）
      const imgs = product && Array.isArray(product.images) ? product.images : []
      const cover = !visible ? '' : (productKey === PRODUCT_KEY ? WISH_EXHIBIT_COVER : String(imgs[0] || ''))
      if (cover !== this.data.cover) this.setData({ cover })
    },
    /** 跑马灯：清洗 + 限长 + 复制一份（无缝循环）。（注记 E9） */
    wishes(list) {
      const rows = (Array.isArray(list) ? list : [])
        .map((it) => {
          if (it && typeof it === 'object') {
            return { t: normalizeWishText(it.text), e: String(it.emoji || '') }
          }
          return { t: normalizeWishText(it), e: '' }
        })
        // 归一化后为空的行**必须丢掉**：`.trim()` 挡不住零宽字符（U+200B/前缀 BOM 等），
        // 这类"看不见的愿"单独一条就能凑满 MQ_MIN，跑马灯里会出现一个只有间隔、没有字的空位。
        .filter((r) => r.t)
        // 单条封顶 = **系统对一条心愿的上限**（`TEXT_MAX`，云函数同样拒收超长）。
        // 存量脏数据绕过校验时，一条超长文案会把"按长度换算时长"的匀速跑马灯拖成忽快忽慢。
        .map((r) => ({ t: r.t.slice(0, TEXT_MAX), e: r.e }))
        .slice(0, MQ_MAX)
      const items = rows.length >= MQ_MIN
        // v：墨底版错落明暗的档位，按「第几条心愿」取，第 i 条与第 i+n 条同档（回绕不跳）
        ? rows.concat(rows).map((r, i) => ({ i, t: r.t, e: r.e, v: (i % rows.length) % 3 }))
        : []
      const chars = rows.map((r) => r.t).join('').length
      const duration = Math.max(14000, Math.min(46000, 10000 + chars * 260))
      // 去重键按**内容**而不是条数：宿主下拉刷新后条数往往一模一样（墙上还是那几条），
      // 但文案可能已经被新愿替换 —— 只看长度会让跑马灯停在旧文案上。
      const signature = items.map((it) => `${it.t}\u0001${it.e}`).join('\u0002')
      // v2 只露最新一句（真实心愿；没有就不出这一句）
      const latest = rows.length ? rows[0].t : ''
      if (latest !== this.data.latest) this.setData({ latest })
      if (signature !== this._mqSignature) {
        this._mqSignature = signature
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
