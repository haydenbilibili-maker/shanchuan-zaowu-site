/**
 * 统一云函数 / 代理错误文案：区分「Admin 口令会话」「微信 openid 登录」「权限不足」「运维密钥」。
 * Admin SPA 的「主理人·在线」只是口令门禁，不等于云函数已鉴权通过。
 */

export const CloudFnErrorKind = Object.freeze({
  ADMIN_SESSION: 'ADMIN_SESSION',
  NEED_LOGIN: 'NEED_LOGIN',
  PERMISSION: 'PERMISSION',
  OPS_KEY: 'OPS_KEY',
  PROXY: 'PROXY',
  UNKNOWN: 'UNKNOWN'
})

function adminSpaLoggedIn() {
  try {
    return localStorage.getItem('sc_admin_token') === 'verified_888'
  } catch {
    return false
  }
}

function blobOf(errOrRes) {
  if (!errOrRes) return ''
  if (typeof errOrRes === 'string') return errOrRes
  const code = errOrRes.code || errOrRes.errorCode || ''
  const msg = errOrRes.msg || errOrRes.message || ''
  return `${code} ${msg}`.trim()
}

/**
 * @param {unknown} errOrRes  Error | 云函数 result | string
 * @returns {{ kind: string, message: string, code: string, silentToast: boolean }}
 */
export function classifyCloudFnError(errOrRes) {
  const code = String(errOrRes?.code || errOrRes?.errorCode || '').trim()
  const rawMsg = String(errOrRes?.msg || errOrRes?.message || (typeof errOrRes === 'string' ? errOrRes : '') || '').trim()
  const blob = blobOf(errOrRes)
  const spaOn = adminSpaLoggedIn()

  if (
    code === 'ADMIN_OPS_KEY_INVALID' ||
    code === 'ADMIN_OPS_KEY_MISSING' ||
    code === 'ADMIN_UNCONFIGURED' ||
    /ADMIN_OPS_KEY|运维密钥|未配置 ADMIN_OPS/i.test(blob)
  ) {
    return {
      kind: CloudFnErrorKind.OPS_KEY,
      code: code || 'OPS_KEY',
      message: rawMsg || 'Admin 运维密钥未配置或不匹配，请检查 Cloudflare / 云函数 ADMIN_OPS_KEY',
      silentToast: false
    }
  }

  if (
    code === 'FORBIDDEN' ||
    code === 'PERMISSION_DENIED' ||
    /无操作权限|仅超管|权限不足|仅可读|该操作仅/i.test(blob)
  ) {
    return {
      kind: CloudFnErrorKind.PERMISSION,
      code: code || 'FORBIDDEN',
      message: rawMsg || '权限不足：当前身份仅可读，需超管 / 对应权限点',
      silentToast: true
    }
  }

  if (
    code === 'NOT_LOGGED_IN' ||
    code === 'NEED_LOGIN' ||
    code === 'UNAUTHORIZED' ||
    /^请先登录/.test(rawMsg) ||
    /未登录|请重新登录|session.*expir/i.test(blob)
  ) {
    if (spaOn) {
      return {
        kind: CloudFnErrorKind.OPS_KEY,
        code: code || 'NOT_LOGGED_IN',
        message:
          '云端鉴权未通过（非「请先登录」）：Admin 口令已生效，但云函数未识别运维密钥或微信身份。请确认 Pages 与云函数 ADMIN_OPS_KEY 一致，或使用具备权限的店长/超管身份。',
        silentToast: false
      }
    }
    return {
      kind: CloudFnErrorKind.NEED_LOGIN,
      code: code || 'NEED_LOGIN',
      message: '请重新登录后再试',
      silentToast: false
    }
  }

  if (/代理未部署|TCB_SECRET|腾讯云 API 鉴权|云函数代理/i.test(blob)) {
    return {
      kind: CloudFnErrorKind.PROXY,
      code: code || 'PROXY',
      message: rawMsg || '云函数代理不可用，请检查 Pages Functions 与密钥配置',
      silentToast: false
    }
  }

  return {
    kind: CloudFnErrorKind.UNKNOWN,
    code: code || 'UNKNOWN',
    message: rawMsg || '云函数调用失败',
    silentToast: false
  }
}

/** 供 ElMessage 使用；权限类可选择不弹 toast（页面已有徽章时） */
export function cloudFnErrorMessage(errOrRes, options = {}) {
  const { preferSilentPermission = false } = options
  const info = classifyCloudFnError(errOrRes)
  if (preferSilentPermission && info.silentToast) {
    return { ...info, shouldToast: false }
  }
  return { ...info, shouldToast: true }
}
