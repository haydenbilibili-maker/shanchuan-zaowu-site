const { guardManagerPage } = require('../../../../utils/managerAuth')
const { formatCloudFnError } = require('../../utils/memberScan')
const { goManagerModule } = require('../../manager/moduleRoutes')
const {
  guardLiveHostWorkspace,
  goLiveBroadcast,
  hasPermission,
  roleHasStored
} = require('../../utils/staffAuth')
const {
  writeLiveSnapshot,
  readLiveSnapshot,
  decorateShelfList,
  buildTalkSegments,
  talkTextFromSegments
} = require('../sessionSync')
const {
  liveStatusLamp,
  liveReadyLamp,
  LAMP
} = require('../../utils/signalLamp')

function parseCloudTime(raw) {
  if (raw == null || raw === '') return null
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const t = Date.parse(raw)
    return Number.isNaN(t) ? null : t
  }
  if (typeof raw === 'object') {
    if (raw.$date != null) {
      const inner = raw.$date
      if (typeof inner === 'number') return inner
      const t = Date.parse(String(inner))
      return Number.isNaN(t) ? null : t
    }
    if (typeof raw.getTime === 'function') {
      const t = raw.getTime()
      return Number.isFinite(t) ? t : null
    }
  }
  return null
}

function formatDateTime(raw) {
  const ms = parseCloudTime(raw)
  if (!ms) return '—'
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (x) => String(x).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function statusChipText(status) {
  if (status === 'live') return '直播中'
  if (status === 'idle') return '待开播'
  if (status === 'ended') return '已结束'
  return status || '未知'
}

function statusChipClass(status) {
  if (status === 'live') return 'chip-live'
  if (status === 'idle') return 'chip-idle'
  if (status === 'ended') return 'chip-ended'
  return ''
}

function shelfItemsOf(session) {
  if (session && session.shelf && Array.isArray(session.shelf.items)) return session.shelf.items
  return []
}

function applyTalk(session, notice, items) {
  const segments = buildTalkSegments(session, notice, items)
  return {
    talkSegments: segments,
    talkText: talkTextFromSegments(segments),
    talkLines: segments.map((s) => `${s.heading}：${String(s.body || '').replace(/\n/g, ' / ')}`)
  }
}

Page({
  data: {
    ready: false,
    roleText: '主播',
    staffName: '',
    canPayslip: false,
    canAttendance: false,
    canYouxin: false,
    canForceOther: false,
    liveDashLoading: false,
    loadError: '',
    mineSessionId: '',
    showOnAir: false,
    configured: false,
    enabled: true,
    primaryCtaLabel: '快捷开播',
    primaryCtaAction: 'create',
    canEndSession: false,
    otherLiveHint: '',
    otherSessionId: '',
    otherHostName: '',
    otherLightClass: '',
    configActionLabel: '',
    configAction: '',
    configLightClass: '',
    enabledLightClass: '',
    statusCard: {
      title: '',
      viewerCount: 0,
      likeCount: 0,
      messageCount: 0,
      peakViewers: 0,
      joinCount: 0,
      startLabel: '—',
      endLabel: '—',
      scheduledLabel: '',
      shelfCount: 0,
      reminderCount: 0,
      statusLabel: '暂无场次',
      statusTone: '',
      statusLightClass: '',
      emptyHint: '还没有本人场次。先新建一场，再开播、挂品。'
    },
    shelfPreview: [],
    shelfBusy: false,
    talkLines: [],
    talkSegments: [],
    talkText: '',
    copyHint: '',
    adminHint: '',
    recentSessions: [],
    noticeDraft: '',
    noticeSessionId: '',
    creating: false,
    ending: false,
    talkHighlight: false
  },

  onLoad() {
    this.bootstrap()
  },

  onPullDownRefresh() {
    this.loadLiveDash().finally(() => wx.stopPullDownRefresh())
  },

  async bootstrap() {
    try {
      if (!guardManagerPage()) return
      const role = await guardLiveHostWorkspace()
      if (!role) return

      let roleText = '主播'
      if (roleHasStored(role, 'super_admin')) roleText = '超管'
      else if (roleHasStored(role, 'manager')) roleText = '店长'

      this.setData({
        ready: true,
        roleText,
        staffName: role.name || '',
        canPayslip: hasPermission(role, 'viewPayslip'),
        canAttendance: hasPermission(role, 'staffAttendance'),
        canYouxin: !!(roleHasStored(role, 'super_admin') || roleHasStored(role, 'manager')),
        canForceOther: !!roleHasStored(role, 'super_admin')
      })
      await this.loadLiveDash()
    } catch (e) {
      console.warn('live studio bootstrap', e)
      wx.showToast({ title: '工作台加载失败', icon: 'none' })
      setTimeout(() => {
        wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
      }, 400)
    }
  },

  onShow() {
    if (!this.data.ready) return
    this.applyLocalSnapshot()
    this.loadLiveDash({ preferFresh: true })
  },

  applyLocalSnapshot() {
    const snap = readLiveSnapshot()
    if (!snap) return
    const items = decorateShelfList(snap.shelfItems || [])
    const talk = applyTalk(
      { title: snap.title, notice: snap.notice, shelf: { items } },
      snap.notice,
      items
    )
    const statusLabel = statusChipText(snap.status)
    this.setData({
      showOnAir: snap.status === 'live',
      mineSessionId: snap.sessionId || this.data.mineSessionId,
      noticeSessionId: snap.sessionId || this.data.noticeSessionId,
      noticeDraft: snap.notice != null ? snap.notice : this.data.noticeDraft,
      shelfPreview: items,
      ...talk,
      statusCard: {
        ...this.data.statusCard,
        title: snap.title || this.data.statusCard.title,
        viewerCount: snap.viewerCount,
        likeCount: snap.likeCount,
        messageCount: snap.messageCount,
        peakViewers: snap.peakViewers,
        joinCount: snap.joinCount,
        reminderCount: snap.reminderCount,
        shelfCount: snap.shelfCount,
        statusLabel: statusLabel === '未知' ? this.data.statusCard.statusLabel : statusLabel,
        statusTone: snap.status === 'live' ? 'live' : this.data.statusCard.statusTone,
        emptyHint: snap.status === 'ended' ? '上一场已结束。数字已按关播结果回写。' : this.data.statusCard.emptyHint
      }
    })
  },

  goPrimaryCta() {
    if (this.data.primaryCtaAction === 'create') {
      this.createSession(true)
      return
    }
    this.goBroadcast()
  },

  goBroadcast() {
    if (!this.data.mineSessionId) {
      wx.showToast({ title: '请先新建场次', icon: 'none' })
      return
    }
    wx.vibrateShort({ type: 'light' })
    goLiveBroadcast()
  },

  goShelf() {
    if (!this.data.mineSessionId) {
      wx.showToast({ title: '请先新建场次再挂品', icon: 'none' })
      return
    }
    wx.vibrateShort({ type: 'light' })
    goLiveBroadcast({ focus: 'shelf' })
  },

  goTalkSection() {
    wx.vibrateShort({ type: 'light' })
    this.setData({ talkHighlight: true })
    wx.createSelectorQuery()
      .select('#talk-card')
      .boundingClientRect((rect) => {
        if (!rect) return
        wx.pageScrollTo({
          scrollTop: Math.max(0, (rect.top || 0) + (this._scrollTop || 0) - 24),
          duration: 280
        })
      })
      .exec()
    setTimeout(() => this.setData({ talkHighlight: false }), 1600)
  },

  onPageScroll(e) {
    this._scrollTop = (e && e.scrollTop) || 0
  },

  goYouxin() {
    if (!this.data.canYouxin) {
      wx.showToast({ title: '有信由超管/店长发送，可先备好本场话术', icon: 'none' })
      return
    }
    wx.vibrateShort({ type: 'light' })
    goManagerModule(11, '山海有信')
  },

  goPayslip() {
    if (!this.data.canPayslip) {
      wx.showToast({ title: '暂无工资条权限', icon: 'none' })
      return
    }
    wx.vibrateShort({ type: 'light' })
    wx.navigateTo({
      url: '/subpackages/manager/payslip/index?workspace=live',
      fail: () => wx.showToast({ title: '工资条暂不可用', icon: 'none' })
    })
  },

  goAttendance() {
    if (!this.data.canAttendance) {
      wx.showToast({ title: '暂无考勤权限', icon: 'none' })
      return
    }
    wx.vibrateShort({ type: 'light' })
    wx.navigateTo({
      url: '/subpackages/extra/staff/attendance/index',
      fail: () => wx.showToast({ title: '考勤页暂不可用', icon: 'none' })
    })
  },

  copyTalkingPoints() {
    const text = this.data.talkText
    if (!text) {
      wx.showToast({ title: '先挂品或写公告，再复制提纲', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: text,
      success: () => {
        this.setData({ copyHint: '已复制到剪贴板，可贴到备忘或有信' })
        wx.showToast({ title: '提纲已复制', icon: 'success' })
        clearTimeout(this._copyHintTimer)
        this._copyHintTimer = setTimeout(() => this.setData({ copyHint: '' }), 2400)
      }
    })
  },

  copyTalkSegment(e) {
    const key = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key
    const seg = (this.data.talkSegments || []).find((s) => s && s.key === key)
    if (!seg) return
    wx.setClipboardData({
      data: `【${seg.heading}】\n${seg.body}`,
      success: () => {
        this.setData({ copyHint: `已复制「${seg.heading}」` })
        wx.showToast({ title: '本段已复制', icon: 'success' })
        clearTimeout(this._copyHintTimer)
        this._copyHintTimer = setTimeout(() => this.setData({ copyHint: '' }), 2400)
      }
    })
  },

  async regenerateTalk() {
    wx.vibrateShort({ type: 'light' })
    await this.loadLiveDash({ preferFresh: true })
    if (!this.data.talkText) {
      wx.showToast({ title: '先挂品或写公告再生成', icon: 'none' })
      return
    }
    wx.showToast({ title: '提纲已按挂品重排', icon: 'none' })
  },

  onConfigAction() {
    const action = this.data.configAction
    if (action === 'broadcast') {
      goLiveBroadcast()
      return
    }
    if (action === 'endOther') {
      this.forceEndOther()
    }
  },

  async forceEndOther() {
    if (!this.data.canForceOther || !this.data.otherSessionId) {
      wx.showToast({ title: '仅超管可结束对方场次', icon: 'none' })
      return
    }
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '结束对方直播？',
        content: `将结束「${this.data.otherLiveHint || '同事场次'}」，观众端会立即不可看。`,
        confirmColor: '#D64045',
        success: (r) => resolve(!!r.confirm)
      })
    })
    if (!ok) return
    this.setData({ ending: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: { action: 'forceEnd', sessionId: this.data.otherSessionId }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        wx.showToast({ title: formatCloudFnError(result, result.msg || '结束失败'), icon: 'none' })
        return
      }
      wx.showToast({ title: '对方场次已结束', icon: 'none' })
      await this.loadLiveDash({ preferFresh: true })
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e, '结束失败'), icon: 'none' })
    } finally {
      this.setData({ ending: false })
    }
  },

  async updateShelfAction(payload) {
    const sessionId = this.data.mineSessionId
    if (!sessionId) {
      wx.showToast({ title: '请先新建场次', icon: 'none' })
      return
    }
    if (this.data.shelfBusy) return
    this.setData({ shelfBusy: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: { action: 'updateShelf', sessionId, ...payload }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        wx.showToast({ title: formatCloudFnError(result, result.msg || '挂车更新失败'), icon: 'none' })
        return
      }
      writeLiveSnapshot(result.session, {
        configured: this.data.configured,
        enabled: this.data.enabled
      })
      await this.loadLiveDash({ preferFresh: true })
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e, '挂车更新失败'), icon: 'none' })
    } finally {
      this.setData({ shelfBusy: false })
    }
  },

  moveShelfItem(e) {
    const id = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id
    const dir = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.dir
    if (!id) return
    this.updateShelfAction({ move: { productId: id, dir } })
  },

  removeShelfItem(e) {
    const id = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id
    if (!id) return
    this.updateShelfAction({ remove: [id] })
  },

  async clearShelf() {
    if (!this.data.shelfPreview.length) return
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '清空本场挂车？',
        content: '观众端挂车会同步清空。可稍后再从藏品库挂上。',
        confirmColor: '#D64045',
        success: (r) => resolve(!!r.confirm)
      })
    })
    if (!ok) return
    this.updateShelfAction({ clear: true })
  },

  buildStatusFromDashboard(result) {
    const mine = result.mine || null
    const active = result.active || null
    const lastEnded = result.lastEnded || null
    const focus = (mine && (mine.status === 'live' || mine.status === 'idle'))
      ? mine
      : (mine || lastEnded || (active && active.status === 'live' ? active : null))

    const playable = !!(focus && focus.status === 'live' && result.configured && focus.pullUrl)
    const showOnAir = playable && !!(mine && mine.status === 'live')
    let statusLabel = '暂无场次'
    let statusTone = ''
    let emptyHint = '还没有本人场次。先新建一场，再开播、挂品。'
    if (focus) {
      if (focus.status === 'live') {
        statusLabel = result.configured && focus.pullUrl ? '直播中' : '异常残留'
        statusTone = result.configured && focus.pullUrl ? 'live' : 'warn'
        emptyHint = ''
      } else if (focus.status === 'idle') {
        statusLabel = '待开播'
        emptyHint = '场次已备好。挂上藏品、写好开场，即可开始推流。'
      } else if (focus.status === 'ended') {
        statusLabel = '已结束'
        emptyHint = '上一场已结束。新建场次后可再次开播。'
      }
    }

    const stats = (focus && focus.stats) || {}
    const items = shelfItemsOf(focus)
    const shelfCount = items.length
      || (focus && Array.isArray(focus.shelfProductIds) ? focus.shelfProductIds.length : 0)

    const mineSessionId = (mine && mine._id) || ''
    const noticeSessionId = mineSessionId || (focus && focus._id) || ''
    const canEndSession = !!(mine && (mine.status === 'live' || mine.status === 'idle'))
    const noticeDraft = (focus && focus.notice) || this.data.noticeDraft || ''

    let primaryCtaLabel = '快捷开播'
    let primaryCtaAction = 'create'
    if (!mineSessionId) {
      primaryCtaLabel = '快捷开播'
      primaryCtaAction = 'create'
    } else if (mine && mine.status === 'idle') {
      primaryCtaLabel = '开始直播'
      primaryCtaAction = 'broadcast'
    } else if (mine && mine.status === 'live') {
      primaryCtaLabel = '进入开播'
      primaryCtaAction = 'broadcast'
    } else {
      primaryCtaLabel = '进入开播'
      primaryCtaAction = 'broadcast'
    }

    const adminHints = []
    let configAction = ''
    let configActionLabel = ''
    if (!result.configured) {
      adminHints.push('推流未配置，无法出画。请超管在云函数 manageLiveSession 填写 LIVE_* 后，再进开播控制台确认。')
      configAction = 'broadcast'
      configActionLabel = '去开播页看说明'
    }
    if (result.enabled !== true) {
      adminHints.push('C 端「馆内直播」开关未开，观众看不到入口。请超管在内容开关打开。')
    }

    let otherLiveHint = ''
    let otherSessionId = ''
    let otherHostName = ''
    if (active && active._id && !(mine && mine._id === active._id) && active.status === 'live') {
      otherHostName = active.hostName || '同事'
      otherSessionId = active._id
      otherLiveHint = `同事正在直播：「${active.title || '未命名'}」 · ${otherHostName}。同时仅 1 场。`
    }

    const shelfPreview = decorateShelfList(items)
    const talk = applyTalk(focus, noticeDraft, shelfPreview)

    return {
      showOnAir,
      configured: !!result.configured,
      enabled: result.enabled === true,
      mineSessionId,
      noticeSessionId,
      canEndSession,
      primaryCtaLabel,
      primaryCtaAction,
      adminHint: adminHints.join('；'),
      configAction,
      configActionLabel,
      otherLiveHint,
      otherSessionId,
      otherHostName,
      shelfPreview,
      ...talk,
      statusCard: {
        title: (focus && focus.title) || '',
        viewerCount: Math.max(0, Number(focus && focus.viewerCount) || 0),
        likeCount: Math.max(0, Number(stats.likeCount) || Number(focus && focus.likeCount) || 0),
        messageCount: Math.max(0, Number(stats.messageCount) || 0),
        peakViewers: Math.max(0, Number(stats.peakViewers) || 0),
        joinCount: Math.max(0, Number(stats.joinCount) || 0),
        startLabel: formatDateTime(focus && focus.startTime),
        endLabel: formatDateTime(focus && focus.endTime),
        scheduledLabel: (focus && focus.scheduledLabel) || '',
        shelfCount,
        reminderCount: Math.max(0, Number(stats.reminderCount) || 0),
        statusLabel,
        statusTone,
        statusLightClass: liveStatusLamp(statusTone, statusLabel),
        emptyHint
      },
      configLightClass: liveReadyLamp(!!result.configured),
      enabledLightClass: liveReadyLamp(result.enabled === true),
      otherLightClass: otherLiveHint ? 'warn blink' : LAMP.muted,
      noticeDraft
    }
  },

  async loadLiveDash(opts) {
    const token = (this._dashToken = (this._dashToken || 0) + 1)
    if (!(opts && opts.silent)) this.setData({ liveDashLoading: true, loadError: '' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: { action: 'getDashboard' }
      })
      const result = (res && res.result) || {}
      if (result.success === false) {
        throw result
      }

      const recent = (result.recent || []).map((s) => {
        const stats = (s && s.stats) || {}
        const likeCount = Math.max(0, Number(stats.likeCount || s.likeCount) || 0)
        const messageCount = Math.max(0, Number(stats.messageCount) || 0)
        const peakViewers = Math.max(0, Number(stats.peakViewers) || 0)
        const shelfCount = Math.max(0, Number(s.shelfCount) || 0)
        const summaryParts = []
        if (likeCount) summaryParts.push(`赞 ${likeCount}`)
        if (messageCount) summaryParts.push(`留言 ${messageCount}`)
        if (peakViewers) summaryParts.push(`峰值 ${peakViewers}`)
        if (shelfCount) summaryParts.push(`挂品 ${shelfCount}`)
        return {
          ...s,
          statusText: statusChipText(s.status),
          chipClass: statusChipClass(s.status),
          isMine: !!(result.mine && result.mine._id === s._id),
          timeHint: s.status === 'ended'
            ? `结束 ${formatDateTime(s.endTime)}`
            : (s.scheduledLabel ? `预约 ${s.scheduledLabel}` : `创建 ${formatDateTime(s.createTime)}`),
          summary: summaryParts.join(' · ')
        }
      })

      const built = this.buildStatusFromDashboard(result)
      if (token !== this._dashToken) return
      const focus = result.mine || result.lastEnded || null
      if (focus) {
        writeLiveSnapshot(focus, {
          configured: built.configured,
          enabled: built.enabled
        })
      }
      this.setData({
        liveDashLoading: false,
        loadError: '',
        recentSessions: recent,
        ...built,
        adminHint: built.adminHint || (result.msg && (!result.configured || result.enabled !== true) ? result.msg : '')
      })
    } catch (e) {
      console.warn('loadLiveDash', e)
      if (token !== this._dashToken) return
      this.setData({
        liveDashLoading: false,
        loadError: formatCloudFnError(e, '直播状态加载失败'),
        showOnAir: false,
        recentSessions: [],
        shelfPreview: [],
        talkLines: [],
        talkSegments: []
      })
    }
  },

  onNoticeInput(e) {
    const noticeDraft = e.detail.value || ''
    const talk = applyTalk(
      { title: this.data.statusCard.title, notice: noticeDraft, shelf: { items: this.data.shelfPreview } },
      noticeDraft,
      this.data.shelfPreview
    )
    this.setData({ noticeDraft, ...talk })
  },

  async saveNotice() {
    const sessionId = this.data.noticeSessionId
    if (!sessionId) {
      wx.showToast({ title: '请先新建场次', icon: 'none' })
      return
    }
    const notice = String(this.data.noticeDraft || '').trim().slice(0, 80)
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: { action: 'updateNotice', sessionId, notice }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        wx.showToast({ title: formatCloudFnError(result, result.msg || '保存失败'), icon: 'none' })
        return
      }
      wx.showToast({ title: '公告已更新', icon: 'success' })
      this.loadLiveDash()
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e, '保存失败'), icon: 'none' })
    }
  },

  async createSession(openAfter) {
    if (this.data.creating) return
    const goBroadcastAfter = openAfter === true
    const title = await new Promise((resolve) => {
      wx.showModal({
        title: goBroadcastAfter ? '快捷开播' : '新建场次',
        editable: true,
        placeholderText: '场次标题，如「馆内藏品夜话」',
        confirmColor: '#C4A76C',
        success: (r) => resolve(r.confirm ? String(r.content || '').trim() : '')
      })
    })
    if (!title) return
    this.setData({ creating: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: { action: 'create', title }
      })
      const result = (res && res.result) || {}
      this.setData({ creating: false })
      if (!result.success) {
        wx.showToast({ title: formatCloudFnError(result, result.msg || '创建失败'), icon: 'none' })
        return
      }
      wx.showToast({ title: goBroadcastAfter ? '场次已建，进入控制台' : '场次已创建', icon: 'success' })
      await this.loadLiveDash()
      if (goBroadcastAfter) goLiveBroadcast()
    } catch (e) {
      this.setData({ creating: false })
      wx.showToast({ title: formatCloudFnError(e, '创建失败'), icon: 'none' })
    }
  },

  onCreateTap() {
    this.createSession(false)
  },

  onSessionTap(e) {
    const item = e.currentTarget.dataset.item
    if (!item || !item._id) return
    if (item.isMine && item.status !== 'ended') {
      wx.vibrateShort({ type: 'light' })
      goLiveBroadcast()
      return
    }
    if (item.isMine) {
      this.setData({
        noticeSessionId: item._id,
        noticeDraft: item.notice || ''
      })
      wx.showToast({ title: '已选中该场公告', icon: 'none' })
      return
    }
    wx.showToast({ title: '仅可操作本人场次', icon: 'none' })
  },

  onSessionEditNotice(e) {
    const id = e.currentTarget.dataset.id
    const notice = e.currentTarget.dataset.notice || ''
    if (!id) return
    this.setData({ noticeSessionId: id, noticeDraft: notice })
  },

  async forceEndLive() {
    const id = this.data.mineSessionId
    if (!id || !this.data.canEndSession) {
      wx.showToast({ title: '没有可结束场次', icon: 'none' })
      return
    }
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '结束当前直播？',
        content: '观众端将立即无法继续观看，本场挂车也不可再购。',
        confirmColor: '#D64045',
        success: (r) => resolve(!!r.confirm)
      })
    })
    if (!ok) return
    this.setData({ ending: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: { action: 'forceEnd', sessionId: id }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        wx.showToast({ title: formatCloudFnError(result, result.msg || '结束失败'), icon: 'none' })
        return
      }
      wx.showToast({ title: '已结束', icon: 'success' })
      writeLiveSnapshot(result.session, { status: 'ended', configured: this.data.configured, enabled: this.data.enabled })
      await this.loadLiveDash({ preferFresh: true })
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e, '结束失败'), icon: 'none' })
    } finally {
      this.setData({ ending: false })
    }
  }
})
