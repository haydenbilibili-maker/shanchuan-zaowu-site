/**
 * 社区 UGC 发布：文本过微信内容安全检测，默认 pending，审核通过后才公开展示。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const { checkText, checkFileImages, submitMediaCheck } = require('./contentSecurity')

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { success: false, msg: '请先登录' }

  const payload = event && event.data ? event.data : event
  const title = String((payload && payload.title) || '').trim()
  const content = String((payload && payload.content) || '').trim()
  const brief = String((payload && payload.brief) || '').trim()
  if (!title && !content) {
    return { success: false, msg: '请填写标题或正文' }
  }

  const textCheck = await checkText(OPENID, `${title}\n${brief}\n${content}\n${(Array.isArray(payload && payload.tags) ? payload.tags.join(' ') : '')}`)
  if (!textCheck.ok && textCheck.reason === 'risky') {
    return { success: false, msg: '内容未通过安全检测，请修改后重试' }
  }
  // 检测报错/疑似含疑：不直接公开，转入人工审核（status 仍为 pending）
  const reviewReasons = []
  if (!textCheck.ok) reviewReasons.push(textCheck.openapiUnavailable ? 'text_check_openapi_unavailable' : 'text_check_error')
  else if (textCheck.needReview) reviewReasons.push('text_suggest_review')

  const images = Array.isArray(payload && payload.images) ? payload.images.slice(0, 9) : []
  const coverImage = String((payload && payload.coverImage) || '')
  const videoUrl = String((payload && payload.videoUrl) || '')
  const imgCheck = await checkFileImages(images.concat(coverImage ? [coverImage] : []), 10)
  if (!imgCheck.ok && imgCheck.reason === 'risky') {
    return { success: false, msg: '图片未通过安全检测，请更换后重试' }
  }
  if (!imgCheck.ok) reviewReasons.push(imgCheck.openapiUnavailable ? 'image_check_openapi_unavailable' : `image_check_${imgCheck.reason}`)

  let mediaTraceId = ''
  if (videoUrl) {
    const mediaRes = await submitMediaCheck(videoUrl, OPENID, 2, 4)
    mediaTraceId = mediaRes.traceId || ''
    if (!mediaRes.ok) reviewReasons.push(mediaRes.openapiUnavailable ? 'media_check_openapi_unavailable' : 'media_check_error')
  }

  const now = Date.now()
  const doc = {
    title: title || content.slice(0, 20),
    brief: brief || content.slice(0, 80),
    coverImage,
    images,
    content,
    tags: Array.isArray(payload && payload.tags) ? payload.tags.slice(0, 12) : [],
    category: String((payload && payload.category) || 'story'),
    videoUrl,
    // 内容安全留痕：供审核台区分「正常待审」与「检测未完成/疑似」
    secCheck: {
      textSuggest: textCheck.suggest || '',
      imageChecked: !!imgCheck.ok,
      mediaTraceId,
      reviewReasons
    },
    author: String((payload && payload.author) || '藏家').slice(0, 32),
    authorAvatar: String((payload && payload.authorAvatar) || ''),
    isUGC: true,
    status: 'pending',
    stats: { views: 0, likes: 0, comments: 0 },
    createTime: now,
    _createTime: db.serverDate()
  }

  try {
    const added = await db.collection('articles').add({ data: doc })
    return { success: true, id: added._id, status: 'pending' }
  } catch (e) {
    console.error('submitCommunityPost', e)
    return { success: false, msg: '发布失败，请稍后重试' }
  }
}
