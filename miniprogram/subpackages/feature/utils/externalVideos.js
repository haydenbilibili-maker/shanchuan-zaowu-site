/**
 * 详情页「实拍影像」区块的视图模型（2026-10-18 产品负责人点名）。
 * **主方案 = 同主体视频号**（产品负责人 2026-10-18「将同主体视频号视频作为最主要的详情页视频展示方案」）：
 *   排序固定为 同主体视频号 → 其它视频号 → 外平台链接；第一条可内嵌的同主体视频号标 lead（详情页大幅主片 + 头图「实拍视频」角标）。
 * 只读 products.externalVideos（服务端 manageProducts/externalVideos.js 已净化）；不读 media（media 归主图轮播，守卫 check:product-media）。
 *   - channels（视频号）：小程序内 <channel-video> 嵌入 —— 同主体（sameSubject）或带 feedToken 才内嵌，否则只给「去视频号观看」跳转；
 *     内嵌报错时就地降级成跳转卡片（不自动把顾客带离页面）。
 *   - bilibili / douyin / xiaohongshu：小程序不能内嵌外平台网页（web-view 只开放给本主体校验过的业务域名），
 *     只展示卡片，点按复制链接 —— 不跳外部小程序（对方 AppID / 路径无官方文档，见评估文档 §2）。
 */
const LABELS = { channels: '视频号', bilibili: '哔哩哔哩', douyin: '抖音', xiaohongshu: '小红书' };

/** 同主体视频号 0 → 其它视频号 1 → 外平台链接 2；同档保持录入顺序 */
function rankOf(v) {
  if (v.platform !== 'channels') return 2;
  return v.sameSubject ? 0 : 1;
}

function buildExternalVideos(list) {
  const rows = (Array.isArray(list) ? list : [])
    .filter((v) => v && LABELS[v.platform] && (v.platform === 'channels' ? v.feedId && v.finderUserName : v.url))
    .slice(0, 3)
    .map((v, i) => ({ v, i }))
    .sort((a, b) => rankOf(a.v) - rankOf(b.v) || a.i - b.i)
    .map(({ v }) => v);
  const leadAt = rows.findIndex((v) => v.platform === 'channels' && v.sameSubject);
  return rows
    .map((v, i) => ({
      key: `ev${i}`,
      platform: v.platform,
      label: LABELS[v.platform],
      title: v.title || `${LABELS[v.platform]}实拍视频`,
      url: v.url || '',
      bvid: v.bvid || '',
      feedId: v.feedId || '',
      finderUserName: v.finderUserName || '',
      feedToken: v.feedToken || '',
      embed: v.platform === 'channels' && !!(v.feedToken || v.sameSubject),
      sameSubject: v.platform === 'channels' && !!v.sameSubject,
      lead: i === leadAt
    }));
}

module.exports = { buildExternalVideos, LABELS };
