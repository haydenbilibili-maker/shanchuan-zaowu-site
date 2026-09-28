/**
 * 飞书同步（超管工作台）
 *
 * 产品负责人 2026-09-19：「在超管工作台新增飞书信息同步，支持飞书信息与小程序信息同步，
 * 如目前的工作室仪表盘数据仍然是老数据没有保持更新」。
 *
 * ## 这个页为什么必须存在（而不是在 ERP 里点点就行）
 *
 * 在此之前飞书的**读取与字段映射只在 ERP 前端**（浏览器读飞书 → 前端映射 → 调云函数写库），
 * 四个云函数里一个飞书凭据都没有。后果是**仪表盘会一直显示老数据，除非有人正好打开 ERP 点一下**。
 * 本轮把「读飞书 → 映射 → 写库」搬到服务端云函数 `syncFeishuData`，于是：
 *   · 这个页面（手动触发）与 ERP 的同步中心**走同一条服务端路径**；
 *   · 还能按天自动同步（页面上有开关，**默认关**）。
 *
 * ## 两条硬约束（与出货开单页一致）
 *
 * ① **不在客户端算/改数据**：本页只把「同步哪个目标」发给云函数，读飞书、映射、写库全在服务端。
 * ② **不用原生弹窗**：`check:dialog-ratchet` 冻结了 `wx.showToast`/`showModal` 数量（只许降），
 *    反馈一律走页内提示条 `tipText`。
 *
 * 门禁：磁贴仅超管可见；页内 `guardStaffPage('super_admin')`；云函数 `requireSuper` 再执法。
 */
const { guardStaffPage } = require('../utils/staffAuth')
const { formatCloudFnError } = require('../utils/memberScan')

const FN = 'syncFeishuData'

Page({
  data: {
    ready: false,
    loading: true,
    loadError: '',
    busy: '',
    tipTone: 'info',
    tipText: '',
    creds: { configured: false, hasAppId: false, hasAppSecret: false },
    autoSync: false,
    lastRun: null,
    lastRunText: '',
    targets: []
  },

  async onLoad() {
    const role = await guardStaffPage('super_admin')
    if (!role) return
    this.setData({ ready: true })
    await this.refresh()
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },

  callFn(data) {
    return wx.cloud
      .callFunction({ name: FN, data })
      .then((res) => {
        const body = (res && res.result) || {}
        if (body.success === false) throw new Error(body.msg || '请求失败')
        return body
      })
  },

  formatLastRun(lastRun) {
    if (!lastRun) return ''
    const by = lastRun.by === 'timer' ? '定时触发' : '手动触发'
    const ok = Number(lastRun.okCount) || 0
    const fail = Number(lastRun.failCount) || 0
    const failPart = fail ? `，失败 ${fail} 项` : ''
    let when = ''
    const ts = Number(lastRun.at || lastRun.finishedAt || lastRun.startedAt) || 0
    if (ts) {
      const d = new Date(ts)
      if (!Number.isNaN(d.getTime())) {
        const pad = (x) => (x < 10 ? `0${x}` : String(x))
        when = ` · ${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
      }
    }
    return `${by} · 成功 ${ok} 项${failPart}${when}`
  },

  refresh() {
    this.setData({ loading: true, loadError: '', tipText: '' })
    return this.callFn({ action: 'status' })
      .then((r) => {
        const lastRun = r.lastRun || null
        this.setData({
          loading: false,
          loadError: '',
          creds: r.creds || { configured: false },
          autoSync: r.autoSync === true,
          lastRun,
          lastRunText: this.formatLastRun(lastRun),
          targets: (r.targets || []).map((t) =>
            Object.assign({}, t, {
              summary: this.summarize(t),
              sumTone: this.summaryTone(t)
            })
          )
        })
      })
      .catch((e) => {
        this.setData({
          loading: false,
          loadError: formatCloudFnError(e, '读取同步状态失败'),
          tipTone: 'warn',
          tipText: ''
        })
      })
  },

  /**
   * 用「飞书有多少 / 本地有多少」直接说清"数据新不新"。
   * 本地为 -1 表示**集合根本不存在**（区别于 0 条 = 同步过但为空）—— 这两种情况的处置完全不同。
   */
  summarize(t) {
    if (t.localCount === -1) return '本地还没有这张表（首次同步会新建）'
    if (t.remoteCount === null || t.remoteCount === undefined) {
      return t.remoteError ? '飞书读取失败：' + t.remoteError : '未读取飞书'
    }
    if (t.localCount === 0 && t.remoteCount > 0) {
      return '飞书有 ' + t.remoteCount + ' 条，本地 0 条 —— 从没同步过'
    }
    if (t.localCount !== t.remoteCount) {
      return '本地 ' + t.localCount + ' 条 / 飞书 ' + t.remoteCount + ' 条（不一致）'
    }
    return '本地 ' + t.localCount + ' 条，与飞书一致'
  },

  summaryTone(t) {
    if (t.localCount === -1) return 'warn'
    if (t.remoteCount === null || t.remoteCount === undefined) return t.remoteError ? 'danger' : 'muted'
    if (t.localCount === 0 && t.remoteCount > 0) return 'danger'
    if (t.localCount !== t.remoteCount) return 'warn'
    return 'ok'
  },

  onSyncAll() {
    this.runSync([], '全部')
  },

  onSyncOne(e) {
    const role = String(e.currentTarget.dataset.role || '')
    const t = (this.data.targets || []).find((x) => x.role === role)
    this.runSync([role], (t && t.label) || role)
  },

  runSync(targets, label) {
    if (this.data.busy || this.data.loading) return
    if (!this.data.creds.configured) {
      this.setData({
        tipTone: 'warn',
        tipText: '飞书凭据未配置到云函数，同步无法执行'
      })
      return
    }
    this.setData({ busy: label, tipTone: 'info', tipText: '正在同步' + label + '…' })
    this.callFn({ action: 'pull', targets })
      .then((r) => {
        const results = r.results || {}
        const lines = Object.keys(results).map((k) => {
          const x = results[k] || {}
          const t = (this.data.targets || []).find((y) => y.role === k)
          const name = (t && t.label) || k
          return x.success === false
            ? name + '：失败（' + (x.msg || '') + '）'
            : name + '：' + (x.msg || '完成')
        })
        this.setData({
          busy: '',
          tipTone: r.failCount ? 'warn' : 'info',
          tipText: lines.join('；') || '没有可同步的目标'
        })
        return this.refresh()
      })
      .catch((e) => {
        this.setData({ busy: '', tipTone: 'warn', tipText: formatCloudFnError(e, '同步失败') })
      })
  },

  onToggleAutoSync(e) {
    if (this.data.busy) return
    const autoSync = !!(e.detail && e.detail.value)
    this.setData({
      busy: 'config',
      tipTone: 'info',
      tipText: autoSync ? '正在开启自动同步…' : '正在关闭自动同步…'
    })
    this.callFn({ action: 'config.save', autoSync })
      .then((r) => {
        this.setData({
          busy: '',
          autoSync: !!(r.config && r.config.autoSync),
          tipTone: 'info',
          tipText: (r.msg || '已保存') + '（定时任务每天 03:30 跑一次）'
        })
      })
      .catch((err) => {
        // 失败时把开关拨回服务端真值（再 refresh 一次更稳）
        this.setData({ busy: '', tipTone: 'warn', tipText: formatCloudFnError(err, '保存失败') })
        return this.refresh()
      })
  }
})
