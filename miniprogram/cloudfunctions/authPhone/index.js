const cloud = require('wx-server-sdk')
const { dispatchInAppMessage } = require('./inAppMessage')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const EVENT_HONORARY_GRANTED = 'honorary_curator_granted'

/**
 * 永久去重：dispatchMessage 仅 24h 窗口，荣誉馆长需按 grantId 终身防重。
 */
async function alreadyNotifiedHonorary(openid, grantId) {
  if (!openid || !grantId) return false
  try {
    const userRes = await db.collection('users').where({ _openid: openid }).limit(1).get()
    const user = userRes.data && userRes.data[0]
    if (user && user.honoraryNotifiedGrantId === grantId) return true
  } catch (e) {
    // ignore
  }
  try {
    const dedupeKey = `${EVENT_HONORARY_GRANTED}:${grantId}:${openid}`
    const dup = await db.collection('user_messages').where({ dedupeKey }).limit(1).get()
    if (dup.data && dup.data.length) return true
  } catch (e) {
    // ignore
  }
  return false
}

async function markHonoraryNotified(openid, grantId, userDocId) {
  if (!openid || !grantId) return
  try {
    let docId = userDocId
    if (!docId) {
      const userRes = await db.collection('users').where({ _openid: openid }).limit(1).get()
      const user = userRes.data && userRes.data[0]
      docId = user && user._id
    }
    if (!docId) return
    await db.collection('users').doc(docId).update({
      data: { honoraryNotifiedGrantId: grantId }
    })
  } catch (e) {
    console.warn('markHonoraryNotified failed:', e.message)
  }
}

/**
 * 授予时尚未绑号 → 绑号同步 isHonorary 时补发山海有信（与 manageHonoraryCurators 共用 grantId）。
 */
async function maybeNotifyHonoraryOnBind(openid, roster, userDocId) {
  if (!openid || !roster) return
  const grantId = roster.grantId || roster._id
  if (!grantId) return
  try {
    if (await alreadyNotifiedHonorary(openid, grantId)) return
    const res = await dispatchInAppMessage(db, {
      eventType: EVENT_HONORARY_GRANTED,
      openid,
      relatedId: grantId,
      vars: {}
    })
    if (res && res.success) {
      await markHonoraryNotified(openid, grantId, userDocId)
      const notified = Array.isArray(roster.notifiedOpenids) ? roster.notifiedOpenids.slice() : []
      if (notified.indexOf(openid) === -1) notified.push(openid)
      if (roster._id) {
        try {
          await db.collection('honorary_curators').doc(roster._id).update({
            data: { notifiedOpenids: notified }
          })
        } catch (e) {
          console.warn('notifiedOpenids update failed:', e.message)
        }
      }
    }
  } catch (e) {
    console.warn('authPhone honorary notify skipped:', e.message)
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const {
    code,
    finishRegistration = false,
    patch = {}
  } = event || {}

  if (!openid) return { success: false, msg: '未登录' }
  if (!code) return { success: false, msg: '缺少授权码' }

  try {
    const phoneRes = await cloud.openapi.phonenumber.getPhoneNumber({ code })
    const phoneInfo = phoneRes.phoneInfo || phoneRes
    const phone = phoneInfo.purePhoneNumber || phoneInfo.phoneNumber

    if (!phone) return { success: false, msg: '未能获取手机号' }

    const normalizedPhone = String(phone || '').replace(/\D/g, '')
    if (!/^1\d{10}$/.test(normalizedPhone)) {
      return { success: false, msg: '手机号格式无效' }
    }

    const exist = await db.collection('users').where({ phone: normalizedPhone }).limit(1).get()
    if (exist.data && exist.data.length > 0 && exist.data[0]._openid !== openid) {
      return { success: false, msg: '该手机号已绑定其他账号，请联系专员' }
    }

    // 荣誉馆长名单以手机号为键；绑定/换绑手机号时同步 users.isHonorary（Lv99）
    let isHonorary = false
    let honoraryRoster = null
    try {
      const honoraryRes = await db.collection('honorary_curators')
        .where({ phone: normalizedPhone, status: 'active' })
        .limit(1)
        .get()
      honoraryRoster = (honoraryRes.data && honoraryRes.data[0]) || null
      isHonorary = !!honoraryRoster
    } catch (e) {
      console.warn('authPhone honorary lookup skipped:', e.message)
    }

    const selfRes = await db.collection('users').where({ _openid: openid }).limit(1).get()
    // 2026-09-17：这个函数**本来就分新老**（add 建号 / update 补手机号），但此前不告诉调用方，
    // 于是注册页只能靠猜 → 老用户会被承诺新客礼。现在如实回传，供文案与完成页分支使用。
    const isNewUser = !(selfRes.data && selfRes.data.length > 0)
    const existingNickName = isNewUser ? '' : String((selfRes.data[0] || {}).nickName || '').trim()
    const payload = {
      phone: normalizedPhone,
      phoneVerifiedAt: db.serverDate(),
      updateTime: db.serverDate(),
      isHonorary,
      honoraryUpdatedAt: db.serverDate()
    }
    // 若不在名单，清除通知标记，避免残留
    if (!isHonorary) payload.honoraryNotifiedGrantId = ''

    let userDocId = ''
    if (selfRes.data && selfRes.data.length > 0) {
      userDocId = selfRes.data[0]._id
      await db.collection('users').doc(userDocId).update({ data: payload })
    } else {
      const added = await db.collection('users').add({
        data: {
          ...payload,
          _openid: openid,
          nickName: '藏家',
          bonusPoints: 0,
          usedPoints: 0,
          profileRewardClaimed: false,
          registerGiftClaimed: false,
          registerSource: 'wechat_mp',
          registerTime: db.serverDate(),
          createTime: db.serverDate()
        }
      })
      userDocId = added._id
    }

    if (isHonorary && honoraryRoster) {
      await maybeNotifyHonoraryOnBind(openid, honoraryRoster, userDocId)
    }

    const phoneMasked = normalizedPhone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')

    // 注册主路径：绑号后同请求完成建档 + 幂等发新客礼（减少客户端二次 loading）
    if (finishRegistration) {
      try {
        const finishRes = await cloud.callFunction({
          name: 'upsertUserProfile',
          data: {
            patch: patch && typeof patch === 'object' ? patch : {},
            completeOnboarding: true
          }
        })
        const finished = finishRes.result || {}
        if (!finished.success) {
          return {
            success: true,
            phoneMasked,
            finished: false,
            finishError: finished.msg || '建档发券未完成',
            registerGift: { error: true, msg: finished.msg || '建档发券未完成' }
          }
        }
        return {
          success: true,
          phoneMasked,
          isNewUser,
          existingNickName,
          finished: true,
          user: finished.user || null,
          registerGift: finished.registerGift || {},
          reward: finished.reward || {}
        }
      } catch (finishErr) {
        console.error('authPhone finishRegistration', finishErr)
        return {
          success: true,
          phoneMasked,
          isNewUser,
          existingNickName,
          finished: false,
          finishError: finishErr.message || '建档发券异常',
          registerGift: { error: true, msg: '礼包稍后可在「我的」补领' }
        }
      }
    }

    return { success: true, phoneMasked, isNewUser, existingNickName, finished: false }
  } catch (e) {
    console.error('authPhone', e)
    return { success: false, msg: e.message || '绑定失败' }
  }
}
