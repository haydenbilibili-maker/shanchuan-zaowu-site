const db = wx.cloud.database()
const _ = db.command
const { getFirstImage, batchTempFileURLs } = require('../../utils/util')
const { getDisplaySoldCount } = require('../../utils/productStats')
const { sanitizeLatinName } = require('../../utils/latinDisplay')
const { collectRootAliases, toCanonicalRootName } = require('../../utils/categorySeed')
const { buildKeywordCondition, rankByKeyword, PRODUCT_FIELDS } = require('../../utils/fuzzySearch')
const { createFeedDiversifier, DEFAULTS: DIVERSIFY_DEFAULTS } = require('../../utils/feedDiversify')

const SORT_MAP = {
  new: { field: 'createTime', order: 'desc' },
  sales: { field: 'soldCount', order: 'desc' },
  price_asc: { field: 'price', order: 'asc' },
  price_desc: { field: 'price', order: 'desc' }
}

const CLIENT_SORT_KEYS = ['sales', 'price_asc', 'price_desc']
/** 小程序端单次 get 上限为 20，超限会被静默截断 */
const CLIENT_MAX_LIMIT = 20
/** 销量/价格客户端全量排序的上限（分批拉取） */
const FETCH_CAP = 200
/** 首屏自动补屏最多再拉几页（不含首屏），避免撑高挡住下方模块 */
const DEFAULT_AUTO_FILL_MAX = 1
/** 打散时池内至少保留的候选数（约等于 lookahead） */
const DIVERSIFY_POOL_MIN = DIVERSIFY_DEFAULTS.lookahead

function getProductPrice(item) {
  if (item.hasSku && Array.isArray(item.skus) && item.skus.length) {
    const prices = item.skus.map((s) => parseFloat(s.price) || 0).filter((p) => p > 0)
    if (prices.length) return Math.min(...prices)
  }
  return parseFloat(item.price) || 0
}

/** 与 ProductCard「已售 N」一致：按美化展示销量排序；孤品无展示销量视为 0 */
function getSortSoldCount(item) {
  const n = getDisplaySoldCount(item)
  return n == null ? 0 : n
}

function sortProducts(list, sortKey) {
  const items = list.slice()
  if (sortKey === 'sales') {
    items.sort((a, b) => getSortSoldCount(b) - getSortSoldCount(a))
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

function productIdKey(item) {
  if (!item || item._id == null || item._id === '') return ''
  return String(item._id)
}

/** 按 _id 去重，保留首次出现顺序（无 _id 的项原样保留） */
function dedupeById(list) {
  const seen = new Set()
  const out = []
  ;(list || []).forEach((item) => {
    const key = productIdKey(item)
    if (key) {
      if (seen.has(key)) return
      seen.add(key)
    }
    out.push(item)
  })
  return out
}

/** append 时按 _id 合并，避免竞态把同一页 concat 两次 */
function mergeUniqueById(existing, incoming) {
  if (!existing || !existing.length) return dedupeById(incoming)
  const seen = new Set()
  existing.forEach((item) => {
    const key = productIdKey(item)
    if (key) seen.add(key)
  })
  const out = existing.slice()
  ;(incoming || []).forEach((item) => {
    const key = productIdKey(item)
    if (key) {
      if (seen.has(key)) return
      seen.add(key)
    }
    out.push(item)
  })
  return out
}

Component({
  properties: {
    /** 兼容旧调用：二级名或一级短名字符串 */
    category: { type: String, value: '' },
    /** 规范一级馆 _id */
    rootCategoryId: { type: String, value: '' },
    /** 二级分类 _id */
    categoryId: { type: String, value: '' },
    keyword: { type: String, value: '' },
    sort: { type: String, value: 'new' },
    pageSize: { type: Number, value: 10 },
    autoLoad: { type: Boolean, value: true },
    /** 首屏内容不足时自动补屏的最大额外页数 */
    autoFillMax: { type: Number, value: DEFAULT_AUTO_FILL_MAX },
    /** 「最新」排序时按品类/主标签打散；销量/价格不受影响 */
    diversify: { type: Boolean, value: true }
  },

  data: {
    list: [],
    page: 0,
    hasMore: true,
    loading: false,
    loadError: false,
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
      this._ready = true
      this._fetchGen = 0
      this._loading = false
      this._feedPaused = false
      this._autoFillUsed = 0
      this._sentinelInView = false
      this._resetDiversifyState()
      if (this.properties.autoLoad) {
        this.reload()
      }
      wx.nextTick(() => this._setupReachObserver())
    },
    detached() {
      this._teardownReachObserver()
    }
  },

  pageLifetimes: {
    show() {
      if (!this.properties.autoLoad) return
      if (this._pageShownOnce) {
        const stale = Date.now() - (this._lastLoadedAt || 0) > 60 * 1000
        if (stale) {
          if (this.data.list && this.data.list.length) this.softReload()
          else this.reload()
        }
      }
      this._pageShownOnce = true
    }
  },

  observers: {
    'category, categoryId, rootCategoryId, keyword'() {
      if (!this._ready || !this.properties.autoLoad) return
      this.reload()
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
    /**
     * 外部（如首页下方模块进入视口）暂停/恢复商品流分页。
     * 恢复时若哨兵仍在视口内，补一次 loadMore。
     */
    setFeedPaused(paused) {
      const next = !!paused
      if (this._feedPaused === next) return
      this._feedPaused = next
      if (!next && this._sentinelInView) {
        this.loadMore({ reason: 'resume' })
      }
    },

    isFeedPaused() {
      return !!this._feedPaused
    },

    _setupReachObserver() {
      this._teardownReachObserver()
      try {
        this._reachObserver = this.createIntersectionObserver({ thresholds: [0] })
        this._reachObserver
          .relativeToViewport({ bottom: 120 })
          .observe('.list-sentinel', (res) => {
            const inView = !!(res && res.intersectionRatio > 0)
            this._sentinelInView = inView
            if (!inView || this._feedPaused) return
            this.loadMore({ reason: 'sentinel' })
          })
      } catch (e) {
        console.warn('ProductList reach observer', e)
      }
    },

    _teardownReachObserver() {
      if (this._reachObserver) {
        try { this._reachObserver.disconnect() } catch (e) { /* ignore */ }
        this._reachObserver = null
      }
    },

    _autoFillLimit() {
      const n = Number(this.properties.autoFillMax)
      return Number.isFinite(n) && n >= 0 ? n : DEFAULT_AUTO_FILL_MAX
    },

    /** 首屏内容不足一屏时，哨兵仍在视口内，有节制地补页 */
    _maybeContinueLoad() {
      if (this._feedPaused) return
      if (!this.data.hasMore || this._loading || this.data.loading || !this.data.list.length) return
      if ((this._autoFillUsed || 0) >= this._autoFillLimit()) return
      try {
        this.createSelectorQuery()
          .select('.list-sentinel')
          .boundingClientRect()
          .selectViewport()
          .boundingClientRect()
          .exec((rects) => {
            if (this._feedPaused) return
            if (this._loading || this.data.loading || !this.data.hasMore) return
            if ((this._autoFillUsed || 0) >= this._autoFillLimit()) return
            const sentinel = rects && rects[0]
            const viewport = rects && rects[1]
            if (!sentinel || !viewport) return
            if (sentinel.top <= (viewport.height || 0) + 120) {
              this._autoFillUsed = (this._autoFillUsed || 0) + 1
              this.loadMore({ reason: 'autofill' })
            }
          })
      } catch (e) { /* ignore */ }
    },

    _resetDiversifyState() {
      this._feedDiversifier = createFeedDiversifier()
      this._diversifyDbSkip = 0
      this._diversifyDbExhausted = false
    },

    shouldDiversify(sortKey) {
      return sortKey === 'new' && this.properties.diversify !== false
    },

    reload() {
      // 作废进行中的请求，避免旧页结果 append 到清空后的列表
      this._fetchGen = (this._fetchGen || 0) + 1
      this._fullSortedList = null
      this._resetDiversifyState()
      this._loading = false
      this._autoFillUsed = 0
      this.setData({ list: [], page: 0, hasMore: true, loadError: false, loading: false })
      this.loadList()
    },

    /** 保留旧列表静默刷新，避免切 Tab 闪空白 */
    softReload() {
      this._fetchGen = (this._fetchGen || 0) + 1
      this._fullSortedList = null
      this._resetDiversifyState()
      this._loading = false
      this._autoFillUsed = 0
      this.setData({ page: 0, hasMore: true, loadError: false })
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
      // _.neq(true) 兼容缺省 isOffShelf 的老文档；上架语义仍是「未明确下架」
      const cond = { isOffShelf: _.neq(true) }
      const categoryId = this.properties.categoryId
      const rootCategoryId = this.properties.rootCategoryId
      const category = this.properties.category

      if (categoryId) {
        Object.assign(cond, {
          // 权威：二级 ID；名称兜底兼容旧数据
        })
        const catOr = [{ categoryId }]
        if (category) catOr.push({ category })
        const whereBase = _.and([cond, _.or(catOr)])
        if (this.properties.keyword) {
          const kwCond = buildKeywordCondition(db, _, this.properties.keyword, PRODUCT_FIELDS)
          if (kwCond) {
            return db.collection('products').where(_.and([whereBase, kwCond]))
          }
        }
        return db.collection('products').where(whereBase)
      }

      if (rootCategoryId) {
        const aliases = category ? collectRootAliases(category) : []
        const orConds = [{ rootCategoryId }]
        if (aliases.length) {
          orConds.push({ rootCategoryName: _.in(aliases) })
          orConds.push({ category: _.in(aliases) })
        }
        const whereBase = _.and([cond, _.or(orConds)])
        if (this.properties.keyword) {
          const kwCond = buildKeywordCondition(db, _, this.properties.keyword, PRODUCT_FIELDS)
          if (kwCond) {
            return db.collection('products').where(_.and([whereBase, kwCond]))
          }
        }
        return db.collection('products').where(whereBase)
      }

      if (category) {
        const canonical = toCanonicalRootName(category)
        const aliases = collectRootAliases(category)
        if (canonical || aliases.length) {
          const names = aliases.length ? aliases : [category]
          Object.assign(cond, {})
          const whereBase = _.and([cond, _.or([
            { rootCategoryName: _.in(names) },
            { category: _.in(names) }
          ])])
          if (this.properties.keyword) {
            const kwCond = buildKeywordCondition(db, _, this.properties.keyword, PRODUCT_FIELDS)
            if (kwCond) {
              return db.collection('products').where(_.and([whereBase, kwCond]))
            }
          }
          return db.collection('products').where(whereBase)
        }
        cond.category = category
      }
      if (this.properties.keyword) {
        const kwCond = buildKeywordCondition(db, _, this.properties.keyword, PRODUCT_FIELDS)
        if (kwCond) {
          return db.collection('products').where(_.and([cond, kwCond]))
        }
      }
      return db.collection('products').where(cond)
    },

    async hydrateProducts(rawList, sortKey) {
      const imgs = rawList.map((item) => getFirstImage(item.images))
      const urlMap = await batchTempFileURLs(imgs)
      return rawList.map((item, i) => {
        const img = imgs[i]
        return {
          ...item,
          latinName: sanitizeLatinName(item.latinName || item.latin || item.scientificName),
          httpImage: (img && urlMap[img]) || img,
          isNew: sortKey === 'new'
        }
      })
    },

    async fetchAllProducts() {
      // 小程序端 limit 最大 20，必须分批 skip 才能拿到完整候选集再排序
      const all = []
      const seen = new Set()
      let skip = 0
      while (skip < FETCH_CAP) {
        const limit = Math.min(CLIENT_MAX_LIMIT, FETCH_CAP - skip)
        const res = await this.buildQuery()
          .orderBy('createTime', 'desc')
          .skip(skip)
          .limit(limit)
          .get()
        const batch = res.data || []
        batch.forEach((item) => {
          const key = productIdKey(item)
          if (key) {
            if (seen.has(key)) return
            seen.add(key)
          }
          all.push(item)
        })
        if (batch.length < limit) break
        skip += batch.length
      }
      return all
    },

    async loadListClientSort(sortKey) {
      // 同步锁：setData({ loading }) 异步，observer + _maybeContinueLoad 会并发同页
      if (this._loading || !this.data.hasMore) return
      this._loading = true
      const gen = this._fetchGen || 0
      const pageAtStart = this.data.page
      this.setData({ loading: true })
      try {
        if (!this._fullSortedList) {
          let raw = await this.fetchAllProducts()
          if (gen !== (this._fetchGen || 0)) return
          const kw = String(this.properties.keyword || '').trim()
          if (kw && sortKey === 'new') {
            raw = rankByKeyword(raw, kw)
          } else {
            // 销量按 getDisplaySoldCount（与卡片「已售 N」一致）重排后再分页 hydrate
            raw = sortProducts(raw, sortKey)
          }
          this._fullSortedList = raw
        }
        const skip = pageAtStart * this.properties.pageSize
        const batch = this._fullSortedList.slice(skip, skip + this.properties.pageSize)
        const hydrated = await this.hydrateProducts(batch, sortKey)
        if (gen !== (this._fetchGen || 0)) return
        const list = pageAtStart === 0
          ? dedupeById(hydrated)
          : mergeUniqueById(this.data.list, hydrated)
        this._lastLoadedAt = Date.now()
        const hasMore = skip + batch.length < this._fullSortedList.length
        this.setData({
          list,
          page: pageAtStart + 1,
          hasMore,
          loading: false
        }, () => {
          if (gen !== (this._fetchGen || 0)) return
          this._setupReachObserver()
          if (hasMore) this._maybeContinueLoad()
        })
      } catch (e) {
        console.error('ProductList loadListClientSort', e)
        if (gen !== (this._fetchGen || 0)) return
        this.setData({ loading: false, loadError: this.data.list.length === 0 })
        if (this.data.list.length === 0) {
          wx.showToast({ title: '藏品加载失败', icon: 'none' })
        }
      } finally {
        if (gen === (this._fetchGen || 0)) this._loading = false
      }
    },

    async fetchCreateTimeBatch(skip, limit) {
      const res = await this.buildQuery()
        .orderBy('createTime', 'desc')
        .skip(skip)
        .limit(limit)
        .get()
      return res.data || []
    },

    /**
     * 「最新」流：DB 仍按 createTime 取候选，本地 greedy 打散后再出页。
     * 候选池 + recent 品类/标签窗口跨页保留，避免翻页后重新扎堆。
     */
    async loadListDiversified() {
      if (this._loading || !this.data.hasMore) return
      this._loading = true
      const gen = this._fetchGen || 0
      const pageAtStart = this.data.page
      const pageSize = Math.max(1, this.properties.pageSize || 10)
      this.setData({ loading: true })

      try {
        if (!this._feedDiversifier) this._resetDiversifyState()
        const diversifier = this._feedDiversifier

        // softReload / 竞态：第 0 页强制从库头重建池
        if (pageAtStart === 0) {
          diversifier.reset()
          this._diversifyDbSkip = 0
          this._diversifyDbExhausted = false
        }

        const selected = []
        while (selected.length < pageSize) {
          if (gen !== (this._fetchGen || 0)) return

          while (
            !this._diversifyDbExhausted &&
            diversifier.pendingCount() < DIVERSIFY_POOL_MIN
          ) {
            const batch = await this.fetchCreateTimeBatch(
              this._diversifyDbSkip || 0,
              CLIENT_MAX_LIMIT
            )
            if (gen !== (this._fetchGen || 0)) return
            this._diversifyDbSkip = (this._diversifyDbSkip || 0) + batch.length
            if (batch.length < CLIENT_MAX_LIMIT) this._diversifyDbExhausted = true
            diversifier.pushCandidates(batch)
            if (!batch.length) break
          }

          const pending = diversifier.pendingCount()
          if (!pending) break

          const need = pageSize - selected.length
          const drain = !!this._diversifyDbExhausted
          const picked = diversifier.take(need, { drain })
          if (!picked.length) break
          selected.push(...picked)

          // 库未耗尽但池被抽空到不够 lookahead：继续补库再选
          if (
            selected.length < pageSize &&
            !this._diversifyDbExhausted &&
            diversifier.pendingCount() < DIVERSIFY_POOL_MIN
          ) {
            continue
          }
          // 已 drain 或暂无更多候选
          if (this._diversifyDbExhausted) break
        }

        if (gen !== (this._fetchGen || 0)) return

        const hydrated = await this.hydrateProducts(selected, 'new')
        if (gen !== (this._fetchGen || 0)) return

        const list = pageAtStart === 0
          ? dedupeById(hydrated)
          : mergeUniqueById(this.data.list, hydrated)
        this._lastLoadedAt = Date.now()
        const hasMore = diversifier.pendingCount() > 0 || !this._diversifyDbExhausted
        this.setData({
          list,
          page: pageAtStart + 1,
          hasMore,
          loading: false
        }, () => {
          if (gen !== (this._fetchGen || 0)) return
          this._setupReachObserver()
          if (hasMore) this._maybeContinueLoad()
        })
      } catch (e) {
        console.error('ProductList loadListDiversified', e)
        if (gen !== (this._fetchGen || 0)) return
        this.setData({ loading: false, loadError: this.data.list.length === 0 })
        if (this.data.list.length === 0) {
          wx.showToast({ title: '藏品加载失败', icon: 'none' })
        }
      } finally {
        if (gen === (this._fetchGen || 0)) this._loading = false
      }
    },

    async loadList() {
      if (this._loading || !this.data.hasMore) return

      const sortKey = this.data.currentSort
      const kw = String(this.properties.keyword || '').trim()
      // 关键词 + 默认排序：与主搜索一致，全量召回后 rankByKeyword 再分页
      if (this.isClientSort(sortKey) || (kw && sortKey === 'new')) {
        return this.loadListClientSort(sortKey)
      }
      // 无关键词的「最新」：跨页打散（品类 + 主标签），降低时间权重
      if (this.shouldDiversify(sortKey)) {
        return this.loadListDiversified()
      }

      this._loading = true
      const gen = this._fetchGen || 0
      const sortCfg = SORT_MAP[sortKey] || SORT_MAP.new
      const pageSize = Math.max(1, this.properties.pageSize || 10)
      const pageAtStart = this.data.page
      const skip = pageAtStart * pageSize
      this.setData({ loading: true })

      try {
        // pageSize 可能 > 20，按客户端上限分批拼成一页
        const raw = []
        let fetched = 0
        while (fetched < pageSize) {
          const limit = Math.min(CLIENT_MAX_LIMIT, pageSize - fetched)
          const res = await this.buildQuery()
            .orderBy(sortCfg.field, sortCfg.order)
            .skip(skip + fetched)
            .limit(limit)
            .get()
          const chunk = res.data || []
          raw.push(...chunk)
          if (chunk.length < limit) break
          fetched += chunk.length
        }

        if (gen !== (this._fetchGen || 0)) return

        const batch = await this.hydrateProducts(dedupeById(raw), sortKey)
        if (gen !== (this._fetchGen || 0)) return

        const list = pageAtStart === 0
          ? dedupeById(batch)
          : mergeUniqueById(this.data.list, batch)
        this._lastLoadedAt = Date.now()
        const hasMore = raw.length >= pageSize
        this.setData({
          list,
          page: pageAtStart + 1,
          hasMore,
          loading: false
        }, () => {
          if (gen !== (this._fetchGen || 0)) return
          this._setupReachObserver()
          if (hasMore) this._maybeContinueLoad()
        })
      } catch (e) {
        console.error('ProductList loadList', e)
        if (gen !== (this._fetchGen || 0)) return
        this.setData({ loading: false, loadError: this.data.list.length === 0 })
        if (this.data.list.length === 0) {
          wx.showToast({ title: '藏品加载失败', icon: 'none' })
        }
      } finally {
        if (gen === (this._fetchGen || 0)) this._loading = false
      }
    },

    loadMore(opts) {
      if (this._loading || this.data.loading || !this.data.hasMore) return
      // bindtap 会传入事件对象；仅显式 { reason } 视为自动触发
      const reason = (opts && typeof opts.reason === 'string') ? opts.reason : 'manual'
      // 暂停时仅允许用户手动点「继续下滑」
      if (this._feedPaused && reason !== 'manual') return
      this.loadList()
    },

    onEmptyTap() {
      if (this.data.loadError) this.reload()
    },

    onProductTap(e) {
      const detail = (e && e.detail) || {}
      const id = detail.id || detail._id || ''
      if (!id) {
        wx.showToast({ title: '藏品不存在', icon: 'none' })
        return
      }
      // 对外保持 _id，兼容页面 goToDetail(e.detail._id)；同时带 id 防止下游丢字段
      this.triggerEvent('itemtap', {
        id: String(id),
        _id: String(id),
        title: detail.title || '',
        category: detail.category || '',
        tags: detail.tags || []
      })
    }
  }
})
