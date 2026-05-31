const { MEDIA } = require('./cdn')

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
      return `<h2>${s.title}</h2>${imgs}<p>${s.body}</p>${list}`
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
