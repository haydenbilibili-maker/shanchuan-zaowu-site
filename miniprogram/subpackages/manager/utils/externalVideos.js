/**
 * 店长端（超管工作台 · 藏品库）外平台实拍视频录入的纯逻辑（2026-10-19 产品负责人「藏品编辑没有看到视频编辑模块，核查并修复」）。
 * 契约以云函数为准：miniprogram/cloudfunctions/manageProducts/externalVideos.js（守卫 check:product-external-videos 比对常量）。
 *   - 主方案 = 本馆同主体视频号（STORE_FINDERS），详情页价格卡下大幅主片；
 *   - B站 / 抖音 / 小红书只存 https 白名单链接，详情页显示卡片 + 复制链接。
 * 保存规则与 media 同口径：只在「有值」或「原本有值、被删光」时才送 externalVideos。
 */
const MAX_EXTERNAL = 3;
const PLATFORMS = {
  channels: { label: '视频号', hosts: [] },
  bilibili: { label: '哔哩哔哩', hosts: ['bilibili.com', 'b23.tv'] },
  douyin: { label: '抖音', hosts: ['douyin.com', 'iesdouyin.com'] },
  xiaohongshu: { label: '小红书', hosts: ['xiaohongshu.com', 'xhslink.com'] }
};
const STORE_FINDERS = ['sphbtKfDFOzLQXM'];
const FINDER_RE = /^sph[A-Za-z0-9_-]{3,60}$/;
const FEED_RE = /^[A-Za-z0-9_=+/-]{6,300}$/;
const BVID_RE = /BV[0-9A-Za-z]{10}/;

function pickUrl(text) {
  const m = /https:\/\/[^\s"'<>，。]+/i.exec(String(text || ''));
  return m ? m[0].replace(/[)）\]】]+$/, '') : '';
}

function platformOfUrl(url) {
  const host = String(url || '').replace(/^https:\/\//i, '').split(/[/?#]/)[0].toLowerCase();
  for (const key of Object.keys(PLATFORMS)) {
    if (PLATFORMS[key].hosts.some((h) => host === h || host.endsWith(`.${h}`))) return key;
  }
  return '';
}

function labelOf(platform) {
  return (PLATFORMS[platform] && PLATFORMS[platform].label) || platform || '';
}

/** 编辑区条目：补 key / label / ref（展示用，保存时剥掉） */
function toEditorExternal(list) {
  return (Array.isArray(list) ? list : [])
    .filter((v) => v && PLATFORMS[v.platform])
    .slice(0, MAX_EXTERNAL)
    .map((v, i) => decorate(v, i));
}

function decorate(v, i) {
  const ref = v.platform === 'channels'
    ? `${v.finderUserName} · ${v.feedId}${v.sameSubject || v.feedToken ? ' · 可内嵌' : ' · 跳转观看'}`
    : (v.bvid || v.url);
  return { ...v, key: `ev${i}_${v.feedId || v.url}`, label: labelOf(v.platform), ref };
}

/** 草稿 → { item } | { error }；draft: { kind, finderUserName, feedId, feedToken, url, title } */
function parseExternalDraft(draft, existing) {
  const d = draft || {};
  const list = Array.isArray(existing) ? existing : [];
  const title = String(d.title || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40);
  if (list.length >= MAX_EXTERNAL) return { error: `最多 ${MAX_EXTERNAL} 条外平台视频` };
  if (d.kind === 'channels') {
    const finderUserName = String(d.finderUserName || '').trim();
    const feedId = String(d.feedId || '').trim();
    if (!FINDER_RE.test(finderUserName)) return { error: '视频号 ID 应以 sph 开头' };
    if (!FEED_RE.test(feedId)) return { error: '视频 ID 格式不对（视频号助手 → 视频管理 → 复制视频 ID）' };
    if (list.some((v) => v.feedId === feedId)) return { error: '这条视频号视频已添加' };
    const feedToken = String(d.feedToken || '').trim();
    return { item: { platform: 'channels', title, url: '', bvid: '', feedId, finderUserName, feedToken, sameSubject: STORE_FINDERS.includes(finderUserName) || d.sameSubject === true } };
  }
  const url = pickUrl(d.url);
  if (!url) return { error: '没有识别到 https 链接（http 链接不收）' };
  const platform = platformOfUrl(url);
  if (!platform) return { error: '只支持哔哩哔哩 / 抖音 / 小红书的链接' };
  if (list.some((v) => v.url === url)) return { error: '这条链接已添加' };
  const bvid = platform === 'bilibili' ? ((BVID_RE.exec(url) || [])[0] || '') : '';
  return { item: { platform, title, url, bvid, feedId: '', finderUserName: '', feedToken: '', sameSubject: false } };
}

/** 保存载荷：只留契约字段 */
function toPayloadExternal(list) {
  return (Array.isArray(list) ? list : []).map((v) => ({
    platform: v.platform,
    title: v.title || '',
    url: v.url || '',
    bvid: v.bvid || '',
    feedId: v.feedId || '',
    finderUserName: v.finderUserName || '',
    feedToken: v.feedToken || '',
    sameSubject: !!v.sameSubject
  }));
}

module.exports = {
  MAX_EXTERNAL,
  PLATFORMS,
  STORE_FINDERS,
  pickUrl,
  platformOfUrl,
  labelOf,
  toEditorExternal,
  decorate,
  parseExternalDraft,
  toPayloadExternal
};
