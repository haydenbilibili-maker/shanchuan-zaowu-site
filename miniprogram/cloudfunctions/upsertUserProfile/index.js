const cloud = require('wx-server-sdk')
const { calcProfileScore, sanitizeUser } = require('./profileUtil')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const PROFILE_REWARD_POINTS = 50
const PROFILE_REWARD_GROWTH = 20

const ALLOWED_FIELDS = [
  'nickName', 'avatarUrl', 'gender', 'birthday', 'interests',
  'mbti', 'zodiac', 'bio', 'privacy', 'onboardingDone', 'onboardingStep', 'agreedTermsAt'
]

function pickPatch(raw) {
  const patch = {}
  ALLOWED_FIELDS.forEach((key) => {
    if (raw[key] !== undefined) patch[key] = raw[key]
  })
  return patch
}

function normalizeBirthday(birthday) {
  if (!birthday) return { birthday: '', birthdayMonthDay: '' }
  const parts = String(birthday).split('-')
  if (parts.length >= 3) {
    const mm = parts[1].padStart(2, '0')
    const dd = parts[2].padStart(2, '0')
    return { birthday: `${parts[0]}-${mm}-${dd}`, birthdayMonthDay: `${mm}-${dd}` }
  }
  return { birthday: birthday, birthdayMonthDay: '' }
}

async function claimProfileReward(openid, userDoc) {
  if (!userDoc || userDoc.profileRewardClaimed || !userDoc.onboardingDone) {
    return { claimed: false }
  }

  await db.collection('users').doc(userDoc._id).update({
    data: {
      profileRewardClaimed: true,
      bonusPoints: _.inc(PROFILE_REWARD_POINTS + PROFILE_REWARD_GROWTH)
    }
  })

  try {
    await cloud.callFunction({
      name: 'dispatchMessage',
      data: {
        action: 'dispatch',
        eventType: 'system_notice',
        openid,
        title: '藏家档案已建立',
        content: `欢迎加入山海造物。完善资料奖励 ${PROFILE_REWARD_POINTS} 积分已到账，愿你的标本被好好安放。`,
        actionUrl: '/pages/user/profile/index'
      }
    })
  } catch (e) {
    console.warn('profile reward message', e)
  }

  return { claimed: true, points: PROFILE_REWARD_POINTS, growthBonus: PROFILE_REWARD_GROWTH }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  if (!openid) return { success: false, msg: '未登录' }

  const { patch = {}, completeOnboarding = false } = event || {}
  const data = pickPatch(patch)

  if (data.birthday !== undefined) {
    Object.assign(data, normalizeBirthday(data.birthday))
  }

  if (Array.isArray(data.interests)) {
    data.interests = data.interests.slice(0, 5)
  }

  if (completeOnboarding) {
    data.onboardingDone = true
    data.onboardingDoneAt = db.serverDate()
  }

  data.updateTime = db.serverDate()

  try {
    const userRes = await db.collection('users').where({ _openid: openid }).limit(1).get()
    let userDoc = userRes.data && userRes.data[0] ? userRes.data[0] : null
    let reward = { claimed: false }

    if (userDoc) {
      const merged = { ...userDoc, ...data }
      data.profileScore = calcProfileScore(merged)
      await db.collection('users').doc(userDoc._id).update({ data })
      userDoc = { ...merged, ...data }
    } else {
      const createData = {
        ...data,
        _openid: openid,
        bonusPoints: 0,
        usedPoints: 0,
        profileRewardClaimed: false,
        registerSource: 'wechat_mp',
        registerTime: db.serverDate(),
        createTime: db.serverDate()
      }
      createData.profileScore = calcProfileScore(createData)
      const addRes = await db.collection('users').add({ data: createData })
      userDoc = { ...createData, _id: addRes._id }
    }

    if (completeOnboarding && !userDoc.profileRewardClaimed) {
      reward = await claimProfileReward(openid, userDoc)
    }

    return {
      success: true,
      user: sanitizeUser(userDoc, openid),
      profileScore: calcProfileScore(userDoc),
      reward
    }
  } catch (e) {
    console.error('upsertUserProfile', e)
    return { success: false, msg: e.message || '保存失败' }
  }
}
