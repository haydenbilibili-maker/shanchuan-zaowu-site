/**
 * WallFeed（祈福内容流组件）的**纯逻辑核** —— 无 wx / 无云调用 / 无组件实例依赖。
 *
 * 为什么要把"筛选 / 排序 / 分页 / 三态 / 加载更多状态机"从 `index.js` 里拆出来：
 *   ① 这些全是**确定性纯函数**，可以在 Node 里直接跑断言（`test-wish-wall.mjs` 的 WallFeed 段）；
 *   ② 离线渲染台 `render-wall-feed-preview.mjs` 也要用**同一份**推导结果去画页面 ——
 *      若渲染台自己再写一遍筛选/分页，两份实现必然漂移（错题本 E3：读的是镜像、不是真源）；
 *   ③ 组件实例只负责"把结果 setData 出去 + 发事件"，行为与呈现之间没有隐藏状态。
 *
 * 依赖只有两处**已存在的共享件**（只读引用，不改动它们）：
 *   · `utils/wishWall.splitTagColumns` —— 两列瀑布的分列口径。**必须复用**：
 *     只有用它，默认态（筛选=全部 / 排序=最新 / 未翻页）才与改造前的 `tagColumns` 逐项一致
 *     （PRD §11.1 R2 的"默认态与现状一致"就落在这一个函数上）。
 *   · `utils/wishTextCount.wishTextCount` —— 「字数」口径的唯一事实源（emoji / ZWJ 算 1 个字）。
 *     排序按字数走它，不写 `text.length`，否则同一份数据在端上会排出两个不同顺序。
 *
 * ⚠️ 本文件**不发云调用、不 require 云函数、不读写任何集合**（PRD §11.1 R2 的不可越界）。
 *    页面传入的 `items` / `mineRows` 已经是归一化后的行模型（见 index.js 的 §契约）。
 */
'use strict'

const { splitTagColumns } = require('../../utils/wishWall')
const { wishTextCount } = require('../../utils/wishTextCount')

/** 每屏/每次「加载更多」展开的条数（页面可用 `pageSize` 属性覆盖） */
const PAGE_SIZE = 20
/** 两列瀑布（与改造前一致；改这里会让默认态与现状分列不同） */
const COLUMNS = 2

/** 视图（两栏）：墙上的愿签 / 我的心愿 */
const VIEWS = [
  { id: 'wall', label: '墙上的愿签' },
  { id: 'mine', label: '我的心愿' }
]

/**
 * 筛选维度 —— 全部**只作用在已取回的数据上**（不新增任何服务端契约）。
 *   墙上：全部 / 置顶 / 我的（`isMine` 由页面 markMine 标注）
 *   我的：全部 / 已上墙 / 已收起（`hidden` = 馆方已收起）
 * 每个维度都对用户有意义且可解释，且都不编造社会证明（PRD §5）：
 * 没有"热度/点赞/多少人许过"这类需要服务端计数才能成立的面。
 */
const WALL_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'pinned', label: '置顶' },
  { id: 'mine', label: '我的' }
]
const MINE_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'visible', label: '已上墙' },
  { id: 'hidden', label: '已收起' }
]

/**
 * 排序维度（同样只在已取回的数据上做）：
 *   new  —— **页面给的顺序原样保留**。服务端 `list` = 置顶优先 + createTime 倒序
 *           （见 cloudfunctions/manageWishWall/index.js 的 orderBy），页面直接透传，
 *           所以"最新"就是默认顺序，也就是**改造前的现状**（这条是默认态判据的核心）。
 *   old  —— 逆序（最早的在前）。
 *   long —— 按**字**数从多到少（同字数保持原顺序，稳定排序）。
 */
const SORTS = [
  { id: 'new', label: '最新' },
  { id: 'old', label: '最早' },
  { id: 'long', label: '字最多' }
]

/** 加载更多的四个状态（可加载 / 加载中 / 没有更多 / 失败可重试）—— 判据按这四个 id 断言 */
const LOAD_STATES = ['canload', 'loading', 'nomore', 'error']

/** 两个视图各自的空文案（**只在"确认成功且为空"时**才允许出现） */
const EMPTY_TEXT = {
  wall: '还没有人许愿',
  mine: '你还没在这面墙上写过心愿'
}

const arr = (v) => (Array.isArray(v) ? v : [])
const str = (v) => String(v == null ? '' : v)

/** 一行是不是「我的」（墙视图用页面回写的 isMine；我的心愿视图整列都是我的） */
function isMineRow(row) {
  return !!(row && row.isMine === true)
}
/** 一行是不是被馆方收起 */
function isHiddenRow(row) {
  return !!(row && row.hidden === true)
}

/**
 * 筛选：只读 `rows`，不排序、不改行。
 * @param {Array} rows
 * @param {string} filter
 * @param {'wall'|'mine'} view
 */
function filterRows(rows, filter, view) {
  const list = arr(rows)
  if (view === 'mine') {
    if (filter === 'visible') return list.filter((r) => !isHiddenRow(r))
    if (filter === 'hidden') return list.filter((r) => isHiddenRow(r))
    return list.slice()
  }
  if (filter === 'pinned') return list.filter((r) => !!(r && r.pinned === true))
  if (filter === 'mine') return list.filter((r) => isMineRow(r))
  return list.slice()
}

/**
 * 排序：稳定排序（同键保持传入顺序）。
 * `sortRows(rows, 'new')` 必须**逐项等于** `rows`（默认态判据）。
 */
function sortRows(rows, sort) {
  const list = arr(rows)
  if (sort === 'old') return list.slice().reverse()
  if (sort === 'long') {
    return list
      .map((r, i) => ({ r, i, n: wishTextCount(r && r.text) }))
      .sort((a, b) => (b.n - a.n) || (a.i - b.i))
      .map((x) => x.r)
  }
  return list.slice()
}

/**
 * 加载更多状态机：**四态**（canload / loading / nomore / error）。
 * @param {object} o
 * @param {string} o.error   当前视图的错误文案（非空 = 失败可重试）
 * @param {boolean} o.loading 当前视图的加载位
 * @param {number} o.rendered 已渲染条数
 * @param {number} o.total    筛选后总条数
 * @param {boolean} o.hasMore 页面声明"服务端还有更多"
 * @param {object|null} o.pending 在途标记（已收尾的调用方必须传 null）
 */
function resolveLoadState(o) {
  if (o.error) return 'error'
  if (o.pending) return 'loading'
  if (o.rendered < o.total) return 'canload'
  if (o.hasMore) return 'canload'
  if (o.loading && o.rendered > 0) return 'loading'
  return 'nomore'
}

/**
 * 由「页面属性 + 组件视图态」推导出**全部**渲染所需字段。
 *
 * @param {object} props 组件 properties（items / mineRows / loading / loadError / ... / hasMore）
 * @param {object} state 组件视图态（viewMode / wallFilter / mineFilter / sort / wallLimit / mineLimit）
 * @param {object|null} pending 加载更多在途标记
 * @returns {object} 推导结果（见下方字段说明）
 */
function deriveView(props, state, pending) {
  const p = props || {}
  const s = state || {}
  const view = s.viewMode === 'mine' ? 'mine' : 'wall'
  const isMine = view === 'mine'

  const source = arr(isMine ? p.mineRows : p.items)
  const filter = isMine ? (s.mineFilter || 'all') : (s.wallFilter || 'all')
  const sort = s.sort || 'new'
  const limit = Math.max(0, Number(isMine ? s.mineLimit : s.wallLimit) || PAGE_SIZE)

  const filtered = filterRows(source, filter, view)
  const sorted = sortRows(filtered, sort)
  const total = sorted.length
  const rows = sorted.slice(0, limit)
  const rendered = rows.length
  const columns = splitTagColumns(rows, COLUMNS)

  const error = str(isMine ? p.mineError : p.loadError)
  const loading = !!(isMine ? p.mineLoading : p.loading)
  const hasMore = p.hasMore === true
  const pageSize = Math.max(1, Number(p.pageSize) || PAGE_SIZE)
  const moreLocal = rendered < total
  const moreServer = hasMore

  // ── 三态：错误 > 加载 > 空 ──
  // 「空」只在**确认成功且为空**时成立：error 与 loading 任一立着都不许说"你还没写过"
  //（本仓 E14/E16 那一类假事实）。骨架与错误块只在**当前视图一行都没有**时占整块；
  // 已有内容时错误退化为列表下方的一行"没加载上 + 重试"，不把看过的内容抹掉。
  const showSkeleton = loading && rendered === 0 && !error
  const showError = !!error && rendered === 0
  const showEmpty = !error && !loading && rendered === 0

  // 在途标记的**收尾**：页面把数据追加上了（长度变大），或走完了一轮 loading（true→false）。
  // 两条都要有 —— 只认"长度变大"时，页面用"整表刷新成同长度"来收尾会永远停在"加载中"。
  const pendingResolved = !!pending && !error && ((pending.sawLoading && !loading) || source.length > pending.at)
  const loadState = resolveLoadState({
    error, loading, rendered, total, hasMore, pending: pendingResolved ? null : pending
  })

  const remaining = Math.max(0, total - rendered)
  const loadLabel = moreServer
    ? '加载更多'
    : `再看 ${Math.min(pageSize, remaining)} 条`

  return {
    view,
    isMine,
    filter,
    sort,
    filters: isMine ? MINE_FILTERS : WALL_FILTERS,
    source,
    filtered,
    sorted,
    rows,
    columns,
    total,
    rendered,
    remaining,
    pageSize,
    moreLocal,
    moreServer,
    error,
    loading,
    showSkeleton,
    showError,
    showEmpty,
    emptyText: EMPTY_TEXT[view],
    errorText: error,
    loadState,
    loadLabel,
    pendingResolved,
    // 「我的」管理动作是否出现：页面声明 manageable 才出现（当前 C 端**没有**写 action，
    // 页面未接线时保持 false —— 不给一个点了没反应的删除入口，也不假造能力）
    manageable: p.manageable === true
  }
}

module.exports = {
  PAGE_SIZE,
  COLUMNS,
  VIEWS,
  WALL_FILTERS,
  MINE_FILTERS,
  SORTS,
  LOAD_STATES,
  EMPTY_TEXT,
  filterRows,
  sortRows,
  deriveView
}
