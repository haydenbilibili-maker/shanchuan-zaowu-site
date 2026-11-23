/**
 * 董事会辩论（员工端 · 2026-11-23）
 *
 * 搬自 ERP AICenter 的「辩论」模式：选辩题 + 选 2–4 位董事，依次发言，最后由主持人收口。
 * - 一次请求只做一次发言（客户端串行），避免单次云函数超时；
 * - 提示词只在云端（`askMuseumGuide` 的 `mode: 'debate'`），客户端只传辩题 / 名单 / 已发言记录；
 * - 本场辩论只存本机（`ai_debate_last`），可重新打开看上一场。
 */
const { ROLES, byId } = require('../ai-center/roles')
const { openAppModal } = require('../../../utils/appModal')

const STORE_KEY = 'ai_debate_last'
const MIN_MEMBERS = 2
const MAX_MEMBERS = 4

const PRESETS = [
  '要不要把门店营业时间延长到 21:00',
  '新一批标本画该走高端定价还是走量',
  '今年双十二要不要做满减而不是赠品'
]

Page({
  data: {
    roles: ROLES,
    topic: '',
    presets: PRESETS,
    members: ['store_manager', 'cfo', 'marketing'],
    speeches: [],
    verdict: '',
    running: false,
    progressText: '',
    canStart: false,
    finished: false,
    hint: ''
  },

  onLoad() {
    this.restoreLast()
  },

  restoreLast() {
    try {
      const last = wx.getStorageSync(STORE_KEY)
      if (last && Array.isArray(last.speeches) && last.speeches.length) {
        this.setData({
          topic: last.topic || '',
          members: (last.members || []).filter((id) => byId(id)),
          speeches: last.speeches,
          verdict: last.verdict || '',
          finished: true
        })
      }
    } catch (e) { /* 没有上一场 */ }
    this.refreshCanStart()
  },

  onTopicInput(e) {
    this.setData({ topic: String((e.detail && e.detail.value) || '') }, () => this.refreshCanStart())
  },

  onPresetTap(e) {
    this.setData({ topic: String(e.currentTarget.dataset.text || '') }, () => this.refreshCanStart())
  },

  onMemberTap(e) {
    if (this.data.running) return
    const id = String(e.currentTarget.dataset.id || '')
    const list = this.data.members.slice()
    const i = list.indexOf(id)
    if (i >= 0) list.splice(i, 1)
    else {
      if (list.length >= MAX_MEMBERS) {
        this.setData({ hint: `最多 ${MAX_MEMBERS} 位董事` })
        setTimeout(() => this.setData({ hint: '' }), 1800)
        return
      }
      list.push(id)
    }
    this.setData({ members: list }, () => this.refreshCanStart())
  },

  refreshCanStart() {
    this.setData({ canStart: this.data.topic.trim().length >= 4 && this.data.members.length >= MIN_MEMBERS })
  },

  onStop() {
    this._abort = true
    this.setData({ running: false, progressText: '' })
  },

  onReset() {
    if (this.data.running) return
    openAppModal({
      title: '清空本场',
      content: '重新开一场辩论？本场发言会被清掉。',
      confirmText: '清空',
      danger: true,
      success: (res) => {
        if (!res.confirm) return
        this.setData({ speeches: [], verdict: '', finished: false })
        try { wx.removeStorageSync(STORE_KEY) } catch (e) { /* ignore */ }
      }
    })
  },

  onCopy(e) {
    const text = String(e.currentTarget.dataset.text || '')
    if (text) wx.setClipboardData({ data: text })
  },

  async startDebate() {
    if (this.data.running) return
    const topic = this.data.topic.trim()
    const members = this.data.members.slice()
    if (topic.length < 4 || members.length < MIN_MEMBERS) return

    this._abort = false
    const reqId = (this._reqId || 0) + 1
    this._reqId = reqId
    this.setData({ running: true, speeches: [], verdict: '', finished: false, progressText: '第一位董事准备发言…' })

    const speeches = []
    for (let i = 0; i < members.length; i += 1) {
      if (this._abort || reqId !== this._reqId) return
      const role = byId(members[i])
      this.setData({ progressText: `${role.name} 正在发言（${i + 1}/${members.length}）` })
      try {
        const res = await wx.cloud.callFunction({
          name: 'askMuseumGuide',
          data: { mode: 'debate', step: 'speak', topic, roleId: role.id, members, speeches }
        })
        const body = (res && res.result) || {}
        if (this._abort || reqId !== this._reqId) return
        if (!body.success) throw new Error(body.msg || '发言失败')
        speeches.push({ roleId: role.id, name: role.name, emoji: role.emoji, text: String(body.answer) })
        this.setData({ speeches: speeches.slice() })
      } catch (err) {
        if (this._abort || reqId !== this._reqId) return
        this.setData({ running: false, progressText: '', hint: '辩论中断了，稍后再试' })
        return
      }
    }

    if (this._abort || reqId !== this._reqId) return
    this.setData({ progressText: '主持人正在收口…' })
    let verdict = ''
    try {
      const res = await wx.cloud.callFunction({
        name: 'askMuseumGuide',
        data: { mode: 'debate', step: 'verdict', topic, members, speeches }
      })
      const body = (res && res.result) || {}
      if (body.success) verdict = String(body.answer)
    } catch (err) { /* 收口失败不算整场失败 */ }
    if (this._abort || reqId !== this._reqId) return
    this.setData({ verdict, running: false, progressText: '', finished: true })
    try {
      wx.setStorageSync(STORE_KEY, { topic, members, speeches, verdict, at: Date.now() })
    } catch (e) { /* ignore */ }
  }
})
