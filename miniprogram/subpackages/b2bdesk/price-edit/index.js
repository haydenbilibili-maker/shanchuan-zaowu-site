/**
 * 供应商管理中心 · 价目编辑（新建 / 编辑 / 上下架 / 删除）
 * 写操作仅超管（服务端 manageSupplierDesk 逐 action 校验）；被单据引用的条目「删除」= 停用，不硬删。
 * 校验错误就地显示在字段下方；删除用「再点一次确认」，不弹原生框。
 * 商品图（多图，最多 9 张）：与 ERP / 官网同约定——images[0] 即封面，服务端同步 image = images[0]。
 * 上传后只存 cloud:// fileID；只有增删 / 排序过才把 images 送给服务端（没动图不覆盖库里的官网图与多图）。
 */
const { callDesk } = require('../utils/deskApi')
const { thumbOf, absUrl, bigOf, pickAndUploadMany, preview } = require('../utils/deskImage')

const IMAGE_DIR = 'b2b-price'
const GALLERY_MAX = 9

const EMPTY = {
  skuId: '',
  name: '',
  species: '',
  packaging: '',
  prepMethod: '干制',
  packagingFilter: '其它标本',
  bioFilter: '昆虫',
  priceMode: 'fixed',
  price: '',
  priceMin: '',
  priceMax: '',
  guidePrice: '',
  specs: '',
  note: '',
  status: 'active'
}

const PRICE_MODES = [
  { key: 'fixed', label: '单一价' },
  { key: 'range', label: '区间价' },
  { key: 'quote', label: '议价' }
]

function formFromItem(it) {
  const p = it.price
  const isRange = p && typeof p === 'object'
  return {
    ...EMPTY,
    skuId: it.skuId || '',
    name: it.name || '',
    species: it.species || '',
    packaging: it.packaging || '',
    prepMethod: it.prepMethod || EMPTY.prepMethod,
    packagingFilter: it.packagingFilter || EMPTY.packagingFilter,
    bioFilter: it.bioFilter || EMPTY.bioFilter,
    priceMode: p == null ? 'quote' : isRange ? 'range' : 'fixed',
    price: p != null && !isRange ? String(p) : '',
    priceMin: isRange ? String(p.min) : '',
    priceMax: isRange ? String(p.max) : '',
    guidePrice: it.guidePrice != null && typeof it.guidePrice !== 'object' ? String(it.guidePrice) : '',
    specs: it.specs || '',
    note: it.note || '',
    status: it.status === 'active' ? 'active' : 'inactive'
  }
}

/** 同 ERP normalizeImageFields：封面（image）排首位、去重；没有 images 时退回单张 image */
function galleryFromItem(it) {
  const list = (Array.isArray(it.images) ? it.images : []).map((u) => String(u || '').trim()).filter(Boolean)
  const primary = String(it.image || '').trim() || list[0] || ''
  const out = []
  ;[primary].concat(list).forEach((u) => { if (u && out.indexOf(u) === -1) out.push(u) })
  return out
}

function tile(raw) {
  return { raw, thumb: thumbOf(raw) }
}

function payloadOf(f, gallery, galleryDirty) {
  let price = null
  if (f.priceMode === 'fixed') price = f.price
  else if (f.priceMode === 'range') price = { min: f.priceMin, max: f.priceMax }
  const out = {
    skuId: f.skuId,
    name: f.name,
    species: f.species,
    packaging: f.packaging,
    prepMethod: f.prepMethod,
    packagingFilter: f.packagingFilter,
    bioFilter: f.bioFilter,
    price,
    guidePrice: f.guidePrice === '' ? null : f.guidePrice,
    specs: f.specs,
    note: f.note,
    status: f.status
  }
  if (galleryDirty) out.images = gallery.map((g) => g.raw)
  return out
}

Page({
  data: {
    id: '',
    loading: false,
    error: '',
    form: { ...EMPTY },
    errors: {},
    options: { prep: [], packaging: [], bio: [] },
    priceModes: PRICE_MODES,
    refCount: 0,
    retired: false,
    saving: false,
    removeArmed: false,
    removing: false,
    gallery: [],
    galleryMax: GALLERY_MAX,
    picked: 0,
    galleryDirty: false,
    uploading: false,
    flash: '',
    flashErr: false
  },

  onLoad(query) {
    const id = decodeURIComponent((query && query.id) || '')
    this.setData({ id })
    wx.setNavigationBarTitle({ title: id ? '编辑价目' : '新建价目' })
    this.load()
  },

  onUnload() {
    clearTimeout(this._armTimer)
  },

  load() {
    const id = this.data.id
    this.setData({ loading: true, error: '' })
    return callDesk('adminGetPriceItem', { id }).then((res) => {
      if (!res.success) return this.setData({ loading: false, error: res.msg || '加载失败' })
      if (!res.item) return this.setData({ loading: false, options: res.options || this.data.options })
      const it = res.item
      this.setData({
        loading: false,
        form: formFromItem(it),
        gallery: galleryFromItem(it).map(tile),
        picked: 0,
        galleryDirty: false,
        options: res.options || this.data.options,
        refCount: it.refCount || 0,
        retired: !!it.retired
      })
    })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    this.setData({ [`form.${field}`]: e.detail.value, [`errors.${field}`]: '' })
  },

  onPick(e) {
    const { field, value } = e.currentTarget.dataset
    if (!field) return
    const patch = { [`form.${field}`]: value }
    if (field === 'priceMode') patch['errors.price'] = ''
    this.setData(patch)
  },

  showFlash(msg, err) {
    this.setData({ flash: msg || '', flashErr: !!err })
  },

  setGallery(list, picked) {
    const n = list.length
    this.setData({ gallery: list, picked: n ? Math.max(0, Math.min(picked, n - 1)) : 0, galleryDirty: true, 'errors.image': '' })
  },

  async addImages() {
    const room = GALLERY_MAX - this.data.gallery.length
    if (this.data.uploading || this.data.saving || room <= 0) return
    this.setData({ uploading: true, 'errors.image': '' })
    const r = await pickAndUploadMany(IMAGE_DIR, room)
    this.setData({ uploading: false })
    if (r.cancelled) return
    const have = this.data.gallery
    if (r.fileIDs.length) this.setGallery(have.concat(r.fileIDs.slice(0, room).map(tile)), have.length)
    this.showFlash(r.msg || '', !!r.msg)
  },

  /** 点一下选中；再点已选中的那张 = 预览 */
  onTileTap(e) {
    const i = Number(e.currentTarget.dataset.index)
    if (i === this.data.picked) this.previewPicked()
    else this.setData({ picked: i })
  },

  setCover() {
    const { gallery, picked } = this.data
    if (this.data.uploading || picked <= 0 || picked >= gallery.length) return
    const list = gallery.slice()
    const [g] = list.splice(picked, 1)
    list.unshift(g)
    this.setGallery(list, 0)
  },

  movePicked(e) {
    const step = Number(e.currentTarget.dataset.step)
    const { gallery, picked } = this.data
    const to = picked + step
    if (this.data.uploading || !(step === 1 || step === -1) || to < 0 || to >= gallery.length) return
    const list = gallery.slice()
    const t = list[picked]
    list[picked] = list[to]
    list[to] = t
    this.setGallery(list, to)
  },

  removePicked() {
    const { gallery, picked } = this.data
    if (this.data.uploading || picked >= gallery.length) return
    const list = gallery.slice()
    list.splice(picked, 1)
    this.setGallery(list, picked)
  },

  previewPicked() {
    const { gallery, picked } = this.data
    const urls = gallery.map((g) => bigOf(g.raw))
    preview(urls, urls[picked])
  },

  /** 缩略图参数不被支持时回落原图；原图也坏就当没图（仍保留该项，免得误删库里的地址） */
  onTileError(e) {
    const i = Number(e.currentTarget.dataset.index)
    const g = this.data.gallery[i]
    if (!g) return
    const raw = absUrl(g.raw)
    this.setData({ [`gallery[${i}].thumb`]: g.thumb !== raw ? raw : '' })
  },

  goBack() {
    wx.navigateBack({ fail: () => {} })
  },

  save() {
    if (this.data.saving || this.data.uploading) return
    const f = this.data.form
    const errors = {}
    if (f.priceMode === 'fixed' && !(Number(f.price) > 0)) errors.price = '供货价需为大于 0 的数字'
    if (f.priceMode === 'range' && !(Number(f.priceMin) > 0 && Number(f.priceMax) >= Number(f.priceMin))) {
      errors.price = '区间需 0 < 最低 ≤ 最高'
    }
    if (Object.keys(errors).length) {
      this.setData({ errors: { ...this.data.errors, ...errors } })
      return this.showFlash('请先修正标红的字段', true)
    }
    this.setData({ saving: true, flash: '' })
    callDesk('adminSavePriceItem', { id: this.data.id, data: payloadOf(f, this.data.gallery, this.data.galleryDirty) }).then((res) => {
      this.setData({ saving: false })
      if (!res.success) {
        const errs = {}
        ;(res.errors || []).forEach((x) => { errs[x.field] = x.msg })
        this.setData({ errors: errs })
        return this.showFlash(res.msg || '保存失败', true)
      }
      this.showFlash(res.msg || '已保存')
      if (!this.data.id && res.id) this.setData({ id: res.id })
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 600)
    })
  },

  toggleStatus() {
    if (this.data.saving) return
    const next = this.data.form.status === 'active' ? 'inactive' : 'active'
    if (!this.data.id) {
      this.setData({ 'form.status': next })
      return
    }
    this.setData({ saving: true })
    callDesk('adminSetPriceStatus', { id: this.data.id, status: next }).then((res) => {
      this.setData({ saving: false })
      if (!res.success) return this.showFlash(res.msg, true)
      this.setData({ 'form.status': next, retired: next === 'active' ? false : this.data.retired })
      this.showFlash(res.msg)
    })
  },

  remove() {
    if (!this.data.id || this.data.removing) return
    if (!this.data.removeArmed) {
      this.setData({ removeArmed: true })
      clearTimeout(this._armTimer)
      this._armTimer = setTimeout(() => this.setData({ removeArmed: false }), 4000)
      return
    }
    clearTimeout(this._armTimer)
    this.setData({ removing: true, removeArmed: false })
    callDesk('adminRemovePriceItem', { id: this.data.id }).then((res) => {
      this.setData({ removing: false })
      if (!res.success) return this.showFlash(res.msg, true)
      if (res.retired) {
        this.setData({ 'form.status': 'inactive', retired: true, refCount: res.refCount || this.data.refCount })
        return this.showFlash(res.msg)
      }
      this.showFlash(res.msg || '已删除')
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 600)
    })
  }
})
