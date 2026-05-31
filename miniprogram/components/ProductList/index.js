const db = wx.cloud.database()
const _ = db.command
const { getFirstImage } = require('../../utils/util')
const { getSoldCount } = require('../../utils/productStats')

const SORT_MAP = {
  new: { field: 'createTime', order: 'desc' },
  sales: { field: 'soldCount', order: 'desc' },
  price_asc: { field: 'price', order: 'asc' },
  price_desc: { field: 'price', order: 'desc' }
}

const CLIENT_SORT_KEYS = ['sales', 'price_asc', 'price_desc']
const FETCH_CAP = 200

function getProductPrice(item) {
  if (item.hasSku && Array.isArray(item.skus) && item.skus.length) {
    const prices = item.skus.map((s) => parseFloat(s.price) || 0).filter((p) => p > 0)
    if (prices.length) return Math.min(...prices)
  }
  return parseFloat(item.price) || 0
}

function getSoldCountFromItem(item) {
  return getSoldCount(item)
}

function sortProducts(list, sortKey) {
  const items = list.slice()
  if (sortKey === 'sales') {
    items.sort((a, b) => getSoldCountFromItem(b) - getSoldCountFromItem(a))
  } else if (sortKey === 'price_asc') {
    items.sort((a, b) => getProductPrice(a) - getProductPrice(b))
  } else if (sortKey === 'price_desc') {
    items.sort((a, b) => getProductPrice(b) - getProductPrice(a))
  }
  return items
}

function buildPriceSortLabel(sortKey) {
  if (sortKey === 'price_asc') return '价格↑'
  if (sortKey === 'price_desc') return '价格↓'
  return '价格'
}

Component({
  properties: {
    category: { type: String, value: '' },
    keyword: { type: String, value: '' },
    sort: { type: String, value: 'new' },
    pageSize: { type: Number, value: 10 },
    autoLoad: { type: Boolean, value: true }
  },

  data: {
    list: [],
    page: 0,
    hasMore: true,
    loading: false,
    sortOptions: [
      { key: 'new', label: '最新' },
      { key: 'sales', label: '销量' },
      { key: 'price', label: '价格', isPrice: true }
    ],
    currentSort: 'new',
    priceSortLabel: '价格'
  },

  lifetimes: {
    attached() {
      const initial = this.properties.sort || 'new'
      this.setData({
        currentSort: initial,
        priceSortLabel: buildPriceSortLabel(initial)
      })
      if (this.properties.autoLoad) {
        this.reload()
      }
    }
  },

  pageLifetimes: {
    show() {
      if (!this.properties.autoLoad) return
      if (this._pageShownOnce) {
        this.reload()
      }
      this._pageShownOnce = true
    }
  },

  observers: {
    'category, keyword'() {
      if (this.properties.autoLoad) {
        this.reload()
      }
    },
    sort(val) {
      if (!val || val === this.data.currentSort) return
      this.setData({
        currentSort: val,
        priceSortLabel: buildPriceSortLabel(val)
      })
      this.reload()
    }
  },

  methods: {
    reload() {
      this._fullSortedList = null
      this.setData({ list: [], page: 0, hasMore: true })
      this.loadList()
    },

    onSortTap(e) {
      const key = e.currentTarget.dataset.key
      if (key === 'price') {
        let next = 'price_asc'
        if (this.data.currentSort === 'price_asc') next = 'price_desc'
        else if (this.data.currentSort === 'price_desc') next = 'price_asc'
        this.setData({
          currentSort: next,
          priceSortLabel: buildPriceSortLabel(next)
        })
        this.triggerEvent('sortchange', { sort: next })
        this.reload()
        return
      }
      if (key === this.data.currentSort) return
      this.setData({
        currentSort: key,
        priceSortLabel: buildPriceSortLabel(key)
      })
      this.triggerEvent('sortchange', { sort: key })
      this.reload()
    },

    isClientSort(sortKey) {
      return CLIENT_SORT_KEYS.includes(sortKey)
    },

    buildQuery() {
      const cond = { isOffShelf: false }
      if (this.properties.category) {
        cond.category = this.properties.category
      }
      if (this.properties.keyword) {
        const kw = this.properties.keyword
        return db.collection('products').where(_.and([
          cond,
          _.or([
            { title: db.RegExp({ regexp: kw, options: 'i' }) },
            { latinName: db.RegExp({ regexp: kw, options: 'i' }) }
          ])
        ]))
      }
      return db.collection('products').where(cond)
    },

    async hydrateProducts(rawList, sortKey) {
      return Promise.all(rawList.map(async (item) => {
        let img = getFirstImage(item.images)
        if (img && img.startsWith('cloud')) {
          try {
            const urlRes = await wx.cloud.getTempFileURL({ fileList: [img] })
            img = urlRes.fileList[0].tempFileURL
          } catch (e) {}
        }
        return {
          ...item,
          httpImage: img,
          isNew: sortKey === 'new',
          soldCount: getSoldCountFromItem(item)
        }
      }))
    },

    async fetchAllProducts() {
      const res = await this.buildQuery()
        .orderBy('createTime', 'desc')
        .limit(FETCH_CAP)
        .get()
      return res.data || []
    },

    async loadListClientSort(sortKey) {
      if (this.data.loading || !this.data.hasMore) return
      this.setData({ loading: true })
      try {
        if (!this._fullSortedList) {
          const raw = await this.fetchAllProducts()
          const hydrated = await this.hydrateProducts(raw, sortKey)
          this._fullSortedList = sortProducts(hydrated, sortKey)
        }
        const skip = this.data.page * this.properties.pageSize
        const batch = this._fullSortedList.slice(skip, skip + this.properties.pageSize)
        const list = this.data.page === 0 ? batch : this.data.list.concat(batch)
        this.setData({
          list,
          page: this.data.page + 1,
          hasMore: skip + batch.length < this._fullSortedList.length,
          loading: false
        })
      } catch (e) {
        console.error('ProductList loadListClientSort', e)
        this.setData({ loading: false })
      }
    },

    async loadList() {
      if (this.data.loading || !this.data.hasMore) return

      const sortKey = this.data.currentSort
      if (this.isClientSort(sortKey)) {
        return this.loadListClientSort(sortKey)
      }

      this.setData({ loading: true })
      const sortCfg = SORT_MAP[sortKey] || SORT_MAP.new
      const skip = this.data.page * this.properties.pageSize

      try {
        const res = await this.buildQuery()
          .orderBy(sortCfg.field, sortCfg.order)
          .skip(skip)
          .limit(this.properties.pageSize)
          .get()

        const batch = await this.hydrateProducts(res.data, sortKey)
        const list = this.data.page === 0 ? batch : this.data.list.concat(batch)
        this.setData({
          list,
          page: this.data.page + 1,
          hasMore: batch.length >= this.properties.pageSize,
          loading: false
        })
      } catch (e) {
        console.error('ProductList loadList', e)
        this.setData({ loading: false })
      }
    },

    loadMore() {
      this.loadList()
    },

    onProductTap(e) {
      const info = e.detail
      this.triggerEvent('itemtap', info)
    }
  }
})
