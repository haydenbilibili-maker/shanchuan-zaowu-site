const CATEGORY_LABELS = {
  knowledge: '标本知识',
  art: '艺术鉴赏',
  craft: '制作工艺',
  story: '标本故事'
}

const CATEGORY_VALUES = ['knowledge', 'art', 'craft', 'story']
const CATEGORY_NAMES = ['标本知识', '艺术鉴赏', '制作工艺', '标本故事']

function mapArticleItem(item) {
  return {
    ...item,
    categoryLabel: CATEGORY_LABELS[item.category] || '',
    stats: item.stats || { views: 0, likes: 0, comments: 0 }
  }
}

function buildPublishPayload(form, user, uploaded) {
  const tags = form.tagsStr
    ? form.tagsStr.split(/[,，#]/).map((s) => s.trim()).filter(Boolean)
    : []

  const content = String(form.content || '').trim()
  const htmlContent = content.startsWith('<')
    ? content
    : content.split('\n').filter(Boolean).map((p) => `<p>${p}</p>`).join('')

  const data = {
    title: String(form.title || '').trim(),
    brief: String(form.brief || '').trim() || content.slice(0, 80),
    coverImage: uploaded.coverImage || '',
    images: uploaded.images || [],
    content: htmlContent,
    tags,
    status: 'pending',
    createTime: Date.now(),
    author: user.nickName || '藏家',
    authorAvatar: user.avatarUrl || '',
    isUGC: true,
    _openid: user._openid,
    category: form.category || 'story',
    stats: { views: 0, likes: 0, comments: 0 }
  }

  if (form.type === 'video') {
    data.videoUrl = String(form.videoUrl || '').trim()
  }

  return data
}

module.exports = {
  CATEGORY_LABELS,
  CATEGORY_VALUES,
  CATEGORY_NAMES,
  mapArticleItem,
  buildPublishPayload
}
