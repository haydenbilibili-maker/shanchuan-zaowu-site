const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function genShareToken() {
  return `sh${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

exports.main = async (event) => {
  const { action } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (action === 'getShare') {
    const { shareToken, draftId } = event
    if (!shareToken && !draftId) {
      return { success: false, msg: '缺少分享参数' }
    }
    try {
      let doc = null
      if (draftId) {
        const res = await db.collection('custom_drafts').doc(draftId).get()
        doc = res.data
      } else {
        const res = await db.collection('custom_drafts')
          .where({ shareToken, shareEnabled: true })
          .limit(1)
          .get()
        doc = res.data[0]
      }
      if (!doc) return { success: false, msg: '方案不存在或已失效' }
      return {
        success: true,
        draft: {
          _id: doc._id,
          title: doc.title,
          customMeta: doc.customMeta,
          shareToken: doc.shareToken,
          updateTime: doc.updateTime
        }
      }
    } catch (e) {
      return { success: false, msg: e.message }
    }
  }

  if (!openid) return { success: false, msg: '未登录' }

  if (action === 'list') {
    try {
      const res = await db.collection('custom_drafts')
        .where({ _openid: openid })
        .orderBy('updateTime', 'desc')
        .limit(20)
        .get()
      return { success: true, list: res.data }
    } catch (e) {
      return { success: false, msg: e.message, list: [] }
    }
  }

  if (action === 'get') {
    const { draftId } = event
    if (!draftId) return { success: false, msg: '缺少 draftId' }
    try {
      const res = await db.collection('custom_drafts').doc(draftId).get()
      const doc = res.data
      if (!doc || doc._openid !== openid) {
        return { success: false, msg: '无权访问' }
      }
      return { success: true, draft: doc }
    } catch (e) {
      return { success: false, msg: e.message }
    }
  }

  if (action === 'save') {
    const { draftId, title, payload, customMeta, forShare } = event
    if (!payload || !customMeta) {
      return { success: false, msg: '数据不完整' }
    }
    const now = db.serverDate()
    const data = {
      title: title || '我的定制方案',
      payload,
      customMeta,
      updateTime: now
    }
    if (forShare) {
      data.shareEnabled = true
      data.shareToken = genShareToken()
    }
    try {
      if (draftId) {
        const existing = await db.collection('custom_drafts').doc(draftId).get()
        if (!existing.data || existing.data._openid !== openid) {
          return { success: false, msg: '无权修改' }
        }
        if (!forShare && existing.data.shareToken) {
          data.shareToken = existing.data.shareToken
          data.shareEnabled = existing.data.shareEnabled
        }
        await db.collection('custom_drafts').doc(draftId).update({ data })
        const updated = await db.collection('custom_drafts').doc(draftId).get()
        return { success: true, draftId, shareToken: updated.data.shareToken || '' }
      }
      data._openid = openid
      data.createTime = now
      if (!forShare) {
        data.shareEnabled = false
        data.shareToken = ''
      }
      const addRes = await db.collection('custom_drafts').add({ data })
      const newDoc = await db.collection('custom_drafts').doc(addRes._id).get()
      return {
        success: true,
        draftId: addRes._id,
        shareToken: newDoc.data.shareToken || ''
      }
    } catch (e) {
      return { success: false, msg: e.message }
    }
  }

  if (action === 'delete') {
    const { draftId } = event
    if (!draftId) return { success: false, msg: '缺少 draftId' }
    try {
      const res = await db.collection('custom_drafts').doc(draftId).get()
      if (!res.data || res.data._openid !== openid) {
        return { success: false, msg: '无权删除' }
      }
      await db.collection('custom_drafts').doc(draftId).remove()
      return { success: true }
    } catch (e) {
      return { success: false, msg: e.message }
    }
  }

  return { success: false, msg: '未知 action' }
}
