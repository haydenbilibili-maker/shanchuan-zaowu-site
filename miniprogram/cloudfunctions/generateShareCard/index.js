/**
 * 产品知识卡素材：商品信息 + 图片临时链 + 小程序码
 * 完整画面由小程序端 Canvas 合成（保证中文排版可靠）
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function firstImage(product) {
  if (!product) return ''
  if (Array.isArray(product.images) && product.images[0]) return product.images[0]
  if (product.cover) return product.cover
  if (product.image) return product.image
  return ''
}

function pickPrice(product) {
  if (!product) return 0
  if (product.price != null && product.price !== '') return Number(product.price) || 0
  if (Array.isArray(product.skus) && product.skus[0] && product.skus[0].price != null) {
    return Number(product.skus[0].price) || 0
  }
  return 0
}

function generateShareText(product) {
  const t = (product && product.title) || '标本'
  const templates = [
    `在山海造物看到一件${t}，想分享给你看看。`,
    `${t} · 山海造物 · 把山海带回家`,
    `这件${t}来自山海造物，像朋友在窗边讲起山野里的事。`
  ]
  return templates[Math.floor(Math.random() * templates.length)]
}

/** 知识卡正文上限：约 36 字，优先短卖点 */
const CARD_CAPTION_MAX_CHARS = 36

function normalizeCardText(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function clipCardCaption(text, maxChars = CARD_CAPTION_MAX_CHARS) {
  const t = normalizeCardText(text)
  if (!t) return ''
  if (t.length <= maxChars) return t

  const window = t.slice(0, maxChars)
  const punct = /[，。；、！？,.!?;：:…]/
  let cut = -1
  for (let i = window.length - 1; i >= Math.floor(maxChars * 0.45); i -= 1) {
    if (punct.test(window[i])) {
      cut = i + (window[i] === '…' ? 0 : 1)
      break
    }
  }
  if (cut > 0) {
    return window.slice(0, cut).replace(/[，、；：,\s]+$/g, '').trim()
  }

  const soft = window.replace(/[A-Za-z0-9_\-]+$/g, '').trim()
  if (soft.length >= Math.floor(maxChars * 0.5)) return soft

  return `${window.slice(0, Math.max(1, maxChars - 1)).trim()}…`
}

function pickCardCaption(product) {
  const p = product || {}
  const selling =
    (Array.isArray(p.sellingPoints) && p.sellingPoints[0]) ||
    (Array.isArray(p.highlights) && p.highlights[0]) ||
    ''

  const preferred = [
    p.subtitle,
    p.sellingPoint,
    p.slogan,
    p.highlight,
    selling,
    p.brief
  ]
    .map(normalizeCardText)
    .filter(Boolean)

  for (let i = 0; i < preferred.length; i += 1) {
    if (preferred[i].length <= CARD_CAPTION_MAX_CHARS) return preferred[i]
  }
  if (preferred.length) return clipCardCaption(preferred[0])

  const longDesc = normalizeCardText(p.description || '')
  if (longDesc) return clipCardCaption(longDesc)

  return clipCardCaption(generateShareText(p))
}

async function resolveTempUrl(fileID) {
  if (!fileID) return ''
  if (!String(fileID).startsWith('cloud://')) return String(fileID)
  try {
    const res = await cloud.getTempFileURL({ fileList: [fileID] })
    const row = res.fileList && res.fileList[0]
    return (row && row.tempFileURL) || ''
  } catch (e) {
    console.warn('resolveTempUrl', e && e.message)
    return ''
  }
}

async function makeProductWxacode(productId) {
  const scene = String(productId || '')
  if (!scene || scene.length > 32) return { fileID: '', tempUrl: '' }

  const wxacodeRes = await cloud.openapi.wxacode.getUnlimited({
    scene,
    page: 'subpackages/feature/detail/index',
    width: 280,
    autoColor: false,
    lineColor: { r: 196, g: 167, b: 108 },
    isHyaline: true,
    checkPath: false,
    envVersion: 'release'
  })

  let qrBuffer = null
  if (Buffer.isBuffer(wxacodeRes)) qrBuffer = wxacodeRes
  else if (wxacodeRes && Buffer.isBuffer(wxacodeRes.buffer)) qrBuffer = wxacodeRes.buffer
  else if (wxacodeRes && wxacodeRes.data && Buffer.isBuffer(wxacodeRes.data)) qrBuffer = wxacodeRes.data
  else if (wxacodeRes && wxacodeRes.body && Buffer.isBuffer(wxacodeRes.body)) qrBuffer = wxacodeRes.body

  if (!Buffer.isBuffer(qrBuffer)) {
    throw new Error('小程序码返回格式异常')
  }

  const cloudPath = `share-card-qr/${scene}-${Date.now()}.png`
  const up = await cloud.uploadFile({ cloudPath, fileContent: qrBuffer })
  const tempUrl = await resolveTempUrl(up.fileID)
  return { fileID: up.fileID, tempUrl }
}

exports.main = async (event) => {
  const productId = String((event && (event.productId || event.id)) || '').trim()
  if (!productId) {
    return { success: false, msg: '缺少商品 ID' }
  }

  try {
    const productRes = await db.collection('products').doc(productId).get()
    const product = productRes.data
    if (!product) {
      return { success: false, msg: '商品不存在' }
    }

    const imageFile = firstImage(product)
    const imageTempUrl = await resolveTempUrl(imageFile)

    let qrFileID = ''
    let qrTempUrl = ''
    try {
      const qr = await makeProductWxacode(productId)
      qrFileID = qr.fileID
      qrTempUrl = qr.tempUrl
    } catch (e) {
      console.warn('wxacode skipped:', e && e.message)
    }

    const category = product.category || product.categoryName || ''
    const latin = product.latinName || product.latin || ''
    const brief = product.brief || ''
    const cardCaption = pickCardCaption(product)

    return {
      success: true,
      data: {
        productId,
        title: product.title || '标本',
        latinName: latin,
        category,
        price: pickPrice(product),
        brief,
        cardCaption,
        description: product.description || brief || '',
        imageTempUrl,
        imageFileID: imageFile,
        qrFileID,
        qrTempUrl,
        shareText: generateShareText(product),
        brand: '山海造物',
        brandEn: "NATURE'S CREATIONS",
        tagline: '把山海带回家',
        cardTitle: '山海造物 · 知识卡'
      }
    }
  } catch (e) {
    console.error('generateShareCard', e)
    return { success: false, msg: e.message || '知识卡素材生成失败' }
  }
}
