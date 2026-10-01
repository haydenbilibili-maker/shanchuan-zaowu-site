/**
 * 工作台「工单 → 伴宠」页面方法：需补充 / 填写报价 / 直接承接 / 拒绝。
 *
 * 由 managerPageConfig 以 `...createPetMemorialActions({ callStoreContent })` 混入。
 * 四个操作都先写工单（manageStoreContent.update，与改前同一条写路径），写成功后再经山海有信通知顾客：
 * 通知失败不回滚工单，页面提示「已处理，通知发送失败」，失败原因推进工单的 notifyFailures。
 */
const {
  NEED_INFO_MAX,
  DECLINE_REASON_MAX,
  NEED_INFO_QUICK_ITEMS,
  DECLINE_QUICK_REASONS,
  PET_STATUS_DECLINED,
  REVIEW_STATUSES,
  DECLINABLE_STATUSES,
  charLen,
  validateNote,
  mergeQuickPick,
  acceptNextStep,
  buildPetNotice,
  notifyFailureEntry
} = require('../utils/petMemorialNotice')
const { formatQuoteAmount } = require('../utils/petMemorialHelper')

const SHEETS = {
  need_info: {
    title: '需要顾客补充什么',
    placeholder: '写清楚要补充的资料，会原样发给顾客',
    hint: '会通过山海有信发给顾客，请用大白话',
    confirmText: '发给顾客',
    max: NEED_INFO_MAX,
    chips: NEED_INFO_QUICK_ITEMS
  },
  decline: {
    title: '拒绝这张工单',
    placeholder: '写下拒绝理由，会原样发给顾客',
    hint: '理由会通过山海有信发给顾客，请用大白话、语气温和',
    confirmText: '确认拒绝',
    max: DECLINE_REASON_MAX,
    chips: DECLINE_QUICK_REASONS
  }
}

const EMPTY_SHEET = { show: false, mode: '', orderId: '', text: '', len: 0, error: '', busy: false }

function createPetMemorialActions({ callStoreContent }) {
  return {
    findPetOrder(id) {
      return (this.data.petMemorialOrders || []).find((o) => o._id === id) || null
    },

    /**
     * 山海有信送达顾客；返回 { ok, reason }，从不抛错。
     * 失败时把原因推进工单 notifyFailures（留痕失败也不影响结果）。
     */
    async sendPetNotice(op, order, extra) {
      let notice = null
      let reason = ''
      try {
        notice = buildPetNotice(op, order, extra)
        if (!order || !order._openid) {
          reason = '工单缺少顾客身份，无法投递'
        } else {
          const res = await wx.cloud.callFunction({
            name: 'dispatchMessage',
            data: {
              action: 'dispatch',
              eventType: notice.eventType,
              openid: order._openid,
              relatedId: order._id,
              title: notice.title,
              content: notice.content,
              actionUrl: notice.actionUrl,
              category: notice.category,
              skipDedupe: notice.skipDedupe
            }
          })
          const r = (res && res.result) || {}
          if (r.success) return { ok: true, reason: '', skipped: !!r.skipped }
          reason = r.msg || r.code || '山海有信未返回成功'
        }
      } catch (err) {
        reason = (err && (err.errMsg || err.message)) || '调用山海有信失败'
      }
      console.warn('[pet notice] 发送失败', op, order && order._id, reason)
      if (order && order._id) {
        try {
          await callStoreContent({
            action: 'update',
            collection: 'pet_memorial_orders',
            id: order._id,
            data: {},
            pushFields: { notifyFailures: [notifyFailureEntry(op, notice && notice.eventType, reason)] }
          })
        } catch (e) {
          console.warn('[pet notice] 失败留痕未写入', e && e.message)
        }
      }
      return { ok: false, reason }
    },

    reportPetDone(doneText, notice) {
      if (notice && notice.ok) this.showHubTip(`${doneText}，已通知顾客`, 'info')
      else this.showHubTip('已处理，通知发送失败', 'warn')
    },

    openPetSheet(e) {
      const { id, mode } = e.currentTarget.dataset
      const conf = SHEETS[mode]
      const order = this.findPetOrder(id)
      if (!conf || !order) return this.showHubTip('工单信息缺失，请下拉刷新', 'warn')
      const allowed = mode === 'decline' ? DECLINABLE_STATUSES : REVIEW_STATUSES
      if (allowed.indexOf(order.status) === -1) return this.showHubTip('工单状态已变化，请下拉刷新', 'warn')
      this.setData({
        petSheet: {
          ...EMPTY_SHEET,
          ...conf,
          show: true,
          mode,
          orderId: id,
          orderNo: order.orderNo || '',
          petName: (order.pet && order.pet.name) || '伴宠'
        }
      })
    },

    closePetSheet() {
      if (this.data.petSheet && this.data.petSheet.busy) return
      this.setData({ petSheet: { ...EMPTY_SHEET } })
    },

    onPetSheetInput(e) {
      const text = e.detail.value || ''
      this.setData({ 'petSheet.text': text, 'petSheet.len': charLen(text), 'petSheet.error': '' })
    },

    pickPetSheetChip(e) {
      const sheet = this.data.petSheet || {}
      const text = mergeQuickPick(sheet.text, e.currentTarget.dataset.text, sheet.max)
      this.setData({ 'petSheet.text': text, 'petSheet.len': charLen(text), 'petSheet.error': '' })
    },

    async submitPetSheet() {
      const sheet = this.data.petSheet || {}
      if (sheet.busy || !sheet.show) return
      const check = validateNote(sheet.mode, sheet.text)
      if (!check.ok) {
        this.setData({ 'petSheet.error': check.msg })
        return
      }
      const order = this.findPetOrder(sheet.orderId)
      if (!order) return this.showHubTip('工单信息缺失，请下拉刷新', 'warn')
      const isDecline = sheet.mode === 'decline'
      const status = isDecline ? PET_STATUS_DECLINED : 'need_info'
      const nowIso = new Date().toISOString()
      this.setData({ 'petSheet.busy': true })
      try {
        await callStoreContent({
          action: 'update',
          collection: 'pet_memorial_orders',
          id: order._id,
          data: isDecline
            ? { status, decline: { reason: check.value, declinedAt: nowIso }, updateTime: Date.now() }
            : { status, needInfo: { note: check.value, requestedAt: nowIso }, updateTime: Date.now() },
          pushFields: {
            productionLog: [{ status, time: nowIso, note: isDecline ? `已婉拒：${check.value}` : `需补充：${check.value}` }]
          }
        })
      } catch (err) {
        this.setData({ 'petSheet.busy': false })
        return this.showHubTip(isDecline ? '拒绝失败，请稍后重试' : '保存失败，请稍后重试', 'warn')
      }
      const notice = await this.sendPetNotice(isDecline ? 'declined' : 'need_info', order, isDecline ? { reason: check.value } : { note: check.value })
      this.setData({ petSheet: { ...EMPTY_SHEET } })
      this.reportPetDone(isDecline ? '已拒绝' : '已请顾客补充', notice)
      this.loadPetMemorialOrders()
    },

    async confirmPetAccept(e) {
      const order = this.findPetOrder(e.currentTarget.dataset.id)
      if (!order) return this.showHubTip('工单信息缺失，请下拉刷新', 'warn')
      if (REVIEW_STATUSES.indexOf(order.status) === -1) return this.showHubTip('工单状态已变化，请下拉刷新', 'warn')
      const host = this.selectComponent && this.selectComponent('#appModal')
      if (host && typeof host.open === 'function') {
        const res = await host.open({
          overline: 'ACCEPT',
          title: '跳过报价，直接承接？',
          content: `将通知顾客下一步：\n${acceptNextStep(order)}`,
          confirmText: '确认承接'
        })
        if (!res || !res.confirm) return
      }
      const nowIso = new Date().toISOString()
      try {
        await callStoreContent({
          action: 'update',
          collection: 'pet_memorial_orders',
          id: order._id,
          data: { status: 'accepted', updateTime: Date.now() },
          pushFields: { productionLog: [{ status: 'accepted', time: nowIso, note: '已确认承接' }] }
        })
      } catch (err) {
        return this.showHubTip('承接失败，请稍后重试', 'warn')
      }
      const notice = await this.sendPetNotice('accepted', order, {})
      this.reportPetDone('已承接', notice)
      this.loadPetMemorialOrders()
    },

    async submitPetQuote() {
      const { orderId, amount, note, validUntil } = this.data.tempPetQuote || {}
      if (!orderId || !amount) {
        this.showHubTip('请填写报价金额', 'warn')
        return
      }
      const num = parseFloat(amount)
      if (Number.isNaN(num) || num <= 0) {
        this.showHubTip('金额无效', 'warn')
        return
      }
      const order = this.findPetOrder(orderId)
      const amountText = formatQuoteAmount(num)
      const quoteNote = (note || '').trim()
      try {
        await callStoreContent({
          action: 'update',
          collection: 'pet_memorial_orders',
          id: orderId,
          data: {
            status: 'quoted',
            quote: { amount: num, note: quoteNote, quotedAt: new Date().toISOString(), validUntil: validUntil || '' },
            updateTime: Date.now()
          },
          pushFields: {
            productionLog: [{ status: 'quoted', time: new Date().toISOString(), note: `报价 ${amountText}${quoteNote ? ' · ' + quoteNote : ''}` }]
          }
        })
      } catch (err) {
        this.showHubTip('保存失败', 'warn')
        return
      }
      this.setData({ showPetQuoteModal: false })
      const notice = await this.sendPetNotice('quoted', order || { _id: orderId }, { amountText, quoteNote, validUntil })
      this.reportPetDone('报价已发送', notice)
      this.loadPetMemorialOrders()
    }
  }
}

module.exports = { createPetMemorialActions }
