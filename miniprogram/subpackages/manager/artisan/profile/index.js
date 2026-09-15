const { guardManagerPage } = require('../../../../utils/managerAuth')
const { guardArtisanWorkspace, hasPermission, roleHasStored } = require('../../utils/staffAuth')
const { formatCloudFnError } = require('../../utils/memberScan')
const { batchTempFileURLs } = require('../../../../utils/util')

const FALLBACK_AVATAR = '/assets/icons/user.png'
const NAME_MAX = 32
const ALIAS_MAX = 32
const TITLE_MAX = 40
const CITY_MAX = 32
const STYLE_MAX = 80
const BIO_MAX = 500
const CRAFT_MAX = 1200
const GALLERY_MAX = 9
const LEAVE_MESSAGE = '有未保存的修改，确定离开？'
const TAG_OPTIONS = ['昆虫', '蝴蝶', '植物封存', '浸液', '干制', '矿物', '海洋', '装裱', '微距摄影', '定制礼盒']

function isRemoteMediaUrl(url) {
  const s = String(url || '')
  return s.indexOf('cloud://') === 0 || s.indexOf('https://') === 0 || s.indexOf('http://') === 0
}

function isCloudId(url) {
  return String(url || '').indexOf('cloud://') === 0
}

function normalizeType(value) {
  const v = String(value || '').trim()
  if (v === 'partner' || v === 'guest') return 'partner'
  return 'store'
}

function sanitizeTags(raw) {
  const list = Array.isArray(raw) ? raw : []
  const out = []
  const seen = {}
  list.forEach((item) => {
    const s = String(item || '').trim()
    if (!s || seen[s]) return
    seen[s] = true
    out.push(s)
  })
  return out.slice(0, 12)
}

function tagChips(selected) {
  const on = {}
  sanitizeTags(selected).forEach((t) => { on[t] = true })
  return TAG_OPTIONS.map((name) => ({ name, on: !!on[name] }))
}

function snapshotForm(form) {
  const f = form || {}
  return JSON.stringify({
    name: String(f.name || '').trim(),
    alias: String(f.alias || '').trim(),
    title: String(f.title || '').trim(),
    bio: String(f.bio || ''),
    craftIntro: String(f.craftIntro || ''),
    avatar: String(f.avatar || ''),
    cover: String(f.cover || ''),
    gallery: Array.isArray(f.gallery) ? f.gallery : [],
    tags: sanitizeTags(f.tags).slice().sort(),
    signatureStyle: String(f.signatureStyle || '').trim(),
    type: normalizeType(f.type),
    city: String(f.city || '').trim(),
    yearsExperience: String(parseInt(f.yearsExperience, 10) || 0),
    joinedAt: String(f.joinedAt || '').trim(),
    priceDelta: String(f.priceDelta || ''),
    extraDays: String(f.extraDays || ''),
    active: f.active !== false
  })
}

function profileToForm(p, fallbackAvatar) {
  const type = normalizeType(p && p.type)
  const gallery = Array.isArray(p && p.gallery) ? p.gallery.filter(Boolean) : []
  let galleryDisplay = Array.isArray(p && p.galleryDisplay) ? p.galleryDisplay : []
  if (!galleryDisplay.length) {
    galleryDisplay = gallery.map((fileID) => ({ fileID, url: fileID }))
  } else {
    galleryDisplay = galleryDisplay.map((item, i) => {
      if (item && typeof item === 'object') {
        return { fileID: item.fileID || gallery[i] || '', url: item.url || item.fileID || gallery[i] || '' }
      }
      return { fileID: gallery[i] || String(item || ''), url: String(item || gallery[i] || '') }
    })
  }
  const tags = sanitizeTags(p && p.tags)
  return {
    typeIndex: type === 'partner' ? 1 : 0,
    tagChips: tagChips(tags),
    form: {
      framerId: (p && p.framerId) || '',
      name: (p && p.name) || '',
      alias: (p && p.alias) || '',
      title: (p && p.title) || '',
      bio: (p && p.bio) || '',
      craftIntro: (p && p.craftIntro) || '',
      avatar: (p && p.avatar) || '',
      avatarDisplay: (p && (p.avatarDisplay || p.avatar)) || fallbackAvatar || FALLBACK_AVATAR,
      cover: (p && p.cover) || '',
      coverDisplay: (p && (p.coverDisplay || p.cover)) || '',
      gallery,
      galleryDisplay,
      tags,
      signatureStyle: (p && p.signatureStyle) || '',
      type,
      city: (p && p.city) || '',
      yearsExperience: p && p.yearsExperience != null ? String(p.yearsExperience) : '0',
      joinedAt: (p && p.joinedAt) || '',
      priceDelta: p && p.priceDelta != null ? String(p.priceDelta) : '',
      extraDays: p && p.extraDays != null ? String(p.extraDays) : '',
      active: !p || p.active !== false
    }
  }
}

function countHint(value, max) {
  return `${String(value || '').length}/${max}`
}

Page({
  data: {
    ready: false,
    fallbackAvatar: FALLBACK_AVATAR,
    saving: false,
    dirty: false,
    saveLabel: '保存',
    avatarUploading: false,
    avatarError: false,
    pendingAvatarPath: '',
    coverUploading: false,
    coverError: false,
    pendingCoverPath: '',
    galleryUploading: false,
    mediaBusy: false,
    focusField: '',
    nameMax: NAME_MAX,
    aliasMax: ALIAS_MAX,
    titleMax: TITLE_MAX,
    cityMax: CITY_MAX,
    styleMax: STYLE_MAX,
    bioMax: BIO_MAX,
    craftMax: CRAFT_MAX,
    nameCount: '0/32',
    aliasCount: '0/32',
    titleCount: '0/40',
    styleCount: '0/80',
    bioCount: '0/500',
    craftCount: '0/1200',
    typeLabels: ['门店标本师', '特邀合作'],
    typeValues: ['store', 'partner'],
    typeIndex: 0,
    tagChips: tagChips([]),
    form: {
      framerId: '',
      name: '',
      alias: '',
      title: '',
      bio: '',
      craftIntro: '',
      avatar: '',
      avatarDisplay: '',
      cover: '',
      coverDisplay: '',
      gallery: [],
      galleryDisplay: [],
      tags: [],
      signatureStyle: '',
      type: 'store',
      city: '',
      yearsExperience: '0',
      joinedAt: '',
      priceDelta: '',
      extraDays: '',
      active: true
    }
  },

  async onLoad() {
    if (!guardManagerPage()) return

    const role = await guardArtisanWorkspace()
    if (!role) return
    if (
      !hasPermission(role, 'manageArtisanProfile') &&
      !roleHasStored(role, 'specimen_artisan') &&
      !roleHasStored(role, 'super_admin')
    ) {
      wx.showToast({ title: '无个人主页权限', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    this.setData({ ready: true })
    this.loadProfile()
  },

  onShow() {
    // 选图 / 切前后台会触发 onShow；再拉云会冲掉未保存修改，也冲掉刚保存的回传。
    this.syncLeaveGuard()
  },

  onUnload() {
    this.disableLeaveGuard()
  },

  countsFromForm(form) {
    return {
      nameCount: countHint(form && form.name, NAME_MAX),
      aliasCount: countHint(form && form.alias, ALIAS_MAX),
      titleCount: countHint(form && form.title, TITLE_MAX),
      styleCount: countHint(form && form.signatureStyle, STYLE_MAX),
      bioCount: countHint(form && form.bio, BIO_MAX),
      craftCount: countHint(form && form.craftIntro, CRAFT_MAX)
    }
  },

  isMediaBusy() {
    return !!(this.data.avatarUploading || this.data.coverUploading || this.data.galleryUploading)
  },

  markClean(form) {
    this._savedSnapshot = snapshotForm(form || this.data.form)
    this.setData({ dirty: false, saveLabel: '已保存' })
    this.disableLeaveGuard()
  },

  syncDirty() {
    const dirty = snapshotForm(this.data.form) !== this._savedSnapshot
    const mediaBusy = this.isMediaBusy()
    if (
      dirty === this.data.dirty
      && mediaBusy === this.data.mediaBusy
      && this.data.saveLabel === (dirty ? '保存' : '已保存')
    ) {
      this.syncLeaveGuard()
      return
    }
    this.setData({
      dirty,
      mediaBusy,
      saveLabel: dirty ? '保存' : '已保存'
    })
    this.syncLeaveGuard()
  },

  syncLeaveGuard() {
    if (this.data.dirty && wx.enableAlertBeforeUnload) {
      wx.enableAlertBeforeUnload({ message: LEAVE_MESSAGE })
      return
    }
    this.disableLeaveGuard()
  },

  disableLeaveGuard() {
    if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload()
  },

  async applyProfile(p) {
    const patch = profileToForm(p, FALLBACK_AVATAR)
    const ids = []
    if (isCloudId(patch.form.avatarDisplay) || isCloudId(patch.form.avatar)) {
      ids.push(patch.form.avatar)
    }
    if (isCloudId(patch.form.coverDisplay) || isCloudId(patch.form.cover)) {
      ids.push(patch.form.cover)
    }
    patch.form.galleryDisplay.forEach((item) => {
      if (item && isCloudId(item.url || item.fileID)) ids.push(item.fileID)
    })
    if (ids.length) {
      try {
        const map = await batchTempFileURLs(ids)
        if (isCloudId(patch.form.avatarDisplay)) {
          patch.form.avatarDisplay = map[patch.form.avatar] || patch.form.avatarDisplay
        }
        if (isCloudId(patch.form.coverDisplay)) {
          patch.form.coverDisplay = map[patch.form.cover] || patch.form.coverDisplay
        }
        patch.form.galleryDisplay = patch.form.galleryDisplay.map((item) => ({
          fileID: item.fileID,
          url: map[item.fileID] || item.url
        }))
      } catch (e) {
        /* keep */
      }
    }
    patch.form.avatarDisplay = patch.form.avatarDisplay || FALLBACK_AVATAR
    this.setData({
      ...patch,
      ...this.countsFromForm(patch.form),
      avatarError: false,
      avatarUploading: false,
      pendingAvatarPath: '',
      coverError: false,
      coverUploading: false,
      pendingCoverPath: '',
      galleryUploading: false,
      mediaBusy: false
    })
    this.markClean(patch.form)
    try {
      const name = String(patch.form.name || '').trim()
      if (patch.form.framerId) wx.setStorageSync('artisan_profile_id', patch.form.framerId)
      if (name) wx.setStorageSync('artisan_profile_name', name)
      wx.setStorageSync('artisan_profile_saved_at', Date.now())
    } catch (e) { /* ignore */ }
  },

  async loadProfile() {
    wx.showLoading({ title: '加载中', mask: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'manageStaff', data: { action: 'getArtisanProfile' } })
      const result = (res && res.result) || {}
      if (!result.success) {
        wx.showToast({ title: formatCloudFnError(result, result.msg || '加载失败'), icon: 'none' })
        return
      }
      await this.applyProfile(result.profile || {})
    } catch (e) {
      console.warn('loadProfile', e)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  onFocus(e) {
    const field = (e.currentTarget.dataset && e.currentTarget.dataset.field) || ''
    this.setData({ focusField: field })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    if (!field || !e.detail || e.detail.value == null) return
    let value = e.detail.value
    if (field === 'name') value = String(value).slice(0, NAME_MAX)
    if (field === 'alias') value = String(value).slice(0, ALIAS_MAX)
    if (field === 'title') value = String(value).slice(0, TITLE_MAX)
    if (field === 'city') value = String(value).slice(0, CITY_MAX)
    if (field === 'signatureStyle') value = String(value).slice(0, STYLE_MAX)
    if (field === 'bio') value = String(value).slice(0, BIO_MAX)
    if (field === 'craftIntro') value = String(value).slice(0, CRAFT_MAX)
    if (field === 'yearsExperience') {
      const n = parseInt(value, 10)
      value = Number.isFinite(n) ? String(Math.max(0, Math.min(60, n))) : '0'
    }
    const form = { ...this.data.form, [field]: value }
    this.setData({
      [`form.${field}`]: value,
      ...this.countsFromForm(form)
    })
    this.syncDirty()
  },

  onBlur(e) {
    this.onInput(e)
    this.setData({ focusField: '' })
  },

  onTypeTap(e) {
    const type = normalizeType(e.currentTarget.dataset && e.currentTarget.dataset.type)
    this.setData({
      typeIndex: type === 'partner' ? 1 : 0,
      'form.type': type
    })
    this.syncDirty()
  },

  onYearsStep(e) {
    const dir = e.currentTarget.dataset && e.currentTarget.dataset.dir
    let n = parseInt(this.data.form.yearsExperience, 10) || 0
    n = Math.max(0, Math.min(60, n + (dir === 'plus' ? 1 : -1)))
    this.setData({ 'form.yearsExperience': String(n) })
    this.syncDirty()
  },

  onJoinedChange(e) {
    this.setData({ 'form.joinedAt': (e.detail && e.detail.value) || '' })
    this.syncDirty()
  },

  onTagTap(e) {
    const tag = String((e.currentTarget.dataset && e.currentTarget.dataset.tag) || '')
    if (!tag) return
    const tags = sanitizeTags(this.data.form.tags)
    const idx = tags.indexOf(tag)
    if (idx >= 0) tags.splice(idx, 1)
    else if (tags.length < 12) tags.push(tag)
    this.setData({
      'form.tags': tags,
      tagChips: tagChips(tags)
    })
    this.syncDirty()
  },

  onActiveChange(e) {
    const active = !!e.detail.value
    this.setData({ 'form.active': active })
    this.syncDirty()
  },

  onAvatarTap() {
    if (this.data.avatarError) {
      this.retryAvatar()
      return
    }
    this.chooseImage('avatar')
  },

  onCoverTap() {
    if (this.data.coverError) {
      this.retryCover()
      return
    }
    this.chooseImage('cover')
  },

  chooseImage(kind) {
    if (this.data.saving || this.data[`${kind}Uploading`]) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: (res) => {
        const path = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (!path) {
          wx.showToast({ title: '未获取到图片，请重试', icon: 'none' })
          return
        }
        this.uploadImage(kind, path)
      },
      fail: (err) => {
        const msg = String((err && err.errMsg) || '')
        if (/cancel/i.test(msg)) return
        this.setData({ [`${kind}Error`]: true })
        wx.showToast({ title: '无法打开相册，请检查权限后重试', icon: 'none' })
      }
    })
  },

  retryAvatar() {
    const path = this.data.pendingAvatarPath || ''
    if (path && !isRemoteMediaUrl(path)) {
      this.uploadImage('avatar', path)
      return
    }
    this.chooseImage('avatar')
  },

  retryCover() {
    const path = this.data.pendingCoverPath || ''
    if (path && !isRemoteMediaUrl(path)) {
      this.uploadImage('cover', path)
      return
    }
    this.chooseImage('cover')
  },

  async uploadImage(kind, path) {
    const pendingKey = kind === 'cover' ? 'pendingCoverPath' : 'pendingAvatarPath'
    const displayKey = kind === 'cover' ? 'form.coverDisplay' : 'form.avatarDisplay'
    this.setData({
      [pendingKey]: path,
      [displayKey]: path,
      [`${kind}Uploading`]: true,
      [`${kind}Error`]: false,
      mediaBusy: true
    })
    this.syncDirty()
    try {
      const up = await wx.cloud.uploadFile({
        cloudPath: `framers/${kind}_${Date.now()}.png`,
        filePath: path
      })
      this.setData({
        [`form.${kind}`]: up.fileID,
        [`${kind}Uploading`]: false,
        [`${kind}Error`]: false,
        [pendingKey]: ''
      })
      this.syncDirty()
    } catch (e) {
      this.setData({ [`${kind}Uploading`]: false, [`${kind}Error`]: true, mediaBusy: this.isMediaBusy() })
      wx.showToast({ title: kind === 'cover' ? '封面上传失败，可点重试' : '头像上传失败，可点重试', icon: 'none' })
    }
  },

  chooseGallery() {
    if (this.data.saving || this.data.galleryUploading) return
    const remain = GALLERY_MAX - (this.data.form.gallery || []).length
    if (remain <= 0) {
      wx.showToast({ title: '最多 9 张作品照片', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      success: (res) => {
        const files = (res.tempFiles || []).map((f) => f && f.tempFilePath).filter(Boolean)
        if (!files.length) {
          wx.showToast({ title: '未获取到图片，请重试', icon: 'none' })
          return
        }
        this.uploadGallery(files)
      },
      fail: (err) => {
        const msg = String((err && err.errMsg) || '')
        if (/cancel/i.test(msg)) return
        wx.showToast({ title: '无法打开相册，请检查权限后重试', icon: 'none' })
      }
    })
  },

  async uploadGallery(paths) {
    const gallery = [...(this.data.form.gallery || [])]
    const display = [...(this.data.form.galleryDisplay || [])]
    this.setData({ galleryUploading: true, mediaBusy: true })
    for (let i = 0; i < paths.length; i += 1) {
      if (gallery.length >= GALLERY_MAX) break
      const path = paths[i]
      display.push({ fileID: '', url: path })
      this.setData({ 'form.galleryDisplay': display })
      try {
        const up = await wx.cloud.uploadFile({
          cloudPath: `framers/gallery_${Date.now()}_${gallery.length}.png`,
          filePath: path
        })
        gallery.push(up.fileID)
        display[display.length - 1] = { fileID: up.fileID, url: path }
        this.setData({
          'form.gallery': gallery,
          'form.galleryDisplay': display
        })
      } catch (e) {
        display.pop()
        this.setData({ 'form.galleryDisplay': display })
        wx.showToast({ title: '作品图上传失败', icon: 'none' })
      }
    }
    this.setData({ galleryUploading: false, mediaBusy: false })
    this.syncDirty()
  },

  removeGallery(e) {
    const idx = parseInt(e.currentTarget.dataset && e.currentTarget.dataset.index, 10)
    if (!Number.isFinite(idx) || idx < 0) return
    const gallery = (this.data.form.gallery || []).filter((_, i) => i !== idx)
    const display = (this.data.form.galleryDisplay || []).filter((_, i) => i !== idx)
    this.setData({
      'form.gallery': gallery,
      'form.galleryDisplay': display
    })
    this.syncDirty()
  },

  previewPublic() {
    if (this.data.saving || this.isMediaBusy()) {
      wx.showToast({ title: '请稍候再打开', icon: 'none' })
      return
    }
    if (this.data.dirty || !this.data.form.framerId) {
      wx.showModal({
        title: '尚未保存',
        content: this.data.form.framerId ? '有未保存的修改，打开主页前请先保存。' : '请先保存个人主页。',
        confirmText: '保存',
        cancelText: '取消',
        confirmColor: '#C4A76C',
        success: (res) => {
          if (res.confirm) this.save({ thenPreview: true })
        }
      })
      return
    }
    this.openPublicPage()
  },

  openPublicPage() {
    const id = this.data.form.framerId
    if (!id) {
      wx.showToast({ title: '请先保存主页', icon: 'none' })
      return
    }
    if (this.data.form.active === false) {
      wx.showModal({
        title: '仅自己可见',
        content: '当前未对外展示。打开后只有你能看，C 端访客会看到已下架。',
        confirmText: '仍打开',
        cancelText: '取消',
        confirmColor: '#C4A76C',
        success: (res) => {
          if (res.confirm) this.navigatePublic(id)
        }
      })
      return
    }
    this.navigatePublic(id)
  },

  navigatePublic(id) {
    wx.navigateTo({
      url: `/subpackages/business/framer/index?id=${encodeURIComponent(id)}&t=${Date.now()}`,
      fail: () => wx.showToast({ title: '预览暂不可用', icon: 'none' })
    })
  },

  async ensureFileId(raw, pendingPath, kind) {
    if (raw && (isCloudId(raw) || isRemoteMediaUrl(raw))) return raw
    const local = (raw && !isRemoteMediaUrl(raw)) ? raw : pendingPath
    if (local && !isRemoteMediaUrl(local)) {
      const up = await wx.cloud.uploadFile({
        cloudPath: `framers/${kind}_${Date.now()}.png`,
        filePath: local
      })
      return up.fileID
    }
    return raw || ''
  },

  async save(options = {}) {
    const thenPreview = !!(options && options.thenPreview)
    if (this.data.saving) return
    if (this.isMediaBusy()) {
      wx.showToast({ title: '图片上传中，请稍候', icon: 'none' })
      return
    }
    const f = this.data.form || {}
    if (!String(f.name || '').trim()) {
      wx.showToast({ title: '请填写姓名', icon: 'none' })
      return
    }
    this.setData({ saving: true, saveLabel: '保存中…' })
    try {
      let avatar = f.avatar || ''
      let cover = f.cover || ''
      try {
        avatar = await this.ensureFileId(avatar, this.data.pendingAvatarPath, 'avatar')
        cover = await this.ensureFileId(cover, this.data.pendingCoverPath, 'cover')
      } catch (upErr) {
        this.setData({
          avatarError: !avatar || this.data.avatarError,
          coverError: !cover || this.data.coverError
        })
        wx.showToast({ title: '图片上传失败，可点重试', icon: 'none' })
        return
      }
      const res = await wx.cloud.callFunction({
        name: 'manageStaff',
        data: {
          action: 'saveArtisanProfile',
          framerId: f.framerId || '',
          name: f.name,
          alias: f.alias,
          title: f.title,
          bio: f.bio,
          craftIntro: f.craftIntro,
          avatar,
          cover,
          gallery: f.gallery || [],
          tags: f.tags || [],
          signatureStyle: f.signatureStyle,
          type: normalizeType(f.type),
          city: f.city,
          yearsExperience: parseInt(f.yearsExperience, 10) || 0,
          joinedAt: f.joinedAt || '',
          priceDelta: f.priceDelta,
          extraDays: f.extraDays,
          active: f.active !== false
        }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        wx.showToast({ title: formatCloudFnError(result, result.msg || '保存失败'), icon: 'none' })
        return
      }
      const saved = result.profile || {
        framerId: result.framerId || f.framerId,
        name: f.name,
        alias: f.alias,
        title: f.title,
        bio: f.bio,
        craftIntro: f.craftIntro,
        avatar,
        cover,
        gallery: f.gallery,
        tags: f.tags,
        signatureStyle: f.signatureStyle,
        type: normalizeType(f.type),
        city: f.city,
        yearsExperience: parseInt(f.yearsExperience, 10) || 0,
        joinedAt: f.joinedAt,
        priceDelta: f.priceDelta,
        extraDays: f.extraDays,
        active: f.active !== false
      }
      await this.applyProfile(saved)
      try { wx.vibrateShort({ type: 'light' }) } catch (e) { /* ignore */ }
      wx.showToast({ title: '已保存', icon: 'none', duration: 1400 })
      wx.cloud.callFunction({
        name: 'manageProducts',
        data: { action: 'backfillMineLinks' }
      }).catch((err) => console.warn('backfillMineLinks after profile save', err))
      if (thenPreview) this.openPublicPage()
    } catch (e) {
      console.error('save profile', e)
      wx.showToast({ title: formatCloudFnError(e, '保存失败'), icon: 'none' })
    } finally {
      this.setData({
        saving: false,
        saveLabel: this.data.dirty ? '保存' : '已保存'
      })
    }
  }
})
