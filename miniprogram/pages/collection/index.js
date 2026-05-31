// 我的自然图鉴：按类别 tab + 双列卡片
const { ATLAS_TAB_LIST } = require('../../utils/speciesCategory')
const TAB_ALL = '全部'
const _ = wx.cloud.database().command

async function batchGetRecords(db, recordIds) {
  const map = {}
  for (let i = 0; i < recordIds.length; i += 20) {
    const chunk = recordIds.slice(i, i + 20)
    if (!chunk.length) continue
    try {
      const res = await db.collection('identification_records').where({ _id: _.in(chunk) }).get()
      ;(res.data || []).forEach((r) => { map[r._id] = r })
    } catch (e) {
      console.warn('batchGetRecords chunk', e)
    }
  }
  return map
}

async function batchTempUrls(fileIds) {
  const urlMap = {}
  const unique = [...new Set(fileIds.filter(Boolean))]
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50)
    try {
      const t = await wx.cloud.getTempFileURL({ fileList: chunk })
      ;(t.fileList || []).forEach((f) => {
        if (f.fileID && f.tempFileURL) urlMap[f.fileID] = f.tempFileURL
      })
    } catch (e) {
      console.warn('batchTempUrls chunk', e)
    }
  }
  return urlMap
}

Page({
  data: {
    loading: true,
    tabList: ATLAS_TAB_LIST,
    currentTab: TAB_ALL,
    stats: { total: 0, categories: 0 },
    items: [],
    filtered: [],
    leftCol: [],
    rightCol: []
  },

  onShow() {
    this.loadCollection()
  },

  async loadCollection() {
    this.setData({ loading: true })
    try {
      const db = wx.cloud.database()
      let col
      try {
        col = await db.collection('user_collection').orderBy('created_at', 'desc').limit(200).get()
      } catch (e) {
        col = await db.collection('user_collection').limit(200).get()
      }
      const rows = col.data || []
      const recordIds = rows.map((r) => r.record_id).filter(Boolean)
      const recordMap = await batchGetRecords(db, recordIds)

      const cloudIds = []
      Object.values(recordMap).forEach((doc) => {
        if (doc.image_url && String(doc.image_url).indexOf('cloud://') === 0) {
          cloudIds.push(doc.image_url)
        }
      })
      const urlMap = await batchTempUrls(cloudIds)

      const items = []
      rows.forEach((row) => {
        const doc = recordMap[row.record_id]
        if (!doc) return
        let thumb = ''
        if (doc.image_url) {
          if (String(doc.image_url).indexOf('cloud://') === 0) {
            thumb = urlMap[doc.image_url] || ''
          } else {
            thumb = doc.image_url
          }
        }
        const name = (doc.species_info && doc.species_info.species_name_zh) || '未命名物种'
        items.push({
          _id: row._id,
          record_id: row.record_id,
          category: row.category || '其他',
          name,
          thumb: thumb || '/assets/icons/camera.png'
        })
      })

      const catSet = new Set()
      items.forEach((it) => {
        if (it.category) catSet.add(it.category)
      })

      this.setData({
        items,
        stats: {
          total: items.length,
          categories: catSet.size
        },
        loading: false
      })
      this.applyTab(this.data.currentTab)
    } catch (e) {
      console.error(e)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  onTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ currentTab: tab })
    this.applyTab(tab)
  },

  applyTab(tab) {
    const { items } = this.data
    let filtered = items
    if (tab && tab !== TAB_ALL) {
      filtered = items.filter((x) => x.category === tab)
    }
    const leftCol = []
    const rightCol = []
    filtered.forEach((it, i) => {
      if (i % 2 === 0) leftCol.push(it)
      else rightCol.push(it)
    })
    this.setData({ filtered, leftCol, rightCol })
  },

  onOpen(e) {
    const id = e.currentTarget.dataset.record
    if (id) {
      wx.navigateTo({ url: `/pages/identify/result/index?record_id=${id}` })
    }
  },

  goIdentify() {
    wx.navigateTo({ url: '/pages/identify/index' })
  }
})
