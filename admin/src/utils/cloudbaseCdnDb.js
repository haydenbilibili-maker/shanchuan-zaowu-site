import { safeWarn } from '../utils/safeStorage.js'
/**
 * CloudBase 数据库（CDN SDK）
 * bundle 内 @cloudbase/js-sdk 的 db.get() 存在 setting 'promise' bug；
 * 财务 / 店长账本同步统一走 index.html 预加载的 CDN SDK。
 */
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const REGION = 'ap-shanghai'

let db = null
let cdnApp = null
let initPromise = null

export { ENV_ID, REGION }

const CDN_URL = 'https://static.cloudbase.net/cloudbase-js-sdk/2.11.0/cloudbase.full.js'
const CDN_LOAD_TIMEOUT_MS = 12000
const AUTH_TIMEOUT_MS = 15000

export function isCloudbasePromiseBug(err) {
  const msg = err?.message || String(err)
  return msg.includes("setting 'promise'") || msg.includes('setting "promise"')
}

function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} 超时（${Math.round(ms / 1000)}s）。请检查网络或 CloudBase 匿名登录/安全域名。`)),
      ms,
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** 确保 CDN SDK 可用（dev 热更新后 __cloudbaseCDN 可能丢失） */
async function ensureCdnSdk() {
  if (window.__cloudbaseCDN?.init) {
    return window.__cloudbaseCDN
  }

  // index.html 异步预载：有结果（含失败）后继续，不无限等待
  if (window.__cloudbaseCDNReady) {
    try {
      await withTimeout(window.__cloudbaseCDNReady, CDN_LOAD_TIMEOUT_MS, 'CloudBase CDN 预加载')
    } catch (e) {
      console.warn('[cloudbaseCdnDb]', e?.message || e)
    }
    if (window.__cloudbaseCDN?.init) return window.__cloudbaseCDN
    if (window.cloudbase?.init) {
      window.__cloudbaseCDN = window.cloudbase
      return window.__cloudbaseCDN
    }
  }

  const existing = document.querySelector(`script[src="${CDN_URL}"]`)
  if (existing && window.cloudbase?.init) {
    window.__cloudbaseCDN = window.cloudbase
    return window.__cloudbaseCDN
  }

  await withTimeout(
    new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = CDN_URL
      script.async = true
      script.onload = () => {
        window.__cloudbaseCDN = window.cloudbase
        resolve()
      }
      script.onerror = () => reject(new Error('CloudBase CDN 脚本加载失败，请检查网络'))
      document.head.appendChild(script)
    }),
    CDN_LOAD_TIMEOUT_MS,
    'CloudBase CDN 脚本加载',
  )

  if (!window.__cloudbaseCDN?.init) {
    throw new Error('CloudBase CDN SDK 未就绪')
  }
  return window.__cloudbaseCDN
}

export async function getCdnDatabase() {
  if (db) return db
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const cloudbase = await ensureCdnSdk()
        const app = cloudbase.init({ env: ENV_ID, region: REGION, persistence: 'local' })
        const auth = app.auth()
        try {
          const state = await withTimeout(
            Promise.resolve(auth.getLoginState()),
            AUTH_TIMEOUT_MS,
            'CloudBase 登录状态检查',
          )
          if (!state) {
            await withTimeout(
              Promise.resolve(auth.signInAnonymously()),
              AUTH_TIMEOUT_MS,
              'CloudBase 匿名登录',
            )
          }
        } catch (authErr) {
          // 二次尝试；仍失败则抛出，由调用方展示错误（禁止无限挂起）
          try {
            await withTimeout(
              Promise.resolve(auth.signInAnonymously()),
              AUTH_TIMEOUT_MS,
              'CloudBase 匿名登录重试',
            )
          } catch {
            throw authErr
          }
        }
        cdnApp = app
        db = app.database()
        return db
      } catch (err) {
        initPromise = null
        db = null
        cdnApp = null
        throw err
      }
    })()
  }
  return initPromise
}

/** 浏览器匿名 callFunction 常被拒；管理类函数走 /api/cloud-fn 服务端代理 */
const ADMIN_PROXY_FUNCTIONS = new Set([
  'manageInvoiceRequests',
  'manageHonoraryCurators',
  'manageMemberLevelAdjust',
  'manageStaff',
  'manageProducts',
  'bindPlatformOrder',
  'claimStoreReceipt',
  'managerShipOrder',
  'refundOrder',
  'getShippingRules',
  'manageStoredValue',
  'moderateComment',
  'assistProductCopy',
  'seedCategories',
  'manageGift',
  // 运营内容写库（集合 write:false 后 ERP 不可 CDN 直写）
  'manageStoreContent',
  // 门店积分规则：ERP 与小程序超管工作台共用 getStorePointRules（含审批与校验）
  'getStorePointRules',
  // 会员 CRM 积分调整：与小程序同一云函数（写 bonusPoints + 台账 + 操作人归属）
  'manageMemberCrm',
  // 2026-09-14 对齐：定金 / 直播 / 装裱师佣金 / 生日礼 / 审批
  'manageDeposit',
  'manageLiveSession',
  'manageArtisanCommission',
  'manageBirthdayGift',
  'manageApprovals',
  // 经营驾驶舱：全量订单口径（替代 CDN 500 单采样）
  'getAnalyticsDashboard',
  // 2026-09-14：超管采购管理 / 物业成本 / 门店出货单
  'managePurchaseOrder',
  'managePropertyCost',
  'manageStoreShipment',
  // 2026-09-15：支付补履约（回调缺失时由超管人工核对微信流水后补单）
  'confirmPayment',
  // 2026-09-16：新会员礼包（member_welcome_gift 已收紧为 PRIVATE）。ERP 与小程序超管工作台
  // 共用同一云函数，不再 CDN 直写 —— 直写会漏掉 updatedBy 与「已发未使用券条款同步」
  'manageWelcomeGift',
  // 2026-09-16：预约核销（须与 functions/_lib/cloudbaseCallFn.mjs 的 ALLOWED_FUNCTIONS 对齐）。
  // 只加 verifyBooking：updateBooking/cancelBooking 是顾客本人通道（认 wxContext.OPENID），
  // ERP 走代理没有 openid，加进来也会被它们拒。
  'verifyBooking',
  // 2026-09-19：工作室结算（价目表维护 + 全局手工费率配置）。写权限仅超管，
  // 由 staffGuard 的 SUPER_ADMIN_ONLY_PERMISSIONS 强制；ERP 经代理注入 adminOpsKey。
  'manageStudioSettlement',
  // 2026-09-28：B2B 采购单微信支付 查单补记 / 退款 / 确认对公到账（仅超管 action，adminOpsKey 鉴权）
  'payB2bPurchase',
  // 2026-09-28：敏感集合只读网关（见下方 PROXY_READ_COLLECTIONS）
  'secureDataRead',
  // 2026-09-29：敏感集合写网关（见下方 PROXY_WRITE_COLLECTIONS）
  'secureDataWrite',
  // 2026-09-29：财务账本 / 设置写入（upload_records / upload_settings，仅超管）
  'syncFinanceData',
])

/**
 * 小程序侧安全规则已 write:false 的运营集合。
 * ERP 匿名 CDN 直写会静默失败或抛权限错；统一改走 manageStoreContent。
 * 与 cloudfunctions/manageStoreContent ALLOWED_COLLECTIONS 保持同步。
 */
const STORE_CONTENT_WRITE_COLLECTIONS = new Set([
  'banners',
  'categories',
  'activities',
  'rewards',
  'framers',
  'care_guides',
  'custom_configs',
  'custom_inquiries',
  'pet_memorial_orders',
  'framer_recruit_applications',
  'articles',
  'cms_wikis',
  'configs',
  // 与 manageStoreContent.ALLOWED_COLLECTIONS 必须逐项一致（缺客户端 → 走 CDN 直写被规则拒）
  'vip_cards',
  'equity_goods',
  'feishu_shipments',
  // 2026-09-28：B2B 订货单与供货价目收紧为客户端不可写（防改价 / 改支付态），ERP 写入改经代理（仅超管）
  'purchase_orders',
  'price_list_items',
])

/** manageStoreContent.setDoc 白名单（须与云函数 allowSetDocIds 一致；未列入的 configs id 降级为 update） */
const STORE_CONTENT_SET_DOC_IDS = new Set([
  'booking_config',
  'feishu_bitable',
  'b2b_catalog',
  'member_growth_rules',
])

async function callStoreContentWrite(payload) {
  const res = await callCdnFunction('manageStoreContent', payload)
  if (!res || res.success === false) {
    const err = new Error(res?.msg || 'manageStoreContent 写入失败')
    err.code = res?.code || ''
    err.result = res
    throw err
  }
  // 兼容原 CDN add 返回 { id } / 部分调用方读 _id
  if (res.id && res._id == null) res._id = res.id
  return res
}

function shouldProxyStoreContent(collectionName) {
  return STORE_CONTENT_WRITE_COLLECTIONS.has(String(collectionName || '').trim())
}

/**
 * 敏感集合（订单 / 预约 / 工单 / 财务 / 账号 / 供应链）：安全规则 read 收紧为「非匿名」后，
 * ERP 匿名 CDN 读不到，读取统一改走 secureDataRead（超管鉴权 + C 端个人信息默认脱敏）。
 * 与 cloudfunctions/secureDataRead/policy.js 的 COLLECTION_POLICY 必须逐项一致。
 */
export const PROXY_READ_COLLECTIONS = new Set([
  'orders',
  'bookings',
  'refunds',
  'support_tickets',
  'custom_inquiries',
  'custom_drafts',
  'pet_memorial_orders',
  'waitlist',
  'pickup_verify_logs',
  'notification_logs',
  'framer_recruit_applications',
  'purchase_intents',
  'admin_users',
  'admin_roles',
  'admin_login_logs',
  'admin_operation_logs',
  'finance_records',
  'finance_settings',
  'store_ledger',
  'daily_revenues',
  'feishu_inventory',
  'feishu_purchases',
  'feishu_shipments',
  'feishu_sync_logs',
  'fulfillment_shipments',
  'stock_movements',
])

const SECURE_READ_PAGE = 200

function shouldProxyRead(collectionName) {
  return PROXY_READ_COLLECTIONS.has(String(collectionName || '').trim())
}

/**
 * SDK 查询条件 → secureDataRead 线格式。
 * QueryCommand / LogicCommand 暴露 operator + operands（in/nin 的 operands 即值数组），
 * db.RegExp 暴露 $regex / $options；Date 走 {$date}。
 */
export function whereToWire(value, depth = 0) {
  if (depth > 8 || value == null || typeof value !== 'object') return value
  if (value instanceof Date) return { $date: value.getTime() }
  if (Array.isArray(value)) return value.map((v) => whereToWire(v, depth + 1))
  if (typeof value.$regex === 'string') return { $regex: value.$regex, $options: value.$options || '' }
  if (typeof value.operator === 'string' && Array.isArray(value.operands)) {
    return { $op: value.operator, $args: value.operands.map((v) => whereToWire(v, depth + 1)) }
  }
  const out = {}
  for (const key of Object.keys(value)) out[key] = whereToWire(value[key], depth + 1)
  return out
}

/** 云函数把 Date 编码为 {$date: ms}（HTTP 代理 JSON 化会把 Date 变字符串），这里还原 */
export function wireToValue(value, depth = 0) {
  if (depth > 12 || value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => wireToValue(v, depth + 1))
  const keys = Object.keys(value)
  if (keys.length === 1 && keys[0] === '$date' && Number.isFinite(value.$date)) return new Date(value.$date)
  const out = {}
  for (const key of keys) out[key] = wireToValue(value[key], depth + 1)
  return out
}

/** secureDataRead 脱敏值均含 `**`；把它写回库会污染原值，写入前须剔除 */
export function isMaskedPii(value) {
  return typeof value === 'string' && value.includes('**')
}

async function callSecureRead(payload) {
  const res = await callCdnFunction('secureDataRead', payload)
  if (!res || res.success === false) {
    const err = new Error(res?.msg || 'secureDataRead 读取失败')
    err.code = res?.code || ''
    err.result = res
    throw err
  }
  return res
}

async function secureQueryPage(collection, { where = null, orderBy = [], skip = 0, limit = SECURE_READ_PAGE } = {}) {
  const res = await callSecureRead({
    action: 'query',
    collection,
    where: where ? whereToWire(where) : null,
    orderBy,
    skip,
    limit,
  })
  return wireToValue(res.list || [])
}

async function secureQueryAll(collection, { where = null, orderBy = [], maxRows = 500 } = {}) {
  const all = []
  let skip = 0
  while (all.length < maxRows) {
    const take = Math.min(SECURE_READ_PAGE, maxRows - all.length)
    const batch = await secureQueryPage(collection, { where, orderBy, skip, limit: take })
    if (!batch.length) break
    all.push(...batch)
    skip += batch.length
    if (batch.length < take) break
  }
  return all
}

/**
 * 读取原值（不脱敏）：仅用于导出等确需完整联系方式的场景；云函数会先写 admin_operation_logs 再返回。
 * @returns {Promise<object[]>}
 */
export async function cdnRevealDocs(collectionName, ids, reason = '') {
  const list = [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))]
  const out = []
  for (let i = 0; i < list.length; i += 100) {
    const res = await callSecureRead({
      action: 'get',
      collection: collectionName,
      ids: list.slice(i, i + 100),
      reveal: true,
      reason,
    })
    out.push(...wireToValue(res.list || []))
  }
  return out
}

/**
 * 公网匿名可写的集合：写规则收紧为 false 后 ERP 匿名 CDN 写不进，
 * cdnAdd / cdnUpdate / cdnRemove 对它们改走 secureDataWrite（超管 + 集合/动作/字段白名单 + 先审计后写）。
 * 与 cloudfunctions/secureDataWrite/policy.js 的 WRITE_POLICY 必须逐项一致。
 * finance_settings / store_ledger 不在此列：ERP 改走 syncFinanceData（见 financeSync.js）。
 */
export const PROXY_WRITE_COLLECTIONS = new Set([
  'refunds',
  'waitlist',
  'purchase_intents',
  'stores',
  'store_zones',
  'home_configs',
  'pet_craft_configs',
  'feishu_inventory',
  'feishu_purchases',
  'feishu_sync_logs',
  'fulfillment_shipments',
  'stock_movements',
  'finance_records',
])

function shouldProxyWrite(collectionName) {
  return PROXY_WRITE_COLLECTIONS.has(String(collectionName || '').trim())
}

/** 写入数据 → 线格式：Date 走 {$date}；SDK 操作符（db.command / serverDate / RegExp）无法经 HTTP 传递，直接报错 */
export function dataToWire(value, depth = 0) {
  if (depth > 12) throw new Error('写入数据嵌套过深')
  if (value == null || typeof value !== 'object') return value
  if (value instanceof Date) return { $date: value.getTime() }
  if (Array.isArray(value)) return value.map((v) => dataToWire(v, depth + 1))
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    throw new Error('写网关不支持数据库操作符（db.command / serverDate 等），请改为普通值')
  }
  const out = {}
  for (const key of Object.keys(value)) {
    if (value[key] !== undefined) out[key] = dataToWire(value[key], depth + 1)
  }
  return out
}

async function callSecureWrite(payload) {
  const res = await callCdnFunction('secureDataWrite', payload)
  if (!res || res.success === false) {
    const err = new Error(res?.msg || 'secureDataWrite 写入失败')
    err.code = res?.code || ''
    err.result = res
    throw err
  }
  if (res.id && res._id == null) res._id = res.id
  return res
}

function cloudFnProxyUrls() {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '')
  const urls = ['/api/cloud-fn']
  if (base && base !== '/') urls.push(`${base}/api/cloud-fn`)
  return [...new Set(urls)]
}

function proxyUnavailableMessage(detail = '') {
  const hint =
    'Admin 管理类云函数须经 /api/cloud-fn 代理（勿浏览器匿名直调）。' +
    '本地：admin/.env 配 TCB_SECRET_ID/TCB_SECRET_KEY 与 ADMIN_OPS_KEY 后重启 npm run dev:admin；' +
    '线上：提交并部署仓库 functions/api/cloud-fn.js，且 Cloudflare Pages 配置同名环境变量。' +
    '飞书同步走 /api/feishu-sync，与本代理无关。'
  return detail ? `${detail} ${hint}` : hint
}

/**
 * 建立 / 清除管理代理会话（/api/admin-session 下发 HttpOnly 签名 Cookie）。
 * 服务端 /api/cloud-fn 只有拿到该 Cookie 才会注入 ADMIN_OPS_KEY，
 * 因此**必须**在登录成功后调用一次本函数，否则所有管理类云函数都会 401。
 * 返回 { ok, skipped, msg }：skipped=true 表示本地开发未部署 Pages Functions。
 */
export async function establishAdminSession(password) {
  // 站点 Functions 固定在**站点根** /api/admin-session。
  // 切勿用 import.meta.env.BASE_URL 拼前缀：ERP 的 base 是 /admin/，
  // 拼出来会变成 /admin/api/admin-session（405），而 405 又被当成「未部署」降级，
  // 结果登录"假成功"、服务端会话从未建立 → 之后所有管理调用 401「会话已过期」。
  const url = '/api/admin-session'
  try {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: String(password || '') }),
    })
    const ctype = res.headers.get('content-type') || ''
    if (res.status === 404 || res.status === 405 || ctype.includes('text/html')) {
      if (!isLocalDevHost()) {
        // 线上出现这个分支＝Functions 没随本次发布部署，必须报错而不是降级放行
        return {
          ok: false,
          skipped: false,
          msg: `管理会话接口不可用（HTTP ${res.status}）。站点 Functions 可能未随本次发布部署，请联系维护者。`,
        }
      }
      console.warn('[admin-session] 未部署 /api/admin-session，已降级为本地口令门禁（仅限开发环境）')
      return { ok: true, skipped: true, msg: '未部署代理会话接口（开发环境降级）' }
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.success === false) {
      return { ok: false, skipped: false, msg: data.msg || `管理会话建立失败（HTTP ${res.status}）` }
    }
    return { ok: true, skipped: false, msg: data.msg || '身份验证通过' }
  } catch (e) {
    return { ok: false, skipped: false, msg: e?.message || '无法连接管理会话接口' }
  }
}

/** 本地开发才允许「未部署 Pages Functions」的降级放行 */
function isLocalDevHost() {
  try {
    const h = window.location.hostname
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')
  } catch (e) {
    return false
  }
}

/**
 * 会话探活：GET /api/admin-session 只回答「当前浏览器是否持有有效的服务端管理会话」。
 *
 * 2026-09-17 审计 A4：前端登录态不再靠 localStorage 里的魔法串，而是问服务端。
 * 返回 `{ reachable, active }`：
 *   · reachable=false → 接口不可达（本地开发未部署 Pages Functions / 网络异常）
 *     → 调用方**沿用**本地记忆，避免把开发环境锁死；
 *   · reachable=true && active=false → 服务端明确说没有有效会话（过期/被清）
 *     → 调用方清掉本地记忆并回登录页。
 */
export async function probeAdminSession() {
  try {
    const res = await fetch('/api/admin-session', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    })
    const ctype = res.headers.get('content-type') || ''
    if (res.status === 404 || res.status === 405 || ctype.includes('text/html')) {
      return { reachable: false, active: false }
    }
    const data = await res.json().catch(() => null)
    if (!res.ok || !data || data.success === false) return { reachable: false, active: false }
    return { reachable: true, active: data.active === true }
  } catch {
    return { reachable: false, active: false }
  }
}

export async function clearAdminSession() {
  try {
    // 与 establishAdminSession 同理：必须是站点根路径
    await fetch('/api/admin-session', { method: 'DELETE', credentials: 'same-origin' })
  } catch (e) { safeWarn('cloudbaseCdnDb 非关键操作失败（已忽略）', e) }
}

/** 会话失效时清掉前端登录标记，让口令门禁重新出现 */
function clearAdminSessionLocal() {
  try {
    localStorage.removeItem('sc_admin_token')
  } catch (e) { safeWarn('cloudbaseCdnDb 非关键操作失败（已忽略）', e) }
  try {
    window.dispatchEvent(new CustomEvent('sc-admin-session-expired'))
  } catch (e) { safeWarn('cloudbaseCdnDb 非关键操作失败（已忽略）', e) }
}

async function callViaCloudFnProxy(name, data = {}) {
  const urls = cloudFnProxyUrls()
  let lastErr
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        // 服务端以 HttpOnly 会话 Cookie 鉴权（/api/admin-session 下发），必须携带凭证
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, data }),
      })
      const ctype = res.headers.get('content-type') || ''
      if (res.status === 401 || res.status === 503) {
        const denied = await res.json().catch(() => ({}))
        if (res.status === 401) clearAdminSessionLocal()
        lastErr = new Error(
          denied?.msg ||
            '管理会话未建立或已过期，请退出后重新在登录页输入管理口令。',
        )
        continue
      }
      if (ctype.includes('text/html')) {
        lastErr = new Error(
          proxyUnavailableMessage(`${url} 未部署云函数代理（返回了 HTML，常见于 Pages Function 未随站点发布）。`),
        )
        continue
      }
      const json = await res.json().catch(() => ({}))
      if (!res.ok && json.success !== false) {
        // 线上无 Function 时常见：GET→404 HTML，POST→405 空 body
        const statusHint =
          res.status === 404 || res.status === 405
            ? `${url} 代理未部署（HTTP ${res.status}）。`
            : `云函数代理 HTTP ${res.status}。`
        lastErr = new Error(proxyUnavailableMessage(statusHint))
        continue
      }
      // 代理已到达：业务失败原样返回，由调用方读 success/msg
      return json
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error(proxyUnavailableMessage('云函数代理不可用。'))
}

function formatFnError(err) {
  const code = err?.code || err?.error?.code || ''
  const msg = err?.msg || err?.message || err?.error?.message || (typeof err === 'string' ? err : JSON.stringify(err))
  const blob = `${code} ${msg}`
  // 仅匹配云开发权限/函数缺失码；避免把普通业务「不存在」误映射成笼统提示
  if (/PERMISSION_DENIED|FUNCTION_NOT_FOUND|ResourceNotFound\.Function|function not exist/i.test(blob)) {
    return proxyUnavailableMessage(
      `云函数「调用被拒或未部署」（${code || 'PERMISSION_DENIED'}）。`,
    )
  }
  if (isCloudbasePromiseBug({ message: msg })) {
    return "CloudBase CDN/SDK 异常（setting 'promise'）。请确认 index.html 已预加载 CDN SDK，且业务走 getCdnDatabase，而非 bundle 内 db。"
  }
  return msg
}

/** 管理类云函数走 HTTP 代理；其它走 CDN SDK（密钥在云函数环境变量） */
export async function callCdnFunction(name, data = {}) {
  if (ADMIN_PROXY_FUNCTIONS.has(name)) {
    return callViaCloudFnProxy(name, data)
  }
  await getCdnDatabase()
  if (!cdnApp || typeof cdnApp.callFunction !== 'function') {
    throw new Error('CloudBase SDK 不支持 callFunction')
  }
  try {
    const res = await cdnApp.callFunction({ name, data })
    return res?.result ?? res
  } catch (err) {
    throw new Error(formatFnError(err))
  }
}

/**
 * limit 拉取（不用 orderBy，避免索引/SDK bug）
 * 匿名客户端单次常被截断为 20 条：用 skip 循环凑满请求量。
 */
export async function fetchCollectionLimit(collectionName, options = {}) {
  const { limit = 500, where = null, batchSize = 20 } = options
  const maxRows = Math.max(0, parseInt(limit, 10) || 0)
  if (!maxRows) return []
  if (shouldProxyRead(collectionName)) return secureQueryAll(collectionName, { where, maxRows })
  const db = await getCdnDatabase()
  const pageSize = Math.min(Math.max(parseInt(batchSize, 10) || 20, 1), 100)

  const all = []
  let skip = 0
  while (all.length < maxRows) {
    let query = db.collection(collectionName)
    if (where) query = query.where(where)
    const take = Math.min(pageSize, maxRows - all.length)
    const res = await query.skip(skip).limit(take).get()
    const batch = res.data || []
    if (!batch.length) break
    all.push(...batch)
    skip += batch.length
    if (batch.length < take) break
  }
  return all
}

/**
 * 写结果判定 —— 把「没抛错但其实没写进去」识别出来。
 *
 * 为什么需要它：CloudBase 的 `update`/`remove` 对**不匹配的文档**返回 `{updated: 0}` 而**不抛错**，
 * 安全规则拒绝时的表现也可能是空结果。于是 `await db.doc(id).update(...)` 后面接一句
 * `ElMessage.success('已保存')` 就成了假成功（审计 §0 P0-5 / P1「写失败被当成成功」）。
 */
export function writeApplied(res) {
  if (res == null) return true // SDK 返回空 = 无操作发生，不误判为失败
  if (res.success === false) return false // 云函数代理路径

  // ⚠ 2026-09-16 真实浏览器匿名会话实测：**权限被拒时 SDK 不抛错**，而是 resolve 一个
  //    带错误码的对象：
  //      { code: 'DATABASE_PERMISSION_DENIED', message: 'Permission denied …', requestId }
  //    既不是 throw，也不是 {updated:0}。原先这里落到末尾 `return true` —— 于是
  //    `assertWriteApplied` 会把「被安全规则拒绝」当成**写成功**，所有调用点继续弹「保存成功」。
  //    这正好是审计 P0-5「写失败被当成成功」的最隐蔽形态。（同时回答了审计 §1.5 里
  //    「匿名写 write:false 集合到底是抛错还是返回 updated:0」这个悬而未决的问题。）
  const errCode = res.code || res.errorCode || (res.error && (res.error.code || res.error.errorCode))
  if (errCode) return false
  if (res.error) return false

  const stats = res.stats || {}
  const updated = stats.updated != null ? stats.updated : res.updated
  if (updated != null) return Number(updated) > 0
  const deleted = stats.deleted != null ? stats.deleted : (res.deleted != null ? res.deleted : res.removed)
  if (deleted != null) return Number(deleted) > 0
  if (res._id || res.id || res.upsertedId) return true

  // 认不出的形状仍按「已生效」处理，但**打出形状**便于发现新的失败形态。
  //
  // 为什么这里不直接判失败：合法性未知，而 `set()` 等路径的返回形状没有稳定文档；
  // 一刀切判失败会把这些**正常写入**变成假失败（用户看到「保存未生效」但其实写进去了）。
  // 已验证的**失败**形态（错误码对象、updated:0、deleted:0）都已在上面显式拦截，
  // 所以残留风险仅为「未知形状恰好是失败」—— 靠这行 warn 把它变成一个可发现的问题。
  console.warn('[writeApplied] 未识别的写返回形状，按已生效处理（若实为失败请补形状判定）：', res)
  return true
}

/** 写未生效错误：message 面向运营，detail 留给 console */
export class WriteNotAppliedError extends Error {
  constructor(collectionName, op, res) {
    super(`保存未生效：${collectionName} 未发生任何变更（可能无权限或文档不存在）`)
    this.name = 'WriteNotAppliedError'
    this.collection = collectionName
    this.op = op
    this.detail = res
  }
}

/** 断言写已生效；未生效则抛 WriteNotAppliedError（调用方不得吞掉） */
export function assertWriteApplied(collectionName, res, op = 'write') {
  if (writeApplied(res)) return res
  console.error('[write-not-applied]', collectionName, op, res)
  throw new WriteNotAppliedError(collectionName, op, res)
}

/**
 * CDN 直写后的**错误码**检查（集中一层，避免每个调用点各写一遍）。
 *
 * 权限被拒时 SDK **不抛错**，只 resolve `{code:'DATABASE_PERMISSION_DENIED'}`。
 * 这类错误**无歧义**，必须就地抛出 —— 实测全仓只有 3 处调用点校验过写结果
 * （审计 P1「写失败被当成成功」），所以把这一层放在包装器里最有效：
 * 一次覆盖全部直写调用点。
 *
 * 刻意**只判错误码**，不判 `updated:0` / `deleted:0`：
 * 后者是「没有匹配到文档」，属调用点语义（新增可用 upsert、删除可幂等），
 * 一刀切抛错会制造假失败。需要严格语义的调用点继续用 `assertWriteApplied`。
 */
export function assertNoWriteError(collectionName, res, op = 'write') {
  const errCode = res && (res.code || res.errorCode || (res.error && (res.error.code || res.error.errorCode)))
  if (!res || !errCode) return res
  console.error('[write-denied]', collectionName, op, res)
  throw new WriteNotAppliedError(collectionName, op, res)
}

export async function cdnAdd(collectionName, data) {
  if (shouldProxyWrite(collectionName)) {
    return callSecureWrite({ action: 'add', collection: collectionName, data: dataToWire(data) })
  }
  if (shouldProxyStoreContent(collectionName)) {
    return callStoreContentWrite({
      action: 'upsert',
      collection: collectionName,
      data,
    })
  }
  const db = await getCdnDatabase()
  return assertNoWriteError(collectionName, await db.collection(collectionName).add(data), 'add')
}

export async function cdnUpdate(collectionName, docId, data) {
  if (shouldProxyWrite(collectionName)) {
    return callSecureWrite({ action: 'update', collection: collectionName, id: docId, data: dataToWire(data) })
  }
  if (shouldProxyStoreContent(collectionName)) {
    return callStoreContentWrite({
      action: 'update',
      collection: collectionName,
      id: docId,
      data,
    })
  }
  const db = await getCdnDatabase()
  return assertNoWriteError(collectionName, await db.collection(collectionName).doc(docId).update(data), 'update')
}

export async function cdnRemove(collectionName, docId) {
  if (shouldProxyWrite(collectionName)) {
    return callSecureWrite({ action: 'remove', collection: collectionName, id: docId })
  }
  if (shouldProxyStoreContent(collectionName)) {
    return callStoreContentWrite({
      action: 'remove',
      collection: collectionName,
      id: docId,
    })
  }
  const db = await getCdnDatabase()
  return assertNoWriteError(collectionName, await db.collection(collectionName).doc(docId).remove(), 'remove')
}

export async function cdnDocGet(collectionName, docId) {
  if (shouldProxyRead(collectionName)) {
    const res = await callSecureRead({ action: 'get', collection: collectionName, id: docId })
    return wireToValue(res.list || [])[0] ?? null
  }
  const db = await getCdnDatabase()
  const res = await db.collection(collectionName).doc(docId).get()
  const data = res?.data
  if (Array.isArray(data)) return data.length > 0 ? data[0] : null
  return data ?? null
}

export async function cdnSet(collectionName, docId, data) {
  if (shouldProxyWrite(collectionName)) {
    throw new Error(`${collectionName} 经写网关写入，不支持整文档 set（请用 cdnUpdate / cdnAdd）`)
  }
  if (shouldProxyStoreContent(collectionName)) {
    const id = String(docId || '').trim()
    // configs 等集合 setDoc 有 id 白名单；未授权时降级为 update（文档须已存在）
    const canTrySetDoc = collectionName !== 'configs' || !id || STORE_CONTENT_SET_DOC_IDS.has(id)
    if (canTrySetDoc) {
      try {
        return await callStoreContentWrite({
          action: 'setDoc',
          collection: collectionName,
          id: docId,
          data,
        })
      } catch (e) {
        const msg = e?.message || String(e)
        if (collectionName === 'configs' && /未授权 setDoc|文档未授权/i.test(msg)) {
          return callStoreContentWrite({
            action: 'update',
            collection: collectionName,
            id,
            data,
          })
        }
        throw e
      }
    }
    return callStoreContentWrite({
      action: 'update',
      collection: collectionName,
      id,
      data,
    })
  }
  const db = await getCdnDatabase()
  return assertNoWriteError(collectionName, await db.collection(collectionName).doc(docId).set(data), 'set')
}

export async function fetchCollectionWhere(collectionName, where, limit = 500) {
  if (shouldProxyRead(collectionName)) {
    return secureQueryAll(collectionName, { where, maxRows: Math.max(0, parseInt(limit, 10) || 0) })
  }
  const db = await getCdnDatabase()
  const res = await db.collection(collectionName).where(where).limit(limit).get()
  return res.data || []
}

export async function cdnCount(collectionName, where = null) {
  if (shouldProxyRead(collectionName)) {
    const res = await callSecureRead({
      action: 'count',
      collection: collectionName,
      where: where ? whereToWire(where) : null,
    })
    return res.total || 0
  }
  const db = await getCdnDatabase()
  let query = db.collection(collectionName)
  if (where) query = query.where(where)
  const res = await query.count()
  return res.total || 0
}

/** 分页查询（单 where；排序字段可选） */
export async function cdnQueryPage(collectionName, options = {}) {
  const { where = null, orderField = null, direction = 'desc', skip = 0, limit = 20 } = options
  if (shouldProxyRead(collectionName)) {
    return secureQueryPage(collectionName, {
      where: where && Object.keys(where).length ? where : null,
      orderBy: orderField ? [{ field: orderField, direction }] : [],
      skip,
      limit,
    })
  }
  const db = await getCdnDatabase()
  let query = db.collection(collectionName)
  if (where && Object.keys(where).length) query = query.where(where)
  if (orderField) query = query.orderBy(orderField, direction)
  const res = await query.skip(skip).limit(limit).get()
  return res.data || []
}

/**
 * 固定 docId upsert。
 *
 * ⚠️ 原实现是 `try { update } catch { add }`，**首次保存会静默丢失**（审计 §0 P0-7）：
 * CloudBase 的 `update` 对不存在的文档返回 `{updated: 0}` 而**不抛错**，`catch` 永不触发，
 * `add` 永不执行，调用方随后照样弹「保存成功」。
 * 现改为先看写结果：`updated === 0` 即视为「文档不存在」→ 转 add。
 *
 * `ops` 仅为可测试性预留（默认即真实实现），见 admin/scripts/test-write-layer.mjs。
 */
export async function cdnUpsertDoc(collectionName, docId, data, ops = {}) {
  const update = ops.update || cdnUpdate
  const add = ops.add || cdnAdd
  try {
    const res = await update(collectionName, docId, data)
    if (writeApplied(res)) return res
  } catch (e) {
    // 真错误（网络/权限）照抛；只有「像不存在」才转 add
    if (!/not exist|不存在|no document|DOCUMENT_NOT_FOUND|-502001/i.test(e?.message || String(e))) {
      throw e
    }
  }
  return assertWriteApplied(
    collectionName,
    await add(collectionName, {
      ...data,
      _id: docId,
      _createTime: data._createTime ?? Date.now(),
    }),
    'add'
  )
}

/** 集合仅一条配置时 upsert */
export async function cdnUpsertSingleton(collectionName, data) {
  const rows = await fetchCollectionLimit(collectionName, { limit: 1 })
  if (rows.length > 0) {
    const res = await cdnUpdate(collectionName, rows[0]._id, data)
    assertWriteApplied(collectionName, res, 'update')
    return rows[0]._id
  }
  const added = await cdnAdd(collectionName, {
    ...data,
    _createTime: data._createTime ?? Date.now(),
  })
  assertWriteApplied(collectionName, added, 'add')
  return added?._id || added?.id || ''
}

/** where 匹配 upsert（如 type: 'behavior_types'） */
export async function cdnUpsertByWhere(collectionName, where, data) {
  const rows = await fetchCollectionWhere(collectionName, where, 1)
  if (rows.length > 0) {
    const res = await cdnUpdate(collectionName, rows[0]._id, data)
    assertWriteApplied(collectionName, res, 'update')
    return rows[0]._id
  }
  const added = await cdnAdd(collectionName, {
    ...data,
    _createTime: data._createTime ?? Date.now(),
  })
  assertWriteApplied(collectionName, added, 'add')
  return added?._id || added?.id || ''
}

/** 分页拉全量，避免 limit(1000) 无排序漏掉近期记录 */
export async function fetchAllFromCollection(collectionName, options = {}) {
  const {
    orderField = 'date',
    direction = 'desc',
    pageSize = 100,
    maxRows = 5000,
    where = null,
  } = options
  if (shouldProxyRead(collectionName)) {
    return secureQueryAll(collectionName, {
      where,
      orderBy: orderField ? [{ field: orderField, direction }] : [],
      maxRows,
    })
  }
  const db = await getCdnDatabase()
  const all = []
  let skip = 0

  while (all.length < maxRows) {
    let query = db.collection(collectionName)
    if (where) query = query.where(where)
    if (orderField) query = query.orderBy(orderField, direction)
    const res = await query.skip(skip).limit(pageSize).get()
    const batch = res.data || []
    if (!batch.length) break
    all.push(...batch)
    if (batch.length < pageSize) break
    skip += pageSize
  }

  return all
}
