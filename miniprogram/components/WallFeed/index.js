/**
 * WallFeed —— 「祈福内容流」自包含组件（PRD §11.1 R2 / §11.3「祈福」分区）。
 *
 * ## 为什么抽成组件
 * 祈福墙主页面（subpackages/feature/wish-wall/index.{js,wxml,wxss}）正被 R1（玩法大改）编辑，
 * 内容流必须与它**文件级解耦**：页面只传原始数据与回调能力，组件自己持有全部视图态。
 *
 * ## 契约（属性进 / 事件出）—— 集成官照这张表接线
 * ### 属性（properties）
 * | 名称 | 类型 | 默认 | 含义 |
 * |---|---|---|---|
 * | `items`       | Array   | []    | 墙上的愿签（页面 `applyItems` 归一化后的行模型） |
 * | `mineRows`    | Array   | []    | 我的心愿（页面 `decorateMineRows` 的行模型，含已收起） |
 * | `wallCount`   | Number  | 0     | 墙上条数（与当前视图无关，页面 `wallCount`） |
 * | `mineTotal`   | Number  | 0     | 我的心愿总数（页面 `mine.total`） |
 * | `loading`     | Boolean | false | 墙列表加载中（页面 `loading`） |
 * | `loadError`   | String  | ''    | 墙列表失败文案（页面 `loadError`） |
 * | `mineLoading` | Boolean | false | 我的心愿加载中（页面 `mineLoading`） |
 * | `mineError`   | String  | ''    | 我的心愿失败文案（页面 `mineError`） |
 * | `allowed`     | Boolean | false | 门禁：false 时组件整块不渲染（页面已有自己的关闭态） |
 * | `hasMore`     | Boolean | false | **服务端**是否还有更多（当前 C 端列表一次取回 → 保持 false） |
 * | `manageable`  | Boolean | false | 页面是否已具备写操作能力；true 才渲染「收起/恢复/删除」 |
 * | `pageSize`    | Number  | 20    | 每次「加载更多」展开的条数 |
 *
 * 行模型的字段（`items[i]` / `mineRows[i]` —— 全部由页面提供，组件不猜）：
 *   `_id` `text` `nickname` `avatar` `pinned` `official` `timeText` `isFresh`（墙）
 *   `isMine`（墙：是否我写的） / `hidden`（我的：是否已被馆方收起）
 *
 * ### 事件（triggerEvent）
 * | 事件 | detail | 何时 |
 * |---|---|---|
 * | `switchview` | `{view}`            | 切换「墙上的愿签 / 我的心愿」 |
 * | `loadmore`   | `{view,cursor,rendered}` | 本地已展开完且 `hasMore=true` → 请页面取下一页 |
 * | `retry`      | `{}`                | 墙列表失败（含"加载更多失败"）→ 页面 refresh |
 * | `retrymine`  | `{}`                | 我的心愿失败 → 页面 loadMine |
 * | `openwish`   | `{id,view}`         | 点开一张愿签（组件同时自己打开详情层） |
 * | `closewish`  | `{id}`              | 关闭详情层 |
 * | `borrowwish` | `{id,text}`         | 详情里「抄一句」→ 页面填输入框 |
 * | `hidewish`   | `{id,view}`         | 我的 · 收起（**只出事件，组件不调云函数**） |
 * | `restorewish`| `{id,view}`         | 我的 · 恢复上墙（同上） |
 * | `deletewish` | `{id,view}`         | 我的 · 删除（同上） |
 *
 * ## 不可越界（PRD §11.1 R2）
 *   · **不发云调用**：本文件没有 `wx.cloud` / `callFunction` / 集合读写（由守卫钉住）；
 *   · 不编造社会证明（无"热度/多少人许过"这类需要服务端计数的面，§5）；
 *   · 不引入 UGC 审核面（本仓现行口径不接审核）；
 *   · 筛选 / 排序只在**已取回的数据**上做，不新增服务端契约。
 *
 * ## 渲染落点（集成官注意）
 *   组件**不带左右内边距**，沿用页面 `.ww-page` 的 `--space-4`（与改造前的愿签列表一致）。
 *   详情层用 `position: fixed` + `z-index: 60`（高于页面纸签弹层的 41）——
 *   请把组件放在**没有 transform / z-index 的祖先**里（fixed 会被带 z-index 的祖先困住，
 *   本页 `.ww-plays` 就踩过这个坑）。
 */
const {
  PAGE_SIZE,
  VIEWS,
  SORTS,
  WALL_FILTERS,
  MINE_FILTERS,
  EMPTY_TEXT,
  deriveView
} = require('./logic')
const { wishTextCount } = require('../../utils/wishTextCount')

/** 组件持有的视图态（全部在 data 里，页面不传） */
function initialViewState() {
  return {
    viewMode: 'wall',
    wallFilter: 'all',
    mineFilter: 'all',
    sort: 'new',
    wallLimit: PAGE_SIZE,
    mineLimit: PAGE_SIZE
  }
}

Component({
  options: {
    addGlobalClass: true,
    styleIsolation: 'apply-shared'
  },

  properties: {
    items: { type: Array, value: [] },
    mineRows: { type: Array, value: [] },
    wallCount: { type: Number, value: 0 },
    mineTotal: { type: Number, value: 0 },
    loading: { type: Boolean, value: false },
    loadError: { type: String, value: '' },
    mineLoading: { type: Boolean, value: false },
    mineError: { type: String, value: '' },
    allowed: { type: Boolean, value: false },
    hasMore: { type: Boolean, value: false },
    manageable: { type: Boolean, value: false },
    pageSize: { type: Number, value: PAGE_SIZE }
  },

  data: Object.assign(initialViewState(), {
    /** 两栏的元数据（静态，放进 data 让 WXML 只做 for，不在模板里写判断） */
    views: VIEWS,
    sorts: SORTS,
    filters: WALL_FILTERS,
    /** 推导结果（全部由 _recompute 写；WXML 只读） */
    columns: [[], []],
    filter: 'all',
    total: 0,
    rendered: 0,
    loadState: 'nomore',
    loadLabel: '',
    showSkeleton: false,
    showError: false,
    showEmpty: false,
    errorText: '',
    emptyText: EMPTY_TEXT.wall,
    /** 详情层：null = 未打开 */
    detail: null,
    detailCount: 0
  }),

  observers: {
    'items, mineRows, loading, loadError, mineLoading, mineError, allowed, hasMore, manageable, pageSize': function () {
      this._recompute()
    }
  },

  lifetimes: {
    attached() {
      this._recompute()
    }
  },

  methods: {
    /* ------------------------- 推导（唯一写入点） ------------------------- */

    /** 当前视图态（喂给纯函数核） */
    _viewState() {
      return {
        viewMode: this.data.viewMode,
        wallFilter: this.data.wallFilter,
        mineFilter: this.data.mineFilter,
        sort: this.data.sort,
        wallLimit: this.data.wallLimit,
        mineLimit: this.data.mineLimit
      }
    },

    /** 由「页面属性 + 视图态 + 在途标记」重算全部渲染字段 —— 组件里唯一写这些字段的地方 */
    _recompute() {
      const v = deriveView(this.properties, this._viewState(), this._pending || null)
      if (v.pendingResolved || v.error) this._pending = null
      this.setData({
        filters: v.filters,
        filter: v.filter,
        columns: v.columns,
        total: v.total,
        rendered: v.rendered,
        loadState: v.loadState,
        loadLabel: v.loadLabel,
        showSkeleton: v.showSkeleton,
        showError: v.showError,
        showEmpty: v.showEmpty,
        errorText: v.errorText,
        emptyText: v.emptyText
      })
    },

    /* ------------------------------ 视图态 ------------------------------ */

    /** 两栏切换 */
    onSwitchView(e) {
      const view = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.view === 'mine' ? 'mine' : 'wall'
      if (view === this.data.viewMode) return
      this._pending = null
      this.setData({ viewMode: view, detail: null, detailCount: 0 })
      this._recompute()
      this.triggerEvent('switchview', { view })
    },

    /** 筛选（墙 / 我的各有自己的一组维度；换筛选从第一页重新开始） */
    onFilter(e) {
      const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.filter) || '')
      if (!id) return
      const key = this.data.viewMode === 'mine' ? 'mineFilter' : 'wallFilter'
      const list = this.data.viewMode === 'mine' ? MINE_FILTERS : WALL_FILTERS
      if (!list.some((f) => f.id === id)) return
      if (this.data[key] === id) return
      const limitKey = this.data.viewMode === 'mine' ? 'mineLimit' : 'wallLimit'
      this._pending = null
      this.setData({ [key]: id, [limitKey]: this._pageSize() })
      this._recompute()
    },

    /** 排序（换排序同样回到第一页） */
    onSort(e) {
      const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.sort) || '')
      if (!id || !SORTS.some((s) => s.id === id)) return
      if (this.data.sort === id) return
      this._pending = null
      this.setData({ sort: id, wallLimit: this._pageSize(), mineLimit: this._pageSize() })
      this._recompute()
    },

    /* ---------------------------- 加载更多 ---------------------------- */

    _pageSize() {
      const n = Number(this.properties.pageSize)
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : PAGE_SIZE
    },

    /**
     * 「加载更多」：本地还有未展开的先展开；本地展开完了但 `hasMore` → 发 `loadmore` 请页面取。
     * 失败态下的重试走 `onRetry`（页面 refresh / loadMine），不重复发 loadmore。
     */
    onLoadMore() {
      if (this.data.loadState === 'loading') return
      const state = this._viewState()
      const before = deriveView(this.properties, state, null)
      if (before.moreLocal) {
        const key = before.isMine ? 'mineLimit' : 'wallLimit'
        const cur = before.isMine ? this.data.mineLimit : this.data.wallLimit
        this.setData({ [key]: cur + this._pageSize() })
        this._recompute()
        return
      }
      if (!before.moreServer) {
        // 没有更多了：状态机自己会落到 nomore，这里只保证不会发出空请求
        this._recompute()
        return
      }
      this._pending = { at: before.source.length, sawLoading: false }
      this.setData({ loadState: 'loading' })
      this.triggerEvent('loadmore', { view: before.view, cursor: before.source.length, rendered: before.rendered })
    },

    /* ------------------------------ 三态 ------------------------------ */

    /** 失败重试：墙 → retry；我的心愿 → retrymine（组件不自己取数） */
    onRetry() {
      const isMine = this.data.viewMode === 'mine'
      const src = isMine ? this.properties.mineRows : this.properties.items
      this._pending = { at: Array.isArray(src) ? src.length : 0, sawLoading: false }
      this.setData({ loadState: 'loading' })
      this.triggerEvent(isMine ? 'retrymine' : 'retry', {})
    },

    /* ------------------------------ 详情 ------------------------------ */

    onOpen(e) {
      const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
      if (!id) return
      const v = deriveView(this.properties, this._viewState(), null)
      const hit = v.sorted.find((r) => String(r && r._id) === id)
      if (!hit) return
      this.setData({ detail: hit, detailCount: wishTextCount(hit.text) })
      this.triggerEvent('openwish', { id, view: v.view })
    },

    onCloseDetail() {
      const id = this.data.detail ? String(this.data.detail._id || '') : ''
      if (!id) return
      this.setData({ detail: null, detailCount: 0 })
      this.triggerEvent('closewish', { id })
    },

    /** 抄一句：正文交回页面（由页面填进输入框并聚焦）——只出事件 */
    onBorrow() {
      const d = this.data.detail
      if (!d) return
      this.triggerEvent('borrowwish', { id: String(d._id || ''), text: String(d.text || '') })
    },

    /**
     * 复制：纯本地交互（不碰网络、不碰集合），组件自己做掉。
     * ⚠️ 这里**不是**写操作 —— 写操作（收起/恢复/删除）一律只 triggerEvent。
     */
    onCopy() {
      const d = this.data.detail
      if (!d || typeof wx === 'undefined' || typeof wx.setClipboardData !== 'function') return
      try {
        wx.setClipboardData({ data: String(d.text || '') })
      } catch (err) { /* 复制失败不阻断阅读 */ }
    },

    /**
     * 我的愿签管理：**只出事件**（组件不 require 云函数、不调云、不直写集合）。
     * 页面未声明 `manageable` 时 WXML 不会渲染这些动作，这里再兜一道。
     */
    onManage(e) {
      if (this.properties.manageable !== true) return
      const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
      const id = String(ds.id || '')
      const act = String(ds.act || '')
      if (!id) return
      const map = { hide: 'hidewish', restore: 'restorewish', delete: 'deletewish' }
      if (!map[act]) return
      this.triggerEvent(map[act], { id, view: 'mine' })
    },

    /** 阻止遮罩穿透 / 详情层内点击冒泡（catchtap / catchtouchmove 的落点） */
    noop() {}
  }
})
