/**
 * Admin 代理会话（Cloudflare Pages Functions）
 *
 * 目的：/api/cloud-fn 会把 ADMIN_OPS_KEY 注入到管理类云函数（等于超管身份），
 * 因此**必须先证明调用方是已登录的运营人员**，不能再让公网匿名调用。
 *
 * 方案：运营人员在 ERP 登录页输入「最高管理权限口令」→ POST /api/admin-session
 * 由服务端比对 Pages 环境变量 ADMIN_PROXY_PASSWORD，成功后下发 HMAC 签名的
 * HttpOnly Cookie。密钥只存在服务端环境变量里，绝不进入 SPA 打包产物。
 *
 * 环境变量：
 *   ADMIN_PROXY_PASSWORD  必填。运营登录口令（请勿复用 VITE_ADMIN_PASSWORD，后者在 SPA 里是公开的）
 *   ADMIN_PROXY_SECRET    选填。Cookie 签名密钥；缺省依次回退 ADMIN_PROXY_PASSWORD / ADMIN_OPS_KEY
 *   ADMIN_PROXY_ORIGINS   选填。额外允许的来源域名，逗号分隔（如预览域名）
 */

export const SESSION_COOKIE = 'sc_admin_session'
export const SESSION_TTL_SEC = 12 * 60 * 60

function enc() {
  return new TextEncoder()
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 恒定时间字符串比较，避免签名被逐字节爆破 */
function safeEqual(a, b) {
  const x = String(a || '')
  const y = String(b || '')
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i += 1) diff |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return diff === 0
}

export function sessionSecret(env = {}) {
  return String(env.ADMIN_PROXY_SECRET || env.ADMIN_PROXY_PASSWORD || env.ADMIN_OPS_KEY || '')
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc().encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc().encode(String(message)))
  return toHex(sig)
}

/**
 * 登录口令是否可用：未配置 ADMIN_PROXY_PASSWORD 时视为「代理鉴权未启用」，
 * 由调用方决定是拒绝服务还是降级（本仓库选择拒绝，避免默认不安全）。
 */
export function passwordConfigured(env = {}) {
  return Boolean(env.ADMIN_PROXY_PASSWORD)
}

export async function issueSessionToken(env = {}, ttlSec = SESSION_TTL_SEC) {
  const secret = sessionSecret(env)
  if (!secret) return ''
  const exp = Math.floor(Date.now() / 1000) + Math.max(60, Number(ttlSec) || SESSION_TTL_SEC)
  const sig = await hmacHex(secret, `admin-session:${exp}`)
  return `${exp}.${sig}`
}

export async function verifySessionToken(env = {}, token = '') {
  const secret = sessionSecret(env)
  if (!secret) return { ok: false, reason: 'no_secret' }
  const raw = String(token || '').trim()
  if (!raw.includes('.')) return { ok: false, reason: 'malformed' }
  const [expStr, sig] = raw.split('.')
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || exp <= 0) return { ok: false, reason: 'malformed' }
  const expect = await hmacHex(secret, `admin-session:${exp}`)
  if (!safeEqual(sig, expect)) return { ok: false, reason: 'bad_signature' }
  if (Math.floor(Date.now() / 1000) > exp) return { ok: false, reason: 'expired' }
  return { ok: true, exp }
}

export function parseCookies(request) {
  const header = (request && request.headers && request.headers.get('Cookie')) || ''
  const out = {}
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=')
    if (idx === -1) return
    const k = part.slice(0, idx).trim()
    if (!k) return
    out[k] = decodeURIComponent(part.slice(idx + 1).trim())
  })
  return out
}

export function buildSessionCookie(token, ttlSec = SESSION_TTL_SEC) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${Math.max(60, Number(ttlSec) || SESSION_TTL_SEC)}`,
  ].join('; ')
}

export function buildClearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
}

/**
 * 来源校验（防 CSRF 的纵深防御）：浏览器请求必须来自本站或显式白名单。
 * 非浏览器客户端不带 Origin/Referer，此时以 Cookie 签名作为唯一凭证。
 */
export function originAllowed(request, env = {}) {
  const origin = request.headers.get('Origin') || ''
  const referer = request.headers.get('Referer') || ''
  const self = new URL(request.url).host
  const extra = String(env.ADMIN_PROXY_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const hostOf = (url) => {
    try {
      return new URL(url).host
    } catch {
      return ''
    }
  }

  const candidate = hostOf(origin) || hostOf(referer)
  if (!candidate) return true
  if (candidate === self) return true
  return extra.includes(candidate)
}

/** 只回显本站来源，禁止 Access-Control-Allow-Origin: * */
export function corsHeaders(request, env = {}) {
  const origin = request.headers.get('Origin') || ''
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  }
  if (origin && originAllowed(request, env)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}
