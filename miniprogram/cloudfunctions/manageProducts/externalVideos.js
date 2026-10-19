/**
 * 藏品「外平台实拍视频」字段 `externalVideos` 的服务端净化（2026-10-18 产品负责人点名「产品详情页添加视频模块，
 * 支持填写视频平台地址如 bilibili」）。评估与取舍见 miniprogram/docs/藏品视频_外平台与云存储评估_2026-10-18.md。
 *
 * 为什么不并进 `media`：店长端编辑器只认 video / live，载入时会把别的类型过滤掉、保存时回写 media ——
 * 外平台条目放进 media 会被店长一次保存洗掉。另开字段后店长端不送它，`.update()` 合并写不会动它。
 *
 * 契约（可选字段，没有 / 空数组 = 详情页不出外平台区块）：
 *   externalVideos: [{ platform, title, url, bvid, feedId, finderUserName, feedToken, sameSubject }]
 *   - platform = 'channels'（微信视频号，小程序内可嵌入播放）→ 必填 finderUserName（sph 开头的视频号 ID）+ feedId，
 *     feedToken 选填（非同主体嵌入必需）；sameSubject=true 表示视频号与小程序同主体 / 关联主体（无 token 也可内嵌）；
 *     两者都没有 → 详情页只给「去视频号观看」跳转卡片；url 为空。
 *   - platform = 'bilibili' | 'douyin' | 'xiaohongshu' → 必填 https url（白名单域名）。小程序**不能内嵌**这些平台，
 *     详情页只展示卡片 + 复制链接（见评估文档 §2）。
 *   - 最多 3 条；非法项丢弃（与 media / tags 同口径：宁可不写，不写脏值）。
 *
 * 同口径副本：admin/src/utils/externalVideos.js（后台录入预览）—— 守卫 check:product-external-videos 比对常量。
 */

const MAX_EXTERNAL = 3
/** 链接上限：防止超长串把商品文档撑大（2026-10-19 核查） */
const MAX_URL_LEN = 512
const PLATFORMS = {
  channels: { label: '视频号', hosts: [] },
  bilibili: { label: '哔哩哔哩', hosts: ['bilibili.com', 'b23.tv'] },
  douyin: { label: '抖音', hosts: ['douyin.com', 'iesdouyin.com'] },
  xiaohongshu: { label: '小红书', hosts: ['xiaohongshu.com', 'xhslink.com'] }
}
/** 本馆视频号（与小程序同主体，2026-10-18 产品负责人确认并提供）：这些 ID 的条目一律按同主体处理，录入时漏勾也不降级 */
const STORE_FINDERS = ['sphbtKfDFOzLQXM']
const FINDER_RE = /^sph[A-Za-z0-9_-]{3,60}$/
const FEED_RE = /^[A-Za-z0-9_=+/-]{6,300}$/
const TOKEN_RE = /^[A-Za-z0-9_=+/.-]{6,1024}$/
const BVID_RE = /BV[0-9A-Za-z]{10}/

/** 从「【标题】 https://b23.tv/xxx」这类分享文案里取第一个 https 链接；http 一律不收 */
function pickUrl(text) {
  const m = /https:\/\/[^\s"'<>，。]+/i.exec(String(text || ''))
  // 去掉粘在链接尾巴上的中英文标点（分享文案常见：）】；！、”。）
  return m ? m[0].replace(/[)）\]】；;，,。.！!、"”'’]+$/, '') : ''
}

/** 严格解析：域名只许字母数字点横杠（反斜杠 / @ / % / 非 443 端口一律不收），≤512 字；返回 { host, path } 或 null */
function parseHttps(url) {
  const s = String(url || '')
  if (s.length > MAX_URL_LEN) return null
  const m = /^https:\/\/([A-Za-z0-9.-]+)(?::443)?(\/[^\s\\]*)?$/.exec(s)
  if (!m) return null
  return { host: m[1].toLowerCase(), path: (m[2] || '/').split(/[?#]/)[0] }
}

/** 链接属于哪个白名单平台；不认识返回 '' */
function platformOfUrl(url) {
  const u = parseHttps(url)
  if (!u) return ''
  for (const key of Object.keys(PLATFORMS)) {
    if (PLATFORMS[key].hosts.some((h) => u.host === h || u.host.endsWith(`.${h}`))) return key
  }
  return ''
}

/** 去重键：域名 + 路径（同一视频带不同分享参数算一条） */
function urlKey(url) {
  const u = parseHttps(url)
  return u ? `${u.host}${u.path}` : String(url || '')
}

function cleanTitle(v) {
  return String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40)
}

function sanitizeExternalVideos(list) {
  if (!Array.isArray(list)) return []
  const out = []
  const seen = new Set()
  for (const raw of list) {
    if (out.length >= MAX_EXTERNAL) break
    if (!raw || typeof raw !== 'object') continue
    const title = cleanTitle(raw.title)
    const finderUserName = String(raw.finderUserName || '').trim()
    const feedId = String(raw.feedId || '').trim()
    if (raw.platform === 'channels' || finderUserName || feedId) {
      if (!FINDER_RE.test(finderUserName) || !FEED_RE.test(feedId) || seen.has(`ch:${feedId}`)) continue
      const feedToken = String(raw.feedToken || '').trim()
      seen.add(`ch:${feedId}`)
      out.push({ platform: 'channels', title, url: '', bvid: '', feedId, finderUserName, feedToken: TOKEN_RE.test(feedToken) ? feedToken : '', sameSubject: raw.sameSubject === true || STORE_FINDERS.includes(finderUserName) })
      continue
    }
    const url = pickUrl(raw.url)
    const platform = url ? platformOfUrl(url) : ''
    if (!platform || seen.has(urlKey(url))) continue
    seen.add(urlKey(url))
    const bvid = platform === 'bilibili' ? ((BVID_RE.exec(url) || [])[0] || '') : ''
    out.push({ platform, title, url, bvid, feedId: '', finderUserName: '', feedToken: '', sameSubject: false })
  }
  return out
}

module.exports = { MAX_EXTERNAL, MAX_URL_LEN, PLATFORMS, STORE_FINDERS, pickUrl, parseHttps, platformOfUrl, urlKey, sanitizeExternalVideos }
