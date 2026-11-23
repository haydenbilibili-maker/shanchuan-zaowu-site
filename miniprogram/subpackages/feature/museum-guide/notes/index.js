/**
 * 博物君 · 博物笔记（2026-11-23）：在问答里收藏的回答，存本机（最多 50 条，新的在前）。
 * 删除两步确认（第一下只亮出「再点一次删除」），不弹原生框。
 */
const N = require('../naturalist')

const app = getApp()
const GUIDE = '/subpackages/feature/museum-guide/index'

function storeKey() {
  const openid = (app && app.globalData && app.globalData.openid) || ''
  return openid ? `museum_guide_notes_v1_${openid}` : 'museum_guide_notes_v1'
}

function timeText(ts) {
  const d = new Date((ts || 0) + 8 * 3600 * 1000)
  return `${d.getUTCMonth() + 1}.${d.getUTCDate() < 10 ? '0' : ''}${d.getUTCDate()}`
}

Page({
  data: { notes: [], openId: '', confirmId: '' },

  onShow() {
    let raw = []
    try { raw = wx.getStorageSync(storeKey()) || [] } catch (e) { raw = [] }
    this._raw = Array.isArray(raw) ? raw : []
    this.render()
  },

  onUnload() { clearTimeout(this._confirmTimer) },

  render() {
    this.setData({ notes: this._raw.map((n) => ({ id: n.id, q: n.q, a: n.a, when: timeText(n.at) })) })
  },

  onToggle(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ openId: this.data.openId === id ? '' : id })
  },

  onCopy(e) {
    const n = this._raw.find((x) => x.id === e.currentTarget.dataset.id)
    if (n) wx.setClipboardData({ data: n.q ? `问：${n.q}\n博物君：${n.a}` : n.a })
  },

  /** 删除：第一下只亮出确认，3 秒内再点才删 */
  onDelete(e) {
    const id = e.currentTarget.dataset.id
    if (this.data.confirmId !== id) {
      this.setData({ confirmId: id })
      clearTimeout(this._confirmTimer)
      this._confirmTimer = setTimeout(() => this.setData({ confirmId: '' }), 3000)
      return
    }
    clearTimeout(this._confirmTimer)
    this._raw = N.removeNote(this._raw, id)
    try { wx.setStorageSync(storeKey(), this._raw) } catch (err) { /* ignore */ }
    this.setData({ confirmId: '' })
    this.render()
  },

  onAskMore(e) {
    const n = this._raw.find((x) => x.id === e.currentTarget.dataset.id)
    const q = n && n.q ? `接着「${n.q.slice(0, 40)}」再多讲一点` : ''
    wx.navigateTo({ url: q ? `${GUIDE}?from=notes&q=${encodeURIComponent(q)}` : GUIDE })
  },

  onGoGuide() {
    wx.navigateBack({ fail: () => wx.redirectTo({ url: GUIDE }) })
  }
})
