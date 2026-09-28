/**
 * 藏品视频 / 实况（Live）—— 店长端编辑区的纯逻辑（2026-09-28 产品点名）。
 *
 * 契约与服务端同口径：miniprogram/cloudfunctions/manageProducts/productMedia.js（守卫 check:product-media 比对常量）。
 *   - `images` 只放图片；视频/实况只进 `media`，**绝不**混入 images（images[0] 是全站封面）。
 *   - 微信拿不到原生 Live Photo：`live` = 短视频 + 封面帧，详情页按实况方式展示（静音、循环、点按播放）。
 */

const MEDIA_TYPES = ['video', 'live'];
const MAX_MEDIA = 3;
const MAX_VIDEO_SECONDS = 60;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
/** 实况建议时长：超过它仍可存，但编辑区会提示"更像普通视频" */
const LIVE_HINT_SECONDS = 10;

function formatDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

/** chooseMedia 的一条 video 结果 → 编辑区条目（本地路径，保存时再上传） */
function fromChosenVideo(file) {
  const f = file || {};
  const duration = Math.round((Number(f.duration) || 0) * 10) / 10;
  return {
    type: 'video',
    url: String(f.tempFilePath || ''),
    poster: String(f.thumbTempFilePath || ''),
    duration,
    width: Math.floor(Number(f.width) || 0),
    height: Math.floor(Number(f.height) || 0),
    size: Math.floor(Number(f.size) || 0),
    durationText: formatDuration(duration)
  };
}

/** 超时长直接拒；超体积交给调用方先压缩再判 */
function checkVideoLimits(item) {
  if (!item || !item.url) return { ok: false, reason: '视频文件无效' };
  if (item.duration > MAX_VIDEO_SECONDS + 1) {
    return { ok: false, reason: `视频 ${item.durationText} 超过 ${MAX_VIDEO_SECONDS} 秒上限` };
  }
  if (item.size > MAX_VIDEO_BYTES) {
    return { ok: false, reason: `视频 ${(item.size / 1048576).toFixed(1)}MB 超过 50MB 上限`, tooLarge: true };
  }
  return { ok: true };
}

/** 已存条目回填编辑区（补 durationText；非法项丢掉） */
function toEditorMedia(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((m) => m && MEDIA_TYPES.includes(m.type) && m.url)
    .slice(0, MAX_MEDIA)
    .map((m) => ({ ...m, durationText: formatDuration(m.duration) }));
}

/** 保存载荷：去掉编辑区专用键 */
function toPayloadMedia(list) {
  return (Array.isArray(list) ? list : []).map((m) => ({
    type: MEDIA_TYPES.includes(m.type) ? m.type : 'video',
    url: m.url,
    poster: m.poster || '',
    duration: Number(m.duration) || 0,
    width: Number(m.width) || 0,
    height: Number(m.height) || 0,
    size: Number(m.size) || 0
  }));
}

function videoCloudPath(prefix, localPath) {
  const ext = (/\.(mp4|mov|m4v)$/i.exec(String(localPath || '')) || [])[1] || 'mp4';
  return `products/${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext.toLowerCase()}`;
}

module.exports = {
  MEDIA_TYPES,
  MAX_MEDIA,
  MAX_VIDEO_SECONDS,
  MAX_VIDEO_BYTES,
  LIVE_HINT_SECONDS,
  formatDuration,
  fromChosenVideo,
  checkVideoLimits,
  toEditorMedia,
  toPayloadMedia,
  videoCloudPath
};
