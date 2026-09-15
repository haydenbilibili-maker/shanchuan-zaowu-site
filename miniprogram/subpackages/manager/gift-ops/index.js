/**
 * 店长 · 礼赠履约看板
 * 待填址 / 待发货 / 自提待核销 / 已完成
 */
const { guardStaffPage, goStaffConsole } = require('../utils/staffAuth')
const { formatCloudFnError } = require('../utils/memberScan')

const BUCKETS = [
  { key: 'awaiting_address', label: '待填址' },
  { key: 'awaiting_ship', label: '待发货' },
  { key: 'pickup_verify', label: '自提核销' },
  { key: 'done', label: '已完成' }
]

const EMPTY_COPY = {
  awaiting_address: {
    title: '暂无待填址',
    hint: '邀请对方填地址的礼赠，支付后会出现在这里'
  },
  awaiting_ship: {
    title: '暂无待发货',
    hint: '地址齐全后会进入本栏，可去发货'
  },
  pickup_verify: {
    title: '暂无待核销',
    hint: '门店自提单备妥后会出现在这里'
  },
  done: {
    title: '暂无已完成单',
    hint: '签收、妥投或退款完成后会出现在这里'
  }
}

const DELIVERY_TONE = {
  invite_address: 'tone-invite',
  ship_to_receiver: 'tone-ship',
  ship_to_self: 'tone-self',
  store_pickup: 'tone-pickup'
}

const DELIVERY_SOFT = {
  invite_address: '待填址',
  ship_to_receiver: '快递给 TA',
  ship_to_self: '寄给我',
  store_pickup: '门店自提'
}

function softNote(note) {
  const t = String(note || '')
  if (!t) return ''
  if (/200/.test(t)) return '列表基于最近约 200 笔礼赠单'
  return t
}

function enrichItem(raw) {
  const item = Object.assign({}, raw || {})
  const deliveryType = item.deliveryType || 'invite_address'
  item.deliveryLabel = DELIVERY_SOFT[deliveryType] || item.deliveryLabel || deliveryType
  item.deliveryTone = DELIVERY_TONE[deliveryType] || ''

  let urgencyLabel = ''
  let urgencyClass = ''
  if (item.expireAt) {
    const end = new Date(item.expireAt).getTime()
    if (!Number.isNaN(end)) {
      const days = Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000))
      if (days < 0) {
        urgencyLabel = '已过期'
        urgencyClass = 'urgent'
      } else if (days === 0) {
        urgencyLabel = '今日截止'
        urgencyClass = 'urgent'
      } else if (days <= 2) {
        urgencyLabel = `剩 ${days} 日`
        urgencyClass = 'soon'
      } else if (days <= 5) {
        urgencyLabel = `剩 ${days} 日`
      }
    }
  }
  item.urgencyLabel = urgencyLabel
  item.urgencyClass = urgencyClass
  return item
}

function matchKeyword(item, kw) {
  if (!kw) return true
  const hay = [
    item.orderNo,
    item.orderId,
    item.productTitle,
    item.recipientName,
    item.storeName,
    item.claimCode,
    item.address && item.address.name,
    item.address && item.address.phone,
    item.address && item.address.line
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return hay.indexOf(kw) !== -1
}

Page({
  data: {
    ready: false,
    loading: false,
    loadError: '',
    buckets: BUCKETS,
    bucket: 'awaiting_address',
    counts: {
      awaiting_address: 0,
      awaiting_ship: 0,
      pickup_verify: 0,
      done: 0
    },
    list: [],
    displayList: [],
    keyword: '',
    page: 1,
    hasMore: false,
    total: 0,
    note: '',
    expandedId: '',
    emptyTitle: EMPTY_COPY.awaiting_address.title,
    emptyHint: EMPTY_COPY.awaiting_address.hint
  },

  onLoad(options) {
    const bucket = String((options && options.bucket) || '').trim()
    if (bucket && BUCKETS.some((b) => b.key === bucket)) {
      this.setData({ bucket })
      this.applyEmptyCopy(bucket)
    }
    this.bootstrap()
  },

  onShow() {
    if (this.data.ready) this.loadList(true)
  },

  onPullDownRefresh() {
    this.loadList(true).finally(() => wx.stopPullDownRefresh())
  },

  applyEmptyCopy(bucket) {
    const copy = EMPTY_COPY[bucket] || EMPTY_COPY.awaiting_address
    this.setData({
      emptyTitle: copy.title,
      emptyHint: copy.hint
    })
  },

  applyFilter() {
    const kw = String(this.data.keyword || '')
      .trim()
      .toLowerCase()
    const displayList = (this.data.list || []).filter((item) => matchKeyword(item, kw))
    this.setData({ displayList })
  },

  async bootstrap() {
    const role = await guardStaffPage('manager')
    if (!role) return
    const canGift =
      !!(role.isSuperAdmin || role.superAdmin) ||
      (role.permissions || []).indexOf('giftOps') !== -1 ||
      (role.permissions || []).indexOf('manageGift') !== -1
    if (!canGift) {
      this.setData({
        ready: false,
        loadError: '当前账号无礼赠履约权限，请联系超管开通'
      })
      wx.showToast({ title: '无礼赠履约权限', icon: 'none' })
      setTimeout(() => {
        wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
      }, 1200)
      return
    }
    this.setData({ ready: true })
    this.loadList(true)
  },

  retryLoad() {
    this.loadList(true)
  },

  switchBucket(e) {
    const key = String((e.currentTarget.dataset && e.currentTarget.dataset.key) || '').trim()
    if (!key || key === this.data.bucket) return
    this.setData({ bucket: key, expandedId: '' })
    this.applyEmptyCopy(key)
    this.loadList(true)
  },

  onKeywordInput(e) {
    this.setData({ keyword: (e.detail && e.detail.value) || '' }, () => this.applyFilter())
  },

  onKeywordConfirm() {
    this.applyFilter()
  },

  clearKeyword() {
    this.setData({ keyword: '' }, () => this.applyFilter())
  },

  async loadList(reset) {
    if (this.data.loading) return
    const page = reset ? 1 : this.data.page + 1
    this.setData({
      loading: true,
      loadError: reset ? '' : this.data.loadError
    })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageGift',
        data: {
          action: 'listBoard',
          bucket: this.data.bucket,
          page,
          pageSize: 20
        }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        throw new Error(result.msg || '加载失败')
      }
      const mapped = (result.list || []).map(enrichItem)
      const nextList = reset ? mapped : (this.data.list || []).concat(mapped)
      this.setData(
        {
          loading: false,
          list: nextList,
          page: result.page || page,
          hasMore: !!result.hasMore,
          total: result.total || 0,
          counts: result.counts || this.data.counts,
          note: softNote(result.note),
          loadError: ''
        },
        () => this.applyFilter()
      )
    } catch (e) {
      console.warn('gift board', e)
      this.setData({
        loading: false,
        loadError: formatCloudFnError(e, '礼赠看板暂不可用'),
        list: reset ? [] : this.data.list,
        displayList: reset ? [] : this.data.displayList
      })
    }
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.loadList(false)
  },

  toggleExpand(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim()
    this.setData({ expandedId: this.data.expandedId === id ? '' : id })
  },

  goOrderManage() {
    wx.navigateTo({
      url: '/subpackages/manager/manager/workspace/index?tab=2&title=' + encodeURIComponent('订单管理'),
      fail: () => wx.showToast({ title: '请从订单管理发货', icon: 'none' })
    })
  },

  goVerify() {
    goStaffConsole('verify')
  },

  copyOrderNo(e) {
    const no = String((e.currentTarget.dataset && e.currentTarget.dataset.no) || '').trim()
    if (!no) {
      wx.showToast({ title: '暂无单号', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: no,
      success: () => wx.showToast({ title: '已复制单号', icon: 'none' })
    })
  }
})
