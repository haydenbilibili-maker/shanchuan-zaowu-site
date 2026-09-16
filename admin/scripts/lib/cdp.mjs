/**
 * 极简 Chrome DevTools Protocol 驱动（零依赖）
 *
 * 为什么自己写：仓库里没有 puppeteer/playwright，而审计需要**真实 DOM** 证据
 * （静态单测只能证明数据层，证明不了「侧栏真的画出来了」）。
 * 本机有 Google Chrome，Node 22 自带全局 `WebSocket`，因此无需装包。
 *
 * 只实现用得到的四件事：启动无头 Chrome、打开页面、在页面里求值、等待条件成立。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)

export function findChrome() {
  return CHROME_CANDIDATES.find((p) => existsSync(p)) || null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 等一个 HTTP 端口上的 JSON 接口可用（Chrome 启动要几百毫秒） */
async function waitForJson(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  let lastErr = null
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return await res.json()
      lastErr = new Error(`HTTP ${res.status}`)
    } catch (e) {
      lastErr = e
    }
    await sleep(120)
  }
  throw new Error(`等待 ${url} 超时：${lastErr?.message || 'unknown'}`)
}

/**
 * 启动一个无头 Chrome 并连到首个页面 target。
 * @returns {Promise<{evaluate: (expr: string) => Promise<any>, goto: (url: string) => Promise<void>, close: () => Promise<void>, debugPort: number}>}
 */
export async function launchChrome({ debugPort, headless = true } = {}) {
  const chrome = findChrome()
  if (!chrome) throw new Error('未找到 Chrome，可用 CHROME_PATH 环境变量指定')
  const port = debugPort || 9200 + Math.floor(Math.random() * 300)
  const profile = mkdtempSync(join(tmpdir(), 'sc-cdp-'))
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-background-networking',
    '--window-size=1440,900',
    'about:blank',
  ]
  if (headless) args.unshift('--headless=new')

  const child = spawn(chrome, args, { stdio: 'ignore', detached: false })

  let targets
  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`)
    targets = await waitForJson(`http://127.0.0.1:${port}/json/list`)
  } catch (e) {
    try { child.kill('SIGKILL') } catch { /* ignore */ }
    throw e
  }
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('未找到 page target')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')), { once: true })
  })

  let nextId = 1
  const pending = new Map()
  const listeners = new Map()
  ws.addEventListener('message', (ev) => {
    let msg
    try { msg = JSON.parse(ev.data) } catch { return }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(`${msg.error.message}${msg.error.data ? ` — ${msg.error.data}` : ''}`))
      else resolve(msg.result)
      return
    }
    if (msg.method) {
      const fns = listeners.get(msg.method)
      if (fns) fns.forEach((fn) => { try { fn(msg.params) } catch { /* ignore */ } })
    }
  })

  /** 订阅 CDP 事件（如 Runtime.exceptionThrown / Runtime.consoleAPICalled） */
  const on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, [])
    listeners.get(method).push(fn)
  }

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error(`CDP ${method} 超时`))
        }
      }, 30000)
    })

  await send('Page.enable')
  await send('Runtime.enable')

  /** 在页面里求值；`awaitPromise` 让页面里的 Promise 也能等 */
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (res.exceptionDetails) {
      throw new Error(`页面求值异常：${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`)
    }
    return res.result?.value
  }

  const goto = async (url) => {
    const before = await evaluate('location.href').catch(() => '')
    const wantBase = url.split('#')[0]
    // 同文档 hash 跳转不会重新加载文档，因此不能等「到达某个 hash」——
    // 应用可能立刻用 replaceState 把别名 hash 改写成规范 hash（#/m/16 → #/m/37）。
    // 分工：goto 只保证「导航已落地」，具体状态交给 waitFor 轮询。
    const sameDocument = before.split('#')[0] === wantBase
    await send('Page.navigate', { url })
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      const info = await evaluate('({ href: location.href, rs: document.readyState })').catch(() => null)
      if (info && info.rs === 'complete' && (sameDocument || info.href.split('#')[0] === wantBase)) return
      await sleep(150)
    }
    throw new Error(`页面加载超时：${url}`)
  }

  /** 真刷新（区别于 hash 同文档跳转）：用于「写入 localStorage 后重载，让应用读到」 */
  const reload = async () => {
    await send('Page.reload', { ignoreCache: false })
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      const info = await evaluate('({ href: location.href, rs: document.readyState })').catch(() => null)
      if (info && info.rs === 'complete') return
      await sleep(150)
    }
    throw new Error('刷新后等待 readyState 超时')
  }

  /** 轮询直到表达式返回 truthy，否则抛出（把最后一次的值带进错误信息） */
  const waitFor = async (expression, { timeoutMs = 20000, label = expression } = {}) => {
    const deadline = Date.now() + timeoutMs
    let last
    while (Date.now() < deadline) {
      last = await evaluate(expression).catch((e) => `〈求值异常〉${e.message}`)
      if (last) return last
      await sleep(200)
    }
    throw new Error(`等待条件超时：${label}（最后取值 ${JSON.stringify(last)}）`)
  }

  const close = async () => {
    try { ws.close() } catch { /* ignore */ }
    try { child.kill('SIGKILL') } catch { /* ignore */ }
    await sleep(150)
    try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
  }

  return { evaluate, goto, waitFor, reload, close, on, debugPort: port, send }
}
