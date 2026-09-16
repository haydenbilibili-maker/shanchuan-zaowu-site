const cloud = require('wx-server-sdk')
const { calcProfileScore, sanitizeUser } = require('./profileUtil')
const welcomeDefaults = require('./welcomeGiftDefaults')
const { normalizeCouponChannel } = require('./couponChannel')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const { checkText, checkFileImage } = require('./contentSecurity')

/**
 * 完善资料奖励：仅可用积分（bonusPoints），不计成长值；须写 point_records。
 * 历史 bug：曾把 50+20(成长) 一并 _.inc 进 bonusPoints 且不写流水 → 余额 170、明细仅 100。
 * 现行：注册净入账默认仅新会员礼包；完善资料积分默认 0（若改回 >0 会自动写明细）。
 */
const PROFILE_REWARD_POINTS = 0
const PROFILE_REWARD_SOURCE = 'profile_reward'
const PROFILE_REWARD_TITLE = '完善资料奖励'

const REGISTER_GIFT_SOURCE = welcomeDefaults.SOURCE
const USER_COUPONS = 'user_coupons'
const POINT_RECORDS = 'point_records'

const ALLOWED_FIELDS = [
  'nickName', 'avatarUrl', 'gender', 'birthday', 'interests',
  'mbti', 'zodiac', 'bio', 'privacy', 'onboardingDone', 'onboardingStep', 'agreedTermsAt',
  'sensitiveBlurPref'
]

function normalizeSensitiveBlurPref(raw) {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'veil' || v === 'blur') return 'veil'
  if (v === 'clear' || v === 'show') return 'clear'
  return ''
}

function pickPatch(raw) {
  const patch = {}
  ALLOWED_FIELDS.forEach((key) => {
    if (raw[key] !== undefined) patch[key] = raw[key]
  })
  // 兼容旧 patch 字段名 sensitiveDisplay
  if (
    !Object.prototype.hasOwnProperty.call(patch, 'sensitiveBlurPref') &&
    raw &&
    raw.sensitiveDisplay !== undefined
  ) {
    patch.sensitiveBlurPref = raw.sensitiveDisplay
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'sensitiveBlurPref')) {
    const normalized = normalizeSensitiveBlurPref(patch.sensitiveBlurPref)
    if (normalized) patch.sensitiveBlurPref = normalized
    else delete patch.sensitiveBlurPref
  }
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

function isDuplicateKeyError(e) {
  const msg = (e && (e.message || e.errMsg)) || ''
  return /duplicate|E11000|已存在|unique/i.test(msg)
}

function registerGiftDedupeKey(openid) {
  return `${REGISTER_GIFT_SOURCE}:${openid}`
}

function formatDateLabel(date) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function loadWelcomeConfig() {
  try {
    const res = await db.collection(welcomeDefaults.COLLECTION)
      .where({ status: 'active' })
      .orderBy('priority', 'desc')
      .limit(5)
      .get()
    const rows = res.data || []
    const top = rows.find((r) => r && r.enabled !== false) || rows[0]
    if (top) return welcomeDefaults.normalizeConfig(top)
  } catch (e) {
    // 集合不存在或无索引：再试一次不带 orderBy
    try {
      const res = await db.collection(welcomeDefaults.COLLECTION).limit(5).get()
      const rows = (res.data || []).filter((r) => r && r.status !== 'inactive')
      if (rows[0]) return welcomeDefaults.normalizeConfig(rows[0])
    } catch (err) {
      console.warn('loadWelcomeConfig fallback:', err.message)
    }
  }
  return welcomeDefaults.normalizeConfig({})
}

async function findGiftRecord(dedupeKey) {
  try {
    const res = await db.collection(POINT_RECORDS).where({ dedupeKey }).limit(1).get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    return null
  }
}

async function listExistingGiftCoupons(openid) {
  try {
    const res = await db.collection(USER_COUPONS)
      .where({ _openid: openid, source: REGISTER_GIFT_SOURCE })
      .limit(50)
      .get()
    return res.data || []
  } catch (e) {
    return []
  }
}

/** 槽位展开统一由 welcomeGiftDefaults 定义，避免与管理端副本漂移 */
function expandCouponSlots(config) {
  return welcomeDefaults.expandSlots(config)
}

/**
 * 把已发「未使用」礼券的条款对齐到当前配置（幂等，可反复执行）。
 * 配置是唯一真源：超管工作台改门槛后，老会员不应永远停留在旧门槛。
 * @returns {Promise<number>} 实际改写的券数
 */
async function alignExistingGiftCouponTerms(config, existingCoupons) {
  let plan
  try {
    plan = welcomeDefaults.buildCouponAlignPlan(config, existingCoupons)
  } catch (e) {
    console.warn('register gift align plan', e.message)
    return 0
  }
  let aligned = 0
  for (const item of plan.items) {
    try {
      await db.collection(USER_COUPONS).doc(item._id).update({ data: item.patch })
      const hit = (existingCoupons || []).find((c) => c && c._id === item._id)
      if (hit) {
        if (item.patch.minSpend !== undefined) hit.minSpend = item.patch.minSpend
        if (item.patch.title !== undefined) hit.title = item.patch.title
        if (item.patch.channel !== undefined) hit.channel = item.patch.channel
      }
      aligned += 1
    } catch (e) {
      console.warn('register gift coupon align', item._id, e.message)
    }
  }
  return aligned
}

async function grantWelcomeCoupons(openid, config, recordId) {
  const slots = expandCouponSlots(config)
  if (!slots.length) {
    return { couponIds: [], expireDate: '', expected: 0, failed: 0, complete: true }
  }

  const existing = await listExistingGiftCoupons(openid)

  // 自愈：无论券是否已齐，都先把「未使用」券的条款对齐到当前配置。
  // 历史事故：旧逻辑在券已齐时直接 return，改配置后老会员永远显示旧门槛（配置满49、页面仍为满50）。
  const aligned = await alignExistingGiftCouponTerms(config, existing)

  if (existing.length >= slots.length) {
    const expireTimes = existing.map((c) => c.expireTime).filter(Boolean)
    const latest = expireTimes.sort((a, b) => new Date(b) - new Date(a))[0]
    return {
      couponIds: existing.map((c) => c._id),
      expireDate: latest ? formatDateLabel(latest) : '',
      expected: slots.length,
      failed: 0,
      aligned,
      complete: true
    }
  }

  const issuedIds = existing.map((c) => c._id)
  const alreadyKeys = new Set(
    existing.map((c) => String(c.slotKey || `${c.couponId || ''}:0`))
  )
  let maxExpire = null
  let failed = 0

  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i]
    if (alreadyKeys.has(slot.slotKey)) continue
    const days = welcomeDefaults.resolveExpireDays(slot.expireDays, config.expireDays, 30)
    const expireTime = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    if (!maxExpire || expireTime > maxExpire) maxExpire = expireTime
    const templateId = `register_gift_${slot.value}`
    try {
      const added = await db.collection(USER_COUPONS).add({
        data: {
          _openid: openid,
          couponId: templateId,
          couponSource: REGISTER_GIFT_SOURCE,
          title: slot.title,
          type: 'cash',
          value: slot.value,
          minSpend: slot.minSpend,
          status: 'unused',
          source: REGISTER_GIFT_SOURCE,
          sourceRefId: recordId || '',
          slotKey: slot.slotKey,
          exclusiveGroup: REGISTER_GIFT_SOURCE,
          stackable: config.stackable === true,
          receiveType: 'auto',
          channel: normalizeCouponChannel(slot.channel),
          createTime: db.serverDate(),
          expireTime
        }
      })
      issuedIds.push(added._id)
      alreadyKeys.add(slot.slotKey)
    } catch (e) {
      failed += 1
      console.error('register gift coupon add', slot.slotKey, e)
    }
  }

  // 已有券的 expire 可能比本轮新发更晚
  if (!maxExpire && existing.length) {
    const expireTimes = existing.map((c) => c.expireTime).filter(Boolean)
    const latest = expireTimes.sort((a, b) => new Date(b) - new Date(a))[0]
    if (latest) maxExpire = new Date(latest)
  }

  return {
    couponIds: issuedIds,
    expireDate: maxExpire ? formatDateLabel(maxExpire) : '',
    expected: slots.length,
    failed,
    complete: issuedIds.length >= slots.length && failed === 0
  }
}

async function notifyWelcomeGift(openid, config, meta) {
  try {
    await cloud.callFunction({
      name: 'dispatchMessage',
      data: {
        action: 'dispatch',
        eventType: 'system_notice',
        openid,
        relatedId: REGISTER_GIFT_SOURCE,
        title: config.messageTitle || '新会员礼包已到账',
        content: welcomeDefaults.buildMessageContent(config, meta.expireDate || ''),
        actionUrl: '/subpackages/business/coupons/index'
      }
    })
  } catch (e) {
    console.warn('register gift message', e)
  }
}

/**
 * 注册礼包：同一 openid 仅一次（积分 + 礼券同幂等包）。
 * 幂等：users.registerGiftClaimed + point_records.dedupeKey = register_gift:{openid}
 */
async function claimRegisterGift(openid, userDoc) {
  if (!userDoc || !userDoc._id) {
    return { claimed: false, error: true, msg: '用户档案不存在' }
  }

  const config = await loadWelcomeConfig()
  if (!config.enabled) {
    return { claimed: false, disabled: true, msg: '新会员礼包暂未开放' }
  }

  const pointsToGrant = config.pointsEnabled ? Math.max(0, config.points) : 0
  const couponSlots = expandCouponSlots(config)
  if (pointsToGrant <= 0 && !couponSlots.length) {
    return { claimed: false, empty: true, msg: '新会员礼包内容为空' }
  }

  // 「礼券总开关开着，却一张都发不出」= 配置被改坏（2026-09-15 / 2026-09-16 两次同形事故）。
  // 旧逻辑把「券位为 0」当成 complete:true，于是用户只到账积分、没有券，
  // 页面也不出现补领横幅，问题完全静默。这里强制留痕：registerGiftIncomplete=true，
  // 用户在「我的」页看到补领横幅，配置修好后一按即补齐（幂等，不重复发积分）。
  const couponsConfiguredButEmpty = !!(config.couponsEnabled && !couponSlots.length)
  if (couponsConfiguredButEmpty) {
    console.warn('register gift anomaly: couponsEnabled=true but 0 active coupon slots — flagging user for repair')
  }
  const repairMsg = couponsConfiguredButEmpty
    ? '礼券配置异常（总开关已开但无启用券行），已标记待补领'
    : '礼券尚未全部到账，请稍后重试补领'

  const dedupeKey = registerGiftDedupeKey(openid)
  const existing = await findGiftRecord(dedupeKey)

  // 已发过：尝试补齐礼券（兼容仅积分的旧版本），不重复加分
  if (userDoc.registerGiftClaimed || (existing && existing.status === 'done')) {
    let couponMeta = { couponIds: [], expireDate: '', expected: couponSlots.length, failed: 0, complete: true }
    try {
      couponMeta = await grantWelcomeCoupons(openid, config, existing && existing._id)
      if (existing && existing._id && couponMeta.couponIds.length) {
        await db.collection(POINT_RECORDS).doc(existing._id).update({
          data: {
            couponIds: couponMeta.couponIds,
            couponCount: couponMeta.couponIds.length
          }
        }).catch(() => {})
      }
    } catch (e) {
      console.warn('register gift coupon repair', e.message)
      couponMeta = {
        couponIds: [],
        expireDate: '',
        expected: couponSlots.length,
        failed: couponSlots.length,
        complete: false
      }
    }
    const partialFlag = (!couponMeta.complete && couponSlots.length > 0) || couponsConfiguredButEmpty
    try {
      await db.collection('users').doc(userDoc._id).update({
        data: userDoc.registerGiftClaimed
          ? { registerGiftIncomplete: partialFlag }
          : {
            registerGiftClaimed: true,
            registerGiftClaimedAt: db.serverDate(),
            registerGiftIncomplete: partialFlag
          }
      })
    } catch (e) { /* ignore */ }
    return {
      claimed: false,
      alreadyGranted: true,
      repaired: true,
      partial: partialFlag,
      points: pointsToGrant,
      couponCount: couponMeta.couponIds.length,
      couponExpected: couponMeta.expected || couponSlots.length,
      expireDate: couponMeta.expireDate,
      title: config.title,
      msg: partialFlag ? repairMsg : ''
    }
  }

  let recordId = existing && existing._id ? existing._id : ''
  // 上次积分失败留下的 rolled_back：重置为 pending 后重试（dedupeKey 唯一，不能再 add）
  if (existing && existing.status === 'rolled_back' && existing._id) {
    try {
      await db.collection(POINT_RECORDS).doc(existing._id).update({
        data: {
          status: 'pending',
          points: pointsToGrant,
          title: config.title || '新会员礼包',
          rollbackReason: '',
          updateTime: db.serverDate()
        }
      })
    } catch (e) {
      console.warn('register gift reset rolled_back', e.message)
    }
    recordId = existing._id
  }
  if (!recordId) {
    try {
      const added = await db.collection(POINT_RECORDS).add({
        data: {
          _openid: openid,
          userOpenid: openid,
          type: 'earn',
          source: REGISTER_GIFT_SOURCE,
          action: REGISTER_GIFT_SOURCE,
          points: pointsToGrant,
          title: config.title || '新会员礼包',
          excludeGrowth: config.excludeGrowth !== false,
          dedupeKey,
          status: 'pending',
          createTime: db.serverDate()
        }
      })
      recordId = added._id
    } catch (e) {
      if (isDuplicateKeyError(e)) {
        const again = await findGiftRecord(dedupeKey)
        if (again && again.status === 'done') {
          return claimRegisterGift(openid, { ...userDoc, registerGiftClaimed: true })
        }
        return { claimed: false, alreadyGranted: true, msg: '礼包正在发放，请稍后刷新' }
      }
      console.error('register gift add point_record', e)
      return { claimed: false, error: true, msg: '礼包发放失败，请稍后重试' }
    }
  }

  if (pointsToGrant > 0) {
    try {
      await db.collection('users').doc(userDoc._id).update({
        data: {
          bonusPoints: _.inc(pointsToGrant),
          registerGiftClaimed: true,
          registerGiftClaimedAt: db.serverDate(),
          registerGiftIncomplete: true
        }
      })
    } catch (e) {
      console.error('register gift inc bonusPoints', e)
      try {
        await db.collection(POINT_RECORDS).doc(recordId).update({
          data: {
            status: 'rolled_back',
            rollbackReason: 'points_failed',
            rollbackTime: db.serverDate()
          }
        })
      } catch (err) { /* ignore */ }
      return { claimed: false, error: true, msg: '礼包积分发放失败，请稍后重试' }
    }
  } else {
    try {
      await db.collection('users').doc(userDoc._id).update({
        data: {
          registerGiftClaimed: true,
          registerGiftClaimedAt: db.serverDate(),
          registerGiftIncomplete: true
        }
      })
    } catch (e) {
      console.error('register gift mark claimed', e)
      return { claimed: false, error: true, msg: '礼包标记失败，请稍后重试' }
    }
  }

  let couponMeta = { couponIds: [], expireDate: '', expected: couponSlots.length, failed: 0, complete: !couponSlots.length }
  try {
    couponMeta = await grantWelcomeCoupons(openid, config, recordId)
  } catch (e) {
    console.error('register gift coupons', e)
    couponMeta = {
      couponIds: [],
      expireDate: '',
      expected: couponSlots.length,
      failed: couponSlots.length,
      complete: false
    }
  }

  const partial = (!couponMeta.complete && couponSlots.length > 0) || couponsConfiguredButEmpty

  try {
    await db.collection(POINT_RECORDS).doc(recordId).update({
      data: {
        status: 'done',
        doneTime: db.serverDate(),
        couponIds: couponMeta.couponIds,
        couponCount: couponMeta.couponIds.length,
        configSnapshot: {
          points: pointsToGrant,
          expireDays: config.expireDays,
          stackable: !!config.stackable,
          couponValues: couponSlots.map((s) => s.value)
        }
      }
    })
  } catch (e) {
    console.warn('register gift finalize record', e.message)
  }

  try {
    await db.collection('users').doc(userDoc._id).update({
      data: { registerGiftIncomplete: !!partial }
    })
  } catch (e) { /* ignore */ }

  if (!partial) {
    await notifyWelcomeGift(openid, config, couponMeta)
  }

  return {
    claimed: true,
    partial,
    points: pointsToGrant,
    couponCount: couponMeta.couponIds.length,
    couponExpected: couponMeta.expected || couponSlots.length,
    couponValues: couponSlots.map((s) => s.value),
    expireDate: couponMeta.expireDate,
    stackable: !!config.stackable,
    title: config.title,
    msg: partial ? repairMsg : ''
  }
}

function profileRewardDedupeKey(openid) {
  return `${PROFILE_REWARD_SOURCE}:${openid}`
}

/**
 * 完善资料一次性奖励：bonusPoints += POINTS，并写 point_records（与余额一致）。
 * 幂等：users.profileRewardClaimed + point_records.dedupeKey = profile_reward:{openid}
 * 不计成长值（excludeGrowth=true）；禁止把「成长值」写入可用积分。
 * POINTS=0 时仅打标防重，不入账、不写流水（注册净入账默认仅礼包）。
 */
async function claimProfileReward(openid, userDoc) {
  if (!userDoc || !userDoc._id || userDoc.profileRewardClaimed || !userDoc.onboardingDone) {
    return { claimed: false }
  }

  const pointsToGrant = Math.max(0, Math.floor(PROFILE_REWARD_POINTS))
  const dedupeKey = profileRewardDedupeKey(openid)
  const existing = await findGiftRecord(dedupeKey)

  if (existing && existing.status === 'done') {
    try {
      await db.collection('users').doc(userDoc._id).update({
        data: { profileRewardClaimed: true }
      })
    } catch (e) { /* ignore */ }
    return {
      claimed: false,
      alreadyGranted: true,
      points: Number(existing.points) || pointsToGrant
    }
  }

  // 关闭积分奖励：只打标，避免再次进入；不制造幽灵余额
  if (pointsToGrant <= 0) {
    try {
      await db.collection('users').doc(userDoc._id).update({
        data: { profileRewardClaimed: true }
      })
    } catch (e) {
      console.error('profile reward mark claimed', e)
      return { claimed: false, error: true }
    }
    return { claimed: false, skipped: true, points: 0, growthBonus: 0 }
  }

  let recordId = existing && existing._id ? existing._id : ''
  if (!recordId) {
    try {
      const added = await db.collection(POINT_RECORDS).add({
        data: {
          _openid: openid,
          userOpenid: openid,
          type: 'earn',
          source: PROFILE_REWARD_SOURCE,
          action: PROFILE_REWARD_SOURCE,
          points: pointsToGrant,
          title: PROFILE_REWARD_TITLE,
          excludeGrowth: true,
          dedupeKey,
          status: 'pending',
          createTime: db.serverDate()
        }
      })
      recordId = added._id
    } catch (e) {
      if (isDuplicateKeyError(e)) {
        return { claimed: false, alreadyGranted: true, points: pointsToGrant }
      }
      console.error('profile reward add point_record', e)
      return { claimed: false, error: true }
    }
  }

  try {
    await db.collection('users').doc(userDoc._id).update({
      data: {
        profileRewardClaimed: true,
        bonusPoints: _.inc(pointsToGrant)
      }
    })
  } catch (e) {
    console.error('profile reward claim update', e)
    try {
      await db.collection(POINT_RECORDS).doc(recordId).update({
        data: {
          status: 'rolled_back',
          rollbackReason: 'points_failed',
          rollbackTime: db.serverDate()
        }
      })
    } catch (err) { /* ignore */ }
    return { claimed: false, error: true }
  }

  try {
    await db.collection(POINT_RECORDS).doc(recordId).update({
      data: {
        status: 'done',
        doneTime: db.serverDate()
      }
    })
  } catch (e) {
    console.warn('profile reward finalize record', e.message)
  }

  try {
    await cloud.callFunction({
      name: 'dispatchMessage',
      data: {
        action: 'dispatch',
        eventType: 'system_notice',
        openid,
        relatedId: PROFILE_REWARD_SOURCE,
        title: '藏家档案已建立',
        content: `欢迎加入山海造物。完善资料奖励 ${pointsToGrant} 积分已到账（不计成长值），愿你的标本被好好安放。`,
        actionUrl: '/subpackages/extra/user/profile/index'
      }
    })
  } catch (e) {
    console.warn('profile reward message', e)
  }

  return { claimed: true, points: pointsToGrant, growthBonus: 0 }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  if (!openid) return { success: false, msg: '未登录' }

  const {
    patch = {},
    completeOnboarding = false,
    repairRegisterGift = false
  } = event || {}
  const data = pickPatch(patch)

  // ---- 内容安全：昵称/签名公开展示，头像为公开图片，必须过检测 ----
  // 判定语义：
  // - reason==='risky'：明确违规 → 拒绝；
  // - 其它（openapi 不可用/网络抖动）：不阻断用户改资料，但打标待复核。
  //   实测云调用 openapi 在环境未配置时返回 invalid wx openapi access_token，
  //   若此时一律拒绝会导致「改昵称/头像」整体不可用。
  const secReviewReasons = []
  const rejectRisky = (code, label) => ({
    success: false,
    code,
    msg: `${label}包含不适宜内容，请修改后重试`
  })

  const nick = String(data.nickName == null ? '' : data.nickName).trim()
  if (nick) {
    const nickCheck = await checkText(openid, nick, 1)
    if (nickCheck.reason === 'risky') return rejectRisky('NICKNAME_RISKY', '昵称')
    if (!nickCheck.ok) secReviewReasons.push(nickCheck.openapiUnavailable ? 'nickname_check_openapi_unavailable' : 'nickname_check_error')
  }
  const bio = String(data.bio == null ? '' : data.bio).trim()
  if (bio) {
    const bioCheck = await checkText(openid, bio, 1)
    if (bioCheck.reason === 'risky') return rejectRisky('BIO_RISKY', '简介')
    if (!bioCheck.ok) secReviewReasons.push(bioCheck.openapiUnavailable ? 'bio_check_openapi_unavailable' : 'bio_check_error')
  }
  if (data.avatarUrl) {
    const avatarCheck = await checkFileImage(String(data.avatarUrl))
    if (avatarCheck.reason === 'risky') return rejectRisky('AVATAR_RISKY', '头像图片')
    if (!avatarCheck.ok) secReviewReasons.push(avatarCheck.openapiUnavailable ? 'avatar_check_openapi_unavailable' : `avatar_check_${avatarCheck.reason}`)
  }
  if (secReviewReasons.length) {
    data.secCheck = { pending: true, reasons: secReviewReasons, at: db.serverDate() }
  }

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
    let registerGift = { claimed: false }

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
        registerGiftClaimed: false,
        registerSource: 'wechat_mp',
        registerTime: db.serverDate(),
        createTime: db.serverDate()
      }
      createData.profileScore = calcProfileScore(createData)
      const addRes = await db.collection('users').add({ data: createData })
      userDoc = { ...createData, _id: addRes._id }
    }

    // 完成注册 / 显式补领 / 已完成注册但未打标或礼券未齐：均可触发（幂等）
    const shouldClaimGift = !!(
      completeOnboarding
      || repairRegisterGift
      || (userDoc.onboardingDone && !userDoc.registerGiftClaimed)
      || (userDoc.onboardingDone && userDoc.registerGiftIncomplete)
    )
    if (shouldClaimGift) {
      registerGift = await claimRegisterGift(openid, userDoc)
      if (registerGift.claimed && registerGift.points > 0) {
        userDoc = {
          ...userDoc,
          registerGiftClaimed: true,
          bonusPoints: (Number(userDoc.bonusPoints) || 0) + registerGift.points
        }
      } else if (registerGift.claimed || registerGift.alreadyGranted) {
        userDoc = { ...userDoc, registerGiftClaimed: true }
      }
    }

    if ((completeOnboarding || userDoc.onboardingDone) && !userDoc.profileRewardClaimed) {
      reward = await claimProfileReward(openid, userDoc)
      if (reward.claimed && reward.points > 0) {
        userDoc = {
          ...userDoc,
          profileRewardClaimed: true,
          bonusPoints: (Number(userDoc.bonusPoints) || 0) + reward.points
        }
      } else if (reward.claimed || reward.alreadyGranted || reward.skipped) {
        userDoc = { ...userDoc, profileRewardClaimed: true }
      }
    }

    return {
      success: true,
      user: sanitizeUser(userDoc, openid),
      profileScore: calcProfileScore(userDoc),
      reward,
      registerGift
    }
  } catch (e) {
    console.error('upsertUserProfile', e)
    return { success: false, msg: e.message || '保存失败' }
  }
}
