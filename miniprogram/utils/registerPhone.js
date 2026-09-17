/**
 * 手机号一键注册 —— **唯一出处**
 *
 * 为什么需要（2026-09-17）：
 *   注册此前**只能在** `subpackages/extra/user/onboarding` 页完成：任何想转化的场景
 *   都得 `navigateTo` 跳过去、办完再回来。链路上丢上下文、也丢转化。
 *   现在「鉴定百科」要求**原地**弹授权、并默认注册成功，于是把服务端链路抽到这里，
 *   让「带授权按钮的弹窗组件」与注册页**共用同一条**链路 ——
 *   两份实现必然漂移（这个仓库已经为「重复副本」立过 7 个家族守卫）。
 *
 * 链路（与注册页逐字一致，顺序不可换）：
 *   ① `authPhone{ finishRegistration:true, patch }`
 *        ← 用 `<button open-type="getPhoneNumber">` 拿到的 code 换手机号
 *        ├ `payload.finished === true` → 后端已建号：直接用它的 user / 新客礼
 *        └ 否则                        → ② `upsertUserProfile{ completeOnboarding:true }` 补建
 *   ③ `refreshSessionAfterAuth(app)`
 *        ← 必须调用：退出态用户的 `ensureSession` 会一直返回 guest（见 userSession 注释）
 *
 * 不在这里做的事：缓存失效。`cacheInvalidate` **按分包各留一份**、主包内不可达，
 * 所以由调用方用**本分包**的那份处理（`invalidateAfterProfile()`）。
 *
 * @param {object}  opts
 * @param {object}  opts.app       getApp() 实例（refreshSessionAfterAuth 需要）
 * @param {string}  opts.phoneCode `e.detail.code`（getPhoneNumber 回调里拿）
 * @param {object} [opts.patch]    随注册一起写入的资料补丁
 * @returns {Promise<{ok:boolean, msg?:string, payload?:object}>}
 */
async function registerWithPhone(opts) {
  const { app, phoneCode, patch = {} } = opts || {}
  if (!phoneCode) return { ok: false, msg: '缺少手机号授权凭证' }
  const { refreshSessionAfterAuth } = require('./userSession')

  try {
    const res = await wx.cloud.callFunction({
      name: 'authPhone',
      data: { code: phoneCode, finishRegistration: true, patch }
    })
    const payload = (res && res.result) || {}
    if (!payload.success) return { ok: false, msg: payload.msg || '绑定失败' }

    // 后端已完成建档：它带回 user 与新客礼，直接用（少一次往返）
    if (payload.finished) {
      await refreshSessionAfterAuth(app)
      return {
        ok: true,
        payload: {
          success: true,
          // 新号 / 老号：由 authPhone 如实回传（完成页文案与埋点据此分支）
          isNewUser: payload.isNewUser !== false,
          registerGift: payload.registerGift || {},
          reward: payload.reward || {},
          user: payload.user
        }
      }
    }

    // 后端只绑定了手机号：补一次 upsert 才算注册完成
    const upsert = await wx.cloud.callFunction({
      name: 'upsertUserProfile',
      data: { patch, completeOnboarding: true }
    })
    const up = (upsert && upsert.result) || {}
    if (!up.success) return { ok: false, msg: up.msg || '注册失败' }
    await refreshSessionAfterAuth(app)
    return { ok: true, payload: up }
  } catch (e) {
    return { ok: false, msg: '网络异常，请重试', error: e }
  }
}

module.exports = { registerWithPhone }
