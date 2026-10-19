/**
 * 藏品档案库（ERP）· 实拍视频录入的纯逻辑（2026-10-18 产品负责人点名「产品详情页添加视频模块」）。
 *
 * 两个字段，契约都以云函数为准（守卫 check:product-external-videos 比对常量）：
 *   - media（云存储视频 / 实况）：miniprogram/cloudfunctions/manageProducts/productMedia.js
 *     ≤3 段、每段 ≤60 秒、≤50MB；详情页顶部主图轮播读它。
 *   - externalVideos（外平台）：miniprogram/cloudfunctions/manageProducts/externalVideos.js
 *     视频号可小程序内嵌；B站 / 抖音 / 小红书只给卡片 + 复制链接（评估见 miniprogram/docs/藏品视频_外平台与云存储评估_2026-10-18.md）。
 *
 * 保存规则（与店长端 managerPageConfig 同口径）：只在「有值」或「原本有值、被删光」时才送字段，
 * 避免没载入过的入口一保存就把库里视频清空（云函数 .update() 是合并写）。
 */

export const MAX_MEDIA = 3
export const MAX_VIDEO_SECONDS = 60
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024
/** 码率高于此值提示「建议先压缩」：60 秒 × 4Mbps ≈ 30MB，详情页 4G 下起播会明显变慢 */
export const BITRATE_WARN_MBPS = 4
export const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/x-m4v,.mp4,.mov,.m4v'

export const MAX_EXTERNAL = 3
/** 链接上限（与服务端同口径） */
export const MAX_URL_LEN = 512
export const PLATFORMS = {
  channels: { label: '视频号', hosts: [] },
  bilibili: { label: '哔哩哔哩', hosts: ['bilibili.com', 'b23.tv'] },
  douyin: { label: '抖音', hosts: ['douyin.com', 'iesdouyin.com'] },
  xiaohongshu: { label: '小红书', hosts: ['xiaohongshu.com', 'xhslink.com'] }
}
/** 本馆视频号（与小程序同主体，2026-10-18 产品负责人提供）：录入默认值；服务端同名常量会把它强制按同主体处理 */
export const STORE_FINDERS = ['sphbtKfDFOzLQXM']
const FINDER_RE = /^sph[A-Za-z0-9_-]{3,60}$/
const FEED_RE = /^[A-Za-z0-9_=+/-]{6,300}$/
const BVID_RE = /BV[0-9A-Za-z]{10}/
const TOKEN_RE = /^[A-Za-z0-9_=+/.-]{6,1024}$/

export function formatVideoDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 码率（Mbps，一位小数）；时长未知返回 0 */
export function bitrateMbps(size, duration) {
  const d = Number(duration) || 0
  if (!(d > 0)) return 0
  return Math.round(((Number(size) || 0) * 8 / d / 1e6) * 10) / 10
}

/** 选文件后的校验：{ ok, reason?, warn? } */
export function checkVideoFile({ size, duration }) {
  // 读不出时长（浏览器解不了该编码，如部分 HEVC .mov）→ 60 秒上限没法核，直接拦下（2026-10-19 核查）
  if (!(Number(duration) > 0) || !Number.isFinite(Number(duration))) {
    return { ok: false, reason: '读不出这段视频的时长（多为 HEVC 编码），请导出为 H.264 MP4 后再传' }
  }
  if (size > MAX_VIDEO_BYTES) return { ok: false, reason: `视频 ${(size / 1048576).toFixed(1)}MB 超过 50MB 上限，请先压缩（建议 720p、码率 ≤ 2.5Mbps）` }
  if (duration > MAX_VIDEO_SECONDS + 1) return { ok: false, reason: `视频 ${formatVideoDuration(duration)} 超过 ${MAX_VIDEO_SECONDS} 秒上限，请先剪辑` }
  const mbps = bitrateMbps(size, duration)
  return mbps > BITRATE_WARN_MBPS
    ? { ok: true, warn: `码率约 ${mbps}Mbps，偏高：顾客在 4G 下起播会慢，建议导出 720p / 2.5Mbps 后再传` }
    : { ok: true }
}

/** 保存载荷：去掉编辑区专用键（与小程序店长端 toPayloadMedia 同形） */
export function toPayloadMedia(list) {
  return (Array.isArray(list) ? list : []).map((m) => ({
    type: m.type === 'live' ? 'live' : 'video',
    url: m.url,
    poster: m.poster || '',
    duration: Number(m.duration) || 0,
    width: Number(m.width) || 0,
    height: Number(m.height) || 0,
    size: Number(m.size) || 0
  }))
}

export function pickUrl(text) {
  const m = /https:\/\/[^\s"'<>，。]+/i.exec(String(text || ''))
  // 去掉粘在链接尾巴上的中英文标点（分享文案常见：）】；！、”。）
  return m ? m[0].replace(/[)）\]】；;，,。.！!、"”'’]+$/, '') : ''
}

/** 严格解析：域名只许字母数字点横杠（反斜杠 / @ / % / 非 443 端口一律不收），≤512 字；返回 { host, path } 或 null */
export function parseHttps(url) {
  const s = String(url || '')
  if (s.length > MAX_URL_LEN) return null
  const m = /^https:\/\/([A-Za-z0-9.-]+)(?::443)?(\/[^\s\\]*)?$/.exec(s)
  if (!m) return null
  return { host: m[1].toLowerCase(), path: (m[2] || '/').split(/[?#]/)[0] }
}

/** 链接属于哪个白名单平台；不认识返回 '' */
export function platformOfUrl(url) {
  const u = parseHttps(url)
  if (!u) return ''
  for (const key of Object.keys(PLATFORMS)) {
    if (PLATFORMS[key].hosts.some((h) => u.host === h || u.host.endsWith(`.${h}`))) return key
  }
  return ''
}

/** 去重键：域名 + 路径（同一视频带不同分享参数算一条） */
export function urlKey(url) {
  const u = parseHttps(url)
  return u ? `${u.host}${u.path}` : String(url || '')
}

export function externalLabel(platform) {
  return (PLATFORMS[platform] && PLATFORMS[platform].label) || platform || ''
}

/**
 * 录入草稿 → 条目；不合法返回 { error }。
 * draft: { kind: 'link'|'channels', url, title, finderUserName, feedId, feedToken, sameSubject }
 */
export function parseExternalDraft(draft, existing = []) {
  const d = draft || {}
  const title = String(d.title || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40)
  if ((existing || []).length >= MAX_EXTERNAL) return { error: `最多 ${MAX_EXTERNAL} 条外平台视频` }
  if (d.kind === 'channels') {
    const finderUserName = String(d.finderUserName || '').trim()
    const feedId = String(d.feedId || '').trim()
    if (!FINDER_RE.test(finderUserName)) return { error: '视频号 ID 应以 sph 开头（视频号助手 → 帐号设置里可见）' }
    if (!FEED_RE.test(feedId)) return { error: '视频 feedId 格式不对（视频号助手 → 视频管理 → 复制视频 ID）' }
    if (existing.some((v) => v.feedId === feedId)) return { error: '这条视频号视频已添加' }
    const token = String(d.feedToken || '').trim()
    // 服务端会静默丢掉不合格的 token（内嵌降成跳转卡片）→ 录入时就说清楚
    if (token && !TOKEN_RE.test(token)) return { error: 'feedToken 格式不对（只含字母数字与 _=+/.-，6 位以上），请重新复制' }
    return { item: { platform: 'channels', title, url: '', bvid: '', feedId, finderUserName, feedToken: String(d.feedToken || '').trim(), sameSubject: d.sameSubject === true || STORE_FINDERS.includes(finderUserName) } }
  }
  const url = pickUrl(d.url)
  if (!url) return { error: '没有识别到 https 链接（http 链接不收）' }
  const platform = platformOfUrl(url)
  if (url.length > MAX_URL_LEN) return { error: `链接过长（超过 ${MAX_URL_LEN} 字），请用平台的短链接` }
  if (!platform) return { error: '只支持哔哩哔哩 / 抖音 / 小红书的链接；视频号请切到「视频号」录入' }
  if (existing.some((v) => urlKey(v.url) === urlKey(url))) return { error: '这条链接已添加' }
  const bvid = platform === 'bilibili' ? ((BVID_RE.exec(url) || [])[0] || '') : ''
  return { item: { platform, title, url, bvid, feedId: '', finderUserName: '', feedToken: '', sameSubject: false } }
}

/** 视频扩展名白名单：小程序能播、服务端 isVideoUrl 认得（拖拽上传不受 accept 约束，需自己查） */
export const VIDEO_NAME_RE = /\.(mp4|mov|m4v)$/i

/** 释放离屏 <video>：撤销对象 URL 并清掉 src，避免解码器占着内存 */
function releaseVideo(v, url) {
  v.removeAttribute('src')
  v.load()
  URL.revokeObjectURL(url)
}

/** 浏览器里读视频时长 / 尺寸（读元数据，不整段下载）；8 秒没有事件就按读不出处理（部分移动端浏览器不加载离屏视频） */
export function readVideoMeta(file, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    let settled = false
    const done = (meta) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      releaseVideo(v, url)
      resolve(meta)
    }
    const timer = setTimeout(() => done({ duration: 0, width: 0, height: 0 }), timeoutMs)
    v.onloadedmetadata = () => done({ duration: v.duration || 0, width: v.videoWidth || 0, height: v.videoHeight || 0 })
    v.onerror = () => done({ duration: 0, width: 0, height: 0 })
    v.src = url
  })
}

/** 截一帧当封面（0.5 秒处，JPEG）；浏览器解不了（如部分 HEVC .mov）返回 null，由调用方留空封面 */
export function captureVideoFrame(file, at = 0.5, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'auto'
    v.muted = true
    v.playsInline = true
    let settled = false
    // 10 秒截不到就放弃封面（不让上传卡在 99%）
    const done = (blob) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      releaseVideo(v, url)
      resolve(blob)
    }
    const timer = setTimeout(() => done(null), timeoutMs)
    v.onloadeddata = () => { v.currentTime = Math.min(at, (v.duration || 1) / 2) }
    v.onseeked = () => {
      try {
        const c = document.createElement('canvas')
        c.width = v.videoWidth
        c.height = v.videoHeight
        c.getContext('2d').drawImage(v, 0, 0)
        c.toBlob((b) => done(b), 'image/jpeg', 0.86)
      } catch (e) {
        done(null)
      }
    }
    v.onerror = () => done(null)
    v.src = url
  })
}
