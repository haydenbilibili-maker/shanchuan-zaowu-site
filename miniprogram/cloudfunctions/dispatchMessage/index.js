/**
 * 山海有信 — 统一消息分发
 */
const cloud = require('wx-server-sdk')
const { dispatch, DEFAULT_TEMPLATES } = require('./core')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { action = 'dispatch' } = event

  if (action === 'seedTemplates') {
    return seedTemplates()
  }

  if (action === 'dispatch') {
    const {
      eventType,
      openid,
      relatedId,
      vars,
      skipDedupe,
      title,
      content,
      actionUrl,
      category,
      campaignId
    } = event

    try {
      return await dispatch(db, {
        eventType: eventType || event.templateCode || event.type,
        openid,
        relatedId,
        vars,
        skipDedupe,
        title,
        content,
        actionUrl,
        category,
        campaignId
      })
    } catch (err) {
      console.error('dispatchMessage error:', err)
      return { success: false, msg: err.message || '发送失败' }
    }
  }

  return { success: false, msg: '未知 action' }
}

async function seedTemplates() {
  const codes = Object.keys(DEFAULT_TEMPLATES)
  let inserted = 0
  let skipped = 0
  for (const templateCode of codes) {
    const def = DEFAULT_TEMPLATES[templateCode]
    try {
      const exist = await db.collection('message_templates').where({ templateCode }).limit(1).get()
      if (exist.data && exist.data.length) {
        skipped += 1
        continue
      }
      await db.collection('message_templates').add({
        data: {
          templateCode,
          category: def.category,
          priority: def.priority || 'P1',
          titleTemplate: def.titleTemplate,
          contentTemplate: def.contentTemplate,
          actionUrlTemplate: def.actionUrlTemplate || '',
          enabled: true,
          updatedAt: db.serverDate()
        }
      })
      inserted += 1
    } catch (e) {
      console.warn('seed template failed:', templateCode, e.message)
    }
  }
  return { success: true, inserted, skipped, total: codes.length }
}
