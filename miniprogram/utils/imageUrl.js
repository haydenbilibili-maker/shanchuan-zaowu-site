/**
 * 图片 URL 尺寸处理（列表缩略图）
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
 */

/** 列表卡片宽（rpx→px 约 480 内足够覆盖 2 列卡片） */
const THUMB_WIDTH_LIST = 480
/** 详情页大图 */
const THUMB_WIDTH_DETAIL = 750
/** 探测图宽度：越小越快，仅用于判定能力 */
const PROBE_WIDTH = 64

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

/** 给 URL 追加尺寸处理参数；非 http(s) / 已带参数 / 空值 原样返回 */
function appendThumbParam(url, width) {
  const u = String(url || '')
  if (!/^https?:\/\//i.test(u)) return u
  if (u.indexOf('imageMogr2') !== -1) return u
  const w = Number(width) > 0 ? Math.round(Number(width)) : THUMB_WIDTH_LIST
  // 临时链必带 query（?sign=...&t=...），故用 &；无 query 时用 ?
  const sep = u.indexOf('?') === -1 ? '?' : '&'
  return `${u}${sep}imageMogr2/thumbnail/${w}x`
}

/** 列表卡片用图（未确认能力时返回原图） */
function thumbUrl(url) {
  if (!isThumbUsable()) return String(url || '')
  return appendThumbParam(url, THUMB_WIDTH_LIST)
}

/** 详情/大图用图 */
function detailUrl(url) {
  if (!isThumbUsable()) return String(url || '')
  return appendThumbParam(url, THUMB_WIDTH_DETAIL)
}

/**
 * 用一张真实图片探测处理能力是否可用。
 * 由调用方在**首张图加载成功**后调用（此时 URL 已证明可达，再验带参数是否同样可达）。
 * @returns {Promise<boolean>} 探测后是否可用
 */
function probeSupport(sampleUrl) {
  if (state !== 'unknown') return Promise.resolve(state === 'supported')
  if (!flagEnabled) return Promise.resolve(false)
  if (!sampleUrl || !/^https?:\/\//i.test(String(sampleUrl))) return Promise.resolve(false)
  if (typeof wx === 'undefined' || typeof wx.getImageInfo !== 'function') {
    state = 'unsupported'
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    wx.getImageInfo({
      src: appendThumbParam(sampleUrl, PROBE_WIDTH),
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

module.exports = {
  THUMB_WIDTH_LIST,
  THUMB_WIDTH_DETAIL,
  PROBE_WIDTH,
  setThumbFlag,
  isThumbFlagEnabled,
  isThumbUsable,
  getState,
  appendThumbParam,
  thumbUrl,
  detailUrl,
  probeSupport,
  onImageError,
  __resetProbe
}
