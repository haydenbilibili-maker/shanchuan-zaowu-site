function isCloudFileId(url) {
  return url && (String(url).startsWith('cloud://') || String(url).startsWith('wxfile://'))
}

function calcProfileScore(user) {
  if (!user) return 0
  let score = 0
  if (user.avatarUrl && isCloudFileId(user.avatarUrl)) score += 15
  else if (user.avatarUrl) score += 8
  if (user.nickName && user.nickName !== '未登录用户' && user.nickName !== '藏家') score += 10
  if (user.phone) score += 25
  if (user.birthday) score += 15
  if (Array.isArray(user.interests) && user.interests.length > 0) score += 15
  if (user.gender) score += 5
  if (user.mbti) score += 8
  if (user.zodiac) score += 7
  return Math.min(100, score)
}

function resolveAuthState(user) {
  if (!user || !user.nickName) return 'guest'
  if (!user.onboardingDone && calcProfileScore(user) < 25) return 'guest'
  if (!user.phone) return 'registered'
  if (calcProfileScore(user) >= 60) return 'enriched'
  return 'verified_phone'
}

function buildMemberNo(openid) {
  if (!openid || openid.length < 8) return 'MT-0000-0000'
  const shortId = openid.substr(openid.length - 8).toUpperCase()
  return `MT-${shortId.substr(0, 4)}-${shortId.substr(4, 4)}`
}

function maskPhone(phone) {
  if (!phone || phone.length < 7) return ''
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
}

function sanitizeUser(user, openid) {
  if (!user) return null
  return {
    _id: user._id,
    nickName: user.nickName || '',
    avatarUrl: user.avatarUrl || '',
    phone: user.phone || '',
    phoneMasked: maskPhone(user.phone || ''),
    gender: user.gender || '',
    birthday: user.birthday || '',
    interests: user.interests || [],
    mbti: user.mbti || '',
    zodiac: user.zodiac || '',
    bio: user.bio || '',
    sensitiveBlurPref: user.sensitiveBlurPref === 'clear' || user.sensitiveDisplay === 'show' || user.sensitiveDisplay === 'clear'
      ? 'clear'
      : (user.sensitiveBlurPref === 'veil' || user.sensitiveDisplay === 'blur' || user.sensitiveDisplay === 'veil'
        ? 'veil'
        : ''),
    onboardingDone: !!user.onboardingDone,
    onboardingStep: user.onboardingStep || 0,
    profileScore: calcProfileScore(user),
    profileRewardClaimed: !!user.profileRewardClaimed,
    privacy: user.privacy || { showMbti: false, showZodiac: false, showBirthday: false },
    memberNo: buildMemberNo(openid),
    createTime: user.createTime
  }
}

module.exports = {
  calcProfileScore,
  resolveAuthState,
  buildMemberNo,
  maskPhone,
  sanitizeUser
}
