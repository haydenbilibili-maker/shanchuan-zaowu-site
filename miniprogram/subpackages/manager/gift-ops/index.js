/**
 * 店长 · 礼赠履约看板
 * 待填址 / 待发货 / 自提待核销 / 已完成
 */
const { guardStaffPage, goStaffConsole } = require('../utils/staffAuth')
const { formatCloudFnError } = require('../utils/memberScan')
// 相册权限被拒时给「去设置」出口 —— 走全站样式化弹窗（`utils/appModal`），
// 不用裸 wx.showModal（全站在迁移，且 check:dialog-ratchet 盯着原生弹窗数）
const { withAppModal } = require('../../../utils/appModal')

// 印刷版礼笺导出需按标题回查 products（题记/藏品图）；履约页此前不直连数据库
const db = wx.cloud.database()

const BUCKETS = [
  { key: 'awaiting_address', label: '待填址' },
  { key: 'awaiting_ship', label: '待发货' },
  { key: 'pickup_verify', label: '自提核销' },
  { key: 'done', label: '已完成' }
]

const EMPTY_COPY = {
  awaiting_address: {
    title: '暂无待填址',
    hint: '邀请对方填地址的礼赠，支付后会出现在这里'
  },
  awaiting_ship: {
    title: '暂无待发货',
    hint: '地址齐全后会进入本栏，可去发货'
  },
  pickup_verify: {
    title: '暂无待核销',
    hint: '门店自提单备妥后会出现在这里'
  },
  done: {
    title: '暂无已完成单',
    hint: '签收、妥投或退款完成后会出现在这里'
  }
}

const DELIVERY_TONE = {
  invite_address: 'tone-invite',
  ship_to_receiver: 'tone-ship',
  ship_to_self: 'tone-self',
  store_pickup: 'tone-pickup'
}

const DELIVERY_SOFT = {
  invite_address: '待填址',
  ship_to_receiver: '快递给 TA',
  ship_to_self: '寄给我',
  store_pickup: '门店自提'
}

function softNote(note) {
  const t = String(note || '')
  if (!t) return ''
  if (/200/.test(t)) return '列表基于最近约 200 笔礼赠单'
  return t
}

function enrichItem(raw) {
  const item = Object.assign({}, raw || {})
  const deliveryType = item.deliveryType || 'invite_address'
  item.deliveryLabel = DELIVERY_SOFT[deliveryType] || item.deliveryLabel || deliveryType
  item.deliveryTone = DELIVERY_TONE[deliveryType] || ''

  let urgencyLabel = ''
  let urgencyClass = ''
  if (item.expireAt) {
    const end = new Date(item.expireAt).getTime()
    if (!Number.isNaN(end)) {
      const days = Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000))
      if (days < 0) {
        urgencyLabel = '已过期'
        urgencyClass = 'urgent'
      } else if (days === 0) {
        urgencyLabel = '今日截止'
        urgencyClass = 'urgent'
      } else if (days <= 2) {
        urgencyLabel = `剩 ${days} 日`
        urgencyClass = 'soon'
      } else if (days <= 5) {
        urgencyLabel = `剩 ${days} 日`
      }
    }
  }
  item.urgencyLabel = urgencyLabel
  item.urgencyClass = urgencyClass
  return item
}

function matchKeyword(item, kw) {
  if (!kw) return true
  const hay = [
    item.orderNo,
    item.orderId,
    item.productTitle,
    item.recipientName,
    item.storeName,
    item.claimCode,
    item.address && item.address.name,
    item.address && item.address.phone,
    item.address && item.address.line
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return hay.indexOf(kw) !== -1
}

Page(withAppModal({
  data: {
    ready: false,
    loading: false,
    loadError: '',
    buckets: BUCKETS,
    bucket: 'awaiting_address',
    counts: {
      awaiting_address: 0,
      awaiting_ship: 0,
      pickup_verify: 0,
      done: 0
    },
    list: [],
    displayList: [],
    keyword: '',
    page: 1,
    hasMore: false,
    total: 0,
    note: '',
    expandedId: '',
    emptyTitle: EMPTY_COPY.awaiting_address.title,
    emptyHint: EMPTY_COPY.awaiting_address.hint,
    /**
     * 导出预览态（null = 未生成）。**生成后先看再动**：
     * 印刷类导出的最大风险是"印错"（受礼人姓名/正文/规格），而原实现一点即存相册并上传，没有回看机会。
     * 结构：{ spec, specLabel, specNote, path, fileName, orderId, saving, saving2, saved, uploading, uploaded, fileID }
     */
    printPreview: null,
    /** 导出进行中：两个导出按钮都禁用（防重复点，也给出可见的进行态） */
    exporting: false,
    /** 页内轻提示（AppToast，非阻塞；不用裸 wx.showToast） */
    toastShow: false,
    toastOverline: '',
    toastTitle: '',
    toastDesc: '',
    /** 最近导出（可追溯：规格 + 文件名，可长按复制）——解决"上传的文件去哪了" */
    recentPrints: []
  },

  onLoad(options) {
    const bucket = String((options && options.bucket) || '').trim()
    if (bucket && BUCKETS.some((b) => b.key === bucket)) {
      this.setData({ bucket })
      this.applyEmptyCopy(bucket)
    }
    this.bootstrap()
  },

  onShow() {
    if (this.data.ready) this.loadList(true)
  },

  onPullDownRefresh() {
    this.loadList(true).finally(() => wx.stopPullDownRefresh())
  },

  applyEmptyCopy(bucket) {
    const copy = EMPTY_COPY[bucket] || EMPTY_COPY.awaiting_address
    this.setData({
      emptyTitle: copy.title,
      emptyHint: copy.hint
    })
  },

  applyFilter() {
    const kw = String(this.data.keyword || '')
      .trim()
      .toLowerCase()
    const displayList = (this.data.list || []).filter((item) => matchKeyword(item, kw))
    this.setData({ displayList })
  },

  async bootstrap() {
    const role = await guardStaffPage('manager')
    if (!role) return
    const canGift =
      !!(role.isSuperAdmin || role.superAdmin) ||
      (role.permissions || []).indexOf('giftOps') !== -1 ||
      (role.permissions || []).indexOf('manageGift') !== -1
    if (!canGift) {
      this.setData({
        ready: false,
        loadError: '当前账号无礼赠履约权限，请联系超管开通'
      })
      this.toast('无礼赠履约权限', '请用店长/专员账号访问')
      setTimeout(() => {
        wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
      }, 1200)
      return
    }
    this.setData({ ready: true })
    this.loadList(true)
  },

  retryLoad() {
    this.loadList(true)
  },

  switchBucket(e) {
    const key = String((e.currentTarget.dataset && e.currentTarget.dataset.key) || '').trim()
    if (!key || key === this.data.bucket) return
    this.setData({ bucket: key, expandedId: '' })
    this.applyEmptyCopy(key)
    this.loadList(true)
  },

  onKeywordInput(e) {
    this.setData({ keyword: (e.detail && e.detail.value) || '' }, () => this.applyFilter())
  },

  onKeywordConfirm() {
    this.applyFilter()
  },

  clearKeyword() {
    this.setData({ keyword: '' }, () => this.applyFilter())
  },

  async loadList(reset) {
    if (this.data.loading) return
    const page = reset ? 1 : this.data.page + 1
    this.setData({
      loading: true,
      loadError: reset ? '' : this.data.loadError
    })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageGift',
        data: {
          action: 'listBoard',
          bucket: this.data.bucket,
          page,
          pageSize: 20
        }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        throw new Error(result.msg || '加载失败')
      }
      const mapped = (result.list || []).map(enrichItem)
      const nextList = reset ? mapped : (this.data.list || []).concat(mapped)
      this.setData(
        {
          loading: false,
          list: nextList,
          page: result.page || page,
          hasMore: !!result.hasMore,
          total: result.total || 0,
          counts: result.counts || this.data.counts,
          note: softNote(result.note),
          loadError: ''
        },
        () => this.applyFilter()
      )
    } catch (e) {
      console.warn('gift board', e)
      this.setData({
        loading: false,
        loadError: formatCloudFnError(e, '礼赠看板暂不可用'),
        list: reset ? [] : this.data.list,
        displayList: reset ? [] : this.data.displayList
      })
    }
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.loadList(false)
  },

  toggleExpand(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim()
    this.setData({ expandedId: this.data.expandedId === id ? '' : id })
  },

  goOrderManage() {
    wx.navigateTo({
      url: '/subpackages/manager/manager/workspace/index?tab=2&title=' + encodeURIComponent('订单管理'),
      fail: () => this.toast('请从订单管理发货', '本页只处理礼赠履约')
    })
  },

  goVerify() {
    goStaffConsole('verify')
  },

  /**
   * 导出印刷版礼笺卡（默认 **A6 竖版 @300dpi**，含题记带）—— 供礼赠卡印刷使用。
   * 礼笺正文/署名取自 getBoardDetail；题记与藏品图按标题回查 products（订单看板项不含商品 id）。
   * 落盘：先存相册（便于当场核对），再上传云存储（印刷厂取件）。
   */
  async onExportGiftCard(e) {
    return this._exportGiftPrint(e, 'a6')
  },

  /** 导出热敏不干胶**贴纸**版（90×110mm 白区，近方形版式）—— 与 A6 并列的入口 */
  async onExportGiftSticker(e) {
    return this._exportGiftPrint(e, 'sticker')
  },

  /**
   * 导出印刷版礼笺（**A6 与贴纸共用这一条实现**，只有 spec 不同）。
   * 为什么不复制第二份：落盘/上传/错误提示/并发锁 完全相同，
   * 复制一份必然漂移（真图 bug 的常见来源），故按 spec 参数分派。
   * @param {'a6'|'sticker'} spec
   */
  async _exportGiftPrint(e, spec) {
    const orderId = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim()
    if (!orderId || this._exportingCard) return
    this._exportingCard = true
    this.setData({ exporting: true })
    wx.showLoading({ title: '生成中…', mask: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'manageGift', data: { action: 'getBoardDetail', orderId } })
      const d = (res && res.result) || {}
      if (!d.success) throw new Error(d.msg || '读取礼笺失败')
      const cardBody = String(d.cardBody || '').trim()
      const cardSignature = String(d.cardSignature || '').trim()
      if (!cardBody) throw new Error('这一单没有礼笺正文')
      const item = d.item || {}
      const productTitle = String(item.productTitle || '').trim()
      const productId = String(d.productId || '').trim()
      // 题记 + 藏品图：**优先按 productId 精确取**（getBoardDetail 已返回）；
      // 云函数未部署新版时（无 productId）回退按标题回查 —— 兼容部署窗口
      let themeName = ''; let themeNote = ''; let specimenFileID = ''
      if (productId || productTitle) {
        try {
          const q = productId
            ? db.collection('products').doc(productId)
            : db.collection('products').where({ title: productTitle }).limit(1)
          const pr = await q
            .field({ themeName: true, themeNote: true, images: true, image: true })
            .get()
          const row = productId ? ((pr && pr.data) || {}) : ((pr && pr.data && pr.data[0]) || {})
          themeName = String(row.themeName || '').trim()
          themeNote = String(row.themeNote || '').trim()
          specimenFileID = (row.images && row.images[0]) || row.image || ''
        } catch (err) { /* 回查失败不阻断出卡 */ }
      }
      const { renderGiftPrintImage } = require('../../../utils/giftShareCard')
      const isSticker = spec === 'sticker'
      const path = await renderGiftPrintImage('#giftPrintCanvas', this, {
        cardBody, cardSignature, themeName, themeNote, specimenFileID,
        // 规格：A6 默认 / 贴纸传 'sticker'（渲染器按规格分派版式，见 utils/giftShareCard.js）
        spec: isSticker ? 'sticker' : 'a6',
        // 详情（mapBoardItem）不含 recipientName（那是列表侧客户端派生的）→ 以 address.name 为准
        // 受礼人姓名：**以 giftMeta.recipientName 为准**（实测 ORDMU5HRWP4829：
      //   recipientName/salutation = 「虞博阳&王瑛」；而 address.name 只是收件人「王瑛」✗ 会印错）。
      // 依次回退 salutation → toName → address.name；为空则卡上**不印**「写给」行。
      recipientName: item.recipientName || item.salutation || item.toName || (item.address && item.address.name) || '',
      // 两枚码：小程序码（分包内素材）+ 客服微信（仓库现有主包素材）；缺失各自静默跳过
      qrcodePath: '/subpackages/manager/assets/qrcode/miniprogram-code-print.png',
      serviceQrPath: '/assets/qrcode/wechat-assistant-qr-print.png',
    })
      if (!path) throw new Error('生成失败，请重试')
      // ⚠️ 这里**不再**自动存相册/上传：先生成到预览态，由运营看一眼再决定
      //（原名单位置错了会直接印出去；预览是印刷类导出最低成本的防错手段）
      const ts = Date.now()
      this.setData({
        printPreview: {
          spec,
          specLabel: isSticker ? '热敏不干胶贴纸 90×110mm（白区 75×69mm）' : 'A6 竖版 105×148mm @300dpi',
          specNote: isSticker
            ? '近方形版式；内容已避开右下预印印章区'
            : '含题记带与页脚两码；满幅无黑边',
          path,
          orderId,
          fileName: `${orderId}-${isSticker ? 'sticker' : 'a6'}-${ts}.png`,
          saving: false,
          saved: false,
          uploading: false,
          uploaded: false,
          fileID: ''
        }
      })
    } catch (err) {
      this.toast('导出失败', (err && err.message) || '请重试')
    } finally {
      wx.hideLoading()
      this._exportingCard = false
      this.setData({ exporting: false })
    }
  },

  /** 页内轻提示（AppToast）：非阻塞、主视觉一致 */
  toast(title, desc, overline) {
    this.setData({ toastShow: true, toastTitle: title || '', toastDesc: desc || '', toastOverline: overline || '' })
    try { wx.vibrateShort({ type: 'light' }) } catch (e) { /* 震动失败无关紧要 */ }
  },

  onToastClose() {
    if (this.data.toastShow) this.setData({ toastShow: false })
  },

  /** 预览层遮罩：吞掉滚动穿透（catchtouchmove 需要一个真实处理器） */
  noop() {},

  closePrintPreview() {
    if (!this.data.printPreview) return
    this.setData({ printPreview: null })
  },

  /**
   * 保存到相册。被拒时给**可执行的出口**（去设置 → 授权后自动重试一次），
   * 而不是只弹一句"可检查相册权限"就结束。
   */
  async savePrintToAlbum() {
    const pv = this.data.printPreview
    if (!pv || pv.saving) return
    this.setData({ 'printPreview.saving': true })
    try {
      await new Promise((ok, no) => wx.saveImageToPhotosAlbum({ filePath: pv.path, success: ok, fail: no }))
      this.setData({ 'printPreview.saved': true, 'printPreview.saving': false })
      this.toast('已存相册', '可直接去打印店输出', 'GIFT PRINT')
    } catch (err) {
      this.setData({ 'printPreview.saving': false })
      const msg = String((err && (err.errMsg || err.message)) || '')
      const denied = /auth|deny|denied|permission|cancel/i.test(msg)
      if (!denied) {
        this.toast('未存相册', msg || '请重试')
        return
      }
      const res = await this.modal({
        overline: 'ALBUM PERMISSION',
        title: '需要相册权限',
        content: '保存印刷图需要「保存到相册」权限。已拒绝过授权时，需在设置页重新打开。',
        confirmText: '去设置',
        cancelText: '稍后'
      })
      if (!res.confirm) return
      try {
        const setting = await new Promise((ok) => wx.openSetting({ success: ok, fail: () => ok({ authSetting: {} }) }))
        const granted = !!(setting && setting.authSetting && setting.authSetting['scope.writePhotosAlbum'])
        if (!granted) {
          this.toast('仍未授权', '在「设置 → 相册」里打开后可再试')
          return
        }
        await new Promise((ok, no) => wx.saveImageToPhotosAlbum({ filePath: pv.path, success: ok, fail: no }))
        this.setData({ 'printPreview.saved': true })
        this.toast('已存相册', '授权后已自动重试成功', 'GIFT PRINT')
      } catch (e2) {
        this.toast('仍未存成功', String((e2 && e2.errMsg) || '请重试'))
      }
    }
  },

  /** 上传印刷文件到云端（失败可**单独重试**，预览与相册都还在） */
  async uploadPrintFile() {
    const pv = this.data.printPreview
    if (!pv || pv.uploading) return
    this.setData({ 'printPreview.uploading': true })
    try {
      const up = await wx.cloud.uploadFile({ cloudPath: `gift-print/${pv.fileName}`, filePath: pv.path })
      this.setData({
        'printPreview.uploading': false,
        'printPreview.uploaded': true,
        'printPreview.fileID': (up && up.fileID) || ''
      })
      const recent = [{ fileName: pv.fileName, spec: pv.spec, specLabel: pv.specLabel, at: Date.now() }]
        .concat(this.data.recentPrints || [])
        .slice(0, 5)
      this.setData({ recentPrints: recent })
      this.toast(pv.spec === 'sticker' ? '已上传贴纸文件' : '已上传印刷文件', pv.fileName, 'GIFT PRINT')
    } catch (err) {
      this.setData({ 'printPreview.uploading': false })
      this.toast('上传失败', '相册里已有原图，可再试一次')
    }
  },

  /** 长按复制文件名：上传后的文件在云存储里按这个名字找得到 */
  copyPrintFileName(e) {
    const name = String((e.currentTarget.dataset && e.currentTarget.dataset.name) || (this.data.printPreview && this.data.printPreview.fileName) || '')
    if (!name) return
    wx.setClipboardData({
      data: name,
      success: () => this.toast('已复制文件名', name),
      fail: () => this.toast('复制失败', '请手动记录')
    })
  },

  copyOrderNo(e) {
    const no = String((e.currentTarget.dataset && e.currentTarget.dataset.no) || '').trim()
    if (!no) {
      this.toast('暂无单号', '刷新后再试')
      return
    }
    wx.setClipboardData({
      data: no,
      success: () => this.toast('已复制单号', no),
    })
  }
}))
