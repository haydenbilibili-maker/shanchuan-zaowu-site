// P2：Canvas 合成分享海报（中文 + 标本图 + 小程序码）
const { drawBrandSeal } = require('../../utils/brandSeal')
const W = 750
const H = 1200

function downloadToLocal(url) {
  if (!url) return Promise.resolve('')
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      success: (r) => resolve(r.tempFilePath || ''),
      fail: reject
    })
  })
}

/**
 * 当前小程序版本：小程序码默认指向正式版。
 * 开发/体验阶段带上 env_version，扫码才能进对应版本，方便真机验证分享链路。
 */
function currentEnvVersion() {
  try {
    const info = typeof wx.getAccountInfoSync === 'function' ? wx.getAccountInfoSync() : null
    const v = info && info.miniProgram && info.miniProgram.envVersion
    return v === 'develop' || v === 'trial' ? v : 'release'
  } catch (e) {
    return 'release'
  }
}

function wrapLines(text, maxCharsPerLine, maxLines) {
  const t = (text || '').replace(/\s+/g, ' ').trim()
  if (!t) return []
  const lines = []
  let i = 0
  while (i < t.length && lines.length < maxLines) {
    lines.push(t.slice(i, i + maxCharsPerLine))
    i += maxCharsPerLine
  }
  if (i < t.length && lines.length === maxLines) {
    const last = lines[maxLines - 1]
    lines[maxLines - 1] = last.length >= 2 ? last.slice(0, -1) + '…' : '…'
  }
  return lines
}

Page({
  data: {
    generating: true,
    genText: '准备画布…',
    hasAssets: false,
    posterReady: false,
    posterPath: '',
    recordId: '',
    sharedReady: false,
    speciesNameZh: ''
  },

  canvas: null,
  ctx: null,
  dpr: 1,
  assets: null,

  onLoad(options) {
    this.setData({
      recordId: options.record_id || ''
    })
  },

  onReady() {
    this.initCanvas().then(() => {
      this.bootstrapDraw()
    })
  },

  markShared() {
    const recordId = this.data.recordId
    if (!recordId) return Promise.resolve(false)
    return wx.cloud
      .callFunction({
        name: 'identifySpecimen',
        data: { action: 'mark_shared', record_id: recordId, shared: true }
      })
      .then((res) => {
        const ok = !!(res && res.result && res.result.success)
        if (ok) this.setData({ sharedReady: true })
        return ok
      })
      .catch(() => false)
  },

  onShareAppMessage() {
    const id = this.data.recordId
    const zh = this.data.speciesNameZh || '自然标本'
    const payload = {
      title: `我在山海造物鉴定了「${zh}」`,
      path: id
        ? `/subpackages/feature/identify/result/index?record_id=${id}`
        : '/subpackages/feature/identify/index',
      imageUrl: this.data.posterPath || ''
    }
    return this.markShared().then(() => payload).catch(() => payload)
  },

  initCanvas() {
    return new Promise((resolve) => {
      const query = wx.createSelectorQuery().in(this)
      query
        .select('#posterCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res[0] || !res[0].node) {
            this.setData({ generating: false, genText: '画布初始化失败' })
            resolve()
            return
          }
          const canvas = res[0].node
          const ctx = canvas.getContext('2d')
          const dpr = wx.getSystemInfoSync().pixelRatio || 2
          canvas.width = W * dpr
          canvas.height = H * dpr
          ctx.scale(dpr, dpr)
          this.canvas = canvas
          this.ctx = ctx
          this.dpr = dpr
          resolve()
        })
    })
  },

  async bootstrapDraw() {
    const { recordId } = this.data

    if (!recordId) {
      this.setData({ generating: false, genText: '缺少记录' })
      return
    }

    this.setData({ generating: true, genText: '获取小程序码与图片…' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'generateSharePoster',
        data: { record_id: recordId, env_version: currentEnvVersion() }
      })
      const r = res.result
      if (!r || !r.success) {
        throw new Error((r && r.msg) || '生成素材失败')
      }
      const d = r.data
      const specPath = await downloadToLocal(d.specimenTempUrl)
      const qrPath = await downloadToLocal(d.qrTempUrl)
      this.assets = {
        specimenPath: specPath,
        qrPath,
        species_name_zh: d.species_name_zh,
        species_name_latin: d.species_name_latin,
        fun_fact: d.fun_fact || d.brief || '',
        protection_label: d.protection_label || '',
        poster_title: d.poster_title,
        brand_sub: d.brand_sub,
        brand_en: d.brand_en
      }
      this.setData({
        hasAssets: true,
        genText: '绘制海报…',
        sharedReady: true,
        speciesNameZh: d.species_name_zh || ''
      })
      await this.drawPoster()
    } catch (e) {
      console.error(e)
      this.setData({ generating: false, genText: e.message || '加载失败' })
      // 海报失败时仍尝试公开，方便用户改用右上角转发
      this.markShared()
      wx.showToast({ title: '素材获取失败', icon: 'none' })
    }
  },

  loadImage(canvas, src) {
    return new Promise((resolve, reject) => {
      if (!src) {
        resolve(null)
        return
      }
      const img = canvas.createImage()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = src
    })
  },

  async drawPoster() {
    const ctx = this.ctx
    const canvas = this.canvas
    if (!ctx || !canvas || !this.assets) {
      this.setData({ generating: false })
      return
    }

    const a = this.assets
    try {
    ctx.save()
    ctx.fillStyle = '#0e0e12'
    ctx.fillRect(0, 0, W, H)

    // 顶部金线
    const grd = ctx.createLinearGradient(0, 0, W, 0)
    grd.addColorStop(0, 'rgba(196, 167, 108,0)')
    grd.addColorStop(0.5, 'rgba(196, 167, 108,0.55)')
    grd.addColorStop(1, 'rgba(196, 167, 108,0)')
    ctx.fillStyle = grd
    ctx.fillRect(40, 36, W - 80, 3)

    // 标本图
    try {
      const img = await this.loadImage(canvas, a.specimenPath)
      if (img) {
        const ih = 520
        const iw = W - 80
        const sx = 0
        const sy = 0
        const sw = img.width
        const sh = img.height
        const r = Math.min(iw / sw, ih / sh)
        const dw = sw * r
        const dh = sh * r
        const dx = 40 + (iw - dw) / 2
        const dy = 70
        ctx.save()
        ctx.beginPath()
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(40, 70, iw, ih, 16)
        } else {
          ctx.rect(40, 70, iw, ih)
        }
        ctx.clip()
        ctx.drawImage(img, dx, dy, dw, dh)
        ctx.restore()
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.06)'
        ctx.fillRect(40, 70, W - 80, 520)
        ctx.fillStyle = 'rgba(255,255,255,0.35)'
        ctx.font = '24px sans-serif'
        ctx.fillText('暂无藏品图', W / 2 - 80, 320)
      }
    } catch (e) {
      console.warn('标本图绘制失败', e)
    }

    // 文案区
    let y = 620
    ctx.fillStyle = '#C4A76C'
    ctx.font = 'bold 30px sans-serif'
    ctx.fillText(a.poster_title || '山海造物 · AI 标本鉴定', 48, y)
    y += 48

    ctx.fillStyle = '#f5f0e6'
    ctx.font = 'bold 40px sans-serif'
    const nameLines = wrapLines(a.species_name_zh || '未知物种', 12, 2)
    nameLines.forEach((line) => {
      ctx.fillText(line, 48, y)
      y += 52
    })

    ctx.fillStyle = 'rgba(255,255,255,0.45)'
    ctx.font = 'italic 26px sans-serif'
    const latin = a.species_name_latin || ''
    ctx.fillText(latin.length > 40 ? `${latin.slice(0, 38)}…` : latin, 48, y + 8)
    y += 48

    if (a.protection_label) {
      ctx.fillStyle = '#C4A76C'
      ctx.font = '22px sans-serif'
      const prot = a.protection_label.length > 28 ? `${a.protection_label.slice(0, 26)}…` : a.protection_label
      ctx.fillText(`保护等级 · ${prot}`, 48, y + 8)
      y += 48
    } else {
      y += 8
    }

    ctx.fillStyle = 'rgba(255,255,255,0.78)'
    ctx.font = '24px sans-serif'
    const factLines = wrapLines(a.fun_fact || '探索自然，从一枚藏品开始。', 18, 4)
    factLines.forEach((line) => {
      ctx.fillText(line, 48, y)
      y += 36
    })

    ctx.fillStyle = 'rgba(196, 167, 108,0.35)'
    ctx.font = '22px sans-serif'
    ctx.fillText(a.brand_sub || '把山海带回家', 48, y)
    if (a.brand_en) {
      y += 28
      ctx.fillStyle = 'rgba(255,255,255,0.28)'
      ctx.font = '18px sans-serif'
      ctx.fillText(a.brand_en, 48, y)
    }

    // VIS 3.0 品牌落款：方寸篆印描边版，左下与小程序码底边对齐
    drawBrandSeal(ctx, 48 + 32, H - 48 - 32, 64, { color: '#C4A76C', filled: false })

    // 小程序码
    const qrSize = 200
    const qx = W - 48 - qrSize
    const qy = H - 48 - qrSize
    try {
      if (a.qrPath) {
        const qr = await this.loadImage(canvas, a.qrPath)
        if (qr) {
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(qx - 8, qy - 8, qrSize + 16, qrSize + 16)
          ctx.drawImage(qr, qx, qy, qrSize, qrSize)
        }
      } else {
        ctx.strokeStyle = 'rgba(196, 167, 108,0.4)'
        ctx.strokeRect(qx, qy, qrSize, qrSize)
        ctx.fillStyle = 'rgba(255,255,255,0.4)'
        ctx.font = '20px sans-serif'
        ctx.fillText('扫码查看', qx + 48, qy + qrSize / 2)
        ctx.fillText('鉴定结果', qx + 48, qy + qrSize / 2 + 28)
      }
    } catch (e) {
      console.warn('二维码绘制失败', e)
    }

    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.font = '20px sans-serif'
    ctx.fillText('长按识别小程序', qx - 8, H - 24)

    ctx.restore()

    this.exportPoster()
    } catch (err) {
      console.error(err)
      this.setData({ generating: false, genText: '绘制失败', posterReady: false })
    }
  },

  exportPoster() {
    const canvas = this.canvas
    if (!canvas) {
      this.setData({ generating: false })
      return
    }
    wx.canvasToTempFilePath({
      canvas,
      width: W,
      height: H,
      destWidth: W * this.dpr,
      destHeight: H * this.dpr,
      fileType: 'png',
      quality: 1,
      success: (r) => {
        this.setData({
          generating: false,
          genText: '',
          posterReady: true,
          posterPath: r.tempFilePath
        })
      },
      fail: (err) => {
        console.error(err)
        this.setData({ generating: false, genText: '导出失败' })
      }
    })
  },

  onRedraw() {
    if (!this.assets) return
    this.setData({ generating: true, genText: '绘制中…', posterReady: false })
    this.drawPoster()
  },

  onSaveAlbum() {
    const p = this.data.posterPath
    if (!p) return
    wx.saveImageToPhotosAlbum({
      filePath: p,
      success: () => wx.showToast({ title: '已保存', icon: 'success' }),
      fail: (err) => {
        if (err.errMsg && err.errMsg.includes('auth')) {
          wx.openSetting({})
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' })
        }
      }
    })
  },

  onPreview() {
    const p = this.data.posterPath
    if (p) wx.previewImage({ urls: [p], current: p })
  },

  onBack() {
    const id = this.data.recordId
    const fallback = id
      ? `/subpackages/feature/identify/result/index?record_id=${id}`
      : '/subpackages/feature/identify/index'
    wx.navigateBack({
      fail: () => wx.redirectTo({
        url: fallback,
        fail: () => wx.reLaunch({ url: '/subpackages/feature/identify/index' })
      })
    })
  }
})
