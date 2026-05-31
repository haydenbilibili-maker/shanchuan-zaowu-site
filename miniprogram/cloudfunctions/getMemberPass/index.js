const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const { buildMemberNo } = require('./profileUtil')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const TTL_MS = 60 * 1000

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  if (!openid) return { success: false, msg: '未登录' }

  try {
    const token = crypto.randomBytes(16).toString('hex')
    const expiresAt = new Date(Date.now() + TTL_MS)

    await db.collection('member_pass_tokens').add({
      data: {
        openid,
        token,
        memberNo: buildMemberNo(openid),
        expiresAt,
        createdAt: db.serverDate()
      }
    })

    const qrPayload = JSON.stringify({
      v: 1,
      token,
      memberNo: buildMemberNo(openid)
    })

    return {
      success: true,
      token,
      memberNo: buildMemberNo(openid),
      qrPayload,
      expiresIn: 60,
      expiresAt: expiresAt.getTime()
    }
  } catch (e) {
    console.error('getMemberPass', e)
    return { success: false, msg: e.message || '会员码生成失败' }
  }
}
