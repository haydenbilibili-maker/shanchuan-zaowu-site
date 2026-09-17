#!/usr/bin/env node
/**
 * Agent 登录网关 —— 替代 Caddy，解决「手机上反复输密码」
 *
 * 为什么不用 Caddy 的 Basic Auth：
 *   Basic Auth 走**浏览器原生凭据缓存**，而这个机制在手机端很不可靠 ——
 *   iOS Safari / 多数手机浏览器不保证跨 tab、跨会话、跨 App 切换保留凭据；
 *   且任何一次后台请求（DSH 的 /api 轮询、SSE 重连）收到 401 都可能**再次弹框**。
 *   桌面 Chrome 表现正常，所以本地验证时暴露不出来。
 *
 * 本网关改成普通网站的登录方式：
 *   · 未登录 → **302 重定向到登录页**（不是 401，因此永远不会触发原生弹框）
 *   · 登录成功 → 下发 **HMAC 签名的长效 cookie（默认 365 天）**
 *   · 已登录 → 反代到 DSH，并**注入 DSH 自己的会话 cookie**
 *     （所以终端设备仍然不需要 DSH 的 launch token）
 *
 * 零依赖（只用 node: 内置模块）。环境变量见 deploy/agent-server/setup-login-gate.sh。
 */
'use strict'

import http from 'node:http'
import crypto from 'node:crypto'
import { timingSafeEqual as nodeTSE } from 'node:crypto'

const PORT = Number(process.env.GATE_PORT || 8080)
const DSH_PORT = Number(process.env.DSH_PORT || 3080)
const PUBLIC_HOST = process.env.PUBLIC_HOST || 'agent.shanhaizaowu.com'
const PASSWORD = process.env.GATE_PASSWORD || ''
const SECRET = process.env.COOKIE_SECRET || ''
const DSH_COOKIE = process.env.DSH_COOKIE || ''
const MAX_AGE_DAYS = Number(process.env.GATE_MAX_AGE_DAYS || 365)
const COOKIE = 'gate'

if (!PASSWORD || !SECRET || !DSH_COOKIE) {
  console.error('[agent-gate] 缺少 GATE_PASSWORD / COOKIE_SECRET / DSH_COOKIE —— 拒绝启动（绝不退化成无鉴权直通）')
  process.exit(1)
}

/** 常量时间比较（长度不同也走完全程，避免用长度提前返回） */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  let diff = ba.length ^ bb.length
  const n = Math.max(ba.length, bb.length)
  const pad = Buffer.alloc(n)
  const pa = Buffer.concat([ba, pad]).subarray(0, n)
  const pb = Buffer.concat([bb, pad]).subarray(0, n)
  try {
    diff |= nodeTSE(pa, pb) === true ? 0 : 1
  } catch {
    diff |= 1
  }
  return diff === 0
}

const sign = (payload) => crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')

function makeToken() {
  const exp = Date.now() + MAX_AGE_DAYS * 86400000
  const payload = `v1.${exp}`
  return `${payload}.${sign(payload)}`
}

function tokenValid(token) {
  if (!token) return false
  const i = token.lastIndexOf('.')
  if (i < 0) return false
  const payload = token.slice(0, i)
  const mac = token.slice(i + 1)
  if (!safeEqual(mac, sign(payload))) return false
  const exp = Number(payload.split('.')[1])
  return Number.isFinite(exp) && exp > Date.now()
}

function parseCookies(header) {
  const out = {}
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

// ── 登录页（黑金风格，极简）─────────────────────────────────────────────
const LOGIN_HTML = (msg = '') => `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>AI 工作台 · 登录</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#0d0d0f; color:#e8e6e1;
         font:15px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif; }
  .card { width:min(92vw,360px); padding:32px 28px; border:1px solid #2a2620; border-radius:14px;
          background:linear-gradient(180deg,#151412,#100f0e); box-shadow:0 12px 40px rgba(0,0,0,.5); }
  h1 { margin:0 0 4px; font-size:19px; letter-spacing:.5px; color:#d4af37; font-weight:600; }
  p.sub { margin:0 0 22px; font-size:13px; color:#8b8578; }
  label { display:block; font-size:13px; color:#a89f8d; margin:0 0 6px; }
  input { width:100%; padding:11px 12px; border-radius:9px; border:1px solid #3a3428;
          background:#0b0b0c; color:#f2efe8; font-size:16px; outline:none; }
  input:focus { border-color:#d4af37; box-shadow:0 0 0 3px rgba(212,175,55,.18); }
  button { width:100%; margin-top:16px; padding:12px; border:0; border-radius:9px; cursor:pointer;
           background:linear-gradient(180deg,#d4af37,#b8912b); color:#1a1508; font-weight:600; font-size:15px; }
  button:active { transform:translateY(1px); }
  .err { margin:0 0 14px; padding:9px 11px; border-radius:8px; font-size:13px;
         background:rgba(200,60,60,.14); border:1px solid rgba(200,60,60,.4); color:#ffb4b4; }
  .tip { margin-top:16px; font-size:12px; color:#6f6a5f; line-height:1.5; }
</style></head><body>
<form class="card" method="POST" action="/__gate/login">
  <h1>AI 工作台</h1>
  <p class="sub">DeepSeek Harness · 请先登录</p>
  ${msg ? `<div class="err">${msg}</div>` : ''}
  <label for="p">密码</label>
  <input id="p" name="password" type="password" autocomplete="current-password" autofocus required />
  <button type="submit">进入工作台</button>
  <div class="tip">登录后本设备 ${MAX_AGE_DAYS} 天内免登录。<br />忘记密码请在服务器上重跑部署脚本。</div>
</form></body></html>`

function sendHtml(res, code, html, extraHeaders = {}) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders })
  res.end(html)
}

// ── 反代到 DSH ─────────────────────────────────────────────────────────
function proxy(req, res) {
  const headers = { ...req.headers }
  headers.host = PUBLIC_HOST        // DSH 的 browser-trust fence 按 Host 判定，必须保留公网 authority
  headers.cookie = DSH_COOKIE       // 注入 DSH 会话 cookie（覆盖而非追加：DSH 只认自己那枚）
  delete headers.authorization
  // 关键：让上游认为请求来自 HTTPS，否则部分框架会生成 http 链接
  headers['x-forwarded-proto'] = 'https'
  headers['x-forwarded-host'] = PUBLIC_HOST

  const upstream = http.request(
    { host: '127.0.0.1', port: DSH_PORT, method: req.method, path: req.url, headers },
    (up) => {
      const out = { ...up.headers }
      out['cache-control'] = 'no-store'
      res.writeHead(up.statusCode || 502, out)
      up.pipe(res)                  // 流式转发：DSH 的 SSE 不会被缓冲
    },
  )
  upstream.on('error', (e) => {
    if (!res.headersSent) sendHtml(res, 502, `网关无法连接 DSH：${e.message}`)
    else res.destroy()
  })
  req.pipe(upstream)                // 请求体也流式转发
}

// ── 登录尝试限速（简单内存计数，防暴力破解）──────────────────────────
// ⚠ 两个必须避开的坑（第一版都踩了）：
//   1. **不能用 req.socket.remoteAddress 作为键**：请求经 cloudflared 进来时，
//      所有设备看到的都是 127.0.0.1 → 限速退化成**全局共享的一个桶**，
//      任何人失败若干次就会把所有设备（包括你自己）一起锁掉。
//      真实客户端 IP 在 `cf-connecting-ip`（Cloudflare 注入、cloudflared 转发）。
//   2. **不能把成功也计入失败次数**，否则正常使用也会累积到锁死。
//      改为：只在密码错误时记一次，成功即清零。
const attempts = new Map()
const WINDOW_MS = 10 * 60 * 1000
const MAX_TRIES = 20
const clientIp = (req) =>
  String(
    req.headers['cf-connecting-ip'] ||
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket.remoteAddress ||
      '?',
  )
function isLocked(ip) {
  const now = Date.now()
  const rec = attempts.get(ip)
  if (!rec || now - rec.t0 > WINDOW_MS) return false
  return rec.n >= MAX_TRIES
}
function recordFailure(ip) {
  const now = Date.now()
  const rec = attempts.get(ip)
  if (!rec || now - rec.t0 > WINDOW_MS) attempts.set(ip, { t0: now, n: 1 })
  else rec.n += 1
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${PUBLIC_HOST}`)
  const ip = clientIp(req)

  if (url.pathname === '/__gate/login' && req.method === 'GET') {
    return sendHtml(res, 200, LOGIN_HTML())
  }

  if (url.pathname === '/__gate/login' && req.method === 'POST') {
    if (isLocked(ip)) return sendHtml(res, 429, LOGIN_HTML('尝试过于频繁，请 10 分钟后再试（或重启 agent-gate 服务立即解锁）。'))
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > 4096) req.destroy()
    })
    req.on('end', () => {
      const pw = new URLSearchParams(body).get('password') || ''
      if (!safeEqual(pw, PASSWORD)) {
        recordFailure(ip)   // 只有失败才计数；成功会清零
        return sendHtml(res, 401, LOGIN_HTML('密码不正确。'))
      }
      attempts.delete(ip)
      res.writeHead(302, {
        location: '/',
        'cache-control': 'no-store',
        'set-cookie': `${COOKIE}=${makeToken()}; Max-Age=${MAX_AGE_DAYS * 86400}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      })
      res.end()
    })
    return
  }

  if (url.pathname === '/__gate/logout') {
    res.writeHead(302, {
      location: '/__gate/login',
      'set-cookie': `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
    })
    return res.end()
  }

  if (!tokenValid(parseCookies(req.headers.cookie)[COOKIE])) {
    // 用 302 而不是 401：401 会让浏览器弹原生框，正是我们要摆脱的行为
    res.writeHead(302, { location: '/__gate/login', 'cache-control': 'no-store' })
    return res.end()
  }

  proxy(req, res)
})

// WebSocket / upgrade 透传（DSH 若用 WS，不能只靠 http 代理）
server.on('upgrade', (req, socket, head) => {
  if (!tokenValid(parseCookies(req.headers.cookie)[COOKIE])) return socket.destroy()
  const { port, host } = { port: DSH_PORT, host: '127.0.0.1' }
  const headers = { ...req.headers, host: PUBLIC_HOST, cookie: DSH_COOKIE }
  const up = http.request({ host, port, method: req.method, path: req.url, headers })
  up.on('upgrade', (upRes, upSocket, upHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
        Object.entries(upRes.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') +
        '\r\n\r\n',
    )
    if (upHead?.length) socket.unshift(upHead)
    upSocket.pipe(socket)
    socket.pipe(upSocket)
  })
  up.on('error', () => socket.destroy())
  up.end()
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[agent-gate] listening on 127.0.0.1:${PORT} → dsh 127.0.0.1:${DSH_PORT} (host ${PUBLIC_HOST}, cookie ${MAX_AGE_DAYS}d)`)
})
