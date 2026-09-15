const { trackBehavior } = require('../../../../utils/trackBehavior')
const { inferCollectionCategory, ATLAS_TAB_LIST } = require('../../utils/speciesCategory')
const { callAtlas, formatLogTime, methodLabel } = require('../../utils/atlas')

const db = wx.cloud.database()
const TAB_ALL = '全部'

function excerpt(text, n) {
  const s = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s) return ''
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function confidenceLabel(level, conf) {
  if (level === 'high' || conf >= 0.85) return '较有把握'
  if (level === 'medium' || conf >= 0.6) return '大致可辨'
  return '仅供参考'
}

function formatIdentifyTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const m = d.getMonth() + 1
  const day = d.getDate()
  return `${d.getFullYear()}.${m < 10 ? '0' : ''}${m}.${day < 10 ? '0' : ''}${day}`
}

function taxLine(taxonomy) {
  const t = taxonomy || {}
  return [t.family, t.order, t.class].filter(Boolean).slice(0, 2).join(' · ')
}

async function batchTempUrls(fileIds) {
  const urlMap = {}
  const unique = []
  const seen = {}
  ;(fileIds || []).forEach((id) => {
    if (id && !seen[id]) {
      seen[id] = true
      unique.push(id)
    }
  })
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50)
    try {
      const t = await wx.cloud.getTempFileURL({ fileList: chunk })
      ;(t.fileList || []).forEach((f) => {
        if (f.fileID && f.tempFileURL) urlMap[f.fileID] = f.tempFileURL
      })
    } catch (e) {}
  }
  return urlMap
}

function pick(row, key) {
  if (!row) return ''
  if (row[key] != null && row[key] !== '') return row[key]
  const snake = key.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`)
  return row[snake] != null ? row[snake] : ''
}

Page({
  data: {
    tab: 'identify',
    loading: true,
    records: [],
    filtered: [],
    logs: [],
    catTabs: ATLAS_TAB_LIST,
    catFilter: TAB_ALL,
    stats: { total: 0, bookmarked: 0 },
    recordsEmpty: false,
    logsEmpty: false,
    showAiIdentify: true
  },

  onLoad(options) {
    if (options.tab === 'notes') this.setData({ tab: 'notes' })
    this.loadDisplayFlags()
  },

  onShow() {
    this.loadAll()
  },

  async loadDisplayFlags() {
    try {
      const { fetchContentDisplayFlags } = require('../../../../utils/contentDisplayFlags')
      const { flags } = await fetchContentDisplayFlags()
      this.setData({ showAiIdentify: flags.showAiIdentify !== false })
    } catch (e) {
      this.setData({ showAiIdentify: true })
    }
  },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh())
  },

  onMode(e) {
    const tab = e.currentTarget.dataset.tab
    if (!tab || tab === this.data.tab) return
    this.setData({ tab })
  },

  onCat(e) {
    const cat = e.currentTarget.dataset.cat
    if (!cat || cat === this.data.catFilter) return
    this.setData({ catFilter: cat }, () => this.applyFilter())
  },

  applyFilter() {
    const cat = this.data.catFilter
    const filtered =
      cat === TAB_ALL ? this.data.records.slice() : this.data.records.filter((r) => r.category === cat)
    this.setData({
      filtered,
      recordsEmpty: !filtered.length
    })
  },

  async loadAll() {
    this.setData({ loading: true })
    await Promise.all([this.loadRecords(), this.loadLogs()])
    this.setData({ loading: false })
    trackBehavior('atlas_log_view', 'atlas', 'journal', {
      records: this.data.records.length,
      logs: this.data.logs.length
    })
  },

  async loadRecords() {
    let rows = []
    try {
      const res = await db
        .collection('identification_records')
        .orderBy('created_at', 'desc')
        .limit(50)
        .get()
      rows = res.data || []
    } catch (e) {
      try {
        const fn = await wx.cloud.callFunction({
          name: 'identifySpecimen',
          data: { action: 'list_recent', limit: 50 }
        })
        rows = (fn.result && fn.result.data) || []
      } catch (err) {
        rows = []
      }
    }

    rows.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    const fileIds = rows
      .map((d) => d.image_url)
      .filter((id) => id && String(id).indexOf('cloud://') === 0)
    const urlMap = await batchTempUrls(fileIds)

    const records = rows.map((d) => {
      const info = d.species_info || {}
      const ai = d.ai_content || {}
      const conf = typeof info.confidence === 'number' ? info.confidence : 0
      const fileId = d.image_url || ''
      const nameZh = info.species_name_zh || '未命名'
      return {
        id: d._id,
        nameZh,
        nameLatin: info.species_name_latin || '',
        category: inferCollectionCategory(info.taxonomy, nameZh),
        imageUrl: urlMap[fileId] || (String(fileId).indexOf('cloud://') === 0 ? '' : fileId),
        timeText: formatIdentifyTime(d.created_at),
        confidenceText: confidenceLabel(d.confidence_level, conf),
        taxLine: taxLine(info.taxonomy),
        excerpt: excerpt(ai.content || info.brief_description || '', 86),
        fact: excerpt(ai.fun_fact || '', 42),
        bookmarked: !!d.is_bookmarked,
        wild: info.is_specimen === false
      }
    })

    this.setData({
      records,
      stats: {
        total: records.length,
        bookmarked: records.filter((r) => r.bookmarked).length
      }
    })
    this.applyFilter()
  },

  async loadLogs() {
    try {
      const res = await callAtlas('logs')
      const rows = ((res.data && res.data.logs) || []).map((row) => {
        const wild = !!pick(row, 'wild')
        const speciesName = pick(row, 'speciesName')
        return {
          id: row._id || `${pick(row, 'createdAt')}-${pick(row, 'speciesId')}`,
          title: speciesName || (wild ? '野外笔记' : '未命名'),
          methodLabel: methodLabel(row.method),
          place: pick(row, 'place'),
          timeText: formatLogTime(pick(row, 'createdAt')),
          wild,
          speciesId: pick(row, 'speciesId'),
          recordId: pick(row, 'recordId')
        }
      })
      this.setData({ logs: rows, logsEmpty: !rows.length })
    } catch (e) {
      this.setData({ logs: [], logsEmpty: true })
    }
  },

  onOpenRecord(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/subpackages/feature/identify/result/index?record_id=${id}`
    })
  },

  onOpenLog(e) {
    const recordId = e.currentTarget.dataset.recordId
    const speciesId = e.currentTarget.dataset.speciesId
    if (recordId) {
      wx.navigateTo({
        url: `/subpackages/feature/identify/result/index?record_id=${recordId}`
      })
      return
    }
    if (speciesId) {
      wx.navigateTo({
        url: `/subpackages/feature/collection/detail/index?id=${speciesId}`
      })
    }
  },

  goIdentify() {
    if (!this.data.showAiIdentify) {
      const { toastAiIdentifyClosed } = require('../../../../utils/contentDisplayFlags')
      toastAiIdentifyClosed()
      return
    }
    wx.navigateTo({ url: '/subpackages/feature/identify/index?from=atlas_log' })
  },

  goAtlas() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/subpackages/feature/collection/index' })
    })
  }
})
