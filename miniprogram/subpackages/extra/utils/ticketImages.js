/**
 * 留言附图（联系专员 / 意见反馈共用，分包旁路）
 * wx.chooseMedia → 宽 > 1280 压缩 → wx.cloud.uploadFile → 只把 cloud:// fileID 交给 submitSupportTicket。
 * 路径 support-tickets/<年月>/<时间戳>_<随机>.jpg：桶不可公开列举，fileID 只经本人提交与管理端读出（与 identify/ 同口径）。
 * 页面 data.ticketImages = [{ key, local, fileID, status: 'uploading' | 'done' | 'failed' }]
 */
const MAX_TICKET_IMAGES = 3
const IMAGE_EDGE = 1280
const DIR = 'support-tickets'

/** compressedWidth 只在原图更宽时传（它会放大小图）；压缩失败 / 基础库不支持回落原图 */
function compress(src) {
  return new Promise((resolve) => {
    if (typeof wx.compressImage !== 'function') return resolve(src)
    const run = (width) => {
      const opts = { src, quality: 80, success: (r) => resolve((r && r.tempFilePath) || src), fail: () => resolve(src) }
      if (width > IMAGE_EDGE && wx.canIUse && wx.canIUse('compressImage.object.compressedWidth')) opts.compressedWidth = IMAGE_EDGE
      wx.compressImage(opts)
    }
    wx.getImageInfo({ src, success: (i) => run(Number(i && i.width) || 0), fail: () => run(0) })
  })
}

function cloudPathOf(local) {
  const d = new Date()
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
  const ext = ((/\.(jpe?g|png|webp)$/i.exec(local || '') || [])[1] || 'jpg').toLowerCase()
  return `${DIR}/${ym}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
}

async function uploadLocal(local) {
  const filePath = await compress(local)
  const up = await wx.cloud.uploadFile({ cloudPath: cloudPathOf(filePath), filePath })
  const fileID = up && up.fileID
  if (typeof fileID !== 'string' || fileID.indexOf('cloud://') !== 0) throw new Error('no fileID')
  return fileID
}

/** 提交前汇总：uploading / failed 任一为真时提交按钮不可点；fileIDs 只含已上传成功的 */
function ticketImageState(list) {
  const arr = Array.isArray(list) ? list : []
  return {
    uploading: arr.some((x) => x.status === 'uploading'),
    failed: arr.filter((x) => x.status === 'failed').length,
    fileIDs: arr.filter((x) => x.status === 'done' && x.fileID).map((x) => x.fileID)
  }
}

/** 混入 Page：chooseTicketImages / removeTicketImage / retryTicketImage / previewTicketImage */
function ticketImageMethods() {
  return {
    _setTicketImages(list) {
      const s = ticketImageState(list)
      this.setData({ ticketImages: list, ticketImgBusy: s.uploading || s.failed > 0, ticketImgFailed: s.failed })
    },

    _patchTicketImage(key, patch) {
      const list = (this.data.ticketImages || []).map((x) => (x.key === key ? { ...x, ...patch } : x))
      this._setTicketImages(list)
    },

    async _uploadTicketImage(item) {
      try {
        const fileID = await uploadLocal(item.local)
        this._patchTicketImage(item.key, { fileID, status: 'done' })
      } catch (e) {
        this._patchTicketImage(item.key, { fileID: '', status: 'failed' })
      }
    },

    chooseTicketImages() {
      const left = MAX_TICKET_IMAGES - (this.data.ticketImages || []).length
      if (left <= 0 || this.data.submitting) return
      wx.chooseMedia({
        count: left,
        mediaType: ['image'],
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: async (res) => {
          const picked = (res.tempFiles || []).map((f) => (f && f.tempFilePath) || '').filter(Boolean)
          const room = MAX_TICKET_IMAGES - (this.data.ticketImages || []).length
          const added = picked.slice(0, Math.max(0, room)).map((local, i) => ({
            key: `${Date.now()}_${i}`,
            local,
            fileID: '',
            status: 'uploading'
          }))
          if (!added.length) return
          this._setTicketImages((this.data.ticketImages || []).concat(added))
          for (const item of added) await this._uploadTicketImage(item)
        }
      })
    },

    removeTicketImage(e) {
      const key = e.currentTarget.dataset.key
      this._setTicketImages((this.data.ticketImages || []).filter((x) => x.key !== key))
    },

    retryTicketImage(e) {
      const key = e.currentTarget.dataset.key
      const item = (this.data.ticketImages || []).find((x) => x.key === key)
      if (!item || item.status !== 'failed') return
      this._patchTicketImage(key, { status: 'uploading' })
      this._uploadTicketImage(item)
    },

    previewTicketImage(e) {
      const urls = (this.data.ticketImages || []).map((x) => x.local).filter(Boolean)
      if (urls.length) wx.previewImage({ urls, current: e.currentTarget.dataset.url || urls[0] })
    }
  }
}

module.exports = { MAX_TICKET_IMAGES, ticketImageState, ticketImageMethods }
