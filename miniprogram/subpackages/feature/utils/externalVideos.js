/**
 * 详情页「实拍影像」区块的视图模型（2026-10-18 产品负责人点名）。
 * 只读 products.externalVideos（服务端 manageProducts/externalVideos.js 已净化）；不读 media（media 归主图轮播，守卫 check:product-media）。
 *   - channels（视频号）：小程序内 <channel-video> 嵌入 —— 同主体（sameSubject）或带 feedToken 才内嵌，否则只给「去视频号观看」跳转；
 *     内嵌报错时就地降级成跳转卡片（不自动把顾客带离页面）。
 *   - bilibili / douyin / xiaohongshu：小程序不能内嵌外平台网页（web-view 只开放给本主体校验过的业务域名），
 *     只展示卡片，点按复制链接 —— 不跳外部小程序（对方 AppID / 路径无官方文档，见评估文档 §2）。
 */
const LABELS = { channels: '视频号', bilibili: '哔哩哔哩', douyin: '抖音', xiaohongshu: '小红书' };

function buildExternalVideos(list) {
  return (Array.isArray(list) ? list : [])
    .filter((v) => v && LABELS[v.platform] && (v.platform === 'channels' ? v.feedId && v.finderUserName : v.url))
    .slice(0, 3)
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
      embed: v.platform === 'channels' && !!(v.feedToken || v.sameSubject)
    }));
}

module.exports = { buildExternalVideos, LABELS };
