/**
 * AI 鉴定监测（超管工作台）
 *
 * 产品负责人 2026-09-29：「能看到用户使用 AI 鉴定拍摄的全量信息：图片、识别结果等」。
 * 数据由 identifySpecimen 旁路逐次记录（含失败与复用），本页只读，经云函数 aiIdentifyMonitor：
 * 仅超管、查看列表 / 详情前服务端先留审计；图片为 10 分钟临时链接。
 *
 * 约束：反馈一律走页内提示条（不新增原生弹窗）；界面不出现集合名 / 字段名。
 * 门禁：磁贴仅超管可见；页内 guardStaffPage('super_admin')；云函数 requireSuperAdmin 再执法。
 * 蓝图：miniprogram/docs/超管工作台_AI鉴定监测_2026-09-29.md
 */
const { guardStaffPage } = require('../utils/staffAuth')

const FN = 'aiIdentifyMonitor'
const DAY_MS = 24 * 3600 * 1000
const BJ_OFFSET = 8 * 3600 * 1000

const ENTRY_LABELS = {
  gallery_search: '馆藏搜索栏',
  store_qr: '门店二维码',
  search_idle: '搜索页',
  search_bar: '搜索栏',
  user_menu: '我的',
  retake: '重新拍摄',
  atelier: '工坊',
  home_orb: '首页',
  explore_quick: '探索',
  qr_remap: '旧版二维码'
}

const STATUS_META = {
  success: { label: '成功', tone: 'ok' },
  reused: { label: '复用', tone: 'brass' },
  failed: { label: '失败', tone: 'warn' }
}

const AI_SECTIONS = [
  ['content', '科普'],
  ['fun_fact', '趣闻'],
  ['morphology', '形态特征'],
  ['identification_notes', '鉴别要点'],
  ['habits', '习性'],
  ['habitat', '栖息环境'],
  ['distribution', '分布'],
  ['phenology', '物候'],
  ['nomenclature', '命名'],
  ['similar_species', '近似种'],
  ['collection_note', '收藏说明'],
  ['conservation_advice', '保护建议']
]

const TAXON_KEYS = [
  ['kingdom', '界'], ['phylum', '门'], ['class', '纲'], ['order', '目'],
  ['family', '科'], ['genus', '属'], ['species', '种']
]

const RANGE_OPTIONS = [
  { id: 'today', label: '今天' },
  { id: '7d', label: '近 7 天' },
  { id: '30d', label: '近 30 天' },
  { id: 'all', label: '全部' }
]

const STATUS_OPTIONS = [
  { id: 'all', label: '全部' },
  { id: 'success', label: '成功' },
  { id: 'failed', label: '失败' }
]

function pad(n) {
  return n < 10 ? `0${n}` : String(n)
}

function bjDateStr(ts) {
  return new Date(ts + BJ_OFFSET).toISOString().slice(0, 10)
}

function bjTimeText(ts) {
  if (!ts) return '—'
  const d = new Date(ts + BJ_OFFSET)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

function rangeDates(range) {
  const today = bjDateStr(Date.now())
  if (range === 'today') return { dateFrom: today, dateTo: today }
  if (range === '7d') return { dateFrom: bjDateStr(Date.now() - 6 * DAY_MS), dateTo: today }
  if (range === '30d') return { dateFrom: bjDateStr(Date.now() - 29 * DAY_MS), dateTo: today }
  return { dateFrom: '', dateTo: '' }
}

function thumbOf(url) {
  if (!url) return ''
  const sep = url.indexOf('?') === -1 ? '?' : '&'
  return `${url}${sep}imageMogr2/thumbnail/240x>/quality/80`
}

function confidenceText(c) {
  return typeof c === 'number' ? `${Math.round(c * 100)}%` : ''
}

function durationText(ms) {
  if (typeof ms !== 'number') return '—'
  if (ms < 1000) return `${ms} 毫秒`
  return `${(ms / 1000).toFixed(1)} 秒`
}

function userText(user, openid) {
  const tail = openid ? `…${String(openid).slice(-6)}` : ''
  if (!user) return tail ? `未建档用户 ${tail}` : '未知用户'
  const parts = [user.nickName || '未设置昵称']
  if (user.phone) parts.push(user.phone)
  return parts.join(' · ')
}

function textOf(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join('；')
  if (typeof v === 'object') {
    return Object.keys(v).map((k) => textOf(v[k])).filter(Boolean).join('；')
  }
  return String(v)
}

function titleOf(row) {
  if (row.species_name_zh) return row.species_name_zh
  if (row.status === 'failed') return '识别未成功'
  return row.is_specimen === false ? '未认出藏品主体' : '未命名结果'
}

function decorateRow(row) {
  const meta = STATUS_META[row.status] || STATUS_META.failed
  return {
    id: row._id,
    openid: row.openid || '',
    title: titleOf(row),
    latin: row.species_name_latin || '',
    confidence: confidenceText(row.confidence),
    statusLabel: meta.label,
    statusTone: meta.tone,
    thumb: thumbOf(row.imageUrl),
    imageUrl: row.imageUrl || '',
    userText: userText(row.user, row.openid),
    timeText: bjTimeText(row.created_at),
    entryLabel: ENTRY_LABELS[row.entry_source] || (row.entry_source ? '其它入口' : ''),
    errorMsg: row.status === 'failed' ? String(row.error_msg || '').slice(0, 60) : '',
    isHistory: row.source === 'history'
  }
}

function decorateDetail(d) {
  const meta = STATUS_META[d.status] || STATUS_META.failed
  const species = d.species_info || {}
  const taxonomy = species.taxonomy || {}
  const ai = d.ai_content || {}
  return {
    id: d._id,
    imageUrl: d.imageUrl || '',
    title: titleOf(d),
    latin: d.species_name_latin || species.species_name_latin || '',
    english: species.species_name_en || '',
    statusLabel: meta.label,
    statusTone: meta.tone,
    reuseText: d.reuse_reason === 'same_species' ? '同物种已鉴定过，返回首条结果' : d.reuse_reason === 'same_image' ? '同一张照片再次鉴定，返回既有结果' : '',
    confidence: confidenceText(d.confidence),
    brief: textOf(species.brief_description),
    taxonomy: TAXON_KEYS.map(([k, label]) => ({ label, value: textOf(taxonomy[k]) })).filter((x) => x.value),
    alternatives: (Array.isArray(species.alternatives) ? species.alternatives : [])
      .map((a) => (typeof a === 'string' ? a : textOf(a && (a.species_name_zh || a.name))))
      .filter(Boolean)
      .slice(0, 5),
    aiSections: AI_SECTIONS.map(([k, label]) => ({ label, text: textOf(ai[k]) })).filter((x) => x.text),
    products: (d.related_products || []).map((p) => ({
      id: p._id,
      title: p.title || '未命名藏品',
      priceText: p.price ? `¥${p.price}` : '',
      cover: p.coverUrl || ''
    })),
    userText: userText(d.user, d.openid),
    openid: d.openid || '',
    timeText: bjTimeText(d.created_at),
    durationText: durationText(d.duration_ms),
    modelText: d.model === 'mock' ? '演示数据' : [d.model, d.text_model].filter(Boolean).join(' / ') || '—',
    entryLabel: ENTRY_LABELS[d.entry_source] || (d.entry_source ? '其它入口' : '—'),
    categoryHint: d.category_hint || '不限',
    errorMsg: d.status === 'failed' ? d.error_msg || '识别未成功（未返回原因）' : '',
    isHistory: d.source === 'history',
    feedback: (d.feedback || []).map((f) => ({
      name: f.corrected_name_zh,
      note: f.note,
      timeText: bjTimeText(f.created_at)
    })),
    flags: d.recordFlags
  }
}

Page({
  data: {
    ready: false,
    tipTone: 'info',
    tipText: '',
    overview: null,
    overviewLoading: true,
    liveSinceText: '',
    rangeOptions: RANGE_OPTIONS,
    statusOptions: STATUS_OPTIONS,
    range: '7d',
    dateFrom: '',
    dateTo: '',
    status: 'all',
    userInput: '',
    userFilter: '',
    userFilterLabel: '',
    list: [],
    total: 0,
    page: 0,
    hasMore: false,
    loading: false,
    loadingMore: false,
    loadError: '',
    detail: null,
    detailLoading: false,
    detailError: ''
  },

  async onLoad() {
    const role = await guardStaffPage('super_admin')
    if (!role) return
    const { dateFrom, dateTo } = rangeDates('7d')
    this.setData({ ready: true, dateFrom, dateTo })
    this.loadOverview()
    this.loadList(true)
  },

  onPullDownRefresh() {
    if (!this.data.ready) {
      wx.stopPullDownRefresh()
      return
    }
    Promise.all([this.loadOverview(), this.loadList(true)]).finally(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore && !this.data.loading) this.loadList(false)
  },

  callFn(data) {
    return wx.cloud.callFunction({ name: FN, data }).then((res) => {
      const body = (res && res.result) || {}
      if (body.success === false) throw new Error(body.msg || '请求失败')
      return body.data
    })
  },

  showTip(text, tone = 'info') {
    this.setData({ tipText: text, tipTone: tone })
    clearTimeout(this._tipTimer)
    this._tipTimer = setTimeout(() => this.setData({ tipText: '' }), 3200)
  },

  onUnload() {
    clearTimeout(this._tipTimer)
  },

  async loadOverview() {
    this.setData({ overviewLoading: true })
    try {
      const o = await this.callFn({ action: 'overview' })
      this.setData({
        overview: {
          todayTotal: o.todayTotal,
          todayUsers: o.todayUsers == null ? '—' : o.todayUsers,
          weekTotal: o.weekTotal,
          weekUsers: o.weekUsers == null ? '—' : o.weekUsers,
          weekSuccessRate: o.weekSuccessRate == null ? '—' : `${o.weekSuccessRate}%`,
          total: o.total,
          historyTotal: o.historyTotal
        },
        liveSinceText: o.liveSince ? bjTimeText(o.liveSince) : '',
        overviewLoading: false
      })
    } catch (e) {
      this.setData({ overviewLoading: false })
      this.showTip(`概览未能取回：${e.message || e}`, 'warn')
    }
  },

  async loadList(reset) {
    const page = reset ? 0 : this.data.page + 1
    this.setData(reset ? { loading: true, loadError: '' } : { loadingMore: true })
    try {
      const res = await this.callFn({
        action: 'list',
        dateFrom: this.data.dateFrom,
        dateTo: this.data.dateTo,
        status: this.data.status,
        user: this.data.userFilter,
        page
      })
      const rows = (res.list || []).map(decorateRow)
      this.setData({
        list: reset ? rows : this.data.list.concat(rows),
        total: res.total || 0,
        page,
        hasMore: !!res.hasMore,
        loading: false,
        loadingMore: false
      })
    } catch (e) {
      const msg = e.message || String(e)
      if (reset) this.setData({ loading: false, loadError: msg, list: [] })
      else {
        this.setData({ loadingMore: false })
        this.showTip(`加载更多失败：${msg}`, 'warn')
      }
    }
  },

  onRange(e) {
    const range = e.currentTarget.dataset.id
    if (!range || range === this.data.range) return
    this.setData({ range, ...rangeDates(range) })
    this.loadList(true)
  },

  onDateFrom(e) {
    const dateFrom = e.detail.value
    const dateTo = this.data.dateTo && this.data.dateTo < dateFrom ? dateFrom : this.data.dateTo
    this.setData({ range: 'custom', dateFrom, dateTo })
    this.loadList(true)
  },

  onDateTo(e) {
    const dateTo = e.detail.value
    const dateFrom = this.data.dateFrom && this.data.dateFrom > dateTo ? dateTo : this.data.dateFrom
    this.setData({ range: 'custom', dateFrom, dateTo })
    this.loadList(true)
  },

  onStatus(e) {
    const status = e.currentTarget.dataset.id
    if (!status || status === this.data.status) return
    this.setData({ status })
    this.loadList(true)
  },

  onUserInput(e) {
    this.setData({ userInput: e.detail.value })
  },

  onUserSearch() {
    const kw = String(this.data.userInput || '').trim()
    this.setData({ userFilter: kw, userFilterLabel: kw })
    this.loadList(true)
  },

  onFilterByUser(e) {
    const { openid, label } = e.currentTarget.dataset
    if (!openid) return
    this.setData({ userFilter: openid, userFilterLabel: label || '该用户', userInput: '', detail: null })
    this.loadList(true)
  },

  onClearUser() {
    this.setData({ userFilter: '', userFilterLabel: '', userInput: '' })
    this.loadList(true)
  },

  onThumbError(e) {
    const idx = e.currentTarget.dataset.idx
    const row = this.data.list[idx]
    if (!row || row.thumb === row.imageUrl) return
    this.setData({ [`list[${idx}].thumb`]: row.imageUrl })
  },

  async openDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    this.setData({ detail: { id }, detailLoading: true, detailError: '' })
    try {
      const d = await this.callFn({ action: 'detail', id })
      if (!this.data.detail || this.data.detail.id !== id) return
      this.setData({ detail: decorateDetail(d), detailLoading: false })
    } catch (err) {
      this.setData({ detailLoading: false, detailError: err.message || String(err) })
    }
  },

  closeDetail() {
    this.setData({ detail: null, detailError: '' })
  },

  noop() {},

  previewImage() {
    const url = this.data.detail && this.data.detail.imageUrl
    if (!url) return
    wx.previewImage({ urls: [url], current: url })
  },

  openProduct(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/subpackages/feature/detail/index?id=${encodeURIComponent(id)}`,
      fail: () => this.showTip('藏品页暂时打不开', 'warn')
    })
  }
})
