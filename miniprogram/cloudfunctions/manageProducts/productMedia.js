/**
 * 商品视频 / 实况（Live）字段 `media` 的服务端净化（2026-09-28 产品点名「藏品库商品图片上传支持 Live/视频」）。
 *
 * 契约（向后兼容扩展）：
 *   - `images` 语义不变：**只放图片**，images[0] 仍是全站封面（列表/推荐/购物车/订单/分享卡都读它）；
 *   - 新增可选 `media: [{ type: 'video'|'live', url, poster, duration, width, height, size }]`，
 *     只有详情页主图轮播读它；没有该字段 / 空数组 = 与改动前完全一致。
 *   - 微信小程序拿不到原生 Live Photo（chooseMedia 只返回 image/video），
 *     `live` = 「短视频 + 封面帧」按实况方式展示（静音、循环、点按播放），见 miniprogram/docs/藏品视频与实况_2026-09-28.md。
 *
 * 客户端同口径副本：miniprogram/subpackages/manager/utils/productMedia.js（守卫 check:product-media 比对常量）。
 */

const MEDIA_TYPES = ['video', 'live']
const MAX_MEDIA = 3
const MAX_VIDEO_SECONDS = 60
const MAX_VIDEO_BYTES = 50 * 1024 * 1024
const VIDEO_EXT_RE = /\.(mp4|mov|m4v|3gp|avi|webm|mkv)(\?|#|$)/i

function isVideoUrl(url) {
  return VIDEO_EXT_RE.test(String(url || '').trim())
}

function isStoredMediaUrl(url) {
  const s = String(url || '').trim()
  return s.startsWith('cloud://') || s.startsWith('https://')
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 非法项直接丢弃（与 tags/blessTags 同口径：宁可不写，不写脏值） */
function sanitizeProductMedia(list) {
  if (!Array.isArray(list)) return []
  const out = []
  const seen = new Set()
  for (const raw of list) {
    if (out.length >= MAX_MEDIA) break
    if (!raw || typeof raw !== 'object') continue
    const type = MEDIA_TYPES.includes(raw.type) ? raw.type : ''
    const url = String(raw.url || '').trim()
    if (!type || !isStoredMediaUrl(url) || !isVideoUrl(url) || seen.has(url)) continue
    const poster = String(raw.poster || '').trim()
    const duration = Math.round(num(raw.duration) * 10) / 10
    if (duration > MAX_VIDEO_SECONDS + 1) continue
    const size = Math.floor(num(raw.size))
    if (size > MAX_VIDEO_BYTES) continue
    seen.add(url)
    out.push({
      type,
      url,
      poster: isStoredMediaUrl(poster) && !isVideoUrl(poster) ? poster : '',
      duration,
      width: Math.floor(num(raw.width)),
      height: Math.floor(num(raw.height)),
      size
    })
  }
  return out
}

/** images / coverImage 的防线：视频地址绝不能落进"图片"字段（全站把 images[0] 当封面图） */
function stripVideoUrls(images) {
  if (!Array.isArray(images)) return images
  return images.filter((u) => !isVideoUrl(u))
}

module.exports = {
  MEDIA_TYPES,
  MAX_MEDIA,
  MAX_VIDEO_SECONDS,
  MAX_VIDEO_BYTES,
  isVideoUrl,
  sanitizeProductMedia,
  stripVideoUrls
}
