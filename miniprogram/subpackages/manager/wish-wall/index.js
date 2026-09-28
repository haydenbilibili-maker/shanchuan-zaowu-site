/**
 * 需求 28：马上有 · 祈福墙管理（超管工作台 → 内容开关 / 内容管理）
 *
 * 业务口径：弹幕**不接 UGC 审核**，治理由本页承载 —— 全部弹幕可见（含已隐藏），
 * 可隐藏 / 恢复 / 置顶 / 删除。这是「无审核」决定的**唯一兜底**，所以本页必须能看到
 * 未公开的内容，否则被隐藏的弹幕将无人可见、无从复核。
 *
 * ⚠️ 多面墙（2026-09-17）：祈福墙由 `productKey` 作用域隔离，可以有多面。
 * 本页**不能只治默认那一面** —— 否则第二面墙的弹幕无人可治，
 * 「不接审核」这个决定就只对第一面墙成立。故本页顶部有**墙选择器**（见 loadWalls）。
 */
const { guardStaffPage } = require('../utils/staffAuth')
const { formatCloudFnError } = require('../utils/memberScan')
const { normalizeProductKey, PRODUCT_KEY: DEFAULT_PRODUCT_KEY } = require('../../../utils/wishWall')

const FN = 'manageWishWall'
/** 上次看过哪面墙：运营通常连着复查同一面，来回跳会很烦 */
const SCOPE_CACHE_KEY = 'wish_wall_admin_scope_v1'

const STATUS_TABS = [
  { id: '', label: '全部' },
  { id: 'visible', label: '展示中' },
  { id: 'hidden', label: '已隐藏' }
]

function decorate(row) {
  const item = row || {}
  const t = item.createTime ? new Date(item.createTime) : null
  return {
    ...item,
    statusLabel: item.status === 'hidden' ? '已隐藏' : '展示中',
    timeText: t && !Number.isNaN(t.getTime())
      ? `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
      : ''
  }
}

/** 上次复查的作用域（读失败一律回落默认墙：缓存不是配置，坏了不该挡住页面） */
function readCachedScope() {
  try {
    return normalizeProductKey(wx.getStorageSync(SCOPE_CACHE_KEY) || '')
  } catch (e) {
    return DEFAULT_PRODUCT_KEY
  }
}

function writeCachedScope(key) {
  try {
    wx.setStorageSync(SCOPE_CACHE_KEY, normalizeProductKey(key))
  } catch (e) {
    // 记不住也没关系，最多下次回到默认墙
  }
}

Page({
  data: {
    ready: false,
    loading: false,
    listError: false,
    tipTone: 'info',
    tipText: '',
    removePendingId: '',
    busyId: '',
    statusTabs: STATUS_TABS,
    activeStatus: '',
    keyword: '',
    list: [],
    counts: { visible: 0, hidden: 0 },
    // 需求 28：多面墙 —— 当前作用域与可选墙列表
    productKey: DEFAULT_PRODUCT_KEY,
    walls: [],
    // 需求 28：AI 基础内容
    seeding: false,
    seedResult: null,
    /**
     * 句式前缀（留空 = 「马上有」）。
     * 多面墙之后这不是可有可无的选项：给第二面墙生成「马上有XX」是**别的墙的话**。
     */
    seedPrefix: ''
  },

  async onLoad(options) {
    const role = await guardStaffPage('super_admin')
    if (!role) return
    const opts = options || {}
    this.setData({
      ready: true,
      // 优先级：路由参数 > 上次看过的那面墙 > 默认墙
      productKey: normalizeProductKey(opts.productKey || readCachedScope())
    })
    await this.loadWalls()
    this.refresh()
  },

  /**
   * 拉全部墙并渲染选择器。
   * 读失败不阻断治理主流程：退回"只有当前这面墙"，至少默认墙还能治。
   */
  async loadWalls() {
    try {
      const result = await this.callFn({ action: 'staffWalls' })
      const walls = Array.isArray(result.walls) ? result.walls : []
      const current = this.data.productKey
      // 当前墙不在列表里（刚建、或全是隐藏内容）也要留在选择器里，否则运营会以为自己看错了墙
      const merged = walls.some((w) => w.productKey === current)
        ? walls
        : walls.concat([{ productKey: current, label: current, count: 0, isDefault: false }])
      this.setData({ walls: merged })
    } catch (e) {
      console.warn('wish wall staffWalls', e)
      this.setData({
        walls: [{ productKey: this.data.productKey, label: this.data.productKey, count: 0, isDefault: true }]
      })
    }
  },

  /** 切墙：换作用域 → 落本地 → 重拉列表与计数 */
  switchWall(e) {
    const next = normalizeProductKey((e.currentTarget.dataset && e.currentTarget.dataset.key) || '')
    if (!next || next === this.data.productKey) return
    writeCachedScope(next)
    // 换墙时清掉关键词与句式前缀：上一个墙的搜索词/句式在新墙上都不适用
    this.setData({ productKey: next, keyword: '', list: [], seedResult: null, seedPrefix: '' })
    this.refresh()
  },

  onPullDownRefresh() {
    this.loadWalls().finally(() => this.refresh().finally(() => wx.stopPullDownRefresh()))
  },

  async callFn(data) {
    const res = await wx.cloud.callFunction({ name: FN, data: data || {} })
    const result = (res && res.result) || {}
    if (!result.success) {
      const err = new Error(result.msg || '操作失败')
      err.code = result.code
      throw err
    }
    return result
  },

  async refresh() {
    if (this.data.loading) return
    this.setData({ loading: true, listError: false, tipText: '', removePendingId: '' })
    try {
      const payload = { action: 'staffList', productKey: this.data.productKey, status: this.data.activeStatus }
      const keyword = String(this.data.keyword || '').trim()
      if (keyword) payload.keyword = keyword
      const [listRes, statsRes] = await Promise.all([
        this.callFn(payload),
        this.callFn({ action: 'staffStats', productKey: this.data.productKey }).catch(() => ({ counts: {} }))
      ])
      this.setData({
        listError: false,
        list: (listRes.list || []).map(decorate),
        counts: (statsRes && statsRes.counts) || { visible: 0, hidden: 0 }
      })
    } catch (e) {
      // 失败保留上次列表，勿伪装空墙
      console.warn('wish wall staffList', e)
      this.setData({
        listError: true,
        tipTone: 'warn',
        tipText: formatCloudFnError(e, '弹幕列表未能取回')
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  onRetryList() {
    this.refresh()
  },

  switchStatus(e) {
    const status = String((e.currentTarget.dataset && e.currentTarget.dataset.status) || '')
    if (status === this.data.activeStatus) return
    this.setData({ activeStatus: status })
    this.refresh()
  },

  onKeywordInput(e) {
    this.setData({ keyword: String((e.detail && e.detail.value) || '') })
  },

  onKeywordConfirm() {
    this.refresh()
  },

  async toggleStatus(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    const next = String((e.currentTarget.dataset && e.currentTarget.dataset.next) || '')
    if (!id || !next || this.data.busyId) return
    this.setData({ busyId: id })
    try {
      const result = await this.callFn({ action: 'staffSetStatus', id, status: next })
      this.setData({ tipTone: 'info', tipText: result.msg || '已更新' })
      await this.refresh()
    } catch (err) {
      this.setData({ tipTone: 'warn', tipText: formatCloudFnError(err, '更新失败') })
    } finally {
      this.setData({ busyId: '' })
    }
  },

  async togglePinned(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    const pinned = e.currentTarget.dataset.pinned === true || e.currentTarget.dataset.pinned === 'true'
    if (!id || this.data.busyId) return
    this.setData({ busyId: id })
    try {
      const result = await this.callFn({ action: 'staffSetStatus', id, status: 'visible', pinned: !pinned })
      this.setData({ tipTone: 'info', tipText: !pinned ? '已置顶' : '已取消置顶' })
      await this.refresh()
    } catch (err) {
      this.setData({ tipTone: 'warn', tipText: formatCloudFnError(err, '操作失败') })
    } finally {
      this.setData({ busyId: '' })
    }
  },

  removeWish(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    if (!id || this.data.busyId) return
    if (this.data.removePendingId !== id) {
      this.setData({
        removePendingId: id,
        tipTone: 'warn',
        tipText: '再点一次「删除」：删除后不可恢复；若不希望公开可先隐藏'
      })
      return
    }
    this.setData({ removePendingId: '' })
    this.doRemove(id)
  },

  async doRemove(id) {
    this.setData({ busyId: id })
    try {
      const result = await this.callFn({ action: 'staffRemove', id })
      this.setData({ tipTone: 'info', tipText: result.msg || '已删除' })
      await this.refresh()
    } catch (err) {
      this.setData({ tipTone: 'warn', tipText: formatCloudFnError(err, '删除失败') })
    } finally {
      this.setData({ busyId: '' })
    }
  },

  /* ------------------- 需求 28：第一批基础内容（AI 创作） ------------------- */

  /**
   * 当前要生成的句式前缀（留空 = 「马上有」）。
   * 与云端 `normalizePrefix` 同口径：去空白、最长 6 字。
   */
  effectiveSeedPrefix() {
    return String(this.data.seedPrefix || '').replace(/\s+/g, '').slice(0, 6) || '马上有'
  },

  /** 句式前缀：边输边净化（去空白 + 截断），避免把空格带进句式 */
  onSeedPrefixInput(e) {
    const raw = String((e.detail && e.detail.value) || '')
    this.setData({ seedPrefix: raw.replace(/\s+/g, '').slice(0, 6) })
  },

  /**
   * 先确认再生成：一次性往公开墙面写入多条内容，属于**不可逆的对外动作**
   * （用户已经能看到），所以不能点一下就执行。
   *
   * ⚠️ `confirmText` / `cancelText` 微信限制**最多 4 个字符**。超了 `showModal` 会直接失败，
   * 且不传 `fail` 回调时**既没有弹窗也没有任何报错**（实测反馈「点 AI 生成没反应」就是这条：
   * 原本文案是 5 个字「生成并上墙」）。因此这里两件事都要做：
   *   ① 文案压到 4 字以内；② 补 `fail`，让任何弹窗失败都可见 —— 静默失败比功能缺失更难查。
   * 守卫 `test-wish-wall` 有对应断言 + 注入。
   */
  seedAi() {
    if (this.data.seeding) return
    const prefix = this.effectiveSeedPrefix()
    wx.showModal({
      title: 'AI 生成基础内容',
      content: `将用 AI 创作最多 12 条「${prefix}XX」心愿并直接上墙，C 端用户即刻可见。生成后可在本页隐藏或删除。`,
      confirmText: '生成',
      success: (res) => {
        if (res.confirm) this.doSeedAi()
      },
      fail: (err) => {
        console.warn('wish wall seedAi showModal fail', err)
        this.setData({ tipTone: 'warn', tipText: '弹窗打开失败，请重试' })
      }
    })
  },

  async doSeedAi() {
    this.setData({ seeding: true })
    try {
      const result = await this.callFn({
        action: 'staffSeedAi',
        productKey: this.data.productKey,
        // 多面墙：把句式前缀带上去，否则第二面墙会长满「马上有XX」
        prefix: this.effectiveSeedPrefix(),
        count: 8
      })
      this.setData({ seedResult: result })
      this.setData({ tipTone: 'info', tipText: result.msg || '已上墙' })
      await this.refresh()
    } catch (err) {
      this.setData({ tipTone: 'warn', tipText: formatCloudFnError(err, '生成失败') })
    } finally {
      this.setData({ seeding: false })
    }
  },

  copyText(e) {
    const text = String((e.currentTarget.dataset && e.currentTarget.dataset.text) || '')
    if (!text) return
    wx.setClipboardData({ data: text, success: () => this.setData({ tipTone: 'info', tipText: '已复制' }) })
  }
})
