/**
 * 出货中心 · SKU 页签（店长看到的是「资料」）：SKU 目录（parts/skus.js，仅超管）/ 原材料 / 包装方式。店长只读，写入口与服务端均仅超管。
 * priceBook.update 整行覆盖 → 经 toPayload() 回送整行；删除只走 removeIfUnused（有引用即拒）。
 */
const { formatCloudFnError } = require('../../utils/memberScan')
const { SETTLEMENT_FN, callCloud, yuan } = require('./shared')
const { railUrl, detailUrl, onImageError } = require('../../../../utils/imageUrl')
const { skuImpactOf, impactText } = require('./skus')

/** 资料图云存储目录：studio-pricebook/<kind>/<时间戳>_<随机>.<ext> */
const LIB_IMAGE_DIR = 'studio-pricebook'
/** 上传前按边长压到 ≤ 1280（基础库不支持就只降质量） */
const LIB_IMAGE_EDGE = 1280

const KIND_META = {
  material: { label: '原材料', optionLabel: '等级', optionKey: 'grade', defaultKey: 'isDefaultGrade' },
  packaging: { label: '包装方式', optionLabel: '尺寸', optionKey: 'size', defaultKey: 'isDefaultSize' }
}

function normKey(name) {
  return String(name || '').replace(/\s+/g, '').toLowerCase()
}

/** 压缩失败 / 基础库不支持都回落原图；compressedWidth 只在原图更宽时传（它会放大小图） */
function compressLibImage(src) {
  return new Promise((resolve) => {
    if (typeof wx.compressImage !== 'function') return resolve(src)
    const run = (width) => {
      const opts = { src, quality: 80, success: (r) => resolve((r && r.tempFilePath) || src), fail: () => resolve(src) }
      if (width > LIB_IMAGE_EDGE && wx.canIUse && wx.canIUse('compressImage.object.compressedWidth')) opts.compressedWidth = LIB_IMAGE_EDGE
      wx.compressImage(opts)
    }
    wx.getImageInfo({ src, success: (i) => run(Number(i && i.width) || 0), fail: () => run(0) })
  })
}

/** mapRow 形状 → priceBook 写入形状（整行） */
function toPayload(kind, row, patch) {
  const meta = KIND_META[kind] || KIND_META.material
  const src = Object.assign({}, row, patch || {})
  const out = {
    name: String(src.name || '').trim(),
    displayName: src.displayName && src.displayName !== src.name ? src.displayName : '',
    aliases: Array.isArray(src.aliases) ? src.aliases : [],
    unitPrice: Number(src.unitPrice),
    qtyPerUnit: Number(src.qtyPerUnit) > 0 ? Number(src.qtyPerUnit) : 1,
    unit: String(src.unit || '').trim(),
    status: src.status === 'inactive' ? 'inactive' : 'active',
    note: String(src.note || '').trim(),
    sort: Number(src.sort) || 0
  }
  out[meta.optionKey] = String(src.option || '').trim()
  out[meta.defaultKey] = src.isDefaultOption === true
  if (kind === 'material') out.category = String(src.category || '')
  // 行上没有 image 键（旧版云函数的 mapRow）就不送，服务端不动库里的图
  if (src.image !== undefined) out.image = String(src.image || '')
  return out
}

function viewRow(r) {
  return Object.assign({}, r, {
    thumb: r.image ? railUrl(r.image) : '',
    inactive: r.status === 'inactive',
    unitPriceText: '¥' + yuan(Math.round((Number(r.unitPrice) || 0) * 100)),
    aliasesText: (r.aliases || []).join('、'),
    refText:
      r.refUnitPrice === null || r.refUnitPrice === undefined
        ? ''
        : `参考采购 ¥${yuan(Math.round(Number(r.refUnitPrice) * 100))}`
  })
}

function blankLibForm(kind) {
  return {
    show: false,
    saving: false,
    id: '',
    kind,
    name: '',
    option: '',
    unitPrice: '',
    unit: '',
    aliases: '',
    category: '',
    isDefault: false,
    note: '',
    image: '',
    imageThumb: '',
    uploading: false,
    impactText: '',
    problems: ''
  }
}

const data = {
  /** 子视图：sku（SKU 目录，仅超管）| material | packaging */
  libView: '',
  libKind: 'material',
  libKeyword: '',
  libLoading: false,
  libError: '',
  libList: [],
  libTotal: 0,
  libTruncated: false,
  libBusy: false,
  libTip: '',
  libTipTone: 'info',
  libConfirmId: '',
  libBlocked: { id: '', text: '', canDeactivate: false },
  libCategoryNames: ['不分类', '标本', '耗材', '工具'],
  libCategoryValues: ['', '标本', '耗材', '工具'],
  libCategoryIndex: 0,
  libForm: blankLibForm('material')
}

const methods = {
  /** view：sku | material | packaging；不传 = 上次停留，超管首次进 SKU 目录、店长进原材料 */
  enterLibrary(view) {
    const want = view === 'sku' || KIND_META[view] ? view : this.data.libView || (this.data.isSuper ? 'sku' : this.data.libKind)
    const libView = want === 'sku' && !this.data.isSuper ? this.data.libKind : want
    if (KIND_META[libView] && libView !== this.data.libKind) {
      this._libAll = null
      this.setData({ libKind: libView, libKeyword: '', libList: [], libTip: '', libConfirmId: '', 'libBlocked.id': '' })
    }
    this.setData({ libView })
    if (this.data.isSuper && !this._libMetaLoaded) {
      this._libMetaLoaded = true
      callCloud(SETTLEMENT_FN, { action: 'meta' })
        .then((r) => {
          const opts = Array.isArray(r.categoryOptions) ? r.categoryOptions : []
          if (opts.length) {
            this.setData({ libCategoryNames: ['不分类'].concat(opts), libCategoryValues: [''].concat(opts) })
          }
        })
        .catch(() => {
          this._libMetaLoaded = false
        })
    }
    if (libView === 'sku') this.enterSkuCatalog()
    else if (!this._libAll) this.loadLibrary()
  },

  switchLibKind(e) {
    const kind = String((e.currentTarget.dataset || {}).kind || '')
    if (kind === 'sku') {
      if (this.data.isSuper && this.data.libView !== 'sku') {
        this.setData({ libView: 'sku' })
        this.enterSkuCatalog()
      }
      return
    }
    if (!KIND_META[kind]) return
    if (kind === this.data.libKind) {
      if (this.data.libView !== kind) {
        this.setData({ libView: kind })
        if (!this._libAll) this.loadLibrary()
      }
      return
    }
    this._libAll = null
    this.setData({ libView: kind, libKind: kind, libKeyword: '', libList: [], libTip: '', libConfirmId: '', 'libBlocked.id': '' }, () => this.loadLibrary())
  },

  loadLibrary() {
    const kind = this.data.libKind
    this.setData({ libLoading: true, libError: '' })
    return callCloud(SETTLEMENT_FN, { action: 'priceBook.list', kind, status: '', limit: 200, orderBy: 'sort' })
      .then((r) => {
        if (kind !== this.data.libKind) return
        this._libAll = r.list || []
        this.setData({ libLoading: false, libTotal: Number(r.total) || this._libAll.length, libTruncated: !!r.truncated })
        this.applyLibFilter()
      })
      .catch((e) => {
        this.setData({ libLoading: false, libError: formatCloudFnError(e, `${KIND_META[kind].label}未能取回`) })
      })
  },

  applyLibFilter() {
    const all = this._libAll || []
    const kw = normKey(this.data.libKeyword)
    const list = kw
      ? all.filter((r) => [r.name].concat(r.aliases || []).some((t) => normKey(t).indexOf(kw) !== -1))
      : all
    this.setData({ libList: list.map(viewRow) })
  },

  onLibKeyword(e) {
    this.setData({ libKeyword: String(e.detail.value || '') }, () => this.applyLibFilter())
  },

  findLibRow(id) {
    return (this._libAll || []).find((r) => r._id === id) || null
  },

  async toggleLibStatus(e) {
    const id = String((e.currentTarget.dataset || {}).id || '')
    const row = this.findLibRow(id)
    if (!this.data.isSuper || !row || this.data.libBusy) return
    const next = row.status === 'inactive' ? 'active' : 'inactive'
    this.setData({ libBusy: true })
    try {
      await callCloud(SETTLEMENT_FN, {
        action: 'priceBook.update',
        kind: this.data.libKind,
        id,
        item: toPayload(this.data.libKind, row, { status: next })
      })
      const impact = this._skuAll ? skuImpactOf(this.data.libKind, row, this._skuAll) : null
      this._skuAll = null
      this.setData({
        libTipTone: 'ok',
        libTip: (next === 'inactive'
          ? `已停用「${row.name} · ${row.option}」：开单选择器与算价不再使用，历史单不受影响`
          : `已启用「${row.name} · ${row.option}」`) + (impact && impact.total ? `（涉及 ${impact.total} 个 SKU 的算价）` : '')
      })
      await this.loadLibrary()
    } catch (err) {
      this.setData({ libTipTone: 'warn', libTip: formatCloudFnError(err, '保存失败') })
    } finally {
      this.setData({ libBusy: false })
    }
  },

  /** 上移 / 下移：交换相邻 sort；相邻 sort 相同时先按显示顺序重编号（10、20…）再换 */
  async moveLibRow(e) {
    const ds = e.currentTarget.dataset || {}
    const id = String(ds.id || '')
    const dir = Number(ds.dir) || 0
    if (!this.data.isSuper || !id || !dir || this.data.libBusy) return
    if (this.data.libKeyword) {
      this.setData({ libTipTone: 'warn', libTip: '搜索时不能排序：清空搜索后再调整顺序' })
      return
    }
    const all = (this._libAll || []).slice()
    const i = all.findIndex((r) => r._id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= all.length) return
    const kind = this.data.libKind
    const plan = []
    if ((Number(all[i].sort) || 0) !== (Number(all[j].sort) || 0)) {
      plan.push({ row: all[i], sort: Number(all[j].sort) || 0 })
      plan.push({ row: all[j], sort: Number(all[i].sort) || 0 })
    } else {
      const order = all.slice()
      order[i] = all[j]
      order[j] = all[i]
      order.forEach((row, k) => {
        const s = (k + 1) * 10
        if ((Number(row.sort) || 0) !== s) plan.push({ row, sort: s })
      })
    }
    this.setData({ libBusy: true, libTipTone: 'info', libTip: plan.length > 2 ? `正在整理排序（${plan.length} 条）…` : '正在调整顺序…' })
    try {
      for (const p of plan) {
        await callCloud(SETTLEMENT_FN, {
          action: 'priceBook.update',
          kind,
          id: p.row._id,
          item: toPayload(kind, p.row, { sort: p.sort })
        })
      }
      this.setData({ libTipTone: 'ok', libTip: '顺序已更新' })
      await this.loadLibrary()
    } catch (err) {
      this.setData({ libTipTone: 'warn', libTip: formatCloudFnError(err, '排序失败') })
      await this.loadLibrary()
    } finally {
      this.setData({ libBusy: false })
    }
  },

  openLibForm(e) {
    if (!this.data.isSuper) return
    const id = String((e.currentTarget.dataset || {}).id || '')
    const kind = this.data.libKind
    const row = id ? this.findLibRow(id) : null
    const form = Object.assign(blankLibForm(kind), { show: true })
    if (row) {
      Object.assign(form, {
        id,
        name: row.name,
        option: row.option,
        unitPrice: String(row.unitPrice),
        unit: row.unit || '',
        aliases: (row.aliases || []).join('，'),
        category: row.category || '',
        isDefault: row.isDefaultOption === true,
        note: row.note || '',
        image: row.image || '',
        imageThumb: row.image ? railUrl(row.image) : ''
      })
    }
    const catIdx = Math.max(0, (this.data.libCategoryValues || []).indexOf(form.category))
    this.setData({ libForm: form, libCategoryIndex: catIdx })
    if (row) {
      this.ensureSkuCatalog().then((all) => {
        if (!all || !this.data.libForm.show || this.data.libForm.id !== id) return
        this.setData({ 'libForm.impactText': impactText(skuImpactOf(kind, row, all)) })
      })
    }
  },

  closeLibForm() {
    if (this.data.libForm.saving || this.data.libForm.uploading) return
    this.setData({ 'libForm.show': false })
  },

  onLibInput(e) {
    const field = String((e.currentTarget.dataset || {}).field || '')
    if (!field) return
    this.setData({ [`libForm.${field}`]: e.detail.value || '' })
  },

  onLibCategory(e) {
    const idx = parseInt(e.detail.value, 10) || 0
    this.setData({ libCategoryIndex: idx, 'libForm.category': (this.data.libCategoryValues || [])[idx] || '' })
  },

  onLibDefault(e) {
    this.setData({ 'libForm.isDefault': !!(e.detail && e.detail.value) })
  },

  async submitLibForm() {
    const f = this.data.libForm
    if (!this.data.isSuper || f.saving) return
    if (f.uploading) return this.setData({ 'libForm.problems': '图片还在上传，稍等再保存' })
    const name = String(f.name || '').trim()
    if (!name) return this.setData({ 'libForm.problems': '名称必填' })
    const price = Number(f.unitPrice)
    if (String(f.unitPrice).trim() === '' || !Number.isFinite(price) || price < 0) {
      return this.setData({ 'libForm.problems': '单价须为 ≥ 0 的数字（元）' })
    }
    const kind = f.kind
    const base = f.id ? this.findLibRow(f.id) : null
    const sameName = (this._libAll || []).filter((r) => r._id !== f.id && normKey(r.name) === normKey(name))
    // 新名称的第一行必须是默认行：否则「文本没写等级 / 尺寸」时取不到价
    const isDefault = f.isDefault === true || (!f.id && !sameName.length)
    const patch = {
      name,
      option: String(f.option || '').trim(),
      unitPrice: price,
      unit: String(f.unit || '').trim(),
      aliases: String(f.aliases || '').split(/[，,、\s]+/).map((s) => s.trim()).filter(Boolean),
      category: f.category || '',
      isDefaultOption: isDefault,
      note: String(f.note || '').trim(),
      image: f.image || ''
    }
    if (!base) {
      patch.status = 'active'
      patch.sort = ((this._libAll || []).reduce((m, r) => Math.max(m, Number(r.sort) || 0), 0) || 0) + 10
    }
    this.setData({ 'libForm.saving': true, 'libForm.problems': '' })
    try {
      const item = toPayload(kind, base || {}, patch)
      if (base) await callCloud(SETTLEMENT_FN, { action: 'priceBook.update', kind, id: f.id, item })
      else await callCloud(SETTLEMENT_FN, { action: 'priceBook.create', kind, item })
      this._skuAll = null
      this.setData({
        'libForm.saving': false,
        'libForm.show': false,
        libTipTone: 'ok',
        libTip: `${base ? '已保存' : '已新增'}「${name}${patch.option ? ' · ' + patch.option : ''}」` +
          (!base && isDefault && !f.isDefault ? '（该名称的第一行，已设为默认）' : '')
      })
      await this.loadLibrary()
    } catch (err) {
      this.setData({ 'libForm.saving': false, 'libForm.problems': formatCloudFnError(err, '保存失败') })
    }
  }
}

Object.assign(methods, {
  /** 删除第一步：行内确认（不用原生弹窗） */
  askRemoveLib(e) {
    const id = String((e.currentTarget.dataset || {}).id || '')
    if (!this.data.isSuper || !id) return
    this.setData({ libConfirmId: this.data.libConfirmId === id ? '' : id, 'libBlocked.id': '' })
  },

  async confirmRemoveLib(e) {
    const id = String((e.currentTarget.dataset || {}).id || '')
    const row = this.findLibRow(id)
    if (!this.data.isSuper || !row || this.data.libBusy) return
    const label = `「${row.name} · ${row.option}」`
    this.setData({ libBusy: true, libConfirmId: '' })
    try {
      await callCloud(SETTLEMENT_FN, { action: 'priceBook.removeIfUnused', kind: this.data.libKind, id })
      this.setData({ libTipTone: 'ok', libTip: `已删除${label}（无任何单据引用）` })
      await this.loadLibrary()
    } catch (err) {
      if (err && err.code === 'IN_USE') {
        this.setData({ libBlocked: { id, text: err.message, canDeactivate: row.status !== 'inactive' } })
      } else {
        this.setData({ libTipTone: 'warn', libTip: formatCloudFnError(err, '删除失败') })
      }
    } finally {
      this.setData({ libBusy: false })
    }
  },

  cancelLibInline() {
    this.setData({ libConfirmId: '', 'libBlocked.id': '' })
  },

  /** 被拒后「改为停用」：复用 toggleLibStatus */
  deactivateBlocked(e) {
    this.setData({ 'libBlocked.id': '' })
    this.toggleLibStatus(e)
  },

  /** 资料图：选 1 张 → 压缩 → 传云存储，表单里只存 fileID，点「保存」才落库 */
  chooseLibImage() {
    const f = this.data.libForm
    if (!this.data.isSuper || f.uploading || f.saving) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = (res.tempFiles || [])[0]
        if (file && file.tempFilePath) this.uploadLibImage(file.tempFilePath)
      }
    })
  },

  async uploadLibImage(path) {
    const kind = this.data.libForm.kind
    this.setData({ 'libForm.uploading': true, 'libForm.problems': '' })
    try {
      const local = await compressLibImage(path)
      const ext = ((/\.(\w+)$/.exec(local) || [])[1] || 'jpg').toLowerCase()
      const up = await wx.cloud.uploadFile({
        cloudPath: `${LIB_IMAGE_DIR}/${kind}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`,
        filePath: local
      })
      if (!up || !up.fileID) throw new Error('上传没有返回文件')
      this.setData({ 'libForm.image': up.fileID, 'libForm.imageThumb': railUrl(up.fileID) })
    } catch (err) {
      this.setData({ 'libForm.problems': formatCloudFnError(err, '图片上传失败，请重试') })
    } finally {
      this.setData({ 'libForm.uploading': false })
    }
  },

  removeLibImage() {
    if (this.data.libForm.uploading) return
    this.setData({ 'libForm.image': '', 'libForm.imageThumb': '' })
  },

  /** 大图：列表行带 data-id；表单里的图不带 id */
  previewLibImage(e) {
    const id = String((e.currentTarget.dataset || {}).id || '')
    const row = id ? this.findLibRow(id) : null
    const image = row ? row.image : this.data.libForm.image
    if (!image) return
    const url = detailUrl(image)
    wx.previewImage({ current: url, urls: [url] })
  },

  onLibThumbError() {
    if (this._libThumbFallback) return
    this._libThumbFallback = true
    onImageError()
    this.applyLibFilter()
    const image = this.data.libForm.image
    if (image) this.setData({ 'libForm.imageThumb': railUrl(image) })
  }
})

module.exports = { data, methods, toPayload }
