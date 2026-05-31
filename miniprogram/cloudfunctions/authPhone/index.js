const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { code } = event || {}

  if (!openid) return { success: false, msg: '未登录' }
  if (!code) return { success: false, msg: '缺少授权码' }

  try {
    const phoneRes = await cloud.openapi.phonenumber.getPhoneNumber({ code })
    const phoneInfo = phoneRes.phoneInfo || phoneRes
    const phone = phoneInfo.purePhoneNumber || phoneInfo.phoneNumber

    if (!phone) return { success: false, msg: '未能获取手机号' }

    const exist = await db.collection('users').where({ phone }).limit(1).get()
    if (exist.data && exist.data.length > 0 && exist.data[0]._openid !== openid) {
      return { success: false, msg: '该手机号已绑定其他账号，请联系专员' }
    }

    const selfRes = await db.collection('users').where({ _openid: openid }).limit(1).get()
    const payload = {
      phone,
      phoneVerifiedAt: db.serverDate(),
      updateTime: db.serverDate()
    }

    if (selfRes.data && selfRes.data.length > 0) {
      await db.collection('users').doc(selfRes.data[0]._id).update({ data: payload })
    } else {
      await db.collection('users').add({
        data: {
          ...payload,
          _openid: openid,
          nickName: '藏家',
          bonusPoints: 0,
          usedPoints: 0,
          profileRewardClaimed: false,
          registerSource: 'wechat_mp',
          registerTime: db.serverDate(),
          createTime: db.serverDate()
        }
      })
    }

    return { success: true, phoneMasked: phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') }
  } catch (e) {
    console.error('authPhone', e)
    return { success: false, msg: e.message || '绑定失败' }
  }
}
