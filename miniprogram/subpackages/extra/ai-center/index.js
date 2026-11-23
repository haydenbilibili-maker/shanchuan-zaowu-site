/**
 * AI 智能中心（员工端 · 2026-11-23 产品负责人「把 ERP 的 AI 智能中心复制到小程序」）
 *
 * 与 ERP 的差异（一期）：
 *   - 只搬「虚拟员工对话」这一条主线；ERP 的工具链 / OpenClaw / 辩论模式不搬（蓝图见 docs）。
 *   - 人设与边界只在云函数 `askMuseumGuide`（mode: 'staff'），客户端只传 roleId。
 *   - 会话只存本机（按角色分桶），不上云；换设备不同步。
 */
const { ROLES, byId } = require('./roles')
const { openAppModal } = require('../../../utils/appModal')

const STORE_PREFIX = 'ai_center_session_v1_'
const MAX_KEEP = 80
const NO_KEY_TEXT = 'AI 服务还没配置，请联系超管'
const NOT_DEPLOYED_TEXT = 'AI 服务还没部署，稍后再试'

function storeKey(roleId) {
  return `${STORE_PREFIX}${roleId}`
}

function loadSession(roleId) {
  try {
    const list = wx.getStorageSync(storeKey(roleId))
    if (!Array.isArray(list)) return []
    return list.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string').slice(-MAX_KEEP)
  } catch (e) {
    return []
  }
}

function saveSession(roleId, messages) {
  try {
    wx.setStorageSync(storeKey(roleId), (messages || []).slice(-MAX_KEEP))
  } catch (e) { /* 存不下不影响对话 */ }
}

function isNotDeployed(err) {
  const s = String((err && (err.errMsg || err.message)) || err || '')
  const code = err && (err.errCode || err.code)
  return /FUNCTION_NOT_FOUND|FunctionName parameter could not be found|-505005/i.test(s) || String(code) === '-501000' || String(code) === '-505005'
}

function errText(err) {
  if (isNotDeployed(err)) return NOT_DEPLOYED_TEXT
  const s = String((err && (err.errMsg || err.message)) || err || '')
  if (/timeout|timed out|超时/i.test(s)) return '回答得有点久，超时了；稍后再试'
  return '网络不太稳，没能送到 AI 同事那里'
}

Page({
  data: {
    roles: ROLES,
    roleId: ROLES[0].id,
    role: ROLES[0],
    messages: [],
    starters: ROLES[0].starters,
    draft: '',
    sending: false,
    scrollTo: '',
    hasSession: false
  },

  onLoad(options) {
    const initial = options && options.roleId && byId(options.roleId) ? byId(options.roleId) : ROLES[0]
    this.switchRole(initial.id, false)
  },

  switchRole(roleId, reset = true) {
    const role = byId(roleId)
    const messages = loadSession(role.id)
    this.setData({
      roleId: role.id,
      role,
      starters: role.starters,
      messages,
      hasSession: messages.length > 0,
      scrollTo: messages.length ? `m${messages.length - 1}` : ''
    }, () => { if (reset) this.scrollToEnd() })
  },

  onRoleTap(e) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id || id === this.data.roleId || this.data.sending) return
    this.switchRole(id)
  },

  onInput(e) {
    this.setData({ draft: String((e.detail && e.detail.value) || '') })
  },

  onStarterTap(e) {
    const text = String(e.currentTarget.dataset.text || '')
    if (!text) return
    this.setData({ draft: text })
    this.send()
  },

  onClear() {
    openAppModal({
      title: '清空对话',
      content: `清空与「${this.data.role.name}」的本机会话？`,
      confirmText: '清空',
      danger: true,
      success: (res) => {
        if (!res.confirm) return
        saveSession(this.data.roleId, [])
        this.setData({ messages: [], hasSession: false, scrollTo: '' })
      }
    })
  },

  async send() {
    const question = String(this.data.draft || '').trim()
    if (!question || this.data.sending) return
    const role = this.data.role
    const history = (this.data.messages || []).slice(-6).map((m) => ({ role: m.role, content: m.text }))
    const userMsg = { role: 'user', text: question }
    const pending = { role: 'assistant', text: '', pending: true }
    const messages = this.data.messages.concat(userMsg, pending)
    this.setData({ messages, draft: '', sending: true }, () => this.scrollToEnd())

    let reply = null
    try {
      const res = await wx.cloud.callFunction({
        name: 'askMuseumGuide',
        data: { mode: 'staff', roleId: role.id, question, history }
      })
      const body = (res && res.result) || {}
      if (body.success && body.answer) reply = { role: 'assistant', text: String(body.answer) }
      else reply = { role: 'assistant', text: body.msg || '这位同事一时没接上话，稍后再试', isError: true }
    } catch (err) {
      reply = { role: 'assistant', text: errText(err), isError: true }
    }
    const next = this.data.messages.filter((m) => !m.pending).concat(reply)
    this.setData({ messages: next, sending: false, hasSession: true }, () => this.scrollToEnd())
    saveSession(role.id, next)
  },

  scrollToEnd() {
    const n = (this.data.messages || []).length
    if (!n) return
    this.setData({ scrollTo: `m${n - 1}` })
  }
})
