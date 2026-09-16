/**
 * 边缘网关：Basic Auth + 代注入 DSH 会话 cookie
 *
 * 为什么把这一层放在**边缘**而不是源站：
 * 源站是一台 MemTotal 仅 1.58 GiB 的轻量服务器（标称 2 GiB）。原先在源站加了 Caddy
 * 做同样的事，结果整机假死到 SSH 都拿不到 banner、隧道掉线（公网 530）、控制台卡在
 * 「停止中」。教训是：**不要在贴着内存天花板的机器上再加常驻进程**。
 * 本 Worker 跑在 Cloudflare 边缘，源站只剩 DSH + cloudflared 两个进程。
 *
 * ⚠ 必须先理解的陷阱：**循环请求**
 *   当 Worker 的 Route 挂在隧道域名（agent.shanhaizaowu.com）上时，Worker 里写
 *   `fetch(request)` 或 fetch 同一个主机名，会**再次命中本 Worker**，形成无限循环
 *   （表现为 508 Loop Detected / 或超时）。
 *   ⇒ 因此必须给隧道挂**第二个主机名**作为「源站名」，Worker 只 fetch 它。
 *   见 README 的部署步骤与「防止绕过」一节。
 *
 * 需要的绑定（wrangler secret / 面板变量）
 *   GATE_USER    普通变量    Basic Auth 用户名（如 admin）
 *   GATE_PASS    **secret**  Basic Auth 密码
 *   DSH_COOKIE   **secret**  DSH 会话 cookie 的 `名=值`
 *   ORIGIN_HOST  普通变量    源站主机名（隧道挂的第二个主机名，如 agent-origin.example.com）
 */

const REALM = 'DSH Agent'

export default {
  async fetch(request, env) {
    // 未配置完整就**拒服务**，而不是退化成「无鉴权直通」—— 那种失败模式最危险
    const missing = ['GATE_USER', 'GATE_PASS', 'DSH_COOKIE', 'ORIGIN_HOST'].filter((k) => !env[k])
    if (missing.length) {
      return new Response(
        `gate misconfigured: missing ${missing.join(', ')}. Refusing to serve (never fall through to unauthenticated).\n`,
        { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } },
      )
    }

    const auth = request.headers.get('authorization') || ''
    if (!(await checkBasicAuth(auth, env.GATE_USER, env.GATE_PASS))) {
      return new Response('Authentication required.\n', {
        status: 401,
        headers: {
          'www-authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
          // 绝不能被缓存，否则一个已认证响应可能被复用给未认证请求
          'cache-control': 'no-store',
        },
      })
    }

    // 转发到「源站主机名」，并把 DSH 会话 cookie 注入进去。
    // 用 new Request 重建：Request 的 header 大多是只读的，直接 set 会抛错。
    const origin = new URL(request.url)
    origin.hostname = env.ORIGIN_HOST
    origin.protocol = 'https:'
    origin.port = ''

    const headers = new Headers(request.headers)
    headers.set('cookie', env.DSH_COOKIE)          // 覆盖而非追加：DSH 只认自己那枚
    headers.set('host', env.ORIGIN_HOST)           // 与 origin 主机名一致，避免 origin 侧 Host 混乱
    headers.delete('authorization')                // 不要把 Basic 凭据透给源站

    const upstream = new Request(origin.toString(), {
      method: request.method,
      headers,
      body: request.body,
      redirect: 'manual',
    })

    let res
    try {
      res = await fetch(upstream)
    } catch (e) {
      return new Response(`gate: upstream fetch failed — ${e && e.message ? e.message : e}\n`, {
        status: 502,
        headers: { 'cache-control': 'no-store' },
      })
    }

    // 原样回传（Workers 默认流式转发，因此 DSH 的 SSE / 长响应不会被缓冲）
    const out = new Headers(res.headers)
    out.set('cache-control', 'no-store')           // 会话内容永不缓存
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out })
  },
}

/** 常量时间比较，避免 Basic Auth 被逐字符时序侧信道探测 */
function timingSafeEqual(a, b) {
  const ba = new TextEncoder().encode(a)
  const bb = new TextEncoder().encode(b)
  // 长度不同也走完全程，避免用长度提前返回
  let diff = ba.length ^ bb.length
  const n = Math.max(ba.length, bb.length)
  for (let i = 0; i < n; i++) diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0)
  return diff === 0
}

async function checkBasicAuth(header, user, pass) {
  const m = /^Basic\s+(.+)$/i.exec(header.trim())
  if (!m) return false
  let decoded
  try {
    decoded = atob(m[1])
  } catch {
    return false
  }
  const idx = decoded.indexOf(':')
  if (idx < 0) return false
  const u = decoded.slice(0, idx)
  const p = decoded.slice(idx + 1)
  // 两个都比较，不短路，避免「用户名对不对」也被计时区分
  const okU = timingSafeEqual(u, user)
  const okP = timingSafeEqual(p, pass)
  return okU && okP
}
