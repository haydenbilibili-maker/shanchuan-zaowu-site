/**
 * 智能运营中心（员工端 · 2026-11-23）
 *
 * 与 ERP 的差异：只搬「虚拟员工对话」，不搬工具链 / OpenClaw；辩论单独成页（ai-debate）。
 * 基础能力：多会话（新建 / 切换 / 重命名 / 复制全文 / 删除）、复制回答、重试、停止、一键任务。
 *
 * 第六轮（2026-11-23，产品负责人五条）：
 *   - 每位同事有名字、三行履历与口头禅（roles.js，与云端逐一一致）；姓氏小印代替 emoji；
 *   - 进页取「经营脉搏」与「同事们注意到的问题」（云端 mode:'staffBrief'，员工门禁）；点问题 = 找对应同事、问题预填好；
 *   - 超管可「立即巡检并通知我」、开关自动巡检（mode:'staffPatrol'，问题以同事口吻发到工作信息）；
 *   - 回答下方写明「依据几点的经营数据」；从工作信息点进来（?roleId=&ask=）直接落到那位同事、问题预填。
 *
 * 第七轮（2026-11-23）：迁到独立分包 subpackages/ai；超管「巡检设置」（逐条启用 / 阈值 / 最近巡检记录）；
 *   回答「有用 / 没用」，没用可「换个说法」（rephrase）；「请…也看看」把问题连同这位同事的看法转给另一位（relay）。
 *
 * 存储：按角色分桶 `ai_center_v2_<roleId>` = { activeId, list: [{ id, title, at, messages }] }
 *   - 只存本机，不上云；
 *   - 兼容上一版单会话（`ai_center_session_v1_<roleId>` 的数组），首次读取时迁移成一条会话。
 */
const { ROLES, byId } = require('./roles')
const { tasksOf } = require('./tasks')
const V = require('./centerView')
const { openAppModal } = require('../../../utils/appModal')

const STORE_V2 = 'ai_center_v2_'
const STORE_V1 = 'ai_center_session_v1_'
const MAX_SESSIONS = 20
const MAX_KEEP = 80
const BRIEF_TTL_MS = 60 * 1000
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
        named: !!s.named,
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
      named: !!s.named,
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
  return '网络不太稳，没能送到同事那里'
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
    canRetry: false,
    /** 经营脉搏与问题（云端 staffBrief；读不到时四格写「—」） */
    pulseCells: V.pulseCells(null),
    asOf: '',
    issues: [],
    issueCount: {},
    isSuper: false,
    patrol: null,
    patrolBusy: false,
    forbidden: '',
    /** 档案卡：没有对话时展开，有对话时收起，可手动点开 */
    profileOpen: true,
    /** 会话重命名（行内输入，不另起弹层） */
    renameId: '',
    renameText: '',
    tipText: '',
    /** 超管 · 巡检设置（第七轮） */
    rules: [],
    historyRows: [],
    settingsOpen: false,
    settingsDirty: false,
    /** 团队备忘（第八轮）：所有员工可见，超管行内编辑 */
    memo: [],
    memoEdit: false,
    memoDraft: [],
    memoText: '',
    memoUntil: '',
    memoMax: V.MEMO_MAX,
    memoLen: V.MEMO_LEN,
    memoBusy: false
  },

  onLoad(options) {
    const role = options && options.roleId ? byId(options.roleId) : ROLES[0]
    this.switchRole(role.id)
    // 从工作信息点进来：问题预填好，不自动发（让人看一眼再问）
    let ask = ''
    try { ask = options && options.ask ? decodeURIComponent(options.ask) : '' } catch (e) { ask = '' }
    if (ask) this.setData({ draft: ask.slice(0, 200) })
  },

  onShow() {
    if (!this._briefAt || Date.now() - this._briefAt > BRIEF_TTL_MS) this.loadBrief()
  },

  onUnload() {
    clearTimeout(this._tipTimer)
  },

  /* ------------------------------ 经营脉搏 / 问题 / 巡检 ------------------------------ */

  async loadBrief() {
    this._briefAt = Date.now()
    try {
      const res = await wx.cloud.callFunction({ name: 'askMuseumGuide', data: { mode: 'staffBrief' } })
      const body = (res && res.result) || {}
      if (!body.success) {
        if (body.error_type === 'forbidden') this.setData({ forbidden: body.msg || '智能运营中心仅限员工使用' })
        return
      }
      const issues = Array.isArray(body.issues) ? body.issues : []
      this.setData({
        pulseCells: V.pulseCells(body.pulse),
        asOf: (body.pulse && body.pulse.asOf) || '',
        issues,
        issueCount: V.issueCountByRole(issues),
        isSuper: !!body.isSuper,
        patrol: body.patrol || null,
        memo: this.data.memoEdit ? this.data.memo : (Array.isArray(body.memo) ? body.memo : []),
        forbidden: ''
      })
      if (body.isSuper) this.applyPatrol(body.patrol, body.rules)
    } catch (e) { /* 脉搏读不到不影响对话 */ }
  },

  /** 点一条问题：换到那位同事，问题预填好 */
  onIssueTap(e) {
    const i = (this.data.issues || [])[Number(e.currentTarget.dataset.index)]
    if (!i || this.data.sending) return
    if (i.roleId !== this.data.roleId) this.switchRole(i.roleId)
    this.setData({ draft: i.ask || '' })
  },

  /** 超管：立即巡检并把问题发到我的工作信息 */
  async onPatrolRun() {
    if (!this.data.isSuper || this.data.patrolBusy) return
    this.setData({ patrolBusy: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'askMuseumGuide', data: { mode: 'staffPatrol', op: 'run' } })
      const body = (res && res.result) || {}
      if (!body.success) throw new Error(body.msg || '巡检失败')
      const n = (body.issues || []).length
      this.setData({ patrol: body.patrol || this.data.patrol, issues: body.issues || [], issueCount: V.issueCountByRole(body.issues) })
      this.applyPatrol(body.patrol, body.rules)
      this.showTip(n ? `巡检完成：发现 ${n} 个问题，已发 ${body.sent || 0} 封工作信息（同一问题每天只发一次）` : '巡检完成：暂时没发现需要提醒的问题')
    } catch (err) {
      this.showTip(`没巡检成：${(err && err.message) || '稍后再试'}`)
    }
    this.setData({ patrolBusy: false })
  },

  async onPatrolToggle(e) {
    if (!this.data.isSuper || this.data.patrolBusy) return
    const enabled = !!(e && e.detail && e.detail.value)
    this.setData({ patrolBusy: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'askMuseumGuide', data: { mode: 'staffPatrol', op: 'toggle', enabled } })
      const body = (res && res.result) || {}
      if (!body.success) throw new Error(body.msg || '没改成')
      this.setData({ patrol: body.patrol })
      this.showTip(enabled ? '已开启：每天 9:30 与 17:30 自动巡检' : '已关闭自动巡检，仍可手动巡检')
    } catch (err) {
      this.setData({ patrol: Object.assign({}, this.data.patrol, { enabled: !enabled }) })
      this.showTip(`没改成：${(err && err.message) || '稍后再试'}`)
    }
    this.setData({ patrolBusy: false })
  },

  /** 巡检配置 → 页面（规则清单 + 最近巡检记录）；有未保存的改动时不覆盖规则 */
  applyPatrol(patrol, rules) {
    const patch = { historyRows: V.historyRows(patrol && patrol.history, rules || this.data.rules, 5) }
    if (Array.isArray(rules) && !this.data.settingsDirty) patch.rules = rules
    this.setData(patch)
  },

  onToggleSettings() {
    this.setData({ settingsOpen: !this.data.settingsOpen })
  },

  onRuleStep(e) {
    const i = Number(e.currentTarget.dataset.index)
    const r = this.data.rules[i]
    if (!r || r.limit == null) return
    const next = V.stepLimit(r, Number(e.currentTarget.dataset.dir))
    if (next === r.limit) return
    this.setData({ [`rules[${i}].limit`]: next, settingsDirty: true })
  },

  onRuleMute(e) {
    const i = Number(e.currentTarget.dataset.index)
    if (!this.data.rules[i]) return
    // 开关显示的是「启用」：关掉 = 静音这条规则
    this.setData({ [`rules[${i}].muted`]: !(e.detail && e.detail.value), settingsDirty: true })
  },

  async onSaveSettings() {
    if (!this.data.isSuper || !this.data.settingsDirty || this.data.patrolBusy) return
    this.setData({ patrolBusy: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'askMuseumGuide', data: Object.assign({ mode: 'staffPatrol', op: 'config' }, V.settingsOf(this.data.rules)) })
      const body = (res && res.result) || {}
      if (!body.success) throw new Error(body.msg || '没存上')
      this.setData({ settingsDirty: false, patrol: body.patrol })
      this.applyPatrol(body.patrol, body.rules)
      this.showTip('巡检设置已保存：页面上的提醒与下一次巡检都按新设置')
      this._briefAt = 0
      this.loadBrief()
    } catch (err) {
      this.showTip(`没存上：${(err && err.message) || '稍后再试'}`)
    }
    this.setData({ patrolBusy: false })
  },

  /* ------------------------------ 团队备忘（第八轮，超管编辑） ------------------------------ */

  onMemoEdit() {
    if (!this.data.isSuper) return
    this.setData({ memoEdit: true, memoDraft: this.data.memo.slice(), memoText: '', memoUntil: '' })
  },

  onMemoCancel() {
    this.setData({ memoEdit: false, memoText: '', memoUntil: '' })
  },

  onMemoText(e) {
    this.setData({ memoText: String((e.detail && e.detail.value) || '') })
  },

  onMemoUntil(e) {
    this.setData({ memoUntil: String((e.detail && e.detail.value) || '') })
  },

  onMemoAdd() {
    const r = V.memoAdd(this.data.memoDraft, this.data.memoText, this.data.memoUntil)
    if (r.error) { this.showTip(r.error); return }
    this.setData({ memoDraft: r.list, memoText: '', memoUntil: '' })
  },

  onMemoDel(e) {
    const i = Number(e.currentTarget.dataset.index)
    this.setData({ memoDraft: this.data.memoDraft.filter((_, j) => j !== i) })
  },

  async onMemoSave() {
    if (!this.data.isSuper || this.data.memoBusy) return
    this.setData({ memoBusy: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'askMuseumGuide', data: { mode: 'staffMemo', items: this.data.memoDraft } })
      const body = (res && res.result) || {}
      if (!body.success) throw new Error(body.msg || '没存上')
      this.setData({ memo: body.memo || [], memoEdit: false })
      this.showTip('团队备忘已保存：七位同事接下来都会按它给建议')
    } catch (err) {
      this.showTip(`没存上：${(err && err.message) || '稍后再试'}`)
    }
    this.setData({ memoBusy: false })
  },

  showTip(text) {
    this.setData({ tipText: text })
    clearTimeout(this._tipTimer)
    this._tipTimer = setTimeout(() => this.setData({ tipText: '' }), 3600)
  },

  /* ------------------------------ 选人 / 会话 ------------------------------ */

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
    const messages = active ? active.messages : []
    this.setData({
      roleId: role.id,
      role,
      tasks: tasksOf(role.id),
      sessions: state.list,
      activeId: active ? active.id : '',
      messages,
      title: active ? active.title : '',
      canRetry: !!(active && active.messages.some((m) => m.role === 'user')),
      profileOpen: !messages.length,
      renameId: '',
      scrollTo: messages.length ? `m${messages.length - 1}` : ''
    })
  },

  persist() {
    const state = {
      activeId: this.data.activeId,
      list: this.data.sessions.map((s) => (s.id === this.data.activeId
        ? Object.assign({}, s, { messages: this.data.messages, title: s.named ? s.title : titleOf(this.data.messages), at: Date.now() })
        : s))
    }
    saveState(this.data.roleId, state)
    const cur = state.list.find((s) => s.id === this.data.activeId)
    this.setData({ sessions: state.list, title: cur ? cur.title : titleOf(this.data.messages) })
  },

  onRoleTap(e) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id || this.data.sending) return
    if (id === this.data.roleId) { this.setData({ profileOpen: !this.data.profileOpen }); return }
    this.switchRole(id)
  },

  onToggleProfile() {
    this.setData({ profileOpen: !this.data.profileOpen })
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
    this.setData({ sessions: list, activeId: s.id, messages: [], title: '新对话', canRetry: false, scrollTo: '', profileOpen: true, renameId: '' })
    saveState(this.data.roleId, { activeId: s.id, list })
  },

  /** 长按会话签：重命名 / 复制全文 / 删除 */
  onDeleteSession(e) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id || this.data.sending) return
    wx.vibrateShort({ type: 'light' })
    wx.showActionSheet({
      itemList: ['重命名', '复制全文', '删除这条会话'],
      success: (res) => {
        if (res.tapIndex === 0) this.startRename(id)
        else if (res.tapIndex === 1) this.copySession(id)
        else if (res.tapIndex === 2) this.removeSession(id)
      }
    })
  },

  removeSession(id) {
    const list = this.data.sessions.filter((s) => s.id !== id)
    const next = list.length ? list : [{ id: newId(), title: '新对话', at: Date.now(), messages: [] }]
    const activeId = id === this.data.activeId ? next[0].id : this.data.activeId
    saveState(this.data.roleId, { activeId, list: next })
    this.applyState(this.data.role, { activeId, list: next })
  },

  copySession(id) {
    const s = this.data.sessions.find((x) => x.id === id)
    const messages = id === this.data.activeId ? this.data.messages : (s ? s.messages : [])
    const text = V.transcriptOf(messages, this.data.role.person)
    if (!text) { this.showTip('这条会话还没有内容'); return }
    wx.setClipboardData({ data: text })
  },

  startRename(id) {
    const s = this.data.sessions.find((x) => x.id === id)
    this.setData({ renameId: id, renameText: s ? s.title : '' })
  },

  onRenameInput(e) {
    this.setData({ renameText: String((e.detail && e.detail.value) || '') })
  },

  onRenameSave() {
    const id = this.data.renameId
    const t = V.cleanTitle(this.data.renameText)
    if (!id) return
    if (!t) { this.setData({ renameId: '' }); return }
    const list = this.data.sessions.map((s) => (s.id === id ? Object.assign({}, s, { title: t, named: true }) : s))
    saveState(this.data.roleId, { activeId: this.data.activeId, list })
    this.setData({ sessions: list, renameId: '', title: id === this.data.activeId ? t : this.data.title })
  },

  onRenameCancel() {
    this.setData({ renameId: '' })
  },

  goDebate() {
    if (this.data.sending) return
    wx.navigateTo({ url: '/subpackages/ai/ai-debate/index' })
  },

  /* ------------------------------ 提问 ------------------------------ */

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
        this.setData({ messages: [], title: '新对话', canRetry: false, profileOpen: true })
        this.persist()
      }
    })
  },

  onCopy(e) {
    const text = String(e.currentTarget.dataset.text || '')
    if (!text) return
    wx.setClipboardData({ data: text })
  },

  /** 有用 / 没用：只记在本机这条回答上；标了「没用」才出「换个说法」 */
  onVote(e) {
    const i = Number(e.currentTarget.dataset.index)
    const m = this.data.messages[i]
    if (!m || m.role !== 'assistant' || m.pending || m.isError) return
    const vote = e.currentTarget.dataset.vote === 'down' ? 'down' : 'up'
    this.setData({ [`messages[${i}].vote`]: m.vote === vote ? '' : vote }, () => this.persist())
  },

  /** 换个说法：和「重试」一样丢掉最后一条回答重问，但告诉同事上一版没帮上忙 */
  onRephrase() {
    this.onRetry({ rephrase: true })
  },

  /** 请…也看看：把这条回答对应的问题，连同这位同事的看法，转给另一位同事 */
  onHandoff(e) {
    if (this.data.sending) return
    const i = Number(e.currentTarget.dataset.index)
    const m = this.data.messages[i]
    const question = V.questionBefore(this.data.messages, i)
    if (!m || !question) { this.showTip('一键任务的结果不转交，可以直接去找那位同事'); return }
    const from = this.data.role
    const others = this.data.roles.filter((r) => r.id !== from.id)
    wx.showActionSheet({
      itemList: others.map((r) => `${r.person} · ${r.name}`),
      success: (res) => {
        const to = others[res.tapIndex]
        if (!to) return
        this.switchRole(to.id)
        this._ask(question, null, { relay: { fromRoleId: from.id, text: String(m.text || '').slice(0, 400) }, relayFrom: from.person })
      }
    })
  },

  onStop() {
    this._abort = true
    const messages = this.data.messages.filter((m) => !m.pending)
    this.setData({ messages, sending: false }, () => this.persist())
  },

  onRetry(opts) {
    if (this.data.sending) return
    const extra = opts && opts.rephrase === true ? { rephrase: true } : null
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
      if (last.taskId) this._ask('', { taskId: last.taskId, label: String(last.text || '').replace(/^一键任务 · /, '') }, extra)
      else this._ask(last.text, null, extra)
    })
  },

  send() {
    const question = String(this.data.draft || '').trim()
    if (!question || this.data.sending) return
    this.setData({ draft: '' })
    this._ask(question)
  },

  async _ask(question, task, opts) {
    const o = opts || {}
    const role = this.data.role
    const history = this.data.messages.filter((m) => !m.isError).slice(-6).map((m) => ({ role: m.role, content: m.text }))
    const reqId = (this._reqId || 0) + 1
    this._reqId = reqId
    this._abort = false
    const userMsg = task
      ? { role: 'user', text: `一键任务 · ${task.label}`, taskId: task.taskId }
      : Object.assign({ role: 'user', text: question }, o.relayFrom ? { relayFrom: o.relayFrom } : {})
    const pending = { role: 'assistant', text: '', pending: true }
    const messages = this.data.messages.concat(userMsg, pending)
    this.setData({ messages, sending: true, profileOpen: false }, () => this.scrollToEnd())

    let reply
    try {
      const res = await wx.cloud.callFunction({
        name: 'askMuseumGuide',
        data: Object.assign(
          task ? { mode: 'staff', taskId: task.taskId, history } : { mode: 'staff', roleId: role.id, question, history },
          o.rephrase ? { rephrase: true } : {},
          o.relay && !task ? { relay: o.relay } : {}
        )
      })
      if (this._abort || reqId !== this._reqId) return
      const body = (res && res.result) || {}
      if (body.error_type === 'forbidden') this.setData({ forbidden: body.msg || '智能运营中心仅限员工使用' })
      reply = body.success && body.answer
        ? { role: 'assistant', text: String(body.answer), asOf: String(body.asOf || ''), needsVerify: body.needsVerify === true, verifyFlags: Array.isArray(body.verifyFlags) ? body.verifyFlags : [] }
        : { role: 'assistant', text: body.msg || `${role.person}一时没接上话，稍后再试`, isError: true }
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
