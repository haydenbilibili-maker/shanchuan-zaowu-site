/**
 * AI 智能中心（员工端 · 2026-11-23）
 *
 * 与 ERP 的差异：只搬「虚拟员工对话」，不搬工具链 / OpenClaw / 辩论。
 * 基础能力（第二轮补齐）：多会话（新建 / 切换 / 重命名 / 删除）、复制回答、重试、停止。
 *
 * 存储：按角色分桶 `ai_center_v2_<roleId>` = { activeId, list: [{ id, title, at, messages }] }
 *   - 只存本机，不上云；
 *   - 兼容上一版单会话（`ai_center_session_v1_<roleId>` 的数组），首次读取时迁移成一条会话。
 */
const { ROLES, byId } = require('./roles')
const { tasksOf } = require('./tasks')
const { openAppModal } = require('../../../utils/appModal')

const STORE_V2 = 'ai_center_v2_'
const STORE_V1 = 'ai_center_session_v1_'
const MAX_SESSIONS = 20
const MAX_KEEP = 80
const NOT_DEPLOYED_TEXT = 'AI 服务还没部署，稍后再试'

function newId() {
  return `s${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`
}

function cleanMessages(list) {
  return (Array.isArray(list) ? list : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
    .slice(-MAX_KEEP)
}

function titleOf(messages) {
  const first = (messages || []).find((m) => m.role === 'user' && m.text)
  const t = first ? String(first.text).trim() : ''
  return t ? t.slice(0, 16) : '新对话'
}

function loadState(roleId) {
  try {
    const saved = wx.getStorageSync(STORE_V2 + roleId)
    if (saved && Array.isArray(saved.list) && saved.list.length) {
      const list = saved.list.map((s) => ({
        id: String(s.id || newId()),
        title: String(s.title || titleOf(s.messages)),
        at: Number(s.at) || 0,
        messages: cleanMessages(s.messages)
      }))
      const activeId = list.some((s) => s.id === saved.activeId) ? saved.activeId : list[0].id
      return { activeId, list }
    }
    // 迁移上一版单会话
    const legacy = wx.getStorageSync(STORE_V1 + roleId)
    const messages = cleanMessages(legacy)
    if (messages.length) {
      const s = { id: newId(), title: titleOf(messages), at: Date.now(), messages }
      return { activeId: s.id, list: [s] }
    }
  } catch (e) { /* 读不到就当空 */ }
  return { activeId: '', list: [] }
}

function saveState(roleId, state) {
  try {
    const list = (state.list || []).slice(0, MAX_SESSIONS).map((s) => ({
      id: s.id,
      title: s.title || titleOf(s.messages),
      at: s.at || 0,
      messages: cleanMessages(s.messages)
    }))
    wx.setStorageSync(STORE_V2 + roleId, { activeId: state.activeId, list })
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
    tasks: tasksOf(ROLES[0].id),
    sessions: [],
    activeId: '',
    messages: [],
    title: '',
    draft: '',
    sending: false,
    scrollTo: '',
    canRetry: false
  },

  onLoad(options) {
    const role = options && options.roleId && byId(options.roleId) ? byId(options.roleId) : ROLES[0]
    this.switchRole(role.id)
  },

  switchRole(roleId) {
    const role = byId(roleId)
    const state = loadState(role.id)
    if (!state.list.length) {
      const s = { id: newId(), title: '新对话', at: Date.now(), messages: [] }
      state.list = [s]
      state.activeId = s.id
    }
    this.applyState(role, state)
  },

  applyState(role, state) {
    const active = state.list.find((s) => s.id === state.activeId) || state.list[0]
    this.setData({
      roleId: role.id,
      role,
      tasks: tasksOf(role.id),
      sessions: state.list,
      activeId: active ? active.id : '',
      messages: active ? active.messages : [],
      title: active ? active.title : '',
      canRetry: !!(active && active.messages.some((m) => m.role === 'user')),
      scrollTo: active && active.messages.length ? `m${active.messages.length - 1}` : ''
    })
  },

  persist() {
    const state = { activeId: this.data.activeId, list: this.data.sessions.map((s) => (s.id === this.data.activeId ? Object.assign({}, s, { messages: this.data.messages, title: titleOf(this.data.messages), at: Date.now() }) : s)) }
    saveState(this.data.roleId, state)
    this.setData({ sessions: state.list, title: titleOf(this.data.messages) })
  },

  onRoleTap(e) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id || id === this.data.roleId || this.data.sending) return
    this.switchRole(id)
  },

  onSessionTap(e) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id || id === this.data.activeId || this.data.sending) return
    this.setData({ activeId: id }, () => {
      const s = this.data.sessions.find((x) => x.id === id)
      this.applyState(this.data.role, { activeId: id, list: this.data.sessions })
      if (s) this.scrollToEnd()
    })
  },

  onNewSession() {
    if (this.data.sending) return
    const s = { id: newId(), title: '新对话', at: Date.now(), messages: [] }
    const list = [s].concat(this.data.sessions).slice(0, MAX_SESSIONS)
    this.setData({ sessions: list, activeId: s.id, messages: [], title: '新对话', canRetry: false, scrollTo: '' })
    saveState(this.data.roleId, { activeId: s.id, list })
  },

  onDeleteSession(e) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id || this.data.sending) return
    wx.vibrateShort({ type: 'light' })
    wx.showActionSheet({
      itemList: ['删除这条会话'],
      itemColor: '#B4453C',
      success: (res) => {
        if (res.tapIndex !== 0) return
        const list = this.data.sessions.filter((s) => s.id !== id)
        const next = list.length ? list : [{ id: newId(), title: '新对话', at: Date.now(), messages: [] }]
        const activeId = id === this.data.activeId ? next[0].id : this.data.activeId
        this.setData({ sessions: next, activeId, messages: (next.find((s) => s.id === activeId) || next[0]).messages, title: (next.find((s) => s.id === activeId) || next[0]).title })
        saveState(this.data.roleId, { activeId, list: next })
      }
    })
  },

  runTask(e) {
    const id = String(e.currentTarget.dataset.id || '')
    const task = (this.data.tasks || []).find((t) => t.id === id)
    if (!task || this.data.sending) return
    this._ask('', { taskId: task.id, label: task.title })
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
    if (!this.data.messages.length) return
    openAppModal({
      title: '清空当前对话',
      content: '只清空这一条会话，其它会话保留。',
      confirmText: '清空',
      danger: true,
      success: (res) => {
        if (!res.confirm) return
        this.setData({ messages: [], title: '新对话', canRetry: false })
        this.persist()
      }
    })
  },

  onCopy(e) {
    const text = String(e.currentTarget.dataset.text || '')
    if (!text) return
    wx.setClipboardData({ data: text })
  },

  onStop() {
    this._abort = true
    const messages = this.data.messages.filter((m) => !m.pending)
    this.setData({ messages, sending: false }, () => this.persist())
  },

  onRetry() {
    if (this.data.sending) return
    const messages = this.data.messages.slice()
    let lastUser = -1
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') { lastUser = i; break }
    }
    if (lastUser < 0) return
    const last = messages[lastUser]
    const kept = messages.slice(0, lastUser)
    this.setData({ messages: kept }, () => {
      this.persist()
      if (last.taskId) this._ask('', { taskId: last.taskId, label: String(last.text || '').replace(/^一键任务 · /, '') })
      else this._ask(last.text)
    })
  },

  send() {
    const question = String(this.data.draft || '').trim()
    if (!question || this.data.sending) return
    this.setData({ draft: '' })
    this._ask(question)
  },

  async _ask(question, task) {
    const role = this.data.role
    const history = this.data.messages.slice(-6).map((m) => ({ role: m.role, content: m.text }))
    const reqId = (this._reqId || 0) + 1
    this._reqId = reqId
    this._abort = false
    const userMsg = task
      ? { role: 'user', text: `一键任务 · ${task.label}`, taskId: task.taskId }
      : { role: 'user', text: question }
    const pending = { role: 'assistant', text: '', pending: true }
    const messages = this.data.messages.concat(userMsg, pending)
    this.setData({ messages, sending: true }, () => this.scrollToEnd())

    let reply
    try {
      const res = await wx.cloud.callFunction({
        name: 'askMuseumGuide',
        data: task ? { mode: 'staff', taskId: task.taskId, history } : { mode: 'staff', roleId: role.id, question, history }
      })
      if (this._abort || reqId !== this._reqId) return
      const body = (res && res.result) || {}
      reply = body.success && body.answer
        ? { role: 'assistant', text: String(body.answer) }
        : { role: 'assistant', text: body.msg || '这位同事一时没接上话，稍后再试', isError: true }
    } catch (err) {
      if (this._abort || reqId !== this._reqId) return
      reply = { role: 'assistant', text: errText(err), isError: true }
    }
    const next = this.data.messages.filter((m) => !m.pending).concat(reply)
    this.setData({ messages: next, sending: false, canRetry: true }, () => this.scrollToEnd())
    this.persist()
  },

  scrollToEnd() {
    const n = (this.data.messages || []).length
    if (!n) return
    this.setData({ scrollTo: `m${n - 1}` })
  }
})
