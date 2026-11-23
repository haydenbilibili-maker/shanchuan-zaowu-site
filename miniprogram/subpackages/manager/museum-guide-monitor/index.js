/**
 * 超管工作台「博物君」（2026-11-23，产品负责人点名「在超管工作台新增对应的功能开关和数据报表监测」）
 *
 * - 开关：开馆 / 闭馆（闭馆后「我的」宫格入口隐藏、页面收起输入条、云函数拒答）；两步确认，不弹原生框。
 * - 每日额度：每人每天可问几次（10 / 20 / 30 / 50 / 100 或回到默认）。
 * - 监测：近 7 / 30 天按日提问数与人数、成功率、耗时、失败分布、热门物种、推荐去处、入口、模型。
 *   只统计次数与状态，**没有问题与回答原文**。
 *
 * 门禁：磁贴仅超管可见；页内 guardStaffPage('super_admin')；云函数 museumGuideMonitor requireSuperAdmin 再执法；改设置先留审计。
 * 反馈一律走页内提示条（不新增原生弹窗）；界面不出现集合名 / 字段名。
 */
const { guardStaffPage } = require('../utils/staffAuth')
const V = require('./monitorView')

const FN = 'museumGuideMonitor'

Page({
  data: {
    ready: false,
    loading: false,
    saving: false,
    days: 7,
    view: null,
    loadError: '',
    tipText: '',
    tipTone: 'info',
    confirmToggle: false,
    limitOptions: V.DAILY_LIMIT_OPTIONS
  },

  async onLoad() {
    const role = await guardStaffPage('super_admin')
    if (!role) return
    this.setData({ ready: true })
    this.load()
  },

  onPullDownRefresh() {
    if (!this.data.ready) { wx.stopPullDownRefresh(); return }
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  onUnload() {
    clearTimeout(this._tipTimer)
    clearTimeout(this._confirmTimer)
  },

  callFn(data) {
    return wx.cloud.callFunction({ name: FN, data }).then((res) => {
      const body = (res && res.result) || {}
      if (body.success === false) { const e = new Error(body.msg || '请求失败'); e.business = true; throw e }
      return body.data
    })
  },

  showTip(text, tone = 'info') {
    this.setData({ tipText: text, tipTone: tone })
    clearTimeout(this._tipTimer)
    this._tipTimer = setTimeout(() => this.setData({ tipText: '' }), 3200)
  },

  async load() {
    this.setData({ loading: true, loadError: '' })
    try {
      const d = await this.callFn({ action: 'overview', days: this.data.days })
      this.setData({ view: V.buildView(d), loading: false })
    } catch (e) {
      this.setData({ loading: false, loadError: V.friendlyError(e) })
    }
  },

  onDays(e) {
    const days = Number(e.currentTarget.dataset.days) === 30 ? 30 : 7
    if (days === this.data.days) return
    this.setData({ days })
    this.load()
  },

  /** 开关：第一下只亮出「再点一次确认」，3 秒内再点才真的改 */
  onToggle() {
    if (this.data.saving || !this.data.view) return
    if (!this.data.confirmToggle) {
      this.setData({ confirmToggle: true })
      clearTimeout(this._confirmTimer)
      this._confirmTimer = setTimeout(() => this.setData({ confirmToggle: false }), 3000)
      return
    }
    clearTimeout(this._confirmTimer)
    this.saveConfig({ enabled: !this.data.view.config.enabled })
  },

  onLimit(e) {
    const n = Number(e.currentTarget.dataset.n)
    if (!n || this.data.saving || (this.data.view && this.data.view.config.dailyLimit === n)) return
    this.saveConfig({ dailyLimit: n })
  },

  async saveConfig(patch) {
    this.setData({ saving: true, confirmToggle: false })
    try {
      const cfg = await this.callFn(Object.assign({ action: 'setConfig' }, patch))
      const view = Object.assign({}, this.data.view, { config: V.buildView({ config: cfg }).config })
      this.setData({ view, saving: false })
      if (patch.enabled === false) this.showTip('已闭馆：「我的」里的入口会在下次刷新时隐藏，正在用的人提问会收到闭馆提示', 'warn')
      else if (patch.enabled === true) this.showTip('已开馆')
      else this.showTip(`每日额度已改为 ${patch.dailyLimit} 问`)
    } catch (e) {
      this.setData({ saving: false })
      this.showTip(`没有改成：${(e && e.message) || e}`, 'warn')
    }
  }
})
