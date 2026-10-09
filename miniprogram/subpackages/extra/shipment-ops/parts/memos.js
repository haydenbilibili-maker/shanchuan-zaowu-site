/**
 * 出货中心 · 单据 → 草稿箱 / 历史（仅超管）。数据在独立旁路集合（见 manageStoreShipment/shipmentMemos.js），不进任何统计。
 * 草稿：选门店 / 每行选 SKU / 改数量 / 删行 → 「转为正式出货单」（服务端调用正式开单 createFromSkus）。
 * 历史：9.21 前已结清的飞书出货单备忘，只读。口径：miniprogram/docs/出货中心首批SKU导入_2026-10-09.md §8–§9
 */
const { formatCloudFnError } = require('../../utils/memberScan')
const { SHIPMENT_FN, callCloud, money } = require('./shared')

const KIND_TITLE = { draft: '草稿箱', history: '历史备忘 · 已结清' }

function amountText(v) {
  return v === null || v === undefined ? '—' : '¥' + money(v)
}

function decorateMemo(m) {
  const lines = (m.lines || []).map((l) => {
    const diff = Number(l.diff)
    return Object.assign({}, l, {
      pending: !l.removed && l.match !== 'sku',
      feishuText: amountText(l.feishuAmount),
      refText: amountText(l.refAmount),
      diffText: l.diff === null || l.diff === undefined || Math.abs(diff) < 0.005 ? '' : (diff > 0 ? '+' : '−') + money(Math.abs(diff)),
      unitText: l.feishuUnitPrice === null || l.feishuUnitPrice === undefined ? '' : '@' + money(l.feishuUnitPrice)
    })
  })
  const diffTotal = m.refMissing || m.feishuMissing ? null : Math.round(((m.refTotal || 0) - (m.feishuTotal || 0)) * 100) / 100
  return Object.assign({}, m, {
    lines,
    title: m.storeMatched ? m.storeName : (m.customerName || '门店待匹配'),
    feishuTotalText: amountText(m.feishuTotal) + (m.feishuMissing ? `（${m.feishuMissing} 行无价）` : ''),
    refTotalText: amountText(m.refTotal) + (m.refMissing ? `（${m.refMissing} 行未算出）` : ''),
    diffTotalText: diffTotal === null || Math.abs(diffTotal) < 0.005 ? '' : (diffTotal > 0 ? '参考多 ¥' : '参考少 ¥') + money(Math.abs(diffTotal))
  })
}

const data = {
  memoCounts: { draft: 0, history: 0 },
  memoBox: { show: false, kind: 'draft', title: '', loading: false, error: '', list: [] },
  memoDetail: { show: false, item: null, busy: false, tip: '', confirmPending: false, removePending: false },
  memoPickKey: ''
}

const methods = {
  loadMemoCounts() {
    if (!this.data.isSuper) return Promise.resolve()
    const one = (kind) => callCloud(SHIPMENT_FN, { action: 'memo.list', kind }).then((r) => Number(r.total) || 0).catch(() => this.data.memoCounts[kind] || 0)
    return Promise.all([one('draft'), one('history')]).then(([draft, history]) => this.setData({ memoCounts: { draft, history } }))
  },

  openMemoBox(e) {
    const kind = (e.currentTarget.dataset || {}).kind === 'history' ? 'history' : 'draft'
    this.setData({ memoBox: { show: true, kind, title: KIND_TITLE[kind], loading: true, error: '', list: [] } })
    this.loadMemoBox()
  },

  loadMemoBox() {
    const kind = this.data.memoBox.kind
    this.setData({ 'memoBox.loading': true, 'memoBox.error': '' })
    return callCloud(SHIPMENT_FN, { action: 'memo.list', kind })
      .then((r) => {
        const list = (r.list || []).map(decorateMemo)
        this.setData({ 'memoBox.loading': false, 'memoBox.list': list, [`memoCounts.${kind}`]: list.length })
      })
      .catch((err) => this.setData({ 'memoBox.loading': false, 'memoBox.error': formatCloudFnError(err, '加载失败') }))
  },

  closeMemoBox() {
    this.setData({ 'memoBox.show': false })
  },

  openMemo(e) {
    const id = String((e.currentTarget.dataset || {}).id || '')
    const item = (this.data.memoBox.list || []).find((m) => m._id === id)
    if (!item) return
    this.setData({ memoDetail: { show: true, item, busy: false, tip: '', confirmPending: false, removePending: false } })
  },

  closeMemoDetail() {
    this.setData({ 'memoDetail.show': false })
  },

  saveMemoPatch(patch) {
    const item = this.data.memoDetail.item
    if (!item || item.kind !== 'draft' || this.data.memoDetail.busy) return Promise.resolve()
    this.setData({ 'memoDetail.busy': true, 'memoDetail.tip': '', 'memoDetail.confirmPending': false, 'memoDetail.removePending': false })
    return callCloud(SHIPMENT_FN, { action: 'memo.updateDraft', id: item._id, patch })
      .then((r) => {
        const next = decorateMemo(r.item)
        const list = (this.data.memoBox.list || []).map((m) => (m._id === next._id ? next : m))
        this.setData({ 'memoDetail.busy': false, 'memoDetail.item': next, 'memoBox.list': list })
      })
      .catch((err) => this.setData({ 'memoDetail.busy': false, 'memoDetail.tip': formatCloudFnError(err, '保存失败') }))
  },

  onMemoStore(e) {
    const store = (this.data.stores || [])[Number(e.detail.value)]
    if (store) this.saveMemoPatch({ storeId: store.id })
  },

  onMemoQtyStep(e) {
    const ds = e.currentTarget.dataset || {}
    const line = (this.data.memoDetail.item.lines || []).find((l) => l.key === ds.key)
    if (!line) return
    const qty = (Number(line.qty) || 0) + Number(ds.delta || 0)
    if (qty < 1) return
    this.saveMemoPatch({ lines: [{ key: line.key, qty }] })
  },

  onMemoToggleLine(e) {
    const key = String((e.currentTarget.dataset || {}).key || '')
    const line = (this.data.memoDetail.item.lines || []).find((l) => l.key === key)
    if (line) this.saveMemoPatch({ lines: [{ key, removed: !line.removed }] })
  },

  onMemoClearSku(e) {
    const key = String((e.currentTarget.dataset || {}).key || '')
    if (key) this.saveMemoPatch({ lines: [{ key, skuId: '' }] })
  },

  /** 复用「选择出货 SKU」弹层；skuPicker.target='memo' 时 onPickSku 回到这里 */
  onMemoPickSku(e) {
    const key = String((e.currentTarget.dataset || {}).key || '')
    const line = (this.data.memoDetail.item.lines || []).find((l) => l.key === key)
    if (!line) return
    const keyword = line.hintKeyword || ''
    this.setData(
      { memoPickKey: key, 'skuPicker.show': true, 'skuPicker.target': 'memo', 'skuPicker.keyword': keyword, 'skuPicker.list': [], 'skuPicker.reviewOnly': false },
      () => this.searchSkuCatalog(keyword)
    )
  },

  onMemoSkuPicked(skuId) {
    const key = this.data.memoPickKey
    this.setData({ 'skuPicker.show': false, 'skuPicker.target': '', memoPickKey: '' })
    if (key && skuId) this.saveMemoPatch({ lines: [{ key, skuId }] })
  },

  confirmMemo() {
    const d = this.data.memoDetail
    if (!d.item || d.busy) return
    if (!d.confirmPending) {
      this.setData({ 'memoDetail.confirmPending': true, 'memoDetail.removePending': false, 'memoDetail.tip': '再点一次确认：将按当前价目表开出正式出货单，并照常通知门店付款' })
      return
    }
    this.setData({ 'memoDetail.busy': true, 'memoDetail.tip': '' })
    callCloud(SHIPMENT_FN, { action: 'memo.confirmDraft', id: d.item._id })
      .then((r) => {
        wx.showToast({ title: '已转为正式出货单', icon: 'success' })
        this.setData({ 'memoDetail.show': false, 'memoDetail.busy': false, listTip: r.msg || '草稿已转为正式出货单', listTipTone: 'ok' })
        this.loadMemoBox()
        this.loadList()
      })
      .catch((err) => this.setData({ 'memoDetail.busy': false, 'memoDetail.confirmPending': false, 'memoDetail.tip': formatCloudFnError(err, '转正式失败') }))
  },

  removeMemo() {
    const d = this.data.memoDetail
    if (!d.item || d.busy) return
    if (!d.removePending) {
      this.setData({ 'memoDetail.removePending': true, 'memoDetail.confirmPending': false, 'memoDetail.tip': '再点一次删除这张草稿（不影响任何正式单）' })
      return
    }
    this.setData({ 'memoDetail.busy': true, 'memoDetail.tip': '' })
    callCloud(SHIPMENT_FN, { action: 'memo.removeDraft', id: d.item._id })
      .then(() => {
        this.setData({ 'memoDetail.show': false, 'memoDetail.busy': false })
        this.loadMemoBox()
      })
      .catch((err) => this.setData({ 'memoDetail.busy': false, 'memoDetail.removePending': false, 'memoDetail.tip': formatCloudFnError(err, '删除失败') }))
  }
}

module.exports = { data, methods, decorateMemo }
