const { MEDIA } = require('./cdn')

/**
 * 把小节数组渲染为正文 HTML。
 *
 * 兼容两种小节写法：
 *   - `body: '单段正文'`（历史内容，渲染为一个 <p>）
 *   - `paras: ['第一段', '第二段']`（长文内容，渲染为多个 <p>）
 * 长文（如国家地理式科普）需要一节多段，用 body 只能挤成一大段，可读性很差。
 */
function sectionsToHtml(sections) {
  return (sections || [])
    .map((s) => {
      const tips = (s.tips || [])
        .map((t) => `<li>${t}</li>`)
        .join('')
      const list = tips ? `<ul>${tips}</ul>` : ''
      const imgs = (s.images || [])
        .map(
          (u) =>
            `<p><img src="${u}" alt="" style="width:100%;border-radius:8px;margin:20px 0;" /></p>`
        )
        .join('')
      const paras = Array.isArray(s.paras) && s.paras.length
        ? s.paras
        : (s.body ? [s.body] : [])
      const html = paras
        .map((p) => String(p || '').trim())
        .filter(Boolean)
        .map((p) => `<p>${p}</p>`)
        .join('')
      return `<h2>${s.title}</h2>${imgs}${html}${list}`
    })
    .join('')
}

function ugc(key, fields) {
  return {
    _seedKey: key,
    status: 'published',
    isUGC: true,
    author: fields.author,
    authorAvatar: fields.authorAvatar || '',
    ...fields
  }
}

function imgs(...urls) {
  return urls.filter(Boolean)
}

const I = {
  insect: [MEDIA.insectCover, ...MEDIA.insectImages],
  mineral: [MEDIA.mineralCover, ...MEDIA.mineralImages],
  plant: [MEDIA.plantCover, ...MEDIA.plantImages],
  marine: [MEDIA.marineCover, ...MEDIA.marineImages],
  banner: [MEDIA.bannerBlue, MEDIA.bannerMuseum, MEDIA.storeCover]
}

function pick(group, ...idx) {
  const arr = I[group] || I.insect
  return idx.map((i) => arr[i % arr.length])
}

function stats(views, likes, comments) {
  return { views, likes, comments: comments || Math.floor(likes * 0.15) }
}

module.exports = { sectionsToHtml, ugc, imgs, pick, stats, MEDIA, I }
