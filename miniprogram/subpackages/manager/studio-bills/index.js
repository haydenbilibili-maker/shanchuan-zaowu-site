/**
 * 工作室账单 — 门店 → 工作室货款（manageStudioSettlement 的 bill.*）
 *
 * 两种角色共用一个页面，但**能做的不一样**：
 *   · 超管（收款方）：建账单（在出货单里勾单）、撤回已付、**确认收款**、作废
 *   · 店长（付款方）：**标记已付款**（只能标本门店）
 * 服务端对每一步都独立判定（`bill.markPaid` 按门店范围二次判定且**失败即拒**），
 * 本页只负责不把按不动的按钮画出来 —— **客户端门禁不是执法**，越权请求到服务端照样被拒。
 *
 * 结算口径：账单是**唯一权威**，出货单的结算状态由它派生（见 check:settlement-single-ledger）。
 */
const { guardStaffPage, roleHasStored } = require('../utils/staffAuth')
const { formatCloudFnError } = require('../utils/memberScan')

const FN = 'manageStudioSettlement'

const STATUS_TONE = {
  unsettled: 'warn',
  paid_pending: 'brass',
  settled: 'ok',
  void: 'muted'
}

function money(cents) {
  const n = Number(cents)
  if (!Number.isFinite(n)) return '0'
  return (Math.round(n) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function mapBillRow(b) {
  const r = b || {}
  return Object.assign({}, r, {
    totalText: '¥' + money(r.totalCents),
    materialText: '¥' + money(r.materialCostCents),
    packagingText: '¥' + money(r.packagingCostCents),
    laborText: '¥' + money(r.laborCostCents),
    tone: STATUS_TONE[r.status] || 'muted',
    periodText: r.periodFrom && r.periodTo ? r.periodFrom + ' ~ ' + r.periodTo : (r.periodFrom || '—'),
    createdText: r.createdAt ? new Date(Number(r.createdAt)).toLocaleString('zh-CN', { hour12: false }) : ''
  })
}

Page({
  data: {
    ready: false,
    busy: false,
    isSuper: false,
    /**
     * 结算口径提示常显：门店与工作室看的是同一个数，
     * 但「出货额 / 已结清 / 未收款」三个词很容易混，页面直接写清。
     */
    noteText: '账单是结算的唯一依据；出货单上的结算状态由账单派生',
    filter: 'all',
    filters: [
      { value: 'all', label: '全部' },
      { value: 'unsettled', label: '未结' },
      { value: 'paid_pending', label: '待确认收款' },
      { value: 'settled', label: '已结清' }
    ],
    list: [],
    outstandingText: '¥0.00',
    detail: null,
    detailFields: [],
    showDetail: false,
    tipText: '',
    tipTone: 'info'
  },

  onLoad() {
    guardStaffPage('manager').then((role) => {
      if (!role) return
      this.setData({ ready: true, isSuper: roleHasStored(role, 'super_admin') }, () => this.loadList())
    })
  },

  onPullDownRefresh() {
    Promise.resolve(this.loadList()).then(() => wx.stopPullDownRefresh())
  },

  callFn(data) {
    return wx.cloud.callFunction({ name: FN, data }).then((res) => {
      const r = (res && res.result) || {}
      if (r.success === false) throw new Error(r.msg || '请求失败')
      return r
    })
  },

  onFilter(e) {
    const value = String(e.currentTarget.dataset.value || 'all')
    this.setData({ filter: value }, () => this.loadList())
  },

  loadList() {
    const status = this.data.filter === 'all' ? '' : this.data.filter
    this.setData({ busy: true, tipText: '' })
    return this.callFn({ action: 'bill.list', status, limit: 60 })
      .then((r) => {
        this.setData({
          busy: false,
          list: (r.list || []).map(mapBillRow),
          outstandingText: '¥' + money(Math.round((Number(r.outstandingAmount) || 0) * 100))
        })
      })
      .catch((e) => {
        this.setData({ busy: false, list: [], tipTone: 'warn', tipText: formatCloudFnError(e, '账单加载失败') })
      })
  },

  openBill(e) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    this.setData({ busy: true, tipText: '' })
    this.callFn({ action: 'bill.get', id })
      .then((r) => {
        const bill = mapBillRow(r.bill)
        const shipments = (r.shipments || []).map((s) => ({
          _id: s._id,
          shipmentNo: s.shipmentNo,
          shipmentDate: s.shipmentDate,
          qtyText: (Number(s.totalQty) || 0) + ' 件',
          amountText: '¥' + money(Math.round((Number(s.totalAmount) || 0) * 100)),
          settleStatus: s.settleStatus || 'unsettled'
        }))
        this.setData({
          busy: false,
          showDetail: true,
          detail: bill,
          detailFields: shipments,
          tipTone: 'info',
          tipText: ''
        })
      })
      .catch((e) => this.setData({ busy: false, tipTone: 'warn', tipText: formatCloudFnError(e, '账单详情加载失败') }))
  },

  closeDetail() {
    this.setData({ showDetail: false, detail: null, detailFields: [] })
  },

  /** 动作统一走这里：成功就刷新并给一句人话，失败把服务端原因原样带出来 */
  runAction(action, extra, confirmLabel) {
    const bill = this.data.detail
    if (!bill || !bill._id) return
    const go = () => {
      this.setData({ busy: true, tipText: '' })
      this.callFn(Object.assign({ action, id: bill._id }, extra || {}))
        .then((r) => {
          // 幂等短路（noop）也要如实说，别装作刚做了一次
          const msg = r.noop ? '该操作此前已完成（未重复写入）' : r.msg || '已完成'
          this.setData({ busy: false, tipTone: 'info', tipText: msg, showDetail: false, detail: null })
          return this.loadList()
        })
        .catch((e) => this.setData({ busy: false, tipTone: 'warn', tipText: formatCloudFnError(e, '操作失败') }))
    }
    if (!confirmLabel) {
      go()
      return
    }
    /**
     * 二次确认**不用 `wx.showModal`**：`check:dialog-ratchet` 冻结了原生弹窗数量（只许降）。
     * 改成一步「先点按钮 → 按钮变成确认态 → 再点才执行」，两个 `setData` 就够了。
     */
    if (this._pendingConfirm === action) {
      this._pendingConfirm = ''
      go()
      return
    }
    this._pendingConfirm = action
    this.setData({ tipTone: 'warn', tipText: confirmLabel })
  },

  onMarkPaid() {
    this.runAction('bill.markPaid', {}, '再点一次「标记已付款」即确认（用于告知工作室核对到账）')
  },

  onWithdrawPaid() {
    this.runAction('bill.withdrawPaid', {}, '再点一次即撤回「已付款」（回到未结）')
  },

  onConfirmSettle() {
    this.runAction(
      'bill.confirmSettle',
      {},
      '再点一次即确认收款：账单结清，且其下每张出货单会被标为「已完成」（不可撤销）'
    )
  },

  onVoid() {
    this.runAction('bill.void', {}, '再点一次即作废账单：其下出货单会回到未结（可重新入账）')
  }
})
