/**
 * 图片 URL 尺寸处理（列表缩略图 / 详情大图）
 *
 * 为什么需要（需求 17）：全仓**没有任何缩略图链路**（`grep imageMogr2|imageView2|thumbnail`
 * 零命中），列表卡片直接加载云存储原图。手机原图常见 4000×3000，首屏要下载十几张
 * 超大原图 —— 这是「小程序页面加载慢」最主要的单一来源。
 *
 * 依据（已核实，非猜测）：CloudBase 官方「云调用扩展」文档明确支持在**临时链接后
 * 拼接 `imageMogr2/thumbnail/<w>x`**，且临时链形如 `?sign=xxx&t=xxx`，故追加时用 `&`。
 * 见 https://docs.cloudbase.net/storage/extension
 *
 * ⚠️ 仍保留降级（工程审慎）：该能力依赖环境的图像处理扩展是否可用。
 * 处理策略是**不确定时不用**：
 *   1. 会话开始时状态为 `unknown` → 一律返回**原图**（首屏绝无破图风险）
 *   2. 首次成功加载带参数的小图 → `supported` → 之后全部使用缩略图
 *   3. 带参数加载失败 / 探测失败 → `unsupported` → 本次会话永久回落原图
 * 即：能力可用时立刻拿到带宽收益；不可用时行为与改动前**完全一致**。
 *
 * ── 2026-09-18 口径修正：宽度必须按**设备物理像素**算，不能按"两倍屏"写死 ──
 *
 * 原实现：`THUMB_WIDTH_DETAIL = 750`，注释写「750rpx ≈ 375 CSS px，750 恰好覆盖 **2 倍屏**」。
 * 问题：现代主流机型 DPR = **3**（iPhone 6 Plus 起；Android 2.75–3.5），iPad 满宽更是 1536 物理 px。
 * 满宽元素需要 `windowWidth × pixelRatio` 像素 —— 3 倍屏上是 **1170**，给它 750 等于
 * **把图放大 1.5 倍显示**，这正是"图片不够清晰"的直接来源。
 *
 * 现口径：
 *   · 详情大图 → `detailTargetWidth()`：`clamp(windowWidth × pixelRatio, 750, 1600)`，随设备自适应
 *   · 列表卡按**实测渲染宽度**分三档（不再一个 480 打天下）：
 *       rail 360（横滑小卡 100–110pt）/ mid 480（横向中卡 140pt）/ list 560（两列栅格 ≈170pt）
 *   · 统一附 `quality/90`（清晰优先；`thumbnail` 只按宽缩放、不变形，大比例缩小后偏软）
 */

/** 横滑小卡：详情「更多细节」/「相关推荐」200rpx、首页横滑卡 220rpx → 3 倍屏需 300–330 */
const THUMB_WIDTH_RAIL = 360
/** 横向中卡：首页「为你推荐」280rpx → 3 倍屏需 420 */
const THUMB_WIDTH_MID = 480
/** 两列栅格卡：ProductList `.col{flex:1}` ≈341rpx → 3 倍屏需 ≈511 */
const THUMB_WIDTH_LIST = 560
/** 详情大图下限：老 2 倍屏机型（320–375pt）够用 */
const DETAIL_MIN = 750
/** 详情大图上限：源图极少超过这个宽度，再要只是白花流量 */
const DETAIL_MAX = 1600
/** 探测图宽度：越小越快，仅用于判定能力 */
const PROBE_WIDTH = 64
/** JPEG 质量：清晰优先（默认质量约 85，且大比例缩小后更需要高质量兜住细节） */
const QUALITY = 90
/** 取不到设备信息时的兜底（与旧行为一致：375pt × 2） */
const FALLBACK_DPR = 2
const FALLBACK_VIEWPORT = 375

/** 会话状态：unknown（先用原图）| supported | unsupported */
let state = 'unknown'
let flagEnabled = true

/** 超管开关（content_display_flags.imageThumbEnabled，缺配置默认开） */
function setThumbFlag(enabled) {
  flagEnabled = enabled !== false
  if (!flagEnabled) state = 'unsupported'
}

function isThumbFlagEnabled() {
  return flagEnabled
}

/** 是否已确认可用（unknown 也算「不可用」——不确定时用原图） */
function isThumbUsable() {
  return flagEnabled && state === 'supported'
}

function getState() {
  return flagEnabled ? state : 'disabled'
}

/** 设备像素比（取不到按 2；这里**不缓存**：测试要能换桩设备） */
function devicePixelRatio() {
  try {
    if (typeof wx !== 'undefined' && wx) {
      if (typeof wx.getWindowInfo === 'function') {
        const info = wx.getWindowInfo() || {}
        const r = Number(info.pixelRatio)
        if (r > 0) return r
      }
      if (typeof wx.getSystemInfoSync === 'function') {
        const info = wx.getSystemInfoSync() || {}
        const r = Number(info.pixelRatio)
        if (r > 0) return r
      }
    }
  } catch (e) {
    /* 取不到就用兜底，绝不让"取设备信息失败"影响出图 */
  }
  return FALLBACK_DPR
}

/** 视口宽度（CSS px，取不到按 375） */
function viewportWidth() {
  try {
    if (typeof wx !== 'undefined' && wx) {
      if (typeof wx.getWindowInfo === 'function') {
        const w = Number((wx.getWindowInfo() || {}).windowWidth)
        if (w > 0) return w
      }
      if (typeof wx.getSystemInfoSync === 'function') {
        const w = Number((wx.getSystemInfoSync() || {}).windowWidth)
        if (w > 0) return w
      }
    }
  } catch (e) {
    /* 同上 */
  }
  return FALLBACK_VIEWPORT
}

/** 满宽元素需要的物理像素 = windowWidth × pixelRatio（rpx 与视口等比，故满宽即此值） */
function screenPhysicalWidth() {
  return Math.round(viewportWidth() * devicePixelRatio())
}

/** 详情大图目标宽度：随设备 DPR 自适应，并夹在 [DETAIL_MIN, DETAIL_MAX] 内 */
function detailTargetWidth() {
  const need = screenPhysicalWidth()
  if (!Number.isFinite(need) || need <= 0) return DETAIL_MIN
  return Math.min(DETAIL_MAX, Math.max(DETAIL_MIN, need))
}

/**
 * `cloud://<envId>.<bucket>/<path>` → `https://<bucket>.tcb.qcloud.la/<path>`
 *
 * 2026-09-17 实测（只读 CLI）：`tcb storage url products/cover_0_….png` 返回的临时访问地址就是
 * `https://636c-cloud1-8gnkty5bfff9f0bf-1387508856.tcb.qcloud.la/products/cover_0_….png`
 * —— **不带签名 query**，即云文件 ID 可以**纯字符串**换成这个 https 地址。
 *
 * 为什么要这一步：`<image src="cloud://…">` **不能**直接渲染（真机封面全空），而
 * `appendThumbParam` 只对 http(s) 生效（`!^https?:` 直接原样返回）→ 所以云文件 ID 必须先换 https，
 * 缩略参数才挂得上。换完还顺带解决两件事：**不过期**（不像 getTempFileURL 的临时链）、**少一次网络往返**。
 */
function cloudIdToHttps(fileID) {
  const s = String(fileID == null ? '' : fileID).trim()
  if (!s || s.indexOf('cloud://') !== 0) return s
  const rest = s.slice('cloud://'.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return s
  const host = rest.slice(0, slash)          // <envId>.<bucket>
  const path = rest.slice(slash + 1)
  const dot = host.indexOf('.')
  const bucket = dot === -1 ? '' : host.slice(dot + 1)
  if (!bucket || !path) return s
  return `https://${bucket}.tcb.qcloud.la/${path}`
}

/** 给 URL 追加尺寸与质量处理参数；非 http(s) / 已带参数 / 空值 原样返回 */
function appendThumbParam(url, width) {
  const u = String(url || '')
  if (!/^https?:\/\//i.test(u)) return u
  if (u.indexOf('imageMogr2') !== -1) return u
  const w = Number(width) > 0 ? Math.round(Number(width)) : THUMB_WIDTH_LIST
  // 临时链必带 query（?sign=...&t=...），故用 &；无 query 时用 ?
  const sep = u.indexOf('?') === -1 ? '?' : '&'
  // `>` = 只缩不放（Tencent CI 语义）：实测源图 1024px 时 `thumbnail/1600x` 会**放大**到 1600
  // 并多花 83% 字节，而 `1600x>` 稳定返回 1024×684（不放大）→ 所有槽位都必须带 `>`
  return `${u}${sep}imageMogr2/thumbnail/${w}x>/quality/${QUALITY}`
}

/**
 * 列表卡用图。**云文件 ID 一律先换 https**（否则 <image> 渲染不出来），
 * 未确认图像处理能力时不挂缩略参数（行为与改造前一致，但至少能显示）。
 * @param {string} url 原图（cloud:// 或 https）
 * @param {number} [width] 目标宽（物理 px）；不传用两列栅格档 560
 */
function thumbUrl(url, width) {
  const u = cloudIdToHttps(url)
  if (!isThumbUsable()) return u
  return appendThumbParam(u, width)
}

/** 横滑小卡用图（详情「更多细节」/「相关推荐」、首页横滑卡） */
function railUrl(url) {
  return thumbUrl(url, THUMB_WIDTH_RAIL)
}

/** 横向中卡用图（首页「为你推荐」） */
function midUrl(url) {
  return thumbUrl(url, THUMB_WIDTH_MID)
}

/** 详情/大图用图（宽度按设备 DPR 自适应；同上先换 https） */
function detailUrl(url) {
  const u = cloudIdToHttps(url)
  if (!isThumbUsable()) return u
  return appendThumbParam(u, detailTargetWidth())
}

/**
 * 用一张真实图片探测处理能力是否可用。
 * 由调用方在**首张图加载成功**后调用（此时 URL 已证明可达，再验带参数是否同样可达）。
 * @returns {Promise<boolean>} 探测后是否可用
 */
function probeSupport(sampleUrl) {
  if (state !== 'unknown') return Promise.resolve(state === 'supported')
  if (!flagEnabled) return Promise.resolve(false)
  const probeSrc = cloudIdToHttps(sampleUrl)
  if (!probeSrc || !/^https?:\/\//i.test(String(probeSrc))) return Promise.resolve(false)
  if (typeof wx === 'undefined' || typeof wx.getImageInfo !== 'function') {
    state = 'unsupported'
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    wx.getImageInfo({
      src: appendThumbParam(probeSrc, PROBE_WIDTH),
      success: () => {
        state = 'supported'
        resolve(true)
      },
      fail: () => {
        state = 'unsupported'
        console.warn('imageUrl: 环境不支持图片处理参数，本次会话回落原图（功能不受影响，仅无缩略图收益）')
        resolve(false)
      }
    })
  })
}

/**
 * 图片加载失败回调。未确认能力阶段（unknown）直接标记不可用，
 * 已确认阶段（supported）出现失败也回落，避免持续破图。
 */
function onImageError() {
  if (state !== 'unsupported') {
    state = 'unsupported'
    console.warn('imageUrl: 图片加载失败，回落原图')
  }
}

/** 仅供测试/诊断 */
function __resetProbe() {
  state = 'unknown'
  flagEnabled = true
}

/**
 * 商品/作品封面取值链：`images[0] → image → coverImage → cover → httpImage`。
 *
 * 为什么集中在这里（2026-09-17 真机反馈）：
 *   礼赠 hub 与标本师主页各自写了一套封面逻辑，一个把 `cloud://` 转临时链、失败后**丢成空串**
 *   （封面全空），另一个只认 `coverImage`。而实测这些商品的 `images[0]` 就是 `cloud://` 云文件 ID，
 *   本仓既有口径（首页 / 馆藏 ProductList）是**直接交给 <image>**（云文件 ID 可直接渲染、且不会过期），
 *   需要缩略时才用 thumbUrl()。这里把取值链收成一处，页面只管 `thumbUrl(firstImageOf(item))`。
 */
function firstImageOf(item) {
  if (!item) return ''
  const imgs = Array.isArray(item.images) ? item.images : []
  const candidates = [imgs[0], item.image, item.coverImage, item.cover, item.httpImage]
  for (const c of candidates) {
    const v = String(c == null ? '' : c).trim()
    if (v) return v
  }
  return ''
}

module.exports = {
  cloudIdToHttps,
  firstImageOf,
  THUMB_WIDTH_RAIL,
  THUMB_WIDTH_MID,
  THUMB_WIDTH_LIST,
  DETAIL_MIN,
  DETAIL_MAX,
  QUALITY,
  PROBE_WIDTH,
  devicePixelRatio,
  viewportWidth,
  screenPhysicalWidth,
  detailTargetWidth,
  setThumbFlag,
  isThumbFlagEnabled,
  isThumbUsable,
  getState,
  appendThumbParam,
  thumbUrl,
  railUrl,
  midUrl,
  detailUrl,
  probeSupport,
  onImageError,
  __resetProbe
}
