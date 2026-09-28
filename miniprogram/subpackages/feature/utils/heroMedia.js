/**
 * 详情页主图轮播的视频 / 实况旁路（2026-09-28 产品点名）。
 * 无 media → 返回 []，详情页走原来那条 images 轮播，行为与改动前完全一致。
 * 有 media → 封面图仍在第 1 位（首屏、分享、敏感遮罩不变），视频/实况紧随其后，其余图片在后。
 */
const VIDEO_TYPES = ['video', 'live'];

function buildHeroSlides(images, media) {
  const vids = (Array.isArray(media) ? media : [])
    .filter((m) => m && VIDEO_TYPES.includes(m.type) && m.url)
    .slice(0, 3);
  if (!vids.length) return [];
  const imgs = (Array.isArray(images) ? images : []).filter(Boolean);
  const slides = imgs.slice(0, 1).map((src) => ({ kind: 'image', src }));
  vids.forEach((m, i) => {
    slides.push({
      kind: m.type,
      vid: `heroVideo${i}`,
      url: m.url,
      poster: m.poster || imgs[0] || ''
    });
  });
  imgs.slice(1).forEach((src) => slides.push({ kind: 'image', src }));
  return slides.map((s, i) => ({ ...s, key: `s${i}` }));
}

module.exports = { buildHeroSlides };
