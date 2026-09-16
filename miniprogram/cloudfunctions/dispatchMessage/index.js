/**
 * 山海有信 — 统一消息分发
 *
 * 鉴权：小程序客户端直调须店员及以上；云函数嵌套 / 定时触发放行。
 */
const cloud = require('wx-server-sdk')
const { dispatch, DEFAULT_TEMPLATES, resolveMessageQueue } = require('./core')
const { assertStaff, ROLE_STAFF } = require('./staffGuard')
const { isClientSource } = require('./sourceOrigin')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()


exports.main = async (event) => {
  const { action = 'dispatch' } = event
  const wxContext = cloud.getWXContext()

  if (isClientSource()) {
    const openid = wxContext.OPENID || ''
    const guard = await assertStaff(db, openid, { role: ROLE_STAFF })
    if (!guard.ok) {
      return { success: false, code: guard.code, msg: guard.msg || '无权限' }
    }
  }

  if (action === 'seedTemplates') {
    // 写 message_templates 属配置变更：必须持 adminOpsKey 或为店员，
    // 不能仅凭「非客户端来源」放行
    const opsKey = process.env.ADMIN_OPS_KEY || ''
    const given = String((event && event.adminOpsKey) || '')
    const viaOps = !!(opsKey && given && given === opsKey)
    if (!viaOps) {
      const guard = await assertStaff(db, wxContext.OPENID || '', { role: ROLE_STAFF })
      if (!guard.ok) return { success: false, code: guard.code || 'FORBIDDEN', msg: '无权维护消息模板' }
    }
    return seedTemplates(event || {})
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
      queue,
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
        queue,
        campaignId
      })
    } catch (err) {
      console.error('dispatchMessage error:', err)
      return { success: false, msg: err.message || '发送失败' }
    }
  }

  return { success: false, msg: '未知 action' }
}

async function seedTemplates(event = {}) {
  const codes = Object.keys(DEFAULT_TEMPLATES)
  const syncSet = new Set()
  const rawSync = event.syncCodes || event.forceUpdateCodes
  if (Array.isArray(rawSync)) {
    rawSync.forEach((c) => {
      if (c) syncSet.add(String(c))
    })
  } else if (event.forceUpdate === true) {
    codes.forEach((c) => syncSet.add(c))
  }

  let inserted = 0
  let skipped = 0
  let updated = 0
  for (const templateCode of codes) {
    const def = DEFAULT_TEMPLATES[templateCode]
    try {
      const exist = await db.collection('message_templates').where({ templateCode }).limit(1).get()
      if (exist.data && exist.data.length) {
        if (syncSet.has(templateCode)) {
          await db.collection('message_templates').doc(exist.data[0]._id).update({
            data: {
              category: def.category,
              queue: resolveMessageQueue({
                queue: def.queue,
                category: def.category,
                eventType: templateCode
              }),
              priority: def.priority || 'P1',
              titleTemplate: def.titleTemplate,
              contentTemplate: def.contentTemplate,
              actionUrlTemplate: def.actionUrlTemplate || '',
              enabled: true,
              updatedAt: db.serverDate()
            }
          })
          updated += 1
        } else {
          skipped += 1
        }
        continue
      }
      await db.collection('message_templates').add({
        data: {
          templateCode,
          category: def.category,
          queue: resolveMessageQueue({
            queue: def.queue,
            category: def.category,
            eventType: templateCode
          }),
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
  return { success: true, inserted, updated, skipped, total: codes.length }
}
