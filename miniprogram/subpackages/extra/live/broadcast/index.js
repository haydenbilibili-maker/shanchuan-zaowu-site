const { getWindowInfo } = require('../../../../utils/systemInfo')
const { guardLiveHostWorkspace } = require('../../utils/staffAuth')
const { formatCloudFnError } = require('../../utils/memberScan')
const { batchTempFileURLs, getFirstImage } = require('../../../../utils/util')
const { writeLiveSnapshot, decorateShelfList } = require('../sessionSync')

function detectSimulator() {
  try {
    const info = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()
    const platform = String((info && info.platform) || '').toLowerCase()
    return platform === 'devtools'
  } catch (e) {
    return false
  }
}

function mapPusherCode(code) {
  const map = {
    1001: { hint: '已连接推流服务器', level: 'ok' },
    1002: { hint: '已连接，开始推流', level: 'ok' },
    1003: { hint: '打开摄像头成功', level: 'ok' },
    1004: { hint: '录屏启动成功', level: 'ok' },
    1005: { hint: '推流动态调整分辨率', level: 'ok' },
    1006: { hint: '已填入推流地址', level: 'ok' },
    1007: { hint: '推流中', level: 'ok' },
    1008: { hint: '编码器启动', level: 'ok' },
    1018: { hint: '首帧画面采集完成', level: 'ok' },
    1019: { hint: '首帧音频采集完成', level: 'ok' },
    1101: { hint: '网络状况不佳', level: 'warn' },
    1102: { hint: '网络断连，自动重连中…', level: 'warn', retry: true, autoRetry: true },
    1103: { hint: '网络强抖，建议换 Wi-Fi', level: 'warn' },
    3001: { hint: 'RTMP DNS 解析失败', level: 'err', retry: true },
    3002: { hint: 'RTMP 服务器连接失败', level: 'err', retry: true, autoRetry: true },
    3003: { hint: 'RTMP 握手失败', level: 'err', retry: true },
    3004: { hint: 'RTMP 服务器主动断开', level: 'err', retry: true, autoRetry: true },
    3005: { hint: 'RTMP 读/写失败', level: 'err', retry: true, autoRetry: true },
    '-1301': { hint: '打开摄像头失败，请检查权限', level: 'err' },
    '-1302': { hint: '打开麦克风失败，请检查权限', level: 'err' },
    '-1303': { hint: '视频编码失败', level: 'err', retry: true },
    '-1304': { hint: '音频编码失败', level: 'err', retry: true },
    '-1305': { hint: '不支持的视频分辨率', level: 'err' },
    '-1306': { hint: '不支持的音频采样率', level: 'err' },
    '-1307': { hint: '网络断连，多次重连无效', level: 'err', retry: true, autoRetry: true },
    '-1308': { hint: '开始录屏失败', level: 'err' },
    '-1309': { hint: '麦克风录制失败', level: 'err' },
    '-1310': { hint: '音频未接通', level: 'warn' },
    '-1311': { hint: '录屏被系统中断', level: 'err', retry: true }
  }
  return map[String(code)] || null
}

function statusMeta(session, configured, pushing) {
  if (!session) {
    return { label: '暂无场次', tone: '' }
  }
  if (session.status === 'live') {
    if (pushing && session.pushUrl) {
      return { label: '直播中', tone: 'live' }
    }
    if (!configured || !session.pushUrl) {
      return { label: '异常残留（请结束）', tone: 'warn' }
    }
    return { label: '直播中', tone: 'live' }
  }
  if (session.status === 'idle') return { label: '待开播', tone: '' }
  if (session.status === 'ended') return { label: '已结束', tone: '' }
  return { label: session.status || '未知', tone: '' }
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function splitScheduled(ts) {
  const n = Number(ts) || 0
  if (!n) return { date: '', time: '', label: '' }
  const d = new Date(n)
  if (Number.isNaN(d.getTime())) return { date: '', time: '', label: '' }
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  return { date, time, label: `${date} ${time}` }
}

function combineScheduled(dateStr, timeStr) {
  const d = String(dateStr || '').trim()
  const t = String(timeStr || '').trim() || '20:00'
  if (!d) return null
  const ms = Date.parse(`${d}T${t}:00`)
  return Number.isNaN(ms) ? null : ms
}

Page({
  data: {
    scrollHeight: 667,
    title: '山海造物 · 馆内直播',
    notice: '',
    coverUrl: '',
    coverLocal: '',
    scheduleDate: '',
    scheduleTime: '',
    scheduleLabel: '',
    busy: false,
    pushing: false,
    pushUrl: '',
    session: null,
    active: null,
    configured: false,
    enabled: true,
    dashboardMsg: '',
    sessionStatusLabel: '暂无场次',
    sessionStatusTone: '',
    isSimulator: false,
    beautyOn: false,
    torchOn: false,
    devicePosition: 'front',
    pusherHint: '本地预览',
    bitrateLabel: '',
    connLevel: '',
    needsRetry: false,
    viewerCount: 0,
    likeCount: 0,
    messages: [],
    shelfItems: [],
    shelfCount: 0,
    spotlightProductId: '',
    showShelfPicker: false,
    productKeyword: '',
    productCandidates: [],
    productLoading: false,
    shelfBusy: false,
    liveStats: {
      likeCount: 0,
      messageCount: 0,
      joinCount: 0,
      peakViewers: 0,
      reminderCount: 0
    },
    dashboardLoading: true,
    dashboardLoadError: ''
  },

  async onLoad(options) {
    const win = getWindowInfo()
    const windowHeight = win.windowHeight || win.screenHeight || 667
    this.setData({
      scrollHeight: windowHeight,
      isSimulator: detectSimulator()
    })
    this._focusShelf = String((options && options.focus) || '') === 'shelf'

    const role = await guardLiveHostWorkspace()
    if (!role) return
    await this.loadDashboard()
    if (this._focusShelf && this.data.session) {
      this.openShelfPicker()
    }
  },

  onPullDownRefresh() {
    this.loadDashboard().finally(() => wx.stopPullDownRefresh())
  },

  onShow() {
    if (this._booted) this.loadDashboard({ soft: true })
    this._booted = true
    this.startHostPoll()
  },

  onHide() {
    this.stopHostPoll()
  },

  onUnload() {
    this.stopHostPoll()
  },

  startHostPoll() {
    this.stopHostPoll()
    this._hostPoll = setInterval(() => {
      if (!this.data.pushing || !this.data.session || !this.data.session._id) return
      this.refreshLiveStats()
      this.loadHostMessages()
    }, 8000)
  },

  stopHostPoll() {
    if (this._hostPoll) {
      clearInterval(this._hostPoll)
      this._hostPoll = null
    }
  },

  onTitleInput(e) {
    this.setData({ title: (e.detail && e.detail.value) || '' })
  },

  onNoticeInput(e) {
    this.setData({ notice: (e.detail && e.detail.value) || '' })
  },

  onScheduleDate(e) {
    const scheduleDate = (e.detail && e.detail.value) || ''
    const scheduleLabel = splitScheduled(combineScheduled(scheduleDate, this.data.scheduleTime)).label
    this.setData({ scheduleDate, scheduleLabel })
  },

  onScheduleTime(e) {
    const scheduleTime = (e.detail && e.detail.value) || ''
    const scheduleLabel = splitScheduled(combineScheduled(this.data.scheduleDate, scheduleTime)).label
    this.setData({ scheduleTime, scheduleLabel })
  },

  clearSchedule() {
    this.setData({ scheduleDate: '', scheduleTime: '', scheduleLabel: '' })
  },

  toggleBeauty() {
    this.setData({ beautyOn: !this.data.beautyOn })
  },

  async chooseCover() {
    try {
      const choose = await new Promise((resolve, reject) => {
        const fail = (err) => reject(err || new Error('cancel'))
        if (typeof wx.chooseMedia === 'function') {
          wx.chooseMedia({
            count: 1,
            mediaType: ['image'],
            sourceType: ['album', 'camera'],
            success: resolve,
            fail
          })
        } else {
          wx.chooseImage({
            count: 1,
            sizeType: ['compressed'],
            sourceType: ['album', 'camera'],
            success: (r) => resolve({ tempFiles: [{ tempFilePath: r.tempFilePaths[0] }] }),
            fail
          })
        }
      })
      const filePath = choose.tempFiles && choose.tempFiles[0] && choose.tempFiles[0].tempFilePath
      if (!filePath) return
      this.setData({ coverLocal: filePath, busy: true })
      wx.showLoading({ title: '上传封面…', mask: true })
      const cloudPath = `live/covers/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`
      const up = await wx.cloud.uploadFile({ cloudPath, filePath })
      const coverUrl = (up && up.fileID) || ''
      this.setData({ coverUrl, coverLocal: filePath })
      if (this.data.session && this.data.session._id) {
        await wx.cloud.callFunction({
          name: 'manageLiveSession',
          data: {
            action: 'updateMeta',
            sessionId: this.data.session._id,
            coverUrl
          }
        })
      }
      wx.showToast({ title: '封面已就绪', icon: 'success' })
    } catch (e) {
      if (e && e.errMsg && /cancel/i.test(e.errMsg)) return
      wx.showToast({ title: '封面上传失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ busy: false })
    }
  },

  clearCover() {
    this.setData({ coverUrl: '', coverLocal: '' })
  },

  applySessionFields(session) {
    if (!session) return {}
    const sched = splitScheduled(session.scheduledAt)
    const shelf = (session.shelf && session.shelf.items) || []
    return {
      title: session.title || this.data.title,
      notice: session.notice || '',
      coverUrl: session.coverUrl || this.data.coverUrl || '',
      scheduleDate: sched.date || this.data.scheduleDate,
      scheduleTime: sched.time || this.data.scheduleTime,
      scheduleLabel: sched.label || session.scheduledLabel || '',
      viewerCount: Math.max(0, Number(session.viewerCount) || 0),
      likeCount: Math.max(0, Number(session.likeCount) || 0),
      shelfItems: shelf,
      shelfCount: shelf.length,
      spotlightProductId: (session.shelf && session.shelf.spotlightProductId) || session.spotlightProductId || '',
      liveStats: session.stats || {
        likeCount: Math.max(0, Number(session.likeCount) || 0),
        messageCount: 0,
        joinCount: 0,
        peakViewers: Math.max(0, Number(session.viewerCount) || 0),
        reminderCount: 0
      }
    }
  },

  async hydrateShelfCovers(items) {
    const list = Array.isArray(items) ? items.slice() : []
    const urlMap = await batchTempFileURLs(list.map((i) => i && i.cover))
    return list.map((i) => {
      if (!i) return i
      const https = i.cover && urlMap[i.cover]
      return https ? { ...i, cover: https } : i
    })
  },

  async syncShelfFromSession(session) {
    if (!session) {
      this.setData({ shelfItems: [], shelfCount: 0, spotlightProductId: '' })
      return
    }
    const raw = (session.shelf && session.shelf.items) || []
    const hydrated = await this.hydrateShelfCovers(raw)
    const shelfItems = decorateShelfList(hydrated)
    this.setData({
      shelfItems,
      shelfCount: shelfItems.length,
      spotlightProductId: (session.shelf && session.shelf.spotlightProductId) || session.spotlightProductId || ''
    })
    writeLiveSnapshot(session, {
      configured: this.data.configured,
      enabled: this.data.enabled,
      viewerCount: this.data.viewerCount,
      likeCount: this.data.likeCount,
      shelfCount: shelfItems.length
    })
  },

  async loadDashboard(opts) {
    if (!(opts && opts.soft)) {
      this.setData({ dashboardLoading: true, dashboardLoadError: '' })
    }
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: { action: 'getDashboard' }
      })
      const result = (res && res.result) || {}
      if (result.success === false) {
        throw new Error(result.msg || '加载失败')
      }
      const session = result.mine || null
      const configured = !!result.configured
      const pushing = !!(session && session.status === 'live' && session.pushUrl && configured)
      const meta = statusMeta(session, configured, pushing)
      const fields = this.applySessionFields(session)
      const patch = {
        session,
        active: result.active || null,
        configured,
        enabled: result.enabled === true,
        dashboardMsg: result.msg || '',
        sessionStatusLabel: meta.label,
        sessionStatusTone: meta.tone,
        ...fields,
        pushing,
        pushUrl: (session && session.pushUrl) || '',
        pusherHint: pushing ? '推流中' : (this.data.isSimulator ? '模拟器无法预览' : '本地预览'),
        connLevel: pushing ? 'ok' : '',
        needsRetry: false
      }
      if (!(opts && opts.soft && this.data.pushing && !pushing)) {
        this.setData({
          ...patch,
          dashboardLoading: false,
          dashboardLoadError: ''
        })
        await this.syncShelfFromSession(session)
      } else {
        this.setData({
          active: patch.active,
          configured: patch.configured,
          enabled: patch.enabled,
          dashboardMsg: patch.dashboardMsg,
          sessionStatusLabel: patch.sessionStatusLabel,
          sessionStatusTone: patch.sessionStatusTone,
          session: patch.session,
          viewerCount: patch.viewerCount,
          likeCount: patch.likeCount
        })
        await this.syncShelfFromSession(patch.session)
      }
      if (pushing && session && session._id) {
        this.loadHostMessages()
      }
    } catch (e) {
      console.warn('getDashboard', e)
      if (!(opts && opts.soft)) {
        this.setData({
          dashboardLoading: false,
          dashboardLoadError: formatCloudFnError(e, '场次状态加载失败'),
          dashboardMsg: formatCloudFnError(e, '场次状态加载失败')
        })
      }
    }
  },

  goCreateSessionHint() {
    wx.navigateBack({
      fail: () => {
        wx.redirectTo({ url: '/subpackages/extra/live/studio/index' })
      }
    })
  },

  async refreshLiveStats() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: { action: 'getDashboard' }
      })
      const result = (res && res.result) || {}
      const session = result.mine || result.active || null
      if (!session) return
      this.setData({
        viewerCount: Math.max(0, Number(session.viewerCount) || 0),
        likeCount: Math.max(0, Number(session.likeCount) || 0),
        liveStats: session.stats || this.data.liveStats,
        session: this.data.session
          ? { ...this.data.session, viewerCount: session.viewerCount, likeCount: session.likeCount, stats: session.stats }
          : this.data.session
      })
      await this.syncShelfFromSession(session)
    } catch (e) { /* ignore */ }
  },

  async loadHostMessages() {
    const id = this.data.session && this.data.session._id
    if (!id) return
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: { action: 'listMessages', sessionId: id }
      })
      const result = (res && res.result) || {}
      this.setData({ messages: Array.isArray(result.list) ? result.list.slice(-20) : [] })
    } catch (e) { /* ignore */ }
  },

  async ensureMediaAuth() {
    if (this.data.isSimulator) return true
    const tryAuth = async (scope) => {
      try {
        await wx.authorize({ scope })
        return true
      } catch (e) {
        return false
      }
    }
    const cam = await tryAuth('scope.camera')
    const mic = await tryAuth('scope.record')
    if (!cam || !mic) {
      const go = await new Promise((resolve) => {
        wx.showModal({
          title: '需要摄像头与麦克风',
          content: '开播需授权摄像头和麦克风，请在设置中开启。',
          confirmText: '去设置',
          success: (r) => resolve(!!r.confirm)
        })
      })
      if (go) wx.openSetting({})
      return false
    }
    return true
  },

  async startLive() {
    if (this.data.busy) return
    if (!this.data.configured) {
      wx.showModal({
        title: '暂未配置推流',
        content: '请在云函数 manageLiveSession 配置 LIVE_PUSH_DOMAIN / LIVE_PLAY_DOMAIN / LIVE_AUTH_KEY。详见 docs/live-streaming.md。',
        showCancel: false
      })
      return
    }
    if (this.data.active && this.data.active._id &&
      !(this.data.session && this.data.session._id === this.data.active._id)) {
      wx.showModal({
        title: '无法同时开第二场',
        content: `「${this.data.active.title || '直播'}」进行中（主播 ${this.data.active.hostName || '同事'}）。请先结束该场。`,
        showCancel: false
      })
      return
    }

    this.setData({ busy: true })
    try {
      const ok = await this.ensureMediaAuth()
      if (!ok) return

      const scheduledAt = combineScheduled(this.data.scheduleDate, this.data.scheduleTime)
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: {
          action: 'start',
          title: this.data.title,
          notice: this.data.notice,
          coverUrl: this.data.coverUrl || '',
          scheduledAt
        }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        if (result.code === 'LIVE_BUSY') {
          wx.showModal({
            title: '无法同时开第二场',
            content: result.msg || '已有进行中的直播',
            showCancel: false
          })
          await this.loadDashboard()
          return
        }
        if (result.code === 'NOT_CONFIGURED') {
          wx.showModal({
            title: '暂未配置推流',
            content: result.msg || '请配置 LIVE_* 环境变量',
            showCancel: false
          })
          this.setData({ configured: false })
          return
        }
        wx.showToast({ title: result.msg || '开播失败', icon: 'none', duration: 2500 })
        return
      }

      const session = result.session || {}
      if (!session.pushUrl) {
        wx.showModal({
          title: '无法推流',
          content: '未拿到 pushUrl，请检查域名与鉴权 Key。',
          showCancel: false
        })
        return
      }

      this.setData({
        session,
        configured: true,
        pushing: true,
        pushUrl: session.pushUrl,
        title: session.title || this.data.title,
        notice: session.notice || this.data.notice,
        coverUrl: session.coverUrl || this.data.coverUrl,
        sessionStatusLabel: '直播中',
        sessionStatusTone: 'live',
        pusherHint: this.data.isSimulator ? '模拟器无法真实推流' : '正在推流…',
        connLevel: 'ok',
        needsRetry: false,
        bitrateLabel: '',
        viewerCount: Math.max(0, Number(session.viewerCount) || 0),
        likeCount: Math.max(0, Number(session.likeCount) || 0)
      })
      this._autoRetried = false
      this.startHostPoll()
      this.loadHostMessages()
      await this.syncShelfFromSession(session)
      writeLiveSnapshot(session, { configured: true, enabled: this.data.enabled, status: 'live' })
      const rn = result.remindNotify || {}
      if (rn.attempted > 0) {
        wx.showToast({
          title: rn.hasTemplate
            ? `已开播 · 提醒触达 ${rn.sent || 0}/${rn.attempted}`
            : `已开播 · 已标记提醒 ${rn.attempted} 人（模板未配）`,
          icon: 'none',
          duration: 2600
        })
      } else {
        wx.showToast({ title: '已开播', icon: 'success' })
      }
    } catch (e) {
      console.error('startLive', e)
      wx.showToast({ title: '开播失败，请稍后重试', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  async saveNotice() {
    if (!this.data.session || !this.data.session._id) {
      wx.showToast({ title: '请先开播', icon: 'none' })
      return
    }
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: {
          action: 'updateNotice',
          sessionId: this.data.session._id,
          notice: this.data.notice
        }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        wx.showToast({ title: result.msg || '公告更新失败', icon: 'none' })
        return
      }
      wx.showToast({ title: '公告已同步', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: '公告更新失败', icon: 'none' })
    }
  },

  async saveSchedule() {
    const scheduledAt = combineScheduled(this.data.scheduleDate, this.data.scheduleTime)
    if (!this.data.session || !this.data.session._id) {
      this.setData({ scheduleLabel: splitScheduled(scheduledAt).label })
      wx.showToast({ title: scheduledAt ? '预约已记在本页，开播时一并提交' : '已清空预约', icon: 'none' })
      return
    }
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: {
          action: 'updateMeta',
          sessionId: this.data.session._id,
          scheduledAt,
          coverUrl: this.data.coverUrl || undefined
        }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        wx.showToast({ title: result.msg || '保存失败', icon: 'none' })
        return
      }
      const fields = this.applySessionFields(result.session)
      this.setData({ ...fields, session: result.session })
      wx.showToast({ title: '预约已保存', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  },

  async forceEndActive() {
    if (this.data.busy) return
    const target = this.data.active || this.data.session
    if (!target || !target._id) {
      wx.showToast({ title: '没有可结束场次', icon: 'none' })
      return
    }
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '强制结束直播？',
        content: `将结束「${target.title || '当前场次'}」，观众端会同步变为已结束。`,
        confirmColor: '#D64045',
        success: (r) => resolve(!!r.confirm)
      })
    })
    if (!ok) return
    this.setData({ busy: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: { action: 'forceEnd', sessionId: target._id }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        wx.showToast({ title: result.msg || '结束失败', icon: 'none' })
        return
      }
      try {
        const ctx = wx.createLivePusherContext('livePusher', this)
        if (ctx && ctx.stop) ctx.stop()
      } catch (e) { /* ignore */ }
      this.setData({
        pushing: false,
        pushUrl: '',
        session: null,
        active: null,
        sessionStatusLabel: '暂无场次',
        sessionStatusTone: '',
        torchOn: false,
        bitrateLabel: '',
        messages: [],
        viewerCount: 0
      })
      wx.showToast({ title: '已结束', icon: 'success' })
      writeLiveSnapshot(result.session, { status: 'ended', configured: this.data.configured, enabled: this.data.enabled })
      await this.loadDashboard()
    } catch (e) {
      wx.showToast({ title: '结束失败', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  async endLive() {
    if (this.data.busy) return
    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: '结束直播？',
        content: '结束后观众将无法继续观看，本场推流地址会清空。确定结束吗？',
        confirmColor: '#D64045',
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false)
      })
    })
    if (!confirm) return

    this.setData({ busy: true })
    try {
      const sessionId = this.data.session && this.data.session._id
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: { action: 'end', sessionId }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        wx.showToast({ title: result.msg || '结束失败', icon: 'none' })
        return
      }
      try {
        const ctx = wx.createLivePusherContext('livePusher', this)
        if (ctx && ctx.stop) ctx.stop()
      } catch (e) { /* ignore */ }
      this.setData({
        pushing: false,
        pushUrl: '',
        session: null,
        sessionStatusLabel: '暂无场次',
        sessionStatusTone: '',
        pusherHint: '本地预览',
        connLevel: '',
        needsRetry: false,
        torchOn: false,
        bitrateLabel: '',
        messages: [],
        viewerCount: 0
      })
      wx.showToast({ title: '已结束', icon: 'success' })
      writeLiveSnapshot(result.session, { status: 'ended', configured: this.data.configured, enabled: this.data.enabled })
      await this.loadDashboard()
    } catch (e) {
      wx.showToast({ title: '结束失败', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  switchCamera() {
    try {
      const ctx = wx.createLivePusherContext('livePusher', this)
      if (ctx && ctx.switchCamera) {
        ctx.switchCamera({
          success: () => {
            const next = this.data.devicePosition === 'front' ? 'back' : 'front'
            this.setData({
              devicePosition: next,
              torchOn: false
            })
          }
        })
      }
    } catch (e) {
      wx.showToast({ title: '无法翻转镜头', icon: 'none' })
    }
  },

  toggleTorch() {
    if (this.data.devicePosition === 'front') {
      wx.showToast({ title: '请先翻到后置摄像头', icon: 'none' })
      return
    }
    try {
      const ctx = wx.createLivePusherContext('livePusher', this)
      if (ctx && ctx.toggleTorch) {
        ctx.toggleTorch({
          success: () => this.setData({ torchOn: !this.data.torchOn }),
          fail: () => wx.showToast({ title: '当前设备不支持手电筒', icon: 'none' })
        })
      } else {
        wx.showToast({ title: '当前基础库不支持手电筒', icon: 'none' })
      }
    } catch (e) {
      wx.showToast({ title: '无法开关手电筒', icon: 'none' })
    }
  },

  retryPush() {
    if (!this.data.pushing || !this.data.pushUrl) return
    try {
      const ctx = wx.createLivePusherContext('livePusher', this)
      if (ctx && ctx.start) {
        ctx.start({
          success: () => this.setData({ pusherHint: '已重新开始推流', connLevel: 'ok', needsRetry: false }),
          fail: () => this.setData({ pusherHint: '重试失败，请检查网络与域名', connLevel: 'err', needsRetry: true })
        })
      }
    } catch (e) {
      this.setData({ pusherHint: '重试失败', connLevel: 'err', needsRetry: true })
    }
  },

  onPusherState(e) {
    const code = e && e.detail && e.detail.code
    const mapped = mapPusherCode(code)
    if (!mapped) return
    this.setData({
      pusherHint: mapped.hint,
      connLevel: mapped.level || '',
      needsRetry: !!mapped.retry && this.data.pushing
    })
    if (mapped.autoRetry && this.data.pushing && !this._autoRetried) {
      this._autoRetried = true
      setTimeout(() => this.retryPush(), 1200)
    }
    if (mapped.level === 'ok' && (code === 1007 || code === 1002)) {
      this._autoRetried = false
    }
  },

  onPusherError(e) {
    const detail = (e && e.detail) || {}
    const errMsg = detail.errMsg || detail.message || ''
    console.warn('live-pusher error', detail)
    this.setData({
      pusherHint: errMsg ? `推流异常：${errMsg}` : '推流异常：请确认摄像头权限、推流域名与鉴权',
      connLevel: 'err',
      needsRetry: this.data.pushing
    })
  },

  onNetStatus(e) {
    const info = (e && e.detail && e.detail.info) || (e && e.detail) || {}
    const videoBitrate = Number(info.videoBitrate || info.videoBitRate || 0)
    const audioBitrate = Number(info.audioBitrate || info.audioBitRate || 0)
    const netSpeed = Number(info.netSpeed || 0)
    const fps = Number(info.videoFPS || info.fps || 0)
    if (!videoBitrate && !netSpeed) return
    const parts = []
    if (videoBitrate) parts.push(`视频 ${Math.round(videoBitrate)}kbps`)
    if (audioBitrate) parts.push(`音频 ${Math.round(audioBitrate)}kbps`)
    if (netSpeed) parts.push(`网速 ${Math.round(netSpeed)}kbps`)
    if (fps) parts.push(`${Math.round(fps)}fps`)
    const bitrateLabel = parts.join(' · ')
    const now = Date.now()
    if (this._lastBitrateAt && now - this._lastBitrateAt < 1800) return
    this._lastBitrateAt = now
    this.setData({ bitrateLabel })
  },

  openShelfPicker() {
    this.setData({ showShelfPicker: true })
    this.searchProducts()
  },

  closeShelfPicker() {
    this.setData({ showShelfPicker: false })
  },

  onProductKeyword(e) {
    this.setData({ productKeyword: ((e.detail && e.detail.value) || '').slice(0, 40) })
  },

  async searchProducts() {
    this.setData({ productLoading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageProducts',
        data: {
          action: 'list',
          page: 1,
          pageSize: 30,
          keyword: this.data.productKeyword || '',
          sortBy: 'new'
        }
      })
      const result = (res && res.result) || {}
      const list = Array.isArray(result.list) ? result.list : []
      const shelfSet = new Set((this.data.shelfItems || []).map((i) => i && i._id))
      const mapped = list.map((p) => ({
        _id: p._id,
        title: p.title || '未命名',
        price: p.price,
        cover: getFirstImage(p.images),
        onShelf: p.isOffShelf !== true,
        already: shelfSet.has(p._id)
      }))
      const urlMap = await batchTempFileURLs(mapped.map((i) => i.cover))
      const productCandidates = mapped.map((i) => ({
        ...i,
        cover: (i.cover && urlMap[i.cover]) || i.cover
      }))
      this.setData({ productCandidates })
    } catch (e) {
      wx.showToast({ title: '藏品列表加载失败', icon: 'none' })
    } finally {
      this.setData({ productLoading: false })
    }
  },

  async ensureSessionForShelf() {
    if (this.data.session && this.data.session._id) return this.data.session._id
    // 未开播也可先建 idle 场次挂品：走 start 太重；用 create
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: {
          action: 'create',
          title: this.data.title,
          notice: this.data.notice,
          coverUrl: this.data.coverUrl || ''
        }
      })
      const result = (res && res.result) || {}
      if (!result.success && !result.session) {
        wx.showToast({ title: result.msg || '无法创建场次', icon: 'none' })
        return ''
      }
      const session = result.session
      this.setData({ session })
      await this.syncShelfFromSession(session)
      return session && session._id
    } catch (e) {
      wx.showToast({ title: '无法创建场次', icon: 'none' })
      return ''
    }
  },

  async addShelfProduct(e) {
    if (this.data.shelfBusy) return
    const id = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id
    if (!id) return
    if ((this.data.shelfItems || []).length >= 20) {
      wx.showToast({ title: '挂车最多 20 件', icon: 'none' })
      return
    }
    this.setData({ shelfBusy: true })
    try {
      const sessionId = await this.ensureSessionForShelf()
      if (!sessionId) return
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: { action: 'updateShelf', sessionId, add: [id] }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        wx.showToast({ title: result.msg || '挂品失败', icon: 'none' })
        return
      }
      this.setData({ session: result.session })
      await this.syncShelfFromSession(result.session)
      wx.showToast({ title: '已挂上车', icon: 'success' })
      this.searchProducts()
    } catch (err) {
      wx.showToast({ title: '挂品失败', icon: 'none' })
    } finally {
      this.setData({ shelfBusy: false })
    }
  },

  async removeShelfProduct(e) {
    if (this.data.shelfBusy) return
    const id = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id
    if (!id || !this.data.session || !this.data.session._id) return
    this.setData({ shelfBusy: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: {
          action: 'updateShelf',
          sessionId: this.data.session._id,
          remove: [id]
        }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        wx.showToast({ title: result.msg || '下架失败', icon: 'none' })
        return
      }
      this.setData({ session: result.session })
      await this.syncShelfFromSession(result.session)
    } catch (err) {
      wx.showToast({ title: '下架失败', icon: 'none' })
    } finally {
      this.setData({ shelfBusy: false })
    }
  },

  async setSpotlightProduct(e) {
    if (this.data.shelfBusy) return
    const id = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id
    if (!this.data.session || !this.data.session._id) return
    const clear = !id || id === this.data.spotlightProductId
    this.setData({ shelfBusy: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: {
          action: 'setSpotlight',
          sessionId: this.data.session._id,
          productId: clear ? '' : id,
          clear
        }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        wx.showToast({ title: result.msg || '设置失败', icon: 'none' })
        return
      }
      this.setData({ session: result.session })
      await this.syncShelfFromSession(result.session)
      wx.showToast({ title: clear ? '已取消讲解中' : '已标为讲解中', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: '设置失败', icon: 'none' })
    } finally {
      this.setData({ shelfBusy: false })
    }
  },

  /** 快速切换讲解中：下一项 / 上一项 */
  async cycleSpotlight(e) {
    const dir = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.dir) || 'next'
    const items = this.data.shelfItems || []
    if (!items.length || !this.data.session || !this.data.session._id) {
      wx.showToast({ title: '请先挂品', icon: 'none' })
      return
    }
    const cur = this.data.spotlightProductId
    let idx = items.findIndex((i) => i && i._id === cur)
    if (dir === 'prev') {
      idx = idx <= 0 ? items.length - 1 : idx - 1
    } else {
      idx = idx < 0 || idx >= items.length - 1 ? 0 : idx + 1
    }
    const nextId = items[idx] && items[idx]._id
    if (!nextId) return
    this.setData({ shelfBusy: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: {
          action: 'setSpotlight',
          sessionId: this.data.session._id,
          productId: nextId
        }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        wx.showToast({ title: result.msg || '切换失败', icon: 'none' })
        return
      }
      this.setData({ session: result.session })
      await this.syncShelfFromSession(result.session)
    } catch (err) {
      wx.showToast({ title: '切换失败', icon: 'none' })
    } finally {
      this.setData({ shelfBusy: false })
    }
  },

  async moveShelfProduct(e) {
    if (this.data.shelfBusy) return
    const id = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id
    const dir = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.dir
    if (!id || !this.data.session || !this.data.session._id) return
    this.setData({ shelfBusy: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: {
          action: 'updateShelf',
          sessionId: this.data.session._id,
          move: { productId: id, dir }
        }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        wx.showToast({ title: result.msg || '排序失败', icon: 'none' })
        return
      }
      this.setData({ session: result.session })
      await this.syncShelfFromSession(result.session)
    } catch (err) {
      wx.showToast({ title: '排序失败', icon: 'none' })
    } finally {
      this.setData({ shelfBusy: false })
    }
  },

  async clearShelf() {
    if (this.data.shelfBusy || !this.data.session || !this.data.session._id) return
    if (!(this.data.shelfItems || []).length) return
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '清空本场挂车？',
        content: '观众端挂车会同步清空。',
        confirmColor: '#D64045',
        success: (r) => resolve(!!r.confirm)
      })
    })
    if (!ok) return
    this.setData({ shelfBusy: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: { action: 'updateShelf', sessionId: this.data.session._id, clear: true }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        wx.showToast({ title: result.msg || '清空失败', icon: 'none' })
        return
      }
      this.setData({ session: result.session })
      await this.syncShelfFromSession(result.session)
    } catch (err) {
      wx.showToast({ title: '清空失败', icon: 'none' })
    } finally {
      this.setData({ shelfBusy: false })
    }
  }
})
