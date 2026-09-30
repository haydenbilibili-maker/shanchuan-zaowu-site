/**
 * 供应商管理中心 · 价目编辑（新建 / 编辑 / 上下架 / 删除）
 * 写操作仅超管（服务端 manageSupplierDesk 逐 action 校验）；被单据引用的条目「删除」= 停用，不硬删。
 * 校验错误就地显示在字段下方；删除用「再点一次确认」，不弹原生框。
 * 商品图：上传后表单只存 cloud:// fileID；只有换过 / 移除过图才把 image 送给服务端（没动图不覆盖库里的官网图与多图）。
 */
const { callDesk } = require('../utils/deskApi')
const { thumbOf, absUrl, bigOf, pickAndUpload, preview } = require('../utils/deskImage')

const IMAGE_DIR = 'b2b-price'

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
  image: '',
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
    image: it.image || '',
    status: it.status === 'active' ? 'active' : 'inactive'
  }
}

function payloadOf(f, imageDirty) {
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
  if (imageDirty) out.image = f.image
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
    imageThumb: '',
    imageDirty: false,
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
        imageThumb: thumbOf(it.image),
        imageDirty: false,
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

  onCoverTap() {
    if (this.data.imageThumb) this.previewImage()
    else this.chooseImage()
  },

  async chooseImage() {
    if (this.data.uploading || this.data.saving) return
    this.setData({ uploading: true, 'errors.image': '' })
    const r = await pickAndUpload(IMAGE_DIR)
    this.setData({ uploading: false })
    if (r.cancelled) return
    if (!r.ok) return this.showFlash(r.msg, true)
    this.setData({ 'form.image': r.fileID, imageThumb: thumbOf(r.fileID), imageDirty: true, flash: '' })
  },

  removeImage() {
    if (this.data.uploading) return
    this.setData({ 'form.image': '', imageThumb: '', imageDirty: true, 'errors.image': '' })
  },

  previewImage() {
    const big = bigOf(this.data.form.image)
    if (big) preview([big])
  },

  /** 缩略图参数不被支持时回落原图；原图也坏就当没图 */
  onImageError() {
    const raw = absUrl(this.data.form.image)
    this.setData({ imageThumb: this.data.imageThumb !== raw ? raw : '' })
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
    callDesk('adminSavePriceItem', { id: this.data.id, data: payloadOf(f, this.data.imageDirty) }).then((res) => {
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
